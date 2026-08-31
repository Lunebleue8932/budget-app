"""Découverte et chargement des extensions.

CE QU'EST UNE EXTENSION. Un dossier autonome qui ajoute une fonctionnalité à
l'application : un manifeste `extension.json`, éventuellement un module Python
exposant un routeur FastAPI, éventuellement des fichiers frontend (HTML, JS,
CSS). Retirer le dossier retire la fonctionnalité, sans laisser de trace dans
le code du noyau — c'est la propriété qui compte, et c'est elle qui permet à
la VERSION DÉVELOPPEUR de n'être qu'un dossier de plus sur cette machine,
absent du dépôt public (cf. `extensions-dev/`, ignoré par git).

DEUX DOSSIERS, DEUX PUBLICS :

    extensions/       livrées à tout le monde (ex. Placements financiers)
    extensions-dev/   outils de développement, jamais publiés

Rien ne les distingue techniquement : même format, même chargement. Seul leur
emplacement change, et avec lui leur présence ou non dans le dépôt.

ACTIVÉE / PRÉSENTE : DEUX ÉTATS DIFFÉRENTS. Une extension présente est
INACTIVE tant que l'utilisateur ne l'a pas activée (cf. `est_active`) ; ses
routes répondent 404 et son interface n'existe pas. Une extension ABSENTE, elle,
n'a jamais existé pour l'application. La distinction compte pour les données :
désactiver ne supprime RIEN (cf. `_charger_etat`), les tables et leurs lignes
restent en base et réapparaissent intactes à la réactivation.

POURQUOI LES ROUTES SONT MONTÉES MÊME QUAND L'EXTENSION EST DÉSACTIVÉE.
Démonter un routeur FastAPI à chaud n'est pas prévu par le framework : il
faudrait redémarrer l'application à chaque bascule. Les routes sont donc
montées une fois au démarrage, derrière une dépendance qui vérifie l'état à
chaque appel (cf. `exiger_extension`) — l'utilisateur active et désactive sans
jamais relancer quoi que ce soit.
"""
import importlib.util
import json
import sys
from pathlib import Path
from typing import Optional

from fastapi import HTTPException

# Nom du manifeste que doit porter tout dossier d'extension. Un dossier qui
# n'en a pas est ignoré en silence : c'est ce qui permet d'y laisser un
# README, un dossier de travail ou un `__pycache__` sans rien casser.
FICHIER_MANIFESTE = "extension.json"

# Les deux racines scannées, dans cet ordre. « standard » d'abord pour qu'une
# extension de développement portant le même identifiant ne masque jamais une
# extension livrée par accident (cf. `decouvrir`, qui refuse le doublon).
DOSSIERS = (
    ("extensions", "standard"),
    ("extensions-dev", "developpeur"),
)


def _racine_projet() -> Path:
    """Où chercher les dossiers d'extensions.

    À CÔTÉ DE L'EXÉCUTABLE en application packagée, jamais dans le bundle.
    C'est le point qui rend les extensions installables : `sys._MEIPASS` est un
    dossier temporaire, extrait à chaque lancement et effacé à la fermeture —
    une extension qu'on y déposerait disparaîtrait avec lui, et de toute façon
    l'utilisateur n'a aucun moyen de trouver ce dossier. Même raisonnement que
    pour la base de données (cf. database._dossier_donnees_par_defaut), qui vit
    à côté de l'exe pour survivre à une mise à jour de l'application.

    En développement, la racine du dépôt, à côté de `backend/`."""
    if getattr(sys, "frozen", False):
        return Path(sys.executable).resolve().parent
    return Path(__file__).resolve().parents[2]


def preparer_dossiers() -> Path:
    """Crée le dossier `extensions/` s'il manque, et rend son chemin.

    L'application est livrée SANS AUCUNE EXTENSION : c'est à l'utilisateur d'y
    déposer celles qu'il veut. Encore faut-il que le dossier existe pour qu'il
    le trouve — un dossier absent se lit comme « cette version ne prend pas les
    extensions », alors qu'il ne manque qu'un endroit où les mettre.

    Seul `extensions/` est créé, jamais `extensions-dev/` : celui-là n'a de
    sens que sur une machine de développement, et le voir apparaître dans une
    installation ordinaire ne ferait qu'inviter à y déposer des choses qui n'y
    ont pas leur place."""
    dossier = _racine_projet() / "extensions"
    try:
        dossier.mkdir(parents=True, exist_ok=True)
    except OSError:
        # Installation en lecture seule (bundle macOS dans /Applications, dossier
        # sans droit d'écriture) : l'application doit démarrer quand même, elle
        # n'aura simplement aucune extension à découvrir.
        pass
    return dossier


class Extension:
    """Une extension découverte : son manifeste, son emplacement, son état."""

    __slots__ = ("id", "nom", "description", "version", "type", "dossier", "manifeste")

    def __init__(self, dossier: Path, manifeste: dict, type_extension: str):
        self.dossier = dossier
        self.manifeste = manifeste
        # L'identifiant vient du NOM DU DOSSIER, jamais du manifeste : c'est
        # lui qui doit être unique sur le disque, et deux dossiers différents
        # ne peuvent pas porter le même nom. Un champ `id` recopié dans le
        # manifeste aurait pu diverger du dossier qui le contient.
        self.id = dossier.name
        self.nom = manifeste.get("nom", self.id)
        self.description = manifeste.get("description", "")
        self.version = manifeste.get("version", "")
        self.type = type_extension

    @property
    def module_backend(self) -> Optional[str]:
        """Nom de fichier du module Python à charger, ou None si l'extension
        n'ajoute aucune route (une extension purement frontend est légitime)."""
        return self.manifeste.get("backend")

    @property
    def frontend(self) -> dict:
        """Fichiers à charger côté navigateur : {"js": [...], "css": [...],
        "html": "..."}. Vide pour une extension purement serveur."""
        return self.manifeste.get("frontend", {})

    @property
    def requiert_une_de(self) -> list[str]:
        """Identifiants d'extensions dont AU MOINS UNE doit être présente et
        allumée pour que celle-ci puisse servir. Vide = aucune dépendance.

        « Au moins une » et non « toutes » : la dépendance qu'on a réellement à
        exprimer est celle d'une extension qui se greffe sur d'autres écrans
        — « Lecture de cours » a besoin de titres OU de monnaies à mettre à
        jour, l'un des deux suffit à lui donner un sens. Une dépendance stricte
        s'écrit avec une liste d'un seul élément, ce qui couvre l'autre cas
        sans deuxième champ.
        """
        valeur = self.manifeste.get("requiert_une_de") or []
        # Une valeur mal formée est ignorée plutôt que fatale, comme le reste
        # du manifeste : une extension mal écrite ne bloque pas l'application.
        if not isinstance(valeur, list):
            return []
        return [str(identifiant) for identifiant in valeur]

    @property
    def navigation(self) -> Optional[dict]:
        """Où l'extension s'accroche dans l'interface, ou None si elle n'ajoute
        aucun écran. Deux formes possibles, cf. le frontend :

            {"type": "page", "section": "...", "libelle": "...", "position": n}
            {"type": "parametres", "sous_section": "...", "libelle": "..."}
        """
        return self.manifeste.get("navigation")

    def chemin_frontend(self, fichier: str) -> Optional[Path]:
        """Chemin absolu d'un fichier frontend de cette extension, ou None s'il
        sort de son dossier.

        LE CONTRÔLE N'EST PAS DÉCORATIF : ce chemin vient d'une requête HTTP
        (`/extensions/{id}/fichiers/{chemin}`). Sans lui, un `..` dans l'URL
        laisserait lire n'importe quel fichier de la machine. `resolve()` puis
        comparaison de préfixe est la seule vérification qui résiste aussi aux
        liens symboliques."""
        cible = (self.dossier / fichier).resolve()
        racine = self.dossier.resolve()
        if cible == racine or racine not in cible.parents:
            return None
        return cible if cible.is_file() else None

    def en_dict(
        self, actif: bool, annoncee: bool = True, obstacle_desactivation: Optional[str] = None
    ) -> dict:
        return {
            "id": self.id,
            "nom": self.nom,
            "description": self.description,
            "version": self.version,
            "type": self.type,
            "actif": actif,
            # « Jamais annoncée » plutôt que « annoncée » : c'est cet état-là
            # qui déclenche quelque chose côté frontend (la fenêtre de
            # lancement), et un drapeau se lit mieux quand il nomme le cas
            # qu'il provoque.
            "nouvelle": not annoncee,
            "frontend": self.frontend,
            "navigation": self.navigation,
            # De quoi cette extension a besoin, et si elle l'a : le frontend
            # grise sa case et DIT POURQUOI, plutôt que de proposer un
            # interrupteur qui ne ferait rien.
            "requiert_une_de": self.requiert_une_de,
            "dependances_ok": dependances_satisfaites(self.id),
            # Ce qui empêche de l'ÉTEINDRE, quand elle le dit (cf.
            # `obstacle_a_la_desactivation`). Même intention que le champ
            # précédent, dans l'autre sens : la case est grisée et DIT
            # pourquoi, plutôt que de refuser au moment du clic.
            "obstacle_desactivation": obstacle_desactivation,
        }


def decouvrir() -> dict[str, Extension]:
    """Toutes les extensions présentes, par identifiant.

    Un manifeste illisible (JSON invalide) est IGNORÉ plutôt que fatal : une
    extension mal formée ne doit pas empêcher l'application entière de
    démarrer, sans quoi un fichier mal enregistré rendrait le budget
    inaccessible."""
    racine = _racine_projet()
    trouvees: dict[str, Extension] = {}
    for nom_dossier, type_extension in DOSSIERS:
        base = racine / nom_dossier
        if not base.is_dir():
            continue
        for dossier in sorted(base.iterdir()):
            manifeste_json = dossier / FICHIER_MANIFESTE
            if not dossier.is_dir() or not manifeste_json.is_file():
                continue
            try:
                manifeste = json.loads(manifeste_json.read_text(encoding="utf-8"))
            except (json.JSONDecodeError, OSError):
                continue
            # Premier arrivé, premier servi : `extensions/` est scanné avant
            # `extensions-dev/`, une extension livrée ne peut donc pas être
            # remplacée en douce par une extension de développement homonyme.
            if dossier.name in trouvees:
                continue
            trouvees[dossier.name] = Extension(dossier, manifeste, type_extension)

    # L'INSTANTANÉ SERT `est_active`, appelée à chaque requête protégée : elle
    # ne peut pas se permettre de reparcourir les dossiers pour savoir qui
    # dépend de qui. Rafraîchi ici plutôt qu'au démarrage seulement, pour qu'une
    # extension déposée à chaud (cf. routers/extensions.list_extensions) entre
    # aussi dans le calcul.
    global _PRESENTES, _DEPENDANCES
    _PRESENTES = set(trouvees)
    _DEPENDANCES = {
        identifiant: extension.requiert_une_de for identifiant, extension in trouvees.items()
    }
    return trouvees


# Remplis par `decouvrir`. Vides tant qu'elle n'a pas tourné : aucune dépendance
# connue signifie alors « rien à vérifier », ce qui est le bon défaut — c'est
# l'état d'une application dont les extensions n'ont pas encore été lues.
_PRESENTES: set[str] = set()
_DEPENDANCES: dict[str, list[str]] = {}


def dependances_satisfaites(extension_id: str) -> bool:
    """Vrai si l'extension a ce dont elle a besoin pour servir.

    Une seule des extensions listées suffit, et elle doit être PRÉSENTE ET
    ALLUMÉE : une dépendance simplement posée sur le disque ne fournit ni écran
    ni données à qui s'y greffe.

    On ne regarde qu'un niveau — la dépendance d'une dépendance n'est pas
    suivie. C'est volontaire : une extension éteinte parce que SA dépendance
    manque rend déjà `est_active` faux, et la chaîne se résout donc d'elle-même
    sans qu'on ait à écrire une descente récursive (et sa protection contre les
    cycles) pour un dépôt qui compte cinq extensions.
    """
    requises = _DEPENDANCES.get(extension_id) or []
    if not requises:
        return True
    actives = _charger_etat()["actives"]
    return any(
        identifiant in _PRESENTES and actives.get(identifiant, False)
        for identifiant in requises
    )


# Extensions présentes sur le disque qui n'ont pas pu être chargées au
# démarrage, remplie par main._monter_extensions et lue par la route
# /extensions/erreurs. Vivante ici plutôt que dans main.py pour que le routeur
# puisse la lire sans importer main (qui l'importe déjà : la dépendance ne peut
# aller que dans ce sens).
ERREURS_CHARGEMENT: list[str] = []


def charger_routeur(extension: Extension):
    """Le routeur FastAPI d'une extension, ou None.

    Chargé par chemin de fichier (`spec_from_file_location`) et non par
    `import extensions.<id>` : les dossiers d'extensions ne sont pas des
    paquets Python installés, et ils ne sont pas sur le `sys.path` — en
    application packagée, ce sont même de simples données extraites du bundle.
    C'est le mécanisme qu'utilise déjà alembic pour ses fichiers de migration.

    Une extension dont le module casse à l'import est ignorée, avec son erreur
    remontée à l'appelant : là encore, une extension défaillante ne doit pas
    empêcher l'application de démarrer."""
    nom_module = extension.module_backend
    if not nom_module:
        return None, None

    chemin = extension.dossier / nom_module
    if not chemin.is_file():
        return None, f"module backend introuvable : {nom_module}"

    # Le dossier de l'extension rejoint le sys.path pour que ses fichiers
    # puissent s'importer ENTRE EUX (`from routeur_actions import router`) :
    # une extension d'un seul fichier est l'exception, pas la règle.
    #
    # AJOUTÉ EN FIN DE LISTE, jamais au début : une extension qui contiendrait
    # un `json.py` ou un `crud.py` ne doit pas pouvoir masquer le module
    # homonyme de la bibliothèque standard ou du noyau. Le revers est que deux
    # extensions ne peuvent pas avoir deux fichiers de même nom — d'où la
    # convention de préfixer les fichiers d'une extension (routeur_*, service_*).
    dossier = str(extension.dossier)
    if dossier not in sys.path:
        sys.path.append(dossier)

    # Préfixe `budget_ext_` : évite toute collision dans sys.modules avec un
    # module de l'application ou de la bibliothèque standard qui porterait le
    # même nom que l'extension.
    spec = importlib.util.spec_from_file_location(f"budget_ext_{extension.id}", chemin)
    if spec is None or spec.loader is None:
        return None, f"module backend illisible : {nom_module}"
    module = importlib.util.module_from_spec(spec)
    try:
        sys.modules[spec.name] = module
        spec.loader.exec_module(module)
    except Exception as exc:  # noqa: BLE001 — on rapporte, on ne masque pas
        sys.modules.pop(spec.name, None)
        return None, f"{type(exc).__name__} : {exc}"

    routeur = getattr(module, "router", None)
    if routeur is None:
        return None, "le module backend n'expose aucun `router`"
    # RETENU pour pouvoir lui reposer une question plus tard (cf.
    # `obstacle_a_la_desactivation`). Le module est de toute façon vivant dans
    # `sys.modules` ; cette table dit seulement lequel appartient à quelle
    # extension, ce que le préfixe `budget_ext_` ne suffirait pas à garantir.
    MODULES_CHARGES[extension.id] = module
    return routeur, None


# Le module backend de chaque extension chargée avec succès, par identifiant.
# Rempli par `charger_routeur`, au démarrage. Une extension purement frontend,
# ou dont le module a cassé, n'y figure pas.
MODULES_CHARGES: dict[str, object] = {}


def obstacle_a_la_desactivation(extension_id: str, db) -> Optional[str]:
    """Ce qui empêche d'éteindre cette extension, DIT PAR ELLE-MÊME, ou None.

    LE NOYAU NE CONNAÎT AUCUNE EXTENSION EN PARTICULIER, ici comme ailleurs :
    il se contente d'appeler `obstacle_a_la_desactivation(db)` sur le module
    backend de l'extension, si celui-ci en expose une. Une extension qui n'en
    déclare pas s'éteint sans question — c'est le cas de presque toutes, et
    c'est le bon défaut : désactiver ne supprime jamais rien.

    À QUOI ÇA SERT. Éteindre une extension doit être sans conséquence, et ça
    l'est tant qu'elle n'a fait qu'ajouter un écran. « Monnaies » est le cas
    limite : elle donne le droit d'avoir PLUSIEURS monnaies, et l'éteindre sur
    une base qui en porte déjà deux replierait l'interface sur un cas
    mono-devise qui ne décrit plus les données (cf. extensions/monnaies/
    backend.py). L'extension est la seule à pouvoir le dire, d'où la question
    qu'on lui pose plutôt qu'une règle écrite ici.

    UNE EXTENSION QUI CASSE NE VERROUILLE PAS SA PROPRE CASE. Si sa garde lève,
    on laisse passer : le panneau des Paramètres est justement l'endroit d'où
    l'on éteint ce qui ne va pas, et une exception qui interdirait ce geste
    transformerait un bug en impasse.
    """
    module = MODULES_CHARGES.get(extension_id)
    garde = getattr(module, "obstacle_a_la_desactivation", None) if module else None
    if garde is None:
        return None
    try:
        return garde(db)
    except Exception:  # noqa: BLE001 — on laisse éteindre, cf. docstring
        return None


# ---------- État : activation, et annonce déjà faite ----------
#
# Persisté DANS UN FICHIER À CÔTÉ DE LA BASE, et non dans la base elle-même :
# ce sont des préférences de l'INSTALLATION, pas des données du budget. Les
# stocker en base ferait changer les extensions actives en même temps que la
# base de données (cf. l'extension de développement « Base de données »), ce
# qui n'a aucun sens — et le ferait disparaître à la première restauration de
# sauvegarde.
#
# Deux informations, deux clés :
#
#     {"actives": {"placements": false}, "annoncees": ["placements"]}
#
# `actives` retient les DÉCISIONS explicites, dans les deux sens : rien par
# défaut, et rien veut dire inactive (cf. `est_active`). `annoncees` retient
# les extensions dont l'utilisateur a déjà vu la fenêtre d'annonce au
# lancement, pour ne pas la lui remontrer à chaque fois — voir la fenêtre et
# accepter d'allumer sont deux choses différentes, d'où les deux clés.

_NOM_FICHIER_ETAT = "extensions.json"


def _fichier_etat() -> Path:
    from .database import DEV_DB_PATH

    return DEV_DB_PATH.parent / _NOM_FICHIER_ETAT


def _charger_etat() -> dict:
    """{"actives": {id: bool}, "annoncees": {id}}.

    Un fichier absent ou abîmé rend un état vide, ce qui laisse chaque
    extension à son défaut plutôt que de tout désactiver.

    LIT AUSSI L'ANCIEN FORMAT — un dict plat {id: bool}, celui d'avant l'ajout
    des annonces. Une installation existante garde donc ses désactivations au
    lieu de tout rallumer sans prévenir ; le fichier est réécrit au nouveau
    format à la première modification.
    """
    vide = {"actives": {}, "annoncees": set()}
    try:
        contenu = json.loads(_fichier_etat().read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return vide
    if not isinstance(contenu, dict):
        return vide

    actives = contenu.get("actives")
    if not isinstance(actives, dict):
        # Ancien format : le fichier EST la table d'activation. Reconnu sur la
        # forme (des valeurs booléennes) plutôt que sur l'absence de la clé,
        # pour qu'un fichier à moitié écrit ne fasse pas passer des identifiants
        # d'extensions pour des réglages.
        actives = {
            cle: valeur
            for cle, valeur in contenu.items()
            if isinstance(valeur, bool)
        }

    annoncees = contenu.get("annoncees")
    if not isinstance(annoncees, list):
        annoncees = []

    return {
        "actives": {str(cle): bool(valeur) for cle, valeur in actives.items()},
        "annoncees": {str(identifiant) for identifiant in annoncees},
    }


def _ecrire_etat(etat: dict) -> None:
    fichier = _fichier_etat()
    fichier.parent.mkdir(parents=True, exist_ok=True)
    # `sorted` sur les annonces : un ensemble n'a pas d'ordre, et un fichier
    # dont les lignes changent de place à chaque écriture est pénible à relire
    # comme à comparer.
    contenu = {
        "actives": etat["actives"],
        "annoncees": sorted(etat["annoncees"]),
    }
    fichier.write_text(json.dumps(contenu, indent=2, ensure_ascii=False), encoding="utf-8")


def est_active(extension_id: str) -> bool:
    """INACTIVE PAR DÉFAUT : une extension ne tourne qu'après un OUI explicite.

    C'était l'inverse jusqu'ici — déposer un dossier suffisait à l'allumer, au
    motif qu'une extension qu'on vient d'installer doit se voir. Le
    raisonnement tenait tant qu'une extension ne pouvait rien faire d'autre que
    montrer un écran de plus. Il ne tient plus depuis qu'il en existe une qui
    ouvre une connexion sortante (« lecture-de-cours ») : décompresser une
    archive au mauvais endroit ne doit pas suffire à faire sortir une requête
    de la machine.

    Le consentement est donc UN GESTE, et un seul compte : choisir « Activée », dans
    la fenêtre du lancement ou dans Paramètres → Extensions. Fermer la fenêtre
    d'annonce — bouton, Échap, clic à côté — ne l'est pas : on n'active pas
    quelque chose en s'en débarrassant.

    L'extension reste bien sûr VISIBLE dans les Paramètres, avec sa
    description : elle est découvrable, simplement pas en marche.
    """
    if not _charger_etat()["actives"].get(extension_id, False):
        return False
    # Une extension dont la dépendance vient d'être éteinte s'éteint AVEC ELLE,
    # sans qu'on ait à toucher sa case : sa greffe n'a plus d'hôte, et laisser
    # ses routes répondre donnerait une fonctionnalité à moitié là. Sa case
    # reste active pour autant — rallumer l'hôte la fait revenir telle quelle.
    return dependances_satisfaites(extension_id)


def rattraper_etat_avant_opt_in() -> None:
    """Garde allumées les extensions qui tournaient déjà avant la règle ci-dessus.

    À N'EXÉCUTER QU'UNE FOIS, au démarrage (cf. main._monter_extensions), et
    c'est ce que ce code fait tout seul : il n'écrit que les décisions
    MANQUANTES, et n'a donc plus rien à faire dès le deuxième passage.

    Le repère est `annoncees` : une extension déjà annoncée à l'utilisateur
    tournait forcément — sous l'ancienne règle, être présent suffisait. La
    basculer à l'arrêt sous prétexte que personne ne l'a jamais activée
    ferait disparaître un écran dont on se sert quotidiennement, sans un mot
    d'explication, à la faveur d'une mise à jour.

    Une extension présente mais JAMAIS annoncée n'est pas rattrapée : c'est
    précisément une nouveauté, et le défaut « inactive » est celui qu'on veut
    pour elle.
    """
    etat = _charger_etat()
    manquantes = etat["annoncees"] - set(etat["actives"])
    if not manquantes:
        return
    for extension_id in manquantes:
        etat["actives"][extension_id] = True
    _ecrire_etat(etat)


def definir_active(extension_id: str, actif: bool) -> None:
    etat = _charger_etat()
    etat["actives"][extension_id] = actif
    _ecrire_etat(etat)


def est_annoncee(extension_id: str) -> bool:
    """Vrai si l'utilisateur a déjà vu — et fermé — la fenêtre annonçant cette
    extension au lancement."""
    return extension_id in _charger_etat()["annoncees"]


def marquer_annoncees(identifiants: list[str]) -> None:
    """Retient que ces extensions ont été annoncées : elles ne déclencheront
    plus la fenêtre de lancement.

    NETTOIE AU PASSAGE les identifiants qui ne correspondent plus à aucune
    extension présente. Deux effets, tous deux voulus : le fichier ne gonfle
    pas indéfiniment au fil des essais, et une extension retirée puis remise
    est de nouveau annoncée — la remettre est un geste délibéré, dont on veut
    la confirmation qu'il a été pris en compte."""
    presentes = set(decouvrir())
    etat = _charger_etat()
    etat["annoncees"] = (etat["annoncees"] | set(identifiants)) & presentes
    _ecrire_etat(etat)


def exiger_extension(extension_id: str):
    """Dépendance FastAPI : refuse l'appel si l'extension est désactivée.

    404 et non 403 : une fonctionnalité désactivée n'existe pas pour
    l'application, exactement comme si son dossier avait été retiré. Un 403
    dirait « ça existe mais tu n'y as pas droit », ce qui n'est pas le cas —
    il n'y a pas de notion de droit ici, seulement de présence.

    À poser sur le routeur entier :

        router = APIRouter(dependencies=[Depends(exiger_extension("placements"))])
    """

    def dependance() -> None:
        if not est_active(extension_id):
            raise HTTPException(status_code=404, detail="Extension désactivée")

    return dependance
