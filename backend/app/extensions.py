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

ACTIVÉE / PRÉSENTE : DEUX ÉTATS DIFFÉRENTS. Une extension présente peut être
désactivée depuis les Paramètres ; ses routes répondent alors 404 et son
interface disparaît. Une extension ABSENTE n'a jamais existé pour
l'application. La distinction compte pour les données : désactiver ne supprime
RIEN (cf. `_charger_etat`), les tables et leurs lignes restent en base et
réapparaissent intactes à la réactivation.

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

    def en_dict(self, actif: bool) -> dict:
        return {
            "id": self.id,
            "nom": self.nom,
            "description": self.description,
            "version": self.version,
            "type": self.type,
            "actif": actif,
            "frontend": self.frontend,
            "navigation": self.navigation,
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
    return trouvees


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
    return routeur, None


# ---------- État activé / désactivé ----------
#
# Persisté DANS UN FICHIER À CÔTÉ DE LA BASE, et non dans la base elle-même :
# activer une extension est une préférence de l'INSTALLATION, pas une donnée
# du budget. Le stocker en base ferait changer les extensions actives en même
# temps que la base de données (cf. l'extension de développement « Base de
# données »), ce qui n'a aucun sens — et le ferait disparaître à la première
# restauration de sauvegarde.

_NOM_FICHIER_ETAT = "extensions.json"


def _fichier_etat() -> Path:
    from .database import DEV_DB_PATH

    return DEV_DB_PATH.parent / _NOM_FICHIER_ETAT


def _charger_etat() -> dict[str, bool]:
    """{id: actif}. Un fichier absent ou abîmé rend un état vide, ce qui laisse
    chaque extension à son défaut plutôt que de tout désactiver."""
    try:
        contenu = json.loads(_fichier_etat().read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError):
        return {}
    if not isinstance(contenu, dict):
        return {}
    return {str(cle): bool(valeur) for cle, valeur in contenu.items()}


def _ecrire_etat(etat: dict[str, bool]) -> None:
    fichier = _fichier_etat()
    fichier.parent.mkdir(parents=True, exist_ok=True)
    fichier.write_text(json.dumps(etat, indent=2, ensure_ascii=False), encoding="utf-8")


def est_active(extension_id: str) -> bool:
    """ACTIVE PAR DÉFAUT. Une extension qu'on vient d'installer doit se voir :
    la découvrir dans les Paramètres pour l'allumer supposerait de savoir
    qu'elle existe. C'est la désactivation qui est un choix explicite, et c'est
    donc elle seule que le fichier d'état a besoin de retenir."""
    return _charger_etat().get(extension_id, True)


def definir_active(extension_id: str, actif: bool) -> None:
    etat = _charger_etat()
    etat[extension_id] = actif
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
