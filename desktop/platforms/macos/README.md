# Budget App sous macOS

## Rien à installer

WebKit est fourni avec le système : l'application fonctionne telle quelle.

## Premier lancement : clic droit → Ouvrir

L'application n'est pas signée par un certificat Apple Developer, et Gatekeeper
refuse donc un double-clic simple (« impossible d'ouvrir, développeur non
identifié »).

**Clic droit sur `Budget App.app` → Ouvrir**, puis confirme. macOS retient le
choix : les lancements suivants se font normalement.

Si le message revient malgré tout — Sonoma et les versions suivantes sont plus
strictes sur les applications téléchargées :

```bash
xattr -dr com.apple.quarantine "Budget App.app"
```

Cette commande retire l'étiquette de quarantaine posée par le navigateur au
téléchargement. À ne faire, évidemment, que sur une application dont tu connais
la provenance.

## Où sont mes données

Dans `Budget App.app/Contents/MacOS/data/`. Le bundle doit donc être posé dans un
dossier où tu peux écrire : `/Applications` convient, une image disque montée en
lecture seule non.

Pour aller voir : clic droit sur l'app → **Afficher le contenu du paquet**.

## Ça ne démarre pas

Une fenêtre d'erreur s'affiche, et le détail est écrit dans
`Contents/MacOS/data/erreur.log`.
