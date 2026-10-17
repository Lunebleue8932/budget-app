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
 * CE QU'IL NE FAIT PAS : il ne crée aucune donnée et ne modifie aucun réglage
 * de la base de l'utilisateur. Ce qu'il écrit : sa propre progression, dans le
 * localStorage, et — sur la base de DÉCOUVERTE seulement, fabriquée pour lui —
 * le preset du parcours d'import (cf. appliquerEtapeImport).
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

/* LA CONFIGURATION D'UN EXEMPLE. Un exemple est un fichier DESSINÉ POUR UN CAS, et
 * l'application ne le lit juste que si le preset décrit ce cas — sans quoi la colonne « Sens »
 * tombait là où le preset attend le montant, l'intitulé passait pour une opération, et la
 * moitié des lignes partaient en erreur. Chaque exemple porte donc tout ce que le preset doit
 * en savoir :
 *   - `colonnes` : [propriété, numéro de colonne] ;
 *   - `lignesEntete` : les lignes de tête à sauter (1 par défaut, la ligne des intitulés) ;
 *   - `delie` : le preset est DÉLIÉ de son compte le temps de l'étape — la colonne « Compte
 *     bancaire » ne s'active pas sur un preset lié ;
 *   - `delimiteur` : celui du CSV dessiné, « ; » par défaut.
 * Le tutoriel l'enregistre dans le preset de la base de découverte (cf. appliquerEtapeImport),
 * jamais dans un preset réel. */
const EXEMPLE_COMPTE_BANQUE = {
  titre: "Un export qui couvre plusieurs comptes",
  entetes: ["Date", "Libellé", "Montant", "Compte"],
  lignes: [
    ["02/09/2026", "CARREFOUR MARKET", "-45,20", "Compte courant"],
    ["03/09/2026", "VIREMENT EPARGNE", "-200,00", "Compte courant"],
    ["03/09/2026", "VIREMENT RECU", "200,00", "Livret A"],
  ],
  note: "Sans la colonne « Compte bancaire », ces trois lignes iraient toutes sur le même compte.",
  colonnes: [["date", 1], ["nature", 2], ["montant", 3], ["compte_banque", 4]],
  delie: true,
};

const EXEMPLE_SENS = {
  titre: "Un relevé qui n'écrit que des montants positifs",
  entetes: ["Date", "Libellé", "Sens", "Montant"],
  lignes: [
    ["02/09/2026", "CARREFOUR MARKET", "Débit", "45,20"],
    ["05/09/2026", "SALAIRE SEPTEMBRE", "Crédit", "2 150,00"],
  ],
  note: "C'est le mot de la colonne « Sens » qui donne son signe au montant. Un mot inconnu met la ligne en erreur plutôt que d'être deviné : se tromper ici inverserait l'opération dans tous les soldes.",
  colonnes: [["date", 1], ["nature", 2], ["sens", 3], ["montant", 4]],
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
  colonnes: [["date", 1], ["nature", 2], ["montant_debit", 3], ["montant_credit", 4]],
};

const EXEMPLE_WISE = {
  titre: "Un relevé qui ne donne jamais « le » montant",
  entetes: ["Date", "Libellé", "Envoyé", "Dev.", "Frais", "Dev.", "Reçu", "Dev."],
  lignes: [
    ["02/09/2026", "Transfert vers USD", "100,00", "EUR", "2,00", "EUR", "106,40", "USD"],
    ["09/09/2026", "Paiement carte", "45,00", "EUR", "0,90", "USD", "48,10", "USD"],
  ],
  note: texteAide("noyau.tuto-import-note-11"),
  colonnes: [
    ["date", 1],
    ["nature", 2],
    ["montant_initial", 3],
    ["monnaie_initiale", 4],
    ["frais", 5],
    ["monnaie_frais", 6],
    ["montant", 7],
    ["monnaie", 8],
  ],
};

// SANS NOTE : l'encadré se résume à son titre et à la phrase qui dit que le fichier est chargé.
const EXEMPLE_STATUT = {
  titre: "Un relevé qui mélange les lignes passées et celles à venir",
  entetes: ["Date", "Libellé", "Montant", "État"],
  lignes: [
    ["02/09/2026", "CARREFOUR MARKET", "-45,20", "Exécuté"],
    ["12/09/2026", "PRELEVEMENT EDF", "-89,00", "En attente"],
    ["13/09/2026", "PAIEMENT REFUSE", "-30,00", "Refusé"],
  ],
  colonnes: [["date", 1], ["nature", 2], ["montant", 3], ["statut", 4]],
};

// UN DÉLIMITEUR QUE LA DÉTECTION NE TROUVE PAS : des virgules entre les colonnes, et une ligne de
// titre qui n'en porte aucune. Aucun délimiteur ne découpe alors toutes les lignes pareil, l'app
// retombe sur « ; », chaque ligne tient dans une seule colonne, et le panneau des réglages de
// lecture se déplie de lui-même. Les colonnes et les lignes de tête, elles, sont justes : choisir
// « , » suffit à tout remettre d'aplomb. Des points décimaux, pour que la virgule ne serve qu'à
// séparer.
const EXEMPLE_DELIMITEUR = {
  titre: "Un relevé séparé par des virgules",
  titreFichier: "Export du compte courant - Septembre 2026",
  entetes: ["Date", "Libellé", "Montant", "Catégorie banque"],
  lignes: [
    ["02/09/2026", "CARREFOUR MARKET", "-45.20", "Alimentation"],
    ["04/09/2026", "LOYER SEPTEMBRE", "-780.00", "Logement"],
    ["05/09/2026", "SALAIRE SEPTEMBRE", "2150.00", "Virements reçus"],
    ["07/09/2026", "LE BISTROT DU COIN", "-28.00", "Restaurants"],
  ],
  note: texteAide("noyau.tuto-import-note-15"),
  colonnes: [["date", 1], ["nature", 2], ["montant", 3], ["categorie_banque", 4]],
  lignesEntete: 2,
  delimiteur: ",",
};

/* LE CSV D'UN EXEMPLE : son titre s'il en a un (`titreFichier`), les en-têtes, puis les lignes ;
 * délimiteur « ; » par défaut — celui des exports français, qui laisse la virgule aux
 * décimales. Une cellule qui contient le délimiteur ou un guillemet est citée. */
function csvExempleTutoriel(exemple) {
  const delimiteur = exemple.delimiteur || ";";
  const citer = (cellule) =>
    String(cellule).includes(delimiteur) || /["\n]/.test(cellule)
      ? `"${String(cellule).replace(/"/g, '""')}"`
      : String(cellule);
  const lignes = [exemple.entetes, ...exemple.lignes].map((ligne) => ligne.map(citer).join(delimiteur));
  if (exemple.titreFichier) lignes.unshift(exemple.titreFichier);
  return lignes.join("\n") + "\n";
}

const PREFIXE_FICHIER_EXEMPLE = "exemple-tutoriel-";

// LE RELEVÉ D'EXEMPLE DE LA NOTICE, celui qu'on peut aussi télécharger : le tutoriel le charge
// lui-même dès l'étape où l'on parle du fichier, pour que tout ce qui suit se lise sur un vrai
// relevé. Il porte le préfixe des exemples : le quitter le vide comme eux.
const URL_FICHIER_TEST = "/exemples/releve-exemple.csv";
const NOM_FICHIER_TEST = `${PREFIXE_FICHIER_EXEMPLE}releve.csv`;

function fichierImportEstUnExemple() {
  return !!(
    typeof importFichierActuel !== "undefined" &&
    importFichierActuel &&
    importFichierActuel.name.startsWith(PREFIXE_FICHIER_EXEMPLE)
  );
}

function fichierImportEstLeFichierTest() {
  return !!(
    typeof importFichierActuel !== "undefined" &&
    importFichierActuel &&
    importFichierActuel.name === NOM_FICHIER_TEST
  );
}

/* LA CONFIGURATION DU RELEVÉ DE LA NOTICE, telle que la base de découverte la pose dans son
 * preset (cf. base_decouverte.COLONNES_PRESET_IMPORT) : une ligne de titre et celle des
 * intitulés, puis 1 Date, 3 Libellé, 5 Montant, 7 Catégorie banque. C'est celle de toutes les
 * étapes qui n'ont pas de raison d'en avoir une autre — le but n'est pas de faire régler les
 * colonnes à chaque étape. */
const CONFIG_RELEVE_TUTORIEL = {
  colonnes: [["date", 1], ["nature", 3], ["montant", 5], ["categorie_banque", 7]],
  lignesEntete: 2,
};

/* SAUF AUX DEUX ÉTAPES QUI APPRENNENT À LA CORRIGER (le glisser-déposer, puis le numéro saisi) :
 * les champs y sont volontairement en face des MAUVAISES colonnes. Libellé et catégorie sont
 * échangés, le montant lit le solde : faux, et visiblement faux, mais toujours LISIBLE — une
 * date ou un montant illisibles sur toutes les lignes déplieraient l'alerte du délimiteur, qui
 * n'a rien à faire à ces étapes. */
const CONFIG_RELEVE_DESORDONNEE = {
  colonnes: [["date", 1], ["nature", 7], ["montant", 6], ["categorie_banque", 3]],
  lignesEntete: 2,
};

/* L'ÉTAPE 5 VA PLUS LOIN : la date lit la colonne 2 (la référence), et TOUTES les lignes passent
 * en « date illisible ». C'est voulu — on voit du premier coup d'œil qu'il faut changer quelque
 * chose — mais l'alerte du délimiteur, qui se déclenche sur ce signe-là, est rangée
 * (`sansAlerteLecture`) : le délimiteur n'y est pour rien. */
const CONFIG_RELEVE_DATE_DECALEE = {
  colonnes: [["date", 2], ["nature", 7], ["montant", 6], ["categorie_banque", 3]],
  lignesEntete: 2,
};

/** La configuration qu'une étape du parcours d'import pose dans le preset. */
function configEtapeImport(etape) {
  if (etape.exemple) {
    return {
      colonnes: etape.exemple.colonnes,
      lignesEntete: etape.exemple.lignesEntete ?? 1,
      delie: !!etape.exemple.delie,
    };
  }
  return etape.config || CONFIG_RELEVE_TUTORIEL;
}

/**
 * Pose une configuration À L'ÉCRAN, champ par champ, exactement comme si on l'avait saisie : c'est
 * ensuite le chemin du bouton de relecture qui l'enregistre et relit le fichier. Tout ce que
 * l'aperçu lit est posé — colonnes, lignes de tête, comparaison des doublons, vocabulaires, compte
 * lié — et pas seulement les colonnes : un vocabulaire ou un nombre de lignes de tête laissé là
 * par l'étape précédente suffisait à mettre la moitié des lignes en erreur.
 */
function poserConfigImportTutoriel({ colonnes, lignesEntete, delie = false }) {
  importConfigColonnes = colonnes
    // Sans l'extension « Monnaies », ces trois colonnes n'existent pas à l'écran.
    .filter(([propriete]) => choixDeMonnaiePossible() || !PROPRIETES_IMPORT_MONNAIE.has(propriete))
    .map(([propriete, index]) => ({ propriete, index }));
  importConfigColonnesDummy = [];
  importConfigColonnesComparaison = [];
  document.getElementById("import-mode-comparaison").value = "exclusion";
  document.getElementById("import-lignes-entete").value = lignesEntete;
  updateResumeLignesEntete();
  renderImportVocabulaires({});
  renderImportConfig();
  renderImportConfigColonnesComparaison();
  // LIÉ AU PREMIER COMPTE (le Compte A de la base de découverte), sauf à l'étape qui en délie le
  // preset. Les deux sens de passage reposent le lien : revenir de cette étape le renoue.
  const premier = comptesProposables()[0];
  renderImportPresetCompte(delie || !premier ? null : premier.id);
  toggleImportCompteDefautBloc();
}

/**
 * Les deux tableaux de l'import (colonnes du fichier, catégories de la banque) ne se montrent que sur
 * les étapes qui les décrivent (`tableau: "detection" | "correspondances"`), et se referment à
 * chaque changement d'étape. Fermer les correspondances applique ce qu'on y a choisi (comme leur
 * croix) : c'est ce qui permet de le retrouver à l'étape suivante.
 */
function fermerTableauxTutoriel() {
  if (typeof detOuvert === "function" && detOuvert()) fermerDetection();
  if (typeof corrOuvert === "function" && corrOuvert()) fermerCorrespondances();
  // Le tableau se range en bas pendant une étape (cf. ouvrirTableauTutoriel) : rendu à son centre.
  document.querySelectorAll(".modale-fond-basse").forEach((f) => f.classList.remove("modale-fond-basse"));
}

async function ouvrirTableauTutoriel(tableau) {
  if (tableau === "detection") await detecterColonnesImport();
  else ouvrirCorrespondances();
  // LE TABLEAU SE RANGE EN BAS : la bulle de l'étape prend le haut de l'écran au lieu de cacher
  // les premières colonnes.
  const fond = document.getElementById(tableau === "detection" ? "modale-detection" : "modale-correspondances");
  if (fond) fond.classList.add("modale-fond-basse");
}

/** Vide l'écran d'import d'un fichier d'exemple (le fichier de l'utilisateur n'est jamais touché). */
async function restaurerImportTutoriel() {
  if (fichierImportEstUnExemple()) reinitialiserImport();
}

let fichierTestTutoriel = null;

/** Le relevé d'exemple de la notice, lu une fois puis gardé. Null s'il n'a pas pu être lu. */
async function chargerFichierTestTutoriel() {
  if (fichierTestTutoriel) return fichierTestTutoriel;
  try {
    const reponse = await fetch(URL_FICHIER_TEST);
    if (!reponse.ok) throw new Error(String(reponse.status));
    fichierTestTutoriel = new File([await reponse.blob()], NOM_FICHIER_TEST, { type: "text/csv" });
    return fichierTestTutoriel;
  } catch (err) {
    showMessage(t("Le relevé d'exemple n'a pas pu être chargé."), "error");
    return null;
  }
}

/** Les correspondances choisies à l'écran (catégories, comptes, monnaies), pour les rendre après relecture. */
function instantaneCorrespondancesImport() {
  return {
    categories: { ...importMappingCategories },
    comptes: { ...importMappingComptes },
    monnaies: { ...importMappingMonnaies },
    confirmees: new Set(importCategoriesConfirmees),
  };
}

function rendreCorrespondancesImport(instantane) {
  if (!importApercu) return;
  Object.assign(importMappingCategories, instantane.categories);
  Object.assign(importMappingComptes, instantane.comptes);
  Object.assign(importMappingMonnaies, instantane.monnaies);
  instantane.confirmees.forEach((nom) => importCategoriesConfirmees.add(nom));
  renderImportMappings();
  appliquerMappingsLocalement();
  renderImportApercu();
}

/**
 * PRÉPARE L'ÉCRAN D'IMPORT POUR UNE ÉTAPE, dans un sens comme dans l'autre : le fichier de
 * l'étape, sa configuration, puis LA ROUTE DU BOUTON DE RELECTURE (enregistrer le preset, relire
 * le fichier). Rien n'est gardé de l'étape d'avant : ce qu'on y a déplacé, réglé ou retouché
 * appartenait à son exemple.
 *
 * ON ÉCRIT DANS LE PRESET, et c'est permis ici seulement : le parcours se suit sur la base de
 * découverte (cf. `baseDecouverte`), dont l'unique preset n'appartient à personne. Hors
 * découverte, rien n'est écrit.
 *
 * Rend { charge } : faux quand l'utilisateur garde SON fichier plutôt que celui de l'étape.
 */
async function appliquerEtapeImport(etape, index) {
  if (!tutorielSurBaseDecouverte) return { charge: false };
  // La page Import qui vient de s'ouvrir finit d'abord de charger son preset.
  await importSectionEnChargement.catch(() => {});
  let fichier = null;
  let nomAffiche = null;
  if (etape.exemple) {
    fichier = new File([csvExempleTutoriel(etape.exemple)], `${PREFIXE_FICHIER_EXEMPLE}${index + 1}.csv`, {
      type: "text/csv",
    });
    nomAffiche = t(etape.exemple.titre);
  } else if (etape.fichierTest) {
    fichier = await chargerFichierTestTutoriel();
    if (!fichier) return { charge: false };
    nomAffiche = "releve-exemple.csv";
  }

  // UN FICHIER DÉPOSÉ PAR L'UTILISATEUR n'est remplacé qu'après accord ; refusé, l'étape le laisse
  // tel quel, configuration comprise.
  const fichierUtilisateur =
    importApercu && importApercu.lignes.length > 0 && importFichierActuel && !fichierImportEstUnExemple();
  if (
    fichier &&
    fichierUtilisateur &&
    !confirm(
      t("Le tutoriel va afficher un fichier d'exemple à la place de celui que tu as chargé (rien n'a été importé). Continuer ?")
    )
  ) {
    return { charge: false };
  }

  // LES CORRESPONDANCES SURVIVENT À UN MÊME FICHIER RELU : les catégories rattachées à l'étape 18
  // doivent l'être encore à l'étape 19, où l'on confirme.
  const memeFichier = !!(fichier && importFichierActuel && importFichierActuel.name === fichier.name);
  const correspondances = memeFichier ? instantaneCorrespondancesImport() : null;

  if (fichier) {
    // Le fichier de l'étape, repris de zéro : ni retouche de ligne, ni doublon décoché.
    reinitialiserImport();
    importFichierActuel = fichier;
    document.getElementById("import-fichier-nom").textContent = nomAffiche;
  } else if (fichierImportEstUnExemple()) {
    reinitialiserImport();
  }

  poserConfigImportTutoriel(configEtapeImport(etape));
  // Les réglages de lecture repartent de la détection automatique : c'est elle que l'étape des
  // délimiteurs montre en échec, et elle seule qui doit l'être.
  reinitialiserReglagesLecture();
  lireReglagesLecture();
  const configurationOuverte = document.getElementById("import-config-fichier").open;
  await enregistrerConfigurationImport({ relireToujours: true, message: null });
  if (correspondances) rendreCorrespondancesImport(correspondances);
  if (etape.sansAlerteLecture) {
    // Ce que la relecture a déplié pour l'alerte du délimiteur est replié comme avant.
    document.getElementById("import-reglages-lecture-alerte").style.display = "none";
    document.getElementById("import-reglages-lecture").open = false;
    document.getElementById("import-config-fichier").open = configurationOuverte;
  }
  return { charge: !!fichier };
}

/* ---------- Les parcours ----------
 *
 * UNE ÉTAPE DÉCRIT UN ENDROIT, PAS UN CLIC À FORCER. `cible` est l'élément à
 * allumer ; `avant` prépare l'écran quand il faut y être pour voir quelque chose
 * (ouvrir l'onglet Import, déplier un bloc replié) ; `siMasque` remplace le halo
 * quand l'élément n'existe pas encore — la moitié de l'écran d'import n'apparaît
 * qu'une fois un fichier lu, et pointer un rectangle vide n'apprend rien.
 */

/* ---------- Se placer sur la bonne page ----------
 *
 * CHAQUE ÉTAPE DIT SUR QUELLE PAGE ELLE SE LIT (`page`), et une étape qui n'en
 * dit rien hérite de la plus proche qui précède (cf. pageEffective). Sans cela,
 * « Précédent » depuis la première étape d'une page laissait l'écran de la page
 * suivante, l'étape d'avant n'ayant aucune consigne de page : on ne voyait plus
 * ce que la bulle décrivait, et il fallait remonter jusqu'à la première étape de
 * cette page pour y revenir. Dans l'autre sens, un « Suivant » qui saute à
 * une étape d'une autre page y emmène de la même façon.
 *
 * IDEMPOTENT : ne change rien quand on y est déjà, pour ne pas relire les
 * données de la page (et défaire ce qu'on y a déplié) à chaque étape. Rend true
 * quand la page a changé. */
function surPage(section, sousSection = null) {
  const hote = document.getElementById(`section-${section}`);
  const volet = sousSection ? document.getElementById(`sous-section-${sousSection}`) : null;
  const dejaLa =
    hote &&
    hote.classList.contains("active") &&
    (!sousSection || (volet && volet.classList.contains("active")));
  if (dejaLa) return false;
  switchSection(section, sousSection ? { sousSection } : {});
  return true;
}

const PAGE_DASHBOARD = () => surPage("dashboard");
const PAGE_OPERATIONS = () => surPage("operations", "classique");
const PAGE_CONFIGURATION = () => surPage("parametres", "parametres-configuration");
const PAGE_PARAMETRES_GENERAUX = () => surPage("parametres", "parametres-generaux");
const PAGE_EXTENSIONS = () => surPage("parametres", "parametres-extensions");

/* CE QU'UNE ÉTAPE OUVRE POUR S'ILLUSTRER, ET QU'ELLE REFERME EN PARTANT.
 *
 * Le tutoriel ne laisse rien derrière lui (cf. l'en-tête) : un volet déplié ou un
 * formulaire ouvert pour une étape est rangé dès qu'on passe à une étape qui n'en
 * a pas besoin. `ouvre` désigne une entrée de ce tableau ; deux étapes
 * consécutives qui la demandent toutes deux ne la referment pas entre elles. */
const OUVERTURES_TUTORIEL = {
  filtres: {
    ouvrir: () => {
      const volet = document.getElementById("filtres-repli-classique");
      if (!volet || volet.open) return null;
      volet.open = true;
      return () => {
        volet.open = false;
      };
    },
  },
  formulaire: {
    ouvrir: () => {
      const formulaire = document.getElementById("form-operation");
      if (formulaire && formulaire.parentNode.id === "operations-form-classique") return null;
      document.querySelector(".ajouter-operation[data-onglet='classique']")?.click();
      return () => {
        resetOperationForm();
        fermerFormulaireOperation();
      };
    },
  },
};
// Ce qui est ouvert en ce moment : { cle: fonction qui le referme }.
let tutorielOuvertures = {};

function ajusterOuverturesTutoriel(cleVoulue) {
  Object.keys(tutorielOuvertures).forEach((cle) => {
    if (cle === cleVoulue) return;
    tutorielOuvertures[cle]();
    delete tutorielOuvertures[cle];
  });
  if (cleVoulue && !tutorielOuvertures[cleVoulue]) {
    const defaire = OUVERTURES_TUTORIEL[cleVoulue].ouvrir();
    if (defaire) tutorielOuvertures[cleVoulue] = defaire;
  }
}

/* LE PARCOURS « PRENDRE L'APPLICATION EN MAIN ».
 *
 * Il se lit sur une base de DÉCOUVERTE (cf. `baseDecouverte` dans TUTORIELS) :
 * des comptes, des dépenses, des entrées et des virements fabriqués pour que
 * chaque phrase ait un chiffre à montrer.
 *
 * Les textes vivent dans textes.js (`noyau.tuto-pem-<étape>`, « 3-1 » pour 3.1).
 * UN GROUPE PARTAGE UN EN-TÊTE : « 3 », « 3.1 » et « 3.2 » portent le même titre,
 * posé une fois. Les numéros sont ceux que les textes citent (« étape 8.2 du
 * tutoriel ») et s'affichent dans la bulle. */
function etapesDecouverte() {
  const groupe = (titre, etapes) =>
    etapes.map(([numero, cle, cible, extra = {}]) => ({
      numero,
      titre,
      cible,
      texte: texteAide(`noyau.tuto-pem-${cle}`),
      ...extra,
    }));

  const periode = "#section-dashboard .periode-selecteur";
  const cartes = "#section-dashboard .flux-periode .flux-carte";
  return [
    ...groupe("Quatre écrans, et c'est tout", [
      ["1", "1", "header nav", { page: PAGE_DASHBOARD }],
    ]),
    ...groupe("Ce que tu possèdes aujourd'hui", [
      ["2", "2", "#section-dashboard .kpi-grid", { page: PAGE_DASHBOARD }],
    ]),
    ...groupe("Le choix de la période", [
      ["3", "3", periode, { page: PAGE_DASHBOARD }],
      ["3.1", "3-1", "#section-dashboard .periode-pastille"],
      ["3.2", "3-2", periode],
    ]),
    ...groupe("Les cartes de la période", [
      ["4", "4", "#section-dashboard .flux-periode"],
      ["4.1", "4-1", `${cartes}:nth-child(1), ${cartes}:nth-child(2)`],
      ["4.2", "4-2", `${cartes}:nth-child(3), ${cartes}:nth-child(4)`],
      [
        "4.3",
        "4-3",
        "#flux-ecart-actions",
        { attente: true, siMasque: texteAide("noyau.tuto-pem-4-3-masque") },
      ],
    ]),
    ...groupe("Les deux graphiques", [
      ["5.1", "5-1", "#section-dashboard .dashboard-graphes"],
      ["5.2", "5-2", "#section-dashboard .dashboard-graphes"],
    ]),
    ...groupe("La page Opérations !", [
      ["6", "6", "#operations-sous-nav", { page: PAGE_OPERATIONS }],
    ]),
    ...groupe("Les filtres", [
      [
        "7",
        "7",
        "#filtres-repli-classique",
        // Dépliés, les filtres sont hauts : la bulle se pose au-dessus plutôt que
        // sur leurs premiers champs.
        { page: PAGE_OPERATIONS, ouvre: "filtres", placement: "dessus", defilement: "end" },
      ],
    ]),
    ...groupe("Propriétés spéciales d'une opération", [
      // La bulle se pose AU-DESSUS du bouton : le formulaire s'ouvre juste en dessous.
      [
        "8.1",
        "8-1",
        ".ajouter-operation[data-onglet='classique']",
        { page: PAGE_OPERATIONS, ouvre: "formulaire", placement: "dessus" },
      ],
      [
        "8.2",
        "8-2",
        ".ajouter-operation[data-onglet='classique']",
        { ouvre: "formulaire", placement: "dessus" },
      ],
    ]),
    ...groupe("La configuration de ton app : tes comptes, catégories & monnaies", [
      ["9", "9", "#comptes-liste", { page: PAGE_CONFIGURATION }],
      ["9.1", "9-1", "#configuration-partie-categories"],
      ["9.2", "9-2", "#configuration-partie-comptes"],
    ]),
    ...groupe("Les paramètres pour contrôler la logique", [
      ["10.1", "10-1", "#parametres-sous-nav-droite", { page: PAGE_PARAMETRES_GENERAUX }],
      ["10.2", "10-2", "#parametres-partie-bdd"],
    ]),
    ...groupe("Le système d'extensions", [
      ["11.1", "11-1", "#extensions-liste", { page: PAGE_EXTENSIONS }],
      [
        "11.2",
        "11-2",
        "#extensions-liste .extension-carte .extension-entete",
        { premier: true, attente: true },
      ],
    ]),
    ...groupe("Et la suite ?", [
      ["12", "12", "#tutoriels-liste", { page: PAGE_PARAMETRES_GENERAUX }],
    ]),
  ];
}

const TUTORIEL_DECOUVERTE = etapesDecouverte();

/* LE PARCOURS « IMPORTER UN RELEVÉ ». Les textes vivent dans textes.js
 * (`noyau.tuto-import-<étape>`, « 2-1 » pour 2.1) ; les numéros sont ceux de la bulle, et le
 * texte du compte bancaire cite « l'étape 2.2 ».
 *
 * IL SE LIT SUR LA BASE DE DÉCOUVERTE DE L'IMPORT (cf. base_decouverte.remplir_import) : deux
 * comptes, les catégories livrées, et un seul preset, lié au Compte A. Sur la base de
 * l'utilisateur, ce sont SES presets qui lisaient les fichiers du tutoriel — et aucun ne les
 * décrivait.
 *
 * TROIS FAÇONS DE MONTRER UN FICHIER, selon l'étape :
 *   - rien (étapes 1 à 3) : l'écran est vide, ou vidé s'il montrait un exemple ;
 *   - `fichierTest` : le relevé d'exemple de la notice — c'est lui qui sert à tout le reste
 *     du tutoriel ;
 *   - `exemple` : un fichier dessiné pour un cas (colonnes secondaires, délimiteur), avec sa
 *     configuration.
 *
 * CHAQUE PASSAGE D'ÉTAPE, dans un sens comme dans l'autre, recharge le fichier de l'étape, pose
 * sa configuration (`config`, celle du relevé par défaut — cf. configEtapeImport) et relit le
 * fichier par la route du bouton de relecture (cf. appliquerEtapeImport). */
const T_IMPORT = (cle) => texteAide(`noyau.tuto-import-${cle}`);

const TUTORIEL_IMPORT = [
  {
    numero: "1",
    cible: "#parametres-sous-nav",
    titre: "Tout savoir sur l'import",
    texte: T_IMPORT("1"),
    page: () => surPage("parametres", "parametres-import"),
  },
  {
    numero: "2.1",
    cible: "#import-preset-chips",
    titre: "Les presets",
    texte: T_IMPORT("2-1"),
  },
  {
    numero: "2.2",
    cible: "#import-preset-compte",
    titre: "Les presets",
    texte: T_IMPORT("2-2"),
  },
  {
    numero: "3",
    cible: "#import-dropzone",
    titre: "Le fichier",
    texte: T_IMPORT("3"),
    // UN BOUTON TOUT À GAUCHE DE LA BULLE : le relevé d'exemple, pour qui ne l'a pas encore.
    telechargement: { url: URL_FICHIER_TEST, nom: "releve-exemple.csv" },
  },
  {
    numero: "4",
    cible: "#import-apercu-bloc",
    titre: "L'aperçu, ligne par ligne",
    texte: T_IMPORT("4"),
    fichierTest: true,
    // L'aperçu fait plusieurs écrans de haut : on montre son début, pas son milieu.
    defilement: "start",
    siMasque: "L'aperçu apparaît une fois le fichier lu.",
  },
  {
    numero: "5",
    cible: "#import-apercu-fichier-bloc",
    titre: "Le fichier vu par l'app",
    texte: T_IMPORT("5"),
    fichierTest: true,
    // Les champs en face des mauvaises colonnes : c'est ce que l'étape apprend à corriger.
    config: CONFIG_RELEVE_DATE_DECALEE,
    sansAlerteLecture: true,
    siMasque:
      "Ce tableau apparaît dès qu'un fichier est déposé : reviens à cette étape à ce moment-là.",
  },
  {
    numero: "6",
    cible: "#import-config-colonnes",
    titre: "Les colonnes lues",
    texte: T_IMPORT("6"),
    fichierTest: true,
    config: CONFIG_RELEVE_DESORDONNEE,
    avant: () => deplierBloc("#import-config-fichier"),
  },
  {
    numero: "7",
    cible: "#import-config-avancee",
    titre: "Les champs secondaires",
    texte: T_IMPORT("7"),
    fichierTest: true,
    avant: () => {
      deplierBloc("#import-config-fichier");
      deplierBloc("#import-config-avancee");
    },
  },
  {
    numero: "8",
    cible: "#import-config-colonnes-avancees",
    titre: "Le champ Compte bancaire",
    texte: T_IMPORT("8"),
    exemple: EXEMPLE_COMPTE_BANQUE,
  },
  {
    numero: "9",
    cible: "#import-config-colonnes-avancees",
    titre: "Le champ Sens",
    texte: T_IMPORT("9"),
    exemple: EXEMPLE_SENS,
  },
  {
    numero: "10",
    cible: "#import-config-colonnes-avancees",
    titre: "Montant au débit et Montant au crédit",
    texte: T_IMPORT("10"),
    exemple: EXEMPLE_MONTANT_SCINDE,
  },
  {
    numero: "11",
    cible: "#import-config-colonnes-avancees",
    titre: "Montant envoyé, Montant reçu & Frais",
    texte: T_IMPORT("11"),
    exemple: EXEMPLE_WISE,
  },
  {
    numero: "12",
    cible: "#import-config-colonnes-avancees",
    titre: "État",
    texte: T_IMPORT("12"),
    exemple: EXEMPLE_STATUT,
  },
  {
    numero: "13",
    cible: "#import-config-doublons",
    titre: "La comparaison des doublons",
    texte: T_IMPORT("13"),
    fichierTest: true,
    avant: () => {
      deplierBloc("#import-config-fichier");
      deplierBloc("#import-config-doublons");
    },
  },
  {
    numero: "14",
    cible: "#import-config-lignes-ignorees",
    titre: "Les lignes à ne pas importer",
    texte: T_IMPORT("14"),
    fichierTest: true,
    avant: () => {
      deplierBloc("#import-config-fichier");
      deplierBloc("#import-config-lignes-ignorees");
    },
  },
  {
    numero: "15",
    cible: "#import-reglages-lecture",
    titre: "Les réglages de lecture",
    texte: T_IMPORT("15"),
    // Un fichier que la détection lit mal : le panneau se déplie de lui-même, alerte comprise.
    exemple: EXEMPLE_DELIMITEUR,
    garderCible: true,
    // Le panneau déplié est haut, alerte comprise : en bas de l'écran, la bulle se pose au-dessus
    // sans le cacher.
    defilement: "end",
    placement: "dessus",
    avant: () => {
      deplierBloc("#import-config-fichier");
      deplierBloc("#import-reglages-lecture");
    },
  },
  {
    numero: "16.1",
    cible: "#btn-import-config-enregistrer",
    titre: "Enregistrer la configuration",
    texte: T_IMPORT("16-1"),
    fichierTest: true,
    avant: () => deplierBloc("#import-config-fichier"),
  },
  {
    numero: "16.2",
    // La bulle se centre sur le bouton de relecture, petit et posé à gauche du tableau.
    cible: "#btn-import-apercu-relire",
    titre: "Enregistrer la configuration",
    texte: T_IMPORT("16-2"),
    placement: "centre",
    fichierTest: true,
    siMasque:
      "Ce bouton apparaît au-dessus du tableau du fichier, donc une fois un fichier lu.",
  },
  {
    numero: "17.1",
    cible: "#btn-import-detecter",
    titre: "Deviner les colonnes",
    texte: T_IMPORT("17-1"),
    fichierTest: true,
    siMasque:
      "Ce bouton apparaît au-dessus du tableau du fichier, donc une fois un fichier lu.",
  },
  {
    numero: "17.2",
    // LE TABLEAU DES COLONNES, ouvert par l'étape : le même que celui des catégories (étape 18.2).
    cible: "#modale-detection .modale",
    titre: "Le tableau des colonnes",
    texte: T_IMPORT("17-2"),
    fichierTest: true,
    tableau: "detection",
    placement: "dessus",
    discret: true,
  },
  {
    numero: "18.1",
    cible: "#import-mappings-bloc",
    titre: "La correspondance des catégories",
    texte: T_IMPORT("18-1"),
    // LE RELEVÉ LUI-MÊME : sur la base de découverte, aucune de ses catégories bancaires n'est
    // encore rattachée, et ce qu'on y rattache ici sert à confirmer l'import à l'étape suivante.
    fichierTest: true,
    siMasque:
      "Ce bloc n'apparaît que si le fichier apporte des catégories, des comptes ou des devises inconnus.",
  },
  {
    numero: "18.2",
    // LE TABLEAU DES CATÉGORIES, ouvert par l'étape.
    cible: "#modale-correspondances .modale",
    titre: "Le tableau des catégories",
    texte: T_IMPORT("18-2"),
    fichierTest: true,
    tableau: "correspondances",
    placement: "dessus",
    siMasque:
      "Ce tableau ne s'ouvre que si le fichier apporte des catégories bancaires inconnues.",
  },
  {
    numero: "19",
    cible: "#btn-import-confirmer",
    titre: "Confirmer",
    texte: T_IMPORT("19"),
    fichierTest: true,
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
    page: () => surPage("parametres", "parametres-correspondances"),
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
    cible: "#regle-groupes",
    titre: "La note du relevé",
    texte: texteAide("regles.tuto-notes"),
    avant: ouvrirEditeurRegleTutoriel,
  },
  {
    cible: "#regle-type",
    titre: "Ce qu'elle fait",
    texte: texteAide("regles.tuto-action"),
    avant: ouvrirEditeurRegleTutoriel,
  },
  {
    // Le menu et non un champ : les champs ne s'affichent qu'une fois posés.
    cible: "#regle-autres-ajout",
    titre: "Et le reste de la ligne",
    texte: texteAide("regles.tuto-autres"),
    avant: ouvrirEditeurRegleTutoriel,
  },
  {
    cible: "#regle-autres-ajout",
    titre: "Un champ à la fois",
    texte: texteAide("regles.tuto-ajout-champ"),
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
    page: () => surPage("parametres", "parametres-correspondances"),
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
    // SE LIT SUR UNE BASE FABRIQUÉE (cf. basculerDecouverte), même si l'utilisateur
    // a déjà des données : on ne lui montre pas ses finances, et ses chiffres
    // n'illustreraient pas la phrase qu'on lit.
    baseDecouverte: true,
  },
  {
    id: "import",
    nom: "Importer un relevé",
    resume:
      "Régler un preset de bout en bout, colonnes secondaires comprises — avec, à chaque colonne, l'extrait de relevé qui la rend nécessaire.",
    etapes: TUTORIEL_IMPORT,
    // SUR SA PROPRE BASE (cf. base_decouverte.remplir_import) : un seul preset, réglé pour les
    // fichiers que le parcours montre, et qu'il peut réécrire à chaque étape.
    baseDecouverte: true,
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

    // LE NUMÉRO QUE LA BULLE AFFICHE (« 3.2 / 12 »), pas le rang dans la liste à
    // plat : les sous-étapes ne comptent pas à part.
    const rang = Math.min(etape, total - 1);
    const principal = totalEtapes(parcours);
    const etatTexte = termine
      ? t("Terminé")
      : commence
        ? `${t("Étape")} ${libelleEtape(parcours, rang)} / ${principal}`
        : `${t("Pas encore commencé")} · ${principal} ${t("étapes")}`;

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

/**
 * La page d'une étape : la sienne, ou celle de la plus proche qui précède.
 * C'est ce qui rend « Précédent » et « Suivant » sûrs d'atterrir sur le bon
 * écran quelle que soit l'étape d'où l'on vient (cf. surPage).
 */
function pageEffective(parcours, index) {
  for (let i = index; i >= 0; i--) {
    if (parcours.etapes[i].page) return parcours.etapes[i].page;
  }
  return null;
}

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Les éléments VISIBLES qu'une étape désigne (le premier seulement si `premier`). */
function ciblesEtape(selecteur, premier = false) {
  const visibles = [...document.querySelectorAll(selecteur)].filter(
    (el) => el.offsetParent !== null
  );
  return premier ? visibles.slice(0, 1) : visibles;
}

/** « 3.2 » pour une étape numérotée, son rang sinon. */
function libelleEtape(parcours, index) {
  return parcours.etapes[index]?.numero || String(index + 1);
}

/** Le nombre d'étapes PRINCIPALES : « 3.1 » et « 3.2 » ne comptent pas à part de « 3 ». */
function totalEtapes(parcours) {
  const numeros = parcours.etapes.map((e) => e.numero).filter(Boolean);
  if (numeros.length === 0) return parcours.etapes.length;
  return new Set(numeros.map((n) => String(n).split(".")[0])).size;
}

/**
 * La croix de la bulle (et Échap) ne quitte pas d'un geste : on est peut-être
 * à l'étape 9 sur 12, et la progression ne se retrouve qu'en le sachant.
 */
function demanderSortieTutoriel() {
  if (confirm(t(texteAide("noyau.tuto-sortie")))) arreterTutoriel();
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
    if (bouton.dataset.tutoriel === "fin") demanderSortieTutoriel();
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
 * élément situé en bas de page. `placement: "dessus"` la veut au-dessus d'office
 * (le formulaire d'ajout d'une opération s'ouvre juste sous son bouton : la bulle
 * dessous le cacherait).
 */
function placerBulleTutoriel(bulle, cible, placement = null) {
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
  let haut;
  if (placement === "dessus") {
    haut = Math.max(marge, rect.top - hauteur - marge);
  } else {
    haut = rect.bottom + marge;
    if (haut + hauteur > window.innerHeight - marge) {
      haut = Math.max(marge, rect.top - hauteur - marge);
    }
  }
  // `placement: "centre"` : la bulle se centre sur sa cible (un petit bouton), au lieu de
  // s'aligner sur son bord gauche.
  const aligne = placement === "centre" ? rect.left + rect.width / 2 - largeur / 2 : rect.left;
  const gauche = Math.min(Math.max(marge, aligne), window.innerWidth - largeur - marge);
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
    arreterTutoriel({ message: `${t("Tutoriel terminé :")} ${t(parcours.nom)}` });
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
  if (parcours.id === "import") fermerTableauxTutoriel();

  // LA PAGE D'ABORD, puis ce que l'étape y ouvre : un formulaire ne s'ouvre pas
  // sur un écran qu'on n'affiche pas encore. Un écran qui vient de changer de
  // page, ou qui attend ses données, se laisse un instant pour les lire.
  const page = pageEffective(parcours, index);
  const pageChangee = page ? page() === true : false;
  if (pageChangee || etape.attente) {
    await pause(pageChangee ? 450 : 350);
    if (jeton !== tutorielJeton) return;
  }
  ajusterOuverturesTutoriel(etape.ouvre || null);
  if (etape.avant) etape.avant();

  // LE PARCOURS D'IMPORT REPOSE SON FICHIER ET SA CONFIGURATION à chaque étape, puis relit
  // (cf. appliquerEtapeImport). Un exemple se montre dans l'aperçu du fichier, et c'est lui que
  // la bulle désigne alors : le réglage dont parle l'étape se lit en regardant ses colonnes.
  let exempleCharge = false;
  let selecteurCible = etape.cible;
  if (parcours.id === "import") {
    const { charge } = await appliquerEtapeImport(etape, index);
    if (jeton !== tutorielJeton) return;
    exempleCharge = charge && !!etape.exemple;
    if (exempleCharge && !etape.garderCible) selecteurCible = "#import-apercu-fichier-bloc";
    // La relecture a pu déplier ou replier des blocs : l'étape rouvre les siens.
    if (etape.avant) etape.avant();
    if (etape.tableau) {
      await ouvrirTableauTutoriel(etape.tableau);
      if (jeton !== tutorielJeton) return;
    }
  }

  const cibles = ciblesEtape(selecteurCible, etape.premier && !exempleCharge);
  // UN BLOC MASQUÉ N'EST PAS UNE ERREUR : la moitié de l'écran d'import
  // n'existe qu'une fois un fichier lu. On le dit plutôt que de pointer un
  // rectangle vide — ou, pire, de refuser d'avancer.
  const visible = cibles.length > 0;
  if (visible) {
    cibles.forEach((el) => el.classList.add("tutoriel-cible"));
    cibles[0].scrollIntoView({ behavior: "smooth", block: etape.defilement || "center" });
  }

  const bulle = bulleTutoriel();
  bulle.innerHTML = `
    <div class="tutoriel-entete">
      <span class="tutoriel-compteur">${escapeHtml(libelleEtape(parcours, index))} / ${totalEtapes(parcours)}</span>
      <span class="tutoriel-parcours">${escapeHtml(t(parcours.nom))}</span>
      <button type="button" class="tutoriel-fermer" data-tutoriel="fin"
              title="${t("Quitter le tutoriel")}" aria-label="${t("Quitter le tutoriel")}">&times;</button>
    </div>
    <h4>${escapeHtml(t(etape.titre))}</h4>
    <div class="tutoriel-texte"></div>
    ${etape.discret ? "" : exempleTutorielHtml(etape.exemple, exempleCharge)}
    ${
      !visible && etape.siMasque
        ? `<p class="hint">${escapeHtml(t(etape.siMasque))}</p>`
        : ""
    }
    <div class="tutoriel-actions">
      ${
        etape.telechargement
          ? `<a class="bouton-lien tutoriel-telecharger" href="${escapeHtml(etape.telechargement.url)}"
               download="${escapeHtml(etape.telechargement.nom)}">${t("Télécharger le fichier")}</a>`
          : ""
      }
      <button type="button" data-tutoriel="precedent" ${index === 0 ? "disabled" : ""}>${t(
        "Précédent"
      )}</button>
      <button type="button" class="primary" data-tutoriel="suivant">${
        index === parcours.etapes.length - 1 ? t("Terminer") : t("Suivant")
      }</button>
    </div>`;
  // LE TEXTE S'ÉCRIT EN NŒUDS (puces, sauts de ligne, gras, liens : cf. textes.js,
  // ecrireTexteAide), jamais en HTML. Une phrase sans marqueur reste un simple texte.
  const zoneTexte = bulle.querySelector(".tutoriel-texte");
  const texte = t(etape.texte);
  if (texteAMarqueurs(texte)) ecrireTexteAide(zoneTexte, texte);
  else zoneTexte.textContent = texte;
  bulle.style.display = "";
  // APRÈS le rendu : la hauteur de la bulle dépend du texte qu'on vient d'y
  // écrire, et la placer avant la mesurerait vide.
  placerBulleTutoriel(bulle, visible ? cibles[0] : null, etape.placement);
}

/* ---------- La base de découverte ----------
 *
 * LES PARCOURS « PRENDRE L'APPLICATION EN MAIN » ET « IMPORTER UN RELEVÉ » SE
 * LISENT SUR UNE BASE FABRIQUÉE (cf. backend/app/services/base_decouverte.py),
 * chacun sur la sienne, même quand l'utilisateur a déjà des données : ses
 * chiffres n'illustreraient pas la phrase qu'on lit, ses presets ne liraient pas
 * les fichiers du tutoriel, et il n'y a aucune raison de lui faire passer ses
 * finances sous une bulle.
 *
 * LE SERVEUR EST LA SEULE MÉMOIRE DE « SUIS-JE DESSUS ? ». Entrer et sortir
 * rechargent la page, parce que tout ce que l'écran a chargé (comptes, soldes,
 * période) appartient à l'autre base. Au rechargement, `reprendreDecouverte`
 * relit l'état du serveur : si la découverte est toujours active, le parcours
 * repart de l'étape où il en était. C'est ce qui rend sûre une page rechargée ou
 * fermée en plein tutoriel — on ne reste jamais coincé sur la base fabriquée sans
 * la bulle qui permet d'en sortir.
 */
const CLE_SORTIE_DECOUVERTE = "budget-app.tutoriel-sortie";

// Vrai quand le serveur a confirmé être sur la base de découverte du parcours en cours : c'est la
// condition pour que le parcours d'import écrive dans le preset (cf. appliquerEtapeImport).
let tutorielSurBaseDecouverte = false;

/**
 * Vrai si la découverte du parcours `id` est (déjà) active. Sinon la prépare et recharge la
 * page : rend false. CHAQUE PARCOURS A SA BASE : être sur celle d'un autre ne suffit pas.
 */
async function entrerDecouverte(id) {
  try {
    const etat = await apiFetch("/tutoriel/decouverte");
    if (etat.actif && etat.parcours === id) {
      tutorielSurBaseDecouverte = true;
      return true;
    }
    await apiFetch(`/tutoriel/decouverte/entrer?parcours=${encodeURIComponent(id)}`, { method: "POST" });
    window.location.reload();
    return false;
  } catch (err) {
    showMessage(err.message, "error");
    return false;
  }
}

/** Rejoint la base d'avant, puis recharge la page. `message` s'affiche une fois revenu. */
async function quitterDecouverte(message) {
  try {
    const etat = await apiFetch("/tutoriel/decouverte");
    if (etat.actif) await apiFetch("/tutoriel/decouverte/quitter", { method: "POST" });
  } catch (err) {
    showMessage(err.message, "error");
    return;
  }
  try {
    sessionStorage.setItem(CLE_SORTIE_DECOUVERTE, JSON.stringify({ message: message || null }));
  } catch (err) {
    // Stockage indisponible : on revient sur sa base sans message, rien de cassé.
  }
  window.location.reload();
}

/**
 * Au chargement de la page : si le serveur est sur la base de découverte, le
 * parcours reprend là où il en était ; si l'on vient d'en sortir, on revient sur
 * l'écran des tutoriels avec le message de sortie.
 */
async function reprendreDecouverte() {
  // Après le démarrage de l'application : les écrans qu'on va ouvrir ne sont
  // prêts qu'une fois ses premières lectures faites.
  if (BudgetApp.pret) {
    try {
      await BudgetApp.pret;
    } catch (err) {
      return;
    }
  }
  let sortie = null;
  try {
    sortie = JSON.parse(sessionStorage.getItem(CLE_SORTIE_DECOUVERTE) || "null");
    sessionStorage.removeItem(CLE_SORTIE_DECOUVERTE);
  } catch (err) {
    sortie = null;
  }
  if (sortie) {
    switchSection("parametres", { sousSection: "parametres-generaux" });
    if (sortie.message) showMessage(sortie.message, "success");
  }
  let etat;
  try {
    etat = await apiFetch("/tutoriel/decouverte");
  } catch (err) {
    return;
  }
  if (!etat.actif) return;
  // LE PARCOURS QUE LE SERVEUR A NOTÉ en fabriquant la base : deux parcours s'y lisent.
  const parcours = TUTORIELS.find((p) => p.baseDecouverte && p.id === etat.parcours);
  if (!parcours) return;
  tutorielParcours = parcours;
  tutorielActif = true;
  tutorielSurBaseDecouverte = true;
  const { etape } = progressionDe(parcours.id);
  allerEtapeTutoriel(Math.min(etape, parcours.etapes.length - 1));
}

/**
 * `reprendre: true` repart là où on s'était arrêté ; `false` repart de zéro.
 *
 * Un parcours TERMINÉ qu'on rouvre repart du DÉBUT : « Revoir » ne veut pas dire
 * « relire la dernière étape », et laisser la bulle s'ouvrir sur la conclusion
 * d'un tutoriel qu'on vient de choisir de recommencer n'aurait aucun sens.
 */
async function demarrerTutoriel(id, { reprendre = true } = {}) {
  const parcours = tutorielParId(id);
  if (!parcours) return;
  const { etape, termine } = progressionDe(id);
  if (!reprendre || termine) noterProgression(id, { etape: 0, termine: false });
  // La progression est écrite AVANT le rechargement qu'entraîne la base de
  // découverte : c'est elle que `reprendreDecouverte` relira.
  if (parcours.baseDecouverte && !(await entrerDecouverte(parcours.id))) return;
  tutorielParcours = parcours;
  tutorielActif = true;
  allerEtapeTutoriel(reprendre && !termine ? Math.min(etape, parcours.etapes.length - 1) : 0);
}

/**
 * Ferme le tutoriel. `message` s'affiche à la fin (« Tutoriel terminé »). Sur la
 * base de découverte, la sortie rejoint la base d'avant et recharge la page :
 * le message attend alors le rechargement (cf. reprendreDecouverte).
 */
async function arreterTutoriel({ message = null } = {}) {
  const parcours = tutorielParcours;
  tutorielActif = false;
  tutorielSurBaseDecouverte = false;
  tutorielJeton++;
  eteindreCibleTutoriel();
  fermerTableauxTutoriel();
  // Ce que le tutoriel avait ouvert pour s'illustrer se referme avec lui.
  ajusterOuverturesTutoriel(null);
  // L'EXEMPLE REPART AVEC LE TUTORIEL : un relevé qui n'existe pas ne doit pas
  // rester dans l'écran d'import. Un fichier déposé par l'utilisateur, lui, n'est
  // jamais touché ici.
  await restaurerImportTutoriel();
  const bulle = document.getElementById("tutoriel-bulle");
  if (bulle) bulle.style.display = "none";
  if (parcours && parcours.baseDecouverte) {
    await quitterDecouverte(message);
  } else if (message) {
    showMessage(message, "success");
  }
}

// La bulle est en position fixe : elle doit suivre ce qu'elle désigne quand la
// page bouge sous elle, sinon elle finit par pointer autre chose.
["scroll", "resize"].forEach((evenement) => {
  window.addEventListener(
    evenement,
    () => {
      if (!tutorielActif || !tutorielParcours) return;
      const etape = tutorielParcours.etapes[tutorielEtape];
      const surExemple = etape.exemple && !etape.garderCible && fichierImportEstUnExemple();
      const cibles = ciblesEtape(
        surExemple ? "#import-apercu-fichier-bloc" : etape.cible,
        !surExemple && etape.premier
      );

      placerBulleTutoriel(bulleTutoriel(), cibles[0] || null, etape.placement);
    },
    { passive: true }
  );
});

// Échap ferme le tutoriel, comme toute chose ouverte par-dessus l'application —
// après confirmation, comme la croix. La progression est déjà écrite : on
// reprendra exactement ici.
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && tutorielActif) demanderSortieTutoriel();
});

chargerProgressionTutoriels();
renderTutorielsParametres();
reprendreDecouverte();
