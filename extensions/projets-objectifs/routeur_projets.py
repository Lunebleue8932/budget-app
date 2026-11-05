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
from app import crud, models, schemas
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


def _periode_et_montants(db: Session, payload: schemas.SousFiltreBase) -> dict:
    """Ce que le formulaire dit de la période et du montant à tenir, prêt à écrire.

    LA MONNAIE NE SERT QU'AVEC UN MONTANT : sans maximum ni minimum elle est effacée. Avec un montant
    et sans monnaie, c'est la première monnaie de l'app — un seul choix possible tant que
    l'extension « Monnaies » n'a rien ajouté."""
    monnaie_id = payload.monnaie_cible_id
    if payload.montant_max is None and payload.montant_min is None:
        monnaie_id = None
    elif monnaie_id is None:
        premiere = db.query(models.Monnaie).order_by(models.Monnaie.id).first()
        monnaie_id = premiere.id if premiere else None
    elif db.get(models.Monnaie, monnaie_id) is None:
        raise HTTPException(status_code=404, detail="Monnaie introuvable")
    return {
        "date_debut": payload.date_debut,
        "date_fin": payload.date_fin,
        "montant_max": payload.montant_max,
        "montant_min": payload.montant_min,
        "monnaie_cible_id": monnaie_id,
        "visible_dashboard": payload.visible_dashboard,
    }


@router.get("", response_model=list[schemas.SousFiltreRead])
def list_projets(reporter_eteintes: bool = False, db: Session = Depends(get_db)):
    """`reporter_eteintes` : les conversions vers une monnaie éteinte comptent dans le total de la
    monnaie d'origine (cf. service_projets.totaux_par_monnaie) — le réglage de l'écran."""
    return [
        service.lire_sous_filtre(sf, reporter_eteintes=reporter_eteintes)
        for sf in crud.list_sous_filtres(db)
    ]


@router.post("", response_model=schemas.SousFiltreRead, status_code=201)
def create_projet(payload: schemas.SousFiltreCreate, db: Session = Depends(get_db)):
    nom = payload.nom.strip()
    _verifier_nom_libre(db, nom)
    sous_filtre = crud.create_sous_filtre(
        db, nom=nom, description=payload.description, **_periode_et_montants(db, payload)
    )
    return service.lire_sous_filtre(sous_filtre)


# Déclaré avant /{projet_id} : sinon "reordonner" serait capturé comme un id.
@router.put("/reordonner")
def reordonner_projets(payload: schemas.ReordonnerSousFiltres, db: Session = Depends(get_db)):
    crud.reordonner_sous_filtres(db, payload.ids)
    return {"reordonnes": len(payload.ids)}


@router.get("/{projet_id}", response_model=schemas.SousFiltreRead)
def get_projet(projet_id: int, reporter_eteintes: bool = False, db: Session = Depends(get_db)):
    # LE PROJET OUVERT porte ses cascades ; la liste, non (cf. lire_sous_filtre).
    return service.lire_sous_filtre(
        _get_sous_filtre_ou_404(db, projet_id), db, reporter_eteintes=reporter_eteintes
    )


@router.put("/{projet_id}", response_model=schemas.SousFiltreRead)
def update_projet(
    projet_id: int, payload: schemas.SousFiltreUpdate, db: Session = Depends(get_db)
):
    sous_filtre = _get_sous_filtre_ou_404(db, projet_id)
    nom = payload.nom.strip()
    _verifier_nom_libre(db, nom, sauf_id=projet_id)
    crud.update_sous_filtre(
        db,
        sous_filtre,
        nom=nom,
        description=payload.description,
        **_periode_et_montants(db, payload),
    )
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
    # TOUTES celles que le projet regroupe, sous-projets compris (cf. SousFiltre.operations_effectives) :
    # l'écran range ensuite chacune dans son volet d'après `operation_ids` du projet et de ses
    # sous-projets.
    return [_build_operation_read(db, operation) for operation in sous_filtre.operations_effectives]


@router.post("/{projet_id}/sous-projets")
def ranger_sous_projets(
    projet_id: int, payload: schemas.SousFiltreSousProjets, db: Session = Depends(get_db)
):
    """Range des projets sous celui-ci : leurs opérations passent dans un volet, et pour les chiffres
    c'est comme si elles avaient été versées ici. Refusé (409) pour un projet qui est déjà au-dessus de
    celui-ci (un cycle) ou déjà rangé sous un autre."""
    parent = _get_sous_filtre_ou_404(db, projet_id)
    enfants = []
    for enfant_id in dict.fromkeys(payload.ids):
        enfant = crud.get_sous_filtre(db, enfant_id)
        if enfant is None:
            raise HTTPException(status_code=404, detail="Projet introuvable")
        erreur = crud.erreur_sous_projet(parent, enfant)
        if erreur:
            raise HTTPException(status_code=409, detail=erreur)
        enfants.append(enfant)
    return {"ranges": crud.ranger_sous_projets(db, parent, enfants)}


@router.delete("/{projet_id}/sous-projets")
def sortir_sous_projets(
    projet_id: int, payload: schemas.SousFiltreSousProjets, db: Session = Depends(get_db)
):
    """Sort ces sous-projets de celui-ci : ils redeviennent des projets de tête. Rien n'est supprimé."""
    parent = _get_sous_filtre_ou_404(db, projet_id)
    return {"sortis": crud.sortir_sous_projets(db, parent, payload.ids)}


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
