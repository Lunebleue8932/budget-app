/**
 * LES TUTORIELS GUIDÉS, ET LA MÉMOIRE DE CE QU'ON EN A FAIT.
 *
 * POURQUOI CE FICHIER EXISTE À CÔTÉ DE `notice.js`. Les deux décrivent
 * l'application, mais ils ne répondent pas à la même question et ne se lisent
 * pas au même moment. La NOTICE répond à « qu'est-ce que c'est ? » — on la
 * traverse du regard, à froid, avant ou après. Le TUTORIEL répond à « où est-ce
 * que je clique ? » — il se suit devant l'écran, un geste après l'autre, et son
 * mécanisme (une bulle posée contre un élément, un halo, une progression) n'a
 * rien à voir avec une page de texte. Les garder ensemble obligeait à ouvrir la
 * notice pour lancer un tutoriel, c'est-à-dire à passer par l'écran qu'on
 * n'allait justement pas lire.
 *
 * LE TUTORIEL NE BLOQUE PAS L'ÉCRAN, et c'est tout son intérêt : pas de voile
 * par-dessus l'application, pas de clic capturé. La bulle explique, l'élément
 * visé s'allume, et les gestes se font pour de vrai sur le vrai écran — un
 * tutoriel qu'on regarde sans rien toucher n'apprend pas un geste.
 *
 * RIEN N'EST VALIDÉ. On avance quand on a compris, pas quand on a exécuté : un
 * tutoriel qui refuse d'avancer tant qu'un geste n'est pas fait bloque celui qui
 * l'a déjà fait autrement.
 *
 * CE QU'IL NE FAIT PAS : il n'appelle aucune route d'écriture, ne crée aucune
 * donnée et ne modifie aucun réglage du budget. La seule chose qu'il écrit est
 * sa propre progression, dans le localStorage.
 */

/* ---------- La mémoire de progression ---------- */

/**
 * OÙ ON EN EST, PARCOURS PAR PARCOURS.
 *
 * `{ "<id>": { etape: <index>, termine: <bool> } }`, dans le localStorage
 * comme le thème et la langue : c'est un confort propre au poste, pas une
 * donnée du budget, et changer de machine n'a aucune raison de ramener la
 * progression de l'autre.
 *
 * DEUX INFORMATIONS ET NON UNE. « Terminé » n'est pas « à l'étape 21 sur 21 » :
 * on peut rouvrir un parcours fini pour revoir une étape, et l'écran doit
 * continuer de dire qu'il a été suivi jusqu'au bout. Sans ce drapeau, revenir
 * en arrière d'une étape effacerait le fait de l'avoir terminé.
 */
const CLE_PROGRESSION_TUTORIELS = "budget-app.tutoriels";

let progressionTutoriels = {};

function chargerProgressionTutoriels() {
  try {
    const brut = JSON.parse(localStorage.getItem(CLE_PROGRESSION_TUTORIELS) || "null");
    if (brut && typeof brut === "object") {
      progressionTutoriels = brut;
      return;
    }
  } catch (err) {
    // Contenu illisible (édité à la main, version antérieure) : on repart d'une
    // progression vide plutôt que de casser l'écran. Rien n'est perdu d'autre
    // que la place où l'on s'était arrêté.
    console.warn("Progression des tutoriels illisible, remise à zéro :", err);
  }
  progressionTutoriels = {};
}

function enregistrerProgressionTutoriels() {
  try {
    localStorage.setItem(CLE_PROGRESSION_TUTORIELS, JSON.stringify(progressionTutoriels));
  } catch (err) {
    // Stockage indisponible (navigation privée stricte) : le tutoriel marche
    // exactement pareil, il ne se souviendra simplement de rien.
    console.warn("Progression des tutoriels non enregistrée :", err);
  }
}

function progressionDe(id) {
  const brut = progressionTutoriels[id] || {};
  const etape = Number(brut.etape);
  return {
    etape: Number.isFinite(etape) && etape > 0 ? Math.floor(etape) : 0,
    termine: brut.termine === true,
  };
}

function noterProgression(id, { etape, termine } = {}) {
  const avant = progressionDe(id);
  progressionTutoriels[id] = {
    etape: etape !== undefined ? etape : avant.etape,
    termine: termine !== undefined ? termine : avant.termine,
  };
  enregistrerProgressionTutoriels();
  renderTutorielsParametres();
}

/* ---------- Les exemples de fichier ----------
 *
 * DES CLASSEURS FACTICES, CHARGÉS DANS L'ÉCRAN D'IMPORT LUI-MÊME, et non des
 * fichiers à télécharger. La moitié des colonnes de l'import n'existe que pour
 * des formats qu'on ne rencontre pas tous les jours — deux colonnes de montant,
 * une colonne « Sens », trois devises sur une même ligne. Les décrire en une
 * phrase ne suffit pas : on ne reconnaît un format qu'en le VOYANT. Mais
 * demander de télécharger un fichier par cas, de le déposer, de régler le
 * preset et de recommencer douze fois, c'est une demi-journée pour apprendre où
 * cliquer.
 *
 * ILS ÉTAIENT DESSINÉS DANS LA BULLE, et c'était le problème : une bulle de
 * 22rem ne montre pas huit colonnes, et on ne pouvait pas y faire défiler le
 * tableau de côté. Chaque exemple devient donc un vrai CSV, lu par la VRAIE
 * prévisualisation (`executerPrevisualisation`) — le tableau « Le fichier tel
 * qu'il est » le montre comme si l'utilisateur l'avait déposé, défilement,
 * lettres de colonne et couleurs de propriété compris, et l'aperçu en dessous
 * dit ce que le preset en ferait. Rien n'est écrit : seule la confirmation
 * écrit, et le tutoriel ne la déclenche jamais.
 *
 * L'EXEMPLE REPART AVEC LE TUTORIEL : le quitter vide l'écran d'import s'il
 * montre encore un fichier du tutoriel (cf. arreterTutoriel), pour ne pas
 * laisser derrière lui un relevé qui n'existe pas. Un fichier que
 * l'utilisateur avait déposé lui-même n'est remplacé qu'après accord.
 */

const EXEMPLE_COMPTE_BANQUE = {
  titre: "Un export qui couvre plusieurs comptes",
  entetes: ["Date", "Libellé", "Montant", "Compte"],
  lignes: [
    ["02/09/2026", "CARREFOUR MARKET", "-45,20", "Compte courant"],
    ["03/09/2026", "VIREMENT EPARGNE", "-200,00", "Compte courant"],
    ["03/09/2026", "VIREMENT RECU", "200,00", "Livret A"],
  ],
  note: "Sans la colonne « Compte bancaire », ces trois lignes iraient toutes sur le même compte.",
};

const EXEMPLE_SENS = {
  titre: "Un relevé qui n'écrit que des montants positifs",
  entetes: ["Date", "Libellé", "Sens", "Montant"],
  lignes: [
    ["02/09/2026", "CARREFOUR MARKET", "Débit", "45,20"],
    ["05/09/2026", "SALAIRE SEPTEMBRE", "Crédit", "2 150,00"],
  ],
  note: "C'est le mot de la colonne « Sens » qui donne son signe au montant. Un mot inconnu met la ligne en erreur plutôt que d'être deviné : se tromper ici inverserait l'opération dans tous les soldes.",
};

const EXEMPLE_MONTANT_SCINDE = {
  titre: "Un relevé qui sépare le débit du crédit",
  entetes: ["Date", "Libellé", "Débit", "Crédit"],
  lignes: [
    ["02/09/2026", "CARREFOUR MARKET", "45,20", ""],
    ["05/09/2026", "SALAIRE SEPTEMBRE", "", "2 150,00"],
    ["07/09/2026", "ESSENCE", "62,00", "0,00"],
  ],
  note: "La colonne REMPLIE dit le sens, exactement comme un mot le dirait. Un zéro compte comme une case vide (ligne 3) : bien des banques écrivent « 0,00 » du côté inutilisé.",
};

const EXEMPLE_MONNAIE = {
  titre: "Un compte qui porte plusieurs devises",
  entetes: ["Date", "Libellé", "Montant", "Devise"],
  lignes: [
    ["02/09/2026", "HOTEL LISBOA", "-84,00", "EUR"],
    ["04/09/2026", "AMAZON.COM", "-32,10", "USD"],
  ],
  note: "Chaque devise lue est rattachée à une monnaie de l'app par une correspondance que tu confirmes UNE fois. Rien n'est deviné d'un nom ou d'un symbole qui se ressemblent.",
};

const EXEMPLE_WISE = {
  titre: "Un relevé qui ne donne jamais « le » montant",
  entetes: ["Date", "Libellé", "Envoyé", "Dev.", "Frais", "Dev.", "Reçu", "Dev."],
  lignes: [
    ["02/09/2026", "Transfert vers USD", "100,00", "EUR", "2,00", "EUR", "106,40", "USD"],
    ["09/09/2026", "Paiement carte", "45,00", "EUR", "0,90", "USD", "48,10", "USD"],
  ],
  note: "Ce qui part, la commission, ce qui arrive — chacun dans sa devise. C'est la DEVISE DES FRAIS qui dit auquel des deux montants ils se rapportent : dans la monnaie envoyée ils s'y ajoutent, dans celle du montant ils s'en retranchent. Une troisième devise est refusée plutôt que devinée.",
};

const EXEMPLE_STATUT = {
  titre: "Un relevé qui mélange les lignes passées et celles à venir",
  entetes: ["Date", "Libellé", "Montant", "État"],
  lignes: [
    ["02/09/2026", "CARREFOUR MARKET", "-45,20", "Exécuté"],
    ["12/09/2026", "PRELEVEMENT EDF", "-89,00", "En attente"],
    ["13/09/2026", "PAIEMENT REFUSE", "-30,00", "Refusé"],
  ],
  note: "« Exécuté » fait une opération réelle, « en attente » une prévisionnelle qui pèse sur le solde projeté, « refusé » n'entre pas du tout.",
};

const EXEMPLE_LIGNES_ENTETE = {
  titre: "Un export qui commence par une page de garde",
  entetes: ["A", "B", "C", "D"],
  sansEntetes: true,
  lignes: [
    ["RELEVÉ DE COMPTE", "", "", ""],
    ["Titulaire : Dupont", "", "", ""],
    ["Du 01/09/2026 au 30/09/2026", "", "", ""],
    ["", "", "", ""],
    ["Date", "Libellé", "Montant", "Compte"],
    ["02/09/2026", "CARREFOUR MARKET", "-45,20", "Compte courant"],
  ],
  note: "Cinq lignes de tête ici : les trois du bandeau, la ligne vide, et la ligne des intitulés. Sans ce réglage, elles arrivent dans l'aperçu comme des opérations illisibles, à supprimer à la main à chaque import.",
};

// UN VRAI CSV À L'ANGLO-SAXONNE, et pas un tableau qui le décrit : c'est en le
// voyant lu (ou mal lu) par l'écran d'import qu'on comprend ce que ces deux
// réglages changent. `csv` remplace alors les en-têtes et les lignes.
const EXEMPLE_DELIMITEUR = {
  titre: "Un CSV écrit à l'anglo-saxonne",
  csv: 'Date,Libellé,Montant\n02/09/2026,CARREFOUR,"-1,234.56"\n05/09/2026,SALAIRE,"2,150.00"\n',
  note: "Quand presque toutes les lignes sont en « date illisible » ou « montant illisible », ce n'est pas le fichier qui est mauvais : c'est le délimiteur ou la décimale détectés qui ne conviennent pas à ce format.",

};

/* LE CSV D'UN EXEMPLE : en-têtes puis lignes, délimiteur « ; » — celui des
 * exports français, qui laisse la virgule aux décimales. Une cellule qui
 * contient le délimiteur ou un guillemet est citée. */
function csvExempleTutoriel(exemple) {
  if (exemple.csv) return exemple.csv;
  const citer = (cellule) =>
    /[;"\n]/.test(cellule) ? `"${String(cellule).replace(/"/g, '""')}"` : String(cellule);
  const lignes = exemple.sansEntetes ? exemple.lignes : [exemple.entetes, ...exemple.lignes];
  return lignes.map((ligne) => ligne.map(citer).join(";")).join("\n") + "\n";
}

const PREFIXE_FICHIER_EXEMPLE = "exemple-tutoriel-";

function fichierImportEstUnExemple() {
  return !!(
    typeof importFichierActuel !== "undefined" &&
    importFichierActuel &&
    importFichierActuel.name.startsWith(PREFIXE_FICHIER_EXEMPLE)
  );
}

/**
 * Charge un exemple dans l'écran d'import, comme si on l'avait déposé.
 * Rend false quand l'utilisateur refuse de remplacer SON fichier.
 */
async function montrerExempleTutoriel(exemple, rang) {
  if (
    typeof importApercu !== "undefined" &&
    importApercu &&
    importApercu.lignes.length > 0 &&
    !fichierImportEstUnExemple() &&
    !confirm(
      t("Le tutoriel va afficher un fichier d'exemple à la place de celui que tu as chargé (rien n'a été importé). Continuer ?")
    )
  ) {
    return false;
  }
  const fichier = new File([csvExempleTutoriel(exemple)], `${PREFIXE_FICHIER_EXEMPLE}${rang + 1}.csv`, {
    type: "text/csv",
  });
  // Le chemin de `definirFichierImport`, SANS sa question « un aperçu est déjà
  // en cours » : entre deux exemples du tutoriel, il n'y a rien à perdre.
  importFichierActuel = fichier;
  document.getElementById("import-fichier-nom").textContent = t(exemple.titre);
  reinitialiserReglagesLecture();
  await executerPrevisualisation();
  return true;
}

const EXEMPLE_DOUBLONS = {
  titre: "Deux exports du même mois, à une colonne près",
  entetes: ["Date", "Libellé", "Montant", "Solde après"],
  lignes: [
    ["02/09/2026", "CARREFOUR MARKET", "-45,20", "1 204,80"],
    ["02/09/2026", "CARREFOUR MARKET", "-45,20", "1 187,30"],
  ],
  note: "La même opération, exportée deux fois : seule la colonne « Solde après » diffère, parce qu'elle dépend du jour de l'export. Exclue de la comparaison, la seconde ligne est reconnue comme un doublon ; comparée, elle passe pour neuve.",
};

/* ---------- Les parcours ----------
 *
 * UNE ÉTAPE DÉCRIT UN ENDROIT, PAS UN CLIC À FORCER. `cible` est l'élément à
 * allumer ; `avant` prépare l'écran quand il faut y être pour voir quelque chose
 * (ouvrir l'onglet Import, déplier un bloc replié) ; `siMasque` remplace le halo
 * quand l'élément n'existe pas encore — la moitié de l'écran d'import n'apparaît
 * qu'une fois un fichier lu, et pointer un rectangle vide n'apprend rien.
 */

const TUTORIEL_DECOUVERTE = [
  {
    cible: "header nav",
    titre: "Quatre écrans, et c'est tout",
    texte:
      "Le dashboard montre ce que le mois a fait. La vue globale des comptes montre ce que tu possèdes. Opérations est la liste de tout, et Paramètres ce qui règle le reste — comptes, catégories, import, extensions. On va les traverser dans cet ordre.",
    avant: () => switchSection("dashboard"),
  },
  {
    cible: "#section-dashboard .kpi-grid",
    titre: "En haut : ce que tu as, aujourd'hui",
    texte:
      "Ces cartes-là ne dépendent PAS du mois choisi. Le solde total est ce qu'il y a sur tes comptes courants, et son chiffre gris à côté est le solde projeté — ce qu'il deviendra une fois les dépenses prévues passées.",
  },
  {
    cible: "#section-dashboard .periode-selecteur",
    titre: "La période se choisit ici",
    texte:
      "Une rangée d'années, une rangée de mois, et une petite flèche sous les mois qui déplie les SEMAINES du mois choisi. L'histogramme descend alors d'un cran — c'est le même graphe, pas un second. Recliquer la semaine allumée rend le mois entier.",
  },
  {
    cible: "#section-dashboard .flux-periode",
    titre: "En bas : ce que la période a fait",
    texte:
      "Ces quatre cartes suivent le mois choisi. Les deux dernières ne mesurent pas la même chose : l'une dit ce que le mois COÛTE (une dépense étalée n'y compte que pour sa part du mois), l'autre ce qui a BOUGÉ sur le compte, à la date et pour le montant du relevé. Elles diffèrent, et c'est normal — un bouton dans la carte jaune explique d'où vient l'écart, ligne par ligne.",
  },
  {
    cible: "#dashboard-legende",
    titre: "Les deux graphes partagent tout",
    texte:
      "Même filtre de catégories, mêmes couleurs, une seule légende sous les deux. Survoler une barre, une tranche ou une ligne de légende allume les trois. L'infobulle qui suit le curseur SE FIGE avec une touche (« F » par défaut, réglable dans Paramètres généraux) : c'est ce qui permet d'aller cliquer dedans.",
  },
  {
    cible: "#operations-sous-nav",
    titre: "Opérations : un onglet par type",
    texte:
      "Chaque type d'opération a son onglet et ses colonnes. Les onglets grisés ou absents appartiennent à une extension éteinte. Tant que le tri est chronologique, la date coiffe un bloc de lignes ; trie par montant ou par compte et elle redescend dans la ligne — grouper par jour n'aurait alors plus rien à grouper.",
    avant: () => switchSection("operations"),
  },
  {
    cible: "#filtres-classique",
    titre: "Le filtre de dates CHOISIT la période",
    texte:
      "« Du » et « Au » ne s'ajoutent pas aux onglets de période : ils les déplacent. Un intervalle contenu dans un mois bascule sur ce mois, dans une année sur cette année, sinon sur « Tout ». Deux champs vides ne bougent rien.",
  },
  {
    cible: ".ajouter-operation[data-onglet='classique']",
    titre: "Ce qu'une opération peut porter",
    texte:
      "Ce bouton ouvre le formulaire ici même ; un double-clic sur une ligne l'ouvre SOUS elle, déjà rempli. Trois choses s'y ajoutent à tout type : un statut (réel, ou prévisionnel — qui ne pèse que sur le solde projeté), une DÉCOUPE entre plusieurs catégories (un plein de courses dont 30 € de ménager reste une seule ligne au relevé), et un AMORTISSEMENT sur plusieurs mois.",
    avant: () => switchSection("operations"),
  },
  {
    cible: "#comptes-liste",
    titre: "Comptes, catégories, monnaies : on ÉTEINT",
    texte:
      "Supprimer emporterait l'historique. Éteindre ne supprime rien : l'élément quitte simplement les menus, plus aucune écriture nouvelle ne le désigne, et tout reparaît tel quel sur une période antérieure. Le bouton est dans le formulaire (double-clic sur la ligne), pas dans la liste.",
    avant: () => switchSection("parametres", { sousSection: "parametres-comptes" }),
  },
  {
    cible: "#parametres-sous-nav-droite",
    titre: "La moitié droite règle l'application",
    texte:
      "À gauche ce que l'application manipule — tes comptes, tes catégories. À droite ce qui la règle : les paramètres généraux, les correspondances retenues des imports, l'import lui-même, les extensions, et le fichier où vivent tes données.",
    avant: () => switchSection("parametres", { sousSection: "parametres-generaux" }),
  },
  {
    cible: "#extensions-liste",
    titre: "Les extensions s'allument une par une",
    texte:
      "Rien n'est actif d'office. Une extension ajoute un écran, un type d'opération ou une colonne ; l'éteindre fait disparaître son écran sans RIEN effacer, et tout revient si tu la rallumes. C'est de là que viennent les prêts, le suivi des remboursements, le budget, les placements.",
    avant: () => switchSection("parametres", { sousSection: "parametres-extensions" }),
  },
  {
    cible: "#sous-section-parametres-bdd",
    titre: "Où vivent tes données",
    texte:
      "Un seul fichier .db, à l'endroit que tu as choisi au premier démarrage. Range-le ailleurs que dans le dossier de l'application : c'est celui qu'une mise à jour remplace. Le chemin est retenu d'un lancement à l'autre, hors de ce dossier, justement pour qu'aucune mise à jour n'y touche.",
    avant: () => switchSection("parametres", { sousSection: "parametres-bdd" }),
  },
  {
    cible: "#tutoriels-liste",
    titre: "Et la suite",
    texte:
      "Tu sais l'essentiel. L'import d'un relevé a son propre tutoriel, juste en dessous de celui-ci : c'est la partie qui demande le plus de réglages, et la seule où un fichier de travers peut faire perdre du temps. La notice, au-dessus, décrit chaque écran en détail quand tu butes sur quelque chose.",
    avant: () => switchSection("parametres", { sousSection: "parametres-generaux" }),
  },
];

const TUTORIEL_IMPORT = [
  {
    cible: "#parametres-sous-nav",
    titre: "L'import vit dans les Paramètres",
    texte:
      "Tout se passe ici, dans l'onglet « Import ». On vient d'y aller pour toi. Garde cette bulle ouverte : elle suit les étapes pendant que tu regardes l'écran.",
    avant: () => ouvrirSousPageParametres("parametres-import"),
  },
  {
    cible: "#import-preset-chips",
    titre: "Le preset",
    texte:
      "Un preset retient la FORME d'un fichier : quelles colonnes lire, et où. Tu en crées un par banque et par type d'export, puis tu ne le règles plus jamais. Le bouton « + Nouveau preset » en crée un ; celui qui est allumé ici est celui qu'on utilise.",
  },
  {
    cible: "#import-preset-compte",
    titre: "Le compte de ce preset",
    texte:
      "Si le relevé ne décrit qu'un seul compte — le cas ordinaire — dis-le ici : chaque ligne importée ira sur ce compte, et le fichier n'aura pas à le nommer.",
  },
  {
    cible: "#import-dropzone",
    titre: "Le fichier",
    texte:
      "Dépose ton relevé ici, ou clique pour le choisir. Pour t'entraîner, prends le relevé d'exemple que la notice propose au téléchargement : c'est un vrai CSV, avec une ligne de titre parasite et trois colonnes dont l'application n'a rien à faire — exactement ce qu'une banque exporte.",
  },
  {
    cible: "#import-apercu-fichier-bloc",
    titre: "Le fichier tel qu'il est",
    texte:
      "Ce tableau montre ce que l'application LIT, colonne par colonne. C'est ici qu'on corrige : fais glisser un en-tête sur un autre pour échanger deux colonnes, jusqu'à ce que chaque propriété tombe en face de la bonne. Les colonnes hachurées sont celles que le réglage attend et que le fichier n'a pas.",
    siMasque:
      "Ce tableau apparaît dès qu'un fichier est déposé : reviens à cette étape à ce moment-là.",
  },
  {
    cible: "#import-config-colonnes",
    titre: "Les colonnes lues",
    texte:
      "La même chose que le glisser-déposer, dite en numéros. L'œil de chaque ligne allume ou éteint une colonne ; Date, Nature et Montant sont obligatoires et ne s'éteignent pas. Les quatre d'ici suffisent à l'immense majorité des relevés.",
    avant: () => deplierBloc("#import-config-fichier"),
  },
  {
    cible: "#import-config-avancee",
    titre: "Les colonnes secondaires",
    texte:
      "Huit colonnes de plus, repliées parce que la plupart des relevés n'en ont aucune — et indispensables à ceux qui les ont. Ce sont des colonnes comme les autres : même œil, même numéro. Les étapes qui suivent les prennent une par une, avec à chaque fois le format qui la rend nécessaire.",
    avant: () => {
      deplierBloc("#import-config-fichier");
      deplierBloc("#import-config-avancee");
    },
  },
  {
    cible: "#import-config-colonnes-avancees",
    titre: "« Compte bancaire »",
    texte:
      "Quand un même export couvre plusieurs comptes, c'est cette colonne qui dit lequel. Tu rattaches chaque libellé bancaire à un compte de l'app une seule fois, et l'application s'en souvient pour les imports suivants. Elle est ignorée si le preset est déjà lié à un compte : ce compte-là s'impose à toutes les lignes.",
    exemple: EXEMPLE_COMPTE_BANQUE,
  },
  {
    cible: "#import-config-colonnes-avancees",
    titre: "« Sens »",
    texte:
      "Beaucoup de relevés n'écrivent que des montants positifs et mettent le signe dans une colonne à part. Sans elle, toutes les lignes entreraient comme des entrées d'argent. Sur une opération classique, le sens lu prime même sur la catégorie — un salaire rangé ailleurs qu'« Entrées d'argent » reste une entrée.",
    exemple: EXEMPLE_SENS,
  },
  {
    cible: "#import-config-colonnes-avancees",
    titre: "« Montant au débit » et « Montant au crédit »",
    texte:
      "L'autre façon, très répandue, de ne pas signer les montants : deux colonnes, dont une seule est remplie par ligne. Ce couple REMPLACE « Montant » — l'allumer éteint la colonne unique, et l'éteindre la rallume, pour qu'aucune configuration sans montant ne puisse exister. Les deux colonnes remplies sur une même ligne mettent celle-ci en erreur : compenser un débit par un crédit inventerait une opération que le relevé ne décrit pas.",
    exemple: EXEMPLE_MONTANT_SCINDE,
  },
  {
    cible: "#import-config-colonnes-avancees",
    titre: "« Monnaie »",
    texte:
      "La devise dans laquelle la ligne est libellée. Sans cette colonne, chaque ligne prend la monnaie principale du compte visé — ce qui suffit à un compte mono-devise, et se corrige ligne par ligne dans l'aperçu autrement. Les trois colonnes de devise (celle-ci, celle du montant envoyé, celle des frais) partagent le même stock de correspondances : « EUR » se rattache une fois pour les trois.",
    exemple: EXEMPLE_MONNAIE,
  },
  {
    cible: "#import-config-colonnes-avancees",
    titre: "« Montant envoyé », « Frais » et leurs devises",
    texte:
      "Les quatre dernières vont ensemble, et elles existent pour les relevés qui ne donnent jamais « le » montant d'une opération. « Montant » est ce qui ARRIVE, « Montant envoyé » ce qui PART avant frais et avant conversion. L'application ne convertit RIEN : entre deux devises, c'est le fichier qui doit donner les deux montants, sinon la ligne attend que tu les saisisses.",
    exemple: EXEMPLE_WISE,
  },
  {
    cible: "#import-config-colonnes-avancees",
    titre: "« État »",
    texte:
      "Le mot par lequel la banque dit si la ligne est passée. « Exécuté » fait une opération réelle, « en attente » une prévisionnelle, « refusé » n'entre pas du tout. Et quand une dépense prévue que tu avais écrite toi-même se retrouve dans le relevé, l'import te propose de la REMPLACER plutôt que d'en créer une seconde — la même dépense ne comptera pas deux fois.",
    exemple: EXEMPLE_STATUT,
  },
  {
    cible: "#import-sens-libelles-bloc",
    titre: "Les mots-clés de « Sens » et « État »",
    texte:
      "Chaque banque écrit les siens : un relevé anglophone n'a aucune raison de dire « Débit ». Ajoute-les un par un avec « + » ou Entrée ; majuscules, accents et espaces sont ignorés. Une liste vide retombe sur les mots par défaut, rappelés sous chaque champ. Un libellé inconnu met la ligne en erreur plutôt que d'être deviné.",
    avant: () => {
      deplierBloc("#import-config-fichier");
      deplierBloc("#import-config-avancee");
    },
    siMasque:
      "Ce bloc n'apparaît qu'une fois la colonne « Sens » configurée : sans elle, ces mots-clés ne serviraient à rien. Même chose pour « État », juste en dessous.",
  },
  {
    cible: "#import-config-doublons",
    titre: "La comparaison des doublons",
    texte:
      "Comment l'application reconnaît une ligne déjà importée. Soit toutes les colonnes SAUF celles que tu désignes — les colonnes qui bougent d'un export à l'autre, comme un numéro d'ordre ou un solde courant — soit UNIQUEMENT celles que tu désignes. Tape un numéro de colonne, « + », et il rejoint la liste.",
    avant: () => {
      deplierBloc("#import-config-fichier");
      deplierBloc("#import-config-doublons");
    },
    exemple: EXEMPLE_DOUBLONS,
  },
  {
    cible: "#import-config-lignes-ignorees",
    titre: "Les lignes à ne pas importer",
    texte:
      "Combien de lignes, en tête du fichier, ne sont pas des opérations. Beaucoup de banques n'exportent pas une table mais une page : titulaire, numéro de compte, période, ligne vide, puis les intitulés de colonnes. Compte-les comme Excel les numérote.",
    avant: () => {
      deplierBloc("#import-config-fichier");
      deplierBloc("#import-config-lignes-ignorees");
    },
    exemple: EXEMPLE_LIGNES_ENTETE,
  },
  {
    cible: "#import-reglages-lecture",
    titre: "Les réglages de lecture",
    texte:
      "Le dernier recours, et le SEUL réglage de cette section qui ne parte pas dans le preset : il vaut pour le fichier qu'on est en train de lire. L'application l'ouvre d'elle-même quand presque toutes les lignes sortent illisibles — c'est le signe que le délimiteur ou la décimale devinés ne conviennent pas à ce format.",
    avant: () => {
      deplierBloc("#import-config-fichier");
      deplierBloc("#import-reglages-lecture");
    },
    exemple: EXEMPLE_DELIMITEUR,
  },
  {
    cible: "#btn-import-config-enregistrer",
    titre: "Enregistrer la configuration",
    texte:
      "Ce bouton garde tes réglages DANS le preset : c'est ce qui fait qu'au prochain relevé de la même banque, il n'y aura plus rien à régler. Le bouton de relecture, à côté du tableau du fichier, enregistre aussi — mais relit le fichier dans la foulée pour te montrer le résultat.",
    avant: () => deplierBloc("#import-config-fichier"),
  },
  {
    cible: "#import-mappings-bloc",
    titre: "Ce que l'application te demande",
    texte:
      "Les catégories écrites par ta banque ne sont pas les tiennes : tu dis une fois à quoi chacune correspond, et l'application s'en souvient pour tous les imports suivants. Les comptes et les devises inconnus se rattachent au même endroit.",
    siMasque:
      "Ce bloc n'apparaît que si le fichier apporte des catégories, des comptes ou des devises inconnus.",
  },
  {
    cible: "#import-apercu-bloc",
    titre: "L'aperçu, ligne par ligne",
    texte:
      "Rien n'est écrit en base avant ton accord. Chaque ligne se modifie ici — catégorie, type, compte, note, étalement — et se supprime si elle n'a rien à faire là. Les lignes sont rangées par type d'opération, et deux sections de fin posent les questions qui restent : les RESSEMBLANCES (une suspicion, rien n'est coché) et les DOUBLONS (un constat, décochés d'office).",
    siMasque: "L'aperçu apparaît une fois le fichier lu.",
  },
  {
    cible: "#btn-import-confirmer",
    titre: "Confirmer",
    texte:
      "C'est le seul geste qui écrit. Et s'il s'avère que le résultat ne te convient pas, l'historique des importations, plus bas, annule un import entier — les opérations qu'il a créées disparaissent, et les dépenses prévues qu'il avait remplacées reviennent telles qu'elles étaient.",
    siMasque:
      "Ce bouton apparaît au bas de l'aperçu, donc une fois un fichier lu. Il reste gris tant qu'une question n'a pas de réponse — survole-le, il dit lesquelles.",
  },
];

/* LE PARCOURS DES RÈGLES n'existe que si l'extension « Règles » tourne : ses
 * écrans n'existent pas sans elle. Ses textes vivent dans textes.js
 * (`regles.tuto-*`), lus au chargement — textes.js est chargé avant ce
 * fichier. */
function ouvrirEditeurRegleTutoriel() {
  switchSection("parametres", { sousSection: "parametres-correspondances" });
  const editeur = document.getElementById("regle-editeur");
  if (editeur && editeur.style.display === "none" && typeof ouvrirEditeurRegle === "function") {
    ouvrirEditeurRegle();
  }
}

const TUTORIEL_REGLES = [
  {
    cible: "#regles-bloc",
    titre: "Les règles",
    texte: texteAide("regles.tuto-page"),
    avant: () => switchSection("parametres", { sousSection: "parametres-correspondances" }),
  },
  {
    cible: "#btn-regle-nouvelle",
    titre: "Une nouvelle règle",
    texte: texteAide("regles.tuto-nouvelle"),
    avant: ouvrirEditeurRegleTutoriel,
  },
  {
    cible: "#regle-nom",
    titre: "Son nom, et pourquoi elle existe",
    texte: texteAide("regles.tuto-nom"),
    avant: ouvrirEditeurRegleTutoriel,
  },
  {
    cible: "#regle-groupes",
    titre: "Ce qu'elle détecte",
    texte: texteAide("regles.tuto-detection"),
    avant: ouvrirEditeurRegleTutoriel,
  },
  {
    cible: "#regle-type",
    titre: "Ce qu'elle fait",
    texte: texteAide("regles.tuto-action"),
    avant: ouvrirEditeurRegleTutoriel,
  },
  {
    cible: "#regle-nature",
    titre: "Et le reste de la ligne",
    texte: texteAide("regles.tuto-autres"),
    avant: ouvrirEditeurRegleTutoriel,
  },
  {
    cible: "#regle-sorties",
    titre: "Les sorties conditionnelles",
    texte: texteAide("regles.tuto-sorties"),
    avant: ouvrirEditeurRegleTutoriel,
  },
  {
    cible: "#regle-arreter-apres",
    titre: "S'arrêter, ou laisser compléter",
    texte: texteAide("regles.tuto-ordre"),
    avant: ouvrirEditeurRegleTutoriel,
  },
  {
    cible: "#regles-liste",
    titre: "L'ordre des règles",
    texte: texteAide("regles.tuto-liste"),
    avant: () => switchSection("parametres", { sousSection: "parametres-correspondances" }),
  },
];

/**
 * LES PARCOURS, DANS L'ORDRE OÙ ILS SE SUIVENT. Le premier fait le tour de
 * l'application ; le second ne parle que de l'import, parce que c'est la seule
 * partie qui demande de RÉGLER quelque chose avant de pouvoir s'en servir.
 */
const TUTORIELS = [
  {
    id: "decouverte",
    nom: "Prendre l'application en main",
    resume:
      "Le tour des quatre écrans, et les quelques idées qui ne se devinent pas : les deux rangées de cartes, la période, l'extinction plutôt que la suppression, les extensions.",
    etapes: TUTORIEL_DECOUVERTE,
  },
  {
    id: "import",
    nom: "Importer un relevé",
    resume:
      "Régler un preset de bout en bout, colonnes secondaires comprises — avec, à chaque colonne, l'extrait de relevé qui la rend nécessaire.",
    etapes: TUTORIEL_IMPORT,
  },
  {
    id: "regles",
    nom: "Créer une règle",
    resume: texteAide("regles.tuto-resume"),
    etapes: TUTORIEL_REGLES,
    // N'APPARAÎT QU'AVEC SON EXTENSION (cf. parcoursDisponibles).
    extension: "regles",
  },
];

/** Les parcours proposés : ceux dont l'extension, s'ils en ont une, tourne. */
function parcoursDisponibles() {
  return TUTORIELS.filter(
    (parcours) => !parcours.extension || BudgetApp.extensions.estActive(parcours.extension)
  );
}

function tutorielParId(id) {
  return TUTORIELS.find((parcours) => parcours.id === id) || null;
}

/* ---------- L'écran des tutoriels (Paramètres généraux) ---------- */

/**
 * UNE CARTE PAR PARCOURS, AVEC SA JAUGE.
 *
 * C'est ce que la progression existe pour rendre visible : on doit voir OÙ on
 * en est AVANT d'entrer, pas après. Un bouton « Lancer le tutoriel » seul
 * obligeait à le relancer pour découvrir qu'on l'avait déjà suivi aux trois
 * quarts, et à recliquer vingt fois « Suivant » pour retrouver sa place.
 */
function renderTutorielsParametres() {
  const liste = document.getElementById("tutoriels-liste");
  if (!liste) return;
  liste.innerHTML = "";

  parcoursDisponibles().forEach((parcours) => {
    const { etape, termine } = progressionDe(parcours.id);

    const total = parcours.etapes.length;
    const commence = etape > 0 || termine;
    const part = termine ? 100 : Math.round((etape / total) * 100);

    const etatTexte = termine
      ? t("Terminé")
      : commence
        ? `${t("Étape")} ${Math.min(etape + 1, total)} / ${total}`
        : `${t("Pas encore commencé")} · ${total} ${t("étapes")}`;

    const carte = document.createElement("div");
    carte.className = "tutoriel-carte";
    carte.innerHTML = `
      <div class="tutoriel-carte-texte">
        <span class="tutoriel-carte-nom">${escapeHtml(t(parcours.nom))}</span>
        <p class="hint">${escapeHtml(t(parcours.resume))}</p>
        <div class="tutoriel-jauge" role="presentation"><span style="width:${part}%"></span></div>
        <span class="hint tutoriel-carte-etat">${escapeHtml(etatTexte)}</span>
      </div>
      <div class="tutoriel-carte-actions">
        <button type="button" class="primary" data-action="ouvrir">${
          termine ? t("Revoir") : commence ? t("Reprendre") : t("Commencer")
        }</button>
        ${
          commence
            ? `<button type="button" data-action="recommencer">${t("Recommencer")}</button>`
            : ""
        }
      </div>`;

    carte
      .querySelector("[data-action='ouvrir']")
      .addEventListener("click", () => demarrerTutoriel(parcours.id, { reprendre: true }));
    carte
      .querySelector("[data-action='recommencer']")
      ?.addEventListener("click", () => demarrerTutoriel(parcours.id, { reprendre: false }));

    liste.appendChild(carte);
  });
}

/* ---------- La bulle ---------- */

let tutorielParcours = null;
let tutorielEtape = 0;
let tutorielActif = false;

function deplierBloc(selecteur) {
  const bloc = document.querySelector(selecteur);
  if (bloc && bloc.tagName === "DETAILS") bloc.open = true;
}

function ouvrirSousPageParametres(sousSection) {
  switchSection("parametres", { sousSection });
}

function bulleTutoriel() {
  let bulle = document.getElementById("tutoriel-bulle");
  if (bulle) return bulle;
  bulle = document.createElement("div");
  bulle.id = "tutoriel-bulle";
  bulle.className = "tutoriel-bulle";
  bulle.setAttribute("role", "dialog");
  bulle.setAttribute("aria-live", "polite");
  document.body.appendChild(bulle);
  // UN SEUL ÉCOUTEUR DÉLÉGUÉ, posé avec la bulle : elle est réécrite à chaque
  // étape, et recâbler ses boutons y laisserait un écouteur de plus par étape.
  bulle.addEventListener("click", (e) => {
    const bouton = e.target.closest("[data-tutoriel]");
    if (!bouton) return;
    if (bouton.dataset.tutoriel === "suivant") allerEtapeTutoriel(tutorielEtape + 1);
    if (bouton.dataset.tutoriel === "precedent") allerEtapeTutoriel(tutorielEtape - 1);
    if (bouton.dataset.tutoriel === "fin") arreterTutoriel();
  });
  return bulle;
}

function eteindreCibleTutoriel() {
  document
    .querySelectorAll(".tutoriel-cible")
    .forEach((el) => el.classList.remove("tutoriel-cible"));
}

/**
 * Pose la bulle contre sa cible, ou au centre quand il n'y a rien à pointer.
 *
 * SOUS LA CIBLE PAR DÉFAUT, AU-DESSUS quand il n'y a plus de place en bas :
 * une bulle qui sort de l'écran ne dit rien, et c'est le cas ordinaire d'un
 * élément situé en bas de page.
 */
function placerBulleTutoriel(bulle, cible) {
  if (!cible) {
    bulle.classList.add("tutoriel-bulle-centree");
    bulle.style.top = "";
    bulle.style.left = "";
    return;
  }
  bulle.classList.remove("tutoriel-bulle-centree");
  const rect = cible.getBoundingClientRect();
  const hauteur = bulle.offsetHeight || 180;
  const largeur = bulle.offsetWidth || 340;
  const marge = 12;
  let haut = rect.bottom + marge;
  if (haut + hauteur > window.innerHeight - marge) {
    haut = Math.max(marge, rect.top - hauteur - marge);
  }
  const gauche = Math.min(
    Math.max(marge, rect.left),
    window.innerWidth - largeur - marge
  );
  bulle.style.top = `${haut}px`;
  bulle.style.left = `${gauche}px`;
}

/**
 * Ce que la bulle dit d'un exemple : son titre et ce qu'on doit y voir. Le
 * fichier lui-même est dans l'écran d'import, là où la bulle pointe.
 */
function exempleTutorielHtml(exemple, charge) {
  if (!exemple) return "";
  return `
    <div class="tutoriel-exemple">
      <div class="tutoriel-exemple-titre">${escapeHtml(t(exemple.titre))}</div>
      <p class="hint">${escapeHtml(
        charge
          ? t("Ce fichier d'exemple est chargé dans l'écran d'import, comme si tu l'avais déposé : fais défiler « Le fichier tel qu'il est » pour voir toutes ses colonnes. Rien n'est importé.")
          : t("Le fichier d'exemple n'a pas été chargé : ton propre fichier est resté à l'écran.")
      )}</p>
      ${exemple.note ? `<p class="hint">${escapeHtml(t(exemple.note))}</p>` : ""}
    </div>`;
}

// UN NUMÉRO PAR PASSAGE D'ÉTAPE : charger un exemple prend un aller-retour, et
// un « Suivant » cliqué entre-temps ne doit pas voir l'étape précédente se
// dessiner par-dessus la sienne.
let tutorielJeton = 0;

async function allerEtapeTutoriel(index) {
  const jeton = ++tutorielJeton;
  const parcours = tutorielParcours;
  if (!parcours) return;
  if (index < 0) return;
  if (index >= parcours.etapes.length) {
    noterProgression(parcours.id, { etape: parcours.etapes.length - 1, termine: true });
    arreterTutoriel();
    showMessage(`${t("Tutoriel terminé :")} ${t(parcours.nom)}`, "success");
    return;
  }
  tutorielEtape = index;
  // ENREGISTRÉE À CHAQUE ÉTAPE, et non à la sortie : on ne quitte pas un
  // tutoriel par un bouton « Quitter », on ferme la fenêtre ou on part faire
  // autre chose. Une progression écrite seulement à la fin n'aurait donc jamais
  // servi à personne.
  noterProgression(parcours.id, { etape: index });

  const etape = parcours.etapes[index];
  eteindreCibleTutoriel();
  if (etape.avant) etape.avant();

  // UN EXEMPLE SE MONTRE DANS L'APERÇU DU FICHIER, et c'est lui que la bulle
  // désigne alors : le réglage dont parle l'étape se lit en regardant les
  // colonnes du fichier.
  let exempleCharge = false;
  let selecteurCible = etape.cible;
  if (etape.exemple) {
    exempleCharge = await montrerExempleTutoriel(etape.exemple, index);
    if (jeton !== tutorielJeton) return;
    if (exempleCharge) selecteurCible = "#import-apercu-fichier-bloc";
  }

  const cible = document.querySelector(selecteurCible);
  // UN BLOC MASQUÉ N'EST PAS UNE ERREUR : la moitié de l'écran d'import
  // n'existe qu'une fois un fichier lu. On le dit plutôt que de pointer un
  // rectangle vide — ou, pire, de refuser d'avancer.
  const visible = cible && cible.offsetParent !== null;
  if (visible) {
    cible.classList.add("tutoriel-cible");
    cible.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  const bulle = bulleTutoriel();
  bulle.innerHTML = `
    <div class="tutoriel-entete">
      <span class="tutoriel-compteur">${index + 1} / ${parcours.etapes.length}</span>
      <span class="tutoriel-parcours">${escapeHtml(t(parcours.nom))}</span>
      <button type="button" class="tutoriel-fermer" data-tutoriel="fin"
              title="${t("Quitter le tutoriel")}" aria-label="${t("Quitter le tutoriel")}">&times;</button>
    </div>
    <h4>${escapeHtml(t(etape.titre))}</h4>
    <p>${escapeHtml(t(etape.texte))}</p>
    ${exempleTutorielHtml(etape.exemple, exempleCharge)}
    ${
      !visible && etape.siMasque
        ? `<p class="hint">${escapeHtml(t(etape.siMasque))}</p>`
        : ""
    }
    <div class="tutoriel-actions">
      <button type="button" data-tutoriel="precedent" ${index === 0 ? "disabled" : ""}>${t(
        "Précédent"
      )}</button>
      <button type="button" class="primary" data-tutoriel="suivant">${
        index === parcours.etapes.length - 1 ? t("Terminer") : t("Suivant")
      }</button>
    </div>`;
  bulle.style.display = "";
  // APRÈS le rendu : la hauteur de la bulle dépend du texte qu'on vient d'y
  // écrire, et la placer avant la mesurerait vide.
  placerBulleTutoriel(bulle, visible ? cible : null);
}

/**
 * `reprendre: true` repart là où on s'était arrêté ; `false` repart de zéro.
 *
 * Un parcours TERMINÉ qu'on rouvre repart du DÉBUT : « Revoir » ne veut pas dire
 * « relire la dernière étape », et laisser la bulle s'ouvrir sur la conclusion
 * d'un tutoriel qu'on vient de choisir de recommencer n'aurait aucun sens.
 */
function demarrerTutoriel(id, { reprendre = true } = {}) {
  const parcours = tutorielParId(id);
  if (!parcours) return;
  tutorielParcours = parcours;
  tutorielActif = true;
  const { etape, termine } = progressionDe(id);
  if (!reprendre || termine) noterProgression(id, { etape: 0, termine: false });
  allerEtapeTutoriel(reprendre && !termine ? Math.min(etape, parcours.etapes.length - 1) : 0);
}

function arreterTutoriel() {
  tutorielActif = false;
  tutorielJeton++;
  eteindreCibleTutoriel();
  // L'EXEMPLE REPART AVEC LE TUTORIEL : un relevé qui n'existe pas ne doit pas
  // rester dans l'écran d'import. Un fichier déposé par l'utilisateur, lui, n'est
  // jamais touché ici.
  if (fichierImportEstUnExemple()) reinitialiserImport();
  const bulle = document.getElementById("tutoriel-bulle");
  if (bulle) bulle.style.display = "none";
}

// La bulle est en position fixe : elle doit suivre ce qu'elle désigne quand la
// page bouge sous elle, sinon elle finit par pointer autre chose.
["scroll", "resize"].forEach((evenement) => {
  window.addEventListener(
    evenement,
    () => {
      if (!tutorielActif || !tutorielParcours) return;
      const etape = tutorielParcours.etapes[tutorielEtape];
      const cible = document.querySelector(
        etape.exemple && fichierImportEstUnExemple() ? "#import-apercu-fichier-bloc" : etape.cible
      );

      placerBulleTutoriel(
        bulleTutoriel(),
        cible && cible.offsetParent !== null ? cible : null
      );
    },
    { passive: true }
  );
});

// Échap ferme le tutoriel, comme toute chose ouverte par-dessus l'application.
// La progression est déjà écrite : on reprendra exactement ici.
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && tutorielActif) arreterTutoriel();
});

chargerProgressionTutoriels();
renderTutorielsParametres();
