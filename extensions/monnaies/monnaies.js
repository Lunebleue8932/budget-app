/* Extension « Monnaies ».
 *
 * CE QUI EST OPTIONNEL, C'EST DE POUVOIR EN AJOUTER. Le noyau sait depuis
 * toujours qu'un montant appartient à une monnaie : la colonne existe partout,
 * les soldes sont calculés monnaie par monnaie, et rien n'additionne jamais
 * deux devises. Ce que cette extension apporte, c'est l'écran qui CRÉE,
 * renomme et supprime des monnaies — et les routes qui vont avec.
 *
 * Sans elle, la base ne contient que la monnaie posée à l'installation, et
 * toute l'interface s'y replie d'elle-même : les barres d'onglets par monnaie
 * disparaissent (elles se masquent déjà à une seule monnaie), le menu de
 * monnaie d'une opération ne s'affiche pas, et le compte n'a qu'un solde
 * initial à saisir. L'application devient mono-devise sans qu'une seule ligne
 * de son code ne s'en aperçoive.
 *
 * L'ÉTEINDRE NE REPLIE RIEN DE FORCE. Une base qui porte déjà plusieurs
 * monnaies continue de les afficher toutes : ses onglets, ses soldes et ses
 * budgets restent lisibles. On perd le droit d'en ajouter, jamais le droit de
 * voir ce qu'on a. C'est la règle du dépôt — désactiver ne fait pas
 * disparaître de données (cf. extensions/README.md).
 *
 * `refreshMonnaies` et `monnaieParId` restent dans le noyau : tout l'écran a
 * besoin de connaître les symboles pour afficher un montant, extension ou pas.
 */


async function loadMonnaies() {
  try {
    await refreshMonnaies();
    renderMonnaies();
    await loadTauxMonnaies();
  } catch (err) {
    showMessage(err.message, "error");
  }
}

function renderMonnaies() {
  const bloc = document.getElementById("monnaies-liste");
  // Le formulaire d'édition est DÉPLACÉ dans cette liste (cf.
  // ouvrirFormulaireEnLigne, dans le noyau) : le vider sans l'avoir remis à sa
  // place l'emporterait, avec tous les écouteurs posés plus bas.
  fermerFormulaireEnLigne("form-monnaie");
  bloc.innerHTML = "";
  if (state.monnaies.length === 0) {
    bloc.innerHTML = `<span class="hint">${t("Aucune monnaie.")}</span>`;
    return;
  }
  state.monnaies.forEach((monnaie) => {
    const row = document.createElement("div");
    row.className = "import-mapping-row";
    row.dataset.id = monnaie.id;
    row.innerHTML = `
      <span class="import-mapping-nom">${escapeHtml(monnaie.nom)} — ${escapeHtml(monnaie.symbole)}</span>
      <button type="button" data-action="modifier-monnaie" data-id="${monnaie.id}">${t("Modifier")}</button>
      <button type="button" data-action="supprimer-monnaie" data-id="${monnaie.id}" class="danger">${t("Supprimer")}</button>
    `;
    bloc.appendChild(row);
  });

  // Le formulaire vient se poser SOUS la ligne éditée, comme sur la page
  // Opérations et comme pour les comptes : le mécanisme est celui du noyau,
  // cette extension ne fait que le nommer.
  const editerMonnaie = (id, ligne) => {
    const monnaie = monnaieParId(id);
    if (!monnaie) return;
    ouvrirFormulaireEnLigne("form-monnaie", "form-monnaie-titre", ligne);
    document.getElementById("monnaie-id").value = monnaie.id;
    document.getElementById("monnaie-nom").value = monnaie.nom;
    document.getElementById("monnaie-symbole").value = monnaie.symbole;
    document.getElementById("form-monnaie-titre").textContent = `${t("Modifier")} « ${monnaie.nom} »`;
    document.getElementById("monnaie-annuler").style.display = "inline-block";
  };
  activerEditionDoubleClic(bloc, editerMonnaie);

  bloc.querySelectorAll("button[data-action='modifier-monnaie']").forEach((btn) => {
    btn.addEventListener("click", () =>
      editerMonnaie(Number(btn.dataset.id), btn.closest(".import-mapping-row"))
    );
  });

  bloc.querySelectorAll("button[data-action='supprimer-monnaie']").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!confirm(t("Supprimer cette monnaie ?"))) return;
      try {
        await apiFetch(`/monnaies/${btn.dataset.id}`, { method: "DELETE" });
        showMessage(t("Monnaie supprimée"), "success");
        await loadMonnaies();
      } catch (err) {
        showMessage(err.message, "error");
      }
    });
  });
}

function resetMonnaieForm() {
  fermerFormulaireEnLigne("form-monnaie");
  document.getElementById("monnaie-id").value = "";
  document.getElementById("monnaie-nom").value = "";
  document.getElementById("monnaie-symbole").value = "";
  document.getElementById("form-monnaie-titre").textContent = t("Ajouter une monnaie");
  document.getElementById("monnaie-annuler").style.display = "none";
}

document.getElementById("form-monnaie").addEventListener("submit", async (e) => {
  e.preventDefault();
  const id = document.getElementById("monnaie-id").value;
  const payload = {
    nom: document.getElementById("monnaie-nom").value,
    symbole: document.getElementById("monnaie-symbole").value,
  };
  try {
    if (id) {
      await apiFetch(`/monnaies/${id}`, { method: "PUT", body: JSON.stringify(payload) });
      showMessage(t("Monnaie modifiée"), "success");
    } else {
      await apiFetch("/monnaies", { method: "POST", body: JSON.stringify(payload) });
      showMessage(t("Monnaie créée"), "success");
    }
    resetMonnaieForm();
    await loadMonnaies();
  } catch (err) {
    showMessage(err.message, "error");
  }
});


/* ---------- Taux de change ----------
 *
 * CE QU'UN TAUX FAIT, ET CE QU'IL NE FAIT PAS. Il ne réécrit rien : aucun
 * solde, aucun budget, aucune opération enregistrée ne change parce qu'un taux
 * est saisi. Il sert exactement à une chose — la case « tout convertir en… »
 * du dashboard, posée par ce même fichier plus bas. Décocher la case, ou
 * éteindre cette extension, rend l'application au fonctionnement monnaie par
 * monnaie qui est le sien partout ailleurs.
 *
 * UN SEUL SENS SUFFIT. « 1 € = 1,08 $ » et « 1 $ = 0,926 € » sont la même
 * information écrite deux fois ; la conversion sait diviser (cf.
 * service_conversion.py), et exiger les deux lignes doublerait la saisie à
 * chaque devise ajoutée sans rien protéger.
 *
 * L'EXTENSION « Lecture de cours » ÉCRIT DANS LA MÊME TABLE : un taux relu en
 * ligne sert donc à convertir sans qu'on ait à le ressaisir, et il apparaît
 * dans cette liste avec la mention de sa provenance.
 */

let tauxMonnaies = [];

async function loadTauxMonnaies() {
  try {
    tauxMonnaies = await apiFetch("/conversion/taux");
  } catch (err) {
    tauxMonnaies = [];
    console.error(err);
  }
  remplirMenusTauxMonnaies();
  renderTauxMonnaies();
}

function remplirMenusTauxMonnaies() {
  const source = document.getElementById("monnaie-taux-source");
  const cible = document.getElementById("monnaie-taux-cible");
  if (!source || !cible) return;
  const options = state.monnaies
    .map((m) => `<option value="${m.id}">${escapeHtml(m.nom)} (${escapeHtml(m.symbole)})</option>`)
    .join("");
  const avant = { source: source.value, cible: cible.value };
  source.innerHTML = options;
  cible.innerHTML = options;
  if (avant.source) source.value = avant.source;
  if (avant.cible) cible.value = avant.cible;
  // Deux monnaies différentes par défaut quand il y en a assez : le couple le
  // plus courant se saisit alors sans toucher aux menus.
  else if (state.monnaies.length > 1) cible.value = String(state.monnaies[1].id);
}

function renderTauxMonnaies() {
  const bloc = document.getElementById("monnaies-taux-liste");
  if (!bloc) return;
  bloc.innerHTML = "";
  if (state.monnaies.length < 2) {
    // Un taux entre une monnaie et elle-même n'existe pas : tant qu'il n'y en a
    // qu'une, ce bloc n'a rien à proposer et le dire vaut mieux que de montrer
    // un formulaire dont les deux menus tomberaient sur la même valeur.
    bloc.innerHTML = `<span class="hint">${t(
      "Ajoute une seconde monnaie pour pouvoir saisir un taux."
    )}</span>`;
    document.getElementById("form-monnaie-taux").style.display = "none";
    return;
  }
  document.getElementById("form-monnaie-taux").style.display = "";

  if (tauxMonnaies.length === 0) {
    bloc.innerHTML = `<span class="hint">${t("Aucun taux enregistré.")}</span>`;
    return;
  }
  tauxMonnaies.forEach((couple) => {
    const ligne = document.createElement("div");
    ligne.className = "import-mapping-row";
    // La PROVENANCE est dite, parce qu'elle décide de ce qui arrivera à ce
    // taux : celui qui porte un lien sera écrasé au prochain rafraîchissement,
    // celui qu'on a tapé ne bougera jamais tout seul.
    const provenance = couple.url_cours
      ? `<span class="hint">${t("relu en ligne")}</span>`
      : `<span class="hint">${t("saisi à la main")}</span>`;
    ligne.innerHTML = `
      <span class="import-mapping-nom">
        1 ${escapeHtml(couple.monnaie_source_symbole)} =
        <strong>${couple.taux == null ? "—" : couple.taux}</strong>
        ${escapeHtml(couple.monnaie_cible_symbole)}
      </span>
      <span class="hint">${escapeHtml(couple.monnaie_source_nom)} →
        ${escapeHtml(couple.monnaie_cible_nom)}</span>
      ${provenance}
      <button type="button" class="danger" data-taux-supprimer="${couple.id}">${t(
        "Supprimer"
      )}</button>
    `;
    bloc.appendChild(ligne);
  });

  bloc.querySelectorAll("button[data-taux-supprimer]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      try {
        await apiFetch(`/conversion/taux/${btn.dataset.tauxSupprimer}`, { method: "DELETE" });
        showMessage(t("Taux supprimé"), "success");
        await loadTauxMonnaies();
      } catch (err) {
        showMessage(err.message, "error");
      }
    });
  });
}

document.getElementById("form-monnaie-taux").addEventListener("submit", async (e) => {
  e.preventDefault();
  const source = Number(document.getElementById("monnaie-taux-source").value);
  const cible = Number(document.getElementById("monnaie-taux-cible").value);
  const valeur = parseFloat(document.getElementById("monnaie-taux-valeur").value);
  if (source === cible) {
    showMessage(t("Choisis deux monnaies différentes."), "error");
    return;
  }
  if (!(valeur > 0)) {
    showMessage(t("Le taux doit être un nombre strictement positif."), "error");
    return;
  }
  try {
    // PUT : ressaisir un couple met son taux à jour plutôt que d'être refusé —
    // c'est le geste ordinaire, un taux bouge.
    await apiFetch("/conversion/taux", {
      method: "PUT",
      body: JSON.stringify({
        monnaie_source_id: source,
        monnaie_cible_id: cible,
        taux: valeur,
      }),
    });
    showMessage(t("Taux enregistré"), "success");
    document.getElementById("monnaie-taux-valeur").value = "";
    await loadTauxMonnaies();
  } catch (err) {
    showMessage(err.message, "error");
  }
});

document.getElementById("monnaie-annuler").addEventListener("click", resetMonnaieForm);
/* ---------- La bascule d'agrégation du dashboard ----------
 *
 * CE QU'ELLE RÉSOUT. Le dashboard raisonne par monnaie : un onglet chacune, et
 * rien ne s'additionne entre elles — c'est le choix central de l'application, et
 * il a raison tant qu'on n'a aucun taux. Mais quelqu'un qui tient un compte en
 * euros et un en dollars n'a alors AUCUN endroit où lire ce qu'il possède. La
 * case répond à cette question-là, et à aucune autre.
 *
 * ELLE CONVERTIT VERS L'ONGLET ACTIF. Pas de second menu à régler : on choisit
 * la monnaie comme on l'a toujours fait, en cliquant son onglet, et la case dit
 * « tout convertir en € ». Son libellé suit donc l'onglet.
 *
 * RIEN N'EST ÉCRIT. Aucun montant en base ne change, et l'état de la case ne
 * survit pas au rechargement de la page : c'est une façon de regarder, pas un
 * réglage de l'application.
 *
 * COMMENT ON SE GREFFE. On enveloppe `loadDashboardData` du noyau : elle rend
 * le dashboard normal (et redessine les onglets, dans lesquels on repose notre
 * case), puis on remplace les chiffres par leur version convertie si la case
 * est cochée. Envelopper plutôt que réécrire garantit que les deux vues
 * viennent du même code d'affichage — c'est ce qui les empêche de diverger.
 */

const MONNAIES_ID = "monnaies";

let agregationActive = false;
// Les monnaies qu'aucun taux ne relie à celle qu'on regarde. Gardées pour
// l'avertissement affiché sous la case : un total amputé sans le dire vaudrait
// moins qu'un refus.
let agregationNonConverties = [];

function agregationDisponible() {
  return BudgetApp.extensions.estActive(MONNAIES_ID) && (state.monnaies || []).length > 1;
}

/**
 * Pose (ou retire) la case, juste après la barre d'onglets de monnaie.
 *
 * Idempotente : la barre est redessinée à chaque chargement du dashboard, la
 * case ne doit pas se dupliquer. Elle est RETIRÉE quand l'extension vient
 * d'être éteinte, sans quoi elle resterait affichée jusqu'au rechargement de
 * la page et sa route répondrait 404.
 */
function poserBasculeAgregation() {
  const barre = document.getElementById("dashboard-monnaies");
  if (!barre) return;
  let bloc = document.getElementById("monnaies-agregation");
  if (!agregationDisponible()) {
    if (bloc) bloc.remove();
    agregationActive = false;
    return;
  }
  if (!bloc) {
    bloc = document.createElement("div");
    bloc.id = "monnaies-agregation";
    bloc.className = "monnaies-agregation";
    bloc.innerHTML = `
      <label class="import-option-ligne">
        <input type="checkbox" id="monnaies-agregation-case" />
        <span id="monnaies-agregation-libelle"></span>
        <i class="info-bulle" tabindex="0" data-info="${escapeHtml(
          t(
            "Additionne tes monnaies en une seule, au taux que tu as saisi dans " +
              "Paramètres → Monnaies. Rien n'est modifié : décoche et tout revient. " +
              "Une monnaie sans taux est laissée de côté, et signalée."
          )
        )}">i</i>
      </label>
      <div class="hint" id="monnaies-agregation-alerte" style="display:none"></div>
    `;
    barre.insertAdjacentElement("afterend", bloc);
    document
      .getElementById("monnaies-agregation-case")
      .addEventListener("change", (e) => {
        agregationActive = e.target.checked;
        // On redemande le dashboard : la vue convertie est calculée côté
        // serveur, à partir des mêmes chiffres.
        loadDashboardData(state.dashboardPeriode.annee, state.dashboardPeriode.mois);
      });
  }
  document.getElementById("monnaies-agregation-case").checked = agregationActive;
  const monnaie = monnaieParId(state.dashboardMonnaieId);
  document.getElementById("monnaies-agregation-libelle").textContent = monnaie
    ? t("Tout convertir en {monnaie}", { monnaie: monnaie.nom })
    : t("Tout convertir");
  majAlerteAgregation();
}

function majAlerteAgregation() {
  const alerte = document.getElementById("monnaies-agregation-alerte");
  if (!alerte) return;
  if (!agregationActive || agregationNonConverties.length === 0) {
    alerte.style.display = "none";
    return;
  }
  alerte.style.display = "";
  alerte.textContent = t(
    "Pas de taux pour {monnaies} : ces montants ne sont pas comptés. Saisis leur taux dans Paramètres → Monnaies.",
    { monnaies: agregationNonConverties.map((m) => m.monnaie_nom).join(", ") }
  );
}

/**
 * Remplace les chiffres du dashboard par leur version convertie.
 *
 * Rend false quand il n'y a rien à convertir (monnaie visée portée par aucun
 * compte) : l'appelant laisse alors la vue par monnaie en place plutôt que de
 * vider l'écran.
 */
async function appliquerAgregation(annee, mois) {
  const vue = state.dashboardPeriode.vue;
  const parametres = new URLSearchParams({
    vers: String(state.dashboardMonnaieId),
    annee: String(annee),
    vue,
  });
  if (vue !== "annee") parametres.set("mois", String(mois));

  const reponse = await apiFetch(`/conversion/dashboard?${parametres}`);
  agregationNonConverties = reponse.non_converties || [];
  if (!reponse.dashboard) return false;

  const libellePeriode =
    vue === "annee" ? `Année ${annee}` : libelleMois(annee, mois);
  // LES FONCTIONS D'AFFICHAGE DU NOYAU, telles quelles : la vue convertie et la
  // vue par monnaie doivent se ressembler jusqu'au pixel, et deux rendus
  // parallèles finiraient par ne plus le faire.
  renderKpisDashboard(reponse.dashboard.kpis[0], libellePeriode);
  renderRepartitionComptes(
    reponse.dashboard.comptes,
    state.dashboardMonnaieId,
    // Déjà convertie par le serveur, comme le reste des KPI.
    reponse.dashboard.kpis[0].valorisation_placements
  );
  return true;
}

const loadDashboardDataAvantGreffe = window.loadDashboardData;
window.loadDashboardData = async function (annee, mois) {
  await loadDashboardDataAvantGreffe(annee, mois);
  poserBasculeAgregation();
  if (!agregationActive || !agregationDisponible()) {
    agregationNonConverties = [];
    majAlerteAgregation();
    return;
  }
  try {
    await appliquerAgregation(annee, mois);
  } catch (err) {
    // La vue par monnaie est déjà à l'écran : on la laisse, et on dit
    // pourquoi la conversion n'a pas eu lieu.
    showMessage(err.message, "error");
    agregationActive = false;
    const case_ = document.getElementById("monnaies-agregation-case");
    if (case_) case_.checked = false;
  }
  majAlerteAgregation();
};

// Le noyau rappelle ce chargeur à chaque ouverture de la sous-page.
BudgetApp.extensions.enregistrer("monnaies", { chargeur: loadMonnaies });
