"""Les répartitions d'un titre et le dictionnaire d'un ETF (migration 0076).

CE QUE CES TESTS PROTÈGENT, dans l'ordre de ce qui coûterait le plus cher à casser :

  - RIEN N'EST JAMAIS RENORMALISÉ. Une répartition de 70 % reste de 70 % : le
    résidu est « non renseigné », il ne se distribue pas. Un camembert qui
    étirerait ce qu'on connaît sur 100 % se lirait comme complet, sans l'être ;
  - UNE VALORISATION SE DISTRIBUE AU PRORATA DES POIDS, et la somme des parts
    vaut toujours le total : un ETF à 1 000 € qui pèse 650 € sur une zone et 150 €
    sur une autre ne fait pas apparaître ni disparaître d'argent ;
  - LA CLASSE D'ACTIF UNIQUE RESTE UN GESTE SIMPLE : en choisir une pose 100 %, la
    retirer vide l'axe. C'est ce que fait le menu de la saisie rapide, qui ne
    connaît pas les répartitions ;
  - UNE ÉTIQUETTE SUPPRIMÉE EMPORTE SES LIGNES, pas le reste de la répartition ;
  - LES ERREURS REFUSENT, LES INCOMPLÉTUDES SIGNALENT : un poids de 120 ou une somme
    de 130 sont faux ; une somme de 70 est seulement incomplète.
"""
from datetime import date

import pytest
from fastapi import HTTPException

from app import crud, models, schemas
from app.constants import AxeTitre, SensTitre
from app.services import exposition

from .conftest import charger_module_extension, creer_compte

routeur = charger_module_extension("placements", "routeur_titres.py")
routeur_types = charger_module_extension("placements", "routeur_types_titre.py")
service_vue = charger_module_extension("investing-overview", "service_vue_ensemble.py")

ISIN_MSFT = "US5949181045"
ISIN_GOOG = "US02079K3059"


def _monnaie(db):
    return crud.get_monnaies(db)[0].id


def _titre(db, nom="ETF World", cours=100.0):
    return crud.create_titre(db, nom, _monnaie(db), cours)


def _etiquette(db, nom, axe):
    return crud.create_type_titre(db, nom, axe.value)


def _repartir(db, titre, axe, lignes):
    return routeur.remplacer_expositions(
        titre.id,
        schemas.ExpositionsUpdate(
            axe=axe,
            lignes=[schemas.ExpositionLigneEcriture(type_titre_id=i, poids_pct=p) for i, p in lignes],
        ),
        db,
    )


# ---------- Les répartitions ----------


def test_une_repartition_se_pose_et_se_relit(db_session):
    titre = _titre(db_session)
    usa = _etiquette(db_session, "États-Unis", AxeTitre.zone)
    europe = _etiquette(db_session, "Europe", AxeTitre.zone)

    lu = _repartir(db_session, titre, AxeTitre.zone, [(usa.id, 65.0), (europe.id, 15.0)])

    assert [(e.type_titre_nom, e.poids_pct) for e in lu.expositions] == [
        ("États-Unis", 65.0),
        ("Europe", 15.0),
    ]


def test_une_repartition_incomplete_n_est_pas_etiree_et_se_signale(db_session):
    """80 % connus restent 80 % : rien n'est renormalisé, et la lecture le dit."""
    titre = _titre(db_session)
    usa = _etiquette(db_session, "États-Unis", AxeTitre.zone)
    europe = _etiquette(db_session, "Europe", AxeTitre.zone)

    lu = _repartir(db_session, titre, AxeTitre.zone, [(usa.id, 65.0), (europe.id, 15.0)])

    assert sum(e.poids_pct for e in lu.expositions) == pytest.approx(80.0)
    assert any("80" in message for message in lu.avertissements)


def test_remplacer_une_repartition_la_remplace_en_entier(db_session):
    titre = _titre(db_session)
    usa = _etiquette(db_session, "États-Unis", AxeTitre.zone)
    europe = _etiquette(db_session, "Europe", AxeTitre.zone)
    _repartir(db_session, titre, AxeTitre.zone, [(usa.id, 70.0), (europe.id, 30.0)])

    # La MÊME étiquette reposée : l'unicité ne doit pas s'y opposer.
    lu = _repartir(db_session, titre, AxeTitre.zone, [(usa.id, 100.0)])

    assert [(e.type_titre_nom, e.poids_pct) for e in lu.expositions] == [("États-Unis", 100.0)]


def test_une_liste_vide_vide_l_axe_sans_toucher_aux_autres(db_session):
    titre = _titre(db_session)
    usa = _etiquette(db_session, "États-Unis", AxeTitre.zone)
    tech = _etiquette(db_session, "Technologies", AxeTitre.secteur)
    _repartir(db_session, titre, AxeTitre.zone, [(usa.id, 100.0)])
    _repartir(db_session, titre, AxeTitre.secteur, [(tech.id, 100.0)])

    lu = _repartir(db_session, titre, AxeTitre.zone, [])

    assert [e.axe for e in lu.expositions] == ["secteur"]


@pytest.mark.parametrize(
    "lignes, motif",
    [
        ([(0, 120.0)], "entre 0"),
        ([(0, 0.0)], "entre 0"),
        ([(0, -5.0)], "entre 0"),
        ([(0, 60.0), (1, 50.0)], "dépasse 100"),
    ],
)
def test_une_repartition_fausse_est_refusee(db_session, lignes, motif):
    titre = _titre(db_session)
    a = _etiquette(db_session, "A", AxeTitre.zone)
    b = _etiquette(db_session, "B", AxeTitre.zone)
    ids = [a.id, b.id]
    with pytest.raises(HTTPException) as erreur:
        _repartir(db_session, titre, AxeTitre.zone, [(ids[i], p) for i, p in lignes])
    assert erreur.value.status_code == 422
    assert motif in erreur.value.detail


def test_la_meme_etiquette_deux_fois_est_refusee(db_session):
    titre = _titre(db_session)
    a = _etiquette(db_session, "A", AxeTitre.zone)
    with pytest.raises(HTTPException) as erreur:
        _repartir(db_session, titre, AxeTitre.zone, [(a.id, 50.0), (a.id, 30.0)])
    assert erreur.value.status_code == 422


def test_une_etiquette_d_un_autre_axe_est_refusee(db_session):
    """Poser un secteur dans la répartition des zones fausserait deux camemberts."""
    titre = _titre(db_session)
    tech = _etiquette(db_session, "Technologies", AxeTitre.secteur)
    with pytest.raises(HTTPException) as erreur:
        _repartir(db_session, titre, AxeTitre.zone, [(tech.id, 100.0)])
    assert erreur.value.status_code == 404


def test_l_enveloppe_n_est_pas_une_repartition(db_session):
    titre = _titre(db_session)
    with pytest.raises(HTTPException) as erreur:
        _repartir(db_session, titre, AxeTitre.enveloppe, [])
    assert erreur.value.status_code == 422


# ---------- La classe d'actif unique, devenue une répartition à 100 % ----------


def test_une_action_en_direct_tient_sur_une_etiquette_a_cent_pour_cent(db_session):
    direct = _etiquette(db_session, "Action en direct", AxeTitre.enveloppe)
    titre = crud.create_titre(db_session, "Air Liquide", _monnaie(db_session), 100.0, None, direct.id)
    europe = _etiquette(db_session, "Europe", AxeTitre.zone)
    usa = _etiquette(db_session, "États-Unis", AxeTitre.zone)

    # Le poids reçu ne compte pas : une société a un pays de siège, à 100 %.
    lu = _repartir(db_session, titre, AxeTitre.zone, [(europe.id, 60.0)])
    assert [(e.type_titre_nom, e.poids_pct) for e in lu.expositions] == [("Europe", 100.0)]

    with pytest.raises(HTTPException) as erreur:
        _repartir(db_session, titre, AxeTitre.zone, [(europe.id, 60.0), (usa.id, 40.0)])
    assert erreur.value.status_code == 422
    assert "une seule étiquette" in erreur.value.detail


@pytest.mark.parametrize("nom, attendu", [
    ("Action en direct", True), ("actions en direct", True), ("ACTION EN DIRECT", True),
    ("ETF", False), ("Actions", False), (None, False),
])
def test_l_enveloppe_action_en_direct_se_reconnait_sans_casse(nom, attendu):
    assert exposition.est_action_en_direct(nom) is attendu


def test_choisir_une_classe_la_pose_a_cent_pour_cent_et_zero_la_retire(db_session):
    titre = _titre(db_session)
    actions = _etiquette(db_session, "Actions", AxeTitre.classe)

    lu = routeur.update_titre(titre.id, schemas.TitreUpdate(classe_actif_id=actions.id), db_session)
    assert lu.classe_actif_id == actions.id and lu.classe_actif_nom == "Actions"
    assert [(e.axe, e.poids_pct) for e in lu.expositions] == [("classe", 100.0)]

    lu = routeur.update_titre(titre.id, schemas.TitreUpdate(classe_actif_id=0), db_session)
    assert lu.classe_actif_id is None and lu.expositions == []


def test_la_classe_lue_est_celle_qui_pese_le_plus(db_session):
    titre = _titre(db_session)
    actions = _etiquette(db_session, "Actions", AxeTitre.classe)
    oblig = _etiquette(db_session, "Obligations", AxeTitre.classe)
    lu = _repartir(db_session, titre, AxeTitre.classe, [(actions.id, 40.0), (oblig.id, 60.0)])
    assert lu.classe_actif_nom == "Obligations"


# ---------- Les étiquettes ----------


def test_supprimer_une_etiquette_emporte_ses_lignes_et_pas_le_reste(db_session):
    titre = _titre(db_session)
    usa = _etiquette(db_session, "États-Unis", AxeTitre.zone)
    europe = _etiquette(db_session, "Europe", AxeTitre.zone)
    _repartir(db_session, titre, AxeTitre.zone, [(usa.id, 70.0), (europe.id, 30.0)])

    routeur_types.delete_type_titre(usa.id, db_session)

    db_session.refresh(titre)
    assert [(e.etiquette.nom, e.poids_pct) for e in titre.expositions] == [("Europe", 30.0)]


def test_le_nombre_de_titres_d_une_zone_compte_chaque_titre_une_fois(db_session):
    usa = _etiquette(db_session, "États-Unis", AxeTitre.zone)
    for nom in ("A", "B"):
        _repartir(db_session, _titre(db_session, nom), AxeTitre.zone, [(usa.id, 100.0)])
    comptes = crud.compter_titres_par_type(db_session, AxeTitre.zone.value)
    assert comptes == {usa.id: 2}


def test_les_quatre_axes_se_gerent_par_le_meme_routeur(db_session):
    for axe in AxeTitre:
        cree = routeur_types.create_type_titre(
            schemas.TypeTitreCreate(nom=f"Test {axe.value}", axe=axe), db_session
        )
        assert cree.axe == axe.value
        with pytest.raises(HTTPException) as erreur:
            routeur_types.create_type_titre(
                schemas.TypeTitreCreate(nom=f"Test {axe.value}", axe=axe), db_session
            )
        assert erreur.value.status_code == 409


def test_supprimer_un_titre_emporte_ses_repartitions(db_session):
    titre = _titre(db_session)
    usa = _etiquette(db_session, "États-Unis", AxeTitre.zone)
    _repartir(db_session, titre, AxeTitre.zone, [(usa.id, 100.0)])
    routeur.delete_titre(titre.id, db_session)
    assert db_session.query(models.ExpositionTitre).count() == 0


# ---------- Le dictionnaire d'un ETF ----------


def test_la_composition_d_un_etf_s_ecrit_se_relit_et_s_efface(db_session):
    titre = _titre(db_session)
    lu = routeur.update_titre(
        titre.id,
        schemas.TitreUpdate(
            composition={ISIN_MSFT: 15.0, ISIN_GOOG: 12.5}, composition_couverture_pct=27.5
        ),
        db_session,
    )
    assert lu.composition == {ISIN_MSFT: 15.0, ISIN_GOOG: 12.5}
    assert lu.composition_couverture_pct == 27.5
    assert lu.avertissements == []

    # Un dictionnaire vide le retire ; zéro retire la couverture.
    lu = routeur.update_titre(
        titre.id,
        schemas.TitreUpdate(composition={}, composition_couverture_pct=0),
        db_session,
    )
    assert lu.composition is None and lu.composition_couverture_pct is None


def test_une_composition_dont_la_somme_s_ecarte_de_la_couverture_se_signale(db_session):
    titre = _titre(db_session)
    lu = routeur.update_titre(
        titre.id,
        schemas.TitreUpdate(composition={ISIN_MSFT: 15.0}, composition_couverture_pct=60.0),
        db_session,
    )
    assert any("60" in message for message in lu.avertissements)


@pytest.mark.parametrize(
    "composition",
    [{"PAS-UN-ISIN": 10.0}, {ISIN_MSFT: 0.0}, {ISIN_MSFT: 150.0}, {ISIN_MSFT: 60.0, ISIN_GOOG: 50.0}],
)
def test_une_composition_fausse_est_refusee(db_session, composition):
    titre = _titre(db_session)
    with pytest.raises(HTTPException) as erreur:
        routeur.update_titre(titre.id, schemas.TitreUpdate(composition=composition), db_session)
    assert erreur.value.status_code == 422


# ---------- Les graphes : une valorisation distribuée au prorata ----------


def _acheter(db, compte, titre, quantite, prix):
    return crud.create_operation_titre(
        db,
        compte_id=compte.id,
        titre=titre,
        sens=SensTitre.achat,
        quantite=quantite,
        prix_unitaire=prix,
        date_operation=date(2026, 3, 1),
    )


def test_la_valorisation_d_un_panier_se_distribue_selon_ses_poids(db_session):
    compte = creer_compte(db_session, "PEA", type_nom="placements financiers", solde_initial=100000.0)
    etf = _titre(db_session, "ETF World", 100.0)
    usa = _etiquette(db_session, "États-Unis", AxeTitre.zone)
    europe = _etiquette(db_session, "Europe", AxeTitre.zone)
    _repartir(db_session, etf, AxeTitre.zone, [(usa.id, 65.0), (europe.id, 15.0)])
    _acheter(db_session, compte, etf, 10, 100.0)  # 1 000 €

    (bloc,) = service_vue.exposition_par_axe(db_session, AxeTitre.zone.value)
    parts = {p["type_titre_nom"]: p["valorisation"] for p in bloc["parts"]}

    assert parts["États-Unis"] == pytest.approx(650.0)
    assert parts["Europe"] == pytest.approx(150.0)
    # LE RÉSIDU EST UNE PART, JAMAIS REDISTRIBUÉ : 20 % du titre ne sont pas renseignés.
    assert parts[None] == pytest.approx(200.0)
    # Rien n'apparaît ni ne disparaît : la somme des parts vaut le total.
    assert sum(parts.values()) == pytest.approx(bloc["total"]) == pytest.approx(1000.0)
    assert sum(p["part"] for p in bloc["parts"]) == pytest.approx(1.0)


def test_un_titre_sans_repartition_est_entierement_non_renseigne(db_session):
    compte = creer_compte(db_session, "PEA", type_nom="placements financiers", solde_initial=100000.0)
    _acheter(db_session, compte, _titre(db_session, "Sans zone", 100.0), 5, 100.0)
    (bloc,) = service_vue.exposition_par_axe(db_session, AxeTitre.zone.value)
    assert [(p["type_titre_nom"], p["part"]) for p in bloc["parts"]] == [(None, 1.0)]


def test_un_etf_sans_repartition_s_eclate_selon_sa_composition(db_session):
    compte = creer_compte(db_session, "PEA", type_nom="placements financiers", solde_initial=100000.0)
    usa = _etiquette(db_session, "États-Unis", AxeTitre.zone)
    europe = _etiquette(db_session, "Europe", AxeTitre.zone)
    apple = crud.create_titre(db_session, "Apple", _monnaie(db_session), 1.0, "US0378331005")
    asml = crud.create_titre(db_session, "ASML", _monnaie(db_session), 1.0, "NL0010273215")
    _repartir(db_session, apple, AxeTitre.zone, [(usa.id, 100.0)])
    _repartir(db_session, asml, AxeTitre.zone, [(europe.id, 100.0)])
    etf = _titre(db_session, "ETF World", 100.0)
    crud.update_titre(
        db_session, etf, composition={"US0378331005": 40.0, "NL0010273215": 20.0, "US5949181045": 10.0}
    )
    _acheter(db_session, compte, etf, 10, 100.0)  # 1 000 €

    (bloc,) = service_vue.exposition_par_axe(db_session, AxeTitre.zone.value)
    parts = {p["type_titre_nom"]: p["valorisation"] for p in bloc["parts"]}

    assert parts["États-Unis"] == pytest.approx(400.0)
    assert parts["Europe"] == pytest.approx(200.0)
    # Le composant inconnu (Microsoft) et le reste de l'indice : non renseignés, jamais étirés.
    assert parts[None] == pytest.approx(400.0)

    # Une répartition posée sur l'ETF lui-même passe avant sa composition.
    _repartir(db_session, etf, AxeTitre.zone, [(europe.id, 100.0)])
    (bloc,) = service_vue.exposition_par_axe(db_session, AxeTitre.zone.value)
    assert [(p["type_titre_nom"], p["part"]) for p in bloc["parts"]] == [("Europe", 1.0)]


def test_titre_par_titre_le_direct_et_les_etf_se_rejoignent(db_session):
    compte = creer_compte(db_session, "PEA", type_nom="placements financiers", solde_initial=100000.0)
    enveloppe_etf = _etiquette(db_session, "ETF", AxeTitre.enveloppe)
    apple = crud.create_titre(db_session, "Apple", _monnaie(db_session), 100.0, "US0378331005")
    _acheter(db_session, compte, apple, 3, 100.0)  # 300 € en direct
    world = crud.create_titre(db_session, "ETF World", _monnaie(db_session), 100.0, "IE00B4L5Y983", enveloppe_etf.id)
    crud.update_titre(db_session, world, composition={"US0378331005": 40.0, "US5949181045": 20.0})
    _acheter(db_session, compte, world, 10, 100.0)  # 1 000 €
    # Un ETF sans composition : entièrement non déterminé.
    sp500 = crud.create_titre(db_session, "ETF S&P 500", _monnaie(db_session), 100.0, "IE00B5BMR087", enveloppe_etf.id)
    _acheter(db_session, compte, sp500, 5, 100.0)  # 500 €

    (bloc,) = service_vue.exposition_par_titre(db_session)
    parts = {p["cle"]: p for p in bloc["parts"]}

    # Apple : 300 € en direct + 400 € par l'ETF World, une seule part.
    assert parts["US0378331005"]["valorisation"] == pytest.approx(700.0)
    assert {s["direct"] for s in parts["US0378331005"]["sources"]} == {True, False}
    # Microsoft, inconnu de la base : nommé par son ISIN.
    assert parts["US5949181045"]["nom"] == "US5949181045"
    assert parts["US5949181045"]["valorisation"] == pytest.approx(200.0)
    # Non déterminé : 40 % de l'ETF World (400 €) + tout l'ETF S&P 500 (500 €).
    nd = parts["non_determine"]
    assert nd["valorisation"] == pytest.approx(900.0)
    assert [s["nom"] for s in nd["sources"]] == ["ETF S&P 500", "ETF World"]
    assert nd["part_determinee"] is None
    assert bloc["total"] == pytest.approx(1800.0)
    assert bloc["total_determine"] == pytest.approx(900.0)
    assert parts["US0378331005"]["part_determinee"] == pytest.approx(700.0 / 900.0)


def test_titre_par_titre_au_dela_des_premiers_les_titres_se_fondent(db_session):
    compte = creer_compte(db_session, "PEA", type_nom="placements financiers", solde_initial=1e9)
    for i in range(service_vue.TITRES_NOMMES + 3):
        titre = crud.create_titre(db_session, f"Titre {i:02d}", _monnaie(db_session), 1.0)
        _acheter(db_session, compte, titre, 100 + i, 1.0)
    (bloc,) = service_vue.exposition_par_titre(db_session)
    genres = [p["genre"] for p in bloc["parts"]]
    assert genres.count("titre") == service_vue.TITRES_NOMMES
    autres = bloc["parts"][-1]
    assert autres["genre"] == "autres" and autres["nombre_sources"] == 3
    assert sum(p["valorisation"] for p in bloc["parts"]) == pytest.approx(bloc["total"])


def test_la_classe_unique_donne_le_meme_camembert_qu_avant(db_session):
    compte = creer_compte(db_session, "PEA", type_nom="placements financiers", solde_initial=100000.0)
    actions = _etiquette(db_session, "Actions", AxeTitre.classe)
    titre = crud.create_titre(db_session, "Total", _monnaie(db_session), 100.0, None, None, actions.id)
    _acheter(db_session, compte, titre, 10, 100.0)
    (bloc,) = service_vue.exposition_par_axe(db_session, AxeTitre.classe.value)
    assert [(p["type_titre_nom"], p["part"]) for p in bloc["parts"]] == [("Actions", 1.0)]


# ---------- La lecture des cellules (services/exposition) ----------


@pytest.mark.parametrize(
    "texte, attendu",
    [
        ("Technologies", [("Technologies", 100.0)]),
        ("États-Unis 65; Europe 15", [("États-Unis", 65.0), ("Europe", 15.0)]),
        ("États-Unis: 65 % ; Europe: 12,5 %", [("États-Unis", 65.0), ("Europe", 12.5)]),
        ("États-Unis 65\nEurope 15", [("États-Unis", 65.0), ("Europe", 15.0)]),
        ("Asie (hors Chine) 20", [("Asie (hors Chine)", 20.0)]),
    ],
)
def test_une_cellule_de_repartition_se_lit(texte, attendu):
    assert exposition.parser_repartition(texte) == attendu


def test_un_libelle_sans_poids_au_milieu_d_une_liste_est_une_erreur():
    with pytest.raises(exposition.ErreurExposition):
        exposition.parser_repartition("États-Unis 65; Europe")


def test_une_cellule_de_composition_se_lit():
    assert exposition.parser_composition(f"{ISIN_MSFT} 15; {ISIN_GOOG}: 12,5 %") == {
        ISIN_MSFT: 15.0,
        ISIN_GOOG: 12.5,
    }


def test_un_isin_en_double_dans_une_composition_est_une_erreur():
    with pytest.raises(exposition.ErreurExposition):
        exposition.parser_composition(f"{ISIN_MSFT} 15; {ISIN_MSFT} 10")


def test_les_poids_numeriques_d_un_classeur_passent_tels_quels():
    """« 0,15 » d'une cellule Excel formatée en pourcentage reste 0,15 : c'est à
    l'aperçu de l'import de signaler des poids tous inférieurs à 1, pas au parseur
    de le deviner."""
    assert exposition.parser_poids(0.15) == 0.15
    assert exposition.parser_poids("12,5 %") == 12.5
