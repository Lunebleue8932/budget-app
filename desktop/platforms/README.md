# Ce qui diffère d'un système à l'autre

Le backend, le frontend et le lanceur `app_desktop.py` tournent tels quels sur
Windows, Linux et macOS : ils ne manipulent que des `pathlib.Path` et n'appellent
aucune API native. Ce dossier isole les trois endroits où le système impose sa
façon de faire.

| | Windows | Linux | macOS |
|---|---|---|---|
| Identité de la fenêtre | `AppUserModelID` (ctypes) | fichier `.desktop` | `Info.plist` |
| Boîte d'erreur native | `MessageBoxW` | `zenity` / `kdialog` | `osascript` |
| Icône | `.ico` dans l'exe | `.png` à côté | `.icns` dans le bundle |
| Résultat produit | dossier + `.exe` | dossier + binaire | bundle `.app` |
| Moteur de rendu | WebView2 (fourni) | WebKit2GTK **à installer** | WebKit (fourni) |

La dernière ligne est la seule qui demande quelque chose à l'utilisateur, et
seulement sous Linux : voir [linux/README.md](linux/README.md).

## L'interface commune

Chaque module de plateforme expose exactement la même chose, ce qui permet à
`app_desktop.py` de ne jamais tester `sys.platform` lui-même :

```python
NOM                       # nom lisible du système
FICHIER_ICONE             # nom du fichier icône dans ce dossier
identite_application()    # ne lève jamais
afficher_erreur(t, m)     # True si une boîte native a pu s'ouvrir
options_pyinstaller()     # dict fusionné dans budget_app.spec
```

`platforms/__init__.py` choisit le module à l'import. Linux sert de repli pour
tout UNIX non reconnu : rien dans ce module n'est propre au noyau Linux, ce sont
les conventions du bureau libre.

## Ajouter un système

1. créer `platforms/<systeme>/__init__.py` exposant l'interface ci-dessus ;
2. l'ajouter à `platforms/_charger()` — avec un **import statique**, PyInstaller
   ne suivant pas un `importlib.import_module` ;
3. ajouter le format d'icône à `desktop/generer_icone.py` ;
4. ajouter la ligne correspondante dans `.github/workflows/build.yml`.

Ni `budget_app.spec` ni `app_desktop.py` n'ont à changer.

## Construire

PyInstaller embarque l'interpréteur et les bibliothèques de la machine hôte : il
ne peut pas compiler pour un autre système. Un exécutable Linux se produit sur
Linux, un `.app` sur macOS. D'où `.github/workflows/build.yml`, qui construit les
trois sur les runners GitHub.

En local, on ne construit que pour son propre système :

```bash
sh desktop/construire.sh
```

```powershell
powershell -ExecutionPolicy Bypass -File desktop\platforms\windows\construire.ps1
```
