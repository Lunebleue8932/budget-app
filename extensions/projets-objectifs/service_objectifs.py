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
    LIGNES DE RELEVÉ : une opération pour ce qu'elle COÛTE. Une dépense amortie
    n'est comptée que dans les fenêtres que son étalement recoupe — pour la
    fraction de ses jours qui y tombe quand il s'agit d'une valeur, pour UNE ligne
    quand on compte (cf. `soldes.part_amortie_fenetre`). On retient aussi le RESTE
    À CHARGE d'une dépense remboursable : les 60 € d'un repas dont on récupère 45
    ne pèsent pas 60 € au budget, et une moyenne qui les compterait entiers dirait
    ce qu'on a AVANCÉ, pas ce qu'on a dépensé. C'est la même règle que
    l'histogramme (cf. `soldes._base_imposable`).

LA CADENCE EST UNE UNITÉ, PAS UNE PÉRIODE. Le dashboard mesure toujours ce que
son sélecteur affiche ; la cadence dit seulement dans quelle unité la cible est
écrite, et `unites_de_cadence` convertit l'une dans l'autre. C'est ce qui permet
de lire un objectif hebdomadaire sur un mois (« 3,8 par semaine ») sans avoir à
changer d'écran ni à faire la division soi-même.
"""
from datetime import date as date_type
from datetime import timedelta
from typing import Optional

from sqlalchemy import and_, func, or_
from sqlalchemy.orm import Session

# Imports ABSOLUS vers le noyau : ce module n'est pas un sous-paquet de `app`,
# il est chargé par chemin de fichier (cf. extensions/README.md).
from app import models
from app.constants import (
    MESURES_OBJECTIF_CUMULATIVES,
    CadenceObjectif,
    MesureObjectif,
    Sens,
    SensObjectif,
    Statut,
    TypeOperation,
)
from app.services import soldes
# Remontés dans le noyau (services/lignes_depenses.py) pour que « Analyse du
# budget » les lise aussi sans importer cette extension. Ré-exportés sous leurs
# anciens noms : rien d'autre dans ce module, ni dans ses tests, n'a changé.
from app.services.lignes_depenses import (
    lignes_detaillees as _lignes_detaillees,
    montant_retenu as _retenu,
    unites_fenetre,
)


def _tolerance(valeur: float) -> float:
    """La marge sous laquelle un objectif est tenu bien qu'il soit franchi d'un
    cheveu. Même esprit que la tolérance de l'accord des budgets : un centime,
    plus un millième de la cible au-delà — signaler moins que ça reviendrait à
    signaler l'arrondi lui-même, et à peindre en rouge un objectif tenu."""
    return max(0.01, abs(valeur) / 1000.0)


# ---------- Combien de cadences la période regardée contient ----------


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
    return unites_fenetre(cadence, debut, fin, aujourdhui, ecoulees)


# ---------- Le périmètre « lignes de relevé » ----------


# ---------- Les filtres (migration 0073) ----------


def bornes_periode(annee: int, mois: Optional[int]) -> tuple[date_type, date_type]:
    return date_type(annee, mois or 1, 1), soldes.fin_de_periode(annee, mois)


def _lignes_depenses(
    db: Session,
    debut: date_type,
    fin: date_type,
    monnaie_id: int,
    categorie_id: Optional[int],
    sous_filtre_id: Optional[int] = None,
    filtres: Optional[list] = None,
) -> list[float]:
    """Le montant retenu de chaque dépense de la période, une valeur par LIGNE
    (cf. `_lignes_detaillees`, qui rend aussi l'opération de chaque ligne)."""
    return [
        retenu
        for _operation, retenu in _lignes_detaillees(
            db, debut, fin, monnaie_id, categorie_id, sous_filtre_id, filtres
        )
    ]


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


def semaine_de_lecture(
    annee: int, mois: Optional[int], aujourdhui: Optional[date_type] = None
) -> tuple[date_type, date_type]:
    """LA SEMAINE (du lundi au dimanche) sur laquelle lire un objectif
    hebdomadaire : celle d'aujourd'hui si la période affichée la contient, sinon
    la dernière semaine d'une période passée, ou la première d'une période à
    venir. `mois` absent veut dire l'année entière, comme partout.

    UNE VRAIE SEMAINE, qui peut déborder sur le mois voisin : « cette semaine »
    ne s'arrête pas au 30 parce que le sélecteur affiche septembre."""
    debut, fin = bornes_periode(annee, mois)
    aujourdhui = aujourdhui or date_type.today()
    reference = min(max(aujourdhui, debut), fin)
    lundi = reference - timedelta(days=reference.weekday())
    return lundi, lundi + timedelta(days=6)


def _jugement(objectif: models.ObjectifKpi, valeur: float) -> tuple[bool, float]:
    """Tenu ou non, et où en est la barre — pour une valeur DÉJÀ ramenée à ce
    qui se compare à la cible.

    SANS CIBLE, RIEN N'EST NI TENU NI MANQUÉ (migration 0070). L'objectif ne
    sert alors qu'à poser un chiffre sous les graphes, et prononcer un jugement
    sur une règle que personne ne s'est donnée serait pire que se taire.
    `atteint` reste vrai pour que l'écran ne peigne rien en rouge ; c'est
    `cible is None` qui lui dit de ne dessiner ni barre ni état."""
    if objectif.cible is None:
        return True, 0.0
    marge = _tolerance(objectif.cible)
    if objectif.sens == SensObjectif.max.value:
        atteint = valeur <= objectif.cible + marge
    else:
        atteint = valeur >= objectif.cible - marge
    if objectif.cible:
        avancement = valeur / objectif.cible * 100.0
    else:
        # Cible à zéro : « aucune sortie ce mois-ci ». La barre est vide tant
        # qu'on n'a rien fait, pleine dès la première ligne — il n'y a pas de
        # demi-mesure à afficher.
        avancement = 0.0 if not valeur else 100.0
    return atteint, avancement


def _mesure_sur_lignes(
    db: Session, objectif: models.ObjectifKpi, debut: date_type, fin: date_type
) -> tuple[float, int]:
    """La mesure de l'objectif comptée sur des LIGNES de relevé entre deux
    dates, ses filtres appliqués : la valeur, et le nombre de lignes retenues."""
    montants = _lignes_depenses(
        db, debut, fin, objectif.monnaie_id, objectif.categorie_id,
        objectif.sous_filtre_id, objectif.filtres or [],
    )
    echantillon = len(montants)
    if objectif.mesure == MesureObjectif.nombre.value:
        return float(echantillon), echantillon
    if objectif.mesure == MesureObjectif.montant_total.value:
        return sum(montants), echantillon
    if objectif.mesure == MesureObjectif.montant_moyen.value:
        # Pas de dépense, pas de moyenne : zéro plutôt qu'une division par zéro,
        # et l'écran dit « aucune dépense » plutôt que « 0 € en moyenne », qui
        # se lirait comme un objectif parfaitement tenu.
        return ((sum(montants) / echantillon) if echantillon else 0.0), echantillon
    # LA PART SE RAPPORTE À TOUTES LES LIGNES DE LA FENÊTRE, sans filtre ni
    # périmètre : « mes dépenses du week-end pèsent 40 % » divise par tout ce
    # qu'on a dépensé, pas par ce que les filtres ont déjà retenu — sans quoi
    # une part filtrée vaudrait toujours 100 %. C'est aussi ce que faisait déjà
    # la part d'un projet : un dénominateur compté comme son numérateur.
    base = sum(_lignes_depenses(db, debut, fin, objectif.monnaie_id, None))
    return ((sum(montants) / base * 100.0) if base else 0.0), echantillon


# ---------- Les deux vues d'un objectif ----------
#
# UN OBJECTIF SE LIT DE DEUX FAÇONS, TOUJOURS LES DEUX, à chaque niveau du
# dashboard :
#
#   - L'ACTUELLE : la période PROPRE de l'objectif — la semaine pour un objectif
#     hebdomadaire, le mois pour un objectif mensuel. C'est « où j'en suis » : un
#     cumul, comparé à la cible entière, jamais une extrapolation.
#   - LA MOYENNÉE : une fenêtre plus large, ramenée à la cadence — « quel rythme
#     j'ai tenu ». Elle dépend du niveau du dashboard ET de la cadence :
#
#         objectif semaine : dashboard mois → le mois    dashboard année → l'année
#         objectif mois    : dashboard mois → l'année    dashboard année → TOUT
#                                                        l'historique
#
#     Une moyenne n'a de sens que sur plusieurs unités : la semaine se moyenne sur
#     un mois puis une année, le mois sur une année puis tout l'historique.
#
# LES MESURES DE RAPPORT (montant moyen, part) n'ont pas de cadence : elles
# prennent celle du mois, et leur « moyennée » est la même mesure sur la fenêtre
# plus large — un rapport ne se divise pas par une durée.


def _cadence_de_lecture(objectif: models.ObjectifKpi) -> str:
    """La cadence qui décide des fenêtres : celle de l'objectif quand sa mesure
    cumule, le mois pour un rapport (cf. ci-dessus)."""
    if objectif.mesure in MESURES_OBJECTIF_CUMULATIVES:
        return objectif.cadence
    return CadenceObjectif.mois.value


def premier_jour_de_l_historique(
    db: Session, monnaie_id: int, aujourdhui: date_type
) -> date_type:
    """Le premier du mois de la plus ancienne dépense de la monnaie — où commence
    « tout l'historique ». Sans aucune dépense, le mois en cours : une fenêtre
    vide plutôt qu'une fenêtre qui remonte à l'an zéro."""
    premiere = (
        db.query(func.min(models.Operation.date))
        .filter(
            models.Operation.monnaie_id == monnaie_id,
            models.Operation.sens == Sens.depense,
        )
        .scalar()
    )
    if premiere is None or premiere > aujourdhui:
        premiere = aujourdhui
    return date_type(premiere.year, premiere.month, 1)


def _fenetre(kind: str, debut: date_type, fin: date_type, annee=None, mois=None) -> dict:
    return {"kind": kind, "debut": debut, "fin": fin, "annee": annee, "mois": mois}


def fenetre_tout(db: Session, monnaie_id: int, aujourdhui: date_type) -> dict:
    """La fenêtre « tout l'historique » : du premier mois où l'on a dépensé à la
    fin de l'année en cours (cf. `fenetres_de_lecture`)."""
    return _fenetre(
        "tout",
        premier_jour_de_l_historique(db, monnaie_id, aujourdhui),
        date_type(aujourdhui.year, 12, 31),
    )


def _fenetres_tout(
    db: Session, objectif: models.ObjectifKpi, cadence: str, aujourdhui: date_type
) -> dict:
    """Les deux fenêtres quand le dashboard est sur « Tout » : l'actuelle est la
    période propre de l'objectif AUJOURD'HUI, la moyennée est tout l'historique."""
    if cadence == CadenceObjectif.semaine.value:
        lundi = aujourdhui - timedelta(days=aujourdhui.weekday())
        actuelle = _fenetre("semaine", lundi, lundi + timedelta(days=6))
    else:
        d, f = bornes_periode(aujourdhui.year, aujourdhui.month)
        actuelle = _fenetre("mois", d, f, aujourdhui.year, aujourdhui.month)
    return {
        "actuelle": actuelle,
        "moyennee": fenetre_tout(db, objectif.monnaie_id, aujourdhui),
    }


def fenetres_de_lecture(
    db: Session,
    objectif: models.ObjectifKpi,
    annee: int,
    mois: Optional[int],
    aujourdhui: Optional[date_type] = None,
    tout: bool = False,
) -> dict:
    """Les deux fenêtres d'un objectif pour un niveau du dashboard : `actuelle`
    et `moyennee` (cf. le commentaire ci-dessus). `mois` absent est la vue année.

    `tout` EST LE NIVEAU « TOUT L'HISTORIQUE » du dashboard : la moyennée est
    alors toujours tout l'historique, quelle que soit la cadence — on ne peut pas
    moyenner sur plus large. L'actuelle reste la période propre de l'objectif, lue
    au jour d'aujourd'hui (la semaine en cours, ou le mois en cours).

    TOUT L'HISTORIQUE S'ARRÊTE À LA FIN DE L'ANNÉE EN COURS, et non à aujourd'hui :
    c'est ce que fait la vue année du dashboard (elle compte aussi ce qui est
    étalé sur les mois à venir), et la fenêtre doit tomber d'accord avec lui. Ce
    sont les UNITÉS qui ne comptent que le temps écoulé."""
    aujourdhui = aujourdhui or date_type.today()
    cadence = _cadence_de_lecture(objectif)
    if tout:
        return _fenetres_tout(db, objectif, cadence, aujourdhui)
    debut_p, fin_p = bornes_periode(annee, mois)

    if cadence == CadenceObjectif.semaine.value:
        lundi, dimanche = semaine_de_lecture(annee, mois, aujourdhui)
        actuelle = _fenetre("semaine", lundi, dimanche)
        moyennee = (
            _fenetre("mois", debut_p, fin_p, annee, mois)
            if mois is not None
            else _fenetre("annee", debut_p, fin_p, annee, None)
        )
        return {"actuelle": actuelle, "moyennee": moyennee}

    # Cadence « mois ». Sur la vue année, le mois de lecture est celui
    # d'aujourd'hui si l'année le contient, sinon son dernier (ou son premier).
    if mois is None:
        mois_lecture = min(max(aujourdhui, debut_p), fin_p).month
    else:
        mois_lecture = mois
    d, f = bornes_periode(annee, mois_lecture)
    actuelle = _fenetre("mois", d, f, annee, mois_lecture)
    if mois is not None:
        d, f = bornes_periode(annee, None)
        moyennee = _fenetre("annee", d, f, annee, None)
    else:
        premier = premier_jour_de_l_historique(db, objectif.monnaie_id, aujourdhui)
        moyennee = _fenetre(
            "tout", premier, date_type(max(aujourdhui.year, annee), 12, 31)
        )
    return {"actuelle": actuelle, "moyennee": moyennee}


def _semantique(objectif: models.ObjectifKpi, fenetre: dict) -> str:
    """« budget » ou « lignes » : ce que la fenêtre COMPTE (cf. l'en-tête du
    module).

    LE BUDGET, c'est ce que l'histogramme du dashboard affiche — étalement,
    reste à charge, parts de découpe — et il n'existe que pour un mois, une année
    ou tout l'historique d'un objectif SANS filtre ni projet, qui mesure un
    montant total ou une part. TOUT LE RESTE COMPTE DES LIGNES de relevé : un
    nombre, un montant moyen, un objectif filtré ou de projet, et toute semaine
    (le calcul du dashboard ne sait pas lire une semaine qui déborde d'un mois)."""
    sur_lignes = objectif.sous_filtre_id is not None or bool(objectif.filtres)
    if (
        fenetre["kind"] == "semaine"
        or sur_lignes
        or objectif.mesure in (MesureObjectif.nombre.value, MesureObjectif.montant_moyen.value)
    ):
        return "lignes"
    return "budget"


def _depenses_budget(db: Session, fenetre: dict, monnaie_id: int) -> tuple[float, dict]:
    """Le total dépensé d'une fenêtre « budget » et son détail par catégorie. Une
    année ou un mois sont ceux du dashboard, tels quels ; TOUT L'HISTORIQUE est
    la somme des années qu'il couvre."""
    if fenetre["kind"] != "tout":
        return _depenses_du_dashboard(db, fenetre["annee"], fenetre["mois"], monnaie_id)
    total = 0.0
    par_categorie: dict = {}
    for annee in range(fenetre["debut"].year, fenetre["fin"].year + 1):
        sous_total, detail = _depenses_du_dashboard(db, annee, None, monnaie_id)
        total += sous_total
        for nom, montant in detail.items():
            par_categorie[nom] = par_categorie.get(nom, 0.0) + montant
    return total, par_categorie


def _jours_du_filtre(objectif: models.ObjectifKpi) -> Optional[str]:
    """La valeur du filtre « jours » de l'objectif (« semaine » ou « weekend »), ou None."""
    for filtre in objectif.filtres or []:
        if filtre.get("champ") == "jours" and filtre.get("valeur") in ("semaine", "weekend"):
            return filtre["valeur"]
    return None


def mesurer_fenetre(
    db: Session,
    objectif: models.ObjectifKpi,
    fenetre: dict,
    aujourdhui: Optional[date_type] = None,
) -> dict:
    """Ce que l'objectif vaut sur UNE fenêtre, et ce qu'il visait.

    DEUX FAÇONS DE LIRE UN CUMUL, ET LA FENÊTRE DÉCIDE LAQUELLE — c'est le cœur de
    ce calcul, et la première version s'y était trompée :

      - LA FENÊTRE TIENT DANS UNE CADENCE (un objectif mensuel lu sur son mois, un
        objectif hebdomadaire sur sa semaine) : on compare le CUMUL à la cible,
        sans rien diviser. « 196 € sur 250 € » le 19 du mois est ce qu'on veut
        lire. La version d'avant ramenait à la cadence et affichait « 309 € par
        mois » — une EXTRAPOLATION, qui annonçait manqué un objectif qu'on pouvait
        encore tenir ;
      - LA FENÊTRE EN CONTIENT PLUSIEURS (un objectif hebdomadaire lu sur un mois,
        un objectif mensuel lu sur une année) : il FAUT convertir, et c'est alors
        une MOYENNE sur du temps réellement écoulé — « 3,8 par semaine » — jamais
        une prévision.

    LES MESURES DE RAPPORT (montant moyen, part) ne convertissent jamais : une
    moyenne ne double pas quand la période double.

    LA CIBLE NE BOUGE JAMAIS, dans les deux cas : elle est comparée telle qu'on
    l'a écrite. Une cible proratisée aurait donné la même inégalité au même
    moment, pour un chiffre de plus à comprendre à l'écran."""
    cadence = _cadence_de_lecture(objectif)
    # LE FILTRE « JOURS » CHANGE L'UNITÉ DE TEMPS : un objectif « dépenses du week-end »
    # se moyenne sur les week-ends écoulés, pas sur les semaines de calendrier (cf.
    # lignes_depenses.unites_fenetre).
    jours_filtre = _jours_du_filtre(objectif)
    unites = unites_fenetre(
        cadence, fenetre["debut"], fenetre["fin"], aujourdhui, jours_filtre=jours_filtre
    )
    unites_periode = unites_fenetre(
        cadence, fenetre["debut"], fenetre["fin"], aujourdhui, ecoulees=False,
        jours_filtre=jours_filtre,
    )
    semantique = _semantique(objectif, fenetre)
    echantillon = 0

    if semantique == "lignes":
        valeur, echantillon = _mesure_sur_lignes(
            db, objectif, fenetre["debut"], fenetre["fin"]
        )
    else:
        total, par_categorie = _depenses_budget(db, fenetre, objectif.monnaie_id)
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

    atteint, avancement = _jugement(objectif, valeur_cadence)
    return {
        "kind": fenetre["kind"],
        "debut": fenetre["debut"].isoformat(),
        "fin": fenetre["fin"].isoformat(),
        "semantique": semantique,
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


def mesurer(
    db: Session,
    objectif: models.ObjectifKpi,
    annee: int,
    mois: Optional[int],
    aujourdhui: Optional[date_type] = None,
    tout: bool = False,
) -> dict:
    """Ce que l'objectif vaut sur la période affichée, et ce qu'il visait.

    `tout` : le dashboard est sur « Tout » — la période du sélecteur est alors
    tout l'historique (cf. `fenetre_tout`), et `annee` / `mois` n'ont plus rien à
    dire.

    LES CHAMPS DE TÊTE (`valeur`, `mode`, `atteint`…) SONT LA PÉRIODE DU
    SÉLECTEUR, telle que le dashboard la montre : le mois ou l'année, mesurée
    d'après ce que l'objectif compte. Les DEUX VUES — `actuelle` et `moyennee`,
    cf. `fenetres_de_lecture` — sont rendues à côté, avec leurs bornes : c'est
    ce que l'écran bascule, et ce que la page d'un objectif détaille."""
    if tout:
        fenetre_periode = fenetre_tout(db, objectif.monnaie_id, aujourdhui or date_type.today())
    else:
        debut, fin = bornes_periode(annee, mois)
        fenetre_periode = _fenetre(
            "mois" if mois is not None else "annee", debut, fin, annee, mois
        )
    periode = mesurer_fenetre(db, objectif, fenetre_periode, aujourdhui)
    fenetres = fenetres_de_lecture(db, objectif, annee, mois, aujourdhui, tout)
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
        "valeur": periode["valeur"],
        "valeur_cadence": periode["valeur_cadence"],
        "mode": periode["mode"],
        "unites": periode["unites"],
        "unites_periode": periode["unites_periode"],
        "echantillon": periode["echantillon"],
        "atteint": periode["atteint"],
        "avancement": periode["avancement"],
        "filtres": list(objectif.filtres or []),
        "actuelle": mesurer_fenetre(db, objectif, fenetres["actuelle"], aujourdhui),
        "moyennee": mesurer_fenetre(db, objectif, fenetres["moyennee"], aujourdhui),
    }


# ---------- Les opérations qui entrent en compte ----------


def _mois_couverts(operation, debut: date_type, fin: date_type) -> int:
    """Combien de mois d'amortissement de `operation` tombent entre `debut` et
    `fin` (0 : elle n'y pèse pas). Miroir de `soldes.part_amortie`, pour une
    fenêtre quelconque de mois entiers."""
    premier = max(
        soldes._index_mois(operation.amortissement_debut), soldes._index_mois(debut)
    )
    dernier = min(
        soldes._index_mois(operation.amortissement_fin), soldes._index_mois(fin)
    )
    return max(0, dernier - premier + 1)


def _lignes_budget(
    db: Session, objectif: models.ObjectifKpi, debut: date_type, fin: date_type
) -> list[tuple]:
    """Les opérations qui font le BUDGET d'une fenêtre — ce que l'histogramme du
    dashboard compte — avec la part de chacune : `(opération, retenu, part)`.

    LE MÊME PÉRIMÈTRE QUE `get_depenses_par_categorie`, et c'est tout l'enjeu :
    la somme des `retenu` vaut la valeur de la carte, au centime. Une dépense
    datée dans la fenêtre y compte entière ; une dépense AMORTIE y compte pour la
    fraction de ses mois qui y tombent — elle y est, même payée trois mois plus
    tôt, et n'y est pas si son étalement commence après. Le reste à charge d'une
    remboursable et les parts d'une découpe suivent la règle de partout (cf.
    `_retenu`).

    CE QUI N'Y EST PAS : la barre « Intérêts de prêts » du dashboard, qui n'est
    pas une opération de dépense (cf. soldes._barre_interets_prets) — un
    objectif sur toutes les dépenses la compte, sa liste ne peut pas la montrer."""
    requete = (
        db.query(models.Operation, models.TypeOperationDB.code)
        .join(
            models.TypeOperationDB,
            models.Operation.type_id == models.TypeOperationDB.id,
        )
        .filter(
            models.Operation.monnaie_id == objectif.monnaie_id,
            models.Operation.statut == Statut.reel,
            models.Operation.sens == Sens.depense,
            models.TypeOperationDB.code.in_(
                [TypeOperation.classique.value, TypeOperation.remboursable.value]
            ),
            or_(
                and_(
                    models.Operation.amorti.is_(False),
                    models.Operation.date >= debut,
                    models.Operation.date <= fin,
                ),
                and_(
                    models.Operation.amorti.is_(True),
                    models.Operation.amortissement_debut <= fin,
                    models.Operation.amortissement_fin >= debut,
                ),
            ),
        )
    )
    lignes: list[tuple] = []
    for operation, code in requete.all():
        part = 1.0
        if operation.amorti:
            nb_mois = operation.amortissement_nb_mois
            couverts = _mois_couverts(operation, debut, fin)
            if not nb_mois or not couverts:
                continue
            part = couverts / nb_mois
        categorie_id = objectif.categorie_id
        if categorie_id is None:
            # Toutes les dépenses… sauf celles d'une catégorie d'ENTRÉE, que
            # l'histogramme ne dessine pas (cf. get_depenses_par_categorie).
            if operation.categorie is not None and operation.categorie.est_entree:
                continue
            brut = operation.montant
        elif operation.categorie_id == categorie_id:
            brut = operation.montant
        else:
            brut = sum(
                p.montant for p in operation.decoupes if p.categorie_id == categorie_id
            )
            if not brut:
                continue
        retenu = _retenu(operation, code, brut) * part
        if retenu:
            lignes.append((operation, retenu, part))
    return lignes


def operations_contribuantes(
    db: Session,
    objectif: models.ObjectifKpi,
    fenetre: dict,
) -> list[dict]:
    """Toutes les opérations qui entrent dans la mesure de l'objectif sur cette
    fenêtre, chacune avec ce qu'elle y apporte (`retenu`).

    LA LISTE SUIT LA MESURE (cf. `_semantique`) : des lignes de relevé quand
    l'objectif en compte, le budget du dashboard quand il en lit les barres. La
    somme de `retenu` est donc la valeur de la carte — pas plus, pas moins — sauf
    pour un RAPPORT (montant moyen, part), dont la carte divise cette somme.

    LES PLUS GROSSES D'ABORD : c'est ce qui explique un chiffre, et la page se lit
    de haut en bas jusqu'à ce qu'on ait compris d'où il vient."""
    if _semantique(objectif, fenetre) == "lignes":
        paires = [
            (operation, retenu, 1.0)
            for operation, retenu in _lignes_detaillees(
                db,
                fenetre["debut"],
                fenetre["fin"],
                objectif.monnaie_id,
                objectif.categorie_id,
                objectif.sous_filtre_id,
                objectif.filtres or [],
            )
        ]
    else:
        paires = _lignes_budget(db, objectif, fenetre["debut"], fenetre["fin"])

    lignes = [
        {
            "operation_id": operation.id,
            "date": operation.date.isoformat(),
            "nature": operation.nature,
            "compte_id": operation.compte_id,
            "categorie_id": operation.categorie_id,
            "monnaie_id": operation.monnaie_id,
            "montant": operation.montant,
            "retenu": retenu,
            "decoupee": bool(operation.decoupes),
            "amorti": bool(operation.amorti),
            "amortissement_nb_mois": operation.amortissement_nb_mois,
        }
        for operation, retenu, _part in paires
    ]
    lignes.sort(key=lambda ligne: (-ligne["retenu"], ligne["date"]))
    return lignes


def mesurer_tous(
    db: Session,
    annee: int,
    mois: Optional[int],
    monnaie_id: Optional[int] = None,
    dashboard_seulement: bool = False,
    aujourdhui: Optional[date_type] = None,
    tout: bool = False,
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
        mesurer(db, objectif, annee, mois, aujourdhui, tout) for objectif in requete.all()
    ]
