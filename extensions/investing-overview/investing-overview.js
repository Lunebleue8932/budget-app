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
  return couleurCategorie(part.couleur_index ?? part.type_titre_id);
}

/**
 * UNE COULEUR PAR ÉTIQUETTE D'UN MÊME AXE, jusqu'à épuisement de la palette. Prendre l'identifiant
 * du type tel quel (modulo la taille de la palette) donnait la même couleur à « ETF » et « ETN »
 * dès que leurs identifiants différaient d'un multiple de huit. On numérote donc les étiquettes
 * de l'axe dans l'ordre de leur identifiant : toujours le même ordre d'un chargement à l'autre,
 * et deux étiquettes de l'axe ne partagent une couleur qu'au-delà de huit.
 *
 * UNE SEULE EXCEPTION : LES DEUX PLUS GROSSES PARTS NE SE RESSEMBLENT JAMAIS. La palette a des
 * voisines (l'aqua et le vert, le rouge et l'orange…) ; tombées sur les deux parts qui font
 * l'essentiel du disque, elles ne se distinguaient plus. La seconde prend alors la première
 * couleur éloignée de celle de la première, et l'étiquette qui la portait reprend la sienne.
 */
function ioAttribuerCouleurs(expositions) {
  IO_AXES.forEach((axe) => {
    const parts = (expositions[axe] || []).flatMap((bloc) => bloc.parts);
    const ids = [...new Set(parts.map((p) => p.type_titre_id).filter((id) => id != null))].sort(
      (a, b) => a - b
    );
    const index = new Map(ids.map((id, i) => [id, i]));
    ioEcarterLesDeuxPlusGrosses(parts, index);
    parts.forEach((p) => {
      if (p.type_titre_id != null) p.couleur_index = index.get(p.type_titre_id);
    });
  });
}

// En deçà de cet écart de teinte (en degrés), deux couleurs se confondent sur un disque.
const IO_ECART_TEINTE_MIN = 45;

function ioTeinte(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const max = Math.max(r, g, b);
  const ecart = max - Math.min(r, g, b);
  if (!ecart) return 0;
  const h = max === r ? ((g - b) / ecart) % 6 : max === g ? (b - r) / ecart + 2 : (r - g) / ecart + 4;
  return (h * 60 + 360) % 360;
}

function ioCouleursProches(indexA, indexB) {
  const d = Math.abs(ioTeinte(couleurCategorie(indexA)) - ioTeinte(couleurCategorie(indexB)));
  return Math.min(d, 360 - d) < IO_ECART_TEINTE_MIN;
}

/** Les deux plus grosses parts de l'axe, monnaies confondues : on additionne leurs PARTS (et non
 *  leurs montants, qui ne s'additionnent pas d'une monnaie à l'autre). */
function ioEcarterLesDeuxPlusGrosses(parts, index) {
  const poids = new Map();
  parts.forEach((p) => {
    if (p.type_titre_id != null) poids.set(p.type_titre_id, (poids.get(p.type_titre_id) || 0) + p.part);
  });
  const [premiere, seconde] = [...poids.keys()].sort((a, b) => poids.get(b) - poids.get(a));
  if (seconde === undefined || !ioCouleursProches(index.get(premiere), index.get(seconde))) return;
  const taille = PALETTE_CATEGORIES.length;
  const depart = index.get(seconde);
  for (let pas = 1; pas < taille; pas++) {
    const candidat = (depart + pas) % taille;
    if (candidat === index.get(premiere) % taille) continue;
    if (ioCouleursProches(index.get(premiere), candidat)) continue;
    const occupant = [...index.keys()].find((id) => index.get(id) === candidat);
    if (occupant !== undefined) index.set(occupant, depart);
    index.set(seconde, candidat);
    return;
  }
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

// LES NOMS À CÔTÉ DU DISQUE, comme les pourcentages du camembert du dashboard : un petit crochet gris part de
// chaque part et porte son NOM (là où le dashboard écrit le pourcentage) — mêmes crochets, même écart
// minimal (`pieEcarterEtiquettes`), même gris (`.camembert-rappel`). Seules les parts de plus de 5 %
// en ont un : en dessous le nom ne se lit plus à côté d'une tranche, et la légende dessous les donne toutes.
const IO_SEUIL_RAPPEL = 0.05;
const IO_RAPPEL_LARGEUR = 480; // le disque au milieu, de la place de chaque côté pour les noms
const IO_RAPPEL_OBLIQUE = 12;
const IO_RAPPEL_HORIZONTALE = 8;
const IO_RAPPEL_NOM_MAX = 22;

function ioNomCourt(nom) {
  return nom.length > IO_RAPPEL_NOM_MAX ? `${nom.slice(0, IO_RAPPEL_NOM_MAX - 1)}…` : nom;
}

function ioRappelsCamembert(bloc, axe) {
  const total = bloc.total;
  if (!total || bloc.parts.length < 2) return "";
  const decalage = (IO_RAPPEL_LARGEUR - 2 * IO_CENTRE) / 2; // le disque est centré dans la largeur élargie
  const cx = IO_CENTRE + decalage;
  let cumul = 0;
  const etiquettes = [];
  bloc.parts.forEach((part, i) => {
    const fraction = part.valorisation / total;
    const angle = (cumul + fraction / 2) * 2 * Math.PI;
    cumul += fraction;
    if (part.part <= IO_SEUIL_RAPPEL) return;
    const sin = Math.sin(angle);
    const cos = Math.cos(angle);
    etiquettes.push({
      index: i,
      nom: ioNomPart(part, axe),
      ancreX: cx + (IO_RAYON + 1) * sin,
      ancreY: IO_CENTRE - (IO_RAYON + 1) * cos,
      coudeX: cx + (IO_RAYON + IO_RAPPEL_OBLIQUE) * sin,
      y: IO_CENTRE - (IO_RAYON + IO_RAPPEL_OBLIQUE) * cos,
      droite: sin >= 0,
    });
  });
  const hauteur = IO_CENTRE * 2;
  return [
    ...pieEcarterEtiquettes(etiquettes.filter((e) => e.droite), hauteur),
    ...pieEcarterEtiquettes(etiquettes.filter((e) => !e.droite), hauteur),
  ]
    .map((e) => {
      const signe = e.droite ? 1 : -1;
      const boutX = e.coudeX + signe * IO_RAPPEL_HORIZONTALE;
      return `<g class="camembert-rappel" data-index="${e.index}">
        <polyline points="${e.ancreX},${e.ancreY} ${e.coudeX},${e.y} ${boutX},${e.y}" fill="none" stroke="currentColor" stroke-width="1" />
        <text x="${boutX + signe * 3}" y="${e.y}" dominant-baseline="middle" text-anchor="${e.droite ? "start" : "end"}"
              font-size="10">${escapeHtml(ioNomCourt(e.nom))}</text>
      </g>`;
    })
    .join("");
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

  const decalage = (IO_RAPPEL_LARGEUR - 2 * IO_CENTRE) / 2;
  conteneur.innerHTML = `
    <svg class="camembert-svg io-camembert-svg" viewBox="0 0 ${IO_RAPPEL_LARGEUR} 240" width="${IO_RAPPEL_LARGEUR}" height="240"
         xmlns="http://www.w3.org/2000/svg"
         role="img" aria-label="${escapeHtml(t("Répartition par type de titre"))}">
      <g transform="translate(${decalage} 0)">
        ${parts}
        <text x="${IO_CENTRE}" y="${IO_CENTRE - 4}" text-anchor="middle"
              font-size="9" fill="var(--text-secondary)">${escapeHtml(t("Total"))}</text>
        <text x="${IO_CENTRE}" y="${IO_CENTRE + 12}" text-anchor="middle"
              font-size="13" fill="var(--text-primary)">${escapeHtml(
                formatMontant(total, bloc.monnaie_id)
              )}</text>
      </g>
      ${ioRappelsCamembert(bloc, axe)}
    </svg>
  `;
}

/* ---------- La carte « Où c'est exposé » ----------
 *
 * LA RÉPARTITION PAR ZONE SE LIT SUR UNE CARTE DU MONDE (`carte-monde.js`, tracés projetés par
 * outils/generer_carte.py). Les COULEURS sont celles du disque d'avant : chaque zone garde la sienne,
 * et la légende dessous est la même. Ce qui change est la façon de montrer la part :
 *
 *   - UNE ZONE EST UNE RÉGION : l'ensemble des pays qu'elle recouvre (`GET /zones-pays`, calculé
 *     d'après les zones DE LA BASE — renommées, créées —, cf. zones_pays.py) ;
 *   - ELLE SE REMPLIT AU PRORATA DE SA PART, comme une jauge, du BAS vers le haut, l'AIRE
 *     coloriée valant part × aire de la région (cf. ioRectanglesParTerritoire) : la hauteur s'en déduit ;
 *     le reste garde le fond de la carte ;
 *   - une zone qui ne désigne aucun pays (« Monde »), et la part « Sans zone », n'ont pas de place sur
 *     la carte : elles restent dans la légende, qui le dit.
 *
 * LE FOND SUIT LES COULEURS DE L'APPLICATION (variables du thème, cf. investing-overview.css).
 */
let ioZonesPays = [];

/* LE REMPLISSAGE SE MESURE EN AIRE, pas en hauteur. Une région se colore du BAS, et la hauteur
 * de coloration se DÉDUIT de la part : on cherche la ligne horizontale au-dessous de laquelle l'aire
 * coloriée vaut `part × aire totale de la région` (65 % = 65 % de la surface dessinée, quelle que soit
 * la forme du pays — une Russie très haute et une Italie très étroite se lisent pareil). L'aire est celle
 * du DESSIN (la carte est plate : une aire n'est pas une surface réelle). Les anneaux des pays sont lus
 * une fois (`ioAnneauxPays`), l'aire sous une ligne se calcule par découpe de chaque anneau. */
const ioAnneauxCache = new Map();

function ioAnneauxPays(pays) {
  if (!ioAnneauxCache.has(pays.c)) {
    ioAnneauxCache.set(
      pays.c,
      pays.d
        .split("Z")
        .filter(Boolean)
        .map((anneau) =>
          anneau
            .slice(1)
            .split("L")
            .map((point) => point.split(",").map(Number))
        )
    );
  }
  return ioAnneauxCache.get(pays.c);
}

/** Aire (signée) d'un anneau limitée à y <= h : le polygone est découpé contre la droite y = h. */
function ioAireSousLigne(anneau, h) {
  const gardes = [];
  for (let i = 0; i < anneau.length; i++) {
    const a = anneau[i];
    const b = anneau[(i + 1) % anneau.length];
    const aDedans = a[1] <= h;
    const bDedans = b[1] <= h;
    if (aDedans) gardes.push(a);
    if (aDedans !== bDedans) {
      const k = (h - a[1]) / (b[1] - a[1]);
      gardes.push([a[0] + k * (b[0] - a[0]), h]);
    }
  }
  let somme = 0;
  for (let i = 0; i < gardes.length; i++) {
    const a = gardes[i];
    const b = gardes[(i + 1) % gardes.length];
    somme += a[0] * b[1] - b[0] * a[1];
  }
  return somme / 2;
}

/** LES TERRITOIRES SÉPARÉS d'une même zone (les États-Unis et l'Alaska, la France et la Guyane) SE REMPLISSENT
 *  CHACUN SELON SA PROPRE AIRE : pour la zone d'aire A et d'exposition e, et ses territoires séparés i
 *  d'aire A_i, le critère est  A_i coloriée = A_i × e  POUR CHAQUE i — d'où une hauteur relative x_i par
 *  territoire (de sa propre hauteur, depuis son bas), déduite du PROFIL d'aire de sa forme (le bas d'un
 *  territoire effilé colore peu : x_i n'est pas e). La somme donne bien A coloriée = A × e, et aucun
 *  territoire — l'Alaska, une île lointaine — ne paraît sur- ou sous-pondéré par sa latitude ou sa forme.
 *
 *  UN TERRITOIRE EST SÉPARÉ GÉOGRAPHIQUEMENT, pas distinct : les pays d'une même zone qui se touchent (la
 *  France, l'Allemagne, l'Italie…) forment UN seul territoire, à la boîte, à l'aire et au coloriage
 *  collectifs. La contiguïté vient du fond de carte (`v` : les anneaux limitrophes de chaque anneau, posés
 *  par outils/generer_carte.py d'après les frontières partagées) et ne compte que les voisins DE LA ZONE.
 *  Un territoire est un ensemble d'anneaux extérieurs contigus, et les trous (lacs, enclaves) qu'ils contiennent. */
function ioNoeudsPays(pays) {
  return ioAnneauxPays(pays).map((anneau, i) => ({
    id: `${pays.c}:${i}`,
    anneau,
    voisins: (pays.v && pays.v[i]) || [],
  }));
}

/* DES REGROUPEMENTS EXPLICITES, pour que la carte reste lisible : quand ces pays sont dans la même zone, leurs
 * anneaux forment UN SEUL territoire, même séparés par la mer ou la glace.
 *   - le CANADA, d'un seul tenant : le continent, l'archipel arctique et les glaciers ne se séparent pas ;
 *   - le NORD DE L'EUROPE : l'Islande, le Groenland, les Féroé, le Svalbard (l'île au nord des pays nordiques),
 *     les pays nordiques et les pays baltes forment un seul bloc. */
const IO_REGROUPEMENTS = [
  ["CA"],
  ["IS", "GL", "FO", "SJ", "AX", "NO", "SE", "FI", "DK", "EE", "LV", "LT"],
];

function ioTerritoires(noeuds) {
  const aires = noeuds.map((n) => ioAireSousLigne(n.anneau, 1e9));
  const plusGrand = aires.reduce((a, b) => (Math.abs(b) > Math.abs(a) ? b : a), 0);
  const sens = Math.sign(plusGrand) || 1;
  const boite = (anneau) => {
    const xs = anneau.map((p) => p[0]);
    const ys = anneau.map((p) => p[1]);
    return [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  };
  const exterieurs = noeuds.filter((_, i) => Math.sign(aires[i]) === sens).map((n) => ({ ...n, boite: boite(n.anneau) }));
  const trous = noeuds.filter((_, i) => Math.sign(aires[i]) !== sens);
  // Un trou revient au plus petit anneau extérieur dont la boîte le contient.
  const hoteDuTrou = new Map();
  trous.forEach((trou) => {
    const [hx0, hx1, hy0, hy1] = boite(trou.anneau);
    const hote = exterieurs
      .filter((e) => e.boite[0] <= hx0 && e.boite[1] >= hx1 && e.boite[2] <= hy0 && e.boite[3] >= hy1)
      .sort((a, b) => (a.boite[1] - a.boite[0]) * (a.boite[3] - a.boite[2]) - (b.boite[1] - b.boite[0]) * (b.boite[3] - b.boite[2]))[0];
    if (hote) hoteDuTrou.set(trou.id, hote.id);
  });
  // Les anneaux extérieurs limitrophes (un trou compte pour son hôte) se regroupent.
  const parent = new Map(exterieurs.map((e) => [e.id, e.id]));
  const racine = (id) => {
    while (parent.get(id) !== id) {
      parent.set(id, parent.get(parent.get(id)));
      id = parent.get(id);
    }
    return id;
  };
  const ancre = (id) => (parent.has(id) ? id : hoteDuTrou.get(id));
  noeuds.forEach((n) => {
    const a = ancre(n.id);
    if (!a) return;
    n.voisins.forEach((v) => {
      const b = ancre(v);
      if (b) parent.set(racine(a), racine(b));
    });
  });
  IO_REGROUPEMENTS.forEach((codes) => {
    const membres = exterieurs.filter((e) => codes.includes(e.id.split(":")[0]));
    membres.slice(1).forEach((m) => {
      parent.set(racine(m.id), racine(membres[0].id));
    });
  });
  const groupes = new Map();
  exterieurs.forEach((e) => {
    const r = racine(e.id);
    if (!groupes.has(r)) groupes.set(r, { anneaux: [], boite: [Infinity, -Infinity, Infinity, -Infinity] });
    const g = groupes.get(r);
    g.anneaux.push(e.anneau);
    g.boite = [Math.min(g.boite[0], e.boite[0]), Math.max(g.boite[1], e.boite[1]), Math.min(g.boite[2], e.boite[2]), Math.max(g.boite[3], e.boite[3])];
  });
  trous.forEach((trou) => {
    const hote = hoteDuTrou.get(trou.id);
    if (hote) groupes.get(racine(hote)).anneaux.push(trou.anneau);
  });
  return { territoires: [...groupes.values()], sens };
}

/** L'aire coloriée d'un territoire (depuis son bas) quand on en remplit la hauteur relative x. */
function ioAireColoriee(territoire, x, sens) {
  const [, , y0, y1] = territoire.boite;
  const ligne = y1 - x * (y1 - y0);
  return territoire.anneaux.reduce(
    (somme, anneau) => somme + sens * (ioAireSousLigne(anneau, 1e9) - ioAireSousLigne(anneau, ligne)),
    0
  );
}

/** Les rectangles SVG de la zone (à découper aux contours des pays), et la hauteur relative de chaque territoire. */
function ioRectanglesParTerritoire(noeuds, fraction, couleur) {
  if (fraction <= 0 || !noeuds.length) return { rectangles: "", fond: "", hauteurs: [] };
  const { territoires, sens } = ioTerritoires(noeuds);
  const e = Math.min(fraction, 1);
  const hauteurs = territoires.map((t) => {
    if (e >= 1) return 1;
    const cible = ioAireColoriee(t, 1, sens) * e;
    let bas = 0;
    let haut = 1;
    for (let i = 0; i < 32; i++) {
      const milieu = (bas + haut) / 2;
      if (ioAireColoriee(t, milieu, sens) < cible) bas = milieu;
      else haut = milieu;
    }
    return (bas + haut) / 2;
  });
  const rectangles = territoires
    .map((t, i) => {
      const [x0, x1, y0, y1] = t.boite;
      const hauteur = (y1 - y0) * hauteurs[i];
      return `<rect x="${x0}" y="${y1 - hauteur}" width="${x1 - x0}" height="${hauteur}" fill="${couleur}" />`;
    })
    .join("");
  // LE RESTE DE LA ZONE, de la même couleur mais très transparent : une zone détenue se distingue ainsi de ce
  // qu'on n'a pas, même quand sa part colorée est mince.
  const fond = territoires
    .map((t) => {
      const [x0, x1, y0, y1] = t.boite;
      return `<rect x="${x0}" y="${y0}" width="${x1 - x0}" height="${y1 - y0}" fill="${couleur}" fill-opacity="${IO_OPACITE_RESTE}" />`;
    })
    .join("");
  return { rectangles, fond, hauteurs };
}

// L'opacité de la partie non coloriée d'une zone détenue.
const IO_OPACITE_RESTE = 0.16;

function ioRenderCarte(bloc) {
  const conteneur = document.getElementById("io-camembert-zone");
  const pays = new Map(IO_CARTE.pays.map((p) => [p.c, p]));
  const parZone = new Map(ioZonesPays.map((z) => [z.type_titre_id, z.pays.filter((c) => pays.has(c))]));
  const regions = bloc.parts.map((part, i) => ({
    part,
    i,
    codes: part.type_titre_id != null ? parZone.get(part.type_titre_id) || [] : [],
  }));
  const fond = IO_CARTE.pays.map((p) => `<path class="io-pays" d="${p.d}" />`).join("");
  const remplissages = regions
    .filter((r) => r.codes.length)
    .map(({ part, i, codes }) => {
      const fraction = Math.min(Math.max(part.part, 0), 1);
      const noeuds = codes.flatMap((c) => ioNoeudsPays(pays.get(c)));
      const { rectangles, fond } = ioRectanglesParTerritoire(noeuds, fraction, ioCouleurPart(part));
      const formes = codes.map((c) => `<path d="${pays.get(c).d}" />`).join("");
      const identifiant = `io-carte-zone-${i}`;
      return `<clipPath id="${identifiant}">${formes}</clipPath>
        <g clip-path="url(#${identifiant})">${fond}${rectangles}</g>
        <g class="io-part io-carte-zone" data-index="${i}" data-io-cle="${ioCle(part)}">${formes}</g>`;
    })
    .join("");
  const horsCarte = regions.filter((r) => !r.codes.length);
  conteneur.innerHTML = `<div class="io-carte">
    <svg viewBox="0 0 ${IO_CARTE.largeur} ${IO_CARTE.hauteur}" role="img"
         aria-label="${escapeHtml(t("Répartition par zone géographique"))}">${fond}${remplissages}</svg>
    ${
      horsCarte.length
        ? `<p class="hint">${escapeHtml(
            t("Sans place sur la carte (aucun pays reconnu) : {zones}.", {
              zones: horsCarte.map((r) => `${ioNomPart(r.part, "zone")} ${formatPourcentage(r.part.part * 100)}`).join(", "),
            })
          )}</p>`
        : ""
    }
  </div>`;
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
    if (axe === "zone") ioRenderCarte(bloc);
    else ioRenderCamembert(bloc, axe);
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
// Combien de titres NOMMÉS le treemap montre : les suivants se FONDENT dans « Autres titres ». Tout
// n'est montré que si le curseur est au maximum (null). Par défaut, les quinze plus lourds.
// « Détenu par ETF, non déterminé » et « Autres titres » ne comptent pas dans ce nombre.
const IO_CARRES_DEFAUT = 15;
let ioNbCarres = IO_CARRES_DEFAUT;

/** Les parts du serveur, les titres au-delà de `limite` fondus dans une part « autres » (celle du
 *  serveur s'il y en a une, qui s'y ajoute). Les sources de la part fondue nomment les plus lourds. */
function ioFondreAuDela(parts, limite) {
  const nommes = parts.filter((p) => p.genre === "titre");
  if (nommes.length <= limite) return parts;
  const gardes = new Set(nommes.slice(0, limite));
  const fondus = nommes.slice(limite);
  const autres = parts.find((p) => p.genre === "autres");
  const somme = (cle) => fondus.reduce((s, p) => s + (p[cle] || 0), 0) + (autres ? autres[cle] || 0 : 0);
  const fondue = {
    cle: "autres",
    nom: null,
    genre: "autres",
    valorisation: somme("valorisation"),
    part: somme("part"),
    part_determinee: somme("part_determinee"),
    nombre_sources: fondus.length + (autres ? autres.nombre_sources : 0),
    sources: [...fondus.map((p) => ({ nom: p.nom, direct: false, valorisation: p.valorisation })), ...(autres ? autres.sources : [])]
      .sort((a, b) => b.valorisation - a.valorisation)
      .slice(0, 3),
  };
  return [...parts.filter((p) => p.genre !== "autres" && (p.genre !== "titre" || gardes.has(p))), fondue];
}

// Le gris clair des « Autres titres » : une part qui regroupe, pas un titre de plus — et
// distinct du gris de la part non déterminée, qui dit tout autre chose.
const IO_COULEUR_AUTRES = "#9aa0ad";

function ioNomPartTitre(part) {
  if (part.genre === "non_determine") return t("Détenu par ETF, non déterminé");
  if (part.genre === "autres") return t("Autres titres");
  return part.nom;
}

/**
 * LES CARRÉS (treemap) : une tuile par part, dont l'AIRE est proportionnelle à la valorisation.
 * Un disque ne se lit plus au-delà d'une dizaine de parts — les petites ne sont que des fils —,
 * alors que des aires se comparent d'un coup d'œil, même pour une quinzaine de titres.
 *
 * LA DISPOSITION EST « SQUARIFIÉE » (Bruls, Huizing, van Wijk) : on remplit une rangée tant
 * qu'ajouter une tuile rapproche les tuiles du carré, puis on en ouvre une autre dans ce qui
 * reste. Elle se calcule dans un repère `largeur × hauteur` quelconque ; l'écran la pose en
 * pourcentages, si bien que le cadre (`aspect-ratio`) s'étire sans recalcul.
 *
 * Rend, dans l'ordre des parts reçues, { x, y, l, h } — ou null pour une part de valeur nulle.
 */
function ioDispositionCarres(parts, largeur, hauteur) {
  const total = parts.reduce((somme, part) => somme + Math.max(part.valorisation, 0), 0);
  const rectangles = parts.map(() => null);
  if (!total) return rectangles;
  const echelle = (largeur * hauteur) / total;
  const restantes = parts
    .map((part, i) => ({ i, aire: Math.max(part.valorisation, 0) * echelle }))
    .filter((p) => p.aire > 0)
    .sort((a, b) => b.aire - a.aire);

  let libre = { x: 0, y: 0, l: largeur, h: hauteur };
  // Le pire rapport de forme d'une rangée posée sur le petit côté du libre.
  const pire = (rangee, cote) => {
    const somme = rangee.reduce((s, p) => s + p.aire, 0);
    const max = rangee[0].aire;
    const min = rangee[rangee.length - 1].aire;
    return Math.max((cote * cote * max) / (somme * somme), (somme * somme) / (cote * cote * min));
  };
  const poser = (rangee) => {
    const somme = rangee.reduce((s, p) => s + p.aire, 0);
    if (libre.l >= libre.h) {
      // Une colonne à gauche, ses tuiles empilées.
      const epaisseur = somme / libre.h;
      let y = libre.y;
      rangee.forEach((p) => {
        const h = p.aire / epaisseur;
        rectangles[p.i] = { x: libre.x, y, l: epaisseur, h };
        y += h;
      });
      libre = { x: libre.x + epaisseur, y: libre.y, l: libre.l - epaisseur, h: libre.h };
    } else {
      // Une rangée en haut, ses tuiles côte à côte.
      const epaisseur = somme / libre.l;
      let x = libre.x;
      rangee.forEach((p) => {
        const l = p.aire / epaisseur;
        rectangles[p.i] = { x, y: libre.y, l, h: epaisseur };
        x += l;
      });
      libre = { x: libre.x, y: libre.y + epaisseur, l: libre.l, h: libre.h - epaisseur };
    }
  };

  let rangee = [];
  restantes.forEach((p) => {
    const cote = Math.min(libre.l, libre.h);
    if (!rangee.length || pire([...rangee, p], cote) <= pire(rangee, cote)) {
      rangee.push(p);
    } else {
      poser(rangee);
      rangee = [p];
    }
  });
  if (rangee.length) poser(rangee);
  return rectangles;
}

// Le cadre des carrés, en unités quelconques : seul le rapport compte (cf. .io-carres).
const IO_CARRES_LARGEUR = 16;
const IO_CARRES_HAUTEUR = 9;
// Sous ces tailles (en % du cadre), une tuile ne porte plus de texte : son nom est dans la
// légende, dessous, et dans l'infobulle.
const IO_CARRES_MIN_NOM = { l: 9, h: 8 };

/** Les carrés d'un bloc, à la place du disque : mêmes champs `data-*` que les parts du disque,
 *  donc la même infobulle et la même surbrillance (cf. ioCablerSurvol). */
function ioRenderCarres(bloc, axe) {
  const conteneur = document.getElementById(`io-camembert-${axe}`);
  const rectangles = ioDispositionCarres(bloc.parts, IO_CARRES_LARGEUR, IO_CARRES_HAUTEUR);
  const tuiles = bloc.parts
    .map((part, i) => {
      const r = rectangles[i];
      if (!r) return "";
      const pct = {
        x: (r.x / IO_CARRES_LARGEUR) * 100,
        y: (r.y / IO_CARRES_HAUTEUR) * 100,
        l: (r.l / IO_CARRES_LARGEUR) * 100,
        h: (r.h / IO_CARRES_HAUTEUR) * 100,
      };
      const lisible = pct.l >= IO_CARRES_MIN_NOM.l && pct.h >= IO_CARRES_MIN_NOM.h;
      const texte = lisible
        ? `<span class="io-carre-nom">${escapeHtml(ioNomPart(part, axe))}</span>
           <span class="io-carre-part">${formatPourcentage(part.part * 100)}</span>`
        : "";
      return `<div class="io-part io-carre" data-index="${i}" data-io-cle="${ioCle(part)}"
          style="left:${pct.x}%;top:${pct.y}%;width:${pct.l}%;height:${pct.h}%;background:${ioCouleurPart(part)}">${texte}</div>`;
    })
    .join("");
  conteneur.innerHTML = `<div class="io-carres" role="img"
      aria-label="${escapeHtml(t("Exposition par action"))}">${tuiles}</div>`;
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
  const limite = ioNbCarres === null ? Infinity : ioNbCarres;
  const parts = ioFondreAuDela(bloc.parts, limite)
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
  // Le curseur va de 1 au nombre de titres nommés ; à son maximum (ou sans choix), tout est montré.
  const nbNommes = bloc.parts.filter((part) => part.genre !== "non_determine" && part.genre !== "autres").length;
  const curseur = document.getElementById("io-titres-nb");
  curseur.max = Math.max(nbNommes, 1);
  // Au-delà du nombre de titres, tout est montré : le curseur est alors à son maximum.
  curseur.value = ioNbCarres === null ? nbNommes : Math.min(ioNbCarres, nbNommes);
  document.getElementById("io-titres-nb-valeur").textContent = curseur.value;
  document.getElementById("io-titres-nb-bloc").style.display = nbNommes > 1 ? "" : "none";
  const vue = ioBlocTitres(bloc);
  // PAS DE LÉGENDE : le nom est écrit sur chaque case et l'infobulle dit le reste.
  ioRenderCarres(vue, "titre");
  ioCablerSurvol(vue, "titre");
}

document.getElementById("io-titres-nb")?.addEventListener("input", (e) => {
  const valeur = Number(e.target.value);
  ioNbCarres = valeur >= Number(e.target.max) ? null : valeur;
  ioRenderTitres();
});

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
    const [titres, zonesPays, ...lus] = await Promise.all([
      apiFetch("/investing-overview/exposition-titres"),
      apiFetch("/investing-overview/zones-pays"),
      ...IO_AXES.map((axe) => apiFetch(`/investing-overview/exposition?axe=${axe}`)),
    ]);
    ioExpositions = Object.fromEntries(IO_AXES.map((axe, i) => [axe, lus[i]]));
    ioAttribuerCouleurs(ioExpositions);
    ioTitres = titres;
    ioZonesPays = zonesPays;

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
