from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from .. import crud, schemas
from ..database import get_db

router = APIRouter(prefix="/types-comptes", tags=["types-comptes"])

# PAS DE CRÉATION. Les trois types livrés (cf. constants.TYPES_COMPTE_INITIAUX)
# sont les seuls que le reste du code sache traiter : le dashboard et les règles
# de virement les nomment. Un type inventé n'aurait été qu'une étiquette de plus,
# sans effet nulle part, et une décision de rangement de plus à prendre à la
# création de chaque compte.
#
# LA SUPPRESSION RESTE, elle, et refuse les types protégés : elle ne peut donc
# rien atteindre dans une base ordinaire. Elle est gardée pour les bases qui
# portent encore un type créé du temps où l'écran le permettait — sans elle, il
# n'y aurait plus aucun moyen de s'en défaire.


@router.get("", response_model=list[schemas.TypeCompteRead])
def list_types_comptes(db: Session = Depends(get_db)):
    return crud.get_types_compte(db)


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
