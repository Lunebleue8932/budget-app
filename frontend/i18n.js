/**
 * Traduction de l'interface. Trois langues : le français, langue SOURCE,
 * l'anglais, et le portugais du Brésil (i18n-pt.js, chargé juste après ce
 * fichier).
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

const LANGUES = ["fr", "en", "pt"];
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
  for (const [motif, remplacement] of MOTIFS_PAR_LANGUE[langueActuelle] || []) {
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
    // LES DEUX VARIATIONS, qui ne mesurent pas la même chose. « brute » = ce
    // qui est passé sur le compte (gross) ; « attribuée » = ce que la période
    // coûte une fois chaque dépense ramenée au mois auquel elle appartient
    // (attributed). Les deux couples suivent la vue, mois ou année, comme le
    // couple d'au-dessus (cf. renderKpisDashboard).
    "Variation sur le mois brute": "Gross change this month",
    "Variation sur l'année brute": "Gross change this year",
    "Variation attribuée au mois": "Change attributed to this month",
    "Variation attribuée à l'année": "Change attributed to this year",

    // Le camembert des dépenses, l'objectif de répartition par catégorie
    // et les deux variations (cf. textes.js, où vivent les phrases d'aide).
    "Voir toutes les dépenses":
      "See all expenses",
    // Les libellés de l'infobulle partagée par les deux graphes et la légende
    // (cf. contenuInfobulleCategorie). « Part » et « Objectif » sont des
    // pourcentages, « Total » un montant.
    "Total": "Total",
    "Part": "Share",

    /* ===== Lot 10 : le budget total du mois et les deux vues du
       camembert. ===== */
    "État actuel":
      "Current state",
    "Lier":
      "Link",
    "liée à {n}":
      "linked to {n}",
    "« {nature} » sera liée à {n} opération(s) à la confirmation.":
      "« {nature} » will be linked to {n} transaction(s) on confirmation.",
    "Budgets par catégorie":
      "Category budgets",
    "Une valeur par catégorie, lue de deux façons. -- LE CURSEUR répartit ; les deux cases à sa droite montrent la même enveloppe en monnaie et en part du budget du mois. Bouger le curseur met les deux à jour. -- ÉCRIRE DANS L'UNE recalcule l'autre et replace le curseur. Ctrl+Entrée, ou un clic ailleurs, enregistre. -- L'ENVELOPPE répond à « combien puis-je encore dépenser là » : c'est elle que trace le trait rouge de l'histogramme du dashboard. La PART répond à « quelle portion de mon budget y va » : c'est elle que le camembert affiche en vue Budget. -- La somme des parts ne peut pas dépasser 100 %, donc la somme des enveloppes ne peut pas dépasser le budget du mois. Au-delà, la saisie est refusée et le message dit le plafond utilisable. -- Sans budget du mois posé, la case des parts n'a pas de dénominateur : elle reste éteinte, et seule l'enveloppe s'enregistre.":
      "One value per category, read two ways. -- THE SLIDER allocates; the two boxes to its right show the same envelope in currency and as a share of the month's budget. Moving the slider updates both. -- TYPING IN ONE recomputes the other and moves the slider. Ctrl+Enter, or a click elsewhere, saves. -- The ENVELOPE answers « how much can I still spend there »: it is what the red line on the dashboard histogram draws. The SHARE answers « what portion of my budget goes there »: it is what the pie chart shows in Budget view. -- The sum of shares cannot exceed 100 %, so the sum of envelopes cannot exceed the month's budget. Beyond that the entry is refused, and the message names the usable ceiling. -- With no month budget set, the share box has no denominator: it stays disabled, and only the envelope is saved.",
    "Budget du mois":
      "Month budget",
    "Budget de la catégorie":
      "Category budget",
    "Part du budget":
      "Share of budget",
    "sur":
      "of",
    "hérité":
      "inherited",
    "Budget du mois enregistré.":
      "Month budget saved.",
    "Montant invalide.":
      "Invalid amount.",
    "Le budget se pose mois par mois : choisis un mois pour l'écrire.":
      "The budget is set month by month: pick a month to write it.",
    "Ces chiffres ne s'accordent pas":
      "These figures do not agree",
    "Laisser tel quel":
      "Leave as is",
    "au lieu de":
      "instead of",
    "Mettre le budget à":
      "Set the budget to",
    "Mettre l'objectif à":
      "Set the target to",
    "Mettre le budget du mois à":
      "Set the month budget to",
    "Les parts sont rapportées au BUDGET DU MOIS et non au total dépensé : l'anneau reste donc ouvert sur ce qui n'a pas encore été dépensé. C'est la seule vue où l'objectif d'une catégorie veut dire quelque chose — rapportées au total dépensé, les parts somment 100 % par construction, et une catégorie ne peut tenir sa cible que si toutes les autres tiennent la leur. Ici, chacune est indépendante : « l'alimentaire devait peser 30 % de mon budget, il en pèse 22 % ».":
      "Shares are measured against the MONTH BUDGET and not against the total spent: the ring therefore stays open on what has not been spent yet. This is the only view where a category's target means anything — measured against the total spent, shares add up to 100 % by construction, and a category can only meet its target if every other one meets its own. Here each is independent: « groceries were meant to weigh 30 % of my budget, they weigh 22 % ».",
    "Le budget d'une catégorie devrait valoir le budget du mois multiplié par son objectif en pourcentage. Ces trois chiffres se saisissent séparément, et rien n'oblige à les poser tous — mais quand les trois existent et se contredisent, il faut choisir lequel a raison. Rien n'a été corrigé automatiquement : ta dernière saisie est enregistrée telle quelle, et tu peux très bien la laisser ainsi.":
      "A category's budget should equal the month budget multiplied by its target percentage. These three figures are entered separately, and nothing forces you to set them all — but when all three exist and contradict each other, you have to choose which one is right. Nothing was corrected automatically: your last entry is saved as it is, and you may well leave it that way.",

    /* ===== Lot 9 : le gel de l'infobulle et l'onglet « Paramètres
       généraux ». ===== */
    "Paramètres généraux":
      "General settings",
    "Touche qui fige l'infobulle":
      "Key that freezes the tooltip",
    "Clique ici, puis appuie sur la touche":
      "Click here, then press the key",
    "Touche par défaut":
      "Default key",
    "Désactiver":
      "Disable",
    "Désactivé":
      "Disabled",
    "Touche enregistrée.":
      "Key saved.",
    "Figée — {touche} ou Échap pour libérer":
      "Frozen — {touche} or Esc to release",
    "Ce qui règle ta façon de te servir de l'application, et non ton budget : ces réglages vivent sur CE poste, pas dans la base. Changer de machine ne les emporte pas, et effacer les données du navigateur les remet à leur valeur d'origine.":
      "What settles the way you use the application, not your budget: these settings live on THIS machine, not in the database. Moving to another machine does not carry them over, and clearing the browser's data puts them back to their original value.",
    "Clique dans le champ, puis appuie sur la touche (ou la combinaison) que tu veux. Elle est enregistrée aussitôt. Elle n'agit jamais pendant que tu écris dans un champ de saisie, pour ne pas t'empêcher de taper la lettre elle-même.":
      "Click in the field, then press the key (or combination) you want. It is saved at once. It never acts while you are typing in an input field, so that it does not stop you writing the letter itself.",
    "L'infobulle des graphes suit le curseur et disparaît dès qu'on le retire : tout ce qu'elle contient doit donc se lire sans bouger la souris. Cette touche la FIGE là où elle est — le survol des graphes cesse de la remplacer, et tu récupères ton curseur pour lire son top 3 ou cliquer son bouton tranquillement. La même touche, un clic à côté ou Échap la libèrent.":
      "The charts' tooltip follows the cursor and vanishes as soon as you take it away: everything in it therefore has to be read without moving the mouse. This key FREEZES it where it is — hovering the charts stops replacing it, and you get your cursor back to read its top 3 or click its button at leisure. The same key, a click beside it or Esc release it.",

    /* ===== Lot 8 : l'écran « Intérêts perçus ». Presque tout y était bâti
       en JS, donc jamais vu par traduireDomStatique (qui ne passe qu'une
       fois, sur le DOM statique) : les clés existaient déjà, personne ne
       les demandait. ===== */
    "Saisis ce que la banque t'a réellement versé, tel que le relevé l'annonce. Rien n'est calculé à ta place : un taux annuel ne peut pas retrouver le bon chiffre quand il change en cours d'année. Seuls les comptes d'épargne sont ici. Ces montants S'AJOUTENT AU SOLDE du compte, sans être écrits en opération : ils n'apparaissent donc pas dans la page Opérations et ne pèsent sur aucun flux du mois. ATTENTION SI TON RELEVÉ LES PORTE AUSSI : importer la ligne d'intérêts après l'avoir saisie ici compterait la somme deux fois — saisis-la ici, ou importe-la, pas les deux.":
      "Enter what the bank actually paid, exactly as the statement announces it. Nothing is computed for you: an annual rate cannot recover the right figure when it changes mid-year. Only savings accounts appear here. These amounts ARE ADDED TO THE ACCOUNT BALANCE without being written as transactions: they do not show up in the Transactions page and weigh on no monthly flow. CAREFUL IF YOUR STATEMENT CARRIES THEM TOO: importing the interest line after entering it here would count the sum twice — enter it here, or import it, not both.",
    "Versé":
      "Paid",
    "Supprimer ce versement":
      "Delete this payment",
    "Aucun compte d'épargne. Crée-en un depuis Paramètres → Comptes en choisissant le type « épargne », puis reviens ici.":
      "No savings account. Create one from Settings → Accounts by choosing the « savings » type, then come back here.",
    /* Le mode de saisie d'un taux, posé par l'extension « Lecture de cours ». */
    "Depuis un lien": "From a link",

    /* ===== Reprise de traduction, lot 7 : le bandeau « Base de données ». ===== */
    "Cette base est dans le dossier de l'application ({dossier}). Une mise à jour la remplacera : déplace-la ailleurs, par exemple {propose}.":
      "This database is in the application folder ({dossier}). An update will replace it: move it elsewhere, for example {propose}.",
    "La base retenue au dernier lancement est introuvable : {chemin}. L'application est repartie sur son emplacement par défaut — rien n'a été effacé, le fichier est simplement ailleurs (disque débranché, dossier renommé).":
      "The database kept at the last launch cannot be found: {chemin}. The application restarted from its default location — nothing was erased, the file is simply elsewhere (disk unplugged, folder renamed).",
    "Build de test construit en local : cette copie ouvre toujours sa propre base de test et n'écrit jamais dans la configuration de l'application. Changer de base ne vaut que pour cette session. Supprime le fichier BUILD-DE-TEST.txt à côté de l'exécutable pour qu'elle se comporte comme une version publiée.":
      "Test build made locally: this copy always opens its own test database and never writes to the application's configuration. Switching database only holds for this session. Delete the BUILD-DE-TEST.txt file next to the executable for it to behave like a released version.",
    "Serveur de développement : la base de l'application est celle du dépôt, et rien n'est écrit dans la configuration. Changer de base ne vaut que pour cette session.":
      "Development server: the application's database is the repository's, and nothing is written to the configuration. Switching database only holds for this session.",
    "Ce choix n'a pas pu être enregistré : il ne vaudra que pour cette session.":
      "This choice could not be saved: it will only hold for this session.",

    /* ===== Reprise de traduction, lot 6 : les messages d'état vide, qui
       ne traversaient pas `t()` et n'étaient donc pas traduisibles. ===== */
    "Aucune correspondance de catégorie mémorisée.":
      "No category mapping remembered.",
    "Aucune correspondance de compte mémorisée.":
      "No account mapping remembered.",
    "Aucune règle pour le moment : les lignes importées resteront à classer à la main.":
      "No rule for now: imported rows will stay to be filed by hand.",
    "Ajoute d'abord un titre dans « Titres suivis » ci-dessous.":
      "Add a security under « Titres suivis » below first.",
    /* ===== Reprise de traduction, lot 5 : les NŒUDS TEXTE ENTIERS des
       paragraphes d'aide. Un nœud va d'une balise à l'autre, retours à la
       ligne compris — c'est la phrase complète qui se traduit, pas ses
       lignes. ===== */
    ": aucun intérêt n'est écrit en opération, aucun solde et aucun chiffre du dashboard n'en dépend. Si le versement figure sur ton relevé, il entrera de lui-même par l'import — le saisir ici en plus ne le compterait pas deux fois dans tes soldes, mais ne le remplace pas non plus.":
      ": no interest is written as a transaction, and no balance or dashboard figure depends on it. If the payment appears on your statement, it will come in through the import on its own — recording it here as well would not count it twice in your balances, but it does not replace it either.",
    "Aucun titre détenu pour le moment. Achète ou importe des titres depuis l'onglet Placements financiers, et la répartition apparaîtra ici.":
      "No securities held yet. Buy or import securities from the Investments page, and the breakdown will appear here.",
    "Le navigateur ne transmet jamais le chemin complet d'un fichier choisi via « Parcourir » (limite de sécurité) : ce bouton ne pré-remplit que le nom du fichier, complète le dossier à la main.":
      "The browser never passes the full path of a file picked through « Browse… » (a security limit): this button only pre-fills the file name, complete the folder by hand.",
    "Les doublons repérés sont déjà cochés. Tant qu'il en reste de cochés, l'import attend : supprime-les, ou décoche ceux que tu veux importer quand même. « Modifier » sert aussi à changer le type d'une ligne.":
      "The duplicates spotted are already ticked. While any stay ticked, the import waits: delete them, or untick the ones you want to import anyway. « Edit » also serves to change the type of a row.",
    "Quand tu importes les relevés de tes deux banques, le même virement apparaît des deux côtés, écrit de deux façons différentes. L'app compare ici la":
      "When you import the statements of both your banks, the same transfer appears on both sides, written two different ways. The app compares here the",
    "Un libellé que l'app ne connaît pas encore atterrit dans « Autres » : coche « Confirmer » pour le laisser là, ou choisis une autre catégorie. Rien ne presse — tu peux aller créer une catégorie ailleurs dans l'app et revenir, l'import t'attend.":
      "A label the app does not know yet lands in « Autres »: tick « Confirm » to leave it there, or pick another category. No rush — you can go and create a category elsewhere in the app and come back, the import waits for you.",
    "elle-même — le compte, les devises, le montant, une date proche — et te montre à quoi chaque ligne ressemble. Rien n'est bloqué ni coché d'avance : toi seul sais si tu as vraiment viré deux fois.":
      "itself — the account, the currencies, the amount, a nearby date — and shows you what each row looks like. Nothing is blocked or ticked in advance: only you know whether you really transferred twice.",
    "« Basculer » exige un fichier existant. « Créer / déplacer ici » accepte un chemin neuf : il y déplace la base ouverte si elle est encore dans le dossier de l'application, et en crée une vierge sinon.":
      "« Switch to this file » requires an existing file. « Create / move here » accepts a new path: it moves the open database there if it is still in the application folder, and creates a blank one otherwise.",
    "À utiliser si le fichier n'est pas lu correctement (colonnes mélangées, montants illisibles) : la détection automatique du délimiteur et de la virgule décimale française ne convient pas à tous les formats d'export.":
      "Use this if the file is not read correctly (mixed-up columns, unreadable amounts): automatic detection of the delimiter and the French decimal comma does not suit every export format.",
    "— l'endroit qu'une mise à jour remplace. Choisis-lui une place ailleurs : ce sera fait une fois pour toutes.":
      "— the very place an update replaces. Give it a place elsewhere: it will be done once and for all.",
    "intérêts 2025":
      "2025 interest",

    /* ===== Reprise de traduction, lot 4 : les dernières phrases longues,
       dont la clé est reprise MOT POUR MOT du texte affiché. ===== */
    "Ajoute, renomme et supprime des monnaies, pour suivre des comptes et des budgets dans plusieurs devises. Chaque solde reste suivi séparément ; une case du dashboard permet, si tu as saisi un taux, de tout ramener à une seule monnaie le temps d'un coup d'œil. Sans cette extension, l'application est mono-devise.":
      "Adds, renames and deletes currencies, to track accounts and budgets in several currencies. Each balance stays tracked separately; a « Tout convertir » box brings them back to a single currency, at the rate you enter. Without it, the application is single-currency.",
    "Ce que l'opération a coûté ou rapporté en espèces. C'est lui qui fait foi : le prix par titre vaut montant ÷ quantité, pas le cours annoncé. Ton solde colle ainsi au relevé, frais de courtage compris.":
      "What the transaction cost or brought in cash. It is THIS that counts: the imported unit price is amount ÷ quantity, not the quoted price. Your cash balance moves by this amount.",
    "Ce que la ligne décrit : un achat, une vente, ou un transfert d'espèces. Les mots-clés se règlent juste en dessous. Un libellé inconnu met la ligne en erreur plutôt que d'être deviné.":
      "What the row describes: a purchase, a sale, or a cash transfer to or from another account. The keywords are set just below. An unknown label puts the row in error rather than guessing.",
    "Ce qui PART du compte, avant frais et avant conversion ; « Montant » décrit alors ce qui ARRIVE. C'est le couple qu'il faut pour importer un virement entre deux devises : seul ton relevé connaît les deux montants.":
      "What LEAVES the account, before fees and before conversion; « Montant » then describes what ARRIVES. This is the pair needed to import a transfer between two currencies: without it, the app cannot know at what rate it was done.",
    "Classe automatiquement les lignes d'un relevé d'après leurs libellés : type d'opération, catégorie, compte en face d'un virement. Vue liste ordonnée ou vue galerie par dossiers. Les règles restent en base quand l'extension est éteinte — l'import cesse simplement de les consulter.":
      "Automatically classifies a statement's rows by their labels: transaction type, category, account opposite a transfer. Ordered list view or folder view, grouped conditions, splitting a row across several categories. With no rule written, the import behaves exactly as before.",
    "Le code ISIN du titre (FR0000120073, LU1681043599…). Seul nom qui ne change jamais : c'est par lui qu'un titre est reconnu d'un import à l'autre. Facultatif si tu lis le nom de la valeur.":
      "The security's ISIN code (FR0000120073, LU1681043599…). It is the only name that never changes: it is by it that a security is recognised from one import to the next. Optional if you read the name.",
    "Le montant de la ligne, avec son signe : négatif il sort, positif il entre. Si ton relevé sépare sorties et entrées en deux colonnes, éteins celle-ci et règle « Montant au débit » et « Montant au crédit ».":
      "The row's amount, with its sign: negative it goes out, positive it comes in. If your statement splits outgoings and incomings into two columns, switch this one off and switch the two dedicated columns on.",
    "Le nom du titre tel que ton courtier l'écrit. Facultatif si tu lis l'ISIN, mais il faut l'un des deux : sans eux, une ligne d'achat ne dit pas de quelle valeur elle parle.":
      "The security's name as your broker writes it. Optional if you read the ISIN code, but one of the two is indispensable: without them, a purchase row does not say which security it is about.",
    "Le prix par titre annoncé par le relevé. Il ne décide de rien, il sert de contrôle : un écart de plus de 1 % avec le montant divisé par la quantité est signalé au-dessus de l'aperçu, sans bloquer l'import.":
      "The price per security announced by the statement. It decides nothing, it serves as a check: a gap of more than 1 % with the amount divided by the quantity is reported.",
    "Les frais prélevés par la banque. C'est leur DEVISE qui décide auquel des deux montants ils se rapportent : dans la monnaie envoyée ils s'y ajoutent, dans celle reçue ils s'en retranchent. Dans une troisième, l'import est refusé plutôt que de fausser un solde.":
      "The fees charged by the bank. It is their CURRENCY that decides which of the two amounts they relate to: in the currency sent they add to it, in the currency received they are taken from it.",
    "Lit une liste d'opérations exportée depuis un compte de placements (achats, ventes, transferts d'espèces) et l'importe en une fois, sur le modèle de l'import de relevé bancaire : un preset par courtier, un aperçu ligne par ligne avant validation, et la même détection de doublons. Les titres inconnus sont créés à l'import, avec leur code ISIN. Nécessite « Placements financiers » : sans elle, il n'y a aucun compte-titres où importer.":
      "Reads a list of transactions exported from an investment account (purchases, sales, cash transfers) and imports it in one go, modelled on the bank import. Also handles account snapshots (one row per security held). Requires « Placements financiers ».",
    "Lit une liste d'opérations exportée depuis un compte de placements : achats, ventes et":
      "Reads a list of transactions exported from an investment account (purchases, sales, cash transfers) and imports it in one go, modelled on the bank import. Also handles account snapshots (one row per security held). Requires « Placements financiers ».",
    "Note ce que chaque compte d'épargne t'a RÉELLEMENT rapporté : un montant, une date, tels que le relevé les annonce. Les totaux se font par année et par monnaie, jamais deux devises additionnées. Remplace le système de taux d'intérêt : un taux annuel et une fréquence ne pouvaient reconstituer le bon chiffre que si l'app connaissait tous les mouvements du compte depuis son ouverture, et divergeaient du relevé dès qu'un taux changeait en cours d'année ou qu'un import était partiel. Aucun intérêt n'est écrit en opération : c'est un suivi d'affichage, qui ne touche ni aux soldes ni au dashboard. S'ouvre depuis la page Comptes, au-dessus des comptes d'épargne.":
      "Records what each savings account REALLY earned you: an amount, a date, as the statement announces them. Totals are per year and per currency. Nothing is written as a transaction: no balance and no dashboard figure depends on it.",

    /* ===== Reprise de traduction, lot 3 : les phrases d'aide longues, les
       descriptions d'extension et les derniers fragments d'écran. ===== */
    "Le compte émetteur et le compte récepteur doivent être différents, sauf pour une":
      "The sending and receiving accounts must differ, except for a",
    "Renseigne le montant reçu : les deux comptes sont dans des monnaies différentes":
      "Fill in the amount received: the two accounts are in different currencies",
    "Générée automatiquement par une opération récurrente : modifie ou arrête la récurrence":
      "Generated automatically by a recurring transaction: edit or stop the recurrence",
    "La dépense reste datée du jour où l'argent est sorti — les soldes et les KPI du haut":
      "The expense stays dated the day the money left — the balances and the KPIs at the top",
    "du dashboard ne bougent pas. Seuls l'histogramme et les totaux de la période":
      "of the dashboard do not move. Only the histogram and the period totals",
    "« Autres » ne peut pas être renommée : c'est la catégorie de repli.":
      "« Autres » cannot be renamed: it is the fallback category.",
    "Dépose l'export Excel ou CSV de ta banque. Avant de valider, tu auras deux choses à":
      "Drop your bank's Excel or CSV export. Before confirming, you will have two things to",
    "faire : dire dans quelles catégories ranger les libellés que l'app ne connaît pas encore,":
      "do: say which categories the labels the app does not know yet belong to,",
    "Un libellé que l'app ne connaît pas encore atterrit dans « Autres » : coche":
      "A label the app does not know yet lands in « Autres »: tick",
    "« Confirmer » pour le laisser là, ou choisis une autre catégorie. Rien ne presse — tu peux":
      "« Confirmer » to leave it there, or pick another category. No rush — you can",
    "aller créer une catégorie ailleurs dans l'app et revenir, l'import t'attend.":
      "go and create a category elsewhere in the app and come back, the import waits for you.",
    "Quelle colonne du fichier porte quoi. Les numéros sont ceux d'Excel : la première":
      "Which column of the file carries what. The numbers are Excel's: the first",
    "Clique sur l'œil pour lire ou ignorer une colonne. Date, Nature et Montant sont":
      "Click the eye to read or skip a column. Date, Nature and Amount are",
    "Pour ce que ton relevé dit en plus : le compte, le sens, les devises, les frais.":
      "For what your statement says on top: the account, the direction, the currencies, the fees.",
    "Laisse vide si ton relevé tient dans une seule colonne de montant et une seule monnaie.":
      "Leave empty if your statement fits in a single amount column and a single currency.",
    "Laisse vide pour garder les mots-clés reconnus par défaut, rappelés sous chaque":
      "Leave empty to keep the keywords recognised by default, listed under each",
    "champ. Dès que tu en ajoutes un, il remplace toute la liste par défaut de ce sens-là.":
      "field. As soon as you add one, it replaces the whole default list for that direction.",
    "Laisse vide pour garder les mots-clés reconnus par défaut. Dès que tu en ajoutes":
      "Leave empty to keep the keywords recognised by default. As soon as you add",
    "À régler seulement si le fichier est mal lu : colonnes mélangées, montants":
      "Only worth setting if the file is read wrong: mixed-up columns, unreadable",
    "Les colonnes colorées sont celles que l'app va lire, les grises sont ignorées. Deux":
      "The coloured columns are the ones the app will read, the grey ones are ignored. Two",
    "façons de corriger un décalage : glisser un en-tête sur un autre pour échanger les":
      "ways to fix a mismatch: drag one header onto another to swap the",
    "deux colonnes, ou saisir les numéros dans « Configuration du fichier » au-dessus.":
      "two columns, or type the numbers in « Configuration du fichier » above.",
    "Les colonnes ont changé depuis la dernière lecture. Relire le fichier pour voir ce que":
      "The columns changed since the last read. Re-read the file to see what",
    "l'import donnera, puis « Enregistrer la configuration » pour garder cet ordre dans le":
      "the import will give, then « Enregistrer la configuration » to keep this order in the",
    "Les doublons repérés sont déjà cochés. Tant qu'il en reste de cochés, l'import attend :":
      "The duplicates spotted are already ticked. While any stay ticked, the import waits:",
    "supprime-les, ou décoche ceux que tu veux importer quand même. « Modifier » sert aussi à":
      "delete them, or untick the ones you want to import anyway. « Edit » also serves to",
    "Ces lignes sont identiques à des lignes déjà importées : chacune est suivie de celle":
      "These rows are identical to rows already imported: each is followed by the one",
    "qu'elle recopie. Elles sont cochées pour être écartées d'un clic — décoches-en une pour":
      "it copies. They are ticked to be set aside in one click — untick one to",
    "l'importer quand même, deux achats identiques le même jour ça arrive.":
      "import it anyway; two identical purchases on the same day do happen.",
    "Ces transferts ressemblent à un virement déjà enregistré : même montant, mêmes":
      "These transfers look like a transfer already recorded: same amount, same",
    "comptes, à quelques jours près. C'est normal — le même mouvement figure sur le relevé":
      "accounts, within a few days. That is normal — the same movement appears on the statement",
    "de tes deux banques, le même virement apparaît des deux côtés, écrit de deux façons":
      "of both your banks, the same transfer shows on both sides, written two ways",
    "Rien n'est bloqué ni coché d'avance : toi seul sais si tu as vraiment viré deux fois.":
      "Nothing is blocked or ticked in advance: only you know whether you really transferred twice.",
    "le montant, une date proche — et te montre à quoi chaque ligne ressemble.":
      "the amount, a nearby date — and shows you what each row looks like.",
    "(limite de sécurité) : ce bouton ne pré-remplit que le nom du fichier, complète le":
      "(security limit): this button only pre-fills the file name, complete the",
    "Le navigateur ne transmet jamais le chemin complet d'un fichier choisi via « Parcourir »":
      "The browser never passes the full path of a file picked through « Browse… »",
    "Tes comptes et tes opérations vivent dans un seul fichier. Il est pour l'instant":
      "Your accounts and transactions live in a single file. It currently sits",
    "remplace. Choisis-lui une place ailleurs : ce sera fait une fois pour toutes.":
      "replaces. Give it a place elsewhere: it will be done once and for all.",
    "« Basculer » exige un fichier existant. « Créer / déplacer ici » accepte un chemin neuf :":
      "« Switch to this file » requires an existing file. « Create / move here » accepts a new path:",
    "il y déplace la base ouverte si elle est encore dans le dossier de l'application, et en":
      "it moves the open database there if it is still in the application folder, and",
    "Une base restée à une version de schéma antérieure est mise à jour à la bascule, après":
      "A database left at an earlier schema version is updated on switching, after a",
    "copie horodatée à côté du fichier d'origine : une application neuve ne sait pas lire une":
      "timestamped copy next to the original file: a fresh application cannot read an",
    "base ancienne, et échouerait sinon sur ses pages principales sans dire pourquoi.":
      "old database, and would otherwise fail on its main pages without saying why.",
    "Une règle classe automatiquement les lignes importées d'après leurs libellés — c'est le seul":
      "A rule automatically classifies imported rows by their labels — it is the only",
    "moyen de marquer une ligne \"remboursable\" ou de la classer en Prêt / Remboursement sans le":
      "way to mark a row \"reimbursable\" or to file it as a Loan / Repayment without doing it",
    "faire à la main. Les règles sont communes à tous les presets d'import.":
      "by hand. Rules are shared by every import preset.",
    "correspond — sauf si celle-ci décoche « Arrêter la lecture des règles ici ». Plusieurs règles peuvent alors s'appliquer à une même ligne, mais aucune ne":
      "matches — unless that one unticks « Arrêter la lecture des règles ici ». Several rules can then apply to the same row, but none",
    "ne peut plus être défait par une correspondance de catégorie.":
      "can no longer be undone by a category mapping.",
    ", qui reste celui de la vue liste (le numéro sur chaque carte le":
      ", which stays that of the list view (the number on each card",
    "rappelle). Fais glisser une règle d'un dossier à l'autre pour la ranger. Ce classement":
      "reminds you). Drag a rule from one folder to another to file it. This filing",
    "reste sur cet ordinateur — il n'est pas enregistré dans la base.":
      "stays on this computer — it is not saved in the database.",
    "Le type détermine ce qui suit : seules « Opération classique » et « Dépense":
      "The type decides what follows: only « Opération classique » and « Dépense",
    "remboursable » laissent choisir une catégorie — les autres types imposent la leur.":
      "remboursable » let you pick a category — the other types impose their own.",
    "Les groupes se combinent entre eux ; à l'intérieur d'un groupe, les conditions se":
      "Groups combine with each other; inside a group, conditions combine",
    "combinent selon leur propre connecteur. Deux niveaux suffisent à écrire":
      "by their own connector. Two levels are enough to write",
    "Chaque part dit combien elle prend. On peut écrire un nombre (50), un":
      "Each share says how much it takes. You can write a number (50), a",
    "pourcentage (30%), une opération (montant - 50), ou utiliser min et max":
      "percentage (30%), an operation (montant - 50), or use min and max",
    "— par exemple min(montant; 50) pour « au plus 50 € ». Le mot reste donne":
      "— for example min(montant; 50) for « at most 50 € ». The word reste gives",
    "à une part tout ce que les autres n'ont pas pris ; une seule part peut le":
      "one share everything the others did not take; only one share can",
    "transferts d'espèces. Rien n'entre en base avant que tu ne valides l'aperçu.":
      "cash transfers. Nothing enters the database before you confirm the preview.",
    "Aucun compte de placements financiers. Crée-en un depuis la page Comptes en choisissant":
      "No investment account. Create one from the Accounts page by choosing",
    "Chaque colonne lue est colorée et porte le nom de la propriété qui sera importée. Les":
      "Each column read is coloured and carries the name of the property that will be imported. The",
    "colonnes grises sont ignorées. Si une couleur ne tombe pas en face des bonnes données,":
      "grey columns are ignored. If a colour does not land on the right data,",
    "corrige les numéros de colonne dans \"Configuration du fichier\" au-dessus.":
      "fix the column numbers in \"Configuration du fichier\" above.",
    "À utiliser si le fichier n'est pas lu correctement (colonnes mélangées, montants":
      "Use this if the file is not read correctly (mixed-up columns, unreadable",
    "illisibles) : la détection automatique du délimiteur et de la virgule décimale":
      "amounts): automatic detection of the delimiter and the decimal comma",
    "Ces lignes ne seront pas importées telles quelles. Corrige-les avec \"Modifier\", ou":
      "These rows will not be imported as they are. Fix them with \"Modifier\", or",
    "supprime-les de l'aperçu — le reste du fichier s'importe normalement.":
      "delete them from the preview — the rest of the file imports normally.",
    "Chaque ligne jugée identique (hors colonnes exclues, cf. Configuration du fichier) à":
      "Each row judged identical (excluded columns aside, cf. Configuration du fichier) to",
    "une ligne déjà importée sous ce preset est affichée ici, suivie en lecture seule de":
      "a row already imported under this preset is shown here, followed read-only by",
    "celle qu'elle double. Elles sont pré-sélectionnées pour être supprimées d'un clic —":
      "the one it duplicates. They are pre-selected to be deleted in one click —",
    "décoche-en une pour l'importer quand même (deux achats identiques le même jour sont":
      "untick one to import it anyway (two identical purchases on the same day are",
    "Les doublons détectés sont pré-sélectionnés. Tant qu'il reste des lignes sélectionnées,":
      "Detected duplicates are pre-selected. While any rows stay selected,",
    "l'import est bloqué : supprime-les, ou décoche-les pour les importer quand même.":
      "the import is blocked: delete them, or untick them to import them anyway.",
    "touchent le compte de ce preset sont comparés. Rien n'est bloqué ni pré-sélectionné :":
      "touch this preset's account are compared. Nothing is blocked or pre-selected:",
    "toi seul sais si tu as vraiment fait deux fois le mouvement. Chaque ligne est suivie":
      "only you know whether you really made the movement twice. Each row is followed",
    "Le relevé ne décrit qu'un côté du mouvement : indique le compte en face. Le sens":
      "The statement describes only one side of the movement: give the account opposite. The direction",
    "Une ligne de compte-titres n'a pas de catégorie : un mouvement de titres n'en porte":
      "A securities-account row has no category: a securities movement carries none",
    "pas. Un transfert, lui, touche deux comptes et le relevé n'en nomme qu'un — la règle":
      "at all. A transfer, though, touches two accounts and the statement names only one — the rule",
    "« Achat » est un achat, et rien d'autre ne l'est. Quand le courtier écrit une phrase —":
      "« Achat » is a purchase, and nothing else is. When the broker writes a sentence —",
    "« ACHAT COMPTANT ETF MSCI WORLD », avec le nom du titre dedans — aucune liste de mots-clés":
      "« ACHAT COMPTANT ETF MSCI WORLD », with the security name inside — no keyword list",
    "ne peut la reconnaître, parce qu'il n'y a pas deux fois le même libellé dans le fichier.":
      "can recognise it, because no two rows share the same label in the file.",
    "correspond : contrairement aux règles bancaires, une règle de placement ne décide que":
      "matches: unlike bank rules, an investment rule decides only",
    "d'une chose, il n'y a donc rien à compléter en dessous. Place les cas particuliers":
      "one thing, so there is nothing to complete below. Put the special cases",
    "Sans aucune règle, l'import se comporte donc exactement comme avant.":
      "With no rule at all, the import therefore behaves exactly as before.",
    "c'est ainsi qu'une détention existe dans l'application, et c'est ce qui rend justes":
      "that is how a holding exists in the application, and it is what makes",
    "d'un coup la valorisation et les plus-values. Les espèces du compte baissent donc du":
      "the valuation and the gains right. The account's cash therefore drops by the",
    "total investi — pense à poser son solde initial en conséquence.":
      "total invested — remember to set its opening balance accordingly.",
    "Ce fichier est-il une PHOTOGRAPHIE du compte (une ligne par titre détenu) ? OK : photographie. Annuler : liste d'opérations (achats, ventes, transferts).":
      "Is this file a SNAPSHOT of the account (one row per security held)? OK: snapshot. Cancel: list of transactions (purchases, sales, transfers).",
    "Aucun type. Ajoutes-en un ci-dessous si tu veux regrouper tes titres.":
      "No type. Add one below if you want to group your securities.",
    "le type \"Placements financiers\", puis alimente-le par un virement interne.":
      "the \"Placements financiers\" type, then fund it with an internal transfer.",
    "Supprimer « {nom} » ? Les {n} titre(s) qui le portent perdront leur type.":
      "Delete « {nom} »? The {n} securities carrying it will lose their type.",
    "Un projet ne se saisit pas depuis une opération : on le crée ici, puis on y verse les":
      "A project is not entered from a transaction: you create it here, then add the",
    "opération d'un projet ne la supprime pas, et supprimer un projet ne supprime aucune dépense.":
      "transaction from a project does not delete it, and deleting a project deletes no expense.",
    "Qui te doit combien, et à qui tu dois. Un profil est une étiquette : une personne, une":
      "Who owes you how much, and whom you owe. A profile is a label: a person, a",
    "entreprise, la colocation. Rien n'est recalculé ailleurs — les soldes, le dashboard et":
      "company, the flat share. Nothing is recomputed elsewhere — the balances, the dashboard and",
    "l'histogramme donnent exactement les mêmes chiffres, cet écran ne fait que les ventiler.":
      "the histogram give exactly the same figures, this screen only breaks them down.",
    "Non installée sur cette machine : le dossier de cette extension n'est pas présent ici.":
      "Not installed on this machine: this extension's folder is not present here.",
    "Additionne tes monnaies en une seule, au taux que tu as saisi dans Paramètres → Monnaies. Rien n'est modifié : décoche et tout revient. Une monnaie sans taux est laissée de côté, et signalée.":
      "Adds your currencies up into one, at the rate you entered in Settings → Currencies. Nothing is changed: untick and everything comes back. A currency without a rate is left aside, and reported.",
    "L'application lit et écrit dans un seul fichier .db. Tu choisis où il vit ; l'emplacement est retenu d'un lancement à l'autre.":
      "The application reads and writes a single .db file. You choose where it lives; the location is remembered from one launch to the next.",
    "Saisis ce que la banque t'a réellement versé, tel que le relevé l'annonce. Rien n'est calculé à ta place : un taux annuel ne peut pas retrouver le bon chiffre quand il change en cours d'année. Seuls les comptes d'épargne sont ici.":
      "Enter what the bank actually paid you, as the statement announces it. Nothing is computed for you: an annual rate cannot recover the right figure when it changes mid-year. Only savings accounts appear here.",
    "La catégorie que ta banque a posée elle-même sur la ligne. Elle ne devient pas une catégorie de l'app toute seule : tu fais le rapprochement une fois, il est retenu.":
      "The category your bank itself put on the row. It does not become an app category on its own: you make the match once, it is remembered.",
    "Le compte concerné, quand le fichier le nomme. Inutile si le preset est déjà lié à un compte : ce lien vaut pour toutes les lignes.":
      "The account concerned, when the file names it. Pointless if the preset is already tied to an account: that link holds for every row.",
    "À régler seulement si ton relevé n'écrit que des montants positifs et dit à part si l'argent entre ou sort. Les mots-clés reconnus se règlent juste en dessous.":
      "Only worth setting if your statement writes positive amounts only and says separately whether money comes in or goes out. The recognised keywords are set just below.",
    "La devise du montant. Sans elle, la ligne part dans la monnaie principale de son compte — faux dès qu'un compte en porte plusieurs.":
      "The amount's currency. Without it, the row goes into its account's main currency — wrong as soon as an account carries several.",
    "La devise du montant envoyé. Sans elle, l'app la suppose identique à celle du montant reçu, donc sans change.":
      "The currency of the amount sent. Without it, the app assumes it identical to that of the amount received, so with no exchange.",
    "La devise des frais, celle qui dit à quel montant ils s'appliquent. Sans elle, l'app les rattache au montant envoyé et te le signale à chaque import.":
      "The fees' currency, the one that says which amount they apply to. Without it, the app ties them to the amount sent and tells you so at every import.",
    "Où en est l'opération chez ta banque. Une ligne en attente devient une opération prévisionnelle, une ligne refusée n'est pas importée. Les mots-clés se règlent plus bas.":
      "Where the transaction stands at your bank. A pending row becomes a forecast transaction, a rejected row is not imported. The keywords are set further down.",
    "Pour les relevés qui SÉPARENT sorties et entrées en deux colonnes, chaque ligne n'en remplissant qu'une. La colonne remplie dit le sens. Un zéro vaut une case vide, une ligne qui remplit les deux part en erreur.":
      "For statements that SPLIT outgoings and incomings into two columns, each row filling only one. The filled column gives the direction. A zero counts as an empty box; a row filling both goes to error.",
    "L'autre moitié : ce qui ENTRE. Elle va toujours avec « Montant au débit » — allumer ou éteindre l'une fait la même chose à l'autre.":
      "The other half: what COMES IN. It always goes with « Montant au débit » — switching one on or off does the same to the other.",
    "Le nombre de titres achetés ou vendus. Sans objet sur une ligne de transfert d'espèces, qui peut la laisser vide.":
      "The number of securities bought or sold. Irrelevant on a cash-transfer row, which may leave it empty.",
    "L'étiquette du titre, si ton fichier la porte : ETF, obligation, action… Facultative, et sans effet sur un montant. Un libellé que tu n'as pas encore créé le sera à l'import. Un titre que l'app connaît déjà garde le type que tu lui as posé.":
      "The security's label, if your file carries it: ETF, bond, share… Optional, and with no effect on any amount. A label you have not created yet will be at import time. A security the app already knows keeps the type you gave it.",
    "Le nombre de titres que tu DÉTIENS au moment de la photographie. C'est cette quantité qui part en base : l'app ne sait pas comment tu y es arrivé, seulement ce que tu as.":
      "The number of securities you HOLD at the time of the snapshot. It is this quantity that goes into the database: the app does not know how you got there, only what you have.",
    "Ce qu'UN titre t'a coûté en moyenne, frais compris (le PRU). Par titre, pas le total investi. Si ton relevé donne le total, divise-le avant d'importer.":
      "What ONE security cost you on average, fees included. Per security, not the total invested. If your statement gives the total, divide it before importing.",
    "Ce que la ligne vaut aujourd'hui, tous titres confondus. Elle ne crée aucune détention : elle sert à déduire le cours du titre (valeur ÷ quantité), que ce genre d'export ne donne pas.":
      "What the row is worth today, all securities together. It creates no holding: it serves to deduce the security's price (value ÷ quantity), which this kind of export does not give.",
    "Suivi d'un portefeuille de titres : achat, vente, valorisation au dernier cours saisi et plus-values latentes, par compte de placements. Les cours sont saisis à la main — l'application ne consulte aucun service en ligne.":
      "Tracking of a securities portfolio: purchase, sale, valuation at the last price entered and unrealised gains, per investment account. Prices are entered by hand — the application queries no online service.",
    "Va lire un cours sur une page publique de cotation (Google Finance, Yahoo Finance, Boursorama…) : un lien par titre suivi et par couple de monnaies, un bouton de mise à jour sur l'écran concerné, et une relecture au lancement. Seule extension de l'application à émettre des requêtes vers Internet. Nécessite « Placements financiers » ou « Monnaies » : sans l'une des deux, elle n'a rien à mettre à jour.":
      "Reads a price from a public quotation page (Google Finance, Yahoo Finance, Boursorama…): one link per tracked security and per currency pair, an update button on the screen concerned, and a re-read at launch. The only extension in the application that sends requests to the Internet. Requires « Placements financiers » or « Monnaies »: without one of the two, it has nothing to update.",
    "Suit l'argent qu'on t'a prêté : ce que tu as reçu, ce que tu rendras — intérêts compris — et ce qu'il te reste à rembourser. Les intérêts d'un prêt sont ce qu'il te coûte vraiment : ils comptent dans les sorties du mois et forment leur propre barre dans l'histogramme du dashboard. Sans cette extension, les deux onglets « Prêts reçus » et « Remboursements de prêts » de la page Opérations restent fermés et aucun prêt ne pèse sur tes totaux.":
      "Tracks money lent to you: what you received, what you will give back — interest included — and what is left to repay. A loan's interest is what it really costs you: it counts in the month's outgoings and forms its own bar in the dashboard histogram. Without this extension, the two tabs « Prêts reçus » and « Remboursements de prêts » on the Transactions page stay closed and no loan weighs on your totals.",
    "Regroupe des opérations déjà saisies en projets — un voyage, un déménagement, un événement — pour lire d'un coup ce qu'ils ont coûté. Ce n'est pas une catégorie de plus : une catégorie classe une dépense par nature et porte un budget mensuel, un projet regroupe par événement à travers les catégories et les comptes, et une même opération peut appartenir à plusieurs projets. Rien n'est recalculé ailleurs : le total d'un projet est une somme affichée, jamais une donnée qui influe sur le dashboard ou les soldes. L'écran s'ajoute en onglet de la page des comptes.":
      "Groups transactions already entered into projects — a trip, a move, an event — to read at a glance what they cost. It is not one more category: a category files an expense by nature and carries a monthly budget, a project groups by event across categories and accounts, and one transaction can belong to several projects. Nothing is recomputed elsewhere: a project's total is a displayed sum, never a figure that affects the dashboard or the balances. The screen is added as a tab of the accounts page.",
    "Regarde le portefeuille dans son ensemble plutôt que compte par compte : un camembert de la répartition par type de titre (ETF, obligation, action…), avec le détail des lignes qui composent chaque part. Ne calcule aucun solde et ne modifie rien — c'est une lecture. Nécessite « Placements financiers », et les types de titre se créent depuis son écran.":
      "Looks at the portfolio as a whole rather than account by account: a pie chart of the breakdown by security type (ETF, bond, share…), with the detail of the lines making up each slice. Computes no balance and changes nothing — it is a read. Requires « Placements financiers », and security types are created from its screen.",
    "Répond à « qui me doit combien, et à qui est-ce que je dois ». Sans cette extension, les deux onglets « Dépenses remboursables » et « Remboursements reçus » de la page Opérations restent fermés et aucune dépense remboursable ne pèse sur tes totaux (flux du mois, histogramme, « Reste à rembourser ») — exactement comme les prêts sans l'extension « Prêts ». Une fois activée, tu peux en plus créer des profils — une personne, une entreprise, la colocation — et y rattacher tes dépenses remboursables, tes prêts reçus et leurs règlements. L'écran donne alors, par monnaie, le solde net de chaque profil, ce qu'il te doit face à ce que tu lui dois, et le détail des lignes encore ouvertes. Un profil est une étiquette et rien de plus : le supprimer détache simplement ses opérations. L'écran s'ouvre depuis la carte « Reste à rembourser » du dashboard.":
      "Answers « who owes me how much, and whom do I owe ». Without this extension, the two tabs « Dépenses remboursables » and « Remboursements reçus » on the Transactions page stay closed and no reimbursable expense weighs on your totals (month flows, histogram, « Reste à rembourser ») — exactly like loans without the « Prêts » extension. Once enabled, you can also create profiles — a person, a company, the flat share — and attach your reimbursable expenses, your loans received and their settlements to them. The screen then gives, per currency, each profile's net balance, what it owes you against what you owe it, and the detail of the lines still open. A profile is a label and nothing more: deleting it simply detaches its transactions. The screen opens from the dashboard's « Reste à rembourser » card.",

    /* ===== Extension « Objectifs » ===== */
    "Objectifs":
      "Goals",
    "+ Nouvel objectif":
      "+ New goal",
    "Nouvel objectif":
      "New goal",
    "Modifier l'objectif":
      "Edit goal",
    "Supprimer l'objectif":
      "Delete goal",
    "Objectif enregistré":
      "Goal saved",
    "Donne un nom à cet objectif.":
      "Give this goal a name.",
    "Ce qu'on mesure":
      "What is measured",
    "Nombre de dépenses":
      "Number of expenses",
    "Montant total":
      "Total amount",
    "Montant moyen d'une dépense":
      "Average amount per expense",
    "Part des dépenses":
      "Share of expenses",
    "Toutes les dépenses":
      "All expenses",
    "Ne pas dépasser":
      "Stay under",
    "Atteindre au moins":
      "Reach at least",
    "Cible":
      "Target",
    "Afficher au dashboard":
      "Show on the dashboard",
    "Semaine":
      "Week",
    "Sur":
      "On",
    "Par":
      "Per",
    "ex. Sorties restaurant":
      "e.g. Eating out",
    "Aucun objectif pour cette monnaie. Le bouton ci-dessus en crée un.":
      "No goal for this currency. The button above creates one.",
    "par semaine":
      "per week",
    "par mois":
      "per month",
    "par dépense":
      "per expense",
    "des dépenses de la période":
      "of the period's expenses",
    "dépenses sur la période":
      "expenses over the period",
    "sur la période":
      "over the period",
    "semaines écoulées":
      "weeks elapsed",
    "mois écoulés":
      "months elapsed",
    "tenu":
      "met",
    "manqué":
      "missed",
    "cible":
      "target",
    "dépenses":
      "expenses",
    "Les objectifs te permettent de te fixer des cibles et les visualiser concrètement.":
      "Goals let you set yourself targets and see concretely where you stand.",
    "Quatre objectifs, deux manières de calculer. Montant total et part des dépenses fonctionnent comme les graphiques. Nombre de dépenses et montant moyen font abstraction des règles comme l'amortissement.":
      "Four goals, two ways of counting. Total amount and share of expenses work like the charts. Number of expenses and average amount ignore rules such as spreading.",
    "Te permet de régler la plage temporelle que couvre l'objectif. -- Si tu indiques mois et que le dashboard est sur la vue mois, tu vois le total. -- Si tu indiques mois et que le dashboard est en vue année, tu verras la moyenne sur tous les mois existants.":
      "Sets the span of time the goal covers. -- If you pick month and the dashboard is on the month view, you see the total. -- If you pick month and the dashboard is on the year view, you see the average over every month on record.",
    "Sur quoi porte l'objectif. -- Toutes les dépenses : tout ce qui sort, tous postes confondus. -- Une catégorie : elle classe une dépense par nature, et une dépense n'en a qu'une. -- Un projet : il regroupe par événement (un voyage, des travaux), à travers les catégories et les comptes. Une dépense peut appartenir à plusieurs projets. -- Une catégorie ou un projet, jamais les deux : les deux axes se croisent, et l'hôtel d'un voyage est à la fois dans « Loisirs » et dans « Italie ».":
      "What the goal is about. -- All expenses: everything that goes out, across the board. -- A category: it sorts an expense by nature, and an expense has only one. -- A project: it groups by event (a trip, building work), across categories and accounts. One expense can belong to several projects. -- A category or a project, never both: the two axes cross, and a trip's hotel is at once in « Loisirs » and in « Italie ».",
    "Un objectif peut n'avoir aucune cible : il se contente alors d'afficher son chiffre sous les graphes du dashboard, sans dire s'il est tenu ou manqué. -- C'est le cas ordinaire d'un projet en cours : on veut voir ce qu'il coûte bien avant de savoir ce qu'on s'autorise. -- Attention, une cible à zéro n'est pas « pas de cible » : c'est une règle, et une règle sévère (« rien du tout ce mois-ci »).":
      "A goal may have no target at all: it then simply shows its figure under the dashboard charts, without saying whether it is met or missed. -- That is the ordinary case of a project under way: you want to see what it costs long before you know what you will allow yourself. -- Careful, a target of zero is not « no target »: it is a rule, and a strict one (« nothing at all this month »).",
    "Se fixer une cible":
      "Set a target",
    "Ajouter un filtre":
      "Add a filter",
    "Montant au moins":
      "Amount at least",
    "Montant au plus":
      "Amount at most",
    "Libellé contenant":
      "Label containing",
    "Libellé ne contenant pas":
      "Label not containing",
    "Jours":
      "Days",
    "En semaine":
      "Weekdays",
    "Le week-end":
      "Weekends",
    "Ajouter un champ":
      "Add a field",
    "ex. café":
      "e.g. coffee",
    "Chaque filtre doit avoir une valeur.":
      "Each filter needs a value.",
    "sans":
      "without",
    "en semaine":
      "on weekdays",
    "le week-end":
      "at weekends",
    "Semaine en cours":
      "This week",
    "Moyenne du mois":
      "Month average",
    "cette semaine":
      "this week",
    "dépenses cette semaine":
      "expenses this week",
    "Des conditions que chaque dépense doit remplir pour être comptée : un montant minimum ou maximum, un mot présent ou absent du libellé, les jours de semaine ou le week-end. -- Toutes s'appliquent ensemble. -- Un objectif filtré compte les dépenses ligne par ligne : une dépense amortie y pèse entièrement sur le mois où elle a été faite.":
      "Conditions each expense must meet to be counted: a minimum or maximum amount, a word present in or absent from the label, weekdays or weekends. -- They all apply together. -- A filtered goal counts expenses line by line: a spread expense weighs entirely on the month it was made.",
    "Catégories":
      "Categories",
    "suivi":
      "tracked",
    "Aucun objectif. Le bouton ci-dessus en crée un.":
      "No goal yet. The button above creates one.",
    "Les objectifs cochés s'affichent sous les graphes du dashboard, sur la période et la monnaie que tu y regardes. Les autres restent ici. C'est devant tes dépenses du mois qu'on se demande si on tient sa règle — mais un bloc qui grandit sans fin finirait par repousser les graphes hors de l'écran.":
      "Ticked goals appear under the dashboard charts, for the period and currency you are looking at there. The others stay here. It is in front of the month's expenses that one wonders whether a rule is being kept — but a block that grows without end would eventually push the charts off screen.",
    "Ce que tu t'es fixé, mesuré sur la période affichée ci-dessus et dans la monnaie de l'onglet. Le grand chiffre est ramené à la cadence de l'objectif ; la ligne du dessous dit ce qui a servi à le calculer. Rien ici n'influe sur tes soldes ni sur tes graphes : un objectif regarde, il ne change aucun montant. Ils se créent et se modifient dans Budget → Objectifs.":
      "What you set yourself, measured over the period shown above and in the tab's currency. The large figure is brought back to the goal's cadence; the line below says what was used to compute it. Nothing here affects your balances or your charts: a goal observes, it changes no amount. They are created and edited in Budget → Goals.",

    /* ===== La notice d'utilisation et le tutoriel guidé ===== */
    "Relevé d'exemple enregistré :":
      "Sample statement saved:",
    "Écran introuvable :":
      "Screen not found:",
    "Le budget du mois est de {total} : cette catégorie ne peut pas dépasser {plafond}, sans quoi la somme des budgets par catégorie le dépasserait.":
      "The month's budget is {total}: this category cannot exceed {plafond}, otherwise the sum of category budgets would go over it.",

    /* ===== Règles : sorties conditionnelles et tutoriel ===== */
    "La règle détecte une fois, et peut agir de plusieurs façons selon la ligne. Chaque sortie a ses propres conditions : la première qui correspond remplace les actions de la règle qu'elle renseigne, les champs laissés vides gardent celles de la règle. Aucune ne correspond : la règle agit telle quelle. Exemple : une règle « Virement interne » avec une sortie « contient LIVRET → compte en face Livret A » et une autre « contient PEA → compte en face PEA ».":
      "The rule detects once, and can act in several ways depending on the row. Each output has its own conditions: the first one that matches replaces the rule's actions it fills in, fields left empty keep the rule's. None matches: the rule acts as is. Example: an “Internal transfer” rule with one output “contains LIVRET → other account Livret A” and another “contains PEA → other account PEA”.",
    "Sorties conditionnelles": "Conditional outputs",
    "+ Ajouter une sortie conditionnelle": "+ Add a conditional output",
    "Aucune : la règle fait toujours la même chose.": "None: the rule always does the same thing.",
    "Sortie": "Output",
    "Combiner les groupes": "Combine groups",
    "Supprimer la sortie": "Delete output",
    "Si la ligne…": "If the row…",
    "…alors, à la place de la règle :": "…then, instead of the rule:",
    "— celui de la règle —": "— the rule's —",
    "— celle de la règle —": "— the rule's —",
    "Chaque condition d'une sortie doit porter sur un champ et avoir une valeur.":
      "Each condition of an output must target a field and have a value.",
    "Une sortie conditionnelle doit changer au moins une chose.":
      "A conditional output must change at least one thing.",
    "{n} sortie(s) conditionnelle(s)": "{n} conditional output(s)",
    "Créer une règle": "Create a rule",
    "Écrire une règle de bout en bout : ce qu'elle détecte, ce qu'elle change, ses sorties conditionnelles, et l'ordre dans lequel les règles se lisent.":
      "Write a rule end to end: what it detects, what it changes, its conditional outputs, and the order in which rules are read.",
    "Les règles s'appliquent à chaque ligne importée, avant que tu ne la voies dans l'aperçu. Elles vivent ici, au-dessus des correspondances.":
      "Rules apply to every imported row, before you see it in the preview. They live here, above the mappings.",
    "Ce bouton ouvre l'éditeur d'une règle vide. On vient de l'ouvrir pour toi : rien n'est enregistré tant que tu ne cliques pas sur « Enregistrer ».":
      "This button opens the editor of an empty rule. We just opened it for you: nothing is saved until you click “Save”.",
    "Un nom qui dit ce que la règle fait, et une note qui dit pourquoi elle existe — dans six mois, c'est la seule chose qui manquera.":
      "A name that says what the rule does, and a note that says why it exists — in six months, that is the only thing you will be missing.",
    "Ce que la règle doit reconnaître. Une condition porte sur un champ de la ligne (libellé, catégorie bancaire, compte, montant) ; ses mots-clés se combinent en ET. Les groupes permettent d'écrire « (A ou B) et C ». Majuscules et accents sont ignorés.":
      "What the rule must recognise. A condition targets a field of the row (label, bank category, account, amount); its keywords combine with AND. Groups let you write “(A or B) and C”. Case and accents are ignored.",
    "Ce que la règle fait de la ligne reconnue : son type, puis sa catégorie (ou une découpe entre plusieurs). « — ne pas changer — » laisse le type aux règles suivantes.":
      "What the rule does with the recognised row: its type, then its category (or a split across several). “— leave unchanged —” leaves the type to the following rules.",
    "Tout le reste de la ligne peut changer aussi, sauf ses montants et sa date : son nom, son compte, une note, un amortissement. Un champ vide ne change rien.":
      "Everything else on the row can change too, except its amounts and date: its name, its account, a note, a spread. An empty field changes nothing.",
    "Quand ce que la règle doit faire dépend d'un détail de la ligne, inutile de la recopier : ajoute des sorties. Chacune a ses conditions et ses actions, et la première qui correspond l'emporte. Typiquement : une seule règle « Virement interne », une sortie par compte en face.":
      "When what the rule must do depends on a detail of the row, no need to copy it: add outputs. Each has its conditions and actions, and the first that matches wins. Typically: a single “Internal transfer” rule, one output per other account.",
    "Les règles se lisent de haut en bas. Coché, ce réglage arrête la lecture quand la règle correspond ; décoché, les suivantes peuvent compléter ce qu'elle a laissé ouvert. La plus haute l'emporte toujours.":
      "Rules are read top to bottom. Ticked, this setting stops reading when the rule matches; unticked, the following ones can complete what it left open. The highest always wins.",
    "L'ordre se change en glissant les règles dans la liste. La vue galerie les range par dossiers pour s'y retrouver, sans jamais changer cet ordre. Pour voir le résultat, importe un relevé : l'aperçu dit, ligne par ligne, quelle règle a agi.":
      "The order changes by dragging rules in the list. The gallery view sorts them into folders to find your way, without ever changing that order. To see the result, import a statement: the preview says, row by row, which rule acted.",
    "Les règles": "Rules",
    "Une nouvelle règle": "A new rule",
    "Son nom, et pourquoi elle existe": "Its name, and why it exists",
    "Ce qu'elle détecte": "What it detects",
    "Ce qu'elle fait": "What it does",
    "Et le reste de la ligne": "And the rest of the row",
    "Les sorties conditionnelles": "Conditional outputs",
    "S'arrêter, ou laisser compléter": "Stop, or let others complete",
    "L'ordre des règles": "The order of rules",


    /* ===== Import : deviner les colonnes ===== */
    "L'application lit le fichier et devine ce que dit chaque colonne, d'après son intitulé et la forme de ses cellules. Une colonne dont elle est sûre reçoit une seule proposition ; pour les autres, elle en propose plusieurs, et c'est toi qui choisis. Rien n'est enregistré tant que tu ne le demandes pas.":
      "The app reads the file and guesses what each column holds, from its heading and the shape of its cells. A column it is sure about gets a single suggestion; for the others it offers several, and you choose. Nothing is saved until you ask.",
    "Appliquer met ces colonnes à l'écran, sans rien enregistrer. Cliquer ensuite sur « Enregistrer la configuration » supprimera les colonnes enregistrées à la main dans ce preset, et les remplacera par ce que l'application a deviné.":
      "Applying puts these columns on screen, without saving anything. Clicking “Save configuration” afterwards will delete the columns saved by hand in this preset, and replace them with what the app guessed.",
    "La plupart des lignes sortent en erreur : les colonnes de ce preset ne semblent pas correspondre à ce fichier. « Deviner les colonnes » propose une configuration à partir du fichier lui-même.":
      "Most rows come out in error: this preset's columns do not seem to match this file. “Guess the columns” suggests a configuration from the file itself.",
    "Deviner les colonnes": "Guess the columns",
    "Ne pas importer": "Do not import",
    "sûr": "sure",
    "Ce que l'application devine": "What the app guesses",
    "Lignes de tête : {n}": "Header rows: {n}",
    "Appliquer ces colonnes": "Apply these columns",
    "« {propriete} » est choisie pour deux colonnes : garde-la sur une seule.":
      "“{propriete}” is chosen for two columns: keep it on one only.",
    "Colonnes appliquées à l'écran : relis le fichier pour voir le résultat, puis enregistre la configuration pour les garder.":
      "Columns applied on screen: re-read the file to see the result, then save the configuration to keep them.",

    "Un CSV écrit à l'anglo-saxonne": "A CSV written the English-speaking way",
    "Le tutoriel va afficher un fichier d'exemple à la place de celui que tu as chargé (rien n'a été importé). Continuer ?":
      "The tutorial will show a sample file instead of the one you loaded (nothing has been imported). Continue?",
    "Ce fichier d'exemple est chargé dans l'écran d'import, comme si tu l'avais déposé : fais défiler « Le fichier tel qu'il est » pour voir toutes ses colonnes. Rien n'est importé.":
      "This sample file is loaded in the import screen, as if you had dropped it: scroll “The file as it is” to see all its columns. Nothing is imported.",
    "Le fichier d'exemple n'a pas été chargé : ton propre fichier est resté à l'écran.":
      "The sample file was not loaded: your own file stayed on screen.",


    /* ===== Page Budget : les graphes et leur comparaison ===== */
    "Les deux graphes du dashboard, face à ton budget : les barres portent le trait rouge de l'enveloppe de chaque catégorie, le camembert rapporte chaque catégorie au budget de la période. « Comparer avec » superpose une seconde période de même durée — deux mois, deux années ou deux semaines — hachurée et grisée : par-dessus les barres, et en anneau dans le camembert.":
      "The two dashboard charts, against your budget: the bars carry the red line of each category's envelope, the pie relates each category to the period's budget. “Compare with” overlays a second period of the same length — two months, two years or two weeks — hatched and greyed: over the bars, and as a ring inside the pie.",
    "Tes dépenses face au budget": "Your spending against the budget",
    "Période": "Period",
    "Comparer avec": "Compare with",
    "Comparée": "Compared",
    "Plein : {courante} · Hachuré : {comparee}": "Solid: {courante} · Hatched: {comparee}",
    "Aucun budget posé sur cette période : le camembert rapporte chaque catégorie au total dépensé.":
      "No budget set for this period: the pie relates each category to the total spent.",


    /* ===== Règles : les autres propriétés d'une ligne (migration 0071) ===== */
    "Tout ce qu'une règle peut changer d'autre sur la ligne, sauf ses montants et sa date. Chaque champ est facultatif : laissé vide, la règle n'en dit rien. Le nouveau nom ne change pas ce que les règles comparent — elles lisent toutes le libellé du relevé.":
      "Everything else a rule can change on the row, except its amounts and its date. Each field is optional: left empty, the rule says nothing about it. The new name does not change what rules compare — they all read the statement's label.",
    "— ne pas changer —": "— leave unchanged —",
    "Et aussi": "And also",
    "Renommer en": "Rename to",
    "Sur le compte": "On the account",
    "Avec la note": "With the note",
    "Amortir sur (mois)": "Spread over (months)",
    "Marquer comme dépense imprévue": "Mark as unexpected expense",
    "— aucune —": "— none —",
    "— non —": "— no —",
    "renommée « {nom} »": "renamed “{nom}”",
    "sur « {compte} »": "on “{compte}”",
    "note « {note} »": "note “{note}”",
    "amortie sur {n} mois": "spread over {n} months",
    "imprévue": "unexpected",
    "catégorie « {nom} »": "category “{nom}”",
    "Un amortissement s'étale sur 2 à 120 mois.": "A spread covers 2 to 120 months.",
    "Cette règle ne changerait rien : choisis au moins une action.":
      "This rule would change nothing: pick at least one action.",
    "Le réglage juste, si tu veux vérifier le tien : 2 lignes de tête, Date en colonne 1, Nature en 3, Montant en 5, Catégorie bancaire en 7. Les colonnes 2, 4 et 6 — référence, type de carte, solde après opération — ne sont lues par rien : une colonne qu'on n'importe pas n'a pas à être supprimée du fichier.":
      "The correct setup, if you want to check yours: 2 header rows, Date in column 1, Label in 3, Amount in 5, Bank category in 7. Columns 2, 4 and 6 — reference, card type, balance after transaction — are read by nothing: a column you do not import does not have to be removed from the file.",
    "on te doit 340,00 € · tu dois 0,00 €":
      "you are owed 340.00 € · you owe 0.00 €",
    "Deux points importants avant de commencer":
      "Two important things before you start",
    "Où ranger tes données":
      "Where to keep your data",
    "Une notice t'attend":
      "A user guide is waiting for you",
    "L'application explique tout ce qu'elle fait, depuis l'intérieur :":
      "The application explains everything it does, from the inside:",
    "Paramètres → Paramètres généraux → Ouvrir la notice":
      "Settings → General settings → Open the user guide",
    ". On y trouve le sens de chaque chiffre du dashboard, les types d'opération, et un tutoriel guidé pour importer un premier relevé — avec un fichier d'exemple à télécharger.":
      ". You will find there the meaning of every dashboard figure, the transaction types, and a guided tutorial for importing a first statement — with a sample file to download.",
    "Notice d'utilisation":
      "User guide",
    "Ouvrir la notice":
      "Open the user guide",
    "← Retour aux paramètres":
      "← Back to settings",
    "Pour commencer":
      "Getting started",
    "Le dashboard":
      "The dashboard",
    "Les types d'opération":
      "Transaction types",
    "Importer un relevé":
      "Importing a statement",
    "Les extensions":
      "Extensions",
    "Les quatre mots de l'application":
      "The application's four words",
    "Un compte":
      "An account",
    "Une opération":
      "A transaction",
    "Une catégorie":
      "A category",
    "Une monnaie":
      "A currency",
    "Par où commencer":
      "Where to begin",
    "Où vivent tes données":
      "Where your data lives",
    "La rangée du haut : ce que tu as, aujourd'hui":
      "The top row: what you have, today",
    "La rangée du bas : ce que la période a fait":
      "The bottom row: what the period did",
    "Les deux graphes, et la période qu'ils regardent":
      "The two charts, and the period they look at",
    "Dépense remboursable · Remboursement reçu":
      "Reimbursable expense · Reimbursement received",
    "Prêt reçu · Remboursement de prêt":
      "Loan received · Loan repayment",
    "Achat et vente de titres":
      "Buying and selling securities",
    "Trois choses qu'une opération peut porter en plus":
      "Three things a transaction can also carry",
    "Un statut : réel ou prévisionnel":
      "A status: actual or planned",
    "Une découpe entre plusieurs catégories":
      "A split across several categories",
    "Un amortissement sur plusieurs mois":
      "Spreading over several months",
    "Essayer sans risque":
      "Try it safely",
    "Lancer le tutoriel guidé":
      "Start the guided tutorial",
    "Télécharger le relevé d'exemple":
      "Download the sample statement",
    "Les cinq étapes d'un import":
      "The five steps of an import",
    "Régler la lecture d'un fichier":
      "Setting up how a file is read",
    "Le preset":
      "The preset",
    "Les colonnes lues":
      "The columns read",
    "Les lignes de tête":
      "The header rows",
    "Le tableau « Le fichier tel qu'il est »":
      "The « file as it is » table",
    "Les réglages de lecture":
      "Reading settings",
    "La configuration avancée":
      "Advanced configuration",
    "La comparaison des doublons":
      "Duplicate comparison",
    "Ce que l'aperçu te demande avant de confirmer":
      "What the preview asks before you confirm",
    "Les catégories bancaires à confirmer":
      "Bank categories to confirm",
    "Les doublons détectés":
      "Duplicates detected",
    "Les ressemblances":
      "Near matches",
    "L'aperçu ligne par ligne":
      "The row-by-row preview",
    "Si l'import ne donne pas ce que tu attendais":
      "If the import is not what you expected",
    "Ce qui est allumé chez toi":
      "What is enabled on your machine",
    "Éteindre n'efface jamais rien":
      "Disabling never deletes anything",
    "Aucune extension n'est installée : l'application fonctionne telle quelle. Les extensions se déposent dans le dossier « extensions », à côté de l'application.":
      "No extension is installed: the application works as it is. Extensions are dropped into the « extensions » folder, next to the application.",
    "allumée":
      "on",
    "non installée":
      "not installed",
    "éteinte":
      "off",
    // Les cartes de tutoriel de Paramètres généraux, et la mémoire de
    // progression qu'elles montrent (cf. tutoriel.js). Les TEXTES DES ÉTAPES
    // sont plus bas : ceux-ci sont l'habillage, qui ne change pas quand une
    // étape est réécrite.
    "Tutoriels guidés":
      "Guided tutorials",
    "Prendre l'application en main":
      "Getting to grips with the app",
    "Le tour des quatre écrans, et les quelques idées qui ne se devinent pas : les deux rangées de cartes, la période, l'extinction plutôt que la suppression, les extensions.":
      "A tour of the four screens, and the few ideas you cannot guess: the two rows of cards, the period, disabling rather than deleting, extensions.",
    "Régler un preset de bout en bout, colonnes secondaires comprises — avec, à chaque colonne, l'extrait de relevé qui la rend nécessaire.":
      "Setting up a preset from end to end, secondary columns included — each one shown with the statement excerpt that makes it necessary.",
    "Terminé":
      "Completed",
    "Étape":
      "Step",
    "Pas encore commencé":
      "Not started yet",
    "étapes":
      "steps",
    "Revoir":
      "Review",
    "Reprendre":
      "Resume",
    "Commencer":
      "Start",
    "Recommencer":
      "Start over",
    "Tutoriel terminé :":
      "Tutorial completed:",
    // Le repli des filtres de la page Opérations et son bandeau.
    "Filtres": "Filters",
    // La carte d'un compte de placements : le total prend la place du solde,
    // les espèces descendent d'un cran (cf. extensions/placements).
    "Espèces": "Cash",
    // L'infobulle des deux cartes de flux : leur titre est celui de la carte.
    "Total Entrées": "Total In",
    "Total Dépenses": "Total Out",
    // La case qui a remplacé le menu « Statut » du formulaire d'opération.
    "Prévisionnelle": "Planned",
    "Reconnaître à l'import": "Match on import",
    "· {n} actif(s)": "· {n} active",
    "Quitter le tutoriel":
      "Leave the tutorial",
    "Précédent":
      "Previous",
    "Suivant":
      "Next",
    "Terminer":
      "Finish",
    "L'import vit dans les Paramètres":
      "Importing lives in Settings",
    "Tout se passe ici, dans l'onglet « Import ». On vient d'y aller pour toi. Garde cette bulle ouverte : elle suit les étapes pendant que tu regardes l'écran.":
      "Everything happens here, in the « Import » tab. We have just taken you there. Keep this bubble open: it follows the steps while you look at the screen.",
    "1. Le preset":
      "1. The preset",
    "Un preset retient la FORME d'un fichier : quelles colonnes lire, et où. Tu en crées un par banque et par type d'export, puis tu ne le règles plus jamais. Le bouton « + Nouveau preset » en crée un ; celui qui est allumé ici est celui qu'on utilise.":
      "A preset remembers a file's SHAPE: which columns to read, and where. You create one per bank and per export type, then never set it up again. The « + Nouveau preset » button creates one; the one highlighted here is the one in use.",
    "2. Le compte de ce preset":
      "2. This preset's account",
    "Si le relevé ne décrit qu'un seul compte — le cas ordinaire — dis-le ici : chaque ligne importée ira sur ce compte, et le fichier n'aura pas à le nommer.":
      "If the statement describes a single account — the usual case — say so here: every imported row will go to that account, and the file will not have to name it.",
    "3. Le fichier":
      "3. The file",
    "Dépose ton relevé ici, ou clique pour le choisir. Pour t'entraîner, prends le relevé d'exemple téléchargé depuis la notice : c'est un vrai CSV, avec une ligne de titre parasite et trois colonnes dont l'application n'a rien à faire — exactement ce qu'une banque exporte.":
      "Drop your statement here, or click to pick it. To practise, use the sample statement downloaded from the user guide: it is a real CSV, with a stray title row and three columns the application has no use for — exactly what a bank exports.",
    "4. Le fichier tel qu'il est":
      "4. The file as it is",
    "Ce tableau montre ce que l'application LIT, colonne par colonne. C'est ici qu'on corrige : fais glisser un en-tête sur un autre pour échanger deux colonnes, jusqu'à ce que chaque propriété tombe en face de la bonne. Les colonnes hachurées sont celles que le réglage attend et que le fichier n'a pas.":
      "This table shows what the application READS, column by column. This is where you fix it: drag one header onto another to swap two columns, until each property lands opposite the right one. Hatched columns are those the settings expect and the file does not have.",
    "Ce tableau apparaît dès qu'un fichier est déposé : reviens à cette étape à ce moment-là.":
      "This table appears as soon as a file is dropped: come back to this step then.",
    "5. Les réglages qui restent":
      "5. The remaining settings",
    "« Lignes de tête » dit combien de lignes du haut ne sont pas des données — le relevé d'exemple en a deux, son titre et la ligne des intitulés. « Colonnes lues » dit la même chose que le glisser-déposer, en numéros. Les réglages de lecture (séparateur, décimale) servent quand les montants ou les colonnes sortent de travers.":
      "« Header rows » says how many rows at the top are not data — the sample statement has two, its title and the column-name row. « Columns read » says the same thing as dragging, in numbers. The reading settings (separator, decimal mark) matter when amounts or columns come out wrong.",
    "6. Enregistrer la configuration":
      "6. Save the configuration",
    "Ce bouton garde tes réglages DANS le preset : c'est ce qui fait qu'au prochain relevé de la même banque, il n'y aura plus rien à régler. Le bouton de relecture, lui, enregistre aussi — mais relit le fichier dans la foulée pour te montrer le résultat.":
      "This button keeps your settings IN the preset: that is what makes the next statement from the same bank need no setting up at all. The re-read button also saves — but re-reads the file straight away to show you the result.",
    "7. Ce que l'application te demande":
      "7. What the application asks you",
    "Les catégories écrites par ta banque ne sont pas les tiennes : tu dis une fois à quoi chacune correspond, et l'application s'en souvient pour tous les imports suivants. Les doublons et les ressemblances se décident au même endroit — un doublon est décoché d'office, une ressemblance te laisse juge.":
      "The categories your bank writes are not yours: you say once what each one maps to, and the application remembers it for every later import. Duplicates and near matches are decided in the same place — a duplicate is unticked by default, a near match leaves the call to you.",
    "Ce bloc n'apparaît que si le fichier apporte des catégories, des comptes ou des devises inconnus.":
      "This block only appears if the file brings unknown categories, accounts or currencies.",
    "8. L'aperçu, ligne par ligne":
      "8. The preview, row by row",
    "Rien n'est écrit en base avant ton accord. Chaque ligne se modifie ici : sa catégorie, son type, son compte — et se supprime si elle n'a rien à faire là. Les lignes sont rangées par type d'opération, pour que tu voies d'un coup ce que l'application a compris.":
      "Nothing is written to the database before you agree. Every row can be changed here: its category, its type, its account — and deleted if it does not belong. Rows are grouped by transaction type, so you can see at a glance what the application understood.",
    "L'aperçu apparaît une fois le fichier lu.":
      "The preview appears once the file has been read.",
    "9. Confirmer":
      "9. Confirm",
    "C'est le seul geste qui écrit. Et s'il s'avère que le résultat ne te convient pas, l'historique des importations, plus bas, annule un import entier — les opérations qu'il a créées disparaissent, et les dépenses prévues qu'il avait remplacées reviennent telles qu'elles étaient.":
      "This is the only action that writes. And if the result does not suit you, the import history further down undoes a whole import — the transactions it created disappear, and the planned expenses it replaced come back exactly as they were.",
    "Le mode d'emploi de l'application, à l'intérieur de l'application. Ce que veut dire chaque chiffre du dashboard, ce que fait chaque type d'opération, et comment régler un import de bout en bout — avec un tutoriel guidé et un relevé d'exemple pour s'entraîner sans risque.":
      "The application's manual, inside the application. What every dashboard figure means, what each transaction type does, and how to set up an import from end to end — with a guided tutorial and a sample statement to practise safely.",
    "Cette application tient tes comptes hors ligne : rien ne sort de ta machine, aucun service n'est interrogé, aucune banque n'est connectée. Tu saisis ou tu importes tes opérations, elle calcule. Cette notice explique ce qu'elle fait, dans l'ordre où on en a besoin.":
      "This application keeps your accounts offline: nothing leaves your machine, no service is queried, no bank is connected. You enter or import your transactions, it does the arithmetic. This guide explains what it does, in the order you need it.",
    "Un endroit où l'argent se trouve : un compte courant, un livret, un compte-titres. Chaque compte porte une ou plusieurs monnaies, et son solde se déduit de son solde initial plus tout ce qui y est passé.":
      "A place where money sits: a current account, a savings account, a securities account. Each account carries one or more currencies, and its balance follows from its opening balance plus everything that went through it.",
    "Une ligne : une date, un libellé, un montant, un compte. C'est la brique de tout le reste — les soldes, les graphes et les totaux ne sont que des façons de les additionner.":
      "A row: a date, a label, an amount, an account. It is the building block of everything else — balances, charts and totals are only ways of adding them up.",
    "Ce à quoi une dépense sert : alimentation, transports, loisirs. C'est par elles que l'histogramme et le camembert répartissent ce que tu dépenses. Tu les renommes, tu les ranges, tu en ajoutes — les quatre livrées ne sont qu'un point de départ.":
      "What an expense is for: groceries, transport, leisure. They are how the histogram and the pie chart break down what you spend. You rename them, reorder them, add your own — the four shipped are only a starting point.",
    "L'application ne mélange JAMAIS deux devises dans un même total : chaque écran qui affiche des montants a ses onglets ou sa liste de monnaie. Sans l'extension « Monnaies », il n'y en a qu'une et la question ne se pose pas.":
      "The application NEVER mixes two currencies in one total: every screen showing amounts has its currency tabs or dropdown. Without the « Monnaies » extension there is only one, and the question does not arise.",
    "Crée tes comptes, dans Paramètres → Comptes, avec leur solde de départ. C'est la seule chose qu'on ne peut pas deviner : tout le reste s'en déduit.":
      "Create your accounts, in Settings → Accounts, with their opening balance. It is the only thing that cannot be guessed: everything else follows from it.",
    "Range tes catégories, dans Paramètres → Catégories. Quatre sont livrées pour ne pas partir de rien ; renomme-les, supprime celles qui ne te servent pas, ajoute les tiennes.":
      "Sort out your categories, in Settings → Categories. Four are shipped so you do not start from nothing; rename them, delete the ones you do not use, add your own.",
    "Fais entrer tes opérations, à la main depuis la page Opérations, ou par un import de relevé — c'est le chapitre « Importer un relevé » de cette notice.":
      "Bring your transactions in, by hand from the Transactions page, or by importing a statement — that is the « Importing a statement » chapter of this guide.",
    "Regarde le dashboard. À partir de là, tout est lecture : les chiffres du haut disent où tu en es, ceux du bas ce que le mois a fait.":
      "Look at the dashboard. From there on, everything is reading: the figures at the top say where you stand, those at the bottom what the month did.",
    "Toutes tes données tiennent dans UN fichier, dont tu choisis l'emplacement au premier lancement et que tu peux déplacer ensuite depuis Paramètres → Base de données. Sauvegarde ce fichier comme tu sauvegardes une photo : le copier suffit, et le rouvrir depuis le même panneau te rend tout. L'application ne garde aucune copie ailleurs, et rien n'est envoyé nulle part.":
      "All your data fits in ONE file, whose location you choose at first launch and can move later from Settings → Database. Back that file up the way you back up a photo: copying it is enough, and reopening it from the same panel gives you everything back. The application keeps no copy elsewhere, and nothing is sent anywhere.",
    "Le dashboard répond à deux questions différentes, et c'est pour ça qu'il a deux rangées de cartes. En haut, ce que tu AS aujourd'hui — ces chiffres ne bougent pas quand tu changes de mois. En bas, sous le sélecteur de période, ce que la période a FAIT.":
      "The dashboard answers two different questions, which is why it has two rows of cards. At the top, what you HAVE today — those figures do not move when you change month. At the bottom, under the period selector, what the period DID.",
    "Ce que portent tes comptes courants, aujourd'hui. Le chiffre plus petit à côté est le PRÉVISIONNEL : le même solde une fois passées les opérations que tu as écrites d'avance.":
      "What your current accounts hold, today. The smaller figure beside it is the PLANNED balance: the same balance once the transactions you wrote in advance have gone through.",
    "Tout ce que tu possèdes : comptes courants, épargne, et la valeur de tes titres si l'extension « Placements financiers » tourne. C'est le chiffre à regarder pour « est-ce que mon patrimoine monte ».":
      "Everything you own: current accounts, savings, and the value of your securities if the « Placements financiers » extension is running. This is the figure to watch for « is my net worth going up ».",
    "Les deux variations ne tombent jamais d'accord, et c'est normal : l'une dit ce que le mois COÛTE, l'autre ce qui est PASSÉ sur le compte. Quand elles diffèrent, un bouton apparaît dans la carte jaune et ouvre le détail, ligne par ligne, de ce qui explique l'écart.":
      "The two variations never agree, and that is normal: one says what the month COSTS, the other what actually WENT THROUGH the account. When they differ, a button appears in the yellow card and opens the row-by-row detail of what explains the gap.",
    "Les deux graphes montrent les mêmes catégories dans les mêmes couleurs, sur la période du sélecteur, et se pilotent avec le même filtre — le bouton « Catégories » dans leur titre. Survoler une barre, une tranche ou une ligne de légende éclaire les deux autres et ouvre une infobulle : elle porte le total, la part, et les trois plus grosses dépenses de la catégorie.":
      "Both charts show the same categories in the same colours, over the selector's period, and are driven by the same filter — the « Catégories » button in their title. Hovering a bar, a slice or a legend line lights up the other two and opens a tooltip: it carries the total, the share, and the category's three largest expenses.",
    "L'histogramme porte des MONTANTS : une barre par catégorie, et le trait rouge est le budget que tu lui as donné pour ce mois-ci (extension « Budget »).":
      "The histogram carries AMOUNTS: one bar per category, and the red line is the budget you gave it for this month (« Budget » extension).",
    "Le camembert porte des PARTS. En vue « État actuel », chaque tranche est rapportée au total dépensé et les parts font 100 %. En vue « Budget », elles sont rapportées au budget du mois : l'anneau reste ouvert sur ce qui n'a pas été dépensé.":
      "The pie chart carries SHARES. In « État actuel » view, each slice is relative to the total spent and the shares add up to 100 %. In « Budget » view they are relative to the month's budget: the ring stays open over what has not been spent.",
    "La légende, sous les deux, ne porte que le nom et la part : c'est le point d'entrée le plus complet — son infobulle dit tout, et « Voir toutes les dépenses » t'emmène à la liste des opérations de cette catégorie.":
      "The legend, below both, carries only the name and the share: it is the most complete entry point — its tooltip says everything, and « Voir toutes les dépenses » takes you to that category's list of transactions.",
    "La petite flèche sous la rangée des mois déplie les SEMAINES : l'histogramme devient celui de la semaine choisie, et « Moyenne » répond à « est-ce que cette semaine-là était ordinaire ? ». Les cartes, elles, restent sur le mois.":
      "The small arrow under the row of months unfolds the WEEKS: the histogram becomes that of the chosen week, and « Moyenne » answers « was that week an ordinary one? ». The cards stay on the month.",
    "Le type d'une opération dit ce qu'elle EST, et décide de la façon dont elle compte. L'application nue en connaît deux ; les autres s'ouvrent avec l'extension qui les explique, et ne sont décrits ici que si elle tourne chez toi.":
      "A transaction's type says what it IS, and decides how it counts. The bare application knows two; the others open up with the extension that explains them, and are described here only if it is running on your machine.",
    "Une dépense ou une entrée ordinaire : des courses, un salaire, une facture. C'est le type par défaut, le seul qui se découpe entre plusieurs catégories, et celui de la quasi-totalité de tes lignes.":
      "An ordinary expense or income: groceries, a salary, a bill. It is the default type, the only one that can be split across several categories, and the type of nearly all your rows.",
    "De l'argent qui passe d'un de tes comptes à un autre. Ce n'est ni une dépense ni une entrée : ton patrimoine ne bouge pas, et c'est pour ça qu'un virement est écarté de tous les totaux de période. Une seule saisie écrit les deux côtés, et un virement entre deux monnaies porte les deux montants.":
      "Money moving from one of your accounts to another. It is neither an expense nor income: your net worth does not change, which is why a transfer is excluded from every period total. A single entry writes both sides, and a transfer between two currencies carries both amounts.",
    "Une dépense que tu avances pour quelqu'un d'autre : tu paies 60 €, on t'en rendra 50. Elle ne pèse sur ton mois que pour ce qui reste à ta charge, et ce qu'on te doit encore s'affiche dans « Reste à rembourser ». Le remboursement reçu, quand il arrive, fait décroître cette dette tout seul.":
      "An expense you front for someone else: you pay 60 €, 50 will come back. It weighs on your month only for what stays at your charge, and what is still owed to you shows in « Reste à rembourser ». The reimbursement, when it arrives, shrinks that debt on its own.",
    "De l'argent qu'on t'a prêté : il arrive sur ton compte, mais il faudra le rendre — il n'entre donc pas dans tes entrées. Ce que tu rendras EN PLUS de ce que tu as reçu est l'intérêt : c'est lui, et lui seul, qui pèse sur tes dépenses, dans sa propre barre d'histogramme.":
      "Money lent to you: it lands in your account, but it will have to be given back — so it does not count as income. What you will return ON TOP of what you received is the interest: that, and only that, weighs on your spending, in its own histogram bar.",
    "L'achat ou la vente d'un titre. Tu ne le saisis jamais depuis la page Opérations : il naît avec sa ligne dans l'écran des placements, et le mouvement d'espèces sur le compte-titres en découle.":
      "Buying or selling a security. You never enter it from the Transactions page: it is born with its row in the investments screen, and the cash movement on the securities account follows from it.",
    "D'autres types existent et n'apparaissent qu'avec l'extension qui les ouvre : dépenses remboursables, prêts reçus, opérations sur titres. Va voir Paramètres → Extensions pour savoir ce que tu as sous la main.":
      "Other types exist and only appear with the extension that opens them: reimbursable expenses, loans received, securities transactions. Look at Settings → Extensions to see what you have at hand.",
    "Une opération RÉELLE a eu lieu ; une PRÉVISIONNELLE est écrite d'avance et ne pèse que sur le solde projeté. Quand la vraie ligne arrive par un import, l'application reconnaît la prévision et la remplace, plutôt que de compter la dépense deux fois.":
      "An ACTUAL transaction has happened; a PLANNED one is written in advance and weighs only on the projected balance. When the real row arrives through an import, the application recognises the plan and replaces it, rather than counting the expense twice.",
    "Importer, c'est expliquer une fois à l'application comment ta banque écrit ses fichiers — puis ne plus jamais y revenir. Ce réglage s'appelle un PRESET : un par banque, gardé d'un import à l'autre. Rien n'est écrit dans tes comptes avant que tu aies vu, ligne par ligne, ce qui va entrer.":
      "Importing means explaining once to the application how your bank writes its files — then never coming back to it. That setup is called a PRESET: one per bank, kept from one import to the next. Nothing is written to your accounts before you have seen, row by row, what is about to come in.",
    "Le tutoriel ouvre l'écran d'import et te montre où regarder, étape par étape, sans rien écrire dans tes comptes. Le relevé d'exemple est un vrai fichier CSV — avec une ligne de titre parasite et trois colonnes inutiles, comme un export de banque : de quoi s'exercer à régler un import pour de bon.":
      "The tutorial opens the import screen and shows you where to look, step by step, without writing anything to your accounts. The sample statement is a real CSV file — with a stray title row and three useless columns, like a bank export: enough to practise setting up an import for real.",
    "Choisis ou crée le PRESET qui correspond à ce fichier, et dis-lui sur quel compte il importe.":
      "Pick or create the PRESET matching this file, and tell it which account it imports into.",
    "Dépose le fichier. L'application le relit aussitôt et montre, dans « Le fichier tel qu'il est », ce qu'elle a compris de chaque colonne.":
      "Drop the file. The application reads it straight away and shows, in « Le fichier tel qu'il est », what it understood of each column.",
    "Corrige la lecture si besoin : glisse les en-têtes pour remettre chaque propriété en face de la bonne colonne, dis combien de lignes de tête sauter, puis enregistre la configuration dans le preset.":
      "Fix the reading if needed: drag the headers to put each property opposite the right column, say how many header rows to skip, then save the configuration into the preset.",
    "Réponds à ce que l'aperçu te demande : à quelles catégories à toi correspondent celles de ta banque, quoi faire des doublons, et ce qu'il faut corriger ligne par ligne.":
      "Answer what the preview asks: which of your categories your bank's ones map to, what to do with duplicates, and what to fix row by row.",
    "Confirme. C'est le seul geste qui écrit quelque chose dans tes comptes.":
      "Confirm. It is the only action that writes anything into your accounts.",
    "L'historique des importations, en bas de l'écran d'import, ANNULE un import entier : les opérations qu'il a créées disparaissent, et les dépenses prévues qu'il avait remplacées reviennent exactement comme elles étaient. Rien n'est irréversible — c'est ce qui permet d'essayer un réglage plutôt que de le deviner.":
      "The import history, at the bottom of the import screen, UNDOES a whole import: the transactions it created disappear, and the planned expenses it replaced come back exactly as they were. Nothing is irreversible — that is what lets you try a setting rather than guess it.",
    "L'application nue tient un budget complet. Les extensions ajoutent ce dont tout le monde n'a pas besoin : plusieurs devises, un portefeuille de titres, des prêts, des objectifs chiffrés. Elles se déposent dans le dossier « extensions » à côté de l'application, et rien ne se charge avant que tu l'aies allumée toi-même.":
      "The bare application keeps a complete budget. Extensions add what not everyone needs: several currencies, a securities portfolio, loans, numeric goals. They are dropped into the « extensions » folder next to the application, and nothing loads before you have switched it on yourself.",
    "Éteindre une extension ne supprime AUCUNE donnée : son écran disparaît, ses lignes dorment en base, et tout revient intact quand tu la rallumes. C'est pour ça qu'on peut en essayer une sans rien risquer.":
      "Switching an extension off deletes NO data: its screen disappears, its rows sleep in the database, and everything comes back intact when you switch it on again. That is why you can try one without risking anything.",

    /* ===== Les deux axes d'une étiquette de titre (0066) ===== */
    "Monnaie éteinte":
      "Currency switched off",
    "Monnaie rallumée":
      "Currency switched back on",
    "Sans enveloppe":
      "No wrapper",
    "COMMENT tes titres sont détenus : ETF, action en direct, fonds, SCPI. Tes propres étiquettes, que tu nommes comme tu veux. À ne pas confondre avec la classe d'actif juste en dessous, qui dit à QUOI ils exposent — un ETF obligataire est un ETF et de l'obligataire. Purement descriptif : aucun solde ni aucune valorisation n'en dépend.":
      "HOW your securities are held: ETF, direct holding, fund, REIT. Your own labels, named as you like. Not to be confused with the asset class just below, which says WHAT they expose to — a bond ETF is both an ETF and bonds. Purely descriptive: no balance and no valuation depends on it.",
    "COMMENT ton portefeuille est détenu : la part qui passe par des ETF, celle que tu as choisie titre par titre, celle qui est en SCPI. À la valeur d'aujourd'hui, tous comptes confondus. Survole une part pour voir les titres qui la composent.":
      "HOW your portfolio is held: the share going through ETFs, the one you picked security by security, the one in REITs. At today's value, all accounts together. Hover a slice to see the securities making it up.",
    "À QUOI ton portefeuille expose, quelle que soit la façon dont tu le détiens : actions, obligations, immobilier, monétaire. C'est la question à laquelle le graphe du dessus ne peut pas répondre — un ETF obligataire y compte comme un ETF, pas comme de l'obligataire. Ce disque n'apparaît que si tu as classé au moins un titre.":
      "WHAT your portfolio exposes you to, whatever the way you hold it: equities, bonds, real estate, cash. This is the question the chart above cannot answer — a bond ETF counts there as an ETF, not as bonds. This ring only appears once you have classified at least one security.",
    "Comment ce titre est détenu : un ETF, une action que tu as choisie toi-même, une SCPI. Facultatif, et modifiable à tout moment.":
      "How this security is held: an ETF, a share you picked yourself, a REIT. Optional, and changeable at any time.",
    "À quoi ce titre expose : actions, obligations, immobilier… C'est l'autre question, et elle ne se déduit pas de la première — un ETF obligataire est un ETF (enveloppe) et de l'obligataire (classe). Facultatif.":
      "What this security exposes you to: equities, bonds, real estate… That is the other question, and it does not follow from the first — a bond ETF is an ETF (wrapper) and bonds (class). Optional.",
    "À QUOI tes titres exposent, quelle que soit la façon dont tu les détiens. Cinq classes sont livrées parce que ce vocabulaire est le même pour tout le monde, contrairement aux enveloppes que chacun nomme à sa façon ; renomme-les et supprime-les librement. Purement descriptif, comme tout le reste ici.":
      "WHAT your securities expose you to, whatever the way you hold them. Five classes are shipped because this vocabulary is the same for everyone, unlike wrappers which everyone names their own way; rename and delete them freely. Purely descriptive, like everything else here.",
    "Comment c'est détenu":
      "How it is held",
    "À quoi c'est exposé":
      "What it exposes to",
    "Enveloppes":
      "Wrappers",
    "Classes d'actif":
      "Asset classes",
    "Classe d'actif":
      "Asset class",
    "Enveloppe":
      "Wrapper",
    "Ajouter l'enveloppe":
      "Add wrapper",
    "Ajouter la classe":
      "Add class",
    "ex. Matières premières":
      "e.g. Commodities",
    "Étiquette ajoutée":
      "Label added",
    "Aucune enveloppe. Ajoutes-en une ci-dessous si tu veux regrouper tes titres.":
      "No wrapper yet. Add one below if you want to group your securities.",
    "Aucune classe d'actif. Ajoutes-en une ci-dessous pour voir à quoi ton portefeuille expose.":
      "No asset class yet. Add one below to see what your portfolio exposes you to.",
    "Enveloppe : comment le titre est détenu — purement descriptif":
      "Wrapper: how the security is held — purely descriptive",
    "Classe d'actif : à quoi le titre expose — purement descriptif":
      "Asset class: what the security exposes to — purely descriptive",
    "Sans classe":
      "No class",
    "Obligations":
      "Bonds",
    "Immobilier":
      "Real estate",
    "Matières premières":
      "Commodities",
    "Monétaire":
      "Cash",

    /* ===== Reprise de traduction, lot 2 : les libellés courts et les
       fragments de phrase coupés par un <strong> ou un <em>. ===== */
    "&larr; Retour au tableau de bord":
      "&larr; Back to dashboard",
    "&larr; Retour aux projets":
      "&larr; Back to projects",
    "Ouvrir":
      "Open",
    "Chercher":
      "Search",
    "Rechercher":
      "Search",
    "Voir la note":
      "View note",
    "Voir le portefeuille":
      "View portfolio",
    "Description":
      "Description",
    "Actualisation":
      "Refresh",
    "Groupe":
      "Group",
    "Projets":
      "Projects",
    "Prêts":
      "Loans",
    "Lecture de cours":
      "Price lookup",
    "{n} opération(s)":
      "{n} transactions",
    "Types de titre":
      "Security types",
    "Ajouter le type":
      "Add type",
    "Type ajouté":
      "Type added",
    "Type renommé":
      "Type renamed",
    "Type supprimé":
      "Type deleted",
    "Type du titre — purement descriptif":
      "Security type — purely descriptive",
    "Nouveau nom pour « {nom} »":
      "New name for « {nom} »",
    "Supprimer « {nom} » ?":
      "Delete « {nom} »?",
    "aucun titre":
      "no securities",
    "titre typé":
      "typed security",
    "— aucun type de titre créé —":
      "— no security type created —",
    "ex. ETF":
      "e.g. ETF",
    "ex. 0":
      "e.g. 0",
    "Où ranger tes données ?":
      "Where should your data live?",
    "Emplacement du fichier":
      "File location",
    "Ranger mes données ici":
      "Store my data here",
    "Créer / déplacer ici":
      "Create / move here",
    "dans le dossier de l'application":
      "in the application folder",
    "dossier à la main.":
      "folder by hand.",
    "crée une vierge sinon.":
      "creates a blank one otherwise.",
    "— l'endroit qu'une mise à jour":
      "— the very place an update",
    "Quand tu importes les relevés":
      "When you import statements",
    "Le « i » de chaque ligne dit à quoi elle sert.":
      "The « i » on each row says what it is for.",
    "Glisser vers une autre colonne pour reclasser":
      "Drag to another column to reclassify",
    "Ce virement est peut-être déjà en base.":
      "This transfer may already be in the database.",
    "colonne est la n°1. L'œil barré ne lit pas la colonne.":
      "column is n°1. The crossed-out eye skips the column.",
    "obligatoires et ne s'éteignent pas.":
      "mandatory and cannot be switched off.",
    "illisibles. L'app devine seule dans la plupart des cas.":
      "unreadable. The app works it out on its own in most cases.",
    "française ne convient pas à tous les formats d'export.":
      "French one does not suit every export format.",
    "et jeter un œil aux doublons qu'elle a repérés.":
      "and take a look at the duplicates it spotted.",
    "changer le type d'une ligne.":
      "change the type of a row.",
    "un doublon détecté légitime).":
      "a legitimate detected duplicate).",
    "un, il remplace toute la liste par défaut de cet état-là.":
      "one, it replaces the whole default list for that state.",
    "répartissent son montant sur les mois choisis.":
      "spread its amount over the chosen months.",
    "depuis l'opération d'origine.":
      "from the original transaction.",
    "preset.":
      "preset.",
    "(émetteur ou récepteur) est déduit du signe du montant.":
      "(sender or receiver) is deduced from the sign of the amount.",
    "Et type le titre en":
      "And types the security as",
    "du courtier":
      "from the broker",
    "achat":
      "purchase",
    "avec":
      "with",
    "entier":
      "whole",
    "daté du jour de la photographie :":
      "dated the day of the snapshot:",
    "de ce à quoi elle ressemble.":
      "of what it looks like.",
    "peut donc désigner le second.":
      "can therefore name the second one.",
    "sur celui du compte courant. Seuls les virements qui":
      "on the current account's. Only transfers that",
    "différentes. L'app compare ici la":
      "different. The app compares here the",
    "elle-même — le compte, les devises,":
      "itself — the account, the currencies,",
    "le type \"Placements financiers\", puis reviens ici.":
      "the \"Placements financiers\" type, then come back here.",
    ", et s'arrêtent à la première qui":
      ", and stop at the first one that",
    "et s'arrêtent à la première qui":
      "and stop at the first one that",
    "d'évaluation":
      "of evaluation",
    "ne changent pas l'ordre":
      "do not change the order",
    "au-dessus des cas généraux.":
      "above the general cases.",
    "défait ce qu'une règle plus haute a décidé :":
      "undoes what a rule higher up decided:",
    "en cas de désaccord, la plus haute":
      "in case of disagreement, the highest one",
    "gagne":
      "wins",
    "les correspondances mémorisées : un type reconnu ici":
      "the remembered mappings: a type recognised here",
    "Une règle, elle, sait dire «":
      "A rule, on the other hand, can say «",
    "« (A ou B) et C ».":
      "« (A or B) and C ».",
    "porter, et la somme doit valoir le montant de la ligne.":
      "carry it, and the total must equal the row's amount.",
    "opérations concernées. C'est un":
      "transactions concerned. It is a",
    "— retirer une":
      "— removing a",
    "Afficher les pages reconnues":
      "Show recognised pages",
    "Quelles pages puis-je coller ?":
      "Which pages can I paste?",
    "Non installées sur cette machine":
      "Not installed on this machine",

    /* ===== Reprise de traduction, lot 1 : les écrans signalés comme restés
       en français (dashboard, comptes, opérations, placements, monnaies).
       Rangés par écran, dans l'ordre où on les rencontre. ===== */
    "Catégories ▾":
      "Categories ▾",
    "Colonnes": "Columns",
    "Le solde d'un compte d'épargne dit ce qu'il Y A ; il ne dit pas ce que tu y as MIS ce mois-ci — et c'est pourtant la seule des deux qui résulte d'une décision. Le calcul se lit dans tes virements internes : tout ce qui part d'un compte courant vers un compte d'épargne ou de placements compte comme mis de côté, tout ce qui en revient compte en moins. Un virement d'épargne à épargne ne met rien de côté, il range autrement ce qui l'est déjà : il est ignoré.":
      "A savings account's balance says what IS there; it does not say what you PUT there this month — and that is the one of the two that follows from a decision. The figure is read from your internal transfers: anything leaving a current account for a savings or investment account counts as set aside, anything coming back counts against it. A savings-to-savings transfer sets nothing aside, it merely rearranges what already is: it is ignored.",
    "Le grand chiffre est le NET — ce que tu as réellement mis de côté sur l'année. Survole-le pour voir ce qu'il recouvre : un net à zéro peut vouloir dire « je n'ai rien bougé » comme « j'ai versé 2 000 € et j'en ai repris 2 000 ». Seules les opérations RÉELLES comptent, une mise de côté prévue n'ayant pas encore eu lieu. Entre deux monnaies, c'est toujours le montant du côté de l'épargne qui compte : verser 100 € qui arrivent en 108 $ met bien 108 $ de côté.":
      "The large figure is the NET — what you actually set aside over the year. Hover it to see what it covers: a net of zero can mean « I moved nothing » just as well as « I paid in 2,000 € and took 2,000 back out ». Only REAL transactions count, a planned deposit not having happened yet. Across two currencies it is always the amount on the savings side that counts: paying in 100 € that arrive as 108 $ does set aside 108 $.",
    "Le minimum que tu veux garder disponible sur tes comptes d'épargne, dans cette monnaie. Il ne bloque RIEN : aucun virement n'est refusé, aucune saisie n'est empêchée. L'app constate et te le dit, là où tu regardes tes comptes d'épargne. Une garde qui t'interdirait de descendre sous ton propre seuil se ferait contourner au premier vrai besoin, et tu aurais appris à ne plus la lire.":
      "The minimum you want to keep available across your savings accounts, in this currency. It blocks NOTHING: no transfer is refused, no entry is prevented. The app observes and tells you, where you look at your savings accounts. A guard forbidding you to go below your own threshold would be worked around at the first real need, and you would have learnt to stop reading it.",
    "Les comptes d'ÉPARGNE seulement, et leur solde réel. Un compte de placements porte des titres, qui ne sont disponibles qu'après une vente, à un cours qu'on ne connaît pas d'avance : les compter dans un matelas de sécurité reviendrait à se rassurer avec de l'argent qu'on n'a pas encore. Laisse à zéro pour ne pas poser de seuil du tout.":
      "SAVINGS accounts only, at their real balance. An investment account holds securities, which are only available after a sale, at a price nobody knows in advance: counting them in a safety cushion would mean reassuring yourself with money you do not have yet. Leave at zero to set no threshold at all.",
    "Ce que tu n'avais pas vu venir : le plombier, la dent cassée, le pneu. Aucune catégorie ne répond à cette question — une dépense d'alimentation peut être imprévue, une réparation peut être parfaitement attendue — d'où une case à cocher sur la dépense elle-même. Le total te dit, mois par mois, quelle part de ce que tu dépenses n'était pas prévisible.":
      "What you did not see coming: the plumber, the broken tooth, the tyre. No category answers this question — a grocery expense can be unexpected, a repair can be perfectly expected — hence a tick box on the expense itself. The total tells you, month by month, what share of your spending was not foreseeable.",
    "Le périmètre est celui de l'histogramme des dépenses du dashboard : dépenses réelles, virements internes exclus. C'est ce qui rend la part comparable à ce que tu lis ailleurs.":
      "The scope is that of the dashboard's spending histogram: real expenses, internal transfers excluded. That is what makes the share comparable to what you read elsewhere.",
    "Coche si cette dépense n'était pas prévisible. À ne pas confondre avec le statut : une dépense peut être prévisionnelle et prévue (le loyer du mois prochain), réelle et imprévue (le plombier de mardi). Rien ne change à tes soldes ni à tes totaux — c'est une étiquette, que seule l'extension « Budget » regarde.":
      "Tick if this expense was not foreseeable. Not to be confused with the status: an expense can be forecast and expected (next month's rent), real and unexpected (Tuesday's plumber). Nothing changes in your balances or your totals — it is a label, which only the « Budget » extension looks at.",
    "Ce que tu as mis de côté":
      "What you set aside",
    "Matelas de sécurité":
      "Safety cushion",
    "Dépenses imprévues":
      "Unexpected expenses",
    "Dépense imprévue":
      "Unexpected expense",
    "Montant minimum à garder disponible":
      "Minimum amount to keep available",
    "Les lignes de l'année":
      "This year's entries",
    "Mois par mois":
      "Month by month",
    "mis de côté en {annee}":
      "set aside in {annee}",
    "d'imprévu en {annee}":
      "unexpected in {annee}",
    "Versé {verse} · Repris {retire}":
      "Paid in {verse} · Taken back {retire}",
    "{part} de {total} dépensés":
      "{part} of {total} spent",
    "Aucun matelas posé pour cette monnaie.":
      "No cushion set for this currency.",
    "Il manque {montant}":
      "{montant} short",
    "Marge de {montant}":
      "{montant} of headroom",
    "{dispo} disponible sur {seuil} voulus":
      "{dispo} available of {seuil} wanted",
    "Matelas enregistré.":
      "Cushion saved.",
    "Matelas de sécurité franchi : il manque {montant}.":
      "Safety cushion breached: {montant} short.",
    "Aucune dépense marquée imprévue cette année.":
      "No expense marked unexpected this year.",
    "Une dépense prévue sert à voir venir ; encore faut-il qu'elle disparaisse quand la vraie arrive. Coche cette case et l'import la reconnaîtra au relevé : il te proposera alors de la REMPLACER par la vraie ligne, au lieu d'ajouter une seconde opération à côté. Il te demande toujours avant de le faire, et rien n'est perdu si tu refuses.":
      "A forecast expense is there to let you see what is coming — but it also has to go away when the real one arrives. Tick this box and the import will recognise it on your statement: it will then offer to REPLACE it with the real line, instead of adding a second transaction next to it. It always asks first, and nothing is lost if you decline.",
    "L'app reconnaît la vraie dépense à son COMPTE, son MONTANT (au centime près) et sa DATE. Les deux dates ci-dessous disent dans quel intervalle tu l'attends — utile quand tu connais le mois d'un prélèvement sans en connaître le jour, ou quand ta banque passe au 6 ce qu'elle annonçait au 5. Les deux doivent tomber dans le même mois. Laisse-les vides si tu l'attends au jour dit.":
      "The app recognises the real expense by its ACCOUNT, its AMOUNT (to the cent) and its DATE. The two dates below say the window you expect it in — handy when you know the month of a direct debit but not the day, or when your bank posts on the 6th what it announced for the 5th. Both must fall in the same month. Leave them empty if you expect it on the day itself.",
    "Facultatifs, et inutiles la plupart du temps : le compte, le montant et la date suffisent. Ils servent au cas inverse — deux prélèvements du même montant le même mois, que seul le libellé distingue. Tous doivent se retrouver dans le libellé de la ligne importée ; la casse et les accents n'ont pas d'importance.":
      "Optional, and needless most of the time: account, amount and date are enough. They are for the opposite case — two direct debits of the same amount in the same month, told apart only by their label. All of them must appear in the imported line's label; case and accents do not matter.",
    "Reconnaître cette dépense à l'import": "Recognise this expense on import",
    "Ces lignes du relevé correspondent à des dépenses que tu avais écrites d'avance, en prévisionnel. Plutôt que d'ajouter une opération de plus à côté de la prévision, l'import va REMPLACER la prévision par la vraie ligne : même opération, désormais réelle, avec la date et le montant du relevé. Elle garde tout ce qui lui était rattaché — son projet, son profil de remboursement, sa récurrence.":
      "These statement lines match expenses you had written down in advance, as forecasts. Rather than adding one more transaction next to the forecast, the import will REPLACE the forecast with the real line: the same transaction, now real, with the statement's date and amount. It keeps everything attached to it — its project, its repayment profile, its recurrence.",
    "Coché, le remplacement a lieu. Décoché, la ligne s'importe comme n'importe quelle autre et la dépense prévue reste telle quelle — tu te retrouves simplement avec les deux, comme avant. Vérifie la colonne de droite avant de confirmer : c'est elle qui dit ce qui sera écrasé. Et si tu te trompes, annuler l'import rend chaque prévision à son état d'origine.":
      "Ticked, the replacement happens. Unticked, the line imports like any other and the forecast expense stays as it is — you simply end up with both, as before. Check the right-hand column before confirming: it says what will be overwritten. And if you get it wrong, cancelling the import restores every forecast to its original state.",
    "Dépenses prévues reconnues": "Forecast expenses recognised",
    "{n} opération(s) importée(s), dont {p} qui remplacent une dépense prévue.":
      "{n} transaction(s) imported, {p} of which replace a forecast expense.",
    "Import annulé : {n} opération(s) supprimée(s), {p} dépense(s) prévue(s) rendue(s).":
      "Import cancelled: {n} transaction(s) deleted, {p} forecast expense(s) restored.",
    "Remplacer": "Replace",
    "Ligne du relevé": "Statement line",
    "Remplacera la dépense prévue": "Will replace the forecast expense",
    "prévue entre le {debut} et le {fin}": "expected between {debut} and {fin}",
    "prévue le {date}": "expected on {date}",
    "occurrence d'une opération récurrente": "occurrence of a recurring transaction",
    "Attendue à partir du": "Expected from",
    "Jusqu'au": "Until",
    "Mots-clés du libellé": "Label keywords",
    "Tout convertir":
      "Convert everything",
    "Tout convertir en {monnaie}":
      "Convert everything to {monnaie}",
    "Ce budget additionne les douze mois de l'année ET les monnaies converties :":
      "This budget adds up the twelve months of the year AND the converted currencies:",
    "Ce budget additionne les monnaies converties :":
      "This budget adds up the converted currencies:",
    "Pas de taux pour {monnaies} : ces montants ne sont pas comptés. Saisis leur taux dans Paramètres → Monnaies.":
      "No rate for {monnaies}: these amounts are left out. Enter their rate in Settings → Currencies.",
    "Aucune catégorie sélectionnée.":
      "No category selected.",
    "Catégorie modifiée":
      "Category updated",
    "Compte courant":
      "Current account",
    "Compte d'épargne":
      "Savings account",
    "Compte de placements":
      "Investment account",
    "Intérêts perçus":
      "Interest received",
    "Montant perçu":
      "Amount received",
    "Total perçu":
      "Total received",
    "Aucun versement saisi pour ce compte.":
      "No payment recorded for this account.",
    "Supprimer ce versement d'intérêts ?":
      "Delete this interest payment?",
    "Une date et un montant supérieur à zéro sont nécessaires.":
      "A date and an amount greater than zero are required.",
    "Versement ajouté.":
      "Payment added.",
    "Versement modifié.":
      "Payment updated.",
    "Versement supprimé.":
      "Payment deleted.",
    "Versement":
      "Payment",
    "Aucun compte d'épargne. Crée-en un depuis Paramètres → Comptes en choisissant le type":
      "No savings account. Create one from Settings → Accounts by choosing the type",
    "« épargne », puis reviens ici.":
      "« épargne », then come back here.",
    "Ces montants sont un":
      "These amounts are a",
    "suivi d'affichage":
      "display-only record",
    ": aucun intérêt n'est écrit en":
      ": no interest is written as a",
    "opération, aucun solde et aucun chiffre du dashboard n'en dépend. Si le versement figure sur":
      "transaction, and no balance or dashboard figure depends on it. If the payment appears on",
    "ton relevé, il entrera de lui-même par l'import — le saisir ici en plus ne le compterait pas":
      "your statement, it will come in through the import on its own — recording it here as well would not count it",
    "deux fois dans tes soldes, mais ne le remplace pas non plus.":
      "twice in your balances, but it does not replace it either.",
    "Amorti":
      "Spread",
    "Amortie":
      "Spread",
    "Récurrent":
      "Recurring",
    "Peu importe":
      "Any",
    "Oui":
      "Yes",
    "Non":
      "No",
    "Comporte des frais ?":
      "Has fees?",
    "Lié à une opération remboursable ?":
      "Linked to a reimbursable transaction?",
    "Lié à un prêt reçu ?":
      "Linked to a loan received?",
    "Montant à rembourser min":
      "Amount owed min",
    "Montant à rembourser max":
      "Amount owed max",
    "Reste à rembourser min":
      "Still owed min",
    "Reste à rembourser max":
      "Still owed max",
    "Montant envoyé min":
      "Amount sent min",
    "Montant envoyé max":
      "Amount sent max",
    "Montant reçu min":
      "Amount received min",
    "Montant reçu max":
      "Amount received max",
    "contient…":
      "contains…",
    "La valeur du montant sans son signe. Laisse une case vide pour ne pas borner de ce côté.":
      "The amount's value without its sign. Leave a box empty not to bound that side.",
    "Opération classique":
      "Standard transaction",
    "Virement interne":
      "Internal transfer",
    "Remboursement reçu":
      "Reimbursement received",
    "Remboursement de prêt":
      "Loan repayment",
    "Vue d'ensemble des placements":
      "Investments overview",
    "Vue d'ensemble":
      "Overview",
    "Retour aux placements":
      "Back to investments",
    "&larr; Retour aux placements":
      "&larr; Back to investments",
    "Répartition par type de titre":
      "Breakdown by security type",
    "Valeur du portefeuille":
      "Portfolio value",
    "Sans type":
      "No type",
    "{n} comptes":
      "{n} accounts",
    "{n} titre(s)":
      "{n} securities",
    "et {n} autre(s)":
      "and {n} more",
    "Aucun titre détenu pour le moment. Achète ou importe des titres depuis la page":
      "No securities held yet. Buy or import securities from the",
    "Placements financiers, et la répartition apparaîtra ici.":
      "Investments page, and the breakdown will appear here.",
    "Enregistrer le taux":
      "Save rate",
    "1 unité de":
      "1 unit of",
    "vaut, en":
      "is worth, in",
    "ce nombre d'unités":
      "this many units",
    "ex. 1,08":
      "e.g. 1.08",
    "Aucun taux enregistré.":
      "No rate saved.",
    "Taux supprimé":
      "Rate deleted",
    "relu en ligne":
      "read online",
    "saisi à la main":
      "entered by hand",
    "Le taux doit être un nombre strictement positif.":
      "The rate must be a strictly positive number.",
    "Choisis deux monnaies différentes.":
      "Choose two different currencies.",
    "Ajoute une seconde monnaie pour pouvoir saisir un taux.":
      "Add a second currency before entering a rate.",
    "Aucun taux relu en ligne : choisis « Depuis un lien » pour en suivre un.":
      "No rate read online: choose « From a link » to follow one.",

    // L'écran « D'où vient l'écart ? », ouvert depuis la carte de la
    // variation brute du dashboard (cf. loadEcartVariations).
    "D'où vient l'écart ?":
      "Where does the gap come from?",
    "← Retour au dashboard":
      "← Back to dashboard",
    "Les opérations qui l'expliquent":
      "The transactions that explain it",
    "Écart":
      "Gap",
    "Au compte":
      "On the account",
    "Au mois":
      "On the period",
    "Pourquoi":
      "Why",
    "Libellé":
      "Label",
    "Dépense étalée":
      "Spread expense",
    "Dépense remboursable":
      "Reimbursable expense",
    "Prêt reçu":
      "Loan received",
    "Les deux variations ne répondent pas à la même question, elles n'ont donc jamais le même chiffre. Voici, opération par opération, ce qui les sépare sur la période affichée.":
      "The two changes do not answer the same question, so they never show the same figure. Here is, transaction by transaction, what separates them over the displayed period.",
    "La variation brute moins la variation attribuée. C'est exactement la somme de la colonne « Écart » ci-dessous : tout ce qui a bougé le compte sans appartenir à cette période, ou l'inverse.":
      "The gross change minus the attributed change. It is exactly the sum of the « Écart » column below: everything that moved the account without belonging to this period, or the other way round.",
    "Chaque ligne montre ce que l'opération apporte aux DEUX calculs. « Au compte » : ce qui est passé, à sa date et pour son montant. « Au mois » : ce que la période en porte réellement. Une opération qui compte pareil des deux côtés n'apparaît pas — elle n'explique rien.":
      "Each row shows what the transaction contributes to BOTH calculations. « On the account »: what went through, on its date and for its amount. « On the period »: what the period actually carries. A transaction counting the same on both sides does not appear — it explains nothing.",
    "Aucun écart sur cette période : les deux variations disent la même chose.":
      "No gap over this period: both changes say the same thing.",
    "Objectif": "Target",
    "Objectif":
      "Target",
    "Ce que la période laisse, au sens de ce qu'elle COÛTE : « Total Entrées » moins « Total Dépenses », les deux cartes juste à gauche. Une dépense amortie n'y pèse que pour sa part du mois, une remboursable pour son reste à charge. Son écart avec la variation brute, à droite, est exactement le décalage entre le moment où l'argent sort et le mois auquel la dépense appartient.":
      "What the period leaves, in the sense of what it COSTS: « Total Entrées » minus « Total Dépenses », the two cards just to the left. An amortised expense weighs only for its share of the month, a reimbursable one for what it actually costs you. Its gap with the gross change, on the right, is exactly the lag between the moment the money leaves and the month the expense belongs to.",
    "De combien les comptes courants ont RÉELLEMENT bougé sur la période — le chiffre du relevé. Tout compte à sa date et pour son montant : une dépense amortie en entier, une dépense remboursable sans déduire ce qu'on rendra. Virements internes exclus. En jaune parce qu'elle ne répond pas à la même question que ses voisines : elle ne dit pas si la période a été bonne, elle dit ce qui est passé.":
      "How much the current accounts ACTUALLY moved over the period — the statement's figure. Everything counts on its date and for its amount: an amortised expense in full, a reimbursable one without deducting what will be paid back. Internal transfers excluded. In yellow because it does not answer the same question as its neighbours: it does not say whether the period was good, it says what went through.",
    "Entr\u00e9es \u2212 sorties (pr\u00e9visionnel inclus)": "Money in \u2212 money out (forecast included)",
    "Total des avoirs": "Total assets",
    "Tous comptes confondus, courant + \u00e9pargne": "All accounts, current + savings",
    "R\u00e9partition des avoirs": "Asset allocation",
    "La part du total des avoirs pos\u00e9e sur chaque type de compte, dans la monnaie choisie. Solde R\u00c9EL, titres d\u00e9tenus compris \u2014 pas le pr\u00e9visionnel.":
      "The share of total holdings sitting on each account type, in the chosen currency. REAL balance, securities held included \u2014 not the projected one.",
    "Aucun solde positif \u00e0 r\u00e9partir.": "No positive balance to break down.",
    "R\u00e9partition des avoirs par type de compte": "Asset breakdown by account type",
    "Comptes courants": "Current accounts",
    "Comptes d'\u00e9pargne": "Savings accounts",
    "Comptes de placements": "Investment accounts",
    "Le solde affich\u00e9 est celui des esp\u00e8ces disponibles sur le compte ; les titres d\u00e9tenus sont valoris\u00e9s dans \u00ab Total des avoirs \u00bb et d\u00e9taill\u00e9s dans l'onglet Placements financiers.":
      "The balance shown is the cash available on the account; the securities you hold are valued under \u201cTotal assets\u201d and detailed on the Investments page.",

    // ---------- Vue globale des comptes ----------
    "Vue globale des comptes": "Global account overview",
    // Le nom que prend cette page quand « Placements financiers » tourne : elle
    // montre alors les deux moitiés du patrimoine (cf. son manifeste,
    // navigation.section_libelle).
    "Vue des avoirs": "Assets overview",
    "Le solde affich\u00e9 repr\u00e9sente les esp\u00e8ces disponibles. La valeur de tes titres se lit dans Placements financiers.":
      "The balance shown is the available cash. What your holdings are worth is on the Investments page.",
    "D\u00e9penses par cat\u00e9gorie \u2014": "Spending by category \u2014",
    "Total entr\u00e9es": "Money in",
    "Total sorties": "Money out",
    "Diff\u00e9rence": "Difference",
    "Notes": "Notes",
    "Un pense-b\u00eate, non lu par l'app. \u00c7a s'enregistre tout seul.":
      "A scratchpad, never read by the app. It saves itself.",
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
    "Lignes de tête à ne pas importer": "Header rows to skip",
    "Combien de lignes, en tête du fichier, ne sont pas des opérations : les intitulés de colonnes, mais aussi le nom du titulaire, le numéro de compte ou une ligne vide que certaines banques écrivent avant. Laisse 0 si le fichier commence directement par une opération.":
      "How many rows at the top of the file are not transactions: the column headings, but also the account holder's name, the account number or a blank row that some banks write first. Leave 0 if the file starts straight away with a transaction.",
    "{n} colonne(s) lue(s)": "{n} column(s) read",
    "doublons : toutes les colonnes": "duplicates: every column",
    "doublons : toutes sauf {n}": "duplicates: all but {n}",
    "doublons : {n} colonne(s) comparée(s)": "duplicates: {n} column(s) compared",
    // Les trois sections repliées en fin de « Configuration du fichier », et la
    // partie secondaire des colonnes lues (cf. index.html, § Import).
    "Colonnes secondaires": "Secondary columns",
    "Lignes à ne pas importer": "Rows not to import",
    "Réglages de lecture (délimiteur, séparateur décimal)":
      "Reading settings (delimiter, decimal separator)",
    "aucune ligne ignorée": "no row skipped",
    "{n} ligne(s) ignorée(s)": "{n} row(s) skipped",
    "Aucune colonne désignée.": "No column named.",
    "Seules ces colonnes distinguent deux lignes.":
      "Only these columns tell two rows apart.",
    "Toutes les colonnes sont comparées, sauf celles-ci.":
      "Every column is compared, except these.",
    "Ajouter cette colonne": "Add this column",
    "Amortie sur plusieurs mois": "Spread over several months",
    // Découpe d'une opération entre plusieurs catégories.
    "Découper entre plusieurs catégories": "Split across several categories",
    // Les six opérateurs numériques d'une condition de règle (le champ
    // « Montant »). Les quatre opérateurs de texte sont déjà plus haut.
    "égal à": "equal to",
    "différent de": "different from",
    "supérieur à": "greater than",
    "supérieur ou égal à": "greater than or equal to",
    "inférieur à": "less than",
    "inférieur ou égal à": "less than or equal to",
    // La découpe posée par une règle.
    "découpée": "split",
    "La découpe ci-dessous tient lieu de catégorie.":
      "The split below stands in for the category.",
    "Une seule part peut valoir « reste ».": "Only one part can be \u00ab reste \u00bb.",
    "La règle répartit le montant de la ligne entre plusieurs catégories, au lieu d'en poser une seule. Réservé aux opérations classiques.":
      "The rule spreads the amount of the line across several categories instead of setting a single one. Plain operations only.",
    "+ Ajouter une part": "+ Add a part",
    "Chaque part dit combien elle prend. On peut écrire un nombre (50), un pourcentage (30%), une opération (montant - 50), ou utiliser min et max — par exemple min(montant; 50) pour « au plus 50 € ». Le mot reste donne à une part tout ce que les autres n'ont pas pris ; une seule part peut le porter, et la somme doit valoir le montant de la ligne.":
      "Each part says how much it takes. Write a number (50), a percentage (30%), an expression (montant - 50), or use min and max \u2014 for instance min(montant; 50) for \u00ab at most 50 \u20ac \u00bb. The word reste gives a part whatever the others did not take; only one part can carry it, and the total must match the amount of the line.",
    "Une seule opération, plusieurs catégories : un plein de courses dont une part de produits ménagers. Le total des parts doit valoir le montant de l'opération.":
      "One operation, several categories: a grocery run with a share of household products. The parts must add up to the amount of the operation.",
    "Ajouter une part": "Add a part",
    "Retirer cette part": "Remove this part",
    "Réparti": "Allocated",
    "reste à placer": "left to allocate",
    "Une découpe compte au moins deux parts remplies.":
      "A split needs at least two filled parts.",
    "Une même catégorie ne peut pas apparaître deux fois dans la découpe.":
      "The same category cannot appear twice in a split.",
    "Le total des parts doit valoir le montant de l'opération.":
      "The parts must add up to the amount of the operation.",
    "Découpée": "Split",
    "parts": "parts",
    "Voir le détail de la découpe": "Show the split details",
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
    "Un commentaire non lu par l'app. Sur un virement, il vaut pour les deux comptes.":
      "A comment never read by the app. On a transfer, it applies to both accounts.",
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
    "Tes titres, communs \u00e0 tous tes comptes : le m\u00eame ETF peut \u00eatre d\u00e9tenu sur deux comptes. Le cours se saisit \u00e0 la main, ou se relit en ligne avec l'extension Lecture de cours. Il ne sert qu'\u00e0 la valorisation, jamais \u00e0 un solde.":
      "Your holdings, shared across every account: the same ETF can be held on two of them. The price is entered by hand, or read online with the Price lookup extension. It only feeds valuation, never a balance.",
    "Nom du titre": "Security name",
    "ex. Air Liquide": "e.g. Air Liquide",
    "Monnaie de cotation": "Quote currency",
    "Cours actuel": "Current price",
    "Ajouter le titre": "Add security",
    // ----- Archiver un titre : rangé, jamais effacé -----
    "Afficher les titres archiv\u00e9s": "Show archived securities",
    "Archiver, c'est ranger, pas effacer : le titre quitte les listes, son historique reste. C'est ici qu'on le remet en service.":
      "Archiving files away, it does not erase: the holding leaves the lists, its history stays. This is where you bring it back.",
    "Archiver": "Archive",
    "Remettre en service": "Bring back",
    "archiv\u00e9": "archived",
    "Ranger ce titre : il quitte les listes, son historique reste":
      "File this security away: it leaves the lists, its history stays",
    "Remettre ce titre dans les listes": "Put this security back in the lists",
    "Titre archiv\u00e9. Ses mouvements et ses plus-values sont intacts.":
      "Security archived. Its movements and capital gains are intact.",
    "Titre remis en service.": "Security brought back.",

    // ---------- Extension \u00ab Lecture de cours \u00bb ----------
    // Deux greffes : l'\u00e9cran Placements (un lien de cotation par titre) et
    // l'\u00e9cran Monnaies (un taux par couple). Cf. extensions/lecture-de-cours.

    "Mettre \u00e0 jour les cours": "Update prices",
    "Pages reconnues": "Supported pages",
    "mis \u00e0 jour {quand}": "updated {quand}",
    // ----- Volet titres : le lien de cotation déplié sous chaque titre -----
    // Le formulaire « Suivre un cours en ligne » a été retiré : la flèche de
    // chaque rangée déplie le champ de lien du titre qu'on regarde déjà.
    "Lien de la page de cotation": "Quote page link",
    // ----- Volet monnaies : les taux de change -----
    "Taux de change": "Exchange rates",
    "Le taux d'un couple de monnaies, relu sur la page de cotation dont tu colles le lien. Rien n'est converti avec : les soldes, les budgets et les KPI restent suivis monnaie par monnaie, et ce taux ne sert qu'\u00e0 \u00eatre lu ici.":
      "The rate of a currency pair, read again from the quote page whose link you paste. Nothing is converted with it: balances, budgets and KPIs stay tracked currency by currency, and this rate is only there to be read.",
    "Mettre \u00e0 jour les taux": "Update rates",
    "Monnaie de d\u00e9part": "From currency",
    "Monnaie d'arriv\u00e9e": "To currency",
    "Suivre ce couple": "Track this pair",
    "Aucun couple suivi pour le moment.": "No pair tracked yet.",
    "la page": "the page",
    "Ne plus suivre": "Stop tracking",
    "jamais relu": "never read",
    "{n} couple(s) suivi(s)": "{n} pair(s) tracked",
    "jamais mis \u00e0 jour": "never updated",
    "{n} taux mis \u00e0 jour": "{n} rates updated",
    "Colle le lien de la page de cotation.": "Paste the link to the quote page.",
    "Taux lu sur {source} : {libelle} = {taux}": "Rate read on {source}: {libelle} = {taux}",
    "Couple enregistr\u00e9": "Pair saved",
    "Couple retir\u00e9. Aucun montant n'en d\u00e9pendait.":
      "Pair removed. No amount depended on it.",
    "Lecture en cours\u2026": "Reading\u2026",
    "Mettre \u00e0 jour": "Update",
    "D\u00e9tacher": "Detach",
    "Relire le cours maintenant": "Read this price now",
    "Ne plus suivre ce cours en ligne": "Stop tracking this price online",
    "Lien de la page de cotation (Google Finance, Yahoo Finance\u2026)":
      "Link to the quote page (Google Finance, Yahoo Finance\u2026)",
    "cours saisi \u00e0 la main": "price entered by hand",
    "\u00e0 l'instant": "just now",
    "il y a {n} min": "{n} min ago",
    "il y a {n} h": "{n} h ago",
    "jamais lus": "never read",
    "derni\u00e8re lecture {quand}": "last read {quand}",
    "{n} titre(s) suivi(s) en ligne": "{n} security(ies) tracked online",
    "{n} en \u00e9chec": "{n} failed",
    "{n} cours mis \u00e0 jour": "{n} prices updated",
    "Aucun titre n'a de lien \u00e0 relire": "No security has a link to read",
    "Aucun titre n'a de lien : ajoute-en un dans \u00ab Titres suivis \u00bb, en bas de page.":
      "No security has a link yet: add one under \u201cTracked securities\u201d, at the bottom of the page.",
    "Cours lu sur {source} : {nom} \u2014 {cours}": "Price read on {source}: {nom} \u2014 {cours}",
    "Lien enregistr\u00e9": "Link saved",
    "Lien retir\u00e9 \u2014 le cours redevient saisi \u00e0 la main":
      "Link removed \u2014 the price goes back to being entered by hand",
    "{n} cours n'ont pas pu \u00eatre relus au lancement (voir Placements)":
      "{n} prices could not be read at startup (see Investments)",
    "Tes titres, communs \u00e0 tous tes comptes. Colle le lien d'une page de cotation \u00e0 c\u00f4t\u00e9 d'un titre et son cours se relira tout seul : c'est la seule chose que l'app va chercher sur Internet, et seulement pour les titres qui ont un lien. Le cours dit ce que \u00e7a vaut aujourd'hui, jamais comment un solde est calcul\u00e9.":
      "Your securities, shared across all your accounts. Paste the link of a quotation page next to a security and its price will refresh on its own: that is the only thing the app fetches from the Internet, and only for securities that have a link. The price says what things are worth today, never how a balance is computed.",

    // ---------- Param\u00e8tres : onglets ----------
    "Comptes": "Accounts",
    "Cat\u00e9gories": "Categories",
    "Monnaies": "Currencies",
    "R\u00e8gles": "Rules",
    "Import": "Import",
    "Base de donn\u00e9es": "Database",

    // ---------- Modale d'annonce des extensions trouv\u00e9es au lancement ----------
    "Extensions d\u00e9tect\u00e9es": "Extensions detected",
    "Une extension a \u00e9t\u00e9 trouv\u00e9e dans le dossier \u00ab extensions \u00bb. Elle ne fonctionnera qu'une fois activ\u00e9e ci-dessous \u2014 fermer cette fen\u00eatre ne l'active pas.":
      "One extension was found in the \u201cextensions\u201d folder. It will not run until you set it to Enabled below \u2014 closing this window does not enable it.",
    "{n} extensions ont \u00e9t\u00e9 trouv\u00e9es dans le dossier \u00ab extensions \u00bb. Elles ne fonctionneront qu'une fois activ\u00e9es ci-dessous \u2014 fermer cette fen\u00eatre n'en active aucune.":
      "{n} extensions were found in the \u201cextensions\u201d folder. They will not run until you set them to Enabled below \u2014 closing this window enables none of them.",
    "Fermer": "Close",
    "Aller au menu extensions": "Go to the extensions menu",

    // ---------- Param\u00e8tres : extensions ----------
    "Extensions": "Extensions",
    "N\u00e9cessite au moins une de ces extensions, install\u00e9e et activ\u00e9e :":
      "Needs at least one of these extensions, installed and enabled:",
    "Une extension ajoute une fonctionnalit\u00e9. La d\u00e9sactiver fait dispara\u00eetre son \u00e9cran sans rien effacer \u2014 tout revient si tu la rallumes.":
      "An extension adds a feature. Turning it off makes its screen disappear without erasing anything \u2014 it all comes back if you turn it on again.",
    "Aucune extension install\u00e9e.": "No extensions installed.",
    "Activ\u00e9e": "Enabled",
    "D\u00e9sactiv\u00e9e": "Disabled",
    "\u00c9tat de l'extension": "Extension state",
    "Afficher ce que fait cette extension": "Show what this extension does",
    "Afficher l'avertissement": "Show the warning",
    "Afficher l'explication": "Show the explanation",
    "Ajouter une monnaie": "Add a currency",
    "d\u00e9veloppeur": "developer",
    "Extension activ\u00e9e.": "Extension enabled.",
    "Extension d\u00e9sactiv\u00e9e. Aucune donn\u00e9e n'a \u00e9t\u00e9 supprim\u00e9e.":
      "Extension disabled. No data was deleted.",
    "Extension non charg\u00e9e": "Extension failed to load",

    // ---------- Param\u00e8tres : comptes ----------
    "Double-clique une ligne pour modifier un compte, fais-la glisser d'une carte \u00e0 l'autre pour changer son type.":
      "Double-click a row to edit an account, drag it from one card to another to change its type.",
    "Ajouter un compte": "Add an account",
    "Nom": "Name",
    "Type": "Type",
    "Monnaies du compte": "Account currencies",
    "Chaque monnaie du compte garde son propre solde, jamais m\u00e9lang\u00e9 aux autres \u2014 d'o\u00f9 un solde initial par monnaie.":
      "Each of the account's currencies keeps its own balance, never mixed with the others \u2014 hence one opening balance per currency.",
    "Types de comptes": "Account types",
    "Les trois types livr\u00e9s avec l'application sont prot\u00e9g\u00e9s : ils pilotent le dashboard et les r\u00e8gles de virement. Un compte passe de l'un \u00e0 l'autre en le faisant glisser d'une carte \u00e0 l'autre, plus haut sur cette page.":
      "The three types shipped with the application are protected: they drive the dashboard and the transfer rules. An account moves from one to another by dragging it from one card to another, higher up on this page.",
    "Ajouter": "Add",

    // ---------- Param\u00e8tres : cat\u00e9gories ----------
    "Cat\u00e9gories de d\u00e9penses": "Spending categories",
    "Les cat\u00e9gories dans lesquelles tes d\u00e9penses se rangent : leur nom, et l'ordre dans lequel tu les vois partout ailleurs. Ce qu'on LEUR ALLOUE \u2014 le budget d'un mois, la part qu'elles devraient peser \u2014 se r\u00e8gle sur la page Budget, o\u00f9 elles se voient toutes ensemble. \u00ab Autres \u00bb ne peut ni \u00eatre renomm\u00e9e ni supprim\u00e9e : c'est elle qui recueille les op\u00e9rations d'une cat\u00e9gorie qu'on efface.":
      "The categories your spending falls into: their name, and the order you see them in everywhere else. What gets ALLOCATED to them \u2014 a month's budget, the share they should weigh \u2014 is set on the Budget page, where they are all visible together. \u00ab Autres \u00bb can neither be renamed nor deleted: it is where the transactions of a category you erase end up.",
    "Ordre": "Order",
    "Budget": "Budget",
    "Ajouter une cat\u00e9gorie": "Add a category",

    // ---------- Extension \u00ab Budget \u00bb : la page ----------
    "Budget du mois": "Monthly budget",
    "Montant du budget": "Budget amount",
    "Budgets par cat\u00e9gorie": "Budgets by category",
    "Objectif de r\u00e9partition": "Allocation target",
    "Budget de la cat\u00e9gorie": "Category budget",
    "Total r\u00e9parti": "Allocated in total",
    "Aucune cat\u00e9gorie.": "No category.",
    "h\u00e9rit\u00e9": "inherited",
    "Ne s'accorde pas avec le budget du mois.":
      "Does not add up with the monthly budget.",
    "Ce que tu te donnes \u00e0 d\u00e9penser sur le mois, dans cette monnaie. C'est le d\u00e9nominateur de tout le reste : la vue \u00ab Budget \u00bb du camembert du dashboard y rapporte chaque cat\u00e9gorie, et les objectifs en pourcentage ci-dessous sont des parts de LUI. Un mois que tu n'as pas rempli reprend le dernier montant \u00e9crit \u2014 avant comme apr\u00e8s lui \u2014 et le dit. Z\u00e9ro le retire.":
      "What you allow yourself to spend over the month, in this currency. It is the denominator of everything else: the dashboard pie chart's \u00ab Budget \u00bb view relates every category to it, and the percentage targets below are shares of IT. A month you have not filled in inherits the nearest amount written \u2014 before or after it \u2014 and says so. Zero removes it.",
    "Il se pose mois par mois et monnaie par monnaie : 15 000 \u00a5 ne se comparent \u00e0 aucun euro, et un budget de janvier ne dit rien de celui de f\u00e9vrier. Change de mois dans la rang\u00e9e ci-dessus pour en \u00e9crire un autre.":
      "It is set month by month and currency by currency: 15,000 \u00a5 compare to no euro, and January's budget says nothing about February's. Switch month in the row above to write another one.",
    "Deux grandeurs par cat\u00e9gorie, et elles ne se d\u00e9duisent pas l'une de l'autre. Le BUDGET est une enveloppe en valeur pour ce mois-ci : il r\u00e9pond \u00e0 \u00ab combien puis-je encore d\u00e9penser \u00bb, et c'est lui que dessine le trait rouge de l'histogramme du dashboard. L'OBJECTIF est une part du budget total, la m\u00eame tous les mois et dans toutes les monnaies : il r\u00e9pond \u00e0 \u00ab quelle part doit aller l\u00e0 \u00bb, et c'est lui qu'affiche le camembert en vue Budget. Poser l'un n'oblige jamais \u00e0 poser l'autre.":
      "Two quantities per category, and neither follows from the other. The BUDGET is an envelope in money for this month: it answers \u00ab how much can I still spend \u00bb, and it is what the red line on the dashboard chart draws. The TARGET is a share of the total budget, the same every month and in every currency: it answers \u00ab what share should go there \u00bb, and it is what the pie chart shows in Budget view. Setting one never requires setting the other.",
    "Glisse pour r\u00e9partir, \u00e9cris dans le champ \u00e0 c\u00f4t\u00e9 pour poser une valeur exacte ; c'est en rel\u00e2chant que \u00e7a s'enregistre. Les objectifs ne peuvent pas d\u00e9passer 100 % \u00e0 eux tous \u2014 la course du curseur te dit ce qu'il reste \u00e0 placer \u2014 mais rien ne t'oblige \u00e0 les atteindre : n'en poser que sur trois cat\u00e9gories est le cas ordinaire. Quand le budget d'une cat\u00e9gorie et son objectif ne s'accordent plus avec le total du mois, la ligne le dit et propose les deux corrections chiffr\u00e9es.":
      "Drag to allocate, type in the field next to it to set an exact value; it saves when you let go. Targets cannot add up past 100 % \u2014 the slider's travel tells you what is left to place \u2014 but nothing forces you to reach it: setting them on three categories only is the ordinary case. When a category's budget and its target no longer add up with the month's total, the row says so and offers both corrections, with figures.",

    // ---------- Param\u00e8tres : monnaies ----------
    "Chaque monnaie garde ses propres soldes et budgets, jamais m\u00e9lang\u00e9s aux autres. Le symbole est ce qui s'affiche \u00e0 c\u00f4t\u00e9 des montants.":
      "Each currency keeps its own balances and budgets, never mixed with the others. The symbol is what shows next to amounts.",
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
    "Elles sont \u00e9valu\u00e9es": "They are evaluated",
    "de haut en bas": "top to bottom",
    ", et s'arr\u00eatent \u00e0 la premi\u00e8re qui correspond \u2014 sauf si celle-ci d\u00e9coche \u00ab Arr\u00eater la lecture des r\u00e8gles ici \u00bb. Plusieurs r\u00e8gles peuvent alors s'appliquer \u00e0 une m\u00eame ligne, mais aucune ne d\u00e9fait ce qu'une r\u00e8gle plus haute a d\u00e9cid\u00e9 :":
      ", stopping at the first one that matches \u2014 unless it unticks \u201cStop reading rules here\u201d. Several rules can then apply to the same row, but none undoes what a higher rule decided:",
    "en cas de d\u00e9saccord, la plus haute gagne": "when they disagree, the highest one wins",
    ". Place les cas particuliers au-dessus des cas g\u00e9n\u00e9raux.":
      ". Put the special cases above the general ones.",
    "Les r\u00e8gles passent": "Rules come",
    "avant": "before",
    // ----- Vue galerie -----
    "Vue liste": "List view",
    "Vue galerie": "Gallery view",
    "+ Nouveau dossier": "+ New folder",
    "Les dossiers ne servent qu'\u00e0 s'y retrouver : ils": "Folders are only there to find your way around: they",
    "ne changent pas l'ordre d'\u00e9valuation": "do not change the evaluation order",
    ", qui reste celui de la vue liste (le num\u00e9ro sur chaque carte le rappelle). Fais glisser une r\u00e8gle d'un dossier \u00e0 l'autre pour la ranger. Ce classement reste sur cet ordinateur \u2014 il n'est pas enregistr\u00e9 dans la base.":
      ", which stays that of the list view (the number on each card is a reminder). Drag a rule from one folder to another to file it. This filing stays on this computer \u2014 it is not stored in the database.",
    "Glisse une r\u00e8gle ici.": "Drag a rule here.",
    "Rang d'\u00e9valuation": "Evaluation rank",
    "inactive": "inactive",
    "Nom du nouveau dossier": "Name of the new folder",
    "Nouveau nom du dossier": "New folder name",
    "Un dossier porte d\u00e9j\u00e0 ce nom.": "A folder already has that name.",
    "Supprimer le dossier": "Delete folder",
    "Ses r\u00e8gles reviendront dans \u00ab Autres \u00bb.": "Its rules will move back to \u201cOthers\u201d.",
    "\u21b3 la lecture continue avec les r\u00e8gles suivantes":
      "\u21b3 reading continues with the rules below",
    "les correspondances m\u00e9moris\u00e9es : un type reconnu ici ne peut plus \u00eatre d\u00e9fait par une correspondance de cat\u00e9gorie.":
      "the remembered mappings: a type recognised here can no longer be undone by a category mapping.",
    "R\u00e8gles de cat\u00e9gorisation": "Categorisation rules",
    "Une r\u00e8gle reconna\u00eet des lignes \u00e0 leur libell\u00e9 et dit ce qu'elles sont : virement interne, pr\u00eat, d\u00e9pense remboursable\u2026 Elle peut aussi poser la cat\u00e9gorie, et passe avant tout le reste.":
      "A rule recognises rows by their label and says what they are: internal transfer, loan, reimbursable expense\u2026 It can also set the category, and comes before everything else.",
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
    "L'autre compte du virement, celui que le relev\u00e9 ne nomme pas. Le sens se d\u00e9duit du signe du montant. Sans lui, la ligne est \u00e0 compl\u00e9ter \u00e0 la main dans l'aper\u00e7u.":
      "The transfer's other account, the one the statement does not name. The direction follows the sign of the amount. Without it, the row must be completed by hand in the preview.",
    "\u2014 \u00e0 renseigner \u00e0 l'import \u2014": "\u2014 to be filled in at import \u2014",
    "R\u00e8gle active": "Rule active",
    "Arr\u00eater la lecture des r\u00e8gles ici": "Stop reading rules here",
    "Coch\u00e9, le r\u00e9glage habituel : cette r\u00e8gle d\u00e9cide, on s'arr\u00eate l\u00e0. D\u00e9coch\u00e9, les r\u00e8gles suivantes peuvent compl\u00e9ter ce qu'elle laisse ouvert \u2014 la cat\u00e9gorie, le compte en face. Le type reste celui de la premi\u00e8re r\u00e8gle qui a mordu.":
      "Ticked, the usual setting: this rule decides and we stop there. Unticked, the rules after it can fill in what it leaves open \u2014 the category, the facing account. The type stays that of the first rule that matched.",
    // Onglet des Param\u00e8tres (les r\u00e8gles \u00e9tant parties dans une extension).
    "Correspondances": "Mappings",
    "Correspondances m\u00e9moris\u00e9es": "Remembered mappings",
    "Tout ce que l'app a retenu de tes imports : un libell\u00e9 rang\u00e9 une fois dans une cat\u00e9gorie y repart tout seul les fois suivantes.":
      "Everything the app has remembered from your imports: a label filed once under a category goes back there on its own next time.",
    "Cat\u00e9gories bancaires": "Bank categories",
    "Chaque libell\u00e9 de tes relev\u00e9s, sous la cat\u00e9gorie o\u00f9 il part. Fais-en glisser un dans une autre colonne pour le reclasser. Entre parenth\u00e8ses, le compte d'o\u00f9 vient le relev\u00e9.":
      "Each label from your statements, under the category it goes to. Drag one into another column to refile it. In brackets, the account the statement came from.",
    "Comptes bancaires": "Bank accounts",
    "Les noms de compte lus dans tes relev\u00e9s, et le compte de l'app en face. Une entr\u00e9e partag\u00e9e par plusieurs presets les met tous \u00e0 jour.":
      "The account names read from your statements, and the app account facing each one. An entry shared by several presets updates them all.",
    "Devises": "Currencies",
    "Les libell\u00e9s de devise de tes relev\u00e9s (\u00ab EUR \u00bb), et la monnaie de l'app en face. Vide si aucun preset ne lit de colonne de devise.":
      "The currency labels from your statements (\u201cEUR\u201d), and the app currency facing each one. Empty if no preset reads a currency column.",

    // ---------- Param\u00e8tres : import ----------
    "D\u00e9pose l'export Excel ou CSV de ta banque. Avant de valider, tu auras deux choses \u00e0 faire : dire dans quelles cat\u00e9gories ranger les libell\u00e9s que l'app ne conna\u00eet pas encore, et jeter un \u0153il aux doublons qu'elle a rep\u00e9r\u00e9s.":
      "Drop in your bank's Excel or CSV export. Before you can confirm, two things to do: say which categories the labels the app does not know yet belong to, and take a look at the duplicates it has spotted.",

    // ---------- Les cat\u00e9gories pos\u00e9es \u00e0 l'installation ----------
    // Une cat\u00e9gorie est une DONN\u00c9E, pas un texte d'interface : celles que
    // l'utilisateur cr\u00e9e gardent le nom qu'il leur a donn\u00e9. Seules celles que
    // l'application pose elle-m\u00eame \u00e0 l'installation ont un \u00e9quivalent anglais,
    // et `t()` ne rend que ce qu'il conna\u00eet (cf. libelleCategorie dans app.js).
    "Alimentaire": "Food & groceries",
    "Loisirs": "Leisure",
    "Transports": "Transport",
    "Charges fixes": "Fixed costs",
    "Entrées d'argent": "Income",
    "Autres": "Others",

    // ---------- Param\u00e8tres : import, annulation d'un import ----------
    "Annuler un import retire les op\u00e9rations qu'il avait cr\u00e9\u00e9es, celles que tu as modifi\u00e9es depuis comprises. Le fichier redevient importable.":
      "Undoing an import removes the transactions it created, including those you have edited since. The file becomes importable again.",
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
    "\u00c0 r\u00e9gler seulement si le fichier est mal lu : colonnes m\u00e9lang\u00e9es, montants illisibles. L'app devine seule dans la plupart des cas.":
      "Only worth setting if the file is read wrongly: mixed-up columns, unreadable amounts. The app works it out on its own most of the time.",
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
    "Tout ce qui est propre au format d'une banque : colonnes \u00e0 lire, libell\u00e9s d\u00e9j\u00e0 rang\u00e9s, lignes d\u00e9j\u00e0 import\u00e9es. Un preset par banque.":
      "Everything specific to one bank's format: which columns to read, labels already filed, rows already imported. One preset per bank.",
    "+ Nouveau preset": "+ New preset",
    "Renommer": "Rename",
    "Supprimer ce preset": "Delete this preset",
    "Compte bancaire de ce preset": "Bank account for this preset",
    "Toutes les lignes du fichier iront sur ce compte. Laisse \u00ab aucun \u00bb si le fichier nomme lui-m\u00eame le compte de chaque ligne.":
      "Every row in the file will go to this account. Leave \u201cnone\u201d if the file names each row's account itself.",
    "\u2014 aucun : le compte vient du fichier \u2014": "\u2014 none: the account comes from the file \u2014",
    "Configuration du fichier": "File configuration",
    "Indique quelles colonnes lire dans ton fichier (le nombre est libre) et \u00e0 quelle information de l'app chacune correspond. Date, Nature et Montant sont obligatoires ; Cat\u00e9gorie bancaire est facultative. Tout le reste \u2014 compte, sens, devises, montant envoy\u00e9, frais, \u00e9tat \u2014 se configure dans \u00ab Configuration avanc\u00e9e \u00bb plus bas.":
      "State which columns to read in your file (there is no limit) and which piece of app information each one holds. Date, Description and Amount are required; Bank category is optional. Everything else \u2014 account, direction, currencies, amount sent, fees, status \u2014 is configured under \u201cAdvanced configuration\u201d below.",
    "Clique sur l'\u0153il pour lire ou ignorer une colonne. Date, Nature et Montant sont obligatoires et ne s'\u00e9teignent pas.":
      "Click the eye to read or ignore a column. Date, Description and Amount are required and cannot be switched off.",
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
    "Pour ce que ton relev\u00e9 dit en plus : le compte, le sens, les devises, les frais. Laisse vide si ton relev\u00e9 tient dans une seule colonne de montant et une seule monnaie. Le \u00ab i \u00bb de chaque ligne dit \u00e0 quoi elle sert.":
      "For whatever your statement says on top: the account, the direction, the currencies, the fees. Leave it empty if your statement fits in a single amount column and a single currency. The \u201ci\u201d on each row says what it is for.",

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
    "Les mots que ta banque emploie pour dire qu'une ligne sort ou entre. Ajoute-les un par un avec \u00ab + \u00bb ou Entr\u00e9e ; majuscules et accents sont ignor\u00e9s. Retenus avec le preset.":
      "The words your bank uses to say a row goes out or comes in. Add them one at a time with \u201c+\u201d or Enter; case and accents are ignored. Kept with the preset.",
    "Laisse vide pour garder les mots-cl\u00e9s reconnus par d\u00e9faut, rappel\u00e9s sous chaque champ. D\u00e8s que tu en ajoutes un, il remplace toute la liste par d\u00e9faut de ce sens-l\u00e0.":
      "Leave it empty to keep the keywords recognised by default, recalled under each field. As soon as you add one, it replaces the whole default list for that direction.",
    "Sortie (argent qui part)": "Money out (leaving)",
    "Par d\u00e9faut :": "Default:",
    "Entr\u00e9e (argent qui rentre)": "Money in (arriving)",
    "Mots-cl\u00e9s de la colonne \u00ab \u00c9tat \u00bb": "Keywords for the \u201cStatus\u201d column",
    "Les mots que ta banque emploie pour dire o\u00f9 en est une op\u00e9ration, m\u00eame fonctionnement qu'au-dessus. Un mot inconnu met la ligne en erreur plut\u00f4t que d'\u00eatre devin\u00e9.":
      "The words your bank uses to say where a transaction stands, same as above. An unknown word puts the row in error rather than being guessed.",
    "Laisse vide pour garder les mots-cl\u00e9s reconnus par d\u00e9faut. D\u00e8s que tu en ajoutes un, il remplace toute la liste par d\u00e9faut de cet \u00e9tat-l\u00e0.":
      "Leave it empty to keep the keywords recognised by default. As soon as you add one, it replaces the whole default list for that status.",
    Sortie: "Money out",
    "Entr\u00e9e": "Money in",
    "Ex\u00e9cut\u00e9": "Settled",
    "Refus\u00e9 / annul\u00e9": "Declined / cancelled",
    "D\u00e9bit": "Debit",
    "Cr\u00e9dit": "Credit",
    "Refus\u00e9": "Declined",
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
    "Ton relev\u00e9 \u00e9crit \u00ab EUR \u00bb, l'app conna\u00eet les monnaies que tu as nomm\u00e9es. Dis-le une fois, c'est retenu pour la suite.":
      "Your statement writes \u201cEUR\u201d, the app knows the currencies you named. Say it once, it is remembered from then on.",
    "Devises d\u00e9j\u00e0 rattach\u00e9es": "Currencies already linked",
    "Ces libell\u00e9s ont d\u00e9j\u00e0 leur correspondance : rien \u00e0 faire, c'est l\u00e0 pour v\u00e9rifier avant de confirmer.":
      "These labels already have their match: nothing to do, it is here so you can check before confirming.",
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
    "Veille des doublons de virement : {compares} ligne(s) compar\u00e9e(s) sur {total}":
      "Transfer-duplicate watch: {compares} row(s) compared out of {total}",
    "{n} ressemblance(s) trouv\u00e9e(s).": "{n} look-alike(s) found.",
    "aucune ressemblance.": "no look-alike.",
    "{n} ligne(s) n'ont pas pu \u00eatre compar\u00e9es : il leur manque une date ou un compte reconnu.":
      "{n} row(s) could not be compared: they lack a date or a recognised account.",
    "Deux relev\u00e9s de deux banques d\u00e9crivent le m\u00eame virement avec des colonnes qui n'ont rien de commun : la d\u00e9tection de doublons ordinaire, qui compare des lignes de fichier, ne peut structurellement pas les voir. Celle-ci compare la":
      "Two statements from two banks describe the same transfer with columns that have nothing in common: ordinary duplicate detection, which compares file rows, structurally cannot see them. This one compares the",
    "transaction": "transaction",
    "\u2014 le compte que ton relev\u00e9 nomme, les devises, un des deux montants, et une date voisine.":
      "itself \u2014 the account your statement names, the currencies, one of the two amounts, and a nearby date.",
    "Un seul compte suffit": "One account is enough",
    ": tu n'as pas \u00e0 retrouver le compte d'en face pour savoir si tu as d\u00e9j\u00e0 la ligne. C'est m\u00eame l'inverse \u2014 le compte d'en face montr\u00e9 en italique est celui que l'op\u00e9ration ressemblante te donne, et rien n'est enregistr\u00e9 tant que tu ne l'as pas repris \u00e0 la main. Rien n'est bloqu\u00e9 ni pr\u00e9-s\u00e9lectionn\u00e9 : toi seul sais si tu as vraiment vir\u00e9 deux fois. Chaque ligne est suivie de ce \u00e0 quoi elle ressemble.":
      ": you do not have to track down the facing account to know whether you already have the row. It is the other way round \u2014 the facing account shown in italics is the one the look-alike transaction gives you, and nothing is stored until you enter it yourself. Nothing is blocked or pre-selected: you alone know whether you really transferred twice. Each row is followed by what it resembles.",
    "\u00c9metteur": "Sender",
    "R\u00e9cepteur": "Receiver",
    "Compte lu sur l'op\u00e9ration \u00e0 laquelle cette ligne ressemble. Rien n'est enregistr\u00e9 : reprends-le par \u00ab Modifier \u00bb si tu veux vraiment importer cette ligne.":
      "Account read from the transaction this row resembles. Nothing is stored: enter it through \u201cEdit\u201d if you really want to import this row.",
    "Doublons d\u00e9tect\u00e9s \u2014": "Duplicates detected \u2014",
    "Ces lignes sont identiques \u00e0 des lignes d\u00e9j\u00e0 import\u00e9es : chacune est suivie de celle qu'elle recopie. Elles sont coch\u00e9es pour \u00eatre \u00e9cart\u00e9es d'un clic \u2014 d\u00e9coches-en une pour l'importer quand m\u00eame, deux achats identiques le m\u00eame jour \u00e7a arrive.":
      "These rows are identical to rows already imported: each is followed by the one it repeats. They are ticked so you can drop them in one click \u2014 untick one to import it anyway, two identical purchases on the same day do happen.",
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
    "Configuration enregistrée, fichier relu.": "Configuration saved, file re-read.",
    "Fermer ce message": "Dismiss this message",
    "Thème": "Theme",
    "Sombre": "Dark",
    "Clair": "Light",
    "Le mode clair ou le mode sombre. Le choix vit sur cette machine, comme la langue : il ne voyage pas avec tes données, et l'autre poste garde le sien.":
      "Light or dark mode. The choice lives on this machine, like the language: it does not travel with your data, and the other computer keeps its own.",
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
    "Un compte de placements financiers n'accepte que des virements internes et des achats/ventes de titres (onglet Placements financiers).":
      "An investment account only accepts internal transfers and security purchases or sales (Investments page).",
    "Type d'op\u00e9ration introuvable": "Transaction type not found",
    "Le type 'Virement interne' est r\u00e9serv\u00e9 aux virements, cr\u00e9\u00e9s via /virements (deux \u00e9critures li\u00e9es).":
      "The 'Virement interne' type is reserved for transfers, created through /virements (two linked entries).",
    "Cette \u00e9criture appartient \u00e0 un achat/vente de titres : modifie-la depuis l'onglet Placements financiers.":
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
    // ----- Le détail par semaine de l'histogramme -----
    "D\u00e9tailler par semaine": "Break down by week",
    "Moyenne": "Average",
    "Replier les semaines": "Collapse the weeks",
    "ann\u00e9e {annee}": "year {annee}",
    "du {debut} au {fin} {mois}": "{mois} {debut} to {fin}",
    "moyenne des {n} semaines de {mois}": "average of the {n} weeks of {mois}",
    // ----- Les cartes de flux, sous le sélecteur de période -----
    "Total Entr\u00e9es": "Total money in",
    "Total D\u00e9penses": "Total spending",
    "Ce que la p\u00e9riode rapporte, virements internes exclus. Un pr\u00eat re\u00e7u n'y entre pas : il faudra le rendre. Reste sur le mois entier, semaine d\u00e9pli\u00e9e ou non.":
      "What the period brings in, internal transfers excluded. A loan received is not counted: it will have to be paid back. Stays on the whole month, week unfolded or not.",
    "Ce que la p\u00e9riode co\u00fbte, et non ce qui sort du compte : une d\u00e9pense amortie ne compte que pour sa part du mois, une remboursable pour le reste \u00e0 charge. Virements internes exclus. Reste sur le mois entier, semaine d\u00e9pli\u00e9e ou non.":
      "What the period costs, not what leaves the account: an amortised expense only counts for its share of the month, a reimbursable one for the amount left to bear. Internal transfers excluded. Stays on the whole month, week unfolded or not.",
    "De combien les comptes courants ont boug\u00e9 sur la p\u00e9riode. Tout compte \u00e0 sa date et pour son montant : une d\u00e9pense amortie en entier, une d\u00e9pense remboursable sans d\u00e9duire ce qu'on rendra. Virements internes exclus.":
      "How much the current accounts moved over the period. Everything counts on its date and for its amount: an amortised expense in full, a reimbursable one without deducting what will come back. Internal transfers excluded.",
    // ----- La troisième carte de flux : un STOCK, pas un flux -----
    "Reste à rembourser": "Left to settle",
    "Ce qu'on te doit encore sur tes dépenses remboursables, moins ce que tu dois encore sur les prêts reçus. NE DÉPEND PAS DE LA PÉRIODE : c'est l'état de tes créances et de tes dettes aujourd'hui, pas un chiffre du mois. Seules les opérations réelles comptent.":
      "What you are still owed on your reimbursable expenses, minus what you still owe on loans received. DOES NOT DEPEND ON THE PERIOD: this is the state of your claims and debts today, not a figure for the month. Only real transactions count.",
    "on te doit": "you are owed",
    "tu dois": "you owe",
    // ----- Le panneau « Base de données » : le reset du mode développement -----
    "Revenir à la base de l'application": "Back to the application's database",
    "Revenir à la base de l'application ? La base actuellement ouverte est simplement refermée — aucun fichier n'est modifié ni supprimé.":
      "Back to the application's database? The database currently open is simply closed — no file is modified or deleted.",
    // ----- Une monnaie éteinte sur un compte (migration 0053) -----
    "Active": "Active",
    "Monnaie éteinte : plus proposée à la saisie ni devinée à l'import. Ses opérations sont toujours en base.":
      "Currency switched off: no longer offered when entering a transaction, nor guessed on import. Its transactions are still in the database.",
    "Décoche pour que cette monnaie ne soit plus proposée à la saisie ni devinée à l'import. Les opérations déjà enregistrées restent en base.":
      "Uncheck so this currency is no longer offered when entering a transaction, nor guessed on import. Transactions already recorded stay in the database.",
    "Le solde de ce compte dans cette monnaie n'est pas nul : vire ce qui reste ailleurs avant d'éteindre.":
      "This account's balance in that currency is not zero: move what is left elsewhere before switching it off.",
    // ----- Un compte ou une catégorie éteints (migration 0063) -----
    "Éteindre": "Switch off",
    "Rallumer": "Switch back on",
    "Compte éteint": "Account switched off",
    "Compte rallumé": "Account switched back on",
    "Catégorie éteinte": "Category switched off",
    "Catégorie rallumée": "Category switched back on",
    "Un compte éteint n'est plus proposé à la saisie ni à l'import. Ses opérations restent en base, et il reparaît sur une période où il portait encore de l'argent.":
      "A switched-off account is no longer offered when entering a transaction or importing. Its transactions stay in the database, and it reappears over any period where it still held money.",
    "Une catégorie éteinte n'est plus proposée à la saisie, ni par les règles d'import, ni sur la page Budget. Ses opérations restent en base et gardent leur barre sur les périodes où elles tombent.":
      "A switched-off category is no longer offered when entering a transaction, by import rules, or on the Budget page. Its transactions stay in the database and keep their bar over the periods they fall in.",
    // ----- Extension « Suivi des remboursements » -----
    "Suivi des remboursements": "Repayment tracking",
    // La flèche fait partie du nœud de texte du bouton : le dictionnaire la
    // porte donc aussi (cf. traduireDomStatique, qui traduit le nœud entier).
    "← Retour au tableau de bord": "← Back to the dashboard",
    "Qui te doit combien, et à qui tu dois. Un profil est une étiquette : une personne, une entreprise, la colocation. Rien n'est recalculé ailleurs — les soldes, le dashboard et l'histogramme donnent exactement les mêmes chiffres, cet écran ne fait que les ventiler.":
      "Who owes you how much, and whom you owe. A profile is a label: a person, a company, the flatshare. Nothing is recomputed elsewhere — balances, the dashboard and the histogram give exactly the same figures; this screen only breaks them down.",
    "Rien à suivre pour l'instant : aucune dépense remboursable ni aucun prêt reçu n'attend de règlement. Les lignes apparaîtront ici dès qu'il en existera une.":
      "Nothing to track yet: no reimbursable expense and no loan received is awaiting settlement. Rows will appear here as soon as one exists.",
    "On te doit": "You are owed",
    "Tu dois": "You owe",
    "Solde net": "Net balance",
    "Le reste dû de tes dépenses remboursables, celles que tu as avancées. Une ligne par monnaie : rien n'est additionné d'une devise à l'autre. Seules les opérations réelles comptent.":
      "What is still owed on your reimbursable expenses, the ones you paid up front. One line per currency: nothing is added across currencies. Only real transactions count.",
    "Le reste dû de tes prêts reçus, une ligne par monnaie. Nécessite l'extension « Prêts » pour qu'il existe des prêts à suivre.":
      "What is still owed on the loans you received, one line per currency. Requires the “Loans” extension for there to be any loans to track.",
    "Ce qu'on te doit moins ce que tu dois, DANS chaque monnaie — jamais entre elles. C'est le même chiffre que la carte « Reste à rembourser » du tableau de bord, qui n'en montre qu'une à la fois.":
      "What you are owed minus what you owe, WITHIN each currency — never across them. It is the same figure as the dashboard's “Left to settle” card, which only shows one at a time.",
    "Qui doit combien": "Who owes how much",
    "Une ligne par profil, et à l'intérieur une barre par monnaie où il porte quelque chose. La barre va à droite quand on te doit, à gauche quand tu dois ; sa longueur se compare au plus gros solde de SA monnaie — deux devises ne se comparent jamais. Clique une ligne pour voir ses opérations.":
      "One row per profile, and inside it one bar per currency in which it carries something. The bar goes right when you are owed, left when you owe; its length compares to the largest balance in ITS currency — two currencies are never compared. Click a row to see its transactions.",
    "À rattacher": "To assign",
    "Les dépenses remboursables et les prêts encore dus qu'aucun profil ne porte. Coche des lignes, choisis un profil, et le tableau du dessus se met à jour.":
      "Reimbursable expenses and loans still outstanding that no profile carries. Tick some rows, pick a profile, and the table above updates.",
    "Profils": "Profiles",
    "Une étiquette, et rien de plus : aucun calcul de l'application ne la lit. En supprimer un détache ses opérations, il ne les efface jamais.":
      "A label, and nothing more: no calculation in the application reads it. Deleting one detaches its transactions; it never erases them.",
    "Ajouter un profil": "Add a profile",
    "Ajouter le profil": "Add profile",
    "ex. Marie": "e.g. Marie",
    "Note": "Note",
    "ex. voisine du dessus, rembourse en fin de mois": "e.g. neighbour upstairs, repays at the end of the month",
    "Sans profil": "No profile",
    "ligne": "row",
    "lignes": "rows",
    "Règlement": "Settlement",
    "Reste dû": "Still owed",
    "Détacher": "Detach",
    "Tout cocher": "Tick all",
    "Rattacher au profil": "Assign to profile",
    "Rattacher la sélection": "Assign selection",
    "Coche au moins une ligne à rattacher.": "Tick at least one row to assign.",
    "Opérations rattachées.": "Transactions assigned.",
    "Opération détachée.": "Transaction detached.",
    "Aucune opération rattachée à ce profil.": "No transaction assigned to this profile.",
    "Crée d'abord un profil ci-dessous, puis reviens rattacher ces lignes.":
      "Create a profile below first, then come back to assign these rows.",
    "Aucun profil. Ajoute-en un ci-dessous : c'est à eux que se rattachent les lignes.":
      "No profile yet. Add one below: rows are assigned to them.",
    "Glisser pour réordonner": "Drag to reorder",
    "Supprimer le profil": "Delete profile",
    "Ses opérations ne sont pas supprimées : elles retournent dans « Sans profil ».":
      "Its transactions are not deleted: they go back to “No profile”.",
    // ----- L'histogramme d'un projet (extension « Projets ») -----
    "R\u00e9partition par cat\u00e9gorie": "Breakdown by category",
    "Les sorties du projet, r\u00e9parties par cat\u00e9gorie \u2014 virements sortants compris, comme dans le total ci-dessus. Les entr\u00e9es n'y figurent pas : elles se lisent dans le total des entr\u00e9es.":
      "The project's outflows, split by category \u2014 outgoing transfers included, as in the total above. Inflows are not shown: they are read in the inflow total.",
    // ----- La note d'une règle d'import (migration 0050) -----
    "ex. la banque \u00e9crit \u00ab VIR RECU M DUPONT \u00bb pour les remboursements de Paul":
      "e.g. the bank writes \u201cVIR RECU M DUPONT\u201d for Paul's repayments",
    "ex. ce courtier \u00e9crit \u00ab ACHAT COMPTANT \u00bb suivi du nom du titre":
      "e.g. this broker writes \u201cACHAT COMPTANT\u201d followed by the security's name",
    "Note libre : pourquoi cette r\u00e8gle existe, quel relev\u00e9 l'a rendue n\u00e9cessaire, ce qu'il faudra v\u00e9rifier si elle cesse de mordre. Jamais lue par l'application.":
      "Free note: why this rule exists, which statement made it necessary, what to check if it stops matching. Never read by the application.",
    "Note libre : pourquoi cette r\u00e8gle existe, quel relev\u00e9 l'a rendue n\u00e9cessaire. Jamais lue par l'application.":
      "Free note: why this rule exists, which statement made it necessary. Never read by the application.",
    // Infobulle d'une barre de l'histogramme (cf. contenuInfobulleCategorie).
    "Aucune op\u00e9ration sur la p\u00e9riode.": "No transaction over this period.",
    "Sans libell\u00e9": "No label",
    "La cat\u00e9gorie que ta banque a pos\u00e9e elle-m\u00eame sur la ligne.\n\nElle ne devient pas une cat\u00e9gorie de l'app toute seule : tu fais le rapprochement une fois, il est retenu.":
      "The category your bank put on the row itself.\n\nIt does not become an app category on its own: you match it once, and that is remembered.",
    "Le compte concern\u00e9, quand le fichier le nomme.\n\nInutile si le preset est d\u00e9j\u00e0 li\u00e9 \u00e0 un compte : ce lien vaut pour toutes les lignes.":
      "The account concerned, when the file names it.\n\nPointless if the preset is already linked to an account: that link covers every row.",
    "\u00c0 r\u00e9gler seulement si ton relev\u00e9 n'\u00e9crit que des montants positifs et dit \u00e0 part si l'argent entre ou sort.\n\nLes mots-cl\u00e9s reconnus se r\u00e8glent juste en dessous.":
      "Only needed if your statement writes positive amounts only and says separately whether money comes in or goes out.\n\nThe recognised keywords are set just below.",
    "La devise du montant.\n\nSans elle, la ligne part dans la monnaie principale de son compte \u2014 faux d\u00e8s qu'un compte en porte plusieurs.":
      "The currency of the amount.\n\nWithout it, the row goes to its account's main currency \u2014 wrong as soon as an account carries several.",
    "Ce qui PART du compte, avant frais et avant conversion ; \u00ab Montant \u00bb d\u00e9crit alors ce qui ARRIVE.\n\nC'est le couple qu'il faut pour importer un virement entre deux devises : seul ton relev\u00e9 conna\u00eet les deux montants.":
      "What LEAVES the account, before fees and before conversion; \u201cAmount\u201d then describes what ARRIVES.\n\nThis is the pair needed to import a transfer between two currencies: only your statement knows both amounts.",
    "La devise du montant envoy\u00e9.\n\nSans elle, l'app la suppose identique \u00e0 celle du montant re\u00e7u, donc sans change.":
      "The currency of the amount sent.\n\nWithout it, the app assumes it is the same as the amount received, so no exchange took place.",
    "Les frais pr\u00e9lev\u00e9s par la banque.\n\nC'est leur DEVISE qui d\u00e9cide auquel des deux montants ils se rapportent : dans la monnaie envoy\u00e9e ils s'y ajoutent, dans celle re\u00e7ue ils s'en retranchent. Dans une troisi\u00e8me, l'import est refus\u00e9 plut\u00f4t que de fausser un solde.":
      "The fees charged by the bank.\n\nIt is their CURRENCY that decides which of the two amounts they attach to: in the currency sent they add to it, in the one received they are taken from it. In a third one, the import is refused rather than falsifying a balance.",
    "La devise des frais, celle qui dit \u00e0 quel montant ils s'appliquent.\n\nSans elle, l'app les rattache au montant envoy\u00e9 et te le signale \u00e0 chaque import.":
      "The currency of the fees, the one that says which amount they apply to.\n\nWithout it, the app attaches them to the amount sent and tells you so at every import.",
    "Le montant de la ligne, avec son signe : n\u00e9gatif il sort, positif il entre.\n\nSi ton relev\u00e9 s\u00e9pare sorties et entr\u00e9es en deux colonnes, \u00e9teins celle-ci et r\u00e8gle \u00ab Montant au d\u00e9bit \u00bb et \u00ab Montant au cr\u00e9dit \u00bb.":
      "The amount of the row, with its sign: negative it goes out, positive it comes in.\n\nIf your statement splits money out and money in across two columns, turn this one off and set \u201cDebit amount\u201d and \u201cCredit amount\u201d.",
    "Pour les relev\u00e9s qui S\u00c9PARENT sorties et entr\u00e9es en deux colonnes, chaque ligne n'en remplissant qu'une.\n\nLa colonne remplie dit le sens. Un z\u00e9ro vaut une case vide, une ligne qui remplit les deux part en erreur.":
      "For statements that SPLIT money out and money in across two columns, each row filling only one.\n\nThe column filled tells the direction. A zero counts as an empty box, a row filling both goes to error.",
    "L'autre moiti\u00e9 : ce qui ENTRE.\n\nElle va toujours avec \u00ab Montant au d\u00e9bit \u00bb \u2014 allumer ou \u00e9teindre l'une fait la m\u00eame chose \u00e0 l'autre.":
      "The other half: what COMES IN.\n\nIt always goes with \u201cDebit amount\u201d \u2014 turning one on or off does the same to the other.",
    "O\u00f9 en est l'op\u00e9ration chez ta banque.\n\nUne ligne en attente devient une op\u00e9ration pr\u00e9visionnelle, une ligne refus\u00e9e n'est pas import\u00e9e. Les mots-cl\u00e9s se r\u00e8glent plus bas.":
      "Where the transaction stands at your bank.\n\nA pending row becomes a forecast transaction, a declined row is not imported. The keywords are set further down.",
    "Le nombre de titres que tu D\u00c9TIENS au moment de la photographie.\n\nC'est cette quantit\u00e9 qui part en base : l'app ne sait pas comment tu y es arriv\u00e9, seulement ce que tu as.":
      "The number of securities you HOLD at the time of the snapshot.\n\nThat quantity is what goes into the database: the app does not know how you got there, only what you have.",
    "Ce qu'UN titre t'a co\u00fbt\u00e9 en moyenne, frais compris (le PRU).\n\nPar titre, pas le total investi. Si ton relev\u00e9 donne le total, divise-le avant d'importer.":
      "What ONE security cost you on average, fees included.\n\nPer security, not the total invested. If your statement gives the total, divide it before importing.",
    "Ce que la ligne vaut aujourd'hui, tous titres confondus.\n\nElle ne cr\u00e9e aucune d\u00e9tention : elle sert \u00e0 d\u00e9duire le cours du titre (valeur \u00f7 quantit\u00e9), que ce genre d'export ne donne pas.":
      "What the row is worth today, all securities together.\n\nIt creates no holding: it serves to derive the security's price (value \u00f7 quantity), which this kind of export does not give.",
    "Ce que la ligne d\u00e9crit : un achat, une vente, ou un transfert d'esp\u00e8ces.\n\nLes mots-cl\u00e9s se r\u00e8glent juste en dessous. Un libell\u00e9 inconnu met la ligne en erreur plut\u00f4t que d'\u00eatre devin\u00e9.":
      "What the row describes: a purchase, a sale, or a cash transfer.\n\nThe keywords are set just below. An unknown label puts the row in error rather than being guessed.",
    "Le nom du titre tel que ton courtier l'\u00e9crit.\n\nFacultatif si tu lis l'ISIN, mais il faut l'un des deux : sans eux, une ligne d'achat ne dit pas de quelle valeur elle parle.":
      "The name of the security as your broker writes it.\n\nOptional if you read the ISIN, but one of the two is needed: without them, a purchase row does not say which security it is about.",
    "Le code ISIN du titre (FR0000120073, LU1681043599\u2026).\n\nSeul nom qui ne change jamais : c'est par lui qu'un titre est reconnu d'un import \u00e0 l'autre. Facultatif si tu lis le nom de la valeur.":
      "The security's ISIN code (FR0000120073, LU1681043599\u2026).\n\nThe only name that never changes: it is how a security is recognised from one import to the next. Optional if you read the security name.",
    "Ce que l'op\u00e9ration a co\u00fbt\u00e9 ou rapport\u00e9 en esp\u00e8ces.\n\nC'est lui qui fait foi : le prix par titre vaut montant \u00f7 quantit\u00e9, pas le cours annonc\u00e9. Ton solde colle ainsi au relev\u00e9, frais de courtage compris.":
      "What the transaction cost or brought in, in cash.\n\nThis is what counts: the price per security is amount \u00f7 quantity, not the price quoted. Your balance then matches the statement, brokerage fees included.",
    "Le prix par titre annonc\u00e9 par le relev\u00e9.\n\nIl ne d\u00e9cide de rien, il sert de contr\u00f4le : un \u00e9cart de plus de 1 % avec le montant divis\u00e9 par la quantit\u00e9 est signal\u00e9 au-dessus de l'aper\u00e7u, sans bloquer l'import.":
      "The price per security quoted by the statement.\n\nIt decides nothing, it is a check: a gap of more than 1% with the amount divided by the quantity is flagged above the preview, without blocking the import.",
    "L'\u00e9tiquette du titre, si ton fichier la porte : ETF, obligation, action\u2026\n\nFacultative, et sans effet sur un montant. Un libell\u00e9 que tu n'as pas encore cr\u00e9\u00e9 le sera \u00e0 l'import. Un titre que l'app conna\u00eet d\u00e9j\u00e0 garde le type que tu lui as pos\u00e9.":
      "The security's label, if your file carries it: ETF, bond, share\u2026\n\nOptional, and with no effect on any amount. A label you have not created yet will be created on import. A security the app already knows keeps the type you gave it.",
    "Quelle colonne de ton fichier porte quelle information. Date, Nature et Montant sont obligatoires ; le reste est dans \u00ab Configuration avanc\u00e9e \u00bb.":
      "Which column of your file carries which information. Date, Description and Amount are required; the rest is under \u201cAdvanced configuration\u201d.",
    "Comment l'app reconna\u00eet une ligne d\u00e9j\u00e0 import\u00e9e. Soit toutes les colonnes moins celles qui bougent d'un export \u00e0 l'autre (solde courant, r\u00e9f\u00e9rence), soit les seules qui identifient une ligne \u2014 souvent date + libell\u00e9 + montant.":
      "How the app recognises a row it has already imported. Either every column minus those that shift between exports (running balance, reference), or only those that identify a row \u2014 usually date + label + amount.",
    "Un preset par courtier : colonnes \u00e0 lire et vocabulaire de ses relev\u00e9s. Ceux des relev\u00e9s bancaires vivent \u00e0 part, sur la page Import.":
      "One preset per broker: which columns to read and the vocabulary of its statements. Bank statement presets live apart, on the Import page.",
    "Un relev\u00e9 de courtier ne dit jamais quel compte il d\u00e9crit. Le lier ici \u00e9vite de le choisir \u00e0 chaque import ; laisse vide si plusieurs comptes ont le m\u00eame format.":
      "A broker statement never says which account it describes. Linking it here saves picking it at every import; leave empty if several accounts share the same format.",
    "Comment l'app reconna\u00eet une ligne d\u00e9j\u00e0 import\u00e9e sous ce preset. Soit toutes les colonnes moins celles qui bougent d'un export \u00e0 l'autre (num\u00e9ro d'ordre, solde courant), soit les seules qui identifient une ligne \u2014 souvent date + valeur + montant + quantit\u00e9.":
      "How the app recognises a row already imported under this preset. Either every column minus those that shift between exports (order number, running balance), or only those that identify a row \u2014 usually date + holding + amount + quantity.",
    "L'app ne conna\u00eet pas encore ces valeurs et les cr\u00e9era \u00e0 l'import. Si l'une existe d\u00e9j\u00e0 chez toi sous un autre nom, choisis-la \u00e0 la main sur sa ligne.":
      "The app does not know these holdings yet and will create them on import. If one already exists under another name, pick it by hand on its row.",
    "Une \u00e9tiquette pos\u00e9e sur le titre que la ligne d\u00e9signe \u2014 ETF, obligation, action. Uniquement \u00e0 la cr\u00e9ation d'un titre : un titre d\u00e9j\u00e0 typ\u00e9 garde le sien. Purement descriptif.":
      "A label put on the holding the row names \u2014 ETF, bond, share. Only when a holding is created: one already typed keeps its own. Purely descriptive.",
    "La part de ton portefeuille en ETF, en obligations, en actions \u2014 \u00e0 la valeur d'aujourd'hui, tous comptes confondus. Survole une part pour voir les titres qui la composent.":
      "How much of your portfolio sits in ETFs, bonds, shares \u2014 at today's value, across every account. Hover a slice to see the holdings it is made of.",
    "Ce que vaut une monnaie dans une autre. Sert uniquement \u00e0 la case \u00ab tout convertir \u00bb du dashboard, et ne modifie aucun montant enregistr\u00e9. Un seul sens par couple suffit, l'inverse se calcule.":
      "What one currency is worth in another. Used only by the dashboard's \u201cconvert everything\u201d box, and changes no recorded amount. One direction per pair is enough, the reverse is computed.",
    "Tes propres \u00e9tiquettes \u2014 ETF, action en direct, obligation, SCPI \u2014 pour regrouper les titres. Purement descriptif : aucun solde ni aucune valorisation n'en d\u00e9pend.":
      "Your own labels \u2014 ETF, direct share, bond, property fund \u2014 to group holdings. Purely descriptive: no balance and no valuation depends on them.",
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
    "Tout": "All time",
    "Toutes les périodes, sans borne de date": "Every period, with no date bounds",
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
    // Un virement dont une seule jambe est à l'écran : deux causes, deux gestes.
    "Cette \u00e9criture n'a pas de seconde jambe (virement import\u00e9 sans compte en face) : supprime-la et recr\u00e9e le virement avec ses deux comptes.":
      "This entry has no second leg (transfer imported without a facing account): delete it and create the transfer again with both accounts.",
    "La seconde \u00e9criture de ce virement n'est pas dans la liste affich\u00e9e : vide les filtres pour la modifier.":
      "The second entry of this transfer is not in the list shown: clear the filters to edit it.",
    "ET": "AND",
    "OU": "OR",
    "ou": "or",
    // Ce qui relie les mots-clés d'une seule condition (cf. extensions/regles).
    "et": "and",

    // ---------- Extension « Import de placements » ----------
    "Import de placements": "Investment import",
    "Importer des op\u00e9rations": "Import transactions",
    "\u2190 Retour aux placements": "\u2190 Back to investments",
    "Lit une liste d'opérations exportée depuis un compte de placements : achats, ventes et transferts d'espèces. Rien n'entre en base avant que tu ne valides l'aperçu.":
      "Reads a list of transactions exported from an investment account: purchases, sales and cash transfers. Nothing is saved until you validate the preview.",
    "Aucun compte de placements financiers. Crée-en un depuis la page Comptes en choisissant le type \"Placements financiers\", puis reviens ici.":
      "No investment account. Create one from the Accounts page by choosing the \"Investments\" type, then come back here.",
    "Format du fichier": "File format",
    "Un preset par courtier : il retient quelles colonnes lire, comment comparer les doublons et le vocabulaire de la colonne « Type d'opération ». Les presets de relevés bancaires vivent sur la page Import et ne se mélangent jamais avec ceux-ci.":
      "One preset per broker: it remembers which columns to read, how to compare duplicates and the wording of the “Transaction type” column. Bank statement presets live on the Import page and never mix with these.",
    "Compte de placements de ce preset": "Investment account for this preset",
    "Un relevé de courtier ne nomme nulle part le compte qu'il décrit : il EST ce compte. Lier le preset une fois évite de le choisir à chaque import. Laisse vide si tu importes plusieurs comptes avec le même format — le compte se choisira alors fichier par fichier.":
      "A broker statement never names the account it describes: it IS that account. Linking the preset once saves choosing it at every import. Leave empty if you import several accounts with the same format — the account will then be chosen file by file.",
    "— aucun (choisir à chaque fichier) —": "— none (choose for each file) —",
    "Quelle colonne du fichier porte quoi. Les numéros sont ceux d'Excel : la première colonne est la n°1. L'œil barré ne lit pas la colonne.":
      "Which column of the file carries what. Numbers are Excel's: the first column is n°1. A crossed-out eye means the column is not read.",
    "Mots-clés de la colonne « Type d'opération »": "Keywords for the “Transaction type” column",
    "Ce que TON courtier écrit pour dire achat, vente, ou mouvement d'espèces. Sépare les mots-clés par des virgules. La casse, les accents et les espaces sont ignorés : « Transfert interne », « TRANSFERT INTERNE » et « transfertinterne » sont le même mot-clé. Une liste laissée vide retombe sur les mots par défaut, indépendamment des deux autres. Un libellé qui ne figure dans aucune des trois listes met la ligne en erreur plutôt que d'être deviné : confondre un achat et une vente inverserait une position entière.":
      "What YOUR broker writes for a purchase, a sale, or a cash movement. Separate keywords with commas. Case, accents and spaces are ignored: “Internal transfer”, “INTERNAL TRANSFER” and “internaltransfer” are the same keyword. A list left empty falls back on the default words, independently of the other two. A label that appears in none of the three lists puts the row in error rather than being guessed: mistaking a purchase for a sale would reverse a whole position.",
    "Achat, Souscription, Buy": "Purchase, Subscription, Buy",
    "Vente, Cession, Rachat": "Sale, Disposal, Redemption",
    "Transfert interne (espèces)": "Internal transfer (cash)",
    "Versement, Retrait, Virement": "Deposit, Withdrawal, Transfer",
    "Une ligne importée est comparée aux lignes déjà importées SOUS CE PRESET pour détecter les doublons. Deux façons de dire la même chose : pars de toutes les colonnes et retire celles qui bougent d'un export à l'autre (numéro d'ordre, solde courant), ou ne désigne que celles qui identifient une ligne (souvent date + valeur + montant + quantité). Les transferts d'espèces, eux, sont EN PLUS rapprochés des virements déjà en base, d'où qu'ils viennent — c'est un mécanisme à part, qui ne dépend pas de ce réglage.":
      "An imported row is compared with rows already imported UNDER THIS PRESET to detect duplicates. Two ways of saying the same thing: start from every column and remove those that change from one export to the next (order number, running balance), or name only those that identify a row (often date + security + amount + quantity). Cash transfers are ALSO matched against transfers already recorded, wherever they came from — that is a separate mechanism, independent of this setting.",
    "Compte de placements pour ce fichier": "Investment account for this file",
    "Titres qui seront créés": "Securities that will be created",
    "Ces valeurs ne sont pas encore connues de l'application : l'import les créera, avec leur nom et leur code ISIN, cotées dans la monnaie principale du compte. Si l'une d'elles existe déjà sous un autre nom, choisis le titre à la main sur la ligne concernée (bouton Modifier) plutôt que de laisser créer un doublon.":
      "These securities are not known to the application yet: the import will create them, with their name and ISIN code, quoted in the account's main currency. If one of them already exists under another name, pick the security by hand on the row concerned (Edit button) rather than letting a duplicate be created.",
    "Transferts déjà connus": "Transfers already known",
    "Achats —": "Purchases —",
    "Ventes —": "Sales —",
    "Transferts internes —": "Internal transfers —",
    "Lignes en erreur —": "Rows in error —",
    "Valeur": "Security",
    "ISIN": "ISIN",
    "Le relevé ne décrit qu'un côté du mouvement : indique le compte en face. Le sens (émetteur ou récepteur) est déduit du signe du montant.":
      "The statement describes only one side of the movement: name the account facing it. The direction (sender or receiver) is deduced from the sign of the amount.",
    "Ces lignes ne seront pas importées telles quelles. Corrige-les avec \"Modifier\", ou supprime-les de l'aperçu — le reste du fichier s'importe normalement.":
      "These rows will not be imported as they stand. Fix them with \"Edit\", or remove them from the preview — the rest of the file imports normally.",

    // Libellés construits en JavaScript (import-placements.js).
    "Date de l'opération": "Transaction date",
    "Type d'opération": "Transaction type",
    "Nom de la valeur": "Security name",
    "Code ISIN": "ISIN code",
    "Montant de l'opération": "Transaction amount",
    "Cours": "Price",
    "Achat": "Purchase",
    "Vente": "Sale",
    "Transfert interne": "Internal transfer",
    "Ce que la ligne décrit : un achat, une vente, ou un transfert d'espèces vers ou depuis un autre compte.\n\nLes mots-clés reconnus se règlent juste en dessous. Un libellé inconnu met la ligne en erreur plutôt que d'être deviné.":
      "What the row describes: a purchase, a sale, or a cash transfer to or from another account.\n\nThe recognised keywords are set just below. An unknown label puts the row in error rather than being guessed.",
    "Le nom du titre tel que ton courtier l'écrit.\n\nFacultatif si tu lis le code ISIN, mais l'un des deux est indispensable : sans eux, une ligne d'achat ne dit pas de quelle valeur elle parle.":
      "The security name as your broker writes it.\n\nOptional if you read the ISIN code, but one of the two is essential: without them, a purchase row does not say which security it is about.",
    "Le code ISIN du titre (FR0000120073, LU1681043599…).\n\nC'est la seule dénomination qui ne change jamais : c'est par lui qu'un titre est reconnu d'un import à l'autre, même si son nom a changé. Facultatif si tu lis le nom de la valeur.":
      "The security's ISIN code (FR0000120073, LU1681043599…).\n\nIt is the only name that never changes: it is how a security is recognised from one import to the next, even if its name has changed. Optional if you read the security name.",
    "Ce que l'opération a coûté ou rapporté en espèces.\n\nC'est LUI qui fait foi : le prix unitaire importé vaut montant ÷ quantité, jamais le cours annoncé. Le solde du compte colle ainsi au relevé, et les frais de courtage entrent dans le prix de revient.":
      "What the transaction cost or returned in cash.\n\nIT is what counts: the imported unit price is amount ÷ quantity, never the quoted price. The account balance thus matches the statement, and brokerage fees enter the cost basis.",
    "Le nombre de titres achetés ou vendus.\n\nSans objet sur une ligne de transfert d'espèces, qui peut la laisser vide.":
      "The number of securities bought or sold.\n\nIrrelevant on a cash transfer row, which may leave it empty.",
    "Le prix unitaire annoncé par le relevé. La seule colonne entièrement facultative.\n\nElle ne décide de rien : elle sert de contrôle. Un écart de plus de 1 % avec le montant divisé par la quantité est signalé au-dessus de l'aperçu, sans jamais bloquer l'import.":
      "The unit price stated by the statement. The only entirely optional column.\n\nIt decides nothing: it serves as a check. A gap of more than 1% with the amount divided by the quantity is reported above the preview, without ever blocking the import.",
    "Garde le nom de la valeur ou le code ISIN : sans l'un des deux, aucune ligne ne peut dire de quel titre elle parle.":
      "Keep the security name or the ISIN code: without one of the two, no row can say which security it is about.",
    "Aucun preset. Crée-en un pour commencer.": "No preset. Create one to get started.",
    "Aucune colonne choisie : ajoute-en au moins une, sinon plus rien ne distingue deux lignes.":
      "No column chosen: add at least one, otherwise nothing tells two rows apart.",
    "Aucune colonne exclue : toutes les colonnes du fichier sont comparées.":
      "No column excluded: every column of the file is compared.",
    "colonne(s) lue(s)": "column(s) read",
    "La plupart des lignes sont illisibles : le délimiteur ou le séparateur décimal ne convient probablement pas à ce fichier.":
      "Most rows are unreadable: the delimiter or the decimal separator probably does not suit this file.",
    "ligne(s) au total — fais défiler le tableau pour les voir toutes.":
      "row(s) in total — scroll the table to see them all.",
    "Une ligne identique a déjà été importée sous ce preset.":
      "An identical row has already been imported under this preset.",
    "doublon": "duplicate",
    "nouveau": "new",
    "à renseigner": "to be filled in",
    "cours du fichier": "price from the file",
    "compte en face": "account facing it",
    "jour(s) d'écart": "day(s) apart",
    "Compte en face (transfert)": "Account facing it (transfer)",
    "— d'après le fichier —": "— from the file —",
    "— aucun —": "— none —",
    "Appliquer": "Apply",
    "Supprime ou décoche les lignes sélectionnées pour pouvoir confirmer.":
      "Delete or uncheck the selected rows before you can confirm.",
    "opération(s) créée(s)": "transaction(s) created",
    "titre(s) créé(s)": "security(ies) created",
    "doublon(s) signalé(s)": "duplicate(s) flagged",
    "ligne(s) non importée(s) :": "row(s) not imported:",
    "Aucun import sous ce preset.": "No import under this preset.",
    "(sans nom)": "(unnamed)",
    "opération(s)": "transaction(s)",
    "ignorée(s)": "skipped",
    "doublon(s)": "duplicate(s)",
    "Annuler cet import": "Undo this import",
    "import antérieur au suivi des opérations": "import predating transaction tracking",
    "Annuler cet import supprimera les opérations qu'il a créées, y compris celles modifiées depuis. Continuer ?":
      "Undoing this import will delete the transactions it created, including those modified since. Continue?",
    "opération(s) supprimée(s)": "transaction(s) deleted",
    "Nom du nouveau preset (le nom de ton courtier, par exemple)":
      "Name of the new preset (your broker's name, for instance)",
    "Preset créé": "Preset created",
    "Nouveau nom": "New name",
    "Supprimer ce preset effacera aussi son historique d'imports et ses lignes de comparaison. Les opérations déjà importées, elles, restent. Continuer ?":
      "Deleting this preset will also erase its import history and its comparison rows. The transactions already imported do remain. Continue?",
    "Les doublons détectés sont pré-sélectionnés. Tant qu'il reste des lignes sélectionnées, l'import est bloqué : supprime-les, ou décoche-les pour les importer quand même.":
      "Detected duplicates are pre-selected. As long as rows remain selected, the import is blocked: delete them, or uncheck them to import them anyway.",
    "Problème": "Problem",
    "Imports précédents": "Previous imports",

    // ---------- Galerie des correspondances : ordre des colonnes ----------
    "Fais glisser cet en-t\u00eate pour d\u00e9placer la colonne":
      "Drag this header to move the column",
    "Ordre des colonnes enregistr\u00e9": "Column order saved",

    // ---------- Import de placements : mots-cl\u00e9s ----------
    "Les mots que ton courtier emploie pour dire achat, vente ou mouvement d'esp\u00e8ces. Ajoute-les un par un avec \u00ab + \u00bb ou Entr\u00e9e ; majuscules, accents et espaces sont ignor\u00e9s. Une liste vide retombe sur les mots par d\u00e9faut, un libell\u00e9 inconnu met la ligne en erreur.":
      "The words your broker uses for purchase, sale or cash movement. Add them one at a time with \u201c+\u201d or Enter; case, accents and spaces are ignored. An empty list falls back on the default words, an unknown label puts the row in error.",
    "Ajouter ce mot-cl\u00e9": "Add this keyword",
    // ----- Les frais d'une opération, décomposés dans le formulaire -----
    "Frais": "Fees",
    "Monnaie des frais": "Fee currency",
    " (hors frais)": " (before fees)",
    "Montant re\u00e7u": "Amount received",
    "Les frais que la banque a pr\u00e9lev\u00e9s, d\u00e9j\u00e0 compris dans le montant : ajout\u00e9s \u00e0 ce qui sort, retranch\u00e9s de ce qui entre. Le montant au-dessus est donc affich\u00e9 hors frais, et les deux se recomposent \u00e0 l'enregistrement.":
      "The fees the bank charged, already included in the amount: added to what goes out, taken from what comes in. The amount above is therefore shown before fees, and the two are recombined on save.",
    "La devise des frais dit \u00e0 quel montant ils s'appliquent : sur un virement entre deux monnaies, des frais dans la monnaie envoy\u00e9e gr\u00e8vent ce qui part, dans la monnaie re\u00e7ue ce qui arrive.":
      "The fee currency says which amount they apply to: on a transfer between two currencies, fees in the sent currency weigh on what leaves, in the received currency on what arrives.",
    // ----- Réorganiser les colonnes en glissant les en-têtes de l'aperçu -----
    "Cette colonne n'existe pas dans le fichier : d\u00e9place son en-t\u00eate sur une colonne r\u00e9elle.":
      "This column does not exist in the file: drag its header onto a real column.",
    "Les colonnes color\u00e9es sont celles que l'app va lire, les grises sont ignor\u00e9es. Deux fa\u00e7ons de corriger un d\u00e9calage : glisser un en-t\u00eate sur un autre pour \u00e9changer les deux colonnes, ou saisir les num\u00e9ros dans \u00ab Configuration du fichier \u00bb au-dessus.":
      "Coloured columns are the ones the app will read, grey ones are ignored. Two ways to fix a mismatch: drag one header onto another to swap the two columns, or type the numbers in \u201cFile configuration\u201d above.",
    "Les colonnes ont chang\u00e9 depuis la derni\u00e8re lecture. Relire le fichier pour voir ce que l'import donnera, puis \u00ab Enregistrer la configuration \u00bb pour garder cet ordre dans le preset.":
      "The columns have changed since the last read. Read the file again to see what the import will give, then use \u201cSave configuration\u201d to keep this order in the preset.",
    "Glisse cet en-t\u00eate sur un autre pour \u00e9changer les deux colonnes":
      "Drag this header onto another one to swap the two columns",
    "Relire le fichier avec la configuration actuelle":
      "Read the file again with the current configuration",
    "Les colonnes ont chang\u00e9 : relire le fichier pour voir ce que l'import donnera.":
      "The columns have changed: read the file again to see what the import will give.",
    "Aucun fichier charg\u00e9 \u00e0 relire.": "No file loaded to read again.",
    "Fichier relu. \u00ab Enregistrer la configuration \u00bb pour garder cet ordre de colonnes dans le preset.":
      "File read again. Use \u201cSave configuration\u201d to keep this column order in the preset.",
    // Les mots-clés d'une condition de règle : le même éditeur, dans une rangée
    // où le mot « Actualisation » de l'import n'aurait rien dit.
    "Retirer": "Remove",
    "Mots-cl\u00e9s": "Keywords",
    "Aucun mot-cl\u00e9 : la condition ne compare rien.":
      "No keyword: the condition compares nothing.",
    "ex. PRET": "e.g. LOAN",
    Actualisation: "Refresh",
    Versement: "Deposit",
    "Aucun mot-cl\u00e9 \u2014 les mots par d\u00e9faut s'appliquent.":
      "No keyword \u2014 the default words apply.",
    "Rien \u00e0 supprimer.": "Nothing to remove.",
    "Ce mot-cl\u00e9 est d\u00e9j\u00e0 dans la liste.": "That keyword is already in the list.",
    "\u00ab {mot} \u00bb est d\u00e9j\u00e0 un mot-cl\u00e9 de \u00ab {type} \u00bb.":
      "\u201c{mot}\u201d is already a keyword of \u201c{type}\u201d.",

    // ---------- Import de placements : onglet R\u00e8gles ----------
    "R\u00e8gles de type d'op\u00e9ration": "Transaction type rules",
    "Une r\u00e8gle reconna\u00eet une ligne \u00e0 son libell\u00e9 et dit ce qu'elle est : achat, vente, transfert d'esp\u00e8ces. Elle vaut pour tous tes courtiers et passe avant les mots-cl\u00e9s du preset.":
      "A rule recognises a row by its label and says what it is: purchase, sale, cash transfer. It applies to all your brokers and comes before the preset's keywords.",
    "Les mots-cl\u00e9s de la \u00ab Configuration du fichier \u00bb comparent un libell\u00e9":
      "The keywords under \u201cFile configuration\u201d compare a",
    entier: "whole label",
    ": \u00ab Achat \u00bb est un achat, et rien d'autre ne l'est. Quand le courtier \u00e9crit une phrase \u2014 \u00ab ACHAT COMPTANT ETF MSCI WORLD \u00bb, avec le nom du titre dedans \u2014 aucune liste de mots-cl\u00e9s ne peut la reconna\u00eetre, parce qu'il n'y a pas deux fois le m\u00eame libell\u00e9 dans le fichier. Une r\u00e8gle, elle, sait dire \u00ab":
      ": \u201cBuy\u201d is a buy, and nothing else is. When the broker writes a sentence \u2014 \u201cCASH BUY ETF MSCI WORLD\u201d, with the security's name inside \u2014 no keyword list can recognise it, because no two rows of the file carry the same label. A rule, however, can say \u201c",
    "ACHAT \u00bb.": "contains BUY\u201d.",
    "et s'arr\u00eatent \u00e0 la premi\u00e8re qui correspond : contrairement aux r\u00e8gles bancaires, une r\u00e8gle de placement ne d\u00e9cide que d'une chose, il n'y a donc rien \u00e0 compl\u00e9ter en dessous. Place les cas particuliers au-dessus des cas g\u00e9n\u00e9raux.":
      "and stop at the first one that matches: unlike bank rules, an investment rule decides one thing only, so there is nothing left for the ones below to fill in. Put the special cases above the general ones.",
    "Une ligne qu'aucune r\u00e8gle ne reconna\u00eet retombe sur les":
      "A row no rule recognises falls back on the",
    "mots-cl\u00e9s du preset": "preset's keywords",
    ". Sans aucune r\u00e8gle, l'import se comporte donc exactement comme avant.":
      ". With no rule at all, the import therefore behaves exactly as before.",
    "ex. Achats au comptant": "e.g. Cash buys",
    "Une ligne de compte-titres n'a que son type \u00e0 d\u00e9cider : ni cat\u00e9gorie (un mouvement de titres n'en porte pas), ni compte en face (le transfert le d\u00e9duit du signe du montant).":
      "A securities-account row has only its type to decide: no category (a securities movement carries none), and no facing account (a transfer infers it from the sign of the amount).",
    "La ligne d\u00e9crit": "The row describes",
    "Un achat de titres": "A securities purchase",
    "Une vente de titres": "A securities sale",
    "Un transfert interne (esp\u00e8ces)": "An internal transfer (cash)",
    "Aucune r\u00e8gle : le type de chaque ligne est reconnu par les mots-cl\u00e9s du preset.":
      "No rule: each row's type is recognised by the preset's keywords.",
    "Glisse pour changer l'ordre": "Drag to reorder",
    Groupe: "Group",
    "Combiner avec": "Combine with",
    "Supprimer le groupe": "Delete the group",
    "Ajouter une condition": "Add a condition",
    "Modifier la r\u00e8gle": "Edit the rule",

    // ---------- Projets ----------
    Projets: "Projects",
    "Rassemble des op\u00e9rations d\u00e9j\u00e0 saisies, quelles que soient leur cat\u00e9gorie et leur compte, pour lire ce qu'un voyage ou un d\u00e9m\u00e9nagement t'a co\u00fbt\u00e9. Une op\u00e9ration peut appartenir \u00e0 plusieurs projets, et rien d'autre dans l'app n'en tient compte.":
      "Gathers transactions you have already entered, whatever their category and account, to read what a trip or a move cost you. A transaction can belong to several projects, and nothing else in the app takes them into account.",
    "Un projet ne se saisit pas depuis une op\u00e9ration : on le cr\u00e9e ici, puis on y verse les op\u00e9rations concern\u00e9es. C'est un":
      "A project is not entered from a transaction: you create it here, then pour the relevant transactions into it. It is a",
    "regroupement de lecture": "reading grouping",
    "\u2014 retirer une op\u00e9ration d'un projet ne la supprime pas, et supprimer un projet ne supprime aucune d\u00e9pense.":
      "\u2014 removing a transaction from a project does not delete it, and deleting a project deletes no spending.",
    "+ Nouveau projet": "+ New project",
    "Nouveau projet": "New project",
    "Modifier le projet": "Edit the project",
    "ex. Vacances Italie": "e.g. Italy holiday",
    "ex. du 3 au 17 ao\u00fbt, Rome et Naples": "e.g. 3\u201317 August, Rome and Naples",
    "\u2190 Retour aux projets": "\u2190 Back to projects",
    "+ Ajouter des op\u00e9rations": "+ Add transactions",
    "Ajouter des op\u00e9rations": "Add transactions",
    "Ajouter une op\u00e9ration ici ne la retire d'aucun autre projet, et ne change ni sa cat\u00e9gorie ni son compte.":
      "Adding a transaction here removes it from no other project, and changes neither its category nor its account.",
    "Montant min": "Min amount",
    "Montant max": "Max amount",
    "ex. 50": "e.g. 50",
    "ex. 500": "e.g. 500",
    "La valeur du montant sans son signe : \u00ab au moins 50 \u00bb attrape aussi bien une d\u00e9pense de 80 \u20ac qu'une entr\u00e9e de 80 \u20ac. Laisse une case vide pour ne pas borner de ce c\u00f4t\u00e9.":
      "The amount without its sign: \u201cat least 50\u201d catches an 80 \u20ac expense as well as 80 \u20ac coming in. Leave a box empty not to bound that side.",
    "Sur une d\u00e9pense remboursable, ce qu'on te rendra : au plus ce que tu as avanc\u00e9. Sur un pr\u00eat re\u00e7u, ce que tu rendras : au moins ce qu'on t'a remis \u2014 l'\u00e9cart est l'int\u00e9r\u00eat du pr\u00eat.":
      "On a reimbursable expense, what you will be paid back: at most what you advanced. On a loan received, what you will pay back: at least what you were given \u2014 the gap is the loan's interest.",
    "Nature contient": "Description contains",
    "\u2014 tous \u2014": "\u2014 all \u2014",
    // Le champ libre d'un projet. Le noyau, lui, traduit \u00ab Nature \u00bb par
    // "Description" (la colonne des op\u00e9rations) : deux mots fran\u00e7ais
    // diff\u00e9rents qui tombent sur le m\u00eame mot anglais, ce qui est sans
    // cons\u00e9quence \u2014 ils ne se croisent jamais dans un m\u00eame \u00e9cran.
    Description: "Description",
    "ex. h\u00f4tel": "e.g. hotel",
    Chercher: "Search",
    "Ajouter au projet (": "Add to project (",
    "Op\u00e9rations du projet \u2014": "Transactions in this project \u2014",
    "Aucun projet. Cr\u00e9e-en un, puis verses-y les op\u00e9rations d'un m\u00eame voyage ou d'un m\u00eame \u00e9v\u00e9nement.":
      "No project yet. Create one, then pour into it the transactions of a single trip or event.",
    Ouvrir: "Open",
    "Aucune op\u00e9ration.": "No transaction.",
    "Aucune op\u00e9ration dans ce projet.": "No transaction in this project.",
    Retirer: "Remove",
    "Projet cr\u00e9\u00e9": "Project created",
    "Projet modifi\u00e9": "Project updated",
    "Projet supprim\u00e9. Aucune op\u00e9ration n'a \u00e9t\u00e9 supprim\u00e9e.":
      "Project deleted. No transaction was deleted.",
    "Op\u00e9ration retir\u00e9e du projet (elle reste en base).":
      "Transaction removed from the project (it stays in the database).",
    "Donne un nom au projet.": "Give the project a name.",
    "{n} op\u00e9ration(s) propos\u00e9e(s). Celles d\u00e9j\u00e0 dans ce projet ne sont pas list\u00e9es.":
      "{n} transaction(s) offered. Those already in this project are not listed.",
    "{n} op\u00e9ration(s) ajout\u00e9e(s) au projet.": "{n} transaction(s) added to the project.",

    // ---------- Taux d'\u00e9pargne ----------
    "\u00c9pargne": "Savings",
    "Comptes d'\u00e9pargne": "Savings accounts",
    "Le taux est annuel, comme ta banque l'annonce. La fr\u00e9quence ne le change pas : elle dit \u00e0 quelles dates il s'applique, donc sur quel solde. Seuls les comptes d'\u00e9pargne sont ici.":
      "The rate is annual, as your bank quotes it. The frequency does not change it: it says on which dates it applies, and therefore on which balance. Only savings accounts are here.",
    "Ce que ces taux produisent est un": "What these rates produce is a",
    "calcul d'affichage": "display-only calculation",
    ": aucun int\u00e9r\u00eat n'est \u00e9crit en op\u00e9ration, aucun solde et aucun chiffre du dashboard n'en d\u00e9pend. C'est voulu \u2014 les int\u00e9r\u00eats changent \u00e0 chaque virement sur le compte et \u00e0 chaque jour qui passe, les inscrire en base ferait diverger l'application du relev\u00e9 de la banque.":
      ": no interest is written as a transaction, and no balance or dashboard figure depends on it. That is deliberate \u2014 interest changes with every transfer into the account and with every passing day, and writing it to the database would drift the app away from the bank statement.",
    "Aucun compte d'\u00e9pargne. Cr\u00e9e-en un depuis Param\u00e8tres \u2192 Comptes en choisissant le type \u00ab \u00e9pargne \u00bb, puis reviens ici.":
      "No savings account. Create one from Settings \u2192 Accounts by choosing the \u201csavings\u201d type, then come back here.",
    "Calculer jusqu'au": "Calculate up to",
    "Aujourd'hui par d\u00e9faut : \u00ab o\u00f9 j'en suis \u00bb. Une date future montre ce que \u00e7a rapportera si rien ne bouge d'ici l\u00e0.":
      "Today by default: \u201cwhere I stand\u201d. A future date shows what it will earn if nothing moves before then.",
    Recalculer: "Recalculate",
    "Taux annuel": "Annual rate",
    "Fr\u00e9quence de versement": "Payment frequency",
    "Rapporte depuis": "Earns since",
    "La date d'ouverture du compte, ou celle \u00e0 partir de laquelle il rapporte. Elle fixe aussi le calendrier des versements : un compte qui d\u00e9marre un 17 est r\u00e9mun\u00e9r\u00e9 le 17 de chaque mois. Laiss\u00e9e vide, le calcul part de la premi\u00e8re op\u00e9ration du compte \u2014 ce qui fausse un compte ouvert bien avant sa premi\u00e8re ligne import\u00e9e.":
      "The account's opening date, or the date from which it earns. It also sets the payment calendar: an account starting on the 17th is paid on the 17th of each month. Left empty, the calculation starts from the account's first transaction \u2014 which skews an account opened well before its first imported row.",
    "Journali\u00e8re": "Daily",
    "Retirer le taux": "Remove the rate",
    "Pas de taux : rien \u00e0 calculer.": "No rate: nothing to calculate.",
    "Aucun point de d\u00e9part : renseigne \u00ab Rapporte depuis \u00bb, ou attends la premi\u00e8re op\u00e9ration du compte.":
      "No starting point: fill in \u201cEarns since\u201d, or wait for the account's first transaction.",
    "Un taux et une fr\u00e9quence vont ensemble : renseigne les deux, ou aucun.":
      "A rate and a frequency go together: fill in both, or neither.",
    "Taux enregistr\u00e9": "Rate saved",
    "Taux retir\u00e9. Aucune op\u00e9ration n'a \u00e9t\u00e9 touch\u00e9e.":
      "Rate removed. No transaction was touched.",
    "P\u00e9riode": "Period",
    "Solde au d\u00e9part": "Balance at the start",
    "Versements": "Payments",
    Coefficient: "Coefficient",
    "Int\u00e9r\u00eats": "Interest",
    "Solde \u00e0 la fin": "Balance at the end",
    "Solde au": "Balance on",
    Mouvement: "Movement",
    "Afficher le d\u00e9tail du calcul": "Show the calculation in detail",
    "Les int\u00e9r\u00eats d'une p\u00e9riode sont vers\u00e9s avant les op\u00e9rations de son dernier jour : l'argent qui arrive un jour donn\u00e9 commence \u00e0 rapporter le lendemain.":
      "A period's interest is paid before that period's last-day transactions: money arriving on a given day starts earning the next day.",

    // ---------- Import de placements : doublons et ressemblances ----------
    "Chaque ligne jug\u00e9e identique (hors colonnes exclues, cf. Configuration du fichier) \u00e0 une ligne d\u00e9j\u00e0 import\u00e9e sous ce preset est affich\u00e9e ici, suivie en lecture seule de celle qu'elle double. Elles sont pr\u00e9-s\u00e9lectionn\u00e9es pour \u00eatre supprim\u00e9es d'un clic \u2014 d\u00e9coche-en une pour l'importer quand m\u00eame (deux achats identiques le m\u00eame jour sont un doublon d\u00e9tect\u00e9 l\u00e9gitime).":
      "Every row judged identical (excluded columns aside, see File configuration) to a row already imported under this preset appears here, followed read-only by the one it duplicates. They are pre-selected to be removed in one click \u2014 untick one to import it anyway (two identical purchases on the same day are a legitimate detected duplicate).",
    "Transferts d\u00e9j\u00e0 connus \u2014": "Transfers already known \u2014",
    "Ces transferts ressemblent \u00e0 un virement d\u00e9j\u00e0 enregistr\u00e9 : m\u00eame montant, m\u00eames comptes, \u00e0 quelques jours pr\u00e8s. C'est normal \u2014 le m\u00eame mouvement figure sur le relev\u00e9 du courtier":
      "These transfers look like a transfer already recorded: same amount, same accounts, within a few days. That is normal \u2014 the same movement appears on the broker's statement",
    "sur celui du compte courant. Seuls les virements qui touchent le compte de ce preset sont compar\u00e9s. Rien n'est bloqu\u00e9 ni pr\u00e9-s\u00e9lectionn\u00e9 : toi seul sais si tu as vraiment fait deux fois le mouvement. Chaque ligne est suivie de ce \u00e0 quoi elle ressemble.":
      "on the current account's. Only transfers touching this preset's account are compared. Nothing is blocked or pre-selected: only you know whether you really made the movement twice. Each row is followed by what it looks like.",
    "Ressemble \u00e0 :": "Looks like:",
    "d\u00e9j\u00e0 en base": "already in the database",
    "virement d\u00e9j\u00e0 enregistr\u00e9": "transfer already recorded",
    "du m\u00eame fichier": "of the same file",
    "le m\u00eame jour": "on the same day",

    // ---------- Import de placements : le compte en face d'une r\u00e8gle ----------
    "Une ligne de compte-titres n'a pas de cat\u00e9gorie : un mouvement de titres n'en porte pas. Un transfert, lui, touche deux comptes et le relev\u00e9 n'en nomme qu'un \u2014 la r\u00e8gle peut donc d\u00e9signer le second.":
      "A securities-account row has no category: a securities movement carries none. A transfer, however, touches two accounts and the statement names only one \u2014 so the rule can designate the second.",
    "L'autre compte : celui d'o\u00f9 vient l'argent vers\u00e9, ou celui o\u00f9 va l'argent retir\u00e9. Le sens se d\u00e9duit du signe du montant. Sans lui, la ligne est \u00e0 compl\u00e9ter \u00e0 la main dans l'aper\u00e7u.":
      "The other account: where the money paid in comes from, or where the money taken out goes. The direction follows the sign of the amount. Without it, the row must be completed by hand in the preview.",
    avec: "with",
    et: "and",
    "en face": "facing",

    // ---------- Titres suivis ----------
    "Nom du courtier :": "Broker's name:",
    "renomm\u00e9": "renamed",
    "Changer le nom affich\u00e9 (le nom du courtier ne bouge pas)":
      "Change the displayed name (the broker's name does not move)",
    "Nom \u00e0 afficher pour \u00ab {nom} \u00bb (laisse vide pour revenir au nom du courtier)":
      "Name to display for \u201c{nom}\u201d (leave empty to go back to the broker's name)",
    "Titre renomm\u00e9": "Security renamed",
    "Nom du courtier r\u00e9tabli": "Broker's name restored",
    "Afficher le lien de cotation": "Show the quotation link",
    "Cours relu en ligne": "Price read online",

    // ---------- Taux d'\u00e9pargne : la fen\u00eatre ----------
    "G\u00e9rer les taux d'int\u00e9r\u00eat": "Manage interest rates",
    ": aucun int\u00e9r\u00eat n'est \u00e9crit en op\u00e9ration, aucun solde et aucun chiffre du dashboard n'en d\u00e9pend.":
      ": no interest is written as a transaction, and no balance or dashboard figure depends on it.",

    // ---------- Import de placements : photographie du compte ----------
    "Le fichier contient": "The file contains",
    "Une liste d'op\u00e9rations rejoue l'histoire du compte : une ligne par achat, vente ou transfert, chacune dat\u00e9e. Une photographie dit ce que tu d\u00e9tiens aujourd'hui : une ligne par titre, sa quantit\u00e9, son prix de revient. La photographie \u00e9vite de r\u00e9importer dix ans de mouvements.":
      "A list of transactions replays the account's history: one row per purchase, sale or transfer, each dated. A snapshot says what you hold today: one row per holding, its quantity, its cost price. The snapshot saves re-importing ten years of movements.",
    "Une liste d'op\u00e9rations (achats, ventes, transferts)":
      "A list of transactions (purchases, sales, transfers)",
    "Une photographie du compte (titres d\u00e9tenus)":
      "A snapshot of the account (securities held)",
    "Date de la photographie": "Snapshot date",
    "Le jour o\u00f9 la photographie a \u00e9t\u00e9 prise : c'est de cette date que l'app te consid\u00e8re d\u00e9tenteur de ces titres. Aujourd'hui par d\u00e9faut.":
      "The day the snapshot was taken: from that date on, the app considers you hold these securities. Today by default.",
    "Titres d\u00e9tenus \u2014": "Securities held \u2014",
    "Chaque ligne devient un": "Each row becomes a",
    "dat\u00e9 du jour de la photographie : c'est ainsi qu'une d\u00e9tention existe dans l'application, et c'est ce qui rend justes d'un coup la valorisation et les plus-values. Les esp\u00e8ces du compte baissent donc du total investi \u2014 pense \u00e0 poser son solde initial en cons\u00e9quence.":
      "dated the day of the snapshot: that is how a holding exists in the application, and it is what makes the valuation and the gains right at once. The account's cash therefore drops by the total invested \u2014 remember to set its opening balance accordingly.",
    "Montant investi": "Amount invested",
    // Le mot en gras au milieu de la phrase de la section « Titres détenus ».
    achat: "purchase",
    "Cours d\u00e9duit": "Price inferred",
    "Quantit\u00e9 d\u00e9tenue": "Quantity held",
    "Prix de revient unitaire": "Unit cost price",
    "Valorisation actuelle": "Current valuation",
    "d\u00e9j\u00e0": "already",
    "Ce compte d\u00e9tient d\u00e9j\u00e0 ce titre : importer cette ligne s'ajoutera \u00e0 ce qui s'y trouve.":
      "This account already holds this security: importing this row will add to what is there.",
    "Colonnes remises \u00e0 celles de ce type de fichier. Enregistre pour confirmer.":
      "Columns reset to those of this kind of file. Save to confirm.",
    "Ce fichier est-il une PHOTOGRAPHIE du compte (une ligne par titre d\u00e9tenu) ?\n\nOK : photographie.\nAnnuler : liste d'op\u00e9rations (achats, ventes, transferts).":
      "Is this file a SNAPSHOT of the account (one row per security held)?\n\nOK: snapshot.\nCancel: list of transactions (purchases, sales, transfers).",
    "Le nombre de titres D\u00c9TENUS au moment de la photographie.\n\nC'est cette quantit\u00e9 qui sera enregistr\u00e9e : l'application ne sait pas comment tu y es arriv\u00e9, seulement ce que tu d\u00e9tiens.":
      "The number of securities HELD at the moment of the snapshot.\n\nThat is the quantity that will be recorded: the application does not know how you got there, only what you hold.",
    "Le prix de revient d'UN titre (PRU) \u2014 ce qu'il t'a co\u00fbt\u00e9 en moyenne, frais compris.\n\nUnitaire, et non le montant total investi : c'est ce qu'\u00e9crivent la plupart des courtiers, et le total s'en d\u00e9duit (PRU \u00d7 quantit\u00e9). Si ton relev\u00e9 donne le montant total, divise-le avant d'importer \u2014 sinon chaque position sera multipli\u00e9e par sa quantit\u00e9.":
      "The cost price of ONE security (average unit cost) \u2014 what it cost you on average, fees included.\n\nPer unit, not the total amount invested: that is what most brokers write, and the total follows from it (unit cost \u00d7 quantity). If your statement gives the total, divide it before importing \u2014 otherwise each position will be multiplied by its quantity.",
    "Ce que la ligne vaut aujourd'hui, tous titres confondus. La seule colonne enti\u00e8rement facultative.\n\nElle ne cr\u00e9e aucune d\u00e9tention : elle sert \u00e0 en d\u00e9duire le COURS du titre (valorisation \u00f7 quantit\u00e9), qui n'a pas de colonne \u00e0 lui dans ce genre d'export. Sans elle, le cours reste celui d\u00e9j\u00e0 connu, \u00e0 saisir \u00e0 la main.":
      "What the row is worth today, all securities together. The only entirely optional column.\n\nIt creates no holding: it serves to infer the security's PRICE (valuation \u00f7 quantity), which has no column of its own in this kind of export. Without it, the price stays the one already known, to be entered by hand.",

    // ---------- Drill-through d'une catégorie : dépense amortie ----------
    "{n} mois": "{n} months",
    "1 mois": "1 month",

    // ---------- Textes d'aide récrits, et page d'un objectif ----------
    // noyau.touche-gel-infobulle
    "La touche permettant de geler l'infobulle sur les graphiques. Pour la changer, clique sur le champ et saisis la nouvelle touche ou combinaison de touches":
      "The key that freezes the tooltip on charts. To change it, click the field and press the new key or key combination",
    // noyau.camembert-vue-budget
    "La répartition de tes dépenses rapportées à ton budget de la période.":
      "How your spending breaks down against your budget for the period.",
    // noyau.reste-a-rembourser
    "Ce qu'on te doit - Ce que tu dois.":
      "What you are owed - what you owe.",
    // noyau.total-entrees
    "Les entrées d'argent - prévisionnelles incluses - attribuées à la période (différent de ce qui rentre sur ton compte durant la période). Les entrées amorties sont comptées au prorata, et les dépenses remboursables ne comptent que pour la part non-remboursable.":
      "Money coming in - forecast included - attributed to the period (not the same as what actually lands in your account during the period). Spread-out income is counted pro rata, and reimbursable expenses only count for their non-reimbursable share.",
    // noyau.total-depenses
    "Les sorties d'argent - prévisionnelles incluses - attribuées à la période (différent de ce qui sort de ton compte durant la période). Les dépenses amorties sont comptées au prorata. Les prêts ne comptent que pour la partie à rembourser.":
      "Money going out - forecast included - attributed to the period (not the same as what actually leaves your account during the period). Spread expenses are counted pro rata. Loans only count for the part to be repaid.",
    // noyau.variation-attribuee-au-mois
    "La différence des deux KPIs différents.":
      "The difference between the two different KPIs.",
    // noyau.variation-sur-le-mois-brute
    "La variation de ce que tu possèdes sur le mois : un calcul brut en fonction de la date et du montant.":
      "The change in what you own over the month: a raw calculation based on date and amount.",
    // noyau.statut-previsionnel
    "Pour les opérations à venir qui n'ont pas encore eu lieu. Elles comptent pour ton solde projeté et dans les graphiques du dashboard - de manière distincte.":
      "For upcoming transactions that have not happened yet. They count towards your projected balance and in the dashboard charts - separately.",
    // noyau.repartition-des-avoirs
    "La répartition des avoirs en fonction du type de comptes - prends en compte la valorisation des titres possédés.":
      "The breakdown of your assets by account type - taking into account the valuation of the securities you hold.",
    // noyau.montant-min
    "Montant brut, sans le signe. Ne rien mettre n'impose pas de borne.":
      "Gross amount, without the sign. Leaving it empty sets no bound.",
    // noyau.frais
    "Les frais sur ton opération. Ils apparaissent séparément pour pouvoir les distinguer, mais c'est bien le montant + les frais (ou - les frais) qui sont utilisés pour les calculs.":
      "The fees on your transaction. They are shown separately so you can tell them apart, but it is the amount + fees (or - fees) that is used in calculations.",
    // noyau.monnaie-des-frais
    "Utile pour les virements internes entre devises différentes. Elle permet à l'app de comprendre si elle doit soustraire ou additioner les frais - et où.":
      "Useful for internal transfers between different currencies. It lets the app work out whether to subtract or add the fees - and where.",
    // noyau.decouper-entre-plusieurs-categories
    "Pour répartir le montant d'une opération en plusieurs catégories.":
      "To split the amount of a transaction across several categories.",
    // noyau.amortie-sur-plusieurs-mois
    "Permet d'amortir la dépense sur plusieurs mois, pour avoir une meilleure vue de tes dépenses. N'affecte pas le solde de ton compte et ne change pas la date de l'opération.":
      "Lets you spread the expense over several months, for a better view of your spending. Does not affect your account balance and does not change the transaction's date.",
    // noyau.notice-intro
    "Le mode d'emploi de l'application. Il est assez dense, mais n'a pas vocation à être lu d'un coup. Il s'agit pluôt d'un guide à consulter si tu te poses des questions.":
      "The app's user guide. It is fairly dense and is not meant to be read in one go. Think of it as a guide to consult when you have questions.",
    // noyau.notice-mot-compte
    "C'est la première brique pour catégoriser tes opérations : affecter une opération à un compte impactera son solde, et pas celui des autres.":
      "This is the first building block for categorising your transactions: assigning a transaction to an account affects that account's balance, and not the others'.",
    // noyau.notice-mot-operation
    "Une ligne : une date, un libellé, un montant, un compte. C'est la base sur laquelle repose le reste de l'application.":
      "A line: a date, a description, an amount, an account. It is the foundation the rest of the app rests on.",
    // noyau.notice-mot-categorie
    "C'est la seconde brique pour catégoriser une opération, qui vient avec des valeurs par défaut (modifiables et supprimables) : alimentation, transports, loisirs. C'est avec elles que les graphiques du dashboard se construisent.":
      "This is the second building block for categorising a transaction, and it comes with default values (editable and deletable): groceries, transport, leisure. The dashboard charts are built from them.",
    // noyau.notice-mot-monnaie
    "L'application permet de prendre en compte plusieurs devises avec l'extension « Monnaies », pour ne pas mélanger ce qui ne devrait pas l'être.":
      "The app can handle several currencies with the “Currencies” extension, so that you don't mix what shouldn't be mixed.",
    // noyau.notice-demarrer-1
    "Crée ton ou tes comptes (dans Paramètres → Comptes /Paramètres/Comptes), en choissisant leur type (Courant, d'épargne ou de placements) et leur solde de départ.":
      "Create your account(s) (in Settings → Accounts /Settings/Accounts), choosing their type (Current, savings or investments) and their opening balance.",
    // noyau.notice-demarrer-2
    "Réorganise tes catégories, dans Paramètres → Catégories /Paramètres/Catégories. Tu peux librement en créer, supprimer et modifier, dont les 4 de base.":
      "Reorganise your categories, in Settings → Categories /Settings/Categories. You can freely create, delete and edit them, including the 4 default ones.",
    // noyau.notice-demarrer-3
    "Créer tes opérations : à la main dans la page Opérations /Opérations, ou par un import de relevé (cf. Importer un relevé /Importer un relevé)":
      "Create your transactions: by hand on the Transactions page /Transactions, or through a statement import (see Importing a statement /Importing a statement)",
    // noyau.notice-demarrer-4
    "Ensuite, direction le dashboard ! /- En haut, une vue globale de tes avoirs. /- Au milieu, des cartes qui décrivent l'évolution de ton compte sur le mois ou l'année. /- En bas, deux graphiques te permettant de comprendre ta répartition. // Et enfin, un champ libre de notes (qui s'enregistre automatiquement).":
      "Next, head to the dashboard! /- At the top, a global view of your assets. /- In the middle, cards describing how your account has changed over the month or the year. /- At the bottom, two charts to help you understand your breakdown. // And finally, a free notes field (saved automatically).",
    // noyau.notice-donnees
    "Toutes tes données vivent dans un fichier, dont tu dois choisir l'emplacement au premier lancement. Tu peux le déplacer via Paramètres → Base de données /Paramètres/Base de données. Aucune copie n'est faite et rien ne sort de ton PC : fais donc attention à ne pas le supprimer par erreur.":
      "All your data lives in a single file, whose location you must choose on first launch. You can move it via Settings → Database /Settings/Database. No copy is made and nothing leaves your PC: so be careful not to delete it by mistake.",
    // noyau.notice-dashboard-intro
    "Le dashboard répond à deux questions différentes : qu'est-ce que tu as aujourd'hui (cartes en haut) et comment ce que tu as a évolué (cartes en-dessous) sur la période choisie.":
      "The dashboard answers two different questions: what do you have today (cards at the top) and how what you have has changed (cards below) over the chosen period.",
    // noyau.notice-kpi-solde-total
    "Le total de tes comptes courants. Le chiffre en plus est le prévisionnel, il prend en compte les opérations prévisionelles (cf. Les types d'opérations /Les types d'opérations).":
      "The total of your current accounts. The extra figure is the forecast, which takes forecast transactions into account (see Transaction types /Transaction types).",
    // noyau.notice-kpi-avoirs
    "Ce KPI regroupe tout ce que tu possèdes : comptes courants, épargne, et la valeur de tes titres côtés si l'extension « Placements financiers » tourne.":
      "This KPI gathers everything you own: current accounts, savings, and the value of your listed securities if the “Investments” extension is running.",
    // noyau.notice-dashboard-ecart
    "Deux KPIs pour deux manières de calculer des variations sur le mois : l'une dit ce que le mois COÛTE - les dépenses que tu as attribuées à ce mois - et l'autre ce qui est PASSÉ sur ton compte sur ce mois. /- Par exemple, tu peux payer pour un abonnement annuel et vouloir le faire compter sur chaque mois au lieu d'un seul dans l'année (c'est la fonctionnalité d'amortissement /Les types d'opérations). /- Tu peux aussi avoir une dépense à faire rembourser (en partie ou en totalité) : le premier KPI prendra en compte ce que tu as dépense - ce qu'on te doît, l'autre fera abstraction de cette deuxième donnée. // Quand elles diffèrent, un bouton apparaît et te permet de voir plus en détails.":
      "Two KPIs for two ways of calculating changes over the month: one says what the month COSTS - the expenses you attributed to this month - and the other what actually HAPPENED in your account this month. /- For example, you may pay for an annual subscription and want it to count on each month rather than once in the year (that is the spreading feature /Transaction types). /- You may also have an expense to be reimbursed (in part or in full): the first KPI will take into account what you spent - what you are owed, the other will ignore that second piece of data. // When they differ, a button appears and lets you see more details.",
    // noyau.notice-graphes
    "Les deux graphes montrent la répartition de tes dépenses en fonction de la catégorie. Tu pilotes l'affichage avec la période du sélecteur et avec le filtre « Catégories ». Survoler une barre, une tranche ou une ligne de légende ouvre une infobulle avec plus de détails : /- Le total de la catégorie /- Le poids en pourcentage de celle-ci /- Ton top 3 dépenses (agrégées selon le nom : si tu fais 5 fois des courses au même endroit, tu verras une ligne avec le total et un (5)). /- Enfin, tes objectifs de budget s'y affichent si tu as activé l'extension.":
      "The two charts show the breakdown of your spending by category. You control the display with the period selector and the “Categories” filter. Hovering over a bar, a slice or a legend line opens a tooltip with more details: /- The category's total /- Its weight as a percentage /- Your top 3 expenses (aggregated by name: if you shop five times at the same place, you will see one line with the total and a (5)). /- Finally, your budget goals appear there if you have enabled the extension.",
    // noyau.notice-graphes-histogramme
    "L'histogramme affiche le total par catégorie ! Si tu as l'extension « Budget », la barre rouge qui apparaît est le budget que tu t'es fixé.":
      "The histogram shows the total per category! If you have the “Budget” extension, the red bar that appears is the budget you set yourself.",
    // noyau.notice-graphes-camembert
    "Le camembert montre la part de chaque catégorie. / -En vue « État actuel », chaque tranche est rapportée au total dépensé (le total fait donc 100%). /- En vue « Budget », elles sont rapportées au budget du mois : l'anneau reste ouvert sur ce qui n'a pas été dépensé.":
      "The pie chart shows each category's share. / -In the “Current state” view, each slice is relative to the total spent (so the total is 100%). /- In the “Budget” view, they are relative to the month's budget: the ring stays open on what has not been spent.",
    // noyau.notice-graphes-legende
    "La légende sous les deux est commune aux deux graphiques : l'infobulle affiche le bouton « Voir toutes les dépenses » qui t'emmène à la liste des opérations de cette catégorie.":
      "The legend below the two is shared by both charts: the tooltip shows the “See all expenses” button that takes you to the list of transactions in that category.",
    // noyau.notice-graphes-semaines
    "La flèche sous la rangée des mois déplie les semaines : l'histogramme devient celui de la semaine choisie, et « Moyenne » te montre une vue moyennée sur le mois (au prorata en fonction du nombre de jours écoulés). Les cartes ne sont pas affectées.":
      "The arrow under the row of months expands the weeks: the histogram becomes that of the chosen week, and “Average” shows you an averaged view over the month (pro rata according to the number of days elapsed). The cards are not affected.",
    // noyau.notice-types-intro
    "Le type d'une opération te permet de dicter comment elle agit. Deux types sont disponibles de base, les opérations classiques (entrées et sorties d'argent) et les virements internes (entre deux comptes que tu possèdes). Les autres sont activables et utilisables grâce à des extensions.":
      "A transaction's type lets you dictate how it behaves. Two types are available by default: standard transactions (money in and out) and internal transfers (between two accounts you own). The others can be enabled and used through extensions.",
    // noyau.notice-type-classique
    "Le type d'opération par défaut et le plus courant : des courses, un paiement, un salaire, etc... C'est le seul type que tu peux découper en plusieurs catégories (plus de détails en bas de page).":
      "The default and most common transaction type: groceries, a payment, a salary, etc. It is the only type you can split across several categories (more details at the bottom of the page).",
    // noyau.notice-type-virement
    "Les virements internes ne font pas bouger combien tu possèdes. Ils ont leur type à part, et ne rentrent pas dans les calculs de tes KPIs (à l'exception des virements internes entre deux monnaies différentes).":
      "Internal transfers do not change how much you own. They have their own type and do not enter your KPI calculations (except internal transfers between two different currencies).",
    // noyau.notice-type-remboursable
    "Si tu as avancé de l'argent ou qu'une de tes dépenses est remboursable, ce type est fait pour ton opération. Il te permet de /- ne compter que combien tu as réellement dépensé dans tes KPIs et les graphiques /- renseigner un montant dû /- suivre combien on te doit // Quand un remboursement est effectué (en partie ou totalement), le type Remboursement reçu te permet de relier l'opération de remboursement à la dépense remboursable.":
      "If you advanced money or one of your expenses is reimbursable, this type is made for your transaction. It lets you /- count only what you actually spent in your KPIs and charts /- record an amount owed /- track how much you are owed // When a reimbursement is made (in part or in full), the Reimbursement received type lets you link the reimbursement transaction to the reimbursable expense.",
    // noyau.notice-type-pret
    "Ce type est similaire au précédent, mais dans la situation inverse. Ici, seul les intérêts du montant prêté (s'il y en a) rentrent dans le compte des dépenses.":
      "This type is similar to the previous one, but in the opposite situation. Here, only the interest on the amount borrowed (if any) counts towards expenses.",
    // noyau.notice-statut
    "Deux possibilités pour une opération, réelle ou prévisionnelle :/- les dépenses réelles (la plupart des opérations) sont celles qui ont eu lieu /- les dépenses prévisionnelles sont celles que tu anticipes. A l'import de l'opération en question, l'app le détecte et te propose de remplacer l'opération prévisionnelle.":
      "Two possibilities for a transaction, actual or forecast: /- actual expenses (most transactions) are those that took place /- forecast expenses are those you anticipate. When the transaction in question is imported, the app detects it and offers to replace the forecast transaction.",
    // noyau.notice-import-intro
    "L'import, c'est la manière la plus simple de mettre l'app à jour sur ton budget. Tu peux créer des preset d'imports et des règles /Les extensions/Règles de catégorisation pour configurer une fois ton système d'importation. Les fois d'après, il ne suffira que de quelques clics pour importer.":
      "Importing is the simplest way to bring the app up to date with your budget. You can create import presets and rules /Extensions/Categorisation rules to set up your import system once. Afterwards, a few clicks are all it takes to import.",
    // noyau.notice-tutoriel-encart
    "Un relevé d'exemple au format CSV est disponible te permettre de visualiser. Il contient deux lignes de titre (à ne pas lire) trois colonnes inutiles pour l'app.":
      "A sample statement in CSV format is available so you can see how it works. It contains two header lines (not to be read) and three columns that are useless to the app.",
    // noyau.notice-import-etape-1
    "Choisis ou crée le PRESET qui correspond à ton fichier, et sélectionne de quel compte il s'agit.":
      "Choose or create the PRESET that matches your file, and select which account it is for.",
    // noyau.notice-import-etape-2
    "Dépose le fichier. L'application le lit et affiche comment elle le lit actuellement.":
      "Drop the file. The app reads it and shows how it currently reads it.",
    // noyau.notice-import-etape-4
    "Remplis les correspondances entre catégories, monnaies ou banques de ton relevé et ceux de l'app. L'app les garde en mémoire pour que tu n'aies pas à les renseigner à nouveau.":
      "Fill in the mappings between your statement's categories, currencies or banks and those of the app. The app remembers them so you don't have to enter them again.",
    // noyau.notice-import-etape-5
    "Confirmer te permet de finaliser ! Si tu souhaites revenir en arrière, tu peux annuler l'import : tout revient alors précisément à l'état précédent.":
      "Confirming lets you finalise! If you want to go back, you can cancel the import: everything then returns exactly to its previous state.",
    // noyau.notice-extensions-intro
    "L'application est par défaut minimaliste. Une fois familiarisé, choisis les extensions qui t'intéressent et te sont utiles à ta guise.":
      "The app is minimalist by default. Once you are familiar with it, pick the extensions that interest you and are useful to you, as you like.",
    // noyau.notice-extensions-eteindre
    "Éteindre une extension ne supprime AUCUNE donnée : seul l'affichage disparaît.":
      "Turning an extension off deletes NO data: only the display disappears.",
    // analyse-budget.graphes
    "« Comparer avec » te permet de comparer deux périodes de même durée.":
      "“Compare with” lets you compare two periods of equal length.",
    // analyse-budget.budget-total
    "Le budget de chaque mois, il reprend la valeur du dernier mois par défaut. Il relie les objectifs par catégorie en pourcentage et en valeur. ":
      "Each month's budget; by default it takes the value of the previous month. It links the goals by category in percentage and in value. ",
    // analyse-budget.budget-total-aide
    "Mois par mois et monnaie par monnaie. Hérite par défaut des valeurs du mois précédent.":
      "Month by month and currency by currency. By default it inherits the previous month's values.",
    // analyse-budget.epargne
    "La différence entre ce qui entre et ce qui sort de tes comptes d'épargne ou de placements. Un bon indicateur à suivre si tu veux mettre de l'argent de côté régulièrement.":
      "The difference between what comes into and what leaves your savings or investment accounts. A good indicator to follow if you want to set money aside regularly.",
    // analyse-budget.matelas
    "Le matelas de sécurité que tu gardes sur tes comptes d'épargne - les comptes de placements ne rentrent pas dans ce scope.":
      "The safety cushion you keep in your savings accounts - investment accounts are not in this scope.",
    // analyse-budget.imprevues
    "Les dépenses que tu n'avais prévues : une vue globale te permet de mieux comprendre comment elles pèsent dans ton budget.":
      "Expenses you had not planned for: a global view helps you better understand how they weigh on your budget.",
    // analyse-budget.imprevue-champ
    "Une étiquette lue par l'extension budget. Elle te permet d'avoir une vue globale de tes dépenses liées à des imprévus.":
      "A label read by the budget extension. It gives you a global view of your expenses linked to unexpected events.",
    // noyau.import-previsionnelles
    "Ces lignes du relevé correspondent à des dépenses que tu avais écrites d'avance, en prévisionnel. Plutôt que d'ajouter une opération de plus à côté de la prévision, l'import va REMPLACER la prévision par la vraie ligne : même opération, désormais réelle, avec la date et le montant du relevé. Elle garde tout ce qui lui était rattaché — son projet, son profil de remboursement, sa récurrence. Coché, le remplacement a lieu ; décoché, la ligne s'importe comme une autre et la dépense prévue reste telle quelle. Vérifie la colonne de droite avant de confirmer : c'est elle qui dit ce qui sera écrasé. Et si tu te trompes, annuler l'import rend chaque prévision à son état d'origine.":
      "These statement lines match expenses you had written in advance, as forecasts. Rather than adding one more transaction next to the forecast, the import will REPLACE the forecast with the real line: same transaction, now actual, with the statement's date and amount. It keeps everything attached to it — its project, its reimbursement profile, its recurrence. Ticked, the replacement takes place; unticked, the line is imported like any other and the planned expense stays as it was. Check the right-hand column before confirming: it tells you what will be overwritten. And if you get it wrong, cancelling the import returns each forecast to its original state.",
    // noyau.rapprochement
    "Permet l'amélioration de la détection d'une dépense prévisionnelle renseignée dans l'app lors de son importation. L'import te proposera alors de valider la substitution.":
      "Improves the detection of a forecast expense entered in the app when it is imported. The import will then offer to confirm the substitution.",
    // noyau.rapprochement-mots-cles
    "Permet de ne pas confondre des dépenses de même montant, compte et date mais dont le libellé est différent.":
      "Prevents mixing up expenses with the same amount, account and date but a different description.",
    // noyau.montant-a-rembourser
    "Combien on te doit sur une dépense remboursable, combien tu dois sur un prêt.":
      "How much you are owed on a reimbursable expense, how much you owe on a loan.",
    // noyau.monnaies-du-compte
    "Chaque monnaie du compte garde son propre solde, non mélangé aux autres.":
      "Each currency of the account keeps its own balance, not mixed with the others.",
    // noyau.categories-de-depenses
    "Les dépenses se rangent dans ces catégories. Les réordonner change l'ordre d'apparition sur le dashboard. Eteindre une catégorie agit comme si elle n'existait plus à partir de l'extinction, tout en la conservant comme la catégorie des dépenses à laquelle elle est attribuée.":
      "Expenses are filed into these categories. Reordering them changes the order they appear in on the dashboard. Turning a category off acts as if it no longer existed from that point on, while keeping it as the expense category it is assigned to.",
    // noyau.categorie-entree
    "Te permet de marquer des catégories comme étant des entrées d'argent. Elles n'apparaissent pas sur l'histogramme et ne portent pas de budget.":
      "Lets you mark categories as money coming in. They do not appear on the histogram and carry no budget.",
    // noyau.correspondances-memorisees
    "Les correspondances - catégories, comptes bancaires, monnaies - que l'app a mémorisé de tes imports":
      "The mappings - categories, bank accounts, currencies - that the app has remembered from your imports",
    // noyau.categories-bancaires
    "Le libellé de ton relevé, suivi du compte lié au preset d'importation. Glisse-le vers une autre catégorie pour modifier la correspondance.":
      "Your statement's label, followed by the account linked to the import preset. Drag it onto another category to change the mapping.",
    // noyau.comptes-bancaires
    "Les noms de compte lus dans tes relevés et le comptes de l'app en face.":
      "The account names read in your statements and the app's account opposite.",
    // noyau.devises
    "Les libellés de devise de tes relevés (« EUR »), et la monnaie de l'app en face.":
      "The currency labels in your statements (“EUR”), and the app's currency opposite.",
    // noyau.preset
    "Comment l'app doit comprendre ton fichier d'opérations.":
      "How the app should understand your transactions file.",
    // noyau.compte-bancaire-de-ce-preset
    "Toutes les lignes du fichier iront sur ce compte. Laisse « aucun » si le fichier comporte une colonne comptes.":
      "All the lines in the file will go to this account. Leave “none” if the file has an accounts column.",
    // noyau.configuration-du-fichier
    "Quelle colonne de ton fichier porte quelle information. Date, Nature et Montant sont obligatoires.":
      "Which column of your file carries which piece of information. Date, Description and Amount are required.",
    // noyau.colonnes-lues
    "Clique sur l'œil pour indiquer à l'app de lire ou d'ignorer une information.":
      "Click the eye to tell the app to read or ignore a piece of information.",
    // noyau.configuration-avancee
    "Pour les fichiers nécessitant un paramétrage plus complexe.":
      "For files that need more complex settings.",
    // noyau.detection-colonnes
    "L'application lit le fichier et essaie d'attribuer chaque colonne à une ou plusieurs potentielles propriétés. Ensuite, à toi de trancher. Rien n'est enregistré sur ton preset tant que tu n'utilises pas le bouton d'enregistrement ou d'actualisation.":
      "The app reads the file and tries to assign each column to one or more possible properties. Then it is up to you to decide. Nothing is saved to your preset until you use the save or update button.",
    // noyau.detection-colonnes-enregistrer
    "Appliquer met à jour les colonnes, sans enregistrer le preset. Attention : si tu appuies sur Enregistrer le preset, ton ancien preset sera remplacé par la configuration actuelle.":
      "Apply updates the columns without saving the preset. Careful: if you press Save the preset, your old preset will be replaced by the current configuration.",
    // noyau.detection-colonnes-suggestion
    "La plupart des lignes sont illisibles, tu peux utiliser la détectection automatique de colonnes pour t'aider à régler ce souci.":
      "Most lines are unreadable; you can use automatic column detection to help fix this.",
    // noyau.le-fichier-tel-qu-il-est
    "Les colonnes lues sont colorées et portent l'information que l'app en tire en en-tête. Deux façons de modifier : glisser un en-tête sur un autre pour échanger les deux ou saisir les numéros dans « Configuration du fichier » au-dessus.":
      "The columns read are coloured and carry, in the header, the information the app takes from them. Two ways to change them: drag a header onto another to swap the two, or enter the numbers in “File configuration” above.",
    // noyau.categories-bancaires-a-confirmer
    "Les nouveaux libellés apparaîtront ici, pour que tu renseignes vers quelle catégorie de l'app ils pointent. Une fois fait, confirme en cochant la case.":
      "New labels will appear here so that you can say which app category they point to. Once done, confirm by ticking the box.",
    // noyau.apercu-import
    "Les doublons repérés sont déjà cochés pour permettre une suppression rapide. Pour déverrouiller l'import, supprime-les ou décoche-les si tu veux tout de même les importer.":
      "Duplicates spotted are already ticked to allow quick deletion. To unlock the import, delete them, or untick them if you still want to import them.",
    // noyau.ressemblances
    "Une détection de doublons pour les virements internes : les opérations ici ne sont pas rejetés par défaut, mais l'app te les signale pour éviter d'importer des opérations en double.":
      "A duplicate check for internal transfers: transactions here are not rejected by default, but the app flags them so you avoid importing duplicates.",
    // noyau.doublons-detectes
    "Ces lignes sont identiques à des lignes déjà importées, sur la base des critères que tu as défini pour le preset. Tu peux les importer en les décochant.":
      "These lines are identical to lines already imported, based on the criteria you defined for the preset. You can import them by unticking them.",
    // noyau.lignes-entete
    "Les lignes d'en-tête et d'informations qui ne sont pas des opérations. N'utilise pas ceci pour gérer des doublons, une fonctionnalité est présente pour ça.":
      "Header and information lines that are not transactions. Don't use this to handle duplicates; there is a feature for that.",
    // noyau.comparaison-des-doublons
    "Quelles colonnes l'app doit lire ou non pour identifier un doublon.":
      "Which columns the app should read or not to identify a duplicate.",
    // noyau.mots-cles-de-la-colonne-sens
    "Les mots-clés indiquant si ligne sort ou entre. Ajoute-les un par un avec « + » ou Entrée ; insensible aux majuscules et accents.":
      "Keywords indicating whether a line goes out or comes in. Add them one by one with “+” or Enter; case- and accent-insensitive.",
    // noyau.mots-cles-de-la-colonne-etat
    "Les mots-clés indiquant l'état de l'opération : utile si ton fichier renseigne des status (ex : en attente, complété, annulé).":
      "Keywords indicating the transaction's status: useful if your file records statuses (e.g. pending, completed, cancelled).",
    // noyau.devises-a-faire-correspondre
    "Même fonctionnement que pour les catégories : enregistre la correspondance une fois pour toutes.":
      "Same as for categories: save the mapping once and for all.",
    // noyau.devises-deja-rattachees
    "Ces libellés ont déjà leur correspondance : simplement là pour vérifier avant de confirmer.":
      "These labels already have their mapping: they are just here for you to check before confirming.",
    // noyau.historique-des-importations
    "Annuler un import retire les opérations qu'il avait créées, qu'elles aient été modifiées ou non.":
      "Cancelling an import removes the transactions it created, whether or not they were edited.",
    // noyau.base-de-donnees
    "L'application lit et écrit dans un seul fichier .db. « Basculer » permet de lire un fichier différent. « Créer / déplacer ici » déplace la base actuelle dans le nouveau dossier.":
      "The app reads and writes in a single .db file. “Switch” lets you read a different file. “Create / move here” moves the current database to the new folder.",
    // import-placements.colonnes-lues
    "Clique sur l'œil pour lire ou ignorer une colonne. Les colonnes proposées dépendent de ce que le fichier contient : une liste d'opérations lit une date et un type, une photographie lit une quantité détenue et un prix de revient.":
      "Click the eye to read or ignore a column. The columns offered depend on what the file contains: a list of transactions reads a date and a type, a snapshot reads a quantity held and a cost price.",
    // import-placements.regles-de-type-d-operation
    "Une règle reconnaît une ligne à son libellé et dit ce qu'elle est : achat, vente, transfert d'espèces. Elle vaut pour tous tes courtiers et passe avant les mots-clés du preset. Les mots-clés de la « Configuration du fichier » comparent un libellé entier : « Achat » est un achat, et rien d'autre ne l'est. Quand le courtier écrit une phrase — « ACHAT COMPTANT ETF MSCI WORLD », avec le nom du titre dedans — aucune liste de mots-clés ne peut la reconnaître, parce qu'il n'y a pas deux fois le même libellé dans le fichier. Une règle, elle, sait dire « contient ACHAT ». Elles sont évaluées de haut en bas et s'arrêtent à la première qui correspond : contrairement aux règles bancaires, une règle de placement ne décide que d'une chose, il n'y a donc rien à compléter en dessous. Place les cas particuliers au-dessus des cas généraux. Une ligne qu'aucune règle ne reconnaît retombe sur les mots-clés du preset. Sans aucune règle, l'import se comporte donc exactement comme avant.":
      "A rule recognises a line by its label and says what it is: purchase, sale, cash transfer. It applies to all your brokers and takes precedence over the preset's keywords. The keywords under “File configuration” compare a whole label: “Purchase” is a purchase, and nothing else is. When the broker writes a sentence — “ACHAT COMPTANT ETF MSCI WORLD”, with the security's name inside — no keyword list can recognise it, because the same label never appears twice in the file. A rule, on the other hand, can say “contains ACHAT”. They are evaluated from top to bottom and stop at the first one that matches: unlike bank rules, an investment rule decides only one thing, so there is nothing to complete below it. Put special cases above general ones. A line that no rule recognises falls back on the preset's keywords. With no rules at all, the import therefore behaves exactly as before.",
    // import-placements.description
    "C'est l'extension te permettant d'importer des relevés pour tes titres de placements (nécessite l'extension Placements). Le mécanisme d'import est le même que celui pour l'import d'informations, et l'information clé est l'ISIN d'un titre - un identifiant unique.":
      "This is the extension that lets you import statements for your investment securities (requires the Investments extension). The import mechanism is the same as for importing information, and the key piece of information is a security's ISIN - a unique identifier.",
    // interets-percus.interets-percus
    "Pour renseigner les intérêts perçus sur tes comptes de placements. Pense à les remettre à 0 si un import de relevé les importe.":
      "To record the interest received on your investment accounts. Remember to set them back to 0 if a statement import brings them in.",
    // investing-overview.repartition-par-classe
    "À quoi ton portefeuille est exposé : actions, obligations, immobilier, monétaire ?":
      "What is your portfolio exposed to: stocks, bonds, real estate, money market?",
    // investing-overview.repartition-par-type-de-titre
    "Comment ton portefeuille est détenu : quelles sont les enveloppes que tu utilises ?":
      "How your portfolio is held: which wrappers do you use?",
    // monnaies.taux-de-change
    "Permet d'utiliser la fonctionnalité tout convertir du dashboard pour une vue complète. Tes opérations ne sont jamais modifiées, uniquement l'affichage du dashboard.":
      "Lets you use the dashboard's convert-all feature for a complete view. Your transactions are never modified, only the dashboard display.",
    // placements.titres-suivis
    "Les titres que tu utilises sur l'app. Le cours se saisit à la main ou se lit en ligne avec l'extension Lecture de cours.":
      "The securities you use in the app. The price is entered by hand or read online with the Price lookup extension.",
    // placements.enveloppe
    "Voir l'infobulle plus bas.":
      "See the tooltip further down.",
    // placements.types-de-titre
    "Sous quelle forme tes titres sont détenus : ETF, action en direct, fonds et SCPI sont livrés par défaut.":
      "The form in which your securities are held: ETF, direct stock, funds and SCPI are provided by default.",
    // placements.classes-actif
    "À quel type d'objet financier tes avoirs t'exposent-ils ?":
      "What kind of financial asset do your holdings expose you to?",
    // objectifs.page-objectif
    "Toutes les opérations qui entrent dans le chiffre de la carte, sur la vue choisie : la plus grosse d'abord. Le montant retenu est ce que chacune pèse dans l'objectif — son reste à charge si elle est remboursable, sa part si elle est découpée, la part du mois si elle est amortie (son montant réel est écrit en dessous, et le nombre de mois d'amortissement entre crochets après la date). La somme des montants retenus est le chiffre de la carte, avant d'être ramenée à la cadence ou divisée par le nombre de dépenses selon ce que l'objectif mesure.":
      "All the transactions that go into the card's figure, in the chosen view: the biggest first. The amount counted is what each one weighs in the goal — its out-of-pocket share if it is reimbursable, its share if it is split, the month's share if it is spread (its real amount is written below, and the number of spreading months in square brackets after the date). The sum of the amounts counted is the card's figure, before it is brought back to the cadence or divided by the number of expenses, depending on what the goal measures.",
    // projets.projets
    "Rassemble des opérations déjà saisies, quelles que soient leur catégorie et leur compte, pour lire ce qu'un voyage ou un déménagement t'a coûté. Une opération peut appartenir à plusieurs projets, et rien d'autre dans l'app n'en tient compte. Un projet ne se saisit pas depuis une opération : on le crée ici, puis on y verse les opérations concernées. C'est un regroupement de LECTURE — retirer une opération d'un projet ne la supprime pas, et supprimer un projet ne supprime aucune dépense.":
      "Brings together transactions you have already entered, whatever their category and account, to see what a trip or a move cost you. A transaction can belong to several projects, and nothing else in the app takes them into account. A project is not entered from a transaction: you create it here, then add the relevant transactions to it. It is a READING grouping — removing a transaction from a project does not delete it, and deleting a project deletes no expense.",
    // regles.regles-de-categorisation
    "Une règle reconnaît des lignes à leur libellé et dit ce qu'elles sont : virement interne, prêt, dépense remboursable… Elle peut aussi poser la catégorie, et passe avant tout le reste. Une règle classe automatiquement les lignes importées d'après leurs libellés — c'est le seul moyen de marquer une ligne « remboursable » ou de la classer en Prêt / Remboursement sans le faire à la main. Les règles sont communes à tous les presets d'import. Elles sont évaluées de haut en bas, et s'arrêtent à la première qui correspond — sauf si celle-ci décoche « Arrêter la lecture des règles ici ». Plusieurs règles peuvent alors s'appliquer à une même ligne, mais aucune ne défait ce qu'une règle plus haute a décidé : en cas de désaccord, la plus haute gagne. Place les cas particuliers au-dessus des cas généraux. Les règles passent avant les correspondances mémorisées : un type reconnu ici ne peut plus être défait par une correspondance de catégorie. Les dossiers ne servent qu'à s'y retrouver : ils ne changent pas l'ordre d'évaluation, qui reste celui de la vue liste (le numéro sur chaque carte le rappelle). Fais glisser une règle d'un dossier à l'autre pour la ranger. Ce classement reste sur cet ordinateur — il n'est pas enregistré dans la base.":
      "A rule recognises lines by their label and says what they are: internal transfer, loan, reimbursable expense… It can also set the category, and it takes precedence over everything else. A rule automatically classifies imported lines from their labels — it is the only way to mark a line “reimbursable” or to classify it as a Loan / Repayment without doing it by hand. Rules are shared by all import presets. They are evaluated from top to bottom, and stop at the first one that matches — unless it has “Stop reading rules here” unticked. Several rules can then apply to the same line, but none undoes what a higher rule decided: in case of disagreement, the highest wins. Put special cases above general ones. Rules take precedence over remembered mappings: a type recognised here can no longer be undone by a category mapping. Folders are only there to help you find your way: they do not change the evaluation order, which remains that of the list view (the number on each card reminds you). Drag a rule from one folder to another to file it. This arrangement stays on this computer — it is not saved in the database.",
    // regles.description
    "L'une des extensions phares de l'application. Ta banque fournit un libellé conséquent pour des dépenses récurrentes, que tu dois renommer sans cesse ? Tu voudrais automatiser les modifications récurrentes que tu fais ? L'extension règle t'apporte la flexibilité de faire /bold(ce que tu veux).":
      "One of the app's flagship extensions. Does your bank give a lengthy label for recurring expenses that you have to keep renaming? Would you like to automate the edits you keep making? The rules extension gives you the flexibility to do /bold(whatever you want).",
    // regles.tuto-notes
    "Si ton preset lit la colonne « Notes » du relevé, une condition peut aussi porter sur elle : utile quand la banque écrit la référence utile dans le commentaire plutôt que dans le libellé.":
      "If your preset reads the statement's “Notes” column, a condition can also apply to it: useful when the bank writes the useful reference in the comment rather than in the label.",
    // regles.tuto-ajout-champ
    "Rien ne s'affiche d'office : « + Ajouter un champ » pose une propriété à la fois, et la croix la retire. Même geste que dans les sorties conditionnelles, juste en dessous.":
      "Nothing is shown by default: “+ Add a field” adds one property at a time, and the cross removes it. Same gesture as in the conditional outputs, just below.",
    // noyau.tuto-import-notes
    "La colonne « Notes » est éteinte au départ. Allume-la si ton relevé porte un commentaire ou une référence : il est recopié dans la note de l'opération, et tes règles peuvent s'en servir.":
      "The “Notes” column is off by default. Turn it on if your statement carries a comment or a reference: it is copied into the transaction's note, and your rules can use it.",
    // regles.action
    "Le type détermine ce qui suit : seules « Opération classique » et « Dépense remboursable » laissent choisir une catégorie — les autres types imposent la leur. Chaque part dit combien elle prend. On peut écrire un nombre (50), un pourcentage (30%), une opération (montant - 50), ou utiliser min et max — par exemple min(montant; 50) pour « au plus 50 € ». Le mot reste donne à une part tout ce que les autres n'ont pas pris ; une seule part peut le porter, et la somme doit valoir le montant de la ligne.":
      "The type determines what follows: only “Standard transaction” and “Reimbursable expense” let you choose a category — the other types impose their own. Each part says how much it takes. You can write a number (50), a percentage (30%), a calculation (montant - 50), or use min and max — for example min(montant; 50) for “at most €50”. The word reste gives a part everything the others have not taken; only one part can carry it, and the sum must equal the line's amount.",
    // noyau.import-propriete-notes
    "Un commentaire, une référence ou un mémo que ta banque écrit à côté du libellé.\n\nIl est recopié dans les notes de l'opération (sauf si une règle en pose une), et tes règles peuvent le tester comme le libellé.":
      "A comment, a reference or a memo that your bank writes next to the label.\n\nIt is copied into the transaction's notes (unless a rule sets one), and your rules can test it like the label.",
    // import-placements.le-fichier-tel-qu-il-est
    "Chaque colonne lue est colorée et porte le nom de la propriété qui sera importée. Les colonnes grises sont ignorées. Si une couleur ne tombe pas en face des bonnes données, corrige les numéros de colonne dans « Configuration du fichier » au-dessus.":
      "Each column read is coloured and carries the name of the property that will be imported. Grey columns are ignored. If a colour does not land opposite the right data, fix the column numbers in “File configuration” above.",
    // import-placements.titres-detenus-ligne-s
    "Chaque ligne devient un achat daté du jour de la photographie : c'est ainsi qu'une détention existe dans l'application, et c'est ce qui rend justes d'un coup la valorisation et les plus-values. Les espèces du compte baissent donc du total investi — pense à poser son solde initial en conséquence.":
      "Each line becomes a purchase dated the day of the snapshot: that is how a holding exists in the application, and it is what makes the valuation and the gains right all at once. The account's cash therefore drops by the total invested — remember to set its opening balance accordingly.",
    // import-placements.transferts-deja-connus-ligne-s
    "Ces transferts ressemblent à un virement déjà enregistré : même montant, mêmes comptes, à quelques jours près. C'est normal — le même mouvement figure sur le relevé du courtier et sur celui du compte courant. Seuls les virements qui touchent le compte de ce preset sont comparés. Rien n'est bloqué ni pré-sélectionné : toi seul sais si tu as vraiment fait deux fois le mouvement. Chaque ligne est suivie de ce à quoi elle ressemble.":
      "These transfers look like a transfer already recorded: same amount, same accounts, within a few days. That is normal — the same movement appears on the broker's statement and on the current account's. Only transfers touching this preset's account are compared. Nothing is blocked or pre-selected: only you know whether you really made the movement twice. Each line is followed by what it looks like.",
    // import-placements.lignes-en-erreur-ligne-s
    "Ces lignes ne seront pas importées telles quelles. Corrige-les avec « Modifier », ou supprime-les de l'aperçu — le reste du fichier s'importe normalement.":
      "These lines will not be imported as they are. Fix them with “Edit”, or delete them from the preview — the rest of the file imports normally.",
    // analyse-budget.description
    "C'est LA page pour pouvoir tenir ton budget. // Elle te permet de sélectionner un budget pour ton mois et de choisir des budgets par catégorie. // Tu peux l'utiliser pour comparer les graphiques du dashboard sur différentes périodes, et mieux comprendre comme tu gères ton argent avec plus de recul. // Elle te permet également d'avoir accès à trois nouveaux indicateurs : /- L'argent que tu as mis de côté sur la période (virements internes vers tes comptes d'épargne ou de placements) /- Un matelas de sécurité que tu définis, utile pour s'assurer que ce dernier se porte bien /- La classification de dépenses comme étant imprévues, et le montant de ces imprévus sur la période : cet indicateur te permet de mieux comprendre ce qu'on n'anticipe jamais et qu'on finit par souvent par définir comme impossible à prendre en compte dans le budget ":
      "THE page for keeping your budget. // It lets you choose a budget for your month and set budgets by category. // You can use it to compare the dashboard charts over different periods, and better understand how you manage your money with more perspective. // It also gives you access to three new indicators: /- The money you set aside over the period (internal transfers to your savings or investment accounts) /- A safety cushion that you define, useful to make sure it is doing well /- Marking expenses as unexpected, and the amount of those unexpected expenses over the period: this indicator helps you better understand what we never anticipate and often end up calling impossible to account for in the budget ",
    // interets-percus.description
    "Un compte d'épargne te rapporte de l'argent passivement, à des fréquences différences (journalier, mensuel, annuel, ...). Néanmoins, une opération ne s'écrit pas pour autant dans tes relevés - l'app affichera donc un montant erroné pour ton compte de placements quand tes intérêts apparaîtront sur ton compte. // Cette extension - s'affichant dans la page Vue des avoirs /Vue des avoirs - te permet de renseigner à la main ces intérêts et les assigner à un compte de placements.":
      "A savings account earns you money passively, at different frequencies (daily, monthly, yearly, ...). However, no transaction is written in your statements as a result — so the app will show a wrong amount for your investment account when your interest shows up in your account. // This extension - shown on the Assets overview page /Assets overview - lets you enter that interest by hand and assign it to an investment account.",
    // investing-overview.description
    "Cette extension te permet d'avoir une vue d'ensemble sur les actifs que tu possèdes (nécessite l'extension Placements), avec plusieurs classifications (type d'actifs, d'enveloppes) pour mieux comprendre ce que tu possèdes, comment et à quoi tes actifs t'exposent.":
      "This extension gives you an overview of the assets you own (requires the Investments extension), with several classifications (asset type, wrappers) to better understand what you own, how, and what your assets expose you to.",
    // lecture-de-cours.description
    "IMPORTANT : cette extension est la seule à te permettre de relier ton app à internet. Elle te permet de fournir des liens de pages de cotation pour que l'app les utilise : elle nécessite l'extension Placements financiers (lecture de cours d'actifs) ou Monnaies (lecture de taux de change).":
      "IMPORTANT: this extension is the only one that lets you connect your app to the internet. It lets you provide quote-page links for the app to use: it requires the Investments extension (asset price lookup) or Currencies (exchange-rate lookup).",
    // monnaies.description
    "Sans cette extension, l'application est mono-devise. L'activer te permet de créer de nouvelles monnaies, et donc de relier des dépenses ou des comptes à différentes monnaies pour ne pas mélanger ce qui ne se mélange.":
      "Without this extension, the application is single-currency. Enabling it lets you create new currencies, and so link expenses or accounts to different currencies so as not to mix what should not be mixed.",
    // objectifs.description
    "Cette extension te permet de créer des objectifs personnalisés pour gérer tes dépenses comme tu le souhaites. Tu peux créer des indicateurs personnalisés prenant en compte la fréquence, le montant moyen, le montant total, une part, pour comprendre et agir plus en détails qu'avec de simples limites sur des catégories (ex : mes courses devraient 300€ en moyenne par mois / je vise 2 sorties resto max par semaine / j'épargne au moins 50€ par mois).":
      "This extension lets you create custom goals to manage your spending the way you want. You can create custom indicators based on frequency, average amount, total amount, a share, to understand and act in more detail than with simple limits on categories (e.g. my groceries should be €300 on average per month / I aim for 2 restaurant outings max per week / I save at least €50 per month).",
    // placements.description
    "Grâce à cette extension, tu peux renseigner et comprendre les actifs que tu détiens (achat, vente, plus-value, valorisation). Une fois activée, tu retrouveras cette page en onglet de la page Vue des avoirs /Vue des avoirs.":
      "Thanks to this extension, you can record and understand the assets you hold (purchase, sale, capital gain, valuation). Once enabled, you will find this page as a tab of the Assets overview page /Assets overview.",
    // prets.description
    "Te permet de classifier comme tel et suivre l'argent qu'on t'a prêté (intérêts compris). Le fonctionnement de ces types d'opérations est similaire aux opérations remboursables / remboursements.":
      "Lets you classify money lent to you as such and track it (interest included). These transaction types work like reimbursable expenses / reimbursements.",
    // projets.description
    "Un voyage, un investissement dans une activité sous différentes formes, des rénovations ? Difficile de suivre ça avec seulement des catégories. Tu peux donc créer un projet, et y rajouter toutes les opérations que tu veux. Tu obtiens alors une vue détaillée de ce que ton projet t'a coûté - ou rapporté - classifié en catégories.":
      "A trip, an investment in an activity in its various forms, renovations? Hard to track with categories alone. So you can create a project and add all the transactions you want to it. You then get a detailed view of what your project cost you - or earned you - classified by category.",
    // suivi-remboursements.description
    "On te doit de l'argent à droite à gauche, et tu dois des dépenses, des montants, de combien on t'a remboursé et des personnes de tête ? // Active cette extension pour avoir accès à deux types d'opérations : /- les opérations remboursables : tu peux y sélectionner le montant à rembourser, le montant dû et l'extension te permet d'ajouter qui te doit l'argent via le menu Suivi des remboursements /- les remboursements reçus : comme une opération classique, que tu peux relier à l'opération remboursable - le montant dû se met alors automatiquement à jour // italic(La page Suivi des remboursements te permet de voir tous tes remboursements en attente et indiquer qui te doit quoi.)":
      "People owe you money here and there, and you owe expenses, amounts, how much you were reimbursed and people to keep in your head? // Enable this extension to get access to two transaction types: /- reimbursable expenses: you can set the amount to be reimbursed and the amount owed, and the extension lets you add who owes you the money via the Repayment tracking menu /- reimbursements received: like a standard transaction, which you can link to the reimbursable expense - the amount owed is then updated automatically // italic(The Repayment tracking page lets you see all your pending reimbursements and note who owes you what.)",
    "Semaine affichée": "Week shown",
    "Mois en cours": "This month",
    "Mois affiché": "Month shown",
    "Moyenne de l'année": "Year average",
    "Moyenne sur tout l'historique": "All-time average",
    "Depuis": "Since",
    "Voir les opérations": "View transactions",
    "← Retour aux objectifs": "← Back to goals",
    "Opérations qui entrent en compte —": "Transactions counted —",
    "Aucune opération n'entre en compte sur cette période.": "No transaction counts towards this goal over this period.",
    "Montant retenu": "Amount counted",
    "Total retenu": "Total counted",

    // ---------- Libellés posés en JavaScript, et clés normalisées des textes d'aide ----------
    "Catégorie d'entrée": "Income category",
    "Dépenses prévues reconnues —": "Forecast expenses recognised —",
    "Aucun titre détenu pour le moment. Achète ou importe des titres depuis la page Placements financiers, et la répartition apparaîtra ici.": "No securities held yet. Buy or import securities from the Investments page, and the breakdown will appear here.",
    "entrée": "income",
    "ex. EDF": "e.g. EDF",
    "Aucun mot-clé : le compte, le montant et la date suffisent à reconnaître la dépense.": "No keyword: the account, the amount and the date are enough to recognise the expense.",
    "Modifier le virement": "Edit transfer",
    "Supprimer ce virement ? Les deux lignes liées (sortante et entrante) seront supprimées.": "Delete this transfer? Both linked lines (outgoing and incoming) will be deleted.",
    "- À choisir -": "- Choose -",
    "Dépenses réglées": "Expenses settled",
    "Ajouter un groupe": "Add a group",
    "Le budget de chaque mois, il reprend la valeur du dernier mois par défaut. Il relie les objectifs par catégorie en pourcentage et en valeur.":
      "Each month's budget; by default it takes the value of the previous month. It links the goals by category in percentage and in value. ",
    "Un commentaire, une référence ou un mémo que ta banque écrit à côté du libellé. Il est recopié dans les notes de l'opération (sauf si une règle en pose une), et tes règles peuvent le tester comme le libellé.":
      "A comment, a reference or a memo that your bank writes next to the label.\n\nIt is copied into the transaction's notes (unless a rule sets one), and your rules can test it like the label.",
    "C'est LA page pour pouvoir tenir ton budget. // Elle te permet de sélectionner un budget pour ton mois et de choisir des budgets par catégorie. // Tu peux l'utiliser pour comparer les graphiques du dashboard sur différentes périodes, et mieux comprendre comme tu gères ton argent avec plus de recul. // Elle te permet également d'avoir accès à trois nouveaux indicateurs : /- L'argent que tu as mis de côté sur la période (virements internes vers tes comptes d'épargne ou de placements) /- Un matelas de sécurité que tu définis, utile pour s'assurer que ce dernier se porte bien /- La classification de dépenses comme étant imprévues, et le montant de ces imprévus sur la période : cet indicateur te permet de mieux comprendre ce qu'on n'anticipe jamais et qu'on finit par souvent par définir comme impossible à prendre en compte dans le budget":
      "THE page for keeping your budget. // It lets you choose a budget for your month and set budgets by category. // You can use it to compare the dashboard charts over different periods, and better understand how you manage your money with more perspective. // It also gives you access to three new indicators: /- The money you set aside over the period (internal transfers to your savings or investment accounts) /- A safety cushion that you define, useful to make sure it is doing well /- Marking expenses as unexpected, and the amount of those unexpected expenses over the period: this indicator helps you better understand what we never anticipate and often end up calling impossible to account for in the budget ",
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
    /^Le type « (.+) » est géré par l'onglet Placements financiers et ne peut pas être posé ici\.$/,
    "The “$1” type is managed by the Investments page and cannot be set here.",
  ],
  [
    /^Le type « (.+) » ne peut pas être posé par une règle : les achats\/ventes de titres se saisissent depuis l'onglet Placements financiers\.$/,
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

// UN JEU DE MOTIFS PAR LANGUE : la liste ci-dessus est l'anglaise, celle du
// portugais s'ajoute depuis i18n-pt.js. Le français n'en a pas — c'est la langue
// des messages tels que le serveur les écrit.
const MOTIFS_PAR_LANGUE = { en: MOTIFS_SERVEUR, pt: [] };

