/**
 * Extension « Suivi des remboursements » — qui te doit combien, et à qui tu dois.
 *
 * CE QU'ELLE AJOUTE À L'APPLICATION : une seule colonne en base, celle qui dit à
 * qui une dette se rapporte. Aucun montant, aucun solde, aucune barre
 * d'histogramme ne change — l'application donne exactement les mêmes chiffres
 * avec ou sans elle, cet écran ne fait que les ventiler par profil.
 *
 * TOUT EST PRÉFIXÉ `suivir`. Les scripts d'extension s'exécutent en portée
 * GLOBALE, dans l'ordre alphabétique des dossiers : une fonction `renderTableau`
 * déclarée ici serait écrasée par celle du même nom d'une extension qui vient
 * après, et l'écran afficherait les données de l'autre — sans la moindre erreur
 * en console (cf. extensions/README.md, « deux pièges de la portée globale »).
 */

const SUIVIR_ID = "suivi-remboursements";

// Ce que l'écran tient entre deux requêtes. `monnaieId` est l'onglet actif, et
// il survit à un rechargement de la vue : ranger une ligne ne doit pas renvoyer
// l'utilisateur sur la première devise.
const suivirEtat = {
  vue: null,
  monnaieId: null,
  profilDeplie: null,
  operationsDepliees: [],
  profilEnEdition: null,
};

/* ---------- Chargement ---------- */

async function loadSuiviRemboursements() {
  try {
    suivirEtat.vue = await apiFetch("/suivi-remboursements/vue");
  } catch (err) {
    showMessage(err.message, "error");
    return;
  }
  renderSuivirTout();
}

function renderSuivirTout() {
  const vue = suivirEtat.vue;
  if (!vue) return;

  // L'onglet actif ne survit que si sa monnaie est encore là : la dernière
  // dette d'une devise réglée, son onglet disparaît.
  const monnaies = vue.monnaies || [];
  if (!monnaies.some((m) => m.monnaie_id === suivirEtat.monnaieId)) {
    suivirEtat.monnaieId = monnaies.length ? monnaies[0].monnaie_id : null;
  }

  document.getElementById("suivir-vide").style.display = monnaies.length ? "none" : "";
  document.getElementById("suivir-contenu").style.display = monnaies.length ? "" : "none";

  renderSuivirOngletsMonnaie(monnaies);
  renderSuivirBloc(monnaies.find((m) => m.monnaie_id === suivirEtat.monnaieId) || null);
  renderSuivirARattacher();
  renderSuivirProfils();
}

/**
 * Un onglet par monnaie, masqué tant qu'il n'y en a qu'une : un onglet unique
 * ne choisit rien et ne ferait que répéter le symbole déjà présent sur chaque
 * montant.
 */
function renderSuivirOngletsMonnaie(monnaies) {
  const barre = document.getElementById("suivir-onglets-monnaie");
  barre.innerHTML = "";
  barre.hidden = monnaies.length <= 1;
  monnaies.forEach((bloc) => {
    const bouton = document.createElement("button");
    bouton.type = "button";
    bouton.textContent = `${bloc.monnaie_nom} (${bloc.monnaie_symbole})`;
    bouton.classList.toggle("active", bloc.monnaie_id === suivirEtat.monnaieId);
    bouton.addEventListener("click", () => {
      suivirEtat.monnaieId = bloc.monnaie_id;
      // Le détail déplié appartenait à l'ancienne monnaie : le garder ouvert
      // montrerait des lignes qui ne sont pas celles du tableau au-dessus.
      suivirEtat.profilDeplie = null;
      renderSuivirTout();
    });
    barre.appendChild(bouton);
  });
}

/* ---------- Le tableau : une ligne par profil ---------- */

function renderSuivirBloc(bloc) {
  const totalRecevoir = document.getElementById("suivir-total-recevoir");
  const totalRendre = document.getElementById("suivir-total-rendre");
  const totalNet = document.getElementById("suivir-total-net");
  const tableau = document.getElementById("suivir-tableau");

  if (!bloc) {
    [totalRecevoir, totalRendre, totalNet].forEach((el) => (el.textContent = "-"));
    tableau.innerHTML = "";
    return;
  }

  const monnaieId = bloc.monnaie_id;
  totalRecevoir.textContent = formatMontant(bloc.total_a_recevoir, monnaieId);
  totalRendre.textContent = formatMontant(bloc.total_a_rendre, monnaieId);
  suivirEcrireNet(totalNet, bloc.net, monnaieId);

  // L'ÉCHELLE DES BARRES EST COMMUNE À TOUT LE TABLEAU, et c'est ce qui les rend
  // comparables : une barre calibrée sur sa propre ligne serait toujours pleine,
  // et 12 € se lirait comme 1 200 €. Le maximum est pris sur les DEUX côtés,
  // pour qu'une créance et une dette de même taille aient la même longueur.
  const echelle = Math.max(
    1,
    ...bloc.profils.map((p) => Math.max(p.a_recevoir, p.a_rendre))
  );

  tableau.innerHTML = "";
  bloc.profils.forEach((profil) => {
    tableau.appendChild(suivirLigneProfil(profil, monnaieId, echelle));
    if (profil.profil_id != null && profil.profil_id === suivirEtat.profilDeplie) {
      tableau.appendChild(suivirDetailProfil(profil));
    }
  });
}

/**
 * Une ligne : le nom, la barre divergente, le net.
 *
 * LA BARRE VA À DROITE QUAND ON NOUS DOIT, À GAUCHE QUAND ON DOIT — un axe
 * central, deux couleurs. C'est la seule forme qui répond d'un coup d'œil à la
 * question de l'écran : un profil qui me doit et un profil à qui je dois ne se
 * distinguent pas par la longueur mais par le CÔTÉ, et le tableau se lit sans
 * lire les chiffres. Un profil qui porte les deux (il me doit 80, je lui dois
 * 30) montre ses deux segments : le net seul aurait effacé la moitié de ce qui
 * s'est passé entre nous.
 */
function suivirLigneProfil(profil, monnaieId, echelle) {
  const ligne = document.createElement("div");
  ligne.className = "suivir-ligne";
  const sansProfil = profil.profil_id == null;
  ligne.classList.toggle("suivir-ligne-sans-profil", sansProfil);
  if (!sansProfil) ligne.dataset.profilId = profil.profil_id;

  const partRecevoir = (profil.a_recevoir / echelle) * 100;
  const partRendre = (profil.a_rendre / echelle) * 100;

  ligne.innerHTML = `
    <span class="suivir-ligne-nom">${escapeHtml(profil.profil_nom)}</span>
    <span class="suivir-barre" role="presentation">
      <span class="suivir-barre-cote suivir-barre-gauche">
        <span class="suivir-barre-remplissage suivir-du" style="width:${partRendre.toFixed(2)}%"></span>
      </span>
      <span class="suivir-barre-axe"></span>
      <span class="suivir-barre-cote suivir-barre-droite">
        <span class="suivir-barre-remplissage suivir-creance" style="width:${partRecevoir.toFixed(2)}%"></span>
      </span>
    </span>
    <span class="suivir-ligne-detail hint">${suivirDetailChiffre(profil, monnaieId)}</span>
    <span class="suivir-ligne-net"></span>
  `;
  suivirEcrireNet(ligne.querySelector(".suivir-ligne-net"), profil.net, monnaieId);

  // « Sans profil » n'a pas de détail à déplier : ses lignes sont exactement
  // celles de la liste « À rattacher », juste en dessous.
  if (!sansProfil) {
    ligne.classList.add("suivir-ligne-cliquable");
    ligne.addEventListener("click", () => suivirBasculerProfil(profil.profil_id));
  }
  return ligne;
}

/**
 * « on te doit 80,00 € · tu dois 30,00 € » — les deux composantes du net.
 *
 * Écrites seulement quand il y en a DEUX : quand un profil n'a que des créances
 * (le cas ordinaire), répéter le net en dessous n'apprendrait rien.
 */
function suivirDetailChiffre(profil, monnaieId) {
  if (montantEstNul(profil.a_recevoir) || montantEstNul(profil.a_rendre)) {
    return `${profil.nb_lignes} ${profil.nb_lignes > 1 ? t("lignes") : t("ligne")}`;
  }
  return `${t("on te doit")} ${formatMontant(profil.a_recevoir, monnaieId)} · ${t(
    "tu dois"
  )} ${formatMontant(profil.a_rendre, monnaieId)}`;
}

// Le signe dit le sens, comme sur la variation du mois : positif on te doit
// (vert), négatif tu dois (rouge). C'est ce qui permet de lire sans le libellé.
function suivirEcrireNet(element, net, monnaieId) {
  const nul = montantEstNul(net);
  element.textContent = `${net > 0 && !nul ? "+" : ""}${formatMontant(net, monnaieId)}`;
  element.classList.toggle("positif", net > 0 && !nul);
  element.classList.toggle("negatif", net < 0 && !nul);
  element.classList.toggle("montant-nul", nul);
}

async function suivirBasculerProfil(profilId) {
  if (suivirEtat.profilDeplie === profilId) {
    suivirEtat.profilDeplie = null;
    suivirEtat.operationsDepliees = [];
    renderSuivirTout();
    return;
  }
  try {
    suivirEtat.operationsDepliees = await apiFetch(
      `/suivi-remboursements/profils/${profilId}/operations`
    );
    suivirEtat.profilDeplie = profilId;
  } catch (err) {
    showMessage(err.message, "error");
    return;
  }
  renderSuivirTout();
}

/**
 * Le détail d'un profil : TOUTES ses opérations, réglées comprises, et les
 * règlements avec.
 *
 * Le tableau du dessus répond à « ce qu'il reste », ce détail à « ce qui s'est
 * passé ». Une dette remboursée disparaît du premier et doit rester dans le
 * second — sans quoi rattacher une opération à quelqu'un reviendrait à la perdre
 * de vue le jour où elle est réglée.
 *
 * LES AUTRES MONNAIES Y SONT AUSSI. Le détail suit le PROFIL, pas l'onglet : ce
 * qu'on veut en le dépliant, c'est tout ce qui s'est passé avec cette personne,
 * et son symbole est écrit sur chaque montant.
 */
function suivirDetailProfil(profil) {
  const bloc = document.createElement("div");
  bloc.className = "suivir-detail";
  const lignes = suivirEtat.operationsDepliees || [];
  if (!lignes.length) {
    bloc.innerHTML = `<p class="hint">${t("Aucune opération rattachée à ce profil.")}</p>`;
    return bloc;
  }
  bloc.innerHTML = `
    <table>
      <thead>
        <tr>
          <th>${t("Date")}</th><th>${t("Libellé")}</th><th>${t("Compte")}</th>
          <th>${t("Nature")}</th><th>${t("Montant")}</th><th>${t("Reste dû")}</th><th></th>
        </tr>
      </thead>
      <tbody>
        ${lignes.map((l) => suivirLigneDetail(l)).join("")}
      </tbody>
    </table>
  `;
  bloc.querySelectorAll("button[data-detacher]").forEach((bouton) => {
    bouton.addEventListener("click", (e) => {
      e.stopPropagation();
      suivirRattacher([Number(bouton.dataset.detacher)], null);
    });
  });
  return bloc;
}

// Ce qu'une ligne représente dans le solde du profil. Le serveur l'a déjà déduit
// du type (cf. service_suivi_remboursements.ROLE_PAR_TYPE) : le refaire ici
// aurait posé la même règle à deux endroits, qui finissent toujours par diverger.
const SUIVIR_LIBELLE_ROLE = {
  on_me_doit: "On te doit",
  je_dois: "Tu dois",
  reglement: "Règlement",
};

function suivirLigneDetail(ligne) {
  const regle = ligne.role === "reglement" || montantEstNul(ligne.reste);
  return `
    <tr class="${regle ? "suivir-ligne-reglee" : ""}">
      <td>${escapeHtml(ligne.date)}</td>
      <td>${escapeHtml(ligne.nature)}</td>
      <td>${escapeHtml(ligne.compte_nom)}</td>
      <td>${t(SUIVIR_LIBELLE_ROLE[ligne.role] || "Règlement")}</td>
      <td class="montant">${formatMontant(ligne.montant, ligne.monnaie_id)}</td>
      <td class="montant">${
        ligne.role === "reglement" ? "—" : formatMontant(ligne.reste, ligne.monnaie_id)
      }</td>
      <td><button type="button" data-detacher="${ligne.id}">${t("Détacher")}</button></td>
    </tr>
  `;
}

/* ---------- « À rattacher » : la liste de travail ---------- */

/**
 * Les dettes qu'aucun profil ne porte encore.
 *
 * PAR LOTS, parce que c'est ainsi qu'on range : après un voyage, dix lignes
 * reviennent à la même personne. Les rattacher une par une aurait fait dix
 * gestes pour une seule pensée.
 */
function renderSuivirARattacher() {
  const conteneur = document.getElementById("suivir-a-rattacher");
  const titre = document.getElementById("suivir-titre-a-rattacher");
  const lignes = (suivirEtat.vue && suivirEtat.vue.a_rattacher) || [];
  const profils = (suivirEtat.vue && suivirEtat.vue.profils) || [];

  // Sa disparition EST le signal qu'on a fini : un bloc « rien à rattacher »
  // resterait à l'écran pour ne rien dire.
  titre.style.display = lignes.length ? "" : "none";
  conteneur.innerHTML = "";
  if (!lignes.length) return;

  if (!profils.length) {
    conteneur.innerHTML = `<p class="hint">${escapeHtml(
      t("Crée d'abord un profil ci-dessous, puis reviens rattacher ces lignes.")
    )}</p>`;
  }

  const tableau = document.createElement("table");
  tableau.innerHTML = `
    <thead>
      <tr>
        <th><input type="checkbox" id="suivir-tout-cocher" title="${t("Tout cocher")}" /></th>
        <th>${t("Date")}</th><th>${t("Libellé")}</th><th>${t("Compte")}</th>
        <th>${t("Nature")}</th><th>${t("Reste dû")}</th>
      </tr>
    </thead>
    <tbody>
      ${lignes
        .map(
          (l) => `
        <tr>
          <td><input type="checkbox" data-operation="${l.id}" /></td>
          <td>${escapeHtml(l.date)}</td>
          <td>${escapeHtml(l.nature)}</td>
          <td>${escapeHtml(l.compte_nom)}</td>
          <td>${t(SUIVIR_LIBELLE_ROLE[l.role] || "Règlement")}</td>
          <td class="montant">${formatMontant(l.reste, l.monnaie_id)}</td>
        </tr>`
        )
        .join("")}
    </tbody>
  `;
  conteneur.appendChild(tableau);

  const actions = document.createElement("div");
  actions.className = "actions";
  actions.innerHTML = `
    <label class="suivir-affectation">${t("Rattacher au profil")}
      <select id="suivir-profil-cible">
        ${profils
          .map((p) => `<option value="${p.id}">${escapeHtml(p.nom)}</option>`)
          .join("")}
      </select>
    </label>
    <button type="button" class="primary" id="btn-suivir-rattacher" ${
      profils.length ? "" : "disabled"
    }>${t("Rattacher la sélection")}</button>
  `;
  conteneur.appendChild(actions);

  const toutCocher = tableau.querySelector("#suivir-tout-cocher");
  toutCocher.addEventListener("change", () => {
    tableau
      .querySelectorAll("input[data-operation]")
      .forEach((c) => (c.checked = toutCocher.checked));
  });

  actions.querySelector("#btn-suivir-rattacher").addEventListener("click", () => {
    const ids = [...tableau.querySelectorAll("input[data-operation]:checked")].map((c) =>
      Number(c.dataset.operation)
    );
    if (!ids.length) {
      showMessage(t("Coche au moins une ligne à rattacher."), "error");
      return;
    }
    suivirRattacher(ids, Number(actions.querySelector("#suivir-profil-cible").value));
  });
}

async function suivirRattacher(operationIds, profilId) {
  try {
    suivirEtat.vue = await apiFetch("/suivi-remboursements/rattachement", {
      method: "PUT",
      body: JSON.stringify({ operation_ids: operationIds, profil_id: profilId }),
    });
  } catch (err) {
    showMessage(err.message, "error");
    return;
  }
  // Le détail déplié vient d'être invalidé par le rattachement : on le rouvre
  // pour que la ligne détachée en disparaisse sous les yeux, plutôt que de
  // refermer le profil qu'on était en train de regarder.
  if (suivirEtat.profilDeplie != null) {
    try {
      suivirEtat.operationsDepliees = await apiFetch(
        `/suivi-remboursements/profils/${suivirEtat.profilDeplie}/operations`
      );
    } catch {
      suivirEtat.profilDeplie = null;
    }
  }
  renderSuivirTout();
  showMessage(profilId == null ? t("Opération détachée.") : t("Opérations rattachées."));
}

/* ---------- Les profils ---------- */

function renderSuivirProfils() {
  // LE FORMULAIRE PEUT ÊTRE POSÉ DANS CETTE LISTE (édition en ligne) : le vider
  // par `innerHTML` l'emporterait avec elle, et avec lui les écouteurs posés
  // dessus une fois pour toutes au chargement. Même précaution que loadComptes
  // et renderMonnaies dans le noyau.
  fermerFormulaireEnLigne("form-suivir-profil");
  const conteneur = document.getElementById("suivir-profils");
  const profils = (suivirEtat.vue && suivirEtat.vue.profils) || [];
  conteneur.innerHTML = "";
  if (!profils.length) {
    conteneur.innerHTML = `<p class="hint">${escapeHtml(
      t("Aucun profil. Ajoute-en un ci-dessous : c'est à eux que se rattachent les lignes.")
    )}</p>`;
    return;
  }
  profils.forEach((profil) => {
    const ligne = document.createElement("div");
    ligne.className = "import-mapping-row";
    ligne.dataset.id = profil.id;
    ligne.innerHTML = `
      <span class="drag-handle" title="${t("Glisser pour réordonner")}">⠿</span>
      <span class="import-mapping-nom">${escapeHtml(profil.nom)}</span>
      <span class="hint">${escapeHtml(profil.description)}</span>
      <button type="button" data-modifier="${profil.id}">${t("Modifier")}</button>
      <button type="button" class="danger" data-supprimer="${profil.id}">${t("Supprimer")}</button>
    `;
    ligne
      .querySelector("button[data-modifier]")
      .addEventListener("click", () => suivirRemplirFormulaire(profil, ligne));
    ligne
      .querySelector("button[data-supprimer]")
      .addEventListener("click", () => suivirSupprimerProfil(profil));
    conteneur.appendChild(ligne);
  });
}

function suivirRemplirFormulaire(profil, ancre) {
  // Le formulaire est DÉPLACÉ sous la ligne qu'on modifie, comme partout dans
  // l'application (comptes, catégories, monnaies) : c'est le mécanisme du noyau.
  ouvrirFormulaireEnLigne("form-suivir-profil", "form-suivir-profil-titre", ancre);
  suivirEtat.profilEnEdition = profil.id;
  document.getElementById("suivir-profil-nom").value = profil.nom;
  document.getElementById("suivir-profil-description").value = profil.description;
  document.getElementById("form-suivir-profil-titre").textContent = `${t("Modifier")} « ${profil.nom} »`;
  document.getElementById("suivir-profil-valider").textContent = t("Enregistrer");
  document.getElementById("suivir-profil-annuler").style.display = "";
}

function suivirResetFormulaire() {
  fermerFormulaireEnLigne("form-suivir-profil");
  suivirEtat.profilEnEdition = null;
  document.getElementById("suivir-profil-nom").value = "";
  document.getElementById("suivir-profil-description").value = "";
  document.getElementById("form-suivir-profil-titre").textContent = t("Ajouter un profil");
  document.getElementById("suivir-profil-valider").textContent = t("Ajouter le profil");
  document.getElementById("suivir-profil-annuler").style.display = "none";
}

async function suivirSupprimerProfil(profil) {
  // SUPPRIMER UN PROFIL NE SUPPRIME AUCUNE OPÉRATION (ondelete SET NULL, cf.
  // migration 0054) : le dire dans la confirmation évite qu'on renonce par
  // crainte d'effacer des dépenses réelles.
  if (
    !confirm(
      `${t("Supprimer le profil")} « ${profil.nom} » ?\n\n` +
        t("Ses opérations ne sont pas supprimées : elles retournent dans « Sans profil ».")
    )
  )
    return;
  try {
    await apiFetch(`/suivi-remboursements/profils/${profil.id}`, { method: "DELETE" });
  } catch (err) {
    showMessage(err.message, "error");
    return;
  }
  if (suivirEtat.profilDeplie === profil.id) suivirEtat.profilDeplie = null;
  suivirResetFormulaire();
  await loadSuiviRemboursements();
}

document.getElementById("form-suivir-profil").addEventListener("submit", async (e) => {
  e.preventDefault();
  const corps = {
    nom: document.getElementById("suivir-profil-nom").value.trim(),
    description: document.getElementById("suivir-profil-description").value.trim(),
  };
  const enEdition = suivirEtat.profilEnEdition;
  try {
    await apiFetch(
      enEdition == null
        ? "/suivi-remboursements/profils"
        : `/suivi-remboursements/profils/${enEdition}`,
      { method: enEdition == null ? "POST" : "PUT", body: JSON.stringify(corps) }
    );
  } catch (err) {
    showMessage(err.message, "error");
    return;
  }
  suivirResetFormulaire();
  await loadSuiviRemboursements();
});

document
  .getElementById("suivir-profil-annuler")
  .addEventListener("click", suivirResetFormulaire);

BudgetApp.extensions.enregistrer(SUIVIR_ID, { chargeur: loadSuiviRemboursements });

/* ---------- La porte d'entrée : la carte « Reste à rembourser » ----------
 *
 * POURQUOI LÀ, ET PAS UN ONGLET DE PLUS. Cet écran répond à une question qu'on
 * se pose DEVANT UN CHIFFRE : « il me reste 340 € à récupérer — de qui ? ». Sa
 * porte est donc ce chiffre lui-même. Une destination dans la barre du haut
 * l'aurait éloigné de la seule chose qui donne envie de l'ouvrir, et il aurait
 * fallu se souvenir qu'il existe.
 *
 * LE CONTENEUR EST DÉCLARÉ PAR LE NOYAU (`#flux-remboursements-actions`, dans
 * index.html), comme `.placements-titre-actions` l'est pour la page Placements :
 * c'est lui qui réserve la place, l'extension n'y met que son bouton. Il est
 * donc TOUJOURS présent quand ce script s'exécute — pas besoin du rattrapage sur
 * `budgetapp:extension-chargee` dont ont besoin les greffes posées sur l'écran
 * d'une AUTRE extension, qui peut arriver après nous.
 *
 * `data-extension` fait le reste : le noyau montre et masque tout élément qui le
 * porte quand l'extension change d'état (cf. majVisibiliteNavigation). Éteindre
 * l'extension depuis les Paramètres retire donc la porte sur-le-champ, sans une
 * ligne de plus ici.
 */
(function poserPorteSuiviRemboursements() {
  const actions = document.getElementById("flux-remboursements-actions");
  if (!actions || document.getElementById("btn-suivir-ouvrir")) return;

  const bouton = document.createElement("button");
  bouton.type = "button";
  bouton.id = "btn-suivir-ouvrir";
  bouton.className = "suivir-porte";
  bouton.dataset.extension = SUIVIR_ID;
  bouton.textContent = t("Voir par personne →");
  bouton.style.display = BudgetApp.extensions.estActive(SUIVIR_ID) ? "" : "none";
  // `ongletActif` : cet écran n'a pas de bouton à lui dans la barre du haut (cf.
  // `bouton: false` dans le manifeste). Sans ce second argument, plus aucun
  // onglet ne serait allumé et l'application aurait l'air d'avoir quitté toutes
  // ses pages. On garde donc « dashboard » allumé — c'est de là qu'on vient, et
  // c'est là qu'on retourne.
  bouton.addEventListener("click", () =>
    switchSection(SUIVIR_ID, { ongletActif: "dashboard" })
  );
  actions.appendChild(bouton);
})();

// La sortie : on revient d'où l'on vient, jamais ailleurs.
document
  .getElementById("btn-suivir-retour")
  .addEventListener("click", () => switchSection("dashboard"));
