/* ---------- « Lecture de cours » — volet monnaies ----------
 *
 * UNE SECONDE GREFFE, sur un autre hôte. Le fichier voisin
 * (lecture-de-cours.js) ajoute un lien de cotation aux titres de l'extension
 * « placements » ; celui-ci ajoute un bloc « Taux de change » à l'écran de
 * l'extension « Monnaies ». Les deux volets sont indépendants : avoir l'un des
 * hôtes suffit, et le volet dont l'hôte manque ne pose simplement rien.
 *
 * CE BLOC NE CONVERTIT RIEN. Aucun solde, aucun KPI, aucun budget de
 * l'application n'utilise les taux affichés ici — ils restent suivis monnaie
 * par monnaie, comme ils l'ont toujours été. Le taux est une information qu'on
 * vient lire, pas un opérateur qu'on introduit dans les calculs : lui faire
 * additionner deux devises reviendrait à défaire le choix central de l'app
 * (cf. service_taux.py).
 *
 * MÊME MÉCANIQUE DE GREFFE que pour les titres : on ré-enregistre le chargeur
 * de « monnaies » avec le nôtre, qui appelle le sien puis pose le bloc. Voir
 * l'en-tête de lecture-de-cours.js pour le détail, et extensions/README.md
 * pour les deux prises que le noyau laisse ouvertes.
 *
 * TOUT PASSE PAR LE SERVEUR : cette page n'appelle jamais un site de cotation
 * elle-même, elle demande `/taux-change/...` à l'application locale.
 */

const ID_HOTE_MONNAIES = "monnaies";

// Le dernier état connu des couples suivis, et le dernier compte rendu.
// Gardés pour que rouvrir l'écran ne fasse pas disparaître le résultat de la
// mise à jour au lancement.
let couplesSuivis = [];
let dernierResumeTaux = null;

function tauxActif() {
  return (
    BudgetApp.extensions.estActive(ID_EXTENSION) &&
    BudgetApp.extensions.estActive(ID_HOTE_MONNAIES)
  );
}

/* ---------- Le bloc, posé sous la liste des monnaies ---------- */

/**
 * Pose (ou retire) le bloc « Taux de change » dans l'écran des monnaies.
 *
 * Idempotente : appelée à chaque ouverture de l'écran, elle ne recrée pas ce
 * qui est déjà là. Elle RETIRE en revanche le bloc quand l'extension vient
 * d'être décochée, sans quoi il resterait affiché jusqu'au rechargement de la
 * page — et ses boutons répondraient 404.
 */
function poserBlocTaux() {
  const section = document.getElementById("sous-section-parametres-monnaies");
  if (!section) return; // extension « Monnaies » absente : rien à greffer
  const existant = document.getElementById("lc-taux");
  if (!tauxActif()) {
    if (existant) existant.remove();
    return;
  }
  if (existant) return;

  const bloc = document.createElement("div");
  bloc.id = "lc-taux";
  bloc.className = "lc-taux";
  bloc.innerHTML = `
    <h3>${t("Taux de change")}</h3>
    <p class="hint">
      ${t(
        "Le taux d'un couple de monnaies, relu sur la page de cotation dont tu colles le lien. " +
          "Rien n'est converti avec : les soldes, les budgets et les KPI restent suivis monnaie " +
          "par monnaie, et ce taux ne sert qu'à être lu ici."
      )}
    </p>
    <p class="hint" id="lc-taux-sources"></p>
    <div class="lc-taux-barre">
      <button type="button" class="primary" id="lc-taux-rafraichir">${t(
        "Mettre à jour les taux"
      )}</button>
      <span class="hint" id="lc-taux-etat"></span>
    </div>
    <div id="lc-taux-liste" class="import-mappings"></div>
    <div class="lc-taux-ajout">
      <select id="lc-taux-source"></select>
      <span class="lc-taux-fleche" aria-hidden="true">→</span>
      <select id="lc-taux-cible"></select>
      <input type="url" id="lc-taux-url"
             placeholder="${t("Lien de la page de cotation (Google Finance, Yahoo Finance…)")}" />
      <button type="button" id="lc-taux-ajouter">${t("Suivre ce couple")}</button>
    </div>
  `;
  section.appendChild(bloc);

  document.getElementById("lc-taux-rafraichir").addEventListener("click", () => {
    rafraichirTaux("/taux-change/rafraichir");
  });
  document.getElementById("lc-taux-ajouter").addEventListener("click", ajouterCouple);
}

/* ---------- Rendu ---------- */

function renderCouples() {
  const liste = document.getElementById("lc-taux-liste");
  if (!liste) return;
  liste.innerHTML = "";
  if (couplesSuivis.length === 0) {
    liste.innerHTML = `<span class="hint">${t(
      "Aucun couple suivi pour le moment."
    )}</span>`;
    return;
  }
  couplesSuivis.forEach((couple) => {
    const ligne = document.createElement("div");
    ligne.className = "import-mapping-row";
    ligne.innerHTML = `
      <span class="import-mapping-nom">
        1 ${escapeHtml(couple.monnaie_source_symbole)} =
        <strong>${couple.taux == null ? "—" : formatQuantite(couple.taux)}</strong>
        ${escapeHtml(couple.monnaie_cible_symbole)}
      </span>
      <span class="lc-taux-couple">${escapeHtml(couple.monnaie_source_nom)} →
        ${escapeHtml(couple.monnaie_cible_nom)}</span>
      <a class="lc-taux-lien" href="${escapeHtml(couple.url_cours)}"
         title="${escapeHtml(couple.url_cours)}" target="_blank" rel="noopener noreferrer">${t(
           "la page"
         )}</a>
      <span class="lc-taux-fraicheur">${escapeHtml(fraicheurTaux(couple.maj_le))}</span>
      <button type="button" data-lc-rafraichir="${couple.id}">${t("Mettre à jour")}</button>
      <button type="button" class="danger" data-lc-retirer="${couple.id}">${t(
        "Ne plus suivre"
      )}</button>
    `;
    liste.appendChild(ligne);
  });

  liste.querySelectorAll("button[data-lc-rafraichir]").forEach((bouton) => {
    bouton.addEventListener("click", () =>
      rafraichirTaux(`/taux-change/${bouton.dataset.lcRafraichir}/rafraichir`)
    );
  });
  liste.querySelectorAll("button[data-lc-retirer]").forEach((bouton) => {
    bouton.addEventListener("click", () => retirerCouple(bouton.dataset.lcRetirer));
  });
}

// `fraicheur` (fichier voisin) dit « cours saisi à la main » quand la date est
// absente : pour un couple, cette phrase n'aurait aucun sens — un taux ne se
// saisit nulle part dans l'application.
function fraicheurTaux(isoDateHeure) {
  return isoDateHeure ? fraicheur(isoDateHeure) : t("jamais relu");
}

function majEtatTaux() {
  const etat = document.getElementById("lc-taux-etat");
  if (!etat) return;
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

/**
 * Les deux menus de monnaies, remplis depuis `state.monnaies` — l'état que le
 * noyau tient déjà à jour, plutôt qu'un second appel qui pourrait diverger.
 */
function remplirMenusMonnaies() {
  const source = document.getElementById("lc-taux-source");
  const cible = document.getElementById("lc-taux-cible");
  if (!source || !cible) return;
  const options = (state.monnaies || [])
    .map((m) => `<option value="${m.id}">${escapeHtml(m.nom)} (${escapeHtml(m.symbole)})</option>`)
    .join("");
  const avant = { source: source.value, cible: cible.value };
  source.innerHTML = options;
  cible.innerHTML = options;
  if (avant.source) source.value = avant.source;
  if (avant.cible) cible.value = avant.cible;
  // Deux monnaies différentes par défaut quand il y en a assez : le couple le
  // plus courant se suit alors sans toucher aux menus.
  else if ((state.monnaies || []).length > 1) cible.value = String(state.monnaies[1].id);
}

/**
 * Les sources reconnues, énoncées au-dessus du champ à remplir. Même liste que
 * pour les titres — c'est le même lecteur — et elle vient du serveur plutôt
 * que d'un texte recopié ici, qui pourrait promettre une source disparue.
 */
async function poserAideSourcesTaux() {
  const cible = document.getElementById("lc-taux-sources");
  if (!cible || cible.dataset.rempli) return;
  try {
    const sources = await apiFetch("/taux-change/sources");
    cible.innerHTML =
      `<strong>${t("Pages reconnues")}</strong> — ` +
      sources
        .map(
          (source) =>
            `${escapeHtml(source.nom)} <code>${escapeHtml(source.exemple)}</code>`
        )
        .join(" · ");
    cible.dataset.rempli = "1";
  } catch (err) {
    /* L'aide n'est pas essentielle : une extension éteinte entre-temps, ou une
       route fermée, ne doit pas empêcher le reste du bloc de fonctionner. */
  }
}

/* ---------- Serveur ---------- */

function appliquerReponseTaux(reponse) {
  couplesSuivis = reponse.taux || [];
  dernierResumeTaux = reponse;
  renderCouples();
  majEtatTaux();
}

async function chargerCouples() {
  if (!tauxActif()) return;
  try {
    couplesSuivis = await apiFetch("/taux-change");
    renderCouples();
    majEtatTaux();
  } catch (err) {
    /* Extension éteinte entre-temps, ou hôte absent : le bloc reste vide
       plutôt que d'afficher une erreur sur un écran qui n'a rien demandé. */
  }
}

async function rafraichirTaux(url) {
  const bouton = document.getElementById("lc-taux-rafraichir");
  if (bouton) bouton.disabled = true;
  try {
    const reponse = await apiFetch(url, { method: "POST" });
    appliquerReponseTaux(reponse);
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

async function ajouterCouple() {
  const sourceId = Number(document.getElementById("lc-taux-source").value);
  const cibleId = Number(document.getElementById("lc-taux-cible").value);
  const champUrl = document.getElementById("lc-taux-url");
  const url = champUrl.value.trim();
  if (!url) {
    showMessage(t("Colle le lien de la page de cotation."), "error");
    return;
  }
  const bouton = document.getElementById("lc-taux-ajouter");
  bouton.disabled = true;
  try {
    const reponse = await apiFetch("/taux-change", {
      method: "POST",
      body: JSON.stringify({
        monnaie_source_id: sourceId,
        monnaie_cible_id: cibleId,
        url,
      }),
    });
    appliquerReponseTaux(reponse);
    champUrl.value = "";
    const lu = reponse.resultats[0];
    showMessage(
      lu
        ? t("Taux lu sur {source} : {libelle} = {taux}", {
            source: lu.source,
            libelle: lu.libelle,
            taux: formatQuantite(lu.taux),
          })
        : t("Couple enregistré"),
      "success"
    );
  } catch (err) {
    // Le serveur n'a rien enregistré (cf. routeur_taux.creer_couple) : le champ
    // garde ce qui a été collé, pour qu'on puisse le corriger plutôt que de le
    // retaper.
    showMessage(err.message, "error");
  } finally {
    bouton.disabled = false;
  }
}

async function retirerCouple(tauxId) {
  try {
    await apiFetch(`/taux-change/${tauxId}`, { method: "DELETE" });
    await chargerCouples();
    showMessage(t("Couple retiré. Aucun montant n'en dépendait."), "success");
  } catch (err) {
    showMessage(err.message, "error");
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
  poserBlocTaux();
  if (!tauxActif()) return;
  remplirMenusMonnaies();
  await poserAideSourcesTaux();
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

// Une relecture au lancement, comme pour les titres : le taux qu'on regarde en
// ouvrant l'application est celui du jour, pas celui de la dernière visite.
// Silencieuse — un échec ici ne doit pas accueillir l'utilisateur par une
// erreur qu'il n'a pas provoquée.
setTimeout(async () => {
  if (!tauxActif()) return;
  try {
    appliquerReponseTaux(await apiFetch("/taux-change/rafraichir", { method: "POST" }));
  } catch (err) {
    /* Hors ligne, ou extension éteinte : on réessaiera au prochain clic. */
  }
}, 1200);
