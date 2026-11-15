/* ---------- L'évolution du portefeuille (extension « Placements financiers ») ----------
 *
 * DEUX ÉCRANS, UN SEUL DESSIN. L'onglet principal trace la valorisation de TOUT le portefeuille ; l'onglet
 * « Analyse » la sépare selon une propriété (compte de détention, enveloppe, classe d'actif, zone, secteur) et
 * trace UN GRAPHE PAR ÉLÉMENT de cette propriété. Les deux lisent `GET /placements/evolution` — le serveur
 * (services/evolution_portefeuille) valorise chaque titre à chaque date avec l'historique des cours
 * (`cours_titre`) ; cet écran ne calcule rien d'autre que des pixels.
 *
 * LE GRAPHE D'UN ÉLÉMENT A SA PROPRE ÉCHELLE : une zone qui pèse 3 % du portefeuille écrasée contre le zéro
 * de celle qui en pèse 60 % ne se lirait plus. Le total de l'axe est tracé en tête, à part.
 *
 * Tout est préfixé `evo` : les scripts d'extension s'exécutent en portée globale (cf. extensions/README.md).
 */

// Une fenêtre d'années, au choix : « tout » garde la grille entière du serveur.
const EVO_PERIODES = [
  { cle: "1m", libelle: "1 mois", jours: 31 },
  { cle: "6m", libelle: "6 mois", jours: 183 },
  { cle: "1a", libelle: "1 an", jours: 366 },
  { cle: "tout", libelle: "Tout", jours: null },
];

const EVO = {
  periode: "tout",
  monnaieId: null,
  axe: "total",
  derniereReponse: null,
  // Les titres cochés dans « Titre individuel » (leurs identifiants) : vide au départ, jamais coché d'office.
  titresCoches: new Set(),
  // Ce que tracent les courbes PAR ÉLÉMENT (pas la principale) : « investi » = valeur / montant investi - 1,
  // ou « cours » = la performance des cours seuls (hors achats et ventes), rebasée au début de la période.
  mesure: "investi",
};

/** Une réponse du serveur, rognée à la période choisie. */
function evoRogner(reponse, periode) {
  const choix = EVO_PERIODES.find((p) => p.cle === periode);
  if (!choix || !choix.jours || reponse.dates.length === 0) return reponse;
  const fin = new Date(reponse.dates[reponse.dates.length - 1] + "T00:00:00");
  const limite = new Date(fin.getTime() - choix.jours * 86400000).toISOString().slice(0, 10);
  const premier = Math.max(
    reponse.dates.findIndex((d) => d >= limite),
    0
  );
  return {
    ...reponse,
    dates: reponse.dates.slice(premier),
    total: reponse.total.slice(premier),
    gain_cumule: (reponse.gain_cumule || []).slice(premier),
    rendement_cumule: (reponse.rendement_cumule || []).slice(premier),
    investi: (reponse.investi || []).slice(premier),
    historique: reponse.historique,
    rendement_investi: (reponse.rendement_investi || []).slice(premier),
    series: reponse.series.map((s) => ({
      ...s,
      valeurs: s.valeurs.slice(premier),
      investis: (s.investis || []).slice(premier),
      rendement_investi: (s.rendement_investi || []).slice(premier),
      gain_cumule: (s.gain_cumule || []).slice(premier),
      rendement_cumule: (s.rendement_cumule || []).slice(premier),
    })),
  };
}

/**
 * LA PERFORMANCE SUR LA FENÊTRE : l'évolution du COURS des titres seule — jamais l'argent ajouté ou retiré par
 * un achat ou une vente (le serveur ne compte que « quantité détenue × variation de cours », cf.
 * services/evolution_portefeuille._performance). Le gain est la différence des cumuls ; le rendement, celui
 * d'un placement pondéré par le temps, rapporté au début de la fenêtre.
 */
function evoPerformance(gainCumule, rendementCumule) {
  if (!gainCumule || gainCumule.length < 2) return null;
  const fin = gainCumule.length - 1;
  return {
    gain: gainCumule[fin] - gainCumule[0],
    pct: (1 + rendementCumule[fin]) / (1 + rendementCumule[0]) - 1,
  };
}

/** « +230,00 € (+13,5 %) » — vide si la fenêtre n'a rien à dire. */
function evoPerformanceTexte(perf, monnaieId) {
  if (!perf) return "";
  const signe = Math.abs(perf.gain) < 0.005 ? "" : perf.gain > 0 ? "+" : "−";
  return `${signe}${formatMontant(Math.abs(perf.gain), monnaieId)} (${signe}${(Math.abs(perf.pct) * 100).toLocaleString(
    "fr-FR",
    { maximumFractionDigits: 1 }
  )} %)`;
}

function evoCouleur(rang) {
  if (typeof PALETTE_CATEGORIES !== "undefined" && PALETTE_CATEGORIES.length) {
    return PALETTE_CATEGORIES[rang % PALETTE_CATEGORIES.length];
  }
  return "var(--accent-light)";
}

/** « +12,3 % » / « −4,0 % » à partir d'une fraction. */
function evoPourcentage(fraction) {
  if (fraction === null || fraction === undefined) return "—";
  const signe = Math.abs(fraction) < 0.00005 ? "" : fraction > 0 ? "+" : "−";
  return `${signe}${(Math.abs(fraction) * 100).toLocaleString("fr-FR", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  })} %`;
}

/** LA CARTE VIDE : même cadre qu'un graphe, quand il n'y a qu'une valeur en base — rien à tracer, et on le dit. */
function evoCadreVide(conteneur, hauteur) {
  conteneur.classList.add("evo-cadre");
  conteneur.innerHTML = `<div class="evo-carte-vide" style="height:${hauteur}px">${escapeHtml(
    t("Pas d'historique de valeurs disponible")
  )}</div>`;
}

/** Un texte de plus-value COLORÉ en entier (signe compris) : vert pour un gain, orange pour une perte. */
function evoValeurColoree(texte, valeur) {
  return `<span class="${classePlusValue(valeur)}">${escapeHtml(texte)}</span>`;
}

function evoMontantCourt(valeur, monnaieId) {
  return formatMontant(Math.round(valeur), monnaieId).replace(/[.,]00(?=\D*$)/, "");
}

/**
 * Dessine UNE courbe dans `conteneur`. `serie` = {nom, valeurs}, `dates` = ISO. L'abscisse est proportionnelle
 * au temps (les trous de la grille ne déforment pas la courbe). Une infobulle suit le pointeur : date et valeur
 * du point le plus proche.
 */
function evoDessiner(
  conteneur,
  dates,
  serie,
  { monnaieId, hauteur = 220, couleur = "var(--accent-light)", pourcentage = false }
) {
  if (!conteneur) return;
  // EN POURCENTAGE (`pourcentage`), les valeurs sont des fractions (0,12 = +12 %) et peuvent être nulles là où
  // rien n'était investi : la courbe s'interrompt alors, et l'axe porte toujours le zéro.
  const connues = serie.valeurs.filter((v) => v !== null && v !== undefined);
  if (dates.length < 2 || connues.length < 2 || (!pourcentage && serie.valeurs.every((v) => !v))) {
    conteneur.innerHTML = `<p class="hint evo-vide">${escapeHtml(t("Pas encore assez de données à tracer."))}</p>`;
    return;
  }
  const largeur = Math.max(conteneur.clientWidth, 260);
  const marge = { gauche: 64, droite: 12, haut: 10, bas: 22 };
  const zoneL = largeur - marge.gauche - marge.droite;
  const zoneH = hauteur - marge.haut - marge.bas;
  const temps = dates.map((d) => new Date(d + "T00:00:00").getTime());
  const debut = temps[0];
  const duree = Math.max(temps[temps.length - 1] - debut, 1);
  let min = Math.min(...connues, 0);
  let max = Math.max(...connues, pourcentage ? 0 : -Infinity);
  if (max - min < (pourcentage ? 0.01 : 1)) max = min + (pourcentage ? 0.01 : 1);
  const garde = (max - min) * 0.08;
  max += garde;
  if (min < 0) min -= garde;
  const x = (i) => marge.gauche + ((temps[i] - debut) / duree) * zoneL;
  const y = (v) => marge.haut + (1 - (v - min) / (max - min)) * zoneH;

  const reperes = [min, (min + max) / 2, max]
    .map((v) => {
      const yy = y(v).toFixed(1);
      return `<line x1="${marge.gauche}" y1="${yy}" x2="${largeur - marge.droite}" y2="${yy}" stroke="var(--border-soft)" />
        <text x="${marge.gauche - 6}" y="${yy}" text-anchor="end" dominant-baseline="middle" font-size="10" fill="var(--text-muted)">${escapeHtml(
          pourcentage ? evoPourcentage(v) : evoMontantCourt(v, monnaieId)
        )}</text>`;
    })
    .join("");
  const etiquettes = [0, dates.length - 1]
    .map(
      (i) =>
        `<text x="${x(i).toFixed(1)}" y="${hauteur - 5}" text-anchor="${i === 0 ? "start" : "end"}" font-size="10" fill="var(--text-muted)">${escapeHtml(
          formatDate(dates[i])
        )}</text>`
    )
    .join("");
  const connu = (v) => v !== null && v !== undefined;
  const points = serie.valeurs.map((v, i) => (connu(v) ? `${x(i).toFixed(1)},${y(v).toFixed(1)}` : null));
  const aire = `${x(0).toFixed(1)},${y(Math.max(min, 0)).toFixed(1)} ${points.join(" ")} ${x(dates.length - 1).toFixed(1)},${y(
    Math.max(min, 0)
  ).toFixed(1)}`;
  // Les segments de la courbe : coupés là où il n'y a rien d'investi (valeur nulle).
  const segments = [];
  let courant = [];
  points.forEach((p) => {
    if (p === null) {
      if (courant.length) segments.push(courant);
      courant = [];
    } else courant.push(p);
  });
  if (courant.length) segments.push(courant);
  // La ligne de ZÉRO en pourcentage : au-dessus, un gain ; au-dessous, une perte.
  const zeroPct = pourcentage
    ? `<line x1="${marge.gauche}" y1="${y(0).toFixed(1)}" x2="${largeur - marge.droite}" y2="${y(0).toFixed(1)}" stroke="var(--text-muted)" stroke-dasharray="4 3" />`
    : "";

  conteneur.classList.add("evo-cadre");
  conteneur.innerHTML = `
    <svg viewBox="0 0 ${largeur} ${hauteur}" width="${largeur}" height="${hauteur}" xmlns="http://www.w3.org/2000/svg" role="img"
         aria-label="${escapeHtml(t("Évolution de la valorisation"))} — ${escapeHtml(serie.nom)}">
      ${reperes}${zeroPct}${etiquettes}
      ${pourcentage ? "" : `<polygon points="${aire}" fill="${couleur}" fill-opacity="0.12" stroke="none" />`}
      ${segments
        .map(
          (seg) =>
            `<polyline fill="none" stroke="${couleur}" stroke-width="2" stroke-linejoin="round" points="${seg.join(" ")}" />`
        )
        .join("")}
      <line class="evo-curseur" y1="${marge.haut}" y2="${hauteur - marge.bas}" stroke="var(--text-muted)" stroke-dasharray="3 3" style="display:none" />
      <circle class="evo-point" r="3.5" fill="${couleur}" style="display:none" />
    </svg>
    <div class="evo-bulle" hidden></div>`;

  const svg = conteneur.querySelector("svg");
  const curseur = conteneur.querySelector(".evo-curseur");
  const pastille = conteneur.querySelector(".evo-point");
  const bulle = conteneur.querySelector(".evo-bulle");
  const cacher = () => {
    curseur.style.display = "none";
    pastille.style.display = "none";
    bulle.hidden = true;
  };
  svg.addEventListener("mouseleave", cacher);
  svg.addEventListener("mousemove", (e) => {
    const rect = svg.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * largeur;
    // Le point le plus proche en abscisse (parmi ceux qui ont une valeur).
    let proche = -1;
    for (let i = 0; i < dates.length; i++) {
      if (!connu(serie.valeurs[i])) continue;
      if (proche < 0 || Math.abs(x(i) - px) < Math.abs(x(proche) - px)) proche = i;
    }
    if (proche < 0) return;
    const cx = x(proche);
    const cy = y(serie.valeurs[proche]);
    curseur.setAttribute("x1", cx);
    curseur.setAttribute("x2", cx);
    curseur.style.display = "";
    pastille.setAttribute("cx", cx);
    pastille.setAttribute("cy", cy);
    pastille.style.display = "";
    bulle.hidden = false;
    bulle.innerHTML = `<strong>${escapeHtml(formatDate(dates[proche]))}</strong><br>${escapeHtml(serie.nom)} : ${
      pourcentage ? escapeHtml(evoPourcentage(serie.valeurs[proche])) : formatMontant(serie.valeurs[proche], monnaieId)
    }`;
    const gauche = (cx / largeur) * rect.width;
    bulle.style.left = `${Math.min(Math.max(gauche + 10, 0), rect.width - bulle.offsetWidth)}px`;
    bulle.style.top = `${Math.max((cy / hauteur) * rect.height - 40, 0)}px`;
  });
}

/** Les onglets de monnaie et de période, posés dans `conteneur` ; `onChange` est rappelé à chaque choix. */
function evoPoserSelecteurs(conteneur, monnaies, onChange) {
  if (!conteneur) return;
  conteneur.innerHTML = "";
  if (monnaies.length > 1) {
    monnaies.forEach((m) => {
      const bouton = document.createElement("button");
      bouton.type = "button";
      bouton.textContent = m.nom;
      bouton.classList.toggle("active", m.id === EVO.monnaieId);
      bouton.addEventListener("click", () => {
        EVO.monnaieId = m.id;
        onChange();
      });
      conteneur.appendChild(bouton);
    });
  }
  const espace = document.createElement("span");
  espace.className = "evo-espace";
  conteneur.appendChild(espace);
  EVO_PERIODES.forEach((p) => {
    const bouton = document.createElement("button");
    bouton.type = "button";
    bouton.textContent = t(p.libelle);
    bouton.classList.toggle("active", p.cle === EVO.periode);
    bouton.addEventListener("click", () => {
      EVO.periode = p.cle;
      onChange();
    });
    conteneur.appendChild(bouton);
  });
}

async function evoCharger(axe) {
  const requete = new URLSearchParams({ axe });
  if (EVO.monnaieId) requete.set("monnaie_id", EVO.monnaieId);
  const reponse = await apiFetch(`/placements/evolution?${requete}`);
  EVO.monnaieId = reponse.monnaie_id;
  return reponse;
}

/* ---------- L'onglet principal : le portefeuille en entier ---------- */

async function evoRendrePrincipal() {
  const graphe = document.getElementById("placements-evolution-graphe");
  if (!graphe) return;
  try {
    const reponse = await evoCharger("total");
    const rogne = evoRogner(reponse, EVO.periode);
    evoPoserSelecteurs(document.getElementById("placements-evolution-selecteurs"), reponse.monnaies, evoRendrePrincipal);
    const serie = rogne.series[0] || { nom: t("Portefeuille"), valeurs: [] };
    evoDessiner(graphe, rogne.dates, serie, { monnaieId: reponse.monnaie_id });
    const evolution = document.getElementById("placements-evolution-variation");
    if (evolution) {
      const perf = evoPerformance(rogne.gain_cumule, rogne.rendement_cumule);
      if (perf) {
        evolution.innerHTML = `${escapeHtml(t("Performance des titres"))} : ${evoValeurColoree(
          evoPerformanceTexte(perf, reponse.monnaie_id),
          perf.gain
        )} ${escapeHtml(t("sur la période, hors achats et ventes"))}`;
        evolution.className = "evo-variation";
      } else {
        evolution.textContent = "";
      }
    }
  } catch (err) {
    graphe.innerHTML = `<p class="hint evo-vide">${escapeHtml(err.message)}</p>`;
  }
}

/* ---------- L'onglet « Analyse » : un graphe par élément de la propriété choisie ---------- */

const EVO_AXES = [
  { cle: "total", libelle: "Aucune séparation" },
  { cle: "compte", libelle: "Compte de détention" },
  { cle: "titre", libelle: "Titre individuel" },
  { cle: "enveloppe", libelle: "Enveloppe de détention" },
  { cle: "classe", libelle: "Type d'actifs" },
  { cle: "zone", libelle: "Zone géographique" },
  { cle: "secteur", libelle: "Secteur d'activités" },
];

function evoPoserMenuMesure() {
  const menu = document.getElementById("placements-analyse-mesure");
  if (!menu || menu.dataset.pose === "1") return;
  menu.dataset.pose = "1";
  menu.innerHTML = `
    <option value="investi">${escapeHtml(t("Valeur(t) / montant investi(t)"))}</option>
    <option value="cours">${escapeHtml(t("Cours"))}</option>`;
  menu.value = EVO.mesure;
  menu.addEventListener("change", () => {
    EVO.mesure = menu.value;
    evoRendreGraphes();
  });
}

function evoPoserMenuAxes() {
  const menu = document.getElementById("placements-analyse-axe");
  if (!menu || menu.dataset.pose === "1") return;
  menu.dataset.pose = "1";
  menu.innerHTML = EVO_AXES.map((a) => `<option value="${a.cle}">${escapeHtml(t(a.libelle))}</option>`).join("");
  menu.value = EVO.axe;
  menu.addEventListener("change", () => {
    EVO.axe = menu.value;
    evoRendreAnalyse();
  });
}

async function evoRendreAnalyse() {
  evoPoserMenuAxes();
  evoPoserMenuMesure();
  const grille = document.getElementById("placements-analyse-graphes");
  if (!grille) return;
  try {
    const reponse = await evoCharger(EVO.axe);
    EVO.derniereReponse = reponse;
    evoPoserSelecteurs(document.getElementById("placements-analyse-selecteurs"), reponse.monnaies, evoRendreAnalyse);
    evoRendreListeTitres(reponse);
    evoRendreGraphes();
  } catch (err) {
    grille.innerHTML = `<p class="hint">${escapeHtml(err.message)}</p>`;
  }
}

/** « Titre individuel » : le champ de sélection à cocher des titres DÉTENUS (valeur > 0 aujourd'hui). */
function evoRendreListeTitres(reponse) {
  const bloc = document.getElementById("placements-analyse-titres");
  const menu = document.getElementById("placements-analyse-titres-menu");
  if (!bloc || !menu) return;
  bloc.style.display = EVO.axe === "titre" ? "" : "none";
  if (EVO.axe !== "titre") return;
  const detenus = reponse.series.filter((s) => s.valeurs[s.valeurs.length - 1] > 0);
  // Un titre vendu depuis ne reste pas « coché » dans l'état.
  const presents = new Set(detenus.map((s) => s.cle));
  [...EVO.titresCoches].forEach((id) => {
    if (!presents.has(id)) EVO.titresCoches.delete(id);
  });
  const compte = document.getElementById("placements-analyse-titres-nb");
  const majCompte = () => {
    if (compte) compte.textContent = detenus.length ? `${EVO.titresCoches.size}/${detenus.length}` : t("Aucun titre détenu.");
  };
  majCompte();
  // LE MÊME MENU QUE LES CATÉGORIES DU BUDGET (app.js, creerMenuCases) : un bouton qui déplie la liste, avec
  // « Tout sélectionner ». Cocher ne redemande rien au serveur : la réponse est déjà là.
  creerMenuCases(menu, {
    libelle: t("Choisir les titres"),
    options: detenus.map((s) => ({ cle: s.cle, libelle: s.nom })),
    coches: EVO.titresCoches,
    toutSelectionner: true,
    onChange: (choisies) => {
      EVO.titresCoches = choisies;
      majCompte();
      evoRendreGraphes();
    },
  });
}

/** Le total, puis un graphe par élément (pour « Titre individuel » : par titre COCHÉ) — depuis la dernière réponse. */
function evoRendreGraphes() {
  const grille = document.getElementById("placements-analyse-graphes");
  const totalCadre = document.getElementById("placements-analyse-total");
  const reponse = EVO.derniereReponse;
  if (!grille || !totalCadre || !reponse) return;
  const rogne = evoRogner(reponse, EVO.periode);
  const choixMesure = document.getElementById("placements-analyse-mesure-bloc");
  if (choixMesure) choixMesure.style.display = EVO.axe === "total" ? "none" : "";
  if (reponse.historique === false) {
    evoCadreVide(totalCadre, 220);
  } else {
    evoDessiner(
      totalCadre,
      rogne.dates,
      { nom: t("Total du portefeuille"), valeurs: rogne.total },
      { monnaieId: reponse.monnaie_id }
    );
  }
  grille.innerHTML = "";
  if (EVO.axe === "total") return;
  let series = rogne.series;
  if (EVO.axe === "titre") {
    series = series.filter((s) => EVO.titresCoches.has(s.cle));
    if (series.length === 0) {
      grille.innerHTML = `<p class="hint">${escapeHtml(t("Coche un ou plusieurs titres pour tracer leur évolution."))}</p>`;
      return;
    }
  }
  if (series.length === 0) {
    grille.innerHTML = `<p class="hint">${escapeHtml(t("Aucune donnée à séparer."))}</p>`;
    return;
  }
  const totalFinal = rogne.total[rogne.total.length - 1];
  series.forEach((serie, rang) => {
    const carte = document.createElement("div");
    carte.className = "evo-carte";
    const derniere = serie.valeurs[serie.valeurs.length - 1] || 0;
    const part = totalFinal ? (derniere / totalFinal) * 100 : 0;
    // LES COURBES PAR ÉLÉMENT SONT EN POURCENTAGE, moins sensibles aux entrées et sorties de capital que la
    // valeur brute. Par défaut : valeur / montant investi - 1 (la plus-value latente en %, comme les KPI de
    // l'onglet Portefeuille). Au choix : la performance des cours seuls, rebasée au début de la période.
    let valeurs;
    let ligneBas = "";
    if (EVO.mesure === "cours") {
      const r = serie.rendement_cumule || [];
      valeurs = r.map((v) => (r.length ? (1 + v) / (1 + r[0]) - 1 : null));
      const perf = evoPerformance(serie.gain_cumule, serie.rendement_cumule);
      if (perf) {
        ligneBas = `${escapeHtml(t("Performance des cours"))} : ${evoValeurColoree(
          evoPerformanceTexte(perf, reponse.monnaie_id),
          perf.gain
        )}`;
      }
    } else {
      valeurs = serie.rendement_investi || [];
      const investi = (serie.investis || [])[serie.investis.length - 1] || 0;
      const dernierPct = valeurs.length ? valeurs[valeurs.length - 1] : null;
      const latente = derniere - investi;
      if (dernierPct !== null) {
        const signe = latente > 0.005 ? "+" : latente < -0.005 ? "−" : "";
        // LE TEXTE DES GRAPHIQUES EST BLANC ; seule la plus-value (montant et pourcentage, signe compris) est
        // colorée, et « investi » est un rappel en gris italique.
        ligneBas = `${escapeHtml(t("Plus-value latente"))} : ${evoValeurColoree(
          `${signe}${formatMontant(Math.abs(latente), reponse.monnaie_id)} (${evoPourcentage(dernierPct)})`,
          latente
        )} <span class="evo-investi">— ${escapeHtml(t("investi"))} ${escapeHtml(
          formatMontant(investi, reponse.monnaie_id)
        )}</span>`;
      }
    }
    carte.innerHTML = `
      <div class="evo-carte-entete">
        <span class="evo-carte-nom">${escapeHtml(serie.nom)}</span>
        <span class="evo-carte-valeur">
          <span title="${escapeHtml(t("Valeur actuelle de cet élément dans le portefeuille"))}">${formatMontant(
            derniere,
            reponse.monnaie_id
          )}</span>
          <span class="evo-part" title="${escapeHtml(t("Part de cet élément dans la valeur totale du portefeuille"))}">${part.toLocaleString(
            "fr-FR",
            { maximumFractionDigits: 1 }
          )} %</span></span>
      </div>
      <div class="evo-carte-perf">${ligneBas}</div>
      <div class="evo-graphe"></div>`;
    grille.appendChild(carte);
    // PAS D'HISTORIQUE (une seule valeur en base) : pas de graphe, une carte vide du même format.
    if (serie.historique === false) {
      evoCadreVide(carte.querySelector(".evo-graphe"), 170);
      return;
    }
    evoDessiner(carte.querySelector(".evo-graphe"), rogne.dates, { nom: serie.nom, valeurs }, {
      monnaieId: reponse.monnaie_id,
      hauteur: 170,
      couleur: evoCouleur(rang),
      pourcentage: true,
    });
  });
}

// Un historique récupéré (extension « Lecture de cours ») : les courbes se redessinent.
document.addEventListener("budgetapp:cours-historique", () => {
  if (typeof placementsOngletActif === "function") {
    const onglet = placementsOngletActif();
    if (onglet === "portefeuille") evoRendrePrincipal();
    if (onglet === "analyse") evoRendreAnalyse();
  }
});
