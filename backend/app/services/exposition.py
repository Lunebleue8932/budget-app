"""Les répartitions d'un titre et le dictionnaire d'un ETF : les lire, les valider.

DEUX ENDROITS ÉCRIVENT CES DONNÉES — le routeur des titres (la saisie à la main) et
l'import de titres (un fichier Excel ou CSV) — et ils ne doivent JAMAIS divergir sur
ce qui est une répartition valide. D'où ce module, dans le noyau : un seul endroit
décide, les deux appelants s'y appuient.

RIEN N'EST JAMAIS RENORMALISÉ. Des poids qui somment 80 disent qu'on connaît 80 %
du titre ; les étirer à 100 inventerait de l'information, et un graphe qui ne
montrerait que ce qu'on connaît se lirait comme une répartition complète. Le
résidu se calcule (`reste_non_renseigne`), il ne se distribue pas. Même raisonnement
que l'accord des trois grandeurs du budget : un écart se SIGNALE.

CE QUI REFUSE, ET CE QUI SIGNALE. Un poids négatif ou nul, supérieur à 100, un ISIN
mal formé, un même libellé deux fois, une somme qui dépasse 100 : ce sont des
erreurs (`ErreurExposition`), les données sont fausses. Une somme en dessous de 100,
ou qui s'écarte de la couverture annoncée d'un dictionnaire : ce sont des
AVERTISSEMENTS, les données sont seulement incomplètes — un ETF dont on ne connaît
que le haut de l'indice est le cas ordinaire, pas une faute.
"""
import re
from typing import Optional

from ..constants import TOLERANCE_POIDS_PCT


class ErreurExposition(ValueError):
    """Des données de répartition ou de composition qui ne peuvent pas être vraies."""


# Deux lettres (le pays de l'agence de numérotation), neuf caractères, un chiffre de
# contrôle. La FORME seulement : le chiffre de contrôle n'est pas vérifié, un code
# recopié depuis une page web se trompe plus souvent d'une lettre que d'un contrôle.
MOTIF_ISIN = re.compile(r"^[A-Z]{2}[A-Z0-9]{9}[0-9]$")

_ELEMENT = re.compile(
    r"^(?P<nom>.*?)\s*[:=]?\s*(?P<poids>-?\d+(?:[.,]\d+)?)\s*%?\s*$"
)


def normaliser_isin(texte: object) -> str:
    """Un ISIN tel qu'on le range : sans espaces, en capitales."""
    return str(texte or "").replace(" ", "").replace(" ", "").upper()


def isin_valide(texte: str) -> bool:
    return bool(MOTIF_ISIN.match(texte))


def parser_poids(texte: object) -> float:
    """« 12,5 », « 12.5 % », « 15 » -> un flottant. L'unité est le POURCENT.

    Un nombre déjà numérique (la cellule d'un classeur) passe tel quel — SANS
    interprétation : « 0,15 » reste 0,15 %, et c'est à l'aperçu de l'import de
    signaler que tous les poids d'une ligne sont inférieurs à 1 (des fractions,
    vraisemblablement), pas à cette fonction de le deviner."""
    if isinstance(texte, (int, float)) and not isinstance(texte, bool):
        return float(texte)
    brut = str(texte).strip().replace(" ", "").replace(" ", "")
    brut = brut.removesuffix("%").replace(",", ".")
    try:
        return float(brut)
    except ValueError:
        raise ErreurExposition(f"« {texte} » n'est pas un pourcentage") from None


def _elements(texte: object) -> list[str]:
    """Les éléments d'une cellule : séparés par « ; », une barre verticale ou un
    saut de ligne. La virgule n'en est PAS un — c'est le séparateur décimal."""
    if texte is None:
        return []
    return [e.strip() for e in re.split(r"[;|\n]+", str(texte)) if e.strip()]


def parser_repartition(texte: object) -> list[tuple[str, float]]:
    """Une cellule d'exposition -> `[(libellé, poids)]`.

    « Technologies de l'information » seul vaut 100 %. « États-Unis 65; Europe 15 »
    ou « États-Unis: 65 % ; Europe: 15 % » valent ce qu'elles disent. Un libellé
    SANS poids au milieu d'une liste est une erreur : on ne devine pas ce qu'il reste."""
    morceaux = []
    for element in _elements(texte):
        m = _ELEMENT.match(element)
        if m and m.group("nom").strip():
            morceaux.append((m.group("nom").strip(" :="), parser_poids(m.group("poids"))))
        else:
            morceaux.append((element.strip(" :="), None))
    if len(morceaux) == 1 and morceaux[0][1] is None:
        return [(morceaux[0][0], 100.0)]
    for nom, poids in morceaux:
        if poids is None:
            raise ErreurExposition(f"poids manquant pour « {nom} »")
    return morceaux


def parser_composition(texte: object) -> dict[str, float]:
    """Une cellule de composition -> `{ISIN: poids}`.

    « US5949181045 15; US02079K3059 12,5 » ou « US5949181045: 15 % ». Un ISIN sans
    poids est une erreur. Le même ISIN deux fois aussi : laquelle des deux lignes
    croire ?"""
    resultat: dict[str, float] = {}
    for element in _elements(texte):
        m = _ELEMENT.match(element)
        if not m or not m.group("nom").strip():
            raise ErreurExposition(f"poids manquant pour « {element} »")
        isin = normaliser_isin(m.group("nom").strip(" :="))
        if isin in resultat:
            raise ErreurExposition(f"l'ISIN {isin} figure deux fois")
        resultat[isin] = parser_poids(m.group("poids"))
    return resultat


def reste_non_renseigne(poids: list[float]) -> float:
    """Ce qu'il manque pour atteindre 100 — jamais négatif. C'est la part que les
    graphes montrent en « non renseigné » plutôt que de la répartir."""
    return max(0.0, 100.0 - sum(poids))


def valider_repartition(lignes: list[tuple[object, float]]) -> list[str]:
    """Valide une répartition `[(étiquette, poids)]` et rend ses AVERTISSEMENTS.

    Lève `ErreurExposition` quand elle ne peut pas être vraie : un poids hors de
    ]0 ; 100], la même étiquette deux fois, une somme au-dessus de 100 (à la
    tolérance près, cf. constants.TOLERANCE_POIDS_PCT)."""
    vus = set()
    for etiquette, poids in lignes:
        if not (0 < poids <= 100):
            raise ErreurExposition(f"le poids {poids:g} doit être compris entre 0 (exclu) et 100")
        if etiquette in vus:
            raise ErreurExposition("la même étiquette figure deux fois dans la répartition")
        vus.add(etiquette)
    total = sum(p for _, p in lignes)
    if total > 100 + TOLERANCE_POIDS_PCT:
        raise ErreurExposition(f"la somme des poids ({total:g} %) dépasse 100 %")
    avertissements = []
    if lignes and total < 100 - TOLERANCE_POIDS_PCT:
        avertissements.append(f"la répartition ne couvre que {total:g} % : le reste est non renseigné")
    return avertissements


def valider_composition(
    composition: dict[str, float], couverture_pct: Optional[float] = None
) -> list[str]:
    """Valide le dictionnaire d'un ETF et rend ses avertissements.

    Les ISIN doivent être bien formés (cf. MOTIF_ISIN), les poids dans ]0 ; 100], leur
    somme ne dépasse pas 100. Quand une couverture est annoncée (« les ISIN du top
    60 % »), une somme qui s'en éloigne est SIGNALÉE : les deux nombres décrivent la
    même chose, et l'un des deux est faux ou périmé."""
    for isin, poids in composition.items():
        if not isin_valide(isin):
            raise ErreurExposition(f"« {isin} » n'est pas un ISIN valide")
        if not (0 < poids <= 100):
            raise ErreurExposition(f"le poids de {isin} ({poids:g}) doit être compris entre 0 (exclu) et 100")
    total = sum(composition.values())
    if total > 100 + TOLERANCE_POIDS_PCT:
        raise ErreurExposition(f"la somme des poids de la composition ({total:g} %) dépasse 100 %")
    avertissements = []
    if couverture_pct is not None:
        if not (0 < couverture_pct <= 100):
            raise ErreurExposition("la couverture doit être comprise entre 0 (exclu) et 100")
        if composition and abs(total - couverture_pct) > TOLERANCE_POIDS_PCT:
            avertissements.append(
                f"les poids somment {total:g} % alors que la couverture annoncée est de {couverture_pct:g} %"
            )
    return avertissements
