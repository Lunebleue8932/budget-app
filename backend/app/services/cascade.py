"""La CASCADE (waterfall) d'un ensemble d'opérations, monnaie par monnaie.

DEUX LECTEURS, UN SEUL CALCUL : les projets (les opérations versées dans un
projet) et le dashboard (les opérations d'une période, pour le détail d'une
monnaie éteinte). Deux copies auraient fini par ne plus compter les virements
de la même façon — or c'est précisément ce que ce module décide.

UNE CASCADE PAR MONNAIE, jamais deux devises additionnées. Ses colonnes :

  - LES CATÉGORIES, entrées comprises : le NET de chaque catégorie (ce qui y est
    entré moins ce qui en est sorti), au montant qui a bougé sur le compte — frais
    compris pour une opération ordinaire, où ils ne se distinguent pas du reste.
    Une opération DÉCOUPÉE compte par ses parts, comme partout ailleurs. Une
    opération sans catégorie prend le nom de son TYPE quand c'est lui qui la
    classe (prêt reçu, remboursement…), « Sans catégorie » sinon ;
  - L'ÉPARGNE : les virements entre un compte COURANT et un compte d'épargne ou
    de placements, sommés avec leur signe — vu du compte courant, ce qui part
    mettre de côté descend, ce qui en revient remonte ;
  - LES FRAIS DE VIREMENTS INTERNES, à part : ce sont les seuls frais qui
    disparaissent d'un mouvement qui, sans eux, ne coûterait rien ;
  - LES CONVERSIONS : un virement entre deux MONNAIES, quels que soient les
    comptes, sort de l'une et entre dans l'autre AUX MONTANTS ENREGISTRÉS (jamais
    au taux du jour). Une colonne par monnaie d'en face, au net des deux sens.

UN VIREMENT ENTRE DEUX COMPTES DU MÊME TYPE, DANS LA MÊME MONNAIE, EST IGNORÉ :
il range l'argent autrement sans rien faire entrer ni sortir. Seuls ses frais
restent, puisqu'eux ont bien quitté le patrimoine.

UN VIREMENT SE LIT PAR PAIRE (`virement_id`), et une seule de ses jambes suffit
à le faire entrer : l'autre est relue en base. Un projet qui ne contient que la
jambe en euros d'un change vers le franc suisse doit quand même dire combien de
francs sont arrivés — c'est la moitié de l'information.
"""
from collections import defaultdict

from sqlalchemy.orm import Session

from .. import crud, models
from ..constants import (
    TYPES_AVEC_CATEGORIE_LIBRE,
    TYPES_COMPTE_HORS_COURANT,
    Sens,
    TypeOperation,
)

SENS_ENTRANTS = {Sens.entree, Sens.transfert_entrant}

CATEGORIE_SANS = "Sans catégorie"
# L'index de palette des colonnes qui ne sont PAS une catégorie (cf.
# soldes._COULEUR_INTERETS_PRETS, service_projets._COULEUR_SANS_CATEGORIE).
COULEUR_SANS_CATEGORIE = 7
NB_TOP = 3

GENRE_ENTREE = "entree"
GENRE_DEPENSE = "depense"
GENRE_EPARGNE = "epargne"
GENRE_FRAIS = "frais"
GENRE_CONVERSION = "conversion"

# Un net plus petit qu'un demi-centime n'est pas une colonne : c'est un arrondi.
_EPSILON = 0.005


def _est_courant(compte: models.Compte) -> bool:
    return compte.type_nom not in TYPES_COMPTE_HORS_COURANT


def _lignes_categorie(operation: models.Operation):
    """(nom, montant, est_entree, couleur_index) — une fois par part si l'opération
    est découpée (ses parts SONT sa classification, cf. models.OperationDecoupe)."""
    if operation.decoupes:
        return [
            (
                part.categorie.nom,
                part.montant,
                bool(part.categorie.est_entree),
                part.categorie.couleur_index,
            )
            for part in operation.decoupes
        ]
    if operation.categorie is not None:
        categorie = operation.categorie
        return [(categorie.nom, operation.montant, bool(categorie.est_entree), categorie.couleur_index)]
    type_op = operation.type_operation
    if type_op is not None and type_op.code not in TYPES_AVEC_CATEGORIE_LIBRE:
        # LE TYPE EST LA CLASSIFICATION (prêt reçu, remboursement…) : son nom dit
        # mieux ce qu'est la colonne que « Sans catégorie ».
        return [(type_op.nom, operation.montant, operation.sens in SENS_ENTRANTS, COULEUR_SANS_CATEGORIE)]
    return [(CATEGORIE_SANS, operation.montant, operation.sens in SENS_ENTRANTS, COULEUR_SANS_CATEGORIE)]


def _fondre(top: list[dict], nature: str, montant: float) -> None:
    """Fond une ligne dans son homologue de même libellé (cf. soldes._fondre_par_libelle)."""
    libelle = (nature or "").strip()
    for ligne in top:
        if ligne["nature"] == libelle:
            ligne["montant"] += montant
            ligne["nombre"] += 1
            return
    top.append({"nature": libelle, "montant": montant, "nombre": 1})


def _top(lignes: list[dict]) -> list[dict]:
    return sorted(lignes, key=lambda d: (-abs(d["montant"]), d["nature"]))[:NB_TOP]


def _frais_de(jambe: models.Operation) -> float:
    return jambe.frais if jambe.frais and jambe.frais > 0 else 0.0


def _paires(db: Session, operations) -> tuple[list, list]:
    """(paires (sortante, entrante), jambes seules) des virements de l'ensemble,
    chaque virement une seule fois, sa jambe manquante relue en base."""
    ids = {
        op.virement_id
        for op in operations
        if op.virement_id and op.type_operation and op.type_operation.code == TypeOperation.virement.value
    }
    jambes: dict[str, list] = defaultdict(list)
    if ids:
        for op in db.query(models.Operation).filter(models.Operation.virement_id.in_(ids)):
            jambes[op.virement_id].append(op)
    paires, seules = [], []
    for virement_id, liste in jambes.items():
        sortante = next((j for j in liste if j.sens == Sens.transfert_sortant), None)
        entrante = next((j for j in liste if j.sens == Sens.transfert_entrant), None)
        if sortante is not None and entrante is not None:
            paires.append((sortante, entrante))
        else:
            seules.extend(liste)
    return paires, seules


def cascades(db: Session, operations, monnaies: list[models.Monnaie] | None = None) -> list[dict]:
    """Les cascades de `operations`, une par monnaie touchée, dans l'ordre des
    monnaies de l'application. Cf. l'en-tête du module pour ce qu'elles comptent."""
    operations = list(operations)
    categories: dict[int, dict[str, dict]] = defaultdict(dict)
    epargne: dict[int, float] = defaultdict(float)
    epargne_top: dict[int, list] = defaultdict(list)
    frais: dict[int, float] = defaultdict(float)
    frais_top: dict[int, list] = defaultdict(list)
    conversions: dict[int, dict[int, float]] = defaultdict(lambda: defaultdict(float))
    conversions_top: dict[int, dict[int, list]] = defaultdict(lambda: defaultdict(list))

    def ajouter_categorie(operation, nom, montant, est_entree, couleur_index):
        signe = 1 if operation.sens in SENS_ENTRANTS else -1
        colonne = categories[operation.monnaie_id].setdefault(
            nom,
            {"montant": 0.0, "est_entree": est_entree, "couleur_index": couleur_index, "top": []},
        )
        colonne["montant"] += signe * montant
        _fondre(colonne["top"], operation.nature, signe * montant)

    paires, seules = _paires(db, operations)
    deja_en_paire = {op.id for paire in paires for op in paire}

    for operation in operations:
        type_op = operation.type_operation
        code = type_op.code if type_op is not None else None
        # Achats et ventes de titres : un mouvement interne au compte-titres, que
        # ni un projet ni un détail de monnaie ne lisent comme une dépense.
        if code == TypeOperation.action.value:
            continue
        if code == TypeOperation.virement.value and operation.id in deja_en_paire:
            continue
        # Une jambe de virement sans sa partenaire (base ancienne) : on ne sait
        # pas où l'argent est allé, elle compte donc comme une opération ordinaire
        # sous le nom de son type.
        for nom, montant, est_entree, couleur in _lignes_categorie(operation):
            ajouter_categorie(operation, nom, montant, est_entree, couleur)

    for sortante, entrante in paires:
        # LES FRAIS SONT DÉJÀ DANS LE MONTANT de la jambe qui les porte — ajoutés à
        # ce qui part, retranchés de ce qui arrive (cf. crud._jambe_des_frais).
        frais_sortante = _frais_de(sortante)
        frais_entrante = _frais_de(entrante)
        envoye = sortante.montant - frais_sortante
        recu = entrante.montant + frais_entrante
        nature = sortante.nature or entrante.nature
        for jambe, montant_frais in ((sortante, frais_sortante), (entrante, frais_entrante)):
            if montant_frais:
                frais[jambe.monnaie_id] -= montant_frais
                _fondre(frais_top[jambe.monnaie_id], jambe.nature, -montant_frais)

        if sortante.monnaie_id != entrante.monnaie_id:
            a, b = sortante.monnaie_id, entrante.monnaie_id
            conversions[a][b] -= envoye
            conversions[b][a] += recu
            _fondre(conversions_top[a][b], nature, -envoye)
            _fondre(conversions_top[b][a], nature, recu)
            continue
        courant_sortant = _est_courant(sortante.compte)
        courant_entrant = _est_courant(entrante.compte)
        if courant_sortant == courant_entrant:
            continue  # même type, même monnaie : rien n'entre ni ne sort
        monnaie = sortante.monnaie_id
        montant = -envoye if courant_sortant else recu
        epargne[monnaie] += montant
        _fondre(epargne_top[monnaie], nature, montant)

    touchees = set(categories) | set(epargne) | set(frais) | set(conversions)
    for parts in conversions.values():
        touchees |= set(parts)
    monnaies = monnaies if monnaies is not None else crud.get_monnaies(db)

    resultat = []
    for monnaie in monnaies:
        if monnaie.id not in touchees:
            continue
        colonnes = []
        lignes = [
            (nom, c) for nom, c in categories[monnaie.id].items() if abs(c["montant"]) >= _EPSILON
        ]
        # LES ENTRÉES D'ABORD, de la plus grosse à la plus petite, puis les
        # dépenses de la plus lourde à la plus légère : la cascade monte, puis
        # chaque marche explique ce qui l'entame.
        lignes.sort(key=lambda item: (item[1]["montant"] < 0, -abs(item[1]["montant"]), item[0]))
        for nom, c in lignes:
            colonnes.append(
                {
                    "genre": GENRE_ENTREE if c["montant"] > 0 else GENRE_DEPENSE,
                    "libelle": nom,
                    "montant": round(c["montant"], 2),
                    "est_entree": c["est_entree"],
                    "couleur_index": c["couleur_index"],
                    "top": _top(c["top"]),
                }
            )
        if abs(epargne[monnaie.id]) >= _EPSILON:
            colonnes.append(
                {
                    "genre": GENRE_EPARGNE,
                    "libelle": "",
                    "montant": round(epargne[monnaie.id], 2),
                    "top": _top(epargne_top[monnaie.id]),
                }
            )
        if abs(frais[monnaie.id]) >= _EPSILON:
            colonnes.append(
                {
                    "genre": GENRE_FRAIS,
                    "libelle": "",
                    "montant": round(frais[monnaie.id], 2),
                    "top": _top(frais_top[monnaie.id]),
                }
            )
        for autre in monnaies:
            net = conversions[monnaie.id].get(autre.id, 0.0)
            if abs(net) < _EPSILON:
                continue
            colonnes.append(
                {
                    "genre": GENRE_CONVERSION,
                    "libelle": autre.nom,
                    "montant": round(net, 2),
                    "monnaie_autre_id": autre.id,
                    "top": _top(conversions_top[monnaie.id][autre.id]),
                }
            )
        resultat.append(
            {
                "monnaie_id": monnaie.id,
                "monnaie_nom": monnaie.nom,
                "monnaie_symbole": monnaie.symbole,
                "monnaie_active": bool(monnaie.active),
                "colonnes": colonnes,
                "solde": round(sum(c["montant"] for c in colonnes), 2),
            }
        )
    return resultat
