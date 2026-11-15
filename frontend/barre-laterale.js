/* ====================================================================================
 * LE BAS DE LA BARRE LATÉRALE : « Mindmap » et « Découvrir l'app »
 *
 * DEUX FENÊTRES, rien d'autre ici :
 *   - « Découvrir l'app » réunit les trois portes qui étaient dans la barre (premier import,
 *     tutoriels, démo). Elles gardent leurs identifiants : leurs écouteurs (premier-demarrage.js,
 *     sandbox.js) n'ont rien à savoir du déménagement. Un clic sur l'une d'elles ferme la
 *     fenêtre — ce qu'elle ouvre (un guide, une démo) prend la suite.
 *   - « Mindmap » montre le plan de l'application (cf. plan-app.js). Il se redessine à chaque
 *     ouverture : la fenêtre étant masquée entre-temps, il n'avait aucune largeur pour se
 *     centrer sur le Dashboard.
 * Chargé après plan-app.js et sandbox.js.
 * ==================================================================================== */

function barreOuvrirFenetre(id) {
  const fond = document.getElementById(id);
  if (!fond) return;
  fond.style.display = "flex";
  document.body.classList.add("modale-ouverte");
}

function barreFermerFenetre(id) {
  const fond = document.getElementById(id);
  if (!fond) return;
  fond.style.display = "none";
  // Le blocage du défilement ne se lève que si plus AUCUNE fenêtre n'est visible. On lit l'affichage
  // CALCULÉ : certaines fenêtres n'ont pas de `style` en ligne et se masquent autrement, ce qui
  // laissait le blocage en place — et plus aucune page ne défilait.
  const encoreOuverte = [...document.querySelectorAll(".modale-fond")].some(
    (m) => getComputedStyle(m).display !== "none"
  );
  if (!encoreOuverte) document.body.classList.remove("modale-ouverte");
}

function barreCabler(idFenetre, idBouton, idFermer, aLOuverture) {
  const fond = document.getElementById(idFenetre);
  if (!fond) return;
  document.getElementById(idBouton)?.addEventListener("click", () => {
    barreOuvrirFenetre(idFenetre);
    if (aLOuverture) aLOuverture();
  });
  document.getElementById(idFermer)?.addEventListener("click", () => barreFermerFenetre(idFenetre));
  // Un clic sur le fond (hors de la fenêtre) la ferme, comme Échap.
  fond.addEventListener("mousedown", (e) => {
    if (e.target === fond) barreFermerFenetre(idFenetre);
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && fond.style.display !== "none") barreFermerFenetre(idFenetre);
  });
}

barreCabler("modale-mindmap", "btn-mindmap", "btn-mindmap-fermer", () => {
  if (typeof renderPlanApplication === "function") renderPlanApplication();
});
barreCabler("modale-decouvrir", "btn-decouvrir", "btn-decouvrir-fermer");

// Chaque porte, une fois cliquée, referme la fenêtre qui la contenait.
document.getElementById("modale-decouvrir")?.addEventListener("click", (e) => {
  if (e.target.closest("button[id^='btn-']:not(#btn-decouvrir-fermer)")) barreFermerFenetre("modale-decouvrir");
});

// Mindmap : en ouvrant une page depuis le plan, la fenêtre se ferme.
document.getElementById("modale-mindmap")?.addEventListener("click", (e) => {
  if (e.target.closest(".plan-noeud")) barreFermerFenetre("modale-mindmap");
});

/* ---------- Le lien « Feedback » : une confirmation, avec l'adresse ----------
 *
 * Le lien mène HORS de l'application. Avant de l'ouvrir, une fenêtre le dit et montre l'adresse
 * complète — on voit où l'on va. `lien-feedback` garde son `href` : c'est le seul endroit où l'adresse
 * est écrite.
 */
let barreAdresseExterne = null;

function demanderConfirmationLienExterne(adresse) {
  barreAdresseExterne = adresse;
  const lien = document.getElementById("modale-feedback-lien");
  if (lien) lien.textContent = adresse;
  barreOuvrirFenetre("modale-feedback");
  document.getElementById("btn-feedback-ouvrir")?.focus();
}

barreCabler("modale-feedback", null, "btn-feedback-annuler");
document.getElementById("btn-feedback-ouvrir")?.addEventListener("click", () => {
  const adresse = barreAdresseExterne;
  barreFermerFenetre("modale-feedback");
  if (adresse) ouvrirLienExterne(adresse);
});
