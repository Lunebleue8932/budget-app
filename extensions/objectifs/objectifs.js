/* ---------- Extension « Objectifs » ----------
 *
 * Les règles qu'on se donne et que le budget ne sait pas écrire. Ce fichier
 * s'exécute dans la portée globale de la page, après l'injection de page.html :
 * tout ce que app.js expose lui est accessible (apiFetch, state, t,
 * showMessage, formatMontant, formatPourcentage, escapeHtml, fillSelect,
 * MOIS_COURTS_FR…), et les éléments sur lesquels il pose ses écouteurs existent
 * déjà.
 *
 * DEUX ENDROITS POUR UNE MÊME LECTURE, et c'est tout le sujet de ce fichier :
 *
 *   - L'ONGLET « Objectifs » de la page Budget, où on les CRÉE et où on les
 *     regarde tous, sur la période qu'on y choisit ;
 *   - LE DASHBOARD, où ceux qu'on a cochés se posent sous les deux graphes, sur
 *     la période que le sélecteur affiche. C'est là qu'un objectif sert : on ne
 *     va pas sur une page pour se demander si on tient sa règle, on se le
 *     demande devant ses dépenses du mois.
 *
 * LA GREFFE ENVELOPPE `loadDashboardData`, le point de passage unique du
 * dashboard (cf. app.js) : c'est lui qui connaît la période ET la monnaie de
 * l'onglet actif, et qui est rappelé aussi bien quand on change de mois que
 * quand on change de devise. S'accrocher à `loadDashboard` n'aurait attrapé que
 * l'ouverture de l'écran.
 *
 * TOUS LES IDENTIFIANTS SONT PRÉFIXÉS `objectif-` / `obj` : cet écran vit dans
 * le même document que le reste de l'application, et les scripts d'extension
 * partagent une seule portée globale (cf. extensions/README.md).
 */

const OBJECTIFS_BASE = "/objectifs";

let objObjectifs = [];
let objMesures = [];
let objMonnaieId = null;
let objPeriode = { annee: null, mois: null };
let objPeriodesConnues = null;

/* ---------- Dire un chiffre dans l'unité de sa mesure ---------- */

// Un nombre de dépenses n'a pas de centimes, mais une MOYENNE de dépenses en a
// (3,8 par semaine) : deux décimales feraient croire à une précision que le
// comptage n'a pas, zéro cacherait l'écart avec la cible.
const OBJ_FORMAT_NOMBRE = new Intl.NumberFormat("fr-FR", {
  minimumFractionDigits: 0,
  maximumFractionDigits: 1,
});

function objMesureEstMonetaire(mesure) {
  return mesure === "montant_total" || mesure === "montant_moyen";
}

// Les mesures qui CUMULENT sur la durée (cf. constants.MESURES_OBJECTIF_
// CUMULATIVES) : les seules dont la cadence, et donc le prorata, veuille dire
// quelque chose.
function objMesureCumule(mesure) {
  return mesure === "nombre" || mesure === "montant_total";
}

function objFormatValeur(valeur, mesure, monnaieId) {
  if (objMesureEstMonetaire(mesure)) return formatMontant(valeur, monnaieId);
  if (mesure === "part_depenses") return formatPourcentage(valeur);
  return OBJ_FORMAT_NOMBRE.format(valeur || 0);
}

// CE QU'ON ÉCRIT À CÔTÉ DU GRAND CHIFFRE, et il dépend du MODE autant que de
// la mesure (cf. service_objectifs.mesurer). « 196 € sur la période » et
// « 3,8 par semaine » ne se disent pas pareil : le premier est un cumul qu'on
// compare à la cible entière, le second une moyenne. Écrire « par mois » sur un
// cumul du mois en cours laisserait croire à une prévision.
function objUniteCible(mesure, cadence, mode) {
  if (mesure === "part_depenses") return t("des dépenses de la période");
  if (mesure === "montant_moyen") return t("par dépense");
  if (mode === "moyenne") {
    return cadence === "semaine" ? t("par semaine") : t("par mois");
  }
  return t("sur la période");
}

/* ---------- Les cartes, communes aux deux écrans ----------
 *
 * UNE SEULE FONCTION POUR LES DEUX, et c'est délibéré : la carte du dashboard
 * et celle de la page doivent se reconnaître d'un écran à l'autre — deux
 * rendus parallèles auraient divergé au premier ajustement. Seuls les boutons
 * d'édition changent, et ils sont posés à part.
 */

function objBarre(avancement, atteint) {
  // LA BARRE SE REMPLIT JUSQU'À LA CIBLE ET PAS AU-DELÀ : au-delà, c'est le
  // DÉPASSEMENT qu'on peint, en tête de barre, plutôt que de laisser une barre
  // sortir de son cadre ou se remettre à zéro. Une barre pleine et rouge dit
  // « franchi » sans avoir à lire le chiffre.
  const largeur = Math.max(0, Math.min(100, avancement));
  const classe = atteint ? "obj-barre-tenue" : "obj-barre-manquee";
  return `
    <div class="obj-barre" role="img" aria-label="${escapeHtml(
      `${Math.round(avancement)} %`
    )}">
      <div class="obj-barre-remplissage ${classe}" style="width:${largeur}%"></div>
    </div>`;
}

function objDetailMesure(mesure) {
  // CE QUI A SERVI À CALCULER, en petit sous la barre. « 3,8 par semaine » sort
  // d'une division que rien d'autre ne montre : sans « 17 dépenses sur 4,4
  // semaines », le chiffre affiché est à croire sur parole.
  const morceaux = [];
  if (mesure.categorie) morceaux.push(escapeHtml(mesure.categorie));
  else morceaux.push(t("Toutes les dépenses"));

  if (mesure.mesure === "nombre") {
    morceaux.push(`${mesure.valeur} ${t("dépenses sur la période")}`);
  } else if (mesure.mesure === "montant_moyen") {
    morceaux.push(`${mesure.echantillon} ${t("dépenses sur la période")}`);
  } else if (mesure.mesure === "montant_total" && mesure.mode === "moyenne") {
    // En mode cumul, le grand chiffre EST déjà ce total : le répéter en petit
    // juste en dessous n'apprend rien.
    morceaux.push(
      `${formatMontant(mesure.valeur, mesure.monnaie_id)} ${t("sur la période")}`
    );
  }
  // LES UNITÉS ÉCOULÉES NE SE DISENT QUE SI ON A DIVISÉ PAR ELLES : sur un
  // cumul, elles ne servent à aucun calcul affiché, et les écrire ferait
  // chercher une division qui n'a pas eu lieu.
  if (mesure.mode === "moyenne" && mesure.unites) {
    const unite =
      mesure.cadence === "semaine" ? t("semaines écoulées") : t("mois écoulés");
    morceaux.push(`${OBJ_FORMAT_NOMBRE.format(mesure.unites)} ${unite}`);
  }
  return morceaux.join(" · ");
}

function objCarteHtml(mesure, options = {}) {
  const comparateur = mesure.sens === "max" ? "≤" : "≥";
  const etat = mesure.atteint ? t("tenu") : t("manqué");
  const actions = options.editable
    ? `<span class="obj-carte-actions">
         <button type="button" class="lien" data-objectif-modifier="${mesure.objectif_id}">${t(
           "Modifier"
         )}</button>
         <button type="button" class="lien danger" data-objectif-supprimer="${
           mesure.objectif_id
         }">${t("Supprimer")}</button>
       </span>`
    : "";

  return `
    <div class="obj-carte ${mesure.atteint ? "obj-tenu" : "obj-manque"}"
         data-objectif-id="${mesure.objectif_id}">
      <div class="obj-carte-tete">
        <span class="obj-nom">${escapeHtml(mesure.nom)}</span>
        <span class="obj-etat">${etat}</span>
        ${actions}
      </div>
      <div class="obj-chiffres">
        <span class="obj-valeur">${objFormatValeur(
          mesure.valeur_cadence,
          mesure.mesure,
          mesure.monnaie_id
        )}</span>
        <span class="obj-unite">${escapeHtml(
          objUniteCible(mesure.mesure, mesure.cadence, mesure.mode)
        )}</span>
        <span class="obj-cible">${t("cible")} ${comparateur} ${objFormatValeur(
          mesure.cible,
          mesure.mesure,
          mesure.monnaie_id
        )}</span>
      </div>
      ${objBarre(mesure.avancement, mesure.atteint)}
      <div class="obj-detail hint">${objDetailMesure(mesure)}</div>
    </div>`;
}

/* ---------- L'onglet de la page Budget ---------- */

function objAnneesProposees() {
  const courante = new Date().getFullYear();
  const annees = new Set([courante - 1, courante, courante + 1, objPeriode.annee]);
  (objPeriodesConnues || []).forEach((p) => annees.add(p.annee));
  return [...annees].filter(Boolean).sort((a, b) => b - a);
}

function objRemplirContexte() {
  const monnaie = document.getElementById("obj-monnaie");
  fillSelect(
    monnaie,
    state.monnaies.map((m) => ({ value: m.id, label: `${m.nom} (${m.symbole})` }))
  );
  monnaie.value = String(objMonnaieId);
  monnaie.disabled = state.monnaies.length <= 1;

  const annee = document.getElementById("obj-annee");
  fillSelect(
    annee,
    objAnneesProposees().map((a) => ({ value: a, label: String(a) }))
  );
  annee.value = String(objPeriode.annee);

  const mois = document.getElementById("obj-mois");
  fillSelect(
    mois,
    MOIS_COURTS_FR.map((nom, index) => ({ value: index + 1, label: nom }))
  );
  mois.value = String(objPeriode.mois);
}

function objRemplirCategories() {
  const select = document.getElementById("objectif-categorie");
  const choisi = select.value;
  // LES CATÉGORIES D'ENTRÉE N'Y SONT PAS : un objectif compte des DÉPENSES, et
  // une catégorie de salaire n'en porte aucune — sa barre serait à zéro quoi
  // qu'on y range, exactement comme sur l'histogramme du dashboard.
  const options = (state.categories || [])
    .filter((c) => !c.est_entree)
    .map((c) => ({ value: c.id, label: c.nom }));
  // UNE PART EXIGE UNE CATÉGORIE (le serveur refuse en 400) : sans elle, elle
  // rapporte toutes les dépenses au total des dépenses et vaut 100 % tous les
  // mois. Retirer le choix vaut mieux que le laisser mener à un refus.
  const partSeule =
    document.getElementById("objectif-mesure").value === "part_depenses";
  fillSelect(
    select,
    partSeule ? options : [{ value: "", label: t("Toutes les dépenses") }, ...options]
  );
  select.value = choisi;
  if (partSeule && !select.value) select.selectedIndex = 0;

  const monnaie = document.getElementById("objectif-monnaie-champ");
  fillSelect(
    monnaie,
    state.monnaies.map((m) => ({ value: m.id, label: `${m.nom} (${m.symbole})` }))
  );
  // UNE SEULE MONNAIE : le champ n'a rien à demander et disparaît. Il revient
  // le jour où une seconde devise existe — c'est alors une vraie question.
  document.getElementById("objectif-ligne-monnaie").style.display =
    state.monnaies.length > 1 ? "" : "none";
}

/**
 * Ce que le formulaire montre dépend de ce qu'il mesure.
 *
 * DEUX CHAMPS SUIVENT LA MESURE : la CADENCE, qui ne veut rien dire pour un
 * rapport (un montant moyen ne double pas quand la période double), et l'UNITÉ
 * de la cible, qui dit en quoi le nombre qu'on tape est libellé. Laisser les
 * deux fixes obligeait à deviner si « 40 » voulait dire 40 €, 40 % ou 40 fois.
 */
function majChampsObjectif() {
  const mesure = document.getElementById("objectif-mesure").value;
  const cadence = document.getElementById("objectif-cadence").value;
  objRemplirCategories();
  document.getElementById("objectif-ligne-cadence").style.display = objMesureCumule(
    mesure
  )
    ? ""
    : "none";

  const monnaieId = Number(document.getElementById("objectif-monnaie-champ").value);
  let unite;
  if (mesure === "part_depenses") unite = "%";
  else if (objMesureEstMonetaire(mesure)) unite = symboleMonnaie(monnaieId) || "";
  else unite = t("dépenses");
  const suffixe = objMesureCumule(mesure)
    ? ` ${cadence === "semaine" ? t("par semaine") : t("par mois")}`
    : "";
  document.getElementById("objectif-cible-unite").textContent = `${unite}${suffixe}`;
}

function objOuvrirEditeur(objectif) {
  document.getElementById("objectif-editeur-titre").textContent = objectif
    ? t("Modifier l'objectif")
    : t("Nouvel objectif");
  document.getElementById("objectif-id").value = objectif ? objectif.id : "";
  document.getElementById("objectif-nom").value = objectif ? objectif.nom : "";
  document.getElementById("objectif-mesure").value = objectif ? objectif.mesure : "nombre";
  document.getElementById("objectif-cadence").value = objectif ? objectif.cadence : "mois";
  document.getElementById("objectif-sens").value = objectif ? objectif.sens : "max";
  document.getElementById("objectif-cible").value = objectif ? objectif.cible : "";
  document.getElementById("objectif-monnaie-champ").value = String(
    objectif ? objectif.monnaie_id : objMonnaieId
  );
  document.getElementById("objectif-visible").checked = objectif
    ? objectif.visible_dashboard
    : true;
  // APRÈS la liste des monnaies (le suffixe de la cible lit son symbole) et
  // AVANT la catégorie : `majChampsObjectif` reconstruit la liste des
  // catégories, et la poser plus tôt la ferait effacer.
  majChampsObjectif();
  document.getElementById("objectif-categorie").value =
    objectif && objectif.categorie_id ? String(objectif.categorie_id) : "";
  document.getElementById("objectif-editeur").style.display = "";
  document.getElementById("objectif-nom").focus();
}

function objFermerEditeur() {
  document.getElementById("objectif-editeur").style.display = "none";
}

function objRenderListe() {
  const liste = document.getElementById("objectifs-liste");
  if (!liste) return;
  if (!objMesures.length) {
    liste.innerHTML = `<p class="hint">${t(
      "Aucun objectif pour cette monnaie. Le bouton ci-dessus en crée un."
    )}</p>`;
    return;
  }
  liste.innerHTML = objMesures
    .map((mesure) => objCarteHtml(mesure, { editable: true }))
    .join("");
}

async function loadObjectifs() {
  try {
    if (!state.monnaies.length) await refreshMonnaies();
    await refreshCategories();
    if (objMonnaieId == null || !state.monnaies.some((m) => m.id === objMonnaieId)) {
      objMonnaieId = state.monnaies[0] ? state.monnaies[0].id : null;
    }
    if (!objPeriode.annee) {
      const aujourdhui = new Date();
      objPeriode.annee = aujourdhui.getFullYear();
      objPeriode.mois = aujourdhui.getMonth() + 1;
    }
    if (objPeriodesConnues === null) {
      try {
        objPeriodesConnues = await apiFetch("/meta/periodes");
      } catch (err) {
        objPeriodesConnues = [];
      }
    }
    objRemplirContexte();
    if (objMonnaieId == null) return;

    const requete = `monnaie_id=${objMonnaieId}&annee=${objPeriode.annee}&mois=${objPeriode.mois}`;
    const [liste, mesures] = await Promise.all([
      apiFetch(`${OBJECTIFS_BASE}?monnaie_id=${objMonnaieId}`),
      apiFetch(`${OBJECTIFS_BASE}/mesures?${requete}`),
    ]);
    objObjectifs = liste;
    objMesures = mesures.objectifs;
    objRenderListe();
  } catch (err) {
    showMessage(err.message, "error");
  }
}

async function objEnregistrer() {
  const id = document.getElementById("objectif-id").value;
  const nom = document.getElementById("objectif-nom").value.trim();
  if (!nom) {
    showMessage(t("Donne un nom à cet objectif."), "error");
    return;
  }
  const categorie = document.getElementById("objectif-categorie").value;
  const corps = {
    nom,
    mesure: document.getElementById("objectif-mesure").value,
    cadence: document.getElementById("objectif-cadence").value,
    sens: document.getElementById("objectif-sens").value,
    cible: Number(document.getElementById("objectif-cible").value) || 0,
    // ZÉRO ÉLARGIT À TOUTES LES DÉPENSES sur une modification (cf.
    // schemas_objectifs.ObjectifUpdate) ; à la création, `null` dit la même
    // chose — `None` y veut bien dire « aucune catégorie ».
    categorie_id: categorie ? Number(categorie) : id ? 0 : null,
    monnaie_id:
      Number(document.getElementById("objectif-monnaie-champ").value) || objMonnaieId,
    visible_dashboard: document.getElementById("objectif-visible").checked,
  };
  try {
    if (id) {
      await apiFetch(`${OBJECTIFS_BASE}/${id}`, {
        method: "PUT",
        body: JSON.stringify(corps),
      });
    } else {
      await apiFetch(OBJECTIFS_BASE, { method: "POST", body: JSON.stringify(corps) });
    }
    objFermerEditeur();
    showMessage(t("Objectif enregistré"), "success");
    await loadObjectifs();
  } catch (err) {
    showMessage(traduireMessageServeur(err.message), "error");
  }
}

async function objSupprimer(id) {
  const mesure = objMesures.find((m) => m.objectif_id === Number(id));
  const nom = mesure ? mesure.nom : "";
  if (!confirm(`${t("Supprimer l'objectif")} « ${nom} » ?`)) return;
  try {
    await apiFetch(`${OBJECTIFS_BASE}/${id}`, { method: "DELETE" });
    await loadObjectifs();
  } catch (err) {
    showMessage(traduireMessageServeur(err.message), "error");
  }
}

/* ---------- Les écouteurs de l'onglet ---------- */

document.getElementById("btn-objectif-nouveau")?.addEventListener("click", () =>
  objOuvrirEditeur(null)
);
document.getElementById("btn-objectif-annuler")?.addEventListener("click", objFermerEditeur);
document.getElementById("btn-objectif-enregistrer")?.addEventListener("click", objEnregistrer);
document.getElementById("objectif-mesure")?.addEventListener("change", majChampsObjectif);
document.getElementById("objectif-cadence")?.addEventListener("change", majChampsObjectif);
document
  .getElementById("objectif-monnaie-champ")
  ?.addEventListener("change", majChampsObjectif);

["obj-monnaie", "obj-annee", "obj-mois"].forEach((id) => {
  document.getElementById(id)?.addEventListener("change", (e) => {
    const valeur = Number(e.target.value);
    if (id === "obj-monnaie") objMonnaieId = valeur;
    if (id === "obj-annee") objPeriode.annee = valeur;
    if (id === "obj-mois") objPeriode.mois = valeur;
    loadObjectifs();
  });
});

// UN SEUL ÉCOUTEUR DÉLÉGUÉ sur la liste, posé une fois : elle est réécrite à
// chaque rendu, et recâbler chaque bouton y laisserait un écouteur de plus à
// chaque passage (cf. le piège documenté de `creerMenuCases`, app.js).
document.getElementById("objectifs-liste")?.addEventListener("click", (e) => {
  const modifier = e.target.closest("[data-objectif-modifier]");
  if (modifier) {
    const objectif = objObjectifs.find(
      (o) => o.id === Number(modifier.dataset.objectifModifier)
    );
    if (objectif) objOuvrirEditeur(objectif);
    return;
  }
  const supprimer = e.target.closest("[data-objectif-supprimer]");
  if (supprimer) objSupprimer(supprimer.dataset.objectifSupprimer);
});

/* ---------- La greffe du dashboard ----------
 *
 * CE QUI SE POSE LÀ-BAS, ET CE QUI RESTE ICI. Le dashboard ne montre que les
 * objectifs COCHÉS (`visible_dashboard`), sur la monnaie de son onglet et la
 * période de son sélecteur. Ceux qu'on suit de loin restent sur leur page :
 * un bloc qui grandit sans fin sous les graphes finirait par les repousser hors
 * de l'écran, et ce sont eux qu'on vient voir.
 *
 * LE CONTENEUR EST RÉSERVÉ PAR LE NOYAU (`#dashboard-objectifs`, sous la
 * légende), comme `#flux-remboursements-actions` l'est pour « Suivi des
 * remboursements » : une extension qui fabriquerait son propre bloc devrait
 * décider où l'insérer, et se tromperait le jour où la page change.
 *
 * LA GREFFE SE DÉFAIT TOUTE SEULE : `estActive` est consulté à CHAQUE rendu, et
 * le bloc est vidé dès que l'extension s'éteint — éteindre une extension ne
 * recharge pas la page.
 */

async function objRendreDashboard(annee, mois) {
  const bloc = document.getElementById("dashboard-objectifs");
  if (!bloc) return;
  if (!BudgetApp.extensions.estActive("objectifs")) {
    bloc.innerHTML = "";
    bloc.style.display = "none";
    return;
  }
  const monnaieId = state.dashboardMonnaieId;
  if (monnaieId == null) {
    bloc.innerHTML = "";
    bloc.style.display = "none";
    return;
  }
  try {
    // LA VUE ANNÉE N'ENVOIE PAS DE MOIS, comme partout ailleurs : `mois` absent
    // veut dire l'année entière (cf. soldes._filtre_periode), et la cadence
    // fait le reste — un objectif mensuel y vaut douze unités.
    const enAnnee = state.dashboardPeriode.vue === "annee";
    const requete =
      `monnaie_id=${monnaieId}&annee=${annee}&dashboard=true` +
      (enAnnee ? "" : `&mois=${mois}`);
    const data = await apiFetch(`${OBJECTIFS_BASE}/mesures?${requete}`);
    if (!data.objectifs.length) {
      bloc.innerHTML = "";
      bloc.style.display = "none";
      return;
    }
    bloc.style.display = "";
    bloc.innerHTML = `
      <h3>${t("Objectifs")}<i class="info-bulle" tabindex="0"
          data-info-cle="objectifs.dashboard">i</i></h3>
      <div class="obj-liste obj-liste-dashboard">
        ${data.objectifs.map((mesure) => objCarteHtml(mesure)).join("")}
      </div>`;
    // Les deux passes de textes, dans cet ordre : la pastille « i » qu'on vient
    // d'écrire porte une clé, pas une phrase (cf. frontend/textes.js).
    appliquerTextes(bloc);
    traduireDomStatique(bloc);
  } catch (err) {
    // UN OBJECTIF QUI NE SE LIT PAS NE DOIT PAS EMPORTER LE DASHBOARD : le bloc
    // se tait, les chiffres du mois restent affichés.
    bloc.innerHTML = "";
    bloc.style.display = "none";
  }
}

// L'enveloppe, posée une seule fois. `loadDashboardData` est résolue dans la
// portée globale à chaque appel : réassigner la variable suffit à ce que le
// sélecteur de période appelle la nouvelle (cf. extensions/README.md).
if (typeof loadDashboardData === "function" && !window.objDashboardGreffe) {
  const chargerOrigine = loadDashboardData;
  window.objDashboardGreffe = true;
  window.loadDashboardData = async function (annee, mois) {
    await chargerOrigine.apply(this, arguments);
    await objRendreDashboard(annee, mois);
  };
}

// L'enregistrement auprès du noyau, en FIN de fichier : `loadObjectifs` doit
// exister au moment où on la référence. Le chargeur est rappelé à chaque
// ouverture de l'onglet — les dépenses ont pu changer depuis.
BudgetApp.extensions.enregistrer("objectifs", { chargeur: loadObjectifs });
