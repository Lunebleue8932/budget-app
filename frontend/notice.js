/**
 * LA NOTICE D'UTILISATION, ET LE TUTORIEL GUIDÉ DE L'IMPORT.
 *
 * POURQUOI UN FICHIER À PART plutôt que trois cents lignes de plus dans app.js :
 * ce qui est ici n'est PAS le comportement de l'application. C'est un écran qui
 * la DÉCRIT, plus un mécanisme — la bulle qui pointe un élément — que rien
 * d'autre n'emploie. Les deux se lisent mieux ensemble qu'au milieu des soldes.
 *
 * CE QU'IL NE FAIT PAS : il n'appelle aucune route d'écriture, ne crée aucune
 * donnée et ne modifie aucun réglage. La notice se lit ; le tutoriel MONTRE où
 * cliquer, et c'est l'utilisateur qui clique.
 *
 * LE TUTORIEL NE BLOQUE PAS L'ÉCRAN, et c'est tout son intérêt : pas de voile
 * par-dessus l'application, pas de clic capturé. La bulle explique, l'élément
 * visé s'allume, et les gestes se font pour de vrai sur le vrai écran — un
 * tutoriel qu'on regarde sans rien toucher n'apprend pas un geste.
 */

/* ---------- L'écran ---------- */

function ouvrirNotice(chapitre) {
  switchSection("notice", { ongletActif: "parametres" });
  if (chapitre) activerChapitreNotice(chapitre);
  loadNotice();
}

function activerChapitreNotice(chapitre) {
  document.querySelectorAll("#notice-sous-nav button").forEach((b) => {
    b.classList.toggle("active", b.dataset.noticeChapitre === chapitre);
  });
  document.querySelectorAll(".notice-chapitre").forEach((bloc) => {
    bloc.classList.toggle("active", bloc.dataset.noticeChapitre === chapitre);
  });
}

/**
 * Ce que la notice ne peut pas écrire d'avance : les extensions réellement
 * présentes sur CETTE installation.
 *
 * L'application est livrée sans aucune extension, et deux installations n'ont
 * donc pas le même menu. Une liste écrite dans le HTML aurait décrit une
 * application que le lecteur n'a pas — exactement ce qu'une notice doit éviter.
 */
async function loadNotice() {
  const liste = document.getElementById("notice-extensions-liste");
  if (!liste) return;
  try {
    const extensions = await apiFetch("/extensions");
    if (!extensions.length) {
      liste.innerHTML = `<p class="hint">${t(
        "Aucune extension n'est installée : l'application fonctionne telle quelle. Les extensions se déposent dans le dossier « extensions », à côté de l'application."
      )}</p>`;
      return;
    }
    // TROIS ÉTATS, ET NON DEUX : une extension du catalogue dont le DOSSIER
    // manque sur cette machine n'est pas « éteinte », elle n'est pas là — et
    // la chercher dans Paramètres → Extensions ne servirait à rien (cf.
    // routers/extensions.list_extensions).
    liste.innerHTML = extensions
      .map((ext) => {
        const etat = !ext.installee
          ? t("non installée")
          : ext.actif
          ? t("allumée")
          : t("éteinte");
        return `
        <div class="notice-extension ${ext.actif ? "notice-extension-active" : ""}">
          <span class="notice-extension-nom">${escapeHtml(t(ext.nom))}</span>
          <span class="notice-extension-etat">${etat}</span>
          <p class="hint">${escapeHtml(t(ext.description || ""))}</p>
        </div>`;
      })
      .join("");
  } catch (err) {
    liste.innerHTML = `<p class="hint">${escapeHtml(err.message)}</p>`;
  }
}

/* ---------- Le tutoriel ----------
 *
 * UNE ÉTAPE DÉCRIT UN ENDROIT, PAS UN CLIC À FORCER. `cible` est l'élément à
 * allumer ; `avant` prépare l'écran quand il faut y être pour voir quelque
 * chose (ouvrir l'onglet Import, déplier un bloc replié). Rien n'est validé :
 * on avance quand on a compris, pas quand on a exécuté — un tutoriel qui refuse
 * d'avancer tant qu'un geste n'est pas fait bloque celui qui l'a déjà fait
 * autrement.
 */

const TUTORIEL_IMPORT = [
  {
    cible: "#parametres-sous-nav",
    titre: "L'import vit dans les Paramètres",
    texte:
      "Tout se passe ici, dans l'onglet « Import ». On vient d'y aller pour toi. Garde cette bulle ouverte : elle suit les étapes pendant que tu regardes l'écran.",
    avant: () => ouvrirSousPageParametres("parametres-import"),
  },
  {
    cible: "#import-preset-chips",
    titre: "1. Le preset",
    texte:
      "Un preset retient la FORME d'un fichier : quelles colonnes lire, et où. Tu en crées un par banque et par type d'export, puis tu ne le règles plus jamais. Le bouton « + Nouveau preset » en crée un ; celui qui est allumé ici est celui qu'on utilise.",
  },
  {
    cible: "#import-preset-compte",
    titre: "2. Le compte de ce preset",
    texte:
      "Si le relevé ne décrit qu'un seul compte — le cas ordinaire — dis-le ici : chaque ligne importée ira sur ce compte, et le fichier n'aura pas à le nommer.",
  },
  {
    cible: "#import-dropzone",
    titre: "3. Le fichier",
    texte:
      "Dépose ton relevé ici, ou clique pour le choisir. Pour t'entraîner, prends le relevé d'exemple téléchargé depuis la notice : c'est un vrai CSV, avec une ligne de titre parasite et trois colonnes dont l'application n'a rien à faire — exactement ce qu'une banque exporte.",
  },
  {
    cible: "#import-apercu-fichier-bloc",
    titre: "4. Le fichier tel qu'il est",
    texte:
      "Ce tableau montre ce que l'application LIT, colonne par colonne. C'est ici qu'on corrige : fais glisser un en-tête sur un autre pour échanger deux colonnes, jusqu'à ce que chaque propriété tombe en face de la bonne. Les colonnes hachurées sont celles que le réglage attend et que le fichier n'a pas.",
    siMasque:
      "Ce tableau apparaît dès qu'un fichier est déposé : reviens à cette étape à ce moment-là.",
  },
  {
    cible: "#import-config-fichier",
    titre: "5. Les réglages qui restent",
    texte:
      "« Lignes de tête » dit combien de lignes du haut ne sont pas des données — le relevé d'exemple en a deux, son titre et la ligne des intitulés. « Colonnes lues » dit la même chose que le glisser-déposer, en numéros. Les réglages de lecture (séparateur, décimale) servent quand les montants ou les colonnes sortent de travers.",
    avant: () => deplierBloc("#import-config-fichier"),
  },
  {
    cible: "#btn-import-config-enregistrer",
    titre: "6. Enregistrer la configuration",
    texte:
      "Ce bouton garde tes réglages DANS le preset : c'est ce qui fait qu'au prochain relevé de la même banque, il n'y aura plus rien à régler. Le bouton de relecture, lui, enregistre aussi — mais relit le fichier dans la foulée pour te montrer le résultat.",
  },
  {
    cible: "#import-mappings-bloc",
    titre: "7. Ce que l'application te demande",
    texte:
      "Les catégories écrites par ta banque ne sont pas les tiennes : tu dis une fois à quoi chacune correspond, et l'application s'en souvient pour tous les imports suivants. Les doublons et les ressemblances se décident au même endroit — un doublon est décoché d'office, une ressemblance te laisse juge.",
    siMasque:
      "Ce bloc n'apparaît que si le fichier apporte des catégories, des comptes ou des devises inconnus.",
  },
  {
    cible: "#import-apercu-bloc",
    titre: "8. L'aperçu, ligne par ligne",
    texte:
      "Rien n'est écrit en base avant ton accord. Chaque ligne se modifie ici : sa catégorie, son type, son compte — et se supprime si elle n'a rien à faire là. Les lignes sont rangées par type d'opération, pour que tu voies d'un coup ce que l'application a compris.",
    siMasque: "L'aperçu apparaît une fois le fichier lu.",
  },
  {
    cible: "#btn-import-confirmer",
    titre: "9. Confirmer",
    texte:
      "C'est le seul geste qui écrit. Et s'il s'avère que le résultat ne te convient pas, l'historique des importations, plus bas, annule un import entier — les opérations qu'il a créées disparaissent, et les dépenses prévues qu'il avait remplacées reviennent telles qu'elles étaient.",
  },
];

let tutorielEtape = 0;
let tutorielActif = false;

function deplierBloc(selecteur) {
  const bloc = document.querySelector(selecteur);
  if (bloc && bloc.tagName === "DETAILS") bloc.open = true;
}

function ouvrirSousPageParametres(sousSection) {
  switchSection("parametres", { sousSection });
}

function bulleTutoriel() {
  let bulle = document.getElementById("tutoriel-bulle");
  if (bulle) return bulle;
  bulle = document.createElement("div");
  bulle.id = "tutoriel-bulle";
  bulle.className = "tutoriel-bulle";
  bulle.setAttribute("role", "dialog");
  bulle.setAttribute("aria-live", "polite");
  document.body.appendChild(bulle);
  // UN SEUL ÉCOUTEUR DÉLÉGUÉ, posé avec la bulle : elle est réécrite à chaque
  // étape, et recâbler ses boutons y laisserait un écouteur de plus par étape.
  bulle.addEventListener("click", (e) => {
    const bouton = e.target.closest("[data-tutoriel]");
    if (!bouton) return;
    if (bouton.dataset.tutoriel === "suivant") allerEtapeTutoriel(tutorielEtape + 1);
    if (bouton.dataset.tutoriel === "precedent") allerEtapeTutoriel(tutorielEtape - 1);
    if (bouton.dataset.tutoriel === "fin") arreterTutoriel();
  });
  return bulle;
}

function eteindreCibleTutoriel() {
  document
    .querySelectorAll(".tutoriel-cible")
    .forEach((el) => el.classList.remove("tutoriel-cible"));
}

/**
 * Pose la bulle contre sa cible, ou au centre quand il n'y a rien à pointer.
 *
 * SOUS LA CIBLE PAR DÉFAUT, AU-DESSUS quand il n'y a plus de place en bas :
 * une bulle qui sort de l'écran ne dit rien, et c'est le cas ordinaire d'un
 * élément situé en bas de page.
 */
function placerBulleTutoriel(bulle, cible) {
  if (!cible) {
    bulle.classList.add("tutoriel-bulle-centree");
    bulle.style.top = "";
    bulle.style.left = "";
    return;
  }
  bulle.classList.remove("tutoriel-bulle-centree");
  const rect = cible.getBoundingClientRect();
  const hauteur = bulle.offsetHeight || 180;
  const largeur = bulle.offsetWidth || 340;
  const marge = 12;
  let haut = rect.bottom + marge;
  if (haut + hauteur > window.innerHeight - marge) {
    haut = Math.max(marge, rect.top - hauteur - marge);
  }
  const gauche = Math.min(
    Math.max(marge, rect.left),
    window.innerWidth - largeur - marge
  );
  bulle.style.top = `${haut}px`;
  bulle.style.left = `${gauche}px`;
}

function allerEtapeTutoriel(index) {
  if (index < 0 || index >= TUTORIEL_IMPORT.length) return arreterTutoriel();
  tutorielEtape = index;
  const etape = TUTORIEL_IMPORT[index];
  eteindreCibleTutoriel();
  if (etape.avant) etape.avant();

  const cible = document.querySelector(etape.cible);
  // UN BLOC MASQUÉ N'EST PAS UNE ERREUR : la moitié de l'écran d'import
  // n'existe qu'une fois un fichier lu. On le dit plutôt que de pointer un
  // rectangle vide — ou, pire, de refuser d'avancer.
  const visible = cible && cible.offsetParent !== null;
  if (visible) {
    cible.classList.add("tutoriel-cible");
    cible.scrollIntoView({ behavior: "smooth", block: "center" });
  }

  const bulle = bulleTutoriel();
  bulle.innerHTML = `
    <div class="tutoriel-entete">
      <span class="tutoriel-compteur">${index + 1} / ${TUTORIEL_IMPORT.length}</span>
      <button type="button" class="tutoriel-fermer" data-tutoriel="fin"
              title="${t("Quitter le tutoriel")}" aria-label="${t("Quitter le tutoriel")}">&times;</button>
    </div>
    <h4>${escapeHtml(t(etape.titre))}</h4>
    <p>${escapeHtml(t(etape.texte))}</p>
    ${
      !visible && etape.siMasque
        ? `<p class="hint">${escapeHtml(t(etape.siMasque))}</p>`
        : ""
    }
    <div class="tutoriel-actions">
      <button type="button" data-tutoriel="precedent" ${index === 0 ? "disabled" : ""}>${t(
        "Précédent"
      )}</button>
      <button type="button" class="primary" data-tutoriel="suivant">${
        index === TUTORIEL_IMPORT.length - 1 ? t("Terminer") : t("Suivant")
      }</button>
    </div>`;
  bulle.style.display = "";
  // APRÈS le rendu : la hauteur de la bulle dépend du texte qu'on vient d'y
  // écrire, et la placer avant la mesurerait vide.
  placerBulleTutoriel(bulle, visible ? cible : null);
}

function demarrerTutoriel() {
  tutorielActif = true;
  allerEtapeTutoriel(0);
}

function arreterTutoriel() {
  tutorielActif = false;
  eteindreCibleTutoriel();
  const bulle = document.getElementById("tutoriel-bulle");
  if (bulle) bulle.style.display = "none";
}

// La bulle est en position fixe : elle doit suivre ce qu'elle désigne quand la
// page bouge sous elle, sinon elle finit par pointer autre chose.
["scroll", "resize"].forEach((evenement) => {
  window.addEventListener(
    evenement,
    () => {
      if (!tutorielActif) return;
      const etape = TUTORIEL_IMPORT[tutorielEtape];
      const cible = document.querySelector(etape.cible);
      placerBulleTutoriel(
        bulleTutoriel(),
        cible && cible.offsetParent !== null ? cible : null
      );
    },
    { passive: true }
  );
});

// Échap ferme le tutoriel, comme toute chose ouverte par-dessus l'application.
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && tutorielActif) arreterTutoriel();
});

/* ---------- Les écouteurs de l'écran ---------- */

document.getElementById("btn-ouvrir-notice")?.addEventListener("click", () => ouvrirNotice());

document.getElementById("btn-notice-retour")?.addEventListener("click", () => {
  arreterTutoriel();
  switchSection("parametres", { sousSection: "parametres-generaux" });
});

document.getElementById("notice-sous-nav")?.addEventListener("click", (e) => {
  const bouton = e.target.closest("button[data-notice-chapitre]");
  if (bouton) activerChapitreNotice(bouton.dataset.noticeChapitre);
});

document.getElementById("btn-notice-tutoriel")?.addEventListener("click", demarrerTutoriel);
