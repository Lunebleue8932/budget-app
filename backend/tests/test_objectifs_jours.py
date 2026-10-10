"""Le filtre « Jours » d'un objectif, lu en vue MOYENNÉE.

LE PROBLÈME QUE CES TESTS VERROUILLENT. Un objectif « dépenses du week-end, 120 € par
semaine » ne reçoit de dépense que deux jours sur sept. Sa vue moyennée divisait pourtant
le total par le nombre de semaines de CALENDRIER écoulées : un lundi 5 octobre, avec un
seul week-end vécu (100 € dépensés), 5/7 de semaine écoulée donnaient 140 € par semaine —
un objectif tenu se lisait comme dépassé. Le temps se compte maintenant en JOURS
CONCERNÉS : un week-end vécu vaut une semaine de week-end, quel que soit le jour où l'on
regarde.

Sans filtre, rien ne change.
"""
from datetime import date

import pytest

from app import crud, models, schemas
from app.constants import Statut
from app.services import lignes_depenses

from .conftest import charger_module_extension, creer_compte, get_categorie_id, get_monnaie_id, get_type_id

service = charger_module_extension("objectifs", "service_objectifs.py")

# 2026-10-05 est un LUNDI ; le 1er octobre 2026 est un jeudi, le week-end vécu est donc les 3 et 4.
LUNDI = date(2026, 10, 5)


def _depense(db, compte, montant, jour):
    return crud.create_operation(
        db,
        schemas.OperationCreate(
            date=jour,
            compte_id=compte.id,
            monnaie_id=get_monnaie_id(db),
            type_id=get_type_id(db, "classique"),
            categorie_id=get_categorie_id(db, "Alimentaire"),
            nature="Courses",
            montant=montant,
            statut=Statut.reel,
        ),
    )


def _objectif(db, cadence="semaine", jours=None, cible=120.0):
    objectif = models.ObjectifKpi(
        nom="Week-end",
        mesure="montant_total",
        cadence=cadence,
        sens="max",
        cible=cible,
        monnaie_id=get_monnaie_id(db),
        visible_dashboard=True,
        filtres=[{"champ": "jours", "valeur": jours}] if jours else [],
    )
    db.add(objectif)
    db.commit()
    return objectif


@pytest.fixture()
def compte(db_session):
    return creer_compte(db_session, "Courant", solde_initial=5000.0)


# ---------- Compter les jours ----------


def test_les_jours_concernes_se_comptent_par_moitie_de_semaine():
    # Du jeudi 1er au lundi 5 octobre 2026 : jeu, ven, sam, dim, lun.
    assert lignes_depenses.jours_concernes(date(2026, 10, 1), LUNDI) == 5
    assert lignes_depenses.jours_concernes(date(2026, 10, 1), LUNDI, "weekend") == 2
    assert lignes_depenses.jours_concernes(date(2026, 10, 1), LUNDI, "semaine") == 3
    assert lignes_depenses.jours_concernes(LUNDI, date(2026, 10, 4)) == 0


def test_un_mois_d_octobre_2026_compte_neuf_jours_de_week_end():
    jours = lignes_depenses.jours_concernes(date(2026, 10, 1), date(2026, 10, 31), "weekend")
    assert jours == 9  # cinq samedis, quatre dimanches


# ---------- Le cas qui a fait explorer le calcul ----------


def test_un_seul_week_end_vecu_vaut_une_semaine_de_week_end(db_session, compte):
    _depense(db_session, compte, 100.0, date(2026, 10, 3))  # le samedi
    _depense(db_session, compte, 40.0, date(2026, 10, 2))   # un vendredi : hors filtre
    objectif = _objectif(db_session, jours="weekend")

    mesure = service.mesurer(db_session, objectif, 2026, 10, LUNDI)
    moyennee = mesure["moyennee"]

    assert moyennee["valeur"] == pytest.approx(100.0)
    assert moyennee["unites"] == pytest.approx(1.0)
    # 100 € par week-end, sous la cible de 120 : l'objectif est TENU (il était « dépassé » à 140).
    assert moyennee["valeur_cadence"] == pytest.approx(100.0)
    assert moyennee["atteint"] is True


def test_sans_filtre_le_temps_reste_celui_du_calendrier(db_session, compte):
    _depense(db_session, compte, 100.0, date(2026, 10, 3))
    _depense(db_session, compte, 40.0, date(2026, 10, 2))
    objectif = _objectif(db_session)

    moyennee = service.mesurer(db_session, objectif, 2026, 10, LUNDI)["moyennee"]

    assert moyennee["unites"] == pytest.approx(5 / 7)
    assert moyennee["valeur_cadence"] == pytest.approx(140.0 / (5 / 7))


def test_les_jours_ouvres_se_comptent_sur_cinq_jours_par_semaine(db_session, compte):
    _depense(db_session, compte, 30.0, date(2026, 10, 1))
    objectif = _objectif(db_session, jours="semaine", cible=200.0)
    moyennee = service.mesurer(db_session, objectif, 2026, 10, LUNDI)["moyennee"]
    # Jeudi, vendredi, lundi : trois jours ouvrés écoulés sur cinq.
    assert moyennee["unites"] == pytest.approx(3 / 5)


def test_un_mois_ecoule_compte_tous_ses_week_ends(db_session, compte):
    _depense(db_session, compte, 90.0, date(2026, 10, 10))
    objectif = _objectif(db_session, jours="weekend")
    moyennee = service.mesurer(db_session, objectif, 2026, 10, date(2026, 11, 15))["moyennee"]
    assert moyennee["unites"] == pytest.approx(9 / 2)  # neuf jours de week-end, deux par semaine
    assert moyennee["valeur_cadence"] == pytest.approx(90.0 / 4.5)


# ---------- La cadence mensuelle ----------


def test_en_cadence_mensuelle_la_fraction_du_mois_suit_les_week_ends(db_session, compte):
    objectif = _objectif(db_session, cadence="mois", jours="weekend", cible=300.0)
    # Sur l'année, le mois d'octobre compte pour (jours de week-end écoulés / jours de week-end du mois).
    moyennee = service.mesurer(db_session, objectif, 2026, None, LUNDI)["moyennee"]
    unites = service.unites_fenetre(
        "mois", date(2026, 1, 1), date(2026, 12, 31), LUNDI, jours_filtre="weekend"
    )
    # Neuf mois révolus, plus 2 jours de week-end écoulés sur les 9 d'octobre : 9 + 2/9.
    assert unites == pytest.approx(9 + 2 / 9)
    assert moyennee["kind"] == "tout"
