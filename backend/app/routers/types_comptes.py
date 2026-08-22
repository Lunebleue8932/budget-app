from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from .. import crud, schemas
from ..database import get_db

router = APIRouter(prefix="/types-comptes", tags=["types-comptes"])


@router.get("", response_model=list[schemas.TypeCompteRead])
def list_types_comptes(db: Session = Depends(get_db)):
    return crud.get_types_compte(db)


@router.post("", response_model=schemas.TypeCompteRead, status_code=status.HTTP_201_CREATED)
def create_type_compte(payload: schemas.TypeCompteCreate, db: Session = Depends(get_db)):
    if crud.get_type_compte_by_nom(db, payload.nom):
        raise HTTPException(status_code=409, detail="Un type de compte avec ce nom existe déjà")
    return crud.create_type_compte(db, payload)


@router.delete("/{type_compte_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_type_compte(type_compte_id: int, db: Session = Depends(get_db)):
    db_type_compte = crud.get_type_compte(db, type_compte_id)
    if db_type_compte is None:
        raise HTTPException(status_code=404, detail="Type de compte introuvable")
    if db_type_compte.systeme:
        raise HTTPException(
            status_code=400,
            detail="Ce type de compte est protégé (utilisé par les règles de l'application) et ne peut pas être supprimé",
        )
    if crud.type_compte_est_utilise(db, type_compte_id):
        raise HTTPException(
            status_code=409,
            detail="Impossible de supprimer un type utilisé par au moins un compte",
        )
    crud.delete_type_compte(db, db_type_compte)
