"""Lecture des monnaies.

LA LECTURE SEULEMENT. Créer, renommer et supprimer une monnaie relèvent de
l'extension « Monnaies » (extensions/monnaies/routeur_monnaies.py) : c'est le
droit d'en avoir PLUSIEURS qui est optionnel. Cette route-ci ne l'est pas —
afficher un montant demande de connaître son symbole, et c'est vrai de tous
les écrans, extension installée ou non.
"""
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from .. import crud, schemas
from ..database import get_db

router = APIRouter(prefix="/monnaies", tags=["monnaies"])


@router.get("", response_model=list[schemas.MonnaieRead])
def list_monnaies(db: Session = Depends(get_db)):
    return crud.get_monnaies(db)
