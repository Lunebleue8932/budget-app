"""Ce qu'un projet a coûté.

UNE SOMME AFFICHÉE, JAMAIS UNE DONNÉE. Rien de ce qui se calcule ici n'entre
dans un solde, un budget ou un KPI du dashboard : c'est ce qui permet à une même
opération d'appartenir à trois projets sans être comptée trois fois nulle part.
Un projet est une VUE sur des opérations qui existent sans lui.

PAR MONNAIE, ET JAMAIS AUTREMENT, comme partout ailleurs dans l'application :
l'app ne stocke aucun taux de change, additionner des euros et des dollars
n'aurait aucun sens (cf. services/soldes.py). Un voyage payé moitié en euros,
moitié en francs suisses a donc deux lignes de totaux, pas un total faux.

LE SENS DÉCIDE, PAS LE TYPE, et exactement comme dans le calcul des soldes
(`soldes._solde_delta`) : une sortie est une sortie, qu'elle soit une dépense
ordinaire ou un virement vers un autre compte. C'est la seule convention qui
rende le total d'un projet lisible comme « ce que ce projet a fait bouger ». Un
virement interne dont les DEUX écritures sont versées dans le projet s'y annule
donc de lui-même, ce qui est bien ce qu'il vaut : l'argent n'a pas quitté le
patrimoine.
"""
from datetime import date as date_type

from sqlalchemy.orm import object_session

from app import models
from app.constants import Sens, TypeOperation
from app.services import cascade as service_cascade
from app.services.soldes import NB_TOP_DEPENSES

# Les deux sens qui font sortir de l'argent, et les deux qui en font entrer.
# Repris de services/soldes._solde_delta : un projet doit compter comme le reste
# de l'application, ou son total ne voudra rien dire à côté d'un solde.
SENS_SORTANTS = {Sens.depense, Sens.transfert_sortant}
SENS_ENTRANTS = {Sens.entree, Sens.transfert_entrant}


def totaux_par_monnaie(sous_filtre) -> list[dict]:
    """[{monnaie_id, monnaie_nom, monnaie_symbole, depenses, entrees, solde}]

    CE QUE LE PROJET A COÛTÉ (ou rapporté) : les ENTRÉES moins les DÉPENSES, lues dans la
    cascade du projet (cf. services/cascade.py) — chaque catégorie AU NET, plus les frais de
    virements internes, qui sont une dépense bien réelle. LES MOUVEMENTS VERS OU DEPUIS
    L'ÉPARGNE ET LES CONVERSIONS ENTRE MONNAIES N'Y COMPTENT PAS : l'argent a changé de place,
    il n'a pas été dépensé. Les compter faisait d'un voyage financé par un retrait du livret
    un projet « à l'équilibre ». La cascade, juste dessous, les montre toujours.

    `depenses` et `entrees` sont des valeurs ABSOLUES — c'est ainsi qu'on les lit
    (« 1 240 € dépensés »). `solde` est leur différence, donc négatif pour un projet qui n'a
    fait que coûter : le cas ordinaire d'un voyage.

    UNE ENTRÉE PAR MONNAIE TOUCHÉE par une opération du projet, même à zéro (une monnaie
    qu'on n'a fait que convertir) : c'est elle qui porte aussi l'histogramme de la monnaie.
    Les monnaies sortent dans l'ordre de leur nom : une liste de totaux qui change de place
    d'une visite à l'autre se relit mal.
    """
    par_monnaie: dict[int, dict] = {}
    for operation in sous_filtre.operations:
        par_monnaie.setdefault(
            operation.monnaie_id,
            {
                "monnaie_id": operation.monnaie_id,
                "monnaie_nom": operation.monnaie.nom,
                "monnaie_symbole": operation.monnaie.symbole,
                "depenses": 0.0,
                "entrees": 0.0,
                "solde": 0.0,
            },
        )
    db = object_session(sous_filtre)
    if par_monnaie and db is not None:
        for cascade in service_cascade.cascades(db, sous_filtre.operations):
            entree = par_monnaie.get(cascade["monnaie_id"])
            if entree is None:
                continue
            for colonne in cascade["colonnes"]:
                if colonne["genre"] not in GENRES_DU_BILAN:
                    continue
                if colonne["montant"] > 0:
                    entree["entrees"] += colonne["montant"]
                else:
                    entree["depenses"] -= colonne["montant"]

    for entree in par_monnaie.values():
        entree["entrees"] = round(entree["entrees"], 2)
        entree["depenses"] = round(entree["depenses"], 2)
        entree["solde"] = round(entree["entrees"] - entree["depenses"], 2)

    return sorted(par_monnaie.values(), key=lambda e: e["monnaie_nom"])


# Les marches de la cascade qui entrent dans le bilan d'un projet : les catégories et les
# frais. Pas l'épargne ni les conversions (cf. totaux_par_monnaie).
GENRES_DU_BILAN = {
    service_cascade.GENRE_ENTREE,
    service_cascade.GENRE_DEPENSE,
    service_cascade.GENRE_FRAIS,
}


# Le libellé d'une dépense qu'aucune catégorie ne classe. Une opération d'un
# projet peut parfaitement ne pas en porter : un virement sortant, un prêt, une
# ligne qu'on n'a pas encore rangée. Les laisser de côté aurait fait un
# histogramme dont la somme ne vaut plus le total affiché juste au-dessus.
CATEGORIE_SANS = "Sans catégorie"


def _lignes_de_depense(operation):
    """Ce qu'une opération apporte à l'histogramme : (catégorie, montant), une
    fois par part si elle est DÉCOUPÉE.

    L'opération découpée ne porte plus de catégorie (`categorie_id` est NULL,
    cf. models.OperationDecoupe) : ce sont ses parts qui SONT sa classification,
    et les compter en plus d'elle-même la ferait peser deux fois. C'est la même
    règle que dans services/soldes.py, appliquée ici à une liste d'opérations
    déjà en mémoire plutôt qu'en SQL — un projet en compte quelques dizaines, on
    ne fait pas de requête pour ça."""
    if operation.decoupes:
        return [
            (part.categorie.nom, part.montant, operation.nature, part.categorie.est_entree)
            for part in operation.decoupes
        ]
    categorie = operation.categorie
    nom = categorie.nom if categorie else CATEGORIE_SANS
    return [(nom, operation.montant, operation.nature, bool(categorie and categorie.est_entree))]


def depenses_par_categorie(sous_filtre) -> dict[int, list[dict]]:
    """L'histogramme d'un projet, PAR MONNAIE : {monnaie_id: [barres]}.

    LA MÊME FORME QUE CELLE DU DASHBOARD (`schemas.DepenseParCategorie`), et
    c'est tout l'intérêt : l'écran le dessine avec la fonction d'histogramme du
    noyau, sans une ligne de rendu en double. D'où `total_previsionnel` égal à
    `total_reel` et `budget_alloue` à zéro — un projet n'a ni prévisionnel ni
    enveloppe, et ces deux valeurs sont ce que le rendu attend pour ne dessiner
    ni barre pâle ni trait rouge.

    SEULES LES SORTIES, comme pour le total « dépensé » juste à côté (cf.
    SENS_SORTANTS) : une entrée versée dans un projet est un remboursement ou
    une recette, elle n'a rien à faire dans un graphe de dépenses — elle se lit
    dans le total des entrées.

    L'ORDRE EST CELUI DES MONTANTS, du plus lourd au plus léger : un projet n'a
    pas la liste ordonnée des catégories du dashboard à respecter, et ce qu'on
    vient y chercher est ce qui a coûté le plus.

    LA COULEUR VIENT DE LA CATÉGORIE (`couleur_index`), comme partout : la même
    catégorie garde sa teinte du dashboard au projet. « Sans catégorie » n'en a
    pas — elle prend l'index de fin de palette, celui que le noyau réserve déjà
    aux barres qui ne sont pas des catégories.

    LES VIREMENTS INTERNES N'Y SONT PAS. Celui vers une AUTRE monnaie est une colonne
    grise « Conversion vers… », et les frais d'un virement la colonne grise des frais —
    toutes deux tirées de la cascade (cf. services/cascade.py). Celui dans la MÊME
    monnaie n'apparaît nulle part ici : l'argent a changé de compte, rien n'a été
    dépensé, et le compter brouillait la question de ce graphe — « en quoi a-t-on
    dépensé ? ». Où l'argent est PARTI se lit dans la cascade.
    """
    par_monnaie: dict[int, dict[str, dict]] = {}
    for operation in sous_filtre.operations:
        if operation.sens not in SENS_SORTANTS:
            continue
        barres = par_monnaie.setdefault(operation.monnaie_id, {})
        lignes = _lignes_de_depense(operation)
        if _jambe_en_face(operation) is not None:
            continue
        for nom, montant, nature, est_entree in lignes:
            # Une catégorie d'ENTRÉE ne peut rien porter ici (les sorties sont
            # seules comptées) : c'est le même écart que le dashboard refuse de
            # dessiner, une barre à zéro qui n'apprend rien. Le drapeau de la
            # catégorie (migration 0060) et plus son nom : elle est renommable,
            # et il peut y en avoir plusieurs.
            if est_entree:
                continue
            barre = barres.setdefault(
                nom,
                {
                    "categorie": nom,
                    "total_reel": 0.0,
                    "total_previsionnel": 0.0,
                    "budget_alloue": 0.0,
                    "couleur_index": _couleur_index(operation, nom),
                    "top_depenses": [],
                },
            )
            barre["total_reel"] += montant
            barre["total_previsionnel"] += montant
            _fondre(barre["top_depenses"], nature, montant)
            # LA PREMIÈRE ET LA DERNIÈRE DATE de la catégorie dans le projet : « Voir toutes
            # les dépenses » ouvre la page Opérations sur cet intervalle (un projet n'a pas de
            # période à lui).
            if barre.get("date_premiere") is None or operation.date < barre["date_premiere"]:
                barre["date_premiere"] = operation.date
            if barre.get("date_derniere") is None or operation.date > barre["date_derniere"]:
                barre["date_derniere"] = operation.date

    return {
        monnaie_id: [
            {**barre, "top_depenses": _top(barre["top_depenses"])}
            for barre in sorted(
                barres.values(), key=lambda b: b["total_reel"], reverse=True
            )
        ]
        for monnaie_id, barres in par_monnaie.items()
    }


# L'index de palette des barres qui ne sont PAS une catégorie — le même que
# celui de la barre « Intérêts de prêts » du dashboard (cf.
# services/soldes._COULEUR_INTERETS_PRETS) : la fin de la palette, pour ne pas
# emprunter la couleur de la première catégorie créée.
_COULEUR_SANS_CATEGORIE = 7


def _couleur_index(operation, nom_categorie: str) -> int:
    if nom_categorie == CATEGORIE_SANS:
        return _COULEUR_SANS_CATEGORIE
    if operation.decoupes:
        for part in operation.decoupes:
            if part.categorie.nom == nom_categorie:
                return part.categorie.couleur_index
    return operation.categorie.couleur_index if operation.categorie else 0


def _fondre(lignes: list[dict], nature: str, montant: float) -> None:
    """Fond une dépense dans son homologue de même libellé, comme le fait
    l'infobulle du dashboard (cf. soldes._fondre_par_libelle) : trois passages
    « Hôtel » à 90 € forment une ligne de 270 €, et non trois lignes de 90."""
    libelle = (nature or "").strip()
    for ligne in lignes:
        if ligne["nature"] == libelle:
            ligne["montant"] += montant
            ligne["nombre"] += 1
            return
    lignes.append({"nature": libelle, "montant": montant, "nombre": 1})


def _top(lignes: list[dict]) -> list[dict]:
    """Les plus grosses, du plus lourd au plus léger — le libellé départageant
    deux montants égaux, pour que deux lectures donnent le même ordre."""
    return sorted(lignes, key=lambda d: (-d["montant"], d["nature"]))[:NB_TOP_DEPENSES]


def _jambe_en_face(operation):
    """L'autre écriture d'un virement interne, relue en base — ou None pour tout ce qui
    n'est pas un virement apparié (une jambe ancienne restée seule compte comme avant)."""
    if not operation.virement_id or operation.type_code != TypeOperation.virement.value:
        return None
    return (
        object_session(operation)
        .query(models.Operation)
        .filter(
            models.Operation.virement_id == operation.virement_id,
            models.Operation.id != operation.id,
        )
        .first()
    )


# Un centime de tolérance : « 500,00 € dépensés sur 500 € » est tenu, pas dépassé d'un arrondi.
_TOLERANCE_MONTANT = 0.005


def periode_du_projet(sous_filtre, aujourdhui: date_type | None = None) -> tuple[str | None, int | None]:
    """(phase, jours restants) d'un projet.

    La phase est « a_venir » avant la date de début, « termine » après la date de fin, « en_cours »
    entre les deux ; None sans aucune date. Les jours restants courent jusqu'à la date de fin (0 une
    fois passée), None sans date de fin."""
    debut, fin = sous_filtre.date_debut, sous_filtre.date_fin
    if debut is None and fin is None:
        return None, None
    aujourdhui = aujourdhui or date_type.today()
    if fin is not None and aujourdhui > fin:
        phase = "termine"
    elif debut is not None and aujourdhui < debut:
        phase = "a_venir"
    else:
        phase = "en_cours"
    restants = max(0, (fin - aujourdhui).days) if fin is not None else None
    return phase, restants


def suivi_du_projet(sous_filtre, totaux: list[dict]) -> dict | None:
    """Où en est le projet face à son montant à tenir, ou None quand aucun montant n'est posé.

    LE MAXIMUM SE COMPARE AUX DÉPENSES, LE MINIMUM AUX ENTRÉES — dans la seule monnaie visée : un
    projet peut toucher plusieurs monnaies, et l'app n'en additionne jamais deux. Un projet sans
    aucune opération dans cette monnaie a zéro dépense et zéro entrée."""
    if sous_filtre.montant_max is None and sous_filtre.montant_min is None:
        return None
    monnaie_id = sous_filtre.monnaie_cible_id
    total = next((t for t in totaux if t["monnaie_id"] == monnaie_id), None)
    depenses = total["depenses"] if total else 0.0
    entrees = total["entrees"] if total else 0.0
    maximum, minimum = sous_filtre.montant_max, sous_filtre.montant_min
    return {
        "monnaie_id": monnaie_id,
        "depenses": depenses,
        "entrees": entrees,
        "montant_max": maximum,
        "montant_min": minimum,
        "max_tenu": None if maximum is None else depenses <= maximum + _TOLERANCE_MONTANT,
        "min_atteint": None if minimum is None else entrees >= minimum - _TOLERANCE_MONTANT,
    }


def lire_sous_filtre(sous_filtre, db=None) -> dict:
    """Le projet tel que l'écran le lit : ses champs, son compte d'opérations et
    ses totaux — et ses CASCADES quand `db` est fourni (le projet ouvert : la
    liste n'en dessine aucune, et elles relisent en base la jambe d'en face de
    chaque virement, cf. services/cascade.py).

    Le nombre d'opérations et les totaux sont CALCULÉS à chaque lecture, jamais
    stockés. Une colonne « total » aurait dû être maintenue à chaque création,
    modification et suppression d'opération — y compris depuis les écrans qui
    ignorent tout des projets (l'import, les virements, la récurrence) — pour ne
    rien apprendre qu'une somme ne dise déjà.
    """
    par_monnaie = depenses_par_categorie(sous_filtre)
    totaux = totaux_par_monnaie(sous_filtre)
    for total in totaux:
        total["depenses_par_categorie"] = par_monnaie.get(total["monnaie_id"], [])
    phase, jours_restants = periode_du_projet(sous_filtre)
    return {
        "id": sous_filtre.id,
        "nom": sous_filtre.nom,
        "description": sous_filtre.description,
        "ordre": sous_filtre.ordre,
        "date_debut": sous_filtre.date_debut,
        "date_fin": sous_filtre.date_fin,
        "montant_max": sous_filtre.montant_max,
        "montant_min": sous_filtre.montant_min,
        "monnaie_cible_id": sous_filtre.monnaie_cible_id,
        "visible_dashboard": bool(sous_filtre.visible_dashboard),
        "phase": phase,
        "jours_restants": jours_restants,
        "suivi": suivi_du_projet(sous_filtre, totaux),
        "nombre_operations": len(sous_filtre.operations),
        # L'histogramme est rangé DANS le total de sa monnaie : c'est déjà la
        # ligne par monnaie que l'écran affiche, et deux listes parallèles à
        # réaccorder par identifiant n'auraient été qu'une occasion de plus de
        # les laisser diverger.
        "totaux": totaux,
        "cascades": (
            service_cascade.cascades(db, sous_filtre.operations) if db is not None else []
        ),
    }
