# Budget App sous macOS

## Rien à installer

WebKit est fourni avec le système : l'application fonctionne telle quelle.

## Premier lancement : clic droit → Ouvrir

L'application **n'est pas signée** par un certificat Apple Developer (payant,
99 $/an). Gatekeeper refuse donc un double-clic simple, avec un message du
genre « impossible d'ouvrir, développeur non identifié ».

**Clic droit sur `Budget App.app` → Ouvrir**, puis confirme dans la boîte de
dialogue. macOS retient le choix : les lancements suivants se font
normalement.

Si le message persiste (macOS Sonoma et suivants sont plus stricts sur les
applications téléchargées) :

```bash
xattr -dr com.apple.quarantine "Budget App.app"
```

Cette commande retire l'attribut de quarantaine posé par le navigateur au
téléchargement. À ne faire, évidemment, que sur une application dont tu
connais la provenance.

## Où sont mes données

Dans `Budget App.app/Contents/MacOS/data/`. Le bundle doit donc être placé dans
un dossier où tu peux écrire — le glisser dans `/Applications` fonctionne, mais
pas depuis une image disque montée en lecture seule.

Pour voir dedans : clic droit sur l'app → **Afficher le contenu du paquet**.

## Pourquoi un bundle et pas un simple exécutable

macOS est le seul des trois systèmes où le Finder ne lance pas un exécutable
nu : il lance un `.app`, un dossier à structure imposée
(`Contents/MacOS`, `Contents/Resources`, `Info.plist`) qu'il présente comme un
fichier unique. C'est ce `Info.plist` qui donne à la fenêtre son nom dans le
menu et son icône dans le Dock — l'équivalent du `.desktop` sous Linux, ou de
l'icône incrustée dans l'exe sous Windows.

## En cas d'échec au démarrage

L'application affiche une boîte de dialogue native et écrit le détail dans
`Contents/MacOS/data/erreur.log`.
