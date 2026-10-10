"""Où en sera le solde, jour après jour : la courbe du solde prévisionnel.

LA COURBE EST LE « SOLDE TOTAL » DU DASHBOARD, ÉTIRÉ DANS LE TEMPS. Même
périmètre (les comptes COURANTS, l'épargne et les comptes-titres en sont exclus
— `TYPES_COMPTE_HORS_COURANT`), mêmes règles (solde initial, intérêts perçus,
tous les mouvements, le reste dû des prêts retranché comme dans le projeté). La
promesse, verrouillée par un test : SANS prévision avancée ni exclusion, la
valeur de la courbe au dernier jour est EXACTEMENT le solde projeté du dashboard
borné à la même date. Une courbe qui finirait ailleurs que le chiffre posé juste
au-dessus ne serait plus crue.

TROIS CONSTRUCTIONS DANS LE TEMPS
  - LE PASSÉ est le solde RÉEL jour par jour : seul ce qui est survenu y entre.
    Une opération prévisionnelle n'a pas eu lieu, elle n'y figure donc pas.
  - LE FUTUR ajoute les prévisionnelles à leur date, et les opérations réelles
    déjà datées plus tard (le solde réel du noyau n'est pas borné en date).
  - UNE PRÉVISIONNELLE ÉCHUE ET NON RAPPROCHÉE se pose sur DEMAIN et se signale
    « en retard » : elle compte dans le projeté du dashboard, elle doit donc
    compter ici ; mais elle ne peut pas s'être produite dans le passé, sans
    quoi la courbe réécrirait des jours déjà vécus.

LA PRÉVISION AVANCÉE ajoute à chaque jour (ou chaque dimanche, en cadence
« semaine ») ce que l'on dépense EN MOYENNE : les dépenses courantes réelles de
la fenêtre d'historique, sur le périmètre de l'histogramme du dashboard (cf.
`lignes_depenses.lignes_detaillees`), divisées par le temps écoulé.

LE DOUBLE COMPTE EST LE PIÈGE DE CETTE PRÉVISION, et il a deux formes — que
`detecter_doublons` SIGNALE sans jamais trancher (même parti que le
rapprochement des prévisionnelles : rien n'est écarté d'office, c'est
l'utilisateur qui décide) :
  - UNE PRÉVISIONNELLE QUI RESSEMBLE À UNE OPÉRATION RÉELLE déjà passée (même
    compte, même type, même montant au centime, date voisine) : la dépense a été
    saisie ou importée à la main sans être rapprochée, et pèse deux fois dans le
    projeté ;
  - UNE PRÉVISIONNELLE RÉCURRENTE DÉJÀ PRÉSENTE DANS LA MOYENNE : le loyer prévu
    pour les mois à venir, alors que les loyers passés sont dans la moyenne.

CE SERVICE N'ÉCRIT RIEN. Les exclusions choisies à l'écran se rangent dans
`preference_interface` (clé « analyse-budget.solde-previsionnel ») : elles
désignent des identifiants de la base, donc elles vivent dans la base.
"""
from collections import defaultdict
from datetime import date as date_type
from datetime import timedelta
from typing import Optional

from sqlalchemy import and_, func, or_
from sqlalchemy.orm import Session

from app import models
from app.constants import (
    TYPES_COMPTE_HORS_COURANT,
    Sens,
    Statut,
    TypeOperation,
)
from app.services import lignes_depenses, soldes

# Combien de jours séparent une prévisionnelle de la ligne réelle qui lui
# ressemble pour qu'on les soupçonne d'être la même. Sept, comme la détection de
# doublons de virements (`import_bancaire.FENETRE_DOUBLON_VIREMENT_JOURS`) : un
# virement ou un prélèvement passe en quelques jours, rarement en plus d'une
# semaine.
FENETRE_DOUBLON_JOURS = 7

# Écart de jour du mois toléré entre une prévisionnelle récurrente et ses
# occurrences passées : un loyer prélevé le 3 un mois, le 5 le suivant, reste LE
# loyer. Au-delà, ce n'est plus la même ligne.
ECART_JOUR_DU_MOIS = 3

# Combien de jours de passé la courbe montre avant aujourd'hui : assez pour
# situer le présent sur le graphe, assez peu pour que l'avenir garde la place.
JOURS_DE_PASSE = 30

# Fenêtre d'historique par défaut de la prévision avancée, en semaines. Douze :
# un trimestre, assez pour lisser un mois exceptionnel sans traîner une habitude
# abandonnée depuis un an.
FENETRE_SEMAINES_DEFAUT = 12

# L'horizon par défaut, en jours.
HORIZON_JOURS_DEFAUT = 90

_ENTREES = (Sens.entree, Sens.transfert_entrant)

CLE_PREFERENCE = "analyse-budget.solde-previsionnel"


def _signe(sens) -> float:
    return 1.0 if sens in _ENTREES else -1.0


def _comptes_courants(db: Session, monnaie_id: int) -> dict[int, str]:
    """`{compte_id: nom}` des comptes COURANTS qui portent cette monnaie.

    Par `get_soldes_comptes`, donc avec ses règles : un compte éteint et soldé,
    ou une monnaie éteinte et soldée, n'y figure pas — comme dans la carte
    « Solde total »."""
    courants: dict[int, str] = {}
    for item in soldes.get_soldes_comptes(db):
        compte = item["compte"]
        if compte.type_nom in TYPES_COMPTE_HORS_COURANT:
            continue
        if monnaie_id in item["soldes"]:
            courants[compte.id] = compte.nom
    return courants


def _solde_de_depart(db: Session, monnaie_id: int, comptes: dict[int, str]) -> float:
    """Solde initial + intérêts perçus des comptes courants : ce que la courbe
    porte AVANT le premier mouvement. Sans date, comme dans le noyau."""
    interets = soldes._interets_percus_par_compte_monnaie(db)
    total = 0.0
    for item in soldes.soldes_de_tous_les_liens(db):
        compte = item["compte"]
        if compte.id not in comptes:
            continue
        lien = item["soldes"].get(monnaie_id)
        if lien is None:
            continue
        total += lien["solde_initial"] + interets.get((compte.id, monnaie_id), 0.0)
    return total


def _ligne(operation, noms: dict[int, str]) -> dict:
    return {
        "id": operation.id,
        "date": operation.date,
        "nature": operation.nature,
        "montant": operation.montant,
        "compte_nom": noms.get(operation.compte_id, ""),
    }


def _jour_pose(operation, aujourdhui: date_type) -> date_type:
    """Le jour où la courbe compte l'opération. Une réelle : sa date. Une
    prévisionnelle : sa date, mais jamais avant demain (cf. l'en-tête)."""
    if operation.statut == Statut.previsionnel:
        return max(operation.date, aujourdhui + timedelta(days=1))
    return operation.date


# ---------- La moyenne des dépenses passées ----------


def _premier_jour_depense(
    db: Session, monnaie_id: int, comptes: dict[int, str]
) -> Optional[date_type]:
    """Le premier jour où l'on a une trace de dépense réelle sur ces comptes :
    avant lui, il n'y a rien à moyenner, et le compter dans la durée diluerait
    la moyenne d'un compte récent comme si l'on n'avait rien dépensé avant."""
    if not comptes:
        return None
    return (
        db.query(func.min(models.Operation.date))
        .filter(
            models.Operation.monnaie_id == monnaie_id,
            models.Operation.compte_id.in_(list(comptes)),
            models.Operation.statut == Statut.reel,
            models.Operation.sens == Sens.depense,
        )
        .scalar()
    )


def moyenne_depenses(
    db: Session,
    monnaie_id: int,
    aujourdhui: date_type,
    fenetre_semaines: Optional[int] = FENETRE_SEMAINES_DEFAUT,
    exclure_categories: Optional[set] = None,
    exclure_types: Optional[set] = None,
    exclure_operations: Optional[set] = None,
    comptes: Optional[dict[int, str]] = None,
) -> dict:
    """Ce que l'on dépense en moyenne, par jour et par semaine.

    LA FENÊTRE SE TERMINE AUJOURD'HUI et commence `fenetre_semaines` semaines
    plus tôt — ou au premier jour de dépense si le compte est plus récent
    (`fenetre_semaines=None` : tout l'historique). Le dénominateur est le temps
    RÉELLEMENT écoulé dans cette fenêtre, jamais celui qu'on aurait voulu.

    LES EXCLUSIONS retirent des LIGNES de la somme, pas des jours du temps :
    exclure le loyer baisse la moyenne par jour, il ne raccourcit pas la
    fenêtre. Catégorie et type : une opération découpée perd la fraction de son
    montant qui relève d'une catégorie exclue (ses parts SONT sa classification).
    """
    comptes = comptes if comptes is not None else _comptes_courants(db, monnaie_id)
    exclure_categories = exclure_categories or set()
    exclure_types = exclure_types or set()
    exclure_operations = exclure_operations or set()

    vide = {
        "par_jour": 0.0,
        "par_semaine": 0.0,
        "total": 0.0,
        "jours": 0,
        "nombre_operations": 0,
        "debut": None,
        "fin": aujourdhui,
        "operations": [],
    }
    premier = _premier_jour_depense(db, monnaie_id, comptes)
    if premier is None or premier > aujourdhui:
        return vide
    if fenetre_semaines is None:
        debut = premier
    else:
        debut = max(aujourdhui - timedelta(days=7 * fenetre_semaines - 1), premier)

    total = 0.0
    retenues = []
    for operation, retenu in lignes_depenses.lignes_detaillees(
        db, debut, aujourdhui, monnaie_id, None
    ):
        if operation.compte_id not in comptes or operation.id in exclure_operations:
            continue
        if operation.type_code in exclure_types:
            continue
        if operation.decoupes:
            # Découpée : la catégorie d'une part exclue sort au prorata.
            part_exclue = sum(
                part.montant
                for part in operation.decoupes
                if part.categorie_id in exclure_categories
            )
            if operation.montant:
                retenu *= 1.0 - part_exclue / operation.montant
        elif operation.categorie_id in exclure_categories:
            continue
        if not retenu:
            continue
        total += retenu
        retenues.append((operation, retenu))

    jours = (aujourdhui - debut).days + 1
    return {
        "par_jour": total / jours,
        "par_semaine": total / jours * 7,
        "total": total,
        "jours": jours,
        "nombre_operations": len(retenues),
        "debut": debut,
        "fin": aujourdhui,
        "operations": retenues,
    }


# ---------- La courbe ----------


def _a_poser(
    db: Session,
    monnaie_id: int,
    comptes: dict[int, str],
    debut: date_type,
    fin: date_type,
) -> list:
    """Les opérations qui bougent la courbe entre `debut` et `fin`.

    Les réelles DATÉES dans la fenêtre, et toutes les prévisionnelles datées
    jusqu'à `fin` — y compris les échues, qui se posent demain. Ce qui est réel
    et antérieur à `debut` est déjà dans le solde d'ouverture."""
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


def _ouverture(
    db: Session, monnaie_id: int, comptes: dict[int, str], avant: date_type
) -> float:
    """Le solde la veille de `avant` : départ + tout le réel antérieur."""
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
    return _solde_de_depart(db, monnaie_id, comptes) + sum(
        _signe(sens) * (total or 0.0) for sens, total in sums
    )


def _restes_dus(
    db: Session, monnaie_id: int, comptes: dict[int, str], fin: date_type
) -> dict[date_type, float]:
    """Le reste dû des prêts reçus, par date du prêt, retranché comme dans le
    solde projeté du noyau (`soldes._reste_du_prets_par_compte_monnaie`)."""
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


def solde_previsionnel(
    db: Session,
    monnaie_id: int,
    aujourdhui: Optional[date_type] = None,
    jusqu_au: Optional[date_type] = None,
    avancee: bool = False,
    cadence: str = "jour",
    fenetre_semaines: Optional[int] = FENETRE_SEMAINES_DEFAUT,
    exclure_categories: Optional[set] = None,
    exclure_types: Optional[set] = None,
    exclure_operations: Optional[set] = None,
) -> dict:
    """La courbe, les échéances qui la font bouger, la moyenne et les doublons.

    `jusqu_au` est ramené à demain au plus tôt : une courbe qui s'arrêterait
    avant l'avenir n'aurait rien de prévisionnel (et une prévisionnelle échue,
    posée demain, y manquerait)."""
    aujourdhui = aujourdhui or date_type.today()
    exclure_operations = exclure_operations or set()
    fin = max(jusqu_au or aujourdhui + timedelta(days=HORIZON_JOURS_DEFAUT), aujourdhui + timedelta(days=1))
    debut = aujourdhui - timedelta(days=JOURS_DE_PASSE)

    comptes = _comptes_courants(db, monnaie_id)
    if not comptes:
        vide = moyenne_depenses(db, monnaie_id, aujourdhui, comptes={})
        vide.pop("operations")
        return {
            "monnaie_id": monnaie_id,
            "aujourdhui": aujourdhui,
            "jusqu_au": fin,
            "points": [],
            "echeances": [],
            "moyenne": {**vide, "active": False, "cadence": cadence},
            "doublons": [],
            "solde_aujourdhui": 0.0,
            "solde_fin": 0.0,
        }

    # LES EXCLUSIONS PAR OPÉRATION retirent aussi une prévisionnelle de la
    # courbe : c'est la réponse à « celle-ci est déjà passée, ne la compte pas ».
    operations = [
        o for o in _a_poser(db, monnaie_id, comptes, debut, fin) if o.id not in exclure_operations
    ]
    restes = _restes_dus(db, monnaie_id, comptes, fin)

    # Le solde d'ouverture porte AUSSI le reste dû des prêts antérieurs.
    ouverture = _ouverture(db, monnaie_id, comptes, debut) - sum(
        total for jour, total in restes.items() if jour < debut
    )

    par_jour: dict[date_type, float] = defaultdict(float)
    echeances = []
    for operation in operations:
        pose = _jour_pose(operation, aujourdhui)
        par_jour[pose] += _signe(operation.sens) * operation.montant
        if operation.statut == Statut.previsionnel and pose > aujourdhui:
            echeances.append(
                {
                    **_ligne(operation, comptes),
                    "montant": _signe(operation.sens) * operation.montant,
                    "jour_pose": pose,
                    "en_retard": operation.date <= aujourdhui,
                }
            )
    for jour, total in restes.items():
        if jour >= debut:
            par_jour[jour] -= total

    moyenne = {"active": False, "cadence": cadence, **moyenne_depenses(
        db, monnaie_id, aujourdhui, fenetre_semaines,
        exclure_categories, exclure_types, exclure_operations, comptes,
    )}
    if avancee:
        moyenne["active"] = True

    points = []
    solde = ouverture
    cumul_moyenne = 0.0
    jour = debut
    while jour <= fin:
        futur = jour > aujourdhui
        # Le PASSÉ ne compte que le réel : une prévisionnelle y est posée au
        # plus tôt demain (cf. `_jour_pose`), donc `par_jour` n'a rien à
        # retirer — sauf le reste dû des prêts, qui suit la date du prêt.
        solde += par_jour.get(jour, 0.0)
        if avancee and futur:
            if cadence == "semaine":
                # La dépense de la semaine tombe le dimanche : un escalier
                # lisible plutôt qu'une pente qui laisserait croire à un
                # prélèvement quotidien.
                if jour.weekday() == 6:
                    cumul_moyenne += moyenne["par_semaine"]
            else:
                cumul_moyenne += moyenne["par_jour"]
        points.append(
            {"date": jour, "solde": solde - cumul_moyenne, "passe": not futur}
        )
        jour += timedelta(days=1)

    doublons = detecter_doublons(
        db, monnaie_id, comptes, aujourdhui, fin, moyenne, exclure_operations
    )

    solde_aujourdhui = next((p["solde"] for p in points if p["date"] == aujourdhui), ouverture)
    return {
        "monnaie_id": monnaie_id,
        "aujourdhui": aujourdhui,
        "jusqu_au": fin,
        "points": points,
        "echeances": sorted(echeances, key=lambda e: (e["jour_pose"], e["id"])),
        "moyenne": {k: v for k, v in moyenne.items() if k != "operations"},
        "doublons": doublons,
        "solde_aujourdhui": solde_aujourdhui,
        "solde_fin": points[-1]["solde"] if points else ouverture,
    }


# ---------- Les doublons ----------


def _centimes(montant: float) -> int:
    return round(abs(montant) * 100)


def _serie(operation) -> int:
    """La récurrence à laquelle appartient une opération (celle du modèle), ou
    son propre identifiant si elle n'en a pas."""
    return operation.recurrence_parent_id or operation.id


def detecter_doublons(
    db: Session,
    monnaie_id: int,
    comptes: dict[int, str],
    aujourdhui: date_type,
    fin: date_type,
    moyenne: dict,
    exclure_operations: set,
) -> list[dict]:
    """Les prévisionnelles qui risquent de compter deux fois. SIGNALE, N'ÉCARTE
    RIEN : `a_exclure` est la proposition, c'est l'écran qui l'applique si
    l'utilisateur coche.

    DEUX GENRES (cf. l'en-tête) :
      - `deja_reelle` : une prévisionnelle proche d'aujourd'hui (échue, ou à
        moins de `FENETRE_DOUBLON_JOURS` jours) qui a son double réel ;
      - `deja_dans_la_moyenne` : une prévisionnelle de DÉPENSE à venir dont des
        occurrences passées figurent dans la moyenne (seulement quand la
        prévision avancée est active, sans quoi la moyenne n'entre pas dans la
        courbe).

    UNE LIGNE RÉELLE NE SERT QU'UNE FOIS (`prises`) : deux prévisionnelles
    identiques et une seule réelle, c'est un doublon et un reste, pas deux."""
    noms = comptes
    previsionnelles = (
        db.query(models.Operation)
        .filter(
            models.Operation.monnaie_id == monnaie_id,
            models.Operation.compte_id.in_(list(comptes)),
            models.Operation.statut == Statut.previsionnel,
            models.Operation.date <= fin,
        )
        .order_by(models.Operation.date, models.Operation.id)
        .all()
    )
    previsionnelles = [p for p in previsionnelles if p.id not in exclure_operations]
    if not previsionnelles:
        return []

    doublons: list[dict] = []

    # ---- Genre 1 : une prévisionnelle proche qui a déjà son double réel ----
    proches = [
        p for p in previsionnelles
        if p.date <= aujourdhui + timedelta(days=FENETRE_DOUBLON_JOURS)
    ]
    if proches:
        plus_tot = min(p.date for p in proches) - timedelta(days=FENETRE_DOUBLON_JOURS)
        plus_tard = max(p.date for p in proches) + timedelta(days=FENETRE_DOUBLON_JOURS)
        reelles = (
            db.query(models.Operation)
            .filter(
                models.Operation.monnaie_id == monnaie_id,
                models.Operation.compte_id.in_(list(comptes)),
                models.Operation.statut == Statut.reel,
                models.Operation.date >= plus_tot,
                models.Operation.date <= plus_tard,
                # Un virement se détecte ailleurs (jambes liées) : ici on
                # cherche des dépenses ou des entrées saisies en double.
                models.Operation.sens.in_([Sens.depense, Sens.entree]),
            )
            .all()
        )
        prises: set[int] = set()
        for prevue in proches:
            candidates = [
                r for r in reelles
                if r.id not in prises
                and r.compte_id == prevue.compte_id
                and r.type_id == prevue.type_id
                and r.sens == prevue.sens
                and _centimes(r.montant) == _centimes(prevue.montant)
                and abs((r.date - prevue.date).days) <= FENETRE_DOUBLON_JOURS
                # La réelle de la même série n'est pas un double, c'est la
                # précédente occurrence : un prélèvement hebdomadaire tombe
                # toujours à moins de sept jours du suivant.
                and _serie(r) != _serie(prevue)
            ]
            if not candidates:
                continue
            proche = min(candidates, key=lambda r: (abs((r.date - prevue.date).days), r.id))
            prises.add(proche.id)
            doublons.append(
                {
                    "genre": "deja_reelle",
                    "prevu": _ligne(prevue, noms),
                    "passes": [_ligne(proche, noms)],
                    "occurrences": 1,
                    # La proposition : écarter la PRÉVISIONNELLE, qui est la
                    # ligne en trop.
                    "a_exclure": [prevue.id],
                }
            )

    # ---- Genre 2 : une récurrence à venir déjà comptée dans la moyenne ----
    if moyenne.get("active") and moyenne.get("operations"):
        passees = [o for o, _ in moyenne["operations"]]
        par_serie: dict[int, list] = defaultdict(list)
        for prevue in previsionnelles:
            if prevue.sens != Sens.depense or prevue.date <= aujourdhui:
                continue
            if not (prevue.recurrente or prevue.recurrence_parent_id):
                continue
            par_serie[_serie(prevue)].append(prevue)
        for occurrences in par_serie.values():
            prochaine = occurrences[0]
            memes = [
                r for r in passees
                if r.compte_id == prochaine.compte_id
                and r.type_id == prochaine.type_id
                and _centimes(r.montant) == _centimes(prochaine.montant)
                and abs(r.date.day - prochaine.date.day) <= ECART_JOUR_DU_MOIS
            ]
            if not memes:
                continue
            doublons.append(
                {
                    "genre": "deja_dans_la_moyenne",
                    "prevu": _ligne(prochaine, noms),
                    "passes": [_ligne(r, noms) for r in memes],
                    "occurrences": len(occurrences),
                    # La proposition : sortir les occurrences PASSÉES de la
                    # moyenne. La prévisionnelle, elle, est la bonne — c'est
                    # une échéance connue, plus fiable qu'une moyenne.
                    "a_exclure": [r.id for r in memes],
                }
            )
    return doublons
