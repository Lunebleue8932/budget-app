from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

# Imports ABSOLUS vers le noyau : ce module n'est pas un sous-paquet de `app`,
# il est chargé par chemin de fichier (cf. extensions/README.md).
from app import crud, schemas
from app.constants import TYPES_AVEC_CATEGORIE_LIBRE, TYPES_INTERNES, TypeOperation
from app.database import get_db

router = APIRouter(prefix="/regles-categorisation", tags=["regles"])


def _get_regle_ou_404(db: Session, regle_id: int):
    regle = crud.get_regle_categorisation(db, regle_id)
    if regle is None:
        raise HTTPException(status_code=404, detail="Règle introuvable")
    return regle


def _valider_action(db: Session, type_id: int, categorie_id, compte_autre_id):
    """(catégorie, compte en face) retenus pour ce type d'action.

    La structure des conditions est déjà validée par les schémas Pydantic
    (champs connus, valeur non vide, au moins un groupe) ; restent l'existence
    du type, de la catégorie et du compte visés, qui demandent la base.

    Les deux sont NEUTRALISÉS pour les types qui ne les admettent pas, plutôt
    que rejetés : changer de type dans l'interface ne doit jamais laisser une
    combinaison incohérente en base. La catégorie n'a de sens que pour les types
    à catégorie libre, le compte en face que pour le virement interne — seul
    type qui touche deux comptes."""
    type_operation = crud.get_type_operation(db, type_id)
    if type_operation is None:
        raise HTTPException(status_code=404, detail="Type d'opération introuvable")
    code = TypeOperation(type_operation.code)
    if code in TYPES_INTERNES:
        # Un mouvement de titres ne se déduit pas d'un libellé bancaire : il lui
        # manquerait le titre, la quantité et le prix.
        raise HTTPException(
            status_code=400,
            detail=(
                f"Le type « {type_operation.nom} » ne peut pas être posé par une règle : "
                "les achats/ventes de titres se saisissent depuis la page Placements financiers."
            ),
        )

    compte_retenu = None
    if code == TypeOperation.virement and compte_autre_id is not None:
        if crud.get_compte(db, compte_autre_id) is None:
            raise HTTPException(status_code=404, detail="Compte en face introuvable")
        compte_retenu = compte_autre_id

    if code not in TYPES_AVEC_CATEGORIE_LIBRE:
        return None, compte_retenu
    if categorie_id is not None and crud.get_categorie(db, categorie_id) is None:
        raise HTTPException(status_code=404, detail="Catégorie introuvable")
    return categorie_id, compte_retenu


@router.get("", response_model=list[schemas.RegleCategorisationRead])
def list_regles(db: Session = Depends(get_db)):
    return crud.list_regles_categorisation(db)


@router.post("", response_model=schemas.RegleCategorisationRead, status_code=201)
def create_regle(payload: schemas.RegleCategorisationCreate, db: Session = Depends(get_db)):
    categorie_id, compte_autre_id = _valider_action(
        db, payload.type_id, payload.categorie_id, payload.compte_autre_id
    )
    return crud.create_regle_categorisation(
        db,
        nom=payload.nom,
        conditions=payload.conditions.model_dump(mode="json"),
        type_id=payload.type_id,
        categorie_id=categorie_id,
        compte_autre_id=compte_autre_id,
        actif=payload.actif,
        arreter_apres=payload.arreter_apres,
    )


# Déclaré avant /{regle_id} : sinon "reordonner" serait capturé comme un id.
@router.put("/reordonner")
def reordonner_regles(payload: schemas.ReordonnerRegles, db: Session = Depends(get_db)):
    crud.reordonner_regles_categorisation(db, payload.ids)
    return {"reordonnees": len(payload.ids)}


@router.get("/{regle_id}", response_model=schemas.RegleCategorisationRead)
def get_regle(regle_id: int, db: Session = Depends(get_db)):
    return _get_regle_ou_404(db, regle_id)


@router.put("/{regle_id}", response_model=schemas.RegleCategorisationRead)
def update_regle(
    regle_id: int, payload: schemas.RegleCategorisationUpdate, db: Session = Depends(get_db)
):
    regle = _get_regle_ou_404(db, regle_id)
    categorie_id, compte_autre_id = _valider_action(
        db, payload.type_id, payload.categorie_id, payload.compte_autre_id
    )
    return crud.update_regle_categorisation(
        db,
        regle,
        nom=payload.nom,
        conditions=payload.conditions.model_dump(mode="json"),
        type_id=payload.type_id,
        categorie_id=categorie_id,
        compte_autre_id=compte_autre_id,
        actif=payload.actif,
        arreter_apres=payload.arreter_apres,
    )


@router.delete("/{regle_id}")
def delete_regle(regle_id: int, db: Session = Depends(get_db)):
    regle = _get_regle_ou_404(db, regle_id)
    crud.delete_regle_categorisation(db, regle)
    return {"supprime": True}
