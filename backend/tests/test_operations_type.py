"""Changement de type d'une opération existante.

Depuis la migration 0019, le type est une colonne (`operation.type_id` vers la
table `type_operation`) : changer de type est un changement explicite, et non
plus une déduction depuis la catégorie et un booléen `remboursable`. Ces tests
couvrent les conséquences de ce changement — dérivation du sens, montants de
remboursement, et nettoyage des liens devenus caducs.
"""
from datetime import date

import pytest
from fastapi import HTTPException

from app import crud, models, schemas
from app.constants import Sens, Statut
from app.routers.operations import _valider_operations_remboursees, update_operation

from .conftest import creer_compte, get_categorie_id, get_monnaie_id, get_type_id


def _make_compte(db, nom="Courant"):
    return creer_compte(db, nom)


def _make_operation(db, compte, type_code="classique", categorie="Autres", **kwargs):
    porte_categorie = type_code in ("classique", "remboursable")
    defaults = dict(
        date=date(2026, 7, 1),
        compte_id=compte.id,
        monnaie_id=get_monnaie_id(db),
        type_id=get_type_id(db, type_code),
        categorie_id=get_categorie_id(db, categorie) if porte_categorie else None,
        nature="Dépense",
        montant=100.0,
        statut=Statut.reel,
    )
    defaults.update(kwargs)
    return crud.create_operation(db, schemas.OperationCreate(**defaults))


def test_remboursable_decoule_du_type(db_session):
    """La colonne booléenne a disparu : la propriété se lit sur le type, et ne
    vaut True que pour les deux mêmes cas qu'avant."""
    compte = _make_compte(db_session)
    attendus = {
        "classique": False,
        "remboursable": True,
        "remboursements": False,
        "pret": True,
        "remboursement_pret": False,
    }
    for type_code, attendu in attendus.items():
        operation = _make_operation(db_session, compte, type_code=type_code, nature=type_code)
        assert operation.remboursable is attendu, type_code


def test_classique_vers_remboursable_initialise_les_montants(db_session):
    compte = _make_compte(db_session)
    operation = _make_operation(db_session, compte)
    assert operation.remboursable is False

    resultat = update_operation(
        operation.id,
        schemas.OperationUpdate(type_id=get_type_id(db_session, "remboursable")),
        db_session,
    )

    assert resultat.remboursable is True
    assert resultat.montant_du == 100.0
    assert resultat.montant_a_rembourser == 100.0


def test_remboursable_vers_classique_remet_les_montants_a_zero(db_session):
    compte = _make_compte(db_session)
    operation = _make_operation(db_session, compte, type_code="remboursable")

    resultat = update_operation(
        operation.id,
        schemas.OperationUpdate(type_id=get_type_id(db_session, "classique")),
        db_session,
    )

    assert resultat.remboursable is False
    assert resultat.montant_du == 0.0
    assert resultat.montant_a_rembourser == 0.0


def test_classique_vers_pret_force_les_montants_et_le_sens(db_session):
    compte = _make_compte(db_session)
    operation = _make_operation(db_session, compte, montant=800.0)

    resultat = update_operation(
        operation.id,
        schemas.OperationUpdate(type_id=get_type_id(db_session, "pret")),
        db_session,
    )

    assert resultat.remboursable is True
    assert resultat.sens == Sens.entree
    assert resultat.montant_du == 800.0
    assert resultat.montant_a_rembourser == 800.0


def test_passer_a_un_type_sans_categorie_efface_la_categorie(db_session):
    """Les quatre types spéciaux n'ont pas de catégorie : leur type EST leur
    classification. La catégorie précédente est simplement outrepassée."""
    compte = _make_compte(db_session)
    operation = _make_operation(db_session, compte, categorie="Alimentaire")
    assert operation.categorie_id is not None

    resultat = update_operation(
        operation.id,
        schemas.OperationUpdate(type_id=get_type_id(db_session, "pret")),
        db_session,
    )

    assert resultat.categorie_id is None


def test_le_sens_suit_la_categorie_pour_les_types_a_categorie_libre(db_session):
    compte = _make_compte(db_session)

    depense = _make_operation(db_session, compte, categorie="Alimentaire")
    entree = _make_operation(db_session, compte, categorie="Entrées d'argent")

    assert depense.sens == Sens.depense
    assert entree.sens == Sens.entree


def test_reglement_reclasse_en_classique_delie_les_dettes_quil_reglait(db_session):
    """Un règlement qui cesse d'en être un ne doit plus rembourser quoi que ce
    soit : ses liens disparaissent et la dette redevient due."""
    compte = _make_compte(db_session)
    depense = _make_operation(db_session, compte, type_code="remboursable")
    reglement = crud.create_operation(
        db_session,
        schemas.OperationCreate(
            date=date(2026, 7, 5),
            compte_id=compte.id,
            monnaie_id=get_monnaie_id(db_session),
            type_id=get_type_id(db_session, "remboursements"),
            nature="Remboursement reçu",
            montant=40.0,
            statut=Statut.reel,
            operations_remboursees=[
                schemas.OperationRembourseeInput(operation_id=depense.id, montant=40.0)
            ],
        ),
    )
    db_session.refresh(depense)
    assert depense.montant_a_rembourser == 60.0

    update_operation(
        reglement.id,
        schemas.OperationUpdate(
            type_id=get_type_id(db_session, "classique"),
            categorie_id=get_categorie_id(db_session, "Alimentaire"),
        ),
        db_session,
    )

    assert db_session.query(models.RemboursementLien).count() == 0
    db_session.refresh(depense)
    assert depense.montant_a_rembourser == 100.0


def test_dette_reclassee_en_classique_supprime_les_liens_entrants(db_session):
    compte = _make_compte(db_session)
    depense = _make_operation(db_session, compte, type_code="remboursable")
    crud.create_operation(
        db_session,
        schemas.OperationCreate(
            date=date(2026, 7, 5),
            compte_id=compte.id,
            monnaie_id=get_monnaie_id(db_session),
            type_id=get_type_id(db_session, "remboursements"),
            nature="Remboursement reçu",
            montant=40.0,
            statut=Statut.reel,
            operations_remboursees=[
                schemas.OperationRembourseeInput(operation_id=depense.id, montant=40.0)
            ],
        ),
    )
    assert db_session.query(models.RemboursementLien).count() == 1

    resultat = update_operation(
        depense.id,
        schemas.OperationUpdate(type_id=get_type_id(db_session, "classique")),
        db_session,
    )

    assert resultat.montant_du == 0.0
    assert db_session.query(models.RemboursementLien).count() == 0


def _valider_cible(db, code_reglement, cible):
    """Passe par la validation du routeur, seule à connaître les cibles
    autorisées pour un type de règlement donné."""
    _valider_operations_remboursees(
        db,
        [schemas.OperationRembourseeInput(operation_id=cible.id, montant=10.0)],
        code_reglement,
        montant_reglement=40.0,
        monnaie_reglement=get_monnaie_id(db),
    )


def test_un_remboursement_ne_peut_regler_quune_depense_remboursable(db_session):
    """La cible valide se lit désormais sur le seul type, là où il fallait
    auparavant croiser remboursable + sens + nom de catégorie."""
    compte = _make_compte(db_session)
    remboursable = _make_operation(db_session, compte, type_code="remboursable")
    classique = _make_operation(db_session, compte)

    _valider_cible(db_session, "remboursements", remboursable)

    with pytest.raises(HTTPException) as exc:
        _valider_cible(db_session, "remboursements", classique)
    assert exc.value.status_code == 400


def test_un_remboursement_de_pret_ne_peut_regler_quun_pret(db_session):
    compte = _make_compte(db_session)
    depense = _make_operation(db_session, compte, type_code="remboursable")
    pret = _make_operation(db_session, compte, type_code="pret")

    _valider_cible(db_session, "remboursement_pret", pret)

    # Une dépense remboursable relève de l'autre type de règlement.
    with pytest.raises(HTTPException) as exc:
        _valider_cible(db_session, "remboursement_pret", depense)
    assert exc.value.status_code == 400


def test_changer_le_type_dune_operation_de_virement_est_refuse(db_session):
    source = _make_compte(db_session, "Courant")
    destination = _make_compte(db_session, "Autre")
    op_sortante, _ = crud.create_virement(
        db_session,
        schemas.VirementCreate(
            date=date(2026, 7, 1),
            compte_source_id=source.id,
            compte_destination_id=destination.id,
            montant=50.0,
            monnaie_id=get_monnaie_id(db_session),
        ),
        source,
        destination,
    )

    with pytest.raises(HTTPException) as exc:
        update_operation(
            op_sortante.id,
            schemas.OperationUpdate(type_id=get_type_id(db_session, "classique")),
            db_session,
        )

    assert exc.value.status_code == 409


def test_modifier_un_virement_sans_changer_son_type_preserve_son_sens(db_session):
    """Régression : le sens était recalculé à chaque modification, ce qui
    ramenait un virement à « dépense » et faussait le solde du compte."""
    source = _make_compte(db_session, "Courant")
    destination = _make_compte(db_session, "Autre")
    op_sortante, op_entrante = crud.create_virement(
        db_session,
        schemas.VirementCreate(
            date=date(2026, 7, 1),
            compte_source_id=source.id,
            compte_destination_id=destination.id,
            montant=50.0,
            monnaie_id=get_monnaie_id(db_session),
        ),
        source,
        destination,
    )

    resultat = update_operation(
        op_sortante.id, schemas.OperationUpdate(nature="Virement épargne"), db_session
    )

    assert resultat.nature == "Virement épargne"
    assert resultat.sens == Sens.transfert_sortant
    db_session.refresh(op_entrante)
    assert op_entrante.sens == Sens.transfert_entrant


def test_creer_une_operation_de_type_virement_est_refuse(db_session):
    """Un virement est une paire d'écritures liées : il passe par /virements."""
    compte = _make_compte(db_session)

    from app.routers.operations import create_operation as create_operation_endpoint

    with pytest.raises(HTTPException) as exc:
        create_operation_endpoint(
            schemas.OperationCreate(
                date=date(2026, 7, 1),
                compte_id=compte.id,
                monnaie_id=get_monnaie_id(db_session),
                type_id=get_type_id(db_session, "virement"),
                nature="Virement",
                montant=50.0,
                statut=Statut.reel,
            ),
            db_session,
        )

    assert exc.value.status_code == 400
