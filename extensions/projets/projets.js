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
/* LES MONNAIES ÉTEINTES, « EN POP-UP » (Paramètres généraux, cf. modeMonnaiesEteintes) :
 * seules les monnaies allumées ont leurs graphiques sur la page, et ce qui a été converti
 * vers une monnaie éteinte y devient une colonne grise qui ouvre sa cascade dans une
 * fenêtre. « Sur la page » : un graphique par monnaie, comme toujours. */
function projetEnPopup() {
  return modeMonnaiesEteintes() === "popup";
}

/** Le geste qui ouvre la cascade d'une monnaie ÉTEINTE de ce projet, ou null — une
 *  monnaie allumée a déjà ses graphiques sur la page. */
function projetOuvrirMonnaie(monnaieId) {
  if (!projetEnPopup() || !monnaieEstEteinte(monnaieId)) return null;
  const cascade = (projetOuvert.cascades || []).find((c) => c.monnaie_id === monnaieId);
  if (!cascade) return null;
  return () =>
    ouvrirFenetreMonnaieEteinte(monnaieId, {
      cascade,
      sousTitre: projetOuvert.nom,
      operationIds: projetOperations.map((o) => o.id),
    });
}

/** La fenêtre des frais de virements internes, sur les seuls virements du projet. */
function projetOuvrirFrais(monnaieId) {
  ouvrirFenetreFrais({
    operationIds: projetOperations.map((o) => o.id),
    sousTitre: projetOuvert.nom,
    monnaieId,
  });
}

/** Les monnaies dont les graphiques se dessinent sur la page. */
function projetMonnaieSurPage(monnaieId) {
  return !(projetEnPopup() && monnaieEstEteinte(monnaieId));
}

function projetBlocMonnaie(conteneur, nom, plusieurs) {
  const section = document.createElement("div");
  section.className = "projet-histo-bloc";
  if (plusieurs) {
    const etiquette = document.createElement("div");
    etiquette.className = "projet-histo-monnaie";
    etiquette.textContent = nom;
    section.appendChild(etiquette);
  }
  conteneur.appendChild(section);
  return section;
}

function renderHistogrammeProjet(totaux) {
  const bloc = document.getElementById("projet-histogramme");
  const titre = document.getElementById("projet-histogramme-titre");
  bloc.innerHTML = "";

  // LES BARRES DE CHAQUE MONNAIE, plus ses COLONNES GRISES tirées de la cascade : les
  // frais de virements internes, et une conversion par monnaie vers laquelle (ou depuis
  // laquelle) de l'argent a été converti — dans les deux modes. Seule la conversion vers
  // une monnaie ÉTEINTE, « en pop-up », ouvre une fenêtre : une monnaie allumée a ses
  // propres graphiques sur la page. Le serveur a déjà retiré changes et frais de « Sans
  // catégorie » (cf. service_projets.depenses_par_categorie).
  const graphes = totaux
    .filter((total) => projetMonnaieSurPage(total.monnaie_id))
    .map((total) => {
      const cascade = (projetOuvert.cascades || []).find((c) => c.monnaie_id === total.monnaie_id);
      const colonnes = cascade?.colonnes || [];
      const frais = colonnes
        .filter((c) => c.genre === "frais")
        .map((c) => barreFrais(c, { ouvrir: () => projetOuvrirFrais(total.monnaie_id) }));
      const conversions = colonnes
        .filter((c) => c.genre === "conversion")
        .map((c) =>
          barreConversion(total.monnaie_id, c, { ouvrir: projetOuvrirMonnaie(c.monnaie_autre_id) })
        );
      return {
        total,
        depenses: [...(total.depenses_par_categorie || []), ...frais, ...conversions],
      };
    })
    .filter((graphe) => graphe.depenses.length > 0);
  titre.style.display = graphes.length > 0 ? "" : "none";

  graphes.forEach(({ total, depenses }) => {
    const section = projetBlocMonnaie(bloc, total.monnaie_nom, graphes.length > 1);
    // Le cadre porte la classe du noyau : c'est lui qui ancre l'infobulle
    // (position relative) autant qu'il dessine la bordure.
    const cadre = document.createElement("div");
    cadre.className = "histogramme-cadre";
    section.appendChild(cadre);
    // LA LÉGENDE DU DASHBOARD, sous le graphe : les mêmes couleurs, les mêmes noms,
    // et la part de chaque catégorie dans ce que le projet a dépensé.
    const legende = document.createElement("div");
    legende.className = "projet-legende";
    section.appendChild(legende);
    // APRÈS l'insertion dans le document : le rendu lit `clientWidth` pour
    // fixer la largeur du SVG, et un élément détaché la donne à zéro.
    renderHistogrammeDepenses(depenses, total.monnaie_id, cadre);
    const parts = partsCategoriesDashboard(depenses, new Set(depenses.map((d) => d.categorie)));
    renderLegendeCategories(total.monnaie_id, parts, legende);
  });
}

/* ---------- La cascade (waterfall) ----------
 *
 * UNE CASCADE PAR MONNAIE (l'app n'en additionne jamais deux), calculée par le serveur
 * (services/cascade.py) et dessinée par le noyau (renderCascade) : les catégories,
 * entrées comprises, puis l'épargne, les frais de virements internes et les conversions
 * vers les autres monnaies, et enfin le solde.
 */
function renderWaterfallProjet() {
  const bloc = document.getElementById("projet-waterfall");
  const titre = document.getElementById("projet-waterfall-titre");
  bloc.innerHTML = "";
  const cascades = (projetOuvert.cascades || []).filter(
    (c) => c.colonnes.length > 0 && projetMonnaieSurPage(c.monnaie_id)
  );
  titre.style.display = cascades.length > 0 ? "" : "none";
  cascades.forEach((cascade) => {
    const section = projetBlocMonnaie(bloc, cascade.monnaie_nom, cascades.length > 1);
    const conteneur = document.createElement("div");
    section.appendChild(conteneur);
    renderCascade(cascade, conteneur, {
      ouvrirConversion: projetOuvrirMonnaie,
      ouvrirFrais: () => projetOuvrirFrais(cascade.monnaie_id),
    });
  });
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
  renderWaterfallProjet();
  renderHistogrammeProjet(projetOuvert.totaux);
  // La surbrillance croisée barre ↔ ligne de légende, comme au dashboard.
  cablerSurbrillanceCategories();
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
// UNE OPÉRATION DÉCOUPÉE s'affiche comme sur la page Opérations : « Découpée · N parts »,
// qui déplie ses parts sous la ligne (celluleCategorieOperation / ligneDetailDecoupe du
// noyau) — et non un « - » qui laisserait croire qu'elle n'a pas de catégorie.
//
// LES IDENTIFIANTS SONT PRÉFIXÉS (`prefixe`) : la page Opérations vit dans le même document
// et pose déjà des lignes `decoupe-<id>` — sans préfixe, le bouton d'ici déplierait la
// sienne.
function cellulesOperationHtml(operation, prefixe) {
  const categorie =
    operation.decoupes && operation.decoupes.length > 0
      ? celluleCategorieOperation(operation).replaceAll(
          `"decoupe-${operation.id}"`,
          `"${prefixe}-decoupe-${operation.id}"`
        )
      : escapeHtml(nomCategorie(operation.categorie_id));
  return `
    <td>${escapeHtml(operation.nature)}</td>
    <td>${montantHtml(operation.montant, operation.sens, operation.monnaie_id)}</td>
    <td>${escapeHtml(nomCompte(operation.compte_id))}</td>
    <td>${formatDate(operation.date)}</td>
    <td>${categorie}</td>
  `;
}

// Les deux tableaux de l'écran ont six colonnes : la ligne de détail les couvre toutes.
const PROJET_NB_COLONNES = 6;

/** La ligne repliée des parts d'une opération découpée, à poser sous sa ligne. */
function projetLigneDecoupe(corps, operation, prefixe) {
  if (operation.decoupes && operation.decoupes.length > 0) {
    const detail = ligneDetailDecoupe(operation, PROJET_NB_COLONNES);
    detail.id = `${prefixe}-decoupe-${operation.id}`;
    corps.appendChild(detail);
  }
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
      ${cellulesOperationHtml(operation, "projet-op")}
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
    projetLigneDecoupe(corps, operation, "projet-op");
  });
}

/* ---------- Le sélecteur d'opérations ---------- */

/* LES TROIS FILTRES À COCHER : comptes, types, catégories. `null` = tout coché, c'est-à-dire
 * aucun filtre — la forme canonique du filtre du dashboard, qui garde « tout » vrai quand
 * une catégorie est créée entre deux ouvertures. Un Set d'identifiants sinon. */
const projetFiltres = { comptes: null, types: null, categories: null };

function projetPoserFiltre(cle, conteneurId, libelle, options) {
  // Les intertitres (`{ titre }`) rangent, ils ne se cochent pas.
  const cochables = options.filter((o) => !o.titre);
  const coches = projetFiltres[cle] ? [...projetFiltres[cle]] : cochables.map((o) => o.cle);
  creerMenuCases(document.getElementById(conteneurId), {
    libelle,
    options,
    coches,
    toutSelectionner: true,
    onChange: (choisies) => {
      projetFiltres[cle] = choisies.size === cochables.length ? null : choisies;
      chercherCandidatsProjet();
    },
  });
}

/* LES COMPTES PAR TYPE, dans l'ordre où on les lit : courants, puis placements, puis
 * épargne — un intertitre par type présent (les types créés par l'utilisateur suivent). */
const PROJET_ORDRE_TYPES_COMPTE = ["courant", "placements financiers", "épargne"];
const PROJET_LIBELLES_TYPES_COMPTE = {
  courant: "Comptes courants",
  "placements financiers": "Comptes de placements",
  épargne: "Comptes d'épargne",
};

function projetOptionsComptes() {
  const types = [...new Set(state.comptes.map((c) => c.type_nom))].sort((a, b) => {
    const ra = PROJET_ORDRE_TYPES_COMPTE.indexOf(a);
    const rb = PROJET_ORDRE_TYPES_COMPTE.indexOf(b);
    return (ra < 0 ? 99 : ra) - (rb < 0 ? 99 : rb) || a.localeCompare(b);
  });
  return types.flatMap((type) => [
    { titre: t(PROJET_LIBELLES_TYPES_COMPTE[type] || type) },
    ...state.comptes
      .filter((c) => c.type_nom === type)
      .map((c) => ({ cle: c.id, libelle: c.nom })),
  ]);
}

function ouvrirSelecteurProjet() {
  document.getElementById("projet-selecteur").style.display = "";
  // Les trois listes sont reconstruites à l'ouverture : comptes, types et catégories
  // ont pu changer depuis la dernière fois.
  projetPoserFiltre(
    "comptes",
    "projet-filtre-comptes",
    t("Comptes"),
    projetOptionsComptes()
  );
  // Les types d'opération de l'application, sauf les internes (achats/ventes de titres)
  // qui ne se versent pas dans un projet comme une dépense.
  projetPoserFiltre(
    "types",
    "projet-filtre-types",
    t("Types"),
    (state.typesOperation || [])
      .filter((type) => !type.interne)
      .map((type) => ({ cle: type.id, libelle: type.nom }))
  );
  // Toutes les catégories, éteintes comprises : une opération déjà écrite peut en
  // porter une, et le sélecteur sert justement à retrouver des opérations. Avec leur
  // pastille de couleur, comme le filtre du dashboard.
  projetPoserFiltre(
    "categories",
    "projet-filtre-categories",
    t("Catégories"),
    state.categories.map((c) => ({
      cle: c.id,
      libelle: libelleCategorie(c.nom),
      couleur: couleurCategorie(c.couleur_index ?? 0),
    }))
  );
  chercherCandidatsProjet();
}

function fermerSelecteurProjet() {
  document.getElementById("projet-selecteur").style.display = "none";
  projetCandidats = [];
  projetSelection = new Set();
  majSelectionProjet();
}

/** Une opération passe le filtre de catégories si SA catégorie est cochée — ou, découpée,
 *  si l'une de SES PARTS l'est : c'est ainsi qu'elle compte dans l'histogramme. */
function projetPasseCategories(operation) {
  const choisies = projetFiltres.categories;
  if (!choisies) return true;
  if (operation.decoupes && operation.decoupes.length > 0) {
    return operation.decoupes.some((part) => choisies.has(part.categorie_id));
  }
  return choisies.has(operation.categorie_id);
}

async function chercherCandidatsProjet() {
  if (!projetOuvert) return;
  const parametres = new URLSearchParams();
  const debut = document.getElementById("projet-filtre-debut").value;
  const fin = document.getElementById("projet-filtre-fin").value;
  if (debut) parametres.set("date_debut", debut);
  if (fin) parametres.set("date_fin", fin);

  try {
    const operations = await apiFetch(`/operations?${parametres.toString()}`);
    // LES FILTRES SE FONT ICI et non côté serveur : la route /operations ne filtre que
    // sur UN compte et UNE catégorie, ne connaît ni le type ni le libellé, et l'élargir
    // au noyau pour le seul usage de cette extension aurait étendu son API sans
    // nécessité.
    const texte = document
      .getElementById("projet-filtre-texte")
      .value.trim()
      .toLowerCase();
    const deja = new Set(projetOperations.map((o) => o.id));
    const { comptes, types } = projetFiltres;
    projetCandidats = operations.filter(
      (operation) =>
        // Déjà dans le projet : la proposer inviterait à un geste sans effet
        // (le serveur ignore les doublons, mais l'écran ne doit pas les
        // suggérer).
        !deja.has(operation.id) &&
        (!comptes || comptes.has(operation.compte_id)) &&
        // PAR TYPE : avec « Tout sélectionner », c'est le geste pour verser d'un coup
        // toutes les dépenses remboursables, ou tous les virements, d'une période.
        (!types || types.has(operation.type_id)) &&
        projetPasseCategories(operation) &&
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
      ${cellulesOperationHtml(operation, "projet-cand")}
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
    projetLigneDecoupe(corps, operation, "projet-cand");
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
