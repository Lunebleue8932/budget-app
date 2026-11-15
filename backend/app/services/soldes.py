"""Soldes et agrégats, calculés séparément POUR CHAQUE MONNAIE.

L'app ne stocke aucun taux de change : additionner des euros et des dollars
n'aurait donc aucun sens, et inventer une conversion en aurait encore moins.
Tout ce qui somme des montants ici est donc groupé par monnaie — un compte à
deux monnaies a deux soldes, le dashboard a un jeu de KPI par monnaie, et une
catégorie a un budget par monnaie.

La clé de groupement est partout le couple (compte, monnaie) : c'est ce qui
permet à un compte multi-devises de rester UNE ligne en base (cf.
models.CompteMonnaie) au lieu d'être dupliqué.
"""
import calendar
import math
from datetime import date as date_type
from datetime import timedelta
from typing import Optional

from sqlalchemy import and_, func, or_
from sqlalchemy.orm import Session

from .. import crud, extensions, models
from ..constants import (
    EXTENSION_INTERETS_PERCUS,
    EXTENSION_PRETS,
    EXTENSION_SUIVI_REMBOURSEMENTS,
    LIBELLE_FRAIS_VIREMENTS,
    LIBELLE_INTERETS_PRETS,
    TYPES_COMPTE_HORS_COURANT,
    TYPES_HORS_FLUX,
    TYPES_REMBOURSABLES,
    Sens,
    Statut,
    TypeOperation,
)


# Codes des types dont l'opération est remboursable, pour les filtres SQL.
_CODES_REMBOURSABLES = [t.value for t in TYPES_REMBOURSABLES]
_CODES_HORS_FLUX = [t.value for t in TYPES_HORS_FLUX]


def _remboursable_compte() -> bool:
    """Si l'extension « Suivi des remboursements » tourne : sans elle, une
    dépense remboursable ne pèse plus sur AUCUN total (flux, histogramme,
    infobulle, reste à rembourser) — même règle et même raison que
    `pret`/EXTENSION_PRETS. Elle reste intacte en base, seulement absente des
    chiffres tant que rien n'explique à qui elle est due."""
    return extensions.est_active(EXTENSION_SUIVI_REMBOURSEMENTS)

# LES INTÉRÊTS D'UN PRÊT : ce qu'on rendra moins ce qu'on a reçu, JAMAIS négatif.
#
# `montant_du >= montant` est désormais la règle du type « prêt reçu », tenue à
# l'écriture (cf. crud.erreur_montant_du / _borner_montant_du) : l'écart est donc
# positif ou nul par construction, et c'est lui qui coûte quelque chose.
#
# LA BORNE À ZÉRO RESTE, pour les lignes écrites AVANT que cette règle existe.
# Jusque-là un prêt voyait son `montant_du` forcé à `montant` — l'écart valait
# zéro — mais rien ne garantit qu'aucune base ne porte une valeur inférieure
# (import, reclassement d'une dépense remboursable). Sans cette borne, un tel
# prêt RETIRERAIT des sorties du mois : emprunter ferait baisser les dépenses.
_INTERETS_PRET = func.max(
    0.0, models.Operation.montant_du - models.Operation.montant
)


def _sums_by_compte_monnaie_and_sens(
    db: Session, statut: Optional[Statut], date_fin: Optional[date_type] = None
):
    query = db.query(
        models.Operation.compte_id,
        models.Operation.monnaie_id,
        models.Operation.sens,
        func.sum(models.Operation.montant).label("total"),
    )
    if statut is not None:
        query = query.filter(models.Operation.statut == statut)
    if date_fin is not None:
        query = query.filter(models.Operation.date <= date_fin)
    query = query.group_by(
        models.Operation.compte_id, models.Operation.monnaie_id, models.Operation.sens
    )

    result: dict = {}
    for compte_id, monnaie_id, sens, total in query.all():
        result.setdefault((compte_id, monnaie_id), {})[sens] = total or 0.0
    return result


def _solde_delta(sums: dict) -> float:
    return (
        sums.get(Sens.entree, 0.0)
        + sums.get(Sens.transfert_entrant, 0.0)
        - sums.get(Sens.depense, 0.0)
        - sums.get(Sens.transfert_sortant, 0.0)
    )


def fin_de_periode(annee: int, mois: Optional[int]) -> date_type:
    """Dernier jour de la période affichée : fin du mois, ou fin de l'année en
    vue annuelle. Sert de borne à la projection des soldes."""
    if mois is None:
        return date_type(annee, 12, 31)
    return date_type(annee, mois, calendar.monthrange(annee, mois)[1])


# Sentinelle : « lis le réglage » (None voulant dire « calendrier, rien à reporter »).
_PAR_REGLAGE = object()


# ---------- LE MOIS : calendaire ou salarial, UN SEUL RÉGLAGE POUR TOUT ----------
#
# Le réglage « Découpage des mois sur le salaire » (Paramètres généraux) ne règle plus seulement le reste
# du dashboard : il décide de ce qu'est UN MOIS dans toute l'application — les entrées et dépenses d'un mois,
# les dépenses par catégorie, les objectifs et leurs moyennes, le projeté. Calendaire (par défaut) : du 1er au
# dernier jour. Salarial : de la coupure (par défaut le dernier jour du mois précédent) à la veille de la
# suivante — le « mois de novembre » va alors du 31 octobre au 29 novembre.
#
# LE LIBELLÉ D'UN MOIS SALARIAL est le mois qui contient le 15 : « novembre » est la période du 15 novembre
# (`periode_salariale(date(annee, mois, 15))`). Les périodes se suivent sans trou ni chevauchement, quel que
# soit le jour de coupure.
#
# L'ÉTAT EST PARTAGÉ (un seul utilisateur, une seule base ouverte à la fois) plutôt que passé à chaque appel :
# les filtres de période (`filtre_date_periode`…) n'ont pas de session, et une trentaine d'appelants les
# utilisent. Il est rafraîchi par `rafraichir_jour_salaire`, à chaque requête (cf. database.get_db) et à chaque
# écriture du réglage (cf. crud.set_preference_interface). Ce qui reste CALENDAIRE : les semaines (lundi au
# dimanche, coupées aux bords du mois civil) et les mois d'amortissement (un mois d'amortissement est un mois civil).
_etat_salaire: dict = {"jour": None}


def definir_jour_salaire(jour: Optional[int]) -> None:
    _etat_salaire["jour"] = jour


def jour_salaire_partage() -> Optional[int]:
    """Le jour de coupure du mois salarial, ou None quand les mois suivent le calendrier."""
    return _etat_salaire["jour"]


def rafraichir_jour_salaire(db: Session) -> Optional[int]:
    """Relit le réglage en base et le rend partagé."""
    jour = lire_decoupage_salaire(db)
    definir_jour_salaire(jour)
    return jour


def bornes_periode(
    annee: int, mois: Optional[int], jour_salaire=_PAR_REGLAGE
) -> tuple[date_type, date_type]:
    """Le premier et le dernier jour de la période AFFICHÉE : un mois (calendaire ou salarial selon le
    réglage), ou l'année (douze mois de suite — du début du premier au dernier jour du douzième)."""
    if jour_salaire is _PAR_REGLAGE:
        jour_salaire = _etat_salaire["jour"]
    if jour_salaire is None:
        if mois is None:
            return date_type(annee, 1, 1), date_type(annee, 12, 31)
        return date_type(annee, mois, 1), date_type(annee, mois, calendar.monthrange(annee, mois)[1])
    if mois is None:
        return (
            periode_salariale(date_type(annee, 1, 15), jour_salaire)[0],
            periode_salariale(date_type(annee, 12, 15), jour_salaire)[1],
        )
    return periode_salariale(date_type(annee, mois, 15), jour_salaire)


def fin_periode_affichee(annee: int, mois: Optional[int]) -> date_type:
    """Le dernier jour de la période affichée, au mois calendaire ou salarial selon le réglage
    (cf. `fin_de_periode`, qui reste purement calendaire)."""
    return bornes_periode(annee, mois)[1]


def mois_de(jour: date_type, jour_salaire=_PAR_REGLAGE) -> tuple[int, int]:
    """`(année, mois)` du mois — calendaire ou salarial — qui CONTIENT ce jour : le mois « en cours »
    d'un dashboard ouvert aujourd'hui. Le 30 novembre en mois salarial (coupure le dernier jour) est en
    décembre."""
    if jour_salaire is _PAR_REGLAGE:
        jour_salaire = _etat_salaire["jour"]
    if jour_salaire is None:
        return jour.year, jour.month
    precedent = (jour.year - 1, 12) if jour.month == 1 else (jour.year, jour.month - 1)
    suivant = (jour.year + 1, 1) if jour.month == 12 else (jour.year, jour.month + 1)
    for annee, mois in ((jour.year, jour.month), suivant, precedent):
        debut, fin = bornes_periode(annee, mois, jour_salaire)
        if debut <= jour <= fin:
            return annee, mois
    return jour.year, jour.month


def _reste_du_prets_par_compte_monnaie(
    db: Session, date_fin: Optional[date_type] = None
) -> dict:
    """Reste à rembourser sur les prêts reçus, par couple (compte, monnaie).

    Un prêt reçu est une entrée d'argent : l'argent est bien là, mais il devra
    être rendu. Il gonfle donc légitimement le solde réel, jamais le solde
    projeté, qui doit refléter ce qu'il restera une fois les engagements soldés.

    C'est `montant_a_rembourser` (le reste dû, qui décroît au fil des
    remboursements) et non `montant` qui est soustrait : sinon rembourser
    pénaliserait deux fois (le prêt jamais compté, et la sortie de trésorerie
    du remboursement en plus)."""
    query = (
        db.query(
            models.Operation.compte_id,
            models.Operation.monnaie_id,
            func.sum(models.Operation.montant_a_rembourser).label("total"),
        )
        .join(models.TypeOperationDB, models.Operation.type_id == models.TypeOperationDB.id)
        .filter(models.TypeOperationDB.code == TypeOperation.pret.value)
    )
    if date_fin is not None:
        query = query.filter(models.Operation.date <= date_fin)
    rows = query.group_by(models.Operation.compte_id, models.Operation.monnaie_id).all()
    return {(compte_id, monnaie_id): (total or 0.0) for compte_id, monnaie_id, total in rows}


def _interets_percus_par_compte_monnaie(db: Session) -> dict:
    """Les intérêts perçus, par couple (compte, monnaie).

    ILS ENTRENT DANS LE SOLDE SANS ÊTRE UNE OPÉRATION (`models.InteretPercu`,
    extension « Intérêts perçus »). La banque ANNONCE un montant, on le saisit,
    et le livret vaut d'autant plus : ne pas le compter laissait un solde
    durablement inférieur au relevé, sur les comptes dont c'est précisément le
    seul mouvement de l'année.

    POURQUOI PAS UNE OPÉRATION, tant qu'à faire. Parce qu'un relevé importé peut
    porter la même ligne, et que la même somme compterait alors deux fois.
    L'intérêt reste donc un journal à part, qui s'AJOUTE au solde exactement
    comme le fait un solde initial — la contrepartie est qu'il ne se détaille
    pas dans la page Opérations, et qu'il ne pèse sur aucun flux de période.
    Cette seconde moitié n'a rien d'un défaut : un compte d'épargne est HORS
    COURANT, donc déjà écarté des flux et des variations (cf.
    TYPES_COMPTE_HORS_COURANT). Le seul total qui bouge est celui des avoirs, et
    c'est bien ce qu'on lui demande.

    PAS DE BORNE DE DATE, comme le solde réel qu'ils rejoignent : celui-ci
    compte tout ce qui est déjà survenu, sans se demander quelle période
    l'écran affiche.

    SEULEMENT SI L'EXTENSION TOURNE — même règle que les prêts : un chiffre qui
    apparaît sans qu'aucun écran ne l'explique est pire que le chiffre qui
    manque."""
    if not extensions.est_active(EXTENSION_INTERETS_PERCUS):
        return {}
    rows = (
        db.query(
            models.InteretPercu.compte_id,
            models.InteretPercu.monnaie_id,
            func.sum(models.InteretPercu.montant).label("total"),
        )
        .group_by(models.InteretPercu.compte_id, models.InteretPercu.monnaie_id)
        .all()
    )
    return {(compte_id, monnaie_id): (total or 0.0) for compte_id, monnaie_id, total in rows}


def get_soldes_comptes(db: Session, date_fin: Optional[date_type] = None):
    """Un élément par compte, chacun portant un solde PAR MONNAIE :

        [{"compte": <Compte>, "soldes": {monnaie_id: {"monnaie": <Monnaie>,
                                                      "solde_initial": ...,
                                                      "solde_reel": ...,
                                                      "solde_projete": ...}}}]

    Les monnaies déclarées sur le compte apparaissent toutes, même sans aucune
    opération (leur solde vaut alors le solde initial) : c'est ce qui rend
    visible un compte en dollars fraîchement ouvert.

    `date_fin` borne la **projection** : le solde projeté ne tient compte que
    des opérations jusqu'à cette date incluse. Sans borne, le projeté intégrait
    toutes les opérations futures connues, y compris les occurrences récurrentes
    générées jusqu'à 24 mois à l'avance — il ne répondait donc pas à "où j'en
    serai à la fin de la période affichée", mais à "où j'en serai une fois tout
    l'horizon écoulé".

    Le solde **réel** n'est jamais borné : il ne compte que des opérations au
    statut réel, déjà survenues par construction.

    UNE MONNAIE ÉTEINTE (cf. models.CompteMonnaie.active) DISPARAÎT TANT QU'ELLE
    NE PORTE RIEN, et c'est la seule exception à la règle du premier paragraphe.
    Comme l'extinction exige un solde nul au moment où elle est demandée, c'est
    le cas de toutes les périodes à partir de là : la ligne s'efface des cartes
    de compte et des onglets de monnaie du dashboard, et « tout se passe comme
    s'il n'y avait plus la monnaie ». Sur une période ANTÉRIEURE, où le compte
    portait encore des montants, elle reparaît telle qu'elle était — l'historique
    ne se réécrit pas, et un « Total des avoirs » de mars ne perd rien parce
    qu'on a soldé son compte en dollars en juin.
    """
    lisibles = [
        {
            "compte": item["compte"],
            "soldes": {
                monnaie_id: solde
                for monnaie_id, solde in item["soldes"].items()
                if solde["active"] or not solde_entierement_nul(solde)
            },
        }
        for item in soldes_de_tous_les_liens(db, date_fin=date_fin)
    ]
    # UN COMPTE ÉTEINT DISPARAÎT TANT QU'IL NE PORTE RIEN (cf.
    # models.Compte.actif) — exactement la règle d'une monnaie éteinte, d'un
    # cran au-dessus. C'est ce qui permet de l'éteindre SANS RIEN EXIGER : tant
    # qu'il reste de l'argent dessus, sa carte est là, et aucun total ne perd
    # quoi que ce soit en silence. Sur une période antérieure, il reparaît tel
    # qu'il était.
    return [
        item
        for item in lisibles
        if item["compte"].actif
        or any(not solde_entierement_nul(solde) for solde in item["soldes"].values())
    ]


# En dessous de quoi un solde est tenu pour nul. Les montants sont des flottants
# et une suite d'opérations qui se compensent laisse un résidu binaire
# (0.01 + 0.02 - 0.03 ne vaut pas 0) : comparer à zéro exactement ferait
# dépendre l'extinction d'une monnaie de l'ordre dans lequel ses opérations ont
# été saisies. Un demi-centime est très en dessous de tout ce qu'une monnaie
# réelle sait exprimer.
EPSILON_SOLDE_NUL = 0.005


def solde_entierement_nul(solde: dict) -> bool:
    """Ni argent présent, ni argent attendu : les DEUX soldes sont nuls.

    PUBLIQUE parce que le routeur des comptes la lit aussi : c'est la condition
    qui autorise à éteindre une monnaie, et la reposer là-bas aurait ouvert la
    porte à deux définitions du mot « soldée ».

    Le projeté compte autant que le réel. Une monnaie dont le solde réel vaut
    zéro mais qui porte une opération prévisionnelle n'est pas soldée — elle
    attend un mouvement, et l'éteindre rendrait invisible l'argent qui va
    arriver."""
    return (
        abs(solde["solde_reel"]) < EPSILON_SOLDE_NUL
        and abs(solde["solde_projete"]) < EPSILON_SOLDE_NUL
    )


def soldes_de_tous_les_liens(db: Session, date_fin: Optional[date_type] = None):
    """Comme `get_soldes_comptes`, mais SANS écarter les monnaies éteintes — et
    chaque solde porte en plus un `active` qui dit laquelle l'est.

    C'est la vue dont a besoin l'ÉCRAN DES COMPTES, et lui seul : pour proposer
    d'éteindre une monnaie il faut la voir, et pour savoir si on en a le droit il
    faut son solde (l'extinction exige qu'il soit nul). Partout ailleurs, une
    monnaie éteinte et soldée n'a rien à dire — d'où les deux fonctions."""
    # Dans l'ordre choisi par l'utilisateur (crud.get_comptes) : les cartes du
    # dashboard se rangent alors comme les lignes de la page Comptes, type par
    # type — c'est là que cet ordre se décide.
    comptes = crud.get_comptes(db)
    sums_reel = _sums_by_compte_monnaie_and_sens(db, statut=Statut.reel)
    sums_total = _sums_by_compte_monnaie_and_sens(db, statut=None, date_fin=date_fin)
    reste_prets = _reste_du_prets_par_compte_monnaie(db, date_fin=date_fin)
    interets = _interets_percus_par_compte_monnaie(db)

    results = []
    for compte in comptes:
        soldes = {}
        for lien in compte.monnaies:
            cle = (compte.id, lien.monnaie_id)
            solde_initial = lien.solde_initial
            # LES INTÉRÊTS PERÇUS S'AJOUTENT AUX DEUX SOLDES, comme le solde
            # initial : ce sont des euros qui SONT là (cf.
            # _interets_percus_par_compte_monnaie). Les mettre dans le seul
            # projeté aurait annoncé de l'argent à venir alors qu'il est déjà
            # versé.
            interets_percus = interets.get(cle, 0.0)
            soldes[lien.monnaie_id] = {
                "monnaie": lien.monnaie,
                "solde_initial": solde_initial,
                "solde_reel": (
                    solde_initial + interets_percus + _solde_delta(sums_reel.get(cle, {}))
                ),
                "solde_projete": (
                    solde_initial
                    + interets_percus
                    + _solde_delta(sums_total.get(cle, {}))
                    - reste_prets.get(cle, 0.0)
                ),
                "active": lien.active,
            }
        results.append({"compte": compte, "soldes": soldes})
    return results


def calculer_totaux_par_monnaie(
    comptes_soldes: list[dict], valorisation_placements: Optional[dict] = None
) -> dict:
    """À partir du résultat de get_soldes_comptes : les totaux du dashboard,
    **par monnaie**.

    solde_total_courant / solde_projete_courant sont limités aux comptes du
    budget courant (l'épargne et les comptes-titres ne sont soumis qu'à des
    virements internes — et à des achats/ventes de titres pour les seconds).
    total_avoirs est la seule valeur qui les inclut, pour voir le patrimoine
    complet ; il ajoute la valorisation des portefeuilles, car sur un
    compte-titres le solde du compte ne reflète que les espèces qui y dorment,
    et l'essentiel de l'avoir est justement ce qui n'y est plus.

    `valorisation_placements` est un dict {monnaie_id: montant} : un titre est
    coté dans une monnaie, sa valorisation ne peut donc entrer que dans le total
    de celle-là.
    """
    valorisation_placements = valorisation_placements or {}
    totaux: dict = {}

    def _entree(monnaie_id: int) -> dict:
        return totaux.setdefault(
            monnaie_id,
            {
                "solde_total_courant": 0.0,
                "solde_projete_courant": 0.0,
                "total_avoirs": 0.0,
                "valorisation_placements": 0.0,
            },
        )

    for item in comptes_soldes:
        est_courant = item["compte"].type_nom not in TYPES_COMPTE_HORS_COURANT
        for monnaie_id, solde in item["soldes"].items():
            entree = _entree(monnaie_id)
            entree["total_avoirs"] += solde["solde_reel"]
            if est_courant:
                entree["solde_total_courant"] += solde["solde_reel"]
                entree["solde_projete_courant"] += solde["solde_projete"]

    for monnaie_id, valorisation in valorisation_placements.items():
        entree = _entree(monnaie_id)
        entree["valorisation_placements"] += valorisation
        entree["total_avoirs"] += valorisation

    return totaux


# ---------- Le mois découpé en semaines ----------
#
# UNE SEMAINE VA DU LUNDI AU DIMANCHE, celle du calendrier — c'est la seule qui
# corresponde à quelque chose de vécu. « La semaine du 6 » se retrouve sur un
# relevé ; « le deuxième bloc de sept jours du mois » ne se retrouve nulle part.
#
# ELLE EST COUPÉE AUX BORDS DU MOIS : la première commence au 1er (donc courte
# si le 1er n'est pas un lundi), la dernière finit au dernier jour (donc courte
# si le mois ne finit pas un dimanche). Les semaines PARTITIONNENT ainsi le mois
# exactement, ce qui est ce dont tout le reste dépend : la somme des semaines
# vaut la barre du mois, et ce qui est posé sur le mois sans avoir de jour —
# part amortie, budget d'une catégorie — se répartit au prorata des jours.
#
# Une semaine à cheval sur deux mois est donc lue deux fois, une part de chaque
# côté. C'est voulu : on regarde un mois, pas une semaine flottante.
JOURS_PAR_SEMAINE = 7


def semaines_du_mois(annee: int, mois: int) -> list[tuple[int, int]]:
    """Les bornes (premier jour, dernier jour) de chaque semaine du mois.

    Quatre à six blocs selon le calendrier : du 1er au premier dimanche, puis
    des lundis aux dimanches, puis du dernier lundi à la fin du mois."""
    dernier = calendar.monthrange(annee, mois)[1]
    bornes = []
    debut = 1
    while debut <= dernier:
        # `weekday()` : lundi = 0 … dimanche = 6. Ce qui reste jusqu'au
        # dimanche vaut donc 6 − weekday, et zéro si on y est déjà.
        jour = date_type(annee, mois, debut)
        fin = min(debut + (6 - jour.weekday()), dernier)
        bornes.append((debut, fin))
        debut = fin + 1
    return bornes


def _bornes_semaine(annee: int, mois: int, semaine: int) -> tuple[date_type, date_type]:
    """Les deux dates d'une semaine, par son rang (1 pour la première)."""
    debut, fin = semaines_du_mois(annee, mois)[semaine - 1]
    return date_type(annee, mois, debut), date_type(annee, mois, fin)


def prorata_semaine(annee: int, mois: Optional[int], semaine: Optional[int]) -> float:
    """La part du mois que cette semaine représente, en JOURS (1.0 hors vue
    semaine).

    CE QUE CE COEFFICIENT SERT À ÉTALER : ce qui est posé sur le MOIS et non sur
    une date — la part d'une dépense amortie, et le budget d'une catégorie. Ni
    l'une ni l'autre n'a de jour dans le mois : une facture étalée sur douze
    mois pèse sur tout le mois, pas sur le 3. La répartir au prorata des jours
    est la seule façon de la faire compter sans inventer une date, et c'est ce
    qui garantit que la somme des semaines vaut toujours le mois.

    Une dépense DATÉE, elle, n'est jamais prorata­tisée : elle tombe dans la
    semaine de sa date, entière."""
    if mois is None or semaine is None:
        return 1.0
    debut, fin = _bornes_semaine(annee, mois, semaine)
    return (fin.day - debut.day + 1) / calendar.monthrange(annee, mois)[1]


def _filtre_periode(annee: int, mois: Optional[int], semaine: Optional[int] = None):
    """mois=None : agrège sur toute l'année plutôt qu'un mois précis (vue
    annuelle du dashboard) — même colonne de date, seul le format strftime
    change (comparaison sur l'année seule).

    `semaine` (1 pour la première du mois) restreint en plus à la semaine
    correspondante : c'est le seul ajout de la vue semaine, et il ne concerne
    que les opérations DATÉES — cf. prorata_semaine pour ce qui est posé sur le
    mois entier.

    LES OPÉRATIONS AMORTIES SONT EXCLUES ICI, et c'est le point : pour elles, la
    date ne dit plus QUAND la dépense pèse, seulement quand l'argent est sorti.
    Ce qu'elles apportent à la période se calcule à part
    (_filtre_periode_amortie + part_amortie), et les compter aussi par leur date
    les ferait peser deux fois sur leur mois d'origine. L'exclusion est posée
    dans ce filtre plutôt qu'à chaque appel : les deux agrégats de période
    (histogramme par catégorie, flux entrées/sorties) doivent l'appliquer, et
    aucun futur appelant n'a de raison de vouloir l'inverse."""
    return and_(
        models.Operation.amorti.is_(False), filtre_date_periode(annee, mois, semaine)
    )


def filtre_date_periode(
    annee: int, mois: Optional[int], semaine: Optional[int] = None
):
    """La seule contrainte de DATE de la période, sans l'exclusion des opérations
    amorties que `_filtre_periode` y ajoute.

    Séparé parce qu'un calcul en a besoin nu : la VARIATION BRUTE compte une
    dépense amortie au mois où l'argent est sorti, pour son montant entier (cf.
    get_variation_brute). Tous les autres agrégats de période veulent l'exclusion
    et passent donc par `_filtre_periode`."""
    if semaine is not None and mois is not None:
        debut, fin = _bornes_semaine(annee, mois, semaine)
        return and_(models.Operation.date >= debut, models.Operation.date <= fin)
    if _etat_salaire["jour"] is not None:
        # MOIS SALARIAL : une fenêtre de dates, et non plus un mois civil.
        debut, fin = bornes_periode(annee, mois)
        return and_(models.Operation.date >= debut, models.Operation.date <= fin)
    if mois is None:
        return func.strftime("%Y", models.Operation.date) == f"{annee:04d}"
    return func.strftime("%Y-%m", models.Operation.date) == f"{annee:04d}-{mois:02d}"


# ---------- Amortissement sur plusieurs mois ----------
#
# Une opération amortie n'existe qu'en un seul exemplaire (cf. models.Operation)
# : ni occurrences générées, ni montant redécoupé en base. Ce sont les agrégats
# de période qui, en les rencontrant, n'en prennent qu'une fraction — celle des
# mois d'amortissement qui tombent dans la période affichée.
#
# Ne sont concernés que les agrégats de PÉRIODE (histogramme des dépenses par
# catégorie, KPI entrées / sorties / différence). Les soldes du haut de page
# n'en tiennent aucun compte, et ne le doivent pas : ils disent où en sont
# réellement les comptes, or l'argent est bien parti en une fois.


def _index_mois(d: date_type) -> int:
    """Numérote les mois d'affilée depuis l'an 0, pour que deux mois se
    comparent et se soustraient sans se soucier du passage d'année."""
    return d.year * 12 + d.month


def _bornes_periode_en_mois(annee: int, mois: Optional[int]) -> tuple[int, int]:
    """Premier et dernier mois de la période affichée, en index de mois."""
    if mois is None:
        return _index_mois(date_type(annee, 1, 1)), _index_mois(date_type(annee, 12, 1))
    borne = _index_mois(date_type(annee, mois, 1))
    return borne, borne


def _filtre_periode_amortie(annee: int, mois: Optional[int]):
    """Les opérations amorties dont la plage recoupe la période — le pendant de
    _filtre_periode pour elles.

    Le chevauchement se teste en SQL (deux comparaisons de dates) plutôt qu'en
    Python : c'est ce qui évite de charger toutes les opérations amorties de la
    base à chaque affichage du dashboard. Les bornes sont normalisées au 1er du
    mois (cf. schemas.OperationBase), la comparaison au premier et au dernier
    jour de la période est donc exacte."""
    debut_periode = date_type(annee, 1 if mois is None else mois, 1)
    fin_periode = fin_de_periode(annee, mois)
    return and_(
        models.Operation.amorti.is_(True),
        models.Operation.amortissement_debut <= fin_periode,
        models.Operation.amortissement_fin >= debut_periode,
    )


def part_amortie(operation: models.Operation, annee: int, mois: Optional[int]) -> float:
    """Quelle FRACTION du montant d'une opération amortie revient à la période
    (0 si elle n'y déborde pas, 1 si toute sa plage y tient).

    Une fraction plutôt qu'un montant : l'appelant décide de ce qu'il étale.
    L'histogramme n'impute pas le montant d'une dépense remboursable mais son
    reste à charge (montant − montant dû) ; renvoyer ici un montant tout fait
    aurait obligé à traiter ce cas deux fois, ou à l'oublier une fois.

    En vue annuelle, la période compte douze mois : un amortissement à cheval
    sur deux années n'apporte à chacune que les mois qui lui reviennent — c'est
    exactement ce que la vue annuelle doit montrer."""
    nb_mois = operation.amortissement_nb_mois
    if not nb_mois:
        return 0.0
    debut_periode, fin_periode = _bornes_periode_en_mois(annee, mois)
    debut_amortissement = _index_mois(operation.amortissement_debut)
    fin_amortissement = _index_mois(operation.amortissement_fin)
    mois_couverts = min(fin_amortissement, fin_periode) - max(
        debut_amortissement, debut_periode
    ) + 1
    if mois_couverts <= 0:
        return 0.0
    return mois_couverts / nb_mois


def part_amortie_fenetre(
    operation: models.Operation, debut: date_type, fin: date_type
) -> float:
    """La FRACTION d'une opération amortie qui revient à une fenêtre QUELCONQUE
    (une semaine qui déborde sur deux mois, un mois, une année, tout
    l'historique) — le pendant de `part_amortie`, qui ne sait lire que des mois
    entiers.

    L'AMORTISSEMENT OCCUPE LES JOURS DE SES MOIS, du 1er du premier au dernier
    jour du dernier. La part d'une fenêtre est donc
    `jours(fenêtre ∩ amortissement) / jours(amortissement)` : l'intersection est
    ce qui sert quand une semaine de bord de mois déborde sur un mois qui ne fait
    pas partie de l'amortissement — ces jours-là ne comptent pour rien.

    UNE FENÊTRE DE MOIS ENTIERS REPREND `part_amortie` À L'IDENTIQUE (mois
    couverts / mois d'amortissement) : un mois de février ne doit pas peser moins
    qu'un mois de 31 jours, et les objectifs doivent tomber d'accord avec
    l'histogramme du dashboard."""
    nb_mois = operation.amortissement_nb_mois
    if not nb_mois:
        return 0.0
    fin_mois_fenetre = fin_de_periode(fin.year, fin.month)
    if debut.day == 1 and fin == fin_mois_fenetre:
        mois_couverts = min(_index_mois(operation.amortissement_fin), _index_mois(fin)) - max(
            _index_mois(operation.amortissement_debut), _index_mois(debut)
        ) + 1
        return max(mois_couverts, 0) / nb_mois
    debut_amort = operation.amortissement_debut.replace(day=1)
    fin_amort = fin_de_periode(operation.amortissement_fin.year, operation.amortissement_fin.month)
    jours_communs = (min(fin, fin_amort) - max(debut, debut_amort)).days + 1
    if jours_communs <= 0:
        return 0.0
    return jours_communs / ((fin_amort - debut_amort).days + 1)


# UNE OPÉRATION DÉCOUPÉE N'A PAS DE CATÉGORIE, et c'est ce qui rend tout ce
# fichier juste sans le réécrire : `categorie_id` passe à NULL dès qu'elle porte
# des parts (cf. models.OperationDecoupe), donc les quatre jointures internes
# sur `categorie` ci-dessous l'écartent d'elles-mêmes. Il ne restait qu'à
# AJOUTER ce que ses parts apportent — d'où les trois fonctions qui suivent,
# chacune le pendant exact d'une agrégation existante.
#
# Rien à faire du côté des FLUX (cf. get_flux_periode) ni des SOLDES : ils
# somment `Operation.montant` sans jamais passer par la catégorie, et la somme
# des parts vaut ce montant. C'est précisément l'intérêt du garde-fou : sans
# lui, l'histogramme et le total des sorties posé juste au-dessus auraient
# cessé de tomber d'accord.
#
# LA BASE IMPOSABLE D'UNE PART EST SON MONTANT, sans exception. Seul le type
# `classique` se découpe (cf. crud.erreur_decoupes), et c'est justement celui
# pour lequel _base_imposable rend le montant tel quel : il n'y a donc aucun
# `montant_du` à répartir entre les parts, et pas de second cas à tenir
# d'accord avec le premier.


def _sommes_decoupes_par_categorie(
    db: Session,
    annee: int,
    mois: Optional[int],
    statut: Statut,
    monnaie_id: int,
    semaine: Optional[int] = None,
) -> dict:
    """Ce que les PARTS des opérations découpées non amorties apportent à la
    période, par catégorie."""
    lignes = (
        db.query(
            models.Categorie.nom,
            func.sum(models.OperationDecoupe.montant).label("total"),
        )
        .join(
            models.Operation,
            models.OperationDecoupe.operation_id == models.Operation.id,
        )
        .join(
            models.Categorie,
            models.OperationDecoupe.categorie_id == models.Categorie.id,
        )
        .filter(
            models.Operation.sens == Sens.depense,
            models.Operation.statut == statut,
            models.Operation.monnaie_id == monnaie_id,
            _filtre_periode(annee, mois, semaine),
        )
        .group_by(models.Categorie.nom)
        .all()
    )
    return {nom: total or 0.0 for nom, total in lignes}


def _sommes_decoupes_amorties_par_categorie(
    db: Session,
    annee: int,
    mois: Optional[int],
    statut: Statut,
    monnaie_id: int,
    semaine: Optional[int] = None,
) -> dict:
    """Le pendant amorti du précédent : chaque part ne compte que pour la
    fraction de l'amortissement qui tombe dans la période.

    L'AMORTISSEMENT PORTE SUR L'OPÉRATION, PAS SUR LA PART : une facture étalée
    sur douze mois l'est en entier, et chacune de ses parts suit le même
    calendrier. Il n'y a donc rien à décider ici — la même `part_amortie`
    s'applique à chaque part."""
    lignes = (
        db.query(models.Categorie.nom, models.OperationDecoupe.montant, models.Operation)
        .join(
            models.Operation,
            models.OperationDecoupe.operation_id == models.Operation.id,
        )
        .join(
            models.Categorie,
            models.OperationDecoupe.categorie_id == models.Categorie.id,
        )
        .filter(
            models.Operation.sens == Sens.depense,
            models.Operation.statut == statut,
            models.Operation.monnaie_id == monnaie_id,
            _filtre_periode_amortie(annee, mois),
        )
        .all()
    )
    totaux: dict = {}
    prorata = prorata_semaine(annee, mois, semaine)
    for nom, montant, operation in lignes:
        totaux[nom] = (
            totaux.get(nom, 0.0)
            + montant * part_amortie(operation, annee, mois) * prorata
        )
    return totaux


def _sommes_par_categorie(
    db: Session,
    annee: int,
    mois: Optional[int],
    statut: Statut,
    monnaie_id: int,
    semaine: Optional[int] = None,
) -> dict:
    """Pour une période (mois précis, ou année entière si mois=None), un statut
    et une monnaie donnés : somme des opérations classiques + somme (montant -
    montant dû) des dépenses remboursables, par catégorie."""
    filtre_commun = [
        models.Operation.sens == Sens.depense,
        models.Operation.statut == statut,
        models.Operation.monnaie_id == monnaie_id,
        _filtre_periode(annee, mois, semaine),
    ]

    classiques = (
        db.query(models.Categorie.nom, func.sum(models.Operation.montant).label("total"))
        .join(models.Categorie, models.Operation.categorie_id == models.Categorie.id)
        .join(models.TypeOperationDB, models.Operation.type_id == models.TypeOperationDB.id)
        .filter(models.TypeOperationDB.code.notin_(_CODES_REMBOURSABLES), *filtre_commun)
        .group_by(models.Categorie.nom)
        .all()
    )
    # Sans l'extension « Suivi des remboursements », une dépense remboursable
    # ne pèse plus sur aucune catégorie (cf. _base_imposable) : la requête ne
    # tourne même pas, plutôt que de sommer puis d'ignorer son résultat.
    remboursables = (
        db.query(
            models.Categorie.nom,
            func.sum(models.Operation.montant - models.Operation.montant_du).label("total"),
        )
        .join(models.Categorie, models.Operation.categorie_id == models.Categorie.id)
        .join(models.TypeOperationDB, models.Operation.type_id == models.TypeOperationDB.id)
        .filter(models.TypeOperationDB.code.in_(_CODES_REMBOURSABLES), *filtre_commun)
        .group_by(models.Categorie.nom)
        .all()
        if _remboursable_compte()
        else []
    )

    totaux: dict = {}
    for nom, total in classiques:
        totaux[nom] = totaux.get(nom, 0.0) + (total or 0.0)
    for nom, total in remboursables:
        totaux[nom] = totaux.get(nom, 0.0) + (total or 0.0)
    for nom, total in _sommes_amorties_par_categorie(
        db, annee, mois, statut, monnaie_id, semaine
    ).items():
        totaux[nom] = totaux.get(nom, 0.0) + total
    # Les opérations DÉCOUPÉES, que les deux requêtes ci-dessus n'ont pas vues :
    # leur `categorie_id` est NULL, la jointure interne sur `categorie` les
    # écarte (cf. le commentaire au-dessus de _sommes_decoupes_par_categorie).
    for source in (
        _sommes_decoupes_par_categorie(db, annee, mois, statut, monnaie_id, semaine),
        _sommes_decoupes_amorties_par_categorie(
            db, annee, mois, statut, monnaie_id, semaine
        ),
    ):
        for nom, total in source.items():
            totaux[nom] = totaux.get(nom, 0.0) + total
    return totaux


def _sommes_amorties_par_categorie(
    db: Session,
    annee: int,
    mois: Optional[int],
    statut: Statut,
    monnaie_id: int,
    semaine: Optional[int] = None,
) -> dict:
    """Ce que les opérations AMORTIES apportent à la période, par catégorie —
    le complément de _sommes_par_categorie, qui les exclut (cf. _filtre_periode).

    L'agrégation se fait en Python et non en SQL : la part imputée dépend du
    nombre de mois d'amortissement tombant dans la période, que SQLite ne sait
    calculer qu'au prix d'une arithmétique de dates illisible. Le filtre de
    chevauchement, lui, reste en SQL — c'est lui qui borne le nombre de lignes
    remontées à celles qui pèsent réellement sur la période."""
    lignes = (
        db.query(models.Categorie.nom, models.Operation, models.TypeOperationDB.code)
        .join(models.Categorie, models.Operation.categorie_id == models.Categorie.id)
        .join(models.TypeOperationDB, models.Operation.type_id == models.TypeOperationDB.id)
        .filter(
            models.Operation.sens == Sens.depense,
            models.Operation.statut == statut,
            models.Operation.monnaie_id == monnaie_id,
            _filtre_periode_amortie(annee, mois),
        )
        .all()
    )

    totaux: dict = {}
    prorata = prorata_semaine(annee, mois, semaine)
    for nom, operation, code in lignes:
        # Même base imposable que pour les non amorties (cf. _base_imposable) :
        # le montant, sauf pour une dépense remboursable, dont seule la part
        # restant à ma charge est une dépense.
        base = _base_imposable(operation.montant, operation.montant_du, code)
        totaux[nom] = (
            totaux.get(nom, 0.0)
            + base * part_amortie(operation, annee, mois) * prorata
        )
    return totaux


# Combien de dépenses l'infobulle d'une barre de l'histogramme détaille. Trois :
# assez pour dire ce qui fait le montant de la barre, assez peu pour se lire
# d'un coup d'œil sans que l'infobulle recouvre le graphique.
NB_TOP_DEPENSES = 3


def _base_imposable(montant: float, montant_du: Optional[float], code: str) -> float:
    """Ce qu'une opération apporte à l'histogramme : son montant, sauf pour une
    dépense remboursable, dont seule la part restant à ma charge est une dépense.

    Extrait ici parce que QUATRE calculs doivent s'accorder sur cette règle —
    les sommes par catégorie, leur pendant amorti, le détail par libellé, et le
    total des entrées/sorties. Une infobulle qui compterait le montant entier
    d'une dépense remboursable annoncerait des lignes dont la somme dépasserait
    la barre qu'elles détaillent ; un total des sorties qui le ferait ne
    tomberait jamais d'accord avec l'histogramme posé juste à côté.

    LE PRÊT REÇU N'EST PAS TRAITÉ ICI, alors que c'est l'autre type remboursable.
    Ses intérêts se calculent à l'envers (`montant_du - montant`, cf.
    _INTERETS_PRET) et il n'a AUCUNE catégorie — son type EST sa classification.
    Or les trois appelants de cette fonction partent tous d'une jointure sur
    `categorie` et d'un `sens = dépense` : un prêt n'y arrive jamais. Il compte
    dans sa propre barre (cf. _barre_interets_prets) et nulle part ailleurs. Le
    tester sur `_CODES_REMBOURSABLES`, qui le contient, rendrait donc ici un
    intérêt NÉGATIF le jour où quelqu'un réemploierait cette fonction.

    SANS L'EXTENSION « SUIVI DES REMBOURSEMENTS » (cf. _remboursable_compte),
    une dépense remboursable apporte 0 : même règle que pour un prêt sans
    l'extension « Prêts » (cf. get_flux_periode) — rien n'explique plus à qui
    l'argent est dû, elle ne doit donc plus peser sur aucun total tant que
    l'extension est éteinte."""
    if code == TypeOperation.remboursable.value:
        if not _remboursable_compte():
            return 0.0
        return montant - (montant_du or 0.0)
    return montant


def _fondre_par_libelle(cumuls: dict, categorie: str, nature: str, montant: float) -> None:
    """Ajoute une dépense au cumul {catégorie: {libellé: [montant, nombre]}}.

    LE LIBELLÉ EST PRIS TEL QUEL, aux espaces de bord près : « Café » et
    « CAFE » restent deux dépenses distinctes. C'est la même règle que la
    détection de doublons d'import (cf. import_bancaire.normaliser_pour_
    comparaison) — confondre deux libellés visiblement différents reviendrait à
    décider à la place de l'utilisateur qu'ils n'en font qu'un."""
    libelle = (nature or "").strip()
    par_libelle = cumuls.setdefault(categorie, {})
    entree = par_libelle.setdefault(libelle, [0.0, 0])
    entree[0] += montant
    entree[1] += 1


def _top_depenses_par_categorie(
    db: Session,
    annee: int,
    mois: Optional[int],
    monnaie_id: int,
    semaine: Optional[int] = None,
) -> dict[str, list[dict]]:
    """Les plus grosses dépenses de la période, par catégorie (cf. `_top_depuis_cumuls`)."""
    return _top_depuis_cumuls(
        _cumuls_depenses_par_libelle(db, annee, mois, monnaie_id, semaine)
    )


def _cumuls_depenses_par_libelle(
    db: Session,
    annee: int,
    mois: Optional[int],
    monnaie_id: int,
    semaine: Optional[int] = None,
) -> dict:
    """{catégorie: {libellé: [montant, nombre]}} des dépenses de la période.

    LES CLÉS DISENT AUSSI QUELLES CATÉGORIES ONT AU MOINS UNE OPÉRATION sur la
    période (une part de découpe ou une part d'amortissement comprise) — même quand
    leur total vaut zéro, par annulation ou parce que la dépense est intégralement
    due. C'est ce qui permet à l'histogramme de ne pas dessiner une barre vide
    qu'aucune opération n'explique, sans écarter celle qui vaut zéro pour une raison.

    Les plus grosses dépenses de la période, par catégorie et fondues par
    libellé — ce que montre l'infobulle d'une barre de l'histogramme.

    MÊME PÉRIMÈTRE QUE LA BARRE, ET C'EST TOUT L'ENJEU : mêmes filtres (sens,
    monnaie, période), même base imposable, et les deux statuts confondus —
    réel ET prévisionnel — parce que c'est la hauteur totale de la barre que
    l'infobulle détaille. Ne prendre que le réel aurait fait survoler une barre
    et lire des lignes qui n'en expliquent qu'une partie.

    Les opérations AMORTIES comptent pour leur seule part de la période, comme
    partout ailleurs (cf. part_amortie) : une facture de 1 200 € étalée sur
    douze mois apparaît à 100 € dans le mois qu'on regarde, pas à 1 200 €.

    L'agrégation se fait en Python : fondre par libellé APRÈS avoir appliqué la
    part amortie ne se dit pas en SQL sans réécrire part_amortie en
    arithmétique de dates. Le volume reste celui d'une période (un mois, ou une
    année) pour une seule monnaie."""
    filtre_commun = [
        models.Operation.sens == Sens.depense,
        models.Operation.monnaie_id == monnaie_id,
    ]
    colonnes = (
        models.Categorie.nom,
        models.Operation.nature,
        models.Operation.montant,
        models.Operation.montant_du,
        models.TypeOperationDB.code,
    )

    def requete(filtre_periode):
        return (
            db.query(*colonnes)
            .join(models.Categorie, models.Operation.categorie_id == models.Categorie.id)
            .join(
                models.TypeOperationDB,
                models.Operation.type_id == models.TypeOperationDB.id,
            )
            .filter(filtre_periode, *filtre_commun)
        )

    cumuls: dict = {}
    prorata = prorata_semaine(annee, mois, semaine)
    for categorie, nature, montant, montant_du, code in requete(
        _filtre_periode(annee, mois, semaine)
    ).all():
        _fondre_par_libelle(
            cumuls, categorie, nature, _base_imposable(montant, montant_du, code)
        )

    # Les amorties, avec la même colonne d'opération en plus : part_amortie a
    # besoin de l'objet, pas seulement de ses montants.
    amorties = (
        db.query(models.Categorie.nom, models.Operation, models.TypeOperationDB.code)
        .join(models.Categorie, models.Operation.categorie_id == models.Categorie.id)
        .join(models.TypeOperationDB, models.Operation.type_id == models.TypeOperationDB.id)
        .filter(_filtre_periode_amortie(annee, mois), *filtre_commun)
        .all()
    )
    for categorie, operation, code in amorties:
        part = (
            _base_imposable(operation.montant, operation.montant_du, code)
            * part_amortie(operation, annee, mois)
            * prorata
        )
        _fondre_par_libelle(cumuls, categorie, operation.nature, part)

    # LES PARTS DES OPÉRATIONS DÉCOUPÉES, sous le libellé de leur opération.
    # Une seule dépense qui se retrouve dans trois barres y apparaît trois fois,
    # chaque fois pour ce que cette catégorie lui doit : c'est exactement ce que
    # l'infobulle promet — dire ce qui fait la hauteur de LA barre survolée.
    for filtre_periode, amortir in (
        (_filtre_periode(annee, mois, semaine), False),
        (_filtre_periode_amortie(annee, mois), True),
    ):
        lignes_decoupees = (
            db.query(
                models.Categorie.nom, models.OperationDecoupe.montant, models.Operation
            )
            .join(
                models.Operation,
                models.OperationDecoupe.operation_id == models.Operation.id,
            )
            .join(
                models.Categorie,
                models.OperationDecoupe.categorie_id == models.Categorie.id,
            )
            .filter(filtre_periode, *filtre_commun)
            .all()
        )
        for categorie, montant_part, operation in lignes_decoupees:
            if amortir:
                montant_part *= part_amortie(operation, annee, mois) * prorata
            _fondre_par_libelle(cumuls, categorie, operation.nature, montant_part)
    return cumuls


def _top_depuis_cumuls(cumuls: dict) -> dict[str, list[dict]]:
    """Les NB_TOP_DEPENSES plus grosses lignes de chaque catégorie, du plus lourd au plus léger."""
    resultats: dict[str, list[dict]] = {}
    for categorie, par_libelle in cumuls.items():
        classees = sorted(
            (
                {"nature": libelle, "montant": montant, "nombre": nombre}
                for libelle, (montant, nombre) in par_libelle.items()
                # Une catégorie peut porter des lignes à 0 (dépense remboursable
                # intégralement due, amortie hors période) : elles ne détaillent
                # rien et occuperaient une des trois places.
                if montant > 0
            ),
            # Le libellé départage deux montants égaux : sans lui, deux
            # affichages successifs des mêmes données pourraient ne pas donner
            # le même ordre.
            key=lambda d: (-d["montant"], d["nature"]),
        )
        resultats[categorie] = classees[:NB_TOP_DEPENSES]
    return resultats


def _budget_alloue_periode(
    db: Session,
    categorie_id: int,
    annee: int,
    mois: Optional[int],
    monnaie_id: int,
    semaine: Optional[int] = None,
) -> float:
    """Budget d'un mois précis, ou somme des 12 mois de l'année si mois=None
    (vue annuelle) — chaque mois résolu par héritage habituel, dans la monnaie
    demandée (cf. crud.get_budget_categorie).

    EN VUE SEMAINE, LE BUDGET EST DÉCOUPÉ AU PRORATA DES JOURS. Un budget est
    posé pour un MOIS (cf. models.Categorie) : il n'y a pas d'enveloppe
    hebdomadaire à lire quelque part. Le trait rouge d'une semaine dit donc « le
    rythme qu'il faudrait tenir », et non une limite qu'on aurait fixée — c'est
    la seule lecture qui garde la somme des semaines égale au budget du mois."""
    if mois is not None:
        return (
            crud.get_budget_categorie(db, categorie_id, annee, mois, monnaie_id)
            * prorata_semaine(annee, mois, semaine)
        )
    return sum(
        crud.get_budget_categorie(db, categorie_id, annee, m, monnaie_id)
        for m in range(1, 13)
    )


def get_budget_total_periode(
    db: Session,
    annee: int,
    mois: Optional[int],
    monnaie_id: int,
    semaine: Optional[int] = None,
) -> float:
    """Le budget TOTAL de la période affichée — même découpage que celui d'une
    catégorie (cf. _budget_alloue_periode), et c'est ce qui les garde
    comparables : l'année somme ses douze mois, une semaine prend sa part des
    jours, et les deux répondent donc toujours de la même période."""
    if mois is not None:
        return crud.get_budget_total(db, annee, mois, monnaie_id) * prorata_semaine(
            annee, mois, semaine
        )
    return sum(crud.get_budget_total(db, annee, m, monnaie_id) for m in range(1, 13))


def get_depenses_par_categorie(
    db: Session,
    annee: int,
    mois: Optional[int],
    monnaie_id: int,
    semaine: Optional[int] = None,
):
    """Valeur réelle = opérations classiques (réel) + (montant - montant dû)
    des dépenses remboursables (réel), pour la période et la monnaie données.
    Valeur prévisionnelle = valeur réelle + la même formule en statut
    prévisionnel.

    Toutes les catégories sont concernées : depuis 0019 la table n'en contient
    plus que de vraies (les quatre anciennes catégories système sont devenues
    des types, et leurs opérations n'ont plus de catégorie du tout).

    SEULES LES CATÉGORIES QUI ONT UNE OPÉRATION SUR LA PÉRIODE SONT RENDUES : une barre
    à zéro que rien n'explique ne montre rien (cf. la boucle plus bas). Parmi elles, le tri
    se fait à l'écran. L'œil de
    l'onglet Catégories filtrait ici, à la source ; il a été retiré (migration
    0056) au profit du filtre du dashboard, qui vit dans le titre du graphe et
    pilote l'histogramme, le camembert et la légende ensemble. Ce filtre-là
    recalcule de toute façon ses trois échelles sur les seules lignes retenues
    (cf. partsCategoriesDashboard), ce qui était la seule raison de filtrer si
    tôt.

    UNE CATÉGORIE ÉTEINTE (`Categorie.active`, migration 0063) N'EST RENDUE QUE
    SI ELLE PORTE QUELQUE CHOSE sur la période — voir la boucle plus bas.

    ET SAUF LES CATÉGORIES D'ENTRÉE (`Categorie.est_entree`, migration 0060). Une
    catégorie dont les opérations sont des ENTRÉES ne peut rien porter ici : les
    sommes ne comptent que le sens « dépense », et c'est ce filtre qui fait que
    la somme des barres vaut exactement le total des sorties affiché juste
    au-dessus. Sa barre restait donc à zéro quoi qu'on y range, avec une
    infobulle annonçant qu'il ne s'y passait rien alors qu'elle pouvait contenir
    tout un salaire. Mieux vaut ne pas la dessiner : l'argent qu'elle porte se
    lit dans « Total entrées », à côté."""
    categories = (
        db.query(models.Categorie)
        .filter(models.Categorie.est_entree.is_(False))
        # NI LA CATÉGORIE DES VIREMENTS INTERNES (migration 0090) : ses opérations sont des
        # jambes de virement, de sens transfert_*, que les sommes ci-dessous ne lisent jamais
        # (elles ne comptent que le sens « dépense »). Sa barre resterait à zéro pour toujours.
        .filter(models.Categorie.est_virement.is_(False))
        .order_by(models.Categorie.ordre)
        .all()
    )

    reel = _sommes_par_categorie(db, annee, mois, Statut.reel, monnaie_id, semaine)
    previsionnel_seul = _sommes_par_categorie(
        db, annee, mois, Statut.previsionnel, monnaie_id, semaine
    )
    # Calculé une fois pour toutes les catégories, pas une requête par barre.
    cumuls = _cumuls_depenses_par_libelle(db, annee, mois, monnaie_id, semaine)
    tops = _top_depuis_cumuls(cumuls)

    resultats = []
    for categorie in categories:
        valeur_reelle = reel.get(categorie.nom, 0.0)
        valeur_previsionnelle = valeur_reelle + previsionnel_seul.get(categorie.nom, 0.0)
        # PAS DE BARRE VIDE POUR UNE CATÉGORIE SANS OPÉRATION. Une catégorie qui n'a aucune
        # opération sur la période (ni part de découpe, ni part d'amortissement) n'a rien à
        # montrer : sa barre à zéro ne ferait que remplir l'histogramme — même si un budget y
        # est posé (il se lit dans Budget → Budgets par catégorie). Une catégorie qui vaut zéro
        # PARCE QU'ELLE A DES OPÉRATIONS (une dépense annulée par son remboursement, une dépense
        # intégralement due) reste : le zéro y est une information.
        if categorie.nom not in cumuls:
            continue
        # UNE CATÉGORIE ÉTEINTE DISPARAÎT QUAND ELLE NE PORTE RIEN (cf.
        # models.Categorie.active). Une catégorie allumée garde sa barre à zéro,
        # elle a quelque chose à dire — « rien dépensé ce mois-ci » ; une
        # catégorie qu'on a rangée n'a plus rien à dire du tout. Mais elle
        # REPARAÎT dès qu'on regarde une période où elle porte des dépenses :
        # sans quoi la somme des barres cesserait de valoir le total des sorties
        # affiché juste au-dessus, et le mois de mars changerait le jour où l'on
        # fait le ménage dans ses catégories.
        if not categorie.active and not valeur_reelle and not valeur_previsionnelle:
            continue
        resultats.append(
            {
                "categorie": categorie.nom,
                "total_reel": valeur_reelle,
                "total_previsionnel": valeur_previsionnelle,
                "budget_alloue": _budget_alloue_periode(
                    db, categorie.id, annee, mois, monnaie_id, semaine
                ),
                "couleur_index": categorie.couleur_index,
                # L'INTENTION, à côté du constat. Rien n'est comparé ici : le
                # camembert pose les deux chiffres l'un contre l'autre, et c'est
                # l'œil qui tranche. Un écart calculé côté serveur aurait dû
                # choisir un dénominateur (toutes les catégories ? les seules
                # affichées ?) alors que ce dénominateur dépend justement du
                # la VUE choisie pour le camembert (cf. renderPieChartDepenses
                # : total dépensé ou budget du mois).
                "objectif_pourcentage": categorie.objectif_pourcentage,
                "top_depenses": tops.get(categorie.nom, []),
            }
        )

    ligne_prets = _barre_interets_prets(db, annee, mois, monnaie_id, semaine)
    if ligne_prets is not None:
        resultats.append(ligne_prets)
    ligne_frais = _barre_frais_virements(db, annee, mois, monnaie_id, semaine)
    if ligne_frais is not None:
        resultats.append(ligne_frais)
    return resultats


def regrouper_par_parent(
    db: Session,
    lignes: list[dict],
    annee: int,
    mois: Optional[int],
    monnaie_id: int,
    semaine: Optional[int] = None,
) -> list[dict]:
    """La barre de chaque catégorie PARENT = elle-même + ses sous-catégories (migration 0103).

    C'EST LA SEULE LECTURE « PAR PARENT » : le dashboard affiche par catégorie parent (les enfants y sont
    fondus dans leur parent, rien ne change à l'écran), et la page Budget empile les `composantes` de la même
    barre. Toute autre lecture (budgets, objectifs, filtres, menus, projets) voit les sous-catégories comme
    des catégories normales et passe par `get_depenses_par_categorie` tel quel.

    LA BARRE DU PARENT : ses totaux sont la somme de sa part directe et de celles de ses enfants ; son budget
    est le SIEN (celui de ses enfants s'y inscrit, leur somme lui étant inférieure ou égale) ; son objectif de
    répartition ajoute ceux de ses enfants (leur part du camembert est fondue dans la sienne) ; ses plus
    grosses dépenses sont reclassées sur l'ensemble. `composantes` ne liste que ce qui pèse quelque chose sur la
    période : la part directe, puis chaque enfant dans l'ordre. Une catégorie sans enfant garde sa ligne, sans
    composantes."""
    categories = {c.nom: c for c in db.query(models.Categorie)}
    par_id = {c.id: c for c in categories.values()}

    def icone_de(categorie) -> Optional[str]:
        if categorie.icone:
            return categorie.icone
        parent = par_id.get(categorie.parent_id) if categorie.parent_id else None
        return parent.icone if parent else None

    enfants: dict[int, list[tuple[dict, models.Categorie]]] = {}
    propres: dict[int, dict] = {}
    for ligne in lignes:
        categorie = categories.get(ligne["categorie"])
        if categorie is None or ligne.get("colonne_speciale"):
            continue
        if categorie.parent_id is not None:
            enfants.setdefault(categorie.parent_id, []).append((ligne, categorie))
        else:
            propres[categorie.id] = ligne

    def composante(ligne, categorie, direct, budget=None):
        return {
            "categorie_id": categorie.id,
            "categorie": categorie.nom,
            "direct": direct,
            "total_reel": ligne["total_reel"] if ligne else 0.0,
            "total_previsionnel": ligne["total_previsionnel"] if ligne else 0.0,
            "budget_alloue": budget if budget is not None else (ligne["budget_alloue"] if ligne else 0.0),
            "couleur_index": categorie.couleur_index,
            "couleur_nuance": None if direct else categorie.couleur_nuance,
            "icone": icone_de(categorie),
        }

    def barre_du_parent(parent: models.Categorie) -> dict:
        propre = propres.get(parent.id)
        filles = sorted(enfants.get(parent.id, []), key=lambda lc: lc[1].ordre)
        budget_parent = (
            propre["budget_alloue"]
            if propre is not None
            else _budget_alloue_periode(db, parent.id, annee, mois, monnaie_id, semaine)
        )
        budgets_enfants = sum(l["budget_alloue"] for l, _ in filles)
        composantes = [composante(propre, parent, True, max(budget_parent - budgets_enfants, 0.0))]
        composantes += [composante(l, c, False) for l, c in filles]
        tops = sorted(
            (propre["top_depenses"] if propre else []) + [t for l, _ in filles for t in l["top_depenses"]],
            key=lambda d: (-d["montant"], d["nature"]),
        )[:NB_TOP_DEPENSES]
        return {
            "categorie": parent.nom,
            "categorie_id": parent.id,
            "icone": icone_de(parent),
            "total_reel": sum(c["total_reel"] for c in composantes),
            "total_previsionnel": sum(c["total_previsionnel"] for c in composantes),
            "budget_alloue": budget_parent,
            "couleur_index": parent.couleur_index,
            "objectif_pourcentage": (parent.objectif_pourcentage or 0.0)
            + sum(c.objectif_pourcentage or 0.0 for _, c in filles),
            "top_depenses": tops,
            # Seules les composantes qui pèsent quelque chose se dessinent (une part directe à zéro, rien).
            "composantes": [c for c in composantes if c["total_previsionnel"] or c["total_reel"]],
        }

    resultat: list[dict] = []
    emis: set[int] = set()
    for ligne in lignes:
        categorie = categories.get(ligne["categorie"])
        if categorie is None or ligne.get("colonne_speciale"):
            resultat.append(ligne)
            continue
        parent = par_id.get(categorie.parent_id) if categorie.parent_id else categorie
        if parent.id in enfants:
            if parent.id not in emis:
                emis.add(parent.id)
                resultat.append(barre_du_parent(parent))
            continue
        resultat.append({**ligne, "categorie_id": categorie.id, "icone": icone_de(categorie)})
    return resultat


def _semaines_revolues(
    annee: int, mois: int, semaines: list[dict], aujourdhui: Optional[date_type] = None
) -> list[dict]:
    """Les semaines sur lesquelles la moyenne a le droit de porter.

    Une semaine est RÉVOLUE quand son dernier jour est passé. Sur un mois
    écoulé, elles le sont toutes et rien ne change ; sur le mois en cours, les
    semaines à venir et celle qu'on est en train de vivre sont écartées — la
    première n'a rien à dire, la seconde pas encore tout.

    Le repli sur la semaine en cours couvre les tout premiers jours du mois,
    où aucune n'est révolue : rendre une liste vide ferait une moyenne à zéro,
    c'est-à-dire une mauvaise nouvelle inventée de toutes pièces.

    `aujourdhui` est un paramètre pour que les tests puissent poser une date
    plutôt que de détourner l'horloge du module : un calcul dont le résultat
    dépend du jour où on le lance ne se vérifie pas autrement.
    """
    aujourdhui = aujourdhui or date_type.today()
    revolues = [s for s in semaines if date_type(annee, mois, s["jour_fin"]) < aujourdhui]
    if revolues:
        return revolues
    if (annee, mois) == (aujourdhui.year, aujourdhui.month):
        en_cours = [
            s for s in semaines if s["jour_debut"] <= aujourdhui.day <= s["jour_fin"]
        ]
        if en_cours:
            return en_cours
    return semaines


def _semaines_calculees(db: Session, annee: int, mois: int, monnaie_id: int) -> list[dict]:
    """Les semaines d'un mois, chacune avec ses dépenses par catégorie et son budget."""
    return [
        {
            "numero": rang,
            "jour_debut": debut,
            "jour_fin": fin,
            "budget_total": get_budget_total_periode(
                db, annee, mois, monnaie_id, semaine=rang
            ),
            "depenses": get_depenses_par_categorie(
                db, annee, mois, monnaie_id, semaine=rang
            ),
        }
        for rang, (debut, fin) in enumerate(semaines_du_mois(annee, mois), start=1)
    ]


def _moyenner_semaines(moyennees: list[dict]) -> tuple[list[dict], float]:
    """La MOYENNE de ces semaines, catégorie par catégorie : leur somme divisée par leur
    nombre, et le budget moyen qui va avec. Rien n'est relu en base : c'est ce qui
    garantit que la barre « Moyenne » est bien la moyenne des barres montrées."""
    nombre = len(moyennees) or 1
    moyenne: dict[str, dict] = {}
    for semaine in moyennees:
        for ligne in semaine["depenses"]:
            cumul = moyenne.setdefault(
                ligne["categorie"],
                {
                    "categorie": ligne["categorie"],
                    "total_reel": 0.0,
                    "total_previsionnel": 0.0,
                    "budget_alloue": 0.0,
                    "couleur_index": ligne["couleur_index"],
                    # L'OBJECTIF SUIT LA CATÉGORIE, pas la période : il ne se
                    # moyenne pas, il se recopie. L'oublier ici faisait
                    # disparaître toutes les cibles de la vue « Moyenne », sans
                    # erreur ni trace — la valeur par défaut du schéma, 0, se
                    # lit exactement comme « aucun objectif posé ».
                    "objectif_pourcentage": ligne.get("objectif_pourcentage", 0.0),
                    # Le détail par libellé n'a pas de sens sur une moyenne : une
                    # dépense moyenne n'a pas eu lieu. L'infobulle dira
                    # simplement qu'il n'y a rien à détailler.
                    "top_depenses": [],
                },
            )
            for champ in ("total_reel", "total_previsionnel", "budget_alloue"):
                cumul[champ] += ligne[champ] / nombre
    return list(moyenne.values()), sum(s["budget_total"] for s in moyennees) / nombre


def _semaine_depensiere(semaine: dict) -> bool:
    """Cette semaine porte-t-elle une dépense, réelle ou prévue ?"""
    return any(
        ligne["total_reel"] > 0 or ligne["total_previsionnel"] > ligne["total_reel"]
        for ligne in semaine["depenses"]
    )


def annees_couvertes(db: Session, aujourdhui: Optional[date_type] = None) -> list[int]:
    """Les années que couvre « tout », de la première opération à la dernière,
    prévisionnelles comprises (cf. `services/periode_tout`).

    Sans aucune opération, l'année en cours seulement : une vue vide plutôt
    qu'une vue qui remonte à l'an zéro. L'année en cours est toujours comprise,
    même si les opérations s'arrêtent avant — « tout » ne peut pas se terminer
    avant aujourd'hui."""
    aujourdhui = aujourdhui or date_type.today()
    premiere, derniere = db.query(
        func.min(models.Operation.date), func.max(models.Operation.date)
    ).one()
    if premiere is None:
        return [aujourdhui.year]
    return list(
        range(min(premiere.year, aujourdhui.year), max(derniere.year, aujourdhui.year) + 1)
    )


def _semaines_revolues_de_l_annee(
    db: Session, annee: int, monnaie_id: int, aujourdhui: date_type
) -> list[dict]:
    """Les semaines RÉVOLUES d'une année, mois après mois — sans le repli de
    `_semaines_revolues` sur la semaine en cours : une année a toujours de quoi se
    passer d'une semaine, et les mois à venir n'ont rien à dire."""
    revolues: list[dict] = []
    for mois in range(1, 13):
        if date_type(annee, mois, 1) > aujourdhui:
            break
        revolues += [
            s
            for s in _semaines_calculees(db, annee, mois, monnaie_id)
            if date_type(annee, mois, s["jour_fin"]) < aujourdhui
        ]
    return revolues


def _a_partir_de_la_premiere_depense(semaines: list[dict]) -> list[dict]:
    """On écarte les semaines d'avant la première dépense : une application
    commencée en août ne doit pas voir sa moyenne écrasée par sept mois vides."""
    premiere = next((i for i, s in enumerate(semaines) if _semaine_depensiere(s)), None)
    return [] if premiere is None else semaines[premiere:]


def get_depenses_moyenne_annee(
    db: Session, annee: int, monnaie_id: int, aujourdhui: Optional[date_type] = None
) -> dict:
    """LA MOYENNE HEBDOMADAIRE D'UNE ANNÉE, à côté de celle du mois dans le dépliant des
    semaines : combien une semaine ordinaire a coûté, par catégorie, sur l'année.

    ELLE SE CALCULE COMME CELLE D'UN MOIS (cf. get_depenses_par_semaine) : la somme des
    semaines divisée par leur nombre, semaines coupées aux bords du mois comprises —
    la seule moyenne qui se vérifie à l'œil sur les barres. Deux différences, qui
    tiennent à l'échelle :

      - SEULES LES SEMAINES RÉVOLUES COMPTENT, sans le repli du mois (« à défaut, la
        semaine en cours ») : une année a toujours de quoi se passer d'une semaine, et
        les mois à venir n'ont rien à dire — ils ne diluent pas la moyenne ;
      - ON COMMENCE À LA PREMIÈRE SEMAINE OÙ IL Y A UNE DÉPENSE. Une application
        commencée en août ne doit pas voir sa moyenne annuelle écrasée par sept mois
        vides : la moyenne porte sur les semaines sur lesquelles on a des dépenses à
        compter, et non sur tout janvier.

    Une année sans aucune dépense rend une moyenne vide, sur zéro semaine."""
    aujourdhui = aujourdhui or date_type.today()
    revolues = _a_partir_de_la_premiere_depense(
        _semaines_revolues_de_l_annee(db, annee, monnaie_id, aujourdhui)
    )
    moyenne, budget_total_moyen = _moyenner_semaines(revolues)
    return {
        "annee": annee,
        "moyenne": moyenne,
        "budget_total_moyen": budget_total_moyen,
        "semaines_moyennees": len(revolues),
    }


def get_depenses_moyenne_periode(
    db: Session,
    vue: str,
    annee: int,
    mois: Optional[int],
    monnaie_id: int,
    aujourdhui: Optional[date_type] = None,
) -> dict:
    """LA MOYENNE HEBDOMADAIRE D'UN ENSEMBLE, CHOISI PAR LE NIVEAU DU DASHBOARD.

    Même principe que les cartes d'objectifs (cf. `service_objectifs.
    fenetres_de_lecture`) : la fenêtre sur laquelle on moyenne est celle du
    niveau où l'on se trouve — le mois, l'année, ou tout l'historique — et non un
    second bouton qu'on choisirait à part. Un seul réglage, donc un seul endroit
    où l'on peut se tromper de période.

      - `mois` : les semaines révolues du mois, avec le repli habituel sur la
        semaine en cours (cf. `_semaines_revolues`) ;
      - `annee` : celles de l'année (cf. `get_depenses_moyenne_annee`) ;
      - `tout` : celles de TOUTES les années couvertes, à partir de la première
        semaine où l'on a dépensé.

    La forme de la réponse est la même dans les trois cas : l'écran dessine la
    même barre « Moyenne » quelle que soit la fenêtre."""
    aujourdhui = aujourdhui or date_type.today()
    if vue == "mois":
        semaines = _semaines_calculees(db, annee, mois, monnaie_id)
        moyennees = _semaines_revolues(annee, mois, semaines, aujourdhui)
    else:
        annees = [annee] if vue == "annee" else annees_couvertes(db, aujourdhui)
        revolues: list[dict] = []
        for a in annees:
            revolues += _semaines_revolues_de_l_annee(db, a, monnaie_id, aujourdhui)
        moyennees = _a_partir_de_la_premiere_depense(revolues)
    moyenne, budget_total_moyen = _moyenner_semaines(moyennees)
    return {
        "vue": vue,
        "annee": annee if vue != "tout" else None,
        "mois": mois if vue == "mois" else None,
        "moyenne": moyenne,
        "budget_total_moyen": budget_total_moyen,
        "semaines_moyennees": len(moyennees),
    }


def get_depenses_par_semaine(db: Session, annee: int, mois: int, monnaie_id: int):
    """L'histogramme du mois DÉPLIÉ : une liste de dépenses par catégorie pour
    chaque semaine, plus la moyenne de ces semaines.

    POURQUOI UNE ROUTE À PART, ET PAS UNE `vue="semaine"` DE PLUS SUR LE
    DASHBOARD. Seul l'histogramme se déplie. Les soldes, le total des avoirs et
    la répartition des comptes n'ont pas de version hebdomadaire à offrir — un
    solde ne se découpe pas, il est ce qu'il est à une date. Faire descendre la
    vue du dashboard entier à la semaine aurait obligé chacun de ces chiffres à
    répondre à une question qu'on ne lui pose pas.

    LA SOMME DES SEMAINES VAUT LE MOIS, au centime : les semaines partitionnent
    les jours (cf. semaines_du_mois), et ce qui n'a pas de jour — part amortie,
    budget — est réparti au prorata des jours (cf. prorata_semaine). C'est le
    même invariant que celui des découpes d'opération, et pour la même raison :
    deux chiffres posés l'un à côté de l'autre qui ne s'accordent pas ne passent
    pas pour une imprécision, mais pour une erreur.

    LA MOYENNE EST CELLE DES SEMAINES RÉVOLUES — leur somme divisée par leur
    nombre, dernière semaine courte comprise. C'est le seul calcul qu'on puisse
    vérifier à l'œil sur les barres d'à côté ; normaliser sur sept jours
    donnerait un chiffre plus juste « par semaine pleine », mais qui ne
    correspondrait à aucune moyenne des barres qu'on regarde. L'écran dit sur
    combien de semaines elle porte.

    RÉVOLUES, ET C'EST TOUT LE POINT SUR UN MOIS EN COURS. Le 14 septembre, un
    mois de cinq semaines en a deux de vécues et trois qui n'ont pas commencé :
    diviser par cinq annonçait une moyenne hebdomadaire deux fois et demie trop
    basse, et c'est précisément le chiffre qu'on regarde pour savoir si l'on
    tient son rythme. La semaine EN COURS est écartée elle aussi — à son
    deuxième jour, elle tire la moyenne vers le bas exactement comme une semaine
    future, alors qu'elle n'est pas finie. Elle garde bien sûr sa propre barre :
    seule la MOYENNE change de périmètre.

    S'IL N'Y A AUCUNE SEMAINE RÉVOLUE (on est dans les tout premiers jours du
    mois), la moyenne porte sur la semaine en cours, faute de mieux : c'est la
    seule qui ait quoi que ce soit à dire, et rendre zéro serait pire. Un mois
    PASSÉ n'est pas concerné — toutes ses semaines sont révolues — et un mois à
    venir garde les siennes, qui sont de toute façon toutes à zéro.
    """
    semaines = _semaines_calculees(db, annee, mois, monnaie_id)

    # La moyenne, catégorie par catégorie. On repart des lignes déjà calculées
    # plutôt que d'interroger la base une fois de plus : c'est ce qui garantit
    # que la barre « Moyenne » est bien la moyenne des barres montrées, et non
    # un second calcul qui pourrait en différer.
    moyennees = _semaines_revolues(annee, mois, semaines)
    moyenne, budget_total_moyen = _moyenner_semaines(moyennees)

    return {
        "annee": annee,
        "mois": mois,
        "semaines": semaines,
        "moyenne": moyenne,
        # La moyenne des budgets des semaines MOYENNÉES, et non le budget du
        # mois divisé par quatre : c'est la moyenne des BARRES prises en compte
        # qui doit s'accorder à la barre « Moyenne », découpe des jours comprise.
        "budget_total_moyen": budget_total_moyen,
        # SUR COMBIEN DE SEMAINES ELLE PORTE. L'écran l'écrit dans le titre du
        # graphe : une moyenne dont on ne sait pas ce qu'elle recouvre ne se
        # compare à rien, et sur un mois en cours ce nombre n'est plus celui des
        # barres affichées.
        "semaines_moyennees": len(moyennees),
    }


# La couleur de la barre des intérêts. Prise EN FIN de palette (cf. app.js,
# PALETTE_CATEGORIES) : cette barre n'est pas une catégorie, et lui donner
# l'index 0 la ferait porter la couleur de la première catégorie créée.
_COULEUR_INTERETS_PRETS = 7


def _barre_interets_prets(db: Session, annee, mois, monnaie_id, semaine=None):
    """La barre « Intérêts de prêts », ou None s'il n'y a rien à montrer.

    CE QU'ELLE EST. Pas une catégorie : aucune ligne de `categorie` ne porte ce
    nom, on ne peut ni la renommer, ni lui poser un budget, ni l'éteindre. C'est
    une barre de plus, qui existe pour que l'histogramme dise la MÊME CHOSE que
    le total des sorties — lequel compte les intérêts d'un prêt
    (cf. get_flux_periode). Sans elle, chaque prêt rouvrirait l'écart entre les
    deux chiffres que tout le reste de ce module s'emploie à tenir fermé.

    DEUX CONDITIONS, et les deux comptent :

      - l'extension « Prêts » tourne. Sinon les intérêts ne sont pas non plus
        dans les sorties, et une barre sans rien en face n'aurait pas de sens ;
      - le total n'est pas nul. Un prêt sans intérêts (on rend exactement ce
        qu'on a reçu, `montant_du == montant`) ne coûte rien : afficher une
        barre à zéro ajouterait une colonne vide à chaque histogramme de
        quiconque a emprunté.
    """
    if not extensions.est_active(EXTENSION_PRETS):
        return None

    def _interets(statut):
        total = (
            db.query(func.sum(_INTERETS_PRET))
            .join(models.Compte, models.Operation.compte_id == models.Compte.id)
            .join(models.TypeCompte, models.Compte.type_id == models.TypeCompte.id)
            .join(
                models.TypeOperationDB,
                models.Operation.type_id == models.TypeOperationDB.id,
            )
            .filter(
                models.TypeOperationDB.code == TypeOperation.pret.value,
                models.Operation.monnaie_id == monnaie_id,
                models.Operation.statut == statut,
                models.TypeCompte.nom.notin_(TYPES_COMPTE_HORS_COURANT),
                _filtre_periode(annee, mois, semaine),
            )
            .scalar()
        )
        return total or 0.0

    reel = _interets(Statut.reel)
    previsionnel = reel + _interets(Statut.previsionnel)
    if abs(previsionnel) < 0.005 and abs(reel) < 0.005:
        return None

    return {
        "categorie": LIBELLE_INTERETS_PRETS,
        "total_reel": reel,
        "total_previsionnel": previsionnel,
        # AUCUN BUDGET : on ne se fixe pas une enveloppe d'intérêts, on les
        # subit. Un trait rouge sur cette barre n'aurait rien à annoncer.
        "budget_alloue": 0.0,
        "couleur_index": _COULEUR_INTERETS_PRETS,
        # Le détail par libellé n'a pas de sens ici : chaque prêt est une ligne,
        # et son libellé est déjà celui de la barre.
        "top_depenses": [],
    }


def _lignes_frais_virements(db: Session, annee, mois, monnaie_id, semaine=None, filtre=None):
    """Les opérations dont les FRAIS comptent comme une dépense, dans la monnaie et sur la
    période données : toute jambe de VIREMENT INTERNE qui porte des frais, quel que soit
    son compte, et toute opération d'un compte d'ÉPARGNE ou de PLACEMENTS qui en porte.

    CES FRAIS NE SE LISAIENT NULLE PART. Un virement est écarté des flux (il déplace de
    l'argent sans en faire sortir), un compte d'épargne ou de placements aussi (il ne
    porte pas le budget courant) — et leurs frais avec eux. Or ces frais-là sont bien
    partis, à la banque. Ils comptent donc dans les sorties de la période, dans les deux
    variations et dans l'histogramme (une barre à eux, cf. _barre_frais_virements), pour
    leur SEUL montant de frais.

    PAS LES FRAIS D'UNE OPÉRATION ORDINAIRE D'UN COMPTE COURANT : ils sont déjà dans son
    montant, donc déjà dans sa catégorie — les compter ici les compterait deux fois.

    UNE SEULE JAMBE D'UN VIREMENT LES PORTE (cf. crud._jambe_des_frais), dans SA monnaie :
    c'est elle qu'on lit. Réel et prévisionnel confondus, sauf `filtre` (un statut, pour
    l'histogramme)."""
    requete = (
        db.query(models.Operation)
        .join(models.Compte, models.Operation.compte_id == models.Compte.id)
        .join(models.TypeCompte, models.Compte.type_id == models.TypeCompte.id)
        .join(models.TypeOperationDB, models.Operation.type_id == models.TypeOperationDB.id)
        .filter(
            models.Operation.frais > 0,
            models.Operation.monnaie_id == monnaie_id,
            or_(
                models.TypeOperationDB.code == TypeOperation.virement.value,
                models.TypeCompte.nom.in_(TYPES_COMPTE_HORS_COURANT),
            ),
            _filtre_periode(annee, mois, semaine),
        )
    )
    if filtre is not None:
        requete = requete.filter(models.Operation.statut == filtre)
    return requete.all()


def _frais_virements(db: Session, annee, mois, monnaie_id, semaine=None) -> float:
    return sum(op.frais for op in _lignes_frais_virements(db, annee, mois, monnaie_id, semaine))


# L'index de palette de la barre des frais : sans effet à l'écran, qui la peint du gris
# réservé aux frais (cf. app.js, GRIS_FRAIS) ; posé pour que la forme reste celle d'une
# barre ordinaire.
_COULEUR_FRAIS_VIREMENTS = 7


def _barre_frais_virements(db: Session, annee, mois, monnaie_id, semaine=None):
    """La barre des frais (virements, épargne, placements), ou None s'il n'y en a pas.

    Même nature que « Intérêts de prêts » : pas une catégorie, une barre de plus qui
    existe pour que l'histogramme dise la MÊME CHOSE que le total des sorties, lequel
    compte ces frais (cf. _lignes_frais_virements). `colonne_speciale` dit à l'écran
    de la peindre en gris et de lui donner sa fenêtre de détail."""
    reel_lignes = _lignes_frais_virements(db, annee, mois, monnaie_id, semaine, Statut.reel)
    prev_lignes = _lignes_frais_virements(
        db, annee, mois, monnaie_id, semaine, Statut.previsionnel
    )
    reel = sum(op.frais for op in reel_lignes)
    previsionnel = reel + sum(op.frais for op in prev_lignes)
    if previsionnel < 0.005:
        return None
    cumuls: dict = {}
    for op in [*reel_lignes, *prev_lignes]:
        _fondre_par_libelle(cumuls, LIBELLE_FRAIS_VIREMENTS, op.nature, op.frais)
    top = sorted(
        (
            {"nature": nature, "montant": montant, "nombre": nombre}
            for nature, (montant, nombre) in cumuls.get(LIBELLE_FRAIS_VIREMENTS, {}).items()
        ),
        key=lambda d: (-d["montant"], d["nature"]),
    )[:NB_TOP_DEPENSES]
    return {
        "categorie": LIBELLE_FRAIS_VIREMENTS,
        "total_reel": reel,
        "total_previsionnel": previsionnel,
        "budget_alloue": 0.0,
        "couleur_index": _COULEUR_FRAIS_VIREMENTS,
        "colonne_speciale": "frais_virements",
        "top_depenses": top,
    }


def get_flux_periode(
    db: Session, annee: int, mois: Optional[int], monnaie_id: int
) -> dict:
    """Ce qui est entré, ce qui est sorti, et leur différence, pour la période
    et la monnaie données — réel et prévisionnel confondus.

    LES VIREMENTS INTERNES SONT EXCLUS PAR CONSTRUCTION, et c'est le point de
    cette fonction : le filtre porte sur `sens IN (entrée, dépense)`, il ne se
    contente pas d'espérer qu'aucun transfert ne s'y glisse. Un virement déplace
    de l'argent entre mes propres comptes sans changer mon solde global ; le
    compter d'un côté sans l'autre gonflerait aussi bien les entrées que les
    sorties. La version précédente soustrayait deux totaux groupés par sens sans
    filtrer : elle donnait le bon résultat tant que rien d'autre que
    `transfert_*` ne portait un virement, mais rien ne le garantissait — le
    calcul dépendait d'une absence plutôt que d'une règle.

    Les achats et ventes de titres sont eux aussi des `transfert_*` (acheter des
    titres convertit l'argent, ne le dépense pas) : ils tombent sous le même
    filtre.

    Les comptes d'épargne et de placements sont écartés à part : ils ne
    reçoivent que des virements internes, donc rien qui puisse compter ici, mais
    les exclure explicitement garde le total cohérent avec les KPI de solde, qui
    les excluent aussi.

    Renvoie un dict plutôt qu'un seul nombre : le dashboard affiche désormais
    les deux composantes à côté de leur différence, et les recalculer
    séparément ouvrirait la porte à trois chiffres qui ne s'accordent pas.

    Les opérations amorties comptent pour leur seule part de la période (cf.
    part_amortie), et non pour leur montant entier au mois où l'argent est
    sorti : ces trois chiffres répondent à « qu'est-ce que cette période me
    coûte », pas à « qu'est-ce qui est passé sur le compte » — sans quoi
    amortir n'aurait d'effet que sur l'histogramme, qui cesserait aussitôt de
    s'accorder avec le total des sorties juste à côté.

    CE QUI EST COMPTÉ, ET POUR COMBIEN — la règle tient en trois lignes :

      - une opération CLASSIQUE, pour son montant entier ;
      - une DÉPENSE REMBOURSABLE, pour `montant - montant_du` : seulement ce qui
        reste à ma charge une fois qu'on m'aura rendu le reste ;
      - un PRÊT REÇU, pour `montant_du - montant` : ses seuls intérêts, et du
        côté des SORTIES — l'argent emprunté n'est pas un revenu, il faudra le
        rendre ; ce qu'il coûte est l'écart entre les deux.

    TOUT LE RESTE EST ÉCARTÉ. Les virements internes et les mouvements de titres
    par le filtre de sens (déplacer de l'argent n'est ni le gagner ni le
    dépenser), et les deux types de RÈGLEMENT — remboursement reçu, remboursement
    de prêt — par `TYPES_HORS_FLUX` : ils soldent une dette déjà comptée quand
    elle est née, et la compter deux fois donnerait un total faux dans le mauvais
    sens.

    `montant_du` est ce qu'on doit AU DÉPART, figé — pas `montant_a_rembourser`,
    qui décroît au fil des règlements. C'est le bon des deux : ce qu'une dépense
    coûte vraiment ne dépend pas de la date à laquelle on est remboursé.
    """
    filtres_communs = [
        models.Operation.monnaie_id == monnaie_id,
        models.TypeCompte.nom.notin_(TYPES_COMPTE_HORS_COURANT),
        models.Operation.sens.in_([Sens.entree, Sens.depense]),
        # Les RÈGLEMENTS ne comptent jamais : ils soldent une dette déjà comptée
        # quand elle est née (cf. constants.TYPES_HORS_FLUX).
        models.TypeOperationDB.code.notin_(_CODES_HORS_FLUX),
    ]

    def _requete(montant):
        return (
            db.query(models.Operation.sens, func.sum(montant).label("total"))
            .join(models.Compte, models.Operation.compte_id == models.Compte.id)
            .join(models.TypeCompte, models.Compte.type_id == models.TypeCompte.id)
            .join(
                models.TypeOperationDB,
                models.Operation.type_id == models.TypeOperationDB.id,
            )
            .filter(_filtre_periode(annee, mois), *filtres_communs)
            .group_by(models.Operation.sens)
        )

    est_pret = models.TypeOperationDB.code == TypeOperation.pret.value
    est_depense_remboursable = and_(
        models.TypeOperationDB.code == TypeOperation.remboursable.value,
        models.Operation.sens == Sens.depense,
    )

    totaux: dict = {}

    # 1. Tout le reste, pour son montant entier.
    for sens, total in _requete(models.Operation.montant).filter(
        ~est_pret, ~est_depense_remboursable
    ):
        totaux[sens] = totaux.get(sens, 0.0) + (total or 0.0)

    # 2. Une dépense remboursable ne pèse que pour ce qui reste à ma charge —
    # et seulement si l'extension « Suivi des remboursements » tourne : sans
    # elle, aucun écran ne dit plus à qui cet argent est dû (même règle qu'au
    # point 3 pour les prêts, cf. _remboursable_compte).
    if _remboursable_compte():
        for sens, total in _requete(
            models.Operation.montant - models.Operation.montant_du
        ).filter(est_depense_remboursable):
            totaux[sens] = totaux.get(sens, 0.0) + (total or 0.0)

    # 3. Un prêt reçu pèse pour ses SEULS INTÉRÊTS, et du côté des SORTIES.
    #
    # L'argent d'un prêt n'est pas un revenu : il faudra le rendre. Ce qu'il
    # coûte vraiment, c'est l'écart entre ce qu'on rendra et ce qu'on a reçu —
    # `montant_du - montant`, qui est positif puisqu'on ne rembourse jamais
    # moins qu'on n'a emprunté — c'est même la borne que le type impose à la
    # saisie (cf. crud.erreur_montant_du). C'est un COÛT, il va donc aux
    # sorties, alors
    # même que l'opération porte `sens = entrée` : c'est la seule endroit de ce
    # calcul où le sens de l'écriture ne décide pas de la colonne.
    #
    # SEULEMENT SI L'EXTENSION TOURNE. Sans elle, aucun écran n'explique d'où
    # sortent ces intérêts, et l'histogramme ne porte pas la barre qui leur
    # correspond : les compter creuserait un écart au lieu d'en combler un.
    if extensions.est_active(EXTENSION_PRETS):
        interets = _requete(_INTERETS_PRET).filter(est_pret)
        for _sens, total in interets:
            totaux[Sens.depense] = totaux.get(Sens.depense, 0.0) + (total or 0.0)

    amorties = (
        db.query(models.Operation)
        .join(models.Compte, models.Operation.compte_id == models.Compte.id)
        .join(models.TypeCompte, models.Compte.type_id == models.TypeCompte.id)
        .join(
            models.TypeOperationDB,
            models.Operation.type_id == models.TypeOperationDB.id,
        )
        .filter(_filtre_periode_amortie(annee, mois), *filtres_communs)
        .all()
    )
    for operation in amorties:
        code = operation.type_operation.code
        if code == TypeOperation.pret.value:
            # Même règle qu'au point 3, part amortie comprise.
            if not extensions.est_active(EXTENSION_PRETS):
                continue
            base = max(0.0, operation.montant_du - operation.montant)
            sens_impute = Sens.depense
        else:
            base = _base_imposable(operation.montant, operation.montant_du, code)
            sens_impute = operation.sens
        totaux[sens_impute] = totaux.get(sens_impute, 0.0) + (
            base * part_amortie(operation, annee, mois)
        )

    # 4. LES FRAIS DE VIREMENTS INTERNES, une dépense comme une autre (cf.
    # _lignes_frais_virements) — le virement lui-même reste écarté.
    totaux[Sens.depense] = totaux.get(Sens.depense, 0.0) + _frais_virements(
        db, annee, mois, monnaie_id
    )

    entrees = totaux.get(Sens.entree, 0.0)
    sorties = totaux.get(Sens.depense, 0.0)
    return {"entrees": entrees, "sorties": sorties, "variation": entrees - sorties}


def get_top_flux_periode(
    db: Session, annee: int, mois: Optional[int], monnaie_id: int
) -> dict:
    """Les trois plus grosses lignes de chaque côté — ce que montrent les
    infobulles des cartes « Total Entrées » et « Total Dépenses ».

    LE MÊME PÉRIMÈTRE QUE `get_flux_periode`, ET C'EST TOUT L'ENJEU. Un détail
    dont la somme ne vaut pas le chiffre qu'il détaille est pire que pas de
    détail du tout : l'utilisateur additionne les trois lignes, ne retrouve pas
    la carte, et cesse de faire confiance aux deux. Les trois règles de la carte
    sont donc rejouées ici À L'IDENTIQUE — montant entier pour l'ordinaire, part
    restant à charge pour une dépense remboursable, intérêts seuls et du côté
    des SORTIES pour un prêt reçu — extensions comprises, puisque chacune de ces
    règles s'éteint avec la sienne.

    CE N'EST PAS LE TOP DE L'HISTOGRAMME (cf. `_top_depenses_par_categorie`), et
    les deux ne peuvent pas être confondus : celui-là détaille UNE catégorie et
    part d'une jointure sur `categorie` ; celui-ci détaille un TOTAL de période,
    prêts compris — lesquels n'ont aucune catégorie — et écarte les comptes hors
    courant et les règlements, que l'histogramme ne connaît pas non plus de la
    même façon.

    FONDU PAR LIBELLÉ, comme l'autre : trois passages « Courses » à 25 € font
    une ligne de 75 €, et `nombre` vaut 3. C'est ce qui fait remonter une dépense
    récurrente au-dessus d'un achat isolé plus gros — sans quoi le classement
    dirait ce qu'on a payé le plus cher en une fois, pas ce qui pèse le plus
    dans la période.

    L'agrégation se fait en Python, pour la raison habituelle : la part amortie
    ne se dit pas en SQL sans réécrire `part_amortie` en arithmétique de dates.
    Le volume est celui d'une période pour une seule monnaie.
    """
    filtres_communs = [
        models.Operation.monnaie_id == monnaie_id,
        models.TypeCompte.nom.notin_(TYPES_COMPTE_HORS_COURANT),
        models.Operation.sens.in_([Sens.entree, Sens.depense]),
        models.TypeOperationDB.code.notin_(_CODES_HORS_FLUX),
    ]

    def _lignes(filtre_periode):
        return (
            db.query(models.Operation, models.TypeOperationDB.code)
            .join(models.Compte, models.Operation.compte_id == models.Compte.id)
            .join(models.TypeCompte, models.Compte.type_id == models.TypeCompte.id)
            .join(
                models.TypeOperationDB,
                models.Operation.type_id == models.TypeOperationDB.id,
            )
            .filter(filtre_periode, *filtres_communs)
            .all()
        )

    prets_actifs = extensions.est_active(EXTENSION_PRETS)

    def _contribution(operation, code):
        """(sens imputé, montant) — ou None quand la ligne ne compte pas.

        LE PRÊT REÇU EST LE SEUL CAS OÙ LE SENS DE L'ÉCRITURE NE DÉCIDE PAS DE
        LA COLONNE : l'opération porte `sens = entrée` (l'argent est arrivé),
        mais ce qu'elle COÛTE est l'écart entre ce qu'on rendra et ce qu'on a
        reçu, et cela va aux sorties. Même règle que la carte."""
        if code == TypeOperation.pret.value:
            if not prets_actifs:
                return None
            return Sens.depense, max(0.0, (operation.montant_du or 0.0) - operation.montant)
        return operation.sens, _base_imposable(
            operation.montant, operation.montant_du, code
        )

    cumuls: dict = {Sens.entree: {}, Sens.depense: {}}

    def _ajouter(sens, nature, montant):
        libelle = (nature or "").strip()
        entree = cumuls[sens].setdefault(libelle, [0.0, 0])
        entree[0] += montant
        entree[1] += 1

    for operation, code in _lignes(_filtre_periode(annee, mois)):
        contribution = _contribution(operation, code)
        if contribution is None:
            continue
        sens, montant = contribution
        _ajouter(sens, operation.nature, montant)

    # Les amorties, pour leur seule part de la période — comme partout ailleurs.
    for operation, code in _lignes(_filtre_periode_amortie(annee, mois)):
        contribution = _contribution(operation, code)
        if contribution is None:
            continue
        sens, montant = contribution
        _ajouter(sens, operation.nature, montant * part_amortie(operation, annee, mois))

    # Les frais de virements internes, comptés dans la carte (cf. get_flux_periode).
    for operation in _lignes_frais_virements(db, annee, mois, monnaie_id):
        _ajouter(Sens.depense, operation.nature, operation.frais)

    def _classer(par_libelle):
        return sorted(
            (
                {"nature": libelle, "montant": montant, "nombre": nombre}
                for libelle, (montant, nombre) in par_libelle.items()
                # Une ligne à zéro ne détaille rien (dépense remboursable
                # intégralement due, prêt sans intérêts) et occuperait une des
                # trois places.
                if montant > 0
            ),
            # Le libellé départage deux montants égaux : sans lui, deux
            # affichages successifs des mêmes données pourraient ne pas donner
            # le même ordre.
            key=lambda d: (-d["montant"], d["nature"]),
        )[:NB_TOP_DEPENSES]

    return {
        "entrees": _classer(cumuls[Sens.entree]),
        "sorties": _classer(cumuls[Sens.depense]),
    }


def get_variation_brute(
    db: Session, annee: int, mois: Optional[int], monnaie_id: int
) -> float:
    """De combien les comptes courants ont bougé sur la période, SANS RIEN
    ÉTALER NI RETRANCHER.

    CE QU'ELLE RÉPOND, et que rien d'autre ne répondait : « qu'est-ce qui est
    passé sur le compte ce mois-ci ». Pas « qu'est-ce que ce mois me coûte » —
    c'est la question de `get_flux_periode`, et les deux ne se confondent pas :

      - une DÉPENSE AMORTIE compte ici en ENTIER, au mois où l'argent est sorti.
        L'étalement dit ce qu'elle pèse, pas ce qui a quitté le compte ;
      - une DÉPENSE REMBOURSABLE compte pour son montant ENTIER, sans retrancher
        ce qu'on nous rendra. L'argent est parti, même s'il reviendra ;
      - un PRÊT REÇU compte pour son montant entier, du côté des entrées : cet
        argent est bien arrivé, même s'il faudra le rendre ;
      - un RÈGLEMENT (remboursement reçu, remboursement de prêt) compte lui
        aussi, alors que les flux l'écartent : il solde une dette déjà comptée,
        mais il déplace bel et bien de l'argent.

    CE QUI RESTE ÉCARTÉ, et pour la même raison que dans les flux : les
    VIREMENTS INTERNES et les mouvements de titres (`sens IN (entrée, dépense)`
    ne les retient pas) — déplacer de l'argent entre ses propres comptes ne fait
    bouger aucun total ; et les comptes d'ÉPARGNE et de PLACEMENTS, pour que ce
    chiffre reste comparable au « Solde total » posé à côté de lui, qui les
    exclut déjà.

    RÉEL ET PRÉVISIONNEL CONFONDUS, comme les flux : une opération à venir dans
    le mois en fait partie.
    """
    lignes = (
        db.query(models.Operation.sens, func.sum(models.Operation.montant))
        .join(models.Compte, models.Operation.compte_id == models.Compte.id)
        .join(models.TypeCompte, models.Compte.type_id == models.TypeCompte.id)
        .filter(
            # `filtre_date_periode` et non `_filtre_periode` : les opérations
            # amorties comptent ici, à leur date et pour leur montant entier.
            filtre_date_periode(annee, mois),
            models.Operation.monnaie_id == monnaie_id,
            models.TypeCompte.nom.notin_(TYPES_COMPTE_HORS_COURANT),
            models.Operation.sens.in_([Sens.entree, Sens.depense]),
        )
        .group_by(models.Operation.sens)
        .all()
    )
    totaux = {sens: (total or 0.0) for sens, total in lignes}
    # LES FRAIS DE VIREMENTS INTERNES sont partis du compte, comme dans les flux (cf.
    # _lignes_frais_virements) : ils comptent ici aussi, et l'écart entre les deux
    # variations n'en dépend donc pas.
    frais = _frais_virements(db, annee, mois, monnaie_id)
    return totaux.get(Sens.entree, 0.0) - totaux.get(Sens.depense, 0.0) - frais


# Pourquoi une opération creuse un écart entre les deux variations. Un code
# plutôt qu'une phrase : c'est l'écran qui écrit la phrase, et il la traduit.
RAISON_AMORTISSEMENT = "amortissement"
RAISON_REMBOURSABLE = "remboursable"
RAISON_PRET = "pret"
RAISON_REGLEMENT = "reglement"


def _contributions_operation(
    operation: models.Operation,
    annee: int,
    mois: Optional[int],
    dans_periode_date: bool,
    prets_actifs: bool,
    remboursable_actif: bool,
) -> tuple:
    """Ce qu'UNE opération apporte à chacune des deux variations.

    CETTE FONCTION EST UN MIROIR, et c'est toute sa difficulté : elle doit rendre
    exactement ce que `get_variation_brute` et `get_flux_periode` comptent, y
    compris leurs cas particuliers, sinon la somme des écarts ne vaudrait pas
    l'écart affiché — et un détail qui ne totalise pas le chiffre qu'il détaille
    est pire que pas de détail du tout. Le test
    `test_ecart_variations.py::test_somme_des_ecarts_vaut_la_difference` la tient.

    Les deux valeurs sont SIGNÉES du point de vue du compte : une entrée
    positive, une dépense négative. C'est ce qui permet de les soustraire sans
    se demander de quel côté chacune tombait.
    """
    code = operation.type_operation.code
    signe = 1.0 if operation.sens == Sens.entree else -1.0
    montant_du = operation.montant_du or 0.0

    # ---- La BRUTE : à la date, pour le montant, sans rien retrancher.
    # Une opération amortie qui ne recoupe la période que par son étalement n'y
    # apporte RIEN : l'argent est sorti un autre mois.
    brute = signe * operation.montant if dans_periode_date else 0.0

    # ---- L'ATTRIBUÉE : ce que la période coûte.
    if code in _CODES_HORS_FLUX:
        # Un RÈGLEMENT solde une dette déjà comptée quand elle est née.
        attribuee = 0.0
    elif operation.amorti:
        part = part_amortie(operation, annee, mois)
        if code == TypeOperation.pret.value:
            attribuee = (
                -max(0.0, montant_du - operation.montant) * part if prets_actifs else 0.0
            )
        else:
            # `_remboursable_compte()` n'est volontairement PAS testé ici : la
            # boucle des amorties de `get_flux_periode` ne le teste pas non plus,
            # et ce miroir doit refléter le calcul tel qu'il est, pas tel qu'on
            # l'écrirait aujourd'hui.
            attribuee = (
                signe * _base_imposable(operation.montant, operation.montant_du, code) * part
            )
    elif dans_periode_date:
        if code == TypeOperation.pret.value:
            # Un prêt reçu ne compte que pour ses INTÉRÊTS, et du côté des
            # sorties — d'où le signe négatif quel que soit le sens de
            # l'écriture.
            attribuee = -max(0.0, montant_du - operation.montant) if prets_actifs else 0.0
        elif code == TypeOperation.remboursable.value and operation.sens == Sens.depense:
            attribuee = (
                signe * (operation.montant - montant_du) if remboursable_actif else 0.0
            )
        else:
            attribuee = signe * operation.montant
    else:
        attribuee = 0.0

    return brute, attribuee


def _raison_ecart(operation: models.Operation) -> str:
    """POURQUOI cette ligne creuse un écart. L'ordre des tests compte : une
    dépense remboursable ET amortie est d'abord une amortie — c'est l'étalement
    qui explique le gros de son écart, et c'est lui qu'on veut lire en tête."""
    code = operation.type_operation.code
    if operation.amorti:
        return RAISON_AMORTISSEMENT
    if code in _CODES_HORS_FLUX:
        return RAISON_REGLEMENT
    if code == TypeOperation.pret.value:
        return RAISON_PRET
    return RAISON_REMBOURSABLE


def get_ecart_variations(
    db: Session, annee: int, mois: Optional[int], monnaie_id: int
) -> dict:
    """Les opérations qui expliquent l'écart entre la variation BRUTE et la
    variation ATTRIBUÉE, une par une.

    CE QU'ON VIENT Y CHERCHER. Deux chiffres posés côte à côte sur le dashboard
    ne tombent jamais d'accord, et c'est normal — l'un dit ce qui est passé sur
    le compte, l'autre ce que la période coûte. Mais « c'est normal » n'est pas
    une explication : devant 400 € d'écart, la seule question utile est
    « lesquelles ? ». Cet écran-là y répond, et rien d'autre dans l'application
    ne le pouvait.

    QUATRE FAMILLES, et il n'y en a pas d'autres — c'est ce qui rend la liste
    exhaustive plutôt qu'illustrative :

      - un AMORTISSEMENT : la brute compte le montant entier au mois où l'argent
        est sorti, l'attribuée seulement la part du mois. L'écart change de signe
        selon qu'on regarde le mois du paiement ou l'un des suivants ;
      - une DÉPENSE REMBOURSABLE : la brute compte tout, l'attribuée retranche ce
        qu'on nous rendra ;
      - un PRÊT REÇU : la brute compte l'argent arrivé, l'attribuée n'en garde
        que les intérêts, et du côté des sorties ;
      - un RÈGLEMENT : la brute le compte, l'attribuée l'écarte — la dette qu'il
        solde a déjà été comptée quand elle est née.

    LE PÉRIMÈTRE EST L'UNION DES DEUX, pas l'intersection : une opération amortie
    d'un mois antérieur n'apporte rien à la brute de ce mois-ci mais bien quelque
    chose à l'attribuée, et c'est justement une ligne d'écart. La chercher dans
    le seul périmètre de la brute l'aurait laissée invisible, et la somme des
    lignes n'aurait plus valu l'écart.

    RIEN N'EST ARRONDI, ET RIEN N'EST OMIS : on garde toute ligne dont l'écart
    n'est pas nul au centime. L'invariant — la somme des écarts vaut la
    différence des deux variations — est ce qui rend cette liste digne de
    confiance, et il est vérifié par un test.
    """
    prets_actifs = extensions.est_active(EXTENSION_PRETS)
    remboursable_actif = _remboursable_compte()

    operations = (
        db.query(models.Operation)
        .join(models.Compte, models.Operation.compte_id == models.Compte.id)
        .join(models.TypeCompte, models.Compte.type_id == models.TypeCompte.id)
        .filter(
            models.Operation.monnaie_id == monnaie_id,
            models.TypeCompte.nom.notin_(TYPES_COMPTE_HORS_COURANT),
            models.Operation.sens.in_([Sens.entree, Sens.depense]),
            or_(
                filtre_date_periode(annee, mois),
                _filtre_periode_amortie(annee, mois),
            ),
        )
        .all()
    )

    debut_periode = date_type(annee, 1 if mois is None else mois, 1)
    fin_periode = fin_de_periode(annee, mois)

    lignes = []
    for operation in operations:
        dans_periode_date = debut_periode <= operation.date <= fin_periode
        brute, attribuee = _contributions_operation(
            operation,
            annee,
            mois,
            dans_periode_date,
            prets_actifs,
            remboursable_actif,
        )
        ecart = brute - attribuee
        # Le centime est la plus petite unité que l'écran sait écrire : en
        # dessous, c'est un résidu de division (une part amortie sur 7 mois) et
        # non une opération à montrer.
        if abs(ecart) < 0.005:
            continue
        lignes.append(
            {
                "operation_id": operation.id,
                "date": operation.date,
                "nature": operation.nature,
                "compte_nom": operation.compte.nom if operation.compte else "",
                "categorie_nom": operation.categorie.nom if operation.categorie else None,
                "type_code": operation.type_operation.code,
                "montant": operation.montant,
                "sens": operation.sens,
                "contribution_brute": brute,
                "contribution_attribuee": attribuee,
                "ecart": ecart,
                "raison": _raison_ecart(operation),
            }
        )

    lignes = _sans_paires_qui_s_annulent(db, lignes)

    # DU PLUS GROS ÉCART AU PLUS PETIT, en valeur absolue : on vient voir ce qui
    # explique le chiffre, donc ce qui pèse le plus doit se lire en premier. Un
    # tri par date aurait mis en tête la ligne la plus ancienne, qui n'est
    # presque jamais celle qu'on cherche.
    lignes.sort(key=lambda ligne: abs(ligne["ecart"]), reverse=True)

    flux = get_flux_periode(db, annee, mois, monnaie_id)
    brute_totale = get_variation_brute(db, annee, mois, monnaie_id)
    return {
        "variation_brute": brute_totale,
        "variation_attribuee": flux["variation"],
        "ecart": brute_totale - flux["variation"],
        "lignes": lignes,
    }


def _sans_paires_qui_s_annulent(db: Session, lignes: list[dict]) -> list[dict]:
    """Retire les opérations LIÉES qui s'annulent sur la période : une dépense remboursable
    et le remboursement qui la solde, un prêt reçu et son remboursement — quand les deux
    tombent dans la période affichée.

    Prises séparément, chacune creuse un écart (l'avance de −50 €, le remboursement de
    +50 €) ; ensemble, elles ne pèsent rien dans la différence des deux variations. Les
    montrer faisait chercher une explication à un écart qui n'existe pas.

    LE GROUPE PART ENTIER, ET SEULEMENT S'IL S'ANNULE AU CENTIME : c'est ce qui garde
    l'invariant (la somme des lignes vaut l'écart). Un remboursement PARTIEL laisse un reste,
    qui explique bien quelque chose — le groupe reste alors affiché. Les liens sont ceux de
    `RemboursementLien`, qui portent les deux familles (règlement d'une dépense remboursable,
    remboursement d'un prêt)."""
    ids = {ligne["operation_id"] for ligne in lignes}
    if len(ids) < 2:
        return lignes
    parent = {identifiant: identifiant for identifiant in ids}

    def racine(identifiant):
        while parent[identifiant] != identifiant:
            parent[identifiant] = parent[parent[identifiant]]
            identifiant = parent[identifiant]
        return identifiant

    liens = db.query(
        models.RemboursementLien.operation_remboursement_id,
        models.RemboursementLien.operation_depense_id,
    ).filter(
        models.RemboursementLien.operation_remboursement_id.in_(ids),
        models.RemboursementLien.operation_depense_id.in_(ids),
    )
    for reglement_id, depense_id in liens:
        parent[racine(reglement_id)] = racine(depense_id)

    groupes: dict[int, list[dict]] = {}
    for ligne in lignes:
        groupes.setdefault(racine(ligne["operation_id"]), []).append(ligne)
    retirees = {
        id(ligne)
        for groupe in groupes.values()
        if len(groupe) > 1 and abs(sum(l["ecart"] for l in groupe)) < 0.005
        for ligne in groupe
    }
    return [ligne for ligne in lignes if id(ligne) not in retirees]


def get_variation_previsionnelle(
    db: Session, annee: int, mois: Optional[int], monnaie_id: int
) -> float:
    """Entrées moins sorties de la période : d'un coup d'œil, la période
    s'annonce-t-elle positive ou négative. Voir get_flux_periode, dont ce n'est
    qu'une des trois valeurs."""
    return get_flux_periode(db, annee, mois, monnaie_id)["variation"]


def _reste_du_par_monnaie(db: Session, code_type: str) -> dict:
    """Somme de `montant_a_rembourser` par monnaie, pour un type d'opération.

    `montant_a_rembourser` et non `montant_du` : c'est le RESTE, qui décroît au
    fil des règlements (cf. crud._recalculer_montant_a_rembourser). La question
    posée ici est « combien reste-t-il », pas « combien devait-on au départ » —
    l'inverse exact de ce que lisent les flux du mois.

    LE STATUT RÉEL SEULEMENT, des deux côtés. Une dépense remboursable encore
    prévisionnelle n'a rien avancé : personne ne me doit quoi que ce soit tant
    que l'argent n'est pas sorti. Un prêt prévisionnel, symétriquement, n'est pas
    encore reçu — je ne dois rien. Compter l'un sans l'autre donnerait un net qui
    mélange de l'argent constaté et de l'argent attendu."""
    lignes = (
        db.query(
            models.Operation.monnaie_id, func.sum(models.Operation.montant_a_rembourser)
        )
        .join(models.TypeOperationDB, models.Operation.type_id == models.TypeOperationDB.id)
        .filter(
            models.TypeOperationDB.code == code_type,
            models.Operation.statut == Statut.reel,
        )
        .group_by(models.Operation.monnaie_id)
        .all()
    )
    return {monnaie_id: (total or 0.0) for monnaie_id, total in lignes}


def get_reste_a_rembourser(db: Session) -> dict:
    """Ce qu'on me doit et ce que je dois, PAR MONNAIE :

        {monnaie_id: {"a_recevoir": …, "a_rendre": …, "net": …}}

    UN STOCK, ET NON UN FLUX — c'est ce qui le distingue de tout le reste de ce
    module, et ce que doit dire l'écran qui l'affiche. Les deux cartes voisines
    répondent à « qu'est-ce que ce mois coûte et rapporte » et se recalculent
    quand on change de période ; celle-ci répond à « où en sont mes créances et
    mes dettes », ce qui n'a pas de période : une dépense avancée en mars reste
    due en septembre tant qu'on ne m'a pas remboursé. Aucun paramètre d'année ni
    de mois, donc, et ce n'est pas un oubli.

    JAMAIS DE TOTAL ENTRE MONNAIES, comme partout : une dette en dollars ne
    compense pas une créance en euros. Le net est calculé DANS chaque monnaie.

    LES DEUX CÔTÉS NE COMPTENT QUE SI L'EXTENSION QUI LES EXPLIQUE TOURNE. Même
    procédé que les intérêts de prêt dans les flux du mois (cf.
    `_barre_interets_prets`) : sans son écran, une dette ou une créance
    apparaîtrait dans le chiffre sans qu'aucune page ne dise d'où elle vient ou
    à qui elle est due. `a_recevoir` dépend de « Suivi des remboursements »
    (cf. _remboursable_compte), `a_rendre` de « Prêts » — chacun vaut alors
    zéro, et le net se réduit à l'autre côté.
    """
    a_recevoir = (
        _reste_du_par_monnaie(db, TypeOperation.remboursable.value)
        if _remboursable_compte()
        else {}
    )
    a_rendre = (
        _reste_du_par_monnaie(db, TypeOperation.pret.value)
        if extensions.est_active(EXTENSION_PRETS)
        else {}
    )

    return {
        monnaie_id: {
            "a_recevoir": a_recevoir.get(monnaie_id, 0.0),
            "a_rendre": a_rendre.get(monnaie_id, 0.0),
            "net": a_recevoir.get(monnaie_id, 0.0) - a_rendre.get(monnaie_id, 0.0),
        }
        for monnaie_id in set(a_recevoir) | set(a_rendre)
    }


# ---------- Le solde des comptes courants, jour après jour ----------
#
# LES BRIQUES DE TOUTE TRAJECTOIRE DU SOLDE. Nées dans l'extension « Budget » pour
# la courbe du solde prévisionnel (cf. extensions/analyse-budget/
# service_solde_previsionnel.py), remontées ICI quand le dashboard a eu besoin du
# même calcul pour son « reste » : le dashboard est au noyau et ne peut pas
# dépendre d'une extension. L'extension les réutilise telles quelles — une seule
# définition de « ce qui bouge le solde, et quel jour », donc une courbe et un
# « reste » qui ne peuvent pas diverger.
#
# MÊME PÉRIMÈTRE ET MÊMES RÈGLES QUE LE « SOLDE TOTAL » ET SON PROJETÉ :
#   - les comptes COURANTS seulement (`TYPES_COMPTE_HORS_COURANT` exclus) ;
#   - le solde initial et les intérêts perçus, sans date ;
#   - TOUS les mouvements, virements compris : un virement vers l'épargne fait
#     baisser le solde courant, deux jambes entre comptes courants s'annulent ;
#   - le reste dû des prêts reçus retranché à la date du prêt, comme dans le
#     projeté (cf. _reste_du_prets_par_compte_monnaie) ;
#   - une prévisionnelle ÉCHUE et non rapprochée se pose DEMAIN : elle compte
#     dans le projeté, mais elle ne peut pas s'être produite un jour déjà vécu.

_SENS_ENTRANTS = (Sens.entree, Sens.transfert_entrant)
_SENS_TRANSFERTS = (Sens.transfert_entrant, Sens.transfert_sortant)


def signe_du_sens(sens) -> float:
    """+1 pour ce qui entre sur le compte, −1 pour ce qui en sort."""
    return 1.0 if sens in _SENS_ENTRANTS else -1.0


def comptes_courants(db: Session, monnaie_id: int) -> dict[int, str]:
    """`{compte_id: nom}` des comptes COURANTS qui portent cette monnaie.

    Par `get_soldes_comptes`, donc avec ses règles : un compte éteint et soldé,
    ou une monnaie éteinte et soldée, n'y figure pas — comme dans la carte
    « Solde total »."""
    courants: dict[int, str] = {}
    for item in get_soldes_comptes(db):
        compte = item["compte"]
        if compte.type_nom in TYPES_COMPTE_HORS_COURANT:
            continue
        if monnaie_id in item["soldes"]:
            courants[compte.id] = compte.nom
    return courants


def solde_de_depart_courant(db: Session, monnaie_id: int, comptes: dict[int, str]) -> float:
    """Solde initial + intérêts perçus des comptes courants : ce que la
    trajectoire porte AVANT le premier mouvement. Sans date, comme partout."""
    interets = _interets_percus_par_compte_monnaie(db)
    total = 0.0
    for item in soldes_de_tous_les_liens(db):
        compte = item["compte"]
        if compte.id not in comptes:
            continue
        lien = item["soldes"].get(monnaie_id)
        if lien is None:
            continue
        total += lien["solde_initial"] + interets.get((compte.id, monnaie_id), 0.0)
    return total


def jour_pose(operation, aujourdhui: date_type) -> date_type:
    """Le jour où la trajectoire compte l'opération. Une réelle : sa date. Une
    prévisionnelle : sa date, mais jamais avant demain."""
    if operation.statut == Statut.previsionnel:
        return max(operation.date, aujourdhui + timedelta(days=1))
    return operation.date


def operations_a_poser(
    db: Session,
    monnaie_id: int,
    comptes: dict[int, str],
    debut: date_type,
    fin: date_type,
) -> list:
    """Les opérations qui bougent le solde entre `debut` et `fin`.

    Les réelles DATÉES dans la fenêtre, et toutes les prévisionnelles datées
    jusqu'à `fin` — y compris les échues, qui se posent demain. Ce qui est réel
    et antérieur à `debut` est déjà dans le solde d'ouverture."""
    if not comptes:
        return []
    return (
        db.query(models.Operation)
        .filter(
            models.Operation.monnaie_id == monnaie_id,
            models.Operation.compte_id.in_(list(comptes)),
            or_(
                and_(
                    models.Operation.statut == Statut.reel,
                    models.Operation.date >= debut,
                    models.Operation.date <= fin,
                ),
                and_(
                    models.Operation.statut == Statut.previsionnel,
                    models.Operation.date <= fin,
                ),
            ),
        )
        .order_by(models.Operation.date, models.Operation.id)
        .all()
    )


def solde_ouverture_courant(
    db: Session, monnaie_id: int, comptes: dict[int, str], avant: date_type
) -> float:
    """Le solde la veille de `avant` : départ + tout le réel antérieur."""
    if not comptes:
        return 0.0
    sums = (
        db.query(models.Operation.sens, func.sum(models.Operation.montant))
        .filter(
            models.Operation.monnaie_id == monnaie_id,
            models.Operation.compte_id.in_(list(comptes)),
            models.Operation.statut == Statut.reel,
            models.Operation.date < avant,
        )
        .group_by(models.Operation.sens)
        .all()
    )
    return solde_de_depart_courant(db, monnaie_id, comptes) + sum(
        signe_du_sens(sens) * (total or 0.0) for sens, total in sums
    )


def restes_dus_prets_par_date(
    db: Session, monnaie_id: int, comptes: dict[int, str], fin: date_type
) -> dict[date_type, float]:
    """Le reste dû des prêts reçus, par date du prêt, retranché comme dans le
    solde projeté (`_reste_du_prets_par_compte_monnaie`)."""
    if not comptes:
        return {}
    lignes = (
        db.query(models.Operation.date, func.sum(models.Operation.montant_a_rembourser))
        .join(models.TypeOperationDB, models.Operation.type_id == models.TypeOperationDB.id)
        .filter(
            models.TypeOperationDB.code == TypeOperation.pret.value,
            models.Operation.monnaie_id == monnaie_id,
            models.Operation.compte_id.in_(list(comptes)),
            models.Operation.date <= fin,
        )
        .group_by(models.Operation.date)
        .all()
    )
    return {jour: (total or 0.0) for jour, total in lignes}


# ---------- Le « reste » pour finir la période (dashboard) ----------
#
# CE QUE LE BLOC DU DASHBOARD RÉPOND : « combien me restera-t-il, et par où
# vais-je passer d'ici là ? ». EN CASH — ce qui sera sur les comptes courants,
# pas ce que la période « coûte » : une dépense étalée compte donc ENTIÈRE à sa
# date de paiement (c'est ce jour-là que l'argent sort), et le budget n'entre
# nulle part. C'est le solde projeté, déplié jour par jour entre aujourd'hui et
# l'horizon.
#
# L'INVARIANT, verrouillé par un test : `reste_libre` EST le solde projeté
# courant du dashboard borné à la même date. Un « reste » qui finirait ailleurs
# que le « Projeté » posé dans la carte juste au-dessus ne serait plus cru.
#
# `coefficients` : `{monnaie_id: coefficient}`. Une seule monnaie à 1.0 dans le
# cas ordinaire. L'extension « Monnaies » y passe sa table de conversion pour la
# case « Tout convertir » : la trajectoire est alors celle de TOUTES les
# monnaies ramenées à une seule — son minimum n'est pas la somme des minimums de
# chacune, il fallait donc refaire le calcul et non additionner des résultats.

# Jusqu'où l'on cherche la prochaine entrée quand l'horizon est plus proche
# qu'elle (un salaire du 1er, vu depuis le 28 en vue « Mois »).
_JOURS_RECHERCHE_ENTREE = 366


# LE SALAIRE DE FIN DE MOIS VIT LE MOIS SUIVANT. Une entrée prévue tard dans le mois (le salaire du 28)
# ne sert pas à finir CE mois : elle paie le suivant. Avec ce réglage (Paramètres généraux), le
# « reste pour finir la période » ne la compte pas — ni dans l'entrée prévue, ni dans le point bas, ni
# dans la courbe. PAR DÉFAUT RIEN NE CHANGE : le réglage est éteint, le calendrier fait foi.
# Rangé en base (`preference_interface`) plutôt que dans le navigateur : le serveur calcule le reste, et
# toutes les routes qui le calculent (dashboard, « Tout convertir ») doivent lire le même réglage.
CLE_DECOUPAGE_SALAIRE = "dashboard.decoupage-salaire"
# PAR DÉFAUT, LE DERNIER JOUR DU MOIS : 31 vaut « le dernier jour » quel que soit le mois (cf. _est_salaire_reporte,
# qui ramène la coupure à la longueur du mois — le 30 en novembre, le 28 en février).
JOUR_SALAIRE_DEFAUT = 31


def lire_decoupage_salaire(db: Session) -> Optional[int]:
    """Le jour du mois à partir duquel une entrée prévue compte pour le mois suivant, ou None
    quand le réglage est éteint (le cas par défaut)."""
    valeur = crud.get_preference_interface(db, CLE_DECOUPAGE_SALAIRE)
    if not isinstance(valeur, dict) or not valeur.get("actif"):
        return None
    try:
        jour = int(valeur.get("jour", JOUR_SALAIRE_DEFAUT))
    except (TypeError, ValueError):
        jour = JOUR_SALAIRE_DEFAUT
    return min(max(jour, 1), 31)


# Le SEUIL DE SÉCURITÉ (réglage de Paramètres généraux, un nombre ≥ 0) : le niveau sous lequel on ne veut pas
# descendre. Le rythme sûr se calcule dessus (cf. `reste_periode`) ; la courbe du dashboard le trace en pointillés
# jaunes. 0 par défaut : le rythme sûr frôle alors zéro, comme avant.
CLE_SEUIL_SECURITE = "dashboard.seuil-securite"

# « Le projeté du dashboard tient-il compte de la dépense moyenne par jour ? » (booléen, NON par défaut).
CLE_PROJETE_DEPENSE_MOYENNE = "dashboard.projete-depense-moyenne"


def lire_seuil_securite(db: Session) -> float:
    """Le seuil de sécurité, jamais négatif : une valeur absente, illisible ou négative vaut 0."""
    valeur = crud.get_preference_interface(db, CLE_SEUIL_SECURITE)
    try:
        seuil = float(valeur)
    except (TypeError, ValueError):
        return 0.0
    return seuil if seuil > 0 else 0.0


def lire_projete_avec_depense_moyenne(db: Session) -> bool:
    return crud.get_preference_interface(db, CLE_PROJETE_DEPENSE_MOYENNE) is True


def _est_salaire_reporte(
    mouvement: dict, horizon: date_type, jour_salaire: Optional[int]
) -> bool:
    """Une entrée PRÉVUE (ni virement ni prêt) tombée à partir du jour de coupure dans le dernier
    mois de la période : elle finance la période d'après, pas celle-ci. Le jour de coupure est ramené à la
    longueur du mois : 31 veut dire « le dernier jour du mois », tous mois confondus."""
    operation = mouvement["operation"]
    if jour_salaire is None or operation is None:
        return False
    jour = mouvement["jour"]
    return (
        operation.statut == Statut.previsionnel
        and operation.sens == Sens.entree
        and operation.type_code != TypeOperation.pret.value
        and jour <= horizon
        and (jour.year, jour.month) == (horizon.year, horizon.month)
        and jour.day >= min(jour_salaire, calendar.monthrange(jour.year, jour.month)[1])
    )


def _coupure_salaire(annee: int, mois: int, jour_salaire: int) -> date_type:
    """Le jour de coupure d'un mois, ramené à sa longueur (31 = le dernier jour : le 30 en novembre)."""
    return date_type(annee, mois, min(jour_salaire, calendar.monthrange(annee, mois)[1]))


def periode_salariale(aujourdhui: date_type, jour_salaire: int) -> tuple[date_type, date_type]:
    """Le MOIS SALARIAL qui contient `aujourdhui` : du jour de coupure à la veille du suivant. Avec
    une coupure le 25, aujourd'hui le 14 novembre : du 25 octobre au 24 novembre."""
    ce_mois = _coupure_salaire(aujourdhui.year, aujourdhui.month, jour_salaire)
    if aujourdhui >= ce_mois:
        annee, mois = (aujourdhui.year + 1, 1) if aujourdhui.month == 12 else (aujourdhui.year, aujourdhui.month + 1)
        return ce_mois, _coupure_salaire(annee, mois, jour_salaire) - timedelta(days=1)
    annee, mois = (aujourdhui.year - 1, 12) if aujourdhui.month == 1 else (aujourdhui.year, aujourdhui.month - 1)
    return _coupure_salaire(annee, mois, jour_salaire), ce_mois - timedelta(days=1)


def horizon_reste(vue: str, aujourdhui: date_type, jour_salaire: Optional[int] = None) -> date_type:
    """Jusqu'où le « reste » projette : la fin du mois en cours (vue « mois »), le
    31 décembre sinon. « Tout » vaut « année » — seule la courbe y remonte plus
    loin dans le passé.

    EN MOIS SALARIAL (`jour_salaire` : le réglage « le salaire de fin de mois vit le mois suivant »), la
    période du mois se termine la VEILLE de la coupure, et non au dernier jour du calendrier."""
    if vue == "mois":
        if jour_salaire is not None:
            return periode_salariale(aujourdhui, jour_salaire)[1]
        return fin_de_periode(aujourdhui.year, aujourdhui.month)
    return date_type(aujourdhui.year, 12, 31)


def _trajectoire_courante(
    db: Session, coefficients: dict[int, float], aujourdhui: date_type, fin: date_type
) -> tuple[float, list[dict]]:
    """Le solde des comptes courants ce soir, et tout ce qui le fera bouger de
    demain à `fin` — converti par `coefficients`.

    Chaque mouvement : `{"jour", "montant" (signé), "operation" (ou None pour le
    reste dû d'un prêt), "monnaie_id"}`, triés par jour puis par opération."""
    demain = aujourdhui + timedelta(days=1)
    solde = 0.0
    mouvements: list[dict] = []
    for monnaie_id, coefficient in coefficients.items():
        comptes = comptes_courants(db, monnaie_id)
        if not comptes:
            continue
        restes = restes_dus_prets_par_date(db, monnaie_id, comptes, fin)
        solde += coefficient * (
            solde_ouverture_courant(db, monnaie_id, comptes, demain)
            - sum(total for jour, total in restes.items() if jour <= aujourdhui)
        )
        for operation in operations_a_poser(db, monnaie_id, comptes, demain, fin):
            mouvements.append(
                {
                    "jour": jour_pose(operation, aujourdhui),
                    "montant": coefficient * signe_du_sens(operation.sens) * operation.montant,
                    "operation": operation,
                    "monnaie_id": monnaie_id,
                }
            )
        for jour, total in restes.items():
            if jour > aujourdhui and total:
                mouvements.append(
                    {
                        "jour": jour,
                        "montant": -coefficient * total,
                        "operation": None,
                        "monnaie_id": monnaie_id,
                    }
                )
    mouvements.sort(key=lambda m: (m["jour"], m["operation"].id if m["operation"] else 0))
    return solde, mouvements


def _variations_par_jour(mouvements: list[dict]) -> list[tuple[date_type, float]]:
    """La variation nette de chaque jour qui bouge, dans l'ordre."""
    par_jour: dict[date_type, float] = {}
    for mouvement in mouvements:
        par_jour[mouvement["jour"]] = par_jour.get(mouvement["jour"], 0.0) + mouvement["montant"]
    return sorted(par_jour.items())


def _minimum_jusqu_a(
    solde: float,
    variations: list[tuple[date_type, float]],
    aujourdhui: date_type,
    fin: date_type,
) -> tuple[float, date_type, date_type]:
    """Le plus bas du solde sur [aujourd'hui, `fin`], et le palier où il y reste :
    du jour où il l'atteint à la veille du mouvement suivant (ou à `fin`)."""
    minimum, debut, palier_fin = solde, aujourdhui, fin
    courant = solde
    ouvert = True  # le palier du minimum court encore
    for jour, variation in variations:
        if jour > fin:
            break
        if ouvert:
            palier_fin = jour - timedelta(days=1)
            ouvert = False
        courant += variation
        if courant < minimum - 1e-9:
            minimum, debut, palier_fin = courant, jour, fin
            ouvert = True
    return minimum, debut, palier_fin


def _minimum_prevision(
    solde: float,
    variations: list[tuple[date_type, float]],
    depense_cumulee: dict,
    aujourdhui: date_type,
    fin: date_type,
) -> tuple[float, date_type, date_type]:
    """Le plus bas de la PRÉVISION sur [aujourd'hui, `fin`] : le solde projeté auquel on retranche, chaque
    jour, ce qu'on aura dépensé en moyenne depuis ce soir (`depense_cumulee`, cf.
    moyenne_depenses.estimation_depenses) — la courbe « prévision » du dashboard. Rend le minimum et son
    palier (les jours consécutifs où la prévision y reste).

    POURQUOI PAS LE PROJETÉ SEUL : sans prévisionnelle à venir, il reste égal au solde d'aujourd'hui, et le
    « point bas » ne dirait jamais rien d'autre que le solde actuel."""
    par_jour: dict[date_type, float] = {}
    for jour, variation in variations:
        par_jour[jour] = par_jour.get(jour, 0.0) + variation
    courant = solde
    minimum, debut, palier_fin = solde, aujourdhui, aujourdhui
    jour = aujourdhui
    while jour <= fin:
        courant += par_jour.get(jour, 0.0)
        valeur = courant - depense_cumulee.get(jour, 0.0)
        if valeur < minimum - 1e-9:
            minimum, debut, palier_fin = valeur, jour, jour
        elif abs(valeur - minimum) <= 1e-9 and palier_fin == jour - timedelta(days=1):
            palier_fin = jour  # le palier se prolonge
        jour += timedelta(days=1)
    return minimum, debut, palier_fin


def debut_reste(vue: str, aujourdhui: date_type, jour_salaire: Optional[int] = None) -> date_type:
    """Le début de la période du « reste » : le 1er du mois (vue « mois »), le 1er janvier sinon — ou, en
    mois salarial, le jour de coupure qui ouvre la période (cf. `periode_salariale`)."""
    if vue == "mois":
        if jour_salaire is not None:
            return periode_salariale(aujourdhui, jour_salaire)[0]
        return date_type(aujourdhui.year, aujourdhui.month, 1)
    return date_type(aujourdhui.year, 1, 1)


def _entrees_et_sorties(mouvements: list[dict], limite: date_type) -> tuple[float, float]:
    """Ce qui entre et ce qui sort des comptes courants dans ces mouvements, jusqu'à `limite`.

    LES VIREMENTS Y SONT, AU NET DU JOUR : deux jambes entre comptes courants s'annulent, un virement
    vers l'épargne est une sortie."""
    entrees = sorties = 0.0
    transferts: dict[tuple, float] = {}
    for mouvement in mouvements:
        if mouvement["jour"] > limite:
            continue
        operation = mouvement["operation"]
        if operation is not None and operation.sens in _SENS_TRANSFERTS:
            cle = (mouvement["jour"], mouvement["monnaie_id"])
            transferts[cle] = transferts.get(cle, 0.0) + mouvement["montant"]
        elif mouvement["montant"] >= 0:
            entrees += mouvement["montant"]
        else:
            sorties -= mouvement["montant"]
    for net in transferts.values():
        if net >= 0:
            entrees += net
        else:
            sorties -= net
    return entrees, sorties


def _mouvements_reels(
    db: Session, coefficients: dict[int, float], debut: date_type, fin: date_type
) -> list[dict]:
    """Les mouvements RÉELS des comptes courants entre `debut` et `fin`, convertis par `coefficients`
    (même forme que ceux de `_trajectoire_courante`)."""
    mouvements: list[dict] = []
    for monnaie_id, coefficient in coefficients.items():
        comptes = comptes_courants(db, monnaie_id)
        if not comptes:
            continue
        for operation in operations_a_poser(db, monnaie_id, comptes, debut, fin):
            if operation.statut != Statut.reel or operation.date > fin:
                continue
            mouvements.append(
                {
                    "jour": operation.date,
                    "montant": coefficient * signe_du_sens(operation.sens) * operation.montant,
                    "operation": operation,
                    "monnaie_id": monnaie_id,
                }
            )
    return mouvements


def reste_periode(
    db: Session,
    coefficients: dict[int, float],
    horizon: date_type,
    aujourdhui: Optional[date_type] = None,
    jour_salaire=_PAR_REGLAGE,
    debut: Optional[date_type] = None,
    seuil=_PAR_REGLAGE,
) -> dict:
    """Les chiffres du bloc « Reste pour finir le mois », pour une monnaie — ou
    pour plusieurs ramenées à une seule (cf. `coefficients`, en tête de section).

      - `solde_actuel` : le solde des comptes courants ce soir. C'est le point
        de la trajectoire à aujourd'hui : reste dû des prêts retranché, comme
        dans le projeté — il peut donc différer du « Solde total » réel quand un
        prêt reçu est en cours ;
      - `entrees_prevues`, `sorties_prevues` : ce qui bougera ce solde d'ici
        l'horizon. LES VIREMENTS Y SONT, AU NET DU JOUR : deux jambes entre
        comptes courants s'annulent, un virement vers l'épargne est une sortie
        (l'argent quitte bien les comptes courants). Le reste dû d'un prêt à
        venir est une sortie ;
      - `reste_libre` = solde_actuel + entrees_prevues − sorties_prevues, soit
        le solde projeté à l'horizon ;
      - `point_bas` : le minimum de la PRÉVISION (le projeté moins la dépense moyenne cumulée, cf.
        `_minimum_prevision`) sur [aujourd'hui, horizon], avec le palier où elle y reste ;
      - `prochaine_entree` : la première prévisionnelle d'ENTRÉE à venir (ni
        virement, ni prêt), cherchée au-delà de l'horizon s'il le faut ;
      - `rythme_sur` : ce qu'on peut dépenser par jour sans passer sous le SEUIL DE SÉCURITÉ
        (`seuil`, 0 par défaut : sous zéro) avant elle — le minimum de la trajectoire jusqu'à sa
        veille, moins le seuil, divisé par le nombre de jours qui en séparent. Sans entrée prévue,
        jusqu'à l'horizon. Une marge ≤ 0 donne 0 et lève `alerte` ;
      - `sorties_reelles` : tout ce qui est DÉJÀ sorti des comptes courants depuis `debut` (le début
        de la période ; à défaut le 1er du mois de l'horizon) jusqu'à ce soir, virements vers
        l'épargne compris, au net du jour. TOUTES LES DÉPENSES de la période y sont, que le mois
        suive le calendrier ou le salaire : le réglage ne touche qu'aux ENTRÉES reportées. Avec
        `sorties_prevues`, c'est la part « utilisée » de la barre de reste à vivre ;
      - `entrees_reportees` : ce que le réglage « le salaire de fin de mois vit le mois
        suivant » a écarté du reste (0 par défaut, réglage éteint). Le rythme sûr, lui, se
        calcule sur TOUTE la trajectoire : jusqu'au salaire, on vit sur ce qu'on a.
    """
    aujourdhui = aujourdhui or date_type.today()
    horizon = max(horizon, aujourdhui)
    if jour_salaire is _PAR_REGLAGE:
        jour_salaire = lire_decoupage_salaire(db)
    if seuil is _PAR_REGLAGE:
        seuil = lire_seuil_securite(db)
    limite = max(horizon, aujourdhui + timedelta(days=_JOURS_RECHERCHE_ENTREE))
    solde, mouvements = _trajectoire_courante(db, coefficients, aujourdhui, limite)
    reportes = [m for m in mouvements if _est_salaire_reporte(m, horizon, jour_salaire)]
    ids_reportes = {id(m) for m in reportes}
    retenus = [m for m in mouvements if id(m) not in ids_reportes]

    # ---- Ce qui est prévu d'ici l'horizon, et ce qui est déjà sorti depuis le début de la période ----
    entrees, sorties = _entrees_et_sorties(retenus, horizon)
    debut = debut or bornes_periode(*mois_de(horizon))[0]
    _, sorties_reelles = _entrees_et_sorties(
        _mouvements_reels(db, coefficients, debut, aujourdhui), aujourdhui
    )

    variations = _variations_par_jour(mouvements)
    # LE POINT BAS SE CALCULE SUR LA PRÉVISION (le projeté moins la dépense moyenne), pas sur le projeté seul :
    # sans prévisionnelle à venir, celui-ci resterait identique au solde actuel.
    from . import moyenne_depenses  # tardif : ce module-là lit celui-ci

    depense = moyenne_depenses.estimation_depenses(db, coefficients, aujourdhui, horizon)["cumul"]
    minimum, bas_debut, bas_fin = _minimum_prevision(
        solde, _variations_par_jour(retenus), depense, aujourdhui, horizon
    )

    # ---- La prochaine entrée, et le rythme tenable jusqu'à elle ----
    prochaine = next(
        (
            m
            for m in mouvements
            if m["operation"] is not None
            and m["operation"].statut == Statut.previsionnel
            and m["operation"].sens == Sens.entree
            and m["operation"].type_code != TypeOperation.pret.value
        ),
        None,
    )
    if prochaine is not None:
        echeance = prochaine["jour"]
        fin_rythme = echeance - timedelta(days=1)
    else:
        echeance = fin_rythme = horizon
    minimum_rythme, _, _ = _minimum_jusqu_a(solde, variations, aujourdhui, fin_rythme)
    jours = max((echeance - aujourdhui).days, 1)
    # LE RYTHME SE CALCULE SUR LA MARGE AU-DESSUS DU SEUIL : ce qu'on peut dépenser sans passer dessous.
    marge = minimum_rythme - seuil
    alerte = marge < EPSILON_SOLDE_NUL
    rythme = 0.0 if alerte else marge / jours

    return {
        "aujourdhui": aujourdhui,
        "horizon": horizon,
        "solde_actuel": solde,
        "entrees_prevues": entrees,
        "entrees_reportees": sum(m["montant"] for m in reportes),
        "sorties_prevues": sorties,
        "sorties_reelles": sorties_reelles,
        "reste_libre": solde + entrees - sorties,
        "point_bas": {"montant": minimum, "date_debut": bas_debut, "date_fin": bas_fin},
        "prochaine_entree": (
            {
                "date": prochaine["jour"],
                "montant": prochaine["montant"],
                "libelle": prochaine["operation"].nature,
            }
            if prochaine is not None
            else None
        ),
        "rythme_sur": rythme,
        "rythme_jours": jours,
        "alerte": alerte,
    }


def _premier_jour_reel(db: Session, coefficients: dict[int, float]) -> Optional[date_type]:
    """La date de la plus ancienne opération réelle des comptes courants."""
    premier = None
    for monnaie_id in coefficients:
        comptes = comptes_courants(db, monnaie_id)
        if not comptes:
            continue
        jour = (
            db.query(func.min(models.Operation.date))
            .filter(
                models.Operation.monnaie_id == monnaie_id,
                models.Operation.compte_id.in_(list(comptes)),
                models.Operation.statut == Statut.reel,
            )
            .scalar()
        )
        if jour is not None and (premier is None or jour < premier):
            premier = jour
    return premier


def courbe_reste(
    db: Session,
    coefficients: dict[int, float],
    vue: str,
    aujourdhui: Optional[date_type] = None,
    jour_salaire=_PAR_REGLAGE,
) -> dict:
    """La courbe du bloc « Reste » : le solde RÉEL jusqu'à aujourd'hui, puis le
    PROJETÉ en escalier jusqu'à l'horizon, puis DEUX ESTIMATIONS tracées à côté :

      - `prevision` : le projeté auquel on retranche ce qu'on dépense en moyenne par jour,
        d'après les dépenses passées — l'outil de la « prévision avancée » de la page
        Budget (services/moyenne_depenses, mêmes réglages : fenêtre, cadence, exclusions).
        Chaque point porte `ecart`, la demi-largeur de la PLAGE (± un écart-type) ; `estimation`
        donne la moyenne et l'écart-type qui l'ont produite ;
      - `rythme` : le projeté auquel on retranche, chaque jour, le RYTHME SÛR (arrondi à
        l'entier inférieur), jusqu'à la veille de la prochaine entrée : il y descend vers
        zéro sans le franchir.

    LE PASSÉ COMMENCE au 1er du mois (vue « mois »), au 1er janvier (« année »),
    à la première opération (« tout ») — et ne compte que le réel. UN POINT PAR
    JOUR QUI BOUGE, pas un par jour du calendrier : entre deux mouvements le
    solde est plat, et « tout » porterait sinon des milliers de points pour dire
    la même chose.

    LE FUTUR : une marche par jour d'échéance (réel postdaté, prévisionnelle —
    échue posée demain —, reste dû d'un prêt), avec le libellé de ce qui tombe.
    Le dernier point est donc le solde projeté à l'horizon : le `reste_libre`."""
    aujourdhui = aujourdhui or date_type.today()
    if jour_salaire is _PAR_REGLAGE:
        jour_salaire = lire_decoupage_salaire(db)
    horizon = horizon_reste(vue, aujourdhui, jour_salaire)
    if vue == "mois":
        debut = debut_reste(vue, aujourdhui, jour_salaire)
    elif vue == "annee":
        debut = date_type(aujourdhui.year, 1, 1)
    else:
        debut = _premier_jour_reel(db, coefficients) or aujourdhui
    debut = min(debut, aujourdhui)

    # ---- Le passé : le solde d'ouverture, puis chaque jour réel qui bouge ----
    ouverture = 0.0
    passe: dict[date_type, float] = {}
    for monnaie_id, coefficient in coefficients.items():
        comptes = comptes_courants(db, monnaie_id)
        if not comptes:
            continue
        restes = restes_dus_prets_par_date(db, monnaie_id, comptes, aujourdhui)
        ouverture += coefficient * (
            solde_ouverture_courant(db, monnaie_id, comptes, debut)
            - sum(total for jour, total in restes.items() if jour < debut)
        )
        for operation in operations_a_poser(db, monnaie_id, comptes, debut, aujourdhui):
            if operation.statut != Statut.reel:
                continue
            passe[operation.date] = passe.get(operation.date, 0.0) + (
                coefficient * signe_du_sens(operation.sens) * operation.montant
            )
        for jour, total in restes.items():
            if jour >= debut:
                passe[jour] = passe.get(jour, 0.0) - coefficient * total

    reels = []
    solde = ouverture
    if debut not in passe:
        reels.append({"date": debut, "solde": solde})
    for jour in sorted(passe):
        solde += passe[jour]
        reels.append({"date": jour, "solde": solde})
    if reels[-1]["date"] != aujourdhui:
        reels.append({"date": aujourdhui, "solde": solde})

    # ---- Le futur : une marche par jour d'échéance ----
    solde_actuel, mouvements_tous = _trajectoire_courante(db, coefficients, aujourdhui, horizon)
    mouvements = [m for m in mouvements_tous if not _est_salaire_reporte(m, horizon, jour_salaire)]
    par_jour: dict[date_type, dict] = {}
    for mouvement in mouvements:
        marche = par_jour.setdefault(mouvement["jour"], {"montant": 0.0, "libelles": []})
        marche["montant"] += mouvement["montant"]
        operation = mouvement["operation"]
        if operation is not None and operation.nature and operation.nature not in marche["libelles"]:
            marche["libelles"].append(operation.nature)
    projetes = []
    solde = solde_actuel
    for jour in sorted(par_jour):
        marche = par_jour[jour]
        solde += marche["montant"]
        libelles = marche["libelles"]
        projetes.append(
            {
                "date": jour,
                "solde": solde,
                "montant": marche["montant"],
                "libelle": ", ".join(libelles[:3]) + ("…" if len(libelles) > 3 else ""),
            }
        )

    # ---- Les deux estimations : à la prévision, et au rythme sûr ----
    from . import moyenne_depenses  # tardif : ce module-là lit celui-ci

    def escalier(marches):
        """Le solde projeté à la fin de chaque jour, d'aujourd'hui à l'horizon."""
        variations = dict(_variations_par_jour(marches))
        solde_jour, jour = solde_actuel, aujourdhui
        while jour <= horizon:
            solde_jour += variations.get(jour, 0.0)
            yield jour, solde_jour
            jour += timedelta(days=1)

    estimation = moyenne_depenses.estimation_depenses(db, coefficients, aujourdhui, horizon)
    depense = estimation["cumul"]
    # `ecart` : la demi-largeur de la plage autour de la prévision, ± σ·√k (cf. estimation_depenses).
    prevision = [
        {
            "date": jour,
            "solde": solde_jour - depense.get(jour, 0.0),
            "ecart": estimation["ecart"].get(jour, 0.0),
        }
        for jour, solde_jour in escalier(mouvements)
    ]

    reste = reste_periode(db, coefficients, horizon, aujourdhui, jour_salaire)
    rythme_jour = float(math.floor(reste["rythme_sur"] + 1e-9))
    prochaine = reste["prochaine_entree"]
    dernier_jour = (
        prochaine["date"] - timedelta(days=1)
        if prochaine is not None and prochaine["date"] <= horizon
        else horizon
    )
    rythme = []
    if rythme_jour > 0:
        rythme = [
            {"date": jour, "solde": solde_jour - rythme_jour * (jour - aujourdhui).days}
            for jour, solde_jour in escalier(mouvements_tous)
            if jour <= dernier_jour
        ]

    return {
        "aujourdhui": aujourdhui,
        "horizon": horizon,
        "reels": reels,
        "projetes": projetes,
        "prevision": prevision,
        "rythme": rythme,
        "estimation": {
            key: estimation[key]
            for key in (
                "cadence",
                "moyenne_jour",
                "moyenne_semaine",
                "ecart_type_jour",
                "ecart_type_semaine",
                "jours",
            )
        },
    }
