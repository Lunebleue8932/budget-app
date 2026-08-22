# Budget App — application de bureau

Budget App en application de bureau, sur les **trois systèmes** : une icône à
double-cliquer, une fenêtre native. Ni terminal, ni navigateur.

C'est exactement la même application qu'en développement : le serveur FastAPI
tourne simplement à l'intérieur du processus, sur un port local attribué par
le système, et s'affiche dans une fenêtre native (WebView2 sous Windows,
WebKit sous macOS, WebKit2GTK sous Linux).

Ce fichier décrit le lanceur **générique**. Ce qui diffère d'un système à
l'autre est isolé dans [platforms/](platforms/README.md), qui documente aussi
comment construire pour chacun.

## Construire

Depuis le dossier `budget-app` :

```powershell
backend\.venv\Scripts\python.exe -m pip install -r backend\requirements-desktop.txt
backend\.venv\Scripts\python.exe -m PyInstaller desktop\budget_app.spec --noconfirm --distpath desktop\dist --workpath desktop\build
```

Résultat : `desktop\dist\Budget App\`, dossier autonome contenant
`Budget App.exe`.

## Installer les raccourcis

```powershell
powershell -ExecutionPolicy Bypass -File desktop\installer_raccourci.ps1
```

Crée les raccourcis sur le Bureau et dans le menu Démarrer. À relancer si le
dossier de l'application est déplacé.

## Où vivent les données

La base de **test** est créée automatiquement à côté de l'exécutable, dans
`desktop\dist\Budget App\data\budget_dev.db`. Elle survit aux
reconstructions de l'application (elle est en dehors du bundle).

> Le dossier de l'application doit donc rester à un emplacement accessible en
> écriture — évite `C:\Program Files`.

La base **personnelle** n'est jamais créée, copiée ni recherchée
automatiquement : elle se rejoint uniquement en saisissant son chemin dans le
panneau « Base de données » du Dashboard, et ce chemin n'est pas mémorisé
d'une session à l'autre (retour à la base de test au redémarrage).

Les migrations sont appliquées au lancement sur la base de test uniquement.
Une base personnelle créée avec une version antérieure doit être migrée à part :

```powershell
cd backend
$env:BUDGET_DB_PATH = "C:\chemin\vers\ma_base.db"
.\.venv\Scripts\python.exe -m alembic upgrade head
```

## Lancer sans construire (développement)

```powershell
backend\.venv\Scripts\python.exe desktop\app_desktop.py
```

Même fenêtre, mais sur la base de dev habituelle
(`backend\data\dev\budget_dev.db`).

## Changer l'icône

Remplace le fichier de la plateforme visée — `platforms/windows/icone.ico`,
`platforms/linux/icone.png` ou `platforms/macos/icone.icns` — puis reconstruis.

L'icône fournie est produite par `generer_icone.py`, qui écrit **les trois
formats d'un seul dessin** (bibliothèque standard uniquement, aucune
dépendance) : relancer ce script écrase les trois.

## En cas de problème au démarrage

Comme l'application n'a pas de console, une erreur au démarrage s'affiche dans
une boîte de dialogue et le détail complet est écrit dans `erreur.log`, à côté
de la base de données.
