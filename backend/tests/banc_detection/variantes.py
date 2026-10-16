"""Le générateur de variantes : d'un relevé, cent façons de l'écrire.

Une banque change ses intitulés, l'ordre de ses colonnes, son encodage ; deux
banques écrivent le même montant de quatre façons. Chaque transformation
ci-dessous fait UNE de ces choses, et met le mapping attendu à jour en même
temps : le relevé transformé dit toujours la vérité sur lui-même.

Les cas produits : chaque base telle quelle, chaque transformation seule
(pour savoir laquelle casse quoi), puis quelques combinaisons tirées au sort à
graine fixe (pour les cas qu'aucune transformation seule ne produit).
"""
from __future__ import annotations

import random
import unicodedata
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Optional

from . import synthetiques
from .releve import ROLES_DU_NET, ROLES_MONTANT, Releve, centimes, charger, texte_montant

DOSSIER_RELEVES = Path(__file__).parent / "releves"

# Les intitulés qu'une banque peut écrire, rôle par rôle. Volontairement PLUS
# LARGES que le dictionnaire de la détection : le banc doit montrer ce qu'elle
# ne reconnaît pas encore.
SYNONYMES = {
    "date": ("Date", "Date opération", "Date d'opération", "Date de l'opération",
             "Date comptable", "Date opé.", "Jour"),
    "date_valeur": ("Date valeur", "Date de valeur", "Valeur"),
    "nature": ("Libellé", "Libellé opération", "Libellé de l'opération", "Description",
               "Intitulé", "Désignation"),
    "detail": ("Détail", "Libellé complémentaire", "Complément", "Informations complémentaires"),
    "categorie": ("Catégorie", "Rubrique", "Catégorie de l'opération"),
    "montant": ("Montant", "Montant (EUR)", "Montant EUR", "Montant en euros", "Somme"),
    "debit": ("Débit", "Débit (EUR)", "Montant débit", "Débit euros"),
    "credit": ("Crédit", "Crédit (EUR)", "Montant crédit", "Crédit euros"),
    "envoye": ("Envoyé", "Montant envoyé", "Envoyé (EUR)"),
    "recu": ("Reçu", "Montant reçu", "Reçu (EUR)"),
    "sens": ("Sens", "Débit/Crédit", "D/C", "Type de mouvement"),
    "devise": ("Devise", "Monnaie"),
    "solde": ("Solde", "Solde (EUR)", "Solde après opération", "Solde courant"),
    "reference": ("Référence", "Réf.", "N° d'opération", "Identifiant"),
}


@dataclass
class Cas:
    nom: str
    contenu: bytes
    attendu: dict
    synthetique: bool


# ---------- Les transformations ----------


def _sans_accents(texte: str) -> str:
    return "".join(c for c in unicodedata.normalize("NFD", texte) if unicodedata.category(c) != "Mn")


def _retirer_colonnes(r: Releve, indices: list[int]) -> None:
    garder = [j for j in range(len(r.roles)) if j not in indices]
    r.roles = [r.roles[j] for j in garder]
    if r.entetes is not None:
        r.entetes = [r.entetes[j] for j in garder]
    r.lignes = [[l[j] for j in garder] for l in r.lignes]
    r.pied = [[l[j] if j < len(l) else "" for j in garder] for l in r.pied]


def _inserer_colonnes(r: Releve, position: int, roles: list[str], entetes: list[str], valeurs: list[list[str]]) -> None:
    r.roles[position:position] = roles
    if r.entetes is not None:
        r.entetes[position:position] = entetes
    for ligne, ajout in zip(r.lignes, valeurs):
        ligne[position:position] = ajout
    for ligne in r.pied:
        ligne[position:position] = [""] * len(roles)


def permuter(r: Releve, rng: random.Random) -> Releve:
    v = r.copie("permuter")
    ordre = list(range(len(v.roles)))
    while ordre == sorted(ordre) and len(ordre) > 1:
        rng.shuffle(ordre)
    v.roles = [v.roles[j] for j in ordre]
    if v.entetes is not None:
        v.entetes = [v.entetes[j] for j in ordre]
    v.lignes = [[l[j] for j in ordre] for l in v.lignes]
    v.pied = [[(l + [""] * len(ordre))[j] for j in ordre] for l in v.pied]
    return v


def renommer(r: Releve, rng: random.Random) -> Releve:
    """Un synonyme par colonne, puis une casse et des accents au hasard."""
    v = r.copie("renommer")
    if v.entetes is None:
        return v
    for j, role in enumerate(v.roles):
        intitule = rng.choice(SYNONYMES[role])
        v.entetes[j] = rng.choice((str, str.upper, str.lower, _sans_accents))(intitule)
    return v


def sans_intitules(r: Releve, rng: random.Random) -> Releve:
    v = r.copie("sans_intitules")
    v.entetes = None
    return v


_NOMS_SEPARATEURS = {";": "point_virgule", ",": "virgule", "\t": "tabulation"}


def separateur(r: Releve, sep: str) -> Releve:
    """Un CSV séparé par `sep`. Avec « , », le point devient décimal, comme
    chez toutes les banques qui font ce choix."""
    v = r.copie(f"separateur_{_NOMS_SEPARATEURS[sep]}")
    decimal = "." if sep == "," else ","
    if decimal != v.separateur_decimal:
        for ligne in v.lignes:
            for j in v.colonnes(*ROLES_MONTANT):
                valeur = centimes(ligne[j], v.separateur_decimal)
                if valeur is not None:
                    ligne[j] = texte_montant(valeur, decimal)
        v.pied = []  # un total réécrit à moitié ne testerait rien
        v.separateur_decimal = decimal
    v.separateur = sep
    return v


def encodage(r: Releve, enc: str) -> Releve:
    v = r.copie(f"encodage_{enc}")
    if v.separateur == "xlsx":
        v.separateur = ";"
        if v.separateur_decimal != ",":
            v = separateur(v, ";")
            v.nom = r.nom + f"/encodage_{enc}"
    v.encodage = enc
    return v


def titres(r: Releve, rng: random.Random) -> Releve:
    v = r.copie("titres")
    v.titres = [
        ["Relevé des opérations"],
        ["Titulaire", "M. DUPONT JEAN"],
        ["Période", "du 02/01/2026 au 29/05/2026"],
        [""],
    ][: rng.randint(2, 4)] + v.titres
    return v


def _soldes_apres(r: Releve) -> list[str]:
    """Le solde après chaque ligne, calculé en ordre chronologique puis remis
    dans l'ordre du fichier."""
    nets = r.nets()
    chrono = nets if r.ordre == "croissant" else nets[::-1]
    solde, soldes = 100_000, []
    for net in chrono:
        solde += net or 0
        soldes.append(texte_montant(solde, r.separateur_decimal))
    return soldes if r.ordre == "croissant" else soldes[::-1]


def avec_solde(r: Releve, rng: random.Random) -> Releve:
    v = r.copie("avec_solde")
    if "solde" in v.roles:
        return v
    _inserer_colonnes(v, len(v.roles), ["solde"], ["Solde"], [[s] for s in _soldes_apres(v)])
    return v


def sans_solde(r: Releve, rng: random.Random) -> Releve:
    v = r.copie("sans_solde")
    _retirer_colonnes(v, v.colonnes("solde"))
    return v


def _convertir(r: Releve, suffixe: str, roles: list[str], entetes: list[str], cellules: Callable[[int], list[str]]) -> Releve:
    """Remplace toutes les colonnes qui portent le montant net par `roles`, à la
    place de la première d'entre elles."""
    v = r.copie(suffixe)
    nets = v.nets()
    anciennes = v.colonnes(*ROLES_DU_NET)
    position = anciennes[0]
    _retirer_colonnes(v, anciennes)
    _inserer_colonnes(v, position, roles, entetes, [cellules(n) if n is not None else [""] * len(roles) for n in nets])
    v.pied = []  # le total d'origine ne correspond plus à rien
    return v


def en_algebrique(r: Releve, rng: random.Random) -> Releve:
    sep = r.separateur_decimal
    return _convertir(r, "en_algebrique", ["montant"], ["Montant"], lambda n: [texte_montant(n, sep)])


def en_montant_sens(r: Releve, rng: random.Random) -> Releve:
    sep = r.separateur_decimal
    sortie, entree = rng.choice((("Débit", "Crédit"), ("D", "C"), ("DEBIT", "CREDIT")))
    return _convertir(
        r, "en_montant_sens", ["montant", "sens"], ["Montant", "Sens"],
        lambda n: [texte_montant(abs(n), sep), sortie if n < 0 else entree],
    )


def _en_couple(r: Releve, suffixe: str, roles: list[str], entetes: list[str]) -> Releve:
    sep = r.separateur_decimal
    return _convertir(
        r, suffixe, roles, entetes,
        lambda n: [texte_montant(-n, sep) if n < 0 else "", texte_montant(n, sep) if n > 0 else ""],
    )


def en_debit_credit(r: Releve, rng: random.Random) -> Releve:
    return _en_couple(r, "en_debit_credit", ["debit", "credit"], ["Débit", "Crédit"])


def en_envoye_recu(r: Releve, rng: random.Random) -> Releve:
    return _en_couple(r, "en_envoye_recu", ["envoye", "recu"], ["Envoyé", "Reçu"])


def inverser_ordre(r: Releve, rng: random.Random) -> Releve:
    v = r.copie("inverser_ordre")
    v.lignes = v.lignes[::-1]
    v.ordre = "decroissant" if v.ordre == "croissant" else "croissant"
    return v


# Celles qui se combinent librement. Les séparateurs et encodages ont leurs
# propres entrées : ils prennent un paramètre et non un tirage.
TRANSFORMATIONS: dict[str, Callable[[Releve, random.Random], Releve]] = {
    "permuter": permuter,
    "renommer": renommer,
    "titres": titres,
    "avec_solde": avec_solde,
    "sans_solde": sans_solde,
    "en_algebrique": en_algebrique,
    "en_montant_sens": en_montant_sens,
    "en_debit_credit": en_debit_credit,
    "en_envoye_recu": en_envoye_recu,
    "inverser_ordre": inverser_ordre,
    "sans_intitules": sans_intitules,
}
_COMBINABLES = [n for n in TRANSFORMATIONS if n != "sans_intitules"]


def variantes(base: Releve, combinaisons: int = 6) -> list[Releve]:
    resultat = []
    for nom, transformation in TRANSFORMATIONS.items():
        # Un solde qu'on ajoute là où il y en a déjà un, qu'on retire là où il
        # n'y en a pas : la base elle-même, déjà comptée.
        if (nom == "avec_solde") == ("solde" in base.roles) and nom in ("avec_solde", "sans_solde"):
            continue
        resultat.append(transformation(base, random.Random(f"{base.nom}-{nom}")))
    for sep in (";", ",", "\t"):
        if sep != base.separateur:
            resultat.append(separateur(base, sep))
    for enc in ("utf-8", "utf-8-sig", "cp1252", "latin-1"):
        if enc != base.encodage or base.separateur == "xlsx":
            resultat.append(encodage(base, enc))
    for i in range(combinaisons):
        rng = random.Random(f"{base.nom}-combinaison-{i}")
        v = base
        for nom in rng.sample(_COMBINABLES, 3):
            v = TRANSFORMATIONS[nom](v, rng)
        if rng.random() < 0.5:
            v = separateur(v, rng.choice((";", ",", "\t")))
            v = encodage(v, rng.choice(("utf-8", "cp1252", "latin-1")))
        v.nom = f"{base.nom}/combinaison_{i}"
        resultat.append(v)
    return resultat


def _cas(r: Releve, synthetique: bool, contenu: Optional[bytes] = None) -> Cas:
    return Cas(r.nom, contenu if contenu is not None else r.en_octets(), r.attendu(), synthetique)


def tous_les_cas(avec_reels: bool = True) -> list[Cas]:
    cas = []
    for base in synthetiques.bases():
        cas.append(_cas(base, True))
        cas.extend(_cas(v, True) for v in variantes(base))
    if avec_reels and DOSSIER_RELEVES.is_dir():
        for chemin in sorted(DOSSIER_RELEVES.glob("*.attendu.json")):
            contenu, base = charger(chemin)
            base.nom = f"reel:{base.nom}"
            cas.append(_cas(base, False, contenu))
            cas.extend(_cas(v, False) for v in variantes(base))
    return cas
