"""Les lectures d'ensemble du portefeuille, sous `/investing-overview`.

UN SEUL VERBE, GET. Cet écran ne crée, ne modifie et ne supprime rien : il
recalcule à la demande, depuis les mouvements déjà en base. C'est ce qui permet
de l'éteindre sans la moindre précaution.
"""
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.database import get_db

from schemas_vue_ensemble import ExpositionMonnaie
from service_vue_ensemble import exposition_par_type

router = APIRouter(prefix="/investing-overview", tags=["investing-overview"])


@router.get("/exposition", response_model=list[ExpositionMonnaie])
def get_exposition(db: Session = Depends(get_db)):
    """La répartition du portefeuille par type de titre, une entrée par monnaie.

    Une liste VIDE quand rien n'est détenu — ce n'est pas une erreur, c'est
    l'état d'un portefeuille neuf, et l'écran le dit avec une phrase plutôt
    qu'avec un camembert à zéro part."""
    return exposition_par_type(db)
