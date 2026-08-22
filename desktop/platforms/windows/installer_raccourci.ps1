# Crée les raccourcis de Budget App (Bureau + Menu Démarrer) vers
# l'exécutable construit par PyInstaller.
#
# Usage, depuis le dossier budget-app :
#     powershell -ExecutionPolicy Bypass -File desktop\installer_raccourci.ps1
#
# Relancer le script après un déplacement du dossier de l'application met
# simplement les raccourcis à jour (ils sont réécrits).

$ErrorActionPreference = "Stop"

$dossierDesktop = Split-Path -Parent $MyInvocation.MyCommand.Path
$exe = Join-Path $dossierDesktop "dist\Budget App\Budget App.exe"

if (-not (Test-Path $exe)) {
    Write-Error @"
Exécutable introuvable : $exe
Construis d'abord l'application :
    backend\.venv\Scripts\python.exe -m PyInstaller desktop\budget_app.spec --noconfirm --distpath desktop\dist --workpath desktop\build
"@
}

$exe = (Resolve-Path $exe).Path
$icone = Join-Path $dossierDesktop "icone.ico"
# Le dossier de travail doit être celui de l'exe : la base de test est créée
# à côté de lui (cf. app/database.py::_dossier_donnees_par_defaut).
$dossierTravail = Split-Path -Parent $exe

$cibles = @(
    (Join-Path ([Environment]::GetFolderPath("Desktop")) "Budget App.lnk"),
    (Join-Path ([Environment]::GetFolderPath("StartMenu")) "Programs\Budget App.lnk")
)

$shell = New-Object -ComObject WScript.Shell
foreach ($cible in $cibles) {
    $parent = Split-Path -Parent $cible
    if (-not (Test-Path $parent)) { New-Item -ItemType Directory -Path $parent -Force | Out-Null }

    $raccourci = $shell.CreateShortcut($cible)
    $raccourci.TargetPath = $exe
    $raccourci.WorkingDirectory = $dossierTravail
    $raccourci.Description = "Budget App - suivi de budget personnel"
    if (Test-Path $icone) { $raccourci.IconLocation = (Resolve-Path $icone).Path }
    $raccourci.Save()
    Write-Host "Raccourci cree : $cible"
}

Write-Host ""
Write-Host "Termine. L'application se lance desormais depuis le Bureau ou le menu Demarrer."
