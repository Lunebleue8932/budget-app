# L'application de bureau

Une icône à double-cliquer et une fenêtre native, sur les trois systèmes. Ni
terminal, ni navigateur à ouvrir.

C'est la même application qu'en développement : le serveur tourne à l'intérieur
du processus, sur un port local attribué par le système, et s'affiche dans une
fenêtre native — WebView2 sous Windows, WebKit sous macOS, WebKit2GTK sous Linux.

Ce qui diffère d'un système à l'autre est isolé dans
[platforms/](platforms/README.md).

## Construire

Depuis le dossier `budget-app` :

```powershell
backend\.venv\Scripts\python.exe -m pip install -r backend\requirements.txt -r backend\requirements-desktop.txt
powershell -ExecutionPolicy Bypass -File desktop\platforms\windows\construire.ps1
```

```bash
backend/.venv/bin/pip install -r backend/requirements.txt -r backend/requirements-desktop.txt
sh desktop/construire.sh
```

Le résultat est un dossier autonome dans `desktop/dist/Budget App/`.

Sous Windows, `desktop\platforms\windows\installer_raccourci.ps1` pose les
raccourcis sur le Bureau et dans le menu Démarrer. À relancer si le dossier de
l'application est déplacé. L'équivalent Linux est
`desktop/platforms/linux/installer.sh`.

## Où vivent les données

La base est créée au premier lancement dans `Budget App/data/`, **à côté** de
l'exécutable et non dedans : elle survit ainsi aux reconstructions. Le dossier de
l'application doit donc être accessible en écriture — évite `C:\Program Files`.

Les migrations de schéma sont appliquées automatiquement au lancement, sur cette
base-là.

## Lancer sans construire

```powershell
backend\.venv\Scripts\python.exe desktop\app_desktop.py
```

Même fenêtre, mais sur la base de développement (`backend/data/dev/`).

## Changer l'icône

Remplace le fichier de la plateforme visée (`platforms/windows/icone.ico`,
`platforms/linux/icone.png`, `platforms/macos/icone.icns`) puis reconstruis.
`generer_icone.py` écrit les trois formats d'un même dessin — le relancer les
écrase tous les trois.

## Une erreur au démarrage

L'application n'a pas de console : une erreur au démarrage ouvre une boîte de
dialogue, et le détail complet part dans `erreur.log`, à côté de la base.
