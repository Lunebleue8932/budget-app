# Budget App sous Linux

## Le paquet à installer

Windows et macOS fournissent leur moteur d'affichage ; Linux, non. C'est la
seule chose à installer, et sans elle l'application se ferme au démarrage.

Debian, Ubuntu et dérivés :

```bash
sudo apt install gir1.2-webkit2-4.1 python3-gi python3-gi-cairo
```

Fedora :

```bash
sudo dnf install webkit2gtk4.1 python3-gobject
```

Arch :

```bash
sudo pacman -S webkit2gtk-4.1 python-gobject
```

Sur une distribution plus ancienne, le paquet peut s'appeler
`gir1.2-webkit2-4.0`, sans le `.1`.

## Lancer

Décompresse l'archive dans un dossier où tu peux écrire — la base de données est
créée à côté de l'exécutable :

```bash
./"Budget App"/"Budget App"
```

Si le fichier n'est pas exécutable après décompression :

```bash
chmod +x "Budget App/Budget App"
```

## L'ajouter au menu des applications

Facultatif, et sans `sudo` — tout va dans `~/.local` :

```bash
sh desktop/platforms/linux/installer.sh
```

## Ça ne démarre pas

Le détail est écrit dans `data/erreur.log`, à côté de l'exécutable. Si aucune
fenêtre d'erreur n'apparaît (ni `zenity` ni `kdialog` installés), lance
l'application depuis un terminal : l'erreur s'affiche alors directement.
