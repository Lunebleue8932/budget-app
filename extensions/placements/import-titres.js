/* ---------- Importer des titres (extension « Placements financiers », migration 0076) ----------
 *
 * UN FICHIER EXCEL OU CSV QUI DÉCRIT DES TITRES, et aucun mouvement : une ligne par ISIN, avec
 * son enveloppe, ses répartitions (classe d'actif, zone, secteur) et, pour un ETF, le
 * dictionnaire de son indice. C'est ce qui nourrit les graphes d'exposition, que ni un relevé
 * de courtier ni une page de cours ne peuvent nourrir.
 *
 * DEUX GESTES, DANS L'ORDRE OÙ ON LES FAIT :
 *   1. LIRE le fichier — comme ailleurs, on désigne quelle colonne contient quoi, et ce format
 *      se mémorise ;
 *   2. RELIRE l'aperçu — ce que chaque ligne ferait, avant/après, puis confirmer.
 *
 * Aucun calcul ici : la lecture, le rapprochement et la validation sont au serveur
 * (service_import_titres.py). CHARGÉ APRÈS placements.js et expositions.js, dans la même portée ;
 * tout est préfixé `imt`/`IMT` (les scripts d'extension partagent une seule portée).
 */

const IMT_CLE_PRESET = "import-titres.preset";

// Les propriétés qu'une colonne peut porter, dans l'ordre du modèle Excel.
const IMT_PROPRIETES = [
  { cle: "code_isin", libelle: "ISIN", obligatoire: true },
  { cle: "nom", libelle: "Nom" },
  { cle: "monnaie", libelle: "Monnaie" },
  { cle: "enveloppe", libelle: "Enveloppe" },
  { cle: "classe_actif", libelle: "Classe d'actif" },
  { cle: "zone", libelle: "Zone géographique" },
  { cle: "secteur", libelle: "Secteur" },
  { cle: "couverture_pct", libelle: "Couverture de la composition (%)" },
  { cle: "composition", libelle: "Composition (ISIN ; poids en %)" },
  // EN DERNIER, comme au serveur : les formats enregistrés avant elle lisent toujours les
  // mêmes colonnes. Seulement pour qui a « Lecture de cours ».
  { cle: "lien_valeur", libelle: "Lien de la valeur", extension: "lecture-de-cours" },
];

// Le nombre de colonnes du premier modèle, celui d'avant « Lien de la valeur » (cf. imtCompleterFormats).
const IMT_NB_COLONNES_ORIGINE = 9;

const IMT = {
  presets: [],
  presetId: null,
  apercu: null,
  // Les numéros de ligne que l'utilisateur a DÉCOCHÉS dans l'aperçu.
  exclues: new Set(),
};

function imtEl(id) {
  return document.getElementById(id);
}

/** Les propriétés qu'une colonne peut porter ICI : sans « Lecture de cours », pas de « Lien de la valeur ». */
function imtProprietes() {
  return IMT_PROPRIETES.filter((p) => !p.extension || BudgetApp.extensions.estActive(p.extension));
}


/* ---------- Les volets ---------- */

function imtAfficher(visible) {
  const principale = imtEl("placements-vue-principale");
  const importPl = imtEl("placements-vue-import");
  const mien = imtEl("placements-vue-import-titres");
  if (principale) principale.style.display = visible ? "none" : "";
  if (importPl) importPl.style.display = "none";
  if (mien) mien.style.display = visible ? "" : "none";
}

async function imtOuvrir() {
  imtAfficher(true);
  try {
    await imtChargerPresets();
  } catch (err) {
    showMessage(traduireMessageServeur(err.message), "error");
  }
}

function imtPoserBouton() {
  if (imtEl("btn-imt-ouvrir")) return;
  const actions = document.querySelector("#placements-vue-principale .placements-titre-actions");
  if (!actions) return;
  const bouton = document.createElement("button");
  bouton.type = "button";
  bouton.id = "btn-imt-ouvrir";
  bouton.className = "placements-titre-action";
  bouton.textContent = t("Importer des titres");
  bouton.addEventListener("click", imtOuvrir);
  actions.appendChild(bouton);
}

/* ---------- Les formats (presets) ---------- */

function imtPresetCourant() {
  return IMT.presets.find((p) => p.id === IMT.presetId) || null;
}

async function imtChargerPresets() {
  let presets = await apiFetch("/import-titres/presets");
  if (!presets.length) {
    // PREMIÈRE OUVERTURE : un format qui lit les colonnes du modèle Excel, prêt à servir.
    // Créé ici plutôt que semé par migration — un preset désigne un fichier, et c'est le
    // fichier de l'utilisateur qui décide ensuite de ce qu'il vaut.
    await apiFetch("/import-titres/presets", {
      method: "POST",
      body: JSON.stringify({
        nom: t("Modèle de l'application"),
        colonnes: imtProprietes().map((p, i) => ({ index: i + 1, propriete: p.cle })),
        lignes_entete: 1,
      }),
    });
    presets = await apiFetch("/import-titres/presets");
  } else if (await imtCompleterFormats(presets)) {
    presets = await apiFetch("/import-titres/presets");
  }
  IMT.presets = presets;
  const memorise = await lirePreference(IMT_CLE_PRESET);
  IMT.presetId = presets.some((p) => p.id === memorise)
    ? memorise
    : (imtPresetCourant() || presets[0]).id;
  imtRenderPresets();
}

/**
 * LES COLONNES ARRIVÉES APRÈS COUP (« Lien de la valeur »). Un format qui lit EXACTEMENT les
 * premières colonnes de la liste, dans l'ordre (celui que l'écran a créé, ou sa copie, à
 * neuf colonnes au moins), apprend à lire les suivantes. Sans cela, ces colonnes ne seraient
 * lues par personne. Un format composé à la main n'est pas touché. Rend true si un format a
 * été complété.
 */
async function imtCompleterFormats(presets) {
  const attendues = imtProprietes();
  const aCompleter = presets.filter((p) => {
    const n = p.colonnes.length;
    return (
      n >= IMT_NB_COLONNES_ORIGINE &&
      n < attendues.length &&
      attendues.slice(0, n).every((prop, i) => p.colonnes.some((c) => c.index === i + 1 && c.propriete === prop.cle))
    );
  });
  for (const preset of aCompleter) {
    const n = preset.colonnes.length;
    await apiFetch(`/import-titres/presets/${preset.id}`, {
      method: "PUT",
      body: JSON.stringify({
        nom: preset.nom,
        colonnes: [
          ...preset.colonnes.map(({ index, propriete }) => ({ index, propriete })),
          ...attendues.slice(n).map((prop, i) => ({ index: n + i + 1, propriete: prop.cle })),
        ],
        lignes_entete: preset.lignes_entete ?? 0,
      }),
    });
  }
  return aCompleter.length > 0;
}

function imtRenderPresets() {
  const menu = imtEl("imt-preset");
  menu.innerHTML = IMT.presets
    .map((p) => `<option value="${p.id}">${escapeHtml(p.nom)}</option>`)
    .join("");
  menu.value = String(IMT.presetId);
  if (!imtEl("imt-config").hidden) imtRenderConfig();
}

function imtRenderConfig() {
  const preset = imtPresetCourant();
  if (!preset) return;
  imtEl("imt-config-nom").value = preset.nom;
  imtEl("imt-config-entete").value = preset.lignes_entete ?? 0;
  const parPropriete = Object.fromEntries(preset.colonnes.map((c) => [c.propriete, c.index]));
  imtEl("imt-config-colonnes").innerHTML = imtProprietes().map((p) => {
    const index = parPropriete[p.cle];
    return `
      <label class="imt-colonne" data-propriete="${p.cle}">
        <input type="checkbox" class="imt-colonne-lue" ${index || p.obligatoire ? "checked" : ""}
               ${p.obligatoire ? "disabled" : ""} />
        <span class="imt-colonne-nom">${escapeHtml(t(p.libelle))}</span>
        <span class="imt-colonne-numero">${escapeHtml(t("colonne"))}
          <input type="number" class="imt-colonne-index" min="1" max="200" value="${index || ""}" />
        </span>
      </label>`;
  }).join("");
}

/** Les colonnes telles que saisies : une propriété cochée ET numérotée est lue. */
function imtColonnesSaisies() {
  return [...document.querySelectorAll("#imt-config-colonnes .imt-colonne")]
    .map((ligne) => ({
      propriete: ligne.dataset.propriete,
      lue: ligne.querySelector(".imt-colonne-lue").checked,
      index: Number(ligne.querySelector(".imt-colonne-index").value),
    }))
    .filter((c) => c.lue && c.index > 0)
    .map(({ propriete, index }) => ({ index, propriete }));
}

async function imtEnregistrerConfig(nouveau) {
  const preset = imtPresetCourant();
  let nom = imtEl("imt-config-nom").value.trim();
  if (nouveau) {
    const saisi = window.prompt(t("Nom du nouveau format"), nom ? `${nom} (2)` : "");
    if (saisi === null) return;
    nom = saisi.trim();
  }
  if (!nom) {
    showMessage(t("Le format a besoin d'un nom"), "error");
    return;
  }
  const corps = JSON.stringify({
    nom,
    colonnes: imtColonnesSaisies(),
    lignes_entete: Number(imtEl("imt-config-entete").value) || 0,
  });
  try {
    const enregistre = nouveau || !preset
      ? await apiFetch("/import-titres/presets", { method: "POST", body: corps })
      : await apiFetch(`/import-titres/presets/${preset.id}`, { method: "PUT", body: corps });
    IMT.presetId = enregistre.id;
    await ecrirePreference(IMT_CLE_PRESET, IMT.presetId);
    await imtChargerPresets();
    imtEl("imt-apercu").innerHTML = "";
    IMT.apercu = null;
    showMessage(t("Format enregistré"), "success");
  } catch (err) {
    showMessage(traduireMessageServeur(err.message), "error");
  }
}

async function imtSupprimerConfig() {
  const preset = imtPresetCourant();
  if (!preset || !confirm(t("Supprimer le format « {nom} » ?", { nom: preset.nom }))) return;
  try {
    await apiFetch(`/import-titres/presets/${preset.id}`, { method: "DELETE" });
    IMT.presetId = null;
    await imtChargerPresets();
    showMessage(t("Format supprimé"), "success");
  } catch (err) {
    showMessage(traduireMessageServeur(err.message), "error");
  }
}

/* ---------- L'aperçu ---------- */

const IMT_LIBELLES_STATUT = {
  cree: "À créer",
  maj: "À modifier",
  inchange: "Inchangé",
  erreur: "Ignoré",
};

function imtNomChamp(champ) {
  const propriete = IMT_PROPRIETES.find((p) => p.cle === champ);
  return propriete ? t(propriete.libelle) : champ;
}

function imtLigneHtml(ligne) {
  const modifiable = ligne.statut === "cree" || ligne.statut === "maj";
  const changements = ligne.changements
    .map(
      (c) => `<div class="imt-changement"><span class="imt-champ">${escapeHtml(imtNomChamp(c.champ))}</span>
        ${c.avant ? `<span class="imt-avant">${escapeHtml(c.avant)}</span><span class="imt-fleche">→</span>` : ""}
        <span class="imt-apres">${escapeHtml(c.apres ?? "")}</span></div>`
    )
    .join("");
  const messages = [
    ...ligne.erreurs.map((m) => `<li class="imt-erreur">${escapeHtml(traduireMessageServeur(m))}</li>`),
    ...ligne.avertissements.map((m) => `<li class="imt-avertissement">${escapeHtml(traduireMessageServeur(m))}</li>`),
  ].join("");
  return `
    <tr class="imt-ligne imt-ligne-${ligne.statut}">
      <td>${
        modifiable
          ? `<input type="checkbox" data-imt-ligne="${ligne.ligne}" ${IMT.exclues.has(ligne.ligne) ? "" : "checked"} />`
          : ""
      }</td>
      <td class="imt-num">${ligne.ligne}</td>
      <td><code>${escapeHtml(ligne.code_isin || "")}</code></td>
      <td>${escapeHtml(ligne.nom || "")}</td>
      <td><span class="imt-statut imt-statut-${ligne.statut}">${escapeHtml(t(IMT_LIBELLES_STATUT[ligne.statut]))}</span></td>
      <td>${changements}${messages ? `<ul class="imt-messages">${messages}</ul>` : ""}</td>
    </tr>`;
}

function imtNbAppliquees() {
  if (!IMT.apercu) return 0;
  return IMT.apercu.lignes.filter(
    (l) => (l.statut === "cree" || l.statut === "maj") && !IMT.exclues.has(l.ligne)
  ).length;
}

function imtRenderApercu() {
  const zone = imtEl("imt-apercu");
  const a = IMT.apercu;
  if (!a) {
    zone.innerHTML = "";
    return;
  }
  const etiquettes = a.etiquettes_a_creer.length
    ? `<p class="hint">${escapeHtml(
        t("Étiquettes qui seront créées : {liste}", {
          liste: a.etiquettes_a_creer.map((e) => `${e.nom} (${t(IMT_NOMS_AXES[e.axe] || e.axe)})`).join(", "),
        })
      )}</p>`
    : "";
  const avertissements = a.avertissements
    .map((m) => `<p class="imt-avertissement">${escapeHtml(traduireMessageServeur(m))}</p>`)
    .join("");
  zone.innerHTML = `
    <h3>${escapeHtml(t("2. Relire l'aperçu"))}</h3>
    <div class="imt-resume">
      <span class="imt-statut imt-statut-cree">${escapeHtml(t("{n} à créer", { n: a.nb_a_creer }))}</span>
      <span class="imt-statut imt-statut-maj">${escapeHtml(t("{n} à modifier", { n: a.nb_a_modifier }))}</span>
      <span class="imt-statut imt-statut-inchange">${escapeHtml(t("{n} inchangé(s)", { n: a.nb_inchanges }))}</span>
      <span class="imt-statut imt-statut-erreur">${escapeHtml(t("{n} ignoré(s)", { n: a.nb_erreurs }))}</span>
    </div>
    ${etiquettes}${avertissements}
    <div class="imt-table-cadre">
      <table class="imt-table">
        <thead><tr><th></th><th>${escapeHtml(t("Ligne"))}</th><th>ISIN</th><th>${escapeHtml(t("Nom"))}</th><th>${escapeHtml(t("Statut"))}</th><th>${escapeHtml(t("Ce qui change"))}</th></tr></thead>
        <tbody>${a.lignes.map(imtLigneHtml).join("")}</tbody>
      </table>
    </div>
    <div class="actions">
      <button type="button" class="primary" id="btn-imt-confirmer"></button>
    </div>`;
  imtMajBoutonConfirmer();
}

const IMT_NOMS_AXES = {
  enveloppe: "Enveloppe",
  classe: "Classe d'actif",
  zone: "Zone géographique",
  secteur: "Secteur",
};

function imtMajBoutonConfirmer() {
  const bouton = imtEl("btn-imt-confirmer");
  if (!bouton) return;
  const n = imtNbAppliquees();
  bouton.disabled = n === 0;
  bouton.textContent = t("Appliquer {n} ligne(s)", { n });
}

async function imtPrevisualiser() {
  const fichier = imtEl("imt-fichier").files[0];
  if (!fichier) {
    showMessage(t("Choisis d'abord un fichier."), "error");
    return;
  }
  const preset = imtPresetCourant();
  if (!preset) return;
  const formulaire = new FormData();
  formulaire.append("fichier", fichier);
  const delimiteur = imtEl("imt-delimiteur").value;
  if (delimiteur) formulaire.append("delimiteur", delimiteur);
  try {
    IMT.apercu = await apiFetchForm(`/import-titres/presets/${preset.id}/previsualiser`, formulaire);
    IMT.exclues = new Set();
    await ecrirePreference(IMT_CLE_PRESET, IMT.presetId);
    imtRenderApercu();
  } catch (err) {
    showMessage(traduireMessageServeur(err.message), "error");
  }
}

async function imtConfirmer() {
  const fichier = imtEl("imt-fichier").files[0];
  const preset = imtPresetCourant();
  if (!fichier || !preset || !IMT.apercu) return;
  const formulaire = new FormData();
  formulaire.append("fichier", fichier);
  formulaire.append("lignes_exclues", JSON.stringify([...IMT.exclues]));
  const delimiteur = imtEl("imt-delimiteur").value;
  if (delimiteur) formulaire.append("delimiteur", delimiteur);
  try {
    const r = await apiFetchForm(`/import-titres/presets/${preset.id}/confirmer`, formulaire);
    showMessage(
      t("Import terminé : {crees} créé(s), {maj} modifié(s), {inchanges} inchangé(s), {ignores} ignoré(s)", {
        crees: r.crees,
        maj: r.mis_a_jour,
        inchanges: r.inchanges,
        ignores: r.ignores,
      }),
      "success"
    );
    IMT.apercu = null;
    imtRenderApercu();
    // Les titres, les compteurs de chaque étiquette et les étiquettes créées viennent de bouger.
    await refreshTypesTitre();
    await refreshTitres();
  } catch (err) {
    showMessage(traduireMessageServeur(err.message), "error");
  }
}

/* ---------- Les gestes ---------- */

(function imtCabler() {
  if (!imtEl("placements-vue-import-titres")) return;
  imtPoserBouton();

  imtEl("btn-imt-retour").addEventListener("click", () => imtAfficher(false));

  imtEl("imt-preset").addEventListener("change", async (e) => {
    IMT.presetId = Number(e.target.value);
    await ecrirePreference(IMT_CLE_PRESET, IMT.presetId);
    IMT.apercu = null;
    imtRenderApercu();
    if (!imtEl("imt-config").hidden) imtRenderConfig();
  });
  imtEl("btn-imt-config").addEventListener("click", () => {
    const zone = imtEl("imt-config");
    zone.hidden = !zone.hidden;
    if (!zone.hidden) imtRenderConfig();
  });
  imtEl("btn-imt-config-enregistrer").addEventListener("click", () => imtEnregistrerConfig(false));
  imtEl("btn-imt-config-nouveau").addEventListener("click", () => imtEnregistrerConfig(true));
  imtEl("btn-imt-config-supprimer").addEventListener("click", imtSupprimerConfig);

  imtEl("btn-imt-apercu").addEventListener("click", imtPrevisualiser);
  imtEl("imt-apercu").addEventListener("click", (e) => {
    if (e.target.closest("#btn-imt-confirmer")) imtConfirmer();
  });
  imtEl("imt-apercu").addEventListener("change", (e) => {
    const case_ = e.target.closest("input[data-imt-ligne]");
    if (!case_) return;
    const ligne = Number(case_.dataset.imtLigne);
    if (case_.checked) IMT.exclues.delete(ligne);
    else IMT.exclues.add(ligne);
    imtMajBoutonConfirmer();
  });
})();
