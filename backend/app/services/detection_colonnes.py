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
import re
from difflib import SequenceMatcher
from typing import Optional

from ..constants import (
    LIBELLES_SENS_ENTREE,
    LIBELLES_SENS_SORTIE,
    LIBELLES_STATUT_DEFAUT,
)
from . import formats_bancaires
from .affectation_colonnes import _IGNORE_SUR, affecter
from .controle_solde import controler_solde
from .entetes import (
    SCORE_FLOU_MIN,
    SCORE_MOT_CLE,
    SCORE_SYNONYME,
    dictionnaire,
    groupe_principal,
    mots_entete,
    normaliser_entete,
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

# « SENS » ET « ÉTAT » À VOCABULAIRE LIBRE. Une colonne « Direction » (IN / OUT / NEUTRAL) ou « Status »
# (COMPLETED / CANCELLED) n'écrit aucun des mots que l'application connaît d'avance : la forme des
# cellules ne la désigne pas, mais son INTITULÉ le fait, et sa poignée de valeurs distinctes aussi.
# C'est alors l'étape « mots-clés » de l'import qui demande à quoi correspond chaque valeur. Ces deux
# propriétés sont proposées sur l'intitulé SEUL, pourvu que la colonne ait peu de valeurs distinctes
# (jamais un libellé ni un montant) et que l'intitulé ne soit pas l'un des mots trop vagues pour dire
# un sens (« Type » désigne tout aussi bien un moyen de paiement).
_PROPRIETES_A_MOTS_LIBRES = ("sens", "statut")
_ENTETES_VAGUES = {"type", "type mouvement", "tipo"}
_VALEURS_FERMEES_MAX = 6
# Au-delà, une colonne n'offre plus ses valeurs à l'étape des mots-clés (un libellé n'est pas un vocabulaire).
_VALEURS_OFFERTES_MAX = 40

_MOTS_SENS = {normaliser_libelle(m) for m in LIBELLES_SENS_ENTREE | LIBELLES_SENS_SORTIE}
_MOTS_STATUT = {
    normaliser_libelle(mot) for mots in LIBELLES_STATUT_DEFAUT.values() for mot in mots
}

# CE QUE L'ON PROPOSE POUR CHAQUE VALEUR d'une colonne « Sens » ou « État » (étape « mots-clés » de
# l'import) : le vocabulaire du code, plus les mots que les exports anglophones emploient le plus.
# Écrits comme `normaliser_libelle` les rend (minuscules, sans accents ni espaces). Une valeur qu'aucune
# liste ne nomme ne reçoit AUCUNE proposition : se tromper de sens inverse une opération dans tous les soldes.
_PROPOSITIONS_SENS = {
    "sortie": {normaliser_libelle(m) for m in LIBELLES_SENS_SORTIE}
    | {"out", "outgoing", "outbound", "expense", "expenses", "debited", "paid", "sent", "depense",
       "saida", "debito"},
    "entree": {normaliser_libelle(m) for m in LIBELLES_SENS_ENTREE}
    | {"in", "incoming", "inbound", "income", "credited", "received", "recu", "entrada", "credito"},
}
_PROPOSITIONS_STATUT = {
    statut.value: {normaliser_libelle(m) for m in mots}
    for statut, mots in LIBELLES_STATUT_DEFAUT.items()
}
_PROPOSITIONS_STATUT["execute"] |= {
    "completed", "complete", "done", "settled", "booked", "posted", "success", "successful",
    "confirmed", "processed", "executed", "fulfilled", "paid", "concluido",
}
_PROPOSITIONS_STATUT["attente"] |= {
    "processing", "inprogress", "scheduled", "authorised", "authorized", "hold", "onhold",
    "waiting", "submitted", "upcoming", "emandamento", "pendente",
}
_PROPOSITIONS_STATUT["refuse"] |= {
    "cancelled", "canceled", "failed", "rejected", "declined", "refunded", "reversed", "voided",
    "expired", "annule", "annulee", "echoue", "cancelado", "recusado",
}


def _proposition_de_valeur(norm: str, table: dict[str, set]) -> Optional[str]:
    return next((mode for mode, mots in table.items() if norm in mots), None)


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
    positifs: int = 0
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
# UNE COLONNE QUI PORTE LA MÊME VALEUR SUR TOUTES LES LIGNES ne dit rien de l'opération (le nom du
# compte, un « Non » de pointage, une date d'export) : à partir de ce nombre de lignes remplies,
# elle n'est ni un libellé, ni une date, ni un montant.
_LIGNES_CONSTANTE_MIN = 3
_VALEURS_OUI_NON = {
    "oui", "non", "yes", "no", "sim", "nao", "true", "false", "vrai", "faux", "o", "n", "y", "x",
}
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
                elif montant > 0:
                    profil.positifs += 1
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


def _a_forme_de_montant(p: _Profil) -> bool:
    """Des nombres, avec des centimes ou des signes : ce qu'un montant ressemble."""
    return bool(p.remplies) and p.part(p.nombres) >= 0.8 and bool(p.decimales or p.negatifs)


def _scores_forme(p: _Profil, montant_unique: bool = False) -> dict[str, float]:
    """Ce que la FORME des cellules dit de la colonne, propriété par propriété.

    Des scores et non un verdict : une colonne de nombres peut être un montant,
    un débit, des frais — c'est l'intitulé, ou le voisinage, qui tranche.

    `montant_unique` : c'est la SEULE colonne du fichier qui ait la forme d'un montant (hors solde).
    Un montant seul se lit comme un montant : proposer « débit », « crédit », « frais » ou « montant
    d'origine » pour une colonne qui n'a personne à qui s'apparier n'a pas de sens."""
    if not p.remplies:
        return {}
    s: dict[str, float] = {}
    part_dates = p.part(p.dates)
    part_nombres = p.part(p.nombres)
    constante = p.remplies >= _LIGNES_CONSTANTE_MIN and p.distinctes == 1
    if part_dates >= 0.8:
        s["date"] = 0.2 if constante else 0.7
        if constante:
            s[""] = 0.6
    # UN MONTANT A DES CENTIMES quelque part ; une colonne d'entiers est plus
    # souvent un numéro qu'une somme.
    if part_nombres >= 0.8 and (p.decimales or p.negatifs):
        if constante:
            s[""] = 0.5
        else:
            s["montant"] = 0.6 if p.negatifs else 0.4
            # UN DÉBIT (ou un crédit, ou des frais) A UN SEUL SIGNE : une colonne qui mêle des
            # montants négatifs ET positifs est un montant algébrique, rien d'autre.
            signes_mixtes = p.negatifs > 0 and p.positifs > 0
            if not montant_unique and not signes_mixtes:
                s["montant_debit"] = 0.25
                s["montant_credit"] = 0.25
                s["frais"] = 0.15
            if not montant_unique:
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
    if texte and constante:
        # Le nom du compte du relevé, ou un « Non » de pointage : le même texte partout. Ce n'est pas
        # un libellé (il ne distingue aucune opération) ni une catégorie (elle ne classe rien) ;
        # le compte du relevé, lui, est bien la même valeur sur chaque ligne - sauf si c'est un oui
        # ou un non, qui est un indicateur (pointage, rapproché) et non un compte.
        s[""] = 0.6
        if normaliser_libelle(p.exemples[0]) not in _VALEURS_OUI_NON:
            s["compte_banque"] = 0.65
    elif texte:
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


# L'INTITULÉ D'UN DÉTAIL DE CATÉGORIE (« Sous-catégorie », « Sub-category », « Subcategoria »), normalisé.
_DETAIL_DE_CATEGORIE = re.compile(
    r"(sous categorie|sub category|subcategory|sub categoria|subcategoria|sous rubrique)"
)


def _entete_de_detail(p: _Profil) -> bool:
    return bool(_DETAIL_DE_CATEGORIE.search(normaliser_entete(p.entete)))


def _poids_entete_categorie(p: _Profil) -> float:
    return scores_proprietes(p.entete).get("categorie_banque", 0.0)


def _ecarter_les_sous_categories(
    profils: list[_Profil], lignes: list[tuple], scores: dict[int, dict[str, float]]
) -> None:
    """Retire « catégorie » à la colonne qui n'en détaille qu'une autre.

    Deux colonnes de classement (« Catégorie », « Sous-catégorie ») ont la même forme : peu de valeurs,
    très répétées. Ce qui les distingue est une DÉPENDANCE : chaque sous-catégorie ne s'écrit que sous
    une catégorie, jamais sous deux. Quand B dépend ainsi de A et en a davantage de valeurs, B est
    le détail de A, et c'est A que l'application doit lire. B garde « ne pas importer » en premier.

    L'INTITULÉ PASSE AVANT LA DÉPENDANCE quand il tranche : une colonne qui s'appelle « Category » (ou
    « Catégorie », « Categoria »…) n'est jamais le détail d'une colonne qui ne porte pas un nom de
    catégorie (« Type » : chaque catégorie ne s'écrit que sous une dépense ou une entrée, et c'est
    pourtant la catégorie), ni d'une colonne dont l'intitulé dit qu'elle est elle-même un détail."""
    classantes = [
        p for p in profils
        if scores.get(p.index, {}).get("categorie_banque", 0.0) >= 0.2 and p.distinctes >= 2
    ]
    for a in classantes:
        for b in classantes:
            if a.index == b.index or b.distinctes <= a.distinctes:
                continue
            nomme_categorie = _poids_entete_categorie(b) >= SCORE_SYNONYME and not _entete_de_detail(b)
            if nomme_categorie and (_entete_de_detail(a) or _poids_entete_categorie(a) < SCORE_SYNONYME):
                continue
            sous = {}
            for ligne in lignes:
                va = ligne[a.index - 1] if a.index <= len(ligne) else None
                vb = ligne[b.index - 1] if b.index <= len(ligne) else None
                if va in (None, "") or vb in (None, ""):
                    continue
                sous.setdefault(str(vb).strip(), set()).add(str(va).strip())
            if sous and all(len(parents) == 1 for parents in sous.values()):
                s = scores[b.index]
                s["categorie_banque"] = round(s["categorie_banque"] * 0.3, 3)
                s[""] = max(s.get("", 0.0), s["categorie_banque"] + 0.2)


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


def _sans_dates_ni_nombres(p: _Profil) -> bool:
    """Du texte au sens large : « OUT » a la forme d'un code de devise (trois majuscules), et n'en est pas
    moins un mot d'un vocabulaire - ce que `_est_du_texte`, qui écarte les devises, ne dirait pas."""
    return bool(p.remplies) and p.part(p.dates) < 0.5 and p.part(p.nombres) < 0.5


def _vocabulaire_ferme(p: _Profil) -> bool:
    """Du texte, répété, d'une poignée de valeurs : ce qu'est un sens ou un état (IN / OUT,
    COMPLETED / CANCELLED), jamais un libellé."""
    return (
        p.remplies >= _LIGNES_CONSTANTE_MIN
        and 2 <= p.distinctes <= _VALEURS_FERMEES_MAX
        and _sans_dates_ni_nombres(p)
        and p.distinctes / p.remplies <= 0.5
    )


def _valeurs_distinctes(p: _Profil, operations: list[tuple]) -> Optional[list[dict]]:
    """Les valeurs distinctes d'une colonne de texte, lues sur TOUTES les opérations (un « REFUNDED »
    au bout de dix mille lignes doit se voir), avec ce que l'application en pense : de quoi dire à
    quoi correspond chaque mot d'une colonne « Sens » ou « État ». None quand la colonne n'est pas du
    texte ou en a trop pour être un vocabulaire."""
    if not p.remplies or not _sans_dates_ni_nombres(p) or p.distinctes > _VALEURS_OFFERTES_MAX:
        return None
    j = p.index - 1
    groupes: dict[str, dict] = {}
    for ligne in operations:
        cellule = ligne[j] if j < len(ligne) else None
        texte = "" if cellule is None else str(cellule).strip()
        if not texte:
            continue
        # « Out » et « OUT » ne font qu'un mot pour l'application (cf. normaliser_libelle).
        cle = normaliser_libelle(texte)
        groupe = groupes.get(cle)
        if groupe is None:
            if len(groupes) >= _VALEURS_OFFERTES_MAX:
                return None
            groupe = groupes[cle] = {
                "valeur": texte,
                "nombre": 0,
                "sens": _proposition_de_valeur(cle, _PROPOSITIONS_SENS),
                "statut": _proposition_de_valeur(cle, _PROPOSITIONS_STATUT),
            }
        groupe["nombre"] += 1
    return sorted(groupes.values(), key=lambda g: (-g["nombre"], g["valeur"]))


# LE COUPLE « MONTANT ENVOYÉ / MONTANT REÇU » SE RECONNAÎT À SES DEVISES. Un relevé qui garde les deux
# côtés d'une opération (Wise, Revolut…) porte deux colonnes de montants presque toujours égales -
# l'argent qui part et l'argent qui arrive valent la même somme quand il n'y a pas de change - et deux
# colonnes de devises. L'indice qui ne trompe pas : les montants DIFFÈRENT sur les lignes mêmes où les
# devises diffèrent. Deux colonnes de montants égales sauf sur quelques lignes, qui divergent aux
# endroits où deux colonnes de devises divergent, ne sont pas un montant et son doublon : ce sont l'envoyé
# et le reçu.
_PART_MONTANTS_EGAUX = 0.5
_ACCORD_DIFFERENCES = 0.8
_PART_REMPLIE_MONTANT = 0.9


def _paire_montants_devises(
    profils: list[_Profil],
    donnees: list[tuple],
    decimal,
    milliers,
    colonne_solde: Optional[int],
) -> Optional[dict]:
    """{"initial", "recu", "monnaie_initiale", "monnaie"} (numéros de colonne) quand le fichier a ce
    couple de montants et de devises, ou None."""
    n = len(donnees)
    if n < _LIGNES_CONSTANTE_MIN:
        return None

    def lire(p: _Profil, convertir):
        j = p.index - 1
        return [convertir(ligne[j]) if j < len(ligne) else None for ligne in donnees]

    def ignore_par_entete(p: _Profil) -> bool:
        entete = scores_proprietes(p.entete)
        return entete.get("", 0.0) >= SCORE_MOT_CLE or entete.get("frais", 0.0) >= SCORE_MOT_CLE

    montants = {
        p.index: lire(p, lambda c: centimes(c, decimal, milliers) if c not in (None, "") else None)
        for p in profils
        if _a_forme_de_montant(p)
        and p.index != colonne_solde
        and p.remplies / n >= _PART_REMPLIE_MONTANT
        and sum(p.vides_ou_zero) / n <= 0.5
        and not ignore_par_entete(p)
    }
    devises = {
        p.index: lire(p, lambda c: str(c).strip() if c not in (None, "") else None)
        for p in profils
        if p.remplies and p.part(p.devises) >= 0.8
        and scores_proprietes(p.entete).get("monnaie_frais", 0.0) < SCORE_MOT_CLE
    }
    if len(montants) < 2 or len(devises) < 2:
        return None

    def ecarts(a: list, b: list) -> Optional[tuple[set, int]]:
        """(les rangs où les deux colonnes diffèrent, combien de lignes elles ont en commun), ou
        None si elles se recouvrent trop peu."""
        communs = [i for i in range(n) if a[i] is not None and b[i] is not None]
        if len(communs) < _PART_REMPLIE_MONTANT * n:
            return None
        return {i for i in communs if a[i] != b[i]}, len(communs)

    meilleure = None
    for ia in sorted(montants):
        for ib in sorted(montants):
            if ib <= ia:
                continue
            res = ecarts(montants[ia], montants[ib])
            if res is None:
                continue
            diff_montants, communs = res
            # « Très souvent égales mais différentes sur certaines lignes ».
            if not diff_montants or communs - len(diff_montants) < _PART_MONTANTS_EGAUX * communs:
                continue
            for ca in sorted(devises):
                for cb in sorted(devises):
                    if cb <= ca:
                        continue
                    res_d = ecarts(devises[ca], devises[cb])
                    if res_d is None:
                        continue
                    diff_devises = res_d[0]
                    if not diff_devises:
                        continue
                    accord = len(diff_montants & diff_devises) / len(diff_montants | diff_devises)
                    if accord < _ACCORD_DIFFERENCES:
                        continue
                    # La paire de devises la plus proche des montants l'emporte.
                    proximite = abs(ca - ia) + abs(cb - ib)
                    candidate = (accord, -proximite)
                    if meilleure is None or candidate > meilleure[0]:
                        meilleure = (candidate, ia, ib, ca, cb)
    if meilleure is None:
        return None
    _, ia, ib, ca, cb = meilleure

    par_index = {p.index: p for p in profils}

    def groupe(index: int) -> str:
        return groupe_principal(par_index[index].entete)

    # L'ENVOYÉ EST CELUI QUE L'INTITULÉ DIT, à défaut le premier du fichier (l'ordre de tous les relevés
    # connus : ce qui part, puis ce qui arrive).
    initial, recu = ia, ib
    if groupe(ia) in ("recu", "montant") or groupe(ib) in ("envoye", "montant_initial"):
        initial, recu = ib, ia
    monnaie_initiale, monnaie = ca, cb
    if groupe(ca) == "devise" or groupe(cb) == "monnaie_initiale":
        monnaie_initiale, monnaie = cb, ca
    elif initial > recu and groupe(ca) != "monnaie_initiale":
        monnaie_initiale, monnaie = cb, ca
    return {
        "initial": initial,
        "recu": recu,
        "monnaie_initiale": monnaie_initiale,
        "monnaie": monnaie,
    }


# LE RAFFINAGE GLOBAL (`_raffiner`). L'attribution ne regarde que des scores de colonne : elle ne
# sait pas qu'un champ n'a été proposé qu'à deux colonnes et qu'aucune ne l'a pris. Les champs
# qu'une colonne ignorée pourrait porter, et qu'on lit sur le plus clair des relevés.
_RAFFINABLES = ("categorie_banque",)
# Sous ce score, un champ n'est pas une piste : il ne remonte pas.
_PLANCHER_RAFFINAGE = 0.2
# Une colonne « riche » est remplie sur au moins la moitié des lignes : une colonne ignorée qui porte
# du contenu est le signe d'un champ qu'on n'a pas su placer, une colonne presque vide non.
_REMPLISSAGE_RICHE = 0.5
# L'écart qui met un champ remonté juste au-dessus de « ne pas importer ».
_ECART_RAFFINAGE = 0.05


def _est_du_texte(p: _Profil) -> bool:
    """Ni des dates, ni des nombres, ni des devises : le contenu d'une colonne qu'on pourrait lire
    comme un classement."""
    return (
        bool(p.remplies)
        and p.part(p.dates) < 0.5
        and p.part(p.nombres) < 0.5
        and p.part(p.devises) < 0.5
    )


def _raffiner(
    scores: dict[int, dict[str, float]],
    retenue: dict[int, str],
    verrous: dict[int, str],
    profils: list[_Profil],
    nb_lignes: int,
) -> set[int]:
    """Deuxième regard, sur les attributions une fois faites. Rend les colonnes dont un champ a
    été remonté en tête ET sans concurrente (c'est alors une proposition forte).

    LE RAISONNEMENT : un champ que personne n'a retenu (la catégorie de la banque) mais que
    quelques colonnes ignorées proposaient encore en bas de molette a de bonnes chances d'être
    porté par l'une d'elles - sans quoi ces colonnes de texte ne diraient rien. On choisit donc
    la colonne qui le propose le mieux (à égalité la première), et :
      - si elle est RICHE, le champ passe devant « ne pas importer » ;
      - sinon (colonne presque vide) il remonte seulement, juste derrière.
    Seules des colonnes en « ne pas importer » sont touchées : ce que l'attribution a donné à un
    champ, et ce qu'un test ou une banque connue a verrouillé, ne bouge pas. Les autres colonnes
    qui proposaient le champ le gardent où il est. MODIFIE `scores` et `retenue`."""
    par_index = {p.index: p for p in profils}
    forts: set[int] = set()
    remontees: set[int] = set()
    for propriete in _RAFFINABLES:
        if propriete in retenue.values():
            continue
        candidates = [
            i for i, choix in retenue.items()
            if choix == "" and i not in verrous and i not in remontees
            and scores.get(i, {}).get("", 0.0) < _IGNORE_SUR
            and scores.get(i, {}).get(propriete, 0.0) >= _PLANCHER_RAFFINAGE
            and _est_du_texte(par_index[i])
        ]
        if not candidates:
            continue
        gagnante = max(candidates, key=lambda i: (scores[i][propriete], -i))
        s = scores[gagnante]
        remontees.add(gagnante)
        riche = nb_lignes and par_index[gagnante].remplies / nb_lignes >= _REMPLISSAGE_RICHE
        if riche:
            s[propriete] = round(max(s[propriete], s.get("", 0.0) + _ECART_RAFFINAGE), 3)
            retenue[gagnante] = propriete
            if len(candidates) == 1:
                forts.add(gagnante)
        else:
            # Juste derrière « ne pas importer », et devant les autres lectures.
            autres = max((v for k, v in s.items() if k not in ("", propriete)), default=0.0)
            plafond = s.get("", 0.0) - 0.01
            s[propriete] = round(min(plafond, max(s[propriete], autres + 0.01)), 3)
    return forts


def _paire_avec_ne_pas_importer(propositions: list[dict]) -> bool:
    """Deux propositions dont l'une est « ne pas importer », ou trois qui commencent par elle : la
    première est alors une lecture à prendre ou à laisser, et l'écran la montre comme forte."""
    proprietes = [p["propriete"] for p in propositions]
    if None not in proprietes:
        return False
    return len(proprietes) == 2 or (len(proprietes) == 3 and proprietes[0] is None)


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

    # LE TEST DU SOLDE d'abord : il dit quelle colonne est un solde, donc laquelle n'est PAS un
    # montant (cf. plus bas pour ce qu'il impose).
    solde = controler_solde(operations, decimal, milliers, _ordre_des_dates(operations, format_date))
    colonne_solde = solde.colonne if solde else None
    # LES COLONNES QUI ONT LA FORME D'UN MONTANT, hors solde et hors ce que l'intitulé range parmi
    # ce qui ne s'importe pas : s'il n'y en a qu'une, c'est LE montant.
    colonnes_montant = [
        p.index
        for p in profils
        if _a_forme_de_montant(p)
        and p.index != colonne_solde
        and scores_proprietes(p.entete).get("", 0.0) < SCORE_MOT_CLE
    ]

    scores: dict[int, dict[str, float]] = {}
    entetes: dict[int, dict[str, float]] = {}
    presque_vides: list[int] = []
    for p in profils:
        entete = scores_proprietes(p.entete)
        entetes[p.index] = entete
        forme = _scores_forme(p, montant_unique=colonnes_montant == [p.index])
        s: dict[str, float] = {}
        # Une colonne de quelques valeurs répétées dont l'intitulé est un vrai « sens » ou « état ».
        vocabulaire_libre = _vocabulaire_ferme(p) and normaliser_entete(p.entete) not in _ENTETES_VAGUES
        for propriete in _proprietes_connues():
            valeur = forme.get(propriete, 0.0) + entete.get(propriete, 0.0)
            mots_libres = (
                vocabulaire_libre
                and propriete in _PROPRIETES_A_MOTS_LIBRES
                and entete.get(propriete, 0.0) >= SCORE_SYNONYME
            )
            if mots_libres:
                # L'INTITULÉ ET LE FAIT QUE LA COLONNE N'A QUE QUELQUES VALEURS suffisent : à quoi
                # correspond chaque valeur se dit à l'étape « mots-clés » de l'import.
                valeur = max(valeur, entete[propriete] + 0.5)
            # UN INTITULÉ QUE LA FORME CONTREDIT NE COMPTE QUE POUR MOITIÉ :
            # une colonne « Date » remplie de texte n'est pas une date.
            if (
                entete.get(propriete)
                and propriete in _PROPRIETES_A_FORME
                and not forme.get(propriete)
                and not mots_libres
            ):
                valeur *= 0.5
            # UN SENS ne se lit que dans un vocabulaire fermé (« Débit »,
            # « C »…) : une colonne dont presque aucune valeur n'en est
            # (« CARD_PAYMENT », « Presentment ») mettrait chaque ligne en
            # erreur, quel que soit son intitulé (« Type »). Sauf quand l'intitulé
            # dit « Direction » et que la colonne n'a que quelques valeurs : le
            # vocabulaire est alors à dire, pas à deviner (cf. _PROPRIETES_A_MOTS_LIBRES).
            if (
                propriete == "sens"
                and p.remplies
                and p.part(p.mots_sens) < _PART_SENS_MINIMALE
                and not mots_libres
            ):
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
    else:
        # PAS DE COUPLE DÉBIT/CRÉDIT SANS DEUX COLONNES QUI SE PARTAGENT LES LIGNES : quand aucune paire
        # n'est exclusive, « montant au débit » et « montant au crédit » ne sont plus que des lectures
        # tirées de la forme d'un nombre (0,25) - jamais ce qu'un intitulé a dit. Un relevé dont deux
        # montants sont remplis sur toutes les lignes (envoyé et reçu) n'en a pas : les proposer
        # n'apprend rien et pousse à choisir une lecture que le serveur refuserait.
        for index, s in scores.items():
            for propriete in ("montant_debit", "montant_credit"):
                if propriete in s and entetes[index].get(propriete, 0.0) < SCORE_MOT_CLE:
                    del s[propriete]

    # ENVOYÉ / REÇU RECONNU À SES DEVISES (cf. _paire_montants_devises) : proposé avec assurance, et les
    # lectures concurrentes de ces quatre colonnes reculent.
    paire = _paire_montants_devises(profils, donnees, decimal, milliers, colonne_solde)
    if paire:
        for index, propriete in (
            (paire["initial"], "montant_initial"),
            (paire["recu"], "montant"),
            (paire["monnaie_initiale"], "monnaie_initiale"),
            (paire["monnaie"], "monnaie"),
        ):
            s = scores[index]
            for autre in list(s):
                if autre != propriete:
                    s[autre] = round(s[autre] * 0.3, 3)
            s[propriete] = max(s.get(propriete, 0.0), 1.3)

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

    # UNE SOUS-CATÉGORIE N'EST PAS LA CATÉGORIE : de deux colonnes qui classent, celle dont chaque
    # valeur ne figure que sous UNE valeur de l'autre (et qui en a davantage) la détaille.
    _ecarter_les_sous_categories(profils, donnees, scores)

    # LE TEST DU SOLDE, la preuve la plus forte : un solde qui varie
    # exactement du montant net des opérations ne laisse de doute ni sur sa
    # colonne, ni sur la façon de lire les montants, ni sur les signes.
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

    # LE RAFFINAGE GLOBAL : on relit l'ensemble des attributions, une fois faites.
    forts = _raffiner(scores, retenue, verrous, profils, len(donnees))

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
        if certaine:
            propositions = propositions[:1]
        colonnes.append(
            {
                "index": p.index,
                "entete": p.entete,
                "exemples": p.exemples,
                "propositions": propositions,
                "certaine": certaine,
                "forte": certaine or p.index in forts or _paire_avec_ne_pas_importer(propositions),
                # De quoi dire, à l'étape « mots-clés », à quoi correspond chaque valeur si la colonne
                # est lue comme un sens ou un état. None pour tout ce qui n'est pas un petit vocabulaire.
                "valeurs": _valeurs_distinctes(p, operations),
            }
        )

    # « MONTANT ENVOYÉ » ET « MONTANT » VONT PAR PAIRE : l'un ne se lit pas sans l'autre (ce qui part, ce
    # qui arrive). Quand les deux sont retenus et que l'un est proposé avec assurance, l'autre l'est aussi -
    # sans quoi la seconde colonne s'affichait en simple suggestion à côté d'une première en proposition forte.
    initial = next((i for i, prop in retenue.items() if prop == "montant_initial"), None)
    recu = next((i for i, prop in retenue.items() if prop == "montant"), None)
    if initial is not None and recu is not None:
        par_index = {c["index"]: c for c in colonnes}
        if par_index[initial]["forte"] or par_index[recu]["forte"]:
            for index in (initial, recu):
                par_index[index]["forte"] = True

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
                    "forte": True,
                }
            )
            continue
        autres = [
            p
            for p in colonne["propositions"]
            if p["propriete"] is not None and p["propriete"] not in par_index.values()
        ]
        propositions = [{"propriete": None, "confiance": 1.0}] + autres[:2]
        colonnes.append(
            {
                **colonne,
                "propositions": propositions,
                "certaine": False,
                "forte": _paire_avec_ne_pas_importer(propositions),
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
