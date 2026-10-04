/* ---------- Extension « Objectifs » ----------
 *
 * Les règles qu'on se donne et que le budget ne sait pas écrire. Ce fichier
 * s'exécute dans la portée globale de la page, après l'injection de page.html :
 * tout ce que app.js expose lui est accessible (apiFetch, state, t,
 * showMessage, formatMontant, formatPourcentage, escapeHtml, fillSelect,
 * MOIS_COURTS_FR…), et les éléments sur lesquels il pose ses écouteurs existent
 * déjà.
 *
 * DEUX ENDROITS POUR UNE MÊME LECTURE, et c'est tout le sujet de ce fichier :
 *
 *   - L'ONGLET « Objectifs » de la page Budget, où on les CRÉE et où on les
 *     regarde tous, sur la période qu'on y choisit ;
 *   - LE DASHBOARD, où ceux qu'on a cochés se posent sous les deux graphes, sur
 *     la période que le sélecteur affiche. C'est là qu'un objectif sert : on ne
 *     va pas sur une page pour se demander si on tient sa règle, on se le
 *     demande devant ses dépenses du mois.
 *
 * LA GREFFE ENVELOPPE `loadDashboardData`, le point de passage unique du
 * dashboard (cf. app.js) : c'est lui qui connaît la période ET la monnaie de
 * l'onglet actif, et qui est rappelé aussi bien quand on change de mois que
 * quand on change de devise. S'accrocher à `loadDashboard` n'aurait attrapé que
 * l'ouverture de l'écran.
 *
 * UN TROISIÈME ENDROIT, la PAGE D'UN OBJECTIF : en cliquant sa carte — sur la
 * page comme au dashboard — on ouvre la liste de toutes les opérations qui
 * entrent dans sa mesure (cf. « La page d'un objectif », plus bas).
 *
 * TOUS LES IDENTIFIANTS SONT PRÉFIXÉS `objectif-` / `obj` : cet écran vit dans
 * le même document que le reste de l'application, et les scripts d'extension
 * partagent une seule portée globale (cf. extensions/README.md).
 */

const OBJECTIFS_BASE = "/objectifs";

let objObjectifs = [];
let objMesures = [];
let objProjets = [];
// LA MONNAIE DU FORMULAIRE, et rien de plus : la LISTE, elle, les montre tous,
// chacun dans la sienne. C'est le défaut proposé à la création d'un objectif —
// la première monnaie de l'application, celle qu'on a en tête.
let objMonnaieParDefaut = null;
// LA PÉRIODE DE LECTURE DE CETTE PAGE, et elle ne se choisit pas : le mois en
// cours. On vient ici POSER des règles ; on les LIT au dashboard, qui a déjà
// son sélecteur de période (cf. page.html).

/* ---------- Les filtres (migration 0073) ----------
 *
 * POSÉS UN PAR UN, par « + Ajouter un filtre » (cf. app.js,
 * creerMenuAjoutChamp) : le formulaire ne montre que ceux qu'on a choisis. Les
 * bornes de montant et les jours ne se posent qu'une fois ; un mot à chercher
 * ou à écarter peut se poser plusieurs fois (« sans café », « sans boulangerie »).
 */
const OBJ_FILTRES = [
  { cle: "montant_min", libelle: "Montant au moins", saisie: "montant", unique: true },
  { cle: "montant_max", libelle: "Montant au plus", saisie: "montant", unique: true },
  { cle: "libelle_contient", libelle: "Libellé contenant", saisie: "texte", unique: false },
  { cle: "libelle_exclut", libelle: "Libellé ne contenant pas", saisie: "texte", unique: false },
  { cle: "jours", libelle: "Jours", saisie: "jours", unique: true },
];

// Le brouillon des filtres de l'objectif en cours d'édition, copié à
// l'ouverture : annuler ne doit rien laisser derrière.
let objBrouillonFiltres = [];

function objDefinitionFiltre(cle) {
  return OBJ_FILTRES.find((f) => f.cle === cle);
}

function objRenderFiltres() {
  const bloc = document.getElementById("objectif-filtres");
  if (!bloc) return;
  bloc.innerHTML = "";
  objBrouillonFiltres.forEach((filtre, i) => {
    const def = objDefinitionFiltre(filtre.champ);
    if (!def) return;
    const ligne = document.createElement("div");
    ligne.className = "champ-ajoute";
    let saisie;
    if (def.saisie === "jours") {
      saisie = `<select data-filtre="${i}">
        <option value="semaine">${t("En semaine")}</option>
        <option value="weekend">${t("Le week-end")}</option>
      </select>`;
    } else if (def.saisie === "montant") {
      saisie = `<input type="number" step="0.01" min="0" data-filtre="${i}" />`;
    } else {
      saisie = `<input type="text" data-filtre="${i}" placeholder="${escapeHtml(t("ex. café"))}" />`;
    }
    ligne.innerHTML = `
      <span class="champ-ajoute-libelle">${escapeHtml(t(def.libelle))}</span>
      ${saisie}
      <button type="button" class="champ-ajoute-retirer" data-retirer-filtre="${i}"
              title="${escapeHtml(t("Retirer"))}" aria-label="${escapeHtml(t("Retirer"))}">×</button>`;
    const champ = ligne.querySelector("[data-filtre]");
    champ.value = filtre.valeur == null ? "" : String(filtre.valeur);
    champ.addEventListener("input", () => {
      filtre.valeur = champ.value;
    });
    ligne.querySelector("[data-retirer-filtre]").addEventListener("click", () => {
      objBrouillonFiltres.splice(i, 1);
      objRenderFiltres();
    });
    bloc.appendChild(ligne);
  });

  const poses = new Set(objBrouillonFiltres.map((f) => f.champ));
  creerMenuAjoutChamp(document.getElementById("objectif-filtres-ajout"), {
    libelle: t("Ajouter un filtre"),
    options: OBJ_FILTRES.filter((f) => !f.unique || !poses.has(f.cle)).map((f) => ({
      cle: f.cle,
      libelle: t(f.libelle),
    })),
    onChoix: (cle) => {
      objBrouillonFiltres.push({ champ: cle, valeur: cle === "jours" ? "weekend" : "" });
      objRenderFiltres();
      const champs = document.querySelectorAll("#objectif-filtres [data-filtre]");
      champs[champs.length - 1]?.focus();
    },
  });
}

/** Les filtres d'un objectif, dits en quelques mots pour la carte :
 *  « ≥ 15,00 € · sans « café » · le week-end ». */
function objResumeFiltres(filtres, monnaieId) {
  return (filtres || [])
    .map((f) => {
      if (f.champ === "montant_min") return `≥ ${formatMontant(Number(f.valeur), monnaieId)}`;
      if (f.champ === "montant_max") return `≤ ${formatMontant(Number(f.valeur), monnaieId)}`;
      if (f.champ === "libelle_contient") return `${t("avec")} « ${escapeHtml(f.valeur)} »`;
      if (f.champ === "libelle_exclut") return `${t("sans")} « ${escapeHtml(f.valeur)} »`;
      if (f.champ === "jours") return f.valeur === "weekend" ? t("le week-end") : t("en semaine");
      return "";
    })
    .filter(Boolean)
    .join(" · ");
}

/* ---------- Les deux vues d'un objectif ----------
 *
 * TOUT OBJECTIF SE LIT DE DEUX FAÇONS, à chaque niveau du dashboard, et le
 * serveur rend les deux (cf. service_objectifs.fenetres_de_lecture) :
 *
 *   - L'ACTUELLE : la période PROPRE de l'objectif — la semaine pour un objectif
 *     hebdomadaire, le mois pour un objectif mensuel. « Où j'en suis » : un
 *     cumul, comparé à la cible entière ;
 *   - LA MOYENNÉE : une fenêtre plus large, ramenée à la cadence — « quel rythme
 *     j'ai tenu ». Un objectif hebdomadaire se moyenne sur le mois (dashboard
 *     mois) ou l'année (dashboard année) ; un objectif mensuel sur l'année
 *     (dashboard mois) ou tout l'historique (dashboard année).
 *
 * LA BASCULE EST POSÉE SUR LA CARTE, et retenue par objectif dans ce navigateur
 * — c'est un réglage de lecture, pas une donnée. Elle vaut pour le dashboard,
 * la page des objectifs et la page de l'objectif : une seule lecture à la fois,
 * partout.
 */
const OBJ_CLE_VUES = "objectifs.vues";

function objVues() {
  try {
    return JSON.parse(localStorage.getItem(OBJ_CLE_VUES) || "{}") || {};
  } catch (err) {
    return {};
  }
}

function objVue(objectifId) {
  const choisie = objVues()[objectifId];
  return choisie === "moyennee" || choisie === "annee" ? choisie : "actuelle";
}

/** La vue effectivement lisible pour cette mesure : la « moyenne de l'année » n'existe
 *  que pour un objectif hebdomadaire lu depuis un mois ; un choix gardé d'un autre
 *  niveau retombe sur la moyennée (qui est alors l'année) plutôt que sur rien. */
function objVueDisponible(mesure, vue) {
  if (mesure[vue]) return vue;
  return vue === "annee" && mesure.moyennee ? "moyennee" : "actuelle";
}

function objChoisirVue(objectifId, vue) {
  const vues = objVues();
  vues[objectifId] = vue;
  try {
    localStorage.setItem(OBJ_CLE_VUES, JSON.stringify(vues));
  } catch (err) {
    // Stockage indisponible : la bascule vaut pour cette page seulement.
  }
}

/** La mesure telle que la carte doit l'afficher : celle de la vue choisie, avec
 *  ses bornes (`fenetre`) — les champs de tête du serveur sont ceux du sélecteur
 *  du dashboard, pas de la vue. */
function objMesureAffichee(mesure, vue = objVue(mesure.objectif_id)) {
  vue = objVueDisponible(mesure, vue);
  const fenetre = mesure[vue];
  return {
    ...mesure,
    vue,
    fenetre,
    valeur: fenetre.valeur,
    valeur_cadence: fenetre.valeur_cadence,
    mode: fenetre.mode,
    unites: fenetre.unites,
    unites_periode: fenetre.unites_periode,
    echantillon: fenetre.echantillon,
    atteint: fenetre.atteint,
    avancement: fenetre.avancement,
  };
}

/** La période d'une vue, écrite en toutes lettres : « 21 Sept. → 27 Sept. 2026 »,
 *  « Septembre 2026 », « 2026 », « Depuis novembre 2025 ». Sans elle, « 17
 *  sorties » ne dit pas sur quoi. */
function objLibellePeriode(fenetre) {
  const mois = (iso) =>
    capitalizeFirst(
      new Intl.DateTimeFormat(langue(), { month: "long", year: "numeric" }).format(
        new Date(`${iso}T00:00:00`)
      )
    );
  if (fenetre.kind === "semaine") {
    return `${formatDateCourte(fenetre.debut)} → ${formatDateCourte(fenetre.fin)}`;
  }
  if (fenetre.kind === "mois") return mois(fenetre.debut);
  if (fenetre.kind === "annee") return fenetre.debut.slice(0, 4);
  return `${t("Depuis")} ${mois(fenetre.debut).toLowerCase()}`;
}

function objFenetreContientAujourdhui(fenetre) {
  const aujourdhui = new Date().toLocaleDateString("sv-SE");
  return fenetre.debut <= aujourdhui && aujourdhui <= fenetre.fin;
}

/** Le mot du bouton : il dit ce que la vue regarde. « en cours » quand la fenêtre
 *  contient aujourd'hui, « affiché » quand le sélecteur du dashboard est sur une
 *  autre période. */
function objLibelleVue(vue, fenetre) {
  // La moyenne de l'ANNÉE d'un objectif hebdomadaire, à côté de celle du mois.
  if (vue === "annee") return "Moyenne de l'année";
  if (vue === "actuelle") {
    const courante = objFenetreContientAujourdhui(fenetre);
    if (fenetre.kind === "semaine") {
      return courante ? "Semaine en cours" : "Semaine affichée";
    }
    return courante ? "Mois en cours" : "Mois affiché";
  }
  return (
    {
      mois: "Moyenne du mois",
      annee: "Moyenne de l'année",
      tout: "Moyenne sur tout l'historique",
    }[fenetre.kind] || "Moyenne du mois"
  );
}

/* ---------- Dire un chiffre dans l'unité de sa mesure ---------- */

// Un nombre de dépenses n'a pas de centimes, mais une MOYENNE de dépenses en a
// (3,8 par semaine) : deux décimales feraient croire à une précision que le
// comptage n'a pas, zéro cacherait l'écart avec la cible.
const OBJ_FORMAT_NOMBRE = new Intl.NumberFormat("fr-FR", {
  minimumFractionDigits: 0,
  maximumFractionDigits: 1,
});

function objMesureEstMonetaire(mesure) {
  return mesure === "montant_total" || mesure === "montant_moyen";
}

// Les mesures qui CUMULENT sur la durée (cf. constants.MESURES_OBJECTIF_
// CUMULATIVES) : les seules dont la cadence, et donc le prorata, veuille dire
// quelque chose.
function objMesureCumule(mesure) {
  return mesure === "nombre" || mesure === "montant_total";
}

function objFormatValeur(valeur, mesure, monnaieId) {
  if (objMesureEstMonetaire(mesure)) return formatMontant(valeur, monnaieId);
  if (mesure === "part_depenses") return formatPourcentage(valeur);
  return OBJ_FORMAT_NOMBRE.format(valeur || 0);
}

// CE QU'ON ÉCRIT À CÔTÉ DU GRAND CHIFFRE, et il dépend du MODE autant que de
// la mesure (cf. service_objectifs.mesurer). « 196 € sur la période » et
// « 3,8 par semaine » ne se disent pas pareil : le premier est un cumul qu'on
// compare à la cible entière, le second une moyenne. Écrire « par mois » sur un
// cumul du mois en cours laisserait croire à une prévision.
function objUniteCible(mesure, cadence, mode) {
  if (mesure === "part_depenses") return t("des dépenses de la période");
  if (mesure === "montant_moyen") return t("par dépense");
  if (mode === "moyenne") {
    return cadence === "semaine" ? t("par semaine") : t("par mois");
  }
  return t("sur la période");
}

/* ---------- Les cartes, communes aux deux écrans ----------
 *
 * UNE SEULE FONCTION POUR LES DEUX, et c'est délibéré : la carte du dashboard
 * et celle de la page doivent se reconnaître d'un écran à l'autre — deux
 * rendus parallèles auraient divergé au premier ajustement. Seuls les boutons
 * d'édition changent, et ils sont posés à part.
 */

function objBarre(avancement, atteint) {
  // LA BARRE SE REMPLIT JUSQU'À LA CIBLE ET PAS AU-DELÀ : au-delà, c'est le
  // DÉPASSEMENT qu'on peint, en tête de barre, plutôt que de laisser une barre
  // sortir de son cadre ou se remettre à zéro. Une barre pleine et rouge dit
  // « franchi » sans avoir à lire le chiffre.
  const largeur = Math.max(0, Math.min(100, avancement));
  const classe = atteint ? "obj-barre-tenue" : "obj-barre-manquee";
  return `
    <div class="obj-barre" role="img" aria-label="${escapeHtml(
      `${Math.round(avancement)} %`
    )}">
      <div class="obj-barre-remplissage ${classe}" style="width:${largeur}%"></div>
    </div>`;
}

function objDetailMesure(mesure) {
  // CE QUI A SERVI À CALCULER, en petit sous la barre. « 3,8 par semaine » sort
  // d'une division que rien d'autre ne montre : sans « 17 dépenses sur 4,4
  // semaines », le chiffre affiché est à croire sur parole.
  const morceaux = [];
  // LE PÉRIMÈTRE EN PREMIER, et il y en a trois : un projet, une catégorie, ou
  // rien — c'est-à-dire toutes les dépenses.
  if (mesure.projet) morceaux.push(escapeHtml(mesure.projet));
  else if (mesure.categorie) morceaux.push(escapeHtml(mesure.categorie));
  else morceaux.push(t("Toutes les dépenses"));
  // LA MONNAIE NE SE DIT QUE S'IL Y EN A PLUSIEURS. La page les montre tous,
  // toutes devises confondues (cf. page.html) : sans ce rappel, deux cartes
  // voisines afficheraient « 250 » et « 250 » sans qu'on sache qu'elles ne
  // parlent pas de la même chose. Avec une seule monnaie, l'écrire à chaque
  // carte n'apprendrait rien.
  if ((state.monnaies || []).length > 1) {
    const monnaie = (state.monnaies || []).find((m) => m.id === mesure.monnaie_id);
    if (monnaie) morceaux.push(escapeHtml(monnaie.nom));
  }
  // LA PÉRIODE QUE LA VUE REGARDE : les bornes de la semaine (elle peut déborder
  // sur le mois voisin, et le dire évite de chercher une dépense au mauvais
  // endroit), le mois, l'année ou « depuis… ».
  morceaux.push(escapeHtml(objLibellePeriode(mesure.fenetre)));

  const enSemaine = mesure.fenetre.kind === "semaine";
  const dansLaPeriode = enSemaine ? t("dépenses cette semaine") : t("dépenses sur la période");
  if (mesure.mesure === "nombre") {
    morceaux.push(`${mesure.valeur} ${dansLaPeriode}`);
  } else if (mesure.mesure === "montant_moyen") {
    morceaux.push(`${mesure.echantillon} ${dansLaPeriode}`);
  } else if (mesure.mesure === "montant_total" && mesure.mode === "moyenne") {
    // En mode cumul, le grand chiffre EST déjà ce total : le répéter en petit
    // juste en dessous n'apprend rien.
    morceaux.push(
      `${formatMontant(mesure.valeur, mesure.monnaie_id)} ${t("sur la période")}`
    );
  }
  // LES UNITÉS ÉCOULÉES NE SE DISENT QUE SI ON A DIVISÉ PAR ELLES : sur un
  // cumul, elles ne servent à aucun calcul affiché, et les écrire ferait
  // chercher une division qui n'a pas eu lieu.
  if (mesure.mode === "moyenne" && mesure.unites) {
    const unite =
      mesure.cadence === "semaine" ? t("semaines écoulées") : t("mois écoulés");
    morceaux.push(`${OBJ_FORMAT_NOMBRE.format(mesure.unites)} ${unite}`);
  }
  const filtres = objResumeFiltres(mesure.filtres, mesure.monnaie_id);
  if (filtres) morceaux.push(filtres);
  return morceaux.join(" · ");
}

/** La bascule posée sur chaque carte : l'actuelle, et la moyennée. */
function objBasculeVues(mesure) {
  const vue = objVueDisponible(mesure, objVue(mesure.objectif_id));
  const bouton = (valeur) =>
    `<button type="button" class="${vue === valeur ? "actif" : ""}"
             data-obj-vue="${valeur}" data-obj-id="${mesure.objectif_id}">${t(
      objLibelleVue(valeur, mesure[valeur])
    )}</button>`;
  // Trois boutons pour un objectif hebdomadaire lu depuis un mois (la semaine, la
  // moyenne du mois, la moyenne de l'année), deux partout ailleurs.
  return `<div class="obj-bascule">${bouton("actuelle")}${bouton("moyennee")}${
    mesure.annee ? bouton("annee") : ""
  }</div>`;
}

function objCarteHtml(mesureServeur, options = {}) {
  const mesure = objMesureAffichee(mesureServeur, options.vue);
  // SANS CIBLE, LA CARTE NE JUGE RIEN : ni « tenu », ni « manqué », ni barre.
  // Elle ne porte plus qu'un chiffre et ce qui a servi à le calculer — c'est
  // exactement ce qu'on lui demande quand on suit un projet en cours. Peindre
  // en vert un objectif dont personne n'a fixé le bout aurait été un jugement
  // inventé (cf. migration 0070).
  const sansCible = mesure.cible == null;
  const comparateur = mesure.sens === "max" ? "≤" : "≥";
  const actions = options.editable
    ? `<span class="obj-carte-actions">
         <button type="button" class="lien" data-objectif-modifier="${mesure.objectif_id}">${t(
           "Modifier"
         )}</button>
         <button type="button" class="lien danger" data-objectif-supprimer="${
           mesure.objectif_id
         }">${t("Supprimer")}</button>
       </span>`
    : "";
  const etat = sansCible
    ? `<span class="obj-etat obj-etat-suivi">${t("suivi")}</span>`
    : `<span class="obj-etat">${mesure.atteint ? t("tenu") : t("manqué")}</span>`;
  const cible = sansCible
    ? ""
    : `<span class="obj-cible">${t("cible")} ${comparateur} ${objFormatValeur(
        mesure.cible,
        mesure.mesure,
        mesure.monnaie_id
      )}</span>`;

  return `
    <div class="obj-carte ${
      sansCible ? "obj-sans-cible" : mesure.atteint ? "obj-tenu" : "obj-manque"
    } ${options.sansOuverture ? "" : "obj-carte-cliquable"}"
         data-objectif-id="${mesure.objectif_id}"
         ${options.sansOuverture ? "" : `data-obj-ouvrir="${mesure.objectif_id}"`}>
      <div class="obj-carte-tete">
        <span class="obj-nom">${escapeHtml(mesure.nom)}</span>
        ${etat}
        ${actions}
      </div>
      <div class="obj-chiffres">
        <span class="obj-valeur">${objFormatValeur(
          mesure.valeur_cadence,
          mesure.mesure,
          mesure.monnaie_id
        )}</span>
        <span class="obj-unite">${escapeHtml(
          mesure.fenetre.kind === "semaine" && objMesureCumule(mesure.mesure)
            ? t("cette semaine")
            : objUniteCible(mesure.mesure, mesure.cadence, mesure.mode)
        )}</span>
        ${cible}
      </div>
      ${objBasculeVues(mesureServeur)}
      ${sansCible ? "" : objBarre(mesure.avancement, mesure.atteint)}
      ${
        // Le dashboard ne détaille pas : catégorie, monnaie, période et filtres
        // se lisent sur la page Objectifs, pas ici.
        options.sansDetail ? "" : `<div class="obj-detail hint">${objDetailMesure(mesure)}</div>`
      }
      ${
        options.sansOuverture
          ? ""
          : `<button type="button" class="lien obj-voir" data-obj-ouvrir-lien="${
              mesure.objectif_id
            }">${t("Voir les opérations")} →</button>`
      }
    </div>`;
}

/* ---------- L'onglet de la page Budget ---------- */

/**
 * La période sur laquelle cette page mesure : LE MOIS EN COURS, et il ne se
 * choisit pas.
 *
 * POURQUOI RIEN À CHOISIR ICI. On vient sur cet écran POSER des règles et les
 * relire ; on les LIT au dashboard, qui porte déjà ses onglets de monnaie et
 * son sélecteur de période — et c'est là qu'un objectif sert, devant les
 * dépenses du mois. Trois listes déroulantes reposaient ici la même question
 * pour un chiffre qu'on ne vient pas y chercher, et celle des monnaies faisait
 * pire que d'encombrer : elle CACHAIT la moitié de la liste à qui tient deux
 * devises, sans que rien ne le dise.
 */
function objPeriodeCourante() {
  const aujourdhui = new Date();
  return { annee: aujourdhui.getFullYear(), mois: aujourdhui.getMonth() + 1 };
}

/**
 * Le menu du PÉRIMÈTRE : toutes les dépenses, une catégorie, ou un projet.
 *
 * UNE SEULE LISTE, EN DEUX GROUPES, et non deux menus. Une catégorie classe une
 * dépense par NATURE, un projet la regroupe par ÉVÉNEMENT — les deux axes se
 * croisent (l'hôtel d'un voyage est dans « Loisirs » ET dans « Italie »), et un
 * objectif qui porterait les deux poserait une question dont aucune réponse ne
 * s'impose : l'intersection, ou l'union ? Le serveur les refuse ensemble (cf.
 * models.ObjectifKpi) ; un menu unique fait que la question ne se pose pas.
 *
 * LA VALEUR PORTE SON AXE (« cat:12 », « projet:3 ») : c'est ce qui permet au
 * même menu de rendre deux champs différents sans table de correspondance.
 *
 * CONSTRUIT À LA MAIN plutôt que par `fillSelect` : celui-ci ne sait pas poser
 * d'<optgroup>, et sans les deux en-têtes on lirait une liste où « Italie »
 * voisine « Loisirs » sans qu'on sache lequel est quoi.
 */
function objRemplirPerimetre() {
  const select = document.getElementById("objectif-perimetre");
  const choisi = select.value;
  // UNE PART EXIGE UN PÉRIMÈTRE (le serveur refuse en 400) : sans lui, elle
  // rapporte toutes les dépenses au total des dépenses et vaut 100 % tous les
  // mois. Retirer le choix vaut mieux que le laisser mener à un refus.
  const partSeule =
    document.getElementById("objectif-mesure").value === "part_depenses";

  select.innerHTML = "";
  if (!partSeule) {
    const toutes = document.createElement("option");
    toutes.value = "";
    toutes.textContent = t("Toutes les dépenses");
    select.appendChild(toutes);
  }

  const groupe = (libelle, lignes, prefixe) => {
    if (!lignes.length) return;
    const bloc = document.createElement("optgroup");
    bloc.label = libelle;
    lignes.forEach((ligne) => {
      const option = document.createElement("option");
      option.value = `${prefixe}:${ligne.id}`;
      option.textContent = ligne.nom;
      bloc.appendChild(option);
    });
    select.appendChild(bloc);
  };

  // LES CATÉGORIES D'ENTRÉE N'Y SONT PAS : un objectif compte des DÉPENSES, et
  // une catégorie de salaire n'en porte aucune — sa barre serait à zéro quoi
  // qu'on y range, exactement comme sur l'histogramme du dashboard.
  groupe(
    t("Catégories"),
    (state.categories || []).filter((c) => !c.est_entree),
    "cat"
  );
  // LES PROJETS NE PARAISSENT QU'AVEC LEUR EXTENSION. Un objectif déjà posé sur
  // un projet continue de se mesurer sans elle (la colonne est au noyau) ; ce
  // qui disparaît est la possibilité d'en choisir un de plus, faute de savoir
  // les lister.
  groupe(t("Projets"), objProjets, "projet");

  select.value = choisi;
  if (!select.value) select.selectedIndex = 0;
}

/** Le menu des monnaies du formulaire, reconstruit SANS perdre le choix fait.
 *
 *  LE BOGUE QU'IL CORRIGE, et il valait cette fonction à lui seul : ce menu
 *  était rempli par la fonction qui remplit le périmètre, laquelle est
 *  rappelée à chaque changement de champ — y compris au changement de MONNAIE,
 *  qui réécrit l'unité de la cible. `fillSelect` vide et reconstruit le
 *  <select>, donc la valeur retombait sur la première option : choisir une
 *  autre devise la faisait revenir à la première dans le même geste, et la
 *  monnaie d'un objectif était en pratique impossible à changer.
 */
function objRemplirMonnaies() {
  const monnaie = document.getElementById("objectif-monnaie-champ");
  const choisie = monnaie.value;
  fillSelect(
    monnaie,
    state.monnaies.map((m) => ({ value: m.id, label: `${m.nom} (${m.symbole})` }))
  );
  if (choisie) monnaie.value = choisie;
  // UNE SEULE MONNAIE : le champ n'a rien à demander et disparaît. Il revient
  // le jour où une seconde devise existe — c'est alors une vraie question.
  document.getElementById("objectif-ligne-monnaie").style.display =
    state.monnaies.length > 1 ? "" : "none";
}

/**
 * Ce que le formulaire montre dépend de ce qu'il mesure, et de ce qu'on se fixe.
 *
 * TROIS CHAMPS SUIVENT LE RESTE : la CADENCE, qui ne veut rien dire pour un
 * rapport (un montant moyen ne double pas quand la période double) ; l'UNITÉ de
 * la cible, qui dit en quoi le nombre qu'on tape est libellé — sans elle il
 * fallait deviner si « 40 » voulait dire 40 €, 40 % ou 40 fois ; et la PAIRE
 * sens + cible, qui n'a rien à demander tant qu'on ne s'est fixé aucune règle.
 */
function majChampsObjectif() {
  const mesure = document.getElementById("objectif-mesure").value;
  const cadence = document.getElementById("objectif-cadence").value;
  objRemplirPerimetre();
  document.getElementById("objectif-ligne-cadence").style.display = objMesureCumule(
    mesure
  )
    ? ""
    : "none";

  const avecCible = document.getElementById("objectif-avec-cible").checked;
  document.getElementById("objectif-ligne-sens").style.display = avecCible ? "" : "none";
  document.getElementById("objectif-ligne-cible").style.display = avecCible ? "" : "none";

  const monnaieId = Number(document.getElementById("objectif-monnaie-champ").value);
  let unite;
  if (mesure === "part_depenses") unite = "%";
  else if (objMesureEstMonetaire(mesure)) unite = symboleMonnaie(monnaieId) || "";
  else unite = t("dépenses");
  const suffixe = objMesureCumule(mesure)
    ? ` ${cadence === "semaine" ? t("par semaine") : t("par mois")}`
    : "";
  document.getElementById("objectif-cible-unite").textContent = `${unite}${suffixe}`;
}

/** La valeur du menu de périmètre pour un objectif : « cat:12 », « projet:3 »
 *  ou la chaîne vide (toutes les dépenses). */
function objValeurPerimetre(objectif) {
  if (!objectif) return "";
  if (objectif.sous_filtre_id) return `projet:${objectif.sous_filtre_id}`;
  if (objectif.categorie_id) return `cat:${objectif.categorie_id}`;
  return "";
}

function objOuvrirEditeur(objectif) {
  document.getElementById("objectif-editeur-titre").textContent = objectif
    ? t("Modifier l'objectif")
    : t("Nouvel objectif");
  document.getElementById("objectif-id").value = objectif ? objectif.id : "";
  document.getElementById("objectif-nom").value = objectif ? objectif.nom : "";
  document.getElementById("objectif-mesure").value = objectif ? objectif.mesure : "nombre";
  document.getElementById("objectif-cadence").value = objectif ? objectif.cadence : "mois";
  document.getElementById("objectif-sens").value = objectif ? objectif.sens : "max";
  // PAS DE CIBLE EST UN ÉTAT, et il ne se confond pas avec zéro : la case
  // décoché masque les deux champs et l'objectif se contente de constater.
  const avecCible = objectif ? objectif.cible != null : true;
  document.getElementById("objectif-avec-cible").checked = avecCible;
  document.getElementById("objectif-cible").value = avecCible && objectif ? objectif.cible : "";
  // LES MONNAIES AVANT TOUT LE RESTE : l'unité de la cible lit le symbole de
  // celle qui est choisie, et `objRemplirMonnaies` garde la valeur en place.
  objRemplirMonnaies();
  document.getElementById("objectif-monnaie-champ").value = String(
    objectif ? objectif.monnaie_id : objMonnaieParDefaut
  );
  document.getElementById("objectif-visible").checked = objectif
    ? objectif.visible_dashboard
    : true;
  // APRÈS la monnaie et AVANT le périmètre : `majChampsObjectif` reconstruit la
  // liste du périmètre, et le poser plus tôt le ferait effacer.
  majChampsObjectif();
  document.getElementById("objectif-perimetre").value = objValeurPerimetre(objectif);
  objBrouillonFiltres = objectif && objectif.filtres ? JSON.parse(JSON.stringify(objectif.filtres)) : [];
  objRenderFiltres();
  document.getElementById("objectif-editeur").style.display = "";
  document.getElementById("objectif-nom").focus();
}

function objFermerEditeur() {
  document.getElementById("objectif-editeur").style.display = "none";
}

function objRenderListe() {
  const liste = document.getElementById("objectifs-liste");
  if (!liste) return;
  if (!objMesures.length) {
    liste.innerHTML = `<p class="hint">${t(
      "Aucun objectif. Le bouton ci-dessus en crée un."
    )}</p>`;
    return;
  }
  liste.innerHTML = objMesures
    .map((mesure) => objCarteHtml(mesure, { editable: true }))
    .join("");
}

/** Les projets, pour le menu du périmètre — et seulement si leur extension
 *  tourne. Un échec ne dit rien ici : on retombe sur une liste sans projets,
 *  et le reste de l'écran fonctionne. */
async function objChargerProjets() {
  if (!BudgetApp.extensions.estActive("projets")) {
    objProjets = [];
    return;
  }
  try {
    objProjets = await apiFetch("/projets");
  } catch (err) {
    objProjets = [];
  }
}

async function loadObjectifs() {
  try {
    if (!state.monnaies.length) await refreshMonnaies();
    await refreshCategories();
    await objChargerProjets();
    if (
      objMonnaieParDefaut == null ||
      !state.monnaies.some((m) => m.id === objMonnaieParDefaut)
    ) {
      objMonnaieParDefaut = monnaiePreferee(state.monnaies.map((m) => m.id));
    }

    // TOUS LES OBJECTIFS, TOUTES MONNAIES, sur le mois en cours : la requête ne
    // porte plus de `monnaie_id`, et le serveur mesure alors chacun dans la
    // sienne (cf. routeur_objectifs.mesurer_objectifs).
    const { annee, mois } = objPeriodeCourante();
    const [liste, mesures] = await Promise.all([
      apiFetch(OBJECTIFS_BASE),
      apiFetch(`${OBJECTIFS_BASE}/mesures?annee=${annee}&mois=${mois}`),
    ]);
    objObjectifs = liste;
    objMesures = mesures.objectifs;
    objRenderListe();
    // On rouvre toujours l'onglet sur sa liste — sauf quand on y arrive d'une
    // carte du dashboard, qui a demandé la page d'un objectif précis.
    if (objDetailEnAttente) {
      const demande = objDetailEnAttente;
      objDetailEnAttente = null;
      await objOuvrirDetail(demande.objectifId, demande.annee, demande.mois);
    } else {
      objFermerDetail();
    }
  } catch (err) {
    showMessage(err.message, "error");
  }
}

/* ---------- La page d'un objectif ----------
 *
 * UN OBJECTIF CRÉÉ A SA PAGE, comme un projet : on clique sa carte, et elle
 * liste TOUTES LES OPÉRATIONS qui entrent dans sa mesure — c'est la réponse à
 * « d'où vient ce chiffre ? », que la carte ne peut pas donner. La liste est celle
 * du SERVEUR (cf. routeur_objectifs.operations_de_l_objectif), calculée sur la
 * même fenêtre que la carte : la somme des montants retenus est le chiffre
 * affiché, pas une requête de plus qui finirait par s'en écarter.
 *
 * ELLE SUIT LA VUE DE LA CARTE (actuelle ou moyennée) et le niveau du dashboard
 * d'où l'on vient :
 *   - en vue ACTUELLE, les opérations de la période propre de l'objectif (la
 *     semaine, le mois) ;
 *   - en vue MOYENNÉE, celles de la seule fenêtre sur laquelle on moyenne (le
 *     mois, l'année, tout l'historique).
 * Depuis la page des objectifs, qui n'a pas de sélecteur, c'est le mois en cours.
 */
let objDetail = null;
// Une carte du dashboard demande la page d'un objectif AVANT que l'onglet ne soit
// chargé : la demande attend ici que `loadObjectifs` ait fini.
let objDetailEnAttente = null;
// Le niveau du dashboard, gardé au dernier rendu : c'est lui que les cartes du
// dashboard transmettent à la page de l'objectif.
let objContexteDashboard = null;

function objMontreVuePage(detail) {
  const liste = document.getElementById("objectifs-vue-liste");
  const page = document.getElementById("objectif-detail");
  if (liste) liste.style.display = detail ? "none" : "";
  if (page) page.style.display = detail ? "" : "none";
}

function objFermerDetail() {
  objDetail = null;
  objMontreVuePage(false);
}

async function objOuvrirDetail(objectifId, annee, mois) {
  objDetail = { objectifId: Number(objectifId), annee, mois };
  await objChargerDetail();
}

/** Redemande la page de l'objectif ouvert, dans la vue qui est CHOISIE à cet
 *  instant (la bascule de la carte change la liste, pas seulement le chiffre). */
async function objChargerDetail() {
  if (!objDetail) return;
  const { objectifId, annee, mois } = objDetail;
  const vue = objVue(objectifId);
  const requete = `vue=${vue}&annee=${annee}` + (mois ? `&mois=${mois}` : "");
  try {
    const data = await apiFetch(`${OBJECTIFS_BASE}/${objectifId}/operations?${requete}`);
    objRenderDetail(data);
    objMontreVuePage(true);
  } catch (err) {
    showMessage(traduireMessageServeur(err.message), "error");
    objFermerDetail();
  }
}

function objCelluleRetenu(op) {
  // Ce que la ligne pèse dans la mesure ; et, quand ce n'est pas son montant
  // (reste à charge, part de découpe, part du mois d'une amortie), son montant
  // réel dessous, en gris — un rappel, pas ce qu'on compare.
  const differe = Math.abs(op.retenu - op.montant) > 0.005;
  return (
    montantHtml(op.retenu, "dépense", op.monnaie_id) +
    (differe ? `<div class="montant-origine">${formatMontant(op.montant, op.monnaie_id)}</div>` : "")
  );
}

function objRenderDetail(data) {
  const mesure = data.mesure;
  document.getElementById("objectif-detail-titre").textContent = mesure.nom;
  document.getElementById("objectif-detail-carte").innerHTML = objCarteHtml(mesure, {
    vue: data.vue,
    sansOuverture: true,
  });

  const operations = data.operations || [];
  document.getElementById("objectif-detail-nombre").textContent = operations.length;
  document.getElementById("objectif-detail-vide").style.display = operations.length ? "none" : "";
  document.getElementById("objectif-detail-tableau").style.display = operations.length ? "" : "none";
  document.getElementById("objectif-detail-liste").innerHTML = operations
    .map((op) => {
      const mois = op.amorti && op.amortissement_nb_mois
        ? ` [${op.amortissement_nb_mois > 1 ? t("{n} mois", { n: op.amortissement_nb_mois }) : t("1 mois")}]`
        : "";
      return `<tr>
        <td class="operation-date">${formatDateCourte(op.date)}${mois}</td>
        <td>${escapeHtml(op.nature)}</td>
        <td>${nomCompte(op.compte_id)}</td>
        <td>${op.decoupee ? t("Découpée") : nomCategorie(op.categorie_id)}</td>
        <td>${objCelluleRetenu(op)}</td>
      </tr>`;
    })
    .join("");
  document.getElementById("objectif-detail-total").innerHTML = operations.length
    ? `${t("Total retenu")} : <strong>${formatMontant(data.total_retenu, mesure.monnaie_id)}</strong>`
    : "";
}

async function objEnregistrer() {
  const id = document.getElementById("objectif-id").value;
  const nom = document.getElementById("objectif-nom").value.trim();
  if (!nom) {
    showMessage(t("Donne un nom à cet objectif."), "error");
    return;
  }
  // LE PÉRIMÈTRE PORTE SON AXE dans sa valeur (« cat:12 », « projet:3 ») : on
  // le relit ici pour en tirer l'un OU l'autre des deux champs, jamais les deux
  // (cf. objRemplirPerimetre).
  const [axe, reference] = document.getElementById("objectif-perimetre").value.split(":");
  const categorieId = axe === "cat" ? Number(reference) : null;
  const projetId = axe === "projet" ? Number(reference) : null;
  const avecCible = document.getElementById("objectif-avec-cible").checked;
  // UN FILTRE SANS VALEUR EST REFUSÉ ICI plutôt qu'ignoré : posé puis laissé
  // vide, il ne filtrerait rien et ferait croire à un objectif raffiné.
  if (objBrouillonFiltres.some((f) => String(f.valeur ?? "").trim() === "")) {
    showMessage(t("Chaque filtre doit avoir une valeur."), "error");
    return;
  }
  const filtres = objBrouillonFiltres.map((f) => ({
    champ: f.champ,
    valeur: objDefinitionFiltre(f.champ)?.saisie === "montant" ? Number(f.valeur) : String(f.valeur).trim(),
  }));
  const corps = {
    nom,
    mesure: document.getElementById("objectif-mesure").value,
    cadence: document.getElementById("objectif-cadence").value,
    sens: document.getElementById("objectif-sens").value,
    // PAS DE CIBLE, PAS DE NOMBRE : `null` et zéro ne disent pas la même chose
    // — zéro est une règle (« rien du tout ce mois-ci »), `null` est l'absence
    // de règle (cf. migration 0070). Sur une MODIFICATION, `null` voudrait
    // seulement dire « ne change pas » : c'est `cible_effacee` qui la retire.
    cible: avecCible ? Number(document.getElementById("objectif-cible").value) || 0 : null,
    cible_effacee: !avecCible,
    // ZÉRO ÉLARGIT À TOUTES LES DÉPENSES sur une modification (cf.
    // schemas_objectifs.ObjectifUpdate) ; à la création, `null` dit la même
    // chose — `None` y veut bien dire « aucun périmètre ».
    categorie_id: categorieId || (id ? 0 : null),
    sous_filtre_id: projetId || (id ? 0 : null),
    monnaie_id:
      Number(document.getElementById("objectif-monnaie-champ").value) ||
      objMonnaieParDefaut,
    visible_dashboard: document.getElementById("objectif-visible").checked,
    filtres,
  };
  try {
    if (id) {
      await apiFetch(`${OBJECTIFS_BASE}/${id}`, {
        method: "PUT",
        body: JSON.stringify(corps),
      });
    } else {
      await apiFetch(OBJECTIFS_BASE, { method: "POST", body: JSON.stringify(corps) });
    }
    objFermerEditeur();
    showMessage(t("Objectif enregistré"), "success");
    await loadObjectifs();
  } catch (err) {
    showMessage(traduireMessageServeur(err.message), "error");
  }
}

async function objSupprimer(id) {
  const mesure = objMesures.find((m) => m.objectif_id === Number(id));
  const nom = mesure ? mesure.nom : "";
  if (!confirm(`${t("Supprimer l'objectif")} « ${nom} » ?`)) return;
  try {
    await apiFetch(`${OBJECTIFS_BASE}/${id}`, { method: "DELETE" });
    await loadObjectifs();
  } catch (err) {
    showMessage(traduireMessageServeur(err.message), "error");
  }
}

/* ---------- Les écouteurs de l'onglet ---------- */

document.getElementById("btn-objectif-nouveau")?.addEventListener("click", () =>
  objOuvrirEditeur(null)
);
document.getElementById("btn-objectif-annuler")?.addEventListener("click", objFermerEditeur);
document.getElementById("btn-objectif-enregistrer")?.addEventListener("click", objEnregistrer);
["objectif-mesure", "objectif-cadence", "objectif-monnaie-champ", "objectif-avec-cible"]
  .forEach((id) =>
    document.getElementById(id)?.addEventListener("change", majChampsObjectif)
  );

// UN SEUL ÉCOUTEUR DÉLÉGUÉ sur la liste, posé une fois : elle est réécrite à
// chaque rendu, et recâbler chaque bouton y laisserait un écouteur de plus à
// chaque passage (cf. le piège documenté de `creerMenuCases`, app.js).
document.getElementById("objectifs-liste")?.addEventListener("click", (e) => {
  const modifier = e.target.closest("[data-objectif-modifier]");
  if (modifier) {
    const objectif = objObjectifs.find(
      (o) => o.id === Number(modifier.dataset.objectifModifier)
    );
    if (objectif) objOuvrirEditeur(objectif);
    return;
  }
  const supprimer = e.target.closest("[data-objectif-supprimer]");
  if (supprimer) objSupprimer(supprimer.dataset.objectifSupprimer);
});

/* ---------- La greffe du dashboard ----------
 *
 * CE QUI SE POSE LÀ-BAS, ET CE QUI RESTE ICI. Le dashboard ne montre que les
 * objectifs COCHÉS (`visible_dashboard`), sur la monnaie de son onglet et la
 * période de son sélecteur. Ceux qu'on suit de loin restent sur leur page :
 * un bloc qui grandit sans fin sous les graphes finirait par les repousser hors
 * de l'écran, et ce sont eux qu'on vient voir.
 *
 * LE CONTENEUR EST RÉSERVÉ PAR LE NOYAU (`#dashboard-objectifs`, sous la
 * légende), comme `#flux-remboursements-actions` l'est pour « Suivi des
 * remboursements » : une extension qui fabriquerait son propre bloc devrait
 * décider où l'insérer, et se tromperait le jour où la page change.
 *
 * LA GREFFE SE DÉFAIT TOUTE SEULE : `estActive` est consulté à CHAQUE rendu, et
 * le bloc est vidé dès que l'extension s'éteint — éteindre une extension ne
 * recharge pas la page.
 */

// La dernière mesure du dashboard, gardée pour pouvoir redessiner ses cartes
// quand on bascule une lecture hebdomadaire, sans refaire la requête.
let objMesuresDashboard = [];

function objRenderDashboard(bloc) {
  bloc.innerHTML = `
      <h3>${t("Objectifs")}<i class="info-bulle" tabindex="0"
          data-info-cle="objectifs.dashboard">i</i></h3>
      <div class="obj-liste obj-liste-dashboard">
        ${objMesuresDashboard.map((mesure) => objCarteHtml(mesure, { sansDetail: true })).join("")}
      </div>`;
}

// LA BASCULE ACTUELLE / MOYENNÉE ET L'OUVERTURE D'UNE CARTE, déléguées sur tout
// le document : les cartes vivent sur trois écrans (la page, le dashboard, la
// page d'un objectif), réécrits à chaque rendu.
document.addEventListener("click", (e) => {
  const bouton = e.target.closest("[data-obj-vue]");
  if (bouton) {
    objChoisirVue(bouton.dataset.objId, bouton.dataset.objVue);
    // Sur la page d'un objectif, la liste change avec la vue : on la redemande.
    if (bouton.closest("#objectif-detail")) {
      objChargerDetail();
      return;
    }
    objRenderListe();
    const bloc = document.getElementById("dashboard-objectifs");
    if (bloc && objMesuresDashboard.length) {
      objRenderDashboard(bloc);
      appliquerTextes(bloc);
      traduireDomStatique(bloc);
      appliquerPuces(bloc);
    }
    return;
  }

  const carte = e.target.closest("[data-obj-ouvrir]");
  if (!carte) return;
  // Un bouton de la carte (Modifier, Supprimer, la bascule) fait son propre
  // travail : seul le lien « Voir les opérations » compte comme une ouverture.
  if (e.target.closest("button, a") && !e.target.closest("[data-obj-ouvrir-lien]")) return;
  objOuvrirDepuisCarte(carte);
});

function objOuvrirDepuisCarte(carte) {
  const objectifId = Number(carte.dataset.objOuvrir);
  if (carte.closest("#dashboard-objectifs") && objContexteDashboard) {
    // DEPUIS LE DASHBOARD : la page s'ouvre dans l'onglet Objectifs de la page
    // Budget, avec le niveau (mois ou année) que le sélecteur affichait.
    objDetailEnAttente = { objectifId, ...objContexteDashboard };
    switchSection("budget", { sousSection: "budget-objectifs" });
    return;
  }
  // DEPUIS LA PAGE DES OBJECTIFS : le mois en cours, qu'elle mesure déjà.
  const { annee, mois } = objPeriodeCourante();
  objOuvrirDetail(objectifId, annee, mois);
}

document.getElementById("btn-objectif-fermer")?.addEventListener("click", objFermerDetail);

async function objRendreDashboard(annee, mois) {
  const bloc = document.getElementById("dashboard-objectifs");
  if (!bloc) return;
  if (!BudgetApp.extensions.estActive("objectifs")) {
    bloc.innerHTML = "";
    bloc.style.display = "none";
    return;
  }
  const monnaieId = state.dashboardMonnaieId;
  if (monnaieId == null) {
    bloc.innerHTML = "";
    bloc.style.display = "none";
    return;
  }
  try {
    // LA VUE ANNÉE N'ENVOIE PAS DE MOIS, comme partout ailleurs : `mois` absent
    // veut dire l'année entière (cf. soldes._filtre_periode), et la cadence
    // fait le reste — un objectif mensuel y vaut douze unités.
    const enAnnee = state.dashboardPeriode.vue === "annee";
    objContexteDashboard = { annee, mois: enAnnee ? null : mois };
    const requete =
      `monnaie_id=${monnaieId}&annee=${annee}&dashboard=true` +
      (enAnnee ? "" : `&mois=${mois}`);
    const data = await apiFetch(`${OBJECTIFS_BASE}/mesures?${requete}`);
    objMesuresDashboard = data.objectifs;
    if (!data.objectifs.length) {
      bloc.innerHTML = "";
      bloc.style.display = "none";
      return;
    }
    bloc.style.display = "";
    objRenderDashboard(bloc);
    // Les deux passes de textes, dans cet ordre : la pastille « i » qu'on vient
    // d'écrire porte une clé, pas une phrase (cf. frontend/textes.js).
    appliquerTextes(bloc);
    traduireDomStatique(bloc);
    appliquerPuces(bloc);
  } catch (err) {
    // UN OBJECTIF QUI NE SE LIT PAS NE DOIT PAS EMPORTER LE DASHBOARD : le bloc
    // se tait, les chiffres du mois restent affichés.
    bloc.innerHTML = "";
    bloc.style.display = "none";
  }
}

// L'enveloppe, posée une seule fois. `loadDashboardData` est résolue dans la
// portée globale à chaque appel : réassigner la variable suffit à ce que le
// sélecteur de période appelle la nouvelle (cf. extensions/README.md).
if (typeof loadDashboardData === "function" && !window.objDashboardGreffe) {
  const chargerOrigine = loadDashboardData;
  window.objDashboardGreffe = true;
  window.loadDashboardData = async function (annee, mois) {
    await chargerOrigine.apply(this, arguments);
    await objRendreDashboard(annee, mois);
  };
}

// L'enregistrement auprès du noyau, en FIN de fichier : `loadObjectifs` doit
// exister au moment où on la référence. Le chargeur est rappelé à chaque
// ouverture de l'onglet — les dépenses ont pu changer depuis.
BudgetApp.extensions.enregistrer("objectifs", { chargeur: loadObjectifs });
