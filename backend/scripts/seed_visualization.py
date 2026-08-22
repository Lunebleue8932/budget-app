"""Génère un jeu de données FICTIF, large et varié, dans une base dédiée
« visualization_dataset.db » — pour présenter l'application sans exposer de
données personnelles.

Couvre volontairement toutes les fonctionnalités présentables : plusieurs
comptes (courant, épargne, multi-devises, compte-titres), plusieurs monnaies
(EUR/USD/GBP), toutes les catégories par défaut, dépenses remboursables
(soldées, partielles, en attente), prêts (soldé, en attente), virements
internes (même monnaie, conversion au sein d'un compte, virement entre deux
monnaies différentes), une opération récurrente, une opération amortie,
statuts réel/prévisionnel, budgets mensuels, et un portefeuille de titres
(achats, vente partielle, plus-value).

Cible TOUJOURS le fichier désigné par BUDGET_DB_PATH, jamais la base de dev :
la même protection que seed_dev.py. Idempotent comme lui (refuse si des
comptes existent déjà).

Usage :
    $env:BUDGET_DB_PATH = "chemin\\vers\\visualization_dataset.db"
    .venv\\Scripts\\python.exe scripts\\seed_visualization.py
"""
import sys
from datetime import date
from pathlib import Path

sys.path.append(str(Path(__file__).resolve().parents[1]))

from app import crud, schemas  # noqa: E402
from app.constants import (  # noqa: E402
    Frequence,
    SensAction,
    Statut,
    TYPE_COMPTE_COURANT,
    TYPE_COMPTE_EPARGNE,
    TYPE_COMPTE_PLACEMENT,
    TypeOperation,
)
from app.database import SessionLocal, SQLALCHEMY_DATABASE_URL  # noqa: E402


def _categorie_id(db, nom):
    categorie = crud.get_categorie_by_nom(db, nom)
    if categorie is None:
        raise RuntimeError(f"Catégorie '{nom}' introuvable — les migrations ont-elles tourné ?")
    return categorie.id


def _type_id(db, code):
    type_operation = crud.get_type_operation_par_code(db, code)
    if type_operation is None:
        raise RuntimeError(f"Type d'opération '{code}' introuvable — les migrations ont-elles tourné ?")
    return type_operation.id


def _type_compte_id(db, nom):
    type_compte = crud.get_type_compte_by_nom(db, nom)
    if type_compte is None:
        raise RuntimeError(f"Type de compte '{nom}' introuvable — les migrations ont-elles tourné ?")
    return type_compte.id


def seed(db) -> None:
    if crud.get_comptes(db):
        print("Des comptes existent déjà dans cette base : seed ignoré (idempotent).")
        return

    # ---------- Monnaies ----------
    # L'euro existe déjà (seed de migration 0021) : on ajoute de quoi montrer
    # un compte multi-devises et un virement entre deux monnaies différentes.
    eur_id = crud.get_monnaies(db)[0].id
    usd = crud.create_monnaie(db, "Dollar américain", "$")
    gbp = crud.create_monnaie(db, "Livre sterling", "£")

    # ---------- Comptes ----------
    type_courant = _type_compte_id(db, TYPE_COMPTE_COURANT)
    type_epargne = _type_compte_id(db, TYPE_COMPTE_EPARGNE)
    type_placement = _type_compte_id(db, TYPE_COMPTE_PLACEMENT)

    courant = crud.create_compte(
        db,
        schemas.CompteCreate(
            nom="Compte Courant",
            type_id=type_courant,
            monnaies=[schemas.CompteMonnaieInput(monnaie_id=eur_id, solde_initial=1800.0)],
        ),
    )
    livret = crud.create_compte(
        db,
        schemas.CompteCreate(
            nom="Livret A",
            type_id=type_epargne,
            monnaies=[schemas.CompteMonnaieInput(monnaie_id=eur_id, solde_initial=6000.0)],
        ),
    )
    # Multi-devises : un compte qui porte trois monnaies distinctes, jamais
    # additionnées (cf. constants.py). Alimenté plus bas par virements, y
    # compris une conversion EUR -> USD SUR ce même compte.
    voyage = crud.create_compte(
        db,
        schemas.CompteCreate(
            nom="Compte Voyage",
            type_id=type_courant,
            monnaies=[
                schemas.CompteMonnaieInput(monnaie_id=eur_id, solde_initial=0.0),
                schemas.CompteMonnaieInput(monnaie_id=usd.id, solde_initial=0.0),
                schemas.CompteMonnaieInput(monnaie_id=gbp.id, solde_initial=0.0),
            ],
        ),
    )
    pea = crud.create_compte(
        db,
        schemas.CompteCreate(
            nom="PEA",
            type_id=type_placement,
            monnaies=[schemas.CompteMonnaieInput(monnaie_id=eur_id, solde_initial=0.0)],
        ),
    )

    # ---------- Types d'opération ----------
    t_classique = _type_id(db, TypeOperation.classique.value)
    t_remboursable = _type_id(db, TypeOperation.remboursable.value)
    t_remboursements = _type_id(db, TypeOperation.remboursements.value)
    t_pret = _type_id(db, TypeOperation.pret.value)
    t_remboursement_pret = _type_id(db, TypeOperation.remboursement_pret.value)

    def depense(jour, categorie, nature, montant, compte=courant, monnaie=eur_id, statut=Statut.reel):
        crud.create_operation(
            db,
            schemas.OperationCreate(
                date=jour,
                compte_id=compte.id,
                type_id=t_classique,
                categorie_id=_categorie_id(db, categorie),
                nature=nature,
                montant=montant,
                monnaie_id=monnaie,
                statut=statut,
            ),
        )

    def entree(jour, nature, montant, compte=courant, monnaie=eur_id, statut=Statut.reel):
        depense(jour, "Entrées d'argent", nature, montant, compte, monnaie, statut)

    # ---------- Historique mensuel (avril -> juillet 2026), tout réel ----------
    mois = [
        (
            date(2026, 4, 1), date(2026, 4, 3), date(2026, 4, 5),
            [
                (date(2026, 4, 6), "Alimentaire", "Courses Carrefour", 62.30),
                (date(2026, 4, 12), "Alimentaire", "Courses Monoprix", 48.10),
                (date(2026, 4, 14), "Loisirs & sorties", "Ciné avec Julie", 24.00),
                (date(2026, 4, 20), "Alimentaire", "Courses Lidl", 55.75),
                (date(2026, 4, 22), "Vêtements & équipement sport", "Chaussures de running", 89.99),
            ],
            2400.0, 750.0,
        ),
        (
            date(2026, 5, 1), date(2026, 5, 3), date(2026, 5, 5),
            [
                (date(2026, 5, 7), "Alimentaire", "Courses Carrefour", 58.40),
                (date(2026, 5, 11), "Loisirs & sorties", "Restaurant italien", 46.50),
                (date(2026, 5, 15), "Alimentaire", "Courses Monoprix", 51.20),
                (date(2026, 5, 19), "Autres", "Pharmacie", 18.30),
                (date(2026, 5, 26), "Alimentaire", "Courses Lidl", 60.10),
            ],
            2400.0, 750.0,
        ),
        (
            date(2026, 6, 1), date(2026, 6, 3), date(2026, 6, 5),
            [
                (date(2026, 6, 9), "Alimentaire", "Courses Carrefour", 64.75),
                (date(2026, 6, 13), "Réparation & entretien", "Réparation vélo", 55.00),
                (date(2026, 6, 17), "Alimentaire", "Courses Monoprix", 49.90),
                (date(2026, 6, 21), "Loisirs & sorties", "Concert", 65.00),
                (date(2026, 6, 27), "Alimentaire", "Courses Lidl", 57.20),
                (date(2026, 6, 29), "Vêtements & équipement sport", "Jean et t-shirt", 74.50),
            ],
            2400.0, 750.0,
        ),
        (
            date(2026, 7, 1), date(2026, 7, 3), date(2026, 7, 5),
            [
                (date(2026, 7, 8), "Alimentaire", "Courses Carrefour", 66.10),
                (date(2026, 7, 12), "Loisirs & sorties", "Restaurant plage", 52.00),
                (date(2026, 7, 16), "Alimentaire", "Courses Monoprix", 53.30),
                (date(2026, 7, 20), "Réparation & entretien", "Contrôle technique voiture", 133.00),
                (date(2026, 7, 24), "Alimentaire", "Courses Lidl", 61.90),
                (date(2026, 7, 30), "Autres", "Livre et fournitures", 28.40),
            ],
            2400.0, 750.0,
        ),
    ]
    for jour_salaire, jour_loyer, jour_abo, lignes, montant_salaire, montant_loyer in mois:
        entree(jour_salaire, "Salaire", montant_salaire)
        depense(jour_loyer, "Charges fixes", "Loyer", montant_loyer)
        depense(jour_abo, "Charges fixes", "Abonnement Internet", 39.90)
        for jour, categorie, nature, montant in lignes:
            depense(jour, categorie, nature, montant)

    # Dépense amortie : payée une fois, mais pesant sur 6 mois de suivi
    # budgétaire (cf. models.Operation.amorti et services/soldes.py).
    crud.create_operation(
        db,
        schemas.OperationCreate(
            date=date(2026, 6, 10),
            compte_id=courant.id,
            type_id=t_classique,
            categorie_id=_categorie_id(db, "Autres"),
            nature="Ordinateur portable",
            montant=1200.0,
            monnaie_id=eur_id,
            statut=Statut.reel,
            amorti=True,
            amortissement_debut=date(2026, 6, 1),
            amortissement_fin=date(2026, 11, 1),
        ),
    )

    # ---------- Août 2026 : le mois en cours, dont le début est déjà réel
    # ---------- (salaire, loyer, abonnement portés par une opération
    # ---------- RÉCURRENTE — le mois suivant se génère alors tout seul, en
    # ---------- prévisionnel, à la prochaine ouverture de l'app).
    crud.create_operation(
        db,
        schemas.OperationCreate(
            date=date(2026, 8, 1), compte_id=courant.id, type_id=t_classique,
            categorie_id=_categorie_id(db, "Entrées d'argent"), nature="Salaire",
            montant=2400.0, monnaie_id=eur_id, statut=Statut.reel,
            recurrente=True, frequence=Frequence.mensuelle,
        ),
    )
    crud.create_operation(
        db,
        schemas.OperationCreate(
            date=date(2026, 8, 3), compte_id=courant.id, type_id=t_classique,
            categorie_id=_categorie_id(db, "Charges fixes"), nature="Loyer",
            montant=750.0, monnaie_id=eur_id, statut=Statut.reel,
            recurrente=True, frequence=Frequence.mensuelle,
        ),
    )
    crud.create_operation(
        db,
        schemas.OperationCreate(
            date=date(2026, 8, 5), compte_id=courant.id, type_id=t_classique,
            categorie_id=_categorie_id(db, "Charges fixes"), nature="Abonnement Internet",
            montant=39.90, monnaie_id=eur_id, statut=Statut.reel,
            recurrente=True, frequence=Frequence.mensuelle,
        ),
    )
    for jour, categorie, nature, montant in [
        (date(2026, 8, 7), "Alimentaire", "Courses Carrefour", 59.60),
        (date(2026, 8, 11), "Alimentaire", "Courses Monoprix", 47.85),
        (date(2026, 8, 15), "Loisirs & sorties", "Sortie bowling", 38.00),
        (date(2026, 8, 18), "Alimentaire", "Courses Lidl", 52.40),
    ]:
        depense(jour, categorie, nature, montant)

    # ---------- Dépenses remboursables : soldée, partielle, en attente ----------
    resto = crud.create_operation(
        db,
        schemas.OperationCreate(
            date=date(2026, 7, 14), compte_id=courant.id, type_id=t_remboursable,
            categorie_id=_categorie_id(db, "Loisirs & sorties"), nature="Resto entre amis",
            montant=80.0, montant_du=40.0, monnaie_id=eur_id, statut=Statut.reel,
        ),
    )
    crud.create_operation(
        db,
        schemas.OperationCreate(
            date=date(2026, 7, 20), compte_id=courant.id, type_id=t_remboursements,
            nature="Remboursement de Léa", montant=40.0, monnaie_id=eur_id, statut=Statut.reel,
            operations_remboursees=[schemas.OperationRembourseeInput(operation_id=resto.id, montant=40.0)],
        ),
    )

    electricite = crud.create_operation(
        db,
        schemas.OperationCreate(
            date=date(2026, 7, 5), compte_id=courant.id, type_id=t_remboursable,
            categorie_id=_categorie_id(db, "Charges fixes"), nature="Facture électricité colocation",
            montant=150.0, montant_du=100.0, monnaie_id=eur_id, statut=Statut.reel,
        ),
    )
    crud.create_operation(
        db,
        schemas.OperationCreate(
            date=date(2026, 7, 25), compte_id=courant.id, type_id=t_remboursements,
            nature="Remboursement partiel élec de Sam", montant=60.0, monnaie_id=eur_id, statut=Statut.reel,
            operations_remboursees=[schemas.OperationRembourseeInput(operation_id=electricite.id, montant=60.0)],
        ),
    )

    crud.create_operation(
        db,
        schemas.OperationCreate(
            date=date(2026, 8, 2), compte_id=courant.id, type_id=t_remboursable,
            categorie_id=_categorie_id(db, "Loisirs & sorties"), nature="Cadeau anniversaire commun",
            montant=60.0, montant_du=30.0, monnaie_id=eur_id, statut=Statut.reel,
        ),
    )

    # ---------- Prêts reçus : soldé, en attente ----------
    pret_marie = crud.create_operation(
        db,
        schemas.OperationCreate(
            date=date(2026, 5, 10), compte_id=courant.id, type_id=t_pret,
            nature="Prêt de Marie", montant=500.0, monnaie_id=eur_id, statut=Statut.reel,
        ),
    )
    crud.create_operation(
        db,
        schemas.OperationCreate(
            date=date(2026, 6, 10), compte_id=courant.id, type_id=t_remboursement_pret,
            nature="1er remboursement à Marie", montant=200.0, monnaie_id=eur_id, statut=Statut.reel,
            operations_remboursees=[schemas.OperationRembourseeInput(operation_id=pret_marie.id, montant=200.0)],
        ),
    )
    crud.create_operation(
        db,
        schemas.OperationCreate(
            date=date(2026, 7, 10), compte_id=courant.id, type_id=t_remboursement_pret,
            nature="2e remboursement à Marie", montant=300.0, monnaie_id=eur_id, statut=Statut.reel,
            operations_remboursees=[schemas.OperationRembourseeInput(operation_id=pret_marie.id, montant=300.0)],
        ),
    )
    crud.create_operation(
        db,
        schemas.OperationCreate(
            date=date(2026, 8, 5), compte_id=courant.id, type_id=t_pret,
            nature="Prêt voiture à Tom", montant=1000.0, monnaie_id=eur_id, statut=Statut.reel,
        ),
    )

    # ---------- Virements internes ----------
    def virement(jour, source, cible, montant, monnaie_source=eur_id, montant_dest=None, monnaie_dest=None, nature="Virement"):
        crud.create_virement(
            db,
            schemas.VirementCreate(
                date=jour, compte_source_id=source.id, compte_destination_id=cible.id,
                montant=montant, monnaie_id=monnaie_source,
                montant_destination=montant_dest, monnaie_destination_id=monnaie_dest,
                nature=nature, statut=Statut.reel,
            ),
            source, cible,
        )

    # Même monnaie, mensuel (montant croissant, comme une épargne qu'on augmente).
    for jour, montant in [
        (date(2026, 4, 5), 300.0), (date(2026, 5, 5), 300.0), (date(2026, 6, 5), 350.0),
        (date(2026, 7, 5), 350.0), (date(2026, 8, 5), 400.0),
    ]:
        virement(jour, courant, livret, montant, nature="Épargne du mois")

    # Finance le compte multi-devises, puis conversion interne EUR -> USD SUR
    # ce même compte (cf. VirementCreate : source == destination, monnaies
    # différentes).
    virement(date(2026, 6, 15), courant, voyage, 500.0, nature="Provision voyage")
    virement(
        date(2026, 6, 16), voyage, voyage, 500.0,
        montant_dest=540.0, monnaie_dest=usd.id, nature="Conversion EUR -> USD",
    )
    # Virement entre deux comptes ET deux monnaies différentes (aucune monnaie
    # commune requise, cf. docstring VirementCreate).
    virement(
        date(2026, 7, 2), courant, voyage, 300.0,
        montant_dest=255.0, monnaie_dest=gbp.id, nature="Achat de livres sterling",
    )

    # Finance le compte-titres.
    virement(date(2026, 5, 15), courant, pea, 3000.0, nature="Alimentation PEA")
    virement(date(2026, 7, 1), courant, pea, 1000.0, nature="Complément PEA")

    # ---------- Placements financiers ----------
    etf = crud.create_action(db, "ETF Amundi MSCI World", eur_id, valeur=265.40)
    lvmh = crud.create_action(db, "LVMH", eur_id, valeur=640.00)

    crud.create_operation_action(
        db, compte_id=pea.id, action=etf, sens=SensAction.achat,
        quantite=8, prix_unitaire=240.00, date_operation=date(2026, 5, 20),
    )
    crud.create_operation_action(
        db, compte_id=pea.id, action=lvmh, sens=SensAction.achat,
        quantite=3, prix_unitaire=600.00, date_operation=date(2026, 6, 5),
    )
    crud.create_operation_action(
        db, compte_id=pea.id, action=etf, sens=SensAction.achat,
        quantite=3, prix_unitaire=255.00, date_operation=date(2026, 7, 5),
    )
    # Vente partielle : dégage une plus-value réalisée sur une partie du
    # stock, l'autre restant détenue (plus-value LATENTE, cf. DetentionRead).
    crud.create_operation_action(
        db, compte_id=pea.id, action=lvmh, sens=SensAction.vente,
        quantite=1, prix_unitaire=650.00, date_operation=date(2026, 8, 10),
    )

    # ---------- Budgets mensuels (juillet et août, plusieurs catégories) ----------
    for annee, mois_n, nom, montant in [
        (2026, 7, "Alimentaire", 250.0), (2026, 7, "Loisirs & sorties", 150.0), (2026, 7, "Charges fixes", 850.0),
        (2026, 8, "Alimentaire", 260.0), (2026, 8, "Loisirs & sorties", 150.0), (2026, 8, "Charges fixes", 850.0),
        (2026, 8, "Vêtements & équipement sport", 100.0),
    ]:
        crud.set_budget_categorie(db, _categorie_id(db, nom), annee, mois_n, eur_id, montant)

    # Occurrence prévisionnelle du mois suivant pour les 3 modèles récurrents
    # (sinon elle n'apparaît qu'à la première lecture depuis l'app — générée
    # ici pour que la démo soit complète dès l'ouverture).
    crud.generer_occurrences_recurrentes(db)

    print("Seed visualization terminé.")


if __name__ == "__main__":
    print(f"Base ciblée : {SQLALCHEMY_DATABASE_URL}")
    session = SessionLocal()
    try:
        seed(session)
    finally:
        session.close()
