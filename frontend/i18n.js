/**
 * Traduction de l'interface. Deux langues : le français, langue SOURCE, et
 * l'anglais.
 *
 * POURQUOI LE FRANÇAIS SERT DE CLÉ. Un dictionnaire de clés abstraites
 * (« dashboard.kpi.solde ») aurait voulu dire toucher chaque libellé de
 * index.html et de app.js pour y poser une clé, puis maintenir deux fichiers en
 * regard sans jamais voir le texte réel en écrivant le code. Ici la clé EST la
 * phrase française : le code reste lisible tel quel, et une phrase sans
 * traduction s'affiche simplement en français plutôt que de casser l'écran.
 *
 * DEUX CHEMINS, ET UN SEUL DICTIONNAIRE :
 *
 *  - le texte STATIQUE de index.html est traduit une fois, au chargement, en
 *    parcourant le DOM (cf. traduireDomStatique). Aucun attribut à poser dans
 *    le HTML ;
 *  - le texte CONSTRUIT en JavaScript passe par `t("...")`, qui accepte des
 *    paramètres nommés pour les phrases qui portent un nombre ou un nom.
 *
 * CE QUI N'EST JAMAIS TRADUIT : les données. Noms de comptes, de catégories, de
 * monnaies, libellés d'opérations, natures lues dans un relevé — c'est le texte
 * de l'utilisateur, pas celui de l'application. C'est la raison pour laquelle le
 * parcours du DOM n'a lieu qu'AU CHARGEMENT, avant que la moindre donnée n'ait
 * été rendue : à ce moment-là, tout ce qui est à l'écran vient de index.html.
 * Changer de langue recharge donc la page (cf. changerLangue) plutôt que de
 * retraduire un DOM où les deux se mélangent.
 */

const LANGUES = ["fr", "en"];
const LANGUE_PAR_DEFAUT = "fr";
const CLE_STOCKAGE = "budget-app-langue";

function langueEnregistree() {
  try {
    const valeur = localStorage.getItem(CLE_STOCKAGE);
    return LANGUES.includes(valeur) ? valeur : LANGUE_PAR_DEFAUT;
  } catch (err) {
    // Stockage indisponible (navigation privée stricte) : le français, et rien
    // de cassé.
    return LANGUE_PAR_DEFAUT;
  }
}

let langueActuelle = langueEnregistree();

function langue() {
  return langueActuelle;
}

/**
 * Traduit une phrase, et remplace ses paramètres.
 *
 * Les paramètres s'écrivent `{nom}` dans les deux langues : c'est ce qui permet
 * à l'anglais de les remettre dans un autre ordre, ce qu'une simple
 * concaténation aurait interdit.
 *
 * Une phrase absente du dictionnaire ressort telle quelle : en français c'est
 * le comportement voulu, en anglais c'est un trou visible — préférable à un
 * écran vide ou à une clé technique affichée à l'utilisateur.
 */
function t(texte, params) {
  const table = TRADUCTIONS[langueActuelle];
  let resultat = (table && table[texte]) || texte;
  if (params) {
    Object.keys(params).forEach((cle) => {
      resultat = resultat.split(`{${cle}}`).join(params[cle]);
    });
  }
  return resultat;
}

/**
 * Traduit un texte VENU DU SERVEUR (message d'erreur d'un endpoint, libellé
 * d'erreur d'une ligne d'import).
 *
 * Le serveur ne parle que français : ses messages sont donc traduits ici, à
 * l'affichage. Deux passes, parce que beaucoup de ces messages portent un nom
 * de compte ou un nombre et ne peuvent pas être retrouvés à l'identique :
 *
 *  1. correspondance exacte dans le dictionnaire ordinaire ;
 *  2. à défaut, les motifs de MOTIFS_SERVEUR, qui capturent la partie variable
 *     et la réinjectent telle quelle — un nom de compte n'est pas à traduire.
 *
 * Un message inconnu ressort en français : mieux vaut une phrase juste dans la
 * mauvaise langue qu'une erreur avalée.
 */
function traduireMessageServeur(message) {
  if (langueActuelle === LANGUE_PAR_DEFAUT || !message) return message;
  const direct = TRADUCTIONS[langueActuelle][message];
  if (direct) return direct;
  // Plusieurs manques peuvent être concaténés par le serveur (cf.
  // _erreur_ligne, qui joint par ", ") : on traduit morceau par morceau.
  if (message.includes(", ")) {
    const morceaux = message.split(", ");
    const traduits = morceaux.map((m) => traduireFragmentServeur(m));
    if (traduits.some((m, i) => m !== morceaux[i])) return traduits.join(", ");
  }
  return traduireFragmentServeur(message);
}

function traduireFragmentServeur(fragment) {
  const table = TRADUCTIONS[langueActuelle];
  if (table[fragment]) return table[fragment];
  for (const [motif, remplacement] of MOTIFS_SERVEUR) {
    const trouve = fragment.match(motif);
    if (trouve) {
      return remplacement.replace(/\$(\d)/g, (_, n) => trouve[Number(n)] ?? "");
    }
  }
  return fragment;
}

// Les attributs porteurs de texte visible. `data-info` alimente les info-bulles
// de l'app (cf. .info-bulle), `value` ne concerne que les boutons de formulaire.
const ATTRIBUTS_TRADUISIBLES = ["placeholder", "title", "aria-label", "data-info"];

/**
 * Traduit tout le texte statique de la page, une seule fois, au chargement.
 *
 * Sûr parce qu'appelé AVANT tout rendu de données : ce qui est dans le DOM à cet
 * instant vient intégralement de index.html. Un nom de catégorie qui
 * ressemblerait à un libellé de l'interface ne peut donc pas être traduit par
 * mégarde — il n'est pas encore là.
 */
function traduireDomStatique(racine) {
  if (langueActuelle === LANGUE_PAR_DEFAUT) return;
  const table = TRADUCTIONS[langueActuelle];

  const parcours = document.createTreeWalker(racine, NodeFilter.SHOW_TEXT, {
    acceptNode(noeud) {
      if (!noeud.nodeValue || !noeud.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
      const parent = noeud.parentElement;
      if (!parent || parent.tagName === "SCRIPT" || parent.tagName === "STYLE") {
        return NodeFilter.FILTER_REJECT;
      }
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  const noeuds = [];
  for (let n = parcours.nextNode(); n; n = parcours.nextNode()) noeuds.push(n);
  noeuds.forEach((noeud) => {
    // Les espaces et retours à la ligne de l'indentation HTML ne font pas
    // partie de la phrase : on les met de côté et on les remet après, pour ne
    // pas avoir à répéter dans le dictionnaire la mise en forme du fichier.
    const brut = noeud.nodeValue;
    const avant = brut.match(/^\s*/)[0];
    const apres = brut.match(/\s*$/)[0];
    const phrase = brut.trim().replace(/\s+/g, " ");
    const traduction = table[phrase];
    if (!traduction) return;
    // …SAUF quand la traduction porte elle-même son espace. Certaines phrases
    // de l'aide sont coupées en morceaux par un <strong> ou un <em> au milieu,
    // et les deux langues n'attachent pas les mots de la même façon : le
    // français élide (« ils s'<em>ajoutent</em> »), l'anglais sépare (« they
    // are <em>added</em> »). La traduction décide donc de ses propres bords, et
    // l'indentation d'origine ne revient que là où elle n'en pose pas.
    const debut = /^\s/.test(traduction) ? "" : avant;
    const fin = /\s$/.test(traduction) ? "" : apres;
    noeud.nodeValue = `${debut}${traduction}${fin}`;
  });

  racine.querySelectorAll("*").forEach((el) => {
    ATTRIBUTS_TRADUISIBLES.forEach((attribut) => {
      const valeur = el.getAttribute(attribut);
      if (!valeur) return;
      const traduction = table[valeur.trim().replace(/\s+/g, " ")];
      if (traduction) el.setAttribute(attribut, traduction);
    });
  });

  document.documentElement.lang = langueActuelle;
}

/**
 * Change de langue et RECHARGE la page.
 *
 * Retraduire à chaud demanderait de distinguer, dans un DOM déjà rempli, ce qui
 * vient de l'application de ce qui vient de la base — exactement la confusion
 * que ce module évite en ne traduisant qu'au chargement. Un rechargement est
 * instantané (tout est local) et repart d'un écran propre.
 */
function changerLangue(nouvelle) {
  if (!LANGUES.includes(nouvelle) || nouvelle === langueActuelle) return;
  try {
    localStorage.setItem(CLE_STOCKAGE, nouvelle);
  } catch (err) {
    /* Sans stockage, la langue ne survivra pas au rechargement : tant pis, on
       ne bloque pas le changement pour autant. */
  }
  window.location.reload();
}

/**
 * FRANÇAIS → ANGLAIS.
 *
 * Une entrée par phrase de l'interface, groupées par écran dans l'ordre où on
 * les rencontre. Les phrases que le HTML coupe par un <strong> ou un <em>
 * figurent morceau par morceau, avec leurs espaces de jonction quand l'anglais
 * les attache autrement que le français.
 *
 * Ne contient AUCUN nom de compte, de catégorie, de monnaie ni de type
 * d'opération : ce sont des données saisies par l'utilisateur, et les traduire
 * les rendrait introuvables dans sa propre base.
 */
const TRADUCTIONS = {
  en: {
    // ---------- En-tête ----------
    "Rechercher dans la page (Ctrl+F)": "Search this page (Ctrl+F)",
    Rechercher: "Search",
    "Rechercher dans la page\u2026": "Search this page\u2026",
    "Rechercher dans la page": "Search this page",
    "Correspondance pr\u00e9c\u00e9dente (Maj+Entr\u00e9e)": "Previous match (Shift+Enter)",
    "Correspondance pr\u00e9c\u00e9dente": "Previous match",
    "Correspondance suivante (Entr\u00e9e)": "Next match (Enter)",
    "Correspondance suivante": "Next match",
    "Op\u00e9rations": "Transactions",
    "Placements financiers": "Investments",
    "Param\u00e8tres": "Settings",

    // ---------- Dashboard ----------
    "Solde total": "Total balance",
    "Comptes courants, op\u00e9rations r\u00e9elles": "Current accounts, settled transactions",
    "Solde projet\u00e9": "Projected balance",
    "Comptes courants, pr\u00e9visionnel inclus": "Current accounts, forecast included",
    // Carte \u00ab Solde total \u00bb, qui porte d\u00e9sormais le projet\u00e9 \u00e0 c\u00f4t\u00e9 du r\u00e9el.
    "projet\u00e9": "projected",
    "Comptes courants \u2014 r\u00e9el, puis pr\u00e9visionnel inclus":
      "Current accounts \u2014 settled, then forecast included",
    "Comptes": "Accounts",
    "Variation du mois": "Change this month",
    // Le titre suit la vue : en vue annuelle, \u00ab du mois \u00bb annoncerait le
    // mauvais ordre de grandeur (cf. renderKpisDashboard).
    "Variation de l'ann\u00e9e": "Change this year",
    "Entr\u00e9es \u2212 sorties (pr\u00e9visionnel inclus)": "Money in \u2212 money out (forecast included)",
    "Total des avoirs": "Total assets",
    "Tous comptes confondus, courant + \u00e9pargne": "All accounts, current + savings",
    "R\u00e9partition des avoirs": "Asset allocation",
    "La part du total ci-dessus qui se trouve sur chaque type de compte, dans la monnaie de l'onglet actif. M\u00eames couleurs que les cartes de la Vue globale des comptes.":
      "The share of the total above held in each account type, in the active tab's currency. Same colours as the cards on the global account overview.",
    "Aucun solde positif \u00e0 r\u00e9partir.": "No positive balance to break down.",
    "R\u00e9partition des avoirs par type de compte": "Asset breakdown by account type",
    "Comptes courants": "Current accounts",
    "Comptes d'\u00e9pargne": "Savings accounts",
    "Comptes de placements": "Investment accounts",
    "Le solde affich\u00e9 est celui des esp\u00e8ces disponibles sur le compte ; les titres d\u00e9tenus sont valoris\u00e9s dans \u00ab Total des avoirs \u00bb et d\u00e9taill\u00e9s dans la page Placements financiers.":
      "The balance shown is the cash available on the account; the securities you hold are valued under \u201cTotal assets\u201d and detailed on the Investments page.",

    // ---------- Vue globale des comptes ----------
    "Vue globale des comptes": "Global account overview",
    "Le solde affich\u00e9 est celui des esp\u00e8ces disponibles sur le compte ; les titres d\u00e9tenus sont valoris\u00e9s dans \u00ab Total des avoirs \u00bb du dashboard et d\u00e9taill\u00e9s dans la page Placements financiers.":
      "The balance shown is the cash available on the account; the securities you hold are valued under \u201cTotal assets\u201d on the dashboard and detailed on the Investments page.",
    "D\u00e9penses par cat\u00e9gorie \u2014": "Spending by category \u2014",
    "Total entr\u00e9es": "Money in",
    "Total sorties": "Money out",
    "Diff\u00e9rence": "Difference",
    "Entr\u00e9es \u2212 sorties sur la p\u00e9riode choisie, pr\u00e9visionnel inclus. Les virements internes n'y entrent pas : d\u00e9placer de l'argent entre ses propres comptes ne fait ni entrer ni sortir quoi que ce soit. Les comptes d'\u00e9pargne et de placements sont exclus pour la m\u00eame raison.":
      "Money in \u2212 money out over the chosen period, forecast included. Internal transfers are left out: moving money between your own accounts brings nothing in and takes nothing out. Savings and investment accounts are excluded for the same reason.",
    "Notes": "Notes",
    "Un pense-b\u00eate libre, pour ce qu'aucune colonne ne porte. L'app ne le lit jamais et ne s'en sert pour aucun calcul. Enregistr\u00e9 automatiquement, une seconde apr\u00e8s la derni\u00e8re frappe.":
      "A free-form reminder, for whatever no column holds. The app never reads it and never uses it in any calculation. Saved automatically, one second after you stop typing.",
    "ex. v\u00e9rifier que le pr\u00e9l\u00e8vement EDF de mars est bien pass\u00e9 relancer Marie pour les 40 \u20ac du restaurant":
      "e.g. check the March electricity direct debit went through chase Marie for the \u20ac40 from dinner",

    // ---------- Op\u00e9rations ----------
    "Supprimer toutes les op\u00e9rations": "Delete all transactions",
    "Op\u00e9rations classiques": "Standard transactions",
    "D\u00e9penses remboursables": "Reimbursable expenses",
    "Remboursements re\u00e7us": "Reimbursements received",
    "Virements internes": "Internal transfers",
    "Pr\u00eats re\u00e7us": "Loans received",
    "Remboursements de pr\u00eats": "Loan repayments",
    "Trier par": "Sort by",
    "+ Ajouter une op\u00e9ration": "+ Add a transaction",
    "Ponctuelles": "One-off",
    "R\u00e9currentes": "Recurring",
    "Compte": "Account",
    "Tous": "All",
    "Cat\u00e9gorie": "Category",
    "Toutes": "All",
    "Statut": "Status",
    "Du": "From",
    "Au": "To",
    "Filtrer": "Filter",
    "R\u00e9initialiser": "Reset",
    "Ajouter une op\u00e9ration": "Add a transaction",
    "Nature": "Description",
    "Montant": "Amount",
    "Monnaie": "Currency",
    "Montant re\u00e7u": "Amount received",
    "Monnaie re\u00e7ue": "Currency received",
    "Date": "Date",
    "Compte source": "Source account",
    "Compte destination": "Destination account",
    "R\u00e9currente": "Recurring",
    "G\u00e9n\u00e9r\u00e9e automatiquement par une op\u00e9ration r\u00e9currente : modifie ou arr\u00eate la r\u00e9currence depuis l'op\u00e9ration d'origine.":
      "Generated automatically by a recurring transaction: edit or stop the recurrence from the original transaction.",
    "Fr\u00e9quence": "Frequency",
    "Hebdomadaire": "Weekly",
    "Mensuelle": "Monthly",
    "Trimestrielle": "Quarterly",
    "Annuelle": "Yearly",
    "Sans date de fin": "No end date",
    "Date de fin": "End date",
    "Colonnes lues": "Columns read",
    "{n} colonne(s) lue(s)": "{n} column(s) read",
    "doublons : toutes les colonnes": "duplicates: every column",
    "doublons : toutes sauf {n}": "duplicates: all but {n}",
    "doublons : {n} colonne(s) comparée(s)": "duplicates: {n} column(s) compared",
    "Amortie sur plusieurs mois": "Spread over several months",
    "La dépense reste datée du jour où l'argent est sorti — les soldes et les KPI du haut du dashboard ne bougent pas. Seuls l'histogramme et les totaux de la période répartissent son montant sur les mois choisis.":
      "The expense keeps the date the money actually left — balances and the KPIs at the top of the dashboard do not move. Only the chart and the period totals spread its amount over the chosen months.",
    "Premier mois": "First month",
    "Dernier mois": "Last month",
    "Nombre de mois": "Number of months",
    // Les deux listes déroulantes d'un champ mois + année (cf. creerChampMoisAnnee).
    "Mois": "Month",
    "Année": "Year",
    "ex. facture partagée avec Léa": "e.g. invoice split with Lea",
    "Renseigne deux des trois cases d'amortissement (premier mois, dernier mois, nombre de mois).":
      "Fill in two of the three spreading fields (first month, last month, number of months).",
    "Montant \u00e0 rembourser": "Amount owed to you",
    "Reste \u00e0 rembourser": "Still outstanding",
    "Op\u00e9rations rembours\u00e9es": "Expenses settled",
    "Texte libre, pour vous seul : l'app ne le lit jamais, ne le filtre pas et ne l'additionne pas. Sur un virement, la note est port\u00e9e par ses deux \u00e9critures.":
      "Free text, for you alone: the app never reads it, never filters on it and never adds it up. On a transfer, the note is carried by both entries.",
    "ex. facture partag\u00e9e avec L\u00e9a, \u00e0 rev\u00e9rifier sur le relev\u00e9 de mars":
      "e.g. bill split with L\u00e9a, double-check on the March statement",
    "Enregistrer": "Save",
    "Annuler": "Cancel",

    // ---------- Placements financiers ----------
    "Aucun compte de placements financiers. Cr\u00e9e-en un depuis la page Comptes en choisissant le type \"Placements financiers\", puis alimente-le par un virement interne.":
      "No investment account yet. Create one from the Accounts page by choosing the \"Placements financiers\" type, then fund it with an internal transfer.",
    "Titres d\u00e9tenus": "Holdings",
    "Titre": "Security",
    "Quantit\u00e9": "Quantity",
    "Prix de revient": "Cost price",
    "Investi": "Invested",
    "Cours": "Price",
    "Valorisation": "Market value",
    "+/- value": "Gain / loss",
    "Acheter / vendre": "Buy / sell",
    "Achat": "Buy",
    "Vente": "Sell",
    "Prix unitaire": "Unit price",
    "Mouvements sur titres": "Security movements",
    "Sens": "Direction",
    "Actions": "Actions",
    "Titres suivis": "Tracked securities",
    "La liste des titres est commune \u00e0 tous les comptes de placement : un m\u00eame ETF peut \u00eatre d\u00e9tenu sur plusieurs comptes. Le cours est saisi \u00e0 la main (l'app n'interroge aucun service de march\u00e9) et ne sert qu'\u00e0 valoriser les portefeuilles \u2014 jamais \u00e0 recalculer un solde, qui ne d\u00e9pend que des prix r\u00e9ellement pay\u00e9s. Un titre est cot\u00e9 dans une seule monnaie : il ne peut s'acheter que depuis un compte qui la porte.":
      "The list of securities is shared by every investment account: the same ETF can be held on several of them. The price is entered by hand (the app queries no market service) and only serves to value portfolios \u2014 never to recompute a balance, which depends solely on the prices actually paid. A security is quoted in a single currency: it can only be bought from an account that holds that currency.",
    "Nom du titre": "Security name",
    "ex. Air Liquide": "e.g. Air Liquide",
    "Monnaie de cotation": "Quote currency",
    "Cours actuel": "Current price",
    "Ajouter le titre": "Add security",

    // ---------- Param\u00e8tres : onglets ----------
    "Comptes": "Accounts",
    "Cat\u00e9gories": "Categories",
    "Monnaies": "Currencies",
    "R\u00e8gles": "Rules",
    "Import": "Import",
    "Base de donn\u00e9es": "Database",

    // ---------- Modale d'annonce des extensions trouv\u00e9es au lancement ----------
    "Extensions d\u00e9tect\u00e9es": "Extensions detected",
    "Une extension a \u00e9t\u00e9 trouv\u00e9e dans le dossier \u00ab extensions \u00bb et charg\u00e9e :":
      "One extension was found in the \u201cextensions\u201d folder and loaded:",
    "{n} extensions ont \u00e9t\u00e9 trouv\u00e9es dans le dossier \u00ab extensions \u00bb et charg\u00e9es :":
      "{n} extensions were found in the \u201cextensions\u201d folder and loaded:",
    "Fermer": "Close",
    "Aller au menu extensions": "Go to the extensions menu",

    // ---------- Param\u00e8tres : extensions ----------
    "Extensions": "Extensions",
    "Une extension ajoute une fonctionnalit\u00e9 \u00e0 l'application. La d\u00e9sactiver masque son \u00e9cran et ferme ses routes, mais ne supprime aucune donn\u00e9e : tout r\u00e9appara\u00eet intact \u00e0 la r\u00e9activation.":
      "An extension adds a feature to the application. Disabling it hides its screen and closes its routes, but deletes no data: everything comes back intact when you re-enable it.",
    "Aucune extension install\u00e9e.": "No extensions installed.",
    "Activ\u00e9e": "Enabled",
    "d\u00e9veloppeur": "developer",
    "Extension activ\u00e9e.": "Extension enabled.",
    "Extension d\u00e9sactiv\u00e9e. Aucune donn\u00e9e n'a \u00e9t\u00e9 supprim\u00e9e.":
      "Extension disabled. No data was deleted.",
    "Extension non charg\u00e9e": "Extension failed to load",

    // ---------- Param\u00e8tres : comptes ----------
    "Les comptes sont regroup\u00e9s par type. Double-clique une ligne pour la modifier, ou fais glisser un compte d'une carte \u00e0 l'autre pour changer son type.":
      "Accounts are grouped by type. Double-click a row to edit it, or drag an account from one card to another to change its type.",
    "Ajouter un compte": "Add an account",
    "Nom": "Name",
    "Type": "Type",
    "Monnaies du compte": "Account currencies",
    "Un compte peut porter plusieurs monnaies : son solde, son solde projet\u00e9 et ses op\u00e9rations sont alors suivis s\u00e9par\u00e9ment pour chacune, sans jamais \u00eatre additionn\u00e9s (l'app ne conna\u00eet aucun taux de change). Le solde initial se saisit donc monnaie par monnaie.":
      "An account can hold several currencies: its balance, projected balance and transactions are then tracked separately for each, never added together (the app knows no exchange rate). The opening balance is therefore entered currency by currency.",
    "Types de comptes": "Account types",
    "\"Courant\" et \"\u00c9pargne\" sont prot\u00e9g\u00e9s (ils pilotent le dashboard et les r\u00e8gles de virement). Tu peux ajouter d'autres types purement organisationnels.":
      "\"Courant\" and \"\u00c9pargne\" are protected (they drive the dashboard and the transfer rules). You can add other, purely organisational types.",
    "Nouveau type de compte": "New account type",
    "Ajouter": "Add",

    // ---------- Param\u00e8tres : cat\u00e9gories ----------
    "Cat\u00e9gories de d\u00e9penses": "Spending categories",
    "Le budget d'une cat\u00e9gorie est propre \u00e0 un mois ET \u00e0 une monnaie : les onglets ci-dessous choisissent l'un et l'autre. Un mois sans valeur propre h\u00e9rite du dernier mois renseign\u00e9. L'\u0153il de la colonne Dashboard d\u00e9cide si la cat\u00e9gorie appara\u00eet dans l'histogramme du dashboard : l'\u00e9teindre ne change rien d'autre \u2014 les op\u00e9rations restent class\u00e9es et le budget reste d\u00e9fini.":
      "A category's budget belongs to one month AND one currency: the tabs below pick both. A month with no value of its own inherits the last month set. The eye in the Dashboard column decides whether the category appears in the dashboard chart: switching it off changes nothing else \u2014 transactions stay classified and the budget stays defined.",
    "Ordre": "Order",
    "Budget": "Budget",
    "Ajouter une cat\u00e9gorie": "Add a category",

    // ---------- Param\u00e8tres : monnaies ----------
    "L'app ne conna\u00eet aucun taux de change et n'additionne jamais deux monnaies : chaque solde, chaque KPI et chaque budget est suivi s\u00e9par\u00e9ment par monnaie. Le symbole est ce qui s'affiche \u00e0 c\u00f4t\u00e9 des montants.":
      "The app knows no exchange rate and never adds two currencies together: every balance, every figure and every budget is tracked separately per currency. The symbol is what appears next to amounts.",
    "ex. Dollar am\u00e9ricain": "e.g. US Dollar",
    "Symbole": "Symbol",
    "ex. $": "e.g. $",

    // ---------- Param\u00e8tres : base de donn\u00e9es ----------
    "Bascule toutes les op\u00e9rations de l'app (lecture et \u00e9criture) vers un autre fichier .db. Ce choix n'est jamais m\u00e9moris\u00e9 au-del\u00e0 de cette session : red\u00e9marrer le serveur revient toujours \u00e0 la base de test.":
      "Switches everything the app reads and writes to another .db file. This choice is never remembered beyond the current session: restarting the server always returns to the test database.",
    "Une base rest\u00e9e \u00e0 une version de sch\u00e9ma ant\u00e9rieure est mise \u00e0 jour \u00e0 la bascule, apr\u00e8s copie horodat\u00e9e \u00e0 c\u00f4t\u00e9 du fichier d'origine : une application neuve ne sait pas lire une base ancienne, et \u00e9chouerait sinon sur ses pages principales sans dire pourquoi.":
      "A database left on an older schema version is upgraded when you switch to it, after a timestamped copy is made next to the original file: a newer app cannot read an older database, and would otherwise fail on its main pages without saying why.",
    "Base actuelle": "Current database",
    "Chemin complet du fichier .db": "Full path to the .db file",
    "C:\\chemin\\vers\\ma_base.db": "C:\\path\\to\\my_database.db",
    "Le navigateur ne transmet jamais le chemin complet d'un fichier choisi via \"Parcourir\" (limite de s\u00e9curit\u00e9) : ce bouton pr\u00e9-remplit seulement le nom du fichier, compl\u00e8te le dossier \u00e0 la main.":
      "The browser never passes on the full path of a file chosen through \"Browse\" (a security limit): this button only pre-fills the file name, complete the folder by hand.",
    "Parcourir\u2026": "Browse\u2026",
    "Basculer sur ce fichier": "Switch to this file",
    "Revenir \u00e0 la base de test": "Back to the test database",

    // ---------- Param\u00e8tres : r\u00e8gles ----------
    "Une r\u00e8gle classe automatiquement les lignes import\u00e9es d'apr\u00e8s leurs libell\u00e9s \u2014 c'est le seul moyen de marquer une ligne \"remboursable\" ou de la classer en Pr\u00eat / Remboursement sans le faire \u00e0 la main. Les r\u00e8gles sont communes \u00e0 tous les presets d'import.":
      "A rule classifies imported rows automatically from their descriptions \u2014 it is the only way to mark a row as reimbursable, or to file it as a loan or a repayment, without doing it by hand. Rules are shared by every import preset.",
    "Elles sont \u00e9valu\u00e9es de haut en bas :": "They are evaluated top to bottom:",
    "la premi\u00e8re qui correspond gagne": "the first match wins",
    ". Place les cas particuliers au-dessus des cas g\u00e9n\u00e9raux. Les r\u00e8gles passent":
      ". Put the special cases above the general ones. Rules come",
    "avant": "before",
    "les correspondances m\u00e9moris\u00e9es : un type reconnu ici ne peut plus \u00eatre d\u00e9fait par une correspondance de cat\u00e9gorie.":
      "the remembered mappings: a type recognised here can no longer be undone by a category mapping.",
    "+ Nouvelle r\u00e8gle": "+ New rule",
    "Nouvelle r\u00e8gle": "New rule",
    "Nom de la r\u00e8gle": "Rule name",
    "ex. Pr\u00eats re\u00e7us": "e.g. Loans received",
    "Conditions": "Conditions",
    "Les groupes se combinent entre eux ; \u00e0 l'int\u00e9rieur d'un groupe, les conditions se combinent selon leur propre connecteur. Deux niveaux suffisent \u00e0 \u00e9crire \u00ab (A ou B) et C \u00bb.":
      "Groups combine with one another; inside a group, conditions combine using their own connector. Two levels are enough to write \u201c(A or B) and C\u201d.",
    "Combiner les groupes avec": "Combine groups with",
    "ET (tous les groupes)": "AND (every group)",
    "OU (au moins un groupe)": "OR (at least one group)",
    "+ Ajouter un groupe": "+ Add a group",
    "Action": "Action",
    "Le type d\u00e9termine ce qui suit : seules \u00ab Op\u00e9ration classique \u00bb et \u00ab D\u00e9pense remboursable \u00bb laissent choisir une cat\u00e9gorie \u2014 les autres types imposent la leur.":
      "The type decides what follows: only a standard transaction and a reimbursable expense let you pick a category \u2014 the other types impose their own.",
    "Classer comme": "File as",
    "Dans la cat\u00e9gorie": "In category",
    "\u2014 ne pas changer \u2014": "\u2014 leave unchanged \u2014",
    "Avec le compte en face": "With the facing account",
    "Le compte qui n'appara\u00eet pas dans le relev\u00e9 : celui d'o\u00f9 vient l'argent si la ligne est une entr\u00e9e, celui o\u00f9 il va si c'est une sortie. Le sens est d\u00e9duit du signe du montant, tu n'as donc pas \u00e0 le pr\u00e9ciser. Sans lui, la ligne arrive incompl\u00e8te dans l'aper\u00e7u et bloque l'import \u2014 et la d\u00e9tection des doublons de virements, qui a besoin des deux comptes, ne peut rien comparer.":
      "The account the statement does not name: where the money comes from if the row is money in, where it goes if it is money out. The direction is deduced from the sign of the amount, so you do not have to state it. Without it, the row arrives incomplete in the preview and blocks the import \u2014 and transfer duplicate detection, which needs both accounts, has nothing to compare.",
    "\u2014 \u00e0 renseigner \u00e0 l'import \u2014": "\u2014 to be filled in at import \u2014",
    "R\u00e8gle active": "Rule active",
    "Correspondances m\u00e9moris\u00e9es": "Remembered mappings",
    "Apprises \u00e0 l'import : une fois confirm\u00e9e, une cat\u00e9gorie ou un compte du relev\u00e9 est r\u00e9utilis\u00e9 automatiquement les fois suivantes. Tous les presets sont r\u00e9unis ici. Elles visent un libell\u00e9 bancaire exact, mais elles ne d\u00e9cident que de la cat\u00e9gorie \u2014 le type, lui, vient des r\u00e8gles ci-dessus, \u00e9valu\u00e9es avant.":
      "Learned at import: once confirmed, a category or an account from the statement is reused automatically next time. Every preset is gathered here. They target an exact bank label, but they only decide the category \u2014 the type comes from the rules above, which are evaluated first.",
    "Cat\u00e9gories bancaires": "Bank categories",
    "Tous les presets r\u00e9unis : chaque libell\u00e9 du relev\u00e9 est rang\u00e9 dans la cat\u00e9gorie de l'app vers laquelle il renvoie. En italique entre parenth\u00e8ses, le compte dont le relev\u00e9 provient \u2014 c'est ce qui distingue deux libell\u00e9s de banques diff\u00e9rentes qui portent presque le m\u00eame nom (rien n'est affich\u00e9 si le preset n'est li\u00e9 \u00e0 aucun compte). Fais glisser un libell\u00e9 dans une autre colonne pour le reclasser ; il reste dans son preset d'origine. Les types sans cat\u00e9gorie (virement interne, pr\u00eat re\u00e7u, remboursements) ne figurent pas ici : ils sont d\u00e9tect\u00e9s par les r\u00e8gles ci-dessus.":
      "Every preset together: each label from the statement sits in the app category it points to. In italics between brackets, the account the statement came from \u2014 that is what tells apart two nearly identical labels from different banks (nothing is shown if the preset is tied to no account). Drag a label into another column to refile it; it stays in its own preset. Types that carry no category (internal transfer, loan received, reimbursements) are absent here: they are detected by the rules above.",
    "Comptes bancaires": "Bank accounts",
    "Correspondances entre les noms de compte lus dans le relev\u00e9 et les comptes de l'app, tous presets r\u00e9unis. Une entr\u00e9e que plusieurs presets partagent \u00e0 l'identique n'appara\u00eet qu'une fois : la modifier ou la supprimer les met tous \u00e0 jour.":
      "Mappings between the account names read in the statement and the app's accounts, every preset together. An entry several presets share identically appears only once: editing or deleting it updates them all.",
    "Devises": "Currencies",
    "Correspondances entre les libell\u00e9s de devise du relev\u00e9 (\u00ab EUR \u00bb) et les monnaies de l'app, tous presets r\u00e9unis. Elles n'existent que pour les presets qui lisent une colonne de devise (voir Configuration avanc\u00e9e). Une entr\u00e9e que plusieurs presets partagent \u00e0 l'identique n'appara\u00eet qu'une fois : la modifier ou la supprimer les met tous \u00e0 jour.":
      "Mappings between the currency labels in the statement (\u201cEUR\u201d) and the app's currencies, every preset together. They exist only for presets that read a currency column (see Advanced configuration). An entry several presets share identically appears only once: editing or deleting it updates them all.",

    // ---------- Param\u00e8tres : import ----------
    "Importe le fichier Excel ou CSV de tes op\u00e9rations bancaires. Les correspondances cat\u00e9gorie/ compte doivent \u00eatre confirm\u00e9es, et les doublons d\u00e9tect\u00e9s pass\u00e9s en revue, avant de pouvoir valider l'import.":
      "Import the Excel or CSV file of your bank transactions. Category and account mappings must be confirmed, and detected duplicates reviewed, before the import can be validated.",

    // ---------- Param\u00e8tres : v\u00e9rification d'un solde (\u00e9cart avec la banque) ----------
    "V\u00e9rifier un solde": "Check a balance",
    "Le solde d'un compte dans l'app est une reconstruction : un solde initial, plus toutes les op\u00e9rations r\u00e9elles. Quand il diff\u00e8re du relev\u00e9 de la banque, saisis ici le solde r\u00e9el : l'app cherche quelles op\u00e9rations expliqueraient exactement l'\u00e9cart \u2014 une saisie en double, une d\u00e9pense entr\u00e9e \u00e0 l'envers, une \u00e9ch\u00e9ance rest\u00e9e pr\u00e9visionnelle. Rien n'est modifi\u00e9 ni m\u00e9moris\u00e9 : ce sont des pistes \u00e0 v\u00e9rifier.":
      "An account's balance in the app is a reconstruction: an opening balance, plus every settled transaction. When it differs from your bank statement, enter the real balance here: the app looks for which transactions would explain the gap exactly \u2014 a double entry, an expense recorded the wrong way round, a scheduled payment left as a forecast. Nothing is changed or stored: these are leads to check.",
    "Solde \u00e0 la banque": "Balance at the bank",
    "ex. 1234,56": "e.g. 1234.56",
    "Arr\u00eat\u00e9 au (facultatif)": "As of (optional)",
    "La date \u00e0 laquelle ton relev\u00e9 est arr\u00eat\u00e9. Sans elle, la comparaison porte sur toutes les op\u00e9rations r\u00e9elles connues, y compris celles dat\u00e9es dans le futur \u2014 ce qui ne correspond \u00e0 aucun relev\u00e9.":
      "The date your statement is drawn up to. Without it, the comparison covers every settled transaction known, including those dated in the future \u2014 which matches no statement.",
    "Analyser l'\u00e9cart": "Analyse the gap",
    "Saisis le solde lu sur ton relev\u00e9.": "Enter the balance shown on your statement.",
    "Solde dans l'app": "Balance in the app",
    "\u00c9cart": "Gap",
    "Aucun \u00e9cart : le solde de l'app correspond exactement au relev\u00e9.":
      "No gap: the app's balance matches the statement exactly.",
    "La banque a plus que l'app : il manque une entr\u00e9e, ou l'app porte une sortie de trop.":
      "The bank has more than the app: either money in is missing, or the app carries one money-out too many.",
    "La banque a moins que l'app : il manque une sortie, ou l'app porte une entr\u00e9e de trop.":
      "The bank has less than the app: either money out is missing, or the app carries one money-in too many.",
    "Aucune combinaison d'au plus trois op\u00e9rations n'explique cet \u00e9cart. L'erreur vient peut-\u00eatre du solde initial du compte, d'une op\u00e9ration d'un autre compte, ou de plusieurs causes \u00e0 la fois.":
      "No combination of up to three transactions explains this gap. The error may come from the account's opening balance, from a transaction on another account, or from several causes at once.",
    "{n} piste(s) trouv\u00e9e(s) sur {total} op\u00e9ration(s) analys\u00e9e(s), la plus simple d'abord. \u00c0 v\u00e9rifier \u2014 l'app ne peut pas savoir laquelle est la bonne.":
      "{n} lead(s) found across {total} transaction(s) analysed, simplest first. To be checked \u2014 the app cannot know which one is right.",
    "D'autres pistes du m\u00eame genre existent : seules les premi\u00e8res sont affich\u00e9es.":
      "Other leads of the same kind exist: only the first ones are shown.",
    "Ce compte porte trop d'op\u00e9rations pour chercher des combinaisons de trois : seules celles d'une ou deux op\u00e9rations ont \u00e9t\u00e9 test\u00e9es.":
      "This account carries too many transactions to search for combinations of three: only those of one or two transactions were tested.",
    "Op\u00e9ration en trop": "Transaction too many",
    "Sens invers\u00e9": "Direction reversed",
    "\u00c9ch\u00e9ance non point\u00e9e": "Unreconciled scheduled payment",
    "Combinaison": "Combination",
    "Cette op\u00e9ration explique l'\u00e9cart \u00e0 elle seule : la supprimer aligne le solde de l'app sur celui de la banque.":
      "This transaction explains the gap on its own: deleting it brings the app's balance in line with the bank's.",
    "Cette op\u00e9ration est encore pr\u00e9visionnelle : si la banque l'a d\u00e9j\u00e0 pass\u00e9e, la basculer en r\u00e9el comble exactement l'\u00e9cart.":
      "This transaction is still a forecast: if the bank has already cleared it, switching it to settled closes the gap exactly.",
    "Ces deux op\u00e9rations totalisent exactement l'\u00e9cart : les retirer toutes les deux aligne le solde.":
      "These two transactions add up to exactly the gap: removing both brings the balance in line.",
    "Ces trois op\u00e9rations totalisent exactement l'\u00e9cart. \u00c0 v\u00e9rifier : trois lignes peuvent aussi s'additionner par hasard.":
      "These three transactions add up to exactly the gap. Worth checking: three rows can also add up by coincidence.",
    // Les quatre sens d'une op\u00e9ration, tels que la liste des pistes les nomme
    // (cf. LIBELLE_SENS dans app.js).
    "sortie": "money out",
    "entr\u00e9e": "money in",
    "virement \u00e9mis": "transfer sent",
    "virement re\u00e7u": "transfer received",

    // ---------- Param\u00e8tres : import, annulation d'un import ----------
    "Annuler un import supprime les op\u00e9rations qu'il a cr\u00e9\u00e9es et le retire du stock anti-doublons : le fichier redevient donc importable comme s'il n'\u00e9tait jamais pass\u00e9. Les op\u00e9rations que tu as supprim\u00e9es \u00e0 la main depuis ne sont plus compt\u00e9es ; celles que tu as modifi\u00e9es partent quand m\u00eame, elles viennent bien de ce fichier.":
      "Cancelling an import deletes the transactions it created and removes it from the duplicate store: the file becomes importable again, as if it had never gone through. Transactions you have since deleted by hand are no longer counted; those you have edited go anyway \u2014 they do come from this file.",
    "plus rien \u00e0 annuler": "nothing left to cancel",
    "import trop ancien": "import too old",
    "Cet import est ant\u00e9rieur au suivi des op\u00e9rations import\u00e9es : l'app ne sait pas lesquelles il a cr\u00e9\u00e9es, elle ne peut donc pas les retirer. Seuls les imports faits depuis sont annulables.":
      "This import predates the tracking of imported transactions: the app does not know which ones it created, so it cannot remove them. Only imports made since can be cancelled.",
    "Aucun import pour le moment.": "No imports yet.",
    "Annuler cet import supprimera {n} op\u00e9ration(s) et le rendra r\u00e9importable. Cette action est irr\u00e9versible. Continuer ?":
      "Cancelling this import will delete {n} transaction(s) and make it importable again. This cannot be undone. Continue?",
    "Import annul\u00e9 : {n} op\u00e9ration(s) supprim\u00e9e(s).":
      "Import cancelled: {n} transaction(s) deleted.",

    // R\u00e9glages de lecture en dernier recours (d\u00e9limiteur, s\u00e9parateur d\u00e9cimal).
    "R\u00e9glages de lecture (d\u00e9limiteur, s\u00e9parateur d\u00e9cimal)":
      "Reading settings (delimiter, decimal separator)",
    "\u00c0 utiliser si le fichier n'est pas lu correctement (colonnes m\u00e9lang\u00e9es, montants illisibles) : la d\u00e9tection automatique du d\u00e9limiteur et de la virgule d\u00e9cimale fran\u00e7aise ne convient pas \u00e0 tous les formats d'export.":
      "Use this if the file is not read correctly (columns mixed up, unreadable amounts): automatic delimiter detection and the French decimal comma do not suit every export format.",
    "D\u00e9limiteur de colonnes": "Column delimiter",
    "D\u00e9tecter automatiquement": "Detect automatically",
    "Point-virgule ( ; )": "Semicolon ( ; )",
    "Virgule ( , )": "Comma ( , )",
    "Tabulation": "Tab",
    "Autre\u2026": "Other\u2026",
    "ex. |": "e.g. |",
    "S\u00e9parateur d\u00e9cimal": "Decimal separator",
    "D\u00e9tecter automatiquement (virgule fran\u00e7aise)": "Detect automatically (French comma)",
    "Virgule \u2014 1234,56": "Comma \u2014 1234,56",
    "Point \u2014 1234.56": "Point \u2014 1234.56",
    "Relire le fichier avec ces r\u00e9glages": "Re-read the file with these settings",
    "La plupart des lignes sont illisibles : le fichier n'utilise sans doute pas le d\u00e9limiteur ou le s\u00e9parateur d\u00e9cimal d\u00e9tect\u00e9s automatiquement. Pr\u00e9cise-les ci-dessous, puis relis le fichier.":
      "Most rows are unreadable: the file probably does not use the automatically detected delimiter or decimal separator. Set them below, then re-read the file.",

    "Preset": "Preset",
    "Un preset regroupe le format de colonnes, les correspondances cat\u00e9gorie/compte, l'historique et le stock anti-doublons d'une banque : chaque banque ayant son propre format d'export, cr\u00e9e un preset par banque plut\u00f4t que de partager une configuration unique.":
      "A preset gathers one bank's column format, its category and account mappings, its history and its duplicate store: since every bank has its own export format, create one preset per bank rather than sharing a single configuration.",
    "+ Nouveau preset": "+ New preset",
    "Renommer": "Rename",
    "Supprimer ce preset": "Delete this preset",
    "Compte bancaire de ce preset": "Bank account for this preset",
    "Toutes les lignes du fichier seront affect\u00e9es \u00e0 ce compte, sans rien demander : ni la colonne \u00ab Compte bancaire \u00bb ni les correspondances m\u00e9moris\u00e9es ne sont alors consult\u00e9es. Les virements internes restent correctement orient\u00e9s \u2014 ce compte est d\u00e9duit \u00e9metteur ou r\u00e9cepteur selon le signe du montant. Laisse \u00ab aucun \u00bb si le fichier d\u00e9signe lui-m\u00eame le compte de chaque ligne.":
      "Every row in the file will be assigned to this account, without asking: neither the \u201cBank account\u201d column nor the remembered mappings are consulted. Internal transfers stay correctly oriented \u2014 this account is deduced to be sender or receiver from the sign of the amount. Leave it on \u201cnone\u201d if the file names the account for each row itself.",
    "\u2014 aucun : le compte vient du fichier \u2014": "\u2014 none: the account comes from the file \u2014",
    "Configuration du fichier": "File configuration",
    "Indique quelles colonnes lire dans ton fichier (le nombre est libre) et \u00e0 quelle information de l'app chacune correspond. Date, Nature et Montant sont obligatoires ; Cat\u00e9gorie bancaire est facultative. Tout le reste \u2014 compte, sens, devises, montant envoy\u00e9, frais, \u00e9tat \u2014 se configure dans \u00ab Configuration avanc\u00e9e \u00bb plus bas.":
      "State which columns to read in your file (there is no limit) and which piece of app information each one holds. Date, Description and Amount are required; Bank category is optional. Everything else \u2014 account, direction, currencies, amount sent, fees, status \u2014 is configured under \u201cAdvanced configuration\u201d below.",
    "Clique sur l'\u0153il pour lire ou ignorer une propri\u00e9t\u00e9. Les propri\u00e9t\u00e9s lues apparaissent en premier ; Date, Nature et Montant sont obligatoires et ne s'\u00e9teignent pas.":
      "Click the eye to read or ignore a property. Properties being read come first; Date, Description and Amount are required and cannot be switched off.",
    "La premi\u00e8re ligne du fichier est un en-t\u00eate (\u00e0 ne pas importer)":
      "The first row of the file is a header (do not import it)",
    "Comparaison des doublons": "Duplicate comparison",
    "Une ligne import\u00e9e est compar\u00e9e aux lignes d\u00e9j\u00e0 import\u00e9es pour d\u00e9tecter les doublons. Deux fa\u00e7ons de dire la m\u00eame chose : pars de toutes les colonnes et retire celles qui bougent d'un export \u00e0 l'autre (solde courant, r\u00e9f\u00e9rence, date de valeur), ou ne d\u00e9signe que celles qui identifient une ligne (souvent date + libell\u00e9 + montant). La comparaison ignore ce qui ne se voit pas : espaces ins\u00e9cables, accents d\u00e9compos\u00e9s, espaces en trop.":
      "An imported row is compared with rows already imported in order to detect duplicates. Two ways of saying the same thing: start from every column and remove those that shift between exports (running balance, reference, value date), or name only those that identify a row (usually date + description + amount). The comparison ignores what cannot be seen: non-breaking spaces, decomposed accents, extra spaces.",
    "Comparer": "Compare",
    "toutes les colonnes, sauf celles-ci": "every column except these",
    "uniquement ces colonnes": "only these columns",
    "+ Ajouter une colonne": "+ Add a column",
    "Configuration avanc\u00e9e": "Advanced configuration",
    "Compte bancaire": "Bank account",
    "Montant envoy\u00e9": "Amount sent",
    "Monnaie envoy\u00e9e": "Currency sent",
    "Frais": "Fees",
    "Monnaie des frais": "Fee currency",
    "\u00c9tat": "Status",
    "Montant au d\u00e9bit": "Debit amount",
    "Montant au cr\u00e9dit": "Credit amount",
    "Les m\u00eames colonnes num\u00e9rot\u00e9es qu'au-dessus, pour ce que ton relev\u00e9 dit en plus du minimum : le compte vis\u00e9, le sens, et surtout les devises. Laisse vide si ton relev\u00e9 tient dans une seule colonne de montant, dans une seule monnaie. Le \u00ab i \u00bb de chaque ligne dit ce qu'elle change.":
      "The same numbered columns as above, for whatever your statement says beyond the minimum: the account concerned, the direction, and above all the currencies. Leave it empty if your statement fits in a single amount column, in a single currency. The \u201ci\u201d on each row says what it changes.",

    // Les explications des propri\u00e9t\u00e9s d'import, une entr\u00e9e par info-bulle
    // (cf. INFOS_PROPRIETES_IMPORT). Les sauts de ligne font partie de la
    // cha\u00eene : la bulle les rend tels quels. Ces textes \u00e9taient auparavant
    // d\u00e9coup\u00e9s en fragments par les <strong> du HTML, ce qui produisait des
    // cl\u00e9s comme \u00ab et \u00bb ou \u00ab , ils s' \u00bb : intraduisibles isol\u00e9ment, et
    // cass\u00e9es au moindre remaniement de la phrase.
    "La cat\u00e9gorie que la banque a elle-m\u00eame pos\u00e9e sur la ligne.\n\nElle ne devient jamais une cat\u00e9gorie de l'app toute seule : tu fais la correspondance une fois, et elle est m\u00e9moris\u00e9e pour les imports suivants.":
      "The category the bank itself put on the row.\n\nIt never becomes an app category on its own: you make the match once, and it is remembered for later imports.",
    "Le compte que la ligne concerne, quand le fichier le nomme.\n\nInutile si le preset est d\u00e9j\u00e0 li\u00e9 \u00e0 un compte : ce lien-l\u00e0 s'impose \u00e0 toutes les lignes et cette colonne n'est alors m\u00eame pas consult\u00e9e.":
      "The account the row concerns, when the file names it.\n\nPointless if the preset is already tied to an account: that link applies to every row, and this column is then never even read.",
    "\u00c0 ne configurer que si ton relev\u00e9 n'\u00e9crit que des montants positifs et indique \u00e0 part si l'argent entre ou sort.\n\nLes mots-cl\u00e9s reconnus se r\u00e8glent juste en dessous. Une valeur non reconnue met la ligne en erreur plut\u00f4t que d'\u00eatre devin\u00e9e.":
      "Only worth configuring if your statement writes positive amounts only and says separately whether money comes in or goes out.\n\nThe recognised keywords are set just below. An unrecognised value puts the row in error rather than being guessed.",
    "La devise du montant.\n\nSans elle, une ligne est libell\u00e9e dans la monnaie principale de son compte \u2014 ce qui est faux d\u00e8s qu'un compte en porte plusieurs.":
      "The currency of the amount.\n\nWithout it, a row is denominated in its account's main currency \u2014 which is wrong as soon as an account holds several.",
    "Ce qui PART, avant frais et avant conversion. \u00ab Montant \u00bb d\u00e9crit alors ce qui ARRIVE (le formulaire l'appelle \u00ab Montant re\u00e7u \u00bb d\u00e8s que les deux devises diff\u00e8rent).\n\nC'est le couple qui permet d'importer un virement entre deux devises, ou une conversion au sein d'un compte multi-devises : l'app ne conna\u00eet aucun taux de change, seul ton relev\u00e9 peut donner les deux montants. Sur un virement interne, le montant envoy\u00e9 est la jambe \u00e9mettrice.":
      "What LEAVES, before fees and before conversion. \u201cAmount\u201d then describes what ARRIVES (the form calls it \u201cAmount received\u201d as soon as the two currencies differ).\n\nThis is the pair that makes it possible to import a transfer between two currencies, or a conversion inside a multi-currency account: the app knows no exchange rate, only your statement can give both amounts. On an internal transfer, the amount sent is the outgoing leg.",
    "La devise du montant envoy\u00e9.\n\nSans elle, elle est suppos\u00e9e identique \u00e0 celle du montant re\u00e7u \u2014 ce qui revient \u00e0 supposer qu'il n'y a pas eu de change.":
      "The currency of the amount sent.\n\nWithout it, it is assumed identical to the currency received \u2014 which amounts to assuming there was no exchange.",
    "Les frais pr\u00e9lev\u00e9s par la banque.\n\nC'est leur DEVISE, et elle seule, qui d\u00e9cide auquel des deux montants ils se rapportent. Dans la monnaie envoy\u00e9e, ils s'AJOUTENT au montant envoy\u00e9 : ce qui est parti co\u00fbte plus que ce qui \u00e9tait annonc\u00e9. Dans la monnaie du montant re\u00e7u, ils s'en RETRANCHENT : ce qui reste est amput\u00e9 de la commission.\n\nS'ils ne sont dans ni l'une ni l'autre, l'import est refus\u00e9 \u2014 additionner deux devises fausserait un solde sans rien signaler. Retire alors cette colonne, ou corrige la colonne de devise qui la qualifie.":
      "The fees charged by the bank.\n\nIt is their CURRENCY, and it alone, that decides which of the two amounts they belong to. In the currency sent, they are ADDED to the amount sent: what left costs more than what was announced. In the currency of the amount received, they are SUBTRACTED from it: what remains is reduced by the commission.\n\nIf they are in neither, the import is refused \u2014 adding two currencies together would falsify a balance without a word. Remove this column, or correct the currency column that qualifies it.",
    "La devise des frais, celle qui d\u00e9cide \u00e0 quel montant ils s'appliquent.\n\nSans elle, l'app ne peut rien v\u00e9rifier : elle rapporte les frais au montant envoy\u00e9 (ou au montant, si le preset ne lit pas de montant envoy\u00e9) et le signale par un avertissement \u00e0 chaque import.":
      "The currency of the fees, the one that decides which amount they apply to.\n\nWithout it the app can check nothing: it applies the fees to the amount sent (or to the amount, if the preset reads no amount sent) and says so with a warning at every import.",
    "O\u00f9 en est l'op\u00e9ration chez la banque.\n\nUne ligne EN ATTENTE (autorisation pas encore comptabilis\u00e9e) devient une op\u00e9ration pr\u00e9visionnelle. Une ligne REFUS\u00c9E ou annul\u00e9e n'est pas import\u00e9e du tout, et n'entre pas non plus dans les lignes d\u00e9j\u00e0 vues qui servent \u00e0 d\u00e9tecter les doublons.\n\nLes mots-cl\u00e9s se r\u00e8glent plus bas.":
      "Where the transaction stands at the bank.\n\nA PENDING row (an authorisation not yet booked) becomes a forecast transaction. A DECLINED or cancelled row is not imported at all, and does not join the already-seen rows used to detect duplicates either.\n\nThe keywords are set below.",
    "Le montant de la ligne, sign\u00e9 : n\u00e9gatif il sort, positif il entre.\n\nSi ton relev\u00e9 s\u00e9pare au contraire les sorties et les entr\u00e9es dans deux colonnes, \u00e9teins celle-ci et configure \u00ab Montant au d\u00e9bit \u00bb et \u00ab Montant au cr\u00e9dit \u00bb dans la configuration avanc\u00e9e.":
      "The row's amount, signed: negative it goes out, positive it comes in.\n\nIf your statement instead splits money out and money in across two columns, switch this one off and configure \u201cDebit amount\u201d and \u201cCredit amount\u201d in the advanced configuration.",
    "\u00c0 configurer quand ton relev\u00e9 S\u00c9PARE les sorties et les entr\u00e9es dans deux colonnes, chaque ligne n'en remplissant qu'une. Les deux colonnes remplacent \u00ab Montant \u00bb et se r\u00e8glent ensemble.\n\nLa colonne remplie dit le sens, exactement comme le ferait une colonne \u00ab Sens \u00bb : ce qui est au d\u00e9bit sort, ce qui est au cr\u00e9dit entre. Un z\u00e9ro compte comme une case vide. Une ligne qui remplit les deux part en erreur \u2014 compenser l'un par l'autre inventerait une op\u00e9ration que ton relev\u00e9 ne d\u00e9crit pas.":
      "Worth configuring when your statement SPLITS money out and money in across two columns, each row filling only one. The two columns replace \u201cAmount\u201d and are set together.\n\nThe filled column says the direction, exactly as a \u201cDirection\u201d column would: what sits in debit goes out, what sits in credit comes in. A zero counts as an empty cell. A row that fills both goes into error \u2014 netting one against the other would invent a transaction your statement does not describe.",
    "L'autre moiti\u00e9 du montant scind\u00e9 : ce qui ENTRE.\n\nElle va toujours de pair avec \u00ab Montant au d\u00e9bit \u00bb \u2014 allumer ou \u00e9teindre l'une fait la m\u00eame chose \u00e0 l'autre.":
      "The other half of the split amount: what COMES IN.\n\nIt always goes with \u201cDebit amount\u201d \u2014 switching one on or off does the same to the other.",
    "Mots-cl\u00e9s de la colonne \u00ab Sens \u00bb": "Keywords for the \u201cDirection\u201d column",
    "Ce que TON relev\u00e9 \u00e9crit pour dire qu'une ligne est une sortie ou une entr\u00e9e. S\u00e9pare les mots-cl\u00e9s par des virgules. La casse, les accents et les espaces sont ignor\u00e9s : \u00ab D\u00e9bit \u00bb, \u00ab DEBIT \u00bb et \u00ab d\u00e9bit \u00bb sont le m\u00eame mot-cl\u00e9. Enregistr\u00e9s avec le reste de la configuration : tu ne les ressaisis pas \u00e0 chaque import.":
      "What YOUR statement writes to say a row is money out or money in. Separate keywords with commas. Case, accents and spaces are ignored: \u201cD\u00e9bit\u201d, \u201cDEBIT\u201d and \u201cd\u00e9bit\u201d are the same keyword. Saved with the rest of the configuration: you do not retype them at every import.",
    "Laisse vide pour garder les mots-cl\u00e9s compris par d\u00e9faut, list\u00e9s en dessous de chaque champ. D\u00e8s que tu en \u00e9cris un seul, il remplace enti\u00e8rement la liste par d\u00e9faut de ce sens-l\u00e0.":
      "Leave empty to keep the keywords understood by default, listed under each field. As soon as you write a single one, it entirely replaces the default list for that direction.",
    "Sortie (argent qui part)": "Money out (leaving)",
    "Par d\u00e9faut :": "Default:",
    "Entr\u00e9e (argent qui rentre)": "Money in (arriving)",
    "Mots-cl\u00e9s de la colonne \u00ab \u00c9tat \u00bb": "Keywords for the \u201cStatus\u201d column",
    "Ce que TON relev\u00e9 \u00e9crit pour dire o\u00f9 en est une op\u00e9ration. S\u00e9pare les mots-cl\u00e9s par des virgules. La casse, les accents et les espaces sont ignor\u00e9s. Un libell\u00e9 qui ne figure dans aucune des trois listes met la ligne en erreur plut\u00f4t que d'\u00eatre devin\u00e9 : se tromper importerait une op\u00e9ration refus\u00e9e, ou daterait comme r\u00e9elle une autorisation qui peut encore tomber.":
      "What YOUR statement writes to say where a transaction stands. Separate keywords with commas. Case, accents and spaces are ignored. A label absent from all three lists puts the row in error rather than being guessed: getting it wrong would import a declined transaction, or record as settled an authorisation that can still fall through.",
    "Laisse vide pour garder les mots-cl\u00e9s compris par d\u00e9faut. D\u00e8s que tu en \u00e9cris un seul, il remplace enti\u00e8rement la liste par d\u00e9faut de cet \u00e9tat-l\u00e0.":
      "Leave empty to keep the keywords understood by default. As soon as you write a single one, it entirely replaces the default list for that status.",
    "Ex\u00e9cut\u00e9 (l'argent a boug\u00e9)": "Settled (the money moved)",
    "En attente \u2192 op\u00e9ration pr\u00e9visionnelle": "Pending \u2192 forecast transaction",
    "Refus\u00e9 / annul\u00e9 \u2192 ligne non import\u00e9e": "Declined / cancelled \u2192 row not imported",
    "Enregistrer la configuration": "Save configuration",
    "Compte pour ce fichier (aucune colonne \"Compte bancaire\" configur\u00e9e)":
      "Account for this file (no \"Bank account\" column configured)",
    "\u2014 choisir \u2014": "\u2014 choose \u2014",
    "S\u00e9lectionner un fichier Excel ou CSV": "Select an Excel or CSV file",
    "ou glisse-d\u00e9pose ton fichier ici \u2014 l'analyse d\u00e9marre automatiquement":
      "or drop your file here \u2014 analysis starts on its own",
    "Le fichier tel qu'il est": "The file as it is",
    "Chaque colonne lue est color\u00e9e et porte le nom de la propri\u00e9t\u00e9 qui sera import\u00e9e. Les colonnes grises sont ignor\u00e9es. Si une couleur ne tombe pas en face des bonnes donn\u00e9es, corrige les num\u00e9ros de colonne dans \"Configuration du fichier\" au-dessus.":
      "Each column being read is coloured and carries the name of the property that will be imported. Grey columns are ignored. If a colour does not land on the right data, correct the column numbers under \"File configuration\" above.",
    "Cat\u00e9gories bancaires \u00e0 confirmer": "Bank categories to confirm",
    "Une cat\u00e9gorie sans correspondance m\u00e9moris\u00e9e est propos\u00e9e par d\u00e9faut dans \"Autres\" : coche \"Confirmer\" pour la garder telle quelle, ou change la avant de confirmer l'import. Tant que ce n'est pas fait, tu peux continuer \u00e0 utiliser l'app normalement (cr\u00e9er des cat\u00e9gories, etc.) \u2014 seule la validation de cet import attend.":
      "A category with no remembered mapping is proposed under \"Autres\" by default: tick \"Confirmer\" to keep it as is, or change it before confirming the import. Until that is done you can carry on using the app normally (creating categories and so on) \u2014 only this import's validation waits.",
    "Tout confirmer": "Confirm all",
    "Comptes bancaires \u00e0 faire correspondre": "Bank accounts to map",
    "Devises \u00e0 faire correspondre": "Currencies to map",
    "Le relev\u00e9 \u00e9crit \u00ab EUR \u00bb, \u00ab USD \u00bb ; l'app conna\u00eet des monnaies nomm\u00e9es. Indique une fois \u00e0 quelle monnaie renvoie chaque libell\u00e9 \u2014 m\u00eame quand les deux portent le m\u00eame nom, rien n'est rattach\u00e9 tout seul : l'app s'en souvient ensuite pour ce preset.":
      "The statement writes \u201cEUR\u201d, \u201cUSD\u201d; the app knows named currencies. State once which currency each label points to \u2014 even when both carry the same name, nothing is linked on its own: the app then remembers it for this preset.",
    "Devises d\u00e9j\u00e0 rattach\u00e9es": "Currencies already linked",
    "Ces libell\u00e9s du relev\u00e9 ont d\u00e9j\u00e0 une correspondance m\u00e9moris\u00e9e pour ce preset : c'est pourquoi ils ne sont pas dans la liste au-dessus. Il n'y a rien \u00e0 faire \u2014 cette liste existe pour que tu puisses v\u00e9rifier le rattachement avant de confirmer.":
      "These statement labels already have a remembered mapping for this preset: that is why they are not in the list above. There is nothing to do \u2014 this list exists so you can check the link before confirming.",
    "Aper\u00e7u \u2014": "Preview \u2014",
    "ligne(s)": "row(s)",
    "Les doublons d\u00e9tect\u00e9s sont pr\u00e9-s\u00e9lectionn\u00e9s. Tant qu'il reste des lignes s\u00e9lectionn\u00e9es, l'import est bloqu\u00e9 : supprime-les, ou d\u00e9coche-les pour les importer quand m\u00eame. Le bouton \"Modifier\" permet aussi de reclasser une ligne dans une autre cat\u00e9gorie d'op\u00e9ration.":
      "Detected duplicates are pre-selected. As long as rows remain selected the import is blocked: delete them, or untick them to import them anyway. The \"Modifier\" button also lets you refile a row under another transaction type.",
    "Tout s\u00e9lectionner": "Select all",
    "Supprimer la s\u00e9lection (": "Delete selection (",
    "Op\u00e9rations classiques \u2014": "Standard transactions \u2014",
    "Ligne": "Row",
    "Cat\u00e9gorie (banque)": "Category (bank)",
    "Compte (banque)": "Account (bank)",
    "S\u00e9lection": "Selection",
    "D\u00e9penses remboursables \u2014": "Reimbursable expenses \u2014",
    "Remboursements re\u00e7us \u2014": "Reimbursements received \u2014",
    "Virements internes \u2014": "Internal transfers \u2014",
    "Compte \u00e9metteur": "Sending account",
    "Compte r\u00e9cepteur": "Receiving account",
    "Pr\u00eats re\u00e7us \u2014": "Loans received \u2014",
    "Remboursements de pr\u00eats \u2014": "Loan repayments \u2014",
    "Ressemblances \u2014": "Look-alikes \u2014",
    "Doublons de virement interne possibles.": "Possible internal-transfer duplicates.",
    "Deux relev\u00e9s de deux banques d\u00e9crivent le m\u00eame virement avec des colonnes qui n'ont rien de commun : la d\u00e9tection de doublons ordinaire, qui compare des lignes de fichier, ne peut structurellement pas les voir. Celle-ci compare la":
      "Two statements from two banks describe the same transfer with columns that have nothing in common: ordinary duplicate detection, which compares file rows, structurally cannot see them. This one compares the",
    "transaction": "transaction",
    "\u2014 les deux comptes, les devises, un des deux montants, et une date voisine. Rien n'est bloqu\u00e9 ni pr\u00e9-s\u00e9lectionn\u00e9 : toi seul sais si tu as vraiment vir\u00e9 deux fois. Chaque ligne est suivie de ce \u00e0 quoi elle ressemble.":
      "itself \u2014 both accounts, the currencies, one of the two amounts, and a nearby date. Nothing is blocked or pre-selected: you alone know whether you really transferred twice. Each row is followed by what it resembles.",
    "Doublons d\u00e9tect\u00e9s \u2014": "Duplicates detected \u2014",
    "Chaque ligne jug\u00e9e identique (hors colonnes exclues, cf. Configuration du fichier) \u00e0 une ligne d\u00e9j\u00e0 en base est affich\u00e9e ici (m\u00eame format que les autres sections), suivie en lecture seule de la ligne existante suspect\u00e9e. Elles sont pr\u00e9-s\u00e9lectionn\u00e9es pour \u00eatre supprim\u00e9es d'un clic \u2014 d\u00e9coche-en une pour l'importer quand m\u00eame (deux achats identiques le m\u00eame jour sont un doublon d\u00e9tect\u00e9 l\u00e9gitime).":
      "Every row judged identical (excluded columns aside, see File configuration) to a row already stored is shown here, in the same format as the other sections, followed read-only by the existing row it is suspected of duplicating. They are pre-selected so they can be deleted in one click \u2014 untick one to import it anyway (two identical purchases on the same day are a legitimate detected duplicate).",
    "Confirmer l'import": "Confirm import",
    "Historique des importations": "Import history",
    "Fichier": "File",
    "Op\u00e9rations cr\u00e9\u00e9es": "Transactions created",
    "Lignes ignor\u00e9es": "Rows skipped",
    "Doublons d\u00e9tect\u00e9s": "Duplicates detected",

    // ---------- Messages et confirmations (app.js) ----------
    "Supprimer cette monnaie ?": "Delete this currency?",
    "Monnaie supprim\u00e9e": "Currency deleted",
    "Monnaie modifi\u00e9e": "Currency updated",
    "Monnaie cr\u00e9\u00e9e": "Currency created",
    "Renseigne le chemin complet du fichier .db.": "Enter the full path to the .db file.",
    "Revenir \u00e0 la base de test ?": "Go back to the test database?",
    "Supprimer ce type de compte ?": "Delete this account type?",
    "Type de compte supprim\u00e9": "Account type deleted",
    "Type de compte cr\u00e9\u00e9": "Account type created",
    "Supprimer ce compte ?": "Delete this account?",
    "Compte supprim\u00e9": "Account deleted",
    "Type de compte modifi\u00e9": "Account type changed",
    "Ordre des comptes modifi\u00e9": "Account order changed",
    "Choisis au moins une monnaie pour ce compte.": "Pick at least one currency for this account.",
    "Compte modifi\u00e9": "Account updated",
    "Compte cr\u00e9\u00e9": "Account created",
    "Supprimer cette cat\u00e9gorie ?": "Delete this category?",
    "Cat\u00e9gorie supprim\u00e9e": "Category deleted",
    "Budget modifi\u00e9": "Budget updated",
    "Cat\u00e9gorie cr\u00e9\u00e9e": "Category created",
    "Ce virement n'a qu'une \u00e9criture (second compte inconnu \u00e0 l'import) : ":
      "This transfer has only one entry (the second account was unknown at import): ",
    "Supprimer cette op\u00e9ration ?": "Delete this transaction?",
    "Op\u00e9ration supprim\u00e9e": "Transaction deleted",
    "Renseigne le montant re\u00e7u : les deux comptes sont dans des monnaies diff\u00e9rentes ":
      "Enter the amount received: the two accounts are in different currencies ",
    "Virement modifi\u00e9": "Transfer updated",
    "Virement cr\u00e9\u00e9": "Transfer created",
    "La nature de l'op\u00e9ration est obligatoire.": "The description is required.",
    "Renseigne un montant r\u00e9gl\u00e9 pour au moins une op\u00e9ration.":
      "Enter a settled amount for at least one transaction.",
    "Op\u00e9ration modifi\u00e9e": "Transaction updated",
    "Op\u00e9ration cr\u00e9\u00e9e": "Transaction created",
    "Pr\u00eat modifi\u00e9": "Loan updated",
    "Pr\u00eat cr\u00e9\u00e9": "Loan created",
    "Supprimer TOUTES les op\u00e9rations ? Action irr\u00e9versible \u2014 pens\u00e9 pour vider des donn\u00e9es de test.":
      "Delete EVERY transaction? This cannot be undone \u2014 meant for clearing test data.",
    "Cours mis \u00e0 jour": "Price updated",
    "Supprimer ce titre ?": "Delete this security?",
    "Titre supprim\u00e9": "Security deleted",
    "Supprimer ce mouvement ? Le solde du compte sera recalcul\u00e9.":
      "Delete this movement? The account balance will be recalculated.",
    "Mouvement supprim\u00e9": "Movement deleted",
    "Titre ajout\u00e9": "Security added",
    "Preset renomm\u00e9": "Preset renamed",
    "Preset supprim\u00e9": "Preset deleted",
    "Configuration enregistr\u00e9e": "Configuration saved",
    "Choisis d'abord un fichier \u00e0 analyser.": "Choose a file to analyse first.",
    "Aucun preset d'import disponible : cr\u00e9es-en un d'abord.":
      "No import preset available: create one first.",
    "Un aper\u00e7u est d\u00e9j\u00e0 en cours : analyser ce fichier l'abandonnera (lignes en attente comprises). Continuer ?":
      "A preview is already open: analysing this file will discard it, pending rows included. Continue?",
    "Ce compte ne porte aucune monnaie : impossible de cr\u00e9er l'op\u00e9ration.":
      "This account holds no currency: the transaction cannot be created.",
    "Renseigne une date valide.": "Enter a valid date.",
    "La nature ne peut pas \u00eatre vide.": "The description cannot be empty.",
    "Choisis un compte.": "Choose an account.",
    "Le compte \u00e9metteur et le compte r\u00e9cepteur doivent \u00eatre diff\u00e9rents, sauf pour une ":
      "The sending and receiving accounts must differ, except for a ",
    "Renseigne le montant envoy\u00e9 : les deux monnaies diff\u00e8rent et l'app ne convertit rien.":
      "Enter the amount sent: the two currencies differ and the app converts nothing.",
    "Choisis une cat\u00e9gorie.": "Choose a category.",
    "Import termin\u00e9 : toutes les lignes ont \u00e9t\u00e9 trait\u00e9es.":
      "Import finished: every row has been processed.",
    "Termine maintenant les remboursements / remboursements de pr\u00eats en attente, ci-dessous.":
      "Now finish the pending reimbursements and loan repayments below.",
    "Correspondance supprim\u00e9e": "Mapping deleted",
    "Correspondance reclass\u00e9e": "Mapping refiled",
    "Correspondance mise \u00e0 jour": "Mapping updated",
    "Mapping mis \u00e0 jour": "Mapping updated",
    "Mapping supprim\u00e9": "Mapping deleted",
    "R\u00e8gle supprim\u00e9e": "Rule deleted",
    "Donne un nom \u00e0 la r\u00e8gle.": "Give the rule a name.",
    "Chaque condition doit porter sur un champ.": "Every condition must target a field.",
    "Chaque condition doit avoir une valeur \u00e0 comparer.":
      "Every condition must have a value to compare.",
    "R\u00e8gle modifi\u00e9e": "Rule updated",
    "R\u00e8gle cr\u00e9\u00e9e": "Rule created",

    // ---------- Messages du serveur ----------
    // Le serveur ne parle que fran\u00e7ais ; ces phrases sont traduites \u00e0
    // l'affichage (cf. traduireMessageServeur). Celles qui portent un nom ou un
    // nombre sont dans MOTIFS_SERVEUR plus bas.
    "Monnaie introuvable": "Currency not found",
    "Un titre avec ce nom existe d\u00e9j\u00e0": "A security with this name already exists",
    "Titre introuvable": "Security not found",
    "Ce titre a des mouvements enregistr\u00e9s : sa monnaie de cotation ne peut plus changer (les montants d\u00e9j\u00e0 pay\u00e9s sont libell\u00e9s dans l'ancienne).":
      "This security has recorded movements: its quote currency can no longer change (the amounts already paid are denominated in the old one).",
    "Ce titre a des mouvements enregistr\u00e9s : supprime-les d'abord (les soldes du compte en d\u00e9pendent).":
      "This security has recorded movements: delete them first (the account balances depend on them).",
    "Une cat\u00e9gorie avec ce nom existe d\u00e9j\u00e0": "A category with this name already exists",
    "mois doit \u00eatre entre 1 et 12": "month must be between 1 and 12",
    "Cat\u00e9gorie introuvable": "Category not found",
    "La cat\u00e9gorie 'Autres' ne peut pas \u00eatre supprim\u00e9e": "The 'Autres' category cannot be deleted",
    "Type de compte introuvable": "Account type not found",
    "Une m\u00eame monnaie ne peut pas \u00eatre ajout\u00e9e deux fois":
      "The same currency cannot be added twice",
    "Un compte avec ce nom existe d\u00e9j\u00e0": "An account with this name already exists",
    "Compte introuvable": "Account not found",
    "Impossible de supprimer un compte qui a des op\u00e9rations li\u00e9es":
      "An account with linked transactions cannot be deleted",
    "vue doit \u00eatre 'mois' ou 'annee'": "view must be 'mois' or 'annee'",
    "Preset d'import introuvable": "Import preset not found",
    "Au moins une colonne est requise": "At least one column is required",
    "Chaque propri\u00e9t\u00e9 ne peut \u00eatre assign\u00e9e qu'\u00e0 une seule colonne":
      "Each property can be assigned to only one column",
    "Chaque colonne ne peut \u00eatre utilis\u00e9e qu'une fois": "Each column can be used only once",
    "Les colonnes de la comparaison doivent \u00eatre num\u00e9rot\u00e9es \u00e0 partir de 1":
      "Comparison columns must be numbered from 1",
    "Choisis au moins une colonne \u00e0 comparer, ou repasse en \u00ab comparer toutes les colonnes sauf \u00bb.":
      "Pick at least one column to compare, or switch back to \u201ccompare every column except\u201d.",
    "Impossible de supprimer le dernier preset restant": "The last remaining preset cannot be deleted",
    "Mapping introuvable": "Mapping not found",
    "mappings invalide (JSON attendu)": "invalid mappings (JSON expected)",
    "Une monnaie avec ce nom existe d\u00e9j\u00e0": "A currency with this name already exists",
    "Cette monnaie est encore utilis\u00e9e par un compte, une op\u00e9ration, un budget ou un titre : elle ne peut pas \u00eatre supprim\u00e9e.":
      "This currency is still used by an account, a transaction, a budget or a security: it cannot be deleted.",
    "Les op\u00e9rations classiques et remboursements ne peuvent pas cibler un compte d'\u00e9pargne ; utilise un virement interne.":
      "Standard transactions and reimbursements cannot target a savings account; use an internal transfer.",
    "Un compte de placements financiers n'accepte que des virements internes et des achats/ventes de titres (page Placements financiers).":
      "An investment account only accepts internal transfers and security purchases or sales (Investments page).",
    "Type d'op\u00e9ration introuvable": "Transaction type not found",
    "Le type 'Virement interne' est r\u00e9serv\u00e9 aux virements, cr\u00e9\u00e9s via /virements (deux \u00e9critures li\u00e9es).":
      "The 'Virement interne' type is reserved for transfers, created through /virements (two linked entries).",
    "Cette \u00e9criture appartient \u00e0 un achat/vente de titres : modifie-la depuis la page Placements financiers.":
      "This entry belongs to a security purchase or sale: edit it from the Investments page.",
    "Op\u00e9ration introuvable": "Transaction not found",
    "Cette op\u00e9ration fait partie d'un virement : supprimez le virement et recr\u00e9ez l'op\u00e9ration pour en changer le type.":
      "This transaction is part of a transfer: delete the transfer and recreate the transaction to change its type.",
    "montant_du ne peut pas d\u00e9passer montant": "montant_du cannot exceed montant",
    "montant_a_rembourser ne peut pas d\u00e9passer montant_du":
      "montant_a_rembourser cannot exceed montant_du",
    "Cette op\u00e9ration fait partie d'un virement interne ; elle doit \u00eatre supprim\u00e9e via l'endpoint de virement.":
      "This transaction is part of an internal transfer; it must be deleted through the transfer endpoint.",
    "Cette op\u00e9ration est marqu\u00e9e comme rembours\u00e9e via un remboursement li\u00e9 ; d\u00e9liez-la d'abord (depuis l'op\u00e9ration de remboursement) pour modifier ce montant manuellement.":
      "This transaction is marked as reimbursed through a linked reimbursement; unlink it first (from the reimbursement transaction) to change this amount by hand.",
    "Ce compte n'est pas un compte de placements financiers": "This is not an investment account",
    "Mouvement de titres introuvable": "Security movement not found",
    "R\u00e8gle introuvable": "Rule not found",
    "Compte en face introuvable": "Facing account not found",
    "Un type de compte avec ce nom existe d\u00e9j\u00e0": "An account type with this name already exists",
    "Ce type de compte est prot\u00e9g\u00e9 (utilis\u00e9 par les r\u00e8gles de l'application) et ne peut pas \u00eatre supprim\u00e9":
      "This account type is protected (used by the application's rules) and cannot be deleted",
    "Impossible de supprimer un type utilis\u00e9 par au moins un compte":
      "A type used by at least one account cannot be deleted",
    "Compte source introuvable": "Source account not found",
    "Compte destination introuvable": "Destination account not found",
    "Virement introuvable": "Transfer not found",
    "Ce virement n'a qu'une seule \u00e9criture (second compte inconnu \u00e0 l'import) : modifie-la comme une op\u00e9ration ordinaire.":
      "This transfer has only one entry (the second account was unknown at import): edit it like an ordinary transaction.",
    "frequence est requise pour une op\u00e9ration r\u00e9currente":
      "frequence is required for a recurring transaction",
    "Le compte source et le compte destination doivent \u00eatre diff\u00e9rents, sauf pour une conversion entre deux monnaies d'un m\u00eame compte (la monnaie re\u00e7ue doit alors diff\u00e9rer de la monnaie envoy\u00e9e)":
      "The source and destination accounts must differ, except for a conversion between two currencies of the same account (the currency received must then differ from the currency sent)",
    "la valeur \u00e0 comparer ne peut pas \u00eatre vide": "the value to compare cannot be empty",
    "Le sens d'un virement interne ne se d\u00e9duit pas de son type : il doit \u00eatre impos\u00e9 (transfert_sortant ou transfert_entrant) par l'appelant.":
      "The direction of an internal transfer cannot be deduced from its type: the caller must impose it (transfert_sortant or transfert_entrant).",

    // Erreurs par ligne, affich\u00e9es dans l'aper\u00e7u d'import.
    "date illisible": "unreadable date",
    "montant illisible": "unreadable amount",
    "nature manquante": "missing description",
    "cat\u00e9gorie non r\u00e9solue": "category not resolved",
    "compte non r\u00e9solu": "account not resolved",
    "frais dans une monnaie \u00e9trang\u00e8re aux montants de la ligne":
      "fees in a currency foreign to the row's amounts",
    "virement interne : le compte en face n'est pas renseign\u00e9":
      "internal transfer: the facing account is not filled in",
    "monnaie des frais manquante": "missing fee currency",
    "sens manquant": "missing direction",
    "montant présent au débit et au crédit": "amount present in both debit and credit",
    "virement interne : le sens de la ligne est indéterminé":
      "internal transfer: the row's direction is undetermined",
    "\u00e9tat manquant": "missing status",
    "frais sup\u00e9rieurs au montant de la ligne": "fees larger than the row's amount",
    "compte introuvable": "account not found",
    "virement entre deux monnaies sans montant envoy\u00e9 : renseigne le montant initial (l'app ne convertit rien)":
      "transfer between two currencies with no amount sent: fill in the amount sent (the app converts nothing)",
    "virement entre deux monnaies sans montant re\u00e7u : renseigne-le (l'app ne convertit rien)":
      "transfer between two currencies with no amount received: fill it in (the app converts nothing)",
    "le compte \u00e9metteur et le compte r\u00e9cepteur doivent \u00eatre diff\u00e9rents, sauf conversion entre deux monnaies d'un m\u00eame compte":
      "the sending and receiving accounts must differ, except for a conversion between two currencies of the same account",

    // ---------- Libell\u00e9s des gabarits (boutons, badges, listes vides) ----------
    "Modifier": "Edit",
    "Supprimer": "Delete",
    "Confirmer": "Confirm",
    "Rembours\u00e9": "Reimbursed",
    "En attente": "Pending",
    "Prot\u00e9g\u00e9": "Protected",
    "OK": "OK",
    "Esp\u00e8ces": "Cash",
    "Portefeuille": "Portfolio",
    "Total du compte": "Account total",
    "Plus-value latente": "Unrealised gain",
    "Liquidit\u00e9s disponibles pour acheter": "Cash available to buy with",
    "Titres d\u00e9tenus, au dernier cours saisi": "Securities held, at the last price entered",
    "Esp\u00e8ces + portefeuille": "Cash + portfolio",
    "Valorisation \u2212 capital investi": "Market value \u2212 capital invested",
    "Aucune monnaie.": "No currency.",
    "Aucun compte.": "No account.",
    "Aucun compte dans cette monnaie.": "No account in this currency.",
    "Aucune d\u00e9pense enregistr\u00e9e.": "No spending recorded.",
    // Infobulle d'une barre de l'histogramme (cf. contenuInfobulleHistogramme).
    "Aucune d\u00e9pense sur la p\u00e9riode.": "No spending over this period.",
    "Sans libell\u00e9": "No label",
    "Aucun titre d\u00e9tenu sur ce compte.": "No securities held on this account.",
    "Aucun mouvement.": "No movements.",
    "Aucun compte \u2014 d\u00e9pose-en un ici.": "No account \u2014 drop one here.",
    "Aucun pr\u00eat non rembours\u00e9 disponible.": "No outstanding loan available.",
    "Aucune d\u00e9pense non rembours\u00e9e disponible.": "No unreimbursed expense available.",
    "Aucun titre. Ajoute-en un ci-dessous.": "No securities. Add one below.",
    "Glisser pour r\u00e9ordonner": "Drag to reorder",
    "Glisser pour r\u00e9ordonner, ou vers une autre carte pour changer de type":
      "Drag to reorder, or onto another card to change its type",
    "Solde initial dans cette monnaie": "Opening balance in this currency",
    "Cours unitaire actuel": "Current unit price",
    "aucun r\u00e9sultat": "no results",
    "Ne plus afficher sur le dashboard": "Stop showing on the dashboard",
    "Afficher sur le dashboard": "Show on the dashboard",
    "Masquer": "Hide",
    "Afficher": "Show",
    "Filtrer sur l'ann\u00e9e enti\u00e8re": "Filter on the whole year",
    "Filtrer sur un mois": "Filter on a single month",
    "Enregistr\u00e9": "Saved",
    "Nouvelle op\u00e9ration": "New transaction",
    "Modifier l'op\u00e9ration": "Edit transaction",
    "Pr\u00eats r\u00e9gl\u00e9s": "Loans settled",
    "Op\u00e9rations r\u00e9gl\u00e9es": "Transactions settled",
    "Date (r\u00e9cent \u2192 ancien)": "Date (newest first)",
    "Date (ancien \u2192 r\u00e9cent)": "Date (oldest first)",
    "Montant (d\u00e9croissant)": "Amount (highest first)",
    "Cat\u00e9gorie (A \u2192 Z)": "Category (A \u2192 Z)",
    "Reste \u00e0 rembourser (d\u00e9croissant)": "Outstanding (highest first)",
    "Reste \u00e0 rembourser (croissant)": "Outstanding (lowest first)",
    "Compte source (A \u2192 Z)": "Source account (A \u2192 Z)",
    "Montant (croissant)": "Amount (lowest first)",
    "Nature (A \u2192 Z)": "Description (A \u2192 Z)",
    "Compte (A \u2192 Z)": "Account (A \u2192 Z)",

    // ---------- Divers construits en JavaScript ----------
    "Projet\u00e9": "Projected",
    "cot\u00e9 en": "quoted in",
    "r\u00e9el": "settled",
    "pr\u00e9visionnel": "forecast",
    "{montant} seront d\u00e9bit\u00e9s des esp\u00e8ces du compte.":
      "{montant} will be debited from the account's cash.",
    "{montant} seront cr\u00e9dit\u00e9s sur les esp\u00e8ces du compte.":
      "{montant} will be credited to the account's cash.",
    "virement : compte en face \u00e0 renseigner": "transfer: facing account to be filled in",
    "compte en face \u00e0 renseigner \u00e0 l'import": "facing account to be filled in at import",
    "D\u00e9pose un libell\u00e9 ici.": "Drop a label here.",
    "Aucune correspondance de devise m\u00e9moris\u00e9e (aucun preset ne lit peut-\u00eatre de colonne de devise).":
      "No currency mapping remembered (perhaps no preset reads a currency column).",
    "Colonne n\u00b0": "Column no.",
    "Cette propri\u00e9t\u00e9 est obligatoire : elle ne peut pas \u00eatre d\u00e9sactiv\u00e9e.":
      "This property is required: it cannot be switched off.",
    "Ne plus lire cette colonne": "Stop reading this column",
    "Lire cette colonne": "Read this column",
    "Renseigne le num\u00e9ro de colonne de : {proprietes}.":
      "Enter the column number for: {proprietes}.",

    // Propri\u00e9t\u00e9s d'import (tables PROPRIETES_IMPORT*), champs et op\u00e9rateurs de r\u00e8gle.
    "Cat\u00e9gorie bancaire": "Bank category",
    "Nature / libell\u00e9": "Description / label",
    "est": "is",
    "n'est pas": "is not",
    "contient": "contains",
    "ne contient pas": "does not contain",
    "Si": "If",
    "ET": "AND",
    "OU": "OR",
    "ou": "or",
  },
};

// Messages du serveur qui portent une partie variable (un nom de compte, un
// nombre, un libellé lu dans un relevé) : la correspondance exacte ne peut pas
// les retrouver. Le groupe capturé est réinjecté tel quel — c'est de la donnée,
// elle ne se traduit pas. Ordre significatif : le premier motif qui accroche
// gagne, donc du plus précis au plus général.
const MOTIFS_SERVEUR = [
  [/^Monnaie du compte (.+) introuvable$/, "Currency of account $1 not found"],
  [/^Monnaie (.+) introuvable$/, "Currency $1 not found"],
  [/^Opération (.+) introuvable$/, "Transaction $1 not found"],
  [
    /^Fichier illisible en tant que base SQLite : (.+)$/,
    "File unreadable as a SQLite database: $1",
  ],
  [/^Fichier illisible : (.+)$/, "Unreadable file: $1"],
  [
    /^Impossible de mettre à jour le schéma de (.+) : (.+)$/,
    "Could not upgrade the schema of $1: $2",
  ],
  [
    /^Ce compte porte déjà des opérations en (.+) : supprime-les avant de retirer cette monnaie\.$/,
    "This account already carries transactions in $1: delete them before removing this currency.",
  ],
  [
    /^Un même mot-clé ne peut pas désigner deux (.+) différents : (.+)$/,
    "The same keyword cannot designate two different $1: $2",
  ],
  [/^Propriétés invalides : (.+)$/, "Invalid properties: $1"],
  [/^Propriétés obligatoires manquantes : (.+)$/, "Missing required properties: $1"],
  [
    /^Le compte « (.+) » ne porte pas cette monnaie \(possibles : (.+)\)\.$/,
    "Account “$1” does not hold this currency (possible: $2).",
  ],
  [
    /^Le compte (.+) « (.+) » ne porte pas la monnaie de cette ligne \(possibles : (.+)\)$/,
    "The $1 account “$2” does not hold this row's currency (possible: $3)",
  ],
  [
    /^Le compte (.+) « (.+) » ne porte pas cette monnaie \(possibles : (.+)\)\.$/,
    "The $1 account “$2” does not hold this currency (possible: $3).",
  ],
  [
    /^Le type « (.+) » est géré par la page Placements financiers et ne peut pas être posé ici\.$/,
    "The “$1” type is managed by the Investments page and cannot be set here.",
  ],
  [
    /^Le type « (.+) » ne peut pas être posé par une règle : les achats\/ventes de titres se saisissent depuis la page Placements financiers\.$/,
    "The “$1” type cannot be set by a rule: security purchases and sales are entered from the Investments page.",
  ],
  [
    /^Le total réglé \((.+)\) dépasse le montant de l'opération de règlement \((.+)\)$/,
    "The total settled ($1) exceeds the amount of the settling transaction ($2)",
  ],
  [
    /^operations_remboursees n'est valide que pour les types (.+)$/,
    "operations_remboursees is only valid for the types $1",
  ],
  [
    /^L'opération (.+) ne peut pas être réglée par une opération de type '(.+)'$/,
    "Transaction $1 cannot be settled by a transaction of type '$2'",
  ],
  [
    /^L'opération (.+) n'est pas dans la même monnaie que ce règlement : l'app ne convertit rien, règle-la depuis une opération de sa monnaie\.$/,
    "Transaction $1 is not in the same currency as this settlement: the app converts nothing, settle it from a transaction in its own currency.",
  ],
  [
    /^Le montant réglé pour l'opération (.+) dépasse le montant dû \((.+)\)$/,
    "The amount settled for transaction $1 exceeds the amount owed ($2)",
  ],
  [
    /^« (.+) » est coté en (.+), monnaie que le compte « (.+) » ne porte pas : ajoute-la au compte \(Paramètres > Comptes\) ou choisis un autre titre\.$/,
    "“$1” is quoted in $2, a currency account “$3” does not hold: add it to the account (Settings > Accounts) or choose another security.",
  ],
  [
    /^Quantité insuffisante : (.+) « (.+) » détenu\(s\) sur ce compte, (.+) demandé\(s\)$/,
    "Not enough held: $1 “$2” on this account, $3 requested",
  ],
  [/^champ inconnu : (.+) \(attendus : (.+)\)$/, "unknown field: $1 (expected: $2)"],
  [
    /^Import bloqué : (.+) ligne\(s\) portent des frais dans une monnaie qui n'est ni celle du montant ni celle du montant envoyé \(ligne (.+)\)\. Retire la colonne « Frais » de la configuration avancée, ou corrige la colonne de devise qui la qualifie\.$/,
    "Import blocked: $1 row(s) carry fees in a currency that is neither the amount's nor the amount sent's (row $2). Remove the “Fees” column from the advanced configuration, or correct the currency column that qualifies it.",
  ],
  [/^monnaie « (.+) » non résolue$/, "currency “$1” not resolved"],
  [
    /^sens « (.+) » non reconnu \(attendus : (.+)\)$/,
    "direction “$1” not recognised (expected: $2)",
  ],
  [/^état « (.+) » non reconnu \(attendus : (.+)\)$/, "status “$1” not recognised (expected: $2)"],
  [
    /^frais en « (.+) » : ce n'est pas la monnaie (.+) à laquelle ils devraient s'appliquer$/,
    "fees in “$1”: that is not the $2 currency they should apply to",
  ],
];

