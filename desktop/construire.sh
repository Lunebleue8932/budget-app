#!/usr/bin/env sh
# Reconstruit l'application de bureau — LINUX ET macOS.
#
# À lancer depuis n'importe où :
#     sh desktop/construire.sh
#
# UN SEUL SCRIPT POUR DEUX SYSTÈMES, et c'est voulu : Linux et macOS partagent
# le même shell POSIX, les mêmes chemins et le même enchaînement d'étapes. Ce
# qui les distingue vraiment (format d'icône, bundle .app, boîte d'erreur
# native) vit dans desktop/platforms/<systeme>/ et n'a donc pas à être répété
# ici. Windows, lui, garde son propre script — PowerShell n'est pas un shell
# POSIX (cf. desktop/platforms/windows/construire.ps1).
#
# POURQUOI CE SCRIPT PLUTÔT QU'UN APPEL DIRECT À PyInstaller
#
# PyInstaller (--noconfirm) SUPPRIME l'intégralité du dossier de destination
# avant de le reconstruire — y compris le sous-dossier "data", donc la base de
# données qui vit à côté de l'exécutable (cf. backend/app/database.py : en mode
# packagé, la base est volontairement à côté de l'exe pour survivre à une mise
# à jour de l'app). Appeler PyInstaller à la main efface donc les données, sans
# le moindre avertissement.
#
# D'où la construction DANS UN DOSSIER NEUF, à côté, puis le remplacement du
# seul code dans le bundle en place. "data" n'est jamais ni supprimé ni
# déplacé : rien à restaurer, donc rien à perdre.
#
# Le script applique enfin les migrations en attente : un exécutable neuf sur
# une base ancienne échoue au premier écran concerné (« no such column: ... »),
# ce qui ressemble à un bug de l'app alors qu'il ne manque qu'un
# « alembic upgrade ».
set -eu

DOSSIER_SCRIPT=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
RACINE=$(dirname -- "$DOSSIER_SCRIPT")
SAUVEGARDES="$DOSSIER_SCRIPT/sauvegardes"
STAGING="$DOSSIER_SCRIPT/dist_nouveau"

# L'environnement virtuel du dépôt s'il existe, l'interpréteur courant sinon :
# en CI, les dépendances sont installées directement dans le Python du runner,
# il n'y a pas de .venv à trouver.
if [ -x "$RACINE/backend/.venv/bin/python" ]; then
    PYTHON="$RACINE/backend/.venv/bin/python"
else
    PYTHON=$(command -v python3 || command -v python)
fi

# macOS produit un bundle « Budget App.app », les autres un simple dossier.
if [ "$(uname -s)" = "Darwin" ]; then
    NOM_BUNDLE="Budget App.app"
else
    NOM_BUNDLE="Budget App"
fi
BUNDLE="$DOSSIER_SCRIPT/dist/$NOM_BUNDLE"
DATA="$BUNDLE/data"

# L'application verrouille ses propres bibliothèques tant qu'elle tourne : la
# remplacer sous ses pieds laisserait un bundle à moitié écrit. Mieux vaut
# refuser tout de suite, avec un message qui dit quoi faire.
if pgrep -f "Budget App" >/dev/null 2>&1; then
    echo "L'application « Budget App » est en cours d'exécution." >&2
    echo "Ferme-la puis relance ce script." >&2
    exit 1
fi

# Copie horodatée des bases, par simple prudence : le déroulé ci-dessous n'y
# touche pas, mais une reconstruction reste le moment où l'on est content d'en
# avoir une.
if [ -d "$DATA" ]; then
    mkdir -p "$SAUVEGARDES"
    HORODATAGE=$(date +%Y%m%d_%H%M%S)
    for fichier in "$DATA"/*.db; do
        [ -e "$fichier" ] || continue
        base=$(basename -- "$fichier" .db)
        cp -- "$fichier" "$SAUVEGARDES/${base}_${HORODATAGE}.db"
        echo "Sauvegarde : $SAUVEGARDES/${base}_${HORODATAGE}.db"
    done
fi

# Construction dans un dossier neuf : PyInstaller y est seul, il peut le
# nettoyer comme il l'entend sans jamais croiser "data".
rm -rf -- "$STAGING"
echo ""
echo "Reconstruction en cours..."
"$PYTHON" -m PyInstaller "$DOSSIER_SCRIPT/budget_app.spec" --noconfirm \
    --distpath "$STAGING" --workpath "$DOSSIER_SCRIPT/build"

NEUF="$STAGING/$NOM_BUNDLE"
if [ ! -d "$NEUF" ]; then
    echo "Construction incomplète ($NEUF absent) : bundle en place conservé." >&2
    exit 1
fi

# Remplacement du seul code. "data" reste où il est, intouché : on le met de
# côté le temps de l'échange, puis on le remet dans le bundle neuf.
echo ""
echo "Installation du nouveau code..."
mkdir -p -- "$DOSSIER_SCRIPT/dist"
if [ -d "$DATA" ]; then
    mv -- "$DATA" "$STAGING/data_conserve"
fi
rm -rf -- "$BUNDLE"
mv -- "$NEUF" "$BUNDLE"
if [ -d "$STAGING/data_conserve" ]; then
    mv -- "$STAGING/data_conserve" "$DATA"
fi
rm -rf -- "$STAGING"

# Mise à niveau du schéma des bases présentes à côté de l'exécutable.
if [ -d "$DATA" ]; then
    for fichier in "$DATA"/*.db; do
        [ -e "$fichier" ] || continue
        (cd "$RACINE/backend" && BUDGET_DB_PATH="$fichier" "$PYTHON" -m alembic upgrade head)
        echo "Migrations appliquées : $(basename -- "$fichier")"
    done
fi

echo ""
echo "Terminé : $BUNDLE"
echo "Une base personnelle rangée AILLEURS que dans ce dossier n'a rien à faire ici :"
echo "l'application la met à jour toute seule quand tu bascules dessus depuis le panneau"
echo "« Base de données ». Ne lance donc PAS « alembic upgrade » à la main dessus."
