/* ---------- LA DÉMO (la sandbox) ----------
 *
 * Une base de démonstration, remplie de données fictives, où l'on peut tout essayer sans toucher
 * à ses vraies données (cf. backend/app/services/base_sandbox.py et routers/sandbox.py).
 *
 * LE SERVEUR EST LA SEULE MÉMOIRE DE « SUIS-JE DANS LA DÉMO ? », comme pour la base de découverte
 * des tutoriels (cf. tutoriel.js) : entrer et sortir rechargent la page, parce que tout ce que
 * l'écran avait chargé (comptes, soldes, période) appartient à l'autre base. Au chargement,
 * `GET /sandbox` dit où l'on est, et la pastille se pose en conséquence.
 *
 * LA PASTILLE VIT DANS L'EN-TÊTE FIGÉ DE CHAQUE PAGE (`.page-entete`), au milieu, en jaune : on ne
 * peut pas l'oublier, et elle ne se masque pas. Les pages que les extensions apportent arrivent
 * après coup : un observateur en pose une sur chaque en-tête qui apparaît.
 *
 * `BudgetApp.confirmerEnSandbox(opération)` est le POINT DE PASSAGE des gestes importants (import,
 * copie de données…) : hors démo il rend `true` sans rien dire, dans la démo il rappelle où l'on est
 * et demande de confirmer. Générique à dessein - ce qui l'appelle (le noyau, une extension) n'a pas
 * à savoir ce qu'est la démo.
 *
 * Chargé APRÈS app.js (`apiFetch`, `showMessage`, `t`, `texteAide`, `ecrireTexteAide`, `langue`).
 */
const CLE_MESSAGE_SANDBOX = "budget-app.sandbox-message";

BudgetApp.sandbox = { actif: false, etat: null };

function sandboxPastilleHtml(etat) {
  const aRafraichir = !!(etat && etat.a_rafraichir);
  const astuce = aRafraichir
    ? t(texteAide(etat.raison === "nouvelle_version" ? "noyau.sandbox-version" : "noyau.sandbox-ancienne"))
    : "";
  return `
    <span class="pastille-sandbox-titre">${t("Mode démo")}</span>
    <i class="info-bulle" tabindex="0" data-info="${escapeHtml(t(texteAide("noyau.sandbox-pastille")))}">i</i>
    <button type="button" class="pastille-sandbox-bouton${aRafraichir ? " a-rafraichir" : ""}"
            data-sandbox="reinitialiser"${astuce ? ` title="${escapeHtml(astuce)}"` : ""}>${t("Réinitialiser")}</button>
    <button type="button" class="pastille-sandbox-bouton principal" data-sandbox="quitter">${t("Revenir à mes données")}</button>`;
}

/** Pose une pastille sur chaque en-tête figé qui n'en a pas encore. */
function poserPastillesSandbox() {
  if (!BudgetApp.sandbox.actif) return;
  document.querySelectorAll(".page-entete").forEach((entete) => {
    if (entete.querySelector(":scope > .pastille-sandbox")) return;
    const pastille = document.createElement("div");
    pastille.className = "pastille-sandbox";
    pastille.setAttribute("role", "status");
    pastille.innerHTML = sandboxPastilleHtml(BudgetApp.sandbox.etat);
    entete.appendChild(pastille);
  });
}

/** Les deux endroits qui proposent d'entrer dans la démo, masqués une fois dedans. */
function majEntreesSandbox() {
  const dedans = BudgetApp.sandbox.actif;
  document.querySelectorAll("[data-sandbox-entree]").forEach((el) => {
    el.style.display = dedans ? "none" : "";
  });
}

function occuperSandbox(bouton, occupe) {
  document.body.classList.toggle("sandbox-occupee", occupe);
  document.querySelectorAll("[data-sandbox], #btn-sandbox-entrer, #btn-modale-bdd-demo").forEach((b) => {
    b.disabled = occupe;
  });
  if (bouton) {
    if (occupe) {
      bouton.dataset.libelle = bouton.textContent;
      bouton.textContent = t("Préparation de la démo…");
    } else if (bouton.dataset.libelle) {
      bouton.textContent = bouton.dataset.libelle;
    }
  }
}

function noterMessageSandbox(texte) {
  try {
    sessionStorage.setItem(CLE_MESSAGE_SANDBOX, JSON.stringify({ message: texte }));
  } catch (err) {
    // Stockage indisponible : on recharge sans message, rien de cassé.
  }
}

async function entrerSandbox(bouton) {
  occuperSandbox(bouton, true);
  try {
    const etat = await apiFetch(`/sandbox/entrer?langue=${encodeURIComponent(langue())}`, {
      method: "POST",
    });
    if (etat.recreee) noterMessageSandbox(t(texteAide("noyau.sandbox-refaite")));
    window.location.reload();
  } catch (err) {
    occuperSandbox(bouton, false);
    showMessage(err.message, "error");
  }
}

async function quitterSandbox() {
  occuperSandbox(null, true);
  try {
    await apiFetch("/sandbox/quitter", { method: "POST" });
    window.location.reload();
  } catch (err) {
    occuperSandbox(null, false);
    showMessage(err.message, "error");
  }
}

async function reinitialiserSandbox(bouton) {
  const accord = await demanderAccordSandbox({
    titre: t("Réinitialiser la démo ?"),
    texte: texteAide("noyau.sandbox-reinitialiser"),
    libelleConfirmer: t("Réinitialiser"),
  });
  if (!accord) return;
  occuperSandbox(bouton, true);
  try {
    await apiFetch(`/sandbox/reinitialiser?langue=${encodeURIComponent(langue())}`, { method: "POST" });
    window.location.reload();
  } catch (err) {
    occuperSandbox(bouton, false);
    showMessage(err.message, "error");
  }
}

/* ---------- La fenêtre de confirmation ---------- */

let sandboxAccordEnCours = null;

/**
 * Ouvre la fenêtre du rappel (une seule, réécrite à chaque fois) et rend une promesse : `true` si
 * l'utilisateur confirme, `false` s'il annule, ferme ou appuie sur Échap.
 */
function demanderAccordSandbox({ titre, texte, libelleConfirmer }) {
  const fond = document.getElementById("modale-sandbox");
  if (!fond) return Promise.resolve(true);
  if (sandboxAccordEnCours) sandboxAccordEnCours(false);
  document.getElementById("modale-sandbox-titre").textContent = titre;
  ecrireTexteAide(document.getElementById("modale-sandbox-texte"), t(texte));
  const confirmer = document.getElementById("btn-modale-sandbox-continuer");
  confirmer.textContent = libelleConfirmer;
  fond.style.display = "flex";
  confirmer.focus();
  return new Promise((resolve) => {
    const fermer = (reponse) => {
      fond.style.display = "none";
      fond.removeEventListener("click", surFond);
      document.removeEventListener("keydown", surTouche, true);
      confirmer.removeEventListener("click", surConfirmer);
      document.getElementById("btn-modale-sandbox-annuler").removeEventListener("click", surAnnuler);
      sandboxAccordEnCours = null;
      resolve(reponse);
    };
    const surFond = (e) => {
      if (e.target === fond) fermer(false);
    };
    const surTouche = (e) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        fermer(false);
      }
    };
    const surConfirmer = () => fermer(true);
    const surAnnuler = () => fermer(false);
    sandboxAccordEnCours = fermer;
    fond.addEventListener("click", surFond);
    document.addEventListener("keydown", surTouche, true);
    confirmer.addEventListener("click", surConfirmer);
    document.getElementById("btn-modale-sandbox-annuler").addEventListener("click", surAnnuler);
  });
}

/**
 * Le rappel des gestes importants. Hors démo : `true`, sans un mot. Dans la démo : la fenêtre, et la
 * réponse de l'utilisateur. `operation` ne sert qu'à l'appelant pour se repérer ; le texte est le
 * même pour tous, c'est le rappel d'où l'on est qui compte.
 */
BudgetApp.confirmerEnSandbox = async function confirmerEnSandbox(operation) {
  if (BudgetApp.sandboxPret) {
    try {
      await BudgetApp.sandboxPret;
    } catch (err) {
      return true;
    }
  }
  if (!BudgetApp.sandbox.actif) return true;
  return demanderAccordSandbox({
    titre: t("Tu es dans la démo"),
    texte: texteAide("noyau.sandbox-rappel"),
    libelleConfirmer: t("Continuer dans la démo"),
  });
};

/* ---------- Câblage ---------- */

document.addEventListener("click", (e) => {
  const bouton = e.target.closest("[data-sandbox]");
  if (!bouton) return;
  if (bouton.dataset.sandbox === "quitter") quitterSandbox();
  if (bouton.dataset.sandbox === "reinitialiser") reinitialiserSandbox(bouton);
});

["btn-sandbox-entrer", "btn-modale-bdd-demo"].forEach((id) => {
  const bouton = document.getElementById(id);
  if (bouton) bouton.addEventListener("click", () => entrerSandbox(bouton));
});

BudgetApp.sandboxPret = (async function initSandbox() {
  try {
    const etat = await apiFetch("/sandbox");
    BudgetApp.sandbox = { actif: !!etat.actif, etat };
  } catch (err) {
    // Le serveur ne répond pas : l'application le dit déjà, la démo n'a rien à ajouter.
    return;
  }
  majEntreesSandbox();
  let message = null;
  try {
    message = JSON.parse(sessionStorage.getItem(CLE_MESSAGE_SANDBOX) || "null");
    sessionStorage.removeItem(CLE_MESSAGE_SANDBOX);
  } catch (err) {
    message = null;
  }
  if (message && message.message) showMessage(message.message, "success");
  if (!BudgetApp.sandbox.actif) return;
  document.body.classList.add("en-sandbox");
  poserPastillesSandbox();
  // Les pages des extensions arrivent après le chargement : chacune reçoit sa pastille.
  const main = document.querySelector("main");
  if (main) {
    let planifie = false;
    new MutationObserver(() => {
      if (planifie) return;
      planifie = true;
      requestAnimationFrame(() => {
        planifie = false;
        poserPastillesSandbox();
      });
    }).observe(main, { childList: true, subtree: true });
  }
})();
