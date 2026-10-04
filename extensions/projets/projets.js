/* ---------- Extension « Projets » ----------
 *
 * Regrouper des opérations DÉJÀ SAISIES autour d'un même événement : un voyage,
 * un déménagement, une fête. Ce fichier s'exécute dans la portée globale de la
 * page, après l'injection de page.html : tout ce que app.js expose lui est
 * accessible (apiFetch, state, t, showMessage, formatMontant, escapeHtml,
 * montantHtml, nomCompte, nomCategorie, formatDate…), et les éléments sur
 * lesquels il pose ses écouteurs existent déjà.
 *
 * CE QU'UN PROJET N'EST PAS : une catégorie. Une catégorie classe une dépense
 * par NATURE — une seule — et porte un budget mensuel. Un projet regroupe par
 * ÉVÉNEMENT, à travers les catégories et les comptes, et une même opération peut
 * appartenir à plusieurs projets. C'est cette différence qui justifie une table
 * de liaison plutôt qu'une colonne, et un écran plutôt qu'une case de plus dans
 * le formulaire d'opération.
 *
 * DEUX ÉCRANS EN UN, et jamais les deux ensemble : la liste des projets, ou UN
 * projet ouvert. Un projet ouvert prend toute la place — ses totaux, ses
 * opérations, et le sélecteur qui sert à le remplir — et la liste ne dirait
 * plus rien à côté.
 *
 * TOUS LES IDENTIFIANTS SONT PRÉFIXÉS `projet-` : cet écran vit dans le même
 * document que le reste de l'application.
 */

const PROJETS_BASE = "/projets";

let projets = [];
// Le projet ouvert, ou null quand on est sur la liste.
let projetOuvert = null;
let projetOperations = [];
// Les opérations proposées par le sélecteur, et celles qui y sont cochées.
let projetCandidats = [];
let projetSelection = new Set();

/* ---------- La liste ---------- */

async function loadProjets() {
  try {
    // Comptes et catégories servent à nommer les colonnes des deux tableaux :
    // ils ont pu changer depuis la dernière visite de cet écran.
    await refreshComptes();
    await refreshCategories();
    await refreshMonnaies();
    await refreshTypesOperation();
    projets = await apiFetch(PROJETS_BASE);
    // Rouvrir le projet qu'on regardait : revenir d'un autre onglet ne doit pas
    // le refermer sans qu'on l'ait demandé.
    if (projetOuvert) {
      const encore = projets.find((p) => p.id === projetOuvert.id);
      if (encore) {
        await ouvrirProjet(encore);
        return;
      }
      projetOuvert = null;
    }
    renderProjets();
  } catch (err) {
    showMessage(err.message, "error");
  }
}

function totauxHtml(totaux) {
  if (totaux.length === 0) {
    return `<span class="hint">${t("Aucune opération.")}</span>`;
  }
  // Une ligne PAR MONNAIE : l'app ne stocke aucun taux de change et
  // n'additionne jamais deux monnaies (cf. service_projets.py).
  return totaux
    .map(
      (total) => `
      <div class="projet-total">
        <span class="projet-total-depenses">−${formatMontant(
          total.depenses,
          total.monnaie_id
        )}</span>
        ${
          total.entrees
            ? `<span class="projet-total-entrees">+${formatMontant(
                total.entrees,
                total.monnaie_id
              )}</span>`
            : ""
        }
      </div>`
    )
    .join("");
}

/**
 * L'histogramme du projet ouvert : les mêmes barres que celles du dashboard,
 * sur les seules opérations que le projet regroupe.
 *
 * ON RÉUTILISE `renderHistogrammeDepenses` DU NOYAU, telle quelle. Le serveur
 * rend d'ailleurs les barres dans la forme exacte qu'elle attend (cf.
 * service_projets.depenses_par_categorie) : couleurs par `couleur_index`,
 * infobulle des trois plus grosses dépenses, tout vient avec. Un rendu maison
 * aurait ressemblé à celui du dashboard le premier jour, et plus le second.
 *
 * UN GRAPHE PAR MONNAIE, comme les totaux juste au-dessus — l'app n'additionne
 * jamais deux monnaies. Le nom de la monnaie n'est écrit qu'à partir de deux :
 * au-dessus d'un graphe unique, il répéterait le symbole déjà collé à chaque
 * montant.
 *
 * RIEN DU TOUT quand aucune barre n'a de quoi se dessiner (projet vide, ou qui
 * ne contient que des entrées) : le titre disparaît avec le graphe, plutôt que
 * d'annoncer un cadre vide.
 */
function renderHistogrammeProjet(totaux) {
  const bloc = document.getElementById("projet-histogramme");
  const titre = document.getElementById("projet-histogramme-titre");
  bloc.innerHTML = "";

  const avecDepenses = totaux.filter(
    (total) => (total.depenses_par_categorie || []).length > 0
  );
  titre.style.display = avecDepenses.length > 0 ? "" : "none";
  if (avecDepenses.length === 0) return;

  avecDepenses.forEach((total) => {
    const section = document.createElement("div");
    section.className = "projet-histo-bloc";
    if (avecDepenses.length > 1) {
      const etiquette = document.createElement("div");
      etiquette.className = "projet-histo-monnaie";
      etiquette.textContent = total.monnaie_nom;
      section.appendChild(etiquette);
    }
    // Le cadre porte la classe du noyau : c'est lui qui ancre l'infobulle
    // (position relative) autant qu'il dessine la bordure.
    const cadre = document.createElement("div");
    cadre.className = "histogramme-cadre";
    section.appendChild(cadre);
    bloc.appendChild(section);
    // APRÈS l'insertion dans le document : le rendu lit `clientWidth` pour
    // fixer la largeur du SVG, et un élément détaché la donne à zéro.
    renderHistogrammeDepenses(total.depenses_par_categorie, total.monnaie_id, cadre);
  });
}

/* ---------- La cascade (waterfall) : entrées contre dépenses ----------
 *
 * UNE SECTION PAR MONNAIE (l'app n'en additionne jamais deux). Les barres :
 * « Entrées » monte de zéro au total reçu, chaque catégorie de dépense descend
 * d'autant, et « Solde » dit ce qu'il reste — au-dessous de zéro quand le projet
 * a coûté plus qu'il n'a rapporté. Les catégories vont de la plus lourde à la plus
 * légère : la première marche est celle qui explique le plus.
 *
 * Dessiné en SVG à la main, sans bibliothèque : cinq formes (rectangle, trait,
 * texte) ne justifient pas une dépendance.
 */
function renderWaterfallProjet(totaux) {
  const bloc = document.getElementById("projet-waterfall");
  const titre = document.getElementById("projet-waterfall-titre");
  bloc.innerHTML = "";
  const avecMouvements = totaux.filter((total) => total.entrees > 0 || total.depenses > 0);
  titre.style.display = avecMouvements.length > 0 ? "" : "none";
  avecMouvements.forEach((total) => {
    const section = document.createElement("div");
    section.className = "projet-histo-bloc";
    if (avecMouvements.length > 1) {
      const etiquette = document.createElement("div");
      etiquette.className = "projet-histo-monnaie";
      etiquette.textContent = total.monnaie_nom;
      section.appendChild(etiquette);
    }
    section.insertAdjacentHTML("beforeend", waterfallSvg(total));
    bloc.appendChild(section);
  });
}

function waterfallSvg(total) {
  const categories = [...(total.depenses_par_categorie || [])]
    .filter((c) => c.total_reel > 0)
    .sort((a, b) => b.total_reel - a.total_reel);
  // Chaque marche : de où à où (en valeur), et de quelle sorte.
  const marches = [];
  let niveau = 0;
  if (total.entrees > 0) {
    marches.push({ libelle: t("Entrées"), de: 0, a: total.entrees, genre: "entree" });
    niveau = total.entrees;
  }
  categories.forEach((c) => {
    marches.push({
      libelle: c.categorie,
      de: niveau,
      a: niveau - c.total_reel,
      genre: "depense",
      // LA COULEUR DE LA CATÉGORIE sur le dashboard (cf. couleurCategorie, portée par
      // la catégorie elle-même) : une dépense se reconnaît d'un graphe à l'autre.
      couleur: couleurCategorie(c.couleur_index ?? 0),
    });
    niveau -= c.total_reel;
  });
  marches.push({ libelle: t("Solde"), de: 0, a: niveau, genre: niveau < 0 ? "deficit" : "solde" });

  const largeur = Math.max(420, marches.length * 64 + 70);
  const hauteur = 280;
  const marge = { g: 8, d: 8, h: 22, b: 78 };
  const valeurs = marches.flatMap((m) => [m.de, m.a]).concat(0);
  const haut = Math.max(...valeurs);
  const bas = Math.min(...valeurs);
  const etendue = haut - bas || 1;
  const y = (v) => marge.h + ((haut - v) / etendue) * (hauteur - marge.h - marge.b);
  const pas = (largeur - marge.g - marge.d) / marches.length;
  const epaisseur = Math.min(40, pas * 0.62);

  const barres = marches
    .map((m, i) => {
      const x = marge.g + i * pas + (pas - epaisseur) / 2;
      const y1 = y(Math.max(m.de, m.a));
      const y2 = y(Math.min(m.de, m.a));
      const cx = x + epaisseur / 2;
      const delta = m.genre === "depense" ? -(m.de - m.a) : m.a;
      const texte = `${delta < 0 ? "−" : m.genre === "entree" ? "+" : ""}${formatMontant(
        Math.abs(delta),
        total.monnaie_id
      )}`;
      const etiquette = m.libelle.length > 12 ? `${m.libelle.slice(0, 11)}…` : m.libelle;
      // Le raccord avec la marche suivante : un trait fin au niveau d'arrivée.
      const raccord =
        i < marches.length - 1 && m.genre !== "solde" && m.genre !== "deficit"
          ? `<line class="wf-raccord" x1="${x + epaisseur}" x2="${x + pas}" y1="${y(m.a)}" y2="${y(m.a)}" />`
          : "";
      return `
        <g>
          <title>${escapeHtml(m.libelle)} : ${escapeHtml(texte)}</title>
          <rect class="wf-${m.genre}" x="${x}" y="${y1}" width="${epaisseur}"
                height="${Math.max(1, y2 - y1)}" rx="2"
                ${m.couleur ? `style="fill:${m.couleur}"` : ""} />
          ${raccord}
          <text class="wf-valeur" x="${cx}" y="${y1 - 4}" text-anchor="middle">${escapeHtml(texte)}</text>
          <text class="wf-libelle" transform="translate(${cx} ${hauteur - marge.b + 12}) rotate(40)">${escapeHtml(etiquette)}</text>
        </g>`;
    })
    .join("");

  return `
    <div class="waterfall-cadre">
      <svg class="waterfall" viewBox="0 0 ${largeur} ${hauteur}" width="${largeur}" height="${hauteur}"
           role="img" aria-label="${escapeHtml(t("Entrées et dépenses du projet"))}">
        <line class="wf-zero" x1="${marge.g}" x2="${largeur - marge.d}" y1="${y(0)}" y2="${y(0)}" />
        ${barres}
      </svg>
    </div>`;
}

function renderProjets() {
  document.getElementById("projet-detail").style.display = "none";
  const bloc = document.getElementById("projets-liste");
  bloc.style.display = "";
  bloc.innerHTML = "";

  if (projets.length === 0) {
    bloc.innerHTML = `<p class="hint">${t(
      "Aucun projet. Crée-en un, puis verses-y les opérations d'un même voyage ou d'un même événement."
    )}</p>`;
    return;
  }

  projets.forEach((projet) => {
    const carte = document.createElement("div");
    carte.className = "projet-carte";
    carte.innerHTML = `
      <div class="projet-carte-corps">
        <div class="projet-carte-nom">${escapeHtml(projet.nom)}</div>
        ${
          projet.description
            ? `<div class="projet-carte-description">${escapeHtml(projet.description)}</div>`
            : ""
        }
        <div class="projet-carte-compte">${t("{n} opération(s)", {
          n: projet.nombre_operations,
        })}</div>
        <div class="projet-totaux">${totauxHtml(projet.totaux)}</div>
      </div>
      <div class="projet-carte-actions">
        <button type="button" class="primary" data-action="ouvrir">${t("Ouvrir")}</button>
        <button type="button" data-action="modifier">${t("Renommer")}</button>
        <button type="button" class="danger" data-action="supprimer">${t("Supprimer")}</button>
      </div>
    `;

    carte
      .querySelector("[data-action='ouvrir']")
      .addEventListener("click", () => ouvrirProjet(projet));
    carte
      .querySelector("[data-action='modifier']")
      .addEventListener("click", () => ouvrirEditeurProjet(projet));
    carte.querySelector("[data-action='supprimer']").addEventListener("click", async () => {
      // Le message dit ce que la suppression NE fait PAS : c'est la seule chose
      // qu'on a besoin de savoir avant de cliquer.
      if (
        !confirm(
          `Supprimer le projet « ${projet.nom} » ? Les opérations qu'il regroupe restent en base.`
        )
      ) {
        return;
      }
      try {
        await apiFetch(`${PROJETS_BASE}/${projet.id}`, { method: "DELETE" });
        showMessage(t("Projet supprimé. Aucune opération n'a été supprimée."), "success");
        projetOuvert = null;
        await loadProjets();
      } catch (err) {
        showMessage(err.message, "error");
      }
    });

    bloc.appendChild(carte);
  });
}

/* ---------- L'éditeur (créer / renommer) ---------- */

function ouvrirEditeurProjet(projet = null) {
  document.getElementById("projet-editeur").style.display = "";
  document.getElementById("projet-editeur-titre").textContent = projet
    ? t("Modifier le projet")
    : t("Nouveau projet");
  document.getElementById("projet-id").value = projet ? projet.id : "";
  document.getElementById("projet-nom").value = projet ? projet.nom : "";
  document.getElementById("projet-description").value = projet ? projet.description : "";
  document.getElementById("projet-nom").focus();
}

function fermerEditeurProjet() {
  document.getElementById("projet-editeur").style.display = "none";
}

/* ---------- Un projet ouvert ---------- */

async function ouvrirProjet(projet) {
  try {
    // Relu depuis le serveur : les totaux d'une carte de liste datent du
    // chargement de la liste, et l'écran de détail est celui où ils comptent.
    projetOuvert = await apiFetch(`${PROJETS_BASE}/${projet.id}`);
    projetOperations = await apiFetch(`${PROJETS_BASE}/${projet.id}/operations`);
  } catch (err) {
    showMessage(err.message, "error");
    return;
  }

  fermerEditeurProjet();
  fermerSelecteurProjet();
  document.getElementById("projets-liste").style.display = "none";
  document.getElementById("projet-detail").style.display = "";
  document.getElementById("projet-detail-nom").textContent = projetOuvert.nom;
  const description = document.getElementById("projet-detail-description");
  description.textContent = projetOuvert.description;
  description.style.display = projetOuvert.description ? "" : "none";
  document.getElementById("projet-detail-totaux").innerHTML = totauxHtml(projetOuvert.totaux);
  renderWaterfallProjet(projetOuvert.totaux);
  renderHistogrammeProjet(projetOuvert.totaux);
  document.getElementById("projet-detail-nombre").textContent = t("{n} opération(s)", {
    n: projetOperations.length,
  });

  renderProjetOperations();
}

function fermerProjet() {
  projetOuvert = null;
  projetOperations = [];
  fermerSelecteurProjet();
  renderProjets();
}

/** Les colonnes communes aux deux tableaux : le projet ouvert et le sélecteur. */
// MÊME ORDRE QUE LA PAGE OPÉRATIONS : nature, montant, compte, date, catégorie.
// Deux écrans qui rangent les mêmes champs autrement obligent à réapprendre l'un
// après l'autre.
function cellulesOperationHtml(operation) {
  return `
    <td>${escapeHtml(operation.nature)}</td>
    <td>${montantHtml(operation.montant, operation.sens, operation.monnaie_id)}</td>
    <td>${escapeHtml(nomCompte(operation.compte_id))}</td>
    <td>${formatDate(operation.date)}</td>
    <td>${escapeHtml(nomCategorie(operation.categorie_id))}</td>
  `;
}

function renderProjetOperations() {
  const corps = document.getElementById("projet-operations-liste");
  corps.innerHTML = "";
  if (projetOperations.length === 0) {
    corps.innerHTML = `<tr><td colspan="6" class="hint">${t(
      "Aucune opération dans ce projet."
    )}</td></tr>`;
    return;
  }

  projetOperations.forEach((operation) => {
    const ligne = document.createElement("tr");
    ligne.innerHTML = `
      ${cellulesOperationHtml(operation)}
      <td>
        <button type="button" data-action="retirer">${t("Retirer")}</button>
      </td>
    `;
    // RETIRER, PAS SUPPRIMER, et sans confirmation : l'opération reste en base
    // avec son compte, sa catégorie et son montant — c'est le lien qui part, et
    // le remettre est un clic.
    ligne.querySelector("[data-action='retirer']").addEventListener("click", async () => {
      try {
        await apiFetch(`${PROJETS_BASE}/${projetOuvert.id}/operations`, {
          method: "DELETE",
          body: JSON.stringify({ operation_ids: [operation.id] }),
        });
        showMessage(t("Opération retirée du projet (elle reste en base)."), "success");
        await ouvrirProjet(projetOuvert);
      } catch (err) {
        showMessage(err.message, "error");
      }
    });
    corps.appendChild(ligne);
  });
}

/* ---------- Le sélecteur d'opérations ---------- */

function ouvrirSelecteurProjet() {
  document.getElementById("projet-selecteur").style.display = "";
  // Les comptes du filtre : reconstruits à l'ouverture, la liste ayant pu
  // changer depuis la dernière fois.
  const select = document.getElementById("projet-filtre-compte");
  const premier = select.firstElementChild;
  fillComptesSelect(select, state.comptes, { keepFirst: Boolean(premier) });
  remplirFiltreTypeProjet();
  // Toutes les catégories, éteintes comprises : une opération déjà écrite peut en
  // porter une, et le sélecteur sert justement à retrouver des opérations.
  const categorie = document.getElementById("projet-filtre-categorie");
  const choisie = categorie.value;
  fillCategoriesSelect(categorie, state.categories, { keepFirst: true });
  categorie.value = choisie;
  chercherCandidatsProjet();
}

function fermerSelecteurProjet() {
  document.getElementById("projet-selecteur").style.display = "none";
  projetCandidats = [];
  projetSelection = new Set();
  majSelectionProjet();
}

// Le menu « Type » du sélecteur : les types d'opération de l'application, sauf les
// internes (achats/ventes de titres) qui ne se versent pas dans un projet comme une
// dépense. Rempli une fois, le choix en cours est conservé.
function remplirFiltreTypeProjet() {
  const select = document.getElementById("projet-filtre-type");
  const precedent = select.value;
  select.innerHTML =
    `<option value="">${t("— tous —")}</option>` +
    (state.typesOperation || [])
      .filter((type) => !type.interne)
      .map((type) => `<option value="${type.id}">${escapeHtml(type.nom)}</option>`)
      .join("");
  select.value = precedent;
  select.classList.toggle("filtre-rempli", select.value !== "");
}

async function chercherCandidatsProjet() {
  if (!projetOuvert) return;
  const parametres = new URLSearchParams();
  const debut = document.getElementById("projet-filtre-debut").value;
  const fin = document.getElementById("projet-filtre-fin").value;
  const compte = document.getElementById("projet-filtre-compte").value;
  if (debut) parametres.set("date_debut", debut);
  if (fin) parametres.set("date_fin", fin);
  if (compte) parametres.set("compte_id", compte);
  // PAR CATÉGORIE : la route sait filtrer, contrairement au type.
  const categorie = document.getElementById("projet-filtre-categorie").value;
  if (categorie) parametres.set("categorie_id", categorie);

  try {
    const operations = await apiFetch(`/operations?${parametres.toString()}`);
    // Le filtre sur le libellé se fait ICI et non côté serveur : la route
    // /operations ne le propose pas, et l'ajouter au noyau pour le seul usage
    // de cette extension aurait élargi son API sans nécessité.
    const texte = document
      .getElementById("projet-filtre-texte")
      .value.trim()
      .toLowerCase();
    const deja = new Set(projetOperations.map((o) => o.id));
    projetCandidats = operations.filter(
      (operation) =>
        // Déjà dans le projet : la proposer inviterait à un geste sans effet
        // (le serveur ignore les doublons, mais l'écran ne doit pas les
        // suggérer).
        // PAR TYPE : la route ne filtre pas sur le type, c'est donc fait ici — avec
        // « Tout sélectionner », c'est le geste pour verser d'un coup toutes les
        // dépenses remboursables, ou tous les virements, d'une période.
        (!document.getElementById("projet-filtre-type").value ||
          String(operation.type_id) === document.getElementById("projet-filtre-type").value) &&
        !deja.has(operation.id) &&
        (!texte || operation.nature.toLowerCase().includes(texte))
    );
  } catch (err) {
    showMessage(err.message, "error");
    return;
  }

  projetSelection = new Set();
  renderCandidatsProjet();
}

function renderCandidatsProjet() {
  const corps = document.getElementById("projet-candidats-liste");
  corps.innerHTML = "";
  document.getElementById("projet-candidats-info").textContent = t(
    "{n} opération(s) proposée(s). Celles déjà dans ce projet ne sont pas listées.",
    { n: projetCandidats.length }
  );

  projetCandidats.forEach((operation) => {
    const ligne = document.createElement("tr");
    ligne.innerHTML = `
      ${cellulesOperationHtml(operation)}
      <td>
        <input type="checkbox" data-role="selection" ${
          projetSelection.has(operation.id) ? "checked" : ""
        } />
      </td>
    `;
    ligne.querySelector("[data-role='selection']").addEventListener("change", (e) => {
      if (e.target.checked) projetSelection.add(operation.id);
      else projetSelection.delete(operation.id);
      majSelectionProjet();
    });
    corps.appendChild(ligne);
  });

  majSelectionProjet();
}

function majSelectionProjet() {
  const nombre = projetSelection.size;
  document.getElementById("projet-selection-nombre").textContent = nombre;
  document.getElementById("btn-projet-verser").disabled = nombre === 0;
}

/* ---------- Écouteurs ---------- */

document
  .getElementById("btn-projet-nouveau")
  .addEventListener("click", () => ouvrirEditeurProjet());
document.getElementById("btn-projet-annuler").addEventListener("click", fermerEditeurProjet);

document.getElementById("btn-projet-enregistrer").addEventListener("click", async () => {
  const nom = document.getElementById("projet-nom").value.trim();
  if (!nom) {
    showMessage(t("Donne un nom au projet."), "error");
    return;
  }
  const payload = {
    nom,
    description: document.getElementById("projet-description").value.trim(),
  };
  const id = document.getElementById("projet-id").value;
  try {
    if (id) {
      await apiFetch(`${PROJETS_BASE}/${id}`, {
        method: "PUT",
        body: JSON.stringify(payload),
      });
      showMessage(t("Projet modifié"), "success");
    } else {
      await apiFetch(PROJETS_BASE, { method: "POST", body: JSON.stringify(payload) });
      showMessage(t("Projet créé"), "success");
    }
    fermerEditeurProjet();
    await loadProjets();
  } catch (err) {
    showMessage(err.message, "error");
  }
});

document.getElementById("btn-projet-fermer").addEventListener("click", fermerProjet);
document
  .getElementById("btn-projet-ajouter-operations")
  .addEventListener("click", ouvrirSelecteurProjet);
document
  .getElementById("btn-projet-selecteur-fermer")
  .addEventListener("click", fermerSelecteurProjet);
document.getElementById("btn-projet-filtrer").addEventListener("click", chercherCandidatsProjet);

document.getElementById("btn-projet-tout-selectionner").addEventListener("click", () => {
  // Bascule : re-cliquer désélectionne tout, plutôt que de forcer à décocher
  // ligne à ligne ce qu'un clic vient de cocher.
  const toutCoche = projetSelection.size === projetCandidats.length && projetCandidats.length > 0;
  projetSelection = toutCoche ? new Set() : new Set(projetCandidats.map((o) => o.id));
  renderCandidatsProjet();
});

document.getElementById("btn-projet-verser").addEventListener("click", async () => {
  if (!projetOuvert || projetSelection.size === 0) return;
  try {
    const resultat = await apiFetch(`${PROJETS_BASE}/${projetOuvert.id}/operations`, {
      method: "POST",
      body: JSON.stringify({ operation_ids: [...projetSelection] }),
    });
    showMessage(
      t("{n} opération(s) ajoutée(s) au projet.", { n: resultat.ajoutees }),
      "success"
    );
    const ouvert = projetOuvert;
    fermerSelecteurProjet();
    await ouvrirProjet(ouvert);
  } catch (err) {
    showMessage(err.message, "error");
  }
});

// Entrée dans le champ de recherche : le geste attendu, plutôt que d'aller
// chercher le bouton d'à côté.
document.getElementById("projet-filtre-texte").addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    chercherCandidatsProjet();
  }
});

// L'enregistrement auprès du noyau, en FIN de fichier : `loadProjets` doit
// exister au moment où on la référence. Le chargeur est rappelé à chaque
// ouverture de l'onglet — les opérations ont pu changer depuis.
BudgetApp.extensions.enregistrer("projets", { chargeur: loadProjets });
