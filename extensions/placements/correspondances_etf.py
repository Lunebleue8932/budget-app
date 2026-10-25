"""Les correspondances par défaut de l'import de composition d'un ETF : un pays -> une zone, un
libellé de secteur -> un secteur de l'application.

CE N'EST QU'UNE PROPOSITION. L'écran montre chaque correspondance et l'utilisateur la confirme
ou la change : rien d'ici ne s'applique sans lui. Les zones sont celles que livre l'application
(constants.ZONES_INITIALES) — larges et EXCLUSIVES, « Asie (hors Chine) » et non « Asie » — et
les secteurs ceux du GICS en français (constants.SECTEURS_INITIAUX). Si l'utilisateur a renommé
ou supprimé une étiquette, la proposition vise le nom livré et l'écran la montre « à créer ».

LES SECTEURS : MOTS-CLÉS D'ABORD, FLOU ENSUITE. Les émetteurs écrivent le même secteur de dix
façons (« Health Care », « Santé », « Healthcare », « Soins de santé »). Un mot-clé reconnu
tranche, sans hasard. À défaut on cherche le libellé le plus proche (difflib) parmi les étiquettes
de l'utilisateur, avec un seuil assez haut pour qu'un libellé étranger reste « sans
correspondance » plutôt que de tomber sur le mauvais secteur.
"""
import difflib
import re
import unicodedata
from typing import Optional

from app import constants

# ---------- Les pays ----------

US, CN, EU = "États-Unis", "Chine", "Europe"
AS, AM, AF, OC = "Asie (hors Chine)", "Amérique (hors États-Unis)", "Afrique", "Océanie"


def cle(texte) -> str:
    """Un libellé comparé sans casse, accents, tirets ni soulignés : « NEW_ZEALAND » = « new zealand »."""
    brut = unicodedata.normalize("NFD", str(texte or ""))
    brut = "".join(c for c in brut if not unicodedata.combining(c)).lower()
    brut = re.sub(r"[^a-z0-9]+", " ", brut)
    return brut.strip()


# Par zone, les pays en français ET en anglais (les fichiers viennent des deux), sans accents.
_PAYS_PAR_ZONE = {
    US: ["etats unis", "united states", "usa", "us", "united states of america", "etats unis d amerique"],
    CN: ["chine", "china", "hong kong", "hongkong", "macao", "macau"],
    EU: [
        "allemagne", "germany", "france", "royaume uni", "united kingdom", "uk", "grande bretagne", "great britain",
        "suisse", "switzerland", "pays bas", "netherlands", "belgique", "belgium", "italie", "italy", "espagne",
        "spain", "irlande", "ireland", "luxembourg", "autriche", "austria", "portugal", "finlande", "finland",
        "suede", "sweden", "norvege", "norway", "danemark", "denmark", "pologne", "poland", "grece", "greece",
        "republique tcheque", "czech republic", "czechia", "hongrie", "hungary", "roumanie", "romania",
        "islande", "iceland", "croatie", "croatia", "slovaquie", "slovakia",
        "slovenie", "slovenia", "estonie", "estonia", "lettonie", "latvia", "lituanie", "lithuania", "bulgarie",
        "bulgaria", "serbie", "serbia", "malte", "malta", "chypre", "cyprus", "jersey", "guernesey", "guernsey",
        "ile de man", "isle of man", "liechtenstein", "monaco", "ukraine", "turquie", "turkey", "turkiye",
        "union europeenne", "european union", "eurozone", "zone euro", "europe",
    ],
    AS: [
        "japon", "japan", "coree du sud", "south korea", "korea south", "korea", "republic of korea", "taiwan",
        "inde", "india", "indonesie", "indonesia", "thailande", "thailand", "malaisie", "malaysia", "singapour",
        "singapore", "philippines", "vietnam", "viet nam", "pakistan", "bangladesh", "sri lanka", "israel",
        "arabie saoudite", "saudi arabia", "emirats arabes unis", "united arab emirates", "uae", "qatar", "koweit",
        "kuwait", "bahrein", "bahrain", "oman", "jordanie", "jordan", "liban", "lebanon", "kazakhstan",
        "mongolie", "mongolia", "russie", "russia", "russian federation", "cambodge", "cambodia", "nepal", "iran", "irak", "iraq", "asie", "asia",
    ],
    AM: [
        "canada", "bresil", "brazil", "mexique", "mexico", "argentine", "argentina", "chili", "chile", "colombie",
        "colombia", "perou", "peru", "bermudes", "bermuda", "iles caimans", "cayman islands", "panama",
        "uruguay", "venezuela", "equateur", "ecuador", "costa rica", "bahamas", "jamaique", "jamaica",
        "puerto rico", "porto rico", "iles vierges britanniques", "british virgin islands", "curacao",
        "amerique latine", "latin america",
    ],
    AF: [
        "afrique du sud", "south africa", "egypte", "egypt", "maroc", "morocco", "nigeria", "nigeria", "kenya",
        "ghana", "tunisie", "tunisia", "algerie", "algeria", "senegal", "cote d ivoire", "ivory coast",
        "afrique", "africa", "maurice", "mauritius", "zambie", "zambia", "tanzanie", "tanzania",
    ],
    OC: [
        "australie", "australia", "nouvelle zelande", "new zealand", "oceanie", "oceania", "papouasie nouvelle guinee",
        "papua new guinea", "fidji", "fiji",
    ],
}

ZONE_PAR_PAYS: dict[str, str] = {
    cle(pays): zone for zone, pays in _PAYS_PAR_ZONE.items() for pays in pays
}


def zone_par_defaut(pays) -> Optional[str]:
    """La zone proposée pour un pays tel que le fichier l'écrit, ou None s'il est inconnu."""
    return ZONE_PAR_PAYS.get(cle(pays))


# ---------- Les secteurs ----------

# Mots-clés (sans accents) -> secteur livré. L'ORDRE COMPTE : le premier secteur dont un motif
# apparaît dans le libellé l'emporte, et les motifs précis (« non cyclique », « de base ») passent
# avant les généraux (« consommation »).
_MOTS_CLES_SECTEURS = [
    ("Consommation de base", [
        "consumer staples", "staples", "non cyclique", "non cyclical", "consommation de base",
        "biens de consommation de base", "defensive consumer", "produits de base", "alimentation", "food beverage",
        "beverages", "personal products",
    ]),
    ("Consommation discrétionnaire", [
        "consumer discretionary", "discretionary", "cyclique", "cyclical", "consommation discretionnaire",
        "consommation cyclique", "biens de consommation cycl", "retail", "distribution", "automobiles",
        "luxury", "luxe", "leisure",
    ]),
    ("Technologies de l'information", [
        "information technology", "technologies de l information", "technologie", "technology", "tech",
        "software", "semiconductor", "semi conducteur", "informatique", "it services", "hardware",
    ]),
    ("Santé", [
        "health care", "healthcare", "sante", "soins de sante", "pharma", "biotech", "medical", "life sciences",
    ]),
    ("Finance", [
        "financial", "finance", "financiere", "banque", "bank", "assurance", "insurance", "services financiers",
        "capital markets",
    ]),
    ("Industrie", [
        "industrial", "industrie", "industriel", "capital goods", "biens d equipement", "aerospace", "defense",
        "defence", "aeronautique", "transport", "construction", "machinery",
    ]),
    ("Énergie", ["energy", "energie", "oil", "gas", "petrole", "gaz"]),
    ("Services de communication", [
        "communication", "telecom", "media", "telecommunications", "services de communication",
        "communication services",
    ]),
    ("Services aux collectivités", ["utilities", "utility", "services aux collectivites", "services publics", "eau", "electricite"]),
    ("Matériaux", ["materials", "materiaux", "basic materials", "mining", "mines", "chemicals", "chimie", "metaux", "steel"]),
    ("Immobilier", ["real estate", "immobilier", "reit", "foncieres", "property", "foncier"]),
]

SEUIL_FLOU = 0.72


def secteur_par_mots_cles(libelle) -> Optional[str]:
    """Le secteur livré dont un mot-clé figure dans ce libellé, ou None."""
    texte = f" {cle(libelle)} "
    for secteur, motifs in _MOTS_CLES_SECTEURS:
        for motif in motifs:
            if f" {cle(motif)} " in texte or (len(cle(motif)) >= 6 and cle(motif) in texte):
                return secteur
    return None


def secteur_propose(libelle, existants: list[str]) -> tuple[Optional[str], str]:
    """(le secteur proposé, comment on l'a trouvé : « exact », « mot-clé », « approchant » ou « aucun »).

    `existants` : les secteurs que l'application porte. Le résultat est TOUJOURS un nom à
    l'orthographe de l'utilisateur quand il en a un qui convient ; sinon le nom livré, que
    l'écran montrera « à créer »."""
    par_cle = {cle(nom): nom for nom in existants}
    brut = cle(libelle)
    if brut in par_cle:
        return par_cle[brut], "exact"
    motcle = secteur_par_mots_cles(libelle)
    if motcle is not None:
        return par_cle.get(cle(motcle), motcle), "mot-clé"
    proches = difflib.get_close_matches(brut, list(par_cle), n=1, cutoff=SEUIL_FLOU)
    if proches:
        return par_cle[proches[0]], "approchant"
    return None, "aucun"


def zone_proposee(pays, existantes: list[str]) -> tuple[Optional[str], str]:
    """(la zone proposée pour un pays, comment : « exact », « défaut » ou « aucun »)."""
    par_cle = {cle(nom): nom for nom in existantes}
    if cle(pays) in par_cle:
        return par_cle[cle(pays)], "exact"
    zone = zone_par_defaut(pays)
    if zone is None:
        return None, "aucun"
    return par_cle.get(cle(zone), zone), "défaut"


# ---------- Les classes d'actif ----------

# Ce que le fichier appelle une ligne qui n'est PAS un titre : liquidités, change, dérivés. Elle
# n'entre pas dans la composition (on ne peut pas la détenir, ni la rattacher à un secteur).
_NON_TITRES = ("cash", "liquid", "fx", "forex", "future", "swap", "derivative", "derive", "unassigned",
               "money market", "monetaire", "collateral", "margin", "marge", "currency", "devise", "total")
_ACTIONS = ("equity", "equities", "action", "actions", "stock", "share")
_OBLIGATIONS = ("bond", "fixed income", "obligation", "debt", "treasury")


def classe_normalisee(brut) -> Optional[str]:
    """« Actions », « Obligations », « (hors titres) » pour liquidités et dérivés, ou None si
    le fichier ne dit rien d'exploitable."""
    texte = cle(brut)
    if not texte:
        return None
    if any(m in texte for m in _NON_TITRES):
        return "(hors titres)"
    if any(texte == m or texte.startswith(m) for m in _ACTIONS):
        return "Actions"
    if any(m in texte for m in _OBLIGATIONS):
        return "Obligations"
    return None
