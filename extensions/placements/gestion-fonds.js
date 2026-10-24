/* ---------- « Gestion des fonds » (extension « Placements financiers ») ----------
 *
 * UNE FENÊTRE QUI RANGE LES FONDS : tous les titres de type fonds — ETF, fonds, et les INDICES — avec
 * ce que chacun porte (sa composition, la date de son dernier import) et, pour chacun, la possibilité
 * de le LIER À UN IMPORT de composition. Le geste ouvre l'import (import-etf.js) avec ce fonds déjà
 * prêt à recevoir :
 *
 *   - un ETF (détenu ou non) est BRANCHÉ sur l'import : il reçoit la composition du fichier en plus du
 *     fonds que le fichier décrit — c'est le cas d'une réplique synthétique, dont l'émetteur ne publie
 *     pas la composition de l'indice suivi ;
 *   - un indice est LE FONDS qui reçoit le fichier (on lui importe sa propre composition).
 *
 * L'import, lui, redemande à l'utilisateur ce que chaque fonds prend et ce qu'il garde.
 *
 * CHARGÉ APRÈS import-etf.js et expositions.js (il lit `state.titres`, `expoEstEtf`, `expoResumeTexte`
 * et `ietfOuvrir`) ; tout est préfixé `gfonds`/`GFONDS` (les scripts d'extension partagent une seule portée).
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

/** Le dernier import de composition lu sur ce fonds : d'où il vient et de quand il date. */
function gfondsDernierImport(titre) {
  const lignes = (titre.expositions || []).filter((e) => e.source && e.date_maj);
  if (!lignes.length) return "";
  const recent = lignes.reduce((a, b) => (a.date_maj >= b.date_maj ? a : b));
  return t("{source}, le {date}", { source: recent.source, date: recent.date_maj });
}

function gfondsLigneHtml(titre) {
  const nb = Object.keys(titre.composition || {}).length;
  const etat = titre.est_indice ? t("indice") : titre.detenu ? t("détenu") : t("non détenu");
  const composition = nb
    ? t("{n} composant(s), {pct} % de l'indice couverts", {
        n: nb,
        pct: expoFormatPoids(titre.composition_couverture_pct ?? 0),
      })
    : t("Aucune composition");
  const source = gfondsDernierImport(titre);
  return `<div class="import-mapping-row gfonds-ligne">
    <span class="import-mapping-nom">${escapeHtml(titre.nom_affiche)}
      <span class="titre-renomme-etiquette">${escapeHtml(etat)}</span></span>
    <span class="hint">${escapeHtml(composition)}${source ? ` — ${escapeHtml(source)}` : ""}</span>
    <button type="button" data-gfonds-lier="${titre.id}"
            title="${escapeHtml(
              titre.est_indice
                ? t("Importer un fichier de composition dans cet indice")
                : t("Brancher ce fonds sur un import : il recevra la composition du fichier")
            )}">${escapeHtml(t("Lier à un import"))}</button>
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
  gfondsEl("gfonds-corps").innerHTML = `
    <p class="modale-texte" data-texte-cle="placements.gestion-fonds-corps"></p>
    <div class="actions">
      <button type="button" class="primary" data-gfonds-importer>${escapeHtml(t("Importer une composition"))}</button>
    </div>
    ${
      fonds.length
        ? fonds.map(gfondsLigneHtml).join("")
        : `<span class="hint">${escapeHtml(t("Aucun fonds. Importe la composition d'un ETF, ou crée un indice."))}</span>`
    }`;
  if (typeof appliquerTextes === "function") appliquerTextes(gfondsEl("gfonds-corps"));
}

/** Ouvre l'import (la fenêtre de gestion se referme : on ne superpose pas deux fenêtres). */
function gfondsLancerImport(options) {
  gfondsFermer();
  ietfOuvrir(options);
}

(function gfondsCabler() {
  const fenetre = gfondsEl("placements-modale-gestion-fonds");
  if (!fenetre) return;
  gfondsEl("btn-gestion-fonds").addEventListener("click", gfondsOuvrir);
  gfondsEl("btn-gfonds-fermer").addEventListener("click", gfondsFermer);
  fenetre.addEventListener("click", (e) => {
    if (e.target === fenetre) {
      gfondsFermer();
      return;
    }
    if (e.target.closest("[data-gfonds-importer]")) {
      gfondsLancerImport({});
      return;
    }
    const lier = e.target.closest("[data-gfonds-lier]");
    if (!lier) return;
    const titre = state.titres.find((x) => x.id === Number(lier.dataset.gfondsLier));
    if (!titre) return;
    // Un indice reçoit le fichier ; un ETF s'y branche.
    gfondsLancerImport(titre.est_indice ? { principalId: titre.id } : { cibleId: titre.id });
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && gfondsOuvert()) gfondsFermer();
  });
})();
