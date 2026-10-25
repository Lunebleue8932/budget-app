"""Lire la composition d'un ETF dans le fichier qu'en publie l'émetteur — sans IA, sans modèle.

Les émetteurs (Amundi, BNP, iShares, SPDR…) publient tous la même chose sous des habits
différents : une feuille de POSSESSIONS (une ligne par titre : nom, poids, parfois ISIN, secteur,
classe d'actif, pays) et, parfois, des feuilles de RÉPARTITION (un secteur ou une zone, un poids).
Le travail est donc de TROUVER l'en-tête (il n'est jamais en première ligne : un bandeau, un nom
de fonds, des tickers le précèdent) et de comprendre ce que dit chaque colonne par son titre.

CE QUI EST DÉTERMINISTE. Un titre de colonne se reconnaît à une liste de synonymes (FR et EN, sans
casse ni accents) ; une feuille est une feuille de possessions si son en-tête a un nom (ou un ISIN)
ET un poids ; une feuille de répartition si elle a un libellé de secteur ou de zone ET un poids, sans
nom de titre. Rien n'est deviné d'autre : une feuille qui ne ressemble à rien est signalée « non
reconnue » (l'aperçu la montre), jamais lue de travers.

LES POIDS. Certains fichiers écrivent des pourcentages (15,97), d'autres des fractions (0,1597).
Une feuille dont tous les poids somment moins de 1,5 est lue comme des fractions (un fichier en
pourcentages qui ne couvrirait pas même 1,5 % de l'ETF n'existe pas). RIEN N'EST RENORMALISÉ : la
somme dit ce que le fichier couvre.

LES LIGNES QUI NE SONT PAS DES TITRES (liquidités, change, contrats à terme, « Unassigned ») sont
écartées et comptées — on ne peut pas les détenir, ni leur donner un secteur.
"""
import re
from dataclasses import dataclass, field
from typing import Optional

import correspondances_etf as corr
import lecture_classeur

# Rôle -> titres de colonne reconnus (comparés par `corr.cle`). L'ORDRE DE LA LISTE est une
# priorité : « Asset Class » l'emporte sur « Type » chez iShares, qui a les deux.
SYNONYMES = {
    "isin": ["code isin", "isin", "isin code"],
    "nom": [
        "nom de l entite", "nom du titre", "nom de la valeur", "security name", "nom", "name", "holding",
        "libelle", "description", "titre", "valeur", "issuer",
    ],
    "ticker": ["ticker", "symbole", "symbol", "code mnemonique", "bloomberg ticker"],
    "poids": [
        "poids", "poids %", "weight %", "weight", "percent of fund", "% of net assets", "% net assets",
        "% de l actif net", "% actif net", "% of fund", "% of nav", "allocation", "pourcentage", "percent",
        "% poids", "pondération", "ponderation",
    ],
    "classe": ["classe d actifs", "classe d actif", "asset class", "type d actif", "type de titre", "type", "categorie"],
    "secteur": [
        "secteur", "sector", "sector classification", "secteur gics", "gics sector", "industry sector",
    ],
    "pays": [
        "pays", "location", "trade country name", "country", "pays de risque", "country of risk",
        "pays de cotation", "localisation", "domicile", "zone geographique", "region",
    ],
    "devise": ["devise", "currency", "monnaie", "devise de cotation", "base currency"],
}

_RANG = {role: {corr.cle(s): i for i, s in enumerate(syn)} for role, syn in SYNONYMES.items()}

# Un titre de colonne ressemble à un poids même précédé d'une unité : « Weight (%) », « Poids (%) ».
_SEUIL_FRACTIONS = 1.5
_MAX_LIGNES_ENTETE = 80
_MOTIF_ISIN = re.compile(r"^[A-Z]{2}[A-Z0-9]{9}[0-9]$")


@dataclass
class Possession:
    ligne: int  # numéro de ligne dans le fichier, comme Excel l'affiche
    nom: str
    poids: float  # en %
    isin: Optional[str] = None
    ticker: Optional[str] = None
    classe: Optional[str] = None  # « Actions », « Obligations » ou None
    classe_brute: Optional[str] = None
    secteur_brut: Optional[str] = None
    pays_brut: Optional[str] = None
    devise: Optional[str] = None


@dataclass
class FeuilleLue:
    nom: str
    type: str  # « possessions », « secteurs », « zones » ou « non reconnue »
    ligne_entete: Optional[int] = None
    colonnes: dict = field(default_factory=dict)  # rôle -> libellé de la colonne dans le fichier
    nb_lignes: int = 0
    # De quoi montrer ce que l'app a lu : les 12 premières lignes utiles, brutes.
    apercu: list = field(default_factory=list)
    unite: str = "%"  # « % » ou « fraction » (convertie en %)
    somme_pct: float = 0.0


@dataclass
class FichierComposition:
    fonds_nom: Optional[str] = None
    fonds_isin: Optional[str] = None
    fonds_devise: Optional[str] = None
    feuilles: list = field(default_factory=list)
    possessions: list = field(default_factory=list)  # triées par poids décroissant
    ecartees: list = field(default_factory=list)  # [(ligne, nom, classe_brute, poids)] : liquidités, change…
    secteurs: list = field(default_factory=list)  # [(libellé, poids %)] de la feuille de répartition
    zones: list = field(default_factory=list)
    avertissements: list = field(default_factory=list)


def _nombre(valeur) -> Optional[float]:
    if isinstance(valeur, bool):
        return None
    if isinstance(valeur, (int, float)):
        return float(valeur)
    texte = str(valeur or "").strip().replace(" ", "").replace(" ", "").replace("%", "")
    if not texte or texte in ("-", "--", "—"):
        return None
    texte = texte.replace(",", ".") if texte.count(",") == 1 and "." not in texte else texte.replace(",", "")
    try:
        return float(texte)
    except ValueError:
        return None


def _texte(valeur) -> Optional[str]:
    if valeur is None:
        return None
    if isinstance(valeur, float) and valeur == int(valeur):
        valeur = int(valeur)
    texte = str(valeur).strip()
    return texte or None


def _roles_de(ligne) -> dict[str, int]:
    """Rôle -> indice de colonne pour une ligne candidate à être l'en-tête. Pour chaque rôle, la
    colonne dont le titre a le meilleur rang de synonyme."""
    trouves: dict[str, tuple[int, int]] = {}
    for i, cellule in enumerate(ligne):
        if not isinstance(cellule, str):
            continue
        c = corr.cle(cellule)
        if not c:
            continue
        for role, rangs in _RANG.items():
            if c in rangs:
                rang = rangs[c]
            elif role == "poids" and ("weight" in c.split() or "poids" in c.split()) and len(c.split()) <= 4:
                rang = 99
            else:
                continue
            if role not in trouves or rang < trouves[role][0]:
                trouves[role] = (rang, i)
    return {role: i for role, (_, i) in trouves.items()}


def _type_de_feuille(roles: dict[str, int]) -> Optional[str]:
    if "poids" not in roles:
        return None
    if "nom" in roles or "isin" in roles:
        return "possessions"
    if "secteur" in roles and "pays" not in roles:
        return "secteurs"
    if "pays" in roles and "secteur" not in roles:
        return "zones"
    return None


def _chercher_entete(lignes) -> tuple[Optional[int], dict, Optional[str]]:
    """(indice de ligne, rôles, type) de la première ligne qui est un en-tête valable. On préfère
    la ligne la plus riche parmi les premières candidates : un bandeau « Nom du fonds / Code ISIN »
    ressemble à un en-tête (nom + isin) mais n'a pas de poids."""
    for i, ligne in enumerate(lignes[:_MAX_LIGNES_ENTETE]):
        roles = _roles_de(ligne)
        type_ = _type_de_feuille(roles)
        if type_:
            return i, roles, type_
    return None, {}, None


def _metadonnees(lignes, fichier: FichierComposition) -> None:
    """Le nom du fonds, son ISIN et sa devise, lus AVANT l'en-tête : « Nom du fonds : X »,
    « Code ISIN : Y » (en deux cellules voisines) ou, chez BNP, un petit tableau en-tête/valeur."""
    etiquettes_nom = ("nom du fonds", "fund name", "nom de l etf", "fonds")
    etiquettes_isin = ("code isin", "isin")
    etiquettes_devise = ("devise de reference", "base currency", "fund currency", "devise du fonds")
    for i, ligne in enumerate(lignes):
        cellules = [(j, c) for j, c in enumerate(ligne) if c is not None]
        for j, c in cellules:
            if not isinstance(c, str):
                continue
            k = corr.cle(c).rstrip(" :")
            suivante = next((v for jj, v in cellules if jj > j and isinstance(v, str)), None)
            # Sur une ligne qui porte AUSSI « Code ISIN » c'est un tableau en-tête / valeur (BNP) :
            # la cellule voisine est un autre titre de colonne, la valeur est une ligne plus bas.
            en_tableau = "code isin" in [corr.cle(x) for x in ligne if isinstance(x, str)]
            if k in etiquettes_nom and suivante and not fichier.fonds_nom and not en_tableau:
                fichier.fonds_nom = suivante.strip()
            elif k in etiquettes_isin and suivante and not fichier.fonds_isin and _MOTIF_ISIN.match(suivante.strip().upper()):
                fichier.fonds_isin = suivante.strip().upper()
            elif k in etiquettes_devise and suivante and not fichier.fonds_devise:
                fichier.fonds_devise = suivante.strip()[:3].upper()
        # Petit tableau en-tête / valeur : « Nom du fonds … Code ISIN … » puis la ligne suivante.
        textes = [corr.cle(c) if isinstance(c, str) else "" for c in ligne]
        if "nom du fonds" in textes and "code isin" in textes and i + 1 < len(lignes):
            suivante = lignes[i + 1]
            nom_j, isin_j = textes.index("nom du fonds"), textes.index("code isin")
            if not fichier.fonds_nom and isinstance(suivante[nom_j] if nom_j < len(suivante) else None, str):
                fichier.fonds_nom = suivante[nom_j].strip()
            valeur = suivante[isin_j] if isin_j < len(suivante) else None
            if not fichier.fonds_isin and isinstance(valeur, str) and _MOTIF_ISIN.match(valeur.strip().upper()):
                fichier.fonds_isin = valeur.strip().upper()
        if i > _MAX_LIGNES_ENTETE:
            break
    # iShares : le nom du fonds est seul dans la 2e ligne ; à défaut, la première ligne qui n'est ni
    # une date ni une étiquette suivie d'une valeur.
    if not fichier.fonds_nom:
        for ligne in lignes[:6]:
            cellules = [c for c in ligne if c is not None]
            if len(cellules) == 1 and isinstance(cellules[0], str) and len(cellules[0]) > 8 and not re.match(r"^[\d/.-]+$", cellules[0]):
                fichier.fonds_nom = cellules[0].strip()
                break


def _lire_possessions(feuille, i_entete: int, roles: dict, fichier: FichierComposition) -> FeuilleLue:
    lignes = feuille.lignes
    bruts = []
    vides = 0
    for n in range(i_entete + 1, len(lignes)):
        ligne = lignes[n]
        if not any(c is not None for c in ligne):
            vides += 1
            # Deux lignes vides d'affilée après des données : fin du tableau (suivent mentions
            # légales, totaux, avertissements).
            if bruts and vides >= 2:
                break
            continue
        vides = 0

        def cell(role):
            j = roles.get(role)
            return ligne[j] if j is not None and j < len(ligne) else None

        poids = _nombre(cell("poids"))
        nom = _texte(cell("nom"))
        isin = _texte(cell("isin"))
        isin = isin.upper().replace(" ", "") if isin else None
        if isin and not _MOTIF_ISIN.match(isin):
            isin = None  # « Unassigned », « - » : pas un ISIN
        # Ligne de total ou de note : un poids sans nom, ou un nom « TOTAL ».
        if nom is not None and corr.cle(nom) in ("total", "totaux", "grand total"):
            continue
        if nom is None and isin is None:
            continue
        bruts.append(
            (n + 1, nom or isin, poids, isin, _texte(cell("ticker")), _texte(cell("classe")),
             _texte(cell("secteur")), _texte(cell("pays")), _texte(cell("devise")))
        )
    somme = sum(p for _, _, p, *_ in bruts if p is not None and p > 0)
    fractions = 0 < somme <= _SEUIL_FRACTIONS
    facteur = 100.0 if fractions else 1.0
    nb_ecartees = sans_poids = 0
    for numero, nom, poids, isin, ticker, classe_brute, secteur, pays, devise in bruts:
        classe = corr_classe = None
        if classe_brute:
            corr_classe = corr.classe_normalisee(classe_brute)
        # Sans colonne de classe (SPDR), les lignes « Unassigned » (liquidités, futures) sont
        # reconnues à leur secteur ou à l'ISIN absent des ISIN.
        non_titre = corr_classe == "(hors titres)" or (
            "classe" not in roles
            and (corr.cle(secteur) == "unassigned" or (isin is None and (poids is None or poids == 0) and secteur is None))
        )
        if non_titre:
            nb_ecartees += 1
            fichier.ecartees.append((numero, nom, classe_brute or secteur, None if poids is None else poids * facteur))
            continue
        if poids is None or poids <= 0:
            sans_poids += 1
            continue
        classe = corr_classe or ("Actions" if "classe" not in roles else None)
        if secteur and corr.cle(secteur) == "unassigned":
            secteur = None
        fichier.possessions.append(
            Possession(
                ligne=numero, nom=nom, poids=poids * facteur, isin=isin, ticker=ticker, classe=classe,
                classe_brute=classe_brute, secteur_brut=secteur, pays_brut=pays, devise=devise,
            )
        )
    if sans_poids:
        fichier.avertissements.append(
            f"{sans_poids} ligne(s) sans poids, ou à 0 %, ignorée(s) (titres suspendus, par exemple)"
        )
    return FeuilleLue(
        nom=feuille.nom, type="possessions", ligne_entete=i_entete + 1,
        colonnes={role: _texte(lignes[i_entete][j]) for role, j in roles.items()},
        nb_lignes=len(bruts) - nb_ecartees - sans_poids, unite="fraction" if fractions else "%",
        somme_pct=round(somme * facteur, 4),
    )


def _lire_repartition(feuille, i_entete: int, roles: dict, role_libelle: str, type_: str, fichier) -> FeuilleLue:
    lignes = feuille.lignes
    paires = []
    for n in range(i_entete + 1, len(lignes)):
        ligne = lignes[n]
        j, k = roles[role_libelle], roles["poids"]
        libelle = _texte(ligne[j]) if j < len(ligne) else None
        poids = _nombre(ligne[k]) if k < len(ligne) else None
        if libelle is None or poids is None:
            if paires and not any(c is not None for c in ligne):
                break
            continue
        if corr.cle(libelle) in ("total", "totaux", "autres", "other", "others"):
            continue
        paires.append((libelle, poids))
    somme = sum(p for _, p in paires if p > 0)
    fractions = 0 < somme <= _SEUIL_FRACTIONS
    facteur = 100.0 if fractions else 1.0
    return FeuilleLue(
        nom=feuille.nom, type=type_, ligne_entete=i_entete + 1,
        colonnes={role: _texte(lignes[i_entete][j]) for role, j in roles.items()},
        nb_lignes=len(paires), unite="fraction" if fractions else "%", somme_pct=round(somme * facteur, 4),
    ), [(lib, p * facteur) for lib, p in paires if p > 0]


# LES FEUILLES À PLUSIEURS BLOCS (iShares, « Exposure Breakdowns ») : une seule feuille empile des
# tableaux de répartition, chacun sous un TITRE (« Sector », « Geography/Locations »), puis « as of »,
# « Type / Fund », puis des lignes « libellé ; poids [; code] ». Aucune ligne d'en-tête classique : la
# feuille ne se reconnaît pas par `_chercher_entete`, on y cherche donc les titres de blocs.
_TITRES_SECTEUR = ("sector", "secteur")
_TITRES_ZONE = ("geograph", "location", "country", "countries", "pays", "region", "zone", "localisation")


def _titre_de_bloc(ligne) -> Optional[str]:
    """« secteurs » ou « zones » si la ligne est le titre d'un bloc de répartition (un seul libellé court,
    le reste vide), sinon None."""
    if not ligne or any(c is not None for c in ligne[1:]):
        return None
    texte = _texte(ligne[0])
    if texte is None or len(texte) > 40:
        return None
    c = corr.cle(texte)
    if not c or len(c.split()) > 4:
        return None
    if any(m in c for m in _TITRES_SECTEUR):
        return "secteurs"
    if any(m in c for m in _TITRES_ZONE):
        return "zones"
    return None


def _lire_blocs_repartition(feuille, fichier) -> list:
    """Les blocs de répartition d'une feuille sans en-tête : une `FeuilleLue` par bloc, et les paires
    ajoutées à `fichier.secteurs` / `fichier.zones`. Les lignes de liquidités et de dérivés (« Cash and/or
    Derivatives ») ne sont pas une part du fonds qu'on puisse classer : elles sont écartées."""
    lignes = feuille.lignes
    lues = []
    n = 0
    while n < len(lignes):
        type_ = _titre_de_bloc(lignes[n])
        if type_ is None:
            n += 1
            continue
        debut = n
        n += 1
        paires = []
        # Les lignes « as of » et « Type / Fund » précèdent les données ; on les saute jusqu'au premier libellé + poids.
        while n < len(lignes) and len(lignes[n]) >= 2:
            libelle, poids = _texte(lignes[n][0]), _nombre(lignes[n][1])
            if libelle is None and not any(c is not None for c in lignes[n]):
                if paires:
                    break
            elif libelle is not None and poids is not None and corr.cle(libelle) not in ("type", "as of"):
                if corr.classe_normalisee(libelle) != "(hors titres)" and corr.cle(libelle) not in (
                    "total", "totaux", "autres", "other", "others",
                ):
                    paires.append((libelle, poids))
            elif paires:
                break
            n += 1
        if not paires:
            continue
        somme = sum(p for _, p in paires if p > 0)
        fractions = 0 < somme <= _SEUIL_FRACTIONS
        facteur = 100.0 if fractions else 1.0
        valides = [(lib, p * facteur) for lib, p in paires if p > 0]
        (fichier.secteurs if type_ == "secteurs" else fichier.zones).extend(valides)
        lue = FeuilleLue(
            nom=f"{feuille.nom} — {_texte(lignes[debut][0])}", type=type_, ligne_entete=debut + 1,
            colonnes={"secteur" if type_ == "secteurs" else "pays": _texte(lignes[debut][0])},
            nb_lignes=len(valides), unite="fraction" if fractions else "%", somme_pct=round(somme * facteur, 4),
        )
        lue.apercu = _apercu(feuille, debut)
        lues.append(lue)
    return lues


def _cellule_apercu(c) -> Optional[str]:
    """Une cellule montrée à l'écran : un nombre à virgule flottante garde six chiffres significatifs
    (« 0.12087710413939959 » n'apprend rien de plus que « 0.120877 »)."""
    if c is None:
        return None
    if isinstance(c, float):
        return f"{c:.6g}"
    return str(c)[:60]


def _apercu(feuille, i_entete: Optional[int]) -> list:
    """Ce que l'écran montre pour dire « voilà ce que j'ai lu » : l'en-tête (surlignée côté écran)
    et les premières lignes qui suivent, ou le haut du fichier si rien n'a été reconnu."""
    debut = max(0, (i_entete or 0) - 3)
    lignes = []
    for n in range(debut, min(len(feuille.lignes), debut + 14)):
        ligne = feuille.lignes[n]
        if any(c is not None for c in ligne):
            lignes.append({"ligne": n + 1, "cellules": [_cellule_apercu(c) for c in ligne[:10]],
                           "entete": n == i_entete})
    return lignes


def lire(contenu: bytes, delimiteur: Optional[str] = None) -> FichierComposition:
    """Toutes les feuilles du fichier, ce que chacune est, et les possessions / répartitions lues."""
    fichier = FichierComposition()
    feuilles = lecture_classeur.lire_classeur(contenu, delimiteur)
    for feuille in feuilles:
        i, roles, type_ = _chercher_entete(feuille.lignes)
        if type_ is None:
            blocs = _lire_blocs_repartition(feuille, fichier)
            if blocs:
                fichier.feuilles.extend(blocs)
                continue
            lue = FeuilleLue(nom=feuille.nom, type="non reconnue", nb_lignes=len(feuille.lignes))
            lue.apercu = _apercu(feuille, None)
            fichier.feuilles.append(lue)
            continue
        _metadonnees(feuille.lignes[: i + 1], fichier)
        if type_ == "possessions":
            lue = _lire_possessions(feuille, i, roles, fichier)
        elif type_ == "secteurs":
            lue, paires = _lire_repartition(feuille, i, roles, "secteur", "secteurs", fichier)
            fichier.secteurs += paires
        else:
            lue, paires = _lire_repartition(feuille, i, roles, "pays", "zones", fichier)
            fichier.zones += paires
        lue.apercu = _apercu(feuille, i)
        fichier.feuilles.append(lue)
    # iShares : le nom, l'ISIN et la devise du fonds sont dans les feuilles « Fund Header » et « Key Facts »,
    # pas au-dessus des possessions. On n'y lit que ce que le reste n'a pas donné.
    for feuille in feuilles:
        nom = corr.cle(feuille.nom)
        if any(m in nom for m in ("header", "key facts", "fund facts", "fiche", "caracteristiques")):
            _metadonnees(feuille.lignes[:40], fichier)
    if not fichier.possessions:
        raise ValueError(
            "aucune feuille de possessions reconnue : il faut une feuille avec un nom (ou un ISIN) et un poids par titre"
        )
    fichier.possessions.sort(key=lambda p: (-p.poids, p.ligne))
    return fichier


# ---------- La couverture ----------


def cumul(poids: list[float]) -> list[float]:
    """Le cumul des poids (déjà triés du plus lourd au plus léger), arrondi à 4 décimales."""
    total, resultat = 0.0, []
    for p in poids:
        total += p
        resultat.append(round(total, 4))
    return resultat


def lignes_pour_couverture(poids: list[float], pct: float) -> int:
    """Le plus petit nombre de lignes dont le cumul atteint `pct` % (le fichier tout entier si
    même lui n'y arrive pas). Même résultat que l'écran, qui calcule avec `cumul`."""
    for n, c in enumerate(cumul(poids), start=1):
        if c >= pct - 1e-9:
            return n
    return len(poids)


def couverture_pour_lignes(poids: list[float], n: int) -> float:
    """Le cumul des `n` premiers poids, en %."""
    return round(sum(poids[: max(0, n)]), 4)
