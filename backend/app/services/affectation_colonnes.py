"""Attribuer à chaque colonne sa propriété, d'un seul coup et au mieux.

POURQUOI PAS DU PLUS SÛR AU MOINS SÛR. L'attribution gloutonne prenait la
meilleure paire (colonne, propriété), puis la suivante parmi ce qui restait :
une colonne pouvait ainsi rafler une propriété qu'une autre portait presque
aussi bien, et laisser cette autre sans rien de bon. L'affectation GLOBALE
choisit l'ensemble des paires dont la somme des scores est la plus haute —
l'algorithme hongrois, écrit ici à la main (une dizaine de colonnes, une
vingtaine de propriétés : pas besoin d'une bibliothèque de calcul de plus
dans l'exécutable).

LES CONTRAINTES :
  - une propriété par colonne, une colonne par propriété ;
  - « ne pas importer » toujours possible, pour autant de colonnes qu'il faut ;
  - un score sous le seuil (0,35) n'est pas une proposition ;
  - le montant se lit d'UNE façon : une colonne « Montant » (avec ou sans
    « Sens »), OU le couple débit/crédit au complet — jamais les deux, jamais
    une moitié de couple, jamais un sens avec le couple (ce que le serveur
    refuserait, cf. routers/import_bancaire._valider_lecture_du_montant). Les
    deux lectures sont résolues chacune, la meilleure l'emporte ;
  - LES VERROUS : ce qu'une preuve forte a établi (le test du solde) est
    posé d'office, hors de l'optimisation.

LES CHAMPS OBLIGATOIRES : date, libellé, et un montant (colonne, ou couple).
S'il en manque un, on le cherche parmi les colonnes restées sans propriété, le
seuil abaissé pour lui seul, et on le dit (`faibles`) : l'écran ne le
présentera pas comme sûr.
"""
from typing import Optional

SEUIL = 0.35
# Le seuil d'un champ obligatoire resté sans colonne : n'importe quel indice.
SEUIL_OBLIGATOIRE = 0.1
# Une colonne que ses intitulés rangent d'eux-mêmes parmi ce qui ne s'importe
# pas (solde, référence…) n'est pas prise pour combler un champ obligatoire.
_IGNORE_SUR = 1.0
_INTERDIT = 1e6

COUPLE = ("montant_debit", "montant_credit")
_LECTURES = {
    # Les propriétés qu'une lecture du montant INTERDIT.
    "montant": set(COUPLE),
    "couple": {"montant", "sens"},
}


def _hongrois(couts: list[list[float]]) -> list[int]:
    """L'affectation de coût total minimal d'une matrice n × m (n ≤ m) : pour
    chaque ligne, la colonne retenue. Algorithme hongrois en O(n²·m), sous sa
    forme à potentiels."""
    n, m = len(couts), len(couts[0]) if couts else 0
    infini = float("inf")
    u, v = [0.0] * (n + 1), [0.0] * (m + 1)
    ligne_de, chemin = [0] * (m + 1), [0] * (m + 1)
    for i in range(1, n + 1):
        ligne_de[0] = i
        j0 = 0
        minimum = [infini] * (m + 1)
        vue = [False] * (m + 1)
        while True:
            vue[j0] = True
            i0, delta, j1 = ligne_de[j0], infini, 0
            for j in range(1, m + 1):
                if vue[j]:
                    continue
                reduit = couts[i0 - 1][j - 1] - u[i0] - v[j]
                if reduit < minimum[j]:
                    minimum[j], chemin[j] = reduit, j0
                if minimum[j] < delta:
                    delta, j1 = minimum[j], j
            for j in range(m + 1):
                if vue[j]:
                    u[ligne_de[j]] += delta
                    v[j] -= delta
                else:
                    minimum[j] -= delta
            j0 = j1
            if ligne_de[j0] == 0:
                break
        while j0:
            j1 = chemin[j0]
            ligne_de[j0] = ligne_de[j1]
            j0 = j1
    affectation = [-1] * n
    for j in range(1, m + 1):
        if ligne_de[j]:
            affectation[ligne_de[j] - 1] = j - 1
    return affectation


def _resoudre(
    scores: dict[int, dict[str, float]], index: list[int], proprietes: list[str], seuil: float
) -> tuple[dict[int, str], float]:
    """La meilleure affectation des colonnes `index` aux `proprietes`, chaque
    colonne pouvant aussi rester sans propriété ; (affectation, somme)."""
    if not index:
        return {}, 0.0
    n = len(index)
    couts = []
    for i in index:
        s = scores.get(i, {})
        ligne = [-s[p] if s.get(p, 0.0) >= seuil else _INTERDIT for p in proprietes]
        # Autant de places « ne pas importer » que de colonnes, chacune au
        # score que la colonne donne à « ne pas importer ».
        ligne += [-s.get("", 0.0)] * n
        couts.append(ligne)
    choix = _hongrois(couts)
    affectation, total = {}, 0.0
    for i, j in zip(index, choix):
        if j < len(proprietes):
            affectation[i] = proprietes[j]
            total += scores[i][proprietes[j]]
        else:
            affectation[i] = ""
            total += scores.get(i, {}).get("", 0.0)
    return affectation, total


def _lecture_valide(affectation: dict[int, str], lecture: str) -> bool:
    if lecture != "couple":
        return True
    pris = set(affectation.values())
    # Le couple entier, ou pas de couple du tout.
    return len(pris & set(COUPLE)) in (0, 2)


def affecter(
    scores: dict[int, dict[str, float]],
    verrous: Optional[dict[int, str]] = None,
    seuil: float = SEUIL,
) -> tuple[dict[int, str], list[str]]:
    """({colonne: propriété ou ""}, champs obligatoires comblés à seuil
    abaissé). `verrous` : {colonne: propriété} posés d'office."""
    verrous = dict(verrous or {})
    imposees = {p for p in verrous.values() if p}
    libres = sorted(i for i in scores if i not in verrous)
    toutes = sorted({p for s in scores.values() for p in s if p} - imposees)

    lectures = [
        lecture for lecture, interdites in _LECTURES.items()
        if not (imposees & interdites)
    ]
    meilleure, meilleur_total = None, None
    for lecture in lectures:
        proprietes = [p for p in toutes if p not in _LECTURES[lecture]]
        affectation, total = _resoudre(scores, libres, proprietes, seuil)
        complete = {**verrous, **affectation}
        if not _lecture_valide(complete, lecture):
            continue
        if meilleur_total is None or total > meilleur_total:
            meilleure, meilleur_total = complete, total
    retenue = meilleure if meilleure is not None else {**verrous, **{i: "" for i in libres}}

    # LES CHAMPS OBLIGATOIRES qui manquent : la meilleure colonne restée sans
    # propriété, le seuil abaissé pour ce champ seul.
    faibles = []
    prises = set(retenue.values())
    manquants = [p for p in ("date", "nature") if p not in prises]
    if "montant" not in prises and not set(COUPLE) <= prises:
        manquants.append("montant")
    for propriete in manquants:
        candidates = [
            i for i, p in retenue.items()
            if p == "" and i not in verrous
            and scores.get(i, {}).get("", 0.0) < _IGNORE_SUR
            and scores.get(i, {}).get(propriete, 0.0) >= SEUIL_OBLIGATOIRE
        ]
        if propriete == "montant" and set(COUPLE) & prises:
            continue  # une moitié de couple : l'écran le dira, rien à combler
        if candidates:
            choisie = max(candidates, key=lambda i: scores[i][propriete])
            retenue[choisie] = propriete
            faibles.append(propriete)
    return retenue, faibles
