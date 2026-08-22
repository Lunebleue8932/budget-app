from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from .. import crud, models, schemas
from ..constants import Sens
from ..database import get_db

router = APIRouter(prefix="/virements", tags=["virements"])


def _valider_monnaie(db: Session, compte: models.Compte, monnaie_id: int, role: str) -> None:
    if crud.get_monnaie(db, monnaie_id) is None:
        raise HTTPException(status_code=404, detail=f"Monnaie du compte {role} introuvable")
    if monnaie_id not in compte.monnaie_ids:
        monnaies_possibles = ", ".join(sorted(lien.monnaie.nom for lien in compte.monnaies))
        raise HTTPException(
            status_code=400,
            detail=(
                f"Le compte {role} « {compte.nom} » ne porte pas cette monnaie "
                f"(possibles : {monnaies_possibles})."
            ),
        )


@router.post("", response_model=schemas.VirementRead, status_code=status.HTTP_201_CREATED)
def create_virement(virement: schemas.VirementCreate, db: Session = Depends(get_db)):
    compte_source = crud.get_compte(db, virement.compte_source_id)
    if compte_source is None:
        raise HTTPException(status_code=404, detail="Compte source introuvable")

    compte_destination = crud.get_compte(db, virement.compte_destination_id)
    if compte_destination is None:
        raise HTTPException(status_code=404, detail="Compte destination introuvable")

    # Chaque jambe porte sa propre monnaie, chacune devant appartenir au compte
    # qu'elle touche : c'est ce qui rend un virement entre monnaies possible
    # sans qu'aucun taux de change n'existe côté serveur.
    _valider_monnaie(db, compte_source, virement.monnaie_id, "source")
    _valider_monnaie(
        db, compte_destination, virement.monnaie_destination_resolue, "destination"
    )

    op_sortante, op_entrante = crud.create_virement(
        db, virement, compte_source, compte_destination
    )
    return schemas.VirementRead(
        virement_id=op_sortante.virement_id,
        operation_sortante=op_sortante,
        operation_entrante=op_entrante,
    )


@router.put("/{virement_id}", response_model=schemas.VirementRead)
def update_virement(
    virement_id: str, virement: schemas.VirementCreate, db: Session = Depends(get_db)
):
    """Modifie un virement existant.

    Les deux écritures sont réécrites ensemble : les corriger séparément via
    /operations laisserait un virement à moitié modifié, dont les deux jambes
    ne se répondent plus (c'est d'ailleurs pourquoi /operations refuse d'en
    changer le type).
    """
    operations = crud.get_virement(db, virement_id)
    if not operations:
        raise HTTPException(status_code=404, detail="Virement introuvable")
    # Un virement importé dont un seul compte était connu n'a qu'une écriture :
    # il n'y a pas de seconde jambe à mettre en face, donc rien à réécrire ici.
    if len(operations) < 2:
        raise HTTPException(
            status_code=409,
            detail=(
                "Ce virement n'a qu'une seule écriture (second compte inconnu à "
                "l'import) : modifie-la comme une opération ordinaire."
            ),
        )

    compte_source = crud.get_compte(db, virement.compte_source_id)
    if compte_source is None:
        raise HTTPException(status_code=404, detail="Compte source introuvable")

    compte_destination = crud.get_compte(db, virement.compte_destination_id)
    if compte_destination is None:
        raise HTTPException(status_code=404, detail="Compte destination introuvable")

    _valider_monnaie(db, compte_source, virement.monnaie_id, "source")
    _valider_monnaie(
        db, compte_destination, virement.monnaie_destination_resolue, "destination"
    )

    op_sortante, op_entrante = crud.update_virement(
        db, operations, virement, compte_source, compte_destination
    )
    return schemas.VirementRead(
        virement_id=virement_id,
        operation_sortante=op_sortante,
        operation_entrante=op_entrante,
    )


@router.get("/{virement_id}", response_model=schemas.VirementRead)
def read_virement(virement_id: str, db: Session = Depends(get_db)):
    operations = crud.get_virement(db, virement_id)
    if not operations:
        raise HTTPException(status_code=404, detail="Virement introuvable")

    sortante = next(o for o in operations if o.sens == Sens.transfert_sortant)
    entrante = next(o for o in operations if o.sens == Sens.transfert_entrant)
    return schemas.VirementRead(
        virement_id=virement_id,
        operation_sortante=sortante,
        operation_entrante=entrante,
    )


@router.delete("/{virement_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_virement(virement_id: str, db: Session = Depends(get_db)):
    operations = crud.get_virement(db, virement_id)
    if not operations:
        raise HTTPException(status_code=404, detail="Virement introuvable")
    crud.delete_virement(db, operations)
