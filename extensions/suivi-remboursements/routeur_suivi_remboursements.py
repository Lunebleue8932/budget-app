"""Les routes du suivi des remboursements, sous `/suivi-remboursements`.

CE QUE L'EXTENSION ÉCRIT, ET C'EST TOUT : la colonne
`operation.profil_remboursement_id`, et les profils eux-mêmes. Aucune opération
n'est créée, modifiée dans son montant, ni supprimée ici. C'est ce qui permet de
dire qu'éteindre l'extension ne change aucun chiffre de l'application : elle ne
fait que ventiler par profil des dettes que le noyau calculait déjà.

LE PRÉFIXE. `/suivi-remboursements` n'est le paramètre d'aucune autre route et
n'appartient à aucune autre extension (cf. extensions/README.md, « choisir son
préfixe ») : `/remboursements` aurait été plus court et bien plus dangereux — le
noyau sert déjà des types d'opération de ce nom, et rien dans FastAPI ne signale
un préfixe capté par une route voisine.
"""
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

# Imports ABSOLUS vers le noyau : ce module n'est pas un sous-paquet de `app`,
# il est chargé par chemin de fichier (cf. extensions/README.md).
from app import models
from app.database import get_db

import schemas_suivi_remboursements as schemas_sr
import service_suivi_remboursements as service

router = APIRouter(prefix="/suivi-remboursements", tags=["suivi-remboursements"])


def _get_profil_ou_404(db: Session, profil_id: int) -> models.ProfilRemboursement:
    profil = db.get(models.ProfilRemboursement, profil_id)
    if profil is None:
        raise HTTPException(status_code=404, detail="Profil introuvable")
    return profil


def _refuser_doublon(db: Session, nom: str, sauf_id: int | None = None) -> None:
    """Deux profils du même nom seraient impossibles à départager dans un menu
    déroulant — et c'est par un menu déroulant qu'on les choisit."""
    requete = db.query(models.ProfilRemboursement).filter(
        models.ProfilRemboursement.nom == nom
    )
    if sauf_id is not None:
        requete = requete.filter(models.ProfilRemboursement.id != sauf_id)
    if requete.first() is not None:
        raise HTTPException(status_code=409, detail="Un profil porte déjà ce nom")


# ---------- La vue d'ensemble ----------


@router.get("/vue", response_model=schemas_sr.VueSuiviRead)
def get_vue(db: Session = Depends(get_db)):
    """Qui doit combien à qui, par monnaie. Déclarée AVANT `/profils/{id}` par
    précaution de lecture, même si les deux chemins ne se recouvrent pas."""
    return service.vue(db)


@router.get("/profils/{profil_id}/operations", response_model=list[schemas_sr.OperationSuiviRead])
def get_operations_profil(profil_id: int, db: Session = Depends(get_db)):
    _get_profil_ou_404(db, profil_id)
    return service.operations_du_profil(db, profil_id)


# ---------- Les profils ----------


@router.get("/profils", response_model=list[schemas_sr.ProfilRead])
def list_profils(db: Session = Depends(get_db)):
    return (
        db.query(models.ProfilRemboursement)
        .order_by(models.ProfilRemboursement.ordre, models.ProfilRemboursement.id)
        .all()
    )


@router.post("/profils", response_model=schemas_sr.ProfilRead, status_code=status.HTTP_201_CREATED)
def create_profil(payload: schemas_sr.ProfilCreate, db: Session = Depends(get_db)):
    nom = payload.nom.strip()
    if not nom:
        raise HTTPException(status_code=400, detail="Le nom d'un profil ne peut pas être vide")
    _refuser_doublon(db, nom)
    # En fin de liste : un profil neuf se range où on le crée, et le
    # glisser-déposer dit ensuite où il doit vraiment être.
    dernier = (
        db.query(models.ProfilRemboursement.ordre)
        .order_by(models.ProfilRemboursement.ordre.desc())
        .first()
    )
    profil = models.ProfilRemboursement(
        nom=nom,
        description=payload.description.strip(),
        ordre=(dernier[0] + 1) if dernier else 0,
    )
    db.add(profil)
    db.commit()
    db.refresh(profil)
    return profil


@router.put("/profils/reordonner", response_model=list[schemas_sr.ProfilRead])
def reordonner_profils(
    payload: schemas_sr.ReordonnerProfilsInput, db: Session = Depends(get_db)
):
    """Le nouvel ordre d'affichage, issu d'un glisser-déposer.

    DÉCLARÉE AVANT `/profils/{profil_id}` : FastAPI essaie les routes dans
    l'ordre de déclaration et lirait sinon « reordonner » comme un identifiant,
    en rendant 422 sans que rien ne le signale. Même piège que
    `/comptes/reordonner` dans le noyau. Les ids inconnus
    sont ignorés plutôt que refusés : l'écran envoie ce qu'il affiche, et une
    suppression concurrente ne doit pas faire échouer un réordonnancement."""
    for position, profil_id in enumerate(payload.ordre):
        profil = db.get(models.ProfilRemboursement, profil_id)
        if profil is not None:
            profil.ordre = position
    db.commit()
    return list_profils(db)


@router.put("/profils/{profil_id}", response_model=schemas_sr.ProfilRead)
def update_profil(
    profil_id: int, payload: schemas_sr.ProfilUpdate, db: Session = Depends(get_db)
):
    profil = _get_profil_ou_404(db, profil_id)
    if payload.nom is not None:
        nom = payload.nom.strip()
        if not nom:
            raise HTTPException(
                status_code=400, detail="Le nom d'un profil ne peut pas être vide"
            )
        _refuser_doublon(db, nom, sauf_id=profil_id)
        profil.nom = nom
    if payload.description is not None:
        profil.description = payload.description.strip()
    db.commit()
    db.refresh(profil)
    return profil


@router.delete("/profils/{profil_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_profil(profil_id: int, db: Session = Depends(get_db)):
    """SUPPRIMER UN PROFIL DÉTACHE SES OPÉRATIONS, il ne les emporte jamais
    (`ondelete="SET NULL"`, cf. migration 0054). Ce sont de vraies écritures qui
    bougent de vrais soldes : les perdre parce qu'on efface le nom d'une
    connaissance serait un désastre silencieux. Rien à refuser ici, donc — un
    profil se supprime toujours, ses dettes retournent dans « Sans profil »."""
    profil = _get_profil_ou_404(db, profil_id)
    db.delete(profil)
    db.commit()


# ---------- Le rattachement ----------


@router.put("/rattachement", response_model=schemas_sr.VueSuiviRead)
def rattacher(payload: schemas_sr.RattachementInput, db: Session = Depends(get_db)):
    """Dit à qui se rapportent une ou plusieurs opérations — `profil_id` à None
    les détache.

    PAR LOTS, parce que c'est ainsi qu'on range : après un voyage, dix lignes
    reviennent à la même personne, et les rattacher une par une aurait fait dix
    allers-retours pour un seul geste de pensée.

    SEULS LES QUATRE TYPES DE REMBOURSEMENT SE RATTACHENT (cf.
    service.TYPES_RATTACHABLES). Rattacher une opération classique à « Marie »
    n'aurait rien à réclamer ni à rendre : la ligne apparaîtrait dans son détail
    sans peser sur aucun de ses deux totaux, et le tableau cesserait de
    s'expliquer. Le refus est franc plutôt que silencieux — une opération qu'on
    croit rangée et qui ne l'est pas est pire qu'un message d'erreur.

    RIEN D'AUTRE N'EST TOUCHÉ : ni le montant, ni le reste dû, ni la catégorie.
    C'est une seule colonne qui change.
    """
    if payload.profil_id is not None:
        _get_profil_ou_404(db, payload.profil_id)

    operations = (
        db.query(models.Operation)
        .filter(models.Operation.id.in_(payload.operation_ids))
        .all()
    )
    trouvees = {operation.id for operation in operations}
    manquantes = sorted(set(payload.operation_ids) - trouvees)
    if manquantes:
        raise HTTPException(
            status_code=404,
            detail=f"Opération(s) introuvable(s) : {', '.join(str(i) for i in manquantes)}",
        )

    refusees = [
        operation.nature
        for operation in operations
        if operation.type_code not in service.TYPES_RATTACHABLES
    ]
    if refusees:
        raise HTTPException(
            status_code=400,
            detail=(
                "Seules les dépenses remboursables, les prêts reçus et leurs "
                f"règlements se rattachent à un profil ({', '.join(refusees)})."
            ),
        )

    for operation in operations:
        operation.profil_remboursement_id = payload.profil_id
    db.commit()
    return service.vue(db)
