/* ---------- Extension « Projets et objectifs » : ce qu'ils ont en commun ----------
 *
 * Ce fichier s'exécute APRÈS `projets.js` et `objectifs.js` (cf. le manifeste), qui
 * gardent chacun leur fonctionnement d'avant. Il ne fait que deux choses :
 *
 *   - enregistrer l'UNIQUE chargeur de l'onglet auprès du noyau, qui appelle les deux
 *     chargeurs ; les deux fichiers s'enregistraient séparément quand c'étaient deux
 *     extensions, sous deux identifiants qui n'existent plus ;
 *   - ranger les deux moitiés de la page : quand un détail s'ouvre (un projet, ou la page
 *     d'un objectif), il prend toute la largeur et l'autre moitié s'efface.
 *
 * Tout ce qu'il déclare est préfixé `po` : les scripts d'extension partagent une seule
 * portée globale (cf. extensions/README.md).
 */

async function poChargerOnglet() {
  // Les deux en parallèle : ils lisent des routes différentes et ne dépendent pas l'un de
  // l'autre (les objectifs relisent la liste des projets eux-mêmes).
  await Promise.all([loadProjets(), loadObjectifs()]);
  poMajDisposition();
}

function poDetailOuvert(id) {
  const detail = document.getElementById(id);
  return !!detail && detail.style.display !== "none";
}

/** Un détail ouvert occupe toute la largeur ; l'autre moitié se range. */
function poMajDisposition() {
  const grille = document.getElementById("po-grille");
  if (!grille) return;
  const projet = poDetailOuvert("projet-detail");
  const objectif = poDetailOuvert("objectif-detail");
  grille.classList.toggle("po-detail-projet", projet);
  grille.classList.toggle("po-detail-objectif", objectif && !projet);
}

// Les deux écrans ouvrent et ferment leur détail en posant `style.display` : on observe
// ces deux éléments plutôt que d'envelopper les fonctions de chaque fichier.
["projet-detail", "objectif-detail"].forEach((id) => {
  const detail = document.getElementById(id);
  if (!detail) return;
  new MutationObserver(poMajDisposition).observe(detail, {
    attributes: true,
    attributeFilter: ["style"],
  });
});

// L'enregistrement auprès du noyau, en FIN de fichier : `poChargerOnglet` doit exister
// au moment où on la référence. Le chargeur est rappelé à chaque ouverture de l'onglet —
// les opérations ont pu changer depuis.
BudgetApp.extensions.enregistrer("projets-objectifs", { chargeur: poChargerOnglet });
