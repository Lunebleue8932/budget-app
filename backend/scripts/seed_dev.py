"""Seed l'environnement de DEV avec des données factices (comptes, catégories,
opérations) couvrant tous les types d'opérations de l'application.

Ne touche jamais à la production : utilise la même résolution de chemin que
l'app (BUDGET_DB_PATH), qui pointe par défaut sur data/dev/budget_dev.db.
Idempotent : ne fait rien si des comptes existent déjà.

Usage : .venv\\Scripts\\python.exe scripts\\seed_dev.py
"""
import sys
from datetime import date, timedelta
from pathlib import Path

sys.path.append(str(Path(__file__).resolve().parents[1]))

from app import crud, schemas  # noqa: E402
from app.constants import Statut, TypeCompte  # noqa: E402
from app.database import SessionLocal, SQLALCHEMY_DATABASE_URL  # noqa: E402


def _categorie_id(db, nom):
    categorie = crud.get_categorie_by_nom(db, nom)
    if categorie is None:
        raise RuntimeError(f"Catégorie '{nom}' introuvable — les migrations ont-elles tourné ?")
    return categorie.id


def seed(db) -> None:
    if crud.get_comptes(db):
        print("Des comptes existent déjà dans cette base : seed ignoré (idempotent).")
        return

    courant = crud.create_compte(
        db, schemas.CompteCreate(nom="Compte Courant", type=TypeCompte.courant, solde_initial=1500.0)
    )
    epargne = crud.create_compte(
        db, schemas.CompteCreate(nom="Livret A", type=TypeCompte.epargne, solde_initial=3000.0)
    )

    today = date(2026, 7, 1)

    # Opérations classiques.
    crud.create_operation(
        db,
        schemas.OperationCreate(
            date=today,
            compte_id=courant.id,
            categorie_id=_categorie_id(db, "Alimentaire"),
            nature="Courses Monoprix",
            montant=45.20,
            statut=Statut.reel,
        ),
    )
    crud.create_operation(
        db,
        schemas.OperationCreate(
            date=today + timedelta(days=3),
            compte_id=courant.id,
            categorie_id=_categorie_id(db, "Charges fixes"),
            nature="Loyer",
            montant=650.0,
            statut=Statut.previsionnel,
        ),
    )
    crud.create_operation(
        db,
        schemas.OperationCreate(
            date=today,
            compte_id=courant.id,
            categorie_id=_categorie_id(db, "Entrées d'argent"),
            nature="Salaire",
            montant=2200.0,
            statut=Statut.reel,
        ),
    )

    # Dépense remboursable, partiellement réglée (partage de facture).
    depense = crud.create_operation(
        db,
        schemas.OperationCreate(
            date=today + timedelta(days=1),
            compte_id=courant.id,
            categorie_id=_categorie_id(db, "Loisirs & sorties"),
            nature="Resto entre amis",
            montant=80.0,
            statut=Statut.reel,
            remboursable=True,
            montant_du=40.0,
        ),
    )
    crud.create_operation(
        db,
        schemas.OperationCreate(
            date=today + timedelta(days=8),
            compte_id=courant.id,
            categorie_id=_categorie_id(db, "Remboursements"),
            nature="Remboursement reçu de Léa",
            montant=40.0,
            statut=Statut.reel,
            operations_remboursees=[
                schemas.OperationRembourseeInput(operation_id=depense.id, montant=40.0)
            ],
        ),
    )

    # Virement interne.
    crud.create_virement(
        db,
        schemas.VirementCreate(
            date=today + timedelta(days=2),
            compte_source_id=courant.id,
            compte_destination_id=epargne.id,
            montant=300.0,
            nature="Épargne du mois",
            statut=Statut.reel,
        ),
        courant,
        epargne,
    )

    # Prêt reçu, remboursé partiellement.
    pret = crud.create_operation(
        db,
        schemas.OperationCreate(
            date=today + timedelta(days=5),
            compte_id=courant.id,
            categorie_id=_categorie_id(db, "Prêts"),
            nature="Prêt de Paul",
            montant=200.0,
            statut=Statut.reel,
        ),
    )
    crud.create_operation(
        db,
        schemas.OperationCreate(
            date=today + timedelta(days=15),
            compte_id=courant.id,
            categorie_id=_categorie_id(db, "Remboursement prêts"),
            nature="Premier remboursement à Paul",
            montant=80.0,
            statut=Statut.reel,
            operations_remboursees=[
                schemas.OperationRembourseeInput(operation_id=pret.id, montant=80.0)
            ],
        ),
    )

    # Quelques budgets alloués (mois courant) pour que l'histogramme du dashboard ait du relief.
    for nom, budget in [("Alimentaire", 300.0), ("Loisirs & sorties", 150.0), ("Charges fixes", 700.0)]:
        categorie = crud.get_categorie_by_nom(db, nom)
        crud.set_budget_categorie(db, categorie.id, today.year, today.month, budget)

    print("Seed dev terminé.")


if __name__ == "__main__":
    print(f"Base ciblée : {SQLALCHEMY_DATABASE_URL}")
    session = SessionLocal()
    try:
        seed(session)
    finally:
        session.close()
