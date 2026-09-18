/**
 * Extension « Suivi des remboursements » — qui te doit combien, et à qui tu dois.
 *
 * ELLE EMPORTE AUSSI LES DEUX TYPES REMBOURSABLES DU NOYAU (« Dépense
 * remboursable », « Remboursement reçu »), même patron que « Prêts » pour
 * `pret`/`remboursement_pret` (cf. extensions/prets/prets.js) : le SCHÉMA
 * reste au noyau (une extension n'emporte jamais ses tables), mais ces deux
 * types ne sont accessibles, et ne pèsent sur les totaux (flux du mois,
 * histogramme, « Reste à rembourser »), que si cette extension tourne — cf.
 * `EXTENSION_SUIVI_REMBOURSEMENTS` et `_remboursable_compte` côté backend
 * (`services/soldes.py`). Les éléments qui lui appartiennent sont écrits dans
 * `index.html` avec `display:none` et `data-extension`/`data-extension-onglet`,
 * révélés ci-dessous par `majVisibilite`.
 *
 * TOUT EST PRÉFIXÉ `suivir`. Les scripts d'extension s'exécutent en portée
 * GLOBALE, dans l'ordre alphabétique des dossiers : une fonction `renderTableau`
 * déclarée ici serait écrasée par celle du même nom d'une extension qui vient
 * après, et l'écran afficherait les données de l'autre — sans la moindre erreur
 * en console (cf. extensions/README.md, « deux pièges de la portée globale »).
 */

const SUIVIR_ID = "suivi-remboursements";

// Révèle les deux onglets d'Opérations, leurs volets et les deux boutons de
// type du formulaire — cf. le commentaire de tête. `majVisibilite` fait
// exactement ce que le noyau appelle déjà à l'extinction depuis Paramètres ;
// ce fichier n'étant chargé QUE si l'extension est allumée, l'appeler ici
// suffit à couvrir le démarrage (cf. prets.js, même geste pour « Prêts »).
BudgetApp.extensions.majVisibilite(SUIVIR_ID, true);

// Ce que l'écran tient entre deux requêtes. `monnaieId` est l'onglet actif, et
// il survit à un rechargement de la vue : ranger une ligne ne doit pas renvoyer
// l'utilisateur sur la première devise.
const suivirEtat = {
  vue: null,
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

  const totaux = vue.totaux || [];
  document.getElementById("suivir-vide").style.display = totaux.length ? "none" : "";
  document.getElementById("suivir-contenu").style.display = totaux.length ? "" : "none";

  renderSuivirTotaux(totaux);
  renderSuivirTableau(vue.soldes || []);
  renderSuivirARattacher();
  renderSuivirProfils();
}

/* ---------- Les trois cartes du haut ---------- */

/**
 * TOUTES LES MONNAIES DANS LA MÊME CARTE, une ligne chacune.
 *
 * Il y avait un onglet par devise au-dessus : deux clics pour lire trois
 * chiffres dont on veut justement la vue d'ensemble, et une moitié de la réponse
 * cachée derrière l'onglet qu'on ne regarde pas. Empiler ne revient PAS à
 * additionner — chaque ligne garde son symbole, et rien ne somme jamais deux
 * devises (l'application ne connaît aucun taux de change).
 */
function renderSuivirTotaux(totaux) {
  suivirEcrireMontants(
    document.getElementById("suivir-total-recevoir"),
    totaux,
    (entree) => entree.a_recevoir
  );
  suivirEcrireMontants(
    document.getElementById("suivir-total-rendre"),
    totaux,
    (entree) => entree.a_rendre
  );
  suivirEcrireNets(document.getElementById("suivir-total-net"), totaux);
}

/**
 * Une ligne par monnaie où `valeur` n'est pas nulle.
 *
 * LES MONNAIES À ZÉRO SONT TUES : un compte en dollars qui n'a jamais rien
 * avancé n'a rien à dire dans « On te doit », et une ligne « 0,00 $ » y ferait
 * chercher ce qui a bien pu s'y passer. Si tout est nul, une seule ligne à zéro
 * dans la PREMIÈRE monnaie — mieux qu'une carte vide, qui ressemble à une panne.
 */
function suivirEcrireMontants(element, totaux, valeur) {
  const lignes = totaux.filter((entree) => !montantEstNul(valeur(entree)));
  element.innerHTML = "";
  if (!lignes.length) {
    element.textContent = totaux.length ? formatMontant(0, totaux[0].monnaie_id) : "-";
    return;
  }
  lignes.forEach((entree) => {
    const ligne = document.createElement("div");
    ligne.className = "suivir-montant-monnaie";
    ligne.textContent = formatMontant(valeur(entree), entree.monnaie_id);
    element.appendChild(ligne);
  });
}

// Le net, une ligne par monnaie, chacune avec SA couleur : on peut très bien
// être créancier en euros et débiteur en dollars, et une couleur unique pour la
// carte entière aurait dû mentir sur l'une des deux.
function suivirEcrireNets(element, totaux) {
  element.innerHTML = "";
  element.classList.remove("positif", "negatif", "montant-nul");
  if (!totaux.length) {
    element.textContent = "-";
    return;
  }
  totaux.forEach((entree) => {
    const ligne = document.createElement("div");
    ligne.className = "suivir-montant-monnaie";
    suivirEcrireNet(ligne, entree.net, entree.monnaie_id);
    element.appendChild(ligne);
  });
}

/* ---------- Le tableau : une ligne par profil, une barre par monnaie ---------- */

function renderSuivirTableau(soldes) {
  const tableau = document.getElementById("suivir-tableau");
  tableau.innerHTML = "";

  // L'ÉCHELLE DES BARRES EST COMMUNE AU TABLEAU, MAIS PAR MONNAIE. Commune,
  // parce qu'une barre calibrée sur sa propre ligne serait toujours pleine et
  // que 12 € se lirait comme 1 200 €. Par monnaie, parce que comparer 100 € à
  // 100 000 ¥ sur le même axe ne veut rien dire — l'application ne connaît aucun
  // taux, et une barre qui prétendrait le contraire serait le seul endroit à le
  // faire. Le maximum est pris sur les DEUX côtés, pour qu'une créance et une
  // dette de même taille aient la même longueur.
  const echelles = {};
  soldes.forEach((profil) =>
    (profil.monnaies || []).forEach((entree) => {
      echelles[entree.monnaie_id] = Math.max(
        echelles[entree.monnaie_id] || 1,
        entree.a_recevoir,
        entree.a_rendre
      );
    })
  );

  soldes.forEach((profil) => {
    tableau.appendChild(suivirLigneProfil(profil, echelles));
    if (profil.profil_id != null && profil.profil_id === suivirEtat.profilDeplie) {
      tableau.appendChild(suivirDetailProfil());
    }
  });
}

/**
 * Une ligne : le nom à gauche, et à droite une rangée par monnaie — barre
 * divergente, détail chiffré, net.
 *
 * LA BARRE VA À DROITE QUAND ON NOUS DOIT, À GAUCHE QUAND ON DOIT — un axe
 * central, deux couleurs. C'est la seule forme qui répond d'un coup d'œil à la
 * question de l'écran : un profil qui me doit et un profil à qui je dois ne se
 * distinguent pas par la longueur mais par le CÔTÉ, et le tableau se lit sans
 * lire les chiffres. Un profil qui porte les deux dans la MÊME monnaie (il me
 * doit 80, je lui dois 30) montre ses deux segments : le net seul aurait effacé
 * la moitié de ce qui s'est passé entre nous.
 *
 * UNE BARRE PAR MONNAIE, et non une barre pour le tout : additionner des euros
 * et des dollars pour dessiner un seul trait aurait inventé un taux de change.
 * Les monnaies où le profil ne porte rien n'ont pas de rangée — le serveur ne
 * les envoie pas.
 */
function suivirLigneProfil(profil, echelles) {
  const ligne = document.createElement("div");
  ligne.className = "suivir-ligne";
  const sansProfil = profil.profil_id == null;
  ligne.classList.toggle("suivir-ligne-sans-profil", sansProfil);
  if (!sansProfil) ligne.dataset.profilId = profil.profil_id;

  const nom = document.createElement("span");
  nom.className = "suivir-ligne-nom";
  nom.textContent = profil.profil_nom;
  ligne.appendChild(nom);

  const rangees = document.createElement("div");
  rangees.className = "suivir-ligne-monnaies";
  (profil.monnaies || []).forEach((entree) => {
    rangees.appendChild(suivirRangeeMonnaie(entree, echelles[entree.monnaie_id] || 1));
  });
  ligne.appendChild(rangees);

  // « Sans profil » n'a pas de détail à déplier : ses lignes sont exactement
  // celles de la liste « À rattacher », juste en dessous.
  if (!sansProfil) {
    ligne.classList.add("suivir-ligne-cliquable");
    ligne.addEventListener("click", () => suivirBasculerProfil(profil.profil_id));
  }
  return ligne;
}

function suivirRangeeMonnaie(entree, echelle) {
  const rangee = document.createElement("div");
  rangee.className = "suivir-ligne-monnaie";
  const partRecevoir = (entree.a_recevoir / echelle) * 100;
  const partRendre = (entree.a_rendre / echelle) * 100;
  rangee.innerHTML = `
    <span class="suivir-barre" role="presentation">
      <span class="suivir-barre-cote suivir-barre-gauche">
        <span class="suivir-barre-remplissage suivir-du" style="width:${partRendre.toFixed(2)}%"></span>
      </span>
      <span class="suivir-barre-axe"></span>
      <span class="suivir-barre-cote suivir-barre-droite">
        <span class="suivir-barre-remplissage suivir-creance" style="width:${partRecevoir.toFixed(2)}%"></span>
      </span>
    </span>
    <span class="suivir-ligne-detail hint">${suivirDetailChiffre(entree)}</span>
    <span class="suivir-ligne-net"></span>
  `;
  suivirEcrireNet(rangee.querySelector(".suivir-ligne-net"), entree.net, entree.monnaie_id);
  return rangee;
}

/**
 * « on te doit 80,00 € · tu dois 30,00 € » — les deux composantes du net.
 *
 * Écrites seulement quand il y en a DEUX : quand un profil n'a que des créances
 * dans cette monnaie (le cas ordinaire), répéter le net à côté n'apprendrait
 * rien, et le nombre de lignes est plus utile.
 */
function suivirDetailChiffre(entree) {
  if (montantEstNul(entree.a_recevoir) || montantEstNul(entree.a_rendre)) {
    return `${entree.nb_lignes} ${entree.nb_lignes > 1 ? t("lignes") : t("ligne")}`;
  }
  return `${t("on te doit")} ${formatMontant(entree.a_recevoir, entree.monnaie_id)} · ${t(
    "tu dois"
  )} ${formatMontant(entree.a_rendre, entree.monnaie_id)}`;
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
function suivirDetailProfil() {
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

  // `import-mapping-row` EST LE COMPOSANT DU NOYAU pour « une rangée de contrôles
  // sous une liste », et c'est lui qui habille le menu déroulant. Le `<select>`
  // était nu jusqu'ici : les règles de thème du noyau sont écrites `form select`,
  // elles ne portent donc que DANS un formulaire, et celui-ci n'en est pas un —
  // il ressortait aux couleurs du navigateur, seul de son espèce dans toute
  // l'application. Le poser dans une `<form>` l'aurait habillé aussi, mais en
  // ajoutant sous le tableau une carte encadrée pour deux contrôles.
  const actions = document.createElement("div");
  actions.className = "import-mapping-row suivir-affectation";
  actions.innerHTML = `
    <span class="import-mapping-nom">${t("Rattacher au profil")}</span>
    <select id="suivir-profil-cible">
      ${profils.map((p) => `<option value="${p.id}">${escapeHtml(p.nom)}</option>`).join("")}
    </select>
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
 * index.html), comme `.placements-titre-actions` l'est pour l'onglet Placements :
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
  // LE LIBELLÉ EST CELUI DE L'ÉCRAN, et pas une paraphrase de ce qu'on y fera :
  // « Voir par personne » décrivait l'écran sans le nommer, et rien ne reliait le
  // bouton au nom sous lequel l'extension s'allume dans les Paramètres.
  bouton.textContent = t("Suivi des remboursements");
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
