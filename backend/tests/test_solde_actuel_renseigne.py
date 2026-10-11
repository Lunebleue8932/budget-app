"""Le solde initial d'un compte déduit du solde ACTUEL (migration 0082).

On renseigne ce que la banque affiche aujourd'hui ; l'application retranche ce que les
opérations ont changé et en tire le solde initial, qu'elle VERROUILLE. Pour le modifier, on
supprime d'abord le solde actuel renseigné.
"""
from datetime import date

import pytest
from fastapi import HTTPException

from app import schemas
from app.constants import Statut
from app.routers import comptes as routeur_comptes
from app.routers import operations as routeur_operations

from .conftest import creer_compte, get_categorie_id, get_monnaie_id, get_type_id


def _compte_avec_une_depense(db):
    compte = creer_compte(db, "Courant", solde_initial=1000.0)
    routeur_operations.create_operation(
        schemas.OperationCreate(
            date=date(2026, 7, 1),
            compte_id=compte.id,
            monnaie_id=get_monnaie_id(db),
            type_id=get_type_id(db, "classique"),
            categorie_id=get_categorie_id(db, "Alimentaire"),
            nature="Courses",
            montant=40.0,
            statut=Statut.reel,
        ),
        db,
    )
    return compte


def _modifier(db, compte, **champs):
    monnaie_id = get_monnaie_id(db)
    return routeur_comptes.update_compte(
        compte.id,
        schemas.CompteUpdate(
            monnaies=[schemas.CompteMonnaieInput(monnaie_id=monnaie_id, **champs)]
        ),
        db,
    )


def _lien(lu):
    return lu.monnaies[0]


def test_le_solde_initial_se_deduit_du_solde_actuel(db_session):
    compte = _compte_avec_une_depense(db_session)
    # 1000 au départ, une dépense de 40 : le solde réel est 960. La banque affiche 500.
    lu = _modifier(db_session, compte, solde_initial=1000.0, solde_actuel_renseigne=500.0)
    assert _lien(lu).solde_initial == pytest.approx(540.0)
    assert _lien(lu).solde_reel == pytest.approx(500.0)
    assert _lien(lu).solde_actuel_renseigne == pytest.approx(500.0)


def test_le_solde_initial_est_verrouille_tant_que_le_solde_actuel_est_renseigne(db_session):
    compte = _compte_avec_une_depense(db_session)
    _modifier(db_session, compte, solde_actuel_renseigne=500.0)
    # Renvoyé tel qu'enregistré, avec un solde initial « modifié » : ignoré.
    lu = _modifier(db_session, compte, solde_initial=9999.0, solde_actuel_renseigne=500.0)
    assert _lien(lu).solde_initial == pytest.approx(540.0)


def test_modifier_le_solde_actuel_sans_le_supprimer_est_refuse(db_session):
    compte = _compte_avec_une_depense(db_session)
    _modifier(db_session, compte, solde_actuel_renseigne=500.0)
    with pytest.raises(HTTPException) as erreur:
        _modifier(db_session, compte, solde_actuel_renseigne=700.0)
    assert erreur.value.status_code == 409


def test_supprimer_le_solde_actuel_deverrouille_le_solde_initial(db_session):
    compte = _compte_avec_une_depense(db_session)
    _modifier(db_session, compte, solde_actuel_renseigne=500.0)
    lu = _modifier(db_session, compte, solde_initial=1200.0)
    assert _lien(lu).solde_actuel_renseigne is None
    assert _lien(lu).solde_initial == pytest.approx(1200.0)


def test_sans_solde_actuel_rien_ne_change(db_session):
    compte = _compte_avec_une_depense(db_session)
    lu = _modifier(db_session, compte, solde_initial=1000.0)
    assert _lien(lu).solde_initial == pytest.approx(1000.0)
    assert _lien(lu).solde_actuel_renseigne is None
