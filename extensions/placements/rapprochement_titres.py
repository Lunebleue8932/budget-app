"""Reconnaître, dans un fichier de composition, un titre que l'application connaît déjà sous un AUTRE nom.

LE PROBLÈME. Deux fichiers d'émetteurs nomment la même société à leur façon (« COCA-COLA CO/THE »,
« The Coca-Cola Company », « Coca Cola Co ») et l'un donne l'ISIN, l'autre non (iShares). Le rapprochement
exact (ISIN, puis nom normalisé — cf. services/identite_titre) ne les réunit pas : le second import créait
alors un titre en double, et l'exposition « action par action » comptait deux fois la même société.

LA MÉTHODE : une ressemblance de NOMS, CORRIGÉE PAR D'AUTRES PROPRIÉTÉS.
  1. Les noms sont réduits à leurs mots significatifs (sans « Inc », « Corp », « The », « Class A »…), et
     comparés par recouvrement de mots et par ressemblance de chaînes. Un index par mot écarte d'emblée
     les titres qui n'ont rien en commun : un fichier de mille lignes ne compare pas mille titres à mille.
  2. Le score se corrige avec ce que le fichier dit d'autre : le SECTEUR et la ZONE (le pays) concordent
     avec ceux que le titre porte déjà (+), ou les contredisent (−) ; une DEVISE différente est un indice
     contre ; deux ISIN DIFFÉRENTS sont deux titres, point (aucun rapprochement).
  3. Deux seuils : au-dessus de `SEUIL_ACCEPTE` le rapprochement est proposé COCHÉ ; entre `SEUIL_PROPOSE`
     et lui, il est proposé décoché. L'utilisateur tranche ligne par ligne avant d'écrire quoi que ce soit.

Aucune écriture ici : ce module ne fait que proposer.
"""
import difflib
import re
import unicodedata
from dataclasses import dataclass, field
from typing import Optional

SEUIL_ACCEPTE = 0.80
SEUIL_PROPOSE = 0.62

# Les mots qui ne distinguent pas une société d'une autre dans un libellé de bourse.
_MOTS_VIDES = frozenset(
    """
    the of and et de la le les du des inc incorporated corp corporation co company cie ltd limited plc llc lp
    sa ag nv bv se spa sas sarl asa oyj ab as kk gmbh group groupe holding holdings hldgs intl international
    class cl a b c ord ordinary shs shares share reg registered adr gdr sponsored common stock cap npv new
    ser series pref preferred unit units dr
    """.split()
)
_EXPANSIONS = {"intl": "international", "grp": "group", "technologies": "technology", "tech": "technology"}


def normaliser(texte) -> list[str]:
    """Les mots significatifs d'un libellé, sans casse, accents ni ponctuation."""
    brut = unicodedata.normalize("NFD", str(texte or "").replace("&", " and "))
    brut = "".join(c for c in brut if not unicodedata.combining(c)).lower()
    mots = re.sub(r"[^a-z0-9]+", " ", brut).split()
    mots = [_EXPANSIONS.get(m, m) for m in mots]
    significatifs = [m for m in mots if m not in _MOTS_VIDES and len(m) > 1]
    return significatifs or mots


def score_noms(a, b) -> float:
    """Ressemblance de deux libellés, de 0 à 1."""
    ma, mb = normaliser(a), normaliser(b)
    if not ma or not mb:
        return 0.0
    commun = len(set(ma) & set(mb))
    recouvrement = commun / min(len(set(ma)), len(set(mb)))
    # Les mots qui se ressemblent sans être égaux (« pepsi » / « pepsico ») comptent à moitié.
    souples = sum(
        1 for x in set(ma) - set(mb) if any(len(x) >= 4 and (x.startswith(y) or y.startswith(x)) for y in set(mb) - set(ma))
    )
    recouvrement = min(1.0, (commun + 0.5 * souples) / min(len(set(ma)), len(set(mb))))
    chaines = difflib.SequenceMatcher(None, " ".join(sorted(ma)), " ".join(sorted(mb))).ratio()
    # Un seul mot en commun sur plusieurs ne suffit pas à lui seul à rapprocher (« Bank » de « Bank of X »).
    if commun == 1 and min(len(ma), len(mb)) > 1 and max(len(ma), len(mb)) > 2:
        recouvrement *= 0.8
    return max(chaines, 0.95 * recouvrement)


@dataclass
class Rapprochement:
    titre: object
    score: float
    raisons: list[str] = field(default_factory=list)

    @property
    def accepte(self) -> bool:
        return self.score >= SEUIL_ACCEPTE


class IndexMots:
    """Les titres candidats, indexés par mot significatif de leur nom d'origine."""

    def __init__(self, titres):
        self.par_mot: dict[str, list] = {}
        for titre in titres:
            self.ajouter(titre)

    def ajouter(self, titre) -> None:
        for mot in set(normaliser(titre.nom)):
            self.par_mot.setdefault(mot, []).append(titre)

    def candidats(self, nom) -> list:
        vus: dict[int, object] = {}
        for mot in normaliser(nom):
            for titre in self.par_mot.get(mot, []):
                vus[titre.id] = titre
        return list(vus.values())


def _premiere(titre, axe) -> Optional[str]:
    lignes = titre.repartition(axe)
    return lignes[0].etiquette.nom if lignes else None


def chercher(index: IndexMots, possession, *, secteur_propose, zone_proposee, monnaie_du, cle) -> Optional[Rapprochement]:
    """Le titre connu qui ressemble le plus à cette possession, ou None.

    `secteur_propose` / `zone_proposee` : le nom d'étiquette que l'application déduit du libellé de secteur /
    de pays du fichier (ou None) ; `monnaie_du` : la monnaie de la devise du fichier (ou None) ; `cle` :
    la normalisation d'étiquettes (casse, accents)."""
    meilleur: Optional[Rapprochement] = None
    for titre in index.candidats(possession.nom):
        # Deux ISIN différents sont deux titres : on ne les fond pas.
        if possession.isin and titre.code_isin and possession.isin.upper() != titre.code_isin.upper():
            continue
        score = score_noms(possession.nom, titre.nom)
        if score < SEUIL_PROPOSE - 0.15:
            continue
        raisons = [f"nom ({round(score * 100)} %)"]
        secteur_titre, secteur_fichier = _premiere(titre, "secteur"), secteur_propose
        if secteur_titre and secteur_fichier:
            if cle(secteur_titre) == cle(secteur_fichier):
                score += 0.07
                raisons.append("même secteur")
            else:
                score -= 0.15
                raisons.append("secteur différent")
        zone_titre, zone_fichier = _premiere(titre, "zone"), zone_proposee
        if zone_titre and zone_fichier:
            if cle(zone_titre) == cle(zone_fichier):
                score += 0.05
                raisons.append("même zone")
            else:
                score -= 0.12
                raisons.append("zone différente")
        monnaie = monnaie_du
        if monnaie is not None:
            if monnaie.id == titre.monnaie_id:
                score += 0.02
            else:
                score -= 0.1
                raisons.append("devise différente")
        if possession.isin and titre.code_isin:
            raisons.append("même ISIN")
            score = max(score, 1.0)
        if score >= SEUIL_PROPOSE and (meilleur is None or score > meilleur.score):
            meilleur = Rapprochement(titre, min(score, 1.0), raisons)
    return meilleur


# ---------- Le nettoyage de la base : des titres déjà enregistrés qui se ressemblent ----------


def score_paire(a, b) -> Optional["Rapprochement"]:
    """La ressemblance de DEUX TITRES DE LA BASE (et non d'une ligne de fichier à un titre) : le nom d'origine,
    corrigé par le secteur, la zone, la devise et l'enveloppe que chacun porte. None pour deux titres qui ne
    peuvent pas être le même : deux ISIN différents, un indice et un titre ordinaire."""
    if a.est_indice != b.est_indice:
        return None
    if a.code_isin and b.code_isin and a.code_isin.upper() != b.code_isin.upper():
        return None
    score = score_noms(a.nom, b.nom)
    if score < SEUIL_PROPOSE - 0.15:
        return None
    raisons = [f"nom ({round(score * 100)} %)"]
    for axe, bonus, malus, bien, mal in (
        ("secteur", 0.07, 0.15, "même secteur", "secteur différent"),
        ("zone", 0.05, 0.12, "même zone", "zone différente"),
    ):
        x, y = _premiere(a, axe), _premiere(b, axe)
        if x and y:
            if x.strip().lower() == y.strip().lower():
                score += bonus
                raisons.append(bien)
            else:
                score -= malus
                raisons.append(mal)
    if a.monnaie_id == b.monnaie_id:
        score += 0.02
    else:
        score -= 0.1
        raisons.append("devise différente")
    if a.type_titre_id and b.type_titre_id and a.type_titre_id != b.type_titre_id:
        score -= 0.1
        raisons.append("enveloppe différente")
    if a.code_isin and b.code_isin:
        raisons.append("même ISIN")
        score = max(score, 1.0)
    if score < SEUIL_PROPOSE:
        return None
    return Rapprochement(b, min(score, 1.0), raisons)
