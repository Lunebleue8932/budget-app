/* ---------- LE CALENDRIER DES CHAMPS DE DATE ----------
 *
 * POURQUOI. Le sélecteur de date natif s'ouvre dans une fenêtre que le navigateur dessine : ses couleurs
 * suivent `color-scheme`, mais ni sa typographie, ni ses arrondis, ni son accent ne sont ceux de
 * l'application, et aucun CSS ne l'atteint. Ce fichier le REMPLACE par un calendrier dessiné ici, aux
 * variables de style.css, pour TOUS les `<input type="date">` — présents ou créés plus tard (formulaires
 * des extensions, lignes en édition, fenêtres de l'import) — sans qu'aucun n'ait à s'en occuper : tout passe
 * par la délégation d'événements du document.
 *
 * CE QUI NE CHANGE PAS : le champ reste un `<input type="date">`. On y saisit toujours au clavier (jour,
 * mois, année), `min`, `max` et `required` sont respectés, et la valeur s'écrit « AAAA-MM-JJ » comme avant.
 * Seul le pictogramme natif est masqué (cf. style.css) au profit du nôtre, posé en fond du champ : un clic
 * dessus — à droite du champ — ouvre le calendrier ; Alt + ↓ aussi. Choisir un jour écrit la valeur et
 * déclenche `input` puis `change`, comme le faisait le navigateur.
 *
 * LES JOURS SONT DES DATES LOCALES, jamais des instants UTC : « 2026-11-01 » reconstruit par `new Date(...)`
 * sans précaution tombe la veille à l'ouest de Greenwich.
 */
(() => {
  "use strict";

  const LARGEUR_ICONE_PX = 34;
  const ANNEES_PROPOSEES = 12;

  const pad = (n) => String(n).padStart(2, "0");
  const enIso = (date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

  /** « AAAA-MM-JJ » → { annee, mois (0-11), jour }, ou null. */
  function analyser(valeur) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(valeur || "");
    return m ? { annee: Number(m[1]), mois: Number(m[2]) - 1, jour: Number(m[3]) } : null;
  }

  // La langue de l'application (cf. app.js) ; le lundi ouvre la semaine sauf en anglais.
  const langueApp = () => (typeof langue === "function" ? langue() : "fr");
  const premierJourSemaine = () => (String(langueApp()).startsWith("en") ? 0 : 1);
  const traduire = (texte) => (typeof t === "function" ? t(texte) : texte);

  let popup = null;
  let champ = null;
  // Le mois affiché (indépendant de la valeur : on feuillette sans rien choisir).
  let vue = { annee: 0, mois: 0 };

  function dansLesBornes(iso) {
    if (champ.min && iso < champ.min) return false;
    if (champ.max && iso > champ.max) return false;
    return true;
  }

  function nomsDesMois() {
    const format = new Intl.DateTimeFormat(langueApp(), { month: "long" });
    return Array.from({ length: 12 }, (_, i) => format.format(new Date(2021, i, 1)));
  }

  function initialesDesJours() {
    const format = new Intl.DateTimeFormat(langueApp(), { weekday: "short" });
    const debut = premierJourSemaine();
    // Le 3 janvier 2021 est un dimanche.
    return Array.from({ length: 7 }, (_, i) => format.format(new Date(2021, 0, 3 + ((debut + i) % 7))));
  }

  function dessiner() {
    const mois = nomsDesMois();
    const aujourdhui = enIso(new Date());
    const choisi = champ.value;
    const debut = premierJourSemaine();
    const decalage = (new Date(vue.annee, vue.mois, 1).getDay() - debut + 7) % 7;

    const optionsMois = mois
      .map((nom, i) => `<option value="${i}"${i === vue.mois ? " selected" : ""}>${nom}</option>`)
      .join("");
    let optionsAnnees = "";
    for (let a = vue.annee - ANNEES_PROPOSEES; a <= vue.annee + ANNEES_PROPOSEES; a++) {
      optionsAnnees += `<option value="${a}"${a === vue.annee ? " selected" : ""}>${a}</option>`;
    }

    let jours = "";
    for (let i = 0; i < 42; i++) {
      const date = new Date(vue.annee, vue.mois, 1 - decalage + i);
      const iso = enIso(date);
      const classes = ["calendrier-jour"];
      if (date.getMonth() !== vue.mois) classes.push("calendrier-hors-mois");
      if (iso === aujourdhui) classes.push("calendrier-aujourdhui");
      if (iso === choisi) classes.push("calendrier-choisi");
      jours += `<button type="button" class="${classes.join(" ")}" data-iso="${iso}"${
        dansLesBornes(iso) ? "" : " disabled"
      }>${date.getDate()}</button>`;
    }

    popup.innerHTML = `
      <div class="calendrier-entete">
        <button type="button" class="calendrier-fleche" data-pas="-1" aria-label="${traduire("Mois précédent")}">‹</button>
        <select class="calendrier-mois" aria-label="${traduire("Mois")}">${optionsMois}</select>
        <select class="calendrier-annee" aria-label="${traduire("Année")}">${optionsAnnees}</select>
        <button type="button" class="calendrier-fleche" data-pas="1" aria-label="${traduire("Mois suivant")}">›</button>
      </div>
      <div class="calendrier-semaine">${initialesDesJours().map((j) => `<span>${j}</span>`).join("")}</div>
      <div class="calendrier-grille">${jours}</div>
      <div class="calendrier-pied">
        <button type="button" data-action="aujourdhui"${dansLesBornes(aujourdhui) ? "" : " disabled"}>${traduire("Aujourd'hui")}</button>
        ${champ.required ? "" : `<button type="button" data-action="effacer">${traduire("Effacer")}</button>`}
      </div>`;
  }

  function placer() {
    const r = champ.getBoundingClientRect();
    const p = popup.getBoundingClientRect();
    let haut = r.bottom + 4;
    // Pas la place dessous : au-dessus du champ, s'il y en a.
    if (haut + p.height > window.innerHeight - 8 && r.top - 4 - p.height >= 8) haut = r.top - 4 - p.height;
    // `clientWidth` : la largeur sans la barre de défilement de la page, que le calendrier ne doit pas recouvrir.
    const gauche = Math.max(8, Math.min(r.left, document.documentElement.clientWidth - p.width - 8));
    popup.style.top = `${Math.max(8, haut)}px`;
    popup.style.left = `${gauche}px`;
  }

  function fermer({ rendreLeFocus = false } = {}) {
    if (!popup) return;
    popup.remove();
    popup = null;
    const ancien = champ;
    champ = null;
    if (rendreLeFocus && ancien) ancien.focus();
  }

  function ouvrir(cible) {
    if (cible.disabled || cible.readOnly) return;
    fermer();
    champ = cible;
    const depart = analyser(cible.value) || analyser(enIso(new Date()));
    vue = { annee: depart.annee, mois: depart.mois };
    popup = document.createElement("div");
    popup.className = "calendrier-popup";
    popup.setAttribute("role", "dialog");
    popup.setAttribute("aria-label", traduire("Calendrier"));
    document.body.appendChild(popup);
    dessiner();
    placer();
    const cibleFocus = popup.querySelector(".calendrier-choisi, .calendrier-aujourdhui:not(.calendrier-hors-mois)");
    if (cibleFocus && !cibleFocus.disabled) cibleFocus.focus({ preventScroll: true });
  }

  function choisir(valeur) {
    const cible = champ;
    cible.value = valeur;
    fermer({ rendreLeFocus: true });
    cible.dispatchEvent(new Event("input", { bubbles: true }));
    cible.dispatchEvent(new Event("change", { bubbles: true }));
  }

  function aller(annee, mois) {
    const date = new Date(annee, mois, 1);
    vue = { annee: date.getFullYear(), mois: date.getMonth() };
    dessiner();
    placer();
  }

  // Un clic sur le pictogramme (la bande de droite du champ) ouvre ou referme le calendrier.
  document.addEventListener(
    "click",
    (e) => {
      const cible = e.target;
      if (!(cible instanceof HTMLInputElement) || cible.type !== "date") return;
      const r = cible.getBoundingClientRect();
      if (e.clientX < r.right - LARGEUR_ICONE_PX) return;
      e.preventDefault();
      if (champ === cible) fermer();
      else ouvrir(cible);
    },
    true
  );

  document.addEventListener("keydown", (e) => {
    const cible = e.target;
    if (!popup) {
      if (e.altKey && e.key === "ArrowDown" && cible instanceof HTMLInputElement && cible.type === "date") {
        e.preventDefault();
        ouvrir(cible);
      }
      return;
    }
    if (e.key === "Escape") {
      // Avant tout autre écouteur : Échap referme le calendrier, pas la fenêtre qui le porte.
      e.preventDefault();
      e.stopPropagation();
      fermer({ rendreLeFocus: true });
      return;
    }
    if (!popup.contains(cible) || !cible.classList.contains("calendrier-jour")) return;
    const pas = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 }[e.key];
    if (!pas) return;
    e.preventDefault();
    const d = analyser(cible.dataset.iso);
    const suivant = new Date(d.annee, d.mois, d.jour + pas);
    if (suivant.getFullYear() !== vue.annee || suivant.getMonth() !== vue.mois) {
      aller(suivant.getFullYear(), suivant.getMonth());
    }
    const bouton = popup.querySelector(`[data-iso="${enIso(suivant)}"]`);
    if (bouton && !bouton.disabled) bouton.focus();
  }, true);

  document.addEventListener(
    "mousedown",
    (e) => {
      if (!popup || popup.contains(e.target) || e.target === champ) return;
      fermer();
    },
    true
  );

  window.addEventListener("resize", () => fermer());
  // La page défile (le clic qui ouvre le calendrier peut lui-même faire défiler jusqu'au champ) : le
  // calendrier suit son champ, ou se referme si le champ a quitté la page. Défiler ce qu'il contient
  // ne le touche pas.
  window.addEventListener("scroll", (e) => {
    if (!popup || popup.contains(e.target)) return;
    if (!champ.isConnected) fermer();
    else placer();
  }, true);

  document.addEventListener("click", (e) => {
    if (!popup || !popup.contains(e.target)) return;
    const jour = e.target.closest(".calendrier-jour");
    if (jour && !jour.disabled) return choisir(jour.dataset.iso);
    const fleche = e.target.closest(".calendrier-fleche");
    if (fleche) return aller(vue.annee, vue.mois + Number(fleche.dataset.pas));
    const action = e.target.closest("[data-action]");
    if (!action || action.disabled) return;
    if (action.dataset.action === "aujourdhui") choisir(enIso(new Date()));
    else if (action.dataset.action === "effacer") choisir("");
  });

  document.addEventListener("change", (e) => {
    if (!popup || !popup.contains(e.target)) return;
    // Les menus du calendrier ne sont pas des champs de l'application : leur changement ne sort pas d'ici.
    e.stopPropagation();
    if (e.target.classList.contains("calendrier-mois")) aller(vue.annee, Number(e.target.value));
    else if (e.target.classList.contains("calendrier-annee")) aller(Number(e.target.value), vue.mois);
  }, true);
})();
