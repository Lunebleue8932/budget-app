/* ---------- « Lecture de cours » — volet monnaies ----------
 *
 * UNE SECONDE GREFFE, sur un autre hôte. Le fichier voisin
 * (lecture-de-cours.js) ajoute un lien de cotation aux titres de l'extension
 * « placements » ; celui-ci ajoute UNE FAÇON DE SAISIR un taux à l'écran de
 * l'extension « Monnaies ». Les deux volets sont indépendants : avoir l'un des
 * hôtes suffit, et le volet dont l'hôte manque ne pose simplement rien.
 *
 * CE QUI A CHANGÉ, ET POURQUOI. Ce fichier posait autrefois son PROPRE bloc
 * « Taux de change » sous celui de l'extension « Monnaies » : deux listes des
 * mêmes couples, deux formulaires, deux titres identiques l'un sous l'autre.
 * Ce sont pourtant les mêmes taux, dans la même table, qui servent à la même
 * chose — seule la façon de les saisir change. « Monnaies » tient donc
 * désormais le bloc, et nous n'y déclarons qu'un MODE de saisie de plus
 * (`MonnaiesTaux.enregistrer`), à côté de « À la main ».
 *
 * Il reste deux choses qui n'appartiennent qu'à nous, et qui se posent dans
 * l'en-tête que l'hôte réserve : le bouton « Mettre à jour les taux » et son
 * compte rendu.
 *
 * CE BLOC NE CONVERTIT RIEN PAR LUI-MÊME. Les taux servent à la case « tout
 * convertir » du dashboard, apportée par « Monnaies » ; nous ne faisons que les
 * remplir depuis une page de cotation.
 *
 * TOUT PASSE PAR LE SERVEUR : cette page n'appelle jamais un site de cotation
 * elle-même, elle demande `/taux-change/...` à l'application locale.
 */

const ID_HOTE_MONNAIES = "monnaies";
const ID_MODE_LIEN = "lien";

// Le dernier compte rendu de mise à jour. Gardé pour que rouvrir l'écran ne
// fasse pas disparaître le résultat de la mise à jour au lancement.
let dernierResumeTaux = null;
// Les couples suivis EN LIGNE (ceux qui portent un lien), pour le compteur de
// l'en-tête. La liste complète, elle, appartient à l'hôte.
let couplesSuivis = [];

function tauxActif() {
  return (
    BudgetApp.extensions.estActive(ID_EXTENSION) &&
    BudgetApp.extensions.estActive(ID_HOTE_MONNAIES)
  );
}

/* ---------- Le mode de saisie « depuis un lien » ---------- */

/**
 * Déclare (ou retire) notre façon de saisir un taux.
 *
 * Idempotent, et appelé à chaque ouverture de l'écran : c'est ce qui fait
 * apparaître et disparaître le bouton « Depuis un lien » quand on allume ou
 * éteint l'extension, sans recharger la page.
 */
function declarerModeLien() {
  if (typeof window.MonnaiesTaux === "undefined") return;
  if (!tauxActif()) {
    window.MonnaiesTaux.retirer(ID_MODE_LIEN);
    return;
  }
  window.MonnaiesTaux.enregistrer(ID_MODE_LIEN, {
    libelle: "Depuis un lien",
    ordre: 10,
    champsHtml: () => `
      <label for="lc-taux-url">${t("Lien de la page de cotation")}
        <input type="url" id="lc-taux-url" required
               placeholder="${t(
                 "Lien de la page de cotation (Google Finance, Yahoo Finance…)"
               )}" />
      </label>
      <p class="hint" id="lc-taux-sources"></p>`,
    soumettre: enregistrerCoupleDepuisLien,
    // L'aide se remplit APRÈS que le champ est dans la page : elle vient du
    // serveur, et ce mode n'est pas celui affiché au chargement — il n'aurait
    // sinon jamais d'occasion de la poser.
    apresRendu: poserAideSourcesTaux,
  });
}

/**
 * Enregistre le couple et LIT SON TAUX TOUT DE SUITE.
 *
 * Le lien n'est retenu que s'il a donné un nombre (cf. routeur_taux) : un lien
 * accepté sans être essayé ne se découvre cassé que des semaines plus tard,
 * devant un taux qui n'a jamais bougé et qu'on croit juste.
 */
async function enregistrerCoupleDepuisLien({ source, cible }) {
  const champUrl = document.getElementById("lc-taux-url");
  const url = champUrl.value.trim();
  if (!url) throw new Error(t("Colle le lien de la page de cotation."));

  const reponse = await apiFetch("/taux-change", {
    method: "POST",
    body: JSON.stringify({
      monnaie_source_id: source,
      monnaie_cible_id: cible,
      url,
    }),
  });
  memoriserResume(reponse);
  champUrl.value = "";
  const lu = reponse.resultats[0];
  return lu
    ? t("Taux lu sur {source} : {libelle} = {taux}", {
        source: lu.source,
        libelle: lu.libelle,
        taux: formatQuantite(lu.taux),
      })
    : t("Couple enregistré");
}

/**
 * Les sources reconnues, sous le champ à remplir. Même liste que pour les
 * titres — c'est le même lecteur — et elle vient du serveur plutôt que d'un
 * texte recopié ici, qui pourrait promettre une source disparue.
 */
async function poserAideSourcesTaux() {
  const cible = document.getElementById("lc-taux-sources");
  if (!cible || cible.dataset.rempli) return;
  try {
    const sources = await apiFetch("/taux-change/sources");
    // UNE SEULE COULEUR, comme la liste des sources de l'écran des placements :
    // mêler du `<code>` et de l'italique sur une ligne d'aide donne trois
    // traitements pour une seule information.
    cible.textContent =
      t("Pages reconnues") + " — " + sources.map((source) => source.nom).join(", ");
    cible.dataset.rempli = "1";
  } catch (err) {
    /* L'aide n'est pas essentielle : une extension éteinte entre-temps, ou une
       route fermée, ne doit pas empêcher la saisie de fonctionner. */
  }
}

/* ---------- L'en-tête : mettre à jour ce qui est suivi ---------- */

/**
 * Pose (ou retire) le bouton de mise à jour dans l'en-tête que l'hôte réserve.
 *
 * Idempotente : appelée à chaque ouverture de l'écran, elle ne recrée pas ce
 * qui est déjà là. Elle RETIRE en revanche le bloc quand l'extension vient
 * d'être décochée, sans quoi il resterait affiché jusqu'au rechargement de la
 * page — et son bouton répondrait 404.
 */
function poserEnteteTaux() {
  const hote = document.getElementById("monnaies-taux-entete");
  if (!hote) return; // extension « Monnaies » absente : rien à greffer
  const existant = document.getElementById("lc-taux-barre");
  if (!tauxActif()) {
    if (existant) existant.remove();
    return;
  }
  if (existant) {
    majEtatTaux();
    return;
  }

  const barre = document.createElement("div");
  barre.id = "lc-taux-barre";
  barre.className = "lc-taux-barre";
  barre.innerHTML = `
    <button type="button" id="lc-taux-rafraichir">${t("Mettre à jour les taux")}</button>
    <span class="hint" id="lc-taux-etat"></span>
  `;
  hote.appendChild(barre);
  document
    .getElementById("lc-taux-rafraichir")
    .addEventListener("click", () => rafraichirTaux("/taux-change/rafraichir"));
  majEtatTaux();
}

function majEtatTaux() {
  const etat = document.getElementById("lc-taux-etat");
  if (!etat) return;
  if (couplesSuivis.length === 0) {
    etat.textContent = t(
      "Aucun taux relu en ligne : choisis « Depuis un lien » pour en suivre un."
    );
    return;
  }
  const morceaux = [
    t("{n} couple(s) suivi(s)", { n: couplesSuivis.length }),
    dernierResumeTaux && dernierResumeTaux.horodatage
      ? t("mis à jour {quand}", { quand: fraicheur(dernierResumeTaux.horodatage) })
      : t("jamais mis à jour"),
  ];
  if (dernierResumeTaux && dernierResumeTaux.echecs > 0) {
    morceaux.push(t("{n} en échec", { n: dernierResumeTaux.echecs }));
  }
  etat.textContent = morceaux.join(" — ");
}

/* ---------- Serveur ---------- */

function memoriserResume(reponse) {
  dernierResumeTaux = reponse;
  couplesSuivis = (reponse.taux || []).filter((couple) => couple.url_cours);
  majEtatTaux();
}

async function chargerCouples() {
  if (!tauxActif()) return;
  try {
    // `/taux-change` ne rend QUE les couples porteurs d'un lien : c'est
    // exactement ce que cet en-tête compte (cf. service_taux.couples_suivis).
    couplesSuivis = await apiFetch("/taux-change");
    majEtatTaux();
  } catch (err) {
    /* Extension éteinte entre-temps, ou hôte absent : l'en-tête reste vide
       plutôt que d'afficher une erreur sur un écran qui n'a rien demandé. */
  }
}

async function rafraichirTaux(url) {
  const bouton = document.getElementById("lc-taux-rafraichir");
  if (bouton) bouton.disabled = true;
  try {
    const reponse = await apiFetch(url, { method: "POST" });
    memoriserResume(reponse);
    // La liste des couples appartient à l'hôte : c'est lui qui la redessine,
    // avec les nouveaux taux.
    if (window.MonnaiesTaux) await window.MonnaiesTaux.rafraichir();
    // Les échecs sont NOMMÉS : « 1 en échec » ne dit pas quel couple, et un
    // lien cassé se corrige d'autant plus vite qu'on sait lequel.
    const echecs = (reponse.resultats || []).filter((r) => !r.ok);
    if (echecs.length > 0) {
      showMessage(
        echecs.map((r) => `${r.libelle} : ${r.erreur}`).join(" · "),
        "error"
      );
    } else if (reponse.reussis > 0) {
      showMessage(t("{n} taux mis à jour", { n: reponse.reussis }), "success");
    }
  } catch (err) {
    showMessage(err.message, "error");
  } finally {
    if (bouton) bouton.disabled = false;
  }
}

/* ---------- La greffe ---------- */

let greffeMonnaiesPosee = false;

/**
 * Notre chargeur pour l'écran des monnaies : celui de l'hôte, puis le nôtre.
 *
 * `chargeurMonnaiesOrigine` est capturé au moment où la greffe se pose, et non
 * appelé par son nom : « Monnaies » enregistre `loadMonnaies`, mais rien ne
 * garantit qu'une autre greffe ne l'ait pas déjà remplacé — chaîner ce qui est
 * enregistré est ce qui permet à deux greffes de coexister.
 */
let chargeurMonnaiesOrigine = null;

async function chargerMonnaiesAvecTaux() {
  if (typeof chargeurMonnaiesOrigine === "function") await chargeurMonnaiesOrigine();
  // DÉCLARÉ AVANT l'en-tête : le mode décide de ce que la barre de saisie
  // propose, et l'en-tête ne fait que compter ce qui est suivi.
  declarerModeLien();
  poserEnteteTaux();
  if (!tauxActif()) return;
  await chargerCouples();
}

function poserGreffeMonnaies() {
  if (greffeMonnaiesPosee) return true;
  if (typeof loadMonnaies !== "function") return false;
  chargeurMonnaiesOrigine = loadMonnaies;
  BudgetApp.extensions.enregistrer(ID_HOTE_MONNAIES, { chargeur: chargerMonnaiesAvecTaux });
  greffeMonnaiesPosee = true;
  return true;
}

if (!poserGreffeMonnaies()) {
  // « Monnaies » n'est pas (encore) chargée : soit elle n'est pas installée,
  // soit elle est éteinte et l'utilisateur va peut-être l'allumer dans un
  // instant. Le noyau prévient quand une extension est chargée à chaud.
  document.addEventListener("budgetapp:extension-chargee", (evenement) => {
    if (evenement.detail && evenement.detail.id === ID_HOTE_MONNAIES) poserGreffeMonnaies();
  });
}
