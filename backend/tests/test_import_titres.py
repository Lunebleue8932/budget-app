"""L'import de titres : un fichier Excel ou CSV qui DÉCRIT des titres (migration 0076).

CE QUE CES TESTS PROTÈGENT, dans l'ordre de ce qui coûterait le plus cher à casser :

  - UNE CELLULE VIDE NE CHANGE RIEN. Un secteur qu'on ne connaît pas laisse la
    cellule vide : ce n'est pas une demande de retirer celui qu'on avait saisi. Un
    import qui effacerait en silence ce qu'on a mis des heures à renseigner serait
    pire que pas d'import ;
  - L'APERÇU ÉCRIT STRICTEMENT RIEN, et dit exactement ce que la confirmation fera —
    sans quoi l'aperçu rassurerait sur un autre fichier que celui qu'on applique ;
  - L'ISIN EST LA CLÉ. Un titre se retrouve par son ISIN, à défaut par son nom quand il
    n'en avait pas ; un nom pris par un titre d'un AUTRE ISIN met la ligne en erreur
    (deviner mélangerait deux titres) ;
  - UNE ÉTIQUETTE INCONNUE EST CRÉÉE DANS LE BON AXE : « Immobilier » est une classe
    ET un secteur, et la zone « Europe » n'est pas la classe « Europe » ;
  - RIEN N'EST RENORMALISÉ : un fichier qui s'arrête à 80 % laisse 80 %, et l'aperçu le dit ;
  - UN FICHIER RÉIMPORTÉ DONNE DES LIGNES « INCHANGÉ » : c'est le geste normal pour mettre
    un ETF à jour, pas une anomalie à bloquer.
"""
import io
import json
from datetime import date

import pytest
from fastapi import HTTPException
from openpyxl import Workbook, load_workbook

from app import crud, models, schemas
from app.constants import (
    COLONNES_IMPORT_TITRE_PAR_DEFAUT,
    AxeTitre,
    DomaineImport,
    SensTitre,
)

from .conftest import charger_module_extension, creer_compte

service = charger_module_extension("placements", "service_import_titres.py")
routeur = charger_module_extension("placements", "routeur_import_titres.py")

ISIN_ETF = "IE000BI8OT95"
ISIN_MSFT = "US5949181045"
ISIN_APPLE = "US0378331005"

ENTETE = [
    "ISIN", "Nom", "Monnaie", "Enveloppe", "Classe d'actif", "Zone géographique",
    "Secteur", "Couverture", "Composition", "Cours",
]


def _fichier(*lignes, entete=True) -> bytes:
    classeur = Workbook()
    feuille = classeur.active
    if entete:
        feuille.append(ENTETE)
    for ligne in lignes:
        feuille.append(list(ligne) + [None] * (len(ENTETE) - len(ligne)))
    tampon = io.BytesIO()
    classeur.save(tampon)
    return tampon.getvalue()


@pytest.fixture()
def preset(db_session):
    return crud.create_import_preset(
        db_session,
        "Modèle",
        COLONNES_IMPORT_TITRE_PAR_DEFAUT,
        [],
        lignes_entete=1,
        domaine=DomaineImport.titre.value,
    )


def _apercu(db, preset, contenu):
    return service.previsualiser(db, preset.id, contenu)


def _confirmer(db, preset, contenu, exclues=None):
    return service.confirmer(db, preset.id, contenu, None, exclues)


def _titre(db, isin=ISIN_ETF, nom="AMUNDI WORLD"):
    return crud.create_titre(db, nom, crud.get_monnaies(db)[0].id, 100.0, isin)


def _lignes(apercu):
    return {l.code_isin: l for l in apercu.lignes}


# ---------- Un titre nouveau ----------


def test_un_titre_inconnu_est_cree_avec_ses_proprietes(db_session, preset):
    crud.create_type_titre(db_session, "ETF", AxeTitre.enveloppe.value)
    crud.create_type_titre(db_session, "Actions", AxeTitre.classe.value)
    crud.create_type_titre(db_session, "États-Unis", AxeTitre.zone.value)
    contenu = _fichier((ISIN_ETF, "Amundi World", "Euro", "ETF", "Actions", "États-Unis", None))

    resultat = _confirmer(db_session, preset, contenu)

    assert (resultat.crees, resultat.mis_a_jour, resultat.ignores) == (1, 0, 0)
    titre = crud.get_titre_by_isin(db_session, ISIN_ETF)
    assert titre.nom == "Amundi World" and titre.type_titre.nom == "ETF"
    assert titre.classe_actif.nom == "Actions"
    assert [(e.etiquette.nom, e.poids_pct) for e in titre.repartition("zone")] == [("États-Unis", 100.0)]


def test_un_titre_sans_nom_prend_son_isin_et_la_monnaie_par_defaut_avec_avertissement(db_session, preset):
    apercu = _apercu(db_session, preset, _fichier((ISIN_MSFT,)))
    (ligne,) = apercu.lignes
    assert ligne.statut == "cree" and ligne.nom == ISIN_MSFT
    assert any("nom absent" in a for a in ligne.avertissements)
    assert any("monnaie absente" in a for a in ligne.avertissements)

    _confirmer(db_session, preset, _fichier((ISIN_MSFT,)))
    assert crud.get_titre_by_isin(db_session, ISIN_MSFT).nom == ISIN_MSFT


def test_les_composants_d_un_etf_entrent_dans_la_base(db_session, preset):
    """Les titres qu'on ne détient pas mais qui servent aux graphes : c'est l'objet de l'import."""
    contenu = _fichier(
        (ISIN_ETF, "ETF World", None, None, None, None, None, 60, f"{ISIN_MSFT} 4,7 ; {ISIN_APPLE} 4,5"),
        (ISIN_MSFT, "Microsoft"),
        (ISIN_APPLE, "Apple"),
    )
    resultat = _confirmer(db_session, preset, contenu)
    assert resultat.crees == 3
    etf = crud.get_titre_by_isin(db_session, ISIN_ETF)
    assert etf.composition == {ISIN_MSFT: 4.7, ISIN_APPLE: 4.5}
    assert etf.composition_couverture_pct == 60.0


# ---------- L'aperçu n'écrit rien ----------


def test_l_apercu_n_ecrit_ni_titre_ni_etiquette_ni_repartition(db_session, preset):
    contenu = _fichier((ISIN_ETF, "ETF", "Euro", "ETF", "Actions", "Nouvelle zone 100", None))
    apercu = _apercu(db_session, preset, contenu)

    assert apercu.nb_a_creer == 1
    assert {(e.axe, e.nom) for e in apercu.etiquettes_a_creer} == {
        ("enveloppe", "ETF"), ("classe", "Actions"), ("zone", "Nouvelle zone"),
    }
    assert db_session.query(models.TitrePossede).count() == 0
    assert db_session.query(models.ExpositionTitre).count() == 0
    assert crud.get_type_titre_by_nom(db_session, "ETF", AxeTitre.enveloppe.value) is None


# ---------- Une cellule vide ne change rien ----------


def test_une_cellule_vide_ne_change_rien_et_une_cellule_renseignee_remplace(db_session, preset):
    titre = _titre(db_session)
    usa = crud.create_type_titre(db_session, "États-Unis", AxeTitre.zone.value)
    tech = crud.create_type_titre(db_session, "Technologies", AxeTitre.secteur.value)
    crud.poser_repartition(db_session, titre, "zone", [(usa.id, 100.0)])
    crud.poser_repartition(db_session, titre, "secteur", [(tech.id, 100.0)])
    db_session.commit()

    # Le fichier ne parle que du secteur : la zone, laissée vide, reste intacte.
    _confirmer(db_session, preset, _fichier((ISIN_ETF, None, None, None, None, None, "Finance 40")))

    db_session.refresh(titre)
    assert [(e.etiquette.nom, e.poids_pct) for e in titre.repartition("zone")] == [("États-Unis", 100.0)]
    assert [(e.etiquette.nom, e.poids_pct) for e in titre.repartition("secteur")] == [("Finance", 40.0)]


def test_le_nom_d_un_titre_existant_n_est_jamais_modifie(db_session, preset):
    titre = _titre(db_session, nom="AMUNDI IDX WLD")
    _confirmer(db_session, preset, _fichier((ISIN_ETF, "Un autre nom")))
    db_session.refresh(titre)
    assert titre.nom == "AMUNDI IDX WLD"


# ---------- Reimporter ----------


def test_reimporter_le_meme_fichier_donne_des_lignes_inchangees(db_session, preset):
    contenu = _fichier((ISIN_ETF, "ETF", "Euro", "ETF", "Actions", "États-Unis 65 ; Europe 15", "Finance 20"))
    _confirmer(db_session, preset, contenu)

    apercu = _apercu(db_session, preset, contenu)
    assert (apercu.nb_a_creer, apercu.nb_a_modifier, apercu.nb_inchanges) == (0, 0, 1)
    resultat = _confirmer(db_session, preset, contenu)
    assert (resultat.crees, resultat.mis_a_jour, resultat.inchanges) == (0, 0, 1)


def test_un_changement_se_montre_avant_apres(db_session, preset):
    _confirmer(db_session, preset, _fichier((ISIN_ETF, "ETF", None, None, None, "États-Unis 70 ; Europe 30")))
    apercu = _apercu(db_session, preset, _fichier((ISIN_ETF, None, None, None, None, "États-Unis 60 ; Europe 40")))
    (ligne,) = apercu.lignes
    assert ligne.statut == "maj"
    (changement,) = ligne.changements
    assert changement.champ == "zone"
    assert "70" in changement.avant and "60" in changement.apres


def test_les_libelles_se_retrouvent_sans_egard_a_la_casse_ni_aux_accents(db_session, preset):
    crud.create_type_titre(db_session, "États-Unis", AxeTitre.zone.value)
    apercu = _apercu(db_session, preset, _fichier((ISIN_ETF, "ETF", None, None, None, "etats-unis")))
    assert apercu.etiquettes_a_creer == []


# ---------- Le bon axe ----------


def test_une_action_en_direct_importee_tient_sur_une_etiquette_a_cent_pour_cent(db_session, preset):
    crud.create_type_titre(db_session, "Action en direct", AxeTitre.enveloppe.value)
    crud.create_type_titre(db_session, "Europe", AxeTitre.zone.value)
    _confirmer(db_session, preset, _fichier((ISIN_MSFT, "Microsoft", None, "Action en direct", None, "Europe 70")))
    titre = crud.get_titre_by_isin(db_session, ISIN_MSFT)
    assert [(e.etiquette.nom, e.poids_pct) for e in titre.repartition("zone")] == [("Europe", 100.0)]

    (ligne,) = _apercu(
        db_session, preset, _fichier((ISIN_MSFT, None, None, None, None, "Europe 60 ; Asie 40"))
    ).lignes
    assert ligne.statut == "erreur"
    assert any("une seule étiquette" in e for e in ligne.erreurs)


def test_une_etiquette_inconnue_est_creee_dans_son_axe(db_session, preset):
    """« Immobilier » existe comme classe (semée) ET comme secteur : la zone « Immobilier » est autre chose."""
    resultat = _confirmer(
        db_session, preset, _fichier((ISIN_ETF, "ETF", None, None, "Immobilier", None, "Immobilier"))
    )
    axes = {(e.axe, e.nom) for e in resultat.etiquettes_creees}
    assert axes == {("classe", "Immobilier"), ("secteur", "Immobilier")}
    classes = [e.nom for e in crud.get_types_titre(db_session, "classe")]
    assert classes.count("Immobilier") == 1


# ---------- Rien n'est renormalisé ----------


def test_une_repartition_incomplete_reste_incomplete_et_l_apercu_le_dit(db_session, preset):
    contenu = _fichier((ISIN_ETF, "ETF", None, None, None, "États-Unis 50 ; Europe 30"))
    apercu = _apercu(db_session, preset, contenu)
    assert any("80" in a for a in apercu.lignes[0].avertissements)
    _confirmer(db_session, preset, contenu)
    titre = crud.get_titre_by_isin(db_session, ISIN_ETF)
    assert sum(e.poids_pct for e in titre.repartition("zone")) == pytest.approx(80.0)


def test_des_poids_inferieurs_a_un_font_penser_a_des_fractions(db_session, preset):
    apercu = _apercu(db_session, preset, _fichier((ISIN_ETF, "ETF", None, None, None, "États-Unis 0,65 ; Europe 0,15")))
    assert any("fractions" in a for a in apercu.lignes[0].avertissements)


# ---------- Les erreurs ----------


@pytest.mark.parametrize(
    "ligne, motif",
    [
        ((None, "Sans isin"), "ISIN manquant"),
        (("PAS-UN-ISIN", "X"), "n'est pas un ISIN valide"),
        ((ISIN_ETF, "X", "Franc imaginaire"), "monnaie"),
        ((ISIN_ETF, "X", None, None, None, "États-Unis 120"), "entre 0"),
        ((ISIN_ETF, "X", None, None, None, "États-Unis 70 ; Europe 60"), "dépasse 100"),
        ((ISIN_ETF, "X", None, None, None, "États-Unis 70 ; Europe"), "poids manquant"),
        ((ISIN_ETF, "X", None, None, None, None, None, None, "PASUNISIN 10"), "ISIN valide"),
        ((ISIN_ETF, "X", None, None, None, None, None, None, f"{ISIN_MSFT} 60 ; {ISIN_APPLE} 50"), "dépasse 100"),
    ],
)
def test_une_ligne_impossible_est_ignoree_avec_son_motif(db_session, preset, ligne, motif):
    apercu = _apercu(db_session, preset, _fichier(ligne))
    (l,) = apercu.lignes
    assert l.statut == "erreur"
    assert any(motif in e for e in l.erreurs), l.erreurs
    resultat = _confirmer(db_session, preset, _fichier(ligne))
    assert resultat.ignores == 1 and resultat.crees == 0


def test_une_ligne_en_erreur_n_empeche_pas_les_autres(db_session, preset):
    contenu = _fichier(("MAUVAIS", "X"), (ISIN_ETF, "Bon"))
    resultat = _confirmer(db_session, preset, contenu)
    assert (resultat.crees, resultat.ignores) == (1, 1)


def test_le_meme_isin_deux_fois_dans_le_fichier_est_une_erreur_sur_la_seconde(db_session, preset):
    apercu = _apercu(db_session, preset, _fichier((ISIN_ETF, "A"), (ISIN_ETF, "B")))
    assert [l.statut for l in apercu.lignes] == ["cree", "erreur"]
    assert "ligne 2" in apercu.lignes[1].erreurs[0] or "déjà" in apercu.lignes[1].erreurs[0]


def test_un_nom_pris_par_un_autre_isin_est_un_autre_titre(db_session, preset):
    """L'ISIN TRANCHE (migration 0080) : même nom, autre ISIN, autre titre — créé."""
    autre = _titre(db_session, isin="FR0000120271", nom="ETF World")
    apercu = _apercu(db_session, preset, _fichier((ISIN_ETF, "ETF World")))
    assert apercu.lignes[0].statut == "cree"
    _confirmer(db_session, preset, _fichier((ISIN_ETF, "ETF World")))
    nouveau = crud.get_titre_by_isin(db_session, ISIN_ETF)
    assert (nouveau.nom, nouveau.id != autre.id) == ("ETF World", True)


def test_un_titre_sans_isin_retrouve_par_son_nom_recoit_celui_du_fichier(db_session, preset):
    titre = crud.create_titre(db_session, "ETF World", crud.get_monnaies(db_session)[0].id, 100.0)
    _confirmer(db_session, preset, _fichier((ISIN_ETF, "ETF World")))
    db_session.refresh(titre)
    assert titre.code_isin == ISIN_ETF
    assert db_session.query(models.TitrePossede).count() == 1


def test_la_monnaie_d_un_titre_mouvemente_ne_peut_plus_changer(db_session, preset):
    dollar = crud.create_monnaie(db_session, "Dollar", "$")
    euro = crud.get_monnaies(db_session)[0]
    titre = _titre(db_session)
    compte = creer_compte(db_session, "PEA", type_nom="placements financiers", solde_initial=10000.0)
    crud.create_operation_titre(
        db_session, compte_id=compte.id, titre=titre, sens=SensTitre.achat,
        quantite=1, prix_unitaire=100.0, date_operation=date(2026, 1, 5),
    )
    apercu = _apercu(db_session, preset, _fichier((ISIN_ETF, None, "Dollar")))
    assert apercu.lignes[0].statut == "erreur"
    assert "mouvements" in apercu.lignes[0].erreurs[0]
    assert dollar.id != euro.id


# ---------- Le choix de l'utilisateur ----------


def test_les_lignes_decochees_ne_sont_pas_appliquees(db_session, preset):
    contenu = _fichier((ISIN_ETF, "A"), (ISIN_MSFT, "B"))
    resultat = _confirmer(db_session, preset, contenu, exclues={3})
    assert (resultat.crees, resultat.ignores) == (1, 1)
    assert crud.get_titre_by_isin(db_session, ISIN_MSFT) is None


def test_un_isin_de_composition_sans_fiche_est_signale_pour_le_fichier(db_session, preset):
    contenu = _fichier((ISIN_ETF, "ETF", None, None, None, None, None, None, f"{ISIN_MSFT} 4,7"))
    apercu = _apercu(db_session, preset, contenu)
    assert any("1 ISIN de composition" in a for a in apercu.avertissements)
    # ... et l'avertissement disparaît quand le fichier décrit le composant.
    avec_composant = _fichier((ISIN_ETF, "ETF", None, None, None, None, None, None, f"{ISIN_MSFT} 4,7"), (ISIN_MSFT, "Microsoft"))
    assert _apercu(db_session, preset, avec_composant).avertissements == []


# ---------- Les colonnes configurables, et le CSV ----------


def test_les_colonnes_se_configurent_comme_ailleurs(db_session):
    preset = crud.create_import_preset(
        db_session, "Autre ordre",
        [{"index": 1, "propriete": "nom"}, {"index": 3, "propriete": "code_isin"}, {"index": 5, "propriete": "zone"}],
        [], lignes_entete=2, domaine=DomaineImport.titre.value,
    )
    classeur = Workbook()
    f = classeur.active
    f.append(["Export de mon courtier"])
    f.append(["Nom", "x", "ISIN", "y", "Zone"])
    f.append(["Mon ETF", "-", ISIN_ETF, "-", "Europe"])
    tampon = io.BytesIO()
    classeur.save(tampon)

    _confirmer(db_session, preset, tampon.getvalue())

    titre = crud.get_titre_by_isin(db_session, ISIN_ETF)
    assert titre.nom == "Mon ETF"
    assert [e.etiquette.nom for e in titre.repartition("zone")] == ["Europe"]


def test_un_csv_se_lit_aussi(db_session, preset):
    # Le séparateur « ; » sépare aussi les colonnes : une répartition y est entre guillemets.
    csv = (
        "ISIN;Nom;Monnaie;Enveloppe;Classe;Zone;Secteur;Couverture;Composition\n"
        f'{ISIN_ETF};ETF World;Euro;ETF;Actions;"États-Unis 65 ; Europe 15";;;\n'
    ).encode("utf-8")
    _confirmer(db_session, preset, csv)
    titre = crud.get_titre_by_isin(db_session, ISIN_ETF)
    assert [(e.etiquette.nom, e.poids_pct) for e in titre.repartition("zone")] == [
        ("États-Unis", 65.0), ("Europe", 15.0),
    ]


# ---------- Les presets et le cloisonnement ----------


def test_un_preset_de_titres_exige_l_isin(db_session):
    with pytest.raises(HTTPException) as erreur:
        routeur.create_preset(
            schemas.ImportPresetCreate(nom="Sans isin", colonnes=[{"index": 1, "propriete": "nom"}]),
            db_session,
        )
    assert erreur.value.status_code == 400
    assert "code_isin" in erreur.value.detail


def test_le_routeur_refuse_le_preset_d_un_autre_domaine(db_session):
    bancaire = crud.create_import_preset(db_session, "Banque")
    with pytest.raises(HTTPException) as erreur:
        routeur.get_preset(bancaire.id, db_session)
    assert erreur.value.status_code == 404


def test_les_presets_de_titres_ne_se_melangent_pas_aux_autres(db_session):
    crud.create_import_preset(db_session, "Banque")
    crud.create_import_preset(db_session, "Titres", domaine=DomaineImport.titre.value)
    assert [p.nom for p in routeur.list_presets(db_session)] == ["Titres"]


# ---------- Préparer le fichier ----------


def test_la_feuille_titres_est_lue_meme_si_une_autre_est_active(db_session, preset):
    """Un classeur avec une feuille de remarques peut être enregistré ouvert sur elle."""
    classeur = load_workbook(io.BytesIO(_fichier((ISIN_MSFT, "Microsoft"))))
    classeur.active.title = "Titres"
    remarques = classeur.create_sheet("Remarques")
    remarques.append(["Sources : sites des émetteurs"])
    classeur.active = classeur.sheetnames.index("Remarques")
    tampon = io.BytesIO()
    classeur.save(tampon)

    assert _confirmer(db_session, preset, tampon.getvalue()).crees == 1
    assert crud.get_titre_by_isin(db_session, ISIN_MSFT).nom == "Microsoft"


# ---------- Le cours (extension « Lecture de cours ») ----------


def _avec_cours(*valeurs):
    """Une ligne du fichier réduite à son ISIN et à son cours (dernière colonne)."""
    isin, cours = valeurs
    return (isin,) + (None,) * (len(ENTETE) - 2) + (cours,)


def test_le_cours_du_fichier_remplace_celui_du_titre(db_session, preset):
    titre = _titre(db_session, ISIN_ETF)

    apercu = _apercu(db_session, preset, _fichier(_avec_cours(ISIN_ETF, "104,52 €")))
    (ligne,) = apercu.lignes
    assert ligne.statut == "maj"
    assert [(c.champ, c.avant, c.apres) for c in ligne.changements] == [("cours", "100", "104.52")]

    _confirmer(db_session, preset, _fichier(_avec_cours(ISIN_ETF, 104.52)))
    db_session.refresh(titre)
    assert titre.valeur == 104.52
    # Ce n'est pas une lecture en ligne : rien ne la date.
    assert titre.cours_maj_le is None


def test_un_titre_cree_par_le_fichier_prend_son_cours(db_session, preset):
    _confirmer(db_session, preset, _fichier(_avec_cours(ISIN_MSFT, 410)))
    assert crud.get_titre_by_isin(db_session, ISIN_MSFT).valeur == 410.0


def test_un_cours_illisible_met_la_ligne_en_erreur(db_session, preset):
    _titre(db_session, ISIN_ETF)
    (ligne,) = _apercu(db_session, preset, _fichier(_avec_cours(ISIN_ETF, "n.d."))).lignes
    assert ligne.statut == "erreur"
    assert any("cours" in e for e in ligne.erreurs)


def test_sans_lecture_de_cours_la_colonne_cours_est_ignoree(db_session, preset, monkeypatch):
    from app import extensions

    monkeypatch.setattr(extensions, "est_active", lambda extension_id: extension_id != "lecture-de-cours")
    titre = _titre(db_session, ISIN_ETF)
    (ligne,) = _apercu(db_session, preset, _fichier(_avec_cours(ISIN_ETF, 104.52))).lignes
    assert ligne.statut == "inchange"
    _confirmer(db_session, preset, _fichier(_avec_cours(ISIN_ETF, 104.52)))
    db_session.refresh(titre)
    assert titre.valeur == 100.0


def test_les_titres_suivis_se_rangent_en_possedes_et_non_possedes(db_session):
    compte = creer_compte(db_session, "PEA", type_nom="placements financiers", solde_initial=100000.0)
    gardee, soldee = _titre(db_session, ISIN_ETF, "Gardée"), _titre(db_session, ISIN_MSFT, "Soldée")
    _titre(db_session, ISIN_APPLE, "Jamais achetée")
    for titre, sens, quantite in (
        (gardee, SensTitre.achat, 5), (soldee, SensTitre.achat, 3), (soldee, SensTitre.vente, 3),
    ):
        crud.create_operation_titre(
            db_session, compte_id=compte.id, titre=titre, sens=sens, quantite=quantite,
            prix_unitaire=100.0, date_operation=date(2026, 1, 5),
        )
    routeur_titres = charger_module_extension("placements", "routeur_titres.py")
    detenus = {t.nom: t.detenu for t in routeur_titres.list_titres(db=db_session)}
    assert detenus == {"Gardée": True, "Soldée": False, "Jamais achetée": False}
