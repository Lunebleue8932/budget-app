/* ---------- Extension « Analyse de budget » ----------
 *
 * TROIS LECTURES, UN ÉCRAN. Ce que tu as mis de côté, ce que tu veux garder
 * disponible, et ce que tu n'avais pas vu venir. Toutes trois répondent à
 * « qu'est-ce que cette période a fait à mon patrimoine », là où la vue globale
 * d'à côté répond à « où en suis-je aujourd'hui ».
 *
 * CHARGÉ PAR frontend/extensions.js, après injection de page.html : le script
 * s'exécute en portée GLOBALE et a donc accès à tout ce qu'app.js expose
 * (apiFetch, formatMontant, showMessage, state, t…).
 *
 * TOUT EST PRÉFIXÉ `ab` / `AB_` : les scripts d'extension partagent une seule
 * portée, dans l'ordre alphabétique des dossiers, et un nom nu se ferait écraser
 * par celui d'une autre extension (cf. extensions/README.md). « analyse-budget »
 * se charge EN PREMIER — c'est le premier dossier par ordre alphabétique — donc
 * c'est elle qui se ferait écraser, silencieusement.
 */

/* CE QUI APPARTIENT À L'EXTENSION DANS UN ÉCRAN DU NOYAU : la case « Dépense
 * imprévue » du formulaire d'opération, écrite dans index.html avec
 * `display:none` et `data-extension-greffe="analyse-budget"`.
 *
 * C'EST L'EXTENSION QUI L'ALLUME, et ce fichier n'est chargé QUE si elle est
 * active (cf. extensions.js) : sa seule exécution vaut donc « allume-la ».
 * Même patron que « Prêts », qui n'est rien d'autre que cet appel. Compter sur
 * le noyau pour le faire ne marche qu'au moment où l'on BASCULE l'interrupteur
 * dans les Paramètres — au chargement d'une application déjà allumée, personne
 * n'appelle, et la case restait invisible jusqu'au prochain aller-retour par
 * les Paramètres. */
BudgetApp.extensions.majVisibilite("analyse-budget", true);

let abMonnaieId = null;
let abAnnee = new Date().getFullYear();

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
      const classe = v.valeur >= 0 ? "ab-barre-positive" : "ab-barre-negative";
      const titre = `${v.libelle} — ${formatMontant(v.valeur, monnaieId)}`;
      return `
        <g class="ab-barre">
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

/* ---------- L'écran ---------- */

function abRenderOngletsMonnaie() {
  const barre = document.getElementById("ab-monnaies");
  if (!barre) return;
  barre.innerHTML = "";
  state.monnaies.forEach((monnaie) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = monnaie.nom;
    if (monnaie.id === abMonnaieId) btn.classList.add("active");
    btn.addEventListener("click", () => {
      if (monnaie.id === abMonnaieId) return;
      abMonnaieId = monnaie.id;
      abCharger();
    });
    barre.appendChild(btn);
  });
}

function abRenderAnnees() {
  const select = document.getElementById("ab-annee");
  if (!select || select.options.length) return;
  const courante = new Date().getFullYear();
  const annees = [];
  for (let a = courante + 1; a >= courante - 6; a -= 1) annees.push(a);
  fillSelect(select, annees.map((a) => ({ value: a, label: String(a) })));
  select.value = String(abAnnee);
  select.addEventListener("change", () => {
    abAnnee = Number(select.value);
    abCharger();
  });
}

async function abCharger() {
  if (!state.monnaies.length) await refreshMonnaies();
  if (abMonnaieId == null || !state.monnaies.some((m) => m.id === abMonnaieId)) {
    abMonnaieId = state.monnaies[0] ? state.monnaies[0].id : null;
  }
  abRenderAnnees();
  abRenderOngletsMonnaie();
  if (abMonnaieId == null) return;
  try {
    const requete = `monnaie_id=${abMonnaieId}&annee=${abAnnee}`;
    const [epargne, matelas, imprevues] = await Promise.all([
      apiFetch(`/analyse-budget/epargne?${requete}`),
      apiFetch(`/analyse-budget/matelas?monnaie_id=${abMonnaieId}`),
      apiFetch(`/analyse-budget/imprevues?${requete}`),
    ]);
    abRenderEpargne(epargne);
    abRenderMatelas(matelas);
    abRenderImprevues(imprevues);
  } catch (err) {
    showMessage(err.message, "error");
  }
}

document.getElementById("btn-ab-matelas")?.addEventListener("click", abEnregistrerMatelas);

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
// l'onglet — les opérations ont pu changer depuis.
BudgetApp.extensions.enregistrer("analyse-budget", { chargeur: abCharger });
