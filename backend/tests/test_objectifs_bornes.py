"""Un objectif borné dans le temps (migration 0084).

CE QUE CES TESTS VERROUILLENT :

  - AVEC UNE DATE DE FIN, L'OBJECTIF EST UN TOTAL SUR LA FENÊTRE, jamais un rythme : le
    sélecteur du dashboard ne change plus rien, la cible est comparée telle quelle ;
  - UN MAXIMUM SE TIENT TANT QU'ON NE LE FRANCHIT PAS, un MINIMUM SE MANQUE TANT QU'ON NE
    L'A PAS ATTEINT ;
  - UNE DEADLINE SANS DÉBUT COMPTE À PARTIR DE LA CRÉATION : les dépenses d'avant qu'on se
    soit fixé la règle n'y entrent pas ;
  - UNE DATE DE DÉBUT SANS FIN EST REFUSÉE, comme une fin avant le début ;
  - SANS DATE, RIEN NE CHANGE.
"""
from datetime import date

import pytest
from pydantic import ValidationError

from .conftest import creer_compte
from . import test_objectifs as base

_depense = base._depense
_objectif = base._objectif
service = base.service
schemas_obj = base.schemas_obj


@pytest.fixture()
def compte(db_session):
    return creer_compte(db_session, "Courant", solde_initial=5000.0)


def test_une_fenetre_est_un_total_compare_a_la_cible(db_session, compte):
    _depense(db_session, compte, 300.0, date(2026, 3, 5))
    _depense(db_session, compte, 400.0, date(2026, 4, 20))
    _depense(db_session, compte, 900.0, date(2026, 8, 1))  # hors fenêtre
    objectif = _objectif(
        db_session, mesure="montant_total", sens="max", cible=800.0,
        date_debut=date(2026, 3, 1), date_fin=date(2026, 6, 30),
    )
    # Quel que soit le mois du sélecteur, la fenêtre est la même.
    for mois in (3, 9):
        mesure = service.mesurer(db_session, objectif, 2026, mois, date(2026, 5, 1))
        assert mesure["valeur"] == pytest.approx(700.0)
        assert mesure["valeur_cadence"] == pytest.approx(700.0)
        assert mesure["mode"] == "cumul"
        assert mesure["atteint"] is True
        assert mesure["date_debut"] == "2026-03-01"
        assert mesure["date_fin"] == "2026-06-30"
        assert mesure["jours_restants"] == 60
        assert mesure["actuelle"]["kind"] == "periode"
        assert mesure["moyennee"]["valeur"] == pytest.approx(700.0)


def test_un_maximum_franchi_est_manque(db_session, compte):
    _depense(db_session, compte, 900.0, date(2026, 3, 5))
    objectif = _objectif(
        db_session, mesure="montant_total", sens="max", cible=800.0,
        date_debut=date(2026, 3, 1), date_fin=date(2026, 6, 30),
    )
    mesure = service.mesurer(db_session, objectif, 2026, 3, date(2026, 5, 1))
    assert mesure["atteint"] is False


def test_un_minimum_se_manque_puis_s_atteint(db_session, compte):
    _depense(db_session, compte, 100.0, date(2026, 3, 5))
    objectif = _objectif(
        db_session, mesure="montant_total", sens="min", cible=300.0,
        date_debut=date(2026, 3, 1), date_fin=date(2026, 6, 30),
    )
    assert service.mesurer(db_session, objectif, 2026, 3, date(2026, 5, 1))["atteint"] is False
    _depense(db_session, compte, 250.0, date(2026, 4, 5))
    assert service.mesurer(db_session, objectif, 2026, 3, date(2026, 5, 1))["atteint"] is True


def test_une_deadline_compte_a_partir_de_la_creation(db_session, compte):
    _depense(db_session, compte, 500.0, date(2026, 1, 10))  # avant la création
    _depense(db_session, compte, 120.0, date(2026, 5, 10))
    objectif = _objectif(
        db_session, mesure="montant_total", sens="max", cible=200.0,
        date_fin=date(2026, 12, 31), cree_le=date(2026, 5, 1),
    )
    mesure = service.mesurer(db_session, objectif, 2026, 5, date(2026, 6, 1))
    assert mesure["valeur"] == pytest.approx(120.0)
    assert mesure["date_debut"] == "2026-05-01"


def test_la_fin_passee_laisse_zero_jour(db_session, compte):
    objectif = _objectif(
        db_session, mesure="nombre", sens="max", cible=3.0,
        date_debut=date(2026, 1, 1), date_fin=date(2026, 1, 31),
    )
    assert service.mesurer(db_session, objectif, 2026, 5, date(2026, 6, 1))["jours_restants"] == 0


def test_sans_date_rien_ne_change(db_session, compte):
    objectif = _objectif(db_session, mesure="nombre", cible=4.0)
    mesure = service.mesurer(db_session, objectif, 2026, 3, date(2026, 12, 31))
    assert mesure["date_fin"] is None
    assert mesure["jours_restants"] is None
    assert mesure["actuelle"]["kind"] == "mois"


def test_les_dates_incoherentes_sont_refusees():
    base = dict(nom="x", mesure="nombre", monnaie_id=1)
    with pytest.raises(ValidationError):
        schemas_obj.ObjectifCreate(**base, date_debut=date(2026, 1, 1))
    with pytest.raises(ValidationError):
        schemas_obj.ObjectifCreate(**base, date_debut=date(2026, 3, 1), date_fin=date(2026, 2, 1))
    schemas_obj.ObjectifCreate(**base, date_fin=date(2026, 2, 1))
