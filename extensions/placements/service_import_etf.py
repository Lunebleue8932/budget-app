"""Importer la composition d'un ETF depuis le fichier de son émetteur.

REMPLACE L'ANCIEN « IMPORTER DES TITRES » (un fichier à colonnes configurables, préparé à la main ou
par une IA). Ici le fichier est CELUI DE L'ÉMETTEUR, tel qu'il le publie : `composition_etf` en
reconnaît l'en-tête et les colonnes, sans réglage. Ce module fait le reste, en deux gestes :

  - `lire` : ce qu'on a lu et ce qu'on propose (l'ETF visé, la couverture, les correspondances de
    secteurs et de zones). N'ÉCRIT RIEN ;
  - `confirmer` : applique les CHOIX de l'utilisateur (l'ETF, combien de lignes, les correspondances).

Le fichier est relu en entier aux deux gestes : la confirmation applique ce qu'il dit aujourd'hui,
pas une copie de ce qu'on a vu. Les deux gestes passent par `_preparer`, pour ne jamais diverger.

CE QUE L'IMPORT ÉCRIT.
  - L'ETF : sa composition `{clé: poids %}` (REMPLACÉE d'un bloc, c'est un instantané), sa couverture
    (la somme des poids retenus), et ses répartitions de secteur / zone : celles de la feuille de
    répartition du fichier, à défaut déduites des secteurs et pays de ses possessions
    (`_repartition_des_possessions`). Un fichier sans secteur ni pays (BNP) ne pose rien ;
  - un titre par composant retenu : créé s'il est inconnu, retrouvé sinon (par son ISIN, à défaut
    par son nom — cf. services/identite_titre). Tous reçoivent « Part d'un ETF ? » ;
  - sur un composant, secteur / zone / classe ne sont posés QUE s'il n'en a pas déjà : le fichier
    complète, il n'écrase jamais ce que l'utilisateur a saisi.

QUI REÇOIT LA COMPOSITION. Le fonds du fichier (`etf`), et en plus les ETF qu'on DÉTIENT (`cibles`) :
un ETF à réplication synthétique ne publie pas la composition de l'indice qu'il suit, on importe alors
celle d'un fonds qui le suit physiquement et on la pose aussi sur l'ETF détenu. Chaque récepteur
(le fonds du fichier compris, s'il existait déjà) a ses PROPRIÉTÉS CHOISIES — composition, secteur,
zone — : ce qui n'est pas coché reste tel quel (cf. services/calque_fonds, qui dit comment on recopie).
`lire` montre ce que chaque récepteur porte déjà, pour que l'utilisateur sache ce qui sera écrasé.

LES COMPOSANTS SANS ISIN (iShares) sont cités dans la composition par `titre:<id>`
(cf. services/exposition.cle_composant). Deux titres du même nom et sans ISIN ne se départagent
pas : la ligne est écartée et signalée.
"""
from datetime import date as date_type
from typing import Optional

import composition_etf as lecture
import correspondances_etf as corr
from app import crud, models
from app.constants import COUVERTURE_COMPOSITION_DEFAUT, AxeTitre
from app.services import calque_fonds, exposition, identite_titre, placements

CODES_MONNAIE = {
    "EUR": ("€", "euro"),
    "USD": ("$", "dollar", "dollar americain"),
    "GBP": ("£", "livre", "livre sterling"),
    "JPY": ("¥", "yen"),
    "CHF": ("chf", "franc suisse"),
    "CAD": ("dollar canadien",),
    "AUD": ("dollar australien",),
    "CNY": ("yuan",),
    "HKD": ("dollar de hong kong",),
    "SEK": ("couronne suedoise",),
    "NOK": ("couronne norvegienne",),
    "DKK": ("couronne danoise",),
}

# Les propriétés que l'import sait poser sur un fonds : sa composition (avec sa couverture) et ses
# répartitions par secteur et par zone. La classe d'actif ne vient pas du fichier d'un fonds.
PROPRIETES_IMPORT = (calque_fonds.COMPOSITION, AxeTitre.secteur.value, AxeTitre.zone.value)

# Combien de composants l'écran énumère dans l'aperçu : au-delà, il compte seulement.
LIGNES_APERCU = 300


class _Contexte:
    """Ce que la base connaît, lu une fois : les titres (archivés compris), les étiquettes de chaque
    axe, les monnaies."""

    def __init__(self, db):
        self.db = db
        self.titres = crud.get_titres(db, inclure_archivees=True)
        self.index = identite_titre.IndexTitres(self.titres)
        self.etiquettes = {
            axe.value: {corr.cle(e.nom): e for e in crud.get_types_titre(db, axe.value)} for axe in AxeTitre
        }
        self.monnaies = crud.get_monnaies(db)
        self.par_monnaie = {}
        for monnaie in self.monnaies:
            self.par_monnaie[corr.cle(monnaie.nom)] = monnaie
            if monnaie.symbole:
                self.par_monnaie.setdefault(corr.cle(monnaie.symbole), monnaie)
        for code, noms in CODES_MONNAIE.items():
            connue = next((self.par_monnaie[corr.cle(n)] for n in noms if corr.cle(n) in self.par_monnaie), None)
            if connue is not None:
                self.par_monnaie.setdefault(corr.cle(code), connue)

    def noms(self, axe: str) -> list[str]:
        return [e.nom for e in self.etiquettes[axe].values()]

    def etiquette(self, axe: str, nom: str):
        return self.etiquettes[axe].get(corr.cle(nom))

    def etiquette_ou_creation(self, axe: str, nom: str, creees: list[dict]):
        existante = self.etiquette(axe, nom)
        if existante is not None:
            return existante
        nouvelle = crud.create_type_titre(self.db, nom, axe)
        self.etiquettes[axe][corr.cle(nom)] = nouvelle
        creees.append({"axe": axe, "nom": nom})
        return nouvelle

    def monnaie(self, devise) -> Optional[models.Monnaie]:
        return self.par_monnaie.get(corr.cle(devise)) if devise else None

    def enveloppe_etf(self) -> Optional[models.TypeTitre]:
        return next((e for c, e in self.etiquettes[AxeTitre.enveloppe.value].items() if c.startswith("etf")), None)

    def enveloppe_action(self) -> Optional[models.TypeTitre]:
        return next(
            (e for e in self.etiquettes[AxeTitre.enveloppe.value].values() if exposition.est_action_en_direct(e.nom)),
            None,
        )


# ---------- Ce que le fichier dit, rapproché de la base ----------


def _proposer_correspondances(ctx: _Contexte, fichier, axe_secteur: bool):
    """Les libellés du fichier sur un axe (secteur ou zone), du plus lourd au plus léger : ce que
    le fichier écrit, ce qu'on propose, comment, et si la base le connaît déjà."""
    poids: dict[str, float] = {}
    nombre: dict[str, int] = {}
    for p in fichier.possessions:
        brut = p.secteur_brut if axe_secteur else p.pays_brut
        if brut:
            poids[brut] = poids.get(brut, 0.0) + p.poids
            nombre[brut] = nombre.get(brut, 0) + 1
    for brut, p in (fichier.secteurs if axe_secteur else fichier.zones):
        poids.setdefault(brut, 0.0)
        nombre.setdefault(brut, 0)
    axe = AxeTitre.secteur.value if axe_secteur else AxeTitre.zone.value
    existants = ctx.noms(axe)
    lignes = []
    for brut, p in sorted(poids.items(), key=lambda kv: -kv[1]):
        propose, methode = (
            corr.secteur_propose(brut, existants) if axe_secteur else corr.zone_proposee(brut, existants)
        )
        lignes.append(
            {
                "brut": brut,
                "poids_pct": round(p, 4),
                "nb": nombre[brut],
                "propose": propose,
                "methode": methode,
                "a_creer": bool(propose) and ctx.etiquette(axe, propose) is None,
            }
        )
    return lignes


def _est_etf(titre) -> bool:
    return bool(titre.type_titre and titre.type_titre.nom.lower().startswith("etf"))


def _statut_composant(ctx: _Contexte, p: lecture.Possession):
    titre, erreur = ctx.index.identifier(p.nom, p.isin)
    if erreur:
        return "ambigu", None
    return ("existant", titre) if titre is not None else ("nouveau", None)


def lire(db, contenu: bytes, delimiteur: Optional[str] = None) -> dict:
    """Le fichier lu, et ce qu'on propose d'en faire. N'écrit rien."""
    fichier = lecture.lire(contenu, delimiteur)
    ctx = _Contexte(db)
    poids = [p.poids for p in fichier.possessions]
    cumul = lecture.cumul(poids)

    # L'ETF visé : par son ISIN, sinon par son nom exact. Le courtier peut l'avoir nommé autrement :
    # l'utilisateur choisit alors dans la liste.
    etf, _ = ctx.index.identifier(fichier.fonds_nom, fichier.fonds_isin) if (fichier.fonds_nom or fichier.fonds_isin) else (None, None)
    candidats = [
        {"id": t.id, "nom": t.nom_affiche, "isin": t.code_isin, "est_indice": bool(t.est_indice),
         "donnees": calque_fonds.resume(t)}
        for t in ctx.titres
        if t.composition or t.est_indice or _est_etf(t) or (etf and t.id == etf.id)
    ]
    # LES FONDS QUE L'IMPORT PEUT BRANCHER en plus du fonds du fichier (cf. docstring) : ceux qu'on
    # DÉTIENT d'abord (c'est le cas d'usage), puis les autres. Un indice n'en est pas : on y importe.
    detenus = placements.titres_detenus(db)
    branchables = sorted(
        (
            {"id": t.id, "nom": t.nom_affiche, "isin": t.code_isin, "detenu": t.id in detenus,
             "donnees": calque_fonds.resume(t)}
            for t in ctx.titres
            if not t.est_indice and (t.composition or _est_etf(t))
        ),
        key=lambda b: (not b["detenu"], b["nom"].lower()),
    )

    composants = []
    for p in fichier.possessions[:LIGNES_APERCU]:
        statut, titre = _statut_composant(ctx, p)
        composants.append(
            {
                "ligne": p.ligne, "nom": p.nom, "isin": p.isin, "ticker": p.ticker, "poids_pct": round(p.poids, 4),
                "classe": p.classe, "secteur_brut": p.secteur_brut, "pays_brut": p.pays_brut,
                "statut": statut, "titre_id": titre.id if titre else None,
            }
        )
    statuts = [_statut_composant(ctx, p)[0] for p in fichier.possessions]
    return {
        "fonds": {"nom": fichier.fonds_nom, "isin": fichier.fonds_isin, "devise": fichier.fonds_devise},
        "feuilles": [
            {
                "nom": f.nom, "type": f.type, "ligne_entete": f.ligne_entete, "colonnes": f.colonnes,
                "nb_lignes": f.nb_lignes, "unite": f.unite, "somme_pct": f.somme_pct, "apercu": f.apercu,
            }
            for f in fichier.feuilles
        ],
        "etf": {"titre_id": etf.id if etf else None, "candidats": candidats, "branchables": branchables},
        # Les enveloppes qu'on peut poser sur un fonds créé à l'import (l'indice, lui, n'en a pas).
        "enveloppes": [{"id": e.id, "nom": e.nom} for e in crud.get_types_titre(db, AxeTitre.enveloppe.value)],
        # Ce que ce fichier peut apporter à un fonds : la composition toujours, un secteur / une zone
        # seulement s'il en dit (feuille de répartition, ou colonne sur les possessions).
        "apport": {
            "composition": True,
            "secteur": bool(fichier.secteurs) or any(p.secteur_brut for p in fichier.possessions),
            "zone": bool(fichier.zones) or any(p.pays_brut for p in fichier.possessions),
        },
        "nb_possessions": len(fichier.possessions),
        "somme_pct": round(sum(poids), 4),
        "ecartees": [
            {"ligne": n, "nom": nom, "type": type_, "poids_pct": pct} for n, nom, type_, pct in fichier.ecartees
        ],
        "couverture": {
            "cumul": cumul,
            "defaut_pct": COUVERTURE_COMPOSITION_DEFAUT,
            "defaut_lignes": lecture.lignes_pour_couverture(poids, COUVERTURE_COMPOSITION_DEFAUT),
        },
        "composants": composants,
        "statuts": statuts,
        "secteurs": _proposer_correspondances(ctx, fichier, True),
        "zones": _proposer_correspondances(ctx, fichier, False),
        "a_une_repartition_secteurs": bool(fichier.secteurs),
        "a_une_repartition_zones": bool(fichier.zones),
        "secteurs_existants": ctx.noms(AxeTitre.secteur.value),
        "zones_existantes": ctx.noms(AxeTitre.zone.value),
        "avertissements": fichier.avertissements,
    }


# ---------- La confirmation ----------


def _nom_choisi(choix: dict, brut: Optional[str], proposer):
    """Le nom d'étiquette que l'utilisateur a confirmé pour ce libellé du fichier. Une clé absente
    retombe sur la proposition ; une valeur vide veut dire « ne rien poser »."""
    if not brut:
        return None
    if brut in choix:
        return (choix[brut] or "").strip() or None
    return proposer(brut)[0]


def _repartition_des_possessions(fichier, secteur: bool) -> list[tuple[str, float]]:
    """SANS FEUILLE DE RÉPARTITION, celle de l'ETF se déduit de ses actions : le poids de chaque secteur
    (ou pays) du fichier, additionné sur TOUTES les possessions lues — pas seulement les lignes retenues
    à l'import, le fichier dit tout. Une action sans secteur (ou sans pays) reste « non renseignée » :
    rien n'est renormalisé."""
    cumul: dict[str, float] = {}
    for p in fichier.possessions:
        brut = p.secteur_brut if secteur else p.pays_brut
        if brut:
            cumul[brut] = cumul.get(brut, 0.0) + p.poids
    return list(cumul.items())


def _repartition_etf(ctx, paires, choix, axe, proposer, avertissements, creees) -> Optional[list[tuple[int, float]]]:
    """La répartition de l'ETF lue dans sa feuille de répartition, libellés confirmés, doublons additionnés."""
    cumul: dict[str, float] = {}
    for brut, poids in paires:
        nom = _nom_choisi(choix, brut, proposer)
        if nom:
            cumul[nom] = cumul.get(nom, 0.0) + poids
    if not cumul:
        return None
    lignes = [(nom, round(p, 6)) for nom, p in cumul.items()]
    try:
        exposition.valider_repartition([(corr.cle(n), p) for n, p in lignes])
    except exposition.ErreurExposition as erreur:
        avertissements.append(f"répartition {axe} de l'ETF non posée : {erreur}")
        return None
    return [(ctx.etiquette_ou_creation(axe, nom, creees).id, p) for nom, p in lignes]


def _proprietes_choisies(brutes) -> tuple[str, ...]:
    """Les propriétés qu'un récepteur prend. Absent = toutes (l'ancien comportement : l'import
    remplaçait tout) ; une liste, même vide, est prise telle quelle."""
    if brutes is None:
        return PROPRIETES_IMPORT
    inconnues = [p for p in brutes if p not in PROPRIETES_IMPORT]
    if inconnues:
        raise ValueError(f"propriété inconnue : {', '.join(inconnues)}")
    return tuple(p for p in PROPRIETES_IMPORT if p in brutes)


def _cibles_branchees(db, choix: dict, etf) -> list[tuple[models.TitrePossede, tuple[str, ...]]]:
    """Les ETF branchés en plus du fonds du fichier : `choix["cibles"] = [{titre_id, proprietes}]`.
    Un indice ne reçoit rien par ce chemin, le fonds du fichier n'est pas branché sur lui-même, et
    un même ETF n'est branché qu'une fois."""
    branches = []
    vus = {etf.id}
    for demande in choix.get("cibles") or []:
        titre = crud.get_titre(db, int(demande.get("titre_id") or 0))
        if titre is None:
            raise ValueError("un ETF à brancher n'existe plus")
        if titre.id in vus:
            continue
        if titre.est_indice:
            raise ValueError(f"« {titre.nom_affiche} » est un indice : on y importe, on ne l'y branche pas")
        vus.add(titre.id)
        branches.append((titre, _proprietes_choisies(demande.get("proprietes"))))
    return branches


def _poser_sur(titre, proprietes, composition, couverture, repartitions, source, date_maj, db) -> None:
    """Ce que l'import a lu, posé sur un récepteur, pour les seules propriétés qu'il prend."""
    if calque_fonds.COMPOSITION in proprietes:
        calque_fonds.poser_composition(titre, composition, couverture)
    for axe in (AxeTitre.secteur.value, AxeTitre.zone.value):
        lignes = repartitions.get(axe)
        if axe in proprietes and lignes:
            crud.poser_repartition(db, titre, axe, lignes, source=source, date_maj=date_maj)


def confirmer(db, contenu: bytes, delimiteur: Optional[str], choix: dict) -> dict:
    """Applique les choix : `etf` ({titre_id | nom, isin, proprietes}), `cibles` ([{titre_id,
    proprietes}], les fonds branchés en plus), `nb_lignes`, `secteurs` et `zones` (libellé du fichier ->
    étiquette confirmée, ou vide). `proprietes` : ce que le récepteur prend (composition, secteur, zone) ;
    absent = tout."""
    fichier = lecture.lire(contenu, delimiteur)
    ctx = _Contexte(db)
    creees: list[dict] = []
    avertissements: list[str] = []
    source = f"Import de composition ({fichier.fonds_nom or 'fichier'})"
    aujourdhui = date_type.today()

    n = int(choix.get("nb_lignes") or 0)
    if not (1 <= n <= len(fichier.possessions)):
        n = min(max(n, 1), len(fichier.possessions))
    retenues = fichier.possessions[:n]
    secteurs = choix.get("secteurs") or {}
    zones = choix.get("zones") or {}
    defaut = ctx.monnaies[0] if ctx.monnaies else None
    if defaut is None:
        raise ValueError("aucune monnaie dans l'application : en créer une avant d'importer")

    # ---- L'ETF ----
    visee = choix.get("etf") or {}
    proprietes_etf = _proprietes_choisies(visee.get("proprietes"))
    etf = crud.get_titre(db, int(visee["titre_id"])) if visee.get("titre_id") else None
    if visee.get("titre_id") and etf is None:
        raise ValueError("l'ETF choisi n'existe plus")
    cree_etf = False
    if etf is None:
        nom = (visee.get("nom") or fichier.fonds_nom or "").strip()
        isin = exposition.normaliser_isin(visee.get("isin") or fichier.fonds_isin)
        if not nom:
            raise ValueError("le nom de l'ETF manque")
        if isin and not exposition.isin_valide(isin):
            raise ValueError(f"« {isin} » n'est pas un ISIN valide")
        existant, erreur = ctx.index.identifier(nom, isin)
        if erreur:
            raise ValueError(erreur)
        if existant is not None:
            etf = existant
        else:
            conflit = identite_titre.conflit_identite(db, nom, isin)
            if conflit:
                raise ValueError(conflit)
            monnaie = ctx.monnaie(fichier.fonds_devise) or defaut
            # LE TYPE SE CHOISIT À L'IMPORT : un indice (sans enveloppe : il ne se détient pas), une
            # enveloppe de la base, ou à défaut « ETF ».
            est_indice = bool(visee.get("indice"))
            if est_indice:
                enveloppe_id = None
            elif visee.get("type_titre_id"):
                choisie = crud.get_type_titre(db, int(visee["type_titre_id"]))
                if choisie is None or choisie.axe != AxeTitre.enveloppe.value:
                    raise ValueError("le type choisi n'existe plus")
                enveloppe_id = choisie.id
            else:
                enveloppe_id = (
                    ctx.enveloppe_etf() or ctx.etiquette_ou_creation(AxeTitre.enveloppe.value, "ETF", creees)
                ).id
            etf = models.TitrePossede(
                nom=nom, valeur=0.0, monnaie_id=monnaie.id, code_isin=isin or None,
                type_titre_id=enveloppe_id, est_indice=est_indice,
            )
            db.add(etf)
            db.flush()
            ctx.index.ajouter(etf)
            cree_etf = True

    # ---- Les composants ----
    composition: dict[str, float] = {}
    crees = retrouves = ecartes = 0
    for p in retenues:
        titre, erreur = ctx.index.identifier(p.nom, p.isin)
        if erreur:
            ecartes += 1
            avertissements.append(f"« {p.nom} » écarté : {erreur}")
            continue
        nom_secteur = _nom_choisi(secteurs, p.secteur_brut, lambda b: corr.secteur_propose(b, ctx.noms(AxeTitre.secteur.value)))
        nom_zone = _nom_choisi(zones, p.pays_brut, lambda b: corr.zone_proposee(b, ctx.noms(AxeTitre.zone.value)))
        if titre is None:
            monnaie = ctx.monnaie(p.devise) or defaut
            action = p.classe in (None, "Actions")
            enveloppe = (ctx.enveloppe_action() or ctx.etiquette_ou_creation(AxeTitre.enveloppe.value, "Action en direct", creees)) if action else None
            titre = models.TitrePossede(
                nom=p.nom, valeur=0.0, monnaie_id=monnaie.id, code_isin=p.isin,
                type_titre_id=enveloppe.id if enveloppe else None,
            )
            db.add(titre)
            db.flush()
            ctx.index.ajouter(titre)
            crees += 1
        else:
            retrouves += 1
            if p.isin and not titre.code_isin and p.isin not in ctx.index.par_isin:
                titre.code_isin = p.isin
                ctx.index.ajouter(titre)
        if titre.id == etf.id:
            continue
        titre.part_etf = True
        for axe, nom in (
            (AxeTitre.classe.value, p.classe),
            (AxeTitre.secteur.value, nom_secteur),
            (AxeTitre.zone.value, nom_zone),
        ):
            if nom and not titre.repartition(axe):
                etiquette = ctx.etiquette_ou_creation(axe, nom, creees)
                crud.poser_repartition(db, titre, axe, [(etiquette.id, 100.0)], source=source, date_maj=aujourdhui)
        cle = exposition.cle_composant(titre)
        composition[cle] = round(composition.get(cle, 0.0) + p.poids, 6)

    # ---- Les récepteurs : l'ETF du fichier, puis les ETF qu'on y a branchés ----
    couverture = round(sum(composition.values()), 4)
    repartitions: dict[str, Optional[list[tuple[int, float]]]] = {}
    for axe, paires, correspondances, proposer in (
        (AxeTitre.secteur.value, fichier.secteurs or _repartition_des_possessions(fichier, True), secteurs,
         lambda b: corr.secteur_propose(b, ctx.noms(AxeTitre.secteur.value))),
        (AxeTitre.zone.value, fichier.zones or _repartition_des_possessions(fichier, False), zones,
         lambda b: corr.zone_proposee(b, ctx.noms(AxeTitre.zone.value))),
    ):
        repartitions[axe] = (
            _repartition_etf(ctx, paires, correspondances, axe, proposer, avertissements, creees) if paires else None
        )
    recepteurs = [(etf, proprietes_etf)] + _cibles_branchees(db, choix, etf)
    for titre, proprietes in recepteurs:
        _poser_sur(titre, proprietes, composition, couverture, repartitions, source, aujourdhui, db)
    # UN INDICE MIS À JOUR : les ETF calqués dessus reprennent ce qu'ils lui prennent, sans qu'on ait
    # à refaire la liaison (migration 0094).
    etf_suivis = calque_fonds.propager(db, etf) if etf.est_indice else []
    avertissements += exposition.valider_composition(composition, couverture) if composition else []
    db.commit()
    return {
        "etf_id": etf.id,
        "etf_nom": etf.nom_affiche,
        "etf_cree": cree_etf,
        "etf_est_indice": bool(etf.est_indice),
        "etf_suivis": etf_suivis,
        "titres_crees": crees,
        "titres_retrouves": retrouves,
        "ecartes": ecartes,
        "nb_composants": len(composition),
        "couverture_pct": couverture,
        "etiquettes_creees": creees,
        "branches": [
            {"titre_id": t.id, "nom": t.nom_affiche, "proprietes": list(p)} for t, p in recepteurs[1:]
        ],
        "avertissements": avertissements,
    }
