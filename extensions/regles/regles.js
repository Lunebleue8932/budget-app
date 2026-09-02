/* Extension « Règles de catégorisation ».
 *
 * Ce fichier s'exécute dans la portée globale de la page, après l'injection de
 * page.html : tout ce que app.js expose lui est accessible (apiFetch, state,
 * t, showMessage, fillCategoriesSelect…), et les éléments sur lesquels il pose
 * ses écouteurs existent déjà (cf. extensions/README.md).
 *
 * Le MOTEUR d'évaluation, lui, est resté dans le noyau : c'est l'import qui
 * classe une ligne pendant qu'il la lit. Ce que cette extension apporte, c'est
 * l'écran qui écrit les règles — et, quand elle est éteinte, l'import cesse de
 * les consulter (services/import_bancaire.ContexteImport).
 */

const OPERATEURS_REGLE = ["est", "n'est pas", "contient", "ne contient pas"];
const CHAMPS_REGLE = [
  ["nature", "Nature / libellé"],
  ["categorie_banque", "Catégorie bancaire"],
  ["compte_banque", "Compte bancaire"],
];

let reglesChargees = [];
// Brouillon de la règle en cours d'édition : les groupes ne sont écrits en
// base qu'à l'enregistrement, l'éditeur travaille sur cette structure.
let regleBrouillonGroupes = [];


// Le menu de types de l'éditeur est rempli depuis la table : les libellés sont
// renommables, seule la valeur (le `code`) est stable.
function remplirSelecteurTypesRegle() {
  const select = document.getElementById("regle-type");
  const precedent = select.value;
  select.innerHTML = state.typesOperation
    // Les types internes (titres) ne se posent pas par règle : il leur
    // manquerait le titre, la quantité et le prix.
    .filter((t) => !t.interne)
    // Les deux types de prêt appartiennent à l'extension « Prêts » : une règle
    // ne doit pas pouvoir poser un type auquel aucun écran ne donne accès.
    // `pretsAccessibles` vient du noyau (app.js), toujours chargé avant nous.
    .filter((t) => pretsAccessibles() || !TYPES_DE_PRET.has(t.code))
    .map((t) => `<option value="${t.code}">${t.nom}</option>`)
    .join("");
  if (precedent) select.value = precedent;
}

function conditionVide() {
  return { champ: "nature", operateur: "contient", valeur: "" };
}

function groupeVide() {
  return { operateur: "ET", conditions: [conditionVide()] };
}

async function loadRegles() {
  try {
    reglesChargees = await apiFetch("/regles-categorisation");
    // L'éditeur propose des catégories et des comptes : ils ont pu changer
    // depuis la dernière visite de cet écran.
    await refreshComptes();
    await refreshCategories();
    renderRegles();
  } catch (err) {
    showMessage(err.message, "error");
  }
}

// Les deux vues montrent les mêmes règles ; on redessine les deux et on laisse
// l'affichage décider laquelle se voit. Redessiner seulement la vue active
// obligerait chaque bascule à se demander si l'autre est à jour.
function renderRegles() {
  renderReglesListe();
  renderReglesGalerie();
}

function libelleConditionRegle(condition) {
  // `champs` (pluriel) : ancienne forme, avant le passage au champ unique.
  const champs = condition.champ ? [condition.champ] : condition.champs || [];
  const libelle = champs
    .map((c) => (CHAMPS_REGLE.find(([v]) => v === c) || [c, c])[1])
    .join(` ${t("ou")} `);
  return `${t(libelle)} ${t(condition.operateur)} « ${condition.valeur} »`;
}

function resumeRegle(regle) {
  const groupes = (regle.conditions.groupes || []).map((groupe) => {
    const conds = groupe.conditions.map(libelleConditionRegle);
    return conds.length > 1 ? `(${conds.join(` ${t(groupe.operateur)} `)})` : conds[0];
  });
  return groupes.join(` ${t(regle.conditions.operateur)} `);
}

function actionRegleHtml(regle) {
  const libelleType = libelleTypeOperation(regle.type_code);
  if (regle.type_code === "virement") {
    // Le compte en face fait partie de l'action : sans lui la ligne reste
    // incomplète à l'import, autant que ça se lise depuis la liste.
    return regle.compte_autre_id != null
      ? `${libelleType}, avec « ${nomCompte(regle.compte_autre_id)} » en face`
      : `${libelleType} <span class="badge-partiel">${t(
          "compte en face à renseigner à l'import"
        )}</span>`;
  }
  if (!TYPES_CATEGORIE_LIBRE.has(regle.type_code)) return libelleType;
  return regle.categorie_id != null
    ? `${libelleType}, catégorie « ${nomCategorie(regle.categorie_id)} »`
    : libelleType;
}

function renderReglesListe() {
  const bloc = document.getElementById("regles-liste");
  bloc.innerHTML = "";
  if (reglesChargees.length === 0) {
    bloc.innerHTML =
      '<p class="hint">Aucune règle pour le moment : les lignes importées resteront à classer à la main.</p>';
    return;
  }

  reglesChargees.forEach((regle, i) => {
    const carte = document.createElement("div");
    carte.className = "regle-carte" + (regle.actif ? "" : " regle-inactive");
    carte.dataset.index = i;
    carte.innerHTML = `
      <div class="regle-carte-ordre" title="Glisse pour changer l'ordre">
        <span class="regle-poignee" aria-hidden="true">⠿</span>
        <span class="regle-rang">${i + 1}</span>
      </div>
      <div class="regle-carte-corps">
        <div class="regle-carte-titre">
          ${regle.nom}
          ${regle.actif ? "" : '<span class="badge-aucun">inactive</span>'}
        </div>
        <div class="regle-carte-conditions">${t("Si")} ${resumeRegle(regle)}</div>
        <div class="regle-carte-action">→ ${actionRegleHtml(regle)}</div>
        ${badgeChainageHtml(regle)}
      </div>
      <div class="regle-carte-actions">
        <button type="button" data-action="modifier">${t("Modifier")}</button>
        <button type="button" data-action="supprimer" class="danger">${t("Supprimer")}</button>
      </div>
    `;

    cablerGlisserDeposerRegle(carte);
    carte.querySelector("[data-action='modifier']").addEventListener("click", () => ouvrirEditeurRegle(regle));
    carte.querySelector("[data-action='supprimer']").addEventListener("click", async () => {
      if (!confirm(`Supprimer la règle « ${regle.nom} » ?`)) return;
      try {
        await apiFetch(`/regles-categorisation/${regle.id}`, { method: "DELETE" });
        showMessage(t("Règle supprimée"), "success");
        fermerEditeurRegle();
        await loadRegles();
      } catch (err) {
        showMessage(err.message, "error");
      }
    });

    bloc.appendChild(carte);
  });
}

/* ----- Ordre des règles : glisser-déposer ----- */

// L'ordre EST la sémantique (première règle qui correspond gagne) : le
// réorganiser doit être direct. Deux flèches obligeaient à autant de clics que
// de rangs à franchir, et à relire le numéro entre chaque ; on attrape
// maintenant la carte et on la pose où elle va.
//
// HTML5 natif plutôt qu'une bibliothèque : la liste est courte, verticale, et
// n'a besoin ni de défilement automatique ni de multi-sélection.
let regleGlisseeIndex = null;

function cablerGlisserDeposerRegle(carte) {
  // Déplaçable par sa poignée seulement (⠿, à gauche du rang) : sans cela,
  // le nom de la règle et le résumé de ses conditions ne pouvaient pas être
  // sélectionnés — la carte entière avalait le glissement de la souris.
  rendreDeplacableParPoignee(carte, ".regle-carte-ordre");
  carte.addEventListener("dragstart", (e) => {
    regleGlisseeIndex = Number(carte.dataset.index);
    carte.classList.add("regle-carte-glissee");
    e.dataTransfer.effectAllowed = "move";
    // Firefox n'amorce pas le glisser sans données attachées.
    e.dataTransfer.setData("text/plain", String(regleGlisseeIndex));
  });

  carte.addEventListener("dragend", () => {
    regleGlisseeIndex = null;
    document
      .querySelectorAll(".regle-carte-glissee, .regle-carte-cible-avant, .regle-carte-cible-apres")
      .forEach((el) =>
        el.classList.remove(
          "regle-carte-glissee",
          "regle-carte-cible-avant",
          "regle-carte-cible-apres"
        )
      );
  });

  carte.addEventListener("dragover", (e) => {
    if (regleGlisseeIndex === null) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    // Le trait se place au-dessus ou en dessous selon la moitié survolée :
    // sans lui, on ne sait pas où la carte va atterrir avant de lâcher.
    const rect = carte.getBoundingClientRect();
    const avant = e.clientY < rect.top + rect.height / 2;
    carte.classList.toggle("regle-carte-cible-avant", avant);
    carte.classList.toggle("regle-carte-cible-apres", !avant);
  });

  carte.addEventListener("dragleave", () => {
    carte.classList.remove("regle-carte-cible-avant", "regle-carte-cible-apres");
  });

  carte.addEventListener("drop", (e) => {
    if (regleGlisseeIndex === null) return;
    e.preventDefault();
    const rect = carte.getBoundingClientRect();
    const avant = e.clientY < rect.top + rect.height / 2;
    const cible = Number(carte.dataset.index) + (avant ? 0 : 1);
    deposerRegle(regleGlisseeIndex, cible);
  });
}

// `cible` est la position d'insertion AVANT retrait de la carte déplacée : on
// décale d'un rang quand elle vient d'au-dessus, sinon déposer une carte juste
// sous sa voisine ne la déplacerait pas.
async function deposerRegle(depuis, cible) {
  const destination = cible > depuis ? cible - 1 : cible;
  if (destination === depuis) return;
  const ids = reglesChargees.map((r) => r.id);
  const [deplace] = ids.splice(depuis, 1);
  ids.splice(destination, 0, deplace);
  try {
    await apiFetch("/regles-categorisation/reordonner", {
      method: "PUT",
      body: JSON.stringify({ ids }),
    });
    await loadRegles();
  } catch (err) {
    showMessage(err.message, "error");
  }
}

function renderRegleGroupes() {
  const bloc = document.getElementById("regle-groupes");
  bloc.innerHTML = "";

  regleBrouillonGroupes.forEach((groupe, iGroupe) => {
    const carte = document.createElement("div");
    carte.className = "regle-groupe";

    const entete = document.createElement("div");
    entete.className = "regle-groupe-entete";
    entete.innerHTML = `
      <span class="regle-groupe-titre">Groupe ${iGroupe + 1}</span>
      <label>Combiner avec
        <select data-role="connecteur">
          <option value="ET" ${groupe.operateur === "ET" ? "selected" : ""}>ET</option>
          <option value="OU" ${groupe.operateur === "OU" ? "selected" : ""}>OU</option>
        </select>
      </label>
      <button type="button" class="danger" data-role="supprimer-groupe" ${
        regleBrouillonGroupes.length === 1 ? "disabled" : ""
      }>Supprimer le groupe</button>
    `;
    entete.querySelector("[data-role='connecteur']").addEventListener("change", (e) => {
      groupe.operateur = e.target.value;
    });
    entete.querySelector("[data-role='supprimer-groupe']").addEventListener("click", () => {
      regleBrouillonGroupes.splice(iGroupe, 1);
      renderRegleGroupes();
    });
    carte.appendChild(entete);

    groupe.conditions.forEach((condition, iCondition) => {
      const ligne = document.createElement("div");
      ligne.className = "regle-condition";

      // Un seul champ par condition : des boutons radio, qui rendent
      // l'exclusivité évidente et gèrent la désélection automatiquement.
      // Pour viser plusieurs champs, on ajoute des conditions dans un groupe OU.
      // `name` unique par condition, sinon toutes les lignes du formulaire
      // partageraient le même groupe radio.
      const nomGroupeRadio = `regle-champ-${iGroupe}-${iCondition}`;
      const champsHtml = CHAMPS_REGLE.map(
        ([valeur, label]) => `
          <label class="regle-champ-case">
            <input type="radio" name="${nomGroupeRadio}" value="${valeur}" ${
          condition.champ === valeur ? "checked" : ""
        } />
            ${label}
          </label>`
      ).join("");

      ligne.innerHTML = `
        <div class="regle-condition-champs">${champsHtml}</div>
        <select data-role="operateur">
          ${OPERATEURS_REGLE.map(
            (o) => `<option value="${o}" ${o === condition.operateur ? "selected" : ""}>${o}</option>`
          ).join("")}
        </select>
        <input type="text" data-role="valeur" placeholder="ex. PRET" value="${(condition.valeur || "").replace(/"/g, "&quot;")}" />
        <button type="button" class="danger" data-role="supprimer-condition" ${
          groupe.conditions.length === 1 ? "disabled" : ""
        }>×</button>
      `;

      ligne.querySelectorAll(".regle-condition-champs input").forEach((radio) => {
        radio.addEventListener("change", () => {
          if (radio.checked) condition.champ = radio.value;
        });
      });
      ligne.querySelector("[data-role='operateur']").addEventListener("change", (e) => {
        condition.operateur = e.target.value;
      });
      ligne.querySelector("[data-role='valeur']").addEventListener("input", (e) => {
        condition.valeur = e.target.value;
      });
      ligne.querySelector("[data-role='supprimer-condition']").addEventListener("click", () => {
        groupe.conditions.splice(iCondition, 1);
        renderRegleGroupes();
      });

      carte.appendChild(ligne);
    });

    const ajout = document.createElement("div");
    ajout.className = "actions";
    ajout.innerHTML = '<button type="button">+ Ajouter une condition</button>';
    ajout.querySelector("button").addEventListener("click", () => {
      groupe.conditions.push(conditionVide());
      renderRegleGroupes();
    });
    carte.appendChild(ajout);

    bloc.appendChild(carte);
  });
}

// Le type pilote la liste des catégories : les types à catégorie imposée n'en
// proposent aucune. La valeur choisie est conservée en mémoire le temps de la
// session d'édition, pour qu'un aller-retour entre deux types ne la perde pas ;
// elle n'est envoyée que si le type final l'accepte.
let regleCategorieMemorisee = "";

// Le compte en face n'existe que pour le virement interne : seul type qui
// touche DEUX comptes, dont le relevé ne nomme jamais que le premier.
function majVisibiliteCompteAutreRegle() {
  const type = document.getElementById("regle-type").value;
  document.getElementById("regle-compte-autre-bloc").style.display =
    type === "virement" ? "" : "none";
}

function majVisibiliteCategorieRegle() {
  majVisibiliteCompteAutreRegle();
  const type = document.getElementById("regle-type").value;
  const bloc = document.getElementById("regle-categorie-bloc");
  const info = document.getElementById("regle-categorie-imposee");
  const select = document.getElementById("regle-categorie");
  const libre = TYPES_CATEGORIE_LIBRE.has(type);

  if (libre) {
    bloc.style.display = "";
    info.style.display = "none";
    // Restaure le choix précédent, s'il est toujours proposé.
    if (regleCategorieMemorisee && select.querySelector(`option[value="${regleCategorieMemorisee}"]`)) {
      select.value = regleCategorieMemorisee;
    }
  } else {
    // Mémorise avant de masquer, puis neutralise : le serveur ignore de toute
    // façon la catégorie pour ces types (cf. _normaliser_categorie).
    if (select.value) regleCategorieMemorisee = select.value;
    select.value = "";
    bloc.style.display = "none";
    info.textContent = `« ${libelleTypeOperation(type)} » ne porte pas de catégorie : le type est à lui seul la classification.`;
    info.style.display = "";
  }
}

function ouvrirEditeurRegle(regle = null) {
  document.getElementById("regle-editeur").style.display = "";
  document.getElementById("regle-editeur-titre").textContent = regle
    ? "Modifier la règle"
    : "Nouvelle règle";
  document.getElementById("regle-id").value = regle ? regle.id : "";
  document.getElementById("regle-nom").value = regle ? regle.nom : "";
  document.getElementById("regle-connecteur").value = regle ? regle.conditions.operateur : "ET";
  document.getElementById("regle-actif").checked = regle ? regle.actif : true;
  // Cochée par défaut sur une règle neuve : c'est le comportement qu'on attend
  // sans y penser (« ma règle décide, point »).
  document.getElementById("regle-arreter-apres").checked = regle ? regle.arreter_apres : true;
  remplirSelecteurTypesRegle();
  document.getElementById("regle-type").value = regle ? regle.type_code : "classique";

  _refillPreservingSelection(document.getElementById("regle-categorie"), (el) =>
    fillCategoriesSelect(el, state.categories, { keepFirst: true })
  );
  regleCategorieMemorisee = regle && regle.categorie_id != null ? String(regle.categorie_id) : "";
  document.getElementById("regle-categorie").value = regleCategorieMemorisee;

  _refillPreservingSelection(document.getElementById("regle-compte-autre"), (el) =>
    fillComptesSelect(el, state.comptes, { keepFirst: true })
  );
  document.getElementById("regle-compte-autre").value =
    regle && regle.compte_autre_id != null ? String(regle.compte_autre_id) : "";

  majVisibiliteCategorieRegle();

  // Copie profonde : annuler ne doit rien laisser derrière dans la liste.
  regleBrouillonGroupes = regle
    ? JSON.parse(JSON.stringify(regle.conditions.groupes))
    : [groupeVide()];
  renderRegleGroupes();
  document.getElementById("regle-editeur").scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function fermerEditeurRegle() {
  document.getElementById("regle-editeur").style.display = "none";
  regleBrouillonGroupes = [];
}

document.getElementById("regle-type").addEventListener("change", majVisibiliteCategorieRegle);
document.getElementById("regle-categorie").addEventListener("change", (e) => {
  regleCategorieMemorisee = e.target.value;
});
document.getElementById("btn-regle-nouvelle").addEventListener("click", () => ouvrirEditeurRegle());
document.getElementById("btn-regle-annuler").addEventListener("click", fermerEditeurRegle);
document.getElementById("btn-regle-ajouter-groupe").addEventListener("click", () => {
  regleBrouillonGroupes.push(groupeVide());
  renderRegleGroupes();
});

document.getElementById("btn-regle-enregistrer").addEventListener("click", async () => {
  const nom = document.getElementById("regle-nom").value.trim();
  if (!nom) {
    showMessage(t("Donne un nom à la règle."), "error");
    return;
  }
  // Contrôles côté client pour un message immédiat et situé ; le serveur
  // revalide de toute façon la même chose (schemas.ConditionRegle).
  for (const groupe of regleBrouillonGroupes) {
    for (const condition of groupe.conditions) {
      if (!condition.champ) {
        showMessage(t("Chaque condition doit porter sur un champ."), "error");
        return;
      }
      if (!condition.valeur.trim()) {
        showMessage(t("Chaque condition doit avoir une valeur à comparer."), "error");
        return;
      }
    }
  }

  const type = document.getElementById("regle-type").value;
  // La catégorie n'est transmise que si le type l'accepte : basculer vers un
  // type à catégorie imposée l'outrepasse, sans avoir à la vider à la main.
  const categorieVal = TYPES_CATEGORIE_LIBRE.has(type)
    ? document.getElementById("regle-categorie").value
    : "";
  // Même règle pour le compte en face : seul un virement en porte un.
  const compteAutreVal =
    type === "virement" ? document.getElementById("regle-compte-autre").value : "";

  const payload = {
    nom,
    conditions: {
      operateur: document.getElementById("regle-connecteur").value,
      groupes: regleBrouillonGroupes,
    },
    type_id: idTypeOperation(type),
    categorie_id: categorieVal ? Number(categorieVal) : null,
    compte_autre_id: compteAutreVal ? Number(compteAutreVal) : null,
    actif: document.getElementById("regle-actif").checked,
    arreter_apres: document.getElementById("regle-arreter-apres").checked,
  };

  const id = document.getElementById("regle-id").value;
  try {
    if (id) {
      await apiFetch(`/regles-categorisation/${id}`, { method: "PUT", body: JSON.stringify(payload) });
      showMessage(t("Règle modifiée"), "success");
    } else {
      await apiFetch("/regles-categorisation", { method: "POST", body: JSON.stringify(payload) });
      showMessage(t("Règle créée"), "success");
    }
    fermerEditeurRegle();
    await loadRegles();
  } catch (err) {
    showMessage(err.message, "error");
  }
});


/* ---------- Vue galerie : des dossiers, pas un classement ----------
 *
 * L'ORDRE D'ÉVALUATION EST UNE PROPRIÉTÉ DES RÈGLES, pas de leur rangement.
 * Une quinzaine de règles dans une seule colonne se lisent mal ; les regrouper
 * par thème (« Courses », « Salaire », « Abonnements ») aide à retrouver la
 * bonne — mais un dossier ne fait jamais primer une règle sur une autre. Le
 * numéro affiché sur chaque carte reste son rang réel, et il ne bouge pas
 * quand on la range ailleurs. C'est pour cette raison qu'on ne peut PAS
 * réordonner depuis la galerie : ce qu'on y glisse, c'est l'appartenance à un
 * dossier, jamais la priorité.
 *
 * STOCKÉ SUR LE POSTE (localStorage), pas en base : un dossier n'est ni une
 * donnée du budget ni quelque chose dont l'import a besoin — c'est un confort
 * de lecture. Le mettre en base aurait obligé l'extension à emporter son
 * schéma, ce que le dépôt s'interdit (cf. extensions/README.md).
 */

const CLE_DOSSIERS_REGLES = "budget-app.regles.dossiers";
// Le dossier d'accueil : il n'est pas stocké, il se déduit de ce qui n'est
// rangé nulle part. Impossible à supprimer ou à renommer, donc, et une règle
// nouvelle s'y trouve sans qu'on ait rien à faire.
const DOSSIER_PAR_DEFAUT = "Autres";

let vueRegles = "liste";
// { dossiers: ["Courses", …], parRegle: { "<id de règle>": "Courses" } }
let dossiersRegles = { dossiers: [], parRegle: {} };

function chargerDossiersRegles() {
  try {
    const brut = JSON.parse(localStorage.getItem(CLE_DOSSIERS_REGLES) || "null");
    if (brut && Array.isArray(brut.dossiers) && brut.parRegle) {
      dossiersRegles = { dossiers: brut.dossiers, parRegle: brut.parRegle };
      return;
    }
  } catch (err) {
    // Contenu illisible (édité à la main, version antérieure) : on repart d'un
    // rangement vide plutôt que de casser l'écran. Aucune règle n'est perdue,
    // elles retombent toutes dans « Autres ».
    console.warn("Dossiers de règles illisibles, remis à zéro :", err);
  }
  dossiersRegles = { dossiers: [], parRegle: {} };
}

function enregistrerDossiersRegles() {
  localStorage.setItem(CLE_DOSSIERS_REGLES, JSON.stringify(dossiersRegles));
}

function dossierDeLaRegle(regle) {
  const nom = dossiersRegles.parRegle[String(regle.id)];
  // Un dossier supprimé entre deux visites ne doit pas faire disparaître ses
  // règles de l'écran : elles reviennent dans « Autres ».
  return nom && dossiersRegles.dossiers.includes(nom) ? nom : DOSSIER_PAR_DEFAUT;
}

function badgeChainageHtml(regle) {
  if (regle.arreter_apres) return "";
  return `<div class="regle-carte-chainage">${t(
    "↳ la lecture continue avec les règles suivantes"
  )}</div>`;
}

function basculerVueRegles(vue) {
  vueRegles = vue;
  document.getElementById("regles-liste").style.display = vue === "liste" ? "" : "none";
  document.getElementById("regles-galerie").style.display = vue === "galerie" ? "" : "none";
  document.querySelectorAll("[data-vue-regles]").forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.vueRegles === vue);
  });
}

function renderReglesGalerie() {
  const bloc = document.getElementById("regles-dossiers");
  bloc.innerHTML = "";

  // « Autres » en dernier : c'est le fourre-tout, pas la tête de liste.
  const noms = [...dossiersRegles.dossiers, DOSSIER_PAR_DEFAUT];
  const parDossier = new Map(noms.map((nom) => [nom, []]));
  reglesChargees.forEach((regle, i) => {
    parDossier.get(dossierDeLaRegle(regle)).push({ regle, rang: i + 1 });
  });

  noms.forEach((nom) => {
    const contenu = parDossier.get(nom);
    const estDefaut = nom === DOSSIER_PAR_DEFAUT;
    const boite = document.createElement("div");
    boite.className = "regle-dossier";
    boite.dataset.dossier = nom;
    boite.innerHTML = `
      <div class="regle-dossier-entete">
        <span class="regle-dossier-nom">${escapeHtml(nom)}</span>
        <span class="regle-dossier-compte">${contenu.length}</span>
        ${
          estDefaut
            ? ""
            : `<span class="regle-dossier-actions">
                 <button type="button" data-action="renommer">${t("Renommer")}</button>
                 <button type="button" data-action="supprimer" class="danger">${t(
                   "Supprimer"
                 )}</button>
               </span>`
        }
      </div>
      <div class="regle-dossier-corps"></div>
    `;

    const corps = boite.querySelector(".regle-dossier-corps");
    if (contenu.length === 0) {
      corps.innerHTML = `<p class="hint">${t("Glisse une règle ici.")}</p>`;
    }
    contenu.forEach(({ regle, rang }) => corps.appendChild(carteGalerie(regle, rang)));

    if (!estDefaut) {
      boite
        .querySelector("[data-action='renommer']")
        .addEventListener("click", () => renommerDossierRegles(nom));
      boite
        .querySelector("[data-action='supprimer']")
        .addEventListener("click", () => supprimerDossierRegles(nom));
    }
    cablerDepotDossier(boite, nom);
    bloc.appendChild(boite);
  });
}

// Volontairement PAS `.regle-carte` : les cartes de la liste sont glissables
// pour se réordonner, celles-ci pour changer de dossier. Deux gestes
// différents, deux classes différentes — sans quoi le glisser-déposer de la
// liste s'appliquerait ici et réécrirait l'ordre sans qu'on l'ait demandé.
function carteGalerie(regle, rang) {
  const carte = document.createElement("div");
  carte.className = "regle-vignette" + (regle.actif ? "" : " regle-inactive");
  carte.draggable = true;
  carte.dataset.regleId = regle.id;
  carte.innerHTML = `
    <div class="regle-vignette-entete">
      <span class="regle-rang" title="${t("Rang d'évaluation")}">${rang}</span>
      <span class="regle-vignette-nom">${escapeHtml(regle.nom)}</span>
      ${regle.actif ? "" : `<span class="badge-aucun">${t("inactive")}</span>`}
    </div>
    <div class="regle-carte-conditions">${t("Si")} ${resumeRegle(regle)}</div>
    <div class="regle-carte-action">→ ${actionRegleHtml(regle)}</div>
    ${badgeChainageHtml(regle)}
    <div class="regle-carte-actions">
      <button type="button" data-action="modifier">${t("Modifier")}</button>
    </div>
  `;
  carte.addEventListener("dragstart", (e) => {
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", String(regle.id));
  });
  carte
    .querySelector("[data-action='modifier']")
    .addEventListener("click", () => ouvrirEditeurRegle(regle));
  return carte;
}

function cablerDepotDossier(boite, nom) {
  boite.addEventListener("dragover", (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    boite.classList.add("regle-dossier-cible");
  });
  boite.addEventListener("dragleave", () => boite.classList.remove("regle-dossier-cible"));
  boite.addEventListener("drop", (e) => {
    e.preventDefault();
    boite.classList.remove("regle-dossier-cible");
    const id = e.dataTransfer.getData("text/plain");
    if (!id) return;
    if (nom === DOSSIER_PAR_DEFAUT) delete dossiersRegles.parRegle[id];
    else dossiersRegles.parRegle[id] = nom;
    enregistrerDossiersRegles();
    renderReglesGalerie();
  });
}

function renommerDossierRegles(ancien) {
  const nouveau = (prompt(t("Nouveau nom du dossier"), ancien) || "").trim();
  if (!nouveau || nouveau === ancien) return;
  if (nouveau === DOSSIER_PAR_DEFAUT || dossiersRegles.dossiers.includes(nouveau)) {
    showMessage(t("Un dossier porte déjà ce nom."), "error");
    return;
  }
  dossiersRegles.dossiers = dossiersRegles.dossiers.map((n) => (n === ancien ? nouveau : n));
  Object.keys(dossiersRegles.parRegle).forEach((id) => {
    if (dossiersRegles.parRegle[id] === ancien) dossiersRegles.parRegle[id] = nouveau;
  });
  enregistrerDossiersRegles();
  renderReglesGalerie();
}

// Supprimer un dossier ne supprime AUCUNE règle : elles retombent dans
// « Autres ». Un rangement n'a pas à emporter ce qu'il range.
function supprimerDossierRegles(nom) {
  if (!confirm(`${t("Supprimer le dossier")} « ${nom} » ? ${t("Ses règles reviendront dans « Autres ».")}`)) {
    return;
  }
  dossiersRegles.dossiers = dossiersRegles.dossiers.filter((n) => n !== nom);
  Object.keys(dossiersRegles.parRegle).forEach((id) => {
    if (dossiersRegles.parRegle[id] === nom) delete dossiersRegles.parRegle[id];
  });
  enregistrerDossiersRegles();
  renderReglesGalerie();
}

document.querySelectorAll("[data-vue-regles]").forEach((btn) => {
  btn.addEventListener("click", () => basculerVueRegles(btn.dataset.vueRegles));
});

document.getElementById("btn-regle-dossier-nouveau").addEventListener("click", () => {
  const nom = (prompt(t("Nom du nouveau dossier")) || "").trim();
  if (!nom) return;
  if (nom === DOSSIER_PAR_DEFAUT || dossiersRegles.dossiers.includes(nom)) {
    showMessage(t("Un dossier porte déjà ce nom."), "error");
    return;
  }
  dossiersRegles.dossiers.push(nom);
  enregistrerDossiersRegles();
  renderReglesGalerie();
});

chargerDossiersRegles();

// Le noyau rappelle ce chargeur à CHAQUE ouverture de la sous-page : les
// catégories, les comptes et les règles ont pu changer entre deux visites.
BudgetApp.extensions.enregistrer("regles", { chargeur: loadRegles });
