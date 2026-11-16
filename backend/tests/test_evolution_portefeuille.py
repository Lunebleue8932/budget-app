"""L'évolution du portefeuille dans le temps et l'historique des cours (migration 0102)."""
from datetime import date, datetime

import pytest

from app import crud, models
from app.constants import SensTitre
from app.services import evolution_portefeuille

from .conftest import charger_module_extension, creer_compte, get_monnaie_id

routeur_placements = charger_module_extension("placements", "routeur_placements.py")


def _compte(db, nom="PEA"):
    return creer_compte(db, nom, type_nom="placements financiers", solde_initial=100000.0)


def _achat(db, compte, titre, quantite, prix, jour):
    return crud.create_operation_titre(
        db,
        compte_id=compte.id,
        titre=titre,
        sens=SensTitre.achat,
        quantite=quantite,
        prix_unitaire=prix,
        date_operation=jour,
    )


def _vente(db, compte, titre, quantite, prix, jour):
    return crud.create_operation_titre(
        db,
        compte_id=compte.id,
        titre=titre,
        sens=SensTitre.vente,
        quantite=quantite,
        prix_unitaire=prix,
        date_operation=jour,
    )


def test_sans_historique_les_prix_des_mouvements_donnent_la_courbe(db_session):
    db = db_session
    compte = _compte(db)
    titre = crud.create_titre(db, "Air Liquide", get_monnaie_id(db), 0.0)
    _achat(db, compte, titre, 10, 100.0, date(2026, 7, 1))
    resultat = evolution_portefeuille.evolution(
        db, get_monnaie_id(db), "total", aujourdhui=date(2026, 7, 5)
    )
    assert resultat["dates"][0] == "2026-07-01"
    assert resultat["dates"][-1] == "2026-07-05"
    assert resultat["total"] == pytest.approx([1000.0] * 5)


def test_un_cours_de_l_historique_remplace_le_prix_du_mouvement_ce_jour_la(db_session):
    db = db_session
    compte = _compte(db)
    titre = crud.create_titre(db, "Air Liquide", get_monnaie_id(db), 0.0)
    _achat(db, compte, titre, 10, 100.0, date(2026, 7, 1))
    crud.enregistrer_historique_cours(
        db, titre.id, [(date(2026, 7, 3), 120.0), (date(2026, 7, 4), 130.0)]
    )
    resultat = evolution_portefeuille.evolution(
        db, get_monnaie_id(db), "total", aujourdhui=date(2026, 7, 5)
    )
    # 1er et 2 : prix d'achat ; 3 : 120 ; 4 et 5 : 130 (le dernier connu).
    assert resultat["total"] == pytest.approx([1000.0, 1000.0, 1200.0, 1300.0, 1300.0])


def test_le_dernier_point_est_la_valorisation_actuelle(db_session):
    db = db_session
    compte = _compte(db)
    titre = crud.create_titre(db, "Air Liquide", get_monnaie_id(db), 150.0)
    _achat(db, compte, titre, 4, 100.0, date(2026, 7, 1))
    aujourdhui = date(2026, 7, 10)
    resultat = evolution_portefeuille.evolution(db, get_monnaie_id(db), "total", aujourdhui=aujourdhui)
    attendu = sum(placements_valorisation(db).values())
    assert resultat["total"][-1] == pytest.approx(attendu)
    assert resultat["total"][-1] == pytest.approx(600.0)


def placements_valorisation(db):
    from app.services import placements

    return placements.valorisation_totale(db)


def test_une_vente_fait_baisser_la_courbe(db_session):
    db = db_session
    compte = _compte(db)
    titre = crud.create_titre(db, "Air Liquide", get_monnaie_id(db), 0.0)
    _achat(db, compte, titre, 10, 100.0, date(2026, 7, 1))
    _vente(db, compte, titre, 10, 110.0, date(2026, 7, 3))
    resultat = evolution_portefeuille.evolution(
        db, get_monnaie_id(db), "total", aujourdhui=date(2026, 7, 5)
    )
    assert resultat["total"] == pytest.approx([1000.0, 1000.0, 0.0, 0.0, 0.0])


def test_par_compte_une_serie_chacun(db_session):
    db = db_session
    pea = _compte(db, "PEA")
    cto = _compte(db, "CTO")
    titre = crud.create_titre(db, "Air Liquide", get_monnaie_id(db), 0.0)
    _achat(db, pea, titre, 10, 100.0, date(2026, 7, 1))
    _achat(db, cto, titre, 5, 100.0, date(2026, 7, 1))
    resultat = evolution_portefeuille.evolution(
        db, get_monnaie_id(db), "compte", aujourdhui=date(2026, 7, 2)
    )
    noms = {s["nom"]: s["valeurs"][-1] for s in resultat["series"]}
    assert noms == {"PEA": pytest.approx(1000.0), "CTO": pytest.approx(500.0)}
    assert resultat["total"][-1] == pytest.approx(1500.0)


def test_par_enveloppe_un_titre_sans_etiquette_est_non_renseigne(db_session):
    db = db_session
    compte = _compte(db)
    etf = models.TypeTitre(nom="ETF", axe="enveloppe")
    db.add(etf)
    db.commit()
    a = crud.create_titre(db, "A", get_monnaie_id(db), 0.0, type_titre_id=etf.id)
    b = crud.create_titre(db, "B", get_monnaie_id(db), 0.0)
    _achat(db, compte, a, 1, 300.0, date(2026, 7, 1))
    _achat(db, compte, b, 1, 100.0, date(2026, 7, 1))
    resultat = evolution_portefeuille.evolution(
        db, get_monnaie_id(db), "enveloppe", aujourdhui=date(2026, 7, 1)
    )
    par_nom = {s["nom"]: s["valeurs"][-1] for s in resultat["series"]}
    assert par_nom == {"ETF": pytest.approx(300.0), "Non renseigné": pytest.approx(100.0)}
    # Triées de la plus lourde à la plus légère.
    assert [s["nom"] for s in resultat["series"]] == ["ETF", "Non renseigné"]


def test_par_zone_une_repartition_se_distribue_au_prorata(db_session):
    db = db_session
    compte = _compte(db)
    usa = models.TypeTitre(nom="États-Unis", axe="zone")
    europe = models.TypeTitre(nom="Europe", axe="zone")
    db.add_all([usa, europe])
    db.commit()
    titre = crud.create_titre(db, "Monde", get_monnaie_id(db), 0.0)
    crud.poser_repartition(db, titre, "zone", [(usa.id, 65.0), (europe.id, 15.0)])
    db.commit()
    _achat(db, compte, titre, 10, 100.0, date(2026, 7, 1))
    resultat = evolution_portefeuille.evolution(
        db, get_monnaie_id(db), "zone", aujourdhui=date(2026, 7, 1)
    )
    par_nom = {s["nom"]: s["valeurs"][-1] for s in resultat["series"]}
    assert par_nom["États-Unis"] == pytest.approx(650.0)
    assert par_nom["Europe"] == pytest.approx(150.0)
    assert par_nom["Non renseigné"] == pytest.approx(200.0)


def test_la_grille_reste_bornee_et_finit_aujourdhui():
    jours = evolution_portefeuille._grille(date(2010, 1, 1), date(2026, 7, 1))
    assert len(jours) <= evolution_portefeuille.POINTS_MAX + 2
    assert jours[0] == date(2010, 1, 1) and jours[-1] == date(2026, 7, 1)


def test_un_cours_saisi_a_la_main_entre_dans_l_historique(db_session):
    db = db_session
    titre = crud.create_titre(db, "Air Liquide", get_monnaie_id(db), 100.0)
    crud.update_titre(db, titre, valeur=120.0)
    lignes = db.query(models.CoursTitre).filter_by(titre_id=titre.id).all()
    # Une seule ligne par jour : la saisie du jour remplace celle de la création.
    assert len(lignes) == 1
    assert lignes[0].valeur == 120.0 and lignes[0].source == "manuel"


def test_un_cours_relu_en_ligne_entre_dans_l_historique(db_session):
    db = db_session
    titre = crud.create_titre(db, "Air Liquide", get_monnaie_id(db), 0.0)
    crud.enregistrer_cours_en_ligne(db, titre, 142.5, datetime(2026, 7, 4, 10, 0))
    ligne = db.query(models.CoursTitre).filter_by(titre_id=titre.id).one()
    assert (ligne.date, ligne.valeur, ligne.source) == (date(2026, 7, 4), 142.5, "en_ligne")


def test_l_historique_ne_corrige_pas_un_cours_deja_vu(db_session):
    db = db_session
    titre = crud.create_titre(db, "Air Liquide", get_monnaie_id(db), 0.0)
    crud.enregistrer_cours_en_ligne(db, titre, 142.5, datetime(2026, 7, 4, 10, 0))
    ajoutes = crud.enregistrer_historique_cours(
        db, titre.id, [(date(2026, 7, 4), 1.0), (date(2026, 7, 3), 140.0)]
    )
    assert ajoutes == 1
    valeurs = {l.date: l.valeur for l in db.query(models.CoursTitre).filter_by(titre_id=titre.id)}
    assert valeurs == {date(2026, 7, 4): 142.5, date(2026, 7, 3): 140.0}


def test_la_route_evolution_n_est_pas_prise_pour_un_compte(db_session):
    db = db_session
    compte = _compte(db)
    titre = crud.create_titre(db, "Air Liquide", get_monnaie_id(db), 100.0)
    _achat(db, compte, titre, 2, 100.0, date(2026, 7, 1))
    reponse = routeur_placements.evolution_portefeuille(db=db)
    assert reponse["monnaie_id"] == get_monnaie_id(db)
    assert reponse["series"][0]["nom"] == "Portefeuille"
    assert [m["id"] for m in reponse["monnaies"]] == [get_monnaie_id(db)]
    chemins = [r.path for r in routeur_placements.router.routes]
    assert chemins.index("/placements/evolution") < chemins.index("/placements/{compte_id}")


def test_par_titre_une_serie_chacun_tous_comptes_confondus(db_session):
    db = db_session
    pea = _compte(db, "PEA")
    cto = _compte(db, "CTO")
    a = crud.create_titre(db, "Alpha", get_monnaie_id(db), 0.0)
    b = crud.create_titre(db, "Beta", get_monnaie_id(db), 0.0)
    _achat(db, pea, a, 10, 100.0, date(2026, 7, 1))
    _achat(db, cto, a, 5, 100.0, date(2026, 7, 1))
    _achat(db, cto, b, 2, 100.0, date(2026, 7, 1))
    resultat = evolution_portefeuille.evolution(
        db, get_monnaie_id(db), "titre", aujourdhui=date(2026, 7, 2)
    )
    par_nom = {s["nom"]: s["valeurs"][-1] for s in resultat["series"]}
    assert par_nom == {"Alpha": pytest.approx(1500.0), "Beta": pytest.approx(200.0)}
    assert {s["cle"] for s in resultat["series"]} == {a.id, b.id}


def test_la_performance_ignore_les_achats_et_les_ventes(db_session):
    db = db_session
    compte = _compte(db)
    titre = crud.create_titre(db, "Air Liquide", get_monnaie_id(db), 0.0)
    _achat(db, compte, titre, 10, 100.0, date(2026, 7, 1))
    # Le cours monte à 110 le 2 ; on rachète 10 titres le 3 (aucune variation de cours) ; le cours reste 110.
    crud.enregistrer_historique_cours(
        db, titre.id, [(date(2026, 7, 2), 110.0), (date(2026, 7, 3), 110.0), (date(2026, 7, 4), 110.0)]
    )
    _achat(db, compte, titre, 10, 110.0, date(2026, 7, 3))
    resultat = evolution_portefeuille.evolution(
        db, get_monnaie_id(db), "total", aujourdhui=date(2026, 7, 4)
    )
    # La valeur double presque (l'argent ajouté), la performance non : +100 € et +10 % seulement.
    assert resultat["total"][-1] == pytest.approx(2200.0)
    assert resultat["gain_cumule"][-1] == pytest.approx(100.0)
    assert resultat["rendement_cumule"][-1] == pytest.approx(0.10)
    assert resultat["series"][0]["gain_cumule"][-1] == pytest.approx(100.0)


def test_le_rendement_est_pondere_par_le_temps(db_session):
    db = db_session
    compte = _compte(db)
    titre = crud.create_titre(db, "Air Liquide", get_monnaie_id(db), 0.0)
    _achat(db, compte, titre, 10, 100.0, date(2026, 7, 1))
    # +10 % le 2 ; on double la position le 2 au soir ; -10 % le 4 : le rendement chaîne 1,10 × 0,90 - 1.
    crud.enregistrer_historique_cours(
        db, titre.id, [(date(2026, 7, 2), 110.0), (date(2026, 7, 3), 110.0), (date(2026, 7, 4), 99.0)]
    )
    _achat(db, compte, titre, 10, 110.0, date(2026, 7, 3))
    resultat = evolution_portefeuille.evolution(
        db, get_monnaie_id(db), "total", aujourdhui=date(2026, 7, 4)
    )
    assert resultat["rendement_cumule"][-1] == pytest.approx(1.10 * 0.90 - 1.0)
    # Gain en monnaie : +100 le 2, puis -11 × 20 = -220 le 4.
    assert resultat["gain_cumule"][-1] == pytest.approx(100.0 - 220.0)


def test_le_rendement_sur_investi_est_valeur_sur_cout_moins_un(db_session):
    db = db_session
    compte = _compte(db)
    titre = crud.create_titre(db, "Air Liquide", get_monnaie_id(db), 0.0)
    _achat(db, compte, titre, 10, 100.0, date(2026, 7, 1))
    crud.enregistrer_historique_cours(db, titre.id, [(date(2026, 7, 2), 120.0), (date(2026, 7, 3), 120.0)])
    # Un achat à 120 le 3 : le coût passe à 1 000 + 1 200 = 2 200, la valeur à 20 × 120 = 2 400.
    _achat(db, compte, titre, 10, 120.0, date(2026, 7, 3))
    resultat = evolution_portefeuille.evolution(
        db, get_monnaie_id(db), "total", aujourdhui=date(2026, 7, 3)
    )
    assert resultat["investi"] == pytest.approx([1000.0, 1000.0, 2200.0])
    assert resultat["rendement_investi"] == pytest.approx([0.0, 0.2, 2400.0 / 2200.0 - 1.0])
    assert resultat["series"][0]["rendement_investi"][-1] == pytest.approx(2400.0 / 2200.0 - 1.0)


def test_une_vente_sort_le_cout_dans_la_meme_proportion(db_session):
    db = db_session
    compte = _compte(db)
    titre = crud.create_titre(db, "Air Liquide", get_monnaie_id(db), 0.0)
    _achat(db, compte, titre, 10, 100.0, date(2026, 7, 1))
    crud.enregistrer_historique_cours(db, titre.id, [(date(2026, 7, 2), 150.0)])
    _vente(db, compte, titre, 5, 150.0, date(2026, 7, 2))
    resultat = evolution_portefeuille.evolution(
        db, get_monnaie_id(db), "total", aujourdhui=date(2026, 7, 2)
    )
    # Il reste 5 titres, au prix de revient de 100 : coût 500, valeur 750, +50 %.
    assert resultat["investi"][-1] == pytest.approx(500.0)
    assert resultat["rendement_investi"][-1] == pytest.approx(0.5)


def test_sans_rien_d_investi_le_rendement_est_nul_pas_un_zero(db_session):
    db = db_session
    compte = _compte(db)
    titre = crud.create_titre(db, "Air Liquide", get_monnaie_id(db), 0.0)
    _achat(db, compte, titre, 10, 100.0, date(2026, 7, 1))
    _vente(db, compte, titre, 10, 100.0, date(2026, 7, 2))
    resultat = evolution_portefeuille.evolution(
        db, get_monnaie_id(db), "total", aujourdhui=date(2026, 7, 3)
    )
    assert resultat["rendement_investi"][-1] is None


def test_un_titre_avec_une_seule_valeur_en_base_n_a_pas_d_historique(db_session):
    db = db_session
    compte = _compte(db)
    titre = crud.create_titre(db, "Air Liquide", get_monnaie_id(db), 150.0)  # un cours : celui de la création
    _achat(db, compte, titre, 10, 100.0, date(2026, 7, 1))
    resultat = evolution_portefeuille.evolution(
        db, get_monnaie_id(db), "titre", aujourdhui=date(2026, 7, 5)
    )
    assert resultat["historique"] is False
    assert resultat["series"][0]["historique"] is False
    # Un second cours en base (un autre jour) : il y a de quoi tracer.
    crud.enregistrer_historique_cours(db, titre.id, [(date(2026, 7, 3), 120.0)])
    resultat = evolution_portefeuille.evolution(
        db, get_monnaie_id(db), "titre", aujourdhui=date(2026, 7, 5)
    )
    assert resultat["historique"] is True
    assert resultat["series"][0]["historique"] is True


# ---------- LES ACHATS ET VENTES MARQUÉS SUR LA COURBE ----------


def _scenario_achats(db):
    compte = _compte(db)
    titre = crud.create_titre(db, "Air Liquide", get_monnaie_id(db), 0.0)
    _achat(db, compte, titre, 10, 100.0, date(2026, 7, 1))
    crud.enregistrer_historique_cours(
        db, titre.id, [(date(2026, 7, 2), 110.0), (date(2026, 7, 3), 110.0), (date(2026, 7, 4), 121.0)]
    )
    _achat(db, compte, titre, 10, 110.0, date(2026, 7, 3))
    return compte, titre


def test_un_achat_est_marque_avec_son_montant_et_son_effet(db_session):
    db = db_session
    _scenario_achats(db)
    resultat = evolution_portefeuille.evolution(
        db, get_monnaie_id(db), "total", aujourdhui=date(2026, 7, 4)
    )
    evenements = {e["date"]: e for e in resultat["evenements"]}
    assert set(evenements) == {"2026-07-01", "2026-07-03"}
    second = evenements["2026-07-03"]
    assert second["achats"] == pytest.approx(1100.0) and second["ventes"] == 0.0
    assert [ligne["quantite"] for ligne in second["lignes"]] == [10]
    # Valeur avant (10 titres à 110) 1 100 ; après (20 à 110) 2 200 : l'achat ajoute 1 100, soit +100 %.
    assert second["effet_valeur"] == pytest.approx(1100.0)
    assert second["effet_pct_valeur"] == pytest.approx(1.0)
    # Le rang désigne bien l'étape de la grille.
    assert resultat["dates"][second["rang"]] == "2026-07-03"


def test_le_pourcentage_investi_isole_l_effet_du_mouvement(db_session):
    db = db_session
    _scenario_achats(db)
    resultat = evolution_portefeuille.evolution(
        db, get_monnaie_id(db), "titre", aujourdhui=date(2026, 7, 4)
    )
    serie = resultat["series"][0]
    evenements = {e["date"]: e for e in serie["evenements"]}
    # Au 3 juillet, le cours du jour est 110 : avant l'achat valeur 1 100 / investi 1 000 (+10 %) ; après 2 200 /
    # 2 100 (+4,76 %) — l'achat, fait au cours du marché, a dilué la plus-value latente de 5,24 points.
    assert evenements["2026-07-03"]["pct_investi"] == pytest.approx(2200 / 2100 - 1 - 0.10)
    # Le premier achat n'a pas de « avant » : rien à comparer.
    assert evenements["2026-07-01"]["pct_investi"] is None


def test_une_vente_est_marquee_et_sort_le_montant_vendu(db_session):
    db = db_session
    compte, titre = _scenario_achats(db)
    _vente(db, compte, titre, 5, 120.0, date(2026, 7, 4))
    resultat = evolution_portefeuille.evolution(
        db, get_monnaie_id(db), "total", aujourdhui=date(2026, 7, 4)
    )
    evenement = [e for e in resultat["evenements"] if e["date"] == "2026-07-04"][0]
    assert evenement["ventes"] == pytest.approx(600.0) and evenement["achats"] == 0.0
    assert evenement["lignes"][0]["sens"] == "vente"


def test_une_ligne_partiellement_allouee_porte_sa_part_et_son_montant_alloue(db_session):
    db = db_session
    compte = _compte(db)
    titre = crud.create_titre(db, "ETF Monde", get_monnaie_id(db), 0.0)
    _achat(db, compte, titre, 10, 100.0, date(2026, 7, 1))
    # La répartition (60 % / 40 %) est celle du titre ; on la simule sur l'axe zone.
    from app.services import exposition

    d = exposition
    original = d.parts_du_titre
    try:
        d.parts_du_titre = lambda *a, **k: [(None, 0.4)]
        resultat = evolution_portefeuille.evolution(
            db, get_monnaie_id(db), "zone", aujourdhui=date(2026, 7, 3)
        )
    finally:
        d.parts_du_titre = original
    evenement = resultat["series"][0]["evenements"][0]
    assert evenement["achats_total"] == pytest.approx(1000.0)
    assert evenement["achats"] == pytest.approx(400.0)
    ligne = evenement["lignes"][0]
    assert ligne["part"] == pytest.approx(0.4) and ligne["montant_alloue"] == pytest.approx(400.0)
    # Le total du portefeuille, lui, garde le montant entier.
    assert resultat["evenements"][0]["achats"] == pytest.approx(1000.0)
