/* Extension « Impôts ».
 *
 * Ce fichier s'exécute dans la portée globale de la page, après l'injection de
 * page.html : tout ce que app.js expose lui est accessible (apiFetch, t,
 * showMessage, formatMontant, formatDate, nomCompte, nomCategorie…), et les
 * éléments sur lesquels il pose ses écouteurs existent déjà (cf.
 * extensions/README.md). Préfixe `imp` pour tout ce qui est global.
 *
 * L'ÉTIQUETTE « À DÉCLARER » se pose ailleurs : dans le formulaire d'une
 * opération, dans l'aperçu d'un import et par une règle. Ici on la LIT — les
 * entrées étiquetées d'une année, leur total par monnaie, le taux et la date
 * limite de cette année — et on peut la retirer d'une ligne.
 */

/* LA CASE « À DÉCLARER » DU FORMULAIRE D'OPÉRATION est écrite dans index.html avec `display:none`
 * et un attribut `data-extension-greffe` : c'est cette extension qui l'allume, et ce fichier n'est
 * chargé QUE si elle est active — sa seule exécution vaut donc « allume-la ». Compter sur le noyau
 * ne marche qu'au moment où l'on BASCULE l'interrupteur dans les Paramètres (cf.
 * analyse-budget.js, même patron). */
BudgetApp.extensions.majVisibilite("impots", true);

const IMP_BASE = "/impots";

// L'année affichée. null = l'année en cours (le serveur répond avec l'année retenue).
let impAnnee = null;
let impVue = null;

async function loadImpots() {
  try {
    impVue = await apiFetch(impAnnee ? `${IMP_BASE}?annee=${impAnnee}` : IMP_BASE);
    impAnnee = impVue.annee;
    impRendre();
  } catch (err) {
    showMessage(err.message, "error");
  }
}

function impRendre() {
  impRendreAnnees();
  impRendreDeclaration();
  impRendreBilans();
  impRendreOperations();
}

/* ---------- Les années, en pastilles ---------- */

function impRendreAnnees() {
  const conteneur = document.getElementById("impots-annees");
  conteneur.innerHTML = "";
  impVue.annees.forEach((annee) => {
    const bouton = document.createElement("button");
    bouton.type = "button";
    bouton.textContent = annee;
    bouton.classList.toggle("active", annee === impVue.annee);
    bouton.addEventListener("click", () => {
      impAnnee = annee;
      loadImpots();
    });
    conteneur.appendChild(bouton);
  });
}

/* ---------- Le taux et la date limite ---------- */

function impRendreDeclaration() {
  const { taux_pct: taux, date_limite: limite, jours_restants: jours } = impVue.declaration;
  document.getElementById("impots-taux").value = taux ?? "";
  document.getElementById("impots-date-limite").value = limite || "";
  const delai = document.getElementById("impots-delai");
  if (jours == null) {
    delai.textContent = "";
  } else if (jours > 1) {
    delai.textContent = t("Il reste {n} jours avant la date limite.", { n: jours });
  } else if (jours === 1) {
    delai.textContent = t("Il reste 1 jour avant la date limite.");
  } else if (jours === 0) {
    delai.textContent = t("La date limite, c'est aujourd'hui.");
  } else {
    delai.textContent = t("La date limite est dépassée de {n} jour(s).", { n: -jours });
  }
}

document.getElementById("btn-impots-declaration").addEventListener("click", async () => {
  const brut = document.getElementById("impots-taux").value.trim();
  const taux = brut === "" ? null : Number(brut);
  if (taux !== null && (!Number.isFinite(taux) || taux < 0 || taux > 100)) {
    showMessage(t("Le taux est un pourcentage entre 0 et 100."), "error");
    return;
  }
  // TOUJOURS LES DEUX CHAMPS : vider un champ l'efface, c'est le geste attendu (le serveur
  // distingue « absent » de « null », cf. schemas_impots.DeclarationEcriture).
  try {
    await apiFetch(`${IMP_BASE}/declaration/${impVue.annee}`, {
      method: "PUT",
      body: JSON.stringify({
        taux_pct: taux,
        date_limite: document.getElementById("impots-date-limite").value || null,
      }),
    });
    showMessage(t("Réglages enregistrés"), "success");
    await loadImpots();
  } catch (err) {
    showMessage(err.message, "error");
  }
});

/* ---------- Un bilan par monnaie ---------- */

function impLigneKpi(titre, valeur, principal = false) {
  return `<div class="impots-kpi ${principal ? "impots-kpi-principal" : ""}">
    <span>${escapeHtml(titre)}</span>
    <span class="impots-kpi-valeur">${valeur}</span>
  </div>`;
}

function impRendreBilans() {
  const conteneur = document.getElementById("impots-bilans");
  conteneur.innerHTML = impVue.monnaies
    .map((bilan) => {
      let corps = impLigneKpi(
        t("À déclarer"),
        formatMontant(bilan.total_reel, bilan.monnaie_id),
        true
      );
      // Le prévu n'entre ni dans le total ni dans l'impôt : il est montré à part pour qu'on
      // sache ce qui va s'y ajouter une fois perçu.
      if (bilan.total_prevu) {
        corps += impLigneKpi(t("dont prévu"), formatMontant(bilan.total_prevu, bilan.monnaie_id));
      }
      if (bilan.impot_estime != null) {
        corps += impLigneKpi(t("Impôt estimé"), formatMontant(bilan.impot_estime, bilan.monnaie_id));
      }
      return `<div class="impots-bilan">
        <div class="impots-bilan-monnaie">${escapeHtml(bilan.monnaie_nom)}</div>
        ${corps}
      </div>`;
    })
    .join("");
}

/* ---------- Le tableau, groupé par jour ---------- */

function impRendreOperations() {
  const corps = document.getElementById("impots-liste");
  corps.innerHTML = "";
  document.getElementById("impots-nombre").textContent = impVue.operations.length;
  if (impVue.operations.length === 0) {
    corps.innerHTML = `<tr><td colspan="6" class="hint">${escapeHtml(
      t("Aucune entrée à déclarer cette année. Coche « À déclarer » sur une entrée d'argent.")
    )}</td></tr>`;
    return;
  }

  let jourCourant = null;
  impVue.operations.forEach((operation) => {
    if (operation.date !== jourCourant) {
      jourCourant = operation.date;
      const entete = document.createElement("tr");
      entete.className = "impots-jour";
      entete.innerHTML = `<td colspan="6">${escapeHtml(formatDate(operation.date))}</td>`;
      corps.appendChild(entete);
    }
    const ligne = document.createElement("tr");
    // Une entrée prévue n'a pas encore été perçue : atténuée, et hors du total.
    if (operation.statut !== "réel") ligne.className = "impots-prevue";
    // MÊMES COLONNES QUE LA PAGE OPÉRATIONS : nature, montant, compte, catégorie, statut.
    ligne.innerHTML = `
      <td>${escapeHtml(operation.nature)}</td>
      <td>${montantHtml(operation.montant, "entrée", operation.monnaie_id)}</td>
      <td>${escapeHtml(nomCompte(operation.compte_id))}</td>
      <td>${escapeHtml(nomCategorie(operation.categorie_id))}</td>
      <td>${statutLabel(operation.statut)}</td>
      <td><button type="button" data-action="retirer">${t("Retirer")}</button></td>
    `;
    // RETIRER, PAS SUPPRIMER, et sans confirmation : l'opération reste en base avec son
    // compte, sa catégorie et son montant — seule l'étiquette part, et la remettre est un clic.
    ligne.querySelector("[data-action='retirer']").addEventListener("click", async () => {
      try {
        await apiFetch(`${IMP_BASE}/operations/${operation.id}`, { method: "DELETE" });
        showMessage(t("Étiquette retirée (l'opération reste en base)."), "success");
        await loadImpots();
      } catch (err) {
        showMessage(err.message, "error");
      }
    });
    corps.appendChild(ligne);
  });
}

/* ---------- Le sélecteur d'opérations ----------
 *
 * LE MÊME QUE CELUI DES PROJETS : des dates, des comptes et des catégories à cocher, un
 * libellé, puis une liste où cocher les lignes à marquer. À UN DÉTAIL PRÈS : seules les
 * entrées d'argent de type classique y paraissent — les seules qui se déclarent (le
 * serveur le garantit, cf. crud.operation_declarable) —, et le filtre de catégories ne
 * propose que les catégories d'ENTRÉE. Proposer le reste inviterait à un geste que le
 * serveur écarterait.
 */
let impCandidats = [];
let impSelection = new Set();
// `null` = tout coché, c'est-à-dire aucun filtre (cf. projets.js, projetFiltres).
const impFiltres = { comptes: null, categories: null };

function impPoserFiltre(cle, conteneurId, libelle, options) {
  const coches = impFiltres[cle] ? [...impFiltres[cle]] : options.map((o) => o.cle);
  creerMenuCases(document.getElementById(conteneurId), {
    libelle,
    options,
    coches,
    toutSelectionner: true,
    onChange: (choisies) => {
      impFiltres[cle] = choisies.size === options.length ? null : choisies;
      impChercherCandidats();
    },
  });
}

async function impOuvrirSelecteur() {
  document.getElementById("impots-selecteur").style.display = "";
  try {
    await refreshComptes();
    await refreshCategories();
  } catch (err) {
    showMessage(err.message, "error");
    return;
  }
  // L'ANNÉE AFFICHÉE PAR DÉFAUT : c'est celle qu'on est en train de déclarer.
  const debut = document.getElementById("impots-filtre-debut");
  const fin = document.getElementById("impots-filtre-fin");
  if (!debut.value && !fin.value && impVue) {
    debut.value = `${impVue.annee}-01-01`;
    fin.value = `${impVue.annee}-12-31`;
  }
  impPoserFiltre(
    "comptes",
    "impots-filtre-comptes",
    t("Comptes"),
    state.comptes.map((c) => ({ cle: c.id, libelle: c.nom }))
  );
  impPoserFiltre(
    "categories",
    "impots-filtre-categories",
    t("Catégories"),
    state.categories
      .filter((c) => c.est_entree)
      .map((c) => ({
        cle: c.id,
        libelle: libelleCategorie(c.nom),
        couleur: couleurCategorie(c.couleur_index ?? 0),
      }))
  );
  impChercherCandidats();
}

function impFermerSelecteur() {
  document.getElementById("impots-selecteur").style.display = "none";
  impCandidats = [];
  impSelection = new Set();
  impMajSelection();
}

async function impChercherCandidats() {
  const parametres = new URLSearchParams();
  const debut = document.getElementById("impots-filtre-debut").value;
  const fin = document.getElementById("impots-filtre-fin").value;
  if (debut) parametres.set("date_debut", debut);
  if (fin) parametres.set("date_fin", fin);
  try {
    const operations = await apiFetch(`/operations?${parametres.toString()}`);
    const texte = document.getElementById("impots-filtre-texte").value.trim().toLowerCase();
    const { comptes, categories } = impFiltres;
    impCandidats = operations.filter(
      (operation) =>
        // Déjà étiquetée : elle est dans le tableau du dessous, la reproposer
        // inviterait à un geste sans effet.
        !operation.a_declarer &&
        operation.type_code === "classique" &&
        operation.sens === "entrée" &&
        (!comptes || comptes.has(operation.compte_id)) &&
        (!categories || categories.has(operation.categorie_id)) &&
        (!texte || operation.nature.toLowerCase().includes(texte))
    );
  } catch (err) {
    showMessage(err.message, "error");
    return;
  }
  impSelection = new Set();
  impRendreCandidats();
}

function impRendreCandidats() {
  const corps = document.getElementById("impots-candidats-liste");
  corps.innerHTML = "";
  document.getElementById("impots-candidats-info").textContent = t(
    "{n} entrée(s) proposée(s). Celles déjà marquées à déclarer ne sont pas listées.",
    { n: impCandidats.length }
  );
  impCandidats.forEach((operation) => {
    const ligne = document.createElement("tr");
    ligne.innerHTML = `
      <td>${escapeHtml(operation.nature)}</td>
      <td>${montantHtml(operation.montant, operation.sens, operation.monnaie_id)}</td>
      <td>${escapeHtml(nomCompte(operation.compte_id))}</td>
      <td>${formatDate(operation.date)}</td>
      <td>${escapeHtml(nomCategorie(operation.categorie_id))}</td>
      <td><input type="checkbox" data-role="selection" ${
        impSelection.has(operation.id) ? "checked" : ""
      } /></td>`;
    ligne.querySelector("[data-role='selection']").addEventListener("change", (e) => {
      if (e.target.checked) impSelection.add(operation.id);
      else impSelection.delete(operation.id);
      impMajSelection();
    });
    corps.appendChild(ligne);
  });
  impMajSelection();
}

function impMajSelection() {
  document.getElementById("impots-selection-nombre").textContent = impSelection.size;
  document.getElementById("btn-impots-verser").disabled = impSelection.size === 0;
}

document
  .getElementById("btn-impots-ajouter-operations")
  .addEventListener("click", impOuvrirSelecteur);
document.getElementById("btn-impots-selecteur-fermer").addEventListener("click", impFermerSelecteur);
document.getElementById("btn-impots-filtrer").addEventListener("click", impChercherCandidats);
document.getElementById("impots-filtre-texte").addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    impChercherCandidats();
  }
});
document.getElementById("btn-impots-tout-selectionner").addEventListener("click", () => {
  // Bascule, comme dans les projets : re-cliquer désélectionne tout.
  const toutCoche = impSelection.size === impCandidats.length && impCandidats.length > 0;
  impSelection = toutCoche ? new Set() : new Set(impCandidats.map((o) => o.id));
  impRendreCandidats();
});
document.getElementById("btn-impots-verser").addEventListener("click", async () => {
  if (impSelection.size === 0) return;
  try {
    const resultat = await apiFetch(`${IMP_BASE}/operations`, {
      method: "POST",
      body: JSON.stringify({ operation_ids: [...impSelection] }),
    });
    showMessage(
      t("{n} entrée(s) marquée(s) à déclarer.", { n: resultat.ajoutees }),
      "success"
    );
    impFermerSelecteur();
    await loadImpots();
  } catch (err) {
    showMessage(err.message, "error");
  }
});

// L'enregistrement auprès du noyau, en FIN de fichier : `loadImpots` doit exister au moment
// où on la référence. Le chargeur est rappelé à chaque ouverture de l'onglet — les
// étiquettes ont pu changer depuis. Le champ « À déclarer » du formulaire d'opération
// (index.html, data-extension-greffe) est montré par le noyau dès que l'extension tourne.
BudgetApp.extensions.enregistrer("impots", { chargeur: loadImpots });
