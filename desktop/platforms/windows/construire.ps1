# Reconstruit l'application de bureau WINDOWS à partir du code courant.
#
# À lancer depuis la racine du dépôt :
#     powershell -ExecutionPolicy Bypass -File desktop\platforms\windows\construire.ps1
#
# Équivalents des autres systèmes : desktop/platforms/linux/construire.sh et
# desktop/platforms/macos/construire.sh. Les trois font la même chose et
# appellent la même spec générique (desktop/budget_app.spec) ; seul le langage
# de script et le format du bundle produit diffèrent.
#
# POURQUOI CE SCRIPT PLUTÔT QU'UN APPEL DIRECT À PyInstaller
#
# PyInstaller (--noconfirm) SUPPRIME l'intégralité de "dist\Budget App\" avant
# de la reconstruire — y compris le sous-dossier "data", donc la base de
# données qui vit à côté de l'exécutable (cf. backend/app/database.py : en mode
# packagé, la base est volontairement à côté de l'exe pour survivre à une mise
# à jour de l'app). Appeler PyInstaller à la main efface donc les données, sans
# le moindre avertissement.
#
# Pire : cette suppression échoue à mi-parcours dès qu'un fichier est
# verrouillé — l'app en cours d'exécution, ou la synchronisation OneDrive sur
# le dossier "data". Elle laisse alors un bundle à moitié effacé, qui ne
# démarre plus (« Can't find Python file ... alembic\env.py »).
#
# D'où la construction DANS UN DOSSIER NEUF, à côté, puis le remplacement du
# seul code (_internal + exe) dans le bundle en place. "data" n'est jamais ni
# supprimé ni déplacé : rien à restaurer, donc rien à perdre, et aucun verrou
# à forcer.
#
# Le script applique enfin les migrations en attente : un exécutable neuf sur
# une base ancienne échoue au premier écran concerné (« no such column: ... »),
# ce qui ressemble à un bug de l'app alors qu'il ne manque qu'un
# « alembic upgrade ».

$ErrorActionPreference = "Stop"

# Ce script vit dans desktop\platforms\windows\ : deux remontées pour
# atteindre desktop\, une troisième pour la racine du dépôt.
$DossierScript = Split-Path -Parent $MyInvocation.MyCommand.Path
$Desktop = Split-Path -Parent (Split-Path -Parent $DossierScript)
$Racine = Split-Path -Parent $Desktop
$Python = Join-Path $Racine "backend\.venv\Scripts\python.exe"
$Bundle = Join-Path $Desktop "dist\Budget App"
$Data = Join-Path $Bundle "data"
$Sauvegardes = Join-Path $Desktop "sauvegardes"

# L'exe verrouille ses propres DLL tant qu'il tourne : la suppression du
# dossier échoue alors à mi-chemin, ce qui laisse un bundle à moitié effacé.
# Mieux vaut refuser tout de suite, avec un message qui dit quoi faire.
$EnCours = Get-Process -Name "Budget App" -ErrorAction SilentlyContinue
if ($EnCours) {
    Write-Host "L'application « Budget App » est en cours d'exécution (PID $($EnCours.Id))." -ForegroundColor Red
    Write-Host "Ferme-la puis relance ce script : PyInstaller ne peut pas remplacer un bundle verrouillé."
    exit 1
}

# Copie horodatée des bases, par simple prudence : le déroulé ci-dessous n'y
# touche pas, mais une reconstruction reste le moment où l'on est content d'en
# avoir une.
if (Test-Path $Data) {
    New-Item -ItemType Directory -Force -Path $Sauvegardes | Out-Null
    $Horodatage = Get-Date -Format "yyyyMMdd_HHmmss"
    foreach ($fichier in Get-ChildItem -Path $Data -Filter *.db) {
        $cible = Join-Path $Sauvegardes "$($fichier.BaseName)_$Horodatage.db"
        Copy-Item $fichier.FullName $cible
        Write-Host "Sauvegarde : $cible"
    }
}

# Construction dans un dossier neuf : PyInstaller y est seul, il peut le
# nettoyer comme il l'entend sans jamais croiser "data" ni un fichier verrouillé.
$Staging = Join-Path $Desktop "dist_nouveau"
if (Test-Path $Staging) { Remove-Item $Staging -Recurse -Force }

Write-Host "`nReconstruction en cours..." -ForegroundColor Cyan
& $Python -m PyInstaller (Join-Path $Desktop "budget_app.spec") --noconfirm `
    --distpath $Staging --workpath (Join-Path $Desktop "build")
if ($LASTEXITCODE -ne 0) {
    Write-Host "Échec de la reconstruction. Le bundle en place n'a pas été touché." -ForegroundColor Red
    exit 1
}

$Neuf = Join-Path $Staging "Budget App"
if (-not (Test-Path (Join-Path $Neuf "_internal\alembic\env.py"))) {
    Write-Host "Construction incomplète (alembic absent) : bundle en place conservé." -ForegroundColor Red
    exit 1
}

# Remplacement du seul code. "data" reste où il est, intouché.
Write-Host "`nInstallation du nouveau code..." -ForegroundColor Cyan
New-Item -ItemType Directory -Force -Path $Bundle | Out-Null
$AncienInternal = Join-Path $Bundle "_internal"
if (Test-Path $AncienInternal) { Remove-Item $AncienInternal -Recurse -Force }
Copy-Item (Join-Path $Neuf "_internal") $Bundle -Recurse -Force
Get-ChildItem -Path $Neuf -File | ForEach-Object { Copy-Item $_.FullName $Bundle -Force }
Remove-Item $Staging -Recurse -Force

# Mise à niveau du schéma des bases présentes à côté de l'exe.
foreach ($base in Get-ChildItem -Path $Data -Filter *.db -ErrorAction SilentlyContinue) {
    $env:BUDGET_DB_PATH = $base.FullName
    Push-Location (Join-Path $Racine "backend")
    & $Python -m alembic upgrade head
    Pop-Location
    Remove-Item Env:\BUDGET_DB_PATH
    Write-Host "Migrations appliquées : $($base.Name)"
}

Write-Host "`nTerminé : $Bundle" -ForegroundColor Green
Write-Host "Une base personnelle rangée AILLEURS que dans ce dossier n'a rien à faire ici :"
Write-Host "l'application la met à jour toute seule quand tu bascules dessus depuis le panneau"
Write-Host "« Base de données » (copie horodatée prise juste avant, à côté du fichier)."
Write-Host "Ne lance donc PAS « alembic upgrade » à la main dessus."
