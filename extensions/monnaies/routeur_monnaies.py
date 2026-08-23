"""Création, renommage et suppression d'une monnaie.

Ces trois routes sont ici et non dans le noyau : c'est le droit d'avoir
PLUSIEURS monnaies qui est optionnel, pas le fait qu'un montant en ait une.
`GET /monnaies` est resté de l'autre côté — cf. app/routers/monnaies.py.

Même préfixe que le routeur du noyau : FastAPI les distingue par la méthode, et
`/monnaies` reste une seule ressource vue du client, qu'on ait ou non le droit
d'y écrire.
"""
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

# Imports ABSOLUS : ce module n'est pas un sous-paquet de `app`, il est chargé
# par chemin de fichier (cf. extensions/README.md).
from app import crud, schemas
from app.database import get_db

router = APIRouter(prefix="/monnaies", tags=["monnaies"])


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
