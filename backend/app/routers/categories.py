from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from .. import crud, schemas
from ..constants import CATEGORIE_AUTRES
from ..database import get_db

router = APIRouter(prefix="/categories", tags=["categories"])


@router.get("", response_model=list[schemas.CategorieRead])
def list_categories(db: Session = Depends(get_db)):
    # Plus de paramètre `inclure_systeme` : depuis la migration 0019 la table
    # ne contient plus que de vraies catégories de dépense.
    return crud.get_categories(db)


@router.post("", response_model=schemas.CategorieRead, status_code=status.HTTP_201_CREATED)
def create_categorie(categorie: schemas.CategorieCreate, db: Session = Depends(get_db)):
    if crud.get_categorie_by_nom(db, categorie.nom) is not None:
        raise HTTPException(status_code=409, detail="Une catégorie avec ce nom existe déjà")
    return crud.create_categorie(db, categorie)


def _valider_monnaie(db: Session, monnaie_id: int) -> None:
    if crud.get_monnaie(db, monnaie_id) is None:
        raise HTTPException(status_code=404, detail="Monnaie introuvable")


@router.get("/budgets", response_model=list[schemas.BudgetCategorieRead])
def list_budgets_toutes_categories(
    annee: int, mois: int, monnaie_id: int, db: Session = Depends(get_db)
):
    """Budget résolu (avec héritage en cascade) de chaque catégorie pour un mois
    ET une monnaie donnés — pour la page de gestion des budgets.

    La monnaie est obligatoire : une catégorie dépensée en euros et en dollars a
    deux budgets distincts, jamais un seul mélangé."""
    if mois < 1 or mois > 12:
        raise HTTPException(status_code=400, detail="mois doit être entre 1 et 12")
    _valider_monnaie(db, monnaie_id)
    return [
        schemas.BudgetCategorieRead(
            categorie_id=categorie.id,
            categorie_nom=categorie.nom,
            annee=annee,
            mois=mois,
            monnaie_id=monnaie_id,
            montant=crud.get_budget_categorie(db, categorie.id, annee, mois, monnaie_id),
            explicite=crud.budget_categorie_est_explicite(
                db, categorie.id, annee, mois, monnaie_id
            ),
        )
        for categorie in crud.get_categories(db)
    ]


@router.get("/{categorie_id}/budgets", response_model=list[schemas.BudgetMensuelRead])
def list_budgets_categorie(categorie_id: int, monnaie_id: int, db: Session = Depends(get_db)):
    """Liste des mois ayant une valeur explicitement définie pour cette
    catégorie dans cette monnaie (pas d'entrées héritées)."""
    db_categorie = crud.get_categorie(db, categorie_id)
    if db_categorie is None:
        raise HTTPException(status_code=404, detail="Catégorie introuvable")
    _valider_monnaie(db, monnaie_id)
    return [
        schemas.BudgetMensuelRead(
            annee=b.annee, mois=b.mois, monnaie_id=monnaie_id, montant=b.montant, explicite=True
        )
        for b in crud.get_budgets_explicites_categorie(db, categorie_id, monnaie_id)
    ]


@router.put("/{categorie_id}/budget", response_model=schemas.BudgetMensuelRead)
def set_budget_categorie(
    categorie_id: int,
    annee: int,
    mois: int,
    monnaie_id: int,
    updates: schemas.BudgetMensuelSet,
    db: Session = Depends(get_db),
):
    if mois < 1 or mois > 12:
        raise HTTPException(status_code=400, detail="mois doit être entre 1 et 12")
    db_categorie = crud.get_categorie(db, categorie_id)
    if db_categorie is None:
        raise HTTPException(status_code=404, detail="Catégorie introuvable")
    _valider_monnaie(db, monnaie_id)
    crud.set_budget_categorie(db, categorie_id, annee, mois, monnaie_id, updates.montant)
    return schemas.BudgetMensuelRead(
        annee=annee,
        mois=mois,
        monnaie_id=monnaie_id,
        montant=updates.montant,
        explicite=True,
    )


@router.put("/{categorie_id}/visibilite", response_model=schemas.CategorieRead)
def set_visibilite_categorie(
    categorie_id: int,
    updates: schemas.CategorieVisibiliteUpdate,
    db: Session = Depends(get_db),
):
    """Allume ou éteint une catégorie sur le dashboard (œil de l'onglet
    Catégories).

    Aucune contrainte, pas même sur « Autres » : c'est un réglage d'affichage,
    et tout éteindre ne fait qu'un histogramme vide — un état parfaitement
    réversible, contrairement à une suppression."""
    db_categorie = crud.get_categorie(db, categorie_id)
    if db_categorie is None:
        raise HTTPException(status_code=404, detail="Catégorie introuvable")
    return crud.set_visibilite_dashboard_categorie(
        db, db_categorie, updates.visible_dashboard
    )


@router.put("/reordonner", response_model=list[schemas.CategorieRead])
def reordonner_categories(payload: schemas.ReordonnerCategoriesInput, db: Session = Depends(get_db)):
    """Applique le nouvel ordre d'affichage issu d'un glisser-déposer côté
    frontend : `ordre` liste les ids des catégories dans l'ordre voulu."""
    crud.reordonner_categories(db, payload.ordre)
    return crud.get_categories(db)


@router.delete("/{categorie_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_categorie(categorie_id: int, db: Session = Depends(get_db)):
    db_categorie = crud.get_categorie(db, categorie_id)
    if db_categorie is None:
        raise HTTPException(status_code=404, detail="Catégorie introuvable")
    if db_categorie.nom == CATEGORIE_AUTRES:
        raise HTTPException(
            status_code=400,
            detail="La catégorie 'Autres' ne peut pas être supprimée",
        )
    # Les opérations de cette catégorie basculent vers "Autres" plutôt que de
    # bloquer la suppression.
    crud.migrer_operations_vers_autres(db, db_categorie)
    crud.delete_categorie(db, db_categorie)
