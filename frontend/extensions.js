/**
 * Chargement des extensions côté navigateur.
 *
 * PENDANT FRONTEND de app/extensions.py. Le serveur dit quelles extensions
 * sont présentes et lesquelles sont actives (GET /extensions) ; ce module va
 * chercher leurs fichiers, injecte leur écran dans la page et leur donne un
 * point d'accroche pour s'enregistrer.
 *
 * DÉROULÉ, dans cet ordre et pas un autre :
 *
 *   1. GET /extensions          -> la liste et l'état de chacune
 *   2. pour chaque extension :  CSS, puis fragment HTML, puis JS
 *   3. le JS appelle BudgetApp.extensions.enregistrer(...) en s'exécutant
 *   4. l'entrée de navigation apparaît, si l'extension est active
 *
 * Le HTML AVANT le JS : le script d'une extension accroche ses écouteurs sur
 * les éléments de son écran dès son exécution ; l'inverse le ferait travailler
 * sur une page où rien de tout cela n'existe encore.
 *
 * CHARGÉES MÊME QUAND ELLES SONT DÉSACTIVÉES, écran compris — seule l'entrée
 * de navigation est retenue. Basculer une extension depuis les Paramètres
 * n'a alors qu'à montrer ou masquer un bouton, sans recharger la page ni
 * refaire le moindre aller-retour.
 *
 * TOUT ÉCHEC EST LOCAL À UNE EXTENSION : une extension dont le JS casse ne
 * doit pas empêcher les autres de se charger, ni l'application de s'ouvrir.
 */

// Espace de noms unique exposé aux extensions. Volontairement minuscule : plus
// il offre de choses, plus il devient difficile de le faire évoluer sans
// casser les extensions écrites contre lui.
window.BudgetApp = window.BudgetApp || {};

const extensionsChargees = new Map(); // id -> { manifeste, chargeur }

window.BudgetApp.extensions = {
  /**
   * Appelé par le JS d'une extension au moment où il s'exécute.
   *
   * `chargeur` est rappelé à chaque fois que l'utilisateur ouvre l'écran de
   * l'extension — comme loadDashboard() ou loadOperations() pour les écrans
   * du noyau, et pour la même raison : les données ont pu changer depuis la
   * dernière visite.
   */
  enregistrer(id, { chargeur } = {}) {
    const entree = extensionsChargees.get(id);
    if (!entree) {
      console.warn(`Extension inconnue à l'enregistrement : ${id}`);
      return;
    }
    entree.chargeur = chargeur || null;
  },

  /** Les extensions présentes, actives ou non (lecture seule). */
  liste() {
    return [...extensionsChargees.values()].map((e) => e.manifeste);
  },

  /** Vrai si l'extension est présente ET activée. */
  estActive(id) {
    const entree = extensionsChargees.get(id);
    return Boolean(entree && entree.manifeste.actif);
  },

  /**
   * Ouvre l'écran d'une extension. Rend false si l'extension n'a pas d'écran
   * à ouvrir : l'appelant (switchSection) sait alors que la section demandée
   * ne le concerne pas.
   */
  async ouvrir(section) {
    return appelerChargeur((nav) => nav.type === "page" && nav.section === section);
  },

  /**
   * Pendant de `ouvrir` pour les SOUS-PAGES de Paramètres (« Base de
   * données » en version développeur). Séparé parce que les deux espaces de
   * noms sont indépendants : rien n'interdit qu'un écran principal et une
   * sous-page de réglages portent le même nom.
   */
  async ouvrirSousPage(sousSection) {
    return appelerChargeur(
      (nav) => nav.type === "parametres" && `parametres-${nav.sous_section}` === sousSection
    );
  },
};

/** Appelle le chargeur de la première extension dont la navigation correspond. */
async function appelerChargeur(correspond) {
  const entree = [...extensionsChargees.values()].find(
    (e) => e.manifeste.navigation && correspond(e.manifeste.navigation)
  );
  if (!entree || !entree.chargeur) return false;
  try {
    await entree.chargeur();
  } catch (err) {
    console.error(`Extension ${entree.manifeste.id} : échec du chargement`, err);
  }
  return true;
}

function urlFichier(id, fichier) {
  return `/extensions/${encodeURIComponent(id)}/fichiers/${fichier}`;
}

function chargerCss(id, fichier) {
  return new Promise((resolve) => {
    const lien = document.createElement("link");
    lien.rel = "stylesheet";
    lien.href = urlFichier(id, fichier);
    // On résout dans les deux cas : une feuille de style manquante dégrade
    // l'apparence, elle n'empêche pas la fonctionnalité de marcher.
    lien.onload = resolve;
    lien.onerror = resolve;
    document.head.appendChild(lien);
  });
}

function chargerJs(id, fichier) {
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = urlFichier(id, fichier);
    script.onload = resolve;
    script.onerror = () => reject(new Error(`script introuvable : ${fichier}`));
    document.body.appendChild(script);
  });
}

/**
 * Injecte l'écran d'une extension dans <main>, comme une section de plus.
 *
 * Le fragment fourni par l'extension est un `<section id="section-...">`
 * complet : il se comporte donc exactement comme les écrans du noyau, y
 * compris pour switchSection qui les montre et les cache par cette classe.
 */
async function injecterHtml(id, fichier, navigation) {
  const reponse = await fetch(urlFichier(id, fichier));
  if (!reponse.ok) throw new Error(`fragment introuvable : ${fichier}`);
  const html = await reponse.text();
  // Un écran principal est une <section> de plus dans <main> ; une sous-page
  // de réglages est une .sous-section de plus dans la section Paramètres. Les
  // deux se comportent ensuite exactement comme leurs homologues du noyau.
  const hote =
    navigation && navigation.type === "parametres"
      ? document.getElementById("section-parametres")
      : document.querySelector("main");
  // insertAdjacentHTML plutôt que innerHTML += : réécrire tout le contenu de
  // l'hôte détruirait et recréerait les écrans du noyau, et avec eux tous les
  // écouteurs que app.js y a déjà posés.
  hote.insertAdjacentHTML("beforeend", html);
}

/**
 * Ajoute l'entrée de navigation d'une extension, à sa position déclarée.
 *
 * Le bouton est créé même pour une extension DÉSACTIVÉE, puis simplement
 * masqué : basculer l'extension n'a plus qu'à changer un `display`, sans
 * reconstruire la barre ni recharger la page.
 */
function ajouterNavigation(manifeste) {
  const navigation = manifeste.navigation;
  if (!navigation) return;

  const bouton = document.createElement("button");
  bouton.type = "button";
  bouton.dataset.extension = manifeste.id;
  bouton.textContent = t(navigation.libelle);
  bouton.style.display = manifeste.actif ? "" : "none";

  if (navigation.type === "parametres") {
    // Onglet de réglages : le clic est pris en charge par les gestionnaires
    // délégués de app.js (affichage ET chargement), exactement comme pour un
    // onglet du noyau — rien à câbler ici.
    bouton.dataset.sousSection = `parametres-${navigation.sous_section}`;
    document.getElementById("parametres-sous-nav").appendChild(bouton);
    return;
  }

  const barre = document.querySelector("header nav");
  bouton.dataset.section = navigation.section;
  bouton.addEventListener("click", () => switchSection(navigation.section));

  // `position` est un rang souhaité, pas un index de tableau : on l'insère
  // avant le premier bouton du noyau de rang supérieur, et à la fin si aucun.
  // Un rang absent ou en doublon ne casse donc rien, il place seulement le
  // bouton un cran plus loin.
  const boutons = [...barre.querySelectorAll("button")];
  const rang = Number(navigation.position);
  const suivant = Number.isFinite(rang) ? boutons[rang] : null;
  barre.insertBefore(bouton, suivant || null);
}

function majVisibiliteNavigation(id, actif) {
  document
    .querySelectorAll(`button[data-extension="${id}"]`)
    .forEach((bouton) => (bouton.style.display = actif ? "" : "none"));
}

window.BudgetApp.extensions.majVisibilite = majVisibiliteNavigation;

/**
 * Annonce les extensions trouvées au lancement.
 *
 * POURQUOI CETTE ANNONCE EXISTE. L'application est livrée SANS aucune
 * extension : le dossier `extensions/` arrive vide, et c'est l'utilisateur qui
 * y dépose ce qu'il télécharge. En trouver au démarrage n'est donc jamais
 * banal — c'est la confirmation que ce qu'il vient d'installer a bien été vu,
 * et le seul moment où l'on peut le lui dire avant qu'il aille le chercher.
 *
 * À CHAQUE LANCEMENT, sans mémoire de ce qui a déjà été annoncé : rien n'est
 * enregistré ici. La modale répond à « qu'est-ce qui est chargé aujourd'hui »,
 * pas à « qu'y a-t-il de nouveau », et elle disparaît d'elle-même le jour où
 * le dossier redevient vide.
 */
function afficherModaleExtensions(extensions) {
  if (extensions.length === 0) return;

  const fond = document.getElementById("modale-extensions");
  document.getElementById("modale-extensions-texte").textContent =
    extensions.length === 1
      ? t("Une extension a été trouvée dans le dossier « extensions » et chargée :")
      : t("{n} extensions ont été trouvées dans le dossier « extensions » et chargées :", {
          n: extensions.length,
        });

  document.getElementById("modale-extensions-liste").innerHTML = extensions
    .map(
      (e) => `<li>
        <span class="modale-extension-nom">${escapeHtml(e.nom)}</span>
        ${e.version ? `<span class="modale-extension-version">v${escapeHtml(e.version)}</span>` : ""}
      </li>`
    )
    .join("");

  fond.style.display = "";
  // La page derrière ne doit plus défiler : une molette au-dessus d'une modale
  // fait sinon glisser le contenu grisé, ce qui donne l'impression que le clic
  // est passé au travers.
  document.body.classList.add("modale-ouverte");
  // Le focus part sur l'action principale : Entrée mène alors au menu des
  // extensions, et Tab circule dans la modale plutôt que dans la page grisée
  // derrière.
  document.getElementById("btn-modale-extensions-aller").focus();
}

function fermerModaleExtensions() {
  document.getElementById("modale-extensions").style.display = "none";
  document.body.classList.remove("modale-ouverte");
}

document
  .getElementById("btn-modale-extensions-fermer")
  .addEventListener("click", fermerModaleExtensions);

document.getElementById("btn-modale-extensions-aller").addEventListener("click", () => {
  fermerModaleExtensions();
  switchSection("parametres");
  // Le clic sur l'onglet plutôt qu'un appel direct : c'est lui qui porte à la
  // fois l'affichage de la sous-page et le chargement de ses données (cf. les
  // deux gestionnaires délégués de app.js).
  document
    .querySelector('#parametres-sous-nav button[data-sous-section="parametres-extensions"]')
    ?.click();
});

// Clic sur le fond (hors de la boîte) et Échap : les deux sorties qu'on essaie
// d'instinct sur une modale. Rien n'est perdu en fermant — l'information reste
// dans Paramètres → Extensions.
document.getElementById("modale-extensions").addEventListener("click", (e) => {
  if (e.target.id === "modale-extensions") fermerModaleExtensions();
});

document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  if (document.getElementById("modale-extensions").style.display !== "none") {
    fermerModaleExtensions();
  }
});

/**
 * Charge toutes les extensions. Appelé une fois, au démarrage de app.js,
 * AVANT le premier rendu : une extension qui ajoute un écran doit avoir posé
 * son bouton avant que l'utilisateur ne regarde la barre de navigation.
 */
async function chargerExtensions() {
  let extensions;
  try {
    extensions = await apiFetch("/extensions");
  } catch (err) {
    // Une application sans extensions doit continuer de fonctionner : c'est
    // le cas normal d'une installation minimale, pas une panne.
    console.warn("Extensions indisponibles :", err.message);
    return;
  }

  const abouties = [];
  for (const manifeste of extensions) {
    extensionsChargees.set(manifeste.id, { manifeste, chargeur: null });
    const fichiers = manifeste.frontend || {};
    try {
      for (const css of fichiers.css || []) {
        await chargerCss(manifeste.id, css);
      }
      if (fichiers.html) {
        await injecterHtml(manifeste.id, fichiers.html, manifeste.navigation);
        ajouterNavigation(manifeste);
      }
      for (const js of fichiers.js || []) {
        await chargerJs(manifeste.id, js);
      }
      abouties.push(manifeste);
    } catch (err) {
      console.error(`Extension ${manifeste.id} : ${err.message}`);
    }
  }

  // APRÈS la boucle, et seulement les ABOUTIES : la modale se veut la
  // confirmation que ce qui a été déposé est en place. Une extension dont les
  // fichiers manquent a échoué juste au-dessus — l'annoncer comme chargée
  // enverrait chercher un écran qui n'existe pas. Son erreur, elle, reste
  // visible dans Paramètres → Extensions.
  afficherModaleExtensions(abouties);
}
