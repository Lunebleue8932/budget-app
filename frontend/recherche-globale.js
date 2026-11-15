/* ====================================================================================
 * LA FENÊTRE DE RECHERCHE
 *
 * Le champ de la barre latérale n'est plus un champ de saisie : il ouvre cette fenêtre, au milieu de
 * l'écran, dans un gris translucide — la page reste visible derrière, pour ne pas donner l'impression
 * d'avoir changé d'écran.
 *
 * DEUX SORTES DE RÉSULTATS, dans deux groupes :
 *   - « Dans cette page » : les correspondances de la page AFFICHÉE (celles que le noyau surligne,
 *     cf. appliquerRecherche, app.js), avec un peu du texte autour et la partie trouvée en jaune.
 *     Les choisir amène à la correspondance, dans la page.
 *   - « Ailleurs » : les correspondances des AUTRES pages (tous les écrans et onglets vivent dans le
 *     document, masqués), avec le chemin de leur page à droite — Section/Onglet/Partie. Les choisir
 *     ouvre la page, puis amène à la correspondance une fois ses données arrivées.
 * La recherche porte sur ce que l'application a déjà chargé : les opérations d'un autre mois n'y sont
 * pas tant qu'on ne les a pas affichées.
 *
 * LES RÉSULTATS ARRIVENT LIGNE PAR LIGNE (une courte pause entre deux lignes, par paquets quand il y
 * en a beaucoup) ; une nouvelle frappe repart de zéro.
 *
 * Choisir un résultat referme la fenêtre ET GARDE LE TERME : la page reste surlignée, le compte et les
 * chevrons de la barre servent à parcourir, la croix à effacer. Chargé après plan-app.js (libellés de
 * la navigation) et app.js (le moteur de surlignage : rechercheTerme, appliquerRecherche…).
 * ==================================================================================== */

const RECH_MAX_PAGE = 30;
const RECH_MAX_AILLEURS = 60;
/** La pause entre deux lignes, et la durée visée pour tout afficher (au-delà, on groupe les lignes). */
const RECH_PAUSE_LIGNE = 26;
const RECH_DUREE_MAX = 750;
const RECH_CONTEXTE_AVANT = 42;
const RECH_CONTEXTE_APRES = 60;

let rechResultats = [];
let rechSelection = -1;
let rechMinuteurLignes = null;
let rechMinuteurFrappe = null;
let rechMinuteurAller = null;

const rechEl = (id) => document.getElementById(id);
const rechCollapse = (texte) => (texte || "").replace(/\s+/g, " ");

/* ---------- Le texte autour d'une correspondance ---------- */

/** Le texte d'une portion du document, sans ce qui n'est pas du contenu (pastilles « i », champs
 *  repliés) et avec une espace entre deux cellules ou deux blocs voisins. */
function rechTexteDe(portion) {
  const copie = portion.cloneContents();
  copie
    .querySelectorAll(".info-bulle, script, style, select, option, textarea, [hidden], svg")
    .forEach((n) => n.remove());
  copie.querySelectorAll("td, th, div, p, li, br, button").forEach((n) => n.after(" "));
  return rechCollapse(copie.textContent);
}

/** Le bloc dont on lit le contexte : la LIGNE d'un tableau tout entière (date, libellé, montant), sinon
 *  le plus petit bloc de texte autour. */
function rechBlocDe(element) {
  return (
    element.closest("tr") ||
    element.closest("li, p, h1, h2, h3, h4, h5, label, td, th, summary, button, a, dd, dt") ||
    element.parentElement
  );
}

/** Ce qu'il y a avant et après une marque, dans son bloc. */
function rechContexteMarque(marque) {
  const bloc = rechBlocDe(marque);
  const avant = document.createRange();
  avant.selectNodeContents(bloc);
  avant.setEndBefore(marque);
  const apres = document.createRange();
  apres.selectNodeContents(bloc);
  apres.setStartAfter(marque);
  return { avant: rechTexteDe(avant), trouve: marque.textContent, apres: rechTexteDe(apres) };
}

function rechCouper({ avant, trouve, apres }) {
  const debut = avant.length > RECH_CONTEXTE_AVANT ? `…${avant.slice(-RECH_CONTEXTE_AVANT)}` : avant;
  const fin = apres.length > RECH_CONTEXTE_APRES ? `${apres.slice(0, RECH_CONTEXTE_APRES)}…` : apres;
  return { avant: debut.replace(/^\s+/, ""), trouve, apres: fin };
}

/* ---------- Les résultats de la page affichée : les marques que le noyau a posées ---------- */

function rechResultatsPage() {
  const marques = rechercheCorrespondances;
  const resultats = [];
  marques.slice(0, RECH_MAX_PAGE).forEach((marque, index) => {
    resultats.push({
      type: "page",
      index,
      ...rechCouper(rechContexteMarque(marque)),
    });
  });
  return { resultats, total: marques.length };
}

/* ---------- Les résultats des autres pages : le texte des écrans masqués ---------- */

/** Le chemin d'un nœud de texte — { section, sousSection, chemin } — ou null quand sa page n'est pas
 *  atteignable (écran d'une extension éteinte, onglet masqué…). */
function rechCheminDe(noeud) {
  const element = noeud.parentElement;
  const section = element?.closest("section[id^='section-']");
  if (!section) return null;
  const nom = section.id.replace(/^section-/, "");
  const bouton = document.querySelector(`header nav button[data-section="${CSS.escape(nom)}"]`);
  if (!bouton || !planEstMontre(bouton)) return null;

  const barre = planBarreOnglets(nom);
  let volet = element.closest(".sous-section");
  let onglet = null;
  while (volet && barre) {
    onglet = barre.querySelector(
      `button[data-sous-section="${CSS.escape(volet.id.replace(/^sous-section-/, ""))}"]`
    );
    if (onglet) break;
    volet = volet.parentElement?.closest(".sous-section") || null;
  }
  if (onglet && !planEstMontre(onglet)) return null;

  const morceaux = [planLibelle(bouton)];
  const nombreOnglets = barre
    ? [...barre.querySelectorAll("button[data-sous-section]")].filter(planEstMontre).length
    : 0;
  if (onglet && nombreOnglets > 1) morceaux.push(planLibelle(onglet));

  // La partie : le dernier titre qui précède le texte, dans son onglet.
  const portee = (onglet && volet) || section;
  let titre = null;
  for (const candidat of portee.querySelectorAll(".partie-titre, h2, h3")) {
    // Le texte EST ce titre : le chemin s'arrête à son onglet, il ne se termine pas par lui-même.
    if (candidat.contains(noeud)) {
      titre = null;
      break;
    }
    if (candidat.compareDocumentPosition(noeud) & Node.DOCUMENT_POSITION_FOLLOWING) titre = candidat;
    else break;
  }
  if (titre) {
    const libelle = planLibelleTitre(titre);
    if (libelle && libelle !== morceaux[morceaux.length - 1]) morceaux.push(libelle);
  }
  return {
    section: nom,
    sousSection: onglet ? onglet.dataset.sousSection : null,
    chemin: morceaux.join("/"),
  };
}

function rechNoeudsAilleurs(actif) {
  const racine = document.querySelector("main");
  if (!racine) return [];
  const noeuds = [];
  const parcours = document.createTreeWalker(racine, NodeFilter.SHOW_TEXT, {
    acceptNode(noeud) {
      if (!noeud.nodeValue || !noeud.nodeValue.trim()) return NodeFilter.FILTER_REJECT;
      if (actif && actif.contains(noeud)) return NodeFilter.FILTER_REJECT;
      for (let parent = noeud.parentElement; parent && parent !== racine; parent = parent.parentElement) {
        if (parent.namespaceURI === NAMESPACE_SVG) return NodeFilter.FILTER_REJECT;
        if (BALISES_HORS_RECHERCHE.has(parent.tagName)) return NodeFilter.FILTER_REJECT;
        if (parent.hidden || parent.style.display === "none") return NodeFilter.FILTER_REJECT;
        if (parent.classList.contains("info-bulle")) return NodeFilter.FILTER_REJECT;
      }
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  for (let n = parcours.nextNode(); n; n = parcours.nextNode()) noeuds.push(n);
  return noeuds;
}

function rechResultatsAilleurs(terme) {
  const resultats = [];
  const vus = new Set();
  let total = 0;
  for (const noeud of rechNoeudsAilleurs(sectionActive())) {
    const texte = noeud.nodeValue;
    const normalise = normaliserRecherche(texte);
    if (normalise.length !== texte.length) continue;
    let position = normalise.indexOf(terme);
    if (position === -1) continue;
    const chemin = rechCheminDe(noeud);
    if (!chemin) continue;
    for (let n = 0; position !== -1 && n < 2; n++) {
      const avant = rechCollapse(texte.slice(0, position));
      const apres = rechCollapse(texte.slice(position + terme.length));
      const cle = `${chemin.chemin}|${avant.slice(-20)}|${texte.slice(position, position + terme.length)}|${apres.slice(0, 20)}`;
      if (!vus.has(cle)) {
        vus.add(cle);
        total++;
        if (resultats.length < RECH_MAX_AILLEURS) {
          resultats.push({
            type: "ailleurs",
            ...chemin,
            ...rechCouper({
              avant,
              trouve: texte.slice(position, position + terme.length),
              apres,
            }),
          });
        }
      }
      position = normalise.indexOf(terme, position + terme.length);
    }
  }
  return { resultats, total };
}

/* ---------- Affichage : ligne par ligne ---------- */

function rechLigne(resultat, index) {
  const ligne = document.createElement("li");
  ligne.className = "recherche-ligne";
  ligne.setAttribute("role", "option");
  ligne.dataset.index = String(index);

  const texte = document.createElement("span");
  texte.className = "recherche-ligne-texte";
  const marque = document.createElement("mark");
  marque.className = "recherche-fenetre-marque";
  marque.textContent = resultat.trouve;
  texte.append(resultat.avant, marque, resultat.apres);
  ligne.append(texte);

  if (resultat.type === "ailleurs") {
    const chemin = document.createElement("span");
    chemin.className = "recherche-ligne-chemin";
    chemin.textContent = resultat.chemin;
    chemin.title = resultat.chemin;
    ligne.append(chemin);
  }
  ligne.addEventListener("mousemove", () => rechChoisir(index, { defiler: false }));
  ligne.addEventListener("click", () => rechActiver(resultat));
  return ligne;
}

function rechTitreGroupe(texte, detail) {
  const titre = document.createElement("li");
  titre.className = "recherche-groupe";
  titre.setAttribute("role", "presentation");
  titre.textContent = texte;
  if (detail) {
    const d = document.createElement("span");
    d.textContent = detail;
    titre.append(d);
  }
  return titre;
}

function rechNoteReste(texte) {
  const note = document.createElement("li");
  note.className = "recherche-reste hint";
  note.setAttribute("role", "presentation");
  note.textContent = texte;
  return note;
}

function rechChoisir(index, { defiler = true } = {}) {
  const liste = rechEl("recherche-fenetre-liste");
  const lignes = [...liste.querySelectorAll(".recherche-ligne")];
  if (!lignes.length) {
    rechSelection = -1;
    return;
  }
  rechSelection = Math.max(0, Math.min(index, rechResultats.length - 1));
  lignes.forEach((l) => l.classList.toggle("selectionnee", Number(l.dataset.index) === rechSelection));
  const cible = lignes.find((l) => Number(l.dataset.index) === rechSelection);
  if (cible && defiler) cible.scrollIntoView({ block: "nearest" });
}

/** Dessine la liste, une ligne après l'autre. */
function rechAfficher(page, ailleurs) {
  const liste = rechEl("recherche-fenetre-liste");
  clearTimeout(rechMinuteurLignes);
  liste.replaceChildren();
  rechResultats = [...page.resultats, ...ailleurs.resultats];

  // La suite de nœuds à poser, dans l'ordre : titres, lignes, notes.
  const fil = [];
  if (page.resultats.length) {
    fil.push(rechTitreGroupe(t("Dans cette page"), String(page.total)));
    page.resultats.forEach((r, i) => fil.push(rechLigne(r, i)));
    if (page.total > page.resultats.length) {
      fil.push(
        rechNoteReste(
          t("… et {n} autres dans cette page : les chevrons de la barre les parcourent", {
            n: page.total - page.resultats.length,
          })
        )
      );
    }
  }
  if (ailleurs.resultats.length) {
    fil.push(rechTitreGroupe(t("Ailleurs dans l'application"), String(ailleurs.total)));
    ailleurs.resultats.forEach((r, i) => fil.push(rechLigne(r, page.resultats.length + i)));
    if (ailleurs.total > ailleurs.resultats.length) {
      fil.push(
        rechNoteReste(t("… et {n} autres ailleurs : précise le terme", { n: ailleurs.total - ailleurs.resultats.length }))
      );
    }
  }
  if (!fil.length) {
    rechSelection = -1;
    rechEl("recherche-fenetre-compte").textContent = t("aucun résultat");
    return;
  }
  rechEl("recherche-fenetre-compte").textContent = `${page.total + ailleurs.total}`;

  const parPaquet = Math.max(1, Math.ceil(fil.length / (RECH_DUREE_MAX / RECH_PAUSE_LIGNE)));
  let i = 0;
  const suite = () => {
    for (let n = 0; n < parPaquet && i < fil.length; n++, i++) {
      liste.append(fil[i]);
      // Le premier résultat est choisi dès qu'il arrive : Entrée l'ouvre sans attendre le reste.
      if (rechSelection === -1 && fil[i].classList.contains("recherche-ligne")) rechChoisir(0);
    }
    if (i < fil.length) rechMinuteurLignes = setTimeout(suite, RECH_PAUSE_LIGNE);
  };
  rechSelection = -1;
  suite();
}

/* ---------- La recherche elle-même ---------- */

function rechLancer() {
  const champ = rechEl("recherche-fenetre-champ");
  rechercheTerme = champ.value;
  const terme = normaliserRecherche(rechercheTerme).trim();
  // Surligne la page affichée (visible à travers la fenêtre) ET remplit rechercheCorrespondances.
  appliquerRecherche({ conserverIndex: false });
  if (!terme) {
    clearTimeout(rechMinuteurLignes);
    rechEl("recherche-fenetre-liste").replaceChildren();
    rechEl("recherche-fenetre-compte").textContent = "";
    rechResultats = [];
    rechSelection = -1;
    return;
  }
  rechAfficher(rechResultatsPage(), rechResultatsAilleurs(terme));
}

/* ---------- Ouvrir un résultat ---------- */

function rechActiver(resultat) {
  // Choisir un résultat referme la fenêtre MAIS GARDE le terme : la page reste surlignée.
  rechercheFermerFenetre({ garder: true });
  if (resultat.type === "page") {
    rechercheIndex = resultat.index;
    majCorrespondanceCourante();
    return;
  }
  switchSection(resultat.section, resultat.sousSection ? { sousSection: resultat.sousSection } : {});
  const avant = rechCollapse(resultat.avant.replace(/^…/, ""));
  const apres = rechCollapse(resultat.apres.replace(/…$/, ""));
  let essais = 0;
  let stable = 0;
  let dernierNombre = -1;
  clearTimeout(rechMinuteurAller);
  // La page charge ses données, puis les dessine — par morceaux : une correspondance trouvée trop tôt
  // change de rang quand un bloc s'ajoute avant elle. On attend donc que le nombre de correspondances ne
  // bouge plus (trois lectures de suite), six secondes au plus, puis on s'y pose.
  const chercher = () => {
    appliquerRecherche({ conserverIndex: false });
    const trouvee = rechercheCorrespondances.findIndex((m) => {
      const c = rechContexteMarque(m);
      return c.avant.endsWith(avant) && c.apres.startsWith(apres);
    });
    const nombre = rechercheCorrespondances.length;
    stable = nombre === dernierNombre && trouvee >= 0 ? stable + 1 : 0;
    dernierNombre = nombre;
    if (stable >= 3 || ++essais > 17) {
      rechercheIndex = Math.max(trouvee, 0);
      majCorrespondanceCourante();
      return;
    }
    rechMinuteurAller = setTimeout(chercher, 350);
  };
  chercher();
}

/* ---------- La fenêtre ---------- */

function rechercheOuvrirFenetre() {
  const fond = rechEl("modale-recherche");
  if (!fond) return;
  fond.style.display = "flex";
  const champ = rechEl("recherche-fenetre-champ");
  champ.value = rechercheTerme;
  champ.focus();
  champ.select();
  if (rechercheTerme.trim()) rechLancer();
}

/** Ferme la fenêtre. SANS CHOIX (Échap, clic à côté), la frappe est supprimée avec elle — le terme, la liste
 *  et le surlignage de la page ; `garder` (un résultat vient d'être choisi) conserve le terme. */
function rechercheFermerFenetre({ garder = false } = {}) {
  const fond = rechEl("modale-recherche");
  if (!fond) return;
  clearTimeout(rechMinuteurLignes);
  clearTimeout(rechMinuteurFrappe);
  fond.style.display = "none";
  if (garder) return;
  rechEl("recherche-fenetre-champ").value = "";
  rechEl("recherche-fenetre-liste").replaceChildren();
  rechEl("recherche-fenetre-compte").textContent = "";
  rechResultats = [];
  rechSelection = -1;
  rechercheTerme = "";
  appliquerRecherche({ conserverIndex: false });
}

(function rechercheCablerFenetre() {
  const fond = rechEl("modale-recherche");
  const champ = rechEl("recherche-fenetre-champ");
  if (!fond || !champ) return;
  rechEl("recherche-fenetre-loupe").innerHTML = ICONE_LOUPE;

  champ.addEventListener("input", () => {
    clearTimeout(rechMinuteurFrappe);
    rechMinuteurFrappe = setTimeout(rechLancer, 110);
  });
  champ.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      rechChoisir(rechSelection + 1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      rechChoisir(rechSelection - 1);
    } else if (e.key === "Enter") {
      e.preventDefault();
      // Une frappe encore en attente : on la joue d'abord, le choix porterait sur l'ancienne liste.
      if (rechMinuteurFrappe) {
        clearTimeout(rechMinuteurFrappe);
        rechMinuteurFrappe = null;
        rechLancer();
      }
      const resultat = rechResultats[rechSelection];
      if (resultat) rechActiver(resultat);
    }
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && fond.style.display !== "none") rechercheFermerFenetre();
  });
  // Un clic hors de la fenêtre la ferme, et la frappe avec elle.
  fond.addEventListener("mousedown", (e) => {
    if (e.target === fond) rechercheFermerFenetre();
  });

  // TANT QUE LA SOURIS EST SUR LA FENÊTRE, LA PAGE NE DÉFILE PAS : la molette ne fait défiler que la liste,
  // et s'arrête à ses bornes au lieu de passer à la page (le « scroll chaining » du navigateur).
  const panneau = fond.querySelector(".modale-recherche");
  const liste = rechEl("recherche-fenetre-liste");
  panneau.addEventListener(
    "wheel",
    (e) => {
      if (liste.contains(e.target) && liste.scrollHeight > liste.clientHeight) {
        const auBout =
          (e.deltaY < 0 && liste.scrollTop <= 0) ||
          (e.deltaY > 0 && liste.scrollTop + liste.clientHeight >= liste.scrollHeight - 1);
        if (!auBout) return;
      }
      e.preventDefault();
    },
    { passive: false }
  );
})();
