"""Le contrôle avant import : ce que l'import FERAIT, chiffré, avant d'écrire
quoi que ce soit.

POURQUOI. Un aperçu ligne à ligne ne se relit pas sur trois cents lignes. Un
signe inversé, une décimale mal lue, une colonne prise pour une autre passent
inaperçus jusqu'à ce que les soldes soient faux — après l'import. Quelques
chiffres le disent d'un coup d'œil : combien de lignes, combien rejetées et
pourquoi, quelle période, combien sort et combien entre.

LE CONTRÔLE DU SOLDE, surtout. Quand le relevé porte une colonne de solde, on
recalcule ses variations AVEC LA CONFIGURATION RETENUE (les montants tels que
l'import les lira, signes compris) et on les compare au solde écrit par la
banque. Tout écart désigne une erreur de lecture : signe, décimale, colonne.
La colonne de solde se reconnaît sans la configuration — par le test du solde
(services/controle_solde), à défaut par son intitulé — pour qu'une
configuration fausse ne puisse pas se valider elle-même.

RIEN N'EST ÉCRIT : tout part de l'aperçu (import_bancaire.previsualiser), qui
n'écrit rien non plus. Les montants sont comptés en centimes entiers.
"""
from datetime import date, timedelta
from typing import Optional

from .controle_solde import MOMENTS, ORDRES, SEUIL_VERIFIE, controler_solde
from .entetes import groupe_principal
from .lecture_montants import centimes, format_nombres

# Les lignes citées par motif ou par écart : de quoi aller voir, pas un
# inventaire.
_LIGNES_CITEES = 10
_ECARTS_CITES = 5
# UNE DATE HORS PLAGE : dans le futur, ou à plus d'un an de la date médiane du
# relevé (une année saisie de travers, un jour et un mois inversés).
_ECART_DATE = timedelta(days=366)
# UN MONTANT ABERRANT : vingt fois au-delà du 90e centile des montants du
# fichier, et au moins mille euros. Il faut dix lignes pour en juger.
_FACTEUR_ABERRANT = 20
_PLANCHER_ABERRANT = 100_000
_LIGNES_POUR_ABERRANTS = 10


def _cents(valeur: Optional[float]) -> Optional[int]:
    return None if valeur is None else int(round(valeur * 100))


def _vide(cellule) -> bool:
    return cellule is None or str(cellule).strip() == ""


def _motifs(lignes) -> list[dict]:
    """Les lignes rejetées, regroupées par motif (une ligne peut en avoir
    plusieurs : « date illisible, montant illisible »)."""
    par_motif: dict[str, list[int]] = {}
    for ligne in lignes:
        if not ligne.erreur:
            continue
        for motif in (m.strip() for m in ligne.erreur.split(", ")):
            if motif:
                par_motif.setdefault(motif, []).append(ligne.ligne)
    return sorted(
        (
            {"motif": motif, "nombre": len(numeros), "lignes": numeros[:_LIGNES_CITEES]}
            for motif, numeros in par_motif.items()
        ),
        key=lambda m: -m["nombre"],
    )


def _colonne_de_solde(rangees, entetes, colonnes_lues, separateur_decimal) -> tuple[Optional[int], Optional[str]]:
    """(colonne 1-based, ordre) du solde du relevé, trouvée SANS la
    configuration : le test du solde d'abord, l'intitulé ensuite."""
    resultat = controler_solde(rangees, separateur_decimal)
    if resultat and resultat.colonne not in colonnes_lues:
        return resultat.colonne, resultat.ordre
    for j, entete in enumerate(entetes, start=1):
        if j not in colonnes_lues and groupe_principal(entete) == "solde":
            return j, None
    return None, None


def _controle_du_solde(lignes, rangees, entetes, colonnes_lues, separateur_decimal) -> Optional[dict]:
    colonne, ordre_connu = _colonne_de_solde(rangees, entetes, colonnes_lues, separateur_decimal)
    if colonne is None:
        return None
    cellules = [r[colonne - 1] if colonne <= len(r) else None for r in rangees]
    decimal, milliers = (separateur_decimal, None) if separateur_decimal else format_nombres(cellules)
    soldes = [None if _vide(c) else centimes(c, decimal, milliers) for c in cellules]
    # Les montants TELS QUE L'IMPORT LES LIRA : une ligne rejetée ne compte
    # pour rien, et c'est justement ce qui fera apparaître l'écart.
    nets = [_cents(l.montant_signe) or 0 for l in lignes]
    numeros = [l.ligne for l in lignes]

    meilleur = None
    for ordre in ([ordre_connu] if ordre_connu else ORDRES):
        sens = 1 if ordre == "croissant" else -1
        s, n, num = soldes[::sens], nets[::sens], numeros[::sens]
        for moment in MOMENTS:
            renseignes = [i for i, b in enumerate(s) if b is not None]
            intervalles, ecarts = 0, []
            for p, q in zip(renseignes, renseignes[1:]):
                delta = s[q] - s[p]
                somme = sum(n[p + 1:q + 1]) if moment == "apres" else sum(n[p:q])
                intervalles += 1
                if abs(delta - somme) > 1:
                    ecarts.append({
                        "ligne_debut": min(num[p], num[q]),
                        "ligne_fin": max(num[p], num[q]),
                        "variation_du_solde": delta,
                        "montants_lus": somme,
                    })
            if not intervalles:
                continue
            taux = 1 - len(ecarts) / intervalles
            cle = (taux, moment == "apres")
            if meilleur is None or cle > meilleur[0]:
                meilleur = (cle, ordre, moment, intervalles, ecarts)
    if meilleur is None:
        return None
    (taux, _), ordre, moment, intervalles, ecarts = meilleur
    return {
        "colonne": colonne,
        "entete": entetes[colonne - 1] if colonne <= len(entetes) else "",
        "ordre": ordre,
        "moment": moment,
        "taux": round(taux, 3),
        "intervalles": intervalles,
        "nombre_ecarts": len(ecarts),
        "ecarts": ecarts[:_ECARTS_CITES],
        "statut": "ok" if taux >= SEUIL_VERIFIE else "ecart",
    }


def _anomalies(lignes, brutes, lignes_entete, aujourdhui: date) -> dict:
    dates = sorted(l.date for l in lignes if l.date is not None)
    hors_plage = []
    if dates:
        mediane = dates[len(dates) // 2]
        hors_plage = [
            l.ligne for l in lignes
            if l.date is not None and (l.date > aujourdhui or abs(l.date - mediane) > _ECART_DATE)
        ]
    montants = sorted(abs(c) for c in (_cents(l.montant_signe) for l in lignes) if c)
    aberrants = []
    if len(montants) >= _LIGNES_POUR_ABERRANTS:
        centile = montants[int(0.9 * (len(montants) - 1))]
        seuil = max(_FACTEUR_ABERRANT * centile, _PLANCHER_ABERRANT)
        aberrants = [l.ligne for l in lignes if abs(_cents(l.montant_signe) or 0) > seuil]
    # Les lignes vides AU MILIEU des opérations : celles d'avant et d'après
    # ne sont que de la mise en page.
    numeros = [l.ligne for l in lignes]
    vides = 0
    if numeros:
        vides = sum(
            1 for i in range(max(min(numeros), lignes_entete + 1), max(numeros))
            if i - 1 < len(brutes) and all(_vide(c) for c in brutes[i - 1])
        )
    return {
        "dates_hors_plage": hors_plage[:_LIGNES_CITEES],
        "nombre_dates_hors_plage": len(hors_plage),
        "montants_aberrants": aberrants[:_LIGNES_CITEES],
        "nombre_montants_aberrants": len(aberrants),
        "lignes_vides": vides,
    }


def controler_import(
    lignes,
    brutes: list[tuple],
    colonnes: list[dict],
    lignes_entete: int,
    separateur_decimal: Optional[str] = None,
    aujourdhui: Optional[date] = None,
) -> dict:
    """Le contrôle avant import d'un aperçu. `lignes` : les ImportLigne de
    l'aperçu ; `brutes` : le fichier tel qu'il est lu (toutes ses lignes) ;
    `colonnes` et `lignes_entete` : la configuration avec laquelle l'aperçu a
    été construit."""
    aujourdhui = aujourdhui or date.today()
    montants = [_cents(l.montant_signe) for l in lignes if l.montant_signe is not None]
    debits = -sum(m for m in montants if m < 0)
    credits = sum(m for m in montants if m > 0)
    dates = [l.date for l in lignes if l.date is not None]
    rangees = [brutes[l.ligne - 1] if 0 < l.ligne <= len(brutes) else () for l in lignes]
    entetes = (
        ["" if _vide(c) else str(c).strip() for c in brutes[lignes_entete - 1]]
        if 1 <= lignes_entete <= len(brutes)
        else []
    )
    colonnes_lues = {c["index"] for c in colonnes if c.get("propriete")}
    return {
        "lignes_lues": len(lignes),
        "lignes_rejetees": sum(1 for l in lignes if l.erreur),
        "motifs_rejet": _motifs(lignes),
        "doublons": sum(1 for l in lignes if l.doublon_de is not None),
        "date_debut": min(dates) if dates else None,
        "date_fin": max(dates) if dates else None,
        # En centimes : l'écran les met en forme.
        "total_debits": debits,
        "total_credits": credits,
        "solde_net": credits - debits,
        "controle_solde": _controle_du_solde(lignes, rangees, entetes, colonnes_lues, separateur_decimal),
        "anomalies": _anomalies(lignes, brutes, lignes_entete, aujourdhui),
    }
