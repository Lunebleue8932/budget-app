"""Point d'entrée de Budget App en application de bureau. GÉNÉRIQUE : ce
module tourne tel quel sur Windows, Linux et macOS.

L'application reste le même serveur FastAPI qu'en développement : il n'est
simplement plus lancé à la main et plus consulté dans un navigateur. Ce
module l'enveloppe pour en faire une application de bureau classique :

1. applique les migrations Alembic sur la base ciblée (premier lancement =
   schéma créé, nouvelle version de l'app = schéma mis à jour) ;
2. démarre uvicorn sur 127.0.0.1, sur un port attribué par le système, dans
   un thread démon — aucun conflit possible avec un port déjà occupé ;
3. ouvre une fenêtre native (pywebview / Edge WebView2) sur ce serveur.

Fermer la fenêtre termine le processus : le serveur vivant dans un thread
démon s'arrête avec lui.

La base utilisée est celle que résout `app.database` (base de test à côté de
l'exécutable en mode packagé, cf. `_dossier_donnees_par_defaut`), ou celle
désignée par BUDGET_DB_PATH. La base personnelle, elle, ne se rejoint qu'en
saisissant son chemin dans le panneau "Base de données" de l'application —
elle n'est jamais mémorisée ni découverte automatiquement.

AUCUN TEST DE SYSTÈME ICI. Les trois seuls comportements qui diffèrent d'un
système à l'autre (identité auprès du gestionnaire de fenêtres, boîte
d'erreur native, empaquetage) vivent dans `platforms/`, qui expose la même
interface partout — cf. son en-tête. Ce module n'a donc jamais à savoir sur
quoi il tourne.

RIEN NE SORT DE LA MACHINE. Le serveur écoute sur 127.0.0.1 (boucle locale,
inaccessible depuis le réseau) sur un port attribué par le système, et la
seule requête émise ici est le health-check de l'application sur elle-même.
"""
import socket
import sys
import threading
import time
import traceback
import urllib.error
import urllib.request
from pathlib import Path

import platforms

TITRE = "Budget App"


def _est_packagee() -> bool:
    return getattr(sys, "frozen", False)


def _racine_ressources() -> Path:
    """Dossier où trouver les ressources embarquées (alembic, frontend) : le
    bundle extrait en mode packagé, le dossier `backend/` du repo sinon."""
    if _est_packagee():
        return Path(sys._MEIPASS)
    return Path(__file__).resolve().parents[1] / "backend"


def _preparer_import_backend() -> None:
    """En développement, `backend/` n'est pas sur le sys.path (ce script vit
    dans `desktop/`) : on l'ajoute pour pouvoir importer le paquet `app`. En
    mode packagé, `app` est déjà embarqué dans l'exécutable."""
    if not _est_packagee():
        sys.path.insert(0, str(_racine_ressources()))


def _appliquer_migrations() -> None:
    """`alembic upgrade head` par l'API Python plutôt que la ligne de commande.

    La configuration est construite en mémoire, sans alembic.ini : l'URL de
    base est de toute façon imposée par `alembic/env.py`, qui la relit depuis
    `app.database` (donc la même que celle de l'application).
    """
    from alembic import command
    from alembic.config import Config

    config = Config()
    config.set_main_option("script_location", str(_racine_ressources() / "alembic"))
    command.upgrade(config, "head")


def _socket_local() -> tuple[socket.socket, int]:
    """Réserve un port libre en le faisant choisir par le système. Le socket
    déjà lié est ensuite passé tel quel à uvicorn : aucune fenêtre entre la
    réservation et l'écoute, donc aucun risque que le port soit pris entre
    les deux."""
    sock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    sock.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    sock.bind(("127.0.0.1", 0))
    return sock, sock.getsockname()[1]


def _demarrer_serveur(sock: socket.socket) -> list[str]:
    """Démarre uvicorn dans un thread démon et renvoie une liste qui recevra
    la trace d'une éventuelle erreur du serveur.

    Sans ce relais, une exception levée dans le thread serait totalement
    silencieuse : l'attente de /health échouerait sans jamais dire pourquoi.
    """
    import uvicorn

    from app.main import app

    # log_config=None : en mode fenêtré, stdout/stderr n'existent pas et la
    # configuration de journalisation par défaut d'uvicorn écrirait dessus.
    serveur = uvicorn.Server(uvicorn.Config(app, log_config=None, access_log=False))
    erreurs: list[str] = []

    def executer() -> None:
        try:
            serveur.run(sockets=[sock])
        except Exception:
            erreurs.append(traceback.format_exc())

    threading.Thread(target=executer, daemon=True).start()
    return erreurs


def _attendre_serveur(url_sante: str, delai_max: float = 30.0) -> bool:
    limite = time.monotonic() + delai_max
    while time.monotonic() < limite:
        try:
            with urllib.request.urlopen(url_sante, timeout=1) as reponse:
                if reponse.status == 200:
                    return True
        except (urllib.error.URLError, OSError, TimeoutError):
            time.sleep(0.05)
    return False


def _signaler_erreur(message: str) -> None:
    """En mode fenêtré il n'y a ni console ni terminal : sans ça, un échec au
    démarrage serait totalement silencieux. Le détail complet part aussi dans
    un fichier à côté de la base, pour pouvoir diagnostiquer après coup.

    La boîte native est déléguée à la plateforme, qui rend False quand elle
    n'a pas pu en ouvrir une (aucun utilitaire de dialogue sous Linux, session
    sans bureau) : stderr reste alors le dernier recours — inutile dans une
    application fenêtrée, mais lisible pour qui l'a lancée d'un terminal."""
    try:
        from app.database import DEV_DB_PATH

        journal = DEV_DB_PATH.parent / "erreur.log"
        journal.write_text(message, encoding="utf-8")
        message = f"{message}\n\nDétail enregistré dans :\n{journal}"
    except Exception:
        pass

    if not platforms.afficher_erreur(f"{TITRE} — erreur", message):
        print(message, file=sys.stderr)


def main() -> int:
    platforms.identite_application()
    _preparer_import_backend()

    try:
        _appliquer_migrations()
    except Exception:
        _signaler_erreur(
            "Impossible de préparer la base de données.\n\n" + traceback.format_exc()
        )
        return 1

    sock, port = _socket_local()
    url = f"http://127.0.0.1:{port}"
    try:
        erreurs_serveur = _demarrer_serveur(sock)
    except Exception:
        _signaler_erreur("Impossible de démarrer le serveur local.\n\n" + traceback.format_exc())
        return 1

    if not _attendre_serveur(f"{url}/health"):
        detail = erreurs_serveur[0] if erreurs_serveur else "Aucune erreur remontée par le serveur."
        _signaler_erreur("Le serveur local n'a pas répondu dans le temps imparti.\n\n" + detail)
        return 1

    import webview

    webview.create_window(TITRE, url, width=1280, height=860, min_size=(900, 600))
    webview.start()
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception:
        _signaler_erreur("Erreur inattendue au démarrage.\n\n" + traceback.format_exc())
        sys.exit(1)
