"""Ce qui est propre à macOS. Cf. platforms/__init__.py pour l'interface.

macOS est le seul des trois systèmes où l'application n'est pas un dossier
contenant un exécutable, mais un BUNDLE `.app` — un dossier à structure
imposée (Contents/MacOS, Contents/Resources, Info.plist) que le Finder
présente comme un fichier unique et que le Dock sait lancer. PyInstaller sait
le produire (`BUNDLE()` dans la spec), d'où `options_pyinstaller()["bundle"]`.
"""
import subprocess

NOM = "macOS"

# .icns : le conteneur d'icônes d'Apple, seul format lu par le Finder et le
# Dock. Un .png y serait ignoré (l'application afficherait l'icône générique).
FICHIER_ICONE = "icone.icns"

# Identifiant de bundle (CFBundleIdentifier). macOS s'en sert pour rattacher
# les préférences, les autorisations et la position dans le Dock : deux
# applications qui le partageraient se marcheraient dessus. Convention Apple :
# DNS inversé.
BUNDLE_IDENTIFIER = "com.felipegarcia.budgetapp"


def identite_application() -> None:
    """Rien à faire à l'exécution.

    L'identité d'une application macOS est déclarée dans son `Info.plist`, que
    PyInstaller écrit à la construction depuis `options_pyinstaller()` — pas
    par un appel d'API au démarrage. C'est ce fichier qui donne à la fenêtre
    son nom dans le menu et son icône dans le Dock."""


def afficher_erreur(titre: str, message: str) -> bool:
    """Boîte de dialogue native via AppleScript (`osascript`), toujours présent
    sur macOS — contrairement à zenity sous Linux, aucune vérification à faire.

    Les guillemets du message sont échappés : un message d'erreur contient
    souvent un chemin ou une trace, et un guillemet non échappé casserait le
    script AppleScript au lieu d'afficher quoi que ce soit."""
    texte = message.replace("\\", "\\\\").replace('"', '\\"')
    titre_echappe = titre.replace("\\", "\\\\").replace('"', '\\"')
    script = (
        f'display dialog "{texte}" with title "{titre_echappe}" '
        'buttons {"OK"} default button "OK" with icon stop'
    )
    try:
        subprocess.run(["osascript", "-e", script], timeout=30, check=False)
        return True
    except Exception:
        return False


def options_pyinstaller() -> dict:
    """Options passées à EXE() et BUNDLE() par budget_app.spec.

    `argv_emulation=False` : cette option de PyInstaller sert à récupérer les
    fichiers ouverts par glisser-déposer sur l'icône du Dock. Budget App
    n'ouvre aucun fichier de cette façon (le relevé à importer se choisit dans
    l'application), et l'activer ajoute une attente d'événements Apple au
    démarrage."""
    return {
        "console": False,
        "argv_emulation": False,
        "bundle": {
            "name": "Budget App.app",
            "bundle_identifier": BUNDLE_IDENTIFIER,
            "info_plist": {
                # Sans cette clé, macOS ouvre une seconde icône « Python » dans
                # le Dock à côté de celle de l'application.
                "LSBackgroundOnly": False,
                "CFBundleName": "Budget App",
                "CFBundleDisplayName": "Budget App",
                # Une application non signée reste lançable (clic droit >
                # Ouvrir) ; la version sert surtout à ce que macOS distingue
                # deux copies lors d'une mise à jour.
                "CFBundleShortVersionString": "1.0.0",
                "NSHighResolutionCapable": True,
            },
        },
    }
