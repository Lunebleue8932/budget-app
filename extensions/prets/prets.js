/**
 * Extension « Prêts » — un INTERRUPTEUR, pas un écran.
 *
 * Elle n'apporte ni page, ni table, ni route : tout ce qu'elle commande existe
 * déjà dans le noyau (les deux types d'opération « Prêt reçu » et
 * « Remboursement de prêt », leurs deux onglets de la page Opérations, le
 * calcul des intérêts). Ce que l'extension décide, c'est si tout cela est
 * ACCESSIBLE et si cela COMPTE.
 *
 * POURQUOI LE SCHÉMA RESTE AU NOYAU. C'est la règle générale des extensions
 * (cf. extensions/README.md) et elle a ici une conséquence précise : éteindre
 * « Prêts » ne supprime aucun prêt déjà saisi. Les lignes dorment en base et
 * reviennent intactes à la réactivation.
 *
 * CE QUE FAIT CE FICHIER. Les éléments qui appartiennent à l'extension sont
 * écrits dans `index.html` avec `display:none` et un attribut que le noyau
 * connaît :
 *
 *   - `data-extension="prets"`      sur les BOUTONS (onglets de la page
 *                                   Opérations, boutons de type du formulaire) ;
 *   - `data-extension-onglet="prets"` sur les deux VOLETS de ces onglets, pour
 *                                   qu'éteindre l'extension pendant qu'on les
 *                                   regarde ne laisse pas un écran vide.
 *
 * `majVisibilite` les allume tous d'un coup — c'est exactement ce que le noyau
 * appelle déjà quand on éteint l'extension depuis les Paramètres. Ce fichier
 * n'étant chargé QUE si l'extension est allumée (cf. extensions.js), sa seule
 * exécution vaut « allume-les ».
 *
 * PAS DE `chargeur` À ENREGISTRER : l'extension n'a pas d'écran à elle, donc
 * aucun écran dont l'ouverture aurait quelque chose à recharger.
 */
BudgetApp.extensions.majVisibilite("prets", true);

// LES MENUS CONSTRUITS EN JS n'ont besoin de rien ici. Le sélecteur de type de
// l'import se fabrique à l'ouverture de chaque ligne, celui de l'éditeur de
// règles à chaque ouverture de son écran : tous deux consultent
// `pretsAccessibles()` (app.js) au moment où ils se remplissent, et prennent
// donc en compte l'allumage sans qu'on ait à recharger la page.
