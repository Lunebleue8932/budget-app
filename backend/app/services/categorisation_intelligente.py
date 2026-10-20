"""Proposer la catégorie de l'app qui correspond à une catégorie du relevé.

LE PROBLÈME. Chaque banque nomme ses catégories à sa façon (« Alimentation et restauration »,
« Supermarchés / Bouche », « Food & Dining »), et l'import demandait de les rapprocher à la main,
banque par banque. Ce module propose, l'utilisateur CONFIRME — il n'applique jamais rien tout seul.

CINQ PALIERS, dans cet ordre, et c'est l'ordre qui compte :

  1. LA TABLE SAUVEGARDÉE (`ImportCategorieMapping`, par preset) : si le couple existe, il s'applique,
     sans rien demander. C'est le cas de 100 % des imports suivants. Ce palier n'est PAS ici :
     il vit dans `import_bancaire` (`crud.get_mapping_categorie`) et passe avant tout ce qui suit.
  2. LA NORMALISATION (`normaliser`) : minuscules, sans accents ni ponctuation, espaces
     écrasés. « Alimentation & Restauration » et « alimentation restauration » sont le même mot.
  3. LES ALIAS : chaque catégorie de l'app porte une liste de mots-clés (`Categorie.mots_cles_perso`,
     migration 0085), en français, en anglais et en portugais du Brésil. Tant que l'utilisateur
     n'a pas écrit la sienne, ce sont les listes livrées, rangées par langue dans
     `app/mots_cles/` (un fichier par langue : fr.json, en.json, pt.json) et lues ensemble
     (cf. `livres`).
  4. LE FLOU (`_score`) : le libellé normalisé est comparé au nom et à chaque alias, par
     inclusion de mots entiers, préfixe, puis ressemblance de chaînes (difflib, de la
     bibliothèque standard — aucune dépendance de plus à embarquer dans le bundle). Deux seuils :
     au-dessus de `SEUIL_HAUT`, une proposition PRÉSÉLECTIONNÉE ; entre `SEUIL_BAS` et
     `SEUIL_HAUT`, les trois meilleures SUGGÉRÉES ; en dessous, « à classer ».
  5. LA VALIDATION : toute proposition est confirmée une fois par l'utilisateur, puis écrite dans
     la table du palier 1. JAMAIS d'application silencieuse, même au-dessus du seuil haut — c'est
     l'écran qui l'impose (le bouton « Confirmer »), pas ce module, qui ne fait que lire.

CE MODULE NE FAIT QUE LIRE : aucune écriture en base, aucune catégorie créée ni modifiée.
"""
import json
import re
import sys
import unicodedata
from difflib import SequenceMatcher
from functools import lru_cache
from pathlib import Path
from typing import NamedTuple, Optional

from sqlalchemy.orm import Session

from app import models

# Au-dessus : proposition présélectionnée. Entre les deux : trois suggestions. En dessous :
# « à classer ». Deux seuils, parce qu'« assez proche pour cocher d'avance » et « assez proche
# pour être proposé » ne sont pas la même question.
SEUIL_HAUT = 0.88
SEUIL_BAS = 0.62
# Deux catégories au-dessus du seuil haut à moins de cet écart : la banque est ambiguë, on ne
# présélectionne rien.
ECART_AMBIGU = 0.03
NB_SUGGESTIONS = 3
# Un mot plus court que ça ne vaut jamais une inclusion : « cb », « tv », « de » trouvent trop
# de choses.
LONGUEUR_MIN_MOT = 3
# En dessous, un mot ne se compare plus que par égalité (cf. `_score`).
LONGUEUR_MIN_MOT_FLOU = 5
# Le flou ne rattrape que la FAUTE DE FRAPPE : « transports » ressemble à « sport » à 67 %, et ce
# n'est pas une faute de frappe. En dessous de ce score, la ressemblance de lettres ne compte pas.
SEUIL_FLOU = 0.8
# LES OPÉRATIONS DU GROUPE comme preuve (cf. `_preuves_operations`) : la part de celles qui nomment
# une catégorie donne son score. 100 % monte à 0,92 ; 20 % à 0,68 - une suggestion, jamais une
# présélection. Il en faut au moins `PREUVES_MIN`.
BASE_PREUVE = SEUIL_BAS
POIDS_PREUVE = 0.30
PREUVES_MIN = 2
NB_OPERATIONS_LUES = 200


def normaliser(texte: Optional[str]) -> str:
    """Minuscules, sans accents, sans ponctuation, espaces écrasés."""
    if not texte:
        return ""
    decompose = unicodedata.normalize("NFKD", str(texte))
    sans_accents = "".join(c for c in decompose if not unicodedata.combining(c))
    minuscules = sans_accents.lower().replace("œ", "oe").replace("æ", "ae")
    return re.sub(r"[^a-z0-9]+", " ", minuscules).strip()


# ---------- Les mots-clés livrés ----------
#
# Ils ne sont plus écrits ici mais dans `app/mots_cles/` : UN FICHIER PAR LANGUE (fr.json, en.json,
# pt.json — le portugais étant celui du Brésil), tous de même forme. Chaque mot est rangé dans la
# langue où il se dit : « restaurant » ou « bus » figurent dans les deux langues qui les emploient,
# une marque (« netflix », « uber ») dans chaque langue où on la rencontre. C'est ce qui laisse les
# améliorations à venir se faire langue par langue, sans toucher à ce module. Un relevé n'annonce
# pourtant pas sa langue : on lit l'UNION des trois fichiers, et les propositions sont celles du
# temps où les listes étaient mêlées ici.
#
# Par catégorie livrée, un fichier donne ses `noms` (le nom qui la désigne et ses synonymes :
# « Loisirs & sorties » est reconnu comme « Loisirs ») et ses `mots_cles`. Une catégorie sans
# entrée n'a que son propre nom. Et `autres`, les noms de la catégorie de repli : « Autres »
# n'attire rien par mots-clés, ce n'est pas une destination qu'un libellé désigne, seuls ces mots
# y mènent.
#
# Les mots-clés livrés ne servent que tant que la catégorie n'a pas SA liste : dès qu'on en écrit
# une (`Categorie.mots_cles_perso`), elle remplace celle-ci en entier — jamais de fusion, ce qu'on
# retire d'une liste doit rester retiré.

# Les langues des fichiers, DANS L'ORDRE où on les lit : l'ordre des mots-clés d'une catégorie (celui
# de l'écran des mots-clés, et celui qui départage deux mots de même score) est celui du premier
# fichier qui les porte. Ajouter une langue : un fichier de même forme, et son code ici.
LANGUES_MOTS_CLES = ("fr", "en", "pt")


def dossier_mots_cles() -> Path:
    """Le dossier des fichiers de langue. Des données lues à l'exécution, jamais importées : en
    application packagée, elles sont sous sys._MEIPASS (cf. desktop/budget_app.spec, destination
    "app/mots_cles")."""
    if getattr(sys, "frozen", False):
        return Path(sys._MEIPASS) / "app" / "mots_cles"
    return Path(__file__).resolve().parent.parent / "mots_cles"


class MotsClesLivres(NamedTuple):
    """Ce que disent, ENSEMBLE, les fichiers de langue."""

    # Identifiant de catégorie livrée -> ses mots-clés, sans doublon, dans l'ordre des langues.
    mots: dict
    # Nom (ou synonyme) normalisé -> identifiant de la catégorie qu'il désigne.
    noms: dict
    # Les noms normalisés de la catégorie de repli.
    autres: frozenset


def _lire_langue(langue: str) -> dict:
    """Le contenu du fichier d'une langue. Un fichier manquant ou abîmé est ignoré — l'import
    retombe alors sur le seul nom des catégories, il ne plante pas ; ce sont les tests qui
    gardent les fichiers livrés (et le bundle qui les embarque) en bon état."""
    try:
        contenu = json.loads((dossier_mots_cles() / f"{langue}.json").read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return {}
    return contenu if isinstance(contenu, dict) else {}


@lru_cache(maxsize=1)
def livres() -> MotsClesLivres:
    """L'union des fichiers de langue, lus une fois."""
    mots: dict[str, dict[str, None]] = {}  # un dict sert d'ensemble ordonné
    noms: dict[str, str] = {}
    autres: set[str] = set()
    for langue in LANGUES_MOTS_CLES:
        contenu = _lire_langue(langue)
        for identifiant, categorie in (contenu.get("categories") or {}).items():
            mots.setdefault(identifiant, {}).update(dict.fromkeys(categorie.get("mots_cles", [])))
            for nom in categorie.get("noms", []):
                noms.setdefault(normaliser(nom), identifiant)
        autres.update(normaliser(nom) for nom in (contenu.get("autres") or {}).get("noms", []))
    autres.discard("")
    return MotsClesLivres(
        mots={identifiant: list(liste) for identifiant, liste in mots.items()},
        noms=noms,
        autres=frozenset(autres),
    )


def mots_cles_par_defaut(nom_categorie: str) -> list[str]:
    """Les mots-clés livrés pour une catégorie, d'après son nom ; vide si on n'en connaît pas."""
    donnees = livres()
    return list(donnees.mots.get(donnees.noms.get(normaliser(nom_categorie)), []))


def mots_cles_de(categorie: models.Categorie) -> list[str]:
    """Les mots-clés EN VIGUEUR : ceux de l'utilisateur dès qu'il en a écrit (même une liste
    vide — c'est un choix), sinon les livrés."""
    if categorie.mots_cles_perso is not None:
        return [str(m) for m in categorie.mots_cles_perso]
    return mots_cles_par_defaut(categorie.nom)


# ---------- La ressemblance ----------


def _score(libelle: str, candidat: str) -> float:
    """Entre 0 et 1 : à quel point `libelle` (déjà normalisé) désigne `candidat` (idem).

    DANS L'ORDRE : égalité (1), tous les mots du candidat présents dans le libellé (0,95 — c'est
    « supermarche » dans « supermarches bouche »), l'inverse (0,9), un mot qui en commence un
    autre (0,9, « restau » → « restaurant »), puis la ressemblance de chaînes, au mot près
    et en bloc."""
    if not libelle or not candidat:
        return 0.0
    if libelle == candidat:
        return 1.0
    mots_l = [m for m in libelle.split() if len(m) >= LONGUEUR_MIN_MOT]
    mots_c = [m for m in candidat.split() if len(m) >= LONGUEUR_MIN_MOT]
    if not mots_l or not mots_c:
        return 0.0
    ens_l, ens_c = set(libelle.split()), set(candidat.split())
    if ens_c <= ens_l and any(len(m) >= LONGUEUR_MIN_MOT for m in ens_c):
        return 0.95
    if ens_l <= ens_c:
        return 0.9
    meilleur = 0.0
    for ml in mots_l:
        for mc in mots_c:
            if min(len(ml), len(mc)) < LONGUEUR_MIN_MOT_FLOU:
                # UN MOT COURT NE SE COMPARE PAS AU FLOU : « vie » ressemble à « video » à 75 %, et
                # « Vie quotidienne » se retrouvait en Loisirs (via « jeux vidéo »). Pour un mot de
                # trois ou quatre lettres, l'égalité (traitée plus haut) est la seule preuve.
                continue
            if ml.startswith(mc) or mc.startswith(ml):
                meilleur = max(meilleur, 0.9)
            else:
                ressemblance = SequenceMatcher(None, ml, mc).ratio()
                if ressemblance >= SEUIL_FLOU:
                    meilleur = max(meilleur, ressemblance)
    # Le bloc entier ne vaut que pour UN mot contre UN mot (une faute de frappe) : entre deux
    # groupes de mots, quelques lettres communes suffisent à faire un score, et ce n'est pas du sens.
    if len(mots_l) == 1 and len(mots_c) == 1:
        ressemblance = SequenceMatcher(None, libelle, candidat).ratio()
        if ressemblance >= SEUIL_FLOU:
            meilleur = max(meilleur, ressemblance)
    return meilleur


def _candidats(categorie: models.Categorie) -> list[tuple[str, str]]:
    """(texte normalisé, texte d'origine) : le nom, puis chaque alias."""
    vus = set()
    sortie = []
    for brut in [categorie.nom, *mots_cles_de(categorie)]:
        normalise = normaliser(brut)
        if normalise and normalise not in vus:
            vus.add(normalise)
            sortie.append((normalise, brut))
    return sortie


def _nomme(libelle: str, candidat: str) -> bool:
    """Le libellé (déjà normalisé) contient-il ce mot-clé, en mots entiers ou en préfixe d'un mot
    d'au moins cinq lettres ? La version SANS flou de `_score`, assez peu chère pour être jouée
    sur chaque opération d'un groupe."""
    if not libelle or not candidat:
        return False
    mots_l, mots_c = set(libelle.split()), set(candidat.split())
    if any(len(m) >= LONGUEUR_MIN_MOT for m in mots_c) and mots_c <= mots_l:
        return True
    return any(
        min(len(ml), len(mc)) >= LONGUEUR_MIN_MOT_FLOU and (ml.startswith(mc) or mc.startswith(ml))
        for ml in mots_l
        for mc in mots_c
    )


def _preuves_operations(candidats_par_categorie: dict, natures: list[str]) -> dict:
    """{categorie_id: (score, mot)} d'après les NOMS DES OPÉRATIONS du groupe.

    LE NOM DE LA CATÉGORIE DE LA BANQUE N'EST PAS TOUT : « Vie quotidienne » ne dit rien, mais ses
    opérations s'appellent « Carrefour », « Restaurant », « Courses ». Pour chaque catégorie de
    l'app, on compte les opérations dont le nom contient l'un de ses mots-clés ; la PART qu'elles
    représentent donne le score (`BASE_PREUVE` + `POIDS_PREUVE` × part). Il en faut au moins
    `PREUVES_MIN`, sinon un seul « bar » dans un libellé suffirait."""
    lues = [n for n in dict.fromkeys(normaliser(n) for n in natures) if n]
    if not lues:
        return {}
    total = len(lues)
    preuves = {}
    for categorie_id, candidats in candidats_par_categorie.items():
        decomptes: dict[str, int] = {}
        touchees = 0
        for nature in lues:
            mot = next((brut for normalise, brut in candidats if _nomme(nature, normalise)), None)
            if mot is not None:
                touchees += 1
                decomptes[mot] = decomptes.get(mot, 0) + 1
        if touchees >= PREUVES_MIN:
            via = max(decomptes, key=decomptes.get)
            preuves[categorie_id] = (round(BASE_PREUVE + POIDS_PREUVE * touchees / total, 4), via)
    return preuves


def classer(db: Session, libelle_banque: str, natures: Optional[list[str]] = None) -> list[dict]:
    """Les catégories de l'app, de la plus proche à la moins proche du libellé de la banque :
    [{categorie_id, nom, score, via}], score > 0 seulement. `via` est le mot (nom ou alias) qui a
    porté le score — c'est ce qui permet à l'écran de dire POURQUOI on propose.

    `natures` : les noms des opérations de ce groupe (cf. `_preuves_operations`). Elles portent
    leur propre score, et c'est le meilleur des deux qui compte ; quand le nom de la catégorie de
    la banque ET ses opérations s'accordent, elles se renforcent."""
    libelle = normaliser(libelle_banque)
    if not libelle:
        return []
    categories = db.query(models.Categorie).filter(models.Categorie.active.is_(True)).all()
    autres = livres().autres
    resultats = []
    candidats_par_categorie: dict = {}
    noms: dict = {}
    for categorie in categories:
        if normaliser(categorie.nom) in autres:
            # « Autres » ne répond qu'à ses propres mots.
            candidats = [(normaliser(m), m) for m in [categorie.nom, *sorted(autres)]]
        else:
            candidats = _candidats(categorie)
        meilleur, via = 0.0, None
        for normalise, brut in candidats:
            score = _score(libelle, normalise)
            if score > meilleur:
                meilleur, via = score, brut
        noms[categorie.id] = categorie.nom
        if normaliser(categorie.nom) not in autres:
            # « Autres » n'est jamais prouvée par des mots-clés : c'est le repli (cf. `livres().autres`).
            candidats_par_categorie[categorie.id] = candidats
        if meilleur > 0:
            resultats.append(
                {
                    "categorie_id": categorie.id,
                    "nom": categorie.nom,
                    "score": round(meilleur, 4),
                    "via": via,
                }
            )
    for categorie_id, (score_preuve, mot) in _preuves_operations(
        candidats_par_categorie, natures or []
    ).items():
        existant = next((r for r in resultats if r["categorie_id"] == categorie_id), None)
        if existant is None:
            resultats.append(
                {"categorie_id": categorie_id, "nom": noms[categorie_id], "score": score_preuve, "via": mot}
            )
        elif score_preuve > existant["score"]:
            existant.update(score=round(min(1.0, score_preuve + 0.03), 4), via=mot)
        else:
            existant["score"] = round(min(1.0, existant["score"] + 0.03), 4)
    resultats.sort(key=lambda r: (-r["score"], r["nom"]))
    return resultats


def proposer(db: Session, libelle_banque: str, natures: Optional[list[str]] = None) -> dict:
    """La décision pour UN libellé du relevé :

      {statut: "forte" | "suggestions" | "a_classer", propositions: [≤ 3 × classer()]}

    « forte » : une catégorie au-dessus du seuil haut, sans rivale à moins de `ECART_AMBIGU` —
    l'écran la présélectionne (et demande quand même de confirmer). « suggestions » : les trois
    meilleures entre les deux seuils, ou plusieurs au-dessus du seuil haut qui se disputent.
    « a_classer » : rien d'assez proche."""
    classement = classer(db, libelle_banque, natures)
    if not classement or classement[0]["score"] < SEUIL_BAS:
        return {"statut": "a_classer", "propositions": []}
    tete = classement[0]
    if tete["score"] >= SEUIL_HAUT:
        rivale = len(classement) > 1 and classement[1]["score"] >= SEUIL_HAUT and (
            tete["score"] - classement[1]["score"] < ECART_AMBIGU
        )
        if not rivale:
            retenues = [r for r in classement if r["score"] >= SEUIL_BAS][:NB_SUGGESTIONS]
            return {"statut": "forte", "propositions": retenues}
    retenues = [r for r in classement if r["score"] >= SEUIL_BAS][:NB_SUGGESTIONS]
    return {"statut": "suggestions", "propositions": retenues}
