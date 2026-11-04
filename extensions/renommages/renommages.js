/* Extension « Renommages ».
 *
 * Ce fichier s'exécute dans la portée globale de la page, après l'injection de page.html : tout ce
 * qu'app.js expose lui est accessible (apiFetch, t, showMessage, escapeHtml…), cf.
 * extensions/README.md.
 *
 * Le MOTEUR est dans le noyau (services/renommages.py) : c'est l'import qui renomme et qui propose.
 * Ici, l'écran qui LISTE les renommages, en ajoute à la main, les corrige et les oublie. Les autres
 * renommages naissent d'eux-mêmes — une opération renommée, une ligne retouchée à l'import, une
 * suggestion acceptée.
 */

// Allume ce qui ne sert qu'avec l'extension (cf. majVisibilite) : sa seule exécution vaut « allume-le ».
BudgetApp.extensions.majVisibilite("renommages", true);

const LIBELLES_ORIGINE_RENOMMAGE = {
  operation: "opération renommée",
  import: "retouché à l'import",
  suggestion: "suggestion acceptée",
  manuel: "écrit à la main",
};

let renommagesCharges = [];
let renommagesATrancher = [];

/* ---------- Le sous-onglet, dans la page « Règles » ----------
 *
 * La page hôte (Paramètres → Règles, ou « Correspondances » sans l'extension des règles) porte le
 * contenu des règles et des correspondances. Une barre à deux onglets en tête choisit ce qu'on voit :
 * le contenu d'origine, ou les renommages. Le choix tient dans une classe de la barre, lue par le CSS
 * (renommages.css) : rien n'est caché à la main, et la barre disparaît avec l'extension (elle porte
 * `data-extension-greffe`), le contenu d'origine redevenant alors le seul visible. */
const HOTE_RENOMMAGES = "sous-section-parametres-correspondances";

function poserBarreRenommages() {
  const hote = document.getElementById(HOTE_RENOMMAGES);
  if (!hote) return;
  let barre = hote.querySelector(":scope > .renommages-barre");
  if (!barre) {
    barre = document.createElement("div");
    barre.className = "sous-onglets renommages-barre";
    barre.dataset.extensionGreffe = "renommages";
    barre.innerHTML = `
      <button type="button" data-vue-hote="regles" class="active"></button>
      <button type="button" data-vue-hote="renommages"></button>`;
    hote.prepend(barre);
    barre.querySelectorAll("button").forEach((bouton) =>
      bouton.addEventListener("click", () => {
        const enRenommages = bouton.dataset.vueHote === "renommages";
        barre.classList.toggle("vue-renommages", enRenommages);
        majBarreRenommages(barre);
        // Relus à chaque ouverture : l'import a pu noter de nouveaux points à trancher.
        if (enRenommages) loadRenommages();
      })
    );
  }
  majBarreRenommages(barre);
}

function majBarreRenommages(barre) {
  // Le premier onglet porte le nom de ce que la page montrait avant : « Règles » quand l'extension
  // des règles tourne, « Correspondances » sinon.
  const reglesActives = BudgetApp.extensions.estActive("regles");
  const [premier, second] = barre.querySelectorAll("button");
  premier.textContent = t(reglesActives ? "Règles" : "Correspondances");
  second.textContent = t("Renommages");
  const enRenommages = barre.classList.contains("vue-renommages");
  premier.classList.toggle("active", !enRenommages);
  second.classList.toggle("active", enRenommages);
}

const OUTILS_RENOMMAGE = {
  inclusion: "un libellé contient l'autre",
  mots: "mêmes mots",
  caracteres: "écriture proche",
  prefixe: "début identique",
};

async function loadRenommages() {
  try {
    [renommagesCharges, renommagesATrancher] = await Promise.all([
      apiFetch("/renommages"),
      apiFetch("/renommages/a-trancher"),
    ]);
    renderATrancher();
    renderRenommages();
  } catch (err) {
    showMessage(err.message, "error");
  }
}

/** Les libellés à trancher : « X » ressemble à « Y » (renommé « Z »), accepter ou refuser. */
function renderATrancher() {
  const bloc = document.getElementById("renommages-a-trancher");
  const liste = document.getElementById("renommages-a-trancher-liste");
  bloc.style.display = renommagesATrancher.length ? "" : "none";
  liste.innerHTML = "";
  renommagesATrancher.forEach((p) => {
    const ligne = document.createElement("div");
    ligne.className = "renommage-ligne renommage-a-trancher";
    ligne.innerHTML = `
      <div class="renommage-noms">
        <div class="renommage-nouveau">${escapeHtml(t("Renommer « {libelle} » en « {nom} » ?", { libelle: p.libelle, nom: p.nom_nouveau }))}</div>
        <div class="renommage-ancien">${escapeHtml(
          t("Ressemble à « {nom} » ({outil}).", {
            nom: p.nom_origine,
            outil: t(OUTILS_RENOMMAGE[p.outil] || p.outil),
          })
        )}</div>
      </div>
      <button type="button" class="primary" data-action="accepter">${t("Accepter")}</button>
      <button type="button" data-action="refuser">${t("Refuser")}</button>`;
    const trancher = (action) => async () => {
      try {
        await apiFetch(`/renommages/a-trancher/${p.id}/${action}`, { method: "POST" });
        await loadRenommages();
      } catch (err) {
        showMessage(err.message, "error");
      }
    };
    ligne.querySelector("[data-action='accepter']").addEventListener("click", trancher("accepter"));
    ligne.querySelector("[data-action='refuser']").addEventListener("click", trancher("refuser"));
    liste.appendChild(ligne);
  });
}

/* ---------- Sélection en lot : la pile « à valider » et la liste des renommages retenus ----------
 *
 * Chaque liste a sa sélection (des identifiants) et sa barre : « Tout sélectionner » (qui devient « Tout
 * désélectionner » quand tout est coché), puis les gestes sur la sélection. La sélection porte sur ce qui est
 * AFFICHÉ — la recherche la restreint — et ne survit pas à une ligne qui disparaît. */
const selectionsRenommages = { aValider: new Set(), retenus: new Set() };

function creerBarreSelection(conteneur, selection, visibles, actions) {
  conteneur.innerHTML = "";
  if (!visibles.length) return;
  const toutCoche = visibles.every((r) => selection.has(r.id));
  const bouton = (libelle, classe, action) => {
    const b = document.createElement("button");
    b.type = "button";
    b.textContent = libelle;
    if (classe) b.className = classe;
    b.addEventListener("click", action);
    conteneur.appendChild(b);
    return b;
  };
  bouton(toutCoche ? t("Tout désélectionner") : t("Tout sélectionner"), "", () => {
    if (toutCoche) visibles.forEach((r) => selection.delete(r.id));
    else visibles.forEach((r) => selection.add(r.id));
    renderRenommages();
  });
  actions.forEach(({ libelle, classe, executer }) => {
    const b = bouton(libelle, classe, () => executer([...selection]));
    b.disabled = selection.size === 0;
  });
  const compteur = document.createElement("span");
  compteur.className = "hint";
  compteur.textContent = t("{n} sélectionné(s)", { n: selection.size });
  conteneur.appendChild(compteur);
}

/** Un geste sur un lot : le serveur répond `{nombre}`, la page est relue. */
async function gesteSurLot(chemin, ids, messageFait) {
  try {
    const reponse = await apiFetch(`/renommages/${chemin}`, {
      method: "POST",
      body: JSON.stringify({ ids }),
    });
    showMessage(t(messageFait, { n: reponse.nombre }), "success");
    await loadRenommages();
  } catch (err) {
    showMessage(err.message, "error");
  }
}

function supprimerSelection(ids) {
  if (!ids.length) return;
  if (!confirm(t("Oublier {n} renommage(s) ? Les opérations déjà écrites ne changent pas.", { n: ids.length }))) {
    return;
  }
  return gesteSurLot("supprimer-lot", ids, "{n} renommage(s) supprimé(s)");
}

/** Une ligne de liste : case à cocher, noms, origine, puis les boutons que `construireBoutons` pose. */
function creerLigneRenommage(r, selection, construireBoutons) {
  const ligne = document.createElement("div");
  ligne.className = "renommage-ligne";
  ligne.innerHTML = `
    <input type="checkbox" class="renommage-case" aria-label="${escapeHtml(t("Sélectionner"))}" ${
      selection.has(r.id) ? "checked" : ""
    } />
    <div class="renommage-noms">
      <div class="renommage-nouveau">${escapeHtml(r.nom_nouveau)}</div>
      <div class="renommage-ancien">(${escapeHtml(r.nom_origine)})</div>
    </div>
    <span class="renommage-origine">${escapeHtml(t(LIBELLES_ORIGINE_RENOMMAGE[r.origine] || r.origine))}</span>`;
  ligne.querySelector(".renommage-case").addEventListener("change", (e) => {
    if (e.target.checked) selection.add(r.id);
    else selection.delete(r.id);
    renderRenommages();
  });
  construireBoutons(ligne);
  return ligne;
}

function ajouterBouton(ligne, libelle, classe, executer) {
  const b = document.createElement("button");
  b.type = "button";
  b.textContent = libelle;
  if (classe) b.className = classe;
  b.addEventListener("click", executer);
  ligne.appendChild(b);
  return b;
}

/**
 * « Appliquer aux opérations existantes » sur un renommage DÉJÀ créé : grisé quand aucune opération de la
 * base ne porte le libellé d'origine. Le tooltip est posé sur une enveloppe — un bouton désactivé ne reçoit
 * pas le survol.
 */
function ajouterBoutonAppliquer(ligne, r) {
  const enveloppe = document.createElement("span");
  enveloppe.className = "renommage-appliquer-enveloppe";
  const aucune = !r.operations_a_renommer;
  enveloppe.title = aucune
    ? t(texteAide("renommages.appliquer-aucune-operation"))
    : t(texteAide("renommages.appliquer-existant"));
  ligne.appendChild(enveloppe);
  const bouton = document.createElement("button");
  bouton.type = "button";
  bouton.textContent = t("Appliquer aux opérations existantes");
  bouton.disabled = aucune;
  bouton.addEventListener("click", async () => {
    if (
      !confirm(
        t("Renommer {n} opération(s) « {ancien} » en « {nouveau} » ?", {
          n: r.operations_a_renommer,
          ancien: r.nom_origine,
          nouveau: r.nom_nouveau,
        })
      )
    ) {
      return;
    }
    try {
      const faite = await apiFetch(`/renommages/${r.id}/appliquer`, { method: "POST" });
      showMessage(t("{n} opération(s) renommée(s)", { n: faite.operations_renommees }), "success");
      await loadRenommages();
    } catch (err) {
      showMessage(err.message, "error");
    }
  });
  enveloppe.appendChild(bouton);
}

function renderRenommages() {
  const filtre = document
    .getElementById("renommage-recherche")
    .value.trim()
    .toLowerCase();
  const correspond = (r) =>
    !filtre ||
    r.nom_origine.toLowerCase().includes(filtre) ||
    r.nom_nouveau.toLowerCase().includes(filtre);
  const aValider = renommagesCharges.filter((r) => !r.valide && correspond(r));
  const retenus = renommagesCharges.filter((r) => r.valide && correspond(r));
  // Une sélection ne garde que ce qui existe encore.
  const ids = new Set(renommagesCharges.map((r) => r.id));
  Object.values(selectionsRenommages).forEach((s) => s.forEach((id) => ids.has(id) || s.delete(id)));

  document.getElementById("renommage-compte").textContent = t("{n} renommage(s)", {
    n: renommagesCharges.filter((r) => r.valide).length,
  });

  // La pile « à valider » : masquée quand elle est vide.
  document.getElementById("renommages-a-valider").style.display = aValider.length ? "" : "none";
  const listeAValider = document.getElementById("renommages-a-valider-liste");
  listeAValider.innerHTML = "";
  creerBarreSelection(
    document.getElementById("renommages-a-valider-barre"),
    selectionsRenommages.aValider,
    aValider,
    [
      {
        libelle: t("Valider la sélection"),
        classe: "primary",
        executer: (lot) => gesteSurLot("valider", lot, "{n} renommage(s) validé(s)"),
      },
      { libelle: t("Supprimer la sélection"), classe: "danger", executer: supprimerSelection },
    ]
  );
  aValider.forEach((r) => {
    listeAValider.appendChild(
      creerLigneRenommage(r, selectionsRenommages.aValider, (ligne) => {
        ajouterBouton(ligne, t("Valider"), "primary", () => gesteSurLot("valider", [r.id], "{n} renommage(s) validé(s)"));
        ajouterBouton(ligne, t("Modifier"), "", () => modifierRenommage(r));
        ajouterBouton(ligne, t("Supprimer"), "danger", () => supprimerSelection([r.id]));
      })
    );
  });

  // Les renommages permanents.
  const liste = document.getElementById("renommages-liste");
  liste.innerHTML = "";
  creerBarreSelection(
    document.getElementById("renommages-retenus-barre"),
    selectionsRenommages.retenus,
    retenus,
    [{ libelle: t("Supprimer la sélection"), classe: "danger", executer: supprimerSelection }]
  );
  if (!retenus.length) {
    const sansRetenus = renommagesCharges.filter((r) => r.valide).length === 0;
    liste.innerHTML = `<p class="hint">${escapeHtml(
      sansRetenus && !filtre
        ? t("Aucun renommage pour le moment : renomme une opération, ou ajoutes-en un ci-dessus.")
        : t("Aucun renommage ne correspond à cette recherche.")
    )}</p>`;
    return;
  }
  retenus.forEach((r) => {
    liste.appendChild(
      creerLigneRenommage(r, selectionsRenommages.retenus, (ligne) => {
        ajouterBoutonAppliquer(ligne, r);
        ajouterBouton(ligne, t("Modifier"), "", () => modifierRenommage(r));
        ajouterBouton(ligne, t("Supprimer"), "danger", () => supprimerSelection([r.id]));
      })
    );
  });
}

async function modifierRenommage(r) {
  const nouveau = prompt(t("Nouveau nom pour « {nom} »", { nom: r.nom_origine }), r.nom_nouveau);
  if (nouveau === null || !nouveau.trim()) return;
  try {
    await apiFetch(`/renommages/${r.id}`, {
      method: "PUT",
      body: JSON.stringify({ nom_origine: r.nom_origine, nom_nouveau: nouveau.trim() }),
    });
    await loadRenommages();
  } catch (err) {
    showMessage(err.message, "error");
  }
}

/* « Appliquer aux opérations existantes » : cochable seulement si la base contient au moins une
 * opération qui porte le libellé d'origine. Le serveur répond à chaque frappe (la dernière réponse
 * seule compte : `jetonAppliquer` écarte celles qui arrivent dans le désordre). */
let jetonAppliquer = 0;

async function majOptionAppliquer() {
  const origine = document.getElementById("renommage-origine").value.trim();
  const case_ = document.getElementById("renommage-appliquer");
  const etiquette = document.getElementById("renommage-appliquer-etiquette");
  const jeton = ++jetonAppliquer;
  let nombre = 0;
  if (origine) {
    try {
      nombre = (
        await apiFetch(`/renommages/operations-concernees?libelle=${encodeURIComponent(origine)}`)
      ).nombre;
    } catch (err) {
      nombre = 0;
    }
  }
  if (jeton !== jetonAppliquer) return;
  case_.disabled = nombre === 0;
  if (nombre === 0) case_.checked = false;
  // Le tooltip est porté par l'étiquette entière : une case grisée ne reçoit pas le survol.
  etiquette.title = nombre === 0 ? t(texteAide("renommages.appliquer-aucune-operation")) : "";
  etiquette.classList.toggle("desactivee", nombre === 0);
}

document.getElementById("renommage-origine").addEventListener("input", majOptionAppliquer);
majOptionAppliquer();

document.getElementById("renommage-formulaire").addEventListener("submit", async (e) => {
  e.preventDefault();
  const origine = document.getElementById("renommage-origine");
  const nouveau = document.getElementById("renommage-nouveau");
  const appliquer = document.getElementById("renommage-appliquer");
  try {
    const cree = await apiFetch("/renommages", {
      method: "POST",
      body: JSON.stringify({
        nom_origine: origine.value,
        nom_nouveau: nouveau.value,
        appliquer_aux_operations: appliquer.checked && !appliquer.disabled,
      }),
    });
    if (cree && cree.operations_renommees) {
      showMessage(t("{n} opération(s) renommée(s)", { n: cree.operations_renommees }), "success");
    }
    origine.value = "";
    nouveau.value = "";
    appliquer.checked = false;
    majOptionAppliquer();
    await loadRenommages();
  } catch (err) {
    showMessage(err.message, "error");
  }
});

document.getElementById("renommage-recherche").addEventListener("input", renderRenommages);

// LA BARRE SE POSE TOUT DE SUITE, et les données à l'ouverture du sous-onglet : le noyau n'appelle que le
// chargeur de la PREMIÈRE greffe d'une page (celui des règles), pas celui-ci. L'enregistrement n'en est
// pas moins fait, en FIN de fichier (`loadRenommages` doit exister, cf. impots.js).
poserBarreRenommages();
BudgetApp.extensions.enregistrer("renommages", { chargeur: loadRenommages });
