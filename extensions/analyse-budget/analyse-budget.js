/* ---------- Extension « Budget » ----------
 *
 * UNE PAGE, ET TOUT CE QUI SE DÉCIDE À L'AVANCE. Le budget du mois, sa
 * répartition par catégorie, puis trois lectures de ce que la période a
 * réellement fait : ce qu'on a mis de côté, ce qu'on veut garder disponible,
 * ce qu'on n'avait pas vu venir.
 *
 * POURQUOI LES DEUX PREMIÈRES ONT DÉMÉNAGÉ. Le budget du mois se saisissait SUR
 * le camembert du dashboard, et les budgets par catégorie ligne par ligne dans
 * le formulaire de la page Catégories. Trois grandeurs qui se répondent (cf.
 * crud.incoherences_budgets), réglées à trois endroits dont aucun ne s'appelait
 * « budget ». Et pour deux d'entre elles, au milieu d'écrans qui servent à
 * CONSTATER : un champ à remplir posé entre deux graphes fait tache, on vient y
 * lire ce qui s'est passé, pas y décider ce qui devrait.
 *
 * ELLES NE SONT DONC PLUS ATTEIGNABLES SANS L'EXTENSION, et c'est voulu : la
 * vue « budget » du camembert non plus (cf. index.html, `data-extension` sur son
 * bouton). Ce qui reste dans le noyau, c'est le SCHÉMA — les tables
 * `budget_total_mensuel`, `categorie_budget_mensuel` et la colonne
 * `objectif_pourcentage` — et les routes qui les servent : éteindre l'extension
 * ne perd rien, elle rend seulement les chiffres inaccessibles, comme « Prêts »
 * le fait de ses deux types d'opération.
 *
 * CHARGÉ PAR frontend/extensions.js, après injection de page.html : le script
 * s'exécute en portée GLOBALE et a donc accès à tout ce qu'app.js expose
 * (apiFetch, formatMontant, showMessage, state, t…).
 *
 * TOUT EST PRÉFIXÉ `ab` / `AB_` : les scripts d'extension partagent une seule
 * portée, dans l'ordre alphabétique des dossiers, et un nom nu se ferait écraser
 * par celui d'une autre extension (cf. extensions/README.md). « analyse-budget »
 * se charge EN PREMIER — c'est le premier dossier par ordre alphabétique — donc
 * c'est elle qui se ferait écraser, silencieusement. L'IDENTIFIANT DU DOSSIER
 * N'A PAS CHANGÉ avec le nom affiché : c'est lui que porte l'état d'activation
 * déjà enregistré chez l'utilisateur, et le renommer aurait éteint l'extension
 * chez tous ceux qui l'avaient allumée.
 */

/* CE QUI APPARTIENT À L'EXTENSION DANS UN ÉCRAN DU NOYAU : la case « Dépense
 * imprévue » du formulaire d'opération et le bouton de la vue « budget » du
 * camembert, tous deux écrits dans index.html avec `display:none` et un attribut
 * `data-extension…`.
 *
 * C'EST L'EXTENSION QUI LES ALLUME, et ce fichier n'est chargé QUE si elle est
 * active (cf. extensions.js) : sa seule exécution vaut donc « allume-les ».
 * Même patron que « Prêts », qui n'est rien d'autre que cet appel. Compter sur
 * le noyau pour le faire ne marche qu'au moment où l'on BASCULE l'interrupteur
 * dans les Paramètres — au chargement d'une application déjà allumée, personne
 * n'appelle, et la case restait invisible jusqu'au prochain aller-retour par
 * les Paramètres. */
BudgetApp.extensions.majVisibilite("analyse-budget", true);

let abMonnaieId = null;
// LA MÊME PÉRIODE POUR TOUTE LA PAGE : le budget du mois et les enveloppes de
// catégorie sont propres à un MOIS, les trois lectures du bas portent sur son
// ANNÉE. Un second sélecteur pour ces dernières aurait laissé exister un état
// où le haut de la page parle de mars et le bas de l'année dernière.
const abPeriode = { annee: null, mois: null };
// Les périodes qui portent des opérations (`/meta/periodes`), lues une fois.
// Elles ne servent qu'à PROPOSER des années : celles qu'on peut budgéter
// débordent largement — on pose un budget sur un mois où l'on n'a rien dépensé.
let abPeriodesConnues = null;

// Ce que la dernière lecture a rapporté, gardé pour que les rendus ne
// redemandent rien : les catégories du noyau, leur budget du mois, le budget
// total, et les désaccords que le serveur signale entre les trois.
let abCategories = [];
let abBudgets = {};
let abBudgetTotal = 0;
let abBudgetTotalExplicite = true;

/* ---------- Un petit histogramme à douze barres ----------
 *
 * ÉCRIT ICI plutôt que repris de `renderHistogrammeDepenses` : celui du noyau
 * dessine des CATÉGORIES (une barre par catégorie, un budget, une part
 * prévisionnelle) et n'a pas de place pour une valeur NÉGATIVE — or un mois où
 * l'on a repris plus qu'on n'a versé en est une, et c'est précisément le mois
 * qu'on cherche du regard. Le tordre pour ça l'aurait compliqué pour son usage
 * principal.
 *
 * UNE LIGNE DE ZÉRO VISIBLE, et l'échelle prise sur la plus grande valeur
 * ABSOLUE : sans elle, un mois négatif se lirait comme une barre courte vers le
 * haut.
 */
function abHistogramme(conteneur, valeurs, monnaieId, { libelle }) {
  if (!conteneur) return;
  conteneur.innerHTML = "";
  const max = Math.max(1, ...valeurs.map((v) => Math.abs(v.valeur)));
  const largeur = Math.max(conteneur.clientWidth || 0, 600);
  const hauteur = 220;
  const margeBas = 34;
  const margeHaut = 16;
  const zone = hauteur - margeBas - margeHaut;
  // Le zéro au milieu quand il y a du négatif, tout en bas sinon : réserver la
  // moitié du cadre à une moitié toujours vide gâcherait la lisibilité du cas
  // ordinaire, où tout est positif.
  const duNegatif = valeurs.some((v) => v.valeur < 0);
  const yZero = margeHaut + (duNegatif ? zone / 2 : zone);
  const echelle = (duNegatif ? zone / 2 : zone) / (max * 1.15);
  const pas = largeur / valeurs.length;
  const largeurBarre = Math.min(44, pas * 0.55);

  const barres = valeurs
    .map((v, i) => {
      const centre = pas * i + pas / 2;
      const h = Math.abs(v.valeur) * echelle;
      const y = v.valeur >= 0 ? yZero - h : yZero;
      // La barre pousse depuis la ligne de ZÉRO, donc vers le haut quand la
      // valeur est positive et vers le bas sinon : c'est la classe qui porte le
      // point d'ancrage, le CSS ne peut pas le deviner (cf. analyse-budget.css).
      const classe = v.valeur >= 0 ? "ab-barre-positive" : "ab-barre-negative";
      const titre = `${v.libelle} — ${formatMontant(v.valeur, monnaieId)}`;
      return `
        <g class="ab-barre" style="--retard:${i * 26}ms">
          <title>${escapeHtml(titre)}</title>
          <rect class="${classe}" x="${centre - largeurBarre / 2}" y="${y}"
                width="${largeurBarre}" height="${Math.max(h, 0.5)}" rx="2" />
          <text class="ab-barre-libelle" x="${centre}" y="${hauteur - 16}"
                text-anchor="middle" font-size="10">${escapeHtml(v.libelle)}</text>
        </g>`;
    })
    .join("");

  conteneur.innerHTML = `
    ${libelle ? `<div class="ab-histo-titre">${escapeHtml(libelle)}</div>` : ""}
    <svg viewBox="0 0 ${largeur} ${hauteur}" width="100%" height="${hauteur}"
         xmlns="http://www.w3.org/2000/svg" class="ab-histo">
      <line class="ab-axe-zero" x1="0" y1="${yZero}" x2="${largeur}" y2="${yZero}" />
      ${barres}
    </svg>`;
}

/* ---------- Ce qu'on a mis de côté ---------- */

/**
 * LE NET EN GRAND, LE DÉTAIL AU SURVOL — c'est ce qui a été choisi, et voici
 * pourquoi les deux sont là. Le net EST la réponse : « j'ai mis 2 300 € de côté
 * cette année ». Mais un net à zéro peut aussi bien vouloir dire « je n'ai rien
 * bougé » que « j'ai versé 2 000 € et j'en ai repris 2 000 » — deux années très
 * différentes, dont la seconde mérite au moins d'être remarquée. Les deux
 * composantes sont donc nécessaires pour ne pas se tromper sur le net, sans
 * mériter la même place que lui.
 */
function abRenderEpargne(donnees) {
  const carte = document.getElementById("ab-epargne-total");
  const net = donnees.total.net;
  const classe = net > 0 ? "positif" : net < 0 ? "negatif" : "";
  carte.innerHTML = `
    <div class="ab-net-valeur ${classe}">${net > 0 ? "+" : ""}${formatMontant(
      net,
      donnees.monnaie_id
    )}</div>
    <div class="ab-net-libelle">${t("mis de côté en {annee}", { annee: donnees.annee })}</div>`;
  carte.title = t("Versé {verse} · Repris {retire}", {
    verse: formatMontant(donnees.total.verse, donnees.monnaie_id),
    retire: formatMontant(donnees.total.retire, donnees.monnaie_id),
  });

  abHistogrammeDansCarte(
    "ab-epargne-mois",
    donnees.mois.map((m) => ({ libelle: MOIS_COURTS_FR[m.mois - 1], valeur: m.net })),
    donnees.monnaie_id
  );
}

/* ---------- LES DOUZE MOIS, REPLIÉS DANS LEUR CARTE ----------
 *
 * « Ce que tu as mis de côté » et « Dépenses imprévues » restent des chiffres
 * de PÉRIODE, en grand ; leur histogramme mois par mois se déplie depuis la
 * carte (bouton « Mois par mois »). Dépliés d'office, les deux graphes
 * repoussaient le matelas et la liste des imprévues sous l'écran, pour une
 * question — « est-ce que je tiens un rythme ? » — qu'on ne pose pas à chaque
 * passage.
 *
 * LE DESSIN ATTEND D'ÊTRE VU : un histogramme calculé dans un bloc replié n'a
 * pas de largeur, et son SVG se serait étiré de travers une fois déplié. On
 * garde donc ses données, et on dessine à l'ouverture. L'état déplié survit
 * aux rechargements de la page (changement de mois, de monnaie) : le refermer
 * à chaque fois obligerait à le rouvrir après chaque geste.
 */
const abHistosCartes = {};
const abCartesDepliees = new Set();

function abHistogrammeDansCarte(id, valeurs, monnaieId) {
  abHistosCartes[id] = { valeurs, monnaieId };
  if (abCartesDepliees.has(id)) abDessinerHistoCarte(id);
}

function abDessinerHistoCarte(id) {
  const donnees = abHistosCartes[id];
  if (!donnees) return;
  // Sans titre : le bouton qui l'a déplié le porte déjà.
  abHistogramme(document.getElementById(id), donnees.valeurs, donnees.monnaieId, {
    libelle: "",
  });

}

function abBasculerCarte(bouton) {
  const id = bouton.dataset.deplier;
  const detail = document.getElementById(id);
  if (!detail) return;
  const ouvrir = detail.hidden;
  detail.hidden = !ouvrir;
  bouton.setAttribute("aria-expanded", String(ouvrir));
  bouton.closest(".ab-carte-net")?.classList.toggle("ab-carte-depliee", ouvrir);
  if (ouvrir) {
    abCartesDepliees.add(id);
    abDessinerHistoCarte(id);
  } else {
    abCartesDepliees.delete(id);
  }
}

document.getElementById("section-budget")?.addEventListener("click", (e) => {
  const bouton = e.target.closest("button.ab-deplier");
  if (bouton) abBasculerCarte(bouton);
});

/* ---------- Le matelas de sécurité ---------- */

/**
 * CONSTATER, JAMAIS REFUSER. Passer sous son matelas n'empêche rien : aucun
 * virement n'est bloqué, aucune saisie n'est refusée. Une garde qui interdirait
 * de descendre sous son propre seuil se ferait contourner au premier besoin
 * réel — et aurait appris à ne plus être lue.
 *
 * L'ÉCART PLUTÔT QUE LES DEUX MONTANTS : « il manque 340 € » se comprend d'un
 * coup d'œil, « 2 660 sur 3 000 » demande une soustraction. Les deux montants
 * restent écrits en dessous, en petit, pour qui veut vérifier.
 *
 * RIEN NE S'AFFICHE SANS MATELAS POSÉ (0 = aucun) : annoncer un seuil toujours
 * tenu apprend à ne plus regarder l'endroit où il s'affiche.
 */
function abRenderMatelas(etat) {
  const champ = document.getElementById("ab-matelas-montant");
  if (document.activeElement !== champ) {
    champ.value = etat.matelas > 0 ? etat.matelas.toFixed(2) : "";
  }
  const symbole = symboleMonnaie(etat.monnaie_id);
  champ.placeholder = symbole ? `0,00 ${symbole}` : "0,00";

  const bloc = document.getElementById("ab-matelas-etat");
  if (!etat.matelas) {
    bloc.innerHTML = `<p class="hint">${t(
      "Aucun matelas posé pour cette monnaie."
    )}</p>`;
    return;
  }

  const lignes = etat.comptes
    .map(
      (c) =>
        `<li><span>${escapeHtml(c.nom)}</span><span class="montant neutre">${formatMontant(
          c.solde,
          etat.monnaie_id
        )}</span></li>`
    )
    .join("");
  const manque = Math.abs(etat.ecart);
  bloc.innerHTML = `
    <div class="ab-matelas-carte ${etat.sous_le_seuil ? "ab-matelas-alerte" : "ab-matelas-ok"}">
      <div class="ab-matelas-verdict">${
        etat.sous_le_seuil
          ? t("Il manque {montant}", { montant: formatMontant(manque, etat.monnaie_id) })
          : t("Marge de {montant}", { montant: formatMontant(manque, etat.monnaie_id) })
      }</div>
      <div class="hint">${t("{dispo} disponible sur {seuil} voulus", {
        dispo: formatMontant(etat.disponible, etat.monnaie_id),
        seuil: formatMontant(etat.matelas, etat.monnaie_id),
      })}</div>
      <ul class="ab-matelas-comptes">${lignes}</ul>
    </div>`;
}

async function abEnregistrerMatelas() {
  const brut = document.getElementById("ab-matelas-montant").value.trim();
  const montant = brut === "" ? 0 : Number(brut.replace(",", "."));
  if (!Number.isFinite(montant) || montant < 0) {
    showMessage(t("Montant invalide."), "error");
    return;
  }
  try {
    const etat = await apiFetch(`/analyse-budget/matelas?monnaie_id=${abMonnaieId}`, {
      method: "PUT",
      body: JSON.stringify({ montant }),
    });
    showMessage(t("Matelas enregistré."), "success");
    abRenderMatelas(etat);
    // La vue globale d'à côté porte le même avertissement : la laisser sur
    // l'ancien seuil donnerait deux écrans en désaccord dans la même page.
    if (typeof abMajAvertissementEpargne === "function") abMajAvertissementEpargne();
  } catch (err) {
    showMessage(err.message, "error");
  }
}

/* ---------- Ce qui n'était pas prévisible ---------- */

function abRenderImprevues(donnees) {
  const carte = document.getElementById("ab-imprevues-total");
  carte.innerHTML = `
    <div class="ab-net-valeur">${formatMontant(donnees.total.imprevu, donnees.monnaie_id)}</div>
    <div class="ab-net-libelle">${t("d'imprévu en {annee}", { annee: donnees.annee })}</div>`;
  // LA PART EST CE QUI REND LE MONTANT LISIBLE : « 1 200 € d'imprévu » ne dit
  // rien tant qu'on ne sait pas si l'année a coûté 5 000 ou 50 000 €.
  carte.title = t("{part} de {total} dépensés", {
    part: formatPourcentage(donnees.total.part),
    total: formatMontant(donnees.total.total, donnees.monnaie_id),
  });

  abHistogrammeDansCarte(
    "ab-imprevues-mois",
    donnees.mois.map((m) => ({ libelle: MOIS_COURTS_FR[m.mois - 1], valeur: m.imprevu })),
    donnees.monnaie_id
  );

  const corps = document.getElementById("ab-imprevues-lignes");
  corps.innerHTML = "";
  if (!donnees.lignes.length) {
    corps.innerHTML = `<tr><td colspan="4" class="hint">${t(
      "Aucune dépense marquée imprévue cette année."
    )}</td></tr>`;
    return;
  }
  donnees.lignes.forEach((ligne) => {
    const tr = document.createElement("tr");
    tr.innerHTML = `
      <td>${formatDate(ligne.date)}</td>
      <td>${escapeHtml(ligne.nature || "")}</td>
      <td>${ligne.categorie ? escapeHtml(ligne.categorie) : `<span class="hint">—</span>`}</td>
      <td class="montant neutre">${formatMontant(ligne.montant, donnees.monnaie_id)}</td>`;
    corps.appendChild(tr);
  });
}


/* ---------- LES DEUX GRAPHES DU DASHBOARD, FACE AU BUDGET ----------
 *
 * L'histogramme et le camembert du dashboard, rendus par les MÊMES fonctions du
 * noyau (`renderHistogrammeDepenses`, `renderPieChartDepenses`,
 * `renderLegendeCategories`) — mais seulement ce qui parle de budget : les
 * traits rouges des enveloppes sur les barres, et le camembert en vue
 * « Budget ». La vue « État actuel » reste au dashboard.
 *
 * TROIS GRANULARITÉS : le mois (celui de la barre du haut), son année, ou une
 * de ses semaines — les mêmes que sait découper le serveur (`/dashboard`,
 * `/dashboard?vue=annee`, `/dashboard/semaines`).
 *
 * UNE COMPARAISON FACULTATIVE, avec une période de la MÊME granularité : deux
 * mois, deux années, deux semaines. La seconde est dessinée PAR-DESSUS,
 * hachurée et grisée (cf. app.js, « LA PÉRIODE COMPARÉE »). Par défaut, la
 * période précédente — c'est la comparaison qu'on fait neuf fois sur dix.
 */
const abGraphes = {
  vue: "mois",
  semaine: null,
  comparer: false,
  cmp: { annee: null, mois: null, semaine: null },
};
// Les semaines d'un mois, par « monnaie-année-mois » : la liste des semaines
// d'un mois sert à la fois aux menus et aux barres, et ne change pas tant
// qu'on ne recharge pas la page.
let abSemainesCache = {};

async function abSemainesDe(annee, mois) {
  const cle = `${abMonnaieId}-${annee}-${mois}`;
  if (!abSemainesCache[cle]) {
    abSemainesCache[cle] = apiFetch(
      `/dashboard/semaines?monnaie_id=${abMonnaieId}&annee=${annee}&mois=${mois}`
    );
  }
  return abSemainesCache[cle];
}

function abLibelleSemaine(semaine) {
  return `${semaine.jour_debut} → ${semaine.jour_fin}`;
}

function abLibellePeriode(p, semaine = null) {
  if (p.vue === "annee") return String(p.annee);
  const mois = `${MOIS_COURTS_FR[p.mois - 1]} ${p.annee}`;
  if (p.vue === "semaine" && semaine) return `${mois}, ${abLibelleSemaine(semaine)}`;
  return mois;
}

/** {depenses, budgetTotal, libelle} d'une période, dans la monnaie de la page. */
async function abDepensesDe(p) {
  if (p.vue === "semaine") {
    const donnees = await abSemainesDe(p.annee, p.mois);
    const semaines = donnees.semaines || [];
    // `semaine` null = la dernière du mois (défaut de « la semaine d'avant »
    // quand on est en première semaine).
    const semaine =
      semaines.find((s) => s.numero === p.semaine) || semaines[semaines.length - 1] || null;
    return {
      depenses: semaine ? semaine.depenses : [],
      budgetTotal: semaine ? semaine.budget_total || 0 : 0,
      libelle: abLibellePeriode(p, semaine),
    };
  }
  const url =
    p.vue === "annee"
      ? `/dashboard?annee=${p.annee}&vue=annee`
      : `/dashboard?annee=${p.annee}&mois=${p.mois}`;
  const data = await apiFetch(url);
  const kpis = (data.kpis || []).find((k) => k.monnaie_id === abMonnaieId);
  return {
    depenses: kpis ? kpis.depenses_par_categorie || [] : [],
    budgetTotal: kpis ? kpis.budget_total || 0 : 0,
    libelle: abLibellePeriode(p),
  };
}

/** La période principale : celle de la barre du haut, à la granularité choisie. */
function abPeriodeGraphes() {
  return {
    vue: abGraphes.vue,
    annee: abPeriode.annee,
    mois: abPeriode.mois,
    semaine: abGraphes.semaine,
  };
}

/* LA PÉRIODE PRÉCÉDENTE, défaut de la comparaison. */
function abComparaisonParDefaut() {
  const p = abPeriodeGraphes();
  if (p.vue === "annee") return { annee: p.annee - 1, mois: p.mois, semaine: null };
  const precedent = p.mois === 1 ? { annee: p.annee - 1, mois: 12 } : { annee: p.annee, mois: p.mois - 1 };
  if (p.vue === "semaine" && p.semaine > 1) {
    return { annee: p.annee, mois: p.mois, semaine: p.semaine - 1 };
  }
  // En semaine 1, la précédente est la DERNIÈRE du mois d'avant (null, cf.
  // abDepensesDe).
  return { ...precedent, semaine: null };
}

function abAfficher(id, visible) {
  const el = document.getElementById(id);
  if (el) el.style.display = visible ? "" : "none";
}

async function abRemplirControlesGraphes() {
  const vue = abGraphes.vue;
  document.getElementById("ab-graphes-vue").value = vue;
  document.getElementById("ab-comparer").checked = abGraphes.comparer;

  // La semaine principale : celles du mois de la barre du haut.
  abAfficher("ab-graphes-semaine-bloc", vue === "semaine");
  if (vue === "semaine") {
    const semaines = (await abSemainesDe(abPeriode.annee, abPeriode.mois)).semaines || [];
    if (!semaines.some((s) => s.numero === abGraphes.semaine)) {
      // Par défaut la semaine d'aujourd'hui quand on regarde le mois en cours,
      // la première sinon.
      const aujourdhui = new Date();
      const courante =
        aujourdhui.getFullYear() === abPeriode.annee && aujourdhui.getMonth() + 1 === abPeriode.mois
          ? semaines.find((s) => s.jour_debut <= aujourdhui.getDate() && aujourdhui.getDate() <= s.jour_fin)
          : null;
      abGraphes.semaine = (courante || semaines[0] || {}).numero ?? null;
    }
    fillSelect(
      document.getElementById("ab-graphes-semaine"),
      semaines.map((s) => ({ value: s.numero, label: abLibelleSemaine(s) }))
    );
    document.getElementById("ab-graphes-semaine").value = String(abGraphes.semaine);
  }

  // LE DÉFAUT DE LA COMPARAISON SE CALCULE ICI, une fois la semaine principale
  // connue : « la semaine d'avant » n'a pas de sens avant.
  if (abGraphes.comparer && abGraphes.cmp.annee == null) abGraphes.cmp = abComparaisonParDefaut();
  // La période comparée : ses listes n'existent que si l'on compare.
  const cmp = abGraphes.cmp;
  abAfficher("ab-cmp-annee-bloc", abGraphes.comparer);
  abAfficher("ab-cmp-mois-bloc", abGraphes.comparer && vue !== "annee");
  abAfficher("ab-cmp-semaine-bloc", abGraphes.comparer && vue === "semaine");
  if (!abGraphes.comparer) return;
  fillSelect(
    document.getElementById("ab-cmp-annee"),
    abAnneesProposees().map((a) => ({ value: a, label: String(a) }))
  );
  document.getElementById("ab-cmp-annee").value = String(cmp.annee);
  fillSelect(
    document.getElementById("ab-cmp-mois"),
    MOIS_COURTS_FR.map((nom, index) => ({ value: index + 1, label: nom }))
  );
  document.getElementById("ab-cmp-mois").value = String(cmp.mois);
  if (vue === "semaine") {
    const semaines = (await abSemainesDe(cmp.annee, cmp.mois)).semaines || [];
    if (!semaines.some((s) => s.numero === cmp.semaine)) {
      cmp.semaine = (semaines[semaines.length - 1] || {}).numero ?? null;
    }
    fillSelect(
      document.getElementById("ab-cmp-semaine"),
      semaines.map((s) => ({ value: s.numero, label: abLibelleSemaine(s) }))
    );
    document.getElementById("ab-cmp-semaine").value = String(cmp.semaine);
  }
}

async function abRenderGraphes() {
  const histo = document.getElementById("ab-histogramme");
  if (!histo || abMonnaieId == null) return;
  try {
    await abRemplirControlesGraphes();
    const principale = await abDepensesDe(abPeriodeGraphes());
    const comparee = abGraphes.comparer
      ? await abDepensesDe({ vue: abGraphes.vue, ...abGraphes.cmp })
      : null;

    // TOUTES LES CATÉGORIES : il n'y a pas de filtre sur cette page, et une
    // catégorie écartée ici n'aurait aucun moyen de revenir.
    const partsDe = (d) =>
      partsCategoriesDashboard(d.depenses, new Set(d.depenses.map((x) => x.categorie)), {
        vue: VUE_PIE_BUDGET,
        budgetTotal: d.budgetTotal,
      });
    const parts = partsDe(principale);
    const partsCompare = comparee ? partsDe(comparee) : null;

    renderHistogrammeDepenses(parts.retenues, abMonnaieId, histo, {
      comparaison: comparee ? comparee.depenses : null,
      libelleCompare: comparee ? comparee.libelle : null,
    });
    renderPieChartDepenses(principale.depenses, abMonnaieId, document.getElementById("ab-camembert"), parts, {
      comparaison: partsCompare,
      libelleCompare: comparee ? comparee.libelle : null,
    });
    renderLegendeCategories(abMonnaieId, parts, document.getElementById("ab-legende"));
    cablerSurbrillanceCategories();

    // CE QUI EST PLEIN, CE QUI EST HACHURÉ — et, sans budget posé, pourquoi
    // l'anneau est plein : le camembert retombe alors sur le total dépensé.
    const legende = [];
    legende.push(
      comparee
        ? t("Plein : {courante} · Hachuré : {comparee}", {
            courante: principale.libelle,
            comparee: comparee.libelle,
          })
        : principale.libelle
    );
    if (!(principale.budgetTotal > 0)) {
      legende.push(t("Aucun budget posé sur cette période : le camembert rapporte chaque catégorie au total dépensé."));
    }
    document.getElementById("ab-graphes-legende").textContent = legende.join(" — ");
  } catch (err) {
    showMessage(err.message, "error");
  }
}

document.getElementById("ab-graphes-vue")?.addEventListener("change", (e) => {
  abGraphes.vue = e.target.value;
  // Changer de granularité change la question : la comparaison repart de la
  // période précédente, dans la nouvelle unité.
  abGraphes.cmp = { annee: null, mois: null, semaine: null };
  abRenderGraphes();
});
document.getElementById("ab-graphes-semaine")?.addEventListener("change", (e) => {
  abGraphes.semaine = Number(e.target.value);
  abRenderGraphes();
});
document.getElementById("ab-comparer")?.addEventListener("change", (e) => {
  abGraphes.comparer = e.target.checked;
  abRenderGraphes();
});
document.getElementById("ab-cmp-annee")?.addEventListener("change", (e) => {
  abGraphes.cmp.annee = Number(e.target.value);
  abRenderGraphes();
});
document.getElementById("ab-cmp-mois")?.addEventListener("change", (e) => {
  abGraphes.cmp.mois = Number(e.target.value);
  abRenderGraphes();
});
document.getElementById("ab-cmp-semaine")?.addEventListener("change", (e) => {
  abGraphes.cmp.semaine = Number(e.target.value);
  abRenderGraphes();
});

/* ---------- Le budget du mois ---------- */

/**
 * Remplit le champ du budget total avec ce que le serveur vient de rendre.
 *
 * PAS PENDANT QU'ON ÉCRIT DEDANS : la page se recharge après chaque écriture
 * d'une catégorie, et réécrire le champ sous les doigts effacerait la saisie
 * en cours.
 */
function abRenderBudgetTotal() {
  const champ = document.getElementById("ab-budget-total");
  if (!champ) return;
  if (document.activeElement !== champ) {
    champ.value = abBudgetTotal > 0 ? abBudgetTotal.toFixed(2) : "";
  }
  const symbole = symboleMonnaie(abMonnaieId);
  champ.placeholder = symbole ? `0,00 ${symbole}` : "0,00";
  // « HÉRITÉ » : le champ montre un montant que personne n'a écrit sur ce
  // mois-ci. Le dire est indispensable depuis que l'héritage remonte aussi le
  // temps (cf. crud._budget_herite) — un mois antérieur à toute saisie affiche
  // désormais un nombre, et sans cette mention il passerait pour un oubli.
  const mention = document.getElementById("ab-budget-total-herite");
  if (mention) mention.hidden = abBudgetTotal <= 0 || abBudgetTotalExplicite;
}

/**
 * Les parts de toutes les catégories, recalculées depuis leurs enveloppes.
 *
 * POURQUOI ÇA EXISTE. Le budget du mois est le DÉNOMINATEUR des parts : le
 * bouger rend périmée la part de chaque catégorie, d'un coup, sans que
 * personne n'ait touché à une seule ligne. Tant que les deux grandeurs étaient
 * indépendantes, il fallait bien demander laquelle on voulait vraiment changer
 * (c'était la fenêtre d'accord). Elles ne le sont plus : l'enveloppe est ce
 * qu'on manipule, la part est ce qu'on en lit — alors on garde les enveloppes
 * et on réécrit les parts. Il n'y a rien à arbitrer.
 *
 * UNE ÉCRITURE PAR CATÉGORIE, et il n'y a pas moyen de faire autrement : la
 * part est une colonne de `categorie`, posée une ligne à la fois. C'est un
 * geste manuel et rare, pas une boucle de rendu.
 *
 * ON S'ARRÊTE AU PREMIER REFUS, en le disant. Il n'en existe qu'un : la somme
 * des parts dépasserait 100 %, c'est-à-dire que les enveloppes dépassent
 * désormais le budget qu'on vient de poser. Le serveur nomme le plafond
 * utilisable ; continuer aurait empilé le même message autant de fois qu'il
 * reste de catégories.
 */
async function abResynchroniserParts() {
  if (!(abBudgetTotal > 0)) return;
  for (const categorie of abCategories) {
    const montant = (abBudgets[categorie.id] || {}).montant || 0;
    const part = abPourcentageDuMontant(montant);
    // Inutile de réécrire ce qui n'a pas bougé : la tolérance du serveur est
    // d'un millième, la même sert de seuil ici.
    if (Math.abs((categorie.objectif_pourcentage || 0) - part) < 1e-3) continue;
    try {
      await abEcrireObjectifCategorie(categorie.id, part);
    } catch (err) {
      showMessage(traduireMessageServeur(err.message), "error");
      return;
    }
  }
}

/**
 * Écrit le budget du mois affiché, puis remet les parts d'accord avec lui.
 *
 * PLUS DE FENÊTRE D'ACCORD DEPUIS CETTE PAGE. Elle demandait laquelle des trois
 * grandeurs on voulait vraiment changer — une vraie question tant que
 * l'enveloppe et la part étaient indépendantes. Elles sont maintenant deux
 * lectures du même nombre (cf. le bloc « UN SEUL CURSEUR, DEUX CASES ») : la
 * seule réponse possible est « garde mes enveloppes, recalcule les parts », et
 * poser une question dont on connaît la réponse fait cliquer sans lire.
 */
async function abEnregistrerBudgetTotal() {
  const { annee, mois } = abPeriode;
  if (!mois || !abMonnaieId) return;
  const brut = document.getElementById("ab-budget-total").value.trim();
  const montant = brut === "" ? 0 : Number(brut.replace(",", "."));
  if (!Number.isFinite(montant) || montant < 0) {
    showMessage(t("Montant invalide."), "error");
    return;
  }
  try {
    await apiFetch(
      `/dashboard/budget-total?monnaie_id=${abMonnaieId}&annee=${annee}&mois=${mois}`,
      { method: "PUT", body: JSON.stringify({ montant }) }
    );
  } catch (err) {
    showMessage(err.message, "error");
    return;
  }
  showMessage(t("Budget du mois enregistré."), "success");
  // RELU AVANT DE RECALCULER : `abResynchroniserParts` divise par
  // `abBudgetTotal`, qui vaut encore l'ancien total tant qu'on n'a pas relu.
  await abCharger();
  await abResynchroniserParts();
  await abCharger();
}

/* ---------- Les budgets par catégorie ----------
 *
 * UN SEUL CURSEUR, DEUX CASES — ET LES DEUX CASES SONT LE MÊME NOMBRE.
 *
 * CE QU'IL Y AVAIT AVANT, ET POURQUOI ÇA NE TENAIT PAS. Chaque ligne portait
 * DEUX curseurs : l'enveloppe en valeur et l'objectif en pourcentage, présentés
 * comme deux grandeurs indépendantes. Elles ne le sont pas : dès qu'un budget
 * du mois est posé, l'une VAUT l'autre (enveloppe = total × part). Deux
 * curseurs pour une seule décision, ça veut dire deux gestes à accorder à la
 * main, un signalement de désaccord sous la ligne quand on n'en bouge qu'un, et
 * un écran qui demande d'arbitrer entre deux écritures de la même chose.
 *
 * DÉSORMAIS : le curseur RÉPARTIT, et les deux cases de droite MONTRENT la même
 * valeur dans les deux unités — des euros, et la part du budget du mois. Bouger
 * le curseur les met à jour toutes les deux. Écrire dans l'une recalcule
 * l'autre et replace le curseur. Il n'y a plus de désaccord possible entre
 * elles, donc plus rien à signaler : c'est une valeur, lue de deux façons.
 *
 * RIEN NE S'ÉCRIT AVANT QU'ON AIT FINI. Glisser ne fait que bouger les nombres ;
 * c'est le RELÂCHEMENT du curseur, la sortie d'une case (clic ailleurs) ou
 * Ctrl+Entrée qui enregistrent. Une requête par pixel parcouru écrirait des
 * dizaines de valeurs dont aucune n'est celle qu'on voulait.
 *
 * LE SERVEUR TRANCHE, TOUJOURS, et c'est lui qui porte la seule limite qui
 * reste : la somme des parts ne peut pas dépasser 100 % (cf.
 * crud.erreur_objectif_pourcentage). Comme la part se déduit maintenant du
 * montant, cela revient à dire que la somme des enveloppes ne peut pas dépasser
 * le budget du mois — et son refus est affiché tel quel, avec le plafond
 * utilisable qu'il nomme.
 *
 * SANS BUDGET DU MOIS, LA CASE DES POURCENTAGES N'A PAS DE DÉNOMINATEUR : elle
 * est éteinte et vide, et seule l'enveloppe s'écrit. Un « 0 % » affiché aurait
 * été un chiffre faux plutôt qu'une absence.
 */

// La butée du curseur des montants. Elle ne peut pas être le budget total seul :
// sans budget total posé, il n'y en aurait aucune, et une enveloppe déjà plus
// grande que le total ne pourrait plus être relue sans être rabotée. On prend
// donc le plus grand des deux, avec de la marge — un curseur dont la butée est
// exactement la valeur courante ne peut plus monter.
function abButeeMontant() {
  const montants = abCategories.map((c) => (abBudgets[c.id] || {}).montant || 0);
  const plancher = Math.max(abBudgetTotal, 0, ...montants);
  if (plancher <= 0) return 1000;
  return Math.ceil((plancher * 1.25) / 100) * 100;
}

/* ---------- LA PART EXACTE, ET CE QUE L'ÉCRAN EN MONTRE ----------
 *
 * L'OBJECTIF D'UNE CATÉGORIE EST UNE FRACTION : son enveloppe divisée par le
 * budget du mois. Écrite à la décimale, cette fraction ment — et elle ment
 * ASSEZ pour être refusée. Sept catégories à 100 € d'un budget de 700 € valent
 * chacune 14,285714… % ; arrondies à 14,3 %, elles totalisent 100,1 %, et le
 * serveur refuse la septième (cf. crud.erreur_objectif_pourcentage) pour une
 * répartition qui tombe pourtant juste, au centime près. L'utilisateur voyait
 * alors un montant parfaitement légitime rejeté sans rien pouvoir y faire :
 * aucune des sept valeurs n'était fausse, c'est leur écriture qui l'était.
 *
 * D'OÙ LA SÉPARATION : la BASE garde la fraction telle quelle, l'ÉCRAN en
 * montre un arrondi. Le serveur tolère déjà un millième sur la somme, ce qui
 * absorbe l'arithmétique des flottants sans absorber une vraie erreur.
 *
 * UNE DÉCIMALE À L'ÉCRAN, comme partout ailleurs (cf. formatPourcentage) : le
 * champ de saisie, le curseur et le pied de tableau lisent tous celle-ci. */
const AB_DECIMALES_POURCENTAGE = 10;

function abPourcentageAffiche(pourcentage) {
  return Math.round((pourcentage || 0) * AB_DECIMALES_POURCENTAGE) / AB_DECIMALES_POURCENTAGE;
}

// Un pas qui donne au curseur une course utilisable : au centime, il faudrait
// des milliers de crans pour traverser un budget de 3 000 €, et la valeur exacte
// se pose de toute façon dans le champ nombre d'à côté.
function abPasMontant(butee) {
  if (butee > 20000) return 100;
  if (butee > 5000) return 25;
  if (butee > 1000) return 10;
  return 5;
}

/** La part du budget du mois que représente une enveloppe, ou null quand
 *  aucun budget n'est posé — il n'y a alors pas de dénominateur, et zéro serait
 *  un chiffre faux plutôt qu'une absence. */
function abPourcentageDuMontant(montant) {
  if (!(abBudgetTotal > 0)) return null;
  return ((montant || 0) / abBudgetTotal) * 100;
}

/** L'enveloppe que vaut une part du budget du mois, au CENTIME : l'argent n'a
 *  pas de troisième décimale, une enveloppe de 333,333333 € ne veut rien dire. */
function abMontantDuPourcentage(pourcentage) {
  if (!(abBudgetTotal > 0)) return 0;
  return Math.round(abBudgetTotal * ((pourcentage || 0) / 100) * 100) / 100;
}

function abRenderBudgetsCategories() {
  const zone = document.getElementById("ab-budgets-categories");
  if (!zone) return;
  if (!abCategories.length) {
    zone.innerHTML = `<p class="hint">${t("Aucune catégorie.")}</p>`;
    return;
  }
  const butee = abButeeMontant();
  const pas = abPasMontant(butee);
  // SANS BUDGET DU MOIS, PAS DE DÉNOMINATEUR : la case des parts est éteinte
  // plutôt qu'affichée à zéro, et son placeholder dit pourquoi.
  const sansTotal = !(abBudgetTotal > 0);

  const lignes = abCategories
    .map((c) => {
      const budget = abBudgets[c.id] || { montant: 0, explicite: false };
      const montant = budget.montant || 0;
      // LA CASE MONTRE UN ARRONDI, LA BASE GARDE L'EXACT (cf.
      // AB_DECIMALES_POURCENTAGE) : « 14,3 % » se lit, « 14,285714285714286 % »
      // ne se lit pas — et c'est pourtant ce que vaut un septième d'un budget.
      const part = abPourcentageDuMontant(montant);
      const partAffichee = part === null ? "" : abPourcentageAffiche(part) || "";
      return `
      <div class="ab-budget-ligne" data-id="${c.id}">
        <div class="ab-budget-nom">
          ${escapeHtml(libelleCategorie(c.nom))}
          ${
            budget.montant > 0 && !budget.explicite
              ? `<span class="badge-aucun">${t("hérité")}</span>`
              : ""
          }
        </div>
        <div class="ab-budget-curseur">
          <input type="range" data-champ="montant" min="0" max="${butee}" step="${pas}"
                 value="${Math.min(montant, butee)}"
                 aria-label="${t("Budget de la catégorie")}" />
          <input type="number" data-champ="montant" step="0.01" min="0"
                 value="${montant ? montant.toFixed(2) : ""}"
                 placeholder="0,00" aria-label="${t("Budget de la catégorie")}" />
          <span class="ab-budget-unite">${escapeHtml(symboleMonnaie(abMonnaieId) || "")}</span>
          <input type="number" data-champ="objectif" step="0.1" min="0"
                 value="${partAffichee}" placeholder="${sansTotal ? "—" : "0"}"
                 aria-label="${t("Part du budget")}" ${sansTotal ? "disabled" : ""} />
          <span class="ab-budget-unite">%</span>
        </div>
      </div>`;
    })
    .join("");

  zone.innerHTML = `
    <div class="ab-budget-entete">
      <div class="ab-budget-nom">${t("Catégorie")}</div>
      <div>${t("Budget du mois")}</div>
    </div>
    ${lignes}
    <div class="ab-budget-somme" id="ab-budget-somme"></div>`;

  abRenderSomme();
}

/* CE QUI RESTE À PLACER, EN PIED DE TABLEAU. C'est la seule chose qu'aucune
 * ligne ne peut dire et qu'on se demande pourtant à chaque réglage : « est-ce
 * que j'ai tout placé ? ».
 *
 * LES DEUX UNITÉS SUR LA MÊME LIGNE, comme dans les cases qu'elles totalisent :
 * ce sont les mêmes euros, lus deux fois. La part n'est plus la somme des
 * `objectif_pourcentage` enregistrés mais celle des ENVELOPPES rapportée au
 * budget du mois — le pied dit alors exactement ce que les lignes montrent,
 * même si une part n'a pas encore été réécrite en base. */
function abRenderSomme() {
  const pied = document.getElementById("ab-budget-somme");
  if (!pied) return;
  const sommeMontants = abCategories.reduce(
    (total, c) => total + ((abBudgets[c.id] || {}).montant || 0),
    0
  );
  const depasse = abBudgetTotal > 0 && sommeMontants > abBudgetTotal + 0.005;
  const part = abPourcentageDuMontant(sommeMontants);
  pied.innerHTML = `
    <div class="ab-budget-nom">${t("Total réparti")}</div>
    <div class="${depasse ? "negatif" : ""}">${formatMontant(sommeMontants, abMonnaieId)}${
      abBudgetTotal > 0
        ? ` / ${formatMontant(abBudgetTotal, abMonnaieId)} · ${formatPourcentage(
            part
          )} / ${formatPourcentage(100)}`
        : ""
    }</div>`;
}

async function abEcrireBudgetCategorie(categorieId, montant) {
  const { annee, mois } = abPeriode;
  await apiFetch(
    `/categories/${categorieId}/budget?annee=${annee}&mois=${mois}&monnaie_id=${abMonnaieId}`,
    { method: "PUT", body: JSON.stringify({ montant }) }
  );
}

async function abEcrireObjectifCategorie(categorieId, pourcentage) {
  await apiFetch(`/categories/${categorieId}/objectif`, {
    method: "PUT",
    body: JSON.stringify({ objectif_pourcentage: pourcentage }),
  });
}

/* UN SEUL ÉCOUTEUR POUR TOUTE LA ZONE, posé une fois : la liste des lignes est
 * reconstruite à chaque lecture, et un écouteur par champ en laisserait un de
 * plus derrière lui à chaque fois (cf. le même piège dans creerMenuCases). */
/** Les trois contrôles d'une ligne remis d'accord sur UNE valeur.
 *
 *  `sauf` est celui qu'on est en train de manipuler : on ne le réécrit pas,
 *  sinon le curseur de saisie sauterait en fin de champ à chaque frappe et le
 *  pouce quitterait le curseur qu'on pousse.
 */
function abSynchroniserLigne(ligne, montant, sauf) {
  const curseur = ligne.querySelector('input[type="range"]');
  const caseMontant = ligne.querySelector('input[type="number"][data-champ="montant"]');
  const casePart = ligne.querySelector('input[type="number"][data-champ="objectif"]');
  if (curseur && curseur !== sauf) {
    // Le curseur ne va pas au-delà de sa butée : une enveloppe saisie plus
    // grande le laisse simplement au bout de sa course (cf. abButeeMontant).
    curseur.value = String(Math.min(montant, Number(curseur.max) || montant));
  }
  if (caseMontant && caseMontant !== sauf) {
    caseMontant.value = montant ? montant.toFixed(2) : "";
  }
  if (casePart && casePart !== sauf) {
    const part = abPourcentageDuMontant(montant);
    casePart.value = part === null ? "" : String(abPourcentageAffiche(part) || "");
  }
}

/** Le montant que ce contrôle décrit, quelle que soit son unité. */
function abMontantSaisi(champ) {
  const brut = String(champ.value).trim();
  const valeur = brut === "" ? 0 : Number(brut.replace(",", "."));
  if (!Number.isFinite(valeur) || valeur < 0) return null;
  return champ.dataset.champ === "objectif" ? abMontantDuPourcentage(valeur) : valeur;
}

/**
 * Enregistre la ligne : l'enveloppe, et la part qui en découle.
 *
 * LA PART D'ABORD, L'ENVELOPPE ENSUITE — et l'ordre est tout sauf un détail.
 *
 * La part est la seule des deux qui puisse être REFUSÉE : leur somme ne peut
 * pas dépasser 100 %, ce qui revient à dire que la somme des enveloppes ne peut
 * pas dépasser le budget du mois. L'enveloppe, elle, n'est jamais refusée.
 *
 * Écrire l'enveloppe en premier laissait donc passer le cas qui casse tout le
 * modèle : enveloppe enregistrée, part rejetée, et les deux « lectures du même
 * nombre » se retrouvaient à dire deux choses différentes — 200 € ici, 0 %
 * là-bas, et le camembert affichant une part que l'écran du budget contredit.
 * Dans cet ordre, un refus ne laisse RIEN derrière lui : la ligne se relit
 * telle qu'elle était, et le message dit le plafond utilisable.
 *
 * SANS BUDGET DU MOIS, SEULE L'ENVELOPPE S'ÉCRIT : il n'y a pas de
 * dénominateur, donc pas de part à en déduire — et donc rien à refuser.
 */
async function abEnregistrerLigneBudget(champ) {
  const ligne = champ.closest(".ab-budget-ligne");
  const categorieId = Number(ligne.dataset.id);
  const montant = abMontantSaisi(champ);
  if (montant === null) {
    showMessage(t("Montant invalide."), "error");
    await abCharger();
    return;
  }
  // LE BLOCAGE PORTE SUR LES ENVELOPPES DU MOIS, telles que l'écran les montre
  // (héritées comprises), et non sur les seules parts enregistrées. Le serveur
  // refuse une somme de PARTS au-delà de 100 % — mais une part n'est écrite que
  // lorsqu'un budget du mois existe : des enveloppes posées avant, ou héritées
  // d'un autre mois, gardaient une part à zéro, et la somme des enveloppes
  // dépassait le budget du mois sans qu'aucun refus ne tombe.
  if (abBudgetTotal > 0) {
    const autres = abCategories
      .filter((c) => c.id !== categorieId)
      .reduce((total, c) => total + ((abBudgets[c.id] || {}).montant || 0), 0);
    if (autres + montant > abBudgetTotal + 0.005) {
      showMessage(
        t(
          "Le budget du mois est de {total} : cette catégorie ne peut pas dépasser {plafond}, sans quoi la somme des budgets par catégorie le dépasserait.",
          {
            total: formatMontant(abBudgetTotal, abMonnaieId),
            plafond: formatMontant(Math.max(0, abBudgetTotal - autres), abMonnaieId),
          }
        ),
        "error"
      );
      await abCharger();
      return;
    }
  }
  try {
    if (abBudgetTotal > 0) {
      // LA PART N'EST PAS ARRONDIE (cf. « LA PART EXACTE ») : six enveloppes de
      // 100 € sur 600 € valent 16,666… % chacune, et arrondies à 16,7 % elles
      // totalisent 100,2 % — la sixième écriture serait refusée pour une
      // répartition qui tombe pourtant juste au centime.
      await abEcrireObjectifCategorie(categorieId, abPourcentageDuMontant(montant));
    }
    await abEcrireBudgetCategorie(categorieId, montant);
  } catch (err) {
    showMessage(traduireMessageServeur(err.message), "error");
  }
  await abCharger();
}

/* UN SEUL ÉCOUTEUR POUR TOUTE LA ZONE, posé une fois : la liste des lignes est
 * reconstruite à chaque lecture, et un écouteur par champ en laisserait un de
 * plus derrière lui à chaque fois (cf. le même piège dans creerMenuCases). */
function abCablerBudgetsCategories() {
  const zone = document.getElementById("ab-budgets-categories");
  if (!zone || zone.dataset.pose) return;
  zone.dataset.pose = "1";

  // BOUGER MET TOUT D'ACCORD, ET N'ENVOIE RIEN. Le curseur et les deux cases
  // décrivent la même valeur : toucher l'un replace les deux autres. Une
  // requête par pixel parcouru écrirait des dizaines de valeurs dont aucune
  // n'est celle qu'on voulait.
  zone.addEventListener("input", (e) => {
    const champ = e.target.closest("input[data-champ]");
    if (!champ) return;
    const ligne = champ.closest(".ab-budget-ligne");
    const montant = abMontantSaisi(champ);
    if (montant === null) return;
    abSynchroniserLigne(ligne, montant, champ);
    // Le pied de tableau suit le geste : c'est ce qu'on regarde en poussant le
    // curseur (« est-ce que j'ai tout placé ? »), et l'attendre au relâchement
    // priverait le geste de sa réponse. Ce qu'on touche ici est le cache de
    // l'écran, jamais la base.
    abBudgets[Number(ligne.dataset.id)] = { montant, explicite: true };
    abRenderSomme();
  });

  // CE QUI ENREGISTRE : le relâchement du curseur, la sortie d'une case (clic
  // ailleurs), et Ctrl+Entrée. `change` est l'événement du geste terminé — sur
  // un curseur il tombe quand on lâche la souris, sur une case quand on en sort
  // ou qu'on valide.
  zone.addEventListener("change", (e) => {
    const champ = e.target.closest("input[data-champ]");
    if (champ) abEnregistrerLigneBudget(champ);
  });

  // ENTRÉE ET CTRL+ENTRÉE ENREGISTRENT SANS QU'ON AIT À QUITTER LA CASE : on
  // règle vingt lignes à la suite, et devoir cliquer ailleurs entre chaque
  // ferait chercher un endroit neutre où cliquer. `preventDefault` parce que
  // ces cases ne sont pas dans un <form>, mais qu'une touche Entrée y cherche
  // quand même quelque chose à soumettre.
  zone.addEventListener("keydown", (e) => {
    if (e.key !== "Enter") return;
    const champ = e.target.closest('input[type="number"][data-champ]');
    if (!champ) return;
    e.preventDefault();
    abEnregistrerLigneBudget(champ);
  });
}

/* ---------- L'écran ----------
 *
 * TROIS LISTES DÉROULANTES ET PLUS TROIS RANGÉES D'ONGLETS. Monnaie, année,
 * mois : trois choix qu'on fait en arrivant et qu'on ne rouvre plus, qui
 * prenaient trois rangées empilées sous une quatrième depuis que la page porte
 * des onglets. Les onglets de période appartiennent aux écrans qu'on PARCOURT —
 * le dashboard, les opérations, où l'on saute de mois en mois pour comparer ;
 * ici on pose un budget, puis on s'en va.
 *
 * LES DOUZE MOIS, TOUJOURS, et des années qui débordent de ce que la base
 * contient : `/meta/periodes` ne nomme que les périodes qui PORTENT des
 * opérations, ce qui suffit pour regarder et jamais pour DÉCIDER — un budget se
 * pose précisément sur un mois où l'on n'a encore rien dépensé.
 */

function abAnneesProposees() {
  const courante = new Date().getFullYear();
  const annees = new Set([courante - 1, courante, courante + 1, abPeriode.annee]);
  (abPeriodesConnues || []).forEach((p) => annees.add(p.annee));
  return [...annees].filter(Boolean).sort((a, b) => b - a);
}

/* DEUX BARRES, UN SEUL ÉTAT. La page porte deux onglets qui parlent tous deux
 * d'un MOIS et d'une MONNAIE — le budget du mois et sa répartition par
 * catégorie — et chacun doit dire lequel : un tableau de vingt curseurs sans
 * son mois à l'écran se règle à l'aveugle. Les deux barres pilotent donc le
 * même `abMonnaieId` / `abPeriode`, et chaque rendu les remplit toutes les
 * deux : changer de mois d'un côté puis passer à l'autre onglet doit montrer
 * le mois qu'on vient de choisir, pas celui d'avant.
 *
 * UNE SEULE BARRE POSÉE AU-DESSUS DES ONGLETS aurait été plus simple, et
 * fausse : la troisième page — « Projets », apportée par son extension — n'a ni
 * mois ni monnaie, et y aurait vu trois listes sans effet. */
const AB_CONTEXTES = [
  { monnaie: "ab-monnaie", annee: "ab-annee", mois: "ab-mois" },
  { monnaie: "ab-cat-monnaie", annee: "ab-cat-annee", mois: "ab-cat-mois" },
];

function abRemplirContexte() {
  AB_CONTEXTES.forEach((ids) => {
    const monnaie = document.getElementById(ids.monnaie);
    if (!monnaie) return;
    fillSelect(
      monnaie,
      state.monnaies.map((m) => ({ value: m.id, label: `${m.nom} (${m.symbole})` }))
    );
    monnaie.value = String(abMonnaieId);
    // UNE SEULE MONNAIE : la liste n'a rien à demander. On la laisse en place
    // plutôt que de la masquer — un champ qui apparaît le jour où l'on crée une
    // seconde devise se cherche, là où un champ toujours là ne surprend jamais.
    monnaie.disabled = state.monnaies.length <= 1;

    const annee = document.getElementById(ids.annee);
    fillSelect(
      annee,
      abAnneesProposees().map((a) => ({ value: a, label: String(a) }))
    );
    annee.value = String(abPeriode.annee);

    const mois = document.getElementById(ids.mois);
    fillSelect(
      mois,
      MOIS_COURTS_FR.map((nom, index) => ({ value: index + 1, label: nom }))
    );
    mois.value = String(abPeriode.mois);
  });
}

async function abCharger() {
  if (!state.monnaies.length) await refreshMonnaies();
  if (abMonnaieId == null || !state.monnaies.some((m) => m.id === abMonnaieId)) {
    abMonnaieId = monnaiePreferee(state.monnaies.map((m) => m.id));
  }
  if (!abPeriode.annee) {
    const aujourdhui = new Date();
    abPeriode.annee = aujourdhui.getFullYear();
    abPeriode.mois = aujourdhui.getMonth() + 1;
  }
  if (abPeriodesConnues === null) {
    // Une seule fois : ces périodes ne servent qu'à proposer les années où
    // quelque chose s'est passé, et la liste ne bouge pas pendant qu'on règle
    // un budget.
    try {
      abPeriodesConnues = await apiFetch("/meta/periodes");
    } catch (err) {
      abPeriodesConnues = [];
    }
  }
  abRemplirContexte();
  if (abMonnaieId == null) return;

  const { annee, mois } = abPeriode;
  try {
    // LES TROIS LECTURES DU BAS PORTENT SUR L'ANNÉE du mois choisi : elles
    // répondent à « est-ce que je tiens un rythme ? », que douze fois un mois
    // ne dit pas. Le budget, lui, est propre au mois — d'où deux requêtes qui
    // ne portent pas la même période, et un seul choix pour les deux.
    const requete = `monnaie_id=${abMonnaieId}&annee=${annee}`;
    const requeteMois = `${requete}&mois=${mois}`;
    const [epargne, matelas, imprevues, categories, budgets, budgetTotal] =
      await Promise.all([
        apiFetch(`/analyse-budget/epargne?${requete}`),
        apiFetch(`/analyse-budget/matelas?monnaie_id=${abMonnaieId}`),
        apiFetch(`/analyse-budget/imprevues?${requete}`),
        apiFetch("/categories"),
        apiFetch(`/categories/budgets?${requeteMois}`),
        apiFetch(`/dashboard/budget-total?${requeteMois}`),
      ]);
    // LES CATÉGORIES D'ENTRÉE N'ONT RIEN À FAIRE ICI (`est_entree`, migration
    // 0060) : on ne se donne pas un budget de salaire, et leur ligne aurait
    // demandé deux chiffres auxquels il n'y a rien à répondre. Le serveur les
    // écarte de la même façon du plafond des objectifs et de l'histogramme des
    // dépenses — c'est la même question, posée trois fois.
    // UNE CATÉGORIE ÉTEINTE NON PLUS (`active`, migration 0063) : aucune
    // nouvelle dépense n'y tombera, lui demander une enveloppe et une part
    // reviendrait à répartir un budget sur ce qu'on vient justement de ranger.
    // Son objectif déjà écrit, lui, continue de compter dans le plafond des
    // 100 % — et le serveur le dit quand il refuse (cf.
    // crud.erreur_objectif_pourcentage).
    abCategories = categories.filter((c) => !c.est_entree && c.active !== false);
    abBudgets = Object.fromEntries(
      budgets.map((b) => [b.categorie_id, { montant: b.montant, explicite: b.explicite }])
    );
    abBudgetTotal = budgetTotal.montant || 0;
    abBudgetTotalExplicite = budgetTotal.explicite !== false;

    abRenderBudgetTotal();
    abRenderBudgetsCategories();
    abRenderEpargne(epargne);
    abRenderMatelas(matelas);
    abRenderImprevues(imprevues);
    // LES GRAPHES EN DERNIER : ils demandent leurs propres périodes, et ne
    // doivent pas retarder les chiffres qu'on vient régler. Les semaines sont
    // relues à chaque chargement — une opération a pu changer depuis.
    abSemainesCache = {};
    abRenderGraphes();


  } catch (err) {
    showMessage(err.message, "error");
  }
}

/* ---------- Les onglets de la page ----------
 *
 * « PROJETS » EST VENU S'Y RANGER (cf. extensions/projets) : un projet est une
 * enveloppe qu'on se donne pour un voyage ou un déménagement, exactement la
 * même nature de décision que le budget d'un mois — et rien à voir avec la vue
 * globale des comptes, qui dit ce qu'on A.
 *
 * LE NOYAU MONTRE ET CACHE LES VOLETS tout seul (gestionnaire délégué de
 * app.js, commun à tous les écrans à onglets) ; ce qui reste à faire ici est
 * de CHARGER les données de celui qu'on ouvre — exactement ce que fait
 * `chargerSousPageComptesGlobale` pour la page des comptes.
 */
function abChargerSousPage(page) {
  // LES DEUX ONGLETS DU NOYAU DE CETTE PAGE LISENT LA MÊME CHOSE : le budget du
  // mois est le dénominateur des parts d'à côté, et les deux viennent du même
  // aller-retour (cf. abCharger). Deux chargements séparés auraient laissé
  // exister un instant où le tableau des catégories rapporte ses pourcentages
  // à un total que l'autre onglet a déjà changé.
  if (page === "budget-budget" || page === "budget-categories") return abCharger();
  // Onglet apporté par une autre extension : le noyau sait à qui le demander.
  return BudgetApp.extensions.ouvrirSousPage(page);
}

function abOuvrirPage() {
  const actif = document.querySelector("#budget-sous-nav button.active");
  return abChargerSousPage(actif ? actif.dataset.sousSection : "budget-budget");
}

document.getElementById("budget-sous-nav")?.addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-sous-section]");
  if (btn) abChargerSousPage(btn.dataset.sousSection);
});

AB_CONTEXTES.forEach((ids) => {
  document.getElementById(ids.monnaie)?.addEventListener("change", (e) => {
    abMonnaieId = Number(e.target.value);
    abCharger();
  });
  document.getElementById(ids.annee)?.addEventListener("change", (e) => {
    abPeriode.annee = Number(e.target.value);
    abCharger();
  });
  document.getElementById(ids.mois)?.addEventListener("change", (e) => {
    abPeriode.mois = Number(e.target.value);
    abCharger();
  });
});

document.getElementById("btn-ab-matelas")?.addEventListener("click", abEnregistrerMatelas);
document.getElementById("btn-ab-budget-total")?.addEventListener("click", abEnregistrerBudgetTotal);
// Entrée valide, comme dans n'importe quel champ de l'application. Le champ
// n'est pas dans un <form> : l'y mettre aurait fait recharger la page à la
// moindre touche Entrée.
document.getElementById("ab-budget-total")?.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    e.preventDefault();
    abEnregistrerBudgetTotal();
  }
});
abCablerBudgetsCategories();

/* LA FENÊTRE D'ACCORD DES TROIS GRANDEURS NE S'OUVRE PLUS D'ICI, et cette page
 * n'a donc plus rien à y raccrocher.
 *
 * Elle demandait laquelle des trois grandeurs on voulait vraiment changer quand
 * elles se contredisaient. L'enveloppe et la part ne peuvent plus se
 * contredire — ce sont deux lectures du même nombre (cf. le bloc « UN SEUL
 * CURSEUR, DEUX CASES ») — et changer le budget du mois recalcule les parts au
 * lieu de poser la question (cf. abResynchroniserParts).
 *
 * CE QUI RESTE DANS LE NOYAU : `#modale-coherence-budgets`,
 * `verifierAccordBudgets` et `crud.incoherences_budgets`. Plus rien ne les
 * appelle. */

/* ---------- L'AVERTISSEMENT LÀ OÙ ON REGARDE SES COMPTES D'ÉPARGNE ----------
 *
 * POURQUOI IL NE RESTE PAS DANS L'ONGLET. Un matelas franchi est une nouvelle
 * qu'il faut recevoir sans l'avoir demandée : posée dans un onglet qu'on ouvre
 * exprès, elle n'arrive qu'à ceux qui la cherchaient déjà — c'est-à-dire à
 * personne. Il est donc greffé sur la vue globale, contre le titre « Comptes
 * d'épargne », à l'endroit précis où l'on constate ce qu'on a.
 *
 * IL N'APPARAÎT QUE QUAND ON EST DESSOUS. Un bandeau permanent qui dit « tout
 * va bien » cesse d'être lu en trois jours, et avec lui le jour où il dirait
 * autre chose.
 *
 * UNE GREFFE PAR ENVELOPPEMENT, le mécanisme des extensions : on garde la
 * fonction du noyau, on la rappelle, puis on ajoute. Sans le `?? window.…`,
 * recharger deux fois l'extension envelopperait sa propre enveloppe.
 */
const abLoadComptesGlobaleAvant = window.loadComptesGlobale;

async function abMajAvertissementEpargne() {
  const bloc = document.getElementById("globale-bloc-epargne");
  if (!bloc) return;
  let banniere = document.getElementById("ab-avertissement-matelas");
  if (!banniere) {
    banniere = document.createElement("div");
    banniere.id = "ab-avertissement-matelas";
    banniere.className = "ab-banniere-matelas";
    // AVANT la grille des comptes, APRÈS le titre : c'est la première chose
    // qu'on lit en arrivant sur le bloc qu'elle commente.
    bloc.insertBefore(banniere, bloc.querySelector(".comptes-grid"));
  }
  try {
    // TOUTES LES MONNAIES, et non celle de l'onglet : cette page n'en a pas.
    // Un matelas franchi en dollars doit se voir même si l'euro va bien.
    const etats = await Promise.all(
      state.monnaies.map((m) => apiFetch(`/analyse-budget/matelas?monnaie_id=${m.id}`))
    );
    const sous = etats.filter((e) => e.sous_le_seuil);
    banniere.style.display = sous.length ? "" : "none";
    banniere.innerHTML = sous
      .map(
        (e) =>
          `<div>${t("Matelas de sécurité franchi : il manque {montant}.", {
            montant: formatMontant(Math.abs(e.ecart), e.monnaie_id),
          })}</div>`
      )
      .join("");
  } catch (err) {
    // L'AVERTISSEMENT NE DOIT JAMAIS CASSER LA PAGE QU'IL COMMENTE : en cas
    // d'échec, il se tait — la vue globale reste exactement ce qu'elle était.
    banniere.style.display = "none";
  }
}

window.loadComptesGlobale = async function loadComptesGlobaleAvecMatelas(...args) {
  const resultat = await abLoadComptesGlobaleAvant.apply(this, args);
  await abMajAvertissementEpargne();
  return resultat;
};


// L'enregistrement auprès du noyau, en FIN de fichier : `abCharger` doit exister
// au moment où on la référence. Le chargeur est rappelé à chaque ouverture de
// la page — les opérations comme les budgets ont pu changer depuis.
//
// L'IDENTIFIANT RESTE `analyse-budget`, le nom du DOSSIER : c'est lui que le
// noyau connaît, lui que porte l'état d'activation déjà enregistré, et il ne
// s'affiche nulle part. Le nom visible, lui, est dans le manifeste.
BudgetApp.extensions.enregistrer("analyse-budget", { chargeur: abOuvrirPage });
