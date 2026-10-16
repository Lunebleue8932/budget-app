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
from dataclasses import dataclass, field
from typing import Optional

from ..constants import (
    LIBELLES_SENS_ENTREE,
    LIBELLES_SENS_SORTIE,
    LIBELLES_STATUT_DEFAUT,
)
from .entetes import SCORE_SYNONYME, dictionnaire, groupe_principal, scores_proprietes
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


def _ligne_des_intitules(lignes: list[tuple]) -> Optional[int]:
    """L'indice de la ligne d'intitulés, ou None si le fichier n'en a pas.

    C'est la ligne, parmi les premières, dont le plus de cellules sont des
    intitulés CONNUS EN ENTIER (exacts ou synonymes du dictionnaire) — au moins
    deux, pour qu'une ligne de titre (« Relevé de compte ») ne passe pas pour
    une ligne d'intitulés."""
    meilleure, meilleur_score = None, 1
    for i, ligne in enumerate(lignes[:_TETE_MAX]):
        score = 0
        for cellule in ligne:
            if cellule in (None, ""):
                continue
            if max(scores_proprietes(cellule).values(), default=0.0) >= SCORE_SYNONYME:
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


def _profiler(
    lignes_donnees: list[tuple],
    entetes: list,
    separateur_decimal=None,
    separateur_milliers=None,
    format_date=None,
) -> list[_Profil]:
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
            montant = centimes(cellule, separateur_decimal, separateur_milliers) if texte else None
            profil.vides_ou_zero.append(not texte or montant == 0)
            if not texte:
                continue
            profil.remplies += 1
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
                entete_b = scores_proprietes(b.entete)
                if entete_b.get("montant_debit", 0.0) > entete_b.get("montant_credit", 0.0):
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
    profils = _profiler(donnees, entetes, decimal, milliers, format_date)

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
            if valeur > 0.05:
                s[propriete] = round(min(valeur, 1.6), 3)
        # « Solde », « Référence » : ne s'importent pas, et le dire est une
        # réponse — sans quoi un solde courant passerait pour un montant. Le
        # dictionnaire les range PARMI CE QUI NE S'IMPORTE PAS, et c'est retenu
        # quand il le dit au moins aussi sûrement qu'il nomme une propriété.
        ignore = entete.get("", 0.0)
        reconnue = max((v for k, v in entete.items() if k), default=0.0)
        a_ignorer = ignore > 0 and ignore >= reconnue
        if a_ignorer or (not p.remplies):
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

    # L'ORDRE DU FICHIER, lu sur la colonne retenue pour la date.
    colonne_date = next((index for index, prop in retenue.items() if prop == "date"), None)
    ordre = None
    if colonne_date is not None:
        ordre = ordre_dates(
            lire_date(l[colonne_date - 1], format_date) if colonne_date <= len(l) else None
            for l in operations
        )

    return {
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
        "colonnes": colonnes,
        "configuration": [
            {"index": index, "propriete": prop} for index, prop in sorted(retenue.items()) if prop
        ],
    }


def detecter_fichier(
    contenu: bytes,
    delimiteur: Optional[str] = None,
    feuille: Optional[str] = None,
    separateur_decimal: Optional[str] = None,
) -> dict:
    """`detecter_colonnes` sur un fichier entier : ce qu'elle rend, plus ce
    que la lecture a appris (cf. services/lecture_fichier) — format, encodage,
    délimiteur, feuilles d'un classeur et celle qui est proposée."""
    lecture = lire_fichier(contenu, delimiteur, feuille)
    resultat = detecter_colonnes(lecture.lignes, separateur_decimal)
    resultat.update(
        format=lecture.format,
        encodage=lecture.encodage,
        separateur=lecture.separateur,
        feuilles=lecture.feuilles,
        feuille=lecture.feuille,
        feuille_proposee=lecture.feuille_proposee,
    )
    return resultat
