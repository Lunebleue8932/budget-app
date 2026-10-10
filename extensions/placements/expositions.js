/* ---------- Le détail d'un titre : ses répartitions et, pour un ETF, sa composition ----------
 *
 * UN TITRE SE DÉCRIT SUR TROIS AXES D'EXPOSITION — classe d'actif, zone géographique,
 * secteur — et sur chacun c'est une RÉPARTITION en % (migration 0076) : une action
 * en direct y est à 100 % sur une étiquette, un ETF World est 65 % États-Unis, 15 %
 * Europe… Ce panneau, déplié sous la ligne du titre, les édite un axe à la fois.
 *
 * RIEN N'EST RENORMALISÉ, ni ici ni au serveur : le total est affiché tel quel, et ce
 * qui manque pour atteindre 100 % est dit « non renseigné » — c'est ce que les
 * graphes montreront aussi, plutôt que d'étirer ce qu'on connaît sur tout le titre.
 * Les poids se saisissent en POURCENT : « 65 » et non « 0,65 ».
 *
 * LE DICTIONNAIRE D'UN ETF (les ISIN du haut de l'indice et leur poids) n'apparaît que
 * pour un titre dont l'enveloppe se nomme « ETF » : c'est une enveloppe que chacun
 * nomme à sa façon, la détection se fait donc sur le libellé (sans casse ni accents).
 * Le serveur, lui, accepte une composition sur n'importe quel titre.
 *
 * CHARGÉ APRÈS placements.js, dans la même portée : il lit `state.titres`,
 * `AXES_ETIQUETTE` et `optionsTypesTitre`. Tout est préfixé `expo` (les scripts
 * d'extension partagent une seule portée, cf. extensions/README.md).
 */

const EXPO_AXES = [
  {
    axe: "classe",
    titre: "Classe d'actif",
    aide: "placements.repartition-classe",
    nouvelle: "Ajouter une classe",
  },
  {
    axe: "zone",
    titre: "Zone géographique",
    aide: "placements.repartition-zone",
    nouvelle: "Ajouter une zone",
  },
  {
    axe: "secteur",
    titre: "Secteur",
    aide: "placements.repartition-secteur",
    nouvelle: "Ajouter un secteur",
  },
];

// Les titres dont le panneau est déplié. Un `Set` d'identifiants : il survit à un
// rechargement de la liste, qui redessine toutes les lignes.
const expoOuverts = new Set();

// La part de l'indice qu'un dictionnaire cherche à couvrir par défaut (cf.
// constants.COUVERTURE_COMPOSITION_DEFAUT, côté serveur).
const EXPO_COUVERTURE_DEFAUT = 60;

function expoNormaliser(texte) {
  return String(texte || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .trim();
}

/** Vrai pour un titre dont l'enveloppe se nomme « ETF » (ou « ETFs », « ETF actions »…). */
function expoEstEtf(titre) {
  return /^etf/.test(expoNormaliser(titre.type_titre_nom));
}

function expoNombre(valeur) {
  // « 12,5 » comme « 12.5 » : la virgule est le séparateur décimal de l'application.
  return parseFloat(String(valeur).replace(",", "."));
}

function expoFormatPoids(valeur) {
  return `${FORMAT_POURCENTAGE.format(valeur || 0)}`;
}

/* ---------- Une répartition ---------- */

function expoLigneHtml(axe, ligne) {
  return `
    <div class="expo-ligne">
      <select class="expo-etiquette">${optionsTypesTitre(ligne ? ligne.type_titre_id : null, axe)}</select>
      <input type="number" class="expo-poids" step="0.1" min="0" max="100"
             value="${ligne ? ligne.poids_pct : ""}" placeholder="%"
             title="${escapeHtml(t("Poids en pourcentage"))}" />
      <span class="expo-pourcent">%</span>
      <button type="button" class="expo-retirer" data-expo-retirer
              title="${escapeHtml(t("Retirer cette ligne"))}">×</button>
    </div>`;
}

function expoAxeHtml(titre, config) {
  const lignes = (titre.expositions || []).filter((e) => e.axe === config.axe);
  return `
    <div class="expo-axe" data-axe="${config.axe}">
      <div class="expo-axe-titre">
        ${escapeHtml(t(config.titre))}<i class="info-bulle" tabindex="0" data-info-cle="${config.aide}">i</i>
      </div>
      <div class="expo-lignes">${lignes.map((l) => expoLigneHtml(config.axe, l)).join("")}</div>
      <div class="expo-total" data-expo-total></div>
      <div class="expo-actions">
        <button type="button" data-expo-ajouter>${escapeHtml(t(config.nouvelle))}</button>
        <button type="button" class="primary" data-expo-enregistrer>${escapeHtml(t("Enregistrer"))}</button>
      </div>
    </div>`;
}

/** Ce que le panneau lit : les lignes d'un axe, telles que saisies (les incomplètes sont écartées). */
function expoLignesSaisies(axeEl) {
  return [...axeEl.querySelectorAll(".expo-ligne")]
    .map((ligne) => ({
      type_titre_id: Number(ligne.querySelector(".expo-etiquette").value),
      poids_pct: expoNombre(ligne.querySelector(".expo-poids").value),
    }))
    .filter((l) => l.type_titre_id && !Number.isNaN(l.poids_pct));
}

function expoMajTotal(axeEl) {
  const lignes = expoLignesSaisies(axeEl);
  const total = lignes.reduce((somme, l) => somme + l.poids_pct, 0);
  const cible = axeEl.querySelector("[data-expo-total]");
  if (!lignes.length) {
    cible.textContent = t("Rien de renseigné : tout est « non renseigné ».");
    cible.classList.remove("expo-total-trop");
    return;
  }
  const reste = Math.max(0, 100 - total);
  cible.classList.toggle("expo-total-trop", total > 100.5);
  cible.textContent =
    total > 100.5
      ? t("Total : {total} % — plus de 100 %, à corriger.", { total: expoFormatPoids(total) })
      : t("Total : {total} % — {reste} % non renseigné", {
          total: expoFormatPoids(total),
          reste: expoFormatPoids(reste),
        });
}

/* ---------- La composition d'un ETF ---------- */

function expoCompositionEnTexte(composition) {
  return Object.entries(composition || {})
    .map(([isin, poids]) => `${isin} ; ${poids}`)
    .join("\n");
}

/** « ISIN ; poids » une ligne par ISIN -> `{ISIN: poids}`. Lève une Error lisible. */
function expoTexteEnComposition(texte) {
  const resultat = {};
  texte
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .forEach((ligne) => {
      const m = ligne.match(/^([A-Za-z0-9 ]+?)\s*[;:=\t]\s*(-?\d+(?:[.,]\d+)?)\s*%?$/);
      if (!m) throw new Error(t("Ligne illisible : « {ligne} » (attendu : ISIN ; poids)", { ligne }));
      const isin = m[1].replace(/\s+/g, "").toUpperCase();
      if (isin in resultat) throw new Error(t("L'ISIN {isin} figure deux fois", { isin }));
      resultat[isin] = expoNombre(m[2]);
    });
  return resultat;
}

function expoCompositionHtml(titre) {
  const couverture = titre.composition_couverture_pct ?? EXPO_COUVERTURE_DEFAUT;
  return `
    <div class="expo-composition">
      <div class="expo-axe-titre">
        ${escapeHtml(t("Composition de l'ETF"))}<i class="info-bulle" tabindex="0" data-info-cle="placements.composition-etf">i</i>
      </div>
      <label class="expo-couverture">${escapeHtml(t("Part de l'indice couverte"))}
        <input type="number" step="1" min="1" max="100" data-expo-couverture value="${couverture}" /> %
      </label>
      <textarea data-expo-composition rows="6" spellcheck="false"
                placeholder="${escapeHtml(t("US5949181045 ; 15\nUS02079K3059 ; 12,5"))}">${escapeHtml(
                  expoCompositionEnTexte(titre.composition)
                )}</textarea>
      <div class="expo-actions">
        <button type="button" class="primary" data-expo-enregistrer-composition>${escapeHtml(t("Enregistrer"))}</button>
      </div>
    </div>`;
}

/* ---------- Le panneau ---------- */

function expoPanneauHtml(titre) {
  const avertissements = (titre.avertissements || [])
    .map((m) => `<li>${escapeHtml(traduireMessageServeur(m))}</li>`)
    .join("");
  return `
    ${EXPO_AXES.map((config) => expoAxeHtml(titre, config)).join("")}
    ${expoEstEtf(titre) ? expoCompositionHtml(titre) : ""}
    ${avertissements ? `<ul class="expo-avertissements">${avertissements}</ul>` : ""}`;
}

function expoCreerPanneau(titre) {
  const panneau = document.createElement("div");
  panneau.className = "expo-panneau";
  panneau.dataset.titre = String(titre.id);
  panneau.innerHTML = expoPanneauHtml(titre);
  panneau.querySelectorAll(".expo-axe").forEach(expoMajTotal);
  return panneau;
}

/** Appelé par `renderTitresSuivis` après chaque ligne : le panneau suit sa ligne s'il est déplié. */
function expoPanneauSousLigne(bloc, titre) {
  if (expoOuverts.has(titre.id)) bloc.appendChild(expoCreerPanneau(titre));
}

/** Remplace un titre par sa version relue du serveur, et redessine son panneau s'il est ouvert. */
function expoRemplacerTitre(lu) {
  const i = state.titres.findIndex((x) => x.id === lu.id);
  if (i >= 0) state.titres[i] = lu;
  const ancien = document.querySelector(`#placements-titres-liste .expo-panneau[data-titre="${lu.id}"]`);
  if (ancien) {
    const nouveau = expoCreerPanneau(lu);
    ancien.replaceWith(nouveau);
    appliquerTextes(nouveau);
    traduireDomStatique(nouveau);
  }
}

async function expoEnregistrerAxe(panneau, axeEl) {
  const titreId = Number(panneau.dataset.titre);
  try {
    const lu = await apiFetch(`/titres/${titreId}/expositions`, {
      method: "PUT",
      body: JSON.stringify({ axe: axeEl.dataset.axe, lignes: expoLignesSaisies(axeEl) }),
    });
    showMessage(t("Répartition enregistrée"), "success");
    expoRemplacerTitre(lu);
    // Les compteurs « N titre(s) » de chaque étiquette viennent de bouger.
    await refreshTypesTitre();
  } catch (err) {
    showMessage(traduireMessageServeur(err.message), "error");
  }
}

async function expoEnregistrerComposition(panneau) {
  const titreId = Number(panneau.dataset.titre);
  try {
    const composition = expoTexteEnComposition(panneau.querySelector("[data-expo-composition]").value);
    const couverture = expoNombre(panneau.querySelector("[data-expo-couverture]").value);
    const lu = await apiFetch(`/titres/${titreId}`, {
      method: "PUT",
      body: JSON.stringify({
        composition,
        // Un dictionnaire vidé retire aussi la couverture (zéro la retire).
        composition_couverture_pct: Object.keys(composition).length && !Number.isNaN(couverture) ? couverture : 0,
      }),
    });
    showMessage(t("Composition enregistrée"), "success");
    expoRemplacerTitre(lu);
  } catch (err) {
    showMessage(traduireMessageServeur(err.message), "error");
  }
}

/* ---------- Les gestes (délégation : le panneau est redessiné à chaque rechargement) ---------- */

(function expoCabler() {
  const bloc = document.getElementById("placements-titres-liste");
  if (!bloc) return;

  bloc.addEventListener("click", async (e) => {
    const detail = e.target.closest("button[data-action='detail-titre']");
    if (detail) {
      const id = Number(detail.dataset.id);
      if (expoOuverts.has(id)) expoOuverts.delete(id);
      else expoOuverts.add(id);
      renderTitresSuivis();
      return;
    }
    const panneau = e.target.closest(".expo-panneau");
    if (!panneau) return;
    const axeEl = e.target.closest(".expo-axe");

    if (e.target.closest("[data-expo-ajouter]") && axeEl) {
      axeEl.querySelector(".expo-lignes").insertAdjacentHTML("beforeend", expoLigneHtml(axeEl.dataset.axe, null));
      expoMajTotal(axeEl);
    } else if (e.target.closest("[data-expo-retirer]") && axeEl) {
      e.target.closest(".expo-ligne").remove();
      expoMajTotal(axeEl);
    } else if (e.target.closest("[data-expo-enregistrer]") && axeEl) {
      await expoEnregistrerAxe(panneau, axeEl);
    } else if (e.target.closest("[data-expo-enregistrer-composition]")) {
      await expoEnregistrerComposition(panneau);
    }
  });

  bloc.addEventListener("input", (e) => {
    const axeEl = e.target.closest(".expo-axe");
    if (axeEl && e.target.closest(".expo-poids")) expoMajTotal(axeEl);
  });
  bloc.addEventListener("change", (e) => {
    const axeEl = e.target.closest(".expo-axe");
    if (axeEl) expoMajTotal(axeEl);
  });
})();
