"""Importer des titres : un fichier Excel ou CSV qui DÉCRIT des titres, sans rien acheter.

UNE LIGNE = UN ISIN, avec — dans les colonnes que l'utilisateur a désignées — son nom,
sa monnaie, son enveloppe, ses répartitions (classe d'actif, zone, secteur) et, pour un
ETF, le dictionnaire de son indice. C'est ce qui fait entrer dans l'application les
données de RÉFÉRENCE que ni un relevé de courtier ni une page de cours ne donnent, et
dont les graphes d'exposition ont besoin. Le fichier se prépare dans un tableur ; les
colonnes se désignent à la lecture, dans un format qu'on enregistre.

CALQUÉ SUR L'IMPORT DE PLACEMENTS, À UNE DIFFÉRENCE PRÈS. Les colonnes se configurent comme
ailleurs, la lecture du fichier est celle du noyau (`lire_lignes_brutes`), on relit un
aperçu avant de valider. Mais cet import ne crée AUCUNE opération : il pose des propriétés
sur des titres. D'où quatre règles qui n'ont rien à voir avec un relevé :

  - UNE CELLULE VIDE NE CHANGE RIEN. Le fichier complète, il n'efface jamais : un secteur
    qu'on ne connaît pas se laisse vide, et ce n'est pas une demande de
    retirer celui qu'on avait saisi à la main. Même convention que `crud.update_titre`
    (`None` = ne change pas) ;
  - UNE CELLULE RENSEIGNÉE REMPLACE. Une répartition posée par le fichier remplace celle
    du titre sur cet axe, d'un bloc : c'est un instantané, pas des lignes qu'on ajoute ;
  - L'ISIN EST LA CLÉ. Un titre se reconnaît à son ISIN ; à défaut, à son nom quand le
    titre en base n'a pas encore d'ISIN (le fichier le complète). Un nom déjà pris par un
    titre dont l'ISIN DIFFÈRE met la ligne en erreur : deviner mélangerait deux titres ;
  - RÉIMPORTER LE MÊME FICHIER EST LE GESTE NORMAL (on met un ETF à jour tous les mois) :
    pas de détection de doublons, des lignes « inchangé ». Pas d'annulation non plus —
    aucune opération n'est créée, et l'import est idempotent.

RIEN N'EST RENORMALISÉ (cf. services/exposition) : une répartition à 70 % reste à 70 %, et
l'aperçu le dit.

L'APERÇU ET LA CONFIRMATION CALCULENT LA MÊME CHOSE (`_resoudre`) : l'aperçu doit montrer
exactement ce que la confirmation fera, et deux calculs séparés finiraient par diverger.
"""
import re
import unicodedata
from datetime import date as date_type
from typing import Optional

from app import crud, extensions
from app.constants import (
    PROPRIETES_IMPORT_TITRE,
    AxeTitre,
)
from app.services import exposition, identite_titre, import_bancaire, placements

import schemas_import_titres as schemas_t

# Propriété -> clé du dict de ligne brute produit par `lire_lignes_brutes`.
PROPRIETE_VERS_CLE = {propriete: f"{propriete}_brut" for propriete in PROPRIETES_IMPORT_TITRE}

# Les trois propriétés du fichier qui sont des répartitions, et leur axe.
REPARTITIONS = {
    "classe_actif": AxeTitre.classe.value,
    "zone": AxeTitre.zone.value,
    "secteur": AxeTitre.secteur.value,
}

# Les noms que l'aperçu donne aux champs qu'une ligne ferait changer.
NOMS_CHAMPS = {
    "nom": "Nom",
    "monnaie": "Monnaie",
    "enveloppe": "Enveloppe",
    "classe_actif": "Classe d'actif",
    "zone": "Zone géographique",
    "secteur": "Secteur",
    "composition": "Composition",
    "couverture_pct": "Couverture",
    "code_isin": "ISIN",
    "cours": "Cours",
}

# La feuille que l'import lit dans un classeur : celle du modèle. Par son NOM, et non la
# feuille active — un classeur qui porte une feuille de remarques peut très bien être
# enregistré ouvert sur celle-là. Un fichier sans feuille de ce nom retombe sur l'active.
FEUILLE_TITRES = "Titres"

EXTENSION_COURS = "lecture-de-cours"


def cours_disponible() -> bool:
    """La colonne « Cours » n'existe que pour qui a « Lecture de cours » : sans elle, le
    modèle ne la porte pas et l'import ne la lit pas."""
    return extensions.est_active(EXTENSION_COURS)


def _vide(valeur) -> bool:
    return valeur is None or (isinstance(valeur, str) and not valeur.strip())


def _cle(texte) -> str:
    """Un libellé comparé sans casse, sans accents ni espaces : « états-unis »
    retrouve « États-Unis » sans qu'on ait à écrire la casse exacte."""
    return import_bancaire.normaliser_libelle(str(texte or ""))


def _texte(valeur) -> str:
    """Une cellule en texte. Un nombre entier d'un classeur (« 12.0 ») s'écrit « 12 »."""
    if isinstance(valeur, float) and valeur == int(valeur):
        return str(int(valeur))
    return str(valeur).strip()


def lire(contenu: bytes, preset, delimiteur: Optional[str]) -> list[dict]:
    """Les lignes brutes du fichier, selon les colonnes du preset."""
    return import_bancaire.lire_lignes_brutes(
        contenu,
        preset.colonnes,
        preset.lignes_entete,
        delimiteur,
        propriete_vers_cle=PROPRIETE_VERS_CLE,
        feuille=FEUILLE_TITRES,
    )


def _lire_cours(valeur) -> Optional[float]:
    """Un cours en nombre, ou None s'il est illisible. Tolère le symbole ou le code de la
    monnaie qu'un tableur ou un copier-coller ajoute volontiers (« 104,52 € », « USD 104.52 »)."""
    if isinstance(valeur, (int, float)) and not isinstance(valeur, bool):
        return float(valeur)
    texte = re.sub(r"[^\d,.\-]", "", str(valeur))
    return import_bancaire.parser_montant(texte) if texte else None


# ---------- Ce que la base connaît ----------


class _Contexte:
    """Tout ce que la résolution consulte, lu une fois : les titres (archivés compris,
    un relevé qui retrouve un titre rangé ne doit pas en créer un second), les
    étiquettes de chaque axe, les monnaies."""

    def __init__(self, db):
        self.db = db
        self.titres = crud.get_titres(db, inclure_archivees=True)
        self.par_isin = {t.code_isin: t for t in self.titres if t.code_isin}
        # (nom, ISIN), l'ISIN tranche : la règle de toute l'application.
        self.index = identite_titre.IndexTitres(self.titres)
        # Les titres sans ISIN qu'une ligne du fichier a déjà revendiqués (elle va leur
        # donner SON ISIN) : un homonyme plus bas, sous un autre ISIN, est un autre titre.
        self.revendiques: set[int] = set()
        self.etiquettes = {
            axe.value: {_cle(e.nom): e for e in crud.get_types_titre(db, axe.value)}
            for axe in AxeTitre
        }
        self.monnaies = crud.get_monnaies(db)
        self.cours_lu = cours_disponible()
        self.par_monnaie = {}
        for monnaie in self.monnaies:
            self.par_monnaie[_cle(monnaie.nom)] = monnaie
            if monnaie.symbole:
                self.par_monnaie.setdefault(_cle(monnaie.symbole), monnaie)

    def etiquette(self, axe: str, nom: str):
        return self.etiquettes[axe].get(_cle(nom))


def _isin_de(brute: dict) -> str:
    return exposition.normaliser_isin(brute.get("code_isin_brut"))


# ---------- La résolution d'une ligne ----------


def _libelle_repartition(lignes: list[tuple[str, float]]) -> str:
    return " ; ".join(f"{nom} {poids:g} %" for nom, poids in lignes)


def _repartition_en_base(titre, axe: str) -> list[tuple[str, float]]:
    return [(e.etiquette.nom, e.poids_pct) for e in titre.repartition(axe)] if titre else []


def _resoudre_ligne(ctx: _Contexte, brute: dict, deja_vus: dict[str, int]) -> dict:
    """Une ligne brute -> ce qu'elle ferait : erreurs, avertissements, changements, et le
    `plan` que la confirmation applique."""
    numero = brute["ligne"]
    erreurs: list[str] = []
    avertissements: list[str] = []
    changements: list[dict] = []
    a_creer: list[dict] = []
    plan: dict = {"repartitions": {}}

    isin = _isin_de(brute)
    nom = _texte(brute["nom_brut"]) if not _vide(brute.get("nom_brut")) else None
    if not isin:
        erreurs.append("ISIN manquant")
    elif not exposition.isin_valide(isin):
        erreurs.append(f"« {isin} » n'est pas un ISIN valide")
    elif isin in deja_vus:
        erreurs.append(f"cet ISIN figure déjà à la ligne {deja_vus[isin]}")
    elif isin:
        deja_vus[isin] = numero

    titre = None
    if isin and not erreurs:
        # L'ISIN TRANCHE (cf. services/identite_titre.py) : un homonyme sous un autre ISIN
        # est un autre titre, à créer ; un homonyme SANS ISIN est celui-ci, que le fichier
        # complète.
        titre, _ = ctx.index.identifier(nom, isin)
        if titre is not None and not titre.code_isin and titre.id in ctx.revendiques:
            titre = None
        if titre is not None and not titre.code_isin:
            ctx.revendiques.add(titre.id)
            plan["isin_a_completer"] = isin
            changements.append({"champ": "code_isin", "avant": None, "apres": isin})

    existe = titre is not None
    plan["titre_id"] = titre.id if existe else None
    plan["isin"] = isin

    # ---- Le nom : celui d'un titre CRÉÉ seulement ----
    if not existe and not erreurs:
        if nom:
            plan["nom"] = nom
        else:
            plan["nom"] = isin
            avertissements.append("nom absent : l'ISIN sert de nom au titre créé")

    # ---- La monnaie ----
    monnaie_cellule = brute.get("monnaie_brut")
    if not _vide(monnaie_cellule) and not erreurs:
        monnaie = ctx.par_monnaie.get(_cle(_texte(monnaie_cellule)))
        if monnaie is None:
            erreurs.append(f"monnaie « {_texte(monnaie_cellule)} » inconnue")
        elif existe and monnaie.id != titre.monnaie_id:
            if crud.titre_est_utilise(ctx.db, titre.id):
                erreurs.append(
                    "ce titre a des mouvements : sa monnaie de cotation ne peut plus changer"
                )
            else:
                plan["monnaie_id"] = monnaie.id
                changements.append(
                    {"champ": "monnaie", "avant": titre.monnaie.nom, "apres": monnaie.nom}
                )
        elif not existe:
            plan["monnaie_id"] = monnaie.id
    if not existe and "monnaie_id" not in plan and ctx.monnaies and not erreurs:
        # La monnaie principale de l'application : celle que le fichier ne dit pas.
        plan["monnaie_id"] = ctx.monnaies[0].id
        avertissements.append(f"monnaie absente : « {ctx.monnaies[0].nom} » par défaut")

    # ---- L'enveloppe ----
    enveloppe = brute.get("enveloppe_brut")
    if not _vide(enveloppe) and not erreurs:
        nom_env = _texte(enveloppe)
        etiquette = ctx.etiquette(AxeTitre.enveloppe.value, nom_env)
        actuel = titre.type_titre.nom if existe and titre.type_titre else None
        if etiquette is None:
            a_creer.append({"axe": AxeTitre.enveloppe.value, "nom": nom_env})
        if _cle(actuel) != _cle(etiquette.nom if etiquette else nom_env) or not existe:
            changements.append({"champ": "enveloppe", "avant": actuel, "apres": etiquette.nom if etiquette else nom_env})
        plan["enveloppe"] = {"id": etiquette.id if etiquette else None, "nom": etiquette.nom if etiquette else nom_env}

    # ---- Les trois répartitions ----
    # L'enveloppe que le titre AURA après la ligne : celle du fichier, sinon la sienne. Une
    # action en direct tient sur une étiquette par axe, à 100 % (cf. services/exposition).
    enveloppe_finale = (
        plan["enveloppe"]["nom"] if "enveloppe" in plan
        else (titre.type_titre.nom if existe and titre.type_titre else None)
    )
    en_direct = exposition.est_action_en_direct(enveloppe_finale)
    for propriete, axe in REPARTITIONS.items():
        cellule = brute.get(f"{propriete}_brut")
        if _vide(cellule) or erreurs:
            continue
        try:
            lignes = exposition.parser_repartition(_texte(cellule))
            if en_direct:
                lignes = exposition.verrouiller_action_en_direct(lignes)
            # Les étiquettes se jugent à leur clé : « états-unis » et « États-Unis » sont la même.
            exposition.valider_repartition([(_cle(nom_e), poids) for nom_e, poids in lignes])
        except exposition.ErreurExposition as erreur:
            erreurs.append(f"{NOMS_CHAMPS[propriete].lower()} : {erreur}")
            continue
        resolues = []
        for nom_e, poids in lignes:
            etiquette = ctx.etiquette(axe, nom_e)
            if etiquette is None:
                a_creer.append({"axe": axe, "nom": nom_e})
            resolues.append((etiquette.nom if etiquette else nom_e, etiquette.id if etiquette else None, poids))
        total = sum(poids for _, _, poids in resolues)
        if total < 100 - 0.5:
            avertissements.append(
                f"{NOMS_CHAMPS[propriete].lower()} : la répartition ne couvre que {total:g} % — le reste est non renseigné"
            )
        if lignes and all(poids <= 1 for _, poids in lignes) and total <= 1.5:
            avertissements.append(
                f"{NOMS_CHAMPS[propriete].lower()} : tous les poids sont inférieurs à 1 — des fractions plutôt que des pourcentages ?"
            )
        avant = _repartition_en_base(titre, axe)
        apres = [(n, p) for n, _, p in resolues]
        # Comparées comme des DICTIONNAIRES : à poids égaux, l'ordre d'affichage ne dit rien.
        if {_cle(n): round(p, 6) for n, p in avant} != {_cle(n): round(p, 6) for n, p in apres}:
            changements.append(
                {
                    "champ": propriete,
                    "avant": _libelle_repartition(avant) or None,
                    "apres": _libelle_repartition(apres),
                }
            )
        plan["repartitions"][axe] = [(nom_r, id_r, poids) for nom_r, id_r, poids in resolues]

    # ---- Le dictionnaire d'un ETF ----
    cellule = brute.get("composition_brut")
    couverture_cellule = brute.get("couverture_pct_brut")
    couverture = None
    if not _vide(couverture_cellule) and not erreurs:
        try:
            couverture = exposition.parser_poids(couverture_cellule)
        except exposition.ErreurExposition as erreur:
            erreurs.append(f"couverture : {erreur}")
    if not _vide(cellule) and not erreurs:
        composition = None
        try:
            composition = exposition.parser_composition(_texte(cellule))
            couv_effective = couverture if couverture is not None else (titre.composition_couverture_pct if existe else None)
            avertissements += exposition.valider_composition(composition, couv_effective)
        except exposition.ErreurExposition as erreur:
            erreurs.append(f"composition : {erreur}")
        else:
            if not composition:
                # Une cellule de séparateurs seuls : rien de lisible, donc rien à poser.
                # Elle ne doit surtout pas passer pour un dictionnaire VIDE, qui le retirerait.
                composition = None
        if composition:
            if all(p <= 1 for p in composition.values()) and sum(composition.values()) <= 1.5:
                avertissements.append("composition : tous les poids sont inférieurs à 1 — des fractions plutôt que des pourcentages ?")
            plan["composition"] = composition
            avant = titre.composition if existe else None
            if (avant or {}) != composition:
                changements.append(
                    {
                        "champ": "composition",
                        "avant": f"{len(avant)} ISIN" if avant else None,
                        "apres": f"{len(composition)} ISIN, {sum(composition.values()):g} %",
                    }
                )
    # ---- Le cours (extension « Lecture de cours » seulement) ----
    cours_cellule = brute.get("cours_brut")
    if ctx.cours_lu and not _vide(cours_cellule) and not erreurs:
        cours = _lire_cours(cours_cellule)
        if cours is None or cours <= 0:
            erreurs.append(f"cours « {_texte(cours_cellule)} » illisible : un nombre positif est attendu")
        else:
            plan["cours"] = cours
            avant_v = titre.valeur if existe else None
            if avant_v is None or round(avant_v, 6) != round(cours, 6):
                changements.append(
                    {
                        "champ": "cours",
                        "avant": f"{avant_v:g}" if avant_v else None,
                        "apres": f"{cours:g}",
                    }
                )

    if couverture is not None and not erreurs:
        plan["couverture"] = couverture
        avant_c = titre.composition_couverture_pct if existe else None
        if avant_c != couverture:
            changements.append(
                {
                    "champ": "couverture_pct",
                    "avant": f"{avant_c:g} %" if avant_c is not None else None,
                    "apres": f"{couverture:g} %",
                }
            )

    if erreurs:
        statut = "erreur"
    elif not existe:
        statut = "cree"
    elif changements:
        statut = "maj"
    else:
        statut = "inchange"
    return {
        "ligne": numero,
        "code_isin": isin or None,
        "nom": plan.get("nom") or (titre.nom_affiche if existe else nom),
        "statut": statut,
        "titre_id": plan["titre_id"],
        "changements": changements,
        "etiquettes_a_creer": a_creer,
        "erreurs": erreurs,
        "avertissements": avertissements,
        "plan": plan,
    }


def _resoudre(db, preset, contenu: bytes, delimiteur: Optional[str]) -> tuple[list[dict], list[str]]:
    """Les lignes résolues du fichier, et les avertissements qui portent sur le fichier entier."""
    ctx = _Contexte(db)
    deja_vus: dict[str, int] = {}
    lignes = [_resoudre_ligne(ctx, brute, deja_vus) for brute in lire(contenu, preset, delimiteur)]

    # Les ISIN d'une composition que ni le fichier ni la base ne décrivent : l'ETF sera éclaté
    # sur des lignes dont on ne saura rien — à signaler, pas à refuser.
    connus = set(ctx.par_isin) | {l["code_isin"] for l in lignes if l["code_isin"]}
    inconnus = sorted(
        {
            isin
            for l in lignes
            if l["statut"] != "erreur"
            for isin in (l["plan"].get("composition") or {})
            if isin not in connus
        }
    )
    avertissements = []
    if inconnus:
        extrait = ", ".join(inconnus[:5]) + (" …" if len(inconnus) > 5 else "")
        avertissements.append(
            f"{len(inconnus)} ISIN de composition n'ont de fiche ni dans le fichier ni dans la base : {extrait}"
        )
    return lignes, avertissements


def _etiquettes_distinctes(lignes: list[dict]) -> list[dict]:
    vues, resultat = set(), []
    for ligne in lignes:
        if ligne["statut"] == "erreur":
            continue
        for e in ligne["etiquettes_a_creer"]:
            cle = (e["axe"], _cle(e["nom"]))
            if cle not in vues:
                vues.add(cle)
                resultat.append(e)
    return resultat


# ---------- L'aperçu ----------


def previsualiser(db, preset_id: int, contenu: bytes, delimiteur: Optional[str] = None):
    preset = crud.get_import_preset(db, preset_id)
    lignes, avertissements = _resoudre(db, preset, contenu, delimiteur)
    apercu = import_bancaire.construire_apercu_fichier(
        contenu,
        preset.colonnes,
        preset.lignes_entete,
        delimiteur,
        propriete_vers_cle=PROPRIETE_VERS_CLE,
        feuille=FEUILLE_TITRES,
    )
    return schemas_t.ApercuTitres(
        lignes=[
            schemas_t.LigneTitre(**{k: v for k, v in ligne.items() if k != "plan"})
            for ligne in lignes
        ],
        nb_a_creer=sum(1 for l in lignes if l["statut"] == "cree"),
        nb_a_modifier=sum(1 for l in lignes if l["statut"] == "maj"),
        nb_inchanges=sum(1 for l in lignes if l["statut"] == "inchange"),
        nb_erreurs=sum(1 for l in lignes if l["statut"] == "erreur"),
        etiquettes_a_creer=[schemas_t.EtiquetteACreer(**e) for e in _etiquettes_distinctes(lignes)],
        avertissements=avertissements,
        apercu_fichier=apercu,
    )


# ---------- La confirmation ----------


def _etiquette_ou_creation(db, ctx: _Contexte, axe: str, nom: str, creees: list[dict]):
    """L'étiquette de cet axe portant ce libellé (à la casse près), créée au besoin.
    Les créations sont rendues à l'appelant : l'écran les annonce."""
    existante = ctx.etiquette(axe, nom)
    if existante is not None:
        return existante
    nouvelle = crud.create_type_titre(db, nom, axe)
    ctx.etiquettes[axe][_cle(nom)] = nouvelle
    creees.append({"axe": axe, "nom": nom})
    return nouvelle


def confirmer(
    db,
    preset_id: int,
    contenu: bytes,
    delimiteur: Optional[str] = None,
    lignes_exclues: Optional[set[int]] = None,
) -> schemas_t.ResultatTitres:
    """Applique ce que l'aperçu a montré, sauf les lignes en erreur et celles que
    l'utilisateur a décochées (`lignes_exclues`, par numéro de ligne du fichier)."""
    preset = crud.get_import_preset(db, preset_id)
    lignes, _ = _resoudre(db, preset, contenu, delimiteur)
    lignes_exclues = lignes_exclues or set()
    ctx = _Contexte(db)
    creees: list[dict] = []
    source = f"Import « {preset.nom} »"
    aujourdhui = date_type.today()
    resultat = schemas_t.ResultatTitres()

    for ligne in lignes:
        if ligne["statut"] == "erreur" or ligne["ligne"] in lignes_exclues:
            resultat.ignores += 1
            continue
        if ligne["statut"] == "inchange":
            resultat.inchanges += 1
            continue
        plan = ligne["plan"]

        enveloppe_id = None
        if "enveloppe" in plan:
            enveloppe_id = _etiquette_ou_creation(
                db, ctx, AxeTitre.enveloppe.value, plan["enveloppe"]["nom"], creees
            ).id

        if plan["titre_id"] is None:
            titre = crud.create_titre(
                db, plan["nom"], plan["monnaie_id"], plan.get("cours", 0.0), plan["isin"], enveloppe_id
            )
            ctx.par_isin[plan["isin"]] = titre
            ctx.index.ajouter(titre)
            resultat.crees += 1
        else:
            titre = crud.get_titre(db, plan["titre_id"])
            crud.update_titre(
                db,
                titre,
                code_isin=plan.get("isin_a_completer"),
                monnaie_id=plan.get("monnaie_id"),
                type_titre_id=enveloppe_id,
                # Comme une saisie à la main : `cours_maj_le` date une lecture EN LIGNE,
                # que ce fichier n'est pas.
                valeur=plan.get("cours"),
            )
            resultat.mis_a_jour += 1

        for axe, lignes_repartition in plan["repartitions"].items():
            poids = [
                (_etiquette_ou_creation(db, ctx, axe, nom, creees).id, p)
                for nom, _id, p in lignes_repartition
            ]
            crud.poser_repartition(db, titre, axe, poids, source=source, date_maj=aujourdhui)
        if "composition" in plan or "couverture" in plan:
            crud.update_titre(
                db,
                titre,
                composition=plan.get("composition"),
                composition_couverture_pct=plan.get("couverture"),
            )
        db.commit()

    resultat.etiquettes_creees = [schemas_t.EtiquetteACreer(**e) for e in creees]
    return resultat
