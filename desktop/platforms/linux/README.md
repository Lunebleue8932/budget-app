# Budget App sous Linux

## La dépendance à installer

Contrairement à Windows (WebView2 fourni avec le système) et à macOS (WebKit
intégré), **Linux n'embarque aucun moteur de rendu utilisable par
l'application**. C'est la seule chose à installer soi-même, et sans elle
l'application se ferme au démarrage.

```bash
sudo apt install gir1.2-webkit2-4.1 python3-gi python3-gi-cairo
```

```bash
sudo dnf install webkit2gtk4.1 python3-gobject
```

```bash
sudo pacman -S webkit2gtk-4.1 python-gobject
```

Sur les distributions plus anciennes, le paquet peut s'appeler
`gir1.2-webkit2-4.0` (sans le `.1`).

## Lancer

Décompresse l'archive dans un dossier où tu peux écrire — la base de données
est créée à côté de l'exécutable — puis :

```bash
./"Budget App"/"Budget App"
```

Si le fichier n'est pas exécutable après décompression :

```bash
chmod +x "Budget App/Budget App"
```

## L'ajouter au menu des applications

Facultatif : l'application se lance très bien sans. Ce script ne fait que la
rendre trouvable dans le menu.

```bash
sh desktop/platforms/linux/installer.sh
```

Tout va dans `~/.local` — **aucun `sudo`**, rien à l'échelle du système.

## Pourquoi l'icône n'est pas dans le binaire

Le format ELF n'a pas de section pour une icône, contrairement au PE de
Windows. Sous Linux, c'est le fichier `.desktop` qui porte le nom, l'icône et
la catégorie de l'application — d'où `budget-app.desktop` à côté, et le script
d'installation qui y substitue les chemins réels.

## En cas d'échec au démarrage

L'application écrit le détail dans `data/erreur.log`, à côté de l'exécutable.
Si aucune boîte de dialogue n'apparaît (ni `zenity` ni `kdialog` installés),
lance-la depuis un terminal : l'erreur s'affiche alors sur la sortie d'erreur.
