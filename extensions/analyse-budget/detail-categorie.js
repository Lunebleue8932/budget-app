/* ---------- Le DÉTAIL d'une catégorie parent (page Budget) ----------
 *
 * UNE FENÊTRE, ouverte depuis l'infobulle d'une barre, d'une tranche ou d'une ligne de légende (le bouton « Détail de la
 * catégorie », à côté de « Voir toutes les dépenses » qui, lui, mène toujours à la page Opérations). Elle ne concerne que
 * les catégories de PREMIER NIVEAU : une sous-catégorie se lit comme une catégorie normale.
 *
 * Elle montre, pour une période qu'on peut changer SANS quitter la fenêtre (un mois ou l'année) :
 *   - une JAUGE en demi-anneau, avec une tranche par sous-catégorie (et la part directe du parent). Elle est
 *     COMPLÈTE quand le parent n'a pas de budget ou que ce budget est dépassé, partiellement remplie sinon ;
 *   - ses composantes (part directe, sous-catégories) avec leurs montants et leurs budgets ;
 *   - TOUTES LES OPÉRATIONS prises en compte — celles que lit l'histogramme (reste à charge, part amortie), de la
 *     catégorie et de ses sous-catégories.
 *
 * Même forme que la fenêtre d'une monnaie éteinte (`.modale-fond` / `.modale-monnaie-eteinte`). Préfixe `abdc`.
 */

const ABDC = { depense: null, monnaieId: null, vue: "mois", niveau: "mois", moisDeplie: true, annee: null, mois: null, donnees: null };

function abdcEl(id) {
  return document.getElementById(id);
}

function abdcFermer() {
  abdcEl("ab-modale-detail-categorie").style.display = "none";
  document.body.classList.remove("modale-ouverte");
}

/** Ouvre la fenêtre pour une barre du graphe (`depense`, avec `categorie_id` et `detail_periode`). */
async function ouvrirDetailCategorie(depense) {
  if (!depense || !depense.categorie_id) return;
  const periode = depense.detail_periode || {};
  ABDC.depense = depense;
  ABDC.monnaieId = depense.detail_monnaie_id ?? abMonnaieId;
  ABDC.vue = periode.vue === "annee" ? "annee" : "mois";
  ABDC.annee = periode.annee ?? new Date().getFullYear();
  ABDC.mois = periode.mois ?? new Date().getMonth() + 1;
  abdcEl("ab-modale-detail-categorie").style.display = "";
  document.body.classList.add("modale-ouverte");
  abdcPoserSelecteurs();
  await abdcCharger();
}

/** LE SÉLECTEUR DE LA PAGE BUDGET (`creerArbrePeriode`), le même : niveaux année et mois, tous les mois proposés. */
function abdcPoserSelecteurs() {
  ABDC.niveau = ABDC.vue;
  ABDC.moisDeplie = ABDC.vue === "mois";
  creerArbrePeriode(abdcEl("abdc-periode"), {
    etat: ABDC,
    annees: abAnneesProposees,
    moisDisponibles: () => Array.from({ length: 12 }, (_, i) => i + 1),
    avecTout: false,
    avecSemaines: false,
    surChangement: () => {
      ABDC.vue = ABDC.niveau === "annee" ? "annee" : "mois";
      abdcCharger();
    },
  });
}

async function abdcCharger() {
  const corps = abdcEl("abdc-corps");
  corps.innerHTML = `<p class="hint">${escapeHtml(t("Chargement…"))}</p>`;
  const requete = new URLSearchParams({
    categorie_id: ABDC.depense.categorie_id,
    monnaie_id: ABDC.monnaieId,
    annee: ABDC.annee,
  });
  if (ABDC.vue === "mois") requete.set("mois", ABDC.mois);
  try {
    ABDC.donnees = await apiFetch(`/analyse-budget/detail-categorie?${requete}`);
    abdcRendre();
  } catch (err) {
    corps.innerHTML = `<p class="hint">${escapeHtml(err.message)}</p>`;
  }
}

/** La couleur d'une composante : celle du parent pour sa part directe, une nuance pour une sous-catégorie. */
function abdcCouleur(composante, couleurIndex) {
  if (composante.direct) return couleurCategorie(couleurIndex);
  return nuancesDeCategorie(couleurIndex)[(composante.couleur_nuance ?? 0) % NB_NUANCES_CATEGORIE];
}

/**
 * La JAUGE : un demi-anneau de gauche (0 %) à droite (100 %). `rempli` est la part de l'arc qu'occupent les tranches
 * (1 quand le parent n'a pas de budget ou l'a dépassé) ; le reste de l'arc est une piste grise. Chaque tranche a la
 * largeur de son poids dans le total ; son réel est plein, ce qui n'est que prévu est transparent.
 */
function abdcJaugeSvg(d) {
  const largeur = 340;
  const hauteur = 190;
  const cx = largeur / 2;
  const cy = 160;
  const rayon = 120;
  const epaisseur = 30;
  const point = (t) => [cx + rayon * Math.cos(Math.PI * (1 - t)), cy - rayon * Math.sin(Math.PI * (1 - t))];
  // LE PRÉVU est hachuré à la couleur de la tranche (cf. motifHachurePrevu, app.js), jamais transparent.
  const motifs = [];
  const arc = (t0, t1, couleur, opacite = 1, prevu = false) => {
    if (t1 - t0 < 0.0005) return "";
    const [x0, y0] = point(t0);
    const [x1, y1] = point(t1);
    let trait = couleur;
    if (prevu) {
      const motif = motifHachurePrevu(couleur);
      motifs.push(motif.def);
      trait = `url(#${motif.id})`;
    }
    return `<path d="M${x0.toFixed(2)},${y0.toFixed(2)} A${rayon},${rayon} 0 0 1 ${x1.toFixed(2)},${y1.toFixed(2)}"
      fill="none" stroke="${trait}" stroke-width="${epaisseur}" ${opacite < 1 ? `opacity="${opacite}"` : ""} />`;
  };
  const total = Math.max(d.total_previsionnel, d.total_reel);
  const rempli = d.budget_alloue > 0 && total < d.budget_alloue ? total / d.budget_alloue : 1;
  const poids = d.composantes.map((c) => Math.max(c.total_previsionnel, c.total_reel));
  const somme = poids.reduce((a, b) => a + b, 0) || 1;

  let morceaux = arc(rempli, 1, "var(--border)", 0.6); // la piste, derrière
  let curseur = 0;
  d.composantes.forEach((c, i) => {
    const part = (poids[i] / somme) * rempli;
    const couleur = abdcCouleur(c, d.couleur_index);
    const reel = poids[i] > 0 ? c.total_reel / poids[i] : 0;
    morceaux += arc(curseur, curseur + part * reel, couleur, 1);
    morceaux += arc(curseur + part * reel, curseur + part, couleur, 1, true);
    curseur += part;
    // Un filet entre deux tranches : à la couleur de la fenêtre, pour les détacher.
    if (i < d.composantes.length - 1 && part > 0.0005) {
      const [xi, yi] = [cx + (rayon - epaisseur / 2) * Math.cos(Math.PI * (1 - curseur)), cy - (rayon - epaisseur / 2) * Math.sin(Math.PI * (1 - curseur))];
      const [xo, yo] = [cx + (rayon + epaisseur / 2) * Math.cos(Math.PI * (1 - curseur)), cy - (rayon + epaisseur / 2) * Math.sin(Math.PI * (1 - curseur))];
      morceaux += `<line x1="${xi.toFixed(2)}" y1="${yi.toFixed(2)}" x2="${xo.toFixed(2)}" y2="${yo.toFixed(2)}" stroke="var(--bg-surface)" stroke-width="2" />`;
    }
  });
  const depasse = d.budget_alloue > 0 && total > d.budget_alloue;
  const sousTexte =
    d.budget_alloue > 0
      ? `${t("sur un budget de")} ${formatMontant(d.budget_alloue, d.monnaie_id)}${
          depasse ? ` — ${t("dépassé")}` : ` (${Math.round((total / d.budget_alloue) * 100)} %)`
        }`
      : t("Pas de budget");
  return `<svg viewBox="0 0 ${largeur} ${hauteur}" width="${largeur}" height="${hauteur}" role="img"
      aria-label="${escapeHtml(t("Jauge de la catégorie"))}" xmlns="http://www.w3.org/2000/svg">
      <defs>${motifs.join("")}</defs>
      ${morceaux}
      <text x="${cx}" y="${cy - 22}" text-anchor="middle" font-size="22" font-weight="600" fill="var(--text-primary)">${escapeHtml(
        formatMontant(total, d.monnaie_id)
      )}</text>
      <text x="${cx}" y="${cy - 2}" text-anchor="middle" font-size="12" fill="${depasse ? "var(--depense)" : "var(--text-muted)"}">${escapeHtml(sousTexte)}</text>
    </svg>`;
}

function abdcRendre() {
  const d = ABDC.donnees;
  const corps = abdcEl("abdc-corps");
  const periode = d.mois ? libelleMois(d.annee, d.mois) : t("année {annee}", { annee: d.annee });
  abdcEl("abdc-titre").innerHTML = `${categorieHtml(d.categorie_id)} <span class="hint">· ${escapeHtml(periode)}</span>`;

  const composantes = d.composantes
    .map((c) => {
      const part = Math.max(c.total_previsionnel, c.total_reel);
      return `<li class="abdc-composante">
        <span class="repartition-pastille" style="background:${abdcCouleur(c, d.couleur_index)}"></span>
        <span class="abdc-composante-nom">${escapeHtml(c.direct ? `${libelleCategorie(c.categorie)} (${t("directement")})` : libelleCategorie(c.categorie))}</span>
        <span class="abdc-composante-montant">${formatMontant(part, d.monnaie_id)}</span>
        <span class="abdc-composante-budget hint">${c.budget_alloue > 0 ? `${t("budget")} ${formatMontant(c.budget_alloue, d.monnaie_id)}` : ""}</span>
      </li>`;
    })
    .join("");

  const lignes = d.operations.length
    ? d.operations
        .map(
          (o) => `<tr>
            <td>${escapeHtml(formatDate(o.date))}</td>
            <td>${escapeHtml(o.nature || t("Sans libellé"))}</td>
            <td>${categorieHtml(o.categorie_id)}</td>
            <td>${montantHtml(o.montant, "dépense", d.monnaie_id)}</td>
          </tr>`
        )
        .join("")
    : `<tr><td colspan="4" class="hint">${escapeHtml(t("Aucune opération sur la période."))}</td></tr>`;
  const totalOps = d.operations.reduce((s, o) => s + o.montant, 0);

  corps.innerHTML = `
    <div class="abdc-haut">
      <div class="abdc-jauge">${abdcJaugeSvg(d)}</div>
      <ul class="abdc-composantes">${composantes}</ul>
    </div>
    <h4>${escapeHtml(t("Opérations prises en compte"))} <span class="hint">(${d.operations.length}${
      d.operations.length ? ` · ${escapeHtml(formatMontant(totalOps, d.monnaie_id))}` : ""
    })</span></h4>
    <table class="abdc-table">
      <thead><tr><th>${escapeHtml(t("Date"))}</th><th>${escapeHtml(t("Nature"))}</th><th>${escapeHtml(t("Catégorie"))}</th><th>${escapeHtml(t("Montant"))}</th></tr></thead>
      <tbody>${lignes}</tbody>
    </table>`;
}

document.getElementById("btn-abdc-fermer")?.addEventListener("click", abdcFermer);
abdcEl("ab-modale-detail-categorie")?.addEventListener("click", (e) => {
  if (e.target.id === "ab-modale-detail-categorie") abdcFermer();
});
document.addEventListener("keydown", (e) => {
  const fenetre = abdcEl("ab-modale-detail-categorie");
  if (e.key === "Escape" && fenetre && fenetre.style.display !== "none") abdcFermer();
});
