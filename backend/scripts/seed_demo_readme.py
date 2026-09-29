"""Génère un jeu de données FICTIF pour les captures d'écran des README :
six mois d'historique (avril -> septembre 2026), des objectifs, un projet,
des remboursements, des virements d'épargne et un petit portefeuille.

Cible TOUJOURS le fichier désigné par BUDGET_DB_PATH, jamais la base de dev ni
la base personnelle. La base doit déjà être migrée (`alembic upgrade head` avec
la même variable). Idempotent : refuse si des comptes existent déjà.

Les montants sont tirés au hasard mais avec une graine fixe : relancer le script
sur une base neuve redonne exactement les mêmes captures.

Usage (depuis backend/) :
    $env:BUDGET_DB_PATH = "data\\dev\\demo_readme.db"
    .venv\\Scripts\\alembic.exe upgrade head
    .venv\\Scripts\\python.exe scripts\\seed_demo_readme.py
"""
import random
import sys
from datetime import date, timedelta
from pathlib import Path

sys.path.append(str(Path(__file__).resolve().parents[1]))
sys.path.append(str(Path(__file__).resolve().parents[2] / "extensions" / "objectifs"))

from app import crud, models, schemas  # noqa: E402
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

AUJOURDHUI = date(2026, 9, 29)
MOIS = [(2026, m) for m in range(4, 10)]  # avril -> septembre


def _cat(db, nom):
    c = crud.get_categorie_by_nom(db, nom)
    if c is None:
        c = crud.create_categorie(db, schemas.CategorieCreate(nom=nom))
    return c.id


def _type(db, code):
    return crud.get_type_operation_par_code(db, code).id


def seed(db) -> None:
    if crud.get_comptes(db):
        print("Des comptes existent déjà dans cette base : seed ignoré (idempotent).")
        return
    rng = random.Random(2026)

    eur = crud.get_monnaies(db)[0].id
    t_courant = crud.get_type_compte_by_nom(db, TYPE_COMPTE_COURANT).id
    t_epargne = crud.get_type_compte_by_nom(db, TYPE_COMPTE_EPARGNE).id
    t_placement = crud.get_type_compte_by_nom(db, TYPE_COMPTE_PLACEMENT).id

    # ---------- Catégories : le jeu livré + quelques postes courants ----------
    alimentaire = _cat(db, "Alimentaire")
    loisirs = _cat(db, "Loisirs")
    transports = _cat(db, "Transports")
    fixes = _cat(db, "Charges fixes")
    autres = _cat(db, "Autres")
    entrees = _cat(db, "Entrées d'argent")
    restos = _cat(db, "Restaurants")
    sante = _cat(db, "Santé")
    abonnements = _cat(db, "Abonnements")
    voyages = _cat(db, "Voyages")

    # ---------- Comptes ----------
    def compte(nom, type_id, solde):
        return crud.create_compte(
            db,
            schemas.CompteCreate(
                nom=nom,
                type_id=type_id,
                monnaies=[schemas.CompteMonnaieInput(monnaie_id=eur, solde_initial=solde)],
            ),
        )

    courant = compte("Compte Courant", t_courant, 2100.0)
    livret = compte("Livret A", t_epargne, 5200.0)
    pea = compte("PEA", t_placement, 0.0)

    t_classique = _type(db, TypeOperation.classique.value)
    t_rembours = _type(db, TypeOperation.remboursable.value)
    t_rbt = _type(db, TypeOperation.remboursements.value)

    def op(jour, cat, nature, montant, type_id=None, **extra):
        return crud.create_operation(
            db,
            schemas.OperationCreate(
                date=jour, compte_id=courant.id, type_id=type_id or t_classique,
                categorie_id=cat, nature=nature, montant=montant, monnaie_id=eur,
                statut=Statut.reel if jour <= AUJOURDHUI else Statut.previsionnel,
                **extra,
            ),
        )

    def alea(bas, haut):
        return round(rng.uniform(bas, haut), 2)

    # ---------- Six mois de vie courante ----------
    for annee, mois in MOIS:
        def j(jour):
            return date(annee, mois, jour)

        op(j(1), entrees, "Salaire", 2450.0 + (100.0 if mois >= 7 else 0.0))
        op(j(3), fixes, "Loyer", 780.0)
        op(j(5), fixes, "Électricité", alea(48, 72))
        op(j(6), abonnements, "Internet", 29.99)
        op(j(8), abonnements, "Streaming vidéo", 13.49)
        op(j(9), abonnements, "Salle de sport", 34.90)
        op(j(12), transports, "Pass Navigo", 88.80)

        for semaine in range(4):
            jour = 4 + semaine * 7 + rng.randint(0, 2)
            magasin = rng.choice(["Carrefour", "Monoprix", "Lidl", "Biocoop", "Picard"])
            op(j(min(jour, 28)), alimentaire, f"Courses {magasin}", alea(38, 96))
        for _ in range(rng.randint(2, 4)):
            op(j(rng.randint(2, 28)), restos,
               rng.choice(["Restaurant", "Brasserie", "Sushis", "Pizzeria", "Café"]), alea(14, 58))
        for _ in range(rng.randint(1, 3)):
            op(j(rng.randint(2, 28)), loisirs,
               rng.choice(["Cinéma", "Concert", "Escape game", "Bowling", "Livre"]), alea(9, 45))
        if rng.random() < 0.5:
            op(j(rng.randint(10, 26)), sante,
               rng.choice(["Pharmacie", "Médecin", "Opticien"]), alea(12, 45))
        if rng.random() < 0.4:
            op(j(rng.randint(10, 26)), transports, "Taxi", alea(12, 30))
        if mois in (5, 8):
            op(j(rng.randint(14, 24)), autres, "Cadeau", alea(30, 70))

    # Un achat amorti : ordinateur à 1 200 € étalé sur six mois.
    op(date(2026, 6, 14), autres, "Ordinateur portable", 1200.0,
       amorti=True, amortissement_debut=date(2026, 6, 1), amortissement_fin=date(2026, 11, 1))

    # ---------- Projet : un voyage en août ----------
    projet = crud.create_sous_filtre(db, nom="Vacances en Italie", description="Deux semaines en août")
    voyage = [
        (date(2026, 7, 10), "Billets de train", 186.0),
        (date(2026, 7, 28), "Hôtel Rome (4 nuits)", 420.0),
        (date(2026, 8, 12), "Restaurants Rome", 138.5),
        (date(2026, 8, 14), "Musées et visites", 64.0),
        (date(2026, 8, 18), "Location voiture Toscane", 210.0),
        (date(2026, 8, 20), "Agriturismo Toscane", 340.0),
        (date(2026, 8, 22), "Restaurants Toscane", 172.3),
    ]
    for jour, nature, montant in voyage:
        operation = op(jour, voyages, nature, montant)
        operation.sous_filtres.append(projet)
    db.commit()

    # ---------- Remboursements : une soldée, une partielle, une en attente ----------
    resto = op(date(2026, 8, 3), restos, "Dîner d'anniversaire", 96.0, type_id=t_rembours, montant_du=64.0)
    op(date(2026, 8, 9), entrees, "Remboursement de Léa", 64.0, type_id=t_rbt,
       operations_remboursees=[schemas.OperationRembourseeInput(operation_id=resto.id, montant=64.0)])
    loc = op(date(2026, 9, 2), fixes, "Facture énergie colocation", 180.0, type_id=t_rembours, montant_du=90.0)
    op(date(2026, 9, 14), entrees, "Remboursement partiel de Sam", 40.0, type_id=t_rbt,
       operations_remboursees=[schemas.OperationRembourseeInput(operation_id=loc.id, montant=40.0)])
    op(date(2026, 9, 20), loisirs, "Cadeau commun collègue", 75.0, type_id=t_rembours, montant_du=45.0)

    # ---------- Épargne ----------
    for annee, mois in MOIS:
        crud.create_virement(
            db,
            schemas.VirementCreate(
                date=date(annee, mois, 5), compte_source_id=courant.id,
                compte_destination_id=livret.id, montant=300.0 + 50.0 * (mois >= 7),
                monnaie_id=eur, nature="Épargne du mois", statut=Statut.reel,
            ),
            courant, livret,
        )
    crud.create_virement(
        db,
        schemas.VirementCreate(
            date=date(2026, 5, 15), compte_source_id=courant.id, compte_destination_id=pea.id,
            montant=2500.0, monnaie_id=eur, nature="Alimentation PEA", statut=Statut.reel,
        ),
        courant, pea,
    )

    # ---------- Placements ----------
    etf = crud.create_action(db, "ETF MSCI World", eur, valeur=98.60)
    total = crud.create_action(db, "TotalEnergies", eur, valeur=61.40)
    for action, sens, qte, prix, jour in [
        (etf, SensAction.achat, 15, 89.20, date(2026, 5, 20)),
        (total, SensAction.achat, 10, 57.80, date(2026, 6, 8)),
        (etf, SensAction.achat, 8, 93.10, date(2026, 7, 6)),
        (total, SensAction.vente, 4, 63.00, date(2026, 9, 10)),
    ]:
        crud.create_operation_action(
            db, compte_id=pea.id, action=action, sens=sens,
            quantite=qte, prix_unitaire=prix, date_operation=jour,
        )

    # ---------- Récurrentes de septembre : octobre se génère en prévisionnel ----------
    for jour, cat, nature, montant in [
        (date(2026, 9, 1), entrees, "Salaire", 2550.0),
        (date(2026, 9, 3), fixes, "Loyer", 780.0),
    ]:
        # Les modèles récurrents SONT les opérations de septembre déjà saisies :
        # on les marque plutôt que d'en créer de doublons.
        existante = (
            db.query(models.Operation)
            .filter(models.Operation.date == jour, models.Operation.nature == nature)
            .first()
        )
        existante.recurrente = True
        existante.frequence = Frequence.mensuelle.value
    db.commit()
    crud.generer_occurrences_recurrentes(db)

    # ---------- Budgets : enveloppes de juillet à septembre + total ----------
    for annee, mois in [(2026, 7), (2026, 8), (2026, 9)]:
        crud.set_budget_total(db, annee, mois, eur, 2100.0)
        for cat, montant in [(alimentaire, 300.0), (restos, 120.0), (loisirs, 90.0), (transports, 110.0)]:
            crud.set_budget_categorie(db, cat, annee, mois, eur, montant)

    # ---------- Objectifs (extension « Objectifs ») ----------
    objectifs = [
        ("Courses : 300 € par mois", "montant_total", "mois", "max", 300.0, alimentaire, None),
        ("Restaurants : 4 sorties par semaine max", "nombre", "semaine", "max", 4, restos, None),
        ("Ticket moyen resto sous 35 €", "montant_moyen", "mois", "max", 35.0, restos, None),
        ("Loisirs : 10 % du budget", "part_depenses", "mois", "max", 10.0, loisirs, None),
        ("Vacances en Italie", "montant_total", "mois", "max", 1500.0, None, projet.id),
        ("Santé : garder un œil", "montant_total", "mois", "max", None, sante, None),
    ]
    for ordre, (nom, mesure, cadence, sens, cible, cat, sf) in enumerate(objectifs):
        db.add(models.ObjectifKpi(
            nom=nom, mesure=mesure, cadence=cadence, sens=sens, cible=cible,
            categorie_id=cat, sous_filtre_id=sf, monnaie_id=eur,
            visible_dashboard=True, ordre=ordre, filtres=[],
        ))
    db.commit()

    print("Seed démo README terminé.")


if __name__ == "__main__":
    print(f"Base ciblée : {SQLALCHEMY_DATABASE_URL}")
    session = SessionLocal()
    try:
        seed(session)
    finally:
        session.close()
