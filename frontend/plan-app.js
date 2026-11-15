/* ---------- LE PLAN DE L'APPLICATION ----------
 *
 * Une carte mentale de « où est quoi », posée dans Paramètres → Paramètres généraux :
 * le DASHBOARD au centre, les autres pages autour de lui, puis leurs onglets, puis les
 * parties d'un onglet. Chaque pastille MÈNE à ce qu'elle nomme.
 *
 * LA DISPOSITION EST CELLE D'UN GRAPHE D'OBSIDIAN, pas d'un arbre : on part d'une
 * disposition rayonnante (un secteur d'angle par page, proportionnel à ce qu'elle
 * porte), puis une relaxation à ressorts écarte les pastilles qui se chevauchent et
 * resserre les liens. Le calcul est synchrone et DÉTERMINISTE (aucun hasard) : le même
 * plan se dessine de la même façon à chaque ouverture, et rien ne bouge sous la souris.
 *
 * ELLE NE SE DÉCRIT PAS, ELLE SE LIT. Le plan est reconstruit à chaque ouverture des
 * paramètres généraux à partir de la barre de navigation, des barres d'onglets et des
 * titres de parties qui sont DANS LE DOCUMENT à ce moment-là. Une extension éteinte
 * masque ses boutons (cf. `majVisibiliteNavigation`, extensions.js) : sa page, son
 * onglet ou sa partie n'ont donc plus de pastille, et reviennent d'eux-mêmes quand on
 * la rallume. Une liste écrite ici à la main aurait fini par annoncer des pages
 * qui n'existent plus — ou par en oublier d'apportées par une extension qu'elle ne
 * connaît pas.
 *
 * LES PARTIES sont les titres `.partie-titre` (Configuration…) ou portant `data-plan-partie`
 * (Placements financiers, Règles : des titres qu'on ne veut pas agrandir à l'écran).
 * `data-plan-ouvrir` y désigne ce qu'il faut cliquer d'abord quand la partie se trouve dans
 * un volet intérieur à l'onglet (« Titres suivis », « Configuration » de Placements, la
 * barre « Règles | Renommages ») : sans cela la pastille ouvrirait l'onglet sans montrer la
 * partie.
 *
 * LES NOMS SONT CEUX DES BOUTONS, tels qu'ils s'affichent : dans la langue du moment,
 * et sous le nom que lui donne une greffe (« Vue des avoirs » devenue autre chose).
 * Chargé APRÈS app.js : il appelle `switchSection` au clic seulement. Il se redessine à
 * l'ouverture des paramètres généraux (`loadParametresGeneraux`), à chaque extension
 * chargée, et à chaque allumage ou extinction (`majVisibiliteNavigation`).
 */

/** Un élément est montré tant que ni lui ni sa dernière pose ne le masquent. */
function planEstMontre(element) {
  return !!element && element.style.display !== "none" && !element.hidden;
}

/** Posé par une extension, donc masqué par elle quand elle s'éteint (cf. majVisibiliteNavigation). */
function planVientDUneExtension(element) {
  const d = element.dataset;
  return !!(d.extension || d.extensionGreffe || d.extensionOnglet);
}

/** Le libellé d'un bouton, sans sa pastille « i » ni son logo. */
function planLibelle(element) {
  const copie = element.cloneNode(true);
  copie.querySelectorAll(".info-bulle, img").forEach((n) => n.remove());
  return copie.textContent.replace(/\s+/g, " ").trim();
}

/** Le libellé d'un titre de partie : sans pastille, logo ni compteur (`<span>` du titre). */
function planLibelleTitre(element) {
  const copie = element.cloneNode(true);
  copie.querySelectorAll(".info-bulle, img, span").forEach((n) => n.remove());
  return copie.textContent.replace(/\s+/g, " ").trim();
}

/** Le logo d'un bouton d'onglet, recopié, ou null. */
function planLogo(bouton) {
  const logo = bouton.querySelector("img.onglet-logo");
  return logo ? logo.cloneNode(true) : null;
}

/** La barre d'onglets d'un écran : `#<écran>-sous-nav`, à défaut la première barre de
 *  l'écran qui porte des onglets de page. */
function planBarreOnglets(section) {
  const barre = document.getElementById(`${section}-sous-nav`);
  if (barre) return barre;
  return (
    [...document.querySelectorAll(`#section-${section} .sous-onglets`)].find((b) =>
      b.querySelector("button[data-sous-section]")
    ) || null
  );
}

/** Les parties d'un onglet qui sont montrées. Un bloc n'en masque que s'il est caché par UNE
 *  EXTENSION éteinte : les volets intérieurs d'un onglet (cachés tant qu'on ne les a pas ouverts)
 *  ne retirent rien du plan, c'est tout son intérêt de dire où ils sont. */
function planParties(sousSection) {
  const volet = document.getElementById(`sous-section-${sousSection}`);
  if (!volet) return [];
  return [...volet.querySelectorAll(".partie-titre, [data-plan-partie]")]
    .filter((titre) => {
      for (let n = titre; n && n !== volet; n = n.parentElement) {
        if (n.hidden) return false;
        if (n.style.display === "none" && (n === titre || planVientDUneExtension(n))) return false;
      }
      return true;
    })
    .map((titre) => ({ titre, libelle: planLibelleTitre(titre), logo: planLogo(titre) }))
    .filter((partie) => partie.libelle);
}

/** L'arbre des pages disponibles : [{ section, libelle, onglets: [{ sousSection, libelle, parties }] }]. */
function planConstruire() {
  return [...document.querySelectorAll("header nav button[data-section]")]
    .filter(planEstMontre)
    .map((bouton) => {
      const section = bouton.dataset.section;
      const barre = planBarreOnglets(section);
      const boutons = barre
        ? [...barre.querySelectorAll("button[data-sous-section]")].filter(planEstMontre)
        : [];
      // UN ONGLET SEUL NE CHOISIT RIEN (cf. majBarreOnglets, extensions.js) : il répéterait
      // la page. Il ne figure que s'il y a de quoi choisir.
      const onglets =
        boutons.length > 1
          ? boutons.map((b) => ({
              sousSection: b.dataset.sousSection,
              libelle: planLibelle(b),
              logo: planLogo(b),
              parties: planParties(b.dataset.sousSection),
            }))
          : [];
      // LE PREMIER ONGLET de la page, même quand elle n'en montre qu'un : cliquer la page mène toujours
      // à lui, et non à l'onglet où l'on s'était arrêté la dernière fois.
      const premierOnglet = boutons.length ? boutons[0].dataset.sousSection : null;
      return { section, libelle: planLibelle(bouton), logo: planLogo(bouton), onglets, premierOnglet };
    })
    .filter((page) => page.libelle);
}

/** Va à un écran, à l'un de ses onglets, voire à l'une de ses parties. */
function planOuvrir(section, sousSection = null, titre = null) {
  switchSection(section, sousSection ? { sousSection } : {});
  if (!titre) {
    window.scrollTo({ top: 0, behavior: "smooth" });
    return;
  }
  const aller = () => titre.scrollIntoView({ behavior: "smooth", block: "start" });
  // Une partie rangée dans un volet intérieur : on l'ouvre d'abord, puis on y va.
  const selecteur = titre.dataset.planOuvrir;
  if (selecteur) {
    // L'onglet charge ses données puis dessine ses volets : on attend que le bouton existe (six
    // secondes au plus), et un temps de plus avant d'y aller, sans quoi un redessin du chargement
    // défairait le clic.
    let essais = 0;
    const cliquer = () => {
      const prealable = document.querySelector(selecteur);
      if (prealable) {
        setTimeout(() => {
          prealable.click();
          setTimeout(aller, 150);
        }, 300);
      } else if (++essais < 30) {
        setTimeout(cliquer, 200);
      } else {
        aller();
      }
    };
    cliquer();
  } else {
    aller();
  }
}

/* ---------- Le graphe : nœuds, liens, disposition ---------- */

const PLAN_NIVEAUX = ["centre", "page", "onglet", "partie"];
/** Longueur au repos du lien qui rattache un nœud à son parent, par niveau du nœud. */
const PLAN_LONGUEUR_LIEN = [0, 175, 150, 125];
const PLAN_HAUTEUR_NOEUD = 30;
const PLAN_ECART = 14;

/** De quoi dessiner : le Dashboard au centre, les autres pages autour, leurs onglets, leurs parties. */
function planGraphe(pages) {
  if (!pages.length) return { noeuds: [], liens: [] };
  const racine = pages.find((p) => p.section === "dashboard") || pages[0];
  const autres = pages.filter((p) => p !== racine);

  const noeuds = [];
  const liens = [];
  const creer = (niveau, libelle, logo, ouvrir, parent) => {
    const noeud = {
      id: noeuds.length,
      niveau,
      libelle,
      logo,
      ouvrir,
      parent,
      feuilles: 1,
      x: 0,
      y: 0,
      // Largeur ESTIMÉE (le plan peut être dessiné dans un écran masqué, où rien ne se mesure).
      l: 26 + libelle.length * 7 + (logo ? 20 : 0),
      h: PLAN_HAUTEUR_NOEUD,
    };
    noeuds.push(noeud);
    if (parent) liens.push([parent, noeud]);
    return noeud;
  };

  const centre = creer(
    "centre",
    racine.libelle,
    racine.logo,
    () => planOuvrir(racine.section, racine.premierOnglet),
    null
  );
  autres.forEach((page) => {
    const noeudPage = creer("page", page.libelle, page.logo, () => planOuvrir(page.section, page.premierOnglet), centre);
    page.onglets.forEach((onglet) => {
      const noeudOnglet = creer(
        "onglet",
        onglet.libelle,
        onglet.logo,
        () => planOuvrir(page.section, onglet.sousSection),
        noeudPage
      );
      onglet.parties.forEach((partie) =>
        creer(
          "partie",
          partie.libelle,
          partie.logo,
          () => planOuvrir(page.section, onglet.sousSection, partie.titre),
          noeudOnglet
        )
      );
    });
  });

  // Le poids d'un nœud : le nombre de feuilles dessous, qui décide de la part d'angle qu'il reçoit.
  // Les parents sont créés avant leurs enfants : en remontant, chaque enfant est déjà totalisé.
  const aDesEnfants = new Set(liens.map(([a]) => a.id));
  noeuds.forEach((n) => {
    if (aDesEnfants.has(n.id)) n.feuilles = 0;
  });
  for (let i = noeuds.length - 1; i > 0; i--) noeuds[i].parent.feuilles += noeuds[i].feuilles;
  return { noeuds, liens };
}

/** Disposition de départ : chaque nœud au milieu du secteur d'angle de son sous-arbre. */
function planDisposerEnRayons(noeuds) {
  const enfants = (n) => noeuds.filter((m) => m.parent === n);
  const placer = (noeud, debut, fin, profondeur, rayon) => {
    const milieu = (debut + fin) / 2;
    if (profondeur > 0) {
      const r = rayon + PLAN_LONGUEUR_LIEN[Math.min(profondeur, 3)];
      noeud.x = Math.cos(milieu) * r * 1.35;
      noeud.y = Math.sin(milieu) * r;
      rayon = r;
    }
    const fils = enfants(noeud);
    const total = fils.reduce((s, f) => s + f.feuilles, 0) || 1;
    let a = debut;
    fils.forEach((fils1) => {
      const part = ((fin - debut) * fils1.feuilles) / total;
      placer(fils1, a, a + part, profondeur + 1, rayon);
      a += part;
    });
  };
  // Le premier rayon part vers le haut, pour que le plan se lise comme une horloge.
  placer(noeuds[0], -Math.PI / 2, (3 * Math.PI) / 2, 0, 0);
}

/** Relaxation : ressorts le long des liens, écart minimal entre pastilles, centre fixe. */
function planRelaxer(noeuds, liens) {
  const iterations = 360;
  for (let it = 0; it < iterations; it++) {
    const pas = 0.35 * (1 - it / iterations) + 0.05;
    liens.forEach(([a, b]) => {
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const d = Math.hypot(dx, dy) || 1;
      // Trop long, le lien tire ses deux bouts l'un vers l'autre ; trop court, il les écarte.
      const f = ((d - PLAN_LONGUEUR_LIEN[PLAN_NIVEAUX.indexOf(b.niveau)]) / d) * 0.3 * pas;
      const partB = a.niveau === "centre" ? 1 : 0.5;
      if (a.niveau !== "centre") {
        a.x += dx * f * 0.5;
        a.y += dy * f * 0.5;
      }
      b.x -= dx * f * partB;
      b.y -= dy * f * partB;
    });
    for (let i = 0; i < noeuds.length; i++) {
      for (let j = i + 1; j < noeuds.length; j++) {
        const a = noeuds[i];
        const b = noeuds[j];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const recouvreX = (a.l + b.l) / 2 + PLAN_ECART - Math.abs(dx);
        const recouvreY = (a.h + b.h) / 2 + PLAN_ECART - Math.abs(dy);
        if (recouvreX > 0 && recouvreY > 0) {
          // On écarte selon l'axe où le chevauchement est le plus faible.
          const sx = dx === 0 ? (i % 2 ? 1 : -1) : Math.sign(dx);
          const sy = dy === 0 ? (j % 2 ? 1 : -1) : Math.sign(dy);
          const mobileA = a.niveau !== "centre";
          const part = mobileA ? 0.5 : 0;
          if (recouvreY < recouvreX) {
            a.y -= sy * recouvreY * part;
            b.y += sy * recouvreY * (1 - part);
          } else {
            a.x -= sx * recouvreX * part;
            b.x += sx * recouvreX * (1 - part);
          }
        } else {
          // Une faible répulsion à distance : les branches ne se frôlent pas.
          const d2 = dx * dx + dy * dy || 1;
          const f = (900 / d2) * pas;
          const d = Math.sqrt(d2);
          if (a.niveau !== "centre") {
            a.x -= (dx / d) * f;
            a.y -= (dy / d) * f;
          }
          b.x += (dx / d) * f;
          b.y += (dy / d) * f;
        }
      }
    }
    noeuds[0].x = 0;
    noeuds[0].y = 0;
  }
}

/** Redessine le plan une fois la rafale de changements passée : à son chargement, une
 *  extension après l'autre pose ses boutons, et chaque allumage ou extinction en masque ou
 *  en montre d'autres. Un seul dessin pour le lot. */
let planMinuterie = null;
function planRedessiner() {
  clearTimeout(planMinuterie);
  planMinuterie = setTimeout(renderPlanApplication, 50);
}

document.addEventListener("budgetapp:extension-chargee", planRedessiner);

function renderPlanApplication() {
  const conteneur = document.getElementById("plan-app");
  if (!conteneur) return;
  conteneur.textContent = "";

  const { noeuds, liens } = planGraphe(planConstruire());
  if (!noeuds.length) return;
  planDisposerEnRayons(noeuds);
  planRelaxer(noeuds, liens);

  // Les bornes du dessin, pastilles comprises, ramenées dans un cadre à marge fixe.
  const marge = 24;
  const gauche = Math.min(...noeuds.map((n) => n.x - n.l / 2));
  const haut = Math.min(...noeuds.map((n) => n.y - n.h / 2));
  const droite = Math.max(...noeuds.map((n) => n.x + n.l / 2));
  const bas = Math.max(...noeuds.map((n) => n.y + n.h / 2));
  const largeur = Math.ceil(droite - gauche + 2 * marge);
  const hauteur = Math.ceil(bas - haut + 2 * marge);
  noeuds.forEach((n) => {
    n.x += marge - gauche;
    n.y += marge - haut;
  });

  const graphe = document.createElement("div");
  graphe.className = "plan-graphe";
  graphe.style.width = `${largeur}px`;
  graphe.style.height = `${hauteur}px`;

  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("class", "plan-liens");
  svg.setAttribute("width", largeur);
  svg.setAttribute("height", hauteur);
  svg.setAttribute("aria-hidden", "true");
  const traits = new Map();
  liens.forEach(([a, b]) => {
    const trait = document.createElementNS(ns, "line");
    trait.setAttribute("x1", a.x.toFixed(1));
    trait.setAttribute("y1", a.y.toFixed(1));
    trait.setAttribute("x2", b.x.toFixed(1));
    trait.setAttribute("y2", b.y.toFixed(1));
    svg.appendChild(trait);
    traits.set(b.id, trait);
  });
  graphe.appendChild(svg);

  noeuds.forEach((n) => {
    const bouton = document.createElement("button");
    bouton.type = "button";
    bouton.className = `plan-noeud plan-${n.niveau}`;
    bouton.style.left = `${n.x.toFixed(1)}px`;
    bouton.style.top = `${n.y.toFixed(1)}px`;
    if (n.logo) bouton.appendChild(n.logo);
    bouton.appendChild(document.createTextNode(n.libelle));
    bouton.addEventListener("click", n.ouvrir);
    // Au survol, le lien qui mène au nœud s'allume (comme les liens d'une note dans Obsidian).
    bouton.addEventListener("mouseenter", () => traits.get(n.id)?.classList.add("plan-lien-actif"));
    bouton.addEventListener("mouseleave", () => traits.get(n.id)?.classList.remove("plan-lien-actif"));
    graphe.appendChild(bouton);
  });
  conteneur.appendChild(graphe);
  // Fenêtre plus étroite que le plan : on le montre centré sur le Dashboard.
  conteneur.scrollLeft = Math.max(0, noeuds[0].x - conteneur.clientWidth / 2);
}
