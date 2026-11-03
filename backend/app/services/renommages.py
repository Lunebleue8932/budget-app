"""Les renommages : un libellé de relevé, et le nom qu'on lui donne (extension « Renommages »).

LE MOTEUR VIT ICI, DANS LE NOYAU, comme celui des règles : c'est l'import qui l'appelle pendant qu'il
lit une ligne. Ce que l'extension apporte, c'est la page qui liste les renommages et les routes qui
les écrivent — éteinte, l'import cesse de les consulter (cf. `actif`), et la table reste intacte.

TROIS GESTES :

  - ENREGISTRER (`enregistrer`) : une opération renommée, une ligne retouchée dans le récapitulatif
    d'un import, une suggestion acceptée ou une entrée écrite à la main laissent la même trace — le
    libellé d'origine, et le nouveau nom. Une seule entrée par libellé (cf. `cle`).
  - RECONNAÎTRE À L'IDENTIQUE (`nouveau_nom`) : « aux espaces, aux accents et à la casse près ». C'est
    ce qui renomme d'office à l'import, sans rien demander.
  - PROPOSER (`suggerer`) : un libellé qu'aucune entrée ne reconnaît à l'identique mais qui RESSEMBLE à
    l'une d'elles. L'app ne renomme jamais d'elle-même sur une ressemblance : elle propose, et c'est
    l'acceptation qui crée l'entrée.

POURQUOI PLUSIEURS OUTILS DE RECONNAISSANCE. Un libellé de relevé est un libellé de banque : « CB
CARREFOUR MARKET 12/04 », « PAIEMENT CB CARREFOUR MARKET PARIS 75 », « Carrefour Market ». Une seule
mesure de ressemblance se trompe dans un sens ou dans l'autre — les ratios de caractères rapprochent
« NETFLIX.COM » de « NETFLIX » mais ignorent que « CB » et une date n'ont rien à dire ; la comparaison
de mots l'ignore, mais rate une faute de frappe. Chaque outil a donc sa mesure et son seuil, et on garde
la meilleure proposition — en disant QUEL outil l'a faite, pour que l'écran puisse l'expliquer.
"""
import re
import unicodedata
from datetime import datetime
from difflib import SequenceMatcher
from typing import NamedTuple, Optional

from .. import extensions, models

#: L'identifiant (nom de dossier) de l'extension.
EXTENSION_RENOMMAGES = "renommages"


def actif() -> bool:
    """L'extension tourne-t-elle ? Éteinte, l'import ne renomme ni ne propose rien."""
    return extensions.est_active(EXTENSION_RENOMMAGES)


def cle(texte: Optional[str]) -> str:
    """Le libellé sans accents, sans espaces et sans casse : ce qui identifie un renommage.

    Même écriture que `import_bancaire.normaliser_libelle` (« CB  Café » et « cb cafe » sont le même
    libellé), recopiée ici parce que l'import importe ce module et non l'inverse."""
    sans_accents = "".join(
        c for c in unicodedata.normalize("NFD", texte or "") if unicodedata.category(c) != "Mn"
    )
    return "".join(sans_accents.split()).casefold()


# ---------- Lire ----------


class Entree(NamedTuple):
    """Un renommage, tel que l'import le lit (pas l'objet de la session : il peut en survivre)."""

    id: int
    cle: str
    nom_origine: str
    nom_nouveau: str


def charger(db) -> dict:
    """{cle: Entree} — chargé UNE fois par fichier importé, comme les règles. Vide si l'extension
    est éteinte : tout le reste de la résolution s'écrit sans se demander si elle est là."""
    if not actif():
        return {}
    return {
        r.cle: Entree(r.id, r.cle, r.nom_origine, r.nom_nouveau)
        for r in db.query(models.Renommage).all()
    }


def nouveau_nom(index: dict, libelle: Optional[str]) -> Optional[Entree]:
    """L'entrée qui reconnaît ce libellé À L'IDENTIQUE (aux espaces, accents et casse près)."""
    if not index or not libelle:
        return None
    return index.get(cle(libelle))


# ---------- Écrire ----------


def enregistrer(
    db,
    ancien: Optional[str],
    nouveau: Optional[str],
    origine: str = "manuel",
    valider: bool = True,
):
    """Note qu'on a renommé `ancien` en `nouveau`. Rend l'entrée, ou None quand il n'y a rien à noter.

    NE FAIT RIEN SI L'EXTENSION EST ÉTEINTE : les appelants (la mise à jour d'une opération, la
    confirmation d'un import) n'ont pas à le savoir.

    UNE ENTRÉE PAR LIBELLÉ : renommer de nouveau le même libellé remplace le nom, et l'origine suit.

    LES CHAÎNES SE RACCOURCISSENT. Si « A » devient « B » puis qu'on renomme « B » en « C », l'entrée
    « A -> B » devient « A -> C » : le prochain relevé qui dit « A » doit arriver à « C », pas
    s'arrêter à un nom qu'on a abandonné. Et rendre à « B » son nom d'origine « A » défait l'entrée,
    plutôt que de laisser « A -> A »."""
    ancien = (ancien or "").strip()
    nouveau = (nouveau or "").strip()
    if not ancien or not nouveau or ancien == nouveau or not actif():
        return None

    cle_ancien = cle(ancien)
    entree = db.query(models.Renommage).filter(models.Renommage.cle == cle_ancien).one_or_none()
    if entree is None:
        entree = models.Renommage(cle=cle_ancien, nom_origine=ancien, cree_le=datetime.now())
        db.add(entree)
    entree.nom_nouveau = nouveau
    entree.origine = origine

    # Les entrées qui aboutissaient à `ancien` aboutissent désormais à `nouveau`.
    for autre in db.query(models.Renommage).all():
        if autre is entree or cle(autre.nom_nouveau) != cle_ancien:
            continue
        autre.nom_nouveau = nouveau
        # « A -> B » puis « B -> A » : l'entrée n'a plus rien à dire.
        if autre.nom_origine == nouveau:
            _supprimer(db, autre)
    # Ce libellé est tranché : il n'a plus rien à attendre dans les points à trancher.
    db.query(models.RenommageATrancher).filter(models.RenommageATrancher.cle == cle_ancien).delete()
    if valider:
        db.commit()
        db.refresh(entree)
    else:
        # Dans la transaction de l'appelant (la mise à jour d'une opération) : c'est son commit
        # qui écrira l'entrée, avec le reste.
        db.flush()
    return entree


def oublier(db, libelle: Optional[str]) -> bool:
    """Retire l'entrée de ce libellé (on lui a rendu son nom d'origine). Rend True si elle existait."""
    if not actif():
        return False
    entree = db.query(models.Renommage).filter(models.Renommage.cle == cle(libelle)).one_or_none()
    if entree is None:
        return False
    _supprimer(db, entree)
    db.commit()
    return True


def operations_portant(db, libelle: Optional[str]) -> list:
    """Les opérations dont le nom est ce libellé « aux espaces, accents et casse près » : celles
    que l'import renommerait d'office, donc celles qu'un nouveau renommage peut rattraper."""
    k = cle(libelle)
    if not k:
        return []
    return [
        operation
        for operation in db.query(models.Operation).all()
        if cle(operation.nature) == k
    ]


def appliquer_aux_operations(db, entree) -> int:
    """Renomme, dans la base, les opérations qui portent le libellé d'origine de cette entrée.
    Rend leur nombre. Celles qui portent déjà le nouveau nom, à l'identique, ne comptent pas.

    Ne passe pas par `enregistrer` : l'entrée existe, et renommer une opération ici ne doit pas
    en créer une seconde ni raccourcir une chaîne qui a déjà été arrangée."""
    nombre = 0
    for operation in operations_portant(db, entree.nom_origine):
        if operation.nature != entree.nom_nouveau:
            operation.nature = entree.nom_nouveau
            nombre += 1
    if nombre:
        db.commit()
    return nombre


def _supprimer(db, entree) -> None:
    """Retire une entrée, et avec elle les points à trancher qui s'y rapportaient (sans elles, ils
    n'auraient plus de nom à proposer)."""
    db.query(models.RenommageATrancher).filter(
        models.RenommageATrancher.entree_id == entree.id
    ).delete()
    db.delete(entree)


# ---------- Proposer ----------

#: Mots d'un libellé de banque qui ne disent rien du commerçant : le moyen de paiement, le type de
#: mouvement. Écartés avant de comparer les mots, sans quoi tout « CB … » ressemblerait à tout « CB … ».
MOTS_SANS_SENS = frozenset(
    {
        "cb", "carte", "paiement", "achat", "prlv", "prelevement", "vir", "virement", "sepa", "retrait",
        "dab", "facture", "fact", "pmt", "payment", "purchase", "debit", "credit", "ref", "de", "du", "la",
        "le", "les", "des", "et", "sas", "sarl", "eur", "com", "www", "fr",
    }
)

#: Seuils, un par outil. Assez hauts pour que ce que l'on propose soit presque toujours juste : une
#: proposition fausse fait perdre à l'utilisateur plus que ce qu'une proposition manquée ne lui coûte.
SEUIL_INCLUSION = 0.9
SEUIL_MOTS = 0.6
SEUIL_CARACTERES = 0.84
SEUIL_PREFIXE = 0.88

LONGUEUR_MINIMALE_INCLUSION = 5


class Suggestion(NamedTuple):
    libelle: str
    entree: Entree
    score: float
    #: « inclusion », « mots », « caracteres » ou « prefixe » : l'outil qui a fait la proposition.
    outil: str


def _mots(libelle: str) -> list[str]:
    """Les mots qui portent le sens d'un libellé : minuscules sans accents, sans chiffres seuls, sans
    mots de moyen de paiement."""
    sans_accents = "".join(
        c for c in unicodedata.normalize("NFD", libelle or "") if unicodedata.category(c) != "Mn"
    ).casefold()
    return [
        m
        for m in re.findall(r"[a-z0-9]+", sans_accents)
        if not m.isdigit() and m not in MOTS_SANS_SENS and len(m) > 1
    ]


def _mesure(libelle: str, entree: Entree) -> Optional[tuple[float, str]]:
    """La meilleure ressemblance entre un libellé et l'écriture d'origine d'une entrée, et l'outil
    qui la donne — ou None si aucun outil n'atteint son seuil."""
    a, b = cle(libelle), entree.cle
    if not a or not b or a == b:
        return None
    candidates: list[tuple[float, str]] = []

    # 1. INCLUSION : l'un contient l'autre (« CB NETFLIX.COM 0412 » contient « NETFLIX »). Seulement
    #    si le plus court est assez long pour ne pas se retrouver partout.
    court, long_ = (a, b) if len(a) <= len(b) else (b, a)
    if len(court) >= LONGUEUR_MINIMALE_INCLUSION and court in long_:
        candidates.append((SEUIL_INCLUSION + (1 - SEUIL_INCLUSION) * len(court) / len(long_), "inclusion"))

    # 2. MOTS : les mêmes mots utiles, dans n'importe quel ordre, sans le bruit (dates, « CB », codes).
    mots_a, mots_b = set(_mots(libelle)), set(_mots(entree.nom_origine))
    if mots_a and mots_b:
        commun = mots_a & mots_b
        union = mots_a | mots_b
        if commun and any(len(m) >= 4 for m in commun):
            jaccard = len(commun) / len(union)
            if jaccard >= SEUIL_MOTS:
                candidates.append((jaccard, "mots"))

    # 3. CARACTÈRES : une faute de frappe, un caractère de plus ou de moins.
    comparateur = SequenceMatcher(None, a, b)
    # Les deux bornes rapides écartent d'emblée l'immense majorité des couples sans rapport.
    if (
        comparateur.real_quick_ratio() >= SEUIL_CARACTERES
        and comparateur.quick_ratio() >= SEUIL_CARACTERES
    ):
        ratio = comparateur.ratio()
        if ratio >= SEUIL_CARACTERES:
            candidates.append((ratio, "caracteres"))

    # 4. PRÉFIXE COMMUN : un libellé tronqué par la banque (« NETFLIX.CO »).
    commun_debut = 0
    for x, y in zip(a, b):
        if x != y:
            break
        commun_debut += 1
    if commun_debut >= 6 and commun_debut / min(len(a), len(b)) >= SEUIL_PREFIXE:
        candidates.append((commun_debut / max(len(a), len(b)), "prefixe"))

    return max(candidates) if candidates else None


def suggerer(index: dict, libelles) -> dict:
    """{libelle: Suggestion} — pour chaque libellé que l'index ne reconnaît pas à l'identique, la
    meilleure entrée qui lui ressemble, s'il y en a une. À l'égalité, l'entrée la plus ancienne."""
    resultat: dict = {}
    if not index:
        return resultat
    entrees = sorted(index.values(), key=lambda e: e.id)
    for libelle in dict.fromkeys(l for l in libelles if l):
        if cle(libelle) in index:
            continue
        meilleure: Optional[Suggestion] = None
        for entree in entrees:
            mesure = _mesure(libelle, entree)
            if mesure and (meilleure is None or mesure[0] > meilleure.score):
                meilleure = Suggestion(libelle, entree, round(mesure[0], 3), mesure[1])
        if meilleure is not None:
            resultat[libelle] = meilleure
    return resultat


# ---------- À trancher ----------


def noter_a_trancher(db, index: dict, libelle: Optional[str]):
    """Note, pour la page des renommages, qu'un libellé du relevé RESSEMBLE à une entrée sans lui
    être identique. Rend la ligne notée, ou None (extension éteinte, libellé déjà connu à l'identique,
    aucune ressemblance, ou déjà noté — en attente comme refusé : on ne repose pas ce qu'on a refusé).

    L'import n'en fait rien d'autre : il ne renomme pas, ne demande rien, ne montre rien."""
    if not actif() or not libelle or not index:
        return None
    k = cle(libelle)
    if k in index:
        return None
    if db.query(models.RenommageATrancher).filter(models.RenommageATrancher.cle == k).first():
        return None
    trouvee = suggerer(index, [libelle]).get(libelle)
    if trouvee is None:
        return None
    ligne = models.RenommageATrancher(
        cle=k,
        libelle=libelle.strip(),
        entree_id=trouvee.entree.id,
        score=trouvee.score,
        outil=trouvee.outil,
        vu_le=datetime.now(),
    )
    db.add(ligne)
    db.commit()
    return ligne


def accepter(db, a_trancher_id: int):
    """Accepte un point à trancher : le libellé reçoit le nom actuel de l'entrée voisine, et l'entrée
    qui en résulte vit comme les autres. Rend l'entrée créée, ou None si le point n'existe plus."""
    point = db.get(models.RenommageATrancher, a_trancher_id)
    if point is None:
        return None
    voisine = db.get(models.Renommage, point.entree_id)
    if voisine is None:
        db.delete(point)
        db.commit()
        return None
    return enregistrer(db, point.libelle, voisine.nom_nouveau, "suggestion")


def refuser(db, a_trancher_id: int) -> bool:
    """Refuse un point à trancher : la ligne reste, marquée, pour que l'import ne le repose plus."""
    point = db.get(models.RenommageATrancher, a_trancher_id)
    if point is None:
        return False
    point.refuse = True
    db.commit()
    return True
