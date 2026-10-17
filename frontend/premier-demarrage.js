/* ---------- LE GUIDE DE LA PREMIÈRE VISITE ----------
 *
 * La fenêtre de premier lancement (`#modale-bdd`) propose DEUX FAÇONS DE DÉCOUVRIR L'APPLICATION :
 * visiter la démo, ou faire son premier import. Elle ne fait que NOTER le choix
 * (`noterChoixDecouverte`, app.js) : la fenêtre est bloquante jusqu'à ce que la base soit rangée, et
 * rangée, la page se recharge. C'est ici, au chargement qui suit, que le choix s'exécute.
 *
 *   - « demo » : une bulle montre où la démo se trouve (le bouton de la barre latérale). Rien n'est
 *     ouvert à la place de l'utilisateur : on lui montre la porte, il l'ouvre s'il veut.
 *   - « import » : une bulle l'emmène sur la page d'import, jusqu'au bouton qui choisit le fichier,
 *     puis le suit pas à pas à travers les tableaux de l'import (les colonnes, les catégories de la
 *     banque) jusqu'au bouton qui confirme. Une base neuve n'a pas de compte : une petite fenêtre en
 *     crée un d'abord, sans passer par Paramètres → Configuration, qui est trop pour un début.
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

const GUIDE_TABLEAUX = ["modale-detection", "modale-correspondances"];

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
function guideAfficher({ titre, cle, cible, lieu = "bas", tableau = null, fermer = false }) {
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
        ? `<div class="tutoriel-actions"><button type="button" class="primary" data-guide="fermer">${escapeHtml(
            t("Compris")
          )}</button></div>`
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

/* ---------- Le compte du premier import ---------- */

/** Ouvre la fenêtre de création d'un compte ; rend `true` quand il est créé, `false` si on remet à plus tard. */
function guideDemanderCompte() {
  const fond = document.getElementById("modale-guide-compte");
  const nom = document.getElementById("guide-compte-nom");
  const type = document.getElementById("guide-compte-type");
  const erreur = document.getElementById("guide-compte-erreur");
  fillTypesComptesSelect(type, state.typesComptes || []);
  const courant = (state.typesComptes || []).find((x) => x.nom === "courant");
  if (courant) type.value = courant.id;
  nom.value = "";
  erreur.style.display = "none";
  fond.style.display = "flex";
  nom.focus();

  return new Promise((resolve) => {
    const formulaire = document.getElementById("form-guide-compte");
    const plusTard = document.getElementById("btn-guide-compte-plus-tard");
    const creer = document.getElementById("btn-guide-compte-creer");
    const fermer = (reponse) => {
      fond.style.display = "none";
      formulaire.removeEventListener("submit", surEnvoi);
      plusTard.removeEventListener("click", surPlusTard);
      document.removeEventListener("keydown", surTouche, true);
      resolve(reponse);
    };
    const surPlusTard = () => fermer(false);
    const surTouche = (e) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        fermer(false);
      }
    };
    const surEnvoi = async (e) => {
      e.preventDefault();
      const monnaies = (state.monnaies || []).filter((m) => m.active !== false).map((m) => m.id);
      const monnaieId = monnaiePreferee(monnaies);
      creer.disabled = true;
      erreur.style.display = "none";
      try {
        await apiFetch("/comptes", {
          method: "POST",
          body: JSON.stringify({
            nom: nom.value.trim(),
            type_id: Number(type.value),
            monnaies: [{ monnaie_id: monnaieId }],
          }),
        });
        await refreshComptes();
        showMessage(t("Compte créé"), "success");
        fermer(true);
      } catch (err) {
        const p = document.createElement("p");
        p.className = "import-avertissement";
        p.textContent = traduireMessageServeur(err.message);
        erreur.replaceChildren(p);
        erreur.style.display = "";
      } finally {
        creer.disabled = false;
      }
    };
    formulaire.addEventListener("submit", surEnvoi);
    plusTard.addEventListener("click", surPlusTard);
    document.addEventListener("keydown", surTouche, true);
  });
}

/* ---------- Le premier import ---------- */

/** L'étape que l'écran montre à cet instant, ou null quand rien n'est à dire (page quittée). */
function guideEtapeDeLEcran() {
  // L'import vient de se terminer : la carte « Import terminé » est affichée.
  if (guideVisible("#import-resultat")) return "fin";
  if (guideVisible("#modale-correspondances")) return "categories";
  if (guideVisible("#modale-detection")) return "colonnes";
  if (!guideVisible("#sous-section-parametres-import")) return null;
  // Rien n'est lu tant que le fichier n'est pas choisi.
  if (!guideVisible("#import-apercu-bloc")) return "fichier";
  // Le fichier ne nomme pas son compte : c'est à celui qui le lit de dire lequel.
  const compte = guideVisible("#import-compte-defaut-bloc");
  if (compte && !document.getElementById("import-compte-defaut").value) return "compte-fichier";
  return "apercu";
}

const GUIDE_ETAPES_IMPORT = {
  fichier: {
    titre: "Choisis ton relevé",
    cle: "noyau.guide-import-fichier",
    cible: "#btn-import-choisir-fichier",
  },
  colonnes: {
    titre: "Dis ce que contient chaque colonne",
    cle: "noyau.guide-import-colonnes",
    cible: "#detection-board .corr-roue-cadre",
    lieu: "haut",
    tableau: "modale-detection",
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
    cible: "#import-compte-defaut",
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
  if (etape === "compte-fichier") guideRelireAuChoixDuCompte();
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

/** Choisir le compte du fichier relit le fichier : l'aperçu ne se rafraîchit pas tout seul, et un
 *  aperçu où chaque ligne attend son compte n'apprend rien. Posé une seule fois, pour le guide. */
function guideRelireAuChoixDuCompte() {
  const choix = document.getElementById("import-compte-defaut");
  if (choix.dataset.guide) return;
  choix.dataset.guide = "1";
  choix.addEventListener("change", () => {
    if (BudgetApp.guideImport.actif && choix.value) relireFichierImport();
  });
}

async function guideImport() {
  // Un compte d'abord : sans lui, un relevé n'a nulle part où aller.
  if (!(state.comptes || []).length) {
    if (!(await guideDemanderCompte())) return;
  }
  BudgetApp.guideImport.actif = true;
  switchSection("parametres", { sousSection: "parametres-import" });
  guideMinuterie = setInterval(guideSurveiller, 500);
  // Un premier tour sans attendre l'intervalle : la page d'import se charge pendant ce temps.
  setTimeout(guideSurveiller, 700);
}

/* ---------- Au chargement ---------- */

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
  if (voie !== "demo" && voie !== "import") return;
  try {
    await BudgetApp.pret;
  } catch (err) {
    return;
  }
  if (voie === "demo") guideDemo();
  else guideImport();
})();
