/* ---------- Le solde prévisionnel (extension « Budget ») ----------
 *
 * LA COURBE DU SOLDE DES COMPTES COURANTS, du passé récent à l'horizon choisi :
 * le « Solde total » du dashboard, étiré dans le temps. Le calcul est au
 * serveur (cf. service_solde_previsionnel.py) — rien ici ne recalcule un solde,
 * l'écran dessine ce qu'on lui rend.
 *
 * CHARGÉ APRÈS analyse-budget.js, dans la même portée : il s'appuie sur
 * `abMonnaieId`, `abBasculerCarte`… et est appelé par `abChargerPrevisions` (onglet « Prévisions »). Tout est
 * préfixé `abSp` / `AB_SP_` (les scripts d'extension partagent une seule portée,
 * cf. extensions/README.md).
 *
 * CE QUI SE RANGE EN BASE (`preference_interface`, clé AB_SP_CLE) : les
 * exclusions — catégories, types, opérations — désignent des identifiants de la
 * base, donc elles vivent avec elle (cf. app.js, « Les rangements d'écran »).
 * Les réglages d'affichage (horizon, cadence, fenêtre) voyagent avec : un
 * second jeu de réglages dans le navigateur aurait laissé exister un état où les
 * exclusions sont celles d'hier et la fenêtre celle d'aujourd'hui.
 */

const AB_SP_CLE = "analyse-budget.solde-previsionnel";

const abSp = {
  horizon: 90,
  avancee: false,
  cadence: "jour",
  fenetre: "12",
  categories: [],
  types: [],
  operations: [],
  // Les doublons qu'on a choisi de ne plus voir : `genre:id` de la prévisionnelle.
  ignores: [],
  charge: false,
  // Ce que la dernière lecture a rapporté, gardé pour le survol.
  donnees: null,
  referentiels: null,
};

const AB_SP_TYPES_DE_DEPENSE = ["classique", "remboursable"];

async function abSpLireRangement() {
  const rangement = await lirePreference(AB_SP_CLE);
  if (rangement && typeof rangement === "object") {
    for (const cle of Object.keys(abSp)) {
      if (cle in rangement && !["charge", "donnees", "referentiels"].includes(cle)) {
        abSp[cle] = rangement[cle];
      }
    }
  }
  abSp.charge = true;
}

function abSpEcrireRangement() {
  const { horizon, avancee, cadence, fenetre, categories, types, operations, ignores } = abSp;
  return ecrirePreference(AB_SP_CLE, {
    horizon,
    avancee,
    cadence,
    fenetre,
    categories,
    types,
    operations,
    ignores,
  });
}

async function abSpReferentiels() {
  if (abSp.referentiels) return abSp.referentiels;
  const [categories, types] = await Promise.all([
    apiFetch("/categories"),
    apiFetch("/types-operation"),
  ]);
  abSp.referentiels = {
    // Les catégories d'ENTRÉE n'ont rien à faire dans une moyenne de dépenses.
    // Ni celle des virements internes (migration 0090).
    categories: categories.filter((c) => !c.est_entree && !c.est_virement),
    types: types.filter((tp) => AB_SP_TYPES_DE_DEPENSE.includes(tp.code)),
  };
  return abSp.referentiels;
}

function abSpRequete() {
  const p = new URLSearchParams();
  p.set("monnaie_id", String(abMonnaieId));
  const fin = new Date();
  fin.setDate(fin.getDate() + Number(abSp.horizon));
  p.set("jusqu_au", abSpIso(fin));
  p.set("avancee", String(abSp.avancee));
  p.set("cadence", abSp.cadence);
  if (abSp.fenetre === "tout") p.set("tout_l_historique", "true");
  else p.set("fenetre", abSp.fenetre);
  abSp.categories.forEach((id) => p.append("exclure_categories", id));
  abSp.types.forEach((code) => p.append("exclure_types", code));
  abSp.operations.forEach((id) => p.append("exclure_operations", id));
  return p.toString();
}

/* ---------- Le dessin ---------- */

const AB_SP_NS = "http://www.w3.org/2000/svg";

/** Une graduation « ronde » : 4 à 6 repères entre `min` et `max`. */
function abSpGraduations(min, max) {
  const etendue = max - min || 1;
  const brut = etendue / 5;
  const puissance = Math.pow(10, Math.floor(Math.log10(brut)));
  const pas = [1, 2, 2.5, 5, 10].map((m) => m * puissance).find((p) => p >= brut) || brut;
  const debut = Math.ceil(min / pas) * pas;
  const reperes = [];
  for (let v = debut; v <= max + 1e-9; v += pas) reperes.push(Math.round(v * 100) / 100);
  return reperes;
}

/** « 2026-09-15 » en HEURE LOCALE, comme le serveur lit « aujourd'hui » :
 *  `toISOString` passe par l'UTC et décalerait d'un jour passé minuit. */
function abSpIso(date) {
  const pad = (n) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function abSpDate(iso) {
  const [annee, mois, jour] = iso.split("-").map(Number);
  return new Date(annee, mois - 1, jour);
}

/**
 * LA COURBE EN ESCALIER : un solde ne glisse pas d'un jour à l'autre, il saute
 * le jour d'un mouvement et reste là jusqu'au suivant. Une droite entre deux
 * points aurait fait descendre le solde AVANT le prélèvement.
 *
 * LE PASSÉ EN TRAIT PLEIN, LE FUTUR EN POINTILLÉS : ce qui est survenu et ce qui
 * est attendu ne se lisent pas avec la même confiance.
 */
function abLineChart(conteneur, donnees, monnaieId) {
  if (!conteneur) return;
  conteneur.innerHTML = "";
  const points = donnees.points;
  if (!points.length) return;

  const largeur = Math.max(conteneur.clientWidth || 0, 600);
  const hauteur = 300;
  const marge = { haut: 18, droite: 18, bas: 34, gauche: 84 };
  const zoneL = largeur - marge.gauche - marge.droite;
  const zoneH = hauteur - marge.haut - marge.bas;

  const valeurs = points.map((p) => p.solde);
  let min = Math.min(...valeurs);
  let max = Math.max(...valeurs);
  // Le seuil du matelas et le zéro entrent dans l'échelle quand ils sont proches
  // de la courbe : un trait de référence hors cadre ne dit rien.
  if (donnees.matelas > 0) {
    min = Math.min(min, donnees.matelas);
    max = Math.max(max, donnees.matelas);
  }
  if (min < 0) max = Math.max(max, 0);
  if (max > 0 && min > 0 && min < max * 0.25) min = 0;
  const marges = (max - min || 1) * 0.08;
  min -= marges;
  max += marges;

  const t0 = abSpDate(points[0].date).getTime();
  const t1 = abSpDate(points[points.length - 1].date).getTime();
  const x = (iso) => marge.gauche + ((abSpDate(iso).getTime() - t0) / (t1 - t0 || 1)) * zoneL;
  const y = (v) => marge.haut + (1 - (v - min) / (max - min || 1)) * zoneH;

  const escalier = (liste) => {
    if (!liste.length) return "";
    let d = `M ${x(liste[0].date)} ${y(liste[0].solde)}`;
    for (let i = 1; i < liste.length; i++) {
      d += ` L ${x(liste[i].date)} ${y(liste[i - 1].solde)} L ${x(liste[i].date)} ${y(liste[i].solde)}`;
    }
    return d;
  };
  const passe = points.filter((p) => p.passe);
  // Le futur repart du DERNIER point du passé : sinon la courbe aurait un trou
  // entre aujourd'hui et demain.
  const futur = points.filter((p) => !p.passe);
  const futurRelie = passe.length ? [passe[passe.length - 1], ...futur] : futur;

  const reperesY = abSpGraduations(min, max)
    .map(
      (v) => `
      <line class="ab-sp-grille" x1="${marge.gauche}" y1="${y(v)}" x2="${largeur - marge.droite}" y2="${y(v)}" />
      <text class="ab-sp-axe-texte" x="${marge.gauche - 8}" y="${y(v) + 3}" text-anchor="end">${escapeHtml(
        formatMontant(v, monnaieId)
      )}</text>`
    )
    .join("");

  // Les repères du bas : le 1er de chaque mois, ou toutes les semaines si
  // l'horizon est trop court pour en contenir deux.
  const reperesX = [];
  const premier = abSpDate(points[0].date);
  const dernier = abSpDate(points[points.length - 1].date);
  const jours = (dernier - premier) / 86400000;
  if (jours > 70) {
    const curseur = new Date(premier.getFullYear(), premier.getMonth() + 1, 1);
    const pasMois = jours > 200 ? 2 : 1;
    let n = 0;
    while (curseur <= dernier) {
      if (n % pasMois === 0) {
        reperesX.push({
          date: new Date(curseur),
          texte: MOIS_COURTS_FR[curseur.getMonth()] + (curseur.getMonth() === 0 ? ` ${curseur.getFullYear()}` : ""),
        });
      }
      curseur.setMonth(curseur.getMonth() + 1);
      n++;
    }
  } else {
    const curseur = new Date(premier);
    while (curseur <= dernier) {
      reperesX.push({
        date: new Date(curseur),
        texte: `${String(curseur.getDate()).padStart(2, "0")}/${String(curseur.getMonth() + 1).padStart(2, "0")}`,
      });
      curseur.setDate(curseur.getDate() + 7);
    }
  }
  const xDe = (date) => marge.gauche + ((date.getTime() - t0) / (t1 - t0 || 1)) * zoneL;
  const reperesXSvg = reperesX
    .map(
      (r) => `
      <line class="ab-sp-grille ab-sp-grille-x" x1="${xDe(r.date)}" y1="${marge.haut}" x2="${xDe(r.date)}" y2="${hauteur - marge.bas}" />
      <text class="ab-sp-axe-texte" x="${xDe(r.date)}" y="${hauteur - 14}" text-anchor="middle">${escapeHtml(r.texte)}</text>`
    )
    .join("");

  const zero =
    min < 0 && max > 0
      ? `<line class="ab-axe-zero" x1="${marge.gauche}" y1="${y(0)}" x2="${largeur - marge.droite}" y2="${y(0)}" />`
      : "";
  const matelas =
    donnees.matelas > 0
      ? `<line class="ab-sp-matelas" x1="${marge.gauche}" y1="${y(donnees.matelas)}" x2="${largeur - marge.droite}" y2="${y(donnees.matelas)}" />
         <text class="ab-sp-matelas-texte" x="${largeur - marge.droite - 4}" y="${y(donnees.matelas) - 4}" text-anchor="end">${escapeHtml(t("Matelas"))}</text>`
      : "";
  const xAujourdhui = x(donnees.aujourdhui);

  // Un repère par échéance, posé sur la courbe au jour où elle la fait bouger.
  const parJour = new Map(points.map((p) => [p.date, p.solde]));
  const marqueurs = donnees.echeances
    .map((e) => {
      const solde = parJour.get(e.jour_pose);
      if (solde === undefined) return "";
      const classe = e.montant >= 0 ? "ab-sp-marque-entree" : "ab-sp-marque-sortie";
      const titre = `${formatDateCourte(e.jour_pose)} — ${e.nature} — ${formatMontant(e.montant, monnaieId)}`;
      return `<circle class="${classe}" cx="${x(e.jour_pose)}" cy="${y(solde)}" r="3.5"><title>${escapeHtml(titre)}</title></circle>`;
    })
    .join("");

  conteneur.innerHTML = `
    <svg viewBox="0 0 ${largeur} ${hauteur}" width="100%" height="${hauteur}"
         xmlns="${AB_SP_NS}" class="ab-sp-svg" id="ab-sp-svg">
      ${reperesY}
      ${reperesXSvg}
      ${zero}
      ${matelas}
      <line class="ab-sp-aujourdhui" x1="${xAujourdhui}" y1="${marge.haut}" x2="${xAujourdhui}" y2="${hauteur - marge.bas}" />
      <text class="ab-sp-axe-texte" x="${xAujourdhui + 4}" y="${marge.haut + 10}">${escapeHtml(t("Aujourd'hui"))}</text>
      <path class="ab-sp-courbe-passe" d="${escalier(passe)}" />
      <path class="ab-sp-courbe-futur" d="${escalier(futurRelie)}" />
      ${marqueurs}
      <line class="ab-sp-reticule" id="ab-sp-reticule" y1="${marge.haut}" y2="${hauteur - marge.bas}" style="display:none" />
      <rect class="ab-sp-survol" x="${marge.gauche}" y="${marge.haut}" width="${zoneL}" height="${zoneH}" />
    </svg>`;

  abSpCablerSurvol(conteneur, donnees, { x, y, marge, largeur, hauteur, zoneL }, monnaieId);
}

/** Le survol : un repère vertical et une bulle avec le solde du jour et ce qui
 *  tombe ce jour-là. Pas de bibliothèque — le noyau n'en a aucune. */
function abSpCablerSurvol(conteneur, donnees, echelle, monnaieId) {
  const svg = conteneur.querySelector("#ab-sp-svg");
  const reticule = conteneur.querySelector("#ab-sp-reticule");
  const bulle = document.getElementById("ab-sp-bulle");
  if (!svg || !bulle) return;
  const points = donnees.points;
  const t0 = abSpDate(points[0].date).getTime();
  const t1 = abSpDate(points[points.length - 1].date).getTime();

  svg.addEventListener("mousemove", (e) => {
    const rect = svg.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width) * echelle.largeur;
    const ratio = Math.min(1, Math.max(0, (px - echelle.marge.gauche) / echelle.zoneL));
    const cible = t0 + ratio * (t1 - t0);
    const index = Math.round(((cible - t0) / (t1 - t0 || 1)) * (points.length - 1));
    const point = points[Math.min(points.length - 1, Math.max(0, index))];
    const xp = echelle.x(point.date);
    reticule.setAttribute("x1", xp);
    reticule.setAttribute("x2", xp);
    reticule.style.display = "";

    const ce_jour = donnees.echeances.filter((ech) => ech.jour_pose === point.date);
    const lignes = ce_jour
      .map(
        (ech) =>
          `<div class="ab-sp-bulle-ligne"><span>${escapeHtml(ech.nature)}</span><span class="montant ${
            ech.montant >= 0 ? "positif" : "negatif"
          }">${escapeHtml(formatMontant(ech.montant, monnaieId))}</span></div>`
      )
      .join("");
    bulle.innerHTML = `
      <div class="ab-sp-bulle-date">${escapeHtml(formatDate(point.date))}</div>
      <div class="ab-sp-bulle-solde">${escapeHtml(formatMontant(point.solde, monnaieId))}</div>
      ${lignes}`;
    bulle.hidden = false;
    const cadre = conteneur.parentElement.getBoundingClientRect();
    const gauche = e.clientX - cadre.left + 14;
    bulle.style.left = `${Math.min(gauche, cadre.width - bulle.offsetWidth - 8)}px`;
    bulle.style.top = `${e.clientY - cadre.top + 14}px`;
  });
  svg.addEventListener("mouseleave", () => {
    reticule.style.display = "none";
    bulle.hidden = true;
  });
}

/* ---------- Le texte autour de la courbe ---------- */

function abSpRenderResume(donnees) {
  const resume = document.getElementById("ab-sp-resume");
  if (!resume) return;
  const m = donnees.monnaie_id;
  const morceaux = [
    t("Aujourd'hui : {solde}", { solde: formatMontant(donnees.solde_aujourdhui, m) }),
    t("Au {date} : {solde}", {
      date: formatDateCourte(donnees.jusqu_au),
      solde: formatMontant(donnees.solde_fin, m),
    }),
  ];
  const moy = donnees.moyenne;
  if (moy.active) {
    morceaux.push(
      moy.nombre_operations
        ? t("Dépenses moyennes : {montant} par {unite} ({n} opérations sur {jours} jours)", {
            montant: formatMontant(abSp.cadence === "semaine" ? moy.par_semaine : moy.par_jour, m),
            unite: abSp.cadence === "semaine" ? t("semaine") : t("jour"),
            n: moy.nombre_operations,
            jours: moy.jours,
          })
        : t("Aucune dépense passée à moyenner.")
    );
  }
  resume.textContent = morceaux.join(" · ");
}

function abSpRenderEcheances(donnees) {
  const bloc = document.getElementById("ab-sp-echeances-bloc");
  const corps = document.getElementById("ab-sp-echeances");
  const titre = document.getElementById("ab-sp-echeances-titre");
  if (!bloc || !corps) return;
  const liste = donnees.echeances;
  bloc.hidden = !liste.length && !abSp.operations.length;
  titre.textContent = t("{n} échéances prises en compte", { n: liste.length });
  corps.innerHTML = liste
    .map(
      (e) => `
      <tr>
        <td>${escapeHtml(formatDateCourte(e.jour_pose))}${
          e.en_retard ? ` <span class="badge-aucun">${escapeHtml(t("en retard"))}</span>` : ""
        }</td>
        <td>${escapeHtml(e.nature)}</td>
        <td>${escapeHtml(e.compte_nom)}</td>
        <td class="montant ${e.montant >= 0 ? "positif" : "negatif"}">${escapeHtml(
          formatMontant(e.montant, donnees.monnaie_id)
        )}</td>
        <td><button type="button" class="secondary" data-ab-sp-ignorer="${e.id}">${escapeHtml(
          t("Ne plus compter")
        )}</button></td>
      </tr>`
    )
    .join("");
}

function abSpRenderDoublons(donnees) {
  const zone = document.getElementById("ab-sp-doublons");
  if (!zone) return;
  const m = donnees.monnaie_id;
  const visibles = donnees.doublons.filter(
    (d) => !abSp.ignores.includes(`${d.genre}:${d.prevu.id}`)
  );
  zone.innerHTML = visibles
    .map((d) => {
      const cle = `${d.genre}:${d.prevu.id}`;
      const montant = formatMontant(d.prevu.montant, m);
      let phrase;
      let action;
      if (d.genre === "deja_reelle") {
        phrase = t(
          "« {nature} » ({montant}) est prévue le {date}, mais une opération identique est déjà passée le {dateReelle} : elle est comptée deux fois.",
          {
            nature: d.prevu.nature,
            montant,
            date: formatDateCourte(d.prevu.date),
            dateReelle: formatDateCourte(d.passes[0].date),
          }
        );
        action = t("Ne plus compter la prévue");
      } else {
        phrase = t(
          "« {nature} » ({montant}) est prévue {n} fois, et {k} de ses occurrences passées figurent déjà dans la moyenne : ce montant est compté deux fois.",
          { nature: d.prevu.nature, montant, n: d.occurrences, k: d.passes.length }
        );
        action = t("Sortir les passées de la moyenne");
      }
      return `
        <div class="ab-sp-doublon">
          <span>${escapeHtml(phrase)}</span>
          <span class="ab-sp-doublon-actions">
            <button type="button" class="primary" data-ab-sp-appliquer="${escapeHtml(cle)}">${escapeHtml(action)}</button>
            <button type="button" class="secondary" data-ab-sp-ecarter="${escapeHtml(cle)}">${escapeHtml(t("Ignorer"))}</button>
          </span>
        </div>`;
    })
    .join("");
}

/** Les cases d'exclusion, cochées d'après le rangement. */
async function abSpRenderExclusions() {
  const ref = await abSpReferentiels();
  const cases = (liste, coches, attribut, libelle) =>
    liste
      .map(
        (el) => `
      <label class="ab-sp-case">
        <input type="checkbox" ${attribut}="${escapeHtml(String(el.cle))}" ${
          coches.map(String).includes(String(el.cle)) ? "checked" : ""
        } />
        ${escapeHtml(libelle(el))}
      </label>`
      )
      .join("");
  const cats = document.getElementById("ab-sp-exclure-categories");
  const types = document.getElementById("ab-sp-exclure-types");
  if (cats) {
    cats.innerHTML = `<legend>${escapeHtml(t("Catégories"))}</legend>${cases(
      ref.categories.map((c) => ({ cle: c.id, nom: c.nom })),
      abSp.categories,
      "data-ab-sp-categorie",
      (c) => c.nom
    )}`;
  }
  if (types) {
    types.innerHTML = `<legend>${escapeHtml(t("Types d'opération"))}</legend>${cases(
      ref.types.map((tp) => ({ cle: tp.code, nom: tp.nom })),
      abSp.types,
      "data-ab-sp-type",
      (tp) => tp.nom
    )}`;
  }
  const manuelles = document.getElementById("ab-sp-exclusions-manuelles");
  if (manuelles) {
    manuelles.hidden = !abSp.operations.length;
    manuelles.innerHTML = abSp.operations.length
      ? `${escapeHtml(t("{n} opération(s) écartée(s) à la main.", { n: abSp.operations.length }))}
         <button type="button" class="secondary" id="ab-sp-reintegrer">${escapeHtml(t("Tout réintégrer"))}</button>`
      : "";
  }
}

function abSpSynchroniserControles() {
  const horizon = document.getElementById("ab-sp-horizon");
  if (horizon) horizon.value = String(abSp.horizon);
  const avancee = document.getElementById("ab-sp-avancee");
  if (avancee) avancee.checked = !!abSp.avancee;
  const options = document.getElementById("ab-sp-options-avancee");
  if (options) options.hidden = !abSp.avancee;
  const cadence = document.getElementById("ab-sp-cadence");
  if (cadence) cadence.value = abSp.cadence;
  const fenetre = document.getElementById("ab-sp-fenetre");
  if (fenetre) fenetre.value = String(abSp.fenetre);
}

/* ---------- Le chargement ---------- */

async function abSpCharger() {
  if (!document.getElementById("ab-sp-graphe") || abMonnaieId == null) return;
  try {
    if (!abSp.charge) await abSpLireRangement();
    abSpSynchroniserControles();
    const [donnees] = await Promise.all([
      apiFetch(`/analyse-budget/solde-previsionnel?${abSpRequete()}`),
      abSpRenderExclusions(),
    ]);
    abSp.donnees = donnees;
    abLineChart(document.getElementById("ab-sp-graphe"), donnees, donnees.monnaie_id);
    abSpRenderResume(donnees);
    abSpRenderDoublons(donnees);
    abSpRenderEcheances(donnees);
  } catch (err) {
    showMessage(err.message, "error");
  }
}

function abSpChanger(modif) {
  Object.assign(abSp, modif);
  abSpEcrireRangement();
  return abSpCharger();
}

/** Ajoute (ou retire) une valeur d'une liste de rangement. */
function abSpBasculer(liste, valeur, present) {
  const sans = liste.filter((v) => String(v) !== String(valeur));
  return present ? [...sans, valeur] : sans;
}

/* ---------- Les gestes ---------- */

(function abSpCabler() {
  const racine = document.getElementById("section-budget");
  if (!racine) return;

  document.getElementById("ab-sp-horizon")?.addEventListener("change", (e) => {
    abSpChanger({ horizon: Number(e.target.value) });
  });
  document.getElementById("ab-sp-avancee")?.addEventListener("change", (e) => {
    abSpChanger({ avancee: e.target.checked });
  });
  document.getElementById("ab-sp-cadence")?.addEventListener("change", (e) => {
    abSpChanger({ cadence: e.target.value });
  });
  document.getElementById("ab-sp-fenetre")?.addEventListener("change", (e) => {
    abSpChanger({ fenetre: e.target.value });
  });

  racine.addEventListener("change", (e) => {
    const categorie = e.target.closest("[data-ab-sp-categorie]");
    if (categorie) {
      const id = Number(categorie.dataset.abSpCategorie);
      abSpChanger({ categories: abSpBasculer(abSp.categories, id, categorie.checked) });
      return;
    }
    const type = e.target.closest("[data-ab-sp-type]");
    if (type) {
      abSpChanger({ types: abSpBasculer(abSp.types, type.dataset.abSpType, type.checked) });
    }
  });

  racine.addEventListener("click", (e) => {
    const ignorer = e.target.closest("[data-ab-sp-ignorer]");
    if (ignorer) {
      const id = Number(ignorer.dataset.abSpIgnorer);
      abSpChanger({ operations: abSpBasculer(abSp.operations, id, true) });
      return;
    }
    if (e.target.closest("#ab-sp-reintegrer")) {
      abSpChanger({ operations: [] });
      return;
    }
    const appliquer = e.target.closest("[data-ab-sp-appliquer]");
    if (appliquer && abSp.donnees) {
      // L'UTILISATEUR A DÉCIDÉ : c'est ici, et nulle part ailleurs, qu'une
      // proposition du serveur devient une exclusion.
      const doublon = abSp.donnees.doublons.find(
        (d) => `${d.genre}:${d.prevu.id}` === appliquer.dataset.abSpAppliquer
      );
      if (doublon) {
        const fusion = [...new Set([...abSp.operations, ...doublon.a_exclure])];
        abSpChanger({ operations: fusion });
      }
      return;
    }
    const ecarter = e.target.closest("[data-ab-sp-ecarter]");
    if (ecarter) {
      abSpChanger({ ignores: abSpBasculer(abSp.ignores, ecarter.dataset.abSpEcarter, true) });
    }
  });

  // Le graphe est mesuré à sa largeur : on le redessine quand la fenêtre change.
  let minuterie = null;
  window.addEventListener("resize", () => {
    clearTimeout(minuterie);
    minuterie = setTimeout(() => {
      if (abSp.donnees && document.getElementById("ab-sp-graphe")?.clientWidth) {
        abLineChart(document.getElementById("ab-sp-graphe"), abSp.donnees, abSp.donnees.monnaie_id);
      }
    }, 150);
  });
})();
