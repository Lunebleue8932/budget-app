# Écrire une extension

Une extension est un **dossier autonome**. Le déposer ici l'ajoute à
l'application ; le retirer l'en retire, sans laisser une ligne dans le code du
noyau.

## Où vit ce dossier

Selon qu'on développe ou qu'on utilise l'application :

| | Emplacement de `extensions/` |
|---|---|
| **Développement** | à la racine du dépôt, à côté de `backend/` |
| **Application installée** | **à côté de l'exécutable**, avec `data/` |

Jamais à l'intérieur du bundle : celui-ci est extrait dans un dossier
temporaire à chaque lancement, une extension qu'on y déposerait disparaîtrait
à la fermeture (cf. `app/extensions.py::_racine_projet`).

Les extensions **ne sont pas livrées** avec l'application : le dossier arrive
vide et l'utilisateur y dépose ce qu'il télécharge. Une extension se distribue
donc en archive séparée — c'est ce que produit le job `extensions` de
`.github/workflows/build.yml`, une archive par dossier.

**Sauf en construction locale.** `desktop/construire.sh` et
`desktop/platforms/windows/construire.ps1` recopient les extensions du dépôt
— `extensions-dev/` comprise — à côté de l'exécutable produit. C'est la seule
différence entre un bundle construit chez soi et celui que publie la CI, et
c'est ce qui rend les outils de développement accessibles pendant qu'on écrit
le code. Un dossier déposé à la main dans le bundle n'est pas effacé pour
autant : le remplacement se fait extension par extension.

```
extensions/
  mon-extension/
    extension.json     obligatoire — sans lui, le dossier est ignoré
    backend.py         facultatif — doit exposer une variable `router`
    page.html          facultatif — l'écran, injecté dans l'interface
    mon-extension.js   facultatif — le comportement de cet écran
```

Deux emplacements, même format :

| Dossier | Public | Sur GitHub |
|---|---|---|
| `extensions/` | tout le monde | oui |
| `extensions-dev/` | développement | **non** (ignoré par git) |

C'est ce qui fait tenir la promesse « la version développeur n'est pas
publiée » : le code des extensions de développement n'existe pas dans le dépôt
distant, il n'est pas seulement désactivé.

## Le manifeste

```json
{
  "nom": "Placements financiers",
  "description": "Une phrase, affichée dans Paramètres → Extensions.",
  "version": "1.0.0",
  "backend": "backend.py",
  "frontend": { "html": "page.html", "js": ["placements.js"], "css": [] },
  "navigation": {
    "type": "page",
    "section": "placements",
    "libelle": "Placements financiers",
    "position": 3
  }
}
```

L'**identifiant** de l'extension est le **nom de son dossier**, jamais un champ
du manifeste : deux dossiers ne peuvent pas porter le même nom, là où un champ
recopié pourrait diverger de ce qui le contient.

### `navigation` — deux formes

Un **écran principal**, avec son bouton dans la barre du haut :

```json
{ "type": "page", "section": "placements", "libelle": "Placements", "position": 3 }
```

Le fragment `page.html` doit alors être une `<section id="section-placements">`
complète. `position` est un rang souhaité dans la barre, pas un index strict.

Une **sous-page de Paramètres** :

```json
{ "type": "parametres", "sous_section": "bdd", "libelle": "Base de données" }
```

Le fragment doit être une `<div id="sous-section-parametres-bdd" class="sous-section">`.

Sans `navigation`, l'extension n'ajoute aucun écran — c'est légitime (une
extension purement serveur, ou qui se greffe sur un écran existant).

### Se greffer sur l'écran d'une autre extension

Une extension sans `navigation` peut ajouter des éléments à l'écran d'une
autre — c'est ce que fait `placements-web` sur l'écran de `placements`. Le
noyau n'offre pas d'API pour ça ; deux prises suffisent, et elles tiennent
parce que les scripts d'extension s'exécutent dans la **portée globale**, dans
l'**ordre alphabétique des dossiers** (`placements` avant `placements-web`) :

```js
// 1. Envelopper une fonction de rendu de l'autre extension, pour reposer ses
//    propres éléments après chacun de ses passages.
const rendreOrigine = renderTitresSuivis;
window.renderTitresSuivis = function () {
  rendreOrigine.apply(this, arguments);
  maGreffe();
};

// 2. Ré-enregistrer le chargeur de l'autre extension — le noyau n'en garde
//    qu'un par extension, et le nôtre appelle le sien.
BudgetApp.extensions.enregistrer("placements", { chargeur: monChargeur });
```

Une greffe doit **vérifier ce qu'elle greffe** (`typeof loadPlacements ===
"function"`) : l'extension hôte peut être absente ou éteinte, et son absence ne
doit rien casser. Elle doit aussi consulter `BudgetApp.extensions.estActive(...)`
à chaque rendu, pour disparaître quand on la décoche sans recharger la page.

Et l'hôte peut être allumé **après** elle, au cours de la même session : le
noyau émet alors un événement, qui permet de s'accrocher en retard plutôt que
d'attendre un redémarrage.

```js
document.addEventListener("budgetapp:extension-chargee", (e) => {
  if (e.detail.id === "placements") poserGreffe(); // idempotent, obligatoirement
});
```

## Le backend

`backend.py` doit exposer une variable `router`, et **poser lui-même le
garde-fou d'activation** :

```python
from fastapi import APIRouter, Depends
from app.extensions import exiger_extension

from routeur_mon_truc import router as router_mon_truc

router = APIRouter(dependencies=[Depends(exiger_extension("mon-extension"))])
router.include_router(router_mon_truc)
```

Quelques règles qui découlent du mode de chargement :

- les imports vers le noyau sont **absolus** (`from app import crud`), jamais
  relatifs : le module n'est pas un sous-paquet de `app`, il est chargé par
  chemin de fichier ;
- les fichiers d'une extension s'importent **entre eux** par leur nom
  (`from routeur_actions import router`) — leur dossier est ajouté au
  `sys.path` ;
- ce dossier est ajouté **en fin** de `sys.path`, donc un fichier nommé
  `json.py` ne masquerait pas la bibliothèque standard, mais **deux extensions
  ne peuvent pas avoir deux fichiers de même nom**. D'où la convention de les
  préfixer : `routeur_*.py`, `service_*.py`.

## Le frontend

Les fichiers sont chargés dans cet ordre : **CSS**, puis **HTML**, puis **JS** —
le script trouve donc bien les éléments sur lesquels il pose ses écouteurs.

Le script s'exécute dans la portée globale de la page : tout ce que `app.js`
expose lui est accessible (`apiFetch`, `formatMontant`, `showMessage`,
`escapeHtml`, `state`, `t`…). Il termine en s'enregistrant :

```js
BudgetApp.extensions.enregistrer("mon-extension", { chargeur: loadMonEcran });
```

`chargeur` est rappelé **à chaque ouverture** de l'écran, comme `loadDashboard`
pour les écrans du noyau : les données ont pu changer depuis la dernière visite.

## Les données

**Une extension ne devrait pas emporter son schéma.** Les tables et les
migrations restent dans le noyau, même pour une fonctionnalité optionnelle.

C'est ce qui permet de désactiver une extension **sans rien perdre** : les
lignes dorment en base, l'écran disparaît, tout revient à la réactivation. Une
extension qui emporterait ses tables imposerait de choisir entre supprimer les
données et refuser la désactivation — les deux mauvaises réponses.

## Ce qui se passe quand ça casse

Une extension défaillante ne doit **jamais** empêcher l'application de
démarrer :

- manifeste illisible → l'extension est ignorée ;
- `backend.py` qui lève à l'import → l'erreur est collectée et affichée dans
  **Paramètres → Extensions**, les autres extensions se chargent normalement ;
- fichier frontend manquant → consigné dans la console, le reste continue.
