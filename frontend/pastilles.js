/* ---------- LES PASTILLES : une couleur et une icône pour les catégories et les comptes ----------
 *
 * UNE « PUCE » EST UN DISQUE À LA COULEUR DE L'ÉLÉMENT, avec son icône (un emoji) dedans quand on en a
 * choisi une. Elle se pose devant le nom d'une catégorie ou d'un compte dans les listes (page Opérations,
 * Paramètres, Projets) : on lit la couleur avant le mot.
 *
 *   - LA COULEUR D'UNE CATÉGORIE est celle de son histogramme (`categorie.couleur_index`, fixée en base à
 *     la création) : rien à choisir, la même couleur partout.
 *   - CELLE D'UN COMPTE se choisit (`compte.couleur_index`, dans la même palette). Sans choix, un compte
 *     n'a pas de puce — sauf s'il a une icône, auquel cas la puce prend la couleur de son type.
 *   - L'ICÔNE est un EMOJI, choisi dans une grille (`EMOJIS_PREDEFINIS`) ou collé à la main : l'import de
 *     fichiers SVG n'est pas proposé (un fichier qu'on ne contrôle pas ne se pose pas dans la page).
 *
 * CE FICHIER EST CHARGÉ AVANT app.js (qui appelle ces fonctions dès son initialisation) et ne lit les
 * globales de app.js (`state`, `escapeHtml`, `couleurCategorie`, `PALETTE_CATEGORIES`, `t`) qu'À L'APPEL.
 */

/** Les emojis proposés, par famille — ce qu'on met le plus souvent sur une catégorie ou un compte. */
const EMOJIS_PREDEFINIS = [
  { titre: "Argent", emojis: ["💰", "💶", "💵", "💳", "🏦", "🪙", "📈", "📉", "🧾", "💸"] },
  { titre: "Maison", emojis: ["🏠", "🛋️", "🔧", "💡", "🚿", "🧹", "🪴", "🔑"] },
  { titre: "Courses et repas", emojis: ["🛒", "🍎", "🥖", "🍕", "🍔", "☕", "🍷", "🍽️", "🥗"] },
  { titre: "Transports", emojis: ["🚗", "🚌", "🚆", "✈️", "⛽", "🚲", "🛵", "🚕"] },
  { titre: "Loisirs", emojis: ["🎬", "🎮", "🎵", "📚", "⚽", "🏋️", "🎨", "🎟️", "🏖️"] },
  { titre: "Santé et bien-être", emojis: ["💊", "🩺", "🦷", "💇", "🧘", "👓"] },
  { titre: "Vêtements et achats", emojis: ["👕", "👟", "👜", "🎁", "📦", "💄"] },
  { titre: "Famille et études", emojis: ["👶", "🐶", "🎓", "🏫", "🧸"] },
  { titre: "Divers", emojis: ["⭐", "❤️", "🔥", "🎯", "🧩", "📌", "✂️", "🌍", "🧳", "📱", "💻"] },
];

/** La couleur d'un type de compte, quand le compte n'a pas choisi la sienne. */
function couleurPuceTypeCompte(typeNom) {
  if (typeNom === "épargne") return "var(--compte-epargne)";
  if (typeNom === "placements financiers") return "var(--compte-placements)";
  return "var(--compte-courant)";
}

/** La puce : un disque à `couleur`, l'`icone` dedans. Vide quand il n'y a ni l'une ni l'autre. */
function puceHtml(couleur, icone) {
  if (!couleur && !icone) return "";
  const style = couleur ? ` style="--puce:${couleur}"` : "";
  return icone
    ? `<span class="puce puce-icone"${style} aria-hidden="true">${escapeHtml(icone)}</span>`
    : `<span class="puce"${style} aria-hidden="true"></span>`;
}

/** Le nom d'une catégorie, précédé de sa puce (couleur de l'histogramme, icône). « - » sans catégorie. */
function categorieHtml(categorieId) {
  if (categorieId == null) return "-";
  const categorie = state.categories.find((c) => c.id === categorieId);
  if (!categorie) return escapeHtml(nomCategorie(categorieId));
  return (
    `<span class="avec-puce">${puceHtml(couleurDeCategorie(categorie), iconeDeCategorie(categorie))}` +
    `${escapeHtml(libelleCategorie(categorie.nom))}</span>`
  );
}

/** Une catégorie retrouvée par son identifiant (nombre) ou par son nom (texte). */
function categorieConnue(categorie) {
  if (categorie == null) return null;
  return (
    state.categories.find((c) => (typeof categorie === "number" ? c.id === categorie : c.nom === categorie)) || null
  );
}

/**
 * LE NOM D'UNE CATÉGORIE, SOULIGNÉ À SA COULEUR — pour les écrans où la puce n'a pas sa place (listes du
 * dashboard, tableaux des prévisions, des impôts, des objectifs). Sur la page Opérations, c'est la puce qui
 * parle (cf. `categorieHtml`). Accepte un identifiant ou un nom ; sans catégorie connue, le texte tel quel.
 */
function categorieSouligneeHtml(categorie) {
  if (categorie == null) return "-";
  const connue = categorieConnue(categorie);
  if (!connue) {
    return escapeHtml(typeof categorie === "number" ? nomCategorie(categorie) : libelleCategorie(categorie));
  }
  return (
    `<span class="categorie-soulignee" style="--puce:${couleurDeCategorie(connue)}">` +
    `${escapeHtml(libelleCategorie(connue.nom))}</span>`
  );
}

/**
 * LA BANDE ET L'EMOJI DE LA CATÉGORIE, en tête d'une ligne de la page Opérations : la bande est un liseré
 * à gauche de la première cellule (même forme que celui des remboursements et des prêts, qui se range
 * juste à côté), l'emoji se pose devant le nom (cf. `celluleNature`). Sans catégorie, rien.
 */
function marquerCategorieOperation(tr, op) {
  const categorie = categorieConnue(op.categorie_id);
  if (!categorie) return;
  tr.classList.add("avec-categorie");
  tr.style.setProperty("--cat", couleurDeCategorie(categorie));
}

/** Le nom d'un compte, précédé de sa puce — rien devant tant qu'on n'a choisi ni couleur ni icône. */
function compteHtml(compteId) {
  const compte = state.comptes.find((c) => c.id === compteId);
  if (!compte) return escapeHtml(nomCompte(compteId));
  const couleur =
    compte.couleur_index != null
      ? couleurCategorie(compte.couleur_index)
      : compte.icone
        ? couleurPuceTypeCompte(compte.type_nom)
        : null;
  return `<span class="avec-puce">${puceHtml(couleur, compte.icone)}${escapeHtml(compte.nom)}</span>`;
}

/**
 * LE CHAMP « ICÔNE » : un bouton qui montre l'icône choisie (ou « + »), et un panneau qui se déplie dessous
 * avec la grille d'emojis, un champ pour coller le sien et « Retirer ». Le panneau est dans le flux du
 * formulaire (et non une bulle posée par-dessus) : un formulaire ouvert dans un tableau ou un repli ne le
 * rognerait pas. Rend `{ lire, poser }` ; `onChange` n'est appelé qu'aux changements faits à la main.
 */
function creerChampIcone(conteneur, { valeur = null, onChange = () => {} } = {}) {
  let courante = valeur || null;
  conteneur.textContent = "";
  conteneur.classList.add("champ-icone");

  const bouton = document.createElement("button");
  bouton.type = "button";
  bouton.className = "icone-bouton";
  bouton.setAttribute("aria-expanded", "false");

  const panneau = document.createElement("div");
  panneau.className = "icone-panneau";
  panneau.hidden = true;

  const saisie = document.createElement("input");
  saisie.type = "text";
  saisie.maxLength = 16;
  saisie.className = "icone-saisie";
  saisie.placeholder = t("ou colle un emoji");
  saisie.setAttribute("aria-label", t("Icône"));
  saisie.spellcheck = false;

  const retirer = document.createElement("button");
  retirer.type = "button";
  retirer.className = "icone-retirer";
  retirer.textContent = t("Retirer l'icône");

  const entete = document.createElement("div");
  entete.className = "icone-entete";
  entete.append(saisie, retirer);
  panneau.appendChild(entete);

  EMOJIS_PREDEFINIS.forEach((famille) => {
    const titre = document.createElement("div");
    titre.className = "icone-famille";
    titre.textContent = t(famille.titre);
    const grille = document.createElement("div");
    grille.className = "icone-grille";
    famille.emojis.forEach((emoji) => {
      const choix = document.createElement("button");
      choix.type = "button";
      choix.className = "icone-choix";
      choix.textContent = emoji;
      choix.addEventListener("click", () => choisir(emoji));
      grille.appendChild(choix);
    });
    panneau.append(titre, grille);
  });

  function majBouton() {
    bouton.textContent = courante || "+";
    bouton.classList.toggle("vide", !courante);
    bouton.title = courante ? t("Changer l'icône") : t("Choisir une icône");
    bouton.setAttribute("aria-label", bouton.title);
    saisie.value = courante || "";
  }

  function choisir(emoji) {
    courante = (emoji || "").trim() || null;
    majBouton();
    onChange(courante);
  }

  bouton.addEventListener("click", () => {
    panneau.hidden = !panneau.hidden;
    bouton.setAttribute("aria-expanded", String(!panneau.hidden));
  });
  retirer.addEventListener("click", () => choisir(null));
  // Ce qu'on tape ou colle devient l'icône, sans bouton « valider » : un champ qu'il faut confirmer
  // se perd à la première fermeture du formulaire.
  saisie.addEventListener("input", () => {
    courante = saisie.value.trim() || null;
    bouton.textContent = courante || "+";
    bouton.classList.toggle("vide", !courante);
    onChange(courante);
  });
  // Entrée dans le champ : ne valide pas le formulaire entier (ce serait enregistrer le compte par erreur).
  saisie.addEventListener("keydown", (e) => {
    if (e.key === "Enter") e.preventDefault();
  });

  conteneur.append(bouton, panneau);
  majBouton();

  return {
    lire: () => courante,
    poser: (nouvelle) => {
      courante = nouvelle || null;
      majBouton();
      panneau.hidden = true;
      bouton.setAttribute("aria-expanded", "false");
    },
  };
}

/**
 * LE CHAMP « COULEUR » d'un compte : les couleurs de la palette des catégories en pastilles à cliquer, et
 * « Aucune » (qui remet la couleur du type). Rend `{ lire, poser }`.
 */
function creerChampCouleur(conteneur, { valeur = null, onChange = () => {} } = {}) {
  let courante = valeur ?? null;
  conteneur.textContent = "";
  conteneur.classList.add("champ-couleur");

  const boutons = [];
  const aucune = document.createElement("button");
  aucune.type = "button";
  aucune.className = "couleur-aucune";
  aucune.textContent = t("Aucune");
  aucune.addEventListener("click", () => choisir(null));
  conteneur.appendChild(aucune);

  PALETTE_CATEGORIES.forEach((couleur, index) => {
    const bouton = document.createElement("button");
    bouton.type = "button";
    bouton.className = "couleur-choix";
    bouton.style.setProperty("--puce", couleur);
    bouton.setAttribute("aria-label", `${t("Couleur")} ${index + 1}`);
    bouton.addEventListener("click", () => choisir(index));
    conteneur.appendChild(bouton);
    boutons.push(bouton);
  });

  function maj() {
    aucune.classList.toggle("choisie", courante == null);
    boutons.forEach((bouton, index) => {
      const choisie = courante === index;
      bouton.classList.toggle("choisie", choisie);
      bouton.setAttribute("aria-pressed", String(choisie));
    });
  }

  function choisir(index) {
    courante = index;
    maj();
    onChange(courante);
  }

  maj();
  return {
    lire: () => courante,
    poser: (nouvelle) => {
      courante = nouvelle ?? null;
      maj();
    },
  };
}
