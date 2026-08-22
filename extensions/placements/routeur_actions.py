from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app import crud, schemas
from app.database import get_db

router = APIRouter(prefix="/actions", tags=["placements"])


def _action_read(action) -> schemas.ActionRead:
    return schemas.ActionRead(
        id=action.id,
        nom=action.nom,
        valeur=action.valeur,
        monnaie_id=action.monnaie_id,
        monnaie_symbole=action.monnaie.symbole,
    )


def _valider_monnaie(db: Session, monnaie_id) -> None:
    if monnaie_id is not None and crud.get_monnaie(db, monnaie_id) is None:
        raise HTTPException(status_code=404, detail="Monnaie introuvable")


@router.get("", response_model=list[schemas.ActionRead])
def list_actions(db: Session = Depends(get_db)):
    return [_action_read(action) for action in crud.get_actions(db)]


@router.post("", response_model=schemas.ActionRead, status_code=status.HTTP_201_CREATED)
def create_action(payload: schemas.ActionCreate, db: Session = Depends(get_db)):
    if crud.get_action_by_nom(db, payload.nom):
        raise HTTPException(status_code=409, detail="Un titre avec ce nom existe déjà")
    _valider_monnaie(db, payload.monnaie_id)
    return _action_read(
        crud.create_action(db, payload.nom, payload.monnaie_id, payload.valeur)
    )


@router.put("/{action_id}", response_model=schemas.ActionRead)
def update_action(action_id: int, payload: schemas.ActionUpdate, db: Session = Depends(get_db)):
    """Renommer, et surtout mettre à jour le cours : l'app n'a aucune source de
    marché, cette valeur est saisie à la main et ne sert qu'à valoriser les
    portefeuilles à l'écran — jamais à recalculer un solde en espèces, qui ne
    dépend que des prix réellement payés."""
    action = crud.get_action(db, action_id)
    if action is None:
        raise HTTPException(status_code=404, detail="Titre introuvable")
    if (
        payload.nom is not None
        and payload.nom != action.nom
        and crud.get_action_by_nom(db, payload.nom)
    ):
        raise HTTPException(status_code=409, detail="Un titre avec ce nom existe déjà")
    _valider_monnaie(db, payload.monnaie_id)
    # Changer la monnaie de cotation d'un titre déjà mouvementé réécrirait le
    # sens de mouvements passés (le prix payé était libellé dans l'ancienne) :
    # les écritures d'espèces existantes, elles, ne bougeraient pas.
    if (
        payload.monnaie_id is not None
        and payload.monnaie_id != action.monnaie_id
        and crud.action_est_utilisee(db, action_id)
    ):
        raise HTTPException(
            status_code=409,
            detail=(
                "Ce titre a des mouvements enregistrés : sa monnaie de cotation "
                "ne peut plus changer (les montants déjà payés sont libellés dans "
                "l'ancienne)."
            ),
        )
    return _action_read(
        crud.update_action(
            db, action, nom=payload.nom, valeur=payload.valeur, monnaie_id=payload.monnaie_id
        )
    )


@router.delete("/{action_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_action(action_id: int, db: Session = Depends(get_db)):
    action = crud.get_action(db, action_id)
    if action is None:
        raise HTTPException(status_code=404, detail="Titre introuvable")
    if crud.action_est_utilisee(db, action_id):
        raise HTTPException(
            status_code=409,
            detail=(
                "Ce titre a des mouvements enregistrés : supprime-les d'abord "
                "(les soldes du compte en dépendent)."
            ),
        )
    crud.delete_action(db, action)
