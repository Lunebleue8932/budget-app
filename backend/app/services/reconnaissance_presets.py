"""Reconnaître, à l'ouverture d'un fichier, le preset qui sait le lire.

POURQUOI. Un preset par banque, quatre comptes dans quatre banques : ouvrir le
relevé de la banque B avec le preset de la banque A sélectionné donne un
aperçu tout en erreur, et rien ne dit que c'est le preset qui ne va pas. Or
chaque preset a déjà lu des fichiers de sa banque : il sait à quoi ils
ressemblent.

CE QUI EST COMPARÉ, pour CHAQUE preset, du plus fort au plus faible :

  1. LA LECTURE DU FICHIER avec ce preset (`validite`) : la part des lignes
     dont la date se lit et dont le montant est un nombre, et la cohérence du
     mode de lecture des montants (`mode_compatible`) — un preset débit/crédit
     devant un fichier dont l'une des deux colonnes n'est pas numérique ne
     peut pas convenir. C'est le seul test qui DÉCIDE qu'un preset ne passe
     pas ;
  2. LES INTITULÉS de la ligne d'en-tête, à la même position et en ensemble
     (Jaccard), comparés à ceux que le preset a mémorisés ;
  3. LE NOMBRE DE COLONNES ;
  4. LE NOM DU FICHIER, réduit à sa forme (« releve_<DATE>.csv ») : un indice
     faible, qui départage et ne décide jamais seul.

CE QUI EST PROPOSÉ (`Reconnaissance.decision`) — JAMAIS DE BASCULE SILENCIEUSE :

  - `appliquer` : le preset sélectionné lit le fichier et en reconnaît les
    intitulés (ou n'en a encore mémorisé aucun) ; rien à dire ;
  - `ecarts` : il le lit, mais les intitulés ont bougé (une colonne en plus, un
    intitulé renommé) ; on applique et on montre les écarts ;
  - `basculer` : un autre preset fait nettement mieux — il passe là où le
    sélectionné échoue, ou reconnaît exactement les intitulés là où le
    sélectionné n'y parvient pas. L'écran demande ;
  - `aucun` : aucun preset ne lit ce fichier ; c'est le moment de la détection
    des colonnes, puis d'un nouveau preset.

UN PRESET SANS SIGNATURE (antérieur à la migration 0085, jamais réutilisé
depuis) n'est jamais écarté pour cela : il est jugé sur la lecture seule.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from datetime import date
from difflib import SequenceMatcher
from typing import Optional

from .entetes import normaliser_entete
from .import_bancaire import (
    format_date_du_fichier,
    normaliser_libelle,
    parser_date,
    parser_montant,
    vocabulaire_sens,
)

# Assez de lignes pour qu'un taux de lecture veuille dire quelque chose, assez
# peu pour que comparer dix presets reste instantané.
_ECHANTILLON = 200
# UN PRESET QUI LIT LE FICHIER en lit au moins neuf lignes sur dix : la marge
# couvre une ligne de total, un solde reporté, une opération sans montant.
SEUIL_VALIDITE = 0.9
# À partir de combien de lignes une seule illisible est tolérée.
_LIGNES_TOLERANCE = 4
# Une colonne de montant est faite de nombres, à quelques cellules près.
_PART_NUMERIQUE = 0.8
# Débit et crédit remplis sur la même ligne : rare, jamais la règle.
_PART_DOUBLE_REMPLISSAGE = 0.05


# ---------- Le nom du fichier ----------

_EXTENSION = re.compile(r"\.([A-Za-z0-9]{1,5})$")
_DATE_HEURE_COLLEES = re.compile(r"(?<!\d)(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(?!\d)")
_DATE_AMJ = re.compile(r"(?<!\d)(\d{4})([-_.]?)(\d{2})\2(\d{2})(?!\d)")
_DATE_JMA = re.compile(r"(?<!\d)(\d{2})([-_.]?)(\d{2})\2(\d{4})(?!\d)")
_HEURE = re.compile(r"(?<!\d)(\d{2})([-_.:hH]?)(\d{2})\2(\d{2})(?!\d)")


def _date_valide(annee: str, mois: str, jour: str) -> bool:
    try:
        return 1990 <= int(annee) <= 2099 and bool(date(int(annee), int(mois), int(jour)))
    except ValueError:
        return False


def _heure_valide(h: str, m: str, s: str) -> bool:
    return int(h) < 24 and int(m) < 60 and int(s) < 60


def motif_nom_fichier(nom: Optional[str]) -> Optional[str]:
    """« Releve_20261015_143205.CSV » → « releve_<DATE>_<HEURE>.csv ».

    Les dates et heures deviennent des jetons, les autres chiffres des « 9 »,
    le texte reste tel quel (en minuscules) : c'est la PARTIE FIXE du nom, celle
    qui dit la banque. None pour un nom vide."""
    if not nom:
        return None
    nom = nom.replace("\\", "/").rsplit("/", 1)[-1].strip()
    extension = ""
    trouvee = _EXTENSION.search(nom)
    if trouvee:
        extension, nom = "." + trouvee.group(1).lower(), nom[: trouvee.start()]

    def remplacer(motif, valide, jeton):
        def _sub(m):
            return jeton if valide(m) else m.group(0)
        return lambda texte: motif.sub(_sub, texte)

    etapes = (
        remplacer(
            _DATE_HEURE_COLLEES,
            lambda m: _date_valide(m[1], m[2], m[3]) and _heure_valide(m[4], m[5], m[6]),
            "<DATE><HEURE>",
        ),
        remplacer(_DATE_AMJ, lambda m: _date_valide(m[1], m[3], m[4]), "<DATE>"),
        remplacer(_DATE_JMA, lambda m: _date_valide(m[4], m[3], m[1]), "<DATE>"),
        remplacer(_HEURE, lambda m: _heure_valide(m[1], m[3], m[4]), "<HEURE>"),
    )
    for etape in etapes:
        nom = etape(nom)
    # Les jetons sont protégés de la suite : ni chiffres ni minuscules à réécrire.
    morceaux = re.split(r"(<DATE>|<HEURE>)", nom)
    nom = "".join(
        m if m in ("<DATE>", "<HEURE>") else re.sub(r"\d", "9", m.lower()) for m in morceaux
    )
    return nom + extension


def _forme(motif: str) -> str:
    """Le motif sans son texte : seuls restent la longueur et les types de
    caractères. Deux exports de la même banque dont le préfixe change d'une
    version à l'autre gardent la même forme."""
    morceaux = re.split(r"(<DATE>|<HEURE>)", motif)
    return "".join(m if m in ("<DATE>", "<HEURE>") else re.sub(r"[^\W\d_]", "a", m) for m in morceaux)


def comparer_motifs(memorise: Optional[str], observe: Optional[str]) -> Optional[float]:
    """1 : même motif ; 0,6 : même forme ; jusqu'à 0,4 : proche, même
    extension ; 0 sinon. None quand l'un des deux manque — un indice absent ne
    pèse ni pour ni contre."""
    if not memorise or not observe:
        return None
    if memorise == observe:
        return 1.0
    if _forme(memorise) == _forme(observe):
        return 0.6
    ext_a, ext_b = memorise.rsplit(".", 1)[-1], observe.rsplit(".", 1)[-1]
    proche = SequenceMatcher(None, memorise, observe).ratio()
    return round(0.4 * proche, 3) if ext_a == ext_b and proche >= 0.6 else 0.0


# ---------- Les intitulés et la largeur ----------


def _vide(cellule) -> bool:
    return cellule is None or str(cellule).strip() == ""


def _rogner(ligne) -> list:
    """La ligne sans ses cellules vides de fin : un xlsx remplit jusqu'à la
    dernière colonne utilisée du classeur, un CSV pas."""
    cellules = list(ligne)
    while cellules and _vide(cellules[-1]):
        cellules.pop()
    return cellules


def _donnees(lignes: list[tuple], lignes_entete: int, lignes_pied: int = 0) -> list[tuple]:
    """Les opérations : sans les lignes de tête, ni les lignes de pied (un
    total, un solde final) que le preset sait écarter — sur un relevé de trois
    opérations, une ligne de total suffirait à le faire échouer sur son propre
    fichier."""
    remplies = [l for l in lignes[lignes_entete:] if any(not _vide(c) for c in l)]
    if lignes_pied:
        remplies = remplies[:-lignes_pied]
    return remplies[:_ECHANTILLON]


@dataclass
class SignatureFichier:
    # Les intitulés BRUTS, tels que le fichier les écrit : on normalise au
    # moment de comparer, si bien qu'une normalisation qui s'améliore profite
    # aussi aux signatures déjà mémorisées.
    entetes: list[str]
    nombre_colonnes: int


def signature_fichier(lignes: list[tuple], lignes_entete: int) -> SignatureFichier:
    entetes: list[str] = []
    if 1 <= lignes_entete <= len(lignes):
        entetes = ["" if _vide(c) else str(c).strip() for c in _rogner(lignes[lignes_entete - 1])]
    largeur = max((len(_rogner(l)) for l in _donnees(lignes, lignes_entete)), default=0)
    return SignatureFichier(entetes, max(largeur, len(entetes)))


def comparer_entetes(memorises: list[str], observes: list[str]) -> tuple[float, float]:
    """(part des positions identiques, Jaccard des ensembles), après
    normalisation. La première dit « rien n'a bougé », la seconde « les mêmes
    colonnes, peut-être dans un autre ordre »."""
    a = [normaliser_entete(e) for e in memorises]
    b = [normaliser_entete(e) for e in observes]
    largeur = max(len(a), len(b))
    if not largeur:
        return 1.0, 1.0
    positions = sum(1 for i in range(min(len(a), len(b))) if a[i] and a[i] == b[i])
    ensemble_a, ensemble_b = {e for e in a if e}, {e for e in b if e}
    union = ensemble_a | ensemble_b
    jaccard = len(ensemble_a & ensemble_b) / len(union) if union else 1.0
    return positions / largeur, jaccard


def ecarts_entetes(memorises: list[str], observes: list[str]) -> list[dict]:
    """Les colonnes dont l'intitulé a changé depuis la dernière lecture, pour
    les montrer : {index (1-based), avant, maintenant}. Un côté vide = colonne
    apparue ou disparue."""
    ecarts = []
    for i in range(max(len(memorises), len(observes))):
        avant = memorises[i] if i < len(memorises) else ""
        maintenant = observes[i] if i < len(observes) else ""
        if normaliser_entete(avant) != normaliser_entete(maintenant):
            ecarts.append({"index": i + 1, "avant": avant, "maintenant": maintenant})
    return ecarts


# ---------- La lecture du fichier par un preset ----------


def _cellule(ligne, index: Optional[int]):
    if index is None or index < 1 or index > len(ligne):
        return None
    return ligne[index - 1]


def _numerique_ou_vide(donnees: list[tuple], index: int, separateur_decimal) -> bool:
    """Une colonne de nombres, ou VIDE — mais présente : un fichier qui n'a
    pas de quatrième colonne n'a pas de crédit vide, il n'a pas de crédit."""
    if not any(len(l) >= index for l in donnees):
        return False
    remplies = [c for c in (_cellule(l, index) for l in donnees) if not _vide(c)]
    return not remplies or _part_numerique(donnees, index, separateur_decimal) >= _PART_NUMERIQUE


def _part_numerique(donnees: list[tuple], index: int, separateur_decimal) -> float:
    remplies = [c for c in (_cellule(l, index) for l in donnees) if not _vide(c)]
    if not remplies:
        return 0.0
    return sum(parser_montant(c, separateur_decimal) is not None for c in remplies) / len(remplies)


@dataclass
class Lecture:
    validite: float
    mode_compatible: bool
    lignes: int


def lire_avec_preset(
    preset, lignes: list[tuple], separateur_decimal=None, format_date=None
) -> Lecture:
    """Ce que donne le fichier lu avec ce preset : la part des lignes dont la
    date se lit et dont le montant est un nombre, et si le MODE de lecture des
    montants du preset a un sens sur ce fichier. Les dates se lisent dans
    l'ordre que l'aperçu retiendrait (cf. import_bancaire.
    format_date_du_fichier), sauf ordre imposé à la main."""
    index = {c["propriete"]: c["index"] for c in (preset.colonnes or []) if c.get("propriete")}
    donnees = _donnees(lignes, preset.lignes_entete or 0, getattr(preset, "lignes_pied", 0) or 0)
    if not donnees or "date" not in index:
        return Lecture(0.0, False, len(donnees))
    # UN PRESET QUI COMMENCE TROP TARD : sa ligne d'intitulés est en fait
    # une opération (une date, un montant). Il « lit » le reste du fichier,
    # mais en sautant des opérations, sans que rien ne le dise.
    entete = preset.lignes_entete or 0
    if 1 <= entete <= len(lignes):
        ligne_entete = lignes[entete - 1]
        if parser_date(_cellule(ligne_entete, index["date"])) is not None:
            return Lecture(0.0, False, len(donnees))
    format_date = format_date or format_date_du_fichier(
        lignes, preset.colonnes, preset.lignes_entete or 0
    )
    scinde = "montant_debit" in index and "montant_credit" in index
    sortie, entree = vocabulaire_sens(preset)

    lisibles = 0
    doubles = 0
    for ligne in donnees:
        if parser_date(_cellule(ligne, index["date"]), format_date) is None:
            continue
        if scinde:
            debit = parser_montant(_cellule(ligne, index["montant_debit"]), separateur_decimal)
            credit = parser_montant(_cellule(ligne, index["montant_credit"]), separateur_decimal)
            # Un zéro vaut une case vide (cf. import_bancaire._montant_scinde).
            debit, credit = debit or None, credit or None
            if debit is not None and credit is not None:
                doubles += 1
                continue
            if debit is None and credit is None:
                continue
        else:
            montant = parser_montant(_cellule(ligne, index.get("montant")), separateur_decimal)
            if montant is None:
                continue
            if "sens" in index:
                sens = normaliser_libelle(str(_cellule(ligne, index["sens"]) or ""))
                if sens not in sortie | entree:
                    continue
        lisibles += 1

    if scinde:
        # UNE COLONNE VIDE ne contredit rien : un relevé du mois sans rentrée
        # n'a pas un crédit, et reste lisible par le preset débit/crédit.
        compatible = (
            _numerique_ou_vide(donnees, index["montant_debit"], separateur_decimal)
            and _numerique_ou_vide(donnees, index["montant_credit"], separateur_decimal)
            and doubles / len(donnees) <= _PART_DOUBLE_REMPLISSAGE
        )
    else:
        compatible = (
            "montant" in index
            and _part_numerique(donnees, index["montant"], separateur_decimal) >= _PART_NUMERIQUE
        )
    # LE LIBELLÉ EST DU TEXTE : un preset qui le lirait dans une colonne de
    # dates ou de nombres (la date de valeur, le solde) « lit » bien le fichier
    # — dates et montants se lisent — mais pas ce relevé-ci.
    if compatible and "nature" in index:
        libelles = [c for c in (_cellule(l, index["nature"]) for l in donnees) if not _vide(c)]
        chiffres = sum(
            parser_date(c, format_date) is not None or parser_montant(c, separateur_decimal) is not None
            for c in libelles
        )
        compatible = not libelles or chiffres / len(libelles) < 0.5
    return Lecture(round(lisibles / len(donnees), 3), compatible, len(donnees))


# ---------- Le score et la décision ----------


@dataclass
class Ajustement:
    preset_id: int
    nom: str
    validite: float
    mode_compatible: bool
    lignes: int = 0
    # None : le preset n'a encore rien mémorisé de ce côté-là.
    entetes: Optional[float] = None
    entetes_identiques: Optional[bool] = None
    colonnes_identiques: Optional[bool] = None
    nom_fichier: Optional[float] = None
    ecarts: list[dict] = field(default_factory=list)

    @property
    def passe(self) -> bool:
        """Le preset lit le fichier : neuf lignes sur dix — ou, sur un petit
        fichier, toutes sauf une (une opération en attente sans date suffirait
        sinon à faire échouer un relevé de six lignes)."""
        if not self.mode_compatible:
            return False
        illisibles = round((1 - self.validite) * self.lignes)
        return self.validite >= SEUIL_VALIDITE or (
            self.lignes >= _LIGNES_TOLERANCE and illisibles <= 1
        )

    def cle_de_tri(self) -> tuple:
        """La hiérarchie des preuves, dans l'ordre : la lecture d'abord, les
        intitulés ensuite, la largeur, et le nom du fichier pour départager."""
        return (
            self.passe,
            -1.0 if self.entetes is None else self.entetes,
            bool(self.colonnes_identiques),
            self.validite,
            self.nom_fichier or 0.0,
        )

    def en_dict(self) -> dict:
        return {
            "preset_id": self.preset_id,
            "nom": self.nom,
            "validite": self.validite,
            "mode_compatible": self.mode_compatible,
            "entetes": self.entetes,
            "entetes_identiques": self.entetes_identiques,
            "colonnes_identiques": self.colonnes_identiques,
            "nom_fichier": self.nom_fichier,
            "passe": self.passe,
        }


def ajuster(
    preset,
    lignes: list[tuple],
    nom_fichier: Optional[str] = None,
    motif_par_defaut: Optional[str] = None,
    separateur_decimal=None,
    format_date=None,
) -> Ajustement:
    """Le score d'un preset devant un fichier. `motif_par_defaut` : le motif à
    supposer quand le preset n'en a pas mémorisé (celui du dernier fichier
    importé sous ce preset, cf. crud.get_dernier_nom_fichier)."""
    lecture = lire_avec_preset(preset, lignes, separateur_decimal, format_date)
    resultat = Ajustement(
        preset.id, preset.nom, lecture.validite, lecture.mode_compatible, lecture.lignes
    )
    observee = signature_fichier(lignes, preset.lignes_entete or 0)
    if preset.signature_entetes is not None:
        memorises = list(preset.signature_entetes)
        if memorises or observee.entetes:
            positions, jaccard = comparer_entetes(memorises, observee.entetes)
            resultat.entetes = round((positions + jaccard) / 2, 3)
            resultat.entetes_identiques = positions == 1.0
            resultat.ecarts = ecarts_entetes(memorises, observee.entetes)
        else:
            # Un format sans intitulés, et ce fichier n'en a pas non plus : rien
            # à comparer, rien qui contredise.
            resultat.entetes_identiques = True
    if preset.nombre_colonnes is not None:
        resultat.colonnes_identiques = preset.nombre_colonnes == observee.nombre_colonnes
    resultat.nom_fichier = comparer_motifs(
        preset.motif_nom_fichier or motif_par_defaut, motif_nom_fichier(nom_fichier)
    )
    return resultat


@dataclass
class Reconnaissance:
    decision: str  # appliquer | ecarts | basculer | aucun
    preset_selectionne: Optional[int]
    propose: Optional[Ajustement] = None
    ecarts: list[dict] = field(default_factory=list)
    ajustements: list[Ajustement] = field(default_factory=list)

    def en_dict(self) -> dict:
        return {
            "decision": self.decision,
            "preset_selectionne": self.preset_selectionne,
            "propose": self.propose.en_dict() if self.propose else None,
            "ecarts": self.ecarts,
            "ajustements": [a.en_dict() for a in self.ajustements],
        }


def _reconnait(a: Ajustement) -> bool:
    """Le preset reconnaît exactement ce fichier : il le lit, et ses intitulés
    sont ceux qu'il a mémorisés (ou il n'en a mémorisé aucun)."""
    return a.passe and a.entetes_identiques is not False and a.colonnes_identiques is not False


def reconnaitre(ajustements: list[Ajustement], preset_selectionne: Optional[int]) -> Reconnaissance:
    classes = sorted(ajustements, key=lambda a: a.cle_de_tri(), reverse=True)
    selectionne = next((a for a in ajustements if a.preset_id == preset_selectionne), None)
    autres = [a for a in classes if a.preset_id != preset_selectionne]
    resultat = Reconnaissance("aucun", preset_selectionne, ajustements=classes)

    # UN AUTRE PRESET FAIT NETTEMENT MIEUX : il reconnaît exactement le fichier
    # là où le sélectionné n'y parvient pas, ou il le LIT là où le sélectionné
    # échoue. Dans ce second cas, des intitulés peu ressemblants n'y changent
    # rien : une preuve faible ne contredit pas une lecture réussie. Ils
    # classent seulement les candidats entre eux, et le pourcentage affiché
    # le dit.
    meilleur = next((a for a in autres if a.passe), None)
    selection_reconnait = selectionne is not None and _reconnait(selectionne)
    selection_passe = selectionne is not None and selectionne.passe
    if meilleur and not selection_reconnait and (
        not selection_passe or (_reconnait(meilleur) and meilleur.entetes_identiques)
    ):
        resultat.decision, resultat.propose = "basculer", meilleur
        return resultat

    if selection_reconnait:
        resultat.decision = "appliquer"
    elif selection_passe:
        resultat.decision, resultat.ecarts = "ecarts", selectionne.ecarts
    return resultat


def memoriser_signature(preset, lignes: list[tuple], nom_fichier: Optional[str], ecraser: bool) -> bool:
    """Retient la signature du fichier sur le preset. `ecraser` faux : seulement
    ce qui manque (première réutilisation d'un preset ancien) ; vrai : tout
    (la configuration vient d'être enregistrée sur CE fichier). Rend vrai si
    quelque chose a changé ; le commit appartient à l'appelant."""
    signature = signature_fichier(lignes, preset.lignes_entete or 0)
    motif = motif_nom_fichier(nom_fichier)
    change = False
    if ecraser or preset.signature_entetes is None:
        if preset.signature_entetes != signature.entetes:
            preset.signature_entetes, change = signature.entetes, True
    if ecraser or preset.nombre_colonnes is None:
        if preset.nombre_colonnes != signature.nombre_colonnes:
            preset.nombre_colonnes, change = signature.nombre_colonnes, True
    if motif and (ecraser or preset.motif_nom_fichier is None):
        if preset.motif_nom_fichier != motif:
            preset.motif_nom_fichier, change = motif, True
    return change
