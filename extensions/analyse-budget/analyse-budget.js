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
let abIncoherences = [];

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
    <div class="ab-histo-titre">${escapeHtml(libelle)}</div>
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

  abHistogramme(
    document.getElementById("ab-epargne-mois"),
    donnees.mois.map((m) => ({ libelle: MOIS_COURTS_FR[m.mois - 1], valeur: m.net })),
    donnees.monnaie_id,
    { libelle: t("Mois par mois") }
  );
}

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

  abHistogramme(
    document.getElementById("ab-imprevues-mois"),
    donnees.mois.map((m) => ({ libelle: MOIS_COURTS_FR[m.mois - 1], valeur: m.imprevu })),
    donnees.monnaie_id,
    { libelle: t("Mois par mois") }
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
 * Écrit le budget du mois affiché, puis demande l'accord des trois grandeurs.
 *
 * C'EST LA SEULE ÉCRITURE DE CETTE PAGE QUI OUVRE LA FENÊTRE D'ACCORD, et la
 * raison tient en un mot : le total est le dénominateur commun. Le bouger
 * déplace d'un coup le montant attendu de CHAQUE catégorie, et c'est là qu'on a
 * besoin qu'on nous dise laquelle des trois grandeurs on voulait vraiment
 * changer. Une enveloppe de catégorie, elle, se règle au curseur : ouvrir une
 * fenêtre modale à chaque relâchement de souris aurait rendu le curseur
 * inutilisable — son désaccord se lit sur sa propre ligne (cf.
 * abLigneDesaccord).
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
  await abCharger();
  await verifierAccordBudgets(annee, mois, abMonnaieId);
}

/* ---------- Les budgets par catégorie ----------
 *
 * DEUX GRANDEURS PAR LIGNE, ET ELLES NE SE DÉDUISENT PAS L'UNE DE L'AUTRE : le
 * BUDGET en valeur (une enveloppe posée sur la catégorie pour ce mois-là, qui
 * répond à « combien puis-je encore dépenser ») et l'OBJECTIF en pourcentage
 * (la part du budget total qui devrait aller là). Poser l'un n'oblige jamais à
 * poser l'autre — c'est verrouillé par test_objectif_categorie.py — et c'est
 * précisément pour ça qu'ils sont sur la même ligne plutôt que sur deux écrans :
 * on les décide en pensant à la même catégorie.
 *
 * UN CURSEUR ET UN NOMBRE, PAS L'UN OU L'AUTRE. Le curseur sert à RÉPARTIR — on
 * pousse celui-ci, on voit ce qu'il reste — et c'est le geste qu'on fait devant
 * vingt catégories. Le nombre sert à POSER une valeur exacte (150 €, 12,5 %),
 * ce qu'aucun curseur ne fera jamais au pixel près. Les deux pilotent la même
 * valeur : glisser met le nombre à jour sans rien envoyer, et c'est le
 * RELÂCHEMENT (l'événement `change`) qui écrit.
 *
 * LA BUTÉE DU CURSEUR DE POURCENTAGE EST CE QUI RESTE À RÉPARTIR : la somme des
 * objectifs ne peut pas dépasser 100 % (le serveur refuse en 400, cf.
 * crud.erreur_objectif_pourcentage), et un curseur qui laisse atteindre une
 * valeur refusée apprend à ne plus lui faire confiance. Ce n'est pas un
 * contrôle — c'est le serveur qui tranche, toujours — c'est la course du
 * curseur qui dit la place disponible.
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

// Un pas qui donne au curseur une course utilisable : au centime, il faudrait
// des milliers de crans pour traverser un budget de 3 000 €, et la valeur exacte
// se pose de toute façon dans le champ nombre d'à côté.
function abPasMontant(butee) {
  if (butee > 20000) return 100;
  if (butee > 5000) return 25;
  if (butee > 1000) return 10;
  return 5;
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
  const sommeObjectifs = abCategories.reduce(
    (total, c) => total + (c.objectif_pourcentage || 0),
    0
  );
  const parCategorie = Object.fromEntries(abIncoherences.map((l) => [l.categorie_id, l]));

  const lignes = abCategories
    .map((c) => {
      const budget = abBudgets[c.id] || { montant: 0, explicite: false };
      const objectif = c.objectif_pourcentage || 0;
      // Ce qui reste à répartir POUR CELLE-CI : le total moins les autres. On
      // retranche la sienne parce qu'on la REMPLACE, on ne l'ajoute pas —
      // sinon ramener 60 % à 50 % serait refusé (même règle que le serveur).
      const plafond = Math.max(
        objectif,
        Math.round((100 - (sommeObjectifs - objectif)) * 10) / 10
      );
      const desaccord = parCategorie[c.id];
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
                 value="${Math.min(budget.montant, butee)}"
                 aria-label="${t("Budget de la catégorie")}" />
          <input type="number" data-champ="montant" step="0.01" min="0"
                 value="${budget.montant ? budget.montant.toFixed(2) : ""}"
                 placeholder="0,00" />
          <span class="ab-budget-unite">${escapeHtml(symboleMonnaie(abMonnaieId) || "")}</span>
        </div>
        <div class="ab-budget-curseur">
          <input type="range" data-champ="objectif" min="0" max="${plafond}"
                 step="0.1" value="${objectif}" aria-label="${t("Objectif")}" />
          <input type="number" data-champ="objectif" step="0.1" min="0" max="${plafond}"
                 value="${objectif || ""}" placeholder="0" />
          <span class="ab-budget-unite">%</span>
        </div>
        ${desaccord ? abLigneDesaccord(desaccord) : ""}
      </div>`;
    })
    .join("");

  zone.innerHTML = `
    <div class="ab-budget-entete">
      <div class="ab-budget-nom">${t("Catégorie")}</div>
      <div>${t("Budget du mois")}</div>
      <div>${t("Objectif de répartition")}</div>
    </div>
    ${lignes}
    <div class="ab-budget-somme" id="ab-budget-somme"></div>`;

  abRenderSomme();
}

/* LE DÉSACCORD SE LIT SUR LA LIGNE QUI LE PORTE, et non dans une fenêtre.
 *
 * Les trois grandeurs sont liées par une équation — l'enveloppe d'une catégorie
 * devrait valoir le budget total multiplié par son objectif — et rien n'oblige
 * à les poser toutes les trois. Mais dès que les trois existent, elles peuvent
 * se contredire, et la réponse n'appartient qu'à celui qui a écrit les chiffres :
 * a-t-il changé d'avis sur l'enveloppe, sur la part, ou sur le total ?
 *
 * D'OÙ UN SIGNALEMENT ET NON UN RECALCUL, comme avant. Ce qui change, c'est
 * l'endroit : au curseur, une fenêtre modale s'ouvrirait à chaque relâchement de
 * souris — puisque bouger l'un des deux nombres DÉFAIT l'équation par
 * construction — et on ne pourrait plus régler une ligne sans la refermer trois
 * fois. Posé sous la ligne, le signalement dit la même chose, reste visible tant
 * qu'on ne l'a pas traité, et n'interrompt rien.
 *
 * LES CHIFFRES SONT CEUX DU SERVEUR (`/dashboard/coherence-budgets`) et non
 * recalculés ici : un miroir qui dérive de son modèle proposerait un nombre qui
 * ne fait pas taire le signalement. */
function abLigneDesaccord(ligne) {
  return `
    <div class="ab-budget-desaccord">
      <span>${t("Ne s'accorde pas avec le budget du mois.")}</span>
      <button type="button" data-accord="budget">${t("Mettre le budget à")} ${formatMontant(
        ligne.budget_attendu,
        abMonnaieId
      )}</button>
      <button type="button" data-accord="objectif">${t(
        "Mettre l'objectif à"
      )} ${formatPourcentage(ligne.pourcentage_attendu)}</button>
    </div>`;
}

/* LA SOMME DES DEUX COLONNES, EN PIED DE TABLEAU. C'est la seule chose qu'aucune
 * ligne ne peut dire et qu'on se demande pourtant à chaque réglage : « est-ce
 * que j'ai tout placé ? ». Les objectifs se comparent à 100 % (on n'est pas
 * obligé de l'atteindre, mais on ne peut pas le dépasser), les enveloppes au
 * budget total — qu'elles PEUVENT dépasser, rien ne l'interdit, et c'est
 * justement pour ça qu'il faut pouvoir le voir. */
function abRenderSomme() {
  const pied = document.getElementById("ab-budget-somme");
  if (!pied) return;
  const sommeMontants = abCategories.reduce(
    (total, c) => total + ((abBudgets[c.id] || {}).montant || 0),
    0
  );
  const sommeObjectifs = abCategories.reduce(
    (total, c) => total + (c.objectif_pourcentage || 0),
    0
  );
  const depasse = abBudgetTotal > 0 && sommeMontants > abBudgetTotal + 0.005;
  pied.innerHTML = `
    <div class="ab-budget-nom">${t("Total réparti")}</div>
    <div class="${depasse ? "negatif" : ""}">${formatMontant(sommeMontants, abMonnaieId)}${
      abBudgetTotal > 0 ? ` / ${formatMontant(abBudgetTotal, abMonnaieId)}` : ""
    }</div>
    <div>${formatPourcentage(sommeObjectifs)} / ${formatPourcentage(100)}</div>`;
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
function abCablerBudgetsCategories() {
  const zone = document.getElementById("ab-budgets-categories");
  if (!zone || zone.dataset.pose) return;
  zone.dataset.pose = "1";

  // GLISSER NE MET À JOUR QUE LE NOMBRE D'À CÔTÉ, et n'envoie rien : une
  // requête par pixel parcouru écrirait des dizaines de valeurs dont aucune
  // n'est celle qu'on voulait.
  zone.addEventListener("input", (e) => {
    const champ = e.target.closest("input[data-champ]");
    if (!champ) return;
    const ligne = champ.closest(".ab-budget-ligne");
    const jumeau = [...ligne.querySelectorAll(`input[data-champ="${champ.dataset.champ}"]`)].find(
      (autre) => autre !== champ
    );
    if (jumeau) jumeau.value = champ.value;
    // Le pied de tableau suit le curseur : c'est ce qu'on regarde en le
    // poussant (« est-ce que j'ai tout placé ? »), et l'attendre au
    // relâchement priverait le geste de sa réponse. Ce que l'on touche ici est
    // le cache de l'écran, jamais la base — l'écriture attend `change`.
    const valeur = Number(String(champ.value).replace(",", ".")) || 0;
    if (champ.dataset.champ === "montant") {
      abBudgets[Number(ligne.dataset.id)] = { montant: valeur, explicite: true };
    } else {
      const categorie = abCategories.find((c) => c.id === Number(ligne.dataset.id));
      if (categorie) categorie.objectif_pourcentage = valeur;
    }
    abRenderSomme();
  });

  // LE RELÂCHEMENT ÉCRIT, ET IL ÉCRIT LES DEUX. `change` est l'événement du
  // geste terminé : sur un curseur il tombe quand on lâche la souris, sur un
  // champ nombre quand on en sort ou qu'on valide.
  //
  // LES DEUX CURSEURS D'UNE LIGNE SONT LIÉS PAR LE BUDGET TOTAL : l'enveloppe
  // devrait valoir le total multiplié par l'objectif (cf.
  // crud.incoherences_budgets). Bouger l'un sans l'autre défaisait donc
  // l'équation à chaque geste, et posait aussitôt sous la ligne le signalement
  // de désaccord — à chaque relâchement de souris, pour un désaccord qu'on
  // venait de créer soi-même et dont la correction était calculable. Porter
  // l'autre chiffre est la seule chose à faire : c'est ce que l'utilisateur
  // aurait cliqué dans la seconde qui suit.
  //
  // SEULEMENT SI LE TOTAL EST POSÉ : sans dénominateur, il n'y a pas d'équation
  // et l'autre chiffre ne se déduit de rien. On écrit alors le seul qu'on a
  // touché, exactement comme avant.
  zone.addEventListener("change", async (e) => {
    const champ = e.target.closest("input[data-champ]");
    if (!champ) return;
    const ligne = champ.closest(".ab-budget-ligne");
    const categorieId = Number(ligne.dataset.id);
    const brut = String(champ.value).trim();
    const valeur = brut === "" ? 0 : Number(brut.replace(",", "."));
    if (!Number.isFinite(valeur) || valeur < 0) {
      showMessage(t("Montant invalide."), "error");
      await abCharger();
      return;
    }
    const surLeMontant = champ.dataset.champ === "montant";
    // Arrondis aux mêmes décimales que les champs de saisie : proposer
    // 24,999999 % laisserait un écart que personne ne peut ni voir ni corriger.
    const montant = surLeMontant
      ? valeur
      : Math.round(abBudgetTotal * (valeur / 100) * 100) / 100;
    const objectif = surLeMontant
      ? Math.round((valeur / abBudgetTotal) * 1000) / 10
      : Math.round(valeur * 10) / 10;
    try {
      if (abBudgetTotal > 0) {
        // LE MONTANT D'ABORD : c'est celui qui ne peut jamais être refusé. Un
        // objectif qui ferait dépasser 100 % l'est, lui (400) — écrire dans cet
        // ordre laisse au pire la ligne dans l'état d'avant pour sa part, et
        // jamais l'inverse.
        await abEcrireBudgetCategorie(categorieId, montant);
        await abEcrireObjectifCategorie(categorieId, objectif);
      } else if (surLeMontant) {
        await abEcrireBudgetCategorie(categorieId, montant);
      } else {
        await abEcrireObjectifCategorie(categorieId, objectif);
      }
    } catch (err) {
      // LE SERVEUR TRANCHE, TOUJOURS : un objectif qui ferait dépasser 100 %
      // est refusé en 400, avec le plafond utilisable dans le message. On le
      // dit et on relit — sans quoi l'écran garderait une valeur que la base
      // n'a pas.
      showMessage(traduireMessageServeur(err.message), "error");
    }
    await abCharger();
  });

  // LES DEUX CORRECTIONS PROPOSÉES SOUS UNE LIGNE EN DÉSACCORD. Les chiffres
  // viennent du serveur ; ici on ne fait que les lui renvoyer.
  zone.addEventListener("click", async (e) => {
    const bouton = e.target.closest("button[data-accord]");
    if (!bouton) return;
    const categorieId = Number(bouton.closest(".ab-budget-ligne").dataset.id);
    const ligne = abIncoherences.find((l) => l.categorie_id === categorieId);
    if (!ligne) return;
    try {
      if (bouton.dataset.accord === "budget") {
        await abEcrireBudgetCategorie(categorieId, ligne.budget_attendu);
      } else {
        // ARRONDI À LA DÉCIMALE, comme le champ de saisie : proposer
        // 24,999999 % laisserait un écart que personne ne peut ni voir ni
        // corriger — et que la tolérance du serveur absorbe de toute façon.
        await abEcrireObjectifCategorie(
          categorieId,
          Math.round(ligne.pourcentage_attendu * 10) / 10
        );
      }
    } catch (err) {
      showMessage(traduireMessageServeur(err.message), "error");
    }
    await abCharger();
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

function abRemplirContexte() {
  const monnaie = document.getElementById("ab-monnaie");
  fillSelect(
    monnaie,
    state.monnaies.map((m) => ({ value: m.id, label: `${m.nom} (${m.symbole})` }))
  );
  monnaie.value = String(abMonnaieId);
  // UNE SEULE MONNAIE : la liste n'a rien à demander. On la laisse en place
  // plutôt que de la masquer — un champ qui apparaît le jour où l'on crée une
  // seconde devise se cherche, là où un champ toujours là ne surprend jamais.
  monnaie.disabled = state.monnaies.length <= 1;

  const annee = document.getElementById("ab-annee");
  fillSelect(
    annee,
    abAnneesProposees().map((a) => ({ value: a, label: String(a) }))
  );
  annee.value = String(abPeriode.annee);

  const mois = document.getElementById("ab-mois");
  fillSelect(
    mois,
    MOIS_COURTS_FR.map((nom, index) => ({ value: index + 1, label: nom }))
  );
  mois.value = String(abPeriode.mois);
}

async function abCharger() {
  if (!state.monnaies.length) await refreshMonnaies();
  if (abMonnaieId == null || !state.monnaies.some((m) => m.id === abMonnaieId)) {
    abMonnaieId = state.monnaies[0] ? state.monnaies[0].id : null;
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
    const [epargne, matelas, imprevues, categories, budgets, budgetTotal, coherence] =
      await Promise.all([
        apiFetch(`/analyse-budget/epargne?${requete}`),
        apiFetch(`/analyse-budget/matelas?monnaie_id=${abMonnaieId}`),
        apiFetch(`/analyse-budget/imprevues?${requete}`),
        apiFetch("/categories"),
        apiFetch(`/categories/budgets?${requeteMois}`),
        apiFetch(`/dashboard/budget-total?${requeteMois}`),
        apiFetch(`/dashboard/coherence-budgets?${requeteMois}`),
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
    abIncoherences = coherence.lignes || [];

    abRenderBudgetTotal();
    abRenderBudgetsCategories();
    abRenderEpargne(epargne);
    abRenderMatelas(matelas);
    abRenderImprevues(imprevues);
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
  if (page === "budget-budget") return abCharger();
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

["ab-monnaie", "ab-annee", "ab-mois"].forEach((id) => {
  document.getElementById(id)?.addEventListener("change", (e) => {
    const valeur = Number(e.target.value);
    if (id === "ab-monnaie") abMonnaieId = valeur;
    if (id === "ab-annee") abPeriode.annee = valeur;
    if (id === "ab-mois") abPeriode.mois = valeur;
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

/* LA FENÊTRE D'ACCORD DES TROIS GRANDEURS REND LA MAIN À CETTE PAGE.
 *
 * `appliquerAccordBudget` (app.js) recharge le dashboard après avoir corrigé
 * une grandeur — c'était le seul écran d'où elle pouvait s'ouvrir. Elle s'ouvre
 * maintenant aussi d'ici, et sans ce rappel la page Budget garderait à l'écran
 * les chiffres d'avant la correction qu'on vient d'accepter.
 *
 * PAR ENVELOPPEMENT, le mécanisme des extensions (cf. extensions/README.md) :
 * on garde la fonction du noyau, on la rappelle, puis on relit. */
const abAppliquerAccordAvant = window.appliquerAccordBudget;

window.appliquerAccordBudget = async function abAppliquerAccordBudget(...args) {
  const resultat = await abAppliquerAccordAvant.apply(this, args);
  await abCharger();
  return resultat;
};

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
