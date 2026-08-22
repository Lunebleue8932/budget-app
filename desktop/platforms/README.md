# Code spécifique à chaque système

Presque tout Budget App est **générique** : le backend, le frontend et le
lanceur `app_desktop.py` tournent tels quels sur Windows, Linux et macOS. Ils
ne manipulent que des `pathlib.Path` et n'appellent aucune API native.

Ce dossier isole les **trois** endroits où le système impose sa façon de faire.

## Ce qui diffère, et pourquoi

| | Windows | Linux | macOS |
|---|---|---|---|
| **Identité de la fenêtre** | `AppUserModelID` via `ctypes` | rien à l'exécution : fichier `.desktop` | rien à l'exécution : `Info.plist` |
| **Boîte d'erreur native** | `MessageBoxW` | `zenity` ou `kdialog`, sinon stderr | `osascript` |
| **Icône** | `.ico` incrusté dans l'exe | `.png` à côté, référencé par le `.desktop` | `.icns` dans le bundle |
| **Résultat produit** | dossier + `.exe` | dossier + binaire ELF | bundle `.app` |
| **Moteur de rendu** | WebView2 (fourni par l'OS) | **WebKit2GTK à installer** | WebKit (fourni par l'OS) |

Le troisième point est le seul qui demande quelque chose à l'utilisateur, et
uniquement sous Linux : voir [linux/README.md](linux/README.md).

## L'interface commune

Chaque module de plateforme expose exactement la même chose, et c'est ce qui
permet à `app_desktop.py` de **ne jamais tester `sys.platform` lui-même** :

```python
NOM                       # str, nom lisible du système
FICHIER_ICONE             # str, nom du fichier icône dans ce dossier
identite_application()    # None, jamais bloquant
afficher_erreur(t, m)     # bool, True si une boîte native a pu s'ouvrir
options_pyinstaller()     # dict, fusionné dans budget_app.spec
```

`platforms/__init__.py` choisit le module au moment de l'import et réexpose
cette interface. Linux sert de repli pour tout UNIX non reconnu (BSD…) : rien
dans ce module n'est propre au noyau Linux, ce sont les conventions du bureau
libre.

## Ajouter un système

1. créer `platforms/<systeme>/__init__.py` exposant l'interface ci-dessus ;
2. l'ajouter aux trois branches de `platforms/_charger()` — **imports
   statiques obligatoires**, PyInstaller n'exécute pas le code qu'il analyse et
   ne verrait pas un `importlib.import_module` ;
3. ajouter le format d'icône à `desktop/generer_icone.py` ;
4. ajouter la ligne correspondante à la matrice de
   `.github/workflows/build.yml`.

Ni `budget_app.spec` ni `app_desktop.py` n'ont à être modifiés : c'est tout
l'objet de cette séparation.

## Construire

PyInstaller **ne sait pas compiler pour un autre système que le sien** : il
embarque l'interpréteur et les bibliothèques natives de la machine hôte. Un
exécutable Linux ne peut donc être produit que sur Linux, un `.app` que sur
macOS.

C'est la raison d'être de `.github/workflows/build.yml`, qui construit les
trois sur les runners GitHub. En local, on ne construit que pour son propre
système :

```bash
sh desktop/construire.sh                    # Linux, macOS
```

```powershell
powershell -ExecutionPolicy Bypass -File desktop\platforms\windows\construire.ps1
```
