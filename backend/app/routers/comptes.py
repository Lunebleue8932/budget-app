from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from .. import crud, models, schemas
from ..database import get_db
from ..services import ecarts

router = APIRouter(prefix="/comptes", tags=["comptes"])


def _compte_read(compte: models.Compte) -> schemas.CompteRead:
    return schemas.CompteRead(
        id=compte.id,
        nom=compte.nom,
        type_id=compte.type_id,
        type_nom=compte.type_nom,
        monnaies=[
            schemas.CompteMonnaieRead(
                monnaie_id=lien.monnaie_id,
                solde_initial=lien.solde_initial,
                monnaie_nom=lien.monnaie.nom,
                monnaie_symbole=lien.monnaie.symbole,
            )
            for lien in compte.monnaies
        ],
    )


@router.get("", response_model=list[schemas.CompteRead])
def list_comptes(db: Session = Depends(get_db)):
    return [_compte_read(compte) for compte in crud.get_comptes(db)]


def _valider_type_compte(db: Session, type_id) -> None:
    if type_id is not None and crud.get_type_compte(db, type_id) is None:
        raise HTTPException(status_code=404, detail="Type de compte introuvable")


def _valider_monnaies(db: Session, monnaies: list[schemas.CompteMonnaieInput]) -> None:
    ids = [entree.monnaie_id for entree in monnaies]
    if len(set(ids)) != len(ids):
        raise HTTPException(
            status_code=400, detail="Une même monnaie ne peut pas être ajoutée deux fois"
        )
    for monnaie_id in ids:
        if crud.get_monnaie(db, monnaie_id) is None:
            raise HTTPException(
                status_code=404, detail=f"Monnaie {monnaie_id} introuvable"
            )


@router.post("", response_model=schemas.CompteRead, status_code=status.HTTP_201_CREATED)
def create_compte(compte: schemas.CompteCreate, db: Session = Depends(get_db)):
    if crud.get_compte_by_nom(db, compte.nom):
        raise HTTPException(status_code=409, detail="Un compte avec ce nom existe déjà")
    _valider_type_compte(db, compte.type_id)
    _valider_monnaies(db, compte.monnaies)
    return _compte_read(crud.create_compte(db, compte))


@router.put("/reordonner", response_model=list[schemas.CompteRead])
def reordonner_comptes(payload: schemas.ReordonnerComptesInput, db: Session = Depends(get_db)):
    """Applique le nouvel ordre d'affichage issu d'un glisser-déposer côté
    frontend : `ordre` liste les ids des comptes d'un type, dans l'ordre voulu.

    Déclarée AVANT `/{compte_id}` : sans quoi FastAPI, qui essaie les routes
    dans l'ordre de déclaration, tenterait de lire "reordonner" comme un id."""
    crud.reordonner_comptes(db, payload.ordre)
    return [_compte_read(compte) for compte in crud.get_comptes(db)]


@router.get("/{compte_id}", response_model=schemas.CompteRead)
def read_compte(compte_id: int, db: Session = Depends(get_db)):
    db_compte = crud.get_compte(db, compte_id)
    if db_compte is None:
        raise HTTPException(status_code=404, detail="Compte introuvable")
    return _compte_read(db_compte)


@router.put("/{compte_id}", response_model=schemas.CompteRead)
def update_compte(
    compte_id: int, updates: schemas.CompteUpdate, db: Session = Depends(get_db)
):
    db_compte = crud.get_compte(db, compte_id)
    if db_compte is None:
        raise HTTPException(status_code=404, detail="Compte introuvable")
    if (
        updates.nom is not None
        and updates.nom != db_compte.nom
        and crud.get_compte_by_nom(db, updates.nom)
    ):
        raise HTTPException(status_code=409, detail="Un compte avec ce nom existe déjà")
    _valider_type_compte(db, updates.type_id)
    if updates.monnaies is not None:
        _valider_monnaies(db, updates.monnaies)
        # Retirer une monnaie dans laquelle le compte porte déjà des opérations
        # laisserait des montants sans support : le solde de cette monnaie ne
        # serait plus calculé nulle part alors que les écritures existent.
        retirees = crud.compte_monnaies_utilisees(db, compte_id) - {
            entree.monnaie_id for entree in updates.monnaies
        }
        if retirees:
            noms = ", ".join(
                sorted(crud.get_monnaie(db, monnaie_id).nom for monnaie_id in retirees)
            )
            raise HTTPException(
                status_code=409,
                detail=(
                    f"Ce compte porte déjà des opérations en {noms} : supprime-les "
                    "avant de retirer cette monnaie."
                ),
            )
    return _compte_read(crud.update_compte(db, db_compte, updates))


@router.delete("/{compte_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_compte(compte_id: int, db: Session = Depends(get_db)):
    db_compte = crud.get_compte(db, compte_id)
    if db_compte is None:
        raise HTTPException(status_code=404, detail="Compte introuvable")
    if db_compte.operations:
        raise HTTPException(
            status_code=409,
            detail="Impossible de supprimer un compte qui a des opérations liées",
        )
    crud.delete_compte(db, db_compte)


@router.post("/{compte_id}/diagnostic-ecart", response_model=schemas.DiagnosticEcartRead)
def diagnostic_ecart(
    compte_id: int,
    payload: schemas.DiagnosticEcartInput,
    db: Session = Depends(get_db),
):
    """Compare le solde de l'app à celui du relevé, et propose des pistes.

    POST et non GET, bien que rien ne soit écrit : le solde saisi n'a rien à
    faire dans une URL, où il finirait dans les journaux et l'historique du
    navigateur. C'est une lecture, rejouable autant de fois que voulu (cf.
    services/ecarts).

    La monnaie doit être l'une de celles du compte : un compte a un solde PAR
    monnaie, et diagnostiquer un écart en dollars sur un compte qui n'en porte
    pas comparerait un relevé à un solde qui n'existe pas."""
    db_compte = crud.get_compte(db, compte_id)
    if db_compte is None:
        raise HTTPException(status_code=404, detail="Compte introuvable")
    if payload.monnaie_id not in {lien.monnaie_id for lien in db_compte.monnaies}:
        raise HTTPException(
            status_code=400, detail="Ce compte ne porte pas cette monnaie"
        )
    return ecarts.diagnostiquer(
        db,
        db_compte,
        payload.monnaie_id,
        payload.solde_banque,
        date_fin=payload.date_fin,
    )
