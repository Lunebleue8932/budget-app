from datetime import date

import pytest
from fastapi import HTTPException

from app import crud, models, schemas
from app.constants import Statut
from app.routers.operations import _valider_operations_remboursees, update_operation

from .conftest import creer_compte, get_categorie_id, get_monnaie_id, get_type_id


def _make_compte(db, nom="Courant"):
    return creer_compte(db, nom)


def test_depense_remboursable_defaut_montant_a_rembourser(db_session):
    compte = _make_compte(db_session)
    depense = crud.create_operation(
        db_session,
        schemas.OperationCreate(
            date=date(2026, 7, 1),
            compte_id=compte.id,
            monnaie_id=get_monnaie_id(db_session),
            type_id=get_type_id(db_session, "remboursable"),
            categorie_id=get_categorie_id(db_session, "Autres"),
            nature="Avance resto",
            montant=100.0,
            statut=Statut.reel,
        ),
    )

    assert depense.montant_du == 100.0
    assert depense.montant_a_rembourser == 100.0


def test_montant_du_reste_fixe_apres_remboursement(db_session):
    # Dépense de 100, mais seulement 60 étaient à rembourser (partage de facture).
    compte = _make_compte(db_session)
    depense = crud.create_operation(
        db_session,
        schemas.OperationCreate(
            date=date(2026, 7, 1),
            compte_id=compte.id,
            monnaie_id=get_monnaie_id(db_session),
            type_id=get_type_id(db_session, "remboursable"),
            categorie_id=get_categorie_id(db_session, "Autres"),
            nature="Resto entre amis",
            montant=100.0,
            statut=Statut.reel,
            montant_du=60.0,
        ),
    )
    assert depense.montant_du == 60.0
    assert depense.montant_a_rembourser == 60.0

    crud.create_operation(
        db_session,
        schemas.OperationCreate(
            date=date(2026, 7, 5),
            compte_id=compte.id,
            monnaie_id=get_monnaie_id(db_session),
            type_id=get_type_id(db_session, "remboursements"),
            nature="Remboursement reçu",
            montant=60.0,
            statut=Statut.reel,
            operations_remboursees=[
                schemas.OperationRembourseeInput(operation_id=depense.id, montant=60.0)
            ],
        ),
    )

    db_session.refresh(depense)
    # Le reste à rembourser tombe à 0, mais le montant initialement dû reste en mémoire.
    assert depense.montant_a_rembourser == 0.0
    assert depense.montant_du == 60.0


def test_lien_remboursement_force_le_montant_a_zero(db_session):
    compte = _make_compte(db_session)
    depense = crud.create_operation(
        db_session,
        schemas.OperationCreate(
            date=date(2026, 7, 1),
            compte_id=compte.id,
            monnaie_id=get_monnaie_id(db_session),
            type_id=get_type_id(db_session, "remboursable"),
            categorie_id=get_categorie_id(db_session, "Autres"),
            nature="Avance resto",
            montant=100.0,
            statut=Statut.reel,
        ),
    )

    remboursement = crud.create_operation(
        db_session,
        schemas.OperationCreate(
            date=date(2026, 7, 5),
            compte_id=compte.id,
            monnaie_id=get_monnaie_id(db_session),
            type_id=get_type_id(db_session, "remboursements"),
            nature="Remboursement reçu",
            montant=100.0,
            statut=Statut.reel,
            operations_remboursees=[
                schemas.OperationRembourseeInput(operation_id=depense.id, montant=100.0)
            ],
        ),
    )

    db_session.refresh(depense)
    assert depense.montant_a_rembourser == 0.0
    assert crud.get_remboursements_lies(db_session, depense.id) == [remboursement]
    assert crud.get_operations_remboursees(db_session, remboursement.id) == [depense]


def test_remboursement_partiel_multiple(db_session):
    # Une dépense de 100 réglée en deux fois : 40 puis 60.
    compte = _make_compte(db_session)
    depense = crud.create_operation(
        db_session,
        schemas.OperationCreate(
            date=date(2026, 7, 1),
            compte_id=compte.id,
            monnaie_id=get_monnaie_id(db_session),
            type_id=get_type_id(db_session, "remboursable"),
            categorie_id=get_categorie_id(db_session, "Autres"),
            nature="Weekend entre amis",
            montant=100.0,
            statut=Statut.reel,
        ),
    )

    premier = crud.create_operation(
        db_session,
        schemas.OperationCreate(
            date=date(2026, 7, 5),
            compte_id=compte.id,
            monnaie_id=get_monnaie_id(db_session),
            type_id=get_type_id(db_session, "remboursements"),
            nature="Premier versement",
            montant=40.0,
            statut=Statut.reel,
            operations_remboursees=[
                schemas.OperationRembourseeInput(operation_id=depense.id, montant=40.0)
            ],
        ),
    )
    db_session.refresh(depense)
    assert depense.montant_a_rembourser == 60.0

    crud.create_operation(
        db_session,
        schemas.OperationCreate(
            date=date(2026, 7, 10),
            compte_id=compte.id,
            monnaie_id=get_monnaie_id(db_session),
            type_id=get_type_id(db_session, "remboursements"),
            nature="Solde",
            montant=60.0,
            statut=Statut.reel,
            operations_remboursees=[
                schemas.OperationRembourseeInput(operation_id=depense.id, montant=60.0)
            ],
        ),
    )
    db_session.refresh(depense)
    assert depense.montant_a_rembourser == 0.0

    liens = crud.get_remboursements_lies_detail(db_session, depense.id)
    montants = sorted(montant for _, montant in liens)
    assert montants == [40.0, 60.0]

    # Le premier versement, supprimé, ne restaure QUE sa part (40), pas les 60
    # réglés par l'autre remboursement.
    crud.delete_operation(db_session, premier)
    db_session.refresh(depense)
    assert depense.montant_a_rembourser == 40.0


def test_suppression_remboursement_restaure_le_reste_a_rembourser(db_session):
    compte = _make_compte(db_session)
    depense = crud.create_operation(
        db_session,
        schemas.OperationCreate(
            date=date(2026, 7, 1),
            compte_id=compte.id,
            monnaie_id=get_monnaie_id(db_session),
            type_id=get_type_id(db_session, "remboursable"),
            categorie_id=get_categorie_id(db_session, "Autres"),
            nature="Avance resto",
            montant=100.0,
            statut=Statut.reel,
        ),
    )
    remboursement = crud.create_operation(
        db_session,
        schemas.OperationCreate(
            date=date(2026, 7, 5),
            compte_id=compte.id,
            monnaie_id=get_monnaie_id(db_session),
            type_id=get_type_id(db_session, "remboursements"),
            nature="Remboursement reçu",
            montant=100.0,
            statut=Statut.reel,
            operations_remboursees=[
                schemas.OperationRembourseeInput(operation_id=depense.id, montant=100.0)
            ],
        ),
    )
    db_session.refresh(depense)
    assert depense.montant_a_rembourser == 0.0

    crud.delete_operation(db_session, remboursement)

    db_session.refresh(depense)
    assert depense.montant_a_rembourser == 100.0
    assert crud.get_remboursements_lies(db_session, depense.id) == []


def test_sens_derive_de_la_categorie(db_session):
    compte = _make_compte(db_session)

    depense = crud.create_operation(
        db_session,
        schemas.OperationCreate(
            date=date(2026, 7, 1),
            compte_id=compte.id,
            monnaie_id=get_monnaie_id(db_session),
            type_id=get_type_id(db_session, "classique"),
            categorie_id=get_categorie_id(db_session, "Alimentaire"),
            nature="Courses",
            montant=50.0,
            statut=Statut.reel,
        ),
    )
    entree = crud.create_operation(
        db_session,
        schemas.OperationCreate(
            date=date(2026, 7, 1),
            compte_id=compte.id,
            monnaie_id=get_monnaie_id(db_session),
            type_id=get_type_id(db_session, "classique"),
            categorie_id=get_categorie_id(db_session, "Entrées d'argent"),
            nature="Salaire",
            montant=2000.0,
            statut=Statut.reel,
        ),
    )
    remboursement = crud.create_operation(
        db_session,
        schemas.OperationCreate(
            date=date(2026, 7, 1),
            compte_id=compte.id,
            monnaie_id=get_monnaie_id(db_session),
            type_id=get_type_id(db_session, "remboursements"),
            nature="Remboursement reçu",
            montant=20.0,
            statut=Statut.reel,
        ),
    )

    assert depense.sens.value == "dépense"
    assert entree.sens.value == "entrée"
    assert remboursement.sens.value == "entrée"


def test_remboursement_partiel_lie_le_minimum(db_session):
    # Remboursement de 30 pour une dépense dont il reste 100 à rembourser :
    # le lien vaut le montant du remboursement (30), le reste dû tombe à 70.
    compte = _make_compte(db_session)
    depense = crud.create_operation(
        db_session,
        schemas.OperationCreate(
            date=date(2026, 7, 1),
            compte_id=compte.id,
            monnaie_id=get_monnaie_id(db_session),
            type_id=get_type_id(db_session, "remboursable"),
            categorie_id=get_categorie_id(db_session, "Autres"),
            nature="Grosse avance",
            montant=100.0,
            statut=Statut.reel,
        ),
    )

    crud.create_operation(
        db_session,
        schemas.OperationCreate(
            date=date(2026, 7, 5),
            compte_id=compte.id,
            monnaie_id=get_monnaie_id(db_session),
            type_id=get_type_id(db_session, "remboursements"),
            nature="Acompte reçu",
            montant=30.0,
            statut=Statut.reel,
            operations_remboursees=[
                schemas.OperationRembourseeInput(operation_id=depense.id, montant=30.0)
            ],
        ),
    )

    db_session.refresh(depense)
    assert depense.montant_a_rembourser == 70.0


def test_total_des_liens_ne_peut_depasser_le_montant_du_reglement(db_session):
    # Validation commune création/modification (donc page Opérations ET import) :
    # les liens répartissent le montant du règlement, ils ne le gonflent jamais.
    compte = _make_compte(db_session)
    depense = crud.create_operation(
        db_session,
        schemas.OperationCreate(
            date=date(2026, 7, 1),
            compte_id=compte.id,
            monnaie_id=get_monnaie_id(db_session),
            type_id=get_type_id(db_session, "remboursable"),
            categorie_id=get_categorie_id(db_session, "Autres"),
            nature="Avance resto",
            montant=100.0,
            statut=Statut.reel,
        ),
    )

    items = [schemas.OperationRembourseeInput(operation_id=depense.id, montant=80.0)]

    with pytest.raises(HTTPException) as excinfo:
        _valider_operations_remboursees(
            db_session,
            items,
            "remboursements",
            montant_reglement=50.0,
            monnaie_reglement=get_monnaie_id(db_session),
        )
    assert excinfo.value.status_code == 400
    assert "dépasse le montant" in excinfo.value.detail

    # Le même total, couvert par le montant du règlement, passe sans erreur.
    _valider_operations_remboursees(
        db_session,
        items,
        "remboursements",
        montant_reglement=80.0,
        monnaie_reglement=get_monnaie_id(db_session),
    )


def test_type_reglement_nest_jamais_lui_meme_remboursable(db_session):
    """Un remboursement reçu solde une dette, il n'en est pas une : son type
    n'est pas dans TYPES_REMBOURSABLES, donc la propriété dérivée vaut False."""
    compte = _make_compte(db_session)
    remboursement = crud.create_operation(
        db_session,
        schemas.OperationCreate(
            date=date(2026, 7, 1),
            compte_id=compte.id,
            monnaie_id=get_monnaie_id(db_session),
            type_id=get_type_id(db_session, "remboursements"),
            nature="Remboursement reçu",
            montant=20.0,
            statut=Statut.reel,
        ),
    )
    assert remboursement.remboursable is False
    assert remboursement.montant_du == 0.0


def _depense_partiellement_remboursee(db, montant=100.0, montant_du=100.0, montant_rembourse=40.0):
    """Une dépense remboursable sur laquelle un remboursement a déjà été posé."""
    compte = _make_compte(db)
    depense = crud.create_operation(
        db,
        schemas.OperationCreate(
            date=date(2026, 7, 1),
            compte_id=compte.id,
            monnaie_id=get_monnaie_id(db),
            type_id=get_type_id(db, "remboursable"),
            categorie_id=get_categorie_id(db, "Autres"),
            nature="Avance resto",
            montant=montant,
            statut=Statut.reel,
            montant_du=montant_du,
        ),
    )
    crud.create_operation(
        db,
        schemas.OperationCreate(
            date=date(2026, 7, 5),
            compte_id=compte.id,
            monnaie_id=get_monnaie_id(db),
            type_id=get_type_id(db, "remboursements"),
            nature="Remboursement partiel",
            montant=montant_rembourse,
            statut=Statut.reel,
            operations_remboursees=[
                schemas.OperationRembourseeInput(operation_id=depense.id, montant=montant_rembourse)
            ],
        ),
    )
    db.refresh(depense)
    return depense


def test_montant_du_non_modifiable_apres_debut_de_remboursement(db_session):
    """Sans ce verrou, ramener montant_du de 100 à 20 sur une dette déjà
    remboursée de 40 laisserait un lien qui sur-rembourse de 20, sans
    qu'aucun recalcul ne le rattrape."""
    depense = _depense_partiellement_remboursee(db_session)
    assert depense.montant_a_rembourser == 60.0

    with pytest.raises(HTTPException) as exc:
        update_operation(depense.id, schemas.OperationUpdate(montant_du=20.0), db_session)

    assert exc.value.status_code == 400
    db_session.refresh(depense)
    assert depense.montant_du == 100.0


def test_montant_non_modifiable_apres_debut_de_remboursement(db_session):
    depense = _depense_partiellement_remboursee(db_session)

    with pytest.raises(HTTPException) as exc:
        update_operation(depense.id, schemas.OperationUpdate(montant=500.0), db_session)

    assert exc.value.status_code == 400
    db_session.refresh(depense)
    assert depense.montant == 100.0


def test_renvoyer_les_memes_montants_ne_declenche_pas_le_verrou(db_session):
    """Le frontend renvoie l'objet complet, champs inchangés compris : seule
    une vraie tentative de modification doit être refusée."""
    depense = _depense_partiellement_remboursee(db_session)

    resultat = update_operation(
        depense.id,
        schemas.OperationUpdate(
            nature="Avance resto (corrigée)",
            montant=depense.montant,
            montant_du=depense.montant_du,
        ),
        db_session,
    )

    assert resultat.nature == "Avance resto (corrigée)"
    assert resultat.montant_du == 100.0


def test_montants_modifiables_tant_quaucun_remboursement_nest_lie(db_session):
    compte = _make_compte(db_session)
    depense = crud.create_operation(
        db_session,
        schemas.OperationCreate(
            date=date(2026, 7, 1),
            compte_id=compte.id,
            monnaie_id=get_monnaie_id(db_session),
            type_id=get_type_id(db_session, "remboursable"),
            categorie_id=get_categorie_id(db_session, "Autres"),
            nature="Avance resto",
            montant=100.0,
            statut=Statut.reel,
        ),
    )

    resultat = update_operation(
        depense.id,
        schemas.OperationUpdate(montant=120.0, montant_du=80.0, montant_a_rembourser=80.0),
        db_session,
    )

    assert resultat.montant == 120.0
    assert resultat.montant_du == 80.0
