/* ---------- « Nettoyer la base » (extension « Placements financiers ») ----------
 *
 * Un bouton de « Titres suivis » relit TOUS les titres et propose des GROUPES de titres qui se ressemblent (nom
 * d'origine, croisé avec le secteur, la zone, la devise, l'enveloppe), du plus sûr au moins sûr : ceux qui ont
 * échappé au rapprochement de l'import. Pour chaque groupe, on choisit le titre à GARDER et ceux qu'on y FOND ;
 * rien n'est écrit avant le clic sur « Fusionner » (cf. service_nettoyage_titres.py pour ce que la fusion déplace).
 *
 * CHARGÉ APRÈS placements.js ; tout est préfixé `nett`/`NETT` (les scripts d'extension partagent une seule portée).
 */

let nettGroupes = [];

function nettEl(id) {
  return document.getElementById(id);
}

function nettOuvert() {
  return nettEl("placements-modale-nettoyage").style.display !== "none";
}

function nettFermer() {
  nettEl("placements-modale-nettoyage").style.display = "none";
  document.body.classList.remove("modale-ouverte");
}

async function nettOuvrir() {
  nettEl("placements-modale-nettoyage").style.display = "";
  document.body.classList.add("modale-ouverte");
  await nettCharger();
}

async function nettCharger() {
  const corps = nettEl("nett-corps");
  corps.innerHTML = `<p class="hint">${escapeHtml(t("Analyse des titres…"))}</p>`;
  try {
    nettGroupes = await apiFetch("/titres/nettoyage");
  } catch (err) {
    corps.innerHTML = "";
    showMessage(traduireMessageServeur(err.message), "error");
    return;
  }
  nettRendre();
}

function nettPastilles(m) {
  const liste = [];
  if (m.est_indice) liste.push(t("indice"));
  if (m.detenu) liste.push(t("détenu"));
  else if (m.mouvements) liste.push(t("a des mouvements"));
  if (m.part_etf) liste.push(t("part d'un ETF"));
  return liste.map((p) => `<span class="titre-renomme-etiquette">${escapeHtml(p)}</span>`).join(" ");
}

function nettMembreHtml(g, gi, m) {
  const details = [m.isin, m.monnaie, m.enveloppe, m.secteur, m.zone].filter(Boolean).map(escapeHtml).join(" · ");
  return `<div class="nett-membre">
    <label class="nett-garder"><input type="radio" name="nett-garder-${gi}" value="${m.id}" ${
      m.id === g.gardien_propose ? "checked" : ""
    } /> ${escapeHtml(t("Garder"))}</label>
    <label class="nett-fondre"><input type="checkbox" data-nett-fondre="${m.id}" ${
      m.id === g.gardien_propose ? "disabled" : "checked"
    } /> ${escapeHtml(t("Fondre"))}</label>
    <span class="nett-nom"><b>${escapeHtml(m.nom_affiche)}</b>${
      m.nom_affiche !== m.nom ? ` <span class="hint">(${escapeHtml(m.nom)})</span>` : ""
    } ${nettPastilles(m)}<br /><span class="hint">${details}</span></span>
  </div>`;
}

function nettGroupeHtml(g, gi) {
  return `<div class="nett-groupe" data-nett-groupe="${gi}">
    <div class="nett-entete">
      <span class="ietf-pastille ietf-pastille-existant">${escapeHtml(t("Note {pct} %", { pct: Math.round(g.score * 100) }))}</span>
      <span class="hint">${escapeHtml(g.raisons.join(", "))}</span>
      <button type="button" class="primary" data-nett-fusionner="${gi}">${escapeHtml(t("Fusionner"))}</button>
    </div>
    ${g.membres.map((m) => nettMembreHtml(g, gi, m)).join("")}
  </div>`;
}

function nettRendre() {
  const corps = nettEl("nett-corps");
  corps.innerHTML = nettGroupes.length
    ? `<p class="hint">${escapeHtml(t("{n} groupe(s) de titres qui se ressemblent, du plus sûr au moins sûr.", { n: nettGroupes.length }))}</p>
       ${nettGroupes.map(nettGroupeHtml).join("")}`
    : `<p class="hint">${escapeHtml(t("Aucun doublon probable : la base est propre."))}</p>`;
}

/** Le titre gardé change : on ne peut pas se fondre dans soi-même. */
function nettMajGardien(groupe) {
  const gardien = groupe.querySelector("input[type='radio']:checked").value;
  groupe.querySelectorAll("[data-nett-fondre]").forEach((c) => {
    const estGardien = c.dataset.nettFondre === gardien;
    c.disabled = estGardien;
    if (estGardien) c.checked = false;
  });
}

async function nettFusionner(gi) {
  const groupe = nettEl("nett-corps").querySelector(`[data-nett-groupe="${gi}"]`);
  const gardeId = Number(groupe.querySelector("input[type='radio']:checked").value);
  const absorbes = [...groupe.querySelectorAll("[data-nett-fondre]:checked")].map((c) => Number(c.dataset.nettFondre));
  if (!absorbes.length) {
    showMessage(t("Coche au moins un titre à fondre dans celui que tu gardes."), "error");
    return;
  }
  const garde = nettGroupes[gi].membres.find((m) => m.id === gardeId);
  if (
    !confirm(
      t("Fondre {n} titre(s) dans « {nom} » ? Leurs mouvements et leurs citations dans les ETF lui sont rattachés ; ils disparaissent.", {
        n: absorbes.length,
        nom: garde.nom_affiche,
      })
    )
  )
    return;
  try {
    const r = await apiFetch("/titres/nettoyage/fusionner", {
      method: "POST",
      body: JSON.stringify({ garder_id: gardeId, absorber_ids: absorbes }),
    });
    showMessage(t("{n} titre(s) fondu(s) dans « {nom} »", { n: r.fusionnes, nom: r.garde_nom }), "success");
    await refreshTitres();
    await nettCharger();
  } catch (err) {
    showMessage(traduireMessageServeur(err.message), "error");
  }
}

function nettPoserBouton() {
  if (nettEl("btn-nettoyage")) return;
  const bouton = nettEl("btn-titres-etf");
  if (!bouton) return;
  const nouveau = document.createElement("button");
  nouveau.type = "button";
  nouveau.id = "btn-nettoyage";
  nouveau.textContent = t("Nettoyer la base");
  nouveau.title = t("Regrouper les titres qui se ressemblent");
  nouveau.addEventListener("click", nettOuvrir);
  bouton.insertAdjacentElement("afterend", nouveau);
}

(function nettCabler() {
  const fenetre = nettEl("placements-modale-nettoyage");
  if (!fenetre) return;
  nettPoserBouton();
  nettEl("btn-nett-fermer").addEventListener("click", nettFermer);
  fenetre.addEventListener("click", (e) => {
    if (e.target === fenetre) return nettFermer();
    const bouton = e.target.closest("[data-nett-fusionner]");
    if (bouton) nettFusionner(Number(bouton.dataset.nettFusionner));
  });
  fenetre.addEventListener("change", (e) => {
    const groupe = e.target.closest("[data-nett-groupe]");
    if (groupe && e.target.matches("input[type='radio']")) nettMajGardien(groupe);
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && nettOuvert()) nettFermer();
  });
})();
