"""Quels pays de la carte appartiennent à quelle ZONE de l'utilisateur.

LES ZONES SONT CELLES DE LA BASE, pas un découpage figé : l'utilisateur renomme « Europe », crée
« Japon » ou « Asie du Sud-Est ». La carte doit donc s'adapter à ce qu'il a, d'où ce module qui, pour
chaque pays, cherche LA zone de la base qui le contient — au plus précis d'abord :

  1. une zone qui porte LE NOM DU PAYS (« Japon », « Japan » ; tout accent et toute casse ignorés) ;
  2. à défaut, une zone qui porte le nom d'un REGROUPEMENT connu (« Europe », « Asie (hors Chine) »,
     « Amérique latine »…), même légèrement renommée (ressemblance de noms) ;
  3. sinon le pays reste sans zone : il apparaît en fond de carte.

UN PAYS N'APPARTIENT QU'À UNE ZONE (la plus précise l'emporte) : c'est la règle des zones livrées,
EXCLUSIVES, et c'est ce qui rend le remplissage lisible. Rien n'est écrit en base : tout est calculé
à la lecture.

Les regroupements (`REGROUPEMENTS`) reprennent le semis des zones (constants.ZONES_INITIALES) et
l'étendent à TOUS les pays de la carte ; les noms de pays viennent de `pays_iso`.
"""
import difflib
import re
import unicodedata
from typing import Iterable

from pays_iso import PAYS

# Les pays par grande région, en codes ISO alpha-2. L'Europe suit le dictionnaire de l'import
# (correspondances_etf) : Russie, Ukraine et Turquie y figurent. Le Moyen-Orient est rangé en Asie.
_EUROPE = set(
    "AL AD AT BY BE BA BG HR CY CZ DK EE FO FI FR DE GI GR GG HU IS IE IM IT JE XK LV LI LT LU MT MD MC ME NL "
    "MK NO PL PT RO RU SM RS SK SI ES SE CH UA GB VA TR AX SJ".split()
)
_ASIE = set(
    "AF AM AZ BH BD BT BN KH GE IN ID IR IQ IL JP JO KZ KW KG LA LB MY MV MN MM NP KP OM PK PS PH QA SA SG KR LK "
    "SY TW TJ TH TL TM AE UZ VN YE IO".split()
)
_CHINE = set("CN HK MO".split())
_AMERIQUE_HORS_US = set(
    "AI AG AR AW BS BB BZ BM BO BR VG CA KY CL CO CR CU CW DM DO EC SV FK GF GL GD GP GT GY HT HN JM MQ MX MS NI "
    "PA PY PE PR BL KN LC MF PM VC SR TT TC UY VI VE BQ SX".split()
)
_AFRIQUE = set(
    "DZ AO BJ BW BF BI CM CV CF TD KM CG CD CI DJ EG GQ ER SZ ET GA GM GH GN GW KE LS LR LY MG MW ML MR MU YT MA "
    "MZ NA NE NG RE RW ST SN SC SL SO ZA SS SD TZ TG TN UG EH ZM ZW SH".split()
)
_OCEANIE = set(
    "AS AU CK FJ PF GU KI MH FM NR NC NZ NU NF MP PW PG PN WS SB TK TO TV VU WF UM CC CX".split()
)
_AMERIQUE_LATINE = _AMERIQUE_HORS_US - {"CA", "GL", "BM", "PM"}


def cle(texte) -> str:
    """Un libellé sans casse, accents ni ponctuation : « Asie (hors Chine) » = « asie hors chine »."""
    brut = unicodedata.normalize("NFD", str(texte or ""))
    brut = "".join(c for c in brut if not unicodedata.combining(c)).lower()
    return re.sub(r"[^a-z0-9]+", " ", brut).strip()


# Les noms de regroupements (clés normalisées) -> les pays qu'ils couvrent.
REGROUPEMENTS: dict[str, set[str]] = {
    "etats unis": {"US"},
    "etats unis d amerique": {"US"},
    "united states": {"US"},
    "usa": {"US"},
    "chine": _CHINE,
    "china": _CHINE,
    "europe": _EUROPE,
    "asie hors chine": _ASIE,
    "asia ex china": _ASIE,
    "asie": _ASIE | _CHINE,
    "asia": _ASIE | _CHINE,
    "amerique hors etats unis": _AMERIQUE_HORS_US,
    "americas ex us": _AMERIQUE_HORS_US,
    "amerique": _AMERIQUE_HORS_US | {"US"},
    "americas": _AMERIQUE_HORS_US | {"US"},
    "amerique du nord": {"US", "CA", "MX", "GL", "BM", "PM"},
    "north america": {"US", "CA", "MX", "GL", "BM", "PM"},
    "amerique latine": _AMERIQUE_LATINE,
    "latin america": _AMERIQUE_LATINE,
    "afrique": _AFRIQUE,
    "africa": _AFRIQUE,
    "oceanie": _OCEANIE,
    "oceania": _OCEANIE,
    "moyen orient": set("AE BH IL IQ IR JO KW LB OM PS QA SA SY TR YE".split()),
    "middle east": set("AE BH IL IQ IR JO KW LB OM PS QA SA SY TR YE".split()),
    "zone euro": set("AT BE CY DE EE ES FI FR GR HR IE IT LT LU LV MT NL PT SI SK".split()),
    "eurozone": set("AT BE CY DE EE ES FI FR GR HR IE IT LT LU LV MT NL PT SI SK".split()),
}

SEUIL_RENOMMAGE = 0.82

# Les noms propres à un pays, par code : ses trois noms, normalisés.
_NOMS_PAYS: dict[str, str] = {}
for _code, _noms in PAYS.items():
    for _nom in _noms:
        _NOMS_PAYS.setdefault(cle(_nom), _code)
# Des écritures courantes que le référentiel ne donne pas.
for _alias, _code in {
    "uk": "GB", "royaume uni": "GB", "grande bretagne": "GB", "great britain": "GB", "etats unis": "US",
    "coree du sud": "KR", "south korea": "KR", "korea": "KR", "coree": "KR", "russie": "RU", "russia": "RU",
    "tchequie": "CZ", "republique tcheque": "CZ", "czech republic": "CZ", "viet nam": "VN", "turquie": "TR",
    "turkiye": "TR", "emirats arabes unis": "AE", "uae": "AE", "hongkong": "HK", "hong kong": "HK",
    "pays bas": "NL", "holland": "NL", "cote d ivoire": "CI", "ivory coast": "CI", "birmanie": "MM",
}.items():
    _NOMS_PAYS.setdefault(cle(_alias), _code)


def pays_de_la_zone(nom_zone: str) -> tuple[set[str], str]:
    """(les pays qu'une zone de ce nom désigne, et « pays » / « regroupement » / « aucun »)."""
    k = cle(nom_zone)
    if k in _NOMS_PAYS:
        # Le pays, et ses dépendances quand le nom en désigne aussi un regroupement (« Chine » : Hong Kong, Macao).
        return {_NOMS_PAYS[k]} | REGROUPEMENTS.get(k, set()), "pays"
    if k in REGROUPEMENTS:
        return set(REGROUPEMENTS[k]), "regroupement"
    proche = difflib.get_close_matches(k, list(REGROUPEMENTS), n=1, cutoff=SEUIL_RENOMMAGE)
    if proche:
        return set(REGROUPEMENTS[proche[0]]), "regroupement"
    return set(), "aucun"


def affecter(zones: Iterable[tuple[int, str]]) -> dict[int, list[str]]:
    """`zones` : les zones de la base, `(identifiant, nom)`. Rend `{identifiant: [codes pays]}`.

    Le plus précis l'emporte : un pays nommé par une zone est à elle, même si un regroupement plus large
    (« Europe ») le contient aussi. À précision égale (deux zones « Europe »), la première par identifiant."""
    zones = sorted(zones)
    resultat: dict[int, list[str]] = {zone_id: [] for zone_id, _ in zones}
    pris: set[str] = set()
    analyses = [(zone_id, *pays_de_la_zone(nom)) for zone_id, nom in zones]
    # D'abord les zones qui nomment UN pays, puis les regroupements du plus petit au plus grand.
    ordre = sorted(
        (a for a in analyses if a[2] != "aucun"),
        key=lambda a: (0 if a[2] == "pays" else 1, len(a[1]), a[0]),
    )
    for zone_id, codes, _ in ordre:
        for code in sorted(codes - pris):
            if code in PAYS:
                resultat[zone_id].append(code)
                pris.add(code)
    return resultat
