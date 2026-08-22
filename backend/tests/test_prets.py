from datetime import date

from app import crud, models, schemas
from app.constants import Sens, Statut

from .conftest import creer_compte, get_categorie_id, get_monnaie_id, get_type_id


def _make_compte(db, nom="Courant"):
    return creer_compte(db, nom)


def test_pret_est_une_entree_remboursable(db_session):
    compte = _make_compte(db_session)
    pret = crud.create_operation(
        db_session,
        schemas.OperationCreate(
            date=date(2026, 7, 1),
            compte_id=compte.id,
            monnaie_id=get_monnaie_id(db_session),
            type_id=get_type_id(db_session, "pret"),
            nature="Prêt de Paul",
            montant=200.0,
            statut=Statut.reel,
        ),
    )

    assert pret.sens == Sens.entree
    assert pret.remboursable is True
    assert pret.montant_du == 200.0
    assert pret.montant_a_rembourser == 200.0


def test_pret_ignore_montant_du_manuel(db_session):
    # Contrairement aux dépenses remboursables, le montant à rembourser d'un
    # prêt est toujours égal au montant prêté, même si un montant_du différent
    # est fourni (ex: tentative de partager la facture, non applicable ici).
    compte = _make_compte(db_session)
    pret = crud.create_operation(
        db_session,
        schemas.OperationCreate(
            date=date(2026, 7, 1),
            compte_id=compte.id,
            monnaie_id=get_monnaie_id(db_session),
            type_id=get_type_id(db_session, "pret"),
            nature="Prêt de Paul",
            montant=200.0,
            statut=Statut.reel,
            montant_du=50.0,
        ),
    )

    assert pret.montant_du == 200.0
    assert pret.montant_a_rembourser == 200.0


def test_remboursement_pret_reduit_le_montant_a_rembourser(db_session):
    compte = _make_compte(db_session)
    pret = crud.create_operation(
        db_session,
        schemas.OperationCreate(
            date=date(2026, 7, 1),
            compte_id=compte.id,
            monnaie_id=get_monnaie_id(db_session),
            type_id=get_type_id(db_session, "pret"),
            nature="Prêt de Paul",
            montant=200.0,
            statut=Statut.reel,
        ),
    )

    remboursement = crud.create_operation(
        db_session,
        schemas.OperationCreate(
            date=date(2026, 7, 10),
            compte_id=compte.id,
            monnaie_id=get_monnaie_id(db_session),
            type_id=get_type_id(db_session, "remboursement_pret"),
            nature="Remboursement à Paul",
            montant=80.0,
            statut=Statut.reel,
            operations_remboursees=[
                schemas.OperationRembourseeInput(operation_id=pret.id, montant=80.0)
            ],
        ),
    )

    db_session.refresh(pret)
    assert pret.montant_a_rembourser == 120.0
    # Un remboursement de prêt est une sortie d'argent, jamais une entrée.
    assert remboursement.sens == Sens.depense
    assert remboursement.remboursable is False


def test_remboursement_pret_partiel_multiple(db_session):
    compte = _make_compte(db_session)
    pret = crud.create_operation(
        db_session,
        schemas.OperationCreate(
            date=date(2026, 7, 1),
            compte_id=compte.id,
            monnaie_id=get_monnaie_id(db_session),
            type_id=get_type_id(db_session, "pret"),
            nature="Prêt de Paul",
            montant=200.0,
            statut=Statut.reel,
        ),
    )

    crud.create_operation(
        db_session,
        schemas.OperationCreate(
            date=date(2026, 7, 10),
            compte_id=compte.id,
            monnaie_id=get_monnaie_id(db_session),
            type_id=get_type_id(db_session, "remboursement_pret"),
            nature="Premier versement",
            montant=80.0,
            statut=Statut.reel,
            operations_remboursees=[
                schemas.OperationRembourseeInput(operation_id=pret.id, montant=80.0)
            ],
        ),
    )
    crud.create_operation(
        db_session,
        schemas.OperationCreate(
            date=date(2026, 7, 20),
            compte_id=compte.id,
            monnaie_id=get_monnaie_id(db_session),
            type_id=get_type_id(db_session, "remboursement_pret"),
            nature="Solde",
            montant=120.0,
            statut=Statut.reel,
            operations_remboursees=[
                schemas.OperationRembourseeInput(operation_id=pret.id, montant=120.0)
            ],
        ),
    )

    db_session.refresh(pret)
    assert pret.montant_a_rembourser == 0.0
