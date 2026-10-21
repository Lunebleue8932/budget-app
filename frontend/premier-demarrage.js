/* ---------- LE GUIDE DE LA PREMIÈRE VISITE ----------
 *
 * La fenêtre de premier lancement (`#modale-bdd`) propose TROIS FAÇONS DE DÉCOUVRIR L'APPLICATION :
 * faire son premier import, suivre les tutoriels, visiter la démo. Elle ne fait que NOTER le choix
 * (`noterChoixDecouverte`, app.js) : la fenêtre est bloquante jusqu'à ce que la base soit rangée, et
 * rangée, la page se recharge. C'est ici, au chargement qui suit, que le choix s'exécute.
 *
 *   - « demo » : une bulle montre où la démo se trouve (le bouton de la barre latérale). Rien n'est
 *     ouvert à la place de l'utilisateur : on lui montre la porte, il l'ouvre s'il veut.
 *   - « tutoriels » : l'écran des tutoriels (Paramètres → Paramètres généraux), une bulle sur le premier,
 *     « Prendre l'application en main ». Pas plus lancé à sa place que la démo n'est ouverte.
 *   - « import » : une bulle l'emmène sur la page d'import, jusqu'au bouton qui choisit le fichier,
 *     puis le suit pas à pas à travers les tableaux de l'import (les colonnes, les catégories de la
 *     banque, le compte) jusqu'au bouton qui confirme. Une base neuve n'a pas de compte : rien n'est
 *     demandé avant le fichier, le compte se choisit - ou se crée - à l'étape 3 de l'import.
 *
 * LE GUIDE NE TOUCHE À RIEN et ne valide rien : les repliables de la configuration du fichier
 * restent fermés (les tableaux disent déjà ce qu'ils ont à dire), et l'étape suivante n'arrive pas
 * quand on clique « Suivant » mais quand l'écran change - le fichier est lu, un tableau s'ouvre,
 * l'import se termine. D'où une lecture de l'écran toutes les demi-secondes plutôt qu'un crochet dans
 * chaque fonction de l'import : le guide ne sait rien de ses entrailles, et l'import ne sait rien de
 * lui (hors `BudgetApp.guideImport.actif`, qui force l'ouverture du tableau des colonnes).
 *
 * La bulle est celle du tutoriel (`.tutoriel-bulle`, `.tutoriel-cible`) : même halo, mêmes couleurs.
 * Chargé APRÈS app.js, tutoriel.js et sandbox.js (`placerBulleTutoriel`, `eteindreCibleTutoriel`,
 * `BudgetApp.sandboxPret`).
 */

BudgetApp.guideImport = { actif: false };

let guideEtape = null;
let guideMinuterie = null;
// Ce que la bulle désigne en ce moment, pour la replacer quand la page défile.
let guideConfig = null;

const GUIDE_TABLEAUX = [
  "modale-detection",
  "modale-mots-cles",
  "modale-correspondances",
  "modale-compte-import",
  "modale-virements-import",
];

function guideBulle() {
  let bulle = document.getElementById("guide-bulle");
  if (bulle) return bulle;
  bulle = document.createElement("div");
  bulle.id = "guide-bulle";
  bulle.className = "tutoriel-bulle guide-bulle";
  bulle.setAttribute("role", "dialog");
  bulle.setAttribute("aria-live", "polite");
  bulle.style.display = "none";
  document.body.appendChild(bulle);
  // UN SEUL ÉCOUTEUR DÉLÉGUÉ, posé avec la bulle : elle est réécrite à chaque étape.
  bulle.addEventListener("click", (e) => {
    if (e.target.closest("[data-guide='fermer']")) arreterGuide();
    // « Terminé », au bout du premier import : le dashboard montre ce que l'import vient de poser.
    if (e.target.closest("[data-guide='termine']")) {
      arreterGuide();
      switchSection("dashboard");
    }
  });
  return bulle;
}

function guideVisible(selecteur) {
  const el = document.querySelector(selecteur);
  // `getClientRects` et non `offsetParent` : celui-ci est null pour tout élément en position fixe,
  // c'est-à-dire pour les deux tableaux de l'import.
  return el && el.getClientRects().length > 0 ? el : null;
}

/** Remet les deux tableaux de l'import dans leur place d'origine (la bulle ne les pousse plus). */
function guideRanger() {
  GUIDE_TABLEAUX.forEach((id) => {
    const fond = document.getElementById(id);
    if (fond) fond.classList.remove("modale-fond-guide");
  });
}

/**
 * Pose la bulle d'une étape. `cible` : le sélecteur de ce qu'elle désigne (le halo y est posé).
 * `lieu` : « bas » (sous la cible, ou dessus quand la place manque), « droite » (à côté, pour la
 * barre latérale) ou « haut » (en haut de l'écran, au-dessus d'un tableau qui se range en bas).
 */
function guideAfficher({ titre, cle, cible, lieu = "bas", tableau = null, fermer = false, termine = false }) {
  eteindreCibleTutoriel();
  guideRanger();
  const element = cible ? guideVisible(cible) : null;
  if (element) {
    element.classList.add("tutoriel-cible");
    if (lieu === "bas") element.scrollIntoView({ behavior: "smooth", block: "center" });
  }
  if (tableau) document.getElementById(tableau).classList.add("modale-fond-guide");

  const bulle = guideBulle();
  bulle.classList.toggle("guide-bulle-haut", lieu === "haut");
  bulle.innerHTML = `
    <div class="tutoriel-entete">
      <span class="tutoriel-parcours">${escapeHtml(t("Premiers pas"))}</span>
      <button type="button" class="tutoriel-fermer" data-guide="fermer"
              title="${escapeHtml(t("Quitter le guide"))}" aria-label="${escapeHtml(t("Quitter le guide"))}">&times;</button>
    </div>
    <h4>${escapeHtml(t(titre))}</h4>
    <div class="tutoriel-texte"></div>
    ${
      fermer
        ? `<div class="tutoriel-actions"><button type="button" class="primary" data-guide="${
            termine ? "termine" : "fermer"
          }">${escapeHtml(t(termine ? "Terminé" : "Compris"))}</button></div>`
        : ""
    }`;
  // LE TEXTE S'ÉCRIT EN NŒUDS (puces, gras, sauts de paragraphe : cf. textes.js), jamais en HTML.
  const zone = bulle.querySelector(".tutoriel-texte");
  const texte = t(texteAide(cle));
  if (texteAMarqueurs(texte)) ecrireTexteAide(zone, texte);
  else zone.textContent = texte;
  bulle.style.display = "";
  guideConfig = { cible: element ? cible : null, lieu };
  guidePlacer();
}

/** Pose la bulle contre ce que l'étape désigne. Rappelée au défilement : elle est en position fixe. */
function guidePlacer() {
  const bulle = document.getElementById("guide-bulle");
  if (!bulle || bulle.style.display === "none" || !guideConfig) return;
  const { cible, lieu } = guideConfig;
  const element = cible ? guideVisible(cible) : null;
  if (lieu === "haut") {
    // En haut de l'écran, le tableau se range en bas (cf. `.modale-fond-guide`) : rien à calculer.
    bulle.classList.remove("tutoriel-bulle-centree");
    bulle.style.top = "";
    bulle.style.left = "";
  } else if (lieu === "droite" && element) {
    const rect = element.getBoundingClientRect();
    bulle.classList.remove("tutoriel-bulle-centree");
    bulle.style.left = `${rect.right + 14}px`;
    bulle.style.top = `${Math.max(12, rect.top + rect.height / 2 - bulle.offsetHeight / 2)}px`;
  } else {
    placerBulleTutoriel(bulle, element, null);
  }
}

function arreterGuide() {
  clearInterval(guideMinuterie);
  guideMinuterie = null;
  guideEtape = null;
  BudgetApp.guideImport.actif = false;
  eteindreCibleTutoriel();
  guideRanger();
  const bulle = document.getElementById("guide-bulle");
  if (bulle) bulle.style.display = "none";
}

/* ---------- Les tutoriels ----------
 *
 * L'ÉCRAN DES TUTORIELS, ET UNE BULLE SUR LE PREMIER : « Prendre l'application en main » fait le tour de
 * l'application, c'est par lui qu'on commence. La bulle désigne sa carte ; c'est l'utilisateur qui clique
 * « Commencer » (il entre alors dans la base de découverte, la page se recharge et la bulle s'en va).
 * Une lecture de l'écran toutes les demi-secondes, comme pour l'import : la bulle se tait dès que la carte
 * n'est plus à l'écran (une autre page) ou qu'un tutoriel a démarré.
 */
const GUIDE_CARTE_PRISE_EN_MAIN = "#tutoriels-liste [data-parcours='decouverte']";

function guideSurveillerTutoriels() {
  const tutorielEnCours = typeof tutorielActif !== "undefined" && tutorielActif;
  if (tutorielEnCours || !guideVisible(GUIDE_CARTE_PRISE_EN_MAIN)) arreterGuide();
}

async function guideTutoriels() {
  arreterGuide();
  // Dans la démo, un tutoriel ne se lance pas (cf. routers/sandbox.py) : il n'y a rien à montrer.
  if (BudgetApp.sandboxPret) await BudgetApp.sandboxPret;
  if (BudgetApp.sandbox.actif) return;
  // La liste des parcours s'écrit à l'arrivée sur la page (cf. loadParametresGeneraux).
  switchSection("parametres", { sousSection: "parametres-generaux" });
  guideAfficher({
    titre: "Les tutoriels sont ici",
    cle: "noyau.guide-tutoriels",
    cible: GUIDE_CARTE_PRISE_EN_MAIN,
    fermer: true,
  });
  guideMinuterie = setInterval(guideSurveillerTutoriels, 500);
}

/* ---------- La démo ---------- */

async function guideDemo() {
  // Déjà dans la démo : il n'y a plus de porte à montrer.
  if (BudgetApp.sandboxPret) await BudgetApp.sandboxPret;
  if (BudgetApp.sandbox.actif) return;
  guideAfficher({
    titre: "La démo est ici",
    cle: "noyau.guide-demo",
    cible: "#btn-sandbox-entrer",
    lieu: "droite",
    fermer: true,
  });
}

/* ---------- Le premier import ---------- */

/** L'étape que l'écran montre à cet instant, ou null quand rien n'est à dire (page quittée). */
function guideEtapeDeLEcran() {
  // L'import vient de se terminer : la carte « Import terminé » est affichée.
  if (guideVisible("#import-resultat")) return "fin";
  // Une fenêtre de création (un compte, une monnaie) s'ouvre par-dessus l'étape 3 : la bulle se tait le
  // temps qu'elle est ouverte, plutôt que de désigner la fenêtre qu'elle recouvre.
  if (guideVisible("#modale-guide-compte") || guideVisible("#modale-creation-monnaie")) return null;
  // LES ÉTAPES DE L'IMPORT, dans leur ordre : le compte, puis les virements internes (3bis), chacun dans sa
  // propre fenêtre.
  if (guideVisible("#modale-virements-import")) return "virements";
  if (guideVisible("#modale-compte-import")) return "compte-fichier";
  if (guideVisible("#modale-correspondances")) return "categories";
  if (guideVisible("#modale-mots-cles")) return "mots-cles";
  if (guideVisible("#modale-detection")) return "colonnes";
  if (!guideVisible("#sous-section-parametres-import")) return null;
  // La proposition de preset, posée dans la page AVANT toute fenêtre de l'import.
  if (guideVisible("#import-proposition-bulle")) return "preset";
  // Rien n'est lu tant que le fichier n'est pas choisi.
  if (!guideVisible("#import-apercu-bloc")) return "fichier";
  return "apercu";
}

const GUIDE_ETAPES_IMPORT = {
  fichier: {
    titre: "Choisis ton relevé",
    cle: "noyau.guide-import-fichier",
    cible: "#btn-import-choisir-fichier",
  },
  preset: {
    titre: "Choisis le preset",
    cle: "noyau.guide-import-preset",
    cible: "#import-proposition-bulle",
  },
  colonnes: {
    titre: "Dis ce que contient chaque colonne",
    cle: "noyau.guide-import-colonnes",
    cible: "#detection-board .corr-roue-cadre",
    lieu: "haut",
    tableau: "modale-detection",
  },
  "mots-cles": {
    titre: "Dis ce que veulent dire les mots du fichier",
    cle: "noyau.guide-import-mots-cles",
    cible: "#mots-cles-board .corr-roue-cadre",
    lieu: "haut",
    tableau: "modale-mots-cles",
  },
  categories: {
    titre: "Classe les catégories de ta banque",
    cle: "noyau.guide-import-categories",
    cible: "#correspondances-board .corr-roue-cadre",
    lieu: "haut",
    tableau: "modale-correspondances",
  },
  "compte-fichier": {
    titre: "Choisis le compte",
    cle: "noyau.guide-import-compte",
    cible: "#modale-compte-import .modale",
    lieu: "haut",
    tableau: "modale-compte-import",
  },
  virements: {
    titre: "Choisis l'autre compte de chaque virement",
    cle: "noyau.guide-import-virements",
    cible: "#virements-import-board .corr-roue-cadre",
    lieu: "haut",
    tableau: "modale-virements-import",
  },
  apercu: {
    titre: "Vérifie avant de confirmer",
    cle: "noyau.guide-import-apercu",
    cible: "#btn-import-confirmer",
  },
  fin: {
    titre: "Premier import terminé",
    cle: "noyau.guide-import-fin",
    cible: "#import-resultat",
    fermer: true,
    termine: true,
  },
};

function guideSurveiller() {
  if (!BudgetApp.guideImport.actif) return;
  const etape = guideEtapeDeLEcran();
  if (etape === guideEtape) return;
  guideEtape = etape;
  if (!etape) {
    // Page quittée : la bulle se tait, elle revient avec l'écran d'import.
    eteindreCibleTutoriel();
    guideRanger();
    const bulle = document.getElementById("guide-bulle");
    if (bulle) bulle.style.display = "none";
    return;
  }
  if (etape !== "fichier") guideReplierLesReglages();
  guideAfficher(GUIDE_ETAPES_IMPORT[etape]);
}

/** Les réglages du fichier restent REPLIÉS pendant le guide : les tableaux disent déjà ce qu'ils ont à
 *  dire. L'import les déplie de lui-même devant un fichier mal lu (le preset par défaut n'a jamais vu
 *  ce format) - c'est ici, à chaque changement d'étape, qu'on les referme. Jamais en continu : qui les
 *  rouvre de lui-même les garde ouverts jusqu'à l'étape suivante. */
function guideReplierLesReglages() {
  ["import-reglages-lecture", "import-config-fichier"].forEach((id) => {
    const bloc = document.getElementById(id);
    if (bloc) bloc.open = false;
  });
}

async function guideImport() {
  // Relancé depuis la barre latérale en pleine visite : on repart de zéro plutôt que d'empiler deux lectures.
  arreterGuide();
  // LES CATÉGORIES D'ORIENTATION D'UNE BASE NEUVE : une base qui s'ouvre sur « Autres » et une ou deux
  // catégories seulement (un fichier rouvert, un premier essai) reçoit les postes livrés, pour que le
  // tableau des catégories de la banque ait de quoi proposer. Le serveur ne touche jamais une base qui a
  // déjà servi ; un échec ne bloque rien.
  try {
    const { ajoutees } = await apiFetch("/categories/defauts-base-neuve", { method: "POST" });
    if (ajoutees.length) await refreshCategories();
  } catch (err) {
    /* Le guide continue avec les catégories qu'il y a. */
  }
  // PAS DE COMPTE À CRÉER D'ABORD : le guide invite tout de suite à choisir le fichier. Le compte se choisit,
  // ou se crée, à l'étape 3 de l'import (cf. app.js, « LE COMPTE DE L'IMPORT »).
  BudgetApp.guideImport.actif = true;
  switchSection("parametres", { sousSection: "parametres-import" });
  guideMinuterie = setInterval(guideSurveiller, 500);
  // Un premier tour sans attendre l'intervalle : la page d'import se charge pendant ce temps.
  setTimeout(guideSurveiller, 700);
}

/* ---------- Au chargement ---------- */

// La même porte, depuis la barre latérale : pour qui n'a pas choisi le premier import dans la fenêtre de
// premier lancement et veut quand même le guide.
const boutonPremierImport = document.getElementById("btn-premier-import");
if (boutonPremierImport) boutonPremierImport.addEventListener("click", () => guideImport());

// Celle des tutoriels, juste en dessous.
const boutonGuideTutoriels = document.getElementById("btn-guide-tutoriels");
if (boutonGuideTutoriels) boutonGuideTutoriels.addEventListener("click", () => guideTutoriels());

["scroll", "resize"].forEach((evenement) => {
  window.addEventListener(evenement, guidePlacer, { passive: true });
});

(async function demarrerGuide() {
  let voie = null;
  try {
    voie = sessionStorage.getItem(CLE_GUIDE_DEMARRAGE);
    // Consommé tout de suite : un guide qu'on a laissé de côté ne revient pas au prochain chargement.
    sessionStorage.removeItem(CLE_GUIDE_DEMARRAGE);
  } catch (err) {
    return;
  }
  if (voie !== "demo" && voie !== "import" && voie !== "tutoriels") return;
  try {
    await BudgetApp.pret;
  } catch (err) {
    return;
  }
  if (voie === "demo") guideDemo();
  else if (voie === "tutoriels") guideTutoriels();
  else guideImport();
})();
