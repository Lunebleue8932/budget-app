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

/** Vrai pour un titre dont l'enveloppe se nomme « ETF » (ou « ETFs », « ETF actions »…), ou pour un
 *  indice : il porte une composition comme un ETF, c'est même tout son intérêt. */
function expoEstEtf(titre) {
  return !!titre.est_indice || /^etf/.test(expoNormaliser(titre.type_titre_nom));
}

/** Vrai pour une « Action en direct » : une étiquette par axe, à 100 %, VERROUILLÉ au serveur
 *  (services/exposition.verrouiller_action_en_direct). Même reconnaissance des deux côtés. */
function expoEstActionDirecte(titre) {
  return /^actions?\s+en\s+direct/.test(expoNormaliser(titre.type_titre_nom));
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

function expoLignesDe(titre, axe) {
  return (titre.expositions || []).filter((e) => e.axe === axe);
}

function expoAxeHtml(titre, config) {
  const lignes = expoLignesDe(titre, config.axe);
  const entete = `
      <div class="expo-axe-titre">
        ${escapeHtml(t(config.titre))}<i class="info-bulle" tabindex="0" data-info-cle="${config.aide}">i</i>
      </div>`;
  // UNE ACTION EN DIRECT : un seul menu par axe, sans poids — il vaut 100 %, et le serveur le
  // verrouille. S'il en portait plusieurs (écrites avant le verrou), la plus lourde s'affiche.
  if (expoEstActionDirecte(titre)) {
    const lourde = [...lignes].sort((a, b) => b.poids_pct - a.poids_pct)[0];
    return `
    <div class="expo-axe" data-axe="${config.axe}" data-expo-direct>${entete}
      <select class="expo-etiquette">${optionsTypesTitre(lourde ? lourde.type_titre_id : null, config.axe)}</select>
    </div>`;
  }
  return `
    <div class="expo-axe" data-axe="${config.axe}">${entete}
      <div class="expo-lignes">${lignes.map((l) => expoLigneHtml(config.axe, l)).join("")}</div>
      <div class="expo-total" data-expo-total></div>
      <div class="expo-actions">
        <button type="button" data-expo-ajouter>${escapeHtml(t(config.nouvelle))}</button>
      </div>
    </div>`;
}

/** Ce que le panneau lit : les lignes d'un axe, telles que saisies (les incomplètes sont écartées). */
function expoLignesSaisies(axeEl) {
  if (axeEl.hasAttribute("data-expo-direct")) {
    const id = Number(axeEl.querySelector(".expo-etiquette").value);
    return id ? [{ type_titre_id: id, poids_pct: 100 }] : [];
  }
  return [...axeEl.querySelectorAll(".expo-ligne")]
    .map((ligne) => ({
      type_titre_id: Number(ligne.querySelector(".expo-etiquette").value),
      poids_pct: expoNombre(ligne.querySelector(".expo-poids").value),
    }))
    .filter((l) => l.type_titre_id && !Number.isNaN(l.poids_pct));
}

function expoMajTotal(axeEl) {
  const cible = axeEl.querySelector("[data-expo-total]");
  if (!cible) return; // une action en direct : pas de total, c'est 100 % ou rien
  const lignes = expoLignesSaisies(axeEl);
  const total = lignes.reduce((somme, l) => somme + l.poids_pct, 0);
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
      // Un composant sans ISIN (iShares) est cité par « titre:<id> » : la clé garde sa casse d'origine.
      const m = ligne.match(/^(titre:\d+|[A-Za-z0-9 ]+?)\s*[;:=\t]\s*(-?\d+(?:[.,]\d+)?)\s*%?$/i);
      if (!m) throw new Error(t("Ligne illisible : « {ligne} » (attendu : ISIN ; poids)", { ligne }));
      const isin = /^titre:\d+$/i.test(m[1]) ? m[1].toLowerCase() : m[1].replace(/\s+/g, "").toUpperCase();
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
    </div>`;
}

/* ---------- Calquer un ETF sur un indice ----------
 *
 * Un INDICE (titre qu'on ne détient pas, cf. models.est_indice) porte une composition et des
 * répartitions. « Calquer » les recopie sur l'ETF — mais PROPRIÉTÉ PAR PROPRIÉTÉ, au choix : ce que
 * l'ETF porte déjà bien reste, ce qu'on prend de l'indice REMPLACE d'un bloc (services/calque_fonds).
 * L'écran montre les deux côtés avant d'écraser quoi que ce soit.
 */

const EXPO_PROPRIETES_CALQUE = [
  { cle: "composition", nom: "Composition" },
  { cle: "classe", nom: "Classe d'actif" },
  { cle: "zone", nom: "Zone géographique" },
  { cle: "secteur", nom: "Secteur" },
];

/** Ce qu'une propriété porte, en une ligne lisible (`donnees` = un résumé du serveur). */
function expoResumeTexte(cle, donnees) {
  if (!donnees || !donnees.nb) return t("Rien de renseigné");
  if (cle === "composition") {
    return t("{n} composant(s), {pct} % de l'indice couverts", {
      n: donnees.nb,
      pct: expoFormatPoids(donnees.couverture_pct ?? donnees.poids_pct),
    });
  }
  const lignes = donnees.lignes.slice(0, 3).map((l) => `${l.nom} ${expoFormatPoids(l.poids_pct)} %`);
  return lignes.join(", ") + (donnees.lignes.length > 3 ? "…" : "");
}

function expoCalqueHtml(titre) {
  const indices = state.titres.filter((x) => x.est_indice && !x.archivee);
  // UN ETF DÉJÀ CALQUÉ affiche son indice, en bleu, à la place de « Choisir » - comme un filtre
  // actif sur la page des opérations : on voit d'un coup d'œil qu'il suit un indice.
  const lie = titre.indice_id && indices.some((i) => i.id === titre.indice_id);
  const entete = `
      <div class="expo-axe-titre">
        ${escapeHtml(t("Calquer sur un indice"))}<i class="info-bulle" tabindex="0" data-info-cle="placements.calque-indice">i</i>
      </div>`;
  if (!indices.length) {
    return `<div class="expo-calque">${entete}<p class="hint">${escapeHtml(
      t("Aucun indice : crée-en un, ou transforme un ETF importé que tu ne détiens pas.")
    )}</p></div>`;
  }
  return `
    <div class="expo-calque" data-expo-calque>${entete}
      <select data-expo-calque-indice class="${lie ? "expo-calque-lie" : ""}">
        <option value="">${escapeHtml(lie ? t("— Ne plus suivre l'indice —") : t("— Choisir un indice —"))}</option>
        ${indices
          .map(
            (i) => `<option value="${i.id}" ${i.id === titre.indice_id ? "selected" : ""}>${escapeHtml(i.nom_affiche)}</option>`
          )
          .join("")}
      </select>
      ${
        lie
          ? `<p class="hint">${escapeHtml(
              t("Calqué : {liste}. Une mise à jour de l'indice se répercute sur cet ETF.", {
                liste: (titre.calque_proprietes || []).map((p) => t(EXPO_PROPRIETES_CALQUE.find((x) => x.cle === p).nom).toLowerCase()).join(", "),
              })
            )}</p>`
          : ""
      }
      <div data-expo-calque-detail></div>
    </div>`;
}

/** Le tableau de choix : pour chaque propriété, ce que porte l'ETF, ce que porte l'indice, et lequel on garde. */
function expoCalqueDetailHtml(titreId, cible, indice, dejaPrises = []) {
  const lignes = EXPO_PROPRIETES_CALQUE.map(({ cle, nom }) => {
    const aLaCible = cible[cle].nb > 0;
    const aIndice = indice[cle].nb > 0;
    // Par défaut : on prend de l'indice ce que l'ETF n'a pas, et on GARDE ce qu'il a déjà - sauf ce
    // qu'il prenait déjà à cet indice (le lien persiste).
    const prendre = aIndice && (!aLaCible || dejaPrises.includes(cle));
    const radio = `calque-${titreId}-${cle}`;
    return `<tr data-propriete="${cle}">
      <th scope="row">${escapeHtml(t(nom))}</th>
      <td>${escapeHtml(expoResumeTexte(cle, cible[cle]))}</td>
      <td>${escapeHtml(expoResumeTexte(cle, indice[cle]))}</td>
      <td class="expo-calque-choix">
        <label><input type="radio" name="${radio}" value="etf" ${prendre ? "" : "checked"} /> ${escapeHtml(t("Garder celle de l'ETF"))}</label>
        <label><input type="radio" name="${radio}" value="indice" ${prendre ? "checked" : ""} ${aIndice ? "" : "disabled"} /> ${escapeHtml(t("Prendre celle de l'indice"))}</label>
      </td>
    </tr>`;
  }).join("");
  return `
    <div class="expo-calque-cadre"><table class="expo-calque-table">
      <thead><tr><th></th><th>${escapeHtml(t("Cet ETF aujourd'hui"))}</th><th>${escapeHtml(t("L'indice"))}</th><th>${escapeHtml(t("Que garder ?"))}</th></tr></thead>
      <tbody>${lignes}</tbody>
    </table></div>
    <p class="expo-calque-alerte" data-expo-calque-alerte></p>
    <div class="expo-actions">
      <button type="button" class="primary" data-expo-calque-appliquer>${escapeHtml(t("Calquer"))}</button>
    </div>`;
}

/** Les propriétés que l'utilisateur a choisi de PRENDRE à l'indice. */
function expoCalquePrises(zone) {
  return [...zone.querySelectorAll("tr[data-propriete]")]
    .filter((tr) => tr.querySelector("input[value='indice']").checked)
    .map((tr) => tr.dataset.propriete);
}

/** Dit ce que le choix actuel va EFFACER sur l'ETF, et grise « Calquer » s'il ne prend rien. */
function expoCalqueMajAlerte(zone, cible) {
  const prises = expoCalquePrises(zone);
  const effacees = prises.filter((cle) => cible[cle].nb > 0);
  const nom = (cle) => t(EXPO_PROPRIETES_CALQUE.find((p) => p.cle === cle).nom).toLowerCase();
  zone.querySelector("[data-expo-calque-alerte]").textContent = effacees.length
    ? t("Ce que l'ETF porte aujourd'hui pour {liste} sera effacé.", { liste: effacees.map(nom).join(", ") })
    : "";
  zone.querySelector("[data-expo-calque-appliquer]").disabled = !prises.length;
}

async function expoCalqueChoisir(menu) {
  const panneau = menu.closest(".expo-panneau");
  const zone = menu.closest("[data-expo-calque]").querySelector("[data-expo-calque-detail]");
  if (!menu.value) {
    zone.innerHTML = "";
    // « Ne plus suivre l'indice » : le lien se défait, les données de l'ETF restent.
    const titre = state.titres.find((x) => x.id === Number(panneau.dataset.titre));
    if (titre && titre.indice_id) {
      try {
        const lu = await apiFetch(`/titres/${titre.id}/calque`, {
          method: "PUT",
          body: JSON.stringify({ indice_id: null }),
        });
        showMessage(t("ETF délié de l'indice"), "success");
        expoRemplacerTitre(lu);
      } catch (err) {
        showMessage(traduireMessageServeur(err.message), "error");
      }
    }
    return;
  }
  const titreId = Number(panneau.dataset.titre);
  try {
    const [cible, indice] = await Promise.all([
      apiFetch(`/titres/${titreId}/donnees`),
      apiFetch(`/titres/${menu.value}/donnees`),
    ]);
    const titre = state.titres.find((x) => x.id === titreId);
    const dejaPrises = titre && titre.indice_id === Number(menu.value) ? titre.calque_proprietes || [] : [];
    zone.innerHTML = expoCalqueDetailHtml(titreId, cible, indice, dejaPrises);
    zone._cible = cible;
    expoCalqueMajAlerte(zone, cible);
  } catch (err) {
    showMessage(traduireMessageServeur(err.message), "error");
  }
}

async function expoCalqueAppliquer(bouton) {
  const bloc = bouton.closest("[data-expo-calque]");
  const zone = bloc.querySelector("[data-expo-calque-detail]");
  const titreId = Number(bouton.closest(".expo-panneau").dataset.titre);
  const indiceId = Number(bloc.querySelector("[data-expo-calque-indice]").value);
  const proprietes = expoCalquePrises(zone);
  if (!indiceId || !proprietes.length) return;
  const effacees = proprietes.filter((cle) => zone._cible[cle].nb > 0);
  if (effacees.length && !confirm(t("Remplacer ce que l'ETF porte déjà par ce que porte l'indice ?"))) return;
  bouton.disabled = true;
  try {
    const lu = await apiFetch(`/titres/${titreId}/calque`, {
      method: "PUT",
      body: JSON.stringify({ indice_id: indiceId, proprietes }),
    });
    showMessage(t("ETF calqué sur l'indice"), "success");
    expoRemplacerTitre(lu);
    await refreshTypesTitre();
  } catch (err) {
    showMessage(traduireMessageServeur(err.message), "error");
    bouton.disabled = false;
  }
}

/* ---------- Le panneau ---------- */

function expoPanneauHtml(titre) {
  const avertissements = (titre.avertissements || [])
    .map((m) => `<li>${escapeHtml(traduireMessageServeur(m))}</li>`)
    .join("");
  // UN SEUL « ENREGISTRER » POUR TOUT LE PANNEAU (cf. expoEnregistrer) : trois axes et une
  // composition à enregistrer chacun de leur côté, c'était quatre boutons pour un geste.
  return `
    ${EXPO_AXES.map((config) => expoAxeHtml(titre, config)).join("")}
    ${expoEstEtf(titre) ? expoCompositionHtml(titre) : ""}
    ${expoEstEtf(titre) && !titre.est_indice ? expoCalqueHtml(titre) : ""}
    ${avertissements ? `<ul class="expo-avertissements">${avertissements}</ul>` : ""}
    <div class="expo-actions expo-actions-panneau">
      <button type="button" class="primary" data-expo-enregistrer>${escapeHtml(t("Enregistrer"))}</button>
    </div>`;
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

/** Une répartition comparable : `id:poids` triés, pour savoir si un axe a changé. */
function expoEmpreinte(lignes) {
  return lignes
    .map((l) => `${l.type_titre_id}:${Number(l.poids_pct).toFixed(4)}`)
    .sort()
    .join("|");
}

/**
 * LE SEUL « ENREGISTRER » DU PANNEAU : les trois axes, puis la composition d'un ETF.
 *
 * TOUT EST VÉRIFIÉ AVANT LA PREMIÈRE ÉCRITURE — un axe au-dessus de 100 %, une composition
 * illisible — pour ne jamais laisser un panneau à moitié enregistré. SEUL CE QUI A CHANGÉ PART :
 * réenregistrer un axe intact lui ferait perdre sa source et sa date (« Import … » deviendrait
 * une saisie du jour).
 */
async function expoEnregistrer(panneau) {
  const titreId = Number(panneau.dataset.titre);
  const titre = state.titres.find((x) => x.id === titreId);
  if (!titre) return;
  try {
    const axes = [...panneau.querySelectorAll(".expo-axe")].map((axeEl) => ({
      axe: axeEl.dataset.axe,
      lignes: expoLignesSaisies(axeEl),
    }));
    const trop = axes.find((a) => a.lignes.reduce((s, l) => s + l.poids_pct, 0) > 100.5);
    if (trop) {
      const config = EXPO_AXES.find((c) => c.axe === trop.axe);
      throw new Error(t("{axe} : plus de 100 %, à corriger.", { axe: t(config.titre) }));
    }
    const changes = axes.filter(
      (a) => expoEmpreinte(a.lignes) !== expoEmpreinte(expoLignesDe(titre, a.axe))
    );

    let composition = null;
    const champ = panneau.querySelector("[data-expo-composition]");
    if (champ) {
      const lue = expoTexteEnComposition(champ.value);
      const couverture = expoNombre(panneau.querySelector("[data-expo-couverture]").value);
      const corps = {
        composition: lue,
        // Un dictionnaire vidé retire aussi la couverture (zéro la retire).
        composition_couverture_pct: Object.keys(lue).length && !Number.isNaN(couverture) ? couverture : 0,
      };
      const avant = JSON.stringify([titre.composition || {}, titre.composition_couverture_pct || 0]);
      const apres = JSON.stringify([lue, corps.composition_couverture_pct]);
      if (avant !== apres) composition = corps;
    }

    if (!changes.length && !composition) {
      showMessage(t("Rien n'a changé."), "success");
      return;
    }
    let lu = null;
    for (const a of changes) {
      lu = await apiFetch(`/titres/${titreId}/expositions`, {
        method: "PUT",
        body: JSON.stringify(a),
      });
    }
    if (composition) {
      lu = await apiFetch(`/titres/${titreId}`, { method: "PUT", body: JSON.stringify(composition) });
    }
    showMessage(t("Détail enregistré"), "success");
    expoRemplacerTitre(lu);
    // Les compteurs « N titre(s) » de chaque étiquette viennent de bouger.
    await refreshTypesTitre();
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
    } else if (e.target.closest("[data-expo-enregistrer]")) {
      await expoEnregistrer(panneau);
    } else if (e.target.closest("[data-expo-calque-appliquer]")) {
      await expoCalqueAppliquer(e.target.closest("[data-expo-calque-appliquer]"));
    }
  });

  bloc.addEventListener("input", (e) => {
    const axeEl = e.target.closest(".expo-axe");
    if (axeEl && e.target.closest(".expo-poids")) expoMajTotal(axeEl);
  });
  bloc.addEventListener("change", (e) => {
    const axeEl = e.target.closest(".expo-axe");
    if (axeEl) expoMajTotal(axeEl);
    const menu = e.target.closest("[data-expo-calque-indice]");
    if (menu) expoCalqueChoisir(menu);
    const radio = e.target.closest(".expo-calque-table input[type='radio']");
    if (radio) {
      const zone = radio.closest("[data-expo-calque-detail]");
      expoCalqueMajAlerte(zone, zone._cible);
    }
  });
})();
