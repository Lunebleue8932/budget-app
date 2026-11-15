"""L'ÉVOLUTION DU PORTEFEUILLE dans le temps : ce que valaient les titres détenus, jour après jour.

Rien n'est stocké de ce qui est détenu (cf. services/placements) : la quantité d'un titre à une date se
déroule depuis les mouvements, et sa valeur se lit dans l'historique des cours (`cours_titre`,
migration 0102). La valorisation d'un jour est donc `quantité détenue ce jour-là × cours connu ce
jour-là`, sommée sur les titres.

QUEL COURS POUR UN JOUR SANS COTATION ? Le dernier connu AVANT lui. Trois sources, par ordre de
confiance : l'historique (`cours_titre` : saisi, relu en ligne, ou lu sur la page de cotation), puis les
PRIX DES MOUVEMENTS (un achat à 82 € le 3 mars dit ce que valait le titre ce jour-là — c'est ainsi qu'un
portefeuille sans aucun historique a quand même une courbe), puis le cours actuel du titre pour
aujourd'hui. Avant son premier cours connu un titre n'a pas de valeur : mais il n'est alors pas détenu
non plus, son premier mouvement portant déjà un prix.

PAR MONNAIE, jamais de total entre elles (deux monnaies ne s'additionnent pas ; cf. services/placements).

LES AXES. `total` (une seule courbe), `compte` (le compte de détention), `titre` (une courbe par titre,
tous comptes confondus), `enveloppe`, `classe`, `zone`,
`secteur` : les quatre derniers découpent un titre comme les camemberts de la vue d'ensemble
(`exposition.parts_du_titre`) — un ETF « Monde » à 1 000 € pèse 650 € sur « États-Unis » et 150 € sur
« Europe », et ce qu'on ne connaît pas tombe dans « Non renseigné ». RIEN N'EST RENORMALISÉ.
"""
import bisect
import math
from datetime import date, timedelta
from typing import Optional

from sqlalchemy import func
from sqlalchemy.orm import Session

from .. import crud, models
from ..constants import SensTitre
from . import exposition, placements

AXES = ("total", "compte", "titre", "enveloppe", "classe", "zone", "secteur")

# Combien de points au plus : une courbe de dix ans au jour le jour n'est pas plus lisible qu'à trois
# jours près, et coûterait autant de replis des mouvements.
POINTS_MAX = 200

NOM_NON_RENSEIGNE = "Non renseigné"


def _cours_connus(db: Session, titre_ids: set[int], mouvements: list, aujourdhui: date) -> dict:
    """`{titre_id: ([dates triées], [valeurs])}` — l'historique, complété par les prix des mouvements
    (là où l'historique est muet) et par le cours actuel (aujourd'hui, s'il n'a pas de ligne)."""
    par_titre: dict[int, dict[date, float]] = {titre_id: {} for titre_id in titre_ids}
    # Du moins fiable au plus fiable : chaque couche écrase la précédente.
    for titre in db.query(models.TitrePossede).filter(models.TitrePossede.id.in_(titre_ids)):
        if titre.valeur and titre.valeur > 0:
            par_titre[titre.id][aujourdhui] = titre.valeur
    for mouvement in mouvements:
        if mouvement.prix_unitaire and mouvement.prix_unitaire > 0:
            par_titre[mouvement.titre_id][mouvement.operation.date] = mouvement.prix_unitaire
    for ligne in db.query(models.CoursTitre).filter(models.CoursTitre.titre_id.in_(titre_ids)):
        par_titre[ligne.titre_id][ligne.date] = ligne.valeur
    resultat = {}
    for titre_id, jours in par_titre.items():
        tries = sorted(jours)
        resultat[titre_id] = (tries, [jours[j] for j in tries])
    return resultat


def _cours_au(serie: tuple, jour: date) -> Optional[float]:
    dates, valeurs = serie
    rang = bisect.bisect_right(dates, jour) - 1
    return valeurs[rang] if rang >= 0 else None


def _grille(debut: date, fin: date) -> list[date]:
    """Les dates tracées : tous les jours tant que ça tient dans `POINTS_MAX`, sinon un pas régulier.
    Le dernier point est toujours `fin` (aujourd'hui) : c'est lui qui doit retomber sur la valorisation
    affichée partout ailleurs."""
    etendue = max((fin - debut).days, 0)
    pas = max(1, math.ceil(etendue / POINTS_MAX))
    jours = [debut + timedelta(days=k) for k in range(0, etendue + 1, pas)]
    if jours[-1] != fin:
        jours.append(fin)
    return jours


def _etiquette(axe: str, compte_nom: str, etiquette) -> tuple:
    """`(clé, nom)` de la série à laquelle une part appartient."""
    if axe == "compte":
        return (compte_nom, compte_nom)
    if etiquette is None:
        return (None, NOM_NON_RENSEIGNE)
    return (etiquette.id, etiquette.nom)


def evolution(
    db: Session,
    monnaie_id: int,
    axe: str = "total",
    compte_ids: Optional[list[int]] = None,
    aujourdhui: Optional[date] = None,
) -> dict:
    """La valorisation du portefeuille à chaque date, découpée selon `axe`, dans UNE monnaie.

    `{"monnaie_id", "axe", "dates": [iso], "total": [valeurs], "series": [{"cle", "nom", "valeurs"}]}` —
    les séries triées de la plus lourde (aujourd'hui) à la plus légère ; `total` est la somme des séries.
    Un portefeuille vide rend des listes vides."""
    if axe not in AXES:
        raise ValueError(f"axe inconnu : {axe}")
    aujourdhui = aujourdhui or date.today()
    vide = {"monnaie_id": monnaie_id, "axe": axe, "dates": [], "total": [], "series": []}

    mouvements = [
        m
        for m in placements.get_mouvements(db)
        if m.titre.monnaie_id == monnaie_id
        and m.operation.date <= aujourdhui
        and (compte_ids is None or m.operation.compte_id in compte_ids)
    ]
    if not mouvements:
        return vide

    titre_ids = {m.titre_id for m in mouvements}
    cours = _cours_connus(db, titre_ids, mouvements, aujourdhui)
    # L'HISTORIQUE EXISTE-T-IL ? Il faut au moins DEUX cours rangés en base pour un titre (`cours_titre`) : avec
    # un seul, la courbe ne serait qu'un trait plat tiré entre le prix d'un achat et ce cours — de quoi ne rien
    # dire. Les prix des mouvements ne comptent pas ici : ils servent à tracer, pas à prouver qu'on a un historique.
    nb_cours = {
        titre_id: nombre
        for titre_id, nombre in db.query(models.CoursTitre.titre_id, func.count(models.CoursTitre.id))
        .filter(models.CoursTitre.titre_id.in_(titre_ids))
        .group_by(models.CoursTitre.titre_id)
    }
    titres_de_serie: dict = {}
    comptes = {c.id: c.nom for c in placements.get_comptes_placement(db)}

    # Les parts de chaque titre sur l'axe, calculées UNE fois : elles ne dépendent pas de la date.
    tous = crud.get_titres(db, inclure_archivees=True)
    par_isin = {exposition.normaliser_isin(t.code_isin): t for t in tous if t.code_isin}
    par_id = {t.id: t for t in tous}
    parts_par_titre = {
        titre_id: exposition.parts_du_titre(par_id.get(titre_id), axe, par_isin, par_id)
        if axe not in ("total", "compte", "titre")
        else [(None, 1.0)]
        for titre_id in titre_ids
    }

    jours = _grille(min(m.operation.date for m in mouvements), aujourdhui)
    quantites: dict[tuple[int, int], float] = {}
    # Le COÛT des titres encore détenus, par (compte, titre) — le « montant investi » : prix de revient moyen
    # pondéré, comme `placements._replier_mouvements` (une vente sort le coût dans la même proportion que la
    # quantité). C'est le dénominateur du rendement affiché par élément : valeur / montant investi - 1.
    couts: dict[tuple[int, int], float] = {}
    suivant = 0  # prochain mouvement à appliquer (ils sont triés par date)
    series: dict = {}  # clé -> {"nom", "valeurs": [..]}
    total = []
    total_investi = []

    def cle_nom(compte_id, titre_id, etiquette):
        cle, nom = _etiquette(axe, comptes.get(compte_id, str(compte_id)), etiquette)
        if axe == "total":
            return "total", "Portefeuille"
        if axe == "titre":
            return titre_id, par_id[titre_id].nom_affiche
        return cle, nom

    for rang, jour in enumerate(jours):
        # Les quantités AVANT les mouvements de cette étape : ce sont elles qui subissent la variation de
        # cours entre la veille et ce jour (un achat du jour n'a rien gagné, une vente du jour a gagné jusqu'à
        # la veille). C'est le cœur de la PERFORMANCE : elle ne compte que l'évolution du cours des titres,
        # jamais l'argent ajouté ou retiré par un achat ou une vente.
        avant = dict(quantites)
        while suivant < len(mouvements) and mouvements[suivant].operation.date <= jour:
            m = mouvements[suivant]
            cle = (m.operation.compte_id, m.titre_id)
            delta = m.quantite if m.sens == SensTitre.achat else -m.quantite
            if m.sens == SensTitre.achat:
                couts[cle] = couts.get(cle, 0.0) + m.quantite * m.prix_unitaire
            else:
                detenue = quantites.get(cle, 0.0)
                if detenue > placements.EPSILON_QUANTITE:
                    couts[cle] = couts.get(cle, 0.0) * (1.0 - min(1.0, m.quantite / detenue))
            quantites[cle] = max(quantites.get(cle, 0.0) + delta, 0.0)
            if quantites[cle] <= placements.EPSILON_QUANTITE:
                couts[cle] = 0.0
            suivant += 1
        du_jour: dict = {}
        for (compte_id, titre_id), quantite in quantites.items():
            if quantite <= placements.EPSILON_QUANTITE:
                continue
            prix = _cours_au(cours[titre_id], jour)
            if prix is None:
                continue
            valeur = quantite * prix
            investi = couts.get((compte_id, titre_id), 0.0)
            for etiquette, part in parts_par_titre[titre_id]:
                cle, nom = cle_nom(compte_id, titre_id, etiquette)
                ligne_jour = du_jour.setdefault(cle, [nom, 0.0, 0.0])
                titres_de_serie.setdefault(cle, set()).add(titre_id)
                ligne_jour[1] += valeur * part
                ligne_jour[2] += investi * part
        gains_jour: dict = {}
        if rang > 0:
            for (compte_id, titre_id), quantite in avant.items():
                if quantite <= placements.EPSILON_QUANTITE:
                    continue
                avant_prix = _cours_au(cours[titre_id], jours[rang - 1])
                apres_prix = _cours_au(cours[titre_id], jour)
                if avant_prix is None or apres_prix is None:
                    continue
                for etiquette, part in parts_par_titre[titre_id]:
                    cle, nom = cle_nom(compte_id, titre_id, etiquette)
                    du_jour.setdefault(cle, [nom, 0.0, 0.0])
                    gains_jour[cle] = gains_jour.get(cle, 0.0) + quantite * (apres_prix - avant_prix) * part
        for cle, (nom, valeur, investi) in du_jour.items():
            ligne = series.setdefault(
                cle,
                {
                    "cle": cle,
                    "nom": nom,
                    "valeurs": [0.0] * len(jours),
                    "investis": [0.0] * len(jours),
                    "gains": [0.0] * len(jours),
                },
            )
            ligne["valeurs"][rang] = valeur
            ligne["investis"][rang] = investi
            ligne["gains"][rang] = gains_jour.get(cle, 0.0)
        total.append(sum(v for _, v, _ in du_jour.values()))
        total_investi.append(sum(i for _, _, i in du_jour.values()))

    for ligne in series.values():
        ligne["gain_cumule"], ligne["rendement_cumule"] = _performance(ligne["valeurs"], ligne.pop("gains"))
        ligne["rendement_investi"] = _rendement_sur_investi(ligne["valeurs"], ligne["investis"])
        ligne["historique"] = any(nb_cours.get(t, 0) >= 2 for t in titres_de_serie.get(ligne["cle"], ()))
    classees = sorted(series.values(), key=lambda s: s["valeurs"][-1], reverse=True)
    gains_total = [sum(ligne_gain) for ligne_gain in zip(*[_deriver(s["gain_cumule"]) for s in classees])] if classees else []
    gain_cumule, rendement_cumule = _performance(total, gains_total)
    return {
        "gain_cumule": gain_cumule,
        "rendement_cumule": rendement_cumule,
        "monnaie_id": monnaie_id,
        "axe": axe,
        "dates": [j.isoformat() for j in jours],
        "total": total,
        # Au moins un titre a un historique de cours (deux valeurs en base ou plus) : sinon l'écran n'a pas de
        # courbe à tracer et le dit.
        "historique": any(nb_cours.get(t, 0) >= 2 for t in titre_ids),
        "investi": total_investi,
        "rendement_investi": _rendement_sur_investi(total, total_investi),
        "series": classees,
    }


def _rendement_sur_investi(valeurs: list[float], investis: list[float]) -> list[Optional[float]]:
    """`valeur(t) / montant investi(t) - 1` à chaque date (une FRACTION : 0,12 = +12 %), ou None quand rien
    n'est investi à cette date (pas de dénominateur). C'est la plus-value latente en pourcentage — celle des
    KPI de l'onglet Portefeuille — et non un rendement pondéré par le temps (cf. `_performance`)."""
    return [(v / i - 1.0) if i > 1e-9 else None for v, i in zip(valeurs, investis)]


def _deriver(cumul: list[float]) -> list[float]:
    """Les gains de chaque étape, retrouvés depuis leur cumul."""
    return [valeur - (cumul[i - 1] if i else 0.0) for i, valeur in enumerate(cumul)]


def _performance(valeurs: list[float], gains: list[float]) -> tuple[list[float], list[float]]:
    """`(gain cumulé en monnaie, rendement cumulé en fraction)` à chaque date, PAR LES COURS SEULS.

    Le gain d'une étape est `quantité détenue avant l'étape × variation du cours` : l'argent ajouté ou retiré
    par un achat ou une vente n'y entre jamais. Le rendement chaîne les rendements d'étape (gain / valeur de la
    veille) — un rendement pondéré par le temps : acheter beaucoup juste avant une hausse ne le gonfle pas, vendre
    juste avant une baisse ne le dégonfle pas. Une série qui n'existait pas la veille n'a pas de base : 0 %."""
    cumul, rendement = [], []
    gain_total, facteur = 0.0, 1.0
    for i, gain in enumerate(gains):
        gain_total += gain
        base = valeurs[i - 1] if i else 0.0
        if base > 1e-9:
            facteur *= 1.0 + gain / base
        cumul.append(gain_total)
        rendement.append(facteur - 1.0)
    return cumul, rendement


def monnaies_detenues(db: Session) -> list[int]:
    """Les monnaies dans lesquelles un titre est ou a été détenu : une courbe chacune."""
    return sorted({m.titre.monnaie_id for m in placements.get_mouvements(db)})
