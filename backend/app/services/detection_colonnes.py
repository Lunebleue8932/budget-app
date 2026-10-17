"""Deviner, dans un relevé qu'on n'a jamais vu, quelle colonne dit quoi.

POURQUOI. Régler un preset, c'est dire pour chaque propriété de l'import
(date, libellé, montant…) dans quelle colonne du fichier elle se trouve. Pour
un relevé ordinaire, la réponse se lit dans le fichier lui-même : la ligne des
intitulés dit « Date », « Libellé », « Montant », et les cellules en dessous
ont la forme d'une date, d'un texte, d'un nombre. Demander de recopier ces
numéros à la main était la première marche de l'import, et la plus haute.

DEUX INDICES, ET ILS SE CROISENT :

  - L'INTITULÉ de la colonne, quand le fichier en a un (le dictionnaire de
    services/entetes, en français, anglais et portugais). C'est le plus sûr : une banque qui écrit « Débit »
    en tête de colonne ne laisse aucun doute ;
  - LA FORME DES CELLULES : la part de dates, de nombres, de textes répétés ou
    tous différents, de codes de devise. C'est ce qui sauve un fichier sans
    intitulés, et ce qui départage deux intitulés possibles.

CE QUI EST SÛR ET CE QUI NE L'EST PAS, et c'est la moitié du travail : une
colonne reçoit UNE proposition quand les indices convergent (`certaine`), et
PLUSIEURS, classées, quand ils hésitent — deux colonnes de dates (date
d'opération, date de valeur), deux colonnes de texte (libellé, catégorie). Le
choix final appartient toujours à l'écran : rien n'est enregistré ici, pas même
un essai.

CE QUE ÇA NE LIT JAMAIS : les montants en tant que tels. On regarde si une
cellule A LA FORME d'un montant, jamais ce qu'elle vaut.

LA LECTURE AVANT LES COLONNES (`detecter_fichier`) : encodage, délimiteur,
feuille d'un classeur (services/lecture_fichier), puis, sur les cellules
elles-mêmes, séparateur décimal et de milliers (services/lecture_montants),
écriture des dates et ordre du fichier (services/lecture_dates), lignes de
total ou de solde final sous les opérations. Chacun est RENDU avec les
colonnes, pour que l'écran puisse le montrer et le corriger.
"""
from collections import Counter
from dataclasses import dataclass, field
from difflib import SequenceMatcher
from typing import Optional

from ..constants import (
    LIBELLES_SENS_ENTREE,
    LIBELLES_SENS_SORTIE,
    LIBELLES_STATUT_DEFAUT,
)
from . import formats_bancaires
from .affectation_colonnes import affecter
from .controle_solde import controler_solde
from .entetes import (
    SCORE_FLOU_MIN,
    SCORE_MOT_CLE,
    SCORE_SYNONYME,
    dictionnaire,
    groupe_principal,
    mots_entete,
    scores_proprietes,
)
from .import_bancaire import normaliser_libelle, parser_date
from .lecture_dates import format_dates, lire_date, ordre_dates
from .lecture_fichier import lire_fichier
from .lecture_montants import centimes, format_nombres

# Combien de lignes de données on examine : assez pour qu'une colonne rare ne
# passe pas pour vide, assez peu pour qu'un relevé de dix ans se lise vite.
_ECHANTILLON = 200
# Jusqu'où on cherche la ligne des intitulés (cf. MAX_LIGNES_ENTETE).
_TETE_MAX = 20

# LES PROPRIÉTÉS QU'UN INTITULÉ PEUT DÉSIGNER : celles du dictionnaire
# (app/synonymes_entetes.json, cf. services/entetes), qui dit aussi lesquelles
# ne s'importent pas — un solde courant est un nombre sur chaque ligne, le
# reconnaître pour le dire évite de le prendre pour un montant.
def _proprietes_connues() -> list[str]:
    return sorted({g["propriete"] for g in dictionnaire().values() if g["propriete"]})


# Une colonne dont deux montants sont remplis sur plus d'une ligne sur vingt
# n'est pas un couple débit/crédit.
_PART_REMPLIES_ENSEMBLE = 0.05

# LE TEST DU SOLDE (services/controle_solde) décide ou départage : vérifié, il
# VERROUILLE — son score dépasse tout ce que les intitulés et la forme peuvent
# donner ; probable, il ajoute un bonus, sans plus.
_VERROU = 2.5
_BONUS_PROBABLE = 0.3


# LES PROPRIÉTÉS QUI ONT UNE FORME : une date, un nombre, un code de devise, un
# mot du vocabulaire « Sens » ou « État ». Pour elles, un intitulé que la forme
# des cellules contredit ne compte que pour moitié — une colonne « Type de
# carte » contient le mot « type » sans être un sens.
_PROPRIETES_A_FORME = {
    "date", "montant", "montant_debit", "montant_credit", "frais", "montant_initial",
    "monnaie", "monnaie_initiale", "monnaie_frais", "sens", "statut",
}

_MOTS_SENS = {normaliser_libelle(m) for m in LIBELLES_SENS_ENTREE | LIBELLES_SENS_SORTIE}
_MOTS_STATUT = {
    normaliser_libelle(mot) for mots in LIBELLES_STATUT_DEFAUT.values() for mot in mots
}


@dataclass
class _Profil:
    """Ce qu'on sait d'une colonne avant d'y chercher une propriété."""

    index: int  # 1-based, comme l'écran et Excel
    entete: str = ""
    exemples: list = field(default_factory=list)
    remplies: int = 0
    dates: int = 0
    nombres: int = 0
    negatifs: int = 0
    decimales: int = 0
    devises: int = 0
    mots_sens: int = 0
    mots_statut: int = 0
    distinctes: int = 0
    longueur_moyenne: float = 0.0
    vides_ou_zero: list = field(default_factory=list)  # par ligne : la cellule est-elle vide/0 ?
    # LES STATISTIQUES DE CONTENU, dernier niveau de preuve (cf. _scores_forme) :
    jetons_bancaires: int = 0  # « CB … », « VIR … », « PRLV … »
    types_operation: int = 0  # « Paiement par carte », « Virement reçu »…
    categories_app: int = 0  # une catégorie que l'application connaît
    entiers_longs: int = 0  # un numéro : six chiffres ou plus, rien d'autre
    similarite: float = 1.0  # ressemblance moyenne de deux valeurs voisines

    def part(self, compte: int) -> float:
        return compte / self.remplies if self.remplies else 0.0


# LES MOTS QUI OUVRENT UN LIBELLÉ BANCAIRE : presque chaque ligne d'un relevé en
# porte un en tête. Une colonne qui en est pleine est le libellé.
_JETONS_BANCAIRES = {
    "cb", "carte", "vir", "virement", "prlv", "prelevement", "sepa", "retrait", "dab",
    "chq", "cheque", "paiement", "facture", "inst", "achat", "remise", "avoir",
}
# LES TYPES D'OPÉRATION, écrits en entier (cf. normaliser_libelle) : une colonne
# qui n'en contient que quelques-uns RESSEMBLE à une catégorie — peu de valeurs,
# très répétées — sans en être une. La catégorie dit à quoi a servi l'argent,
# le type dit comment il a bougé.
_TYPES_OPERATION = {
    "carte", "cb", "cartebancaire", "paiementcarte", "paiementparcarte", "achatcarte",
    "virement", "vir", "virementrecu", "virementemis", "virementinstantane", "virementsepa",
    "prelevement", "prlv", "prelevementsepa", "cheque", "chq", "remisedecheque",
    "retrait", "retraitdespeces", "retraitdab", "retraitespeces", "dab", "depot",
    "depotdespeces", "versement", "frais", "fraisbancaires", "commission", "interets",
    "avoir", "remboursement",
}
# Un numéro (référence, identifiant) : au moins six chiffres, sans séparateur.
_CHIFFRES_NUMERO = 6
# Un sens dont moins d'une valeur sur cinq est du vocabulaire n'en est pas un.
_PART_SENS_MINIMALE = 0.2
# Le compte du relevé figure sur (presque) chaque ligne.
_REMPLISSAGE_COMPTE = 0.8
# Combien de valeurs voisines comparer pour juger de leur ressemblance.
_PAIRES_COMPAREES = 40


def _est_devise(texte: str) -> bool:
    return (len(texte) == 3 and texte.isalpha() and texte.isupper()) or texte in {
        "€", "$", "£", "¥", "CHF",
    }


def _ligne_des_intitules(lignes: list[tuple]) -> Optional[int]:
    """L'indice de la ligne d'intitulés, ou None si le fichier n'en a pas.

    C'est la ligne, parmi les premières, dont le plus de cellules sont des
    intitulés connus : un intitulé reconnu EN ENTIER (exact ou synonyme du
    dictionnaire) compte pour un, un intitulé seulement reconnaissable (un
    mot-clé, une faute de frappe) pour moitié. Il en faut plus d'un, pour
    qu'une ligne de titre (« Relevé de compte ») ne passe pas pour une ligne
    d'intitulés — et une ligne qui porte une date est une opération, jamais
    des intitulés."""
    meilleure, meilleur_score = None, 1.0
    for i, ligne in enumerate(lignes[:_TETE_MAX]):
        score = 0.0
        for cellule in ligne:
            if cellule in (None, ""):
                continue
            if parser_date(cellule) is not None:
                score = 0.0
                break
            reconnue = max(scores_proprietes(cellule).values(), default=0.0)
            if reconnue >= SCORE_SYNONYME:
                score += 1
            elif reconnue >= SCORE_FLOU_MIN:
                score += 0.5
        if score > meilleur_score:
            meilleure, meilleur_score = i, score
    return meilleure




def _premiere_ligne_de_donnees(lignes: list[tuple]) -> int:
    """Sans intitulés : la première ligne qui porte une date ET a la largeur
    des opérations. Une ligne de synthèse en tête (« Crédit immobilier ;
    ****1234 ; 18/03/2022 ; ; -123 456,78 ») porte bien une date, mais pas le
    découpage des lignes qui la suivent."""
    avec_date = [
        i for i, ligne in enumerate(lignes[:_TETE_MAX])
        if any(parser_date(c) is not None for c in ligne if c not in (None, ""))
    ]
    if not avec_date:
        return 0
    # La largeur BRUTE : un CSV garde ses cellules vides de fin (« …;82,40; »),
    # c'est la ligne de synthèse qui n'a pas le même nombre de champs.
    largeurs = Counter(len(lignes[i]) for i in avec_date)
    courante = max(largeurs.items(), key=lambda kv: (kv[1], kv[0]))[0]
    if largeurs[courante] < 2:
        return avec_date[0]
    return next(i for i in avec_date if len(lignes[i]) == courante)


# Au-delà, ce qui suit les opérations n'est plus un pied de relevé mais un
# fichier qui mêle autre chose : on n'y touche pas.
_PIED_MAX = 10


def _lignes_de_pied(corps: list[tuple], format_date) -> int:
    """Combien de lignes, SOUS les opérations, n'en sont pas : un total, un
    solde final, une mention légale. Ce sont les dernières lignes dont la
    colonne de dates — celle qui en porte le plus — n'en porte pas."""
    echantillon = corps[:_ECHANTILLON]
    largeur = max((len(l) for l in echantillon), default=0)
    if not largeur:
        return 0

    def est_une_date(ligne, j):
        return j < len(ligne) and lire_date(ligne[j], format_date) is not None

    colonne = max(range(largeur), key=lambda j: sum(est_une_date(l, j) for l in echantillon))
    if not any(est_une_date(l, colonne) for l in echantillon):
        return 0
    pied = 0
    for ligne in reversed(corps):
        if pied >= _PIED_MAX or est_une_date(ligne, colonne):
            break
        pied += 1
    return pied if pied < len(corps) else 0


def _ordre_des_dates(operations: list[tuple], format_date) -> Optional[str]:
    """L'ordre que dit la colonne qui porte le plus de dates, avant toute
    attribution : le test du solde en a besoin pour départager deux lectures
    qu'il ne distingue pas (cf. services/controle_solde)."""
    echantillon = operations[:_ECHANTILLON]
    largeur = max((len(l) for l in echantillon), default=0)
    if not largeur:
        return None
    dates = [
        [lire_date(l[j], format_date) if j < len(l) else None for l in echantillon]
        for j in range(largeur)
    ]
    colonne = max(range(largeur), key=lambda j: sum(d is not None for d in dates[j]))
    return ordre_dates(dates[colonne])


def _profiler(
    lignes_donnees: list[tuple],
    entetes: list,
    separateur_decimal=None,
    separateur_milliers=None,
    format_date=None,
    categories_app: frozenset = frozenset(),
) -> list[_Profil]:
    largeur = max([len(l) for l in lignes_donnees] + [len(entetes)] + [0])
    profils = [_Profil(index=j + 1, entete=str(entetes[j]).strip() if j < len(entetes) and entetes[j] is not None else "")
               for j in range(largeur)]
    valeurs: list[set] = [set() for _ in range(largeur)]
    # Les premières valeurs DISTINCTES, dans leur ordre d'apparition : de quoi
    # comparer des valeurs voisines (cf. _PAIRES_COMPAREES).
    premieres: list[list] = [[] for _ in range(largeur)]
    longueurs: list[int] = [0] * largeur
    for ligne in lignes_donnees:
        for j in range(largeur):
            cellule = ligne[j] if j < len(ligne) else None
            texte = "" if cellule is None else str(cellule).strip()
            profil = profils[j]
            montant = centimes(cellule, separateur_decimal, separateur_milliers) if texte else None
            profil.vides_ou_zero.append(not texte or montant == 0)
            if not texte:
                continue
            profil.remplies += 1
            if texte not in valeurs[j] and len(premieres[j]) <= _PAIRES_COMPAREES:
                premieres[j].append(texte)
            valeurs[j].add(texte)
            longueurs[j] += len(texte)
            if len(profil.exemples) < 3 and texte not in profil.exemples:
                profil.exemples.append(texte)
            if lire_date(cellule, format_date) is not None:
                profil.dates += 1
            elif montant is not None:
                profil.nombres += 1
                if montant < 0:
                    profil.negatifs += 1
                # Un montant a des centimes ; un numéro de référence non.
                decimal = separateur_decimal or ","
                if montant % 100 or (isinstance(cellule, str) and decimal in texte):
                    profil.decimales += 1
            if _est_devise(texte):
                profil.devises += 1
            norm = normaliser_libelle(texte)
            mots = mots_entete(texte)
            if mots and (mots[0] in _JETONS_BANCAIRES or mots[:2][-1] in _JETONS_BANCAIRES):
                profil.jetons_bancaires += 1
            if norm in _TYPES_OPERATION:
                profil.types_operation += 1
            if norm in categories_app:
                profil.categories_app += 1
            if texte.isdigit() and len(texte) >= _CHIFFRES_NUMERO:
                profil.entiers_longs += 1
            if norm in _MOTS_SENS:
                profil.mots_sens += 1
            if norm in _MOTS_STATUT:
                profil.mots_statut += 1
    for j, profil in enumerate(profils):
        profil.distinctes = len(valeurs[j])
        profil.longueur_moyenne = longueurs[j] / profil.remplies if profil.remplies else 0.0
        voisines = list(zip(premieres[j], premieres[j][1:]))
        if voisines:
            profil.similarite = sum(
                SequenceMatcher(None, a, b).ratio() for a, b in voisines
            ) / len(voisines)
    return profils


def _scores_forme(p: _Profil) -> dict[str, float]:
    """Ce que la FORME des cellules dit de la colonne, propriété par propriété.

    Des scores et non un verdict : une colonne de nombres peut être un montant,
    un débit, des frais — c'est l'intitulé, ou le voisinage, qui tranche."""
    if not p.remplies:
        return {}
    s: dict[str, float] = {}
    part_dates = p.part(p.dates)
    part_nombres = p.part(p.nombres)
    if part_dates >= 0.8:
        s["date"] = 0.7
    # UN MONTANT A DES CENTIMES quelque part ; une colonne d'entiers est plus
    # souvent un numéro qu'une somme.
    if part_nombres >= 0.8 and (p.decimales or p.negatifs):
        s["montant"] = 0.6 if p.negatifs else 0.4
        s["montant_debit"] = 0.25
        s["montant_credit"] = 0.25
        s["frais"] = 0.15
        s["montant_initial"] = 0.15
    if p.part(p.devises) >= 0.8:
        s["monnaie"] = 0.7
        s["monnaie_initiale"] = 0.3
        s["monnaie_frais"] = 0.3
    if p.part(p.mots_sens) >= 0.8 and p.distinctes <= 4:
        s["sens"] = 0.8
    if p.part(p.mots_statut) >= 0.8 and p.distinctes <= 4:
        s["statut"] = 0.8
    texte = part_dates < 0.5 and part_nombres < 0.5 and p.part(p.devises) < 0.5
    if texte:
        ratio = p.distinctes / p.remplies
        # LE LIBELLÉ change presque à chaque ligne et s'écrit long ; LA
        # CATÉGORIE revient souvent et s'écrit court.
        s["nature"] = 0.5 * min(1.0, ratio * 1.5) + 0.2 * min(1.0, p.longueur_moyenne / 25)
        # Une catégorie en a au moins deux : une colonne constante (« Current »)
        # ne classe rien.
        if 2 <= p.distinctes <= max(12, p.remplies // 3):
            s["categorie_banque"] = 0.45 if ratio < 0.5 else 0.25
            s["compte_banque"] = 0.2 if p.distinctes <= 5 else 0.05
        # LE LIBELLÉ s'ouvre sur « CB », « VIR », « PRLV »… et deux libellés
        # voisins se ressemblent peu. Un libellé RÉPÉTÉ (le loyer chaque mois)
        # reste normal : la diversité se juge sur l'ensemble, pas ligne à ligne.
        if p.part(p.jetons_bancaires) >= 0.3:
            s["nature"] += 0.15
        if p.similarite < 0.5 and ratio > 0.5:
            s["nature"] += 0.1
        # LE TYPE D'OPÉRATION ressemble à une catégorie et n'en est pas une :
        # proposé en « ne pas importer » (une colonne dummy le lira au besoin).
        # Une catégorie que l'application connaît déjà, à l'inverse, en est une.
        if p.part(p.types_operation) >= 0.6:
            s["categorie_banque"] = 0.1
            s["nature"] = min(s["nature"], 0.2)
            s[""] = 0.5
        elif p.part(p.categories_app) >= 0.5:
            s["categorie_banque"] = s.get("categorie_banque", 0.0) + 0.3
    # UNE RÉFÉRENCE : un numéro presque toujours différent, sans décimales. Ce
    # n'est pas un montant, et ça ne s'importe pas.
    if p.part(p.entiers_longs) >= 0.8 and p.distinctes / p.remplies >= 0.95:
        for propriete in ("montant", "montant_debit", "montant_credit", "frais", "montant_initial"):
            s.pop(propriete, None)
        s[""] = 0.6
    return s


def _debit_credit(profils: list[_Profil]) -> Optional[tuple[_Profil, _Profil]]:
    """Deux colonnes de nombres qui ne sont JAMAIS remplies sur la même ligne :
    le montant scindé en débit et crédit. Le débit est celui des deux qui a
    l'intitulé de débit, à défaut le premier — c'est l'ordre de presque tous les
    relevés."""
    nombres = [p for p in profils if p.remplies and p.part(p.nombres) >= 0.8]
    for i, a in enumerate(nombres):
        for b in nombres[i + 1:]:
            lignes = zip(a.vides_ou_zero, b.vides_ou_zero)
            exclusives = all(va or vb for va, vb in lignes)
            couvrantes = all(not (va and vb) for va, vb in zip(a.vides_ou_zero, b.vides_ou_zero))
            # Chacune porte au moins UN montant : une colonne de zéros (un
            # numéro de compte « 0 ») est vide partout, donc « exclusive » de
            # n'importe quoi, et n'est pas un crédit.
            montants = not all(a.vides_ou_zero) and not all(b.vides_ou_zero)
            if exclusives and couvrantes and montants and a.remplies and b.remplies:
                entete_b = scores_proprietes(b.entete)
                if entete_b.get("montant_debit", 0.0) > entete_b.get("montant_credit", 0.0):
                    return b, a
                return a, b
    return None


def detecter_colonnes(
    lignes: list[tuple],
    separateur_decimal: Optional[str] = None,
    categories: Optional[list[str]] = None,
) -> dict:
    """{lignes_entete, colonnes: [{index, entete, exemples, propositions,
    certaine}], configuration: [{index, propriete}]}.

    `propositions` est classée, et sa première entrée est celle que retient
    `configuration` — sauf quand une autre colonne revendique plus fort la
    même propriété : une propriété ne se lit que dans UNE colonne."""
    ligne_intitules = _ligne_des_intitules(lignes)
    if ligne_intitules is not None:
        entetes = list(lignes[ligne_intitules])
        debut = ligne_intitules + 1
    else:
        entetes = []
        debut = _premiere_ligne_de_donnees(lignes)
    corps = [l for l in lignes[debut:] if any(c not in (None, "") for c in l)]
    cellules = [c for l in corps[:_ECHANTILLON] for c in l if c not in (None, "")]
    # LE FORMAT DES NOMBRES ET DES DATES se lit sur tout l'échantillon : une
    # cellule seule ne dit pas si « 1.234 » vaut mille ou un, si « 03/04 » est
    # en avril ou en mars. Un séparateur décimal imposé à la main l'emporte.
    if separateur_decimal:
        decimal, milliers = separateur_decimal, None
    else:
        decimal, milliers = format_nombres(cellules)
    format_date, format_date_certain = format_dates(cellules)
    pied = _lignes_de_pied(corps, format_date)
    operations = corps[: len(corps) - pied]
    donnees = operations[:_ECHANTILLON]
    # LES CATÉGORIES DE L'APPLICATION, quand l'appelant les donne : une colonne
    # qui les écrit est la catégorie de la banque.
    connues = frozenset(normaliser_libelle(c) for c in (categories or []) if c)
    profils = _profiler(donnees, entetes, decimal, milliers, format_date, connues)

    scores: dict[int, dict[str, float]] = {}
    presque_vides: list[int] = []
    for p in profils:
        entete = scores_proprietes(p.entete)
        forme = _scores_forme(p)
        s: dict[str, float] = {}
        for propriete in _proprietes_connues():
            valeur = forme.get(propriete, 0.0) + entete.get(propriete, 0.0)
            # UN INTITULÉ QUE LA FORME CONTREDIT NE COMPTE QUE POUR MOITIÉ :
            # une colonne « Date » remplie de texte n'est pas une date.
            if (
                entete.get(propriete)
                and propriete in _PROPRIETES_A_FORME
                and not forme.get(propriete)
            ):
                valeur *= 0.5
            # UN SENS ne se lit que dans un vocabulaire fermé (« Débit »,
            # « C »…) : une colonne dont presque aucune valeur n'en est
            # (« CARD_PAYMENT », « Presentment ») mettrait chaque ligne en
            # erreur, quel que soit son intitulé (« Type »).
            if propriete == "sens" and p.remplies and p.part(p.mots_sens) < _PART_SENS_MINIMALE:
                valeur = 0.0
            # LE COMPTE est celui du relevé : renseigné presque partout, et
            # d'une poignée de valeurs. Un IBAN ou un numéro qui change à
            # chaque ligne, ou ne figure que sur les virements, est celui de
            # l'autre partie.
            if propriete == "compte_banque" and donnees and (
                p.remplies / len(donnees) < _REMPLISSAGE_COMPTE
                or p.distinctes > max(5, p.remplies // 2)
            ):
                valeur *= 0.3
            if valeur > 0.05:
                s[propriete] = round(min(valeur, 1.6), 3)
        # « Solde », « Référence » : ne s'importent pas, et le dire est une
        # réponse — sans quoi un solde courant passerait pour un montant. Le
        # dictionnaire les range PARMI CE QUI NE S'IMPORTE PAS, et c'est retenu
        # quand il le dit au moins aussi sûrement qu'il nomme une propriété.
        ignore = entete.get("", 0.0)
        reconnue = max((v for k, v in entete.items() if k), default=0.0)
        # Au moins un mot-clé : un intitulé qui RESSEMBLE seulement à « solde »
        # ou « référence » (cf. entetes._scores_flous) n'est qu'un indice.
        a_ignorer = ignore >= SCORE_MOT_CLE and ignore >= reconnue
        # Ce que l'intitulé (faiblement) et la forme disent de « ne pas importer ».
        faible = max(forme.get("", 0.0), 0.0 if a_ignorer else ignore)
        if faible:
            s[""] = max(s.get("", 0.0), faible)
        # 7. UN INTITULÉ RECONNU EN ENTIER l'emporte sur ce que la forme seule
        # suggère d'autre : « Category » rempli de « Debit » / « Credit »
        # reste une catégorie, la ressemblance au vocabulaire du sens ne vaut
        # que pour moitié.
        if reconnue >= SCORE_SYNONYME:
            s = {k: v if (not k or entete.get(k)) else round(v * 0.5, 3) for k, v in s.items()}
        # UNE COLONNE VIDE dont l'intitulé est reconnu (« Crédit » sur un
        # relevé du mois sans rentrée) garde sa propriété, à moitié : le preset
        # enregistré sur ce fichier doit encore lire les crédits du mois suivant.
        if a_ignorer or (not p.remplies and reconnue < SCORE_SYNONYME):
            s = {k: v * 0.3 for k, v in s.items()}
            s[""] = 1.2 if a_ignorer else 0.9
        elif donnees and p.remplies / len(donnees) < 0.34 and reconnue < SCORE_SYNONYME:
            presque_vides.append(p.index)
        scores[p.index] = s

    # ENVOYÉ / REÇU : une ligne n'en remplit d'ordinaire qu'un, et c'est alors
    # un débit/crédit sous d'autres intitulés (ce que dit le dictionnaire).
    # Remplis ENSEMBLE, ils décrivent au contraire une conversion de devises :
    # ce qui part (« montant envoyé » de l'app) et ce qui arrive (le montant).
    envoye = next((p for p in profils if groupe_principal(p.entete) == "envoye"), None)
    recu = next((p for p in profils if groupe_principal(p.entete) == "recu"), None)
    if envoye and recu and donnees:
        ensemble = sum(
            1 for ve, vr in zip(envoye.vides_ou_zero, recu.vides_ou_zero) if not ve and not vr
        )
        if ensemble / len(donnees) > _PART_REMPLIES_ENSEMBLE:
            for profil, avant, apres in (
                (envoye, "montant_debit", "montant_initial"),
                (recu, "montant_credit", "montant"),
            ):
                s = scores[profil.index]
                s[apres] = max(s.get(apres, 0.0), s.pop(avant, 0.0))

    # LE MONTANT SCINDÉ PRIME sur deux montants concurrents : c'est la seule
    # lecture qui rende compte des deux colonnes à la fois.
    scinde = _debit_credit(profils)
    if scinde:
        debit, credit = scinde
        scores[debit.index]["montant_debit"] = max(scores[debit.index].get("montant_debit", 0), 1.1)
        scores[credit.index]["montant_credit"] = max(scores[credit.index].get("montant_credit", 0), 1.1)

    # UNE COLONNE PRESQUE VIDE (moins d'une ligne sur trois) n'est le plus
    # souvent rien qu'on veuille lire : « ne pas importer » est proposé en
    # premier, les autres lectures restent offertes. Une preuve FAIBLE, donc
    # jamais contre une plus forte : ni contre un intitulé reconnu en entier
    # (écarté plus haut), ni contre un couple débit/crédit — dont l'une des
    # deux colonnes est presque toujours la moins remplie.
    for index in presque_vides:
        if scinde and index in (scinde[0].index, scinde[1].index):
            continue
        s = scores[index]
        s[""] = max(s.values(), default=0) + 0.1

    # LE TEST DU SOLDE, la preuve la plus forte : un solde qui varie
    # exactement du montant net des opérations ne laisse de doute ni sur sa
    # colonne, ni sur la façon de lire les montants, ni sur les signes.
    solde = controler_solde(operations, decimal, milliers, _ordre_des_dates(operations, format_date))
    if solde:

        def imposer(index: int, propriete: str) -> None:
            s = scores.setdefault(index, {})
            if solde.statut == "verifie":
                s[propriete] = _VERROU
            else:
                s[propriete] = round(s.get(propriete, 0.0) + _BONUS_PROBABLE, 3)

        # Le solde ne s'importe pas : il reste le solde de CONTRÔLE, rendu
        # plus bas pour l'aperçu avant import.
        imposer(solde.colonne, "")
        lecture = solde.lecture.en_dict()
        if lecture["mode"] == "algebrique":
            imposer(lecture["colonnes"][0], "montant")
        elif lecture["mode"] == "debit_credit":
            imposer(lecture["colonne_debit"], "montant_debit")
            imposer(lecture["colonne_credit"], "montant_credit")
        else:
            imposer(lecture["colonne_montant"], "montant")
            imposer(lecture["colonne_sens"], "sens")

    # L'ATTRIBUTION, globale et sous contraintes (cf. services/
    # affectation_colonnes) : une propriété par colonne et une colonne par
    # propriété, une seule lecture du montant, et ce que le test du solde a
    # vérifié posé d'office.
    verrous = {
        index: prop for index, s in scores.items() for prop, v in s.items() if v >= _VERROU
    }
    retenue, faibles = affecter(scores, verrous)

    colonnes = []
    for p in profils:
        s = scores[p.index]
        classees = sorted(s.items(), key=lambda kv: kv[1], reverse=True)
        choix = retenue.get(p.index, "")
        # La proposition retenue en tête, les autres derrière, « ne pas
        # importer » toujours offert.
        ordre = [choix] + [prop for prop, _ in classees if prop != choix]
        if "" not in ordre:
            ordre.append("")
        propositions = [
            {"propriete": prop or None, "confiance": round(s.get(prop, 0.0), 3)}
            for prop in ordre[:4]
        ]
        premier = s.get(choix, 0.0)
        second = max([v for prop, v in classees if prop != choix] + [0.0])
        # SÛRE quand les indices convergent nettement : un intitulé reconnu ET
        # une forme compatible, ou une forme sans concurrence.
        # Jamais pour un champ obligatoire comblé faute de mieux.
        certaine = premier >= 1.0 and premier - second >= 0.4 and choix not in faibles
        colonnes.append(
            {
                "index": p.index,
                "entete": p.entete,
                "exemples": p.exemples,
                "propositions": propositions if not certaine else propositions[:1],
                "certaine": certaine,
            }
        )

    # L'ORDRE DU FICHIER : celui que le solde a vérifié, sinon celui que dit
    # la monotonie de la colonne retenue pour la date.
    colonne_date = next((index for index, prop in retenue.items() if prop == "date"), None)
    ordre = None
    if solde and solde.statut == "verifie":
        ordre = solde.ordre
    elif colonne_date is not None:
        ordre = ordre_dates(
            lire_date(l[colonne_date - 1], format_date) if colonne_date <= len(l) else None
            for l in operations
        )

    resultat = {
        # En lignes PHYSIQUES, vides comprises : c'est ce que compte
        # ImportPreset.lignes_entete, et ce qu'Excel numérote.
        "lignes_entete": debut,
        # Les lignes NON VIDES qui suivent les opérations sans en être.
        "lignes_pied": pied,
        "separateur_decimal": decimal,
        "separateur_milliers": milliers,
        # « jma », « mja », « amj », ou None pour des dates déjà typées.
        "format_date": format_date,
        "format_date_certain": format_date_certain,
        # « croissant », « decroissant », ou None quand l'ordre est mêlé.
        "ordre": ordre,
        # Comment le relevé écrit ses montants, d'après les colonnes retenues.
        "mode_montants": _mode_montants(retenue, profils),
        # Le solde de contrôle (cf. services/controle_solde), ou None.
        "colonne_solde": solde.colonne if solde else None,
        # Les champs obligatoires qu'aucune colonne ne portait avec assez
        # d'assurance, comblés au seuil abaissé (cf. affectation_colonnes).
        "champs_faibles": faibles,
        "solde": solde.en_dict() if solde else None,
        "colonnes": colonnes,
        "configuration": [
            {"index": index, "propriete": prop} for index, prop in sorted(retenue.items()) if prop
        ],
        "format_reconnu": None,
    }
    return _appliquer_format_connu(resultat, lignes, profils)


# Les propriétés qui disent comment se lit le montant d'une ligne.
_LECTURE_DU_MONTANT = ("montant", "montant_debit", "montant_credit", "sens")


def _contredit_le_solde(connu: dict, solde: Optional[dict]) -> bool:
    """Le format connu lit-il le montant autrement que le solde, VÉRIFIÉ, ne
    l'a prouvé ? Un test de cohérence l'emporte sur une reconnaissance
    d'intitulés : un export qui aurait changé de colonnes sous les mêmes noms
    se trahit là."""
    if not solde or solde.get("statut") != "verifie":
        return False
    lecture = solde["lecture"]
    prouve = {}
    if lecture["mode"] == "algebrique":
        prouve = {"montant": lecture["colonnes"][0]}
    elif lecture["mode"] == "debit_credit":
        prouve = {"montant_debit": lecture["colonne_debit"], "montant_credit": lecture["colonne_credit"]}
    else:
        prouve = {"montant": lecture["colonne_montant"], "sens": lecture["colonne_sens"]}
    lu = {c["propriete"]: c["index"] for c in connu["configuration"] if c["propriete"] in _LECTURE_DU_MONTANT}
    return lu != prouve


def _appliquer_format_connu(resultat: dict, lignes: list[tuple], profils: list[_Profil]) -> dict:
    """Si l'export est celui d'une banque connue (cf. formats_bancaires), ses colonnes PRIMENT
    sur la devinette : elles sont sûres, les autres colonnes passent en « ne pas importer »
    (avec les lectures qu'on leur proposait, au cas où).

    Sauf contre le solde vérifié (cf. _contredit_le_solde). Et tout ce que la détection a
    appris de la LECTURE du fichier (séparateurs, dates, ordre, solde de contrôle, pied) est
    gardé : le format connu ne dit que les colonnes.

    LA PROPOSITION SEULEMENT, comme tout ici : rien n'est enregistré, et l'écran dit quel format
    a été reconnu pour qu'on vérifie l'aperçu."""
    connu = formats_bancaires.reconnaitre(lignes)
    if connu is None or _contredit_le_solde(connu, resultat.get("solde")):
        return resultat
    par_index = {c["index"]: c["propriete"] for c in connu["configuration"]}
    colonnes = []
    for colonne in resultat["colonnes"]:
        propriete = par_index.get(colonne["index"])
        if propriete:
            colonnes.append(
                {
                    **colonne,
                    "propositions": [{"propriete": propriete, "confiance": 1.6}],
                    "certaine": True,
                }
            )
            continue
        autres = [
            p
            for p in colonne["propositions"]
            if p["propriete"] is not None and p["propriete"] not in par_index.values()
        ]
        colonnes.append(
            {
                **colonne,
                "propositions": [{"propriete": None, "confiance": 1.0}] + autres[:2],
                "certaine": False,
            }
        )
    return {
        **resultat,
        "lignes_entete": connu["lignes_entete"],
        "colonnes": colonnes,
        "configuration": connu["configuration"],
        "format_reconnu": {"id": connu["id"], "banque": connu["banque"]},
        # Lus dans les colonnes du format, et sûrs comme elles.
        "mode_montants": _mode_montants(par_index, profils),
        "champs_faibles": [],
    }


def _mode_montants(retenue: dict[int, str], profils: list[_Profil]) -> Optional[str]:
    """« algebrique », « montant_sens », « debit_credit » ou « envoye_recu »
    (le même couple, sous ses intitulés à lui) ; None sans montant."""
    proprietes = {prop: index for index, prop in retenue.items() if prop}
    if "montant_debit" in proprietes and "montant_credit" in proprietes:
        entetes = {p.index: p.entete for p in profils}
        groupes = {
            groupe_principal(entetes.get(proprietes[p], "")) for p in ("montant_debit", "montant_credit")
        }
        return "envoye_recu" if groupes == {"envoye", "recu"} else "debit_credit"
    if "montant" in proprietes:
        return "montant_sens" if "sens" in proprietes else "algebrique"
    return None


def detecter_fichier(
    contenu: bytes,
    delimiteur: Optional[str] = None,
    feuille: Optional[str] = None,
    separateur_decimal: Optional[str] = None,
    categories: Optional[list[str]] = None,
) -> dict:
    """`detecter_colonnes` sur un fichier entier : ce qu'elle rend, plus ce
    que la lecture a appris (cf. services/lecture_fichier) — format, encodage,
    délimiteur, feuilles d'un classeur et celle qui est proposée."""
    lecture = lire_fichier(contenu, delimiteur, feuille)
    resultat = detecter_colonnes(lecture.lignes, separateur_decimal, categories)
    resultat.update(
        format=lecture.format,
        encodage=lecture.encodage,
        separateur=lecture.separateur,
        feuilles=lecture.feuilles,
        feuille=lecture.feuille,
        feuille_proposee=lecture.feuille_proposee,
    )
    return resultat
