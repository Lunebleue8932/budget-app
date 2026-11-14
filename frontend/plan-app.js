/* ---------- LE PLAN DE L'APPLICATION ----------
 *
 * Une carte mentale de « où est quoi », posée dans Paramètres → Paramètres généraux :
 * le nom de l'app au centre, ses pages autour, puis leurs onglets, puis les parties
 * d'un onglet. Chaque pastille MÈNE à ce qu'elle nomme.
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

/** Le libellé d'un bouton ou d'un titre, sans sa pastille « i » ni son logo. */
function planLibelle(element) {
  const copie = element.cloneNode(true);
  copie.querySelectorAll(".info-bulle, img").forEach((n) => n.remove());
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

/** Les parties d'un onglet (titres `.partie-titre`) qui sont montrées : ni elles ni leur bloc
 *  ne sont masqués par une extension éteinte. */
function planParties(sousSection) {
  const volet = document.getElementById(`sous-section-${sousSection}`);
  if (!volet) return [];
  return [...volet.querySelectorAll(".partie-titre")]
    .filter((titre) => {
      for (let n = titre; n && n !== volet; n = n.parentElement) {
        if (!planEstMontre(n)) return false;
      }
      return true;
    })
    .map((titre) => ({ titre, libelle: planLibelle(titre), logo: planLogo(titre) }))
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
      return { section, libelle: planLibelle(bouton), logo: planLogo(bouton), onglets };
    })
    .filter((page) => page.libelle);
}

/** Va à un écran, à l'un de ses onglets, voire à l'une de ses parties. */
function planOuvrir(section, sousSection = null, titre = null) {
  switchSection(section, sousSection ? { sousSection } : {});
  if (titre) titre.scrollIntoView({ behavior: "smooth", block: "start" });
  else window.scrollTo({ top: 0, behavior: "smooth" });
}

function planNoeud(classe, libelle, logo, ouvrir) {
  const bouton = document.createElement("button");
  bouton.type = "button";
  bouton.className = `plan-noeud ${classe}`;
  if (logo) bouton.appendChild(logo);
  bouton.appendChild(document.createTextNode(libelle));
  bouton.addEventListener("click", ouvrir);
  return bouton;
}

function planBranche(noeud, enfants) {
  const item = document.createElement("li");
  item.appendChild(noeud);
  if (enfants.length) {
    const liste = document.createElement("ul");
    liste.className = "plan-enfants";
    enfants.forEach((enfant) => liste.appendChild(enfant));
    item.appendChild(liste);
  }
  return item;
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

  const racine = document.createElement("div");
  racine.className = "plan-racine";
  racine.textContent = "Budget App";

  const liste = document.createElement("ul");
  liste.className = "plan-enfants";
  planConstruire().forEach((page) => {
    const onglets = page.onglets.map((onglet) =>
      planBranche(
        planNoeud("plan-onglet", onglet.libelle, onglet.logo, () =>
          planOuvrir(page.section, onglet.sousSection)
        ),
        onglet.parties.map((partie) =>
          planBranche(
            planNoeud("plan-partie", partie.libelle, partie.logo, () =>
              planOuvrir(page.section, onglet.sousSection, partie.titre)
            ),
            []
          )
        )
      )
    );
    liste.appendChild(
      planBranche(
        planNoeud("plan-page", page.libelle, page.logo, () => planOuvrir(page.section)),
        onglets
      )
    );
  });

  const arbre = document.createElement("div");
  arbre.className = "plan-arbre";
  arbre.append(racine, liste);
  conteneur.appendChild(arbre);
}
