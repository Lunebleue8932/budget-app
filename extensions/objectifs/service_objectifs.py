"""Mesurer un objectif, et rien d'autre.

CE SERVICE N'ÉCRIT AUCUN CALCUL. Il lit ce que le noyau expose déjà et le
compare à un nombre : aucun solde, aucun KPI, aucune barre d'histogramme ne
change parce qu'un objectif existe.

DEUX PÉRIMÈTRES, ET C'EST LE SEUL POINT À SAVOIR (cf. constants.MesureObjectif) :

  - « COMBIEN ÇA PÈSE » (`montant_total`, `part_depenses`) passe par
    `soldes.get_depenses_par_categorie`, LA fonction qui dessine l'histogramme
    et le camembert du dashboard. Un objectif posé sous ces deux graphes et qui
    annoncerait un autre chiffre qu'eux serait un objectif qu'on cesse de
    croire — d'où l'emprunt du calcul plutôt que sa recopie.

  - « COMBIEN DE FOIS, ET DE COMBIEN » (`nombre`, `montant_moyen`) compte des
    LIGNES DE RELEVÉ : une opération, à sa date, pour ce qu'elle COÛTE. Pas
    d'étalement — une facture amortie sur douze mois reste UNE dépense faite une
    fois, au mois où on l'a faite — mais bien le RESTE À CHARGE d'une dépense
    remboursable : les 60 € d'un repas dont on récupère 45 ne pèsent pas 60 € au
    budget, et une moyenne qui les compterait entiers dirait ce qu'on a AVANCÉ,
    pas ce qu'on a dépensé. C'est la même règle que l'histogramme (cf.
    `soldes._base_imposable`), et les deux périmètres ne diffèrent donc plus que
    sur l'étalement — le seul point où ils doivent différer.

LA CADENCE EST UNE UNITÉ, PAS UNE PÉRIODE. Le dashboard mesure toujours ce que
son sélecteur affiche ; la cadence dit seulement dans quelle unité la cible est
écrite, et `unites_de_cadence` convertit l'une dans l'autre. C'est ce qui permet
de lire un objectif hebdomadaire sur un mois (« 3,8 par semaine ») sans avoir à
changer d'écran ni à faire la division soi-même.
"""
import calendar
from datetime import date as date_type
from typing import Optional

from sqlalchemy.orm import Session

# Imports ABSOLUS vers le noyau : ce module n'est pas un sous-paquet de `app`,
# il est chargé par chemin de fichier (cf. extensions/README.md).
from app import models
from app.constants import (
    JOURS_SEMAINE,
    MESURES_OBJECTIF_CUMULATIVES,
    CadenceObjectif,
    MesureObjectif,
    Sens,
    SensObjectif,
    Statut,
    TypeOperation,
)
from app.models import operation_sous_filtre
from app.services import soldes


def _tolerance(valeur: float) -> float:
    """La marge sous laquelle un objectif est tenu bien qu'il soit franchi d'un
    cheveu. Même esprit que la tolérance de l'accord des budgets : un centime,
    plus un millième de la cible au-delà — signaler moins que ça reviendrait à
    signaler l'arrondi lui-même, et à peindre en rouge un objectif tenu."""
    return max(0.01, abs(valeur) / 1000.0)


# ---------- Combien de cadences la période regardée contient ----------


def _jours_ecoules(
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


def unites_de_cadence(
    cadence: str,
    annee: int,
    mois: Optional[int],
    aujourdhui: Optional[date_type] = None,
    ecoulees: bool = True,
) -> float:
    """Combien de semaines (ou de mois) la période affichée contient.

    DEUX LECTURES POUR DEUX USAGES, d'où le drapeau : les unités ÉCOULÉES
    (défaut) servent de dénominateur à une moyenne — on ne divise que par du
    temps qui est réellement passé — et les unités de la période ENTIÈRE
    décident de la façon de lire l'objectif (cf. `mesurer`).

    UN MOIS RÉVOLU VAUT EXACTEMENT 1, une année révolue exactement 12 : c'est
    l'invariant qui permet de lire un objectif mensuel sur son mois sans que la
    cible bouge de 31/30 selon le calendrier. Un mois de 31 jours et un de 28
    valent tous les deux un mois — une cible mensuelle n'est pas un tarif
    journalier.

    UNE SEMAINE VAUT SEPT JOURS, en revanche, et la division est donc directe :
    ici on ne compte pas des semaines CALENDAIRES (celles du lundi au dimanche,
    coupées aux bords du mois par l'histogramme) mais la DURÉE que la période
    représente en semaines. Compter les blocs du calendrier aurait donné 5 ou 6
    pour un mois de 30 jours selon le jour où il commence, et fait varier une
    moyenne hebdomadaire au gré du calendrier plutôt qu'au gré des dépenses."""
    debut = date_type(annee, mois or 1, 1)
    fin = soldes.fin_de_periode(annee, mois)
    aujourdhui = (aujourdhui or date_type.today()) if ecoulees else fin
    borne, jours = _jours_ecoules(debut, fin, aujourdhui)
    if jours <= 0:
        return 0.0

    if cadence == CadenceObjectif.semaine.value:
        return jours / JOURS_SEMAINE

    # Cadence « mois » : chaque mois de la période compte pour la fraction de
    # lui-même qui est écoulée. Un mois entier vaut 1, le mois en cours vaut ses
    # jours passés sur son nombre de jours.
    total = 0.0
    for m in range(mois or 1, (mois or 12) + 1):
        premier = date_type(annee, m, 1)
        if borne < premier:
            break
        jours_du_mois = calendar.monthrange(annee, m)[1]
        comptes = borne.day if borne.month == m else jours_du_mois
        total += min(comptes, jours_du_mois) / jours_du_mois
    return total


# ---------- Le périmètre « lignes de relevé » ----------


def _retenu(operation, code: str, montant: float) -> float:
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


def _lignes_depenses(
    db: Session,
    annee: int,
    mois: Optional[int],
    monnaie_id: int,
    categorie_id: Optional[int],
    sous_filtre_id: Optional[int] = None,
) -> list[float]:
    """Le montant retenu de chaque dépense de la période, une valeur par LIGNE.

    LE MÊME PÉRIMÈTRE DE TYPES QUE L'HISTOGRAMME (classique et remboursable,
    statut réel) : ce sont les opérations qui portent une catégorie, donc les
    seules qu'un objectif par catégorie puisse compter. Mais la DATE est prise
    NUE (`filtre_date_periode`), sans l'exclusion des amorties : une dépense
    étalée sur douze mois reste une ligne du relevé, faite une fois, au mois où
    on l'a faite.

    LE MONTANT RETENU EST LE RESTE À CHARGE (cf. `_retenu`) : ce qu'une ligne
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
            soldes.filtre_date_periode(annee, mois),
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

    montants: list[float] = []
    for operation, code in requete.all():
        if categorie_id is None or operation.categorie_id == categorie_id:
            retenu = _retenu(operation, code, operation.montant)
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
            retenu = _retenu(operation, code, part)
        if retenu:
            montants.append(retenu)
    return montants


# ---------- Le périmètre « ce que le dashboard affiche » ----------


def _depenses_du_dashboard(
    db: Session, annee: int, mois: Optional[int], monnaie_id: int
) -> tuple[float, dict]:
    """Le total dépensé de la période et son détail par catégorie, tels que
    l'histogramme et le camembert les dessinent.

    EMPRUNTÉ, JAMAIS RECOPIÉ : `get_depenses_par_categorie` porte déjà
    l'amortissement étalé, le reste à charge des remboursables, les parts des
    découpes et la barre des intérêts de prêts. En refaire une version ici
    aurait donné deux calculs qui finissent par ne plus tomber d'accord —
    exactement sous les deux graphes qui affichent l'autre."""
    lignes = soldes.get_depenses_par_categorie(db, annee, mois, monnaie_id)
    par_categorie = {ligne["categorie"]: ligne["total_reel"] for ligne in lignes}
    return sum(par_categorie.values()), par_categorie


# ---------- La mesure ----------


def mesurer(
    db: Session,
    objectif: models.ObjectifKpi,
    annee: int,
    mois: Optional[int],
    aujourdhui: Optional[date_type] = None,
) -> dict:
    """Ce que l'objectif vaut sur la période affichée, et ce qu'il visait.

    DEUX FAÇONS DE LIRE UN CUMUL, ET LA PÉRIODE DÉCIDE LAQUELLE — c'est le
    cœur de ce calcul, et la première version s'y était trompée :

      - LA PÉRIODE TIENT DANS UNE CADENCE (un objectif mensuel lu sur un mois) :
        on compare le CUMUL à la cible, sans rien diviser. « 196 € sur 250 € »
        le 19 du mois est ce qu'on veut lire. La version d'avant ramenait à la
        cadence et affichait « 309 € par mois » — une EXTRAPOLATION, qui
        annonçait manqué un objectif qu'on pouvait encore tenir, et qui faisait
        dire au dashboard un chiffre qu'aucune addition de l'écran ne donne.
      - LA PÉRIODE EN CONTIENT PLUSIEURS (un objectif hebdomadaire lu sur un
        mois, un objectif mensuel lu sur une année) : il FAUT convertir, et
        c'est alors une MOYENNE sur du temps réellement écoulé — « 3,8 par
        semaine » — jamais une prévision.

    LES MESURES DE RAPPORT (montant moyen, part) ne convertissent jamais : une
    moyenne ne double pas quand la période double.

    LA CIBLE NE BOUGE JAMAIS, dans les deux cas : elle est comparée telle qu'on
    l'a écrite. Une cible proratisée aurait donné la même inégalité au même
    moment, pour un chiffre de plus à comprendre à l'écran."""
    unites = unites_de_cadence(objectif.cadence, annee, mois, aujourdhui)
    unites_periode = unites_de_cadence(
        objectif.cadence, annee, mois, aujourdhui, ecoulees=False
    )
    echantillon = 0
    # UN OBJECTIF DE PROJET COMPTE DES LIGNES, ses quatre mesures comprises, et
    # c'est la seule façon de rester d'accord avec l'écran qui le détaille.
    # `get_depenses_par_categorie` ne sait pas ce qu'est un projet : lui
    # apprendre aurait demandé de recopier l'amortissement étalé dans un second
    # calcul, pour un total que la page des projets — la seule qui le détaille
    # — ne donne pas ainsi. Un projet est un paquet de LIGNES qu'on a versées
    # dedans, et son total est leur somme.
    #
    # CE QUI DIFFÈRE DONC D'UN OBJECTIF DE CATÉGORIE : l'étalement, et lui seul.
    # Une facture annuelle payée en janvier pèse entièrement sur janvier dans un
    # projet, et un douzième par mois dans une catégorie. Le reste — reste à
    # charge des remboursables, parts des découpes — est le même des deux
    # côtés (cf. `_retenu`).
    sur_projet = objectif.sous_filtre_id is not None

    if sur_projet or objectif.mesure in (
        MesureObjectif.nombre.value,
        MesureObjectif.montant_moyen.value,
    ):
        montants = _lignes_depenses(
            db,
            annee,
            mois,
            objectif.monnaie_id,
            objectif.categorie_id,
            objectif.sous_filtre_id,
        )
        echantillon = len(montants)
        if objectif.mesure == MesureObjectif.nombre.value:
            valeur = float(echantillon)
        elif objectif.mesure == MesureObjectif.montant_total.value:
            valeur = sum(montants)
        elif objectif.mesure == MesureObjectif.montant_moyen.value:
            # Pas de dépense, pas de moyenne : zéro plutôt qu'une division par
            # zéro, et l'écran dit « aucune dépense » plutôt que « 0 € en
            # moyenne », qui se lirait comme un objectif parfaitement tenu.
            valeur = (sum(montants) / echantillon) if echantillon else 0.0
        else:
            # LA PART D'UN PROJET SE RAPPORTE AUX LIGNES, PAS AU DASHBOARD : le
            # dénominateur doit se compter comme le numérateur, sans quoi un
            # projet pourrait peser 110 % d'un total étalé plus petit que lui.
            base = sum(_lignes_depenses(db, annee, mois, objectif.monnaie_id, None))
            valeur = (sum(montants) / base * 100.0) if base else 0.0
    else:
        total, par_categorie = _depenses_du_dashboard(
            db, annee, mois, objectif.monnaie_id
        )
        nom_categorie = objectif.categorie.nom if objectif.categorie else None
        retenu = par_categorie.get(nom_categorie, 0.0) if nom_categorie else total
        if objectif.mesure == MesureObjectif.montant_total.value:
            valeur = retenu
        else:
            # La part, calculée ici et non à l'écran : deux endroits qui divisent
            # les mêmes nombres finissent par ne plus tomber d'accord à
            # l'arrondi — or c'est le même quotient que le camembert affiche.
            valeur = (retenu / total * 100.0) if total else 0.0

    # Le mode, et rien d'autre, décide de ce qu'on affiche en grand. La marge
    # d'un millième absorbe l'arithmétique des jours : un mois vaut 1,0000001
    # unité aussi souvent que 1,0.
    en_moyenne = (
        objectif.mesure in MESURES_OBJECTIF_CUMULATIVES and unites_periode > 1.001
    )
    if en_moyenne:
        # On ne divise que par du temps ÉCOULÉ : diviser par la période entière
        # ferait chuter la moyenne chaque 1er du mois, pour une raison qui n'a
        # rien à voir avec les dépenses.
        valeur_cadence = (valeur / unites) if unites else 0.0
    else:
        valeur_cadence = valeur

    # SANS CIBLE, RIEN N'EST NI TENU NI MANQUÉ (migration 0070). L'objectif ne
    # sert alors qu'à poser un chiffre sous les graphes — ce que coûte un projet
    # en cours, par exemple — et prononcer un jugement sur une règle que
    # personne ne s'est donnée serait pire que se taire. `atteint` reste vrai
    # pour que l'écran ne peigne rien en rouge ; c'est `cible is None` qui lui
    # dit de ne dessiner ni barre ni état.
    if objectif.cible is None:
        atteint = True
        avancement = 0.0
    else:
        marge = _tolerance(objectif.cible)
        if objectif.sens == SensObjectif.max.value:
            atteint = valeur_cadence <= objectif.cible + marge
        else:
            atteint = valeur_cadence >= objectif.cible - marge

        if objectif.cible:
            avancement = valeur_cadence / objectif.cible * 100.0
        else:
            # Cible à zéro : « aucune sortie ce mois-ci ». La barre est vide tant
            # qu'on n'a rien fait, pleine dès la première ligne — il n'y a pas de
            # demi-mesure à afficher.
            avancement = 0.0 if not valeur_cadence else 100.0

    return {
        "objectif_id": objectif.id,
        "nom": objectif.nom,
        "mesure": objectif.mesure,
        "cadence": objectif.cadence,
        "sens": objectif.sens,
        "cible": objectif.cible,
        "categorie_id": objectif.categorie_id,
        "categorie": objectif.categorie.nom if objectif.categorie else None,
        "sous_filtre_id": objectif.sous_filtre_id,
        "projet": objectif.sous_filtre.nom if objectif.sous_filtre else None,
        "monnaie_id": objectif.monnaie_id,
        "visible_dashboard": objectif.visible_dashboard,
        "valeur": valeur,
        "valeur_cadence": valeur_cadence,
        # « cumul » : le grand chiffre EST le total de la période, comparé à la
        # cible entière. « moyenne » : c'est une moyenne par unité de cadence.
        # L'écran en tire l'unité qu'il écrit à côté du chiffre — « ce mois-ci »
        # ne se dit pas comme « par semaine ».
        "mode": "moyenne" if en_moyenne else "cumul",
        "unites": unites,
        "unites_periode": unites_periode,
        "echantillon": echantillon,
        "atteint": atteint,
        "avancement": avancement,
    }


def mesurer_tous(
    db: Session,
    annee: int,
    mois: Optional[int],
    monnaie_id: Optional[int] = None,
    dashboard_seulement: bool = False,
    aujourdhui: Optional[date_type] = None,
) -> list[dict]:
    """Les objectifs, mesurés sur la même période — ceux d'une monnaie, ou tous.

    UNE MONNAIE À LA FOIS AU DASHBOARD, jamais de total entre elles — la règle
    de toute l'application. Il n'y affiche donc que les objectifs de l'onglet de
    monnaie qu'on regarde : les autres ne sont pas cachés, ils sont ailleurs.

    `monnaie_id = None` LES REND TOUS, chacun mesuré dans SA monnaie, et rien
    n'est additionné pour autant — ce sont des cartes, pas un total. C'est ce
    que demande la page des objectifs : on y vient voir ce qu'on s'est fixé, et
    un onglet de monnaie y cachait la moitié de la liste à celui qui a deux
    devises, sans que rien ne le dise."""
    requete = db.query(models.ObjectifKpi).order_by(
        models.ObjectifKpi.ordre, models.ObjectifKpi.id
    )
    if monnaie_id is not None:
        requete = requete.filter(models.ObjectifKpi.monnaie_id == monnaie_id)
    if dashboard_seulement:
        requete = requete.filter(models.ObjectifKpi.visible_dashboard.is_(True))
    return [
        mesurer(db, objectif, annee, mois, aujourdhui) for objectif in requete.all()
    ]
