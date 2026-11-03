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

function renderRenommages() {
  const liste = document.getElementById("renommages-liste");
  const filtre = document
    .getElementById("renommage-recherche")
    .value.trim()
    .toLowerCase();
  const visibles = renommagesCharges.filter(
    (r) =>
      !filtre ||
      r.nom_origine.toLowerCase().includes(filtre) ||
      r.nom_nouveau.toLowerCase().includes(filtre)
  );
  document.getElementById("renommage-compte").textContent = t("{n} renommage(s)", {
    n: renommagesCharges.length,
  });
  liste.innerHTML = "";
  if (!visibles.length) {
    liste.innerHTML = `<p class="hint">${escapeHtml(
      renommagesCharges.length
        ? t("Aucun renommage ne correspond à cette recherche.")
        : t("Aucun renommage pour le moment : renomme une opération, ou ajoutes-en un ci-dessus.")
    )}</p>`;
    return;
  }
  visibles.forEach((r) => {
    const ligne = document.createElement("div");
    ligne.className = "renommage-ligne";
    ligne.innerHTML = `
      <div class="renommage-noms">
        <div class="renommage-nouveau">${escapeHtml(r.nom_nouveau)}</div>
        <div class="renommage-ancien">(${escapeHtml(r.nom_origine)})</div>
      </div>
      <span class="renommage-origine">${escapeHtml(t(LIBELLES_ORIGINE_RENOMMAGE[r.origine] || r.origine))}</span>
      <button type="button" data-action="modifier">${t("Modifier")}</button>
      <button type="button" data-action="supprimer" class="danger">${t("Supprimer")}</button>`;
    ligne.querySelector("[data-action='modifier']").addEventListener("click", () => modifierRenommage(r));
    ligne.querySelector("[data-action='supprimer']").addEventListener("click", async () => {
      if (!confirm(t("Oublier le renommage « {nom} » ?", { nom: r.nom_origine }))) return;
      try {
        await apiFetch(`/renommages/${r.id}`, { method: "DELETE" });
        await loadRenommages();
      } catch (err) {
        showMessage(err.message, "error");
      }
    });
    liste.appendChild(ligne);
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
