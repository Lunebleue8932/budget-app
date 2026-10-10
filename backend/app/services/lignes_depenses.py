"""Les lignes de dépenses d'une fenêtre, et ce qu'elles COÛTENT.

REMONTÉ DU SERVICE DES OBJECTIFS, où ces fonctions vivaient. Deux extensions les
lisent désormais — « Objectifs » (la mesure d'un objectif) et « Analyse du
budget » (la prévision avancée du solde, qui moyenne les dépenses passées) — et
aucune des deux ne requiert l'autre : une extension n'en importe pas une autre,
sans quoi éteindre la première casserait la seconde. Le noyau est l'endroit qui
peut être lu par les deux.

RIEN N'A ÉTÉ RÉÉCRIT : les blocs sont déplacés tels quels (noms mis à part), et
`service_objectifs` les ré-exporte sous leurs anciens noms. Le périmètre reste
celui de l'histogramme du dashboard — classique et remboursable, statut réel, le
reste à charge pour une remboursable (`soldes._base_imposable`), la fraction
d'un amortissement qui tombe dans la fenêtre (`soldes.part_amortie_fenetre`).
"""
import calendar
import unicodedata
from datetime import date as date_type
from datetime import timedelta
from typing import Optional

from sqlalchemy import and_, or_
from sqlalchemy.orm import Session

from app import models
from app.constants import (
    ChampFiltreObjectif,
    JoursFiltreObjectif,
    JOURS_SEMAINE,
    CadenceObjectif,
    Sens,
    Statut,
    TypeOperation,
)
from app.models import operation_sous_filtre
from app.services import soldes


def jours_ecoules(
    debut: date_type, fin: date_type, aujourdhui: date_type
) -> tuple[date_type, int]:
    """La borne de fin RÉELLEMENT écoulée, et le nombre de jours qu'elle laisse.

    ON S'ARRÊTE À AUJOURD'HUI, et c'est ce qui rend la comparaison honnête : le
    3 du mois, une cible mensuelle n'a pas encore eu le mois pour être tenue, et
    la comparer entière annoncerait un échec à tous les objectifs les
    vingt-huit premiers jours. Une période entièrement future ne laisse aucun
    jour — il n'y a rien à mesurer avant qu'elle commence."""
    if aujourdhui < debut:
        return debut, 0
    borne = min(fin, aujourdhui)
    return borne, (borne - debut).days + 1


# Combien de jours chaque moitié de semaine compte : cinq jours ouvrés, deux de week-end.
JOURS_PAR_MOITIE_DE_SEMAINE = {
    JoursFiltreObjectif.semaine.value: 5,
    JoursFiltreObjectif.weekend.value: 2,
}


def jours_concernes(debut: date_type, fin: date_type, jours: Optional[str] = None) -> int:
    """Combien de jours de `debut` à `fin` (inclus) COMPTENT pour un filtre « jours » :
    tous sans filtre, les samedis et dimanches pour « weekend », les cinq autres pour
    « semaine »."""
    if fin < debut:
        return 0
    if jours is None:
        return (fin - debut).days + 1
    weekend = jours == JoursFiltreObjectif.weekend.value
    return sum(
        1
        for decalage in range((fin - debut).days + 1)
        if ((debut + timedelta(days=decalage)).weekday() >= 5) == weekend
    )


def unites_fenetre(
    cadence: str,
    debut: date_type,
    fin: date_type,
    aujourdhui: Optional[date_type] = None,
    ecoulees: bool = True,
    jours_filtre: Optional[str] = None,
) -> float:
    """La même chose pour une FENÊTRE QUELCONQUE : une semaine, un mois, une
    année, ou tout l'historique (cf. `fenetres_de_lecture`).

    UNE FENÊTRE DE MOIS COMMENCE LE 1er : c'est ce que sont toutes celles qu'on
    lit ici (un mois, une année, tout l'historique depuis le début de son
    premier mois), et c'est ce qui permet de compter chaque mois pour la fraction
    de lui-même qui est écoulée.

    `jours_filtre` : la valeur du filtre « jours » de l'objectif, quand il en a un
    (« semaine » ou « weekend »). LE TEMPS SE COMPTE ALORS EN JOURS CONCERNÉS, pas en
    jours de calendrier. Un objectif « dépenses du week-end » ne reçoit de dépense
    que deux jours sur sept : diviser ce qu'elles totalisent par le nombre de
    semaines de CALENDRIER écoulées le fait exploser tant qu'un week-end seul est
    passé (un lundi 5, un seul week-end vécu, 5/7 de semaine écoulée : la moyenne
    est gonflée de 40 %, et un objectif tenu se lit comme dépassé). Une semaine
    vaut donc deux jours concernés pour « weekend » et cinq pour « semaine » ; un
    mois vaut les jours concernés de CE mois — la fraction qui s'écoule suit les
    samedis et dimanches, pas le calendrier."""
    aujourdhui = (aujourdhui or date_type.today()) if ecoulees else fin
    borne, jours = jours_ecoules(debut, fin, aujourdhui)
    if jours <= 0:
        return 0.0

    if cadence == CadenceObjectif.semaine.value:
        if jours_filtre in JOURS_PAR_MOITIE_DE_SEMAINE:
            return jours_concernes(debut, borne, jours_filtre) / JOURS_PAR_MOITIE_DE_SEMAINE[jours_filtre]
        return jours / JOURS_SEMAINE

    # Cadence « mois » : chaque mois de la période compte pour la fraction de
    # lui-même qui est écoulée. Un mois entier vaut 1, le mois en cours vaut ses
    # jours passés sur son nombre de jours — ses jours CONCERNÉS passés sur ses
    # jours concernés, quand un filtre « jours » est posé.
    total = 0.0
    annee, mois = debut.year, debut.month
    while date_type(annee, mois, 1) <= borne:
        jours_du_mois = calendar.monthrange(annee, mois)[1]
        if jours_filtre in JOURS_PAR_MOITIE_DE_SEMAINE:
            premier = max(debut, date_type(annee, mois, 1))
            dernier_du_mois = date_type(annee, mois, jours_du_mois)
            ecoules = jours_concernes(premier, min(borne, dernier_du_mois), jours_filtre)
            total += ecoules / jours_concernes(date_type(annee, mois, 1), dernier_du_mois, jours_filtre)
        else:
            comptes = borne.day if (borne.year, borne.month) == (annee, mois) else jours_du_mois
            total += min(comptes, jours_du_mois) / jours_du_mois
        annee, mois = (annee + 1, 1) if mois == 12 else (annee, mois + 1)
    return total


def montant_retenu(operation, code: str, montant: float) -> float:
    """Ce qu'une dépense COÛTE, à partir de ce qu'elle a fait sortir.

    UN SEUL ENDROIT POUR LA RÈGLE DU REMBOURSABLE, et c'est celui du noyau :
    `soldes._base_imposable` est ce que l'histogramme, le camembert et le total
    des sorties appliquent déjà. Un objectif qui compterait les 60 € d'un repas
    dont on récupère 45 annoncerait un montant moyen que rien d'autre à l'écran
    ne donne — et le réécrire ici aurait fait deux versions d'une règle qui
    s'éteint déjà avec son extension.

    LA PART D'UNE DÉCOUPE SE RAMÈNE AU PRORATA : la découpe répartit le montant
    BRUT de l'opération, et une opération découpée ET remboursable doit rendre
    la fraction du reste à charge qui revient à cette part. Le rapport de la
    part au brut est ce qui les relie — il vaut 1 quand rien n'est découpé."""
    base = soldes._base_imposable(operation.montant, operation.montant_du, code)
    if montant == operation.montant or not operation.montant:
        return base
    return base * (montant / operation.montant)


def normaliser(texte: Optional[str]) -> str:
    """Minuscules et sans accents : « Café », « cafe » et « CAFÉ » sont le même
    mot pour qui le cherche dans un libellé bancaire, dont la casse et les
    accents dépendent de la banque bien plus que de ce qu'on a acheté."""
    decompose = unicodedata.normalize("NFKD", texte or "")
    return "".join(c for c in decompose if not unicodedata.combining(c)).lower()


def passe_filtres(operation, filtres: Optional[list]) -> bool:
    """Vrai si l'opération passe TOUS les filtres de l'objectif.

    LES MONTANTS LISENT LA LIGNE ENTIÈRE, ce qu'on lit sur son relevé — et non
    la part d'une découpe ni le reste à charge d'une remboursable : « écarter
    les dépenses de moins de 5 € » parle du ticket de caisse, pas d'un calcul.
    Un filtre dont le champ est inconnu est IGNORÉ plutôt que fatal : une base
    écrite par une version plus récente ne doit pas faire tomber la mesure."""
    for filtre in filtres or []:
        champ, valeur = filtre.get("champ"), filtre.get("valeur")
        if champ == ChampFiltreObjectif.montant_min.value:
            if operation.montant < float(valeur):
                return False
        elif champ == ChampFiltreObjectif.montant_max.value:
            if operation.montant > float(valeur):
                return False
        elif champ == ChampFiltreObjectif.libelle_contient.value:
            if normaliser(str(valeur)) not in normaliser(operation.nature):
                return False
        elif champ == ChampFiltreObjectif.libelle_exclut.value:
            if normaliser(str(valeur)) in normaliser(operation.nature):
                return False
        elif champ == ChampFiltreObjectif.jours.value:
            weekend = operation.date.weekday() >= 5
            if (valeur == JoursFiltreObjectif.weekend.value) != weekend:
                return False
    return True


def lignes_detaillees(
    db: Session,
    debut: date_type,
    fin: date_type,
    monnaie_id: int,
    categorie_id: Optional[int],
    sous_filtre_id: Optional[int] = None,
    filtres: Optional[list] = None,
) -> list[tuple]:
    """Chaque dépense de la période, avec son montant retenu : `(opération,
    retenu)`, une paire par LIGNE.

    LA PAGE D'UN OBJECTIF LIT CETTE FONCTION, comme la mesure : les opérations
    qu'elle liste sont EXACTEMENT celles qui ont servi au chiffre de la carte, et
    non une seconde requête qui finirait par ne plus tomber d'accord avec lui.

    LE MÊME PÉRIMÈTRE DE TYPES QUE L'HISTOGRAMME (classique et remboursable,
    statut réel) : ce sont les opérations qui portent une catégorie, donc les
    seules qu'un objectif par catégorie puisse compter.

    LA DATE SUIT L'AMORTISSEMENT, comme le drill-through du dashboard : une
    dépense amortie n'est PAS comptée à sa date de paiement mais dans les
    fenêtres que son étalement recoupe, pour la fraction de ses jours qui y
    tombe (`soldes.part_amortie_fenetre`). Le montant retenu est donc au prorata ;
    la ligne, elle, compte pour UNE dès qu'elle est dans la fenêtre — « combien
    de fois » ne se divise pas.

    LE MONTANT RETENU EST LE RESTE À CHARGE (cf. `montant_retenu`) : ce qu'une ligne
    coûte, et non ce qu'elle a fait sortir du compte.

    UNE OPÉRATION DÉCOUPÉE COMPTE POUR UNE LIGNE, et pour le montant de sa part
    quand l'objectif vise une catégorie : c'est UN passage en caisse, et le
    compter deux fois parce qu'on en a rangé 30 € ailleurs ferait mentir
    « combien de fois ». Un objectif de PROJET, lui, la compte ENTIÈRE : on verse
    une opération dans un projet, jamais une de ses parts.

    UNE LIGNE À ZÉRO EST ÉCARTÉE — une dépense remboursable intégralement due, ou
    n'importe laquelle quand l'extension « Suivi des remboursements » est
    éteinte. Elle ne coûte rien, et la compter tirerait toute moyenne vers le bas
    au nom d'une dépense qui n'en est pas une."""
    requete = (
        db.query(models.Operation, models.TypeOperationDB.code)
        .join(
            models.TypeOperationDB,
            models.Operation.type_id == models.TypeOperationDB.id,
        )
        .filter(
            # LES BORNES EN CLAIR plutôt que `filtre_date_periode` : la même
            # requête sert au mois, à l'année ET à une semaine qui peut chevaucher
            # deux mois (cf. `semaine_de_lecture`). Une opération amortie n'entre
            # pas par sa date mais par le chevauchement de son étalement (bornes
            # au 1er du mois : la fin se compare donc au 1er du mois de début).
            or_(
                and_(
                    models.Operation.amorti.is_(False),
                    models.Operation.date >= debut,
                    models.Operation.date <= fin,
                ),
                and_(
                    models.Operation.amorti.is_(True),
                    models.Operation.amortissement_debut <= fin,
                    models.Operation.amortissement_fin >= debut.replace(day=1),
                ),
            ),
            models.Operation.monnaie_id == monnaie_id,
            models.Operation.statut == Statut.reel,
            models.Operation.sens == Sens.depense,
            models.TypeOperationDB.code.in_(
                [TypeOperation.classique.value, TypeOperation.remboursable.value]
            ),
        )
    )
    if sous_filtre_id is not None:
        # LE PROJET SE JOINT, il ne se filtre pas en mémoire : un projet compte
        # quelques dizaines d'opérations, mais la période en compte des
        # milliers, et c'est elle qu'on lirait entière.
        requete = requete.join(
            operation_sous_filtre,
            operation_sous_filtre.c.operation_id == models.Operation.id,
        ).filter(operation_sous_filtre.c.sous_filtre_id == sous_filtre_id)

    lignes: list[tuple] = []
    for operation, code in requete.all():
        if not passe_filtres(operation, filtres):
            continue
        if categorie_id is None or operation.categorie_id == categorie_id:
            retenu = montant_retenu(operation, code, operation.montant)
        else:
            # Découpée : elle n'a plus de catégorie propre, ce sont ses parts
            # qui la classent (cf. models.OperationDecoupe).
            part = sum(
                part.montant
                for part in operation.decoupes
                if part.categorie_id == categorie_id
            )
            if not part:
                continue
            retenu = montant_retenu(operation, code, part)
        if operation.amorti:
            retenu *= soldes.part_amortie_fenetre(operation, debut, fin)
            if not retenu:
                continue
        if retenu:
            lignes.append((operation, retenu))
    return lignes
