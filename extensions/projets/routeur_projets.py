"""Les routes des projets, sous `/projets`.

CINQ ROUTES DE LISTE ORDINAIRE (liste, création, modification, suppression,
réordonnancement) et TROIS qui font tout l'intérêt de l'extension :

  - `GET /projets/{id}/operations` : ce que le projet regroupe ;
  - `POST /projets/{id}/operations` : y verser un lot d'opérations ;
  - `DELETE /projets/{id}/operations` : en retirer un lot.

LES DEUX DERNIÈRES NE CRÉENT NI NE SUPPRIMENT AUCUNE OPÉRATION : elles ne
touchent qu'à la table de liaison. Retirer une opération d'un projet la laisse
en base avec son compte, sa catégorie et son montant — c'est toute la différence
entre ce geste et celui de la page Opérations, et c'est pour cela qu'aucun
avertissement ne l'entoure.

PAR LOTS, ET NON UNE PAR UNE : on remplit un projet en cochant plusieurs lignes
d'un même séjour. Une requête par case cochée aurait fait autant d'allers-retours
que de dépenses.
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

# Imports ABSOLUS vers le noyau : ce module n'est pas un sous-paquet de `app`,
# il est chargé par chemin de fichier (cf. extensions/README.md).
from app import crud, schemas
from app.database import get_db
from app.routers.operations import _build_operation_read

import service_projets as service

router = APIRouter(prefix="/projets", tags=["projets"])


def _get_sous_filtre_ou_404(db: Session, sous_filtre_id: int):
    sous_filtre = crud.get_sous_filtre(db, sous_filtre_id)
    if sous_filtre is None:
        raise HTTPException(status_code=404, detail="Projet introuvable")
    return sous_filtre


def _verifier_nom_libre(db: Session, nom: str, sauf_id: int | None = None) -> None:
    """Deux projets du même nom seraient indiscernables dans la liste où on les
    choisit — et le nom est tout ce qu'un projet a d'identifiant pour
    l'utilisateur. La base l'interdit déjà (contrainte d'unicité) ; le dire ici
    donne une phrase lisible plutôt qu'une erreur d'intégrité."""
    existant = crud.get_sous_filtre_par_nom(db, nom)
    if existant is not None and existant.id != sauf_id:
        raise HTTPException(status_code=400, detail=f"Un projet « {nom} » existe déjà")


@router.get("", response_model=list[schemas.SousFiltreRead])
def list_projets(db: Session = Depends(get_db)):
    return [service.lire_sous_filtre(sf) for sf in crud.list_sous_filtres(db)]


@router.post("", response_model=schemas.SousFiltreRead, status_code=201)
def create_projet(payload: schemas.SousFiltreCreate, db: Session = Depends(get_db)):
    nom = payload.nom.strip()
    _verifier_nom_libre(db, nom)
    sous_filtre = crud.create_sous_filtre(db, nom=nom, description=payload.description)
    return service.lire_sous_filtre(sous_filtre)


# Déclaré avant /{projet_id} : sinon "reordonner" serait capturé comme un id.
@router.put("/reordonner")
def reordonner_projets(payload: schemas.ReordonnerSousFiltres, db: Session = Depends(get_db)):
    crud.reordonner_sous_filtres(db, payload.ids)
    return {"reordonnes": len(payload.ids)}


@router.get("/{projet_id}", response_model=schemas.SousFiltreRead)
def get_projet(projet_id: int, db: Session = Depends(get_db)):
    return service.lire_sous_filtre(_get_sous_filtre_ou_404(db, projet_id))


@router.put("/{projet_id}", response_model=schemas.SousFiltreRead)
def update_projet(
    projet_id: int, payload: schemas.SousFiltreUpdate, db: Session = Depends(get_db)
):
    sous_filtre = _get_sous_filtre_ou_404(db, projet_id)
    nom = payload.nom.strip()
    _verifier_nom_libre(db, nom, sauf_id=projet_id)
    crud.update_sous_filtre(db, sous_filtre, nom=nom, description=payload.description)
    return service.lire_sous_filtre(sous_filtre)


@router.delete("/{projet_id}")
def delete_projet(projet_id: int, db: Session = Depends(get_db)):
    """Supprime le projet, et LUI SEUL : les opérations qu'il regroupait restent
    en base, un projet n'étant qu'une vue sur des opérations qui existent sans
    lui."""
    sous_filtre = _get_sous_filtre_ou_404(db, projet_id)
    crud.delete_sous_filtre(db, sous_filtre)
    return {"supprime": True}


@router.get("/{projet_id}/operations", response_model=list[schemas.OperationRead])
def list_operations_du_projet(projet_id: int, db: Session = Depends(get_db)):
    """Les opérations du projet, dans la forme EXACTE que renvoie la page
    Opérations (`_build_operation_read`) : l'écran les affiche avec le même
    rendu, et une seconde forme n'aurait fait diverger les deux."""
    sous_filtre = _get_sous_filtre_ou_404(db, projet_id)
    return [_build_operation_read(db, operation) for operation in sous_filtre.operations]


@router.post("/{projet_id}/operations")
def ajouter_operations(
    projet_id: int, payload: schemas.SousFiltreOperations, db: Session = Depends(get_db)
):
    sous_filtre = _get_sous_filtre_ou_404(db, projet_id)
    ajoutees = crud.ajouter_operations_au_sous_filtre(db, sous_filtre, payload.operation_ids)
    return {"ajoutees": ajoutees}


@router.delete("/{projet_id}/operations")
def retirer_operations(
    projet_id: int, payload: schemas.SousFiltreOperations, db: Session = Depends(get_db)
):
    """Retire du projet, ne supprime rien."""
    sous_filtre = _get_sous_filtre_ou_404(db, projet_id)
    retirees = crud.retirer_operations_du_sous_filtre(db, sous_filtre, payload.operation_ids)
    return {"retirees": retirees}
