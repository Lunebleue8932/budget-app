"""Les dates d'un relevé : dans quel ordre s'écrivent jour et mois, et dans
quel ordre défilent les opérations.

JOUR/MOIS OU MOIS/JOUR. « 03/04/2026 » est le 3 avril en France, le 4 mars
aux États-Unis, et une cellule seule ne le dit pas. Une colonne si : dès qu'une
date écrit plus de 12 à la première place, le jour est devant ; à la deuxième,
le mois l'est. Une colonne dont aucune date ne dépasse 12 (un relevé du 1er au
12 du mois) reste INCERTAINE : on la lit à la française, et on le dit.

L'ORDRE DU FICHIER. Les banques exportent volontiers de la plus récente à la
plus ancienne. On le lit à la monotonie des dates : neuf changements de date
sur dix dans le même sens suffisent — une journée peut mêler les deux, un
export trié par date de valeur aussi.
"""
import re
from datetime import date, datetime
from typing import Optional

from .import_bancaire import parser_date

_DATE_NUMERIQUE = re.compile(r"^\s*(\d{1,4})[/.\-](\d{1,2})[/.\-](\d{2,4})(?:[ T].*)?$")

# Un format sûr quand ses preuves l'emportent à ce point sur l'autre lecture.
_PART_ORDRE = 0.9


def format_dates(valeurs) -> tuple[Optional[str], bool]:
    """(« jma », « mja » ou « amj », certain ?) d'une colonne de dates écrites
    en chiffres ; (None, False) si elle n'en contient pas. Les dates déjà
    typées (xlsx) ne disent rien de l'écriture : elles sont ignorées."""
    annee_devant = jour_devant = mois_devant = numeriques = 0
    for valeur in valeurs:
        if valeur is None or isinstance(valeur, (date, datetime)):
            continue
        m = _DATE_NUMERIQUE.match(str(valeur))
        if not m:
            continue
        numeriques += 1
        premier, second, _ = m.groups()
        if len(premier) == 4:
            annee_devant += 1
        elif int(premier) > 12:
            jour_devant += 1
        elif int(second) > 12:
            mois_devant += 1
    if not numeriques:
        return None, False
    if annee_devant > numeriques / 2:
        return "amj", True
    if jour_devant and not mois_devant:
        return "jma", True
    if mois_devant and not jour_devant:
        return "mja", True
    # Rien qui départage, ou des preuves des deux côtés : la lecture française,
    # sans certitude.
    return "jma", False


def lire_date(valeur, format_date: Optional[str] = None) -> Optional[date]:
    """La date d'une cellule selon le format de sa colonne, lue exactement
    comme l'import la lira (import_bancaire.parser_date)."""
    return parser_date(valeur, format_date)


def ordre_dates(dates) -> Optional[str]:
    """« croissant », « decroissant », ou None (trop peu de changements de
    date, ou un ordre mêlé)."""
    connues = [d for d in dates if d is not None]
    hausses = sum(1 for a, b in zip(connues, connues[1:]) if b > a)
    baisses = sum(1 for a, b in zip(connues, connues[1:]) if b < a)
    changements = hausses + baisses
    if changements < 3:
        return None
    if hausses / changements >= _PART_ORDRE:
        return "croissant"
    if baisses / changements >= _PART_ORDRE:
        return "decroissant"
    return None
