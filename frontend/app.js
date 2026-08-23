/* ---------- Langue ---------- */

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
  // Monnaie sélectionnée dans les onglets du dashboard et de la page
  // Catégories — deux sélections indépendantes, les deux pages ne se
  // consultent pas ensemble.
  dashboardMonnaieId: null,
  categoriesMonnaieId: null,
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
  categoriesPeriode: {},
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

// Types dont la catégorie est libre : les quatre autres n'en portent aucune,
// leur type EST leur classification (cf. constants.TYPES_AVEC_CATEGORIE_LIBRE).
const TYPES_CATEGORIE_LIBRE = new Set(["classique", "remboursable"]);
// Types pour lesquels `remboursable` vaut vrai (cf. constants.TYPES_REMBOURSABLES).
const TYPES_REMBOURSABLES = new Set(["remboursable", "pret"]);
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

function typeLabel(value) {
  return TYPE_LABELS[value] || value;
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
 */
function appliquerVeillePeriode(elAnnees, elMois, vue) {
  if (elAnnees) elAnnees.classList.toggle("en-veille", vue === "mois");
  if (elMois) elMois.classList.toggle("en-veille", vue === "annee");
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

function formatMontant(valeur, monnaieId) {
  const symbole = symboleMonnaie(monnaieId);
  return symbole ? `${FORMAT_NOMBRE.format(valeur)} ${symbole}` : FORMAT_NOMBRE.format(valeur);
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

// Montant d'une opération dans les listes : coloré selon le sens de l'argent
// (vert = entre, rouge = sort, neutre = virement interne), signé pour lever
// toute ambiguïté même en scan rapide.
function montantHtml(montant, sens, monnaieId) {
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
    opt.textContent = c.nom;
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

function nomCategorie(categorieId) {
  // Absente pour de bon : les quatre types sans catégorie libre (virement
  // interne, prêt reçu, remboursement reçu, remboursement de prêt) n'en portent
  // aucune par nature. Un « #null » n'y désignerait rien à chercher — d'où le
  // tiret, réservé aux cases vides, distinct du « #12 » d'une catégorie
  // supprimée qui, elle, a bien existé.
  if (categorieId == null) return "-";
  const c = state.categories.find((c) => c.id === categorieId);
  return c ? c.nom : `#${categorieId}`;
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

function appliquerRecherche({ conserverIndex = true } = {}) {
  const section = sectionActive();
  // Le nettoyage porte sur TOUTE la page, pas seulement la section visible :
  // sinon un surlignage posé avant un changement d'onglet y resterait, et
  // rouvrir l'onglet montrerait des marques sans rapport avec le terme actuel.
  effacerSurlignages();
  rechercheCorrespondances = [];
  if (!section) return;

  const terme = normaliserRecherche(rechercheTerme).trim();
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

function switchSection(name) {
  document.querySelectorAll("section").forEach((s) => s.classList.remove("active"));
  document.getElementById(`section-${name}`).classList.add("active");
  document.querySelectorAll("nav button").forEach((b) => b.classList.remove("active"));
  document.querySelector(`nav button[data-section="${name}"]`).classList.add("active");

  if (name === "dashboard") loadDashboard();
  if (name === "comptes-globale") loadComptesGlobale();
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

/* ---------- Paramètres (sous-pages) ---------- */

// Comptes et Catégories vivaient dans la barre de navigation principale ; ce
// sont des réglages, consultés rarement, pas des pages du quotidien — d'où leur
// place ici, aux côtés des correspondances et de l'import.
function chargerSousPageParametres(page) {
  if (page === "parametres-comptes") loadComptes();
  if (page === "parametres-categories") loadCategories();
  if (page === "parametres-correspondances") loadCorrespondances();
  if (page === "parametres-import") loadImportSection();
  if (page === "parametres-extensions") loadExtensions();
  // Sous-pages apportées par une extension (« Base de données » en version
  // développeur, par exemple) : comme pour les écrans principaux, le noyau ne
  // les connaît pas par leur nom et demande à qui de droit.
  BudgetApp.extensions.ouvrirSousPage(page);
}

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

  const filtreStatut = document.getElementById("filtre-statut");
  const tousStatutOption = filtreStatut.firstElementChild;
  fillSelect(filtreStatut, state.meta.statuts, { labels: statutLabel });
  filtreStatut.insertBefore(tousStatutOption, filtreStatut.firstChild);

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
  if (!state.categoriesMonnaieId && state.monnaies.length > 0) {
    state.categoriesMonnaieId = state.monnaies[0].id;
  }
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
  const filtreCompte = document.getElementById("filtre-compte");
  // Préserve la sélection courante du filtre : sans ça, reconstruire la liste
  // (ex. après un clic sur "Filtrer", qui rafraîchit comptes/catégories avant
  // de lire les filtres) la remettait silencieusement à "Tous".
  _refillPreservingSelection(filtreCompte, (el) => {
    const tousOption = el.firstElementChild;
    fillComptesSelect(el, state.comptes, { keepFirst: true });
    el.insertBefore(tousOption, el.firstChild);
  });
}

async function refreshCategories() {
  // Depuis la migration 0019, la table ne contient plus que de vraies
  // catégories de dépense : les quatre anciennes catégories « système » sont
  // devenues des types, plus rien à filtrer ici.
  state.categories = await apiFetch("/categories");
  _refillPreservingSelection(document.getElementById("filtre-categorie"), (el) => {
    const tousOption = el.firstElementChild;
    fillCategoriesSelect(el, state.categories, { keepFirst: true });
    el.insertBefore(tousOption, el.firstChild);
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
    // Un groupe par monnaie, tous frères dans la même ligne flexible : c'est
    // elle qui décide de les mettre côte à côte ou de les retomber à la ligne
    // selon la largeur de la carte (cf. .compte-soldes-ligne).
    const soldes = soldesAffiches(c, monnaieId)
      .map(
        (s) => `
        <div class="compte-solde-groupe">
          <div class="compte-solde ${s.solde_reel < 0 ? "negatif" : ""}">${formatMontant(
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
    const monnaieId = state.dashboardMonnaieId;

    renderOngletsMonnaies(
      "dashboard-monnaies",
      data.monnaies,
      state.dashboardMonnaieId,
      (choisie) => {
        state.dashboardMonnaieId = choisie;
        loadDashboardData(annee, mois);
      }
    );

    const libellePeriode =
      state.dashboardPeriode.vue === "annee" ? `Année ${annee}` : libelleMois(annee, mois);
    document.getElementById("dashboard-periode-libelle").textContent = libellePeriode.toLowerCase();
    renderKpisDashboard(
      data.kpis.find((k) => k.monnaie_id === state.dashboardMonnaieId) || null,
      libellePeriode
    );
    renderRepartitionComptes(data.comptes, monnaieId);
  } catch (err) {
    showMessage(err.message, "error");
  }
}

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

function renderKpisDashboard(kpis, libellePeriode) {
  if (!kpis) {
    // Aucun compte, donc aucune monnaie en jeu : rien à agréger.
    [
      "kpi-solde-total",
      "kpi-solde-projete",
      "kpi-total-avoirs",
      "kpi-variation",
      "kpi-total-entrees",
      "kpi-total-sorties",
      "kpi-flux-difference",
    ].forEach((id) => (document.getElementById(id).textContent = "-"));
    renderHistogrammeDepenses([], null);
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
  // Les titres détenus ne figurent dans aucun solde de compte : le sous-texte
  // dit d'où vient la part qui n'y est pas.
  document.getElementById("kpi-total-avoirs-sous-texte").textContent =
    kpis.valorisation_placements > 0
      ? `Tous comptes confondus, dont ${formatMontant(
          kpis.valorisation_placements,
          monnaieId
        )} de titres`
      : "Tous comptes confondus, courant + épargne";

  const variationEl = document.getElementById("kpi-variation");
  const variation = kpis.variation_previsionnelle;
  variationEl.textContent = `${variation >= 0 ? "+" : ""}${formatMontant(variation, monnaieId)}`;
  variationEl.classList.toggle("positif", variation >= 0);
  variationEl.classList.toggle("negatif", variation < 0);
  // LE TITRE SUIT LA VUE, pas seulement le sous-texte : ce chiffre se recalcule
  // sur la période choisie, et « Variation du mois » au-dessus d'un total
  // ANNUEL ne se contentait pas d'être imprécis — il annonçait le mauvais
  // ordre de grandeur. Le titre ne nomme en revanche ni le mois ni l'année :
  // c'est le sous-texte juste dessous qui le fait, et le répéter n'ajouterait
  // qu'une ligne qui bouge.
  document.getElementById("kpi-variation-label").textContent =
    state.dashboardPeriode.vue === "annee" ? t("Variation de l'année") : t("Variation du mois");
  document.getElementById("kpi-variation-sous-texte").textContent =
    `${libellePeriode} — entrées − sorties, hors épargne`;

  renderFluxPeriode(kpis, monnaieId);
  renderHistogrammeDepenses(kpis.depenses_par_categorie, monnaieId);
}

/**
 * Entrées, sorties, différence — les trois chiffres posés sous le sélecteur de
 * période, à côté de l'histogramme qu'ils résument.
 *
 * Les trois viennent d'un SEUL calcul côté serveur (get_flux_periode) : la
 * différence n'est pas recalculée ici, sinon elle pourrait finir par ne plus
 * valoir ce que les deux autres annoncent.
 */
function renderFluxPeriode(kpis, monnaieId) {
  const entrees = kpis.total_entrees || 0;
  const sorties = kpis.total_sorties || 0;
  const difference = kpis.variation_previsionnelle || 0;
  document.getElementById("kpi-total-entrees").textContent = `+${formatMontant(
    entrees,
    monnaieId
  )}`;
  // Le signe est porté par le libellé (« sorties ») autant que par la couleur :
  // un total de sorties s'écrit en positif, c'est une somme dépensée.
  document.getElementById("kpi-total-sorties").textContent = `−${formatMontant(
    sorties,
    monnaieId
  )}`;
  const differenceEl = document.getElementById("kpi-flux-difference");
  differenceEl.textContent = `${difference >= 0 ? "+" : ""}${formatMontant(
    difference,
    monnaieId
  )}`;
  differenceEl.classList.toggle("positif", difference >= 0);
  differenceEl.classList.toggle("negatif", difference < 0);
}

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
 * NI valorisation des titres, ni "Total des avoirs" : ce camembert répartit le
 * même solde que montrent les cartes de compte (les espèces sur chacun), pas
 * la valeur du portefeuille détenu — cette dernière est déjà détaillée sur la
 * page Placements financiers, ce serait la compter deux fois que de l'ajouter
 * ici sous un habillage différent.
 *
 * DONUT PAR STROKE-DASHARRAY, pas par arcs SVG : avec trois parts seulement
 * (dont potentiellement une à 100 %), les arcs `<path>` dégénèrent aux bords
 * (un secteur plein cercle n'a pas d'arc valide). Empiler des `<circle>` avec
 * un `stroke-dasharray` proportionnel à la circonférence n'a pas ce problème,
 * quelle que soit la répartition.
 */
function renderRepartitionComptes(comptes, monnaieId) {
  const container = document.getElementById("dashboard-repartition-comptes");
  if (!monnaieId) {
    // Aucune monnaie en jeu (base sans compte) : rien à répartir.
    container.innerHTML = "";
    return;
  }

  const parts = TYPES_REPARTITION_COMPTES.map((type) => {
    const montant = comptes
      .filter((c) => type.test(c.type_nom))
      .reduce((somme, c) => {
        const solde = c.soldes.find((s) => s.monnaie_id === monnaieId);
        return somme + (solde ? solde.solde_reel : 0);
      }, 0);
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
  const segments = parts
    .filter((p) => p.montant > 0)
    .map((p) => {
      const fraction = p.montant / totalPositif;
      const longueur = fraction * circonference;
      const segment = `
        <circle
          cx="90" cy="90" r="${rayon}"
          fill="none" stroke="${p.couleur}" stroke-width="${epaisseur}"
          stroke-dasharray="${longueur} ${circonference - longueur}"
          stroke-dashoffset="${-avancement}"
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
        <li class="repartition-legende-ligne">
          <span class="repartition-pastille" style="background:${p.couleur}"></span>
          <span class="repartition-etiquette">${t(p.etiquette)}</span>
          <span class="repartition-montant ${p.montant < 0 ? "negatif" : ""}">${formatMontant(p.montant, monnaieId)}</span>
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

/**
 * Le contenu de l'infobulle d'une barre : ce qui compose le montant qu'on
 * survole, du plus lourd au plus léger.
 *
 * POURQUOI DU HTML ET PLUS UN <title> SVG. Un <title> ne porte que du texte
 * brut — ni colonne de montants alignée, ni italique pour le nombre de
 * dépenses fondues. Il apparaissait en plus avec le délai du navigateur
 * (~1 s), là où une infobulle maison suit le curseur immédiatement.
 *
 * Le nombre entre parenthèses ne s'affiche QU'À PARTIR DE DEUX : « (1) »
 * n'apprendrait rien et mettrait une parenthèse au bout de presque chaque
 * ligne, exactement là où l'œil cherche le libellé.
 */
function contenuInfobulleHistogramme(depense, monnaieId) {
  const top = depense.top_depenses || [];
  if (top.length === 0) {
    return `<div class="histo-bulle-titre">${escapeHtml(depense.categorie)}</div>
      <div class="histo-bulle-vide">${t("Aucune dépense sur la période.")}</div>`;
  }
  const lignes = top
    .map((d) => {
      // Une dépense fondue à partir de plusieurs opérations le dit ; une seule
      // reste nue (cf. DepenseTopRead.nombre).
      const compte =
        d.nombre > 1 ? ` <i class="histo-bulle-compte">(${d.nombre})</i>` : "";
      const nature = d.nature ? escapeHtml(d.nature) : `<span class="hint">${t("Sans libellé")}</span>`;
      return `<li>
        <span class="histo-bulle-nature">${nature}${compte}</span>
        <span class="histo-bulle-montant">${formatMontant(d.montant, monnaieId)}</span>
      </li>`;
    })
    .join("");
  return `<div class="histo-bulle-titre">${escapeHtml(depense.categorie)}</div>
    <ul class="histo-bulle-liste">${lignes}</ul>`;
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

function renderHistogrammeDepenses(depenses, monnaieId) {
  const container = document.getElementById("dashboard-histogramme");
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
        barrePrevisionnel = `<rect x="${x}" y="${yDepasse}" width="${largeurBarre}" height="${hDepasse}" fill="${couleur}" opacity="0.35" rx="3" />`;
        yHaut = yDepasse;
      }

      let tickBudget = "";
      if (d.budget_alloue > 0) {
        const yBudget = hauteur - margeBas - d.budget_alloue * echelle;
        // Rouge (couleur "critical", distincte de la palette catégorielle) :
        // signale une limite, pas une identité de catégorie.
        tickBudget = `<rect x="${x}" y="${yBudget - 1.5}" width="${largeurBarre}" height="3" fill="#ef4444" />`;
      }

      const label = d.categorie.length > 12 ? d.categorie.slice(0, 11) + "…" : d.categorie;

      // Zone de survol sur TOUTE LA BANDE, pas sur la seule barre : une
      // catégorie à 3 € dessine quelques pixels de haut, impossibles à viser,
      // et une catégorie à 0 n'en dessine aucun — son infobulle serait
      // inatteignable alors qu'elle a quelque chose à dire (« aucune dépense »).
      const zoneSurvol = `<rect x="${margeCote + largeurBande * i}" y="${margeHaut}" width="${largeurBande}" height="${hauteur - margeBas - margeHaut}" fill="transparent" />`;

      return `
        <g data-index="${i}">
          ${zoneSurvol}
          <rect x="${x}" y="${yReel}" width="${largeurBarre}" height="${hReel}" fill="${couleur}" rx="3" />
          ${barrePrevisionnel}
          ${tickBudget}
          <text x="${centreX}" y="${hauteur - margeBas + 18}" text-anchor="middle" font-size="11" fill="#9ea3b0">${label}</text>
          <text x="${centreX}" y="${yHaut - 6}" text-anchor="middle" font-size="10" fill="#e7e8ec">${d.total_previsionnel.toFixed(0)}</text>
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

  // Une seule bulle réutilisée par toutes les barres, posée dans le conteneur
  // (positionné en relatif) : la créer à chaque survol la ferait réapparaître
  // sans transition, et une bulle par barre encombrerait le DOM pour rien.
  const bulle = document.createElement("div");
  bulle.className = "histo-bulle";
  bulle.setAttribute("role", "tooltip");
  container.appendChild(bulle);

  container.querySelectorAll("svg g[data-index]").forEach((groupe) => {
    const depense = depenses[Number(groupe.dataset.index)];
    groupe.addEventListener("mouseenter", (e) => {
      bulle.innerHTML = contenuInfobulleHistogramme(depense, monnaieId);
      bulle.classList.add("visible");
      placerInfobulleHistogramme(bulle, container, e);
    });
    groupe.addEventListener("mousemove", (e) => {
      placerInfobulleHistogramme(bulle, container, e);
    });
    groupe.addEventListener("mouseleave", () => {
      bulle.classList.remove("visible");
    });
  });
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


/* ---------- Comptes ---------- */

/**
 * Double-clic sur une ligne pour l'éditer, comme sur la page Opérations : le
 * geste est le même partout, plutôt que d'obliger à viser le bouton "Modifier".
 *
 * Les lignes visées portent leur id dans `data-id` ; les clics sur les boutons
 * d'action sont exclus, pour ne pas ouvrir l'édition en même temps qu'on
 * supprime.
 */
function activerEditionDoubleClic(conteneur, onEdit) {
  conteneur.querySelectorAll("tr[data-id], .import-mapping-row[data-id]").forEach((ligne) => {
    ligne.addEventListener("dblclick", (e) => {
      if (e.target.closest("button") || e.target.closest("input, select")) return;
      onEdit(Number(ligne.dataset.id));
    });
  });
}

/**
 * Une ligne par monnaie de l'app : une case pour l'attacher au compte, et son
 * solde de départ dans cette monnaie. Un compte multi-devises a bien deux
 * soldes initiaux, un champ unique ne pouvait pas dire lequel.
 *
 * `selection` : [{monnaie_id, solde_initial}] dans l'ordre voulu — le premier
 * coché est la monnaie proposée par défaut à la saisie d'une opération.
 */
function renderCompteMonnaies(selection = []) {
  const bloc = document.getElementById("compte-monnaies");
  bloc.innerHTML = "";
  if (state.monnaies.length === 0) {
    bloc.innerHTML =
      '<span class="hint">Aucune monnaie : crée-en une dans l\'onglet Monnaies.</span>';
    return;
  }
  const parId = Object.fromEntries(selection.map((s) => [s.monnaie_id, s.solde_initial]));
  state.monnaies.forEach((monnaie) => {
    const choisie = monnaie.id in parId;
    const row = document.createElement("div");
    row.className = "import-mapping-row";
    row.dataset.monnaieId = monnaie.id;
    row.innerHTML = `
      <input type="checkbox" data-role="choisie" ${choisie ? "checked" : ""} />
      <span class="import-mapping-nom">${escapeHtml(monnaie.nom)} (${escapeHtml(monnaie.symbole)})</span>
      <input type="number" step="0.01" data-role="solde-initial"
             title="${t("Solde initial dans cette monnaie")}"
             value="${choisie ? parId[monnaie.id] : 0}" ${choisie ? "" : "disabled"} />
    `;
    const caseChoisie = row.querySelector("input[data-role='choisie']");
    const champSolde = row.querySelector("input[data-role='solde-initial']");
    caseChoisie.addEventListener("change", () => {
      champSolde.disabled = !caseChoisie.checked;
    });
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
    }));
}

function resetCompteForm() {
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

function fillCompteForm(compte) {
  document.getElementById("compte-id").value = compte.id;
  document.getElementById("compte-nom").value = compte.nom;
  document.getElementById("compte-type").value = compte.type_id;
  renderCompteMonnaies(
    compte.monnaies.map((m) => ({ monnaie_id: m.monnaie_id, solde_initial: m.solde_initial }))
  );
  document.getElementById("form-compte-titre").textContent = `Modifier "${compte.nom}"`;
  document.getElementById("compte-annuler").style.display = "inline-block";
}

function renderTypesComptes() {
  const bloc = document.getElementById("types-comptes-liste");
  bloc.innerHTML = "";
  // `type` et non `t` : `t` est la fonction de traduction, et une variable de
  // boucle du même nom la masquait — l'appel à t() plus bas levait alors
  // « t is not a function » dès qu'un type non protégé s'affichait.
  state.typesComptes.forEach((type) => {
    const row = document.createElement("div");
    row.className = "import-mapping-row";
    const badge = type.systeme
      ? ` <span class="badge-partiel">${t("Protégé")}</span>`
      : "";
    const supprimer = type.systeme
      ? ""
      : `<button type="button" data-action="supprimer-type-compte" data-id="${type.id}" class="danger">${t("Supprimer")}</button>`;
    row.innerHTML = `
      <span class="import-mapping-nom">${typeLabel(type.nom)}${badge}</span>
      ${supprimer}
    `;
    bloc.appendChild(row);
  });
  bloc.querySelectorAll("button[data-action='supprimer-type-compte']").forEach((btn) => {
    btn.addEventListener("click", async () => {
      if (!confirm(t("Supprimer ce type de compte ?"))) return;
      try {
        await apiFetch(`/types-comptes/${btn.dataset.id}`, { method: "DELETE" });
        showMessage(t("Type de compte supprimé"), "success");
        await refreshTypesComptes();
        renderTypesComptes();
      } catch (err) {
        showMessage(err.message, "error");
      }
    });
  });
}

document.getElementById("form-type-compte").addEventListener("submit", async (e) => {
  e.preventDefault();
  const nomInput = document.getElementById("type-compte-nom");
  try {
    await apiFetch("/types-comptes", {
      method: "POST",
      body: JSON.stringify({ nom: nomInput.value }),
    });
    nomInput.value = "";
    showMessage(t("Type de compte créé"), "success");
    await refreshTypesComptes();
    renderTypesComptes();
  } catch (err) {
    showMessage(err.message, "error");
  }
});

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
    await refreshTypesComptes();
    renderTypesComptes();
    resetCompteForm();

    const conteneur = document.getElementById("comptes-liste");
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
    remplirSelecteursVerifSolde();
  } catch (err) {
    showMessage(err.message, "error");
  }
}

function construireLigneCompte(compte) {
  const ligne = document.createElement("div");
  ligne.className = "import-mapping-row";
  ligne.draggable = true;
  ligne.dataset.id = compte.id;
  ligne.innerHTML = `
    <span class="drag-handle" title="${t("Glisser pour réordonner, ou vers une autre carte pour changer de type")}">⠿</span>
    <span class="import-mapping-nom">${escapeHtml(compte.nom)}</span>
    <span class="compte-ligne-monnaies">${compte.monnaies
      .map((m) => escapeHtml(m.monnaie_symbole))
      .join(" · ")}</span>
    <span class="compte-ligne-solde">${compte.monnaies
      .map((m) => formatMontant(m.solde_initial, m.monnaie_id))
      .join(" · ")}</span>
    <button type="button" data-action="edit" data-id="${compte.id}">${t("Modifier")}</button>
    <button type="button" data-action="delete" data-id="${compte.id}" class="danger">${t("Supprimer")}</button>
  `;
  return ligne;
}

/* ----- Vérification d'un solde (diagnostic d'écart avec la banque) -----
 *
 * Le solde d'un compte dans l'app est une reconstruction ; le relevé, lui, est
 * la vérité. Quand les deux divergent, l'app ne peut pas dire ce qui manque,
 * mais elle peut dire ce qui COLLERAIT — voir services/ecarts.py, qui porte
 * tout le raisonnement. Ici, rien que de l'affichage.
 *
 * Aucune persistance : le solde saisi part dans une requête et n'est écrit
 * nulle part. C'est un outil qu'on rejoue autant de fois qu'on veut.
 */

// Libellé de chaque famille de piste. La puce dit ce qu'il faut ALLER
// VÉRIFIER, pas le nom technique du cas — c'est ce que l'utilisateur cherche.
const LIBELLES_PISTE_ECART = {
  operation_en_trop: "Opération en trop",
  signe_inverse: "Sens inversé",
  previsionnelle_a_pointer: "Échéance non pointée",
  combinaison: "Combinaison",
};

// Les quatre valeurs de constants.Sens côté serveur. Les deux premières sont
// déjà des mots français (c'est l'enum qui est écrit ainsi) : la table sert à
// nommer les deux transferts, et à donner à `t()` des clés stables.
const LIBELLE_SENS = {
  "dépense": "sortie",
  "entrée": "entrée",
  transfert_sortant: "virement émis",
  transfert_entrant: "virement reçu",
};

// Sens qui AUGMENTENT le solde (cf. services/soldes._solde_delta).
const SENS_POSITIFS = new Set(["entrée", "transfert_entrant"]);

function remplirSelecteursVerifSolde() {
  const selCompte = document.getElementById("verif-solde-compte");
  const precedent = selCompte.value;
  selCompte.innerHTML = state.comptes
    .map((c) => `<option value="${c.id}">${escapeHtml(c.nom)}</option>`)
    .join("");
  if (precedent && state.comptes.some((c) => String(c.id) === precedent)) {
    selCompte.value = precedent;
  }
  remplirMonnaiesVerifSolde();
}

/**
 * Les monnaies proposées sont celles DU COMPTE choisi, et pas toutes celles de
 * l'app : un compte a un solde par monnaie, et diagnostiquer un écart en
 * dollars sur un compte qui n'en porte pas comparerait un relevé à un solde
 * qui n'existe pas (le serveur le refuse, autant ne pas le proposer).
 */
function remplirMonnaiesVerifSolde() {
  const compte = state.comptes.find(
    (c) => String(c.id) === document.getElementById("verif-solde-compte").value
  );
  const selMonnaie = document.getElementById("verif-solde-monnaie");
  const monnaies = compte ? compte.monnaies : [];
  selMonnaie.innerHTML = monnaies
    .map(
      (m) =>
        `<option value="${m.monnaie_id}">${escapeHtml(m.monnaie_nom)} (${escapeHtml(m.monnaie_symbole)})</option>`
    )
    .join("");
  // Un compte mono-monnaie n'a rien à choisir : le sélecteur ne ferait que
  // demander de confirmer la seule réponse possible.
  selMonnaie.closest("label").style.display = monnaies.length > 1 ? "" : "none";
}

document.getElementById("verif-solde-compte").addEventListener("change", () => {
  remplirMonnaiesVerifSolde();
  document.getElementById("verif-solde-resultat").style.display = "none";
});

document.getElementById("btn-verif-solde").addEventListener("click", async () => {
  const compteId = document.getElementById("verif-solde-compte").value;
  const monnaieId = document.getElementById("verif-solde-monnaie").value;
  const montant = document.getElementById("verif-solde-montant").value;
  const dateFin = document.getElementById("verif-solde-date").value;
  if (!compteId || !monnaieId) return;
  if (montant === "") {
    showMessage(t("Saisis le solde lu sur ton relevé."), "error");
    return;
  }
  try {
    const diagnostic = await apiFetch(`/comptes/${compteId}/diagnostic-ecart`, {
      method: "POST",
      body: JSON.stringify({
        monnaie_id: Number(monnaieId),
        solde_banque: Number(montant),
        date_fin: dateFin || null,
      }),
    });
    renderDiagnosticEcart(diagnostic);
  } catch (err) {
    showMessage(err.message, "error");
  }
});

function renderDiagnosticEcart(d) {
  const bloc = document.getElementById("verif-solde-resultat");
  bloc.style.display = "";

  const ecartClasse = d.ecart === 0 ? "positif" : "negatif";
  const entete = `
    <div class="verif-solde-bilan">
      <div>
        <div class="kpi-label">${t("Solde dans l'app")}</div>
        <div class="kpi-valeur">${formatMontant(d.solde_app, d.monnaie_id)}</div>
      </div>
      <div>
        <div class="kpi-label">${t("Solde à la banque")}</div>
        <div class="kpi-valeur">${formatMontant(d.solde_banque, d.monnaie_id)}</div>
      </div>
      <div>
        <div class="kpi-label">${t("Écart")}</div>
        <div class="kpi-valeur ${ecartClasse}">${formatMontant(d.ecart, d.monnaie_id)}</div>
      </div>
    </div>
  `;

  if (d.ecart === 0) {
    bloc.innerHTML =
      entete +
      `<p class="import-avertissement verif-solde-ok">${t("Aucun écart : le solde de l'app correspond exactement au relevé.")}</p>`;
    return;
  }

  // Le sens de l'écart dit déjà dans quelle direction chercher, avant même de
  // regarder les pistes : c'est souvent tout ce dont on a besoin.
  const sens =
    d.ecart > 0
      ? t("La banque a plus que l'app : il manque une entrée, ou l'app porte une sortie de trop.")
      : t("La banque a moins que l'app : il manque une sortie, ou l'app porte une entrée de trop.");

  let html = entete + `<p class="hint">${sens}</p>`;

  if (d.pistes.length === 0) {
    html += `<p class="import-avertissement">${t(
      "Aucune combinaison d'au plus trois opérations n'explique cet écart. L'erreur vient peut-être du solde initial du compte, d'une opération d'un autre compte, ou de plusieurs causes à la fois."
    )}</p>`;
  } else {
    html += `<p class="hint">${t("{n} piste(s) trouvée(s) sur {total} opération(s) analysée(s), la plus simple d'abord. À vérifier — l'app ne peut pas savoir laquelle est la bonne.", {
      n: d.pistes.length,
      total: d.nb_operations_analysees,
    })}</p>`;
    html += '<ul class="verif-solde-pistes">';
    d.pistes.forEach((piste) => {
      const operations = piste.operations
        .map(
          (op) => `
          <li class="verif-solde-operation">
            <span class="verif-solde-op-date">${formatDate(op.date)}</span>
            <span class="verif-solde-op-nature">${escapeHtml(op.nature)}</span>
            <span class="verif-solde-op-montant ${SENS_POSITIFS.has(op.sens) ? "positif" : "negatif"}">
              ${formatMontant(op.montant, d.monnaie_id)}
            </span>
            <span class="verif-solde-op-sens">${t(LIBELLE_SENS[op.sens] || op.sens)}</span>
          </li>`
        )
        .join("");
      html += `
        <li class="verif-solde-piste">
          <span class="badge-partiel">${t(LIBELLES_PISTE_ECART[piste.type] || piste.type)}</span>
          <span class="verif-solde-explication">${t(piste.explication)}</span>
          <ul class="verif-solde-operations">${operations}</ul>
        </li>
      `;
    });
    html += "</ul>";
  }

  if (d.tronque) {
    html += `<p class="hint">${t("D'autres pistes du même genre existent : seules les premières sont affichées.")}</p>`;
  }
  if (d.triplets_abandonnes) {
    html += `<p class="hint">${t("Ce compte porte trop d'opérations pour chercher des combinaisons de trois : seules celles d'une ou deux opérations ont été testées.")}</p>`;
  }
  bloc.innerHTML = html;
}

function cablerActionsComptes(conteneur) {
  activerEditionDoubleClic(conteneur, (id) => {
    const compte = state.comptes.find((c) => c.id === id);
    if (compte) fillCompteForm(compte);
  });

  conteneur.querySelectorAll("button[data-action='edit']").forEach((btn) => {
    btn.addEventListener("click", () => {
      const compte = state.comptes.find((c) => c.id === Number(btn.dataset.id));
      fillCompteForm(compte);
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
      e.preventDefault();
      const dragging = conteneur.querySelector(`${selecteurLigne}.dragging`);
      if (!dragging) return;
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

/* ---------- Catégories ---------- */

function resetCategorieForm() {
  document.getElementById("categorie-id").value = "";
  document.getElementById("categorie-nom").value = "";
  document.getElementById("categorie-nom").disabled = false;
  document.getElementById("categorie-budget-bloc").style.display = "none";
  document.getElementById("categorie-budget-hint").style.display = "none";
  document.getElementById("categorie-budget").value = "0";
  document.getElementById("form-categorie-titre").textContent = "Ajouter une catégorie";
  document.getElementById("categorie-annuler").style.display = "none";
}

function fillCategorieForm(categorie, budget) {
  const moisLabel = libelleMois(state.categoriesPeriode.annee, state.categoriesPeriode.mois);
  const monnaie = monnaieParId(state.categoriesMonnaieId);
  document.getElementById("categorie-id").value = categorie.id;
  document.getElementById("categorie-nom").value = categorie.nom;
  document.getElementById("categorie-nom").disabled = true;
  document.getElementById("categorie-budget-bloc").style.display = "";
  document.getElementById("categorie-budget-label").textContent = monnaie
    ? `Budget pour ${moisLabel} (${monnaie.symbole})`
    : `Budget pour ${moisLabel}`;
  document.getElementById("categorie-budget").value = budget.montant;
  const hint = document.getElementById("categorie-budget-hint");
  if (budget.explicite) {
    hint.style.display = "none";
  } else {
    hint.textContent = `Valeur héritée d'un mois précédent — enregistrer définit une valeur propre à ${moisLabel}.`;
    hint.style.display = "block";
  }
  document.getElementById("form-categorie-titre").textContent = `Modifier le budget de "${categorie.nom}"`;
  document.getElementById("categorie-annuler").style.display = "inline-block";
}

function renderOngletsMonnaiesCategories() {
  renderOngletsMonnaies(
    "categories-monnaies",
    state.monnaies,
    state.categoriesMonnaieId,
    (monnaieId) => {
      state.categoriesMonnaieId = monnaieId;
      // Le formulaire édite le budget d'une monnaie précise : le laisser
      // ouvert après un changement d'onglet enregistrerait la valeur sur la
      // mauvaise.
      resetCategorieForm();
      renderOngletsMonnaiesCategories();
      loadCategoriesBudgets(state.categoriesPeriode.annee, state.categoriesPeriode.mois);
    }
  );
}

async function loadCategories() {
  try {
    await refreshMonnaies();
    await refreshCategories();
    // Le budget est propre à une monnaie : l'onglet choisit laquelle, et
    // recharge la colonne Budget sans toucher au mois sélectionné.
    renderOngletsMonnaiesCategories();
    await initPeriodeSelector(
      document.getElementById("categories-periode-annees"),
      document.getElementById("categories-periode-mois"),
      state.categoriesPeriode,
      loadCategoriesBudgets
    );
  } catch (err) {
    showMessage(err.message, "error");
  }
}

async function loadCategoriesBudgets(annee, mois) {
  if (!state.categoriesMonnaieId) return;
  try {
    const budgets = await apiFetch(
      `/categories/budgets?annee=${annee}&mois=${mois}&monnaie_id=${state.categoriesMonnaieId}`
    );
    const budgetParId = Object.fromEntries(budgets.map((b) => [b.categorie_id, b]));
    const moisLabel = libelleMois(annee, mois);
    document.getElementById("categories-budget-entete").textContent = `Budget (${moisLabel})`;

    const gerables = state.categories;
    const body = document.getElementById("categories-liste");
    body.innerHTML = "";
    gerables.forEach((c) => {
      const budget = budgetParId[c.id] || { montant: 0, explicite: false };
      const budgetTexte = formatMontant(budget.montant, state.categoriesMonnaieId);
      const tr = document.createElement("tr");
      tr.draggable = true;
      tr.dataset.id = c.id;
      const deleteAction =
        c.nom === CATEGORIE_AUTRES
          ? ''
          : `<button data-action="delete" data-id="${c.id}" class="danger">${t("Supprimer")}</button>`;
      // Même œil que la configuration d'import : ici il ne décide que de la
      // présence de la catégorie dans l'histogramme du dashboard. Rien d'autre
      // ne change — les opérations restent classées, le budget reste défini.
      const visible = c.visible_dashboard !== false;
      tr.innerHTML = `
        <td class="drag-handle" title="${t("Glisser pour réordonner")}">⠿</td>
        <td>${c.nom}</td>
        <td>${budgetTexte}</td>
        <td>
          <button type="button" class="bouton-oeil" data-action="visibilite" data-id="${c.id}"
                  title="${visible ? "Ne plus afficher sur le dashboard" : "Afficher sur le dashboard"}"
                  aria-label="${visible ? "Masquer" : "Afficher"} « ${escapeHtml(c.nom)} » sur le dashboard"
                  aria-pressed="${visible}">${visible ? ICONE_OEIL : ICONE_OEIL_BARRE}</button>
        </td>
        <td>
          <button data-action="edit" data-id="${c.id}">${t("Modifier")}</button>
          ${deleteAction}
        </td>
      `;
      body.appendChild(tr);
    });

    const editerCategorie = (id) => {
      const categorie = state.categories.find((c) => c.id === id);
      if (!categorie) return;
      fillCategorieForm(categorie, budgetParId[id] || { montant: 0, explicite: false });
    };
    activerEditionDoubleClic(body, editerCategorie);

    body.querySelectorAll("button[data-action='edit']").forEach((btn) => {
      btn.addEventListener("click", () => editerCategorie(Number(btn.dataset.id)));
    });

    body.querySelectorAll("button[data-action='visibilite']").forEach((btn) => {
      btn.addEventListener("click", async (e) => {
        // Le double-clic sur la ligne ouvre l'édition du budget : sans ça,
        // basculer l'œil deux fois de suite ouvrirait le formulaire par-dessus.
        e.stopPropagation();
        const categorie = state.categories.find((c) => c.id === Number(btn.dataset.id));
        if (!categorie) return;
        try {
          await apiFetch(`/categories/${categorie.id}/visibilite`, {
            method: "PUT",
            body: JSON.stringify({
              visible_dashboard: categorie.visible_dashboard === false,
            }),
          });
          await refreshCategories();
          await loadCategoriesBudgets(annee, mois);
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
  } catch (err) {
    showMessage(err.message, "error");
  }
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
      const montant = parseFloat(document.getElementById("categorie-budget").value || "0");
      const { annee, mois } = state.categoriesPeriode;
      await apiFetch(
        `/categories/${id}/budget?annee=${annee}&mois=${mois}&monnaie_id=${state.categoriesMonnaieId}`,
        {
          method: "PUT",
          body: JSON.stringify({ montant }),
        }
      );
      showMessage(t("Budget modifié"), "success");
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

function comptesEligibles(type) {
  // Seul un virement interne peut toucher l'épargne et les comptes-titres :
  // sur ces comptes, l'argent n'arrive et ne repart pas autrement (cf.
  // routers/operations._valider_compte_operations_libres).
  if (type === "virement") return state.comptes;
  return state.comptes.filter((c) => !TYPES_COMPTE_HORS_COURANT.has(c.type_nom));
}

function categoriesEligibles(type) {
  return TYPES_CATEGORIE_LIBRE.has(type) ? state.categories : [];
}

function compteParId(compteId) {
  return state.comptes.find((c) => c.id === compteId) || null;
}

// Les monnaies d'un compte, dans l'ordre du compte : la première est celle
// proposée par défaut.
function monnaiesDuCompte(compteId) {
  const compte = compteParId(compteId);
  return compte ? compte.monnaies : [];
}

/**
 * Remplit un menu de monnaies avec celles du compte choisi, et affiche son bloc
 * seulement si le choix existe vraiment : sur un compte mono-monnaie il n'y a
 * rien à demander, la monnaie est déduite. Renvoie l'id retenu.
 */
function syncSelectMonnaieCompte(selectId, blocId, compteId, { forcerAffichage = false } = {}) {
  const select = document.getElementById(selectId);
  const monnaies = monnaiesDuCompte(compteId);
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

function _refillPreservingSelection(selectEl, fillFn) {
  const previous = selectEl.value;
  fillFn(selectEl);
  if (previous && [...selectEl.options].some((o) => o.value === previous)) {
    selectEl.value = previous;
  }
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
  document.getElementById("operation-categorie-bloc").style.display =
    TYPES_CATEGORIE_LIBRE.has(type) ? "" : "none";
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

  document.getElementById("operation-montant-du-bloc").style.display = estRemboursable ? "" : "none";
  document.getElementById("operation-montant-a-rembourser-bloc").style.display =
    estRemboursable && enEdition ? "" : "none";
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

  if (estVirement) {
    _refillPreservingSelection(document.getElementById("operation-compte1"), (el) =>
      fillComptesSelect(el, comptesEligibles(type))
    );
    _refillPreservingSelection(document.getElementById("operation-compte2"), (el) =>
      fillComptesSelect(el, comptesEligibles(type))
    );
  } else {
    _refillPreservingSelection(document.getElementById("operation-compte"), (el) =>
      fillComptesSelect(el, comptesEligibles(type))
    );
    if (TYPES_CATEGORIE_LIBRE.has(type)) {
      _refillPreservingSelection(document.getElementById("operation-categorie"), (el) =>
        fillCategoriesSelect(el, categoriesEligibles(type))
      );
    }
  }

  updateOperationMonnaieFields();

  if (!estRemboursable) {
    document.getElementById("operation-rembourse-info").style.display = "none";
  }
  if (estReglement) {
    const id = Number(document.getElementById("operation-id").value) || null;
    populateRemboursementsChecklist({}, id, type);
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
function updateOperationMonnaieFields() {
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
      Number(document.getElementById("operation-compte").value)
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
    { forcerAffichage: true }
  );
  const monnaieDestination = syncSelectMonnaieCompte(
    "operation-monnaie-recue",
    "operation-monnaie-recue-bloc",
    compteDestinationId,
    { forcerAffichage: true }
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
["operation-compte", "operation-compte1", "operation-compte2"].forEach((id) => {
  document.getElementById(id).addEventListener("change", updateOperationMonnaieFields);
});
["operation-monnaie", "operation-monnaie-recue"].forEach((id) => {
  document.getElementById(id).addEventListener("change", updateOperationMonnaieFields);
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

function syncMontantDuSiAuto() {
  const type = document.getElementById("operation-type").value;
  const enEdition = !!document.getElementById("operation-id").value;
  if (montantDuAutoSync && type === "remboursable" && !enEdition) {
    document.getElementById("operation-montant-du").value =
      document.getElementById("operation-montant").value || "0";
  }
}

document.getElementById("operation-montant").addEventListener("input", syncMontantDuSiAuto);
document.getElementById("operation-montant-du").addEventListener("input", () => {
  montantDuAutoSync = false;
});

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
  // Les notes n'existent qu'à l'édition : une création repart sans champ.
  document.getElementById("operation-notes").value = "";
  document.getElementById("operation-notes-bloc").style.display = "none";
  document.getElementById("form-operation-titre").textContent = "Ajouter une opération";
  document.getElementById("operation-annuler").style.display = "none";
  montantDuAutoSync = true;
  operationEditionEstOccurrenceGeneree = false;
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
  setOperationType("classique");
}

async function fillOperationForm(op) {
  // Le type est porte par l'operation (OperationRead.type_code) : plus aucune
  // deduction depuis la categorie et le booleen `remboursable`.
  const type = op.type_code;

  document.getElementById("operation-id").value = op.id;
  montantDuAutoSync = false;
  operationEditionEstOccurrenceGeneree = op.recurrence_parent_id != null;
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
  // la recalculer maintenant que leurs vraies valeurs sont connues.
  updateOperationTypeFields();

  document.getElementById("operation-date").value = op.date;
  document.getElementById("operation-compte").value = op.compte_id;
  // Après le compte : les monnaies proposées sont celles de CE compte.
  updateOperationMonnaieFields();
  document.getElementById("operation-monnaie").value = op.monnaie_id;
  if (TYPES_CATEGORIE_LIBRE.has(type)) {
    document.getElementById("operation-categorie").value = op.categorie_id;
  }
  document.getElementById("operation-nature").value = op.nature;
  document.getElementById("operation-montant").value = op.montant;
  document.getElementById("operation-statut").value = op.statut;
  document.getElementById("operation-montant-du").value = op.montant_du;
  document.getElementById("operation-montant-a-rembourser").value = op.montant_a_rembourser;

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
  if (type === "remboursable" && estLie) {
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
async function populateRemboursementsChecklist(preselection, excludeOperationId, typeReglement) {
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
    recalculerMontantRemboursement();
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

function buildOperationsQuery() {
  const params = new URLSearchParams();
  const compte = document.getElementById("filtre-compte").value;
  const categorieId = document.getElementById("filtre-categorie").value;
  const statut = document.getElementById("filtre-statut").value;
  const dateDebut = document.getElementById("filtre-date-debut").value;
  const dateFin = document.getElementById("filtre-date-fin").value;
  if (compte) params.set("compte_id", compte);
  if (categorieId) params.set("categorie_id", categorieId);
  if (statut) params.set("statut", statut);
  if (dateDebut) params.set("date_debut", dateDebut);
  if (dateFin) params.set("date_fin", dateFin);
  return params.toString();
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
    // Virement importé dont le second compte est resté inconnu : il n'y a
    // qu'une écriture, la paire n'existe pas.
    showMessage(t("Ce virement n'a qu'une écriture (second compte inconnu à l'import) : ") +
        "supprime-la et recrée le virement avec ses deux comptes.",
      "error"
    );
    return;
  }

  resetOperationForm();
  ouvrirFormulaireOperation("virements", tr);
  virementEnEdition = virementId;
  setOperationType("virement");

  document.getElementById("operation-date").value = sortante.date;
  document.getElementById("operation-nature").value = sortante.nature;
  document.getElementById("operation-statut").value = sortante.statut;
  document.getElementById("operation-compte1").value = sortante.compte_id;
  document.getElementById("operation-compte2").value = entrante.compte_id;
  // Après les comptes : les monnaies proposées sont celles de CES comptes.
  updateOperationMonnaieFields();
  document.getElementById("operation-monnaie").value = sortante.monnaie_id;
  document.getElementById("operation-monnaie-recue").value = entrante.monnaie_id;
  updateOperationMonnaieFields();
  document.getElementById("operation-montant").value = sortante.montant;
  document.getElementById("operation-montant-recu").value = entrante.montant;
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

function renderClassiques(liste) {
  const construireLigne = (op) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${op.nature}</td>
      <td>${montantHtml(op.montant, op.sens, op.monnaie_id)}</td>
      <td>${nomCompte(op.compte_id)}</td>
      <td>${nomCategorie(op.categorie_id)}</td>
      <td>${statutLabel(op.statut)}</td>
      <td>
        <button data-action="edit" data-id="${op.id}">${t("Modifier")}</button>
        <button data-action="delete" data-id="${op.id}" class="danger">${t("Supprimer")}</button>
      </td>
    `;
    return tr;
  };
  const ponctuelles = liste.filter((o) => !o.recurrente);
  const recurrentes = liste.filter((o) => o.recurrente);
  remplirListeOperations("liste-classique-ponctuelles", ponctuelles, construireLigne);
  remplirListeOperations("liste-classique-recurrentes", recurrentes, construireLigne);
  toggleSousSection("operations-bloc-classique-ponctuelles", ponctuelles.length);
  toggleSousSection("operations-bloc-classique-recurrentes", recurrentes.length);
}

function renderRemboursables(liste) {
  const construireLigne = (op) => {
    const { cellHtml, rowClass } = resteCellEtRowClass(
      op.montant_du,
      op.montant_a_rembourser,
      op.monnaie_id
    );
    const tr = document.createElement("tr");
    if (rowClass) tr.className = rowClass;
    tr.innerHTML = `
      <td>${op.nature}</td>
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
    return tr;
  };
  const ponctuelles = liste.filter((o) => !o.recurrente);
  const recurrentes = liste.filter((o) => o.recurrente);
  remplirListeOperations("liste-remboursable-ponctuelles", ponctuelles, construireLigne);
  remplirListeOperations("liste-remboursable-recurrentes", recurrentes, construireLigne);
  toggleSousSection("operations-bloc-remboursable-ponctuelles", ponctuelles.length);
  toggleSousSection("operations-bloc-remboursable-recurrentes", recurrentes.length);
}

function renderRemboursements(liste) {
  const construireLigne = (op) => {
    const couvre =
      (op.operations_remboursees || [])
        .map((o) => `${o.nature} (${formatMontant(o.montant_lien, op.monnaie_id)})`)
        .join(", ") || "-";
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${op.nature}</td>
      <td>${montantHtml(op.montant, op.sens, op.monnaie_id)}</td>
      <td>${nomCompte(op.compte_id)}</td>
      <td>${couvre}</td>
      <td>
        <button data-action="edit" data-id="${op.id}">${t("Modifier")}</button>
        <button data-action="delete" data-id="${op.id}" class="danger">${t("Supprimer")}</button>
      </td>
    `;
    return tr;
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
      <td>${reference.nature}</td>
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
  const construireLigne = (op) => {
    const { cellHtml, rowClass } = resteCellEtRowClass(
      op.montant_du,
      op.montant_a_rembourser,
      op.monnaie_id
    );
    const tr = document.createElement("tr");
    if (rowClass) tr.className = rowClass;
    tr.innerHTML = `
      <td>${op.nature}</td>
      <td>${montantHtml(op.montant, op.sens, op.monnaie_id)}</td>
      <td>${nomCompte(op.compte_id)}</td>
      <td>${cellHtml}</td>
      <td>
        <button data-action="edit" data-id="${op.id}">${t("Modifier")}</button>
        <button data-action="delete" data-id="${op.id}" class="danger">${t("Supprimer")}</button>
      </td>
    `;
    return tr;
  };
  const ponctuelles = liste.filter((o) => !o.recurrente);
  const recurrentes = liste.filter((o) => o.recurrente);
  remplirListeOperations("liste-prets-ponctuelles", ponctuelles, construireLigne);
  remplirListeOperations("liste-prets-recurrentes", recurrentes, construireLigne);
  toggleSousSection("operations-bloc-prets-ponctuelles", ponctuelles.length);
  toggleSousSection("operations-bloc-prets-recurrentes", recurrentes.length);
}

function renderRemboursementPrets(liste) {
  const construireLigne = (op) => {
    const couvre =
      (op.operations_remboursees || [])
        .map((o) => `${o.nature} (${formatMontant(o.montant_lien, op.monnaie_id)})`)
        .join(", ") || "-";
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${op.nature}</td>
      <td>${montantHtml(op.montant, op.sens, op.monnaie_id)}</td>
      <td>${nomCompte(op.compte_id)}</td>
      <td>${couvre}</td>
      <td>
        <button data-action="edit" data-id="${op.id}">${t("Modifier")}</button>
        <button data-action="delete" data-id="${op.id}" class="danger">${t("Supprimer")}</button>
      </td>
    `;
    return tr;
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
const operationsPeriode = { annee: null, mois: null, vue: "mois" };

function operationDansPeriode(op) {
  if (!operationsPeriode.annee) return true;
  const [annee, mois] = op.date.split("-").map(Number);
  if (annee !== operationsPeriode.annee) return false;
  return operationsPeriode.vue === "annee" || mois === operationsPeriode.mois;
}

function trierEtRerender(onglet) {
  const critere = state.triSelections[onglet];
  let liste;
  if (onglet === "virements") {
    liste = operationsParOnglet[onglet].filter(([, { sortante, entrante }]) =>
      operationDansPeriode(sortante || entrante)
    );
    const base = comparateurOperation(critere);
    // Une paire "solo" (virement importé sans second compte connu, cf.
    // loadOperations) n'a que sortante OU entrante : trier sur celle des
    // deux qui existe plutôt que sur sortante uniquement.
    liste.sort((a, b) => base(a[1].sortante || a[1].entrante, b[1].sortante || b[1].entrante));
  } else {
    liste = operationsParOnglet[onglet].filter(operationDansPeriode);
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

function renderSelecteursPeriodeOperations() {
  const annees = [...new Set(periodesOperations.map((p) => p.annee))].sort((a, b) => b - a);
  const moisDispo = moisDisponiblesOperations(operationsPeriode.annee);

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
    annees.forEach((a) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = a;
      if (a === operationsPeriode.annee) btn.classList.add("active");
      btn.addEventListener("click", () => {
        operationsPeriode.annee = a;
        const dispo = moisDisponiblesOperations(a);
        if (!dispo.includes(operationsPeriode.mois)) {
          operationsPeriode.mois = dispo[dispo.length - 1];
        }
        appliquerPeriodeOperations();
      });
      elAnnees.appendChild(btn);
    });

    elMois.innerHTML = "";
    moisDispo.forEach((m) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = MOIS_COURTS_FR[m - 1];
      if (m === operationsPeriode.mois) btn.classList.add("active");
      btn.addEventListener("click", () => {
        operationsPeriode.mois = m;
        // Cliquer un mois grisé (vue année) redescend au mois : c'est le geste
        // naturel pour désigner celui qu'on veut voir.
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
    updateOperationTypeFields();
    const query = buildOperationsQuery();
    operationsCache = await apiFetch(`/operations${query ? "?" + query : ""}`);

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
      const payload = {
        date: document.getElementById("operation-date").value,
        compte_source_id: Number(document.getElementById("operation-compte1").value),
        compte_destination_id: Number(document.getElementById("operation-compte2").value),
        montant,
        monnaie_id: monnaieSource,
        monnaie_destination_id: monnaieDestination,
        montant_destination:
          monnaieSource === monnaieDestination ? montant : parseFloat(montantRecuSaisi),
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
      const payload = {
        date: document.getElementById("operation-date").value,
        compte_id: Number(document.getElementById("operation-compte").value),
        monnaie_id: Number(document.getElementById("operation-monnaie").value),
        type_id: idTypeOperation("pret"),
        nature,
        montant: parseFloat(document.getElementById("operation-montant").value),
        statut: "réel",
        ...champNotes,
        ...recurrencePayload(),
        ...amortissementPayload(),
      };
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
      const categorieId = Number(document.getElementById("operation-categorie").value);
      const payload = {
        date: document.getElementById("operation-date").value,
        compte_id: Number(document.getElementById("operation-compte").value),
        monnaie_id: Number(document.getElementById("operation-monnaie").value),
        type_id: idTypeOperation(type),
        categorie_id: categorieId,
        nature,
        montant: parseFloat(document.getElementById("operation-montant").value),
        statut: document.getElementById("operation-statut").value,
        ...champNotes,
        ...recurrencePayload(),
        ...amortissementPayload(),
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

document.getElementById("btn-filtrer").addEventListener("click", loadOperations);
document.getElementById("btn-reset-filtres").addEventListener("click", () => {
  document.getElementById("filtre-compte").value = "";
  document.getElementById("filtre-categorie").value = "";
  document.getElementById("filtre-statut").value = "";
  document.getElementById("filtre-date-debut").value = "";
  document.getElementById("filtre-date-fin").value = "";
  loadOperations();
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
 * Ce que chaque propriété veut dire, POSÉ SUR SA PROPRE LIGNE.
 *
 * Ces textes formaient auparavant un pavé sous le titre « Configuration
 * avancée » : une liste de six points et deux paragraphes qu'il fallait lire
 * en entier, puis retraverser du regard pour retrouver la propriété qu'on
 * était en train de régler. Chacun est désormais l'info-bulle de sa propre
 * ligne : l'explication arrive là où se prend la décision, et le bloc s'ouvre
 * sur la seule liste des propriétés.
 *
 * Le saut de ligne (\n) est rendu tel quel par la bulle (white-space:
 * pre-line) : il sépare le QUOI, en tête, de ses conséquences — c'est tout le
 * formatage dont ces textes ont besoin, et il évite une bulle en pavé.
 */
const INFOS_PROPRIETES_IMPORT = {
  categorie_banque:
    "La catégorie que la banque a elle-même posée sur la ligne.\n\n" +
    "Elle ne devient jamais une catégorie de l'app toute seule : tu fais la " +
    "correspondance une fois, et elle est mémorisée pour les imports suivants.",
  compte_banque:
    "Le compte que la ligne concerne, quand le fichier le nomme.\n\n" +
    "Inutile si le preset est déjà lié à un compte : ce lien-là s'impose à " +
    "toutes les lignes et cette colonne n'est alors même pas consultée.",
  sens:
    "À ne configurer que si ton relevé n'écrit que des montants positifs et " +
    "indique à part si l'argent entre ou sort.\n\n" +
    "Les mots-clés reconnus se règlent juste en dessous. Une valeur non " +
    "reconnue met la ligne en erreur plutôt que d'être devinée.",
  monnaie:
    "La devise du montant.\n\n" +
    "Sans elle, une ligne est libellée dans la monnaie principale de son " +
    "compte — ce qui est faux dès qu'un compte en porte plusieurs.",
  montant_initial:
    "Ce qui PART, avant frais et avant conversion. « Montant » décrit alors " +
    "ce qui ARRIVE (le formulaire l'appelle « Montant reçu » dès que les deux " +
    "devises diffèrent).\n\n" +
    "C'est le couple qui permet d'importer un virement entre deux devises, ou " +
    "une conversion au sein d'un compte multi-devises : l'app ne connaît aucun " +
    "taux de change, seul ton relevé peut donner les deux montants. Sur un " +
    "virement interne, le montant envoyé est la jambe émettrice.",
  monnaie_initiale:
    "La devise du montant envoyé.\n\n" +
    "Sans elle, elle est supposée identique à celle du montant reçu — ce qui " +
    "revient à supposer qu'il n'y a pas eu de change.",
  frais:
    "Les frais prélevés par la banque.\n\n" +
    "C'est leur DEVISE, et elle seule, qui décide auquel des deux montants ils " +
    "se rapportent. Dans la monnaie envoyée, ils s'AJOUTENT au montant envoyé : " +
    "ce qui est parti coûte plus que ce qui était annoncé. Dans la monnaie du " +
    "montant reçu, ils s'en RETRANCHENT : ce qui reste est amputé de la " +
    "commission.\n\n" +
    "S'ils ne sont dans ni l'une ni l'autre, l'import est refusé — additionner " +
    "deux devises fausserait un solde sans rien signaler. Retire alors cette " +
    "colonne, ou corrige la colonne de devise qui la qualifie.",
  monnaie_frais:
    "La devise des frais, celle qui décide à quel montant ils s'appliquent.\n\n" +
    "Sans elle, l'app ne peut rien vérifier : elle rapporte les frais au " +
    "montant envoyé (ou au montant, si le preset ne lit pas de montant envoyé) " +
    "et le signale par un avertissement à chaque import.",
  montant:
    "Le montant de la ligne, signé : négatif il sort, positif il entre.\n\n" +
    "Si ton relevé sépare au contraire les sorties et les entrées dans deux " +
    "colonnes, éteins celle-ci et configure « Montant au débit » et " +
    "« Montant au crédit » dans la configuration avancée.",
  montant_debit:
    "À configurer quand ton relevé SÉPARE les sorties et les entrées dans deux " +
    "colonnes, chaque ligne n'en remplissant qu'une. Les deux colonnes " +
    "remplacent « Montant » et se règlent ensemble.\n\n" +
    "La colonne remplie dit le sens, exactement comme le ferait une colonne " +
    "« Sens » : ce qui est au débit sort, ce qui est au crédit entre. Un zéro " +
    "compte comme une case vide. Une ligne qui remplit les deux part en erreur " +
    "— compenser l'un par l'autre inventerait une opération que ton relevé ne " +
    "décrit pas.",
  montant_credit:
    "L'autre moitié du montant scindé : ce qui ENTRE.\n\n" +
    "Elle va toujours de pair avec « Montant au débit » — allumer ou éteindre " +
    "l'une fait la même chose à l'autre.",
  statut:
    "Où en est l'opération chez la banque.\n\n" +
    "Une ligne EN ATTENTE (autorisation pas encore comptabilisée) devient une " +
    "opération prévisionnelle. Une ligne REFUSÉE ou annulée n'est pas importée " +
    "du tout, et n'entre pas non plus dans les lignes déjà vues qui servent à " +
    "détecter les doublons.\n\n" +
    "Les mots-clés se règlent plus bas.",
};

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
        ignorer_premiere_ligne: preset.ignorer_premiere_ligne,
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
  ligneApercuEnEdition = null;
  document.getElementById("import-fichier").value = "";
  document.getElementById("import-fichier-nom").textContent = "";
  document.getElementById("import-mappings-bloc").style.display = "none";
  document.getElementById("import-apercu-bloc").style.display = "none";
  document.getElementById("import-apercu-fichier-bloc").style.display = "none";
  document.getElementById("import-avertissements").style.display = "none";
  document.getElementById("import-monnaies-resolues-bloc").style.display = "none";
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
  fillComptesSelect(select, state.comptes, { keepFirst: true });
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
function signatureApercu(config) {
  return JSON.stringify({
    colonnes: config.colonnes,
    colonnes_comparaison: config.colonnes_comparaison || [],
    mode_comparaison: config.mode_comparaison,
    ignorer_premiere_ligne: config.ignorer_premiere_ligne === true,
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
  document.getElementById("import-ignorer-premiere-ligne").checked =
    config.ignorer_premiere_ligne === true;
  renderImportVocabulaires(config);
  renderImportConfig();
  renderImportPresetCompte(config.compte_id);
  renderImportConfigColonnesComparaison();
  updateImportCompteDefautVisibility();
}

/* ----- Vocabulaires (colonnes « Sens » et « État ») ----- */

// Les deux colonnes qui demandent un vocabulaire, et les champs de saisie qui
// le portent : champ du preset -> id de l'input. Une seule table pour les cinq
// listes, sens et état obéissant exactement à la même mécanique.
const CHAMPS_VOCABULAIRE = {
  sens: {
    propriete: "sens",
    bloc: "import-sens-libelles-bloc",
    listes: {
      libelles_sens_sortie: "import-sens-sortie",
      libelles_sens_entree: "import-sens-entree",
    },
  },
  statut: {
    propriete: "statut",
    bloc: "import-statut-libelles-bloc",
    listes: {
      libelles_statut_execute: "import-statut-execute",
      libelles_statut_attente: "import-statut-attente",
      libelles_statut_refuse: "import-statut-refuse",
    },
  },
};

// Saisis en une ligne séparée par des virgules : c'est une poignée de mots
// courts, une liste à puces avec un bouton "+" par entrée coûterait plus de
// clics qu'elle n'apporte de clarté.
function libellesDepuisTexte(texte) {
  return texte
    .split(",")
    .map((mot) => mot.trim())
    .filter(Boolean);
}

function renderImportVocabulaires(config) {
  Object.values(CHAMPS_VOCABULAIRE).forEach(({ listes }) => {
    Object.entries(listes).forEach(([champ, inputId]) => {
      document.getElementById(inputId).value = (config[champ] || []).join(", ");
    });
  });
  updateImportSensLibellesVisibilite();
  updateImportStatutLibellesVisibilite();
}

function vocabulairesSaisis() {
  const saisis = {};
  Object.values(CHAMPS_VOCABULAIRE).forEach(({ listes }) => {
    Object.entries(listes).forEach(([champ, inputId]) => {
      saisis[champ] = libellesDepuisTexte(document.getElementById(inputId).value);
    });
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

  const info = INFOS_PROPRIETES_IMPORT[propriete];
  const bulle = info
    ? `<i class="info-bulle info-bulle-texte info-bulle-gauche" tabindex="0" data-info="${escapeHtml(t(info))}">i</i>`
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
    if (colonne) colonne.index = Number(e.target.value) || 0;
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
      : '<p class="hint">Aucune colonne exclue : toutes les colonnes du fichier sont comparées.</p>';
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
        ignorer_premiere_ligne: document.getElementById("import-ignorer-premiere-ligne").checked,
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
    document.getElementById("import-ignorer-premiere-ligne").checked =
      config.ignorer_premiere_ligne === true;
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
    fillComptesSelect(el, state.comptes, { keepFirst: true })
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
async function executerPrevisualisation() {
  const formData = new FormData();
  formData.append("fichier", importFichierActuel);
  const compteDefaut = compteIdDefautChoisi();
  if (compteDefaut) formData.append("compte_id_defaut", compteDefaut);
  if (importReglageDelimiteur) formData.append("delimiteur", importReglageDelimiteur);
  if (importReglageSeparateurDecimal)
    formData.append("separateur_decimal", importReglageSeparateurDecimal);
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

function renderApercuFichier() {
  const bloc = document.getElementById("import-apercu-fichier-bloc");
  const apercu = importApercu && importApercu.apercu_fichier;
  if (!apercu || apercu.lignes.length === 0) {
    bloc.style.display = "none";
    return;
  }
  bloc.style.display = "";

  const largeur = apercu.lignes.reduce((max, l) => Math.max(max, l.length), 0);

  const classeColonne = (i) => {
    const propriete = apercu.proprietes_par_colonne[String(i)];
    return propriete ? classeColonneApercu(propriete) : "col-ignoree";
  };

  const entetes = [];
  for (let i = 1; i <= largeur; i++) {
    const propriete = apercu.proprietes_par_colonne[String(i)];
    const libelle = propriete
      ? APERCU_PROPRIETES[propriete] || propriete
      : "non importée";
    entetes.push(
      `<th class="${classeColonne(i)}"><span class="apercu-col-num">n°${i}</span>${escapeHtml(libelle)}</th>`
    );
  }

  const corps = apercu.lignes
    .map((ligne, index) => {
      // La ligne d'en-tête ignorée est montrée mais barrée : voir qu'elle est
      // bien exclue vaut mieux que de la faire disparaître silencieusement.
      const estEnteteIgnoree = apercu.premiere_ligne_ignoree && index === 0;
      const cellules = [];
      for (let i = 1; i <= largeur; i++) {
        cellules.push(`<td class="${classeColonne(i)}">${escapeHtml(ligne[i - 1] || "")}</td>`);
      }
      return `<tr class="${estEnteteIgnoree ? "apercu-ligne-ignoree" : ""}">${cellules.join("")}</tr>`;
    })
    .join("");

  document.getElementById("import-apercu-fichier-table").innerHTML =
    `<thead><tr>${entetes.join("")}</tr></thead><tbody>${corps}</tbody>`;

  // Le fichier entier est là : le tableau se borne en hauteur (cf.
  // .apercu-fichier-defilement) et se parcourt en défilant, dans les deux sens.
  document.getElementById("import-apercu-fichier-info").textContent =
    `${apercu.total_lignes} ligne(s) au total — fais défiler le tableau pour les voir toutes.`;
}

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
      creerLigneMapping(nomBanque, state.comptes, importMappingComptes, () => {
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

// Les virements de l'aperçu dont les DEUX comptes sont connus : sans le compte
// en face, il n'y a rien à rapprocher.
function candidatsDoublonsVirements() {
  if (!importApercu) return [];
  return importApercu.lignes
    .filter(
      (l) =>
        typeOperationLigne(l) === "virement" &&
        !l.erreur &&
        !ligneRefuseeParStatut(l) &&
        l.date &&
        l.compte_id != null &&
        l.compte_id_autre != null
    )
    .map((l) => {
      // Même règle que partout ailleurs : le signe du montant bancaire dit qui
      // émet (cf. rolesCompteVirement / _resoudre_comptes_virement).
      const emetteur = (l.montant_signe || 0) < 0;
      // Les deux jambes, quand la ligne les décrit toutes les deux (change) :
      // le montant envoyé est ce qui part, `montant` ce qui arrive. Sans
      // change, la ligne ne porte qu'un montant — c'est le même des deux côtés,
      // et le montant reçu reste inconnu plutôt que dupliqué (il ne doit pas
      // faire échouer une comparaison qu'il ne renseigne pas).
      const deuxJambes = l.montant_envoye != null && l.montant != null;
      return {
        ligne: l.ligne,
        date: l.date,
        // Ce qui PART du compte source : c'est ce montant-là que porte la
        // jambe sortante déjà en base, à laquelle on se compare.
        montant: Math.abs(l.montant_envoye != null ? l.montant_envoye : l.montant || 0),
        monnaie_id: l.monnaie_envoyee_id ?? l.monnaie_id ?? null,
        montant_recu: deuxJambes ? Math.abs(l.montant) : null,
        monnaie_recue_id: deuxJambes ? l.monnaie_id ?? null : null,
        compte_source_id: emetteur ? l.compte_id : l.compte_id_autre,
        compte_destination_id: emetteur ? l.compte_id_autre : l.compte_id,
      };
    })
    .filter((c) => c.montant > 0);
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
    } catch (err) {
      // Une veille consultative n'a pas à interrompre l'import : on se tait.
      renderVeilleDoublonsVirements([]);
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
        ? creerLigneApercuEdition(ligne, INFO_TYPE_DOUBLON)
        : creerLigneApercuAffichage(ligne, INFO_TYPE_DOUBLON);
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
  const tr = document.createElement("tr");
  tr.className = "import-doublon-existante import-doublon-virement";
  tr.innerHTML = `
    <td colspan="${nbColonnes}">
      <span class="hint">Ressemble à :</span>
      ${escapeHtml(suspect.date)} · ${escapeHtml(FORMAT_NOMBRE.format(suspect.montant))}
      ${escapeHtml(suspect.monnaie_symbole)} ·
      ${escapeHtml(suspect.compte_source)} → ${escapeHtml(suspect.compte_destination)}
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

function creerLigneApercuAffichage(ligne, infoType, { lectureSeule = false } = {}) {
  const tr = document.createElement("tr");
  // Une ligne en lecture seule (ligne déjà en base, affichée pour
  // comparaison) n'a par définition aucune action ni sélection possible.
  const selectionHtml = lectureSeule
    ? "-"
    : `<input type="checkbox" data-action="selectionner-ligne" data-ligne="${ligne.ligne}" ${importLignesSelectionnees.has(ligne.ligne) ? "checked" : ""} />`;

  let colonnesSpecifiques;
  if (infoType.virement) {
    const { emetteurHtml, recepteurHtml } = rolesCompteVirement(ligne);
    colonnesSpecifiques = `<td>${emetteurHtml}</td><td>${recepteurHtml}</td>`;
  } else {
    const compteHtml = ligne.compte_id !== null ? nomCompte(ligne.compte_id) : "-";
    // Catégorie affichée uniquement pour classique/remboursable : les autres
    // sous-sections ont déjà une catégorie implicite (fixe), pas besoin de
    // la répéter en colonne (cf. regroupement par catégorie d'opération).
    colonnesSpecifiques = infoType.categorieLibre
      ? `<td>${nomCategorie(ligne.categorie_id)}</td><td>${compteHtml}</td>`
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
  fillComptesSelect(select, state.comptes, { keepFirst: true });

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

  // Type d'opération (pour reclasser) : les 6 mêmes que la page Opérations.
  const selectType = document.createElement("select");
  TYPES_OPERATION_IMPORT.forEach((infoType) => {
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
      state.categories.forEach((c) => {
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
    if (info.cle === "remboursable") {
      const label = document.createElement("label");
      label.textContent = "Montant à rembourser";
      inputMontantDu = document.createElement("input");
      inputMontantDu.type = "number";
      inputMontantDu.step = "0.01";
      inputMontantDu.min = "0";
      const montantActuel = parseFloat(inputMontant.value) || 0;
      inputMontantDu.max = montantActuel;
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
  // montant (comportement par défaut : tout est à rembourser), comme sur la
  // page Opérations.
  inputMontant.addEventListener("input", () => {
    if (inputMontantDu && montantDuAutoSync) {
      inputMontantDu.value = inputMontant.value || "0";
      inputMontantDu.max = inputMontant.value || "0";
    }
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
    })
  );

  try {
    const resultat = await apiFetchForm(importUrl("/confirmer"), formData);
    importDernierHistoriqueId = resultat.historique_id ?? null;
    afficherResultatImport(resultat);
    showMessage(`${resultat.operations_creees} opération(s) importée(s).`, "success");

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

function renderMappingsCategoriesGalerie(mappings) {
  const bloc = document.getElementById("import-mapping-categories-liste");
  bloc.className = "galerie";
  bloc.innerHTML = "";

  const parCategorie = new Map();
  mappings.forEach((m) => {
    if (!parCategorie.has(m.categorie_id)) parCategorie.set(m.categorie_id, []);
    parCategorie.get(m.categorie_id).push(m);
  });

  ciblesEligiblesImport().forEach((categorie) => {
    const colonne = document.createElement("div");
    colonne.className = "galerie-colonne";
    colonne.dataset.categorieId = categorie.id;

    const libelles = parCategorie.get(categorie.id) || [];
    const titre = document.createElement("div");
    titre.className = "galerie-colonne-titre";
    titre.innerHTML = `
      <span>${escapeHtml(categorie.nom)}</span>
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
      carte.draggable = true;
      carte.dataset.nomBanque = m.nom_banque;
      // Le preset dont vient CETTE carte, pas celui sélectionné : la galerie
      // les mélange, reclasser ou supprimer doit viser le bon.
      carte.dataset.presetId = m.preset_id;
      carte.innerHTML = `
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
      corps.appendChild(carte);
    });

    colonne.appendChild(corps);
    bloc.appendChild(colonne);
  });

  surveillerHauteursGalerie(bloc);

  attacherDragEntreGroupes(bloc, {
    selecteurLigne: ".galerie-carte[draggable='true']",
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
      '<span class="hint">Aucune correspondance de catégorie mémorisée.</span>';
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
    compteBloc.innerHTML = '<span class="hint">Aucune correspondance de compte mémorisée.</span>';
  } else {
    mappings.comptes.forEach((m) => {
      compteBloc.appendChild(
        _creerLigneMappingActuel(m.nom_banque, m.compte_id, state.comptes, {
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
      <td>${escapeHtml(h.nom_fichier || "-")}</td>
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
    showMessage(
      t("Import annulé : {n} opération(s) supprimée(s).", {
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
      <ul class="import-lignes-ignorees">
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

function renderExtensions(extensions) {
  const bloc = document.getElementById("extensions-liste");
  if (extensions.length === 0) {
    bloc.innerHTML = `<span class="hint">${t("Aucune extension installée.")}</span>`;
    return;
  }
  bloc.innerHTML = extensions
    .map(
      (e) => `
      <div class="extension-carte ${e.actif ? "" : "inactive"}">
        <div class="extension-entete">
          <span class="extension-nom">${escapeHtml(e.nom)}</span>
          ${e.version ? `<span class="extension-version">v${escapeHtml(e.version)}</span>` : ""}
          ${
            // Le badge n'apparaît que sur une extension de développement :
            // les extensions ordinaires n'ont pas à porter une étiquette qui
            // ne les distingue de rien.
            e.type === "developpeur"
              ? `<span class="extension-badge-dev">${t("développeur")}</span>`
              : ""
          }
          <label class="extension-bascule">
            <input type="checkbox" data-extension-id="${escapeHtml(e.id)}" ${e.actif ? "checked" : ""} />
            <span>${t("Activée")}</span>
          </label>
        </div>
        <p class="extension-description">${escapeHtml(e.description)}</p>
      </div>`
    )
    .join("");
}

// Délégation : les cartes sont reconstruites à chaque rendu.
document.getElementById("extensions-liste").addEventListener("change", async (e) => {
  const case_ = e.target.closest("input[data-extension-id]");
  if (!case_) return;
  const id = case_.dataset.extensionId;
  const actif = case_.checked;
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
    case_.closest(".extension-carte").classList.toggle("inactive", !actif);
    showMessage(
      actif ? t("Extension activée.") : t("Extension désactivée. Aucune donnée n'a été supprimée."),
      "success"
    );
  } catch (err) {
    case_.checked = !actif; // l'écran doit refléter l'état réel du serveur
    showMessage(err.message, "error");
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
