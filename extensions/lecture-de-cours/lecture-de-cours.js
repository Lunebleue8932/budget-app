/* ---------- Extension « Placements financiers — cours en ligne » ----------
 *
 * UNE GREFFE, PAS UN ÉCRAN. Cette extension n'a pas de page à elle : elle
 * ajoute trois choses à celle de l'extension « placements », qui reste
 * entièrement fonctionnelle sans elle —
 *
 *   1. un champ « lien » sur chaque titre suivi ;
 *   2. un bouton « Mettre à jour les cours » en haut de la page ;
 *   3. une mise à jour automatique au lancement de l'application.
 *
 * COMMENT ON SE GREFFE, ET POURQUOI COMME ÇA. Le noyau ne prévoit qu'un point
 * d'accroche : `BudgetApp.extensions.enregistrer(id, { chargeur })`, appelé à
 * chaque ouverture d'un écran. Il n'existe pas d'API « ajoute-toi à l'écran
 * d'une autre extension ». On utilise donc les deux prises que le chargement
 * des extensions laisse ouvertes :
 *
 *   - on RÉ-ENREGISTRE le chargeur de « placements » avec le nôtre, qui appelle
 *     le sien puis pose la barre de mise à jour ;
 *   - on ENVELOPPE `renderTitresSuivis`, la fonction de « placements » qui
 *     redessine la liste des titres, pour rajouter nos champs après chacun de
 *     ses passages.
 *
 * Les deux tiennent parce que les scripts d'extension s'exécutent dans la
 * portée globale, dans l'ORDRE ALPHABÉTIQUE des dossiers : « placements »
 * avant « lecture-de-cours ». Si un jour ce n'était plus vrai, la greffe ne se
 * poserait pas et le reste continuerait de marcher — d'où les vérifications
 * plus bas plutôt qu'une confiance aveugle.
 *
 * TOUT PASSE PAR LE SERVEUR : cette page n'appelle jamais Google, Yahoo ni
 * Boursorama elle-même. Elle demande `/cours/...` à l'application locale, qui va lire (cf.
 * source_cours.py). C'est ce qui permet de dire précisément d'où part chaque
 * requête sortante, et de n'avoir qu'un seul endroit à regarder pour le savoir.
 */

// L'état de cotation par titre : { url_cours, cours_maj_le }, indexé par
// action_id. Tenu à jour à chaque réponse du serveur (toutes en renvoient la
// liste complète), pour que le redessin d'une ligne soit SYNCHRONE — il est
// appelé au milieu du rendu de « placements », qui ne nous attendrait pas.
const coursParTitre = new Map();

// Le dernier compte rendu affiché en haut de page. Gardé pour que rouvrir
// l'écran ne fasse pas disparaître le résultat de la mise à jour au lancement.
let dernierResume = null;

const ID_EXTENSION = "lecture-de-cours";

function actif() {
  return BudgetApp.extensions.estActive(ID_EXTENSION);
}

/* ---------- Serveur ---------- */

function memoriser(titres) {
  coursParTitre.clear();
  (titres || []).forEach((titre) => coursParTitre.set(titre.action_id, titre));
  // Le résumé de la barre découle entièrement de cette table : le remettre à
  // jour ICI, et pas chez chacun des appelants, évite qu'un chemin oublié
  // laisse affiché « 1 titre suivi » sous un titre qu'on vient de détacher.
  majEtatBarre();
}

async function chargerTitres() {
  try {
    memoriser(await apiFetch("/cours/titres"));
  } catch (err) {
    // L'extension désactivée répond 404 : ce n'est pas une panne, c'est un
    // choix de l'utilisateur. La page « placements » continue sans nous.
    console.warn("Cours en ligne indisponibles :", err.message);
  }
}

/* ---------- Fraîcheur d'un cours ---------- */

/**
 * « il y a 3 min », « il y a 2 h », sinon la date complète.
 *
 * Un cours n'intéresse que par sa fraîcheur : « il y a 3 min » se juge d'un
 * coup d'œil là où « 22 Août 2026 14:07 » demande de calculer. Au-delà d'une
 * journée l'écart cesse d'être parlant, et c'est la date qui reprend la main.
 */
function fraicheur(isoDateHeure) {
  if (!isoDateHeure) return t("cours saisi à la main");
  const quand = new Date(isoDateHeure);
  const secondes = (Date.now() - quand.getTime()) / 1000;
  if (secondes < 90) return t("à l'instant");
  if (secondes < 3600) return t("il y a {n} min", { n: Math.round(secondes / 60) });
  if (secondes < 86400) return t("il y a {n} h", { n: Math.round(secondes / 3600) });
  return formatDateHeure(isoDateHeure.slice(0, 19));
}

/* ---------- La barre de mise à jour, en haut de l'écran ---------- */

/**
 * Insérée juste sous le titre de la page, une seule fois.
 *
 * En HAUT et non près des « Titres suivis » (tout en bas) : c'est l'action
 * qu'on vient faire en ouvrant cet écran, et elle doit être là où le regard
 * arrive. Le compte rendu se loge à côté du bouton, pas dans un toast qui
 * s'efface : « 4 cours mis à jour il y a 2 h » est une information qu'on
 * consulte, pas une notification qu'on chasse.
 */
function poserBarre() {
  const section = document.getElementById("section-placements");
  if (!section) return; // extension « placements » absente : rien à greffer
  const existante = document.getElementById("pw-barre");
  if (!actif()) {
    // Désactivée depuis les Paramètres pendant que l'app tourne : la barre
    // disparaît à la prochaine ouverture de l'écran, sans recharger la page.
    if (existante) existante.remove();
    return;
  }
  if (existante) {
    majEtatBarre();
    return;
  }

  const barre = document.createElement("div");
  barre.id = "pw-barre";
  barre.className = "pw-barre";
  barre.innerHTML = `
    <button type="button" id="pw-rafraichir-tout" class="primary">
      ${t("Mettre à jour les cours")}
    </button>
    <span class="hint" id="pw-etat"></span>
  `;
  const titre = section.querySelector("h2");
  titre.insertAdjacentElement("afterend", barre);
  document
    .getElementById("pw-rafraichir-tout")
    .addEventListener("click", () => rafraichir("/cours/rafraichir"));
  majEtatBarre();
}

/** Le texte à côté du bouton : ce que la dernière mise à jour a donné. */
function majEtatBarre() {
  const etat = document.getElementById("pw-etat");
  if (!etat) return;
  const suivis = [...coursParTitre.values()].filter((titre) => titre.url_cours);
  if (suivis.length === 0) {
    etat.textContent = t(
      "Aucun titre n'a de lien : ajoute-en un dans « Titres suivis », en bas de page."
    );
    return;
  }
  const dates = suivis.map((titre) => titre.cours_maj_le).filter(Boolean);
  const derniere = dates.length ? dates.sort().at(-1) : null;
  const morceaux = [
    t("{n} titre(s) suivi(s) en ligne", { n: suivis.length }),
    derniere ? t("dernière lecture {quand}", { quand: fraicheur(derniere) }) : t("jamais lus"),
  ];
  if (dernierResume && dernierResume.echecs > 0) {
    morceaux.push(t("{n} en échec", { n: dernierResume.echecs }));
  }
  etat.textContent = morceaux.join(" — ");
}

/* ---------- Quelles pages coller : l'aide, au-dessus de la liste ---------- */

// Demandées une seule fois par session : la liste ne change qu'avec une
// nouvelle version de l'extension.
let sourcesConnues = null;

/**
 * Les sources reconnues, énoncées AU-DESSUS du premier champ à remplir.
 *
 * Elles viennent du serveur (`GET /cours/sources`) et non d'un texte recopié
 * ici : la liste affichée est alors, littéralement, celle du code qui lit les
 * pages — elle ne peut pas promettre une source qui n'existe plus, ni oublier
 * celle qu'on vient d'ajouter.
 */
async function poserAideSources() {
  const liste = document.getElementById("placements-actions-liste");
  if (!liste) return;
  const existante = document.getElementById("pw-sources");
  if (!actif()) {
    if (existante) existante.remove();
    return;
  }
  if (existante) return;

  if (sourcesConnues === null) {
    try {
      sourcesConnues = await apiFetch("/cours/sources");
    } catch (err) {
      return; // extension éteinte entre-temps : l'aide n'est pas essentielle
    }
  }
  const aide = document.createElement("p");
  aide.id = "pw-sources";
  aide.className = "hint pw-sources";
  aide.innerHTML =
    `<strong>${t("Pages reconnues")}</strong> — ` +
    sourcesConnues
      .map(
        (source) =>
          `${escapeHtml(source.nom)} <code>${escapeHtml(source.exemple)}</code> ` +
          `<em>(${escapeHtml(source.couvre)})</em>`
      )
      .join(" · ");
  liste.insertAdjacentElement("beforebegin", aide);
}

/* ---------- Le champ « lien » sur chaque titre suivi ---------- */

/**
 * Ajoute une seconde ligne à chaque titre de « Titres suivis ».
 *
 * Appelée APRÈS `renderTitresSuivis` de l'extension « placements », qui vient
 * de reconstruire tout le bloc : nos champs doivent donc être reposés à
 * chaque fois, et non ajoutés une bonne fois pour toutes.
 */
function greffeLiens() {
  const bloc = document.getElementById("placements-actions-liste");
  if (!bloc || !actif()) return;

  bloc.querySelectorAll(".import-mapping-row").forEach((ligne) => {
    if (ligne.querySelector(".pw-lien")) return; // déjà greffée
    const champCours = ligne.querySelector("input[data-action='cours']");
    if (!champCours) return;
    const actionId = Number(champCours.dataset.id);
    const titre = coursParTitre.get(actionId) || {};
    const suivi = Boolean(titre.url_cours);

    const greffe = document.createElement("div");
    greffe.className = "pw-lien";
    greffe.innerHTML = `
      <input type="url" class="pw-url" data-pw-url data-id="${actionId}"
             placeholder="${t("Lien de la page de cotation (Google Finance, Yahoo Finance…)")}"
             value="${escapeHtml(titre.url_cours || "")}" />
      <button type="button" data-pw-rafraichir data-id="${actionId}"
              title="${t("Relire le cours maintenant")}" ${suivi ? "" : "disabled"}>
        ${t("Mettre à jour")}
      </button>
      <button type="button" data-pw-retirer data-id="${actionId}"
              title="${t("Ne plus suivre ce cours en ligne")}" ${suivi ? "" : "disabled"}>
        ${t("Détacher")}
      </button>
      <span class="pw-fraicheur">${escapeHtml(
        suivi ? fraicheur(titre.cours_maj_le) : t("cours saisi à la main")
      )}</span>
    `;
    ligne.appendChild(greffe);
  });

  // Le lien est enregistré à la VALIDATION du champ (change), comme le cours
  // juste au-dessus : une URL se colle en une fois, mais se corrige lettre par
  // lettre, et chaque frappe ne doit pas déclencher une lecture.
  bloc.querySelectorAll("input[data-pw-url]").forEach((champ) => {
    champ.addEventListener("change", () => enregistrerLien(champ));
  });
  bloc.querySelectorAll("button[data-pw-rafraichir]").forEach((bouton) => {
    bouton.addEventListener("click", () =>
      rafraichir(`/cours/titres/${bouton.dataset.id}/rafraichir`)
    );
  });
  bloc.querySelectorAll("button[data-pw-retirer]").forEach((bouton) => {
    bouton.addEventListener("click", () => retirerLien(bouton.dataset.id));
  });
}

async function enregistrerLien(champ) {
  const actionId = Number(champ.dataset.id);
  const url = champ.value.trim();
  const precedent = coursParTitre.get(actionId) || {};

  if (!url) {
    if (precedent.url_cours) await retirerLien(actionId);
    return;
  }
  if (url === precedent.url_cours) return; // rien n'a changé

  champ.disabled = true;
  try {
    const reponse = await apiFetch(`/cours/titres/${actionId}`, {
      method: "PUT",
      body: JSON.stringify({ url }),
    });
    appliquerReponse(reponse);
    const lu = reponse.resultats[0];
    const symbole = (coursParTitre.get(actionId) || {}).monnaie_symbole || "";
    // Le nom publié par la source, pas celui du titre : c'est la seule
    // confirmation que le lien collé désigne bien l'instrument voulu.
    showMessage(
      lu && lu.libelle_source
        ? t("Cours lu sur {source} : {nom} — {cours}", {
            source: lu.source,
            nom: lu.libelle_source,
            cours: `${formatQuantite(lu.cours)} ${symbole}`.trim(),
          })
        : t("Lien enregistré"),
      "success"
    );
    await rechargerEcran();
  } catch (err) {
    // Le serveur n'a rien enregistré (cf. routeur_cours.definir_url) : le
    // champ revient à ce qu'il montrait, sans quoi il afficherait un lien que
    // la base ne connaît pas.
    champ.value = precedent.url_cours || "";
    showMessage(err.message, "error");
  } finally {
    champ.disabled = false;
  }
}

async function retirerLien(actionId) {
  try {
    await apiFetch(`/cours/titres/${actionId}`, { method: "DELETE" });
    showMessage(t("Lien retiré — le cours redevient saisi à la main"), "success");
    await chargerTitres();
    await rechargerEcran();
  } catch (err) {
    showMessage(err.message, "error");
  }
}

/* ---------- Rafraîchissement ---------- */

function appliquerReponse(reponse) {
  dernierResume = reponse;
  // Après `dernierResume` : c'est lui que la barre lit pour annoncer les échecs.
  memoriser(reponse.titres);
}

/**
 * Relit des cours et rend compte, titre par titre en cas d'échec.
 *
 * UN TOAST PAR ÉCHEC, un seul pour l'ensemble des réussites : « 4 cours mis à
 * jour » suffit quand tout va bien, alors qu'un échec ne dit quoi faire que
 * s'il nomme le titre ET la raison (lien mort, devise incohérente, site
 * injoignable). Quatre toasts pour quatre problèmes différents valent mieux
 * qu'un « 4 échecs » qu'il faudrait aller élucider ailleurs.
 */
async function rafraichir(route) {
  const bouton = document.getElementById("pw-rafraichir-tout");
  if (bouton) {
    bouton.disabled = true;
    bouton.textContent = t("Lecture en cours…");
  }
  try {
    const reponse = await apiFetch(route, { method: "POST" });
    appliquerReponse(reponse);
    if (reponse.reussis > 0) {
      showMessage(t("{n} cours mis à jour", { n: reponse.reussis }), "success");
    }
    reponse.resultats
      .filter((resultat) => !resultat.ok)
      .forEach((resultat) =>
        showMessage(`${resultat.action_nom} : ${resultat.erreur}`, "warning")
      );
    if (reponse.reussis === 0 && reponse.echecs === 0) {
      showMessage(t("Aucun titre n'a de lien à relire"), "warning");
    }
    // La valorisation, les plus-values et les KPI découlent des cours : la
    // page entière doit se recalculer, pas seulement la ligne du titre.
    await rechargerEcran();
  } catch (err) {
    showMessage(err.message, "error");
  } finally {
    if (bouton) {
      bouton.disabled = false;
      bouton.textContent = t("Mettre à jour les cours");
    }
  }
}

/** Redemande la page « placements » — mais seulement si elle est à l'écran.
 *
 * `.active` et non `display` : c'est par cette classe que le noyau montre et
 * masque ses écrans (cf. app.js::switchSection). Recharger un écran caché
 * ferait travailler le serveur pour un rendu que personne ne regarde, et
 * l'ouverture suivante le referait de toute façon.
 */
async function rechargerEcran() {
  const section = document.getElementById("section-placements");
  if (!section || !section.classList.contains("active")) return;
  if (typeof loadPlacements === "function") await loadPlacements();
}

/**
 * LA MISE À JOUR AU LANCEMENT.
 *
 * Différée d'une seconde et jamais attendue : l'application doit s'ouvrir sur
 * son tableau de bord à la vitesse habituelle, sans dépendre d'un site
 * distant. Trois secondes de lecture réseau au démarrage se remarqueraient
 * immédiatement, et pour un chiffre dont personne n'a besoin dans la seconde.
 *
 * DISCRÈTE QUAND ELLE RÉUSSIT, VISIBLE QUAND ELLE ÉCHOUE : un toast de succès
 * à chaque ouverture deviendrait du bruit, mais un cours qu'on croit frais et
 * qui ne l'est pas est précisément le piège que cette extension doit éviter.
 * Le compte rendu complet, lui, attend sur la page Placements.
 */
async function rafraichirAuLancement() {
  if (!actif()) return;
  try {
    const reponse = await apiFetch("/cours/rafraichir", { method: "POST" });
    appliquerReponse(reponse);
    if (reponse.echecs > 0) {
      showMessage(
        t("{n} cours n'ont pas pu être relus au lancement (voir Placements)", {
          n: reponse.echecs,
        }),
        "warning"
      );
    }
    await rechargerEcran();
  } catch (err) {
    console.warn("Mise à jour des cours au lancement :", err.message);
  }
}

/* ---------- Accroche à l'extension « placements » ---------- */

/**
 * Notre chargeur : celui de « placements », puis la greffe.
 *
 * Les titres sont chargés AVANT, parce que `renderTitresSuivis` (appelée au
 * milieu de `loadPlacements`) lit `coursParTitre` de façon synchrone : sans
 * cela, la première ouverture de l'écran afficherait des champs de lien vides
 * sur des titres qui en ont un.
 */
async function chargerPlacementsAvecCours() {
  if (actif()) await chargerTitres();
  if (typeof loadPlacements === "function") await loadPlacements();
  poserBarre();
  greffeLiens();
  ajusterInfoBulle();
  await poserAideSources();
}

/**
 * L'info-bulle de « Titres suivis » affirme que l'application n'interroge
 * aucun service de marché. C'était vrai, ça ne l'est plus sur cette
 * installation : le texte est réécrit plutôt que laissé à mentir.
 *
 * Réécrit ICI et non dans le HTML de l'autre extension : celle-ci doit rester
 * exacte quand elle est seule, ce qu'elle est chez tous ceux qui n'ont pas
 * installé la nôtre.
 */
let infoBulleOrigine = null;

function ajusterInfoBulle() {
  const bulle = document.querySelector("#section-placements h3 .info-bulle");
  if (!bulle) return;
  // Le texte d'origine est gardé au premier passage : désactiver l'extension
  // doit rendre la page telle qu'elle serait sans elle, texte compris.
  if (infoBulleOrigine === null) infoBulleOrigine = bulle.dataset.info;
  bulle.dataset.info = actif()
    ? t(
        "La liste des titres est commune à tous les comptes de placement. Le cours " +
          "peut être saisi à la main, ou relu automatiquement sur une page publique " +
          "de cotation dont tu colles le lien ci-dessous — c'est la seule chose que " +
          "l'application va chercher sur Internet, et seulement pour les titres qui " +
          "ont un lien. Le cours ne sert qu'à valoriser les portefeuilles : jamais à " +
          "recalculer un solde, qui ne dépend que des prix réellement payés."
      )
    : infoBulleOrigine;
}

/**
 * Pose la greffe sur l'extension « placements ». Rend false si elle n'est pas
 * là — auquel cas il n'y a rien à greffer, et surtout rien à casser.
 *
 * DEUX ACCROCHES, ET RIEN D'AUTRE :
 *
 *   1. `renderTitresSuivis` est ENVELOPPÉE, pour que nos champs soient reposés
 *      après chacun de ses passages (modifier un cours la rappelle) ;
 *   2. le chargeur de « placements » est RÉ-ENREGISTRÉ avec le nôtre, qui
 *      appelle le sien — le retirer casserait son écran.
 *
 * Idempotente : `greffePosee` empêche d'envelopper deux fois la même fonction,
 * ce qui ferait courir la greffe en double à chaque rendu.
 */
let greffePosee = false;

function poserGreffe() {
  if (greffePosee) return true;
  if (typeof renderTitresSuivis !== "function" || typeof loadPlacements !== "function") {
    return false;
  }
  const rendreTitresOrigine = renderTitresSuivis;
  window.renderTitresSuivis = function () {
    rendreTitresOrigine.apply(this, arguments);
    greffeLiens();
  };
  BudgetApp.extensions.enregistrer("placements", { chargeur: chargerPlacementsAvecCours });
  greffePosee = true;
  return true;
}

if (!poserGreffe()) {
  // « placements » n'est pas (encore) chargée : soit elle n'est pas installée,
  // soit elle est éteinte et l'utilisateur va peut-être l'allumer dans un
  // instant. Le noyau prévient quand une extension est chargée à chaud — on
  // réessaie alors, plutôt que d'exiger un redémarrage pour deux cases cochées
  // dans le mauvais ordre.
  console.warn(
    "lecture-de-cours : l'extension « placements » n'est pas chargée, la greffe attend."
  );
  document.addEventListener("budgetapp:extension-chargee", (evenement) => {
    if (evenement.detail && evenement.detail.id === "placements") poserGreffe();
  });
}

// Le lancement de l'application, une fois le reste posé.
setTimeout(rafraichirAuLancement, 1000);
