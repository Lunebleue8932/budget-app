"""Le test du solde : la preuve arithmétique qu'une colonne est un solde, et
de la façon dont le relevé écrit ses montants.

LE PRINCIPE. Si B est une colonne de solde, d'une ligne renseignée à la
suivante il varie exactement du montant net des opérations qui les séparent.
C'est un test sur les VALEURS, indépendant de tout intitulé : il ne se trompe
pas de langue, ne dépend d'aucun dictionnaire, et quand il réussit sur des
dizaines d'intervalles il n'y a plus de doute — c'est la preuve la plus forte
de la détection.

CE QU'ON ESSAIE, pour chaque colonne B candidate :

  - L'ORDRE DU FICHIER : croissant, ou décroissant (on relit alors de bas en
    haut) ;
  - LE MOMENT DU SOLDE : après l'opération de sa ligne, ou avant elle ;
  - LA LECTURE DES MONTANTS, c'est-à-dire comment former le net d'une ligne :
      * une colonne algébrique X : net = ±X ;
      * deux colonnes positives X, Y (débit/crédit, envoyé/reçu) :
        net = −X + Y ou X − Y — ce qui dit laquelle est le débit, sans
        intitulé et sans regarder le signe des cellules ;
      * un montant X et une colonne de sens S (au plus quatre valeurs) :
        chaque valeur de S donne un signe ; on essaie les combinaisons, et
        celle qui tient dit quelle valeur est le débit, sans dictionnaire.

LES INTERVALLES. Une banque ne donne parfois le solde qu'en fin de journée :
entre deux lignes où B est renseigné, Δ = B[suivante] − B[précédente] doit
valoir la SOMME des nets de l'intervalle. Le taux est la part des intervalles
où l'égalité tient (au centime près).

LES SEUILS ET LES GARDE-FOUS :
  - ≥ 90 % sur au moins 10 intervalles : `verifie` (la détection verrouille
    le solde, le mode de lecture et les signes) ;
  - 60 à 90 % : `probable` (un bonus, sans verrou) ;
  - en dessous : rien ;
  - au moins 3 intervalles où le solde BOUGE et où l'égalité tient : un taux
    obtenu sur des Δ nuls ne prouve rien ; une colonne constante non plus.
Pourquoi pas 100 % : lignes sans montant, opérations différées, export
filtré, ordre mêlé dans la journée font baisser le taux sans l'annuler.

UNE SYMÉTRIE QUE LE SOLDE NE TRANCHE PAS. Lire le fichier à l'envers, le
solde AVANT l'opération et tous les signes inversés donne exactement les mêmes
égalités que la lecture droite : débit et crédit s'échangeraient sans qu'aucun
intervalle ne proteste. Ce qui départage vient d'ailleurs — l'ordre des DATES
(`ordre_probable`, lu par l'appelant), puis, à défaut, le solde après
l'opération, de loin le plus courant.

Les montants sont lus en centimes entiers (services/lecture_montants).
"""
from dataclasses import dataclass, field
from itertools import product
from typing import Optional

from .import_bancaire import normaliser_libelle
from .lecture_montants import centimes

# Assez de lignes pour des dizaines d'intervalles, assez peu pour que les
# centaines d'hypothèses se testent vite.
_LIGNES_MAX = 1000
# Un solde donné seulement en fin de journée remplit peu de lignes.
_REMPLISSAGE_SOLDE = 0.05
_PART_NUMERIQUE = 0.8
_PART_SENS = 0.8
_VALEURS_SENS_MAX = 4
_TOLERANCE = 1  # centime
SEUIL_VERIFIE = 0.9
SEUIL_PROBABLE = 0.6
_INTERVALLES_VERIFIE = 10
_INTERVALLES_NON_NULS = 3

ORDRES = ("croissant", "decroissant")
MOMENTS = ("apres", "avant")


@dataclass(frozen=True)
class LectureMontants:
    """Une façon de former le montant net d'une ligne. `colonnes` 1-based."""

    mode: str  # « algebrique », « debit_credit » ou « montant_sens »
    colonnes: tuple
    signes: tuple = ()  # un par colonne pour algebrique et debit_credit
    sens_sortie: tuple = ()  # montant_sens : les valeurs de S lues en débit
    sens_entree: tuple = ()

    @property
    def complexite(self) -> int:
        return {"algebrique": 0, "debit_credit": 1, "montant_sens": 2}[self.mode]

    def en_dict(self) -> dict:
        resultat = {"mode": self.mode, "colonnes": list(self.colonnes)}
        if self.mode == "algebrique":
            # Un relevé qui écrit ses débits en POSITIF : signe inversé.
            resultat["signe_inverse"] = self.signes[0] < 0
        elif self.mode == "debit_credit":
            debit, credit = (
                self.colonnes if self.signes[0] < 0 else tuple(reversed(self.colonnes))
            )
            resultat.update(colonne_debit=debit, colonne_credit=credit)
        else:
            resultat.update(
                colonne_montant=self.colonnes[0],
                colonne_sens=self.colonnes[1],
                sens_sortie=list(self.sens_sortie),
                sens_entree=list(self.sens_entree),
            )
        return resultat


@dataclass
class ResultatSolde:
    colonne: int  # 1-based
    ordre: str
    moment: str
    lecture: LectureMontants
    taux: float
    intervalles: int
    intervalles_non_nuls: int
    statut: str = field(init=False)

    def __post_init__(self):
        if self.taux >= SEUIL_VERIFIE and self.intervalles >= _INTERVALLES_VERIFIE:
            self.statut = "verifie"
        else:
            self.statut = "probable"

    def en_dict(self) -> dict:
        return {
            "colonne": self.colonne,
            "ordre": self.ordre,
            "moment": self.moment,
            "lecture": self.lecture.en_dict(),
            "taux": round(self.taux, 3),
            "intervalles": self.intervalles,
            "statut": self.statut,
        }


def _vide(cellule) -> bool:
    return cellule is None or str(cellule).strip() == ""


def _lectures(valeurs, textes, numeriques, solde) -> list[tuple[LectureMontants, list[int]]]:
    """Toutes les lectures des montants à essayer avec le solde `solde` (une
    colonne, 0-based), chacune avec le net de chaque ligne en centimes."""
    autres = [j for j in numeriques if j != solde]
    lectures = []
    for j in autres:
        for signe in (1, -1):
            nets = [signe * (v or 0) for v in valeurs[j]]
            lectures.append((LectureMontants("algebrique", (j + 1,), (signe,)), nets))
    for i, a in enumerate(autres):
        for b in autres[i + 1:]:
            for signes in ((-1, 1), (1, -1)):
                nets = [
                    signes[0] * abs(x or 0) + signes[1] * abs(y or 0)
                    for x, y in zip(valeurs[a], valeurs[b])
                ]
                lectures.append((LectureMontants("debit_credit", (a + 1, b + 1), signes), nets))
    n = len(valeurs[0]) if valeurs else 0
    for s, colonne in enumerate(textes):
        remplies = [t for t in colonne if t]
        distinctes = sorted(set(remplies))
        if (
            not n
            or len(remplies) < _PART_SENS * n
            or not 2 <= len(distinctes) <= _VALEURS_SENS_MAX
        ):
            continue
        for j in autres:
            if j == s:
                continue
            for signes in product((1, -1), repeat=len(distinctes)):
                if len(set(signes)) == 1:
                    continue
                signe_de = dict(zip(distinctes, signes))
                nets = [
                    signe_de.get(t, 0) * abs(v or 0) for v, t in zip(valeurs[j], colonne)
                ]
                lectures.append((
                    LectureMontants(
                        "montant_sens",
                        (j + 1, s + 1),
                        sens_sortie=tuple(v for v in distinctes if signe_de[v] < 0),
                        sens_entree=tuple(v for v in distinctes if signe_de[v] > 0),
                    ),
                    nets,
                ))
    return lectures


def _essayer(soldes: list, nets: list[int], moment: str) -> tuple[int, int, int]:
    """(intervalles, égalités, égalités où le solde bouge), lignes dans l'ordre
    chronologique."""
    cumul = [0]
    for net in nets:
        cumul.append(cumul[-1] + net)
    renseignes = [i for i, b in enumerate(soldes) if b is not None]
    intervalles = egalites = non_nulles = 0
    for p, q in zip(renseignes, renseignes[1:]):
        delta = soldes[q] - soldes[p]
        somme = cumul[q + 1] - cumul[p + 1] if moment == "apres" else cumul[q] - cumul[p]
        intervalles += 1
        if abs(delta - somme) <= _TOLERANCE:
            egalites += 1
            if delta:
                non_nulles += 1
    return intervalles, egalites, non_nulles


def controler_solde(
    lignes: list[tuple],
    separateur_decimal=None,
    separateur_milliers=None,
    ordre_probable: Optional[str] = None,
) -> Optional[ResultatSolde]:
    """Le meilleur couple (colonne de solde, lecture des montants) que le
    fichier vérifie, ou None. `lignes` : les opérations seules, sans en-tête
    ni pied, dans l'ordre du fichier. `ordre_probable` : l'ordre que disent les
    dates, pour la symétrie que le solde ne tranche pas (cf. plus haut)."""
    lignes = lignes[:_LIGNES_MAX]
    n = len(lignes)
    if n < 4:
        return None
    largeur = max(len(l) for l in lignes)
    cellules = [[l[j] if j < len(l) else None for l in lignes] for j in range(largeur)]
    valeurs = [
        [None if _vide(c) else centimes(c, separateur_decimal, separateur_milliers) for c in colonne]
        for colonne in cellules
    ]
    numeriques = []
    for j, colonne in enumerate(cellules):
        remplies = sum(not _vide(c) for c in colonne)
        nombres = sum(v is not None for v in valeurs[j])
        if remplies and nombres >= _PART_NUMERIQUE * remplies:
            numeriques.append(j)
    textes = [
        [] if j in numeriques else ["" if _vide(c) else normaliser_libelle(str(c)) for c in colonne]
        for j, colonne in enumerate(cellules)
    ]

    candidats = [
        j for j in numeriques
        if sum(v is not None for v in valeurs[j]) >= max(3, _REMPLISSAGE_SOLDE * n)
        and len({v for v in valeurs[j] if v is not None}) > 2
    ]
    meilleur, cle_meilleure = None, None
    for solde in candidats:
        for lecture, nets in _lectures(valeurs, textes, numeriques, solde):
            for ordre in ORDRES:
                soldes = valeurs[solde] if ordre == "croissant" else valeurs[solde][::-1]
                chrono = nets if ordre == "croissant" else nets[::-1]
                for moment in MOMENTS:
                    intervalles, egalites, non_nulles = _essayer(soldes, chrono, moment)
                    if not intervalles or non_nulles < _INTERVALLES_NON_NULS:
                        continue
                    taux = egalites / intervalles
                    if taux < SEUIL_PROBABLE:
                        continue
                    # Le meilleur taux ; à égalité, le plus d'intervalles
                    # probants, l'ordre des dates, le solde après
                    # l'opération, puis la lecture la plus simple.
                    cle = (
                        taux,
                        non_nulles,
                        ordre == ordre_probable,
                        moment == "apres",
                        -lecture.complexite,
                    )
                    if cle_meilleure is None or cle > cle_meilleure:
                        cle_meilleure = cle
                        meilleur = ResultatSolde(
                            solde + 1, ordre, moment, lecture, taux, intervalles, non_nulles
                        )
    return meilleur
