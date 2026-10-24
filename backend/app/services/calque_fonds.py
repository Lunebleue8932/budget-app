"""Poser sur un fonds ce que porte un autre : un indice qu'on calque, un fichier qu'on importe.

DEUX GESTES, UNE SEULE MÉCANIQUE. « Calquer un ETF sur un indice » et « brancher un ETF sur un import
de composition » font la même chose : certaines PROPRIÉTÉS d'un fonds (sa composition, ses
répartitions par classe, zone et secteur) sont remplacées par celles d'une source. Ce module est
l'endroit où l'on dit quelles sont ces propriétés, comment on les résume pour les montrer à
l'utilisateur AVANT d'écraser quoi que ce soit, et comment on les recopie.

CE QUI EST ÉCRASÉ L'EST D'UN BLOC (une composition et une répartition sont des instantanés), et
c'est à l'écran de l'avoir dit : `resume` existe pour cela. L'utilisateur choisit, propriété par
propriété, ce qu'il prend et ce qu'il laisse ; ce que le fonds porte déjà bien reste.

NE COMMITE PAS : l'appelant décide du moment (un import fait un seul commit).
"""
from datetime import date as date_type
from typing import Iterable, Optional

from .. import crud, models
from ..constants import AxeTitre
from . import exposition

COMPOSITION = "composition"
PROPRIETES_REPARTITION = (AxeTitre.classe.value, AxeTitre.zone.value, AxeTitre.secteur.value)
PROPRIETES = (COMPOSITION, *PROPRIETES_REPARTITION)


class ErreurCalque(ValueError):
    """Une demande de calque qui ne peut pas être exécutée (propriété inconnue, source vide…)."""


def verifier_proprietes(proprietes: Iterable[str]) -> list[str]:
    """Les propriétés demandées, dans l'ordre canonique ; une inconnue est une erreur."""
    demandees = list(proprietes)
    inconnues = [p for p in demandees if p not in PROPRIETES]
    if inconnues:
        raise ErreurCalque(f"propriété inconnue : {', '.join(inconnues)}")
    return [p for p in PROPRIETES if p in demandees]


def resume(titre: models.TitrePossede) -> dict:
    """Ce que le titre porte aujourd'hui, propriété par propriété, pour le MONTRER avant de l'écraser.

    `composition` : nombre de composants et part de l'indice couverte ; chaque axe : ses lignes
    (étiquette, poids) et leur total. Une propriété vide a `nb` à 0."""
    composition = titre.composition or {}
    donnees = {
        COMPOSITION: {
            "nb": len(composition),
            "couverture_pct": titre.composition_couverture_pct,
            "poids_pct": round(sum(composition.values()), 4),
        }
    }
    for axe in PROPRIETES_REPARTITION:
        lignes = titre.repartition(axe)
        donnees[axe] = {
            "nb": len(lignes),
            "poids_pct": round(sum(e.poids_pct for e in lignes), 4),
            "lignes": [{"nom": e.etiquette.nom, "poids_pct": e.poids_pct} for e in lignes],
        }
    return donnees


def a_des_donnees(titre: models.TitrePossede, propriete: str) -> bool:
    return resume(titre)[propriete]["nb"] > 0


def poser_composition(titre: models.TitrePossede, composition: Optional[dict], couverture: Optional[float]) -> None:
    """La composition et sa couverture, d'un bloc. Un titre ne se cite pas lui-même."""
    propre = {k: v for k, v in (composition or {}).items() if k != exposition.cle_composant(titre)}
    titre.composition = propre or None
    titre.composition_couverture_pct = (couverture or None) if propre else None


def calquer(
    db,
    cible: models.TitrePossede,
    source: models.TitrePossede,
    proprietes: Iterable[str],
    *,
    date_maj: Optional[date_type] = None,
) -> list[str]:
    """Recopie sur `cible` les `proprietes` choisies de `source`. Rend celles qui ont été posées.

    Une propriété que la source ne porte pas est REFUSÉE plutôt que posée vide : demander de
    « prendre » ce qui n'existe pas effacerait la cible sans rien apporter, et ce n'est jamais ce
    que l'utilisateur voulait dire (l'écran ne propose d'ailleurs que ce que la source porte)."""
    choisies = verifier_proprietes(proprietes)
    if cible.id == source.id:
        raise ErreurCalque("un fonds ne se calque pas sur lui-même")
    vides = [p for p in choisies if not a_des_donnees(source, p)]
    if vides:
        raise ErreurCalque(
            f"« {source.nom_affiche} » ne porte rien pour : {', '.join(vides)}"
        )
    aujourdhui = date_maj or date_type.today()
    etiquette_source = f"Calque sur « {source.nom_affiche} »"
    for propriete in choisies:
        if propriete == COMPOSITION:
            poser_composition(cible, source.composition, source.composition_couverture_pct)
        else:
            crud.poser_repartition(
                db,
                cible,
                propriete,
                [(e.type_titre_id, e.poids_pct) for e in source.repartition(propriete)],
                source=etiquette_source,
                date_maj=aujourdhui,
            )
    return choisies
