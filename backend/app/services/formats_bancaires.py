"""Reconnaître l'export d'une banque d'après ses intitulés de colonnes.

POURQUOI EN PLUS DE `detection_colonnes`. Celle-ci devine colonne par colonne, d'après un
intitulé générique (« Date », « Montant ») et la forme des cellules : elle réussit sur un relevé
ordinaire, hésite sur les autres — deux colonnes de dates (opération / valeur), un « Type » qui
n'est pas un sens, un libellé coupé en deux. Les exports des banques, eux, SONT stables : un
même établissement écrit les mêmes intitulés d'un fichier à l'autre. Les reconnaître d'un coup
donne tout le preset (colonnes et lignes de tête) sans la moindre hésitation.

CE QU'ON RECONNAÎT : un ENSEMBLE d'intitulés distinctifs (`requis`), dans n'importe quel ordre
et à n'importe quelle position — une banque qui ajoute une colonne ne casse pas la
reconnaissance. Le format le plus SPÉCIFIQUE gagne (le plus d'intitulés requis).

CE QUE CE N'EST PAS : une vérité. Les signatures ci-dessous décrivent les exports tels qu'on les
connaît ; une banque peut les changer sans prévenir. Rien n'est jamais appliqué en silence : la
reconnaissance remplit la PROPOSITION de colonnes que l'écran montre, et l'aperçu du fichier dit
aussitôt si la lecture tombe juste. Un format qu'on ne reconnaît pas retombe sur la détection
générique — c'est le cas normal, pas une erreur. Pour ajouter une banque : une entrée dans
`FORMATS`, et une ligne d'intitulés dans `tests/test_formats_bancaires.py`.
"""
import re
from typing import Optional

from .import_bancaire import normaliser_libelle

_TETE_MAX = 20


def _n(texte) -> str:
    """Un intitulé comparable : minuscules, sans accents, sans espaces ni ponctuation —
    « Date de l'opération » et « DATE DE L OPERATION » sont le même intitulé."""
    if texte is None:
        return ""
    return re.sub(r"[^a-z0-9]", "", normaliser_libelle(str(texte)))


# `mapping` : intitulé (déjà passé par `_n`) -> propriété de l'import. Ce qui n'y figure pas
# n'est pas importé (solde, référence, date de valeur…).
FORMATS: list[dict] = [
    {
        "id": "boursorama",
        "banque": "Boursorama Banque",
        "requis": {"dateop", "label", "amount", "category"},
        "mapping": {
            "dateop": "date",
            "label": "nature",
            "category": "categorie_banque",
            "amount": "montant",
        },
    },
    {
        "id": "n26-ancien",
        "banque": "N26",
        "requis": {"payee", "transactiontype", "amounteur"},
        "mapping": {
            "date": "date",
            "payee": "nature",
            "category": "categorie_banque",
            "amounteur": "montant",
        },
    },
    {
        "id": "n26",
        "banque": "N26",
        "requis": {"bookingdate", "partnername", "amounteur"},
        "mapping": {"bookingdate": "date", "partnername": "nature", "amounteur": "montant"},
    },
    {
        "id": "revolut",
        "banque": "Revolut",
        "requis": {"completeddate", "description", "amount", "currency"},
        "mapping": {
            "completeddate": "date",
            "description": "nature",
            "amount": "montant",
            "currency": "monnaie",
        },
    },
    {
        "id": "paypal-fr",
        "banque": "PayPal",
        "requis": {"date", "nom", "type", "devise", "brut", "net"},
        "mapping": {"date": "date", "nom": "nature", "brut": "montant", "devise": "monnaie"},
    },
    {
        "id": "credit-agricole",
        "banque": "Crédit Agricole",
        "requis": {"date", "libelle", "debiteuros", "crediteuros"},
        "mapping": {
            "date": "date",
            "libelle": "nature",
            "debiteuros": "montant_debit",
            "crediteuros": "montant_credit",
        },
    },
    {
        "id": "societe-generale",
        "banque": "Société Générale",
        "requis": {"datedeloperation", "libelle", "detaildelecriture", "montantdeloperation"},
        "mapping": {
            "datedeloperation": "date",
            "libelle": "nature",
            "montantdeloperation": "montant",
            "devise": "monnaie",
        },
    },
    {
        "id": "caisse-epargne",
        "banque": "Caisse d'Épargne",
        "requis": {"date", "numerodoperation", "libelle", "debit", "credit"},
        "mapping": {
            "date": "date",
            "libelle": "nature",
            "debit": "montant_debit",
            "credit": "montant_credit",
        },
    },
    {
        "id": "fortuneo",
        "banque": "Fortuneo",
        "requis": {"dateoperation", "datevaleur", "libelle", "debit", "credit"},
        "mapping": {
            "dateoperation": "date",
            "libelle": "nature",
            "debit": "montant_debit",
            "credit": "montant_credit",
        },
    },
    {
        "id": "credit-mutuel-cic",
        "banque": "Crédit Mutuel / CIC",
        "requis": {"date", "datedevaleur", "libelle", "debit", "credit"},
        "mapping": {
            "date": "date",
            "libelle": "nature",
            "debit": "montant_debit",
            "credit": "montant_credit",
        },
    },
    {
        "id": "banque-postale",
        "banque": "La Banque Postale",
        "requis": {"date", "libelle", "montanteuros"},
        "mapping": {"date": "date", "libelle": "nature", "montanteuros": "montant"},
    },
]


def reconnaitre(lignes: list[tuple]) -> Optional[dict]:
    """Le format de banque que décrit la ligne d'intitulés de ce fichier, ou None.

    `lignes` : toutes les lignes lues du fichier (cf. import_bancaire._lire_toutes_les_lignes).
    Rend {id, banque, lignes_entete, configuration: [{index, propriete}]} — `lignes_entete` en
    lignes PHYSIQUES, comme `ImportPreset.lignes_entete` — ou None."""
    meilleur = None
    for i, ligne in enumerate(lignes[:_TETE_MAX]):
        intitules = [_n(c) for c in ligne]
        presents = set(intitules) - {""}
        if len(presents) < 3:
            continue
        for fmt in FORMATS:
            if not fmt["requis"] <= presents:
                continue
            if meilleur is None or len(fmt["requis"]) > len(meilleur[1]["requis"]):
                meilleur = (i, fmt, intitules)
    if meilleur is None:
        return None
    i, fmt, intitules = meilleur
    configuration = []
    deja = set()
    for j, intitule in enumerate(intitules):
        propriete = fmt["mapping"].get(intitule)
        # Un intitulé en double (deux colonnes « Date ») : la première gagne, la propriété ne se
        # lit que dans UNE colonne.
        if propriete and propriete not in deja:
            configuration.append({"index": j + 1, "propriete": propriete})
            deja.add(propriete)
    return {
        "id": fmt["id"],
        "banque": fmt["banque"],
        "lignes_entete": i + 1,
        "configuration": configuration,
    }
