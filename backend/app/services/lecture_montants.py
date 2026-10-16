"""Lire un montant écrit par une banque, en CENTIMES ENTIERS.

POURQUOI DES CENTIMES. Un flottant ne sait pas écrire 0,10 : additionner des
montants lus en flottants, ou comparer une différence de soldes à une somme
d'opérations, laisse traîner des millièmes qui font échouer une égalité vraie.
Tout ce qui raisonne sur les montants pendant la DÉTECTION (forme des
colonnes, test du solde, aperçu avant import) passe donc par `centimes`.
L'import lui-même lit encore par import_bancaire.parser_montant.

CE QUE LES BANQUES ÉCRIVENT : « 1 234,56 € » (espace, ou espace insécable,
pour les milliers), « 1.234,56 », « 1,234.56 », « 1'234.56 », « (12,50) »
pour un débit, « 12,50- » signe en queue, « +3,00 », « EUR 12,00 ».

L'AMBIGUÏTÉ « 1.234 » : mille deux cent trente-quatre, ou un virgule deux
cent trente-quatre ? Une cellule seule ne le dit pas, LA COLONNE si : ses
autres valeurs écrivent « 45.20 » (le point est décimal) ou « 1.234,56 » (il
sépare les milliers). C'est `format_nombres` qui tranche, sur toute la
colonne, et `centimes` qui lit ensuite chaque cellule selon ce format.
"""
import re
from collections import Counter
from decimal import Decimal, InvalidOperation
from typing import Optional

# Ce qui accompagne un nombre sans en faire partie.
_MONNAIES = re.compile(r"(€|\$|£|EUR|USD|GBP|CHF|BRL|R\$)", re.IGNORECASE)
# Les séparateurs de milliers possibles, outre le point et la virgule.
_ESPACES = (" ", " ", " ", "'", "’")
_NOMBRE = re.compile(r"^\d[\d.,]*$|^[.,]\d+$")


def _nettoyer(texte: str) -> tuple[str, bool]:
    """(chiffres et séparateurs seuls, négatif ?). Le signe peut s'écrire en
    tête, en queue, ou en parenthèses."""
    t = _MONNAIES.sub("", texte).strip()
    negatif = False
    if t.startswith("(") and t.endswith(")"):
        negatif, t = True, t[1:-1].strip()
    if t.endswith("-"):
        negatif, t = not negatif, t[:-1].strip()
    elif t.endswith("+"):
        t = t[:-1].strip()
    if t.startswith("-"):
        negatif, t = not negatif, t[1:].strip()
    elif t.startswith("+"):
        t = t[1:].strip()
    return t, negatif


def _separateurs_observes(t: str) -> tuple[Optional[str], Optional[str], bool]:
    """(décimal, milliers, ambigu) que dit UNE cellule nettoyée, ses espaces de
    milliers déjà connus. `ambigu` : un seul séparateur suivi de trois
    chiffres, qui peut être l'un ou l'autre."""
    virgules, points = t.count(","), t.count(".")
    if virgules and points:
        decimal = "," if t.rfind(",") > t.rfind(".") else "."
        return decimal, "." if decimal == "," else ",", False
    signe = "," if virgules else "." if points else None
    if signe is None:
        return None, None, False
    if (virgules or points) > 1:
        return None, signe, False
    apres = len(t) - t.index(signe) - 1
    if apres == 3:
        return None, None, True
    return signe, None, False


def format_nombres(valeurs) -> tuple[Optional[str], Optional[str]]:
    """(séparateur décimal, séparateur de milliers) d'une colonne, d'après
    toutes ses cellules ; None quand rien ne le dit. Le décimal manquant vaut
    la virgule française, choix de l'appelant."""
    decimaux: Counter = Counter()
    milliers: Counter = Counter()
    for valeur in valeurs:
        if valeur is None or isinstance(valeur, (int, float)):
            continue
        t, _ = _nettoyer(str(valeur))
        for espace in _ESPACES:
            if espace in t.strip() and re.search(rf"\d{re.escape(espace)}\d{{3}}", t):
                milliers[espace] += 1
                t = t.replace(espace, "")
        if not _NOMBRE.match(t):
            continue
        decimal, separateur, _ = _separateurs_observes(t)
        if decimal:
            decimaux[decimal] += 1
        if separateur:
            milliers[separateur] += 1
    decimal = decimaux.most_common(1)[0][0] if decimaux else None
    millier = milliers.most_common(1)[0][0] if milliers else None
    # Le point ou la virgule de milliers ne peut pas être aussi le décimal.
    if decimal and millier == decimal:
        millier = None
    if decimal is None and millier in (",", "."):
        decimal = "." if millier == "," else ","
    # « 1.234 » partout et rien d'autre : la colonne ne tranche pas (None,
    # None). `centimes` lit alors des milliers — trois décimales n'existent pas
    # sur un relevé bancaire.
    return decimal, millier


def centimes(
    valeur, separateur_decimal: Optional[str] = None, separateur_milliers: Optional[str] = None
) -> Optional[int]:
    """Le montant en centimes signés, ou None si la cellule n'en est pas un.

    `separateur_decimal` : celui de la colonne (cf. format_nombres) ; None =
    la virgule, sauf quand la cellule elle-même le contredit (« 1,234.56 »).
    Au-delà de deux décimales, la cellule n'est pas un montant — sauf des zéros
    (« 12,500 » d'un export qui complète à trois chiffres)."""
    if valeur is None or isinstance(valeur, bool):
        return None
    if isinstance(valeur, (int, float, Decimal)):
        try:
            return int((Decimal(str(valeur)) * 100).quantize(Decimal(1)))
        except InvalidOperation:
            return None
    t, negatif = _nettoyer(str(valeur))
    for espace in _ESPACES:
        t = t.replace(espace, "")
    if not t or not _NOMBRE.match(t):
        return None
    decimal = separateur_decimal
    if decimal is None:
        observe, _, _ = _separateurs_observes(t)
        decimal = observe or ","
    millier = separateur_milliers or ("." if decimal == "," else ",")
    if millier in (",", ".") and millier != decimal:
        t = t.replace(millier, "")
    if t.count(decimal) > 1 or ("," in t and "." in t):
        return None
    entier, _, fraction = t.partition(decimal)
    fraction = fraction.rstrip("0") if len(fraction) > 2 else fraction
    if len(fraction) > 2 or not (entier + fraction).isdigit():
        return None
    montant = int(entier or "0") * 100 + int((fraction + "00")[:2])
    return -montant if negatif else montant


def texte_montant(valeur: int, separateur_decimal: str = ",", separateur_milliers: str = "") -> str:
    """L'inverse de `centimes` : de quoi écrire un montant comme une banque."""
    signe = "-" if valeur < 0 else ""
    entier = f"{abs(valeur) // 100:,}".replace(",", separateur_milliers)
    return f"{signe}{entier}{separateur_decimal}{abs(valeur) % 100:02d}"
