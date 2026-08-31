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

/** La case « Afficher les titres archivés » est-elle cochée ? */
function voirTitresArchives() {
  const case_ = document.getElementById("placements-voir-archives");
  return Boolean(case_ && case_.checked);
}

/* ---------- Types de titre ----------
 *
 * DES ÉTIQUETTES, ET RIEN DE PLUS. Aucun calcul de cette page ne les lit : ni
 * un solde, ni une valorisation, ni une plus-value. Elles servent à regrouper
 * les titres pour les regarder — c'est l'extension « Vue d'ensemble des
 * placements » qui en tire quelque chose.
 *
 * Gérées DEPUIS CET ÉCRAN et non depuis les Paramètres : on crée « ETF » au
 * moment où l'on type un titre, et repartir dans un autre écran pour ça ferait
 * perdre le fil de ce qu'on était en train de faire.
 */

// La liste connue, tenue à jour par refreshTypesTitre. Vit ici plutôt que dans
// `state` : le noyau ne la lit jamais, c'est une donnée de cette extension.
let typesTitre = [];

/**
 * Le menu « Type » d'un titre : une option vide en tête, puis les étiquettes.
 *
 * L'option vide n'est pas un défaut faute de mieux, c'est une VALEUR : un titre
 * non typé est un cas normal, et rien dans l'application ne réclame ce champ.
 * Sa valeur est "" et non "0" — c'est le formulaire qui traduit, au moment
 * d'envoyer (cf. `valeurTypeTitreEnvoyee`).
 */
function optionsTypesTitre(selectionne) {
  const vide = `<option value="">${escapeHtml(t("— aucun —"))}</option>`;
  return (
    vide +
    typesTitre
      .map(
        (type) =>
          `<option value="${type.id}"${
            Number(selectionne) === type.id ? " selected" : ""
          }>${escapeHtml(type.nom)}</option>`
      )
      .join("")
  );
}

/**
 * Ce qu'on envoie au serveur pour le champ « Type ».
 *
 * LE ZÉRO DÉTYPE, et c'est pour ça qu'il existe : côté schéma, `null` veut dire
 * « ne change pas » sur TOUS les champs d'une mise à jour partielle, il ne peut
 * donc pas vouloir dire aussi « retire le type ». Un menu remis sur « — aucun — »
 * envoie donc 0 (cf. crud.update_action).
 */
function valeurTypeTitreEnvoyee(valeurDuMenu) {
  return valeurDuMenu ? Number(valeurDuMenu) : 0;
}

async function refreshTypesTitre() {
  typesTitre = await apiFetch("/types-titre");
  const menu = document.getElementById("action-type-titre");
  if (menu) {
    const avant = menu.value;
    menu.innerHTML = optionsTypesTitre(avant);
  }
  renderTypesTitre();
}

function renderTypesTitre() {
  const bloc = document.getElementById("placements-types-titre-liste");
  if (!bloc) return;
  bloc.innerHTML = "";
  if (typesTitre.length === 0) {
    bloc.innerHTML = `<span class="hint">${t(
      "Aucun type. Ajoutes-en un ci-dessous si tu veux regrouper tes titres."
    )}</span>`;
    return;
  }
  typesTitre.forEach((type) => {
    const row = document.createElement("div");
    row.className = "import-mapping-row";
    // LE NOMBRE DE TITRES EST AFFICHÉ parce que la suppression, elle, ne
    // demande rien : elle détype sans avertir. Le compte est ce qui rend le
    // geste informé.
    row.innerHTML = `
      <span class="import-mapping-nom">${escapeHtml(type.nom)}</span>
      <span class="hint">${
        type.nb_titres === 0
          ? t("aucun titre")
          : t("{n} titre(s)", { n: type.nb_titres })
      }</span>
      <button type="button" data-type-titre-renommer="${type.id}">${t("Renommer")}</button>
      <button type="button" class="danger" data-type-titre-supprimer="${type.id}">${t(
        "Supprimer"
      )}</button>
    `;
    bloc.appendChild(row);
  });

  bloc.querySelectorAll("button[data-type-titre-renommer]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const type = typesTitre.find((x) => x.id === Number(btn.dataset.typeTitreRenommer));
      if (!type) return;
      const saisi = window.prompt(t("Nouveau nom pour « {nom} »", { nom: type.nom }), type.nom);
      if (saisi === null || saisi.trim() === type.nom) return;
      try {
        await apiFetch(`/types-titre/${type.id}`, {
          method: "PUT",
          body: JSON.stringify({ nom: saisi }),
        });
        // Un renommage retype tout le portefeuille d'un coup : les titres
        // pointent sur la ligne, pas sur son libellé. La liste des titres se
        // recharge donc avec.
        showMessage(t("Type renommé"), "success");
        await refreshTypesTitre();
        await refreshActionsTitres();
      } catch (err) {
        showMessage(err.message, "error");
      }
    });
  });

  bloc.querySelectorAll("button[data-type-titre-supprimer]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const type = typesTitre.find((x) => x.id === Number(btn.dataset.typeTitreSupprimer));
      if (!type) return;
      const question =
        type.nb_titres > 0
          ? t("Supprimer « {nom} » ? Les {n} titre(s) qui le portent perdront leur type.", {
              nom: type.nom,
              n: type.nb_titres,
            })
          : t("Supprimer « {nom} » ?", { nom: type.nom });
      if (!confirm(question)) return;
      try {
        await apiFetch(`/types-titre/${type.id}`, { method: "DELETE" });
        showMessage(t("Type supprimé"), "success");
        await refreshTypesTitre();
        await refreshActionsTitres();
      } catch (err) {
        showMessage(err.message, "error");
      }
    });
  });
}

async function refreshActionsTitres() {
  // Les archivés ne sont demandés que lorsqu'on veut les voir. Le menu d'achat,
  // lui, n'en montre JAMAIS : on ne peut pas acheter un titre qu'on a rangé —
  // il faut d'abord le remettre en service, ce qui est un geste explicite.
  state.actions = await apiFetch(
    voirTitresArchives() ? "/actions?inclure_archivees=true" : "/actions"
  );
  _refillPreservingSelection(document.getElementById("operation-action-titre"), (el) => {
    el.innerHTML = "";
    state.actions
      .filter((a) => !a.archivee)
      .forEach((a) => {
        const opt = document.createElement("option");
        opt.value = a.id;
        // La monnaie de cotation décide du compte depuis lequel le titre peut
        // s'acheter : elle doit se lire dans le menu, pas se découvrir à l'erreur.
        // `nom_affiche` et non `nom` : ce dernier est le libellé du courtier, qui
        // sert à RECONNAÎTRE le titre à l'import, pas à le lire.
        opt.textContent = `${a.nom_affiche} (${a.monnaie_symbole})`;
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
    // LE NOM DU COURTIER EN INFOBULLE quand le titre a été renommé : c'est lui
    // que le fichier porte, et le seul moyen de retrouver de quelle ligne du
    // relevé ce titre vient.
    const renomme = Boolean(action.nom_affichage);
    row.innerHTML = `
      <span class="import-mapping-nom"${
        renomme ? ` title="${escapeHtml(t("Nom du courtier :"))} ${escapeHtml(action.nom)}"` : ""
      }>${escapeHtml(action.nom_affiche)} — (${escapeHtml(action.monnaie_symbole)})${
        renomme ? ` <span class="titre-renomme-etiquette">${t("renommé")}</span>` : ""
      }${
        action.archivee
          ? ` <span class="titre-archive-etiquette">${t("archivé")}</span>`
          : ""
      }</span>
      <button type="button" data-action="renommer-titre" data-id="${action.id}"
              title="${t("Changer le nom affiché (le nom du courtier ne bouge pas)")}">
        ${t("Renommer")}
      </button>
      <input type="number" step="0.01" min="0" value="${Number(action.valeur).toFixed(2)}"
             data-action="cours" data-id="${action.id}" title="${t("Cours unitaire actuel")}" />
      <select data-action="type-titre" data-id="${action.id}"
              title="${t("Type du titre — purement descriptif")}">
        ${optionsTypesTitre(action.type_titre_id)}
      </select>
      <button type="button" data-action="${action.archivee ? "reactiver-titre" : "archiver-titre"}"
              data-id="${action.id}"
              title="${
                action.archivee
                  ? t("Remettre ce titre dans les listes")
                  : t("Ranger ce titre : il quitte les listes, son historique reste")
              }">
        ${action.archivee ? t("Remettre en service") : t("Archiver")}
      </button>
      <button type="button" data-action="supprimer-titre" data-id="${action.id}" class="danger">
        ${t("Supprimer")}
      </button>
    `;
    if (action.archivee) row.classList.add("titre-archive");
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

  // Le type part au `change` du menu, sans bouton : c'est un choix unique dans
  // une liste fermée, il n'y a rien à confirmer. La page n'est PAS rechargée —
  // le type ne change aucun montant, et un rechargement ferait perdre la
  // position dans une longue liste de titres.
  bloc.querySelectorAll("select[data-action='type-titre']").forEach((menu) => {
    menu.addEventListener("change", async () => {
      try {
        await apiFetch(`/actions/${menu.dataset.id}`, {
          method: "PUT",
          body: JSON.stringify({ type_titre_id: valeurTypeTitreEnvoyee(menu.value) }),
        });
        const action = state.actions.find((a) => a.id === Number(menu.dataset.id));
        if (action) {
          action.type_titre_id = menu.value ? Number(menu.value) : null;
        }
        // Le compte affiché à côté de chaque étiquette vient de bouger.
        await refreshTypesTitre();
      } catch (err) {
        showMessage(err.message, "error");
        await refreshActionsTitres();
      }
    });
  });

  /* RENOMMER N'EST PAS RENOMMER LE TITRE, mais ce qu'on en lit.
   *
   * `nom` est le libellé du courtier, et c'est par lui — à défaut d'ISIN — que
   * l'import RECONNAÎT le titre d'un fichier à l'autre. L'écraser ferait que
   * l'import suivant ne le retrouverait plus : il créerait un second titre du
   * même ISIN, et la position se scinderait en deux. On écrit donc à côté, dans
   * `nom_affichage`, et le nom du courtier reste intact et non modifiable —
   * comme l'ISIN.
   *
   * Une réponse VIDE rend au titre son nom d'origine : c'est le seul moyen de
   * défaire un renommage, et il fallait qu'il soit à portée du même geste.
   */
  bloc.querySelectorAll("button[data-action='renommer-titre']").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const action = state.actions.find((a) => a.id === Number(btn.dataset.id));
      if (!action) return;
      const saisi = window.prompt(
        t("Nom à afficher pour « {nom} » (laisse vide pour revenir au nom du courtier)", {
          nom: action.nom,
        }),
        action.nom_affichage || ""
      );
      if (saisi === null) return; // annulé
      try {
        await apiFetch(`/actions/${action.id}`, {
          method: "PUT",
          body: JSON.stringify({ nom_affichage: saisi }),
        });
        showMessage(
          saisi.trim() ? t("Titre renommé") : t("Nom du courtier rétabli"),
          "success"
        );
        await refreshActionsTitres();
        if (state.placementCompteId) await loadPlacementDetail(state.placementCompteId);
      } catch (err) {
        showMessage(err.message, "error");
      }
    });
  });

  bloc
    .querySelectorAll("button[data-action='archiver-titre'], button[data-action='reactiver-titre']")
    .forEach((btn) => {
      btn.addEventListener("click", async () => {
        const archiver = btn.dataset.action === "archiver-titre";
        try {
          await apiFetch(`/actions/${btn.dataset.id}`, {
            method: "PUT",
            body: JSON.stringify({ archivee: archiver }),
          });
          showMessage(
            archiver
              ? t("Titre archivé. Ses mouvements et ses plus-values sont intacts.")
              : t("Titre remis en service."),
            "success"
          );
          // La page entière : un titre qui sort ou revient change le menu
          // d'achat, et un titre archivé cesse d'être relu en ligne.
          await loadPlacements();
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
    // AVANT les titres : chaque ligne de « Titres suivis » porte un menu de
    // types, qui serait vide si la liste arrivait après.
    await refreshTypesTitre();
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
    // Une plus-value nulle n'est pas un gain : ni vert, ni rouge (cf.
    // classeMontant dans app.js).
    const signe = classeMontant(plusValue, plusValue > 0 ? "positif" : "negatif");
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
          <div class="kpi-valeur ${signe}">${
            montantEstNul(plusValue) || plusValue < 0 ? "" : "+"
          }${formatMontant(
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
    // Une plus-value nulle n'est ni un gain ni une perte : blanc, et sans signe
    // (cf. classeMontant / montantEstNul dans app.js).
    const nulle = montantEstNul(d.plus_value_latente);
    const signe = classeMontant(
      d.plus_value_latente,
      d.plus_value_latente > 0 ? "entree" : "sortie"
    );
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${escapeHtml(d.action_nom)}</td>
      <td>${formatQuantite(d.quantite)}</td>
      <td class="montant neutre">${formatMontant(d.prix_revient_unitaire, d.monnaie_id)}</td>
      <td class="montant neutre">${formatMontant(d.montant_investi, d.monnaie_id)}</td>
      <td class="montant neutre">${formatMontant(d.valeur_unitaire, d.monnaie_id)}</td>
      <td class="montant neutre">${formatMontant(d.valorisation, d.monnaie_id)}</td>
      <td><span class="montant ${signe}">${
        nulle ? "" : d.plus_value_latente > 0 ? "+" : "−"
      }${formatMontant(Math.abs(d.plus_value_latente), d.monnaie_id)}</span></td>
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
        type_titre_id: valeurTypeTitreEnvoyee(
          document.getElementById("action-type-titre").value
        ),
      }),
    });
    showMessage(t("Titre ajouté"), "success");
    nomInput.value = "";
    valeurInput.value = "0";
    // Le TYPE, lui, n'est pas remis à zéro : on saisit ses ETF à la suite, et
    // reposer le menu à chaque fois ferait recliquer la même valeur.
    await refreshTypesTitre();
    await refreshActionsTitres();
    majResumeOperationAction();
  } catch (err) {
    showMessage(err.message, "error");
  }
});

document.getElementById("form-type-titre").addEventListener("submit", async (e) => {
  e.preventDefault();
  const champ = document.getElementById("type-titre-nom");
  try {
    await apiFetch("/types-titre", {
      method: "POST",
      body: JSON.stringify({ nom: champ.value }),
    });
    showMessage(t("Type ajouté"), "success");
    champ.value = "";
    await refreshTypesTitre();
    // Les menus des lignes de « Titres suivis » sont dessinés avec la liste :
    // sans ce second passage, le type qu'on vient de créer n'y serait pas.
    await refreshActionsTitres();
  } catch (err) {
    showMessage(err.message, "error");
  }
});

// La case « Afficher les titres archivés » ne fait que rappeler la liste : c'est
// le serveur qui décide de ce qu'il rend (cf. refreshActionsTitres). Posée ici,
// une seule fois, plutôt que dans le rendu — la case, elle, ne se reconstruit
// jamais.
document
  .getElementById("placements-voir-archives")
  .addEventListener("change", () => refreshActionsTitres());

/**
 * GREFFE SUR LA PAGE COMPTES : le noyau affiche le solde en espèces de
 * chaque compte, mais un compte de placements vaut aussi ce que ses titres
 * valent — une information que seule cette extension connaît. On enveloppe
 * `loadComptesGlobale` (cf. CONTEXTE_PROJET, « une extension se greffe en
 * enveloppant ses fonctions ») plutôt que de dupliquer le chargement des
 * cartes : le noyau les construit, on ne fait qu'y ajouter une ligne.
 */
const loadComptesGlobaleAvantGreffe = window.loadComptesGlobale;
window.loadComptesGlobale = async function () {
  await loadComptesGlobaleAvantGreffe();
  await ajouterTotauxPlacementsSurCartes();
};

async function ajouterTotauxPlacementsSurCartes() {
  try {
    const comptes = await apiFetch("/placements");
    comptes.forEach((compte) => {
      const carte = document.querySelector(
        `#globale-comptes-placements .compte-card[data-compte-id="${compte.compte_id}"]`
      );
      if (!carte) return;
      compte.par_monnaie.forEach((bloc) => {
        const groupe = carte.querySelector(
          `.compte-solde-groupe[data-monnaie-id="${bloc.monnaie_id}"]`
        );
        if (!groupe) return;
        const ligne = document.createElement("div");
        ligne.className = "compte-total-placement";
        ligne.textContent = `${t("Total")} : ${formatMontant(bloc.total, bloc.monnaie_id)}`;
        groupe.appendChild(ligne);
      });
    });
  } catch (err) {
    // Un compte de placements sans total affiché n'est pas bloquant : la
    // carte reste utilisable avec son seul solde en espèces.
    console.error(err);
  }
}

// Accroche au noyau : c'est cette ligne qui fait vivre l'extension. Sans elle,
// les fichiers seraient chargés mais l'écran ne s'ouvrirait jamais — le noyau
// n'appelle `loadPlacements` nulle part, il ne connaît pas son nom.
BudgetApp.extensions.enregistrer("placements", { chargeur: loadPlacements });
