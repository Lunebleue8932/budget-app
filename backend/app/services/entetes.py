"""La forme comparable d'un intitulé de colonne, et ce qu'il veut dire.

POURQUOI UNE SEULE NORMALISATION. La reconnaissance des presets compare les
intitulés d'un fichier à ceux qu'un preset a déjà vus ; la détection des
colonnes les compare au dictionnaire. Si les deux normalisaient chacune à sa
façon, « Montant (EUR) » serait reconnu ici et pas là. Tout intitulé passe
donc par `normaliser_entete` avant d'être comparé à quoi que ce soit.

CE QU'ELLE FAIT : minuscules, sans accents, symboles monétaires écrits en
toutes lettres, toute ponctuation (parenthèses comprises) remplacée par une
espace, espaces multiples réduites. Les mots restent séparés — c'est ce qui
permet de tokeniser (« montant eur » → montant, eur), là où
import_bancaire.normaliser_libelle, faite pour le vocabulaire du sens et de
l'état, colle tout.

LE DICTIONNAIRE (app/synonymes_entetes.json, un fichier de données à enrichir
sans toucher au code) range les intitulés connus par GROUPE : un groupe par
sens de colonne, chacun désignant une propriété d'import, ou aucune (solde,
référence, date de valeur…). `scores_groupes` en tire un score GRADUÉ :

  - 1    : l'intitulé est l'un des `exacts` du groupe ;
  - 0,9  : l'un de ses `synonymes` ;
  - 0,6  : il CONTIENT l'un de ses `mots_cles`, sans aucun de ses `exclus_si` ;
  - 0    : sinon.

RÈGLE DE DISTINCTION : un intitulé reconnu en entier (≥ 0,9) par un groupe ne
compte plus, par ses seuls mots-clés, pour les autres. « Date valeur » est une
date de valeur, pas une date d'opération qui contiendrait « date » ;
« Libellé complémentaire » est un complément, pas un libellé.
"""
import json
import re
import sys
import unicodedata
from functools import lru_cache
from pathlib import Path

_SYMBOLES = {"€": " eur ", "$": " usd ", "£": " gbp "}
_NON_ALPHANUMERIQUE = re.compile(r"[^0-9a-z]+")

# Ce qui ne dit rien du sens d'une colonne : les petits mots (« date DE
# l'opération ») et les unités (« montant EN EUROS »).
_MOTS_VIDES = {
    "de", "d", "du", "des", "la", "le", "l", "les", "en", "a", "au", "aux", "et",
    "of", "the", "in", "da", "do", "dos", "das", "e",
}
_UNITES = {"eur", "euro", "euros", "usd", "gbp", "brl", "chf"}

SCORE_EXACT = 1.0
SCORE_SYNONYME = 0.9
SCORE_MOT_CLE = 0.6

# Données lues à l'exécution, jamais importées : en application packagée, elles
# sont sous sys._MEIPASS (cf. desktop/budget_app.spec, destination "app").
if getattr(sys, "frozen", False):
    _FICHIER_SYNONYMES = Path(sys._MEIPASS) / "app" / "synonymes_entetes.json"
else:
    _FICHIER_SYNONYMES = Path(__file__).resolve().parent.parent / "synonymes_entetes.json"


def normaliser_entete(texte) -> str:
    """« Montant (EUR) », « MONTANT – EUR », « montant €» → « montant eur »."""
    if texte is None:
        return ""
    brut = str(texte)
    for symbole, mot in _SYMBOLES.items():
        brut = brut.replace(symbole, mot)
    sans_accents = "".join(
        c for c in unicodedata.normalize("NFKD", brut) if unicodedata.category(c) != "Mn"
    )
    return _NON_ALPHANUMERIQUE.sub(" ", sans_accents.casefold()).strip()


def mots_entete(texte) -> list[str]:
    return normaliser_entete(texte).split()


def _formes(texte) -> set[str]:
    """Les écritures comparables d'un intitulé : sans ses unités, avec et sans
    ses petits mots. Les deux, parce qu'un petit mot porte parfois tout le
    sens : « D/C » sans son « d » ne serait plus qu'un « c »."""
    mots = [m for m in mots_entete(texte) if m not in _UNITES]
    pleins = [m for m in mots if m not in _MOTS_VIDES]
    return {" ".join(f) for f in (mots, pleins) if f}


def _contient(mots: list[str], cle: list[str]) -> bool:
    """`cle` figure dans `mots`, mots consécutifs et entiers : « date » est dans
    « date operation », pas dans « dateur »."""
    n = len(cle)
    return any(mots[i:i + n] == cle for i in range(len(mots) - n + 1))


@lru_cache(maxsize=1)
def dictionnaire() -> dict:
    """Les groupes du dictionnaire, leurs listes déjà mises sous forme
    comparable. Un fichier manquant ou abîmé donne un dictionnaire vide : la
    détection retombe alors sur la forme des cellules, elle ne plante pas."""
    try:
        brut = json.loads(_FICHIER_SYNONYMES.read_text(encoding="utf-8"))["groupes"]
    except (OSError, ValueError, KeyError):
        return {}
    groupes = {}
    for nom, groupe in brut.items():
        groupes[nom] = {
            "propriete": groupe.get("propriete", ""),
            "exacts": set().union(*(_formes(e) for e in groupe.get("exacts", []))),
            "synonymes": set().union(*(_formes(e) for e in groupe.get("synonymes", []))),
            "mots_cles": [mots_entete(m) for m in groupe.get("mots_cles", []) if mots_entete(m)],
            "exclus_si": {m for e in groupe.get("exclus_si", []) for m in mots_entete(e)},
        }
    return groupes


def scores_groupes(entete) -> dict[str, float]:
    """{groupe: score} pour un intitulé, groupes à 0 omis (cf. le docstring du
    module pour l'échelle et la règle de distinction)."""
    formes = _formes(entete)
    if not formes:
        return {}
    mots = [m for m in mots_entete(entete) if m not in _UNITES]
    entiers: dict[str, float] = {}
    partiels: dict[str, float] = {}
    for nom, groupe in dictionnaire().items():
        if formes & groupe["exacts"]:
            entiers[nom] = SCORE_EXACT
        elif formes & groupe["synonymes"]:
            entiers[nom] = SCORE_SYNONYME
        elif not (set(mots) & groupe["exclus_si"]) and any(
            _contient(mots, cle) for cle in groupe["mots_cles"]
        ):
            partiels[nom] = SCORE_MOT_CLE
    return entiers or partiels


def scores_proprietes(entete) -> dict[str, float]:
    """{propriété: score}, le meilleur groupe de chaque propriété. La clé ""
    porte les groupes qui ne s'importent pas (solde, référence…)."""
    groupes = dictionnaire()
    resultat: dict[str, float] = {}
    for nom, score in scores_groupes(entete).items():
        propriete = groupes[nom]["propriete"]
        resultat[propriete] = max(resultat.get(propriete, 0.0), score)
    return resultat


def groupe_principal(entete) -> str:
    """Le groupe qui reconnaît le mieux l'intitulé, "" si aucun."""
    scores = scores_groupes(entete)
    return max(scores, key=scores.get) if scores else ""
