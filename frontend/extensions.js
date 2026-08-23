/**
 * Chargement des extensions côté navigateur.
 *
 * PENDANT FRONTEND de app/extensions.py. Le serveur dit quelles extensions
 * sont présentes et lesquelles sont actives (GET /extensions) ; ce module va
 * chercher leurs fichiers, injecte leur écran dans la page et leur donne un
 * point d'accroche pour s'enregistrer.
 *
 * DÉROULÉ, dans cet ordre et pas un autre :
 *
 *   1. GET /extensions          -> la liste et l'état de chacune
 *   2. pour chaque extension ACTIVE : CSS, puis fragment HTML, puis JS
 *   3. le JS appelle BudgetApp.extensions.enregistrer(...) en s'exécutant
 *   4. l'entrée de navigation apparaît
 *
 * Le HTML AVANT le JS : le script d'une extension accroche ses écouteurs sur
 * les éléments de son écran dès son exécution ; l'inverse le ferait travailler
 * sur une page où rien de tout cela n'existe encore.
 *
 * RIEN N'EST CHARGÉ D'UNE EXTENSION INACTIVE — ni sa feuille de style, ni son
 * écran, ni une ligne de son script. « Inactive » doit vouloir dire « ne
 * tourne pas », pas « tourne mais son bouton est caché » : depuis qu'une
 * extension peut ouvrir une connexion sortante (« placements-web »), la
 * nuance a cessé d'être théorique.
 *
 * Les fichiers sont donc chargés AU MOMENT OÙ ON L'ALLUME (cf.
 * `appliquerActivation`), ce qui évite quand même le rechargement de la page —
 * la propriété à laquelle tenait le chargement systématique d'avant.
 *
 * L'ÉTEINDRE, EN REVANCHE, NE DÉCHARGE RIEN : on ne retire pas un script d'une
 * page. Ses routes répondent 404 (`exiger_extension`), son bouton disparaît, et
 * son code dort jusqu'au prochain lancement où il ne sera plus chargé du tout.
 *
 * TOUT ÉCHEC EST LOCAL À UNE EXTENSION : une extension dont le JS casse ne
 * doit pas empêcher les autres de se charger, ni l'application de s'ouvrir.
 */

// Espace de noms unique exposé aux extensions. Volontairement minuscule : plus
// il offre de choses, plus il devient difficile de le faire évoluer sans
// casser les extensions écrites contre lui.
window.BudgetApp = window.BudgetApp || {};

const extensionsChargees = new Map(); // id -> { manifeste, chargeur }

window.BudgetApp.extensions = {
  /**
   * Appelé par le JS d'une extension au moment où il s'exécute.
   *
   * `chargeur` est rappelé à chaque fois que l'utilisateur ouvre l'écran de
   * l'extension — comme loadDashboard() ou loadOperations() pour les écrans
   * du noyau, et pour la même raison : les données ont pu changer depuis la
   * dernière visite.
   */
  enregistrer(id, { chargeur } = {}) {
    const entree = extensionsChargees.get(id);
    if (!entree) {
      console.warn(`Extension inconnue à l'enregistrement : ${id}`);
      return;
    }
    entree.chargeur = chargeur || null;
  },

  /** Les extensions présentes, actives ou non (lecture seule). */
  liste() {
    return [...extensionsChargees.values()].map((e) => e.manifeste);
  },

  /** Vrai si l'extension est présente ET activée. */
  estActive(id) {
    const entree = extensionsChargees.get(id);
    return Boolean(entree && entree.manifeste.actif);
  },

  /**
   * Ouvre l'écran d'une extension. Rend false si l'extension n'a pas d'écran
   * à ouvrir : l'appelant (switchSection) sait alors que la section demandée
   * ne le concerne pas.
   */
  async ouvrir(section) {
    return appelerChargeur((nav) => nav.type === "page" && nav.section === section);
  },

  /**
   * Pendant de `ouvrir` pour les SOUS-PAGES de Paramètres (« Base de
   * données » en version développeur). Séparé parce que les deux espaces de
   * noms sont indépendants : rien n'interdit qu'un écran principal et une
   * sous-page de réglages portent le même nom.
   */
  async ouvrirSousPage(sousSection) {
    return appelerChargeur(
      (nav) => nav.type === "parametres" && `parametres-${nav.sous_section}` === sousSection
    );
  },
};

/** Appelle le chargeur de la première extension dont la navigation correspond. */
async function appelerChargeur(correspond) {
  const entree = [...extensionsChargees.values()].find(
    (e) => e.manifeste.navigation && correspond(e.manifeste.navigation)
  );
  if (!entree || !entree.chargeur) return false;
  try {
    await entree.chargeur();
  } catch (err) {
    console.error(`Extension ${entree.manifeste.id} : échec du chargement`, err);
  }
  return true;
}

function urlFichier(id, fichier) {
  return `/extensions/${encodeURIComponent(id)}/fichiers/${fichier}`;
}

function chargerCss(id, fichier) {
  return new Promise((resolve) => {
    const lien = document.createElement("link");
    lien.rel = "stylesheet";
    lien.href = urlFichier(id, fichier);
    // On résout dans les deux cas : une feuille de style manquante dégrade
    // l'apparence, elle n'empêche pas la fonctionnalité de marcher.
    lien.onload = resolve;
    lien.onerror = resolve;
    document.head.appendChild(lien);
  });
}

function chargerJs(id, fichier) {
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = urlFichier(id, fichier);
    script.onload = resolve;
    script.onerror = () => reject(new Error(`script introuvable : ${fichier}`));
    document.body.appendChild(script);
  });
}

/**
 * Injecte l'écran d'une extension dans <main>, comme une section de plus.
 *
 * Le fragment fourni par l'extension est un `<section id="section-...">`
 * complet : il se comporte donc exactement comme les écrans du noyau, y
 * compris pour switchSection qui les montre et les cache par cette classe.
 */
async function injecterHtml(id, fichier, navigation) {
  const reponse = await fetch(urlFichier(id, fichier));
  if (!reponse.ok) throw new Error(`fragment introuvable : ${fichier}`);
  const html = await reponse.text();
  // Un écran principal est une <section> de plus dans <main> ; une sous-page
  // de réglages est une .sous-section de plus dans la section Paramètres. Les
  // deux se comportent ensuite exactement comme leurs homologues du noyau.
  const hote =
    navigation && navigation.type === "parametres"
      ? document.getElementById("section-parametres")
      : document.querySelector("main");
  // insertAdjacentHTML plutôt que innerHTML += : réécrire tout le contenu de
  // l'hôte détruirait et recréerait les écrans du noyau, et avec eux tous les
  // écouteurs que app.js y a déjà posés.
  hote.insertAdjacentHTML("beforeend", html);

  // TRADUIRE LE FRAGMENT QU'ON VIENT DE POSER. app.js traduit `document.body`
  // au tout début, bien avant que les extensions ne soient lues : sans ce
  // rappel, un écran d'extension resterait en français dans une application
  // passée à l'anglais. La condition de sûreté de traduireDomStatique tient
  // toujours — le fragment sort d'un fichier de l'extension, aucune donnée de
  // l'utilisateur n'y a encore été rendue.
  traduireDomStatique(hote.lastElementChild);
}

/**
 * Ajoute l'entrée de navigation d'une extension, à sa position déclarée.
 *
 * Le bouton est créé même pour une extension DÉSACTIVÉE, puis simplement
 * masqué : basculer l'extension n'a plus qu'à changer un `display`, sans
 * reconstruire la barre ni recharger la page.
 */
function ajouterNavigation(manifeste) {
  const navigation = manifeste.navigation;
  if (!navigation) return;

  const bouton = document.createElement("button");
  bouton.type = "button";
  bouton.dataset.extension = manifeste.id;
  bouton.textContent = t(navigation.libelle);
  bouton.style.display = manifeste.actif ? "" : "none";

  if (navigation.type === "parametres") {
    // Onglet de réglages : le clic est pris en charge par les gestionnaires
    // délégués de app.js (affichage ET chargement), exactement comme pour un
    // onglet du noyau — rien à câbler ici.
    bouton.dataset.sousSection = `parametres-${navigation.sous_section}`;
    document.getElementById("parametres-sous-nav").appendChild(bouton);
    return;
  }

  const barre = document.querySelector("header nav");
  bouton.dataset.section = navigation.section;
  bouton.addEventListener("click", () => switchSection(navigation.section));

  // `position` est un rang souhaité, pas un index de tableau : on l'insère
  // avant le premier bouton du noyau de rang supérieur, et à la fin si aucun.
  // Un rang absent ou en doublon ne casse donc rien, il place seulement le
  // bouton un cran plus loin.
  const boutons = [...barre.querySelectorAll("button")];
  const rang = Number(navigation.position);
  const suivant = Number.isFinite(rang) ? boutons[rang] : null;
  barre.insertBefore(bouton, suivant || null);
}

function majVisibiliteNavigation(id, actif) {
  document
    .querySelectorAll(`button[data-extension="${id}"]`)
    .forEach((bouton) => (bouton.style.display = actif ? "" : "none"));
}

/**
 * Charge les fichiers d'une extension : CSS, puis écran, puis script.
 *
 * Appelée au démarrage pour les extensions déjà allumées, et à la volée quand
 * l'utilisateur en coche une (fenêtre de lancement ou Paramètres). Le même
 * chemin dans les deux cas : allumer une extension doit produire exactement ce
 * qu'aurait produit un redémarrage, sans le redémarrage.
 */
async function chargerFichiers(manifeste) {
  const fichiers = manifeste.frontend || {};
  for (const css of fichiers.css || []) {
    await chargerCss(manifeste.id, css);
  }
  if (fichiers.html) {
    await injecterHtml(manifeste.id, fichiers.html, manifeste.navigation);
    ajouterNavigation(manifeste);
  }
  for (const js of fichiers.js || []) {
    await chargerJs(manifeste.id, js);
  }
}

/**
 * Applique une bascule décidée par l'utilisateur, sans recharger la page.
 *
 * Trois choses, et l'ordre compte : l'état retenu ici (c'est lui que lisent
 * les extensions via `estActive`), les fichiers si c'est un premier
 * allumage, la barre de navigation ensuite.
 *
 * Rend `false` si l'allumage a échoué (fichier manquant) : l'appelant peut
 * alors le dire, plutôt que d'afficher un bouton qui n'ouvre rien.
 */
async function appliquerActivation(id, actif) {
  const entree = extensionsChargees.get(id);
  if (!entree) return false;
  entree.manifeste.actif = actif;

  if (actif && !entree.fichiersCharges) {
    try {
      await chargerFichiers(entree.manifeste);
      entree.fichiersCharges = true;
      // POUR LES GREFFES. Une extension qui se pose sur l'écran d'une autre
      // (« placements-web » sur « placements ») n'a d'hôte que si celui-ci a
      // été chargé avant elle. Allumer les deux dans le désordre au cours
      // d'une même session est parfaitement possible : cet événement lui donne
      // le moyen de s'accrocher en retard, au lieu d'attendre un redémarrage.
      document.dispatchEvent(
        new CustomEvent("budgetapp:extension-chargee", { detail: { id } })
      );
    } catch (err) {
      console.error(`Extension ${id} : ${err.message}`);
      entree.manifeste.actif = false;
      return false;
    }
  }
  majVisibiliteNavigation(id, actif);
  return true;
}

window.BudgetApp.extensions.majVisibilite = majVisibiliteNavigation;
window.BudgetApp.extensions.appliquerActivation = appliquerActivation;

// Extensions actuellement annoncées par la fenêtre : acquittées auprès du
// serveur à sa fermeture, quel que soit le geste qui l'a fermée.
let extensionsAnnoncees = [];

/**
 * Annonce les extensions trouvées au lancement, UNE SEULE FOIS CHACUNE, et
 * propose de les allumer.
 *
 * POURQUOI CETTE ANNONCE EXISTE. L'application est livrée SANS aucune
 * extension : le dossier `extensions/` arrive vide, et c'est l'utilisateur qui
 * y dépose ce qu'il télécharge. En trouver au démarrage n'est donc jamais
 * banal — c'est la confirmation que ce qu'il vient d'installer a bien été vu,
 * et le seul moment où l'on peut le lui dire avant qu'il aille le chercher.
 *
 * CE N'EST PAS UNE CONFIRMATION, C'EST UNE DEMANDE. Une extension trouvée est
 * INACTIVE (cf. app/extensions.py::est_active) : cette fenêtre est l'endroit
 * où on l'allume, en cochant sa case. La fermer — bouton, Échap, clic à côté —
 * n'allume rien, par construction : le seul écouteur qui active est celui de
 * la case. Ce qui reste vrai même si la fenêtre est fermée par accident, et
 * c'est bien le but.
 *
 * SEULEMENT CELLES JAMAIS ANNONCÉES (`nouvelle`, cf. app/extensions.py). Une
 * fois l'installation confirmée, redire la même chose à chaque démarrage n'
 * apprendrait plus rien et deviendrait une porte à claquer avant d'atteindre
 * son budget. L'état est retenu côté SERVEUR, pas dans le navigateur : c'est
 * une propriété de l'installation, et le stockage local d'une fenêtre webview
 * ne survit pas toujours à une mise à jour de l'application.
 */
function afficherModaleExtensions(extensions) {
  const nouvelles = extensions.filter((e) => e.nouvelle);
  if (nouvelles.length === 0) return;
  extensionsAnnoncees = nouvelles.map((e) => e.id);

  const fond = document.getElementById("modale-extensions");
  document.getElementById("modale-extensions-texte").textContent =
    nouvelles.length === 1
      ? t(
          "Une extension a été trouvée dans le dossier « extensions ». Elle ne " +
            "fonctionnera qu'une fois cochée ci-dessous — fermer cette fenêtre " +
            "ne l'active pas."
        )
      : t(
          "{n} extensions ont été trouvées dans le dossier « extensions ». Elles " +
            "ne fonctionneront qu'une fois cochées ci-dessous — fermer cette " +
            "fenêtre n'en active aucune.",
          { n: nouvelles.length }
        );

  document.getElementById("modale-extensions-liste").innerHTML = nouvelles
    .map(
      (e) => `<li>
        <label class="modale-extension-bascule">
          <input type="checkbox" data-activer-extension="${escapeHtml(e.id)}"
                 ${e.actif ? "checked" : ""} />
          <span class="modale-extension-nom">${escapeHtml(e.nom)}</span>
          ${e.version ? `<span class="modale-extension-version">v${escapeHtml(e.version)}</span>` : ""}
        </label>
        ${
          e.description
            ? `<p class="modale-extension-description">${escapeHtml(e.description)}</p>`
            : ""
        }
      </li>`
    )
    .join("");

  fond.style.display = "";
  // La page derrière ne doit plus défiler : une molette au-dessus d'une modale
  // fait sinon glisser le contenu grisé, ce qui donne l'impression que le clic
  // est passé au travers.
  document.body.classList.add("modale-ouverte");
  // LE FOCUS VA SUR LA PREMIÈRE CASE, pas sur un bouton : la décision à
  // prendre est là, et une fenêtre qui met le focus sur sa sortie invite à
  // sortir. Tab circule ensuite dans la fenêtre plutôt que dans la page grisée
  // derrière.
  const premiere = fond.querySelector("input[data-activer-extension]");
  (premiere || document.getElementById("btn-modale-extensions-aller")).focus();
}

/**
 * Cocher une case ALLUME l'extension, sur-le-champ.
 *
 * C'est le seul geste qui l'allume : ni l'ouverture de cette fenêtre, ni sa
 * fermeture (bouton, Échap, clic à côté) ne touchent à l'activation. La case
 * revient à sa position si le serveur refuse — l'écran doit dire l'état réel,
 * pas l'intention.
 */
document
  .getElementById("modale-extensions-liste")
  .addEventListener("change", async (evenement) => {
    const case_ = evenement.target.closest("input[data-activer-extension]");
    if (!case_) return;
    const id = case_.dataset.activerExtension;
    const actif = case_.checked;
    case_.disabled = true;
    try {
      await apiFetch(`/extensions/${encodeURIComponent(id)}`, {
        method: "PUT",
        body: JSON.stringify({ actif }),
      });
      const abouti = await BudgetApp.extensions.appliquerActivation(id, actif);
      if (!abouti && actif) {
        throw new Error(t("Extension non chargée"));
      }
      showMessage(
        actif
          ? t("Extension activée.")
          : t("Extension désactivée. Aucune donnée n'a été supprimée."),
        "success"
      );
    } catch (err) {
      case_.checked = !actif;
      showMessage(err.message, "error");
    } finally {
      case_.disabled = false;
    }
  });

/**
 * Ferme la fenêtre et ACQUITTE les extensions qu'elle annonçait : elles ne la
 * déclencheront plus au prochain lancement.
 *
 * L'acquittement part À LA FERMETURE, jamais à l'ouverture : « annoncée » veut
 * dire « vue et fermée ». Si l'application se ferme pendant que la fenêtre est
 * encore ouverte, rien n'a été acquitté et l'annonce revient — ce qui est le
 * comportement voulu, l'utilisateur n'ayant rien lu.
 *
 * L'échec de l'appel n'est pas remonté à l'écran : la conséquence est de
 * revoir la fenêtre une fois de plus, pas de perdre quoi que ce soit. Une
 * alerte d'erreur coûterait plus d'attention que le problème qu'elle
 * signale.
 */
function fermerModaleExtensions() {
  document.getElementById("modale-extensions").style.display = "none";
  document.body.classList.remove("modale-ouverte");

  if (extensionsAnnoncees.length === 0) return;
  const ids = extensionsAnnoncees;
  extensionsAnnoncees = []; // évite un second envoi si la fermeture se rejoue
  apiFetch("/extensions/annoncees", {
    method: "POST",
    body: JSON.stringify({ ids }),
  }).catch((err) => console.warn("Annonce non acquittée :", err.message));
}

document
  .getElementById("btn-modale-extensions-fermer")
  .addEventListener("click", fermerModaleExtensions);

document.getElementById("btn-modale-extensions-aller").addEventListener("click", () => {
  fermerModaleExtensions();
  switchSection("parametres");
  // Le clic sur l'onglet plutôt qu'un appel direct : c'est lui qui porte à la
  // fois l'affichage de la sous-page et le chargement de ses données (cf. les
  // deux gestionnaires délégués de app.js).
  document
    .querySelector('#parametres-sous-nav button[data-sous-section="parametres-extensions"]')
    ?.click();
});

// Clic sur le fond (hors de la boîte) et Échap : les deux sorties qu'on essaie
// d'instinct sur une modale. Rien n'est perdu en fermant — l'information reste
// dans Paramètres → Extensions.
document.getElementById("modale-extensions").addEventListener("click", (e) => {
  if (e.target.id === "modale-extensions") fermerModaleExtensions();
});

document.addEventListener("keydown", (e) => {
  if (e.key !== "Escape") return;
  if (document.getElementById("modale-extensions").style.display !== "none") {
    fermerModaleExtensions();
  }
});

/**
 * Charge toutes les extensions. Appelé une fois, au démarrage de app.js,
 * AVANT le premier rendu : une extension qui ajoute un écran doit avoir posé
 * son bouton avant que l'utilisateur ne regarde la barre de navigation.
 */
async function chargerExtensions() {
  let extensions;
  try {
    extensions = await apiFetch("/extensions");
  } catch (err) {
    // Une application sans extensions doit continuer de fonctionner : c'est
    // le cas normal d'une installation minimale, pas une panne.
    console.warn("Extensions indisponibles :", err.message);
    return;
  }

  const annoncables = [];
  for (const manifeste of extensions) {
    extensionsChargees.set(manifeste.id, {
      manifeste,
      chargeur: null,
      fichiersCharges: false,
    });
    if (!manifeste.actif) {
      // Éteinte : on ne touche à aucun de ses fichiers. Elle reste annonçable
      // — c'est même tout l'objet de la fenêtre de lancement, proposer de
      // l'allumer.
      annoncables.push(manifeste);
      continue;
    }
    try {
      await chargerFichiers(manifeste);
      extensionsChargees.get(manifeste.id).fichiersCharges = true;
      annoncables.push(manifeste);
    } catch (err) {
      // Une extension allumée dont les fichiers manquent n'est pas annoncée :
      // proposer de l'ouvrir enverrait chercher un écran qui n'existe pas. Son
      // erreur, elle, reste visible dans Paramètres → Extensions.
      console.error(`Extension ${manifeste.id} : ${err.message}`);
    }
  }

  afficherModaleExtensions(annoncables);
}
