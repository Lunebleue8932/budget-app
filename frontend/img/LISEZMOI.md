# Images de l'interface

Dépose ici les logos et pictogrammes à réutiliser dans l'app. Le dossier
`frontend/` entier est servi par FastAPI et embarqué par PyInstaller
(cf. `main.py::_dossier_frontend` et `desktop/budget_app.spec`) : un fichier
posé ici est donc accessible à `/img/<nom>` sans rien déclarer nulle part, et
part avec le bundle.

## Format attendu

**SVG**, un fichier par image, nommé en minuscules avec des tirets
(`banque-generique.svg`, `logo-app.svg`).

Deux familles, selon ce que l'image représente :

| | Pictogramme (poubelle, œil, loupe, chevron…) | Logo / marque |
|---|---|---|
| Couleur | aucune : `stroke="currentColor"`, `fill="none"` | ses couleurs propres |
| `viewBox` | `0 0 24 24` | libre, mais carré de préférence |
| Trait | `stroke-width="2"`, bouts et coins arrondis | — |
| Taille posée | par les attributs `width`/`height` à l'usage | idem |

Un pictogramme sans couleur propre hérite de celle du texte : il suit le
survol, le thème et l'état désactivé sans qu'on écrive une règle CSS. C'est la
convention des icônes déjà en ligne dans `app.js` (`ICONE_POUBELLE`,
`ICONE_OEIL`, `ICONE_LOUPE`, `ICONE_CHEVRON_*`).

Le SVG reste net à toute taille et à tout facteur d'échelle d'écran. Un PNG
n'est acceptable que pour un logo dont on n'a que du bitmap : le fournir alors
en **deux tailles** (`nom.png` et `nom@2x.png`), fond transparent.

Pas de JPEG (pas de transparence), pas de WebP (inutile ici : ces images sont
lues depuis le disque local, jamais téléchargées).

## Comment s'en servir

```html
<img src="/img/logo-app.svg" alt="" width="24" height="24" />
```

Un pictogramme qu'on veut colorer par `currentColor` doit être **inséré en
ligne** dans le HTML, pas via `<img>` : à travers une balise `img`, le SVG est
une image isolée et n'hérite d'aucune couleur de la page.
