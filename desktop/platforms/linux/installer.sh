#!/usr/bin/env sh
# Déclare Budget App auprès du bureau Linux (menu, icône, lanceur).
#
#     sh desktop/platforms/linux/installer.sh
#
# Équivalent de installer_raccourci.ps1 sous Windows. Purement facultatif :
# l'application se lance très bien en double-cliquant son exécutable. Ce script
# ne fait que la rendre trouvable dans le menu des applications.
#
# Rien n'est installé à l'échelle du système (pas de sudo, pas de /usr) : tout
# va dans ~/.local, où l'utilisateur écrit sans privilège particulier et où le
# bureau va chercher les applications personnelles.
set -eu

DOSSIER_SCRIPT=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
DESKTOP=$(dirname -- "$(dirname -- "$DOSSIER_SCRIPT")")
BUNDLE="$DESKTOP/dist/Budget App"
EXECUTABLE="$BUNDLE/Budget App"

if [ ! -x "$EXECUTABLE" ]; then
    echo "Application introuvable : $EXECUTABLE" >&2
    echo "Construis-la d'abord :  sh desktop/construire.sh" >&2
    exit 1
fi

CIBLE_APPS="$HOME/.local/share/applications"
CIBLE_ICONES="$HOME/.local/share/icons/hicolor/256x256/apps"
mkdir -p -- "$CIBLE_APPS" "$CIBLE_ICONES"

cp -- "$DOSSIER_SCRIPT/icone.png" "$CIBLE_ICONES/budget-app.png"

# Les deux chemins sont substitués ici plutôt qu'écrits en dur dans le
# .desktop : ils dépendent de l'endroit où l'utilisateur a rangé le dépôt.
# `|` comme séparateur sed, parce qu'un chemin contient des `/`.
sed -e "s|__CHEMIN_EXECUTABLE__|$EXECUTABLE|" \
    -e "s|__CHEMIN_ICONE__|$CIBLE_ICONES/budget-app.png|" \
    -- "$DOSSIER_SCRIPT/budget-app.desktop" > "$CIBLE_APPS/budget-app.desktop"
chmod +x -- "$CIBLE_APPS/budget-app.desktop"

# Rafraîchit le cache du menu quand l'outil existe : sans lui, certains bureaux
# ne voient la nouvelle entrée qu'à la session suivante. Son absence n'est pas
# une erreur — l'entrée finira par apparaître.
if command -v update-desktop-database >/dev/null 2>&1; then
    update-desktop-database "$CIBLE_APPS" >/dev/null 2>&1 || true
fi

echo "Budget App est maintenant dans ton menu d'applications."
echo "Entrée : $CIBLE_APPS/budget-app.desktop"
