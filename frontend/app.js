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
  // La monnaie du camembert « Répartition des avoirs », page Vue globale des
  // comptes. UNE TROISIÈME SÉLECTION, indépendante des deux autres : cette
  // page-là n'a pas d'onglet de monnaie (chaque carte montre tous ses soldes),
  // et le camembert est le seul de ses éléments qui doive en choisir une.
  comptesRepartitionMonnaieId: null,
  // Les six types d'opération (table `type_operation`) : le frontend ne déduit
  // plus le type d'une catégorie et d'un booléen, il le lit. `code` est la clé
  // technique stable ; `nom` n'est qu'un libellé, renommable par l'utilisateur.
  typesOperation: [],
  // Placements financiers : les titres suivis (table `action`, communs à tous
  // les comptes) et l'onglet de compte actuellement affiché.
  actions: [],
  placementCompteId: null,
  // {annee, mois, vue} -- `vue` ("mois" | "annee") est le niveau de
  // l'arborescence des filtres qui pilote la période, piloté par les flèches du
  // sélecteur (cf. initPeriodeSelector).
  dashboardPeriode: { vue: "mois" },
  // Le détail par semaine de l'histogramme, sous le sélecteur de mois.
  // `ouvert` : la rangée de semaines est-elle dépliée. `choix` : le rang de la
  // semaine regardée (1 pour la première du mois), la chaîne "moyenne", ou
  // NULL — et null veut dire « le mois entier », l'état où l'histogramme est
  // celui que le dashboard a toujours montré.
  dashboardSemaines: { ouvert: false, choix: null },
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
  triSelections: {
    classique: "date-desc",
    remboursable: "date-desc",
    remboursements: "date-desc",
    virements: "date-desc",
    prets: "date-desc",
    "remboursement-prets": "date-desc",
  },
};

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
 * Deux flèches qui montent et descendent d'un niveau : ▲ regroupe le mois dans
 * son année, ▼ redescend au mois. Utilisées à l'identique par la page Opérations
 * et par le dashboard, qui filtrent tous deux sur (année, mois).
 *
 * `vue` vaut "mois" ou "annee" ; `onChange` reçoit la vue demandée. La flèche
 * déjà au bout reste affichée mais désactivée : les deux sens sont ainsi
 * toujours au même endroit, plutôt qu'un bouton qui se déplace d'un clic à
 * l'autre.
 */
function renderFlechesPeriode(el, vue, onChange) {
  if (!el) return;
  el.innerHTML = "";
  [
    ["▲", "annee", "Filtrer sur l'année entière"],
    ["▼", "mois", "Filtrer sur un mois"],
  ].forEach(([glyphe, cible, titre]) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "periode-fleche";
    btn.textContent = glyphe;
    btn.title = titre;
    btn.disabled = vue === cible;
    btn.addEventListener("click", () => onChange(cible));
    el.appendChild(btn);
  });
}

/**
 * Grise le niveau qui ne pilote PAS le filtre, sans le masquer : en vue mois,
 * l'année reste lisible (sinon on ne sait plus lequel des douze mois de quelle
 * année on regarde) ; en vue année, les mois montrent ce que l'année recouvre.
 * Le niveau grisé reste cliquable — cf. .sous-onglets.en-veille.
 *
 * EN VUE « TOUT », LES DEUX DORMENT : aucun des deux niveaux ne borne plus rien
 * (cf. operationDansPeriode). Ils restent affichés, et cliquables — c'est par
 * eux qu'on redescend dans le temps. Seule la page Opérations connaît ce
 * troisième cran ; ailleurs, `vue` ne vaut jamais "tout" et rien ne change.
 */
function appliquerVeillePeriode(elAnnees, elMois, vue) {
  if (elAnnees) elAnnees.classList.toggle("en-veille", vue === "mois" || vue === "tout");
  if (elMois) elMois.classList.toggle("en-veille", vue === "annee" || vue === "tout");
}

// Sélecteur à deux niveaux (année puis mois), réutilisé sur le dashboard et la
// page Catégories. `courant` est un objet mutable {annee, mois, vue} partagé
// avec l'appelant : rempli au premier appel (dernière période connue, qui inclut
// toujours le mois en cours côté backend), mis à jour aux clics.
//
// `elFleches` est facultatif : là où il est fourni (dashboard), le filtre peut
// monter d'un cran et couvrir l'année entière, et `courant.vue` dit lequel des
// deux niveaux pilote. Là où il ne l'est pas (page Catégories), il n'y a rien à
// remonter — un budget est mensuel par nature — et le sélecteur se comporte
// exactement comme avant.
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

async function initPeriodeSelector(elAnnees, elMois, courant, onSelect, elFleches = null) {
  const periodes = await apiFetch("/meta/periodes"); // triées desc par (année, mois)
  if (periodes.length === 0) return;
  if (!courant.annee) {
    const defaut = periodeParDefaut(periodes);
    courant.annee = defaut.annee;
    courant.mois = defaut.mois;
  }
  if (elFleches && !courant.vue) courant.vue = "mois";

  function moisDisponibles(annee) {
    return periodes
      .filter((p) => p.annee === annee)
      .map((p) => p.mois)
      .sort((a, b) => a - b);
  }

  function render() {
    const annees = [...new Set(periodes.map((p) => p.annee))].sort((a, b) => b - a);
    elAnnees.innerHTML = "";
    annees.forEach((a) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = a;
      if (a === courant.annee) btn.classList.add("active");
      btn.addEventListener("click", () => {
        courant.annee = a;
        const dispo = moisDisponibles(a);
        if (!dispo.includes(courant.mois)) courant.mois = dispo[dispo.length - 1];
        render();
        onSelect(courant.annee, courant.mois);
      });
      elAnnees.appendChild(btn);
    });

    elMois.innerHTML = "";
    moisDisponibles(courant.annee).forEach((m) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = MOIS_COURTS_FR[m - 1];
      if (m === courant.mois) btn.classList.add("active");
      btn.addEventListener("click", () => {
        courant.mois = m;
        // Cliquer un mois grisé redescend au mois : c'est le geste naturel
        // pour désigner celui qu'on veut voir, et il évite d'imposer un
        // aller-retour par la flèche.
        if (elFleches) courant.vue = "mois";
        render();
        onSelect(courant.annee, courant.mois);
      });
      elMois.appendChild(btn);
    });

    if (elFleches) {
      renderFlechesPeriode(elFleches, courant.vue, (vue) => {
        if (vue === courant.vue) return;
        courant.vue = vue;
        render();
        onSelect(courant.annee, courant.mois);
      });
      appliquerVeillePeriode(elAnnees, elMois, courant.vue);
    }
  }

  render();
  await onSelect(courant.annee, courant.mois);
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

function symboleMonnaie(monnaieId) {
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

// Œil ouvert / barré : une colonne lue, ou ignorée. Même famille de tracé que
// la poubelle ci-dessus, pour que les deux se ressemblent.
const ICONE_OEIL = `
  <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor"
       stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7Z" />
    <circle cx="12" cy="12" r="3" />
  </svg>
`;

const ICONE_OEIL_BARRE = `
  <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor"
       stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="M9.9 5.2A10.9 10.9 0 0 1 12 5c6.5 0 10 7 10 7a18.5 18.5 0 0 1-3 4.1" />
    <path d="M6.6 6.6A18.5 18.5 0 0 0 2 12s3.5 7 10 7a10.8 10.8 0 0 0 5.4-1.4" />
    <path d="M14.1 14.1a3 3 0 0 1-4.2-4.2" />
    <path d="M3 3l18 18" />
  </svg>
`;

// Loupe et chevrons de la recherche. Même famille que la poubelle et l'œil
// ci-dessus — viewBox 24, trait de 2, bouts arrondis, `currentColor` — pour que
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
function showMessage(text, type, { persistent = false } = {}) {
  const container = document.getElementById("toast-container");
  const toast = document.createElement("div");
  toast.className = `toast ${type}`;
  // Dernier filet pour les messages VENUS DU SERVEUR : ceux de l'app sont déjà
  // passés par `t()` à l'appel (une seconde traduction ne trouve rien et laisse
  // le texte tel quel), mais une erreur d'API arrive ici en français brut, sans
  // que l'appelant sache seulement ce qu'elle dit (cf. apiFetch, qui la relaie).
  toast.textContent = traduireMessageServeur(text);
  toast.addEventListener("click", () => toast.remove());
  container.appendChild(toast);
  if (!persistent) {
    setTimeout(() => {
      toast.classList.add("sortant");
      toast.addEventListener("animationend", () => toast.remove());
    }, 4500);
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
  const firstOption = keepFirst ? selectEl.firstElementChild : null;
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
  return section.querySelector(".sous-section.active") || section;
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
    if (resultat) resultat.textContent = rechercheTerme.trim() ? "aucun résultat" : "";
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
 * son manifeste) : « Import de placements » s'ouvre depuis la page Placements
 * et en est une action, pas une destination. La barre doit alors continuer de
 * montrer d'où l'on vient, sinon plus rien n'y est allumé et l'application a
 * l'air d'avoir quitté toutes ses pages.
 */
function switchSection(name, { ongletActif = name } = {}) {
  document.querySelectorAll("section").forEach((s) => s.classList.remove("active"));
  document.getElementById(`section-${name}`).classList.add("active");
  document.querySelectorAll("nav button").forEach((b) => b.classList.remove("active"));
  // `?.` : rien ne garantit un bouton — cf. `ongletActif` ci-dessus.
  document.querySelector(`nav button[data-section="${ongletActif}"]`)?.classList.add("active");

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

/* ---------- Vue globale des comptes (onglets) ---------- */

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
// place ici, aux côtés des correspondances et de l'import.
function chargerSousPageParametres(page) {
  if (page === "parametres-generaux") loadParametresGeneraux();
  if (page === "parametres-comptes") loadComptes();
  if (page === "parametres-categories") loadCategories();
  if (page === "parametres-correspondances") loadCorrespondances();
  if (page === "parametres-import") loadImportSection();
  if (page === "parametres-extensions") loadExtensions();
  if (page === "parametres-bdd") loadParametresBdd();
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
function majAffichageToucheGel() {
  const champ = document.getElementById("reglage-touche-gel");
  if (!champ) return;
  const combo = toucheGelInfobulle();
  champ.value = combo ? libelleCombo(combo) : t("Désactivé");
}

function loadParametresGeneraux() {
  majAffichageToucheGel();
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
  chargerSousPageParametres(btnActif ? btnActif.dataset.sousSection : "parametres-comptes");
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
  fillSelect(document.getElementById("operation-statut"), state.meta.statuts, {
    labels: statutLabel,
  });

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

async function refreshMonnaies() {
  state.monnaies = await apiFetch("/monnaies");
  if (!state.dashboardMonnaieId && state.monnaies.length > 0) {
    state.dashboardMonnaieId = state.monnaies[0].id;
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
 * Barre d'onglets « une monnaie à la fois », utilisée partout où l'app agrège
 * des montants (KPI du dashboard, budgets par catégorie) : sans taux de change,
 * additionner deux monnaies n'aurait aucun sens, alors on n'en montre qu'une.
 *
 * Masquée quand il n'y a qu'une monnaie : un onglet unique n'apprend rien.
 */
function renderOngletsMonnaies(conteneurId, monnaies, monnaieIdActive, onSelect) {
  const barre = document.getElementById(conteneurId);
  barre.innerHTML = "";
  barre.style.display = monnaies.length > 1 ? "" : "none";
  if (monnaies.length <= 1) return;
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

// La vue du dashboard n'est plus une paire de boutons "Mois"/"Année" à part :
// c'est le même couple de flèches que la page Opérations, porté par le
// sélecteur de période lui-même (cf. initPeriodeSelector). La rangée de mois
// n'est plus masquée en vue année, seulement grisée : elle continue de montrer
// ce que l'année recouvre, et un clic dessus redescend au mois.
async function loadDashboard() {
  try {
    await refreshMonnaies();
    await loadNoteDashboard();
    await initPeriodeSelector(
      document.getElementById("dashboard-periode-annees"),
      document.getElementById("dashboard-periode-mois"),
      state.dashboardPeriode,
      loadDashboardData,
      document.getElementById("dashboard-periode-fleches")
    );
  } catch (err) {
    showMessage(err.message, "error");
  }
}

async function loadDashboardData(annee, mois) {
  // Posé AVANT le fetch, pas après : un drill-through déclenché pendant que
  // la requête est en vol doit déjà voir la BONNE période (cf.
  // dashboardAnneeMoisActuel, drillThroughCategorie).
  dashboardAnneeMoisActuel = { annee, mois };
  try {
    const url =
      state.dashboardPeriode.vue === "annee"
        ? `/dashboard?annee=${annee}&vue=annee`
        : `/dashboard?annee=${annee}&mois=${mois}`;
    const data = await apiFetch(url);

    // Un onglet par monnaie pilote tout le dashboard : les KPI et
    // l'histogramme. La sélection survit d'un rechargement à l'autre tant que
    // la monnaie existe encore.
    if (!data.kpis.some((k) => k.monnaie_id === state.dashboardMonnaieId)) {
      state.dashboardMonnaieId = data.kpis.length > 0 ? data.kpis[0].monnaie_id : null;
    }

    renderOngletsMonnaies(
      "dashboard-monnaies",
      data.monnaies,
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

/* ---------- Répartition des avoirs, page Vue globale des comptes ---------- */

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
    state.comptesRepartitionMonnaieId = monnaies.length > 0 ? monnaies[0].id : null;
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
  menu.parentElement.style.display = monnaies.length > 1 ? "" : "none";

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
  const surLAnnee = state.dashboardPeriode.vue === "annee";
  document.getElementById("kpi-variation-label").firstChild.nodeValue = surLAnnee
    ? t("Variation sur l'année brute")
    : t("Variation sur le mois brute");
  // Le libellé de l'attribuée suit la même vue, pour la même raison : « au
  // mois » au-dessus d'un total ANNUEL n'est pas seulement imprécis, il annonce
  // le mauvais ordre de grandeur.
  document.getElementById("kpi-variation-attribuee-label").firstChild.nodeValue = surLAnnee
    ? t("Variation attribuée à l'année")
    : t("Variation attribuée au mois");

  renderResteARembourser(kpis, monnaieId);
  renderFluxPeriode(kpis, monnaieId);
  dashboardDepensesDuMois = kpis.depenses_par_categorie || [];
  dashboardBudgetTotalDuMois = kpis.budget_total || 0;
  renderHistogrammeDashboard(dashboardDepensesDuMois, monnaieId);
}

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
  const enAnnee = state.dashboardPeriode.vue === "annee";
  const params = new URLSearchParams({ monnaie_id: monnaieId, annee });
  if (!enAnnee) params.set("mois", mois);

  try {
    const detail = await apiFetch(`/dashboard/ecart-variations?${params}`);

    // Les libellés suivent la vue, comme sur le dashboard : « au mois » au-dessus
    // d'un total annuel annoncerait le mauvais ordre de grandeur.
    document.getElementById("ecart-attribuee-label").firstChild.nodeValue = enAnnee
      ? t("Variation attribuée à l'année")
      : t("Variation attribuée au mois");
    document.getElementById("ecart-brute-label").firstChild.nodeValue = enAnnee
      ? t("Variation sur l'année brute")
      : t("Variation sur le mois brute");

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
 * Vue globale des comptes (cf. style.css, .compte-card.epargne/.placements),
 * une seule source évite que les deux dérivent l'une de l'autre au premier
 * changement de teinte.
 */
function couleurTypeCompte(cle) {
  return getComputedStyle(document.documentElement).getPropertyValue(`--compte-${cle}`).trim();
}

// Les trois familles, dans l'ordre où elles apparaissent en légende ET sur la
// Vue globale des comptes : courant, épargne, placements. `test` reprend
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
 * cartes de la Vue globale des comptes, qui affichent le réel en premier.
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
function couleurCategorie(couleurIndex) {
  return PALETTE_CATEGORIES[couleurIndex % PALETTE_CATEGORIES.length];
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
  const tranches = retenues.filter((d) => d.total_previsionnel > 0);
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
function contenuInfobulleCategorie(depense, monnaieId, chiffres = {}) {
  const {
    total = null,
    part = null,
    partLibelle = null,
    budget = null,
    objectif = null,
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

  const top = depense.top_depenses || [];
  const lignesTop = top
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

  const corps = top.length
    ? `<ul class="histo-bulle-liste">${lignesTop}</ul>`
    : `<div class="histo-bulle-vide">${t("Aucune opération sur la période.")}</div>`;

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

/** « ctrl+shift+f » → « Ctrl + Shift + F ». */
function libelleCombo(combo) {
  return combo
    .split("+")
    .map((m) => (m.length === 1 ? m.toUpperCase() : m.charAt(0).toUpperCase() + m.slice(1)))
    .join(" + ");
}

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
      const { depense, html } = contenuPour(cible);
      bulle.innerHTML = html;
      // Le bouton est recréé avec le contenu, son écouteur aussi : c'est ce qui
      // permet de capturer `depense` sans table de correspondance.
      bulle.querySelector("[data-drill-through]")?.addEventListener("click", () => {
        degelerInfobulle();
        bulle.classList.remove("visible");
        drillThroughCategorie(depense);
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
function renderHistogrammeDepenses(depenses, monnaieId, container = null) {
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
    ...depenses.map((d) => Math.max(d.total_reel, d.total_previsionnel, d.budget_alloue))
  );
  const echelle = zoneHauteur / (valeurMax * 1.1);

  const largeurBande = (largeur - margeCote * 2) / depenses.length;
  const largeurBarre = Math.min(60, largeurBande * 0.55);

  const barres = depenses
    .map((d, i) => {
      // `d.couleur_index`, pas `i` : la position dans cette liste change dès
      // qu'une catégorie est éteinte ou réordonnée, la couleur non.
      const couleur = couleurCategorie(d.couleur_index ?? i);
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
        tickBudget = `<rect class="histo-repere" x="${x}" y="${yBudget - 1.5}" width="${largeurBarre}" height="3" fill="#ef4444" />`;
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
          ${tickBudget}
          <text x="${centreX}" y="${hauteur - margeBas + 18}" text-anchor="middle" font-size="11" fill="#9ea3b0">${label}</text>
          <text class="histo-valeur" x="${centreX}" y="${yHaut - 6}" text-anchor="middle" font-size="10" fill="#e7e8ec">${d.total_previsionnel.toFixed(0)}</text>
        </g>
      `;
    })
    .join("");

  const ligneBase = `<line x1="${margeCote}" y1="${hauteur - margeBas}" x2="${largeur - margeCote}" y2="${hauteur - margeBas}" stroke="#4b5163" stroke-width="1" />`;

  container.innerHTML = `
    <svg viewBox="0 0 ${largeur} ${hauteur}" width="100%" height="${hauteur}" xmlns="http://www.w3.org/2000/svg">
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
      return {
        depense,
        html: contenuInfobulleCategorie(depense, monnaieId, {
          total: depense.total_previsionnel,
          budget: depense.budget_alloue,
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
function renderPieChartDepenses(depenses, monnaieId, container, parts) {
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
  const circonference = 2 * Math.PI * PIE_RAYON;

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
    ? `<circle class="camembert-piste" cx="${PIE_CENTRE_X}" cy="${PIE_CENTRE_Y}" r="${PIE_RAYON}"
        fill="none" stroke-width="${PIE_EPAISSEUR}" />`
    : "";

  const segments = tranches
    .map((d, i) => {
      const fraction = d.total_previsionnel / reference;
      const longueur = fraction * circonference;
      const couleur = couleurCategorie(d.couleur_index ?? i);
      // LA TRANCHE SE COLORE LE LONG DE L'ANNEAU (cf. .camembert-part) : son
      // tiret part de zéro et s'allonge jusqu'à sa longueur, après le temps
      // qu'ont mis les tranches précédentes. Les deux valeurs voyagent en
      // variables CSS parce que c'est la seule façon d'écrire une keyframe
      // commune à des tranches qui n'ont pas la même longueur.
      const segment = `<circle class="camembert-part" data-index="${i}" data-categorie="${escapeHtml(d.categorie)}" cx="${PIE_CENTRE_X}" cy="${PIE_CENTRE_Y}" r="${PIE_RAYON}"
        fill="none" stroke="${couleur}" stroke-width="${PIE_EPAISSEUR}"
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
  const rappels = [
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
             dominant-baseline="middle" font-size="11" fill="#9ea3b0">${t(
               "sur"
             )} ${formatMontant(budgetTotal, monnaieId)}</text>`
    : `<text x="${PIE_CENTRE_X}" y="${PIE_CENTRE_Y}" text-anchor="middle"
             dominant-baseline="middle" font-size="13" fill="#9ea3b0">${formatMontant(
               total,
               monnaieId
             )}</text>`;

  container.innerHTML = `
    <svg viewBox="0 0 ${largeur} ${hauteur}" width="100%" height="250"
         xmlns="http://www.w3.org/2000/svg" class="camembert-svg">
      <!-- Part à midi, sens horaire : -90° ramène le début du premier tracé
           (3 heures, l'origine d'un cercle SVG) à midi. Seul l'anneau tourne —
           les traits de rappel et leurs textes sont déjà calculés en
           coordonnées d'écran, les faire tourner avec lui écrirait les
           pourcentages couchés. -->
      <g transform="rotate(-90 ${PIE_CENTRE_X} ${PIE_CENTRE_Y})">${piste}${segments}</g>
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
      const depense = tranches[Number(cercle.dataset.index)];
      return {
        depense,
        html: contenuInfobulleCategorie(depense, monnaieId, {
          part: parts.part(depense),
          partLibelle: vueBudget ? t("Part du budget") : t("Part"),
          objectif: parts.objectif(depense),
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
          <span class="camembert-pastille" style="background:${couleurCategorie(
            d.couleur_index ?? i
          )}"></span>
          <span class="camembert-legende-nom">${escapeHtml(libelleCategorie(d.categorie))}</span>
          <span class="camembert-legende-part">${formatPourcentage(parts.part(d))}</span>
        </li>`
      )
      .join("")}</ul>
  `;

  attacherInfobulleCategorie(
    container,
    [...container.querySelectorAll(".camembert-legende-ligne")],
    (ligne) => {
      const depense = lignes[Number(ligne.dataset.index)];
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
 * LA MOYENNE N'A PAS DE BORNES À ELLE : c'est une moyenne de semaines, pas une
 * semaine — retombe sur le mois entier qu'elle résume.
 */
function bornesPeriodeHistogramme(annee, mois) {
  const pad = (n) => String(n).padStart(2, "0");
  if (state.dashboardPeriode.vue === "annee") {
    return { debut: `${annee}-01-01`, fin: `${annee}-12-31` };
  }
  const semaine = semaineChoisie();
  if (semaine && !semaine.moyenne) {
    return {
      debut: `${annee}-${pad(mois)}-${pad(semaine.jour_debut)}`,
      fin: `${annee}-${pad(mois)}-${pad(semaine.jour_fin)}`,
    };
  }
  // `new Date(annee, mois, 0)` : le jour 0 du mois SUIVANT (index JS, 0-11)
  // est le dernier jour du mois demandé — pas d'arithmétique de calendrier à
  // la main (février, années bissextiles...).
  const dernierJour = new Date(annee, mois, 0).getDate();
  return { debut: `${annee}-${pad(mois)}-01`, fin: `${annee}-${pad(mois)}-${pad(dernierJour)}` };
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
  const { annee, mois } = dashboardAnneeMoisActuel;
  if (!annee) return;
  // Peut être vide si l'utilisateur n'a encore ouvert ni Opérations ni
  // Catégories cette session : le dashboard, lui, ne charge pas `state.categories`.
  if (state.categories.length === 0) await refreshCategories();
  const categorie = state.categories.find((c) => c.nom === depense.categorie);
  if (!categorie) return;
  const { debut, fin } = bornesPeriodeHistogramme(annee, mois);

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
    couleur.style.background = couleurCategorie(d.couleur_index ?? i);
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

// Les dernières `depenses` rendues (mois entier, semaine ou moyenne selon ce
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
 * REPLIÉ D'ORIGINE : on regarde un mois neuf fois sur dix. La flèche déplie,
 * recliquer la semaine active rend l'histogramme au mois entier, et replier
 * fait la même chose — on ne peut pas rester coincé dans une semaine.
 *
 * LA BASCULE « MOYENNE » répond à ce qu'une semaine seule laisse ouvert :
 * celle-ci est-elle une semaine ordinaire ? C'est la moyenne des semaines
 * affichées, bouts de mois compris.
 *
 * EN VUE ANNÉE, RIEN : les semaines découpent un mois.
 */

// La réponse de /dashboard/semaines pour la période et la monnaie affichées.
// Relue à chaque changement de l'une ou de l'autre ; gardée pour que basculer
// d'une semaine à l'autre, ou vers la moyenne, ne coûte pas un aller-retour.
let dashboardSemainesDonnees = null;

/** La semaine regardée, ou null quand c'est le mois entier. */
function semaineChoisie() {
  const choix = state.dashboardSemaines.choix;
  if (choix == null || !dashboardSemainesDonnees) return null;
  if (choix === "moyenne") return { moyenne: true };
  return (dashboardSemainesDonnees.semaines || []).find((s) => s.numero === choix) || null;
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
  const depenses =
    semaine === null
      ? depensesDuMois
      : semaine.moyenne
        ? dashboardSemainesDonnees.moyenne || []
        : semaine.depenses || [];

  // LE BUDGET SUIT LA MÊME PÉRIODE QUE LES BARRES, découpe des semaines
  // comprise (cf. soldes.get_budget_total_periode) : une semaine de dépenses
  // rapportée au budget du mois entier aurait annoncé qu'on tient largement
  // son budget toutes les semaines, jusqu'à la dernière.
  const budgetTotal =
    semaine === null
      ? dashboardBudgetTotalDuMois
      : semaine.moyenne
        ? dashboardSemainesDonnees?.budget_total_moyen || 0
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
  if (state.dashboardPeriode.vue === "annee") return t("année {annee}", { annee });
  const semaine = semaineChoisie();
  const nomMois = libelleMois(annee, mois).toLowerCase();
  if (semaine === null) return nomMois;
  if (semaine.moyenne) {
    // LE NOMBRE VIENT DU SERVEUR (`semaines_moyennees`), et non de la longueur
    // de la rangée d'onglets : sur un mois en cours, la moyenne ne porte que
    // sur les semaines RÉVOLUES (cf. soldes._semaines_revolues). Compter les
    // barres affichées aurait annoncé cinq semaines pour une moyenne qui en
    // résume deux — c'est-à-dire exactement l'erreur que ce calcul corrige.
    const n = dashboardSemainesDonnees.semaines_moyennees
      || (dashboardSemainesDonnees.semaines || []).length;
    return t("moyenne des {n} semaines de {mois}", { n, mois: nomMois });
  }
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
 * Dessine la flèche et montre (ou cache) la rangée, d'après le seul
 * `state.dashboardSemaines.ouvert`.
 *
 * UN SEUL ENDROIT qui touche à l'apparence de la flèche : elle change à trois
 * occasions — au chargement de la page, au clic, et quand la vue année la fait
 * disparaître — et trois recopies de la même paire de lignes auraient fini par
 * ne plus dire la même chose.
 */
function majBoutonSemaines() {
  const ouvert = state.dashboardSemaines.ouvert;
  const bouton = document.getElementById("btn-dashboard-semaines");
  bouton.innerHTML = ouvert ? ICONE_CHEVRON_HAUT : ICONE_CHEVRON_BAS;
  bouton.setAttribute("aria-expanded", String(ouvert));
  bouton.title = ouvert ? t("Replier les semaines") : t("Détailler par semaine");
  bouton.setAttribute("aria-label", bouton.title);
  document.getElementById("dashboard-periode-semaines").hidden = !ouvert;
}

/** Replie la rangée et rend l'histogramme au mois entier. */
function replierSemaines() {
  state.dashboardSemaines.ouvert = false;
  state.dashboardSemaines.choix = null;
  majBoutonSemaines();
}

/**
 * Charge (si besoin) les semaines et redessine la rangée. Appelée à chaque
 * chargement du dashboard : c'est elle qui décide si la flèche a lieu d'être,
 * et qui relit les semaines quand le mois ou la monnaie ont changé sous une
 * rangée déjà dépliée.
 */
async function majDetailSemaines(annee, mois) {
  const ligne = document.getElementById("dashboard-periode-semaines-ligne");
  const monnaieId = state.dashboardMonnaieId;

  // Vue année, ou aucune monnaie en jeu (base sans compte) : rien à déplier.
  if (state.dashboardPeriode.vue === "annee" || monnaieId == null) {
    ligne.style.display = "none";
    dashboardSemainesDonnees = null;
    replierSemaines();
    majTitrePeriodeHistogramme(annee, mois);
    return;
  }
  ligne.style.display = "";
  // La flèche est redessinée à chaque chargement : au premier, le bouton du
  // HTML est encore vide.
  majBoutonSemaines();
  if (!state.dashboardSemaines.ouvert) {
    majTitrePeriodeHistogramme(annee, mois);
    return;
  }

  try {
    dashboardSemainesDonnees = await apiFetch(
      `/dashboard/semaines?annee=${annee}&mois=${mois}&monnaie_id=${monnaieId}`
    );
  } catch (err) {
    showMessage(err.message, "error");
    replierSemaines();
    majTitrePeriodeHistogramme(annee, mois);
    return;
  }
  renderRangeeSemaines(annee, mois);
}

/**
 * Les onglets de semaine (plus « Moyenne »), et le graphe du choix courant.
 *
 * L'onglet actif retombe sur le mois entier quand la semaine qu'on regardait
 * n'existe plus : février n'a pas le même nombre de semaines que mars, et
 * passer de l'un à l'autre laissait sinon un onglet actif sans graphe derrière.
 */
function renderRangeeSemaines(annee, mois) {
  const donnees = dashboardSemainesDonnees;
  if (!donnees) return;
  const semaines = donnees.semaines || [];
  const choix = state.dashboardSemaines.choix;
  if (choix !== null && choix !== "moyenne" && !semaines.some((s) => s.numero === choix)) {
    state.dashboardSemaines.choix = null;
  }

  const rangee = document.getElementById("dashboard-periode-semaines");
  rangee.innerHTML = "";
  const boutons = semaines.map((semaine) => ({
    cle: semaine.numero,
    // Les JOURS et non « S1 » : c'est la date qu'on a en tête en cherchant un
    // achat, pas le rang de la semaine dans le mois.
    libelle: `${semaine.jour_debut} → ${semaine.jour_fin}`,
  }));
  boutons.push({ cle: "moyenne", libelle: t("Moyenne") });

  boutons.forEach(({ cle, libelle }) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = libelle;
    if (cle === state.dashboardSemaines.choix) btn.classList.add("active");
    // « Moyenne » est d'une autre nature que les semaines : elle ne montre pas
    // une période mais leur résumé. Une classe la distingue, sans la sortir de
    // la rangée — c'est bien un des choix possibles.
    if (cle === "moyenne") btn.classList.add("semaine-moyenne");
    btn.addEventListener("click", () => {
      // Recliquer le choix actif revient au mois entier : c'est la sortie la
      // plus directe, et elle évite un onglet « Mois » qui ne servirait qu'à ça.
      state.dashboardSemaines.choix =
        state.dashboardSemaines.choix === cle ? null : cle;
      renderRangeeSemaines(annee, mois);
    });
    rangee.appendChild(btn);
  });

  majTitrePeriodeHistogramme(annee, mois);
  renderHistogrammeDashboard(dashboardDepensesDuMois, state.dashboardMonnaieId);
}

document.getElementById("btn-dashboard-semaines").addEventListener("click", async () => {
  const { annee, mois } = state.dashboardPeriode;
  if (state.dashboardSemaines.ouvert) {
    // Replier rend l'histogramme au mois : on ne peut pas rester coincé dans
    // une semaine qu'on ne voit plus.
    replierSemaines();
    majTitrePeriodeHistogramme(annee, mois);
    renderHistogrammeDashboard(dashboardDepensesDuMois, state.dashboardMonnaieId);
    return;
  }
  state.dashboardSemaines.ouvert = true;
  majBoutonSemaines();
  await majDetailSemaines(annee, mois);
});

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
function creerMenuCases(conteneur, { libelle, options, coches, onChange }) {
  conteneur.innerHTML = "";
  conteneur.classList.add("filtre-menu");

  const bouton = document.createElement("button");
  bouton.type = "button";
  bouton.className = "filtre-menu-bouton";
  bouton.textContent = `${libelle} ▾`;
  bouton.setAttribute("aria-haspopup", "true");
  bouton.setAttribute("aria-expanded", "false");

  const panneau = document.createElement("div");
  panneau.className = "filtre-categories-panneau";
  panneau.hidden = true;

  const choisies = new Set(coches);
  options.forEach(({ cle, libelle: texte, verrouillee }) => {
    const ligne = document.createElement("label");
    const caseACocher = document.createElement("input");
    caseACocher.type = "checkbox";
    caseACocher.checked = choisies.has(cle);
    // UNE OPTION VERROUILLÉE RESTE VISIBLE, cochée et inerte. La retirer de la
    // liste aurait laissé croire qu'elle se cache aussi, et fait chercher
    // longtemps la case qui n'existe pas.
    caseACocher.disabled = Boolean(verrouillee);
    caseACocher.addEventListener("change", () => {
      if (caseACocher.checked) choisies.add(cle);
      else choisies.delete(cle);
      onChange(new Set(choisies));
    });
    ligne.appendChild(caseACocher);
    ligne.appendChild(document.createTextNode(texte));
    panneau.appendChild(ligne);
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
function renderCompteMonnaies(selection = []) {
  const bloc = document.getElementById("compte-monnaies");
  bloc.innerHTML = "";
  if (state.monnaies.length === 0) {
    bloc.innerHTML =
      '<span class="hint">Aucune monnaie : crée-en une dans l\'onglet Monnaies.</span>';
    return;
  }
  const parId = Object.fromEntries(selection.map((s) => [s.monnaie_id, s]));
  state.monnaies.forEach((monnaie) => {
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
    const row = document.createElement("div");
    row.className = "import-mapping-row";
    row.dataset.monnaieId = monnaie.id;
    row.innerHTML = `
      <input type="checkbox" data-role="choisie" ${choisie ? "checked" : ""} />
      <span class="import-mapping-nom">${escapeHtml(monnaie.nom)} (${escapeHtml(monnaie.symbole)})</span>
      <input type="number" step="0.01" data-role="solde-initial"
             title="${t("Solde initial dans cette monnaie")}"
             value="${choisie ? entree.solde_initial : 0}" ${choisie ? "" : "disabled"} />
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
    });
    caseActive.addEventListener("change", majEtatActive);
    majEtatActive();
    bloc.appendChild(row);
  });
}

function lireCompteMonnaies() {
  return [...document.querySelectorAll("#compte-monnaies .import-mapping-row")]
    .filter((row) => row.querySelector("input[data-role='choisie']").checked)
    .map((row) => ({
      monnaie_id: Number(row.dataset.monnaieId),
      solde_initial: parseFloat(
        row.querySelector("input[data-role='solde-initial']").value || "0"
      ),
      active: row.querySelector("input[data-role='active']").checked,
    }));
}

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
  document.getElementById("form-compte-titre").textContent = "Ajouter un compte";
  document.getElementById("compte-annuler").style.display = "none";
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
    }))
  );
  document.getElementById("form-compte-titre").textContent = `Modifier "${compte.nom}"`;
  document.getElementById("compte-annuler").style.display = "inline-block";
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
        vide.textContent = "Aucun compte — dépose-en un ici.";
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
    <button type="button" data-action="edit" data-id="${compte.id}">${t("Modifier")}</button>
    <button type="button" data-action="etat" data-id="${compte.id}"
            title="${escapeHtml(
              t(
                "Un compte éteint n'est plus proposé à la saisie ni à l'import. Ses opérations restent en base, et il reparaît sur une période où il portait encore de l'argent."
              )
            )}">${eteint ? t("Rallumer") : t("Éteindre")}</button>
    <button type="button" data-action="delete" data-id="${compte.id}" class="danger">${t("Supprimer")}</button>
  `;
  // Déplaçable par sa poignée seulement : le nom du compte reste copiable.
  rendreDeplacableParPoignee(ligne, ".drag-handle");
  return ligne;
}

function cablerActionsComptes(conteneur) {
  activerEditionDoubleClic(conteneur, (id, ligne) => {
    const compte = state.comptes.find((c) => c.id === id);
    if (compte) fillCompteForm(compte, ligne);
  });

  conteneur.querySelectorAll("button[data-action='edit']").forEach((btn) => {
    btn.addEventListener("click", () => {
      const compte = state.comptes.find((c) => c.id === Number(btn.dataset.id));
      fillCompteForm(compte, btn.closest(".import-mapping-row"));
    });
  });

  conteneur.querySelectorAll("button[data-action='etat']").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const compte = state.comptes.find((c) => c.id === Number(btn.dataset.id));
      if (!compte) return;
      try {
        await apiFetch(`/comptes/${compte.id}/etat`, {
          method: "PUT",
          body: JSON.stringify({ actif: compte.actif === false }),
        });
        showMessage(compte.actif === false ? t("Compte rallumé") : t("Compte éteint"), "success");
        await refreshComptes();
        loadComptes();
      } catch (err) {
        showMessage(err.message, "error");
      }
    });
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
    selecteurLigne: ".import-mapping-row[draggable='true']",
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
        ...groupe.querySelectorAll(".import-mapping-row[draggable='true']"),
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
  document.getElementById("categorie-entree").checked = false;
  document.getElementById("form-categorie-titre").textContent = "Ajouter une catégorie";
  document.getElementById("categorie-annuler").style.display = "none";
}

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
  document.getElementById("categorie-entree-bloc").style.display = "";
  document.getElementById("categorie-entree").checked = !!categorie.est_entree;
  document.getElementById("form-categorie-titre").textContent = `Modifier "${categorie.nom}"`;
  document.getElementById("categorie-annuler").style.display = "inline-block";
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
    const protegee = estAutres || c.nom === CATEGORIE_ENTREES_ARGENT;
    const deleteAction = protegee
      ? ""
      : `<button data-action="delete" data-id="${c.id}" class="danger">${t("Supprimer")}</button>`;
    const etatAction = estAutres
      ? ""
      : `<button data-action="etat" data-id="${c.id}" title="${escapeHtml(
          t(
            "Une catégorie éteinte n'est plus proposée à la saisie, ni par les règles d'import, ni sur la page Budget. Ses opérations restent en base et gardent leur barre sur les périodes où elles tombent."
          )
        )}">${eteinte ? t("Rallumer") : t("Éteindre")}</button>`;
    tr.innerHTML = `
      <td class="drag-handle" title="${t("Glisser pour réordonner")}">⠿</td>
      <td>${escapeHtml(libelleCategorie(c.nom))}${
        // UNE PASTILLE ET PAS UNE COLONNE : une colonne « Entrée ? » aurait
        // écrit vingt fois « non » pour dire une fois « oui ». Ce qui se voit
        // doit être ce qui a été décidé — même règle que la colonne d'objectifs
        // d'avant, vide plutôt que remplie de zéros.
        c.est_entree ? `<span class="badge-aucun">${t("entrée")}</span>` : ""
      }</td>
      <td>
        <button data-action="edit" data-id="${c.id}">${t("Modifier")}</button>
        ${etatAction}
        ${deleteAction}
      </td>
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
      editerCategorie(Number(btn.dataset.id), btn.closest("tr"))
    );
  });

  body.querySelectorAll("button[data-action='etat']").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const categorie = state.categories.find((c) => c.id === Number(btn.dataset.id));
      if (!categorie) return;
      try {
        await apiFetch(`/categories/${categorie.id}/etat`, {
          method: "PUT",
          body: JSON.stringify({ active: categorie.active === false }),
        });
        showMessage(
          categorie.active === false ? t("Catégorie rallumée") : t("Catégorie éteinte"),
          "success"
        );
        loadCategories();
      } catch (err) {
        showMessage(err.message, "error");
      }
    });
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
  body.querySelectorAll("tr[draggable='true']").forEach((tr) => {
    tr.addEventListener("dragstart", () => {
      tr.classList.add("dragging");
    });

    tr.addEventListener("dragend", async () => {
      tr.classList.remove("dragging");
      const nouvelOrdre = [...body.querySelectorAll("tr[draggable='true']")].map((r) =>
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

/** Même règle pour les catégories (cf. models.Categorie.active). */
function categoriesEligibles(type, conserve = null) {
  if (!TYPES_CATEGORIE_LIBRE.has(type)) return [];
  return state.categories.filter((c) => c.active !== false || c.id === conserve);
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
    (m) => m.active !== false || m.monnaie_id === monnaieConservee
  );
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
  if (monnaies.some((m) => m.monnaie_id === precedente)) {
    select.value = precedente;
  }
  document.getElementById(blocId).style.display =
    forcerAffichage || monnaies.length > 1 ? "" : "none";
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
  const statut = document.getElementById("operation-statut").value;
  const recurrente = document.getElementById("operation-recurrente").checked;
  return statut === "prévisionnel" || recurrente;
}

function majBlocRapprochement() {
  const bloc = document.getElementById("operation-rapprochement-bloc");
  if (!bloc) return;
  assurerEditeurRapprochement();
  const proposable = rapprochementEstProposable();
  bloc.style.display = proposable ? "" : "none";
  const actif = document.getElementById("operation-rapprochement-actif");
  // Décochée dès qu'elle cesse d'être proposée : une case cochée mais invisible
  // continuerait d'envoyer une fenêtre sur une opération qui n'attend plus rien.
  if (!proposable) actif.checked = false;
  document.getElementById("operation-rapprochement-champs").style.display =
    proposable && actif.checked ? "" : "none";
}

/** La fenêtre et les mots-clés, prêts à partir au serveur.
 *
 *  CASE DÉCOCHÉE = ON EFFACE, et non « on ne touche à rien » : décocher est un
 *  geste, et il doit défaire ce que cocher avait fait. D'où des `null` et une
 *  liste vide explicites plutôt qu'une clé absente. */
function lireRapprochementFormulaire() {
  const actif =
    rapprochementEstProposable() &&
    document.getElementById("operation-rapprochement-actif").checked;
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
  const actif = Boolean(op && (op.rapprochement_debut || op.rapprochement_fin));
  document.getElementById("operation-rapprochement-actif").checked =
    actif || Boolean(op && (op.rapprochement_mots_cles || []).length);
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
    vide: "Aucun mot-clé : le compte, le montant et la date suffisent à reconnaître la dépense.",
  });
  document
    .getElementById("operation-rapprochement-actif")
    .addEventListener("change", majBlocRapprochement);
  // La visibilité du bloc dépend du STATUT et de la RÉCURRENCE : les deux
  // peuvent changer sans passer par updateOperationTypeFields.
  document.getElementById("operation-statut").addEventListener("change", majBlocRapprochement);
}

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
  if (!estDecoupable) document.getElementById("operation-decoupee").checked = false;
  const decoupee = decoupeEstActive();
  document.getElementById("operation-decoupee-bloc").style.display = estDecoupable ? "" : "none";
  document.getElementById("operation-decoupe-bloc").style.display = decoupee ? "" : "none";
  document.getElementById("operation-categorie-bloc").style.display =
    TYPES_CATEGORIE_LIBRE.has(type) && !decoupee ? "" : "none";
  document.getElementById("operation-statut-bloc").style.display =
    estReglement || estPret ? "none" : "";

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
  if (!estRecurrenceEligible) {
    recurrenteBloc.style.display = "none";
    recurrenceChampsBloc.style.display = "none";
    recurrenceInfo.style.display = "none";
  } else if (operationEditionEstOccurrenceGeneree) {
    recurrenteBloc.style.display = "none";
    recurrenceChampsBloc.style.display = "none";
    recurrenceInfo.style.display = "";
  } else {
    // Masquée tant que l'opération est amortie : les deux s'excluent (cf.
    // le bloc d'amortissement juste en dessous).
    recurrenteBloc.style.display = estAmortie ? "none" : "";
    recurrenceInfo.style.display = "none";
    recurrenceChampsBloc.style.display = estRecurrente ? "" : "none";
  }

  // Amortissement : même éligibilité que la récurrence -- un virement ne pèse
  // sur aucun total de période (il déplace de l'argent entre mes comptes), et
  // un règlement solde une dette précise, à sa date. Exclusif de la récurrence,
  // qui recopierait les mêmes mois de destination sur chaque occurrence (le
  // serveur refuse d'ailleurs la combinaison, cf. schemas.OperationBase) : les
  // deux cases ne s'affichent donc jamais cochables en même temps.
  const estAmortissementEligible =
    estRecurrenceEligible && !operationEditionEstOccurrenceGeneree && !estRecurrente;
  // Décochée dès qu'elle cesse d'être proposée : une case cochée mais invisible
  // continuerait d'être envoyée au serveur, qui refuserait une combinaison que
  // l'écran ne montre plus (récurrente ET amortie, par exemple).
  if (!estAmortissementEligible) document.getElementById("operation-amorti").checked = false;
  document.getElementById("operation-amorti-bloc").style.display = estAmortissementEligible
    ? ""
    : "none";
  document.getElementById("operation-amortissement-champs-bloc").style.display =
    estAmortissementEligible && estAmortie ? "" : "none";

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
  document.getElementById("operation-remboursements-bloc").style.display = estReglement ? "" : "none";
  document.getElementById("operation-remboursements-titre").textContent = estRemboursementPret
    ? "Prêts réglés"
    : "Opérations remboursées";

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
  if (estVirement) {
    _refillPreservingSelection(document.getElementById("operation-compte1"), (el) =>
      fillComptesSelect(el, comptesEligibles(type, valeurDe(el)))
    );
    _refillPreservingSelection(document.getElementById("operation-compte2"), (el) =>
      fillComptesSelect(el, comptesEligibles(type, valeurDe(el)))
    );
  } else {
    _refillPreservingSelection(document.getElementById("operation-compte"), (el) =>
      fillComptesSelect(el, comptesEligibles(type, valeurDe(el)))
    );
    if (TYPES_CATEGORIE_LIBRE.has(type)) {
      _refillPreservingSelection(document.getElementById("operation-categorie"), (el) =>
        fillCategoriesSelect(el, categoriesEligibles(type, valeurDe(el)))
      );
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
    document.getElementById("operation-montant-label").textContent = "Montant";
    document.getElementById("operation-montant-recu-bloc").style.display = "none";
    document.getElementById("operation-monnaie-recue-bloc").style.display = "none";
    document.getElementById("operation-monnaie-label").textContent = "Monnaie";
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

  const memeMonnaie = monnaieSource === monnaieDestination;
  document.getElementById("operation-monnaie-label").textContent = "Monnaie envoyée";
  document.getElementById("operation-montant-label").textContent = memeMonnaie
    ? "Montant"
    : "Montant envoyé";
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

document.querySelectorAll("#operation-type-boutons button").forEach((btn) => {
  btn.addEventListener("click", () => setOperationType(btn.dataset.type));
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
  fillCategoriesSelect(select, categoriesEligibles(TYPE_DECOUPABLE, categorieId));
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
    ajouterPartDecoupe();
    ajouterPartDecoupe();
  }
  updateOperationTypeFields();
});

document
  .getElementById("operation-decoupe-ajouter")
  .addEventListener("click", () => ajouterPartDecoupe());

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
      "Montant reçu" + (actif && operationFrais.cote === "recu" ? suffixe : "");
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
  document.getElementById("form-operation-titre").textContent = "Ajouter une opération";
  document.getElementById("operation-annuler").style.display = "none";
  montantDuAutoSync = true;
  operationEditionEstOccurrenceGeneree = false;
  operationEditionTypeOriginal = null;
  virementEnEdition = null;
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
  setOperationType("classique");
}

async function fillOperationForm(op) {
  // Le type est porte par l'operation (OperationRead.type_code) : plus aucune
  // deduction depuis la categorie et le booleen `remboursable`.
  const type = op.type_code;

  document.getElementById("operation-id").value = op.id;
  montantDuAutoSync = false;
  operationEditionEstOccurrenceGeneree = op.recurrence_parent_id != null;
  operationEditionTypeOriginal = type;
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
  }
  document.getElementById("operation-nature").value = op.nature;
  document.getElementById("operation-montant").value = op.montant;
  // Après le montant : le compteur du garde-fou compare les parts à LUI.
  majTotalDecoupe();
  document.getElementById("operation-statut").value = op.statut;
  document.getElementById("operation-imprevue").checked = !!op.imprevue;
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
  // Dès qu'un remboursement est lié, les trois montants de la dette sont
  // figés côté serveur (les liens ont été validés contre le montant_du de
  // l'époque, et rien ne les revalide) : on grise plutôt que de laisser
  // saisir une valeur qui sera refusée en 400.
  resteField.disabled = estLie;
  document.getElementById("operation-montant").disabled = estLie;
  document.getElementById("operation-montant-du").disabled = estLie;
  if (TYPES_REMBOURSABLES.has(type) && estLie) {
    const details = op.rembourse_par
      .map((r) => `"${r.nature}" (${formatMontant(r.montant_lien, op.monnaie_id)})`)
      .join(", ");
    infoDiv.textContent = `Remboursé via : ${details}. Les montants sont figés tant que ce lien existe — pour les modifier, délie d'abord l'opération de remboursement correspondante.`;
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
  document.getElementById("operation-statut").value = sortante.statut;
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

  document.getElementById("form-operation-titre").textContent = "Modifier le virement";
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

// En-têtes par onglet. La date n'y figure plus : elle est portée par le
// regroupement par jour (un tableau par journée), pas par une colonne répétée
// à l'identique sur toutes les lignes du même jour.
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

  const colonnes = COLONNES_OPERATIONS[ongletDeListe(listeId)] || [];
  const table = document.createElement("table");
  // Chaque JOURNÉE y forme un bloc arrondi distinct, au lieu d'un seul cadre
  // continu pour tout le tableau (cf. .table-operations dans style.css).
  table.className = "table-operations";
  // Les en-têtes vivent en français dans COLONNES_OPERATIONS (lisible en
  // regard du reste du fichier) et se traduisent au rendu.
  table.innerHTML = `<thead><tr>${colonnes
    .map((c) => `<th>${t(c)}</th>`)
    .join("")}</tr></thead>`;

  grouperParJour(liste).forEach((operations, jour) => {
    const body = document.createElement("tbody");
    body.className = "jour-groupe";
    body.appendChild(ligneSeparatriceJour(jour, colonnes.length));
    operations.forEach((op) => body.appendChild(construireLigne(op)));
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
  const date = document.createElement("span");
  date.className = "jour-separateur-date";
  date.textContent = libelleJour(jour);
  const trait = document.createElement("span");
  trait.className = "jour-separateur-trait";
  contenu.appendChild(date);
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
  const nbColonnes = COLONNES_OPERATIONS.classique.length;
  const construireLigne = (op) => {
    const tr = document.createElement("tr");
    if (op.decoupes && op.decoupes.length > 0) tr.classList.add("operation-decoupee");
    tr.innerHTML = `
      <td>${celluleNature(op)}</td>
      <td>${montantHtml(op.montant, op.sens, op.monnaie_id)}</td>
      <td>${nomCompte(op.compte_id)}</td>
      <td>${celluleCategorieOperation(op)}</td>
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
  const nbColonnes = COLONNES_OPERATIONS.remboursable.length;
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
  const nbColonnes = COLONNES_OPERATIONS.remboursements.length;
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

    const colonnes = COLONNES_OPERATIONS.virements;
    const table = document.createElement("table");
    // Même bloc arrondi par journée que les autres onglets.
    table.className = "table-operations";
    // Les en-têtes vivent en français dans COLONNES_OPERATIONS (lisible en
  // regard du reste du fichier) et se traduisent au rendu.
  table.innerHTML = `<thead><tr>${colonnes
    .map((c) => `<th>${t(c)}</th>`)
    .join("")}</tr></thead>`;

    grouperParJour(utilisables, ([, { sortante, entrante }]) => (sortante || entrante).date).forEach(
      (pairesDuJour, jour) => {
        const body = document.createElement("tbody");
        body.className = "jour-groupe";
        body.appendChild(ligneSeparatriceJour(jour, colonnes.length));
        pairesDuJour.forEach((paire) => {
          const tr = construireLigne(paire);
          if (tr) {
            // La paire est retenue sur la ligne : l'édition a besoin des deux
            // écritures, que la seule lecture du DOM ne donnerait pas.
            tr._paireVirement = paire;
            body.appendChild(tr);
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
      }
    );

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
          ? "Supprimer cette opération ?"
          : "Supprimer ce virement ? Les deux lignes liées (sortante et entrante) seront supprimées.";
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
  const nbColonnes = COLONNES_OPERATIONS.prets.length;
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
  const nbColonnes = COLONNES_OPERATIONS["remboursement-prets"].length;
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

function comparateurOperation(critere) {
  const [champ, sens] = critere.split("-");
  const direction = sens === "asc" ? 1 : -1;
  const valeur = (op) => {
    switch (champ) {
      case "nature":
        return (op.nature || "").toLowerCase();
      case "montant":
        return op.montant;
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
// que le mois choisi, "annee" toute l'année (les flèches du sélecteur montent et
// descendent d'un cran, cf. renderFlechesPeriode). L'autre niveau n'est jamais
// oublié — on reste dans un mois DE cette année — il est seulement grisé.
//
// « TOUT » EST LE TROISIÈME CRAN, et il n'existe que sur cette page : plus
// aucune borne de date, toutes les opérations de la base. Il a été ajouté avec
// la bascule automatique de période (cf. periodeQueDecritLeFiltre) parce qu'il
// FALLAIT une réponse au cas où le filtre ne tombe ni dans un mois ni dans une
// année — un filtre « depuis mars 2024 » ne se range nulle part dans
// l'arborescence, et le laisser sur le mois en cours aurait rendu un tableau
// vide qui ne dit pas pourquoi. Le dashboard, lui, ne le connaît pas : sa vue
// voyage jusqu'au serveur, où elle vaut "mois" ou "annee" et rien d'autre.
const operationsPeriode = { annee: null, mois: null, vue: "mois" };

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

function operationCorrespondFiltres(op, onglet, f) {
  if (!correspondTexte(f.nature, op.nature)) return false;
  if (!correspondDate(f.dateDebut, f.dateFin, op.date)) return false;
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
      if (f.categorieId && String(op.categorie_id) !== f.categorieId) return false;
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
    liste = operationsParOnglet[onglet]
      .filter(operationDansPeriode)
      .filter((op) => operationCorrespondFiltres(op, onglet, filtres));
    liste.sort(comparateurOperation(critere));
  }
  RENDER_PAR_ONGLET[onglet](liste);
}

// Un sélecteur de période par onglet (ils doivent vivre dans l'onglet de
// type), mais tous pilotent le même état : changer de mois dans un onglet le
// change partout, sinon revenir sur un onglet afficherait un autre mois.
//
// Implémentation dédiée plutôt que initPeriodeSelector : celui-ci gère un
// couple d'éléments unique et déclenche onSelect à l'initialisation, ce qui
// provoquerait ici six rendus en cascade et laisserait les cinq autres
// sélecteurs désynchronisés au changement d'année.
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
  const annees = anneesOngletsOperations();
  const moisDispo = moisOngletsOperations(operationsPeriode.annee);

  Object.keys(COLONNES_OPERATIONS).forEach((onglet) => {
    const elAnnees = document.getElementById(`operations-periode-annees-${onglet}`);
    const elMois = document.getElementById(`operations-periode-mois-${onglet}`);
    const elFleches = document.getElementById(`operations-periode-fleches-${onglet}`);
    if (!elAnnees || !elMois) return;

    // Les six sélecteurs pilotent le même état : la vue change partout à la
    // fois, comme le mois et l'année.
    renderFlechesPeriode(elFleches, operationsPeriode.vue, (vue) => {
      if (vue === operationsPeriode.vue) return;
      operationsPeriode.vue = vue;
      appliquerPeriodeOperations();
    });
    appliquerVeillePeriode(elAnnees, elMois, operationsPeriode.vue);

    elAnnees.innerHTML = "";
    // « TOUT » EN TÊTE DE LA RANGÉE DES ANNÉES, et non une troisième flèche :
    // ce n'est pas un cran de plus dans l'arborescence des dates, c'est le
    // choix de n'en prendre aucune. Un onglet le dit ; une flèche l'aurait
    // rangé dans la même file que « l'année » et « le mois », dont il n'est pas
    // le voisin. Les deux flèches restent actives à côté et redescendent dans
    // l'année affichée — c'est par elles, ou par un onglet, qu'on en sort.
    const btnTout = document.createElement("button");
    btnTout.type = "button";
    btnTout.className = "periode-tout";
    btnTout.textContent = t("Tout");
    btnTout.title = t("Toutes les périodes, sans borne de date");
    if (operationsPeriode.vue === "tout") btnTout.classList.add("active");
    btnTout.addEventListener("click", () => {
      if (operationsPeriode.vue === "tout") return;
      operationsPeriode.vue = "tout";
      appliquerPeriodeOperations();
    });
    elAnnees.appendChild(btnTout);

    annees.forEach((a) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = a;
      if (a === operationsPeriode.annee && operationsPeriode.vue !== "tout") {
        btn.classList.add("active");
      }
      btn.addEventListener("click", () => {
        operationsPeriode.annee = a;
        const dispo = moisDisponiblesOperations(a);
        if (!dispo.includes(operationsPeriode.mois)) {
          operationsPeriode.mois = dispo[dispo.length - 1] ?? operationsPeriode.mois;
        }
        // Cliquer une année quand on regardait TOUT redescend à cette année :
        // même geste que cliquer un mois grisé, et pour la même raison — on
        // désigne ce qu'on veut voir, pas un niveau d'arborescence.
        if (operationsPeriode.vue === "tout") operationsPeriode.vue = "annee";
        appliquerPeriodeOperations();
      });
      elAnnees.appendChild(btn);
    });

    elMois.innerHTML = "";
    moisDispo.forEach((m) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = MOIS_COURTS_FR[m - 1];
      // Allumé même en vue année, où la rangée dort : on reste dans un mois DE
      // cette année, et l'oublier ferait perdre le fil en redescendant. En vue
      // « tout », en revanche, plus rien n'est allumé nulle part — c'est ce qui
      // distingue « toute l'année 2026 » de « toutes les périodes ».
      if (m === operationsPeriode.mois && operationsPeriode.vue !== "tout") {
        btn.classList.add("active");
      }
      btn.addEventListener("click", () => {
        operationsPeriode.mois = m;
        // Cliquer un mois grisé (vue année ou « tout ») redescend au mois :
        // c'est le geste naturel pour désigner celui qu'on veut voir.
        operationsPeriode.vue = "mois";
        appliquerPeriodeOperations();
      });
      elMois.appendChild(btn);
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
    // page Placements financiers.
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
        statut: document.getElementById("operation-statut").value,
        ...champNotes,
      };
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
      if (id) {
        await apiFetch(`/operations/${id}`, { method: "PUT", body: JSON.stringify(payload) });
        showMessage(t("Opération modifiée"), "success");
      } else {
        await apiFetch("/operations", { method: "POST", body: JSON.stringify(payload) });
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
      if (id) {
        await apiFetch(`/operations/${id}`, { method: "PUT", body: JSON.stringify(payload) });
        showMessage(t("Prêt modifié"), "success");
      } else {
        await apiFetch("/operations", { method: "POST", body: JSON.stringify(payload) });
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
        statut: document.getElementById("operation-statut").value,
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
      if (id) {
        await apiFetch(`/operations/${id}`, { method: "PUT", body: JSON.stringify(payload) });
        showMessage(t("Opération modifiée"), "success");
      } else {
        await apiFetch("/operations", { method: "POST", body: JSON.stringify(payload) });
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
    document.getElementById("form-operation-titre").textContent = "Nouvelle opération";
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
function gererChangementFiltreOperations(e) {
  const panneau = e.target.closest(".filtres[id^='filtres-']");
  if (!panneau) return;
  const onglet = panneau.id.slice("filtres-".length);
  // SEULES LES DEUX DATES DÉPLACENT LA PÉRIODE (cf. synchroniserPeriodeAvecFiltres).
  // Le faire à chaque champ aurait renvoyé au mois courant dès qu'on tape trois
  // lettres dans « Nature », en défaisant l'onglet choisi à la main juste avant.
  const champDate = ["dateDebut", "dateFin"].includes(e.target.dataset.filtre);
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
      });
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
// Trace du dernier import confirmé (ImportHistorique.id), le temps d'y
// rattacher les règlements liés — seules opérations d'un import à naître
// APRÈS lui, une par une (cf. enregistrerLigneBruteImportee). Sans ce
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
// détectés y sont pré-inscrits à chaque analyse : une sélection non vide
// bloque la confirmation, ce qui force à trancher sur chaque doublon --
// le supprimer, ou le décocher pour l'importer volontairement.
const importLignesSelectionnees = new Set();
// Modifications manuelles ligne par ligne (bouton "Modifier" de l'aperçu),
// envoyées telles quelles à la confirmation : numéro de ligne -> champs
// modifiés (date/nature/montant/categorie_id/compte_id).
const importLigneOverrides = {};
// Numéros de ligne retirées de l'import (bouton "Supprimer" de l'aperçu).
const importLignesSupprimees = new Set();
// Numéro de ligne actuellement en édition inline dans l'aperçu (une seule à
// la fois), ou null si aucune.
let ligneApercuEnEdition = null;
// Toutes les colonnes du preset, de base ET avancées : c'est une seule liste
// côté serveur (ImportPreset.colonnes). Seul l'affichage les sépare, selon le
// groupe auquel leur propriété appartient.
let importConfigColonnes = []; // [{index, propriete}]
// [index, ...] -- les colonnes que la détection de doublons regarde. Ce que la
// liste désigne dépend du mode : les colonnes à ignorer ("exclusion", défaut)
// ou les seules à comparer ("selection"). Cf. constants.ModeComparaison.
let importConfigColonnesComparaison = [];
// Signature de la configuration telle qu'ENREGISTRÉE (cf. signatureApercu),
// pour savoir, à l'enregistrement suivant, si l'aperçu du fichier chargé a
// cessé d'être à jour — et donc s'il faut le refaire.
let importSignatureApercuEnregistree = null;

// Ce que tout relevé porte : c'est la « Configuration du fichier ». Les clés
// sont celles de constants.PROPRIETES_IMPORT_BASE.
const PROPRIETES_IMPORT = [
  ["date", "Date"],
  ["nature", "Nature"],
  ["categorie_banque", "Catégorie bancaire"],
  ["montant", "Montant"],
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

/**
 * Déclare au serveur qu'une ligne du fichier en cours a créé une opération,
 * pour que le prochain import du même relevé la voie comme un doublon.
 *
 * N'a lieu d'être que pour les règlements liés, créés un par un via
 * POST /operations : tout le reste passe par `confirmer`, qui alimente le stock
 * lui-même (cf. services.import_bancaire.enregistrer_ligne_brute).
 *
 * Ne fait jamais échouer l'appelant : l'opération est déjà créée et liée quand
 * on arrive ici. Une trace anti-doublon manquante se paie d'un doublon à
 * signaler en moins au prochain import — remonter l'erreur ferait croire que la
 * création a raté, ce qui est faux, et pousserait à la refaire.
 */
async function enregistrerLigneBruteImportee(numeroLigne, operationId) {
  if (!importFichierActuel || importPresetId == null || operationId == null) return;
  const formData = new FormData();
  formData.append("fichier", importFichierActuel);
  formData.append("ligne", numeroLigne);
  formData.append("operation_id", operationId);
  // Même délimiteur qu'à l'aperçu : sinon la ligne relue ici ne tombe plus en
  // face du bon numéro (cf. services/import_bancaire.enregistrer_ligne_brute).
  if (importReglageDelimiteur) formData.append("delimiteur", importReglageDelimiteur);
  // Rattache le règlement à l'import dont il sort : sans ça, lui seul
  // survivrait à l'annulation de son propre import (cf. annulerImport).
  if (importDernierHistoriqueId != null) {
    formData.append("import_historique_id", importDernierHistoriqueId);
  }
  try {
    await apiFetchForm(importUrl("/lignes-brutes"), formData);
  } catch (err) {
    console.warn("Ligne non enregistrée au stock anti-doublons :", err.message);
  }
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
    btn.classList.toggle("active", p.id === importPresetId);
    btn.addEventListener("click", async () => {
      if (p.id === importPresetId) return;
      importPresetId = p.id;
      memoriserPresetActuel();
      renderImportPresetChips();
      await chargerDonneesPresetActuel();
    });
    bloc.appendChild(btn);
  });
}

// Le preset sélectionné est mémorisé localement : sans ça, l'app repartait à
// chaque rechargement sur le premier preset par ordre alphabétique, donnant
// l'impression que les correspondances mémorisées et l'historique avaient
// disparu alors qu'ils appartenaient simplement à un autre preset.
const CLE_PRESET_MEMORISE = "budget-app.import.preset";

async function loadImportPresets() {
  importPresets = await apiFetch("/import/presets");
  if (!importPresets.some((p) => p.id === importPresetId)) {
    const memorise = Number(localStorage.getItem(CLE_PRESET_MEMORISE));
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

function memoriserPresetActuel() {
  if (importPresetId != null) localStorage.setItem(CLE_PRESET_MEMORISE, String(importPresetId));
  else localStorage.removeItem(CLE_PRESET_MEMORISE);
}

document.getElementById("btn-import-preset-creer").addEventListener("click", async () => {
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
  importLignesSelectionnees.clear();
  Object.keys(importLigneOverrides).forEach((k) => delete importLigneOverrides[k]);
  importLignesSupprimees.clear();
  // Les refus de rapprochement appartiennent au fichier qu'on quitte : les
  // garder ferait refuser, sur le fichier suivant, des lignes qui portent le
  // même numéro sans rien avoir de commun.
  importRapprochementsRefuses.clear();
  ligneApercuEnEdition = null;
  document.getElementById("import-fichier").value = "";
  document.getElementById("import-fichier-nom").textContent = "";
  document.getElementById("import-mappings-bloc").style.display = "none";
  document.getElementById("import-apercu-bloc").style.display = "none";
  document.getElementById("import-apercu-fichier-bloc").style.display = "none";
  document.getElementById("import-avertissements").style.display = "none";
  document.getElementById("import-monnaies-resolues-bloc").style.display = "none";
  document.getElementById("import-previsionnelles-bloc").style.display = "none";
  reinitialiserReglagesLecture();
  importDernierHistoriqueId = null;
  // La veille repart de zéro : sans ça, la signature du fichier précédent
  // ferait passer le suivant pour « déjà comparé ».
  veilleDoublonsSignature = null;
  renderVeilleDoublonsVirements([]);
}

// Point de passage unique du choix de fichier (bouton et glisser-déposer) :
// l'analyse démarre directement, il n'y a plus de bouton "Analyser" à cliquer.
function definirFichierImport(fichier) {
  importFichierActuel = fichier || null;
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
  const details = document.getElementById("import-reglages-lecture");
  details.open = false;
  document.getElementById("import-reglages-lecture-alerte").style.display = "none";
  document.getElementById("import-reglages-lecture-resume").textContent = "";
  document.getElementById("import-reglage-delimiteur").value = "";
  document.getElementById("import-reglage-separateur-decimal").value = "";
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

document.getElementById("btn-import-relire-reglages").addEventListener("click", async () => {
  importReglageDelimiteur = delimiteurChoisi();
  importReglageSeparateurDecimal = separateurDecimalChoisi();
  await relireFichierImport();
});

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
  resume.textContent = resumeMorceaux.length ? `— ${resumeMorceaux.join(", ")}` : "";

  if (detecterProblemeLecture(lignes)) {
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
  const champ = document.getElementById("import-lignes-entete");
  const valeur = Math.floor(Number(champ?.value));
  if (!Number.isFinite(valeur) || valeur <= 0) return 0;
  return Math.min(valeur, Number(champ.max) || valeur);
}

function signatureApercu(config) {
  return JSON.stringify({
    colonnes: config.colonnes,
    colonnes_comparaison: config.colonnes_comparaison || [],
    mode_comparaison: config.mode_comparaison,
    lignes_entete: lignesEnteteDe(config),
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
  importConfigColonnes = config.colonnes.map((c) => ({ ...c }));
  importConfigColonnesComparaison = [...(config.colonnes_comparaison || [])];
  document.getElementById("import-mode-comparaison").value = config.mode_comparaison;
  document.getElementById("import-lignes-entete").value = lignesEnteteDe(config);
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
 * Une ligne de configuration : la propriété, son numéro de colonne, et l'œil
 * qui l'active ou l'éteint.
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
    <span class="import-config-propriete">${escapeHtml(t(libelle))}${bulle}</span>
    <label class="import-config-index">${t("Colonne n°")}
      <input type="number" min="1" value="${index}" ${actif ? "" : "disabled"} />
    </label>
    <button type="button" class="import-config-oeil" data-action="basculer"
            title="${
              obligatoire
                ? t("Cette propriété est obligatoire : elle ne peut pas être désactivée.")
                : actif
                  ? t("Ne plus lire cette colonne")
                  : t("Lire cette colonne")
            }"
            aria-label="${actif ? "Désactiver" : "Activer"} ${escapeHtml(libelle)}"
            ${obligatoire ? "disabled" : ""}>${actif ? ICONE_OEIL : ICONE_OEIL_BARRE}</button>
  `;

  row.querySelector("input").addEventListener("input", (e) => {
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
  row.querySelector("input").addEventListener("change", () => {
    if (colonne) renderApercuFichier();
  });

  row.querySelector("button[data-action='basculer']").addEventListener("click", () => {
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
    ["import-config-colonnes-avancees", PROPRIETES_IMPORT_AVANCEES],
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

  updateResumeConfigAvancee();
  updateResumeConfigFichier();
  updateImportSensLibellesVisibilite();
  updateImportStatutLibellesVisibilite();
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
  const nbComparaison = importConfigColonnesComparaison.length;
  const doublons =
    modeComparaisonChoisi() === "selection"
      ? t("doublons : {n} colonne(s) comparée(s)", { n: nbComparaison })
      : nbComparaison === 0
        ? t("doublons : toutes les colonnes")
        : t("doublons : toutes sauf {n}", { n: nbComparaison });
  document.getElementById("import-config-fichier-resume").textContent =
    `${t("{n} colonne(s) lue(s)", { n: nbColonnes })} · ${doublons}`;
}

/* ----- Configuration avancée ----- */

// Résumé affiché à côté du titre replié : sans lui, une configuration avancée
// active serait invisible tant qu'on n'ouvre pas la section — et des frais
// ajoutés au montant sont bien trop surprenants pour rester cachés.
function updateResumeConfigAvancee() {
  const avancees = importConfigColonnes.filter((c) => estProprieteAvancee(c.propriete));
  document.getElementById("import-config-avancee-resume").textContent =
    avancees.length > 0 ? `${avancees.length} colonne(s)` : "inactive";
}

function modeComparaisonChoisi() {
  return document.getElementById("import-mode-comparaison").value;
}

/**
 * La liste des colonnes de la comparaison, et surtout ce que veut dire une
 * liste VIDE — qui n'est pas la même chose des deux côtés :
 *
 * - en exclusion, elle est parfaitement valide : tout est comparé ;
 * - en sélection, elle ne comparerait rien, donc chaque ligne serait le
 *   doublon de la première déjà importée. Le serveur refuse d'enregistrer ça
 *   (cf. _valider_configuration) ; on le dit ici avant d'y arriver.
 */
function renderImportConfigColonnesComparaison() {
  const bloc = document.getElementById("import-config-colonnes-exclues");
  const selection = modeComparaisonChoisi() === "selection";
  updateResumeConfigFichier();
  bloc.innerHTML = "";
  if (importConfigColonnesComparaison.length === 0) {
    bloc.innerHTML = selection
      ? '<p class="hint erreur-hint">Aucune colonne choisie : ajoute-en au moins une, sinon plus rien ne distingue deux lignes.</p>'
      : `<p class="hint">${t("Aucune colonne exclue : toutes les colonnes du fichier sont comparées.")}</p>`;
    return;
  }
  importConfigColonnesComparaison.forEach((index, i) => {
    const row = document.createElement("div");
    row.className = "import-mapping-row";
    row.innerHTML = `
      <label class="import-config-index">Colonne n°
        <input type="number" min="1" value="${index}" />
      </label>
      <button type="button" class="danger" data-action="supprimer-exclusion">${t("Supprimer")}</button>
    `;
    row.querySelector("input").addEventListener("input", (e) => {
      importConfigColonnesComparaison[i] = Number(e.target.value) || 0;
    });
    row.querySelector("button[data-action='supprimer-exclusion']").addEventListener("click", () => {
      importConfigColonnesComparaison.splice(i, 1);
      renderImportConfigColonnesComparaison();
    });
    bloc.appendChild(row);
  });
}

document.getElementById("btn-import-config-exclusion-ajouter").addEventListener("click", () => {
  // En sélection, la première colonne proposée est celle de la date : c'est le
  // point de départ naturel (date + libellé + montant identifient une ligne).
  // En exclusion, ce sont au contraire les colonnes NON lues qui posent
  // problème — d'où la première non utilisée.
  const indexMax = importConfigColonnes.reduce((max, c) => Math.max(max, c.index), 0);
  const premiereLue = importConfigColonnes.reduce(
    (min, c) => Math.min(min, c.index),
    Number.MAX_SAFE_INTEGER
  );
  importConfigColonnesComparaison.push(
    modeComparaisonChoisi() === "selection" ? premiereLue : indexMax + 1
  );
  renderImportConfigColonnesComparaison();
});

// Changer de mode retourne le sens de la liste déjà saisie : la vider évite
// qu'un « sauf la colonne 12 » devienne en un clic un « uniquement la colonne
// 12 », qui dit exactement le contraire.
document.getElementById("import-mode-comparaison").addEventListener("change", () => {
  importConfigColonnesComparaison = [];
  renderImportConfigColonnesComparaison();
});

document.getElementById("btn-import-config-enregistrer").addEventListener("click", async () => {
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
    return;
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
        colonnes_comparaison: importConfigColonnesComparaison,
        mode_comparaison: modeComparaisonChoisi(),
        lignes_entete: lignesEnteteSaisies(),
        ...vocabulairesSaisis(),
      }),
    });
    // L'aperçu affiché décrit-il encore ce que l'import fera ? Comparé AVANT
    // d'écraser la signature de référence — c'est ce qui décide de relire le
    // fichier plus bas.
    const apercuPerime = signatureApercu(config) !== importSignatureApercuEnregistree;
    importSignatureApercuEnregistree = signatureApercu(config);
    importConfigColonnes = config.colonnes.map((c) => ({ ...c }));
    importConfigColonnesComparaison = [...(config.colonnes_comparaison || [])];
    document.getElementById("import-mode-comparaison").value = config.mode_comparaison;
    document.getElementById("import-lignes-entete").value = lignesEnteteDe(config);
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
    await loadImportPresets();
    showMessage(t("Configuration enregistrée"), "success");
    // Un fichier déjà chargé a été analysé avec l'ANCIENNE configuration : ses
    // couleurs de colonnes, ses en-têtes de propriété, ses lignes résolues et
    // ses doublons décrivent un import qui n'a plus cours. On le relit donc,
    // pour que l'aperçu montre ce que l'import fera réellement — c'est le seul
    // moyen de corriger un numéro de colonne en le voyant tomber en face des
    // bonnes données, ou de voir une exclusion faire apparaître les doublons
    // qu'elle débloque. Rien à faire si seul le nom a bougé (cf.
    // signatureApercu).
    if (apercuPerime && importFichierActuel) await relireFichierImport();
  } catch (err) {
    showMessage(err.message, "error");
  }
});

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
  _refillPreservingSelection(document.getElementById("import-compte-defaut"), (el) =>
    fillComptesSelect(el, comptesProposables(Number(el.value) || null), { keepFirst: true })
  );
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
  await executerPrevisualisation();
}

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
    JSON.stringify({ colonnes: importConfigColonnes.filter((c) => c.index >= 1) })
  );
}

async function executerPrevisualisation() {
  const formData = new FormData();
  formData.append("fichier", importFichierActuel);
  const compteDefaut = compteIdDefautChoisi();
  if (compteDefaut) formData.append("compte_id_defaut", compteDefaut);
  if (importReglageDelimiteur) formData.append("delimiteur", importReglageDelimiteur);
  if (importReglageSeparateurDecimal)
    formData.append("separateur_decimal", importReglageSeparateurDecimal);
  ajouterColonnesLues(formData);
  try {
    importApercu = await apiFetchForm(importUrl("/previsualiser"), formData);
    Object.keys(importMappingCategories).forEach((k) => delete importMappingCategories[k]);
    Object.keys(importMappingComptes).forEach((k) => delete importMappingComptes[k]);
    Object.keys(importMappingMonnaies).forEach((k) => delete importMappingMonnaies[k]);
    importCategoriesConfirmees.clear();
    importLignesSelectionnees.clear();
    Object.keys(importLigneOverrides).forEach((k) => delete importLigneOverrides[k]);
    importLignesSupprimees.clear();
    ligneApercuEnEdition = null;
    // La veille sur les virements repart de zéro : ses verdicts portent sur les
    // numéros de ligne du fichier PRÉCÉDENT, qui ne désignent plus rien.
    veilleDoublonsSignature = null;
    veilleDoublonsParLigne = {};
    // Doublons pré-sélectionnés : ils bloquent la confirmation tant qu'ils
    // sont sélectionnés, ce qui force à les traiter (les supprimer d'un clic,
    // ou les décocher pour les importer volontairement).
    importApercu.lignes
      .filter((l) => l.doublon_de != null)
      .forEach((l) => importLignesSelectionnees.add(l.ligne));
    renderApercuFichier();
    renderImportAvertissements();
    renderImportReglagesLecture();
    renderImportMappings();
    renderImportApercu();
    document.getElementById("import-resultat").style.display = "none";
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
  const largeurConfiguree = importConfigColonnes.reduce(
    (max, c) => Math.max(max, c.index || 0),
    0
  );
  const largeur = Math.max(largeurFichier, largeurConfiguree);

  const classeColonne = (i) => {
    const propriete = proprietes[String(i)];
    return propriete ? classeColonneApercu(propriete) : "col-ignoree";
  };

  const entetes = [];
  for (let i = 1; i <= largeur; i++) {
    const propriete = proprietes[String(i)];
    const libelle = propriete
      ? APERCU_PROPRIETES[propriete] || propriete
      : "non importée";
    // DÉPLAÇABLE, l'en-tête et lui seul : les cellules ne bougent pas — ce
    // qu'on réorganise est la façon de LIRE le fichier, pas le fichier.
    //
    // Une colonne HORS FICHIER porte une classe de plus : elle est bien là pour
    // qu'on puisse attraper sa propriété, mais elle ne décrit aucune donnée et
    // ne doit pas se lire comme une colonne qu'on aurait oublié de mapper.
    const horsFichier = i > largeurFichier ? " apercu-col-hors-fichier" : "";
    const titre = horsFichier
      ? t("Cette colonne n'existe pas dans le fichier : déplace son en-tête sur une colonne réelle.")
      : t("Glisse cet en-tête sur un autre pour échanger les deux colonnes");
    entetes.push(
      `<th class="${classeColonne(i)}${horsFichier} apercu-entete-deplacable" draggable="true"
           data-colonne="${i}" title="${titre}"
        ><span class="apercu-col-num">n°${i}</span>${escapeHtml(libelle)}</th>`
    );
  }

  const corps = apercu.lignes
    .map((ligne, index) => {
      // Les lignes de tête ignorées sont montrées mais barrées : voir qu'elles
      // sont bien exclues vaut mieux que de les faire disparaître
      // silencieusement.
      const estEnteteIgnoree = index < (apercu.lignes_entete || 0);
      const cellules = [];
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
  table.innerHTML = `<thead><tr>${entetes.join("")}</tr></thead><tbody>${corps}</tbody>`;
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

  table.querySelectorAll("th[data-colonne]").forEach((entete) => {
    entete.addEventListener("dragstart", (e) => {
      depuis = Number(entete.dataset.colonne);
      entete.classList.add("apercu-entete-glissee");
      e.dataTransfer.effectAllowed = "move";
      // Firefox n'amorce pas le glisser sans données attachées.
      e.dataTransfer.setData("text/plain", String(depuis));
    });

    entete.addEventListener("dragend", () => {
      depuis = null;
      table
        .querySelectorAll(".apercu-entete-glissee, .apercu-entete-cible")
        .forEach((el) => el.classList.remove("apercu-entete-glissee", "apercu-entete-cible"));
    });

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
  document.getElementById("import-apercu-fichier-alerte").style.display =
    importApercuAReloire ? "" : "none";
}

document.getElementById("btn-import-apercu-relire").innerHTML = ICONE_RELIRE;
document.getElementById("btn-import-apercu-relire").addEventListener("click", async () => {
  if (!importFichierActuel) {
    showMessage(t("Aucun fichier chargé à relire."), "error");
    return;
  }
  await relireFichierImport();
  // LE RAPPEL QUI MANQUAIT : relire montre ce que l'import DONNERA, mais
  // n'écrit rien. Un ordre de colonnes obtenu en glissant trois en-têtes serait
  // perdu au prochain fichier si personne ne dit qu'il reste à enregistrer.
  showMessage(
    t("Fichier relu. « Enregistrer la configuration » pour garder cet ordre de colonnes dans le preset."),
    "success"
  );
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

function renderImportMappings() {
  const blocGeneral = document.getElementById("import-mappings-bloc");
  const monnaiesInconnues = importApercu.monnaies_inconnues || [];
  const aDesInconnus =
    importApercu.categories_inconnues.length > 0 ||
    importApercu.comptes_inconnus.length > 0 ||
    monnaiesInconnues.length > 0;
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
  importApercu.categories_inconnues.forEach((nomBanque) => {
    const ligneAssociee = importApercu.lignes.find((l) => l.nom_banque_categorie === nomBanque);
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
  importApercu.comptes_inconnus.forEach((nomBanque) => {
    compteBloc.appendChild(
      creerLigneMapping(nomBanque, comptesProposables(), importMappingComptes, () => {
        appliquerMappingsLocalement();
        renderImportApercu();
      })
    );
  });

  // Devises qu'aucune correspondance mémorisée n'a permis de rattacher (cf.
  // _resoudre_monnaie côté serveur) : rien à afficher pour un preset sans
  // colonne de devise.
  document.getElementById("import-mappings-monnaies-bloc").style.display =
    monnaiesInconnues.length > 0 ? "" : "none";
  const monnaieBloc = document.getElementById("import-mappings-monnaies");
  monnaieBloc.innerHTML = "";
  monnaiesInconnues.forEach((nomBanque) => {
    monnaieBloc.appendChild(
      creerLigneMapping(nomBanque, state.monnaies, importMappingMonnaies, () => {
        appliquerMappingsLocalement();
        renderImportApercu();
      })
    );
  });

  renderImportMonnaiesResolues();
}

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
  importApercu.categories_inconnues.forEach((nomBanque) =>
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
    if (ligne.nom_banque_categorie && categorieId) {
      // Même arbitrage que le serveur (cf. import_bancaire._resoudre_ligne) :
      // une correspondance ne renseigne que la catégorie, et seulement pour les
      // types qui en admettent une. Le type reste celui posé par la règle.
      ligne.categorie_id = TYPES_CATEGORIE_LIBRE.has(typeOperationLigne(ligne))
        ? categorieId
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
}

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
function rolesCompteVirement(ligne) {
  const nomConnu = ligne.compte_id !== null ? nomCompte(ligne.compte_id) : ligne.nom_banque_compte || "-";
  const nomAutre =
    ligne.compte_id_autre !== null && ligne.compte_id_autre !== undefined ? nomCompte(ligne.compte_id_autre) : "-";
  const emetteur = ligne.montant_signe !== null && ligne.montant_signe !== undefined && ligne.montant_signe < 0;
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

// Contenu de la colonne "Montant" : ce qui part quand le relevé le dit, puis ce
// qui arrive, sa devise, et le sens quand le fichier le déclare à part.
function montantLigneApercuHtml(ligne) {
  // `monnaie_operation_id` et non `monnaie_id` : sur une sortie à un seul
  // compte, c'est le montant ENVOYÉ qui fait l'opération, dans sa monnaie.
  const monnaieOperation = ligne.monnaie_operation_id ?? ligne.monnaie_id;
  const monnaieEnvoyeeLigne = ligne.monnaie_envoyee_id ?? ligne.monnaie_id;
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
  if (ligne.sens_explicite) {
    const sortie = ligne.montant_signe != null && ligne.montant_signe < 0;
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
    const monnaieFrais = ligne.monnaie_frais_id ?? ligne.monnaie_id;
    html += `<span class="apercu-frais">dont frais ${escapeHtml(
      formatMontant(ligne.frais, monnaieFrais)
    )}</span>`;
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
  // L'erreur est calculée par le serveur, en français (cf. _erreur_ligne) : elle
  // se traduit donc à l'affichage, comme les messages d'API.
  if (ligne.erreur) {
    return `<span class="badge-aucun">${escapeHtml(traduireMessageServeur(ligne.erreur))}</span>`;
  }
  if (ligne.statut_import === "attente") {
    return '<span class="badge-partiel">en attente — importée en prévisionnel</span>';
  }
  if (ligne.compte_id === null) return '<span class="badge-partiel">compte à mapper</span>';
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
function toggleSousSection(containerId, nombreLignes) {
  document.getElementById(containerId).style.display = nombreLignes > 0 ? "" : "none";
}

function renderImportApercu() {
  document.getElementById("import-apercu-bloc").style.display = "";
  document.getElementById("import-apercu-nombre").textContent = importApercu.lignes.length;
  renderImportPrevisionnelles();

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
  const lignesRessemblances = importApercu.lignes.filter(
    (l) => l.doublon_de == null && veilleDoublonsParLigne[l.ligne] != null
  );
  document.getElementById("import-apercu-nombre-ressemblances").textContent =
    lignesRessemblances.length;
  remplirApercuTbodyRessemblances("import-apercu-liste-ressemblances", lignesRessemblances);
  toggleSousSection("import-apercu-section-ressemblances", lignesRessemblances.length);

  const lignesDoublons = importApercu.lignes.filter((l) => l.doublon_de != null);
  document.getElementById("import-apercu-nombre-doublons").textContent = lignesDoublons.length;
  remplirApercuTbodyDoublons("import-apercu-liste-doublons", lignesDoublons);
  toggleSousSection("import-apercu-section-doublons", lignesDoublons.length);

  updateBtnImportSupprimerSelectionEtat();
  updateBtnImportConfirmerEtat();
  majVeilleDoublonsVirements();
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
      ligne.monnaie_operation_id || ligne.monnaie_id
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
        l.compte_id != null
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

// Chaque ligne doublon est suivie, juste en dessous, de la ligne déjà en base
// suspectée (importApercu.lignes_existantes, résolue au même format côté
// serveur) affichée en lecture seule — mêmes colonnes, sans Actions/Sélection,
// pour une comparaison directe entre les deux lignes. Une liste vide masque
// toute la section (cf. toggleSousSection, renderImportApercu).
function remplirApercuTbodyDoublons(tbodyId, lignes) {
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
        ? creerLigneApercuEdition(ligne, INFO_TYPE_DOUBLON)
        : creerLigneApercuAffichage(ligne, INFO_TYPE_DOUBLON);
    tr.classList.add("import-doublon-nouvelle");
    body.appendChild(tr);

    const existante = importApercu.lignes_existantes[String(ligne.doublon_de)];
    if (existante) {
      const trExistante = creerLigneApercuAffichage(existante, INFO_TYPE_DOUBLON, { lectureSeule: true });
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
      body.appendChild(creerLigneSuspectVirement(suspect, nbColonnes));
    });
  });
}

// La rangée « ressemble à … » sous une ligne suspectée de doubler un virement.
function creerLigneSuspectVirement(suspect, nbColonnes) {
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
    </td>
  `;
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

  tr.innerHTML = `
    <td>${lectureSeule ? "Existant" : ligne.ligne}</td>
    <td>${ligne.date ? formatDate(ligne.date) : "-"}</td>
    <td>${ligne.nature || "-"}</td>
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
        updateBtnImportSupprimerSelectionEtat();
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
  placeholder.textContent = "- À choisir -";
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
      montantAffiche.textContent = `${formatMontant(ligne.montant || 0)} (affecté : ${formatMontant(total)})`;
    }
    btnEnregistrer.textContent = infoChoisi().reglement && total > 0 ? "Créer l'opération liée" : "Enregistrer";
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
                  `le montant du remboursement (${formatMontant(ligne.montant || 0)}).`,
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
                    `le montant du remboursement (${formatMontant(ligne.montant || 0)}).`
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
      const compteId = compteChamp && compteChamp.estConfirme() ? Number(compteChamp.select.value) : null;
      if (compteId && monnaiesDuCompte(compteId).length <= 1) return;
      const label = document.createElement("label");
      label.textContent = "Monnaie";
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
    labelMonnaieEnvoyee.textContent = "Monnaie envoyée";
    selectMonnaieEnvoyee = creerSelectMonnaie(compteSourceId, ligne.monnaie_envoyee_id);
    labelMonnaieEnvoyee.appendChild(selectMonnaieEnvoyee);

    const labelMonnaieRecue = document.createElement("label");
    labelMonnaieRecue.textContent = "Monnaie reçue";
    selectMonnaie = creerSelectMonnaie(compteDestinationId, ligne.monnaie_id);
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
    labelFrais.textContent = "Frais";
    inputFrais = document.createElement("input");
    inputFrais.type = "number";
    inputFrais.step = "0.01";
    inputFrais.min = "0";
    inputFrais.value = ligne.frais != null ? ligne.frais : "";
    labelFrais.appendChild(inputFrais);

    const labelMonnaieFrais = document.createElement("label");
    labelMonnaieFrais.textContent = "Monnaie des frais";
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
  function rerenderChampsSelonType() {
    const info = infoChoisi();

    montantWrap.innerHTML = "";
    const labelMontant = document.createElement("label");
    labelMontant.textContent = "Montant";
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
    if (info.categorieLibre) {
      const label = document.createElement("label");
      label.textContent = "Catégorie";
      selectCategorie = document.createElement("select");
      categoriesProposables(ligne.categorie_id ?? null).forEach((c) => {
        const opt = document.createElement("option");
        opt.value = c.id;
        opt.textContent = c.nom;
        selectCategorie.appendChild(opt);
      });
      // Une ligne venant d'un type sans catégorie n'en a aucune à
      // présélectionner : le premier choix de la liste fera l'affaire.
      if (ligne.categorie_id != null) {
        selectCategorie.value = String(ligne.categorie_id);
      }
      label.appendChild(selectCategorie);
      categorieWrap.appendChild(label);
    } else {
      selectCategorie = null;
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
      labelEmetteur.textContent = "Compte émetteur";
      compteChampEmetteur = creerChampCompteAvecIndice(emetteurActif ? ligne.compte_id : valeurAutre);
      labelEmetteur.appendChild(compteChampEmetteur.wrap);

      const labelRecepteur = document.createElement("label");
      labelRecepteur.textContent = "Compte récepteur";
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
      label.textContent = "Montant à rembourser";
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
      label.textContent = info.cle === "remboursement_pret" ? "Prêts réglés" : "Dépenses réglées";
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
    labelNotes
  );

  const tdFormulaire = document.createElement("td");
  tdFormulaire.colSpan = infoTypeSection.categorieLibre || infoTypeSection.virement ? 8 : 7;
  tdFormulaire.appendChild(formulaire);

  const btnEnregistrer = document.createElement("button");
  btnEnregistrer.type = "button";
  btnEnregistrer.className = "primary";
  btnEnregistrer.textContent = "Enregistrer";
  const btnAnnuler = document.createElement("button");
  btnAnnuler.type = "button";
  btnAnnuler.textContent = "Annuler";
  const tdActions = document.createElement("td");
  tdActions.appendChild(btnEnregistrer);
  tdActions.appendChild(btnAnnuler);

  const tdVerifiee = document.createElement("td");
  tdVerifiee.textContent = "-";

  tr.append(tdLigne, tdFormulaire, tdActions, tdVerifiee);

  rerenderChampsSelonType();
  selectType.addEventListener("change", rerenderChampsSelonType);

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
  async function creerOperationReglementLiee(info, compteId) {
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
    try {
      const creee = await apiFetch("/operations", {
        method: "POST",
        body: JSON.stringify({
          date: inputDate.value,
          compte_id: compteId,
          monnaie_id: monnaieId,
          type_id: idTypeOperation(info.cle),
          nature: inputNature.value.trim(),
          // Le montant de l'opération est celui du relevé bancaire, pas la
          // somme des liens : un remboursement peut rester partiellement
          // affecté (le backend valide que les liens ne le dépassent pas).
          montant: ligne.montant || 0,
          statut: "réel",
          operations_remboursees: operationsRemboursees,
          notes: inputNotes.value.trim() || null,
        }),
      });
      // CETTE LIGNE-LÀ EST LA SEULE DE L'IMPORT À NE PAS PASSER PAR `confirmer`,
      // qui alimente lui-même le stock anti-doublons. Sans cet appel, le même
      // relevé réimporté ne reconnaissait pas un règlement déjà importé — alors
      // qu'il signalait bien remboursables, prêts et virements.
      //
      // Après la création, et sans la remettre en cause si elle échoue :
      // l'opération existe, l'oublier au stock ne fait courir qu'un doublon à
      // signaler en moins, tandis que revenir en arrière défairait une liaison
      // que l'utilisateur vient d'établir.
      await enregistrerLigneBruteImportee(ligne.ligne, creee.id);
      showMessage(`"${inputNature.value.trim()}" créée et liée.`, "success");
      // Créée individuellement : un éventuel confirm groupé ultérieur du même
      // fichier ne doit surtout pas la recréer.
      supprimerLigneApercu(ligne);
      ligneApercuEnEdition = null;
      if (importApercu.lignes.length === 0) {
        await finaliserImportComplet();
      } else {
        renderImportApercu();
      }
    } catch (err) {
      showMessage(err.message, "error");
    }
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
      await creerOperationReglementLiee(info, compteId);
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
    if (info.categorieLibre) {
      if (!selectCategorie.value) {
        showMessage(t("Choisis une catégorie."), "error");
        return;
      }
      categorieId = Number(selectCategorie.value);
    }

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
    };

    // Les frais accompagnent TOUJOURS des montants saisis hors frais, même
    // quand le formulaire ne les montre pas (monnaies redevenues égales, type
    // reclassé) : c'est leur présence qui dit au serveur comment relire ces
    // montants, et les taire lui ferait prendre une base pour un résultat. Le
    // serveur les impute alors à la jambe que leur devise désigne — ajoutés à
    // l'émetteur, retranchés au récepteur (cf. _reimputer_frais).
    if (ligneAvecFrais) {
      const fraisSaisis = parseFloat(inputFrais ? inputFrais.value : "");
      override.frais = isNaN(fraisSaisis) ? 0 : fraisSaisis;
      override.monnaie_frais_id = selectMonnaieFrais
        ? Number(selectMonnaieFrais.value) || null
        : ligne.monnaie_frais_id ?? null;
    }
    const typeAvant = typeOperationLigne(ligne);
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

async function finaliserImportComplet() {
  showMessage(t("Import terminé : toutes les lignes ont été traitées."), "success");
  reinitialiserImport();
  await loadImportMappingsOverview();
  await loadImportHistorique();
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
  const texte = raisons.filter(Boolean).join("\n\n");
  if (texte) {
    bulle.dataset.info = texte;
  } else {
    delete bulle.dataset.info;
  }
  btn.title = texte;
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
  const btn = document.getElementById("btn-import-confirmer");
  if (!importApercu) {
    btn.disabled = true;
    setBulleBlocageImport(["Aucun fichier analysé : sélectionne un relevé au-dessus."]);
    return;
  }
  // Les lignes refusées par la banque sont exclues des contrôles au même titre
  // que les lignes de règlement : elles ne seront pas importées, exiger qu'elles
  // soient complètes appellerait des corrections sans objet.
  const lignesActives = importApercu.lignes.filter(
    (l) => !infoTypeOperationLigne(l).reglement && !ligneRefuseeParStatut(l)
  );
  if (importApercu.lignes.length === 0) {
    btn.disabled = true;
    setBulleBlocageImport(["Aucune ligne à importer : l'aperçu est vide."]);
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
  const rienDeSelectionne = importLignesSelectionnees.size === 0;
  btn.disabled = !(
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
    categoriesOk
      ? ""
      : `${nbCategories} ligne(s) portent une catégorie bancaire encore proposée par défaut : ` +
        "confirme-la (ou change-la) dans « Catégories bancaires à confirmer », plus haut.",
    comptesOk
      ? ""
      : `${nbComptes} ligne(s) n'ont pas de compte : renseigne-le dans « Comptes bancaires à ` +
        "faire correspondre », ou choisis un compte par défaut au-dessus de l'aperçu.",
    monnaiesOk
      ? ""
      : `${nbMonnaies} ligne(s) portent une devise que l'app ne connaît pas encore : rattache-la ` +
        "dans « Devises à faire correspondre ». Sans ça, la ligne serait libellée dans la " +
        "monnaie principale de son compte, c'est-à-dire dans la mauvaise.",
    lignesFraisIncoherents.length === 0
      ? ""
      : `${lignesFraisIncoherents.length} ligne(s) portent des frais dans une monnaie qui n'est ` +
        "ni celle du montant reçu ni celle du montant envoyé. Retire la colonne « Frais » de la " +
        "configuration avancée, ou corrige la colonne de devise qui la qualifie.",
    virementsIncomplets.length === 0
      ? ""
      : `${virementsIncomplets.length} virement(s) interne(s) n'ont qu'un seul compte : ouvre ` +
        "« Modifier » et renseigne le compte en face, ou reclasse la ligne dans un autre type.",
    rienDeSelectionne
      ? ""
      : `${importLignesSelectionnees.size} ligne(s) sont encore sélectionnées : supprime-les ou ` +
        "décoche-les pour pouvoir importer.",
  ]);
}

document.getElementById("btn-import-confirmer").addEventListener("click", async () => {
  if (!importFichierActuel || !importApercu) return;
  const formData = new FormData();
  formData.append("fichier", importFichierActuel);
  const compteDefaut = compteIdDefautChoisi();
  if (compteDefaut) formData.append("compte_id_defaut", compteDefaut);
  // Mêmes réglages qu'à l'aperçu confirmé : le fichier doit être relu à
  // l'identique, sans quoi la confirmation verrait d'autres lignes en erreur
  // que celles déjà traitées (cf. services/import_bancaire.confirmer).
  if (importReglageDelimiteur) formData.append("delimiteur", importReglageDelimiteur);
  if (importReglageSeparateurDecimal)
    formData.append("separateur_decimal", importReglageSeparateurDecimal);
  ajouterColonnesLues(formData);
  const categories = {};
  Object.entries(importMappingCategories).forEach(([nom, categorieId]) => {
    if (categorieId) categories[nom] = categorieId;
  });
  const comptes = {};
  Object.entries(importMappingComptes).forEach(([nom, id]) => {
    if (id) comptes[nom] = id;
  });
  const monnaies = {};
  Object.entries(importMappingMonnaies).forEach(([nom, id]) => {
    if (id) monnaies[nom] = id;
  });
  // Les lignes de règlement ne font jamais partie de ce confirm : on les
  // ajoute aux lignes supprimées le temps de cet envoi précis, sans les
  // retirer de l'aperçu — elles restent à traiter individuellement ensuite
  // (cf. creerLigneApercuEdition, mode règlement), une fois que le reste (et
  // donc les dépenses/prêts qu'elles règlent potentiellement) est bien en base.
  const lignesReglementNumeros = importApercu.lignes
    .filter((l) => infoTypeOperationLigne(l).reglement)
    .map((l) => l.ligne);
  const lignesSupprimeesPourCeConfirm = [...new Set([...importLignesSupprimees, ...lignesReglementNumeros])];

  formData.append(
    "mappings",
    JSON.stringify({
      categories,
      comptes,
      monnaies,
      lignes: importLigneOverrides,
      lignes_supprimees: lignesSupprimeesPourCeConfirm,
      // Une LISTE DE REFUS, et non d'acceptations : le rapprochement a lieu par
      // défaut (cf. le panneau « Dépenses prévues reconnues »).
      rapprochements_refuses: [...importRapprochementsRefuses],
    })
  );

  try {
    const resultat = await apiFetchForm(importUrl("/confirmer"), formData);
    importDernierHistoriqueId = resultat.historique_id ?? null;
    afficherResultatImport(resultat);
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

    const lignesRestantes = importApercu.lignes.filter((l) => infoTypeOperationLigne(l).reglement);
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
 * ORDRE DES COLONNES DE LA GALERIE, choisi à la main.
 *
 * Les colonnes arrivaient dans l'ordre des catégories (celui de la page
 * Catégories, qui suit le budget). C'est un bon ordre pour lire un budget, pas
 * pour ranger des libellés : ce qu'on veut ici, c'est mettre côte à côte les
 * deux ou trois catégories entre lesquelles on hésite à chaque import, et
 * repousser au bout celles qui ne reçoivent jamais rien. On attrape donc une
 * colonne PAR SON EN-TÊTE et on la pose ailleurs.
 *
 * STOCKÉ SUR LE POSTE (localStorage), comme les dossiers de règles et pour la
 * même raison : c'est un confort de lecture, pas une donnée du budget. Et
 * surtout, l'écrire en base voudrait dire réécrire `Categorie.ordre` — l'ordre
 * du budget serait alors bousculé par un rangement fait ici, sur un écran qui
 * ne parle pas de budget.
 *
 * L'ordre mémorisé ne fait pas autorité sur la LISTE : une catégorie créée
 * depuis le dernier rangement n'y figure pas, et se range à la fin ; une
 * catégorie supprimée y reste sans conséquence (plus rien ne la réclame).
 */
const CLE_ORDRE_COLONNES_MAPPINGS = "budget-app.correspondances.ordre-colonnes";

function chargerOrdreColonnesMappings() {
  try {
    const brut = JSON.parse(localStorage.getItem(CLE_ORDRE_COLONNES_MAPPINGS) || "null");
    if (Array.isArray(brut)) return brut.map(Number).filter(Number.isFinite);
  } catch (err) {
    // Contenu illisible : on repart de l'ordre des catégories plutôt que de
    // casser l'écran. Aucune correspondance n'est perdue — seul le rangement
    // l'est.
    console.warn("Ordre des colonnes illisible, remis à zéro :", err);
  }
  return [];
}

function enregistrerOrdreColonnesMappings(ids) {
  localStorage.setItem(CLE_ORDRE_COLONNES_MAPPINGS, JSON.stringify(ids));
}

/** Les cibles dans l'ordre retenu ; les inconnues à la fin, dans leur ordre. */
function ordonnerCiblesMappings(cibles) {
  const rangs = new Map(chargerOrdreColonnesMappings().map((id, rang) => [id, rang]));
  return [...cibles].sort((a, b) => {
    const rangA = rangs.has(a.id) ? rangs.get(a.id) : Number.MAX_SAFE_INTEGER;
    const rangB = rangs.has(b.id) ? rangs.get(b.id) : Number.MAX_SAFE_INTEGER;
    // Départage par la position d'origine : deux colonnes jamais rangées
    // gardent l'ordre des catégories entre elles.
    if (rangA !== rangB) return rangA - rangB;
    return cibles.indexOf(a) - cibles.indexOf(b);
  });
}

/**
 * Rend les colonnes déplaçables, par leur en-tête et par lui seul.
 *
 * L'EN-TÊTE COMME POIGNÉE, plutôt qu'une colonne déplaçable de partout : son
 * corps est déjà la zone où l'on dépose les cartes, et le même geste au même
 * endroit ne peut pas vouloir dire deux choses. `draggable` n'est donc posé sur
 * la colonne qu'au moment où le bouton s'enfonce sur son titre, et retiré
 * ensuite — c'est l'ancêtre déplaçable le plus proche qui l'emporte, et une
 * colonne déplaçable en permanence volerait le glissement des cartes.
 */
function attacherDragColonnesGalerie(bloc, { onOrdreChange, onHauteursChangees }) {
  const ordreColonnes = (bloc) =>
    [...bloc.querySelectorAll(".galerie-colonne")].map((c) => Number(c.dataset.categorieId));
  let ordreAvant = "";

  bloc.querySelectorAll(".galerie-colonne").forEach((colonne) => {
    const titre = colonne.querySelector(".galerie-colonne-titre");
    if (!titre) return;
    titre.classList.add("galerie-colonne-poignee");
    titre.setAttribute("title", t("Fais glisser cet en-tête pour déplacer la colonne"));

    titre.addEventListener("mousedown", () => (colonne.draggable = true));
    // Relâché sans avoir glissé : la colonne ne doit pas rester déplaçable, ou
    // le clic suivant sur une carte partirait avec elle.
    titre.addEventListener("mouseup", () => (colonne.draggable = false));

    colonne.addEventListener("dragstart", (e) => {
      colonne.classList.add("colonne-dragging");
      // L'ordre AVANT le glissement : au dragend, les colonnes ont déjà bougé
      // dans le DOM, et lui seul dit si quelque chose a réellement changé —
      // reposer une colonne là où elle était ne doit rien annoncer.
      ordreAvant = ordreColonnes(bloc).join(",");
      e.dataTransfer.effectAllowed = "move";
      // Firefox n'amorce aucun glissement sans donnée transportée.
      e.dataTransfer.setData("text/plain", colonne.dataset.categorieId || "");
      // Le glissement part de la colonne, pas d'une carte : les gestionnaires
      // de cartes se reconnaissent à `.galerie-carte.dragging` et laissent
      // passer.
      e.stopPropagation();
    });

    colonne.addEventListener("dragend", () => {
      colonne.draggable = false;
      colonne.classList.remove("colonne-dragging");
      // Les colonnes ont changé de place, donc de voisines, donc de rangée :
      // sans ce recalcul les `span` d'avant le déplacement resteraient posés.
      if (onHauteursChangees) onHauteursChangees();
      const ids = ordreColonnes(bloc);
      if (ids.join(",") === ordreAvant) return;
      enregistrerOrdreColonnesMappings(ids);
      if (onOrdreChange) onOrdreChange(ids);
    });
  });

  bloc.addEventListener("dragover", (e) => {
    const deplacee = bloc.querySelector(".galerie-colonne.colonne-dragging");
    if (!deplacee) return;
    e.preventDefault();
    const survolee = e.target.closest(".galerie-colonne");
    if (!survolee || survolee === deplacee) return;
    // Comparaison HORIZONTALE : la galerie est une grille de colonnes côte à
    // côte, et c'est de gauche/droite qu'on parle même quand deux colonnes sont
    // sur deux rangées différentes.
    const rect = survolee.getBoundingClientRect();
    const apresMilieu = e.clientX > rect.left + rect.width / 2;
    bloc.insertBefore(deplacee, apresMilieu ? survolee.nextSibling : survolee);
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

  ordonnerCiblesMappings(ciblesEligiblesImport()).forEach((categorie) => {
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

  attacherDragColonnesGalerie(bloc, {
    onHauteursChangees: () => ajusterHauteursGalerie(bloc),
    onOrdreChange: () => showMessage(t("Ordre des colonnes enregistré"), "success"),
  });

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
 * Les noms cités sont les IDENTIFIANTS des extensions attendues, pas leurs
 * noms d'affichage : une extension absente du disque n'a pas de nom
 * d'affichage à donner — c'est justement le cas qu'on décrit.
 */
function manqueExtensionHtml(extension) {
  const noms = (extension.requiert_une_de || []).map((id) => `« ${escapeHtml(id)} »`);
  return `${t("Nécessite au moins une de ces extensions, installée et activée :")} ${noms.join(
    ` ${t("ou")} `
  )}`;
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
    `<p class="extension-description">${escapeHtml(t(e.description))}</p>`,
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
  const installees = extensions.filter((e) => e.installee);
  const nonInstallees = extensions.filter((e) => !e.installee);

  const sectionInstallees = installees.map(carteExtensionHtml).join("");
  const sectionNonInstallees =
    nonInstallees.length === 0
      ? ""
      : `<h4 class="extensions-groupe-titre">${t("Non installées sur cette machine")}</h4>
         ${nonInstallees.map(carteExtensionHtml).join("")}`;

  bloc.innerHTML = sectionInstallees + sectionNonInstallees;
}

// Délégation : les cartes sont reconstruites à chaque rendu.
document.getElementById("extensions-liste").addEventListener("change", async (e) => {
  const case_ = e.target.closest("select[data-extension-id]");
  if (!case_) return;
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
    await loadExtensions();
    showMessage(
      actif ? t("Extension activée.") : t("Extension désactivée. Aucune donnée n'a été supprimée."),
      "success"
    );
  } catch (err) {
    // L'écran doit refléter l'état réel du serveur, pas l'intention.
    case_.value = actif ? "inactif" : "actif";
    showMessage(err.message, "error");
  }
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
  bulle.textContent = texte;
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
    document.getElementById("bdd-chemin-actuel").textContent = etat.chemin_actuel;
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
    // L'ORDRE COMPTE : sur un build de test, `choix_memorise` est faux PAR
    // CONSTRUCTION, et annoncer « le choix n'a pas pu être enregistré » ferait
    // croire à une panne. Le message du build de test dit la même chose, mais
    // en donnant la raison.
    if (etat.build_de_test) {
      messages.push(
        t(
          "Build de test construit en local : cette copie ouvre toujours sa propre base de test " +
            "et n'écrit jamais dans la configuration de l'application. Changer de base ne vaut " +
            "que pour cette session. Supprime le fichier BUILD-DE-TEST.txt à côté de l'exécutable " +
            "pour qu'elle se comporte comme une version publiée."
        )
      );
    } else if (etat.mode_developpement) {
      // Le serveur de dev : même règle, autre raison (il n'y a pas de bundle à
      // démarquer). Dire laquelle des deux on est évite de chercher un
      // BUILD-DE-TEST.txt qui n'existe nulle part.
      messages.push(
        t(
          "Serveur de développement : la base de l'application est celle du dépôt, et rien " +
            "n'est écrit dans la configuration. Changer de base ne vaut que pour cette session."
        )
      );
    } else if (!etat.choix_memorise) {
      messages.push(
        t("Ce choix n'a pas pu être enregistré : il ne vaudra que pour cette session.")
      );
    }
    alerte.innerHTML = messages.map((m) => `<div>${escapeHtml(m)}</div>`).join("");
    alerte.style.display = messages.length ? "" : "none";

    // La version de schéma du fichier ouvert, face à celle qu'attend l'app :
    // un écart est exactement ce qui rend une base illisible après une mise à
    // jour, et c'est la première chose à vérifier quand quelque chose cloche.
    const schemaEl = document.getElementById("bdd-schema");
    const aJour = etat.revision_base === etat.revision_app;
    schemaEl.textContent = aJour
      ? `Schéma ${etat.revision_base || "?"} — à jour.`
      : `Schéma ${etat.revision_base || "inconnu"}, l'application attend ${etat.revision_app}.`;
    schemaEl.classList.toggle("hint", aJour);
    schemaEl.classList.toggle("import-avertissements", !aJour);

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
    sessionStorage.setItem("baseInstallee", etat.action || "");
    rechargerApresBascule(etat);
  } catch (err) {
    showMessage(err.message, "error");
  }
});

function afficherInstallationBaseSiRecente() {
  const action = sessionStorage.getItem("baseInstallee");
  if (action === null) return;
  sessionStorage.removeItem("baseInstallee");
  const phrases = {
    déplacée: "Tes données ont été déplacées : elles ne sont plus dans le dossier de l'application, une mise à jour ne les touchera plus.",
    créée: "Nouvelle base créée à l'emplacement choisi.",
    ouverte: "Base existante ouverte à l'emplacement choisi.",
  };
  showMessage(phrases[action] || "Emplacement de la base mis à jour.", "success", {
    persistent: true,
  });
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

  const champ = document.getElementById("modale-bdd-chemin");
  champ.value = etat.chemin_propose;
  document.getElementById("modale-bdd-explication").textContent =
    `Actuellement : ${etat.chemin_actuel}. Ce fichier sera DÉPLACÉ vers l'emplacement ci-dessus ` +
    `(rien n'est perdu, rien n'est copié en double).`;
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
    sessionStorage.setItem("baseInstallee", etat.action || "");
    rechargerApresBascule(etat);
  } catch (err) {
    erreur.textContent = err.message;
    erreur.style.display = "";
    bouton.disabled = false;
  }
});

/* ---------- Init ---------- */

document.querySelectorAll("nav button").forEach((btn) => {
  btn.addEventListener("click", () => switchSection(btn.dataset.section));
});

(async function init() {
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
