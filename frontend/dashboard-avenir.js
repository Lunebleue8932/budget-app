/* ====================================================================================
 * LE DASHBOARD SUR UNE PAGE, TOURNÉ VERS L'AVANT
 *
 * CE QUE CE FICHIER PORTE. Le dashboard ne raconte plus le mois écoulé (cette lecture vit
 * sur la page Budget) : il dit combien il reste, ce qui arrive, ce qui vient de se passer —
 * et mène d'un clic à la page où l'on creuse. Tout ce qui est propre à cette page est ici :
 *
 *   - les trois boutons de période, TOUJOURS relatifs à aujourd'hui ;
 *   - le bloc « Reste pour finir le mois » et sa courbe ;
 *   - les deux listes (prochaines prévisionnelles, dernières opérations) ;
 *   - les boutons de navigation ;
 *   - la limite de trois cartes épinglées.
 *
 * IL NE CALCULE RIEN. Le « reste » vient du serveur avec les KPI (`kpis.reste`, cf.
 * services/soldes.reste_periode), la courbe et les listes de deux routes à part. Refaire ici
 * la moindre de ces sommes aurait ouvert la porte à un bloc qui ne dit pas le même chiffre
 * que la page Budget où son bouton mène.
 *
 * PORTÉE GLOBALE : tout ce qui est déclaré ici commence par `dbr`. Le fichier est chargé
 * après app.js, dont il réutilise les fonctions (`t`, `formatMontant`, `switchSection`…) ;
 * app.js l'appelle en retour par trois prises, toutes gardées par un `typeof` :
 * `dbrCalerPeriode` (à l'ouverture), `dbrRendre` (après les KPI) et `DBR_HISTOGRAMME` (la
 * taille compacte de l'histogramme).
 * ==================================================================================== */

// L'histogramme du noyau, en version compacte : ~110 px, les noms sous les barres quand ils
// tiennent, ni camembert ni légende (cf. renderHistogrammeDashboard, app.js).
const DBR_HISTOGRAMME = { hauteur: 110, margeBas: 20, margeHaut: 14 };

// Combien de lignes par liste, et combien de cartes épinglées sur la rangée du bas.
const DBR_LIGNES = 5;
const DBR_EPINGLES_MAX = 3;

// Ce que la page affiche en ce moment : les KPI de la monnaie (ou de la vue convertie), la
// courbe et les listes. Gardés pour redessiner sans rien redemander (changement de taille).
let dbrKpis = null;
let dbrCourbe = null;
// Chaque rendu numérote ses lectures : une réponse arrivée après un changement de monnaie
// ou de période ne doit pas écraser celle qu'on attend.
let dbrSequence = 0;

/* ---------- Petits outils ---------- */

function dbrDate(iso) {
  const [annee, mois, jour] = iso.split("-").map(Number);
  return new Date(annee, mois - 1, jour);
}

/** « 16 Nov. » : le jour et le mois abrégé, sans l'année — la page parle des semaines qui viennent. */
function dbrJourMois(iso) {
  const d = typeof iso === "string" ? dbrDate(iso) : iso;
  return `${d.getDate()} ${MOIS_COURTS_FR[d.getMonth()]}.`;
}

function dbrToutConverti() {
  return typeof agregationActive !== "undefined" && agregationActive;
}

function dbrMontantSigne(valeur, monnaieId) {
  const nul = montantEstNul(valeur);
  return `${valeur > 0 && !nul ? "+" : ""}${formatMontant(valeur, monnaieId)}`;
}

function dbrEcrire(id, texte) {
  const el = document.getElementById(id);
  if (el) el.textContent = texte;
  return el;
}

/* ---------- La période : trois boutons, toujours relatifs à aujourd'hui ----------
 *
 * LE DASHBOARD NE REMONTE PLUS LE TEMPS. « Mois » est le mois en cours, « Année » l'année en
 * cours, « Tout » tout l'historique — et rien d'autre : pour relire mars, on va sur la page
 * Budget. Les boutons règlent `state.dashboardPeriode`, que le reste du noyau lit déjà ; `vue`
 * reste dérivée du niveau, comme partout (cf. vueDuNiveau).
 */
function dbrCalerPeriode(niveau = null) {
  const p = state.dashboardPeriode;
  const aujourdhui = new Date();
  // Un niveau « semaine » hérité d'une session précédente n'existe plus ici : il retombe sur
  // le mois qui la contient.
  p.niveau = niveau || (p.niveau === "semaine" ? "mois" : p.niveau);
  p.vue = vueDuNiveau(p.niveau);
  p.annee = aujourdhui.getFullYear();
  p.mois = aujourdhui.getMonth() + 1;
  p.semaine = null;
  p.semainesDeplie = false;
  dbrMajBoutonsPeriode();
}

function dbrMajBoutonsPeriode() {
  const vue = state.dashboardPeriode.vue;
  document.querySelectorAll("#dbr-periode button[data-dbr-periode]").forEach((bouton) => {
    const actif = bouton.dataset.dbrPeriode === vue;
    bouton.classList.toggle("active", actif);
    bouton.setAttribute("aria-checked", actif ? "true" : "false");
  });
}

async function dbrChoisirPeriode(vue) {
  if (state.dashboardPeriode.vue === vue) return;
  dbrCalerPeriode(vue);
  await loadDashboardData(state.dashboardPeriode.annee, state.dashboardPeriode.mois);
}

document.getElementById("dbr-periode")?.addEventListener("click", (e) => {
  const bouton = e.target.closest("button[data-dbr-periode]");
  if (bouton) dbrChoisirPeriode(bouton.dataset.dbrPeriode);
});

/** La ligne sous le titre : la date du jour, la période regardée, et jusqu'où l'on projette. */
function dbrMajSousTitre(reste) {
  const el = document.getElementById("dbr-sous-titre");
  if (!el) return;
  const p = state.dashboardPeriode;
  const aujourdhui = new Date();
  const jour = capitalizeFirst(
    new Intl.DateTimeFormat(langue(), { weekday: "short" }).format(aujourdhui).replace(".", "")
  );
  const date = `${jour}. ${dbrJourMois(aujourdhui)} ${aujourdhui.getFullYear()}`;
  const periode =
    p.vue === "tout"
      ? t("tout l'historique")
      : p.vue === "annee"
        ? t("année {annee}", { annee: p.annee })
        : libelleMois(p.annee, p.mois);
  const horizon = reste ? `, ${t("jusqu'au {date}", { date: dbrJourMois(reste.horizon) })}` : "";
  el.textContent = `${date} · ${periode}${horizon}`;
}

/* ---------- Le rendu, appelé par renderKpisDashboard ----------
 *
 * UNE SEULE PRISE : `renderKpisDashboard` est le passage obligé de tout rendu du dashboard,
 * y compris la vue convertie de l'extension « Monnaies » qui le rappelle avec des KPI
 * agrégés. Le bloc suit donc la case « Tout convertir » sans rien savoir d'elle.
 */
function dbrRendre(kpis) {
  dbrKpis = kpis;
  dbrMajBoutonsPeriode();
  dbrMajSousTitre(kpis ? kpis.reste : null);
  dbrRendreKpis(kpis);
  dbrRendreReste(kpis);
  dbrChargerCourbeEtListes(kpis);
}

/** Les détails posés à côté des deux KPI de solde : le projeté et sa date, la part hors comptes courants. */
function dbrRendreKpis(kpis) {
  const libelle = document.getElementById("dbr-projete-libelle");
  const avoirs = document.getElementById("dbr-avoirs-detail");
  if (!kpis) {
    if (libelle) libelle.textContent = t("Projeté");
    if (avoirs) avoirs.textContent = "";
    return;
  }
  if (libelle) {
    libelle.textContent = kpis.reste
      ? t("Projeté au {date} :", { date: dbrJourMois(kpis.reste.horizon) })
      : t("Projeté");
  }
  if (avoirs) {
    const horsCourant = (kpis.total_avoirs || 0) - (kpis.solde_total_courant || 0);
    avoirs.textContent = montantEstNul(horsCourant)
      ? ""
      : t("dont épargne et placements {montant}", {
          montant: formatMontant(horsCourant, kpis.monnaie_id),
        });
  }
}

/* ---------- « Reste pour finir le mois » ---------- */

const DBR_TITRES_RESTE = {
  mois: "Reste pour finir le mois",
  annee: "Reste pour finir l'année",
  tout: "Reste pour finir l'année",
};

function dbrRendreReste(kpis) {
  const bloc = document.getElementById("dbr-reste");
  if (!bloc) return;
  const vue = state.dashboardPeriode.vue;
  dbrEcrire("dbr-reste-titre-texte", t(DBR_TITRES_RESTE[vue] || DBR_TITRES_RESTE.mois));

  const reste = kpis ? kpis.reste : null;
  if (!reste) {
    ["dbr-reste-libre", "dbr-point-bas", "dbr-rythme", "dbr-entree", "dbr-sorties-prevues", "dbr-solde-libre"].forEach(
      (id) => dbrEcrire(id, "-")
    );
    dbrEcrire("dbr-reste-libre-legende", "");
    dbrEcrire("dbr-point-bas-label", t("Point bas"));
    dbrEcrire("dbr-rythme-label", t("Rythme sûr"));
    dbrEcrire("dbr-entree-label", t("Prochaine entrée"));
    bloc.classList.remove("dbr-alerte");
    document.getElementById("dbr-jauge-sorties").style.width = "0";
    document.getElementById("dbr-jauge-libre").style.width = "0";
    return;
  }
  const monnaieId = kpis.monnaie_id;

  // LE CHIFFRE QUI RÉPOND : ce qu'il restera sur les comptes courants à l'horizon, une fois
  // tout ce qui est prévu passé.
  const libre = dbrEcrire("dbr-reste-libre", formatMontant(reste.reste_libre, monnaieId));
  libre.classList.toggle("negatif", reste.reste_libre < 0 && !montantEstNul(reste.reste_libre));
  dbrEcrire("dbr-reste-libre-legende", t("Solde libre au {date}", { date: dbrJourMois(reste.horizon) }));

  // LE POINT BAS : le plus bas par où le solde passera d'ici là, et les jours où il y reste.
  const bas = reste.point_bas;
  const palier =
    bas.date_debut === bas.date_fin
      ? dbrJourMois(bas.date_debut)
      : dbrDate(bas.date_debut).getMonth() === dbrDate(bas.date_fin).getMonth()
        ? `${dbrDate(bas.date_debut).getDate()}-${dbrJourMois(bas.date_fin)}`
        : `${dbrJourMois(bas.date_debut)} - ${dbrJourMois(bas.date_fin)}`;
  dbrEcrire("dbr-point-bas-label", `${t("Point bas")} · ${palier}`);
  dbrEcrire("dbr-point-bas", formatMontant(bas.montant, monnaieId));

  // LE RYTHME SÛR : ce qu'on peut dépenser par jour sans passer sous zéro avant que
  // l'argent rentre. Zéro quand le point bas est déjà à zéro ou en dessous — et le bloc le
  // signale (cf. .dbr-alerte).
  dbrEcrire(
    "dbr-rythme-label",
    `${t("Rythme sûr")} · ${
      reste.prochaine_entree
        ? t("jusqu'à la prochaine entrée")
        : t("jusqu'au {date}", { date: dbrJourMois(reste.horizon) })
    }`
  );
  dbrEcrire(
    "dbr-rythme",
    `≈ ${formatMontant(reste.rythme_sur, monnaieId)} ${t("/ jour")}`
  );
  bloc.classList.toggle("dbr-alerte", !!reste.alerte);

  // LA PROCHAINE ENTRÉE, ou qu'il n'y en a aucune de prévue.
  const entree = reste.prochaine_entree;
  const entreeEl = document.getElementById("dbr-entree");
  if (entree) {
    dbrEcrire("dbr-entree-label", `${t("Prochaine entrée")} · ${dbrJourMois(entree.date)}`);
    entreeEl.textContent = dbrMontantSigne(entree.montant, monnaieId);
    entreeEl.title = entree.libelle || "";
    entreeEl.classList.add("positif");
    entreeEl.classList.remove("montant-nul");
  } else {
    dbrEcrire("dbr-entree-label", t("Prochaine entrée"));
    entreeEl.textContent = t("aucune prévue");
    entreeEl.title = "";
    entreeEl.classList.remove("positif");
    entreeEl.classList.add("montant-nul");
  }

  // LA JAUGE : ce qui est déjà promis à des sorties, face à ce qui reste libre.
  const sorties = Math.max(reste.sorties_prevues || 0, 0);
  const libreVisible = Math.max(reste.reste_libre || 0, 0);
  const total = sorties + libreVisible;
  document.getElementById("dbr-jauge-sorties").style.width = total ? `${(sorties / total) * 100}%` : "0";
  document.getElementById("dbr-jauge-libre").style.width = total ? `${(libreVisible / total) * 100}%` : "0";
  dbrEcrire("dbr-sorties-prevues", formatMontant(sorties, monnaieId));
  dbrEcrire("dbr-solde-libre", formatMontant(reste.reste_libre, monnaieId));
}

/* ---------- La courbe et les listes : deux lectures à part ----------
 *
 * HORS DE LA CHARGE DES KPI : la courbe porte un point par jour de mouvement, sur un an en
 * vue « Année » — rien dont les chiffres du haut aient besoin pour s'afficher. Une lecture
 * qui échoue laisse son bloc vide et ne touche pas au reste de la page.
 *
 * « TOUT CONVERTIR » : la courbe convertie vient de l'extension « Monnaies » (elle seule
 * connaît les taux) ; les listes, elles, montrent alors les opérations de TOUTES les
 * monnaies, chacune dans la sienne — une ligne n'additionne rien.
 */
async function dbrChargerCourbeEtListes(kpis) {
  const sequence = ++dbrSequence;
  const monnaieId = kpis ? kpis.monnaie_id : null;
  if (monnaieId == null) {
    dbrCourbe = null;
    dbrDessinerCourbe();
    dbrRendreListes(null);
    return;
  }
  const vue = state.dashboardPeriode.vue;
  const converti = dbrToutConverti();
  const urlCourbe = converti
    ? `/conversion/reste-courbe?vers=${monnaieId}&vue=${vue}`
    : `/dashboard/reste-courbe?monnaie_id=${monnaieId}&vue=${vue}`;
  const urlListes = `/dashboard/listes?vue=${vue}${converti ? "" : `&monnaie_id=${monnaieId}`}`;

  const [courbe, listes] = await Promise.all([
    apiFetch(urlCourbe).catch(() => null),
    apiFetch(urlListes).catch(() => null),
  ]);
  if (sequence !== dbrSequence) return;
  dbrCourbe = courbe ? { ...courbe, monnaieId } : null;
  dbrDessinerCourbe();
  dbrRendreListes(listes);
}

/* ---------- Le dessin de la courbe ----------
 *
 * DEUX TRAITS, UNE SEULE GRANDEUR : le solde des comptes courants. À gauche d'aujourd'hui,
 * le RÉEL, en trait plein ; à droite, le PROJETÉ, en pointillé et EN ESCALIER — une marche
 * par prévisionnelle, parce qu'un solde ne glisse pas d'une échéance à la suivante, il
 * tombe le jour où elle passe. Le point bas est marqué là où le serveur le place.
 *
 * DESSINÉ À LA TAILLE MESURÉE DU CADRE : c'est la courbe qui absorbe la hauteur libre de la
 * page, sa taille n'est donc connue qu'à l'écran — et elle est redessinée quand le cadre
 * change (cf. l'observateur plus bas).
 */
function dbrDessinerCourbe() {
  const cadre = document.getElementById("dbr-courbe");
  if (!cadre) return;
  const donnees = dbrCourbe;
  const reels = donnees ? donnees.reels || [] : [];
  const projetes = donnees ? donnees.projetes || [] : [];
  if (!donnees || reels.length + projetes.length === 0) {
    cadre.innerHTML = `<span class="hint dbr-courbe-vide">${t("Aucun mouvement à tracer.")}</span>`;
    return;
  }
  const largeur = Math.max(cadre.clientWidth, 200);
  const hauteur = Math.max(cadre.clientHeight, 70);
  const marge = { gauche: 52, droite: 10, haut: 12, bas: 18 };
  const zoneL = largeur - marge.gauche - marge.droite;
  const zoneH = hauteur - marge.haut - marge.bas;

  const jour = (iso) => dbrDate(iso).getTime();
  const tous = [...reels, ...projetes];
  const debut = jour(tous[0].date);
  const fin = Math.max(jour(donnees.horizon), jour(tous[tous.length - 1].date));
  const duree = Math.max(fin - debut, 1);
  const soldes = tous.map((p) => p.solde);
  let min = Math.min(...soldes);
  let max = Math.max(...soldes);
  if (max - min < 1) {
    max += 1;
    min -= 1;
  }
  const garde = (max - min) * 0.12;
  min -= garde;
  max += garde;
  const x = (iso) => marge.gauche + ((jour(iso) - debut) / duree) * zoneL;
  const y = (solde) => marge.haut + (1 - (solde - min) / (max - min)) * zoneH;

  // Trois repères horizontaux : le haut, le milieu, le bas de ce qui est tracé.
  const reperes = [max - garde, (max + min) / 2, min + garde]
    .map((valeur) => {
      const yy = y(valeur).toFixed(1);
      return `<line x1="${marge.gauche}" y1="${yy}" x2="${largeur - marge.droite}" y2="${yy}" stroke="var(--border-soft)" stroke-width="1" />
        <text x="${marge.gauche - 6}" y="${yy}" text-anchor="end" dominant-baseline="middle" font-size="10" fill="var(--text-muted)">${escapeHtml(
          formatMontant(Math.round(valeur), donnees.monnaieId).replace(/[.,]00(?=\D*$)/, "")
        )}</text>`;
    })
    .join("");

  // La ligne de zéro, quand elle est dans le cadre : c'est elle que le point bas regarde.
  const zero =
    min < 0 && max > 0
      ? `<line x1="${marge.gauche}" y1="${y(0).toFixed(1)}" x2="${largeur - marge.droite}" y2="${y(0).toFixed(
          1
        )}" stroke="var(--badge-remboursable-text)" stroke-width="1" stroke-dasharray="2 3" />`
      : "";

  // Quelques dates sous l'axe : le début, aujourd'hui (porté par son trait), la fin.
  const etiquettesX = [tous[0].date, donnees.horizon]
    .map(
      (iso, i) =>
        `<text x="${x(iso).toFixed(1)}" y="${hauteur - 4}" text-anchor="${
          i === 0 ? "start" : "end"
        }" font-size="10" fill="var(--text-muted)">${escapeHtml(dbrJourMois(iso))}</text>`
    )
    .join("");

  const traitReel = reels.length
    ? `<polyline fill="none" stroke="var(--accent-light)" stroke-width="2" stroke-linejoin="round" points="${reels
        .map((p) => `${x(p.date).toFixed(1)},${y(p.solde).toFixed(1)}`)
        .join(" ")}" />`
    : "";

  // L'ESCALIER : on avance à l'horizontale jusqu'au jour de la marche, puis on tombe (ou on
  // monte) d'un coup. Il part du dernier point réel — aujourd'hui.
  let traitProjete = "";
  if (projetes.length) {
    const depart = reels.length ? reels[reels.length - 1] : projetes[0];
    let chemin = `M${x(depart.date).toFixed(1)},${y(depart.solde).toFixed(1)}`;
    projetes.forEach((p) => {
      chemin += ` H${x(p.date).toFixed(1)} V${y(p.solde).toFixed(1)}`;
    });
    chemin += ` H${x(donnees.horizon).toFixed(1)}`;
    traitProjete = `<path d="${chemin}" fill="none" stroke="var(--accent-light)" stroke-width="2" stroke-dasharray="5 4" />`;
  }

  const xAuj = x(donnees.aujourdhui).toFixed(1);
  const aujourdhui = `<line x1="${xAuj}" y1="${marge.haut}" x2="${xAuj}" y2="${hauteur - marge.bas}" stroke="var(--text-muted)" stroke-width="1" stroke-dasharray="3 3" />
    <text x="${xAuj}" y="${marge.haut - 2}" text-anchor="middle" font-size="10" fill="var(--text-muted)">${escapeHtml(
      t("Aujourd'hui")
    )}</text>`;
  const pointAuj = reels.length
    ? `<circle cx="${xAuj}" cy="${y(reels[reels.length - 1].solde).toFixed(1)}" r="3.5" fill="var(--accent-light)" />`
    : "";

  // LE POINT BAS, là où le serveur l'a trouvé — pas recalculé ici.
  let pointBas = "";
  const bas = dbrKpis && dbrKpis.reste ? dbrKpis.reste.point_bas : null;
  if (bas) {
    const xb = x(bas.date_debut);
    const yb = y(bas.montant);
    const aDroite = xb < largeur - 150;
    pointBas = `<circle cx="${xb.toFixed(1)}" cy="${yb.toFixed(1)}" r="3.5" fill="var(--badge-remboursable-text)" />
      <text x="${(xb + (aDroite ? 7 : -7)).toFixed(1)}" y="${Math.max(yb - 6, marge.haut + 8).toFixed(
        1
      )}" text-anchor="${aDroite ? "start" : "end"}" font-size="10" font-weight="700" fill="var(--badge-remboursable-text)">${escapeHtml(
        `${t("Point bas")} ${formatMontant(bas.montant, donnees.monnaieId)}`
      )}</text>`;
  }

  cadre.innerHTML = `
    <svg viewBox="0 0 ${largeur} ${hauteur}" width="${largeur}" height="${hauteur}" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="${escapeHtml(
      t("Solde des comptes courants : réel, puis projeté")
    )}">
      ${reperes}${zero}${etiquettesX}${aujourdhui}${traitReel}${traitProjete}${pointAuj}${pointBas}
    </svg>
    <div class="dbr-courbe-bulle" hidden></div>`;

  // LA BULLE : le point le plus proche du pointeur, sa date et son solde — et le libellé de
  // l'échéance quand c'est une marche du projeté.
  const bulle = cadre.querySelector(".dbr-courbe-bulle");
  const points = [
    ...reels.map((p) => ({ ...p, px: x(p.date), py: y(p.solde) })),
    ...projetes.map((p) => ({ ...p, px: x(p.date), py: y(p.solde) })),
  ];
  cadre.onmousemove = (e) => {
    const boite = cadre.getBoundingClientRect();
    const sx = e.clientX - boite.left;
    let proche = points[0];
    points.forEach((p) => {
      if (Math.abs(p.px - sx) < Math.abs(proche.px - sx)) proche = p;
    });
    bulle.textContent = `${dbrJourMois(proche.date)} · ${formatMontant(proche.solde, donnees.monnaieId)}${
      proche.libelle ? ` · ${proche.libelle}` : ""
    }`;
    bulle.hidden = false;
    const largeurBulle = bulle.offsetWidth;
    bulle.style.left = `${Math.min(Math.max(proche.px - largeurBulle / 2, 0), largeur - largeurBulle)}px`;
    bulle.style.top = `${Math.max(proche.py - 30, 0)}px`;
  };
  cadre.onmouseleave = () => {
    bulle.hidden = true;
  };
}

// La courbe se redessine quand son cadre change de taille (fenêtre, thème, bloc voisin).
(function dbrObserverCourbe() {
  const cadre = document.getElementById("dbr-courbe");
  if (!cadre || typeof ResizeObserver === "undefined") return;
  let largeur = 0;
  let hauteur = 0;
  new ResizeObserver(() => {
    if (cadre.clientWidth === largeur && cadre.clientHeight === hauteur) return;
    largeur = cadre.clientWidth;
    hauteur = cadre.clientHeight;
    if (largeur && hauteur) dbrDessinerCourbe();
  }).observe(cadre);
})();

/* ---------- Les deux listes ----------
 *
 * UNE LIGNE = date, libellé, « · catégorie », montant. Les prévisionnelles reprennent la
 * convention du tableau des Opérations (`operation-previsionnelle` : gris, italique) et les
 * montants ses classes de couleur (`montantHtml`) — une même opération se lit de la même
 * façon sur les deux écrans.
 */
function dbrLigneHtml(ligne, { previsionnelle = false } = {}) {
  const complements = [];
  if (ligne.categorie_nom) complements.push(libelleCategorie(ligne.categorie_nom));
  if (ligne.etalee_jusqu_au) {
    complements.push(t("étalée {mois}", { mois: `${MOIS_COURTS_FR[dbrDate(ligne.etalee_jusqu_au).getMonth()]}.` }));
  }
  if (ligne.recurrente) complements.push(t("récurrente"));
  if (ligne.en_retard) complements.push(t("en retard"));
  const libelle = ligne.nature ? escapeHtml(ligne.nature) : escapeHtml(t("Sans libellé"));
  return `
    <div class="dbr-ligne${previsionnelle ? " operation-previsionnelle" : ""}" data-dbr-operation="${ligne.id}" role="listitem">
      <span class="dbr-ligne-date">${escapeHtml(dbrJourMois(ligne.jour_pose || ligne.date))}</span>
      <span class="dbr-ligne-texte">
        <span class="dbr-ligne-libelle" title="${libelle}">${libelle}</span>
        ${
          complements.length
            ? `<span class="dbr-ligne-categorie">· ${escapeHtml(complements.join(" · "))}</span>`
            : ""
        }
      </span>
      <span class="dbr-ligne-montant">${montantHtml(ligne.montant, ligne.sens, ligne.monnaie_id)}</span>
    </div>`;
}

function dbrRendreListes(listes) {
  const prochaines = document.getElementById("dbr-prochaines");
  const dernieres = document.getElementById("dbr-dernieres");
  const compte = document.getElementById("dbr-prochaines-compte");
  if (!prochaines || !dernieres) return;
  prochaines.setAttribute("role", "list");
  dernieres.setAttribute("role", "list");
  const vide = (texte) => `<span class="hint dbr-liste-vide">${escapeHtml(t(texte))}</span>`;

  const aVenir = listes ? listes.prochaines || [] : [];
  prochaines.innerHTML = aVenir.length
    ? aVenir.slice(0, DBR_LIGNES).map((l) => dbrLigneHtml(l, { previsionnelle: true })).join("")
    : vide("Aucune prévisionnelle à venir");
  if (compte) {
    const total = listes ? listes.prochaines_total || 0 : 0;
    compte.textContent = total
      ? ` · ${
          state.dashboardPeriode.vue === "mois"
            ? t("{n} jusqu'à fin de mois", { n: total })
            : t("{n} jusqu'à fin d'année", { n: total })
        }`
      : "";
  }

  const passees = listes ? listes.dernieres || [] : [];
  dernieres.innerHTML = passees.length
    ? passees.slice(0, DBR_LIGNES).map((l) => dbrLigneHtml(l)).join("")
    : vide("Aucune opération");
}

/* ---------- Les boutons de navigation ----------
 *
 * LE CŒUR DE LA PAGE : chaque bloc mène à l'écran où l'on creuse. Tout passe par
 * `switchSection(section, { sousSection | ongletActif })`, comme le reste de l'application.
 * Les boutons qui mènent à la page Budget portent `data-extension="analyse-budget"` : le
 * noyau les masque de lui-même quand l'extension est éteinte (cf. majVisibiliteNavigation).
 */
const DBR_DESTINATIONS = {
  // Le solde prévisionnel est un bloc de l'onglet « Prévisions » de la page Budget.
  previsions: () => switchSection("budget", { sousSection: "budget-previsions" }),
  // L'onglet principal de la page Budget : la période, les graphes, la comparaison.
  analyse: () => switchSection("budget", { sousSection: "budget-budget" }),
  avoirs: () => switchSection("comptes-globale"),
  operations: () => dbrOuvrirOperations(false),
  previsionnelles: () => dbrOuvrirOperations(true),
  epingles: () => switchSection("budget", { sousSection: "budget-projets-objectifs" }),
};

// Le filtre de statut a-t-il été posé par un bouton de cette page ? « Voir les opérations → »
// le retire alors : on ne doit pas arriver sur un tableau encore restreint aux
// prévisionnelles parce qu'on avait cliqué l'autre bouton une minute plus tôt. Un filtre
// posé à la main sur la page Transactions, lui, n'est jamais touché.
let dbrFiltreStatutPose = false;

/**
 * La page Transactions — telle quelle, ou restreinte aux prévisionnelles.
 *
 * LE FILTRE EXISTE DÉJÀ : c'est le menu « Statut » des filtres de la page (cf. index.html,
 * `data-filtre="statut"`). On le pose comme le ferait la main, on le propage aux autres
 * onglets et on ouvre le panneau : un tableau restreint dont rien à l'écran ne dit qu'il
 * l'est serait un piège (même règle que drillThroughCategorie).
 *
 * LA PÉRIODE PASSE À « TOUT » : la page s'ouvre sinon sur le mois en cours, et les
 * prévisionnelles du mois prochain — celles que la liste du dashboard vient de montrer —
 * n'y seraient pas.
 */
async function dbrOuvrirOperations(previsionnelles) {
  switchSection("operations");
  if (!previsionnelles && !dbrFiltreStatutPose) return;
  await loadOperations();
  document.querySelector('#operations-sous-nav button[data-sous-section="classique"]')?.click();
  const champ = document.querySelector('#filtres-classique [data-filtre="statut"]');
  if (!champ) return;
  champ.value = previsionnelles ? STATUT_PREVISIONNEL : "";
  dbrFiltreStatutPose = previsionnelles;
  propagerFiltreAuxAutresOnglets(champ, "classique");
  majResumeFiltres("classique");
  if (previsionnelles) {
    ouvrirFiltresOnglet("classique");
    operationsPeriode.vue = "tout";
    operationsPeriode.niveau = "tout";
  }
  appliquerPeriodeOperations();
}

document.getElementById("section-dashboard")?.addEventListener("click", (e) => {
  const bouton = e.target.closest("[data-dbr-aller]");
  if (bouton) {
    DBR_DESTINATIONS[bouton.dataset.dbrAller]?.();
    return;
  }
  // Une ligne de liste mène à la page Transactions, sur le même filtre que son bouton.
  const ligne = e.target.closest(".dbr-ligne");
  if (ligne) dbrOuvrirOperations(!!ligne.closest("#dbr-prochaines"));
});

/* ---------- Les cartes épinglées : trois au plus ----------
 *
 * Les deux conteneurs sont remplis par l'extension « Projets et objectifs », chacun à son
 * heure ; un observateur recompte donc après chaque rendu, plutôt qu'un appel depuis
 * l'extension. Les projets passent d'abord (c'est l'ordre du DOM). Ce qui dépasse n'est pas
 * supprimé, seulement masqué — et un bouton « +N → Budget » dit combien il en reste.
 */
function dbrLimiterEpingles() {
  const cartes = [
    ...document.querySelectorAll("#dashboard-projets .projet-carte, #dashboard-objectifs .obj-carte"),
  ];
  cartes.forEach((carte, rang) => carte.classList.toggle("dbr-epingle-cachee", rang >= DBR_EPINGLES_MAX));
  const plus = document.getElementById("dbr-epingles-plus");
  if (!plus) return;
  const enPlus = cartes.length - DBR_EPINGLES_MAX;
  plus.hidden = enPlus <= 0;
  plus.dataset.dbrAller = "epingles";
  if (enPlus > 0) plus.textContent = `+${enPlus} → ${t("Budget")}`;
}

["dashboard-projets", "dashboard-objectifs"].forEach((id) => {
  const conteneur = document.getElementById(id);
  if (!conteneur) return;
  new MutationObserver(dbrLimiterEpingles).observe(conteneur, { childList: true, subtree: true });
});
