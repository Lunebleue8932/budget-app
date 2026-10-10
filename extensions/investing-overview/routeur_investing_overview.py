"""Les lectures d'ensemble du portefeuille, sous `/investing-overview`.

UN SEUL VERBE, GET. Cet écran ne crée, ne modifie et ne supprime rien : il
recalcule à la demande, depuis les mouvements déjà en base. C'est ce qui permet
de l'éteindre sans la moindre précaution.
"""
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.constants import AxeTitre
from app.database import get_db

from schemas_vue_ensemble import ExpositionMonnaie, ExpositionTitresMonnaie
from service_vue_ensemble import exposition_par_axe, exposition_par_titre

router = APIRouter(prefix="/investing-overview", tags=["investing-overview"])


@router.get("/exposition", response_model=list[ExpositionMonnaie])
def get_exposition(
    axe: AxeTitre = AxeTitre.enveloppe, db: Session = Depends(get_db)
):
    """La répartition du portefeuille sur un axe, une entrée par monnaie.

    DEUX APPELS PLUTÔT QU'UNE RÉPONSE QUI PORTE LES DEUX : l'écran dessine deux
    camemberts, mais chacun se lit seul — et un portefeuille dont aucun titre
    n'a de classe d'actif n'a aucune raison de faire payer ce calcul-là à celui
    qui ne regarde que les enveloppes.

    Le défaut est l'enveloppe, c'est-à-dire le comportement d'avant la
    migration 0066 : un appelant qui ignore le paramètre obtient ce qu'il
    obtenait.

    Une liste VIDE quand rien n'est détenu — ce n'est pas une erreur, c'est
    l'état d'un portefeuille neuf, et l'écran le dit avec une phrase plutôt
    qu'avec un camembert à zéro part."""
    return exposition_par_axe(db, axe.value)


@router.get("/exposition-titres", response_model=list[ExpositionTitresMonnaie])
def get_exposition_titres(db: Session = Depends(get_db)):
    """L'exposition titre par titre : en direct, et à travers la composition des ETF. Ce que
    les compositions ne décrivent pas forme une part à elle (cf. exposition_par_titre)."""
    return exposition_par_titre(db)
