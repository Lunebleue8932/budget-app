"""« Tout » : la vue qui recouvre toute l'histoire, et la moyenne hebdomadaire
qui suit le niveau du dashboard.

CE QUE CES TESTS VERROUILLENT :

  - « TOUT » EST LA SOMME DES VUES ANNUELLES. Les KPI, le détail par catégorie,
    le budget et l'écart des variations de `/dashboard?vue=tout` valent, au
    centime, la somme de ce que rend chaque année prise seule. Rien n'a été
    recalculé : c'est ce qui garantit que les chiffres d'« Tout » racontent la
    même histoire que les années qu'il recouvre ;
  - LA MOYENNE HEBDOMADAIRE PREND LA FENÊTRE DU NIVEAU : le mois, l'année, ou
    tout l'historique. Le mois et l'année rendent exactement ce que rendaient
    les deux anciennes routes ;
  - « TOUT » COMMENCE À LA PREMIÈRE SEMAINE OÙ L'ON A DÉPENSÉ, comme la moyenne
    d'une année : une application commencée tard ne voit pas sa moyenne écrasée
    par des années vides.
"""
import importlib.util
import pathlib
import sys
from datetime import date

import pytest

from app import crud, models, schemas
from app.constants import Statut
from app.routers import dashboard as routeur
from app.services import periode_tout, soldes

from .conftest import creer_compte, get_categorie_id, get_monnaie_id, get_type_id


def _depense(db, compte, nature, montant, jour, categorie="Alimentaire", **kwargs):
    defaults = dict(
        date=jour,
        compte_id=compte.id,
        monnaie_id=get_monnaie_id(db),
        type_id=get_type_id(db, "classique"),
        categorie_id=get_categorie_id(db, categorie),
        nature=nature,
        montant=montant,
        statut=Statut.reel,
    )
    defaults.update(kwargs)
    return crud.create_operation(db, schemas.OperationCreate(**defaults))


def _kpi(db, **kw):
    lu = routeur.get_dashboard(db=db, **kw)
    return next(k for k in lu.kpis if k.monnaie_id == get_monnaie_id(db))


@pytest.fixture()
def histoire(db_session):
    """Trois années de dépenses, dont une catégorie qui revient d'une année à l'autre."""
    compte = creer_compte(db_session, "Courant", solde_initial=1000.0)
    _depense(db_session, compte, "Courses", 100.0, date(2024, 3, 4))
    _depense(db_session, compte, "Courses", 40.0, date(2024, 11, 20), categorie="Loisirs & sorties")
    _depense(db_session, compte, "Courses", 60.0, date(2025, 5, 12))
    _depense(db_session, compte, "Cinéma", 25.0, date(2025, 6, 1), categorie="Loisirs & sorties")
    _depense(db_session, compte, "Courses", 80.0, date(2026, 2, 9))
    return compte


# ---------- Les années couvertes ----------


def test_sans_operation_tout_ne_couvre_que_l_annee_en_cours(db_session):
    assert soldes.annees_couvertes(db_session, date(2026, 9, 15)) == [2026]


def test_tout_va_de_la_premiere_operation_a_la_derniere(db_session, histoire):
    assert soldes.annees_couvertes(db_session, date(2026, 9, 15)) == [2024, 2025, 2026]


def test_tout_ne_s_arrete_jamais_avant_aujourd_hui(db_session, histoire):
    """Des opérations qui s'arrêtent en 2026, un « aujourd'hui » en 2028 : l'année
    en cours est comprise, sinon « tout » finirait dans le passé."""
    assert soldes.annees_couvertes(db_session, date(2028, 1, 10))[-1] == 2028


# ---------- Le dashboard « tout » ----------


def test_les_flux_de_tout_sont_la_somme_des_annees(db_session, histoire):
    parts = [_kpi(db_session, annee=a, vue="annee") for a in (2024, 2025, 2026)]
    tout = _kpi(db_session, vue="tout")
    assert tout.total_sorties == pytest.approx(sum(p.total_sorties for p in parts))
    assert tout.total_sorties == pytest.approx(305.0)
    assert tout.total_entrees == pytest.approx(sum(p.total_entrees for p in parts))
    assert tout.variation_previsionnelle == pytest.approx(
        sum(p.variation_previsionnelle for p in parts)
    )
    assert tout.variation_brute == pytest.approx(sum(p.variation_brute for p in parts))


def test_le_detail_par_categorie_de_tout_somme_les_annees(db_session, histoire):
    tout = _kpi(db_session, vue="tout")
    par_nom = {ligne.categorie: ligne for ligne in tout.depenses_par_categorie}
    assert par_nom["Alimentaire"].total_reel == pytest.approx(240.0)
    assert par_nom["Loisirs & sorties"].total_reel == pytest.approx(65.0)
    # La somme des barres vaut le total des sorties : le détail totalise ce qu'il
    # détaille, comme sur n'importe quelle période.
    assert sum(l.total_reel for l in tout.depenses_par_categorie) == pytest.approx(
        tout.total_sorties
    )


def test_le_top_de_tout_fond_les_libelles_d_une_annee_a_l_autre(db_session, histoire):
    tout = _kpi(db_session, vue="tout")
    top = {t.nature: t for t in tout.top_sorties}
    # « Courses » : 100 + 40 (2024) + 60 (2025) + 80 (2026), fondu en UNE ligne.
    assert top["Courses"].montant == pytest.approx(280.0)
    assert top["Courses"].nombre == 4


def test_le_budget_de_tout_somme_les_annees(db_session, histoire):
    m = get_monnaie_id(db_session)
    crud.set_budget_total(db_session, 2024, 1, m, 500.0)
    tout = _kpi(db_session, vue="tout")
    parts = [_kpi(db_session, annee=a, vue="annee") for a in (2024, 2025, 2026)]
    assert tout.budget_total == pytest.approx(sum(p.budget_total for p in parts))
    assert tout.budget_total > 0


def test_une_vue_inconnue_est_refusee(db_session):
    from fastapi import HTTPException

    with pytest.raises(HTTPException) as erreur:
        routeur.get_dashboard(vue="decennie", db=db_session)
    assert erreur.value.status_code == 400


def test_les_soldes_de_tout_se_projettent_jusqu_a_la_fin_de_la_derniere_annee(
    db_session, histoire
):
    compte = histoire
    _depense(
        db_session, compte, "Loyer", 500.0, date(2026, 12, 20), statut=Statut.previsionnel
    )
    tout = _kpi(db_session, vue="tout")
    annee = _kpi(db_session, annee=2026, vue="annee")
    assert tout.solde_projete_courant == pytest.approx(annee.solde_projete_courant)


def test_l_ecart_des_variations_de_tout_somme_les_annees(db_session, histoire):
    m = get_monnaie_id(db_session)
    parts = [soldes.get_ecart_variations(db_session, a, None, m) for a in (2024, 2025, 2026)]
    tout = periode_tout.ecart_variations_tout(db_session, [2024, 2025, 2026], m)
    assert tout["ecart"] == pytest.approx(sum(p["ecart"] for p in parts))
    # L'invariant du détail : la somme des écarts des lignes vaut l'écart.
    assert sum(l["ecart"] for l in tout["lignes"]) == pytest.approx(tout["ecart"])


# ---------- La moyenne hebdomadaire ----------


def test_la_moyenne_du_mois_est_celle_des_semaines_du_mois(db_session):
    compte = creer_compte(db_session, "Courant")
    _depense(db_session, compte, "Courses", 70.0, date(2026, 1, 6))
    m = get_monnaie_id(db_session)
    aujourdhui = date(2026, 3, 1)
    voulue = soldes.get_depenses_par_semaine(db_session, 2026, 1, m)
    lue = soldes.get_depenses_moyenne_periode(db_session, "mois", 2026, 1, m, aujourdhui)
    assert lue["vue"] == "mois" and lue["mois"] == 1
    assert lue["moyenne"] == voulue["moyenne"]
    assert lue["semaines_moyennees"] == voulue["semaines_moyennees"]


def test_la_moyenne_de_l_annee_est_celle_de_l_ancienne_route(db_session):
    compte = creer_compte(db_session, "Courant")
    _depense(db_session, compte, "Courses", 70.0, date(2026, 1, 6))
    m = get_monnaie_id(db_session)
    aujourdhui = date(2026, 9, 15)
    ancienne = soldes.get_depenses_moyenne_annee(db_session, 2026, m, aujourdhui)
    lue = soldes.get_depenses_moyenne_periode(db_session, "annee", 2026, None, m, aujourdhui)
    assert lue["moyenne"] == ancienne["moyenne"]
    assert lue["semaines_moyennees"] == ancienne["semaines_moyennees"]
    assert lue["annee"] == 2026


def test_la_moyenne_de_tout_recouvre_toutes_les_annees(db_session, histoire):
    m = get_monnaie_id(db_session)
    aujourdhui = date(2026, 9, 15)
    lue = soldes.get_depenses_moyenne_periode(db_session, "tout", 2026, None, m, aujourdhui)
    assert lue["vue"] == "tout" and lue["annee"] is None and lue["mois"] is None
    # Elle commence à la semaine du 4 mars 2024 (première dépense) : bien plus de
    # semaines que la seule année 2026.
    seule_2026 = soldes.get_depenses_moyenne_annee(db_session, 2026, m, aujourdhui)
    assert lue["semaines_moyennees"] > seule_2026["semaines_moyennees"] > 0
    # Le total dépensé (305 €) divisé par les semaines moyennées : retrouvé à
    # partir de la barre « Alimentaire » + « Loisirs » de la moyenne.
    total_moyen = sum(l["total_reel"] for l in lue["moyenne"])
    assert total_moyen * lue["semaines_moyennees"] == pytest.approx(305.0)


def test_la_moyenne_de_tout_ne_compte_pas_les_semaines_d_avant_la_premiere_depense(db_session):
    compte = creer_compte(db_session, "Courant")
    _depense(db_session, compte, "Courses", 50.0, date(2026, 8, 3))
    # Une opération de 2023 sans dépense (une entrée) pousse « tout » à remonter.
    crud.create_operation(
        db_session,
        schemas.OperationCreate(
            date=date(2023, 1, 5),
            compte_id=compte.id,
            monnaie_id=get_monnaie_id(db_session),
            type_id=get_type_id(db_session, "classique"),
            categorie_id=get_categorie_id(db_session, "Entrées d'argent"),
            nature="Salaire",
            montant=100.0,
            sens="entrée",
            statut=Statut.reel,
        ),
    )
    m = get_monnaie_id(db_session)
    lue = soldes.get_depenses_moyenne_periode(
        db_session, "tout", 2026, None, m, date(2026, 9, 15)
    )
    # Sept blocs de calendrier seulement — cinq en août à partir de la semaine du
    # 3 (le dernier coupé au 31), deux en septembre jusqu'au 13 — et pas trois
    # ans de zéros.
    assert lue["semaines_moyennees"] == 7


def test_la_route_refuse_une_vue_inconnue(db_session):
    from fastapi import HTTPException

    with pytest.raises(HTTPException) as erreur:
        routeur.get_moyenne_periode(monnaie_id=1, vue="siecle", db=db_session)
    assert erreur.value.status_code == 400


# ---------- Les objectifs sur « tout » ----------


def _charger_objectifs():
    racine = pathlib.Path(__file__).resolve().parents[2] / "extensions" / "projets-objectifs"
    if str(racine) not in sys.path:
        sys.path.insert(0, str(racine))
    spec = importlib.util.spec_from_file_location(
        "service_objectifs", racine / "service_objectifs.py"
    )
    module = importlib.util.module_from_spec(spec)
    sys.modules["service_objectifs"] = module
    spec.loader.exec_module(module)
    return module


def test_les_objectifs_de_tout_moyennent_sur_tout_l_historique(db_session, histoire):
    service = _charger_objectifs()
    m = get_monnaie_id(db_session)
    objectif = models.ObjectifKpi(
        nom="Courses", mesure="montant_total", cadence="semaine", sens="max",
        cible=100.0, monnaie_id=m, visible_dashboard=True,
    )
    db_session.add(objectif)
    db_session.commit()

    aujourdhui = date(2026, 9, 15)
    lu = service.mesurer(db_session, objectif, 2026, None, aujourdhui, tout=True)
    assert lu["moyennee"]["kind"] == "tout"
    # La période du sélecteur EST tout l'historique, et elle est moyennée par semaine.
    assert lu["mode"] == "moyenne"
    # L'actuelle reste la semaine en cours : où j'en suis cette semaine.
    assert lu["actuelle"]["kind"] == "semaine"
    # Le noyau et l'objectif s'accordent : un objectif sans filtre sur toutes les
    # catégories vaut les sorties de « tout » du dashboard.
    assert lu["valeur"] == pytest.approx(_kpi(db_session, vue="tout").total_sorties)


def test_un_objectif_mensuel_de_tout_a_pour_actuelle_le_mois_en_cours(db_session, histoire):
    service = _charger_objectifs()
    m = get_monnaie_id(db_session)
    objectif = models.ObjectifKpi(
        nom="Mois", mesure="montant_total", cadence="mois", sens="max",
        cible=100.0, monnaie_id=m, visible_dashboard=True,
    )
    db_session.add(objectif)
    db_session.commit()
    fenetres = service.fenetres_de_lecture(
        db_session, objectif, 2026, None, date(2026, 9, 15), tout=True
    )
    assert fenetres["actuelle"]["kind"] == "mois"
    assert (fenetres["actuelle"]["annee"], fenetres["actuelle"]["mois"]) == (2026, 9)
    assert fenetres["moyennee"]["kind"] == "tout"
