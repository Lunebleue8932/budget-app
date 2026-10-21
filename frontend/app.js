/* ---------- Textes d'aide, puis langue ---------- */

/**
 * LES PHRASES D'AIDE D'ABORD, LA TRADUCTION ENSUITE, et l'ordre n'est pas
 * indifférent.
 *
 * index.html ne porte plus le texte de ses pastilles « i » mais une CLÉ (cf.
 * textes.js, la source unique de toutes ces phrases). `appliquerTextes` pose le
 * texte français dans `data-info` ; `traduireDomStatique`, juste après, y
 * cherche sa traduction. Inverser les deux ferait traduire des attributs encore
 * vides, et l'application s'afficherait intégralement en français une fois
 * passée à l'anglais.
 */
appliquerTextes(document.body);

/**
 * Traduction du texte statique, AVANT tout le reste.
 *
 * L'appel est placé ici, en tête du script, pour qu'il ait lieu pendant que le
 * DOM ne contient encore que index.html : aucune donnée n'a été chargée, donc
 * aucun nom de compte ou de catégorie ne risque d'être pris pour un libellé de
 * l'interface (cf. i18n.js). Tout ce qui vient ensuite est traduit à la
 * construction, via `t()`.
 */
traduireDomStatique(document.body);

/**
 * Les puces des blocs d'aide, EN TROISIÈME et jamais avant.
 *
 * `appliquerTextes` pose la phrase française, `traduireDomStatique` la remplace
 * par l'anglais — les deux travaillent sur UN nœud de texte, et c'est ce qui
 * permet au dictionnaire de connaître la phrase entière. Ce n'est qu'ensuite
 * qu'on peut la découper en liste sans avoir à inventer une clé par puce (cf.
 * textes.js, `appliquerPuces`).
 */
appliquerPuces(document.body);

// Deux boutons-drapeaux à bascule (pas de <select> : un <option> ne peut pas
// dessiner un vrai drapeau, cf. index.html). `aria-pressed` porte à la fois
// l'état visuel (cf. .langue-drapeau[aria-pressed="true"]) et l'état
// accessible.
(function cablerSelecteurLangue() {
  const boutons = document.querySelectorAll(".langue-drapeau");
  if (!boutons.length) return;
  boutons.forEach((btn) => {
    btn.setAttribute("aria-pressed", String(btn.dataset.langue === langue()));
    btn.addEventListener("click", () => changerLangue(btn.dataset.langue));
  });
})();

/* ---------- LE LIEN « FEEDBACK » DE LA BARRE LATÉRALE ----------
 *
 * L'ADRESSE EST DANS `index.html`, dans le `href` de `#lien-feedback`, et nulle
 * part ailleurs : c'est le seul endroit à changer. Ce code-ci ne fait que la
 * relire.
 *
 * POURQUOI UN ÉCOUTEUR PLUTÔT QUE LE SEUL `target="_blank"`. Dans le navigateur,
 * l'attribut suffit et rien de ceci ne s'exécute. Dans la FENÊTRE DE BUREAU, il
 * ne veut rien dire — un navigateur embarqué n'a ni onglet ni fenêtre à ouvrir :
 * selon la plateforme le clic ne fait rien (ce qui se lit comme une panne) ou
 * remplace l'application par la page, sans barre d'adresse pour en revenir. On
 * passe donc par le pont de la fenêtre, qui la donne au navigateur du système
 * (cf. desktop/app_desktop.py, ApiBureau.ouvrir_lien_externe).
 *
 * `window.pywebview` EST ABSENT DANS UN NAVIGATEUR : c'est ce qui distingue les
 * deux cas, et c'est déjà ainsi que l'écran de premier démarrage choisit entre
 * le sélecteur du système et la saisie à la main.
 */
document.getElementById("lien-feedback")?.addEventListener("click", (e) => {
  const pont = window.pywebview?.api?.ouvrir_lien_externe;
  if (!pont) return; // Navigateur : `target="_blank"` fait le travail.
  e.preventDefault();
  pont(e.currentTarget.href);
});

const state = {
  meta: null,
  comptes: [],
  categories: [],
  typesComptes: [],
  // Les monnaies de l'app (table `monnaie`). Rien n'est jamais converti d'une
  // monnaie à l'autre : elles servent à libeller les montants et à découper en
  // onglets tout ce qui agrège (KPI du dashboard, budgets).
  monnaies: [],
  // Monnaie sélectionnée dans les onglets du dashboard. La page Catégories
  // avait la sienne tant qu'elle portait une colonne « Budget » ; celui-ci
  // vit maintenant sur la page Budget, qui garde la sienne de son côté.
  dashboardMonnaieId: null,
  monnaieAffichageDefautId: undefined,
  // La monnaie du camembert « Répartition des avoirs », page Vue globale des
  // comptes. UNE TROISIÈME SÉLECTION, indépendante des deux autres : cette
  // page-là n'a pas d'onglet de monnaie (chaque carte montre tous ses soldes),
  // et le camembert est le seul de ses éléments qui doive en choisir une.
  comptesRepartitionMonnaieId: null,
  // Les six types d'opération (table `type_operation`) : le frontend ne déduit
  // plus le type d'une catégorie et d'un booléen, il le lit. `code` est la clé
  // technique stable ; `nom` n'est qu'un libellé, renommable par l'utilisateur.
  typesOperation: [],
  // Placements financiers : les titres suivis (table `titre_possede`, communs à tous
  // les comptes) et l'onglet de compte actuellement affiché.
  titres: [],
  placementCompteId: null,
  // L'ARBRE DE PÉRIODE (cf. « L'arbre de période du dashboard ») : `niveau` dit
  // ce que désigne la pastille (tout | annee | mois | semaine), `annee` / `mois` /
  // `semaine` sont les références, et `moisDeplie` / `semainesDeplie` les deux chevrons. `vue`
  // (tout | annee | mois) est DÉRIVÉ du niveau : c'est la seule chose que le
  // serveur, les objectifs et les monnaies connaissent — une semaine y est un
  // mois dont on regarde une tranche.
  dashboardPeriode: periodeInitialeDashboard(),
  // Les catégories DESSINÉES par l'histogramme et le camembert du dashboard —
  // `null` veut dire « toutes » (l'état par défaut, celui d'avant ce filtre).
  // Un Set de NOMS de catégorie, pas d'ids : c'est ce que porte chaque ligne
  // de `DepenseParCategorie` (cf. services/soldes.get_depenses_par_categorie).
  // Ne filtre QUE ce qui est dessiné. En vue « état actuel », le camembert
  // recalcule son dénominateur sur les seules catégories retenues — filtrer y
  // change la question posée. En vue « budget », le dénominateur est le budget
  // du mois : il ne bouge pas, et retirer une catégorie n'en gonfle aucune
  // autre (cf. partsCategoriesDashboard).
  dashboardCategoriesVisibles: null,
  // La vue du camembert : "actuel" (parts du total dépensé) ou "budget" (parts
  // du budget du mois). Jamais mémorisée d'une session à l'autre — cf.
  // basculerVuePie.
  dashboardVuePie: "actuel",
  // Le contexte d'un drill-through de catégorie vers la page Opérations, ou null
  // (cf. drillActif) : de quel onglet, quelle catégorie, quelles bornes.
  drillOperations: null,
  triSelections: {
    classique: "date-desc",
    remboursable: "date-desc",
    remboursements: "date-desc",
    virements: "date-desc",
    prets: "date-desc",
    "remboursement-prets": "date-desc",
  },
};

// Le tri d'une page Opérations qu'on vient d'ouvrir (et celui que « Réinitialiser »
// rend) : du plus récent au plus ancien, la date servant de séparateur de journée.
const TRI_PAR_DEFAUT_OPERATIONS = "date-desc";

const CATEGORIE_AUTRES = "Autres";
// La catégorie d'ENTRÉE livrée (cf. constants.CATEGORIE_ENTREES_ARGENT). Elle se
// renomme librement — c'est la case « catégorie d'entrée » qui la reconnaît,
// jamais son nom — mais elle ne se SUPPRIME pas : ses opérations basculeraient
// dans « Autres », donc du côté des dépenses.
const CATEGORIE_ENTREES_ARGENT = "Entrées d'argent";

// Types dont la catégorie est libre : les quatre autres n'en portent aucune,
// leur type EST leur classification (cf. constants.TYPES_AVEC_CATEGORIE_LIBRE).
const TYPES_CATEGORIE_LIBRE = new Set(["classique", "remboursable"]);
// Types pour lesquels `remboursable` vaut vrai (cf. constants.TYPES_REMBOURSABLES).
const TYPES_REMBOURSABLES = new Set(["remboursable", "pret"]);
// LES DEUX TYPES QUE COMMANDE L'EXTENSION « PRÊTS ».
//
// Leurs onglets et leurs boutons de type sont écrits dans index.html, masqués,
// et portent `data-extension="prets"` : le noyau les montre et les cache tout
// seul (cf. extensions.js::majVisibiliteNavigation). Cette liste-ci ne sert
// qu'aux menus construits en JS, que rien ne peut marquer d'un attribut.
//
// Le SCHÉMA, lui, reste au noyau : éteindre l'extension ferme la porte, elle ne
// supprime aucun prêt déjà saisi (cf. extensions/README.md).
const EXTENSION_PRETS = "prets";
const TYPES_DE_PRET = new Set(["pret", "remboursement_pret"]);

function pretsAccessibles() {
  return BudgetApp.extensions.estActive(EXTENSION_PRETS);
}

// MÊME PATRON, POUR LES DEUX TYPES QUE COMMANDE « SUIVI DES REMBOURSEMENTS ».
// `data-extension="suivi-remboursements"` couvre les boutons d'index.html ;
// cette liste sert aux mêmes menus construits en JS que TYPES_DE_PRET.
const EXTENSION_SUIVI_REMBOURSEMENTS = "suivi-remboursements";
const TYPES_A_SUIVI_REMBOURSEMENT = new Set(["remboursable", "remboursements"]);

function suiviRemboursementsAccessible() {
  return BudgetApp.extensions.estActive(EXTENSION_SUIVI_REMBOURSEMENTS);
}
// Type de dette que chaque type de règlement peut solder
// (cf. constants.CIBLE_PAR_TYPE_REGLEMENT).
const CIBLE_PAR_TYPE_REGLEMENT = {
  remboursements: "remboursable",
  remboursement_pret: "pret",
};

function typeOperationParCode(code) {
  return state.typesOperation.find((t) => t.code === code) || null;
}

function idTypeOperation(code) {
  const type = typeOperationParCode(code);
  return type ? type.id : null;
}

function codeTypeOperation(typeId) {
  const type = state.typesOperation.find((t) => t.id === typeId);
  return type ? type.code : null;
}

function libelleTypeOperation(code) {
  const type = typeOperationParCode(code);
  return type ? type.nom : code;
}

const TYPE_LABELS = {
  courant: "Compte courant",
  épargne: "Compte d'épargne",
  "placements financiers": "Compte de placements",
};

// Type de compte des comptes-titres (cf. constants.TYPE_COMPTE_PLACEMENT) :
// deux soldes à la fois, des espèces et un portefeuille.
const TYPE_COMPTE_PLACEMENT = "placements financiers";
// Comptes hors "budget courant" : ils ne reçoivent pas d'opération classique
// (cf. constants.TYPES_COMPTE_HORS_COURANT).
const TYPES_COMPTE_HORS_COURANT = new Set(["épargne", TYPE_COMPTE_PLACEMENT]);

/**
 * Le libellé d'un type de compte, TRADUIT.
 *
 * `TYPE_LABELS` transforme le nom technique de la table (« courant »,
 * « placements financiers ») en libellé d'écran ; `t()` le passe ensuite dans la
 * langue courante. Sans lui, « Compte d'épargne » restait en français dans toute
 * l'application anglaise — en-têtes de groupe, menus déroulants et cartes
 * compris, puisque tous passent par ici.
 *
 * UN TYPE CRÉÉ PAR L'UTILISATEUR traverse `t()` sans y trouver d'entrée et
 * ressort tel quel : c'est une donnée, elle ne se traduit pas.
 */
function typeLabel(value) {
  return t(TYPE_LABELS[value] || value);
}

function capitalizeFirst(text) {
  if (!text) return text;
  return text.charAt(0).toUpperCase() + text.slice(1);
}

// `value` est le statut tel que l'API l'écrit ("réel" / "prévisionnel") : une
// valeur d'énumération, pas une donnée saisie — elle se traduit.
function statutLabel(value) {
  return capitalizeFirst(t(value));
}

/* ---------- Le statut d'une opération, côté formulaire ----------
 *
 * UNE CASE, ET NON PLUS UN MENU À DEUX ENTRÉES. `Statut` n'a jamais eu que deux
 * valeurs — « réel » et « prévisionnel » — et un menu déroulant demandait deux
 * clics et une lecture pour répondre à une question binaire, en dehors de la
 * rangée où toutes les autres questions binaires du formulaire sont posées.
 *
 * RIEN NE CHANGE CÔTÉ SERVEUR : ces deux fonctions sont le seul endroit où la
 * case se traduit en statut, et l'unique raison de les écrire plutôt que de
 * lire `.checked` partout. Le jour où un troisième statut existerait, c'est ici
 * — et seulement ici — que le menu reviendrait.
 *
 * DÉCOCHÉE VAUT « RÉEL », le cas ordinaire : on saisit presque toujours ce qui
 * vient de se passer, prévoir est le geste particulier. */
function statutOperationSaisi() {
  return document.getElementById("operation-previsionnelle").checked
    ? STATUT_PREVISIONNEL
    : STATUT_REEL;
}

function poserStatutOperation(statut) {
  document.getElementById("operation-previsionnelle").checked = statut === STATUT_PREVISIONNEL;
}

/**
 * Noms de mois et de jours, dans la langue de l'interface.
 *
 * Construits par `Intl` plutôt que listés à la main : c'est le navigateur qui
 * connaît déjà les douze mois de chaque langue, et une seconde liste écrite ici
 * n'aurait fait que se désynchroniser de la première. Le nom du mois court est
 * tronqué à quatre lettres — l'anglais donne « Sept », le français « sept. »,
 * et les boutons de période veulent une largeur régulière.
 */
function nomsMois(style) {
  const format = new Intl.DateTimeFormat(langue(), { month: style });
  return Array.from({ length: 12 }, (_, i) => format.format(new Date(2026, i, 1)));
}

const MOIS_FR = nomsMois("long");

const MOIS_COURTS_FR = nomsMois("short").map((nom) =>
  capitalizeFirst(nom.replace(".", "").slice(0, 4))
);

/**
 * "2026-07-05" -> "05 Juil. 2026", le format des CELLULES.
 *
 * LE MOIS ABRÉGÉ parce qu'ici la date partage sa ligne avec tout le reste : une
 * colonne de « 15 Septembre 2026 » pousse la nature, le montant et le compte
 * vers la droite pour un mot que trois lettres suffisent à reconnaître. Le
 * format long reste celui des séparateurs de journée et des phrases, où la date
 * est le sujet.
 */
function formatDateCourte(isoDate) {
  const [annee, mois, jour] = isoDate.split("-").map(Number);
  return `${String(jour).padStart(2, "0")} ${MOIS_COURTS_FR[mois - 1]}. ${annee}`;
}

// "2026-07-05" -> "05 Juillet 2026"
function formatDate(isoDate) {
  const [annee, mois, jour] = isoDate.split("-").map(Number);
  const nomMois = MOIS_FR[mois - 1];
  return `${String(jour).padStart(2, "0")} ${capitalizeFirst(nomMois)} ${annee}`;
}

function libelleMois(annee, mois) {
  return `${capitalizeFirst(MOIS_FR[mois - 1])} ${annee}`;
}

// "2026-07-05T14:32:07" -> "05 Juillet 2026 14:32"
function formatDateHeure(isoDateTime) {
  const [datePart, timePart] = isoDateTime.split("T");
  const heure = timePart ? timePart.slice(0, 5) : "";
  return heure ? `${formatDate(datePart)} ${heure}` : formatDate(datePart);
}

// Cellule "reste à rembourser" à 3 états harmonisés entre Dépenses
// remboursables et Prêts reçus : jaune = rien reçu, orange = partiel,
// vert = soldé — comparé au montant dû fixe (montantDu), pas seulement à 0.
function resteCellEtRowClass(montantDu, montantARembourser, monnaieId) {
  if (montantARembourser <= 0) {
    return {
      cellHtml: `<span class="cellule-reste"><span class="badge-total">${t("Remboursé")}</span></span>`,
      rowClass: "tr-total",
    };
  }
  const rienRecu = Math.abs(montantARembourser - montantDu) < 1e-9;
  if (rienRecu) {
    return {
      cellHtml: `<span class="cellule-reste">${formatMontant(montantARembourser, monnaieId)} <span class="badge-aucun">${t("En attente")}</span></span>`,
      rowClass: "tr-aucun",
    };
  }
  return {
    cellHtml: `<span class="cellule-reste">${formatMontant(montantARembourser, monnaieId)} <span class="badge-partiel">En cours</span></span>`,
    rowClass: "tr-partiel",
  };
}

/* ---------- Navigation dans l'arborescence des filtres (année ↔ mois) ---------- */

/**
 * La période sur laquelle une page s'ouvre : LE MOIS COURANT, et le plus récent
 * disponible seulement s'il manque à la liste.
 *
 * Auparavant c'était toujours le plus récent, ce qui revenait au même tant que
 * les onglets s'arrêtaient au mois en cours. Depuis qu'une dépense amortie
 * ouvre les mois de son étalement, le plus récent peut être à des mois dans le
 * futur : l'app s'ouvrait sur février 2027 devant un tableau vide. Le mois
 * courant est toujours proposé par /meta/periodes, le repli ne sert donc qu'aux
 * bases dont toutes les opérations sont antérieures et dont l'horloge aurait
 * changé d'année en cours de session.
 */
function periodeParDefaut(periodes) {
  const aujourdhui = new Date();
  const annee = aujourdhui.getFullYear();
  const mois = aujourdhui.getMonth() + 1;
  return periodes.find((p) => p.annee === annee && p.mois === mois) || periodes[0];
}

/* ---------- L'ARBRE DE PÉRIODE DU DASHBOARD : Tout > année > mois > semaines ----------
 *
 * QUATRE NIVEAUX, UNE SEULE PASTILLE. `etat.niveau` dit lequel pilote le
 * dashboard — c'est la pastille bleue de la ligne correspondante. `annee`,
 * `mois` et `semaine` sont des RÉFÉRENCES : l'année et le mois à partir
 * desquels le niveau actif se lit. Tant qu'on était sur deux niveaux, les deux
 * notions se confondaient et on ne savait plus dire pourquoi un clic en changeait
 * un sans toucher à l'autre.
 *
 * LES TROIS GESTES, ET RIEN D'AUTRE (cf. `transitionPeriode`) :
 *   - cliquer un élément PLUS BAS que la pastille (une semaine alors qu'elle est
 *     sur le mois) fait DESCENDRE la pastille dessus ;
 *   - cliquer un élément PLUS HAUT (une autre année alors qu'elle est sur le
 *     mois) ne change QUE la référence : la pastille reste où elle est ;
 *   - cliquer la PASTILLE d'une ligne y amène le niveau. Vers le haut, la
 *     référence est gardée ; vers le bas, on arrive sur le mois ou la semaine EN
 *     COURS — c'est ce que « descendre » veut dire quand on n'a rien choisi.
 *
 * LES CHEVRONS DÉPLIENT, ILS NE FILTRENT PAS : l'un montre les mois sous l'année,
 * l'autre les semaines sous le mois. Replier une ligne qui porte la pastille la
 * remonte d'un cran — on ne reste pas coincé sur un niveau qu'on ne voit plus.
 *
 * `vue` EST CE QUE LE SERVEUR CONNAÎT (« tout », « annee », « mois ») : la semaine
 * n'est pas une vue de plus, c'est un mois dont on regarde une tranche, et le
 * reste de l'application (objectifs, monnaies, conversion) n'a pas à le savoir.
 */
const NIVEAUX_PERIODE = ["tout", "annee", "mois", "semaine"];

function rangNiveauPeriode(niveau) {
  return NIVEAUX_PERIODE.indexOf(niveau);
}

function vueDuNiveau(niveau) {
  return niveau === "semaine" ? "mois" : niveau;
}

/**
 * Les semaines d'un mois, découpées comme le fait le serveur
 * (soldes.semaines_du_mois) : du lundi au dimanche, coupées aux bords du mois.
 * Recalculées ici parce qu'un geste doit savoir quelle est la semaine EN COURS
 * sans attendre une réponse.
 */
function semainesDuMoisLocal(annee, mois) {
  const dernier = new Date(annee, mois, 0).getDate();
  const semaines = [];
  let debut = 1;
  while (debut <= dernier) {
    const jourSemaine = (new Date(annee, mois - 1, debut).getDay() + 6) % 7; // lundi = 0
    const fin = Math.min(debut + (6 - jourSemaine), dernier);
    semaines.push({ numero: semaines.length + 1, debut, fin });
    debut = fin + 1;
  }
  return semaines;
}

function rangSemaineDuJour(annee, mois, jour) {
  const semaine = semainesDuMoisLocal(annee, mois).find((s) => s.debut <= jour && jour <= s.fin);
  return semaine ? semaine.numero : 1;
}

function periodeInitialeDashboard() {
  return {
    niveau: "mois",
    vue: "mois",
    annee: null,
    mois: null,
    semaine: null,
    // Le dashboard s'ouvre sur le mois : sa ligne doit être là, sans quoi la
    // pastille bleue n'aurait aucune ligne où se poser.
    moisDeplie: true,
    semainesDeplie: false,
  };
}

/**
 * L'état suivant, pour un geste. PURE : aucun accès au DOM ni au réseau, pour
 * qu'on puisse la vérifier seule.
 *
 * `contexte` : `aujourdhui` (un Date) et `moisDisponibles(annee)`, les mois qui
 * portent des opérations.
 */
function transitionPeriode(etat, geste, contexte) {
  const suivant = { ...etat };
  const { aujourdhui, moisDisponibles } = contexte;
  const rang = () => rangNiveauPeriode(suivant.niveau);

  switch (geste.type) {
    case "annee": {
      suivant.annee = geste.annee;
      const dispo = moisDisponibles(geste.annee);
      if (dispo.length && !dispo.includes(suivant.mois)) suivant.mois = dispo[dispo.length - 1];
      // « Tout » est plus haut que l'année : l'année choisie fait descendre.
      if (suivant.niveau === "tout") suivant.niveau = "annee";
      break;
    }
    case "mois":
      suivant.mois = geste.mois;
      if (rang() < rangNiveauPeriode("mois")) suivant.niveau = "mois";
      break;
    case "semaine":
      suivant.semaine = geste.semaine;
      suivant.niveau = "semaine";
      break;
    case "pastille": {
      const cible = rangNiveauPeriode(geste.niveau);
      if (cible === rang()) break;
      if (cible > rang() && (geste.niveau === "mois" || geste.niveau === "semaine")) {
        // DESCENDRE PAR LA PASTILLE amène sur le mois et la semaine EN COURS.
        suivant.annee = aujourdhui.getFullYear();
        suivant.mois = aujourdhui.getMonth() + 1;
        suivant.semaine = rangSemaineDuJour(suivant.annee, suivant.mois, aujourdhui.getDate());
      }
      suivant.niveau = geste.niveau;
      break;
    }
    case "deplier":
      if (geste.ligne === "mois") {
        suivant.moisDeplie = !etat.moisDeplie;
        if (!suivant.moisDeplie) {
          suivant.semainesDeplie = false;
          // La ligne qui porte la pastille se replie : elle remonte d'un cran.
          if (rang() >= rangNiveauPeriode("mois")) suivant.niveau = "annee";
        }
      } else {
        suivant.semainesDeplie = !etat.semainesDeplie;
        if (suivant.semainesDeplie) suivant.moisDeplie = true;
        else if (suivant.niveau === "semaine") suivant.niveau = "mois";
      }
      break;
  }

  // Les invariants, une fois pour toutes.
  suivant.vue = vueDuNiveau(suivant.niveau);
  if (rang() >= rangNiveauPeriode("mois")) suivant.moisDeplie = true;
  if (suivant.niveau === "semaine") {
    suivant.semainesDeplie = true;
    const nombre = semainesDuMoisLocal(suivant.annee, suivant.mois).length;
    suivant.semaine = Math.min(Math.max(suivant.semaine || 1, 1), nombre);
  }
  return suivant;
}

// Les périodes qui portent des opérations (`/meta/periodes`), triées par
// (année, mois) décroissant. Lues une fois par ouverture du dashboard.
let dashboardPeriodesConnues = [];

function moisDisponiblesDashboard(annee) {
  return dashboardPeriodesConnues
    .filter((p) => p.annee === annee)
    .map((p) => p.mois)
    .sort((a, b) => a - b);
}

/** Ce qui change les DONNÉES du serveur : changer de semaine ne relit rien. */
function cleDonneesPeriode(etat) {
  if (etat.vue === "tout") return "tout";
  if (etat.vue === "annee") return `annee:${etat.annee}`;
  return `mois:${etat.annee}-${etat.mois}`;
}

async function appliquerGestePeriode(geste) {
  const avant = { ...state.dashboardPeriode };
  const apres = transitionPeriode(avant, geste, {
    aujourdhui: new Date(),
    moisDisponibles: moisDisponiblesDashboard,
  });
  Object.assign(state.dashboardPeriode, apres);
  renderArbrePeriode();
  if (cleDonneesPeriode(avant) !== cleDonneesPeriode(apres)) {
    await loadDashboardData(apres.annee, apres.mois);
  } else {
    await majDetailSemaines(apres.annee, apres.mois);
  }
}

/* ---------- L'ARBRE DE PÉRIODE, AILLEURS QU'AU DASHBOARD ----------
 *
 * LE MÊME SÉLECTEUR, SANS LES SEMAINES : la page Budget et les fenêtres (détail d'une
 * monnaie éteinte, frais) choisissent leur période comme le dashboard — Tout, l'année, le
 * mois, une pastille sur le niveau actif — plutôt qu'avec deux listes déroulantes. Un même
 * geste se fait de la même façon partout.
 *
 * MÊME LOGIQUE (`transitionPeriode`), MÊMES CLASSES. Ce qui change :
 *   - `annees()` et `moisDisponibles(annee)` disent ce qu'on peut choisir (la page Budget
 *     propose les douze mois, une fenêtre seulement ceux qui ont des opérations) ;
 *   - `avecTout` : la ligne « Tout » existe ou non ;
 *   - `niveauFixe` : le niveau ne bouge pas (les budgets de catégorie parlent d'un MOIS) —
 *     les pastilles disparaissent alors, l'année et le mois restent cliquables.
 *
 * `etat` ({niveau, vue, annee, mois, moisDeplie}) est modifié EN PLACE ; `surChangement`
 * est appelé après chaque geste, avec l'état d'avant.
 */
function creerArbrePeriode(
  hote,
  { etat, annees, moisDisponibles, avecTout = true, niveauFixe = null, surChangement }
) {
  hote.innerHTML = "";
  const cadre = document.createElement("div");
  cadre.className = "periode-selecteur periode-selecteur-arbre periode-arbre-simple";
  const racine = document.createElement("div");
  racine.className = "periode-arbre";
  racine.setAttribute("role", "radiogroup");
  cadre.appendChild(racine);
  hote.appendChild(cadre);

  const normaliser = () => {
    if (niveauFixe) etat.niveau = niveauFixe;
    if (!avecTout && etat.niveau === "tout") etat.niveau = "annee";
    const liste = annees();
    if (liste.length && !liste.includes(etat.annee)) etat.annee = liste[0];
    const dispo = moisDisponibles(etat.annee);
    if (dispo.length && !dispo.includes(etat.mois)) etat.mois = dispo[dispo.length - 1];
    etat.vue = vueDuNiveau(etat.niveau);
    if (rangNiveauPeriode(etat.niveau) >= rangNiveauPeriode("mois")) etat.moisDeplie = true;
  };

  const geste = (g) => {
    const avant = { ...etat };
    const apres = transitionPeriode(
      { ...etat, semaine: null, semainesDeplie: false },
      g,
      { aujourdhui: new Date(), moisDisponibles }
    );
    Object.assign(etat, {
      niveau: apres.niveau,
      annee: apres.annee,
      mois: apres.mois,
      moisDeplie: apres.moisDeplie,
    });
    normaliser();
    rendre();
    surChangement(etat, avant);
  };

  const bouton = (texte, actif, onClick, classe = "") => {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = texte;
    if (classe) b.className = classe;
    if (actif) b.classList.add("active");
    b.addEventListener("click", onClick);
    return b;
  };

  const ligne = (niveau, contenu, chevronEl = null) => {
    const l = document.createElement("div");
    l.className = `periode-ligne periode-ligne-${niveau}`;
    const pastille = document.createElement("button");
    pastille.type = "button";
    pastille.className = "periode-pastille";
    pastille.setAttribute("role", "radio");
    const active = etat.niveau === niveau;
    pastille.setAttribute("aria-checked", String(active));
    if (active) pastille.classList.add("active");
    pastille.title = t(LIBELLES_NIVEAU_PERIODE[niveau]);
    pastille.setAttribute("aria-label", pastille.title);
    pastille.addEventListener("click", () => geste({ type: "pastille", niveau }));
    // UN NIVEAU FIXE n'a rien à choisir : seule la pastille de SON niveau se montre (allumée,
    // comme au dashboard, pour dire ce que la page regarde), sans rien à cliquer. Les autres
    // gardent leur place, vide, pour que les lignes gardent l'alignement du dashboard.
    if (niveauFixe) {
      if (niveau === niveauFixe) {
        pastille.classList.add("periode-pastille-fixe");
        pastille.setAttribute("aria-disabled", "true");
        pastille.tabIndex = -1;
        pastille.title = t(LIBELLES_NIVEAU_PERIODE[niveau]);
      } else {
        pastille.style.visibility = "hidden";
      }
    }
    l.appendChild(pastille);
    const emplacement = document.createElement("span");
    emplacement.className = "periode-chevron-place";
    if (chevronEl) emplacement.appendChild(chevronEl);
    l.appendChild(emplacement);
    l.appendChild(contenu);
    racine.appendChild(l);
  };

  function rendre() {
    racine.innerHTML = "";
    if (avecTout) {
      const tout = document.createElement("div");
      tout.className = "sous-onglets";
      tout.appendChild(
        bouton(t("Tout"), etat.niveau === "tout", () => geste({ type: "pastille", niveau: "tout" }), "periode-tout")
      );
      ligne("tout", tout);
    }
    const contenuAnnees = document.createElement("div");
    contenuAnnees.className = "sous-onglets";
    annees().forEach((a) => {
      contenuAnnees.appendChild(
        bouton(String(a), a === etat.annee && etat.niveau !== "tout", () => geste({ type: "annee", annee: a }))
      );
    });
    let chevronEl = null;
    if (!niveauFixe) {
      chevronEl = document.createElement("button");
      chevronEl.type = "button";
      chevronEl.className = "periode-chevron";
      chevronEl.innerHTML = etat.moisDeplie ? ICONE_CHEVRON_HAUT : ICONE_CHEVRON_BAS;
      chevronEl.setAttribute("aria-expanded", String(!!etat.moisDeplie));
      chevronEl.title = etat.moisDeplie ? t("Replier les mois") : t("Détailler par mois");
      chevronEl.setAttribute("aria-label", chevronEl.title);
      chevronEl.addEventListener("click", () => geste({ type: "deplier", ligne: "mois" }));
    }
    ligne("annee", contenuAnnees, chevronEl);
    if (etat.moisDeplie || niveauFixe) {
      const contenuMois = document.createElement("div");
      contenuMois.className = "sous-onglets sous-onglets-mois";
      moisDisponibles(etat.annee).forEach((m) => {
        contenuMois.appendChild(
          bouton(MOIS_COURTS_FR[m - 1], m === etat.mois && etat.niveau === "mois", () =>
            geste({ type: "mois", mois: m })
          )
        );
      });
      ligne("mois", contenuMois);
    }
  }

  normaliser();
  rendre();
  return { rendre: () => { normaliser(); rendre(); } };
}

const LIBELLES_NIVEAU_PERIODE = {
  tout: "Afficher tout l'historique",
  annee: "Afficher l'année",
  mois: "Afficher le mois",
  semaine: "Afficher la semaine",
};

/**
 * Dessine l'arbre d'après `state.dashboardPeriode`, et rien d'autre. Appelée à
 * chaque geste et à chaque chargement : le DOM est une image de l'état, jamais
 * l'inverse.
 */
function renderArbrePeriode() {
  const racine = document.getElementById("dashboard-periode-arbre");
  if (!racine) return;
  const p = state.dashboardPeriode;
  racine.innerHTML = "";

  const bouton = (texte, { actif = false, classe = "", titre = "", onClick }) => {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = texte;
    if (classe) b.className = classe;
    if (actif) b.classList.add("active");
    if (titre) b.title = titre;
    b.addEventListener("click", onClick);
    return b;
  };

  const pastille = (niveau, libelle) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "periode-pastille";
    b.setAttribute("role", "radio");
    const active = p.niveau === niveau;
    b.setAttribute("aria-checked", String(active));
    if (active) b.classList.add("active");
    b.title = libelle;
    b.setAttribute("aria-label", libelle);
    b.addEventListener("click", () => appliquerGestePeriode({ type: "pastille", niveau }));
    return b;
  };

  const chevron = (ligneCible, ouvert, libelleOuvrir, libelleReplier) => {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "periode-chevron";
    b.innerHTML = ouvert ? ICONE_CHEVRON_HAUT : ICONE_CHEVRON_BAS;
    b.setAttribute("aria-expanded", String(ouvert));
    b.title = ouvert ? libelleReplier : libelleOuvrir;
    b.setAttribute("aria-label", b.title);
    b.addEventListener("click", () => appliquerGestePeriode({ type: "deplier", ligne: ligneCible }));
    return b;
  };

  const ligne = (niveau, { chevronEl = null, contenu }) => {
    const l = document.createElement("div");
    l.className = `periode-ligne periode-ligne-${niveau}`;
    l.dataset.niveau = niveau;
    l.appendChild(pastille(niveau, t(LIBELLES_NIVEAU_PERIODE[niveau])));
    // Un emplacement fixe pour le chevron, vide ou non : les pastilles restent
    // alignées d'une ligne à l'autre.
    const emplacement = document.createElement("span");
    emplacement.className = "periode-chevron-place";
    if (chevronEl) emplacement.appendChild(chevronEl);
    l.appendChild(emplacement);
    l.appendChild(contenu);
    racine.appendChild(l);
  };

  // --- Tout ---
  const contenuTout = document.createElement("div");
  contenuTout.className = "sous-onglets";
  contenuTout.appendChild(
    bouton(t("Tout"), {
      actif: p.niveau === "tout",
      classe: "periode-tout",
      titre: t("Toutes les périodes, sans borne de date"),
      onClick: () => appliquerGestePeriode({ type: "pastille", niveau: "tout" }),
    })
  );
  ligne("tout", { contenu: contenuTout });

  // --- Années ---
  const annees = [...new Set(dashboardPeriodesConnues.map((x) => x.annee))].sort((a, b) => b - a);
  const contenuAnnees = document.createElement("div");
  contenuAnnees.className = "sous-onglets";
  annees.forEach((a) => {
    contenuAnnees.appendChild(
      bouton(String(a), {
        actif: a === p.annee,
        onClick: () => appliquerGestePeriode({ type: "annee", annee: a }),
      })
    );
  });
  ligne("annee", {
    chevronEl: chevron("mois", p.moisDeplie, t("Détailler par mois"), t("Replier les mois")),
    contenu: contenuAnnees,
  });

  // --- Mois (de l'année de référence) ---
  if (p.moisDeplie) {
    const contenuMois = document.createElement("div");
    contenuMois.className = "sous-onglets sous-onglets-mois";
    moisDisponiblesDashboard(p.annee).forEach((m) => {
      contenuMois.appendChild(
        bouton(MOIS_COURTS_FR[m - 1], {
          actif: m === p.mois,
          onClick: () => appliquerGestePeriode({ type: "mois", mois: m }),
        })
      );
    });
    ligne("mois", {
      chevronEl: chevron(
        "semaines",
        p.semainesDeplie,
        t("Détailler par semaine"),
        t("Replier les semaines")
      ),
      contenu: contenuMois,
    });
  }

  // --- Semaines (du mois de référence) ---
  if (p.moisDeplie && p.semainesDeplie) {
    const contenuSemaines = document.createElement("div");
    contenuSemaines.className = "sous-onglets sous-onglets-mois";
    // Les JOURS et non « S1 » : c'est la date qu'on a en tête en cherchant un
    // achat, pas le rang de la semaine dans le mois.
    semainesDuMoisLocal(p.annee, p.mois).forEach((s) => {
      contenuSemaines.appendChild(
        bouton(`${s.debut} → ${s.fin}`, {
          actif: p.niveau === "semaine" && p.semaine === s.numero,
          onClick: () => appliquerGestePeriode({ type: "semaine", semaine: s.numero }),
        })
      );
    });
    ligne("semaine", { contenu: contenuSemaines });
  }
}

// Le symbole vient de la table `monnaie` (saisi par l'utilisateur, pas un code
// ISO) : on formate le nombre à la française et on accole le symbole, plutôt
// que d'utiliser `style: "currency"` qui exigerait un code ISO valide.
const FORMAT_NOMBRE = new Intl.NumberFormat("fr-FR", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

function monnaieParId(monnaieId) {
  return state.monnaies.find((m) => m.id === monnaieId) || null;
}

// « Aucune monnaie » à passer à formatMontant : le montant s'écrit nu, sans le
// repli sur la première monnaie de l'app (cf. symboleMonnaie).
const SANS_MONNAIE = "sans-monnaie";

function symboleMonnaie(monnaieId) {
  if (monnaieId === SANS_MONNAIE) return "";
  const monnaie = monnaieParId(monnaieId);
  // À défaut (monnaie inconnue, ou montant dont la monnaie n'est pas encore
  // connue — un aperçu d'import avant choix du compte), la première monnaie de
  // l'app fait office de repère plutôt qu'un montant nu.
  return monnaie ? monnaie.symbole : state.monnaies[0] ? state.monnaies[0].symbole : "";
}

/**
 * Un montant, dans sa monnaie.
 *
 * UN ZÉRO N'A JAMAIS DE SIGNE. Un solde qui tombe juste vaut rarement zéro tout
 * rond : c'est un −1,1e−13 sorti d'une soustraction de flottants, et
 * `Intl.NumberFormat` l'écrit alors « −0,00 € ». Le chiffre était juste et sa
 * lecture fausse — on croit voir une dette d'un centime arrondie. Tout ce qui
 * arrondit à zéro est donc ramené à zéro AVANT le formatage, une bonne fois
 * pour toutes : ce garde-fou existait déjà pour la couleur (cf. montantEstNul)
 * et pour le signe des opérations, il manquait au nombre lui-même.
 */
function formatMontant(valeur, monnaieId) {
  const symbole = symboleMonnaie(monnaieId);
  const nombre = FORMAT_NOMBRE.format(montantEstNul(valeur) ? 0 : valeur);
  return symbole ? `${nombre} ${symbole}` : nombre;
}

// Un pourcentage, à la française et sans décimale inutile : « 12,4 % », mais
// « 15 % » et non « 15,0 % ».
//
// POURQUOI PAS `FORMAT_NOMBRE` : il impose deux décimales, ce qu'il faut à un
// montant (les centimes existent) et jamais à une part. Un camembert dont
// chaque tranche annonce « 12,40 % » donne à lire quatre chiffres là où deux
// suffisent, et la précision affichée y ferait croire à une exactitude que
// l'arrondi des montants sous-jacents n'a pas.
const FORMAT_POURCENTAGE = new Intl.NumberFormat("fr-FR", {
  minimumFractionDigits: 0,
  maximumFractionDigits: 1,
});

function formatPourcentage(valeur) {
  return `${FORMAT_POURCENTAGE.format(valeur || 0)} %`;
}

// Poubelle au trait, dessinée en SVG plutôt qu'en emoji : elle hérite de la
// couleur du texte (donc du survol) et reste nette à toute taille, là où 🗑
// impose ses propres couleurs et varie d'une plateforme à l'autre.
const ICONE_POUBELLE = `
  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor"
       stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="M3 6h18" />
    <path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2" />
    <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
    <path d="M10 11v6" />
    <path d="M14 11v6" />
  </svg>
`;

// Loupe et chevrons de la recherche. Même famille que la poubelle ci-dessus — viewBox 24, trait de 2, bouts arrondis, `currentColor` — pour que
// la barre du haut ne soit pas le seul endroit de l'app à porter un emoji, dont
// la couleur et le dessin changent d'une plateforme à l'autre. En gris (la
// couleur vient du bouton, cf. `.recherche button`), comme les deux autres.
const ICONE_LOUPE = `
  <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor"
       stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <circle cx="11" cy="11" r="7" />
    <path d="M20 20l-3.6-3.6" />
  </svg>
`;

// Chevrons de navigation entre correspondances : un simple V, tracé au même
// trait que le reste, plutôt qu'une flèche pleine — deux boutons qu'on clique
// en rafale doivent rester discrets.
// Deux flèches en boucle : relire le fichier avec la configuration du moment.
// Même famille de tracé que les autres pictogrammes du noyau, donc même
// héritage de couleur.
const ICONE_RELIRE = `
  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor"
       stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="M21 12a9 9 0 0 1-9 9 9 9 0 0 1-7.7-4.3" />
    <path d="M3 12a9 9 0 0 1 9-9 9 9 0 0 1 7.7 4.3" />
    <path d="M20 3v5h-5" />
    <path d="M4 21v-5h5" />
  </svg>
`;

const ICONE_CHEVRON_HAUT = `
  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor"
       stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="M6 15l6-6 6 6" />
  </svg>
`;

const ICONE_CHEVRON_BAS = `
  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor"
       stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="M6 9l6 6 6-6" />
  </svg>
`;

// Échappement pour toute valeur insérée via innerHTML qui ne vient pas de
// l'app elle-même — typiquement le contenu brut d'un fichier importé, sur
// lequel on n'a aucune garantie (un libellé bancaire peut contenir < ou &).
/**
 * Le bouton ÉPINGLE d'une carte (projet, objectif) : épinglé, la carte se pose sous les graphes du
 * dashboard. Un bouton à bascule (`aria-pressed`), peint en accent quand c'est le cas ; `attributs`
 * porte ce qui permet au parent de le retrouver (`data-…="id"`). Le pictogramme est celui de
 * `img/pin-svgrepo-com.svg`, repris en masque pour suivre la couleur du thème.
 */
function epingleHtml(epingle, attributs) {
  const texte = epingle ? t("Retirer du dashboard") : t("Épingler au dashboard");
  return `<button type="button" class="epingle ${epingle ? "epingle-actif" : ""}" ${attributs}
      aria-pressed="${Boolean(epingle)}" title="${escapeHtml(texte)}" aria-label="${escapeHtml(texte)}"></button>`;
}

function escapeHtml(valeur) {
  return String(valeur ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * UN MONTANT NUL N'EST NI POSITIF NI NÉGATIF.
 *
 * La couleur d'un montant dit une direction : vert l'argent entre, orange il
 * sort, rouge le solde est dans le rouge. Zéro ne va nulle part — le peindre
 * en vert parce qu'il n'est « pas négatif » raconte quelque chose qui n'est pas
 * là, et fait lire une bonne nouvelle dans une ligne qui n'en porte aucune.
 *
 * LE DEMI-CENTIME comme seuil, et non l'égalité stricte : c'est ce que
 * l'affichage arrondit. Un solde à 0,001 € s'écrit « 0,00 € » et doit donc être
 * traité comme un zéro — sans quoi la couleur contredirait le chiffre.
 */
const EPSILON_MONTANT = 0.005;

function montantEstNul(valeur) {
  return Math.abs(Number(valeur) || 0) < EPSILON_MONTANT;
}

/**
 * La classe de couleur d'un montant : celle du signe, ou `montant-nul`.
 *
 * `signe` est la classe voulue quand le montant n'est pas nul. Passer par ici
 * plutôt que d'écrire le ternaire sur place, pour que la règle soit énoncée à
 * un seul endroit — elle vaut pour un solde de compte comme pour une
 * plus-value latente.
 */
function classeMontant(valeur, signe) {
  return montantEstNul(valeur) ? "montant-nul" : signe;
}

// Montant d'une opération dans les listes : coloré selon le sens de l'argent
// (vert = entre, orange = sort, neutre = virement interne), signé pour lever
// toute ambiguïté même en scan rapide.
function montantHtml(montant, sens, monnaieId) {
  // ZÉRO N'A PAS DE SIGNE non plus : « +0,00 € » se lit comme une entrée, et
  // c'est précisément ce qu'on veut cesser de dire.
  if (montantEstNul(montant)) {
    return `<span class="montant montant-nul">${formatMontant(montant, monnaieId)}</span>`;
  }
  if (sens === "entrée") {
    return `<span class="montant entree">+${formatMontant(montant, monnaieId)}</span>`;
  }
  if (sens === "dépense") {
    return `<span class="montant sortie">−${formatMontant(montant, monnaieId)}</span>`;
  }
  return `<span class="montant neutre">${formatMontant(montant, monnaieId)}</span>`;
}

// Toasts empilés en bas à droite (façon apps modernes) : plusieurs messages
// peuvent coexister sans s'écraser, et ils ne décalent pas la mise en page.
/**
 * Fait disparaître un message, animation comprise.
 *
 * LE `setTimeout` DE SECOURS N'EST PAS UNE CEINTURE ET BRETELLES : un
 * `animationend` qui n'arrive jamais laisse le message à l'écran POUR TOUJOURS,
 * et c'est exactement ce qui se passe quand l'animation ne joue pas — onglet en
 * arrière-plan au moment où elle démarre, `prefers-reduced-motion`, fenêtre
 * masquée. Le message finit par s'accumuler avec les suivants, et l'écran garde
 * des nouvelles vieilles d'une heure. Le délai vaut un peu plus que l'animation
 * (250 ms) : ce qui se termine normalement est déjà parti quand il expire.
 */
function fermerMessage(toast) {
  if (toast.dataset.ferme) return;
  toast.dataset.ferme = "1";
  toast.classList.add("sortant");
  toast.addEventListener("animationend", () => toast.remove());
  setTimeout(() => toast.remove(), 400);
}

function showMessage(text, type, { persistent = false } = {}) {
  const container = document.getElementById("toast-container");
  const toast = document.createElement("div");
  toast.className = `toast ${type}`;

  // UNE CROIX, ET PAS SEULEMENT UNE SURFACE CLIQUABLE. Le message se fermait
  // déjà d'un clic n'importe où, mais rien ne le disait : devant un message qui
  // reste (les persistants le font exprès), on attend qu'il parte au lieu de
  // penser à cliquer dessus. La croix rend visible ce qui existait.
  const fermer = document.createElement("button");
  fermer.type = "button";
  fermer.className = "toast-fermer";
  fermer.textContent = "×";
  fermer.title = t("Fermer ce message");
  fermer.setAttribute("aria-label", fermer.title);
  fermer.addEventListener("click", (e) => {
    e.stopPropagation();
    fermerMessage(toast);
  });
  toast.appendChild(fermer);

  const texte = document.createElement("span");
  // Dernier filet pour les messages VENUS DU SERVEUR : ceux de l'app sont déjà
  // passés par `t()` à l'appel (une seconde traduction ne trouve rien et laisse
  // le texte tel quel), mais une erreur d'API arrive ici en français brut, sans
  // que l'appelant sache seulement ce qu'elle dit (cf. apiFetch, qui la relaie).
  texte.textContent = traduireMessageServeur(text);
  toast.appendChild(texte);

  toast.addEventListener("click", () => fermerMessage(toast));
  container.appendChild(toast);
  if (!persistent) {
    setTimeout(() => fermerMessage(toast), 4500);
  }
}

async function apiFetch(path, options = {}) {
  const opts = { ...options };
  if (opts.body) {
    opts.headers = { "Content-Type": "application/json", ...(opts.headers || {}) };
  }
  const res = await fetch(path, opts);
  if (res.status === 204) return null;
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const detail = data && data.detail ? data.detail : `Erreur ${res.status}`;
    const message = Array.isArray(detail)
      ? detail.map((d) => d.msg.replace(/^Value error,\s*/, "")).join(", ")
      : detail;
    throw new Error(message);
  }
  return data;
}

/* ---------- Les rangements d'écran (PreferenceInterface, migration 0069) ----------
 *
 * LA RÈGLE, ET ELLE VAUT POUR TOUT CE QUI VIENDRA APRÈS : ce qui désigne des
 * IDENTIFIANTS de la base vit DANS la base ; ce qui décrit le POSTE reste dans
 * le `localStorage`.
 *
 * Les dossiers de la galerie des règles rangent des règles PAR LEUR ID, l'ordre
 * des colonnes de correspondances range des catégories par leur id, le preset
 * d'import mémorisé EST un id. Aucun des trois ne veut dire quoi que ce soit
 * hors de la base qui porte ces lignes : le même rangement appliqué à une autre
 * base désigne d'autres règles, ou aucune, et une base emportée sur un second
 * poste arrive sans son rangement alors qu'elle porte les lignes rangées. Le
 * thème, la langue, la touche qui fige l'infobulle et la progression d'un
 * tutoriel, eux, décrivent une habitude de poste et restent là où ils sont.
 *
 * DEUX ROUTES ET RIEN DE PLUS, parce que le serveur ne lit jamais ce qu'il
 * range : l'écran lit tout d'un coup et réécrit tout d'un coup.
 *
 * JAMAIS DE LEVÉE. Un rangement d'écran qui échoue ne doit pas emporter la page
 * qui l'appelle : `lirePreference` rend `null` (indistinguable, pour l'appelant,
 * d'une clé jamais écrite) et `ecrirePreference` rend `false`. Perdre un
 * rangement est un désagrément ; perdre l'écran qui le portait en est un autre.
 */
async function lirePreference(cle) {
  try {
    const reponse = await apiFetch(`/preferences/${encodeURIComponent(cle)}`);
    return reponse ? reponse.valeur : null;
  } catch (err) {
    console.warn(`Rangement « ${cle} » illisible :`, err);
    return null;
  }
}

async function ecrirePreference(cle, valeur) {
  try {
    await apiFetch(`/preferences/${encodeURIComponent(cle)}`, {
      method: "PUT",
      body: JSON.stringify({ valeur }),
    });
    return true;
  } catch (err) {
    console.warn(`Rangement « ${cle} » non enregistré :`, err);
    return false;
  }
}

/**
 * Le contenu d'une ancienne clé de `localStorage`, à reprendre UNE FOIS puis à
 * effacer.
 *
 * CE QUI SE PASSE À LA PREMIÈRE OUVERTURE APRÈS LA MIGRATION. Le rangement
 * existe encore sur le poste et pas encore en base : le reprendre évite de
 * demander à l'utilisateur de refaire des dossiers qu'il avait déjà faits. On
 * l'efface dans la foulée, sinon il reviendrait écraser, à chaque ouverture, le
 * rangement qu'on aurait modifié depuis.
 *
 * SEULEMENT SI LA BASE N'A RIEN — « rien rangé » (`null`) et « rangé, puis
 * vidé » (un objet vide) ne sont pas la même chose, faute de quoi vider ses
 * dossiers les ferait réapparaître au chargement suivant.
 */
function reprendreDuLocalStorage(cleLocale) {
  try {
    const brut = localStorage.getItem(cleLocale);
    if (brut === null) return null;
    localStorage.removeItem(cleLocale);
    return JSON.parse(brut);
  } catch (err) {
    // Contenu illisible, ou stockage indisponible : il n'y a rien à reprendre,
    // et surtout rien à casser pour si peu.
    console.warn(`Ancien rangement « ${cleLocale} » illisible :`, err);
    return null;
  }
}

// Variante multipart (upload de fichier) : pas de Content-Type manuel, le
// navigateur fixe lui-même la frontière du formulaire.
async function apiFetchForm(path, formData) {
  const res = await fetch(path, { method: "POST", body: formData });
  const data = await res.json().catch(() => null);
  if (!res.ok) {
    const detail = data && data.detail ? data.detail : `Erreur ${res.status}`;
    const message = Array.isArray(detail)
      ? detail.map((d) => d.msg.replace(/^Value error,\s*/, "")).join(", ")
      : detail;
    throw new Error(typeof message === "string" ? message : JSON.stringify(message));
  }
  return data;
}

function fillSelect(selectEl, values, { keepFirst = false, labels = null } = {}) {
  const firstOption = keepFirst ? selectEl.firstElementChild : null;
  selectEl.innerHTML = "";
  if (firstOption) selectEl.appendChild(firstOption);
  values.forEach((v) => {
    const opt = document.createElement("option");
    opt.value = typeof v === "object" ? v.value : v;
    opt.textContent = labels ? labels(v) : typeof v === "object" ? v.label : v;
    selectEl.appendChild(opt);
  });
}

/**
 * Un menu de comptes, GROUPÉ PAR TYPE — partout où l'on choisit un compte.
 *
 * Les comptes se lisent groupés par type dans tout le reste de l'app (cartes du
 * dashboard, page Comptes) ; seuls les menus déroulants les déversaient à plat,
 * en répétant le type entre parenthèses sur chaque ligne. Passé quelques
 * comptes, la liste devenait un mur où retrouver le bon demandait de lire
 * chaque entrée jusqu'à sa parenthèse.
 *
 * Le type devient donc l'en-tête d'un <optgroup> : le navigateur le pose en
 * gras, indente ses comptes et sépare les groupes, et le nom du compte
 * redevient seul sur sa ligne. Un <optgroup> ne se sélectionne pas, la valeur
 * choisie reste donc l'id du compte, comme avant.
 *
 * L'ordre des groupes est celui de state.typesComptes (l'ordre de la page
 * Comptes), et non celui de la liste reçue : `crud.get_comptes` trie sur
 * `ordre` puis le nom, ce qui entrelace les types. Un type absent de la liste
 * — filtrée par `comptesEligibles` selon le type d'opération — ne crée aucun
 * groupe vide.
 */
function fillComptesSelect(selectEl, comptes, { keepFirst = false } = {}) {
  // « + Créer un compte » et son trait, en tête (cf. ajouterOptionCreer), ne sont pas la ligne à garder :
  // c'est à la liste de les reposer après l'avoir remplie.
  const firstOption = keepFirst
    ? [...selectEl.children].find((el) => !el.dataset.ligneCreer) || null
    : null;
  selectEl.innerHTML = "";
  if (firstOption) selectEl.appendChild(firstOption);

  const parType = new Map();
  comptes.forEach((c) => {
    if (!parType.has(c.type_nom)) parType.set(c.type_nom, []);
    parType.get(c.type_nom).push(c);
  });
  // Les types connus d'abord, dans leur ordre ; puis ceux qu'un compte porte
  // sans qu'ils figurent dans state.typesComptes (liste pas encore chargée),
  // pour qu'aucun compte ne disparaisse du menu.
  const typesOrdonnes = [
    ...state.typesComptes.map((type) => type.nom).filter((nom) => parType.has(nom)),
    ...[...parType.keys()].filter((nom) => !state.typesComptes.some((type) => type.nom === nom)),
  ];

  typesOrdonnes.forEach((typeNom) => {
    const groupe = document.createElement("optgroup");
    groupe.label = typeLabel(typeNom);
    parType.get(typeNom).forEach((c) => {
      const opt = document.createElement("option");
      opt.value = c.id;
      // Sans le type entre parenthèses : l'en-tête du groupe le dit déjà.
      opt.textContent = c.nom;
      groupe.appendChild(opt);
    });
    selectEl.appendChild(groupe);
  });
}

function fillCategoriesSelect(selectEl, categories, { keepFirst = false } = {}) {
  const firstOption = keepFirst ? selectEl.firstElementChild : null;
  selectEl.innerHTML = "";
  if (firstOption) selectEl.appendChild(firstOption);
  categories.forEach((c) => {
    const opt = document.createElement("option");
    opt.value = c.id;
    // Par `libelleCategorie` comme partout ailleurs : les catégories livrées
    // ont un équivalent anglais, celles que l'utilisateur crée ressortent
    // inchangées. Un menu qui resterait en français sous une interface anglaise
    // se lirait comme un oubli.
    opt.textContent = libelleCategorie(c.nom);
    selectEl.appendChild(opt);
  });
}

function nomCompte(compteId) {
  const c = state.comptes.find((c) => c.id === compteId);
  return c ? c.nom : `#${compteId}`;
}


/**
 * Le compte dont provient le relevé lu par le preset sélectionné
 * (import_preset.compte_id), ou null quand le preset n'y est pas lié — le
 * fichier nomme alors lui-même le compte de chaque ligne, et il n'y a pas UN
 * compte à nommer.
 */
function compteDuPresetImport() {
  const preset = presetActuel();
  return preset && preset.compte_id != null ? preset.compte_id : null;
}

/**
 * « NETFLIX <em>(Courant)</em> » : un libellé de catégorie LU DANS LE RELEVÉ,
 * suivi en italique de la provenance de ce relevé.
 *
 * C'est la catégorie BANCAIRE qui porte la parenthèse, pas celle de l'app :
 * deux banques exportent des libellés aux noms voisins, et en réorganisant les
 * correspondances on ne peut plus dire de quel fichier chacun sort. Les
 * catégories de l'app, elles, sont communes à tous les comptes — les rattacher
 * à un compte serait faux.
 *
 * « Compte » est retiré en tête du nom : les comptes s'appellent souvent
 * « Compte Courant », et la parenthèse répétait un mot qui n'apprend rien.
 * Purement d'affichage, ici seulement — le compte garde son nom partout
 * ailleurs.
 */
function libelleCategorieBanqueHtml(nomBanque, provenance) {
  const html = escapeHtml(nomBanque);
  if (!provenance) return html;
  const court = provenance.replace(/^compte\s+/i, "") || provenance;
  return `${html} <em class="mapping-provenance">(${escapeHtml(court)})</em>`;
}

// Une correspondance de libellé bancaire vise TOUJOURS une catégorie de
// dépense. Les quatre types sans catégorie libre (virement interne, prêt reçu,
// remboursement reçu, remboursement de prêt) n'y figurent plus : ils ne portent
// par nature aucune catégorie, et c'est une règle de catégorisation qui les
// détecte — évaluée avant les correspondances (cf. migration 0022).
function ciblesEligiblesImport() {
  return state.categories.map((c) => ({ id: c.id, nom: c.nom }));
}

/**
 * Le libellé d'une catégorie tel qu'on l'affiche.
 *
 * UNE CATÉGORIE EST UNE DONNÉE, PAS UN TEXTE D'INTERFACE : celles que
 * l'utilisateur crée portent le nom qu'il leur a donné, et les traduire n'aurait
 * aucun sens. Seules les catégories POSÉES À L'INSTALLATION (cf.
 * constants.CATEGORIES_INITIALES) ont un équivalent anglais, et `t()` ne rend
 * que ce qu'il connaît : tout le reste ressort inchangé.
 *
 * Passer par ici plutôt que d'appeler `t()` sur place, pour que la règle soit
 * énoncée une fois — et qu'on sache où ajouter la suivante.
 */
function libelleCategorie(nom) {
  return t(nom);
}

function nomCategorie(categorieId) {
  // Absente pour de bon : les quatre types sans catégorie libre (virement
  // interne, prêt reçu, remboursement reçu, remboursement de prêt) n'en portent
  // aucune par nature. Un « #null » n'y désignerait rien à chercher — d'où le
  // tiret, réservé aux cases vides, distinct du « #12 » d'une catégorie
  // supprimée qui, elle, a bien existé.
  if (categorieId == null) return "-";
  const c = state.categories.find((c) => c.id === categorieId);
  return c ? libelleCategorie(c.nom) : `#${categorieId}`;
}

/* ---------- Recherche dans la page ---------- */

/**
 * Un seul champ pour toute l'application, qui SURLIGNE ce qui est à l'écran.
 *
 * POURQUOI GÉNÉRIQUE. Chaque page a sa forme — six onglets d'opérations, des
 * cartes de règle, des lignes de correspondance, un aperçu d'import — et un
 * champ de recherche par tableau aurait voulu dire autant d'implémentations à
 * garder d'accord, chacune oubliée au prochain écran ajouté. On parcourt donc
 * le TEXTE de la section visible, quelle que soit sa mise en page.
 *
 * POURQUOI SURLIGNER PLUTÔT QUE FILTRER. La première version masquait les
 * lignes sans correspondance. C'était une perte sèche de contexte : un montant
 * ne veut rien dire sans les opérations qui l'entourent, et un tableau réduit à
 * deux lignes ne se lit plus — on ne voit plus si la ligne trouvée est la
 * première du mois, ni ce qui la précède. On laisse donc la page intacte, on
 * marque les correspondances, et on amène l'utilisateur dessus.
 *
 * DYNAMIQUE : à chaque caractère, jamais sur « Entrée » (qui, lui, passe à la
 * correspondance suivante). Le surlignage se réapplique aussi après chaque
 * rendu — les listes sont reconstruites en permanence — d'où l'observateur plus
 * bas.
 *
 * Comparaison sans casse ni accents, comme les règles de catégorisation : un
 * relevé bancaire écrit « CAFE » là où on tape « café ».
 */

// Les conteneurs qu'on ne parcourt jamais : leur texte n'appartient pas à la
// page (options d'un menu déroulant replié, contenu d'un champ de saisie), et y
// insérer un <mark> casserait le contrôle.
const BALISES_HORS_RECHERCHE = new Set([
  "SCRIPT",
  "STYLE",
  "SELECT",
  "OPTION",
  "TEXTAREA",
  "INPUT",
]);

const NAMESPACE_SVG = "http://www.w3.org/2000/svg";

let rechercheTerme = "";
// Les <mark> posés au dernier passage, dans l'ordre du document : c'est la
// liste sur laquelle naviguent les chevrons.
let rechercheCorrespondances = [];
let rechercheIndex = 0;
// L'observateur qui réapplique le surlignage après chaque rendu (cf.
// cablerRecherche). Gardé ici pour pouvoir VIDER sa file juste après nos
// propres mutations : poser un <mark> est un ajout de nœud comme un autre, et
// sans cela le surlignage se rappellerait lui-même sans fin. Un simple drapeau
// booléen ne suffirait pas — les callbacks d'un MutationObserver sont livrés en
// microtâche, donc après que le drapeau serait retombé.
let observateurRecherche = null;

// Exécute une modification du DOM faite PAR la recherche, sans que
// l'observateur la prenne pour un rendu de l'application.
function sansReveillerObservateur(modifier) {
  modifier();
  if (observateurRecherche) observateurRecherche.takeRecords();
}

function normaliserRecherche(texte) {
  // NFD sépare chaque lettre accentuée en (lettre + diacritique) ; on retire
  // ensuite les diacritiques (U+0300–U+036F). Même normalisation que les règles
  // de catégorisation côté serveur.
  return (texte || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase();
}

/**
 * Le conteneur RÉELLEMENT visible, et lui seul.
 *
 * Les sous-sections (six onglets d'opérations, six pages de paramètres) vivent
 * toutes dans le DOM en permanence : une seule porte `.active`. Chercher dans
 * la section entière comptait donc les lignes des onglets masqués — le compteur
 * annonçait des résultats introuvables à l'écran.
 */
function sectionActive() {
  const section = document.querySelector("section.active");
  if (!section) return null;
  // Un onglet peut allumer deux volets à la fois (`data-sous-section-avec`) : la recherche doit
  // alors couvrir la section entière, les volets éteints étant écartés après coup (marques sans place).
  const actives = section.querySelectorAll(".sous-section.active");
  return actives.length === 1 ? actives[0] : section;
}

/** Les volets que l'onglet `bouton` allume EN PLUS du sien (`data-sous-section-avec`, séparés par des
 *  espaces) : un onglet qui en réunit plusieurs. */
function activerCompagnons(bouton) {
  (bouton.dataset.sousSectionAvec || "")
    .split(/\s+/)
    .filter(Boolean)
    .forEach((id) => document.getElementById(`sous-section-${id}`)?.classList.add("active"));
}

/**
 * Retire tous les <mark> posés par la recherche et recolle le texte.
 *
 * `normalize()` sur le parent est indispensable : sans lui, chaque passage
 * laisserait le texte éclaté en morceaux de plus en plus petits, et une
 * correspondance à cheval sur deux morceaux deviendrait introuvable.
 */
function effacerSurlignages(racine = document.querySelector("main")) {
  if (!racine) return;
  const marques = [...racine.querySelectorAll("mark.recherche-marque")];
  if (marques.length === 0) return;
  sansReveillerObservateur(() => {
    marques.forEach((marque) => {
      const parent = marque.parentNode;
      if (!parent) return;
      parent.replaceChild(document.createTextNode(marque.textContent), marque);
      parent.normalize();
    });
  });
}

/**
 * Découpe un nœud de texte sur chaque occurrence du terme et enrobe celles-ci.
 *
 * On travaille sur la version NORMALISÉE (sans casse ni accents) pour repérer
 * les positions, mais on découpe le texte D'ORIGINE aux mêmes index : la
 * normalisation NFD suivie du retrait des diacritiques conserve la longueur
 * caractère par caractère pour les lettres accentuées latines, donc les index
 * se correspondent.
 */
function surlignerNoeud(noeud, terme, correspondances) {
  const texte = noeud.nodeValue;
  const normalise = normaliserRecherche(texte);
  if (normalise.length !== texte.length) return; // découpage non fiable : on s'abstient
  let depuis = 0;
  let position = normalise.indexOf(terme, depuis);
  if (position === -1) return;

  const fragment = document.createDocumentFragment();
  while (position !== -1) {
    if (position > depuis) {
      fragment.appendChild(document.createTextNode(texte.slice(depuis, position)));
    }
    const marque = document.createElement("mark");
    marque.className = "recherche-marque";
    marque.textContent = texte.slice(position, position + terme.length);
    fragment.appendChild(marque);
    correspondances.push(marque);
    depuis = position + terme.length;
    position = normalise.indexOf(terme, depuis);
  }
  if (depuis < texte.length) {
    fragment.appendChild(document.createTextNode(texte.slice(depuis)));
  }
  noeud.parentNode.replaceChild(fragment, noeud);
}

/**
 * Tous les nœuds de texte candidats de la section.
 *
 * Deux exclusions, l'une et l'autre par simple lecture d'attribut — aucune
 * mesure de mise en page, sinon parcourir un tableau de plusieurs centaines de
 * lignes coûterait un calcul de style par nœud :
 *
 * - les contrôles de formulaire (BALISES_HORS_RECHERCHE) : leur texte
 *   n'appartient pas à la page, et y glisser un <mark> casserait le contrôle ;
 * - les blocs repliés (`style="display:none"`, l'idiome de toute l'app pour
 *   montrer et cacher). Ce que ce test laisserait passer — un masquage par
 *   classe CSS — est rattrapé après coup, une fois les marques posées, en
 *   écartant celles qui n'occupent aucune place à l'écran ;
 * - tout ce qui est DANS UN SVG (l'histogramme du dashboard, et ses <title>
 *   d'infobulle). Un <mark> est un élément HTML : glissé dans un <text> SVG, il
 *   n'y est pas rendu du tout — le libellé de la catégorie disparaissait
 *   purement et simplement du graphe dès qu'on le cherchait.
 */
function noeudsTexte(section) {
  const noeuds = [];
  const parcours = document.createTreeWalker(section, NodeFilter.SHOW_TEXT, {
    acceptNode(noeud) {
      if (!noeud.nodeValue || !noeud.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
      for (let parent = noeud.parentElement; parent; parent = parent.parentElement) {
        if (parent.namespaceURI === NAMESPACE_SVG) return NodeFilter.FILTER_REJECT;
        if (BALISES_HORS_RECHERCHE.has(parent.tagName)) return NodeFilter.FILTER_REJECT;
        if (parent.hidden || parent.style.display === "none") return NodeFilter.FILTER_REJECT;
        if (parent === section) break;
      }
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  let noeud = parcours.nextNode();
  while (noeud) {
    noeuds.push(noeud);
    noeud = parcours.nextNode();
  }
  return noeuds;
}

// La correspondance courante : celle vers laquelle les chevrons ont amené
// l'utilisateur, distinguée des autres et ramenée au centre de l'écran.
function majCorrespondanceCourante({ defiler = true } = {}) {
  rechercheCorrespondances.forEach((marque) =>
    marque.classList.remove("recherche-marque-courante")
  );
  const resultat = document.getElementById("recherche-resultat");
  const total = rechercheCorrespondances.length;
  if (total === 0) {
    if (resultat) resultat.textContent = rechercheTerme.trim() ? t("aucun résultat") : "";
    return;
  }
  rechercheIndex = ((rechercheIndex % total) + total) % total;
  const courante = rechercheCorrespondances[rechercheIndex];
  courante.classList.add("recherche-marque-courante");
  if (resultat) resultat.textContent = `${rechercheIndex + 1} / ${total}`;
  if (defiler) courante.scrollIntoView({ block: "center", behavior: "smooth" });
}

// Les notes d'opération (cf. app.js::indicateurNote, ligneDetailNote) ne sont
// affichées nulle part dans un tableau — repliées derrière un pictogramme,
// comme une découpe. `noeudsTexte` ignore tout nœud cache : sans déplier
// D'ABORD celles qui contiennent le terme cherché, Ctrl+F ne les trouverait
// jamais. Le Set ne retient que les lignes dépliées PAR LA RECHERCHE, pour ne
// jamais refermer une note que l'utilisateur a ouverte lui-même à la main.
const notesOuvertesParRecherche = new Set();

function majBoutonBascule(id, ouvert) {
  const bouton = document.querySelector(`[data-bascule="${id}"]`);
  if (!bouton) return;
  bouton.setAttribute("aria-expanded", String(ouvert));
  bouton.classList.toggle("ouvert", ouvert);
}

function synchroniserNotesAvecRecherche(section, terme) {
  const lignes = section.querySelectorAll(".note-detail");
  if (lignes.length === 0) return;
  sansReveillerObservateur(() => {
    lignes.forEach((ligne) => {
      const correspond = Boolean(terme) && normaliserRecherche(ligne.textContent).includes(terme);
      const ouvertePourRecherche = notesOuvertesParRecherche.has(ligne.id);
      if (correspond && ligne.hidden) {
        ligne.hidden = false;
        notesOuvertesParRecherche.add(ligne.id);
        majBoutonBascule(ligne.id, true);
      } else if (!correspond && ouvertePourRecherche) {
        ligne.hidden = true;
        notesOuvertesParRecherche.delete(ligne.id);
        majBoutonBascule(ligne.id, false);
      }
    });
  });
}

function appliquerRecherche({ conserverIndex = true } = {}) {
  const section = sectionActive();
  // Le nettoyage porte sur TOUTE la page, pas seulement la section visible :
  // sinon un surlignage posé avant un changement d'onglet y resterait, et
  // rouvrir l'onglet montrerait des marques sans rapport avec le terme actuel.
  effacerSurlignages();
  rechercheCorrespondances = [];
  if (!section) return;

  const terme = normaliserRecherche(rechercheTerme).trim();
  synchroniserNotesAvecRecherche(section, terme);
  if (!terme) {
    rechercheIndex = 0;
    majCorrespondanceCourante({ defiler: false });
    majBoutonsNavigation();
    return;
  }

  // Lecture d'abord, écriture ensuite : la liste complète des nœuds est
  // constituée AVANT la première modification, sinon chaque découpage
  // invaliderait la mise en page que le parcours suivant devrait recalculer.
  const candidats = noeudsTexte(section);
  sansReveillerObservateur(() => {
    candidats.forEach((noeud) => surlignerNoeud(noeud, terme, rechercheCorrespondances));
  });
  // Le rattrapage annoncé plus haut : une marque posée dans un bloc masqué
  // autrement que par `style.display` n'occupe aucune place: la compter
  // annoncerait des résultats qu'on ne peut ni voir ni atteindre.
  rechercheCorrespondances = rechercheCorrespondances.filter(
    (marque) => marque.getClientRects().length > 0
  );

  if (!conserverIndex || rechercheIndex >= rechercheCorrespondances.length) {
    rechercheIndex = 0;
  }
  // Pas de défilement automatique à la frappe : la page sauterait à chaque
  // caractère, y compris quand la correspondance est déjà sous les yeux. Les
  // chevrons (et Entrée) sont là pour ça.
  majCorrespondanceCourante({ defiler: false });
  majBoutonsNavigation();
}

function majBoutonsNavigation() {
  const navigation = document.getElementById("recherche-navigation");
  if (!navigation) return;
  const actif = rechercheCorrespondances.length > 1;
  // `flex` explicitement : la règle CSS de repos est `display: none`, et rendre
  // la main au style de la feuille (chaîne vide) la ferait donc réapparaître…
  // masquée.
  navigation.style.display = rechercheCorrespondances.length > 0 ? "flex" : "none";
  navigation.querySelectorAll("button").forEach((btn) => {
    btn.disabled = !actif;
  });
}

// Circulaire : après la dernière correspondance on revient à la première. Sur
// une page longue, buter contre la fin obligerait à remonter à la main pour
// reprendre le tour.
function allerCorrespondance(pas) {
  if (rechercheCorrespondances.length === 0) return;
  rechercheIndex += pas;
  majCorrespondanceCourante();
}

function ouvrirRecherche() {
  document.getElementById("recherche").classList.add("recherche-ouverte");
  const champ = document.getElementById("recherche-champ");
  champ.focus();
  champ.select();
}

function fermerRecherche() {
  const champ = document.getElementById("recherche-champ");
  champ.value = "";
  rechercheTerme = "";
  appliquerRecherche({ conserverIndex: false });
  document.getElementById("recherche").classList.remove("recherche-ouverte");
  champ.blur();
}

(function cablerRecherche() {
  const champ = document.getElementById("recherche-champ");
  if (!champ) return;

  document.getElementById("btn-recherche").innerHTML = ICONE_LOUPE;
  const btnPrecedent = document.getElementById("btn-recherche-precedent");
  const btnSuivant = document.getElementById("btn-recherche-suivant");
  btnPrecedent.innerHTML = ICONE_CHEVRON_HAUT;
  btnSuivant.innerHTML = ICONE_CHEVRON_BAS;
  btnPrecedent.addEventListener("click", () => allerCorrespondance(-1));
  btnSuivant.addEventListener("click", () => allerCorrespondance(1));
  majBoutonsNavigation();

  champ.addEventListener("input", () => {
    rechercheTerme = champ.value;
    // Un terme qu'on retape repart de la première correspondance : conserver
    // l'index d'une recherche précédente ferait sauter à la douzième.
    appliquerRecherche({ conserverIndex: false });
  });
  // Entrée passe à la correspondance suivante (Maj+Entrée à la précédente),
  // comme la recherche d'un navigateur ; elle ne doit surtout pas valider un
  // formulaire environnant. Échap referme et rétablit la page.
  champ.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      allerCorrespondance(e.shiftKey ? -1 : 1);
    }
    if (e.key === "Escape") fermerRecherche();
  });
  document.getElementById("btn-recherche").addEventListener("click", ouvrirRecherche);

  // Ctrl+F (Cmd+F) : on remplace la recherche du navigateur, qui ne sait pas
  // se limiter à l'onglet réellement affiché — elle trouverait dans les cinq
  // autres, tous présents dans le DOM mais invisibles.
  document.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "f") {
      e.preventDefault();
      ouvrirRecherche();
    }
  });

  // Les listes sont reconstruites à chaque rendu : sans ce rappel, le
  // surlignage disparaîtrait au premier changement de mois ou de tri.
  let rappel = null;
  observateurRecherche = new MutationObserver((mutations) => {
    if (!rechercheTerme || !mutations.some((m) => m.addedNodes.length)) return;
    clearTimeout(rappel);
    rappel = setTimeout(() => appliquerRecherche(), 50);
  });
  observateurRecherche.observe(document.querySelector("main"), {
    childList: true,
    subtree: true,
  });
})();

/* ---------- Navigation ---------- */

/**
 * `ongletActif` : le nom de l'écran dont le bouton doit s'allumer dans la
 * barre du haut, quand ce n'est pas celui qu'on ouvre.
 *
 * Un écran d'extension peut ne pas avoir de bouton à lui (`bouton: false` dans
 * son manifeste) : « Import de placements » s'ouvre depuis l'onglet Placements
 * et en est une action, pas une destination. La barre doit alors continuer de
 * montrer d'où l'on vient, sinon plus rien n'y est allumé et l'application a
 * l'air d'avoir quitté toutes ses pages.
 */
/**
 * Pose un onglet d'un écran SANS le charger : les classes, et rien d'autre.
 *
 * POURQUOI PAS UN `.click()`, qui ferait tout d'un coup : le gestionnaire
 * délégué qu'il déclencherait charge lui aussi le volet, et le chargeur de la
 * section suit juste derrière — deux fois la même requête, pour un seul écran
 * ouvert. Ici on désigne l'onglet, et le chargeur de la section (qui lit le
 * bouton actif) remplit le bon volet, une fois.
 */
function activerOngletSansCharger(section, sousSection) {
  const barre = document.getElementById(`${section}-sous-nav`);
  const bouton = barre?.querySelector(`button[data-sous-section="${sousSection}"]`);
  if (!bouton) return;
  barre
    .querySelectorAll("button[data-sous-section]")
    .forEach((b) => b.classList.remove("active"));
  bouton.classList.add("active");
  const portee = document.getElementById(`section-${section}`);
  portee.querySelectorAll(":scope > .sous-section").forEach((s) => s.classList.remove("active"));
  document.getElementById(`sous-section-${sousSection}`)?.classList.add("active");
  activerCompagnons(bouton);
}

function switchSection(name, { ongletActif = name, sousSection = null } = {}) {
  document.querySelectorAll("section").forEach((s) => s.classList.remove("active"));
  document.getElementById(`section-${name}`).classList.add("active");
  document.querySelectorAll("nav button").forEach((b) => b.classList.remove("active"));
  // `?.` : rien ne garantit un bouton — cf. `ongletActif` ci-dessus.
  document.querySelector(`nav button[data-section="${ongletActif}"]`)?.classList.add("active");

  // UN ONGLET PRÉCIS, AVANT les chargeurs : ceux-ci lisent le bouton actif pour
  // savoir quel volet remplir (cf. loadComptesGlobaleSousPage). C'est par là
  // qu'une extension revient sur son propre onglet — « Placements financiers »
  // est l'un des deux volets de la page des avoirs.
  if (sousSection) activerOngletSansCharger(name, sousSection);

  if (name === "dashboard") loadDashboard();
  if (name === "comptes-globale") loadComptesGlobaleSousPage();
  if (name === "operations") loadOperations();
  if (name === "parametres") loadParametresSousPage();
  // Écrans apportés par une extension (Placements financiers, par exemple) :
  // le noyau ne les connaît pas par leur nom, il demande à qui de droit. Rend
  // false quand aucune extension ne revendique cette section, ce qui est le
  // cas de tous les écrans ci-dessus.
  BudgetApp.extensions.ouvrir(name);

  // Le terme reste, la page change : on le réapplique à ce qu'on vient
  // d'afficher plutôt que de le perdre en silence. L'index repart de la
  // première correspondance — la « troisième » d'un autre écran ne veut rien
  // dire ici.
  appliquerRecherche({ conserverIndex: false });
}

/* ---------- Vue des avoirs (onglets) ---------- */

// UN SEUL ONGLET DANS L'APPLICATION NUE, et c'est voulu : la barre reste
// masquée tant qu'elle est seule (cf. majBarreOngletsComptesGlobale). Elle
// existe pour qu'une extension puisse poser un second onglet à côté de la vue
// des comptes — le regroupement par projet, par exemple — sans que le noyau
// ait à connaître son nom.
function chargerSousPageComptesGlobale(page) {
  if (page === "comptes-globale-vue") loadComptesGlobale();
  // Onglets apportés par une extension : comme pour les écrans principaux et
  // les sous-pages de réglages, le noyau demande à qui de droit.
  BudgetApp.extensions.ouvrirSousPage(page);
}

function loadComptesGlobaleSousPage() {
  const btnActif = document.querySelector("#comptes-globale-sous-nav button.active");
  chargerSousPageComptesGlobale(
    btnActif ? btnActif.dataset.sousSection : "comptes-globale-vue"
  );
}

// L'AFFICHAGE de l'onglet (classes .active) est géré par le gestionnaire
// délégué commun, plus bas ; ici on ne s'occupe que de CHARGER ses données.
document.getElementById("comptes-globale-sous-nav").addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-sous-section]");
  if (btn) chargerSousPageComptesGlobale(btn.dataset.sousSection);
});

/* ---------- Paramètres (sous-pages) ---------- */

// Comptes et Catégories vivaient dans la barre de navigation principale ; ce
// sont des réglages, consultés rarement, pas des pages du quotidien — d'où leur
// place ici, aux côtés des correspondances et de l'import. Ils forment, avec les
// monnaies, la page « Configuration ».
function chargerSousPageParametres(page) {
  if (page === "parametres-generaux") {
    loadParametresGeneraux();
    // La base de données est une PARTIE des paramètres généraux (cf. index.html).
    loadParametresBdd();
  }
  // CONFIGURATION : une page en trois parties — catégories, comptes, et les
  // monnaies quand l'extension tourne (c'est elle qui charge la sienne, par
  // `ouvrirSousPage` ci-dessous).
  if (page === "parametres-configuration") {
    loadCategories();
    loadComptes();
  }
  if (page === "parametres-correspondances") loadCorrespondances();
  if (page === "parametres-import") importSectionEnChargement = loadImportSection();
  if (page === "parametres-extensions") loadExtensions();
  // Sous-pages apportées par une extension : comme pour les écrans principaux,
  // le noyau ne les connaît pas par leur nom et demande à qui de droit.
  BudgetApp.extensions.ouvrirSousPage(page);
}

/* ---------- Paramètres généraux ----------
 *
 * L'ONGLET DES RÉGLAGES QUI NE SONT LA DONNÉE DE PERSONNE. Comptes, catégories,
 * correspondances et base de données décrivent un budget ; ce qu'on règle ici
 * décrit une FAÇON DE S'EN SERVIR, propre au poste et à qui s'en sert. D'où le
 * localStorage plutôt qu'une table, comme pour la langue : changer de machine
 * ne doit pas ramener les habitudes de l'autre.
 */
/* ----- Le thème -----
 *
 * DEUX JEUX DE VARIABLES CSS, ET RIEN D'AUTRE (cf. style.css, `:root
 * [data-theme="clair"]`) : toute la feuille passe par elles, extensions
 * comprises, et changer de thème n'est qu'une bascule d'attribut sur `<html>`.
 * Aucune règle n'est dupliquée, donc aucune ne peut diverger de l'autre.
 *
 * IL EST POSÉ DANS LE <head>, PAS ICI : ce fichier est chargé en fin de page,
 * après le premier rendu, et appliquer le mode clair d'ici ferait clignoter
 * l'écran en sombre à chaque ouverture (cf. index.html). Ce qui reste ici est
 * le CHANGEMENT de thème, qui a lieu bien après.
 *
 * DANS LE localStorage comme la langue et la touche de gel : c'est un confort
 * de lecture propre au poste, pas une donnée du budget. Les trois états valent
 * ici comme ailleurs — « clair », « sombre », et l'absence de clé, qui retombe
 * sur le thème sombre, celui de l'application depuis toujours.
 */
const CLE_THEME = "budget-app.theme";
const THEME_DEFAUT = "sombre";

function themeEnregistre() {
  try {
    return localStorage.getItem(CLE_THEME) === "clair" ? "clair" : THEME_DEFAUT;
  } catch (err) {
    return THEME_DEFAUT;
  }
}

function appliquerTheme(theme) {
  if (theme === "clair") document.documentElement.dataset.theme = "clair";
  else delete document.documentElement.dataset.theme;
  try {
    localStorage.setItem(CLE_THEME, theme);
  } catch (err) {
    // Stockage indisponible : le thème vaut pour la session, et rien de cassé.
  }
}

function majAffichageTheme() {
  const select = document.getElementById("reglage-theme");
  if (select) select.value = themeEnregistre();
}

document.getElementById("reglage-theme")?.addEventListener("change", (e) => {
  appliquerTheme(e.target.value);
  // RIEN À REDESSINER ICI, et c'est une propriété du seul endroit d'où le
  // réglage se change : les graphes relisent les variables CSS en JavaScript
  // (cf. couleurTypeCompte) et gardent donc les teintes de l'ancien thème dans
  // leur SVG — mais ils vivent sur d'autres écrans, que `switchSection`
  // recharge en y revenant. Le reste de l'interface suit la feuille de style,
  // donc change au moment même où l'attribut bascule.
});

function majAffichageToucheGel() {
  const champ = document.getElementById("reglage-touche-gel");
  if (!champ) return;
  const combo = toucheGelInfobulle();
  champ.value = combo ? libelleCombo(combo) : t("Désactivé");
}

/** Le menu « Monnaie d'affichage par défaut » : toutes les monnaies, plus
 * « Aucune » (première de la liste). */
function majAffichageMonnaieDefaut() {
  majChampMonnaieApplication();
  const select = document.getElementById("reglage-monnaie-defaut");
  if (!select) return;
  select.innerHTML = "";
  const aucune = document.createElement("option");
  aucune.value = "";
  aucune.textContent = t("Aucune (la première)");
  select.appendChild(aucune);
  // Une monnaie désactivée ne se propose pas : elle n'est plus faite pour être
  // regardée en premier.
  const proposables = state.monnaies.filter((m) => m.active !== false);
  proposables.forEach((m) => {
    const opt = document.createElement("option");
    opt.value = m.id;
    opt.textContent = `${m.nom} (${m.symbole})`;
    select.appendChild(opt);
  });
  const preferee = state.monnaieAffichageDefautId;
  select.value = preferee != null && proposables.some((m) => m.id === preferee) ? String(preferee) : "";
}

/** Le nom et le symbole de la monnaie de l'application, SANS l'extension
 * « Monnaies » (avec elle, c'est le choix de la monnaie d'affichage qui paraît, et
 * le nom se change dans Paramètres → Monnaies). La monnaie de l'application est la
 * première de la liste. */
function majChampMonnaieApplication() {
  const bloc = document.getElementById("reglage-monnaie-app-bloc");
  if (!bloc) return;
  const sansExtension = !BudgetApp.extensions.estActive("monnaies");
  bloc.style.display = sansExtension ? "" : "none";
  const monnaie = (state.monnaies || [])[0];
  if (!sansExtension || !monnaie) return;
  // Pas pendant qu'on écrit dedans : le rendu est relancé à chaque passage ici.
  const nom = document.getElementById("reglage-monnaie-nom");
  const symbole = document.getElementById("reglage-monnaie-symbole");
  if (document.activeElement !== nom) nom.value = monnaie.nom;
  if (document.activeElement !== symbole) symbole.value = monnaie.symbole;
}

document.getElementById("btn-monnaie-app-enregistrer")?.addEventListener("click", async () => {
  const nom = document.getElementById("reglage-monnaie-nom").value.trim();
  const symbole = document.getElementById("reglage-monnaie-symbole").value.trim();
  if (!nom || !symbole) {
    showMessage(t("Le nom et le symbole de la monnaie sont obligatoires."), "error");
    return;
  }
  try {
    await apiFetch("/monnaies/application", {
      method: "PUT",
      body: JSON.stringify({ nom, symbole }),
    });
    await refreshMonnaies();
    majChampMonnaieApplication();
    showMessage(t("Monnaie enregistrée."), "success");
  } catch (err) {
    showMessage(err.message, "error");
  }
});

document.getElementById("reglage-monnaie-defaut")?.addEventListener("change", async (e) => {
  const id = Number(e.target.value) || null;
  if (await ecrirePreference(CLE_MONNAIE_AFFICHAGE, id)) {
    state.monnaieAffichageDefautId = id;
  } else {
    showMessage(t("Réglage non enregistré."), "error");
    majAffichageMonnaieDefaut();
  }
});

/* ---------- LES MONNAIES ÉTEINTES DANS LES GRAPHIQUES ----------
 *
 * DEUX FAÇONS DE LES MONTRER, au choix (Paramètres généraux), et le choix n'existe
 * que si l'extension « Monnaies » tourne — sans elle, aucune monnaie ne s'éteint :
 *
 *   - « SUR LA PAGE » (le défaut) : un graphique par monnaie, comme toujours —
 *     un par monnaie dans un projet, un onglet par monnaie au dashboard ;
 *   - « EN POP-UP » : seules les monnaies ALLUMÉES ont leur graphique. Ce qui a
 *     été converti vers (ou depuis) une monnaie éteinte y devient une colonne
 *     grise « Conversion vers… », et cette colonne ouvre le détail de la monnaie
 *     éteinte dans une fenêtre (cf. ouvrirFenetreMonnaieEteinte). Une monnaie
 *     éteinte a par définition un solde nul : sa cascade se lit d'un bloc, de ce
 *     qui est arrivé à ce qui en est reparti.
 *
 * DANS LE localStorage, comme le thème et la touche de gel : c'est une façon de
 * regarder, propre au poste, et elle ne désigne aucune ligne de la base. */
const CLE_MONNAIES_ETEINTES = "budget-app.graphes.monnaies-eteintes";

function modeMonnaiesEteintes() {
  if (!BudgetApp.extensions.estActive("monnaies")) return "page";
  try {
    return localStorage.getItem(CLE_MONNAIES_ETEINTES) === "popup" ? "popup" : "page";
  } catch (err) {
    return "page";
  }
}

function monnaieEstEteinte(monnaieId) {
  return (state.monnaies || []).some((m) => m.id === monnaieId && m.active === false);
}

document.getElementById("reglage-monnaies-eteintes")?.addEventListener("change", (e) => {
  try {
    localStorage.setItem(CLE_MONNAIES_ETEINTES, e.target.value);
  } catch (err) {
    // Stockage indisponible : le réglage vaut pour la session, rien de cassé.
  }
});


/* ---------- Exporter ses données, et les copies de sécurité ----------
 *
 * L'EXPORT : le serveur rend le fichier (`GET /export?format=`), l'écran l'enregistre. Dans la fenêtre de
 * bureau un lien `download` ne fait rien — on passe donc par le sélecteur « enregistrer sous » du système
 * (`ApiBureau.enregistrer_octets`) ; dans un navigateur, par un lien temporaire.
 *
 * LES COPIES : un dossier retenu sur CE poste (cf. config_utilisateur), vérifié par le serveur (absolu,
 * écrivable, hors du dossier de l'application). L'application en fait d'elle-même au démarrage puis au
 * plus une fois par jour ; « Sauvegarder maintenant » en fait une tout de suite.
 */
function octetsEnBase64(octets) {
  let binaire = "";
  const pas = 0x8000;
  for (let i = 0; i < octets.length; i += pas) {
    binaire += String.fromCharCode.apply(null, octets.subarray(i, i + pas));
  }
  return btoa(binaire);
}

async function exporterDonnees(format) {
  // Dans la démo, c'est un export de données fictives : le rappel évite de le ranger parmi les vraies.
  if (BudgetApp.confirmerEnSandbox && !(await BudgetApp.confirmerEnSandbox("export"))) return;
  try {
    const reponse = await fetch(`/export?format=${encodeURIComponent(format)}`);
    if (!reponse.ok) {
      const erreur = await reponse.json().catch(() => null);
      throw new Error((erreur && erreur.detail) || `Erreur ${reponse.status}`);
    }
    const disposition = reponse.headers.get("Content-Disposition") || "";
    const nom = (disposition.match(/filename="([^"]+)"/) || [])[1] || `budget-export.${format}`;
    const octets = new Uint8Array(await reponse.arrayBuffer());
    if (window.pywebview && window.pywebview.api && window.pywebview.api.enregistrer_octets) {
      const chemin = await window.pywebview.api.enregistrer_octets(nom, octetsEnBase64(octets));
      if (chemin) showMessage(t("Export enregistré : {chemin}", { chemin }), "success");
      return;
    }
    const lien = document.createElement("a");
    lien.href = URL.createObjectURL(new Blob([octets]));
    lien.download = nom;
    document.body.appendChild(lien);
    lien.click();
    lien.remove();
    setTimeout(() => URL.revokeObjectURL(lien.href), 10000);
    showMessage(t("Export prêt : {nom}", { nom }), "success");
  } catch (err) {
    showMessage(err.message, "error");
  }
}

function renderEtatSauvegarde(etat) {
  document.getElementById("sauvegarde-dossier").value = etat.dossier || "";
  const ligne = document.getElementById("sauvegarde-etat");
  if (!etat.dossier) {
    ligne.textContent = t("Aucun dossier choisi : aucune copie n'est faite.");
  } else if (etat.derniere) {
    ligne.textContent = t("Dernière copie : {nom} ({date}). Les {n} plus récentes sont gardées.", {
      nom: etat.derniere.nom,
      date: new Date(etat.derniere.date).toLocaleString(langue()),
      n: etat.garder,
    });
  } else {
    ligne.textContent = t("Aucune copie pour l'instant : la première est faite au prochain démarrage, ou tout de suite avec « Sauvegarder maintenant ».");
  }
  document.getElementById("btn-sauvegarde-maintenant").disabled = !etat.dossier;
}

async function chargerEtatSauvegarde() {
  try {
    renderEtatSauvegarde(await apiFetch("/sauvegardes"));
  } catch (err) {
    document.getElementById("sauvegarde-etat").textContent = err.message;
  }
  document.getElementById("btn-sauvegarde-parcourir").style.display = selecteurNatifDisponible()
    ? ""
    : "none";
}

document.querySelectorAll("#reglage-export-bloc [data-export]").forEach((bouton) => {
  bouton.addEventListener("click", () => exporterDonnees(bouton.dataset.export));
});

document.getElementById("btn-sauvegarde-parcourir")?.addEventListener("click", async () => {
  const actuel = document.getElementById("sauvegarde-dossier").value;
  const chemin = await choisirCheminNatif("choisir_dossier", actuel);
  if (chemin) document.getElementById("sauvegarde-dossier").value = chemin;
});

document.getElementById("btn-sauvegarde-enregistrer")?.addEventListener("click", async () => {
  try {
    const dossier = document.getElementById("sauvegarde-dossier").value.trim();
    const etat = await apiFetch("/sauvegardes/dossier", {
      method: "PUT",
      body: JSON.stringify({ dossier: dossier || null }),
    });
    renderEtatSauvegarde(etat);
    showMessage(
      dossier
        ? etat.memorise
          ? t("Dossier de sauvegarde enregistré.")
          : t("Dossier accepté pour cette session, mais il n'a pas pu être mémorisé.")
        : t("Copies de sécurité désactivées."),
      etat.memorise ? "success" : "error"
    );
  } catch (err) {
    showMessage(traduireMessageServeur(err.message), "error");
  }
});

document.getElementById("btn-sauvegarde-maintenant")?.addEventListener("click", async () => {
  try {
    const etat = await apiFetch("/sauvegardes/maintenant", { method: "POST" });
    renderEtatSauvegarde(etat);
    showMessage(t("Copie faite : {nom}", { nom: etat.fichier }), "success");
  } catch (err) {
    showMessage(traduireMessageServeur(err.message), "error");
  }
});

function loadParametresGeneraux() {
  majAffichageTheme();
  majAffichageMonnaieDefaut();
  majAffichageToucheGel();
  majAffichageTouchesImport();
  const choixMonnaiesEteintes = document.getElementById("reglage-monnaies-eteintes");
  if (choixMonnaiesEteintes) choixMonnaiesEteintes.value = modeMonnaiesEteintes();
  // Les parcours proposés dépendent des extensions allumées (cf. tutoriel.js,
  // parcoursDisponibles) : on les relit à chaque passage ici.
  if (typeof renderTutorielsParametres === "function") renderTutorielsParametres();
  chargerEtatSauvegarde();
}

document.getElementById("reglage-touche-gel")?.addEventListener("keydown", (e) => {
  // TOUT EST INTERCEPTÉ, y compris Tab et Entrée : le champ sert à CAPTURER une
  // touche, laisser passer la navigation clavier reviendrait à interdire
  // d'enregistrer précisément les touches qu'on y presse.
  e.preventDefault();
  if (e.key === "Escape") {
    e.target.blur();
    return;
  }
  const combo = comboDepuisEvenement(e);
  if (!combo) return;
  definirToucheGelInfobulle(combo);
  majAffichageToucheGel();
  showMessage(t("Touche enregistrée."), "success");
});

document.getElementById("btn-touche-gel-defaut")?.addEventListener("click", () => {
  definirToucheGelInfobulle(TOUCHE_GEL_DEFAUT);
  majAffichageToucheGel();
});

document.getElementById("btn-touche-gel-aucune")?.addEventListener("click", () => {
  // LA CHAÎNE VIDE EST UN CHOIX, l'absence de clé n'en est pas un : sans cette
  // distinction, désactiver le gel serait indiscernable d'une installation
  // neuve, et la touche par défaut reviendrait au prochain lancement.
  definirToucheGelInfobulle("");
  degelerInfobulle();
  majAffichageToucheGel();
});

function loadParametresSousPage() {
  const btnActif = document.querySelector("#parametres-sous-nav button.active");
  chargerSousPageParametres(btnActif ? btnActif.dataset.sousSection : "parametres-configuration");
}

// L'AFFICHAGE de la sous-page (classes .active) est géré plus bas par le
// gestionnaire délégué commun aux onglets d'Opérations et de Paramètres ; ici
// on ne s'occupe que de CHARGER ses données.
document.getElementById("parametres-sous-nav").addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-sous-section]");
  if (btn) chargerSousPageParametres(btn.dataset.sousSection);
});

/* ---------- Meta / comptes / catégories (chargés au démarrage) ---------- */

async function loadMeta() {
  state.meta = await apiFetch("/meta");
  await refreshTypesComptes();
  await refreshTypesOperation();
  // Un `<select class="filtre-select-statut">` par onglet de la page
  // Opérations qui filtre sur le statut (cf. index.html) : chacun garde son
  // option "Tous" en tête, comme avant le passage au filtrage par onglet.
  document.querySelectorAll(".filtre-select-statut").forEach((filtreStatut) => {
    const tousStatutOption = filtreStatut.firstElementChild;
    fillSelect(filtreStatut, state.meta.statuts, { labels: statutLabel });
    filtreStatut.insertBefore(tousStatutOption, filtreStatut.firstChild);
  });

  renderImportVocabulairesDefauts();
}

function fillTypesComptesSelect(selectEl, typesComptes) {
  selectEl.innerHTML = "";
  typesComptes.forEach((t) => {
    const opt = document.createElement("option");
    opt.value = t.id;
    opt.textContent = typeLabel(t.nom);
    selectEl.appendChild(opt);
  });
}

async function refreshTypesOperation() {
  state.typesOperation = await apiFetch("/types-operation");
  // Les six boutons de type du formulaire d'opération portaient leur libellé en
  // dur dans index.html, alors que le reste de l'app le lit dans la table
  // (renommable par l'utilisateur, cf. libelleTypeOperation). Ils divergeaient
  // donc dès un renommage — et n'ont pas à être traduits, un nom de type étant
  // une donnée. Les remplir ici règle les deux d'un coup.
  document.querySelectorAll("#operation-type-boutons button").forEach((btn) => {
    btn.textContent = libelleTypeOperation(btn.dataset.type);
  });
}

async function refreshTypesComptes() {
  state.typesComptes = await apiFetch("/types-comptes");
  fillTypesComptesSelect(document.getElementById("compte-type"), state.typesComptes);
}

/**
 * LA MONNAIE D'AFFICHAGE PAR DÉFAUT : celle qui s'affiche en premier au lancement
 * de l'application ou d'une page (dashboard, budget, avoirs…). Un réglage
 * d'AFFICHAGE, rien de plus : aucune opération ni aucun solde n'en dépend.
 *
 * DANS LA BASE, et non le `localStorage` : elle désigne l'identifiant d'une
 * monnaie (cf. models.PreferenceInterface). Posée dans `state` au chargement des
 * monnaies ; `undefined` = pas encore lue, `null` = aucune préférence.
 */
const CLE_MONNAIE_AFFICHAGE = "noyau.monnaie-affichage-defaut";

/** Parmi des identifiants de monnaie candidats, celui à montrer d'abord : la
 * préférée si elle en fait partie, sinon le premier. */
function monnaiePreferee(ids) {
  const liste = (ids || []).filter((id) => id != null);
  const preferee = state.monnaieAffichageDefautId;
  const desactivee = (state.monnaies || []).some((m) => m.id === preferee && m.active === false);
  if (preferee != null && !desactivee && liste.includes(preferee)) return preferee;
  return liste.length > 0 ? liste[0] : null;
}

async function refreshMonnaies() {
  state.monnaies = await apiFetch("/monnaies");
  if (state.couleursConversions === undefined) {
    const attributions = await lirePreference(CLE_COULEURS_CONVERSIONS);
    state.couleursConversions = attributions && typeof attributions === "object" ? attributions : {};
  }
  if (state.monnaieAffichageDefautId === undefined) {
    const valeur = await lirePreference(CLE_MONNAIE_AFFICHAGE);
    state.monnaieAffichageDefautId = Number.isInteger(valeur) ? valeur : null;
  }
  if (!state.dashboardMonnaieId && state.monnaies.length > 0) {
    state.dashboardMonnaieId = monnaiePreferee(state.monnaies.map((m) => m.id));
  }
  // Un `<select class="filtre-select-monnaie">` par champ monnaie filtrable
  // de la page Opérations (une monnaie envoyée ET une monnaie reçue sur
  // l'onglet Virements, une seule ailleurs) : préserve la sélection de
  // chacun, comme refreshComptes/refreshCategories.
  document.querySelectorAll(".filtre-select-monnaie").forEach((filtreMonnaie) => {
    _refillPreservingSelection(filtreMonnaie, (el) => {
      const toutesOption = el.firstElementChild;
      fillMonnaiesSelect(el, state.monnaies);
      el.insertBefore(toutesOption, el.firstChild);
    });
  });
}

function fillMonnaiesSelect(selectEl, monnaies) {
  selectEl.innerHTML = "";
  monnaies.forEach((m) => {
    const opt = document.createElement("option");
    opt.value = m.id;
    opt.textContent = `${m.nom} (${m.symbole})`;
    selectEl.appendChild(opt);
  });
}

/**
 * VRAI QUAND L'APPLICATION PROPOSE UN CHOIX DE MONNAIE. Sans l'extension
 * « Monnaies », elle est mono-devise : aucun sélecteur de monnaie n'a rien à
 * demander (onglets du dashboard, filtres, formulaire d'opération, répartition
 * des avoirs). Le seul endroit à le dire, pour que les écrans ne se contredisent pas.
 */
function choixDeMonnaiePossible() {
  return BudgetApp.extensions.estActive("monnaies");
}

/**
 * Barre d'onglets « une monnaie à la fois », utilisée partout où l'app agrège
 * des montants (KPI du dashboard, budgets par catégorie) : sans taux de change,
 * additionner deux monnaies n'aurait aucun sens, alors on n'en montre qu'une.
 *
 * Masquée quand il n'y a qu'une monnaie : un onglet unique n'apprend rien.
 */
function renderOngletsMonnaies(conteneurId, monnaies, monnaieIdActive, onSelect) {
  const barre = document.getElementById(conteneurId);
  barre.innerHTML = "";
  // Sans l'extension « Monnaies », l'application est mono-devise : aucun choix
  // de monnaie n'est proposé, où que ce soit (cf. choixDeMonnaiePossible).
  const visible = monnaies.length > 1 && choixDeMonnaiePossible();
  barre.style.display = visible ? "" : "none";
  if (!visible) return;
  monnaies.forEach((monnaie) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = `${monnaie.nom} (${monnaie.symbole})`;
    if (monnaie.id === monnaieIdActive) btn.classList.add("active");
    btn.addEventListener("click", () => onSelect(monnaie.id));
    barre.appendChild(btn);
  });
}

async function refreshComptes() {
  state.comptes = await apiFetch("/comptes");
  // Un `<select class="filtre-select-compte">` par champ compte filtrable de
  // la page Opérations (compte source ET destination sur l'onglet Virements,
  // un seul ailleurs). Préserve la sélection courante de CHACUN : sans ça,
  // reconstruire la liste (ex. après un changement de filtre sur un autre
  // onglet, qui rafraîchit comptes/catégories avant de relire les filtres) la
  // remettait silencieusement à "Tous".
  document.querySelectorAll(".filtre-select-compte").forEach((filtreCompte) => {
    _refillPreservingSelection(filtreCompte, (el) => {
      const tousOption = el.firstElementChild;
      fillComptesSelect(el, state.comptes, { keepFirst: true });
      el.insertBefore(tousOption, el.firstChild);
    });
  });
}

async function refreshCategories() {
  // Depuis la migration 0019, la table ne contient plus que de vraies
  // catégories de dépense : les quatre anciennes catégories « système » sont
  // devenues des types, plus rien à filtrer ici.
  state.categories = await apiFetch("/categories");
  document.querySelectorAll(".filtre-select-categorie").forEach((filtreCategorie) => {
    _refillPreservingSelection(filtreCategorie, (el) => {
      const tousOption = el.firstElementChild;
      fillCategoriesSelect(el, state.categories, { keepFirst: true });
      el.insertBefore(tousOption, el.firstChild);
    });
  });
}

/* ---------- CRÉER UN COMPTE OU UNE CATÉGORIE SUR PLACE ----------
 *
 * UNE BASE NEUVE N'A AUCUN COMPTE, et le formulaire d'une opération en demande un : l'utilisateur qui
 * débute y trouvait une liste vide et rien pour s'en sortir, sinon un détour par Paramètres →
 * Configuration. Les listes de comptes, de catégories et (avec l'extension « Monnaies ») de monnaies
 * du formulaire et de la page d'import portent donc, en tête, « + Créer un compte » / « + Créer une
 * catégorie » / « + Créer une monnaie » : choisie, la ligne ouvre une petite fenêtre (un nom, un type
 * et les monnaies ; la case des entrées d'argent ; un symbole), puis la liste se remplit de ce qu'on
 * vient de créer, qui devient le choix. Annuler remet la liste où elle était.
 *
 * LES DEUX FENÊTRES SONT AUSSI CELLES DU GUIDE DU PREMIER IMPORT (cf. premier-demarrage.js) et du
 * tableau des catégories de la banque : une seule façon de créer, partout. Elles rendent l'élément
 * créé, ou null quand on a laissé tomber. */
const VALEUR_CREER = "__creer__";

/** La fenêtre qui crée un compte : un nom, un type et, avec l'extension « Monnaies », ses monnaies.
 *  `typesAdmis` (noms de type) restreint le menu quand le compte doit pouvoir servir à l'opération qu'on
 *  saisit. Rend le compte créé, ou null. */
function demanderCreationCompte({
  titre = "Créer un compte",
  cle = "noyau.creation-compte",
  typesAdmis = null,
} = {}) {
  const fond = document.getElementById("modale-guide-compte");
  const nom = document.getElementById("guide-compte-nom");
  const type = document.getElementById("guide-compte-type");
  const erreur = document.getElementById("guide-compte-erreur");
  document.getElementById("modale-guide-compte-titre").textContent = t(titre);
  ecrireTexteAide(document.getElementById("modale-guide-compte-texte"), t(texteAide(cle)));
  const types = (state.typesComptes || []).filter((x) => !typesAdmis || typesAdmis.includes(x.nom));
  fillTypesComptesSelect(type, types);
  const courant = types.find((x) => x.nom === "courant");
  if (courant) type.value = courant.id;
  nom.value = "";
  // LES MONNAIES DU COMPTE, AVEC L'EXTENSION « MONNAIES » SEULEMENT : les mêmes lignes que dans Paramètres →
  // Configuration (cf. renderCompteMonnaies), la monnaie préférée cochée d'office. Sans l'extension,
  // l'application n'a qu'une monnaie et le compte la prend sans rien demander.
  const choixMonnaies = choixDeMonnaiePossible();
  const listeMonnaies = document.getElementById("guide-compte-monnaies");
  const allumees = (state.monnaies || []).filter((m) => m.active !== false).map((m) => m.id);
  document.getElementById("guide-compte-monnaies-bloc").style.display = choixMonnaies ? "" : "none";
  if (choixMonnaies) {
    renderCompteMonnaies([{ monnaie_id: monnaiePreferee(allumees), solde_initial: 0 }], listeMonnaies);
  }
  erreur.style.display = "none";
  fond.style.display = "flex";
  nom.focus();

  return new Promise((resolve) => {
    const formulaire = document.getElementById("form-guide-compte");
    const plusTard = document.getElementById("btn-guide-compte-plus-tard");
    const creer = document.getElementById("btn-guide-compte-creer");
    const creerMonnaie = document.getElementById("btn-guide-compte-creer-monnaie");
    const fermer = (reponse) => {
      fond.style.display = "none";
      formulaire.removeEventListener("submit", surEnvoi);
      plusTard.removeEventListener("click", surPlusTard);
      creerMonnaie.removeEventListener("click", surCreerMonnaie);
      document.removeEventListener("keydown", surTouche, true);
      resolve(reponse);
    };
    const surPlusTard = () => fermer(null);
    const surTouche = (e) => {
      // Une monnaie demandée par-dessus (cf. surCreerMonnaie) : Échap ne ferme qu'elle.
      if (e.key === "Escape" && !creationMonnaieOuverte()) {
        e.stopPropagation();
        fermer(null);
      }
    };
    // « + Créer une monnaie », sous les monnaies : la monnaie créée rejoint la liste, cochée, sans rien
    // défaire de ce qui y était déjà choisi.
    const surCreerMonnaie = async () => {
      const deja = lireCompteMonnaies(listeMonnaies);
      const monnaie = await demanderCreationMonnaie();
      creerMonnaie.focus();
      if (!monnaie) return;
      renderCompteMonnaies([...deja, { monnaie_id: monnaie.id, solde_initial: 0 }], listeMonnaies);
    };
    const montrerErreur = (message) => {
      const p = document.createElement("p");
      p.className = "import-avertissement";
      p.textContent = message;
      erreur.replaceChildren(p);
      erreur.style.display = "";
    };
    const surEnvoi = async (e) => {
      e.preventDefault();
      const monnaies = choixMonnaies
        ? lireCompteMonnaies(listeMonnaies)
        : [{ monnaie_id: monnaiePreferee(allumees) }];
      // Le même refus que le formulaire de Paramètres → Configuration, avant le serveur.
      if (monnaies.length === 0) {
        montrerErreur(t("Choisis au moins une monnaie pour ce compte."));
        return;
      }
      creer.disabled = true;
      erreur.style.display = "none";
      try {
        const compte = await apiFetch("/comptes", {
          method: "POST",
          body: JSON.stringify({ nom: nom.value.trim(), type_id: Number(type.value), monnaies }),
        });
        await refreshComptes();
        showMessage(t("Compte créé"), "success");
        fermer(compte);
      } catch (err) {
        montrerErreur(traduireMessageServeur(err.message));
      } finally {
        creer.disabled = false;
      }
    };
    formulaire.addEventListener("submit", surEnvoi);
    plusTard.addEventListener("click", surPlusTard);
    creerMonnaie.addEventListener("click", surCreerMonnaie);
    document.addEventListener("keydown", surTouche, true);
  });
}

/** Crée une catégorie (le nom, puis le drapeau « entrées d'argent » par sa propre route : la création ne
 *  prend que le nom) et recharge la liste. Rend la catégorie créée ; lève l'erreur du serveur telle quelle. */
async function creerCategorieEtDrapeau(nom, estEntree) {
  let categorie = await apiFetch("/categories", {
    method: "POST",
    body: JSON.stringify({ nom }),
  });
  if (estEntree) {
    categorie = await apiFetch(`/categories/${categorie.id}/entree`, {
      method: "PUT",
      body: JSON.stringify({ est_entree: true }),
    });
  }
  await refreshCategories();
  return categorie;
}

/** La fenêtre qui crée une catégorie : un nom, et la case « Entrées d'argent ». Rend la catégorie créée
 *  (drapeau posé), ou null. */
function demanderCreationCategorie({ nomPropose = "" } = {}) {
  const fond = document.getElementById("modale-creation-categorie");
  const nom = document.getElementById("creation-categorie-nom");
  const entree = document.getElementById("creation-categorie-entree");
  const erreur = document.getElementById("creation-categorie-erreur");
  nom.value = nomPropose;
  entree.checked = false;
  erreur.style.display = "none";
  fond.style.display = "flex";
  nom.focus();

  return new Promise((resolve) => {
    const formulaire = document.getElementById("form-creation-categorie");
    const annuler = document.getElementById("btn-creation-categorie-annuler");
    const creer = document.getElementById("btn-creation-categorie-creer");
    const fermer = (reponse) => {
      fond.style.display = "none";
      formulaire.removeEventListener("submit", surEnvoi);
      annuler.removeEventListener("click", surAnnuler);
      document.removeEventListener("keydown", surTouche, true);
      resolve(reponse);
    };
    const surAnnuler = () => fermer(null);
    const surTouche = (e) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        fermer(null);
      }
    };
    const surEnvoi = async (e) => {
      e.preventDefault();
      creer.disabled = true;
      erreur.style.display = "none";
      try {
        const categorie = await creerCategorieEtDrapeau(nom.value.trim(), entree.checked);
        showMessage(t("Catégorie créée"), "success");
        fermer(categorie);
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
    annuler.addEventListener("click", surAnnuler);
    document.addEventListener("keydown", surTouche, true);
  });
}

/** La fenêtre de création d'une monnaie est-elle ouverte ? Elle peut l'être PAR-DESSUS celle d'un compte
 *  (« + Créer une monnaie » sous ses monnaies) : Échap ne ferme alors qu'elle. */
function creationMonnaieOuverte() {
  return document.getElementById("modale-creation-monnaie").style.display === "flex";
}

/**
 * La fenêtre qui crée une monnaie : un nom et un symbole, comme le formulaire de l'extension « Monnaies »
 * (même route, `POST /monnaies`). N'existe qu'avec l'extension : sans elle l'application n'a qu'une monnaie,
 * et la promesse rend null aussitôt. Rend la monnaie créée, ou null quand on a laissé tomber.
 */
function demanderCreationMonnaie({ nomPropose = "" } = {}) {
  if (!choixDeMonnaiePossible()) return Promise.resolve(null);
  const fond = document.getElementById("modale-creation-monnaie");
  const nom = document.getElementById("creation-monnaie-nom");
  const symbole = document.getElementById("creation-monnaie-symbole");
  const erreur = document.getElementById("creation-monnaie-erreur");
  nom.value = nomPropose;
  symbole.value = "";
  erreur.style.display = "none";
  fond.style.display = "flex";
  nom.focus();

  return new Promise((resolve) => {
    const formulaire = document.getElementById("form-creation-monnaie");
    const annuler = document.getElementById("btn-creation-monnaie-annuler");
    const creer = document.getElementById("btn-creation-monnaie-creer");
    const fermer = (reponse) => {
      fond.style.display = "none";
      formulaire.removeEventListener("submit", surEnvoi);
      annuler.removeEventListener("click", surAnnuler);
      document.removeEventListener("keydown", surTouche, true);
      resolve(reponse);
    };
    const surAnnuler = () => fermer(null);
    const surTouche = (e) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        fermer(null);
      }
    };
    const surEnvoi = async (e) => {
      e.preventDefault();
      creer.disabled = true;
      erreur.style.display = "none";
      try {
        const monnaie = await apiFetch("/monnaies", {
          method: "POST",
          body: JSON.stringify({ nom: nom.value.trim(), symbole: symbole.value.trim() }),
        });
        await refreshMonnaies();
        showMessage(t("Monnaie créée"), "success");
        fermer(monnaie);
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
    annuler.addEventListener("click", surAnnuler);
    document.addEventListener("keydown", surTouche, true);
  });
}

/**
 * Crée une monnaie (cf. demanderCreationMonnaie) et l'AJOUTE AU COMPTE : les menus de monnaie d'une
 * opération ne proposent que celles de son compte, une monnaie neuve qui n'y serait pas n'y apparaîtrait
 * jamais. Elle se range en dernier : la monnaie proposée par défaut reste la même. Rend la monnaie, ou null.
 */
async function creerMonnaiePourCompte(compteId) {
  const monnaie = await demanderCreationMonnaie();
  if (!monnaie) return null;
  const compte = compteParId(compteId);
  if (!compte) return monnaie;
  try {
    await apiFetch(`/comptes/${compte.id}`, {
      method: "PUT",
      body: JSON.stringify({
        monnaies: [
          ...compte.monnaies.map((m) => ({
            monnaie_id: m.monnaie_id,
            solde_initial: m.solde_initial,
            solde_actuel_renseigne: m.solde_actuel_renseigne ?? null,
            active: m.active !== false,
          })),
          { monnaie_id: monnaie.id, solde_initial: 0 },
        ],
      }),
    });
    await refreshComptes();
  } catch (err) {
    showMessage(traduireMessageServeur(err.message), "error");
    return null;
  }
  return monnaie;
}

/** Ce que fait la ligne « créer » d'une liste (cf. ajouterOptionCreer), relu à chaque choix : une liste
 *  remplie à nouveau peut changer de contexte sans être rebranchée. */
const CREER_SUR_LISTE = new WeakMap();

/** Sélectionne le premier vrai choix d'une liste : ni la ligne « créer », ni une ligne grisée. */
function choisirPremierChoix(select) {
  const premier = [...select.options].find((o) => o.value !== VALEUR_CREER && !o.disabled);
  if (premier) select.value = premier.value;
}

/** Le libellé de la ligne « créer », par nature de liste. */
const LIBELLES_CREER = {
  compte: "+ Créer un compte",
  categorie: "+ Créer une catégorie",
  monnaie: "+ Créer une monnaie",
};

/**
 * Ajoute « + Créer un compte » / « + Créer une catégorie » / « + Créer une monnaie » à une liste, à appeler
 * APRÈS chacun de ses remplissages (la ligne n'est jamais posée deux fois).
 *
 * LA LIGNE EST EN TÊTE, EN GRIS, ET UN TRAIT LA SÉPARE DU RESTE : posée en dernière ligne, sous des comptes
 * groupés par type ou vingt catégories, elle ne se voyait pas. Le trait est un <hr> et non une option
 * grisée : le navigateur le dessine dans la liste dépliée, et comme ce n'est pas une option, ni les flèches
 * ni la frappe d'une lettre ne peuvent s'y arrêter.
 *
 * Une liste sans aucun choix reçoit une ligne vide : sans elle, « créer » serait la seule option, donc déjà
 * sélectionnée, et choisir ce qui l'est déjà ne déclenche rien. Et comme le navigateur sélectionne d'office
 * la première option d'une liste, la ligne de tête ne doit jamais rester choisie : on retombe alors sur le
 * premier vrai choix.
 *
 * Par défaut, la liste est celle du formulaire d'opération (comptes, catégories). Ailleurs, et pour toute
 * liste de monnaies, `demander()` ouvre la fenêtre et rend ce qu'elle a créé (ou null), `remplir()` remplit
 * à nouveau les listes concernées.
 */
function ajouterOptionCreer(select, nature, { demander = null, remplir = null } = {}) {
  select.querySelectorAll("[data-ligne-creer]").forEach((el) => el.remove());
  const vide = ![...select.options].some((o) => o.value && o.value !== VALEUR_CREER);
  if (vide && ![...select.options].some((o) => o.value === "")) {
    select.insertBefore(new Option(t("— choisir —"), ""), select.firstChild);
  }
  const ligne = new Option(t(LIBELLES_CREER[nature]), VALEUR_CREER);
  ligne.className = "option-creer";
  ligne.dataset.ligneCreer = "1";
  const trait = document.createElement("hr");
  trait.dataset.ligneCreer = "1";
  select.prepend(ligne, trait);
  if (select.value === VALEUR_CREER) choisirPremierChoix(select);
  CREER_SUR_LISTE.set(select, { nature, demander, remplir });
  if (select.dataset.creerBranche) return;
  select.dataset.creerBranche = "1";
  select.dataset.precedent = select.value;
  // Relevé AUSSI quand on entre dans la liste : une valeur posée par le code (l'opération qu'on rouvre, cf.
  // fillOperationForm) ne passe par aucun « change », et « Plus tard » ramenait alors à un compte périmé.
  select.addEventListener("focus", () => {
    if (select.value !== VALEUR_CREER) select.dataset.precedent = select.value;
  });
  // EN PHASE DE CAPTURE, et on coupe la suite : les autres écouteurs du menu (monnaies du compte, case
  // « à déclarer », relecture du fichier à l'import) ne doivent jamais voir passer la ligne « créer » comme
  // un choix.
  select.addEventListener(
    "change",
    async (e) => {
      if (select.value !== VALEUR_CREER) {
        select.dataset.precedent = select.value;
        return;
      }
      e.stopImmediatePropagation();
      select.value = select.dataset.precedent || "";
      if (select.selectedIndex < 0 || select.value === VALEUR_CREER) choisirPremierChoix(select);
      const contexte = CREER_SUR_LISTE.get(select);
      let cree;
      if (contexte.demander) cree = await contexte.demander();
      else if (contexte.nature === "compte") {
        const type = document.getElementById("operation-type").value;
        cree = await demanderCreationCompte({
          typesAdmis: type === "virement" ? null : ["courant"],
          cle: "noyau.creation-compte-operation",
        });
      } else cree = await demanderCreationCategorie();
      if (!cree) return;
      // Les listes se remplissent à nouveau de ce que la base contient, la nouvelle comprise.
      (contexte.remplir || updateOperationTypeFields)();
      select.value = String(cree.id);
      select.dataset.precedent = select.value;
      select.dispatchEvent(new Event("change", { bubbles: true }));
    },
    true
  );
}

/* ---------- Dashboard ---------- */

function soldesAffiches(compte, monnaieId) {
  if (monnaieId == null) return compte.soldes;
  return compte.soldes.filter((s) => s.monnaie_id === monnaieId);
}

function renderComptesCards(
  gridId,
  comptes,
  { etiquette = "Courant", variante = "", monnaieId = null } = {}
) {
  const grid = document.getElementById(gridId);
  grid.innerHTML = "";
  if (comptes.length === 0) {
    grid.innerHTML = `<span class="hint">${
      monnaieId == null ? "Aucun compte." : "Aucun compte dans cette monnaie."
    }</span>`;
    return;
  }
  comptes.forEach((c) => {
    const card = document.createElement("div");
    card.className = variante ? `compte-card ${variante}` : "compte-card";
    // Repérage pour une extension qui voudrait compléter cette carte (le
    // total d'un compte de placements, par exemple) sans que le noyau ait à
    // la connaître.
    card.dataset.compteId = c.id;
    // Un groupe par monnaie, tous frères dans la même ligne flexible : c'est
    // elle qui décide de les mettre côte à côte ou de les retomber à la ligne
    // selon la largeur de la carte (cf. .compte-soldes-ligne).
    const soldes = soldesAffiches(c, monnaieId)
      .map(
        (s) => `
        <div class="compte-solde-groupe" data-monnaie-id="${s.monnaie_id}">
          <div class="compte-solde ${classeMontant(
            s.solde_reel,
            s.solde_reel < 0 ? "negatif" : ""
          )}">${formatMontant(
            s.solde_reel,
            s.monnaie_id
          )}</div>
          <div class="compte-projete">${t("Projeté")} : ${formatMontant(s.solde_projete, s.monnaie_id)}</div>
        </div>
      `
      )
      .join("");
    card.innerHTML = `
      <div class="compte-nom">
        <span>${c.nom}</span>
        <span class="compte-type-tag">${etiquette}</span>
      </div>
      <div class="compte-soldes-ligne">${soldes}</div>
    `;
    grid.appendChild(card);
  });
}

// LA PÉRIODE SE CHOISIT DANS L'ARBRE (cf. renderArbrePeriode) : Tout, l'année, le
// mois, les semaines — une seule pastille dit lequel pilote le dashboard.
async function loadDashboard() {
  try {
    await refreshMonnaies();
    await loadNoteDashboard();
    dashboardPeriodesConnues = await apiFetch("/meta/periodes"); // triées desc par (année, mois)
    if (dashboardPeriodesConnues.length === 0) return;
    const p = state.dashboardPeriode;
    if (!p.annee) {
      const defaut = periodeParDefaut(dashboardPeriodesConnues);
      p.annee = defaut.annee;
      p.mois = defaut.mois;
    }
    renderArbrePeriode();
    await loadDashboardData(p.annee, p.mois);
  } catch (err) {
    showMessage(err.message, "error");
  }
}

async function loadDashboardData(annee, mois) {
  // Posé AVANT le fetch, pas après : un drill-through déclenché pendant que
  // la requête est en vol doit déjà voir la BONNE période (cf.
  // dashboardAnneeMoisActuel, drillThroughCategorie).
  dashboardAnneeMoisActuel = { annee, mois };
  // Les semaines se relisent avec le reste : une opération a pu
  // changer depuis. Seul un geste de l'arbre qui ne change pas de données (une
  // autre semaine du même mois) garde ce qu'on a déjà.
  dashboardSemainesDonnees = null;
  try {
    const vue = state.dashboardPeriode.vue;
    const url =
      vue === "tout"
        ? "/dashboard?vue=tout"
        : vue === "annee"
          ? `/dashboard?annee=${annee}&vue=annee`
          : `/dashboard?annee=${annee}&mois=${mois}`;
    const data = await apiFetch(url);

    // LES MONNAIES ÉTEINTES « EN POP-UP » (cf. modeMonnaiesEteintes) : seules les
    // allumées ont un onglet ; ce qui a été converti vers une éteinte devient une
    // colonne grise de l'histogramme et du camembert, qui ouvre son détail.
    const enPopup = modeMonnaiesEteintes() === "popup";
    const ongletPossible = (monnaieId) => !(enPopup && monnaieEstEteinte(monnaieId));
    const kpisOnglets = data.kpis.filter((k) => ongletPossible(k.monnaie_id));

    // Un onglet par monnaie pilote tout le dashboard : les KPI et
    // l'histogramme. La sélection survit d'un rechargement à l'autre tant que
    // la monnaie existe encore.
    if (!kpisOnglets.some((k) => k.monnaie_id === state.dashboardMonnaieId)) {
      state.dashboardMonnaieId = monnaiePreferee(kpisOnglets.map((k) => k.monnaie_id));
    }
    await chargerConversionsDashboard(enPopup, annee, mois);

    renderOngletsMonnaies(
      "dashboard-monnaies",
      data.monnaies.filter((m) => ongletPossible(m.id)),
      state.dashboardMonnaieId,
      (choisie) => {
        state.dashboardMonnaieId = choisie;
        loadDashboardData(annee, mois);
      }
    );

    renderKpisDashboard(data.kpis.find((k) => k.monnaie_id === state.dashboardMonnaieId) || null);
    // EN DERNIER : le détail par semaine est un supplément, replié neuf fois
    // sur dix — il ne doit pas retarder l'affichage des chiffres du mois. C'est
    // lui qui pose le libellé de période du titre, la semaine choisie en
    // faisant partie.
    await majDetailSemaines(annee, mois);
  } catch (err) {
    showMessage(err.message, "error");
  }
}

/* ---------- Les conversions vers les monnaies éteintes, au dashboard ----------
 *
 * « EN POP-UP » SEULEMENT (cf. modeMonnaiesEteintes) : une monnaie éteinte n'y a plus
 * d'onglet, et sans cette colonne l'argent parti vers elle ne se verrait NULLE PART. « Sur
 * la page », elle a son onglet : l'argent s'y voit arriver, la colonne serait un doublon.
 * Lues dans la cascade de la monnaie de l'onglet sur la période affichée (cf.
 * services/cascade.py), au net des deux sens et aux montants enregistrés, avec deux
 * drill-throughs — les virements, et le détail de la monnaie éteinte. `contexteGraphesDashboard` les ajoute aux barres de
 * la période entière — pas à une semaine ni à une moyenne, qu'elles ne découpent pas.
 *
 * LES FRAIS DE VIREMENTS, EUX, VIENNENT DU SERVEUR avec les autres barres (cf.
 * soldes._barre_frais_virements) : ils comptent dans « Total Dépenses », l'histogramme
 * doit donc les porter lui-même, semaines comprises.
 */
let dashboardConversions = [];

async function chargerConversionsDashboard(enPopup, annee, mois) {
  dashboardConversions = [];
  const monnaieId = state.dashboardMonnaieId;
  if (!enPopup || monnaieId == null) return;
  if (!(state.monnaies || []).some((m) => m.active === false)) return;
  const vue = state.dashboardPeriode.vue;
  const requete =
    vue === "tout"
      ? "vue=tout"
      : vue === "annee"
        ? `vue=annee&annee=${annee}`
        : `vue=mois&annee=${annee}&mois=${mois}`;
  try {
    const cascade = await apiFetch(`/dashboard/cascade?monnaie_id=${monnaieId}&${requete}`);
    const colonnes = cascade.colonnes || [];
    dashboardConversions = colonnes
      .filter((c) => c.genre === "conversion" && monnaieEstEteinte(c.monnaie_autre_id))
      .map((c) =>
        barreConversion(monnaieId, c, {
          ouvrir: () =>
            ouvrirFenetreMonnaieEteinte(c.monnaie_autre_id, {
              origine: { monnaieId, colonne: c },
            }),
          voirOperations: () => drillThroughConversion(monnaieId, c),
        })
      );
  } catch (err) {
    // UN SUPPLÉMENT QUI TOMBE EN PANNE NE DOIT PAS AVALER LE DASHBOARD : les barres
    // des catégories restent justes sans lui.
    dashboardConversions = [];
  }
}

/**
 * « Voir les virements » d'une colonne de conversion : la page Opérations, onglet des
 * virements, filtrée sur la période affichée et sur le sens du net — de la monnaie de
 * l'onglet vers la monnaie éteinte, ou l'inverse.
 */
async function drillThroughConversion(monnaieId, colonne, bornes = null) {
  // `bornes` : la période de la page Budget ou de la fenêtre d'où l'on vient. Sans elles,
  // celle du dashboard.
  if (!bornes) {
    const { annee, mois } = dashboardAnneeMoisActuel;
    if (!annee) return;
    bornes = bornesPeriodeHistogramme(annee, mois);
  }
  fermerFenetreMonnaieEteinte();
  const { debut, fin } = bornes;
  const versAutre = colonne.montant < 0;
  switchSection("operations");
  await loadOperations();
  document.querySelector('#operations-sous-nav button[data-sous-section="virements"]')?.click();
  const panneau = document.getElementById("filtres-virements");
  panneau.querySelector('[data-filtre="monnaieEnvoyeeId"]').value = String(
    versAutre ? monnaieId : colonne.monnaie_autre_id
  );
  panneau.querySelector('[data-filtre="monnaieRecueId"]').value = String(
    versAutre ? colonne.monnaie_autre_id : monnaieId
  );
  panneau.querySelector('[data-filtre="dateDebut"]').value = debut;
  panneau.querySelector('[data-filtre="dateFin"]').value = fin;
  ouvrirFiltresOnglet("virements");
  if (!synchroniserPeriodeAvecFiltres("virements")) trierEtRerender("virements");
}

/* ---------- Répartition des avoirs, page Vue des avoirs ---------- */

// Le dernier /dashboard lu par cette page. Gardé pour que changer la monnaie du
// camembert le redessine sans nouvel aller-retour : les soldes n'ont pas changé
// entre-temps, seule la monnaie qu'on regarde change.
let comptesGlobaleDernier = null;

/**
 * Le menu de monnaies du camembert, et le camembert lui-même.
 *
 * UNE LISTE DÉROULANTE, ET NON DES ONGLETS comme sur le dashboard : ici la
 * monnaie ne pilote qu'un seul élément de la page, pas l'écran entier. Une
 * rangée d'onglets en haut de page aurait laissé croire que les cartes de
 * compte en dessous s'y plient aussi, alors qu'elles montrent toutes leurs
 * monnaies.
 *
 * LA SÉLECTION SURVIT d'une visite à l'autre tant que la monnaie existe encore
 * (cf. state.comptesRepartitionMonnaieId) ; à défaut, la première de la liste.
 *
 * Une extension peut poser une case à côté du menu (« tout convertir »,
 * extension « Monnaies ») : elle se greffe sur cette fonction, qui reste donc
 * le seul endroit d'où le camembert est dessiné.
 */
function renderRepartitionAvoirs() {
  const data = comptesGlobaleDernier;
  const menu = document.getElementById("globale-repartition-monnaie");
  if (!data || !menu) return;

  const monnaies = data.monnaies || [];
  if (!monnaies.some((m) => m.id === state.comptesRepartitionMonnaieId)) {
    state.comptesRepartitionMonnaieId = monnaiePreferee(monnaies.map((m) => m.id));
  }
  menu.innerHTML = monnaies
    .map(
      (m) =>
        `<option value="${m.id}" ${
          m.id === state.comptesRepartitionMonnaieId ? "selected" : ""
        }>${escapeHtml(m.nom)}</option>`
    )
    .join("");
  // Un menu à un seul choix ne choisit rien : il est masqué avec son étiquette
  // tant que l'app est mono-devise, comme la barre d'onglets de cette page
  // l'est tant qu'elle n'a qu'un onglet.
  menu.parentElement.style.display = monnaies.length > 1 && choixDeMonnaiePossible() ? "" : "none";

  const monnaieId = state.comptesRepartitionMonnaieId;
  const kpis = (data.kpis || []).find((k) => k.monnaie_id === monnaieId);
  renderRepartitionComptes(
    data.comptes,
    monnaieId,
    kpis ? kpis.valorisation_placements : 0
  );
}

document
  .getElementById("globale-repartition-monnaie")
  .addEventListener("change", (e) => {
    state.comptesRepartitionMonnaieId = Number(e.target.value);
    renderRepartitionAvoirs();
  });

/**
 * VUE GLOBALE DES COMPTES : les mêmes cartes qu'affichait le dashboard avant
 * d'en être retirées, mais SANS onglet de monnaie — cf. renderComptesCards,
 * dont `monnaieId` est ici laissé à `null`. Un compte multi-devises y montre
 * donc TOUS ses soldes empilés sur une seule carte plutôt qu'un seul, filtré
 * par l'onglet actif : aucune monnaie n'est privilégiée, et rien n'est
 * additionné entre elles (l'app ne connaît aucun taux de change).
 *
 * Réutilise /dashboard (période du mois courant, par défaut côté serveur)
 * plutôt qu'un nouvel endpoint : c'est déjà exactement les soldes réel et
 * projeté par compte et par monnaie dont cette page a besoin, et cette page
 * n'a pas de sélecteur de période à elle — juste "où j'en suis maintenant".
 */
async function loadComptesGlobale() {
  try {
    await refreshMonnaies();
    const data = await apiFetch("/dashboard");

    // Le camembert d'abord : il résume ce que les cartes détaillent ensuite.
    // `data` est gardé de côté pour que changer de monnaie le redessine SANS
    // redemander le dashboard — rien d'autre que la monnaie n'a changé.
    comptesGlobaleDernier = data;
    renderRepartitionAvoirs();

    renderComptesCards(
      "globale-comptes-courants",
      data.comptes.filter((c) => !TYPES_COMPTE_HORS_COURANT.has(c.type_nom))
    );
    const comptesEpargne = data.comptes.filter((c) => c.type_nom === "épargne");
    document.getElementById("globale-bloc-epargne").style.display =
      comptesEpargne.length > 0 ? "" : "none";
    renderComptesCards("globale-comptes-epargne", comptesEpargne, {
      etiquette: "Épargne",
      variante: "epargne",
    });
    const comptesPlacement = data.comptes.filter((c) => c.type_nom === TYPE_COMPTE_PLACEMENT);
    document.getElementById("globale-bloc-placements").style.display =
      comptesPlacement.length > 0 ? "" : "none";
    renderComptesCards("globale-comptes-placements", comptesPlacement, {
      etiquette: "Placements",
      variante: "placements",
    });
  } catch (err) {
    showMessage(err.message, "error");
  }
}

// Les barres du MOIS affiché, telles que le serveur vient de les rendre.
// Gardées de côté parce que cocher puis décocher une semaine doit pouvoir
// redessiner le mois sans redemander le dashboard (cf.
// renderHistogrammeDashboard).
let dashboardDepensesDuMois = [];

// LE BUDGET TOTAL DE LA MÊME PÉRIODE, gardé pour la même raison : c'est le
// dénominateur de la vue budget du camembert, et basculer d'une vue à l'autre
// ne doit pas coûter un aller-retour. Zéro = aucun budget posé.
let dashboardBudgetTotalDuMois = 0;

function renderKpisDashboard(kpis) {
  // LA CARTE « RESTE À REMBOURSER » N'EXISTE QUE SI QUELQU'UN LA REMPLIT. Ses
  // deux côtés sont gardés par une extension chacun — ce qu'on me doit par
  // « Suivi des remboursements », ce que je dois par « Prêts » (cf.
  // soldes.get_reste_a_rembourser) : sans ni l'une ni l'autre, elle annonce un
  // 0,00 € qui ne veut rien dire et qui prend le tiers de la rangée.
  //
  // ICI ET PAS PAR `data-extension-onglet` : cet attribut ne nomme qu'UNE
  // extension, et la carte en sert deux. Posé à chaque rendu, donc rattrapé au
  // retour sur le dashboard quand on allume l'une d'elles — allumer une
  // extension ne recharge pas cet écran, comme pour la vue budget du camembert.
  const carteRemboursements = document.getElementById("kpi-carte-remboursements");
  if (carteRemboursements) {
    const utile =
      BudgetApp.extensions.estActive("suivi-remboursements") ||
      BudgetApp.extensions.estActive("prets");
    carteRemboursements.style.display = utile ? "" : "none";
  }
  if (!kpis) {
    // Aucun compte, donc aucune monnaie en jeu : rien à agréger.
    [
      "kpi-solde-total",
      "kpi-solde-projete",
      "kpi-total-avoirs",
      "kpi-variation",
      "kpi-variation-attribuee",
      "kpi-total-entrees",
      "kpi-total-sorties",
      "kpi-reste-rembourser",
    ].forEach((id) => (document.getElementById(id).textContent = "-"));
    document.getElementById("kpi-reste-rembourser-detail").textContent = "";
    dashboardDepensesDuMois = [];
    dashboardBudgetTotalDuMois = 0;
    renderHistogrammeDashboard([], null);
    return;
  }
  const monnaieId = kpis.monnaie_id;

  // Cartes KPI : les 3 premières excluent l'épargne (soumise uniquement à
  // des virements internes) ; "Total des avoirs" est la seule à tout inclure.
  document.getElementById("kpi-solde-total").textContent = formatMontant(
    kpis.solde_total_courant,
    monnaieId
  );
  document.getElementById("kpi-solde-projete").textContent = formatMontant(
    kpis.solde_projete_courant,
    monnaieId
  );
  document.getElementById("kpi-total-avoirs").textContent = formatMontant(
    kpis.total_avoirs,
    monnaieId
  );
  // LA VARIATION BRUTE, et non celle des flux : ce qui est PASSÉ sur les
  // comptes, à sa date et pour son montant, sans étaler une dépense amortie ni
  // retrancher ce qu'on nous rendra d'une dépense remboursable (cf.
  // services/soldes.get_variation_brute). C'est la question qu'on se pose
  // devant un relevé — ce que le mois COÛTE se lit dans « Total Dépenses », posé
  // juste à côté, qui répond à une autre question et n'a donc jamais le même
  // chiffre.
  //
  // SA CARTE EST DESCENDUE DANS LA RANGÉE DU BAS, contre le sélecteur de
  // période : ce chiffre se recalcule à chaque changement de mois, il n'avait
  // rien à faire dans une rangée dont tout le reste est un état du jour. Seule
  // sa PLACE a changé — le calcul, lui, est le même.
  //
  // ELLE NE PORTE PLUS NI « positif » NI « negatif » : sa couleur est fixe, le
  // jaune (cf. .flux-valeur-brute dans style.css). Ces deux classes disent
  // « la période a rapporté » ou « la période a coûté » — un jugement que ce
  // chiffre-ci ne prononce pas, et qui l'aurait fait lire comme une seconde
  // version de la « variation attribuée » posée juste à sa gauche. C'est
  // celle-là qui porte désormais le code couleur, et elle seule.
  const variationEl = document.getElementById("kpi-variation");
  const variation = kpis.variation_brute || 0;
  variationEl.textContent = `${
    variation >= 0 && !montantEstNul(variation) ? "+" : ""
  }${formatMontant(variation, monnaieId)}`;
  variationEl.classList.toggle("montant-nul", montantEstNul(variation));
  // LE TITRE SUIT LA VUE : ce chiffre se recalcule sur la période choisie, et
  // « Variation du mois » au-dessus d'un total ANNUEL ne se contentait pas
  // d'être imprécis — il annonçait le mauvais ordre de grandeur. C'est le seul
  // libellé de la carte depuis que les sous-textes ont été retirés ; le mois
  // exact, lui, se lit dans le sélecteur de période juste en dessous.
  // `firstChild` et non `textContent` : la carte porte une pastille « i » que
  // réécrire tout le libellé emporterait.
  const vueKpi = state.dashboardPeriode.vue;
  document.getElementById("kpi-variation-label").firstChild.nodeValue =
    LIBELLES_VARIATION[vueKpi].brute();
  // Le libellé de l'attribuée suit la même vue, pour la même raison : « au
  // mois » au-dessus d'un total ANNUEL n'est pas seulement imprécis, il annonce
  // le mauvais ordre de grandeur.
  document.getElementById("kpi-variation-attribuee-label").firstChild.nodeValue =
    LIBELLES_VARIATION[vueKpi].attribuee();

  renderResteARembourser(kpis, monnaieId);
  renderFluxPeriode(kpis, monnaieId);
  dashboardDepensesDuMois = kpis.depenses_par_categorie || [];
  dashboardBudgetTotalDuMois = kpis.budget_total || 0;
  renderHistogrammeDashboard(dashboardDepensesDuMois, monnaieId);
}

// Les deux libellés des variations, selon la vue : « au mois » au-dessus d'un total
// ANNUEL — ou de toute l'histoire — annoncerait le mauvais ordre de grandeur.
const LIBELLES_VARIATION = {
  mois: {
    brute: () => t("Variation sur le mois brute"),
    attribuee: () => t("Variation attribuée au mois"),
  },
  annee: {
    brute: () => t("Variation sur l'année brute"),
    attribuee: () => t("Variation attribuée à l'année"),
  },
  tout: {
    brute: () => t("Variation sur tout l'historique brute"),
    attribuee: () => t("Variation attribuée à tout l'historique"),
  },
};

/**
 * Total Entrées et Total Dépenses — deux des trois chiffres posés sous le
 * sélecteur de période, à côté de l'histogramme qu'ils résument. Le troisième,
 * « Variation », est écrit par renderKpisDashboard.
 *
 * LES DEUX RANGÉES DE CARTES SE PARTAGENT LE TRAVAIL SELON LE TEMPS : en haut
 * ce qui ne dépend PAS du sélecteur (solde, reste à rembourser, avoirs), ici ce
 * qui se recalcule à chaque changement de mois. « Reste à rembourser » est donc
 * monté là-haut et « Variation » descendue ici — chacune était du mauvais côté,
 * et il fallait lire une infobulle pour savoir laquelle suivait le sélecteur.
 *
 * L'ANCIENNE CARTE « DIFFÉRENCE » EST DE RETOUR, sous son vrai nom :
 * « Variation attribuée au mois ». Elle avait été retirée parce qu'elle
 * répétait, à un signe près, la variation affichée alors en haut de page — deux
 * chiffres pour une seule mesure, dont l'un devait finir par sembler faux. Ce
 * n'est plus le cas depuis que la carte d'à côté porte la variation BRUTE : les
 * deux ne mesurent plus la même chose, et leur ÉCART est exactement ce qu'on
 * cherchait à rendre lisible — le décalage entre le moment où l'argent sort du
 * compte et le mois auquel la dépense appartient.
 */
function renderFluxPeriode(kpis, monnaieId) {
  const entrees = kpis.total_entrees || 0;
  const sorties = kpis.total_sorties || 0;
  // MÊME RÈGLE QUE PARTOUT : zéro ne porte pas de signe. Ici le « + » et le
  // « − » sont écrits à la main, ils ne passent donc pas par le garde-fou de
  // `formatMontant` et doivent être tus explicitement — « −0,00 € » de sorties
  // se lit comme un mouvement, alors qu'il n'y en a eu aucun.
  const signe = (valeur, prefixe) =>
    `${montantEstNul(valeur) ? "" : prefixe}${formatMontant(valeur, monnaieId)}`;
  document.getElementById("kpi-total-entrees").textContent = signe(entrees, "+");
  // Le signe est porté par le libellé (« dépenses ») autant que par la couleur :
  // un total de dépenses s'écrit en positif, c'est une somme dépensée.
  document.getElementById("kpi-total-sorties").textContent = signe(sorties, "−");

  // LA VARIATION ATTRIBUÉE : entrées moins dépenses, c'est-à-dire la différence
  // des deux cartes qu'on vient d'écrire, et rien d'autre.
  //
  // CALCULÉE ICI ET NON PAR LE SERVEUR, délibérément. Ce chiffre n'est pas une
  // mesure de plus à aller chercher : c'est la soustraction des deux qui sont
  // déjà à l'écran, et l'utilisateur doit pouvoir la refaire de tête. Une route
  // qui la rendrait aurait ouvert la porte à ce qu'elle cesse, un jour, de
  // tomber juste avec les deux montants affichés juste à côté — précisément le
  // défaut qui avait fait retirer l'ancienne carte « Différence ».
  //
  // `sorties` est un montant POSITIF (un total dépensé s'écrit en positif, cf.
  // ci-dessus) : on le retranche, on ne l'ajoute pas.
  // Le détail des deux cartes qu'on vient d'écrire (cf. attacherInfobulleFlux).
  attacherInfobulleFlux(kpis, monnaieId);

  const attribuee = entrees - sorties;
  const attribueeEl = document.getElementById("kpi-variation-attribuee");
  attribueeEl.textContent = `${
    attribuee > 0 && !montantEstNul(attribuee) ? "+" : ""
  }${formatMontant(attribuee, monnaieId)}`;
  // ELLE, ET PLUS LA BRUTE, PORTE LE CODE COULEUR ROUGE / VERT : c'est elle qui
  // répond à « la période a-t-elle coûté ou rapporté ». La brute est en jaune,
  // fixe, parce qu'elle ne prononce aucun jugement (cf. renderKpisDashboard).
  attribueeEl.classList.toggle("positif", attribuee > 0 && !montantEstNul(attribuee));
  attribueeEl.classList.toggle("negatif", attribuee < 0 && !montantEstNul(attribuee));
  attribueeEl.classList.toggle("montant-nul", montantEstNul(attribuee));

  // LA PORTE DU DÉTAIL NE S'OUVRE QUE S'IL Y A QUELQUE CHOSE DERRIÈRE. Sans
  // écart entre les deux variations, la page ne contiendrait qu'un tableau vide
  // — un bouton qui promet une explication et n'en donne aucune apprend surtout
  // à ne plus cliquer dessus.
  //
  // L'ÉCART EST CALCULÉ ICI, sur les deux chiffres déjà affichés, et non demandé
  // au serveur : c'est la même soustraction que celle de la page, et la faire
  // faire par une requête juste pour savoir s'il faut montrer un bouton aurait
  // coûté un aller-retour à chaque changement de mois.
  const ecart = (kpis.variation_brute || 0) - attribuee;
  const bouton = document.getElementById("btn-ecart-variations");
  if (bouton) bouton.style.display = montantEstNul(ecart) ? "none" : "";
}

/**
 * « Reste à rembourser » : le net, et sous lui les deux montants dont il est
 * fait. Carte de la rangée du HAUT, parce que c'est un STOCK — l'état des
 * créances et des dettes aujourd'hui, que changer de mois ne bouge pas.
 *
 * POURQUOI LE DÉTAIL. Un net à zéro peut aussi bien vouloir dire « personne ne
 * me doit rien » que « on me doit 500 € et j'en dois 500 » — deux situations qui
 * n'appellent pas les mêmes gestes. La ligne du dessous les sépare sans
 * demander un clic.
 *
 * LE SIGNE DIT LE SENS : positif, on me doit de l'argent (vert) ; négatif, j'en
 * dois (rouge). C'est la même convention que la variation du mois, et c'est ce
 * qui permet de lire la carte sans lire son libellé.
 *
 * PAS DE DÉTAIL QUAND IL N'Y A RIEN À DÉTAILLER : sans dette — l'extension
 * « Prêts » éteinte, ou aucun prêt en cours — le net EST la créance, et répéter
 * le même chiffre en dessous n'apprendrait rien.
 */
function renderResteARembourser(kpis, monnaieId) {
  const aRecevoir = kpis.reste_a_recevoir || 0;
  const aRendre = kpis.reste_a_rendre || 0;
  const net = kpis.reste_a_rembourser || 0;

  const valeurEl = document.getElementById("kpi-reste-rembourser");
  valeurEl.textContent = `${net > 0 && !montantEstNul(net) ? "+" : ""}${formatMontant(
    net,
    monnaieId
  )}`;
  valeurEl.classList.toggle("positif", net > 0 && !montantEstNul(net));
  valeurEl.classList.toggle("negatif", net < 0 && !montantEstNul(net));
  valeurEl.classList.toggle("montant-nul", montantEstNul(net));

  const detailEl = document.getElementById("kpi-reste-rembourser-detail");
  detailEl.textContent = montantEstNul(aRendre)
    ? ""
    : `${t("on te doit")} ${formatMontant(aRecevoir, monnaieId)} · ${t(
        "tu dois"
      )} ${formatMontant(aRendre, monnaieId)}`;
}

/* ---------- D'où vient l'écart entre les deux variations ----------
 *
 * CE QUE CET ÉCRAN RÉSOUT. Le dashboard pose deux chiffres côte à côte qui ne
 * tombent jamais d'accord, et leurs infobulles expliquent POURQUOI c'est normal.
 * « C'est normal » n'est pourtant pas une réponse : devant 400 € d'écart, la
 * seule question utile est « lesquelles ? ». Rien dans l'application ne pouvait
 * y répondre — il fallait ouvrir Opérations et refaire les additions à la main.
 *
 * IL NE CALCULE RIEN. Les deux totaux, les lignes et leurs contributions
 * viennent tous de `/dashboard/ecart-variations` (cf.
 * services.soldes.get_ecart_variations, un miroir exact des deux calculs qu'il
 * compare). Recalculer ici la moindre de ces valeurs aurait ouvert la porte à un
 * détail qui ne totalise pas le chiffre qu'il détaille.
 */

// Ce que chaque raison veut dire, en une ligne. Le serveur rend un CODE
// (`amortissement`, `remboursable`, `pret`, `reglement`) et l'écran écrit la
// phrase : c'est elle qui se traduit, et elle qui se réécrit sans toucher au
// calcul.
const ECART_RAISONS = {
  amortissement: "Dépense étalée",
  remboursable: "Dépense remboursable",
  pret: "Prêt reçu",
  reglement: "Règlement",
};

function libelleRaisonEcart(raison) {
  return t(ECART_RAISONS[raison] || raison);
}

/**
 * Un montant SIGNÉ du point de vue du compte, avec sa couleur.
 *
 * Les trois colonnes de chiffres de ce tableau se lisent ensemble — « au
 * compte », « au mois », et leur différence — et les trois peuvent être
 * négatives ou positives indépendamment : une dépense étalée apporte −1 200 au
 * compte le mois du paiement, 0 les mois suivants, et son écart change de signe
 * entre les deux. Sans couleur ni signe explicite, il faudrait relire l'en-tête
 * à chaque ligne pour savoir dans quel sens lire le nombre.
 */
function celluleMontantEcart(valeur, monnaieId) {
  const nul = montantEstNul(valeur);
  const classe = nul ? "montant-nul" : valeur > 0 ? "positif" : "negatif";
  const signe = valeur > 0 && !nul ? "+" : "";
  return `<td class="num ${classe}">${signe}${formatMontant(valeur, monnaieId)}</td>`;
}

async function loadEcartVariations() {
  const monnaieId = state.dashboardMonnaieId;
  if (!monnaieId) return;
  const { annee, mois } = dashboardAnneeMoisActuel;
  if (!annee) return;

  // LA MÊME PÉRIODE QUE LE DASHBOARD, reprise de l'état posé au moment du
  // chargement (cf. dashboardAnneeMoisActuel) plutôt que relue du sélecteur :
  // c'est l'écart des chiffres AFFICHÉS qu'on vient expliquer, pas celui d'un
  // mois qu'on aurait changé entre-temps.
  //
  // LA VUE ANNUELLE PASSE `mois` À VIDE, exactement comme le dashboard : les
  // deux variations s'y calculent sur douze mois, leur écart aussi.
  const vue = state.dashboardPeriode.vue;
  const params = new URLSearchParams({ monnaie_id: monnaieId, annee });
  if (vue === "tout") params.set("tout", "true");
  else if (vue === "mois") params.set("mois", mois);

  try {
    const detail = await apiFetch(`/dashboard/ecart-variations?${params}`);

    // Les libellés suivent la vue, comme sur le dashboard : « au mois » au-dessus
    // d'un total annuel annoncerait le mauvais ordre de grandeur.
    document.getElementById("ecart-attribuee-label").firstChild.nodeValue =
      LIBELLES_VARIATION[vue].attribuee();
    document.getElementById("ecart-brute-label").firstChild.nodeValue =
      LIBELLES_VARIATION[vue].brute();

    const ecrire = (id, valeur, colorer = true) => {
      const el = document.getElementById(id);
      const nul = montantEstNul(valeur);
      el.textContent = `${valeur > 0 && !nul ? "+" : ""}${formatMontant(valeur, monnaieId)}`;
      if (!colorer) return;
      el.classList.toggle("positif", valeur > 0 && !nul);
      el.classList.toggle("negatif", valeur < 0 && !nul);
      el.classList.toggle("montant-nul", nul);
    };
    ecrire("ecart-attribuee", detail.variation_attribuee);
    // La brute garde sa couleur fixe, ici comme sur le dashboard : elle ne dit
    // pas si la période a été bonne, elle dit ce qui est passé.
    ecrire("ecart-brute", detail.variation_brute, false);
    ecrire("ecart-total", detail.ecart);

    const lignes = detail.lignes || [];
    document.getElementById("ecart-vide").style.display = lignes.length ? "none" : "";
    document.querySelector(".ecart-table").style.display = lignes.length ? "" : "none";

    document.getElementById("ecart-lignes").innerHTML = lignes
      .map(
        (ligne) => `
        <tr data-operation="${ligne.operation_id}">
          <td>${formatDate(ligne.date)}</td>
          <td>${
            ligne.nature
              ? escapeHtml(ligne.nature)
              : `<span class="hint">${t("Sans libellé")}</span>`
          }${
            ligne.categorie_nom
              ? ` <i class="ecart-categorie">${escapeHtml(libelleCategorie(ligne.categorie_nom))}</i>`
              : ""
          }</td>
          <td>${escapeHtml(ligne.compte_nom)}</td>
          <td><span class="ecart-raison ecart-raison-${ligne.raison}">${escapeHtml(
            libelleRaisonEcart(ligne.raison)
          )}</span></td>
          ${celluleMontantEcart(ligne.contribution_brute, monnaieId)}
          ${celluleMontantEcart(ligne.contribution_attribuee, monnaieId)}
          ${celluleMontantEcart(ligne.ecart, monnaieId)}
        </tr>`
      )
      .join("");
  } catch (err) {
    showMessage(err.message, "error");
  }
}

document.getElementById("btn-ecart-variations").addEventListener("click", () => {
  // `ongletActif` : cet écran n'a pas de bouton à lui dans la barre du haut.
  // Sans ce second argument, aucun onglet ne resterait allumé et l'application
  // aurait l'air d'avoir quitté toutes ses pages.
  switchSection("ecart-variations", { ongletActif: "dashboard" });
  loadEcartVariations();
});

// La sortie : on revient d'où l'on vient, jamais ailleurs.
document
  .getElementById("btn-ecart-retour")
  .addEventListener("click", () => switchSection("dashboard"));

/* ---------- Répartition des avoirs par type de compte (camembert) ---------- */

/**
 * La couleur d'un type de compte, lue depuis les variables CSS `--compte-*`
 * plutôt que dupliquée ici : ce sont les MÊMES qui bordent les cartes de la
 * Vue des avoirs (cf. style.css, .compte-card.epargne/.placements),
 * une seule source évite que les deux dérivent l'une de l'autre au premier
 * changement de teinte.
 */
function couleurTypeCompte(cle) {
  return getComputedStyle(document.documentElement).getPropertyValue(`--compte-${cle}`).trim();
}

// Les trois familles, dans l'ordre où elles apparaissent en légende ET sur la
// Vue des avoirs : courant, épargne, placements. `test` reprend
// exactement le filtrage déjà utilisé par loadDashboardData/loadComptesGlobale
// (un type personnalisé, ni épargne ni placement, est un compte courant).
const TYPES_REPARTITION_COMPTES = [
  { cle: "courant", etiquette: "Comptes courants", test: (typeNom) => !TYPES_COMPTE_HORS_COURANT.has(typeNom) },
  { cle: "epargne", etiquette: "Comptes d'épargne", test: (typeNom) => typeNom === "épargne" },
  { cle: "placements", etiquette: "Comptes de placements", test: (typeNom) => typeNom === TYPE_COMPTE_PLACEMENT },
];

/**
 * Le camembert « Répartition des avoirs » : quelle part du solde réel total
 * (dans la monnaie de l'onglet actif) se trouve sur chaque type de compte.
 *
 * SOLDE RÉEL, PAS PROJETÉ. Le solde projeté anticipe des opérations qui n'ont
 * pas encore eu lieu : la répartition doit répondre à « où est mon argent
 * aujourd'hui », pas à une hypothèse sur le mois prochain — cohérent avec les
 * cartes de la Vue des avoirs, qui affichent le réel en premier.
 *
 * LES TITRES DÉTENUS COMPTENT, et c'est bien « Total des avoirs » que ce
 * camembert répartit — le chiffre affiché juste au-dessus de lui.
 *
 * Il n'en était rien auparavant : ne sommant que les espèces, il rendait la
 * part « placements » d'un compte-titres dont l'argent est investi, c'est-à-dire
 * à peu près zéro, souvent négatif. Le graphe contredisait donc le total qu'il
 * était censé détailler.
 *
 * CE N'EST PAS COMPTER DEUX FOIS — c'était le raisonnement d'avant, et il était
 * faux. Acheter un titre RETIRE l'argent du solde en espèces du compte pour le
 * convertir en titres : les deux ne se recouvrent jamais, ils se complètent.
 * C'est exactement ce que fait `calculer_totaux_par_monnaie` pour
 * `total_avoirs`, et les deux chiffres se répondent enfin.
 *
 * DONUT PAR STROKE-DASHARRAY, pas par arcs SVG : avec trois parts seulement
 * (dont potentiellement une à 100 %), les arcs `<path>` dégénèrent aux bords
 * (un secteur plein cercle n'a pas d'arc valide). Empiler des `<circle>` avec
 * un `stroke-dasharray` proportionnel à la circonférence n'a pas ce problème,
 * quelle que soit la répartition.
 */
function renderRepartitionComptes(comptes, monnaieId, valorisationPlacements = 0) {
  const container = document.getElementById("globale-repartition-comptes");
  if (!container) return;
  if (!monnaieId) {
    // Aucune monnaie en jeu (base sans compte) : rien à répartir.
    container.innerHTML = "";
    return;
  }

  const parts = TYPES_REPARTITION_COMPTES.map((type) => {
    const especes = comptes
      .filter((c) => type.test(c.type_nom))
      .reduce((somme, c) => {
        const solde = c.soldes.find((s) => s.monnaie_id === monnaieId);
        return somme + (solde ? solde.solde_reel : 0);
      }, 0);
    // La valorisation des titres n'appartient qu'à la part « placements » : un
    // titre est détenu sur un compte-titres, et le serveur ne la rend que pour
    // la monnaie de cotation (cf. KpisMonnaieRead.valorisation_placements).
    const montant =
      especes + (type.cle === "placements" ? valorisationPlacements || 0 : 0);
    return { ...type, montant, couleur: couleurTypeCompte(type.cle) };
  });

  // Un solde négatif (compte courant à découvert) ne peut pas dessiner une
  // part négative : la valeur réelle reste affichée dans la légende, mais le
  // camembert ne compte que les parts positives pour ses proportions — sinon
  // une part négative agrandirait silencieusement les deux autres au-delà de
  // 100 % de l'anneau.
  const totalPositif = parts.reduce((s, p) => s + Math.max(0, p.montant), 0);

  if (totalPositif <= 0) {
    container.innerHTML = `<span class="hint">${t("Aucun solde positif à répartir.")}</span>`;
    return;
  }

  const rayon = 70;
  const epaisseur = 26;
  const circonference = 2 * Math.PI * rayon;
  let avancement = 0;
  // L'index est celui des parts DESSINÉES (les positives), pas celui de
  // `parts` : c'est lui qui doit tomber en face de la ligne de légende
  // correspondante, et la légende ci-dessous liste elle aussi les trois
  // familles — d'où la clé `cle`, qui les rapproche sans dépendre d'un
  // comptage parallèle.
  const segments = parts
    .filter((p) => p.montant > 0)
    .map((p) => {
      const fraction = p.montant / totalPositif;
      const longueur = fraction * circonference;
      // Le même dessin progressif que le camembert des dépenses (cf.
      // .camembert-part) : trois familles de comptes seulement, mais la même
      // règle CSS les sert — deux animations différentes pour deux anneaux
      // posés dans la même application se seraient vues.
      const segment = `
        <circle class="repartition-part camembert-part" data-cle="${p.cle}"
          cx="90" cy="90" r="${rayon}"
          fill="none" stroke="${p.couleur}" stroke-width="${epaisseur}"
          stroke-dasharray="${longueur} ${circonference - longueur}"
          stroke-dashoffset="${-avancement}"
          style="--tour:${circonference};--part:${longueur};--reste:${circonference - longueur};--retard:${((avancement / circonference) * PIE_ANIMATION_MS).toFixed(0)}ms;--duree:${Math.max(fraction * PIE_ANIMATION_MS, 60).toFixed(0)}ms"
        />
      `;
      avancement += longueur;
      return segment;
    })
    .join("");

  const legende = parts
    .map((p) => {
      const pourcentage = totalPositif > 0 ? Math.round((Math.max(0, p.montant) / totalPositif) * 100) : 0;
      return `
        <li class="repartition-legende-ligne" data-cle="${p.cle}">
          <span class="repartition-pastille" style="background:${p.couleur}"></span>
          <span class="repartition-etiquette">${t(p.etiquette)}</span>
          <span class="repartition-montant ${classeMontant(
            p.montant,
            p.montant < 0 ? "negatif" : ""
          )}">${formatMontant(p.montant, monnaieId)}</span>
          <span class="repartition-pourcentage">${pourcentage} %</span>
        </li>
      `;
    })
    .join("");

  container.innerHTML = `
    <div class="repartition-comptes">
      <svg viewBox="0 0 180 180" width="180" height="180" role="img" aria-label="${t("Répartition des avoirs par type de compte")}">
        <!-- Le cercle plein commence à midi (-90°) plutôt qu'à 3h (défaut SVG) :
             c'est la convention de tout camembert. -->
        <g transform="rotate(-90 90 90)">${segments}</g>
      </svg>
      <ul class="repartition-legende">${legende}</ul>
    </div>
  `;

  // SURVOLER UNE PART L'ÉCLAIRE, et survoler sa ligne de légende fait la même
  // chose. Ce camembert n'a pas d'infobulle : la surbrillance est ici la SEULE
  // réponse au geste, et sans elle rien ne confirme qu'on désigne bien la part
  // qu'on croit. Même procédé, même intensité que les deux autres camemberts de
  // l'application (cf. .io-part, .camembert-part) — trois graphes voisins qui
  // réagiraient différemment au même geste demanderaient de l'apprendre trois
  // fois.
  const souligner = (cle, actif) => {
    container
      .querySelectorAll(`[data-cle="${cle}"]`)
      .forEach((element) => element.classList.toggle("survolee", actif));
  };
  container.querySelectorAll("[data-cle]").forEach((element) => {
    const cle = element.dataset.cle;
    element.addEventListener("mouseenter", () => souligner(cle, true));
    element.addEventListener("mouseleave", () => souligner(cle, false));
  });
}

/* ---------- Histogramme dépenses par catégorie ---------- */

// Palette catégorielle validée (ordre fixe, jamais recyclée à la volée) :
// cf. skill dataviz, étape dark mode de la palette de référence. Le bleu est
// volontairement en dernier (c'est la couleur d'accent de l'UI en thème sombre,
// on évite qu'elle coïncide avec la première catégorie affichée).
const PALETTE_CATEGORIES = [
  "#199e70", // aqua
  "#c98500", // jaune
  "#008300", // vert
  "#9085e9", // violet
  "#e66767", // rouge
  "#d55181", // magenta
  "#d95926", // orange
  "#3987e5", // bleu
];

/**
 * La couleur d'une catégorie, par son index de palette PROPRE — jamais par sa
 * position dans la liste affichée.
 *
 * Cet index est attribué à la création et ne bouge plus (cf.
 * models.Categorie.couleur_index). C'est ce qui fait qu'éteindre une catégorie
 * sur le dashboard, en réordonner la liste ou en supprimer une ne repeint pas
 * les barres voisines : une couleur n'est reprise que si la catégorie qui la
 * portait a disparu.
 */
// LA COULEUR DES ENTRÉES (cf. constants.COULEUR_INDEX_ENTREE, migration 0078) : un index
// hors palette, écrit en base sur chaque catégorie d'entrée. Blanc sur le thème sombre,
// noir sur le clair — la variable CSS suit le thème (cf. style.css, --couleur-entree).
const COULEUR_INDEX_ENTREE = -1;
// LA COULEUR DE LA CATÉGORIE DES VIREMENTS INTERNES (constants.COULEUR_INDEX_VIREMENT, migration
// 0090) : hors palette, elle ne se dessine dans aucun graphique ; là où elle paraît (une pastille,
// un menu à cocher), elle prend le violet de l'épargne, où vont la plupart des virements.
const COULEUR_INDEX_VIREMENT = -2;

function couleurCategorie(couleurIndex) {
  if (couleurIndex === COULEUR_INDEX_ENTREE) return "var(--couleur-entree)";
  if (couleurIndex === COULEUR_INDEX_VIREMENT) return "var(--compte-epargne)";
  return PALETTE_CATEGORIES[Math.abs(couleurIndex) % PALETTE_CATEGORIES.length];
}

/** La couleur d'une barre, d'une tranche ou d'une ligne de légende : la sienne
 *  quand elle en porte une (une conversion, cf. barreConversion), celle de sa
 *  catégorie sinon. */
function couleurBarre(d, i) {
  if (d.colonne_speciale === "frais_virements") return GRIS_FRAIS;
  return d.couleur || couleurCategorie(d.couleur_index ?? i);
}

/* ---------- LES CONVERSIONS VERS UNE AUTRE MONNAIE ----------
 *
 * LE GRIS LEUR EST RÉSERVÉ, dans toute l'application : aucune catégorie n'en
 * porte (la palette ci-dessus n'en a pas), et une colonne grise se lit donc
 * d'emblée comme « de l'argent parti dans une autre monnaie », jamais comme une
 * dépense. UN GRIS PAR COUPLE DE MONNAIES, le même des deux côtés : la
 * conversion « vers le franc » du graphique en euros et la conversion « depuis
 * l'euro » du graphique en francs sont le même argent, vu des deux bouts, et se
 * reconnaissent d'un graphique à l'autre.
 *
 * Des gris assez éloignés les uns des autres pour se distinguer côte à côte, et
 * assez moyens pour se voir sur les deux thèmes. */
const GRIS_CONVERSIONS = ["#9aa0a8", "#bcc0c6", "#858b93", "#cbced3", "#a9aeb5", "#777d85"];
// LES FRAIS DE VIREMENTS INTERNES, gris eux aussi — de l'argent parti dans un
// virement, pas une dépense — mais d'un gris plus SOMBRE qu'aucune conversion,
// pour ne se confondre avec aucune.
const GRIS_FRAIS = "#575c63";

/* L'ATTRIBUTION EST PERMANENTE, ET RANGÉE EN BASE (`PreferenceInterface`, clé
 * CLE_COULEURS_CONVERSIONS) : {"<id>-<id>": rang de gris}. Un couple reçoit, la première
 * fois qu'on le dessine, le premier gris que personne n'a pris, et le garde — créer ou
 * éteindre une monnaie ne repeint pas les conversions déjà vues. En base et non dans le
 * navigateur : la clé désigne des identifiants de monnaie (cf. « Les rangements
 * d'écran »). Lue avec les monnaies (refreshMonnaies). */
const CLE_COULEURS_CONVERSIONS = "noyau.couleurs-conversions";

function couleurConversion(monnaieA, monnaieB) {
  const [bas, haut] = monnaieA < monnaieB ? [monnaieA, monnaieB] : [monnaieB, monnaieA];
  const attributions = state.couleursConversions;
  if (attributions && typeof attributions === "object") {
    const cle = `${bas}-${haut}`;
    if (attributions[cle] === undefined) {
      const prises = new Set(Object.values(attributions));
      let rang = 0;
      while (prises.has(rang) && rang < GRIS_CONVERSIONS.length) rang++;
      attributions[cle] = rang < GRIS_CONVERSIONS.length ? rang : prises.size;
      ecrirePreference(CLE_COULEURS_CONVERSIONS, attributions);
    }
    return GRIS_CONVERSIONS[attributions[cle] % GRIS_CONVERSIONS.length];
  }
  // PAS ENCORE LUE (premier rendu) : le rang du couple parmi tous les couples, dans
  // l'ordre des monnaies — rien n'est écrit tant que l'attribution n'est pas connue.
  const ids = (state.monnaies || []).map((m) => m.id);
  let rang = 0;
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      const [x, y] = ids[i] < ids[j] ? [ids[i], ids[j]] : [ids[j], ids[i]];
      if (x === bas && y === haut) return GRIS_CONVERSIONS[rang % GRIS_CONVERSIONS.length];
      rang++;
    }
  }
  return GRIS_CONVERSIONS[(bas + haut) % GRIS_CONVERSIONS.length];
}

/** « Conversion vers X » quand l'argent est parti (net négatif), « depuis X »
 *  quand il est revenu. */
function libelleConversion(montant, monnaieAutreId) {
  const nom = monnaieParId(monnaieAutreId)?.nom || "?";
  return montant < 0
    ? t("Conversion vers {monnaie}", { monnaie: nom })
    : t("Conversion depuis {monnaie}", { monnaie: nom });
}

/**
 * Une colonne de conversion (cf. services/cascade.py) DANS LA FORME D'UNE BARRE
 * D'HISTOGRAMME (`DepenseParCategorie`) : c'est ce qui permet à l'histogramme, au
 * camembert et à la légende du noyau de la dessiner sans rien savoir d'elle, à sa
 * couleur près.
 *
 * `ouvrir` ouvre le détail de la monnaie d'en face dans une fenêtre ;
 * `voirOperations` (dashboard seulement) mène aux virements de la page
 * Opérations. Ce sont les deux drill-throughs de son infobulle.
 */
function barreConversion(monnaieId, colonne, { ouvrir = null, voirOperations = null } = {}) {
  const montant = Math.abs(colonne.montant);
  return {
    categorie: libelleConversion(colonne.montant, colonne.monnaie_autre_id),
    total_reel: montant,
    total_previsionnel: montant,
    budget_alloue: 0,
    objectif_pourcentage: 0,
    // Les lignes DANS LE SENS DE LA BARRE : ce qui va dans le sens du net est positif,
    // un change en sens inverse (de l'argent revenu) se lit en négatif.
    top_depenses: (colonne.top || []).map((ligne) => ({
      ...ligne,
      montant: colonne.montant < 0 ? -ligne.montant : ligne.montant,
    })),
    couleur: couleurConversion(monnaieId, colonne.monnaie_autre_id),
    conversion: {
      monnaie_autre_id: colonne.monnaie_autre_id,
      sens: colonne.montant < 0 ? "vers" : "depuis",
      ouvrir,
      voirOperations,
    },
  };
}

/**
 * La colonne des FRAIS DE VIREMENTS INTERNES (cf. services/cascade.py), dans la
 * forme d'une barre d'histogramme, comme une conversion. `ouvrir` ouvre la
 * fenêtre qui les détaille, virement par virement (cf. ouvrirFenetreFrais).
 */
function barreFrais(colonne, { ouvrir = null } = {}) {
  const montant = Math.abs(colonne.montant);
  return {
    categorie: t("Frais de virements internes"),
    total_reel: montant,
    total_previsionnel: montant,
    budget_alloue: 0,
    objectif_pourcentage: 0,
    top_depenses: (colonne.top || []).map((ligne) => ({ ...ligne, montant: -ligne.montant })),
    couleur: GRIS_FRAIS,
    frais: { ouvrir },
  };
}

/** Une colonne grise — conversion ou frais — porte sa propre infobulle. */
function estColonneGrise(d) {
  return Boolean(d.conversion || d.frais || d.colonne_speciale === "frais_virements");
}

/** L'infobulle d'une colonne grise : son total, ses plus grosses lignes, et ses
 *  drill-throughs — le rendu partagé l'appelle à la place de celle d'une
 *  catégorie (cf. attacherInfobulleCategorie, champ `actions`). */
function contenuInfobulleConversion(d, monnaieId) {
  // LA BARRE DE FRAIS QUE REND LE SERVEUR (cf. soldes._barre_frais_virements) : sans
  // geste fourni par l'écran qui la dessine, elle ouvre le détail de toute la période.
  if (d.colonne_speciale === "frais_virements" && !d.frais) {
    d = { ...d, frais: { ouvrir: () => ouvrirFenetreFrais({ monnaieId }) } };
  }
  if (d.frais) {
    return {
      depense: d,
      html: `<div class="histo-bulle-titre">${escapeHtml(d.categorie)}</div>
        <ul class="histo-bulle-chiffres"><li><span class="histo-bulle-nature">${escapeHtml(
          t("Total")
        )}</span><span class="histo-bulle-montant">${formatMontant(
          d.total_previsionnel,
          monnaieId
        )}</span></li></ul>
        ${listeTopHtml(d.top_depenses, monnaieId)}
        ${
          d.frais.ouvrir
            ? `<button type="button" class="histo-bulle-lien" data-action-bulle="ouvrir">${escapeHtml(
                t("Voir le détail des frais")
              )}</button>`
            : ""
        }`,
      actions: { ouvrir: d.frais.ouvrir },
    };
  }
  const { ouvrir, voirOperations, monnaie_autre_id: autre } = d.conversion;
  const boutons = [];
  if (voirOperations) {
    boutons.push(
      `<button type="button" class="histo-bulle-lien" data-action-bulle="operations">${t(
        "Voir les virements"
      )}</button>`
    );
  }
  if (ouvrir) {
    boutons.push(
      `<button type="button" class="histo-bulle-lien" data-action-bulle="ouvrir">${escapeHtml(
        t("Ouvrir le détail : {monnaie}", { monnaie: monnaieParId(autre)?.nom || "?" })
      )}</button>`
    );
  }
  return {
    depense: d,
    html: `<div class="histo-bulle-titre">${escapeHtml(d.categorie)}</div>
      <ul class="histo-bulle-chiffres"><li><span class="histo-bulle-nature">${escapeHtml(
        t("Total")
      )}</span><span class="histo-bulle-montant">${formatMontant(
        d.total_previsionnel,
        monnaieId
      )}</span></li></ul>
      ${listeTopHtml(d.top_depenses, monnaieId)}
      ${boutons.join("")}`,
    actions: { operations: voirOperations, ouvrir },
  };
}

/* LES DEUX VUES DU CAMEMBERT. Elles ne diffèrent que par leur DÉNOMINATEUR, et
   c'est toute la question :

     - « ÉTAT ACTUEL » rapporte chaque catégorie au TOTAL DÉPENSÉ. Les parts
       somment toujours 100 %, l'anneau est plein, et la question posée est
       « comment se répartit ce que j'ai dépensé » ;
     - « BUDGET » les rapporte au BUDGET TOTAL du mois (cf. migration 0057).
       Les parts somment ce qu'elles somment, l'anneau reste ouvert sur ce qui
       n'a pas été dépensé, et la question devient « où en suis-je de mon
       budget ».

   L'OBJECTIF DE RÉPARTITION N'A DE SENS QUE DANS LA SECONDE, et c'est la raison
   d'être de la première. Rapportées au total dépensé, les parts sont LIÉES :
   elles somment 100 par construction, donc une catégorie ne peut tenir son
   objectif que si les autres tiennent le leur — comparer une part à sa cible
   n'y apprend presque rien, et le faisait même mentir (une seule catégorie à
   l'écran affichait « je fais 100 %, je devrais faire 30 % »). Rapportées au
   budget, elles sont INDÉPENDANTES : « l'alimentaire devait peser 30 % de mon
   budget, il en pèse 22 % » est une phrase vraie, que rien d'autre à l'écran ne
   fait dire.

   C'EST CE QUI A REMPLACÉ LA RENORMALISATION ET LA RÈGLE DU RESTE IMPLICITE.
   Les objectifs étaient recalculés au prorata de ce qui restait affiché, avec
   une part fictive distribuée aux catégories sans objectif pour que le
   dénominateur soit honnête. Tout cet échafaudage n'existait que pour rendre
   comparables deux nombres qui ne l'étaient pas ; avec un dénominateur FIXE, il
   n'a plus lieu d'être — l'objectif s'affiche tel qu'il a été saisi. */
const VUE_PIE_ACTUEL = "actuel";
const VUE_PIE_BUDGET = "budget";

// LE TEMPS QU'UN ANNEAU MET À SE FERMER, tranches mises bout à bout : chacune
// occupe sa part de cette durée, et part quand la précédente a fini. Assez lent
// pour qu'on VOIE le tour se faire, assez court pour qu'un changement de mois
// ne se transforme pas en attente — c'est un rendu, pas une introduction.
const PIE_ANIMATION_MS = 620;

/* ---------- Ce que les deux graphes ont en commun ----------
 *
 * L'HISTOGRAMME ET LE CAMEMBERT MONTRENT LA MÊME LISTE, sous deux formes, et
 * partagent une LÉGENDE et une INFOBULLE. Deux calculs parallèles finiraient
 * par ne plus tomber d'accord à l'arrondi — et c'est précisément ce qu'une
 * répartition donne à comparer.
 *
 * `partsCategoriesDashboard` est donc le SEUL endroit où l'on décide du
 * dénominateur et des pourcentages. Les trois rendus le reçoivent tel quel.
 */
function partsCategoriesDashboard(depenses, visibles, options = {}) {
  const { vue = VUE_PIE_ACTUEL, budgetTotal = 0 } = options;
  const retenues = depenses.filter((d) => visibles.has(d.categorie));
  // Une catégorie à zéro ne DESSINE pas de tranche (un arc de longueur nulle
  // n'existe pas) mais garde sa barre et sa ligne de légende : elle a quelque
  // chose à dire — « aucune dépense sur la période ».
  // UNE CONVERSION « DEPUIS » une autre monnaie est de l'argent REVENU : elle a
  // sa barre (son montant se lit) mais pas de tranche dans une répartition de ce
  // qui est sorti.
  const tranches = retenues.filter(
    (d) => d.total_previsionnel > 0 && d.conversion?.sens !== "depuis"
  );
  const total = tranches.reduce((somme, d) => somme + d.total_previsionnel, 0);

  // PAS DE BUDGET, PAS DE VUE BUDGET. Zéro veut dire « aucun budget posé » (cf.
  // crud.get_budget_total) : rapporter des parts à zéro ne donnerait pas des
  // pourcentages faux, il n'en donnerait aucun.
  const vueBudget = vue === VUE_PIE_BUDGET && budgetTotal > 0;
  const base = vueBudget ? budgetTotal : total;

  return {
    retenues,
    tranches,
    total,
    vueBudget,
    budgetTotal,
    // LE DÉNOMINATEUR DES PARTS. En vue budget il ne bouge PAS avec le filtre
    // de catégories : filtrer y retire des tranches sans rien changer aux
    // autres, ce qui est exactement ce qu'on attend d'une part de budget. En
    // vue « état actuel », au contraire, il se recalcule sur les seules
    // catégories retenues — filtrer y change la question.
    base,
    part: (d) => (base > 0 ? (d.total_previsionnel / base) * 100 : 0),
    // L'OBJECTIF TEL QU'IL A ÉTÉ SAISI, et rien qu'en vue budget : ailleurs, il
    // n'y a pas de dénominateur commun qui le rende comparable à la part.
    objectif: (d) => (vueBudget ? d.objectif_pourcentage || 0 : 0),
  };
}

/**
 * L'infobulle d'une catégorie — la MÊME pour les trois endroits d'où on peut la
 * demander : une barre, une tranche, une ligne de légende.
 *
 * POURQUOI UNE SEULE. Les trois commentent la même catégorie sur la même
 * période ; trois bulles différentes auraient demandé d'apprendre trois fois où
 * regarder, et se seraient mises à diverger au premier ajout.
 *
 * CHACUN N'EN MONTRE QUE CE QUI LE CONCERNE, et c'est le seul écart :
 *
 *   - l'HISTOGRAMME porte des montants → total de la barre, et l'objectif
 *     traduit en montant ;
 *   - le CAMEMBERT porte des parts → pourcentage dans le total affiché au
 *     centre, et l'objectif en pourcentage ;
 *   - la LÉGENDE ne porte rien d'autre qu'un nom : elle montre LES QUATRE, et
 *     c'est ce qui en fait le point d'entrée le plus complet des trois.
 *
 * LE BOUTON « Voir toutes les dépenses » EST DANS LES TROIS, et il n'est plus
 * sur le clic d'une barre ni d'une tranche. Ouvrir un autre écran au moindre
 * clic sur un graphe qu'on est en train de survoler punit un geste qui n'avait
 * aucune intention — on clique pour poser le curseur, pour reprendre le focus,
 * et on se retrouve ailleurs. Dans l'infobulle, l'action est NOMMÉE et il faut
 * aller la chercher : le seul clic qui l'atteint est celui qui la voulait.
 *
 * POURQUOI DU HTML ET PLUS UN <title> SVG. Un <title> ne porte que du texte
 * brut — ni colonne de montants alignée, ni italique pour le nombre de
 * dépenses fondues. Il apparaissait en plus avec le délai du navigateur
 * (~1 s), là où une infobulle maison suit le curseur immédiatement.
 */
/**
 * Le top des plus grosses lignes, tel qu'il s'affiche dans une infobulle.
 *
 * ÉCRIT UNE FOIS POUR DEUX APPELANTS : l'infobulle d'une catégorie (barre,
 * tranche, ligne de légende) et celle des deux cartes de flux. Les deux
 * répondent à la même question — « d'où vient ce chiffre ? » — et deux copies
 * de cette liste auraient fini par ne plus se ressembler au premier ajustement.
 */
function listeTopHtml(top, monnaieId) {
  const lignes = (top || [])
    .map((d) => {
      // Une dépense fondue à partir de plusieurs opérations le dit ; une seule
      // reste nue (cf. DepenseTopRead.nombre). Le nombre entre parenthèses ne
      // s'affiche QU'À PARTIR DE DEUX : « (1) » n'apprendrait rien et mettrait
      // une parenthèse au bout de presque chaque ligne, exactement là où l'œil
      // cherche le libellé.
      const compte =
        d.nombre > 1 ? ` <i class="histo-bulle-compte">(${d.nombre})</i>` : "";
      const nature = d.nature ? escapeHtml(d.nature) : `<span class="hint">${t("Sans libellé")}</span>`;
      return `<li>
        <span class="histo-bulle-nature">${nature}${compte}</span>
        <span class="histo-bulle-montant">${formatMontant(d.montant, monnaieId)}</span>
      </li>`;
    })
    .join("");
  return lignes
    ? `<ul class="histo-bulle-liste">${lignes}</ul>`
    : `<div class="histo-bulle-vide">${t("Aucune opération sur la période.")}</div>`;
}

function contenuInfobulleCategorie(depense, monnaieId, chiffres = {}) {
  const {
    total = null,
    part = null,
    partLibelle = null,
    budget = null,
    objectif = null,
    // LA PÉRIODE COMPARÉE (page Budget) : son libellé, et le chiffre du même
    // genre que celui qu'on montre pour la période courante — un total pour
    // l'histogramme, une part pour le camembert.
    compareLibelle = null,
    compareTotal = null,
    comparePart = null,
  } = chiffres;

  // Les chiffres, en colonnes : c'est tout l'intérêt de les poser l'un sous
  // l'autre. Chacun est tu quand l'appelant ne le passe pas — une ligne vide
  // vaudrait « zéro », ce qui est faux.
  const lignesChiffres = [];
  if (total != null) {
    lignesChiffres.push([t("Total"), formatMontant(total, monnaieId)]);
  }
  if (part != null) {
    lignesChiffres.push([partLibelle || t("Part"), formatPourcentage(part)]);
  }
  // DEUX CIBLES, ET NON DEUX ÉCRITURES DE LA MÊME. Le budget est une enveloppe
  // EN VALEUR posée sur la catégorie pour ce mois-là
  // (`CategorieBudgetMensuel`) ; l'objectif est une PART du budget total
  // (`Categorie.objectif_pourcentage`). Les deux se posent séparément, peuvent
  // se contredire (cf. crud.incoherences_budgets), et afficher l'un traduit
  // dans l'unité de l'autre les faisait passer pour le même chiffre — c'était
  // précisément le défaut : le trait rouge de l'histogramme disait une chose,
  // l'infobulle qui le commentait en disait une autre.
  if (budget != null && budget > 0) {
    lignesChiffres.push([t("Budget"), formatMontant(budget, monnaieId)]);
  }
  if (objectif != null && objectif > 0) {
    lignesChiffres.push([t("Objectif"), formatPourcentage(objectif)]);
  }
  if (compareLibelle && compareTotal != null) {
    lignesChiffres.push([compareLibelle, formatMontant(compareTotal, monnaieId)]);
  }
  if (compareLibelle && comparePart != null) {
    lignesChiffres.push([compareLibelle, formatPourcentage(comparePart)]);
  }

  const chiffresHtml = lignesChiffres.length
    ? `<ul class="histo-bulle-chiffres">${lignesChiffres
        .map(
          ([libelle, valeur]) =>
            `<li><span class="histo-bulle-nature">${escapeHtml(
              libelle
            )}</span><span class="histo-bulle-montant">${valeur}</span></li>`
        )
        .join("")}</ul>`
    : "";

  const corps = listeTopHtml(depense.top_depenses, monnaieId);

  return `<div class="histo-bulle-titre">${escapeHtml(
    libelleCategorie(depense.categorie)
  )}</div>
    ${chiffresHtml}
    ${corps}
    <button type="button" class="histo-bulle-lien" data-drill-through>${t(
      "Voir toutes les dépenses"
    )}</button>`;
}

/**
 * Place l'infobulle près du curseur sans jamais la laisser sortir du cadre :
 * elle bascule à gauche du curseur quand elle déborderait à droite, et
 * au-dessus quand elle déborderait en bas. Sans ça, survoler la dernière barre
 * d'un histogramme large poussait la bulle hors de la page.
 */
function placerInfobulleHistogramme(bulle, container, evenement) {
  const cadre = container.getBoundingClientRect();
  const marge = 14;
  let x = evenement.clientX - cadre.left + marge;
  let y = evenement.clientY - cadre.top + marge;
  if (x + bulle.offsetWidth > cadre.width) {
    x = evenement.clientX - cadre.left - bulle.offsetWidth - marge;
  }
  if (y + bulle.offsetHeight > cadre.height) {
    y = evenement.clientY - cadre.top - bulle.offsetHeight - marge;
  }
  bulle.style.left = `${Math.max(0, x)}px`;
  bulle.style.top = `${Math.max(0, y)}px`;
}

/* ---------- GELER L'INFOBULLE ----------
 *
 * CE QUE ÇA RÉSOUT. L'infobulle suit le curseur et disparaît dès qu'on le
 * retire : tout ce qu'elle contient doit donc être lu SANS bouger la souris.
 * Or elle porte un top 3 de dépenses et un bouton — de quoi vouloir prendre son
 * temps, comparer deux lignes, ou simplement lâcher la souris pour lire. Une
 * touche la FIGE : elle reste où elle est, le survol des graphes cesse de
 * l'écraser, et on récupère son curseur.
 *
 * UNE TOUCHE PLUTÔT QU'UN CLIC. Le clic est déjà pris — c'est lui qui filtre la
 * catégorie — et un clic droit ouvrirait le menu du navigateur. La touche, elle,
 * ne coûte rien à qui ne la connaît pas : sans elle, l'infobulle se comporte
 * exactement comme avant.
 *
 * ELLE SE RÈGLE DANS PARAMÈTRES → PARAMÈTRES GÉNÉRAUX, et vit dans le
 * localStorage, comme la langue : c'est un confort de lecture propre au poste,
 * pas une donnée du budget. Chaîne vide = gel désactivé ; clé absente = la
 * touche par défaut (et non « désactivé », sans quoi personne ne découvrirait
 * jamais la fonction).
 */
const CLE_TOUCHE_GEL = "budget-app.infobulle.touche-gel";
// « F » comme figer/freeze : le mot commence pareil dans les deux langues, et
// la touche n'est prise par rien d'autre sur un graphe qu'on survole.
const TOUCHE_GEL_DEFAUT = "f";

function toucheGelInfobulle() {
  try {
    const valeur = localStorage.getItem(CLE_TOUCHE_GEL);
    return valeur === null ? TOUCHE_GEL_DEFAUT : valeur;
  } catch (err) {
    return TOUCHE_GEL_DEFAUT;
  }
}

function definirToucheGelInfobulle(combo) {
  try {
    localStorage.setItem(CLE_TOUCHE_GEL, combo);
  } catch (err) {
    // Stockage indisponible : le réglage vaut pour la session, et rien de
    // cassé — comme pour la langue.
  }
}

/**
 * La combinaison décrite par un événement clavier, sous sa forme normalisée
 * (`"ctrl+shift+f"`), ou `null` si la touche ne peut pas en faire une.
 *
 * UN MODIFICATEUR SEUL N'EST PAS UNE COMBINAISON : appuyer sur Ctrl envoie un
 * `keydown` dont la touche EST « Control ». L'accepter aurait enregistré
 * « ctrl » comme raccourci, lequel se déclencherait ensuite à chaque fois qu'on
 * commence n'importe quel autre raccourci.
 */
function comboDepuisEvenement(e) {
  if (["Shift", "Control", "Alt", "Meta"].includes(e.key)) return null;
  const morceaux = [];
  if (e.ctrlKey) morceaux.push("ctrl");
  if (e.altKey) morceaux.push("alt");
  if (e.shiftKey) morceaux.push("shift");
  if (e.metaKey) morceaux.push("meta");
  morceaux.push(e.key.toLowerCase());
  return morceaux.join("+");
}

// Les touches qui se lisent mieux en symbole qu'en nom anglais (« arrowup »). Entrée, Espace et Échap
// restent des symboles : un nom français s'afficherait tel quel dans les autres langues.
const NOMS_TOUCHES = {
  arrowup: "↑",
  arrowdown: "↓",
  arrowleft: "←",
  arrowright: "→",
  enter: "↵",
  " ": "␣",
  escape: "Esc",
};

/** « ctrl+shift+f » → « Ctrl + Shift + F ». */
function libelleCombo(combo) {
  return combo
    .split("+")
    .map(
      (m) =>
        NOMS_TOUCHES[m] ||
        (m.length === 1 ? m.toUpperCase() : m.charAt(0).toUpperCase() + m.slice(1))
    )
    .join(" + ");
}

/* ---------- LES TOUCHES DU TABLEAU DES CORRESPONDANCES (import) ----------
 *
 * Trois touches pilotent la molette : monter, descendre, confirmer la colonne courante. Elles se
 * règlent dans Paramètres → Paramètres généraux → Import, et vivent dans le localStorage comme la
 * touche de gel : une habitude de poste, pas une donnée du budget.
 *
 * LES TROIS DOIVENT ÊTRE DIFFÉRENTES, sans quoi une même pression ferait deux choses — ou, pour
 * monter et descendre, aucune des deux. Le garde est à l'ENREGISTREMENT (`definirToucheImport`),
 * jamais à l'usage : une touche refusée ne s'écrit pas, donc une touche lue est toujours valide.
 *
 * ← → Début Fin Tab et Échap restent à l'écran (colonnes, bords de la molette, navigation, fermeture) :
 * les proposer ici ferait perdre l'une de ces fonctions en silence.
 */
const TOUCHES_IMPORT = {
  haut: { cle: "budget-app.import.touche-haut", defaut: "arrowup", nom: "Monter" },
  bas: { cle: "budget-app.import.touche-bas", defaut: "arrowdown", nom: "Descendre" },
  confirmer: { cle: "budget-app.import.touche-confirmer", defaut: "ctrl+enter", nom: "Confirmer" },
};
const TOUCHES_IMPORT_RESERVEES = ["arrowleft", "arrowright", "home", "end", "tab", "escape"];

function toucheImport(action) {
  const { cle, defaut } = TOUCHES_IMPORT[action];
  try {
    return localStorage.getItem(cle) || defaut;
  } catch (err) {
    return defaut;
  }
}

/** Enregistre une touche, ou rend le message qui dit pourquoi elle est refusée (null = acceptée). */
function definirToucheImport(action, combo) {
  const derniere = combo.split("+").pop();
  if (TOUCHES_IMPORT_RESERVEES.includes(derniere) || TOUCHES_IMPORT_RESERVEES.includes(combo)) {
    return t("Cette touche est réservée à l'écran des correspondances.");
  }
  const prise = Object.keys(TOUCHES_IMPORT).find(
    (autre) => autre !== action && toucheImport(autre) === combo
  );
  if (prise) {
    return t("Cette touche est déjà celle de « {action} ».", {
      action: t(TOUCHES_IMPORT[prise].nom),
    });
  }
  try {
    localStorage.setItem(TOUCHES_IMPORT[action].cle, combo);
  } catch (err) {
    // Stockage indisponible : le réglage vaut pour la session, comme pour la touche de gel.
  }
  return null;
}

function retablirTouchesImport() {
  Object.values(TOUCHES_IMPORT).forEach(({ cle }) => {
    try {
      localStorage.removeItem(cle);
    } catch (err) {
      // rien à rétablir si le stockage est absent
    }
  });
}

/** La combinaison d'un événement clavier, la touche Cmd d'un Mac valant Ctrl (comme avant). */
function comboEvenementImport(e) {
  const combo = comboDepuisEvenement(e);
  if (combo && e.metaKey && !e.ctrlKey) return combo.replace("meta", "ctrl");
  return combo;
}

function majAffichageTouchesImport() {
  Object.keys(TOUCHES_IMPORT).forEach((action) => {
    const champ = document.getElementById(`reglage-touche-import-${action}`);
    if (champ) champ.value = libelleCombo(toucheImport(action));
  });
}

document.querySelectorAll("[data-touche-import]").forEach((champ) => {
  champ.addEventListener("keydown", (e) => {
    // Tout est intercepté, comme pour la touche de gel : le champ capture, il ne se tape pas.
    e.preventDefault();
    if (e.key === "Escape") {
      e.target.blur();
      return;
    }
    const combo = comboEvenementImport(e);
    if (!combo) return;
    const refus = definirToucheImport(champ.dataset.toucheImport, combo);
    if (refus) {
      showMessage(refus, "error");
      return;
    }
    majAffichageTouchesImport();
    corrMajBoutonsConfirmer();
    showMessage(t("Touche enregistrée."), "success");
  });
});

document.getElementById("btn-touches-import-defaut")?.addEventListener("click", () => {
  retablirTouchesImport();
  majAffichageTouchesImport();
  corrMajBoutonsConfirmer();
});

// LA DERNIÈRE BULLE MONTRÉE, ET CELLE QUI EST FIGÉE. Deux variables et non une :
// la touche fige ce qu'on est en train de regarder, il faut donc savoir ce que
// c'est AVANT qu'elle soit pressée. Communes à toutes les infobulles de la page
// (il y en a une par graphe) — une seule peut être figée à la fois, sans quoi
// l'écran se couvrirait de bulles qu'il faudrait fermer une à une.
let derniereBulleInfobulle = null;
let infobulleGelee = null;

function degelerInfobulle() {
  if (!infobulleGelee) return;
  infobulleGelee.querySelector(".histo-bulle-gel-note")?.remove();
  infobulleGelee.classList.remove("histo-bulle-gelee");
  infobulleGelee.classList.remove("visible");
  infobulleGelee = null;
}

function gelerInfobulle(combo) {
  if (!derniereBulleInfobulle || !derniereBulleInfobulle.classList.contains("visible")) return;
  infobulleGelee = derniereBulleInfobulle;
  infobulleGelee.classList.add("histo-bulle-gelee");
  // LA BULLE DIT COMMENT S'EN DÉFAIRE. Sans cette ligne, une infobulle qui
  // cesse brusquement de suivre le curseur se lit comme une panne, et rien
  // n'indique quelle touche vient de la figer ni comment la libérer.
  const note = document.createElement("div");
  note.className = "histo-bulle-gel-note";
  note.textContent = t("Figée — {touche} ou Échap pour libérer", {
    touche: libelleCombo(combo),
  });
  infobulleGelee.appendChild(note);
}

document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && infobulleGelee) {
    degelerInfobulle();
    return;
  }
  const combo = toucheGelInfobulle();
  if (!combo) return;
  // JAMAIS PENDANT UNE SAISIE : la touche par défaut est une lettre, et la
  // capturer dans un champ de texte empêcherait purement et simplement de
  // l'écrire.
  if (e.target?.closest?.("input, textarea, select, [contenteditable=true]")) return;
  if (comboDepuisEvenement(e) !== combo) return;
  e.preventDefault();
  if (infobulleGelee) degelerInfobulle();
  else gelerInfobulle(combo);
});

// Un clic HORS de la bulle figée la libère : c'est le geste qu'on fait
// d'instinct pour « refermer » quelque chose, et il ne peut pas se tromper de
// cible. Un clic DEDANS ne la ferme pas — elle porte un bouton.
document.addEventListener("click", (e) => {
  if (infobulleGelee && !infobulleGelee.contains(e.target)) degelerInfobulle();
});

/**
 * Pose UNE infobulle dans un conteneur et la câble à une liste de cibles.
 *
 * ÉCRIT UNE FOIS POUR LES TROIS SUPPORTS. Chacun avait sa copie du même
 * enchaînement (créer la bulle, entrer, suivre, sortir) ; la troisième copie,
 * celle de la légende, aurait été celle de trop.
 *
 * LE DÉLAI DE GRÂCE EST LA PIÈCE QUI N'EST PAS ÉVIDENTE. L'infobulle porte une
 * action, il faut donc pouvoir l'atteindre — or le trajet du curseur vers elle
 * passe forcément par les quelques pixels qui la séparent de sa cible, où l'on
 * n'est plus sur rien. Sans ce délai, elle disparaîtrait sous le curseur qui
 * vient la chercher. Entrer DANS la bulle annule le départ, en sortir le
 * relance.
 *
 * `contenuPour(cible)` rend {depense, html} : la cible sait ce qu'elle décrit,
 * cette fonction ne le devine pas.
 */
function attacherInfobulleCategorie(container, cibles, contenuPour) {
  const bulle = document.createElement("div");
  // `histo-bulle-interactive` : celle-ci porte un bouton, elle doit donc
  // recevoir la souris (cf. style.css, où .histo-bulle est en pointer-events:
  // none pour ne jamais s'interposer entre le curseur et le graphe).
  bulle.className = "histo-bulle histo-bulle-interactive";
  bulle.setAttribute("role", "tooltip");
  container.appendChild(bulle);

  let fermeture = null;
  const annulerFermeture = () => {
    if (fermeture) clearTimeout(fermeture);
    fermeture = null;
  };
  const fermerBientot = () => {
    annulerFermeture();
    fermeture = setTimeout(() => bulle.classList.remove("visible"), 260);
  };
  bulle.addEventListener("mouseenter", annulerFermeture);
  bulle.addEventListener("mouseleave", () => {
    // Une bulle figée ne se referme pas quand on la quitte : c'est justement ce
    // qu'on lui a demandé.
    if (infobulleGelee === bulle) return;
    fermerBientot();
  });

  cibles.forEach((cible) => {
    cible.addEventListener("mouseenter", (e) => {
      // UNE BULLE FIGÉE GÈLE AUSSI LE SURVOL, et c'est tout l'intérêt : sans
      // ça, le premier mouvement de souris vers elle réécrirait son contenu
      // avec la catégorie qu'on vient de traverser.
      if (infobulleGelee) return;
      annulerFermeture();
      derniereBulleInfobulle = bulle;
      const { depense, html, actions } = contenuPour(cible);
      bulle.innerHTML = html;
      const fermerPuis = (geste) => () => {
        degelerInfobulle();
        bulle.classList.remove("visible");
        geste();
      };
      // Le bouton est recréé avec le contenu, son écouteur aussi : c'est ce qui
      // permet de capturer `depense` sans table de correspondance.
      bulle
        .querySelector("[data-drill-through]")
        ?.addEventListener("click", fermerPuis(() => drillThroughCategorie(depense)));
      // DES ACTIONS À ELLE, pour une bulle qui n'est pas celle d'une catégorie
      // (une conversion vers une autre monnaie, cf. contenuInfobulleConversion) :
      // chaque bouton `data-action-bulle` appelle la fonction du même nom.
      Object.entries(actions || {}).forEach(([cle, geste]) => {
        if (!geste) return;
        bulle
          .querySelector(`[data-action-bulle="${cle}"]`)
          ?.addEventListener("click", fermerPuis(geste));
      });
      bulle.classList.add("visible");
      placerInfobulleHistogramme(bulle, container, e);
    });
    cible.addEventListener("mousemove", (e) => {
      if (infobulleGelee) return;
      placerInfobulleHistogramme(bulle, container, e);
    });
    cible.addEventListener("mouseleave", () => {
      if (infobulleGelee) return;
      fermerBientot();
    });
  });
  return bulle;
}

/**
 * D'OÙ VIENT CE TOTAL : les trois plus grosses lignes, au survol des cartes
 * « Total Entrées » et « Total Dépenses ».
 *
 * UN TOTAL NE DIT JAMAIS D'OÙ IL VIENT, et c'est la première question qu'on se
 * pose devant un mois qui sort de l'ordinaire. Il fallait jusqu'ici ouvrir la
 * page Opérations, trier par montant et refaire le tri de tête — pour trois
 * lignes que le serveur a déjà sous la main en calculant la carte.
 *
 * MÊME PÉRIMÈTRE QUE LA CARTE (cf. services/soldes.get_top_flux_periode) : les
 * lignes additionnent bien une part du chiffre affiché juste au-dessus. C'est
 * la seule chose qui rende ce détail utile — un détail dont la somme ne vaut
 * pas le chiffre qu'il détaille est pire que pas de détail du tout.
 *
 * PAS DE GEL, PAS DE DRILL-THROUGH, contrairement aux infobulles des graphes :
 * celles-là portent un bouton et un choix, celle-ci ne porte que trois lignes à
 * lire. Elle n'a donc pas à recevoir la souris, et `.histo-bulle` seule (sans
 * `histo-bulle-interactive`) la laisse traverser.
 *
 * ELLE EST RECÂBLÉE À CHAQUE RENDU, comme les cartes qu'elle décrit : les
 * écouteurs partent avec les anciens nœuds, et `data-infobulle-flux` garde le
 * conteneur de se voir poser deux bulles.
 */
function attacherInfobulleFlux(kpis, monnaieId) {
  const rangee = document.querySelector("#section-dashboard .flux-periode");
  if (!rangee) return;
  let bulle = rangee.querySelector(".histo-bulle");
  if (!bulle) {
    bulle = document.createElement("div");
    bulle.className = "histo-bulle";
    bulle.setAttribute("role", "tooltip");
    rangee.appendChild(bulle);
  }

  const cartes = [
    ["kpi-total-entrees", "Total Entrées", kpis.top_entrees],
    ["kpi-total-sorties", "Total Dépenses", kpis.top_sorties],
  ];

  cartes.forEach(([idValeur, titre, top]) => {
    const carte = document.getElementById(idValeur)?.closest(".flux-carte");
    if (!carte) return;
    // Un seul jeu d'écouteurs par carte : `renderFluxPeriode` est rappelé à
    // chaque changement de période, et les empiler referait le même travail N
    // fois. Le contenu, lui, est relu à chaque survol — il vient de la
    // fermeture la plus récente.
    const contenu = () =>
      `<div class="histo-bulle-titre">${escapeHtml(t(titre))}</div>${listeTopHtml(
        top,
        monnaieId
      )}`;
    carte.dataset.infobulleFlux = "";
    carte.onmouseenter = (e) => {
      if (infobulleGelee) return;
      bulle.innerHTML = contenu();
      bulle.classList.add("visible");
      placerInfobulleHistogramme(bulle, rangee, e);
    };
    carte.onmousemove = (e) => {
      if (infobulleGelee) return;
      placerInfobulleHistogramme(bulle, rangee, e);
    };
    carte.onmouseleave = () => bulle.classList.remove("visible");
  });
}

/**
 * L'histogramme des dépenses par catégorie.
 *
 * `container` PLUTÔT QU'UN IDENTIFIANT CÂBLÉ : ce graphe n'est plus le seul du
 * dashboard. Un projet (extension « Projets ») affiche le sien, avec les mêmes
 * barres, les mêmes couleurs et la même infobulle — c'est exactement ce qu'on
 * veut, et un second rendu parallèle aurait fini par ne plus lui ressembler.
 * Le conteneur du dashboard reste la valeur par défaut, les appels d'origine
 * n'ont donc rien à dire de plus.
 *
 * SA CIBLE EST LE BUDGET EN VALEUR, et rien d'autre : le trait rouge d'une
 * barre et la ligne « Budget » de son infobulle lisent le MÊME
 * `budget_alloue`. L'infobulle y montrait un temps l'objectif de répartition
 * traduit en montant (la part visée appliquée au total dessiné) : deux cibles
 * différentes se retrouvaient alors dans la même unité, au même endroit, et la
 * seconde recouvrait la première.
 *
 * Le conteneur doit être positionné en relatif : l'infobulle s'y place en
 * absolu (cf. .histo-bulle et placerInfobulleHistogramme).
 */
/* ---------- LA PÉRIODE COMPARÉE, HACHURÉE ET GRISÉE ----------
 *
 * La page Budget compare deux périodes sur les MÊMES graphes plutôt que sur
 * deux graphes côte à côte : deux histogrammes voisins obligent l'œil à faire
 * l'aller-retour barre par barre, alors que superposés, l'écart se lit sur
 * place. La période comparée est donc dessinée PAR-DESSUS, hachurée (les
 * rayures laissent voir la barre pleine en dessous) et grisée (elle est la
 * référence, pas le sujet). LA PLUS HAUTE DES DEUX VALEURS NE REMPLIT QUE CE
 * QUI DÉPASSE DE L'AUTRE. Sur le camembert, deux anneaux : la période comparée
 * DEHORS, en grand (des hachures se lisent mal en petit), la courante dedans.

 *
 * UN MOTIF PAR COULEUR ET PAR GRAPHE : les identifiants de `<pattern>` sont
 * globaux au document, et deux graphes visibles en même temps (dashboard et
 * page Budget) ne doivent pas se prendre leurs motifs.
 */
let compteurMotifsHachure = 0;

function motifHachure(couleur, prefixe) {
  const id = `${prefixe}-${compteurMotifsHachure++}`;
  return {
    id,
    def: `<pattern id="${id}" patternUnits="userSpaceOnUse" width="6" height="6" patternTransform="rotate(45)">
        <rect width="6" height="6" fill="${couleur}" opacity="0.18" />
        <rect width="2.6" height="6" fill="${couleur}" />
      </pattern>`,
  };
}

function renderHistogrammeDepenses(depenses, monnaieId, container = null, options = {}) {
  // `options.comparaison` : les dépenses d'une SECONDE période, superposées
  // hachurées (cf. « LA PÉRIODE COMPARÉE »). `options.libelleCompare` la nomme
  // dans l'infobulle.
  const comparaison = options.comparaison || null;
  const compareParNom = new Map((comparaison || []).map((d) => [d.categorie, d]));
  container = container || document.getElementById("dashboard-histogramme");
  if (!container) return;
  container.innerHTML = "";
  if (depenses.length === 0) {
    container.innerHTML = `<span class="hint">${t("Aucune dépense enregistrée.")}</span>`;
    return;
  }

  const largeur = Math.max(container.clientWidth || 0, 600);
  const hauteur = 320;
  const margeBas = 70;
  const margeHaut = 20;
  const margeCote = 20;
  const zoneHauteur = hauteur - margeBas - margeHaut;

  const valeurMax = Math.max(
    1,
    ...depenses.map((d) =>
      Math.max(
        d.total_reel,
        d.total_previsionnel,
        d.budget_alloue,
        compareParNom.get(d.categorie)?.total_previsionnel || 0
      )
    )
  );
  const motifs = [];
  const echelle = zoneHauteur / (valeurMax * 1.1);

  const largeurBande = (largeur - margeCote * 2) / depenses.length;
  const largeurBarre = Math.min(60, largeurBande * 0.55);
  // LES NOMS SOUS LES BARRES DISPARAISSENT QUAND ILS SE MARCHERAIENT DESSUS : un nom de
  // douze lettres demande environ 64 px. En dessous, la légende (posée sous chaque
  // histogramme) nomme seule les couleurs — des noms empilés ne nomment plus rien.
  const avecNoms = largeurBande >= 64;

  const barres = depenses
    .map((d, i) => {
      // `d.couleur_index`, pas `i` : la position dans cette liste change dès
      // qu'une catégorie est éteinte ou réordonnée, la couleur non.
      const couleur = couleurBarre(d, i);
      const centreX = margeCote + largeurBande * i + largeurBande / 2;
      const x = centreX - largeurBarre / 2;

      const hReel = d.total_reel * echelle;
      const yReel = hauteur - margeBas - hReel;

      let barrePrevisionnel = "";
      let yHaut = yReel;
      if (d.total_previsionnel > d.total_reel) {
        const hDepasse = (d.total_previsionnel - d.total_reel) * echelle;
        const yDepasse = yReel - hDepasse;
        barrePrevisionnel = `<rect class="histo-fut" x="${x}" y="${yDepasse}" width="${largeurBarre}" height="${hDepasse}" fill="${couleur}" opacity="0.35" rx="3" />`;
        yHaut = yDepasse;
      }

      let tickBudget = "";
      if (d.budget_alloue > 0) {
        const yBudget = hauteur - margeBas - d.budget_alloue * echelle;
        // Rouge (couleur "critical", distincte de la palette catégorielle) :
        // signale une limite, pas une identité de catégorie.
        tickBudget = `<rect class="histo-repere" x="${x}" y="${yBudget - 1.5}" width="${largeurBarre}" height="3" fill="var(--budget-line)" />`;
      }

      // LA MÊME CATÉGORIE SUR LA PÉRIODE COMPARÉE. LA PLUS HAUTE DES DEUX
      // VALEURS NE REMPLIT QUE CE QUI DÉPASSE DE L'AUTRE : la plus basse se lit
      // entière dans son propre remplissage, et l'écart se lit à part, dans
      // celui de la plus haute.
      //   - comparée AU-DESSUS : la barre pleine reste telle quelle, les
      //     hachures ne couvrent que le morceau qui la dépasse ;
      //   - comparée EN DESSOUS : elle est hachurée en entier, et la barre
      //     pleine ne se voit plus qu'au-dessus d'elle — un fond masque la
      //     partie pleine qu'elle recouvre.
      let barreComparee = "";
      const comparee = compareParNom.get(d.categorie);
      if (comparee && comparee.total_previsionnel > 0) {
        const motif = motifHachure(couleur, "hachure-histo");
        motifs.push(motif.def);
        const hCompare = comparee.total_previsionnel * echelle;
        const hCourante = d.total_previsionnel * echelle;
        const base = hauteur - margeBas;
        if (hCompare > hCourante) {
          barreComparee = `<rect class="histo-fut histo-comparaison" x="${x}" y="${base - hCompare}" width="${largeurBarre}" height="${hCompare - hCourante}" fill="url(#${motif.id})" stroke="${couleur}" stroke-width="1" />`;
        } else {
          barreComparee = `<rect class="histo-fut" x="${x}" y="${base - hCompare}" width="${largeurBarre}" height="${hCompare}" fill="var(--bg-surface)" />
          <rect class="histo-fut histo-comparaison" x="${x}" y="${base - hCompare}" width="${largeurBarre}" height="${hCompare}" fill="url(#${motif.id})" stroke="${couleur}" stroke-width="1" />`;
        }
      }


      const nom = libelleCategorie(d.categorie);
      const label = nom.length > 12 ? nom.slice(0, 11) + "…" : nom;

      // Zone de survol sur TOUTE LA BANDE, pas sur la seule barre : une
      // catégorie à 3 € dessine quelques pixels de haut, impossibles à viser,
      // et une catégorie à 0 n'en dessine aucun — son infobulle serait
      // inatteignable alors qu'elle a quelque chose à dire (« aucune dépense »).
      const zoneSurvol = `<rect x="${margeCote + largeurBande * i}" y="${margeHaut}" width="${largeurBande}" height="${hauteur - margeBas - margeHaut}" fill="transparent" />`;

      // LA BARRE POUSSE DEPUIS LA LIGNE DE BASE, et les barres se suivent de
      // gauche à droite (`--retard`) : l'œil parcourt le graphe dans le sens où
      // il le lira. Seuls les RECTANGLES DE VALEUR sont animés — la zone de
      // survol, l'étiquette et le nombre restent où ils sont, sans quoi le
      // graphe deviendrait inutilisable pendant qu'il se dessine.
      return `
        <g class="histo-barre" data-index="${i}" data-categorie="${escapeHtml(d.categorie)}" style="--retard:${i * 28}ms">
          ${zoneSurvol}
          <rect class="histo-fut" x="${x}" y="${yReel}" width="${largeurBarre}" height="${hReel}" fill="${couleur}" rx="3" />
          ${barrePrevisionnel}
          ${barreComparee}
          ${tickBudget}
          ${
            avecNoms
              ? `<text x="${centreX}" y="${hauteur - margeBas + 18}" text-anchor="middle" font-size="11" fill="var(--text-secondary)">${label}</text>`
              : ""
          }
          <text class="histo-valeur" x="${centreX}" y="${yHaut - 6}" text-anchor="middle" font-size="10" fill="var(--text-primary)">${d.total_previsionnel.toFixed(0)}</text>
        </g>
      `;
    })
    .join("");

  const ligneBase = `<line x1="${margeCote}" y1="${hauteur - margeBas}" x2="${largeur - margeCote}" y2="${hauteur - margeBas}" stroke="var(--border)" stroke-width="1" />`;

  container.innerHTML = `
    <svg viewBox="0 0 ${largeur} ${hauteur}" width="100%" height="${hauteur}" xmlns="http://www.w3.org/2000/svg">
      <defs>${motifs.join("")}</defs>
      ${ligneBase}
      ${barres}
    </svg>
  `;

  // UN GRAPHE DE MONTANTS SE COMMENTE EN MONTANTS : le total de la barre, et
  // son budget — celui-là même que dessine le trait rouge. Le pourcentage, lui,
  // est la réponse du camembert d'à côté ; le répéter ici aurait donné deux
  // graphes qui disent la même chose au lieu de deux questions.
  attacherInfobulleCategorie(
    container,
    [...container.querySelectorAll("svg g[data-index]")],
    (groupe) => {
      const depense = depenses[Number(groupe.dataset.index)];
      if (estColonneGrise(depense)) return contenuInfobulleConversion(depense, monnaieId);
      return {
        depense,
        html: contenuInfobulleCategorie(depense, monnaieId, {
          total: depense.total_previsionnel,
          budget: depense.budget_alloue,
          compareLibelle: comparaison ? options.libelleCompare || t("Comparée") : null,
          compareTotal: comparaison
            ? compareParNom.get(depense.categorie)?.total_previsionnel || 0
            : null,
        }),
      };
    }
  );
}

/* ---------- Le camembert des dépenses ----------
 *
 * GÉOMÉTRIE, en unités du viewBox. Le disque est posé au centre d'un cadre un
 * peu plus large que haut : les pourcentages s'écrivent À CÔTÉ des tranches, et
 * il leur faut de la place à gauche comme à droite. Écrits SUR les tranches,
 * ils auraient été illisibles sur tout ce qui pèse moins de quelques pour cent
 * — c'est-à-dire précisément ce qu'on vient vérifier.
 */
// Miroir de `constants.Statut` : les deux seules valeurs que le serveur
// connaisse. Écrites une fois, pour que la case du formulaire et les filtres
// parlent du même vocabulaire que lui.
const STATUT_REEL = "réel";
const STATUT_PREVISIONNEL = "prévisionnel";

const PIE_CENTRE_X = 190;
const PIE_CENTRE_Y = 110;
const PIE_RAYON = 80; // rayon MOYEN de l'anneau (le trait est centré dessus)
const PIE_EPAISSEUR = 34;
// Le bord extérieur de l'anneau, d'où part le trait de rappel.
const PIE_BORD = PIE_RAYON + PIE_EPAISSEUR / 2;

/* LE TRAIT DE RAPPEL EST UN PETIT CROCHET, `_/` à gauche et `\_` à droite, et
   non la longue potence d'avant. Celle-ci partait du disque pour aller poser
   tous les pourcentages sur deux colonnes alignées, très loin des tranches : la
   colonne se lisait bien, mais il fallait suivre vingt pixels de trait gris
   pour savoir à QUELLE part chaque nombre appartenait — exactement le travail
   qu'un trait de rappel est censé épargner. Court, il désigne ; long, il relie.

   DEUX SEGMENTS, ET DES PROPORTIONS QUI COMPTENT : une oblique RADIALE (elle
   prolonge le rayon, donc elle pointe vers le centre — c'est ce qui la rattache
   sans ambiguïté à sa tranche), puis une horizontale plus courte qu'elle, sur
   laquelle le texte vient s'asseoir. L'horizontale est ce qui rend le nombre
   lisible : sans elle, un texte accroché au bout d'une oblique semble flotter. */
const PIE_OBLIQUE = 11;
const PIE_HORIZONTALE = 7;
// L'écart vertical minimal entre deux étiquettes voisines d'un même côté (cf.
// pieEcarterEtiquettes) : en dessous, deux parts contiguës écrivent l'une sur
// l'autre.
const PIE_ECART_MIN = 13;

/* LA MARGE AU-DESSUS DU DESSIN, et pourquoi il en faut une.
 *
 * L'étiquette la plus haute se pose à `PIE_CENTRE_Y - (PIE_BORD + PIE_OBLIQUE)`,
 * soit y = 2 — et un texte de 10 en `dominant-baseline: middle` déborde de cinq
 * unités au-dessus de son y. La tranche de midi écrivait donc son pourcentage à
 * cheval sur le bord du viewBox, coupé en deux, juste sous la rangée d'onglets
 * « État actuel / Budget » : de loin, cela se lit comme un nombre caché par
 * l'onglet.
 *
 * PAS DE CALCUL DYNAMIQUE : il manque une dizaine d'unités, toujours les mêmes,
 * et elles ne dépendent de rien. Le viewBox commence donc au-dessus de zéro
 * (`0 -PIE_MARGE_HAUTE`) plutôt que de translater tout le dessin : les
 * coordonnées de l'anneau et des crochets ne bougent pas d'un pouce, et
 * `pieEcarterEtiquettes` continue de raisonner sur la même hauteur.
 *
 * LA PLACE VIENT DE LA RANGÉE D'ONGLETS, qui portait une marge basse d'un `rem`
 * héritée de `.sous-onglets` alors qu'elle vit dans un en-tête qui a déjà la
 * sienne (cf. `.camembert-vues` dans style.css). Le bloc garde donc exactement
 * la même hauteur qu'avant — on ne fait que la répartir autrement. */
const PIE_MARGE_HAUTE = 12;
// La hauteur RENDUE du graphe, en pixels. Elle suit la marge : sans cela, le
// viewBox plus haut serait ramené dans la même boîte, et le disque rapetissé de
// ce qu'on vient de lui donner.
const PIE_HAUTEUR_RENDU = 250 + PIE_MARGE_HAUTE;

/**
 * Écarte verticalement les étiquettes d'un même côté du disque.
 *
 * POURQUOI IL EN FAUT UNE. La position naturelle d'une étiquette est la hauteur
 * du bout de son crochet — c'est ce qui la rattache à sa tranche sans
 * ambiguïté. Deux tranches fines et voisines ont presque le même milieu : leurs
 * deux étiquettes se superposent, et on perd les DEUX au lieu d'une.
 *
 * L'ALGORITHME EST LE PLUS SIMPLE QUI MARCHE : on trie de haut en bas, on
 * pousse vers le bas ce qui est trop près du précédent, puis on repasse de bas
 * en haut pour remonter ce qui aurait débordé du cadre. Deux passes suffisent
 * tant que le nombre d'étiquettes tient dans la hauteur ; au-delà, elles
 * finissent collées les unes aux autres plutôt que hors cadre — dégradé, mais
 * jamais absent.
 *
 * LE DÉCALAGE ALLONGE L'OBLIQUE là où il y a collision, et seulement là : c'est
 * le comportement qu'on attend d'un trait de rappel, et c'est aussi ce qui
 * permet de le garder court partout ailleurs.
 */
function pieEcarterEtiquettes(etiquettes, hauteur) {
  etiquettes.sort((a, b) => a.y - b.y);
  for (let i = 1; i < etiquettes.length; i++) {
    const ecart = etiquettes[i].y - etiquettes[i - 1].y;
    if (ecart < PIE_ECART_MIN) etiquettes[i].y = etiquettes[i - 1].y + PIE_ECART_MIN;
  }
  for (let i = etiquettes.length - 1; i >= 0; i--) {
    const plancher = hauteur - 6 - PIE_ECART_MIN * (etiquettes.length - 1 - i);
    if (etiquettes[i].y > plancher) etiquettes[i].y = plancher;
  }
  return etiquettes;
}

/**
 * Le camembert des dépenses par catégorie (cf. renderHistogrammeDashboard,
 * seul appelant).
 *
 * IL NE CALCULE RIEN LUI-MÊME : parts, total et objectifs viennent de
 * `partsCategoriesDashboard`, qu'il partage avec l'histogramme et la légende
 * (cf. son en-tête, où vit le raisonnement sur le dénominateur et la
 * renormalisation des objectifs).
 *
 * PLUS DE LÉGENDE ICI. Elle est devenue un TROISIÈME BLOC, sous les deux
 * graphes : elle nomme les mêmes catégories pour l'un comme pour l'autre, et en
 * avoir une par graphe revenait à écrire deux fois la même liste de couleurs,
 * l'une sous des barres et l'autre sous un anneau.
 */
// LE PETIT ANNEAU, quand on compare : celui de la période COURANTE, en aplat —
// les hachures de la période comparée prennent le grand, où elles se lisent.
// Assez loin du centre pour y laisser le total.
const PIE_RAYON_COMPARE = 50;
const PIE_EPAISSEUR_COMPARE = 16;

function renderPieChartDepenses(depenses, monnaieId, container, parts, options = {}) {
  // `options.comparaison` : les PARTS (cf. partsCategoriesDashboard) d'une
  // seconde période, dessinées en anneau EXTÉRIEUR, hachuré et grisé ; la
  // période courante passe alors dans le petit anneau. Chaque anneau garde SA
  // référence : les deux peuvent être ouverts.
  const partsCompare = options.comparaison || null;
  container = container || document.getElementById("dashboard-camembert");
  if (!container) return;
  container.innerHTML = "";

  const { tranches, total, vueBudget, budgetTotal } = parts;
  if (total <= 0) {
    container.innerHTML = `<span class="hint">${
      depenses.length === 0
        ? t("Aucune dépense enregistrée.")
        : t("Aucune catégorie sélectionnée.")
    }</span>`;
    return;
  }

  const largeur = PIE_CENTRE_X * 2;
  const hauteur = PIE_CENTRE_Y * 2;
  // AVEC UNE COMPARAISON, LES DEUX ANNEAUX ÉCHANGENT LEUR PLACE : la période
  // comparée (hachurée) passe DEHORS, en grand, la période courante (pleine)
  // dedans. Des hachures se lisent moins bien qu'un aplat ; les dessiner dans
  // le petit anneau les rendait illisibles.
  const rayonPrincipal = partsCompare ? PIE_RAYON_COMPARE : PIE_RAYON;
  const epaisseurPrincipale = partsCompare ? PIE_EPAISSEUR_COMPARE : PIE_EPAISSEUR;
  const rayonCompare = PIE_RAYON;
  const epaisseurCompare = PIE_EPAISSEUR;
  const circonference = 2 * Math.PI * rayonPrincipal;

  // CE QUE REPRÉSENTE UN TOUR COMPLET. En vue « état actuel », le total
  // dépensé : l'anneau est plein par construction. En vue « budget », le budget
  // — l'anneau reste alors OUVERT sur ce qui n'a pas été dépensé, et c'est tout
  // l'intérêt de la vue : le vide est un chiffre, lui aussi.
  //
  // SAUF EN CAS DE DÉPASSEMENT, où le tour vaut de nouveau le total dépensé :
  // au-delà du budget, garder le budget pour référence ferait tourner les
  // tranches plus d'une fois sur elles-mêmes, et les dernières recouvriraient
  // les premières sans que rien ne le signale. L'anneau se remplit donc.
  //
  // ET C'EST LE CENTRE QUI DIT LE DÉPASSEMENT, lui seul : « 3 200 € sur
  // 2 500 € », le premier chiffre en rouge. Un trait rouge le marquait aussi
  // sur l'anneau — deux fois la même nouvelle, dont l'une tombait au milieu
  // d'une tranche à laquelle elle ne se rapportait pas : l'ordre des tranches
  // est celui des catégories, et rien ne désigne « celle qui a fait déborder ».
  // Posé là, le trait se lisait pourtant comme une accusation.
  const depassement = vueBudget && total > budgetTotal;
  const reference = vueBudget && !depassement ? budgetTotal : total;

  let angleCumule = 0; // fraction de tour déjà parcourue, dans [0, 1[
  const etiquettes = [];

  // LE FOND DE L'ANNEAU, seulement en vue budget : sans lui, la part non
  // dépensée serait un trou, indiscernable du cadre — et un anneau incomplet se
  // lirait comme un graphe à moitié dessiné plutôt que comme un budget à moitié
  // consommé.
  const piste = vueBudget
    ? `<circle class="camembert-piste" cx="${PIE_CENTRE_X}" cy="${PIE_CENTRE_Y}" r="${rayonPrincipal}"
        fill="none" stroke-width="${epaisseurPrincipale}" />`
    : "";

  const segments = tranches
    .map((d, i) => {
      const fraction = d.total_previsionnel / reference;
      const longueur = fraction * circonference;
      const couleur = couleurBarre(d, i);
      // LA TRANCHE SE COLORE LE LONG DE L'ANNEAU (cf. .camembert-part) : son
      // tiret part de zéro et s'allonge jusqu'à sa longueur, après le temps
      // qu'ont mis les tranches précédentes. Les deux valeurs voyagent en
      // variables CSS parce que c'est la seule façon d'écrire une keyframe
      // commune à des tranches qui n'ont pas la même longueur.
      const segment = `<circle class="camembert-part" data-index="${i}" data-categorie="${escapeHtml(d.categorie)}" cx="${PIE_CENTRE_X}" cy="${PIE_CENTRE_Y}" r="${rayonPrincipal}"
        fill="none" stroke="${couleur}" stroke-width="${epaisseurPrincipale}"
        stroke-dasharray="${longueur} ${circonference - longueur}"
        stroke-dashoffset="${-angleCumule * circonference}"
        style="--tour:${circonference};--part:${longueur};--reste:${circonference - longueur};--retard:${(angleCumule * PIE_ANIMATION_MS).toFixed(0)}ms;--duree:${Math.max(fraction * PIE_ANIMATION_MS, 60).toFixed(0)}ms" />`;

      // L'angle du MILIEU de la tranche, compté depuis midi dans le sens des
      // aiguilles : c'est ce point-là qu'un trait de rappel doit désigner, pas
      // un bord partagé avec la tranche voisine.
      const angle = (angleCumule + fraction / 2) * 2 * Math.PI;
      const sin = Math.sin(angle);
      const cos = Math.cos(angle);
      etiquettes.push({
        index: i,
        pourcentage: parts.part(d),
        // Le pied du crochet, sur le bord de l'anneau…
        ancreX: PIE_CENTRE_X + (PIE_BORD + 1) * sin,
        ancreY: PIE_CENTRE_Y - (PIE_BORD + 1) * cos,
        // …et son coude, un cran plus loin sur le même rayon.
        coudeX: PIE_CENTRE_X + (PIE_BORD + PIE_OBLIQUE) * sin,
        y: PIE_CENTRE_Y - (PIE_BORD + PIE_OBLIQUE) * cos,
        droite: sin >= 0,
      });

      angleCumule += fraction;
      return segment;
    })
    .join("");

  // Chaque côté s'écarte séparément : une étiquette de gauche ne gêne jamais
  // une étiquette de droite, et les mêler aurait poussé les deux colonnes vers
  // le bas pour rien.
  // SANS ÉTIQUETTES QUAND ON COMPARE : elles se posent au bord de l'anneau
  // extérieur, qui est alors celui de l'AUTRE période — elles auraient désigné
  // la mauvaise tranche. Les parts restent dans l'infobulle et la légende.
  const rappels = partsCompare ? "" : [
    ...pieEcarterEtiquettes(etiquettes.filter((e) => e.droite), hauteur),
    ...pieEcarterEtiquettes(etiquettes.filter((e) => !e.droite), hauteur),
  ]
    .map((e) => {
      const signe = e.droite ? 1 : -1;
      const boutX = e.coudeX + signe * PIE_HORIZONTALE;
      return `
        <g class="camembert-rappel" data-index="${e.index}">
          <polyline points="${e.ancreX},${e.ancreY} ${e.coudeX},${e.y} ${boutX},${e.y}"
                    fill="none" stroke="currentColor" stroke-width="1" />
          <text x="${boutX + signe * 3}" y="${e.y}" dominant-baseline="middle"
                text-anchor="${e.droite ? "start" : "end"}" font-size="10">${formatPourcentage(
                  e.pourcentage
                )}</text>
        </g>`;
    })
    .join("");

  // L'ANNEAU DE LA PÉRIODE COMPARÉE (dehors) : même calcul que l'autre, sur
  // les parts comparées.
  const motifs = [];
  let segmentsCompare = "";
  if (partsCompare && partsCompare.total > 0) {
    const circCompare = 2 * Math.PI * rayonCompare;
    const depasseCompare =
      partsCompare.vueBudget && partsCompare.total > partsCompare.budgetTotal;
    const refCompare =
      partsCompare.vueBudget && !depasseCompare ? partsCompare.budgetTotal : partsCompare.total;
    let cumul = 0;
    const pisteCompare = partsCompare.vueBudget
      ? `<circle class="camembert-piste" cx="${PIE_CENTRE_X}" cy="${PIE_CENTRE_Y}" r="${rayonCompare}"
          fill="none" stroke-width="${epaisseurCompare}" />`
      : "";
    segmentsCompare =
      pisteCompare +
      partsCompare.tranches
        .map((d, i) => {
          const fraction = d.total_previsionnel / refCompare;
          const longueur = fraction * circCompare;
          const motif = motifHachure(couleurBarre(d, i), "hachure-pie");
          motifs.push(motif.def);
          const cercle = `<circle class="camembert-part camembert-comparaison" data-index-compare="${i}" data-categorie="${escapeHtml(d.categorie)}" cx="${PIE_CENTRE_X}" cy="${PIE_CENTRE_Y}" r="${rayonCompare}"
            fill="none" stroke="url(#${motif.id})" stroke-width="${epaisseurCompare}"
            stroke-dasharray="${longueur} ${circCompare - longueur}"
            stroke-dashoffset="${-cumul * circCompare}"
            style="--tour:${circCompare};--part:${longueur};--reste:${circCompare - longueur};--retard:${(cumul * PIE_ANIMATION_MS).toFixed(0)}ms;--duree:${Math.max(fraction * PIE_ANIMATION_MS, 60).toFixed(0)}ms" />`;
          cumul += fraction;
          return cercle;
        })
        .join("");
  }

  // AU CENTRE, CE À QUOI LES PARTS SE RAPPORTENT. En vue « état actuel », le
  // total dépensé — le dénominateur lui-même. En vue budget, les DEUX chiffres :
  // n'écrire que le total dépensé aurait laissé deviner le budget à partir des
  // pourcentages, alors que c'est lui la question.
  const centre = vueBudget
    ? `<text x="${PIE_CENTRE_X}" y="${PIE_CENTRE_Y - 7}" text-anchor="middle"
             dominant-baseline="middle" font-size="13"
             class="${depassement ? "camembert-centre-depasse" : "camembert-centre"}">${formatMontant(
               total,
               monnaieId
             )}</text>
       <text x="${PIE_CENTRE_X}" y="${PIE_CENTRE_Y + 9}" text-anchor="middle"
             dominant-baseline="middle" font-size="11" fill="var(--text-secondary)">${t(
               "sur"
             )} ${formatMontant(budgetTotal, monnaieId)}</text>`
    : `<text x="${PIE_CENTRE_X}" y="${PIE_CENTRE_Y}" text-anchor="middle"
             dominant-baseline="middle" font-size="13" fill="var(--text-secondary)">${formatMontant(
               total,
               monnaieId
             )}</text>`;

  container.innerHTML = `
    <svg viewBox="0 ${-PIE_MARGE_HAUTE} ${largeur} ${hauteur + PIE_MARGE_HAUTE}"
         width="100%" height="${PIE_HAUTEUR_RENDU}"
         xmlns="http://www.w3.org/2000/svg" class="camembert-svg">
      <defs>${motifs.join("")}</defs>
      <!-- Part à midi, sens horaire : -90° ramène le début du premier tracé
           (3 heures, l'origine d'un cercle SVG) à midi. Seul l'anneau tourne —
           les traits de rappel et leurs textes sont déjà calculés en
           coordonnées d'écran, les faire tourner avec lui écrirait les
           pourcentages couchés. -->
      <g transform="rotate(-90 ${PIE_CENTRE_X} ${PIE_CENTRE_Y})">${piste}${segments}${segmentsCompare}</g>
      ${rappels}
      ${centre}
    </svg>
  `;

  // UN GRAPHE DE PARTS SE COMMENTE EN PARTS. En vue budget, l'objectif s'y
  // ajoute : c'est le seul endroit de l'écran où il soit COMPARABLE à la part
  // affichée à côté, les deux étant rapportés au même budget.
  attacherInfobulleCategorie(
    container,
    [...container.querySelectorAll("circle.camembert-part")],
    (cercle) => {
      // L'ANNEAU INTÉRIEUR a sa propre liste de tranches : c'est la même
      // infobulle, vue depuis la période comparée.
      if (cercle.dataset.indexCompare !== undefined) {
        const depense = partsCompare.tranches[Number(cercle.dataset.indexCompare)];
        return {
          depense,
          html: contenuInfobulleCategorie(depense, monnaieId, {
            part: partsCompare.part(depense),
            partLibelle: options.libelleCompare || t("Comparée"),
          }),
        };
      }
      const depense = tranches[Number(cercle.dataset.index)];
      if (estColonneGrise(depense)) return contenuInfobulleConversion(depense, monnaieId);
      const comparee = partsCompare?.retenues.find((d) => d.categorie === depense.categorie);
      return {
        depense,
        html: contenuInfobulleCategorie(depense, monnaieId, {
          part: parts.part(depense),
          partLibelle: vueBudget ? t("Part du budget") : t("Part"),
          objectif: parts.objectif(depense),
          compareLibelle: partsCompare ? options.libelleCompare || t("Comparée") : null,
          comparePart: partsCompare ? (comparee ? partsCompare.part(comparee) : 0) : null,
        }),
      };
    }

  );
}

/**
 * LA LÉGENDE, TROISIÈME BLOC ET NON MORCEAU D'UN GRAPHE.
 *
 * POURQUOI ELLE SORT. Les deux graphes montrent les mêmes catégories dans les
 * mêmes couleurs : une légende par graphe, c'était écrire deux fois la même
 * liste, et prendre deux fois la place. Sous les deux, elle occupe toute la
 * largeur, se replie sur autant de colonnes qu'elle peut, et ce qu'on y lit
 * vaut pour l'un comme pour l'autre.
 *
 * ELLE NE PORTE QUE LE NOM ET LA PART. Le montant a disparu — l'histogramme
 * juste au-dessus est là pour la vision en brut, et le répéter en colonne
 * revenait à faire un tableau sous un graphe. L'objectif aussi : il est écrit
 * au bord du camembert, là où il se compare à la part constatée. Ce qui reste
 * est ce qui permet de RECONNAÎTRE une catégorie — sa couleur et son nom — plus
 * le seul chiffre qui ne se lit nulle part ailleurs d'un coup d'œil.
 *
 * SON INFOBULLE EST LA PLUS COMPLÈTE DES TROIS, et c'est la contrepartie :
 * total dépensé, part, budget de la catégorie, et son objectif de répartition
 * quand le camembert est en vue budget. Elle est le point d'entrée de qui veut
 * tout savoir sur une catégorie sans choisir son graphe.
 */
function renderLegendeCategories(monnaieId, parts, container = null) {
  container = container || document.getElementById("dashboard-legende");
  if (!container) return;
  container.innerHTML = "";
  // Les catégories RETENUES, pas les seules tranches : une catégorie à zéro
  // garde sa barre dans l'histogramme, elle doit garder sa ligne ici — sans
  // quoi une barre resterait sans couleur nommée.
  const lignes = parts.retenues;
  if (lignes.length === 0) {
    container.innerHTML = `<span class="hint">${t("Aucune catégorie sélectionnée.")}</span>`;
    return;
  }

  container.innerHTML = `
    <ul class="camembert-legende">${lignes
      .map(
        (d, i) => `
        <li class="camembert-legende-ligne" data-index="${i}" data-categorie="${escapeHtml(d.categorie)}">
          <span class="camembert-pastille" style="background:${couleurBarre(d, i)}"></span>
          <span class="camembert-legende-nom">${escapeHtml(libelleCategorie(d.categorie))}</span>
          <span class="camembert-legende-part">${
            d.conversion?.sens === "depuis" ? "" : formatPourcentage(parts.part(d))
          }</span>
        </li>`
      )
      .join("")}</ul>
  `;

  attacherInfobulleCategorie(
    container,
    [...container.querySelectorAll(".camembert-legende-ligne")],
    (ligne) => {
      const depense = lignes[Number(ligne.dataset.index)];
      if (estColonneGrise(depense)) return contenuInfobulleConversion(depense, monnaieId);
      return {
        depense,
        html: contenuInfobulleCategorie(depense, monnaieId, {
          total: depense.total_previsionnel,
          part: parts.part(depense),
          partLibelle: parts.vueBudget ? t("Part du budget") : t("Part"),
          budget: depense.budget_alloue,
          objectif: parts.objectif(depense),
        }),
      };
    }
  );

}

/**
 * SURVOLER UNE BARRE, UNE TRANCHE OU UNE LIGNE DE LÉGENDE ÉCLAIRE LES TROIS.
 *
 * CE QUE ÇA RÉSOUT. L'infobulle dit ce qu'on regarde, elle ne dit pas OÙ —
 * une bulle qui suit le curseur ne désigne rien à elle seule. Et depuis que la
 * légende est un bloc à part, sous les deux graphes, retrouver laquelle des
 * huit tranches porte « Réparation & entretien » demanderait de comparer deux
 * pastilles de couleur à dix centimètres l'une de l'autre.
 *
 * PAR LE NOM, ET NON PAR L'INDEX : les trois rendus ne listent pas exactement
 * les mêmes lignes (le camembert écarte les catégories à zéro, qui gardent
 * pourtant leur barre et leur ligne de légende). Le nom est la seule clé qu'ils
 * partagent.
 *
 * CÂBLÉ ICI, APRÈS LES TROIS RENDUS, parce que c'est le seul moment où ils
 * existent tous : posé dans l'un d'eux, il n'aurait trouvé que ce qui était
 * déjà dessiné.
 */
function cablerSurbrillanceCategories() {
  document.querySelectorAll("[data-categorie]").forEach((element) => {
    // UN ÉLÉMENT DÉJÀ CÂBLÉ NE SE RECÂBLE PAS. Un rendu PARTIEL existe désormais
    // (cf. renderVuePieDashboard, qui laisse l'histogramme en place) : sans
    // cette marque, chaque bascule de vue posait une seconde paire d'écouteurs
    // sur des barres que personne n'avait recréées — une fuite silencieuse, le
    // même travail refait N fois.
    if (element.dataset.surbrillanceCablee) return;
    element.dataset.surbrillanceCablee = "1";
    const nom = element.dataset.categorie;
    const jumeaux = () => [
      ...document.querySelectorAll(`[data-categorie="${CSS.escape(nom)}"]`),
    ];
    element.addEventListener("mouseenter", () =>
      jumeaux().forEach((el) => el.classList.add("survolee"))
    );
    element.addEventListener("mouseleave", () =>
      jumeaux().forEach((el) => el.classList.remove("survolee"))
    );
  });
}

/* ---------- LA CASCADE (waterfall) d'une monnaie ----------
 *
 * LE SERVEUR DÉCIDE DES MARCHES (services/cascade.py) : catégories au net,
 * épargne, frais de virements internes, conversions. L'écran ne fait que les
 * nommer — dans sa langue — et les dessiner, puis ajoute la dernière marche,
 * « Solde », qui part de zéro.
 *
 * LES COULEURS SONT CELLES DU RESTE DE L'APPLICATION : toutes les catégories
 * d'entrée dans le même vert, chaque catégorie de dépense dans la couleur de sa
 * barre d'histogramme, le gris des conversions (cf. couleurConversion), le violet
 * des comptes d'épargne.
 *
 * DEUX APPELANTS : la page d'un projet (une cascade par monnaie) et la fenêtre
 * de détail d'une monnaie éteinte. `options.ouvrirConversion(monnaieAutreId)`
 * rend, s'il y a lieu, le geste qui ouvre le détail de la monnaie d'en face.
 */
function libelleColonneCascade(colonne) {
  if (colonne.genre === "epargne") {
    return colonne.montant < 0
      ? t("Vers l'épargne ou les placements")
      : t("Depuis l'épargne ou les placements");
  }
  if (colonne.genre === "frais") return t("Frais de virements internes");
  if (colonne.genre === "conversion") {
    return libelleConversion(colonne.montant, colonne.monnaie_autre_id);
  }
  return libelleCategorie(colonne.libelle);
}

/** La couleur d'une marche : celle de sa catégorie (les entrées ont la leur, écrite en
 *  base, cf. COULEUR_INDEX_ENTREE), le violet des comptes d'épargne, et les gris réservés
 *  aux frais et aux conversions. Une seule fonction pour le graphe et sa légende. */
function couleurColonneCascade(cascade, colonne) {
  if (colonne.genre === "conversion") {
    return couleurConversion(cascade.monnaie_id, colonne.monnaie_autre_id);
  }
  if (colonne.genre === "epargne") return "var(--compte-epargne)";
  if (colonne.genre === "frais") return GRIS_FRAIS;
  if (colonne.est_entree && (colonne.couleur_index ?? COULEUR_INDEX_ENTREE) >= 0) {
    // Une ligne d'entrée qui n'est pas une catégorie (un prêt reçu, un remboursement) :
    // la couleur des entrées, comme une catégorie d'entrée.
    return couleurCategorie(COULEUR_INDEX_ENTREE);
  }
  return couleurCategorie(colonne.couleur_index ?? 0);
}

/**
 * LA LÉGENDE D'UNE CASCADE : chaque marche, sa couleur et son montant. Posée entre la
 * cascade et le camembert de la fenêtre d'une monnaie éteinte — elle nomme les couleurs
 * des deux, et c'est la seule légende de la fenêtre quand elle s'ouvre depuis un projet.
 */
function renderLegendeCascade(cascade, container) {
  if (!container) return;
  const colonnes = cascade.colonnes || [];
  container.innerHTML = colonnes.length
    ? `<ul class="camembert-legende">${colonnes
        .map(
          (c) => `
        <li class="camembert-legende-ligne"${
          c.genre === "entree" || c.genre === "depense"
            ? ` data-categorie="${escapeHtml(c.libelle)}"`
            : ""
        }>
          <span class="camembert-pastille" style="background:${couleurColonneCascade(cascade, c)}"></span>
          <span class="camembert-legende-nom">${escapeHtml(libelleColonneCascade(c))}</span>
          <span class="camembert-legende-part">${formatMontant(c.montant, cascade.monnaie_id)}</span>
        </li>`
        )
        .join("")}</ul>`
    : "";
}

function renderCascade(cascade, container, options = {}) {
  container.innerHTML = "";
  const marches = [];
  let niveau = 0;
  (cascade.colonnes || []).forEach((colonne) => {
    const marche = {
      colonne,
      libelle: libelleColonneCascade(colonne),
      de: niveau,
      a: niveau + colonne.montant,
    };
    marche.couleur = couleurColonneCascade(cascade, colonne);
    marches.push(marche);
    niveau += colonne.montant;
  });
  marches.push({
    libelle: t("Solde"),
    de: 0,
    a: niveau,
    classe: niveau < 0 ? "wf-deficit" : "wf-solde",
    solde: true,
  });

  const largeur = Math.max(420, marches.length * 64 + 70);
  // Une marge basse pour des libellés penchés assez longs pour garder le nom de la
  // monnaie d'une conversion (« Conversion vers Franc s… » ne dirait plus rien).
  const hauteur = 300;
  const marge = { g: 8, d: 8, h: 22, b: 98 };
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
      const delta = m.solde ? m.a : m.a - m.de;
      const texte = `${delta < 0 ? "−" : m.solde ? "" : "+"}${formatMontant(
        Math.abs(delta),
        cascade.monnaie_id
      )}`;
      const etiquette = m.libelle.length > 20 ? `${m.libelle.slice(0, 19)}…` : m.libelle;
      // Le raccord avec la marche suivante : un trait fin au niveau d'arrivée.
      const raccord =
        i < marches.length - 1 && !m.solde
          ? `<line class="wf-raccord" x1="${x + epaisseur}" x2="${x + pas}" y1="${y(m.a)}" y2="${y(m.a)}" />`
          : "";
      // Toute la bande est survolable : une marche de 3 € fait un pixel de haut.
      return `
        <g class="wf-marche" data-index="${i}">
          <rect x="${marge.g + i * pas}" y="${marge.h}" width="${pas}" height="${hauteur - marge.h - marge.b}" fill="transparent" />
          <rect class="${m.classe || ""}" x="${x}" y="${y1}" width="${epaisseur}"
                height="${Math.max(1, y2 - y1)}" rx="2"
                ${m.couleur ? `style="fill:${m.couleur}"` : ""} />
          ${raccord}
          <text class="wf-valeur" x="${cx}" y="${y1 - 4}" text-anchor="middle">${escapeHtml(texte)}</text>
          <text class="wf-libelle" transform="translate(${cx} ${hauteur - marge.b + 12}) rotate(40)">${escapeHtml(etiquette)}</text>
        </g>`;
    })
    .join("");

  container.innerHTML = `
    <div class="waterfall-cadre">
      <svg class="waterfall" viewBox="0 0 ${largeur} ${hauteur}" width="${largeur}" height="${hauteur}"
           role="img" aria-label="${escapeHtml(t("Entrées et sorties"))}">
        <line class="wf-zero" x1="${marge.g}" x2="${largeur - marge.d}" y1="${y(0)}" y2="${y(0)}" />
        ${barres}
      </svg>
    </div>`;

  // L'INFOBULLE DES MARCHES : le montant, et les plus grosses lignes qui le
  // font. Celle d'une conversion porte en plus le geste qui ouvre le détail de
  // la monnaie d'en face, quand l'appelant en fournit un.
  // La bulle s'ancre sur le CONTENEUR et non sur le cadre qui défile : celui-ci
  // la couperait à sa hauteur.
  container.style.position = "relative";
  attacherInfobulleCategorie(
    container,
    [...container.querySelectorAll("g.wf-marche")],
    (groupe) => {
      const m = marches[Number(groupe.dataset.index)];
      const colonne = m.colonne;
      const montant = m.solde ? m.a : colonne.montant;
      const ouvrir =
        colonne?.genre === "conversion" && options.ouvrirConversion
          ? options.ouvrirConversion(colonne.monnaie_autre_id)
          : colonne?.genre === "frais"
            ? options.ouvrirFrais || null
            : null;
      return {
        depense: null,
        html: `<div class="histo-bulle-titre">${escapeHtml(m.libelle)}</div>
          <ul class="histo-bulle-chiffres"><li><span class="histo-bulle-nature">${escapeHtml(
            t("Total")
          )}</span><span class="histo-bulle-montant">${formatMontant(
            montant,
            cascade.monnaie_id
          )}</span></li></ul>
          ${colonne ? listeTopHtml(colonne.top, cascade.monnaie_id) : ""}
          ${
            ouvrir
              ? `<button type="button" class="histo-bulle-lien" data-action-bulle="ouvrir">${escapeHtml(
                  colonne.genre === "frais"
                    ? t("Voir le détail des frais")
                    : t("Ouvrir le détail : {monnaie}", {
                        monnaie: monnaieParId(colonne.monnaie_autre_id)?.nom || "?",
                      })
                )}</button>`
              : ""
          }`,
        actions: { ouvrir },
      };
    }
  );
}

/* ---------- LA FENÊTRE DE DÉTAIL D'UNE MONNAIE ÉTEINTE ----------
 *
 * Ouverte depuis une colonne grise « Conversion vers… » quand les monnaies
 * éteintes s'affichent « en pop-up » (cf. modeMonnaiesEteintes). DEUX FORMES :
 *
 *   - `{ cascade }` (un projet) : la cascade est déjà là, la fenêtre la dessine ;
 *   - `{ periode, origine }` (dashboard et page Budget) : les MÊMES GRAPHES QUE LA PAGE
 *     d'où l'on vient — histogramme, camembert et légende — pour la monnaie éteinte, avec
 *     un sélecteur de période (seuls les mois qui portent une opération dans cette
 *     monnaie y sont proposés) et « Voir les virements », ceux qui relient la monnaie
 *     d'origine (`origine`) à l'éteinte sur la période de la fenêtre.
 *
 * Les drill-throughs des barres s'y font sur la période DE LA FENÊTRE (`drill_bornes`).
 */
const fenetreMonnaieEteinte = {
  monnaieId: null,
  niveau: "mois",
  vue: "mois",
  annee: null,
  mois: null,
  moisDeplie: true,
  periodes: [],
  // { monnaieId, colonne } : la colonne de conversion d'où la fenêtre a été ouverte.
  origine: null,
  vuePie: null,
};

function fermerFenetreMonnaieEteinte() {
  const fond = document.getElementById("modale-monnaie-eteinte");
  if (!fond || fond.style.display === "none") return;
  fond.style.display = "none";
  document.body.classList.remove("modale-ouverte");
}

/**
 * Les dates d'une période (vue mois, année, tout, et une semaine éventuelle), au format
 * des filtres de la page Opérations. « Tout » n'a pas de borne à lui : de la première
 * année qui porte des opérations à la dernière.
 */
function bornesPeriode({ vue, annee, mois, semaine = null }) {
  const pad = (n) => String(n).padStart(2, "0");
  if (vue === "tout") {
    const annees = dashboardPeriodesConnues.map((p) => p.annee);
    const repli = annee || new Date().getFullYear();
    return {
      debut: `${annees.length ? Math.min(...annees) : repli}-01-01`,
      fin: `${annees.length ? Math.max(...annees) : repli}-12-31`,
    };
  }
  if (vue === "annee") return { debut: `${annee}-01-01`, fin: `${annee}-12-31` };
  if (semaine) {
    return {
      debut: `${annee}-${pad(mois)}-${pad(semaine.jour_debut)}`,
      fin: `${annee}-${pad(mois)}-${pad(semaine.jour_fin)}`,
    };
  }
  // `new Date(annee, mois, 0)` : le dernier jour du mois demandé.
  const dernierJour = new Date(annee, mois, 0).getDate();
  return { debut: `${annee}-${pad(mois)}-01`, fin: `${annee}-${pad(mois)}-${pad(dernierJour)}` };
}

async function ouvrirFenetreMonnaieEteinte(
  monnaieId,
  { cascade = null, sousTitre = "", operationIds = null, periode = null, origine = null, vuePie = null } = {}
) {
  const monnaie = monnaieParId(monnaieId);
  document.getElementById("modale-monnaie-eteinte-titre").textContent = monnaie
    ? `${monnaie.nom} (${monnaie.symbole})`
    : "";
  document.getElementById("modale-monnaie-eteinte-sous-titre").textContent = sousTitre;
  const selecteur = document.getElementById("modale-monnaie-eteinte-periode");
  const blocCascade = document.getElementById("modale-monnaie-eteinte-cascade-bloc");
  const blocGraphes = document.getElementById("modale-monnaie-eteinte-graphes");
  document.getElementById("modale-monnaie-eteinte").style.display = "";
  document.body.classList.add("modale-ouverte");

  if (cascade) {
    selecteur.style.display = "none";
    blocGraphes.style.display = "none";
    document.getElementById("modale-monnaie-eteinte-vide").style.display = "none";
    document.getElementById("btn-monnaie-eteinte-virements").style.display = "none";
    blocCascade.style.display = "";
    renderCascade(cascade, document.getElementById("modale-monnaie-eteinte-cascade"), {
      // Les frais de cette monnaie : la fenêtre des frais REMPLACE celle-ci.
      ouvrirFrais: () => {
        fermerFenetreMonnaieEteinte();
        ouvrirFenetreFrais({ operationIds, sousTitre, monnaieId });
      },
    });
    renderLegendeCascade(cascade, document.getElementById("modale-monnaie-eteinte-legende"));
    return;
  }

  // LA PÉRIODE DE DÉPART est celle de la page d'où l'on vient (le dashboard par défaut).
  blocCascade.style.display = "none";
  const p = periode || state.dashboardPeriode;
  Object.assign(fenetreMonnaieEteinte, {
    monnaieId,
    niveau: p.vue,
    vue: p.vue,
    annee: p.annee,
    mois: p.mois,
    moisDeplie: p.vue === "mois",
    origine,
    vuePie,
  });
  document.getElementById("btn-monnaie-eteinte-virements").style.display = origine ? "" : "none";
  try {
    fenetreMonnaieEteinte.periodes = await apiFetch(
      `/dashboard/cascade/periodes?monnaie_id=${monnaieId}`
    );
  } catch (err) {
    fenetreMonnaieEteinte.periodes = [];
  }
  selecteur.style.display = "";
  // LE SÉLECTEUR DU DASHBOARD, SANS LES SEMAINES (cf. creerArbrePeriode), et seulement
  // les mois où la monnaie a bougé : une période vide n'a rien à montrer.
  const f = fenetreMonnaieEteinte;
  creerArbrePeriode(selecteur, {
    etat: f,
    annees: () => [...new Set(f.periodes.map((x) => x.annee))].sort((a, b) => b - a),
    moisDisponibles: (annee) =>
      f.periodes.filter((x) => x.annee === annee).map((x) => x.mois).sort((a, b) => a - b),
    surChangement: () => chargerFenetreMonnaieEteinte(),
  });
  await chargerFenetreMonnaieEteinte();
}

async function chargerFenetreMonnaieEteinte() {
  const f = fenetreMonnaieEteinte;
  const monnaieId = f.monnaieId;
  const requete =
    f.vue === "tout"
      ? "vue=tout"
      : f.vue === "annee"
        ? `vue=annee&annee=${f.annee}`
        : `annee=${f.annee}&mois=${f.mois}`;
  const blocGraphes = document.getElementById("modale-monnaie-eteinte-graphes");
  const vide = document.getElementById("modale-monnaie-eteinte-vide");
  try {
    const dashboard = await apiFetch(`/dashboard?${requete}`);
    if (fenetreMonnaieEteinte.monnaieId !== monnaieId) return;
    const kpis = (dashboard.kpis || []).find((k) => k.monnaie_id === monnaieId);
    const bornes = bornesPeriode(f);
    // Chaque barre s'ouvre sur la période DE LA FENÊTRE ; les frais sur leur fenêtre à eux.
    const depenses = (kpis ? kpis.depenses_par_categorie || [] : []).map((d) =>
      d.colonne_speciale === "frais_virements"
        ? {
            ...d,
            frais: {
              ouvrir: () => {
                fermerFenetreMonnaieEteinte();
                ouvrirFenetreFrais({
                  periode: { niveau: f.niveau, vue: f.vue, annee: f.annee, mois: f.mois },
                  monnaieId,
                });
              },
            },
          }
        : { ...d, drill_bornes: bornes }
    );
    const parts = partsCategoriesDashboard(
      depenses,
      new Set(depenses.map((d) => d.categorie)),
      f.vuePie ? { vue: f.vuePie, budgetTotal: kpis ? kpis.budget_total || 0 : 0 } : {}
    );
    const rien = parts.total <= 0;
    vide.style.display = rien ? "" : "none";
    blocGraphes.style.display = rien ? "none" : "";
    if (rien) return;
    renderHistogrammeDepenses(
      parts.retenues,
      monnaieId,
      document.getElementById("modale-monnaie-eteinte-histogramme")
    );
    renderPieChartDepenses(
      depenses,
      monnaieId,
      document.getElementById("modale-monnaie-eteinte-camembert"),
      parts
    );
    renderLegendeCategories(
      monnaieId,
      parts,
      document.getElementById("modale-monnaie-eteinte-legende-categories")
    );
    cablerSurbrillanceCategories();
  } catch (err) {
    showMessage(err.message, "error");
  }
}

// « VOIR LES VIREMENTS » : ceux entre la monnaie d'origine et l'éteinte, dans le sens de la
// colonne d'où l'on vient, sur la période de la fenêtre.
document.getElementById("btn-monnaie-eteinte-virements")?.addEventListener("click", () => {
  const f = fenetreMonnaieEteinte;
  if (!f.origine) return;
  drillThroughConversion(f.origine.monnaieId, f.origine.colonne, bornesPeriode(f));
});

document
  .getElementById("btn-monnaie-eteinte-fermer")
  ?.addEventListener("click", fermerFenetreMonnaieEteinte);
document.getElementById("modale-monnaie-eteinte")?.addEventListener("click", (e) => {
  // Un clic sur le fond (hors de la fenêtre) la referme, comme Échap.
  if (e.target.id === "modale-monnaie-eteinte") fermerFenetreMonnaieEteinte();
});
document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  const fond = document.getElementById("modale-monnaie-eteinte");
  if (fond && fond.style.display !== "none" && !infobulleGelee) fermerFenetreMonnaieEteinte();
});

/* ---------- LA FENÊTRE DES FRAIS DE VIREMENTS INTERNES ----------
 *
 * Ouverte depuis une colonne grise « Frais de virements internes » (histogramme d'un
 * projet ou du dashboard, cascade). Les virements qui ont coûté des frais, GROUPÉS
 * PAR COUPLE DE MONNAIES — euros → francs et francs → euros ensemble, c'est le même
 * change dans les deux sens —, chaque ligne mettant ses FRAIS en avant (dans leur
 * monnaie) et rappelant en retrait les deux montants du virement.
 *
 * LES FILTRES SONT CEUX DE LA PAGE OPÉRATIONS : la période, les monnaies, les comptes.
 * Tout est filtré ici, sur la liste que `/dashboard/frais-virements` rend en une fois.
 * Depuis un projet, la fenêtre ne regarde que les virements du projet
 * (`operationIds`).
 */
const fenetreFrais = {
  tous: [],
  operationIds: null,
  niveau: "tout",
  moisDeplie: false,
  vue: "tout",
  annee: null,
  mois: null,
  monnaies: null,
  comptes: null,
};

function fraisDansPortee() {
  const ids = fenetreFrais.operationIds;
  return fenetreFrais.tous.filter(
    (v) => !ids || ids.has(v.sortante.operation_id) || (v.entrante && ids.has(v.entrante.operation_id))
  );
}

/** Les écritures d'une ligne de frais : les deux jambes d'un virement, ou l'opération
 *  seule d'un compte d'épargne ou de placements. */
function jambesFrais(v) {
  return v.entrante ? [v.sortante, v.entrante] : [v.sortante];
}

function fermerFenetreFrais() {
  document.getElementById("modale-frais-virements").style.display = "none";
  document.body.classList.remove("modale-ouverte");
}

async function ouvrirFenetreFrais({ operationIds = null, sousTitre = "", periode = null, monnaieId = null } = {}) {
  try {
    fenetreFrais.tous = await apiFetch("/dashboard/frais-virements");
    if (!state.comptes || state.comptes.length === 0) await refreshComptes();
  } catch (err) {
    showMessage(err.message, "error");
    return;
  }
  Object.assign(fenetreFrais, {
    operationIds: operationIds ? new Set(operationIds) : null,
    niveau: periode ? periode.vue : "tout",
    vue: periode ? periode.vue : "tout",
    annee: periode ? periode.annee : null,
    mois: periode ? periode.mois : null,
    moisDeplie: !!periode && periode.vue === "mois",
    monnaies: monnaieId != null ? new Set([monnaieId]) : null,
    comptes: null,
  });
  document.getElementById("modale-frais-sous-titre").textContent = sousTitre;
  document.getElementById("modale-frais-virements").style.display = "";
  document.body.classList.add("modale-ouverte");

  // Les menus ne proposent que ce que les virements de la portée touchent.
  const portee = fraisDansPortee();
  const monnaies = [...new Set(portee.flatMap((v) => jambesFrais(v).map((j) => j.monnaie_id)))];
  const comptes = [...new Set(portee.flatMap((v) => jambesFrais(v).map((j) => j.compte_id)))];
  const poserMenu = (conteneurId, cle, libelle, options) => {
    creerMenuCases(document.getElementById(conteneurId), {
      libelle,
      options,
      coches: fenetreFrais[cle] ? [...fenetreFrais[cle]] : options.map((o) => o.cle),
      toutSelectionner: true,
      onChange: (choisies) => {
        fenetreFrais[cle] = choisies.size === options.length ? null : choisies;
        renderFenetreFrais();
      },
    });
  };
  poserMenu(
    "modale-frais-monnaies",
    "monnaies",
    t("Monnaies"),
    (state.monnaies || [])
      .filter((m) => monnaies.includes(m.id))
      .map((m) => ({ cle: m.id, libelle: `${m.nom} (${m.symbole})` }))
  );
  poserMenu(
    "modale-frais-comptes",
    "comptes",
    t("Comptes"),
    state.comptes.filter((c) => comptes.includes(c.id)).map((c) => ({ cle: c.id, libelle: c.nom }))
  );
  majPeriodeFenetreFrais();
  renderFenetreFrais();
}

/* LA PÉRIODE : le sélecteur du dashboard sans les semaines (cf. creerArbrePeriode), et
 * seulement les mois où un virement de la portée a coûté des frais. */
function majPeriodeFenetreFrais() {
  const f = fenetreFrais;
  const dates = () => fraisDansPortee().map((v) => v.date);
  creerArbrePeriode(document.getElementById("modale-frais-periode"), {
    etat: f,
    annees: () => [...new Set(dates().map((d) => Number(d.slice(0, 4))))].sort((a, b) => b - a),
    moisDisponibles: (annee) =>
      [
        ...new Set(
          dates().filter((d) => Number(d.slice(0, 4)) === annee).map((d) => Number(d.slice(5, 7)))
        ),
      ].sort((a, b) => a - b),
    surChangement: () => renderFenetreFrais(),
  });
}

function renderFenetreFrais() {
  const f = fenetreFrais;
  const pad = (n) => String(n).padStart(2, "0");
  const prefixe =
    f.vue === "tout" ? "" : f.vue === "annee" ? `${f.annee}-` : `${f.annee}-${pad(f.mois)}-`;
  const lignes = fraisDansPortee().filter(
    (v) =>
      v.date.startsWith(prefixe) &&
      (!f.monnaies || jambesFrais(v).some((j) => f.monnaies.has(j.monnaie_id))) &&
      (!f.comptes || jambesFrais(v).some((j) => f.comptes.has(j.compte_id)))
  );
  const conteneur = document.getElementById("modale-frais-liste");
  if (lignes.length === 0) {
    conteneur.innerHTML = `<p class="hint">${escapeHtml(t("Aucun frais de virement sur la période."))}</p>`;
    return;
  }

  // UN GROUPE PAR COUPLE DE MONNAIES, dans les deux sens : la clé est le couple trié.
  const groupes = new Map();
  lignes.forEach((v) => {
    const couple = [v.sortante.monnaie_id, (v.entrante || v.sortante).monnaie_id].sort((a, b) => a - b);
    const cle = couple.join("-");
    if (!groupes.has(cle)) groupes.set(cle, { couple, virements: [] });
    groupes.get(cle).virements.push(v);
  });
  const nom = (id) => monnaieParId(id)?.nom || "?";
  conteneur.innerHTML = [...groupes.values()]
    .map(({ couple, virements }) => {
      const titre = couple[0] === couple[1] ? nom(couple[0]) : `${nom(couple[0])} ↔ ${nom(couple[1])}`;
      // Le total des frais du groupe, PAR MONNAIE : deux devises ne s'additionnent pas.
      const totaux = new Map();
      virements.forEach((v) => totaux.set(v.monnaie_frais_id, (totaux.get(v.monnaie_frais_id) || 0) + v.frais));
      const total = [...totaux.entries()].map(([m, montant]) => formatMontant(montant, m)).join(" · ");
      const rangees = virements
        .map(
          (v) => `
          <tr>
            <td>${formatDate(v.date)}</td>
            <td class="frais-montant">${formatMontant(v.frais, v.monnaie_frais_id)}</td>
            <td class="frais-virement">${
              v.entrante
                ? `${formatMontant(v.sortante.montant, v.sortante.monnaie_id)} → ${formatMontant(
                    v.entrante.montant,
                    v.entrante.monnaie_id
                  )}
              <span class="frais-comptes">${escapeHtml(nomCompte(v.sortante.compte_id))} → ${escapeHtml(
                nomCompte(v.entrante.compte_id)
              )}</span>`
                : `${formatMontant(v.sortante.montant, v.sortante.monnaie_id)}
              <span class="frais-comptes">${escapeHtml(nomCompte(v.sortante.compte_id))}</span>`
            }</td>
            <td class="frais-nature">${escapeHtml(v.nature)}</td>
          </tr>`
        )
        .join("");
      return `
        <div class="frais-groupe">
          <div class="frais-groupe-entete">
            <span class="frais-groupe-titre">${escapeHtml(titre)}</span>
            <span class="frais-groupe-total">${escapeHtml(t("Frais : {montant}", { montant: total }))}</span>
          </div>
          <table class="frais-table">
            <thead><tr><th>${escapeHtml(t("Date"))}</th><th>${escapeHtml(t("Frais"))}</th><th>${escapeHtml(
              t("Opération")
            )}</th><th>${escapeHtml(t("Nature"))}</th></tr></thead>
            <tbody>${rangees}</tbody>
          </table>
        </div>`;
    })
    .join("");
}

document.getElementById("btn-frais-fermer")?.addEventListener("click", fermerFenetreFrais);
document.getElementById("modale-frais-virements")?.addEventListener("click", (e) => {
  if (e.target.id === "modale-frais-virements") fermerFenetreFrais();
});
document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  const fond = document.getElementById("modale-frais-virements");
  if (fond && fond.style.display !== "none" && !infobulleGelee) fermerFenetreFrais();
});

/**
 * Année/mois RÉELLEMENT affichés par le dashboard, posés au moment même du
 * chargement plutôt que dérivés de `dashboardSemainesDonnees` (pas encore
 * chargé au tout premier rendu) : le drill-through d'une barre a besoin de la
 * période EXACTE, jamais d'un état encore en cours de chargement.
 */
let dashboardAnneeMoisActuel = { annee: null, mois: null };

/**
 * Les bornes de dates de la période AFFICHÉE par l'histogramme/le camembert —
 * ce que le titre « Dépenses par catégorie — … » annonce (cf.
 * libellePeriodeHistogramme), traduit en dates pour le drill-through vers
 * Opérations.
 *
 */
function bornesPeriodeHistogramme(annee, mois) {
  return bornesPeriode({ vue: state.dashboardPeriode.vue, annee, mois, semaine: semaineChoisie() });
}

/**
 * Clic sur une barre/tranche : atterrit sur Opérations, onglet classique,
 * filtré sur cette catégorie et la période affichée.
 *
 * L'ONGLET CLASSIQUE PAR DÉFAUT, une limite acceptée : une barre agrège
 * CLASSIQUE et REMBOURSABLE (les deux seuls types à catégorie libre, cf.
 * constants.TYPES_AVEC_CATEGORIE_LIBRE), et aucun écran de cette page ne
 * montre les deux types à la fois — classique couvre le cas principal.
 *
 * SANS EFFET si la « catégorie » n'existe pas vraiment (la barre « Intérêts
 * de prêts », posée par _barre_interets_prets, n'a pas de ligne dans la table
 * `categorie`) : il n'y a alors rien vers quoi filtrer.
 */
async function drillThroughCategorie(depense) {
  // LES BORNES VIENNENT DE LA PAGE QUI A DESSINÉ LA BARRE (`drill_bornes`) : la période de
  // la page Budget, celle d'une fenêtre, ou — dans un projet — de la première à la dernière
  // opération de la catégorie. Sans elles, la période du dashboard.
  let bornes = depense.drill_bornes || null;
  if (!bornes) {
    const { annee, mois } = dashboardAnneeMoisActuel;
    if (!annee) return;
    bornes = bornesPeriodeHistogramme(annee, mois);
  }
  fermerFenetreMonnaieEteinte();
  // Peut être vide si l'utilisateur n'a encore ouvert ni Opérations ni
  // Catégories cette session : le dashboard, lui, ne charge pas `state.categories`.
  if (state.categories.length === 0) await refreshCategories();
  const categorie = state.categories.find((c) => c.nom === depense.categorie);
  if (!categorie) return;
  const { debut, fin } = bornes;

  // LA BARRE DU HAUT SUIT LA PAGE, et c'est la seule règle qui vaille ici.
  // Ce bouton-ci part vers un écran qui A son propre onglet : forcer
  // `ongletActif: "dashboard"` laissait « Dashboard » allumé au-dessus de la
  // page Opérations, et l'application semblait bloquée sur le dashboard —
  // recliquer « Dashboard » ne faisait alors rien de visible. L'argument n'a de
  // sens que pour un écran SANS bouton (« D'où vient l'écart ? », les écrans
  // d'extension ouverts depuis ailleurs), où aucun onglet ne resterait allumé.
  switchSection("operations");
  await loadOperations();
  document.querySelector('#operations-sous-nav button[data-sous-section="classique"]')?.click();

  const panneau = document.getElementById("filtres-classique");
  panneau.querySelector('[data-filtre="categorieId"]').value = categorie.id;
  panneau.querySelector('[data-filtre="dateDebut"]').value = debut;
  panneau.querySelector('[data-filtre="dateFin"]').value = fin;
  // LE CONTEXTE DU DRILL-THROUGH, posé APRÈS les filtres qu'il décrit : tant que
  // les trois champs valent ce qu'on vient d'y mettre, l'écran sait d'où il
  // vient (cf. drillActif).
  state.drillOperations = { onglet: "classique", categorieId: String(categorie.id), debut, fin };
  // PAR MONTANT DÉCROISSANT : c'est la suite du top 3 de l'infobulle d'où l'on
  // vient. C'est le MÊME geste que de choisir ce tri dans le menu — l'état ET le
  // menu bougent, puis le rendu repart (la date quitte alors les séparateurs et
  // descend dans la ligne, cf. colonnesOperations).
  state.triSelections.classique = "montant-desc";
  const menuTri = document.querySelector('select.tri-select[data-onglet="classique"]');
  if (menuTri) menuTri.value = "montant-desc";
  // TROIS FILTRES POSÉS SANS QU'ON LES AIT TAPÉS : la section s'ouvre, sinon on
  // arrive sur un tableau restreint dont rien à l'écran ne dit qu'il l'est.
  ouvrirFiltresOnglet("classique");
  // LA PÉRIODE SUIT LES DATES QU'ON VIENT DE POSER, et c'est ce qui répare le
  // défaut de ce bouton : la page Opérations s'ouvrait sur SA période à elle —
  // le mois courant — pendant que le filtre bornait le mois de la barre
  // cliquée. Deux bornes qui ne se recoupent pas ne gardent rien : arriver sur
  // un tableau vide en cliquant « Voir toutes les dépenses » était la règle dès
  // qu'on regardait autre chose que le mois en cours.
  //
  // Les champs sont remplis à la main (pas d'événement `input` sur une
  // affectation de `value`) : l'appel est donc explicite ici, et il réaffiche
  // les six onglets lui-même quand il bascule.
  if (!synchroniserPeriodeAvecFiltres("classique")) trierEtRerender("classique");
}

/* ---------- Le filtre de catégories du dashboard (histogramme + camembert) ----------
 *
 * UN SEUL CONTRÔLE POUR LES DEUX GRAPHES (cf. renderHistogrammeDashboard) : un
 * filtre par graphe aurait posé la question à laquelle personne ne pense —
 * « pourquoi l'histogramme et le camembert ne montrent-ils pas les mêmes
 * catégories ? ».
 */

// `null` = toutes (l'état par défaut). Un Set de NOMS de catégorie — ce que
// porte chaque ligne de DepenseParCategorie, pas un id.
function categoriesVisiblesDashboard(depenses) {
  if (!state.dashboardCategoriesVisibles) return new Set(depenses.map((d) => d.categorie));
  return state.dashboardCategoriesVisibles;
}

function majCaseToutDashboard(depenses) {
  const caseTout = document.getElementById("dashboard-filtre-categories-tout");
  const visibles = categoriesVisiblesDashboard(depenses);
  caseTout.checked = depenses.length > 0 && visibles.size === depenses.length;
  caseTout.indeterminate = visibles.size > 0 && visibles.size < depenses.length;
  // LE SÉLECTEUR SE COLORE QUAND IL FILTRE : un menu replié dont des catégories
  // sont décochées est l'explication la plus probable d'un graphe « incomplet »,
  // et rien ne le disait. Le bleu est celui de l'accent — c'est lui, sur ce
  // bouton, qui prévient que l'écran ne montre pas tout.
  document
    .getElementById("btn-dashboard-filtre-categories")
    .classList.toggle("filtre-actif", depenses.length > 0 && visibles.size < depenses.length);
}

// Reconstruit la liste de cases à cocher d'après les catégories de la période
// AFFICHÉE (elles changent avec le mois choisi). Reconstruire à chaque rendu
// plutôt que de ne mettre à jour QUE ce qui change est plus simple et sans
// conséquence : la liste tient sur quinze lignes au plus.
function majPanneauFiltreCategoriesDashboard(depenses) {
  const liste = document.getElementById("dashboard-filtre-categories-liste");
  const visibles = categoriesVisiblesDashboard(depenses);
  liste.innerHTML = "";
  depenses.forEach((d, i) => {
    const label = document.createElement("label");
    const case_ = document.createElement("input");
    case_.type = "checkbox";
    case_.checked = visibles.has(d.categorie);
    const couleur = document.createElement("span");
    couleur.className = "filtre-categories-couleur";
    couleur.style.background = couleurBarre(d, i);
    label.appendChild(case_);
    label.appendChild(couleur);
    label.appendChild(document.createTextNode(libelleCategorie(d.categorie)));
    liste.appendChild(label);

    case_.addEventListener("change", () => {
      const actuel = new Set(categoriesVisiblesDashboard(depenses));
      if (case_.checked) actuel.add(d.categorie);
      else actuel.delete(d.categorie);
      // Toutes cochées : on revient à `null`, la forme canonique de "toutes"
      // (sinon une catégorie ajoutée PLUS TARD par l'utilisateur — nouvelle
      // catégorie créée entre deux mois — apparaîtrait décochée par défaut).
      state.dashboardCategoriesVisibles = actuel.size === depenses.length ? null : actuel;
      majCaseToutDashboard(depenses);
      renderHistogrammeDashboard(dashboardDepensesDuMois, state.dashboardMonnaieId);
    });
  });
  majCaseToutDashboard(depenses);
}

(function initFiltreCategoriesDashboard() {
  const bouton = document.getElementById("btn-dashboard-filtre-categories");
  const panneau = document.getElementById("dashboard-filtre-categories-panneau");
  const caseTout = document.getElementById("dashboard-filtre-categories-tout");

  bouton.addEventListener("click", () => {
    const ouvrir = panneau.hidden;
    panneau.hidden = !ouvrir;
    bouton.setAttribute("aria-expanded", String(ouvrir));
  });
  // Clic hors du contrôle : referme, comme tout menu déroulant de l'app.
  document.addEventListener("click", (e) => {
    if (panneau.hidden) return;
    if (e.target.closest(".dashboard-filtre-categories")) return;
    panneau.hidden = true;
    bouton.setAttribute("aria-expanded", "false");
  });

  caseTout.addEventListener("change", () => {
    state.dashboardCategoriesVisibles = caseTout.checked
      ? null
      : new Set();
    majPanneauFiltreCategoriesDashboard(dashboardDepensesActuels);
    renderHistogrammeDashboard(dashboardDepensesDuMois, state.dashboardMonnaieId);
  });
})();

// Les dernières `depenses` rendues (mois entier ou semaine selon ce
// qui est choisi) : la case "Tout sélectionner" en a besoin hors de tout
// rendu de panneau (cf. initFiltreCategoriesDashboard ci-dessus).
let dashboardDepensesActuels = [];

/* ---------- Le détail par semaine de l'histogramme ---------- */

/**
 * LES SEMAINES DU MOIS, sous la rangée des mois, et le MÊME histogramme.
 *
 * CE QUE ÇA AJOUTE. Une barre mensuelle dit ce qu'une catégorie a coûté, jamais
 * QUAND : trois cents euros de courses peuvent être quatre semaines régulières
 * ou un seul samedi, et rien à l'écran ne permettait de les distinguer.
 *
 * UN CRAN DE PLUS DU SÉLECTEUR DE PÉRIODE, et pas un second graphe. Année,
 * mois, semaine : c'est la même arborescence qui descend, et l'histogramme
 * dessous montre le niveau choisi. Deux graphes l'un sous l'autre auraient
 * demandé de comparer deux échelles pour lire une seule chose.
 *
 * REPLIÉ D'ORIGINE : on regarde un mois neuf fois sur dix. Le chevron du mois
 * déplie la rangée ; on en sort en remontant la pastille ou en repliant.
 *
 * L'INTERRUPTEUR « MOYENNE PAR SEMAINE » répond à ce qu'une semaine seule laisse
 * ouvert : celle-ci est-elle une semaine ordinaire ? SA FENÊTRE EST LE NIVEAU OÙ
 * L'ON SE TROUVE — le mois, l'année ou tout l'historique —, comme la moyennée
 * d'une carte d'objectifs : un seul réglage, donc un seul endroit où se tromper
 * de période. Ce sont les semaines du calendrier, bouts de mois compris.
 */

// La réponse de /dashboard/semaines pour le mois et la monnaie affichés, avec la
// clé qui les décrit : un geste qui change de semaine sans changer de mois ne
// coûte pas un aller-retour, et un changement de mois ou de monnaie rend la
// lecture périmée (cf. cleSemainesDashboard).
let dashboardSemainesDonnees = null;

function cleSemainesDashboard() {
  const p = state.dashboardPeriode;
  return `${p.annee}-${p.mois}-${state.dashboardMonnaieId}`;
}

/**
 * Ce que l'histogramme regarde en plus du mois entier : la semaine choisie
 * (l'objet de /dashboard/semaines), ou null — et null veut dire « la période
 * entière », l'état où l'histogramme est celui que le dashboard a toujours montré.
 */
function semaineChoisie() {
  const p = state.dashboardPeriode;
  if (p.niveau !== "semaine") return null;
  if (dashboardSemainesDonnees?.cle !== cleSemainesDashboard()) return null;
  return (dashboardSemainesDonnees.semaines || []).find((s) => s.numero === p.semaine) || null;
}

/**
 * CE QUE LES TROIS RENDUS PARTAGENT : les dépenses de la période choisie (mois,
 * semaine ou moyenne), le budget qui va avec, et le calcul unique des parts.
 *
 * EXTRAIT DE `renderHistogrammeDashboard` parce que la bascule de vue du
 * camembert a besoin des mêmes grandeurs SANS redessiner l'histogramme (cf.
 * renderVuePieDashboard) : recopier l'enchaînement aurait laissé les deux
 * chemins diverger au premier ajustement.
 */
function contexteGraphesDashboard(depensesDuMois) {
  const semaine = semaineChoisie();
  // LES CONVERSIONS VERS UNE MONNAIE ÉTEINTE (« en pop-up », cf.
  // chargerConversionsDashboard) rejoignent les barres de la période ENTIÈRE
  // seulement : elles ne se découpent pas en semaines. Ni quand tout
  // est converti dans une seule monnaie (extension « Monnaies ») : la monnaie
  // éteinte y est déjà fondue, la compter encore en conversion la doublerait.
  const toutConverti = typeof agregationActive !== "undefined" && agregationActive;
  const conversions = toutConverti ? [] : dashboardConversions;
  const brutes =
    semaine === null
      ? [...depensesDuMois, ...conversions]
      : semaine.depenses || [];
  // LA BARRE DES FRAIS DE VIREMENTS (rendue par le serveur, cf.
  // soldes._barre_frais_virements) ouvre leur détail SUR LA PÉRIODE AFFICHÉE.
  const p = state.dashboardPeriode;
  const depenses = brutes.map((d) =>
    d.colonne_speciale === "frais_virements"
      ? {
          ...d,
          frais: {
            ouvrir: () =>
              ouvrirFenetreFrais({
                periode: { vue: p.vue, annee: p.annee, mois: p.mois },
                monnaieId: state.dashboardMonnaieId,
              }),
          },
        }
      : d
  );

  // LE BUDGET SUIT LA MÊME PÉRIODE QUE LES BARRES, découpe des semaines
  // comprise (cf. soldes.get_budget_total_periode) : une semaine de dépenses
  // rapportée au budget du mois entier aurait annoncé qu'on tient largement
  // son budget toutes les semaines, jusqu'à la dernière.
  const budgetTotal =
    semaine === null
      ? dashboardBudgetTotalDuMois
      : semaine.budget_total || 0;

  dashboardDepensesActuels = depenses;
  majPanneauFiltreCategoriesDashboard(depenses);
  const visibles = categoriesVisiblesDashboard(depenses);

  // UN SEUL CALCUL POUR LES TROIS RENDUS (cf. partsCategoriesDashboard).
  // L'histogramme recalcule son échelle sur ses seules barres, la légende ne
  // nomme que ce qui reste, et le camembert rapporte ses parts à ce que sa vue
  // a choisi — le total dépensé, ou le budget du mois.
  // La vue « budget » ne survit pas à l'extinction de l'extension qui l'apporte
  // (cf. basculerVuePie) : son bouton a disparu, la vue doit suivre.
  if (state.dashboardVuePie === VUE_PIE_BUDGET && !vueBudgetDisponible()) {
    state.dashboardVuePie = "actuel";
    document.querySelectorAll("#camembert-vues button[data-vue-pie]").forEach((bouton) => {
      bouton.classList.toggle("active", bouton.dataset.vuePie === "actuel");
    });
  }
  const parts = partsCategoriesDashboard(depenses, visibles, {
    vue: state.dashboardVuePie,
    budgetTotal,
  });
  return { depenses, parts };
}

/**
 * L'histogramme du dashboard — mois, semaine ou moyenne selon ce qui est
 * choisi.
 *
 * TOUT PASSE PAR ICI, y compris les rendus déclenchés par une extension (la
 * vue convertie de « Monnaies » rappelle `renderKpisDashboard`) : c'est ce qui
 * empêche un rendu venu d'ailleurs de ramener le mois sous une rangée de
 * semaines où l'une est cochée.
 */
function renderHistogrammeDashboard(depensesDuMois, monnaieId) {
  const { depenses, parts } = contexteGraphesDashboard(depensesDuMois);

  renderHistogrammeDepenses(
    parts.retenues,
    monnaieId,
    document.getElementById("dashboard-histogramme")
  );
  renderPieChartDepenses(
    depenses,
    monnaieId,
    document.getElementById("dashboard-camembert"),
    parts
  );
  renderLegendeCategories(monnaieId, parts, document.getElementById("dashboard-legende"));
  // EN DERNIER, quand les trois existent : c'est lui qui apparie une barre, sa
  // tranche et sa ligne de légende par le nom de la catégorie.
  cablerSurbrillanceCategories();
}

/**
 * CHANGER DE VUE NE REDESSINE QUE LE CAMEMBERT ET SA LÉGENDE.
 *
 * Les deux vues ne diffèrent que par leur DÉNOMINATEUR (cf.
 * renderPieChartDepenses) : les barres, elles, portent des montants et ne
 * dépendent d'aucune des deux — `parts.retenues` est le même des deux côtés.
 * Passer par `renderHistogrammeDashboard` les redessinait pourtant toutes, et
 * rejouait donc leur animation de croissance à chaque aller-retour entre
 * « État actuel » et « Budget » : le graphe qu'on ne regardait pas s'agitait
 * pendant qu'on lisait l'autre, et l'animation cessait de dire ce pour quoi
 * elle existe — qu'un graphe vient d'être RECALCULÉ.
 *
 * LA LÉGENDE, ELLE, SUIT : elle porte la PART de chaque catégorie, qui se
 * rapporte justement au dénominateur qu'on vient de changer.
 */
function renderVuePieDashboard(depensesDuMois, monnaieId) {
  const { depenses, parts } = contexteGraphesDashboard(depensesDuMois);

  renderPieChartDepenses(
    depenses,
    monnaieId,
    document.getElementById("dashboard-camembert"),
    parts
  );
  renderLegendeCategories(monnaieId, parts, document.getElementById("dashboard-legende"));
  cablerSurbrillanceCategories();
}

/* ---------- Les deux vues du camembert ----------
 *
 * LA VUE NE SE MÉMORISE PAS d'une session à l'autre, et c'est délibéré :
 * « budget » n'a de sens que le temps qu'on se pose la question, et rouvrir
 * l'application sur un anneau ouvert aux trois quarts serait une mauvaise
 * nouvelle affichée sans qu'on l'ait demandée. Le dashboard s'ouvre sur l'état
 * actuel, comme avant.
 *
 * LA VUE « BUDGET » APPARTIENT À L'EXTENSION DU MÊME NOM, et son RÉGLAGE a
 * déménagé avec elle. Le champ « Budget du mois » vivait ici, dans cette vue et
 * elle seule — un champ à remplir posé entre deux graphes, sur l'écran où l'on
 * vient LIRE ce qui s'est passé. Il est désormais en tête de la page Budget,
 * auprès des deux autres grandeurs auxquelles il se compare (l'enveloppe d'une
 * catégorie, son objectif de répartition), et le camembert ne fait plus que
 * rapporter ses parts à ce qui y a été posé.
 */
function vueBudgetDisponible() {
  return BudgetApp.extensions.estActive("analyse-budget");
}

function basculerVuePie(vue) {
  // ÉTEINDRE L'EXTENSION NE RECHARGE PAS LE DASHBOARD : son bouton disparaît
  // (cf. majVisibiliteNavigation), mais la vue choisie, elle, resterait
  // « budget » — un anneau ouvert sur un dénominateur qu'on ne peut plus poser
  // nulle part. La garde est ici et dans renderHistogrammeDashboard, les deux
  // seuls chemins par lesquels la vue est lue.
  state.dashboardVuePie = vue === VUE_PIE_BUDGET && !vueBudgetDisponible() ? "actuel" : vue;
  document.querySelectorAll("#camembert-vues button[data-vue-pie]").forEach((bouton) => {
    bouton.classList.toggle("active", bouton.dataset.vuePie === state.dashboardVuePie);
  });
  renderVuePieDashboard(dashboardDepensesDuMois, state.dashboardMonnaieId);
}

(function initVuesPie() {
  document.getElementById("camembert-vues")?.addEventListener("click", (e) => {
    const bouton = e.target.closest("button[data-vue-pie]");
    if (bouton) basculerVuePie(bouton.dataset.vuePie);
  });
})();

/* ---------- L'accord des trois grandeurs du budget ----------
 *
 * TROIS CHIFFRES QUI SE RÉPONDENT (cf. crud.incoherences_budgets) : le budget
 * total du mois, le budget d'une catégorie, et son objectif en pourcentage. Le
 * deuxième devrait valoir le premier multiplié par le troisième.
 *
 * CONSTATER, JAMAIS CORRIGER D'OFFICE. Recalculer la troisième grandeur aurait
 * défait en silence la saisie précédente — poser un budget aurait réécrit un
 * pourcentage, et l'inverse aussi. La fenêtre montre donc le désaccord et
 * propose les TROIS façons d'en sortir, chiffrées : la réponse n'appartient
 * qu'à celui qui a écrit les chiffres.
 *
 * OUVERTE APRÈS UNE SAISIE, jamais au chargement d'un écran. Un signalement
 * permanent affiché à l'ouverture du dashboard aurait cessé d'être lu au bout
 * de deux jours.
 */
let accordBudgetsContexte = null;

async function verifierAccordBudgets(annee, mois, monnaieId) {
  if (!mois || !monnaieId) return;
  let rapport;
  try {
    rapport = await apiFetch(
      `/dashboard/coherence-budgets?monnaie_id=${monnaieId}&annee=${annee}&mois=${mois}`
    );
  } catch (err) {
    // UN CONTRÔLE QUI TOMBE EN PANNE NE DOIT PAS AVALER LA SAISIE : elle est
    // déjà enregistrée, et c'est elle qui compte.
    return;
  }
  if (!rapport.lignes.length) return;
  accordBudgetsContexte = { annee, mois, monnaieId, rapport };
  ouvrirModaleAccordBudgets();
}

function ouvrirModaleAccordBudgets() {
  const { rapport, monnaieId } = accordBudgetsContexte;
  const lignes = rapport.lignes;
  // LE BUDGET TOTAL N'EST PROPOSÉ QUE S'IL RÉCONCILIE TOUT, c'est-à-dire quand
  // une seule catégorie est en désaccord. Avec deux, le changer ne peut
  // satisfaire que l'une d'elles — proposer un chiffre qui laisserait la
  // fenêtre se rouvrir aussitôt serait pire que ne rien proposer.
  const totalProposable = lignes.length === 1;

  document.getElementById("coherence-lignes").innerHTML = lignes
    .map(
      (ligne, index) => `
      <div class="coherence-ligne">
        <div class="coherence-titre">${escapeHtml(libelleCategorie(ligne.categorie))}</div>
        <ul class="histo-bulle-chiffres">
          <li><span class="histo-bulle-nature">${t(
            "Budget du mois"
          )}</span><span class="histo-bulle-montant">${formatMontant(
            rapport.budget_total,
            monnaieId
          )}</span></li>
          <li><span class="histo-bulle-nature">${t(
            "Objectif"
          )}</span><span class="histo-bulle-montant">${formatPourcentage(
            ligne.objectif_pourcentage
          )}</span></li>
          <li><span class="histo-bulle-nature">${t(
            "Budget de la catégorie"
          )}</span><span class="histo-bulle-montant">${formatMontant(
            ligne.budget_categorie,
            monnaieId
          )} <span class="coherence-attendu">${t("au lieu de")} ${formatMontant(
            ligne.budget_attendu,
            monnaieId
          )}</span></span></li>
        </ul>
        <div class="coherence-actions">
          <button type="button" data-accord="budget" data-ligne="${index}">${t(
            "Mettre le budget à"
          )} ${formatMontant(ligne.budget_attendu, monnaieId)}</button>
          <button type="button" data-accord="pourcentage" data-ligne="${index}">${t(
            "Mettre l'objectif à"
          )} ${formatPourcentage(ligne.pourcentage_attendu)}</button>
          ${
            totalProposable
              ? `<button type="button" data-accord="total" data-ligne="${index}">${t(
                  "Mettre le budget du mois à"
                )} ${formatMontant(ligne.total_attendu, monnaieId)}</button>`
              : ""
          }
        </div>
      </div>`
    )
    .join("");

  document.getElementById("modale-coherence-budgets").style.display = "";
  document.body.classList.add("modale-ouverte");
}

function fermerModaleAccordBudgets() {
  document.getElementById("modale-coherence-budgets").style.display = "none";
  document.body.classList.remove("modale-ouverte");
  accordBudgetsContexte = null;
}

async function appliquerAccordBudget(quoi, index) {
  const { annee, mois, monnaieId, rapport } = accordBudgetsContexte;
  const ligne = rapport.lignes[index];
  try {
    if (quoi === "budget") {
      await apiFetch(
        `/categories/${ligne.categorie_id}/budget?annee=${annee}&mois=${mois}&monnaie_id=${monnaieId}`,
        { method: "PUT", body: JSON.stringify({ montant: ligne.budget_attendu }) }
      );
    } else if (quoi === "pourcentage") {
      await apiFetch(`/categories/${ligne.categorie_id}/objectif`, {
        method: "PUT",
        body: JSON.stringify({
          // ARRONDI À LA DÉCIMALE, comme le champ de saisie : proposer
          // 24,999999 % rouvrirait la fenêtre au tour suivant pour un écart
          // que personne ne peut ni voir ni corriger.
          objectif_pourcentage: Math.round(ligne.pourcentage_attendu * 10) / 10,
        }),
      });
    } else {
      await apiFetch(
        `/dashboard/budget-total?monnaie_id=${monnaieId}&annee=${annee}&mois=${mois}`,
        { method: "PUT", body: JSON.stringify({ montant: ligne.total_attendu }) }
      );
    }
  } catch (err) {
    showMessage(traduireMessageServeur(err.message), "error");
    return;
  }
  fermerModaleAccordBudgets();
  await loadDashboard();
  // ON REVÉRIFIE : corriger une ligne peut en laisser d'autres, et l'arrondi de
  // l'objectif peut lui-même créer un écart — que la tolérance absorbe, mais
  // c'est le contrôle qui doit le dire, pas nous.
  await verifierAccordBudgets(annee, mois, monnaieId);
}

(function initModaleAccordBudgets() {
  const modale = document.getElementById("modale-coherence-budgets");
  if (!modale) return;
  document
    .getElementById("btn-coherence-fermer")
    ?.addEventListener("click", fermerModaleAccordBudgets);
  document
    .getElementById("btn-coherence-laisser")
    ?.addEventListener("click", fermerModaleAccordBudgets);
  modale.addEventListener("click", (e) => {
    if (e.target === modale) {
      fermerModaleAccordBudgets();
      return;
    }
    const bouton = e.target.closest("button[data-accord]");
    if (bouton) appliquerAccordBudget(bouton.dataset.accord, Number(bouton.dataset.ligne));
  });
})();

/**
 * Ce que le titre « Dépenses par catégorie — … » annonce.
 *
 * LE TITRE PORTE LA PÉRIODE, plutôt qu'une phrase d'explication sous les
 * onglets : il est déjà là, il est déjà lu, et c'est exactement ce qu'il dit.
 */
function libellePeriodeHistogramme(annee, mois) {
  const vue = state.dashboardPeriode.vue;
  const semaine = semaineChoisie();
  const nomMois = libelleMois(annee, mois).toLowerCase();
  if (vue === "tout") return t("tout l'historique");
  if (vue === "annee") return t("année {annee}", { annee });
  if (semaine === null) return nomMois;
  return t("du {debut} au {fin} {mois}", {
    debut: semaine.jour_debut,
    fin: semaine.jour_fin,
    mois: nomMois,
  });
}

function majTitrePeriodeHistogramme(annee, mois) {
  document.getElementById("dashboard-periode-libelle").textContent =
    libellePeriodeHistogramme(annee, mois);
}

/**
 * Lit (si besoin) ce que le niveau demande au serveur EN PLUS du dashboard — les
 * semaines du mois quand on en regarde une — puis redessine l'arbre, le titre et l'histogramme.
 *
 * APPELÉE À CHAQUE CHARGEMENT ET À CHAQUE GESTE QUI NE CHANGE PAS DE DONNÉES :
 * passer d'une semaine à l'autre ne relit pas le dashboard. Les lectures déjà faites pour la même clé sont gardées.
 */
async function majDetailSemaines(annee, mois) {
  const p = state.dashboardPeriode;
  const monnaieId = state.dashboardMonnaieId;
  renderArbrePeriode();

  // Aucune monnaie en jeu (base sans compte) : rien à détailler.
  if (monnaieId == null) {
    dashboardSemainesDonnees = null;
    majTitrePeriodeHistogramme(annee, mois);
    return;
  }

  try {
    if (p.niveau === "semaine" && dashboardSemainesDonnees?.cle !== cleSemainesDashboard()) {
      const cle = cleSemainesDashboard();
      const donnees = await apiFetch(
        `/dashboard/semaines?annee=${annee}&mois=${mois}&monnaie_id=${monnaieId}`
      );
      dashboardSemainesDonnees = { ...donnees, cle };
    }
  } catch (err) {
    showMessage(err.message, "error");
    // Ce qu'on n'a pas pu lire ne doit pas rester allumé : on rend la période
    // entière plutôt qu'un graphe vide sous un titre qui promet une semaine.
    if (p.niveau === "semaine") p.niveau = "mois";
    p.vue = vueDuNiveau(p.niveau);
    renderArbrePeriode();
  }
  majTitrePeriodeHistogramme(annee, mois);
  renderHistogrammeDashboard(dashboardDepensesDuMois, monnaieId);
}

/* ---------- Bloc-notes du dashboard ---------- */

/**
 * Un pense-bête libre, enregistré tout seul.
 *
 * PAS DE BOUTON. Sur un champ où l'on note trois mots avant de fermer la
 * fenêtre, « Enregistrer » n'est qu'une occasion de plus de perdre ce qu'on
 * vient d'écrire. L'écriture part une seconde après la dernière frappe, et de
 * nouveau à la sortie du champ ou de la page — un onglet fermé au milieu d'une
 * phrase ne doit rien coûter.
 *
 * HAUTEUR AUTOMATIQUE. « Il affiche toujours l'intégralité des notes saisies » :
 * la zone grandit avec son contenu plutôt que de le faire défiler. Une note
 * qu'il faut faire défiler pour relire ne remplit pas son office.
 */
let noteDashboardTimer = null;
let noteDashboardEnregistree = "";

function ajusterHauteurNoteDashboard() {
  const zone = document.getElementById("dashboard-note");
  if (!zone) return;
  // Remise à zéro d'abord : sans elle, scrollHeight ne redescend jamais quand
  // on efface des lignes, et le champ resterait à sa hauteur maximale.
  zone.style.height = "auto";
  zone.style.height = `${zone.scrollHeight}px`;
}

function afficherEtatNoteDashboard(texte) {
  const etat = document.getElementById("dashboard-note-etat");
  if (etat) etat.textContent = texte;
}

async function enregistrerNoteDashboard() {
  const zone = document.getElementById("dashboard-note");
  if (!zone) return;
  const contenu = zone.value;
  // Rien de neuf : ni requête, ni message. La sortie du champ ne doit pas
  // réafficher « Enregistré » sur une note qu'on n'a fait que relire.
  if (contenu === noteDashboardEnregistree) return;
  try {
    await apiFetch("/dashboard/note", {
      method: "PUT",
      body: JSON.stringify({ contenu }),
    });
    noteDashboardEnregistree = contenu;
    afficherEtatNoteDashboard("Enregistré");
  } catch (err) {
    // Visible et persistant : une note perdue en silence est le seul vrai
    // échec possible ici.
    afficherEtatNoteDashboard(`Non enregistré — ${err.message}`);
  }
}

async function loadNoteDashboard() {
  const zone = document.getElementById("dashboard-note");
  if (!zone) return;
  try {
    const note = await apiFetch("/dashboard/note");
    zone.value = note.contenu || "";
    noteDashboardEnregistree = zone.value;
    ajusterHauteurNoteDashboard();
    afficherEtatNoteDashboard("");
  } catch (err) {
    afficherEtatNoteDashboard(`Notes indisponibles — ${err.message}`);
  }
}

(function cablerNoteDashboard() {
  const zone = document.getElementById("dashboard-note");
  if (!zone) return;
  zone.addEventListener("input", () => {
    ajusterHauteurNoteDashboard();
    afficherEtatNoteDashboard("Modification en cours…");
    clearTimeout(noteDashboardTimer);
    noteDashboardTimer = setTimeout(enregistrerNoteDashboard, 1000);
  });
  // Deux filets de sécurité pour ce que la temporisation ne couvre pas : quitter
  // le champ, et quitter la page (fermeture, changement d'onglet du navigateur).
  zone.addEventListener("blur", () => {
    clearTimeout(noteDashboardTimer);
    enregistrerNoteDashboard();
  });
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") enregistrerNoteDashboard();
  });
})();


/* ---------- Édition en ligne, forme générale ----------
 *
 * LE MODÈLE DES OPÉRATIONS, APPLIQUÉ AUX AUTRES LISTES. Sur la page
 * Opérations, le formulaire n'a pas de place fixe : il est DÉPLACÉ sous la
 * ligne qu'on vient de double-cliquer (cf. ouvrirFormulaireOperation), puis
 * remis à sa place quand l'édition se termine. Comptes, catégories et monnaies
 * gardaient l'ancienne disposition — un formulaire en bas de page, loin de la
 * ligne visée, qui obligeait à faire l'aller-retour du regard pour vérifier
 * qu'on modifiait bien la bonne.
 *
 * ON DÉPLACE LE FORMULAIRE, ON NE LE RÉÉCRIT PAS. C'est la même raison que sur
 * les opérations : tout son câblage (écouteurs de `submit`, boutons annuler,
 * champs remplis par fillXxxForm) continue de fonctionner tel quel. Un
 * formulaire reconstruit à chaque ouverture serait un second formulaire à
 * maintenir.
 *
 * SA PLACE D'ORIGINE EST RETENUE AU PREMIER DÉPLACEMENT, et c'est elle qui
 * sert de « garage » : le formulaire y retourne à la fermeture, ce qui rend la
 * page exactement telle qu'elle était — y compris pour la création, qui
 * continue de se faire au même endroit qu'avant.
 */

// Formulaires actuellement déplacés : id du <form> -> tout ce qu'il faut pour
// le rendre. Une Map plutôt qu'une variable unique : rien n'interdit que deux
// listes de sous-pages différentes aient chacune une édition ouverte.
const editionsEnLigne = new Map();

/** Où un élément se trouve, pour pouvoir l'y remettre plus tard. */
function origineElement(element) {
  return { parent: element.parentNode, avant: element.nextSibling };
}

function remettreElement(element, origine) {
  origine.parent.insertBefore(element, origine.avant);
}

/**
 * Referme l'édition d'un formulaire : il retourne à sa place, l'encadré
 * disparaît.
 *
 * Sans effet si ce formulaire n'est pas déplacé — c'est ce qui permet de
 * l'appeler sans condition depuis les resetXxxForm().
 */
function fermerFormulaireEnLigne(idFormulaire) {
  const edition = editionsEnLigne.get(idFormulaire);
  if (!edition) return;
  editionsEnLigne.delete(idFormulaire);
  remettreElement(edition.titre, edition.origineTitre);
  remettreElement(edition.formulaire, edition.origineFormulaire);
  edition.encadre.remove();
}

/* PIÈGE À CONNAÎTRE : un formulaire encore posé dans une liste qu'on vide par
   `innerHTML` part avec elle, et avec lui tous les écouteurs posés dessus une
   fois pour toutes. D'où l'appel à `fermerFormulaireEnLigne` en tête de chaque
   rendu de liste concernée (loadComptes, renderCategories,
   renderMonnaies). */

/**
 * Pose `#<idFormulaire>` et son titre `#<idTitre>` juste sous `ancre`.
 *
 * `ancre` est la ligne éditée : un `<tr>` (catégories) ou une div de liste
 * `.import-mapping-row` (comptes, monnaies). Les deux cas ne peuvent pas
 * partager le même conteneur — on n'insère pas une div entre deux `<tr>` sans
 * que le navigateur la ressorte du tableau — d'où la distinction ci-dessous,
 * qui est la seule.
 *
 * `ancre` à null referme simplement l'édition : le formulaire revient à sa
 * place, c'est-à-dire au bloc de création.
 */
function ouvrirFormulaireEnLigne(idFormulaire, idTitre, ancre) {
  fermerFormulaireEnLigne(idFormulaire);
  if (!ancre) return;

  const titre = document.getElementById(idTitre);
  const formulaire = document.getElementById(idFormulaire);
  if (!titre || !formulaire) return;

  const origineTitre = origineElement(titre);
  const origineFormulaire = origineElement(formulaire);

  let encadre;
  if (ancre.tagName === "TR") {
    encadre = document.createElement("tr");
    encadre.className = "edition-en-ligne-row";
    const cellule = document.createElement("td");
    // Le nombre de colonnes se lit sur le tableau réellement affiché plutôt
    // que sur une table de correspondance à maintenir en double.
    cellule.colSpan = ancre.closest("table").querySelectorAll("thead th").length || 1;
    cellule.appendChild(titre);
    cellule.appendChild(formulaire);
    encadre.appendChild(cellule);
  } else {
    encadre = document.createElement("div");
    encadre.className = "edition-en-ligne-bloc";
    encadre.appendChild(titre);
    encadre.appendChild(formulaire);
  }

  ancre.parentNode.insertBefore(encadre, ancre.nextSibling);
  editionsEnLigne.set(idFormulaire, {
    titre,
    formulaire,
    encadre,
    origineTitre,
    origineFormulaire,
  });
  encadre.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

/* ---------- Bascules dépliantes (pictogramme) ----------
 *
 * CE QUE ÇA REMPLACE. Les explications et les avertissements des extensions
 * étaient affichés en permanence, sous chaque carte. Ce sont des textes longs,
 * lus une fois — celui des monnaies fait quatre lignes — et qui repoussaient
 * vers le bas la seule chose qu'on vient chercher sur cet écran : l'état de
 * chaque extension. Ils sont maintenant repliés derrière un pictogramme :
 * un clic déplie, un second replie.
 *
 * UN SEUL PICTOGRAMME, DÉCLARÉ ICI. Le contenu est inséré tel quel dans le
 * bouton : le remplacer par un fichier (`<img src="…" alt="">`) se ferait sur
 * cette constante et nulle part ailleurs.
 *
 * UN SVG EN LIGNE PLUTÔT QU'UNE IMAGE, et c'est ce qui compte ici : le tracé
 * hérite de `currentColor`, donc il suit la couleur du bouton — grisé au repos,
 * accentué une fois déplié, orangé sur un avertissement — et reste net à toutes
 * les tailles. Une image plate aurait figé une seule couleur, illisible dans un
 * des deux thèmes, et aurait ajouté une requête réseau par bouton.
 */
const ICONE_BASCULE_DETAIL = `
  <svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor"
       stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"
       aria-hidden="true" focusable="false">
    <!-- Les deux feuilles de dessous : seuls leurs bords visibles sont tracés.
         Les dessiner entières demanderait de les remplir pour masquer ce qui
         passe derrière la feuille de devant — donc de connaître la couleur du
         fond, que ce pictogramme n'a justement pas à connaître. -->
    <path d="M4.4 16.6A1.4 1.4 0 0 1 3.2 15.2V4.3A1.4 1.4 0 0 1 4.6 2.9h10.6" />
    <path d="M6.4 18.9A1.4 1.4 0 0 1 5.2 17.5V6.6A1.4 1.4 0 0 1 6.6 5.2h10.6" />
    <!-- La feuille de devant, coin replié en haut à gauche. -->
    <path d="M11.2 7.5 8.1 10.6v9.9a1.4 1.4 0 0 0 1.4 1.4h10a1.4 1.4 0 0 0 1.4-1.4V8.9a1.4 1.4 0 0 0-1.4-1.4z" />
    <path d="M11.2 7.5v3.1H8.1" />
    <!-- Le texte de la page : c'est lui qui dit « il y a quelque chose à lire ». -->
    <path d="M10.9 13.4h7.6M10.9 16h2M14.5 16h4M10.9 18.6h7.6" />
  </svg>`;

/**
 * Le couple bouton + panneau replié, prêt à insérer.
 *
 * `id` doit être unique dans la page : c'est lui qui relie le bouton à son
 * panneau, les deux n'étant pas voisins dans le DOM (le bouton vit dans
 * l'en-tête d'une carte, le panneau sous elle).
 *
 * Rend une chaîne vide si le contenu est vide : un bouton qui déplie du blanc
 * est pire qu'une absence de bouton.
 */
function basculeDetailHtml(id, contenuHtml, { libelle, classe = "" } = {}) {
  if (!contenuHtml) return { bouton: "", panneau: "" };
  const titre = escapeHtml(libelle || t("Afficher l'explication"));
  return {
    bouton: `<button type="button" class="detail-bascule ${classe}" data-bascule="${escapeHtml(id)}"
              aria-expanded="false" aria-controls="${escapeHtml(id)}"
              title="${titre}" aria-label="${titre}">${ICONE_BASCULE_DETAIL}</button>`,
    panneau: `<div class="detail-contenu" id="${escapeHtml(id)}" hidden>${contenuHtml}</div>`,
  };
}

// Délégué sur tout le document : les cartes d'extensions sont reconstruites à
// chaque rendu, et la fenêtre de lancement est écrite par extensions.js, qui
// n'a pas à connaître ce mécanisme.
document.addEventListener("click", (evenement) => {
  const bouton = evenement.target.closest("button[data-bascule]");
  if (!bouton) return;
  const panneau = document.getElementById(bouton.dataset.bascule);
  if (!panneau) return;
  const ouvrir = panneau.hidden;
  panneau.hidden = !ouvrir;
  bouton.setAttribute("aria-expanded", String(ouvrir));
  bouton.classList.toggle("ouvert", ouvrir);
});


/* ---------- LE MENU À COCHER, mécanisme transverse ----------
 *
 * UN BOUTON DISCRET DANS UN TITRE, qui déplie une liste de cases : « qu'est-ce
 * que je veux voir ici ? ». Le filtre de catégories du dashboard l'a inventé ;
 * le choix des colonnes du tableau des titres détenus (extension « Placements
 * financiers ») en est le deuxième emploi, et le premier hors du noyau.
 *
 * POURQUOI IL VIT ICI et pas dans l'extension : une extension qui recopie un
 * enchaînement du noyau le fige au jour où elle l'a copié, et les deux menus
 * auraient cessé de se ressembler au premier ajustement — or se ressembler EST
 * la fonction de ce contrôle. Même raison que `creerEditeurMotsCles`, que
 * l'éditeur de règles réemploie tel quel.
 *
 * CE QU'IL NE FAIT PAS : décider quoi que ce soit du contenu. Il rend les cases
 * demandées, il appelle `onChange` avec le Set des clés cochées, et il se
 * referme au clic hors de lui. Ce qui est coché, ce que ça veut dire et ce qui
 * doit se redessiner ne regardent que l'appelant.
 *
 * LE FILTRE DU DASHBOARD N'A PAS ÉTÉ CONVERTI, et c'est délibéré : ses lignes
 * portent une pastille de couleur, un état indéterminé sur « Tout
 * sélectionner » et une forme canonique (`null` = toutes) qui lui est propre.
 * Les faire entrer ici aurait demandé d'inventer des options pour un seul
 * appelant. Ce que les deux PARTAGENT — le bouton, le panneau, la façon de se
 * refermer — est dans la feuille de style, où c'est déjà commun.
 */
function creerMenuCases(
  conteneur,
  { libelle, options, coches, onChange, toutSelectionner = false, unique = false }
) {
  conteneur.innerHTML = "";
  conteneur.classList.add("filtre-menu");

  const bouton = document.createElement("button");
  bouton.type = "button";
  bouton.className = "filtre-menu-bouton";
  // UN CHOIX UNIQUE (`unique`) : le même bouton et le même panneau, mais des boutons
  // radio — une seule option à la fois, et le bouton PORTE le libellé de celle qui est
  // choisie (le graphe « une catégorie » de la page Budget).
  const libelleBouton = () => {
    if (!unique) return libelle;
    const choix = options.find((o) => !o.titre && choisies.has(o.cle));
    return choix ? choix.libelle : libelle;
  };
  const nomRadio = `menu-unique-${Math.random().toString(36).slice(2)}`;
  bouton.setAttribute("aria-haspopup", "true");
  bouton.setAttribute("aria-expanded", "false");

  const panneau = document.createElement("div");
  panneau.className = "filtre-categories-panneau";
  panneau.hidden = true;

  const choisies = new Set(coches);
  bouton.textContent = `${libelleBouton()} ▾`;
  const cases = [];
  // DES INTERTITRES (`{ titre }`) peuvent ranger les options en groupes — les comptes
  // par type, dans le sélecteur des projets. Ils ne se cochent pas et ne comptent pas.
  const toutes = options;
  options = options.filter((o) => !o.titre);
  // « TOUT SÉLECTIONNER », ET LE BOUTON QUI BLEUIT QUAND ON FILTRE — les deux
  // choses que le filtre de catégories du dashboard faisait seul. Un FILTRE en a
  // besoin (une case décochée puis repliée est ce qu'on oublie) ; un choix de
  // colonnes, non : d'où l'option.
  let caseTout = null;
  const majEtat = () => {
    if (!toutSelectionner) return;
    caseTout.checked = choisies.size === options.length;
    caseTout.indeterminate = choisies.size > 0 && choisies.size < options.length;
    bouton.classList.toggle("filtre-actif", choisies.size < options.length);
  };
  if (toutSelectionner) {
    const ligne = document.createElement("label");
    ligne.className = "filtre-categories-tout";
    caseTout = document.createElement("input");
    caseTout.type = "checkbox";
    caseTout.addEventListener("change", () => {
      choisies.clear();
      if (caseTout.checked) options.forEach(({ cle }) => choisies.add(cle));
      cases.forEach(([caseACocher, cle]) => (caseACocher.checked = choisies.has(cle)));
      majEtat();
      onChange(new Set(choisies));
    });
    ligne.appendChild(caseTout);
    ligne.appendChild(document.createTextNode(t("Tout sélectionner")));
    panneau.appendChild(ligne);
  }
  toutes.forEach(({ cle, libelle: texte, verrouillee, couleur, titre }) => {
    if (titre) {
      const intertitre = document.createElement("div");
      intertitre.className = "filtre-menu-intertitre";
      intertitre.textContent = titre;
      panneau.appendChild(intertitre);
      return;
    }
    const ligne = document.createElement("label");
    const caseACocher = document.createElement("input");
    caseACocher.type = unique ? "radio" : "checkbox";
    if (unique) caseACocher.name = nomRadio;
    caseACocher.checked = choisies.has(cle);
    // UNE OPTION VERROUILLÉE RESTE VISIBLE, cochée et inerte. La retirer de la
    // liste aurait laissé croire qu'elle se cache aussi, et fait chercher
    // longtemps la case qui n'existe pas.
    caseACocher.disabled = Boolean(verrouillee);
    caseACocher.addEventListener("change", () => {
      if (unique) {
        choisies.clear();
        choisies.add(cle);
        bouton.textContent = `${libelleBouton()} ▾`;
        panneau.hidden = true;
        bouton.setAttribute("aria-expanded", "false");
        onChange(new Set(choisies));
        return;
      }
      if (caseACocher.checked) choisies.add(cle);
      else choisies.delete(cle);
      majEtat();
      onChange(new Set(choisies));
    });
    cases.push([caseACocher, cle]);
    ligne.appendChild(caseACocher);
    // LA PASTILLE DE COULEUR, comme dans le filtre du dashboard : une catégorie
    // se reconnaît à sa teinte d'un écran à l'autre.
    if (couleur) {
      const pastille = document.createElement("span");
      pastille.className = "filtre-categories-couleur";
      pastille.style.background = couleur;
      ligne.appendChild(pastille);
    }
    ligne.appendChild(document.createTextNode(texte));
    panneau.appendChild(ligne);
  });
  if (caseTout) majEtat();

  bouton.addEventListener("click", () => {
    const ouvrir = panneau.hidden;
    panneau.hidden = !ouvrir;
    bouton.setAttribute("aria-expanded", String(ouvrir));
  });

  conteneur.appendChild(bouton);
  conteneur.appendChild(panneau);
}

/* ---------- « + AJOUTER UN CHAMP », mécanisme transverse ----------
 *
 * UN FORMULAIRE QUI NE MONTRE QUE CE QU'ON A CHOISI D'Y METTRE. Les sorties
 * conditionnelles d'une règle et les filtres d'un objectif alignaient toutes
 * leurs possibilités d'un coup — six listes « celle de la règle » dont on ne
 * change qu'une, cinq filtres dont on n'utilise qu'un. Le formulaire devenait
 * un inventaire à parcourir pour trouver l'unique ligne qui compte.
 *
 * D'où ce bouton : il déplie la liste des champs ENCORE DISPONIBLES, et le
 * choix d'un champ appelle `onChoix(cle)` — c'est l'appelant qui pose la ligne
 * correspondante, avec son bouton pour la retirer. Un champ déjà posé ne se
 * repropose pas ; quand tous le sont, le bouton disparaît.
 *
 * MÊMES CLASSES QUE LE MENU À COCHER (`.filtre-menu`, `-bouton`,
 * `.filtre-categories-panneau`) : même bouton, même panneau, même fermeture au
 * clic à côté (l'écouteur délégué ci-dessous les referme tous les deux).
 */
function creerMenuAjoutChamp(conteneur, { libelle, options, onChoix }) {
  conteneur.innerHTML = "";
  conteneur.classList.add("filtre-menu", "menu-ajout-champ");
  conteneur.hidden = options.length === 0;
  if (!options.length) return;

  const bouton = document.createElement("button");
  bouton.type = "button";
  bouton.className = "filtre-menu-bouton";
  bouton.textContent = `+ ${libelle}`;
  bouton.setAttribute("aria-haspopup", "true");
  bouton.setAttribute("aria-expanded", "false");

  const panneau = document.createElement("div");
  panneau.className = "filtre-categories-panneau";
  panneau.hidden = true;
  options.forEach(({ cle, libelle: texte }) => {
    const option = document.createElement("button");
    option.type = "button";
    option.className = "menu-ajout-option";
    option.textContent = texte;
    option.addEventListener("click", () => {
      panneau.hidden = true;
      bouton.setAttribute("aria-expanded", "false");
      onChoix(cle);
    });
    panneau.appendChild(option);
  });

  bouton.addEventListener("click", () => {
    const ouvrir = panneau.hidden;
    panneau.hidden = !ouvrir;
    bouton.setAttribute("aria-expanded", String(ouvrir));
  });

  conteneur.appendChild(bouton);
  conteneur.appendChild(panneau);
}

// Clic hors du contrôle : referme, comme tout menu déroulant de l'app.
//
// UN SEUL ÉCOUTEUR POUR TOUS LES MENUS, posé une fois et délégué. Chaque appel
// à `creerMenuCases` en posait un sur `document`, et un menu reconstruit — ce
// que fait n'importe quel écran qui se redessine — en laissait donc un de plus
// derrière lui à chaque fois. Une fuite silencieuse, invisible tant qu'on ne
// compte pas : rien ne casse, le même travail se refait simplement N fois.
document.addEventListener("click", (e) => {
  document.querySelectorAll(".filtre-menu").forEach((menu) => {
    if (menu.contains(e.target)) return;
    const panneau = menu.querySelector(".filtre-categories-panneau");
    if (!panneau || panneau.hidden) return;
    panneau.hidden = true;
    menu.querySelector(".filtre-menu-bouton")?.setAttribute("aria-expanded", "false");
  });
});


/* ---------- Comptes ---------- */

/**
 * Double-clic sur une ligne pour l'éditer, comme sur la page Opérations : le
 * geste est le même partout, plutôt que d'obliger à viser le bouton "Modifier".
 *
 * Les lignes visées portent leur id dans `data-id` ; les clics sur les boutons
 * d'action sont exclus, pour ne pas ouvrir l'édition en même temps qu'on
 * supprime.
 *
 * LA LIGNE EST PASSÉE À `onEdit` en second argument : c'est elle qui sert
 * d'ancre au formulaire d'édition, posé juste en dessous (cf.
 * ouvrirFormulaireEnLigne). Le bouton « Modifier » de la ligne passe la même
 * chose — les deux gestes doivent ouvrir le formulaire au même endroit.
 */
function activerEditionDoubleClic(conteneur, onEdit) {
  conteneur.querySelectorAll("tr[data-id], .import-mapping-row[data-id]").forEach((ligne) => {
    ligne.addEventListener("dblclick", (e) => {
      if (e.target.closest("button") || e.target.closest("input, select")) return;
      onEdit(Number(ligne.dataset.id), ligne);
    });
  });
}

/**
 * Une ligne par monnaie de l'app : une case pour l'attacher au compte, son
 * solde de départ dans cette monnaie, et une case « Active ». Un compte
 * multi-devises a bien deux soldes initiaux, un champ unique ne pouvait pas
 * dire lequel.
 *
 * DEUX CASES QUI NE DISENT PAS LA MÊME CHOSE, et c'est tout l'objet de la
 * seconde. Décocher la première RETIRE la monnaie du compte, et c'est refusé dès
 * qu'une opération y est libellée (les montants perdraient le solde qui les
 * porte) : un compte ouvert un temps en dollars, soldé depuis, ne pouvait donc
 * plus s'en défaire sans supprimer son historique. Décocher « Active » l'ÉTEINT :
 * la monnaie cesse d'être proposée à la saisie et devinée à l'import, ses
 * opérations restent en base, et rallumer se fait d'un clic.
 *
 * ÉTEINDRE EXIGE UN SOLDE NUL (refus en 409 côté serveur, cf.
 * routers/comptes._valider_extinctions) : la case est donc grisée tant qu'il ne
 * l'est pas, avec la raison en infobulle — une case qu'on coche et qui revient
 * en arrière renseigne moins qu'une case qu'on ne peut pas cocher.
 *
 * `selection` : [{monnaie_id, solde_initial, active, solde_reel, solde_projete}]
 * dans l'ordre voulu — la première ALLUMÉE est la monnaie proposée par défaut à
 * la saisie d'une opération.
 */
function renderCompteMonnaies(selection = [], bloc = document.getElementById("compte-monnaies")) {
  // `bloc` : la liste de Paramètres → Configuration, ou celle de la fenêtre qui crée un compte sur place
  // (cf. demanderCreationCompte) — les mêmes lignes, pour qu'un compte se crée pareil des deux côtés.
  bloc.innerHTML = "";
  if (state.monnaies.length === 0) {
    bloc.innerHTML =
      '<span class="hint">Aucune monnaie : crée-en une dans l\'onglet Monnaies.</span>';
    return;
  }
  const parId = Object.fromEntries(selection.map((s) => [s.monnaie_id, s]));
  // UNE MONNAIE ÉTEINTE NE S'AJOUTE PLUS À UN COMPTE (migration 0068), mais
  // celle que le compte porte DÉJÀ reste affichée : c'est la ligne d'où l'on
  // voit son solde, et la faire disparaître d'un formulaire rouvert pour
  // corriger un nom donnerait l'impression qu'on vient de la retirer.
  const proposables = state.monnaies.filter(
    (m) => m.active !== false || parId[m.id]
  );
  proposables.forEach((monnaie) => {
    const entree = parId[monnaie.id];
    const choisie = Boolean(entree);
    const active = entree ? entree.active !== false : true;
    // Le même seuil que le serveur (services/soldes.EPSILON_SOLDE_NUL) : des
    // montants flottants qui se compensent laissent un résidu binaire, et
    // comparer à zéro exactement ferait dépendre l'extinction de l'ordre de
    // saisie.
    const soldee =
      !entree ||
      (Math.abs(entree.solde_reel || 0) < 0.005 && Math.abs(entree.solde_projete || 0) < 0.005);
    // SOLDE INITIAL VERROUILLÉ : un solde actuel a été renseigné, le solde initial en est
    // déduit et ne se modifie plus tant qu'on ne supprime pas le solde actuel renseigné.
    const verrouille = Boolean(entree) && entree.solde_actuel_renseigne != null;
    const row = document.createElement("div");
    row.className = "import-mapping-row";
    row.dataset.monnaieId = monnaie.id;
    if (verrouille) row.dataset.soldeActuel = String(entree.solde_actuel_renseigne);
    row.innerHTML = `
      <input type="checkbox" data-role="choisie" ${choisie ? "checked" : ""} />
      <span class="import-mapping-nom">${escapeHtml(monnaie.nom)} (${escapeHtml(monnaie.symbole)})</span>
      <input type="number" step="0.01" data-role="solde-initial"
             title="${t("Solde initial dans cette monnaie")}"
             value="${choisie ? entree.solde_initial : 0}" ${choisie ? "" : "disabled"} />
      <input type="number" step="0.01" data-role="solde-actuel" style="display:none"
             placeholder="${t("Solde actuel")}" title="${t("Solde actuel")}" />
      <span data-role="verrou" class="compte-solde-verrou" style="display:none"
            title="${escapeHtml(t(texteAide("noyau.compte-solde-initial-verrouille")))}">
        ${t("Solde actuel renseigné")} :
        <strong>${verrouille ? formatMontant(entree.solde_actuel_renseigne, monnaie.id) : ""}</strong>
        <button type="button" data-role="supprimer-solde-actuel" class="champ-ajoute-retirer"
                title="${t("Supprimer le solde actuel renseigné")}"
                aria-label="${t("Supprimer le solde actuel renseigné")}">×</button>
      </span>
      <label class="compte-monnaie-active">
        <input type="checkbox" data-role="active" ${active ? "checked" : ""} />
        ${t("Active")}
      </label>
    `;
    const caseChoisie = row.querySelector("input[data-role='choisie']");
    const champSolde = row.querySelector("input[data-role='solde-initial']");
    const caseActive = row.querySelector("input[data-role='active']");
    // Grisée seulement pour ÉTEINDRE : rallumer ne demande rien, c'est le geste
    // qui rend visible, jamais celui qui cache.
    const majEtatActive = () => {
      const peutEteindre = soldee || !caseActive.checked;
      caseActive.disabled = !caseChoisie.checked || !peutEteindre;
      caseActive.parentElement.title = peutEteindre
        ? t("Décoche pour que cette monnaie ne soit plus proposée à la saisie ni devinée à l'import. Les opérations déjà enregistrées restent en base.")
        : t("Le solde de ce compte dans cette monnaie n'est pas nul : vire ce qui reste ailleurs avant d'éteindre.");
      caseActive.parentElement.classList.toggle("est-desactive", caseActive.disabled);
    };
    caseChoisie.addEventListener("change", () => {
      champSolde.disabled = !caseChoisie.checked;
      majEtatActive();
      majLignesSoldeActuel(bloc);
    });
    caseActive.addEventListener("change", majEtatActive);
    row.querySelector("input[data-role='solde-actuel']").addEventListener("input", () =>
      majLignesSoldeActuel(bloc)
    );
    row.querySelector("[data-role='supprimer-solde-actuel']").addEventListener("click", () => {
      delete row.dataset.soldeActuel;
      majLignesSoldeActuel(bloc);
    });
    majEtatActive();
    bloc.appendChild(row);
  });
  majLignesSoldeActuel(bloc);
}

/** L'option « Calculer le solde initial avec le solde actuel » est-elle cochée dans le formulaire qui porte
 *  cette liste de monnaies ? Seul celui de Paramètres → Configuration l'a : un compte qu'on crée sur place n'a
 *  encore aucune opération d'où déduire quoi que ce soit. */
function soldeActuelDemande(bloc) {
  const option = bloc.closest("form")?.querySelector("#compte-calcul-solde");
  return Boolean(option && option.checked);
}

/**
 * « CALCULER LE SOLDE INITIAL AVEC LE SOLDE ACTUEL » (formulaire d'un compte existant).
 *
 * Cochée, l'option demande le solde ACTUEL de chaque monnaie : le serveur en déduit le solde
 * initial (`actuel - ce que les opérations ont changé`), puis le VERROUILLE. Le champ du solde
 * initial est alors grisé ; pour le modifier, on supprime d'abord le solde actuel renseigné
 * (la croix de la ligne). Le serveur applique la même règle — cf. routers/comptes.
 */
function majLignesSoldeActuel(bloc = document.getElementById("compte-monnaies")) {
  const activee = soldeActuelDemande(bloc);
  bloc.querySelectorAll(".import-mapping-row").forEach((row) => {
    const choisie = row.querySelector("input[data-role='choisie']").checked;
    const verrouille = row.dataset.soldeActuel !== undefined;
    const champActuel = row.querySelector("input[data-role='solde-actuel']");
    const champInitial = row.querySelector("input[data-role='solde-initial']");
    row.querySelector("[data-role='verrou']").style.display = verrouille ? "" : "none";
    champActuel.style.display = activee && !verrouille && choisie ? "" : "none";
    champInitial.disabled =
      !choisie || verrouille || (activee && champActuel.value.trim() !== "");
  });
}

function lireCompteMonnaies(bloc = document.getElementById("compte-monnaies")) {
  const optionActivee = soldeActuelDemande(bloc);
  return [...bloc.querySelectorAll(".import-mapping-row")]
    .filter((row) => row.querySelector("input[data-role='choisie']").checked)
    .map((row) => {
      const saisi = row.querySelector("input[data-role='solde-actuel']").value.trim();
      const verrouille = row.dataset.soldeActuel !== undefined;
      return {
        monnaie_id: Number(row.dataset.monnaieId),
        solde_initial: parseFloat(
          row.querySelector("input[data-role='solde-initial']").value || "0"
        ),
        // Verrouillé : le solde actuel enregistré revient tel quel (le serveur garde le solde
        // initial déduit). Supprimé : rien n'est envoyé, ce qui déverrouille. Neuf : le
        // serveur en déduit le solde initial.
        solde_actuel_renseigne: verrouille
          ? Number(row.dataset.soldeActuel)
          : optionActivee && saisi !== ""
            ? parseFloat(saisi)
            : null,
        active: row.querySelector("input[data-role='active']").checked,
      };
    });
}

document.getElementById("compte-calcul-solde").addEventListener("change", () => majLignesSoldeActuel());

function resetCompteForm() {
  // Le formulaire retourne à sa place (le bloc de création, en bas de page) :
  // « annuler » et « enregistrer » passent tous deux par ici.
  fermerFormulaireEnLigne("form-compte");
  document.getElementById("compte-id").value = "";
  document.getElementById("compte-nom").value = "";
  // Par défaut la première monnaie de l'app : le cas mono-devise, de loin le
  // plus courant, ne demande alors aucun clic.
  renderCompteMonnaies(
    state.monnaies.length > 0 ? [{ monnaie_id: state.monnaies[0].id, solde_initial: 0 }] : []
  );
  document.getElementById("form-compte-titre").textContent = t("Ajouter un compte");
  document.getElementById("compte-annuler").style.display = "none";
  // EN CRÉATION, RIEN À ÉTEINDRE : le bouton d'état ne vaut que devant un
  // compte qui existe déjà.
  document.getElementById("compte-etat").style.display = "none";
  // L'option de solde actuel n'a de sens que devant un compte qui existe déjà.
  document.getElementById("compte-calcul-solde").checked = false;
  document.getElementById("compte-solde-actuel-bloc").style.display = "none";
  majLignesSoldeActuel();
}

function fillCompteForm(compte, ancre) {
  // Sous la ligne double-cliquée, comme sur la page Opérations. Sans ancre
  // (appel programmatique), le formulaire reste à sa place.
  ouvrirFormulaireEnLigne("form-compte", "form-compte-titre", ancre);
  document.getElementById("compte-id").value = compte.id;
  document.getElementById("compte-nom").value = compte.nom;
  document.getElementById("compte-type").value = compte.type_id;
  // Les soldes voyagent avec la liste : c'est eux qui décident si la case
  // « Active » est cochable (cf. renderCompteMonnaies).
  renderCompteMonnaies(
    compte.monnaies.map((m) => ({
      monnaie_id: m.monnaie_id,
      solde_initial: m.solde_initial,
      active: m.active,
      solde_reel: m.solde_reel,
      solde_projete: m.solde_projete,
      solde_actuel_renseigne: m.solde_actuel_renseigne,
    }))
  );
  document.getElementById("compte-solde-actuel-bloc").style.display = "";
  document.getElementById("form-compte-titre").textContent = `Modifier "${compte.nom}"`;
  document.getElementById("compte-annuler").style.display = "inline-block";
  cablerBoutonEtat("compte-etat", {
    eteint: compte.actif === false,
    protege: false,
    url: `/comptes/${compte.id}/etat`,
    corps: { actif: compte.actif === false },
    message: compte.actif === false ? t("Compte réactivé") : t("Compte désactivé"),
    apres: loadComptes,
  });
}

/**
 * Les comptes sont rangés par type, chaque type devenant une carte empilée sous
 * la précédente.
 *
 * Le type n'a donc plus de colonne : il est porté par la carte, où il ne se
 * répète pas sur chaque ligne. Et comme la carte EST le type, y déposer un
 * compte suffit à le changer (cf. attacherDragTypeComptes).
 *
 * Tous les types sont affichés, même sans compte : une carte vide reste une
 * cible de dépôt valide, sans quoi on ne pourrait jamais y amener le premier
 * compte.
 */
async function loadComptes() {
  try {
    await refreshMonnaies();
    await refreshComptes();
    // `refreshTypesComptes` reste : les cartes de la page et le menu du
    // formulaire se rangent par type. C'est seulement la LISTE des types, qui
    // n'offrait aucune action (les trois livrés sont protégés, et on n'en crée
    // plus), qui a disparu.
    await refreshTypesComptes();
    resetCompteForm();

    const conteneur = document.getElementById("comptes-liste");
    // Le formulaire peut être posé DANS cette liste : le vider sans l'avoir
    // remis à sa place l'emporterait, écouteurs compris.
    fermerFormulaireEnLigne("form-compte");
    conteneur.innerHTML = "";

    state.typesComptes.forEach((type) => {
      const carte = document.createElement("div");
      carte.className = "groupe-carte";
      carte.dataset.typeId = type.id;

      const titre = document.createElement("div");
      titre.className = "groupe-carte-titre";
      titre.textContent = typeLabel(type.nom);
      carte.appendChild(titre);

      const corps = document.createElement("div");
      corps.className = "groupe-carte-corps";
      const comptes = state.comptes.filter((c) => c.type_id === type.id);
      if (comptes.length === 0) {
        const vide = document.createElement("span");
        vide.className = "hint groupe-carte-vide";
        vide.textContent = t("Aucun compte — dépose-en un ici.");
        corps.appendChild(vide);
      }
      comptes.forEach((c) => corps.appendChild(construireLigneCompte(c)));

      carte.appendChild(corps);
      conteneur.appendChild(carte);
    });

    cablerActionsComptes(conteneur);
    attacherDragTypeComptes(conteneur);
    // Le panneau de vérification lit la même liste de comptes : la remplir ici
    // le garde d'accord avec les cartes au-dessus, renommage compris.
    } catch (err) {
    showMessage(err.message, "error");
  }
}

function construireLigneCompte(compte) {
  const ligne = document.createElement("div");
  // UN COMPTE ÉTEINT RESTE LISTÉ ICI, barré : c'est la ligne d'où on le
  // rallume, et un compte qu'on ne voit nulle part ne se rallume pas. Partout
  // ailleurs il disparaît dès qu'il ne porte plus rien (cf.
  // services/soldes.get_soldes_comptes) — même règle qu'une monnaie éteinte.
  const eteint = compte.actif === false;
  ligne.className = eteint ? "import-mapping-row ligne-eteinte" : "import-mapping-row";
  ligne.dataset.id = compte.id;
  ligne.innerHTML = `
    <span class="drag-handle" title="${t("Glisser pour réordonner, ou vers une autre carte pour changer de type")}">⠿</span>
    <span class="import-mapping-nom">${escapeHtml(compte.nom)}</span>
    <!-- LES ÉTEINTES RESTENT LISTÉES ICI, en grisé : c'est la ligne depuis
         laquelle on rallume, et une monnaie qu'on ne voit nulle part ne se
         rallume pas. Partout ailleurs (cartes de compte, onglets du dashboard)
         elles disparaissent, cf. services/soldes.get_soldes_comptes. -->
    <span class="compte-ligne-monnaies">${compte.monnaies
      .map((m) =>
        m.active === false
          ? `<span class="monnaie-eteinte" title="${t("Monnaie éteinte : plus proposée à la saisie ni devinée à l'import. Ses opérations sont toujours en base.")}">${escapeHtml(m.monnaie_symbole)}</span>`
          : escapeHtml(m.monnaie_symbole)
      )
      .join(" · ")}</span>
    <span class="compte-ligne-solde">${compte.monnaies
      .filter((m) => m.active !== false)
      .map((m) => formatMontant(m.solde_initial, m.monnaie_id))
      .join(" · ")}</span>
    <!-- « Modifier » répète le double-clic, mais se voit : le geste ne se découvre pas. « Éteindre »
         est dans le formulaire — c'est là qu'on regarde le compte au moment de le décider. -->
    <button type="button" data-action="edit" data-id="${compte.id}">${t("Modifier")}</button>
    <button type="button" data-action="delete" data-id="${compte.id}" class="danger">${t("Supprimer")}</button>
  `;
  // Déplaçable par sa poignée seulement : le nom du compte reste copiable.
  rendreDeplacableParPoignee(ligne, ".drag-handle");
  return ligne;
}

function cablerActionsComptes(conteneur) {
  const editerCompte = (id, ligne) => {
    const compte = state.comptes.find((c) => c.id === id);
    if (compte) fillCompteForm(compte, ligne);
  };
  activerEditionDoubleClic(conteneur, editerCompte);
  conteneur.querySelectorAll("button[data-action='edit']").forEach((btn) => {
    btn.addEventListener("click", () =>
      editerCompte(Number(btn.dataset.id), btn.closest("[data-id]"))
    );
  });

  conteneur.querySelectorAll("button[data-action='delete']").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!confirm(t("Supprimer ce compte ?"))) return;
      try {
        await apiFetch(`/comptes/${btn.dataset.id}`, { method: "DELETE" });
        showMessage(t("Compte supprimé"), "success");
        loadComptes();
      } catch (err) {
        showMessage(err.message, "error");
      }
    });
  });
}

/**
 * Glisser un compte d'une carte à l'autre change son type ; le glisser à
 * l'intérieur de sa carte le réordonne.
 *
 * La carte survolée porte le type visé, et l'ordre des lignes qu'elle contient
 * est l'ordre voulu — les deux se lisent donc du même geste. C'est ici que se
 * décide l'ordre d'affichage des comptes partout ailleurs, cartes du dashboard
 * comprises (cf. models.Compte.ordre).
 */
function attacherDragTypeComptes(conteneur) {
  attacherDragEntreGroupes(conteneur, {
    // `.import-mapping-row` et non `[draggable='true']` : la ligne ne devient
    // déplaçable qu'au moment où l'on appuie sur sa poignée (cf.
    // rendreDeplacableParPoignee), elle ne porte donc pas l'attribut au repos —
    // et un sélecteur sur l'attribut ne trouvait plus aucune ligne.
    selecteurLigne: ".import-mapping-row",
    selecteurGroupe: ".groupe-carte",
    selecteurCorps: ".groupe-carte-corps",
    selecteurVide: ".groupe-carte-vide",
    cleGroupe: (groupe) => groupe.dataset.typeId,
    onDepose: async (ligne, typeCible) => {
      await apiFetch(`/comptes/${ligne.dataset.id}`, {
        method: "PUT",
        body: JSON.stringify({ type_id: Number(typeCible) }),
      });
      showMessage(t("Type de compte modifié"), "success");
    },
    // Envoyé après le changement de type, jamais avant : un compte qui vient
    // d'arriver dans la carte n'appartient à sa liste qu'une fois son type
    // enregistré.
    onReordonne: async (groupe, aChangeDeGroupe) => {
      const ids = [
        ...groupe.querySelectorAll(".import-mapping-row"),
      ].map((ligne) => Number(ligne.dataset.id));
      await apiFetch("/comptes/reordonner", {
        method: "PUT",
        body: JSON.stringify({ ordre: ids }),
      });
      // Le changement de type a déjà son message : deux bandeaux pour un seul
      // geste diraient deux fois la même chose.
      if (!aChangeDeGroupe) showMessage(t("Ordre des comptes modifié"), "success");
    },
    recharger: loadComptes,
  });
}

/**
 * Glisser-déposer d'une ligne d'un groupe à l'autre, partagé par la page
 * Comptes (cartes empilées) et la galerie de correspondances (colonnes côte à
 * côte) : même geste, même arbitrage, seuls les sélecteurs changent.
 *
 * `onDepose` n'est appelé que si la ligne a réellement changé de groupe.
 * `onReordonne`, optionnel, reçoit le groupe d'arrivée après tout dépôt : les
 * listes qui portent un ordre propre (les comptes) y enregistrent la nouvelle
 * position, celles qui n'en ont pas (la galerie de correspondances, triée côté
 * serveur) l'omettent — un déplacement interne n'y veut alors rien dire.
 */
/**
 * Rend un élément déplaçable PAR SA POIGNÉE, et par elle seule.
 *
 * POURQUOI CE DÉTOUR. Un élément `draggable` avale le glissement de la souris :
 * traverser son texte ne le sélectionne pas, ça commence à le déplacer. Toutes
 * ces listes portent pourtant ce qu'on veut le plus souvent copier — un nom de
 * compte, un libellé bancaire, l'intitulé d'une règle — et les rendre
 * déplaçables les rendait incopiables.
 *
 * `draggable` n'est donc posé qu'au moment où le bouton s'enfonce SUR LA
 * POIGNÉE, et retiré aussitôt après. Le reste du temps l'élément est un
 * paragraphe ordinaire, qui se sélectionne et se copie ; la poignée, elle, ne
 * se sélectionne pas (cf. `.drag-handle`, `user-select: none`), et c'est
 * cohérent — elle ne porte pas de texte, elle porte un geste.
 *
 * Le `mouseup` sur le document et non sur la poignée : relâcher ailleurs après
 * avoir appuyé dessus doit aussi remettre l'élément au repos, sans quoi le
 * glissement suivant partirait de n'importe où.
 */
function rendreDeplacableParPoignee(element, selecteurPoignee) {
  const poignee = element.querySelector(selecteurPoignee);
  if (!poignee) {
    // Pas de poignée (liste sans colonne dédiée) : on garde le comportement
    // d'avant plutôt que de rendre l'élément immobile.
    element.draggable = true;
    return;
  }
  element.draggable = false;
  poignee.addEventListener("mousedown", () => (element.draggable = true));
  document.addEventListener("mouseup", () => (element.draggable = false));
  element.addEventListener("dragend", () => (element.draggable = false));
}

function attacherDragEntreGroupes(
  conteneur,
  {
    selecteurLigne,
    selecteurGroupe,
    selecteurCorps,
    selecteurVide,
    cleGroupe,
    onDepose,
    onReordonne = null,
    // Appelé dès qu'un déplacement change la hauteur des groupes : la galerie
    // s'en sert pour refermer les vides au fil du glissement (cf.
    // ajusterHauteursGalerie). Les listes en tableau n'en ont pas besoin.
    onHauteursChangees = null,
    recharger,
  }
) {
  conteneur.querySelectorAll(selecteurLigne).forEach((ligne) => {
    ligne.addEventListener("dragstart", () => {
      ligne.classList.add("dragging");
      // Mémorisés au départ : au moment du drop, la ligne a déjà été déplacée
      // dans le DOM par le dragover ci-dessous.
      ligne.dataset.groupeOrigine = cleGroupe(ligne.closest(selecteurGroupe));
      // La ligne qui précédait : à elle seule, elle dit si la position a
      // vraiment changé — reposer une ligne là où elle était ne doit rien
      // envoyer ni recharger.
      ligne.dataset.precedenteOrigine = ligne.previousElementSibling
        ? ligne.previousElementSibling.dataset.id || ""
        : "";
    });

    ligne.addEventListener("dragend", async () => {
      ligne.classList.remove("dragging");
      // Les colonnes viennent de changer de hauteur : sans ce recalcul, le trou
      // laissé par la carte partie resterait béant jusqu'au prochain rendu.
      if (onHauteursChangees) onHauteursChangees();
      const groupe = ligne.closest(selecteurGroupe);
      const origine = ligne.dataset.groupeOrigine;
      const cible = cleGroupe(groupe);
      const aChangeDeGroupe = cible !== origine;
      const precedente = ligne.previousElementSibling
        ? ligne.previousElementSibling.dataset.id || ""
        : "";
      const aBouge = aChangeDeGroupe || precedente !== ligne.dataset.precedenteOrigine;
      if (!aBouge || (!aChangeDeGroupe && !onReordonne)) return;
      try {
        if (aChangeDeGroupe) await onDepose(ligne, cible);
        if (onReordonne) await onReordonne(groupe, aChangeDeGroupe);
      } catch (err) {
        showMessage(err.message, "error");
      }
      // Rechargement dans les deux cas : après un succès pour refléter l'ordre
      // du serveur, après un échec pour défaire le déplacement visuel.
      recharger();
    });
  });

  conteneur.querySelectorAll(selecteurCorps).forEach((corps) => {
    corps.addEventListener("dragover", (e) => {
      const dragging = conteneur.querySelector(`${selecteurLigne}.dragging`);
      // Rien de nôtre en cours de déplacement (une COLONNE de la galerie, par
      // exemple) : on ne préempte pas le glissement d'un autre, et surtout on
      // ne touche pas au contenu des groupes survolés au passage.
      if (!dragging) return;
      e.preventDefault();
      // Le texte "aucun élément" laisse la place dès qu'on survole un groupe
      // vide, sinon il resterait au-dessus de la ligne déposée.
      const vide = corps.querySelector(selecteurVide);
      if (vide) vide.remove();
      const survolee = e.target.closest(selecteurLigne);
      if (!survolee || survolee === dragging) {
        corps.appendChild(dragging);
        return;
      }
      const rect = survolee.getBoundingClientRect();
      const apresMilieu = e.clientY > rect.top + rect.height / 2;
      corps.insertBefore(dragging, apresMilieu ? survolee.nextSibling : survolee);
    });
    // Pendant le glissement aussi : la colonne survolée grandit, celle d'où
    // vient la carte rétrécit, et l'utilisateur doit voir tout de suite la place
    // qu'il libère.
    if (onHauteursChangees) {
      corps.addEventListener("dragover", onHauteursChangees);
      corps.addEventListener("dragleave", onHauteursChangees);
    }
  });
}

document.getElementById("form-compte").addEventListener("submit", async (e) => {
  e.preventDefault();
  const id = document.getElementById("compte-id").value;
  const monnaies = lireCompteMonnaies();
  if (monnaies.length === 0) {
    showMessage(t("Choisis au moins une monnaie pour ce compte."), "error");
    return;
  }
  const payload = {
    nom: document.getElementById("compte-nom").value,
    type_id: Number(document.getElementById("compte-type").value),
    monnaies,
  };
  try {
    if (id) {
      await apiFetch(`/comptes/${id}`, { method: "PUT", body: JSON.stringify(payload) });
      showMessage(t("Compte modifié"), "success");
    } else {
      await apiFetch("/comptes", { method: "POST", body: JSON.stringify(payload) });
      showMessage(t("Compte créé"), "success");
    }
    resetCompteForm();
    loadComptes();
  } catch (err) {
    showMessage(err.message, "error");
  }
});

document.getElementById("compte-annuler").addEventListener("click", resetCompteForm);

/* ---------- Catégories ----------
 *
 * CETTE PAGE NE PORTE PLUS QUE LES CATÉGORIES ELLES-MÊMES : leur nom, leur
 * ordre, leur existence. Les DEUX CHIFFRES qu'on y réglait — le budget du mois
 * d'une catégorie (`CategorieBudgetMensuel`) et son objectif de répartition
 * (`Categorie.objectif_pourcentage`) — sont passés sur la page Budget, apportée
 * par l'extension du même nom.
 *
 * POURQUOI ILS SONT PARTIS. Ils se réglaient ligne par ligne, dans un
 * formulaire qu'il fallait ouvrir vingt fois pour répartir un budget entre
 * vingt catégories — et sans jamais voir, pendant qu'on écrivait l'un, ce que
 * valaient les dix-neuf autres. Or c'est exactement la question qu'on se pose
 * en les posant. Ils demandaient en plus à cette page une MONNAIE et un MOIS,
 * dont le nom d'une catégorie ne dépend pas : deux rangées d'onglets pour une
 * seule colonne, et un formulaire qui écrivait sur trois routes ce qu'on avait
 * ouvert pour corriger une faute de frappe.
 *
 * LE SCHÉMA RESTE AU NOYAU, comme toujours (cf. extensions/README.md) :
 * éteindre l'extension ne perd aucun budget, elle les rend seulement
 * inatteignables — même règle que « Prêts » et ses deux types d'opération.
 */

function resetCategorieForm() {
  fermerFormulaireEnLigne("form-categorie");
  document.getElementById("categorie-id").value = "";
  document.getElementById("categorie-nom").value = "";
  document.getElementById("categorie-nom").disabled = false;
  document.getElementById("categorie-nom").title = "";
  delete document.getElementById("categorie-nom").dataset.nomInitial;
  document.getElementById("categorie-entree-bloc").style.display = "none";
  document.getElementById("categorie-virements-info").style.display = "none";
  document.getElementById("categorie-entree").checked = false;
  document.getElementById("categorie-mots-cles-bloc").style.display = "none";
  motsClesCategorieLivres = true;
  document.getElementById("form-categorie-titre").textContent = t("Ajouter une catégorie");
  document.getElementById("categorie-annuler").style.display = "none";
  document.getElementById("categorie-etat").style.display = "none";
}

/**
 * Le bouton « Éteindre » / « Rallumer » d'un formulaire d'édition.
 *
 * ÉCRIT UNE FOIS POUR LES DEUX ÉCRANS (catégories, comptes) : ils posent le
 * même bouton, au même endroit, pour le même geste — seules la route et la
 * phrase changent. Deux copies auraient divergé au premier ajustement, et c'est
 * précisément le défaut qu'on vient de corriger sur les champs de saisie.
 *
 * L'ÉCOUTEUR EST REMPLACÉ À CHAQUE OUVERTURE (`onclick` et non
 * `addEventListener`) : le bouton, lui, n'est jamais recréé — il vit dans le
 * HTML du formulaire — et y empiler un écouteur par ligne double-cliquée
 * finirait par éteindre trois catégories d'un clic.
 *
 * MASQUÉ QUAND `protege` : « Autres » ne s'éteint pas (deux chemins la
 * cherchent par son nom), et le serveur le refuse de toute façon. Montrer un
 * bouton qui rend 409 n'apprend rien.
 */
function cablerBoutonEtat(boutonId, { eteint, protege, url, corps, message, apres }) {
  const bouton = document.getElementById(boutonId);
  if (!bouton) return;
  if (protege) {
    bouton.style.display = "none";
    return;
  }
  bouton.style.display = "inline-block";
  bouton.textContent = eteint ? t("Réactiver") : t("Désactiver");
  bouton.onclick = async () => {
    try {
      await apiFetch(url, { method: "PUT", body: JSON.stringify(corps) });
      showMessage(message, "success");
      apres();
    } catch (err) {
      showMessage(traduireMessageServeur(err.message), "error");
    }
  };
}

// Vrai tant qu'on n'a pas touché aux mots-clés d'une catégorie qui garde ceux qui sont livrés :
// seuls un ajout, un retrait ou « Revenir aux mots-clés livrés » les font réécrire.
let motsClesCategorieLivres = true;
let motsClesCategorieInitiaux = [];

function assurerEditeurMotsClesCategorie() {
  creerEditeurMotsCles("categorie-mots-cles", {
    conteneur: "categorie-mots-cles-bloc",
    libelles: { mots: "Mots-clés" },
    vide: "Aucun mot-clé : cette catégorie ne sera jamais proposée d'après un libellé.",
    onChange: () => {
      motsClesCategorieLivres = false;
      document.getElementById("categorie-mots-cles-livres").style.display = "";
    },
  });
}

document.getElementById("categorie-mots-cles-livres").addEventListener("click", async () => {
  const id = document.getElementById("categorie-id").value;
  if (!id) return;
  try {
    await apiFetch(`/categories/${id}/mots-cles`, {
      method: "PUT",
      body: JSON.stringify({ mots_cles: null }),
    });
    showMessage(t("Mots-clés livrés rétablis"), "success");
    await refreshCategories();
    fillCategorieForm(state.categories.find((c) => c.id === Number(id)), null);
    renderCategories();
  } catch (err) {
    showMessage(err.message, "error");
  }
});

function fillCategorieForm(categorie, ancre) {
  ouvrirFormulaireEnLigne("form-categorie", "form-categorie-titre", ancre);
  document.getElementById("categorie-id").value = categorie.id;
  const champNom = document.getElementById("categorie-nom");
  champNom.value = categorie.nom;
  // LE NOM EST MODIFIABLE, sauf « Autres » : elle est retrouvée par son nom
  // pour recueillir les opérations dont on supprime la catégorie, et la
  // renommer casserait ce repli (le serveur refuse aussi, cf.
  // routers/categories.rename_categorie).
  champNom.disabled = categorie.nom === CATEGORIE_AUTRES;
  champNom.title = champNom.disabled
    ? t("« Autres » ne peut pas être renommée : c'est la catégorie de repli.")
    : "";
  // Le nom d'AVANT, pour n'appeler la route de renommage que s'il a changé.
  champNom.dataset.nomInitial = categorie.nom;
  // LA CATÉGORIE DES VIREMENTS INTERNES (migration 0090) n'est jamais une catégorie d'entrée :
  // elle se renomme, et ses mots-clés se règlent, mais la case ne se pose pas (le serveur refuse).
  document.getElementById("categorie-entree-bloc").style.display = categorie.est_virement ? "none" : "";
  document.getElementById("categorie-virements-info").style.display = categorie.est_virement ? "" : "none";
  document.getElementById("categorie-entree").checked = !!categorie.est_entree;
  // Les mots-clés : l'éditeur ne s'initialise qu'ici, à la première ouverture (cf. la note sur
  // `assurerEditeurRapprochement` : un éditeur déclaré trop tôt atteint des `const` de ce fichier
  // dans leur zone morte).
  assurerEditeurMotsClesCategorie();
  document.getElementById("categorie-mots-cles-bloc").style.display = "";
  chargerMotsCles("categorie-mots-cles", { mots: categorie.mots_cles || [] });
  motsClesCategorieLivres = !categorie.mots_cles_personnalises;
  document.getElementById("categorie-mots-cles-livres").style.display =
    categorie.mots_cles_personnalises ? "" : "none";
  document.getElementById("form-categorie-titre").textContent = `Modifier "${categorie.nom}"`;
  document.getElementById("categorie-annuler").style.display = "inline-block";
  cablerBoutonEtat("categorie-etat", {
    eteint: categorie.active === false,
    // Ni « Autres » ni la catégorie des virements internes (migration 0090) ne s'éteignent.
    protege: categorie.nom === CATEGORIE_AUTRES || !!categorie.est_virement,
    url: `/categories/${categorie.id}/etat`,
    corps: { active: categorie.active === false },
    message:
      categorie.active === false ? t("Catégorie réactivée") : t("Catégorie désactivée"),
    apres: loadCategories,
  });
}

async function loadCategories() {
  try {
    await refreshCategories();
    renderCategories();
  } catch (err) {
    showMessage(err.message, "error");
  }
}

function renderCategories() {
  const body = document.getElementById("categories-liste");
  // Cf. loadComptes : le formulaire peut être posé dans ce tableau.
  fermerFormulaireEnLigne("form-categorie");
  body.innerHTML = "";
  state.categories.forEach((c) => {
    const tr = document.createElement("tr");
    tr.dataset.id = c.id;
    // UNE CATÉGORIE ÉTEINTE RESTE LISTÉE ICI, barrée : c'est la ligne d'où on
    // la rallume. Ailleurs — menus de saisie, règles, page Budget — elle a
    // disparu, et sa barre d'histogramme ne subsiste que sur les périodes où
    // elle porte des dépenses.
    const eteinte = c.active === false;
    if (eteinte) tr.classList.add("ligne-eteinte");
    // « Autres » ne s'éteint pas plus qu'elle ne se supprime : c'est le repli
    // d'une opération dont on retire la catégorie (le serveur refuse aussi).
    const estAutres = c.nom === CATEGORIE_AUTRES;
    // DEUX PROTECTIONS DIFFÉRENTES, et elles ne couvrent pas la même chose :
    // « Autres » ne se supprime ni ne s'éteint (deux chemins la cherchent par
    // son nom), « Entrées d'argent » ne se supprime pas mais s'éteint très bien
    // — une fois qu'une autre catégorie porte la case « entrée ».
    // La catégorie des virements internes (migration 0090) non plus : reconnue à son drapeau,
    // elle se renomme mais ne se supprime pas.
    const protegee = estAutres || c.nom === CATEGORIE_ENTREES_ARGENT || !!c.est_virement;
    const deleteAction = protegee
      ? ""
      : `<button data-action="delete" data-id="${c.id}" class="danger">${t("Supprimer")}</button>`;

    tr.innerHTML = `
      <td class="drag-handle" title="${t("Glisser pour réordonner")}">⠿</td>
      <td>${escapeHtml(libelleCategorie(c.nom))}${
        // UNE PASTILLE ET PAS UNE COLONNE : une colonne « Entrée ? » aurait
        // écrit vingt fois « non » pour dire une fois « oui ». Ce qui se voit
        // doit être ce qui a été décidé — même règle que la colonne d'objectifs
        // d'avant, vide plutôt que remplie de zéros.
        c.est_entree ? `<span class="badge-aucun">${t("entrée")}</span>` : ""
      }${c.est_virement ? `<span class="badge-aucun">${t("virements")}</span>` : ""}</td>
      <!-- « Modifier » répète le double-clic, mais se voit ; « Éteindre » est dans le formulaire. -->
      <td><button data-action="edit" data-id="${c.id}">${t("Modifier")}</button> ${deleteAction}</td>
    `;
    // Déplaçable par sa poignée seulement : le nom de la catégorie reste
    // copiable.
    rendreDeplacableParPoignee(tr, ".drag-handle");
    body.appendChild(tr);
  });

  const editerCategorie = (id, ligne) => {
    const categorie = state.categories.find((c) => c.id === id);
    if (!categorie) return;
    fillCategorieForm(categorie, ligne);
  };
  activerEditionDoubleClic(body, editerCategorie);
  body.querySelectorAll("button[data-action='edit']").forEach((btn) => {
    btn.addEventListener("click", () =>
      editerCategorie(Number(btn.dataset.id), btn.closest("tr[data-id]"))
    );
  });

  body.querySelectorAll("button[data-action='delete']").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!confirm(t("Supprimer cette catégorie ?"))) return;
      try {
        await apiFetch(`/categories/${btn.dataset.id}`, { method: "DELETE" });
        showMessage(t("Catégorie supprimée"), "success");
        loadCategories();
      } catch (err) {
        showMessage(err.message, "error");
      }
    });
  });

  attacherDragReorderCategories(body);
}

// Glisser-déposer natif (HTML5) pour réordonner les catégories : plus
// pratique que des boutons monter/descendre pour une longue liste.
function attacherDragReorderCategories(body) {
  body.querySelectorAll("tr[data-id]").forEach((tr) => {
    tr.addEventListener("dragstart", () => {
      tr.classList.add("dragging");
    });

    tr.addEventListener("dragend", async () => {
      tr.classList.remove("dragging");
      const nouvelOrdre = [...body.querySelectorAll("tr[data-id]")].map((r) =>
        Number(r.dataset.id)
      );
      try {
        await apiFetch("/categories/reordonner", {
          method: "PUT",
          body: JSON.stringify({ ordre: nouvelOrdre }),
        });
        await refreshCategories();
      } catch (err) {
        showMessage(err.message, "error");
        loadCategories();
      }
    });

    tr.addEventListener("dragover", (e) => {
      e.preventDefault();
      const dragging = body.querySelector(".dragging");
      if (!dragging || dragging === tr) return;
      const rect = tr.getBoundingClientRect();
      const apresMilieu = e.clientY > rect.top + rect.height / 2;
      body.insertBefore(dragging, apresMilieu ? tr.nextSibling : tr);
    });
  });
}

document.getElementById("form-categorie").addEventListener("submit", async (e) => {
  e.preventDefault();
  const id = document.getElementById("categorie-id").value;
  try {
    if (id) {
      const champNom = document.getElementById("categorie-nom");
      const nomInitial = champNom.dataset.nomInitial || "";
      const nom = champNom.value.trim();
      // RIEN À ÉCRIRE SI LE NOM N'A PAS BOUGÉ : c'est désormais la seule chose
      // que ce formulaire porte, et réenregistrer un nom identique n'est qu'une
      // occasion de plus qu'une erreur réseau fasse échouer une écriture qui
      // n'avait rien à écrire.
      if (!champNom.disabled && nom && nom !== nomInitial) {
        await apiFetch(`/categories/${id}`, {
          method: "PUT",
          body: JSON.stringify({ nom }),
        });
      }
      // DEUX ROUTES, comme le nom et l'objectif l'étaient : le drapeau
      // n'appartient pas au même geste que le renommage, et le passer dans
      // `CategorieUpdate` l'aurait réécrit chaque fois qu'on ouvre la ligne
      // pour corriger une faute de frappe. Envoyé SEULEMENT s'il a changé.
      const avant = state.categories.find((c) => c.id === Number(id));
      const entree = document.getElementById("categorie-entree").checked;
      if (entree !== !!(avant && avant.est_entree)) {
        await apiFetch(`/categories/${id}/entree`, {
          method: "PUT",
          body: JSON.stringify({ est_entree: entree }),
        });
      }
      // LES MOTS-CLÉS, SEULEMENT S'ILS ONT BOUGÉ : une catégorie qui garde les livrés ne doit pas
      // se retrouver avec une liste « à soi » parce qu'on a corrigé son nom.
      if (!motsClesCategorieLivres) {
        const mots = (motsClesSaisis("categorie-mots-cles").mots || []);
        await apiFetch(`/categories/${id}/mots-cles`, {
          method: "PUT",
          body: JSON.stringify({ mots_cles: mots }),
        });
      }
      showMessage(t("Catégorie modifiée"), "success");
    } else {
      const nomInput = document.getElementById("categorie-nom");
      await apiFetch("/categories", {
        method: "POST",
        body: JSON.stringify({ nom: nomInput.value }),
      });
      showMessage(t("Catégorie créée"), "success");
    }
    resetCategorieForm();
    loadCategories();
  } catch (err) {
    showMessage(err.message, "error");
  }
});

document.getElementById("categorie-annuler").addEventListener("click", resetCategorieForm);

/* ---------- Opérations ---------- */

/**
 * Les comptes qu'un menu de saisie peut proposer pour ce type d'opération.
 *
 * LES ÉTEINTS EN SONT ABSENTS (cf. models.Compte.actif, la même règle côté
 * serveur), exactement comme les monnaies éteintes le sont de `monnaiesDuCompte`
 * — c'est ce qui fait qu'éteindre un compte le retire de tous les menus sans
 * toucher à une seule opération.
 *
 * `conserve` RATTRAPE LE SEUL CAS OÙ ÇA NE SUFFIT PAS : rouvrir une opération
 * écrite sur un compte depuis éteint. Sans lui, le menu ne contiendrait pas son
 * compte, le `select` retomberait en silence sur un autre, et enregistrer sans
 * y toucher aurait déplacé l'opération de compte.
 */
function comptesEligibles(type, conserve = null) {
  // Seul un virement interne peut toucher l'épargne et les comptes-titres :
  // sur ces comptes, l'argent n'arrive et ne repart pas autrement (cf.
  // routers/operations._valider_compte_operations_libres).
  const parType =
    type === "virement"
      ? state.comptes
      : state.comptes.filter((c) => !TYPES_COMPTE_HORS_COURANT.has(c.type_nom));
  return parType.filter((c) => c.actif !== false || c.id === conserve);
}

/** Même règle pour les catégories (cf. models.Categorie.active).
 *
 *  UN VIREMENT A UNE CATÉGORIE LUI AUSSI (migration 0090) : celle des virements internes, qui lui
 *  est équivalente. Le menu reste donc ouvert sur un virement, et choisir une autre catégorie le
 *  ramène à son type d'avant (cf. `basculerSelonCategorie`). */
function categoriesEligibles(type, conserve = null) {
  if (!TYPES_CATEGORIE_LIBRE.has(type) && type !== "virement") return [];
  return state.categories.filter((c) => c.active !== false || c.id === conserve);
}

/** LA catégorie des virements internes (migration 0090), reconnue à son drapeau, jamais à son
 *  nom (elle se renomme). null tant que les catégories ne sont pas chargées. */
function categorieVirements() {
  return (state.categories || []).find((c) => c.est_virement) || null;
}

/**
 * LES MÊMES DEUX RÈGLES, POUR LES MENUS QUI NE DÉPENDENT PAS D'UN TYPE
 * D'OPÉRATION : le compte lié à un preset, le compte par défaut d'un import, la
 * cible d'une correspondance, la catégorie d'une ligne d'aperçu. Tous désignent
 * où ira une écriture À VENIR — un élément éteint n'y a donc plus sa place,
 * sauf s'il est déjà celui qui y est posé (`conserve`).
 */
function comptesProposables(conserve = null) {
  return state.comptes.filter((c) => c.actif !== false || c.id === conserve);
}

function categoriesProposables(conserve = null) {
  return state.categories.filter((c) => c.active !== false || c.id === conserve);
}

function compteParId(compteId) {
  return state.comptes.find((c) => c.id === compteId) || null;
}

/**
 * Les monnaies qu'un compte PROPOSE, dans son ordre : la première est celle
 * retenue par défaut.
 *
 * LES ÉTEINTES EN SONT ABSENTES (cf. models.Compte.monnaies_actives, la même
 * règle côté serveur) : c'est ce qui fait qu'éteindre une monnaie la retire de
 * tous les menus de saisie sans toucher à une seule opération.
 *
 * `monnaieConservee` RATTRAPE LE SEUL CAS OÙ ÇA NE SUFFIT PAS : rouvrir une
 * opération déjà écrite dans une monnaie depuis éteinte. Sans elle, le menu ne
 * contiendrait pas sa monnaie, le `select` retomberait silencieusement sur une
 * autre, et enregistrer sans y toucher aurait changé la devise de l'opération.
 * On ne PROPOSE pas cette monnaie — on refuse juste de perdre ce qui est là.
 */
function monnaiesDuCompte(compteId, monnaieConservee = null) {
  const compte = compteParId(compteId);
  if (!compte) return [];
  return compte.monnaies.filter(
    (m) =>
      // DEUX EXTINCTIONS, ET LES DEUX FERMENT CE MENU : celle du LIEN (cette
      // monnaie sur ce compte, migration 0053) et celle de la MONNAIE
      // elle-même (partout, migration 0068). La seconde ne redit pas la
      // première — un compte peut porter une monnaie encore allumée pour lui
      // alors qu'on vient de la ranger pour toute l'application.
      (m.active !== false && monnaieEstActive(m.monnaie_id)) ||
      m.monnaie_id === monnaieConservee
  );
}

/**
 * Une monnaie est-elle encore proposée à la saisie ?
 *
 * INCONNUE VAUT ACTIVE : `state.monnaies` peut ne pas être encore chargé au
 * moment où un formulaire se dessine, et masquer une monnaie qu'on n'a pas su
 * lire serait pire que la proposer — on perdrait le seul menu par lequel
 * l'opération peut s'écrire.
 */
function monnaieEstActive(monnaieId) {
  const monnaie = monnaieParId(monnaieId);
  return !monnaie || monnaie.active !== false;
}

/**
 * Remplit un menu de monnaies avec celles du compte choisi, et affiche son bloc
 * seulement si le choix existe vraiment : sur un compte mono-monnaie il n'y a
 * rien à demander, la monnaie est déduite. Renvoie l'id retenu.
 *
 * `monnaieConservee` GARDE DANS LE MENU UNE MONNAIE ÉTEINTE, quand c'est celle
 * que porte déjà l'opération qu'on rouvre (cf. monnaiesDuCompte). Elle est
 * passée explicitement, jamais devinée de ce qui est sélectionné : le menu se
 * resynchronise AUSSI quand on change de compte, et la monnaie choisie pour le
 * compte précédent n'a aucune raison de survivre au suivant.
 */
function syncSelectMonnaieCompte(
  selectId,
  blocId,
  compteId,
  { forcerAffichage = false, monnaieConservee = null } = {}
) {
  const select = document.getElementById(selectId);
  const monnaies = monnaiesDuCompte(compteId, monnaieConservee);
  const precedente = Number(select.value) || null;
  select.innerHTML = "";
  monnaies.forEach((m) => {
    const opt = document.createElement("option");
    opt.value = m.monnaie_id;
    opt.textContent = `${m.monnaie_nom} (${m.monnaie_symbole})`;
    select.appendChild(opt);
  });
  // « + Créer une monnaie » en tête (cf. ajouterOptionCreer) : la monnaie créée rejoint le compte choisi, seul
  // moyen qu'elle apparaisse dans ce menu (cf. creerMonnaiePourCompte).
  if (choixDeMonnaiePossible() && compteParId(compteId)) {
    ajouterOptionCreer(select, "monnaie", {
      demander: () => creerMonnaiePourCompte(compteId),
      remplir: () => updateOperationMonnaieFields(),
    });
  }
  if (monnaies.some((m) => m.monnaie_id === precedente)) {
    select.value = precedente;
  }
  document.getElementById(blocId).style.display =
    choixDeMonnaiePossible() && (forcerAffichage || monnaies.length > 1) ? "" : "none";
  return Number(select.value) || null;
}

/**
 * Pose sur « Montant à rembourser » la borne de son type, pour que le
 * navigateur la dise avant le serveur (cf. crud.erreur_montant_du) :
 *
 *   - DÉPENSE REMBOURSABLE : au PLUS le montant avancé — on ne peut pas être
 *     remboursé plus qu'on n'a payé ;
 *   - PRÊT REÇU : au MOINS le montant reçu — on rend toujours au moins ce qu'on
 *     a emprunté, et ce qu'il y a au-dessus est l'intérêt du prêt.
 *
 * Les deux bornes sont exactement inverses : c'est tout ce qui sépare les deux
 * types une fois le montant dû saisi.
 */
function majBornesMontantDu() {
  const type = document.getElementById("operation-type").value;
  const champ = document.getElementById("operation-montant-du");
  const montant = parseFloat(document.getElementById("operation-montant").value);
  champ.removeAttribute("max");
  champ.min = 0;
  if (!Number.isFinite(montant)) return;
  if (type === "pret") champ.min = montant;
  else if (type === "remboursable") champ.max = montant;
}

function _refillPreservingSelection(selectEl, fillFn) {
  const previous = selectEl.value;
  fillFn(selectEl);
  if (previous && [...selectEl.options].some((o) => o.value === previous)) {
    selectEl.value = previous;
  }
}

/* ---------- RECONNAÎTRE UNE DÉPENSE PRÉVUE À L'IMPORT ----------
 *
 * CE QUE ÇA CHANGE. Une dépense prévisionnelle sert à voir venir ; encore
 * faut-il qu'elle disparaisse quand la vraie arrive. Sans ce bloc, l'import
 * créait une seconde opération et la même dépense comptait deux fois, jusqu'à
 * ce qu'on pense à supprimer l'ancienne — personne n'y pense.
 *
 * VISIBLE SEULEMENT QUAND IL Y A QUELQUE CHOSE À ATTENDRE : une opération
 * PRÉVISIONNELLE, ou un modèle RÉCURRENT (dont chaque occurrence héritera de la
 * fenêtre, cf. crud._fenetre_heritee). Sur une opération réelle et ponctuelle,
 * le champ n'aurait demandé qu'à être ignoré.
 *
 * LE GROUPE DE MOTS-CLÉS EST CELUI DU NOYAU (`creerEditeurMotsCles`), le même
 * qu'emploient l'import et l'éditeur de règles : une troisième façon de saisir
 * une liste de mots dans la même application aurait été celle de trop.
 */
const GROUPE_MOTS_CLES_RAPPROCHEMENT = "rapprochement-operation";

function rapprochementEstProposable() {
  const type = document.getElementById("operation-type").value;
  // Ni sur un virement (deux écritures liées, qu'on n'écrase pas à moitié) ni
  // sur un règlement (il solde une dette précise, à sa date).
  if (type === "virement" || type === "remboursements" || type === "remboursement_pret") {
    return false;
  }
  const statut = statutOperationSaisi();
  const recurrente = document.getElementById("operation-recurrente").checked;
  return statut === STATUT_PREVISIONNEL || recurrente;
}

function majBlocRapprochement() {
  const bloc = document.getElementById("operation-rapprochement-bloc");
  if (!bloc) return;
  assurerEditeurRapprochement();
  // PLUS DE CASE À COCHER : la reconnaissance est RATTACHÉE À « PRÉVISIONNELLE ».
  // Une prévisionnelle était déjà reconnaissable sans rien cocher (fenêtre NULL =
  // le jour même) ; la case ne faisait que montrer les champs facultatifs, qui
  // paraissent désormais d'eux-mêmes sous la rangée.
  const proposable = rapprochementEstProposable();
  bloc.style.display = proposable ? "" : "none";
  document.getElementById("operation-rapprochement-champs").style.display = proposable ? "" : "none";
}

/** La fenêtre et les mots-clés, prêts à partir au serveur.
 *
 *  HORS PÉRIMÈTRE = ON EFFACE, et non « on ne touche à rien » : une opération
 *  repassée en réelle n'attend plus rien. D'où des `null` et une liste vide
 *  explicites plutôt qu'une clé absente. */
function lireRapprochementFormulaire() {
  const actif = rapprochementEstProposable();
  if (!actif) {
    return {
      rapprochement_debut: null,
      rapprochement_fin: null,
      rapprochement_mots_cles: [],
    };
  }
  const debut = document.getElementById("operation-rapprochement-debut").value || null;
  const fin = document.getElementById("operation-rapprochement-fin").value || null;
  return {
    rapprochement_debut: debut,
    rapprochement_fin: fin,
    rapprochement_mots_cles:
      motsClesSaisis(GROUPE_MOTS_CLES_RAPPROCHEMENT).mots || [],
  };
}

/** Remet le bloc dans l'état décrit par une opération (ou vide, sans argument). */
function remplirRapprochement(op) {
  assurerEditeurRapprochement();
  document.getElementById("operation-rapprochement-debut").value =
    (op && op.rapprochement_debut) || "";
  document.getElementById("operation-rapprochement-fin").value =
    (op && op.rapprochement_fin) || "";
  chargerMotsCles(GROUPE_MOTS_CLES_RAPPROCHEMENT, {
    mots: (op && op.rapprochement_mots_cles) || [],
  });
  majBlocRapprochement();
}

/**
 * Pose l'éditeur de mots-clés et les deux écouteurs du bloc, UNE SEULE FOIS.
 *
 * APPELÉ PARESSEUSEMENT, et non depuis une IIFE en tête de fichier : les
 * mécanismes qu'il emploie (`creerEditeurMotsCles` et sa table `editeursMotsCles`)
 * sont déclarés en `const` PLUS BAS dans app.js. Une IIFE ici les atteignait
 * dans leur zone morte temporelle — et l'exception qui en résultait
 * interrompait l'évaluation du reste du fichier, laissant l'application à
 * moitié initialisée (les menus de statut vides, le premier symptôme visible).
 * Appelé depuis les fonctions du bloc, il ne s'exécute qu'une fois la page
 * chargée, où tout existe.
 */
let editeurRapprochementPose = false;

function assurerEditeurRapprochement() {
  if (editeurRapprochementPose) return;
  const champs = document.getElementById("operation-rapprochement-mots-cles");
  if (!champs) return;
  editeurRapprochementPose = true;
  // Le balisage attendu par l'éditeur du noyau, écrit ici plutôt que dans
  // index.html : il est identique partout, et le recopier une troisième fois
  // dans le HTML aurait fait trois endroits à corriger le jour où il change.
  champs.innerHTML = `
    <div class="import-vocabulaire-champ" data-vocabulaire="mots">
      <div class="import-vocabulaire-entete">
        <div class="import-vocabulaire-saisie">
          <input type="text" spellcheck="false" placeholder="${t("ex. EDF")}" />
          <button type="button" class="import-vocabulaire-ajouter"
                  title="${t("Ajouter ce mot-clé")}"
                  aria-label="${t("Ajouter ce mot-clé")}">+</button>
        </div>
        <details class="import-vocabulaire-actualisation">
          <summary>${t("Retirer")}</summary>
          <div class="import-vocabulaire-menu" data-role="menu"></div>
        </details>
      </div>
      <div class="import-vocabulaire-jetons" data-role="jetons"></div>
    </div>`;
  creerEditeurMotsCles(GROUPE_MOTS_CLES_RAPPROCHEMENT, {
    conteneur: champs,
    libelles: { mots: t("Mots-clés") },
    vide: t("Aucun mot-clé : le compte, le montant et la date suffisent à reconnaître la dépense."),
  });
  // LE STATUT PILOTE DEUX CHOSES : le bloc de reconnaissance, et la case
  // « Récurrente », qui ne s'allume qu'avec « Prévisionnelle » —
  // updateOperationTypeFields fait les deux (il rappelle majBlocRapprochement).
  document
    .getElementById("operation-previsionnelle")
    .addEventListener("change", updateOperationTypeFields);
}

/**
 * Éteint une case de la rangée SANS la retirer de l'écran.
 *
 * LA RÈGLE DE CETTE RANGÉE : une case ne bouge jamais. Elles disparaissaient
 * l'une après l'autre au gré du type et des autres cases — cocher « Amortie »
 * faisait sauter « Récurrente », changer de type faisait sauter « Découpée » —
 * et les voisines se décalaient sous le curseur, si bien qu'on cochait la
 * mauvaise en visant la bonne. Éteinte sur place, une case dit deux choses à la
 * fois : qu'elle existe, et que la question ne se pose pas ici.
 *
 * ELLE EST AUSSI DÉCOCHÉE, toujours : une case cochée mais inerte continuerait
 * d'envoyer sa valeur au serveur, lequel refuserait une combinaison que l'écran
 * ne propose plus (récurrente ET amortie, par exemple).
 */
function eteindreCaseOperation(idBloc, idCase, eteinte) {
  document.getElementById(idBloc).classList.toggle("champ-hors-sujet", eteinte);
  if (eteinte && idCase) document.getElementById(idCase).checked = false;
}

/* « À DÉCLARER » (extension « Impôts », migration 0077) ne vaut que sur UNE ENTRÉE D'ARGENT de
 * type classique : un remboursement reçu, un prêt reçu ou un virement ne sont pas des revenus.
 * Jugé sur le type et la catégorie du formulaire (une catégorie « entrée »), comme le serveur le
 * juge sur le sens final. Une opération découpée entre plusieurs catégories n'est pas proposée :
 * elle n'a pas UNE catégorie dont on puisse dire qu'elle est une entrée.
 *
 * Hors périmètre, la case s'éteint sur place (`.champ-hors-sujet`, comme les voisines) et se
 * décoche : une case cochée mais grisée enverrait au serveur une étiquette qu'il écarterait. */
function operationADeclarerPossible() {
  if (document.getElementById("operation-type").value !== TYPE_DECOUPABLE) return false;
  if (decoupeEstActive()) return false;
  const categorie = state.categories.find(
    (c) => c.id === Number(document.getElementById("operation-categorie").value)
  );
  return !!(categorie && categorie.est_entree);
}

function majADeclarerOperation() {
  const possible = operationADeclarerPossible();
  if (!possible) document.getElementById("operation-a-declarer").checked = false;
  document
    .getElementById("operation-a-declarer-bloc")
    .classList.toggle("champ-hors-sujet", !possible);
}
document.getElementById("operation-categorie").addEventListener("change", majADeclarerOperation);

function updateOperationTypeFields() {
  const type = document.getElementById("operation-type").value;
  const estVirement = type === "virement";
  const estRemboursable = type === "remboursable";
  const estRemboursements = type === "remboursements";
  const estPret = type === "pret";
  const estRemboursementPret = type === "remboursement_pret";
  const estReglement = estRemboursements || estRemboursementPret;
  const enEdition = !!document.getElementById("operation-id").value;

  document.getElementById("operation-compte-bloc").style.display = estVirement ? "none" : "";
  document.getElementById("operation-compte1-bloc").style.display = estVirement ? "" : "none";
  document.getElementById("operation-compte2-bloc").style.display = estVirement ? "" : "none";
  // LA DÉCOUPE REMPLACE LA CATÉGORIE UNIQUE, elle ne s'y ajoute pas : les deux
  // répondent à la même question, et les montrer ensemble aurait laissé croire
  // qu'on peut classer deux fois la même dépense.
  const estDecoupable = type === TYPE_DECOUPABLE;
  // Décochée dès qu'elle cesse d'être proposée : une case cochée mais invisible
  // continuerait d'envoyer des parts que le serveur refuserait pour ce type.
  eteindreCaseOperation("operation-decoupee-bloc", "operation-decoupee", !estDecoupable);
  const decoupee = decoupeEstActive();
  document.getElementById("operation-decoupe-bloc").style.display = decoupee ? "" : "none";
  // UN VIREMENT GARDE LE MENU DES CATÉGORIES (migration 0090) : il y porte « Virements internes »,
  // et en choisir une autre le ramène à une opération ordinaire (cf. basculerSelonCategorie).
  document.getElementById("operation-categorie-bloc").style.display =
    (TYPES_CATEGORIE_LIBRE.has(type) || estVirement) && !decoupee ? "" : "none";
  // Un règlement et un prêt reçu sont toujours réels : ils décrivent de l'argent
  // qui a bougé. La case s'éteint (et se décoche) plutôt que de disparaître.
  eteindreCaseOperation(
    "operation-statut-bloc",
    "operation-previsionnelle",
    estReglement || estPret
  );

  // Récurrence : pas de sens pour un virement (paire d'écritures liées, CRUD
  // séparé) ni pour un règlement (solde une dette précise, pas périodique).
  // Une occurrence déjà générée par une récurrence (cf. fillOperationForm)
  // n'est elle-même jamais éditable comme récurrence : seul le modèle d'origine l'est.
  const estRecurrenceEligible = !estVirement && !estReglement;
  const estRecurrente = document.getElementById("operation-recurrente").checked;
  const estAmortie = document.getElementById("operation-amorti").checked;
  const recurrenteBloc = document.getElementById("operation-recurrente-bloc");
  const recurrenceChampsBloc = document.getElementById("operation-recurrence-champs-bloc");
  const recurrenceInfo = document.getElementById("operation-recurrence-info");
  // LES DEUX S'EXCLUENT, ET AUCUNE NE DISPARAÎT POUR AUTANT. Le serveur refuse
  // la combinaison (cf. schemas.OperationBase) : une récurrence recopierait les
  // mêmes mois de destination sur chacune de ses occurrences. Mais escamoter
  // l'une quand on coche l'autre laissait croire qu'elle n'existe pas sur ce
  // type d'opération, alors qu'il suffit de décocher sa voisine — et la rangée
  // se décalait sous le curseur au passage. Éteinte, elle dit « pas les deux ».
  // RÉCURRENTE NE S'ALLUME QU'AVEC PRÉVISIONNELLE : la reconnaissance à l'import
  // est rattachée au statut prévisionnel, et une récurrence est une suite de
  // dépenses attendues. SAUF SUR UN MODÈLE RÉCURRENT QU'ON MODIFIE : le décocher de
  // « Prévisionnelle », c'est dire « ce mois-ci est payé », et le serveur dédouble
  // alors le modèle — le passé réel d'un côté, la récurrence qui continue de l'autre
  // (cf. crud.scinder_modele_recurrent). Éteindre la case aurait arrêté la récurrence.
  const sansPrevision =
    statutOperationSaisi() !== STATUT_PREVISIONNEL && !operationEditionModeleRecurrent;
  const recurrenceEteinte =
    !estRecurrenceEligible || operationEditionEstOccurrenceGeneree || estAmortie || sansPrevision;
  eteindreCaseOperation("operation-recurrente-bloc", "operation-recurrente", recurrenceEteinte);
  recurrenceInfo.style.display =
    estRecurrenceEligible && operationEditionEstOccurrenceGeneree ? "" : "none";
  recurrenceChampsBloc.style.display = !recurrenceEteinte && estRecurrente ? "" : "none";

  // Amortissement : même éligibilité que la récurrence -- un virement ne pèse
  // sur aucun total de période (il déplace de l'argent entre mes comptes), et
  // un règlement solde une dette précise, à sa date. Exclusif de la récurrence,
  // qui recopierait les mêmes mois de destination sur chaque occurrence (le
  // serveur refuse d'ailleurs la combinaison, cf. schemas.OperationBase) : les
  // deux cases ne s'affichent donc jamais cochables en même temps.
  const estAmortissementEligible =
    estRecurrenceEligible && !operationEditionEstOccurrenceGeneree && !estRecurrente;
  eteindreCaseOperation("operation-amorti-bloc", "operation-amorti", !estAmortissementEligible);
  // RELU APRÈS l'extinction : la case vient peut-être d'être décochée, et le
  // bloc des mois aurait survécu un rendu de plus à la case qui le commande.
  const amortieRetenue = document.getElementById("operation-amorti").checked;
  document.getElementById("operation-amortissement-champs-bloc").style.display =
    amortieRetenue ? "" : "none";

  // LES DEUX TYPES REMBOURSABLES portent ces deux champs, et non plus la seule
  // dépense remboursable : un prêt qui se rend avec des intérêts a lui aussi un
  // montant dû distinct de son montant. Ce qui change entre eux, c'est la BORNE
  // — plafond d'un côté, plancher de l'autre (cf. crud.erreur_montant_du) —,
  // posée ici sur le champ pour que le navigateur la dise avant le serveur.
  const porteUneDette = TYPES_REMBOURSABLES.has(type);
  document.getElementById("operation-montant-du-bloc").style.display = porteUneDette ? "" : "none";
  document.getElementById("operation-montant-a-rembourser-bloc").style.display =
    porteUneDette && enEdition ? "" : "none";
  majBornesMontantDu();
  // Après la récurrence et le statut, dont il dépend tous les deux.
  majBlocRapprochement();
  // « IMPRÉVUE » N'A DE SENS QUE SUR UNE DÉPENSE (extension « Analyse de
  // budget »). Un virement déplace son propre argent, un règlement solde une
  // dette déjà connue, un prêt reçu fait entrer de l'argent : aucun des trois
  // n'est une dépense qu'on aurait pu ne pas voir venir. Le bloc reste par
  // ailleurs masqué tant que l'extension est éteinte — c'est elle qui le montre
  // (cf. index.html, data-extension-greffe), et ce style en ligne ne doit donc
  // pas le rallumer de force.
  const blocImprevue = document.getElementById("operation-imprevue-bloc");
  const imprevuePossible = TYPES_CATEGORIE_LIBRE.has(type);
  if (!imprevuePossible) document.getElementById("operation-imprevue").checked = false;
  blocImprevue.classList.toggle("champ-hors-sujet", !imprevuePossible);
  majADeclarerOperation();
  document.getElementById("operation-remboursements-bloc").style.display = estReglement ? "" : "none";
  document.getElementById("operation-remboursements-titre").textContent = estRemboursementPret
    ? t("Prêts réglés")
    : t("Opérations remboursées");

  // Sur cette page, le montant d'un règlement est PILOTÉ par la checklist
  // (somme des liens, cf. recalculerMontantRemboursement) : cocher une cible
  // règle la totalité de son reste dû et incrémente le total d'autant —
  // contrairement à l'import, où le montant vient du relevé bancaire et est fixe.
  const montantField = document.getElementById("operation-montant");
  montantField.readOnly = estReglement;
  montantField.disabled = estReglement;

  // CE QUE LE MENU PORTE DÉJÀ RESTE PROPOSÉ, même éteint : c'est l'opération
  // qu'on est en train de rouvrir (cf. comptesEligibles).
  const valeurDe = (el) => Number(el.value) || null;
  // Chaque liste commence par « + Créer un compte » / « + Créer une catégorie » (cf. ajouterOptionCreer).
  const remplirComptes = (id) =>
    _refillPreservingSelection(document.getElementById(id), (el) => {
      fillComptesSelect(el, comptesEligibles(type, valeurDe(el)));
      ajouterOptionCreer(el, "compte");
    });
  if (estVirement) {
    remplirComptes("operation-compte1");
    remplirComptes("operation-compte2");
    // Sa catégorie est imposée : celle des virements internes, toujours en vue dans le menu.
    const selectCategorie = document.getElementById("operation-categorie");
    fillCategoriesSelect(selectCategorie, categoriesEligibles(type));
    const vi = categorieVirements();
    if (vi) selectCategorie.value = String(vi.id);
  } else {
    remplirComptes("operation-compte");
    if (TYPES_CATEGORIE_LIBRE.has(type)) {
      _refillPreservingSelection(document.getElementById("operation-categorie"), (el) => {
        fillCategoriesSelect(el, categoriesEligibles(type, valeurDe(el)));
        ajouterOptionCreer(el, "categorie");
      });
    }
  }

  updateOperationMonnaieFields();

  // L'avertissement « montants figés » se pose sur les DEUX types
  // remboursables (cf. fillOperationForm) : il se retire donc des deux aussi.
  if (!TYPES_REMBOURSABLES.has(type)) {
    document.getElementById("operation-rembourse-info").style.display = "none";
  }
  if (estReglement) {
    const id = Number(document.getElementById("operation-id").value) || null;
    // BASCULE DE PRÉVISUALISATION : cliquer cet onglet en éditant une opération
    // d'un AUTRE type (ou un virement) ne fait que proposer une conversion —
    // la checklist est vide puisque rien n'est encore lié, et ça n'a rien à
    // dire du montant déjà saisi pour l'autre type. Sans ce garde-fou,
    // recalculerMontantRemboursement() écrasait silencieusement #operation-
    // montant à 0.00, sans jamais le restaurer en revenant sur l'onglet
    // d'origine (cf. bug rapporté). Une vraie interaction avec la checklist
    // (case cochée) continue de recalculer via ses propres listeners.
    const enEditionExistante = enEdition || virementEnEdition != null;
    const basculeSansConversion =
      enEditionExistante && operationEditionTypeOriginal !== type;
    populateRemboursementsChecklist({}, id, type, {
      ajusterMontant: !basculeSansConversion,
    });
  }

  syncMontantDuSiAuto();
}

/**
 * Monnaies du formulaire d'opération.
 *
 * Une opération ordinaire n'affiche sa monnaie que si son compte en porte
 * plusieurs — sinon elle est déduite, et un menu à une seule entrée ne ferait
 * qu'encombrer.
 *
 * Un virement porte toujours deux monnaies et deux montants (ce qui part, ce
 * qui arrive) : c'est ainsi qu'on vire 100 € et qu'on en reçoit 108 $ sans que
 * l'app connaisse le moindre taux de change. Tant que les deux monnaies sont
 * identiques — le cas courant — le second montant est masqué et suit le
 * premier.
 */
function updateOperationMonnaieFields({ monnaie = null, monnaieRecue = null } = {}) {
  // `monnaie` / `monnaieRecue` : les devises de l'opération QU'ON ROUVRE, quand
  // on en rouvre une. Elles sont gardées dans les menus même éteintes, sans quoi
  // le `select` retomberait en silence sur une autre et enregistrer sans y
  // toucher changerait la devise de l'opération (cf. monnaiesDuCompte). Les
  // écouteurs de changement de compte, eux, appellent sans rien : à ce
  // moment-là il n'y a plus rien à conserver.
  const type = document.getElementById("operation-type").value;
  const estVirement = type === "virement";

  if (!estVirement) {
    document.getElementById("operation-montant-label").textContent = t("Montant");
    document.getElementById("operation-montant-recu-bloc").style.display = "none";
    document.getElementById("operation-monnaie-recue-bloc").style.display = "none";
    document.getElementById("operation-monnaie-label").textContent = t("Monnaie");
    syncSelectMonnaieCompte(
      "operation-monnaie",
      "operation-monnaie-bloc",
      Number(document.getElementById("operation-compte").value),
      { monnaieConservee: monnaie }
    );
    return;
  }

  const compteSourceId = Number(document.getElementById("operation-compte1").value);
  const compteDestinationId = Number(document.getElementById("operation-compte2").value);
  // Le bloc « Monnaie reçue » est masqué tant que l'opération n'est pas un
  // virement : s'il l'est encore, on VIENT de basculer vers ce type.
  const vientDeBasculer =
    document.getElementById("operation-monnaie-recue-bloc").style.display === "none";
  // Sur un virement, le menu est toujours affiché même mono-monnaie : il
  // nomme explicitement ce qui part et ce qui arrive, ce dont on a besoin dès
  // que les deux comptes ne partagent pas la même monnaie.
  const monnaieSource = syncSelectMonnaieCompte(
    "operation-monnaie",
    "operation-monnaie-bloc",
    compteSourceId,
    { forcerAffichage: true, monnaieConservee: monnaie }
  );
  const monnaieDestination = syncSelectMonnaieCompte(
    "operation-monnaie-recue",
    "operation-monnaie-recue-bloc",
    compteDestinationId,
    { forcerAffichage: true, monnaieConservee: monnaieRecue }
  );
  // PAR DÉFAUT, LA MONNAIE D'EN FACE EST CELLE DE L'ÉMETTEUR (virement sans
  // change, le cas ordinaire), tant que le compte récepteur la porte. Seulement
  // à la bascule : ensuite, c'est le choix de l'utilisateur qui prime.
  const selectRecue = document.getElementById("operation-monnaie-recue");
  if (
    vientDeBasculer &&
    monnaieRecue == null &&
    monnaieSource != null &&
    [...selectRecue.options].some((o) => Number(o.value) === monnaieSource)
  ) {
    selectRecue.value = String(monnaieSource);
  }

  const memeMonnaie = monnaieSource === (Number(selectRecue.value) || null);
  document.getElementById("operation-monnaie-label").textContent = t("Monnaie envoyée");
  document.getElementById("operation-montant-label").textContent = memeMonnaie
    ? t("Montant")
    : t("Montant envoyé");
  document.getElementById("operation-montant-recu-bloc").style.display = memeMonnaie ? "none" : "";
  if (memeMonnaie) {
    document.getElementById("operation-montant-recu").value = "";
  }
}

// Changer de compte change les monnaies possibles : les menus doivent suivre.
// La flèche est nécessaire : passée directement, la fonction recevrait l'objet
// Event en premier argument, et lirait ses champs comme des monnaies à
// conserver.
["operation-compte", "operation-compte1", "operation-compte2"].forEach((id) => {
  document.getElementById(id).addEventListener("change", () => updateOperationMonnaieFields());
});
// Changer UNE des deux monnaies d'un virement resynchronise les DEUX menus : on
// leur repasse donc ce qui y est sélectionné, sans quoi une monnaie éteinte
// portée par l'autre jambe tomberait du menu au passage — et enregistrer sans y
// toucher aurait changé sa devise.
["operation-monnaie", "operation-monnaie-recue"].forEach((id) => {
  document.getElementById(id).addEventListener("change", () =>
    updateOperationMonnaieFields({
      monnaie: Number(document.getElementById("operation-monnaie").value) || null,
      monnaieRecue: Number(document.getElementById("operation-monnaie-recue").value) || null,
    })
  );
});

function setOperationType(type) {
  document.getElementById("operation-type").value = type;
  document.querySelectorAll("#operation-type-boutons button").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.type === type);
  });
  updateOperationTypeFields();
}

/* ---------- LA CATÉGORIE DES VIREMENTS INTERNES DANS LE FORMULAIRE (migration 0090) ----------
 *
 * La catégorie « Virements internes » et le type « virement » sont une seule et même chose. La
 * choisir dans le menu des catégories fait de l'opération un virement, presque sans bruit : les
 * champs du virement (compte source, compte destination) paraissent à la place du compte. Choisir
 * une autre catégorie sur un virement, ou un autre type, la ramène à ce qu'elle était — AVEC LA
 * CATÉGORIE QU'ELLE PORTAIT, gardée dans `operationMemoireCategorie` jusqu'à ce qu'on enregistre
 * ou qu'on ferme le formulaire (resetOperationForm l'oublie).
 *
 * L'ENREGISTREMENT TRANSFORME SUR PLACE : une opération existante qui devient un virement part
 * avec `operation_id` (POST /virements), un virement qui redevient une opération part vers
 * POST /virements/{id}/operation. Les deux formes ne coexistent jamais en base. */
let operationMemoireCategorie = null;
// La dernière catégorie ORDINAIRE choisie dans le menu : c'est elle que la mémoire retient au
// moment où l'on passe au virement par le menu lui-même (sa valeur vient alors d'être remplacée).
let operationDerniereCategorie = null;

function reporterCompte(depuis, vers) {
  const source = document.getElementById(depuis);
  const cible = document.getElementById(vers);
  if (source.value && [...cible.options].some((o) => o.value === source.value)) {
    cible.value = source.value;
    updateOperationMonnaieFields();
  }
}

function changerTypeOperation(nouveau, { categorieId = undefined } = {}) {
  const avant = document.getElementById("operation-type").value;
  const select = document.getElementById("operation-categorie");
  if (nouveau === "virement" && avant !== "virement" && categorieId === undefined) {
    operationMemoireCategorie = { type: avant, categorieId: Number(select.value) || null };
  }
  const memoire = operationMemoireCategorie;
  setOperationType(nouveau);
  if (nouveau === "virement" && avant !== "virement") {
    reporterCompte("operation-compte", "operation-compte1");
  }
  if (avant === "virement" && nouveau !== "virement") {
    reporterCompte("operation-compte1", "operation-compte");
    const vi = categorieVirements();
    const rendue =
      categorieId !== undefined ? categorieId : memoire && memoire.categorieId;
    if (TYPES_CATEGORIE_LIBRE.has(nouveau)) {
      if (rendue && [...select.options].some((o) => Number(o.value) === rendue)) {
        select.value = String(rendue);
      } else if (vi && Number(select.value) === vi.id) {
        select.selectedIndex = [...select.options].findIndex((o) => Number(o.value) !== vi.id);
      }
    }
    operationMemoireCategorie = null;
    majADeclarerOperation();
  }
}

function basculerSelonCategorie() {
  const vi = categorieVirements();
  const select = document.getElementById("operation-categorie");
  const choisie = Number(select.value) || null;
  const type = document.getElementById("operation-type").value;
  if (!vi || !choisie) return;
  if (choisie === vi.id) {
    if (type === "virement") return;
    operationMemoireCategorie = { type, categorieId: operationDerniereCategorie };
    changerTypeOperation("virement", { categorieId: null });
    return;
  }
  operationDerniereCategorie = choisie;
  if (type === "virement") {
    const retour =
      operationMemoireCategorie && TYPES_CATEGORIE_LIBRE.has(operationMemoireCategorie.type)
        ? operationMemoireCategorie.type
        : "classique";
    changerTypeOperation(retour, { categorieId: choisie });
  }
}
document.getElementById("operation-categorie").addEventListener("change", basculerSelonCategorie);

document.querySelectorAll("#operation-type-boutons button").forEach((btn) => {
  btn.addEventListener("click", () => changerTypeOperation(btn.dataset.type));
});

// Tant que l'utilisateur n'a pas modifié "Montant à rembourser" à la main,
// il suit en direct la valeur de "Montant" pour une dépense remboursable
// nouvellement créée (comportement par défaut : tout est à rembourser).
let montantDuAutoSync = true;

// True si l'opération en cours d'édition est une occurrence générée par une
// récurrence (Operation.recurrence_parent_id non null) plutôt qu'un modèle :
// sa récurrence n'est alors jamais éditable depuis ce formulaire (cf.
// updateOperationTypeFields), seul le modèle d'origine l'est.
let operationEditionEstOccurrenceGeneree = false;

// Le type_code RÉEL de l'opération en cours d'édition (ou "virement" pour un
// virement, ou null en création) — distinct de l'onglet de type actuellement
// PRÉVISUALISÉ dans le formulaire (cf. updateOperationTypeFields). Cliquer
// l'onglet "Remboursement reçu" en éditant une opération classique doit
// pouvoir montrer la checklist sans toucher au montant de l'opération
// classique ; comparer ce champ au type prévisualisé est ce qui distingue les
// deux cas.
let operationEditionTypeOriginal = null;

// UN MODÈLE RÉCURRENT EN ÉDITION (cf. updateOperationTypeFields) : sa case
// « Récurrente » reste allumée même sans « Prévisionnelle ».
let operationEditionModeleRecurrent = false;

document.getElementById("operation-recurrente").addEventListener("change", () => {
  updateOperationTypeFields();
});

document.getElementById("operation-recurrence-infini").addEventListener("change", (e) => {
  const finBloc = document.getElementById("operation-recurrence-fin-bloc");
  finBloc.style.display = e.target.checked ? "none" : "";
  if (e.target.checked) document.getElementById("operation-recurrence-fin").value = "";
});

/**
 * CHAMP « MOIS + ANNÉE » : deux listes déroulantes valant un « AAAA-MM ».
 *
 * Remplace <input type="month">, dont la saisie clavier segment par segment
 * produit silencieusement une valeur VIDE tant que les deux segments ne sont
 * pas complets — le reste du code lisait alors « pas encore renseigné » sur un
 * champ que l'utilisateur croyait rempli. Deux listes ne peuvent rendre qu'un
 * mois entier ou rien du tout.
 *
 * PLAGE D'ANNÉES : centrée sur l'année en cours, élargie à ce que la valeur
 * déjà posée impose. Une opération importée il y a trois ans doit pouvoir
 * rouvrir son propre amortissement sans que la liste ait à deviner jusqu'où
 * remonter, d'où `garantirAnnee` — appelée par `set` avant de choisir.
 *
 * `onChange` est notifié seulement quand la valeur COMPLÈTE change : choisir un
 * mois sans avoir encore choisi l'année ne déclenche aucune déduction, elle
 * partirait d'un couple à moitié dit.
 */
const AMORTISSEMENT_ANNEES_AVANT = 10;
const AMORTISSEMENT_ANNEES_APRES = 15;

function creerChampMoisAnnee(conteneur, onChange) {
  const selectMois = document.createElement("select");
  const selectAnnee = document.createElement("select");
  selectMois.className = "champ-mois";
  selectAnnee.className = "champ-annee";

  function ajouterPlaceholder(select, libelle) {
    const option = document.createElement("option");
    option.value = "";
    option.textContent = libelle;
    select.appendChild(option);
  }

  ajouterPlaceholder(selectMois, t("Mois"));
  MOIS_FR.forEach((nom, i) => {
    const option = document.createElement("option");
    option.value = String(i + 1);
    option.textContent = capitalizeFirst(nom);
    selectMois.appendChild(option);
  });

  ajouterPlaceholder(selectAnnee, t("Année"));
  const anneeCourante = new Date().getFullYear();
  const anneesConnues = new Set();

  // Les années restent triées croissantes quelle que soit l'ordre d'insertion :
  // une année ajoutée après coup (valeur ancienne rechargée) doit se retrouver
  // à sa place dans la liste, pas à la fin.
  function garantirAnnee(annee) {
    if (!annee || anneesConnues.has(annee)) return;
    anneesConnues.add(annee);
    const option = document.createElement("option");
    option.value = String(annee);
    option.textContent = String(annee);
    const suivante = [...selectAnnee.options].find(
      (o) => o.value !== "" && Number(o.value) > annee
    );
    selectAnnee.insertBefore(option, suivante || null);
  }

  for (
    let annee = anneeCourante - AMORTISSEMENT_ANNEES_AVANT;
    annee <= anneeCourante + AMORTISSEMENT_ANNEES_APRES;
    annee += 1
  ) {
    garantirAnnee(annee);
  }

  conteneur.append(selectMois, selectAnnee);

  function get() {
    if (!selectMois.value || !selectAnnee.value) return "";
    return `${selectAnnee.value.padStart(4, "0")}-${selectMois.value.padStart(2, "0")}`;
  }

  function set(valeur) {
    if (!valeur) {
      selectMois.value = "";
      selectAnnee.value = "";
      return;
    }
    const [annee, mois] = valeur.split("-").map(Number);
    garantirAnnee(annee);
    selectAnnee.value = String(annee);
    selectMois.value = String(mois);
  }

  let derniereValeur = "";
  [selectMois, selectAnnee].forEach((select) => {
    select.addEventListener("change", () => {
      const valeur = get();
      // Un couple encore incomplet ne dit rien : ni déduction, ni notification.
      if (valeur === derniereValeur) return;
      derniereValeur = valeur;
      if (valeur && onChange) onChange();
    });
  });

  return {
    get value() {
      return get();
    },
    set value(valeur) {
      set(valeur);
      derniereValeur = get();
    },
    selectMois,
    selectAnnee,
  };
}

/**
 * AMORTISSEMENT : TROIS CHAMPS POUR DEUX DEGRÉS DE LIBERTÉ.
 *
 * Premier mois, dernier mois et nombre de mois disent la même chose de trois
 * façons : deux d'entre eux suffisent toujours à déduire le troisième. Les
 * trois restent pourtant saisissables, parce que la donnée dont l'utilisateur
 * dispose change d'une dépense à l'autre — « je l'étale sur 12 mois à partir de
 * janvier » et « je l'étale de janvier à décembre » sont la même intention, et
 * aucune des deux ne doit obliger à faire le calcul de tête.
 *
 * QUI CÈDE, ET SELON QUOI. Trois règles, et elles seules :
 *
 *  1. UNE CASE ENCORE VIDE se déduit des deux autres dès qu'elles sont
 *     remplies. Ni le champ qu'on vient de toucher, ni celui qui était déjà là
 *     ne bougent : la case vide est la seule qui n'exprime aucune intention.
 *  2. LE NOMBRE DE MOIS MODIFIÉ déplace le DERNIER mois — le premier est
 *     l'ancre naturelle d'un étalement (« à partir de janvier, sur 12 mois »).
 *  3. UNE BORNE MODIFIÉE (premier ou dernier mois) change le NOMBRE DE MOIS,
 *     jamais l'autre borne. Corriger le dernier mois ne doit pas déplacer le
 *     premier : ce serait répondre à côté du geste, et une valeur qu'on croyait
 *     acquise changerait dans le dos de l'utilisateur.
 *
 * Rien n'est jamais remis à zéro : une case remplie ne se vide pas toute seule.
 *
 * SEUL CAS OÙ UNE BORNE EN DÉPLACE UNE AUTRE : quand la borne saisie passe de
 * l'autre côté de sa voisine (dernier mois AVANT le premier). Le nombre de mois
 * y serait nul ou négatif, ce qui n'existe pas ; l'amortissement se replie donc
 * sur ce seul mois. C'est la lecture la plus proche du geste — la borne qu'on
 * vient de poser est respectée — et l'état reste toujours valide.
 *
 * Seules deux colonnes sont envoyées au serveur (les deux bornes) : le nombre
 * de mois n'existe qu'ici, cf. models.Operation.amortissement_nb_mois.
 */
function _indexDepuisMois(valeur) {
  if (!valeur) return null;
  const [annee, mois] = valeur.split("-").map(Number);
  if (!annee || !mois) return null;
  return annee * 12 + mois;
}

function _moisDepuisIndex(index) {
  const annee = Math.floor((index - 1) / 12);
  const mois = index - annee * 12;
  return `${String(annee).padStart(4, "0")}-${String(mois).padStart(2, "0")}`;
}

// Les trois champs du formulaire d'opération. Le formulaire d'import a les
// siens, construits à la volée : completerAmortissement les reçoit en argument
// pour que la règle de déduction soit LA MÊME aux deux endroits — deux copies
// finiraient par diverger, et c'est exactement le genre de règle dont on ne
// remarque la divergence qu'une fois la donnée fausse enregistrée.
function _champsAmortissement() {
  return {
    debutEl: champsMoisAmortissement.debut,
    finEl: champsMoisAmortissement.fin,
    nbEl: document.getElementById("operation-amortissement-nb-mois"),
  };
}

function completerAmortissement(champModifie, champs = null) {
  const { debutEl, finEl, nbEl } = champs || _champsAmortissement();
  const debut = _indexDepuisMois(debutEl.value);
  const fin = _indexDepuisMois(finEl.value);
  let nb = parseInt(nbEl.value, 10);
  if (!Number.isInteger(nb) || nb < 1) nb = null;

  // Une case encore vide se déduit des deux autres, sans toucher à aucune des
  // deux (règle 1). Testé AVANT les règles d'arbitrage : tant qu'un champ
  // manque, il n'y a rien à arbitrer, seulement à compléter.
  if (debut === null && fin !== null && nb !== null) {
    debutEl.value = _moisDepuisIndex(fin - nb + 1);
    return;
  }
  if (fin === null && debut !== null && nb !== null) {
    finEl.value = _moisDepuisIndex(debut + nb - 1);
    return;
  }
  if (nb === null && debut !== null && fin !== null) {
    nbEl.value = Math.max(1, fin - debut + 1);
    return;
  }

  // Deux cases seulement : rien à déduire, la troisième reste à saisir.
  if (debut === null || fin === null || nb === null) return;

  // Tout est rempli : c'est le champ modifié qui commande.
  if (champModifie === "nb") {
    // Règle 2 : la durée déplace la borne de FIN, le premier mois est l'ancre.
    finEl.value = _moisDepuisIndex(debut + nb - 1);
    return;
  }
  // Règle 3 : une borne déplacée change la DURÉE, jamais l'autre borne — sauf
  // à passer de l'autre côté d'elle, où l'amortissement se replie sur le seul
  // mois qu'on vient de désigner (cf. docstring).
  if (fin < debut) {
    if (champModifie === "debut") finEl.value = _moisDepuisIndex(debut);
    else debutEl.value = _moisDepuisIndex(fin);
    nbEl.value = 1;
    return;
  }
  nbEl.value = fin - debut + 1;
}

document.getElementById("operation-amorti").addEventListener("change", (e) => {
  if (e.target.checked) {
    // Amorcer sur le mois de l'opération : c'est le point de départ dans la
    // très grande majorité des cas (« à partir de maintenant, sur N mois »), et
    // il suffit alors d'une seule des deux autres cases. Les laisser vides
    // toutes les trois aurait fait commencer par une saisie qu'on connaît déjà.
    const { debutEl, finEl, nbEl } = _champsAmortissement();
    const dateOperation = document.getElementById("operation-date").value;
    if (dateOperation && !debutEl.value && !finEl.value && !nbEl.value) {
      debutEl.value = dateOperation.slice(0, 7);
    }
  }
  updateOperationTypeFields();
});

// Construits ici plutôt que déclarés dans index.html : les douze mois viennent
// d'Intl (langue de l'interface) et la plage d'années se calcule. Le conteneur
// garde l'id historique, tout le reste du fichier continue de le désigner par
// `champsMoisAmortissement.debut` / `.fin` comme s'il s'agissait d'un champ.
const champsMoisAmortissement = {
  debut: creerChampMoisAnnee(
    document.getElementById("operation-amortissement-debut"),
    () => completerAmortissement("debut")
  ),
  fin: creerChampMoisAnnee(
    document.getElementById("operation-amortissement-fin"),
    () => completerAmortissement("fin")
  ),
};
document.getElementById("operation-amortissement-nb-mois").addEventListener("input", () => {
  const nbEl = document.getElementById("operation-amortissement-nb-mois");
  // Un amortissement sur zéro mois n'existe pas ; sur un seul, si (la dépense
  // est alors simplement comptée dans un autre mois que celui où elle a eu lieu).
  if (nbEl.value !== "" && Number(nbEl.value) < 1) nbEl.value = "1";
  completerAmortissement("nb");
});

// Le montant dû recopie le montant tant que l'utilisateur ne l'a pas touché.
// Vrai des deux côtés, et c'est à chaque fois le cas le plus courant : une
// dépense qu'on se fera intégralement rendre, un prêt sans intérêts.
function syncMontantDuSiAuto() {
  const type = document.getElementById("operation-type").value;
  const enEdition = !!document.getElementById("operation-id").value;
  if (montantDuAutoSync && TYPES_REMBOURSABLES.has(type) && !enEdition) {
    document.getElementById("operation-montant-du").value =
      document.getElementById("operation-montant").value || "0";
  }
}

document.getElementById("operation-montant").addEventListener("input", () => {
  syncMontantDuSiAuto();
  // La borne du montant dû se lit sur le montant : elle bouge avec lui.
  majBornesMontantDu();
});
document.getElementById("operation-montant-du").addEventListener("input", () => {
  montantDuAutoSync = false;
});

/* ---------- Découpe d'une opération ---------- */
/*
 * UNE OPÉRATION, PLUSIEURS CATÉGORIES. Un plein de courses à 120 € dont 30 €
 * de produits ménagers reste UNE ligne au relevé et UN mouvement de compte :
 * la découper en deux opérations aurait fait diverger le solde de l'app du
 * relevé bancaire (cf. models.OperationDecoupe).
 *
 * LE TOTAL DES PARTS DOIT VALOIR LE MONTANT, et l'écran le dit pendant la
 * saisie. Le serveur refuse le contraire en 400 ; l'annoncer seulement à
 * l'enregistrement aurait obligé à recompter de tête pour comprendre le refus.
 */

// Réservée au type `classique` : les autres portent une catégorie imposée, un
// montant dû ou une contrepartie, que la découpe ne saurait pas répartir.
const TYPE_DECOUPABLE = "classique";

function decoupeEstActive() {
  return (
    document.getElementById("operation-type").value === TYPE_DECOUPABLE &&
    document.getElementById("operation-decoupee").checked
  );
}

function lignesDecoupe() {
  return [...document.querySelectorAll("#operation-decoupe-parts .decoupe-part")];
}

function lireDecoupes() {
  return lignesDecoupe()
    .map((ligne) => ({
      categorie_id: Number(ligne.querySelector(".decoupe-categorie").value),
      montant: parseFloat(ligne.querySelector(".decoupe-montant").value || "0"),
    }))
    // Une part à zéro ne classe rien : elle vaut une part qu'on n'a pas encore
    // remplie, pas une part vide qu'il faudrait envoyer (le serveur la
    // refuserait, cf. schemas.DecoupeInput).
    .filter((part) => part.categorie_id && part.montant > 0);
}

/**
 * La catégorie que le formulaire porte au moment où l'on découpe : c'est elle que
 * les nouvelles parts proposent d'abord. L'opération avait déjà sa catégorie ;
 * repartir d'une liste vide obligeait à la retaper à chaque part, alors que la
 * découpe commence presque toujours par « une partie reste dans celle-là ».
 */
function categorieDeLOperation() {
  const valeur = Number(document.getElementById("operation-categorie").value);
  return Number.isInteger(valeur) && valeur > 0 ? valeur : null;
}

function ajouterPartDecoupe(categorieId = null, montant = null) {
  const conteneur = document.getElementById("operation-decoupe-parts");
  const ligne = document.createElement("div");
  ligne.className = "decoupe-part";
  ligne.innerHTML = `
    <select class="decoupe-categorie"></select>
    <input type="number" step="0.01" min="0" class="decoupe-montant"
           placeholder="0.00" value="${montant != null ? montant : ""}" />
    <button type="button" class="decoupe-retirer danger"
            title="${escapeHtml(t("Retirer cette part"))}"
            aria-label="${escapeHtml(t("Retirer cette part"))}">&times;</button>
  `;
  conteneur.appendChild(ligne);
  const select = ligne.querySelector(".decoupe-categorie");
  // `categorieId` est celle que la part PORTE DÉJÀ : elle reste dans le menu
  // même éteinte, sans quoi rouvrir une découpe ancienne l'aurait reclassée en
  // silence (cf. comptesEligibles).
  // Une part n'est jamais un virement (migration 0090, le serveur refuse aussi).
  fillCategoriesSelect(
    select,
    categoriesEligibles(TYPE_DECOUPABLE, categorieId).filter((c) => !c.est_virement)
  );
  if (categorieId != null) select.value = categorieId;
  majTotalDecoupe();
}

/**
 * Le compteur du garde-fou : ce qui est réparti, et ce qui reste à placer.
 *
 * Le reste est affiché plutôt que seulement signalé : c'est le nombre qu'on
 * s'apprête à taper dans la part suivante, et le calculer de tête à chaque
 * ligne est exactement le travail que cet écran doit éviter.
 */
function majTotalDecoupe() {
  const total = lireDecoupes().reduce((somme, part) => somme + part.montant, 0);
  const montant = parseFloat(document.getElementById("operation-montant").value || "0");
  const reste = Math.round((montant - total) * 100) / 100;
  const element = document.getElementById("operation-decoupe-total");
  const monnaieId = Number(document.getElementById("operation-monnaie").value) || null;
  element.textContent =
    reste === 0
      ? `${t("Réparti")} : ${formatMontant(total, monnaieId)}`
      : `${t("Réparti")} : ${formatMontant(total, monnaieId)} — ` +
        `${t("reste à placer")} : ${formatMontant(reste, monnaieId)}`;
  element.classList.toggle("erreur", reste !== 0);
}

/**
 * Ce qui empêche d'enregistrer cette découpe, ou null.
 *
 * Les mêmes refus que le serveur (cf. crud.erreur_decoupes), dits ici avec les
 * mots de l'écran. Ce n'est PAS un doublon inutile : sans ce contrôle, la seule
 * façon d'apprendre qu'il manque dix euros serait un message d'erreur après
 * l'enregistrement, sur un formulaire qu'on vient de quitter des yeux.
 */
function erreurDecoupe() {
  if (!decoupeEstActive()) return null;
  const parts = lireDecoupes();
  if (parts.length < 2) {
    return t("Une découpe compte au moins deux parts remplies.");
  }
  const categories = parts.map((part) => part.categorie_id);
  if (new Set(categories).size !== categories.length) {
    return t("Une même catégorie ne peut pas apparaître deux fois dans la découpe.");
  }
  const total = parts.reduce((somme, part) => somme + part.montant, 0);
  const montant = parseFloat(document.getElementById("operation-montant").value || "0");
  if (Math.abs(total - montant) > 0.005) {
    return (
      t("Le total des parts doit valoir le montant de l'opération.") +
      ` (${total.toFixed(2)} / ${montant.toFixed(2)})`
    );
  }
  return null;
}

/**
 * Ce que le formulaire envoie pour la découpe.
 *
 * `[]` et non « rien » quand la case est décochée : sur une modification, c'est
 * ce qui EFFACE les parts d'une opération qui en portait (cf.
 * schemas.OperationUpdate.decoupes, où `null` veut dire « n'y touche pas »).
 * Ne rien envoyer aurait laissé la découpe en place tout en affichant une
 * catégorie unique.
 */
function decoupePayload() {
  if (!decoupeEstActive()) return { decoupes: [] };
  // La catégorie unique part avec : les deux répondent à la même question, et
  // le serveur met de toute façon `categorie_id` à NULL sur une opération
  // découpée.
  return { decoupes: lireDecoupes(), categorie_id: null };
}

function remplirDecoupe(op) {
  const parts = op && op.decoupes ? op.decoupes : [];
  document.getElementById("operation-decoupe-parts").innerHTML = "";
  document.getElementById("operation-decoupee").checked = parts.length > 0;
  parts.forEach((part) => ajouterPartDecoupe(part.categorie_id, part.montant));
  majTotalDecoupe();
}

document.getElementById("operation-decoupee").addEventListener("change", () => {
  // Deux parts d'emblée : une découpe en compte au moins deux, et cocher la
  // case pour se retrouver devant une liste vide obligerait à deviner le geste
  // suivant.
  if (decoupeEstActive() && lignesDecoupe().length === 0) {
    // LUE AVANT updateOperationTypeFields, qui range la catégorie unique.
    const categorie = categorieDeLOperation();
    ajouterPartDecoupe(categorie);
    ajouterPartDecoupe(categorie);
  }
  updateOperationTypeFields();
});

document
  .getElementById("operation-decoupe-ajouter")
  .addEventListener("click", () => ajouterPartDecoupe(categorieDeLOperation()));

// Délégués sur le conteneur : les lignes naissent et meurent au fil de la
// saisie, et poser un écouteur sur chacune les ferait fuir à chaque retrait.
document.getElementById("operation-decoupe-parts").addEventListener("click", (evenement) => {
  const bouton = evenement.target.closest(".decoupe-retirer");
  if (!bouton) return;
  bouton.closest(".decoupe-part").remove();
  majTotalDecoupe();
});
document
  .getElementById("operation-decoupe-parts")
  .addEventListener("input", majTotalDecoupe);
// Le montant de l'opération est l'autre terme de la comparaison : le compteur
// doit suivre quand c'est LUI qui change, pas seulement les parts.
document.getElementById("operation-montant").addEventListener("input", () => {
  if (decoupeEstActive()) majTotalDecoupe();
});


/* ---------- Frais d'une opération ----------
 *
 * CE QU'ILS SONT. Des frais sont DÉJÀ compris dans le montant enregistré :
 * ajoutés à ce qui sort, retranchés de ce qui entre (cf.
 * services/import_bancaire._appliquer_frais, et models.Operation.frais qui les
 * conserve). Le montant reste ce qui a bougé sur le compte ; les frais disent
 * seulement de quoi il est fait.
 *
 * CE QUE LE FORMULAIRE EN FAIT. Il les ressort : le champ « Montant » passe
 * HORS FRAIS et une case « Frais » apparaît à côté, exactement comme dans
 * l'aperçu d'import. Sans cela, un montant de 102 € ne disait plus qu'il
 * contenait 2 € de frais, et corriger l'un des deux était impossible.
 *
 * SEULEMENT QUAND L'OPÉRATION EN PORTE. Une ligne sur cent en a : deux champs
 * de plus sur chaque saisie ordinaire coûteraient plus qu'ils ne rendent. La
 * case apparaît à l'édition d'une opération qui a des frais, et disparaît si on
 * les remet à zéro.
 *
 * SUR UN VIREMENT, ILS NE GRÈVENT QU'UNE JAMBE — celle que leur devise désigne
 * (cf. crud._jambe_des_frais). C'est donc le champ de CETTE jambe-là qui passe
 * hors frais, « Montant envoyé » ou « Montant reçu ».
 */

// L'opération en cours d'édition porte-t-elle des frais, de quel côté, et dans
// quel sens ?
//
//  - `cote` : "envoye" (le champ Montant) ou "recu" (le champ Montant reçu) ;
//  - `sortante` : le montant grevé est-il une SORTIE (frais ajoutés) ou une
//    entrée (frais retranchés). RETENU DE L'AFFICHAGE plutôt que redéduit à
//    l'enregistrement : c'est le sens qui a servi à montrer le montant hors
//    frais, et recomposer avec un autre rendrait un montant qui n'est ni celui
//    d'avant ni celui qu'on voulait.
let operationFrais = { actif: false, cote: "envoye", sortante: true };

/**
 * Le montant tel qu'il sera enregistré, frais compris.
 *
 * MIROIR EXACT de `_grever` côté serveur : des frais font toujours perdre de la
 * valeur — ils s'ajoutent à ce qui part, se retranchent de ce qui arrive.
 */
function montantAvecFrais(horsFrais, frais, sortante) {
  if (!frais) return horsFrais;
  return sortante ? horsFrais + frais : horsFrais - frais;
}

/** L'inverse : ce que le champ doit AFFICHER, frais déduits. */
function montantHorsFrais(montant, frais, sortante) {
  if (!frais) return montant;
  return sortante ? montant - frais : montant + frais;
}

/**
 * Montre (ou cache) les deux champs de frais, et adapte les libellés des
 * montants pour dire lequel est hors frais.
 */
function majChampsFraisOperation() {
  const actif = operationFrais.actif;
  document.getElementById("operation-frais-bloc").style.display = actif ? "" : "none";
  // La devise des frais ne se choisit que s'il y en a deux en jeu : sur un
  // virement mono-monnaie comme sur une opération ordinaire, elle est celle du
  // montant et n'a rien à demander.
  const choixDevise =
    actif &&
    document.getElementById("operation-montant-recu-bloc").style.display !== "none";
  document.getElementById("operation-monnaie-frais-bloc").style.display = choixDevise
    ? ""
    : "none";

  const suffixe = actif ? " (hors frais)" : "";
  const labelMontant = document.getElementById("operation-montant-label");
  // Le libellé de base est posé par updateOperationMonnaieFields : on ne fait
  // qu'y accoler la mention, sans quoi « Montant envoyé » redeviendrait
  // « Montant » dès qu'on affiche les frais.
  const base = labelMontant.textContent.replace(" (hors frais)", "");
  labelMontant.textContent =
    base + (actif && operationFrais.cote === "envoye" ? suffixe : "");
  const blocRecu = document.getElementById("operation-montant-recu-bloc");
  const noeudRecu = blocRecu.firstChild;
  if (noeudRecu && noeudRecu.nodeType === Node.TEXT_NODE) {
    noeudRecu.nodeValue =
      t("Montant reçu") + (actif && operationFrais.cote === "recu" ? suffixe : "");
  }
}

/**
 * Remplit le menu de devise des frais avec les monnaies EN JEU dans
 * l'opération — celle qui part et celle qui arrive, et rien d'autre : des frais
 * dans une troisième devise ne s'appliqueraient à aucun des deux montants, ce
 * que le serveur refuse déjà à l'import.
 */
function remplirMonnaieFraisOperation(monnaieFraisId) {
  const select = document.getElementById("operation-monnaie-frais");
  const ids = [
    Number(document.getElementById("operation-monnaie").value) || null,
    Number(document.getElementById("operation-monnaie-recue").value) || null,
  ].filter((id, i, tous) => id && tous.indexOf(id) === i);
  select.innerHTML = ids
    .map((id) => {
      const monnaie = monnaieParId(id);
      return `<option value="${id}">${escapeHtml(monnaie ? monnaie.nom : `#${id}`)}</option>`;
    })
    .join("");
  if (monnaieFraisId && ids.includes(monnaieFraisId)) select.value = String(monnaieFraisId);
}

/**
 * Prépare le formulaire pour une opération qui porte des frais : la case
 * apparaît, et le montant du côté grevé s'affiche hors frais.
 *
 * `sortante` dit si le montant grevé est une SORTIE (frais ajoutés) ou une
 * entrée (frais retranchés) — c'est ce qui décide du sens de la déduction.
 */
function poserFraisOperation({ frais, monnaieFraisId, cote, sortante, champ }) {
  operationFrais = { actif: Boolean(frais), cote, sortante };
  if (!operationFrais.actif) {
    majChampsFraisOperation();
    return;
  }
  document.getElementById("operation-frais").value = frais;
  remplirMonnaieFraisOperation(monnaieFraisId);
  const element = document.getElementById(champ);
  const montant = parseFloat(element.value);
  if (!isNaN(montant)) {
    element.value = arrondiMontant(montantHorsFrais(montant, frais, sortante));
  }
  majChampsFraisOperation();
}

/** Deux décimales, sans traîner les flottants (102 - 2 = 99.99999999999999). */
function arrondiMontant(valeur) {
  return Math.round(valeur * 100) / 100;
}

/**
 * Ce qu'une opération À UN SEUL COMPTE doit enregistrer : son montant frais
 * compris, et les frais eux-mêmes.
 *
 * Le sens de la recomposition est celui retenu à l'affichage
 * (`operationFrais.sortante`) : les frais s'ajoutent à ce qui part, se
 * retranchent de ce qui entre.
 */
function montantEtFraisOperation() {
  const sortante = operationFrais.sortante;
  const saisi = parseFloat(document.getElementById("operation-montant").value);
  const { frais, monnaie_frais_id: monnaieFrais } = fraisSaisisOperation();
  return {
    montant: arrondiMontant(montantAvecFrais(saisi, frais, sortante)),
    frais,
    // Sur une opération à un seul compte, la devise des frais est forcément
    // celle du montant : le menu n'est même pas proposé.
    monnaie_frais_id: frais
      ? monnaieFrais || Number(document.getElementById("operation-monnaie").value) || null
      : null,
  };
}

/** Ce que le formulaire porte comme frais, ou rien. */
function fraisSaisisOperation() {
  if (!operationFrais.actif) return { frais: null, monnaie_frais_id: null };
  const valeur = parseFloat(document.getElementById("operation-frais").value);
  if (isNaN(valeur) || valeur <= 0) return { frais: null, monnaie_frais_id: null };
  const bloc = document.getElementById("operation-monnaie-frais-bloc");
  const monnaie =
    bloc.style.display === "none"
      ? null
      : Number(document.getElementById("operation-monnaie-frais").value) || null;
  return { frais: valeur, monnaie_frais_id: monnaie };
}

function resetOperationForm() {
  document.getElementById("operation-id").value = "";
  document.getElementById("operation-date").value = "";
  document.getElementById("operation-nature").value = "";
  document.getElementById("operation-montant").value = "";
  document.getElementById("operation-montant-recu").value = "";
  document.getElementById("operation-montant-du").value = "0";
  document.getElementById("operation-montant-a-rembourser").value = "0";
  document.getElementById("operation-montant-a-rembourser").disabled = false;
  // Ces deux-là peuvent avoir été grisés par l'édition d'une dette déjà
  // remboursée (cf. fillOperationForm) : sans ça, elles resteraient
  // inutilisables pour la création suivante.
  document.getElementById("operation-montant").disabled = false;
  document.getElementById("operation-montant-du").disabled = false;
  document.getElementById("operation-rembourse-info").style.display = "none";
  document.getElementById("operation-remboursements-liste").innerHTML = "";
  // Les frais n'existent qu'à l'édition d'une opération qui en porte : une
  // création repart sans la case (cf. § « Frais d'une opération »).
  document.getElementById("operation-frais").value = "";
  operationFrais = { actif: false, cote: "envoye", sortante: true };
  majChampsFraisOperation();
  // Les notes n'existent qu'à l'édition : une création repart sans champ.
  document.getElementById("operation-notes").value = "";
  document.getElementById("operation-notes-bloc").style.display = "none";
  document.getElementById("form-operation-titre").textContent = t("Ajouter une opération");
  document.getElementById("operation-annuler").style.display = "none";
  montantDuAutoSync = true;
  operationEditionEstOccurrenceGeneree = false;
  operationEditionModeleRecurrent = false;
  operationEditionTypeOriginal = null;
  virementEnEdition = null;
  operationMemoireCategorie = null;
  operationDerniereCategorie = null;
  document.getElementById("operation-recurrente").checked = false;
  document.getElementById("operation-frequence").value = "mensuelle";
  document.getElementById("operation-recurrence-infini").checked = true;
  document.getElementById("operation-recurrence-fin").value = "";
  document.getElementById("operation-recurrence-fin-bloc").style.display = "none";
  document.getElementById("operation-amorti").checked = false;
  champsMoisAmortissement.debut.value = "";
  champsMoisAmortissement.fin.value = "";
  document.getElementById("operation-amortissement-nb-mois").value = "";
  remplirDecoupe(null);
  remplirRapprochement(null);
  document.getElementById("operation-imprevue").checked = false;
  document.getElementById("operation-a-declarer").checked = false;
  setOperationType("classique");
}

async function fillOperationForm(op) {
  // Le type est porte par l'operation (OperationRead.type_code) : plus aucune
  // deduction depuis la categorie et le booleen `remboursable`.
  const type = op.type_code;

  document.getElementById("operation-id").value = op.id;
  montantDuAutoSync = false;
  operationEditionEstOccurrenceGeneree = op.recurrence_parent_id != null;
  operationEditionModeleRecurrent = !!op.recurrente && op.recurrence_parent_id == null;
  operationEditionTypeOriginal = type;
  // LE STATUT AVANT LE TYPE : chaque appel à updateOperationTypeFields (dont
  // setOperationType) décocherait sinon la récurrence.
  poserStatutOperation(op.statut);
  setOperationType(type);

  document.getElementById("operation-recurrente").checked = !!op.recurrente;
  document.getElementById("operation-frequence").value = op.frequence || "mensuelle";
  const recurrenceInfinie = !op.recurrence_fin;
  document.getElementById("operation-recurrence-infini").checked = recurrenceInfinie;
  document.getElementById("operation-recurrence-fin").value = op.recurrence_fin || "";
  document.getElementById("operation-recurrence-fin-bloc").style.display = recurrenceInfinie ? "none" : "";

  // Le nombre de mois n'est pas stocké : le serveur le renvoie déduit des deux
  // bornes (OperationRead.amortissement_nb_mois), et c'est cette valeur-là
  // qu'on réaffiche plutôt qu'un calcul refait ici.
  document.getElementById("operation-amorti").checked = !!op.amorti;
  champsMoisAmortissement.debut.value = op.amortissement_debut
    ? op.amortissement_debut.slice(0, 7)
    : "";
  champsMoisAmortissement.fin.value = op.amortissement_fin
    ? op.amortissement_fin.slice(0, 7)
    : "";
  document.getElementById("operation-amortissement-nb-mois").value =
    op.amortissement_nb_mois || "";

  // setOperationType ci-dessus a déjà positionné la visibilité des blocs
  // récurrence et amortissement selon l'état par défaut des cases (décochées) :
  // AVANT updateOperationTypeFields, qui lit la case « découpée » pour décider
  // d'afficher les parts ou la catégorie unique.
  remplirDecoupe(op);

  // la recalculer maintenant que leurs vraies valeurs sont connues.
  updateOperationTypeFields();

  document.getElementById("operation-date").value = op.date;
  document.getElementById("operation-compte").value = op.compte_id;
  // Après le compte : les monnaies proposées sont celles de CE compte. La
  // monnaie de l'opération est gardée même si elle a été éteinte depuis.
  updateOperationMonnaieFields({ monnaie: op.monnaie_id });
  document.getElementById("operation-monnaie").value = op.monnaie_id;
  if (TYPES_CATEGORIE_LIBRE.has(type) && op.categorie_id != null) {
    document.getElementById("operation-categorie").value = op.categorie_id;
    operationDerniereCategorie = op.categorie_id;
  }
  operationMemoireCategorie = null;
  document.getElementById("operation-nature").value = op.nature;
  document.getElementById("operation-montant").value = op.montant;
  // Après le montant : le compteur du garde-fou compare les parts à LUI.
  majTotalDecoupe();
  poserStatutOperation(op.statut);
  document.getElementById("operation-imprevue").checked = !!op.imprevue;
  // Après la catégorie ET le type : l'éligibilité se lit sur eux (cf. majADeclarerOperation),
  // qui décoche la case si l'opération n'en relève plus.
  document.getElementById("operation-a-declarer").checked = !!op.a_declarer;
  majADeclarerOperation();
  // APRÈS le statut et la récurrence : le bloc n'est visible que si l'un des
  // deux le demande.
  remplirRapprochement(op);
  document.getElementById("operation-montant-du").value = op.montant_du;
  document.getElementById("operation-montant-a-rembourser").value = op.montant_a_rembourser;
  // APRÈS le montant, pas avant : la borne du montant dû se lit sur lui, et
  // updateOperationTypeFields l'a posée plus haut, alors que le formulaire
  // portait encore le montant de l'opération précédente (ou rien du tout).
  majBornesMontantDu();

  const resteField = document.getElementById("operation-montant-a-rembourser");
  const infoDiv = document.getElementById("operation-rembourse-info");
  const estLie = op.rembourse_par && op.rembourse_par.length > 0;
  // DÈS QU'UN REMBOURSEMENT EST LIÉ, le montant de l'opération et le reste restent
  // figés (les liens ont été validés contre eux). Le MONTANT À REMBOURSER, lui,
  // peut encore changer — mais jamais sous ce qui est déjà remboursé : c'est la
  // seule borne qui garde les liens valides (cf. routers/operations.update).
  // Le reste n'est pas saisi, il suit : montant à rembourser moins le déjà
  // remboursé. On grise ce qui serait refusé en 400 plutôt que de le laisser saisir.
  const montantDuChamp = document.getElementById("operation-montant-du");
  const dejaRembourse = estLie
    ? op.rembourse_par.reduce((somme, r) => somme + (r.montant_lien || 0), 0)
    : 0;
  resteField.disabled = estLie;
  document.getElementById("operation-montant").disabled = estLie;
  montantDuChamp.disabled = false;
  montantDuChamp.oninput = null;
  if (estLie) {
    montantDuChamp.min = Math.max(Number(montantDuChamp.min) || 0, dejaRembourse);
    montantDuChamp.oninput = () => {
      const valeur = parseFloat(montantDuChamp.value);
      if (Number.isFinite(valeur)) {
        resteField.value = Math.max(0, valeur - dejaRembourse).toFixed(2);
      }
    };
  }
  if (TYPES_REMBOURSABLES.has(type) && estLie) {
    const details = op.rembourse_par
      .map((r) => `"${r.nature}" (${formatMontant(r.montant_lien, op.monnaie_id)})`)
      .join(", ");
    infoDiv.textContent = t(
      "Remboursé via : {details}. Le montant de l'opération est figé tant que ce lien existe. Le montant à rembourser peut encore changer, sans descendre sous ce qui est déjà remboursé ({deja}) — pour aller plus bas, délie d'abord l'opération de remboursement correspondante.",
      { details, deja: formatMontant(dejaRembourse, op.monnaie_id) }
    );
    infoDiv.style.display = "block";
  } else {
    infoDiv.style.display = "none";
  }

  document.getElementById("operation-notes").value = op.notes || "";
  document.getElementById("operation-notes-bloc").style.display = "";

  // APRÈS le montant : c'est lui que la déduction retouche. Une opération qui
  // sort porte ses frais en plus, une qui entre les porte en moins (cf. § « Frais
  // d'une opération »).
  poserFraisOperation({
    frais: op.frais,
    monnaieFraisId: op.monnaie_frais_id,
    cote: "envoye",
    sortante: op.sens !== "entrée",
    champ: "operation-montant",
  });

  document.getElementById("form-operation-titre").textContent = "Modifier l'opération";
  document.getElementById("operation-annuler").style.display = "inline-block";

  if (type === "remboursements" || type === "remboursement_pret") {
    const preselection = Object.fromEntries(
      (op.operations_remboursees || []).map((o) => [o.id, o.montant_lien])
    );
    await populateRemboursementsChecklist(preselection, op.id, type);
  }
}

// preselection : { operation_id: montant déjà lié } — vide pour une création.
// typeReglement : "remboursements" (règle les dépenses remboursables) ou
// "remboursement_pret" (règle les prêts reçus). Le type de la cible se lit
// directement dans CIBLE_PAR_TYPE_REGLEMENT, comme côté serveur.
async function populateRemboursementsChecklist(
  preselection,
  excludeOperationId,
  typeReglement,
  { ajusterMontant = true } = {}
) {
  const liste = document.getElementById("operation-remboursements-liste");
  liste.innerHTML = "Chargement...";
  try {
    const toutes = await apiFetch("/operations");
    const cibleEstPret = typeReglement === "remboursement_pret";
    const codeCible = CIBLE_PAR_TYPE_REGLEMENT[typeReglement];
    // Pour l'instant, on ne propose que les opérations pas encore réglées (ou déjà
    // liées à CETTE opération de règlement, pour pouvoir les délier/modifier).
    const eligibles = toutes.filter((o) => {
      if (o.id === excludeOperationId || o.type_code !== codeCible) return false;
      return o.montant_a_rembourser > 0 || preselection[o.id] !== undefined;
    });
    liste.innerHTML = "";
    if (eligibles.length === 0) {
      liste.innerHTML = cibleEstPret
        ? `<span class="hint">${t("Aucun prêt non remboursé disponible.")}</span>`
        : `<span class="hint">${t("Aucune dépense non remboursée disponible.")}</span>`;
      return;
    }
    eligibles.forEach((o) => {
      const montantPreselectionne = preselection[o.id];
      // Reste "disponible" pour CETTE opération de remboursement : le reste à
      // rembourser général, plus ce qui lui est déjà lié ici (pour ne pas
      // perdre le montant existant lors d'une édition).
      const resteDisponible = o.montant_a_rembourser + (montantPreselectionne || 0);

      const row = document.createElement("div");
      row.className = "checklist-row";
      row.dataset.depenseId = o.id;

      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";

      const montantInput = document.createElement("input");
      montantInput.type = "number";
      montantInput.step = "0.01";
      montantInput.min = "0";
      montantInput.max = resteDisponible;
      montantInput.className = "remb-montant";
      montantInput.value = montantPreselectionne !== undefined ? montantPreselectionne : 0;

      // Case cochée = cible réglée en totalité ; un lien partiel laisse la
      // case décochée mais son montant compte dans le total.
      checkbox.checked =
        montantPreselectionne !== undefined &&
        Math.abs(montantPreselectionne - resteDisponible) < 1e-9;

      const label = document.createElement("span");
      label.textContent = `${o.nature} — ${formatMontant(o.montant, o.monnaie_id)} (reste dû : ${formatMontant(resteDisponible, o.monnaie_id)})`;

      checkbox.addEventListener("change", () => {
        // Cocher règle la totalité du reste dû de la cible ; le montant total
        // de l'opération suit (somme des liens, cf. recalculerMontantRemboursement).
        montantInput.value = checkbox.checked ? resteDisponible.toFixed(2) : "0";
        recalculerMontantRemboursement();
      });

      montantInput.addEventListener("input", () => {
        let valeur = parseFloat(montantInput.value || "0");
        // Un lien ne peut jamais dépasser le reste dû de sa cible (le montant
        // total, lui, est libre : il est piloté par la somme des liens).
        if (valeur > resteDisponible + 1e-9) {
          valeur = resteDisponible;
          montantInput.value = resteDisponible.toFixed(2);
          showMessage(
            `Montant limité à ${formatMontant(resteDisponible, o.monnaie_id)} : le reste dû de l'opération.`,
            "error"
          );
        }
        checkbox.checked = valeur > 0 && Math.abs(valeur - resteDisponible) < 1e-9;
        recalculerMontantRemboursement();
      });

      row.appendChild(checkbox);
      row.appendChild(montantInput);
      row.appendChild(label);
      liste.appendChild(row);
    });
    if (ajusterMontant) recalculerMontantRemboursement();
  } catch (err) {
    liste.innerHTML = "";
    showMessage(err.message, "error");
  }
}

function recalculerMontantRemboursement() {
  const total = [
    ...document.querySelectorAll("#operation-remboursements-liste .remb-montant"),
  ].reduce((somme, input) => somme + (parseFloat(input.value) || 0), 0);
  document.getElementById("operation-montant").value = total.toFixed(2);
}

let operationsCache = [];

/* ----- Édition en ligne -----
   Le formulaire d'opération n'est pas réécrit par onglet : il est déplacé
   dans le tableau, à l'endroit édité. Tout son câblage existant (les 6 types,
   la récurrence, les checklists de remboursement, le verrouillage des
   montants) continue donc de fonctionner tel quel — le réimplémenter six fois
   en ligne aurait été le vrai risque. */

// Type d'opération (valeur de #operation-type) créé depuis chaque onglet.
const TYPE_PAR_ONGLET = {
  classique: "classique",
  remboursable: "remboursable",
  remboursements: "remboursements",
  virements: "virement",
  prets: "pret",
  "remboursement-prets": "remboursement_pret",
};

let ligneEditionCourante = null;

function fermerFormulaireOperation() {
  const garage = document.getElementById("operation-form-garage");
  garage.appendChild(document.getElementById("form-operation-titre"));
  garage.appendChild(document.getElementById("form-operation"));
  if (ligneEditionCourante) {
    ligneEditionCourante.remove();
    ligneEditionCourante = null;
  }
  document
    .querySelectorAll(".operation-edition-encadre")
    .forEach((el) => el.classList.remove("operation-edition-encadre"));
}

/**
 * Place le formulaire à l'endroit édité. `ancre` est la ligne après laquelle
 * l'insérer (édition sur place) ; si elle vaut null, il va dans le conteneur
 * dédié de l'onglet, sous la case d'ajout (création).
 *
 * La création ne peut plus s'insérer dans un tableau : il y en a désormais un
 * par jour, et il n'y en a aucun tant que la période affichée est vide.
 */
function ouvrirFormulaireOperation(onglet, ancre) {
  fermerFormulaireOperation();

  const titre = document.getElementById("form-operation-titre");
  const formulaire = document.getElementById("form-operation");

  if (ancre) {
    const tr = document.createElement("tr");
    tr.className = "operation-edition-row";
    const td = document.createElement("td");
    // Le nombre de colonnes se lit sur le tableau réellement affiché plutôt
    // que sur une table de correspondance à maintenir en double.
    td.colSpan = ancre.closest("table").querySelectorAll("thead th").length || 6;
    td.appendChild(titre);
    td.appendChild(formulaire);
    tr.appendChild(td);
    ancre.parentNode.insertBefore(tr, ancre.nextSibling);
    ligneEditionCourante = tr;
    tr.scrollIntoView({ behavior: "smooth", block: "nearest" });
    return;
  }

  const conteneur = document.getElementById(`operations-form-${onglet}`);
  conteneur.classList.add("operation-edition-encadre");
  conteneur.appendChild(titre);
  conteneur.appendChild(formulaire);
  ligneEditionCourante = null;
  conteneur.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function ongletDeLigne(tr) {
  const sousSection = tr.closest(".sous-section");
  return sousSection ? sousSection.id.replace("sous-section-", "") : null;
}

async function editerOperationEnLigne(op, tr) {
  const onglet = ongletDeLigne(tr);
  ouvrirFormulaireOperation(onglet, tr);
  await fillOperationForm(op);
}

// Id du virement en cours d'édition (null hors édition d'un virement) : le
// formulaire est le même qu'à la création, seule la destination de l'envoi
// change (PUT sur la paire plutôt que POST).
let virementEnEdition = null;

/**
 * Édition d'un virement : le formulaire est rempli depuis SES DEUX écritures,
 * puisqu'elles portent chacune leur compte, leur monnaie et leur montant.
 */
async function editerVirementEnLigne(virementId, sortante, entrante, tr) {
  if (!sortante || !entrante) {
    // DEUX CAUSES, ET ELLES N'APPELLENT PAS LE MÊME GESTE. Le message ne le
    // distinguait pas et accusait toujours l'import : devant un virement
    // parfaitement complet en base, il envoyait le refaire, ce qui ne changeait
    // évidemment rien.
    //
    //   - clé `solo-<id>` : l'écriture ne porte AUCUN virement_id. C'est une
    //     jambe seule, héritée d'un import d'avant que l'app refuse les
    //     virements sans compte en face — là, il faut bien la recréer ;
    //   - clé = un virement_id : la paire EXISTE, mais sa seconde jambe n'est
    //     pas dans la liste. Un filtre l'a écartée (elle est sur un autre
    //     compte, ou porte un autre montant en cas de change).
    const seule = String(virementId).startsWith("solo-");
    showMessage(
      seule
        ? t(
            "Cette écriture n'a pas de seconde jambe (virement importé sans compte en face) : " +
              "supprime-la et recrée le virement avec ses deux comptes."
          )
        : t(
            "La seconde écriture de ce virement n'est pas dans la liste affichée : " +
              "vide les filtres pour la modifier."
          ),
      "error"
    );
    return;
  }

  resetOperationForm();
  ouvrirFormulaireOperation("virements", tr);
  virementEnEdition = virementId;
  operationEditionTypeOriginal = "virement";
  setOperationType("virement");

  document.getElementById("operation-date").value = sortante.date;
  document.getElementById("operation-nature").value = sortante.nature;
  poserStatutOperation(sortante.statut);
  document.getElementById("operation-compte1").value = sortante.compte_id;
  document.getElementById("operation-compte2").value = entrante.compte_id;
  // Après les comptes : les monnaies proposées sont celles de CES comptes, plus
  // celles des deux jambes si elles ont été éteintes depuis.
  const monnaiesEditees = {
    monnaie: sortante.monnaie_id,
    monnaieRecue: entrante.monnaie_id,
  };
  updateOperationMonnaieFields(monnaiesEditees);
  document.getElementById("operation-monnaie").value = sortante.monnaie_id;
  document.getElementById("operation-monnaie-recue").value = entrante.monnaie_id;
  updateOperationMonnaieFields(monnaiesEditees);
  document.getElementById("operation-montant").value = sortante.montant;
  document.getElementById("operation-montant-recu").value = entrante.montant;
  // LES FRAIS NE SONT PORTÉS QUE PAR UNE JAMBE (cf. crud._jambe_des_frais) :
  // c'est le champ de celle-là qui passe hors frais. Sur la sortante ils ont été
  // ajoutés (102 € partis pour 100 € virés), sur l'entrante retranchés (98 €
  // reçus pour 100 € envoyés).
  const jambeFrais = sortante.frais ? sortante : entrante.frais ? entrante : null;
  poserFraisOperation({
    frais: jambeFrais ? jambeFrais.frais : null,
    monnaieFraisId: jambeFrais ? jambeFrais.monnaie_frais_id : null,
    cote: jambeFrais === entrante ? "recu" : "envoye",
    sortante: jambeFrais !== entrante,
    champ: jambeFrais === entrante ? "operation-montant-recu" : "operation-montant",
  });
  // La note est la même sur les deux jambes (cf. VirementCreate.notes) : celle
  // de la sortante fait foi.
  document.getElementById("operation-notes").value = sortante.notes || "";
  document.getElementById("operation-notes-bloc").style.display = "";

  document.getElementById("form-operation-titre").textContent = t("Modifier le virement");
  document.getElementById("operation-annuler").style.display = "inline-block";
}

function wireEditDeleteButtons(body) {
  // Double-clic n'importe où sur la ligne : ouvre l'édition sur place. Le
  // clic simple reste libre (sélection future), et les clics sur les boutons
  // d'action de la ligne sont exclus pour ne pas ouvrir puis agir.
  body.querySelectorAll("tr").forEach((tr) => {
    if (tr.classList.contains("operation-edition-row")) return;
    tr.addEventListener("dblclick", (e) => {
      if (e.target.closest("button")) return;
      const btn = tr.querySelector("button[data-action='edit']");
      if (!btn) return;
      const op = operationsCache.find((o) => o.id === Number(btn.dataset.id));
      if (op) editerOperationEnLigne(op, tr);
    });
  });

  body.querySelectorAll("button[data-action='edit']").forEach((btn) => {
    btn.addEventListener("click", () => {
      const op = operationsCache.find((o) => o.id === Number(btn.dataset.id));
      editerOperationEnLigne(op, btn.closest("tr"));
    });
  });

  body.querySelectorAll("button[data-action='delete']").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!confirm(t("Supprimer cette opération ?"))) return;
      try {
        await apiFetch(`/operations/${btn.dataset.id}`, { method: "DELETE" });
        showMessage(t("Opération supprimée"), "success");
        loadOperations();
      } catch (err) {
        showMessage(err.message, "error");
      }
    });
  });
}

// En-têtes par onglet. La date n'y figure pas : tant que le tri est
// chronologique, elle est portée par le regroupement par jour (un tableau par
// journée), pas par une colonne répétée à l'identique sur toutes les lignes du
// même jour. Dès que le tri est autre, `colonnesOperations` la fait apparaître
// à la place indiquée par POSITION_DATE_OPERATIONS.
const COLONNES_OPERATIONS = {
  classique: ["Nature", "Montant", "Compte", "Catégorie", "Statut", "Actions"],
  remboursable: [
    "Nature",
    "Montant",
    "Compte",
    "Catégorie",
    "Montant à rembourser",
    "Reste à rembourser",
    "Actions",
  ],
  remboursements: ["Nature", "Montant", "Compte", "Opérations réglées", "Actions"],
  virements: ["Nature", "Montant", "Compte source", "Compte destination", "Statut", "Actions"],
  prets: ["Nature", "Montant", "Compte", "Reste à rembourser", "Actions"],
  "remboursement-prets": ["Nature", "Montant", "Compte", "Prêts réglés", "Actions"],
};

// OÙ VIENT SE POSER LA DATE quand elle descend dans la ligne : JUSTE APRÈS LE
// OU LES COMPTES, avant la catégorie (ou ce qui la remplace). Au milieu de la
// ligne plutôt qu'en tête : le regard arrive sur la nature et le montant, puis
// situe l'opération (quel compte, quand) avant de lire ce qui la classe. Et c'est
// la place qu'occupe la catégorie masquée d'un drill-through (cf.
// `drillActif`) : la date s'y lit à peu près là où l'œil attendait la catégorie.
// C'est un INDEX DE CELLULE, dans la ligne construite SANS la date.
const POSITION_DATE_OPERATIONS = {
  classique: 3,
  remboursable: 3,
  remboursements: 3,
  virements: 4,
  prets: 3,
  "remboursement-prets": 3,
};

// Dimanche en premier : l'index vient de Date.getDay(), qui compte de 0 (dimanche)
// à 6, quelle que soit la langue.
const JOURS_FR = (() => {
  const format = new Intl.DateTimeFormat(langue(), { weekday: "long" });
  // 2026-02-01 est un dimanche : les sept jours suivants couvrent la semaine.
  return Array.from({ length: 7 }, (_, i) =>
    capitalizeFirst(format.format(new Date(2026, 1, 1 + i)))
  );
})();

// « Dimanche 25 octobre 2026 » / « Sunday 25 October 2026 » : le mois se met en
// minuscule en français et garde sa majuscule en anglais, d'où Intl plutôt
// qu'un `toLowerCase()` qui n'était juste que dans une langue.
function libelleJour(iso) {
  const d = new Date(iso + "T00:00:00");
  const mois = new Intl.DateTimeFormat(langue(), { month: "long" }).format(d);
  return `${JOURS_FR[d.getDay()]} ${d.getDate()} ${mois} ${d.getFullYear()}`;
}

// L'onglet auquel appartient un conteneur "liste-{onglet}-{ponctuelles|recurrentes}".
function ongletDeListe(listeId) {
  return listeId.replace(/^liste-/, "").replace(/-(ponctuelles|recurrentes)$/, "");
}

/* ---------- Le DRILL-THROUGH d'une catégorie, et ce que le budget d'un mois contient ----------
 *
 * « Voir toutes les dépenses » ouvre la page Opérations filtrée sur une
 * catégorie et une période. Deux choses y changent, parce que l'écran sait alors
 * D'OÙ il vient :
 *
 *   - la CATÉGORIE n'est plus une colonne (elle vaut la même chose partout) ; la
 *     date prend sa place, et le tri par montant décroissant est posé d'office ;
 *   - la PÉRIODE ne se lit plus sur la date de l'opération mais sur le BUDGET du
 *     mois, exactement comme l'histogramme et le top 3 de l'infobulle : une
 *     dépense amortie y entre par les mois qu'elle pèse (elle y est, même payée
 *     trois mois plus tôt) et n'y entre pas par sa date (une dépense de ce mois
 *     étalée sur les suivants n'y pèse pas). Sans cette règle, l'infobulle
 *     annonçait un top 3 dont rien n'apparaissait dans la page qu'elle ouvre.
 *
 * LE CONTEXTE SE VALIDE LUI-MÊME : il ne vaut que tant que la catégorie et les
 * deux dates du filtre sont ce que le drill-through y a posées. Les changer à la
 * main — ou « Réinitialiser » — le fait tomber sans qu'aucun écouteur n'ait à
 * s'en occuper, et l'écran retrouve alors sa lecture ordinaire.
 */
// (l'état vit dans `state.drillOperations`, déclaré avec les autres : une variable
// `let` posée ici serait en zone morte pour tout rendu lancé avant cette ligne.)

function drillActif(onglet) {
  if (!state.drillOperations || state.drillOperations.onglet !== onglet) return false;
  const f = lireFiltresOnglet(onglet);
  return (
    f.categorieId === state.drillOperations.categorieId &&
    f.dateDebut === state.drillOperations.debut &&
    f.dateFin === state.drillOperations.fin
  );
}

// Numérote les mois d'affilée pour qu'ils se comparent sans se soucier du
// passage d'année (miroir de soldes._index_mois).
function indexMoisIso(iso) {
  return Number(iso.slice(0, 4)) * 12 + Number(iso.slice(5, 7));
}

/**
 * Combien de mois d'amortissement de `op` tombent dans la période du
 * drill-through (0 : elle n'y pèse pas). Miroir de soldes.part_amortie.
 */
function moisCouvertsDrill(op) {
  const debutPeriode = indexMoisIso(state.drillOperations.debut);
  const finPeriode = indexMoisIso(state.drillOperations.fin);
  const debutAmortissement = indexMoisIso(op.amortissement_debut);
  const finAmortissement = indexMoisIso(op.amortissement_fin);
  return Math.max(
    0,
    Math.min(finAmortissement, finPeriode) - Math.max(debutAmortissement, debutPeriode) + 1
  );
}

/** L'opération fait-elle partie du budget de la période du drill-through ? */
function operationDansBudgetDrill(op) {
  if (op.amorti && op.amortissement_debut && op.amortissement_fin) {
    return moisCouvertsDrill(op) > 0;
  }
  return correspondDate(state.drillOperations.debut, state.drillOperations.fin, op.date);
}

/**
 * Le montant que l'opération apporte à la période du drill-through : son montant
 * entier, ou pour une dépense amortie la part des mois qui y tombent.
 *
 * UNE SEMAINE n'a pas de jour dans un amortissement : la part du mois est répartie
 * au prorata des jours, comme le fait la barre de l'histogramme (cf.
 * soldes.prorata_semaine) — sans quoi la somme des lignes ne vaudrait pas la barre.
 */
function montantAttribueDrill(op) {
  if (!op.amorti || !op.amortissement_nb_mois) return op.montant;
  let part = moisCouvertsDrill(op) / op.amortissement_nb_mois;
  const { debut, fin } = state.drillOperations;
  if (indexMoisIso(debut) === indexMoisIso(fin)) {
    const joursDuMois = new Date(Number(debut.slice(0, 4)), Number(debut.slice(5, 7)), 0).getDate();
    part *= (Number(fin.slice(8, 10)) - Number(debut.slice(8, 10)) + 1) / joursDuMois;
  }
  return op.montant * part;
}

/**
 * La cellule « Montant » d'une opération. Ordinaire, c'est `montantHtml`. Dans
 * un drill-through, une dépense AMORTIE montre ce qu'elle pèse sur la période, et
 * son montant réel dessous — en gris, petit et en italique : c'est un rappel, pas
 * ce qu'on compare.
 */
function celluleMontantOperation(op, onglet) {
  if (!drillActif(onglet) || !op.amorti || !op.amortissement_nb_mois) {
    return montantHtml(op.montant, op.sens, op.monnaie_id);
  }
  return (
    montantHtml(montantAttribueDrill(op), op.sens, op.monnaie_id) +
    `<div class="montant-origine">${formatMontant(op.montant, op.monnaie_id)}</div>`
  );
}

/**
 * Ce qui se lit après la date d'une ligne : dans un drill-through, le nombre de
 * mois sur lesquels la dépense est amortie, entre crochets. La date prend la
 * place de la catégorie, et c'est ici que le tableau dit « cette ligne n'est
 * pas ce qu'elle a coûté ce mois-ci ».
 */
function complementDateOperation(op, onglet) {
  if (!drillActif(onglet) || !op.amorti || !op.amortissement_nb_mois) return "";
  const n = op.amortissement_nb_mois;
  return `[${n > 1 ? t("{n} mois", { n }) : t("1 mois")}]`;
}

/* ---------- Deux façons de ranger un tableau d'opérations ----------
 *
 * TANT QUE LE TRI EST CHRONOLOGIQUE, la date appartient au GROUPE : chaque
 * journée forme un bloc introduit par « Jeudi 3 septembre 2026 », et aucune
 * ligne ne répète une date que le bloc annonce déjà. C'est la lecture d'un
 * relevé, et c'est l'affichage d'origine.
 *
 * DÈS QU'ON TRIE AUTREMENT — par montant, par compte, par catégorie — ce
 * groupement n'a plus rien à grouper : l'ordre n'étant plus chronologique,
 * chaque « journée » se réduit le plus souvent à une ligne, et l'écran se
 * remplit d'en-têtes de date qui séparent des opérations une par une. Le
 * classement demandé devient illisible par la mise en forme qui servait
 * l'autre.
 *
 * ALORS LA DATE DESCEND DANS LA LIGNE, en première colonne : elle reste
 * lisible, elle cesse d'ordonner. Et comme rien ne découpe plus la liste, un
 * filet — le même que celui des journées, sans sa date — revient toutes les dix
 * lignes : de quoi suivre une ligne du regard jusqu'au bout sans compter les
 * rangées à la main.
 */
function triParDate(onglet) {
  return String(state.triSelections[onglet] || "").startsWith("date-");
}

/**
 * Les colonnes d'un onglet : la DATE y est (entre le compte et la catégorie)
 * quand le tri ne l'est pas, et la CATÉGORIE n'y est plus quand on arrive d'un
 * drill-through de catégorie — elle serait la même sur toutes les lignes.
 */
function colonnesOperations(onglet) {
  const colonnes = [...(COLONNES_OPERATIONS[onglet] || [])];
  if (!triParDate(onglet)) {
    colonnes.splice(POSITION_DATE_OPERATIONS[onglet] ?? 0, 0, "Date");
  }
  return drillActif(onglet) ? colonnes.filter((c) => c !== "Catégorie") : colonnes;
}

// Dix lignes : assez pour que le filet ne hache pas la lecture, assez peu pour
// qu'aucun bloc ne dépasse la hauteur d'un écran.
const LIGNES_PAR_BLOC = 10;

/**
 * Les blocs d'un tableau : une journée chacun quand le tri est chronologique,
 * une dizaine de lignes sinon. Chaque bloc porte le `jour` que son séparateur
 * doit annoncer, ou `null` quand il n'y a rien à annoncer.
 */
function blocsOperations(liste, onglet, dateDe = (op) => op.date) {
  if (triParDate(onglet)) {
    return [...grouperParJour(liste, dateDe)].map(([jour, elements]) => ({ jour, elements }));
  }
  const blocs = [];
  for (let depart = 0; depart < liste.length; depart += LIGNES_PAR_BLOC) {
    blocs.push({ jour: null, elements: liste.slice(depart, depart + LIGNES_PAR_BLOC) });
  }
  return blocs;
}

/**
 * Pose la cellule de date dans la ligne, entre le compte et la catégorie, quand
 * le tri l'a fait descendre du séparateur (cf. colonnesOperations).
 *
 * LE NŒUD PEUT ÊTRE UN FRAGMENT — une opération découpée ou annotée en rend
 * plusieurs lignes (cf. renderClassiques) : la date va sur la PREMIÈRE, les
 * lignes de détail traversant de toute façon toute la largeur.
 */
function avecCelluleDate(noeud, dateIso, onglet, complement = "") {
  if (triParDate(onglet)) return noeud;
  const tr = noeud.tagName === "TR" ? noeud : noeud.querySelector("tr");
  if (!tr) return noeud;
  const td = document.createElement("td");
  td.className = "operation-date";
  td.textContent = dateIso ? formatDateCourte(dateIso) : "-";
  // `complement` : ce qui se lit juste après la date — « [3 mois] » pour une
  // dépense amortie dans un drill-through (cf. renderClassiques).
  if (complement) td.textContent += ` ${complement}`;
  tr.insertBefore(td, tr.children[POSITION_DATE_OPERATIONS[onglet] ?? 0] || null);
  return noeud;
}

// Regroupe une liste déjà triée par date, en conservant l'ordre : le premier
// jour rencontré reste le premier affiché.
function grouperParJour(liste, dateDe = (op) => op.date) {
  const parJour = new Map();
  liste.forEach((element) => {
    const jour = dateDe(element);
    if (!parJour.has(jour)) parJour.set(jour, []);
    parJour.get(jour).push(element);
  });
  return parJour;
}

/**
 * Un seul tableau par sous-section : l'en-tête de colonnes n'apparaît qu'une
 * fois, en haut, et chaque journée devient un <tbody> introduit par une ligne
 * de date pleine largeur.
 *
 * Répéter l'en-tête à chaque journée était non seulement redondant, mais
 * cassait aussi l'alignement vertical des colonnes d'un jour à l'autre
 * (chaque tableau dimensionnait les siennes indépendamment).
 */
function remplirListeOperations(listeId, liste, construireLigne) {
  const conteneur = document.getElementById(listeId);
  conteneur.innerHTML = "";
  if (liste.length === 0) return;

  const onglet = ongletDeListe(listeId);
  const colonnes = colonnesOperations(onglet);
  const table = document.createElement("table");
  // Chaque BLOC y forme un cadre arrondi distinct — une journée, ou une dizaine
  // de lignes quand le tri n'est plus chronologique (cf. blocsOperations) — au
  // lieu d'un seul cadre continu pour tout le tableau (cf. .table-operations
  // dans style.css).
  table.className = "table-operations";
  // Les en-têtes vivent en français dans COLONNES_OPERATIONS (lisible en
  // regard du reste du fichier) et se traduisent au rendu.
  table.innerHTML = `<thead><tr>${colonnes
    .map((c) => `<th>${t(c)}</th>`)
    .join("")}</tr></thead>`;

  blocsOperations(liste, onglet).forEach((bloc, rang) => {
    const body = document.createElement("tbody");
    body.className = "jour-groupe";
    // LE PREMIER BLOC N'A PAS DE FILET quand il n'annonce rien : l'en-tête du
    // tableau le précède déjà, et un trait juste dessous ne séparerait que lui
    // de lui-même.
    if (bloc.jour !== null || rang > 0) {
      body.appendChild(ligneSeparatriceJour(bloc.jour, colonnes.length));
    }
    bloc.elements.forEach((op) =>
      body.appendChild(
        avecCelluleDate(construireLigne(op), op.date, onglet, complementDateOperation(op, onglet))
      )
    );
    table.appendChild(body);
    wireEditDeleteButtons(body);
  });

  conteneur.appendChild(table);
}

/**
 * Ligne pleine largeur ouvrant une journée : la date, puis un filet qui court
 * jusqu'au bout de la ligne. Un repère discret plutôt qu'un bandeau — la
 * séparation se fait surtout par l'espace laissé au-dessus et en dessous.
 */
function ligneSeparatriceJour(jour, nbColonnes) {
  const tr = document.createElement("tr");
  tr.className = "jour-separateur";
  const td = document.createElement("td");
  td.colSpan = nbColonnes;
  const contenu = document.createElement("div");
  contenu.className = "jour-separateur-contenu";
  // `jour` À NULL : le même filet, sans rien annoncer. C'est le repère des dix
  // lignes, quand le tri n'est plus chronologique (cf. blocsOperations) — la
  // date, elle, est alors dans chaque ligne.
  if (jour !== null) {
    const date = document.createElement("span");
    date.className = "jour-separateur-date";
    date.textContent = libelleJour(jour);
    contenu.appendChild(date);
  }
  const trait = document.createElement("span");
  trait.className = "jour-separateur-trait";
  contenu.appendChild(trait);
  td.appendChild(contenu);
  tr.appendChild(td);
  return tr;
}

/**
 * La cellule « Catégorie » d'une opération DÉCOUPÉE : le nombre de parts, et
 * un bouton qui les déplie sous la ligne.
 *
 * DÉPLIABLE PLUTÔT QU'EMPILÉE : trois parts écrites les unes sous les autres
 * dans la cellule feraient de chaque opération découpée une ligne trois fois
 * plus haute que ses voisines, et le tableau perdrait le rythme qui le rend
 * lisible. Le détail est à un clic, et il reste accessible au clavier — ce
 * qu'une infobulle au survol n'aurait pas été.
 */
function celluleCategorieOperation(op) {
  if (!op.decoupes || op.decoupes.length === 0) return nomCategorie(op.categorie_id);
  const titre = t("Voir le détail de la découpe");
  return (
    `<button type="button" class="decoupe-bascule" data-bascule="decoupe-${op.id}"` +
    ` aria-expanded="false" aria-controls="decoupe-${op.id}"` +
    ` title="${escapeHtml(titre)}" aria-label="${escapeHtml(titre)}">` +
    `${t("Découpée")} · ${op.decoupes.length} ${t("parts")}</button>`
  );
}

/**
 * La ligne repliée qui détaille les parts. Un `<tr>` à part et non un bloc
 * dans la cellule : c'est le seul moyen de lui laisser toute la largeur du
 * tableau sans casser l'alignement des colonnes au-dessus.
 *
 * Son `id` est celui que vise le bouton ci-dessus ; la bascule elle-même est
 * le mécanisme générique de app.js (écouteur délégué sur `data-bascule`), qui
 * ne fait que retourner l'attribut `hidden`.
 */
function ligneDetailDecoupe(op, nbColonnes) {
  const tr = document.createElement("tr");
  tr.id = `decoupe-${op.id}`;
  tr.className = "decoupe-detail";
  tr.hidden = true;
  const parts = op.decoupes
    .map(
      (part) =>
        `<li><span class="decoupe-detail-categorie">${escapeHtml(
          nomCategorie(part.categorie_id)
        )}</span>` +
        `<span class="decoupe-detail-montant">${formatMontant(
          part.montant,
          op.monnaie_id
        )}</span></li>`
    )
    .join("");
  tr.innerHTML = `<td colspan="${nbColonnes}"><ul class="decoupe-detail-liste">${parts}</ul></td>`;
  return tr;
}

/**
 * Un petit pictogramme à côté de la nature, pour une opération qui porte une
 * NOTE (`Operation.notes`) — jamais montrée nulle part dans un tableau
 * jusqu'ici (cf. CONTEXTE_PROJET, § notes). Même mécanisme que la découpe
 * juste au-dessus : `data-bascule` générique, icône « page de texte »
 * réemployée telle quelle (ICONE_BASCULE_DETAIL).
 *
 * `op` n'a besoin que de `id` et `notes` : appelé aussi bien sur une opération
 * que sur UNE JAMBE de virement (cf. renderVirements), dont l'id propre reste
 * unique dans la page.
 */
function indicateurNote(op) {
  const titre = t("Voir la note");
  // `.detail-bascule` : le bouton-pictogramme générique (cf. basculeDetailHtml),
  // pas une classe à soi — même geste, même image, pour tout ce qui se déplie
  // dans l'app.
  return (
    `<button type="button" class="detail-bascule" data-bascule="note-${op.id}"` +
    ` aria-expanded="false" aria-controls="note-${op.id}"` +
    ` title="${escapeHtml(titre)}" aria-label="${escapeHtml(titre)}">${ICONE_BASCULE_DETAIL}</button>`
  );
}

// La ligne repliée qui montre le texte de la note. `escapeHtml` ici est
// nécessaire — contrairement à `op.nature` ailleurs dans ces rendus, ce texte
// n'a jamais traversé un attribut avant, et peut contenir n'importe quel
// caractère tapé librement par l'utilisateur (cf. schemas.OperationBase.notes).
function ligneDetailNote(op, nbColonnes) {
  const tr = document.createElement("tr");
  tr.id = `note-${op.id}`;
  tr.className = "note-detail";
  tr.hidden = true;
  tr.innerHTML = `<td colspan="${nbColonnes}">${escapeHtml(op.notes)}</td>`;
  return tr;
}

// Complète la cellule "Nature" avec l'indicateur de note quand il y en a une.
function celluleNature(op) {
  return op.notes ? `${op.nature} ${indicateurNote(op)}` : op.nature;
}

function renderClassiques(liste) {
  const nbColonnes = colonnesOperations("classique").length;
  // Arrivé d'un drill-through, le tableau ne montre que UNE catégorie : la
  // colonne répéterait le même mot sur chaque ligne (cf. drillActif).
  const sansCategorie = drillActif("classique");
  const construireLigne = (op) => {
    const tr = document.createElement("tr");
    if (op.decoupes && op.decoupes.length > 0) tr.classList.add("operation-decoupee");
    tr.innerHTML = `
      <td>${celluleNature(op)}</td>
      <td>${celluleMontantOperation(op, "classique")}</td>
      <td>${nomCompte(op.compte_id)}</td>
      ${sansCategorie ? "" : `<td>${celluleCategorieOperation(op)}</td>`}
      <td>${statutLabel(op.statut)}</td>
      <td>
        <button data-action="edit" data-id="${op.id}">${t("Modifier")}</button>
        <button data-action="delete" data-id="${op.id}" class="danger">${t("Supprimer")}</button>
      </td>
    `;
    const detailRows = [];
    if (op.decoupes && op.decoupes.length > 0) detailRows.push(ligneDetailDecoupe(op, nbColonnes));
    if (op.notes) detailRows.push(ligneDetailNote(op, nbColonnes));
    if (detailRows.length === 0) return tr;
    // Plusieurs lignes pour une opération : un fragment les insère toutes là
    // où l'appelant n'en attend qu'une (cf. remplirListeOperations).
    const fragment = document.createDocumentFragment();
    fragment.appendChild(tr);
    detailRows.forEach((ligne) => fragment.appendChild(ligne));
    return fragment;
  };
  const ponctuelles = liste.filter((o) => !o.recurrente);
  const recurrentes = liste.filter((o) => o.recurrente);
  remplirListeOperations("liste-classique-ponctuelles", ponctuelles, construireLigne);
  remplirListeOperations("liste-classique-recurrentes", recurrentes, construireLigne);
  toggleSousSection("operations-bloc-classique-ponctuelles", ponctuelles.length);
  toggleSousSection("operations-bloc-classique-recurrentes", recurrentes.length);
}

function renderRemboursables(liste) {
  const nbColonnes = colonnesOperations("remboursable").length;
  const construireLigne = (op) => {
    const { cellHtml, rowClass } = resteCellEtRowClass(
      op.montant_du,
      op.montant_a_rembourser,
      op.monnaie_id
    );
    const tr = document.createElement("tr");
    if (rowClass) tr.className = rowClass;
    tr.innerHTML = `
      <td>${celluleNature(op)}</td>
      <td>${montantHtml(op.montant, op.sens, op.monnaie_id)}</td>
      <td>${nomCompte(op.compte_id)}</td>
      <td>${nomCategorie(op.categorie_id)}</td>
      <td class="montant neutre">${formatMontant(op.montant_du, op.monnaie_id)}</td>
      <td>${cellHtml}</td>
      <td>
        <button data-action="edit" data-id="${op.id}">${t("Modifier")}</button>
        <button data-action="delete" data-id="${op.id}" class="danger">${t("Supprimer")}</button>
      </td>
    `;
    if (!op.notes) return tr;
    const fragment = document.createDocumentFragment();
    fragment.appendChild(tr);
    fragment.appendChild(ligneDetailNote(op, nbColonnes));
    return fragment;
  };
  const ponctuelles = liste.filter((o) => !o.recurrente);
  const recurrentes = liste.filter((o) => o.recurrente);
  remplirListeOperations("liste-remboursable-ponctuelles", ponctuelles, construireLigne);
  remplirListeOperations("liste-remboursable-recurrentes", recurrentes, construireLigne);
  toggleSousSection("operations-bloc-remboursable-ponctuelles", ponctuelles.length);
  toggleSousSection("operations-bloc-remboursable-recurrentes", recurrentes.length);
}

function renderRemboursements(liste) {
  const nbColonnes = colonnesOperations("remboursements").length;
  const construireLigne = (op) => {
    const couvre =
      (op.operations_remboursees || [])
        .map((o) => `${o.nature} (${formatMontant(o.montant_lien, op.monnaie_id)})`)
        .join(", ") || "-";
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${celluleNature(op)}</td>
      <td>${montantHtml(op.montant, op.sens, op.monnaie_id)}</td>
      <td>${nomCompte(op.compte_id)}</td>
      <td>${couvre}</td>
      <td>
        <button data-action="edit" data-id="${op.id}">${t("Modifier")}</button>
        <button data-action="delete" data-id="${op.id}" class="danger">${t("Supprimer")}</button>
      </td>
    `;
    if (!op.notes) return tr;
    const fragment = document.createDocumentFragment();
    fragment.appendChild(tr);
    fragment.appendChild(ligneDetailNote(op, nbColonnes));
    return fragment;
  };
  const ponctuelles = liste.filter((o) => !o.recurrente);
  const recurrentes = liste.filter((o) => o.recurrente);
  remplirListeOperations("liste-remboursements-ponctuelles", ponctuelles, construireLigne);
  remplirListeOperations("liste-remboursements-recurrentes", recurrentes, construireLigne);
  toggleSousSection("operations-bloc-remboursements-ponctuelles", ponctuelles.length);
  toggleSousSection("operations-bloc-remboursements-recurrentes", recurrentes.length);
}

function renderVirements(paires) {
  // Les virements ne passent jamais par la récurrence (CRUD séparé, paire
  // d'écritures liées, cf. décision de portée) : la sous-section "Récurrentes"
  // reste donc toujours vide ici, ajoutée seulement par cohérence avec les 5
  // autres onglets.
  const construireLigne = ([virementId, { sortante, entrante }]) => {
    // Une paire "solo" (clé "solo-<id>", cf. loadOperations) n'a que sortante
    // OU entrante : virement importé dont le second compte reste inconnu.
    // Elle s'affiche quand même, avec "-" du côté qui manque, plutôt que
    // d'être masquée comme une vraie paire incomplète ne le serait.
    const reference = sortante || entrante;
    if (!reference) return null;
    // Un virement entre deux monnaies a deux montants distincts (ce qui part,
    // ce qui arrive) : n'en montrer qu'un cacherait la moitié de l'opération.
    // Écrits l'un SOUS l'autre, ce qui arrive derrière une flèche — côte à
    // côte, deux montants et deux devises débordaient de la colonne.
    const change =
      sortante && entrante && sortante.monnaie_id !== entrante.monnaie_id
        ? `${montantHtml(sortante.montant, "transfert", sortante.monnaie_id)}` +
          `<span class="apercu-montant-recu">→ ${montantHtml(
            entrante.montant,
            "transfert",
            entrante.monnaie_id
          )}</span>`
        : montantHtml(reference.montant, reference.sens, reference.monnaie_id);
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${celluleNature(reference)}</td>
      <td>${change}</td>
      <td>${sortante ? nomCompte(sortante.compte_id) : "-"}</td>
      <td>${entrante ? nomCompte(entrante.compte_id) : "-"}</td>
      <td>${statutLabel(reference.statut)}</td>
      <td>
        <button data-action="edit-virement" data-virement-id="${virementId}">${t("Modifier")}</button>
        <button data-action="delete-virement" data-virement-id="${virementId}" class="danger">${t("Supprimer")}</button>
      </td>
    `;
    return tr;
  };

  // Même structure que les autres onglets (un tableau, un tbody par jour),
  // mais sur des paires : la date est portée par la ligne de référence.
  function remplir(listeId, paires) {
    const conteneur = document.getElementById(listeId);
    conteneur.innerHTML = "";
    const utilisables = paires.filter(([, { sortante, entrante }]) => sortante || entrante);
    if (utilisables.length === 0) return;

    const colonnes = colonnesOperations("virements");
    const table = document.createElement("table");
    // Mêmes blocs que les autres onglets : une journée, ou une dizaine de
    // lignes quand le tri n'est plus chronologique (cf. blocsOperations).
    table.className = "table-operations";
    // Les en-têtes vivent en français dans COLONNES_OPERATIONS (lisible en
    // regard du reste du fichier) et se traduisent au rendu.
    table.innerHTML = `<thead><tr>${colonnes
      .map((c) => `<th>${t(c)}</th>`)
      .join("")}</tr></thead>`;

    // LA DATE D'UNE PAIRE est celle de sa ligne de référence : les deux jambes
    // d'un virement la partagent (une seule saisie), et une paire « solo » n'en
    // a qu'une des deux.
    const dateDe = ([, { sortante, entrante }]) => (sortante || entrante).date;

    blocsOperations(utilisables, "virements", dateDe).forEach((bloc, rang) => {
      const body = document.createElement("tbody");
      body.className = "jour-groupe";
      if (bloc.jour !== null || rang > 0) {
        body.appendChild(ligneSeparatriceJour(bloc.jour, colonnes.length));
      }
      bloc.elements.forEach((paire) => {
        const tr = construireLigne(paire);
        if (tr) {
          // La paire est retenue sur la ligne : l'édition a besoin des deux
          // écritures, que la seule lecture du DOM ne donnerait pas.
          tr._paireVirement = paire;
          body.appendChild(avecCelluleDate(tr, dateDe(paire), "virements"));
          // À part (pas un fragment comme les autres onglets) : `tr` doit
          // rester LUI-MÊME l'élément qui porte `_paireVirement` ci-dessus,
          // ce qu'un fragment aurait dissous à l'insertion.
          const [, { sortante, entrante }] = paire;
          const reference = sortante || entrante;
          if (reference.notes) body.appendChild(ligneDetailNote(reference, colonnes.length));
        }
      });
      table.appendChild(body);
      cablerActionsVirements(body);
    });

    conteneur.appendChild(table);
  }

  function cablerActionsVirements(body) {
    // Double-clic n'importe où sur la ligne, comme dans les cinq autres
    // onglets : c'est le geste d'édition attendu partout dans la page.
    body.querySelectorAll("tr").forEach((tr) => {
      if (!tr._paireVirement) return;
      tr.addEventListener("dblclick", (e) => {
        if (e.target.closest("button")) return;
        const [virementId, { sortante, entrante }] = tr._paireVirement;
        editerVirementEnLigne(virementId, sortante, entrante, tr);
      });
    });

    body.querySelectorAll("button[data-action='edit-virement']").forEach((btn) => {
      btn.addEventListener("click", () => {
        const tr = btn.closest("tr");
        const [virementId, { sortante, entrante }] = tr._paireVirement;
        editerVirementEnLigne(virementId, sortante, entrante, tr);
      });
    });

    body.querySelectorAll("button[data-action='delete-virement']").forEach((btn) => {
      btn.addEventListener("click", async () => {
        const id = btn.dataset.virementId;
        const estSolo = id.startsWith("solo-");
        const message = estSolo
          ? t("Supprimer cette opération ?")
          : t("Supprimer ce virement ? Les deux lignes liées (sortante et entrante) seront supprimées.");
        if (!confirm(message)) return;
        try {
          if (estSolo) {
            await apiFetch(`/operations/${id.slice("solo-".length)}`, { method: "DELETE" });
          } else {
            await apiFetch(`/virements/${id}`, { method: "DELETE" });
          }
          showMessage(estSolo ? "Opération supprimée" : "Virement supprimé", "success");
          loadOperations();
        } catch (err) {
          showMessage(err.message, "error");
        }
      });
    });
  }

  const ponctuelles = paires.filter(([, { sortante, entrante }]) => !(sortante || entrante).recurrente);
  const recurrentes = paires.filter(([, { sortante, entrante }]) => (sortante || entrante).recurrente);
  remplir("liste-virements-ponctuelles", ponctuelles);
  remplir("liste-virements-recurrentes", recurrentes);
  toggleSousSection("operations-bloc-virements-ponctuelles", ponctuelles.length);
  toggleSousSection("operations-bloc-virements-recurrentes", recurrentes.length);
}

function renderPrets(liste) {
  const nbColonnes = colonnesOperations("prets").length;
  const construireLigne = (op) => {
    const { cellHtml, rowClass } = resteCellEtRowClass(
      op.montant_du,
      op.montant_a_rembourser,
      op.monnaie_id
    );
    const tr = document.createElement("tr");
    if (rowClass) tr.className = rowClass;
    tr.innerHTML = `
      <td>${celluleNature(op)}</td>
      <td>${montantHtml(op.montant, op.sens, op.monnaie_id)}</td>
      <td>${nomCompte(op.compte_id)}</td>
      <td>${cellHtml}</td>
      <td>
        <button data-action="edit" data-id="${op.id}">${t("Modifier")}</button>
        <button data-action="delete" data-id="${op.id}" class="danger">${t("Supprimer")}</button>
      </td>
    `;
    if (!op.notes) return tr;
    const fragment = document.createDocumentFragment();
    fragment.appendChild(tr);
    fragment.appendChild(ligneDetailNote(op, nbColonnes));
    return fragment;
  };
  const ponctuelles = liste.filter((o) => !o.recurrente);
  const recurrentes = liste.filter((o) => o.recurrente);
  remplirListeOperations("liste-prets-ponctuelles", ponctuelles, construireLigne);
  remplirListeOperations("liste-prets-recurrentes", recurrentes, construireLigne);
  toggleSousSection("operations-bloc-prets-ponctuelles", ponctuelles.length);
  toggleSousSection("operations-bloc-prets-recurrentes", recurrentes.length);
}

function renderRemboursementPrets(liste) {
  const nbColonnes = colonnesOperations("remboursement-prets").length;
  const construireLigne = (op) => {
    const couvre =
      (op.operations_remboursees || [])
        .map((o) => `${o.nature} (${formatMontant(o.montant_lien, op.monnaie_id)})`)
        .join(", ") || "-";
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${celluleNature(op)}</td>
      <td>${montantHtml(op.montant, op.sens, op.monnaie_id)}</td>
      <td>${nomCompte(op.compte_id)}</td>
      <td>${couvre}</td>
      <td>
        <button data-action="edit" data-id="${op.id}">${t("Modifier")}</button>
        <button data-action="delete" data-id="${op.id}" class="danger">${t("Supprimer")}</button>
      </td>
    `;
    if (!op.notes) return tr;
    const fragment = document.createDocumentFragment();
    fragment.appendChild(tr);
    fragment.appendChild(ligneDetailNote(op, nbColonnes));
    return fragment;
  };
  const ponctuelles = liste.filter((o) => !o.recurrente);
  const recurrentes = liste.filter((o) => o.recurrente);
  remplirListeOperations("liste-remboursement-prets-ponctuelles", ponctuelles, construireLigne);
  remplirListeOperations("liste-remboursement-prets-recurrentes", recurrentes, construireLigne);
  toggleSousSection("operations-bloc-remboursement-prets-ponctuelles", ponctuelles.length);
  toggleSousSection("operations-bloc-remboursement-prets-recurrentes", recurrentes.length);
}

// Critères de tri pertinents par onglet (côté client : tout est déjà chargé).
// L'utilisateur pourra demander d'en retirer si la liste est trop longue.
const TRI_OPTIONS = {
  classique: [
    ["date-desc", "Date (récent → ancien)"],
    ["date-asc", "Date (ancien → récent)"],
    ["montant-desc", "Montant (décroissant)"],
    ["montant-asc", "Montant (croissant)"],
    ["nature-asc", "Nature (A → Z)"],
    ["compte-asc", "Compte (A → Z)"],
    ["categorie-asc", "Catégorie (A → Z)"],
    ["statut-asc", "Statut"],
  ],
  remboursable: [
    ["date-desc", "Date (récent → ancien)"],
    ["date-asc", "Date (ancien → récent)"],
    ["montant-desc", "Montant (décroissant)"],
    ["montant-asc", "Montant (croissant)"],
    ["reste-desc", "Reste à rembourser (décroissant)"],
    ["reste-asc", "Reste à rembourser (croissant)"],
    ["nature-asc", "Nature (A → Z)"],
    ["compte-asc", "Compte (A → Z)"],
    ["categorie-asc", "Catégorie (A → Z)"],
  ],
  remboursements: [
    ["date-desc", "Date (récent → ancien)"],
    ["date-asc", "Date (ancien → récent)"],
    ["montant-desc", "Montant (décroissant)"],
    ["montant-asc", "Montant (croissant)"],
    ["nature-asc", "Nature (A → Z)"],
    ["compte-asc", "Compte (A → Z)"],
  ],
  virements: [
    ["date-desc", "Date (récent → ancien)"],
    ["date-asc", "Date (ancien → récent)"],
    ["montant-desc", "Montant (décroissant)"],
    ["montant-asc", "Montant (croissant)"],
    ["nature-asc", "Nature (A → Z)"],
    ["compte-asc", "Compte source (A → Z)"],
  ],
  prets: [
    ["date-desc", "Date (récent → ancien)"],
    ["date-asc", "Date (ancien → récent)"],
    ["montant-desc", "Montant (décroissant)"],
    ["montant-asc", "Montant (croissant)"],
    ["reste-desc", "Reste à rembourser (décroissant)"],
    ["reste-asc", "Reste à rembourser (croissant)"],
    ["nature-asc", "Nature (A → Z)"],
    ["compte-asc", "Compte (A → Z)"],
  ],
  "remboursement-prets": [
    ["date-desc", "Date (récent → ancien)"],
    ["date-asc", "Date (ancien → récent)"],
    ["montant-desc", "Montant (décroissant)"],
    ["montant-asc", "Montant (croissant)"],
    ["nature-asc", "Nature (A → Z)"],
    ["compte-asc", "Compte (A → Z)"],
  ],
};

const RENDER_PAR_ONGLET = {
  classique: renderClassiques,
  remboursable: renderRemboursables,
  remboursements: renderRemboursements,
  virements: renderVirements,
  prets: renderPrets,
  "remboursement-prets": renderRemboursementPrets,
};

let operationsParOnglet = {
  classique: [],
  remboursable: [],
  remboursements: [],
  virements: [],
  prets: [],
  "remboursement-prets": [],
};

function comparateurOperation(critere, budget = false) {
  const [champ, sens] = critere.split("-");
  const direction = sens === "asc" ? 1 : -1;
  const valeur = (op) => {
    switch (champ) {
      case "nature":
        return (op.nature || "").toLowerCase();
      case "montant":
        // DANS UN DRILL-THROUGH, le montant qui classe est celui qu'on LIT : la
        // part attribuée au mois pour une dépense amortie. C'est aussi celui du
        // top 3 de l'infobulle d'où l'on vient — le classement est sa suite.
        return budget ? montantAttribueDrill(op) : op.montant;
      case "date":
        return op.date;
      case "compte":
        return nomCompte(op.compte_id).toLowerCase();
      case "categorie":
        return nomCategorie(op.categorie_id).toLowerCase();
      case "statut":
        return op.statut;
      case "reste":
        return op.montant_a_rembourser;
      default:
        return "";
    }
  };
  return (a, b) => {
    const va = valeur(a);
    const vb = valeur(b);
    if (va < vb) return -1 * direction;
    if (va > vb) return 1 * direction;
    return 0;
  };
}

// Période affichée sur la page Opérations, partagée par les six onglets : le
// mois reste le même quand on passe d'un type à l'autre, ce qui est le
// comportement attendu quand on dépouille un mois donné.
//
// `vue` est le niveau de l'arborescence qui filtre réellement : "mois" ne garde
// que le mois choisi, "annee" toute l'année (la pastille ronde du sélecteur dit lequel,
// cf. creerArbrePeriode). L'autre niveau n'est jamais
// oublié — on reste dans un mois DE cette année.
//
// « TOUT » EST LE TROISIÈME CRAN, et il n'existe que sur cette page : plus
// aucune borne de date, toutes les opérations de la base. Il a été ajouté avec
// la bascule automatique de période (cf. periodeQueDecritLeFiltre) parce qu'il
// FALLAIT une réponse au cas où le filtre ne tombe ni dans un mois ni dans une
// année — un filtre « depuis mars 2024 » ne se range nulle part dans
// l'arborescence, et le laisser sur le mois en cours aurait rendu un tableau
// vide qui ne dit pas pourquoi. Le dashboard, lui, ne le connaît pas : sa vue
// voyage jusqu'au serveur, où elle vaut "mois" ou "annee" et rien d'autre.
// `niveau` et `moisDeplie` sont ceux de l'arbre de période partagé avec le dashboard (cf. creerArbrePeriode) ;
// `niveau` est recopié depuis `vue` à chaque rendu.
const operationsPeriode = { annee: null, mois: null, vue: "mois", niveau: "mois", moisDeplie: true };

function operationDansPeriode(op) {
  if (operationsPeriode.vue === "tout") return true;
  if (!operationsPeriode.annee) return true;
  const [annee, mois] = op.date.split("-").map(Number);
  if (annee !== operationsPeriode.annee) return false;
  return operationsPeriode.vue === "annee" || mois === operationsPeriode.mois;
}

/* ---------- Filtrage par propriétés, un panneau par onglet ----------
 *
 * ENTIÈREMENT CÔTÉ CLIENT, comme le filtre de période juste au-dessus : la
 * page charge déjà tout (cf. loadOperations), et chaque onglet a ses PROPRES
 * propriétés (une "découpe" n'a aucun sens sur un virement, un "compte
 * destination" n'existe que pour un virement) — les donner à un seul filtre
 * partagé, envoyé au serveur, aurait demandé un paramètre par propriété de
 * chaque type et un filtre posé sur un onglet aurait affecté les cinq autres,
 * qui partagent le même chargement.
 */

// "" = peu importe (case non touchée), "oui"/"non" comparés au booléen réel.
function correspondBool(valeurFiltre, booleenReel) {
  if (valeurFiltre === "") return true;
  return (valeurFiltre === "oui") === Boolean(booleenReel);
}

// Insensible à la casse et aux accents, comme la recherche Ctrl+F de la page
// (cf. normaliserRecherche) : "carrefour" doit retrouver "CARREFOUR".
function correspondTexte(valeurFiltre, texteReel) {
  if (!valeurFiltre) return true;
  return normaliserRecherche(texteReel || "").includes(normaliserRecherche(valeurFiltre));
}

// Sur la valeur ABSOLUE du montant, comme l'ancien filtre partagé qu'il
// remplace : "au moins 50" attrape aussi bien une dépense de 80 € qu'une
// entrée de 80 € (cf. l'infobulle posée sur chaque champ "Montant min").
function correspondMontant(min, max, montant) {
  const abs = Math.abs(montant);
  if (min !== "" && abs < parseFloat(min)) return false;
  if (max !== "" && abs > parseFloat(max)) return false;
  return true;
}

// Sur une valeur déjà positive par nature (reste à rembourser, montant dû) :
// pas de valeur absolue à prendre, contrairement à correspondMontant.
function correspondPlage(min, max, valeur) {
  if (min !== "" && valeur < parseFloat(min)) return false;
  if (max !== "" && valeur > parseFloat(max)) return false;
  return true;
}

function correspondDate(dateDebut, dateFin, dateReelle) {
  if (dateDebut && dateReelle < dateDebut) return false;
  if (dateFin && dateReelle > dateFin) return false;
  return true;
}

/**
 * CE QUI EST ACTIF, ÉCRIT SUR LE BANDEAU DU REPLI.
 *
 * Les filtres sont repliés par défaut (quatorze champs pour six onglets, qui
 * repoussaient le tableau sous un écran de champs vides). Un repli muet aurait
 * créé le piège que ce bandeau existe pour éviter : un filtre posé puis caché
 * est l'explication la plus probable d'un tableau vide, et la plus difficile à
 * trouver — on relit trois fois ses opérations avant de penser à déplier une
 * section qu'on avait oubliée.
 *
 * ON COMPTE LES CHAMPS REMPLIS, pas les lignes écartées : c'est ce que
 * l'utilisateur peut défaire, et « 3 filtres actifs » se rapporte à des champs
 * qu'il va retrouver en ouvrant. Rien de rempli, rien d'écrit — un « 0 filtre »
 * permanent serait du bruit sur les six onglets à la fois.
 */
function majResumeFiltres(onglet) {
  const resume = document.getElementById(`filtres-resume-${onglet}`);
  if (!resume) return;
  const actifs = Object.values(lireFiltresOnglet(onglet)).filter((v) => v !== "").length;
  resume.textContent = actifs === 0 ? "" : t("· {n} actif(s)", { n: actifs });
  // Et chaque champ rempli passe son texte en bleu (cf. .filtre-rempli) : la valeur
  // d'un montant max, le « Oui » d'une dépense récurrente. On voit d'un coup d'œil
  // LESQUELS des champs filtrent, sans avoir à les relire tous.
  document.querySelectorAll(`#filtres-${onglet} [data-filtre]`).forEach((champ) => {
    champ.classList.toggle("filtre-rempli", champ.value.trim() !== "");
  });
  // Le bandeau entier passe en bleu quand un filtre est posé (cf. .filtres-actifs).
  document.getElementById(`filtres-repli-${onglet}`)?.classList.toggle("filtres-actifs", actifs > 0);
}

/**
 * Déplie le panneau et met son bandeau à jour.
 *
 * APPELÉ QUAND UN FILTRE ARRIVE D'AILLEURS, et c'est le seul cas où l'écran
 * ouvre la section tout seul : le drill-through « Voir toutes les dépenses »
 * pose une catégorie et deux dates, et arriver sur un tableau filtré dont les
 * filtres sont cachés est exactement ce qu'on ne veut pas.
 */
function ouvrirFiltresOnglet(onglet) {
  const repli = document.getElementById(`filtres-repli-${onglet}`);
  if (repli) repli.open = true;
  majResumeFiltres(onglet);
}

// Lit tous les champs [data-filtre] du panneau de l'onglet — un seul endroit
// à mettre à jour si un champ change de nom, plutôt qu'un getElementById par
// propriété et par onglet.
function lireFiltresOnglet(onglet) {
  const panneau = document.getElementById(`filtres-${onglet}`);
  const filtres = {};
  if (!panneau) return filtres;
  panneau.querySelectorAll("[data-filtre]").forEach((el) => {
    filtres[el.dataset.filtre] = el.value.trim();
  });
  return filtres;
}

function operationCorrespondFiltres(op, onglet, f, budget = false) {
  if (!correspondTexte(f.nature, op.nature)) return false;
  // `budget` : arrivé d'un drill-through, la « date » d'une opération amortie est
  // le mois qu'elle pèse, pas celui où l'argent est sorti.
  if (budget ? !operationDansBudgetDrill(op) : !correspondDate(f.dateDebut, f.dateFin, op.date)) {
    return false;
  }
  if (f.monnaieId && String(op.monnaie_id) !== f.monnaieId) return false;
  if (f.montantMin !== undefined && !correspondMontant(f.montantMin, f.montantMax, op.montant)) {
    return false;
  }
  if (f.compteId && String(op.compte_id) !== f.compteId) return false;
  if (f.statut !== undefined && f.statut !== "" && op.statut !== f.statut) return false;
  if (f.recurrente !== undefined && !correspondBool(f.recurrente, op.recurrente)) return false;
  if (f.amortie !== undefined && !correspondBool(f.amortie, op.amorti)) return false;
  if (f.montantDuMin !== undefined && !correspondPlage(f.montantDuMin, f.montantDuMax, op.montant_du)) {
    return false;
  }
  if (f.resteMin !== undefined && !correspondPlage(f.resteMin, f.resteMax, op.montant_a_rembourser)) {
    return false;
  }
  switch (onglet) {
    case "classique": {
      // UNE OPÉRATION DÉCOUPÉE N'A PAS DE CATÉGORIE PROPRE (ses parts SONT sa
      // classification) : elle remonte dès qu'UNE de ses parts est dans la catégorie
      // filtrée. Comparer seulement `categorie_id`, NULL pour elle, la faisait
      // disparaître de tout filtre par catégorie.
      if (f.categorieId) {
        const dansUnePart = (op.decoupes || []).some(
          (part) => String(part.categorie_id) === f.categorieId
        );
        if (String(op.categorie_id) !== f.categorieId && !dansUnePart) return false;
      }
      const estDecoupee = (op.decoupes || []).length > 0;
      if (!correspondBool(f.decoupe, estDecoupee)) return false;
      return true;
    }
    case "remboursable":
      if (f.categorieId && String(op.categorie_id) !== f.categorieId) return false;
      return true;
    case "remboursements":
    case "remboursement-prets": {
      const estLiee = (op.operations_remboursees || []).length > 0;
      if (!correspondBool(f.lie, estLiee)) return false;
      return true;
    }
    default:
      return true;
  }
}

// L'onglet Virements affiche des PAIRES (cf. loadOperations) : la nature, la
// date et le statut valent pour les deux jambes (une seule saisie côté
// formulaire), mais montant/monnaie/compte diffèrent d'un côté à l'autre.
// Une jambe absente (paire "solo", cf. operationDansPeriode) ne peut
// satisfaire un filtre qui la concerne — plutôt que de le laisser passer en
// silence, ce qui masquerait un virement réellement incomplet parmi ceux qui
// ne correspondent simplement pas.
function virementCorrespondFiltres(paire, f) {
  const { sortante, entrante } = paire;
  const reference = sortante || entrante;
  if (!correspondTexte(f.nature, reference.nature)) return false;
  if (!correspondDate(f.dateDebut, f.dateFin, reference.date)) return false;
  if (f.statut && reference.statut !== f.statut) return false;

  const filtreSortanteActif = f.montantEnvoyeMin || f.montantEnvoyeMax || f.monnaieEnvoyeeId || f.compteSourceId;
  if (sortante) {
    if (!correspondMontant(f.montantEnvoyeMin, f.montantEnvoyeMax, sortante.montant)) return false;
    if (f.monnaieEnvoyeeId && String(sortante.monnaie_id) !== f.monnaieEnvoyeeId) return false;
    if (f.compteSourceId && String(sortante.compte_id) !== f.compteSourceId) return false;
  } else if (filtreSortanteActif) {
    return false;
  }

  const filtreEntranteActif = f.montantRecuMin || f.montantRecuMax || f.monnaieRecueId || f.compteDestinationId;
  if (entrante) {
    if (!correspondMontant(f.montantRecuMin, f.montantRecuMax, entrante.montant)) return false;
    if (f.monnaieRecueId && String(entrante.monnaie_id) !== f.monnaieRecueId) return false;
    if (f.compteDestinationId && String(entrante.compte_id) !== f.compteDestinationId) return false;
  } else if (filtreEntranteActif) {
    return false;
  }

  if (f.frais !== "") {
    const aDesFrais = Boolean((sortante && sortante.frais) || (entrante && entrante.frais));
    if (!correspondBool(f.frais, aDesFrais)) return false;
  }
  return true;
}

function trierEtRerender(onglet) {
  const critere = state.triSelections[onglet];
  const filtres = lireFiltresOnglet(onglet);
  let liste;
  if (onglet === "virements") {
    liste = operationsParOnglet[onglet].filter(
      ([, paire]) =>
        operationDansPeriode(paire.sortante || paire.entrante) &&
        virementCorrespondFiltres(paire, filtres)
    );
    const base = comparateurOperation(critere);
    // Une paire "solo" (virement importé sans second compte connu, cf.
    // loadOperations) n'a que sortante OU entrante : trier sur celle des
    // deux qui existe plutôt que sur sortante uniquement.
    liste.sort((a, b) => base(a[1].sortante || a[1].entrante, b[1].sortante || b[1].entrante));
  } else {
    // ARRIVÉ D'UN DRILL-THROUGH, c'est le BUDGET du mois qui dit quelles
    // opérations sont là, et non leur date : les bornes du filtre le décrivent
    // seules, la rangée d'onglets de période n'a plus à trancher (cf.
    // operationDansBudgetDrill).
    const drill = drillActif(onglet);
    liste = operationsParOnglet[onglet]
      .filter((op) => drill || operationDansPeriode(op))
      .filter((op) => operationCorrespondFiltres(op, onglet, filtres, drill));
    liste.sort(comparateurOperation(critere, drill));
  }
  RENDER_PAR_ONGLET[onglet](liste);
}

// Un sélecteur de période par onglet (ils doivent vivre dans l'onglet de
// type), mais tous pilotent le même état : changer de mois dans un onglet le
// change partout, sinon revenir sur un onglet afficherait un autre mois.
//
// Le sélecteur est celui du dashboard (creerArbrePeriode, avec « Tout »), posé six fois - un par onglet -
// sur un seul état : à chaque geste, les six sont redessinés ensemble.
let periodesOperations = [];

async function initSelecteursPeriodeOperations() {
  // `inclure_amortissements=false` : cette page liste des opérations À LEUR
  // DATE. Un mois qui ne reçoit qu'une part d'amortissement n'a aucune ligne à
  // y montrer — son onglet n'ouvrait qu'un tableau vide, et il y en avait
  // autant que de mois d'étalement. Le dashboard, lui, garde ces mois : c'est
  // bien là que la dépense pèse (cf. get_periodes côté serveur).
  periodesOperations = await apiFetch("/meta/periodes?inclure_amortissements=false");
  if (periodesOperations.length === 0) return;
  if (!operationsPeriode.annee) {
    const defaut = periodeParDefaut(periodesOperations);
    operationsPeriode.annee = defaut.annee;
    operationsPeriode.mois = defaut.mois;
  }
  renderSelecteursPeriodeOperations();
}

function moisDisponiblesOperations(annee) {
  return periodesOperations
    .filter((p) => p.annee === annee)
    .map((p) => p.mois)
    .sort((a, b) => a - b);
}

/**
 * Les onglets d'année et de mois à afficher.
 *
 * CE QUE /meta/periodes RENVOIE NE SUFFIT PLUS : il ne nomme que les périodes
 * qui PORTENT des opérations, ce qui était juste tant que la période se
 * choisissait à la main — un onglet vide n'aurait servi à rien. Mais le filtre
 * la désigne maintenant tout seul (cf. synchroniserPeriodeAvecFiltres), et il
 * peut parfaitement désigner un mois sans la moindre ligne. Sans son onglet,
 * l'écran montrait un tableau vide SOUS UNE RANGÉE OÙ AUCUN MOIS N'EST ALLUMÉ :
 * impossible de savoir ce qu'on regarde, ni comment en sortir.
 *
 * LA PÉRIODE CHOISIE EST DONC TOUJOURS DANS LA LISTE, qu'elle porte quelque
 * chose ou non ; les mois d'une année inconnue de /meta/periodes se réduisent à
 * celui-là, plutôt que d'étaler douze onglets vides.
 */
function anneesOngletsOperations() {
  const annees = new Set(periodesOperations.map((p) => p.annee));
  if (operationsPeriode.annee) annees.add(operationsPeriode.annee);
  return [...annees].sort((a, b) => b - a);
}

function moisOngletsOperations(annee) {
  const mois = new Set(moisDisponiblesOperations(annee));
  if (annee === operationsPeriode.annee && operationsPeriode.mois) {
    mois.add(operationsPeriode.mois);
  }
  return [...mois].sort((a, b) => a - b);
}

function renderSelecteursPeriodeOperations() {
  // LE MÊME ARBRE QUE LE DASHBOARD (creerArbrePeriode) : Tout, l'année, le mois, une pastille ronde sur
  // le niveau qui filtre. `niveau` et `vue` disent ici la même chose (« tout », « annee » ou « mois »).
  // Les six onglets pilotent le MÊME état : chaque geste le modifie en place, puis `surChangement`
  // redessine les six arbres et les listes d'un coup (cf. appliquerPeriodeOperations).
  operationsPeriode.niveau = operationsPeriode.vue;
  Object.keys(COLONNES_OPERATIONS).forEach((onglet) => {
    const hote = document.getElementById(`operations-periode-${onglet}`);
    if (!hote) return;
    creerArbrePeriode(hote, {
      etat: operationsPeriode,
      annees: anneesOngletsOperations,
      moisDisponibles: moisOngletsOperations,
      avecTout: true,
      surChangement: () => appliquerPeriodeOperations(),
    });
  });
}

function appliquerPeriodeOperations() {
  // Une édition en cours porte sur une opération qui peut sortir de la
  // période : la ranger avant de tout réafficher.
  resetOperationForm();
  fermerFormulaireOperation();
  renderSelecteursPeriodeOperations();
  Object.keys(COLONNES_OPERATIONS).forEach(trierEtRerender);
}

/* ---------- FILTRER SUR DES DATES CHOISIT AUSSI LA PÉRIODE ----------
 *
 * DEUX FILTRES DE DATE POUR UN SEUL ÉCRAN, et ils se combinaient en ET : la
 * rangée d'onglets bornait déjà la période, et les champs « Du/Au » la
 * bornaient une seconde fois. Rien ne le disait, et le résultat le plus
 * ordinaire de ce cumul était un tableau VIDE — deux bornes qui ne se
 * recoupent pas ne gardent rien.
 *
 * C'ÉTAIT LE DÉFAUT DU DRILL-THROUGH, exactement : « Voir toutes les dépenses »
 * depuis une barre d'août posait un filtre sur août, et atterrissait sur la
 * page Opérations ouverte sur SON mois à elle — le mois courant. Le tableau
 * était vide, alors que les dépenses existaient : elles étaient simplement dans
 * l'autre mois.
 *
 * LA RÈGLE : l'intervalle demandé décide du cran. Contenu dans un mois, on
 * bascule sur ce mois ; contenu dans une année, sur cette année ; sinon sur
 * « Tout », le cran qui n'a été ajouté que pour ça. Les onglets cessent ainsi
 * de contredire les champs, et ils DISENT ce que les champs demandent — on lit
 * sur la rangée ce qu'on regarde, au lieu de le déduire de deux dates.
 *
 * UN INTERVALLE OUVERT N'EST CONTENU NULLE PART : « depuis mars 2024 » sans
 * borne de fin va donc à « Tout », et c'est la bonne réponse — le ranger dans
 * mars 2024 aurait caché tout ce qui vient après, c'est-à-dire ce qu'on
 * demandait.
 *
 * DEUX CHAMPS VIDES NE BASCULENT RIEN. Effacer ses dates (ou cliquer
 * « Réinitialiser ») ne décrit aucune période : ramener d'office au mois
 * courant aurait fait sauter l'onglet qu'on venait de choisir à la main. C'est
 * le seul cas où l'on ne touche à rien — un seul champ rempli, lui, DÉCRIT
 * quelque chose, et ce quelque chose n'est contenu nulle part.
 */

/** Le cran que décrivent les deux champs de date d'un onglet, ou null quand ils
 *  ne décrivent rien — auquel cas la période ne bouge pas. */
function periodeQueDecritLeFiltre(onglet) {
  const filtres = lireFiltresOnglet(onglet);
  const debut = filtres.dateDebut;
  const fin = filtres.dateFin;
  // AUCUNE DES DEUX : rien n'est demandé. Ne pas confondre avec « tout » — la
  // rangée garde l'onglet choisi à la main, que « Réinitialiser » ne doit pas
  // faire sauter au passage.
  if (!debut && !fin) return null;
  // UNE SEULE : l'intervalle est OUVERT d'un côté, donc contenu dans aucun mois
  // ni aucune année. « Depuis mars 2024 » rangé dans mars 2024 aurait caché
  // tout ce qui vient après, c'est-à-dire exactement ce qu'on demandait.
  if (!debut || !fin) return { vue: "tout" };
  // Bornes inversées : un état que la frappe traverse, et qui ne retient rien.
  // Y réagir ferait sauter la rangée sur une saisie en cours.
  if (debut > fin) return null;
  const [anneeDebut, moisDebut] = debut.split("-").map(Number);
  const [anneeFin, moisFin] = fin.split("-").map(Number);
  if (anneeDebut !== anneeFin) return { vue: "tout" };
  if (moisDebut !== moisFin) return { vue: "annee", annee: anneeDebut };
  return { vue: "mois", annee: anneeDebut, mois: moisDebut };
}

/** Aligne la période sur ce que les dates du filtre décrivent. Rend `true` si
 *  quelque chose a bougé — l'appelant réaffiche alors tout plutôt que le seul
 *  onglet dont un champ vient de changer, les six partageant la période. */
function synchroniserPeriodeAvecFiltres(onglet) {
  const cible = periodeQueDecritLeFiltre(onglet);
  if (!cible) return false;
  const identique =
    cible.vue === operationsPeriode.vue &&
    (cible.annee === undefined || cible.annee === operationsPeriode.annee) &&
    (cible.mois === undefined || cible.mois === operationsPeriode.mois);
  if (identique) return false;
  operationsPeriode.vue = cible.vue;
  if (cible.annee !== undefined) operationsPeriode.annee = cible.annee;
  if (cible.mois !== undefined) operationsPeriode.mois = cible.mois;
  appliquerPeriodeOperations();
  return true;
}

function initTriSelects() {
  document.querySelectorAll("select.tri-select").forEach((select) => {
    const onglet = select.dataset.onglet;
    if (select.options.length === 0) {
      // Traduits ici plutôt que dans TRI_OPTIONS : la table est une constante
      // évaluée au chargement du script, où `t()` marcherait aussi, mais la
      // garder en français la laisse lisible en regard du reste du fichier.
      fillSelect(
        select,
        TRI_OPTIONS[onglet].map(([value, label]) => ({ value, label: t(label) }))
      );
      select.value = state.triSelections[onglet];
      select.addEventListener("change", () => {
        state.triSelections[onglet] = select.value;
        trierEtRerender(onglet);
      });
    }
  });
}

async function loadOperations() {
  try {
    // Les tbody sont reconstruits par innerHTML plus bas : si le formulaire
    // est encore dans l'un d'eux, il serait détruit avec tous ses écouteurs.
    fermerFormulaireOperation();
    initTriSelects();
    await initSelecteursPeriodeOperations();
    await refreshComptes();
    await refreshCategories();
    await refreshMonnaies();
    updateOperationTypeFields();
    // Le filtrage (période ET propriétés, cf. operationCorrespondFiltres) est
    // entièrement côté client, sur le mois comme sur le reste : la page
    // charge donc TOUJOURS tout, une fois, plutôt que d'aller-retour au
    // serveur à chaque champ de filtre posé sur un onglet.
    operationsCache = await apiFetch("/operations?paires_virement=true");

    operationsParOnglet.classique = [];
    operationsParOnglet.remboursable = [];
    operationsParOnglet.remboursements = [];
    operationsParOnglet.prets = [];
    operationsParOnglet["remboursement-prets"] = [];
    const virementPaires = new Map();

    // L'onglet se lit directement dans le type de l'opération. Seuls les
    // virements demandent un traitement à part : ils s'affichent par paire.
    const ONGLET_PAR_TYPE = {
      classique: "classique",
      remboursable: "remboursable",
      remboursements: "remboursements",
      pret: "prets",
      remboursement_pret: "remboursement-prets",
    };
    // Les écritures d'espèces des achats/ventes de titres ne s'affichent pas
    // ici : elles n'existent que par leur contrepartie et se gèrent depuis la
    // onglet Placements financiers.
    const codesInternes = new Set(
      state.typesOperation.filter((t) => t.interne).map((t) => t.code)
    );
    operationsCache = operationsCache.filter((op) => !codesInternes.has(op.type_code));

    operationsCache.forEach((op) => {
      // Un virement importé sans second compte connu reste une écriture simple
      // (pas de virement_id, cf. services/import_bancaire.confirmer) mais garde
      // le type "virement" : une clé synthétique "solo-<id>" le fait apparaître
      // seul dans l'onglet Virements (l'autre côté affiché "-", cf.
      // renderVirements).
      if (op.type_code === "virement") {
        const cle = op.virement_id || `solo-${op.id}`;
        const paire = virementPaires.get(cle) || {};
        if (op.sens === "transfert_sortant") paire.sortante = op;
        else paire.entrante = op;
        virementPaires.set(cle, paire);
        return;
      }
      operationsParOnglet[ONGLET_PAR_TYPE[op.type_code] || "classique"].push(op);
    });
    operationsParOnglet.virements = [...virementPaires.entries()];

    Object.keys(operationsParOnglet).forEach((onglet) => trierEtRerender(onglet));
  } catch (err) {
    showMessage(err.message, "error");
  }
}

// Récurrence : jamais éditable depuis une occurrence générée (le formulaire
// masque déjà les champs dans ce cas, cf. updateOperationTypeFields) -- objet
// vide pour ne rien envoyer plutôt qu'un état incohérent. Sinon, reflète la
// case à cocher + fréquence + (date de fin ou infini).
function recurrencePayload() {
  if (operationEditionEstOccurrenceGeneree) return {};
  const recurrente = document.getElementById("operation-recurrente").checked;
  if (!recurrente) return { recurrente: false, frequence: null, recurrence_fin: null };
  const infini = document.getElementById("operation-recurrence-infini").checked;
  return {
    recurrente: true,
    frequence: document.getElementById("operation-frequence").value,
    recurrence_fin: infini ? null : document.getElementById("operation-recurrence-fin").value || null,
  };
}

// Amortissement : la case fait foi (updateOperationTypeFields la décoche dès
// que le bloc cesse d'être proposé), d'où un état toujours explicite plutôt
// qu'un objet vide -- c'est ce qui efface les bornes d'une opération qu'on
// n'amortit plus. Les champs mois+année valent "AAAA-MM" ; le serveur attend
// une date, et la ramène de toute façon au 1er du mois.
function amortissementPayload() {
  if (!document.getElementById("operation-amorti").checked) {
    return { amorti: false, amortissement_debut: null, amortissement_fin: null };
  }
  const { debutEl, finEl } = _champsAmortissement();
  return {
    amorti: true,
    amortissement_debut: `${debutEl.value}-01`,
    amortissement_fin: `${finEl.value}-01`,
  };
}

// Renvoie un message d'erreur si l'amortissement est incomplet, sinon null. Les
// deux bornes sont les seules obligatoires : le nombre de mois s'en déduit, et
// remplir n'importe quelles deux cases suffit à ce que la troisième se remplisse.
function erreurAmortissement() {
  if (!document.getElementById("operation-amorti").checked) return null;
  const { debutEl, finEl } = _champsAmortissement();
  if (!debutEl.value || !finEl.value) {
    return t("Renseigne deux des trois cases d'amortissement (premier mois, dernier mois, nombre de mois).");
  }
  return null;
}

/**
 * Enregistre une opération ORDINAIRE (tout sauf un virement) ; rend vrai si c'était une
 * modification.
 *
 * UN VIREMENT QU'ON MODIFIE ET QUI CESSE D'EN ÊTRE UN (migration 0090 : une autre catégorie que
 * « Virements internes », ou un autre type) part vers POST /virements/{id}/operation : la jambe du
 * compte choisi devient l'opération, l'autre disparaît. Sans cela, l'opération se créait à côté
 * du virement, qui restait en base.
 */
async function enregistrerOperationOrdinaire(payload, id) {
  if (virementEnEdition) {
    await apiFetch(`/virements/${virementEnEdition}/operation`, {
      method: "POST",
      body: JSON.stringify(payload),
    });
    return true;
  }
  if (id) {
    await apiFetch(`/operations/${id}`, { method: "PUT", body: JSON.stringify(payload) });
    return true;
  }
  await apiFetch("/operations", { method: "POST", body: JSON.stringify(payload) });
  return false;
}

document.getElementById("form-operation").addEventListener("submit", async (e) => {
  e.preventDefault();
  const id = document.getElementById("operation-id").value;
  const type = document.getElementById("operation-type").value;
  // Le champ n'existe qu'à l'édition (cf. operation-notes-bloc) : à la
  // création, ne rien envoyer plutôt qu'une chaîne vide, pour que la colonne
  // reste NULL tant que personne n'a écrit de note.
  const notesEdition = document.getElementById("operation-notes-bloc").style.display !== "none";
  const champNotes = notesEdition
    ? { notes: document.getElementById("operation-notes").value.trim() || null }
    : {};

  try {
    if (type === "virement") {
      const monnaieSource = Number(document.getElementById("operation-monnaie").value);
      const monnaieDestination = Number(document.getElementById("operation-monnaie-recue").value);
      const montant = parseFloat(document.getElementById("operation-montant").value);
      // Monnaies identiques : le montant reçu est le montant envoyé, et le
      // champ n'est même pas affiché. Sinon il est obligatoire — l'app n'a
      // aucun taux de change pour le deviner.
      const montantRecuSaisi = document.getElementById("operation-montant-recu").value;
      if (monnaieSource !== monnaieDestination && !montantRecuSaisi) {
        showMessage(t("Renseigne le montant reçu : les deux comptes sont dans des monnaies différentes ") +
            "et l'app ne convertit rien.",
          "error"
        );
        return;
      }
      // LES DEUX MONTANTS SONT SAISIS HORS FRAIS quand la case est là : on les
      // recompose ici, du côté que les frais grèvent, pour enregistrer ce qui a
      // réellement bougé sur chaque compte.
      const { frais, monnaie_frais_id: monnaieFrais } = fraisSaisisOperation();
      const montantEnvoye = montantAvecFrais(
        montant,
        operationFrais.cote === "envoye" ? frais : null,
        true
      );
      const montantRecuBrut =
        monnaieSource === monnaieDestination ? montant : parseFloat(montantRecuSaisi);
      const montantRecu = montantAvecFrais(
        montantRecuBrut,
        operationFrais.cote === "recu" ? frais : null,
        false
      );
      const payload = {
        date: document.getElementById("operation-date").value,
        compte_source_id: Number(document.getElementById("operation-compte1").value),
        compte_destination_id: Number(document.getElementById("operation-compte2").value),
        montant: montantEnvoye,
        monnaie_id: monnaieSource,
        monnaie_destination_id: monnaieDestination,
        montant_destination: montantRecu,
        // La devise des frais dit laquelle des deux jambes ils grèvent : sans
        // choix explicite (virement mono-monnaie), c'est celle du côté saisi.
        frais,
        monnaie_frais_id:
          monnaieFrais ||
          (frais ? (operationFrais.cote === "recu" ? monnaieDestination : monnaieSource) : null),
        nature: document.getElementById("operation-nature").value || null,
        statut: statutOperationSaisi(),
        ...champNotes,
      };
      // UNE OPÉRATION EXISTANTE QUI DEVIENT UN VIREMENT (migration 0090 : on lui a choisi la
      // catégorie « Virements internes », ou le type) : elle devient la jambe de son compte, sur
      // place, au lieu de rester à côté du virement neuf.
      if (id && !virementEnEdition) payload.operation_id = Number(id);
      // Les deux écritures se modifient ensemble : d'où un PUT sur la paire
      // plutôt que sur l'une des deux opérations.
      if (virementEnEdition) {
        await apiFetch(`/virements/${virementEnEdition}`, {
          method: "PUT",
          body: JSON.stringify(payload),
        });
        showMessage(t("Virement modifié"), "success");
      } else {
        await apiFetch("/virements", { method: "POST", body: JSON.stringify(payload) });
        showMessage(t("Virement créé"), "success");
      }
    } else if (type === "remboursements" || type === "remboursement_pret") {
      const nature = document.getElementById("operation-nature").value;
      if (!nature) {
        showMessage(t("La nature de l'opération est obligatoire."), "error");
        return;
      }
      const operationsRemboursees = [
        ...document.querySelectorAll("#operation-remboursements-liste .checklist-row"),
      ]
        .map((row) => ({
          operation_id: Number(row.dataset.depenseId),
          montant: parseFloat(row.querySelector(".remb-montant").value || "0"),
        }))
        .filter((item) => item.montant > 0);
      if (operationsRemboursees.length === 0) {
        showMessage(t("Renseigne un montant réglé pour au moins une opération."), "error");
        return;
      }
      const payload = {
        date: document.getElementById("operation-date").value,
        compte_id: Number(document.getElementById("operation-compte").value),
        monnaie_id: Number(document.getElementById("operation-monnaie").value),
        type_id: idTypeOperation(type),
        nature,
        montant: parseFloat(document.getElementById("operation-montant").value || "0"),
        statut: "réel",
        operations_remboursees: operationsRemboursees,
        ...champNotes,
      };
      if (await enregistrerOperationOrdinaire(payload, id)) {
        showMessage(t("Opération modifiée"), "success");
      } else {
        showMessage(t("Opération créée"), "success");
      }
    } else if (type === "pret") {
      const nature = document.getElementById("operation-nature").value;
      if (!nature) {
        showMessage(t("La nature de l'opération est obligatoire."), "error");
        return;
      }
      const erreurAmorti = erreurAmortissement();
      if (erreurAmorti) {
        showMessage(erreurAmorti, "error");
        return;
      }
      const pret = montantEtFraisOperation();
      const payload = {
        date: document.getElementById("operation-date").value,
        compte_id: Number(document.getElementById("operation-compte").value),
        monnaie_id: Number(document.getElementById("operation-monnaie").value),
        type_id: idTypeOperation("pret"),
        nature,
        montant: pret.montant,
        frais: pret.frais,
        monnaie_frais_id: pret.monnaie_frais_id,
        statut: "réel",
        // CE QU'ON RENDRA, intérêts compris — au moins le montant reçu. L'écart
        // entre les deux est le seul coût du prêt, et la seule chose qui pèse
        // sur les sorties du mois (cf. services/soldes.get_flux_periode).
        montant_du: parseFloat(document.getElementById("operation-montant-du").value || "0"),
        ...champNotes,
        ...recurrencePayload(),
        ...amortissementPayload(),
        ...lireRapprochementFormulaire(),
      };
      // Comme pour une dépense remboursable : le reste dû ne se saisit qu'à
      // l'édition, et pas du tout tant qu'un remboursement le verrouille.
      const resteFieldPret = document.getElementById("operation-montant-a-rembourser");
      if (id && !resteFieldPret.disabled) {
        payload.montant_a_rembourser = parseFloat(resteFieldPret.value || "0");
      }
      if (await enregistrerOperationOrdinaire(payload, id)) {
        showMessage(t("Prêt modifié"), "success");
      } else {
        showMessage(t("Prêt créé"), "success");
      }
    } else {
      const nature = document.getElementById("operation-nature").value;
      if (!nature) {
        showMessage(t("La nature de l'opération est obligatoire."), "error");
        return;
      }
      const erreurAmorti = erreurAmortissement();
      if (erreurAmorti) {
        showMessage(erreurAmorti, "error");
        return;
      }
      const erreurParts = erreurDecoupe();
      if (erreurParts) {
        showMessage(erreurParts, "error");
        return;
      }
      const categorieId = Number(document.getElementById("operation-categorie").value);
      const simple = montantEtFraisOperation();
      const payload = {
        date: document.getElementById("operation-date").value,
        compte_id: Number(document.getElementById("operation-compte").value),
        monnaie_id: Number(document.getElementById("operation-monnaie").value),
        type_id: idTypeOperation(type),
        categorie_id: categorieId,
        nature,
        montant: simple.montant,
        frais: simple.frais,
        monnaie_frais_id: simple.monnaie_frais_id,
        statut: statutOperationSaisi(),
        ...champNotes,
        ...recurrencePayload(),
        // EN DERNIER : sur une découpe, il écrase `categorie_id` par null —
        // les deux répondent à la même question, et c'est la découpe qui
        // l'emporte quand elle est là.
        ...decoupePayload(),
        ...amortissementPayload(),
        // Toujours envoyé, même vide : décocher la case est un geste, et il
        // doit défaire ce que cocher avait fait (cf. lireRapprochementFormulaire).
        ...lireRapprochementFormulaire(),
        // Même raison : décocher « imprévue » doit la retirer, pas la laisser.
        // Toujours false sur un type qui ne peut pas la porter (cf.
        // updateOperationTypeFields).
        imprevue: document.getElementById("operation-imprevue").checked,
        // Même raison : décocher « à déclarer » doit la retirer. Toujours false hors d'une
        // entrée de type classique (cf. majADeclarerOperation) — le serveur le garantit aussi.
        a_declarer: document.getElementById("operation-a-declarer").checked,
      };
      if (type === "remboursable") {
        payload.montant_du = parseFloat(document.getElementById("operation-montant-du").value || "0");
        // Non affiché/saisi à la création (le serveur le déduit du montant à
        // rembourser) ; modifiable uniquement en édition, sauf si verrouillé
        // par un remboursement lié.
        const resteField = document.getElementById("operation-montant-a-rembourser");
        if (id && !resteField.disabled) {
          payload.montant_a_rembourser = parseFloat(resteField.value || "0");
        }
      }
      if (await enregistrerOperationOrdinaire(payload, id)) {
        showMessage(t("Opération modifiée"), "success");
      } else {
        showMessage(t("Opération créée"), "success");
      }
    }
    resetOperationForm();
    // La ligne d'édition disparaît avec le rechargement de la liste : la
    // retirer d'abord évite qu'elle survive à un tbody reconstruit.
    fermerFormulaireOperation();
    loadOperations();
  } catch (err) {
    showMessage(err.message, "error");
  }
});

// [data-sous-section] exclut le sélecteur de type d'opération du formulaire,
// qui réutilise la classe .sous-onglets pour un rendu identique mais gère son
// propre état via data-type (voir setOperationType).
//
// La bascule est cantonnée à la <section> du bouton cliqué : Opérations et
// Paramètres ont chacun leur jeu d'onglets, et les désactiver tous d'un coup
// (ce que faisait un querySelectorAll global) laissait la page qu'on quitte
// sans aucune sous-section active en y revenant.
//
// DÉLÉGUÉ SUR LE DOCUMENT, et non posé bouton par bouton : les onglets de
// Paramètres apportés par une extension sont ajoutés bien après l'évaluation
// de ce fichier (cf. frontend/extensions.js), et un écouteur attaché à la
// liste des boutons existants les manquerait — leur clic ne ferait rien.
document.addEventListener("click", (e) => {
  const btn = e.target.closest(".sous-onglets button[data-sous-section]");
  if (!btn) return;
  // Une édition en cours appartient à l'onglet qu'on quitte : la ranger
  // évite de laisser le formulaire dans une sous-section masquée.
  resetOperationForm();
  fermerFormulaireOperation();
  const portee = btn.closest("section");
  btn
    .closest(".sous-onglets")
    .querySelectorAll("button[data-sous-section]")
    .forEach((b) => b.classList.remove("active"));
  btn.classList.add("active");
  portee.querySelectorAll(":scope > .sous-section").forEach((s) => s.classList.remove("active"));
  const cible = document.getElementById(`sous-section-${btn.dataset.sousSection}`);
  // Une sous-section peut manquer si l'extension qui la fournit a échoué à
  // charger : mieux vaut un onglet sans contenu qu'une exception qui casse le
  // reste du gestionnaire.
  if (cible) cible.classList.add("active");
  activerCompagnons(btn);
  // Le terme de recherche survit au changement d'onglet : il s'applique
  // maintenant à celui qu'on vient d'ouvrir.
  appliquerRecherche();
});

// Case "Ajouter une opération" en tête de chaque onglet : ouvre un
// formulaire vierge déjà typé par l'onglet courant.
document.querySelectorAll(".ajouter-operation").forEach((carte) => {
  const ouvrir = () => {
    const onglet = carte.dataset.onglet;
    resetOperationForm();
    ouvrirFormulaireOperation(onglet, null);
    setOperationType(TYPE_PAR_ONGLET[onglet]);
    document.getElementById("form-operation-titre").textContent = t("Nouvelle opération");
    document.getElementById("operation-annuler").style.display = "inline-block";
  };
  carte.addEventListener("click", ouvrir);
  carte.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      ouvrir();
    }
  });
});

document.getElementById("operation-annuler").addEventListener("click", () => {
  resetOperationForm();
  fermerFormulaireOperation();
});
document.getElementById("btn-supprimer-toutes-operations").addEventListener("click", async () => {
  if (
    !confirm(t("Supprimer TOUTES les opérations ? Action irréversible — pensé pour vider des données de test.")
    )
  ) {
    return;
  }
  try {
    const resultat = await apiFetch("/operations", { method: "DELETE" });
    showMessage(`${resultat.supprimees} opération(s) supprimée(s)`, "success");
    loadOperations();
  } catch (err) {
    showMessage(err.message, "error");
  }
});

// Filtrage réactif : chaque panneau (#filtres-<onglet>, un par onglet de la
// page Opérations) applique ses champs au fil de la frappe/sélection, sans
// bouton "Filtrer" — un seul écouteur délégué couvre les six. `input` pour le
// texte/nombre/date à chaque frappe, `change` pour les <select> (certains
// navigateurs ne déclenchent pas `input` dessus).
/**
 * UN FILTRE POSÉ VAUT POUR TOUS LES ONGLETS qui ont le même champ : changer
 * d'onglet (ou de page) ne le défait pas. Il vit dans les champs eux-mêmes, donc
 * jusqu'à la fermeture de l'application — ou jusqu'à « Réinitialiser », qui le
 * retire partout.
 *
 * Les champs se reconnaissent à leur NOM (`data-filtre`). Un menu n'est aligné
 * que si l'autre onglet propose cette valeur (une catégorie n'existe pas dans
 * l'onglet des virements : rien n'est écrit, plutôt qu'un menu vidé).
 * Les autres onglets sont réaffichés en différé et d'un seul coup : un onglet
 * qu'on ne regarde pas n'a pas à se redessiner à chaque frappe.
 */
let rerenduAutresOngletsTimer = null;
function propagerFiltreAuxAutresOnglets(champ, ongletSource) {
  const nom = champ.dataset.filtre;
  if (!nom) return;
  const touches = [];
  document.querySelectorAll(".filtres[id^='filtres-']").forEach((panneau) => {
    const onglet = panneau.id.slice("filtres-".length);
    if (onglet === ongletSource) return;
    const cible = panneau.querySelector(`[data-filtre="${nom}"]`);
    if (!cible || cible.value === champ.value) return;
    if (
      cible.tagName === "SELECT" &&
      champ.value !== "" &&
      ![...cible.options].some((o) => o.value === champ.value)
    ) {
      return;
    }
    cible.value = champ.value;
    majResumeFiltres(onglet);
    touches.push(onglet);
  });
  if (!touches.length) return;
  clearTimeout(rerenduAutresOngletsTimer);
  rerenduAutresOngletsTimer = setTimeout(() => {
    touches.forEach((onglet) => trierEtRerender(onglet));
  }, 200);
}

function gererChangementFiltreOperations(e) {
  const panneau = e.target.closest(".filtres[id^='filtres-']");
  if (!panneau) return;
  const onglet = panneau.id.slice("filtres-".length);
  propagerFiltreAuxAutresOnglets(e.target, onglet);
  // SEULES LES DEUX DATES DÉPLACENT LA PÉRIODE (cf. synchroniserPeriodeAvecFiltres).
  // Le faire à chaque champ aurait renvoyé au mois courant dès qu'on tape trois
  // lettres dans « Nature », en défaisant l'onglet choisi à la main juste avant.
  const champDate = ["dateDebut", "dateFin"].includes(e.target.dataset.filtre);
  majResumeFiltres(onglet);
  if (champDate && synchroniserPeriodeAvecFiltres(onglet)) return; // a tout réaffiché
  trierEtRerender(onglet);
}
document.addEventListener("input", gererChangementFiltreOperations);
document.addEventListener("change", gererChangementFiltreOperations);

document.querySelectorAll(".btn-reset-filtres-onglet").forEach((bouton) => {
  bouton.addEventListener("click", () => {
    const onglet = bouton.dataset.onglet;
    document
      .querySelectorAll(`#filtres-${onglet} [data-filtre]`)
      .forEach((champ) => {
        champ.value = "";
        // Le filtre se retire PARTOUT : il valait pour tous les onglets.
        propagerFiltreAuxAutresOnglets(champ, onglet);
      });
    majResumeFiltres(onglet);
    // « RÉINITIALISER » RAMÈNE À LA VUE DE BASE, tri compris. Un drill-through
    // pose un tri par montant décroissant, qui fait descendre la date dans une
    // colonne (cf. colonnesOperations) : retirer les filtres sans lui rendre son
    // tri laissait l'écran dans la lecture du drill-through, avec sa colonne
    // Date. Le tri par défaut — chronologique, date en séparateurs de journée —
    // est celui de `state.triSelections` au chargement.
    if (state.drillOperations && state.drillOperations.onglet === onglet) {
      state.drillOperations = null;
    }
    state.triSelections[onglet] = TRI_PAR_DEFAUT_OPERATIONS;
    const menuTri = document.querySelector(`select.tri-select[data-onglet="${onglet}"]`);
    if (menuTri) menuTri.value = TRI_PAR_DEFAUT_OPERATIONS;
    trierEtRerender(onglet);
  });
});


/* ---------- Import bancaire ---------- */

// Le backend est sans état côté fichier : on garde le File choisi en mémoire
// pour pouvoir le renvoyer tel quel à la confirmation, sans redemander à
// l'utilisateur de le sélectionner deux fois.
let importFichierActuel = null;
let importApercu = null; // dernier ImportPreview reçu du serveur
// Réglages de LECTURE en dernier recours (délimiteur, séparateur décimal) :
// jamais mémorisés sur le preset, ils ne valent que pour le fichier en cours
// (cf. renderImportReglagesLecture, qui les propose quand l'aperçu détecte
// une majorité de lignes en « date/montant illisible »). null = détection
// automatique, le comportement par défaut.
let importReglageDelimiteur = null;
let importReglageSeparateurDecimal = null;
// L'ORDRE DES DATES, de la même famille : « jma » ou « mja » imposé à la main,
// null pour le laisser se lire sur la colonne de dates du fichier (l'aperçu
// renvoie celui qu'il a retenu, cf. ImportPreview.format_date).
let importReglageFormatDate = null;
// LA FEUILLE D'UN CLASSEUR qui porte le relevé (cf. services/lecture_fichier) :
// null = la feuille active. À l'ouverture d'un classeur à plusieurs feuilles,
// celle qui ressemble le plus à un relevé est PROPOSÉE ici, visiblement, et se
// change dans les réglages de lecture (cf. lireFeuillesImport).
let importFeuille = null;
// Trace du dernier import confirmé (ImportHistorique.id), le temps d'y
// rattacher les règlements liés — seules opérations d'un import à naître
// APRÈS lui, une par une (cf. le stock anti-doublons du serveur). Sans ce
// rattachement, elles seules survivraient à l'annulation de leur import.
let importDernierHistoriqueId = null;
const importMappingCategories = {}; // nom banque -> clé de cible ("cat:3" / "type:5")
const importMappingComptes = {}; // nom banque -> compte_id choisi (ou null)
// Libellé de devise du fichier ("EUR") -> monnaie_id choisi. N'existe que pour
// les presets qui lisent une colonne de devise (cf. Configuration avancée) ;
// les libellés déjà reconnus automatiquement n'y figurent jamais.
const importMappingMonnaies = {};
// Catégories dont la suggestion automatique ("Autres") a été explicitement
// confirmée (case cochée) — tant qu'une entrée manque ici, le bouton
// "Confirmer l'import" reste désactivé, mais ça ne bloque rien d'autre dans
// l'app : on peut continuer à naviguer, créer des catégories, etc.
const importCategoriesConfirmees = new Set();
// Numéros de ligne (ImportLigne.ligne) cochées pour une action groupée
// (suppression groupée, cf. btn-import-supprimer-selection). Les doublons
// détectés y sont pré-inscrits à chaque analyse. UN DOUBLON COCHÉ EST IGNORÉ :
// il ne bloque rien, ne réclame ni catégorie ni compte ni devise, et n'est pas
// importé (cf. ligneDoublonIgnoree). Le décocher l'importe volontairement. Toute
// AUTRE ligne cochée bloque la confirmation, comme avant : la sélection sert
// alors à une suppression groupée qu'on n'a pas encore faite.
const importLignesSelectionnees = new Set();

// Un doublon (de colonnes, y compris de virement) encore coché : ignoré par défaut.
function ligneDoublonIgnoree(ligne) {
  return ligne.doublon_de != null && importLignesSelectionnees.has(ligne.ligne);
}

// Les lignes que l'import LIRA réellement : l'aperçu moins les doublons ignorés
// (les lignes supprimées à la main ont déjà quitté l'aperçu). Tout ce qui est
// demandé à l'utilisateur — catégories, comptes, devises — se déduit d'elles.
function lignesLuesParImport() {
  return importApercu ? importApercu.lignes.filter((l) => !ligneDoublonIgnoree(l)) : [];
}

// Ce que l'import demande encore de rattacher : les listes du serveur, réduites
// aux libellés qu'une ligne lue porte encore. Un libellé qui ne venait que de
// lignes ignorées ou supprimées disparaît des demandes — et ne bloque rien.
function demandesDeMapping() {
  const lues = lignesLuesParImport();
  const garder = (noms, champs) =>
    (noms || []).filter((nom) => lues.some((l) => champs.some((champ) => l[champ] === nom)));
  return {
    categories: garder(importApercu.categories_inconnues, ["nom_banque_categorie"]),
    comptes: garder(importApercu.comptes_inconnus, ["nom_banque_compte"]),
    monnaies: garder(importApercu.monnaies_inconnues, [
      "nom_banque_monnaie",
      "nom_banque_monnaie_envoyee",
      "nom_banque_monnaie_frais",
    ]),
  };
}
// Modifications manuelles ligne par ligne (bouton "Modifier" de l'aperçu),
// envoyées telles quelles à la confirmation : numéro de ligne -> champs
// modifiés (date/nature/montant/categorie_id/compte_id).
const importLigneOverrides = {};
// LE PARCOURS DE CE FICHIER (cf. « LE PARCOURS DE L'IMPORT » plus bas), remis à zéro à chaque fichier :
//   - `vues`       : les étapes montrées (une fenêtre s'est ouverte), « faites » dans le graphe ;
//   - `proposees`  : les étapes que le parcours a déjà ouvertes d'office - une fois par fichier, jamais en boucle ;
//   - `detection`  : ce que la détection dit du fichier (les mots des colonnes Sens / État, cf. étape 1bis) ;
//   - `presetTraite` / `proposition` : la proposition de changer de preset, faite une fois, et en cours ;
//   - `forcerChamps` : un preset créé pour ce fichier - l'étape 1 s'ouvre forcément ;
//   - `etapeFinale` : où le parcours s'est posé (« controle » ou « importer »), dessiné en tête du contrôle.
const importParcours = {
  vues: new Set(),
  proposees: new Set(),
  detection: null,
  presetTraite: false,
  proposition: null,
  forcerChamps: false,
  etapeFinale: null,
};

function reinitialiserParcoursImport() {
  if (importParcours.proposition) terminerPropositionPreset();
  importParcours.vues.clear();
  importParcours.proposees.clear();
  importParcours.detection = null;
  importParcours.presetTraite = false;
  importParcours.forcerChamps = false;
  importParcours.etapeFinale = null;
}
// Les mots-clés de sens et d'état posés à l'étape « mots-clés », pas encore enregistrés : ils partent avec
// les colonnes à l'aperçu et à la confirmation (`ajouterColonnesLues`). `importVocabulairesAvant` garde ce
// que les éditeurs portaient avant l'étape, pour le leur rendre quand on change de fichier.
let importVocabulairesEssai = null;
let importVocabulairesAvant = null;
// Le choix du compte (étape 3) n'est proposé qu'une fois par fichier.
let importCompteDemande = false;
// Numéros de ligne retirées de l'import (bouton "Supprimer" de l'aperçu).
const importLignesSupprimees = new Set();
// Numéro de ligne actuellement en édition inline dans l'aperçu (une seule à
// la fois), ou null si aucune.
let ligneApercuEnEdition = null;
// Toutes les colonnes du preset, de base ET avancées : c'est une seule liste
// côté serveur (ImportPreset.colonnes). Seul l'affichage les sépare, selon le
// groupe auquel leur propriété appartient.
let importConfigColonnes = []; // [{index, propriete}]
// LES COLONNES DUMMY que le preset lit (migration 0079) : [{colonne_dummy_id, nom, index}].
// `colonne_dummy_id` null = une colonne neuve, créée sous son nom à l'enregistrement. À part de
// `importConfigColonnes` : elles n'ont pas de propriété, et peuvent partager un numéro avec une.
let importConfigColonnesDummy = [];
// Toutes les colonnes dummy existantes, chacune avec les formats qui la lisent
// (GET /import/colonnes-dummy) : ce que le menu « + » propose.
let colonnesDummyConnues = [];
// [index, ...] -- les colonnes que la détection de doublons regarde. Ce que la
// liste désigne dépend du mode : les colonnes à ignorer ("exclusion", défaut)
// ou les seules à comparer ("selection"). Cf. constants.ModeComparaison.
let importConfigColonnesComparaison = [];
// Signature de la configuration telle qu'ENREGISTRÉE (cf. signatureApercu),
// pour savoir, à l'enregistrement suivant, si l'aperçu du fichier chargé a
// cessé d'être à jour — et donc s'il faut le refaire.
let importSignatureApercuEnregistree = null;
// Les colonnes lues telles qu'ENREGISTRÉES dans le preset (cf.
// signatureColonnesImport) : l'alerte « les colonnes ont changé » compare la
// configuration vivante à elles, et non à un drapeau qu'une modification
// remise à l'identique ne ferait jamais retomber.
let importSignatureColonnesEnregistrees = null;

// Ce que tout relevé porte : c'est la « Configuration du fichier ». Les clés
// sont celles de constants.PROPRIETES_IMPORT_BASE.
const PROPRIETES_IMPORT = [
  ["date", "Date"],
  ["nature", "Nature"],
  ["categorie_banque", "Catégorie bancaire"],
  ["montant", "Montant"],
  // Éteinte tant qu'on ne l'allume pas : aucune colonne par défaut ne la lit.
  ["notes", "Notes"],
];

// Celles qu'un preset lit forcément (miroir de
// constants.PROPRIETES_IMPORT_OBLIGATOIRES) : leur œil est désactivé, plutôt
// que de laisser éteindre une colonne que le serveur refusera d'enregistrer.
// `montant` n'y figure pas : il est obligatoire SAUF quand le couple
// débit/crédit le remplace (cf. proprieteImportObligatoire).
const PROPRIETES_IMPORT_OBLIGATOIRES = new Set(["date", "nature"]);

// Les deux colonnes d'un montant scindé (miroir de
// constants.PROPRIETES_MONTANT_SCINDE). Elles vont ensemble et remplacent
// « Montant » : l'œil de l'une allume et éteint l'autre, et le serveur refuse
// toute configuration qui n'en lirait qu'une, ou qui les lirait à côté de
// « Montant » ou de « Sens » (cf. _valider_lecture_du_montant).
const PROPRIETES_MONTANT_SCINDE = ["montant_debit", "montant_credit"];

function montantScindeActif() {
  return importConfigColonnes.some((c) => PROPRIETES_MONTANT_SCINDE.includes(c.propriete));
}

/**
 * Une propriété dont l'œil est désactivé, parce que l'éteindre donnerait une
 * configuration que le serveur refuse d'enregistrer.
 *
 * « Montant » en fait partie tant que le couple débit/crédit ne le remplace
 * pas : une ligne doit toujours avoir un montant, mais il peut venir de deux
 * colonnes au lieu d'une.
 */
function proprieteImportObligatoire(propriete) {
  if (PROPRIETES_IMPORT_OBLIGATOIRES.has(propriete)) return true;
  return propriete === "montant" && !montantScindeActif();
}

// Ce qu'un relevé ne dit pas toujours de lui-même : la « Configuration
// avancée », dans sa propre liste de colonnes. Un preset ordinaire n'a jamais
// à croiser ces entrées ; celui d'une banque multi-devises en a besoin de
// presque toutes (cf. constants.PROPRIETES_IMPORT_AVANCEES).
const PROPRIETES_IMPORT_AVANCEES = [
  ["compte_banque", "Compte bancaire"],
  ["sens", "Sens"],
  // Juste après « Sens », parce que c'est la même chose dite autrement : le
  // signe que le relevé n'écrit pas sur le montant, porté par la colonne
  // remplie plutôt que par un mot.
  ["montant_debit", "Montant au débit"],
  ["montant_credit", "Montant au crédit"],
  ["monnaie", "Monnaie"],
  // Clés = propriétés persistées côté serveur (inchangées) ; libellés = le
  // vocabulaire « envoyé / reçu » employé partout ailleurs à l'écran.
  ["montant_initial", "Montant envoyé"],
  ["monnaie_initiale", "Monnaie envoyée"],
  ["frais", "Frais"],
  ["monnaie_frais", "Monnaie des frais"],
  ["statut", "État"],
];

const CLES_PROPRIETES_AVANCEES = new Set(PROPRIETES_IMPORT_AVANCEES.map(([cle]) => cle));

// Les trois colonnes qui ne disent rien sans l'extension « Monnaies » : tant
// qu'elle est éteinte, l'application n'a qu'une monnaie et ces lignes n'ont rien
// à régler. Elles ne sont donc pas MONTRÉES (cf. proprietesAvanceesAffichees) —
// la configuration enregistrée, elle, n'est pas touchée.
const PROPRIETES_IMPORT_MONNAIE = new Set(["monnaie", "monnaie_initiale", "monnaie_frais"]);

function proprietesAvanceesAffichees() {
  if (choixDeMonnaiePossible()) return PROPRIETES_IMPORT_AVANCEES;
  return PROPRIETES_IMPORT_AVANCEES.filter(([cle]) => !PROPRIETES_IMPORT_MONNAIE.has(cle));
}

/** Les champs de la molette du tableau des colonnes. AU PREMIER IMPORT, « Monnaie » y est proposée même
 *  extension « Monnaies » éteinte : un relevé peut en porter une, et c'est à l'étape « Comptes & Monnaies »
 *  qu'on décide d'allumer l'extension pour s'en servir (cf. `compteImportExtensionDemandee`). */
function proprietesAvanceesDetection() {
  if (choixDeMonnaiePossible() || !premierImportBancaire()) return proprietesAvanceesAffichees();
  return PROPRIETES_IMPORT_AVANCEES.filter(
    ([cle]) => cle === "monnaie" || !PROPRIETES_IMPORT_MONNAIE.has(cle)
  );
}

/** Le fichier est-il lu avec une colonne de devise (montant, montant envoyé ou frais) ? */
function importLitUneMonnaie() {
  return importConfigColonnes.some((c) => c.index >= 1 && PROPRIETES_IMPORT_MONNAIE.has(c.propriete));
}

/**
 * Ce que chaque propriété d'import veut dire, POSÉ SUR SA PROPRE LIGNE.
 *
 * Ces textes formaient auparavant un pavé sous le titre « Configuration
 * avancée » : une liste de six points et deux paragraphes qu'il fallait lire
 * en entier, puis retraverser du regard pour retrouver la propriété qu'on
 * était en train de régler. Chacun est désormais l'info-bulle de sa propre
 * ligne : l'explication arrive là où se prend la décision, et le bloc s'ouvre
 * sur la seule liste des propriétés.
 *
 * LES PHRASES ELLES-MÊMES VIVENT DANS textes.js, comme toutes les autres
 * indications de l'application — il n'y a qu'un fichier à ouvrir pour les
 * réécrire. Ne reste ici que la façon de les retrouver.
 *
 * `TEXTES[…]` ET NON `texteAide(…)` : une propriété sans explication doit rendre
 * `undefined`, ce que l'appelant teste pour ne pas dessiner de pastille vide.
 * `texteAide` rendrait la clé, et on verrait « noyau.import-propriete-sens »
 * s'afficher dans une bulle.
 *
 * Le saut de ligne (\n) est rendu tel quel par la bulle (white-space:
 * pre-line) : il sépare le QUOI, en tête, de ses conséquences — c'est tout le
 * formatage dont ces textes ont besoin, et il évite une bulle en pavé.
 */
function infoProprieteImport(propriete) {
  return TEXTES[`noyau.import-propriete-${propriete}`];
}

function estProprieteAvancee(propriete) {
  return CLES_PROPRIETES_AVANCEES.has(propriete);
}

/* ----- Presets ----- */
// Chaque banque a son propre format d'export : la configuration de colonnes,
// les mappings catégorie/compte, l'historique et le stock anti-doublons sont
// donc tous scopés à un preset (voir backend /import/presets/{id}/...).

let importPresets = []; // [{id, nom, colonnes, colonnes_comparaison, mode_comparaison}]
let importPresetId = null;
// Ce que la reconnaissance des presets dit du fichier ouvert (cf.
// reconnaitrePresetImport) ; null tant qu'aucun fichier n'est analysé.
let importReconnaissance = null;

const COLONNES_PRESET_PAR_DEFAUT = [
  { index: 1, propriete: "date" },
  { index: 2, propriete: "nature" },
  { index: 3, propriete: "montant" },
];

function importUrl(chemin) {
  // Sans preset, l'URL contiendrait littéralement "null" et le serveur
  // répondrait un 422 incompréhensible ("unable to parse string as an
  // integer") : mieux vaut échouer ici, avec un message qui dit quoi faire.
  if (importPresetId == null) {
    throw new Error("Aucun preset d'import sélectionné : choisis-en un avant de continuer.");
  }
  return `/import/presets/${importPresetId}${chemin}`;
}

function presetActuel() {
  return importPresets.find((p) => p.id === importPresetId) || null;
}

function renderImportPresetChips() {
  const bloc = document.getElementById("import-preset-chips");
  bloc.innerHTML = "";
  importPresets.forEach((p) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = p.nom;
    btn.dataset.presetId = p.id;
    btn.classList.toggle("active", p.id === importPresetId);
    // LA PROPOSITION DE PRESET : celui vers lequel l'app propose de changer est entouré.
    const proposition = importParcours.proposition;
    btn.classList.toggle(
      "preset-propose",
      !!proposition && proposition.type === "basculer" && proposition.presetId === p.id
    );
    btn.addEventListener("click", async () => {
      if (p.id === importPresetId) return;
      // Pendant la proposition, choisir un autre preset GARDE LE FICHIER, comme « Oui ».
      if (importParcours.proposition && importFichierActuel) {
        terminerPropositionPreset();
        await basculerPresetImport(p.id);
        return;
      }
      importPresetId = p.id;
      memoriserPresetActuel();
      renderImportPresetChips();
      await chargerDonneesPresetActuel();
    });
    bloc.appendChild(btn);
  });
}

// Le preset sélectionné est mémorisé : sans ça, l'app repartait à chaque
// rechargement sur le premier preset par ordre alphabétique, donnant
// l'impression que les correspondances mémorisées et l'historique avaient
// disparu alors qu'ils appartenaient simplement à un autre preset.
//
// EN BASE (`PreferenceInterface`, migration 0069) et non sur le poste : ce qui
// est mémorisé EST un identifiant de preset, et un preset n'existe que dans une
// base. Mémorisé ailleurs, il désignait un autre preset — ou rien — dès qu'on
// changeait de base, ce qui est exactement le symptôme qu'il existe pour
// éviter.
const CLE_PRESET_MEMORISE = "noyau.import-preset";
// L'ancienne clé de localStorage, reprise UNE FOIS puis effacée.
const CLE_PRESET_MEMORISE_LOCALE = "budget-app.import.preset";

async function loadImportPresets() {
  importPresets = await apiFetch("/import/presets");
  if (!importPresets.some((p) => p.id === importPresetId)) {
    let range = await lirePreference(CLE_PRESET_MEMORISE);
    if (range === null || range === undefined) {
      range = reprendreDuLocalStorage(CLE_PRESET_MEMORISE_LOCALE);
      if (range !== null) await ecrirePreference(CLE_PRESET_MEMORISE, range);
    }
    const memorise = Number(range);
    importPresetId = importPresets.some((p) => p.id === memorise)
      ? memorise
      : presetParDefaut();
  }
  memoriserPresetActuel();
  renderImportPresetChips();
}

// Rien en mémoire (première utilisation, autre machine) : le preset le plus
// récemment utilisé plutôt que le premier par ordre alphabétique, qui peut
// être un preset vide et donner l'impression que tout a disparu.
function presetParDefaut() {
  if (importPresets.length === 0) return null;
  const utilises = importPresets.filter((p) => p.dernier_import);
  if (utilises.length === 0) return importPresets[0].id;
  return utilises.reduce((a, b) => (a.dernier_import >= b.dernier_import ? a : b)).id;
}

/**
 * LE PREMIER IMPORT : aucun preset n'a encore servi. Le preset sélectionné - celui que l'application livre,
 * dans une base neuve - n'a alors jamais rien lu, et ce qu'on règle en important (colonnes, lignes de tête et
 * de pied, mots-clés « Sens » / « État », compte) lui est ENREGISTRÉ D'OFFICE à la confirmation de l'import,
 * sans passer par « Enregistrer la configuration » (cf. `enregistrerPremierImport`).
 */
function premierImportBancaire() {
  return (importPresets || []).every((p) => !p.dernier_import);
}

/** À la confirmation du premier import : la configuration de l'écran part dans le preset, et le compte choisi
 *  pour le fichier devient celui du preset quand aucune colonne ne nomme les comptes. Le fichier n'est pas relu :
 *  l'aperçu qu'on vient d'importer a été lu avec exactement cela. */
async function enregistrerPremierImport() {
  const compte = compteIdDefautChoisi();
  if (compte && !importConfigColonnes.some((c) => c.propriete === "compte_banque")) {
    const select = document.getElementById("import-preset-compte");
    fillComptesSelect(select, comptesProposables(Number(compte)), { keepFirst: true });
    select.value = String(compte);
  }
  const preset = presetActuel();
  return enregistrerConfigurationImport({
    relireSiPerime: false,
    message: t(texteAide("noyau.import-premier-enregistre"), { preset: preset ? preset.nom : "" }),
  });
}

function memoriserPresetActuel() {
  // Sans `await` : mémoriser un choix ne doit pas retarder l'écran qui vient de
  // le prendre (cf. ecrirePreference, qui ne lève jamais).
  ecrirePreference(CLE_PRESET_MEMORISE, importPresetId != null ? importPresetId : null);
}

document.getElementById("btn-import-preset-creer").addEventListener("click", async () => {
  // Pendant la proposition de preset, « Nouveau » crée le preset POUR CE FICHIER (le fichier est gardé).
  if (importParcours.proposition && importFichierActuel) {
    await creerPresetPourFichierImport();
    return;
  }
  const nom = prompt("Nom du nouveau preset (ex. nom de la banque) :");
  if (!nom || !nom.trim()) return;
  try {
    const preset = await apiFetch("/import/presets", {
      method: "POST",
      body: JSON.stringify({
        nom: nom.trim(),
        colonnes: COLONNES_PRESET_PAR_DEFAUT,
        colonnes_comparaison: [],
      }),
    });
    importPresetId = preset.id;
    await loadImportPresets();
    await chargerDonneesPresetActuel();
    // Un preset neuf ne décrit aucun format : c'est le seul moment où la
    // configuration est le geste à faire, donc le seul où on déplie d'office.
    document.getElementById("import-config-fichier").open = true;
    showMessage(`Preset "${preset.nom}" créé — configure ses colonnes ci-dessous.`, "success");
  } catch (err) {
    showMessage(err.message, "error");
  }
});

document.getElementById("btn-import-preset-renommer").addEventListener("click", async () => {
  const preset = presetActuel();
  if (!preset) return;
  const nom = prompt("Nouveau nom du preset :", preset.nom);
  if (!nom || !nom.trim() || nom.trim() === preset.nom) return;
  try {
    // Le PUT réécrit le preset entier : tout ce qui n'est pas renvoyé serait
    // remis à sa valeur par défaut. Renommer ne doit surtout pas effacer la
    // configuration avancée.
    await apiFetch(importUrl(""), {
      method: "PUT",
      body: JSON.stringify({
        nom: nom.trim(),
        compte_id: preset.compte_id,
        colonnes: preset.colonnes,
        colonnes_comparaison: preset.colonnes_comparaison,
        mode_comparaison: preset.mode_comparaison,
        lignes_entete: preset.lignes_entete,
        libelles_sens_sortie: preset.libelles_sens_sortie,
        libelles_sens_entree: preset.libelles_sens_entree,
        libelles_statut_execute: preset.libelles_statut_execute,
        libelles_statut_attente: preset.libelles_statut_attente,
        libelles_statut_refuse: preset.libelles_statut_refuse,
      }),
    });
    await loadImportPresets();
    showMessage(t("Preset renommé"), "success");
  } catch (err) {
    showMessage(err.message, "error");
  }
});

document.getElementById("btn-import-preset-supprimer").addEventListener("click", async () => {
  const preset = presetActuel();
  if (!preset) return;
  if (
    !confirm(
      `Supprimer le preset "${preset.nom}" ? Son historique et son stock anti-doublons seront définitivement perdus.`
    )
  )
    return;
  try {
    await apiFetch(importUrl(""), { method: "DELETE" });
    importPresetId = null;
    await loadImportPresets();
    await chargerDonneesPresetActuel();
    showMessage(t("Preset supprimé"), "success");
  } catch (err) {
    showMessage(err.message, "error");
  }
});

/**
 * Ouverture de la page Import — y compris un RETOUR en cours d'import.
 *
 * Un import se fait en plusieurs temps : confirmer des catégories, compléter
 * des virements, corriger des lignes. Aller vérifier un solde ou créer un
 * compte entre-temps est normal, et repartir de zéro au retour faisait perdre
 * tout ce travail — sans prévenir, et sans que le fichier soit rechargeable
 * autrement qu'à la main.
 *
 * L'aperçu et ses retouches vivent donc tant que la page n'est pas rechargée :
 * on rafraîchit ce qui a pu changer ailleurs (comptes, catégories, presets) et
 * on réaffiche l'aperçu en cours au lieu de le jeter. Il n'est remis à zéro que
 * là où il n'a plus de sens : changement de preset, nouveau fichier, ou import
 * terminé.
 */
// LE CHARGEMENT EN COURS DE LA PAGE IMPORT : le tutoriel d'import l'attend avant de poser son
// fichier et sa configuration — sans quoi un chargement arrivé après coup les écrasait avec ceux
// du preset (cf. tutoriel.js, appliquerEtapeImport).
let importSectionEnChargement = Promise.resolve();

async function loadImportSection() {
  const importEnCours = importApercu !== null;
  await refreshComptes();
  await refreshCategories();
  await loadImportPresets();
  if (importEnCours) {
    // Pas de reinitialiserImport() ici : la configuration et les
    // correspondances se rechargent, l'aperçu reste.
    await loadImportConfiguration();
    await loadImportMappingsOverview();
    await loadImportHistorique();
    renderApercuFichier();
    renderImportAvertissements();
    renderImportControle();
    renderImportMappings();
    renderImportApercu();
    return;
  }
  // chargerDonneesPresetActuel -> loadImportMappingsOverview recharge déjà le
  // rattachement catégorie -> compte.
  await chargerDonneesPresetActuel();
}

async function chargerDonneesPresetActuel() {
  reinitialiserImport();
  await loadImportConfiguration();
  await loadImportMappingsOverview();
  await loadImportHistorique();
}

function reinitialiserImport() {
  importFichierActuel = null;
  importApercu = null;
  Object.keys(importMappingCategories).forEach((k) => delete importMappingCategories[k]);
  Object.keys(importMappingComptes).forEach((k) => delete importMappingComptes[k]);
  Object.keys(importMappingMonnaies).forEach((k) => delete importMappingMonnaies[k]);
  importCategoriesConfirmees.clear();
  corrChoixManuels.clear();
  importLignesSelectionnees.clear();
  Object.keys(importLigneOverrides).forEach((k) => delete importLigneOverrides[k]);
  importLignesSupprimees.clear();
  // Les refus de rapprochement appartiennent au fichier qu'on quitte : les
  // garder ferait refuser, sur le fichier suivant, des lignes qui portent le
  // même numéro sans rien avoir de commun.
  importRapprochementsRefuses.clear();
  // Les validations de lecture désignent, elles aussi, des lignes par leur numéro.
  Object.keys(importJambesValidees).forEach((k) => delete importJambesValidees[k]);
  Object.keys(importJambesDeclarees).forEach((k) => delete importJambesDeclarees[k]);
  importRessemblancesVues.clear();
  // Les liaisons aussi : elles désignent des lignes par leur NUMÉRO, lequel ne
  // veut plus rien dire dans le fichier suivant.
  Object.keys(importLignesLiees).forEach((k) => delete importLignesLiees[k]);
  ligneApercuEnEdition = null;
  document.getElementById("import-fichier").value = "";
  document.getElementById("import-fichier-nom").textContent = "";
  document.getElementById("import-mappings-bloc").style.display = "none";
  document.getElementById("import-apercu-bloc").style.display = "none";
  document.getElementById("import-apercu-fichier-bloc").style.display = "none";
  document.getElementById("import-avertissements").style.display = "none";
  document.getElementById("import-monnaies-resolues-bloc").style.display = "none";
  document.getElementById("import-previsionnelles-bloc").style.display = "none";
  importDetection = null;
  importDetectionProposee = false;
  document.getElementById("modale-detection").style.display = "none";
  // Le parcours du fichier qu'on quitte : ni mots-clés, ni choix de compte, ni catégories créées en route.
  restaurerVocabulairesImport();
  reinitialiserParcoursImport();
  importCompteDemande = false;
  importMappingsManquaient = null;
  corrNouvelles.clear();
  corrChaine = false;
  ["modale-mots-cles", "modale-compte-import"].forEach((id) => {
    document.getElementById(id).style.display = "none";
  });
  document.getElementById("import-detection-suggestion").style.display = "none";
  importReconnaissance = null;
  renderImportReconnaissance();
  document.getElementById("import-controle").style.display = "none";
  reinitialiserReglagesLecture();
  importDernierHistoriqueId = null;

  // La veille repart de zéro : sans ça, la signature du fichier précédent
  // ferait passer le suivant pour « déjà comparé ».
  veilleDoublonsSignature = null;
  renderVeilleDoublonsVirements([]);
  majBulleInformationsImport();
}

// Point de passage unique du choix de fichier (bouton et glisser-déposer) :
// l'analyse démarre directement, il n'y a plus de bouton "Analyser" à cliquer.
function definirFichierImport(fichier) {
  importFichierActuel = fichier || null;
  importDetectionProposee = false;
  restaurerVocabulairesImport();
  reinitialiserParcoursImport();
  importCompteDemande = false;
  importMappingsManquaient = null;
  corrNouvelles.clear();
  document.getElementById("import-fichier-nom").textContent = fichier ? fichier.name : "";
  // Un nouveau fichier peut venir d'une autre banque : les réglages de
  // lecture du précédent n'ont aucune raison de valoir pour celui-ci.
  reinitialiserReglagesLecture();
  if (fichier) analyserFichierImport();
}

/* ----- Réglages de lecture en dernier recours (délimiteur, séparateur
 * décimal) -----
 *
 * Jamais mémorisés sur le preset (cf. services/import_bancaire.previsualiser) :
 * ce sont des réglages DE CE FICHIER-CI, proposés quand la détection
 * automatique du délimiteur et la lecture permissive des nombres échouent.
 */

const DELIMITEURS_FORMULAIRE = { PV: ";", VIRGULE: ",", TAB: "\t" };

function reinitialiserReglagesLecture() {
  importReglageDelimiteur = null;
  importReglageSeparateurDecimal = null;
  importReglageFormatDate = null;
  importFeuille = null;
  document.getElementById("import-reglage-feuille-champ").style.display = "none";
  const details = document.getElementById("import-reglages-lecture");
  details.open = false;
  document.getElementById("import-reglages-lecture-alerte").style.display = "none";
  document.getElementById("import-reglages-lecture-resume").textContent = "";
  document.getElementById("import-reglage-delimiteur").value = "";
  document.getElementById("import-reglage-separateur-decimal").value = "";
  document.getElementById("import-reglage-format-date").value = "";
  document.getElementById("import-reglage-format-date-aide").style.display = "none";
  const autre = document.getElementById("import-reglage-delimiteur-autre");
  autre.value = "";
  autre.style.display = "none";
}

document.getElementById("import-reglage-delimiteur").addEventListener("change", (e) => {
  document.getElementById("import-reglage-delimiteur-autre").style.display =
    e.target.value === "AUTRE" ? "" : "none";
});

/**
 * Le délimiteur choisi à la main, ou null (détection automatique) : lu depuis
 * les contrôles à l'envoi plutôt que tenu à jour à chaque frappe, pour ne pas
 * envoyer un caractère "Autre" à moitié saisi.
 */
function delimiteurChoisi() {
  const valeur = document.getElementById("import-reglage-delimiteur").value;
  if (!valeur) return null;
  if (valeur === "AUTRE") {
    const autre = document.getElementById("import-reglage-delimiteur-autre").value;
    return autre || null;
  }
  return DELIMITEURS_FORMULAIRE[valeur] || null;
}

function separateurDecimalChoisi() {
  return document.getElementById("import-reglage-separateur-decimal").value || null;
}

function formatDateChoisi() {
  return document.getElementById("import-reglage-format-date").value || null;
}

/**
 * Les réglages de lecture d'une requête sur le fichier ouvert : aperçu,
 * reconnaissance, confirmation. Tous les trois doivent lire le fichier de la
 * même façon, sans quoi on confirmerait autre chose que ce qu'on a relu.
 */
function ajouterReglagesLecture(formData) {
  if (importReglageDelimiteur) formData.append("delimiteur", importReglageDelimiteur);
  if (importFeuille) formData.append("feuille", importFeuille);
  if (importReglageSeparateurDecimal)
    formData.append("separateur_decimal", importReglageSeparateurDecimal);
  if (importReglageFormatDate) formData.append("format_date", importReglageFormatDate);
}

// CHANGER L'UN DES DEUX RÉGLAGES ALLUME LE BOUTON DE RELECTURE du tableau du
// fichier (les deux flèches), seul bouton qui relit : il n'y a plus de bouton
// « Relire avec ces réglages » à côté des champs. Le bouton lit les réglages au
// moment du clic (cf. `lireReglagesLecture`), comme il lit tout le reste.
[
  "import-reglage-delimiteur",
  "import-reglage-delimiteur-autre",
  "import-reglage-separateur-decimal",
  "import-reglage-format-date",
].forEach((id) => {
  document.getElementById(id).addEventListener("change", () => {
    importApercuAReloire = true;
    majBoutonRelireApercu();
  });
});

/** Les réglages de lecture saisis à l'écran deviennent ceux de la prochaine lecture. */
function lireReglagesLecture() {
  importReglageDelimiteur = delimiteurChoisi();
  importReglageSeparateurDecimal = separateurDecimalChoisi();
  importReglageFormatDate = formatDateChoisi();
}

/**
 * Un fichier presque entièrement en « date illisible » ou « montant
 * illisible » ne décrit pas des données de mauvaise qualité (ça, c'est
 * quelques lignes) : c'est un signe que le délimiteur ou le séparateur
 * décimal détectés ne conviennent pas à ce format. Le seuil (80 %, à partir
 * de 3 lignes) laisse passer un fichier réellement mal rempli par la banque
 * sans ouvrir le panneau pour rien.
 */
function detecterProblemeLecture(lignes) {
  if (lignes.length < 3) return false;
  const proportionEn = (motif) =>
    lignes.filter((l) => l.erreur && l.erreur.includes(motif)).length / lignes.length;
  return proportionEn("date illisible") >= 0.8 || proportionEn("montant illisible") >= 0.8;
}

function renderImportReglagesLecture() {
  const details = document.getElementById("import-reglages-lecture");
  const alerte = document.getElementById("import-reglages-lecture-alerte");
  const resume = document.getElementById("import-reglages-lecture-resume");
  const lignes = (importApercu && importApercu.lignes) || [];

  const resumeMorceaux = [];
  if (importReglageDelimiteur) resumeMorceaux.push(`délimiteur « ${importReglageDelimiteur} »`);
  if (importReglageSeparateurDecimal)
    resumeMorceaux.push(`décimale « ${importReglageSeparateurDecimal} »`);
  if (importFeuille) resumeMorceaux.push(`feuille « ${importFeuille} »`);
  // L'ordre des dates se montre dès qu'il n'est pas l'ordinaire jour devant,
  // imposé à la main OU lu sur le fichier : des dates mois devant lues sans le
  // dire, c'est exactement ce qu'on viendrait chercher ici.
  const formatDate = importReglageFormatDate || (importApercu && importApercu.format_date);
  if (formatDate === "mja") resumeMorceaux.push(t("dates mois devant"));
  else if (importReglageFormatDate === "jma") resumeMorceaux.push(t("dates jour devant"));
  resume.textContent = resumeMorceaux.length ? `— ${resumeMorceaux.join(", ")}` : "";

  // Lu sur le fichier, et non imposé : la phrase dit pourquoi et comment
  // revenir en arrière.
  const aideDate = document.getElementById("import-reglage-format-date-aide");
  const detecteMoisDevant =
    !importReglageFormatDate && importApercu && importApercu.format_date === "mja";
  aideDate.textContent = detecteMoisDevant ? t(texteAide("noyau.dates-mois-devant-detectees")) : "";
  aideDate.style.display = detecteMoisDevant ? "" : "none";

  if (detecterProblemeLecture(lignes)) {
    // LA SECTION PARENTE AUSSI. Les réglages de lecture vivent désormais au
    // fond de « Configuration du fichier », elle-même repliée en temps
    // ordinaire : n'ouvrir que le sous-bloc revenait à déplier quelque chose
    // que personne ne voit, et l'avertissement qui explique un fichier
    // entièrement illisible restait invisible.
    document.getElementById("import-config-fichier").open = true;
    details.open = true;
    alerte.textContent = t(
      "La plupart des lignes sont illisibles : le fichier n'utilise sans doute pas le délimiteur ou le séparateur décimal détectés automatiquement. Précise-les ci-dessous, puis relis le fichier."
    );
    alerte.style.display = "";
  } else {
    alerte.style.display = "none";
  }
}

/* ----- Configuration des colonnes ----- */

/**
 * Le compte auquel le preset est lié : la liste des comptes, plus l'option
 * "aucun" déjà dans le HTML (le preset non lié résout le compte depuis le
 * fichier, comme avant).
 */
function renderImportPresetCompte(compteId) {
  const select = document.getElementById("import-preset-compte");
  fillComptesSelect(select, comptesProposables(compteId ?? null), { keepFirst: true });
  select.value = compteId != null ? String(compteId) : "";
  updateImportPresetCompteAvertissement();
}

function importPresetCompteChoisi() {
  const valeur = document.getElementById("import-preset-compte").value;
  return valeur ? Number(valeur) : null;
}

/**
 * Un preset lié ignore la colonne "Compte bancaire" — c'est voulu (le fichier
 * n'a rien à dire sur un compte qu'on a désigné explicitement), mais assez
 * surprenant pour être écrit à côté du choix plutôt que découvert à l'import.
 */
function updateImportPresetCompteAvertissement() {
  const bloc = document.getElementById("import-preset-compte-avertissement");
  const lie = importPresetCompteChoisi() != null;
  const aColonneCompte = importConfigColonnes.some((c) => c.propriete === "compte_banque");
  bloc.style.display = lie && aColonneCompte ? "" : "none";
  bloc.textContent =
    "Ce preset lit aussi une colonne « Compte bancaire » : elle reste affichée dans l'aperçu, mais ne décide plus du compte — le compte lié ci-dessus s'applique à toutes les lignes.";
}

document.getElementById("import-preset-compte").addEventListener("change", () => {
  updateImportPresetCompteAvertissement();
  toggleImportCompteDefautBloc();
});

/**
 * Tout ce dont l'APERÇU dépend : les colonnes et leur propriété, l'en-tête
 * ignoré, le compte lié, les vocabulaires — et la comparaison des doublons,
 * liste ET mode. Deux configurations de même signature produisent le même
 * aperçu ; c'est ce qui permet de ne relire le fichier que lorsque ça sert.
 *
 * La comparaison des doublons y figure bien qu'elle ne change PAS la façon de
 * lire une ligne : c'est le serveur qui calcule `doublon_de`, à la
 * prévisualisation, à partir d'elle. L'en exclure faisait qu'ajouter une
 * exclusion (le solde courant, une référence…) ne changeait rien à l'écran —
 * l'aperçu gardait ses « 0 doublon » calculés avant, alors que le serveur,
 * lui, les aurait signalés. Seul le NOM du preset reste dehors : il n'entre
 * dans aucun calcul.
 */
/**
 * Les lignes de tête d'un preset, toujours un nombre.
 *
 * TROIS FORMES POUR LA MÊME ABSENCE — le champ manquant, `null`, ou du texte
 * qui n'est pas un nombre — et une seule réponse : zéro, « le fichier commence
 * par une opération ». Sans ce passage obligé, un `undefined` se serait glissé
 * dans la signature de l'aperçu, qui aurait alors changé sans que rien n'ait
 * bougé, et relu le fichier à chaque enregistrement.
 */
function lignesEnteteDe(config) {
  const valeur = Number(config?.lignes_entete);
  return Number.isFinite(valeur) && valeur > 0 ? Math.floor(valeur) : 0;
}

/** Ce que le champ affiche, borné comme le serveur le borne. */
function lignesEnteteSaisies() {
  return nombreDeLignesSaisi("import-lignes-entete");
}

/** Les lignes de pied d'un preset (total, solde final sous les opérations). */
function lignesPiedDe(config) {
  const valeur = Number(config?.lignes_pied);
  return Number.isFinite(valeur) && valeur > 0 ? Math.floor(valeur) : 0;
}

function lignesPiedSaisies() {
  return nombreDeLignesSaisi("import-lignes-pied");
}

function nombreDeLignesSaisi(id) {
  const champ = document.getElementById(id);
  const valeur = Math.floor(Number(champ?.value));
  if (!Number.isFinite(valeur) || valeur <= 0) return 0;
  return Math.min(valeur, Number(champ.max) || valeur);
}

/** Les colonnes lues, indépendamment de leur ordre de saisie. */
function signatureColonnesImport(colonnes) {
  return JSON.stringify(
    (colonnes || [])
      .filter((c) => c.index >= 1)
      .map((c) => `${c.propriete}:${c.index}`)
      .sort()
  );
}

function signatureApercu(config) {
  return JSON.stringify({
    colonnes: config.colonnes,
    // Les colonnes dummy changent ce que les règles reconnaissent : l'aperçu se relit.
    colonnes_dummy: (config.colonnes_dummy || []).map((c) => `${c.colonne_dummy_id}:${c.index}`),
    colonnes_comparaison: config.colonnes_comparaison || [],
    mode_comparaison: config.mode_comparaison,
    lignes_entete: lignesEnteteDe(config),
    lignes_pied: lignesPiedDe(config),
    compte_id: config.compte_id ?? null,
    // Les mots-clés de sens décident du SIGNE de chaque montant, ceux d'état de
    // ce qui est importé ou non : en changer relit forcément le fichier
    // autrement.
    libelles_sens_sortie: config.libelles_sens_sortie || [],
    libelles_sens_entree: config.libelles_sens_entree || [],
    libelles_statut_execute: config.libelles_statut_execute || [],
    libelles_statut_attente: config.libelles_statut_attente || [],
    libelles_statut_refuse: config.libelles_statut_refuse || [],
  });
}

async function loadImportConfiguration() {
  const config = await apiFetch(importUrl(""));
  importSignatureApercuEnregistree = signatureApercu(config);
  importSignatureColonnesEnregistrees = signatureColonnesImport(config.colonnes);
  importConfigColonnes = config.colonnes.map((c) => ({ ...c }));
  importConfigColonnesDummy = (config.colonnes_dummy || []).map((c) => ({ ...c }));
  await chargerColonnesDummyConnues();
  importConfigColonnesComparaison = [...(config.colonnes_comparaison || [])];
  document.getElementById("import-mode-comparaison").value = config.mode_comparaison;
  document.getElementById("import-lignes-entete").value = lignesEnteteDe(config);
  document.getElementById("import-lignes-pied").value = lignesPiedDe(config);
  updateResumeLignesEntete();
  renderImportVocabulaires(config);
  renderImportConfig();
  renderImportPresetCompte(config.compte_id);
  renderImportConfigColonnesComparaison();
  updateImportCompteDefautVisibility();
}

/* ---------- Éditeur de mots-clés (vocabulaires d'import) ----------
 *
 * UN MOT-CLÉ EST UNE VALEUR ENTIÈRE, jamais un morceau de chaîne découpé.
 *
 * Ces listes se saisissaient dans un champ texte séparé par des virgules. Le
 * séparateur était une contrainte imposée à la DONNÉE : une banque qui écrit
 * « DEBIT, CARTE » voyait son libellé coupé en deux mots-clés dont aucun ne
 * correspondait plus à rien, sans le moindre message — et il n'existait aucune
 * façon de l'écrire autrement. Un mot-clé s'ajoute donc un par un.
 *
 * TROIS GESTES SÉPARÉS, et c'est voulu : le champ et son « + » ajoutent, les
 * jetons montrent, le menu « Actualisation » retire. Une croix sur chaque jeton
 * aurait mis la suppression sur le trajet de la lecture, à un pixel du mot
 * qu'on relit.
 *
 * DANS LE NOYAU bien que l'écran d'import de placements s'en serve aussi :
 * c'est le même geste dans les deux imports, et deux implémentations auraient
 * fini par diverger. Le serveur, lui, recevait déjà des listes de chaînes
 * (`libelles_*` est un JSON) : rien ne change de ce côté.
 *
 * LE GROUPE est l'unité d'unicité : un même mot-clé ne peut pas figurer dans
 * deux listes du MÊME groupe (le serveur le refuse, cf.
 * routers/import_bancaire.nettoyer_vocabulaire), mais rien n'interdit qu'un mot
 * désigne à la fois une sortie et un état exécuté — ce sont deux colonnes
 * différentes, donc deux groupes.
 *
 * LE DOM ATTENDU, par liste du groupe :
 *
 *   <div class="import-vocabulaire-champ" data-vocabulaire="<clé>">
 *     <div class="import-vocabulaire-entete">
 *       <label>…</label>
 *       <div class="import-vocabulaire-saisie">
 *         <input type="text" /><button class="import-vocabulaire-ajouter">+</button>
 *       </div>
 *       <details class="import-vocabulaire-actualisation">
 *         <summary>Actualisation</summary>
 *         <div class="import-vocabulaire-menu" data-role="menu"></div>
 *       </details>
 *     </div>
 *     <div class="import-vocabulaire-jetons" data-role="jetons"></div>
 *   </div>
 */

// id de groupe -> { element, libelles: {clé: nom lisible}, listes: {clé: [mots]} }
const editeursMotsCles = new Map();

/**
 * Deux mots-clés sont LE MÊME dès qu'ils ne diffèrent que par la casse, les
 * accents ou les espaces : c'est exactement ce que fait le serveur au moment de
 * ranger la liste (services/import_bancaire.normaliser_libelle). Refuser le
 * doublon ici évite de le voir disparaître en silence à l'enregistrement.
 */
function normaliserMotCle(mot) {
  return mot
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, "")
    .toLowerCase();
}

/**
 * Déclare un groupe de listes de mots-clés et pose ses écouteurs.
 *
 * `libelles` nomme chaque liste ({ sortie: "Sortie", entree: "Entrée" }) : ces
 * noms ne servent qu'au message qui refuse un mot-clé déjà pris ailleurs dans
 * le groupe.
 *
 * `vide` est la phrase affichée à la place des jetons quand la liste est vide.
 * Elle change de sens d'un écran à l'autre — à l'import, une liste vide retombe
 * sur les mots par défaut ; dans une règle, elle veut dire que la condition ne
 * compare rien — d'où le réglage plutôt qu'une phrase câblée.
 *
 * `onChange(cle, mots)` est appelée après chaque ajout ou retrait. Elle sert aux
 * écrans dont l'état vit ailleurs que dans l'éditeur : l'éditeur de règles garde
 * ses conditions dans un brouillon qu'il redessine entièrement, et une liste
 * qu'il faudrait aller relire au moment d'enregistrer aurait fini par diverger
 * de ce qu'on voit.
 *
 * REDÉCLARER LE MÊME GROUPE SUR UN AUTRE ÉLÉMENT LE REMPLACE : un écran qui
 * reconstruit son DOM (l'éditeur de règles, à chaque frappe sur un champ
 * voisin) laisserait sinon l'éditeur pointer sur des nœuds détachés, et ses
 * écouteurs ne serviraient plus rien. Redéclarer sur le MÊME élément ne fait
 * rien, pour ne pas empiler deux jeux d'écouteurs.
 *
 * DÉLÉGUÉS SUR LE CONTENEUR, une fois pour toutes les listes : le rendu réécrit
 * les jetons et le menu à chaque changement, des écouteurs posés dessus
 * partiraient avec eux.
 */
function creerEditeurMotsCles(idGroupe, { conteneur, libelles, vide, onChange } = {}) {
  const element =
    typeof conteneur === "string" ? document.getElementById(conteneur) : conteneur;
  if (!element) return;
  const existant = editeursMotsCles.get(idGroupe);
  if (existant && existant.element === element) return;
  editeursMotsCles.set(idGroupe, { element, libelles, vide, onChange, listes: {} });

  element.addEventListener("click", (e) => {
    const bouton = e.target.closest(".import-vocabulaire-ajouter");
    if (!bouton) return;
    ajouterMotCle(idGroupe, bouton.closest(".import-vocabulaire-champ").dataset.vocabulaire);
  });

  element.addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    const champ = e.target.closest(".import-vocabulaire-saisie input");
    if (!champ) return;
    // Sans quoi Entrée replierait le <details> de configuration (comportement
    // par défaut d'un formulaire implicite) au lieu d'ajouter.
    e.preventDefault();
    ajouterMotCle(idGroupe, champ.closest(".import-vocabulaire-champ").dataset.vocabulaire);
  });
}

function blocMotsCles(idGroupe, cle) {
  const editeur = editeursMotsCles.get(idGroupe);
  return editeur
    ? editeur.element.querySelector(`.import-vocabulaire-champ[data-vocabulaire="${cle}"]`)
    : null;
}

/** Remplit les listes du groupe depuis un preset, et les redessine. */
function chargerMotsCles(idGroupe, valeurs) {
  const editeur = editeursMotsCles.get(idGroupe);
  if (!editeur) return;
  editeur.listes = {};
  Object.entries(valeurs).forEach(([cle, mots]) => {
    editeur.listes[cle] = [...(mots || [])];
    renderMotsCles(idGroupe, cle);
  });
}

/** Ce que le groupe porte, prêt à partir au serveur. */
function motsClesSaisis(idGroupe) {
  const editeur = editeursMotsCles.get(idGroupe);
  if (!editeur) return {};
  const saisis = {};
  Object.entries(editeur.listes).forEach(([cle, mots]) => (saisis[cle] = [...mots]));
  return saisis;
}

function renderMotsCles(idGroupe, cle) {
  const editeur = editeursMotsCles.get(idGroupe);
  const bloc = blocMotsCles(idGroupe, cle);
  if (!bloc) return;
  const mots = editeur.listes[cle] || [];

  const jetons = bloc.querySelector("[data-role='jetons']");
  jetons.innerHTML = "";
  if (mots.length === 0) {
    const vide = document.createElement("span");
    vide.className = "hint";
    // Ce que veut dire une liste vide dépend de l'écran : à l'import elle
    // retombe sur les mots par défaut, dans une règle elle ne compare rien.
    vide.textContent = t(
      editeur.vide || "Aucun mot-clé — les mots par défaut s'appliquent."
    );
    jetons.appendChild(vide);
  } else {
    mots.forEach((mot) => {
      const jeton = document.createElement("span");
      jeton.className = "import-vocabulaire-jeton";
      jeton.textContent = mot;
      jetons.appendChild(jeton);
    });
  }

  // Le menu de suppression : la même liste, mais actionnable. IL RESTE OUVERT
  // après un retrait — on en supprime rarement un seul, et se le voir refermer
  // au visage à chaque clic obligeait à le rouvrir autant de fois qu'il y avait
  // de mots à retirer. Seul son contenu est réécrit ; le <details> lui-même
  // n'est pas reconstruit, il garde donc son état.
  const menu = bloc.querySelector("[data-role='menu']");
  menu.innerHTML = "";
  if (mots.length === 0) {
    const vide = document.createElement("p");
    vide.className = "hint";
    vide.textContent = t("Rien à supprimer.");
    menu.appendChild(vide);
    return;
  }
  mots.forEach((mot, i) => {
    const ligne = document.createElement("button");
    ligne.type = "button";
    ligne.className = "import-vocabulaire-menu-ligne";
    ligne.innerHTML = `<span>${escapeHtml(mot)}</span><span aria-hidden="true">&times;</span>`;
    ligne.setAttribute("aria-label", `${t("Supprimer")} ${mot}`);
    ligne.addEventListener("click", (e) => {
      // `stopPropagation` EST CE QUI GARDE LE MENU OUVERT. Le retrait réécrit
      // le contenu du menu, si bien que le bouton cliqué n'a plus de parent
      // quand le clic remonte au document — et le garde qui referme les menus
      // « au clic ailleurs » le prenait justement pour un clic ailleurs. On en
      // retire rarement un seul : se voir refermer le menu au visage obligeait
      // à le rouvrir autant de fois qu'il y avait de mots à retirer.
      e.stopPropagation();
      editeur.listes[cle].splice(i, 1);
      renderMotsCles(idGroupe, cle);
      if (editeur.onChange) editeur.onChange(cle, [...editeur.listes[cle]]);
    });
    menu.appendChild(ligne);
  });
}

/** La liste du groupe qui porte déjà ce mot-clé, s'il y en a une. */
function listeQuiPorteLeMotCle(idGroupe, mot, sauf) {
  const editeur = editeursMotsCles.get(idGroupe);
  const normalise = normaliserMotCle(mot);
  return Object.keys(editeur.listes).find(
    (cle) =>
      cle !== sauf &&
      (editeur.listes[cle] || []).some((m) => normaliserMotCle(m) === normalise)
  );
}

/** Ajoute ce que porte le champ de saisie de cette liste, et le vide. */
function ajouterMotCle(idGroupe, cle) {
  const editeur = editeursMotsCles.get(idGroupe);
  const bloc = blocMotsCles(idGroupe, cle);
  if (!editeur || !bloc) return;
  const champ = bloc.querySelector(".import-vocabulaire-saisie input");
  const mot = champ.value.trim();
  if (!mot) return;

  if (editeur.listes[cle] === undefined) editeur.listes[cle] = [];

  const ailleurs = listeQuiPorteLeMotCle(idGroupe, mot, cle);
  if (ailleurs) {
    // Le serveur refuse un mot-clé partagé entre deux listes d'un même groupe,
    // et il a raison : il ne saurait pas quoi en faire. Autant le dire avant
    // l'enregistrement.
    showMessage(
      t("« {mot} » est déjà un mot-clé de « {type} ».", {
        mot,
        type: t(editeur.libelles[ailleurs] || ailleurs),
      }),
      "error"
    );
    return;
  }
  if (editeur.listes[cle].some((m) => normaliserMotCle(m) === normaliserMotCle(mot))) {
    showMessage(t("Ce mot-clé est déjà dans la liste."), "error");
    return;
  }

  editeur.listes[cle].push(mot);
  champ.value = "";
  champ.focus();
  renderMotsCles(idGroupe, cle);
  if (editeur.onChange) editeur.onChange(cle, [...editeur.listes[cle]]);
}

// Un seul menu « Actualisation » ouvert à la fois, et refermé dès qu'on clique
// ailleurs : trois listes de suppression déployées côte à côte enterreraient
// les jetons qu'elles décrivent. Délégué sur le document, pour couvrir d'un
// coup tous les groupes, y compris ceux d'une extension.
document.addEventListener("click", (e) => {
  document.querySelectorAll(".import-vocabulaire-actualisation[open]").forEach((menu) => {
    if (!menu.contains(e.target)) menu.open = false;
  });
});

/* ---------- LE CHAMP « COLONNES » DE LA COMPARAISON DES DOUBLONS ----------
 *
 * MÉCANISME DU NOYAU, ET NON UN BLOC RECOPIÉ, pour la même raison que
 * `creerEditeurMotsCles` juste au-dessus et que `creerMenuCases` : la question
 * « sur quelles colonnes compare-t-on deux lignes ? » se pose à l'identique
 * dans les DEUX imports — celui des relevés bancaires et celui des placements
 * — et doit se reconnaître de l'un à l'autre.
 *
 * CE QUI ÉTAIT RECOPIÉ, ET QUI NE L'EST PLUS. Les deux écrans écrivaient à la
 * main les huit balises de l'éditeur de mots-clés, puis la même conversion des
 * jetons en nombres, puis les mêmes quatre phrases d'état. Trois occasions de
 * diverger pour un contrôle dont l'identité EST la fonction : de fait, l'un
 * portait déjà une pastille « i » que l'autre n'avait pas.
 *
 * DES NOMBRES, PAS DES MOTS : le champ est un `type="number"`, ce qui suffit à
 * ce qu'aucune valeur non numérique n'arrive dans la liste (un navigateur rend
 * une chaîne vide pour une saisie invalide, et l'éditeur n'ajoute rien de
 * vide). C'est la seule différence avec un vocabulaire ordinaire.
 *
 * LA PHRASE D'ÉTAT EST LA MOITIÉ DU CONTRÔLE, parce qu'une liste de nombres ne
 * dit pas ce qu'elle fait : les mêmes « 3, 7 » veulent dire « compare celles-ci
 * et rien d'autre » ou « compare tout sauf celles-ci » selon le mode d'à côté.
 * Et une liste VIDE ne dit pas la même chose des deux côtés — en exclusion elle
 * est parfaitement valide (tout est comparé), en sélection elle ne comparerait
 * rien, donc chaque ligne serait le doublon de la première déjà importée. Le
 * serveur refuse ce second cas ; l'écran le dit avant qu'on y arrive.
 */

// id de groupe -> { etat, mode, onChange, numeros }
const champsColonnes = new Map();

/**
 * Pose le champ « Colonnes » dans `conteneur` et le câble.
 *
 * `etat` est l'élément (ou son id) où s'écrit la phrase qui dit ce que la liste
 * veut dire ; `mode()` rend « selection » ou « exclusion » ; `onChange(numeros)`
 * reçoit les numéros de colonne, déjà triés en entiers positifs.
 */
function creerChampColonnes(idGroupe, { conteneur, etat, mode, onChange } = {}) {
  const element =
    typeof conteneur === "string" ? document.getElementById(conteneur) : conteneur;
  if (!element) return;
  const idSaisie = `${element.id || idGroupe}-saisie`;
  element.innerHTML = `
    <div class="import-vocabulaire-champ" data-vocabulaire="colonnes">
      <div class="import-vocabulaire-entete">
        <label for="${idSaisie}">${t("Colonnes")}</label>
        <div class="import-vocabulaire-saisie">
          <input type="number" id="${idSaisie}" min="1" step="1" placeholder="${t(
            "n°"
          )}" />
          <button type="button" class="import-vocabulaire-ajouter" data-action="ajouter"
                  title="${t("Ajouter cette colonne")}"
                  aria-label="${t("Ajouter cette colonne")}">+</button>
        </div>
        <details class="import-vocabulaire-actualisation">
          <summary>${t("Actualisation")}</summary>
          <div class="import-vocabulaire-menu" data-role="menu"></div>
        </details>
      </div>
      <div class="import-vocabulaire-jetons" data-role="jetons"></div>
    </div>`;

  champsColonnes.set(idGroupe, {
    etat: typeof etat === "string" ? document.getElementById(etat) : etat,
    mode,
    onChange,
    numeros: [],
  });

  creerEditeurMotsCles(idGroupe, {
    conteneur: element,
    libelles: { colonnes: t("Colonnes") },
    vide: "Aucune colonne désignée.",
    onChange: (_cle, valeurs) => {
      const champ = champsColonnes.get(idGroupe);
      champ.numeros = valeurs
        .map((valeur) => parseInt(valeur, 10))
        .filter((numero) => Number.isInteger(numero) && numero > 0);
      majEtatChampColonnes(idGroupe);
      champ.onChange(champ.numeros);
    },
  });
}

/** Réécrit les jetons d'après une liste de numéros, sans passer par onChange :
 *  c'est le chargement d'un preset, pas une saisie. */
function chargerChampColonnes(idGroupe, numeros) {
  const champ = champsColonnes.get(idGroupe);
  if (!champ) return;
  champ.numeros = [...(numeros || [])];
  chargerMotsCles(idGroupe, { colonnes: champ.numeros.map(String) });
  majEtatChampColonnes(idGroupe);
}

/** Ce que la liste VEUT DIRE, sous les jetons. Publique : changer le mode d'à
 *  côté retourne le sens de la phrase sans toucher à la liste. */
function majEtatChampColonnes(idGroupe) {
  const champ = champsColonnes.get(idGroupe);
  if (!champ || !champ.etat) return;
  const selection = champ.mode() === "selection";
  const vide = champ.numeros.length === 0;
  champ.etat.className = vide && selection ? "hint erreur-hint" : "hint";
  champ.etat.textContent = vide
    ? selection
      ? t(
          "Aucune colonne choisie : ajoute-en au moins une, sinon plus rien ne distingue deux lignes."
        )
      : t("Aucune colonne exclue : toutes les colonnes du fichier sont comparées.")
    : selection
      ? t("Seules ces colonnes distinguent deux lignes.")
      : t("Toutes les colonnes sont comparées, sauf celles-ci.");
}

/* ----- Vocabulaires (colonnes « Sens » et « État ») ----- */

// Les deux colonnes qui demandent un vocabulaire. Chacune est un GROUPE de
// l'éditeur de mots-clés ci-dessus : à l'intérieur d'un groupe, un mot-clé ne
// peut désigner qu'une seule chose (le serveur le refuse, cf.
// nettoyer_vocabulaire) ; d'un groupe à l'autre, rien ne l'interdit — « OK »
// peut nommer une entrée ET un état exécuté, ce sont deux colonnes.
//
// `listes` fait le lien entre la clé courte que porte le DOM
// (`data-vocabulaire="sortie"`) et le champ du preset qui part au serveur.
const CHAMPS_VOCABULAIRE = {
  sens: {
    propriete: "sens",
    bloc: "import-sens-libelles-bloc",
    listes: {
      sortie: "libelles_sens_sortie",
      entree: "libelles_sens_entree",
    },
    libelles: { sortie: "Sortie", entree: "Entrée" },
  },
  statut: {
    propriete: "statut",
    bloc: "import-statut-libelles-bloc",
    listes: {
      execute: "libelles_statut_execute",
      attente: "libelles_statut_attente",
      refuse: "libelles_statut_refuse",
    },
    libelles: { execute: "Exécuté", attente: "En attente", refuse: "Refusé / annulé" },
  },
};

Object.entries(CHAMPS_VOCABULAIRE).forEach(([cle, { bloc, libelles }]) => {
  creerEditeurMotsCles(`import-${cle}`, { conteneur: bloc, libelles });
});

function renderImportVocabulaires(config) {
  // Les éditeurs reprennent ceux du preset : ce que l'étape « mots-clés » avait posé n'a plus cours.
  importVocabulairesEssai = null;
  importVocabulairesAvant = null;
  Object.entries(CHAMPS_VOCABULAIRE).forEach(([cle, { listes }]) => {
    const valeurs = {};
    Object.entries(listes).forEach(([nom, champ]) => (valeurs[nom] = config[champ] || []));
    chargerMotsCles(`import-${cle}`, valeurs);
  });
  updateImportSensLibellesVisibilite();
  updateImportStatutLibellesVisibilite();
}

function vocabulairesSaisis() {
  const saisis = {};
  Object.entries(CHAMPS_VOCABULAIRE).forEach(([cle, { listes }]) => {
    const mots = motsClesSaisis(`import-${cle}`);
    Object.entries(listes).forEach(([nom, champ]) => (saisis[champ] = mots[nom] || []));
  });
  return saisis;
}

// Un vocabulaire ne veut rien dire sans sa colonne : le bloc suit donc la
// configuration des colonnes, pas seulement le chargement du preset.
function updateVocabulaireVisibilite(cle) {
  const { propriete, bloc } = CHAMPS_VOCABULAIRE[cle];
  document.getElementById(bloc).style.display = importConfigColonnes.some(
    (c) => c.propriete === propriete
  )
    ? ""
    : "none";
}

function updateImportSensLibellesVisibilite() {
  updateVocabulaireVisibilite("sens");
}

function updateImportStatutLibellesVisibilite() {
  updateVocabulaireVisibilite("statut");
}

// Les valeurs par défaut viennent du serveur (/meta) : les recopier ici
// garantirait surtout qu'elles divergent le jour où la liste change.
function renderImportVocabulairesDefauts() {
  const sens = (state.meta && state.meta.libelles_sens_defaut) || null;
  if (sens) {
    document.getElementById("import-sens-sortie-defaut").textContent = sens.sortie.join(", ");
    document.getElementById("import-sens-entree-defaut").textContent = sens.entree.join(", ");
  }
  const statut = (state.meta && state.meta.libelles_statut_defaut) || null;
  if (statut) {
    ["execute", "attente", "refuse"].forEach((etat) => {
      document.getElementById(`import-statut-${etat}-defaut`).textContent =
        (statut[etat] || []).join(", ");
    });
  }
}

/**
 * Numéro de colonne mémorisé pour une propriété DÉSACTIVÉE, le temps de la
 * session : réactiver ce qu'on vient d'éteindre par mégarde ne doit pas coûter
 * de retrouver le numéro. Rien n'est stocké côté serveur — une propriété
 * désactivée n'existe tout simplement pas dans `preset.colonnes` — donc au
 * rechargement suivant le numéro est à ressaisir, et le champ le montre en
 * restant vide.
 */
const importIndexMemorises = {};

/**
 * Une ligne de configuration : l'interrupteur qui active ou éteint la propriété, son nom, et son
 * numéro de colonne. (C'était un œil ; un interrupteur se lit d'un coup d'œil, allumé ou éteint.)
 *
 * Toutes les propriétés ont leur ligne, activée ou non — il n'y a plus rien à
 * « ajouter ». Chacune ne peut de toute façon être lue qu'une fois (le serveur
 * refuse deux colonnes pour la même propriété), donc le menu déroulant d'avant
 * ne faisait qu'ouvrir la porte à une configuration invalide, en échange d'un
 * clic de plus pour arriver à la seule liste possible.
 */
function creerLigneConfigColonne(propriete, libelle, { actif }) {
  const colonne = actif
    ? importConfigColonnes.find((c) => c.propriete === propriete)
    : null;
  const obligatoire = proprieteImportObligatoire(propriete);
  const index = colonne ? colonne.index : importIndexMemorises[propriete] ?? "";

  const info = infoProprieteImport(propriete);
  const bulle = info
    // Plus de `info-bulle-gauche` : le recadrage est calculé à l'ouverture,
    // d'après la place réellement disponible (cf. app.js § « Infobulles »).
    ? `<i class="info-bulle info-bulle-texte" tabindex="0" data-info="${escapeHtml(t(info))}">i</i>`
    : "";

  const row = document.createElement("div");
  row.className = `import-mapping-row import-config-ligne${actif ? "" : " inactive"}`;
  row.innerHTML = `
    <input type="checkbox" class="import-config-interrupteur" data-action="basculer"
           title="${
             obligatoire
               ? t("Cette propriété est obligatoire : elle ne peut pas être désactivée.")
               : actif
                 ? t("Ne plus lire cette colonne")
                 : t("Lire cette colonne")
           }"
           aria-label="${escapeHtml(libelle)}"
           ${actif ? "checked" : ""} ${obligatoire ? "disabled" : ""} />
    <span class="import-config-propriete">${escapeHtml(t(libelle))}${bulle}</span>
    <label class="import-config-index">${t("Colonne n°")}
      <input type="number" min="1" value="${index}" ${actif ? "" : "disabled"} />
    </label>
  `;

  row.querySelector("input[type='number']").addEventListener("input", (e) => {
    if (!colonne) return;
    colonne.index = Number(e.target.value) || 0;
    // MÊME ÉTAT QU'UN EN-TÊTE DÉPLACÉ : le tableau du fichier ne montre plus ce
    // que l'app a lu. Le bouton de relecture s'allume, ici comme là.
    importApercuAReloire = true;
    majBoutonRelireApercu();
  });

  // À la VALIDATION seulement (sortie du champ) : redessiner tout le tableau du
  // fichier à chaque frappe coûterait cher sur un relevé de plusieurs centaines
  // de lignes, pour un numéro qu'on est encore en train de taper.
  row.querySelector("input[type='number']").addEventListener("change", () => {
    if (colonne) renderApercuFichier();
  });

  row.querySelector("input[data-action='basculer']").addEventListener("change", (e) => {
    // UN PRESET LIÉ À UN COMPTE N'A PAS À LIRE LE COMPTE DANS LE FICHIER : le compte
    // lié s'impose à toutes les lignes, la colonne ne servirait à rien. On refuse
    // d'allumer, et on dit quoi faire — plutôt que d'allumer une colonne que
    // l'import ignorera en silence.
    if (propriete === "compte_banque" && !actif && importPresetCompteChoisi() != null) {
      e.target.checked = false;
      showMessage(t(texteAide("noyau.import-compte-banque-preset-lie")), "error");
      return;
    }
    basculerProprieteImport(propriete, !actif);
    renderImportConfig();
    updateImportPresetCompteAvertissement();
  });
  return row;
}

function eteindreProprieteImport(propriete) {
  const colonne = importConfigColonnes.find((c) => c.propriete === propriete);
  if (!colonne) return;
  // Le numéro est mis de côté : rallumer dans la foulée doit redonner
  // exactement la même configuration.
  importIndexMemorises[propriete] = colonne.index;
  importConfigColonnes.splice(importConfigColonnes.indexOf(colonne), 1);
}

function allumerProprieteImport(propriete) {
  if (importConfigColonnes.some((c) => c.propriete === propriete)) return;
  importConfigColonnes.push({
    propriete,
    index: importIndexMemorises[propriete] ?? prochainIndexLibre(),
  });
}

/**
 * Allume ou éteint une propriété, EN EMMENANT CE QUI VA AVEC.
 *
 * Le montant scindé est le seul cas : ses deux colonnes ne veulent rien dire
 * l'une sans l'autre, et elles remplacent « Montant » (ainsi que « Sens », qui
 * porte la même information). Faire ces trois gestes à la main, dans le bon
 * ordre, pour obtenir la seule configuration que le serveur accepte, n'aurait
 * eu d'autre effet que de faire découvrir la règle par un message d'erreur.
 */
function basculerProprieteImport(propriete, allumer) {
  const scindee = PROPRIETES_MONTANT_SCINDE.includes(propriete);
  if (scindee && allumer) {
    PROPRIETES_MONTANT_SCINDE.forEach(allumerProprieteImport);
    eteindreProprieteImport("montant");
    eteindreProprieteImport("sens");
    return;
  }
  if (scindee) {
    PROPRIETES_MONTANT_SCINDE.forEach(eteindreProprieteImport);
    // Une ligne doit toujours avoir un montant : renoncer au couple rallume la
    // colonne unique, plutôt que de laisser une configuration sans montant du
    // tout.
    allumerProprieteImport("montant");
    return;
  }
  if (allumer && (propriete === "montant" || propriete === "sens")) {
    PROPRIETES_MONTANT_SCINDE.forEach(eteindreProprieteImport);
    allumerProprieteImport("montant");
    if (propriete === "sens") allumerProprieteImport("sens");
    return;
  }
  if (allumer) allumerProprieteImport(propriete);
  else eteindreProprieteImport(propriete);
}

// Le premier numéro de colonne que le preset ne lit pas encore : une valeur de
// départ qui ne crée pas de doublon, à corriger de toute façon par
// l'utilisateur.
function prochainIndexLibre() {
  const pris = new Set(importConfigColonnes.map((c) => c.index));
  let index = 1;
  while (pris.has(index)) index += 1;
  return index;
}

/**
 * Les deux listes de propriétés, chacune avec ses colonnes ACTIVES d'abord (dans
 * l'ordre où le preset les porte) puis les inactives : ce qui est lu se lit
 * d'un bloc, sans avoir à trier du regard une liste où actif et inactif
 * alternent.
 */
function renderImportConfig() {
  [
    ["import-config-colonnes", PROPRIETES_IMPORT],
    ["import-config-colonnes-avancees", proprietesAvanceesAffichees()],
  ].forEach(([blocId, proprietes]) => {
    const bloc = document.getElementById(blocId);
    bloc.innerHTML = "";
    const estActive = (propriete) =>
      importConfigColonnes.some((c) => c.propriete === propriete);
    const rang = (propriete) =>
      importConfigColonnes.findIndex((c) => c.propriete === propriete);

    [...proprietes]
      .sort(([a], [b]) => {
        if (estActive(a) !== estActive(b)) return estActive(a) ? -1 : 1;
        return estActive(a) ? rang(a) - rang(b) : 0;
      })
      .forEach(([propriete, libelle]) => {
        bloc.appendChild(
          creerLigneConfigColonne(propriete, libelle, { actif: estActive(propriete) })
        );
      });
  });

  renderColonnesDummy();
  updateResumeConfigAvancee();
  updateResumeConfigFichier();
  updateImportSensLibellesVisibilite();
  updateImportStatutLibellesVisibilite();
}

/* ----- Colonnes dummy (migration 0079) ----- */

async function chargerColonnesDummyConnues() {
  try {
    colonnesDummyConnues = await apiFetch("/import/colonnes-dummy");
  } catch {
    // La liste ne sert qu'au menu « + » : sans elle, on peut toujours créer une colonne neuve.
    colonnesDummyConnues = [];
  }
}

/**
 * Une ligne par colonne dummy lue — son nom, son numéro, la croix qui la retire — puis le
 * bouton « + », dont le menu propose une colonne NEUVE en tête, et en dessous toutes celles
 * des autres formats que celui-ci ne lit pas encore. Reprendre une colonne existante, c'est
 * ce qui permet à une règle écrite pour un format de servir aussi à celui-ci.
 *
 * RIEN N'EST ÉCRIT AVANT « Enregistrer la configuration », comme pour les autres colonnes :
 * une colonne neuve n'a pas encore d'identifiant, le serveur le lui donne à ce moment-là.
 */
function renderColonnesDummy() {
  const bloc = document.getElementById("import-config-colonnes-dummy");
  if (!bloc) return;
  bloc.innerHTML = "";
  importConfigColonnesDummy.forEach((colonne) => {
    const neuve = colonne.colonne_dummy_id == null;
    const row = document.createElement("div");
    row.className = "import-mapping-row import-config-ligne import-config-dummy";
    row.innerHTML = `
      <span class="import-config-propriete">${
        neuve
          ? `<input type="text" data-role="nom" spellcheck="false"
                    placeholder="${escapeHtml(t("Nom de la colonne"))}"
                    value="${escapeHtml(colonne.nom || "")}" />`
          : escapeHtml(colonne.nom)
      }</span>
      <label class="import-config-index">${t("Colonne n°")}
        <input type="number" min="1" data-role="index" value="${colonne.index || ""}" />
      </label>
      <button type="button" class="champ-ajoute-retirer" data-role="retirer"
              title="${escapeHtml(t("Ne plus lire cette colonne"))}"
              aria-label="${escapeHtml(t("Ne plus lire cette colonne"))}">×</button>
    `;
    row.querySelector("[data-role='nom']")?.addEventListener("input", (e) => {
      colonne.nom = e.target.value;
    });
    row.querySelector("[data-role='nom']")?.addEventListener("change", renderApercuFichier);
    row.querySelector("[data-role='index']").addEventListener("input", (e) => {
      colonne.index = Number(e.target.value) || 0;
    });
    // À la validation seulement, comme les numéros des propriétés (cf. creerLigneConfigColonne).
    row.querySelector("[data-role='index']").addEventListener("change", renderApercuFichier);
    row.querySelector("[data-role='retirer']").addEventListener("click", () => {
      importConfigColonnesDummy.splice(importConfigColonnesDummy.indexOf(colonne), 1);
      renderColonnesDummy();
      updateResumeConfigAvancee();
      renderApercuFichier();
    });
    bloc.appendChild(row);
  });

  const lues = new Set(importConfigColonnesDummy.map((c) => c.colonne_dummy_id));
  const NOUVELLE = "nouvelle";
  creerMenuAjoutChamp(document.getElementById("import-colonnes-dummy-ajout"), {
    libelle: t("Ajouter une colonne dummy"),
    options: [
      { cle: NOUVELLE, libelle: t("Nouvelle colonne") },
      ...colonnesDummyConnues
        .filter((c) => !lues.has(c.id))
        .map((c) => ({
          cle: String(c.id),
          libelle: c.formats.length
            ? t("{nom} (lue par {formats})", {
                nom: c.nom,
                formats: c.formats.map((f) => f.nom).join(", "),
              })
            : c.nom,
        })),
    ],
    onChoix: (cle) => {
      const existante = colonnesDummyConnues.find((c) => String(c.id) === cle);
      importConfigColonnesDummy.push({
        colonne_dummy_id: existante ? existante.id : null,
        nom: existante ? existante.nom : "",
        index: prochainIndexLibre(),
      });
      renderColonnesDummy();
      updateResumeConfigAvancee();
      renderApercuFichier();
      // Une colonne neuve attend son nom : le curseur y va directement.
      if (!existante) {
        const champs = document.querySelectorAll("#import-config-colonnes-dummy [data-role='nom']");
        champs[champs.length - 1]?.focus();
      }
    },
  });
}

/**
 * Le résumé du bandeau « Configuration du fichier », replié en temps normal.
 *
 * Il doit répondre sans ouvrir aux deux questions qu'on se pose devant un
 * import qui ne fait pas ce qu'on croyait : combien de colonnes sont lues, et
 * sur quoi les doublons se comparent. La règle des doublons y figure en toutes
 * lettres parce que c'est elle qu'on soupçonne en premier quand une ligne déjà
 * importée ressort comme neuve.
 */
function updateResumeConfigFichier() {
  const nbColonnes = importConfigColonnes.length;
  document.getElementById("import-config-fichier-resume").textContent =
    `${t("{n} colonne(s) lue(s)", { n: nbColonnes })} · ${resumeDoublons()}`;
}

/**
 * « toutes les colonnes », « toutes sauf 3 », « uniquement 2 colonnes ».
 *
 * ÉCRIT UNE FOIS POUR DEUX BANDEAUX : celui de « Configuration du fichier »,
 * qui doit répondre sans rien ouvrir, et celui de la section « Comparaison des
 * doublons » elle-même. Deux formulations pour la même règle auraient fini par
 * se contredire à l'arrondi près — et c'est justement la règle qu'on soupçonne
 * en premier quand une ligne déjà importée ressort comme neuve.
 */
function resumeDoublons() {
  const n = importConfigColonnesComparaison.length;
  if (modeComparaisonChoisi() === "selection") {
    return t("doublons : {n} colonne(s) comparée(s)", { n });
  }
  return n === 0
    ? t("doublons : toutes les colonnes")
    : t("doublons : toutes sauf {n}", { n });
}

function updateResumeConfigDoublons() {
  document.getElementById("import-config-doublons-resume").textContent = resumeDoublons();
}

// Le bandeau de « Lignes à ne pas importer » : replié, c'est la seule façon de
// savoir que trois lignes du haut sont écartées. Zéro est le cas ordinaire, et
// il se dit — « rien n'est ignoré » plutôt qu'un bandeau vide, qui se lirait
// comme un réglage qu'on n'a pas encore regardé.
function updateResumeLignesEntete() {
  const n = lignesEnteteSaisies() + lignesPiedSaisies();
  document.getElementById("import-lignes-entete-resume").textContent =
    n === 0 ? t("aucune ligne ignorée") : t("{n} ligne(s) ignorée(s)", { n });
}

/* ----- Configuration avancée ----- */

// Résumé affiché à côté du titre replié : sans lui, une configuration avancée
// active serait invisible tant qu'on n'ouvre pas la section — et des frais
// ajoutés au montant sont bien trop surprenants pour rester cachés.
function updateResumeConfigAvancee() {
  const affichees = new Set(proprietesAvanceesAffichees().map(([cle]) => cle));
  const avancees =
    importConfigColonnes.filter((c) => affichees.has(c.propriete)).length +
    importConfigColonnesDummy.length;
  document.getElementById("import-config-avancee-resume").textContent =
    avancees > 0 ? `${avancees} colonne(s)` : "inactive";
}

function modeComparaisonChoisi() {
  return document.getElementById("import-mode-comparaison").value;
}

/**
 * LES COLONNES DE LA COMPARAISON — le champ du noyau, celui-là même que
 * l'import de placements emploie (cf. `creerChampColonnes`).
 *
 * Chaque colonne avait sa rangée : un champ « Colonne n° », un bouton
 * « Supprimer », et une ligne de plus à chaque ajout. Six colonnes exclues —
 * le cas ordinaire d'un relevé bavard — faisaient six rangées, soit plus de
 * place que tout le reste de la configuration, pour une réponse qui tient en
 * une liste de nombres. Le champ pose la même question sur UNE ligne : une
 * saisie, un « + », les valeurs en jetons, et le menu de droite pour retirer.
 */
const GROUPE_COLONNES_COMPARAISON = "import-comparaison";

creerChampColonnes(GROUPE_COLONNES_COMPARAISON, {
  conteneur: "import-comparaison-colonnes",
  etat: "import-comparaison-etat",
  mode: modeComparaisonChoisi,
  onChange: (numeros) => {
    importConfigColonnesComparaison = numeros;
    // Les deux bandeaux de repli suivent la saisie, pas seulement
    // l'enregistrement : replier après avoir tapé « 3 » doit le montrer.
    updateResumeConfigFichier();
    updateResumeConfigDoublons();
  },
});

function renderImportConfigColonnesComparaison() {
  chargerChampColonnes(GROUPE_COLONNES_COMPARAISON, importConfigColonnesComparaison);
  updateResumeConfigFichier();
  updateResumeConfigDoublons();
}

// Changer de mode retourne le sens de la liste déjà saisie : la vider évite
// qu'un « sauf la colonne 12 » devienne en un clic un « uniquement la colonne
// 12 », qui dit exactement le contraire.
document.getElementById("import-mode-comparaison").addEventListener("change", () => {
  importConfigColonnesComparaison = [];
  renderImportConfigColonnesComparaison();
});

// Le bandeau de la section suit le champ, pas seulement l'enregistrement :
// replier après avoir tapé « 3 » doit montrer « 3 ligne(s) ignorée(s) ».
document.getElementById("import-lignes-entete").addEventListener("input", updateResumeLignesEntete);
document.getElementById("import-lignes-pied").addEventListener("input", updateResumeLignesEntete);

/**
 * Enregistre la configuration du preset, puis relit le fichier si l'aperçu
 * affiché ne décrit plus ce que l'import fera.
 *
 * UNE FONCTION ET DEUX BOUTONS (cf. l'icône de relecture de l'aperçu) : la
 * relecture n'envoyait au serveur que les COLONNES, et lisait le reste du
 * preset tel qu'il est ENREGISTRÉ — lignes de tête, mode de comparaison,
 * vocabulaires. Un réglage changé sans être enregistré était donc ignoré par la
 * relecture, qui rendait un aperçu décrivant l'ancienne configuration : on
 * corrigeait, on relisait, rien ne bougeait, et rien ne disait pourquoi.
 * Enregistrer d'abord fait disparaître l'écart au lieu de l'expliquer.
 *
 * Rend `true` si la configuration est passée, `false` si elle a été refusée —
 * l'appelant sait alors qu'il n'y a rien eu à relire.
 */
async function enregistrerConfigurationImport({
  relireToujours = false,
  message = t("Configuration enregistrée"),
  // Faux : l'aperçu affiché a déjà été lu avec ce qu'on enregistre (le premier import, cf.
  // `enregistrerPremierImport`) - le relire défairait les choix faits dessus.
  relireSiPerime = true,
} = {}) {
  // Une colonne activée sans numéro (ou à 0) serait refusée par le serveur avec
  // un message d'erreur de validation illisible : on nomme la propriété
  // concernée, seule chose qui dise où corriger.
  const sansNumero = importConfigColonnes.filter((c) => !c.index || c.index < 1);
  if (sansNumero.length > 0) {
    const libelle = (propriete) =>
      ([...PROPRIETES_IMPORT, ...PROPRIETES_IMPORT_AVANCEES].find(([cle]) => cle === propriete) ||
        [propriete, propriete])[1];
    showMessage(
      t("Renseigne le numéro de colonne de : {proprietes}.", {
        proprietes: sansNumero.map((c) => t(libelle(c.propriete))).join(", "),
      }),
      "error"
    );
    return false;
  }
  // Même chose pour les colonnes dummy : une neuve sans nom, ou sans numéro, se nomme ici.
  if (importConfigColonnesDummy.some((c) => c.colonne_dummy_id == null && !(c.nom || "").trim())) {
    showMessage(t("Donne un nom à chaque nouvelle colonne dummy."), "error");
    return false;
  }
  const dummySansNumero = importConfigColonnesDummy.filter((c) => !c.index || c.index < 1);
  if (dummySansNumero.length > 0) {
    showMessage(
      t("Renseigne le numéro de colonne de : {proprietes}.", {
        proprietes: dummySansNumero.map((c) => c.nom || t("Nouvelle colonne")).join(", "),
      }),
      "error"
    );
    return false;
  }
  try {
    const config = await apiFetch(importUrl(""), {
      method: "PUT",
      body: JSON.stringify({
        nom: presetActuel().nom,
        compte_id: importPresetCompteChoisi(),
        // Une seule liste côté serveur : la séparation base / avancée n'existe
        // qu'à l'affichage, et une propriété éteinte n'y figure simplement pas.
        colonnes: importConfigColonnes,
        colonnes_dummy: importConfigColonnesDummy.map((c) => ({
          colonne_dummy_id: c.colonne_dummy_id ?? null,
          nom: c.colonne_dummy_id == null ? (c.nom || "").trim() : null,
          index: c.index,
        })),
        colonnes_comparaison: importConfigColonnesComparaison,
        mode_comparaison: modeComparaisonChoisi(),
        lignes_entete: lignesEnteteSaisies(),
        lignes_pied: lignesPiedSaisies(),
        ...vocabulairesSaisis(),
      }),
    });
    // L'aperçu affiché décrit-il encore ce que l'import fera ? Comparé AVANT
    // d'écraser la signature de référence — c'est ce qui décide de relire le
    // fichier plus bas.
    const apercuPerime = signatureApercu(config) !== importSignatureApercuEnregistree;
    importSignatureApercuEnregistree = signatureApercu(config);
    importSignatureColonnesEnregistrees = signatureColonnesImport(config.colonnes);
    importConfigColonnes = config.colonnes.map((c) => ({ ...c }));
    // Relues depuis la réponse : une colonne neuve y a gagné son identifiant, ou retrouvé
    // celle d'un autre format qui portait déjà ce nom.
    importConfigColonnesDummy = (config.colonnes_dummy || []).map((c) => ({ ...c }));
    await chargerColonnesDummyConnues();
    importConfigColonnesComparaison = [...(config.colonnes_comparaison || [])];
    document.getElementById("import-mode-comparaison").value = config.mode_comparaison;
    document.getElementById("import-lignes-entete").value = lignesEnteteDe(config);
    document.getElementById("import-lignes-pied").value = lignesPiedDe(config);
    // Réaffichés depuis la réponse : le serveur a retiré les entrées vides et
    // les doublons, l'utilisateur doit voir ce qui a réellement été retenu.
    renderImportVocabulaires(config);
    renderImportConfig();
    renderImportPresetCompte(config.compte_id);
    renderImportConfigColonnesComparaison();
    // Bascule juste la visibilité du bloc, sans reconstruire le <select>
    // (cf. updateImportCompteDefautVisibility, appelée seulement au
    // chargement/changement de preset) : sinon la sélection de l'utilisateur
    // serait aussitôt écrasée par un <select> reconstruit sans elle -- bug
    // corrigé, qui faisait que compte_id_defaut n'était jamais transmis et
    // que toutes les lignes affichaient "compte à mapper" à l'import.
    toggleImportCompteDefautBloc();
    // La configuration vient d'être réglée SUR CE FICHIER : c'est désormais à
    // lui que le preset doit ressembler, pour être reconnu au prochain.
    if (importFichierActuel) await memoriserSignatureImport();
    await loadImportPresets();
    // `message: null` : enregistrer sans le dire (le tutoriel d'import, à chaque étape).
    if (message) showMessage(message, "success");
    // Un fichier déjà chargé a été analysé avec l'ANCIENNE configuration : ses
    // couleurs de colonnes, ses en-têtes de propriété, ses lignes résolues et
    // ses doublons décrivent un import qui n'a plus cours. On le relit donc,
    // pour que l'aperçu montre ce que l'import fera réellement — c'est le seul
    // moyen de corriger un numéro de colonne en le voyant tomber en face des
    // bonnes données, ou de voir une exclusion faire apparaître les doublons
    // qu'elle débloque. Rien à faire si seul le nom a bougé (cf.
    // signatureApercu).
    if (((apercuPerime && relireSiPerime) || relireToujours) && importFichierActuel) {
      await relireFichierImport();
    }
    return true;
  } catch (err) {
    showMessage(err.message, "error");
    return false;
  }
}

document.getElementById("btn-import-config-enregistrer").addEventListener("click", () =>
  enregistrerConfigurationImport()
);

// Le compte "pour ce fichier" ne sert que faute de mieux : il disparaît dès
// qu'une colonne le désigne ligne par ligne, et dès que le preset est lié à un
// compte (qui répond à la même question, mais une fois pour toutes).
function toggleImportCompteDefautBloc() {
  const aColonneCompte = importConfigColonnes.some((c) => c.propriete === "compte_banque");
  const presetLie = importPresetCompteChoisi() != null;
  document.getElementById("import-compte-defaut-bloc").style.display =
    aColonneCompte || presetLie ? "none" : "";
}

function updateImportCompteDefautVisibility() {
  toggleImportCompteDefautBloc();
  _refillPreservingSelection(document.getElementById("import-compte-defaut"), (el) => {
    fillComptesSelect(el, comptesProposables(Number(el.value) || null), { keepFirst: true });
    // Le compte créé devient le choix, et ce choix relit le fichier comme tout autre (cf. initCompteImport).
    ajouterOptionCreer(el, "compte", {
      demander: () => demanderCreationCompte(),
      remplir: updateImportCompteDefautVisibility,
    });
  });
}

function compteIdDefautChoisi() {
  const bloc = document.getElementById("import-compte-defaut-bloc");
  if (bloc.style.display === "none") return null;
  const val = document.getElementById("import-compte-defaut").value;
  return val || null;
}

/* ----- Upload / aperçu / confirmation ----- */

const importDropzone = document.getElementById("import-dropzone");

document.getElementById("btn-import-choisir-fichier").addEventListener("click", () => {
  document.getElementById("import-fichier").click();
});

document.getElementById("import-fichier").addEventListener("change", (e) => {
  definirFichierImport(e.target.files[0]);
});

["dragenter", "dragover"].forEach((evt) => {
  importDropzone.addEventListener(evt, (e) => {
    e.preventDefault();
    importDropzone.classList.add("dragover");
  });
});

["dragleave", "dragend"].forEach((evt) => {
  importDropzone.addEventListener(evt, () => {
    importDropzone.classList.remove("dragover");
  });
});

importDropzone.addEventListener("drop", (e) => {
  e.preventDefault();
  importDropzone.classList.remove("dragover");
  const fichier = e.dataTransfer.files[0];
  if (fichier) definirFichierImport(fichier);
});

async function analyserFichierImport() {
  if (!importFichierActuel) {
    showMessage(t("Choisis d'abord un fichier à analyser."), "error");
    return;
  }
  // L'analyse démarre désormais dès le choix du fichier : elle peut donc
  // précéder la fin du chargement des presets (ou survenir après un échec de
  // celui-ci). On les charge à la demande plutôt que de partir sur un preset
  // indéfini.
  if (importPresetId == null) {
    try {
      await loadImportPresets();
    } catch (err) {
      showMessage(err.message, "error");
      return;
    }
    if (importPresetId == null) {
      showMessage(t("Aucun preset d'import disponible : crées-en un d'abord."), "error");
      return;
    }
  }
  // Analyser un nouveau fichier abandonne l'aperçu en cours (y compris les
  // remboursements en attente de liaison) : on prévient plutôt que de jeter
  // silencieusement le travail entamé.
  if (
    importApercu &&
    importApercu.lignes.length > 0 &&
    !confirm(t("Un aperçu est déjà en cours : analyser ce fichier l'abandonnera (lignes en attente comprises). Continuer ?"))
  ) {
    return;
  }
  await lireFeuillesImport();
  await reconnaitrePresetImport();
  await executerPrevisualisation();
}

/**
 * UN CLASSEUR À PLUSIEURS FEUILLES : laquelle porte le relevé ? Le serveur
 * compte, feuille par feuille, les lignes qui ont la forme d'une opération
 * (une date et un nombre), et propose la mieux pourvue. Elle est retenue et
 * AFFICHÉE dans les réglages de lecture, qui s'ouvrent quand elle n'est pas la
 * feuille active — celle qu'on aurait lue sans rien demander.
 */
async function lireFeuillesImport() {
  importFeuille = null;
  document.getElementById("import-reglage-feuille-champ").style.display = "none";
  const formData = new FormData();
  formData.append("fichier", importFichierActuel);
  let lecture;
  try {
    lecture = await apiFetchForm("/import/lecture-fichier", formData);
  } catch (err) {
    // L'aperçu, juste après, dira ce qui ne va pas avec ce fichier.
    return;
  }
  if (lecture.format !== "xlsx" || lecture.feuilles.length < 2) return;
  const select = document.getElementById("import-reglage-feuille");
  select.innerHTML = lecture.feuilles
    .map((f) => `<option value="${escapeHtml(f.nom)}">${escapeHtml(f.nom)}</option>`)
    .join("");
  importFeuille = lecture.feuille_proposee || lecture.feuille;
  select.value = importFeuille;
  document.getElementById("import-reglage-feuille-aide").textContent = t(
    texteAide("noyau.feuille-proposee"),
    { feuille: importFeuille }
  );
  document.getElementById("import-reglage-feuille-champ").style.display = "";
  if (importFeuille !== lecture.feuille) {
    document.getElementById("import-config-fichier").open = true;
    document.getElementById("import-reglages-lecture").open = true;
  }
  renderImportReglagesLecture();
}

document.getElementById("import-reglage-feuille").addEventListener("change", async (e) => {
  importFeuille = e.target.value || null;
  if (!importFichierActuel) return;
  await reconnaitrePresetImport();
  await executerPrevisualisation();
});

/**
 * L'aller-retour de prévisualisation lui-même : envoie le fichier, repart d'un
 * aperçu neuf (les choix faits sur l'aperçu précédent portaient sur une autre
 * lecture du fichier), et réaffiche tout.
 *
 * Partagé par le choix d'un fichier et par la relecture qui suit un changement
 * de configuration : c'est exactement la même opération, seul le déclencheur
 * change.
 */
/**
 * Joint à une requête d'import LES COLONNES QUE L'ÉCRAN AFFICHE, et non celles
 * que le preset porte en base.
 *
 * C'est ce qui permet de déplacer un en-tête (ou de corriger un numéro) et de
 * voir le résultat sans avoir à enregistrer d'abord. Dans le cas ordinaire les
 * deux sont identiques — `importConfigColonnes` est initialisée depuis le
 * preset — et rien ne change.
 *
 * AUX DEUX REQUÊTES, aperçu ET confirmation, et c'est le point : le fichier
 * doit être relu à l'identique des deux côtés, sinon on importerait autre chose
 * que ce qu'on vient de valider. Même règle que le délimiteur et le séparateur
 * décimal, juste au-dessus.
 *
 * Le serveur n'écrit rien de ce qu'on lui envoie là (cf.
 * import_bancaire.PresetAvecColonnes) : seul « Enregistrer la configuration »
 * touche au preset.
 */
function ajouterColonnesLues(formData) {
  formData.append(
    "colonnes",
    JSON.stringify({
      colonnes: importConfigColonnes.filter((c) => c.index >= 1),
      // Les lignes de tête et de pied que l'écran montre (la détection en propose) : lues avec les
      // colonnes, sans rien enregistrer.
      lignes_entete: lignesEnteteSaisies(),
      lignes_pied: lignesPiedSaisies(),
      // Les mots-clés de sens et d'état dits à l'étape « mots-clés » et pas encore enregistrés : sans eux,
      // le fichier serait relu avec ceux du preset et chaque ligne se mettrait en erreur.
      ...(importVocabulairesEssai || {}),
    })
  );
}

/**
 * `conserver` : relire le MÊME fichier sans repartir de zéro - ce que fait le choix du compte (étape 3),
 * qui vient après les champs et les catégories et ne doit rien défaire de ce qu'elles ont décidé. Les
 * correspondances, les confirmations et les retouches de lignes restent ; seuls les verdicts que le
 * serveur recalcule (doublons, ressemblances de virements) repartent, et aucun tableau ne se rouvre.
 */
async function executerPrevisualisation({ conserver = false } = {}) {
  const formData = new FormData();
  formData.append("fichier", importFichierActuel);
  const compteDefaut = compteIdDefautChoisi();
  if (compteDefaut) formData.append("compte_id_defaut", compteDefaut);
  ajouterReglagesLecture(formData);
  ajouterColonnesLues(formData);
  try {
    importApercu = await apiFetchForm(importUrl("/previsualiser"), formData);
    if (!conserver) {
      Object.keys(importMappingCategories).forEach((k) => delete importMappingCategories[k]);
      Object.keys(importMappingComptes).forEach((k) => delete importMappingComptes[k]);
      Object.keys(importMappingMonnaies).forEach((k) => delete importMappingMonnaies[k]);
      importCategoriesConfirmees.clear();
      corrChoixManuels.clear();
      importLignesSelectionnees.clear();
      Object.keys(importLigneOverrides).forEach((k) => delete importLigneOverrides[k]);
      importLignesSupprimees.clear();
      reinitialiserVirementsImport();
    }
    ligneApercuEnEdition = null;
    // La veille sur les virements repart de zéro : ses verdicts portent sur les
    // numéros de ligne du fichier PRÉCÉDENT, qui ne désignent plus rien.
    veilleDoublonsSignature = null;
    veilleDoublonsParLigne = {};
    importRessemblancesVues.clear();
    // Doublons pré-sélectionnés, donc IGNORÉS : ils ne bloquent rien et ne
    // comptent pas dans les demandes de correspondance (cf. ligneDoublonIgnoree).
    // Les décocher les importe volontairement.
    importApercu.lignes
      .filter((l) => l.doublon_de != null)
      .forEach((l) => importLignesSelectionnees.add(l.ligne));
    renderApercuFichier();
    renderImportAvertissements();
    renderImportControle();
    renderImportReglagesLecture();
    renderImportMappings();
    // Les choix gardés (`conserver`) se reposent sur les lignes toutes neuves.
    if (conserver) appliquerMappingsLocalement();
    renderImportApercu();
    document.getElementById("import-resultat").style.display = "none";
    majSuggestionDetection();
    if (!conserver) await ouvrirSuiteImport();
  } catch (err) {
    showMessage(err.message, "error");
  }
}

/**
 * Relit le fichier déjà chargé après un changement de configuration : les
 * couleurs, les en-têtes de propriété et les lignes résolues de l'aperçu
 * décrivent sinon une lecture qui n'a plus cours.
 *
 * Les retouches faites à la main sur l'aperçu (lignes modifiées ou supprimées)
 * disparaissent avec l'ancien aperçu : elles portaient sur des lignes lues
 * autrement. On ne le fait donc pas dans le dos de l'utilisateur — mais
 * seulement quand il y a réellement quelque chose à perdre.
 */
async function relireFichierImport() {
  const retouches =
    Object.keys(importLigneOverrides).length + importLignesSupprimees.size;
  if (
    retouches > 0 &&
    !confirm(
      `La façon de lire le fichier a changé : l'aperçu va être recalculé, ce qui abandonnera tes ${retouches} retouche(s) de lignes. Continuer ?`
    )
  ) {
    return;
  }
  await executerPrevisualisation();
  // L'aperçu vient d'être calculé avec la configuration du moment : il n'y a
  // plus d'écart entre ce que le tableau montre et ce que l'app a lu.
  importApercuAReloire = false;
  majBoutonRelireApercu();
}

// Libellés et couleurs des propriétés importables, pour la visualisation du
// fichier brut. Les clés correspondent à PROPRIETES_IMPORT_VALIDES côté
// serveur ; les libellés sont ceux des deux menus de configuration.
// Les libellés sont traduits ici : la table les garde en français, comme les
// deux menus de configuration dont elle les reprend.
const APERCU_PROPRIETES = Object.fromEntries(
  [...PROPRIETES_IMPORT, ...PROPRIETES_IMPORT_AVANCEES].map(([cle, libelle]) => [
    cle,
    t(libelle),
  ])
);

function classeColonneApercu(propriete) {
  return `col-${propriete}`;
}

/**
 * LA PROPRIÉTÉ LUE DANS CHAQUE COLONNE, prise sur la configuration VIVANTE et
 * non sur celle qu'avait le serveur au dernier aperçu.
 *
 * C'est ce qui permet de déplacer un en-tête et de voir aussitôt les couleurs
 * suivre, sans relire le fichier : le tableau montre alors ce que l'app LIRA,
 * pendant que les lignes résolues plus bas montrent encore ce qu'elle A LU. Le
 * bouton de relecture est là pour refermer cet écart quand la réorganisation
 * est finie.
 */
function proprietesParColonneVivantes() {
  const carte = {};
  importConfigColonnes.forEach((c) => {
    if (c.index >= 1) carte[String(c.index)] = c.propriete;
  });
  return carte;
}

/**
 * Échange les deux colonnes désignées par leurs NUMÉROS.
 *
 * « Échange » et non « déplace » : si les deux portent une propriété, elles
 * troquent leurs numéros ; si l'une est ignorée, l'autre vient s'y poser et
 * laisse sa place vide. Dans les deux cas, aucune propriété n'est perdue et
 * aucun numéro ne se retrouve lu deux fois — ce qu'un simple déplacement aurait
 * fait dès qu'on vise une colonne déjà lue.
 */
function echangerColonnesImport(depuis, vers) {
  if (depuis === vers) return false;
  const a = importConfigColonnes.find((c) => c.index === depuis);
  const b = importConfigColonnes.find((c) => c.index === vers);
  if (!a && !b) return false;
  if (a) a.index = vers;
  if (b) b.index = depuis;
  return true;
}

// Les en-têtes ont été réorganisés depuis la dernière lecture du fichier : le
// tableau montre la configuration du moment, les lignes résolues plus bas
// montrent encore l'ancienne. Le bouton de relecture le signale tant que c'est
// vrai.
let importApercuAReloire = false;

function renderApercuFichier() {
  const bloc = document.getElementById("import-apercu-fichier-bloc");
  const apercu = importApercu && importApercu.apercu_fichier;
  if (!apercu || apercu.lignes.length === 0) {
    bloc.style.display = "none";
    return;
  }
  bloc.style.display = "";

  const largeurFichier = apercu.lignes.reduce((max, l) => Math.max(max, l.length), 0);
  const proprietes = proprietesParColonneVivantes();
  // AU-DELÀ DE LA LARGEUR DU FICHIER, autant de colonnes VIDES qu'il en faut
  // pour que chaque propriété configurée ait son en-tête.
  //
  // Sans elles, une propriété dont le numéro dépasse les colonnes du fichier
  // — le cas d'un preset neuf, dont « Montant » est en colonne 7 devant un
  // relevé qui n'en a que quatre — n'apparaissait nulle part dans le tableau :
  // impossible de l'attraper pour la déplacer, alors que c'est justement celle
  // qu'on cherche à remettre en face. Elles ne contiennent rien, ne se
  // colorent pas, et disparaissent d'elles-mêmes dès que la propriété
  // redescend dans le fichier.
  const largeurConfiguree = [...importConfigColonnes, ...importConfigColonnesDummy].reduce(
    (max, c) => Math.max(max, c.index || 0),
    0
  );
  const largeur = Math.max(largeurFichier, largeurConfiguree);
  // LES COLONNES DUMMY ont leur carte comme les propriétés, HACHURÉE : l'import n'en fait rien,
  // seules les règles les lisent. Une colonne peut en porter plusieurs, et une propriété en plus.
  const dummiesParColonne = {};
  importConfigColonnesDummy
    .filter((c) => c.index >= 1)
    .forEach((c) => (dummiesParColonne[c.index] = [...(dummiesParColonne[c.index] || []), c]));

  const classeColonne = (i) => {
    const propriete = proprietes[String(i)];
    if (propriete) return classeColonneApercu(propriete);
    return dummiesParColonne[i] ? "col-dummy" : "col-ignoree";
  };

  // DEUX RANGÉES D'EN-TÊTE, ET ELLES NE DISENT PAS LA MÊME CHOSE. En haut, les
  // EMPLACEMENTS de l'application : une carte par propriété lue, posée
  // au-dessus de la colonne où on la lit, et un emplacement vide ailleurs. En
  // dessous, le numéro de colonne DU FICHIER. Le nom de la propriété écrit dans
  // l'en-tête même se lisait comme un intitulé du relevé ; séparés, on voit
  // d'un coup d'œil ce qui vient de la banque et ce que l'app en fait.
  const emplacements = [];
  const numeros = [];
  for (let i = 1; i <= largeur; i++) {
    const propriete = proprietes[String(i)];
    // Une colonne HORS FICHIER porte une classe de plus : elle est bien là pour
    // qu'on puisse attraper sa propriété, mais elle ne décrit aucune donnée et
    // ne doit pas se lire comme une colonne qu'on aurait oublié de mapper.
    const horsFichier = i > largeurFichier ? " apercu-col-hors-fichier" : "";
    // DÉPLAÇABLE, la carte et elle seule : les cellules ne bougent pas — ce
    // qu'on réorganise est la façon de LIRE le fichier, pas le fichier.
    const titre = horsFichier
      ? t("Cette colonne n'existe pas dans le fichier : déplace son en-tête sur une colonne réelle.")
      : t("Glisse cet en-tête sur un autre pour échanger les deux colonnes");
    const carte = propriete
      ? `<span class="apercu-carte ${classeColonneApercu(propriete)} apercu-entete-deplacable"
               draggable="true" data-colonne="${i}" title="${titre}"
          >${escapeHtml(APERCU_PROPRIETES[propriete] || propriete)}</span>`
      : "";
    // Pas déplaçables : leur numéro se règle dans « Colonnes secondaires ».
    const cartesDummy = (dummiesParColonne[i] || [])
      .map(
        (c) => `<span class="apercu-carte apercu-carte-dummy"
                      title="${escapeHtml(t("Colonne dummy : lue par les règles, ignorée par l'import"))}"
                 >${escapeHtml(c.nom || t("Nouvelle colonne"))}</span>`
      )
      .join("");
    emplacements.push(
      `<th class="apercu-emplacement${horsFichier}" data-colonne="${i}">${carte}${cartesDummy}</th>`
    );
    numeros.push(`<th class="apercu-col-num${horsFichier}">n°${i}</th>`);
  }

  const corps = apercu.lignes
    .map((ligne, index) => {
      // Les lignes de tête ignorées sont montrées mais barrées : voir qu'elles
      // sont bien exclues vaut mieux que de les faire disparaître
      // silencieusement.
      // Les lignes de pied (total, solde final) de même, au bas du fichier.
      const estEnteteIgnoree =
        index < (apercu.lignes_entete || 0) ||
        index >= apercu.lignes.length - (apercu.lignes_pied || 0);
      // Le numéro de ligne DU FICHIER, celui qu'Excel affiche : c'est lui que
      // citent les erreurs de l'aperçu (« ligne 15 »).
      const cellules = [`<td class="apercu-num-ligne">${index + 1}</td>`];
      for (let i = 1; i <= largeur; i++) {
        // Une colonne hors fichier n'a rien à montrer : cellule vide, et grise
        // quelle que soit la propriété qui la vise — il n'y a rien à lire là.
        const horsFichier = i > largeurFichier ? " apercu-col-hors-fichier" : "";
        cellules.push(
          `<td class="${classeColonne(i)}${horsFichier}">${escapeHtml(ligne[i - 1] || "")}</td>`
        );
      }
      return `<tr class="${estEnteteIgnoree ? "apercu-ligne-ignoree" : ""}">${cellules.join("")}</tr>`;
    })
    .join("");

  const table = document.getElementById("import-apercu-fichier-table");
  table.innerHTML =
    `<thead><tr class="apercu-rangee-cartes"><th class="apercu-num-ligne"></th>${emplacements.join("")}</tr>` +
    `<tr class="apercu-rangee-numeros"><th class="apercu-num-ligne"></th>${numeros.join("")}</tr></thead><tbody>${corps}</tbody>`;
  cablerDeplacementEntetesApercu(table);
  majBoutonRelireApercu();

  // Le fichier entier est là : le tableau se borne en hauteur (cf.
  // .apercu-fichier-defilement) et se parcourt en défilant, dans les deux sens.
  document.getElementById("import-apercu-fichier-info").textContent =
    `${apercu.total_lignes} ligne(s) au total — fais défiler le tableau pour les voir toutes.`;
}

/**
 * Glisser un en-tête sur un autre échange les deux colonnes.
 *
 * POURQUOI CE GESTE EN PLUS DES NUMÉROS. Les numéros de « Configuration du
 * fichier » disent où lire chaque propriété, et restent la façon exacte de le
 * dire ; mais corriger un relevé dont trois colonnes sont décalées demandait
 * d'aller chercher trois champs dans un panneau replié, en tenant de tête les
 * numéros à ne pas dupliquer. Ici on attrape « Date » et on le pose sur la
 * colonne où les dates se trouvent. Les deux chemins écrivent la même chose,
 * `importConfigColonnes`.
 *
 * RIEN N'EST RELU AUTOMATIQUEMENT. Réorganiser trois colonnes, c'est passer par
 * deux états intermédiaires que le fichier ne sait pas lire : relire à chaque
 * dépôt aurait rempli l'écran d'erreurs qu'on s'apprête à corriger. La
 * relecture est donc un geste à part, le bouton juste à côté du titre.
 *
 * HTML5 natif, comme les autres glisser-déposer de l'app (règles, comptes) : la
 * liste est courte, horizontale, et n'a besoin ni de défilement automatique ni
 * de multi-sélection.
 */
function cablerDeplacementEntetesApercu(table) {
  let depuis = null;

  // Ce qu'on attrape : une CARTE. Où on la pose : un EMPLACEMENT, vide ou non —
  // vide, la carte s'y installe ; occupé, les deux cartes s'échangent.
  table.querySelectorAll(".apercu-carte[data-colonne]").forEach((carte) => {
    carte.addEventListener("dragstart", (e) => {
      depuis = Number(carte.dataset.colonne);
      carte.classList.add("apercu-entete-glissee");
      e.dataTransfer.effectAllowed = "move";
      // Firefox n'amorce pas le glisser sans données attachées.
      e.dataTransfer.setData("text/plain", String(depuis));
    });

    carte.addEventListener("dragend", () => {
      depuis = null;
      table
        .querySelectorAll(".apercu-entete-glissee, .apercu-entete-cible")
        .forEach((el) => el.classList.remove("apercu-entete-glissee", "apercu-entete-cible"));
    });
  });

  table.querySelectorAll("th.apercu-emplacement[data-colonne]").forEach((entete) => {
    entete.addEventListener("dragover", (e) => {
      if (depuis === null || Number(entete.dataset.colonne) === depuis) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "move";
      entete.classList.add("apercu-entete-cible");
    });

    entete.addEventListener("dragleave", () => {
      entete.classList.remove("apercu-entete-cible");
    });

    entete.addEventListener("drop", (e) => {
      e.preventDefault();
      const source = depuis !== null ? depuis : Number(e.dataTransfer.getData("text/plain"));
      const cible = Number(entete.dataset.colonne);
      if (!echangerColonnesImport(source, cible)) return;
      importApercuAReloire = true;
      // Les deux endroits que l'échange concerne : les numéros du panneau de
      // configuration, et le tableau lui-même (couleurs et en-têtes).
      renderImportConfig();
      renderApercuFichier();
    });
  });
}

/** Le bouton de relecture dit s'il y a quelque chose à relire. */
function majBoutonRelireApercu() {
  const bouton = document.getElementById("btn-import-apercu-relire");
  if (!bouton) return;
  bouton.classList.toggle("a-relire", importApercuAReloire);
  bouton.title = importApercuAReloire
    ? t("Les colonnes ont changé : relire le fichier pour voir ce que l'import donnera.")
    : t("Relire le fichier avec la configuration actuelle");
  bouton.setAttribute("aria-label", bouton.title);
  // L'alerte parle de ce qui n'est pas ENREGISTRÉ : déplacer une colonne puis la
  // remettre à sa place la fait disparaître, même si le fichier n'a pas été relu.
  const colonnesNonEnregistrees =
    importSignatureColonnesEnregistrees !== null &&
    signatureColonnesImport(importConfigColonnes) !== importSignatureColonnesEnregistrees;
  document.getElementById("import-apercu-fichier-alerte").style.display =
    colonnesNonEnregistrees ? "" : "none";
}

/* ---------- DEVINER LES COLONNES (le même tableau que les correspondances) ----------
 *
 * L'application lit le fichier et propose, colonne par colonne, ce qu'elle croit y voir (cf.
 * services/detection_colonnes). C'est LE MÊME TABLEAU que celui des catégories de la banque : une
 * colonne par colonne du fichier, une molette de propriétés, les mêmes pastilles (« Proposition
 * forte » en bleu quand les indices convergent, « Suggestion » en jaune, « Ton choix » sinon), les
 * mêmes touches (monter, descendre, confirmer : cf. TOUCHES_IMPORT) et la même règle - on commence
 * par la meilleure proposition, en haut de la molette, et rien n'est appliqué sans accord.
 *
 * ELLE PASSE AVANT LES CORRESPONDANCES : tant que les colonnes sont mal lues, les catégories, les
 * comptes et les devises qu'on demanderait de classer sont ceux d'une lecture fausse. Quand le
 * fichier est mal lu (plus de la moitié des lignes en erreur, aucun preset qui le lise, export d'une
 * banque connue), le tableau s'ouvre donc de lui-même, juste après la première lecture ; une fois
 * appliqué, le fichier est relu et c'est le tableau des correspondances qui prend le relais.
 *
 * APPLIQUER NE TOUCHE PAS AU PRESET : les colonnes (et les lignes de tête et de pied) deviennent
 * celles de l'écran, et le fichier est relu avec elles. « Enregistrer la configuration » les garde -
 * en REMPLAÇANT les colonnes enregistrées à la main, ce que le tableau dit avant qu'on applique.
 */
let importDetection = null;
// Une fois par fichier : appliquer, relire puis retomber sur le même constat ne doit pas rouvrir le
// tableau en boucle. Remis à faux à chaque nouveau fichier (cf. reinitialiserImport).
let importDetectionProposee = false;

/** Un tutoriel est en cours : c'est lui qui décide quand montrer les tableaux (cf. tutoriel.js). */
function tutorielEnCours() {
  return typeof tutorielActif !== "undefined" && tutorielActif;
}

function libelleProprieteImport(propriete) {
  if (!propriete) return t("Ne pas importer");
  const trouve = [...PROPRIETES_IMPORT, ...PROPRIETES_IMPORT_AVANCEES].find(
    ([cle]) => cle === propriete
  );
  return t(trouve ? trouve[1] : propriete);
}

// L'identifiant de l'option « Ne pas importer » : une propriété n'a jamais ce nom.
const DET_AUCUNE = "aucune";
// Pour chaque colonne affichée : {colonne, choix (id d'option)}. Les colonnes entièrement vides,
// sans intitulé, ne sont pas montrées (rien à y lire).
let detColonnes = [];
let detCourante = -1;
// Ouvert de lui-même avant les correspondances (vrai), ou à la demande (faux).
let detSuite = false;
const detConfirmees = new Set(); // index des colonnes confirmées
const detChoixManuels = new Set();

function detOuvert() {
  return document.getElementById("modale-detection").style.display !== "none";
}

function detIdPropriete(propriete) {
  return propriete || DET_AUCUNE;
}

function detProprieteDe(id) {
  return id === DET_AUCUNE ? null : id;
}

/** Les options de la molette : la proposition sûre ou les meilleures lectures d'abord (dans l'ordre
 *  du serveur), puis « Ne pas importer » et le reste des propriétés. */
function detOptions(entree) {
  const { colonne } = entree;
  const proposees = colonne.propositions.map((p, rang) => ({
    id: detIdPropriete(p.propriete),
    niveau: rang === 0 && detEstForte(colonne) ? "forte" : "suggestion",
  }));
  // UN CHAMP DÉJÀ PROPOSÉ FORTEMENT AILLEURS PASSE APRÈS « NE PAS IMPORTER » : dans cette colonne, il est
  // plus probable que la colonne soit ignorée que qu'elle lise un champ qu'une autre colonne porte déjà.
  // Seules les propositions d'après la première bougent, et seulement si « Ne pas importer » les suit.
  const ailleursFort = (id) =>
    id !== DET_AUCUNE &&
    detColonnes.some(
      (e) =>
        e.colonne !== colonne &&
        detEstForte(e.colonne) &&
        e.colonne.propositions[0] &&
        detIdPropriete(e.colonne.propositions[0].propriete) === id
    );
  const rangAucune = proposees.findIndex((o) => o.id === DET_AUCUNE);
  if (rangAucune > 1) {
    const reculent = proposees.filter((o, rang) => rang > 0 && rang < rangAucune && ailleursFort(o.id));
    if (reculent.length) {
      const reste = proposees.filter((o) => !reculent.includes(o));
      const apres = reste.findIndex((o) => o.id === DET_AUCUNE) + 1;
      proposees.splice(0, proposees.length, ...reste.slice(0, apres), ...reculent, ...reste.slice(apres));
    }
  }
  const ids = new Set(proposees.map((o) => o.id));
  const toutes = [
    DET_AUCUNE,
    ...[...PROPRIETES_IMPORT, ...proprietesAvanceesDetection()].map(([cle]) => cle),
  ];
  const autres = toutes.filter((id) => !ids.has(id)).map((id) => ({ id, niveau: "choix" }));
  return [...proposees, ...autres];
}

/** La première proposition est-elle forte ? C'est le serveur qui le dit (`forte` : indices qui
 *  convergent, champ remonté par le raffinage global, paire avec « ne pas importer »). */
function detEstForte(colonne) {
  return colonne.forte !== undefined ? colonne.forte : colonne.certaine;
}

/** Le n° de la colonne qui a CONFIRMÉ ce champ, ou null quand il est libre pour la colonne `i`.
 *  Un champ ne se lit que dans une colonne : confirmé ailleurs, il est barré ici. « Ne pas importer »
 *  n'est jamais pris. */
function detPrisPar(i, id) {
  if (id === DET_AUCUNE) return null;
  const autre = detColonnes.find(
    (e, k) => k !== i && detConfirmees.has(e.colonne.index) && e.choix === id
  );
  return autre ? autre.colonne.index : null;
}

/** Ce que l'app pense de la lecture choisie pour cette colonne. */
function detStatut(entree) {
  const { colonne, choix } = entree;
  const premiere = colonne.propositions[0] && detIdPropriete(colonne.propositions[0].propriete);
  if (detEstForte(colonne) && choix === premiere) return { cle: "forte", texte: t("Proposition forte") };
  if (colonne.propositions.some((p) => detIdPropriete(p.propriete) === choix)) {
    return { cle: "suggestions", texte: t("Suggestion") };
  }
  return { cle: "choix", texte: t("Ton choix") };
}

/** Le « i » d'un champ de la molette : ce que le champ sert à lire, en quelques mots (clé
 *  `noyau.detection-champ-<propriété>`). Sans texte, rien n'est dessiné plutôt qu'une pastille vide.
 *  Sans `tabindex` : la molette se parcourt aux flèches, et un « i » focalisable y ferait un arrêt
 *  de plus par ligne. */
function infoChampDetectionHtml(id) {
  const texte = TEXTES[`noyau.detection-champ-${id}`];
  if (!texte) return "";
  return `<i class="info-bulle corr-roue-info" aria-hidden="true" data-info="${escapeHtml(t(texte))}">i</i>`;
}

/** Le nom d'un champ sur la molette. « Montant » s'appelle « Montant reçu » dès qu'une colonne est lue comme
 *  « Montant envoyé » : les deux vont par paire (ce qui part, ce qui arrive), et le même mot ne doit pas
 *  désigner l'un à côté de l'autre. */
function detLibelleOption(id) {
  if (id === "montant" && detColonnes.some((e) => e.choix === "montant_initial")) {
    return t("Montant reçu");
  }
  return libelleProprieteImport(detProprieteDe(id));
}

function detMajLibellesMontant() {
  document.querySelectorAll('#detection-board .corr-roue-option[data-id="montant"]').forEach((o) => {
    if (o.firstChild && o.firstChild.nodeType === 3) o.firstChild.nodeValue = detLibelleOption("montant");
  });
}

function detColonneDom(i) {
  return document.querySelector(`#detection-board [data-corr-i="${i}"]`);
}

function detColonneHtml(entree, i) {
  const { colonne, choix } = entree;
  const statut = detStatut(entree);
  const confirmee = detConfirmees.has(colonne.index);
  const exemples = colonne.exemples
    .map(
      (e) => `<div class="corr-operation"><div class="corr-operation-nature" title="${escapeHtml(e)}">${escapeHtml(
        e
      )}</div></div>`
    )
    .join("");
  return `
    <section class="corr-colonne ${confirmee ? "corr-confirmee" : ""}" data-corr-i="${i}" tabindex="-1">
      <div>
        <div class="corr-banque">${escapeHtml(t("Colonne n°"))} ${colonne.index}${
    colonne.entete ? ` · ${escapeHtml(colonne.entete)}` : ""
  }</div>
        <span class="corr-statut corr-statut-${statut.cle}" data-corr-statut>${escapeHtml(statut.texte)}</span>
      </div>
      <div class="corr-roue-cadre">
        <div class="corr-roue" role="listbox" tabindex="0"
             aria-label="${escapeHtml(t("Propriété de la colonne {n}", { n: colonne.index }))}">
          ${detOptions(entree)
            .map((o) => {
              const par = detPrisPar(i, o.id);
              return `<div class="corr-roue-option corr-roue-${o.niveau} ${
                o.id === choix ? "corr-roue-choisie" : ""
              } ${par !== null ? "corr-roue-exclue" : ""}" role="option" data-id="${o.id}" aria-selected="${
                o.id === choix
              }"${
                par !== null
                  ? ` aria-disabled="true" title="${escapeHtml(t("Déjà prise par la colonne {n}", { n: par }))}"`
                  : ""
              }>${escapeHtml(detLibelleOption(o.id))}${infoChampDetectionHtml(
                o.id
              )}</div>`;
            })
            .join("")}
        </div>
      </div>
      <div class="corr-operations">${exemples}</div>
      <div class="corr-actions">
        <button type="button" class="primary corr-confirmer" data-corr-confirmer="${i}"><span data-corr-libelle>${
    confirmee ? escapeHtml(t("Confirmée")) : escapeHtml(t("Confirmer"))
  }</span> <kbd data-corr-touche>(${escapeHtml(libelleCombo(toucheImport("confirmer")))})</kbd></button>
        <button type="button" class="corr-annuler" data-corr-annuler="${i}" ${
    confirmee ? "" : "disabled"
  } title="${escapeHtml(t("Annuler la confirmation"))}" aria-label="${escapeHtml(
    t("Annuler la confirmation")
  )}">&times;</button>
      </div>
    </section>`;
}

function detMajCompteur() {
  const restantes = detColonnes.filter((e) => !detConfirmees.has(e.colonne.index)).length;
  document.getElementById("detection-compteur").textContent = restantes
    ? t("{n} colonne(s) à confirmer", { n: restantes })
    : t("Tout est confirmé.");
  document.getElementById("btn-detection-fortes").disabled = !detColonnes.some(
    (e) => detFortePrete(e)
  );
  detMajEtapes();
  detMajLibellesMontant();
}

/** Le graphe des étapes du tableau des colonnes : l'étape « mots-clés » y est « à venir » dès qu'une colonne
 *  est lue comme un sens ou un état, « sautée » sinon (cf. `etapeSauteeDAvance`). */
function detMajEtapes() {
  majEtapesImport("modale-detection", "champs");
}

function detFortePrete(entree) {
  return detStatut(entree).cle === "forte" && !detConfirmees.has(entree.colonne.index);
}

function detMajBouton(i) {
  const colonne = detColonneDom(i);
  if (!colonne) return;
  const confirmee = detConfirmees.has(detColonnes[i].colonne.index);
  colonne.classList.toggle("corr-confirmee", confirmee);
  colonne.querySelector("[data-corr-libelle]").textContent = confirmee ? t("Confirmée") : t("Confirmer");
  colonne.querySelector("[data-corr-annuler]").disabled = !confirmee;
}

/** Remet l'écran d'une colonne d'accord avec son état : ligne choisie, lignes barrées (champs pris
 *  par une autre colonne), pastille et boutons. */
function detMajColonne(i, { defiler = false, doux = false } = {}) {
  const entree = detColonnes[i];
  const colonne = detColonneDom(i);
  if (!colonne) return;
  colonne.querySelectorAll(".corr-roue-option").forEach((o) => {
    const choisie = o.dataset.id === entree.choix;
    const par = detPrisPar(i, o.dataset.id);
    o.classList.toggle("corr-roue-choisie", choisie);
    o.classList.toggle("corr-roue-exclue", par !== null);
    o.setAttribute("aria-selected", String(choisie));
    if (par !== null) {
      o.setAttribute("aria-disabled", "true");
      o.title = t("Déjà prise par la colonne {n}", { n: par });
    } else {
      o.removeAttribute("aria-disabled");
      o.removeAttribute("title");
    }
  });
  const statut = detStatut(entree);
  const pastille = colonne.querySelector("[data-corr-statut]");
  pastille.className = `corr-statut corr-statut-${statut.cle}`;
  pastille.textContent = statut.texte;
  detMajBouton(i);
  if (defiler) detCentrerRoue(i, doux);
}

/** Les champs confirmés changent ce que les AUTRES colonnes peuvent lire. Une colonne non confirmée
 *  qui lisait un champ désormais pris descend à la lecture permise la plus proche (puis remonte si
 *  besoin) et se souvient d'où elle vient ; quand le champ se libère (confirmation annulée), elle y
 *  revient. */
function detMajExclusions() {
  detEffacerConflit();
  detColonnes.forEach((entree, i) => {
    if (detConfirmees.has(entree.colonne.index)) return;
    const ids = detOptions(entree).map((o) => o.id);
    const libre = (id) => detPrisPar(i, id) === null;
    let deplace = false;
    if (entree.deplaceDepuis && libre(entree.deplaceDepuis)) {
      entree.choix = entree.deplaceDepuis;
      entree.deplaceDepuis = null;
      deplace = true;
    } else if (!libre(entree.choix)) {
      const rang = rangSelectionnable(ids, ids.indexOf(entree.choix), 1, (id) => !libre(id));
      if (!entree.deplaceDepuis) entree.deplaceDepuis = entree.choix;
      entree.choix = rang === -1 ? DET_AUCUNE : ids[rang];
      deplace = true;
    }
    detMajColonne(i, { defiler: deplace, doux: true });
  });
}

function detEffacerConflit() {
  const message = document.getElementById("detection-conflit");
  if (message) message.style.display = "none";
  document
    .querySelectorAll("#detection-board .corr-conflit")
    .forEach((c) => c.classList.remove("corr-conflit"));
}

/** Deux colonnes lisent le même champ sans l'avoir confirmé : le dire DANS le tableau (un message
 *  en bas de page passe derrière), et désigner les colonnes. */
function detSignalerConflit(propriete, indexColonnes) {
  const message = document.getElementById("detection-conflit");
  message.textContent = t("« {propriete} » est choisie pour deux colonnes : garde-la sur une seule.", {
    propriete: libelleProprieteImport(propriete),
  });
  message.style.display = "";
  let premiere = -1;
  detColonnes.forEach((entree, i) => {
    if (!indexColonnes.includes(entree.colonne.index)) return;
    detColonneDom(i).classList.add("corr-conflit");
    if (premiere === -1) premiere = i;
  });
  if (premiere !== -1) detDefinirCourante(premiere);
}

function detCentrerRoue(i, doux) {
  const colonne = detColonneDom(i);
  if (!colonne) return;
  const roue = colonne.querySelector(".corr-roue");
  const rang = Math.max(
    0,
    [...roue.children].findIndex((o) => o.classList.contains("corr-roue-choisie"))
  );
  if (doux) {
    // UN DÉFILEMENT QUE L'APP PROVOQUE N'EST PAS UN CHOIX : en route, la molette passe devant des
    // lignes (barrées, parfois) et, sur une machine lente, s'y arrête assez longtemps pour que
    // « la ligne centrée est le choix » (cf. brancherMolettes) la retienne.
    roue._corrAuto = true;
    clearTimeout(roue._corrAutoFin);
    const fin = () => {
      roue._corrAuto = false;
      clearTimeout(roue._corrAutoFin);
    };
    roue.addEventListener("scrollend", fin, { once: true });
    roue._corrAutoFin = setTimeout(fin, 1500);
  }
  roue.scrollTo({ top: rang * CORR_HAUTEUR_OPTION, behavior: doux ? "smooth" : "auto" });
}

function detDefinirCourante(i, { focus = false } = {}) {
  detCourante = i;
  document
    .querySelectorAll("#detection-board .corr-colonne")
    .forEach((c) => c.classList.toggle("corr-courante", Number(c.dataset.corrI) === i));
  const colonne = detColonneDom(i);
  if (!colonne) return;
  colonne.scrollIntoView({ inline: "center", block: "nearest", behavior: "smooth" });
  if (focus) colonne.querySelector(".corr-roue").focus({ preventScroll: true });
}

/** Choisit une propriété pour la colonne `i` : redemande une confirmation. */
function detChoisir(i, id, { defiler = true } = {}) {
  const entree = detColonnes[i];
  const ids = detOptions(entree).map((o) => o.id);
  const exclue = (x) => detPrisPar(i, x) !== null;
  // UN CHAMP PRIS AILLEURS NE SE CHOISIT PAS : le clic (ou la molette) est renvoyé vers la lecture
  // permise la plus proche, au-dessus ou en dessous selon le côté d'où l'on vient.
  if (exclue(id)) {
    const sens = Math.sign(ids.indexOf(id) - ids.indexOf(entree.choix)) || 1;
    const rang = rangSelectionnable(ids, ids.indexOf(id), sens, exclue);
    id = rang === -1 ? entree.choix : ids[rang];
    defiler = true;
  }
  if (id !== entree.choix) {
    entree.choix = id;
    detChoixManuels.add(entree.colonne.index);
    detConfirmees.delete(entree.colonne.index);
  }
  entree.deplaceDepuis = null;
  // Défaire une confirmation libère son champ pour les autres colonnes.
  detMajExclusions();
  detMajColonne(i, { defiler, doux: true });
  detMajCompteur();
}

function detProchaineNonConfirmee(apres) {
  const non = (e) => !detConfirmees.has(e.colonne.index);
  const suivante = detColonnes.findIndex((e, k) => k > apres && non(e));
  return suivante !== -1 ? suivante : detColonnes.findIndex(non);
}

/** Confirme la colonne `i` : son champ devient indisponible pour les autres colonnes. Rend faux si
 *  ce champ vient d'être pris ailleurs. */
function detMarquerConfirmee(i) {
  const entree = detColonnes[i];
  if (detPrisPar(i, entree.choix) !== null) return false;
  entree.deplaceDepuis = null;
  detConfirmees.add(entree.colonne.index);
  detMajExclusions();
  detMajColonne(i);
  return true;
}

/** La croix rouge : défait la confirmation. Le champ redevient disponible partout, et les colonnes
 *  qu'il avait fait descendre y reviennent. */
function detAnnuler(i) {
  if (i < 0 || i >= detColonnes.length) return;
  if (!detConfirmees.delete(detColonnes[i].colonne.index)) return;
  detMajExclusions();
  detMajColonne(i);
  detMajCompteur();
  detDefinirCourante(i, { focus: true });
}

function detConfirmer(i) {
  if (i < 0 || i >= detColonnes.length) return;
  if (!detMarquerConfirmee(i)) return;
  detMajCompteur();
  const cible = detProchaineNonConfirmee(i);
  if (cible === -1) {
    detDefinirCourante(i);
    document.getElementById("btn-detection-appliquer").focus();
    return;
  }
  detDefinirCourante(cible, { focus: true });
}

function detConfirmerFortes() {
  detColonnes.forEach((entree, i) => {
    if (detFortePrete(entree)) detMarquerConfirmee(i);
  });
  detMajCompteur();
  const premiere = detProchaineNonConfirmee(-1);
  if (premiere !== -1) detDefinirCourante(premiere, { focus: true });
}

/** Les constats de lecture du fichier (format, lignes de tête et de pied, solde, dates) : ce que la
 *  détection a appris EN PLUS des colonnes, et que le tableau montre au-dessus d'elles. */
function detInfosHtml(detection) {
  const lignes = [];
  // LE FORMAT D'UNE BANQUE CONNUE (cf. services/formats_bancaires) : dit d'où viennent les colonnes
  // « sûres », pour qu'on vérifie l'aperçu plutôt que de croire.
  if (detection.format_reconnu) {
    lignes.push(
      `<p class="import-detection-format"><strong>${escapeHtml(
        t("Format reconnu : {banque}", { banque: detection.format_reconnu.banque })
      )}</strong> <span class="hint">${escapeHtml(
        t("d'après les intitulés des colonnes — vérifie l'aperçu avant d'importer.")
      )}</span></p>`
    );
  }
  lignes.push(`<p class="hint">${escapeHtml(t("Lignes de tête : {n}", { n: detection.lignes_entete }))}</p>`);
  if (detection.lignes_pied) {
    lignes.push(
      `<p class="hint">${escapeHtml(
        t(texteAide("noyau.detection-lignes-pied"), { n: detection.lignes_pied })
      )}</p>`
    );
  }
  if (detection.solde) {
    lignes.push(
      `<p class="hint">${escapeHtml(
        t(texteAide("noyau.detection-solde"), {
          colonne: detection.solde.colonne,
          taux: Math.round(detection.solde.taux * 100),
          intervalles: detection.solde.intervalles,
        })
      )}</p>`
    );
  }
  if (detection.format_date === "mja") {
    lignes.push(
      `<p class="import-avertissement">${escapeHtml(t(texteAide("noyau.detection-dates-mois-devant")))}</p>`
    );
  }
  return lignes.join("");
}

/** `choixInitiaux` : les colonnes que lit le preset, quand on revient au tableau sans être passé par lui
 *  (étape 1bis ouverte seule) - chaque molette part alors de ce que le preset lit, et non de la proposition. */
function ouvrirDetection(detection, { suite = false, choixInitiaux = null } = {}) {
  importDetection = detection;
  detSuite = suite;
  detConfirmees.clear();
  detChoixManuels.clear();
  detColonnes = detection.colonnes
    .filter((c) => c.exemples.length || c.entete)
    .map((colonne) => ({
      colonne,
      // On part de la MEILLEURE PROPOSITION (en haut de la molette) ; rien n'est confirmé pour autant.
      choix: choixInitiaux
        ? detIdPropriete((choixInitiaux.find((c) => c.index === colonne.index) || {}).propriete)
        : detIdPropriete(colonne.propositions[0]?.propriete),
    }));
  document.getElementById("detection-infos").innerHTML = detInfosHtml(detection);
  importParcours.vues.add("champs");
  majEtapesImport("modale-detection", "champs");
  detEffacerConflit();
  const board = document.getElementById("detection-board");
  board.innerHTML = detColonnes.map((entree, i) => detColonneHtml(entree, i)).join("");
  detColonnes.forEach((_, i) => detCentrerRoue(i, false));
  detMajCompteur();
  majAideFleches();
  document.getElementById("modale-detection").style.display = "";
  document.body.classList.add("modale-ouverte");
  detDefinirCourante(Math.max(0, detProchaineNonConfirmee(-1)), { focus: true });
}

/** Ferme le tableau sans rien appliquer. Ouvert avant les correspondances, il les rouvre derrière. */
function fermerDetection() {
  document.getElementById("modale-detection").style.display = "none";
  document.body.classList.remove("modale-ouverte");
  detCourante = -1;
  importDetection = null;
  majSuggestionDetection();
  // Ouvert avant les autres étapes, il leur rend la main : les catégories, puis le compte.
  if (detSuite) ouvrirSuiteImport();
}

async function appliquerDetectionImport() {
  const colonnes = detColonnes
    .filter((e) => e.choix !== DET_AUCUNE)
    .map((e) => ({ index: e.colonne.index, propriete: e.choix }));
  // UNE PROPRIÉTÉ, UNE COLONNE : le serveur refuserait la lecture, autant le dire ici avec le nom
  // de la propriété. Les champs CONFIRMÉS sont déjà barrés ailleurs ; restent deux colonnes qui
  // lisent le même champ sans l'avoir confirmé.
  const parPropriete = new Map();
  for (const c of colonnes) {
    parPropriete.set(c.propriete, [...(parPropriete.get(c.propriete) || []), c.index]);
  }
  const doublon = [...parPropriete].find(([, index]) => index.length > 1);
  if (doublon) {
    detSignalerConflit(doublon[0], doublon[1]);
    return;
  }
  const detection = importDetection;
  // L'ÉTAPE 1bis : une colonne lue comme « Sens » ou « État » dit des mots que l'application ne connaît pas
  // d'avance (IN / OUT, COMPLETED / CANCELLED) ; on demande à quoi ils correspondent AVANT de relire le
  // fichier, sans quoi chaque ligne se mettrait en erreur. Seuls les champs choisis sont demandés.
  importParcours.proposees.add("mots-cles");
  const aMapper = motsClesAMapper(detection, colonnes);
  if (aMapper.length) {
    ouvrirMotsCles(detection, colonnes, aMapper);
    return;
  }
  await finaliserDetectionImport(detection, colonnes);
}

/** La fin de l'étape 1 (ou de la 1bis) : les colonnes deviennent celles de l'écran et le fichier est relu avec
 *  elles. `lignes` : les lignes de tête et de pied à garder - celles du preset quand l'étape 1 a été sautée,
 *  sinon celles que la détection propose. */
async function finaliserDetectionImport(detection, colonnes, lignes = null) {
  importConfigColonnes = colonnes;
  // Les colonnes lues ont changé : « Compte pour ce fichier » apparaît (ou disparaît) avec elles.
  toggleImportCompteDefautBloc();
  document.getElementById("import-lignes-entete").value = lignes ? lignes.entete : detection.lignes_entete;
  document.getElementById("import-lignes-pied").value = lignes ? lignes.pied : detection.lignes_pied || 0;
  updateResumeLignesEntete();
  // UNE NOUVELLE LECTURE COMMENCE : les catégories, le compte et le contrôle se redemandent sur elle.
  ["categories", "compte", "virements", "controle"].forEach((id) => importParcours.proposees.delete(id));
  importCompteDemande = false;
  // Plus de tableau de détection à rouvrir derrière : le fichier va être relu avec ces colonnes, et
  // c'est le tableau des correspondances qui s'ouvrira à la fin de la relecture.
  importDetectionProposee = true;
  importDetection = null;
  renderImportConfig();
  // LA FENÊTRE QUE L'UTILISATEUR VIENT DE VALIDER RESTE OUVERTE pendant la relecture du fichier, et ne se
  // ferme qu'une fois la suivante ouverte : se refermer d'abord laissait la page nue entre deux étapes.
  const libere = occuperBoutonImport(
    motsOuvert() ? "btn-mots-cles-continuer" : "btn-detection-appliquer"
  );
  try {
    await executerPrevisualisation();
  } finally {
    libere();
    fermerFenetresChampsImport();
  }
  importApercuAReloire = false;
  majBoutonRelireApercu();
  showMessage(
    premierImportBancaire()
      ? t(texteAide("noyau.import-premier-colonnes"), { preset: (presetActuel() || {}).nom || "" })
      : t("Colonnes appliquées et fichier relu : « Enregistrer la configuration » les garde dans le preset."),
    "success"
  );
}

/** Grise un bouton le temps d'une lecture du fichier ; rend la fonction qui le libère. */
function occuperBoutonImport(idBouton) {
  const bouton = document.getElementById(idBouton);
  const texte = bouton.textContent;
  bouton.disabled = true;
  bouton.textContent = t("Lecture du fichier…");
  return () => {
    bouton.textContent = texte;
    bouton.disabled = false;
    if (idBouton === "btn-mots-cles-continuer") motsMajCompteur();
  };
}

/** Un tableau de l'import est-il ouvert ? (La classe qui fige la page n'est levée qu'à la dernière fermeture.) */
function fenetreImportOuverte() {
  return ["modale-detection", "modale-mots-cles", "modale-correspondances", "modale-compte-import"].some(
    (id) => document.getElementById(id).style.display !== "none"
  );
}

/** Referme les fenêtres de l'étape 1 (champs, mots-clés), une fois l'étape suivante ouverte. */
function fermerFenetresChampsImport() {
  document.getElementById("modale-detection").style.display = "none";
  document.getElementById("modale-mots-cles").style.display = "none";
  detCourante = -1;
  motsCourante = -1;
  if (!fenetreImportOuverte()) {
    // Rien ne s'est ouvert derrière : c'était la dernière fenêtre (le parcours s'est posé sur le contrôle,
    // cf. `finirParcoursImport`).
    document.body.classList.remove("modale-ouverte");
  }
}

/** Lit le fichier ouvert et rend ce que la détection en dit, ou null (erreur déjà montrée). */
async function demanderDetectionImport() {
  const formData = new FormData();
  formData.append("fichier", importFichierActuel);
  if (importReglageDelimiteur) formData.append("delimiteur", importReglageDelimiteur);
  if (importFeuille) formData.append("feuille", importFeuille);
  if (importReglageSeparateurDecimal)
    formData.append("separateur_decimal", importReglageSeparateurDecimal);
  return apiFetchForm(importUrl("/detecter-colonnes"), formData);
}

/** Le bouton « Deviner les colonnes » : le tableau, à la demande. */
async function detecterColonnesImport() {
  if (!importFichierActuel) {
    showMessage(t("Aucun fichier chargé à relire."), "error");
    return;
  }
  try {
    ouvrirDetection(await demanderDetectionImport());
  } catch (err) {
    showMessage(err.message, "error");
  }
}

/**
 * UNE LIGNE MAL LUE : une erreur de LECTURE (date, montant, libellé, mot de sens ou d'état), et non une
 * question restée sans réponse (catégorie, compte, devise à rattacher - les étapes 2 et 3 y répondent).
 * Les motifs sont ceux du serveur (cf. import_bancaire, `_erreur_ligne` et la lecture de la ligne).
 */
const MOTIFS_ERREUR_LECTURE = [
  "date illisible",
  "montant illisible",
  "montant présent au débit et au crédit",
  "nature manquante",
  "sens ",
  "état ",
];

function ligneMalLue(ligne) {
  return (
    !!ligne.erreur &&
    ligne.erreur.split(", ").some((motif) => MOTIFS_ERREUR_LECTURE.some((p) => motif.trim().startsWith(p)))
  );
}

/**
 * L'ÉTAPE 1, LES CHAMPS, après la première lecture d'un fichier. Rend `true` quand elle a ouvert le tableau
 * (c'est lui qui rend la main au parcours, après relecture ou à la fermeture).
 *
 * Elle s'ouvre quand l'application a quelque chose à faire valider sur les colonnes : plus de la moitié des
 * lignes mal lues, le preset sélectionné ne lit pas le fichier (aucun preset ne le lit, ou l'utilisateur a
 * gardé le sien), l'export d'une banque connue que le preset ne lit pas ainsi, un preset créé pour ce fichier,
 * le premier import (le preset livré n'a jamais rien lu : sa lecture est à valider, elle va lui être
 * enregistrée), ou le guide du premier import. Une seule fois par fichier. Un échec ne dit rien.
 */
async function ouvrirEtapeChamps() {
  if (!importFichierActuel || !importApercu || importDetectionProposee) return false;
  // JAMAIS PENDANT UN TUTORIEL : ses fichiers sont lus de travers exprès (étapes 5, 6 et 15), et un
  // tableau qui s'ouvre de lui-même au milieu d'une étape la ferait dérailler.
  if (tutorielEnCours()) return false;
  // UNE SEULE FOIS PAR FICHIER, bon ou mauvais constat : les relectures qui suivent sont des
  // retouches voulues (un délimiteur, des colonnes), pas une première lecture à deviner.
  importDetectionProposee = true;
  const forcer = importParcours.forcerChamps;
  importParcours.forcerChamps = false;
  const lues = lignesLuesParImport();
  const malLu = lues.length > 0 && lues.filter(ligneMalLue).length / lues.length > 0.5;
  const r = importReconnaissance;
  const selection = r && (r.ajustements || []).find((a) => a.preset_id === importPresetId);
  const neLitPas = !!r && (r.decision === "aucun" || (!!selection && !selection.passe));
  try {
    const detection = await demanderDetectionImport();
    importParcours.detection = detection;
    const cle = (colonnes) =>
      JSON.stringify(colonnes.map((c) => [c.index, c.propriete]).sort((a, b) => a[0] - b[0]));
    const autreLecture =
      detection.format_reconnu && cle(detection.configuration) !== cle(importConfigColonnes || []);
    // LE GUIDE DU PREMIER IMPORT montre toujours le tableau : c'est lui qui apprend à dire ce que
    // contient chaque colonne, même quand la lecture par défaut tombe juste (cf. premier-demarrage.js).
    const guide = !!(BudgetApp.guideImport && BudgetApp.guideImport.actif);
    const ouvrir = malLu || neLitPas || autreLecture || forcer || guide || premierImportBancaire();
    if (!ouvrir || !importFichierActuel) return false;
    ouvrirDetection(detection, { suite: true });
    return true;
  } catch (err) {
    return false;
  }
}

(function initDetection() {
  document.getElementById("btn-import-detecter").addEventListener("click", detecterColonnesImport);
  document.getElementById("btn-detection-fermer").addEventListener("click", () => fermerDetection());
  document.getElementById("btn-detection-appliquer").addEventListener("click", appliquerDetectionImport);
  document.getElementById("btn-detection-fortes").addEventListener("click", detConfirmerFortes);
  brancherMolettes(document.getElementById("detection-board"), {
    courante: () => detCourante,
    definirCourante: detDefinirCourante,
    choisir: (i, id, options) => detChoisir(i, id, options),
    valeur: (i) => detColonnes[i].choix,
    nombre: () => detColonnes.length,
    confirmer: detConfirmer,
    annuler: detAnnuler,
    // Les flèches sautent les champs pris par une autre colonne.
    exclue: (i, id) => detPrisPar(i, id) !== null,
  });
  document.addEventListener("keydown", (e) => {
    if (!detOuvert()) return;
    if (comboEvenementImport(e) === toucheImport("confirmer")) {
      e.preventDefault();
      detConfirmer(detCourante);
    } else if (e.key === "Escape") {
      fermerDetection();
    }
  });
})();

/* ---------- LE PARCOURS DE L'IMPORT ----------
 *
 * IL GUIDE TOUS LES IMPORTS, pas seulement le premier ou un fichier mal lu - mais il ne se déclenche que s'il
 * y a quelque chose à faire valider. L'application devine, elle ne choisit pas : dès qu'elle propose un
 * changement, l'utilisateur le valide. Dans cet ordre, chaque étape étant une fenêtre par-dessus la page :
 *
 *   0    le preset         : un AUTRE preset lirait mieux le fichier, ou aucun ne le lit - proposé dans la
 *                            page, avant toute fenêtre (cf. « LA PROPOSITION DE PRESET ») ;
 *   1    les champs        : ce que contient chaque colonne (le tableau des colonnes, `ouvrirEtapeChamps`) ;
 *   1bis les mots-clés     : à quoi correspond chaque mot d'une colonne « Sens » ou « État » - après l'étape 1,
 *                            ou seule quand le fichier écrit un mot que le preset ne connaît pas ;
 *   2    les catégories    : les catégories de la banque que l'app ne connaît pas encore ;
 *   3    les comptes       : où va le relevé, les comptes qu'il nomme, ses devises (« Comptes & Monnaies ») ;
 *   3bis les virements     : le compte de l'autre jambe de chaque virement interne (cf. « LES VIREMENTS
 *                            INTERNES DE L'IMPORT ») ;
 *   4    le contrôle       : le contrôle avant import, dans la page, quand il signale quelque chose (lignes
 *                            mal lues, solde qui ne tombe pas juste, dates ou montants hors norme) ;
 *   puis « Importer ».
 *
 * L'UTILISATEUR EST PORTÉ À LA PREMIÈRE ÉTAPE QUI DEMANDE QUELQUE CHOSE (`ouvrirSuiteImport`) ; celles qui
 * n'ont rien à demander sont sautées, et chaque fenêtre rend la main au parcours en se fermant. Chaque étape
 * s'ouvre d'office une seule fois par fichier (`importParcours.proposees`). Rien à valider nulle part : rien ne
 * s'ouvre. LE GRAPHE MONTRE TOUJOURS TOUTES LES ÉTAPES, 1bis et 3bis comprises : une étape franchie est verte,
 * une étape sans objet est « sautée » - pour ne pas faire croire qu'on a presque fini.
 */
const PROPRIETES_A_MOTS_CLES = ["sens", "statut"];

const ETAPES_IMPORT = [
  { id: "champs", numero: "1", nom: "Champs" },
  { id: "mots-cles", numero: "1bis", nom: "Mots-clés" },
  { id: "categories", numero: "2", nom: "Catégories" },
  { id: "compte", numero: "3", nom: "Comptes" },
  { id: "virements", numero: "3bis", nom: "Virements internes" },
  { id: "controle", numero: "4", nom: "Contrôle" },
  { id: "importer", numero: "✓", nom: "Importer" },
];

/**
 * L'ÉTAPE 3bis, « VIREMENTS INTERNES » : des virements que l'import lira n'ont pas encore leur compte en face
 * - ceux qu'une catégorie bancaire rattachée à « Virements internes » a faits à l'étape 2, et ceux d'une règle
 * ou d'un reclassement (cf. `lignesVirementsEnFace`). Elle vient APRÈS les comptes (étape 3) : le compte du
 * fichier est alors connu, et il est exclu des choix. La fenêtre : « LES VIREMENTS INTERNES DE L'IMPORT ».
 */
function etapeVirementsInternesADemander() {
  return !!importApercu && lignesVirementsEnFace().some((l) => l.compte_id_autre == null);
}

/** La fenêtre de l'étape 3bis, ouverte par le parcours ; rend vrai quand elle s'est ouverte. */
function ouvrirEtapeVirementsInternes() {
  return ouvrirVirementsImport({ chaine: true });
}

/** L'étape 3 a-t-elle quelque chose à demander ? (Le compte du fichier, des noms de comptes, des devises, ou
 *  l'extension « Monnaies » à allumer.) */
function etapeCompteADemander() {
  const { defaut, noms, monnaies } = compteImportBesoins();
  return defaut || noms.length > 0 || monnaies.length > 0 || compteImportExtensionDemandee();
}

/** L'ÉTAPE 4 : le contrôle avant import signale-t-il quelque chose à regarder ? Des lignes MAL LUES (une
 *  question sans réponse - catégorie, compte - ne compte pas : elle a son étape), un solde que les montants
 *  lus ne retrouvent pas, des dates hors plage ou des montants hors norme. */
function etapeControleADemander() {
  if (!importApercu) return false;
  const c = importApercu.controle || {};
  const solde = c.controle_solde;
  const a = c.anomalies || {};
  return (
    lignesLuesParImport().some(ligneMalLue) ||
    (!!solde && solde.statut !== "ok") ||
    a.nombre_dates_hors_plage > 0 ||
    a.nombre_montants_aberrants > 0
  );
}

/** Une étape APRÈS celle qu'on montre : sautée d'avance quand on sait déjà qu'elle n'aura rien à demander.
 *  Tant que les colonnes ne sont pas validées (étapes 1 et 1bis), seules la 1bis (aucune colonne Sens ou État
 *  choisie) et la 3bis se savent sautées : le reste dépend de la lecture qui vient. */
function etapeSauteeDAvance(id, courante) {
  if (id === "virements") return !etapeVirementsInternesADemander();
  if (id === "importer") return false;
  if (id === "mots-cles") {
    return courante === "champs" && !detColonnes.some((e) => PROPRIETES_A_MOTS_CLES.includes(e.choix));
  }
  if (courante === "champs" || courante === "mots-cles" || !importApercu) return false;
  if (id === "categories") {
    return !demandesDeMapping().categories.some((nom) => !importCategoriesConfirmees.has(nom));
  }
  if (id === "compte") return importCompteDemande || !etapeCompteADemander();
  if (id === "controle") return !etapeControleADemander();
  return false;
}

function etatEtapeImport(rang, rangCourant) {
  const id = ETAPES_IMPORT[rang].id;
  if (rang === rangCourant) return "courante";
  if (rang < rangCourant) return importParcours.vues.has(id) ? "faite" : "sautee";
  return etapeSauteeDAvance(id, ETAPES_IMPORT[rangCourant].id) ? "sautee" : "a-venir";
}

function nomEtapeImport(etape) {
  if (etape.id === "compte" && etapeCompteAvecMonnaies()) return t("Comptes & Monnaies");
  return t(etape.nom);
}

const FLECHE_ETAPE_SVG =
  '<svg viewBox="0 0 44 14" width="44" height="14" aria-hidden="true" focusable="false">' +
  '<path d="M2 7h36M32 2l7 5-7 5" fill="none" stroke="currentColor" stroke-width="2" ' +
  'stroke-linecap="round" stroke-linejoin="round"/></svg>';

/** Le graphe d'une fenêtre : un rond par étape et une flèche entre deux. `courante` est l'étape que la
 *  fenêtre montre ; celles d'avant sont faites (vertes) ou sautées, celles d'après à venir (grises) ou
 *  sautées d'avance. TOUTES LES ÉTAPES SONT TOUJOURS DESSINÉES. */
function etapesImportHtml(courante) {
  const rang = ETAPES_IMPORT.findIndex((e) => e.id === courante);
  const items = ETAPES_IMPORT.map((e, i) => {
    const etat = etatEtapeImport(i, rang);
    const fleche =
      i < ETAPES_IMPORT.length - 1
        ? `<li class="import-etape-fleche ${i < rang ? "import-etape-fleche-faite" : ""}" aria-hidden="true">${FLECHE_ETAPE_SVG}</li>`
        : "";
    const sautee = etat === "sautee" ? ` title="${escapeHtml(t("Étape sautée : rien à y faire pour ce fichier."))}"` : "";
    return `<li class="import-etape import-etape-${etat}"${i === rang ? ' aria-current="step"' : ""}${sautee}>
      <span class="import-etape-rond">${escapeHtml(e.numero)}</span>
      <span class="import-etape-nom">${escapeHtml(nomEtapeImport(e))}</span></li>${fleche}`;
  });
  return `<ol class="import-etapes-liste" aria-label="${escapeHtml(t("Étapes de l'import"))}">${items.join("")}</ol>`;
}

function majEtapesImport(idModale, courante) {
  const zone = document.querySelector(`#${idModale} [data-import-etapes]`);
  if (zone) zone.innerHTML = etapesImportHtml(courante);
}

/**
 * LE POINT D'ENCHAÎNEMENT DU PARCOURS, après chaque lecture du fichier et à la fermeture de chaque fenêtre :
 * ouvre la PREMIÈRE étape qui a quelque chose à demander et n'a pas encore été ouverte pour ce fichier, ou se
 * pose sur le contrôle avant import (`finirParcoursImport`).
 * PENDANT UN TUTORIEL, rien ne s'ouvre de lui-même : ouverts à chaque relecture, les tableaux cacheraient
 * ce que la bulle désigne.
 */
async function ouvrirSuiteImport() {
  if (tutorielEnCours() || !importApercu) return;
  if (importParcours.proposition) return;
  // 0. Le preset, avant toute autre fenêtre.
  if (proposerPresetImport()) return;
  // 1. Les champs, et 1bis seule quand ils sont sautés.
  if (await ouvrirEtapeChamps()) return;
  if (ouvrirEtapeMotsClesSeule()) return;
  // 2. Les catégories.
  if (
    !importParcours.proposees.has("categories") &&
    demandesDeMapping().categories.some((nom) => !importCategoriesConfirmees.has(nom))
  ) {
    importParcours.proposees.add("categories");
    ouvrirCorrespondances({ chaine: true });
    return;
  }
  // 3. Les comptes (et les monnaies).
  if (ouvrirChoixCompteImport()) return;
  // 3bis. Les virements internes.
  if (!importParcours.proposees.has("virements") && etapeVirementsInternesADemander()) {
    importParcours.proposees.add("virements");
    if (ouvrirEtapeVirementsInternes()) return;
  }
  // 4. Le contrôle.
  finirParcoursImport();
}

/**
 * LA FIN DU PARCOURS : le contrôle avant import, juste au-dessus de « Confirmer l'import ». Il porte le graphe
 * quand le parcours a eu lieu - l'étape 4 « courante » s'il signale quelque chose, « Importer » sinon. Rien à
 * valider nulle part (aucune fenêtre, un contrôle sans remarque) : rien ne s'ouvre, la page ne bouge pas.
 */
function finirParcoursImport() {
  if (tutorielEnCours()) return;
  const controle = etapeControleADemander();
  if (!importParcours.vues.size && !controle) {
    importParcours.etapeFinale = null;
    renderImportControle();
    return;
  }
  if (controle) importParcours.vues.add("controle");
  importParcours.etapeFinale = controle ? "controle" : "importer";
  renderImportControle();
  versControleImport();
}

/* ---------- LES MOTS-CLÉS DU FICHIER (étape 1bis) ----------
 *
 * Une colonne « Sens » ou « État » n'écrit pas toujours les mots que l'application connaît d'avance : un
 * export dit « IN » / « OUT », « COMPLETED » / « CANCELLED ». Le sens d'une ligne décide du signe de son
 * montant, son état de ce qui est importé : se tromper inverse une dépense ou importe un paiement refusé.
 * L'application ne devine donc jamais - elle propose (les mots qu'elle connaît sont en bleu), et demande,
 * pour CHAQUE mot distinct que le fichier écrit, s'il veut dire Sortie / Entrée (sens) ou Exécuté / En
 * attente / Refusé (état). Le même tableau à molettes que les colonnes et les catégories : une carte par
 * mot, les mêmes touches, la même pastille.
 *
 * RIEN N'EST ENREGISTRÉ ICI. Les mots rejoignent les éditeurs de mots-clés du preset (là où
 * « Enregistrer la configuration » les prend) et partent avec les colonnes à chaque lecture
 * (`importVocabulairesEssai`) : le fichier est lu avec eux avant que le preset ne les garde.
 */
let motsEntrees = [];
let motsCourante = -1;
const motsConfirmees = new Set();
// Les colonnes et la détection de l'étape 1, pour reprendre où elle s'est arrêtée.
let motsContexte = null;

function motsOuvert() {
  return document.getElementById("modale-mots-cles").style.display !== "none";
}

function motsClef(entree) {
  return `${entree.champ}|${entree.colonne}|${entree.valeur}`;
}

/** Les mots à faire dire : un par valeur distincte de chaque colonne lue comme sens ou état. Une valeur que
 *  les éditeurs portent déjà (preset enregistré) ou que l'application connaît arrive proposée. */
function motsClesAMapper(detection, colonnes) {
  const entrees = [];
  colonnes
    .filter((c) => PROPRIETES_A_MOTS_CLES.includes(c.propriete))
    .forEach((c) => {
      const source = detection.colonnes.find((x) => x.index === c.index);
      if (!source || !source.valeurs || !source.valeurs.length) return;
      const dits = motsClesSaisis(`import-${c.propriete}`);
      source.valeurs.forEach((v) => {
        const dejaDit = Object.keys(dits).find((mode) =>
          (dits[mode] || []).some((m) => normaliserMotCle(m) === normaliserMotCle(v.valeur))
        );
        const propose = dejaDit || v[c.propriete] || null;
        entrees.push({
          champ: c.propriete,
          colonne: c.index,
          entete: source.entete,
          valeur: v.valeur,
          nombre: v.nombre,
          propose,
          // Sans proposition, la molette part de sa première ligne : le mot reste « À classer » tant qu'on
          // n'a pas choisi, et « Continuer » n'ouvre pas avant que chaque mot soit confirmé.
          choix: propose || Object.keys(CHAMPS_VOCABULAIRE[c.propriete].libelles)[0],
          manuel: false,
        });
      });
    });
  return entrees;
}

/** Les lectures possibles du mot : la proposition en tête quand il y en a une. JAMAIS d'option « ignorer » :
 *  une ligne dont le mot n'est dans aucune liste se met en erreur, et l'import tout entier avec elle. */
function motsOptions(entree) {
  const modes = Object.keys(CHAMPS_VOCABULAIRE[entree.champ].libelles);
  if (!entree.propose) return modes.map((id) => ({ id, niveau: "choix" }));
  const ordre = [entree.propose, ...modes.filter((m) => m !== entree.propose)];
  return ordre.map((id, rang) => ({ id, niveau: rang === 0 ? "forte" : "choix" }));
}

function motsLibelleOption(entree, id) {
  return t(CHAMPS_VOCABULAIRE[entree.champ].libelles[id]);
}

function motsStatut(entree) {
  if (entree.propose && entree.choix === entree.propose) {
    return { cle: "forte", texte: t("Proposition forte") };
  }
  return {
    cle: "choix",
    texte: !entree.propose && !entree.manuel ? t("À classer") : t("Ton choix"),
  };
}

function motsCarteHtml(entree, i) {
  const statut = motsStatut(entree);
  const confirmee = motsConfirmees.has(motsClef(entree));
  const champ = t(entree.champ === "sens" ? "Sens" : "État");
  return `
    <section class="corr-colonne ${confirmee ? "corr-confirmee" : ""}" data-corr-i="${i}" tabindex="-1">
      <div>
        <div class="corr-banque" title="${escapeHtml(entree.valeur)}">${escapeHtml(entree.valeur)}</div>
        <div class="hint">${escapeHtml(champ)} · ${escapeHtml(t("Colonne n°"))} ${entree.colonne}${
    entree.entete ? ` · ${escapeHtml(entree.entete)}` : ""
  }</div>
        <div class="hint">${escapeHtml(t("{n} ligne(s)", { n: entree.nombre }))}</div>
        <span class="corr-statut corr-statut-${statut.cle}" data-corr-statut>${escapeHtml(statut.texte)}</span>
      </div>
      <div class="corr-roue-cadre">
        <div class="corr-roue" role="listbox" tabindex="0"
             aria-label="${escapeHtml(t("Sens de « {mot} »", { mot: entree.valeur }))}">
          ${motsOptions(entree)
            .map(
              (o) => `<div class="corr-roue-option corr-roue-${o.niveau} ${
                o.id === entree.choix ? "corr-roue-choisie" : ""
              }" role="option" data-id="${o.id}" aria-selected="${o.id === entree.choix}">${escapeHtml(
                motsLibelleOption(entree, o.id)
              )}</div>`
            )
            .join("")}
        </div>
      </div>
      <div class="corr-actions">
        <button type="button" class="primary corr-confirmer" data-corr-confirmer="${i}"><span data-corr-libelle>${
    confirmee ? escapeHtml(t("Confirmée")) : escapeHtml(t("Confirmer"))
  }</span> <kbd data-corr-touche>(${escapeHtml(libelleCombo(toucheImport("confirmer")))})</kbd></button>
      </div>
    </section>`;
}

function motsDom(i) {
  return document.querySelector(`#mots-cles-board [data-corr-i="${i}"]`);
}

function motsMajCompteur() {
  const restantes = motsEntrees.filter((e) => !motsConfirmees.has(motsClef(e))).length;
  document.getElementById("mots-cles-compteur").textContent = restantes
    ? t("{n} mot(s) à confirmer", { n: restantes })
    : t("Tout est confirmé.");
  document.getElementById("btn-mots-cles-fortes").disabled = !motsEntrees.some(motsFortePrete);
  // Chaque mot doit avoir été confirmé : aucun n'est laissé de côté, aucun n'est deviné.
  document.getElementById("btn-mots-cles-continuer").disabled = restantes > 0;
}

function motsFortePrete(entree) {
  return motsStatut(entree).cle === "forte" && !motsConfirmees.has(motsClef(entree));
}

function motsMajCarte(i, { defiler = false } = {}) {
  const entree = motsEntrees[i];
  const carte = motsDom(i);
  if (!carte) return;
  const confirmee = motsConfirmees.has(motsClef(entree));
  carte.classList.toggle("corr-confirmee", confirmee);
  carte.querySelector("[data-corr-libelle]").textContent = confirmee ? t("Confirmée") : t("Confirmer");
  carte.querySelectorAll(".corr-roue-option").forEach((o) => {
    const choisie = o.dataset.id === entree.choix;
    o.classList.toggle("corr-roue-choisie", choisie);
    o.setAttribute("aria-selected", String(choisie));
  });
  const statut = motsStatut(entree);
  const pastille = carte.querySelector("[data-corr-statut]");
  pastille.className = `corr-statut corr-statut-${statut.cle}`;
  pastille.textContent = statut.texte;
  if (defiler) motsCentrerRoue(i, true);
}

function motsCentrerRoue(i, doux) {
  const carte = motsDom(i);
  if (!carte) return;
  const roue = carte.querySelector(".corr-roue");
  const rang = Math.max(0, [...roue.children].findIndex((o) => o.classList.contains("corr-roue-choisie")));
  roue.scrollTo({ top: rang * CORR_HAUTEUR_OPTION, behavior: doux ? "smooth" : "auto" });
}

function motsDefinirCourante(i, { focus = false } = {}) {
  motsCourante = i;
  document
    .querySelectorAll("#mots-cles-board .corr-colonne")
    .forEach((c) => c.classList.toggle("corr-courante", Number(c.dataset.corrI) === i));
  const carte = motsDom(i);
  if (!carte) return;
  carte.scrollIntoView({ inline: "center", block: "nearest", behavior: "smooth" });
  if (focus) carte.querySelector(".corr-roue").focus({ preventScroll: true });
}

/** Choisit le sens du mot de la carte `i` : redemande une confirmation. */
function motsChoisir(i, id, { defiler = true } = {}) {
  const entree = motsEntrees[i];
  if (id !== entree.choix) {
    entree.choix = id;
    entree.manuel = true;
    motsConfirmees.delete(motsClef(entree));
  }
  motsMajCarte(i, { defiler });
  motsMajCompteur();
}

function motsProchaineNonConfirmee(apres) {
  const non = (e) => !motsConfirmees.has(motsClef(e));
  const suivante = motsEntrees.findIndex((e, k) => k > apres && non(e));
  return suivante !== -1 ? suivante : motsEntrees.findIndex(non);
}

function motsConfirmer(i) {
  if (i < 0 || i >= motsEntrees.length) return;
  motsConfirmees.add(motsClef(motsEntrees[i]));
  motsMajCarte(i);
  motsMajCompteur();
  const cible = motsProchaineNonConfirmee(i);
  if (cible === -1) {
    motsDefinirCourante(i);
    document.getElementById("btn-mots-cles-continuer").focus();
    return;
  }
  motsDefinirCourante(cible, { focus: true });
}

function motsConfirmerFortes() {
  motsEntrees.forEach((entree, i) => {
    if (!motsFortePrete(entree)) return;
    motsConfirmees.add(motsClef(entree));
    motsMajCarte(i);
  });
  motsMajCompteur();
  const premiere = motsProchaineNonConfirmee(-1);
  if (premiere !== -1) motsDefinirCourante(premiere, { focus: true });
}

/**
 * L'ÉTAPE 1bis SEULE, quand l'étape 1 a été sautée (le preset lit le fichier) : elle s'ouvre si une colonne
 * « Sens » ou « État » que le preset lit écrit un mot qu'il ne connaît pas (ni dans ses mots-clés, ni parmi
 * ceux de l'application quand il n'en a pas) - sans quoi la ligne se mettrait en erreur. Comme après l'étape
 * 1, tous les mots de la colonne sont alors demandés.
 */
function vocabulaireEffectifImport(champ) {
  const saisis = motsClesSaisis(`import-${champ}`);
  const meta = state.meta || {};
  const defauts = (champ === "sens" ? meta.libelles_sens_defaut : meta.libelles_statut_defaut) || {};
  const connus = new Set();
  Object.keys(CHAMPS_VOCABULAIRE[champ].libelles).forEach((mode) => {
    const liste = (saisis[mode] || []).length ? saisis[mode] : defauts[mode] || [];
    liste.forEach((mot) => connus.add(normaliserMotCle(mot)));
  });
  return connus;
}

function motsInconnusDuFichier(detection, colonnes) {
  return colonnes
    .filter((c) => PROPRIETES_A_MOTS_CLES.includes(c.propriete))
    .some((c) => {
      const source = detection.colonnes.find((x) => x.index === c.index);
      const connus = vocabulaireEffectifImport(c.propriete);
      return ((source && source.valeurs) || []).some((v) => !connus.has(normaliserMotCle(v.valeur)));
    });
}

function ouvrirEtapeMotsClesSeule() {
  if (importParcours.vues.has("champs") || importParcours.proposees.has("mots-cles")) return false;
  if (tutorielEnCours() || !importApercu) return false;
  importParcours.proposees.add("mots-cles");
  const detection = importParcours.detection;
  if (!detection) return false;
  const colonnes = importConfigColonnes
    .filter((c) => c.index >= 1)
    .map((c) => ({ index: c.index, propriete: c.propriete }));
  if (!motsInconnusDuFichier(detection, colonnes)) return false;
  const entrees = motsClesAMapper(detection, colonnes);
  if (!entrees.length) return false;
  ouvrirMotsCles(detection, colonnes, entrees, {
    lignes: { entete: lignesEnteteSaisies(), pied: lignesPiedSaisies() },
  });
  return true;
}

function ouvrirMotsCles(detection, colonnes, entrees, { lignes = null } = {}) {
  motsContexte = { detection, colonnes, lignes };
  motsEntrees = entrees;
  motsConfirmees.clear();
  importParcours.vues.add("mots-cles");
  // Le tableau des colonnes se range derrière : « Retour aux colonnes » le rouvre tel qu'on l'a laissé.
  document.getElementById("modale-detection").style.display = "none";
  majEtapesImport("modale-mots-cles", "mots-cles");
  document.getElementById("mots-cles-board").innerHTML = motsEntrees
    .map((entree, i) => motsCarteHtml(entree, i))
    .join("");
  motsEntrees.forEach((_, i) => motsCentrerRoue(i, false));
  motsMajCompteur();
  majAideFleches();
  document.getElementById("modale-mots-cles").style.display = "";
  document.body.classList.add("modale-ouverte");
  motsDefinirCourante(Math.max(0, motsProchaineNonConfirmee(-1)), { focus: true });
}

/** Retour au tableau des colonnes, laissé tel quel (les mots restent dans la carte, rien n'est perdu). Ouverte
 *  seule (étape 1 sautée), l'étape 1bis ouvre le tableau sur les colonnes que lit le preset. */
function retourMotsClesVersColonnes() {
  document.getElementById("modale-mots-cles").style.display = "none";
  motsCourante = -1;
  if (!importDetection && motsContexte) {
    ouvrirDetection(motsContexte.detection, { suite: true, choixInitiaux: motsContexte.colonnes });
    return;
  }
  document.getElementById("modale-detection").style.display = "";
  detDefinirCourante(Math.max(0, detCourante), { focus: true });
}

/** La croix : on abandonne l'import des colonnes, comme en fermant le tableau des colonnes. */
function fermerMotsCles() {
  document.getElementById("modale-mots-cles").style.display = "none";
  motsCourante = -1;
  motsContexte = null;
  fermerDetection();
}

/** Range les mots dits dans les éditeurs du preset - sans toucher à ceux que le fichier ne cite pas, sauf
 *  pour ceux qu'il redit autrement - et les rend pour la lecture qui suit. */
function fusionnerMotsCles(idGroupe, nouveaux) {
  const existants = motsClesSaisis(idGroupe);
  // Les mots que le fichier redit (rangés ailleurs) quittent leur ancienne liste.
  const redits = new Set();
  Object.values(nouveaux).forEach((mots) => mots.forEach((m) => redits.add(normaliserMotCle(m))));
  const fusion = {};
  Object.keys(nouveaux).forEach((cle) => {
    const gardes = (existants[cle] || []).filter((m) => !redits.has(normaliserMotCle(m)));
    fusion[cle] = [...gardes, ...nouveaux[cle]];
  });
  chargerMotsCles(idGroupe, fusion);
}

async function validerMotsCles() {
  if (!motsContexte) return;
  const { detection, colonnes, lignes } = motsContexte;
  // Ce que les éditeurs portaient AVANT l'étape, gardé une fois pour le leur rendre au changement de fichier.
  if (!importVocabulairesAvant) importVocabulairesAvant = vocabulairesSaisis();
  PROPRIETES_A_MOTS_CLES.forEach((champ) => {
    const lus = motsEntrees.filter((e) => e.champ === champ);
    if (!lus.length) return;
    const nouveaux = {};
    Object.keys(CHAMPS_VOCABULAIRE[champ].libelles).forEach((mode) => (nouveaux[mode] = []));
    lus.forEach((e) => nouveaux[e.choix].push(e.valeur));
    fusionnerMotsCles(`import-${champ}`, nouveaux);
  });
  importVocabulairesEssai = vocabulairesSaisis();
  motsContexte = null;
  await finaliserDetectionImport(detection, colonnes, lignes);
}

/** Rend aux éditeurs de mots-clés ce qu'ils portaient avant l'étape (changement de fichier). */
function restaurerVocabulairesImport() {
  const avant = importVocabulairesAvant;
  if (!avant) return;
  renderImportVocabulaires(avant);
}

(function initMotsCles() {
  document.getElementById("btn-mots-cles-fermer").addEventListener("click", fermerMotsCles);
  document.getElementById("btn-mots-cles-retour").addEventListener("click", retourMotsClesVersColonnes);
  document.getElementById("btn-mots-cles-fortes").addEventListener("click", motsConfirmerFortes);
  document.getElementById("btn-mots-cles-continuer").addEventListener("click", validerMotsCles);
  brancherMolettes(document.getElementById("mots-cles-board"), {
    courante: () => motsCourante,
    definirCourante: motsDefinirCourante,
    choisir: (i, id, options) => motsChoisir(i, id, options),
    valeur: (i) => motsEntrees[i].choix,
    nombre: () => motsEntrees.length,
    confirmer: motsConfirmer,
  });
  document.addEventListener("keydown", (e) => {
    if (!motsOuvert()) return;
    if (comboEvenementImport(e) === toucheImport("confirmer")) {
      e.preventDefault();
      motsConfirmer(motsCourante);
    } else if (e.key === "Escape") {
      fermerMotsCles();
    }
  });
})();

/* ---------- LE COMPTE DE L'IMPORT (étape 3) ----------
 *
 * La dernière question avant l'aperçu : où vont les opérations ? Deux cas, qui peuvent se cumuler - le
 * fichier ne nomme AUCUN compte et le preset n'est lié à aucun (un compte « pour ce fichier »), ou il nomme
 * des comptes que l'application ne connaît pas (à rattacher un par un). Une fenêtre à part, ouverte
 * APRÈS les champs et les catégories : le compte choisi relit le fichier SANS rien défaire (cf.
 * `executerPrevisualisation({ conserver })`) et ne rouvre aucun tableau.
 *
 * LE COMPTE « POUR CE FICHIER » SE CHOISIT AU MÊME SÉLECTEUR QUE LES CATÉGORIES : une carte, une molette, la
 * pastille, « Confirmer ». La base peut n'avoir AUCUN compte (premier import) : l'encadré violet en crée un
 * sur place (la fenêtre de l'application, `demanderCreationCompte`), qui rejoint la molette en violet et en
 * tête - et devient le choix de la carte, puisqu'on vient de le créer pour elle. Il reste à le confirmer.
 * Quand le fichier nomme lui-même ses comptes (colonne « Compte bancaire »), rien ne change : une ligne par
 * nom, et un bouton pour créer le compte qui manque. */
// Le compte choisi sur la molette (id, ou null), s'il a été confirmé, et les comptes créés dans la fenêtre.
const compteImport = { choix: null, confirme: false, manuel: false };
const compteImportNouveaux = new Set();

/** LA TOUCHE QUI A FERMÉ LA FENÊTRE D'AVANT N'OUVRE RIEN DANS CELLE-CI. Chaque fenêtre de l'import écoute ses
 *  touches sur `document` ; quand la dernière confirmation d'une étape ouvre la suivante, les écouteurs posés
 *  après le sien reçoivent ENCORE la même frappe - la fenêtre qui vient de s'ouvrir se confirmait alors toute
 *  seule, sur la première ligne de sa molette. Chaque fenêtre note l'instant où elle s'ouvre et laisse passer
 *  les frappes plus anciennes. */
const ouvertureFenetreImport = {};

function noterOuvertureFenetreImport(id) {
  ouvertureFenetreImport[id] = performance.now();
}

function toucheAvantOuverture(e, id) {
  return ouvertureFenetreImport[id] != null && e.timeStamp < ouvertureFenetreImport[id];
}

function compteImportBesoins() {
  const blocDefaut = document.getElementById("import-compte-defaut-bloc");
  const demandes = demandesDeMapping();
  return {
    defaut: blocDefaut.style.display !== "none" && !document.getElementById("import-compte-defaut").value,
    noms: demandes.comptes,
    // Les devises que l'application ne connaît pas : sans extension « Monnaies », il n'y a qu'une monnaie
    // et rien à rattacher.
    monnaies: choixDeMonnaiePossible() ? demandes.monnaies : [],
  };
}

function compteImportOuvert() {
  return document.getElementById("modale-compte-import").style.display !== "none";
}

/** Les options de la molette : les comptes créés dans la fenêtre d'abord (en violet), puis les autres. */
function compteImportOptions() {
  const comptes = comptesProposables(compteImport.choix);
  return [
    ...comptes.filter((c) => compteImportNouveaux.has(c.id)).map((c) => ({ id: c.id, nom: c.nom, niveau: "nouvelle" })),
    ...comptes.filter((c) => !compteImportNouveaux.has(c.id)).map((c) => ({ id: c.id, nom: c.nom, niveau: "choix" })),
  ];
}

function compteImportStatut() {
  return compteImport.manuel && compteImport.choix != null
    ? { cle: "choix", texte: t("Ton choix") }
    : { cle: "choix", texte: t("À classer") };
}

/** Quelques opérations du fichier sous la molette : de quoi reconnaître le compte d'où il sort. */
function compteImportOperationsHtml() {
  const lignes = lignesLuesParImport();
  const visibles = lignes.slice(0, 60);
  const html = visibles
    .map((l) => {
      const montant = l.montant_signe != null ? l.montant_signe : l.montant;
      return `<div class="corr-operation">
        <div>
          <div class="corr-operation-nature" title="${escapeHtml(l.nature || "")}">${escapeHtml(l.nature || "—")}</div>
          <div class="corr-operation-date">${l.date ? formatDateCourte(l.date) : ""}</div>
        </div>
        <div class="corr-operation-montant">${montant != null ? formatMontant(montant, l.monnaie_id) : ""}</div>
      </div>`;
    })
    .join("");
  const reste = lignes.length - visibles.length;
  return html + (reste > 0 ? `<p class="hint">${escapeHtml(t("… et {n} autres opérations", { n: reste }))}</p>` : "");
}

function compteImportCarteHtml() {
  const options = compteImportOptions();
  const statut = compteImportStatut();
  const nomFichier = importFichierActuel ? importFichierActuel.name : "";
  const roue = options.length
    ? options
        .map(
          (o) => `<div class="corr-roue-option corr-roue-${o.niveau} ${
            o.id === compteImport.choix ? "corr-roue-choisie" : ""
          }" role="option" data-id="${o.id}" aria-selected="${o.id === compteImport.choix}">${escapeHtml(o.nom)}</div>`
        )
        .join("")
    : `<div class="corr-roue-option corr-roue-vide" aria-disabled="true">${escapeHtml(t("Aucun compte pour l'instant"))}</div>`;
  return `
    <section class="corr-colonne ${compteImport.confirme ? "corr-confirmee" : ""}" data-corr-i="0" tabindex="-1">
      <div>
        <div class="corr-banque" title="${escapeHtml(nomFichier)}">${escapeHtml(nomFichier || t("Ce relevé"))}</div>
        <div class="hint">${escapeHtml(t("{n} opération(s)", { n: lignesLuesParImport().length }))}</div>
        <span class="corr-statut corr-statut-${statut.cle}" data-corr-statut>${escapeHtml(statut.texte)}</span>
      </div>
      <div class="corr-roue-cadre">
        <div class="corr-roue" role="listbox" tabindex="0" aria-label="${escapeHtml(t("Compte pour ce fichier"))}">${roue}</div>
      </div>
      <div class="corr-operations">${compteImportOperationsHtml()}</div>
      <button type="button" class="primary corr-confirmer" data-corr-confirmer="0" ${options.length ? "" : "disabled"}><span data-corr-libelle>${
        compteImport.confirme ? escapeHtml(t("Confirmée")) : escapeHtml(t("Confirmer"))
      }</span> <kbd data-corr-touche>(${escapeHtml(libelleCombo(toucheImport("confirmer")))})</kbd></button>
    </section>`;
}

/** L'encadré violet, au-dessus de la carte : comme celui des catégories, mais il ouvre la fenêtre de création
 *  d'un compte (le nom, le type, et ce que la fenêtre demande d'autre). */
function compteImportCreerHtml() {
  return `<details class="corr-creer" data-compte-creer>
      <summary>${escapeHtml(t("Aucun compte ne correspond ? Crée le tien"))}</summary>
    </details>`;
}

function renderCompteImportCarte({ focus = false } = {}) {
  const board = document.getElementById("compte-import-board");
  board.innerHTML = compteImportCarteHtml();
  const roue = board.querySelector(".corr-roue");
  const rang = Math.max(0, [...roue.children].findIndex((o) => o.classList.contains("corr-roue-choisie")));
  roue.scrollTo({ top: rang * CORR_HAUTEUR_OPTION, behavior: "auto" });
  board.querySelector(".corr-colonne").classList.add("corr-courante");
  if (focus) roue.focus({ preventScroll: true });
}

function compteImportChoisir(id, { defiler = true } = {}) {
  const compteId = Number(id);
  if (!Number.isFinite(compteId) || compteId === compteImport.choix) return;
  compteImport.choix = compteId;
  compteImport.manuel = true;
  compteImport.confirme = false;
  const carte = document.querySelector("#compte-import-board .corr-colonne");
  if (!carte) return;
  carte.classList.remove("corr-confirmee");
  carte.querySelectorAll(".corr-roue-option").forEach((o) => {
    const choisie = Number(o.dataset.id) === compteId;
    o.classList.toggle("corr-roue-choisie", choisie);
    o.setAttribute("aria-selected", String(choisie));
  });
  const statut = compteImportStatut();
  const pastille = carte.querySelector("[data-corr-statut]");
  pastille.className = `corr-statut corr-statut-${statut.cle}`;
  pastille.textContent = statut.texte;
  carte.querySelector("[data-corr-libelle]").textContent = t("Confirmer");
  if (defiler) {
    const roue = carte.querySelector(".corr-roue");
    const rang = Math.max(0, [...roue.children].findIndex((o) => o.classList.contains("corr-roue-choisie")));
    roue.scrollTo({ top: rang * CORR_HAUTEUR_OPTION, behavior: "smooth" });
  }
  document.getElementById("compte-import-erreur").style.display = "none";
}

/** « Confirmer » sur la carte : le compte est retenu. S'il n'y a rien d'autre à demander, la fenêtre se valide. */
function compteImportConfirmer() {
  if (compteImport.choix == null) {
    // La molette n'a encore rien de choisi : la ligne centrée est le choix (cf. brancherMolettes).
    const premiere = compteImportOptions()[0];
    if (!premiere) return;
    compteImportChoisir(premiere.id);
  }
  compteImport.confirme = true;
  const carte = document.querySelector("#compte-import-board .corr-colonne");
  if (carte) {
    carte.classList.add("corr-confirmee");
    carte.querySelector("[data-corr-libelle]").textContent = t("Confirmée");
  }
  const { noms, monnaies } = compteImportBesoins();
  if (!noms.length && !monnaies.length && !compteImportExtensionDemandee()) {
    validerChoixCompteImport();
    return;
  }
  const suivant = document.querySelector("#compte-import-mappings select, #compte-import-monnaies select");
  if (suivant) suivant.focus();
  else document.getElementById("btn-compte-import-valider").focus();
}

async function compteImportCreerCompte() {
  const compte = await demanderCreationCompte();
  const encadre = document.querySelector("#compte-import-creer details");
  if (encadre) encadre.open = false;
  if (!compte) return;
  compteImportNouveaux.add(compte.id);
  if (document.getElementById("compte-import-defaut-bloc").style.display !== "none") {
    // Créé pour cette carte : il en devient le choix - à confirmer.
    compteImport.choix = compte.id;
    compteImport.manuel = true;
    compteImport.confirme = false;
    renderCompteImportCarte({ focus: true });
  }
  renderCompteImportNoms();
  // Le compte « pour ce fichier » de la page aussi le connaît.
  updateImportCompteDefautVisibility();
}

/** Les comptes que le fichier nomme : une ligne chacun, comme avant. */
function renderCompteImportNoms() {
  const { noms } = compteImportBesoins();
  const surChangement = () => {
    appliquerMappingsLocalement();
    renderImportApercu();
  };
  const liste = document.getElementById("compte-import-mappings");
  liste.innerHTML = "";
  noms.forEach((nomBanque) => {
    const ligne = creerLigneMapping(nomBanque, comptesProposables(), importMappingComptes, surChangement);
    const select = ligne.querySelector("select");
    if (importMappingComptes[nomBanque]) select.value = String(importMappingComptes[nomBanque]);
    liste.appendChild(ligne);
  });
  document.getElementById("compte-import-creer-compte-bloc").style.display = noms.length ? "" : "none";
}

/** Les devises que le fichier écrit sans que l'application les connaisse (extension « Monnaies » allumée). */
function renderCompteImportMonnaies() {
  const { monnaies } = compteImportBesoins();
  const surChangement = () => {
    appliquerMappingsLocalement();
    renderImportApercu();
  };
  const listeMonnaies = document.getElementById("compte-import-monnaies");
  listeMonnaies.innerHTML = "";
  monnaies.forEach((nomBanque) => {
    // Une monnaie éteinte n'est pas une cible (cf. renderImportMappings).
    const ligne = creerLigneMapping(
      nomBanque,
      state.monnaies.filter((m) => m.active !== false),
      importMappingMonnaies,
      surChangement
    );
    const select = ligne.querySelector("select");
    if (importMappingMonnaies[nomBanque]) select.value = String(importMappingMonnaies[nomBanque]);
    listeMonnaies.appendChild(ligne);
  });
  document.getElementById("compte-import-texte-monnaies").style.display = monnaies.length ? "" : "none";
  document.getElementById("compte-import-creer-monnaie-bloc").style.display =
    monnaies.length && choixDeMonnaiePossible() ? "" : "none";
}

/** LE FICHIER LIT UNE DEVISE ALORS QUE L'EXTENSION « MONNAIES » EST ÉTEINTE : l'application n'a qu'une
 *  monnaie, et rien à quoi rattacher « USD ». La ligne d'activation de l'extension (celle de Paramètres →
 *  Extensions : son rendu, sa route) se pose alors dans l'étape, renommée « Comptes & Monnaies ».
 *  L'ALLUMER rend la main aux devises (une monnaie à choisir ou à créer pour chacune). NE PAS L'ALLUMER :
 *  la colonne de devise n'est pas lue (retirée des colonnes, le fichier relu sans elle) et toutes les
 *  opérations vont dans la monnaie de l'application - ce que la fenêtre dit sous la ligne d'activation. */
function compteImportExtensionDemandee() {
  return importLitUneMonnaie() && !choixDeMonnaiePossible();
}

/** L'étape parle-t-elle aussi de monnaies ? Elle s'appelle alors « Comptes & Monnaies » (fenêtre et graphe). */
function etapeCompteAvecMonnaies() {
  return importLitUneMonnaie() && (compteImportExtensionDemandee() || compteImportBesoins().monnaies.length > 0 || compteImportExtensionAllumee);
}

/** La monnaie de l'application quand l'extension est éteinte : celle où tout ira. */
function monnaieUniqueApplication() {
  const actives = (state.monnaies || []).filter((m) => m.active !== false);
  return monnaieParId(monnaiePreferee(actives.map((m) => m.id))) || actives[0] || null;
}

// L'extension a été allumée DEPUIS la fenêtre (sa ligne reste affichée, « Activée »).
let compteImportExtensionAllumee = false;

async function renderCompteImportExtension() {
  const bloc = document.getElementById("compte-import-extension-bloc");
  if (!compteImportExtensionDemandee() && !compteImportExtensionAllumee) {
    bloc.style.display = "none";
    return;
  }
  let extension = null;
  try {
    extension = (await apiFetch("/extensions")).find((e) => e.id === "monnaies") || null;
  } catch (err) {
    extension = null;
  }
  const zone = document.getElementById("compte-import-extension");
  zone.innerHTML = extension ? carteExtensionHtml(extension) : "";
  appliquerPuces(zone);
  const monnaie = monnaieUniqueApplication();
  const eteinte = document.getElementById("compte-import-extension-eteinte");
  eteinte.textContent = compteImportExtensionDemandee()
    ? t(texteAide("noyau.import-compte-extension-eteinte"), { monnaie: monnaie ? monnaie.nom : "" })
    : "";
  eteinte.style.display = eteinte.textContent ? "" : "none";
  bloc.style.display = "";
}

async function surExtensionCompteImport() {
  compteImportExtensionAllumee = choixDeMonnaiePossible();
  await refreshMonnaies();
  // Les colonnes de devise se montrent de nouveau (ou plus) dans la configuration du fichier.
  renderImportConfig();
  majTitreCompteImport();
  majEtapesImport("modale-compte-import", "compte");
  await renderCompteImportExtension();
  renderCompteImportMonnaies();
  renderImportMappings();
}

/** Sans l'extension, la colonne de devise n'est pas lue : retirée des colonnes, le fichier est relu sans elle. */
function retirerColonnesMonnaieImport() {
  importConfigColonnes = importConfigColonnes.filter((c) => !PROPRIETES_IMPORT_MONNAIE.has(c.propriete));
  renderImportConfig();
}

/**
 * UN COMPTE NE REÇOIT QUE SES MONNAIES : une ligne en dollars rattachée à un compte qui ne porte que l'euro
 * est ignorée à la confirmation (cf. le serveur, « ne porte pas la monnaie de cette ligne »). L'aperçu ne le
 * dit pas ; l'étape « Comptes & Monnaies » le dit AVANT, compte par compte, et propose d'ajouter les monnaies
 * qui manquent - l'utilisateur valide, rien ne s'ajoute de soi-même. Seules comptent les lignes dont le
 * fichier écrit la devise : sans elle, une ligne prend la monnaie de son compte.
 */
function monnaiesManquantesDesComptes() {
  const defautBloc = document.getElementById("compte-import-defaut-bloc");
  const compteFichier =
    defautBloc.style.display !== "none" && compteImport.choix != null
      ? compteImport.choix
      : Number(compteIdDefautChoisi()) || compteDuPresetImport();
  const manquantes = new Map(); // compte_id -> Set(monnaie_id)
  lignesLuesParImport().forEach((l) => {
    if (!l.nom_banque_monnaie) return;
    const monnaieId = l.monnaie_id ?? importMappingMonnaies[l.nom_banque_monnaie];
    const compteId =
      l.compte_id ?? (l.nom_banque_compte ? importMappingComptes[l.nom_banque_compte] : null) ?? compteFichier;
    const compte = compteId != null ? compteParId(Number(compteId)) : null;
    if (!monnaieId || !compte) return;
    const portees = (compte.monnaies || []).filter((m) => m.active !== false).map((m) => m.monnaie_id);
    if (portees.includes(monnaieId)) return;
    if (!manquantes.has(compte.id)) manquantes.set(compte.id, new Set());
    manquantes.get(compte.id).add(monnaieId);
  });
  return manquantes;
}

function afficherMonnaiesManquantes(manquantes) {
  const bloc = document.getElementById("compte-import-monnaies-manquantes");
  if (!manquantes.size) {
    bloc.style.display = "none";
    return;
  }
  const phrases = [...manquantes].map(([compteId, monnaies]) =>
    t(texteAide("noyau.import-compte-monnaies-manquantes"), {
      compte: nomCompte(compteId),
      monnaies: [...monnaies].map((id) => (monnaieParId(id) || {}).nom || `#${id}`).join(", "),
    })
  );
  bloc.querySelector("[data-texte]").textContent = phrases.join(" ");
  bloc.style.display = "";
}

/** « Ajouter au compte » : chaque compte reçoit les monnaies qui lui manquent, à la suite des siennes. */
async function ajouterMonnaiesManquantes() {
  const manquantes = monnaiesManquantesDesComptes();
  try {
    for (const [compteId, monnaies] of manquantes) {
      const compte = compteParId(compteId);
      await apiFetch(`/comptes/${compteId}`, {
        method: "PUT",
        body: JSON.stringify({
          monnaies: [
            ...compte.monnaies.map((m) => ({
              monnaie_id: m.monnaie_id,
              solde_initial: m.solde_initial,
              solde_actuel_renseigne: m.solde_actuel_renseigne ?? null,
              active: m.active !== false,
            })),
            ...[...monnaies].map((monnaie_id) => ({ monnaie_id })),
          ],
        }),
      });
    }
    await refreshComptes();
    document.getElementById("compte-import-monnaies-manquantes").style.display = "none";
    await validerChoixCompteImport();
  } catch (err) {
    showMessage(traduireMessageServeur(err.message), "error");
  }
}

async function compteImportCreerMonnaie() {
  const monnaie = await demanderCreationMonnaie();
  if (!monnaie) return;
  await refreshMonnaies();
  renderCompteImportMonnaies();
  renderImportMappings();
}

/** Ouvre l'étape 3 si elle a quelque chose à demander ; rend vrai quand elle s'est ouverte. La base peut
 *  n'avoir aucun compte : la fenêtre s'ouvre quand même, l'encadré violet en crée un. */
function ouvrirChoixCompteImport() {
  if (importCompteDemande || tutorielEnCours() || !importApercu) return false;
  const { defaut, noms, monnaies } = compteImportBesoins();
  if (!defaut && !noms.length && !monnaies.length && !compteImportExtensionDemandee()) return false;
  importCompteDemande = true;
  importParcours.vues.add("compte");

  const blocDefaut = document.getElementById("compte-import-defaut-bloc");
  blocDefaut.style.display = defaut ? "" : "none";
  if (defaut) {
    compteImport.choix = null;
    compteImport.manuel = false;
    compteImport.confirme = false;
    document.getElementById("compte-import-creer").innerHTML = compteImportCreerHtml();
    renderCompteImportCarte();
  }
  document.getElementById("compte-import-texte-defaut").style.display = defaut ? "" : "none";
  document.getElementById("compte-import-texte-noms").style.display = noms.length ? "" : "none";
  compteImportExtensionAllumee = false;
  majTitreCompteImport();
  renderCompteImportNoms();
  renderCompteImportMonnaies();
  renderCompteImportExtension();
  majAideFleches();
  document.getElementById("compte-import-erreur").style.display = "none";
  document.getElementById("compte-import-monnaies-manquantes").style.display = "none";
  majEtapesImport("modale-compte-import", "compte");
  noterOuvertureFenetreImport("modale-compte-import");
  document.getElementById("modale-compte-import").style.display = "";
  document.body.classList.add("modale-ouverte");
  if (defaut) {
    document.querySelector("#compte-import-board .corr-roue").focus({ preventScroll: true });
  } else {
    const premier = document.querySelector("#compte-import-mappings select, #compte-import-monnaies select");
    if (premier) premier.focus();
  }
  return true;
}

function majTitreCompteImport() {
  document.getElementById("modale-compte-import-titre").textContent = etapeCompteAvecMonnaies()
    ? t("Comptes & Monnaies")
    : t("Dans quel compte va ce relevé ?");
}

/** Fermée (validée, « Plus tard », la croix) : le parcours continue - les virements internes, le contrôle. */
function fermerChoixCompteImport() {
  document.getElementById("modale-compte-import").style.display = "none";
  document.body.classList.remove("modale-ouverte");
  ouvrirSuiteImport();
}

async function validerChoixCompteImport() {
  const blocDefaut = document.getElementById("compte-import-defaut-bloc");
  const erreur = document.getElementById("compte-import-erreur");
  const defautDemande = blocDefaut.style.display !== "none";
  if (defautDemande && (compteImport.choix == null || !compteImport.confirme)) {
    erreur.textContent = t("Choisis le compte où vont les opérations de ce relevé.");
    erreur.style.display = "";
    const roue = document.querySelector("#compte-import-board .corr-roue");
    if (roue) roue.focus();
    return;
  }
  const besoins = compteImportBesoins();
  if (besoins.noms.some((nom) => !importMappingComptes[nom])) {
    erreur.textContent = t("Choisis un compte pour chaque nom du relevé, ou reviens-y plus tard.");
    erreur.style.display = "";
    return;
  }
  if (besoins.monnaies.some((nom) => !importMappingMonnaies[nom])) {
    erreur.textContent = t("Choisis une monnaie pour chaque devise du relevé, ou reviens-y plus tard.");
    erreur.style.display = "";
    return;
  }
  // L'extension « Monnaies » laissée éteinte : la colonne de devise n'est pas lue (cf.
  // `compteImportExtensionDemandee`), et le fichier est relu sans elle.
  const sansMonnaie = compteImportExtensionDemandee();
  if (!sansMonnaie) {
    const manquantes = monnaiesManquantesDesComptes();
    afficherMonnaiesManquantes(manquantes);
    if (manquantes.size) return;
  }
  if (sansMonnaie) retirerColonnesMonnaieImport();
  if (defautDemande || sansMonnaie) {
    // Le compte « pour ce fichier » de la page est la seule mémoire : l'aperçu et la confirmation le lisent.
    if (defautDemande) {
      const page = document.getElementById("import-compte-defaut");
      fillComptesSelect(page, comptesProposables(compteImport.choix), { keepFirst: true });
      page.value = String(compteImport.choix);
    }
    // La fenêtre reste ouverte le temps de la relecture, comme aux étapes d'avant.
    const libere = occuperBoutonImport("btn-compte-import-valider");
    try {
      await executerPrevisualisation({ conserver: true });
    } finally {
      libere();
    }
  } else {
    appliquerMappingsLocalement();
    renderImportApercu();
  }
  fermerChoixCompteImport();
}

(function initCompteImport() {
  document.getElementById("btn-compte-import-fermer").addEventListener("click", fermerChoixCompteImport);
  document.getElementById("btn-compte-import-plus-tard").addEventListener("click", fermerChoixCompteImport);
  document.getElementById("btn-compte-import-valider").addEventListener("click", validerChoixCompteImport);
  document.getElementById("btn-compte-import-creer-compte").addEventListener("click", compteImportCreerCompte);
  document.getElementById("btn-compte-import-creer-monnaie").addEventListener("click", compteImportCreerMonnaie);
  document.getElementById("btn-compte-import-ajouter-monnaies").addEventListener("click", ajouterMonnaiesManquantes);
  // LA LIGNE D'ACTIVATION DE L'EXTENSION « MONNAIES » : le même menu et la même route que dans Paramètres →
  // Extensions (cf. `basculerExtensionDepuisMenu`).
  document.getElementById("compte-import-extension").addEventListener("change", async (e) => {
    const menu = e.target.closest("select[data-extension-id]");
    if (!menu) return;
    await basculerExtensionDepuisMenu(menu, { apres: surExtensionCompteImport });
  });
  // L'encadré violet ouvre la fenêtre de création au lieu de se déplier.
  document.getElementById("compte-import-creer").addEventListener("click", (e) => {
    if (!e.target.closest("[data-compte-creer] summary")) return;
    e.preventDefault();
    compteImportCreerCompte();
  });
  brancherMolettes(document.getElementById("compte-import-board"), {
    courante: () => 0,
    definirCourante: () => {},
    choisir: (i, id, options) => compteImportChoisir(id, options),
    valeur: () => compteImport.choix,
    nombre: () => 1,
    confirmer: compteImportConfirmer,
  });
  // Changer le compte dans la page relit le fichier SANS rien défaire (et sans rouvrir de tableau).
  document.getElementById("import-compte-defaut").addEventListener("change", async () => {
    if (!importFichierActuel || !importApercu || !document.getElementById("import-compte-defaut").value) return;
    await executerPrevisualisation({ conserver: true });
  });
  document.addEventListener("keydown", (e) => {
    if (!compteImportOuvert() || toucheAvantOuverture(e, "modale-compte-import")) return;
    // Une fenêtre de création ouverte par-dessus garde ses touches.
    if (document.getElementById("modale-guide-compte").style.display !== "none") return;
    if (comboEvenementImport(e) === toucheImport("confirmer")) {
      e.preventDefault();
      if (document.getElementById("compte-import-defaut-bloc").style.display !== "none" && !compteImport.confirme) {
        compteImportConfirmer();
      } else {
        validerChoixCompteImport();
      }
    } else if (e.key === "Escape") {
      fermerChoixCompteImport();
    } else if (e.key === "Enter" && e.target.tagName !== "BUTTON" && !e.target.closest(".corr-roue")) {
      e.preventDefault();
      validerChoixCompteImport();
    }
  });
})();

/* ---------- LES VIREMENTS INTERNES DE L'IMPORT (étape 3bis) ----------
 *
 * Un virement interne a DEUX jambes, une par compte, et le relevé n'en décrit qu'une : celle du compte du
 * fichier. Tant que l'autre compte n'est pas désigné, la ligne ne s'importe pas (`virementIncomplet`). Cette
 * fenêtre le demande, UNE CARTE PAR LIGNE : la date, le libellé, le montant, et le sens en clair - le compte
 * du fichier « envoie vers… » (jambe sortante : on demande le compte qui reçoit) ou « reçoit de… » (jambe
 * entrante : celui qui envoie), d'après le signe du montant, où la colonne « Sens » et le choix débit/crédit
 * sont déjà (cf. `jambeDuFichierLigne`). Le compte du fichier n'est jamais sur la molette.
 *
 * QUELLES LIGNES : tous les virements que l'import lira sans compte en face - ceux que la catégorie
 * « Virements internes » a faits (étape 2), et aussi ceux d'une règle ou d'un reclassement, que le même
 * blocage retient. Pas une ligne mal lue, refusée par la banque, déclarée comme un virement déjà en base, ni
 * une jambe reconnue (elle a son propre « Oui / Non »).
 *
 * L'APPLICATION DEVINE, ELLE NE CHOISIT PAS : le compte du dernier virement en base parti du même compte,
 * dans le même sens, sous le même libellé (`POST /import/comptes-en-face`), ou celui qu'on vient de confirmer
 * sur une carte de même libellé du fichier - en « Suggestion », en tête de la molette, à confirmer comme le
 * reste. L'encadré violet crée un compte sur place (`demanderCreationCompte`) : il rejoint chaque molette en
 * violet, et devient le choix de la carte courante, à confirmer.
 *
 * RIEN N'EST NEUF CÔTÉ SERVEUR À LA CONFIRMATION : les choix partent dans `comptes_en_face` (numéro de ligne
 * -> compte de l'autre jambe), que le serveur applique quand la retouche de la ligne n'en désigne pas un. À
 * l'écran, ils se reposent sur l'aperçu par `appliquerComptesEnFace` (aussi après une relecture qui garde les
 * choix), sans rien défaire de ce qui a été confirmé avant.
 */
// Numéro de ligne -> compte de l'autre jambe, CONFIRMÉ. Vidé à chaque nouvel aperçu (cf. executerPrevisualisation).
const importComptesEnFace = {};
// L'état des cartes du fichier : numéro de ligne -> { choix, manuel, propose }.
const virCartes = {};
// Les propositions du serveur, par numéro de ligne (cf. `virDemanderPropositions`).
const virPropositions = {};
// Les comptes créés dans la fenêtre pendant CE fichier : violets et en tête de chaque molette.
const virNouveaux = new Set();
let virLignes = [];
let virCourante = -1;
// La fenêtre a été ouverte par le parcours : la fermer rend la main à l'étape suivante (le contrôle).
let virChaine = false;

function virOuvert() {
  return document.getElementById("modale-virements-import").style.display !== "none";
}

/** Les virements que l'import lira et qui attendent - ou ont reçu dans cette fenêtre - leur compte en face. */
function lignesVirementsEnFace() {
  return lignesLuesParImport().filter(
    (l) =>
      typeOperationLigne(l) === "virement" &&
      !ligneMalLue(l) &&
      !ligneRefuseeParStatut(l) &&
      !ligneDeclareeVirementConnu(l) &&
      jambeDeLigne(l) == null &&
      (l.compte_id_autre == null || importComptesEnFace[l.ligne] != null)
  );
}

/** Pose les comptes en face confirmés sur les lignes de l'aperçu qui sont (encore) des virements. Une
 *  retouche de la ligne qui désigne elle-même l'autre compte garde la main, comme côté serveur. */
function appliquerComptesEnFace() {
  if (!importApercu) return;
  importApercu.lignes.forEach((ligne) => {
    const compteId = importComptesEnFace[ligne.ligne];
    if (compteId == null || typeOperationLigne(ligne) !== "virement") return;
    const retouche = importLigneOverrides[ligne.ligne];
    if (retouche && retouche.compte_id_autre != null) return;
    ligne.compte_id_autre = compteId;
  });
}

function virNormaliser(texte) {
  return String(texte || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/\s+/g, "")
    .toLowerCase();
}

function virLigne(n) {
  return (importApercu ? importApercu.lignes : []).find((l) => l.ligne === n) || null;
}

function virCarte(n) {
  if (!virCartes[n]) {
    const confirme = importComptesEnFace[n] ?? null;
    virCartes[n] = { choix: confirme, manuel: false, propose: null };
  }
  return virCartes[n];
}

function virConfirmee(n) {
  return importComptesEnFace[n] != null && importComptesEnFace[n] === virCarte(n).choix;
}

/** Les comptes de la molette : jamais celui du fichier. Les comptes créés ici d'abord (violets), puis la
 *  suggestion (jaune), puis les autres. */
function virOptions(n) {
  const ligne = virLigne(n);
  const carte = virCarte(n);
  const comptes = comptesProposables(carte.choix).filter((c) => !ligne || c.id !== ligne.compte_id);
  const nouveaux = comptes.filter((c) => virNouveaux.has(c.id) && c.id !== carte.propose);
  const propose = comptes.filter((c) => c.id === carte.propose);
  const autres = comptes.filter((c) => !virNouveaux.has(c.id) && c.id !== carte.propose);
  return [
    ...nouveaux.map((c) => ({ id: c.id, nom: c.nom, niveau: "nouvelle" })),
    ...propose.map((c) => ({ id: c.id, nom: c.nom, niveau: "suggestion" })),
    ...autres.map((c) => ({ id: c.id, nom: c.nom, niveau: "choix" })),
  ];
}

function virStatut(n) {
  const carte = virCarte(n);
  if (carte.choix != null && carte.choix === carte.propose) return { cle: "suggestions", texte: t("Suggestion") };
  if (carte.choix != null && (carte.manuel || virConfirmee(n))) return { cle: "choix", texte: t("Ton choix") };
  return { cle: "choix", texte: t("À classer") };
}

/** Le sens en clair : ce que fait le compte du fichier, et donc ce que la molette désigne. */
function virSensTexte(ligne) {
  const compte = ligne.compte_id != null ? nomCompte(ligne.compte_id) : ligne.nom_banque_compte || t("Ce relevé");
  const jambe = jambeDuFichierLigne(ligne);
  if (jambe === "sortante") return t("{compte} envoie vers…", { compte });
  if (jambe === "entrante") return t("{compte} reçoit de…", { compte });
  return t("Compte en face de {compte} :", { compte });
}

function virMontantHtml(ligne) {
  if (ligne.montant_signe != null) return formatMontant(ligne.montant_signe, ligne.monnaie_id);
  if (ligne.montant_envoye != null) return formatMontant(-Math.abs(ligne.montant_envoye), ligne.monnaie_envoyee_id);
  return ligne.montant != null ? formatMontant(ligne.montant, ligne.monnaie_id) : "";
}

function virCarteHtml(n, i) {
  const ligne = virLigne(n);
  const carte = virCarte(n);
  const options = virOptions(n);
  const statut = virStatut(n);
  const confirmee = virConfirmee(n);
  const roue = options.length
    ? options
        .map(
          (o) => `<div class="corr-roue-option corr-roue-${o.niveau} ${
            o.id === carte.choix ? "corr-roue-choisie" : ""
          }" role="option" data-id="${o.id}" aria-selected="${o.id === carte.choix}">${escapeHtml(o.nom)}</div>`
        )
        .join("")
    : `<div class="corr-roue-option corr-roue-vide" aria-disabled="true">${escapeHtml(t("Aucun compte pour l'instant"))}</div>`;
  return `
    <section class="corr-colonne vir-carte ${confirmee ? "corr-confirmee" : ""}" data-corr-i="${i}" tabindex="-1">
      <div>
        <div class="corr-banque" title="${escapeHtml(ligne.nature || "")}">${escapeHtml(ligne.nature || "—")}</div>
        <div class="vir-carte-ligne">
          <span class="hint">${ligne.date ? formatDateCourte(ligne.date) : ""}</span>
          <span class="corr-operation-montant">${virMontantHtml(ligne)}</span>
        </div>
        <div class="vir-sens">${escapeHtml(virSensTexte(ligne))}</div>
        <span class="corr-statut corr-statut-${statut.cle}" data-corr-statut>${escapeHtml(statut.texte)}</span>
      </div>
      <div class="corr-roue-cadre">
        <div class="corr-roue" role="listbox" tabindex="0"
             aria-label="${escapeHtml(virSensTexte(ligne))}">${roue}</div>
      </div>
      <button type="button" class="primary corr-confirmer" data-corr-confirmer="${i}" ${options.length ? "" : "disabled"}><span data-corr-libelle>${
        confirmee ? escapeHtml(t("Confirmée")) : escapeHtml(t("Confirmer"))
      }</span> <kbd data-corr-touche>(${escapeHtml(libelleCombo(toucheImport("confirmer")))})</kbd></button>
    </section>`;
}

function virColonne(i) {
  return document.querySelector(`#virements-import-board [data-corr-i="${i}"]`);
}

function virCentrerRoue(i, doux) {
  const colonne = virColonne(i);
  if (!colonne) return;
  const roue = colonne.querySelector(".corr-roue");
  const rang = Math.max(0, [...roue.children].findIndex((o) => o.classList.contains("corr-roue-choisie")));
  roue.scrollTo({ top: rang * CORR_HAUTEUR_OPTION, behavior: doux ? "smooth" : "auto" });
}

function virMajCompteur() {
  const restantes = virLignes.filter((n) => !virConfirmee(n)).length;
  document.getElementById("virements-import-compteur").textContent = restantes
    ? t("{n} virement(s) à confirmer", { n: restantes })
    : t("Tout est confirmé.");
  document.getElementById("btn-virements-import-suggestions").disabled = !virLignes.some(
    (n) => !virConfirmee(n) && virCarte(n).propose != null && virCarte(n).choix === virCarte(n).propose
  );
}

function renderVirementsImport() {
  const board = document.getElementById("virements-import-board");
  board.innerHTML = virLignes.map((n, i) => virCarteHtml(n, i)).join("");
  virLignes.forEach((n, i) => virCentrerRoue(i, false));
  if (virCourante >= 0) virColonne(virCourante)?.classList.add("corr-courante");
  virMajCompteur();
}

function virDefinirCourante(i, { focus = false } = {}) {
  virCourante = i;
  document
    .querySelectorAll("#virements-import-board .corr-colonne")
    .forEach((c) => c.classList.toggle("corr-courante", Number(c.dataset.corrI) === i));
  const colonne = virColonne(i);
  if (!colonne) return;
  colonne.scrollIntoView({ inline: "center", block: "nearest", behavior: "smooth" });
  if (focus) colonne.querySelector(".corr-roue").focus({ preventScroll: true });
}

function virMajCarte(i) {
  const n = virLignes[i];
  const colonne = virColonne(i);
  if (!colonne) return;
  const carte = virCarte(n);
  colonne.querySelectorAll(".corr-roue-option").forEach((o) => {
    const choisie = Number(o.dataset.id) === carte.choix;
    o.classList.toggle("corr-roue-choisie", choisie);
    o.setAttribute("aria-selected", String(choisie));
  });
  const statut = virStatut(n);
  const pastille = colonne.querySelector("[data-corr-statut]");
  pastille.className = `corr-statut corr-statut-${statut.cle}`;
  pastille.textContent = statut.texte;
  const confirmee = virConfirmee(n);
  colonne.classList.toggle("corr-confirmee", confirmee);
  colonne.querySelector("[data-corr-libelle]").textContent = confirmee ? t("Confirmée") : t("Confirmer");
}

/** Un autre compte sur la molette : la carte redemande une confirmation. */
function virChoisir(i, id, { defiler = true } = {}) {
  const n = virLignes[i];
  const compteId = Number(id);
  if (n == null || !Number.isFinite(compteId)) return;
  const carte = virCarte(n);
  if (compteId === carte.choix) return;
  carte.choix = compteId;
  carte.manuel = true;
  virRetirerConfirmation(n);
  virMajCarte(i);
  if (defiler) virCentrerRoue(i, true);
  virMajCompteur();
  document.getElementById("virements-import-erreur").style.display = "none";
}

function virRetirerConfirmation(n) {
  if (importComptesEnFace[n] == null) return;
  delete importComptesEnFace[n];
  const ligne = virLigne(n);
  const retouche = importLigneOverrides[n];
  if (ligne && !(retouche && retouche.compte_id_autre != null)) ligne.compte_id_autre = null;
}

/** Le compte confirmé sur une carte devient la SUGGESTION des cartes de même libellé, même compte et même
 *  sens qui n'ont encore rien : un virement mensuel s'écrit souvent pareil d'un mois à l'autre. */
function virProposerAuxSemblables(n) {
  const source = virLigne(n);
  if (!source) return;
  const cle = virNormaliser(source.nature);
  if (!cle) return;
  virLignes.forEach((m, k) => {
    if (m === n || virConfirmee(m)) return;
    const autre = virLigne(m);
    const carte = virCarte(m);
    if (!autre || carte.manuel || carte.propose != null) return;
    if (virNormaliser(autre.nature) !== cle || autre.compte_id !== source.compte_id) return;
    if (jambeDuFichierLigne(autre) !== jambeDuFichierLigne(source)) return;
    carte.propose = importComptesEnFace[n];
    carte.choix = carte.propose;
    const colonne = virColonne(k);
    if (colonne) {
      colonne.outerHTML = virCarteHtml(m, k);
      virCentrerRoue(k, false);
    }
  });
}

function virAppliquer() {
  appliquerComptesEnFace();
  renderImportApercu();
}

function virProchaineNonConfirmee(apres) {
  const suivante = virLignes.findIndex((n, k) => k > apres && !virConfirmee(n));
  return suivante !== -1 ? suivante : virLignes.findIndex((n) => !virConfirmee(n));
}

function virConfirmer(i) {
  if (i < 0 || i >= virLignes.length) return;
  const n = virLignes[i];
  const carte = virCarte(n);
  if (carte.choix == null) {
    // Rien de choisi : la ligne centrée de la molette est le choix (cf. brancherMolettes).
    const premiere = virOptions(n)[0];
    if (!premiere) return;
    carte.choix = premiere.id;
    carte.manuel = true;
  }
  importComptesEnFace[n] = carte.choix;
  virMajCarte(i);
  virProposerAuxSemblables(n);
  virAppliquer();
  virMajCompteur();
  if (virCourante >= 0) virColonne(virCourante)?.classList.add("corr-courante");
  const cible = virProchaineNonConfirmee(i);
  if (cible === -1) {
    fermerEtapeVirementsInternes();
    return;
  }
  virDefinirCourante(cible, { focus: true });
}

function virConfirmerSuggestions() {
  virLignes.forEach((n, i) => {
    const carte = virCarte(n);
    if (virConfirmee(n) || carte.propose == null || carte.choix !== carte.propose) return;
    importComptesEnFace[n] = carte.choix;
    virMajCarte(i);
  });
  virAppliquer();
  virMajCompteur();
  const premiere = virLignes.findIndex((n) => !virConfirmee(n));
  if (premiere === -1) fermerEtapeVirementsInternes();
  else virDefinirCourante(premiere, { focus: true });
}

/** « Valider les comptes » : chaque carte doit être confirmée - sinon, « Plus tard ». */
function validerEtapeVirementsInternes() {
  const premiere = virLignes.findIndex((n) => !virConfirmee(n));
  if (premiere !== -1) {
    const erreur = document.getElementById("virements-import-erreur");
    erreur.textContent = t("Choisis un compte pour chaque virement, ou reviens-y plus tard.");
    erreur.style.display = "";
    virDefinirCourante(premiere, { focus: true });
    return;
  }
  fermerEtapeVirementsInternes();
}

/** L'encadré violet : comme celui de l'étape 3, il ouvre la fenêtre de création d'un compte. */
function virCreerHtml() {
  return `<details class="corr-creer" data-vir-creer>
      <summary>${escapeHtml(t("Aucun compte ne correspond ? Crée le tien"))}</summary>
    </details>`;
}

async function virCreerCompte() {
  const courante = virCourante;
  const compte = await demanderCreationCompte();
  const encadre = document.querySelector("#virements-import-creer details");
  if (encadre) encadre.open = false;
  if (!compte) return;
  virNouveaux.add(compte.id);
  // Créé pour la carte courante : il en devient le choix - à confirmer.
  const n = virLignes[Math.max(0, courante)];
  if (n != null) {
    const carte = virCarte(n);
    carte.choix = compte.id;
    carte.manuel = true;
    virRetirerConfirmation(n);
  }
  renderVirementsImport();
  virDefinirCourante(Math.max(0, courante), { focus: true });
  updateImportCompteDefautVisibility();
}

/** Les suggestions du serveur, demandées à l'ouverture. Elles ne touchent ni une carte confirmée ni un choix
 *  fait à la main. Un échec ne dit rien : la fenêtre marche sans. */
async function virDemanderPropositions() {
  const demandes = virLignes
    .map(virLigne)
    .filter((l) => l && l.compte_id != null && virPropositions[l.ligne] === undefined)
    .map((l) => ({ ligne: l.ligne, compte_id: l.compte_id, nature: l.nature || "", jambe: jambeDuFichierLigne(l) }));
  if (!demandes.length) return;
  let propositions = {};
  try {
    propositions = (await apiFetch("/import/comptes-en-face", {
      method: "POST",
      body: JSON.stringify({ lignes: demandes }),
    })).propositions || {};
  } catch (err) {
    return;
  }
  demandes.forEach((d) => {
    virPropositions[d.ligne] = propositions[d.ligne] ?? propositions[String(d.ligne)] ?? null;
  });
  if (!virOuvert()) return;
  let change = false;
  virLignes.forEach((n) => {
    const carte = virCarte(n);
    const propose = virPropositions[n];
    if (propose == null || carte.manuel || virConfirmee(n)) return;
    carte.propose = propose;
    carte.choix = propose;
    change = true;
  });
  if (!change) return;
  const courante = virCourante;
  renderVirementsImport();
  virDefinirCourante(Math.max(0, courante), { focus: virOuvert() });
}

/** Ouvre la fenêtre (depuis le parcours, `chaine`, ou depuis le bouton de la page) ; rend vrai si elle s'est
 *  ouverte. */
function ouvrirVirementsImport({ chaine = false } = {}) {
  if (!importApercu || tutorielEnCours()) return false;
  virLignes = lignesVirementsEnFace().map((l) => l.ligne);
  if (!virLignes.length) return false;
  virChaine = chaine === true;
  importParcours.vues.add("virements");
  virLignes.forEach((n) => {
    const carte = virCarte(n);
    if (carte.propose == null && virPropositions[n] != null) carte.propose = virPropositions[n];
    if (carte.choix == null && carte.propose != null) carte.choix = carte.propose;
  });
  document.getElementById("virements-import-creer").innerHTML = virCreerHtml();
  document.getElementById("virements-import-erreur").style.display = "none";
  majAideFleches();
  majEtapesImport("modale-virements-import", "virements");
  virCourante = Math.max(0, virLignes.findIndex((n) => !virConfirmee(n)));
  renderVirementsImport();
  noterOuvertureFenetreImport("modale-virements-import");
  document.getElementById("modale-virements-import").style.display = "";
  document.body.classList.add("modale-ouverte");
  virDefinirCourante(virCourante, { focus: true });
  virDemanderPropositions();
  return true;
}

/** Fermée (validée, « Plus tard », la croix, Échap) : ouverte par le parcours, elle lui rend la main - le
 *  contrôle (étape 4). Les virements sans compte en face bloquent l'import comme avant. */
function fermerEtapeVirementsInternes() {
  document.getElementById("modale-virements-import").style.display = "none";
  document.body.classList.remove("modale-ouverte");
  virCourante = -1;
  if (importApercu) virAppliquer();
  majBoutonVirementsImport();
  const chaine = virChaine;
  virChaine = false;
  if (chaine) ouvrirSuiteImport();
}

/** Le bouton de la page qui rouvre la fenêtre, tant qu'un virement attend son compte en face. */
function majBoutonVirementsImport() {
  const bouton = document.getElementById("btn-import-virements-internes");
  if (!bouton) return;
  bouton.style.display =
    importApercu && lignesVirementsEnFace().some((l) => l.compte_id_autre == null) ? "" : "none";
}

/** Un nouvel aperçu (pas une relecture qui garde les choix) : tout ce que la fenêtre savait repart. */
function reinitialiserVirementsImport() {
  [importComptesEnFace, virCartes, virPropositions].forEach((objet) =>
    Object.keys(objet).forEach((k) => delete objet[k])
  );
  virNouveaux.clear();
  virLignes = [];
}

(function initVirementsImport() {
  document.getElementById("btn-virements-import-fermer").addEventListener("click", fermerEtapeVirementsInternes);
  document.getElementById("btn-virements-import-plus-tard").addEventListener("click", fermerEtapeVirementsInternes);
  document.getElementById("btn-virements-import-valider").addEventListener("click", validerEtapeVirementsInternes);
  document.getElementById("btn-virements-import-suggestions").addEventListener("click", virConfirmerSuggestions);
  document.getElementById("btn-import-virements-internes").addEventListener("click", () => ouvrirVirementsImport());
  document.getElementById("virements-import-creer").addEventListener("click", (e) => {
    if (!e.target.closest("[data-vir-creer] summary")) return;
    e.preventDefault();
    virCreerCompte();
  });
  brancherMolettes(document.getElementById("virements-import-board"), {
    courante: () => virCourante,
    definirCourante: virDefinirCourante,
    choisir: (i, id, options) => virChoisir(i, id, options),
    valeur: (i) => virCarte(virLignes[i]).choix,
    nombre: () => virLignes.length,
    confirmer: virConfirmer,
  });
  document.addEventListener("keydown", (e) => {
    if (!virOuvert() || toucheAvantOuverture(e, "modale-virements-import")) return;
    // Une fenêtre de création ouverte par-dessus garde ses touches.
    if (document.getElementById("modale-guide-compte").style.display !== "none") return;
    if (comboEvenementImport(e) === toucheImport("confirmer")) {
      e.preventDefault();
      virConfirmer(virCourante);
    } else if (e.key === "Escape") {
      fermerEtapeVirementsInternes();
    }
  });
})();

/**
 * LA DÉTECTION SE PROPOSE D'ELLE-MÊME quand la lecture actuelle ne donne
 * presque rien : plus de la moitié des lignes en erreur, c'est le signe d'un
 * preset qui n'a jamais vu ce format — et le moment où deviner rend service.
 */
function majSuggestionDetection() {
  const suggestion = document.getElementById("import-detection-suggestion");
  const lignes = (importApercu && importApercu.lignes) || [];
  // Des lignes MAL LUES, et non des questions sans réponse (cf. `ligneMalLue`).
  const enErreur = lignes.filter(ligneMalLue).length;
  const proposer = lignes.length > 0 && enErreur / lignes.length > 0.5 && !importDetection;
  suggestion.style.display = proposer ? "" : "none";
  document.getElementById("btn-import-detecter").classList.toggle("a-relire", proposer);
}

/* ----- La reconnaissance du preset (cf. services/reconnaissance_presets) -----
 *
 * À chaque fichier ouvert, TOUS les presets sont comparés à lui : leur lecture
 * du fichier, les intitulés qu'ils ont mémorisés, leur largeur, la forme du nom
 * de fichier. Le preset sélectionné reste celui qui lit l'aperçu, toujours :
 * quand un autre fait nettement mieux, l'écran le PROPOSE et ne bascule jamais
 * de lui-même. Les trois bandeaux possibles :
 *
 *   - basculer : un autre preset lit ce fichier, ou le reconnaît exactement ;
 *   - ecarts   : le preset sélectionné le lit, mais des intitulés ont changé ;
 *   - aucun    : aucun preset ne le lit — deviner les colonnes, dans un preset
 *                neuf plutôt que par-dessus celui d'une autre banque.
 */
async function reconnaitrePresetImport() {
  importReconnaissance = null;
  const formData = new FormData();
  formData.append("fichier", importFichierActuel);
  if (importPresetId != null) formData.append("preset_id", importPresetId);
  ajouterReglagesLecture(formData);
  try {
    importReconnaissance = await apiFetchForm("/import/reconnaitre-preset", formData);
  } catch (err) {
    // Une reconnaissance manquée n'empêche rien : l'aperçu se fait avec le
    // preset sélectionné, comme avant.
    importReconnaissance = null;
  }
  renderImportReconnaissance();
}

function nomPresetImport(id) {
  const preset = importPresets.find((p) => p.id === id);
  return preset ? preset.nom : "";
}

function ecartEnteteLisible(ecart) {
  if (!ecart.avant) {
    return t("Colonne n° {n} : nouvelle colonne « {maintenant} »", {
      n: ecart.index,
      maintenant: ecart.maintenant,
    });
  }
  if (!ecart.maintenant) {
    return t("Colonne n° {n} : « {avant} » a disparu", { n: ecart.index, avant: ecart.avant });
  }
  return t("Colonne n° {n} : « {avant} » devient « {maintenant} »", {
    n: ecart.index,
    avant: ecart.avant,
    maintenant: ecart.maintenant,
  });
}

/**
 * LE BANDEAU NE DIT PLUS QUE LES INTITULÉS CHANGÉS (« ecarts ») : un autre preset qui lit mieux le fichier,
 * ou aucun preset qui le lit, passent par LA PROPOSITION DE PRESET, posée avant toute fenêtre de l'import.
 */
function renderImportReconnaissance() {
  const bandeau = document.getElementById("import-reconnaissance");
  const r = importReconnaissance;
  if (!r || r.decision !== "ecarts" || !r.ecarts.length) {
    bandeau.style.display = "none";
    bandeau.innerHTML = "";
    return;
  }
  const texte = t(texteAide("noyau.reconnaissance-ecarts"));
  const detail = `<ul>${r.ecarts.map((e) => `<li>${escapeHtml(ecartEnteteLisible(e))}</li>`).join("")}</ul>`;
  const actions = `
      <button type="button" data-reconnaissance="retenir">${t("Retenir ces intitulés")}</button>
      <button type="button" data-reconnaissance="fermer">${t("Fermer")}</button>`;
  bandeau.className = `import-reconnaissance import-reconnaissance-${r.decision}`;
  bandeau.innerHTML = `
    <p>${escapeHtml(texte)}</p>
    ${detail}
    <div class="actions">${actions}</div>`;
  bandeau.style.display = "";
}

/**
 * Passe sur un autre preset SANS lâcher le fichier : sa configuration, ses
 * correspondances et son historique se chargent, puis le fichier est relu
 * avec lui. Changer de preset par ses pastilles, à l'inverse, repart de zéro.
 */
async function basculerPresetImport(presetId) {
  importPresetId = presetId;
  memoriserPresetActuel();
  renderImportPresetChips();
  importReconnaissance = null;
  renderImportReconnaissance();
  await loadImportConfiguration();
  await loadImportMappingsOverview();
  await loadImportHistorique();
  // Ce que le NOUVEAU preset dit du fichier : c'est sur lui que le parcours décide de l'étape 1.
  await reconnaitrePresetImport();
  await executerPrevisualisation();
}

async function memoriserSignatureImport() {
  const formData = new FormData();
  formData.append("fichier", importFichierActuel);
  if (importReglageDelimiteur) formData.append("delimiteur", importReglageDelimiteur);
  if (importFeuille) formData.append("feuille", importFeuille);
  try {
    await apiFetchForm(importUrl("/signature"), formData);
    return true;
  } catch (err) {
    // La configuration, elle, est enregistrée : une signature manquée se
    // rattrapera au prochain import.
    return false;
  }
}

/**
 * AUCUN PRESET NE LIT CE FICHIER : on lui en crée un, sans lâcher le fichier,
 * et on devine ses colonnes. Deviner par-dessus le preset sélectionné, puis
 * enregistrer, aurait écrasé le format d'une autre banque.
 */
async function creerPresetPourFichierImport() {
  const nom = prompt(t("Nom du nouveau preset (ex. nom de la banque) :"));
  // Laissé sans nom : rien n'est créé, la proposition (s'il y en a une) reste posée.
  if (!nom || !nom.trim()) return false;
  if (importParcours.proposition) terminerPropositionPreset();
  try {
    const preset = await apiFetch("/import/presets", {
      method: "POST",
      body: JSON.stringify({
        nom: nom.trim(),
        colonnes: COLONNES_PRESET_PAR_DEFAUT,
        colonnes_comparaison: [],
      }),
    });
    importPresets = await apiFetch("/import/presets");
    // Le parcours ouvre l'étape 1 sur ce preset neuf, qui n'a encore rien lu.
    importParcours.presetTraite = true;
    importParcours.forcerChamps = true;
    importDetectionProposee = false;
    await basculerPresetImport(preset.id);
    showMessage(
      t("Preset « {preset} » créé : vérifie les colonnes devinées, puis enregistre la configuration.", {
        preset: preset.nom,
      }),
      "success"
    );
    return true;
  } catch (err) {
    showMessage(err.message, "error");
    return false;
  }
}

/* ---------- LA PROPOSITION DE PRESET ----------
 *
 * À l'ouverture d'un fichier, TOUS les presets sont comparés à lui (cf. `reconnaitrePresetImport`). Quand le
 * preset sélectionné n'est pas le bon, l'application le dit AVANT D'OUVRIR TOUTE AUTRE FENÊTRE :
 *
 *   - un autre preset lit mieux ce fichier (« basculer ») : il est entouré dans la liste, et un pop-up demande
 *     « L'app lirait mieux ce fichier avec ce preset. Souhaites-tu changer ? » - Oui change de preset en
 *     gardant le fichier, Non garde celui-ci ;
 *   - aucun preset ne le lit (« aucun ») : c'est « + Nouveau preset » qui est entouré - Oui en crée un pour ce
 *     fichier, Non garde le preset sélectionné.
 *
 * LA LISTE DES PRESETS DESCEND alors entre le choix du fichier et « Le fichier tel qu'il est », et la page ne
 * montre rien d'autre (ni la configuration du fichier, ni les correspondances, ni l'aperçu : classe
 * `import-en-proposition`). Après la réponse, tout reprend sa place et le parcours continue - les étapes s'il y
 * a des ajustements, rien sinon. JAMAIS AU PREMIER IMPORT (le preset livré reçoit la configuration), ni
 * pendant un tutoriel. Une fois par fichier.
 */
function proposerPresetImport() {
  if (importParcours.presetTraite) return false;
  importParcours.presetTraite = true;
  if (tutorielEnCours() || premierImportBancaire() || !importFichierActuel) return false;
  const r = importReconnaissance;
  if (!r) return false;
  if (r.decision === "basculer" && r.propose) {
    afficherPropositionPreset({ type: "basculer", presetId: r.propose.preset_id, nom: r.propose.nom });
    return true;
  }
  if (r.decision === "aucun") {
    afficherPropositionPreset({ type: "aucun" });
    return true;
  }
  return false;
}

// Où la liste des presets se range quand la proposition est finie.
let propositionPresetPlace = null;

function afficherPropositionPreset(proposition) {
  importParcours.proposition = proposition;
  const bloc = document.getElementById("import-presets-bloc");
  const zone = document.getElementById("import-proposition-preset");
  if (!propositionPresetPlace) {
    propositionPresetPlace = document.createComment("place de la liste des presets");
    bloc.parentNode.insertBefore(propositionPresetPlace, bloc);
  }
  zone.appendChild(bloc);
  zone.style.display = "";
  document.getElementById("sous-section-parametres-import").classList.add("import-en-proposition");
  renderImportPresetChips();
  const cible =
    proposition.type === "basculer"
      ? document.querySelector(`#import-preset-chips button[data-preset-id="${proposition.presetId}"]`)
      : document.getElementById("btn-import-preset-creer");
  document.getElementById("btn-import-preset-creer").classList.toggle("preset-propose", proposition.type === "aucun");
  const texte =
    proposition.type === "basculer"
      ? t(texteAide("noyau.import-preset-propose"))
      : t(texteAide("noyau.import-preset-aucun"));
  const bulle = document.createElement("div");
  bulle.id = "import-proposition-bulle";
  bulle.className = "import-proposition-bulle";
  bulle.setAttribute("role", "dialog");
  bulle.setAttribute("aria-live", "polite");
  bulle.innerHTML = `<p>${escapeHtml(texte)}</p>
    <div class="actions">
      <button type="button" class="primary" data-proposition="oui">${escapeHtml(t("Oui"))}</button>
      <button type="button" data-proposition="non">${escapeHtml(t("Non"))}</button>
    </div>`;
  bloc.querySelector(".preset-panel").appendChild(bulle);
  placerBullePropositionPreset(cible);
  zone.scrollIntoView({ behavior: "smooth", block: "start" });
  bulle.querySelector("[data-proposition='oui']").focus({ preventScroll: true });
}

/** Le pop-up se pose sous ce qu'il désigne, sa pointe en face. */
function placerBullePropositionPreset(cible) {
  const bulle = document.getElementById("import-proposition-bulle");
  if (!bulle || !cible) return;
  const panneau = bulle.parentElement.getBoundingClientRect();
  const rect = cible.getBoundingClientRect();
  const gauche = Math.max(0, Math.min(rect.left - panneau.left, panneau.width - bulle.offsetWidth));
  bulle.style.left = `${gauche}px`;
  bulle.style.top = `${rect.bottom - panneau.top + 10}px`;
  bulle.style.setProperty("--pointe", `${Math.max(12, rect.left - panneau.left - gauche + rect.width / 2 - 7)}px`);
}

function terminerPropositionPreset() {
  importParcours.proposition = null;
  const bulle = document.getElementById("import-proposition-bulle");
  if (bulle) bulle.remove();
  document.querySelectorAll(".preset-propose").forEach((b) => b.classList.remove("preset-propose"));
  const bloc = document.getElementById("import-presets-bloc");
  if (propositionPresetPlace && propositionPresetPlace.parentNode) {
    propositionPresetPlace.parentNode.insertBefore(bloc, propositionPresetPlace);
  }
  document.getElementById("import-proposition-preset").style.display = "none";
  document.getElementById("sous-section-parametres-import").classList.remove("import-en-proposition");
}

async function repondrePropositionPreset(oui) {
  const proposition = importParcours.proposition;
  if (!proposition) return;
  if (!oui) {
    terminerPropositionPreset();
    await ouvrirSuiteImport();
    return;
  }
  if (proposition.type === "aucun") {
    await creerPresetPourFichierImport();
    return;
  }
  terminerPropositionPreset();
  await basculerPresetImport(proposition.presetId);
  showMessage(t("Preset « {preset} » sélectionné, fichier relu.", { preset: proposition.nom }), "success");
}

document.getElementById("import-proposition-preset").addEventListener("click", (e) => {
  const bouton = e.target.closest("[data-proposition]");
  if (bouton) repondrePropositionPreset(bouton.dataset.proposition === "oui");
});

window.addEventListener("resize", () => {
  const p = importParcours.proposition;
  if (!p) return;
  placerBullePropositionPreset(
    p.type === "basculer"
      ? document.querySelector(`#import-preset-chips button[data-preset-id="${p.presetId}"]`)
      : document.getElementById("btn-import-preset-creer")
  );
});

document.getElementById("import-reconnaissance").addEventListener("click", async (e) => {
  const bouton = e.target.closest("[data-reconnaissance]");
  if (!bouton || !importReconnaissance) return;
  const action = bouton.dataset.reconnaissance;
  if (action === "retenir") {
    if (await memoriserSignatureImport()) {
      importReconnaissance = null;
      renderImportReconnaissance();
      showMessage(t("Intitulés retenus pour ce preset."), "success");
    }
  } else if (action === "fermer") {
    importReconnaissance = null;
    renderImportReconnaissance();
    majSuggestionDetection();
  }
});

document.getElementById("btn-import-apercu-relire").innerHTML = ICONE_RELIRE;
// CE BOUTON ENREGISTRE AVANT DE RELIRE, et c'est ce qui le rend fiable : la
// relecture ne transmettait que les COLONNES, et lisait tout le reste du preset
// tel qu'il est enregistré. Un réglage modifié sans être enregistré — le nombre
// de lignes de tête, le mode de comparaison, un vocabulaire — était donc ignoré,
// et l'aperçu revenait décrire l'ancienne configuration sans rien dire. Le
// geste qu'on faisait alors (corriger, relire, ne rien voir changer) n'avait
// aucune issue.
//
// Un ordre de colonnes obtenu en glissant trois en-têtes est du même coup GARDÉ
// dans le preset, là où il fallait penser à « Enregistrer la configuration »
// pour ne pas le perdre au fichier suivant.
document.getElementById("btn-import-apercu-relire").addEventListener("click", async () => {
  if (!importFichierActuel) {
    showMessage(t("Aucun fichier chargé à relire."), "error");
    return;
  }
  lireReglagesLecture();
  await enregistrerConfigurationImport({
    relireToujours: true,
    message: t("Configuration enregistrée, fichier relu."),
  });
});

/**
 * LE CONTRÔLE AVANT IMPORT, calculé avec l'aperçu (cf. services/
 * controle_import) : combien de lignes, combien rejetées et pourquoi, quelle
 * période, combien sort et combien entre — et surtout, quand le relevé porte un
 * solde, si les montants tels que la configuration les lit le retrouvent. Un
 * écart y désigne une erreur de lecture que l'aperçu ligne à ligne ne montre
 * pas : le bouton ramène à la configuration, et la relecture refait le contrôle.
 */
function renderImportControle() {
  const bloc = document.getElementById("import-controle");
  const c = importApercu && importApercu.controle;
  if (!c) {
    bloc.style.display = "none";
    bloc.innerHTML = "";
    return;
  }
  const euros = (centimes) => formatMontant(centimes / 100);
  const chiffre = (libelle, valeur) =>
    `<div class="import-controle-chiffre"><span>${escapeHtml(libelle)}</span><strong>${escapeHtml(
      String(valeur)
    )}</strong></div>`;
  const periode =
    c.date_debut && c.date_fin
      ? t("du {debut} au {fin}", { debut: formatDate(c.date_debut), fin: formatDate(c.date_fin) })
      : "—";
  const listeLignes = (lignes, total) =>
    lignes.join(", ") + (total > lignes.length ? "…" : "");

  const motifs = c.motifs_rejet.length
    ? `<ul class="import-controle-liste">${c.motifs_rejet
        .map(
          (m) =>
            `<li>${escapeHtml(
              t("{motif} : {n} ligne(s) — lignes {lignes}", {
                motif: m.motif,
                n: m.nombre,
                lignes: listeLignes(m.lignes, m.nombre),
              })
            )}</li>`
        )
        .join("")}</ul>`
    : "";

  let solde = "";
  const s = c.controle_solde;
  if (s && s.statut === "ok") {
    solde = `<p class="import-controle-ok">${escapeHtml(
      t(texteAide("noyau.controle-solde-ok"), {
        colonne: s.colonne,
        taux: Math.round(s.taux * 100),
        intervalles: s.intervalles,
      })
    )}</p>`;
  } else if (s) {
    solde = `<div class="import-avertissement">
        <p>${escapeHtml(
          t(texteAide("noyau.controle-solde-ecart"), { colonne: s.colonne, nombre: s.nombre_ecarts })
        )}</p>
        <ul class="import-controle-liste">${s.ecarts
          .map(
            (e) =>
              `<li>${escapeHtml(
                t("Lignes {debut} à {fin} : le solde varie de {variation}, les montants lus font {lus}.", {
                  debut: e.ligne_debut,
                  fin: e.ligne_fin,
                  variation: euros(e.variation_du_solde),
                  lus: euros(e.montants_lus),
                })
              )}</li>`
          )
          .join("")}</ul>
        <button type="button" data-controle="configuration">${t("Revoir la configuration")}</button>
      </div>`;
  }

  const a = c.anomalies;
  const anomalies = [
    a.nombre_dates_hors_plage
      ? t("Dates hors plage : lignes {lignes}", {
          lignes: listeLignes(a.dates_hors_plage, a.nombre_dates_hors_plage),
        })
      : "",
    a.nombre_montants_aberrants
      ? t("Montants inhabituellement élevés : lignes {lignes}", {
          lignes: listeLignes(a.montants_aberrants, a.nombre_montants_aberrants),
        })
      : "",
    a.lignes_vides ? t("{n} ligne(s) vide(s) au milieu des opérations", { n: a.lignes_vides }) : "",
  ].filter(Boolean);

  // LE GRAPHE DU PARCOURS, quand il s'est posé ici (cf. `finirParcoursImport`) : l'étape 4, ou « Importer ».
  const graphe =
    importParcours.etapeFinale && !tutorielEnCours()
      ? `<div class="import-etapes">${etapesImportHtml(importParcours.etapeFinale)}</div>`
      : "";
  bloc.innerHTML = `${graphe}
    <div class="import-controle-titre">${t("Contrôle avant import")}<i class="info-bulle" tabindex="0" data-info="${escapeHtml(
      t(texteAide("noyau.controle-avant-import"))
    )}">i</i></div>
    <div class="import-controle-chiffres">
      ${chiffre(t("Lignes lues"), c.lignes_lues)}
      ${chiffre(t("Rejetées"), c.lignes_rejetees)}
      ${chiffre(t("Doublons"), c.doublons)}
      ${chiffre(t("Période"), periode)}
      ${chiffre(t("Débits"), euros(c.total_debits))}
      ${chiffre(t("Crédits"), euros(c.total_credits))}
      ${chiffre(t("Solde net"), euros(c.solde_net))}
    </div>
    ${motifs}
    ${solde}
    ${
      anomalies.length
        ? `<ul class="import-controle-liste import-controle-anomalies">${anomalies
            .map((x) => `<li>${escapeHtml(x)}</li>`)
            .join("")}</ul>`
        : ""
    }`;
  bloc.style.display = "";
}

document.getElementById("import-controle").addEventListener("click", (e) => {
  if (!e.target.closest("[data-controle='configuration']")) return;
  const configuration = document.getElementById("import-config-fichier");
  configuration.open = true;
  configuration.scrollIntoView({ behavior: "smooth", block: "start" });
});

// Ce que la configuration laisse d'ambigu sans être faux (montant envoyé ou frais
// lus sans leur devise) : signalé une fois, au-dessus de l'aperçu. Jamais
// bloquant — contrairement à une erreur de ligne, il n'y a rien de faux ici,
// seulement une hypothèse que l'utilisateur doit connaître.
function renderImportAvertissements() {
  const bloc = document.getElementById("import-avertissements");
  const messages = (importApercu && importApercu.avertissements) || [];
  bloc.style.display = messages.length > 0 ? "" : "none";
  bloc.innerHTML = messages
    .map((message) => `<p class="import-avertissement">${escapeHtml(message)}</p>`)
    .join("");
}

// La signature des demandes affichées : renderImportApercu ne reconstruit les
// menus de correspondance que si elle change (cocher un doublon, supprimer une
// ligne), jamais à chaque choix — le menu qu'on vient d'utiliser garderait sinon
// le focus perdu sous le curseur.
let importMappingsSignature = null;

function signatureDemandesMapping() {
  const d = demandesDeMapping();
  return JSON.stringify([d.categories, d.comptes, d.monnaies]);
}

// Redessine les demandes de correspondance si, et seulement si, elles ont changé.
function rafraichirDemandesMapping() {
  if (importApercu && signatureDemandesMapping() !== importMappingsSignature) renderImportMappings();
}

function renderImportMappings() {
  const blocGeneral = document.getElementById("import-mappings-bloc");
  const demandes = demandesDeMapping();
  importMappingsSignature = signatureDemandesMapping();
  const monnaiesInconnues = demandes.monnaies;
  const aDesInconnus =
    demandes.categories.length > 0 || demandes.comptes.length > 0 || monnaiesInconnues.length > 0;
  blocGeneral.style.display = aDesInconnus ? "" : "none";

  const catBloc = document.getElementById("import-mappings-categories");
  catBloc.innerHTML = "";
  const ciblesOptions = ciblesEligiblesImport();
  // Le compte d'où sort le fichier en cours : celui du preset s'il y est lié,
  // sinon celui choisi pour cet import. Affiché à côté de chaque libellé du
  // relevé, pour ne pas mapper au jugé un nom que l'autre banque emploie aussi.
  // Aucun des deux (le fichier nomme lui-même le compte de chaque ligne) : rien
  // n'est affiché, il n'y a pas UN compte à nommer.
  const compteDuReleve = compteDuPresetImport() ?? (compteIdDefautChoisi() ? Number(compteIdDefautChoisi()) : null);
  const provenance = compteDuReleve != null ? nomCompte(compteDuReleve) : null;
  demandes.categories.forEach((nomBanque) => {
    // Une ligne lue d'abord : la suggestion d'un doublon ignoré n'a rien à dire.
    const ligneAssociee =
      lignesLuesParImport().find((l) => l.nom_banque_categorie === nomBanque) ||
      importApercu.lignes.find((l) => l.nom_banque_categorie === nomBanque);
    const suggestion = ligneAssociee ? ligneAssociee.categorie_id : null;
    // Un choix déjà fait l'emporte sur la suggestion : ce bloc est reconstruit
    // à chaque retour sur la page (cf. loadImportSection), et repartir de la
    // suggestion effacerait des correspondances confirmées entre-temps.
    const valeur = importMappingCategories[nomBanque] ?? suggestion;
    importMappingCategories[nomBanque] = valeur;
    catBloc.appendChild(
      creerLigneMapping(nomBanque, ciblesOptions, importMappingCategories, () => {
        appliquerMappingsLocalement();
        renderImportApercu();
      }, {
        avecConfirmation: true,
        valeurInitiale: valeur,
        libelleHtml: libelleCategorieBanqueHtml(nomBanque, provenance),
      })
    );
  });

  const compteBloc = document.getElementById("import-mappings-comptes");
  compteBloc.innerHTML = "";
  demandes.comptes.forEach((nomBanque) => {
    const ligne = creerLigneMapping(nomBanque, comptesProposables(), importMappingComptes, () => {
      appliquerMappingsLocalement();
      renderImportApercu();
    });
    ajouterOptionCreer(ligne.querySelector("select"), "compte", CREER_COMPTE_A_CORRESPONDRE);
    compteBloc.appendChild(ligne);
  });

  // Devises qu'aucune correspondance mémorisée n'a permis de rattacher (cf.
  // _resoudre_monnaie côté serveur) : rien à afficher pour un preset sans
  // colonne de devise.
  document.getElementById("import-mappings-monnaies-bloc").style.display =
    monnaiesInconnues.length > 0 ? "" : "none";
  const monnaieBloc = document.getElementById("import-mappings-monnaies");
  monnaieBloc.innerHTML = "";
  monnaiesInconnues.forEach((nomBanque) => {
    // Une monnaie éteinte n'est pas une cible : elle se lit (liste, cours) et
    // rien d'autre — le serveur ignore d'ailleurs un choix qui la désignerait.
    const ligne = creerLigneMapping(nomBanque, state.monnaies.filter((m) => m.active !== false), importMappingMonnaies, () => {
      appliquerMappingsLocalement();
      renderImportApercu();
    });
    if (choixDeMonnaiePossible()) {
      ajouterOptionCreer(ligne.querySelector("select"), "monnaie", CREER_MONNAIE_A_CORRESPONDRE);
    }
    monnaieBloc.appendChild(ligne);
  });

  renderImportMonnaiesResolues();
}

/** « + Créer un compte » dans « Comptes bancaires à faire correspondre » (cf. ajouterOptionCreer) : le compte
 *  créé rejoint TOUTES les listes du bloc, et devient le choix de celle d'où on l'a demandé. */
const CREER_COMPTE_A_CORRESPONDRE = {
  demander: () => demanderCreationCompte(),
  remplir: () => {
    document.querySelectorAll("#import-mappings-comptes select").forEach((select) => {
      _refillPreservingSelection(select, (el) => {
        el.replaceChildren(
          new Option(t("— choisir —"), ""),
          ...comptesProposables().map((c) => new Option(c.nom, c.id))
        );
        ajouterOptionCreer(el, "compte", CREER_COMPTE_A_CORRESPONDRE);
      });
    });
  },
};

/** « + Créer une monnaie » dans « Devises à faire correspondre » : même chose que pour les comptes. */
const CREER_MONNAIE_A_CORRESPONDRE = {
  demander: () => demanderCreationMonnaie(),
  remplir: () => {
    document.querySelectorAll("#import-mappings-monnaies select").forEach((select) => {
      _refillPreservingSelection(select, (el) => {
        el.replaceChildren(
          new Option(t("— choisir —"), ""),
          ...state.monnaies.filter((m) => m.active !== false).map((m) => new Option(m.nom, m.id))
        );
        ajouterOptionCreer(el, "monnaie", CREER_MONNAIE_A_CORRESPONDRE);
      });
    });
  },
};

/**
 * Les devises déjà rattachées par une correspondance mémorisée, en lecture
 * seule : ce que l'aperçu ne redemande pas, mais qu'on veut pouvoir relire
 * avant de confirmer. Rien n'est jamais rattaché autrement — un libellé qui
 * ressemble à une monnaie de l'app reste à mapper à la main (cf.
 * _resoudre_monnaie côté serveur).
 */
function renderImportMonnaiesResolues() {
  const bloc = document.getElementById("import-monnaies-resolues-bloc");
  const resolues = Object.entries((importApercu && importApercu.monnaies_resolues) || {});
  bloc.style.display = resolues.length > 0 ? "" : "none";
  document.getElementById("import-monnaies-resolues").innerHTML = resolues
    .sort(([a], [b]) => a.localeCompare(b))
    .map(
      ([nomBanque, nomMonnaie]) => `
        <div class="import-mapping-row import-mapping-lecture-seule">
          <span class="import-mapping-nom">${escapeHtml(nomBanque)}</span>
          <span class="import-mapping-cible">→ ${escapeHtml(nomMonnaie)}</span>
        </div>`
    )
    .join("");
}

// Confirme d'un coup toutes les catégories suggérées. Coche directement les
// cases du DOM plutôt que de rappeler renderImportMappings() : cette
// dernière re-sème importMappingCategories depuis les suggestions
// automatiques, ce qui écraserait les choix de select déjà faits à la main.
document.getElementById("btn-import-mappings-tout-confirmer").addEventListener("click", () => {
  if (!importApercu) return;
  demandesDeMapping().categories.forEach((nomBanque) =>
    importCategoriesConfirmees.add(nomBanque)
  );
  document
    .querySelectorAll("#import-mappings-categories input[type='checkbox']")
    .forEach((checkbox) => {
      checkbox.checked = true;
    });
  appliquerMappingsLocalement();
  renderImportApercu();
});

// `libelleHtml` n'est que l'affichage : `nomBanque` reste la clé envoyée au
// serveur, sinon le « (Courant) » ajouté pour l'œil partirait dans la
// correspondance mémorisée.
function creerLigneMapping(nomBanque, options, dictionnaireCible, onChange, { avecConfirmation = false, valeurInitiale = null, libelleHtml = null } = {}) {
  const row = document.createElement("div");
  row.className = "import-mapping-row";

  const label = document.createElement("span");
  label.className = "import-mapping-nom";
  if (libelleHtml) label.innerHTML = libelleHtml;
  else label.textContent = nomBanque;

  const select = document.createElement("select");
  select.innerHTML =
    (avecConfirmation ? "" : '<option value="">— choisir —</option>') +
    options.map((o) => `<option value="${o.id}">${o.nom}</option>`).join("");
  if (avecConfirmation && valeurInitiale) select.value = String(valeurInitiale);
  select.addEventListener("change", () => {
    dictionnaireCible[nomBanque] = select.value ? Number(select.value) : null;
    // Un changement de valeur redemande une confirmation explicite.
    if (avecConfirmation) {
      importCategoriesConfirmees.delete(nomBanque);
      const checkbox = row.querySelector("input[type='checkbox']");
      if (checkbox) checkbox.checked = false;
    }
    onChange();
  });

  row.appendChild(label);
  row.appendChild(select);

  if (avecConfirmation) {
    const confirmLabel = document.createElement("label");
    confirmLabel.className = "import-mapping-confirmer";
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    // Restaurée depuis l'état mémorisé : le bloc est reconstruit à chaque
    // retour sur la page, une case décochée d'office redemanderait un travail
    // déjà fait.
    checkbox.checked = importCategoriesConfirmees.has(nomBanque);
    checkbox.addEventListener("change", () => {
      if (checkbox.checked) importCategoriesConfirmees.add(nomBanque);
      else importCategoriesConfirmees.delete(nomBanque);
      onChange();
    });
    confirmLabel.appendChild(checkbox);
    confirmLabel.appendChild(document.createTextNode(" Confirmer"));
    row.appendChild(confirmLabel);
  }

  return row;
}

// Une fois qu'un mapping est choisi dans un menu, on met à jour l'aperçu tout
// de suite (sans rappeler le serveur) pour un retour visuel immédiat.
function appliquerMappingsLocalement() {
  importApercu.lignes.forEach((ligne) => {
    // Une ligne déjà modifiée manuellement (bouton "Modifier") garde la
    // priorité : un mapping de nom bancaire ne doit pas écraser un choix
    // explicite fait ligne par ligne.
    if (importLigneOverrides[ligne.ligne]) return;
    const categorieId = importMappingCategories[ligne.nom_banque_categorie];
    const vi = categorieVirements();
    if (ligne.nom_banque_categorie && categorieId && vi && categorieId === vi.id) {
      // LA CATÉGORIE DES VIREMENTS INTERNES FAIT LE TYPE (migration 0090, même arbitrage que
      // import_bancaire._resoudre_ligne) : la ligne devient un virement, qui attend son compte en
      // face. Seulement sur une ligne d'un type à catégorie libre : un virement le reste, et un
      // prêt ou un remboursement n'ont pas de catégorie à recevoir.
      if (TYPES_CATEGORIE_LIBRE.has(typeOperationLigne(ligne))) {
        ligne.type_code = "virement";
        ligne.virement_par_categorie = true;
      }
      if (typeOperationLigne(ligne) === "virement") {
        ligne.categorie_id = vi.id;
        ligne.jambe_du_fichier = jambeDuFichierLigne(ligne);
      }
    } else if (ligne.nom_banque_categorie && categorieId) {
      // Une ligne que la catégorie avait faite virement redevient une opération classique dès
      // qu'on lui en choisit une autre.
      if (ligne.virement_par_categorie && typeOperationLigne(ligne) === "virement") {
        ligne.type_code = "classique";
        ligne.virement_par_categorie = false;
        ligne.compte_id_autre = null;
        ligne.jambe_du_fichier = null;
      }
      // Même arbitrage que le serveur (cf. import_bancaire._resoudre_ligne) :
      // une correspondance ne renseigne que la catégorie, et seulement pour les
      // types qui en admettent une. Le type reste celui posé par la règle.
      ligne.categorie_id = TYPES_CATEGORIE_LIBRE.has(typeOperationLigne(ligne))
        ? categorieId
        : typeOperationLigne(ligne) === "virement" && vi
          ? vi.id
          : null;
    }
    if (ligne.compte_id === null && importMappingComptes[ligne.nom_banque_compte]) {
      ligne.compte_id = importMappingComptes[ligne.nom_banque_compte];
    }
    // Les trois colonnes de devise puisent dans le même stock de
    // correspondances : un relevé écrit « EUR » de la même façon qu'il
    // qualifie le montant envoyé, reçu ou les frais (même règle que
    // _resoudre_monnaie côté serveur).
    CHAMPS_MONNAIE_LIGNE.forEach(([champNom, champId]) => {
      if (ligne[champId] == null && importMappingMonnaies[ligne[champNom]]) {
        ligne[champId] = importMappingMonnaies[ligne[champNom]];
      }
    });
  });
  // Les comptes en face confirmés à l'étape 3bis, sur les lignes qui sont (encore) des virements.
  appliquerComptesEnFace();
}


/* ---------- LE TABLEAU DES CORRESPONDANCES (pop-up de l'import) ----------
 *
 * LA QUESTION qu'on se pose devant « Alimentation et restauration » : lesquelles de mes
 * opérations sont concernées ? Les lignes de correspondance de la page n'en montraient aucune. Ce
 * pop-up pose UNE COLONNE par catégorie de la banque — plusieurs à l'écran, défilant à
 * l'horizontale — avec les opérations qu'elle rassemble, la catégorie de l'app proposée par le
 * serveur (cf. services/categorisation_intelligente) et un bouton « Confirmer ».
 *
 * LE CHOIX SE FAIT À LA MOLETTE, comme les minutes d'un minuteur de téléphone : une liste verticale
 * qui accroche sa ligne au centre, cinq lignes visibles, les propositions en tête. ↑ / ↓ la
 * déplacent, Ctrl+Entrée confirme la colonne COURANTE (celle qui a le focus, cernée) et passe à la
 * suivante. Le clic sur le bouton fait la même chose.
 *
 * RIEN N'EST NEUF CÔTÉ ÉTAT : confirmer écrit dans `importMappingCategories` et
 * `importCategoriesConfirmees`, exactement ce que faisaient les lignes de la page — c'est
 * l'import confirmé qui écrit ensuite dans la table des correspondances (palier 1). JAMAIS
 * d'application silencieuse : même une proposition forte attend son clic.
 */
const CORR_HAUTEUR_OPTION = 30;
let corrNoms = [];
let corrCourante = -1;
// Les catégories créées depuis l'encadré « Crée la tienne » pendant CE fichier : elles s'affichent en
// violet et en tête de la molette de chaque carte, sans jamais devenir la proposition de personne.
const corrNouvelles = new Set();
// Le tableau a été ouvert par le parcours (cf. `ouvrirSuiteImport`) : le fermer proprement rend la main à
// l'étape suivante, le compte. Ouvert à la main depuis la page, il ne chaîne rien.
let corrChaine = false;

function corrOuvert() {
  return document.getElementById("modale-correspondances").style.display !== "none";
}

function corrValeur(nom) {
  if (importMappingCategories[nom] != null) return importMappingCategories[nom];
  const ligne = importApercu.lignes.find((l) => l.nom_banque_categorie === nom);
  return ligne ? ligne.categorie_id : null;
}

function corrPropositions(nom) {
  return (importApercu.propositions_categories || {})[nom] || { statut: "a_classer", propositions: [] };
}

/** Les options de la molette, dans l'ordre de ce que l'app en pense : la proposition FORTE, puis les
 *  SUGGESTIONS (dans l'ordre du serveur, du plus proche au moins proche), puis « ton choix » : la
 *  catégorie déjà choisie hors propositions, et le reste. `niveau` colore le nom (bleu, jaune). */
function corrOptions(nom) {
  const { statut, propositions } = corrPropositions(nom);
  const ids = new Set(propositions.map((p) => p.categorie_id));
  const proposees = propositions
    .map((p, rang) => {
      const c = state.categories.find((x) => x.id === p.categorie_id);
      if (!c) return null;
      const niveau = rang === 0 && statut === "forte" ? "forte" : "suggestion";
      return { id: c.id, nom: c.nom, niveau };
    })
    .filter(Boolean);
  const choisie = corrValeur(nom);
  const disponibles = categoriesProposables(choisie);
  // LES CATÉGORIES QU'ON VIENT DE CRÉER passent devant tout le reste, en violet, sur chaque carte : à un
  // cran de la proposition, jamais à sa place - qui n'en veut pas pour cette carte n'a rien à écarter.
  // (Une catégorie créée que le serveur propose déjà reste une proposition.)
  const nouvelles = disponibles
    .filter((c) => corrNouvelles.has(c.id) && !ids.has(c.id))
    .map((c) => ({ id: c.id, nom: c.nom, niveau: "nouvelle" }));
  const autres = disponibles
    .filter((c) => !ids.has(c.id) && !corrNouvelles.has(c.id))
    .map((c) => ({ id: c.id, nom: c.nom, niveau: "choix" }))
    // La catégorie déjà choisie ouvre « Ton choix » : sans proposition, c'est elle qu'on voit en haut.
    .sort((a, b) => (b.id === choisie) - (a.id === choisie));
  return [...nouvelles, ...proposees, ...autres];
}

// Les colonnes dont la catégorie a été choisie À LA MAIN dans ce fichier : le tableau ne les remet
// pas sur la meilleure proposition en s'ouvrant. Vidé avec les autres choix à chaque nouvel aperçu.
const corrChoixManuels = new Set();

/** À l'ouverture, chaque colonne non confirmée repart de sa MEILLEURE PROPOSITION (en haut de la
 *  molette), sauf si l'on a déjà choisi autre chose. Rien n'est confirmé pour autant. */
function corrRepartirDuHaut() {
  corrNoms.forEach((nom) => {
    if (corrChoixManuels.has(nom) || importCategoriesConfirmees.has(nom)) return;
    if (!corrPropositions(nom).propositions.length) return;
    // La proposition de l'app, jamais une catégorie créée en route (violette, en tête de molette).
    const premiere = corrOptions(nom).find((o) => o.niveau === "forte" || o.niveau === "suggestion");
    if (premiere) importMappingCategories[nom] = premiere.id;
  });
}

/** Le libellé de l'état d'une colonne : de quoi sait-on que cette catégorie est la bonne ? */
function corrStatut(nom) {
  const { statut, propositions } = corrPropositions(nom);
  const choisie = corrValeur(nom);
  if (propositions.length && choisie === propositions[0].categorie_id) {
    if (statut === "forte") return { cle: "forte", texte: t("Proposition forte") };
    if (statut === "suggestions") return { cle: "suggestions", texte: t("Suggestion") };
  }
  if (propositions.some((p) => p.categorie_id === choisie)) {
    return { cle: "suggestions", texte: t("Suggestion") };
  }
  return { cle: "choix", texte: statut === "a_classer" && !propositions.length ? t("À classer") : t("Ton choix") };
}

function corrColonne(i) {
  return document.querySelector(`#correspondances-board [data-corr-i="${i}"]`);
}

function corrOperationsHtml(nom) {
  const lignes = lignesLuesParImport().filter((l) => l.nom_banque_categorie === nom);
  const visibles = lignes.slice(0, 60);
  const html = visibles
    .map((l) => {
      const montant = l.montant_signe != null ? l.montant_signe : l.montant;
      return `<div class="corr-operation">
        <div>
          <div class="corr-operation-nature" title="${escapeHtml(l.nature || "")}">${escapeHtml(l.nature || "—")}</div>
          <div class="corr-operation-date">${l.date ? formatDateCourte(l.date) : ""}</div>
        </div>
        <div class="corr-operation-montant">${montant != null ? formatMontant(montant, l.monnaie_id) : ""}</div>
      </div>`;
    })
    .join("");
  const reste = lignes.length - visibles.length;
  return (
    html +
    (reste > 0 ? `<p class="hint">${escapeHtml(t("… et {n} autres opérations", { n: reste }))}</p>` : "")
  );
}

/* ---------- CRÉER LA CATÉGORIE QUI MANQUE, DEPUIS LA COLONNE ----------
 *
 * Quand aucune des catégories de l'application ne convient à celle de la banque, la molette n'a plus
 * rien à offrir - et l'utilisateur d'une base neuve, qui n'en a que deux ou trois, s'y trouve dès le
 * premier relevé. Un encadré violet en pointillés, sous la molette, le dit et déplie de quoi la créer
 * sur place : un nom, la case « Entrées d'argent » (elle ne s'oublie pas : une entrée classée comme une
 * dépense gonfle les sorties), et un bouton.
 *
 * UN SEUL ENCADRÉ, AU-DESSUS DE TOUTES LES CARTES, AU CENTRE : posé sur chaque carte, il se répétait autant
 * de fois qu'il y a de catégories de la banque. La catégorie créée n'est le choix de PERSONNE : elle rejoint
 * la molette de chaque carte, en violet et en tête de liste (`corrNouvelles`, cf. `corrOptions`), à un cran
 * de la proposition de l'app - qui reste celle qu'elle était. Qui veut la nouvelle sur la carte courante la
 * choisit d'un cran ; qui n'en veut pas ne l'écarte pas à chaque carte suivante. */
function corrCreerCentralHtml() {
  return `
      <details class="corr-creer" data-corr-creer>
        <summary>${escapeHtml(t("Aucune catégorie ne correspond ? Crée la tienne"))}</summary>
        <div class="corr-creer-corps">
          <input type="text" maxlength="60" data-corr-creer-nom
                 aria-label="${escapeHtml(t("Nom de la catégorie"))}"
                 placeholder="${escapeHtml(t("Nom de la catégorie"))}" />
          <label class="creation-categorie-entree">
            <input type="checkbox" data-corr-creer-entree />
            <span>${escapeHtml(t("Entrées d'argent"))}<i class="info-bulle" tabindex="0"
              data-info="${escapeHtml(t(texteAide("noyau.categorie-entree")))}">i</i></span>
          </label>
          <button type="button" class="primary" data-corr-creer-valider>${escapeHtml(
            t("Créer la catégorie")
          )}</button>
          <p class="import-avertissement" data-corr-creer-erreur style="display:none"></p>
        </div>
      </details>`;
}

/** L'encadré est posé UNE fois à l'ouverture et survit aux redessins du tableau (ce qu'on y a saisi ne se perd pas). */
function corrPoserCreerCentral() {
  const zone = document.getElementById("correspondances-creer");
  if (!zone.firstElementChild) zone.innerHTML = corrCreerCentralHtml();
}

async function corrCreerCategorie() {
  const zone = document.getElementById("correspondances-creer");
  const champ = zone.querySelector("[data-corr-creer-nom]");
  const entree = zone.querySelector("[data-corr-creer-entree]");
  const erreur = zone.querySelector("[data-corr-creer-erreur]");
  const nom = champ.value.trim();
  erreur.style.display = "none";
  if (!nom) {
    erreur.textContent = t("Donne un nom à la catégorie.");
    erreur.style.display = "";
    champ.focus();
    return;
  }
  try {
    const categorie = await creerCategorieEtDrapeau(nom, entree.checked);
    corrNouvelles.add(categorie.id);
    champ.value = "";
    entree.checked = false;
    zone.querySelector("details[data-corr-creer]").open = false;
    // Le tableau se redessine, la carte courante reste la courante : sa molette montre la nouvelle en tête.
    const courante = corrCourante;
    renderCorrespondances();
    corrDefinirCourante(Math.max(0, courante), { focus: true });
    showMessage(t("Catégorie créée"), "success");
  } catch (err) {
    erreur.textContent = traduireMessageServeur(err.message);
    erreur.style.display = "";
  }
}

function corrColonneHtml(nom, i) {
  const options = corrOptions(nom);
  const choisie = corrValeur(nom);
  const statut = corrStatut(nom);
  const confirmee = importCategoriesConfirmees.has(nom);
  const nombre = lignesLuesParImport().filter((l) => l.nom_banque_categorie === nom).length;
  return `
    <section class="corr-colonne ${confirmee ? "corr-confirmee" : ""}" data-corr-i="${i}" tabindex="-1">
      <div>
        <div class="corr-banque">${escapeHtml(nom)}</div>
        <div class="hint">${escapeHtml(t("{n} opération(s)", { n: nombre }))}</div>
        <span class="corr-statut corr-statut-${statut.cle}" data-corr-statut>${escapeHtml(statut.texte)}</span>
      </div>
      <div class="corr-roue-cadre">
        <div class="corr-roue" role="listbox" tabindex="0"
             aria-label="${escapeHtml(t("Catégorie de l'app pour « {nom} »", { nom }))}">
          ${options
            .map(
              (o) => `<div class="corr-roue-option corr-roue-${o.niveau} ${
                o.id === choisie ? "corr-roue-choisie" : ""
              }" role="option" data-id="${o.id}" aria-selected="${o.id === choisie}">${escapeHtml(
                libelleCategorie(o.nom)
              )}</div>`
            )
            .join("")}
        </div>
      </div>
      <div class="corr-operations">${corrOperationsHtml(nom)}</div>
      <button type="button" class="primary corr-confirmer" data-corr-confirmer="${i}"><span data-corr-libelle>${
        confirmee ? escapeHtml(t("Confirmée")) : escapeHtml(t("Confirmer"))
      }</span> <kbd data-corr-touche>(${escapeHtml(libelleCombo(toucheImport("confirmer")))})</kbd></button>
    </section>`;
}

/** Une proposition forte non encore confirmée, et toujours le choix de la colonne. */
function corrFortePrete(nom) {
  const { statut, propositions } = corrPropositions(nom);
  return (
    statut === "forte" &&
    propositions.length > 0 &&
    corrValeur(nom) === propositions[0].categorie_id &&
    !importCategoriesConfirmees.has(nom)
  );
}

function corrMajCompteur() {
  const restantes = corrNoms.filter((nom) => !importCategoriesConfirmees.has(nom)).length;
  document.getElementById("correspondances-compteur").textContent = restantes
    ? t("{n} catégorie(s) à confirmer", { n: restantes })
    : t("Tout est confirmé.");
  document.getElementById("btn-correspondances-fortes").disabled = !corrNoms.some((nom) =>
    corrFortePrete(nom)
  );
}

function corrMajBouton(i) {
  const colonne = corrColonne(i);
  if (!colonne) return;
  const confirmee = importCategoriesConfirmees.has(corrNoms[i]);
  colonne.classList.toggle("corr-confirmee", confirmee);
  colonne.querySelector("[data-corr-libelle]").textContent = confirmee ? t("Confirmée") : t("Confirmer");
}

/** La touche affichée sur chaque bouton « Confirmer » suit le réglage. */
function corrMajBoutonsConfirmer() {
  const libelle = `(${libelleCombo(toucheImport("confirmer"))})`;
  document.querySelectorAll("#correspondances-board [data-corr-touche], #detection-board [data-corr-touche]").forEach((k) => {
    k.textContent = libelle;
  });
}

function renderCorrespondances() {
  corrNoms = demandesDeMapping().categories;
  corrRepartirDuHaut();
  const board = document.getElementById("correspondances-board");
  board.innerHTML = corrNoms.map((nom, i) => corrColonneHtml(nom, i)).join("");
  corrNoms.forEach((nom, i) => corrCentrerRoue(i, false));
  corrMajCompteur();
}

function corrCentrerRoue(i, doux) {
  const colonne = corrColonne(i);
  if (!colonne) return;
  const roue = colonne.querySelector(".corr-roue");
  const options = [...roue.children];
  const rang = Math.max(0, options.findIndex((o) => o.classList.contains("corr-roue-choisie")));
  roue.scrollTo({ top: rang * CORR_HAUTEUR_OPTION, behavior: doux ? "smooth" : "auto" });
}

function corrDefinirCourante(i, { focus = false } = {}) {
  corrCourante = i;
  document
    .querySelectorAll("#correspondances-board .corr-colonne")
    .forEach((c) => c.classList.toggle("corr-courante", Number(c.dataset.corrI) === i));
  const colonne = corrColonne(i);
  if (!colonne) return;
  colonne.scrollIntoView({ inline: "center", block: "nearest", behavior: "smooth" });
  if (focus) colonne.querySelector(".corr-roue").focus({ preventScroll: true });
}

/** Choisit une catégorie pour la colonne `i` : redemande une confirmation. */
function corrChoisir(i, categorieId, { defiler = true } = {}) {
  const nom = corrNoms[i];
  importMappingCategories[nom] = categorieId;
  corrChoixManuels.add(nom);
  importCategoriesConfirmees.delete(nom);
  const colonne = corrColonne(i);
  if (!colonne) return;
  colonne.querySelectorAll(".corr-roue-option").forEach((o) => {
    const choisie = Number(o.dataset.id) === categorieId;
    o.classList.toggle("corr-roue-choisie", choisie);
    o.setAttribute("aria-selected", String(choisie));
  });
  const statut = corrStatut(nom);
  const pastille = colonne.querySelector("[data-corr-statut]");
  pastille.className = `corr-statut corr-statut-${statut.cle}`;
  pastille.textContent = statut.texte;
  corrMajBouton(i);
  if (defiler) corrCentrerRoue(i, true);
  corrMajCompteur();
}

function corrAppliquer() {
  appliquerMappingsLocalement();
  renderImportMappings();
  renderImportApercu();
  // Une catégorie rattachée à « Virements internes » (ou détachée) décide si l'étape 3bis aura lieu.
  if (corrOuvert()) majEtapesImport("modale-correspondances", "categories");
}

function corrProchaineNonConfirmee(apres) {
  const suivante = corrNoms.findIndex((n, k) => k > apres && !importCategoriesConfirmees.has(n));
  return suivante !== -1 ? suivante : corrNoms.findIndex((n) => !importCategoriesConfirmees.has(n));
}

function corrConfirmer(i) {
  if (i < 0 || i >= corrNoms.length) return;
  const nom = corrNoms[i];
  const choisie = corrValeur(nom);
  if (!choisie) return;
  importMappingCategories[nom] = choisie;
  importCategoriesConfirmees.add(nom);
  corrMajBouton(i);
  corrAppliquer();
  corrMajCompteur();
  const cible = corrProchaineNonConfirmee(i);
  if (cible === -1) {
    showMessage(t("Toutes les correspondances sont confirmées."), "success");
    fermerCorrespondances({ suite: true });
    return;
  }
  corrDefinirCourante(cible, { focus: true });
}

function corrConfirmerFortes() {
  corrNoms.forEach((nom, i) => {
    if (!corrFortePrete(nom)) return;
    importCategoriesConfirmees.add(nom);
    corrMajBouton(i);
  });
  corrAppliquer();
  corrMajCompteur();
  const premiere = corrNoms.findIndex((n) => !importCategoriesConfirmees.has(n));
  if (premiere === -1) {
    showMessage(t("Toutes les correspondances sont confirmées."), "success");
    fermerCorrespondances({ suite: true });
  } else {
    corrDefinirCourante(premiere, { focus: true });
  }
}

/** La ligne d'aide des deux tableaux : on y navigue aux flèches (celles que les réglages donnent), pas
 *  seulement à la souris. Réécrite à chaque ouverture : les touches se règlent dans Paramètres généraux. */
function majAideFleches() {
  const texte = t(texteAide("noyau.import-fleches"), {
    monter: libelleCombo(toucheImport("haut")),
    descendre: libelleCombo(toucheImport("bas")),
  });
  document.querySelectorAll(".corr-aide-fleches").forEach((p) => {
    p.textContent = texte;
  });
}

/** `chaine` : ouvert par le parcours de l'import (cf. `ouvrirSuiteImport`) - le fermer en l'ayant TERMINÉ
 *  (tout confirmé, « Terminer ») ouvre l'étape suivante, le compte. Depuis le bouton de la page, rien
 *  ne s'enchaîne. */
function ouvrirCorrespondances({ chaine = false } = {}) {
  if (!importApercu || !demandesDeMapping().categories.length) return;
  corrChaine = chaine === true;
  importParcours.vues.add("categories");
  // Les menus de la page sèment `importMappingCategories` depuis les propositions du serveur.
  renderImportMappings();
  corrPoserCreerCentral();
  renderCorrespondances();
  majAideFleches();
  majEtapesImport("modale-correspondances", "categories");
  document.getElementById("modale-correspondances").style.display = "";
  document.body.classList.add("modale-ouverte");
  const premiere = Math.max(0, corrNoms.findIndex((n) => !importCategoriesConfirmees.has(n)));
  corrDefinirCourante(premiere, { focus: true });
}

/** `suite` : le tableau est TERMINÉ (et non abandonné par la croix ou Échap) ; s'il a été ouvert par le
 *  parcours de l'import, l'étape suivante s'ouvre - le choix du compte. */
function fermerCorrespondances({ suite = false } = {}) {
  document.getElementById("modale-correspondances").style.display = "none";
  document.body.classList.remove("modale-ouverte");
  corrCourante = -1;
  if (importApercu) corrAppliquer();
  const chaine = corrChaine;
  corrChaine = false;
  if (suite === true && chaine) ouvrirSuiteImport();
}

/** Le rang de l'option permise la plus proche de `rang` en allant dans le sens `sens` (+1 vers le bas,
 *  -1 vers le haut), puis dans l'autre si rien ne s'y trouve ; -1 quand toutes sont écartées. */
function rangSelectionnable(ids, rang, sens, ecartee) {
  for (const s of [sens, -sens]) {
    for (let k = rang; k >= 0 && k < ids.length; k += s) if (!ecartee(ids[k])) return k;
  }
  return -1;
}

/**
 * Câble un tableau à molettes (clic, focus, défilement, touches). COMMUN AU TABLEAU DES
 * CORRESPONDANCES ET À CELUI DES COLONNES DU FICHIER : c'est ce qui en fait la même interface.
 *
 * `h` : { courante(), definirCourante(i, {focus}), choisir(i, id, {defiler}), valeur(i), nombre(),
 * confirmer(i) } - les identifiants d'option sont des textes (`data-id`), à chacun de les lire.
 * Facultatifs : `annuler(i)` (la croix qui défait une confirmation) et `exclue(i, id)` (une option
 * barrée, que les flèches sautent ; le clic et la molette sont renvoyés par `choisir`).
 */
function brancherMolettes(board, h) {
  board.addEventListener("click", (e) => {
    const bouton = e.target.closest("[data-corr-confirmer]");
    if (bouton) {
      h.confirmer(Number(bouton.dataset.corrConfirmer));
      return;
    }
    const croix = e.target.closest("[data-corr-annuler]");
    if (croix) {
      if (h.annuler && !croix.disabled) h.annuler(Number(croix.dataset.corrAnnuler));
      return;
    }
    const option = e.target.closest(".corr-roue-option");
    if (option) {
      const i = Number(option.closest("[data-corr-i]").dataset.corrI);
      h.definirCourante(i);
      h.choisir(i, option.dataset.id);
    }
  });

  // Entrer dans une colonne (clic, Tab) la rend courante : c'est elle que la touche de confirmation valide.
  board.addEventListener("focusin", (e) => {
    const colonne = e.target.closest("[data-corr-i]");
    if (colonne && Number(colonne.dataset.corrI) !== h.courante()) {
      h.definirCourante(Number(colonne.dataset.corrI));
    }
  });
  board.addEventListener("mousedown", (e) => {
    const colonne = e.target.closest("[data-corr-i]");
    if (colonne) h.definirCourante(Number(colonne.dataset.corrI));
  });

  // La molette se pose où l'on s'arrête : le défilement fini, la ligne centrée est le choix. Les
  // événements `scroll` ne remontent pas, d'où la phase de capture.
  board.addEventListener(
    "scroll",
    (e) => {
      const roue = e.target;
      if (!roue.classList || !roue.classList.contains("corr-roue")) return;
      clearTimeout(roue._corrMinuteur);
      roue._corrMinuteur = setTimeout(() => {
        if (roue._corrAuto) return;
        // LA FENÊTRE S'EST FERMÉE ENTRE-TEMPS (la dernière carte confirmée la ferme) : une molette cachée lit
        // un défilement nul, et sa « première ligne » remplacerait le choix qu'on vient de confirmer.
        if (!roue.getClientRects().length) return;
        const options = [...roue.children];
        const rang = Math.min(
          options.length - 1,
          Math.max(0, Math.round(roue.scrollTop / CORR_HAUTEUR_OPTION))
        );
        const i = Number(roue.closest("[data-corr-i]").dataset.corrI);
        const id = options[rang].dataset.id;
        if (id !== String(h.valeur(i))) h.choisir(i, id, { defiler: false });
      }, 90);
    },
    true
  );

  // Les touches « monter » / « descendre » (↑ / ↓ par défaut, cf. TOUCHES_IMPORT) déplacent la molette
  // de la colonne ; ← / → passent d'une colonne à l'autre.
  board.addEventListener("keydown", (e) => {
    const roue = e.target.closest(".corr-roue");
    if (!roue) return;
    const combo = comboEvenementImport(e);
    const i = Number(roue.closest("[data-corr-i]").dataset.corrI);
    const options = [...roue.children];
    const rang = Math.max(0, options.findIndex((o) => o.classList.contains("corr-roue-choisie")));
    const exclue = (k) => Boolean(h.exclue && h.exclue(i, options[k].dataset.id));
    // La première option permise depuis `depart` dans le sens donné, ou le rang courant s'il n'y en a pas.
    const permise = (depart, sens) => {
      for (let k = depart; k >= 0 && k < options.length; k += sens) if (!exclue(k)) return k;
      return rang;
    };
    let nouveau = null;
    if (combo === toucheImport("bas")) nouveau = permise(rang + 1, 1);
    else if (combo === toucheImport("haut")) nouveau = permise(rang - 1, -1);
    else if (combo === "home") nouveau = permise(0, 1);
    else if (combo === "end") nouveau = permise(options.length - 1, -1);
    if (nouveau !== null) {
      e.preventDefault();
      if (nouveau !== rang) h.choisir(i, options[nouveau].dataset.id);
      return;
    }
    if (combo === "arrowleft" || combo === "arrowright") {
      const voisine = i + (combo === "arrowright" ? 1 : -1);
      if (voisine >= 0 && voisine < h.nombre()) {
        e.preventDefault();
        h.definirCourante(voisine, { focus: true });
      }
    }
  });
}

(function initCorrespondances() {
  document.getElementById("btn-import-correspondances").addEventListener("click", ouvrirCorrespondances);
  document.getElementById("btn-correspondances-fermer").addEventListener("click", fermerCorrespondances);
  document
    .getElementById("btn-correspondances-terminer")
    .addEventListener("click", () => fermerCorrespondances({ suite: true }));
  document.getElementById("btn-correspondances-fortes").addEventListener("click", corrConfirmerFortes);

  brancherMolettes(document.getElementById("correspondances-board"), {
    courante: () => corrCourante,
    definirCourante: corrDefinirCourante,
    choisir: (i, id, options) => corrChoisir(i, Number(id), options),
    valeur: (i) => corrValeur(corrNoms[i]),
    nombre: () => corrNoms.length,
    confirmer: corrConfirmer,
  });

  // L'ENCADRÉ « CRÉER LA TIENNE » (un seul, au-dessus des cartes) : un clic sur son bouton crée ; ouvrir le
  // repli met le curseur dans le nom.
  const encadre = document.getElementById("correspondances-creer");
  encadre.addEventListener("click", (e) => {
    if (e.target.closest("[data-corr-creer-valider]")) corrCreerCategorie();
  });
  encadre.addEventListener(
    "toggle",
    (e) => {
      if (e.target.matches && e.target.matches("details[data-corr-creer]") && e.target.open) {
        e.target.querySelector("[data-corr-creer-nom]").focus();
      }
    },
    true
  );
  // Dans l'encadré, les touches du tableau n'ont rien à faire : Entrée (ou la touche de confirmation) crée,
  // Échap replie l'encadré SANS fermer le tableau.
  encadre.addEventListener("keydown", (e) => {
    const zone = e.target.closest && e.target.closest("[data-corr-creer]");
    if (!zone) return;
    const combo = comboEvenementImport(e);
    if (e.key === "Escape") {
      zone.open = false;
      e.stopPropagation();
    } else if (e.key === "Enter" || combo === toucheImport("confirmer")) {
      e.preventDefault();
      e.stopPropagation();
      corrCreerCategorie();
    } else {
      e.stopPropagation();
    }
  });

  document.addEventListener("keydown", (e) => {
    if (!corrOuvert()) return;
    if (comboEvenementImport(e) === toucheImport("confirmer")) {
      e.preventDefault();
      corrConfirmer(corrCourante);
    } else if (e.key === "Escape") {
      fermerCorrespondances();
    }
  });
})();

// (libellé lu dans le fichier, monnaie résolue) pour les trois colonnes de
// devise d'une ligne — miroir de _CHAMPS_MONNAIE côté serveur.
const CHAMPS_MONNAIE_LIGNE = [
  ["nom_banque_monnaie", "monnaie_id"],
  ["nom_banque_monnaie_envoyee", "monnaie_envoyee_id"],
  ["nom_banque_monnaie_frais", "monnaie_frais_id"],
];

// Les 6 types d'opération de la page Opérations (mêmes clés que data-type
// dans #operation-type-boutons, et mêmes `code` que la table type_operation) :
// une ligne importée peut être reclassée dans n'importe lequel via "Modifier".
// "classique" et "remboursable" partagent le même bassin de catégories
// (categorieLibre) ; les 4 autres n'en portent aucune — leur type EST leur
// classification — donc jamais de sélecteur de catégorie pour eux.
// `reglement` : ces deux catégories règlent une dépense/prêt déjà existant
// (checklist de liaison, cf. creerLigneApercuEdition) — elles ne passent
// jamais par la confirmation d'import principale (voir
// updateBtnImportConfirmerEtat / btn-import-confirmer) mais se créent une par
// une, directement via l'endpoint /operations habituel, une fois la dépense
// ou le prêt qu'elles règlent réellement présent en base (donc en général
// après le premier confirm groupé).
const TYPES_OPERATION_IMPORT = [
  { cle: "classique", categorieLibre: true },
  { cle: "remboursable", categorieLibre: true },
  { cle: "remboursements", categorieLibre: false, reglement: true },
  { cle: "virement", categorieLibre: false, virement: true },
  { cle: "pret", categorieLibre: false },
  { cle: "remboursement_pret", categorieLibre: false, reglement: true },
];

// Le libellé vient de la table (renommable), la clé reste le code technique.
function labelTypeImport(infoType) {
  return libelleTypeOperation(infoType.cle);
}

// Le type d'une ligne d'aperçu est porté par la ligne elle-même
// (ImportLigne.type_code) : posé par une règle de catégorisation ou par un
// reclassement manuel, plus jamais dérivé de la catégorie.
function typeOperationLigne(ligne) {
  return ligne.type_code || "classique";
}

// Le signe du montant bancaire d'origine détermine si le compte connu de la
// ligne (ligne.compte_id, déduit du fichier) est émetteur (négatif) ou
// récepteur (positif ou nul). `emetteurActif` indique quel côté correspond
// réellement à ligne.compte_id — indépendant du type actuellement
// affiché/choisi à l'édition. L'autre côté (ligne.compte_id_autre) vient d'un
// complément manuel de l'utilisateur (cf. creerLigneApercuEdition) ; tant
// qu'il n'est pas renseigné il reste "-".
/** La jambe d'un virement que le relevé décrit : « sortante », « entrante » ou null. MIROIR de
 *  services/import_bancaire.jambe_du_fichier (migration 0090) : le signe du montant d'abord (la
 *  colonne « Sens » et le choix débit/crédit y sont déjà), à défaut un montant envoyé seul. */
function jambeDuFichierLigne(ligne) {
  if (ligne.montant_signe != null && ligne.montant_signe !== 0) {
    return ligne.montant_signe < 0 ? "sortante" : "entrante";
  }
  if (ligne.montant_signe == null && ligne.montant_envoye != null) return "sortante";
  return null;
}

function rolesCompteVirement(ligne) {
  const nomConnu = ligne.compte_id !== null ? nomCompte(ligne.compte_id) : ligne.nom_banque_compte || "-";
  const nomAutre =
    ligne.compte_id_autre !== null && ligne.compte_id_autre !== undefined ? nomCompte(ligne.compte_id_autre) : "-";
  const emetteur = jambeDuFichierLigne(ligne) === "sortante";
  return {
    emetteurHtml: emetteur ? nomConnu : nomAutre,
    recepteurHtml: emetteur ? nomAutre : nomConnu,
    emetteurActif: emetteur,
  };
}

/**
 * Quel montant fait l'opération, et ce que les frais lui font.
 *
 * MIROIR de services/import_bancaire._appliquer_frais, qui reste la référence :
 * c'est lui qui décide de ce qui est écrit en base. Celui-ci n'existe que pour
 * que l'aperçu montre le bon montant DÈS que l'utilisateur change le type ou le
 * sens d'une ligne, sans aller-retour serveur. Les deux doivent dire la même
 * chose ; en cas de doute, c'est le serveur qui a raison.
 *
 * La règle générale : des frais font toujours perdre de la valeur. Le reste est
 * le choix du montant auquel les appliquer — voir la docstring côté serveur.
 */
function calculerMontantsLigne({
  montantHorsFrais,
  montantEnvoyeHorsFrais,
  frais,
  monnaieId,
  monnaieEnvoyeeId,
  monnaieFraisId,
  devisefraisRenseignee,
  sortante,
  estVirement,
  liteLaMonnaie,
}) {
  const f = frais ? Math.abs(frais) : 0;
  const abs = (v) => (v == null ? null : Math.abs(v));
  const inchange = {
    montant: abs(montantHorsFrais),
    montantEnvoye: abs(montantEnvoyeHorsFrais),
    monnaieOperationId: monnaieId,
  };

  // Devise annoncée mais pas rattachée : on ne touche à rien.
  if (f && devisefraisRenseignee && monnaieFraisId == null) return inchange;
  const deviseConnue = !!f && devisefraisRenseignee && monnaieFraisId != null;
  // Une devise inconnue d'un côté ou de l'autre ne CONTREDIT pas : seule une
  // différence avérée bloque.
  const concorde = (autre) => !deviseConnue || autre == null || monnaieFraisId === autre;
  const grever = (montant, sort) => {
    if (montant == null) return { valeur: null, erreur: null };
    const magnitude = sort ? Math.abs(montant) + f : Math.abs(montant) - f;
    if (f && magnitude <= 0) {
      return { valeur: null, erreur: "frais supérieurs au montant de la ligne" };
    }
    return { valeur: magnitude, erreur: null };
  };
  const incoherent = () => ({ ...inchange, montant: null, montantEnvoye: null, incoherents: true });

  if (montantEnvoyeHorsFrais == null) {
    if (!concorde(monnaieId)) {
      // Un virement n'a qu'une jambe décrite ici : les frais appartiennent à
      // celle qui manque, on les laisse en attente plutôt que de bloquer.
      return estVirement ? inchange : incoherent();
    }
    const { valeur, erreur } = grever(montantHorsFrais, sortante);
    // Reclasser une ligne EN virement l'oriente comme le serveur l'aurait fait
    // à la lecture : sur une sortie, le montant du relevé est ce qui PART (cf.
    // _orienter_jambe_virement). Sans ce miroir, l'aperçu montrerait le débit
    // du côté « reçu » jusqu'à la confirmation, puis en changerait tout seul.
    if (estVirement && sortante && !liteLaMonnaie) {
      return { montant: null, montantEnvoye: valeur, monnaieOperationId: monnaieId, erreur };
    }
    return { montant: valeur, montantEnvoye: null, monnaieOperationId: monnaieId, erreur };
  }

  if (estVirement) {
    let surLemission;
    if (deviseConnue && monnaieEnvoyeeId != null) surLemission = monnaieFraisId === monnaieEnvoyeeId;
    else if (deviseConnue && monnaieId != null) surLemission = monnaieFraisId !== monnaieId;
    else surLemission = true;
    if (surLemission) {
      if (!concorde(monnaieEnvoyeeId)) return incoherent();
      return {
        montant: abs(montantHorsFrais),
        montantEnvoye: Math.abs(montantEnvoyeHorsFrais) + f,
        monnaieOperationId: monnaieId,
      };
    }
    if (!concorde(monnaieId)) return incoherent();
    const { valeur, erreur } = grever(montantHorsFrais, false);
    return {
      montant: valeur,
      montantEnvoye: Math.abs(montantEnvoyeHorsFrais),
      monnaieOperationId: monnaieId,
      erreur,
    };
  }

  if (sortante) {
    if (!concorde(monnaieEnvoyeeId)) return incoherent();
    const { valeur, erreur } = grever(montantEnvoyeHorsFrais, true);
    return {
      montant: valeur,
      montantEnvoye: null,
      monnaieOperationId: monnaieEnvoyeeId ?? monnaieId,
      erreur,
    };
  }
  if (!concorde(monnaieId)) return incoherent();
  const { valeur, erreur } = grever(montantHorsFrais, false);
  return { montant: valeur, montantEnvoye: null, monnaieOperationId: monnaieId, erreur };
}

/**
 * La monnaie d'une ligne d'aperçu QUAND LE RELEVÉ N'EN LIT AUCUNE : la
 * principale de son compte — exactement celle que l'import écrira (cf.
 * import_bancaire.confirmer, qui retombe sur `monnaie_principale_id`).
 *
 * SANS CE REPLI, la ligne arrivait sans monnaie et `formatMontant` prenait la
 * PREMIÈRE monnaie de l'application : un relevé en euros s'affichait en
 * dollars dès que le dollar était la première monnaie créée, alors que
 * l'import, lui, écrivait bien des euros.
 */
function monnaieParDefautLigne(ligne) {
  const monnaies = ligne.compte_id != null ? monnaiesDuCompte(ligne.compte_id) : [];
  return monnaies.length ? monnaies[0].monnaie_id : null;
}

// Contenu de la colonne "Montant" : ce qui part quand le relevé le dit, puis ce
// qui arrive, sa devise, et le sens quand le fichier le déclare à part.
function montantLigneApercuHtml(ligne) {
  const monnaieDefaut = monnaieParDefautLigne(ligne);
  // UNE DEVISE LUE MAIS PAS ENCORE MAPPÉE S'AFFICHE SANS DEVISE. Le badge
  // « devise à mapper » dit déjà ce qui manque ; lui accoler en plus une monnaie
  // de repli affirmerait une devise que personne n'a choisie.
  const nonMappee = (champNom, champId) => !!ligne[champNom] && ligne[champId] == null;
  // `monnaie_operation_id` et non `monnaie_id` : sur une sortie à un seul
  // compte, c'est le montant ENVOYÉ qui fait l'opération, dans sa monnaie.
  const monnaieOperation = nonMappee("nom_banque_monnaie", "monnaie_id") && ligne.monnaie_operation_id == null
    ? SANS_MONNAIE
    : ligne.monnaie_operation_id ?? ligne.monnaie_id ?? monnaieDefaut;
  const monnaieEnvoyeeLigne = nonMappee("nom_banque_monnaie_envoyee", "monnaie_envoyee_id")
    ? SANS_MONNAIE
    : ligne.monnaie_envoyee_id ??
      (nonMappee("nom_banque_monnaie", "monnaie_id") ? SANS_MONNAIE : ligne.monnaie_id ?? monnaieDefaut);
  // Un virement sortant lu sans colonne de devise ne porte QUE ce qui part :
  // ce qui arrive reste inconnu tant que l'utilisateur ne l'a pas dit (l'app
  // ne convertit rien). La colonne montre alors le seul montant connu.
  const seuleJambeEmettrice = ligne.montant == null && ligne.montant_envoye != null;
  if (ligne.montant == null && !seuleJambeEmettrice) return "-";

  // Ce qui part / ce qui arrive, quand le relevé décrit les DEUX.
  //
  // Un virement interne les porte tels quels (montant_envoye = la jambe
  // émettrice). Une opération à un seul compte, non : une seule des deux jambes
  // fait l'écriture — le sens dit laquelle — et l'autre est effacée de
  // `montant_envoye` par _appliquer_frais, qui n'a pas à l'importer. Elle
  // survit dans les valeurs hors frais, et c'est de là qu'on la relit : un
  // paiement par carte à l'étranger n'a aucune raison de n'afficher qu'une de
  // ses deux devises sous prétexte qu'une seule sera écrite en base.
  let montantEnvoye = ligne.montant_envoye;
  let monnaieEnvoyee = monnaieEnvoyeeLigne;
  let montantRecu = ligne.montant;
  let monnaieRecue = monnaieOperation;
  if (montantEnvoye == null && ligne.montant_envoye_hors_frais != null && ligne.montant_hors_frais != null) {
    if ((ligne.montant_signe || 0) < 0) {
      // Sortie : l'opération EST la jambe émettrice (montant envoyé, frais
      // compris) ; la contrepartie reçue est restée hors frais.
      montantEnvoye = ligne.montant;
      montantRecu = ligne.montant_hors_frais;
      monnaieRecue = ligne.monnaie_id ?? monnaieOperation;
    } else {
      // Entrée : l'opération est la jambe reçue ; ce qui est parti est resté
      // hors frais.
      montantEnvoye = ligne.montant_envoye_hors_frais;
    }
  }

  // Les deux jambes ne sont montrées que si elles APPRENNENT quelque chose :
  // beaucoup de relevés répètent le même montant des deux côtés (paiement carte
  // ordinaire, virement sans change), et « 45,20 € → 45,20 € » n'est que du
  // bruit dans une colonne déjà dense. Elles réapparaissent dès que les frais
  // ont gonflé l'une, ou que la devise d'arrivée diffère.
  const deuxJambes =
    !seuleJambeEmettrice &&
    montantEnvoye != null &&
    (Math.abs(montantEnvoye - montantRecu) > 0.005 || monnaieEnvoyee !== monnaieRecue);
  const surLaPremiereLigne =
    deuxJambes || seuleJambeEmettrice
      ? formatMontant(montantEnvoye, monnaieEnvoyee)
      : formatMontant(ligne.montant, monnaieOperation);

  let html = escapeHtml(surLaPremiereLigne);
  // Le sens lu dans le fichier — colonne « Sens », ou colonne remplie d'un
  // montant scindé : le montant s'affiche toujours en positif, ce rappel est le
  // seul endroit où l'on voit que la ligne est une sortie plutôt qu'une entrée
  // avant de l'avoir importée.
  //
  // Le rappel ne dépend PAS de `sens_explicite` : un relevé à UNE colonne de
  // montants signés (négatifs / positifs) donne aussi un signe, et il doit se
  // voir de la même façon. `sens_explicite` ne décide que de ce que l'import
  // impose à l'opération, pas de ce que l'aperçu montre.
  if (ligne.montant_signe != null && ligne.montant_signe !== 0) {
    const sortie = ligne.montant_signe < 0;
    html = `<span class="apercu-sens ${sortie ? "sortie" : "entree"}">${
      sortie ? "−" : "+"
    }</span>${html}`;
  }
  // Les deux jambes s'écrivent l'une SOUS l'autre, ce qui part puis ce qui
  // arrive derrière une flèche : côte à côte, la colonne devenait illisible dès
  // que les deux devises s'y ajoutaient.
  if (deuxJambes) {
    html += `<span class="apercu-montant-recu">→ ${escapeHtml(
      formatMontant(montantRecu, monnaieRecue)
    )}</span>`;
  }
  // Les frais sont DÉJÀ compris dans les montants affichés au-dessus (ajoutés à
  // l'initial, ou retranchés du montant — cf. _appliquer_frais côté serveur) :
  // les rappeler ici est le seul moyen de vérifier qu'ils n'ont pas été
  // comptés deux fois par le relevé.
  if (ligne.frais) {
    const monnaieFrais = nonMappee("nom_banque_monnaie_frais", "monnaie_frais_id")
      ? SANS_MONNAIE
      : ligne.monnaie_frais_id ??
        (nonMappee("nom_banque_monnaie", "monnaie_id") ? SANS_MONNAIE : ligne.monnaie_id ?? monnaieDefaut);
    html += `<span class="apercu-frais">dont frais ${escapeHtml(
      formatMontant(ligne.frais, monnaieFrais)
    )}</span>`;
  }
  // Une sortie se lit en orange, montant compris (et pas seulement son signe).
  if (ligne.montant_signe != null && ligne.montant_signe < 0) {
    html = `<span class="apercu-montant-sortie">${html}</span>`;
  }
  return html;
}

// Une devise lue mais non rattachée, quelle que soit la colonne d'où elle
// vient : la ligne ne peut pas être importée tant qu'elle n'a pas de monnaie.
function devisesAMapper(ligne) {
  return CHAMPS_MONNAIE_LIGNE.filter(
    ([champNom, champId]) => ligne[champNom] && ligne[champId] == null
  ).map(([champNom]) => ligne[champNom]);
}

// Une ligne que la banque a refusée : écartée de l'import, mais laissée
// visible — voir ce que l'import a mis de côté fait partie de la relecture.
function ligneRefuseeParStatut(ligne) {
  return ligne.statut_import === "refuse";
}

// Un virement interne décrit DEUX comptes. Tant que le second manque, la ligne
// ne peut pas être importée : n'en écrire qu'un côté laisserait une écriture
// orpheline à retrouver et compléter plus tard (même contrôle côté serveur,
// cf. _erreur_ligne).
function virementIncomplet(ligne) {
  return typeOperationLigne(ligne) === "virement" && ligne.compte_id_autre == null;
}

function statutLigneApercuHtml(ligne) {
  // Avant tout le reste : une ligne refusée n'a pas à être complète pour être
  // écartée, et signaler « compte à mapper » sur une ligne qui ne sera pas
  // importée n'appellerait qu'une correction inutile.
  if (ligneRefuseeParStatut(ligne)) {
    return `<span class="badge-ecartee">refusée par la banque — non importée</span>`;
  }
  // Une ligne déclarée comme un virement déjà connu n'a pas à être complète : elle ne
  // sera pas importée.
  if (ligneDeclareeVirementConnu(ligne)) {
    return `<span class="badge-ecartee">${t("même virement — non importé")}</span>`;
  }
  // L'erreur est calculée par le serveur, en français (cf. _erreur_ligne) : elle
  // se traduit donc à l'affichage, comme les messages d'API.
  if (ligne.erreur) {
    return `<span class="badge-aucun">${escapeHtml(traduireMessageServeur(ligne.erreur))}</span>`;
  }
  if (ligneDeclareeVirementConnu(ligne)) {
    return `<span class="badge-ecartee">${t("même virement — non importé")}</span>`;
  }
  if (ligne.statut_import === "attente") {
    return '<span class="badge-partiel">en attente — importée en prévisionnel</span>';
  }
  if (ligne.compte_id === null) return '<span class="badge-partiel">compte à mapper</span>';
  const lecture = validationJambe(ligne);
  if (lecture === null) {
    return `<span class="badge-partiel">${t("virement déjà connu : à valider")}</span>`;
  }
  if (lecture === true) {
    return `<span class="badge-ecartee">${t("même virement — non importé")}</span>`;
  }
  if (virementIncomplet(ligne)) {
    return `<span class="badge-partiel">${t("virement : compte en face à renseigner")}</span>`;
  }
  const devises = devisesAMapper(ligne);
  if (devises.length > 0) {
    return `<span class="badge-partiel">devise « ${escapeHtml(devises[0])} » à mapper</span>`;
  }
  // Des frais qu'aucun des deux montants ne peut porter : rien à corriger
  // ligne par ligne, c'est la configuration du preset qui ne tient pas (et
  // l'import entier est bloqué, cf. updateBtnImportConfirmerEtat).
  if (ligne.frais_incoherents) {
    return `<span class="badge-aucun">frais en « ${escapeHtml(
      ligne.nom_banque_monnaie_frais
    )} » : monnaie étrangère aux montants</span>`;
  }
  // !nom_banque_categorie : rien à confirmer sans catégorie bancaire (même
  // règle que categories_inconnues côté serveur).
  if (
    ligne.categorie_suggestion_auto &&
    ligne.nom_banque_categorie &&
    !importCategoriesConfirmees.has(ligne.nom_banque_categorie)
  ) {
    return '<span class="badge-partiel">catégorie à confirmer</span>';
  }
  // UNE DÉCOUPE QUI N'A PAS ABOUTI ne bloque pas la ligne : elle s'importera
  // avec sa catégorie ordinaire (cf. regles_categorisation.resoudre_decoupes).
  // Le dire quand même — sinon une règle de découpe silencieusement inopérante
  // ne se remarquerait que des mois plus tard, dans l'histogramme.
  if (ligne.decoupe_erreur) {
    return `<span class="badge-partiel">${escapeHtml(
      traduireMessageServeur(ligne.decoupe_erreur)
    )}</span>`;
  }
  // Classement automatique : on nomme la règle responsable, pour que le
  // résultat reste traçable et corrigeable.
  if (ligne.regle_appliquee) {
    return `<span class="badge-total">${t("OK")}</span><span class="badge-regle" title="Classée automatiquement par une règle de catégorisation">via « ${ligne.regle_appliquee} »</span>`;
  }
  return `<span class="badge-total">${t("OK")}</span>`;
}

// Affiche/masque une sous-section entière (titre + infos + tableau) plutôt
// que de la laisser visible avec un tableau vide -- elle n'apparaît que si
// elle contient au moins une ligne.
// UN TITRE REPLIABLE (<details class="toggle-titre">) SE REPLIE EN CLIQUANT SON
// TITRE, pas sa pastille « i » : celle-ci n'ouvre que son infobulle. Posé en
// capture, avant le comportement natif de <summary>.
document.addEventListener(
  "click",
  (evenement) => {
    if (evenement.target.closest("summary .info-bulle")) evenement.preventDefault();
  },
  true
);

function toggleSousSection(containerId, nombreLignes) {
  document.getElementById(containerId).style.display = nombreLignes > 0 ? "" : "none";
}

// Les lignes qu'un virement déjà connu rappelle (la veille de ressemblance).
function lignesRessemblancesDeLApercu() {
  return importApercu.lignes.filter(
    (l) =>
      l.doublon_de == null &&
      // La jambe manquante PRIME sur la ressemblance (ordre : doublon de colonnes,
      // jambe manquante, ressemblance) : la ligne a déjà son panneau de décision.
      l.jambe_manquante_id == null &&
      veilleDoublonsParLigne[l.ligne] != null
  );
}

/* ---------- LE POP-UP « INFORMATIONS À RENSEIGNER » ----------
 *
 * Les doublons sont ignorés d'office et ne demandent rien. Restent deux sortes de
 * lignes qui attendent une réponse de l'utilisateur sans qu'aucune case ne la
 * réclame à l'écran : les JAMBES de virement reconnues (« Oui » ou « Non », qui
 * bloquent l'import) et les RESSEMBLANCES (qui ne bloquent rien, mais qu'on veut
 * avoir vues). Le pop-up, dans la barre des pages, les annonce où que l'on soit ;
 * sa flèche ouvre l'import et mène à elles.
 *
 * UNE RESSEMBLANCE N'A PAS D'ÉTAT « TRAITÉ » : la laisser telle quelle, c'est
 * l'importer, ce qui est une réponse valable. Elle compte donc comme traitée dès
 * qu'elle est déclarée « même virement », supprimée — ou VUE, c'est-à-dire que la
 * flèche y a mené (`importRessemblancesVues`). Sans cela le pop-up resterait
 * affiché pour qui a choisi de les importer.
 */
const importRessemblancesVues = new Set();

function ressemblancesAExaminer() {
  return lignesRessemblancesDeLApercu().filter(
    (l) => !ligneDeclareeVirementConnu(l) && !importRessemblancesVues.has(l.ligne)
  );
}

function jambesAConfirmer() {
  return importApercu.lignes.filter(
    (l) => !ligneRefuseeParStatut(l) && !ligneDoublonIgnoree(l) && validationJambe(l) === null
  );
}

// LES SOURCES DU POP-UP : l'import bancaire (ci-dessous) et, par
// `enregistrerSourceInfosImport`, celui d'une extension (Placements financiers).
// Une source dit combien de jambes et de ressemblances attendent (`compter`) et
// sait mener à elles (`ouvrir`, qui marque aussi les ressemblances comme vues).
const sourcesInfosImport = {
  bancaire: {
    compter: () => ({
      jambes: importApercu ? jambesAConfirmer().length : 0,
      ressemblances: importApercu ? ressemblancesAExaminer().length : 0,
    }),
    ouvrir: async (cible) => {
      // Les ressemblances sont vues dès qu'on y est mené (cf. le commentaire ci-dessus).
      ressemblancesAExaminer().forEach((l) => importRessemblancesVues.add(l.ligne));
      switchSection("parametres", { sousSection: "parametres-import" });
      await importSectionEnChargement;
      const bloc = document.getElementById(
        cible === "jambes" ? "import-jambes-bloc" : "import-apercu-section-ressemblances"
      );
      if (bloc) {
        bloc.open = true;
        bloc.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    },
  },
};

function enregistrerSourceInfosImport(id, source) {
  sourcesInfosImport[id] = source;
}

function majBulleInformationsImport() {
  const bulle = document.getElementById("bulle-import");
  if (!bulle) return;
  const total = { jambes: 0, ressemblances: 0 };
  Object.values(sourcesInfosImport).forEach((source) => {
    const c = source.compter();
    total.jambes += c.jambes;
    total.ressemblances += c.ressemblances;
  });
  bulle.style.display = total.jambes + total.ressemblances > 0 ? "" : "none";
  document.getElementById("bulle-import-detail").textContent = [
    total.jambes > 0 ? t("{n} virement(s) déjà connu(s) à valider", { n: total.jambes }) : "",
    total.ressemblances > 0 ? t("{n} ressemblance(s) à examiner", { n: total.ressemblances }) : "",
  ]
    .filter(Boolean)
    .join(" · ");
}

// La flèche : mène aux lignes non traitées — les jambes à confirmer d'abord,
// puisque ce sont elles qui bloquent.
document.getElementById("btn-bulle-import").addEventListener("click", async () => {
  const sources = Object.values(sourcesInfosImport);
  const avecJambes = sources.find((source) => source.compter().jambes > 0);
  const source = avecJambes || sources.find((source) => source.compter().ressemblances > 0);
  if (!source) return;
  await source.ouvrir(avecJambes ? "jambes" : "ressemblances");
  majBulleInformationsImport();
});
/**
 * LES CORRESPONDANCES SONT REPLIÉES : les fenêtres de l'import (catégories, comptes, monnaies) y répondent
 * déjà, et trois blocs ouverts sous le fichier rendaient la page illisible. Un bloc ne s'ouvre que s'il
 * MANQUE encore quelque chose (une catégorie non confirmée, un compte ou une devise non rattachés) - ce qui
 * ne devrait plus arriver après les fenêtres - et se referme quand plus rien ne manque. Le repli ne bouge
 * qu'à ces deux changements : un bloc qu'on a ouvert à la main pour relire reste ouvert.
 */
let importMappingsManquaient = null;

function majRepliMappings() {
  const d = importApercu ? demandesDeMapping() : { categories: [], comptes: [], monnaies: [] };
  const manque = {
    categories: d.categories.some((nom) => !importCategoriesConfirmees.has(nom)),
    comptes: d.comptes.some((nom) => !importMappingComptes[nom]),
    monnaies: d.monnaies.some((nom) => !importMappingMonnaies[nom]),
  };
  Object.keys(manque).forEach((cle) => {
    if (importMappingsManquaient && importMappingsManquaient[cle] === manque[cle]) return;
    const bloc = document.getElementById(`import-details-${cle}`);
    if (bloc) bloc.open = manque[cle];
  });
  importMappingsManquaient = manque;
}

/** Après la dernière fenêtre de l'import, la page se pose sur le contrôle avant import, juste au-dessus du
 *  bouton « Confirmer l'import ». */
function versControleImport() {
  if (tutorielEnCours()) return;
  const controle = document.getElementById("import-controle");
  const cible =
    controle && controle.style.display !== "none"
      ? controle
      : document.getElementById("import-apercu-bloc");
  if (cible && cible.style.display !== "none") {
    cible.scrollIntoView({ behavior: "smooth", block: "start" });
  }
}

function renderImportApercu() {
  majRepliMappings();
  document.getElementById("import-apercu-bloc").style.display = "";
  document.getElementById("import-apercu-nombre").textContent = importApercu.lignes.length;
  renderImportPrevisionnelles();
  renderImportJambes();

  // Ni les doublons ni les ressemblances ne rejoignent une des 6 sous-sections
  // par type : elles vivent exclusivement dans leur section dédiée, tant que la
  // suspicion n'est pas levée.
  TYPES_OPERATION_IMPORT.forEach((infoType) => {
    const lignesType = importApercu.lignes.filter(
      (l) => !ligneSuspecteeDeDoublon(l) && typeOperationLigne(l) === infoType.cle
    );
    document.getElementById(`import-apercu-nombre-${infoType.cle}`).textContent = lignesType.length;
    remplirApercuTbody(`import-apercu-liste-${infoType.cle}`, lignesType, infoType);
    toggleSousSection(`import-apercu-section-${infoType.cle}`, lignesType.length);
  });

  // Un doublon de FICHIER prime sur une ressemblance de transaction : la ligne
  // est alors identique à une ligne déjà importée, ce qui est plus fort qu'une
  // ressemblance et appelle un autre geste (la supprimer). Elle ne figure donc
  // que dans « Doublons détectés », jamais dans les deux.
  const lignesRessemblances = lignesRessemblancesDeLApercu();
  document.getElementById("import-apercu-nombre-ressemblances").textContent =
    lignesRessemblances.length;
  remplirApercuTbodyRessemblances("import-apercu-liste-ressemblances", lignesRessemblances);
  toggleSousSection("import-apercu-section-ressemblances", lignesRessemblances.length);

  // LES POSSIBLES DOUBLONS DE VIREMENTS INTERNES : la jambe en face identifiée
  // (panneau de décision) et les ressemblances, sous un seul titre. Les deux
  // ensembles de lignes sont disjoints — un seul détecteur parle par ligne.
  const nbJambes = importApercu.lignes.filter(
    (l) => jambeDeLigne(l) != null && !ligneRefuseeParStatut(l)
  ).length;
  document.getElementById("import-apercu-nombre-groupe-virements").textContent =
    nbJambes + lignesRessemblances.length;
  toggleSousSection(
    "import-apercu-groupe-virements-doublons",
    nbJambes + lignesRessemblances.length
  );

  // LES DOUBLONS, EN DEUX MISES EN PAGE : un virement interne se lit d'un compte À un
  // compte, une opération classique par catégorie et compte. Le type est celui que la
  // ligne a adopté de l'opération déjà en base (cf. _adopter_type_du_doublon).
  const lignesDoublons = importApercu.lignes.filter((l) => l.doublon_de != null);
  const doublonsVirements = lignesDoublons.filter((l) => typeOperationLigne(l) === "virement");
  const doublonsClassiques = lignesDoublons.filter((l) => typeOperationLigne(l) !== "virement");
  document.getElementById("import-apercu-nombre-doublons").textContent = lignesDoublons.length;
  document.getElementById("import-apercu-nombre-doublons-classiques").textContent =
    doublonsClassiques.length;
  document.getElementById("import-apercu-nombre-doublons-virements").textContent =
    doublonsVirements.length;
  remplirApercuTbodyDoublons("import-apercu-liste-doublons", doublonsClassiques, INFO_TYPE_DOUBLON);
  remplirApercuTbodyDoublons(
    "import-apercu-liste-doublons-virements",
    doublonsVirements,
    INFO_TYPE_DOUBLON_VIREMENT
  );
  toggleSousSection("import-apercu-section-doublons-classiques", doublonsClassiques.length);
  toggleSousSection("import-apercu-section-doublons-virements", doublonsVirements.length);
  toggleSousSection("import-apercu-section-doublons", lignesDoublons.length);

  // LA COLONNE « COMPTE (BANQUE) » N'EXISTE QUE SI LE PRESET LIT UN COMPTE : quand
  // aucune ligne n'en porte, elle n'affiche que des tirets (cf. la règle CSS).
  document
    .getElementById("import-apercu-bloc")
    .classList.toggle("sans-compte-banque", importApercu.lignes.every((l) => !l.nom_banque_compte));

  // Cocher un doublon, le décocher ou supprimer une ligne change ce que l'import
  // lit : les demandes de correspondance suivent.
  rafraichirDemandesMapping();

  updateBtnImportSupprimerSelectionEtat();
  updateBtnImportConfirmerEtat();
  majVeilleDoublonsVirements();
  majBulleInformationsImport();
}

/* ---------- LES DÉPENSES PRÉVUES RECONNUES DANS LE RELEVÉ ----------
 *
 * UN PANNEAU DE DÉCISION, PAS UNE SEPTIÈME SOUS-SECTION. La ligne reste dans sa
 * sous-section de type, là où on l'édite et où on lui choisit une catégorie ; ce
 * qui se décide ici est autre chose — ce qu'elle va ÉCRASER — et la sortir de sa
 * section pour poser cette question l'aurait rendue introuvable.
 *
 * COCHÉ PAR DÉFAUT, contrairement aux doublons, et les deux défauts sont
 * inverses parce que les deux risques le sont : laisser passer un doublon crée
 * une opération en trop, laisser passer un rapprochement rend une opération
 * réelle à sa place — ce qui est le comportement voulu. Décocher retombe
 * exactement sur l'ancien comportement.
 *
 * L'ÉTAT VIT ICI ET NON DANS `importApercu` : celui-ci est REMPLACÉ à chaque
 * relecture du fichier, et le refus qu'on vient d'exprimer serait parti avec.
 * Vidé quand un nouveau fichier est choisi (cf. reinitialiserImport).
 */
const importRapprochementsRefuses = new Set();

/* LES LIGNES DE RÈGLEMENT QU'ON A LIÉES, et à quoi : { numéro de ligne: [liens] }.
 *
 * POURQUOI UN ÉTAT À PART plutôt qu'un champ de la ligne. `ImportLigne` décrit
 * ce que le FICHIER dit ; ce que la ligne SOLDE est un choix fait à l'écran, et
 * il vit donc à côté — comme les refus de rapprochement juste au-dessus, et
 * pour la même raison : `importApercu` est REMPLACÉ à chaque relecture du
 * fichier, et le choix serait parti avec.
 *
 * CE QU'IL SERT : le marqueur « liée » de l'aperçu, et la décision d'inclure ou
 * non la ligne dans la confirmation groupée (cf. confirmerImport). Les liens
 * eux-mêmes voyagent dans l'override, comme tout ce qu'on corrige à la main. */
const importLignesLiees = {};

/* ---------- LA VALIDATION DE LA LECTURE DE L'APP ----------
 *
 * Une ligne que le serveur a reconnue comme la description d'une jambe de virement
 * qu'il a déjà écrite (cf. services/import_bancaire.detecter_jambes_manquantes)
 * porte `jambe_manquante_id`. Elle adopte le type « virement » et le compte d'en
 * face de la jambe, mais RIEN n'est décidé : l'utilisateur répond « Oui » (c'est
 * ce virement : la ligne n'est pas importée) ou « Non » (elle l'est, à part).
 *
 * TROIS ÉTATS, et le troisième bloque l'import : « à choisir » (le défaut),
 * « Oui », « Non ». Si l'utilisateur change le type de la ligne, ou son compte
 * d'en face pour un autre que celui de la jambe, il a dit que l'app s'était
 * trompée : le champ passe en « Non » TOUT SEUL (cf. validationJambe). Redevenue
 * ce que l'app avait lu, la ligne repasse « à choisir » — le choix n'est pas
 * perdu, il est simplement masqué le temps de la divergence.
 *
 * L'ÉTAT VIT ICI ET NON DANS `importApercu`, remplacé à chaque relecture du
 * fichier (même raison que les refus de rapprochement).
 */
const importJambesValidees = {};

/* LES LIGNES DÉCLARÉES À LA MAIN comme décrivant un virement déjà en base : numéro de
 * ligne -> identifiant d'une opération de ce virement. Le geste est posé sur une
 * RESSEMBLANCE (cf. creerLigneSuspectVirement), là où la veille a déjà trouvé le
 * virement : « c'est le même » dit ce que l'app n'a pas su conclure seule (une
 * date trop éloignée, des frais qui décalent le montant). Même effet qu'un « Oui » :
 * la ligne n'est pas importée, et ses colonnes entrent au stock. */
const importJambesDeclarees = {};

function ligneDeclareeVirementConnu(ligne) {
  return importJambesDeclarees[ligne.ligne] != null;
}

function jambeDeLigne(ligne) {
  if (!importApercu || ligne.jambe_manquante_id == null) return null;
  return (importApercu.jambes_manquantes || {})[String(ligne.jambe_manquante_id)] || null;
}

// La ligne est-elle encore ce que l'app a lu : un virement vers le compte d'en
// face de la jambe ? (même règle que _jambe_en_jeu côté serveur)
function jambeEnJeu(ligne) {
  const jambe = jambeDeLigne(ligne);
  return (
    jambe != null &&
    typeOperationLigne(ligne) === "virement" &&
    jambe.compte_en_face_id != null &&
    ligne.compte_id_autre === jambe.compte_en_face_id
  );
}

// true (Oui) / false (Non) / null (à choisir) ; undefined si la ligne n'a pas de jambe.
function validationJambe(ligne) {
  if (jambeDeLigne(ligne) == null) return undefined;
  if (!jambeEnJeu(ligne)) return false;
  return importJambesValidees[ligne.ligne] ?? null;
}

function renderImportJambes() {
  const bloc = document.getElementById("import-jambes-bloc");
  const corps = document.getElementById("import-jambes-liste");
  if (!bloc || !corps) return;
  const lignes = importApercu.lignes.filter(
    (l) => jambeDeLigne(l) != null && !ligneRefuseeParStatut(l)
  );
  bloc.style.display = lignes.length ? "" : "none";
  document.getElementById("import-jambes-nombre").textContent = lignes.length;
  corps.innerHTML = "";
  lignes.forEach((ligne) => {
    const jambe = jambeDeLigne(ligne);
    const enJeu = jambeEnJeu(ligne);
    const tr = document.createElement("tr");

    const cellChoix = document.createElement("td");
    const select = document.createElement("select");
    select.innerHTML =
      `<option value="">${t("À choisir")}</option>` +
      `<option value="oui">${t("Oui")}</option>` +
      `<option value="non">${t("Non")}</option>`;
    const valeur = validationJambe(ligne);
    select.value = valeur === true ? "oui" : valeur === false ? "non" : "";
    // Hors de ce que l'app a lu, le champ est « Non » et ne se discute plus.
    select.disabled = !enJeu;
    select.title = enJeu
      ? ""
      : t("Le type ou le compte en face a été changé : la ligne n'est plus ce que l'app avait lu.");
    select.addEventListener("change", () => {
      if (select.value === "oui") importJambesValidees[ligne.ligne] = true;
      else if (select.value === "non") importJambesValidees[ligne.ligne] = false;
      else delete importJambesValidees[ligne.ligne];
      renderImportApercu();
    });
    cellChoix.appendChild(select);
    tr.appendChild(cellChoix);

    const cellLigne = document.createElement("td");
    cellLigne.innerHTML = `<strong>${t("ligne")} ${ligne.ligne}</strong> · ${escapeHtml(
      formatDate(ligne.date)
    )} · ${escapeHtml(ligne.nature || "")} · ${escapeHtml(
      formatMontant(
        ligne.montant,
        ligne.monnaie_operation_id ||
          ligne.monnaie_id ||
          (ligne.nom_banque_monnaie ? SANS_MONNAIE : monnaieParDefautLigne(ligne))
      )
    )}`;
    tr.appendChild(cellLigne);

    const quand =
      jambe.ecart_jours === 0
        ? t("le même jour")
        : t("à {n} jour(s) d'écart", { n: jambe.ecart_jours });
    const cellJambe = document.createElement("td");
    cellJambe.innerHTML = `${escapeHtml(formatDate(jambe.date))} · ${escapeHtml(
      jambe.nature || ""
    )} · ${escapeHtml(FORMAT_NOMBRE.format(jambe.montant))} ${escapeHtml(
      jambe.monnaie_symbole
    )} · <strong>${escapeHtml(jambe.compte_en_face_nom || "?")}</strong> → <strong>${escapeHtml(
      jambe.compte_nom
    )}</strong> <span class="hint">(${quand})</span>`;
    tr.appendChild(cellJambe);
    corps.appendChild(tr);
  });
}

document.getElementById("btn-import-jambes-tout-oui").addEventListener("click", () => {
  if (!importApercu) return;
  importApercu.lignes.filter(jambeEnJeu).forEach((l) => {
    importJambesValidees[l.ligne] = true;
  });
  renderImportApercu();
});

function renderImportPrevisionnelles() {
  const bloc = document.getElementById("import-previsionnelles-bloc");
  const corps = document.getElementById("import-previsionnelles-liste");
  if (!bloc || !corps) return;
  const lignes = importApercu.lignes.filter((l) => l.previsionnelle_id != null);
  bloc.style.display = lignes.length ? "" : "none";
  document.getElementById("import-previsionnelles-nombre").textContent = lignes.length;
  corps.innerHTML = "";
  if (!lignes.length) return;

  lignes.forEach((ligne) => {
    const prev = importApercu.previsionnelles[String(ligne.previsionnelle_id)];
    if (!prev) return;
    const tr = document.createElement("tr");

    const cellCase = document.createElement("td");
    const caseACocher = document.createElement("input");
    caseACocher.type = "checkbox";
    caseACocher.checked = !importRapprochementsRefuses.has(ligne.ligne);
    caseACocher.addEventListener("change", () => {
      if (caseACocher.checked) importRapprochementsRefuses.delete(ligne.ligne);
      else importRapprochementsRefuses.add(ligne.ligne);
      tr.classList.toggle("import-rapprochement-refuse", !caseACocher.checked);
    });
    cellCase.appendChild(caseACocher);
    tr.appendChild(cellCase);

    const cellLigne = document.createElement("td");
    cellLigne.innerHTML = `<strong>${t("ligne")} ${ligne.ligne}</strong> · ${formatDate(
      ligne.date
    )} · ${escapeHtml(ligne.nature || "")} · ${formatMontant(
      ligne.montant,
      ligne.monnaie_operation_id ||
        ligne.monnaie_id ||
        (ligne.nom_banque_monnaie ? SANS_MONNAIE : monnaieParDefautLigne(ligne))
    )}`;
    tr.appendChild(cellLigne);

    // CE QUI SERA ÉCRASÉ, écrit en toutes lettres : accepter d'écraser une
    // opération sans la voir, c'est signer en aveugle. La FENÊTRE y figure
    // parce que c'est elle qui explique pourquoi CETTE prévision-là a été
    // reconnue, et non celle d'à côté.
    const attendue =
      prev.rapprochement_debut && prev.rapprochement_fin
        ? t("prévue entre le {debut} et le {fin}", {
            debut: formatDate(prev.rapprochement_debut),
            fin: formatDate(prev.rapprochement_fin),
          })
        : t("prévue le {date}", { date: formatDate(prev.date) });
    const recurrente = prev.recurrente
      ? ` · <em>${t("occurrence d'une opération récurrente")}</em>`
      : "";
    const cellPrev = document.createElement("td");
    cellPrev.innerHTML = `${escapeHtml(prev.nature || "")} · ${formatMontant(
      prev.montant,
      prev.monnaie_id
    )} · ${escapeHtml(prev.compte_nom)}<br /><span class="hint">${attendue}${recurrente}</span>`;
    tr.appendChild(cellPrev);

    tr.classList.toggle(
      "import-rapprochement-refuse",
      importRapprochementsRefuses.has(ligne.ligne)
    );
    corps.appendChild(tr);
  });
}

/* ---------- Veille : doublons de virements internes ---------- */

// La détection de doublons ordinaire compare des LIGNES DE FICHIER au sein d'un
// même preset (cf. detecter_doublon côté serveur). Elle ne peut donc rien voir
// quand le même virement arrive par deux relevés différents : le compte A
// l'écrit comme un débit, le compte B comme un crédit, avec des colonnes qui
// n'ont rien de commun. Ce qui les rapproche, c'est la TRANSACTION — deux
// comptes, un montant, une date voisine — et c'est ce que le serveur compare
// ici (POST /import/virements-doublons).
//
// Veille DYNAMIQUE : relancée à chaque rendu de l'aperçu, donc au chargement du
// fichier ET dès qu'une ligne est reclassée en virement interne ou que son
// compte en face est renseigné — c'est-à-dire précisément au moment où la
// comparaison devient possible.
let veilleDoublonsSignature = null;
let veilleDoublonsTimer = null;
// numéro de ligne -> suspects renvoyés par le serveur. C'est ce qui fait
// rejoindre à la ligne la section "Doublons détectés" (cf.
// ligneSuspecteeDeDoublon), au même titre qu'un doublon de fichier ordinaire.
let veilleDoublonsParLigne = {};

/**
 * Une ligne sortie des six sous-sections par type, pour l'une des deux raisons.
 *
 * `doublon_de` : le serveur a reconnu la LIGNE de fichier comme déjà importée
 * (comparaison colonne par colonne au sein du preset). Elle descend dans
 * « Doublons détectés ».
 *
 * `veilleDoublonsParLigne` : le serveur a reconnu la TRANSACTION — deux comptes,
 * les devises, un des deux montants, une date voisine — dans un virement déjà en
 * base ou plus haut dans le fichier. Elle rejoint « Ressemblances ».
 *
 * Deux sections distinctes, mais une même conséquence ici : la ligne ne doit
 * pas figurer en double dans sa sous-section de type.
 */
function ligneSuspecteeDeDoublon(ligne) {
  return ligne.doublon_de != null || veilleDoublonsParLigne[ligne.ligne] != null;
}

// Les virements de l'aperçu, dès qu'UN compte est connu — celui que le relevé
// nomme, qui est le seul dont on dispose la plupart du temps. Le compte d'en
// face est envoyé quand il est là (une règle l'a déduit, ou l'utilisateur l'a
// saisi) et vaut null sinon : le serveur compare alors sur le compte connu et
// nous rend le second, lu sur le virement auquel la ligne ressemble (cf.
// _memes_virements / _compte_en_face). C'est ce qui permet de dire « tu as
// peut-être déjà cette ligne » AVANT de demander de retrouver le second compte,
// plutôt qu'après — et donc de ne pas le demander du tout quand la réponse est
// « supprime-la ».
function candidatsDoublonsVirements() {
  if (!importApercu) return [];
  return importApercu.lignes
    .filter(
      (l) =>
        typeOperationLigne(l) === "virement" &&
        !ligneRefuseeParStatut(l) &&
        // DEUX CHOSES, ET DEUX SEULEMENT : une date et un compte. Tout le reste
        // a été essayé et écartait justement les lignes que cette veille existe
        // pour attraper.
        //
        // `!l.erreur` (la condition d'origine) demandait une ligne PRÊTE À ÊTRE
        // IMPORTÉE — or un virement sans son compte en face en porte une par
        // construction (cf. _erreur_ligne). La veille ne voyait donc jamais le
        // cas pour lequel elle a été relâchée. Et une ligne qu'on ne peut pas
        // importer est même celle qu'il est le plus utile de signaler : savoir
        // qu'elle est déjà en base dispense de la réparer.
        //
        // `montant_signe != null` (essayé ensuite) écartait les lignes dont le
        // fichier ne tranche pas le sens — montant corrigé à la main, colonnes
        // débit/crédit toutes deux vides ou toutes deux remplies. Le sens ne
        // décide plus de rien ici : le serveur rapproche sur l'ENSEMBLE des
        // comptes connus, sans regarder qui émet (cf. _comptes_compatibles).
        l.date &&
        l.compte_id != null &&
        // Une ligne qui a déjà une jambe reconnue, ou qui est déjà un doublon de
        // colonnes, n'est plus à comparer : le détecteur le plus fort parle seul
        // (les autres se taisent, message d'avertissement compris).
        l.jambe_manquante_id == null &&
        l.doublon_de == null
    )
    .map((l) => {
      // Même règle que partout ailleurs : le signe du montant bancaire dit qui
      // émet (cf. rolesCompteVirement / _resoudre_comptes_virement). Un signe
      // absent range le compte connu du côté récepteur, comme partout —
      // et SANS CONSÉQUENCE ICI : tant qu'un des deux comptes manque, le
      // serveur ne regarde plus les rôles, seulement les comptes en présence.
      const emetteur = (l.montant_signe || 0) < 0;
      // Les deux jambes, quand la ligne les décrit toutes les deux (change) :
      // le montant envoyé est ce qui part, `montant` ce qui arrive. Sans
      // change, la ligne ne porte qu'un montant — c'est le même des deux côtés,
      // et le montant reçu reste inconnu plutôt que dupliqué (il ne doit pas
      // faire échouer une comparaison qu'il ne renseigne pas).
      const deuxJambes = l.montant_envoye != null && l.montant != null;
      // La jambe que la ligne décrit : ce qui PART quand le fichier le donne,
      // ce qui ARRIVE sinon. LE MONTANT ET SA DEVISE VONT ENSEMBLE — prendre le
      // montant d'un bord et la devise de l'autre ferait comparer des choses
      // qui ne se correspondent pas (cf. _jambes, côté serveur).
      const decritLEnvoi = l.montant_envoye != null;
      return {
        ligne: l.ligne,
        date: l.date,
        // Rangé dans `montant` quel que soit le bord d'où il vient : le serveur
        // ne se fie plus au champ pour savoir de quelle jambe il s'agit, il
        // essaie les deux (cf. _jambes_compatibles). C'est ce qui permet à un
        // relevé de récepteur — qui ne connaît que ce qui est ARRIVÉ — de se
        // rapprocher d'un virement dont il est parti un peu plus, frais compris.
        montant: Math.abs(decritLEnvoi ? l.montant_envoye : l.montant || 0),
        monnaie_id: (decritLEnvoi ? l.monnaie_envoyee_id : l.monnaie_id) ?? null,
        montant_recu: deuxJambes ? Math.abs(l.montant) : null,
        monnaie_recue_id: deuxJambes ? l.monnaie_id ?? null : null,
        // `?? null` et non la valeur brute : `undefined` disparaîtrait du JSON
        // et le champ manquerait, là où `null` DIT que le compte est inconnu.
        compte_source_id: (emetteur ? l.compte_id : l.compte_id_autre) ?? null,
        compte_destination_id: (emetteur ? l.compte_id_autre : l.compte_id) ?? null,
      };
    })
    .filter((c) => c.montant > 0);
}

/**
 * Dit ce que la veille a REGARDÉ, et pas seulement ce qu'elle a trouvé.
 *
 * Une comparaison qui n'a pas eu lieu et une comparaison qui n'a rien trouvé
 * produisent le même écran : rien. Impossible alors de savoir si l'app est
 * d'accord pour dire que la ligne est neuve, ou si elle ne l'a simplement
 * jamais examinée — et c'est précisément la question qu'on se pose quand on
 * s'attendait à voir un doublon.
 *
 * Une ligne est comparable dès qu'on lui connaît une DATE et UN COMPTE ; le
 * compte d'en face, lui, n'est plus nécessaire (cf. candidatsDoublonsVirements).
 */
function renderEtatVeilleVirements(nbCandidats, nbRapprochees) {
  const bloc = document.getElementById("import-veille-virements-etat");
  if (!bloc) return;
  // La veille fait partie de l'extension « Imports Avancés » (id `regles`) : éteinte, elle n'a
  // rien regardé, et « aucune ressemblance » affirmerait le contraire.
  if (!BudgetApp.extensions.estActive("regles")) {
    bloc.style.display = "none";
    return;
  }
  const virements = importApercu
    ? importApercu.lignes.filter((l) => typeOperationLigne(l) === "virement").length
    : 0;
  bloc.style.display = virements === 0 ? "none" : "";
  if (virements === 0) return;
  const nonComparees = virements - nbCandidats;
  bloc.textContent =
    t("Veille des doublons de virement : {compares} ligne(s) comparée(s) sur {total}", {
      compares: nbCandidats,
      total: virements,
    }) +
    " — " +
    (nbRapprochees > 0
      ? t("{n} ressemblance(s) trouvée(s).", { n: nbRapprochees })
      : t("aucune ressemblance.")) +
    (nonComparees > 0
      ? " " +
        t(
          "{n} ligne(s) n'ont pas pu être comparées : il leur manque une date ou un compte reconnu.",
          { n: nonComparees }
        )
      : "");
}

function majVeilleDoublonsVirements() {
  const candidats = candidatsDoublonsVirements();
  const signature = JSON.stringify(candidats);
  // renderImportApercu est appelé à chaque frappe de l'aperçu : sans cette
  // comparaison, la moindre coche de sélection relancerait la requête.
  if (signature === veilleDoublonsSignature) return;
  veilleDoublonsSignature = signature;

  if (candidats.length === 0) {
    renderVeilleDoublonsVirements([]);
    renderEtatVeilleVirements(0, 0);
    return;
  }
  clearTimeout(veilleDoublonsTimer);
  veilleDoublonsTimer = setTimeout(async () => {
    try {
      const reponse = await apiFetch("/import/virements-doublons", {
        method: "POST",
        body: JSON.stringify({ candidats }),
      });
      // L'aperçu a pu changer pendant la requête : un résultat périmé
      // afficherait un avertissement sur des lignes qui n'existent plus.
      if (signature !== veilleDoublonsSignature) return;
      renderVeilleDoublonsVirements(reponse.resultats);
      renderEtatVeilleVirements(candidats.length, (reponse.resultats || []).length);
    } catch (err) {
      // Une veille consultative n'a pas à interrompre l'import : on se tait.
      renderVeilleDoublonsVirements([]);
      renderEtatVeilleVirements(candidats.length, 0);
    }
  }, 250);
}

/**
 * Enregistre le verdict de la veille, et le SIGNALE au bon endroit.
 *
 * Rien n'est plus écrit dans le corps de la page. Un pavé d'avertissement
 * inséré au milieu de l'aperçu obligeait à faire deux lectures — le pavé, puis
 * la ligne, à retrouver dans une autre section — pour une information qui tient
 * en un mot : « celle-ci, tu l'as peut-être déjà ». Désormais :
 *
 * - un message orange en bas de page, comme tous les autres messages de l'app,
 *   dit qu'il y a quelque chose à vérifier et où ;
 * - la ligne elle-même DESCEND dans « Doublons détectés », suivie du virement
 *   auquel elle ressemble — au même endroit et sous la même forme que les
 *   doublons de fichier, puisque c'est le même geste qui les résout.
 *
 * Le message n'est émis que lorsque le verdict CHANGE : la veille est relancée
 * à chaque retouche de l'aperçu, et répéter le même avertissement à chaque coche
 * de sélection le rendrait invisible à force.
 */
function renderVeilleDoublonsVirements(resultats) {
  const precedent = veilleDoublonsParLigne;
  veilleDoublonsParLigne = {};
  (resultats || []).forEach((resultat) => {
    veilleDoublonsParLigne[resultat.ligne] = resultat.suspects;
  });

  const nouvelles = Object.keys(veilleDoublonsParLigne).filter((n) => precedent[n] == null);
  const memeVerdict =
    nouvelles.length === 0 &&
    Object.keys(precedent).length === Object.keys(veilleDoublonsParLigne).length;
  if (nouvelles.length > 0) {
    const numeros = nouvelles.join(", ");
    showMessage(
      `Doublon de virement possible — ligne(s) ${numeros} : la même transaction semble ` +
        `déjà connue. Rien n'est bloqué : les lignes concernées sont regroupées dans ` +
        `« Ressemblances », vérifie-les avant de confirmer.`,
      "warning"
    );
  }
  // L'aperçu doit être redessiné pour que les lignes changent de section — mais
  // seulement si le verdict a bougé, sinon renderImportApercu (qui appelle la
  // veille) et cette fonction se rappelleraient l'une l'autre sans fin.
  if (!memeVerdict && importApercu) renderImportApercu();
}

// Descripteur générique (même mise en page que classique/remboursable :
// Catégorie + Compte) utilisé pour TOUTE ligne de la section "Doublons
// détectés", quel que soit son type réel — une seule table à colonnes fixes
// plutôt qu'une mise en page par ligne, en échange d'un léger raccourci pour
// les doublons de type virement (un seul compte affiché, pas émetteur/
// récepteur). Modifier permet toujours de reclasser vers n'importe quel type.
const INFO_TYPE_DOUBLON = { cle: "doublon", categorieLibre: true };

// Le doublon d'un VIREMENT INTERNE : émetteur et récepteur à la place de catégorie et
// compte (même descripteur que les ressemblances, sans le compte d'en face déduit —
// le doublon porte déjà les deux comptes de l'opération en base).
const INFO_TYPE_DOUBLON_VIREMENT = { cle: "doublon", virement: true };

// Chaque ligne doublon est suivie, juste en dessous, de la ligne déjà en base
// suspectée (importApercu.lignes_existantes, résolue au même format côté
// serveur) affichée en lecture seule — mêmes colonnes, sans Actions/Sélection,
// pour une comparaison directe entre les deux lignes. Une liste vide masque
// toute la section (cf. toggleSousSection, renderImportApercu).
function remplirApercuTbodyDoublons(tbodyId, lignes, infoType = INFO_TYPE_DOUBLON) {
  const body = document.getElementById(tbodyId);
  body.innerHTML = "";
  // Depuis l'en-tête, pas depuis la ligne au-dessus : celle-ci n'a qu'une
  // cellule quand elle est en cours d'édition (le formulaire occupe toute la
  // largeur), et la rangée descriptive se serait alors ratatinée.
  const entete = body.closest("table").querySelector("thead tr");
  const nbColonnes = entete ? entete.children.length : 11;
  lignes.forEach((ligne) => {
    const tr =
      ligne.ligne === ligneApercuEnEdition
        ? creerLigneApercuEdition(ligne, infoType)
        : creerLigneApercuAffichage(ligne, infoType);
    tr.classList.add("import-doublon-nouvelle");
    body.appendChild(tr);

    const existante = importApercu.lignes_existantes[String(ligne.doublon_de)];
    if (existante) {
      // La ligne déjà en base est relue comme un relevé ordinaire : elle ne connaît pas
      // son compte d'en face. Dans la mise en page d'un virement, on lui prête celui
      // de la ligne qui la double — c'est la même transaction.
      const existanteLue =
        infoType.virement && existante.compte_id_autre == null
          ? { ...existante, compte_id_autre: ligne.compte_id_autre }
          : existante;
      const trExistante = creerLigneApercuAffichage(existanteLue, infoType, { lectureSeule: true });
      trExistante.classList.add("import-doublon-existante");
      body.appendChild(trExistante);
    }
  });
}

/**
 * Descripteur de la section « Ressemblances ». Distinct de INFO_TYPE_DOUBLON :
 * ici TOUTE ligne est un virement (c'est la veille qui les y envoie), et un
 * virement se lit d'un compte À un compte. La table montre donc Émetteur et
 * Récepteur là où les autres sections montrent Catégorie et Compte — même
 * nombre de colonnes, cf. l'en-tête dans index.html.
 *
 * `compteAutreDeduit` demande en plus de remplir le compte que la ligne ne
 * nomme pas avec celui que la veille vient de lire sur l'opération à laquelle
 * elle ressemble : c'est le renseignement qu'on venait chercher, et le laisser
 * à « - » obligerait à le reconstituer en lisant la rangée du dessous.
 */
const INFO_TYPE_RESSEMBLANCE = { cle: "doublon", virement: true, compteAutreDeduit: true };

/**
 * La section « Ressemblances » : les lignes qu'un virement déjà connu rappelle.
 *
 * Le suspect n'est pas une ligne de fichier mais une TRANSACTION (un virement
 * déjà en base, ou une ligne précédente du même fichier) : il n'y a pas
 * d'ImportLigne à afficher colonne par colonne, d'où la rangée descriptive
 * — mais posée juste sous la ligne qu'elle explique, comme la ligne existante
 * l'est sous un doublon de fichier, pour que la comparaison se fasse d'un
 * regard.
 */
function remplirApercuTbodyRessemblances(tbodyId, lignes) {
  const body = document.getElementById(tbodyId);
  body.innerHTML = "";
  const entete = body.closest("table").querySelector("thead tr");
  const nbColonnes = entete ? entete.children.length : 11;
  lignes.forEach((ligne) => {
    const tr =
      ligne.ligne === ligneApercuEnEdition
        ? creerLigneApercuEdition(ligne, INFO_TYPE_RESSEMBLANCE)
        : creerLigneApercuAffichage(ligne, INFO_TYPE_RESSEMBLANCE);
    tr.classList.add("import-doublon-nouvelle");
    body.appendChild(tr);
    (veilleDoublonsParLigne[ligne.ligne] || []).forEach((suspect) => {
      body.appendChild(creerLigneSuspectVirement(suspect, nbColonnes, ligne));
    });
  });
}

// La rangée « ressemble à … » sous une ligne suspectée de doubler un virement.
function creerLigneSuspectVirement(suspect, nbColonnes, ligne = null) {
  const quand =
    suspect.ecart_jours === 0 ? "le même jour" : `à ${suspect.ecart_jours} jour(s) d'écart`;
  const origine =
    suspect.source === "fichier"
      ? `ligne ${suspect.ligne} du même fichier`
      : `virement déjà importé${suspect.nature ? ` — « ${escapeHtml(suspect.nature)} »` : ""}`;
  // LES DEUX COMPTES, TOUJOURS, et mis en évidence : c'est sur eux que porte la
  // comparaison, et c'est d'eux que vient le compte manquant recopié en italique
  // sur la ligne du dessus. Un « ? » ne s'affiche que pour un rapprochement
  // entre deux lignes du même fichier, qui peuvent ignorer le même côté.
  const tr = document.createElement("tr");
  tr.className = "import-doublon-existante import-doublon-virement";
  tr.innerHTML = `
    <td colspan="${nbColonnes}">
      <span class="hint">Ressemble à :</span>
      ${escapeHtml(formatDate(suspect.date))} · ${escapeHtml(FORMAT_NOMBRE.format(suspect.montant))}
      ${escapeHtml(suspect.monnaie_symbole)} ·
      <strong>${escapeHtml(suspect.compte_source)}</strong> →
      <strong>${escapeHtml(suspect.compte_destination)}</strong>
      <span class="hint">(${origine}, ${quand})</span>
      ${
        // « C'EST LE MÊME VIREMENT » : seulement quand le suspect est une opération
        // déjà en base — un doublon à l'intérieur du même fichier se règle en
        // supprimant une des deux lignes.
        ligne && suspect.source === "base" && suspect.operation_id != null
          ? `<button type="button" class="primary" data-declarer-virement="${ligne.ligne}">${
              ligneDeclareeVirementConnu(ligne)
                ? t("Annuler la déclaration")
                : t("C'est le même virement (ne pas importer)")
            }</button>`
          : ""
      }
    </td>
  `;
  const declarer = tr.querySelector("[data-declarer-virement]");
  if (declarer) {
    declarer.addEventListener("click", () => {
      if (ligneDeclareeVirementConnu(ligne)) delete importJambesDeclarees[ligne.ligne];
      else importJambesDeclarees[ligne.ligne] = suspect.operation_id;
      renderImportApercu();
    });
  }
  return tr;
}

function remplirApercuTbody(tbodyId, lignes, infoType) {
  const body = document.getElementById(tbodyId);
  body.innerHTML = "";
  // Une liste vide masque toute la sous-section (cf. toggleSousSection,
  // renderImportApercu) : pas besoin d'une ligne "Aucune ligne." ici.
  lignes.forEach((ligne) => {
    const tr =
      ligne.ligne === ligneApercuEnEdition
        ? creerLigneApercuEdition(ligne, infoType)
        : creerLigneApercuAffichage(ligne, infoType);
    body.appendChild(tr);
  });
}

// Retire une ligne de l'aperçu (bouton "Supprimer" individuel ou suppression
// groupée sur la sélection) : logique unique, partagée entre les deux.
function supprimerLigneApercu(ligne) {
  importLignesSupprimees.add(ligne.ligne);
  importApercu.lignes = importApercu.lignes.filter((l) => l.ligne !== ligne.ligne);
  importLignesSelectionnees.delete(ligne.ligne);
  delete importLigneOverrides[ligne.ligne];
  // La liaison part avec la ligne : la garder ferait rouvrir « liée à 2 » sur
  // une ligne que l'utilisateur vient de retirer de l'import.
  delete importLignesLiees[ligne.ligne];
  delete importJambesDeclarees[ligne.ligne];
}

/**
 * Le compte d'en face tel que la veille l'a lu sur les opérations ressemblantes,
 * ou null si la ligne le nomme déjà (ou si rien ne l'a renseigné).
 *
 * Plusieurs suspects peuvent nommer des comptes différents — deux virements du
 * même montant partis du même compte vers deux endroits. On les cite tous
 * plutôt que d'en élire un : « Livret A ou PEL » dit exactement ce que l'app
 * sait, là où « Livret A » affirmerait ce qu'elle ignore.
 */
function compteEnFaceDeduit(ligne) {
  const suspects = veilleDoublonsParLigne[ligne.ligne] || [];
  const noms = [...new Set(suspects.map((s) => s.compte_en_face).filter(Boolean))];
  return noms.length ? noms.join(` ${t("ou")} `) : null;
}

/**
 * Le SENS que la ligne ne connaît pas, emprunté à l'opération à laquelle elle
 * ressemble. Rend "emetteur" ou "recepteur" — le rôle du compte que la ligne
 * nomme — ou null quand il n'y a rien à emprunter.
 *
 * POURQUOI. Le sens d'une ligne vient du signe de son montant, et ce signe
 * manque parfois (montant corrigé à la main, colonnes débit/crédit ambiguës).
 * `rolesCompteVirement` range alors le compte connu côté récepteur par défaut,
 * ce qui affichait « Livret A → Compte Courant » juste au-dessus d'un suspect
 * écrit « Compte Courant → Livret A » : les deux rangées se contredisaient à
 * l'œil, sur la seule ligne où l'on demande justement de comparer.
 *
 * On n'emprunte QUE ce qu'on n'a pas : dès que la ligne porte un signe, il fait
 * foi, et deux suspects qui ne s'accordent pas sur le sens n'en imposent aucun.
 */
function sensEmprunteAuSuspect(ligne) {
  if (ligne.montant_signe != null) return null;
  const roles = new Set(
    (veilleDoublonsParLigne[ligne.ligne] || [])
      .map((s) => {
        if (!s.compte_en_face) return null;
        // Le compte d'en face est le récepteur du suspect ⇒ celui que la ligne
        // nomme en est l'émetteur, et réciproquement.
        if (s.compte_en_face === s.compte_destination) return "emetteur";
        if (s.compte_en_face === s.compte_source) return "recepteur";
        return null;
      })
      .filter(Boolean)
  );
  return roles.size === 1 ? [...roles][0] : null;
}

/**
 * Un compte SUGGÉRÉ, jamais un compte enregistré — d'où l'italique éteint et le
 * point d'interrogation. La distinction n'est pas cosmétique : rien n'a été
 * écrit sur la ligne, et l'import la refusera toujours tant que l'utilisateur
 * n'aura pas repris ce compte à la main dans « Modifier ».
 */
function compteDeduitHtml(nom) {
  return `<span class="compte-deduit" title="${escapeHtml(
    t(
      "Compte lu sur l'opération à laquelle cette ligne ressemble. Rien n'est enregistré : " +
        "reprends-le par « Modifier » si tu veux vraiment importer cette ligne."
    )
  )}">${escapeHtml(nom)} ?</span>`;
}

/**
 * La cellule « Catégorie » d'une ligne d'aperçu : une catégorie, ou la DÉCOUPE
 * qu'une règle lui a posée.
 *
 * LES PARTS SONT DÉJÀ EN MONTANTS ici, pas en formules (cf.
 * schemas.ImportLigne.decoupes) : l'aperçu sert précisément à voir ce qui sera
 * écrit, et afficher « min(montant; 50) » sur une ligne à 32 € aurait laissé
 * faire le calcul de tête.
 *
 * Le détail passe par l'infobulle native du navigateur plutôt que par une
 * ligne dépliable : le tableau de l'aperçu porte déjà dix colonnes et une
 * édition en place, y ajouter un second niveau de lignes l'aurait rendu
 * illisible. La liste des opérations, elle, a la place de le déplier.
 */
function categorieLigneApercuHtml(ligne) {
  const parts = ligne.decoupes || [];
  if (parts.length === 0) return nomCategorie(ligne.categorie_id);
  const detail = parts
    .map((part) => `${nomCategorie(part.categorie_id)} : ${part.montant.toFixed(2)}`)
    .join("\n");
  return `<span class="badge-regle" title="${escapeHtml(detail)}">${t("Découpée")} · ${
    parts.length
  } ${t("parts")}</span>`;
}

function creerLigneApercuAffichage(ligne, infoType, { lectureSeule = false } = {}) {
  const tr = document.createElement("tr");
  // Une ligne en lecture seule (ligne déjà en base, affichée pour
  // comparaison) n'a par définition aucune action ni sélection possible.
  const selectionHtml = lectureSeule
    ? "-"
    : `<input type="checkbox" data-action="selectionner-ligne" data-ligne="${ligne.ligne}" ${importLignesSelectionnees.has(ligne.ligne) ? "checked" : ""} />`;

  let colonnesSpecifiques;
  if (infoType.virement) {
    const { emetteurHtml, recepteurHtml, emetteurActif } = rolesCompteVirement(ligne);
    // Les deux côtés séparés : celui que la ligne NOMME, et celui qu'elle
    // ignore (« - » tant que rien ne l'a rempli).
    const connuHtml = emetteurActif ? emetteurHtml : recepteurHtml;
    const inconnuHtml = emetteurActif ? recepteurHtml : emetteurHtml;
    // Dans « Ressemblances », le côté ignoré reçoit ce que la veille en a
    // appris, et le SENS est emprunté au suspect quand la ligne n'en a pas.
    // `deduit` est null dès que les deux comptes sont connus : la substitution
    // ne peut pas écraser un vrai compte.
    const deduit = infoType.compteAutreDeduit ? compteEnFaceDeduit(ligne) : null;
    const autreHtml = deduit ? compteDeduitHtml(deduit) : inconnuHtml;
    const emprunte = infoType.compteAutreDeduit ? sensEmprunteAuSuspect(ligne) : null;
    const connuEstEmetteur = emprunte ? emprunte === "emetteur" : emetteurActif;
    colonnesSpecifiques = connuEstEmetteur
      ? `<td>${connuHtml}</td><td>${autreHtml}</td>`
      : `<td>${autreHtml}</td><td>${connuHtml}</td>`;
  } else {
    const compteHtml = ligne.compte_id !== null ? nomCompte(ligne.compte_id) : "-";
    // Catégorie affichée uniquement pour classique/remboursable : les autres
    // sous-sections ont déjà une catégorie implicite (fixe), pas besoin de
    // la répéter en colonne (cf. regroupement par catégorie d'opération).
    colonnesSpecifiques = infoType.categorieLibre
      ? `<td>${categorieLigneApercuHtml(ligne)}</td><td>${compteHtml}</td>`
      : `<td>${compteHtml}</td>`;
  }

  const actionsHtml = lectureSeule
    ? "-"
    : `<button type="button" data-action="modifier-ligne">${t("Modifier")}</button>
       <button type="button" data-action="supprimer-ligne" class="danger">${t("Supprimer")}</button>`;

  // LA LIGNE DIT QU'ELLE EST LIÉE, et à combien d'opérations. Sans ce marqueur,
  // une ligne de règlement qu'on vient de lier ressemble exactement à une ligne
  // qu'on n'a pas encore touchée : le geste qu'on vient de faire n'a laissé
  // aucune trace à l'écran, et on le refait.
  const liens = importLignesLiees[ligne.ligne];
  const marqueurLien = liens && liens.length
    ? ` <span class="badge-remboursable">${t("liée à {n}", { n: liens.length })}</span>`
    : "";

  tr.innerHTML = `
    <td>${lectureSeule ? "Existant" : ligne.ligne}</td>
    <td>${ligne.date ? formatDate(ligne.date) : "-"}</td>
    <td>${ligne.nature || "-"}${marqueurLien}</td>
    <td>${montantLigneApercuHtml(ligne)}</td>
    <td>${ligne.nom_banque_categorie || "-"}</td>
    <td>${ligne.nom_banque_compte || "-"}</td>
    ${colonnesSpecifiques}
    <td>${statutLigneApercuHtml(ligne)}</td>
    <td>${actionsHtml}</td>
    <td>${selectionHtml}</td>
  `;

  if (!lectureSeule) {
    tr.querySelector("button[data-action='modifier-ligne']").addEventListener("click", () => {
      ligneApercuEnEdition = ligne.ligne;
      renderImportApercu();
    });
    tr.querySelector("button[data-action='supprimer-ligne']").addEventListener("click", () => {
      if (!confirm(`Supprimer la ligne ${ligne.ligne} de l'import ?`)) return;
      supprimerLigneApercu(ligne);
      renderImportApercu();
    });
    const checkbox = tr.querySelector("input[data-action='selectionner-ligne']");
    if (checkbox) {
      checkbox.addEventListener("change", () => {
        if (checkbox.checked) importLignesSelectionnees.add(ligne.ligne);
        else importLignesSelectionnees.delete(ligne.ligne);
        // Cocher ou décocher un doublon change ce que l'import lira : les demandes
        // de correspondance suivent, sans redessiner tout l'aperçu.
        rafraichirDemandesMapping();
        updateBtnImportSupprimerSelectionEtat();
        majBulleInformationsImport();
      });
    }
  }
  return tr;
}

function infoTypeOperationLigne(ligne) {
  return TYPES_OPERATION_IMPORT.find((t) => t.cle === typeOperationLigne(ligne));
}

// Sélecteur de compte avec une option "- À choisir -" en tête de liste :
// présente par défaut tant qu'aucun compte n'est identifié (valeurInitiale
// null), retirée dès que l'utilisateur choisit un vrai compte (et donc plus
// jamais re-sélectionnable par la suite pour ce champ) — impossible de
// confondre un choix confirmé avec le premier compte de la liste resté là par
// défaut.
function creerChampCompteAvecIndice(valeurInitiale) {
  const select = document.createElement("select");
  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = t("- À choisir -");
  select.appendChild(placeholder);
  fillComptesSelect(select, comptesProposables(valeurInitiale ?? null), { keepFirst: true });

  let confirme = valeurInitiale !== null && valeurInitiale !== undefined;
  if (confirme) {
    select.value = String(valeurInitiale);
    placeholder.remove();
  } else {
    select.value = "";
  }

  select.addEventListener("change", () => {
    confirme = true;
    placeholder.remove();
  });

  const wrap = document.createElement("span");
  wrap.className = "champ-compte-indice";
  wrap.append(select);

  return { wrap, select, estConfirme: () => confirme };
}

// Édition directement sur la ligne (pas de formulaire séparé), regroupée dans
// une seule cellule fusionnée (colspan) plutôt qu'une cellule par colonne :
// le nombre de colonnes de l'entête varie selon la sous-section d'origine, et
// les champs affichés varient eux-mêmes avec le type d'opération choisi
// (catégorie libre ou non, un seul compte ou émetteur/récepteur, Montant à
// rembourser, checklist de liaison) — une seule cellule flexible évite tout
// problème d'alignement. Le sélecteur "Catégorie d'opération" est disponible
// pour TOUS les types, y compris les règlements : une ligne de règlement
// coincée (rien à lier) peut toujours être reclassée ailleurs, jamais d'impasse.
//
// Pour un type de règlement (Remboursement reçu / Remboursement de prêt), le
// montant libre laisse place à une checklist des dépenses/prêts déjà en base
// et non soldés (comme sur la page Opérations) et le bouton principal devient
// "Créer l'opération liée" dès qu'une cible est cochée : la création est alors
// immédiate (POST /operations, seul endpoint qui gère operations_remboursees),
// hors du confirm groupé. Sans cible cochée, "Enregistrer" mémorise simplement
// le reclassement : la ligne reste en attente dans sa sous-section (cas
// typique : les dépenses/prêts qu'elle règle font partie du même fichier et
// n'existeront en base qu'après le confirm groupé).
function creerLigneApercuEdition(ligne, infoTypeSection) {
  const tr = document.createElement("tr");
  tr.className = "ligne-apercu-edition";

  const tdLigne = document.createElement("td");
  tdLigne.textContent = ligne.ligne;

  const inputDate = document.createElement("input");
  inputDate.type = "date";
  inputDate.value = ligne.date || "";

  const inputNature = document.createElement("input");
  inputNature.type = "text";
  inputNature.value = ligne.nature || "";

  /**
   * Les deux champs de montant de ce formulaire valent-ils HORS FRAIS ?
   *
   * Fixé une fois pour toutes à l'ouverture, et jamais ensuite : c'est lui qui
   * donne leur sens aux valeurs saisies, et le laisser changer sous la main de
   * l'utilisateur ferait relire autrement un nombre déjà tapé.
   *
   * Dès qu'une ligne porte des frais, oui : le formulaire montre alors les
   * montants du relevé — ce qui part, ce qui arrive, et la commission — et
   * l'imputation se refait à l'enregistrement. Le type pouvant changer dans ce
   * même formulaire, et le montant qui fait l'opération dépendant du type, il
   * n'y a que sur ces valeurs-là qu'on puisse repartir sans se contredire.
   */
  const ligneAvecFrais = !!ligne.frais;

  // Persistant entre deux changements de type (la valeur saisie survit à un
  // aller-retour de sélecteur) ; inséré/retiré du formulaire par
  // rerenderChampsSelonType selon que le type a un montant libre ou non.
  const inputMontant = document.createElement("input");
  inputMontant.type = "number";
  inputMontant.step = "0.01";
  inputMontant.min = "0";
  const montantAffichable = ligneAvecFrais ? ligne.montant_hors_frais : ligne.montant;
  inputMontant.value = montantAffichable != null ? montantAffichable : "";
  // Une valeur TAPÉE n'est plus une recopie automatique : elle survit à un
  // changement de monnaie (cf. majChampsFrais).
  inputMontant.addEventListener("input", () => {
    montantRecuAutomatique = false;
  });

  // Type d'opération (pour reclasser) : les mêmes que la page Opérations, donc
  // sans les types dont l'extension qui les tient est éteinte (prêts, ou
  // suivi des remboursements).
  const selectType = document.createElement("select");
  TYPES_OPERATION_IMPORT.filter(
    (infoType) =>
      (pretsAccessibles() || !TYPES_DE_PRET.has(infoType.cle)) &&
      (suiviRemboursementsAccessible() || !TYPES_A_SUIVI_REMBOURSEMENT.has(infoType.cle))
  ).forEach((infoType) => {
    const opt = document.createElement("option");
    opt.value = infoType.cle;
    opt.textContent = labelTypeImport(infoType);
    selectType.appendChild(opt);
  });
  selectType.value = typeOperationLigne(ligne);

  function infoChoisi() {
    return TYPES_OPERATION_IMPORT.find((t) => t.cle === selectType.value);
  }

  const montantWrap = document.createElement("div");
  montantWrap.className = "ligne-edition-champ";
  const categorieWrap = document.createElement("div");
  categorieWrap.className = "ligne-edition-champ";
  const compteWrap = document.createElement("div");
  compteWrap.className = "ligne-edition-champ";
  const montantDuWrap = document.createElement("div");
  montantDuWrap.className = "ligne-edition-champ";
  const monnaieWrap = document.createElement("div");
  monnaieWrap.className = "ligne-edition-champ";
  const checklistWrap = document.createElement("div");
  checklistWrap.className = "ligne-edition-champ";
  const amortissementWrap = document.createElement("div");
  amortissementWrap.className = "ligne-edition-champ ligne-edition-amortissement";
  // « À DÉCLARER » (extension « Impôts », migration 0077) : la case part avec la ligne, déjà
  // cochée si une règle l'a posée. Proposée sur un type classique seulement — le serveur écarte
  // de toute façon l'étiquette d'une ligne qui n'est pas une entrée (cf. crud.operation_declarable).
  const impotsActif = BudgetApp.extensions.estActive("impots");
  const declarerWrap = document.createElement("div");
  declarerWrap.className = "ligne-edition-champ";
  const checkboxADeclarer = document.createElement("input");
  checkboxADeclarer.type = "checkbox";
  checkboxADeclarer.checked = !!ligne.a_declarer;
  const labelADeclarer = document.createElement("label");
  labelADeclarer.className = "case-a-cocher";
  labelADeclarer.append(checkboxADeclarer, document.createTextNode(` ${t("À déclarer")}`));
  declarerWrap.appendChild(labelADeclarer);

  /**
   * NOTES ET AMORTISSEMENT, DÈS L'IMPORT.
   *
   * Ni l'un ni l'autre ne se lit dans un relevé : ils naissent du moment où
   * l'on regarde la ligne et où l'on décide ce qu'elle est. C'est ici qu'on
   * sait qu'une facture s'étale sur douze mois ou qu'elle mérite un mot —
   * repousser les deux à « plus tard, page Opérations » obligeait à retrouver
   * une à une des opérations qu'on avait justement sous les yeux.
   *
   * La note est proposée pour TOUS les types (un virement la porte sur ses deux
   * jambes, cf. VirementCreate.notes). L'amortissement, lui, suit exactement
   * l'éligibilité de la page Opérations : ni virement (il ne pèse sur aucun
   * total de période), ni règlement (il solde une dette précise, à sa date).
   */
  const inputNotes = document.createElement("textarea");
  inputNotes.rows = 2;
  inputNotes.placeholder = t("ex. facture partagée avec Léa");
  inputNotes.value = ligne.notes || "";

  const checkboxAmorti = document.createElement("input");
  checkboxAmorti.type = "checkbox";
  checkboxAmorti.checked = !!ligne.amorti;

  const inputNbMois = document.createElement("input");
  inputNbMois.type = "number";
  inputNbMois.min = "1";
  inputNbMois.step = "1";

  const champsAmortissementBloc = document.createElement("div");
  champsAmortissementBloc.className = "ligne-edition-amortissement-champs";

  const labelDebut = document.createElement("label");
  labelDebut.textContent = t("Premier mois");
  const conteneurDebut = document.createElement("span");
  conteneurDebut.className = "champ-mois-annee";
  labelDebut.appendChild(conteneurDebut);

  const labelFin = document.createElement("label");
  labelFin.textContent = t("Dernier mois");
  const conteneurFin = document.createElement("span");
  conteneurFin.className = "champ-mois-annee";
  labelFin.appendChild(conteneurFin);

  const labelNbMois = document.createElement("label");
  labelNbMois.textContent = t("Nombre de mois");
  labelNbMois.appendChild(inputNbMois);

  // La MÊME règle de déduction que la page Opérations, à laquelle on passe les
  // champs de ce formulaire-ci (cf. completerAmortissement) : deux copies de
  // cette logique auraient fini par diverger.
  const champsAmortissement = {
    debutEl: creerChampMoisAnnee(conteneurDebut, () =>
      completerAmortissement("debut", champsAmortissement)
    ),
    finEl: creerChampMoisAnnee(conteneurFin, () =>
      completerAmortissement("fin", champsAmortissement)
    ),
    nbEl: inputNbMois,
  };
  champsAmortissement.debutEl.value = ligne.amortissement_debut
    ? ligne.amortissement_debut.slice(0, 7)
    : "";
  champsAmortissement.finEl.value = ligne.amortissement_fin
    ? ligne.amortissement_fin.slice(0, 7)
    : "";
  if (champsAmortissement.debutEl.value && champsAmortissement.finEl.value) {
    completerAmortissement("debut", champsAmortissement);
  }

  inputNbMois.addEventListener("input", () => {
    // Un amortissement sur zéro mois n'existe pas ; sur un seul, si.
    if (inputNbMois.value !== "" && Number(inputNbMois.value) < 1) inputNbMois.value = "1";
    completerAmortissement("nb", champsAmortissement);
  });

  champsAmortissementBloc.append(labelDebut, labelFin, labelNbMois);

  function majBlocAmortissement() {
    champsAmortissementBloc.style.display = checkboxAmorti.checked ? "" : "none";
  }

  checkboxAmorti.addEventListener("change", () => {
    // Amorcer sur le mois de l'opération, comme sur la page Opérations : c'est
    // le point de départ dans la très grande majorité des cas, et il ne reste
    // alors qu'une seule des deux autres cases à renseigner.
    if (
      checkboxAmorti.checked &&
      inputDate.value &&
      !champsAmortissement.debutEl.value &&
      !champsAmortissement.finEl.value &&
      !inputNbMois.value
    ) {
      champsAmortissement.debutEl.value = inputDate.value.slice(0, 7);
    }
    majBlocAmortissement();
  });
  majBlocAmortissement();

  // Monnaie envoyée / reçue et montant envoyé (cf. rerenderChampsMonnaie) :
  // c'est la reprise à la main d'un virement entre deux devises, quand le
  // relevé ne porte pas les colonnes qui le diraient.
  let selectMonnaie = null;
  let selectMonnaieEnvoyee = null;
  let inputMontantEnvoye = null;

  let inputFrais = null;
  let selectMonnaieFrais = null;

  let selectCategorie = null;
  // LA DÉCOUPE POSÉE PAR UNE RÈGLE s'affiche, et se corrige, comme dans le formulaire
  // d'une opération : des parts (catégorie, montant) et ce qu'il reste à placer.
  // `aDecoupeInitiale` dit que la ligne arrive découpée ; décocher la case la défait
  // et rend la main à la catégorie unique. Rien n'est réécrit tant qu'on n'enregistre
  // pas : on travaille sur une copie des parts.
  const aDecoupeInitiale = (ligne.decoupes || []).length > 0;
  const decoupeEdition = (ligne.decoupes || []).map((part) => ({
    categorie_id: part.categorie_id,
    montant: part.montant,
  }));
  let caseDecoupe = null;
  let blocDecoupe = null;
  let compteChamp = null;
  let compteChampEmetteur = null;
  let compteChampRecepteur = null;
  let inputMontantDu = null;
  // De quel côté « Montant à rembourser » est borné : plancher pour un prêt
  // reçu, plafond pour une dépense remboursable (cf. crud.erreur_montant_du).
  let montantDuEstPlancher = false;
  let montantDuAutoSync = true;
  let montantAffiche = null;
  let montantsParOperationId = {};
  // Le <label> du champ Montant : son texte change avec le type et les monnaies
  // (« Montant » / « Montant reçu », cf. majChampsFrais), et c'est
  // rerenderChampsSelonType qui le construit.
  let labelMontantElement = null;
  // Vrai quand « Montant » a été rempli TOUT SEUL, en recopiant le montant
  // envoyé parce que les deux monnaies coïncidaient. Une valeur automatique doit
  // repartir dès que le change réapparaît ; une valeur tapée par l'utilisateur,
  // jamais.
  let montantRecuAutomatique = false;

  /**
   * Le montant unique du relevé décrit-il ce qui PART plutôt que ce qui ARRIVE ?
   *
   * MIROIR de services/import_bancaire._orienter_jambe_virement, appliqué ici au
   * FORMULAIRE. Le serveur pose déjà cette question à la lecture du fichier,
   * mais seulement pour les lignes que le fichier ou une règle donne DÉJÀ comme
   * virement. Une ligne lue en « classique » puis reclassée à la main ici n'y
   * était jamais repassée : son montant restait du côté « reçu », et le champ
   * « Montant envoyé » s'ouvrait vide — à rebours du relevé, qui
   * décrit précisément l'argent qui sort.
   *
   * Les mêmes trois abstentions que côté serveur, pour les mêmes raisons :
   * ligne entrante (le montant lu est bien ce qui arrive), colonne « Montant
   * envoyé » lue (le fichier décrit les deux jambes), colonne de devise lue (le
   * montant peut être libellé dans une monnaie que le compte du relevé ne porte
   * pas, et deviner inverserait ce qu'on cherche à remettre à l'endroit).
   */
  function orienterVersJambeEmettrice() {
    if (ligne.montant_envoye != null) return false;
    const litMontantEnvoye =
      ligne.montant_envoye_hors_frais != null && !ligne.montant_envoye_deduit;
    if (litMontantEnvoye) return false;
    if (importConfigColonnes.some((c) => c.propriete === "monnaie")) return false;
    return (ligne.montant_signe || 0) < 0;
  }

  function totalCoche() {
    return Object.values(montantsParOperationId).reduce((s, m) => s + m, 0);
  }

  // Le montant d'une ligne de règlement est FIXE (celui du relevé bancaire) :
  // les liens de la checklist répartissent ce montant sur les cibles, jamais
  // l'inverse (le plafonnement à la saisie garantit qu'il n'est jamais
  // dépassé, cf. plafondLienImport). L'affichage indique la répartition.
  function majEtatReglement() {
    const total = totalCoche();
    if (montantAffiche) {
      montantAffiche.textContent = `${formatMontant(ligne.montant || 0, (ligne.monnaie_operation_id ?? ligne.monnaie_id ?? monnaieParDefautLigne(ligne)))} (affecté : ${formatMontant(total, (ligne.monnaie_operation_id ?? ligne.monnaie_id ?? monnaieParDefautLigne(ligne)))})`;
    }
    // « Lier » et non « Créer l'opération liée » : rien n'est créé avant la
    // confirmation de l'import, et un bouton qui annonce une création alors
    // qu'il mémorise un choix fait chercher longtemps l'opération promise.
    btnEnregistrer.textContent = infoChoisi().reglement && total > 0 ? t("Lier") : t("Enregistrer");
    return total;
  }

  // Plafond d'un lien pour une cible donnée : min(reste dû de la cible,
  // reste à affecter du montant FIXE de la ligne) — la part déjà affectée à
  // CETTE cible est exclue du "déjà affecté" puisqu'on la redéfinit. Retourne
  // aussi laquelle des deux limites mord, pour un message d'erreur précis.
  function plafondLienImport(operationCible) {
    const dejaAffecte = totalCoche() - (montantsParOperationId[operationCible.id] || 0);
    const restantARepartir = Math.max(0, (ligne.montant || 0) - dejaAffecte);
    return {
      max: Math.min(operationCible.montant_a_rembourser, restantARepartir),
      limiteParRemboursement: restantARepartir < operationCible.montant_a_rembourser,
    };
  }

  async function chargerChecklist(checklist) {
    try {
      const toutes = await apiFetch("/operations");
      const cibleEstPret = infoChoisi().cle === "remboursement_pret";
      const codeCible = CIBLE_PAR_TYPE_REGLEMENT[infoChoisi().cle];
      const eligibles = toutes.filter(
        (o) => o.type_code === codeCible && o.montant_a_rembourser > 0
      );
      checklist.innerHTML = "";
      if (eligibles.length === 0) {
        checklist.innerHTML =
          '<span class="hint">' +
          (cibleEstPret ? "Aucun prêt non remboursé disponible" : "Aucune dépense non remboursée disponible") +
          " — Enregistrer garde la ligne en attente (à lier une fois le reste de l'import confirmé), " +
          "ou reclasse-la dans une autre catégorie d'opération.</span>";
        return;
      }
      eligibles.forEach((o) => {
        const row = document.createElement("div");
        row.className = "checklist-row";

        const checkboxEl = document.createElement("input");
        checkboxEl.type = "checkbox";

        const montantInput = document.createElement("input");
        montantInput.type = "number";
        montantInput.step = "0.01";
        montantInput.min = "0";
        montantInput.max = o.montant_a_rembourser;
        montantInput.className = "remb-montant";
        montantInput.value = "0";

        const label = document.createElement("span");
        label.textContent = `${o.nature} — ${formatMontant(o.montant)} (reste dû : ${formatMontant(o.montant_a_rembourser)})`;

        checkboxEl.addEventListener("change", () => {
          if (checkboxEl.checked) {
            // Cocher tente de régler la totalité du reste dû, comme sur la
            // page Opérations — mais ici le montant de la ligne est FIXE
            // (celui du relevé) : si la totalité ne tient pas dans ce qui
            // reste à répartir, on plafonne et la case reste décochée
            // (cochée = cible réglée en totalité).
            const { max } = plafondLienImport(o);
            if (o.montant_a_rembourser > max + 1e-9) {
              checkboxEl.checked = false;
              montantInput.value = max.toFixed(2);
              showMessage(
                `Montant limité à ${formatMontant(max)} : le total affecté ne peut pas dépasser ` +
                  `le montant du remboursement (${formatMontant(ligne.montant || 0, (ligne.monnaie_operation_id ?? ligne.monnaie_id ?? monnaieParDefautLigne(ligne)))}).`,
                "error"
              );
            } else {
              montantInput.value = o.montant_a_rembourser.toFixed(2);
            }
          } else {
            montantInput.value = "0";
          }
          montantsParOperationId[o.id] = parseFloat(montantInput.value) || 0;
          majEtatReglement();
        });
        montantInput.addEventListener("input", () => {
          let valeur = parseFloat(montantInput.value || "0");
          const { max, limiteParRemboursement } = plafondLienImport(o);
          if (valeur > max + 1e-9) {
            valeur = max;
            montantInput.value = max.toFixed(2);
            showMessage(
              limiteParRemboursement
                ? `Montant limité à ${formatMontant(max)} : le total affecté ne peut pas dépasser ` +
                    `le montant du remboursement (${formatMontant(ligne.montant || 0, (ligne.monnaie_operation_id ?? ligne.monnaie_id ?? monnaieParDefautLigne(ligne)))}).`
                : `Montant limité à ${formatMontant(max)} : le reste dû de l'opération.`,
              "error"
            );
          }
          checkboxEl.checked = valeur > 0 && Math.abs(valeur - o.montant_a_rembourser) < 1e-9;
          montantsParOperationId[o.id] = valeur;
          majEtatReglement();
        });

        row.append(checkboxEl, montantInput, label);
        checklist.appendChild(row);
      });
    } catch (err) {
      checklist.innerHTML = "";
      showMessage(err.message, "error");
    } finally {
      majEtatReglement();
    }
  }

  // Menu des monnaies d'un compte donné, ou de toutes celles de l'app tant
  // qu'aucun compte n'est choisi (le champ reste utilisable, et la validation
  // finale reste celle du serveur).
  function creerSelectMonnaie(compteId, valeurInitiale) {
    const select = document.createElement("select");
    const monnaies = compteId
      ? monnaiesDuCompte(compteId).map((m) => ({
          id: m.monnaie_id,
          libelle: `${m.monnaie_nom} (${m.monnaie_symbole})`,
        }))
      : state.monnaies.map((m) => ({ id: m.id, libelle: `${m.nom} (${m.symbole})` }));
    monnaies.forEach((m) => {
      const opt = document.createElement("option");
      opt.value = m.id;
      opt.textContent = m.libelle;
      select.appendChild(opt);
    });
    if (valeurInitiale != null && monnaies.some((m) => m.id === valeurInitiale)) {
      select.value = String(valeurInitiale);
    }
    return select;
  }

  /**
   * Monnaie envoyée, monnaie du montant reçu, et montant envoyé.
   *
   * Une opération ordinaire n'affiche sa monnaie que si son compte en porte
   * plusieurs : sinon elle est déduite, et un menu à une entrée n'apporte rien.
   *
   * Un virement en porte deux : c'est ainsi qu'on envoie 100 € et qu'on en
   * reçoit 108 $ sans que l'app connaisse le moindre taux de change. Le champ
   * « Montant » du formulaire est ce qui ARRIVE ; « Montant envoyé » ce qui
   * PART, et il n'apparaît que si les deux monnaies diffèrent — il est alors
   * obligatoire, personne d'autre que le relevé ne peut le dire.
   */
  function rerenderChampsMonnaie() {
    const info = infoChoisi();
    monnaieWrap.innerHTML = "";
    selectMonnaie = null;
    selectMonnaieEnvoyee = null;
    inputMontantEnvoye = null;
    inputFrais = null;
    selectMonnaieFrais = null;

    // Sortie du type virement : « Montant » avait pu être vidé au profit de
    // « Montant envoyé » (orientation ci-dessous). On lui rend la valeur du
    // relevé, sinon le formulaire redemanderait un montant qu'il a déjà lu.
    if (!info.virement && !inputMontant.value && montantAffichable != null) {
      inputMontant.value = montantAffichable;
      montantRecuAutomatique = false;
    }

    if (info.reglement) return;

    if (!info.virement) {
      // LES FRAIS D'UNE LIGNE ORDINAIRE SE VOIENT ET SE CORRIGENT AUSSI. Le
      // champ « Montant » vaut HORS FRAIS dès que la ligne en porte (cf.
      // ligneAvecFrais) : sans ce second champ, le formulaire montrait un
      // nombre qui ne correspondait à rien du relevé, et rien ne disait
      // pourquoi. Le champ n'existait que dans le formulaire d'un virement —
      // c'est-à-dire nulle part sur une dépense par carte à l'étranger, qui est
      // pourtant le cas le plus ordinaire de frais.
      if (ligneAvecFrais) {
        const labelFraisSimple = document.createElement("label");
        labelFraisSimple.textContent = t("Frais");
        inputFrais = document.createElement("input");
        inputFrais.type = "number";
        inputFrais.step = "0.01";
        inputFrais.min = "0";
        inputFrais.value = ligne.frais != null ? ligne.frais : "";
        labelFraisSimple.appendChild(inputFrais);
        monnaieWrap.appendChild(labelFraisSimple);
        // LA DEVISE DES FRAIS SE CORRIGE AUSSI ICI. Sans ce menu, une ligne
        // ordinaire dont les frais tombaient dans une troisième monnaie ne
        // pouvait être réparée nulle part, et bloquait l'import entier. Il ne
        // propose que les monnaies de la ligne : ce sont les seules auxquelles
        // des frais puissent s'appliquer (cf. _appliquer_frais).
        const idsFrais = [
          ...new Set(
            [ligne.monnaie_envoyee_id, ligne.monnaie_id, ligne.monnaie_frais_id].filter(
              (id) => id != null
            )
          ),
        ];
        if (idsFrais.length > 1 || ligne.frais_incoherents) {
          const labelMonnaieFraisSimple = document.createElement("label");
          labelMonnaieFraisSimple.textContent = t("Monnaie des frais");
          selectMonnaieFrais = document.createElement("select");
          idsFrais.forEach((id) => {
            const monnaie = monnaieParId(id);
            if (!monnaie) return;
            const opt = document.createElement("option");
            opt.value = id;
            opt.textContent = `${monnaie.nom} (${monnaie.symbole})`;
            selectMonnaieFrais.appendChild(opt);
          });
          if (ligne.monnaie_frais_id != null) selectMonnaieFrais.value = String(ligne.monnaie_frais_id);
          labelMonnaieFraisSimple.appendChild(selectMonnaieFrais);
          monnaieWrap.appendChild(labelMonnaieFraisSimple);
        }
      }
      const compteId = compteChamp && compteChamp.estConfirme() ? Number(compteChamp.select.value) : null;
      if (compteId && monnaiesDuCompte(compteId).length <= 1) return;
      const label = document.createElement("label");
      label.textContent = t("Monnaie");
      selectMonnaie = creerSelectMonnaie(compteId, ligne.monnaie_id);
      label.appendChild(selectMonnaie);
      monnaieWrap.appendChild(label);
      return;
    }

    // Les deux champs portent DÉJÀ leur rôle : compteChampEmetteur est le
    // compte émetteur, quel que soit celui des deux que le fichier a fourni
    // (cf. rerenderChampsSelonType, qui applique `emetteurActif` une fois pour
    // toutes en les construisant). Le réappliquer ici les échangerait sur toute
    // ligne où le compte du fichier reçoit — et « Monnaie envoyée » se
    // remplirait alors depuis le compte récepteur, « Monnaie reçue » depuis
    // l'émetteur.
    const compteSourceId = compteChampEmetteur.estConfirme()
      ? Number(compteChampEmetteur.select.value)
      : null;
    const compteDestinationId = compteChampRecepteur.estConfirme()
      ? Number(compteChampRecepteur.select.value)
      : null;

    const labelMonnaieEnvoyee = document.createElement("label");
    labelMonnaieEnvoyee.textContent = t("Monnaie envoyée");
    // PAR DÉFAUT, LA MONNAIE D'EN FACE EST CELLE QUE LE RELEVÉ A LUE : un virement
    // sans change est le cas ordinaire, et c'est seulement quand les deux
    // diffèrent que l'utilisateur a quelque chose à dire. Si le compte d'en face
    // ne porte pas cette monnaie, `creerSelectMonnaie` retombe sur la sienne.
    const monnaieLue =
      ligne.monnaie_id ?? ligne.monnaie_operation_id ?? ligne.monnaie_envoyee_id ?? monnaieParDefautLigne(ligne);
    selectMonnaieEnvoyee = creerSelectMonnaie(compteSourceId, ligne.monnaie_envoyee_id ?? monnaieLue);
    labelMonnaieEnvoyee.appendChild(selectMonnaieEnvoyee);

    const labelMonnaieRecue = document.createElement("label");
    labelMonnaieRecue.textContent = t("Monnaie reçue");
    selectMonnaie = creerSelectMonnaie(compteDestinationId, ligne.monnaie_id ?? monnaieLue);
    labelMonnaieRecue.appendChild(selectMonnaie);

    const labelMontantEnvoye = document.createElement("label");
    labelMontantEnvoye.textContent = ligneAvecFrais
      ? "Montant envoyé (hors frais)"
      : "Montant envoyé";
    inputMontantEnvoye = document.createElement("input");
    inputMontantEnvoye.type = "number";
    inputMontantEnvoye.step = "0.01";
    inputMontantEnvoye.min = "0";
    const initialAffichable = ligneAvecFrais
      ? ligne.montant_envoye_hors_frais
      : ligne.montant_envoye;
    if (initialAffichable != null) {
      inputMontantEnvoye.value = initialAffichable;
    } else if (orienterVersJambeEmettrice() && montantAffichable != null) {
      // Le montant du relevé change de champ : c'est ce qui PART. Ce qui arrive
      // sur l'autre compte reste inconnu — l'app ne convertit rien — sauf si les
      // deux monnaies s'avèrent identiques, auquel cas majChampsFrais le recopie
      // juste en dessous.
      inputMontantEnvoye.value = montantAffichable;
      inputMontant.value = "";
      montantRecuAutomatique = false;
    } else {
      inputMontantEnvoye.value = "";
    }
    labelMontantEnvoye.appendChild(inputMontantEnvoye);

    // Frais et monnaie des frais. La monnaie ne propose que les deux du
    // virement : une commission prélevée dans une troisième ne se rattache à
    // aucun des deux montants, et c'est précisément ce que le serveur refuse
    // (cf. _appliquer_frais / frais_incoherents).
    const labelFrais = document.createElement("label");
    labelFrais.textContent = t("Frais");
    inputFrais = document.createElement("input");
    inputFrais.type = "number";
    inputFrais.step = "0.01";
    inputFrais.min = "0";
    inputFrais.value = ligne.frais != null ? ligne.frais : "";
    labelFrais.appendChild(inputFrais);

    const labelMonnaieFrais = document.createElement("label");
    labelMonnaieFrais.textContent = t("Monnaie des frais");
    selectMonnaieFrais = document.createElement("select");
    labelMonnaieFrais.appendChild(selectMonnaieFrais);

    // Les deux monnaies du virement changent avec les comptes et les menus :
    // le choix des frais les suit, en gardant la sélection quand elle reste
    // possible.
    function majOptionsMonnaieFrais() {
      const ids = [...new Set([Number(selectMonnaieEnvoyee.value), Number(selectMonnaie.value)])];
      const precedente = Number(selectMonnaieFrais.value) || ligne.monnaie_frais_id;
      selectMonnaieFrais.innerHTML = "";
      ids.forEach((id) => {
        const monnaie = monnaieParId(id);
        if (!monnaie) return;
        const opt = document.createElement("option");
        opt.value = id;
        opt.textContent = `${monnaie.nom} (${monnaie.symbole})`;
        selectMonnaieFrais.appendChild(opt);
      });
      if (ids.includes(precedente)) selectMonnaieFrais.value = String(precedente);
    }

    /**
     * Frais visibles SI ET SEULEMENT SI la ligne en porte ET que le virement
     * traverse deux monnaies : à monnaies égales leur devise ne départage plus
     * rien — ils entament le montant, un point c'est tout — et deux champs de
     * plus n'apporteraient que du bruit.
     */
    function majChampsFrais() {
      const memeMonnaie = selectMonnaie.value === selectMonnaieEnvoyee.value;
      labelMontantEnvoye.style.display = memeMonnaie ? "none" : "";
      const montrerFrais = ligneAvecFrais && !memeMonnaie;
      labelFrais.style.display = montrerFrais ? "" : "none";
      labelMonnaieFrais.style.display = montrerFrais ? "" : "none";
      if (montrerFrais) majOptionsMonnaieFrais();

      // « MONTANT REÇU » DÈS QU'IL Y A CHANGE. Le champ a toujours désigné ce
      // qui ARRIVE, mais son libellé ne le disait pas : à côté d'un « Montant
      // initial (envoyé) », un « Montant » nu se lisait comme le montant de
      // l'opération, et rien ne signalait qu'on attendait la contrepartie
      // convertie. Sans change, les deux jambes se confondent et « Montant »
      // reste le mot juste.
      if (labelMontantElement && labelMontantElement.firstChild) {
        labelMontantElement.firstChild.nodeValue = memeMonnaie ? "Montant" : "Montant reçu";
      }

      // SANS CHANGE, CE QUI ARRIVE EST CE QUI PART. Une ligne sortante reclassée
      // en virement porte son montant du côté « envoyé » (cf.
      // orienterVersJambeEmettrice) et laisse « Montant reçu » vide : le formulaire
      // réclamait alors une valeur que le relevé donne déjà, juste à côté, et
      // que personne ne peut inventer autrement. On la recopie dès que les deux
      // monnaies coïncident — c'est-à-dire dès que le compte en face est
      // désigné, ou qu'on choisit sa devise sur un compte multi-devises.
      //
      // Le champ RESTE modifiable : les deux montants peuvent différer même à
      // monnaie égale (frais prélevés en route), et c'est le relevé qui tranche.
      if (memeMonnaie && !inputMontant.value) {
        const envoye = inputMontantEnvoye.value || ligne.montant_envoye;
        if (envoye) {
          inputMontant.value = envoye;
          montantRecuAutomatique = true;
        }
      } else if (!memeMonnaie && montantRecuAutomatique) {
        // Le change RÉAPPARAÎT (on vient de désigner un compte en face dans une
        // autre devise) : la recopie ci-dessus n'a plus lieu d'être. La laisser
        // afficherait un montant reçu égal au montant envoyé, c'est-à-dire un
        // taux de change inventé à 1 — exactement ce que l'app refuse de faire.
        inputMontant.value = "";
        montantRecuAutomatique = false;
      }
    }
    selectMonnaie.addEventListener("change", majChampsFrais);
    selectMonnaieEnvoyee.addEventListener("change", majChampsFrais);

    monnaieWrap.append(labelMonnaieEnvoyee, labelMonnaieRecue, labelMontantEnvoye, labelFrais, labelMonnaieFrais);
    majChampsFrais();
  }

  // Reconstruit montant/catégorie/compte/monnaies/montant à rembourser/checklist
  // selon le type actuellement sélectionné : appelé une fois à l'ouverture, puis
  // à chaque changement du sélecteur de type. Pas de champ Statut : une ligne
  // de relevé bancaire est déjà passée en banque, l'opération est toujours réelle.
  /**
   * Le menu de découpage d'une ligne découpée par une règle : la case, les parts, le
   * compteur. Mêmes classes que celui du formulaire d'opération (`.decoupe-part`…),
   * pour qu'on y reconnaisse le même geste. `labelCategorie` est le menu de catégorie
   * unique, masqué tant que la découpe est cochée — les deux répondent à la même
   * question et s'excluent.
   */
  function construireEditeurDecoupeApercu(labelCategorie) {
    const conteneur = document.createElement("div");

    const labelCase = document.createElement("label");
    labelCase.className = "decoupe-case";
    caseDecoupe = document.createElement("input");
    caseDecoupe.type = "checkbox";
    caseDecoupe.checked = true;
    labelCase.appendChild(caseDecoupe);
    labelCase.appendChild(document.createTextNode(" " + t("Découper entre plusieurs catégories")));
    conteneur.appendChild(labelCase);

    blocDecoupe = document.createElement("div");
    const liste = document.createElement("div");
    const total = document.createElement("div");
    total.className = "decoupe-total";
    const ajouter = document.createElement("button");
    ajouter.type = "button";
    ajouter.textContent = "+ " + t("Ajouter une part");
    blocDecoupe.append(liste, total, ajouter);
    conteneur.appendChild(blocDecoupe);

    const majTotal = () => {
      const reparti = decoupeEdition.reduce((somme, part) => somme + (part.montant || 0), 0);
      const montant = parseFloat(inputMontant.value) || 0;
      const reste = Math.round((montant - reparti) * 100) / 100;
      const monnaie = ligne.monnaie_operation_id ?? ligne.monnaie_id ?? monnaieParDefautLigne(ligne);
      total.textContent =
        reste === 0
          ? `${t("Réparti")} : ${formatMontant(reparti, monnaie)}`
          : `${t("Réparti")} : ${formatMontant(reparti, monnaie)} — ${t("reste à placer")} : ${formatMontant(reste, monnaie)}`;
      total.classList.toggle("erreur", reste !== 0);
    };

    const rendreParts = () => {
      liste.innerHTML = "";
      decoupeEdition.forEach((part, index) => {
        const rangee = document.createElement("div");
        rangee.className = "decoupe-part";
        const choix = document.createElement("select");
        choix.className = "decoupe-categorie";
        categoriesProposables(part.categorie_id).forEach((c) => {
          const opt = document.createElement("option");
          opt.value = c.id;
          opt.textContent = c.nom;
          choix.appendChild(opt);
        });
        choix.value = String(part.categorie_id);
        choix.addEventListener("change", () => {
          part.categorie_id = Number(choix.value);
        });
        const montant = document.createElement("input");
        montant.type = "number";
        montant.step = "0.01";
        montant.min = "0";
        montant.className = "decoupe-montant";
        montant.value = part.montant != null ? part.montant : "";
        montant.addEventListener("input", () => {
          part.montant = parseFloat(montant.value) || 0;
          majTotal();
        });
        const retirer = document.createElement("button");
        retirer.type = "button";
        retirer.className = "decoupe-retirer danger";
        retirer.innerHTML = "&times;";
        retirer.title = t("Retirer cette part");
        retirer.addEventListener("click", () => {
          decoupeEdition.splice(index, 1);
          rendreParts();
        });
        rangee.append(choix, montant, retirer);
        liste.appendChild(rangee);
      });
      majTotal();
    };

    ajouter.addEventListener("click", () => {
      const premiere = categoriesProposables(null)[0];
      decoupeEdition.push({ categorie_id: premiere ? premiere.id : null, montant: 0 });
      rendreParts();
    });
    inputMontant.addEventListener("input", majTotal);

    const majVisibilite = () => {
      const active = caseDecoupe.checked;
      labelCategorie.style.display = active ? "none" : "";
      blocDecoupe.style.display = active ? "" : "none";
    };
    caseDecoupe.addEventListener("change", majVisibilite);
    rendreParts();
    majVisibilite();
    return conteneur;
  }

  // LA CATÉGORIE ET LE TYPE, ENSEMBLE (migration 0090). `categorieEdition` est la catégorie
  // ordinaire en cours ; `memoireLigne` retient le type et la catégorie d'avant le virement, pour
  // les rendre si l'on revient en arrière avant d'enregistrer.
  let categorieEdition = ligne.categorie_id ?? null;
  let memoireLigne = null;
  let typeEdition = null;

  function changerTypeLigne(nouveau, { categorieId = undefined } = {}) {
    const avant = typeEdition;
    if (nouveau === "virement" && avant !== "virement" && categorieId === undefined) {
      memoireLigne = { type: avant, categorieId: categorieEdition };
    }
    if (avant === "virement" && nouveau !== "virement") {
      if (categorieId !== undefined) categorieEdition = categorieId;
      else if (memoireLigne) categorieEdition = memoireLigne.categorieId;
      memoireLigne = null;
    }
    selectType.value = nouveau;
    typeEdition = nouveau;
    rerenderChampsSelonType();
  }

  function basculerLigneSelonCategorie() {
    const vi = categorieVirements();
    const choisie = Number(selectCategorie.value) || null;
    if (!vi || !choisie) return;
    if (choisie === vi.id) {
      if (typeEdition === "virement") return;
      memoireLigne = { type: typeEdition, categorieId: categorieEdition };
      changerTypeLigne("virement", { categorieId: null });
      return;
    }
    categorieEdition = choisie;
    if (typeEdition === "virement") {
      const retour =
        memoireLigne && TYPES_CATEGORIE_LIBRE.has(memoireLigne.type) ? memoireLigne.type : "classique";
      changerTypeLigne(retour, { categorieId: choisie });
    }
  }

  function rerenderChampsSelonType() {
    const info = infoChoisi();

    montantWrap.innerHTML = "";
    const labelMontant = document.createElement("label");
    labelMontant.textContent = t("Montant");
    // majChampsFrais le renomme en « Montant reçu » dès qu'un virement traverse
    // deux monnaies : il lui faut donc une référence, et non une variable locale.
    labelMontantElement = labelMontant;
    if (info.reglement) {
      montantAffiche = document.createElement("span");
      montantAffiche.className = "montant neutre";
      labelMontant.appendChild(montantAffiche);
    } else {
      montantAffiche = null;
      labelMontant.appendChild(inputMontant);
    }
    montantWrap.appendChild(labelMontant);

    categorieWrap.innerHTML = "";
    // UN VIREMENT GARDE LE MENU (migration 0090) : il y porte « Virements internes », et choisir
    // cette catégorie sur une autre ligne en fait un virement (cf. basculerLigneSelonCategorie).
    if (info.categorieLibre || info.virement) {
      const label = document.createElement("label");
      label.textContent = t("Catégorie");
      selectCategorie = document.createElement("select");
      const vi = categorieVirements();
      categoriesProposables(categorieEdition).forEach((c) => {
        const opt = document.createElement("option");
        opt.value = c.id;
        opt.textContent = libelleCategorie(c.nom);
        selectCategorie.appendChild(opt);
      });
      // Une ligne venant d'un type sans catégorie n'en a aucune à
      // présélectionner : le premier choix de la liste fera l'affaire.
      if (info.virement && vi) {
        selectCategorie.value = String(vi.id);
      } else if (categorieEdition != null && !(vi && categorieEdition === vi.id)) {
        selectCategorie.value = String(categorieEdition);
      } else if (vi && Number(selectCategorie.value) === vi.id) {
        selectCategorie.selectedIndex = [...selectCategorie.options].findIndex(
          (o) => Number(o.value) !== vi.id
        );
      }
      selectCategorie.addEventListener("change", basculerLigneSelonCategorie);
      label.appendChild(selectCategorie);
      categorieWrap.appendChild(label);
      if (info.cle === "classique" && aDecoupeInitiale && !info.virement) {
        categorieWrap.appendChild(construireEditeurDecoupeApercu(label));
      } else {
        caseDecoupe = null;
        blocDecoupe = null;
      }
    } else {
      selectCategorie = null;
      caseDecoupe = null;
      blocDecoupe = null;
    }

    compteWrap.innerHTML = "";
    if (info.virement) {
      // Les deux comptes sont toujours actifs et modifiables. Celui déduit du
      // signe du montant bancaire d'origine (ligne.compte_id) vient du
      // fichier ; l'autre (ligne.compte_id_autre) est renseigné à la main —
      // dès que les deux sont connus, Enregistrer crée un vrai virement
      // double-écriture (cf. resoudreCompteId / rolesCompteVirement) plutôt
      // que la simple écriture sur un seul compte.
      const { emetteurActif } = rolesCompteVirement(ligne);
      const valeurAutre = ligne.compte_id_autre ?? null;

      const labelEmetteur = document.createElement("label");
      labelEmetteur.textContent = t("Compte émetteur");
      compteChampEmetteur = creerChampCompteAvecIndice(emetteurActif ? ligne.compte_id : valeurAutre);
      labelEmetteur.appendChild(compteChampEmetteur.wrap);

      const labelRecepteur = document.createElement("label");
      labelRecepteur.textContent = t("Compte récepteur");
      compteChampRecepteur = creerChampCompteAvecIndice(!emetteurActif ? ligne.compte_id : valeurAutre);
      labelRecepteur.appendChild(compteChampRecepteur.wrap);

      compteWrap.append(labelEmetteur, labelRecepteur);
      compteChamp = null;
      // Les monnaies dépendent des deux comptes choisis : le bloc se
      // reconstruit à chaque changement, pas seulement au changement de type.
      compteChampEmetteur.select.addEventListener("change", rerenderChampsMonnaie);
      compteChampRecepteur.select.addEventListener("change", rerenderChampsMonnaie);
    } else {
      compteChampEmetteur = null;
      compteChampRecepteur = null;
      const label = document.createElement("label");
      label.textContent = "Compte";
      compteChamp = creerChampCompteAvecIndice(ligne.compte_id);
      label.appendChild(compteChamp.wrap);
      compteWrap.appendChild(label);
      compteChamp.select.addEventListener("change", rerenderChampsMonnaie);
    }
    rerenderChampsMonnaie();

    montantDuWrap.innerHTML = "";
    // LES DEUX TYPES REMBOURSABLES, et non plus la seule dépense remboursable :
    // un relevé qui décrit un prêt reçu ne dit jamais ses intérêts, mais c'est
    // ici qu'on peut les ajouter sans avoir à retrouver l'opération après coup.
    if (TYPES_REMBOURSABLES.has(info.cle)) {
      montantDuEstPlancher = info.cle === "pret";
      const label = document.createElement("label");
      label.textContent = t("Montant à rembourser");
      inputMontantDu = document.createElement("input");
      inputMontantDu.type = "number";
      inputMontantDu.step = "0.01";
      const montantActuel = parseFloat(inputMontant.value) || 0;
      // Bornes exactement inverses (cf. majBornesMontantDu) : on ne se fait pas
      // rendre plus qu'on n'a avancé, on ne rend pas moins qu'on n'a reçu.
      if (montantDuEstPlancher) {
        inputMontantDu.min = montantActuel;
      } else {
        inputMontantDu.min = "0";
        inputMontantDu.max = montantActuel;
      }
      inputMontantDu.value =
        ligne.montant_du !== null && ligne.montant_du !== undefined ? ligne.montant_du : montantActuel;
      montantDuAutoSync = true;
      inputMontantDu.addEventListener("input", () => {
        montantDuAutoSync = false;
      });
      label.appendChild(inputMontantDu);
      montantDuWrap.appendChild(label);
    } else {
      inputMontantDu = null;
    }

    checklistWrap.innerHTML = "";
    montantsParOperationId = {};
    if (info.reglement) {
      const label = document.createElement("label");
      label.textContent = info.cle === "remboursement_pret" ? t("Prêts réglés") : t("Dépenses réglées");
      const checklist = document.createElement("div");
      checklist.className = "checklist";
      checklist.textContent = "Chargement...";
      label.appendChild(checklist);
      checklistWrap.appendChild(label);
      chargerChecklist(checklist);
    }

    // Même éligibilité que sur la page Opérations (cf.
    // updateOperationTypeFields). La case est décochée dès qu'elle cesse d'être
    // proposée : cochée mais invisible, elle continuerait d'envoyer un
    // amortissement que l'écran ne montre plus.
    const amortissementEligible = !info.virement && !info.reglement;
    if (!amortissementEligible) checkboxAmorti.checked = false;
    amortissementWrap.style.display = amortissementEligible ? "" : "none";
    majBlocAmortissement();
    // Décochée dès qu'elle cesse d'être proposée, pour la même raison que l'amortissement.
    const declarerEligible = impotsActif && info.cle === "classique";
    if (!declarerEligible) checkboxADeclarer.checked = false;
    declarerWrap.style.display = declarerEligible ? "" : "none";

    majEtatReglement();
  }

  // Tant que "Montant à rembourser" n'a pas été touché à la main, il suit le
  // montant (comportement par défaut : tout est à rembourser, un prêt sans
  // intérêts), comme sur la page Opérations. Sa borne suit le montant elle
  // aussi, du côté que le type impose.
  inputMontant.addEventListener("input", () => {
    if (!inputMontantDu) return;
    const montant = inputMontant.value || "0";
    if (montantDuAutoSync) inputMontantDu.value = montant;
    if (montantDuEstPlancher) inputMontantDu.min = montant;
    else inputMontantDu.max = montant;
  });

  const labelDate = document.createElement("label");
  labelDate.textContent = "Date";
  labelDate.appendChild(inputDate);
  const labelNature = document.createElement("label");
  labelNature.textContent = "Nature";
  labelNature.appendChild(inputNature);
  const labelType = document.createElement("label");
  labelType.textContent = "Type d'opération";
  labelType.appendChild(selectType);

  // La case « Amortie » et son bloc de trois champs, montés une fois pour
  // toutes : seul leur affichage dépend du type (cf. rerenderChampsSelonType).
  const labelAmorti = document.createElement("label");
  labelAmorti.className = "case-a-cocher";
  labelAmorti.append(checkboxAmorti, document.createTextNode(` ${t("Amortie sur plusieurs mois")}`));
  amortissementWrap.append(labelAmorti, champsAmortissementBloc);

  const labelNotes = document.createElement("label");
  labelNotes.className = "ligne-edition-notes";
  labelNotes.textContent = t("Notes");
  labelNotes.appendChild(inputNotes);

  const formulaire = document.createElement("div");
  formulaire.className = "ligne-edition-form";
  formulaire.append(
    labelDate,
    labelNature,
    montantWrap,
    labelType,
    categorieWrap,
    compteWrap,
    monnaieWrap,
    montantDuWrap,
    checklistWrap,
    amortissementWrap,
    declarerWrap,
    labelNotes
  );

  const tdFormulaire = document.createElement("td");
  tdFormulaire.colSpan = infoTypeSection.categorieLibre || infoTypeSection.virement ? 8 : 7;
  tdFormulaire.appendChild(formulaire);

  const btnEnregistrer = document.createElement("button");
  btnEnregistrer.type = "button";
  btnEnregistrer.className = "primary";
  btnEnregistrer.textContent = t("Enregistrer");
  const btnAnnuler = document.createElement("button");
  btnAnnuler.type = "button";
  btnAnnuler.textContent = "Annuler";
  // DEUX COLONNES POUR LES BOUTONS, et plus une chacun. La ligne en édition
  // reprenait la colonne « Sélection » du tableau pour n'y écrire qu'un « - » :
  // une case entière consacrée à dire qu'il n'y a rien à dire, pendant que les
  // deux seuls boutons du formulaire se serraient dans la case d'à côté. Les
  // boutons prennent donc les deux, et la ligne occupe exactement la même
  // largeur qu'avant — on ne fait que répartir autrement.
  const tdActions = document.createElement("td");
  tdActions.className = "ligne-edition-actions";
  tdActions.colSpan = 2;
  tdActions.appendChild(btnEnregistrer);
  tdActions.appendChild(btnAnnuler);

  tr.append(tdLigne, tdFormulaire, tdActions);

  rerenderChampsSelonType();
  typeEdition = selectType.value;
  selectType.addEventListener("change", () => changerTypeLigne(selectType.value));

  btnAnnuler.addEventListener("click", () => {
    ligneApercuEnEdition = null;
    renderImportApercu();
  });

  function resoudreCompteId(info) {
    if (info.virement) {
      const { emetteurActif } = rolesCompteVirement(ligne);
      const champActif = emetteurActif ? compteChampEmetteur : compteChampRecepteur;
      return champActif.estConfirme() ? Number(champActif.select.value) : null;
    }
    return compteChamp.estConfirme() ? Number(compteChamp.select.value) : null;
  }

  // Le compte "autre" (complément manuel du second côté d'un virement, cf.
  // compteWrap ci-dessus) : renvoie null tant qu'il n'a pas été confirmé,
  // même chose pour tout type non-virement (champ inexistant).
  function resoudreCompteIdAutre(info) {
    if (!info.virement) return null;
    const { emetteurActif } = rolesCompteVirement(ligne);
    const champAutre = emetteurActif ? compteChampRecepteur : compteChampEmetteur;
    return champAutre.estConfirme() ? Number(champAutre.select.value) : null;
  }

  // Création immédiate d'une opération de règlement liée (checklist cochée) :
  // hors du confirm groupé, via l'endpoint /operations habituel.
  /**
   * MÉMORISE LES LIENS SUR LA LIGNE, SANS RIEN CRÉER.
   *
   * CE QUI A CHANGÉ, ET POURQUOI. Cette fonction faisait un POST /operations
   * immédiat : l'opération existait en base, la ligne quittait l'aperçu, et
   * tout cela AVANT que l'import soit confirmé. Trois conséquences, toutes
   * mauvaises — on ne pouvait plus se raviser, un aperçu abandonné laissait
   * derrière lui des opérations que personne n'avait validées, et la moitié
   * d'un même relevé entrait en base à un moment, l'autre moitié à un autre.
   *
   * La ligne reste donc à l'écran, marquée « liée », et ses liens voyagent
   * avec son override jusqu'à la confirmation, qui les pose après avoir créé
   * l'opération (cf. services/import_bancaire.confirmer). « Confirmer
   * l'import » redevient ce qu'il annonce : le seul geste qui écrit.
   */
  function memoriserReglementLie(info, compteId) {
    const operationsRemboursees = Object.entries(montantsParOperationId)
      .filter(([, montant]) => montant > 0)
      .map(([operationId, montant]) => ({ operation_id: Number(operationId), montant }));
    // Une opération est toujours libellée dans une monnaie du compte
    // (OperationCreate.monnaie_id est obligatoire) : le formulaire de règlement
    // n'en propose aucune — il n'a pas de bloc monnaie, cf. rerenderChampsMonnaie
    // — donc on prend celle que l'import a résolue pour la ligne, et la première
    // du compte si elle ne lui appartient pas. Sans ça, la création partait sans
    // monnaie et revenait en « Field required ».
    const monnaiesCompte = monnaiesDuCompte(compteId);
    const monnaieResolue = ligne.monnaie_operation_id ?? ligne.monnaie_id ?? null;
    const monnaieId = monnaiesCompte.some((m) => m.monnaie_id === monnaieResolue)
      ? monnaieResolue
      : monnaiesCompte.length > 0
      ? monnaiesCompte[0].monnaie_id
      : null;
    if (monnaieId === null) {
      showMessage(t("Ce compte ne porte aucune monnaie : impossible de créer l'opération."), "error");
      return;
    }
    // MÊME FORME QUE L'OVERRIDE ORDINAIRE, plus les liens : la confirmation
    // relit le fichier et applique ces champs par-dessus la ligne qu'elle en
    // tire (cf. schemas.ImportLigneOverride). Le montant reste celui du RELEVÉ
    // et non la somme des liens — un remboursement peut rester partiellement
    // affecté, et c'est bien ce qui est passé en banque qui fait l'opération.
    const override = {
      date: inputDate.value,
      nature: inputNature.value.trim(),
      montant: ligne.montant || 0,
      type_code: info.cle,
      compte_id: compteId,
      monnaie_id: monnaieId,
      notes: inputNotes.value.trim() || null,
      operations_remboursees: operationsRemboursees,
    };
    importLigneOverrides[ligne.ligne] = override;
    Object.assign(ligne, override);
    // Gardé À PART de la ligne : `ImportLigne` n'a pas de champ pour les liens,
    // et l'écran en a pourtant besoin pour écrire « liée à 2 opérations ».
    importLignesLiees[ligne.ligne] = operationsRemboursees;
    ligneApercuEnEdition = null;
    showMessage(
      t("« {nature} » sera liée à {n} opération(s) à la confirmation.", {
        nature: override.nature,
        n: operationsRemboursees.length,
      }),
      "success"
    );
    renderImportApercu();
  }

  btnEnregistrer.addEventListener("click", async () => {
    if (!inputDate.value) {
      showMessage(t("Renseigne une date valide."), "error");
      return;
    }
    if (!inputNature.value.trim()) {
      showMessage(t("La nature ne peut pas être vide."), "error");
      return;
    }

    const info = infoChoisi();

    const compteId = resoudreCompteId(info);
    if (compteId === null) {
      showMessage(t("Choisis un compte."), "error");
      return;
    }
    const compteIdAutre = resoudreCompteIdAutre(info);
    const monnaieId = selectMonnaie ? Number(selectMonnaie.value) || null : null;
    const monnaieEnvoyeeId = selectMonnaieEnvoyee
      ? Number(selectMonnaieEnvoyee.value) || null
      : null;
    // Un virement d'un compte vers lui-même est une conversion de change : il
    // n'est valide qu'entre deux monnaies différentes du compte (même règle
    // que schemas.VirementCreate).
    if (
      compteIdAutre !== null &&
      compteIdAutre === compteId &&
      (monnaieId === null || monnaieId === monnaieEnvoyeeId)
    ) {
      showMessage(t("Le compte émetteur et le compte récepteur doivent être différents, sauf pour une ") +
          "conversion entre deux monnaies d'un même compte.",
        "error"
      );
      return;
    }

    // Deux monnaies : le montant envoyé ne se déduit d'aucun taux de change,
    // seul le relevé le connaît.
    let montantEnvoye = null;
    if (info.virement && monnaieId !== null && monnaieId !== monnaieEnvoyeeId) {
      montantEnvoye = parseFloat(inputMontantEnvoye ? inputMontantEnvoye.value : "");
      if (isNaN(montantEnvoye) || montantEnvoye <= 0) {
        showMessage(t("Renseigne le montant envoyé : les deux monnaies diffèrent et l'app ne convertit rien."),
          "error"
        );
        return;
      }
    }

    if (info.reglement && totalCoche() > 0) {
      memoriserReglementLie(info, compteId);
      return;
    }

    let montantSaisi;
    if (info.reglement) {
      // Rien de coché : simple reclassement en attente de liaison, le montant
      // bancaire d'origine sert d'espace réservé.
      montantSaisi = ligne.montant || 0;
    } else {
      montantSaisi = parseFloat(inputMontant.value);
      if (isNaN(montantSaisi) || montantSaisi < 0) {
        // Le champ ne s'appelle plus « Montant » quand le virement traverse
        // deux monnaies : le message doit nommer ce qu'on demande, sinon on
        // cherche un champ qui n'existe pas sous ce nom à l'écran.
        showMessage(
          montantEnvoye !== null
            ? "Renseigne le montant reçu : les deux monnaies diffèrent et l'app ne convertit rien."
            : "Renseigne un montant valide.",
          "error"
        );
        return;
      }
    }

    // Amortissement : les deux bornes sont les seules obligatoires (le nombre
    // de mois s'en déduit), et il ne compte que là où il est proposé — la case
    // d'un type devenu inéligible a déjà été décochée par
    // rerenderChampsSelonType, mais le lire une seconde fois ici garde
    // l'enregistrement indépendant de l'ordre des rendus.
    const amortiCoche = checkboxAmorti.checked && !info.virement && !info.reglement;
    if (
      amortiCoche &&
      (!champsAmortissement.debutEl.value || !champsAmortissement.finEl.value)
    ) {
      showMessage(
        t("Renseigne deux des trois cases d'amortissement (premier mois, dernier mois, nombre de mois)."),
        "error"
      );
      return;
    }

    // Les quatre types sans catégorie libre n'en portent aucune : le serveur
    // l'efface de toute façon (cf. _normaliser_categorie_selon_type).
    let categorieId = null;
    // LA DÉCOUPE : cochée, ses parts remplacent celles de la règle et la catégorie
    // unique disparaît ; décochée, la ligne n'est plus découpée (liste vide envoyée
    // explicitement — `undefined` voudrait dire « n'y touche pas »). L'action de
    // l'utilisateur prime sur la règle.
    const decoupeActive = !!(caseDecoupe && caseDecoupe.checked && info.cle === "classique");
    let decoupesSaisies;
    if (decoupeActive) {
      const parts = decoupeEdition.filter((part) => part.categorie_id && part.montant > 0);
      if (parts.length < 2) {
        showMessage(t("Une découpe compte au moins deux parts remplies."), "error");
        return;
      }
      if (new Set(parts.map((part) => part.categorie_id)).size !== parts.length) {
        showMessage(t("Une même catégorie ne peut pas apparaître deux fois dans la découpe."), "error");
        return;
      }
      const reparti = parts.reduce((somme, part) => somme + part.montant, 0);
      if (!ligneAvecFrais && Math.abs(reparti - montantSaisi) > 0.005) {
        showMessage(
          t("La somme des parts doit valoir le montant de l'opération."),
          "error"
        );
        return;
      }
      decoupesSaisies = parts.map((part) => ({
        categorie_id: part.categorie_id,
        montant: part.montant,
      }));
    } else if (aDecoupeInitiale) {
      decoupesSaisies = [];
    }
    if (info.categorieLibre && !decoupeActive) {
      if (!selectCategorie.value) {
        showMessage(t("Choisis une catégorie."), "error");
        return;
      }
      categorieId = Number(selectCategorie.value);
    }
    // Un virement porte la catégorie des virements internes (migration 0090), comme au serveur.
    if (info.virement && categorieVirements()) categorieId = categorieVirements().id;

    // Une monnaie que le formulaire n'a PAS demandée garde celle que l'import a
    // résolue : le menu est absent dès que le compte est mono-monnaie (rien à
    // choisir) ou que le type est un règlement, et écraser avec null ferait
    // réapparaître « devise à mapper » sur une ligne dont on n'a fait que
    // changer la catégorie — bloquant l'import entier (cf.
    // updateBtnImportConfirmerEtat). Même chose pour la monnaie envoyée hors
    // virement : elle n'a pas de champ, donc rien à écraser.
    const override = {
      date: inputDate.value,
      nature: inputNature.value.trim(),
      montant: montantSaisi,
      type_code: info.cle,
      categorie_id: categorieId,
      compte_id: compteId,
      compte_id_autre: info.virement ? compteIdAutre : null,
      montant_du: inputMontantDu ? parseFloat(inputMontantDu.value) || 0 : null,
      monnaie_id: selectMonnaie ? monnaieId : ligne.monnaie_id ?? null,
      montant_envoye: info.virement ? montantEnvoye : ligne.montant_envoye ?? null,
      monnaie_envoyee_id: info.virement
        ? monnaieEnvoyeeId
        : ligne.monnaie_envoyee_id ?? null,
      notes: inputNotes.value.trim() || null,
      // La case fait foi, et les bornes ne partent qu'avec elle : décocher doit
      // effacer un étalement précédemment saisi, pas le laisser filer au
      // serveur (cf. ImportLigneOverride.amorti).
      amorti: amortiCoche,
      amortissement_debut: amortiCoche ? `${champsAmortissement.debutEl.value}-01` : null,
      amortissement_fin: amortiCoche ? `${champsAmortissement.finEl.value}-01` : null,
      // Extension éteinte : le champ ne part pas, et ce qu'une règle a posé reste tel quel.
      ...(impotsActif ? { a_declarer: checkboxADeclarer.checked } : {}),
    };

    // Les frais accompagnent TOUJOURS des montants saisis hors frais, même
    // quand le formulaire ne les montre pas (monnaies redevenues égales, type
    // reclassé) : c'est leur présence qui dit au serveur comment relire ces
    // montants, et les taire lui ferait prendre une base pour un résultat. Le
    // serveur les impute alors à la jambe que leur devise désigne — ajoutés à
    // l'émetteur, retranchés au récepteur (cf. _reimputer_frais).
    if (ligneAvecFrais) {
      // AUCUN CHAMP NE LES PORTE ? ON LES GARDE TELS QUELS. Le formulaire n'en
      // montre pas sur un règlement (il n'a ni montant libre ni monnaie), et
      // n'en montrait pas non plus, avant, sur une ligne ordinaire. Un champ
      // absent était lu comme un champ vide, donc comme « zéro frais » : la
      // ligne perdait sa commission au seul motif qu'on venait de changer sa
      // catégorie, et le montant importé retombait sous celui du relevé.
      const fraisSaisis = inputFrais ? parseFloat(inputFrais.value) : NaN;
      override.frais = inputFrais ? (isNaN(fraisSaisis) ? 0 : fraisSaisis) : ligne.frais;
      // UN MENU MASQUÉ N'EST PAS UN MENU VIDÉ. À monnaies égales, le menu des
      // frais d'un virement n'est jamais rempli : sa valeur vide partait en
      // `null`, que l'aperçu lisait « devise effacée » (ligne débloquée) et le
      // serveur « ne touche pas » (devise du fichier gardée, import bloqué).
      // Les deux jambes n'ayant qu'une monnaie, c'est celle des frais.
      const fraisChoisis = selectMonnaieFrais && Number(selectMonnaieFrais.value);
      override.monnaie_frais_id =
        fraisChoisis ||
        (info.virement && override.monnaie_id != null &&
        override.monnaie_id === override.monnaie_envoyee_id
          ? override.monnaie_id
          : ligne.monnaie_frais_id ?? null);
    }
    const typeAvant = typeOperationLigne(ligne);
    // Seulement quand l'écran a quelque chose à dire des parts : `undefined` ferait
    // écrire « decoupes: undefined » sur la ligne par Object.assign.
    if (decoupesSaisies !== undefined) override.decoupes = decoupesSaisies;
    importLigneOverrides[ligne.ligne] = override;
    Object.assign(ligne, override);

    // LES MONTANTS QUE LE FORMULAIRE A RÉELLEMENT DEMANDÉS deviennent la base
    // hors frais du recalcul ci-dessous (miroir de confirmer(), côté serveur).
    // Ils valent hors frais dès que le formulaire montre les frais (cf.
    // ligneAvecFrais) ; sans frais, hors frais et montant réel se confondent.
    //
    // Un montant envoyé saisi est le cas qui compte : sans lui, reclasser une
    // ligne EN virement repartait des montants du FICHIER, qui n'en portent
    // aucun, et la seconde jambe disparaissait aussitôt enregistrée — donc la
    // seconde devise avec elle.
    if (ligneAvecFrais || montantEnvoye !== null) {
      ligne.montant_hors_frais = override.montant;
    }
    if (montantEnvoye !== null) {
      ligne.montant_envoye_hors_frais = override.montant_envoye;
      // Un montant envoyé SAISI n'est plus déduit : la ligne décrit désormais
      // ses deux jambes comme le ferait un relevé qui porte la colonne.
      ligne.montant_envoye_deduit = false;
    }

    // Le type vient peut-être de changer, et avec lui la jambe qui fait
    // l'opération : on rejoue alors l'imputation que le serveur refera à la
    // confirmation, pour que l'aperçu montre tout de suite le bon montant.
    // MÊME CONDITION QUE LE SERVEUR (montants_a_refaire) : ailleurs, les
    // montants de la ligne sont déjà ceux qui ont bougé, et les refaire
    // écraserait la correction manuelle qu'on vient d'enregistrer.
    const montantsARefaire = ligneAvecFrais || override.type_code !== typeAvant;
    const calcul = calculerMontantsLigne({
      montantHorsFrais: ligne.montant_hors_frais,
      montantEnvoyeHorsFrais: ligne.montant_envoye_hors_frais,
      frais: ligne.frais,
      monnaieId: ligne.monnaie_id,
      monnaieEnvoyeeId: ligne.monnaie_envoyee_id,
      monnaieFraisId: ligne.monnaie_frais_id,
      devisefraisRenseignee:
        !!ligne.nom_banque_monnaie_frais || ligne.monnaie_frais_id != null,
      sortante: (ligne.montant_signe || 0) < 0,
      estVirement: info.virement === true,
      // Le relevé porte-t-il une colonne de devise ? Elle change ce que le
      // montant unique d'une ligne décrit — la jambe du compte, ou celle d'en
      // face (cf. _orienter_jambe_virement côté serveur).
      liteLaMonnaie: importConfigColonnes.some((c) => c.propriete === "monnaie"),
    });
    if (montantsARefaire) {
      ligne.montant = calcul.montant;
      ligne.montant_envoye = calcul.montantEnvoye;
      ligne.frais_incoherents = calcul.incoherents === true;
    }
    // La monnaie de l'écriture suit toujours les monnaies saisies, même sans
    // réimputation : c'est elle qui décide de la devise affichée, et l'ancienne
    // aurait survécu à un changement de monnaie dans ce même formulaire.
    ligne.monnaie_operation_id = calcul.monnaieOperationId;

    ligne.categorie_suggestion_auto = false;
    ligne.erreur = (montantsARefaire && calcul.erreur) || null;
    ligneApercuEnEdition = null;
    renderImportApercu();
  });

  return tr;
}

function updateBtnImportSupprimerSelectionEtat() {
  const btn = document.getElementById("btn-import-supprimer-selection");
  const nb = importLignesSelectionnees.size;
  document.getElementById("import-selection-nombre").textContent = nb;
  btn.disabled = nb === 0;
  // La sélection conditionne aussi la confirmation (elle la bloque tant
  // qu'elle n'est pas vide) : les deux boutons se mettent à jour ensemble.
  updateBtnImportConfirmerEtat();

  const lignesSelectionnables = importApercu ? importApercu.lignes.length : 0;
  const btnTout = document.getElementById("btn-import-tout-selectionner");
  btnTout.disabled = lignesSelectionnables === 0;
  btnTout.textContent =
    lignesSelectionnables > 0 && nb === lignesSelectionnables
      ? "Tout désélectionner"
      : "Tout sélectionner";
}

// Bascule : sélectionne tout, ou désélectionne tout si tout l'était déjà.
document.getElementById("btn-import-tout-selectionner").addEventListener("click", () => {
  if (!importApercu) return;
  const toutSelectionne = importLignesSelectionnees.size === importApercu.lignes.length;
  importLignesSelectionnees.clear();
  if (!toutSelectionne) {
    importApercu.lignes.forEach((l) => importLignesSelectionnees.add(l.ligne));
  }
  renderImportApercu();
});

document.getElementById("btn-import-supprimer-selection").addEventListener("click", () => {
  if (!importApercu || importLignesSelectionnees.size === 0) return;
  const nb = importLignesSelectionnees.size;
  if (!confirm(`Supprimer les ${nb} ligne(s) sélectionnée(s) de l'import ?`)) return;
  // Copie : supprimerLigneApercu retire au fur et à mesure de importLignesSelectionnees.
  [...importLignesSelectionnees].forEach((numeroLigne) => {
    const ligne = importApercu.lignes.find((l) => l.ligne === numeroLigne);
    if (ligne) supprimerLigneApercu(ligne);
  });
  renderImportApercu();
});

// La raison du blocage, au survol du bouton. Un bouton `disabled` ne reçoit
// aucun événement souris (ni :hover, ni tooltip natif) : c'est le conteneur qui
// la porte, cf. .bulle-blocage. Le `title` est renseigné en parallèle pour les
// lecteurs d'écran et pour rester lisible si le bouton redevient actif.
//
// TOUTES les raisons sont listées, pas seulement la première : les corriger une
// par une, en revenant survoler le bouton entre chaque, ferait découvrir la
// suivante à chaque fois sans jamais savoir combien il en reste.
function setBulleBlocageImport(raisons) {
  const bulle = document.getElementById("import-confirmer-bulle");
  const btn = document.getElementById("btn-import-confirmer");
  // Une intro, puis une puce par raison (cf. textes.js, « /- ») : la bulle se lit d'un coup d'œil.
  const retenues = raisons.filter(Boolean);
  const intro = t(texteAide("noyau.import-blocage-intro"));
  const texte = retenues.length ? intro + retenues.map((raison) => ` /- ${raison}`).join("") : "";
  if (texte) {
    bulle.dataset.info = texte;
  } else {
    delete bulle.dataset.info;
  }
  // Le `title` en lignes simples, sans les marqueurs de puce : il est lu tel quel.
  btn.title = retenues.length ? [intro, ...retenues].join("\n") : "";
}

// Combien de lignes tombent sous le coup d'un contrôle, pour que le message dise
// l'ampleur du travail restant plutôt qu'un simple « il manque quelque chose ».
function compterLignes(lignes, predicat) {
  return lignes.filter(predicat).length;
}

// "OK" par ligne plutôt que par les listes globales categories_inconnues /
// comptes_inconnus : une ligne modifiée manuellement (categorie_suggestion_auto
// remis à false) ou supprimée n'a plus besoin d'être confirmée au niveau du
// nom bancaire, et une ligne en erreur (de toute façon ignorée) ne bloque rien.
// Les lignes de règlement ne sont jamais concernées par ce bouton : elles se
// créent une par une (cf. creerLigneApercuEdition, mode règlement), jamais par lot.
// Les lignes doublons sont désormais importables comme les autres : elles
// comptent donc dans categoriesOk/comptesOk. Ce qui les gouverne, c'est la
// sélection -- une sélection non vide bloque la confirmation, et elles y sont
// pré-inscrites à l'analyse (cf. analyserFichierImport).
function updateBtnImportConfirmerEtat() {
  majBoutonVirementsImport();
  const btn = document.getElementById("btn-import-confirmer");
  if (!importApercu) {
    btn.disabled = true;
    setBulleBlocageImport([t(texteAide("noyau.import-blocage-aucun-fichier"))]);
    return;
  }
  // Les lignes refusées par la banque sont exclues des contrôles au même titre
  // que les lignes de règlement : elles ne seront pas importées, exiger qu'elles
  // soient complètes appellerait des corrections sans objet.
  // Les doublons ignorés (cochés) n'en sont pas non plus : l'import ne les lira pas.
  const lignesActives = importApercu.lignes.filter(
    (l) =>
      !infoTypeOperationLigne(l).reglement &&
      !ligneRefuseeParStatut(l) &&
      !ligneDeclareeVirementConnu(l) &&
      !ligneDoublonIgnoree(l)
  );
  if (importApercu.lignes.length === 0) {
    btn.disabled = true;
    setBulleBlocageImport([t(texteAide("noyau.import-blocage-apercu-vide"))]);
    return;
  }
  // !l.nom_banque_categorie : une ligne sans catégorie bancaire n'a rien à
  // confirmer (même règle que categories_inconnues côté serveur, qui exige
  // `nom_banque_categorie and categorie_suggestion_auto`). Sans ça, un preset
  // sans colonne "Catégorie bancaire" restait bloqué indéfiniment : toutes
  // ses lignes tombaient dans "Autres" en suggestion auto, sous un nom vide
  // qu'aucune case ne pouvait jamais confirmer.
  const categoriesOk = lignesActives.every(
    (l) =>
      l.erreur ||
      !l.categorie_suggestion_auto ||
      !l.nom_banque_categorie ||
      importCategoriesConfirmees.has(l.nom_banque_categorie)
  );
  const comptesOk = lignesActives.every((l) => l.erreur || l.compte_id !== null);
  // Une devise lue mais non rattachée déciderait de la monnaie de l'écriture :
  // la laisser passer libellerait la ligne dans la monnaie principale du
  // compte, c'est-à-dire dans la mauvaise (même contrôle côté serveur, cf.
  // _erreur_ligne).
  const monnaiesOk = lignesActives.every((l) => l.erreur || devisesAMapper(l).length === 0);
  // Des frais dans une monnaie étrangère aux deux montants : c'est la
  // CONFIGURATION du preset qui ne tient pas, pas une ligne isolée. Rien ne se
  // corrige dans l'aperçu — le serveur refuse d'ailleurs le fichier entier
  // (cf. services/import_bancaire.ImportBloque) ; autant le dire ici.
  const lignesFraisIncoherents = importApercu.lignes.filter(
    (l) => l.frais_incoherents && !ligneRefuseeParStatut(l)
  );
  // Un virement dont le compte en face manque n'écrirait qu'une jambe : on
  // bloque tant qu'il n'est pas désigné, plutôt que de laisser une écriture
  // orpheline à retrouver ensuite (même refus côté serveur, cf. _erreur_ligne).
  const virementsIncomplets = lignesActives.filter((l) => !l.erreur && virementIncomplet(l));
  // Une jambe reconnue demande « Oui » ou « Non » : l'import est bloqué tant que
  // l'une reste « à choisir » (même refus côté serveur, cf. confirmer).
  const jambesAChoisir = lignesActives.filter((l) => validationJambe(l) === null);
  // Seules les lignes cochées qui ne sont pas des doublons bloquent : un doublon
  // coché est ignoré, il n'y a rien à trancher.
  const nbSelectionBloquante = importApercu.lignes.filter(
    (l) => importLignesSelectionnees.has(l.ligne) && !ligneDoublonIgnoree(l)
  ).length;
  const rienDeSelectionne = nbSelectionBloquante === 0;
  btn.disabled = !(
    jambesAChoisir.length === 0 &&
    categoriesOk &&
    comptesOk &&
    monnaiesOk &&
    rienDeSelectionne &&
    lignesFraisIncoherents.length === 0 &&
    virementsIncomplets.length === 0
  );

  // Une raison par contrôle qui échoue, chacune disant COMBIEN de lignes elle
  // concerne et OÙ les corriger.
  const nbCategories = compterLignes(
    lignesActives,
    (l) =>
      !l.erreur &&
      l.categorie_suggestion_auto &&
      l.nom_banque_categorie &&
      !importCategoriesConfirmees.has(l.nom_banque_categorie)
  );
  const nbComptes = compterLignes(lignesActives, (l) => !l.erreur && l.compte_id === null);
  const nbMonnaies = compterLignes(
    lignesActives,
    (l) => !l.erreur && devisesAMapper(l).length > 0
  );
  setBulleBlocageImport([
    categoriesOk ? "" : t(texteAide("noyau.import-blocage-categories"), { n: nbCategories }),
    comptesOk ? "" : t(texteAide("noyau.import-blocage-comptes"), { n: nbComptes }),
    monnaiesOk ? "" : t(texteAide("noyau.import-blocage-devises"), { n: nbMonnaies }),
    lignesFraisIncoherents.length === 0 ? "" : t(texteAide("noyau.import-blocage-frais"), { n: lignesFraisIncoherents.length }),
    jambesAChoisir.length === 0 ? "" : t(texteAide("noyau.import-blocage-jambes"), { n: jambesAChoisir.length }),
    virementsIncomplets.length === 0 ? "" : t(texteAide("noyau.import-blocage-virements"), { n: virementsIncomplets.length }),
    rienDeSelectionne ? "" : t(texteAide("noyau.import-blocage-selection"), { n: nbSelectionBloquante }),
  ]);
}

document.getElementById("btn-import-confirmer").addEventListener("click", async () => {
  if (!importFichierActuel || !importApercu) return;
  // DANS LA DÉMO, un rappel avant d'écrire : l'import s'appliquerait à des données fictives
  // (cf. sandbox.js). Hors démo, la fonction répond oui sans rien afficher.
  if (BudgetApp.confirmerEnSandbox && !(await BudgetApp.confirmerEnSandbox("import"))) return;
  const formData = new FormData();
  formData.append("fichier", importFichierActuel);
  const compteDefaut = compteIdDefautChoisi();
  if (compteDefaut) formData.append("compte_id_defaut", compteDefaut);
  // Mêmes réglages qu'à l'aperçu confirmé : le fichier doit être relu à
  // l'identique, sans quoi la confirmation verrait d'autres lignes en erreur
  // que celles déjà traitées (cf. services/import_bancaire.confirmer).
  ajouterReglagesLecture(formData);
  ajouterColonnesLues(formData);
  // Seules les correspondances ENCORE DEMANDÉES partent : celle d'un libellé qui ne
  // venait que de doublons ignorés ou de lignes supprimées n'a pas à être mémorisée.
  const demandes = demandesDeMapping();
  const categories = {};
  Object.entries(importMappingCategories).forEach(([nom, categorieId]) => {
    if (categorieId && demandes.categories.includes(nom)) categories[nom] = categorieId;
  });
  const comptes = {};
  Object.entries(importMappingComptes).forEach(([nom, id]) => {
    if (id && demandes.comptes.includes(nom)) comptes[nom] = id;
  });
  const monnaies = {};
  Object.entries(importMappingMonnaies).forEach(([nom, id]) => {
    if (id && demandes.monnaies.includes(nom)) monnaies[nom] = id;
  });
  // UNE LIGNE DE RÈGLEMENT NE PART AVEC CE CONFIRM QUE SI ELLE EST LIÉE.
  //
  // LIÉE, elle sait déjà ce qu'elle solde : ses cibles sont en base depuis
  // l'aperçu, et la confirmation crée l'opération puis pose les liens (cf.
  // services/import_bancaire.confirmer). Elle n'a donc aucune raison d'attendre
  // un second geste.
  //
  // NON LIÉE, elle attend comme avant : le cas typique est celui où la dépense
  // qu'elle règle fait partie du MÊME fichier et n'existera en base qu'après ce
  // confirm — impossible de la désigner avant. On l'ajoute aux lignes
  // supprimées le temps de cet envoi précis, sans la retirer de l'aperçu.
  const lignesReglementNumeros = importApercu.lignes
    .filter((l) => infoTypeOperationLigne(l).reglement && !importLignesLiees[l.ligne])
    .map((l) => l.ligne);
  // LES DOUBLONS IGNORÉS PARTENT AUSSI, comme supprimés : le serveur ne les lira
  // pas, et ils n'entrent donc ni en base ni au stock anti-doublons (ils y sont déjà).
  const doublonsIgnores = importApercu.lignes.filter(ligneDoublonIgnoree).map((l) => l.ligne);
  const lignesSupprimeesPourCeConfirm = [
    ...new Set([...importLignesSupprimees, ...lignesReglementNumeros, ...doublonsIgnores]),
  ];

  formData.append(
    "mappings",
    JSON.stringify({
      categories,
      comptes,
      monnaies,
      lignes: importLigneOverrides,
      // L'étape 3bis : le compte de l'autre jambe, pour les lignes qui sont encore des virements.
      comptes_en_face: Object.fromEntries(
        Object.entries(importComptesEnFace).filter(([n]) => {
          const ligne = virLigne(Number(n));
          return ligne && typeOperationLigne(ligne) === "virement";
        })
      ),
      lignes_supprimees: lignesSupprimeesPourCeConfirm,
      // Une LISTE DE REFUS, et non d'acceptations : le rapprochement a lieu par
      // défaut (cf. le panneau « Dépenses prévues reconnues »).
      rapprochements_refuses: [...importRapprochementsRefuses],
      // Une clé par ligne que l'écran a montrée comme reconnue (null = à choisir) :
      // c'est ce qui dit au serveur quelles questions ont été VUES.
      // Les lignes déclarées à la main comme un virement déjà en base (cf.
      // importJambesDeclarees) : retirées de celles que l'aperçu n'a plus.
      jambes_declarees: Object.fromEntries(
        importApercu.lignes
          .filter((l) => ligneDeclareeVirementConnu(l))
          .map((l) => [l.ligne, importJambesDeclarees[l.ligne]])
      ),
      jambes_validees: Object.fromEntries(
        importApercu.lignes
          .filter((l) => jambeDeLigne(l) != null)
          .map((l) => [l.ligne, validationJambe(l)])
      ),
    })
  );

  // Lu AVANT l'envoi : la confirmation date le dernier import du preset.
  const premierImport = premierImportBancaire() && !tutorielEnCours();
  try {
    const resultat = await apiFetchForm(importUrl("/confirmer"), formData);
    importDernierHistoriqueId = resultat.historique_id ?? null;
    afficherResultatImport(resultat);
    if (premierImport) await enregistrerPremierImport();
    // LES DEUX NOMBRES QUAND IL Y A LIEU. Une ligne rapprochée est bien
    // importée — elle compte dans le total — mais elle n'AJOUTE pas
    // d'opération : sans cette précision, le total ne collerait pas avec ce
    // qu'on voit apparaître dans la page Opérations, et rien ne le dirait.
    showMessage(
      resultat.rapprochements
        ? t("{n} opération(s) importée(s), dont {p} qui remplacent une dépense prévue.", {
            n: resultat.operations_creees,
            p: resultat.rapprochements,
          })
        : `${resultat.operations_creees} opération(s) importée(s).`,
      "success"
    );

    const lignesRestantes = importApercu.lignes.filter(
      (l) => infoTypeOperationLigne(l).reglement && !importLignesLiees[l.ligne]
    );
    if (lignesRestantes.length === 0) {
      reinitialiserImport();
    } else {
      // Les lignes tout juste importées deviennent définitivement exclues des
      // envois suivants : si une ligne de règlement restante est ensuite
      // reclassée (ex. en classique) et confirmée via ce même bouton, seul ce
      // reliquat partira — jamais de doublon des opérations déjà créées.
      const numerosRestants = new Set(lignesRestantes.map((l) => l.ligne));
      importApercu.lignes.forEach((l) => {
        if (!numerosRestants.has(l.ligne)) importLignesSupprimees.add(l.ligne);
      });
      importApercu.lignes = lignesRestantes;
      Object.keys(importLigneOverrides).forEach((numero) => {
        if (!numerosRestants.has(Number(numero))) delete importLigneOverrides[numero];
      });
      showMessage(t("Termine maintenant les remboursements / remboursements de prêts en attente, ci-dessous."),
        "success"
      );
      renderImportApercu();
    }
    await loadImportMappingsOverview();
    await loadImportHistorique();
  } catch (err) {
    showMessage(err.message, "error");
  }
});

/* ----- Mapping actuel (toujours visible) ----- */

// Tous presets confondus, et donc sans importUrl : la sous-page
// « Correspondances » s'affiche même sans preset sélectionné.
async function loadImportMappingsOverview() {
  renderImportMappingsOverview(await apiFetch("/import/mappings"));
}

// Sous-page « Correspondances » des Paramètres. Elle vivait avec les règles,
// et l'a suivi jusqu'à ce que celles-ci deviennent une extension : ce qui est
// affiché ici ne dépend d'aucune extension et ne peut donc pas partir avec.
async function loadCorrespondances() {
  try {
    await refreshComptes();
    await refreshCategories();
    await loadImportPresets();
    await loadImportMappingsOverview();
  } catch (err) {
    showMessage(err.message, "error");
  }
}

function _creerLigneMappingActuel(nomBanque, valeur, options, { onChange, onSupprimer }) {
  const row = document.createElement("div");
  row.className = "import-mapping-row";
  row.innerHTML = `
    <span class="import-mapping-nom">${nomBanque}</span>
    <select>
      ${options.map((o) => `<option value="${o.id}" ${o.id === valeur ? "selected" : ""}>${o.nom}</option>`).join("")}
    </select>
    <button type="button" class="danger" data-action="supprimer">${t("Supprimer")}</button>
  `;
  row.querySelector("select").addEventListener("change", (e) => onChange(e.target.value));
  row.querySelector("button[data-action='supprimer']").addEventListener("click", onSupprimer);
  return row;
}

/**
 * Les correspondances s'affichent en galerie : une colonne verticale par
 * catégorie de l'app, les colonnes côte à côte (5 par ligne tant que la largeur
 * le permet, cf. .galerie).
 *
 * C'est le classement lui-même qui devient lisible : on voit d'un coup ce que
 * recouvre "Alimentaire", au lieu d'ouvrir un menu déroulant par ligne pour le
 * reconstituer. Et comme la colonne EST la catégorie, déposer un libellé dans
 * une autre suffit à le reclasser.
 *
 * Toutes les catégories sont affichées, même vides : une colonne vide reste une
 * destination valide.
 *
 * TOUS LES PRESETS y figurent ensemble (GET /import/mappings/categories) : le
 * sélecteur de preset vit sur la page Import, et n'en montrer qu'un ici
 * revenait à cacher la moitié du classement sans dire lequel. Chaque carte
 * porte donc son preset_id — l'écriture, elle, reste scopée au preset.
 *
 * Les CARTES portent « (Courant) », pas les colonnes : la colonne est une
 * catégorie de l'app, commune à tous les comptes ; la carte est un libellé lu
 * dans un relevé, et c'est là que la provenance lève l'ambiguïté entre deux
 * noms voisins venus de deux banques.
 */
/**
 * Donne à chaque colonne la hauteur de son contenu, et rien de plus.
 *
 * La grille CSS aligne toutes les colonnes d'une même rangée sur la plus haute.
 * Avec quatre colonnes par rangée et une catégorie qui en concentre quinze, les
 * trois voisines traînaient un vide de plusieurs centaines de pixels — et
 * déplacer une carte n'y changeait rien, puisque la rangée gardait sa hauteur.
 *
 * Le procédé : des rangées de grille d'un pixel (cf. `.galerie`), et chaque
 * colonne s'étend sur autant de rangées que sa hauteur mesurée l'exige. La
 * gouttière compte dans le calcul, sinon chaque colonne dépasse d'un `gap`.
 *
 * Rejoué à chaque rendu, à chaque déplacement de carte et à chaque
 * redimensionnement : une colonne dont le texte se replie sur deux lignes
 * change de hauteur sans que son contenu ait bougé.
 */
function ajusterHauteursGalerie(bloc) {
  if (!bloc || !bloc.classList.contains("galerie")) return;
  // Onglet Règles replié : la galerie n'a alors aucune boîte, toutes les
  // hauteurs valent zéro, et écrire `span 1` partout ficellerait la mise en
  // page pour de bon. C'est l'observateur plus bas qui relance le calcul dès
  // qu'elle réapparaît.
  if (bloc.getBoundingClientRect().height === 0) return;
  // Gelée le temps d'un glissement (cf. geleGalerie).
  if (bloc.dataset.gele === "1") return;

  const styles = window.getComputedStyle(bloc);
  const hauteurRangee = parseFloat(styles.gridAutoRows) || 1;
  const gouttiere = parseFloat(styles.rowGap) || 0;
  bloc.querySelectorAll(".galerie-colonne").forEach((colonne) => {
    // Mesure fiable même après un premier calcul : `align-items: start` empêche
    // la colonne de s'étirer sur la zone que le span lui réserve, sa hauteur
    // reste donc celle de son contenu. `getBoundingClientRect` plutôt que
    // `offsetHeight` : décimales comprises, sinon l'arrondi accumule un pixel
    // par colonne.
    const hauteur = colonne.getBoundingClientRect().height;
    const rangees = Math.max(1, Math.ceil((hauteur + gouttiere) / (hauteurRangee + gouttiere)));
    const span = `span ${rangees}`;
    // N'écrire que si ça change : la hauteur du conteneur en dépend, et
    // l'observateur ci-dessous se rappellerait sans fin.
    if (colonne.style.gridRowEnd !== span) colonne.style.gridRowEnd = span;
  });
}

/**
 * GÈLE LA GALERIE le temps d'un glissement (carte ou colonne).
 *
 * Reclasser un libellé change la hauteur de deux colonnes, donc — par le calcul
 * des rangées ci-dessus — la place de toutes les autres : la cible visée se
 * dérobait sous la souris au moment de déposer. Pendant le geste, on fige donc
 * les rangées occupées par chaque colonne (plus de recalcul) et sa hauteur
 * actuelle (`min-height`, pour que celle d'où la carte part ne se referme pas).
 * Le recalcul normal reprend à la fin du glissement, quand plus rien ne bouge
 * sous le pointeur.
 */
function geleGalerie(bloc) {
  if (!bloc || bloc.dataset.gele === "1") return;
  bloc.querySelectorAll(".galerie-colonne").forEach((colonne) => {
    colonne.style.minHeight = `${colonne.getBoundingClientRect().height}px`;
  });
  bloc.dataset.gele = "1";
}

function degeleGalerie(bloc) {
  if (!bloc || bloc.dataset.gele !== "1") return;
  delete bloc.dataset.gele;
  bloc.querySelectorAll(".galerie-colonne").forEach((colonne) => {
    colonne.style.minHeight = "";
  });
  ajusterHauteursGalerie(bloc);
}

/** Branche le gel sur tout glissement qui part d'une carte ou d'une colonne de
 *  la galerie — une seule fois par conteneur, il survit aux rendus. */
function brancherGelGalerie(bloc) {
  if (bloc.dataset.gelBranche === "1") return;
  bloc.dataset.gelBranche = "1";
  bloc.addEventListener("dragstart", (e) => {
    if (e.target.closest && e.target.closest(".galerie-carte, .galerie-colonne")) geleGalerie(bloc);
  });
  bloc.addEventListener("dragend", () => degeleGalerie(bloc));
  // Un glissement abandonné hors de la page n'envoie pas toujours `dragend`.
  document.addEventListener("drop", () => degeleGalerie(bloc));
}

// Une seule galerie à l'écran. L'observateur suit sa taille : il couvre d'un
// coup le repli/dépli de l'onglet Règles, le redimensionnement de la fenêtre et
// les cartes qui changent de hauteur quand leur libellé se replie — sans avoir à
// brancher un rappel sur chacun de ces chemins.
let observateurGalerie = null;

function surveillerHauteursGalerie(bloc) {
  ajusterHauteursGalerie(bloc);
  if (observateurGalerie) observateurGalerie.disconnect();
  observateurGalerie = new ResizeObserver(() => ajusterHauteursGalerie(bloc));
  observateurGalerie.observe(bloc);
}

/**
 * ORDRE DES COLONNES DE LA GALERIE : calculé, jamais choisi à la main.
 *
 * Les groupes (une colonne par catégorie) ne se déplacent plus : seules les
 * cartes passent d'un groupe à l'autre. Les groupes s'agencent d'eux-mêmes pour
 * tenir le moins de place en hauteur — on compte combien de libellés chacun porte
 * et on pose les plus chargés en premier, la grille empilant ensuite chaque
 * colonne sous la plus courte (cf. ajusterHauteursGalerie).
 *
 * CALCULÉ UNE FOIS PAR LANCEMENT DE L'APPLICATION, et non à chaque rendu :
 * reclasser une carte change le compte de deux groupes, et réarranger toute la
 * galerie sous la souris à chaque dépôt était justement ce qui rendait le geste
 * pénible. L'ordre se fige donc au premier rendu ; une catégorie créée depuis se
 * range à la fin, jusqu'au prochain lancement.
 */
let ordreGalerieDuLancement = null;

/** Les cibles dans l'ordre du lancement ; les inconnues à la fin, dans leur ordre. */
function ordonnerCiblesMappings(cibles, parCategorie) {
  if (ordreGalerieDuLancement === null) {
    ordreGalerieDuLancement = cibles
      .map((cible, position) => ({
        id: cible.id,
        position,
        nombre: (parCategorie.get(cible.id) || []).length,
      }))
      // Les plus chargés d'abord ; à égalité, l'ordre des catégories.
      .sort((a, b) => b.nombre - a.nombre || a.position - b.position)
      .map((entree) => entree.id);
  }
  const rangs = new Map(ordreGalerieDuLancement.map((id, rang) => [id, rang]));
  return [...cibles].sort((a, b) => {
    const rangA = rangs.has(a.id) ? rangs.get(a.id) : Number.MAX_SAFE_INTEGER;
    const rangB = rangs.has(b.id) ? rangs.get(b.id) : Number.MAX_SAFE_INTEGER;
    if (rangA !== rangB) return rangA - rangB;
    return cibles.indexOf(a) - cibles.indexOf(b);
  });
}

function renderMappingsCategoriesGalerie(mappings) {
  const bloc = document.getElementById("import-mapping-categories-liste");
  bloc.className = "galerie";
  bloc.innerHTML = "";

  const parCategorie = new Map();
  mappings.forEach((m) => {
    if (!parCategorie.has(m.categorie_id)) parCategorie.set(m.categorie_id, []);
    parCategorie.get(m.categorie_id).push(m);
  });

  ordonnerCiblesMappings(ciblesEligiblesImport(), parCategorie).forEach((categorie) => {
    const colonne = document.createElement("div");
    colonne.className = "galerie-colonne";
    colonne.dataset.categorieId = categorie.id;

    const libelles = parCategorie.get(categorie.id) || [];
    const titre = document.createElement("div");
    titre.className = "galerie-colonne-titre";
    titre.innerHTML = `
      <span>${escapeHtml(libelleCategorie(categorie.nom))}</span>
      <span class="galerie-compteur">${libelles.length}</span>
    `;
    colonne.appendChild(titre);

    const corps = document.createElement("div");
    corps.className = "galerie-colonne-corps";
    if (libelles.length === 0) {
      const vide = document.createElement("span");
      vide.className = "hint galerie-colonne-vide";
      vide.textContent = t("Dépose un libellé ici.");
      corps.appendChild(vide);
    }
    libelles.forEach((m) => {
      // Le compte lié au preset, et rien d'autre : un preset qui résout le
      // compte depuis le fichier n'en désigne aucun, sa carte reste nue plutôt
      // que d'afficher une parenthèse vide.
      const provenance = m.compte_nom;
      const carte = document.createElement("div");
      carte.className = "galerie-carte";
      carte.dataset.nomBanque = m.nom_banque;
      // Le preset dont vient CETTE carte, pas celui sélectionné : la galerie
      // les mélange, reclasser ou supprimer doit viser le bon.
      carte.dataset.presetId = m.preset_id;
      // LA POIGNÉE, comme dans les listes de comptes et de catégories. Sans
      // elle, la carte entière était déplaçable et son libellé ne pouvait donc
      // pas être sélectionné — or c'est exactement ce qu'on veut copier d'ici,
      // pour le coller dans une règle.
      carte.innerHTML = `
        <span class="drag-handle" title="${t("Glisser vers une autre colonne pour reclasser")}">⠿</span>
        <span class="galerie-carte-nom">${libelleCategorieBanqueHtml(m.nom_banque, provenance)}</span>
        <button type="button" class="galerie-carte-supprimer" data-action="supprimer"
                title="Supprimer cette correspondance" aria-label="${t("Supprimer")}">
          ${ICONE_POUBELLE}
        </button>
      `;
      carte.querySelector("button[data-action='supprimer']").addEventListener("click", async () => {
        const ou = provenance ? ` (${provenance})` : "";
        if (!confirm(`Supprimer la correspondance pour "${m.nom_banque}"${ou} ?`)) return;
        try {
          await apiFetch(
            `/import/presets/${m.preset_id}/mappings/categorie?nom_banque=${encodeURIComponent(m.nom_banque)}`,
            { method: "DELETE" }
          );
          showMessage(t("Correspondance supprimée"), "success");
          loadImportMappingsOverview();
        } catch (err) {
          showMessage(err.message, "error");
        }
      });
      rendreDeplacableParPoignee(carte, ".drag-handle");
      corps.appendChild(carte);
    });

    colonne.appendChild(corps);
    bloc.appendChild(colonne);
  });

  surveillerHauteursGalerie(bloc);
  brancherGelGalerie(bloc);

  attacherDragEntreGroupes(bloc, {
    // `.galerie-carte` et non `[draggable='true']` : la carte ne devient
    // déplaçable qu'au moment où l'on appuie sur sa poignée (cf.
    // rendreDeplacableParPoignee), elle ne porte donc plus l'attribut au repos.
    selecteurLigne: ".galerie-carte",
    selecteurGroupe: ".galerie-colonne",
    selecteurCorps: ".galerie-colonne-corps",
    selecteurVide: ".galerie-colonne-vide",
    cleGroupe: (colonne) => colonne.dataset.categorieId,
    onHauteursChangees: () => ajusterHauteursGalerie(bloc),
    onDepose: async (carte, categorieId) => {
      await apiFetch(`/import/presets/${carte.dataset.presetId}/mappings/categorie`, {
        method: "PUT",
        body: JSON.stringify({
          nom_banque: carte.dataset.nomBanque,
          categorie_id: Number(categorieId),
        }),
      });
      showMessage(t("Correspondance reclassée"), "success");
    },
    recharger: loadImportMappingsOverview,
  });
}

/**
 * Comptes et devises : une liste commune à tous les presets, qui ne dit pas de
 * quel preset chaque ligne vient — « EUR -> Euro » répété une fois par preset
 * n'apprendrait rien. Le serveur a donc fondu les entrées identiques, et la
 * ligne porte LES presets concernés : la modifier ou la supprimer les vise tous
 * (cf. _regrouper_par_cible côté serveur). Une divergence entre presets, elle,
 * reste deux lignes — c'est justement l'information.
 */
function _appliquerATousLesPresets(presetIds, chemin, options) {
  return Promise.all(presetIds.map((id) => apiFetch(`/import/presets/${id}${chemin}`, options)));
}

function renderImportMappingsOverview(mappings) {
  const catBloc = document.getElementById("import-mapping-categories-liste");
  if (mappings.categories.length === 0) {
    catBloc.className = "import-mappings";
    catBloc.innerHTML =
      `<span class="hint">${t("Aucune correspondance de catégorie mémorisée.")}</span>`;
  } else {
    renderMappingsCategoriesGalerie(mappings.categories);
  }

  const monnaieBloc = document.getElementById("import-mapping-monnaies-liste");
  monnaieBloc.innerHTML = "";
  if ((mappings.monnaies || []).length === 0) {
    monnaieBloc.innerHTML =
      `<span class="hint">${t(
        "Aucune correspondance de devise mémorisée (aucun preset ne lit peut-être de colonne de devise)."
      )}</span>`;
  } else {
    mappings.monnaies.forEach((m) => {
      monnaieBloc.appendChild(
        _creerLigneMappingActuel(m.nom_banque, m.monnaie_id, state.monnaies, {
          onChange: async (monnaieId) => {
            try {
              await _appliquerATousLesPresets(m.preset_ids, "/mappings/monnaie", {
                method: "PUT",
                body: JSON.stringify({ nom_banque: m.nom_banque, monnaie_id: monnaieId }),
              });
              showMessage(t("Correspondance mise à jour"), "success");
              loadImportMappingsOverview();
            } catch (err) {
              showMessage(err.message, "error");
            }
          },
          onSupprimer: async () => {
            if (!confirm(`Supprimer la correspondance pour "${m.nom_banque}" ?`)) return;
            try {
              await _appliquerATousLesPresets(
                m.preset_ids,
                `/mappings/monnaie?nom_banque=${encodeURIComponent(m.nom_banque)}`,
                { method: "DELETE" }
              );
              showMessage(t("Correspondance supprimée"), "success");
              loadImportMappingsOverview();
            } catch (err) {
              showMessage(err.message, "error");
            }
          },
        })
      );
    });
  }

  const compteBloc = document.getElementById("import-mapping-comptes-liste");
  compteBloc.innerHTML = "";
  if (mappings.comptes.length === 0) {
    compteBloc.innerHTML = `<span class="hint">${t(
      "Aucune correspondance de compte mémorisée."
    )}</span>`;
  } else {
    mappings.comptes.forEach((m) => {
      compteBloc.appendChild(
        _creerLigneMappingActuel(m.nom_banque, m.compte_id, comptesProposables(m.compte_id), {
          onChange: async (compteId) => {
            try {
              await _appliquerATousLesPresets(m.preset_ids, "/mappings/compte", {
                method: "PUT",
                body: JSON.stringify({ nom_banque: m.nom_banque, compte_id: compteId }),
              });
              showMessage(t("Mapping mis à jour"), "success");
              loadImportMappingsOverview();
            } catch (err) {
              showMessage(err.message, "error");
            }
          },
          onSupprimer: async () => {
            if (!confirm(`Supprimer la correspondance pour "${m.nom_banque}" ?`)) return;
            try {
              await _appliquerATousLesPresets(
                m.preset_ids,
                `/mappings/compte?nom_banque=${encodeURIComponent(m.nom_banque)}`,
                { method: "DELETE" }
              );
              showMessage(t("Mapping supprimé"), "success");
              loadImportMappingsOverview();
            } catch (err) {
              showMessage(err.message, "error");
            }
          },
        })
      );
    });
  }
}

/* ----- Historique ----- */

async function loadImportHistorique() {
  const historique = await apiFetch(importUrl("/historique"));
  renderImportHistorique(historique);
}

/**
 * « releve-mars.xlsx <em>— Compte courant</em> » : le fichier importé, suivi du
 * compte d'où il sort.
 *
 * POURQUOI CE N'EST PAS DANS LE FICHIER. Deux banques exportent des noms de
 * fichier voisins (« export.csv », « operations.xlsx »), et rien dans la ligne
 * d'historique ne disait sur quel compte l'import avait atterri. Avant
 * d'annuler, c'est pourtant la première chose qu'on veut vérifier.
 *
 * LE COMPTE VIENT DU PRESET, pas de l'historique : l'historique est déjà filtré
 * par preset (cf. importUrl), et c'est le preset qui porte le compte dont il lit
 * les relevés (`import_preset.compte_id`). Rien n'est donc à ajouter côté
 * serveur.
 *
 * RIEN N'EST AFFICHÉ quand le preset n'est lié à aucun compte : le fichier
 * nomme alors lui-même le compte de chaque ligne, et il n'y a pas UN compte à
 * nommer — l'écrire aurait été faux plutôt qu'absent.
 *
 * En italique, comme partout où l'app annote un libellé de sa provenance (cf.
 * libelleCategorieBanqueHtml).
 */
function compteImportHtml() {
  const compteId = compteDuPresetImport();
  if (compteId == null) return "";
  return ` <em class="import-historique-compte">— ${escapeHtml(nomCompte(compteId))}</em>`;
}

function renderImportHistorique(historique) {
  const body = document.getElementById("import-historique-liste");
  body.innerHTML = "";
  if (historique.length === 0) {
    body.innerHTML = `<tr><td colspan="6"><span class="hint">${t("Aucun import pour le moment.")}</span></td></tr>`;
    return;
  }
  historique.forEach((h) => {
    const tr = document.createElement("tr");
    // `operations_annulables` est ce qui EXISTE ENCORE, pas ce que l'import
    // avait créé : à zéro, il ne reste rien à défaire (tout a déjà été
    // supprimé à la main) et proposer le bouton ne ferait qu'inquiéter.
    const annulables = h.operations_annulables || 0;
    // Deux façons de n'avoir rien à annuler, qui n'appellent pas la même
    // conclusion : un import d'avant le suivi des opérations ne le sera
    // jamais, là où « déjà supprimé » veut dire que le travail est fait.
    const MESSAGES_NON_ANNULABLE = {
      anterieur: "import trop ancien",
      deja_supprime: "plus rien à annuler",
    };
    const action = annulables
      ? `<button type="button" class="danger" data-annuler-import="${h.id}" data-annulables="${annulables}">${t("Annuler")}</button>`
      : `<span class="hint" ${h.raison_non_annulable === "anterieur" ? `title="${t("Cet import est antérieur au suivi des opérations importées : l'app ne sait pas lesquelles il a créées, elle ne peut donc pas les retirer. Seuls les imports faits depuis sont annulables.")}"` : ""}>${t(
          MESSAGES_NON_ANNULABLE[h.raison_non_annulable] || "plus rien à annuler"
        )}</span>`;
    tr.innerHTML = `
      <td>${formatDateHeure(h.date_import)}</td>
      <td>${escapeHtml(h.nom_fichier || "-")}${compteImportHtml()}</td>
      <td>${h.operations_creees}</td>
      <td>${h.lignes_ignorees}</td>
      <td>${h.doublons_detectes || 0}</td>
      <td class="import-historique-action">${action}</td>
    `;
    body.appendChild(tr);
  });
}

/**
 * Défait un import : ses opérations, et sa trace dans l'historique.
 *
 * Le nombre annoncé est celui des LIGNES DU RELEVÉ encore défaisables (cf.
 * crud.compter_operations_annulables côté serveur), qui n'est pas forcément
 * celui qu'affiche la colonne « Opérations créées » : entre-temps, des
 * opérations ont pu être supprimées à la main. C'est le premier chiffre qui
 * compte ici, et c'est donc lui qu'on met dans la confirmation.
 *
 * Seul l'historique est rechargé, comme après un import confirmé : le
 * dashboard et la page Opérations se relisent de toute façon à chaque fois
 * qu'on y navigue (cf. afficherPage), il n'y a donc rien de périmé à
 * l'écran une fois cette page à jour.
 */
async function annulerImport(historiqueId, annulables) {
  if (
    !confirm(
      t(
        "Annuler cet import supprimera {n} opération(s) et le rendra réimportable. Cette action est irréversible. Continuer ?",
        { n: annulables }
      )
    )
  ) {
    return;
  }
  try {
    const resultat = await apiFetch(importUrl(`/historique/${historiqueId}`), {
      method: "DELETE",
    });
    // DEUX NOUVELLES, ET NON UNE. Ce que l'import avait ÉCRASÉ (une dépense
    // prévue) n'est pas supprimé mais RENDU à son état d'origine : les fondre
    // dans un seul total aurait dit « 14 supprimées » là où deux opérations
    // sont bien toujours là.
    const rendues = resultat.previsionnelles_restaurees || 0;
    showMessage(
      rendues
        ? t("Import annulé : {n} opération(s) supprimée(s), {p} dépense(s) prévue(s) rendue(s).", {
            n: resultat.operations_supprimees,
            p: rendues,
          })
        : t("Import annulé : {n} opération(s) supprimée(s).", {
            n: resultat.operations_supprimees,
          }),
      "success"
    );
    // L'aperçu en cours porte peut-être sur le fichier qu'on vient de rendre
    // réimportable : ses verdicts de doublons ne valent plus rien.
    if (importApercu && importFichierActuel) await executerPrevisualisation();
    await loadImportHistorique();
  } catch (err) {
    showMessage(err.message, "error");
  }
}

document.getElementById("import-historique-liste").addEventListener("click", (e) => {
  const bouton = e.target.closest("[data-annuler-import]");
  if (!bouton) return;
  annulerImport(
    Number(bouton.dataset.annulerImport),
    Number(bouton.dataset.annulables)
  );
});

function afficherResultatImport(resultat) {
  const bloc = document.getElementById("import-resultat");
  bloc.style.display = "";
  let html = `
    <div class="import-resultat-carte">
      <div class="kpi-label">Import terminé</div>
      <div class="kpi-valeur positif">${resultat.operations_creees} opération(s) importée(s)</div>
  `;
  if (resultat.doublons_detectes > 0) {
    html += `<div class="hint">${resultat.doublons_detectes} doublon(s) détecté(s), non réimporté(s).</div>`;
  }
  if (resultat.lignes_ignorees.length > 0) {
    html += `
      <div class="hint">${resultat.lignes_ignorees.length} ligne(s) ignorée(s) :</div>
      <ul class="import-lignes-entete">
        ${resultat.lignes_ignorees
          .map((l) => `<li>Ligne ${l.ligne} — ${l.nature || "?"} : ${l.erreur}</li>`)
          .join("")}
      </ul>
    `;
  }
  html += "</div>";
  bloc.innerHTML = html;
}

/* ---------- Extensions (Paramètres) ----------
 *
 * Le panneau qui liste les extensions présentes et permet de les allumer.
 * Il fait partie du NOYAU, pas d'une extension : c'est par lui qu'on rallume
 * une extension éteinte, il ne peut donc pas dépendre d'elles.
 */

async function loadExtensions() {
  try {
    const extensions = await apiFetch("/extensions");
    renderExtensions(extensions);
    renderErreursExtensions(await apiFetch("/extensions/erreurs"));
  } catch (err) {
    showMessage(err.message, "error");
  }
}

/**
 * Les extensions qui n'ont pas pu se charger au démarrage.
 *
 * Affiché ici parce que c'est le seul écran où l'on vient chercher une
 * extension : une extension présente sur le disque mais absente de
 * l'interface, sans un mot d'explication, est une panne qu'on met une heure à
 * comprendre.
 */
function renderErreursExtensions(reponse) {
  const bloc = document.getElementById("extensions-erreurs");
  const erreurs = (reponse && reponse.erreurs) || [];
  bloc.style.display = erreurs.length ? "" : "none";
  bloc.innerHTML = erreurs
    .map(
      (e) =>
        `<p class="import-avertissement">${t("Extension non chargée")} — ${escapeHtml(e)}</p>`
    )
    .join("");
}

/**
 * « Il manque ceci pour pouvoir l'allumer ».
 *
 * Les extensions attendues sont citées par leur NOM D'AFFICHAGE, comme l'écran
 * les nomme (`requiert_une_de_noms`, rendu par le serveur — il le connaît même
 * pour une extension absente du disque, par le catalogue). L'identifiant de
 * dossier ne sert que de repli.
 */
function nomsExtensionsRequises(extension) {
  const noms = extension.requiert_une_de_noms || extension.requiert_une_de || [];
  return noms.map((nom) => `« ${escapeHtml(t(nom))} »`);
}

function manqueExtensionHtml(extension) {
  return `${t("Nécessite au moins une de ces extensions, installée et activée :")} ${nomsExtensionsRequises(
    extension
  ).join(` ${t("ou")} `)}`;
}

/**
 * Le menu déroulant qui allume et éteint une extension.
 *
 * UNE LISTE DÉROULANTE PLUTÔT QU'UNE CASE À COCHER, et c'est délibérément UN
 * CLIC DE PLUS. Une case bascule au premier clic, donc aussi au clic parti
 * tout seul : effleurer « Monnaies » en descendant la page éteignait
 * l'extension sur-le-champ, et l'écran d'à côté se repliait sur une seule
 * devise. Ici il faut ouvrir la liste, PUIS choisir — le geste passe par un
 * état intermédiaire réversible, où rien n'est encore parti au serveur.
 *
 * Les deux mêmes états qu'avant, nommés en toutes lettres : une case cochée
 * demandait de savoir que « coché » veut dire « activée ».
 *
 * SANS DOSSIER, TOUJOURS VERROUILLÉ (cf. e.installee) : aucune dépendance ni
 * aucun obstacle à lever n'y changerait rien, il n'y a rien à activer.
 */
function selecteurEtatExtensionHtml(e) {
  const verrouille = !e.installee || !e.dependances_ok || Boolean(e.obstacle_desactivation);
  return `<select class="extension-etat" data-extension-id="${escapeHtml(e.id)}"
            aria-label="${t("État de l'extension")} — ${escapeHtml(e.nom)}"
            ${verrouille ? "disabled" : ""}>
      <option value="actif" ${e.actif ? "selected" : ""}>${t("Activée")}</option>
      <option value="inactif" ${e.actif ? "" : "selected"}>${t("Désactivée")}</option>
    </select>`;
}

/**
 * Une carte d'extension, présente ou non (cf. `e.installee`).
 *
 * MÊME GABARIT DANS LES DEUX CAS : c'est tout l'objet de la demande — une
 * extension du catalogue sans dossier ici doit se lire comme si elle y était,
 * description et version comprises, seul l'interrupteur diffère.
 */
function carteExtensionHtml(e) {
  // CE QUE FAIT L'EXTENSION : replié. C'est un paragraphe qu'on lit une
  // fois, à l'installation, et qui repoussait ensuite vers le bas la seule
  // chose qu'on vient chercher ici — l'état de chacune.
  const explication = basculeDetailHtml(
    `extension-explication-${e.id}`,
    `<p class="extension-description" data-aide-marqueurs>${escapeHtml(t(descriptionExtension(e)))}</p>`,
    { libelle: t("Afficher ce que fait cette extension") }
  );
  // CE QUI L'EMPÊCHE DE CHANGER D'ÉTAT : replié aussi, mais signalé à part.
  // Un seul des trois cas peut se présenter à la fois (pas de dossier, pas de
  // dépendance, obstacle à l'extinction) — un menu qu'on ne peut pas ouvrir
  // doit DIRE POURQUOI, sans quoi il passerait pour une panne : d'où le
  // bouton, toujours visible à côté du menu grisé.
  const avertissements = [
    e.installee
      ? ""
      : `<p class="extension-manque">${t("Non installée sur cette machine : le dossier de cette extension n'est pas présent ici.")}</p>`,
    e.installee && !e.dependances_ok
      ? `<p class="extension-manque">${manqueExtensionHtml(e)}</p>`
      : "",
    e.obstacle_desactivation
      ? `<p class="extension-manque">${escapeHtml(e.obstacle_desactivation)}</p>`
      : "",
  ].join("");
  const alerte = basculeDetailHtml(`extension-avertissement-${e.id}`, avertissements, {
    libelle: t("Afficher l'avertissement"),
    classe: "detail-bascule-alerte",
  });
  const classes = ["extension-carte"];
  if (!e.actif) classes.push("inactive");
  if (!e.installee) classes.push("non-installee");
  return `
      <div class="${classes.join(" ")}">
        <div class="extension-entete">
          ${
            // LE NUMÉRO AVANT LE NOM, parce que c'est lui qui ne bouge pas. Le
            // nom est traduit juste à côté : entre une application française et
            // la même en anglais, le numéro est la seule chose qui permette de
            // dire « l'extension 6 » et d'être compris des deux côtés. Absent
            // (0) sur une extension tierce, qui n'a pas de numéro attribué.
            e.numero ? `<span class="extension-numero">${e.numero}</span>` : ""
          }
          <span class="extension-nom">${escapeHtml(t(e.nom))}</span>
          ${e.version ? `<span class="extension-version">v${escapeHtml(e.version)}</span>` : ""}
          ${
            // Le badge n'apparaît que sur une extension de développement :
            // les extensions ordinaires n'ont pas à porter une étiquette qui
            // ne les distingue de rien.
            e.type === "developpeur"
              ? `<span class="extension-badge-dev">${t("développeur")}</span>`
              : ""
          }
          ${explication.bouton}
          ${alerte.bouton}
          <div class="extension-bascule">
            ${selecteurEtatExtensionHtml(e)}
          </div>
        </div>
        ${explication.panneau}
        ${alerte.panneau}
      </div>`;
}

/**
 * DEUX GROUPES, installées d'abord : le catalogue (cf. backend
 * extensions.catalogue) ajoute aux extensions RÉELLEMENT présentes celles qui
 * ne le sont pas sur cette machine, pour que l'écran reste le même que sur une
 * installation complète — de quoi voir tout ce que l'app sait faire, même
 * sans avoir tout installé. La seconde rangée n'apparaît que si elle a
 * quelque chose à montrer : sur une installation complète, personne n'y
 * manque, et le titre n'a rien à dire.
 */
function renderExtensions(extensions) {
  const bloc = document.getElementById("extensions-liste");
  if (extensions.length === 0) {
    bloc.innerHTML = `<span class="hint">${t("Aucune extension installée.")}</span>`;
    return;
  }
  // PAR NUMÉRO, et non dans l'ordre où le serveur les rend (l'alphabet des
  // DOSSIERS, qui ne veut rien dire à l'écran puisque le dossier ne s'affiche
  // nulle part). Le numéro est la seule désignation stable d'une extension d'une
  // langue à l'autre — c'est pour ça qu'il existe (cf. extensions/README.md) —
  // et c'est donc lui qui doit ranger la liste.
  //
  // ZÉRO VEUT DIRE « PAS DE NUMÉRO » (extension tierce) : ces cartes vont à la
  // fin, et non en tête comme un tri numérique nu les y aurait mises.
  const parNumero = (a, b) => {
    const rang = (e) => (e.numero ? e.numero : Number.MAX_SAFE_INTEGER);
    return rang(a) - rang(b) || String(a.nom).localeCompare(String(b.nom));
  };
  const installees = extensions.filter((e) => e.installee).sort(parNumero);
  const nonInstallees = extensions.filter((e) => !e.installee).sort(parNumero);

  const sectionInstallees = installees.map(carteExtensionHtml).join("");
  const sectionNonInstallees =
    nonInstallees.length === 0
      ? ""
      : `<h4 class="extensions-groupe-titre">${t("Non installées sur cette machine")}</h4>
         ${nonInstallees.map(carteExtensionHtml).join("")}`;

  bloc.innerHTML = sectionInstallees + sectionNonInstallees;
  // Les descriptions portent les marqueurs de textes.js (sauts de ligne, puces,
  // chemins cliquables) : on les met en forme une fois la liste posée.
  appliquerPuces(bloc);
}

/** Le menu d'une carte d'extension : allume ou éteint l'extension (la route, puis le chargement de ses
 *  fichiers), puis `apres()`. PARTAGÉ par Paramètres → Extensions et par l'étape « Comptes & Monnaies » de
 *  l'import, qui pose la même carte (`carteExtensionHtml`). */
async function basculerExtensionDepuisMenu(case_, { apres = loadExtensions } = {}) {
  const id = case_.dataset.extensionId;
  const actif = case_.value === "actif";
  try {
    await apiFetch(`/extensions/${encodeURIComponent(id)}`, {
      method: "PUT",
      body: JSON.stringify({ actif }),
    });
    // Une extension éteinte n'a RIEN de chargé (cf. frontend/extensions.js) :
    // l'allumer va donc chercher sa feuille de style, son écran et son script
    // maintenant. C'est ce qui évite le redémarrage tout en tenant la promesse
    // qu'« inactive » veut dire « ne tourne pas ».
    const abouti = await BudgetApp.extensions.appliquerActivation(id, actif);
    if (actif && !abouti) throw new Error(t("Extension non chargée"));
    // On REDESSINE toute la liste, et pas seulement la carte touchée : éteindre
    // une extension peut en priver une autre de son hôte, dont la case doit
    // alors se griser sur-le-champ.
    await apres();
    showMessage(
      actif ? t("Extension activée.") : t("Extension désactivée. Aucune donnée n'a été supprimée."),
      "success"
    );
  } catch (err) {
    // L'écran doit refléter l'état réel du serveur, pas l'intention.
    case_.value = actif ? "inactif" : "actif";
    showMessage(err.message, "error");
  }
}

// Délégation : les cartes sont reconstruites à chaque rendu.
document.getElementById("extensions-liste").addEventListener("change", async (e) => {
  const case_ = e.target.closest("select[data-extension-id]");
  if (!case_) return;
  await basculerExtensionDepuisMenu(case_);
});

/* ---------- Infobulles : une seule bulle, placée à la demande ----------
 *
 * CE QUI NE MARCHAIT PAS. La bulle était un `::after` posé en `position:
 * absolute` au-dessus de sa pastille, toujours au même endroit. Une pastille
 * en haut d'écran voyait donc sa bulle sortir par le haut, et une pastille en
 * bord de page sortir par le côté — d'autant plus vite que ces textes sont
 * longs (jusqu'à plusieurs paragraphes, cf. les clés noyau.import-propriete-* de textes.js). Une
 * classe posée à la main (`info-bulle-gauche`) rattrapait quelques cas connus,
 * ce qui revenait à deviner à l'écriture la place qu'il y aurait à l'écran.
 *
 * CE QUI LA REMPLACE. Une SEULE bulle, en `position: fixed`, enfant direct de
 * <body>, replacée à chaque ouverture d'après la place réellement disponible :
 * au-dessus si elle y tient, en dessous sinon, et recadrée horizontalement
 * dans la fenêtre. `fixed` et `<body>` ensemble sont ce qui la libère
 * définitivement des conteneurs à défilement — un aperçu d'import, un tableau
 * large — qui rognaient la bulle bien avant le bord de l'écran.
 *
 * UNE SEULE, et non une par pastille : il n'y en a jamais deux d'ouvertes, et
 * un nœud unique évite d'en semer des centaines dans une page qui redessine
 * ses tableaux à chaque frappe.
 *
 * Le texte reste dans `data-info`, comme avant : c'est lui que traduit i18n
 * (cf. ATTRIBUTS_TRADUISIBLES), et rien n'a bougé côté HTML.
 */

// Marge minimale entre la bulle et le bord de la fenêtre, et écart entre la
// bulle et sa pastille.
const INFOBULLE_MARGE = 8;
const INFOBULLE_ECART = 8;

/**
 * Ce qui porte une bulle. DEUX FORMES, une seule bulle :
 *
 * - `.info-bulle`, la pastille « i » à côté d'un titre ;
 * - `.bulle-blocage[data-info]`, la boîte qui entoure un bouton DÉSACTIVÉ pour
 *   dire ce qui le bloque — un bouton `disabled` ne recevant aucun événement
 *   souris, la bulle ne peut pas être portée par le bouton lui-même. Sans
 *   `data-info`, rien ne bloque et il n'y a rien à afficher : le sélecteur
 *   l'exige, plutôt qu'une bulle vide au survol d'un bouton actif.
 */
const PORTEURS_INFOBULLE = ".info-bulle, .bulle-blocage[data-info]";

let infobulleNoeud = null;
let infobulleAncre = null;

function infobulle() {
  if (infobulleNoeud) return infobulleNoeud;
  infobulleNoeud = document.createElement("div");
  infobulleNoeud.className = "info-bulle-flottante";
  infobulleNoeud.id = "info-bulle-flottante";
  infobulleNoeud.setAttribute("role", "tooltip");
  infobulleNoeud.style.display = "none";
  document.body.appendChild(infobulleNoeud);
  return infobulleNoeud;
}

function masquerInfobulle() {
  if (!infobulleNoeud) return;
  infobulleNoeud.style.display = "none";
  if (infobulleAncre) infobulleAncre.removeAttribute("aria-describedby");
  infobulleAncre = null;
}

/**
 * Affiche la bulle d'une pastille, et la place où elle tient.
 *
 * Mesurée AVANT d'être placée (elle est rendue puis lue) : sa hauteur dépend du
 * texte et de la largeur disponible, et décider au-dessus ou en dessous sans
 * la connaître reviendrait à refaire le pari qu'on essaie d'arrêter.
 */
function afficherInfobulle(pastille) {
  const texte = pastille.dataset.info;
  if (!texte) return;

  const bulle = infobulle();
  // LES PUCES SONT DÉCOUPÉES ICI, À L'OUVERTURE, et non au moment où la phrase
  // est posée dans `data-info` : l'attribut voyage entier jusqu'au dictionnaire
  // i18n, qui traduit donc une phrase et non six morceaux (cf. textes.js,
  // « LES PUCES D'UNE PHRASE D'AIDE »). Une bulle sans marqueur « -- » est
  // écrite comme avant, en texte simple.
  ecrireTexteAide(bulle, texte);
  // Les bulles à plusieurs paragraphes gardent leurs sauts de ligne et un peu
  // plus de largeur : la variante voyage avec la pastille, comme avant.
  // Les bulles de blocage sont écrites en plusieurs lignes, comme celles de la
  // configuration avancée : même variante, plus large et à sauts de ligne.
  bulle.classList.toggle(
    "info-bulle-texte",
    pastille.classList.contains("info-bulle-texte") ||
      pastille.classList.contains("bulle-blocage")
  );
  // Posée d'abord en haut à gauche : mesurer une bulle dont un bord dépasse
  // déjà de la fenêtre donnerait une largeur rognée par le navigateur.
  bulle.style.left = "0px";
  bulle.style.top = "0px";
  bulle.style.display = "block";

  const pastilleRect = pastille.getBoundingClientRect();
  const bulleRect = bulle.getBoundingClientRect();
  const largeurVue = document.documentElement.clientWidth;
  const hauteurVue = document.documentElement.clientHeight;

  // Centrée sur la pastille, puis ramenée dans la fenêtre. Le `max` en second
  // garde le bord gauche visible quand la bulle est plus large que la fenêtre
  // elle-même — mieux vaut lire le début du texte que sa fin.
  let gauche = pastilleRect.left + pastilleRect.width / 2 - bulleRect.width / 2;
  gauche = Math.min(gauche, largeurVue - bulleRect.width - INFOBULLE_MARGE);
  gauche = Math.max(gauche, INFOBULLE_MARGE);

  // Au-dessus par défaut — c'est là qu'elle gêne le moins la lecture de la
  // ligne qu'on interroge — et en dessous dès qu'elle n'y tient plus.
  const placeAuDessus = pastilleRect.top - bulleRect.height - INFOBULLE_ECART;
  const placeEnDessous = pastilleRect.bottom + INFOBULLE_ECART;
  let haut = placeAuDessus >= INFOBULLE_MARGE ? placeAuDessus : placeEnDessous;
  // Ni l'un ni l'autre ne tient (bulle très haute, fenêtre courte) : on la
  // colle en haut plutôt que de la laisser déborder par le bas.
  if (haut + bulleRect.height > hauteurVue - INFOBULLE_MARGE) {
    haut = Math.max(INFOBULLE_MARGE, hauteurVue - bulleRect.height - INFOBULLE_MARGE);
  }

  bulle.style.left = `${Math.round(gauche)}px`;
  bulle.style.top = `${Math.round(haut)}px`;

  infobulleAncre = pastille;
  pastille.setAttribute("aria-describedby", bulle.id);
}

// Délégation : les pastilles sont recréées à chaque rendu de tableau, et il y
// en a des dizaines par écran — un écouteur chacune serait posé et reposé sans
// fin. `pointerover` plutôt que `mouseenter` : il remonte, donc il se délègue.
document.addEventListener("pointerover", (evenement) => {
  const pastille = evenement.target.closest && evenement.target.closest(PORTEURS_INFOBULLE);
  if (pastille) afficherInfobulle(pastille);
});

document.addEventListener("pointerout", (evenement) => {
  const pastille = evenement.target.closest && evenement.target.closest(PORTEURS_INFOBULLE);
  // On ne masque que si l'on quitte vraiment la pastille : `pointerout` part
  // aussi quand le pointeur passe d'un enfant à un autre à l'intérieur.
  if (pastille && pastille === infobulleAncre && !pastille.contains(evenement.relatedTarget)) {
    masquerInfobulle();
  }
});

// Le clavier : la pastille est focusable (`tabindex="0"`), la bulle doit donc
// s'ouvrir au focus comme au survol.
document.addEventListener("focusin", (evenement) => {
  const pastille = evenement.target.closest && evenement.target.closest(PORTEURS_INFOBULLE);
  if (pastille) afficherInfobulle(pastille);
});

document.addEventListener("focusout", (evenement) => {
  if (evenement.target === infobulleAncre) masquerInfobulle();
});

// UNE PASTILLE PEUT DISPARAÎTRE SOUS LA BULLE. Les tableaux de l'application se
// redessinent tout seuls (une veille de doublons qui répond, un rechargement
// d'écran) : la pastille survolée est alors remplacée par une neuve, et
// `pointerout` ne partira jamais du nœud détaché. La bulle resterait ouverte
// indéfiniment. On le constate au premier mouvement — la vérification ne coûte
// qu'un test de vérité tant qu'aucune bulle n'est ouverte.
document.addEventListener("pointermove", () => {
  if (infobulleAncre && !infobulleAncre.isConnected) masquerInfobulle();
});

// Une bulle en `position: fixed` ne suit pas ce qui défile sous elle : elle
// resterait plantée à côté d'une pastille partie ailleurs. On la ferme —
// rouvrir demande un survol, et le survol est déjà là.
window.addEventListener("scroll", masquerInfobulle, true);
window.addEventListener("resize", masquerInfobulle);
document.addEventListener("keydown", (evenement) => {
  if (evenement.key === "Escape") masquerInfobulle();
});

/* ---------- Ctrl + Entrée : valider là où l'on est ----------
 *
 * Entrée valide déjà un formulaire du navigateur, mais seulement depuis un
 * champ d'une ligne — jamais depuis une zone de notes (où il saute une ligne),
 * et pas du tout dans les endroits qui ne sont pas des <form> : l'édition
 * d'une ligne d'aperçu d'import, l'éditeur de règles, une fenêtre modale. Il
 * fallait donc y attraper le bouton à la souris.
 *
 * LE GESTE EST TOUJOURS LE MÊME : « termine ce que je suis en train de
 * remplir ». On cherche donc le CONTENEUR DE SAISIE où le focus se trouve, et
 * on actionne son bouton principal — le même que celui qu'on aurait cliqué.
 * Rien n'est validé hors d'un tel conteneur : Ctrl+Entrée n'importe où sur une
 * page ne doit rien déclencher du tout.
 *
 * ⌘ + Entrée fonctionne aussi : c'est le même geste sur un clavier Mac, et la
 * fenêtre de l'application y tourne aussi.
 */

// Les endroits où un Ctrl+Entrée veut dire quelque chose. Le premier ancêtre
// du focus qui correspond gagne : un formulaire imbriqué dans une modale est
// bien ce qu'on remplit, pas la modale.
const CONTENEURS_VALIDATION = [
  "form",
  // Édition d'une ligne dans l'aperçu d'import (une rangée de tableau, pas un
  // formulaire — le noyau y construit ses champs à la main).
  "tr.ligne-apercu-edition",
  // Éditeur de l'extension « Règles de catégorisation ».
  ".regle-editeur",
  // La boîte d'une fenêtre modale, en dernier : elle englobe tout le reste.
  ".modale",
].join(", ");

/**
 * Ce que Ctrl+Entrée ne doit JAMAIS actionner, par identifiant de bouton.
 *
 * « Confirmer l'import » écrit des dizaines d'opérations en base d'un coup, et
 * c'est le seul bouton de l'application dont le résultat ne se défait pas d'un
 * clic. Il reste à la souris, délibérément : un raccourci qui part tout seul
 * pendant qu'on relit un aperçu ferait exactement le dégât qu'on passe cet
 * écran à éviter.
 */
const VALIDATION_INTERDITE = new Set(["btn-import-confirmer"]);

/** La boîte de la fenêtre modale ouverte, s'il y en a une. */
function modaleOuverte() {
  return [...document.querySelectorAll(".modale-fond")]
    .filter((fond) => fond.style.display !== "none")
    .map((fond) => fond.querySelector(".modale"))
    .find(Boolean);
}

/**
 * Le bouton qui valide ce conteneur : son bouton principal, ou à défaut son
 * bouton de soumission.
 *
 * `offsetParent` écarte ce qui est masqué — un formulaire d'opération peut
 * porter des champs et des boutons cachés selon le type choisi, et actionner
 * un bouton invisible serait incompréhensible.
 */
function boutonDeValidation(conteneur) {
  return [...conteneur.querySelectorAll("button.primary, button[type='submit']")].find(
    (bouton) =>
      !bouton.disabled && bouton.offsetParent !== null && !VALIDATION_INTERDITE.has(bouton.id)
  );
}

document.addEventListener("keydown", (evenement) => {
  if (evenement.key !== "Enter" || evenement.altKey || evenement.shiftKey) return;
  if (!evenement.ctrlKey && !evenement.metaKey) return;

  // `target` plutôt que `document.activeElement` : une touche part TOUJOURS de
  // l'élément qui a le focus, et c'est ce que dit `target`. Les deux disent la
  // même chose dans une fenêtre ordinaire, mais `target` le dit aussi quand la
  // fenêtre elle-même n'a pas le focus du système.
  const depart =
    evenement.target instanceof Element ? evenement.target : document.activeElement;
  // LA MODALE D'ABORD, quel que soit le focus : la page derrière est grisée et
  // hors d'atteinte, valider quelque chose dedans n'aurait aucun sens.
  const conteneur =
    modaleOuverte() || (depart && depart.closest(CONTENEURS_VALIDATION));
  if (!conteneur) return;
  // Une fenêtre de l'import ouverte PAR CETTE FRAPPE (la dernière confirmation de l'étape d'avant) n'est pas
  // validée par elle : son premier bouton principal est la confirmation de sa première carte.
  const fond = conteneur.closest(".modale-fond");
  if (fond && toucheAvantOuverture(evenement, fond.id)) return;

  const bouton = boutonDeValidation(conteneur);
  if (!bouton) return;
  // Empêche au passage le saut de ligne d'une zone de notes, et la soumission
  // native que le navigateur aurait pu déclencher en plus du clic.
  evenement.preventDefault();
  bouton.click();
});

/* ---------- Base de données : emplacement, bascule, premier démarrage ----------
 *
 * Venu de l'extension de développement `base-de-donnees`, qui n'existe plus.
 * Le raisonnement qui en faisait un outil réservé au développement — ouvrir une
 * base arbitraire est un moyen commode de travailler sans s'en rendre compte
 * sur la mauvaise — tenait tant que la base PAR DÉFAUT était sûre. Elle ne l'est
 * pas : elle vit dans le dossier de l'application, que la prochaine mise à jour
 * remplace. Sur macOS elle est même DANS le bundle `.app`, que le Finder
 * remplace en entier sans jamais proposer de fusionner.
 *
 * Cf. backend/app/routers/parametres_base.py pour le versant serveur.
 */

// La bascule recharge la page : le compte rendu de migration renvoyé par le
// serveur serait perdu à l'instant même où il compte. On le met de côté le
// temps du rechargement, et on l'affiche une fois — jamais deux.
function afficherMigrationBaseSiRecente() {
  const brut = sessionStorage.getItem("migrationBase");
  if (!brut) return;
  sessionStorage.removeItem("migrationBase");
  let info;
  try {
    info = JSON.parse(brut);
  } catch {
    return;
  }
  // Persistant : le chemin de la copie est trop long à lire en quatre secondes,
  // et c'est la seule fois où il est donné.
  showMessage(
    `Base mise à jour du schéma ${info.revision_quittee} vers ${info.revision_app}. ` +
      `Copie de l'état précédent conservée ici : ${info.sauvegarde}`,
    "success",
    { persistent: true }
  );
}

// Changer de base rend caduque tout ce que l'app a déjà chargé (comptes,
// catégories, opérations d'une autre base ne correspondent à rien ici) : un
// rechargement complet est le seul moyen sûr d'éviter un état mélangé.
function rechargerApresBascule(etat) {
  if (etat && etat.migration_appliquee) {
    sessionStorage.setItem(
      "migrationBase",
      JSON.stringify({
        revision_quittee: etat.revision_quittee,
        revision_app: etat.revision_app,
        sauvegarde: etat.sauvegarde,
      })
    );
  }
  window.location.reload();
}

/**
 * Le sélecteur de fichiers DU SYSTÈME, quand on tourne dans l'application de
 * bureau. Rend null si elle n'est pas là (page ouverte dans un navigateur
 * pendant le développement) ou si l'utilisateur a annulé.
 *
 * POURQUOI IL FAUT PASSER PAR LE NATIF. Un navigateur ne donne JAMAIS le chemin
 * complet d'un fichier choisi — `<input type="file">` ne rend qu'un nom, et
 * c'est une limite de sécurité, pas un oubli. Or c'est exactement un chemin
 * complet que l'application demande. Côté bureau, pywebview expose de quoi
 * ouvrir le vrai sélecteur (cf. ApiBureau dans desktop/app_desktop.py).
 */
function selecteurNatifDisponible() {
  return Boolean(window.pywebview && window.pywebview.api);
}

async function choisirCheminNatif(methode, cheminPropose) {
  if (!selecteurNatifDisponible()) return null;
  try {
    const chemin = await window.pywebview.api[methode](cheminPropose || "");
    return chemin || null;
  } catch {
    // Un sélecteur qui ne s'ouvre pas ne doit pas casser l'écran : la saisie à
    // la main reste possible, et c'était le seul chemin avant.
    return null;
  }
}

async function loadParametresBdd() {
  try {
    const etat = await apiFetch("/parametres/base");
    document.getElementById("bdd-chemin").value = etat.chemin_actuel;

    // L'AVERTISSEMENT EST LE CŒUR DE L'ÉCRAN, pas une décoration : c'est la
    // seule chose qui distingue une installation dont les données survivront
    // d'une installation dont elles disparaîtront à la prochaine archive.
    const alerte = document.getElementById("bdd-alerte-risque");
    const messages = [];
    if (etat.a_risque) {
      messages.push(
        t(
          "Cette base est dans le dossier de l'application ({dossier}). Une mise à jour " +
            "la remplacera : déplace-la ailleurs, par exemple {propose}.",
          { dossier: etat.dossier_application, propose: etat.chemin_propose }
        )
      );
    }
    if (etat.base_memorisee_introuvable) {
      messages.push(
        t(
          "La base retenue au dernier lancement est introuvable : {chemin}. L'application " +
            "est repartie sur son emplacement par défaut — rien n'a été effacé, le fichier " +
            "est simplement ailleurs (disque débranché, dossier renommé).",
          { chemin: etat.base_memorisee_introuvable }
        )
      );
    }
    // Une installation de mise au point retient maintenant SA base, sous sa propre
    // clé (cf. parametres_base._memoriser) : le message d'avertissement ne
    // concerne plus que l'écriture ratée, pour elle comme pour une version publiée.
    if (!etat.choix_memorise) {
      messages.push(
        t("Ce choix n'a pas pu être enregistré : il ne vaudra que pour cette session.")
      );
    }
    // La version de schéma du fichier ouvert, face à celle qu'attend l'app :
    // un écart est exactement ce qui rend une base illisible après une mise à
    // jour, et c'est la première chose à vérifier quand quelque chose cloche.
    // Elle n'a plus sa ligne à elle (le bloc « Base actuelle » a disparu) : un
    // schéma à jour n'apprend rien, un schéma qui diverge rejoint l'alerte.
    if (etat.revision_base !== etat.revision_app) {
      messages.push(
        `Schéma ${etat.revision_base || "inconnu"}, l'application attend ${etat.revision_app}.`
      );
    }
    alerte.innerHTML = messages.map((m) => `<div>${escapeHtml(m)}</div>`).join("");
    alerte.style.display = messages.length ? "" : "none";

    // LE RESET N'EXISTE QU'EN MODE DÉVELOPPEMENT, et il ne s'affiche que s'il
    // a quelque chose à faire : proposer « revenir à la base de l'application »
    // alors qu'on y est déjà est un bouton qui ne peut rien changer.
    document.getElementById("btn-bdd-reinitialiser").style.display =
      etat.mode_developpement && !etat.est_dev ? "" : "none";
  } catch (err) {
    showMessage(err.message, "error");
  }
}

// « Revenir à la base de l'application » — le geste que l'ancienne extension
// développeur faisait toute seule à chaque fermeture. Redémarrer suffit déjà
// (le mode développement repart TOUJOURS de sa base native, cf.
// database._resoudre_chemin_demarrage) ; ce bouton évite simplement d'attendre,
// et de laisser une base personnelle ouverte derrière soi le temps de la
// session.
document.getElementById("btn-bdd-reinitialiser").addEventListener("click", async () => {
  if (
    !confirm(
      t(
        "Revenir à la base de l'application ? La base actuellement ouverte est simplement " +
          "refermée — aucun fichier n'est modifié ni supprimé."
      )
    )
  )
    return;
  try {
    rechargerApresBascule(
      await apiFetch("/parametres/base/reinitialiser", { method: "POST" })
    );
  } catch (err) {
    showMessage(err.message, "error");
  }
});

document.getElementById("btn-bdd-parcourir").addEventListener("click", async () => {
  // Le vrai sélecteur du système dans l'application de bureau ; à défaut, le
  // champ de fichier du navigateur, qui ne pré-remplit que le NOM (cf. la note
  // sous le champ, qui dit exactement cette limite).
  const chemin = await choisirCheminNatif(
    "choisir_base_existante",
    document.getElementById("bdd-chemin").value.trim()
  );
  if (chemin) {
    document.getElementById("bdd-chemin").value = chemin;
    return;
  }
  if (selecteurNatifDisponible()) return; // annulé : ne rien changer
  document.getElementById("bdd-fichier").click();
});

document.getElementById("bdd-fichier").addEventListener("change", (e) => {
  const fichier = e.target.files[0];
  if (!fichier) return;
  // Le navigateur ne donne jamais le chemin complet (sécurité) : seul le nom
  // sert d'indice, à compléter du dossier à la main.
  document.getElementById("bdd-chemin").value = fichier.name;
  document.getElementById("bdd-chemin").focus();
});

document.getElementById("form-bdd").addEventListener("submit", async (e) => {
  e.preventDefault();
  const chemin = document.getElementById("bdd-chemin").value.trim();
  if (!chemin) {
    showMessage(t("Renseigne le chemin complet du fichier .db."), "error");
    return;
  }
  if (!confirm(`Basculer toutes les opérations de l'app vers :\n${chemin}\n\nContinuer ?`)) return;
  try {
    rechargerApresBascule(
      await apiFetch("/parametres/base", { method: "PUT", body: JSON.stringify({ chemin }) })
    );
  } catch (err) {
    showMessage(err.message, "error");
  }
});

// « Créer / déplacer ici » : le même geste que l'écran de premier démarrage,
// accessible après coup. DÉPLACE la base ouverte tant qu'elle est encore dans
// le dossier de l'application — c'est le cas qu'on cherche à corriger, et
// laisser derrière une copie que la mise à jour effacera n'aurait aucun sens.
document.getElementById("btn-bdd-installer").addEventListener("click", async () => {
  const chemin = document.getElementById("bdd-chemin").value.trim();
  if (!chemin) {
    showMessage(t("Renseigne le chemin complet du fichier .db."), "error");
    return;
  }
  let etatActuel;
  try {
    etatActuel = await apiFetch("/parametres/base");
  } catch (err) {
    showMessage(err.message, "error");
    return;
  }
  if (!confirm(`Mettre la base à cet emplacement :\n${chemin}\n\nContinuer ?`)) return;
  try {
    const etat = await apiFetch("/parametres/base/installer", {
      method: "POST",
      body: JSON.stringify({ chemin, deplacer_actuelle: etatActuel.a_risque }),
    });
    sessionStorage.setItem("baseInstallee", etat.a_risque ? "a-risque" : etat.action || "");
    sessionStorage.setItem("baseInstalleeDossier", etat.dossier_application || "");
    rechargerApresBascule(etat);
  } catch (err) {
    showMessage(err.message, "error");
  }
});

function afficherInstallationBaseSiRecente() {
  const action = sessionStorage.getItem("baseInstallee");
  if (action === null) return;
  sessionStorage.removeItem("baseInstallee");
  const dossier = sessionStorage.getItem("baseInstalleeDossier") || "";
  sessionStorage.removeItem("baseInstalleeDossier");
  if (action === "a-risque") {
    showMessage(t(MESSAGE_BASE_ENCORE_A_RISQUE, { dossier }), "error", { persistent: true });
    return;
  }
  const phrases = {
    déplacée: "Tes données ont été déplacées : elles ne sont plus dans le dossier de l'application, une mise à jour ne les touchera plus.",
    créée: "Nouvelle base créée à l'emplacement choisi.",
    ouverte: "Base existante ouverte à l'emplacement choisi.",
  };
  showMessage(t(phrases[action] || "Emplacement de la base mis à jour."), "success", {
    persistent: true,
  });
}

function afficherCheminActuelModaleBdd(chemin) {
  document.getElementById("modale-bdd-explication").textContent = t(
    "Actuellement : {chemin}. Ce fichier sera DÉPLACÉ vers l'emplacement ci-dessus (rien n'est perdu, rien n'est copié en double).",
    { chemin }
  );
}

/** Le message sous le champ de la fenêtre, dans le paragraphe d'avertissement de l'import (son style). */
function ecrireErreurModaleBdd(message) {
  const erreur = document.getElementById("modale-bdd-erreur");
  const paragraphe = document.createElement("p");
  paragraphe.className = "import-avertissement";
  paragraphe.textContent = traduireMessageServeur(message);
  erreur.replaceChildren(paragraphe);
  erreur.style.display = "";
}

/* UN EMPLACEMENT ENCORE À RISQUE : la base a bien été déplacée, mais toujours DANS le dossier de
 * l'application (un sous-dossier, par exemple). Le serveur le dit (`a_risque`) ; rien ne l'aurait
 * dit à l'écran, et l'utilisateur serait reparti rassuré vers une mise à jour qui l'écrase. */
const MESSAGE_BASE_ENCORE_A_RISQUE =
  "Cet emplacement est encore dans le dossier de l'application ({dossier}) : une mise à jour écraserait toujours ta base. Choisis un dossier en dehors.";

/* ---------- L'écran de la langue (tout premier écran) ----------
 *
 * UNE LANGUE EST « CHOISIE » QUAND `localStorage` EN PORTE UNE : `langueEnregistree` (i18n.js) retombe
 * sur l'anglais sans rien écrire, et la base, elle, reçoit la langue affichée dès le premier chargement
 * (cf. restaurerLangueDepuisLaBase) - ni l'un ni l'autre ne dit qu'on a DÉCIDÉ. Un `localStorage`
 * vidé fait redemander la langue, ce qui est le bon réflexe sur un poste neuf. */
const NOMS_LANGUES = { fr: "Français", en: "English", pt: "Português (Brasil)" };

function langueAChoisir() {
  try {
    return localStorage.getItem(CLE_STOCKAGE) === null;
  } catch (err) {
    // Stockage indisponible : le choix ne se retiendrait pas, inutile de le demander à chaque lancement.
    return false;
  }
}

function afficherEcranLangue() {
  document.getElementById("modale-langue-titre").textContent =
    "Choisis ta langue · Choose your language · Escolha seu idioma";
  const zone = document.getElementById("modale-langue-choix");
  zone.innerHTML = "";
  LANGUES.forEach((code) => {
    const bouton = document.createElement("button");
    bouton.type = "button";
    bouton.className = "modale-choix-bouton modale-langue-bouton";
    bouton.dataset.langueAccueil = code;
    const drapeau = document.querySelector(`#langue [data-langue="${code}"] svg`);
    if (drapeau) {
      const copie = drapeau.cloneNode(true);
      copie.setAttribute("width", "30");
      copie.setAttribute("height", "21");
      bouton.appendChild(copie);
    }
    const nom = document.createElement("span");
    nom.textContent = NOMS_LANGUES[code];
    bouton.appendChild(nom);
    bouton.addEventListener("click", () => choisirLangueAccueil(code));
    zone.appendChild(bouton);
  });
  document.getElementById("modale-langue").style.display = "";
  const premier = zone.querySelector("button");
  if (premier) premier.focus();
}

async function choisirLangueAccueil(code) {
  document.querySelectorAll("[data-langue-accueil]").forEach((b) => (b.disabled = true));
  try {
    localStorage.setItem(CLE_STOCKAGE, code);
  } catch (err) {
    /* Sans stockage, la langue ne survivra pas au rechargement : on avance quand même. */
  }
  await ecrireLangueEnBase(code);
  // Toujours un rechargement : la page se retraduit, et la fenêtre de la base s'ouvre à sa suite - dans
  // la langue qu'on vient de choisir, même quand c'est celle qui était déjà affichée.
  window.location.reload();
}

/**
 * L'écran BLOQUANT du premier démarrage.
 *
 * NE BLOQUE PAS LE CHARGEMENT DE L'APPLICATION derrière lui : la modale se pose
 * par-dessus une application déjà chargée. Si quoi que ce soit échouait dans
 * cette vérification, l'utilisateur se retrouverait sinon devant une page
 * blanche sans recours — or ce qu'on protège ici est justement ce qu'il ne faut
 * pas rendre inaccessible.
 */
async function verifierEmplacementBase() {
  let etat;
  try {
    etat = await apiFetch("/parametres/base");
  } catch {
    // Le serveur n'a pas répondu : l'init a déjà signalé le problème, et une
    // seconde erreur sur le même sujet n'apprendrait rien.
    return;
  }
  if (etat.base_memorisee_introuvable) {
    showMessage(
      `Base introuvable à l'emplacement retenu (${etat.base_memorisee_introuvable}). ` +
        `L'application s'est ouverte sur sa base par défaut : va dans Paramètres → Base de données.`,
      "error",
      { persistent: true }
    );
  }
  if (!etat.configuration_requise) return;

  // LA LANGUE D'ABORD : un premier lancement s'ouvre sur son choix, puis (au rechargement qui suit)
  // sur la fenêtre de la base, comme avant.
  if (langueAChoisir()) {
    afficherEcranLangue();
    return;
  }

  const champ = document.getElementById("modale-bdd-chemin");
  champ.value = etat.chemin_propose;
  afficherCheminActuelModaleBdd(etat.chemin_actuel);
  // Le bouton n'apparaît que si le sélecteur du système répond présent : dans
  // un navigateur, il n'ouvrirait rien.
  document.getElementById("btn-modale-bdd-parcourir").style.display = selecteurNatifDisponible()
    ? ""
    : "none";
  document.getElementById("modale-bdd").style.display = "";
  champ.focus();
}

// L'API de bureau est INJECTÉE APRÈS le chargement de la page : pywebview
// signale sa disponibilité par cet événement, qui peut très bien arriver
// pendant que la modale est déjà ouverte. Sans ce rattrapage, l'écran de
// premier démarrage se figerait sur le seul cas « pas de sélecteur » selon
// l'ordre du démarrage — un bouton présent une fois sur deux.
window.addEventListener("pywebviewready", () => {
  const modale = document.getElementById("modale-bdd");
  if (modale.style.display !== "none") {
    document.getElementById("btn-modale-bdd-parcourir").style.display = "";
  }
});

document.getElementById("btn-modale-bdd-parcourir").addEventListener("click", async () => {
  const champ = document.getElementById("modale-bdd-chemin");
  // « Enregistrer sous » et non « ouvrir » : on désigne ici l'endroit où la
  // base VA être rangée, un fichier qui n'existe pas encore. Un sélecteur
  // d'ouverture ne saurait montrer que ce qui est déjà là.
  const chemin = await choisirCheminNatif("choisir_emplacement_base", champ.value.trim());
  if (chemin) champ.value = chemin;
});

/* LE CHOIX DU SECOND POINT (le premier import, les tutoriels, la démo : « import » | « tutoriels » |
 * « demo ») est seulement NOTÉ : la fenêtre est bloquante jusqu'à ce que la base soit rangée, et le
 * guide ne démarre qu'à la page suivante (cf. premier-demarrage.js). `sessionStorage` comme
 * `baseInstallee` : il survit au rechargement qui suit l'installation, et pas à la fermeture de
 * l'application - un guide qu'on a laissé de côté ne revient pas au prochain lancement.
 * Le bouton « Choisir » d'une carte la choisit, la carte entière aussi (une grande cible plutôt qu'un
 * petit bouton) ; la carte choisie est entourée de bleu. */
const CLE_GUIDE_DEMARRAGE = "budget-app.guide-demarrage";
let choixDecouverte = null;

function choisirDecouverte(voulu) {
  choixDecouverte = choixDecouverte === voulu ? null : voulu;
  document.querySelectorAll("[data-choix-decouverte]").forEach((bouton) => {
    bouton.setAttribute("aria-checked", String(bouton.dataset.choixDecouverte === choixDecouverte));
  });
  document.querySelectorAll("[data-carte-decouverte]").forEach((carte) => {
    carte.classList.toggle("choisie", carte.dataset.carteDecouverte === choixDecouverte);
  });
}

document.querySelectorAll("[data-carte-decouverte]").forEach((carte) => {
  carte.addEventListener("click", () => choisirDecouverte(carte.dataset.carteDecouverte));
});

function noterChoixDecouverte() {
  try {
    if (choixDecouverte) sessionStorage.setItem(CLE_GUIDE_DEMARRAGE, choixDecouverte);
  } catch (err) {
    // Stockage indisponible : l'installation continue sans guide, rien de cassé.
  }
}

document.getElementById("btn-modale-bdd-valider").addEventListener("click", async () => {
  const bouton = document.getElementById("btn-modale-bdd-valider");
  const erreur = document.getElementById("modale-bdd-erreur");
  const chemin = document.getElementById("modale-bdd-chemin").value.trim();
  if (!chemin) return;
  bouton.disabled = true;
  erreur.style.display = "none";
  try {
    const etat = await apiFetch("/parametres/base/installer", {
      method: "POST",
      // `true` sans condition : cette modale ne s'ouvre QUE sur une base à
      // risque (cf. configuration_requise), et cette base-là a déjà été créée
      // et remplie de ses valeurs initiales au démarrage. En créer une seconde,
      // vide, en abandonnant la première dans le dossier que la mise à jour
      // efface, serait le plus mauvais des deux mondes.
      body: JSON.stringify({ chemin, deplacer_actuelle: true }),
    });
    if (etat.a_risque) {
      // DÉPLACÉE, MAIS PAS À L'ABRI : la fenêtre reste ouverte, avec le nouveau chemin et la
      // raison, et un second essai déplace la base depuis là où elle est maintenant.
      afficherCheminActuelModaleBdd(etat.chemin_actuel);
      ecrireErreurModaleBdd(t(MESSAGE_BASE_ENCORE_A_RISQUE, { dossier: etat.dossier_application }));
      bouton.disabled = false;
      return;
    }
    sessionStorage.setItem("baseInstallee", etat.action || "");
    noterChoixDecouverte();
    // LA LANGUE CHOISIE À L'ACCUEIL SUIT LE CHOIX DE LA BASE : au rechargement, c'est la base qui fait foi
    // (cf. restaurerLangueDepuisLaBase). Une base rouverte à cet emplacement (« ouverte ») porte sa
    // propre langue, souvent l'anglais d'un essai précédent : sans cette écriture, tout ce qui suit la
    // fenêtre repartirait dans cette langue-là, alors qu'on vient de choisir la sienne.
    await ecrireLangueEnBase(langue());
    rechargerApresBascule(etat);
  } catch (err) {
    ecrireErreurModaleBdd(err.message);
    bouton.disabled = false;
  }
});

/* ---------- Le bloc « Projets & Objectifs » du dashboard ----------
 *
 * UN TITRE POUR DEUX CONTENEURS que des extensions remplissent chacune de leur côté
 * (`#dashboard-projets`, `#dashboard-objectifs`) : le bloc se montre dès que l'un des deux porte
 * quelque chose, et se masque quand ils sont vides tous les deux. Le « i » est celui des
 * objectifs : il n'apparaît qu'avec eux. Un observateur plutôt qu'un appel depuis chaque extension -
 * le noyau ne sait pas lesquelles tournent, ni dans quel ordre elles répondent. */
function majBlocEpingles() {
  const bloc = document.getElementById("dashboard-epingles");
  if (!bloc) return;
  const plein = (id) => {
    const conteneur = document.getElementById(id);
    return !!conteneur && conteneur.style.display !== "none" && conteneur.childElementCount > 0;
  };
  const objectifs = plein("dashboard-objectifs");
  bloc.style.display = objectifs || plein("dashboard-projets") ? "" : "none";
  document.getElementById("dashboard-epingles-info").style.display = objectifs ? "" : "none";
}

["dashboard-projets", "dashboard-objectifs"].forEach((id) => {
  const conteneur = document.getElementById(id);
  if (!conteneur) return;
  new MutationObserver(majBlocEpingles).observe(conteneur, {
    childList: true,
    attributes: true,
    attributeFilter: ["style"],
  });
});

/* ---------- Init ---------- */

document.querySelectorAll("nav button").forEach((btn) => {
  btn.addEventListener("click", () => switchSection(btn.dataset.section));
});

// Exposée pour qui doit attendre que l'application soit prête (le tutoriel qui reprend
// après un rechargement, cf. tutoriel.js).
BudgetApp.pret = (async function init() {
  try {
    await loadMeta();
    // Avant les comptes : le formulaire d'opération lit les monnaies du compte
    // choisi dès son premier rendu.
    await refreshMonnaies();
    await refreshComptes();
    await refreshCategories();
    resetOperationForm();
    // AVANT le premier rendu : une extension qui apporte un écran doit avoir
    // posé son bouton de navigation avant que l'utilisateur ne regarde la
    // barre. Ne lève jamais — une extension en panne n'empêche pas le budget
    // de s'ouvrir (cf. frontend/extensions.js).
    // AVANT les extensions, qui ont leur propre fenêtre de lancement : deux
    // modales empilées cacheraient celle des deux qui bloque. L'annonce des
    // extensions se tait d'elle-même tant que celle-ci est ouverte (cf.
    // extensions.js::afficherModaleExtensions), et reparaît au rechargement
    // qui suit le choix.
    //
    // Ne bloque PAS le reste de l'init : la modale se pose par-dessus une
    // application qui finit de se charger derrière. Si quoi que ce soit
    // échouait ici, l'utilisateur se retrouverait sinon devant une page blanche
    // sans recours — or c'est justement l'accès à ses données qu'on protège.
    afficherMigrationBaseSiRecente();
    afficherInstallationBaseSiRecente();
    await verifierEmplacementBase();
    await chargerExtensions();
    await loadDashboard();
  } catch (err) {
    showMessage(
      `Impossible de contacter le serveur (${err.message}). Vérifie que le backend est bien démarré (uvicorn) et que cette page est ouverte via http://127.0.0.1:8000, pas en ouvrant le fichier directement.`,
      "error",
      { persistent: true }
    );
  }
})();
