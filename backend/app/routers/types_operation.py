from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from .. import crud, schemas
from ..database import get_db

router = APIRouter(prefix="/types-operation", tags=["types-operation"])


@router.get("", response_model=list[schemas.TypeOperationRead])
def list_types_operation(db: Session = Depends(get_db)):
    return crud.get_types_operation(db)


@router.put("/{type_id}", response_model=schemas.TypeOperationRead)
def update_type_operation(
    type_id: int, payload: schemas.TypeOperationUpdate, db: Session = Depends(get_db)
):
    """Seul le libellé est modifiable. Ni création ni suppression : la logique
    métier dépend de l'existence exacte de ces six types (déduction du sens,
    caractère remboursable, cibles de règlement), et s'appuie sur leur `code`
    — jamais sur ce libellé."""
    type_operation = crud.get_type_operation(db, type_id)
    if type_operation is None:
        raise HTTPException(status_code=404, detail="Type d'opération introuvable")
    return crud.renommer_type_operation(db, type_operation, payload.nom)
