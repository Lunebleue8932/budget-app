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
        # `--no-markup` : zenity lit son texte comme du Pango. Un message
        # d'erreur contient volontiers des « < » ou « & » (une trace Python, un
        # chemin) ; sans cette option, zenity échouait à son tour avec « Failed
        # to set text » et la boîte affichait une erreur sur l'erreur.
        ["zenity", "--error", "--no-markup", f"--title={titre}", f"--text={message}"],
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
    `.desktop` — c'est ainsi que fonctionne le bureau Linux.

    `imports_caches` : pywebview n'importe `gi` qu'à l'exécution, depuis un
    module choisi selon le système (webview/platforms/gtk.py) — l'analyse
    statique de PyInstaller ne le voit donc pas. Sans eux, le bundle partait
    SANS PyGObject et plantait au démarrage (« No module named 'gi' »), même
    sur une machine où `python3-gi` était installé : le Python embarqué ne
    regarde jamais les paquets du Python système.

    WEBKIT N'EST PAS EMBARQUÉ, et c'est voulu : PyInstaller n'a pas de hook
    pour lui (constaté en CI : aucun `WebKit2-4.1.typelib` dans le bundle), et
    ses processus auxiliaires sont cherchés par WebKit dans le dossier système
    où il est installé. Le moteur vient donc du paquet `gir1.2-webkit2-4.1`
    que le README demande d'installer ; seul PyGObject (+ le typelib Gtk) est
    livré, parce que lui dépend de l'interpréteur embarqué."""
    return {
        "console": False,
        "icone_incrustee": False,
        "bundle": None,
        "imports_caches": [
            "gi",
            "gi.repository.Gtk",
            "gi.repository.Gdk",
            "gi.repository.GLib",
            "gi.repository.Gio",
            "gi.repository.GObject",
        ],
        # BIBLIOTHÈQUES À NE PAS LIVRER : toute la pile graphique GTK. Le hook
        # Gtk de PyInstaller embarque celles de la machine de construction
        # (Ubuntu 22.04 : glib 2.72, cairo 1.16) dans `_internal/`, que le
        # lanceur place EN TÊTE du chemin de chargement — pour l'application
        # ET pour le processus que WebKit démarre (WebKitWebProcess). Sur une
        # distribution plus récente, le WebKit du système exige des fonctions
        # que ces copies anciennes n'ont pas (`g_once_init_enter_pointer`,
        # `cairo_set_hairline`) : le processus meurt, la fenêtre reste vide
        # (constaté sur Ubuntu 24.04). Ces bibliothèques doivent venir du
        # système, toutes ensemble : elles se chargent les unes les autres.
        "binaires_exclus": (
            "libgtk-3", "libgdk-3", "libgdk_pixbuf", "libatk", "libatspi",
            "libpango", "libcairo", "libharfbuzz", "libfribidi", "libepoxy",
            "libglib-2.0", "libgobject-2.0", "libgio-2.0", "libgmodule-2.0",
            "libgthread-2.0", "libwayland",
        ),
        # Versions des typelibs que le hook Gtk de PyInstaller doit embarquer :
        # celles que demande pywebview (gtk.py).
        "hooksconfig": {
            "gi": {
                "module-versions": {
                    "Gtk": "3.0",
                    "Gdk": "3.0",
                },
            },
        },
    }
