"""Diagnostic d'un écart entre le solde d'un compte dans l'app et à la banque.

À QUOI ÇA SERT. Le solde d'un compte dans l'app est une reconstruction : un
solde initial, plus l'effet de toutes les opérations réelles saisies ou
importées. Le relevé de la banque, lui, est la vérité. Quand les deux
divergent, l'app ne peut pas dire ce qui manque — mais elle peut dire ce qui
COLLERAIT, et c'est presque toujours suffisant pour retrouver la bonne ligne :
un import passé deux fois, une dépense saisie en entrée, une opération oubliée.

L'ÉCART, ET SON SIGNE. Tout ce module raisonne sur

    ecart = solde_banque − solde_app

Positif, la banque a plus que l'app : il manque une entrée, ou l'app porte une
dépense de trop. Négatif, l'inverse. C'est la seule convention du fichier, et
toutes les pistes s'en déduisent.

L'EFFET D'UNE OPÉRATION est ce qu'elle ajoute au solde : +montant pour une
entrée ou un transfert entrant, −montant pour une dépense ou un transfert
sortant (même règle que soldes._solde_delta, dont ce module est le miroir).
Une opération EN TROP dans l'app est donc une opération dont l'effet vaut
exactement −ecart : la retirer ramène le solde de l'app sur celui de la banque.
Tout le reste en découle — un signe inversé change l'effet de 2×, d'où un effet
recherché de −ecart/2, et une combinaison cherche une SOMME d'effets valant
−ecart.

EN CENTIMES, ET EN ENTIERS. Les montants sont des flottants ; chercher une
égalité exacte dessus ne trouverait rien (0.1 + 0.2 ≠ 0.3). Tout est donc
converti une fois en centimes entiers, où l'égalité redevient fiable et où les
sommes ne dérivent pas.

CE QUE CE MODULE NE FAIT PAS. Il ne modifie rien, ne mémorise rien, et ne
conclut rien : il propose des pistes, à charge pour l'utilisateur de vérifier.
Deux opérations sans aucun rapport peuvent parfaitement additionner l'écart par
hasard — c'est pour ça que les combinaisons sont bornées à trois opérations
(au-delà, la coïncidence devient plus probable que la cause) et que les pistes
sont rendues dans l'ordre de plausibilité, la plus simple d'abord.
"""
from datetime import date as date_type
from typing import Optional

from sqlalchemy.orm import Session

from .. import crud, models
from ..constants import Sens, Statut


# Signe de l'effet de chaque sens sur le solde du compte (cf. soldes._solde_delta).
_SIGNE_PAR_SENS = {
    Sens.entree: 1,
    Sens.transfert_entrant: 1,
    Sens.depense: -1,
    Sens.transfert_sortant: -1,
}

# Au-delà, une piste cesse d'en être une : vingt opérations du même montant ne
# désignent rien. On plafonne, et on le dit (cf. DiagnosticEcart.tronque).
MAX_PISTES_PAR_FAMILLE = 12

# La recherche à trois opérations est quadratique. Passé ce nombre d'opérations
# elle coûterait plusieurs secondes pour un résultat de moins en moins
# significatif : on l'abandonne plutôt que de faire attendre, en le signalant.
MAX_OPERATIONS_POUR_TRIPLETS = 700


def _centimes(montant: float) -> int:
    """Le montant en centimes entiers. `round` et non `int` : 45.2 * 100 vaut
    4519.999... en flottant, tronquer perdrait un centime à chaque conversion."""
    return round(montant * 100)


class OperationCandidate:
    """Une opération réduite à ce que la recherche manipule : son effet sur le
    solde, en centimes."""

    __slots__ = ("operation", "effet")

    def __init__(self, operation: models.Operation):
        self.operation = operation
        self.effet = _SIGNE_PAR_SENS.get(operation.sens, 0) * _centimes(operation.montant)


def solde_reel_a_date(
    db: Session,
    compte: models.Compte,
    monnaie_id: int,
    date_fin: Optional[date_type] = None,
) -> float:
    """Le solde RÉEL du couple (compte, monnaie), éventuellement arrêté à une date.

    Recalculé ici plutôt que lu dans soldes.get_soldes_comptes, qui ne borne
    jamais le solde réel dans le temps : un relevé bancaire, lui, est toujours
    arrêté à une date, et comparer un solde « à ce jour » à un relevé du 31
    juillet fabriquerait un écart qui n'existe pas.

    Seules les opérations RÉELLES comptent, comme partout ailleurs : une
    opération prévisionnelle décrit ce qui n'a pas encore touché le compte."""
    solde_initial = next(
        (lien.solde_initial for lien in compte.monnaies if lien.monnaie_id == monnaie_id),
        0.0,
    )
    total = _centimes(solde_initial)
    for candidat in _operations_candidates(db, compte.id, monnaie_id, date_fin):
        total += candidat.effet
    return total / 100


def _operations_candidates(
    db: Session,
    compte_id: int,
    monnaie_id: int,
    date_fin: Optional[date_type] = None,
    statut: Statut = Statut.reel,
) -> list[OperationCandidate]:
    """Les opérations qui composent le solde recherché, dans l'ordre du relevé.

    Filtrées sur le couple (compte, monnaie) : un compte multi-devises a un
    solde par monnaie, et mélanger les deux reviendrait à additionner des euros
    et des dollars — ce que l'app ne fait nulle part."""
    query = (
        db.query(models.Operation)
        .filter(models.Operation.compte_id == compte_id)
        .filter(models.Operation.monnaie_id == monnaie_id)
        .filter(models.Operation.statut == statut)
    )
    if date_fin is not None:
        query = query.filter(models.Operation.date <= date_fin)
    operations = query.order_by(models.Operation.date, models.Operation.id).all()
    return [OperationCandidate(op) for op in operations]


def _piste(type_piste: str, explication: str, operations: list[models.Operation]) -> dict:
    return {
        "type": type_piste,
        "explication": explication,
        "operations": operations,
    }


def _pistes_operation_isolee(
    candidats: list[OperationCandidate], cible: int
) -> tuple[list[dict], bool]:
    """Une seule opération explique tout l'écart : elle est en trop.

    La piste la plus fréquente, et de loin — un import passé deux fois, une
    ligne saisie puis réimportée. C'est aussi celle qui couvre le doublon exact
    sans avoir à le chercher séparément : deux opérations identiques dont une
    est de trop, c'est exactement une opération dont l'effet vaut l'écart."""
    pistes = []
    for candidat in candidats:
        if candidat.effet != cible:
            continue
        if len(pistes) >= MAX_PISTES_PAR_FAMILLE:
            return pistes, True
        pistes.append(
            _piste(
                "operation_en_trop",
                "Cette opération explique l'écart à elle seule : la supprimer "
                "aligne le solde de l'app sur celui de la banque.",
                [candidat.operation],
            )
        )
    return pistes, False


def _pistes_signe_inverse(
    candidats: list[OperationCandidate], cible: int
) -> tuple[list[dict], bool]:
    """Une opération saisie dans le mauvais sens : dépense au lieu d'entrée.

    Corriger le sens déplace le solde de DEUX fois le montant (on retire l'effet
    d'un côté, on l'ajoute de l'autre) : l'opération recherchée a donc un effet
    de cible/2. Un écart impair en centimes ne peut pas venir de là, d'où la
    sortie immédiate — et non un arrondi qui aurait proposé des pistes fausses."""
    if cible % 2 != 0:
        return [], False
    demi = cible // 2
    pistes = []
    for candidat in candidats:
        if candidat.effet != demi or candidat.effet == 0:
            continue
        if len(pistes) >= MAX_PISTES_PAR_FAMILLE:
            return pistes, True
        sens_actuel = "une entrée" if candidat.effet > 0 else "une sortie"
        sens_corrige = "une sortie" if candidat.effet > 0 else "une entrée"
        pistes.append(
            _piste(
                "signe_inverse",
                f"Cette opération compte comme {sens_actuel} : si c'était en "
                f"réalité {sens_corrige}, l'écart disparaîtrait exactement.",
                [candidat.operation],
            )
        )
    return pistes, False


def _pistes_previsionnelles(
    db: Session,
    compte_id: int,
    monnaie_id: int,
    date_fin: Optional[date_type],
    cible: int,
) -> tuple[list[dict], bool]:
    """Une opération PRÉVISIONNELLE qui serait en fait déjà passée.

    Le versant « il manque une opération » de la piste isolée, mais avec un
    candidat à montrer : le prélèvement est bien saisi, il est simplement resté
    au statut prévisionnel alors que la banque l'a déjà passé. Le solde réel de
    l'app est alors en retard sur celui de la banque, sans que rien ne
    manque nulle part — c'est la cause la plus courante d'un écart chez qui
    saisit ses échéances à l'avance.

    L'effet recherché est l'opposé des autres pistes : ici l'opération n'est pas
    en trop, elle est ABSENTE du solde réel. La passer en réel ajoute son effet,
    qui doit donc valoir +ecart, c'est-à-dire −cible."""
    manquant = -cible
    previsionnelles = _operations_candidates(
        db, compte_id, monnaie_id, date_fin, statut=Statut.previsionnel
    )
    pistes = []
    for candidat in previsionnelles:
        if candidat.effet != manquant:
            continue
        if len(pistes) >= MAX_PISTES_PAR_FAMILLE:
            return pistes, True
        pistes.append(
            _piste(
                "previsionnelle_a_pointer",
                "Cette opération est encore prévisionnelle : si la banque l'a "
                "déjà passée, la basculer en réel comble exactement l'écart.",
                [candidat.operation],
            )
        )
    return pistes, False


def _pistes_combinaisons(
    candidats: list[OperationCandidate], cible: int
) -> tuple[list[dict], bool, bool]:
    """Deux ou trois opérations dont la somme des effets fait l'écart.

    Le cas d'un import partiellement rejoué, ou de plusieurs oublis. On borne à
    trois : au-delà, sur un compte d'un millier d'opérations, on trouve
    toujours une combinaison — elle ne dirait plus rien de la cause.

    Les paires se cherchent en une passe avec un index effet -> opérations
    (O(n)) ; les triplets ajoutent une boucle sur les paires (O(n²)), d'où le
    garde-fou MAX_OPERATIONS_POUR_TRIPLETS au-delà duquel on renonce plutôt que
    de faire attendre pour un résultat de moins en moins significatif.

    Rend aussi (tronque, triplets_abandonnes) : ce que l'appelant doit dire à
    l'utilisateur pour qu'une liste courte ne passe pas pour une liste
    complète.
    """
    pistes: list[dict] = []
    index: dict[int, list[OperationCandidate]] = {}
    for candidat in candidats:
        index.setdefault(candidat.effet, []).append(candidat)

    # `vues` dédoublonne par identité d'opérations : sans lui, la paire (A, B)
    # ressortirait aussi comme (B, A), et chaque piste serait affichée deux fois.
    vues: set[tuple[int, ...]] = set()
    tronque = False

    def ajouter(operations: list[models.Operation], explication: str) -> bool:
        """Rend False quand le plafond est atteint (l'appelant s'arrête)."""
        nonlocal tronque
        cle = tuple(sorted(op.id for op in operations))
        if cle in vues:
            return True
        vues.add(cle)
        if len(pistes) >= MAX_PISTES_PAR_FAMILLE:
            tronque = True
            return False
        pistes.append(_piste("combinaison", explication, operations))
        return True

    for premier in candidats:
        complement = cible - premier.effet
        for second in index.get(complement, []):
            if second.operation.id == premier.operation.id:
                continue
            if not ajouter(
                [premier.operation, second.operation],
                "Ces deux opérations totalisent exactement l'écart : les "
                "retirer toutes les deux aligne le solde.",
            ):
                return pistes, tronque, False

    triplets_abandonnes = len(candidats) > MAX_OPERATIONS_POUR_TRIPLETS
    if triplets_abandonnes:
        return pistes, tronque, True

    for i, premier in enumerate(candidats):
        for second in candidats[i + 1 :]:
            complement = cible - premier.effet - second.effet
            for troisieme in index.get(complement, []):
                if troisieme.operation.id in (premier.operation.id, second.operation.id):
                    continue
                if not ajouter(
                    [premier.operation, second.operation, troisieme.operation],
                    "Ces trois opérations totalisent exactement l'écart. À "
                    "vérifier : trois lignes peuvent aussi s'additionner par hasard.",
                ):
                    return pistes, tronque, False

    return pistes, tronque, False


def diagnostiquer(
    db: Session,
    compte: models.Compte,
    monnaie_id: int,
    solde_banque: float,
    date_fin: Optional[date_type] = None,
) -> dict:
    """Compare le solde de l'app à celui de la banque et propose des pistes.

    Rien n'est modifié ni mémorisé : c'est une lecture, rejouable autant de fois
    que voulu (cf. l'en-tête du module).

    Les pistes sortent dans l'ordre de plausibilité — une opération isolée
    avant une paire, une paire avant un triplet : c'est l'ordre dans lequel on
    a une chance de reconnaître la vraie cause, et le premier élément de la
    liste est presque toujours le bon quand il y en a un.
    """
    solde_app = solde_reel_a_date(db, compte, monnaie_id, date_fin)
    ecart_centimes = _centimes(solde_banque) - _centimes(solde_app)

    monnaie = crud.get_monnaie(db, monnaie_id)
    base = {
        "compte_id": compte.id,
        "compte_nom": compte.nom,
        "monnaie_id": monnaie_id,
        "monnaie_nom": monnaie.nom if monnaie else "",
        "monnaie_symbole": monnaie.symbole if monnaie else "",
        "date_fin": date_fin,
        "solde_app": solde_app,
        "solde_banque": solde_banque,
        "ecart": ecart_centimes / 100,
    }

    if ecart_centimes == 0:
        return {
            **base,
            "nb_operations_analysees": 0,
            "pistes": [],
            "tronque": False,
            "triplets_abandonnes": False,
        }

    candidats = _operations_candidates(db, compte.id, monnaie_id, date_fin)
    # L'effet à annuler : retirer de l'app une opération d'effet −ecart la
    # ramène exactement sur la banque (cf. l'en-tête du module).
    cible = -ecart_centimes

    isolees, tronque_isolees = _pistes_operation_isolee(candidats, cible)
    inverses, tronque_inverses = _pistes_signe_inverse(candidats, cible)
    previsionnelles, tronque_prev = _pistes_previsionnelles(
        db, compte.id, monnaie_id, date_fin, cible
    )
    combinaisons, tronque_combi, triplets_abandonnes = _pistes_combinaisons(
        candidats, cible
    )

    return {
        **base,
        "nb_operations_analysees": len(candidats),
        "pistes": [*isolees, *inverses, *previsionnelles, *combinaisons],
        "tronque": any(
            (tronque_isolees, tronque_inverses, tronque_prev, tronque_combi)
        ),
        "triplets_abandonnes": triplets_abandonnes,
    }
