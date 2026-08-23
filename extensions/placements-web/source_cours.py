"""D'où vient un cours : reconnaître un lien, aller le lire, en tirer un nombre.

CE MODULE EST LE SEUL DE TOUTE L'APPLICATION QUI OUVRE UNE CONNEXION SORTANTE.
C'est délibéré et c'est vérifiable : `urllib.request.urlopen` n'apparaît nulle
part ailleurs, ni dans le noyau, ni dans l'extension « placements ». Installer
cette extension-ci est donc le geste, et le seul, qui fait sortir quelque chose
de la machine — une requête GET vers la page que l'utilisateur a lui-même
collée, sans un octet de ses données dedans (cf. `telecharger` : aucun corps,
aucun cookie, aucun identifiant).

QUATRE SOURCES :

    google       google.com/finance/quote/SYM:PLACE -> attributs de la page
    yahoo        finance.yahoo.com/quote/SYMBOLE    -> API JSON du graphique
    boursorama   boursorama.com/cours/SYMBOLE/      -> page HTML
    schema.org   n'importe quelle autre page        -> balisage standard

Les trois premières sont NOMMÉES parce qu'on sait exactement où lire chez
elles ; la quatrième est un filet, pour les sites qui publient leur cours au
format schema.org (un standard, pas une bricole propre à un site). Un lien
qu'aucune ne sait lire est refusé À L'ENREGISTREMENT, avec l'erreur rencontrée :
mieux vaut le découvrir en collant le lien que six mois plus tard devant un
cours qui n'a jamais bougé.

GOOGLE EST EN TÊTE PARCE QUE C'EST LA PAGE QU'ON TROUVE, pas parce que c'est la
plus solide : chercher le nom d'une société y mène en premier. Yahoo reste la
lecture la plus sûre — une API JSON change moins souvent, et plus bruyamment,
qu'une page. Les deux se valent à l'usage.

POURQUOI PAS UNE API FINANCIÈRE DÉDIÉE. Toutes celles qui valent quelque chose
demandent une clé, donc un compte, donc une inscription — et la plupart
facturent au-delà de quelques appels. Une page publique de cotation ne demande
rien, et c'est celle que l'utilisateur consulte déjà.

CE QUI CASSERA UN JOUR. Yahoo est une API JSON : elle changera peu, et
bruyamment. Google et Boursorama sont des pages HTML : leur mise en page peut
changer sans prévenir, auquel cas la lecture échoue proprement (« cours
introuvable dans la page ») au lieu de renvoyer n'importe quel nombre. C'est
la raison pour laquelle chaque extraction cherche une ANCRE STRUCTURELLE (un
attribut de données, un bloc JSON balisé) et jamais une position, une classe
CSS engendrée ou un ordre d'apparition.
"""
import gzip
import json
import re
import urllib.error
import urllib.request
from dataclasses import dataclass
from html import unescape
from typing import Optional
from urllib.parse import urlparse

# Douze secondes : au-delà, la page ne répond pas, et l'utilisateur attend
# devant un bouton. Un rafraîchissement de dix titres reste borné parce que les
# lectures partent en parallèle (cf. service_cours.rafraichir).
DELAI_MAX_S = 12

# Une page de cotation pèse un à deux mégaoctets ; huit est large sans
# permettre à une URL mal choisie (un fichier vidéo, un flux sans fin) de
# remplir la mémoire de l'application.
TAILLE_MAX_OCTETS = 8 * 1024 * 1024

# Un agent qui DIT CE QU'IL EST. Se faire passer pour Chrome aurait été plus
# discret ; ce n'est pas la relation qu'on veut avec un site qu'on interroge
# trois fois par jour. Un agent vide, lui, ne marche pas : celui par défaut
# d'urllib se fait refuser par Yahoo (429).
AGENT = "Budget App (extension placements-web ; lecture de cours pour usage personnel)"


class CoursIllisible(Exception):
    """Le cours n'a pas pu être lu. Le message est destiné à l'utilisateur : il
    dit ce qui a été tenté et ce qu'il peut corriger, jamais un nom de fonction
    ni un fragment de HTML."""


@dataclass(frozen=True)
class Cours:
    """Ce qu'une source rend quand la lecture aboutit.

    `devise` et `libelle` sont facultatifs parce que toutes les sources ne les
    publient pas. Ils ne servent pas à valoriser quoi que ce soit : la devise
    permet de refuser un cours libellé dans une autre monnaie que celle du
    titre (cf. service_cours), et le libellé de confirmer à l'écran que le lien
    pointe bien sur le bon instrument — un symbole seul ne se relit pas."""

    valeur: float
    devise: Optional[str] = None
    libelle: Optional[str] = None
    source: str = ""


# ---------- Transport ----------


def _verifier_url(url: str) -> str:
    """Refuse tout ce qui n'est pas une adresse web ordinaire.

    `file://` lirait un fichier de la machine, `ftp://` ouvrirait une connexion
    d'un autre genre : urllib les gère tous, et rien ici n'en a besoin. Un
    champ qui attend une URL de page web ne doit accepter que celle-là."""
    url = (url or "").strip()
    decoupee = urlparse(url)
    if decoupee.scheme not in ("http", "https") or not decoupee.netloc:
        raise CoursIllisible(
            "Ce n'est pas une adresse web : colle le lien complet de la page de "
            "cotation, en https://"
        )
    return url


def telecharger(url: str) -> str:
    """Le contenu d'une page, en texte.

    AUCUNE DONNÉE N'EST ENVOYÉE : un GET, trois en-têtes, pas de cookie, pas de
    corps, pas de paramètre venu de la base. Le site visité apprend qu'une
    adresse IP a demandé une page publique, rien de plus.

    Les erreurs réseau sont traduites en français ici plutôt que remontées
    telles quelles : « HTTPError 404 » n'apprend rien à quelqu'un qui vient de
    coller un lien, « la page n'existe pas (404) » dit quoi faire.
    """
    url = _verifier_url(url)
    requete = urllib.request.Request(
        url,
        headers={
            "User-Agent": AGENT,
            "Accept": "text/html,application/json;q=0.9,*/*;q=0.8",
            "Accept-Language": "fr-FR,fr;q=0.9,en;q=0.8",
        },
    )
    try:
        with urllib.request.urlopen(requete, timeout=DELAI_MAX_S) as reponse:
            brut = reponse.read(TAILLE_MAX_OCTETS)
            if reponse.headers.get("Content-Encoding") == "gzip":
                brut = gzip.decompress(brut)
    except urllib.error.HTTPError as exc:
        if exc.code == 404:
            raise CoursIllisible(
                "La page n'existe pas (404) : vérifie le lien, le symbole a "
                "peut-être changé"
            ) from exc
        if exc.code in (401, 403):
            raise CoursIllisible(
                f"Le site refuse la lecture automatique ({exc.code}) : essaie "
                "une autre source"
            ) from exc
        if exc.code == 429:
            raise CoursIllisible(
                "Le site demande d'attendre (429) : trop de lectures d'affilée, "
                "réessaie dans quelques minutes"
            ) from exc
        raise CoursIllisible(f"Le site a répondu {exc.code}") from exc
    except urllib.error.URLError as exc:
        raise CoursIllisible(
            f"Site injoignable ({exc.reason}) : pas de connexion Internet ?"
        ) from exc
    except OSError as exc:  # délai dépassé, connexion coupée en cours de lecture
        raise CoursIllisible(f"Lecture interrompue ({exc})") from exc

    # `errors="replace"` : une page mal encodée ne doit pas faire échouer la
    # lecture d'un nombre qui, lui, est en ASCII.
    return brut.decode("utf-8", errors="replace")


# ---------- Lecture d'un nombre ----------

# Tous les blancs qu'un site peut glisser dans « 8 484,43 » : espace ordinaire,
# insécable, insécable fine. Les trois séparent des milliers, aucun ne compte.
_BLANCS = ("\u00a0", "\u202f", "\u2009", " ")


def nombre_ecrit(texte: str) -> float:
    """« 8 484,43 » -> 8484.43. Le dernier séparateur décide, le reste est du
    décor.

    Les deux écritures se croisent (« 8 484,43 » à Paris, « 8,484.43 » à New
    York) et la même page peut publier l'une dans son HTML et l'autre dans son
    JSON. Prendre pour décimal le SÉPARATEUR LE PLUS À DROITE tranche les deux
    cas sans avoir à deviner la langue de la page."""
    nettoye = texte.strip()
    for blanc in _BLANCS:
        nettoye = nettoye.replace(blanc, "")
    # Tout ce qui n'est ni chiffre, ni signe, ni séparateur : symboles de
    # monnaie, codes ISO collés au nombre, parenthèses de cotation.
    nettoye = re.sub(r"[^0-9,.\-]", "", nettoye)
    if "," in nettoye and "." in nettoye:
        if nettoye.rfind(",") > nettoye.rfind("."):
            nettoye = nettoye.replace(".", "").replace(",", ".")
        else:
            nettoye = nettoye.replace(",", "")
    else:
        nettoye = nettoye.replace(",", ".")
    try:
        return float(nettoye)
    except ValueError as exc:
        raise CoursIllisible(f"« {texte.strip()} » n'est pas un nombre") from exc


def _valider(valeur: float) -> float:
    """Un cours nul ou négatif est le signe qu'on a lu autre chose que le cours
    (un volume à zéro, une variation), pas d'un titre qui ne vaudrait plus
    rien : la base refuse d'ailleurs les valeurs négatives
    (ck_action_valeur_positive)."""
    if valeur <= 0:
        raise CoursIllisible("Cours lu invalide (zéro ou négatif)")
    return valeur


def _blocs_json_ld(html: str) -> list:
    """Les blocs `<script type="application/ld+json">` d'une page, décodés.

    Balisage schema.org : un standard que les moteurs de recherche imposent de
    fait aux sites de cotation, ce qui en fait l'ancre la plus stable qu'on
    puisse viser dans du HTML."""
    blocs = []
    for morceau in re.finditer(
        r'<script[^>]+type=["\']application/ld\+json["\'][^>]*>(.*?)</script>',
        html,
        re.S | re.I,
    ):
        try:
            blocs.append(json.loads(morceau.group(1)))
        except json.JSONDecodeError:
            continue  # un bloc cassé n'invalide pas les autres
    return blocs


def _offre_schema_org(html: str) -> Optional[dict]:
    """L'offre (`price`, `priceCurrency`) du produit décrit par la page."""
    for bloc in _blocs_json_ld(html):
        candidats = bloc if isinstance(bloc, list) else [bloc]
        for objet in candidats:
            if not isinstance(objet, dict):
                continue
            types = objet.get("@type")
            types = types if isinstance(types, list) else [types]
            if "Product" not in types and "FinancialProduct" not in types:
                continue
            offre = objet.get("offers")
            offre = offre[0] if isinstance(offre, list) and offre else offre
            if isinstance(offre, dict) and offre.get("price") is not None:
                return {
                    "prix": offre["price"],
                    "devise": offre.get("priceCurrency"),
                    "nom": objet.get("name"),
                }
    return None


# ---------- Les sources ----------


def _symbole_du_chemin(url: str) -> str:
    """Le dernier segment de l'URL : « /cours/1rPAI/ » -> « 1rPAI »."""
    segments = [segment for segment in urlparse(url).path.split("/") if segment]
    return segments[-1] if segments else ""


def _lire_yahoo(url: str) -> Cours:
    """Yahoo Finance, par son API de graphique.

    LA PAGE `finance.yahoo.com/quote/...` N'EST PAS LUE : son cours est écrit
    par du JavaScript, il n'existe pas dans le HTML qu'un GET rapporte. On lit
    donc l'API que cette page appelle elle-même, `/v8/finance/chart/SYMBOLE` —
    du JSON stable depuis des années, qui rend en prime la devise de cotation
    et le nom complet de l'instrument.

    Le symbole vient de l'URL collée : l'utilisateur n'a rien à comprendre à
    cette redirection, il colle la page qu'il consulte.
    """
    symbole = _symbole_du_chemin(url)
    if not symbole or symbole in ("quote", "quotes"):
        raise CoursIllisible(
            "Lien Yahoo incomplet : il doit désigner un titre, par exemple "
            "https://finance.yahoo.com/quote/AI.PA"
        )
    brut = telecharger(
        f"https://query1.finance.yahoo.com/v8/finance/chart/{symbole}"
        "?range=1d&interval=1d"
    )
    try:
        meta = json.loads(brut)["chart"]["result"][0]["meta"]
    except (json.JSONDecodeError, KeyError, TypeError, IndexError) as exc:
        raise CoursIllisible(
            f"Yahoo ne connaît pas le symbole « {symbole} » (ou a changé de format)"
        ) from exc

    prix = meta.get("regularMarketPrice")
    if prix is None:
        raise CoursIllisible(f"Yahoo ne publie pas de cours pour « {symbole} »")
    return Cours(
        valeur=_valider(float(prix)),
        devise=meta.get("currency"),
        libelle=meta.get("longName") or meta.get("shortName") or symbole,
        source="yahoo",
    )


# La balise qui porte le cours chez Google, et ses attributs. `data-last-price`
# n'apparaît qu'UNE FOIS par page, sur l'instrument de la page : les valeurs de
# la colonne de droite (« vous pourriez aussi suivre ») portent `data-price`,
# un attribut différent. C'est cette asymétrie qui rend l'ancre sûre.
_BALISE_COURS_GOOGLE = re.compile(r'<[a-zA-Z]+[^>]*\bdata-last-price="[^"]*"[^>]*>')
_ATTRIBUT = re.compile(r'([a-zA-Z-]+)="([^"]*)"')

# Le titre de la page, au sens ARIA : `role="heading" aria-level="1"`. Une ancre
# sémantique, pas une classe CSS — les classes de Google sont engendrées
# (`zzDege`, `YMlKec`) et changent sans prévenir, là où le rôle d'un élément
# décrit ce qu'il EST et ne bouge pas.
_TITRE_GOOGLE = re.compile(
    r'<[a-zA-Z]+[^>]*\brole="heading"[^>]*\baria-level="1"[^>]*>([^<]{1,80})<'
)


def _lire_google(url: str) -> Cours:
    """Google Finance, par les attributs de données de sa page.

    LA PAGE QUE TOUT LE MONDE TROUVE EN PREMIER, d'où sa présence ici : chercher
    le nom d'une société mène à `google.com/finance/quote/SYMBOLE:PLACE` avant
    de mener nulle part ailleurs.

    Le cours n'est pas lu dans le texte affiché (« 167,12 € », dont le format
    dépend de la langue du visiteur) mais dans `data-last-price`, l'attribut que
    la page donne à son propre script : un nombre normalisé, à point décimal,
    accompagné de `data-currency-code` et `data-exchange`. C'est du HTML, donc
    plus fragile qu'une API — mais l'ancre est une donnée machine, pas une
    apparence.

    LA PLACE DE COTATION EST VÉRIFIÉE quand l'URL en porte une (`AI:EPA`) : le
    bloc lu doit annoncer la même. Une page Google affiche une dizaine d'autres
    valeurs ; le jour où l'une d'elles porterait le même attribut, on refuserait
    de lire au lieu d'écrire le cours du voisin.
    """
    segment = _symbole_du_chemin(url)
    symbole, _, place = segment.partition(":")
    if not symbole or segment in ("finance", "quote"):
        raise CoursIllisible(
            "Lien Google Finance incomplet : il doit désigner un titre, par "
            "exemple https://www.google.com/finance/quote/AI:EPA"
        )

    html = telecharger(url)
    blocs = [
        dict(_ATTRIBUT.findall(balise))
        for balise in _BALISE_COURS_GOOGLE.findall(html)
    ]
    if place:
        blocs = [
            bloc
            for bloc in blocs
            if bloc.get("data-exchange", "").upper() == place.upper()
        ]
    if not blocs:
        raise CoursIllisible(
            f"Google Finance ne publie pas de cours pour « {segment} » : vérifie "
            "le symbole et la place de cotation dans le lien"
        )

    bloc = blocs[0]
    titres = _TITRE_GOOGLE.findall(html)
    return Cours(
        valeur=_valider(nombre_ecrit(bloc["data-last-price"])),
        # Absente sur les cryptomonnaies, présente partout ailleurs. Attention,
        # Londres est coté en `GBX` — des pence (cf. service_cours).
        devise=bloc.get("data-currency-code") or None,
        libelle=unescape(titres[0]).strip() if titres else segment,
        source="google",
    )


def _lire_boursorama(url: str) -> Cours:
    """Boursorama, par la page de cotation elle-même.

    TROIS ANCRES, DE LA PLUS SÛRE À LA PLUS FAIBLE :

    1. `data-ist-init`, le bloc JSON que la page donne à son propre script de
       cotation temps réel. On ne prend que celui dont le `symbol` est CELUI DE
       L'URL : une page en affiche une dizaine (le CAC, le Dow, les tickers du
       bandeau), et prendre le premier venu donnerait le cours d'un indice ;
    2. le balisage schema.org, présent sur les pages d'actions ;
    3. le bandeau `data-ist="SYMBOLE"`, en dernier recours.

    Les trackers et les OPCVM n'ont pas de balisage schema.org — d'où l'ordre :
    l'ancre 1 est la seule qui vaille pour tous les types d'instruments.
    """
    symbole = _symbole_du_chemin(url)
    if not symbole:
        raise CoursIllisible(
            "Lien Boursorama incomplet : il doit désigner un titre, par exemple "
            "https://www.boursorama.com/cours/1rPAI/"
        )
    html = telecharger(url)

    # La devise et le nom se lisent à part : ils vivent dans le bandeau de
    # cotation, pas dans les blocs de données. Absents, rien n'est bloqué
    # (cf. service_cours, qui ne refuse que sur une devise CONNUE et fausse).
    devise = None
    trouvee = re.search(r'c-faceplate__price-currency[^>]*>\s*([A-Za-z]{3})\s*<', html)
    if trouvee:
        devise = trouvee.group(1).upper()

    nom = None
    trouve_nom = re.search(r'c-faceplate__company-link[^>]*>\s*([^<]{1,80}?)\s*<', html)
    if trouve_nom:
        nom = unescape(trouve_nom.group(1))

    for morceau in re.finditer(r'data-ist-init="([^"]+)"', html):
        try:
            blob = json.loads(unescape(morceau.group(1)))
        except json.JSONDecodeError:
            continue
        if blob.get("symbol") == symbole and blob.get("last") is not None:
            return Cours(
                valeur=_valider(float(blob["last"])),
                devise=devise,
                libelle=nom or symbole,
                source="boursorama",
            )

    offre = _offre_schema_org(html)
    if offre is not None:
        return Cours(
            valeur=_valider(nombre_ecrit(str(offre["prix"]))),
            devise=offre["devise"] or devise,
            libelle=offre["nom"] or nom or symbole,
            source="boursorama",
        )

    bandeau = re.search(
        r'data-ist="' + re.escape(symbole) + r'".{0,800}?data-ist-last[^>]*>([^<]+)<',
        html,
        re.S,
    )
    if bandeau:
        return Cours(
            valeur=_valider(nombre_ecrit(bandeau.group(1))),
            devise=devise,
            libelle=nom or symbole,
            source="boursorama",
        )

    raise CoursIllisible(
        f"Cours introuvable dans la page Boursorama pour « {symbole} » : vérifie "
        "que le lien est bien une page de cotation"
    )


def _lire_schema_org(url: str) -> Cours:
    """Le filet : n'importe quelle page publiant un prix au format schema.org.

    C'est un standard, pas une convention interne à un site : le même code lit
    une page de cotation, une fiche de fonds, ou tout ce qui se décrit comme un
    produit avec un prix. En contrepartie il ne VÉRIFIE rien — c'est
    l'utilisateur qui a choisi la page, et le nom de l'instrument rendu avec le
    cours lui permet de constater sur-le-champ qu'il a collé le bon lien.
    """
    offre = _offre_schema_org(telecharger(url))
    if offre is None:
        raise CoursIllisible(
            "Aucun cours lisible sur cette page. Sources reconnues : Google "
            "Finance, Yahoo Finance, Boursorama, ou toute page publiant son prix "
            "au format schema.org"
        )
    return Cours(
        valeur=_valider(nombre_ecrit(str(offre["prix"]))),
        devise=offre["devise"],
        libelle=offre["nom"],
        source="schema.org",
    )


def _hote(url: str) -> str:
    return (urlparse(url).netloc or "").lower()


# Déclarées ici, servies telles quelles par GET /cours/sources : la liste des
# sources reconnues et celle affichée à l'utilisateur ne peuvent pas diverger
# si c'est la même.
SOURCES = (
    {
        "id": "google",
        "nom": "Google Finance",
        "exemple": "https://www.google.com/finance/quote/AI:EPA",
        "couvre": "actions, ETF et cryptomonnaies du monde entier",
        # Le chemin compte autant que le domaine : `google.com` sert surtout
        # autre chose, et une page de recherche collée ici n'a aucun cours à
        # donner. Sans ce filtre, elle serait quand même essayée — et l'erreur
        # rendue parlerait de Google Finance au lieu de dire ce qui manque.
        "reconnait": lambda url: (
            ".google." in f".{_hote(url)}" and urlparse(url).path.startswith("/finance")
        ),
        "lire": _lire_google,
    },
    {
        "id": "yahoo",
        "nom": "Yahoo Finance",
        "exemple": "https://finance.yahoo.com/quote/AI.PA",
        "couvre": "actions, ETF, fonds, indices et cryptos du monde entier",
        "reconnait": lambda url: _hote(url).endswith("finance.yahoo.com"),
        "lire": _lire_yahoo,
    },
    {
        "id": "boursorama",
        "nom": "Boursorama",
        "exemple": "https://www.boursorama.com/cours/1rPAI/",
        "couvre": "actions, trackers et OPCVM cotés en Europe",
        "reconnait": lambda url: _hote(url).endswith("boursorama.com"),
        "lire": _lire_boursorama,
    },
    {
        "id": "schema.org",
        "nom": "Autre page (format schema.org)",
        "exemple": "https://…",
        "couvre": "toute page publiant son prix au format standard schema.org",
        "reconnait": lambda url: True,  # le filet, toujours en dernier
        "lire": _lire_schema_org,
    },
)


def sources_publiques() -> list[dict]:
    """Les sources, sans leurs fonctions : ce que l'écran a besoin d'en savoir."""
    return [
        {cle: source[cle] for cle in ("id", "nom", "exemple", "couvre")}
        for source in SOURCES
    ]


def source_de(url: str) -> dict:
    """La source qui saura lire ce lien. Il y en a toujours une (le filet)."""
    for source in SOURCES:
        if source["reconnait"](url):
            return source
    return SOURCES[-1]


def lire_cours(url: str) -> Cours:
    """Le cours publié par cette page, ou `CoursIllisible` avec le pourquoi."""
    url = _verifier_url(url)
    return source_de(url)["lire"](url)
