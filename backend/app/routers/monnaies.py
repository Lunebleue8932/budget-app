from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from .. import crud, schemas
from ..database import get_db

router = APIRouter(prefix="/monnaies", tags=["monnaies"])


@router.get("", response_model=list[schemas.MonnaieRead])
def list_monnaies(db: Session = Depends(get_db)):
    return crud.get_monnaies(db)


@router.post("", response_model=schemas.MonnaieRead, status_code=status.HTTP_201_CREATED)
def create_monnaie(monnaie: schemas.MonnaieCreate, db: Session = Depends(get_db)):
    if crud.get_monnaie_by_nom(db, monnaie.nom) is not None:
        raise HTTPException(status_code=409, detail="Une monnaie avec ce nom existe déjà")
    return crud.create_monnaie(db, monnaie.nom, monnaie.symbole)


@router.put("/{monnaie_id}", response_model=schemas.MonnaieRead)
def update_monnaie(
    monnaie_id: int, updates: schemas.MonnaieUpdate, db: Session = Depends(get_db)
):
    monnaie = crud.get_monnaie(db, monnaie_id)
    if monnaie is None:
        raise HTTPException(status_code=404, detail="Monnaie introuvable")
    if (
        updates.nom is not None
        and updates.nom != monnaie.nom
        and crud.get_monnaie_by_nom(db, updates.nom) is not None
    ):
        raise HTTPException(status_code=409, detail="Une monnaie avec ce nom existe déjà")
    return crud.update_monnaie(db, monnaie, nom=updates.nom, symbole=updates.symbole)


@router.delete("/{monnaie_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_monnaie(monnaie_id: int, db: Session = Depends(get_db)):
    monnaie = crud.get_monnaie(db, monnaie_id)
    if monnaie is None:
        raise HTTPException(status_code=404, detail="Monnaie introuvable")
    # Renommer une monnaie est sans risque, la supprimer ne l'est pas : les
    # montants qui la portaient deviendraient illisibles (aucun taux de change
    # ne permettrait de les rattacher à une autre).
    if crud.monnaie_est_utilisee(db, monnaie_id):
        raise HTTPException(
            status_code=409,
            detail=(
                "Cette monnaie est encore utilisée par un compte, une opération, "
                "un budget ou un titre : elle ne peut pas être supprimée."
            ),
        )
    crud.delete_monnaie(db, monnaie)
