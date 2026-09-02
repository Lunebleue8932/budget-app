/* ---------- Extension « Vue d'ensemble des placements » ----------
 *
 * CE QUE CET ÉCRAN AJOUTE. La page Placements répond « qu'y a-t-il sur ce
 * PEA » : un onglet par compte, et le détail de ses lignes. Elle n'a aucun
 * moyen de répondre « à quoi suis-je exposé, en tout » — la question qu'on se
 * pose quand on détient le même ETF sur deux comptes et qu'on veut savoir ce
 * qu'il pèse. C'est celle-là, et rien d'autre pour l'instant.
 *
 * IL NE CALCULE RIEN LUI-MÊME. Les parts, les pourcentages et le détail de
 * chacune viennent de `/investing-overview/exposition`. Deux calculs séparés —
 * l'angle ici, le pourcentage là — finiraient par ne plus tomber d'accord à
 * l'arrondi, et c'est précisément ce qu'un camembert donne à comparer.
 *
 * UN ONGLET PAR MONNAIE, comme le dashboard : rien ne permet d'additionner des
 * euros et des dollars (cf. models.Monnaie), et un camembert qui les
 * mélangerait donnerait des parts fausses avec l'air d'être juste.
 *
 * CHARGÉ PAR frontend/extensions.js après l'injection de page.html : le script
 * s'exécute en portée globale et a donc accès à tout ce que app.js expose
 * (apiFetch, formatMontant, escapeHtml, showMessage, t, switchSection…).
 */

const IO_ID = "investing-overview";
const IO_HOTE = "placements";

// La dernière exposition lue, et la monnaie regardée. Gardées pour que
// rebasculer d'un onglet à l'autre ne redemande pas au serveur : les deux
// répartitions viennent du même appel.
let ioExposition = [];
let ioMonnaieId = null;

/* ---------- Couleurs ----------
 *
 * MÊME PALETTE QUE LES CATÉGORIES, et à dessein : l'application n'a qu'un jeu
 * de couleurs catégorielles, et en introduire un second ferait cohabiter deux
 * langages sur des écrans voisins.
 *
 * L'INDEX EST CELUI DU TYPE, pas sa position dans le camembert. Un type dont la
 * valeur passe devant un autre ne doit pas échanger sa couleur avec lui : on
 * comparerait alors deux camemberts d'un mois à l'autre en croyant lire la même
 * chose. `type_titre_id` est stable et fait donc un index tout trouvé.
 */

// Le gris des titres SANS étiquette. Volontairement hors palette : ce n'est pas
// un type de plus, c'est l'absence de type, et lui donner une couleur franche
// le ferait lire comme une catégorie qu'on aurait nommée.
const IO_COULEUR_SANS_TYPE = "#6b7080";

function ioCouleurPart(part) {
  if (part.type_titre_id == null) return IO_COULEUR_SANS_TYPE;
  return couleurCategorie(part.type_titre_id);
}

function ioNomPart(part) {
  return part.type_titre_nom || t("Sans type");
}

/* ---------- Le camembert ---------- */

// Rayons du disque, en unités du viewBox. Un ANNEAU plutôt qu'un disque plein :
// le trou central porte le total, qui serait sinon une ligne de plus à lire à
// côté du graphe.
const IO_RAYON = 100;
const IO_RAYON_INTERIEUR = 58;
const IO_CENTRE = 120;

/**
 * Le tracé SVG d'une part, d'un angle à l'autre.
 *
 * Les angles sont comptés en RADIANS depuis midi et dans le sens des aiguilles
 * d'une montre — la façon dont on lit un camembert. Le `large-arc-flag` bascule
 * au-delà d'un demi-tour, sans quoi une part majoritaire serait dessinée par son
 * complément et donnerait un anneau à l'envers.
 */
function ioArc(angleDebut, angleFin) {
  const point = (angle, rayon) => [
    IO_CENTRE + rayon * Math.sin(angle),
    IO_CENTRE - rayon * Math.cos(angle),
  ];
  const [xExtDebut, yExtDebut] = point(angleDebut, IO_RAYON);
  const [xExtFin, yExtFin] = point(angleFin, IO_RAYON);
  const [xIntFin, yIntFin] = point(angleFin, IO_RAYON_INTERIEUR);
  const [xIntDebut, yIntDebut] = point(angleDebut, IO_RAYON_INTERIEUR);
  const grandArc = angleFin - angleDebut > Math.PI ? 1 : 0;
  return [
    `M ${xExtDebut} ${yExtDebut}`,
    `A ${IO_RAYON} ${IO_RAYON} 0 ${grandArc} 1 ${xExtFin} ${yExtFin}`,
    `L ${xIntFin} ${yIntFin}`,
    `A ${IO_RAYON_INTERIEUR} ${IO_RAYON_INTERIEUR} 0 ${grandArc} 0 ${xIntDebut} ${yIntDebut}`,
    "Z",
  ].join(" ");
}

/**
 * Le contenu de l'infobulle d'une part : les titres qui la composent, du plus
 * lourd au plus léger.
 *
 * MÊME FORME QUE CELLE DE L'HISTOGRAMME DES DÉPENSES (cf. app.js,
 * `contenuInfobulleHistogramme`) — mêmes classes, même mise en page, même
 * limite à trois lignes. Deux graphes voisins qui répondraient différemment au
 * survol demanderaient d'apprendre deux fois le même geste.
 *
 * Le nombre entre parenthèses est celui des COMPTES sur lesquels le titre est
 * détenu, et il ne s'affiche qu'à partir de deux — « (1) » n'apprendrait rien
 * et mettrait une parenthèse au bout de presque chaque ligne.
 */
function ioContenuInfobulle(part, monnaieId) {
  const lignes = part.titres
    .map((titre) => {
      const comptes =
        titre.nombre_comptes > 1
          ? ` <i class="histo-bulle-compte">(${t("{n} comptes", {
              n: titre.nombre_comptes,
            })})</i>`
          : "";
      return `<li>
        <span class="histo-bulle-nature">${escapeHtml(titre.action_nom)}${comptes}</span>
        <span class="histo-bulle-montant">${formatMontant(titre.valorisation, monnaieId)}</span>
      </li>`;
    })
    .join("");

  // « et N autres » plutôt qu'une liste qui s'allonge : la bulle finirait par
  // couvrir le graphe qu'elle commente.
  const reste = part.nombre_titres - part.titres.length;
  const suite =
    reste > 0
      ? `<li class="io-bulle-reste"><span class="histo-bulle-nature">${t(
          "et {n} autre(s)",
          { n: reste }
        )}</span></li>`
      : "";

  return `<div class="histo-bulle-titre">${escapeHtml(ioNomPart(part))} —
      ${(part.part * 100).toFixed(1)} %</div>
    <ul class="histo-bulle-liste">${lignes}${suite}</ul>`;
}

/**
 * Place l'infobulle À DROITE DU DISQUE, à la hauteur du curseur.
 *
 * PAS TOUT À FAIT COMME CELLE DE L'HISTOGRAMME, et la différence tient à la
 * forme du graphe. Une barre est haute et étroite : une bulle posée à côté du
 * curseur tombe naturellement dans le vide. Un anneau est large et rond, et le
 * curseur est forcément DESSUS quand on survole une part — une bulle qui le
 * suivrait horizontalement se poserait donc toujours sur le graphe qu'elle
 * commente, quel que soit le sens du recadrage.
 *
 * Elle suit en revanche le curseur EN HAUTEUR, ce qui suffit à la rattacher à
 * la part qu'on regarde, et se recadre vers le haut quand elle déborderait en
 * bas. Le cadre de référence est le bloc entier (graphe + légende) : le seul
 * disque ne fait que 240 pixels et ne laisserait aucune place.
 */
function ioPlacerInfobulle(bulle, cadreElement, evenement) {
  const cadre = cadreElement.getBoundingClientRect();
  const disque = document.getElementById("io-camembert").getBoundingClientRect();
  const marge = 14;

  let x = disque.right - cadre.left + marge;
  // Le bloc passe en colonne sur un écran étroit (cf. la feuille de style) :
  // le disque occupe alors toute la largeur, et il ne reste plus de « à côté ».
  // On revient dans ce cas au bord gauche, sous le graphe.
  if (x + bulle.offsetWidth > cadre.width) x = 0;

  let y = evenement.clientY - cadre.top + marge;
  if (y + bulle.offsetHeight > cadre.height) {
    y = evenement.clientY - cadre.top - bulle.offsetHeight - marge;
  }
  bulle.style.left = `${Math.max(0, x)}px`;
  bulle.style.top = `${Math.max(0, y)}px`;
}

function ioRenderCamembert(bloc) {
  const conteneur = document.getElementById("io-camembert");
  conteneur.innerHTML = "";
  // Le cadre de l'infobulle : tout le bloc, pas le seul disque (cf.
  // ioPlacerInfobulle).
  const cadre = document.querySelector(".io-camembert-bloc");

  const total = bloc.total;
  let angle = 0;
  const parts = bloc.parts
    .map((part, i) => {
      const angleDebut = angle;
      // Depuis la valorisation et non depuis `part` : arrondi après arrondi, la
      // somme des pourcentages n'aurait pas refermé le cercle.
      angle += total ? (part.valorisation / total) * 2 * Math.PI : 0;
      // Une part unique fait le tour complet : l'arc du début rejoint alors
      // exactement celui de la fin et le navigateur ne dessine rien. Un cercle,
      // dans ce cas-là, plutôt qu'un chemin dégénéré.
      const forme =
        bloc.parts.length === 1
          ? `<circle cx="${IO_CENTRE}" cy="${IO_CENTRE}" r="${
              (IO_RAYON + IO_RAYON_INTERIEUR) / 2
            }" fill="none" stroke="${ioCouleurPart(part)}" stroke-width="${
              IO_RAYON - IO_RAYON_INTERIEUR
            }" />`
          : `<path d="${ioArc(angleDebut, angle)}" fill="${ioCouleurPart(part)}" />`;
      return `<g data-index="${i}" class="io-part">${forme}</g>`;
    })
    .join("");

  conteneur.innerHTML = `
    <svg viewBox="0 0 240 240" width="240" height="240" xmlns="http://www.w3.org/2000/svg"
         role="img" aria-label="${escapeHtml(t("Répartition par type de titre"))}">
      ${parts}
      <text x="${IO_CENTRE}" y="${IO_CENTRE - 4}" text-anchor="middle"
            font-size="9" fill="#9ea3b0">${escapeHtml(t("Total"))}</text>
      <text x="${IO_CENTRE}" y="${IO_CENTRE + 12}" text-anchor="middle"
            font-size="13" fill="#e7e8ec">${escapeHtml(
              formatMontant(total, bloc.monnaie_id)
            )}</text>
    </svg>
  `;

  // Une seule bulle réutilisée par toutes les parts, posée dans le bloc
  // (positionné en relatif) : la recréer à chaque survol la ferait réapparaître
  // sans transition. Réutilisée d'un rendu à l'autre pour la même raison —
  // seul le disque est redessiné quand on change d'onglet de monnaie.
  let bulle = cadre.querySelector(".histo-bulle");
  if (!bulle) {
    bulle = document.createElement("div");
    bulle.className = "histo-bulle";
    bulle.setAttribute("role", "tooltip");
    cadre.appendChild(bulle);
  }
  bulle.classList.remove("visible");

  conteneur.querySelectorAll("svg g[data-index]").forEach((groupe) => {
    const part = bloc.parts[Number(groupe.dataset.index)];
    groupe.addEventListener("mouseenter", (e) => {
      bulle.innerHTML = ioContenuInfobulle(part, bloc.monnaie_id);
      bulle.classList.add("visible");
      ioPlacerInfobulle(bulle, cadre, e);
    });
    groupe.addEventListener("mousemove", (e) => ioPlacerInfobulle(bulle, cadre, e));
    groupe.addEventListener("mouseleave", () => bulle.classList.remove("visible"));
  });
}

/* ---------- La légende ----------
 *
 * À CÔTÉ DU CAMEMBERT ET NON DEDANS. Écrire les libellés sur les parts oblige à
 * les tronquer dès qu'une part est étroite, et rend illisible tout ce qui pèse
 * moins de quelques pour cent — c'est-à-dire précisément ce qu'on vient
 * vérifier. La légende porte donc le nom, le montant et la part, alignés en
 * colonnes.
 */
function ioRenderLegende(bloc) {
  const legende = document.getElementById("io-legende");
  legende.innerHTML = bloc.parts
    .map(
      (part) => `
      <div class="io-legende-ligne">
        <span class="io-pastille" style="background:${ioCouleurPart(part)}"></span>
        <span class="io-legende-nom">${escapeHtml(ioNomPart(part))}</span>
        <span class="io-legende-nombre">${t("{n} titre(s)", {
          n: part.nombre_titres,
        })}</span>
        <span class="io-legende-montant">${formatMontant(
          part.valorisation,
          bloc.monnaie_id
        )}</span>
        <span class="io-legende-part">${(part.part * 100).toFixed(1)} %</span>
      </div>`
    )
    .join("");
}

/* ---------- Les chiffres du haut ---------- */

function ioRenderKpis(bloc) {
  const plusValue = bloc.total - bloc.total_investi;
  const signe = plusValue >= 0 ? "positif" : "negatif";
  // PAS DE SOUS-TEXTE sous ces cartes : chaque libellé se suffit, et une ligne
  // de glose sous chacun repoussait les chiffres — la seule chose qu'on vient
  // lire ici. Ce qu'il fallait préciser l'est dans l'infobulle de la section.
  document.getElementById("io-kpis").innerHTML = `
    <div class="kpi-card">
      <div class="kpi-label">${t("Valeur du portefeuille")}</div>
      <div class="kpi-valeur">${formatMontant(bloc.total, bloc.monnaie_id)}</div>
    </div>
    <div class="kpi-card">
      <div class="kpi-label">${t("Montant investi")}</div>
      <div class="kpi-valeur">${formatMontant(bloc.total_investi, bloc.monnaie_id)}</div>
    </div>
    <div class="kpi-card">
      <div class="kpi-label">${t("Plus-value latente")}</div>
      <div class="kpi-valeur ${signe}">${formatMontant(plusValue, bloc.monnaie_id)}</div>
    </div>
  `;
}

/* ---------- Les onglets de monnaie ---------- */

function ioRenderOnglets() {
  const barre = document.getElementById("io-monnaies");
  barre.innerHTML = "";
  // Masquée quand il n'y a qu'une monnaie : un onglet unique n'offre aucun
  // choix. Même règle que les barres d'onglets du noyau.
  barre.style.display = ioExposition.length > 1 ? "" : "none";
  ioExposition.forEach((bloc) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.textContent = bloc.monnaie_symbole;
    if (bloc.monnaie_id === ioMonnaieId) btn.classList.add("active");
    btn.addEventListener("click", () => {
      ioMonnaieId = bloc.monnaie_id;
      // Pas de rechargement : les deux répartitions viennent du même appel.
      ioRenderOnglets();
      ioRenderMonnaieActive();
    });
    barre.appendChild(btn);
  });
}

function ioRenderMonnaieActive() {
  const bloc = ioExposition.find((b) => b.monnaie_id === ioMonnaieId);
  if (!bloc) return;
  ioRenderKpis(bloc);
  ioRenderCamembert(bloc);
  ioRenderLegende(bloc);
}

/* ---------- Chargement ---------- */

async function loadInvestingOverview() {
  try {
    ioExposition = await apiFetch("/investing-overview/exposition");

    const vide = ioExposition.length === 0;
    document.getElementById("io-vide").style.display = vide ? "" : "none";
    document.getElementById("io-contenu").style.display = vide ? "none" : "";
    document.getElementById("io-monnaies").style.display = vide ? "none" : "";
    if (vide) return;

    // La monnaie regardée survit à un rechargement tant qu'elle a encore
    // quelque chose à montrer.
    if (!ioExposition.some((b) => b.monnaie_id === ioMonnaieId)) {
      ioMonnaieId = ioExposition[0].monnaie_id;
    }
    ioRenderOnglets();
    ioRenderMonnaieActive();
  } catch (err) {
    showMessage(err.message, "error");
  }
}

BudgetApp.extensions.enregistrer(IO_ID, { chargeur: loadInvestingOverview });

/* ---------- La porte d'entrée : un bouton sur la page Placements ----------
 *
 * MÊME MÉCANIQUE QUE L'ÉCRAN D'IMPORT (cf. import-placements.js, dont l'en-tête
 * détaille le raisonnement) : cet écran est une façon de REGARDER le
 * portefeuille, pas une destination à côté de lui, et il s'ouvre donc depuis la
 * page qu'il résume.
 *
 * ON NE RÉ-ENREGISTRE PAS LE CHARGEUR DE « placements » : le bouton est
 * statique, et il n'y a de toute façon qu'UN chargeur par extension — l'import
 * et nous nous le disputerions, le dernier enregistré effaçant l'autre.
 *
 * L'ORDRE DE CHARGEMENT NE NOUS EST PAS FAVORABLE (les dossiers sont lus dans
 * l'ordre alphabétique, « investing-overview » avant « placements ») : la pose
 * échoue au premier essai et se rejoue sur `budgetapp:extension-chargee`.
 */
function poserBoutonVueEnsemble() {
  const section = document.getElementById("section-placements");
  if (!section) return false;
  if (document.getElementById("btn-io-ouvrir")) return true;
  const titre = section.querySelector("h2");
  if (!titre) return false;
  // Le conteneur des actions, déclaré par l'hôte dans son page.html. C'est LUI
  // qui porte la marge automatique : chaque bouton portant la sienne, deux
  // extensions se partageaient l'espace libre au lieu de se grouper à droite,
  // et le premier bouton se retrouvait planté au milieu du titre.
  const actions = titre.querySelector(".placements-titre-actions");
  if (!actions) return false;

  const bouton = document.createElement("button");
  bouton.type = "button";
  bouton.id = "btn-io-ouvrir";
  bouton.className = "placements-titre-action";
  // `data-extension` suffit à faire disparaître et réapparaître le bouton avec
  // l'extension : le noyau montre et masque tout élément qui le porte
  // (cf. majVisibiliteNavigation).
  bouton.dataset.extension = IO_ID;
  bouton.textContent = t("Vue d'ensemble");
  bouton.style.display = BudgetApp.extensions.estActive(IO_ID) ? "" : "none";
  // `ongletActif` : cet écran n'a pas de bouton à lui dans la barre du haut.
  // Sans ce second argument, aucun onglet ne resterait allumé et l'application
  // aurait l'air d'avoir quitté toutes ses pages.
  bouton.addEventListener("click", () =>
    switchSection(IO_ID, { ongletActif: "placements" })
  );
  actions.appendChild(bouton);
  return true;
}

if (!poserBoutonVueEnsemble()) {
  document.addEventListener("budgetapp:extension-chargee", (evenement) => {
    if (evenement.detail && evenement.detail.id === IO_HOTE) {
      poserBoutonVueEnsemble(); // idempotent, obligatoirement
    }
  });
}

// La sortie : on revient d'où l'on vient, jamais ailleurs.
document
  .getElementById("btn-io-retour")
  .addEventListener("click", () => switchSection("placements"));
