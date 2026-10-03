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

/* DEUX FAMILLES D'OPÉRATEURS, ET ELLES NE SE MÉLANGENT PAS : les quatre
 * premiers comparent du TEXTE, les six suivants des NOMBRES. Un champ n'admet
 * que ceux de sa famille — « la nature est supérieure à 50 » ne veut rien dire,
 * et « le montant contient 12 » non plus. Le serveur refuse la combinaison
 * (cf. constants.operateurs_admis) ; le menu ci-dessous ne la propose même pas.
 */
const OPERATEURS_TEXTE = ["est", "n'est pas", "contient", "ne contient pas"];
const OPERATEURS_NOMBRE = [
  "égal à",
  "différent de",
  "supérieur à",
  "supérieur ou égal à",
  "inférieur à",
  "inférieur ou égal à",
];
// Conservé sous son ancien nom : d'autres endroits du fichier le lisent pour
// afficher un opérateur, sans se soucier de sa famille.
const OPERATEURS_REGLE = [...OPERATEURS_TEXTE, ...OPERATEURS_NOMBRE];
const CHAMPS_REGLE = [
  ["nature", "Nature / libellé"],
  ["categorie_banque", "Catégorie bancaire"],
  ["compte_banque", "Compte bancaire"],
  // La colonne « Notes » du relevé, quand le preset la lit.
  ["notes", "Notes"],
  // LE MONTANT EST TOUJOURS POSITIF, comme partout dans l'app : le sens
  // (dépense / recette) est une colonne à part, jamais un signe. « supérieur à
  // 50 » veut donc dire « plus de 50 € en jeu », quel que soit le sens.
  ["montant", "Montant"],
];
const CHAMPS_REGLE_NUMERIQUES = new Set(["montant"]);

function operateursAdmis(champ) {
  return CHAMPS_REGLE_NUMERIQUES.has(champ) ? OPERATEURS_NOMBRE : OPERATEURS_TEXTE;
}

// Le type auquel la découpe est réservée : les autres portent une catégorie
// imposée, un montant dû ou une contrepartie (cf. crud.erreur_decoupes).
const TYPE_REGLE_DECOUPABLE = "classique";

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
    // Les deux types de prêt appartiennent à l'extension « Prêts », les deux
    // types remboursables à « Suivi des remboursements » : une règle ne doit
    // pas pouvoir poser un type auquel aucun écran ne donne accès.
    // `pretsAccessibles`/`suiviRemboursementsAccessible` viennent du noyau
    // (app.js), toujours chargé avant nous.
    .filter((t) => pretsAccessibles() || !TYPES_DE_PRET.has(t.code))
    .filter(
      (t) => suiviRemboursementsAccessible() || !TYPES_A_SUIVI_REMBOURSEMENT.has(t.code)
    )
    .map((t) => `<option value="${t.code}">${t.nom}</option>`)
    .join("");
  // LE TYPE EST FACULTATIF (migration 0071) : une règle qui ne fait que
  // renommer ne décide pas de ce qu'est la ligne, et laisse les suivantes le
  // faire. En tête de liste, comme partout où « ne pas changer » est proposé.
  select.insertAdjacentHTML(
    "afterbegin",
    `<option value="">${escapeHtml(t("— ne pas changer —"))}</option>`
  );
  if (precedent) select.value = precedent;
}

function conditionVide() {
  // `valeurs` est la forme canonique côté serveur : plusieurs mots-clés,
  // combinés en ET. `valeur` la suit (elle vaut le premier mot) pour les
  // opérateurs de texte, et porte le nombre pour les opérateurs numériques,
  // qui n'en comparent qu'un.
  return { champ: "nature", operateur: "contient", valeur: "", valeurs: [] };
}

/** Les mots-clés d'une condition, quelle que soit la forme où elle arrive. */
function motsClesCondition(condition) {
  if (Array.isArray(condition.valeurs) && condition.valeurs.length > 0) {
    return condition.valeurs;
  }
  const seul = (condition.valeur || "").trim();
  return seul ? [seul] : [];
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
    // LE RANGEMENT AVANT LE RENDU, et à CHAQUE ouverture : il vit maintenant
    // dans la base, laquelle peut changer sous l'application (panneau « Base de
    // données »). Le lire une fois au chargement du script aurait affiché, après
    // une bascule, les dossiers de la base précédente.
    await chargerDossiersRegles();
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

/**
 * La note de la règle sur sa carte, ou rien du tout.
 *
 * AU-DESSUS DES CONDITIONS, et non en bas de carte : c'est ce qu'on lit en
 * premier quand on cherche laquelle des vingt règles est celle qu'on veut.
 * Les conditions, elles, se relisent une fois la bonne trouvée.
 *
 * Rien n'est affiché quand la note est vide — c'est-à-dire pour toutes les
 * règles écrites avant qu'elle existe : une ligne vide sous chaque titre
 * aurait allongé la liste sans rien y ajouter.
 */
function descriptionRegleHtml(regle) {
  const note = (regle.description || "").trim();
  if (!note) return "";
  return `<div class="regle-carte-description">${escapeHtml(note)}</div>`;
}

function libelleConditionRegle(condition) {
  // `champs` (pluriel) : ancienne forme, avant le passage au champ unique.
  const champs = condition.champ ? [condition.champ] : condition.champs || [];
  const libelle = champs
    .map((c) => (CHAMPS_REGLE.find(([v]) => v === c) || [c, c])[1])
    .join(` ${t("ou")} `);
  // TOUS LES MOTS-CLÉS, séparés par « et » : une condition qui en porte trois
  // et n'en montrerait qu'un ferait passer une règle pour plus large qu'elle.
  const mots = motsClesCondition(condition)
    .map((mot) => `« ${mot} »`)
    .join(` ${t("et")} `);
  return `${t(libelle)} ${t(condition.operateur)} ${mots}`;
}

function resumeRegle(regle) {
  const groupes = (regle.conditions.groupes || []).map((groupe) => {
    const conds = groupe.conditions.map(libelleConditionRegle);
    return conds.length > 1 ? `(${conds.join(` ${t(groupe.operateur)} `)})` : conds[0];
  });
  return groupes.join(` ${t(regle.conditions.operateur)} `);
}

function actionRegleHtml(regle) {
  const principale = actionPrincipaleRegleHtml(regle);
  const autres = autresActionsRegle(regle);
  if (regle.sorties && regle.sorties.length) {
    autres.push(t("{n} sortie(s) conditionnelle(s)", { n: regle.sorties.length }));
  }

  if (!autres.length) return principale;
  return principale ? `${principale} · ${autres.join(" · ")}` : autres.join(" · ");
}

/* Les actions de la migration 0071, dans l'ordre de l'éditeur. */
function autresActionsRegle(regle) {
  const actions = [];
  if (regle.nature_remplacement) {
    actions.push(t("renommée « {nom} »", { nom: escapeHtml(regle.nature_remplacement) }));
  }
  if (regle.compte_id != null) {
    actions.push(t("sur « {compte} »", { compte: escapeHtml(nomCompte(regle.compte_id)) }));
  }
  if (regle.notes) actions.push(t("note « {note} »", { note: escapeHtml(regle.notes) }));
  if (regle.amortissement_mois) {
    actions.push(t("amortie sur {n} mois", { n: regle.amortissement_mois }));
  }
  if (regle.imprevue) actions.push(t("imprévue"));
  return actions;
}

function actionPrincipaleRegleHtml(regle) {
  // SANS TYPE, la règle ne classe pas : elle ne dit que ce qu'elle change. Sa
  // catégorie éventuelle vaudra si le type finalement retenu en admet une.
  if (!regle.type_code) {
    return regle.categorie_id != null
      ? t("catégorie « {nom} »", { nom: escapeHtml(nomCategorie(regle.categorie_id)) })
      : "";
  }
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
  // La découpe remplace la catégorie unique : elles répondent à la même
  // question, et la règle n'y répond jamais deux fois.
  if (regle.decoupes && regle.decoupes.length > 0) {
    const parts = regle.decoupes
      .map((part) => `${nomCategorie(part.categorie_id)} (${part.formule})`)
      .join(", ");
    return `${libelleType}, ${t("découpée")} : ${parts}`;
  }
  return regle.categorie_id != null
    ? `${libelleType}, catégorie « ${nomCategorie(regle.categorie_id)} »`
    : libelleType;
}

function renderReglesListe() {
  const bloc = document.getElementById("regles-liste");
  bloc.innerHTML = "";
  if (reglesChargees.length === 0) {
    bloc.innerHTML =
      `<p class="hint">${t(
        "Aucune règle pour le moment : les lignes importées resteront à classer à la main."
      )}</p>`;
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
        ${descriptionRegleHtml(regle)}
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

/* LE MÊME ÉDITEUR POUR LA DÉTECTION ET POUR CHAQUE SORTIE CONDITIONNELLE :
 * `bloc` est où l'écrire, `groupes` le brouillon qu'il modifie, et `prefixe`
 * rend uniques les noms de ses boutons radio et de ses éditeurs de mots-clés —
 * deux éditeurs dans le même formulaire se seraient sinon volé leurs cases. */
function renderRegleGroupes(
  bloc = document.getElementById("regle-groupes"),
  groupes = regleBrouillonGroupes,
  prefixe = ""
) {
  const rendre = () => renderRegleGroupes(bloc, groupes, prefixe);
  bloc.innerHTML = "";

  groupes.forEach((groupe, iGroupe) => {
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
        groupes.length === 1 ? "disabled" : ""
      }>Supprimer le groupe</button>
    `;
    entete.querySelector("[data-role='connecteur']").addEventListener("change", (e) => {
      groupe.operateur = e.target.value;
    });
    entete.querySelector("[data-role='supprimer-groupe']").addEventListener("click", () => {
      groupes.splice(iGroupe, 1);
      rendre();
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
      const nomGroupeRadio = `regle-champ-${prefixe}${iGroupe}-${iCondition}`;
      const champsHtml = CHAMPS_REGLE.map(
        ([valeur, label]) => `
          <label class="regle-champ-case">
            <input type="radio" name="${nomGroupeRadio}" value="${valeur}" ${
          condition.champ === valeur ? "checked" : ""
        } />
            ${label}
          </label>`
      ).join("");

      // Le menu d'opérateurs et le champ de valeur SUIVENT le champ choisi :
      // texte ou nombre, ce ne sont ni les mêmes comparaisons ni la même
      // saisie. Redessinés à chaque changement de champ (cf. plus bas), plutôt
      // que d'afficher dix opérateurs dont six ne s'appliqueraient pas.
      const optionsOperateur = (champ, choisi) =>
        operateursAdmis(champ)
          .map((o) => `<option value="${o}" ${o === choisi ? "selected" : ""}>${o}</option>`)
          .join("");
      const estNumerique = CHAMPS_REGLE_NUMERIQUES.has(condition.champ);

      // LA VALEUR SE SAISIT DE DEUX FAÇONS, selon la famille de l'opérateur :
      //
      //   - un NOMBRE, dans un champ ordinaire — « supérieur à 30 et à 50 » se
      //     dit « supérieur à 50 », une liste n'y ajouterait qu'un piège ;
      //   - des MOTS-CLÉS, dans l'éditeur à jetons du noyau, celui-là même que
      //     l'import utilise pour le vocabulaire des colonnes « Sens » et
      //     « État ». Ils se combinent en ET : « contient CARREFOUR et
      //     contient MARKET » est UN test, et l'écrire en deux conditions
      //     n'ajoutait qu'une ligne de formulaire — à cinq mots-clés, le
      //     groupe devenait illisible.
      const idJetons = `regle-mots-${prefixe}${iGroupe}-${iCondition}`;
      const saisieValeur = estNumerique
        ? `<input type="number" step="0.01" min="0" data-role="valeur"
                  placeholder="${t("ex. 50")}"
                  value="${(condition.valeur || "").replace(/"/g, "&quot;")}" />`
        : `<div class="regle-condition-mots" data-role="mots">
             <div class="import-vocabulaire-champ" data-vocabulaire="mots">
               <div class="import-vocabulaire-entete">
                 <div class="import-vocabulaire-saisie">
                   <input type="text" spellcheck="false" placeholder="${t("ex. PRET")}" />
                   <button type="button" class="import-vocabulaire-ajouter"
                           title="${t("Ajouter ce mot-clé")}"
                           aria-label="${t("Ajouter ce mot-clé")}">+</button>
                 </div>
                 <details class="import-vocabulaire-actualisation">
                   <summary>${t("Retirer")}</summary>
                   <div class="import-vocabulaire-menu" data-role="menu"></div>
                 </details>
               </div>
               <div class="import-vocabulaire-jetons" data-role="jetons"></div>
             </div>
           </div>`;

      ligne.innerHTML = `
        <div class="regle-condition-champs">${champsHtml}</div>
        <select data-role="operateur">
          ${optionsOperateur(condition.champ, condition.operateur)}
        </select>
        ${saisieValeur}
        <button type="button" class="danger" data-role="supprimer-condition" ${
          groupe.conditions.length === 1 ? "disabled" : ""
        }>×</button>
      `;

      if (!estNumerique) {
        // UN ÉDITEUR PAR CONDITION, redéclaré à chaque rendu : cette ligne est
        // reconstruite dès qu'on touche à un champ voisin, et un éditeur qui
        // garderait l'ancien nœud n'écouterait plus rien (cf.
        // creerEditeurMotsCles, qui remplace un groupe posé sur un autre
        // élément).
        //
        // `onChange` REÉCRIT LE BROUILLON : c'est lui qui part au serveur, et
        // aller relire les jetons au moment d'enregistrer aurait ouvert un
        // écart entre ce qu'on voit et ce qu'on envoie.
        creerEditeurMotsCles(idJetons, {
          conteneur: ligne.querySelector("[data-role='mots']"),
          libelles: { mots: t("Mots-clés") },
          vide: "Aucun mot-clé : la condition ne compare rien.",
          onChange: (_cle, mots) => {
            condition.valeurs = [...mots];
            // `valeur` suit, pour rester lisible par une version de l'app
            // antérieure à `valeurs` — c'est ce que le serveur fait de son
            // côté (cf. schemas._valider_valeurs).
            condition.valeur = mots[0] || "";
          },
        });
        chargerMotsCles(idJetons, { mots: motsClesCondition(condition) });
      }

      ligne.querySelectorAll(".regle-condition-champs input").forEach((radio) => {
        radio.addEventListener("change", () => {
          if (!radio.checked) return;
          const changeDeFamille =
            CHAMPS_REGLE_NUMERIQUES.has(radio.value) !==
            CHAMPS_REGLE_NUMERIQUES.has(condition.champ);
          condition.champ = radio.value;
          if (changeDeFamille) {
            // L'opérateur d'avant n'existe plus dans la nouvelle famille :
            // le garder aurait envoyé au serveur une condition qu'il refuse.
            // On repart du premier opérateur admis, et de la valeur vide —
            // « PRET » ne veut rien dire comme montant, et 50 ne veut rien
            // dire comme libellé.
            condition.operateur = operateursAdmis(radio.value)[0];
            condition.valeur = "";
            condition.valeurs = [];
            rendre();
          }
        });
      });
      ligne.querySelector("[data-role='operateur']").addEventListener("change", (e) => {
        condition.operateur = e.target.value;
      });
      // Seul le champ NUMÉRIQUE écrit ici : les mots-clés passent par
      // `onChange` de leur éditeur.
      const champValeur = ligne.querySelector("input[data-role='valeur']");
      if (champValeur) {
        champValeur.addEventListener("input", (e) => {
          condition.valeur = e.target.value;
          condition.valeurs = [];
        });
      }
      ligne.querySelector("[data-role='supprimer-condition']").addEventListener("click", () => {
        groupe.conditions.splice(iCondition, 1);
        rendre();
      });

      carte.appendChild(ligne);
    });

    const ajout = document.createElement("div");
    ajout.className = "actions";
    ajout.innerHTML = '<button type="button">+ Ajouter une condition</button>';
    ajout.querySelector("button").addEventListener("click", () => {
      groupe.conditions.push(conditionVide());
      rendre();
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
  majVisibiliteDecoupeRegle();
  const type = document.getElementById("regle-type").value;
  const info = document.getElementById("regle-categorie-imposee");
  const select = document.getElementById("regle-categorie");
  // La découpe REMPLACE la catégorie unique : montrer les deux laisserait
  // croire qu'une règle peut classer deux fois la même ligne.
  // Sans type (« ne pas changer »), la catégorie reste proposée : elle vaudra à
  // l'import si le type finalement retenu en admet une.
  const libre = (!type || TYPES_CATEGORIE_LIBRE.has(type)) && !regleDecoupeEstActive();

  if (libre) {
    select.style.display = "";
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
    select.style.display = "none";
    // Deux raisons de masquer la catégorie, et deux messages : le type n'en
    // porte pas, ou la découpe a pris sa place. Le second n'est pas un
    // avertissement — juste le rappel de ce qui classe la ligne.
    info.textContent = regleDecoupeEstActive()
      ? t("La découpe ci-dessous tient lieu de catégorie.")
      : `« ${libelleTypeOperation(type)} » ne porte pas de catégorie : le type est à lui seul la classification.`;
    info.style.display = "";
  }
  // Le type a quitté « classique » : la découpe s'est décochée (cf.
  // majVisibiliteDecoupeRegle), et son champ n'a plus rien à montrer.
  if (regleAutresAffiches.includes("decoupe") && !regleDecoupeEstActive()) {
    regleAutresAffiches = regleAutresAffiches.filter((c) => c !== "decoupe");
    renderAutresChampsRegle();
  }
}

/* ---------- La découpe qu'une règle impose ---------- */
/*
 * DES FORMULES, PAS DES MONTANTS. Une règle s'écrit une fois pour des lignes
 * dont elle ignore le montant : « les 50 premiers euros en Repas, le reste en
 * Sorties » ne se dit pas avec deux nombres fixes. La grammaire acceptée est
 * décrite sous l'éditeur, et relue par le serveur à l'enregistrement
 * (cf. services/formule_decoupe.py) — une formule illisible est refusée tout
 * de suite, et pas six mois plus tard au milieu d'un import.
 */

function regleDecoupeEstActive() {
  return (
    document.getElementById("regle-type").value === TYPE_REGLE_DECOUPABLE &&
    document.getElementById("regle-decoupee").checked
  );
}

function lignesDecoupeRegle() {
  return [...document.querySelectorAll("#regle-decoupe-parts .regle-decoupe-part")];
}

function lireDecoupesRegle() {
  return lignesDecoupeRegle()
    .map((ligne) => ({
      categorie_id: Number(ligne.querySelector(".regle-decoupe-categorie").value),
      formule: ligne.querySelector(".regle-decoupe-formule").value.trim(),
    }))
    .filter((part) => part.categorie_id && part.formule);
}

function ajouterPartDecoupeRegle(categorieId = null, formule = "") {
  const conteneur = document.getElementById("regle-decoupe-parts");
  const ligne = document.createElement("div");
  ligne.className = "regle-decoupe-part";
  ligne.innerHTML = `
    <select class="regle-decoupe-categorie"></select>
    <input type="text" class="regle-decoupe-formule" placeholder="ex. min(montant; 50)"
           value="${(formule || "").replace(/"/g, "&quot;")}" />
    <button type="button" class="danger" data-role="supprimer-part">×</button>
  `;
  conteneur.appendChild(ligne);
  const select = ligne.querySelector(".regle-decoupe-categorie");
  // UNE CATÉGORIE ÉTEINTE NE CLASSE PLUS RIEN (cf. categoriesProposables du
  // noyau) : elle quitte le menu, sauf si cette part la désigne déjà — auquel
  // cas rouvrir la règle l'aurait reclassée en silence.
  fillCategoriesSelect(select, categoriesProposables(categorieId ?? null), { keepFirst: true });
  if (categorieId != null) select.value = categorieId;
  ligne.querySelector("[data-role='supprimer-part']").addEventListener("click", () => {
    ligne.remove();
  });
}

function majVisibiliteDecoupeRegle() {
  const decoupable = document.getElementById("regle-type").value === TYPE_REGLE_DECOUPABLE;
  // Décochée dès qu'elle cesse d'être proposée : une case cochée mais invisible
  // enverrait des parts que le serveur refuserait pour ce type (400).
  if (!decoupable) document.getElementById("regle-decoupee").checked = false;
  document.getElementById("regle-decoupe-bloc").style.display = regleDecoupeEstActive()
    ? ""
    : "none";
}

document.getElementById("regle-decoupee").addEventListener("change", () => {
  // Deux parts d'emblée : une découpe en compte au moins deux, et cocher la
  // case pour tomber sur une liste vide obligerait à deviner le geste suivant.
  if (regleDecoupeEstActive() && lignesDecoupeRegle().length === 0) {
    ajouterPartDecoupeRegle();
    ajouterPartDecoupeRegle(null, "reste");
  }
  majVisibiliteCategorieRegle();
});

document
  .getElementById("btn-regle-decoupe-ajouter")
  .addEventListener("click", () => ajouterPartDecoupeRegle());


function ouvrirEditeurRegle(regle = null) {
  document.getElementById("regle-editeur").style.display = "";
  document.getElementById("regle-editeur-titre").textContent = regle
    ? "Modifier la règle"
    : "Nouvelle règle";
  document.getElementById("regle-id").value = regle ? regle.id : "";
  document.getElementById("regle-nom").value = regle ? regle.nom : "";
  document.getElementById("regle-description").value = regle ? regle.description || "" : "";
  document.getElementById("regle-connecteur").value = regle ? regle.conditions.operateur : "ET";
  document.getElementById("regle-actif").checked = regle ? regle.actif : true;
  // Cochée par défaut sur une règle neuve : c'est le comportement qu'on attend
  // sans y penser (« ma règle décide, point »).
  document.getElementById("regle-arreter-apres").checked = regle ? regle.arreter_apres : true;
  remplirSelecteurTypesRegle();
  document.getElementById("regle-type").value = regle ? regle.type_code || "" : "";

  _refillPreservingSelection(document.getElementById("regle-categorie"), (el) =>
    fillCategoriesSelect(
      el,
      categoriesProposables(regle && regle.categorie_id != null ? regle.categorie_id : null),
      { keepFirst: true }
    )
  );
  regleCategorieMemorisee = regle && regle.categorie_id != null ? String(regle.categorie_id) : "";
  document.getElementById("regle-categorie").value = regleCategorieMemorisee;

  _refillPreservingSelection(document.getElementById("regle-compte-autre"), (el) =>
    fillComptesSelect(el, state.comptes, { keepFirst: true })
  );
  document.getElementById("regle-compte-autre").value =
    regle && regle.compte_autre_id != null ? String(regle.compte_autre_id) : "";

  // LES AUTRES PROPRIÉTÉS (migration 0071) — vides = « la règle n'en dit rien ».
  document.getElementById("regle-nature").value = (regle && regle.nature_remplacement) || "";
  _refillPreservingSelection(document.getElementById("regle-compte"), (el) =>
    fillComptesSelect(el, state.comptes, { keepFirst: true })
  );
  document.getElementById("regle-compte").value =
    regle && regle.compte_id != null ? String(regle.compte_id) : "";
  document.getElementById("regle-notes").value = (regle && regle.notes) || "";
  document.getElementById("regle-amortissement").value =
    (regle && regle.amortissement_mois) || "";
  document.getElementById("regle-imprevue").checked = !!(regle && regle.imprevue);
  // AVANT majVisibiliteCategorieRegle, qui lit la case pour décider d'afficher
  // les parts ou la catégorie unique.
  const parts = regle && regle.decoupes ? regle.decoupes : [];
  document.getElementById("regle-decoupe-parts").innerHTML = "";
  document.getElementById("regle-decoupee").checked = parts.length > 0;
  parts.forEach((part) => ajouterPartDecoupeRegle(part.categorie_id, part.formule));

  // Ne s'affichent que les champs qui disent déjà quelque chose.
  regleAutresAffiches = autresChampsDisponibles()
    .filter(autreChampRempli)
    .map((def) => def.cle);
  renderAutresChampsRegle();
  majVisibiliteCategorieRegle();

  // Copie profonde : annuler ne doit rien laisser derrière dans la liste.
  regleBrouillonGroupes = regle
    ? JSON.parse(JSON.stringify(regle.conditions.groupes))
    : [groupeVide()];
  renderRegleGroupes();
  regleBrouillonSorties = regle && regle.sorties ? JSON.parse(JSON.stringify(regle.sorties)) : [];
  renderRegleSorties();
  document.getElementById("regle-editeur").scrollIntoView({ behavior: "smooth", block: "nearest" });
}

/* ---------- L'ACTION D'UNE RÈGLE, CHAMP PAR CHAMP ----------
 *
 * Type, catégorie, découpe et toutes les autres propriétés : une seule liste,
 * un seul « + Ajouter un champ ». Même forme que les actions d'une sortie conditionnelle (cf. SORTIE_CHAMPS) :
 * seuls les champs posés s'affichent, et « + Ajouter un champ » en pose un de
 * plus. Les champs vivent dans page.html sous leurs identifiants d'avant — la
 * lecture à l'enregistrement n'a donc pas changé ; retirer un champ le VIDE,
 * ce qui revient exactement à « la règle n'en dit rien ».
 */
const AUTRES_CHAMPS_REGLE = [
  { cle: "type_code", libelle: "Classer comme", id: "regle-type" },
  { cle: "categorie_id", libelle: "Dans la catégorie", id: "regle-categorie" },
  { cle: "decoupe", libelle: "Découper entre plusieurs catégories", id: "regle-decoupee" },
  { cle: "nature", libelle: "Renommer en", id: "regle-nature" },
  { cle: "compte", libelle: "Sur le compte", id: "regle-compte" },
  { cle: "notes", libelle: "Avec la note", id: "regle-notes" },
  { cle: "amortissement", libelle: "Amortir sur (mois)", id: "regle-amortissement" },
  { cle: "imprevue", libelle: "Marquer comme dépense imprévue", id: "regle-imprevue" },
];
let regleAutresAffiches = [];

/** L'étiquette « imprévue » appartient à l'extension « Budget » : sans elle,
 *  aucun écran ne la montre, et la proposer ici poserait une étiquette
 *  invisible. */
function autresChampsDisponibles() {
  return AUTRES_CHAMPS_REGLE.filter(
    (def) => def.cle !== "imprevue" || BudgetApp.extensions.estActive("analyse-budget")
  );
}

function autreChampRempli(def) {
  const el = document.getElementById(def.id);
  return el.type === "checkbox" ? el.checked : el.value.trim() !== "";
}

function renderAutresChampsRegle() {
  const disponibles = autresChampsDisponibles().map((def) => def.cle);
  document.querySelectorAll("#regle-autres-champs [data-autre]").forEach((ligne) => {
    const cle = ligne.dataset.autre;
    ligne.style.display = regleAutresAffiches.includes(cle) && disponibles.includes(cle) ? "" : "none";
  });
  creerMenuAjoutChamp(document.getElementById("regle-autres-ajout"), {
    libelle: t("Ajouter un champ"),
    options: autresChampsDisponibles()
      .filter((def) => !regleAutresAffiches.includes(def.cle))
      .map((def) => ({ cle: def.cle, libelle: t(def.libelle) })),
    onChoix: (cle) => {
      regleAutresAffiches.push(cle);
      const def = AUTRES_CHAMPS_REGLE.find((d) => d.cle === cle);
      const el = document.getElementById(def.id);
      if (cle === "decoupe") {
        // Seul le type « classique » se découpe : on pose le champ du type s'il
        // manque, et on l'y met.
        if (!regleAutresAffiches.includes("type_code")) regleAutresAffiches.push("type_code");
        document.getElementById("regle-type").value = TYPE_REGLE_DECOUPABLE;
      }
      // Ajouter la case, c'est vouloir l'étiquette : on la coche d'office.
      if (el.type === "checkbox") el.checked = true;
      renderAutresChampsRegle();
      if (cle === "decoupe") {
        // Le même geste que la case d'avant : deux parts d'emblée.
        el.dispatchEvent(new Event("change"));
      } else if (cle === "type_code" || cle === "categorie_id") {
        // Un champ qui s'affiche sur « ne pas changer » : ce choix doit déjà
        // compter pour la visibilité de la catégorie et de la découpe.
        majVisibiliteCategorieRegle();
      }
      if (el.type !== "checkbox") el.focus();
    },
  });
}

document.querySelectorAll("#regle-autres-champs [data-retirer-autre]").forEach((bouton) => {
  bouton.addEventListener("click", () => {
    const cle = bouton.dataset.retirerAutre;
    const def = AUTRES_CHAMPS_REGLE.find((d) => d.cle === cle);
    const el = document.getElementById(def.id);
    if (el.type === "checkbox") el.checked = false;
    else el.value = "";
    regleAutresAffiches = regleAutresAffiches.filter((c) => c !== cle);
    if (cle === "categorie_id") regleCategorieMemorisee = "";
    // Sans type, plus de découpe (cf. majVisibiliteDecoupeRegle) : son champ
    // part avec lui.
    if (cle === "type_code") {
      document.getElementById("regle-decoupee").checked = false;
      regleAutresAffiches = regleAutresAffiches.filter((c) => c !== "decoupe");
    }
    renderAutresChampsRegle();
    if (["type_code", "categorie_id", "decoupe"].includes(cle)) majVisibiliteCategorieRegle();
  });
});

/* ---------- LES SORTIES CONDITIONNELLES ----------
 *
 * Une règle DÉTECTE une fois, et peut SORTIR de plusieurs façons : chaque
 * sortie porte ses propres conditions (même éditeur que la détection) et les
 * actions qui remplacent celles de la règle quand elles correspondent. La
 * première qui correspond l'emporte ; aucune ne correspond, la règle agit telle
 * quelle (cf. regles_categorisation._actions_effectives). Un champ laissé
 * vide garde l'action de la règle.
 */
let regleBrouillonSorties = [];

/* CE QU'UNE SORTIE PEUT CHANGER, posé champ par champ par « + Ajouter un
 * champ » (cf. app.js, creerMenuAjoutChamp). Les six listes s'affichaient
 * toutes d'office, chacune sur « celle de la règle » : une sortie ne change en
 * pratique qu'une ou deux choses, et les quatre autres lignes n'étaient qu'un
 * inventaire à parcourir pour trouver celles qui comptent. Un champ posé puis
 * retiré revient à « celle de la règle ». */
const SORTIE_CHAMPS = [
  { cle: "type_code", libelle: "Classer comme", saisie: "type" },
  { cle: "categorie_id", libelle: "Dans la catégorie", saisie: "categorie" },
  { cle: "compte_autre_id", libelle: "Avec le compte en face", saisie: "compte" },
  { cle: "compte_id", libelle: "Sur le compte", saisie: "compte" },
  { cle: "nature_remplacement", libelle: "Renommer en", saisie: "texte" },
  { cle: "notes", libelle: "Avec la note", saisie: "texte" },
];

/** Les champs affichés d'une sortie : ceux qui portent une valeur, plus ceux
 *  qu'on vient d'ajouter et pas encore remplis. Rangé sur la sortie sous une
 *  clé qui ne part jamais au serveur (cf. sortiesPourServeur). */
function champsAffichesSortie(sortie) {
  if (!sortie._affiches) {
    sortie._affiches = SORTIE_CHAMPS.map((c) => c.cle).filter(
      (cle) => sortie[cle] != null && sortie[cle] !== ""
    );
  }
  return sortie._affiches;
}

function sortieVide() {
  return {
    conditions: { operateur: "ET", groupes: [groupeVide()] },
    type_code: null,
    categorie_id: null,
    compte_autre_id: null,
    compte_id: null,
    nature_remplacement: null,
    notes: null,
  };
}

function renderRegleSorties() {
  const bloc = document.getElementById("regle-sorties");
  bloc.innerHTML = "";
  if (!regleBrouillonSorties.length) {
    bloc.innerHTML = `<p class="hint">${escapeHtml(
      t("Aucune : la règle fait toujours la même chose.")
    )}</p>`;
    return;
  }
  // Les types proposés : ceux du menu de la règle, qui a déjà écarté ceux
  // qu'aucune extension ne rend accessibles.
  const optionsTypes = [...document.getElementById("regle-type").options]
    .filter((o) => o.value)
    .map((o) => [o.value, o.textContent]);
  const garder = escapeHtml(t("— celui de la règle —"));
  const garderF = escapeHtml(t("— celle de la règle —"));

  regleBrouillonSorties.forEach((sortie, i) => {
    const carte = document.createElement("div");
    carte.className = "regle-groupe regle-sortie";
    carte.innerHTML = `
      <div class="regle-groupe-entete">
        <span class="regle-groupe-titre">${t("Sortie")} ${i + 1}</span>
        <label>${t("Combiner les groupes")}
          <select data-role="connecteur">
            <option value="ET" ${sortie.conditions.operateur === "ET" ? "selected" : ""}>ET</option>
            <option value="OU" ${sortie.conditions.operateur === "OU" ? "selected" : ""}>OU</option>
          </select>
        </label>
        <button type="button" class="danger" data-role="supprimer-sortie">${t("Supprimer la sortie")}</button>
      </div>
      <div class="regle-sortie-etiquette">${t("Si la ligne…")}</div>
      <div data-role="groupes"></div>
      <div class="actions"><button type="button" data-role="ajouter-groupe">+ ${t("Ajouter un groupe")}</button></div>
      <div class="regle-sortie-etiquette">${t("…alors, à la place de la règle :")}</div>
      <div class="regle-sortie-actions" data-role="actions"></div>
      <div data-role="ajout-champ"></div>`;

    // LES SEULS CHAMPS POSÉS, dans l'ordre de la liste de référence : une
    // sortie relue s'affiche toujours pareil, quel que soit l'ordre dans lequel
    // on avait ajouté ses champs.
    const affiches = champsAffichesSortie(sortie);
    const zone = carte.querySelector('[data-role="actions"]');
    SORTIE_CHAMPS.filter((c) => affiches.includes(c.cle)).forEach((def) => {
      const ligne = document.createElement("div");
      ligne.className = "champ-ajoute";
      let saisie;
      if (def.saisie === "type") {
        saisie = `<select data-champ="type_code"><option value="">${garder}</option>
          ${optionsTypes.map(([v, l]) => `<option value="${v}">${escapeHtml(l)}</option>`).join("")}</select>`;
      } else if (def.saisie === "texte") {
        saisie = `<input type="text" data-champ="${def.cle}" />`;
      } else {
        saisie = `<select data-champ="${def.cle}"><option value="">${
          def.saisie === "categorie" ? garderF : garder
        }</option></select>`;
      }
      ligne.innerHTML = `
        <span class="champ-ajoute-libelle">${escapeHtml(t(def.libelle))}</span>
        ${saisie}
        <button type="button" class="champ-ajoute-retirer" data-retirer="${def.cle}"
                title="${escapeHtml(t("Retirer"))}" aria-label="${escapeHtml(t("Retirer"))}">×</button>`;
      const champ = ligne.querySelector("[data-champ]");
      if (def.saisie === "categorie") {
        fillCategoriesSelect(champ, categoriesProposables(sortie.categorie_id), { keepFirst: true });
      } else if (def.saisie === "compte") {
        fillComptesSelect(champ, state.comptes, { keepFirst: true });
      }
      ligne.querySelector("[data-retirer]").addEventListener("click", () => {
        sortie[def.cle] = null;
        sortie._affiches = affiches.filter((cle) => cle !== def.cle);
        renderRegleSorties();
      });
      zone.appendChild(ligne);
    });
    creerMenuAjoutChamp(carte.querySelector('[data-role="ajout-champ"]'), {
      libelle: t("Ajouter un champ"),
      options: SORTIE_CHAMPS.filter((c) => !affiches.includes(c.cle)).map((c) => ({
        cle: c.cle,
        libelle: t(c.libelle),
      })),
      onChoix: (cle) => {
        affiches.push(cle);
        renderRegleSorties();
        document.querySelector(`#regle-sorties .regle-sortie:nth-child(${i + 1}) [data-champ="${cle}"]`)?.focus();
      },
    });

    carte.querySelectorAll("[data-champ]").forEach((champ) => {
      const valeur = sortie[champ.dataset.champ];
      champ.value = valeur == null ? "" : String(valeur);
      champ.addEventListener("change", () => {
        const brut = champ.value.trim();
        const numerique = champ.dataset.champ.endsWith("_id");
        sortie[champ.dataset.champ] = brut === "" ? null : numerique ? Number(brut) : brut;
      });
    });
    carte.querySelector('[data-role="connecteur"]').addEventListener("change", (e) => {
      sortie.conditions.operateur = e.target.value;
    });
    carte.querySelector('[data-role="supprimer-sortie"]').addEventListener("click", () => {
      regleBrouillonSorties.splice(i, 1);
      renderRegleSorties();
    });
    carte.querySelector('[data-role="ajouter-groupe"]').addEventListener("click", () => {
      sortie.conditions.groupes.push(groupeVide());
      renderRegleSorties();
    });
    bloc.appendChild(carte);
    renderRegleGroupes(carte.querySelector('[data-role="groupes"]'), sortie.conditions.groupes, `s${i}-`);
  });
}

document.getElementById("btn-regle-ajouter-sortie").addEventListener("click", () => {
  regleBrouillonSorties.push(sortieVide());
  renderRegleSorties();
});

/** Les sorties telles que le serveur les attend : le type en identifiant. */
function sortiesPourServeur() {
  return regleBrouillonSorties.map((sortie) => {
    // `_affiches` ne sert qu'à l'écran (cf. champsAffichesSortie).
    const { type_code, _affiches, ...reste } = sortie;
    return { ...reste, type_id: type_code ? idTypeOperation(type_code) : null };
  });
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

/* UN MOT-CLÉ TAPÉ SANS « + » EST UN MOT-CLÉ VOULU. L'éditeur à jetons n'ajoute
 * qu'au « + » ou à Entrée : un mot laissé dans le champ au moment d'enregistrer
 * n'était pas dans le brouillon, et la règle était refusée au motif qu'une
 * condition n'avait « pas de valeur » — alors qu'on la voyait écrite. On valide
 * donc tout ce qui est encore en saisie, détection et sorties comprises, avant
 * de contrôler quoi que ce soit. */
function validerMotsClesEnSaisie() {
  document
    .querySelectorAll("#regle-editeur .regle-condition-mots .import-vocabulaire-saisie")
    .forEach((saisie) => {
      const champ = saisie.querySelector("input");
      if (champ && champ.value.trim()) saisie.querySelector(".import-vocabulaire-ajouter")?.click();
    });
}

document.getElementById("btn-regle-enregistrer").addEventListener("click", async () => {
  validerMotsClesEnSaisie();
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
      if (motsClesCondition(condition).length === 0) {
        showMessage(t("Chaque condition doit avoir une valeur à comparer."), "error");
        return;
      }
    }
  }

  // Les conditions des sorties : mêmes exigences que celles de la détection.
  for (const sortie of regleBrouillonSorties) {
    for (const groupe of sortie.conditions.groupes) {
      for (const condition of groupe.conditions) {
        if (!condition.champ || motsClesCondition(condition).length === 0) {
          showMessage(t("Chaque condition d'une sortie doit porter sur un champ et avoir une valeur."), "error");
          return;
        }
      }
    }
    const change = ["type_code", "categorie_id", "compte_autre_id", "compte_id", "nature_remplacement", "notes"]
      .some((champ) => sortie[champ] != null && sortie[champ] !== "");
    if (!change) {
      showMessage(t("Une sortie conditionnelle doit changer au moins une chose."), "error");
      return;
    }
  }

  const type = document.getElementById("regle-type").value;
  // La découpe : les mêmes refus que le serveur, dits ici avec les mots de
  // l'écran (cf. schemas.RegleCategorisationBase._check_decoupes). Les
  // formules elles-mêmes ne sont relues que par lui — le parseur vit là-bas,
  // et en écrire un second en JavaScript aurait fait deux grammaires à tenir
  // d'accord.
  const decoupes = regleDecoupeEstActive() ? lireDecoupesRegle() : [];
  if (regleDecoupeEstActive()) {
    if (decoupes.length < 2) {
      showMessage(t("Une découpe compte au moins deux parts remplies."), "error");
      return;
    }
    const categories = decoupes.map((part) => part.categorie_id);
    if (new Set(categories).size !== categories.length) {
      showMessage(
        t("Une même catégorie ne peut pas apparaître deux fois dans la découpe."),
        "error"
      );
      return;
    }
    if (decoupes.filter((part) => part.formule.trim().toLowerCase() === "reste").length > 1) {
      showMessage(t("Une seule part peut valoir « reste »."), "error");
      return;
    }
  }
  // La catégorie n'est transmise que si le type l'accepte : basculer vers un
  // type à catégorie imposée l'outrepasse, sans avoir à la vider à la main.
  // Une découpe la remplace, exactement comme le serveur la neutralise.
  const categorieVal =
    (!type || TYPES_CATEGORIE_LIBRE.has(type)) && decoupes.length === 0
      ? document.getElementById("regle-categorie").value
      : "";
  // Même règle pour le compte en face : seul un virement en porte un.
  const compteAutreVal =
    type === "virement" ? document.getElementById("regle-compte-autre").value : "";
  const compteVal = document.getElementById("regle-compte").value;
  const amortissementBrut = document.getElementById("regle-amortissement").value.trim();
  const amortissement = amortissementBrut ? Number(amortissementBrut) : 0;
  if (amortissementBrut && (!Number.isInteger(amortissement) || amortissement < 2 || amortissement > 120)) {
    showMessage(t("Un amortissement s'étale sur 2 à 120 mois."), "error");
    return;
  }
  // UNE RÈGLE QUI NE CHANGE RIEN n'a pas de raison d'exister : elle
  // correspondrait sans effet, et se lirait dans la liste comme une panne.
  const neChangeRien =
    !type &&
    !regleBrouillonSorties.length &&
    !categorieVal &&
    !document.getElementById("regle-nature").value.trim() &&
    !compteVal &&
    !document.getElementById("regle-notes").value.trim() &&
    !amortissement &&
    !document.getElementById("regle-imprevue").checked;
  if (neChangeRien) {
    showMessage(t("Cette règle ne changerait rien : choisis au moins une action."), "error");
    return;
  }

  const payload = {
    nom,
    description: document.getElementById("regle-description").value.trim(),
    conditions: {
      operateur: document.getElementById("regle-connecteur").value,
      groupes: regleBrouillonGroupes,
    },
    type_id: type ? idTypeOperation(type) : null,
    categorie_id: categorieVal ? Number(categorieVal) : null,
    decoupes,
    compte_autre_id: compteAutreVal ? Number(compteAutreVal) : null,
    nature_remplacement: document.getElementById("regle-nature").value.trim() || null,
    compte_id: compteVal ? Number(compteVal) : null,
    notes: document.getElementById("regle-notes").value.trim() || null,
    amortissement_mois: amortissement || null,
    // Décochée = « n'en dit rien » (null), jamais « pas imprévue » : une règle
    // n'a pas à retirer une étiquette que personne n'a posée.
    imprevue: document.getElementById("regle-imprevue").checked ? true : null,
    sorties: sortiesPourServeur(),
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
 * STOCKÉ EN BASE (`PreferenceInterface`, clé « regles.dossiers », migration
 * 0069) — et non plus dans le `localStorage`, où il a commencé. L'intention
 * était juste : un dossier est un confort de lecture, pas une donnée du budget.
 * La CHOSE, elle, ne l'était pas : ce qui est rangé ici est une table
 * `{ "<id de règle>": "<nom de dossier>" }`, et un identifiant de règle
 * n'existe que dans une base précise. Le même rangement appliqué à une autre
 * base désigne d'autres règles, ou aucune ; une base emportée sur un second
 * poste arrivait sans son rangement, alors qu'elle portait les règles rangées ;
 * et le navigateur embarqué perdait tout dès que la fenêtre changeait
 * d'origine. Ce qui désigne des identifiants de la base vit dans la base.
 *
 * L'EXTENSION N'EMPORTE TOUJOURS PAS DE SCHÉMA : la table est au NOYAU, comme
 * toutes les tables, et ne sert qu'à ranger du JSON sous une clé (cf.
 * extensions/README.md, et backend/app/routers/preferences.py). Éteindre
 * « Règles » ne perd donc rien, comme avant.
 */

const CLE_DOSSIERS_REGLES = "regles.dossiers";
// L'ancienne clé de localStorage, reprise UNE FOIS au premier chargement d'après
// la migration puis effacée : personne n'a à refaire des dossiers qu'il avait
// déjà faits.
const CLE_DOSSIERS_REGLES_LOCALE = "budget-app.regles.dossiers";
// Le dossier d'accueil : il n'est pas stocké, il se déduit de ce qui n'est
// rangé nulle part. Impossible à supprimer ou à renommer, donc, et une règle
// nouvelle s'y trouve sans qu'on ait rien à faire.
const DOSSIER_PAR_DEFAUT = "Autres";

let vueRegles = "liste";
// { dossiers: ["Courses", …], parRegle: { "<id de règle>": "Courses" } }
let dossiersRegles = { dossiers: [], parRegle: {} };

function rangementValide(brut) {
  return !!(brut && Array.isArray(brut.dossiers) && brut.parRegle);
}

/**
 * Lit le rangement en base, et reprend celui du poste s'il n'y en a pas encore.
 *
 * LA REPRISE N'A LIEU QUE SI LA BASE N'A RIEN — `null`, et non « un objet
 * vide ». Les deux ne disent pas la même chose : « cette base n'a jamais rien
 * rangé » autorise la reprise, « on a rangé puis tout retiré » l'interdit.
 * Confondre les deux aurait fait revenir, au chargement suivant, les dossiers
 * qu'on venait de supprimer.
 */
async function chargerDossiersRegles() {
  let brut = await lirePreference(CLE_DOSSIERS_REGLES);
  if (brut === null || brut === undefined) {
    const local = reprendreDuLocalStorage(CLE_DOSSIERS_REGLES_LOCALE);
    if (rangementValide(local)) {
      brut = local;
      await ecrirePreference(CLE_DOSSIERS_REGLES, local);
    }
  }
  // Contenu illisible (version antérieure, base bricolée) : on repart d'un
  // rangement vide plutôt que de casser l'écran. Aucune règle n'est perdue,
  // elles retombent toutes dans « Autres ».
  dossiersRegles = rangementValide(brut)
    ? { dossiers: brut.dossiers, parRegle: brut.parRegle }
    : { dossiers: [], parRegle: {} };
}

// Volontairement SANS `await` chez ses appelants : le rangement est déjà à
// l'écran quand la requête part, et attendre l'aller-retour pour redessiner
// ferait clignoter la galerie à chaque glisser-déposer. Un échec est consigné
// par `ecrirePreference`, jamais jeté à la figure de l'écran.
function enregistrerDossiersRegles() {
  ecrirePreference(CLE_DOSSIERS_REGLES, dossiersRegles);
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
    ${descriptionRegleHtml(regle)}
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

// Le noyau rappelle ce chargeur à CHAQUE ouverture de la sous-page : les
// catégories, les comptes et les règles ont pu changer entre deux visites — et
// le rangement des dossiers avec elles, puisqu'il vit désormais dans la base.
BudgetApp.extensions.enregistrer("regles", { chargeur: loadRegles });
