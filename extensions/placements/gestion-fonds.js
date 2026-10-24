/* ---------- « Gestion des fonds » (extension « Placements financiers ») ----------
 *
 * UNE FENÊTRE QUI RELIE LES FONDS À DES INDICES. Le parcours complet est :
 *
 *   1. importer le fichier d'un fonds (« Importer des titres ») - celui d'un ETF qui suit l'indice
 *      physiquement, ou l'indice lui-même ;
 *   2. le TRANSFORMER EN INDICE (sur la page des titres : il change d'enveloppe et ne peut plus être
 *      détenu) ;
 *   3. l'ASSIGNER à un ETF qu'on détient, ici : la fenêtre liste tous les fonds, et chacun se
 *      calque sur un indice au choix - propriété par propriété, comme dans le panneau « Détail ».
 *
 * Les gestes du calque sont ceux de expositions.js (`expoCalque*`) : la fenêtre ne fait que les
 * héberger, une ligne par fonds, dans un `.expo-panneau`.
 *
 * Le bouton vit dans la ligne de titre de la page Placements (`.placements-titre-actions`), à côté de
 * « Vue d'ensemble ». CHARGÉ APRÈS expositions.js ; tout est préfixé `gfonds`.
 */

function gfondsEl(id) {
  return document.getElementById(id);
}

/** Un « fonds » : un ETF, un indice, ou un titre dont l'enveloppe se nomme « Fonds ». */
function gfondsEstFonds(titre) {
  return expoEstEtf(titre) || /^fonds?(\s|$)/.test(expoNormaliser(titre.type_titre_nom));
}

function gfondsOuvert() {
  return gfondsEl("placements-modale-gestion-fonds").style.display !== "none";
}

function gfondsFermer() {
  gfondsEl("placements-modale-gestion-fonds").style.display = "none";
  document.body.classList.remove("modale-ouverte");
}

function gfondsOuvrir() {
  gfondsEl("placements-modale-gestion-fonds").style.display = "";
  document.body.classList.add("modale-ouverte");
  gfondsRendre();
}

function gfondsPoserBouton() {
  if (gfondsEl("btn-gestion-fonds")) return;
  const actions = document.querySelector("#placements-vue-principale .placements-titre-actions");
  if (!actions) return;
  const bouton = document.createElement("button");
  bouton.type = "button";
  bouton.id = "btn-gestion-fonds";
  bouton.className = "placements-titre-action";
  bouton.textContent = t("Gestion des fonds");
  bouton.addEventListener("click", gfondsOuvrir);
  actions.appendChild(bouton);
}

function gfondsResumeComposition(titre) {
  const nb = Object.keys(titre.composition || {}).length;
  return nb
    ? t("{n} composant(s), {pct} % de l'indice couverts", {
        n: nb,
        pct: expoFormatPoids(titre.composition_couverture_pct ?? 0),
      })
    : t("Aucune composition");
}

/** Un fonds : son état, sa composition, et - s'il peut se calquer - le choix de l'indice. */
function gfondsLigneHtml(titre) {
  const etat = titre.est_indice ? t("indice") : titre.detenu ? t("détenu") : t("non détenu");
  return `<div class="gfonds-ligne">
    <div class="import-mapping-row">
      <span class="import-mapping-nom">${escapeHtml(titre.nom_affiche)}
        <span class="titre-renomme-etiquette">${escapeHtml(etat)}</span></span>
      <span class="hint">${escapeHtml(gfondsResumeComposition(titre))}</span>
    </div>
    ${titre.est_indice ? "" : `<div class="expo-panneau" data-titre="${titre.id}">${expoCalqueHtml(titre)}</div>`}
  </div>`;
}

function gfondsRendre() {
  const fonds = state.titres
    .filter((titre) => !titre.archivee && gfondsEstFonds(titre))
    // Les fonds qu'on détient d'abord, puis les autres ETF, puis les indices.
    .sort(
      (a, b) =>
        Number(b.detenu) - Number(a.detenu) ||
        Number(a.est_indice) - Number(b.est_indice) ||
        a.nom_affiche.localeCompare(b.nom_affiche, "fr")
    );
  const corps = gfondsEl("gfonds-corps");
  corps.innerHTML = `
    <p class="modale-texte" data-texte-cle="placements.gestion-fonds-corps"></p>
    ${
      fonds.length
        ? fonds.map(gfondsLigneHtml).join("")
        : `<span class="hint">${escapeHtml(t("Aucun fonds. Importe la composition d'un ETF, puis transforme-le en indice."))}</span>`
    }`;
  if (typeof appliquerTextes === "function") appliquerTextes(corps);
}

(function gfondsCabler() {
  const fenetre = gfondsEl("placements-modale-gestion-fonds");
  if (!fenetre) return;
  gfondsPoserBouton();
  gfondsEl("btn-gfonds-fermer").addEventListener("click", gfondsFermer);
  fenetre.addEventListener("click", async (e) => {
    if (e.target === fenetre) {
      gfondsFermer();
      return;
    }
    const appliquer = e.target.closest("[data-expo-calque-appliquer]");
    if (appliquer) {
      await expoCalqueAppliquer(appliquer);
      // Le fonds vient de changer : la fenêtre se redessine sur l'état relu.
      if (gfondsOuvert()) gfondsRendre();
    }
  });
  // Mêmes gestes que le panneau « Détail » : choisir l'indice charge la comparaison, un bouton radio
  // met l'avertissement à jour.
  fenetre.addEventListener("change", (e) => {
    const menu = e.target.closest("[data-expo-calque-indice]");
    if (menu) expoCalqueChoisir(menu);
    const radio = e.target.closest(".expo-calque-table input[type='radio']");
    if (radio) {
      const zone = radio.closest("[data-expo-calque-detail]");
      expoCalqueMajAlerte(zone, zone._cible);
    }
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && gfondsOuvert()) gfondsFermer();
  });
})();
