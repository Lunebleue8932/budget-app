"""Ce qui est propre à Linux. Cf. platforms/__init__.py pour l'interface.

Sert aussi de REPLI pour tout système UNIX non reconnu (BSD…) : rien ici
n'est propre au noyau Linux, ce sont les conventions du bureau libre
(freedesktop) que partagent ces systèmes.

DÉPENDANCE SYSTÈME À CONNAÎTRE. Contrairement à Windows (WebView2 fourni avec
l'OS) et à macOS (WebKit intégré), Linux n'embarque aucun moteur de rendu
utilisable par pywebview : il faut GTK + WebKit2GTK, installés par le
gestionnaire de paquets de la distribution. C'est la seule chose que
l'utilisateur doit installer lui-même, et le README de cette plateforme la
documente distribution par distribution.
"""
import shutil
import subprocess

NOM = "Linux"

# PNG et non .ico : c'est le format des icônes freedesktop (celles que lisent
# les fichiers .desktop, GNOME et KDE). 256 px suffit, les environnements de
# bureau redimensionnent eux-mêmes.
FICHIER_ICONE = "icone.png"


def identite_application() -> None:
    """Rien à faire ici, et c'est normal.

    Sous Linux, une application ne se déclare pas au gestionnaire de fenêtres
    par un appel d'API : c'est le fichier `.desktop` posé à l'installation qui
    porte le nom, l'icône et la catégorie (cf. budget-app.desktop dans ce
    dossier). Le regroupement dans la barre de lancement se fait ensuite par
    correspondance entre la classe WM de la fenêtre et ce fichier."""


def afficher_erreur(titre: str, message: str) -> bool:
    """Boîte de dialogue via `zenity` (GTK) ou `kdialog` (KDE), si disponible.

    Aucune n'est garantie présente — ce sont des programmes, pas des API
    système. On les essaie dans l'ordre et l'on rend False si aucune n'a
    fonctionné : `app_desktop.py` retombe alors sur stderr, qui reste lisible
    puisqu'une application Linux lancée depuis un terminal en a un.

    `timeout` : un utilitaire qui ne rendrait jamais la main (serveur X absent,
    session sans bureau) bloquerait l'arrêt du programme au lieu de signaler
    l'erreur qu'on essaie justement d'afficher.
    """
    tentatives = (
        ["zenity", "--error", f"--title={titre}", f"--text={message}"],
        ["kdialog", "--error", message, "--title", titre],
    )
    for commande in tentatives:
        if shutil.which(commande[0]) is None:
            continue
        try:
            subprocess.run(commande, timeout=30, check=False)
            return True
        except Exception:
            continue
    return False


def options_pyinstaller() -> dict:
    """Options passées à EXE() par budget_app.spec.

    PAS D'OPTION `icon` : PyInstaller n'incruste pas d'icône dans un binaire
    ELF (le format n'a pas de section pour ça, contrairement au PE de Windows).
    L'icône est copiée à côté de l'exécutable et référencée par le fichier
    `.desktop` — c'est ainsi que fonctionne le bureau Linux."""
    return {
        "console": False,
        "icone_incrustee": False,
        "bundle": None,
    }
