"""Le salaire de fin de mois vit le mois suivant, et la courbe du « reste » porte deux estimations.

CE QUE CES TESTS VERROUILLENT :

  - PAR DÉFAUT RIEN NE CHANGE : sans réglage, un salaire du 28 entre dans le reste du mois, comme
    avant ;
  - AVEC LE RÉGLAGE, une entrée PRÉVUE à partir du jour de coupure, dans le dernier mois de la
    période, sort du reste (entrée prévue, reste libre, point bas, courbe) et se retrouve dans
    `entrees_reportees` ; une entrée avant la coupure, ou un virement, reste comptée ;
  - LE RYTHME SÛR NE CHANGE PAS : jusqu'à son arrivée on vit sur ce qu'on a, le salaire reste donc
    la « prochaine entrée » ;
  - LA COURBE porte `prevision` (le projeté moins la dépense moyenne par jour, celle de la
    prévision avancée de la page Budget) et `rythme` (le projeté moins le rythme sûr arrondi à
    l'entier inférieur, jusqu'à la veille de la prochaine entrée).
"""
from datetime import date, timedelta

import pytest

from app import crud
from app.constants import Sens, Statut
from app.services import moyenne_depenses, soldes

from .conftest import creer_compte, get_monnaie_id
from .test_reste_periode import AUJOURDHUI, FIN_NOVEMBRE, _op, _prevue, _reste, _salaire


@pytest.fixture()
def courant(db_session):
    return creer_compte(db_session, "Courant", "courant", solde_initial=1000.0)


def _regler(db, actif=True, jour=25):
    crud.set_preference_interface(db, soldes.CLE_DECOUPAGE_SALAIRE, {"actif": actif, "jour": jour})


def test_par_defaut_le_salaire_de_fin_de_mois_compte(db_session, courant):
    _salaire(db_session, courant, date(2026, 11, 28), 1900.0)
    reste = _reste(db_session)
    assert soldes.lire_decoupage_salaire(db_session) is None
    assert reste["entrees_prevues"] == pytest.approx(1900.0)
    assert reste["entrees_reportees"] == 0.0
    assert reste["reste_libre"] == pytest.approx(2900.0)


def test_le_reglage_ecarte_le_salaire_du_reste(db_session, courant):
    _salaire(db_session, courant, date(2026, 11, 28), 1900.0)
    _regler(db_session)
    reste = _reste(db_session)
    assert soldes.lire_decoupage_salaire(db_session) == 25
    assert reste["entrees_prevues"] == 0.0
    assert reste["entrees_reportees"] == pytest.approx(1900.0)
    assert reste["reste_libre"] == pytest.approx(1000.0)


def test_un_reglage_eteint_ne_change_rien(db_session, courant):
    _salaire(db_session, courant, date(2026, 11, 28), 1900.0)
    _regler(db_session, actif=False)
    assert _reste(db_session)["reste_libre"] == pytest.approx(2900.0)


def test_une_entree_avant_la_coupure_reste_comptee(db_session, courant):
    _salaire(db_session, courant, date(2026, 11, 20), 300.0)
    _regler(db_session, jour=25)
    reste = _reste(db_session)
    assert reste["entrees_prevues"] == pytest.approx(300.0)
    assert reste["entrees_reportees"] == 0.0


def test_la_coupure_se_regle_au_jour_pres(db_session, courant):
    _salaire(db_session, courant, date(2026, 11, 20), 300.0)
    _regler(db_session, jour=20)
    assert _reste(db_session)["entrees_reportees"] == pytest.approx(300.0)


def test_une_depense_tardive_n_est_jamais_reportee(db_session, courant):
    _prevue(db_session, courant, date(2026, 11, 29), 400.0)
    _regler(db_session)
    reste = _reste(db_session)
    assert reste["sorties_prevues"] == pytest.approx(400.0)
    assert reste["entrees_reportees"] == 0.0


def test_le_point_bas_ignore_le_salaire_reporte(db_session, courant):
    # Une dépense le 29 : avec le salaire du 28 le solde remonte avant, sans lui il descend plus bas.
    _salaire(db_session, courant, date(2026, 11, 28), 1900.0)
    _prevue(db_session, courant, date(2026, 11, 29), 1500.0)
    sans = _reste(db_session)["point_bas"]["montant"]
    _regler(db_session)
    avec = _reste(db_session)["point_bas"]["montant"]
    assert sans == pytest.approx(1000.0)
    assert avec == pytest.approx(-500.0)


def test_le_rythme_sur_garde_le_salaire_comme_prochaine_entree(db_session, courant):
    _prevue(db_session, courant, date(2026, 11, 20), 340.0)
    _salaire(db_session, courant, date(2026, 11, 28), 1900.0)
    avant = _reste(db_session)
    _regler(db_session)
    apres = _reste(db_session)
    assert apres["prochaine_entree"]["date"] == date(2026, 11, 28)
    assert apres["rythme_sur"] == pytest.approx(avant["rythme_sur"])
    assert apres["rythme_jours"] == avant["rythme_jours"]


def test_en_vue_annee_seul_le_dernier_mois_est_reporte(db_session, courant):
    _salaire(db_session, courant, date(2026, 11, 28), 1900.0)
    _salaire(db_session, courant, date(2026, 12, 28), 1900.0)
    _regler(db_session)
    reste = soldes.reste_periode(
        db_session, {get_monnaie_id(db_session): 1.0}, date(2026, 12, 31), AUJOURDHUI
    )
    assert reste["entrees_prevues"] == pytest.approx(1900.0)  # celui de novembre
    assert reste["entrees_reportees"] == pytest.approx(1900.0)  # celui de décembre


# ---------- La courbe : prévision et rythme sûr ----------


def _courbe(db, vue="mois"):
    return soldes.courbe_reste(db, {get_monnaie_id(db): 1.0}, vue, AUJOURDHUI)


def test_la_courbe_porte_la_prevision_et_le_rythme(db_session, courant):
    _prevue(db_session, courant, date(2026, 11, 20), 340.0)
    courbe = _courbe(db_session)
    assert courbe["prevision"][0]["date"] == AUJOURDHUI
    assert courbe["prevision"][-1]["date"] == FIN_NOVEMBRE
    assert len(courbe["prevision"]) == (FIN_NOVEMBRE - AUJOURDHUI).days + 1
    assert courbe["rythme"][0]["date"] == AUJOURDHUI


def test_sans_depense_passee_la_prevision_suit_le_projete(db_session, courant):
    _prevue(db_session, courant, date(2026, 11, 20), 340.0)
    courbe = _courbe(db_session)
    assert courbe["prevision"][-1]["solde"] == pytest.approx(660.0)


def test_la_prevision_retranche_la_depense_moyenne(db_session, courant):
    # 300 € dépensés sur les 15 jours que couvre l'historique (du 31 octobre à aujourd'hui) : 20 €/jour.
    _op(db_session, courant, AUJOURDHUI - timedelta(days=14), 300.0)
    moyenne = moyenne_depenses.moyenne_depenses(db_session, get_monnaie_id(db_session), AUJOURDHUI)
    assert moyenne["par_jour"] > 0
    courbe = _courbe(db_session)
    jours = (FIN_NOVEMBRE - AUJOURDHUI).days
    depart = courbe["prevision"][0]["solde"]
    assert courbe["prevision"][-1]["solde"] == pytest.approx(depart - moyenne["par_jour"] * jours)


def test_le_rythme_est_arrondi_a_l_entier_inferieur_et_touche_presque_zero(db_session, courant):
    _prevue(db_session, courant, date(2026, 11, 20), 340.0)
    _salaire(db_session, courant, date(2026, 11, 25), 1900.0)
    reste = _reste(db_session)
    courbe = _courbe(db_session)
    rythme = int(reste["rythme_sur"])  # 660 / 11 = 60
    assert rythme == 60
    # Dernier jour tracé : la veille du salaire ; il a perdu `rythme` par jour depuis aujourd'hui.
    dernier = courbe["rythme"][-1]
    assert dernier["date"] == date(2026, 11, 24)
    attendu = 1000.0 - 340.0 - rythme * (dernier["date"] - AUJOURDHUI).days
    assert dernier["solde"] == pytest.approx(attendu)
    assert dernier["solde"] >= 0


def test_sans_rythme_pas_de_courbe_de_rythme(db_session, courant):
    _prevue(db_session, courant, date(2026, 11, 20), 5000.0)  # sous zéro : rythme 0, alerte
    assert _courbe(db_session)["rythme"] == []


def test_la_courbe_ecarte_aussi_le_salaire_reporte(db_session, courant):
    _salaire(db_session, courant, date(2026, 11, 28), 1900.0)
    _regler(db_session)
    courbe = _courbe(db_session)
    assert courbe["projetes"] == []
    assert courbe["prevision"][-1]["solde"] == pytest.approx(1000.0)


# ---------- Les dépenses déjà faites, pour la barre de reste à vivre ----------


def test_les_sorties_reelles_sont_celles_du_debut_de_la_periode_a_aujourd_hui(db_session, courant):
    _op(db_session, courant, date(2026, 10, 30), 80.0)  # le mois d'avant : hors période
    _op(db_session, courant, date(2026, 11, 3), 120.0)
    _op(db_session, courant, date(2026, 11, 10), 30.0)
    _op(db_session, courant, date(2026, 11, 5), 999.0, sens=Sens.entree)  # une entrée n'est pas une sortie
    _prevue(db_session, courant, date(2026, 11, 20), 500.0)  # prévue : pas encore sortie
    reste = _reste(db_session)
    assert reste["sorties_reelles"] == pytest.approx(150.0)
    assert reste["sorties_prevues"] == pytest.approx(500.0)


def test_les_depenses_de_la_periode_suivent_le_mois_du_reglage(db_session, courant):
    """Le début de la période du reste est celui du MOIS du réglage : du 25 octobre au 24 novembre en
    mois salarial (coupure le 25), et non du 1er novembre. Une dépense du 28 octobre y compte."""
    _op(db_session, courant, date(2026, 11, 3), 120.0)
    _op(db_session, courant, date(2026, 10, 28), 30.0)
    assert _reste(db_session)["sorties_reelles"] == pytest.approx(120.0)  # calendaire : novembre seul
    _regler(db_session, jour=25)
    horizon = soldes.horizon_reste("mois", AUJOURDHUI, 25)
    assert horizon == date(2026, 11, 24)
    assert _reste(db_session, horizon=horizon)["sorties_reelles"] == pytest.approx(150.0)


def test_en_vue_annee_les_depenses_remontent_au_premier_janvier(db_session, courant):
    _op(db_session, courant, date(2026, 2, 1), 70.0)
    _op(db_session, courant, date(2026, 11, 3), 120.0)
    monnaie = {get_monnaie_id(db_session): 1.0}
    debut = soldes.debut_reste("annee", AUJOURDHUI)
    assert debut == date(2026, 1, 1)
    reste = soldes.reste_periode(db_session, monnaie, date(2026, 12, 31), AUJOURDHUI, debut=debut)
    assert reste["sorties_reelles"] == pytest.approx(190.0)


# ---------- La plage de la prévision : la moyenne et son écart-type ----------


def test_l_ecart_type_vient_de_la_variabilite_des_depenses_par_jour(db_session, courant):
    # 14 jours d'historique : 100 € un jour sur deux, rien l'autre → moyenne 50, écart-type > 0.
    for i in range(0, 14, 2):
        _op(db_session, courant, AUJOURDHUI - timedelta(days=13 - i), 100.0)
    m = moyenne_depenses.moyenne_depenses(db_session, get_monnaie_id(db_session), AUJOURDHUI)
    assert m["par_jour"] == pytest.approx(50.0)
    # Échantillon de 14 valeurs : sept de 100, sept de 0 → σ = 50·√(14/13).
    assert m["ecart_type_jour"] == pytest.approx(50.0 * (14 / 13) ** 0.5)
    assert m["ecart_type_semaine"] > 0


def test_des_depenses_regulieres_n_ont_pas_d_ecart_type(db_session, courant):
    for i in range(14):
        _op(db_session, courant, AUJOURDHUI - timedelta(days=13 - i), 10.0)
    m = moyenne_depenses.moyenne_depenses(db_session, get_monnaie_id(db_session), AUJOURDHUI)
    assert m["ecart_type_jour"] == pytest.approx(0.0)


def test_sans_historique_pas_de_plage(db_session, courant):
    courbe = _courbe(db_session)
    assert all(p["ecart"] == 0.0 for p in courbe["prevision"])
    assert courbe["estimation"]["ecart_type_jour"] == 0.0


def test_la_plage_s_elargit_comme_sigma_racine_de_k(db_session, courant):
    for i in range(0, 14, 2):
        _op(db_session, courant, AUJOURDHUI - timedelta(days=13 - i), 100.0)
    courbe = _courbe(db_session)
    sigma = courbe["estimation"]["ecart_type_jour"]
    assert sigma > 0
    futur = [p for p in courbe["prevision"] if p["date"] >= AUJOURDHUI]
    # Au jour k (k jours après ce soir) : ± σ·√k, et rien ce soir même.
    for k, p in enumerate(futur):
        assert p["ecart"] == pytest.approx(sigma * k**0.5)
    assert courbe["estimation"]["moyenne_jour"] == pytest.approx(50.0)
    assert courbe["estimation"]["jours"] == 14


# ---------- La page Prévisions : le reste à vivre et de quoi planifier ----------


def _depenses_irregulieres(db, courant):
    for i in range(0, 14, 2):
        _op(db, courant, AUJOURDHUI - timedelta(days=13 - i), 100.0)


def test_la_page_previsions_rend_les_memes_chiffres_que_le_dashboard(db_session, courant):
    from .test_solde_previsionnel import service as service_solde

    _depenses_irregulieres(db_session, courant)
    _salaire(db_session, courant, date(2026, 11, 28), 1900.0)
    page = service_solde.reste_a_vivre(db_session, get_monnaie_id(db_session), "mois", AUJOURDHUI)
    monnaie = {get_monnaie_id(db_session): 1.0}
    dashboard = soldes.reste_periode(
        db_session, monnaie, soldes.horizon_reste("mois", AUJOURDHUI), AUJOURDHUI,
        debut=soldes.debut_reste("mois", AUJOURDHUI),
    )
    assert page["reste"]["reste_libre"] == pytest.approx(dashboard["reste_libre"])
    assert page["reste"]["rythme_sur"] == pytest.approx(dashboard["rythme_sur"])
    assert page["courbe"]["estimation"]["ecart_type_jour"] > 0


def test_la_planification_lit_la_plage_de_la_prevision(db_session, courant):
    from .test_solde_previsionnel import service as service_solde

    _depenses_irregulieres(db_session, courant)
    page = service_solde.reste_a_vivre(db_session, get_monnaie_id(db_session), "mois", AUJOURDHUI)
    plan = page["planification"]
    prevision = [p for p in page["courbe"]["prevision"] if p["date"] >= AUJOURDHUI]
    dernier = prevision[-1]
    # La fin de la période : le solde de la prévision, et sa plage ± σ·√k.
    assert plan["solde_fin"] == pytest.approx(dernier["solde"])
    assert plan["solde_fin_bas"] == pytest.approx(dernier["solde"] - dernier["ecart"])
    assert plan["solde_fin_haut"] == pytest.approx(dernier["solde"] + dernier["ecart"])
    # Le point bas pessimiste ne peut pas être plus haut que celui de la prévision.
    assert plan["point_bas_pessimiste"]["montant"] <= plan["point_bas_prevision"]["montant"]
    assert plan["moyenne_jour"] == pytest.approx(50.0)
    # Marge : le rythme sûr moins la dépense moyenne.
    assert plan["marge_rythme"] == pytest.approx(page["reste"]["rythme_sur"] - 50.0)


def test_le_passage_sous_zero_vient_plus_tot_dans_le_scenario_pessimiste(db_session):
    from .test_solde_previsionnel import service as service_solde

    compte = creer_compte(db_session, "Courant", "courant", solde_initial=400.0)
    _depenses_irregulieres(db_session, compte)
    page = service_solde.reste_a_vivre(db_session, get_monnaie_id(db_session), "mois", AUJOURDHUI)
    plan = page["planification"]
    assert plan["sous_zero_prevision"] is not None
    assert plan["sous_zero_pessimiste"] is not None
    assert plan["sous_zero_pessimiste"] <= plan["sous_zero_prevision"]


def test_les_points_de_la_courbe_du_solde_previsionnel_portent_la_plage(db_session, courant):
    from .test_solde_previsionnel import service as service_solde

    _depenses_irregulieres(db_session, courant)
    courbe = service_solde.solde_previsionnel(
        db_session, get_monnaie_id(db_session), AUJOURDHUI, AUJOURDHUI + timedelta(days=10), avancee=True
    )
    sigma = courbe["moyenne"]["ecart_type_jour"]
    assert sigma > 0
    futurs = [p for p in courbe["points"] if not p["passe"]]
    for k, p in enumerate(futurs, start=1):
        assert p["ecart"] == pytest.approx(sigma * k**0.5)
    assert all(p["ecart"] is None for p in courbe["points"] if p["passe"])
    sans = service_solde.solde_previsionnel(
        db_session, get_monnaie_id(db_session), AUJOURDHUI, AUJOURDHUI + timedelta(days=10)
    )
    assert all(p["ecart"] is None for p in sans["points"])


def test_par_defaut_la_coupure_est_le_dernier_jour_du_mois(db_session, courant):
    # Réglage allumé SANS jour : 31 = le dernier jour du mois (le 30 en novembre).
    crud.set_preference_interface(db_session, soldes.CLE_DECOUPAGE_SALAIRE, {"actif": True})
    assert soldes.lire_decoupage_salaire(db_session) == 31
    _salaire(db_session, courant, date(2026, 11, 30), 1900.0)
    _salaire(db_session, courant, date(2026, 11, 29), 300.0)
    reste = _reste(db_session)
    # Le salaire du 30 finance le mois suivant ; celui du 29, non.
    assert reste["entrees_reportees"] == pytest.approx(1900.0)
    assert reste["entrees_prevues"] == pytest.approx(300.0)


def test_le_point_bas_tient_compte_de_la_depense_moyenne(db_session, courant):
    # Aucune prévisionnelle à venir : sans dépense moyenne, le point bas serait le solde actuel.
    sans = _reste(db_session)
    assert sans["point_bas"]["montant"] == pytest.approx(sans["solde_actuel"])
    _depenses_irregulieres(db_session, courant)
    avec = _reste(db_session)
    # 50 €/jour en moyenne jusqu'à l'horizon : le point bas descend sous le solde, au dernier jour.
    jours = (FIN_NOVEMBRE - AUJOURDHUI).days
    assert avec["point_bas"]["montant"] == pytest.approx(avec["solde_actuel"] - 50.0 * jours)
    assert avec["point_bas"]["date_fin"] == FIN_NOVEMBRE
    # Le rythme sûr, lui, reste calculé sur le projeté (il ne double pas la dépense moyenne) : le solde
    # projeté n'ayant pas de prévisionnelle, il vaut le solde actuel réparti sur les jours qui restent.
    assert avec["rythme_sur"] == pytest.approx(avec["solde_actuel"] / (FIN_NOVEMBRE - AUJOURDHUI).days)


# ---------- Le mois salarial : la période du reste suit le salaire ----------


def test_le_mois_salarial_va_de_la_coupure_a_sa_veille():
    assert soldes.periode_salariale(date(2026, 11, 14), 25) == (date(2026, 10, 25), date(2026, 11, 24))
    assert soldes.periode_salariale(date(2026, 11, 25), 25) == (date(2026, 11, 25), date(2026, 12, 24))
    # Autour du 1er janvier.
    assert soldes.periode_salariale(date(2027, 1, 5), 25) == (date(2026, 12, 25), date(2027, 1, 24))
    assert soldes.periode_salariale(date(2026, 12, 28), 25) == (date(2026, 12, 25), date(2027, 1, 24))
    # 31 = le dernier jour du mois, quelle que soit sa longueur.
    assert soldes.periode_salariale(date(2026, 11, 14), 31) == (date(2026, 10, 31), date(2026, 11, 29))
    assert soldes.periode_salariale(date(2027, 3, 10), 31) == (date(2027, 2, 28), date(2027, 3, 30))


def test_l_horizon_du_reste_suit_le_type_de_mois(db_session, courant):
    # Mois du calendrier : la fin du mois.
    assert soldes.horizon_reste("mois", AUJOURDHUI) == FIN_NOVEMBRE
    assert soldes.debut_reste("mois", AUJOURDHUI) == date(2026, 11, 1)
    # Mois salarial : la veille de la coupure.
    assert soldes.horizon_reste("mois", AUJOURDHUI, 25) == date(2026, 11, 24)
    assert soldes.debut_reste("mois", AUJOURDHUI, 25) == date(2026, 10, 25)
    # La vue « année » ne bouge pas.
    assert soldes.horizon_reste("annee", AUJOURDHUI, 25) == date(2026, 12, 31)
    # Et la courbe, de bout en bout, finit à l'horizon salarial quand le réglage est allumé.
    _regler(db_session, jour=25)
    monnaie = {get_monnaie_id(db_session): 1.0}
    courbe = soldes.courbe_reste(db_session, monnaie, "mois", AUJOURDHUI)
    assert courbe["horizon"] == date(2026, 11, 24)
    assert courbe["reels"][0]["date"] == date(2026, 10, 25)


def test_le_projete_du_dashboard_suit_le_mois_salarial(db_session, courant):
    """« Projeté au … » : l'étiquette porte la fin du mois SALARIAL, le chiffre doit y être borné aussi —
    et non à la fin du mois calendaire."""
    from app.routers import dashboard as routeur_dashboard

    aujourdhui = date.today()
    jour = min(max(aujourdhui.day, 2), 28)
    _regler(db_session, jour=jour)
    horizon = soldes.horizon_reste("mois", aujourdhui, jour)
    fin_calendaire = soldes.fin_de_periode(aujourdhui.year, aujourdhui.month)
    # Une dépense prévue le dernier jour du mois salarial.
    _prevue(db_session, courant, max(horizon, aujourdhui + timedelta(days=1)), 100.0)

    kpi = routeur_dashboard.get_dashboard(annee=None, mois=None, vue="mois", db=db_session).kpis[0]
    assert kpi.reste.horizon == horizon
    attendu = _projete_dashboard_a(db_session, horizon)
    assert kpi.solde_projete_courant == pytest.approx(attendu)
    if horizon > fin_calendaire:
        # Le mois salarial déborde sur le suivant : le calendaire n'aurait pas compté la dépense.
        assert kpi.solde_projete_courant != pytest.approx(_projete_dashboard_a(db_session, fin_calendaire))


def _projete_dashboard_a(db, fin):
    totaux = soldes.calculer_totaux_par_monnaie(
        soldes.get_soldes_comptes(db, date_fin=fin), valorisation_placements={}
    )
    return totaux[get_monnaie_id(db)]["solde_projete_courant"]


# ---------- Le seuil de sécurité et le projeté avec la dépense moyenne ----------


def test_le_rythme_sur_se_calcule_sur_le_seuil_de_securite(db_session, courant):
    _prevue(db_session, courant, date(2026, 11, 20), 200.0)
    sans_seuil = _reste(db_session)
    assert sans_seuil["rythme_sur"] == pytest.approx(800.0 / 16)
    crud.set_preference_interface(db_session, soldes.CLE_SEUIL_SECURITE, 400)
    avec_seuil = _reste(db_session)
    assert avec_seuil["rythme_sur"] == pytest.approx(400.0 / 16)
    assert not avec_seuil["alerte"]


def test_sous_le_seuil_le_rythme_est_nul_et_l_alerte_levee(db_session, courant):
    _prevue(db_session, courant, date(2026, 11, 20), 200.0)
    crud.set_preference_interface(db_session, soldes.CLE_SEUIL_SECURITE, 900)
    reste = _reste(db_session)
    assert reste["rythme_sur"] == 0.0
    assert reste["alerte"]


def test_un_seuil_negatif_vaut_zero(db_session, courant):
    crud.set_preference_interface(db_session, soldes.CLE_SEUIL_SECURITE, -300)
    assert soldes.lire_seuil_securite(db_session) == 0.0
    crud.set_preference_interface(db_session, soldes.CLE_SEUIL_SECURITE, "abc")
    assert soldes.lire_seuil_securite(db_session) == 0.0


def test_le_projete_du_dashboard_ignore_la_depense_moyenne_par_defaut(db_session, courant, monkeypatch):
    from app.routers import dashboard as routeur_dashboard

    monkeypatch.setattr(
        routeur_dashboard.moyenne_depenses,
        "estimation_depenses",
        lambda db, coefficients, aujourdhui, horizon: {"cumul": {horizon: 123.0}, "ecart": {}},
    )
    base = routeur_dashboard.get_dashboard(annee=None, mois=None, vue="mois", db=db_session).kpis[0]
    assert base.solde_projete_courant == pytest.approx(1000.0)

    crud.set_preference_interface(db_session, soldes.CLE_PROJETE_DEPENSE_MOYENNE, True)
    avec = routeur_dashboard.get_dashboard(annee=None, mois=None, vue="mois", db=db_session).kpis[0]
    fin = soldes.fin_de_periode(date.today().year, date.today().month)
    if fin > date.today():
        assert avec.solde_projete_courant == pytest.approx(1000.0 - 123.0)
    else:  # le dernier jour du mois : rien à venir à retrancher
        assert avec.solde_projete_courant == pytest.approx(1000.0)


# ---------- Le mois salarial partout (un seul réglage pour tout) ----------


@pytest.mark.parametrize("jour", [1, 10, 15, 16, 25, 28, 31])
def test_les_mois_salariaux_se_suivent_sans_trou_ni_chevauchement(jour):
    precedent_fin = None
    for annee, mois in [(2025, m) for m in range(1, 13)] + [(2026, m) for m in range(1, 13)]:
        debut, fin = soldes.bornes_periode(annee, mois, jour)
        assert debut <= fin
        if precedent_fin is not None:
            assert debut == precedent_fin + timedelta(days=1), (annee, mois, jour)
        precedent_fin = fin
        # Le mois qui contient un jour de la période est bien celui-là.
        assert soldes.mois_de(debut, jour) == (annee, mois)
        assert soldes.mois_de(fin, jour) == (annee, mois)


def test_la_coupure_au_dernier_jour_fait_de_novembre_le_31_octobre_au_29_novembre():
    assert soldes.bornes_periode(2026, 11, 31) == (date(2026, 10, 31), date(2026, 11, 29))
    assert soldes.bornes_periode(2026, 12, 31) == (date(2026, 11, 30), date(2026, 12, 30))
    assert soldes.mois_de(date(2026, 11, 30), 31) == (2026, 12)
    # Sans réglage : le calendrier.
    assert soldes.bornes_periode(2026, 11, jour_salaire=None) == (date(2026, 11, 1), date(2026, 11, 30))


def _depense_reelle(db, compte, jour, montant):
    return _op(db, compte, jour, montant)


def test_en_mois_salarial_une_depense_de_fin_de_mois_compte_pour_le_mois_suivant(db_session, courant):
    db = db_session
    monnaie = get_monnaie_id(db)
    _depense_reelle(db, courant, date(2026, 10, 31), 40.0)  # dernier jour d'octobre
    _depense_reelle(db, courant, date(2026, 11, 10), 10.0)

    # Calendaire : octobre 40, novembre 10.
    assert soldes.get_flux_periode(db, 2026, 10, monnaie)["sorties"] == pytest.approx(40.0)
    assert soldes.get_flux_periode(db, 2026, 11, monnaie)["sorties"] == pytest.approx(10.0)

    # Salarial (coupure le dernier jour) : le 31 octobre ouvre novembre.
    _regler(db, jour=31)
    assert soldes.jour_salaire_partage() == 31
    assert soldes.get_flux_periode(db, 2026, 10, monnaie)["sorties"] == pytest.approx(0.0)
    assert soldes.get_flux_periode(db, 2026, 11, monnaie)["sorties"] == pytest.approx(50.0)
    par_categorie = soldes.get_depenses_par_categorie(db, 2026, 11, monnaie)
    assert sum(c["total_reel"] for c in par_categorie) == pytest.approx(50.0)

    # Et on revient au calendrier en éteignant le réglage.
    _regler(db, actif=False)
    assert soldes.jour_salaire_partage() is None
    assert soldes.get_flux_periode(db, 2026, 11, monnaie)["sorties"] == pytest.approx(10.0)


def test_en_mois_salarial_l_annee_est_la_suite_de_ses_douze_mois(db_session, courant):
    db = db_session
    monnaie = get_monnaie_id(db)
    _depense_reelle(db, courant, date(2025, 12, 31), 7.0)  # ouvre janvier 2026
    _depense_reelle(db, courant, date(2026, 12, 31), 3.0)  # ouvre janvier 2027
    _regler(db, jour=31)
    assert soldes.get_flux_periode(db, 2026, None, monnaie)["sorties"] == pytest.approx(7.0)


def test_le_mois_en_cours_suit_le_reglage():
    assert soldes.mois_de(date(2026, 11, 29), 31) == (2026, 11)
    assert soldes.mois_de(date(2026, 11, 30), 31) == (2026, 12)
    assert soldes.mois_de(date(2026, 11, 30), None) == (2026, 11)
