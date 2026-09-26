"""Deviner, dans un relevé qu'on n'a jamais vu, quelle colonne dit quoi.

POURQUOI. Régler un preset, c'est dire pour chaque propriété de l'import
(date, libellé, montant…) dans quelle colonne du fichier elle se trouve. Pour
un relevé ordinaire, la réponse se lit dans le fichier lui-même : la ligne des
intitulés dit « Date », « Libellé », « Montant », et les cellules en dessous
ont la forme d'une date, d'un texte, d'un nombre. Demander de recopier ces
numéros à la main était la première marche de l'import, et la plus haute.

DEUX INDICES, ET ILS SE CROISENT :

  - L'INTITULÉ de la colonne, quand le fichier en a un (`_MOTS_CLES`, en
    français et en anglais). C'est le plus sûr : une banque qui écrit « Débit »
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
"""
from dataclasses import dataclass, field
from typing import Optional

from ..constants import (
    LIBELLES_SENS_ENTREE,
    LIBELLES_SENS_SORTIE,
    LIBELLES_STATUT_DEFAUT,
)
from .import_bancaire import normaliser_libelle, parser_date, parser_montant

# Combien de lignes de données on examine : assez pour qu'une colonne rare ne
# passe pas pour vide, assez peu pour qu'un relevé de dix ans se lise vite.
_ECHANTILLON = 200
# Jusqu'où on cherche la ligne des intitulés (cf. MAX_LIGNES_ENTETE).
_TETE_MAX = 20

# LES INTITULÉS RECONNUS, par propriété, déjà normalisés (minuscules, sans
# accents ni espaces — cf. normaliser_libelle). Un intitulé reconnu vaut un
# indice fort ; il est comparé EN ENTIER, puis comme morceau (« dateoperation »
# contient « date »), le second valant moins.
_MOTS_CLES: dict[str, tuple[str, ...]] = {
    "date": ("date", "dateoperation", "datedoperation", "datecomptable", "bookingdate",
             "transactiondate", "jour", "createdon", "completeddate"),
    "nature": ("libelle", "libelleoperation", "nature", "description", "intitule",
               "label", "details", "detail", "designation", "communication", "motif",
               "merchant", "beneficiaire", "payee", "reference"),
    "categorie_banque": ("categorie", "category", "souscategorie", "rubrique",
                         "typedoperation", "typeoperation"),
    "montant": ("montant", "amount", "somme", "valeur", "montanteur", "net"),
    "montant_debit": ("debit", "montantdebit", "debiteur", "sortie", "sorties",
                      "withdrawal", "withdrawals", "moneyout", "paidout"),
    "montant_credit": ("credit", "montantcredit", "crediteur", "entree", "entrees",
                       "deposit", "deposits", "moneyin", "paidin"),
    "sens": ("sens", "debitcredit", "dc", "direction", "type"),
    "monnaie": ("devise", "monnaie", "currency", "ccy", "targetcurrency"),
    "compte_banque": ("compte", "account", "numerodecompte", "iban", "accountname"),
    "statut": ("etat", "statut", "status", "state"),
    "frais": ("frais", "fee", "fees", "commission", "totalfees"),
    "montant_initial": ("montantenvoye", "envoye", "sourceamount", "amountsent", "sent"),
    "monnaie_initiale": ("deviseenvoyee", "monnaieenvoyee", "sourcecurrency"),
    "monnaie_frais": ("devisedesfrais", "devisefrais", "feecurrency"),
}
# Ce qui ne s'importe jamais, et qu'on reconnaît pour le dire plutôt que de le
# prendre pour un montant : un solde courant est un nombre sur chaque ligne.
_A_IGNORER = ("solde", "soldeapres", "balance", "runningbalance", "numero",
              "reference", "id", "transactionid", "cheque", "numerodecheque")

# Un intitulé qui CONTIENT l'un de ces mots ne s'importe pas non plus :
# « Solde après opération », « Running balance ».
_A_IGNORER_MORCEAUX = ("solde", "balance")

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

    def part(self, compte: int) -> float:
        return compte / self.remplies if self.remplies else 0.0


def _est_devise(texte: str) -> bool:
    return (len(texte) == 3 and texte.isalpha() and texte.isupper()) or texte in {
        "€", "$", "£", "¥", "CHF",
    }


def _score_entete(entete_norm: str, propriete: str) -> float:
    """1 si l'intitulé EST un des mots de la propriété, 0,6 s'il en contient
    un (un mot d'au moins quatre lettres : « dc » contenu dans n'importe quoi
    ne veut rien dire), 0 sinon."""
    if not entete_norm:
        return 0.0
    mots = _MOTS_CLES.get(propriete, ())
    if entete_norm in mots:
        return 1.0
    if any(len(mot) >= 4 and mot in entete_norm for mot in mots):
        return 0.6
    return 0.0


def _ligne_des_intitules(lignes: list[tuple]) -> Optional[int]:
    """L'indice de la ligne d'intitulés, ou None si le fichier n'en a pas.

    C'est la ligne, parmi les premières, dont le plus de cellules sont des
    intitulés CONNUS — au moins deux, pour qu'une ligne de titre (« Relevé de
    compte ») ne passe pas pour une ligne d'intitulés."""
    meilleure, meilleur_score = None, 1
    for i, ligne in enumerate(lignes[:_TETE_MAX]):
        score = 0
        for cellule in ligne:
            norm = normaliser_libelle(str(cellule)) if cellule not in (None, "") else ""
            if norm and (
                any(_score_entete(norm, p) >= 1.0 for p in _MOTS_CLES) or norm in _A_IGNORER
            ):
                score += 1
        if score > meilleur_score:
            meilleure, meilleur_score = i, score
    return meilleure


def _premiere_ligne_de_donnees(lignes: list[tuple]) -> int:
    """Sans intitulés : la première ligne qui porte une date."""
    for i, ligne in enumerate(lignes[:_TETE_MAX]):
        if any(parser_date(c) is not None for c in ligne if c not in (None, "")):
            return i
    return 0


def _profiler(lignes_donnees: list[tuple], entetes: list, separateur_decimal) -> list[_Profil]:
    largeur = max([len(l) for l in lignes_donnees] + [len(entetes)] + [0])
    profils = [_Profil(index=j + 1, entete=str(entetes[j]).strip() if j < len(entetes) and entetes[j] is not None else "")
               for j in range(largeur)]
    valeurs: list[set] = [set() for _ in range(largeur)]
    longueurs: list[int] = [0] * largeur
    for ligne in lignes_donnees:
        for j in range(largeur):
            cellule = ligne[j] if j < len(ligne) else None
            texte = "" if cellule is None else str(cellule).strip()
            profil = profils[j]
            montant = parser_montant(cellule, separateur_decimal) if texte else None
            profil.vides_ou_zero.append(not texte or montant == 0)
            if not texte:
                continue
            profil.remplies += 1
            valeurs[j].add(texte)
            longueurs[j] += len(texte)
            if len(profil.exemples) < 3 and texte not in profil.exemples:
                profil.exemples.append(texte)
            if parser_date(cellule) is not None:
                profil.dates += 1
            elif montant is not None:
                profil.nombres += 1
                if montant < 0:
                    profil.negatifs += 1
                # Un montant a des centimes ; un numéro de référence non.
                if isinstance(cellule, float) and not cellule.is_integer():
                    profil.decimales += 1
                elif any(sep in texte for sep in (",", ".")):
                    profil.decimales += 1
            if _est_devise(texte):
                profil.devises += 1
            norm = normaliser_libelle(texte)
            if norm in _MOTS_SENS:
                profil.mots_sens += 1
            if norm in _MOTS_STATUT:
                profil.mots_statut += 1
    for j, profil in enumerate(profils):
        profil.distinctes = len(valeurs[j])
        profil.longueur_moyenne = longueurs[j] / profil.remplies if profil.remplies else 0.0
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
        if p.distinctes <= max(12, p.remplies // 3):
            s["categorie_banque"] = 0.45 if ratio < 0.5 else 0.25
            s["compte_banque"] = 0.2 if p.distinctes <= 5 else 0.05
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
            if exclusives and couvrantes and a.remplies and b.remplies:
                norm_b = normaliser_libelle(b.entete)
                if _score_entete(norm_b, "montant_debit") > _score_entete(norm_b, "montant_credit"):
                    return b, a
                return a, b
    return None


def detecter_colonnes(
    lignes: list[tuple], separateur_decimal: Optional[str] = None
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
    donnees = [l for l in lignes[debut:] if any(c not in (None, "") for c in l)][:_ECHANTILLON]
    profils = _profiler(donnees, entetes, separateur_decimal)

    scores: dict[int, dict[str, float]] = {}
    for p in profils:
        norm = normaliser_libelle(p.entete)
        forme = _scores_forme(p)
        s: dict[str, float] = {}
        for propriete in _MOTS_CLES:
            valeur = forme.get(propriete, 0.0) + _score_entete(norm, propriete)
            # UN INTITULÉ QUE LA FORME CONTREDIT NE COMPTE QUE POUR MOITIÉ :
            # une colonne « Date » remplie de texte n'est pas une date.
            if (
                _score_entete(norm, propriete)
                and propriete in _PROPRIETES_A_FORME
                and not forme.get(propriete)
            ):
                valeur *= 0.5
            if valeur > 0.05:
                s[propriete] = round(min(valeur, 1.6), 3)
        # « Solde », « Référence » : ne s'importent pas, et le dire est une
        # réponse — sans quoi un solde courant passerait pour un montant.
        a_ignorer = norm in _A_IGNORER or any(m in norm for m in _A_IGNORER_MORCEAUX)
        if a_ignorer or (not p.remplies):
            s = {k: v * 0.3 for k, v in s.items()}
            s[""] = 1.2 if a_ignorer else 0.9
        # UNE COLONNE PRESQUE VIDE (moins d'une ligne sur trois) n'est le plus
        # souvent rien qu'on veuille lire : « ne pas importer » est proposé en
        # premier, les autres lectures restent offertes.
        elif donnees and p.remplies / len(donnees) < 0.34:
            s[""] = max(s.values(), default=0) + 0.1
        scores[p.index] = s


    # LE MONTANT SCINDÉ PRIME sur deux montants concurrents : c'est la seule
    # lecture qui rende compte des deux colonnes à la fois.
    scinde = _debit_credit(profils)
    if scinde:
        debit, credit = scinde
        scores[debit.index]["montant_debit"] = max(scores[debit.index].get("montant_debit", 0), 1.1)
        scores[credit.index]["montant_credit"] = max(scores[credit.index].get("montant_credit", 0), 1.1)

    # L'ATTRIBUTION : du plus sûr au moins sûr, une propriété par colonne et
    # une colonne par propriété. Le montant et le couple débit/crédit
    # s'excluent (cf. constants.PROPRIETES_MONTANT_SCINDE).
    candidats = sorted(
        ((v, index, prop) for index, s in scores.items() for prop, v in s.items()),
        reverse=True,
    )
    retenue: dict[int, str] = {}
    prises: set[str] = set()
    for valeur, index, prop in candidats:
        if index in retenue or valeur < 0.35:
            continue
        if prop and prop in prises:
            continue
        if prop == "montant" and prises & {"montant_debit", "montant_credit"}:
            continue
        if prop in ("montant_debit", "montant_credit") and "montant" in prises:
            continue
        retenue[index] = prop
        if prop:
            prises.add(prop)

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
        certaine = premier >= 1.0 and premier - second >= 0.4
        colonnes.append(
            {
                "index": p.index,
                "entete": p.entete,
                "exemples": p.exemples,
                "propositions": propositions if not certaine else propositions[:1],
                "certaine": certaine,
            }
        )

    return {
        # En lignes PHYSIQUES, vides comprises : c'est ce que compte
        # ImportPreset.lignes_entete, et ce qu'Excel numérote.
        "lignes_entete": debut,
        "colonnes": colonnes,
        "configuration": [
            {"index": index, "propriete": prop} for index, prop in sorted(retenue.items()) if prop
        ],
    }
