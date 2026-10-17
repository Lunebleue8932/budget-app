"""La base de DÉMO (la sandbox) : une application remplie de données fictives, pour la voir
fonctionner sans rien importer.

POURQUOI UNE BASE FABRIQUÉE, ET NON UN FICHIER LIVRÉ. Comme la base de découverte des
tutoriels (cf. base_decouverte) : un `.db` embarqué resterait figé au schéma du jour de sa
fabrication. Celle-ci est créée par les migrations elles-mêmes — donc toujours au schéma
courant, avec les catégories, la monnaie et les types livrés — puis REMPLIE ici.

CE QUI LA DIFFÈRE DE LA BASE DE DÉCOUVERTE : elle SURVIT. L'utilisateur peut y saisir ce qu'il
veut (c'est tout l'intérêt d'un bac à sable), et le retrouver à la visite suivante. Son fichier
vit donc dans le dossier de configuration du poste, jamais à côté de la base de l'utilisateur ni
dans le dossier de l'application que la mise à jour remplace. Le revers est qu'une démo vieillit :
ses dates suivent le jour où on l'a fabriquée, et une fonctionnalité ajoutée depuis n'y a aucune
donnée. D'où `VERSION` et `JOURS_AVANT_RAFRAICHIR` : l'écran PROPOSE de la refaire, sans jamais
l'effacer de lui-même.

À CHAQUE NOUVELLE FONCTIONNALITÉ, la démo doit apprendre à la montrer : une table de plus dans
`models.py` sans données ici fait échouer `tests/test_base_sandbox.py` — c'est ce test qui rend
la mise à jour de la démo impossible à oublier. Après avoir enrichi la démo, incrémenter
`VERSION`.

CE QU'ELLE CONTIENT, en une phrase par bloc (une fonction `_remplir_*` chacun) :
 - COMPTES : un courant, un livret, un compte-titres, une carte voyage en dollars ;
 - TREZE MOIS de salaires, loyers, courses, loisirs… dont les montants varient d'un mois à
   l'autre, pour que la comparaison de deux mois et les graphiques disent quelque chose ;
 - des virements internes, un change euros → dollars, un retrait d'épargne ;
 - une dépense DÉCOUPÉE, une AMORTIE, une IMPRÉVUE, une REMBOURSABLE (réglée en partie) ;
 - des PRÉVISIONNELLES et des RÉCURRENTES, qui nourrissent le solde prévisionnel ;
 - des BUDGETS par catégorie, un budget total, des objectifs de répartition, un matelas ;
 - un PROJET (le voyage, qui n'a lieu qu'une fois) et deux OBJECTIFS (ce qui se répète) ;
 - des dépenses IMPRÉVUES sur presque tous les mois, pour qu'une moyenne ait un sens ;
 - les EXTENSIONS allumées, dans la table `extension_etat` de la démo (sauf « Lecture de cours ») ;
 - un portefeuille de TITRES avec leurs répartitions, des intérêts perçus, des règles d'import.

TOUT SUIT LE JOUR OÙ ON LA FABRIQUE, et la langue d'interface du moment : les libellés (comptes,
natures, projet…) sont du texte de l'utilisateur, que la traduction de l'écran ne touche pas ; ils
sont donc écrits dans la langue demandée. Les catégories livrées, elles, gardent leur nom français,
que l'écran traduit.
"""
from __future__ import annotations

import calendar
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Optional

from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker

from .. import config_utilisateur, crud, database, models, schemas
from ..constants import (
    CATEGORIE_AUTRES,
    CATEGORIE_ENTREES_ARGENT,
    TYPE_COMPTE_COURANT,
    TYPE_COMPTE_EPARGNE,
    TYPE_COMPTE_PLACEMENT,
    AxeTitre,
    CadenceObjectif,
    DomaineImport,
    Frequence,
    MesureObjectif,
    ModeComparaison,
    SensObjectif,
    SensTitre,
    Statut,
    TypeOperation,
)
from . import base_decouverte

# À incrémenter quand la démo gagne de quoi montrer une fonctionnalité nouvelle : une démo plus
# ancienne est alors proposée au rafraîchissement.
VERSION = 2
# Au-delà, les dates de la démo ne ressemblent plus à « aujourd'hui » (le mois en cours est vide,
# le solde prévisionnel part d'un passé lointain) : on propose de la refaire.
JOURS_AVANT_RAFRAICHIR = 45

NOM_FICHIER = "budget-demo.db"
CLE_PREFERENCE = "noyau.sandbox"
LANGUES = ("fr", "en", "pt")

# Un facteur par « mois avant le mois en cours » (0 à 12), qui fait varier courses, restaurants
# et essence : des barres toutes égales ne diraient rien d'un mois à l'autre.
_FACTEURS = [1.00, 0.94, 1.07, 1.12, 0.97, 1.03, 1.18, 0.91, 1.05, 1.09, 0.96, 1.14, 1.00]

# Les enveloppes mensuelles, le budget total et les objectifs de répartition SONT LIÉS : l'enveloppe
# d'une catégorie vaut le budget total × son pourcentage (cf. crud.incoherences_budgets). Les
# écrire séparément, c'est ouvrir la fenêtre « les budgets ne s'accordent pas » dès la première
# visite de la démo.
BUDGET_TOTAL = 2000.0
_BUDGETS = {  # catégorie → enveloppe mensuelle
    "Alimentaire": 300.0,
    "Loisirs": 200.0,
    "Transports": 160.0,
    "Charges fixes": 840.0,
    "Abonnements": 45.0,
    "Santé": 60.0,
    CATEGORIE_AUTRES: 150.0,
}

# (français, anglais, portugais). Du texte d'utilisateur, jamais traduit par l'écran.
_L = {
    "compte_courant": ("Compte courant", "Checking account", "Conta corrente"),
    "compte_epargne": ("Livret d'épargne", "Savings account", "Poupança"),
    "compte_titres": ("Compte-titres", "Brokerage account", "Conta de investimentos"),
    "compte_voyage": ("Carte voyage", "Travel card", "Cartão de viagem"),
    "dollar": ("Dollar", "US Dollar", "Dólar americano"),
    "cat_sante": ("Santé", "Health", "Saúde"),
    "cat_abonnements": ("Abonnements", "Subscriptions", "Assinaturas"),
    "cat_vacances": ("Vacances", "Holidays", "Férias"),
    "salaire": ("Salaire", "Salary", "Salário"),
    "prime": ("Prime annuelle", "Annual bonus", "Bônus anual"),
    "loyer": ("Loyer", "Rent", "Aluguel"),
    "internet": ("Internet et téléphone", "Internet and phone", "Internet e telefone"),
    "streaming": ("Abonnement streaming", "Streaming subscription", "Assinatura de streaming"),
    "sport": ("Salle de sport", "Gym", "Academia"),
    "courses": ("Courses", "Groceries", "Supermercado"),
    "pass": ("Abonnement transports", "Transit pass", "Passe de transporte"),
    "essence": ("Essence", "Fuel", "Combustível"),
    "resto": ("Restaurant", "Restaurant", "Restaurante"),
    "cinema": ("Cinéma", "Cinema", "Cinema"),
    "concert": ("Concert", "Concert", "Show"),
    "pharmacie": ("Pharmacie", "Pharmacy", "Farmácia"),
    "medecin": ("Consultation médicale", "Doctor's appointment", "Consulta médica"),
    "cadeaux": ("Cadeaux de fin d'année", "Holiday gifts", "Presentes de fim de ano"),
    "epargne": ("Épargne du mois", "Monthly savings", "Poupança do mês"),
    "retrait": ("Retrait de l'épargne", "Savings withdrawal", "Retirada da poupança"),
    "alimenter": (
        "Alimentation du compte-titres",
        "Brokerage deposit",
        "Aporte na conta de investimentos",
    ),
    "change": (
        "Change euros → dollars",
        "Euros → dollars exchange",
        "Câmbio euros → dólares",
    ),
    "avion": ("Billets d'avion", "Plane tickets", "Passagens aéreas"),
    "hotel": ("Hôtel", "Hotel", "Hotel"),
    "musee": ("Musée", "Museum", "Museu"),
    "taxi": ("Taxi", "Taxi", "Táxi"),
    "epicerie": ("Épicerie", "Corner shop", "Mercadinho"),
    "ordinateur": ("Ordinateur portable", "Laptop", "Notebook"),
    "menage": (
        "Courses et produits ménagers",
        "Groceries and cleaning supplies",
        "Mercado e produtos de limpeza",
    ),
    "assurance": ("Assurance habitation", "Home insurance", "Seguro residencial"),
    "velo": ("Réparation du vélo", "Bike repair", "Conserto da bicicleta"),
    "pneu": ("Pneu crevé et réparation", "Flat tyre repair", "Pneu furado e conserto"),
    "amende": ("Amende de stationnement", "Parking fine", "Multa de estacionamento"),
    "plomberie": ("Dépannage plomberie", "Plumber call-out", "Chamado de encanador"),
    "veto": ("Frais vétérinaire", "Vet bill", "Veterinário"),
    "lunettes": ("Lunettes cassées", "Broken glasses", "Óculos quebrados"),
    "cadeau": ("Cadeau oublié", "Forgotten gift", "Presente esquecido"),
    "train": (
        "Train de dernière minute",
        "Last-minute train ticket",
        "Passagem de trem de última hora",
    ),
    "anniversaire": (
        "Restaurant d'anniversaire",
        "Birthday dinner",
        "Jantar de aniversário",
    ),
    "rembt": ("Remboursement de Camille", "Camille's repayment", "Reembolso da Camille"),
    "billets": (
        "Billets de concert pour Alex",
        "Concert tickets for Alex",
        "Ingressos de show para o Alex",
    ),
    "profil_note_1": (
        "A partagé le restaurant d'anniversaire.",
        "Shared the birthday dinner.",
        "Dividiu o jantar de aniversário.",
    ),
    "profil_note_2": (
        "Rembourse en fin de mois.",
        "Pays back at the end of the month.",
        "Reembolsa no fim do mês.",
    ),
    "projet": ("Voyage à New York", "New York trip", "Viagem a Nova York"),
    "projet_note": (
        "Avion, hôtel et sorties : tout ce que le voyage a coûté, en euros et en dollars.",
        "Flights, hotel and outings: everything the trip cost, in euros and dollars.",
        "Passagens, hotel e passeios: tudo o que a viagem custou, em euros e dólares.",
    ),
    "obj_resto": (
        "Restaurants : pas plus de 6 sorties",
        "Restaurants: no more than 6 outings",
        "Restaurantes: no máximo 6 saídas",
    ),
    "obj_courses": (
        "Panier moyen des courses",
        "Average grocery basket",
        "Valor médio das compras",
    ),
    "regle_courses": ("Courses au supermarché", "Supermarket groceries", "Compras no mercado"),
    "regle_streaming": ("Abonnement streaming", "Streaming subscription", "Assinatura de streaming"),
    "regle_note": (
        "Exemple : toute ligne qui contient ce mot est rangée dans cette catégorie.",
        "Example: any line containing this word is filed in this category.",
        "Exemplo: toda linha que contém esta palavra vai para esta categoria.",
    ),
    "note": (
        "Ceci est la démo : tout ce que tu vois est fictif. Tu peux y saisir ce que tu veux, "
        "ta vraie base n'est jamais touchée.",
        "This is the demo: everything you see is made up. Enter anything you like, "
        "your real data is never touched.",
        "Esta é a demonstração: tudo o que você vê é fictício. Pode registrar o que quiser, "
        "seus dados reais nunca são tocados.",
    ),
    "interets": ("Intérêts annuels", "Annual interest", "Juros anuais"),
    "titre_monde": (
        "ETF Monde actions (exemple)",
        "World equity ETF (sample)",
        "ETF ações mundo (exemplo)",
    ),
    "titre_oblig": (
        "ETF Obligations monde (exemple)",
        "World bond ETF (sample)",
        "ETF títulos mundo (exemplo)",
    ),
    "titre_action": ("Société Alpha (exemple)", "Alpha Corp (sample)", "Empresa Alfa (exemplo)"),
}

# Les libellés des titres qui ne se traduisent pas.
_ISIN_MONDE = "DEMO00000001"
_ISIN_OBLIG = "DEMO00000002"
_ISIN_ACTION = "DEMO00000003"


def dossier_sandbox() -> Path:
    """Le dossier de la démo, dans la configuration du poste.

    UN DOSSIER À PART POUR LES INSTALLATIONS DE MISE AU POINT : le profil est partagé par toutes
    les copies de l'application, et une copie de développement a souvent un schéma PLUS RÉCENT que
    la version publiée — celle-ci ne saurait pas ouvrir un fichier migré par l'autre."""
    nom = "sandbox-dev" if database.mode_developpement() else "sandbox"
    return config_utilisateur.dossier_config() / nom


def chemin_sandbox() -> Path:
    return dossier_sandbox() / NOM_FICHIER


def _supprimer_fichiers(chemin: Path) -> None:
    for suffixe in ("", "-wal", "-shm", "-journal"):
        chemin.with_name(chemin.name + suffixe).unlink(missing_ok=True)


def _reculer(jour: date, mois: int) -> date:
    """Le 1er du mois situé `mois` mois avant celui de `jour` (négatif : après)."""
    total = jour.year * 12 + (jour.month - 1) - mois
    return date(total // 12, total % 12 + 1, 1)


class _Contexte:
    """Ce que chaque bloc de remplissage partage : la session, les identifiants déjà créés, la
    date du jour et la langue."""

    def __init__(self, db, aujourdhui: date, langue: str):
        self.db = db
        self.aujourdhui = aujourdhui
        self.langue = langue if langue in LANGUES else "fr"
        self._rang = LANGUES.index(self.langue)
        self.euro = crud.get_monnaies(db)[0]
        self.categories: dict[str, models.Categorie] = {}
        self.type_classique = crud.get_type_operation_par_code(db, TypeOperation.classique.value)

    def t(self, cle: str) -> str:
        return _L[cle][self._rang]

    def le(self, premier: date, jour: int) -> Optional[date]:
        """Le `jour` du mois de `premier` — None s'il tombe après aujourd'hui (le mois en cours
        ne contient rien de réel dans le futur)."""
        dernier = calendar.monthrange(premier.year, premier.month)[1]
        voulu = date(premier.year, premier.month, min(jour, dernier))
        return voulu if voulu <= self.aujourdhui else None

    def au_plus(self, premier: date, jour: int) -> date:
        """Comme `le`, mais ramené à aujourd'hui plutôt qu'écarté : pour ce qu'on veut voir
        EXISTER dans le mois en cours (la remboursable en attente, par exemple)."""
        dernier = calendar.monthrange(premier.year, premier.month)[1]
        return min(date(premier.year, premier.month, min(jour, dernier)), self.aujourdhui)

    def operation(
        self, jour: Optional[date], nature: str, categorie: Optional[str], montant: float, compte, **champs
    ):
        if jour is None:
            return None
        monnaie = champs.pop("monnaie", self.euro)
        type_op = champs.pop("type_op", self.type_classique)
        return crud.create_operation(
            self.db,
            schemas.OperationCreate(
                date=jour,
                compte_id=compte.id,
                monnaie_id=monnaie.id,
                type_id=type_op.id,
                categorie_id=self.categories[categorie].id if categorie else None,
                nature=nature,
                montant=round(montant, 2),
                statut=champs.pop("statut", Statut.reel),
                **champs,
            ),
        )

    def virement(self, jour: Optional[date], source, destination, montant: float, nature: str, **champs):
        if jour is None:
            return None
        return crud.create_virement(
            self.db,
            schemas.VirementCreate(
                date=jour,
                compte_source_id=source.id,
                compte_destination_id=destination.id,
                montant=montant,
                monnaie_id=champs.pop("monnaie_id", self.euro.id),
                nature=nature,
                **champs,
            ),
            source,
            destination,
        )


# ---------- Les blocs ----------


def _remplir_comptes_et_categories(c: _Contexte) -> None:
    db = c.db
    dollar = crud.create_monnaie(db, c.t("dollar"), "$")
    c.dollar = dollar

    def type_compte(nom):
        return db.query(models.TypeCompte).filter(models.TypeCompte.nom == nom).one()

    def compte(cle, type_nom, monnaies):
        return crud.create_compte(
            db,
            schemas.CompteCreate(
                nom=c.t(cle),
                type_id=type_compte(type_nom).id,
                monnaies=[
                    schemas.CompteMonnaieInput(monnaie_id=m.id, solde_initial=solde)
                    for m, solde in monnaies
                ],
            ),
        )

    c.courant = compte("compte_courant", TYPE_COMPTE_COURANT, [(c.euro, 1800.0)])
    c.epargne = compte("compte_epargne", TYPE_COMPTE_EPARGNE, [(c.euro, 6000.0)])
    c.titres = compte("compte_titres", TYPE_COMPTE_PLACEMENT, [(c.euro, 3000.0)])
    c.voyage = compte("compte_voyage", TYPE_COMPTE_COURANT, [(dollar, 0.0)])

    for cle in ("cat_abonnements", "cat_sante", "cat_vacances"):
        crud.create_categorie(db, schemas.CategorieCreate(nom=c.t(cle)))
    c.categories = {cat.nom: cat for cat in crud.get_categories(db)}
    # Les catégories créées ici portent un nom DANS LA LANGUE DEMANDÉE : on les retrouve par ce nom
    # sous les clés françaises qu'utilisent les modèles ci-dessous.
    c.categories["Abonnements"] = c.categories[c.t("cat_abonnements")]
    c.categories["Santé"] = c.categories[c.t("cat_sante")]
    c.categories["Vacances"] = c.categories[c.t("cat_vacances")]


def _remplir_treize_mois(c: _Contexte) -> None:
    """Treize mois d'opérations courantes, du plus ancien au mois en cours."""
    for mois_avant in range(12, -1, -1):
        premier = _reculer(c.aujourdhui, mois_avant)
        f = _FACTEURS[mois_avant]
        salaire = 2300.0 if mois_avant > 5 else 2400.0
        gabarit = [
            (1, "salaire", CATEGORIE_ENTREES_ARGENT, salaire),
            (2, "loyer", "Charges fixes", 780.0),
            (8, "internet", "Charges fixes", 39.99),
            (5, "sport", "Abonnements", 29.90),
            (14, "streaming", "Abonnements", 13.49),
            (3, "courses", "Alimentaire", 68.40 * f),
            (10, "courses", "Alimentaire", 54.90 * f),
            (17, "courses", "Alimentaire", 71.25 * f),
            (24, "courses", "Alimentaire", 63.10 * f),
            (4, "pass", "Transports", 75.0),
            (19, "essence", "Transports", 52.0 * f),
            (9, "resto", "Loisirs", 41.0 * f),
            (22, "resto", "Loisirs", 36.5 * f),
        ]
        if mois_avant % 3 == 1:
            gabarit.append((15, "cinema", "Loisirs", 22.0))
        if mois_avant % 4 == 2:
            gabarit.append((27, "concert", "Loisirs", 65.0))
        if mois_avant in (11, 6, 2):
            gabarit.append((12, "pharmacie", "Santé", 18.40))
        if mois_avant == 8:
            gabarit.append((20, "medecin", "Santé", 30.0))
        if premier.month == 12:
            gabarit.append((18, "cadeaux", "Loisirs", 140.0))
        for jour, nature, categorie, montant in gabarit:
            c.operation(c.le(premier, jour), c.t(nature), categorie, montant, c.courant)

    premier = _reculer(c.aujourdhui, 6)
    c.operation(
        c.au_plus(premier, 20),
        c.t("prime"),
        CATEGORIE_ENTREES_ARGENT,
        600.0,
        c.courant,
        a_declarer=True,
    )


def _remplir_virements_et_titres(c: _Contexte) -> None:
    """L'épargne, le compte-titres et ce qu'on y achète."""
    for mois_avant in range(12, -1, -1):
        premier = _reculer(c.aujourdhui, mois_avant)
        c.virement(
            c.le(premier, 6), c.courant, c.epargne, 500.0 if mois_avant % 4 == 0 else 300.0, c.t("epargne")
        )
        if mois_avant <= 11:
            c.virement(c.le(premier, 7), c.courant, c.titres, 200.0, c.t("alimenter"))
    c.virement(c.au_plus(_reculer(c.aujourdhui, 5), 12), c.epargne, c.courant, 600.0, c.t("retrait"))

    db = c.db
    enveloppe_etf = _etiquette(db, AxeTitre.enveloppe, "ETF")
    enveloppe_action = _etiquette(db, AxeTitre.enveloppe, "Action en direct")
    actions = _etiquette(db, AxeTitre.classe, "Actions")
    obligations = _etiquette(db, AxeTitre.classe, "Obligations")

    monde = crud.create_titre(
        db, c.t("titre_monde"), c.euro.id, valeur=104.20, code_isin=_ISIN_MONDE, type_titre_id=enveloppe_etf
    )
    oblig = crud.create_titre(
        db, c.t("titre_oblig"), c.euro.id, valeur=46.10, code_isin=_ISIN_OBLIG, type_titre_id=enveloppe_etf
    )
    action = crud.create_titre(
        db, c.t("titre_action"), c.euro.id, valeur=141.30, code_isin=_ISIN_ACTION, type_titre_id=enveloppe_action
    )

    def repartition(titre, axe, lignes):
        lignes = [(i, poids) for i, poids in lignes if i is not None]
        if lignes:
            crud.poser_repartition(
                db, titre, axe.value, lignes, source="démo", date_maj=c.aujourdhui
            )

    def zone(nom):
        return _etiquette(db, AxeTitre.zone, nom)

    def secteur(nom):
        return _etiquette(db, AxeTitre.secteur, nom)

    repartition(monde, AxeTitre.classe, [(actions, 100.0)])
    repartition(
        monde,
        AxeTitre.zone,
        [
            (zone("États-Unis"), 65.0),
            (zone("Europe"), 17.0),
            (zone("Asie (hors Chine)"), 10.0),
            (zone("Amérique (hors États-Unis)"), 3.0),
            (zone("Chine"), 3.0),
        ],
    )
    repartition(
        monde,
        AxeTitre.secteur,
        [
            (secteur("Technologies de l'information"), 24.0),
            (secteur("Finance"), 15.0),
            (secteur("Santé"), 11.0),
            (secteur("Consommation discrétionnaire"), 10.0),
            (secteur("Industrie"), 10.0),
            (secteur("Services de communication"), 8.0),
        ],
    )
    repartition(oblig, AxeTitre.classe, [(obligations, 100.0)])
    repartition(oblig, AxeTitre.zone, [(zone("États-Unis"), 40.0), (zone("Europe"), 35.0)])
    # UNE ACTION EN DIRECT n'a qu'une étiquette par axe, à 100 % (cf. services/exposition).
    repartition(action, AxeTitre.classe, [(actions, 100.0)])
    repartition(action, AxeTitre.zone, [(zone("Europe"), 100.0)])
    repartition(action, AxeTitre.secteur, [(secteur("Technologies de l'information"), 100.0)])
    # Le dictionnaire de l'ETF : la société en direct y pèse 4 %, ce qui l'éclate dans les graphes.
    monde.composition = {_ISIN_ACTION: 4.0}
    monde.composition_couverture_pct = 60.0
    db.commit()

    for mois_avant, titre, quantite, prix in (
        (10, monde, 8, 92.40),
        (7, monde, 5, 95.10),
        (5, oblig, 10, 44.30),
        (3, action, 3, 130.00),
        (1, monde, 4, 101.20),
    ):
        crud.create_operation_titre(
            db,
            compte_id=c.titres.id,
            titre=titre,
            sens=SensTitre.achat,
            quantite=quantite,
            prix_unitaire=prix,
            date_operation=c.au_plus(_reculer(c.aujourdhui, mois_avant), 16),
        )

    # Les intérêts du livret, annoncés par la banque au 31 décembre.
    for annees in (1, 2):
        db.add(
            models.InteretPercu(
                compte_id=c.epargne.id,
                monnaie_id=c.euro.id,
                date=date(c.aujourdhui.year - annees, 12, 31),
                montant=round(58.20 - 12.0 * (annees - 1), 2),
                libelle=c.t("interets"),
            )
        )
    db.commit()


def _etiquette(db, axe: AxeTitre, nom: str) -> Optional[int]:
    """L'identifiant de l'étiquette livrée `nom` sur cet axe, ou None si elle n'existe pas (une
    base dont l'utilisateur a renommé le vocabulaire ne doit pas faire échouer la démo)."""
    ligne = (
        db.query(models.TypeTitre)
        .filter(models.TypeTitre.axe == axe.value, models.TypeTitre.nom == nom)
        .first()
    )
    return ligne.id if ligne else None


def _remplir_voyage(c: _Contexte) -> models.SousFiltre:
    """Le voyage : un projet, des dépenses en euros ET en dollars, et le change entre les deux."""
    premier = _reculer(c.aujourdhui, 3)
    ids = []
    avion = c.operation(
        c.au_plus(_reculer(c.aujourdhui, 4), 20), c.t("avion"), "Vacances", 520.0, c.courant
    )
    ids.append(avion.id)
    # Les 450 € changés en 486 $ : le montant reçu est celui que la banque a constaté, l'application
    # ne connaît aucun taux (cf. VirementCreate).
    change = c.virement(
        c.au_plus(premier, 9),
        c.courant,
        c.voyage,
        450.0,
        c.t("change"),
        montant_destination=486.0,
        monnaie_destination_id=c.dollar.id,
    )
    ids.extend(op.id for op in change)
    for jour, nature, montant in (
        (11, "hotel", 260.0),
        (12, "musee", 45.0),
        (13, "resto", 62.0),
        (14, "taxi", 38.0),
        (15, "epicerie", 41.0),
    ):
        op = c.operation(
            c.au_plus(premier, jour), c.t(nature), "Vacances", montant, c.voyage, monnaie=c.dollar
        )
        ids.append(op.id)

    projet = crud.create_sous_filtre(
        c.db,
        nom=c.t("projet"),
        description=c.t("projet_note"),
        date_debut=c.au_plus(premier, 9),
        date_fin=c.au_plus(premier, 18),
        montant_max=1300.0,
        monnaie_cible_id=c.euro.id,
    )
    crud.ajouter_operations_au_sous_filtre(c.db, projet, ids)
    # Épinglé au dashboard (migration 0088) : le plafond du voyage se lit sans ouvrir la page Budget.
    projet.visible_dashboard = True
    c.db.commit()
    return projet


def _remplir_cas_particuliers(c: _Contexte) -> None:
    """Les propriétés qu'une dépense peut porter : découpée, amortie, imprévue, remboursable."""
    db = c.db
    mois_dernier = _reculer(c.aujourdhui, 1)
    c.operation(
        c.au_plus(mois_dernier, 14),
        c.t("menage"),
        None,
        85.0,
        c.courant,
        decoupes=[
            schemas.DecoupeInput(categorie_id=c.categories["Alimentaire"].id, montant=60.0),
            schemas.DecoupeInput(categorie_id=c.categories[CATEGORIE_AUTRES].id, montant=25.0),
        ],
    )
    # UNE DÉPENSE AMORTIE : l'ordinateur pèse douze mois, à partir du mois où il est acheté.
    il_y_a_quatre_mois = _reculer(c.aujourdhui, 4)
    c.operation(
        c.au_plus(il_y_a_quatre_mois, 12),
        c.t("ordinateur"),
        CATEGORIE_AUTRES,
        1200.0,
        c.courant,
        amorti=True,
        amortissement_debut=il_y_a_quatre_mois,
        amortissement_fin=_reculer(c.aujourdhui, -7),
    )
    # DES IMPRÉVUES SUR PRESQUE TOUS LES MOIS : l'étiquette que lit l'extension « Budget », qui en
    # tire une moyenne. Une seule dépense imprévue ne dit rien d'une moyenne ; une par mois, de
    # montants qui varient, en fait une vraie. (mois avant, libellé, catégorie, montant, jour.)
    for mois_avant, nature, categorie, montant, jour in (
        (12, "cadeau", "Loisirs", 52.0, 9),
        (11, "pneu", "Transports", 68.0, 6),
        (10, "train", "Transports", 47.0, 20),
        (9, "amende", "Transports", 35.0, 13),
        (8, "plomberie", "Charges fixes", 142.0, 18),
        (6, "veto", CATEGORIE_AUTRES, 96.0, 10),
        (5, "lunettes", "Santé", 120.0, 22),
        (4, "cadeau", "Loisirs", 45.0, 4),
        (3, "train", "Transports", 58.0, 7),
        (2, "amende", "Transports", 35.0, 15),
        (1, "velo", "Transports", 85.0, 20),
        (0, "cadeau", "Loisirs", 38.0, 2),
    ):
        c.operation(
            c.au_plus(_reculer(c.aujourdhui, mois_avant), jour),
            c.t(nature),
            categorie,
            montant,
            c.courant,
            imprevue=True,
        )

    # LES REMBOURSABLES : l'une réglée en partie, l'autre qu'on attend encore.
    type_remboursable = crud.get_type_operation_par_code(db, TypeOperation.remboursable.value)
    type_reglement = crud.get_type_operation_par_code(db, TypeOperation.remboursements.value)
    camille = models.ProfilRemboursement(nom="Camille", description=c.t("profil_note_1"), ordre=0)
    alex = models.ProfilRemboursement(nom="Alex", description=c.t("profil_note_2"), ordre=1)
    db.add_all([camille, alex])
    db.commit()

    anniversaire = c.operation(
        c.au_plus(_reculer(c.aujourdhui, 2), 21),
        c.t("anniversaire"),
        "Loisirs",
        156.0,
        c.courant,
        type_op=type_remboursable,
        montant_du=104.0,
    )
    anniversaire.profil_remboursement_id = camille.id
    c.operation(
        c.au_plus(mois_dernier, 8),
        c.t("rembt"),
        None,
        60.0,
        c.courant,
        type_op=type_reglement,
        operations_remboursees=[
            schemas.OperationRembourseeInput(operation_id=anniversaire.id, montant=60.0)
        ],
    )
    billets = c.operation(
        c.au_plus(c.aujourdhui.replace(day=1), 3),
        c.t("billets"),
        "Loisirs",
        90.0,
        c.courant,
        type_op=type_remboursable,
        montant_du=90.0,
    )
    billets.profil_remboursement_id = alex.id
    db.commit()


def _remplir_previsions(c: _Contexte) -> None:
    """Ce qui n'est pas encore passé : une dépense annoncée, et les récurrences du mois prochain
    (qui engendrent seules les occurrences suivantes, cf. crud.generer_occurrences_recurrentes)."""
    c.operation(
        c.aujourdhui + timedelta(days=10),
        c.t("assurance"),
        "Charges fixes",
        45.0,
        c.courant,
        statut=Statut.previsionnel,
    )
    prochain = _reculer(c.aujourdhui, -1)
    for jour, nature, categorie, montant, extra in (
        (1, "salaire", CATEGORIE_ENTREES_ARGENT, 2400.0, {}),
        (2, "loyer", "Charges fixes", 780.0, {"rapprochement_mots_cles": [c.t("loyer").lower()]}),
        (8, "internet", "Charges fixes", 39.99, {}),
        (14, "streaming", "Abonnements", 13.49, {}),
    ):
        c.operation(
            date(prochain.year, prochain.month, jour),
            c.t(nature),
            categorie,
            montant,
            c.courant,
            statut=Statut.previsionnel,
            recurrente=True,
            frequence=Frequence.mensuelle,
            **extra,
        )


def _remplir_budgets(c: _Contexte) -> None:
    """Enveloppes, budget total et objectifs de répartition, posés sur le mois le plus ancien : la
    table est creuse, chaque mois suivant en hérite (cf. crud._budget_herite)."""
    db = c.db
    debut = _reculer(c.aujourdhui, 12)
    crud.set_budget_total(db, debut.year, debut.month, c.euro.id, BUDGET_TOTAL)
    for nom_cat, enveloppe in _BUDGETS.items():
        categorie = c.categories[nom_cat]
        crud.set_budget_categorie(db, categorie.id, debut.year, debut.month, c.euro.id, enveloppe)
        crud.set_objectif_pourcentage_categorie(db, categorie, round(enveloppe / BUDGET_TOTAL * 100, 2))
    db.add(models.MatelasSecurite(monnaie_id=c.euro.id, montant=5000.0))
    db.commit()


def _remplir_objectifs(c: _Contexte) -> None:
    """DES OBJECTIFS POUR CE QUI SE RÉPÈTE (chaque mois, chaque semaine), un PROJET pour ce qui n'a
    lieu qu'une fois : le budget du voyage est le plafond du projet (cf. `_remplir_voyage`), pas un
    objectif."""
    db = c.db
    for ordre, champs in enumerate(
        (
            dict(
                nom=c.t("obj_resto"),
                mesure=MesureObjectif.nombre.value,
                cible=6.0,
                categorie_id=c.categories["Loisirs"].id,
            ),
            dict(
                nom=c.t("obj_courses"),
                mesure=MesureObjectif.montant_moyen.value,
                cible=65.0,
                categorie_id=c.categories["Alimentaire"].id,
            ),
        )
    ):
        db.add(
            models.ObjectifKpi(
                cadence=CadenceObjectif.mois.value,
                sens=SensObjectif.max.value,
                monnaie_id=c.euro.id,
                visible_dashboard=True,
                ordre=ordre,
                filtres=[],
                **champs,
            )
        )
    db.commit()


def _remplir_extensions(c: _Contexte) -> None:
    """LES EXTENSIONS SONT ALLUMÉES DANS LA DÉMO (sauf celles de `extensions.EXTENSIONS_ETEINTES_EN_DEMO`,
    qui sortent sur le réseau). L'état vit dans la table `extension_etat` de la démo : celle de
    l'utilisateur n'est jamais touchée, c'est la raison d'être de cette table (migration 0089).

    Une ligne par extension PRÉSENTE ou connue du catalogue. Une extension ajoutée plus tard n'a pas
    de ligne et prend le défaut de la démo (allumée), cf. extensions._decision."""
    from .. import extensions

    # Les extensions de DÉVELOPPEMENT n'en font pas partie : ce sont des outils de la machine de
    # celui qui développe, pas quelque chose à montrer.
    identifiants = {
        identifiant
        for identifiant, extension in extensions.decouvrir().items()
        if extension.type != extensions.TYPE_DEVELOPPEUR
    } | {entree.get("id") for entree in extensions.catalogue() if entree.get("id")}
    for identifiant in sorted(identifiants):
        c.db.add(
            models.ExtensionEtat(
                extension_id=identifiant,
                active=identifiant not in extensions.EXTENSIONS_ETEINTES_EN_DEMO,
            )
        )
    c.db.commit()


def _remplir_divers(c: _Contexte) -> None:
    """Ce qui n'appartient à aucun bloc : taux de change saisis, règles d'import, preset du relevé
    d'exemple, note du dashboard."""
    db = c.db
    maintenant = datetime.combine(c.aujourdhui, datetime.min.time())
    db.add_all(
        [
            models.TauxChange(
                monnaie_source_id=c.euro.id, monnaie_cible_id=c.dollar.id, taux=1.08, maj_le=maintenant
            ),
            models.TauxChange(
                monnaie_source_id=c.dollar.id, monnaie_cible_id=c.euro.id, taux=0.93, maj_le=maintenant
            ),
        ]
    )
    db.commit()

    for cle, mot, categorie in (
        ("regle_courses", "Carrefour", "Alimentaire"),
        ("regle_streaming", "Netflix", "Abonnements"),
    ):
        crud.create_regle_categorisation(
            db,
            nom=c.t(cle),
            description=c.t("regle_note"),
            type_id=c.type_classique.id,
            categorie_id=c.categories[categorie].id,
            conditions={
                "operateur": "ET",
                "groupes": [
                    {
                        "operateur": "ET",
                        "conditions": [{"champ": "nature", "operateur": "contient", "valeur": mot}],
                    }
                ],
            },
        )

    # LE PRESET QUI LIT LE RELEVÉ D'EXEMPLE (cf. base_decouverte.remplir_import) : on peut ainsi
    # importer `exemples/releve-exemple.csv` dans la démo, sans régler quoi que ce soit.
    reglages = dict(
        nom=base_decouverte.NOM_PRESET_IMPORT,
        compte_id=c.courant.id,
        colonnes=base_decouverte.COLONNES_PRESET_IMPORT,
        colonnes_comparaison=[],
        mode_comparaison=ModeComparaison.exclusion.value,
        lignes_entete=base_decouverte.LIGNES_ENTETE_PRESET_IMPORT,
    )
    presets = crud.list_import_presets(db, DomaineImport.bancaire.value)
    if presets:
        for surnumeraire in presets[1:]:
            crud.delete_import_preset(db, surnumeraire)
        crud.update_import_preset(db, presets[0], **reglages)
    else:
        crud.create_import_preset(db, **reglages)

    crud.set_note_dashboard(db, c.t("note"))


def remplir(db, aujourdhui: date, langue: str = "fr") -> None:
    """Pose toute la démo dans une base neuve (celle que viennent de produire les migrations)."""
    c = _Contexte(db, aujourdhui, langue)
    _remplir_comptes_et_categories(c)
    _remplir_treize_mois(c)
    _remplir_virements_et_titres(c)
    _remplir_voyage(c)
    _remplir_cas_particuliers(c)
    _remplir_previsions(c)
    _remplir_budgets(c)
    _remplir_objectifs(c)
    _remplir_extensions(c)
    _remplir_divers(c)
    crud.set_preference_interface(
        db,
        CLE_PREFERENCE,
        {"version": VERSION, "cree_le": aujourdhui.isoformat(), "langue": c.langue},
    )


def fabriquer(
    chemin: Path | None = None, aujourdhui: date | None = None, langue: str = "fr"
) -> Path:
    """Fabrique (en l'écrasant) la base de démo et rend son chemin. L'application n'y bascule
    pas ici (cf. database.entrer_sandbox).

    L'ÉCRASEMENT SUPPOSE QUE LE FICHIER N'EST PAS OUVERT : Windows ne supprime pas un fichier
    tenu par un moteur. C'est à l'appelant de quitter la démo avant de la refaire."""
    chemin = chemin or chemin_sandbox()
    aujourdhui = aujourdhui or date.today()
    chemin.parent.mkdir(parents=True, exist_ok=True)
    _supprimer_fichiers(chemin)

    database.creer_base_neuve(chemin)

    moteur = create_engine(
        f"sqlite:///{chemin.as_posix()}", connect_args={"check_same_thread": False}
    )

    @event.listens_for(moteur, "connect")
    def _cles_etrangeres(dbapi_connection, connection_record):
        curseur = dbapi_connection.cursor()
        curseur.execute("PRAGMA foreign_keys=ON")
        curseur.close()

    try:
        with sessionmaker(bind=moteur)() as db:
            remplir(db, aujourdhui, langue)
    except Exception:
        # Une démo à moitié remplie serait pire que pas de démo : le fichier part avec l'échec.
        moteur.dispose()
        _supprimer_fichiers(chemin)
        raise
    finally:
        moteur.dispose()
    return chemin


def etat(db, aujourdhui: date | None = None) -> dict:
    """Ce que l'écran doit savoir de la démo OUVERTE : sa version, son âge, et s'il y a lieu de
    proposer de la refaire. `db` est la session de la base courante — c'est celle de la démo."""
    aujourdhui = aujourdhui or date.today()
    marque = crud.get_preference_interface(db, CLE_PREFERENCE) or {}
    version = marque.get("version") if isinstance(marque, dict) else None
    try:
        cree_le = date.fromisoformat(marque.get("cree_le")) if isinstance(marque, dict) else None
    except (TypeError, ValueError):
        cree_le = None
    raison = None
    if version is None or version < VERSION:
        raison = "nouvelle_version"
    elif cree_le is not None and (aujourdhui - cree_le).days > JOURS_AVANT_RAFRAICHIR:
        raison = "donnees_anciennes"
    return {
        "version": version,
        "version_courante": VERSION,
        "cree_le": cree_le.isoformat() if cree_le else None,
        "a_rafraichir": raison is not None,
        "raison": raison,
    }
