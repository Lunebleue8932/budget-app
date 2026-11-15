"""Ce que l'on dépense EN MOYENNE, d'après les dépenses passées.

NÉ DANS L'EXTENSION « BUDGET » (prévision avancée du solde prévisionnel), REMONTÉ AU NOYAU
parce que le dashboard en a besoin pour sa propre courbe : il ne peut pas dépendre d'une
extension. `extensions/analyse-budget/service_solde_previsionnel.py` le ré-exporte sous ses
anciens noms — une seule définition de « combien dépense-t-on par jour », donc deux courbes
(dashboard et page Budget) qui ne peuvent pas diverger.
"""
import math
from datetime import date as date_type
from datetime import timedelta
from typing import Optional

from sqlalchemy import func
from sqlalchemy.orm import Session

from .. import models
from ..constants import Sens, Statut
from . import lignes_depenses, soldes

# Fenêtre d'historique par défaut de la prévision avancée, en semaines. Douze :
# un trimestre, assez pour lisser un mois exceptionnel sans traîner une habitude
# abandonnée depuis un an.
FENETRE_SEMAINES_DEFAUT = 12

_comptes_courants = soldes.comptes_courants


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


def _ecart_type(valeurs: list) -> float:
    """L'écart-type ÉCHANTILLON (n − 1) ; zéro avec moins de deux valeurs."""
    n = len(valeurs)
    if n < 2:
        return 0.0
    moyenne = sum(valeurs) / n
    return math.sqrt(sum((v - moyenne) ** 2 for v in valeurs) / (n - 1))


def _ecarts_types(
    retenues: list, debut: date_type, fin: date_type, jours: int
) -> tuple[float, float]:
    """L'écart-type de la dépense PAR JOUR et PAR SEMAINE sur la fenêtre.

    UN JOUR SANS DÉPENSE VAUT ZÉRO, il compte : sans lui l'écart-type d'un budget fait de grosses
    dépenses rares serait celui des seules grosses dépenses, et la plage de la prévision serait trop
    étroite. Les semaines sont des blocs de sept jours depuis le début de la fenêtre ; on n'en compte
    que les COMPLÈTES, et avec moins de deux on tire l'écart de la semaine de celui du jour
    (√7 × l'écart quotidien, des jours supposés indépendants)."""
    par_jour = [0.0] * jours
    for operation, retenu in retenues:
        rang = (min(max(operation.date, debut), fin) - debut).days
        par_jour[rang] += retenu
    ecart_jour = _ecart_type(par_jour)
    semaines = [sum(par_jour[i : i + 7]) for i in range(0, jours - jours % 7, 7)]
    ecart_semaine = _ecart_type(semaines) if len(semaines) >= 2 else ecart_jour * math.sqrt(7)
    return ecart_jour, ecart_semaine


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
        "ecart_type_jour": 0.0,
        "ecart_type_semaine": 0.0,
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
    ecart_jour, ecart_semaine = _ecarts_types(retenues, debut, aujourdhui, jours)
    return {
        "par_jour": total / jours,
        "par_semaine": total / jours * 7,
        "ecart_type_jour": ecart_jour,
        "ecart_type_semaine": ecart_semaine,
        "total": total,
        "jours": jours,
        "nombre_operations": len(retenues),
        "debut": debut,
        "fin": aujourdhui,
        "operations": retenues,
    }


# ---------- Ce que le dashboard en tire : la dépense cumulée, jour après jour ----------

# La clé sous laquelle la page Budget range les réglages de sa prévision avancée : le dashboard les
# LIT, sans jamais les écrire (cf. extensions/analyse-budget/solde-previsionnel.js, AB_SP_CLE).
CLE_PREFERENCE_PREVISION = "analyse-budget.solde-previsionnel"


def _reglages_previsions(db: Session) -> dict:
    """Fenêtre, cadence et exclusions choisies sur la page Budget — ou les valeurs par défaut quand
    l'extension n'a jamais rien rangé (ou n'existe pas : la clé est alors absente)."""
    from .. import crud  # tardif : crud importe soldes

    rangement = crud.get_preference_interface(db, CLE_PREFERENCE_PREVISION)
    rangement = rangement if isinstance(rangement, dict) else {}
    fenetre = rangement.get("fenetre", str(FENETRE_SEMAINES_DEFAUT))
    try:
        semaines = None if fenetre == "tout" else int(fenetre)
    except (TypeError, ValueError):
        semaines = FENETRE_SEMAINES_DEFAUT

    def entiers(valeurs):
        return {int(v) for v in valeurs or [] if str(v).lstrip("-").isdigit()}

    return {
        "fenetre_semaines": semaines,
        "cadence": "semaine" if rangement.get("cadence") == "semaine" else "jour",
        "exclure_categories": entiers(rangement.get("categories")),
        "exclure_types": {str(v) for v in rangement.get("types") or []},
        "exclure_operations": entiers(rangement.get("operations")),
    }


def estimation_depenses(
    db: Session,
    coefficients: dict,
    aujourdhui: date_type,
    horizon: date_type,
) -> dict:
    """Ce qu'on aura dépensé EN MOYENNE depuis ce soir, à la fin de chaque jour jusqu'à `horizon`, et
    la PLAGE autour de cette moyenne.

    LE MÊME CALCUL QUE LA PRÉVISION AVANCÉE de la page Budget (même moyenne, mêmes réglages) :
    chaque jour, ou chaque dimanche en cadence « semaine » (un escalier plutôt qu'une pente).
    Plusieurs monnaies : chacune moyennée à part puis ramenée par son coefficient.

    LA PLAGE S'ÉLARGIT AVEC LE TEMPS : après k périodes (jours, ou semaines en cadence « semaine »), la
    dépense cumulée s'écarte de sa moyenne de ± σ·√k — des périodes supposées indépendantes, donc des
    variances qui s'ajoutent (et, d'une monnaie à l'autre, des variances pondérées par le carré du
    coefficient). `ecart[jour]` est ce ± σ·√k, en monnaie convertie.

    Rend `cumul` et `ecart` (par jour), puis `moyenne_*` et `ecart_type_*` par jour et par semaine, la
    cadence et la longueur de la fenêtre d'historique."""
    reglages = _reglages_previsions(db)
    par_jour = par_semaine = variance_jour = variance_semaine = 0.0
    jours_fenetre = 0
    for monnaie_id, coefficient in coefficients.items():
        comptes = _comptes_courants(db, monnaie_id)
        if not comptes:
            continue
        moyenne = moyenne_depenses(
            db,
            monnaie_id,
            aujourdhui,
            reglages["fenetre_semaines"],
            reglages["exclure_categories"],
            reglages["exclure_types"],
            reglages["exclure_operations"],
            comptes,
        )
        par_jour += coefficient * moyenne["par_jour"]
        par_semaine += coefficient * moyenne["par_semaine"]
        variance_jour += (coefficient * moyenne["ecart_type_jour"]) ** 2
        variance_semaine += (coefficient * moyenne["ecart_type_semaine"]) ** 2
        jours_fenetre = max(jours_fenetre, moyenne["jours"])
    ecart_jour = math.sqrt(variance_jour)
    ecart_semaine = math.sqrt(variance_semaine)

    en_semaines = reglages["cadence"] == "semaine"
    cumul = 0.0
    periodes = 0
    resultat = {}
    ecarts = {}
    jour = aujourdhui
    while jour <= horizon:
        if jour > aujourdhui:
            if en_semaines:
                if jour.weekday() == 6:
                    cumul += par_semaine
                    periodes += 1
            else:
                cumul += par_jour
                periodes += 1
        resultat[jour] = cumul
        ecarts[jour] = (ecart_semaine if en_semaines else ecart_jour) * math.sqrt(periodes)
        jour += timedelta(days=1)
    return {
        "cumul": resultat,
        "ecart": ecarts,
        "cadence": "semaine" if en_semaines else "jour",
        "moyenne_jour": par_jour,
        "moyenne_semaine": par_semaine,
        "ecart_type_jour": ecart_jour,
        "ecart_type_semaine": ecart_semaine,
        "jours": jours_fenetre,
    }


def depense_cumulee_par_jour(
    db: Session,
    coefficients: dict,
    aujourdhui: date_type,
    horizon: date_type,
) -> dict:
    """La seule dépense cumulée de `estimation_depenses` (l'ancienne forme, gardée pour ses lecteurs)."""
    return estimation_depenses(db, coefficients, aujourdhui, horizon)["cumul"]
