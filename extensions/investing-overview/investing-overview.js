/* ---------- Extension « Vue d'ensemble des placements » ----------
 *
 * CE QUE CET ÉCRAN AJOUTE. L'onglet Placements répond « qu'y a-t-il sur ce
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

// LES QUATRE AXES du portefeuille (migrations 0066 et 0076), et la monnaie regardée.
// Gardés pour que rebasculer d'un onglet de monnaie à l'autre ne redemande rien
// au serveur : toutes les monnaies viennent du même appel.
//
// `enveloppe` DÉCIDE DE TOUT CE QUI EST COMMUN — les onglets de monnaie, les
// KPI, l'état « portefeuille vide » : les quatre axes décrivent exactement les
// mêmes détentions, seul leur découpage change. Lire les monnaies des deux
// aurait laissé exister un état où l'un en propose une que l'autre ignore.
let ioExpositions = { enveloppe: [], classe: [], zone: [], secteur: [] };
let ioMonnaieId = null;

// L'ordre des quatre blocs à l'écran (deux par ligne), et les identifiants qui vont avec.
// Une seule liste : le chargement, le rendu et l'infobulle la parcourent tous.
const IO_AXES = ["enveloppe", "classe", "zone", "secteur"];

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

// LES PARTS « ACTION PAR ACTION » portent elles-mêmes leur couleur, leur nom, leur clé et leur
// infobulle (cf. ioPartsTitres) : le disque, la légende et le survol sont ceux des quatre
// autres camemberts, et ces quatre champs sont tout ce qui les distingue.
function ioCouleurPart(part) {
  if (part.couleur) return part.couleur;
  if (part.type_titre_id == null) return IO_COULEUR_SANS_TYPE;
  return couleurCategorie(part.type_titre_id);
}

// LA PART SANS ÉTIQUETTE SE NOMME DANS LA LANGUE DE SON AXE : « Sans enveloppe » sous un
// graphe d'enveloppes, « Sans zone » sous celui des zones. Le même mot partout ferait croire
// à une seule et même part, alors qu'un titre peut très bien porter l'une et pas l'autre.
const IO_SANS_ETIQUETTE = {
  enveloppe: "Sans enveloppe",
  classe: "Sans classe",
  zone: "Sans zone",
  secteur: "Sans secteur",
};

function ioNomPart(part, axe = "enveloppe") {
  if (part.nom_affiche) return part.nom_affiche;
  return part.type_titre_nom || t(IO_SANS_ETIQUETTE[axe]);
}

/** La clé qui relie une part du disque à sa ligne de légende (surbrillance). */
function ioCle(part) {
  if (part.cle) return part.cle;
  return part.type_titre_id == null ? "sans" : String(part.type_titre_id);
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
 * `contenuInfobulleCategorie`) — mêmes classes, même mise en page, même
 * limite à trois lignes. Deux graphes voisins qui répondraient différemment au
 * survol demanderaient d'apprendre deux fois le même geste.
 *
 * Le nombre entre parenthèses est celui des COMPTES sur lesquels le titre est
 * détenu, et il ne s'affiche qu'à partir de deux — « (1) » n'apprendrait rien
 * et mettrait une parenthèse au bout de presque chaque ligne.
 */
function ioContenuInfobulle(part, monnaieId, axe) {
  const lignes = part.titres
    .map((titre) => {
      const comptes =
        titre.nombre_comptes > 1
          ? ` <i class="histo-bulle-compte">(${t("{n} comptes", {
              n: titre.nombre_comptes,
            })})</i>`
          : "";
      return `<li>
        <span class="histo-bulle-nature">${escapeHtml(titre.titre_nom)}${comptes}</span>
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

  // Le montant et le nombre de titres vivent ICI depuis que la légende, passée sous le
  // disque, ne porte plus que le nom et la part (comme celle du dashboard).
  return `<div class="histo-bulle-titre">${escapeHtml(ioNomPart(part, axe))} —
      ${formatMontant(part.valorisation, monnaieId)} · ${formatPourcentage(part.part * 100)}</div>
    <div class="io-bulle-compte">${t("{n} titre(s)", { n: part.nombre_titres })}</div>
    <ul class="histo-bulle-liste">${lignes}${suite}</ul>`;
}

function ioRenderCamembert(bloc, axe) {
  const conteneur = document.getElementById(`io-camembert-${axe}`);
  conteneur.innerHTML = "";

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
      return `<g data-index="${i}" data-io-cle="${ioCle(part)}" class="io-part">${forme}</g>`;
    })
    .join("");

  conteneur.innerHTML = `
    <svg viewBox="0 0 240 240" width="240" height="240" xmlns="http://www.w3.org/2000/svg"
         role="img" aria-label="${escapeHtml(t("Répartition par type de titre"))}">
      ${parts}
      <text x="${IO_CENTRE}" y="${IO_CENTRE - 4}" text-anchor="middle"
            font-size="9" fill="var(--text-secondary)">${escapeHtml(t("Total"))}</text>
      <text x="${IO_CENTRE}" y="${IO_CENTRE + 12}" text-anchor="middle"
            font-size="13" fill="var(--text-primary)">${escapeHtml(
              formatMontant(total, bloc.monnaie_id)
            )}</text>
    </svg>
  `;
}

/* ---------- La légende ----------
 *
 * SOUS LE CAMEMBERT ET NON DEDANS. Écrire les libellés sur les parts oblige à les
 * tronquer dès qu'une part est étroite, et rend illisible tout ce qui pèse moins de
 * quelques pour cent — c'est-à-dire précisément ce qu'on vient vérifier.
 *
 * LA LÉGENDE DU DASHBOARD (`.camembert-legende`) : la pastille, le nom et la part. Le
 * montant et le nombre de titres sont dans l'infobulle, la même que celle du disque.
 */
function ioRenderLegende(bloc, axe) {
  const legende = document.getElementById(`io-legende-${axe}`);
  legende.innerHTML = `<ul class="camembert-legende">${bloc.parts
    .map(
      (part, i) => `
      <li class="camembert-legende-ligne" data-index="${i}" data-io-cle="${ioCle(part)}">
        <span class="camembert-pastille" style="background:${ioCouleurPart(part)}"></span>
        <span class="camembert-legende-nom">${escapeHtml(ioNomPart(part, axe))}</span>
        <span class="camembert-legende-part">${formatPourcentage(part.part * 100)}</span>
      </li>`
    )
    .join("")}</ul>`;
}

/**
 * L'INFOBULLE ET LA SURBRILLANCE, sur le disque ET sur la légende — le fonctionnement des
 * autres légendes de l'application (cf. renderLegendeCategories, cablerSurbrillanceCategories).
 *
 * L'infobulle est celle du noyau (`attacherInfobulleCategorie`) : même placement, même gel
 * par la touche réglée dans les Paramètres. Une seule pour le bloc, posée sur ses parts et ses
 * lignes de légende ; celle du rendu précédent est retirée, sans quoi chaque changement
 * d'onglet de monnaie en ajouterait une.
 *
 * La surbrillance relie une part à sa ligne par `data-io-cle`, DANS CE BLOC seulement : deux
 * camemberts voisins portent des étiquettes différentes, et « Sans zone » n'est pas « Sans
 * secteur ».
 */
function ioCablerSurvol(bloc, axe) {
  const cadre = document.querySelector(`.io-camembert-bloc[data-io-axe="${axe}"]`);
  if (!cadre) return;
  cadre.querySelectorAll(".histo-bulle").forEach((ancienne) => ancienne.remove());
  const cibles = [...cadre.querySelectorAll("[data-io-cle]")];
  attacherInfobulleCategorie(cadre, cibles, (cible) => {
    const part = bloc.parts[Number(cible.dataset.index)];
    return { html: part.bulle ? part.bulle() : ioContenuInfobulle(part, bloc.monnaie_id, axe) };
  });
  cibles.forEach((cible) => {
    const jumeaux = () => cadre.querySelectorAll(`[data-io-cle="${cible.dataset.ioCle}"]`);
    cible.addEventListener("mouseenter", () => jumeaux().forEach((el) => el.classList.add("survolee")));
    cible.addEventListener("mouseleave", () => jumeaux().forEach((el) => el.classList.remove("survolee")));
  });
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
  barre.style.display = ioExpositions.enveloppe.length > 1 ? "" : "none";
  ioExpositions.enveloppe.forEach((bloc) => {
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
  const reference = ioExpositions.enveloppe.find((b) => b.monnaie_id === ioMonnaieId);
  if (!reference) return;
  // Les KPI une seule fois : les quatre axes décrivent les mêmes détentions, donc
  // la même valeur, le même investi et la même plus-value.
  ioRenderKpis(reference);
  IO_AXES.forEach((axe) => {
    const bloc = ioExpositions[axe].find((b) => b.monnaie_id === ioMonnaieId);
    const cellule = document.querySelector(`.io-cellule[data-io-axe="${axe}"]`);
    // UN AXE SANS AUCUNE ÉTIQUETTE N'A PAS DE CAMEMBERT À DESSINER, et c'est
    // l'état ordinaire d'une zone ou d'un secteur tant que rien n'a été importé.
    // La cellule se retire avec son titre plutôt que d'afficher un disque gris
    // intitulé « Sans zone » à 100 % — qui n'apprendrait rien et donnerait
    // l'air d'une panne. Les autres se resserrent dans la grille.
    const aQuelqueChose = bloc && bloc.parts.some((part) => part.type_titre_id != null);
    if (cellule) cellule.style.display = aQuelqueChose ? "" : "none";
    if (!aQuelqueChose) return;
    ioRenderCamembert(bloc, axe);
    ioRenderLegende(bloc, axe);
    ioCablerSurvol(bloc, axe);
  });
  ioRenderTitres();
}

/* ---------- Action par action ----------
 *
 * CE QU'ON DÉTIENT EN DIRECT, PLUS CE QUE LES ETF DÉTIENNENT POUR NOUS d'après leur
 * composition (cf. service_vue_ensemble.exposition_par_titre) : une même action tenue des
 * deux façons ne fait qu'une part. Le serveur rend les parts déjà calculées — y compris
 * leur poids sans la part non déterminée — et cet écran ne fait que choisir laquelle lire.
 *
 * LA PART « DÉTENU PAR ETF, NON DÉTERMINÉ » regroupe ce que les compositions ne décrivent
 * pas, au prorata de la valeur de chaque ETF. Le sélecteur la retire du disque : on lit
 * alors la répartition de ce qui est CONNU, rapportée à son seul total.
 */
let ioTitres = [];
let ioMasquerNonDetermine = false;

// Le gris clair des « Autres titres » : une part qui regroupe, pas un titre de plus — et
// distinct du gris de la part non déterminée, qui dit tout autre chose.
const IO_COULEUR_AUTRES = "#9aa0ad";

function ioNomPartTitre(part) {
  if (part.genre === "non_determine") return t("Détenu par ETF, non déterminé");
  if (part.genre === "autres") return t("Autres titres");
  return part.nom;
}

/** Le détail d'une part : d'où vient sa valeur (en direct, tel ETF) ou, pour la part non
 *  déterminée, quels ETF y contribuent (valeur × part non déterminée), les trois plus lourds. */
function ioContenuInfobulleTitre(part, monnaieId, pourcentage) {
  const lignes = part.sources
    .map(
      (source) => `<li>
        <span class="histo-bulle-nature">${escapeHtml(source.direct ? t("En direct") : source.nom)}</span>
        <span class="histo-bulle-montant">${formatMontant(source.valorisation, monnaieId)}</span>
      </li>`
    )
    .join("");
  const reste = part.nombre_sources - part.sources.length;
  const suite =
    reste > 0
      ? `<li class="io-bulle-reste"><span class="histo-bulle-nature">${t("et {n} autre(s)", {
          n: reste,
        })}</span></li>`
      : "";
  const compte =
    part.genre === "autres"
      ? `<div class="io-bulle-compte">${t("{n} titre(s)", { n: part.nombre_sources })}</div>`
      : "";
  return `<div class="histo-bulle-titre">${escapeHtml(ioNomPartTitre(part))} —
      ${formatMontant(part.valorisation, monnaieId)} · ${formatPourcentage(pourcentage * 100)}</div>
    ${compte}<ul class="histo-bulle-liste">${lignes}${suite}</ul>`;
}

/** Le bloc de la monnaie active, mis à la forme des quatre autres camemberts. */
function ioBlocTitres(bloc) {
  const masquer = ioMasquerNonDetermine;
  let rang = 0;
  const parts = bloc.parts
    .filter((part) => !(masquer && part.genre === "non_determine"))
    .map((part) => {
      const pourcentage = masquer ? part.part_determinee : part.part;
      const couleur =
        part.genre === "non_determine"
          ? IO_COULEUR_SANS_TYPE
          : part.genre === "autres"
            ? IO_COULEUR_AUTRES
            : couleurCategorie(rang++);
      return {
        cle: part.cle,
        nom_affiche: ioNomPartTitre(part),
        couleur,
        valorisation: part.valorisation,
        part: pourcentage,
        bulle: () => ioContenuInfobulleTitre(part, bloc.monnaie_id, pourcentage),
      };
    });
  return {
    monnaie_id: bloc.monnaie_id,
    total: masquer ? bloc.total_determine : bloc.total,
    parts,
  };
}

function ioRenderTitres() {
  const bloc = ioTitres.find((b) => b.monnaie_id === ioMonnaieId);
  const cellule = document.querySelector('.io-cellule[data-io-axe="titre"]');
  // Rien de nommé (que des ETF sans composition) : la seule part serait « non déterminé »,
  // à 100 % — la cellule se retire, comme celle d'un axe sans étiquette.
  const aQuelqueChose = bloc && bloc.parts.some((part) => part.genre !== "non_determine");
  if (cellule) cellule.style.display = aQuelqueChose ? "" : "none";
  if (!aQuelqueChose) return;
  // Le sélecteur n'a de sens que s'il y a quelque chose à masquer.
  const aNonDetermine = bloc.parts.some((part) => part.genre === "non_determine");
  document.getElementById("io-titres-masquer-bloc").style.display = aNonDetermine ? "" : "none";
  document.getElementById("io-titres-masquer").checked = ioMasquerNonDetermine;
  const vue = ioBlocTitres(bloc);
  ioRenderCamembert(vue, "titre");
  ioRenderLegende(vue, "titre");
  ioCablerSurvol(vue, "titre");
}

document.getElementById("io-titres-masquer")?.addEventListener("change", (e) => {
  ioMasquerNonDetermine = e.target.checked;
  ioRenderTitres();
});

/* ---------- Chargement ---------- */

async function loadInvestingOverview() {
  try {
    // UN APPEL PAR AXE, EN PARALLÈLE : les axes se lisent séparément côté
    // serveur (cf. routeur_investing_overview), et les demander ensemble évite
    // l'instant où l'un des camemberts décrit une autre lecture que ses
    // voisins.
    const [titres, ...lus] = await Promise.all([
      apiFetch("/investing-overview/exposition-titres"),
      ...IO_AXES.map((axe) => apiFetch(`/investing-overview/exposition?axe=${axe}`)),
    ]);
    ioExpositions = Object.fromEntries(IO_AXES.map((axe, i) => [axe, lus[i]]));
    ioTitres = titres;

    const vide = ioExpositions.enveloppe.length === 0;
    document.getElementById("io-vide").style.display = vide ? "" : "none";
    document.getElementById("io-contenu").style.display = vide ? "none" : "";
    document.getElementById("io-monnaies").style.display = vide ? "none" : "";
    if (vide) return;

    // La monnaie regardée survit à un rechargement tant qu'elle a encore
    // quelque chose à montrer.
    if (!ioExpositions.enveloppe.some((b) => b.monnaie_id === ioMonnaieId)) {
      ioMonnaieId = monnaiePreferee(ioExpositions.enveloppe.map((b) => b.monnaie_id));
    }
    ioRenderOnglets();
    ioRenderMonnaieActive();
  } catch (err) {
    showMessage(err.message, "error");
  }
}

BudgetApp.extensions.enregistrer(IO_ID, { chargeur: loadInvestingOverview });

/* ---------- La porte d'entrée : un bouton sur l'onglet Placements ----------
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
  const section = document.getElementById("sous-section-comptes-globale-placements");
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
    switchSection(IO_ID, { ongletActif: "comptes-globale" })
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
  .addEventListener("click", () => switchSection("comptes-globale", { sousSection: "comptes-globale-placements" }));
