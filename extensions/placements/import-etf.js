/* ---------- Importer la composition d'un ETF (extension « Placements financiers ») ----------
 *
 * LE FICHIER QUE PUBLIE L'ÉMETTEUR, tel quel : le serveur en trouve l'en-tête, les colonnes et les
 * feuilles (possessions, répartition par secteur ou par zone) sans qu'on désigne quoi que ce soit.
 * Cet écran montre CE QUI A ÉTÉ LU, puis demande les quelques choix qui restent, dans une fenêtre en
 * étapes — le graphe et les cartes à molette sont ceux du parcours de l'import bancaire :
 *
 *   1. Fichier     - le fichier lu : feuilles reconnues, en-tête, colonnes, premières lignes ;
 *   2. Couverture  - quel ETF, et jusqu'où descendre dans sa composition (en % ou en lignes : l'un
 *                    remplit l'autre) ;
 *   3. Secteurs    - à quel secteur de l'app correspond chaque secteur du fichier ;
 *   4. Zones       - idem pour les pays, regroupés en zones ;
 *   5. Importer    - le récapitulatif, puis la confirmation.
 *
 * Aucun calcul de lecture ici : tout est au serveur (service_import_etf.py). Seule la couverture se
 * calcule des deux côtés sur le MÊME cumul, que le serveur envoie. CHARGÉ APRÈS placements.js ; tout
 * est préfixé `ietf`/`IETF` (les scripts d'extension partagent une seule portée).
 */

const IETF_ETAPES = [
  { id: "fichier", numero: "1", nom: "Fichier" },
  { id: "couverture", numero: "2", nom: "Couverture" },
  { id: "secteurs", numero: "3", nom: "Secteurs" },
  { id: "zones", numero: "4", nom: "Zones" },
  { id: "importer", numero: "✓", nom: "Importer" },
];

const IETF_HAUTEUR_OPTION = 30;

const IETF_TYPES_FEUILLE = {
  possessions: "Possessions",
  secteurs: "Répartition par secteur",
  zones: "Répartition par zone",
  "non reconnue": "Non reconnue",
};

const IETF_METHODES = {
  exact: ["forte", "Déjà dans l'app"],
  "mot-clé": ["forte", "Mot-clé reconnu"],
  défaut: ["forte", "Zone par défaut"],
  approchant: ["suggestions", "Ressemble à"],
  aucun: ["aucune", "Sans correspondance"],
};

const IETF = {
  fichier: null,
  lecture: null,
  rang: 0,
  // Le choix de l'ETF visé : l'identifiant d'un titre existant, ou "nouveau" (nom + ISIN saisis).
  etfId: "nouveau",
  etfNom: "",
  etfIsin: "",
  lignes: 0,
  // Les correspondances : libellé du fichier -> nom d'étiquette de l'app ("" = ne rien poser).
  secteurs: {},
  zones: {},
  // Les étiquettes que l'utilisateur ajoute à la main, par axe.
  extra: { secteurs: [], zones: [] },
};

function ietfEl(id) {
  return document.getElementById(id);
}

/* ---------- La fenêtre ---------- */

function ietfOuvrir() {
  IETF.fichier = null;
  IETF.lecture = null;
  IETF.rang = 0;
  IETF.extra = { secteurs: [], zones: [] };
  ietfEl("placements-modale-import-etf").style.display = "";
  document.body.classList.add("modale-ouverte");
  ietfRendre();
}

function ietfFermer() {
  ietfEl("placements-modale-import-etf").style.display = "none";
  document.body.classList.remove("modale-ouverte");
}

function ietfPoserBouton() {
  if (ietfEl("btn-ietf-ouvrir")) return;
  const actions = document.querySelector("#placements-vue-principale .placements-titre-actions");
  if (!actions) return;
  const bouton = document.createElement("button");
  bouton.type = "button";
  bouton.id = "btn-ietf-ouvrir";
  bouton.className = "placements-titre-action";
  bouton.textContent = t("Importer des titres");
  bouton.addEventListener("click", ietfOuvrir);
  actions.appendChild(bouton);
}

/* ---------- Les étapes ---------- */

/** Les étapes sans objet pour ce fichier (aucun secteur, aucun pays à classer) sont sautées. */
function ietfEtapeSautee(id) {
  const l = IETF.lecture;
  if (id === "secteurs") return !!l && !l.secteurs.length;
  if (id === "zones") return !!l && !l.zones.length;
  return false;
}

function ietfEtatEtape(rang) {
  const id = IETF_ETAPES[rang].id;
  if (rang === IETF.rang) return "courante";
  if (ietfEtapeSautee(id)) return "sautee";
  return rang < IETF.rang ? "faite" : "a-venir";
}

function ietfGrapheHtml() {
  const items = IETF_ETAPES.map((e, i) => {
    const etat = ietfEtatEtape(i);
    const fleche =
      i < IETF_ETAPES.length - 1
        ? `<li class="import-etape-fleche ${i < IETF.rang ? "import-etape-fleche-faite" : ""}" aria-hidden="true">${FLECHE_ETAPE_SVG}</li>`
        : "";
    const titre =
      etat === "sautee" ? ` title="${escapeHtml(t("Étape sautée : rien à y faire pour ce fichier."))}"` : "";
    return `<li class="import-etape import-etape-${etat}"${i === IETF.rang ? ' aria-current="step"' : ""}${titre}>
      <span class="import-etape-rond">${escapeHtml(e.numero)}</span>
      <span class="import-etape-nom">${escapeHtml(t(e.nom))}</span></li>${fleche}`;
  });
  return `<ol class="import-etapes-liste" aria-label="${escapeHtml(t("Étapes de l'import"))}">${items.join("")}</ol>`;
}

function ietfSuivante(depart, sens) {
  let rang = depart + sens;
  while (rang > 0 && rang < IETF_ETAPES.length - 1 && ietfEtapeSautee(IETF_ETAPES[rang].id)) rang += sens;
  return Math.min(Math.max(rang, 0), IETF_ETAPES.length - 1);
}

function ietfAller(rang) {
  IETF.rang = rang;
  ietfRendre();
}

function ietfRendre() {
  ietfEl("ietf-etapes").innerHTML = ietfGrapheHtml();
  const id = IETF_ETAPES[IETF.rang].id;
  const corps = ietfEl("ietf-corps");
  ({
    fichier: ietfRendreFichier,
    couverture: ietfRendreCouverture,
    secteurs: () => ietfRendreCorrespondances("secteurs"),
    zones: () => ietfRendreCorrespondances("zones"),
    importer: ietfRendreRecap,
  })[id](corps);
  const dernier = id === "importer";
  ietfEl("btn-ietf-retour").style.visibility = IETF.rang === 0 ? "hidden" : "";
  const suivant = ietfEl("btn-ietf-suivant");
  suivant.textContent = dernier ? t("Importer") : t("Suivant");
  suivant.disabled = !ietfPeutAvancer();
}

function ietfPeutAvancer() {
  const id = IETF_ETAPES[IETF.rang].id;
  if (id === "fichier") return !!IETF.lecture;
  if (id === "couverture") return IETF.lignes >= 1 && (IETF.etfId !== "nouveau" || IETF.etfNom.trim() !== "");
  return true;
}

/* ---------- 1. Le fichier lu ---------- */

function ietfRendreFichier(corps) {
  const l = IETF.lecture;
  let lu = "";
  if (l) {
    const feuilles = l.feuilles
      .map((f) => {
        const reconnue = f.type !== "non reconnue";
        const colonnes = Object.entries(f.colonnes || {})
          .map(([role, libelle]) => `<span class="ietf-colonne"><b>${escapeHtml(t(ietfNomRole(role)))}</b> ← ${escapeHtml(libelle || "")}</span>`)
          .join("");
        const apercu = reconnue
          ? `<div class="ietf-table-cadre"><table class="ietf-table"><tbody>${f.apercu
              .map(
                (r) => `<tr class="${r.entete ? "ietf-entete" : ""}"><td class="ietf-num">${r.ligne}</td>${r.cellules
                  .map((c) => `<td>${escapeHtml(c ?? "")}</td>`)
                  .join("")}</tr>`
              )
              .join("")}</tbody></table></div>`
          : "";
        return `<details class="ietf-feuille ietf-feuille-${f.type.replace(" ", "-")}" ${f.type === "possessions" ? "open" : ""}>
          <summary><span class="ietf-feuille-nom">${escapeHtml(f.nom)}</span>
            <span class="ietf-pastille ietf-pastille-${f.type.replace(" ", "-")}">${escapeHtml(t(IETF_TYPES_FEUILLE[f.type] || f.type))}</span>
            ${reconnue ? `<span class="hint">${escapeHtml(t("{n} ligne(s), en-tête ligne {e}", { n: f.nb_lignes, e: f.ligne_entete }))}${
              f.unite === "fraction" ? ` — ${escapeHtml(t("poids lus en fractions, convertis en %"))}` : ""
            }</span>` : ""}</summary>
          ${colonnes ? `<div class="ietf-colonnes">${colonnes}</div>` : ""}${apercu}
        </details>`;
      })
      .join("");
    const ecartees = l.ecartees.length
      ? `<p class="hint">${escapeHtml(
          t("{n} ligne(s) écartée(s) : liquidités, change, contrats à terme… ({noms})", {
            n: l.ecartees.length,
            noms: l.ecartees.slice(0, 4).map((e) => e.nom).join(", ") + (l.ecartees.length > 4 ? "…" : ""),
          })
        )}</p>`
      : "";
    const avertissements = l.avertissements.map((m) => `<p class="ietf-avertissement">${escapeHtml(traduireMessageServeur(m))}</p>`).join("");
    lu = `
      <div class="ietf-fonds">
        <div><b>${escapeHtml(l.fonds.nom || t("Fonds sans nom"))}</b></div>
        <div class="hint">${[l.fonds.isin, l.fonds.devise].filter(Boolean).map(escapeHtml).join(" · ")}</div>
        <div class="hint">${escapeHtml(
          t("{n} titres lus, qui pèsent {pct} % du fonds", { n: l.nb_possessions, pct: ietfPct(l.somme_pct) })
        )}</div>
      </div>
      ${avertissements}${ecartees}
      <h3>${escapeHtml(t("Ce que l'app a lu"))}</h3>
      <div class="ietf-feuilles">${feuilles}</div>`;
  }
  corps.innerHTML = `
    <p class="modale-texte" data-texte-cle="import-etf.fichier"></p>
    <div class="ietf-fichier selecteur-contexte">
      <label>${escapeHtml(t("Fichier de composition"))}
        <input type="file" id="ietf-fichier" accept=".xlsx,.xlsm,.xls,.csv,.txt" />
      </label>
      ${IETF.fichier ? `<span class="hint">${escapeHtml(IETF.fichier.name)}</span>` : ""}
    </div>
    <div id="ietf-lecture">${lu}</div>`;
  if (typeof appliquerTextes === "function") appliquerTextes(corps);
  ietfEl("ietf-fichier").addEventListener("change", ietfLire);
}

function ietfNomRole(role) {
  return (
    { isin: "ISIN", nom: "Nom", ticker: "Ticker", poids: "Poids", classe: "Classe d'actif", secteur: "Secteur", pays: "Pays", devise: "Devise" }[role] ||
    role
  );
}

function ietfPct(x) {
  return Number(x).toLocaleString(undefined, { maximumFractionDigits: 2 });
}

async function ietfLire(e) {
  const fichier = e.target.files[0];
  if (!fichier) return;
  const formulaire = new FormData();
  formulaire.append("fichier", fichier);
  try {
    const lecture = await apiFetchForm("/import-etf/lire", formulaire);
    IETF.fichier = fichier;
    IETF.lecture = lecture;
    ietfInitialiserChoix();
    ietfRendre();
  } catch (err) {
    IETF.fichier = null;
    IETF.lecture = null;
    showMessage(traduireMessageServeur(err.message), "error");
    ietfRendre();
  }
}

/** Les choix de départ, tirés de ce que le serveur propose. */
function ietfInitialiserChoix() {
  const l = IETF.lecture;
  IETF.etfId = l.etf.titre_id ? String(l.etf.titre_id) : "nouveau";
  IETF.etfNom = l.fonds.nom || "";
  IETF.etfIsin = l.fonds.isin || "";
  IETF.lignes = Math.min(l.couverture.defaut_lignes, l.nb_possessions);
  IETF.secteurs = Object.fromEntries(l.secteurs.map((s) => [s.brut, s.propose || ""]));
  IETF.zones = Object.fromEntries(l.zones.map((z) => [z.brut, z.propose || ""]));
}

/* ---------- 2. L'ETF et la couverture ---------- */

/** Le plus petit nombre de lignes dont le cumul atteint `pct` % (le même calcul qu'au serveur). */
function ietfLignesPourPct(pct) {
  const cumul = IETF.lecture.couverture.cumul;
  for (let n = 1; n <= cumul.length; n++) if (cumul[n - 1] >= pct - 1e-9) return n;
  return cumul.length;
}

function ietfPctPourLignes(n) {
  const cumul = IETF.lecture.couverture.cumul;
  return n >= 1 ? cumul[Math.min(n, cumul.length) - 1] : 0;
}

function ietfCourbeSvg() {
  const cumul = IETF.lecture.couverture.cumul;
  const N = cumul.length;
  const L = 420;
  const H = 130;
  const pas = Math.max(1, Math.floor(N / 300));
  const points = [`0,${H}`];
  for (let i = 0; i < N; i += pas) points.push(`${((i + 1) / N) * L},${H - (cumul[i] / 100) * (H - 6)}`);
  points.push(`${L},${H - (cumul[N - 1] / 100) * (H - 6)}`);
  const x = (IETF.lignes / N) * L;
  const y = H - (ietfPctPourLignes(IETF.lignes) / 100) * (H - 6);
  return `<svg class="ietf-courbe" viewBox="0 0 ${L} ${H}" preserveAspectRatio="none" role="img"
      aria-label="${escapeHtml(t("Poids cumulé des titres, du plus lourd au plus léger"))}">
    <polyline points="${points.join(" ")}" class="ietf-courbe-trait" />
    <line x1="${x}" y1="0" x2="${x}" y2="${H}" class="ietf-courbe-repere" />
    <line x1="0" y1="${y}" x2="${L}" y2="${y}" class="ietf-courbe-repere" />
  </svg>`;
}

function ietfResumeCouverture() {
  const n = IETF.lignes;
  return t("{n} ligne(s) sur {total} couvrent {pct} % du fonds", {
    n,
    total: IETF.lecture.nb_possessions,
    pct: ietfPct(ietfPctPourLignes(n)),
  });
}

function ietfMajCouverture({ source }) {
  const l = IETF.lecture;
  const champLignes = ietfEl("ietf-lignes");
  const champPct = ietfEl("ietf-pct");
  const curseur = ietfEl("ietf-curseur");
  // L'un remplit l'autre : on garde ce que l'utilisateur vient de taper, on recalcule l'autre.
  if (source === "pct") {
    const pct = Math.min(Math.max(Number(champPct.value) || 0, 0), 100);
    IETF.lignes = Math.max(1, ietfLignesPourPct(pct));
    champLignes.value = IETF.lignes;
  } else {
    IETF.lignes = Math.min(Math.max(Math.round(Number(source === "curseur" ? curseur.value : champLignes.value)) || 1, 1), l.nb_possessions);
    champPct.value = ietfPct(ietfPctPourLignes(IETF.lignes));
    if (source === "curseur") champLignes.value = IETF.lignes;
  }
  curseur.value = IETF.lignes;
  ietfEl("ietf-resume-couverture").textContent = ietfResumeCouverture();
  ietfEl("ietf-courbe").innerHTML = ietfCourbeSvg();
  ietfEl("ietf-composants").innerHTML = ietfComposantsHtml();
  ietfEl("btn-ietf-suivant").disabled = !ietfPeutAvancer();
}

const IETF_STATUTS = { nouveau: "À créer", existant: "Déjà dans l'app", ambigu: "Ambigu : écarté" };

function ietfComposantsHtml() {
  const l = IETF.lecture;
  const retenus = l.composants.slice(0, IETF.lignes);
  const lignes = retenus
    .slice(0, 60)
    .map(
      (c) => `<tr><td class="ietf-num">${c.ligne}</td><td>${escapeHtml(c.nom)}</td>
        <td><code>${escapeHtml(c.isin || "")}</code></td><td class="ietf-poids">${ietfPct(c.poids_pct)} %</td>
        <td><span class="ietf-pastille ietf-pastille-${c.statut}">${escapeHtml(t(IETF_STATUTS[c.statut]))}</span></td></tr>`
    )
    .join("");
  const reste = IETF.lignes - Math.min(IETF.lignes, 60);
  const statuts = l.statuts.slice(0, IETF.lignes);
  const compte = (s) => statuts.filter((x) => x === s).length;
  return `
    <p class="hint">${escapeHtml(
      t("{a} à créer, {b} déjà dans l'app, {c} écarté(s) car ambigu(s)", { a: compte("nouveau"), b: compte("existant"), c: compte("ambigu") })
    )}</p>
    <div class="ietf-table-cadre"><table class="ietf-table"><tbody>${lignes}</tbody></table></div>
    ${reste > 0 ? `<p class="hint">${escapeHtml(t("… et {n} autre(s)", { n: reste }))}</p>` : ""}`;
}

function ietfRendreCouverture(corps) {
  const l = IETF.lecture;
  const options = [
    `<option value="nouveau">${escapeHtml(t("— Nouvel ETF —"))}</option>`,
    ...l.etf.candidats.map(
      (c) => `<option value="${c.id}" ${String(c.id) === IETF.etfId ? "selected" : ""}>${escapeHtml(c.nom)}${c.isin ? ` (${escapeHtml(c.isin)})` : ""}</option>`
    ),
  ].join("");
  corps.innerHTML = `
    <p class="modale-texte" data-texte-cle="import-etf.couverture"></p>
    <h3>${escapeHtml(t("L'ETF"))}</h3>
    <div class="ietf-etf selecteur-contexte">
      <label>${escapeHtml(t("ETF concerné"))}
        <select id="ietf-etf">${options}</select>
      </label>
      <label class="ietf-etf-nouveau">${escapeHtml(t("Nom"))}
        <input type="text" id="ietf-etf-nom" value="${escapeHtml(IETF.etfNom)}" />
      </label>
      <label class="ietf-etf-nouveau">ISIN
        <input type="text" id="ietf-etf-isin" value="${escapeHtml(IETF.etfIsin)}" />
      </label>
    </div>
    <h3>${escapeHtml(t("Jusqu'où descendre"))}</h3>
    <div class="ietf-couverture selecteur-contexte">
      <label>${escapeHtml(t("Couverture (%)"))}
        <input type="number" id="ietf-pct" min="0" max="100" step="0.1" value="${ietfPct(ietfPctPourLignes(IETF.lignes))}" />
      </label>
      <label>${escapeHtml(t("Nombre de lignes"))}
        <input type="number" id="ietf-lignes" min="1" max="${l.nb_possessions}" step="1" value="${IETF.lignes}" />
      </label>
      <input type="range" id="ietf-curseur" min="1" max="${l.nb_possessions}" value="${IETF.lignes}" aria-label="${escapeHtml(t("Nombre de lignes"))}" />
    </div>
    <p class="hint" id="ietf-resume-couverture">${escapeHtml(ietfResumeCouverture())}</p>
    <div id="ietf-courbe">${ietfCourbeSvg()}</div>
    <div id="ietf-composants">${ietfComposantsHtml()}</div>`;
  if (typeof appliquerTextes === "function") appliquerTextes(corps);
  const majEtf = () => {
    IETF.etfId = ietfEl("ietf-etf").value;
    ietfEl("ietf-etf-nom").closest("label").hidden = IETF.etfId !== "nouveau";
    ietfEl("ietf-etf-isin").closest("label").hidden = IETF.etfId !== "nouveau";
    ietfEl("btn-ietf-suivant").disabled = !ietfPeutAvancer();
  };
  ietfEl("ietf-etf").addEventListener("change", majEtf);
  ietfEl("ietf-etf-nom").addEventListener("input", (e) => {
    IETF.etfNom = e.target.value;
    ietfEl("btn-ietf-suivant").disabled = !ietfPeutAvancer();
  });
  ietfEl("ietf-etf-isin").addEventListener("input", (e) => {
    IETF.etfIsin = e.target.value;
  });
  ietfEl("ietf-pct").addEventListener("input", () => ietfMajCouverture({ source: "pct" }));
  ietfEl("ietf-lignes").addEventListener("input", () => ietfMajCouverture({ source: "lignes" }));
  ietfEl("ietf-curseur").addEventListener("input", () => ietfMajCouverture({ source: "curseur" }));
  majEtf();
}

/* ---------- 3 et 4. Les correspondances (cartes à molette du parcours de l'import) ---------- */

function ietfOptions(axe) {
  const l = IETF.lecture;
  const existants = axe === "secteurs" ? l.secteurs_existants : l.zones_existantes;
  const lignes = axe === "secteurs" ? l.secteurs : l.zones;
  const proposes = lignes.map((x) => x.propose).filter(Boolean);
  const tous = [...new Set([...existants, ...proposes, ...IETF.extra[axe]])].sort((a, b) => a.localeCompare(b, "fr"));
  return [{ nom: "", etat: "aucun" }].concat(
    tous.map((nom) => ({ nom, etat: existants.includes(nom) ? "existant" : "nouveau" }))
  );
}

function ietfCarteHtml(axe, ligne, i) {
  const choix = (axe === "secteurs" ? IETF.secteurs : IETF.zones)[ligne.brut] ?? "";
  const [classe, texte] = IETF_METHODES[ligne.methode] || IETF_METHODES.aucun;
  const options = ietfOptions(axe)
    .map(
      (o) => `<div class="corr-roue-option ${o.etat === "nouveau" ? "corr-roue-nouvelle" : ""} ${
        o.nom === choix ? "corr-roue-choisie" : ""
      } ${o.nom && o.nom === ligne.propose ? "corr-roue-forte" : ""}" role="option" data-nom="${escapeHtml(o.nom)}"
        aria-selected="${o.nom === choix}">${escapeHtml(o.nom || t("— aucun —"))}</div>`
    )
    .join("");
  return `<section class="corr-colonne" data-ietf-i="${i}" tabindex="-1">
    <div>
      <div class="corr-banque">${escapeHtml(ligne.brut)}</div>
      <div class="hint">${escapeHtml(
        ligne.nb ? t("{n} titre(s), {pct} % du fonds", { n: ligne.nb, pct: ietfPct(ligne.poids_pct) }) : t("Feuille de répartition")
      )}</div>
      <span class="corr-statut corr-statut-${classe}">${escapeHtml(t(texte))}</span>
    </div>
    <div class="corr-roue-cadre">
      <div class="corr-roue" role="listbox" tabindex="0" aria-label="${escapeHtml(t("Correspondance de « {nom} »", { nom: ligne.brut }))}">${options}</div>
    </div>
  </section>`;
}

function ietfRendreCorrespondances(axe) {
  const l = IETF.lecture;
  const lignes = axe === "secteurs" ? l.secteurs : l.zones;
  const singulier = axe === "secteurs" ? "secteur" : "zone";
  const corps = ietfEl("ietf-corps");
  corps.innerHTML = `
    <p class="modale-texte" data-texte-cle="import-etf.${axe}"></p>
    <div class="ietf-creer selecteur-contexte">
      <label>${escapeHtml(axe === "secteurs" ? t("Nouveau secteur") : t("Nouvelle zone"))}
        <input type="text" id="ietf-creer-nom" />
      </label>
      <button type="button" id="btn-ietf-creer">${escapeHtml(t("+ Créer"))}</button>
    </div>
    <p class="hint" id="ietf-compteur-${axe}"></p>
    <div class="corr-board" id="ietf-board">${lignes.map((x, i) => ietfCarteHtml(axe, x, i)).join("")}</div>`;
  if (typeof appliquerTextes === "function") appliquerTextes(corps);
  const majCompteur = () => {
    const choix = axe === "secteurs" ? IETF.secteurs : IETF.zones;
    const sans = lignes.filter((x) => !choix[x.brut]).length;
    ietfEl(`ietf-compteur-${axe}`).textContent = sans
      ? t("{n} {mot} sans correspondance : rien ne sera posé pour eux.", { n: sans, mot: singulier })
      : t("Tout est classé.");
  };
  majCompteur();
  const board = ietfEl("ietf-board");
  board.querySelectorAll(".corr-roue").forEach((roue) => {
    const carte = roue.closest(".corr-colonne");
    const ligne = lignes[Number(carte.dataset.ietfI)];
    const options = [...roue.children];
    const centrer = (doux) => {
      const rang = Math.max(0, options.findIndex((o) => o.classList.contains("corr-roue-choisie")));
      roue.scrollTo({ top: rang * IETF_HAUTEUR_OPTION, behavior: doux ? "smooth" : "auto" });
    };
    const choisir = (rang, { defiler = true } = {}) => {
      const option = options[Math.min(Math.max(rang, 0), options.length - 1)];
      (axe === "secteurs" ? IETF.secteurs : IETF.zones)[ligne.brut] = option.dataset.nom;
      options.forEach((o) => {
        o.classList.toggle("corr-roue-choisie", o === option);
        o.setAttribute("aria-selected", String(o === option));
      });
      if (defiler) centrer(true);
      majCompteur();
    };
    centrer(false);
    options.forEach((o, rang) => o.addEventListener("click", () => choisir(rang)));
    roue.addEventListener("keydown", (e) => {
      if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
      e.preventDefault();
      const actuel = Math.max(0, options.findIndex((o) => o.classList.contains("corr-roue-choisie")));
      choisir(actuel + (e.key === "ArrowDown" ? 1 : -1));
    });
    // Faire défiler la molette choisit la ligne qui s'arrête au centre.
    let minuterie = null;
    roue.addEventListener("scroll", () => {
      clearTimeout(minuterie);
      minuterie = setTimeout(() => {
        const rang = Math.round(roue.scrollTop / IETF_HAUTEUR_OPTION);
        if (!options[rang] || options[rang].classList.contains("corr-roue-choisie")) return;
        choisir(rang, { defiler: false });
      }, 140);
    });
  });
  const creer = () => {
    const champ = ietfEl("ietf-creer-nom");
    const nom = champ.value.trim();
    if (!nom) return;
    const connus = ietfOptions(axe).map((o) => o.nom.toLowerCase());
    if (!connus.includes(nom.toLowerCase())) IETF.extra[axe].push(nom);
    ietfRendreCorrespondances(axe);
  };
  ietfEl("btn-ietf-creer").addEventListener("click", creer);
  ietfEl("ietf-creer-nom").addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      creer();
    }
  });
}

/* ---------- 5. Le récapitulatif ---------- */

function ietfEtiquettesACreer() {
  const l = IETF.lecture;
  const parAxe = [
    ["secteurs", "Secteur", IETF.secteurs, l.secteurs_existants],
    ["zones", "Zone", IETF.zones, l.zones_existantes],
  ];
  const liste = [];
  parAxe.forEach(([axe, libelle, choix, existants]) => {
    const connus = new Set(existants.map((n) => n.toLowerCase()));
    [...new Set(Object.values(choix).filter(Boolean))]
      .filter((nom) => !connus.has(nom.toLowerCase()))
      .forEach((nom) => liste.push(`${nom} (${t(libelle)})`));
  });
  return liste;
}

function ietfRendreRecap(corps) {
  const l = IETF.lecture;
  const statuts = l.statuts.slice(0, IETF.lignes);
  const compte = (s) => statuts.filter((x) => x === s).length;
  const cibles = l.etf.candidats.find((c) => String(c.id) === IETF.etfId);
  const etf = IETF.etfId === "nouveau" ? `${IETF.etfNom} (${t("à créer")})` : cibles ? cibles.nom : "";
  const etiquettes = ietfEtiquettesACreer();
  corps.innerHTML = `
    <p class="modale-texte" data-texte-cle="import-etf.recap"></p>
    <ul class="ietf-recap">
      <li><b>${escapeHtml(t("ETF"))}</b> : ${escapeHtml(etf)}</li>
      <li><b>${escapeHtml(t("Composition"))}</b> : ${escapeHtml(ietfResumeCouverture())}</li>
      <li><b>${escapeHtml(t("Titres"))}</b> : ${escapeHtml(
        t("{a} créé(s), {b} retrouvé(s), {c} écarté(s) car ambigu(s)", { a: compte("nouveau"), b: compte("existant"), c: compte("ambigu") })
      )}</li>
      ${l.a_une_repartition_secteurs ? `<li>${escapeHtml(t("La répartition par secteur de l'ETF sera posée sur l'ETF."))}</li>` : ""}
      ${l.a_une_repartition_zones ? `<li>${escapeHtml(t("La répartition par zone de l'ETF sera posée sur l'ETF."))}</li>` : ""}
      ${etiquettes.length ? `<li><b>${escapeHtml(t("Étiquettes créées"))}</b> : ${escapeHtml(etiquettes.join(", "))}</li>` : ""}
    </ul>
    <p class="hint">${escapeHtml(t("Les titres reçoivent « Part d'un ETF » et rejoignent la fenêtre « Titres d'ETFs » ; ceux que tu détiens restent dans « Titres possédés »."))}</p>`;
  if (typeof appliquerTextes === "function") appliquerTextes(corps);
}

async function ietfConfirmer() {
  const l = IETF.lecture;
  const formulaire = new FormData();
  formulaire.append("fichier", IETF.fichier);
  formulaire.append(
    "choix",
    JSON.stringify({
      etf: IETF.etfId === "nouveau" ? { nom: IETF.etfNom.trim(), isin: IETF.etfIsin.trim() } : { titre_id: Number(IETF.etfId) },
      nb_lignes: IETF.lignes,
      secteurs: IETF.secteurs,
      zones: IETF.zones,
    })
  );
  const bouton = ietfEl("btn-ietf-suivant");
  bouton.disabled = true;
  try {
    const r = await apiFetchForm("/import-etf/confirmer", formulaire);
    showMessage(
      t("« {etf} » importé : {n} composants ({pct} %), {crees} titre(s) créé(s), {retrouves} retrouvé(s)", {
        etf: r.etf_nom,
        n: r.nb_composants,
        pct: ietfPct(r.couverture_pct),
        crees: r.titres_crees,
        retrouves: r.titres_retrouves,
      }),
      "success"
    );
    r.avertissements.forEach((m) => showMessage(traduireMessageServeur(m), "error"));
    ietfFermer();
    await refreshTypesTitre();
    await refreshTitres();
  } catch (err) {
    showMessage(traduireMessageServeur(err.message), "error");
    bouton.disabled = false;
  }
}

/* ---------- Les gestes ---------- */

(function ietfCabler() {
  if (!ietfEl("placements-modale-import-etf")) return;
  ietfPoserBouton();
  ietfEl("btn-ietf-fermer").addEventListener("click", ietfFermer);
  ietfEl("btn-ietf-retour").addEventListener("click", () => ietfAller(ietfSuivante(IETF.rang, -1)));
  ietfEl("btn-ietf-suivant").addEventListener("click", () => {
    if (IETF_ETAPES[IETF.rang].id === "importer") ietfConfirmer();
    else ietfAller(ietfSuivante(IETF.rang, 1));
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && ietfEl("placements-modale-import-etf").style.display !== "none") ietfFermer();
  });
})();
