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
import math
from collections import defaultdict
from datetime import date as date_type
from datetime import timedelta
from typing import Optional

from sqlalchemy import func
from sqlalchemy.orm import Session

from app import models
from app.constants import Sens, Statut
from app.services import lignes_depenses, soldes
from app.services.moyenne_depenses import (  # noqa: F401  (ré-exports : anciens noms)
    FENETRE_SEMAINES_DEFAUT,
    _premier_jour_depense,
    moyenne_depenses,
)

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

# L'horizon par défaut, en jours.
HORIZON_JOURS_DEFAUT = 90

CLE_PREFERENCE = "analyse-budget.solde-previsionnel"


# LES BRIQUES DE LA TRAJECTOIRE VIVENT AU NOYAU (cf. services/soldes.py, « Le solde des
# comptes courants, jour après jour »). Elles sont nées ici ; le dashboard en a eu besoin
# pour son « reste », et il ne peut pas dépendre d'une extension. Les noms d'origine restent,
# en simples renvois : une seule définition de « ce qui bouge le solde, et quel jour », donc
# une courbe et un « reste » qui ne peuvent pas diverger.
_signe = soldes.signe_du_sens
_comptes_courants = soldes.comptes_courants
_solde_de_depart = soldes.solde_de_depart_courant
_jour_pose = soldes.jour_pose
_a_poser = soldes.operations_a_poser
_ouverture = soldes.solde_ouverture_courant
_restes_dus = soldes.restes_dus_prets_par_date


def _ligne(operation, noms: dict[int, str]) -> dict:
    return {
        "id": operation.id,
        "date": operation.date,
        "nature": operation.nature,
        "montant": operation.montant,
        "compte_nom": noms.get(operation.compte_id, ""),
    }


# ---------- La courbe ----------


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

    # LA PLAGE autour de la prévision : après k périodes (jours, ou semaines en cadence « semaine »),
    # la dépense cumulée s'écarte de sa moyenne de ± σ·√k (cf. moyenne_depenses.estimation_depenses —
    # le même calcul que sur le dashboard). Seulement sur le futur de la prévision avancée.
    sigma = moyenne["ecart_type_semaine"] if cadence == "semaine" else moyenne["ecart_type_jour"]
    periodes = 0

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
                    periodes += 1
            else:
                cumul_moyenne += moyenne["par_jour"]
                periodes += 1
        points.append(
            {
                "date": jour,
                "solde": solde - cumul_moyenne,
                "passe": not futur,
                "ecart": sigma * math.sqrt(periodes) if avancee and futur and sigma > 0 else None,
            }
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


# ---------- Le reste à vivre, et de quoi planifier ----------


def _premier_jour_sous_zero(points: list, marge=lambda p: 0.0) -> Optional[date_type]:
    return next((p["date"] for p in points if p["solde"] - marge(p) < 0), None)


def planification(reste: dict, courbe: dict) -> dict:
    """Ce que le dashboard ne montre pas et qu'il faut pour PLANIFIER : où la prévision se pose, où elle
    se tient dans sa plage, et à quelle date elle passerait sous zéro.

    Toutes les valeurs viennent de `courbe` (la prévision et sa plage ± σ·√k) et de `reste` (le rythme
    sûr) : rien n'est recalculé, ce sont des lectures de ce que le dashboard a déjà."""
    aujourdhui = courbe["aujourdhui"]
    prevision = [p for p in courbe["prevision"] if p["date"] >= aujourdhui]
    estimation = courbe.get("estimation") or {}
    moyenne_jour = estimation.get("moyenne_jour", 0.0)
    resultat = {
        "moyenne_jour": moyenne_jour,
        "ecart_type_jour": estimation.get("ecart_type_jour", 0.0),
        "cadence": estimation.get("cadence", "jour"),
        "jours_historique": estimation.get("jours", 0),
        # Combien le rythme sûr laisse de marge sur la dépense moyenne : positif = on dépense, en moyenne,
        # moins que le rythme sûr ; négatif = on le dépasse.
        "marge_rythme": reste["rythme_sur"] - moyenne_jour,
        "solde_fin": None,
        "solde_fin_bas": None,
        "solde_fin_haut": None,
        "point_bas_prevision": None,
        "point_bas_pessimiste": None,
        "sous_zero_prevision": None,
        "sous_zero_pessimiste": None,
    }
    if not prevision:
        return resultat

    def ecart(p):
        return p.get("ecart") or 0.0

    fin = prevision[-1]
    resultat["solde_fin"] = fin["solde"]
    resultat["solde_fin_bas"] = fin["solde"] - ecart(fin)
    resultat["solde_fin_haut"] = fin["solde"] + ecart(fin)
    bas = min(prevision, key=lambda p: p["solde"])
    resultat["point_bas_prevision"] = {"date": bas["date"], "montant": bas["solde"]}
    pessimiste = min(prevision, key=lambda p: p["solde"] - ecart(p))
    resultat["point_bas_pessimiste"] = {
        "date": pessimiste["date"],
        "montant": pessimiste["solde"] - ecart(pessimiste),
    }
    resultat["sous_zero_prevision"] = _premier_jour_sous_zero(prevision)
    resultat["sous_zero_pessimiste"] = _premier_jour_sous_zero(prevision, ecart)
    return resultat


def reste_a_vivre(
    db: Session,
    monnaie_id: int,
    vue: str = "mois",
    aujourdhui: Optional[date_type] = None,
) -> dict:
    """Le « reste pour finir le mois » du dashboard, pour UNE monnaie, avec sa courbe (réel, prévision,
    rythme sûr, plage) et la planification. Les mêmes briques que le dashboard (services/soldes) : la
    page Prévisions en est le prolongement, elle ne peut pas annoncer un autre chiffre."""
    aujourdhui = aujourdhui or date_type.today()
    coefficients = {monnaie_id: 1.0}
    jour_salaire = soldes.lire_decoupage_salaire(db)
    reste = soldes.reste_periode(
        db,
        coefficients,
        soldes.horizon_reste(vue, aujourdhui, jour_salaire),
        aujourdhui,
        debut=soldes.debut_reste(vue, aujourdhui, jour_salaire),
    )
    courbe = soldes.courbe_reste(db, coefficients, vue, aujourdhui)
    return {
        "monnaie_id": monnaie_id,
        "vue": vue,
        "reste": reste,
        "courbe": courbe,
        "planification": planification(reste, courbe),
    }
