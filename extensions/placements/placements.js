/* ---------- Extension « Placements financiers » ----------
 *
 * Un compte-titres a deux soldes : ses espèces, qui se lisent comme celles de
 * n'importe quel compte (les achats/ventes y sont de simples écritures de
 * transfert), et son portefeuille, entièrement recalculé côté serveur depuis
 * les mouvements. Cette page n'additionne donc rien elle-même : elle affiche ce
 * que /placements renvoie.
 *
 * CHARGÉ PAR frontend/extensions.js, après que le fragment page.html a été
 * injecté dans <main> : les écouteurs posés plus bas trouvent donc bien leurs
 * éléments. Le script s'exécute dans la portée globale de la page, il a donc
 * accès à tout ce que app.js expose (apiFetch, formatMontant, showMessage,
 * state, t…) — c'est ce qui évite de dupliquer ces utilitaires ici.
 *
 * L'enregistrement auprès du noyau est en FIN de fichier : `loadPlacements` et
 * les autres doivent exister au moment où on les référence.
 */

// Dernier détail chargé (compte affiché) : sert à borner une vente à ce qui est
// réellement détenu, sans redemander au serveur à chaque frappe.
let placementDetail = null;

async function refreshActionsTitres() {
  state.actions = await apiFetch("/actions");
  _refillPreservingSelection(document.getElementById("operation-action-titre"), (el) => {
    el.innerHTML = "";
    state.actions.forEach((a) => {
      const opt = document.createElement("option");
      opt.value = a.id;
      // La monnaie de cotation décide du compte depuis lequel le titre peut
      // s'acheter : elle doit se lire dans le menu, pas se découvrir à l'erreur.
      opt.textContent = `${a.nom} (${a.monnaie_symbole})`;
      el.appendChild(opt);
    });
  });
  renderTitresSuivis();
}

function renderTitresSuivis() {
  const bloc = document.getElementById("placements-actions-liste");
  bloc.innerHTML = "";
  if (state.actions.length === 0) {
    bloc.innerHTML = `<span class="hint">${t("Aucun titre. Ajoute-en un ci-dessous.")}</span>`;
    return;
  }
  state.actions.forEach((action) => {
    const row = document.createElement("div");
    row.className = "import-mapping-row";
    row.innerHTML = `
      <span class="import-mapping-nom">${escapeHtml(action.nom)} — ${t("coté en")} ${escapeHtml(
        action.monnaie_symbole
      )}</span>
      <input type="number" step="0.01" min="0" value="${action.valeur}"
             data-action="cours" data-id="${action.id}" title="${t("Cours unitaire actuel")}" />
      <button type="button" data-action="supprimer-titre" data-id="${action.id}" class="danger">
        ${t("Supprimer")}
      </button>
    `;
    bloc.appendChild(row);
  });

  // Le cours est enregistré à la validation du champ (change), pas à chaque
  // frappe : saisir "32" ne doit pas passer par un cours de 3 €.
  bloc.querySelectorAll("input[data-action='cours']").forEach((input) => {
    input.addEventListener("change", async () => {
      try {
        await apiFetch(`/actions/${input.dataset.id}`, {
          method: "PUT",
          body: JSON.stringify({ valeur: parseFloat(input.value || "0") }),
        });
        showMessage(t("Cours mis à jour"), "success");
        await refreshActionsTitres();
        if (state.placementCompteId) await loadPlacementDetail(state.placementCompteId);
      } catch (err) {
        showMessage(err.message, "error");
      }
    });
  });

  bloc.querySelectorAll("button[data-action='supprimer-titre']").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!confirm(t("Supprimer ce titre ?"))) return;
      try {
        await apiFetch(`/actions/${btn.dataset.id}`, { method: "DELETE" });
        showMessage(t("Titre supprimé"), "success");
        await refreshActionsTitres();
      } catch (err) {
        showMessage(err.message, "error");
      }
    });
  });
}

async function loadPlacements() {
  try {
    await refreshMonnaies();
    fillMonnaiesSelect(document.getElementById("action-monnaie"), state.monnaies);
    await refreshComptes();
    await refreshActionsTitres();
    const comptes = await apiFetch("/placements");

    document.getElementById("placements-aucun-compte").style.display =
      comptes.length === 0 ? "" : "none";
    document.getElementById("placements-contenu").style.display =
      comptes.length === 0 ? "none" : "";
    if (comptes.length === 0) {
      document.getElementById("placements-onglets").innerHTML = "";
      state.placementCompteId = null;
      return;
    }

    const champDate = document.getElementById("operation-action-date");
    if (!champDate.value) champDate.value = new Date().toISOString().slice(0, 10);

    // Le compte affiché survit à un rechargement tant qu'il existe encore.
    if (!comptes.some((c) => c.compte_id === state.placementCompteId)) {
      state.placementCompteId = comptes[0].compte_id;
    }
    renderPlacementsOnglets(comptes);
    await loadPlacementDetail(state.placementCompteId);
  } catch (err) {
    showMessage(err.message, "error");
  }
}

function renderPlacementsOnglets(comptes) {
  const barre = document.getElementById("placements-onglets");
  barre.innerHTML = "";
  comptes.forEach((compte) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = compte.compte_nom;
    if (compte.compte_id === state.placementCompteId) btn.classList.add("active");
    btn.addEventListener("click", async () => {
      state.placementCompteId = compte.compte_id;
      [...barre.children].forEach((b) => b.classList.toggle("active", b === btn));
      await loadPlacementDetail(compte.compte_id);
    });
    barre.appendChild(btn);
  });
}

async function loadPlacementDetail(compteId) {
  try {
    placementDetail = await apiFetch(`/placements/${compteId}`);
    renderPlacementKpis(placementDetail.par_monnaie);
    renderDetentions(placementDetail.detentions);
    renderMouvementsTitres(placementDetail.operations);
    majResumeOperationAction();
  } catch (err) {
    showMessage(err.message, "error");
  }
}

/**
 * Une grille de KPI par monnaie du compte : espèces, portefeuille et plus-value
 * ne s'additionnent pas d'une monnaie à l'autre. Le titre de monnaie n'apparaît
 * que sur un compte multi-devises — sinon il n'apprend rien, le symbole étant
 * déjà sur chaque montant.
 */
function renderPlacementKpis(parMonnaie) {
  const conteneur = document.getElementById("placements-kpis");
  conteneur.innerHTML = "";
  const plusieurs = parMonnaie.length > 1;
  parMonnaie.forEach((bloc) => {
    const plusValue = bloc.valorisation - bloc.montant_investi;
    const signe = plusValue >= 0 ? "positif" : "negatif";
    const titre = plusieurs ? `<h4>${escapeHtml(bloc.monnaie_nom)}</h4>` : "";
    const grille = document.createElement("div");
    grille.innerHTML = `
      ${titre}
      <div class="kpi-grid">
        <div class="kpi-card">
          <div class="kpi-label">${t("Espèces")}</div>
          <div class="kpi-valeur">${formatMontant(bloc.solde_espece, bloc.monnaie_id)}</div>
          <div class="kpi-sous-texte">${t("Liquidités disponibles pour acheter")}</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-label">${t("Portefeuille")}</div>
          <div class="kpi-valeur">${formatMontant(bloc.valorisation, bloc.monnaie_id)}</div>
          <div class="kpi-sous-texte">${t("Titres détenus, au dernier cours saisi")}</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-label">${t("Total du compte")}</div>
          <div class="kpi-valeur">${formatMontant(bloc.total, bloc.monnaie_id)}</div>
          <div class="kpi-sous-texte">${t("Espèces + portefeuille")}</div>
        </div>
        <div class="kpi-card">
          <div class="kpi-label">${t("Plus-value latente")}</div>
          <div class="kpi-valeur ${signe}">${plusValue >= 0 ? "+" : ""}${formatMontant(
            plusValue,
            bloc.monnaie_id
          )}</div>
          <div class="kpi-sous-texte">${t("Valorisation − capital investi")}</div>
        </div>
      </div>
    `;
    conteneur.appendChild(grille);
  });
}

// Quantités : jusqu'à 6 décimales, sans zéros inutiles — les fractions de parts
// sont courantes (ETF), mais "10" doit rester "10".
function formatQuantite(valeur) {
  return Number(valeur.toFixed(6)).toLocaleString("fr-FR", { maximumFractionDigits: 6 });
}

function renderDetentions(detentions) {
  const body = document.getElementById("placements-detentions");
  body.innerHTML = "";
  if (detentions.length === 0) {
    body.innerHTML = `<tr><td colspan="7" class="hint">${t("Aucun titre détenu sur ce compte.")}</td></tr>`;
    return;
  }
  detentions.forEach((d) => {
    const signe = d.plus_value_latente >= 0 ? "entree" : "sortie";
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${escapeHtml(d.action_nom)}</td>
      <td>${formatQuantite(d.quantite)}</td>
      <td class="montant neutre">${formatMontant(d.prix_revient_unitaire, d.monnaie_id)}</td>
      <td class="montant neutre">${formatMontant(d.montant_investi, d.monnaie_id)}</td>
      <td class="montant neutre">${formatMontant(d.valeur_unitaire, d.monnaie_id)}</td>
      <td class="montant neutre">${formatMontant(d.valorisation, d.monnaie_id)}</td>
      <td><span class="montant ${signe}">${d.plus_value_latente >= 0 ? "+" : "−"}${formatMontant(
        Math.abs(d.plus_value_latente),
        d.monnaie_id
      )}</span></td>
    `;
    body.appendChild(tr);
  });
}

function renderMouvementsTitres(operations) {
  const body = document.getElementById("placements-mouvements");
  body.innerHTML = "";
  if (operations.length === 0) {
    body.innerHTML = `<tr><td colspan="7" class="hint">${t("Aucun mouvement.")}</td></tr>`;
    return;
  }
  operations.forEach((op) => {
    const estAchat = op.sens === "achat";
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${formatDate(op.date)}</td>
      <td><span class="badge-${estAchat ? "partiel" : "total"}">${estAchat ? "Achat" : "Vente"}</span></td>
      <td>${escapeHtml(op.action_nom)}</td>
      <td>${formatQuantite(op.quantite)}</td>
      <td class="montant neutre">${formatMontant(op.prix_unitaire, op.monnaie_id)}</td>
      <td>${montantHtml(op.montant, estAchat ? "dépense" : "entrée", op.monnaie_id)}</td>
      <td>
        <button data-action="supprimer-mouvement" data-id="${op.id}" class="danger">${t("Supprimer")}</button>
      </td>
    `;
    body.appendChild(tr);
  });

  body.querySelectorAll("button[data-action='supprimer-mouvement']").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!confirm(t("Supprimer ce mouvement ? Le solde du compte sera recalculé."))) return;
      try {
        await apiFetch(`/placements/operations/${btn.dataset.id}`, { method: "DELETE" });
        showMessage(t("Mouvement supprimé"), "success");
        await loadPlacementDetail(state.placementCompteId);
      } catch (err) {
        showMessage(err.message, "error");
      }
    });
  });
}

function quantiteDetenue(actionId) {
  if (!placementDetail) return 0;
  const detention = placementDetail.detentions.find((d) => d.action_id === actionId);
  return detention ? detention.quantite : 0;
}

// Récapitule ce que le formulaire va produire (montant débité/crédité) et, pour
// une vente, ce qui est réellement disponible : les deux seules informations
// que la saisie ne montre pas d'elle-même.
function majResumeOperationAction() {
  const sens = document.getElementById("operation-action-sens").value;
  const actionId = Number(document.getElementById("operation-action-titre").value);
  const quantite = parseFloat(document.getElementById("operation-action-quantite").value || "0");
  const prix = parseFloat(document.getElementById("operation-action-prix").value || "0");
  const resume = document.getElementById("operation-action-resume");

  if (state.actions.length === 0) {
    resume.textContent = "Ajoute d'abord un titre dans « Titres suivis » ci-dessous.";
    return;
  }
  // Le prix est libellé dans la monnaie de cotation du titre : c'est elle qui
  // décide de quelles espèces bougent.
  const action = state.actions.find((a) => a.id === actionId);
  const monnaieId = action ? action.monnaie_id : null;
  const montant = quantite * prix;
  const mouvement =
    sens === "achat"
      ? t("{montant} seront débités des espèces du compte.", {
          montant: formatMontant(montant, monnaieId),
        })
      : t("{montant} seront crédités sur les espèces du compte.", {
          montant: formatMontant(montant, monnaieId),
        });
  if (sens === "vente") {
    const detenue = quantiteDetenue(actionId);
    const alerte =
      quantite > detenue
        ? ` — impossible : ${formatQuantite(detenue)} détenu(s) seulement.`
        : "";
    resume.textContent = `Détenu sur ce compte : ${formatQuantite(detenue)}. ${mouvement}${alerte}`;
    return;
  }
  resume.textContent = mouvement;
}

document.querySelectorAll("#operation-action-sens-boutons button").forEach((btn) => {
  btn.addEventListener("click", () => {
    document
      .querySelectorAll("#operation-action-sens-boutons button")
      .forEach((b) => b.classList.toggle("active", b === btn));
    document.getElementById("operation-action-sens").value = btn.dataset.sens;
    majResumeOperationAction();
  });
});

["operation-action-titre", "operation-action-quantite", "operation-action-prix"].forEach((id) => {
  document.getElementById(id).addEventListener("input", majResumeOperationAction);
});

document.getElementById("form-operation-action").addEventListener("submit", async (e) => {
  e.preventDefault();
  if (!state.placementCompteId) return;
  const payload = {
    action_id: Number(document.getElementById("operation-action-titre").value),
    sens: document.getElementById("operation-action-sens").value,
    quantite: parseFloat(document.getElementById("operation-action-quantite").value),
    prix_unitaire: parseFloat(document.getElementById("operation-action-prix").value),
    date: document.getElementById("operation-action-date").value,
  };
  try {
    await apiFetch(`/placements/${state.placementCompteId}/operations`, {
      method: "POST",
      body: JSON.stringify(payload),
    });
    showMessage(payload.sens === "achat" ? "Achat enregistré" : "Vente enregistrée", "success");
    document.getElementById("operation-action-quantite").value = "";
    document.getElementById("operation-action-prix").value = "";
    await loadPlacementDetail(state.placementCompteId);
  } catch (err) {
    showMessage(err.message, "error");
  }
});

document.getElementById("form-action").addEventListener("submit", async (e) => {
  e.preventDefault();
  const nomInput = document.getElementById("action-nom");
  const valeurInput = document.getElementById("action-valeur");
  try {
    await apiFetch("/actions", {
      method: "POST",
      body: JSON.stringify({
        nom: nomInput.value,
        valeur: parseFloat(valeurInput.value || "0"),
        monnaie_id: Number(document.getElementById("action-monnaie").value),
      }),
    });
    showMessage(t("Titre ajouté"), "success");
    nomInput.value = "";
    valeurInput.value = "0";
    await refreshActionsTitres();
    majResumeOperationAction();
  } catch (err) {
    showMessage(err.message, "error");
  }
});

// Accroche au noyau : c'est cette ligne qui fait vivre l'extension. Sans elle,
// les fichiers seraient chargés mais l'écran ne s'ouvrirait jamais — le noyau
// n'appelle `loadPlacements` nulle part, il ne connaît pas son nom.
BudgetApp.extensions.enregistrer("placements", { chargeur: loadPlacements });
