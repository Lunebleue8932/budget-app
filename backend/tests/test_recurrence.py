from datetime import date

import pytest
from pydantic import ValidationError

from app import crud, models, schemas
from app.constants import Frequence, Statut

from .conftest import creer_compte, get_categorie_id, get_monnaie_id, get_type_id


def _make_compte(db, nom="Courant"):
    return creer_compte(db, nom)


def _make_modele(db, compte, **kwargs):
    defaults = dict(
        date=date(2026, 7, 1),
        compte_id=compte.id,
        monnaie_id=get_monnaie_id(db),
        type_id=get_type_id(db, "classique"),
        categorie_id=get_categorie_id(db, "Charges fixes"),
        nature="Abonnement",
        montant=10.0,
        statut=Statut.reel,
        recurrente=True,
        frequence=Frequence.mensuelle,
    )
    defaults.update(kwargs)
    return crud.create_operation(db, schemas.OperationCreate(**defaults))


def test_operation_recurrente_sans_frequence_est_invalide(db_session):
    with pytest.raises(ValidationError):
        schemas.OperationCreate(
            date=date(2026, 7, 1),
            compte_id=1,
            monnaie_id=get_monnaie_id(db_session),
            type_id=get_type_id(db_session, "classique"),
            categorie_id=1,
            nature="Abonnement",
            montant=10.0,
            statut=Statut.reel,
            recurrente=True,
        )


def test_ajouter_mois_clampe_en_fin_de_mois(db_session):
    # 2026 n'est pas bissextile : février s'arrête au 28.
    assert crud._ajouter_mois(date(2026, 1, 31), 1) == date(2026, 2, 28)
    assert crud._ajouter_mois(date(2026, 1, 31), 12) == date(2027, 1, 31)


def test_generer_occurrences_mensuelle_jusqua_la_date_de_fin(db_session):
    compte = _make_compte(db_session)
    modele = _make_modele(
        db_session, compte, date=date(2026, 7, 1), recurrence_fin=date(2026, 10, 1)
    )

    crud.generer_occurrences_recurrentes(db_session)

    enfants = (
        db_session.query(models.Operation)
        .filter(models.Operation.recurrence_parent_id == modele.id)
        .order_by(models.Operation.date)
        .all()
    )
    assert [e.date for e in enfants] == [date(2026, 8, 1), date(2026, 9, 1), date(2026, 10, 1)]
    assert all(e.recurrente for e in enfants)
    assert all(e.statut == Statut.previsionnel for e in enfants)
    assert all(e.montant == 10.0 and e.nature == "Abonnement" for e in enfants)


def test_generer_occurrences_hebdomadaire(db_session):
    compte = _make_compte(db_session)
    modele = _make_modele(
        db_session,
        compte,
        date=date(2026, 7, 1),
        frequence=Frequence.hebdomadaire,
        recurrence_fin=date(2026, 7, 22),
    )

    crud.generer_occurrences_recurrentes(db_session)

    dates = sorted(
        e.date
        for e in db_session.query(models.Operation)
        .filter(models.Operation.recurrence_parent_id == modele.id)
        .all()
    )
    assert dates == [date(2026, 7, 8), date(2026, 7, 15), date(2026, 7, 22)]


def test_generer_occurrences_est_idempotent(db_session):
    compte = _make_compte(db_session)
    modele = _make_modele(
        db_session, compte, date=date(2026, 7, 1), recurrence_fin=date(2026, 10, 1)
    )

    crud.generer_occurrences_recurrentes(db_session)
    crud.generer_occurrences_recurrentes(db_session)

    nb = (
        db_session.query(models.Operation)
        .filter(models.Operation.recurrence_parent_id == modele.id)
        .count()
    )
    assert nb == 3


def test_generer_occurrences_infinie_bornee_a_lhorizon_glissant(db_session):
    compte = _make_compte(db_session)
    aujourdhui = date.today()
    modele = _make_modele(db_session, compte, date=aujourdhui, recurrence_fin=None)

    crud.generer_occurrences_recurrentes(db_session)

    enfants = (
        db_session.query(models.Operation)
        .filter(models.Operation.recurrence_parent_id == modele.id)
        .all()
    )
    horizon = crud._ajouter_mois(aujourdhui, crud.HORIZON_MOIS_RECURRENCE)
    # Un par mois jusqu'à l'horizon glissant (24 mois par défaut), aucun au-delà.
    assert len(enfants) == crud.HORIZON_MOIS_RECURRENCE
    assert all(e.date <= horizon for e in enfants)


def test_arreter_recurrence_supprime_le_previsionnel_mais_garde_le_reel(db_session):
    compte = _make_compte(db_session)
    modele = _make_modele(
        db_session, compte, date=date(2026, 7, 1), recurrence_fin=date(2026, 9, 1)
    )
    crud.generer_occurrences_recurrentes(db_session)
    enfants = (
        db_session.query(models.Operation)
        .filter(models.Operation.recurrence_parent_id == modele.id)
        .order_by(models.Operation.date)
        .all()
    )
    assert len(enfants) == 2
    # Une des occurrences a déjà eu lieu en pratique : l'utilisateur l'a marquée réelle.
    premier_enfant_id = enfants[0].id
    enfants[0].statut = Statut.reel
    db_session.commit()

    crud.update_operation(db_session, modele, schemas.OperationUpdate(recurrente=False))

    restants = db_session.query(models.Operation).filter(models.Operation.id.in_([e.id for e in enfants])).all()
    assert len(restants) == 1
    assert restants[0].id == premier_enfant_id
    assert restants[0].recurrence_parent_id is None
    assert restants[0].statut == Statut.reel


def test_supprimer_le_modele_nettoie_les_occurrences_previsionnelles(db_session):
    compte = _make_compte(db_session)
    modele = _make_modele(
        db_session, compte, date=date(2026, 7, 1), recurrence_fin=date(2026, 9, 1)
    )
    crud.generer_occurrences_recurrentes(db_session)
    assert (
        db_session.query(models.Operation)
        .filter(models.Operation.recurrence_parent_id == modele.id)
        .count()
        == 2
    )

    crud.delete_operation(db_session, modele)

    assert db_session.query(models.Operation).count() == 0


def test_supprimer_le_modele_detache_les_occurrences_deja_reelles(db_session):
    compte = _make_compte(db_session)
    modele = _make_modele(
        db_session, compte, date=date(2026, 7, 1), recurrence_fin=date(2026, 9, 1)
    )
    crud.generer_occurrences_recurrentes(db_session)
    enfant = (
        db_session.query(models.Operation)
        .filter(models.Operation.recurrence_parent_id == modele.id)
        .order_by(models.Operation.date)
        .first()
    )
    enfant.statut = Statut.reel
    db_session.commit()
    enfant_id = enfant.id

    crud.delete_operation(db_session, modele)

    restant = db_session.query(models.Operation).filter(models.Operation.id == enfant_id).first()
    assert restant is not None
    assert restant.recurrence_parent_id is None
