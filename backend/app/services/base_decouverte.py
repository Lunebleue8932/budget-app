"""La base de DÉCOUVERTE : ce que le tutoriel « Prendre l'application en main » regarde.

POURQUOI UNE BASE FABRIQUÉE, ET NON UN FICHIER LIVRÉ. Un `.db` embarqué resterait
figé au schéma du jour de sa fabrication : la première migration le rendrait
illisible, ou imposerait de le migrer à chaque lancement. Celle-ci est fabriquée
par les migrations elles-mêmes (donc toujours au schéma courant, avec les
catégories, la monnaie et les types livrés), puis REMPLIE ici de quoi illustrer
chaque phrase du tutoriel.

CE QU'ELLE CONTIENT, et pourquoi :
 - deux comptes, « Compte A » (courant) et « Compte B » (épargne) : les cartes
   du haut, le solde total qui ne compte que les comptes courants, les virements
   internes ;
 - des dépenses et des entrées d'argent sur le mois en cours et les deux
   précédents, dans les catégories livrées : les graphiques, les filtres, le
   choix de la période ;
 - un virement interne par mois (A vers B) ;
 - UNE dépense découpée, UNE dépense amortie sur plusieurs mois et UNE dépense
   prévisionnelle : ce sont les propriétés spéciales de l'étape 8, et c'est
   aussi ce qui fait diverger la « variation attribuée au mois » de la variation
   brute (étape 4) — sans elles, le bouton « d'où vient l'écart ? » n'apparaîtrait
   jamais.

LES DATES SUIVENT LE JOUR OÙ ON LA FABRIQUE : un tutoriel qui s'ouvre sur un
dashboard vide parce que les données datent de l'an dernier n'illustre rien. Dans
le mois en cours, aucun jour n'est postérieur à aujourd'hui (sauf la dépense
prévisionnelle, qui l'est par définition).
"""
from __future__ import annotations

import calendar
from datetime import date, timedelta
from pathlib import Path

from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker

from .. import crud, database, models, schemas
from ..constants import (
    CATEGORIE_ENTREES_ARGENT,
    TYPE_COMPTE_COURANT,
    TYPE_COMPTE_EPARGNE,
    Statut,
    TypeOperation,
)

NOM_FICHIER = "budget-app-decouverte.db"
NOM_COMPTE_A = "Compte A"
NOM_COMPTE_B = "Compte B"


def chemin_decouverte() -> Path:
    """Où la fabriquer : le dossier temporaire du système, hors de tout dossier
    de données de l'utilisateur."""
    import tempfile

    return Path(tempfile.gettempdir()) / "budget-app-decouverte" / NOM_FICHIER


def _reculer(jour: date, mois: int) -> date:
    """Le 1er du mois situé `mois` mois avant celui de `jour`."""
    total = jour.year * 12 + (jour.month - 1) - mois
    return date(total // 12, total % 12 + 1, 1)


# (jour du mois, nature, catégorie, montant). Un seul gabarit pour les trois mois :
# les chiffres ne bougent pas, seules les dates suivent le calendrier.
_DEPENSES_MENSUELLES = [
    (2, "Loyer", "Charges fixes", 750.00),
    (3, "Courses", "Alimentaire", 62.40),
    (5, "Abonnement transport", "Transports", 75.00),
    (9, "Restaurant", "Loisirs", 38.00),
    (11, "Courses", "Alimentaire", 48.10),
    (16, "Cinéma", "Loisirs", 24.00),
    (18, "Courses", "Alimentaire", 71.85),
    (20, "Essence", "Transports", 54.20),
    (23, "Restaurant", "Loisirs", 29.50),
    (25, "Courses", "Alimentaire", 55.30),
]

# POURQUOI DES NOMS QUI SE RÉPÈTENT. L'infobulle d'une catégorie regroupe les dépenses de même
# nom et écrit leur nombre entre parenthèses : « Courses (4) ». Avec des noms tous différents,
# ces parenthèses n'apparaîtraient jamais, et l'étape du tutoriel qui les décrit n'aurait rien
# à montrer.


def _jour_valide(premier: date, jour: int, aujourdhui: date) -> date:
    """Le `jour` du mois de `premier`, ramené au dernier jour du mois s'il n'y
    en a pas autant, et à aujourd'hui dans le mois en cours (rien de réel n'a
    lieu demain)."""
    dernier = calendar.monthrange(premier.year, premier.month)[1]
    voulu = date(premier.year, premier.month, min(jour, dernier))
    return min(voulu, aujourdhui)


def remplir(db, aujourdhui: date) -> None:
    """Pose les comptes et les opérations de la découverte dans une base neuve."""
    courant = db.query(models.TypeCompte).filter(models.TypeCompte.nom == TYPE_COMPTE_COURANT).one()
    epargne = db.query(models.TypeCompte).filter(models.TypeCompte.nom == TYPE_COMPTE_EPARGNE).one()
    monnaie = crud.get_monnaies(db)[0]

    def creer_compte(nom, type_compte, solde):
        return crud.create_compte(
            db,
            schemas.CompteCreate(
                nom=nom,
                type_id=type_compte.id,
                monnaies=[schemas.CompteMonnaieInput(monnaie_id=monnaie.id, solde_initial=solde)],
            ),
        )

    compte_a = creer_compte(NOM_COMPTE_A, courant, 1500.00)
    compte_b = creer_compte(NOM_COMPTE_B, epargne, 3000.00)

    categories = {c.nom: c for c in crud.get_categories(db)}
    type_classique = crud.get_type_operation_par_code(db, TypeOperation.classique.value)

    def operation(jour, nature, categorie, montant, **champs):
        return crud.create_operation(
            db,
            schemas.OperationCreate(
                date=jour,
                compte_id=compte_a.id,
                monnaie_id=monnaie.id,
                type_id=type_classique.id,
                categorie_id=categories[categorie].id if categorie else None,
                nature=nature,
                montant=montant,
                statut=champs.pop("statut", Statut.reel),
                **champs,
            ),
        )

    for mois_avant in (2, 1, 0):
        premier = _reculer(aujourdhui, mois_avant)
        operation(
            _jour_valide(premier, 1, aujourdhui),
            "Salaire",
            CATEGORIE_ENTREES_ARGENT,
            2200.00,
        )
        for jour, nature, categorie, montant in _DEPENSES_MENSUELLES:
            operation(_jour_valide(premier, jour, aujourdhui), nature, categorie, montant)
        crud.create_virement(
            db,
            schemas.VirementCreate(
                date=_jour_valide(premier, 6, aujourdhui),
                compte_source_id=compte_a.id,
                compte_destination_id=compte_b.id,
                montant=300.00,
                monnaie_id=monnaie.id,
                nature="Mise de côté",
            ),
            compte_a,
            compte_b,
        )

    # UNE DÉPENSE DÉCOUPÉE : un plein de courses dont une part de ménager.
    mois_precedent = _reculer(aujourdhui, 1)
    operation(
        _jour_valide(mois_precedent, 14, aujourdhui),
        "Courses et produits ménagers",
        None,
        85.00,
        decoupes=[
            schemas.DecoupeInput(categorie_id=categories["Alimentaire"].id, montant=55.00),
            schemas.DecoupeInput(categorie_id=categories["Autres"].id, montant=30.00),
        ],
    )

    # UNE DÉPENSE AMORTIE : un achat qui pèse sur douze mois, à partir du mois dernier.
    operation(
        _jour_valide(mois_precedent, 12, aujourdhui),
        "Ordinateur portable",
        "Autres",
        1200.00,
        amorti=True,
        amortissement_debut=mois_precedent,
        amortissement_fin=_reculer(aujourdhui, -10),
    )

    # UNE DÉPENSE PRÉVISIONNELLE : pas encore passée, elle pèse sur le solde prévisionnel.
    operation(
        aujourdhui + timedelta(days=10),
        "Assurance habitation",
        "Charges fixes",
        45.00,
        statut=Statut.previsionnel,
    )


def fabriquer(chemin: Path | None = None, aujourdhui: date | None = None) -> Path:
    """Fabrique (en l'écrasant) la base de découverte et rend son chemin.

    La base est créée par les migrations puis remplie dans une connexion à
    elle : l'application n'y bascule pas ici (cf. database.entrer_decouverte)."""
    chemin = chemin or chemin_decouverte()
    aujourdhui = aujourdhui or date.today()
    chemin.parent.mkdir(parents=True, exist_ok=True)
    for suffixe in ("", "-wal", "-shm", "-journal"):
        chemin.with_name(chemin.name + suffixe).unlink(missing_ok=True)

    database.creer_base_neuve(chemin)

    moteur = create_engine(f"sqlite:///{chemin.as_posix()}", connect_args={"check_same_thread": False})

    @event.listens_for(moteur, "connect")
    def _cles_etrangeres(dbapi_connection, connection_record):
        curseur = dbapi_connection.cursor()
        curseur.execute("PRAGMA foreign_keys=ON")
        curseur.close()

    try:
        with sessionmaker(bind=moteur)() as db:
            remplir(db, aujourdhui)
    finally:
        moteur.dispose()
    return chemin
