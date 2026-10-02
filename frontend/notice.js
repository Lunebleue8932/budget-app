/**
 * LA NOTICE D'UTILISATION — un écran qui DÉCRIT l'application.
 *
 * POURQUOI UN FICHIER À PART plutôt que trois cents lignes de plus dans app.js :
 * ce qui est ici n'est PAS le comportement de l'application. C'est une page de
 * texte, qui se lit à froid, et dont le seul travail est de rester d'accord avec
 * les écrans qu'elle décrit — d'où ses blocs `data-texte-cle`, qui portent les
 * MÊMES clés que les pastilles « i » des pages décrites.
 *
 * LE TUTORIEL N'EST PLUS ICI (cf. tutoriel.js). Les deux décrivent
 * l'application, mais ne répondent pas à la même question : la notice à
 * « qu'est-ce que c'est ? », qu'on lit avant ou après ; le tutoriel à « où
 * est-ce que je clique ? », qu'on suit devant l'écran. Lancer le second
 * obligeait à ouvrir la première, c'est-à-dire à passer par l'écran de texte
 * qu'on n'allait justement pas lire. Les deux ont désormais leur porte, l'une
 * sous l'autre, dans Paramètres → Paramètres généraux.
 *
 * CE QU'IL NE FAIT PAS : il n'appelle aucune route d'écriture, ne crée aucune
 * donnée et ne modifie aucun réglage. La notice se lit, c'est tout.
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
          <p class="hint">${escapeHtml(t(descriptionExtension(ext)))}</p>
        </div>`;
      })
      .join("");
  } catch (err) {
    liste.innerHTML = `<p class="hint">${escapeHtml(err.message)}</p>`;
  }
}

/* ---------- LES LIENS D'UNE PHRASE D'AIDE ----------
 *
 * Un texte de textes.js peut porter « /Paramètres/Comptes » : le lien bleu que
 * ce marqueur pose (cf. textes.js, `ecrireMorceauAvecChemins`) mène ici au clic.
 *
 * LE CHEMIN DÉSIGNE DES ONGLETS PAR LEUR NOM, tels qu'ils s'affichent, et se
 * résout AU CLIC : dans la langue du moment, et une fois les extensions
 * chargées — leurs onglets n'existent pas quand la notice est écrite. Trois
 * points de départ, dans cet ordre : un bouton de la barre latérale (« Budget »,
 * « Paramètres »), un chapitre de la notice (« Les types d'opérations »), puis
 * n'importe quel onglet d'écran (« Catégories » seul). Chaque étape suivante
 * descend d'un cran : l'onglet de l'écran trouvé, puis un titre de ce volet,
 * vers lequel on fait défiler.
 *
 * LA COMPARAISON IGNORE CASSE, ACCENTS ET PLURIEL : « Les types d'opérations »
 * doit trouver l'onglet « Les types d'opération ». */
function cleChemin(texte) {
  return String(texte || "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(" ")
    .map((mot) => mot.replace(/s$/, ""))
    .join(" ");
}

function boutonNomme(boutons, nom) {
  const cle = cleChemin(nom);
  return [...boutons].find((b) => cleChemin(b.textContent) === cle) || null;
}

/* Le texte d'un titre SANS sa pastille « i » : « Comptes » et non « Comptesi ». */
function texteDuTitre(titre) {
  const copie = titre.cloneNode(true);
  copie.querySelectorAll(".info-bulle").forEach((bulle) => bulle.remove());
  return copie.textContent;
}

/* Le titre d'un volet qui porte ce nom — exactement, ou en commençant par lui :
 * « Paramètres → Catégories » désigne la partie « Catégories de dépenses ». */
function titreNomme(conteneur, nom) {
  const cle = cleChemin(nom);
  return (
    [...conteneur.querySelectorAll("h2, h3, h4, dt")].find((titre) => {
      const cleTitre = cleChemin(texteDuTitre(titre));
      return cleTitre === cle || cleTitre.startsWith(`${cle} `);
    }) || null
  );
}

function defilerVersTitre(conteneur, nom) {
  if (!conteneur || !nom) return;
  titreNomme(conteneur, nom)?.scrollIntoView({ behavior: "smooth", block: "start" });
}

function ouvrirCheminApplication(chemin) {
  const [premiere, ...suite] = String(chemin || "").split("/").filter(Boolean);
  if (!premiere) return false;

  // 1. Un écran de la barre latérale.
  const nav = boutonNomme(document.querySelectorAll("header nav button[data-section]"), premiere);
  if (nav) {
    const section = nav.dataset.section;
    const onglet = suite[0]
      ? boutonNomme(
          document.querySelectorAll(`#${section}-sous-nav button[data-sous-section]`),
          suite[0]
        )
      : null;
    // PAS D'ONGLET À CE NOM : c'est peut-être une PARTIE de page. « Comptes »,
    // « Catégories » ou « Base de données » ont cessé d'être des onglets de
    // Paramètres pour devenir des titres de la page Configuration et des
    // paramètres généraux — le chemin continue de les désigner, on ouvre alors
    // le volet qui porte ce titre et on y défile.
    let voletDeLaPartie = null;
    if (suite[0] && !onglet) {
      voletDeLaPartie =
        [...document.querySelectorAll(`#section-${section} > .sous-section`)].find((v) =>
          titreNomme(v, suite[0])
        ) || null;
    }
    const sousSection = onglet
      ? onglet.dataset.sousSection
      : voletDeLaPartie
      ? voletDeLaPartie.id.replace(/^sous-section-/, "")
      : null;
    switchSection(section, sousSection ? { sousSection } : {});
    const volet = sousSection
      ? document.getElementById(`sous-section-${sousSection}`)
      : document.getElementById(`section-${section}`);
    defilerVersTitre(volet, onglet ? suite[1] : suite[0]);
    return true;
  }

  // 2. Un chapitre de la notice.
  const chapitre = boutonNomme(
    document.querySelectorAll("#notice-sous-nav button[data-notice-chapitre]"),
    premiere
  );
  if (chapitre) {
    const id = chapitre.dataset.noticeChapitre;
    ouvrirNotice(id);
    const bloc = document.querySelector(`.notice-chapitre[data-notice-chapitre="${id}"]`);
    if (suite[0]) defilerVersTitre(bloc, suite[0]);
    else document.getElementById("section-notice")?.scrollIntoView({ block: "start" });
    return true;
  }

  // 3. Un onglet d'écran, nommé seul.
  const onglet = boutonNomme(
    document.querySelectorAll('[id$="-sous-nav"] button[data-sous-section]'),
    premiere
  );
  if (onglet) {
    const section = onglet.closest('[id$="-sous-nav"]').id.replace(/-sous-nav$/, "");
    switchSection(section, { sousSection: onglet.dataset.sousSection });
    defilerVersTitre(document.getElementById(`sous-section-${onglet.dataset.sousSection}`), suite[0]);
    return true;
  }
  return false;
}

// DÉLÉGUÉ SUR LE DOCUMENT : ces liens sont posés par la notice au démarrage,
// par une bulle à chaque ouverture, par une extension à son injection.
document.addEventListener("click", (e) => {
  const lien = e.target.closest && e.target.closest("a.lien-chemin");
  if (!lien) return;
  e.preventDefault();
  if (!ouvrirCheminApplication(lien.dataset.chemin)) {
    // UN CHEMIN QUI NE MÈNE NULLE PART SE DIT : une faute de frappe dans
    // textes.js, ou l'onglet d'une extension éteinte.
    showMessage(`${t("Écran introuvable :")} ${lien.dataset.chemin}`, "error");
  }
});

/* ---------- Les écouteurs de l'écran ---------- */

document.getElementById("btn-ouvrir-notice")?.addEventListener("click", () => ouvrirNotice());

document.getElementById("btn-notice-retour")?.addEventListener("click", () => {
  switchSection("parametres", { sousSection: "parametres-generaux" });
});

document.getElementById("notice-sous-nav")?.addEventListener("click", (e) => {
  const bouton = e.target.closest("button[data-notice-chapitre]");
  if (bouton) activerChapitreNotice(bouton.dataset.noticeChapitre);
});

/**
 * LE TÉLÉCHARGEMENT DU RELEVÉ D'EXEMPLE, et pourquoi ce n'est pas un simple lien.
 *
 * UN LIEN `download` NE TÉLÉCHARGE RIEN dans la fenêtre de bureau : le
 * navigateur embarqué n'a ni barre de téléchargements ni dossier à lui, et le
 * clic ne produit donc aucun effet visible — ce qui se lit comme une panne, et
 * c'est exactement ce qui se passait.
 *
 * ON PASSE DONC PAR LE SÉLECTEUR DU SYSTÈME quand il existe
 * (`window.pywebview.api.enregistrer_texte`, cf. desktop/app_desktop.py) : la
 * page lit le fichier qu'elle sert déjà, et l'API l'écrit où l'utilisateur
 * désigne. L'attribut `download` reste dans le HTML et fait le travail dans un
 * navigateur ordinaire — c'est le comportement de repli, pas un doublon.
 */
document.getElementById("lien-notice-exemple")?.addEventListener("click", async (e) => {
  if (!selecteurNatifDisponible()) return; // navigateur : le lien suffit
  e.preventDefault();
  try {
    const reponse = await fetch(e.currentTarget.getAttribute("href"));
    if (!reponse.ok) throw new Error(`Erreur ${reponse.status}`);
    const chemin = await window.pywebview.api.enregistrer_texte(
      "releve-exemple.csv",
      await reponse.text()
    );
    // Annulé : rien à dire. L'utilisateur vient de fermer le sélecteur, il sait.
    if (chemin) showMessage(`${t("Relevé d'exemple enregistré :")} ${chemin}`, "success");
  } catch (err) {
    showMessage(err.message, "error");
  }
});
