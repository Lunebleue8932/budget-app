from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, field_validator
from sqlalchemy.orm import Session

# Imports ABSOLUS vers le noyau : ce module est chargé par chemin de fichier (cf. extensions/README.md).
from app import models
from app.database import get_db
from app.services import renommages

router = APIRouter(prefix="/renommages", tags=["renommages"])


class RenommageEcriture(BaseModel):
    nom_origine: str
    nom_nouveau: str
    #: Renomme aussi, dans la base, les opérations qui portent déjà le libellé d'origine
    #: (cf. `renommages.appliquer_aux_operations`). Sans effet sur une modification.
    appliquer_aux_operations: bool = False

    @field_validator("nom_origine", "nom_nouveau")
    @classmethod
    def _non_vide(cls, valeur: str) -> str:
        valeur = (valeur or "").strip()
        if not valeur:
            raise ValueError("le libellé ne peut pas être vide")
        return valeur


class RenommageLecture(BaseModel):
    id: int
    nom_origine: str
    nom_nouveau: str
    origine: str
    cree_le: Optional[datetime] = None
    #: Renseigné à la création seulement : combien d'opérations ont été renommées avec l'entrée.
    operations_renommees: int = 0
    #: Permanent (l'import l'applique) ou « à valider » (cf. models.Renommage.valide).
    valide: bool = True
    #: Renseigné par la liste : combien d'opérations de la base porteraient encore le libellé d'origine
    #: sous un autre nom que le nouveau — ce que « Appliquer aux opérations existantes » renommerait.
    operations_a_renommer: int = 0

    model_config = {"from_attributes": True}


class OperationsConcernees(BaseModel):
    nombre: int


class LotIds(BaseModel):
    ids: list[int]


class NombreTouche(BaseModel):
    nombre: int


class ATrancherLecture(BaseModel):
    """Un libellé vu à l'import qui ressemble à un libellé déjà renommé."""

    id: int
    libelle: str
    # L'entrée dont il se rapproche, et le nom qu'on lui donnerait.
    nom_origine: str
    nom_nouveau: str
    score: float
    #: « inclusion », « mots », « caracteres » ou « prefixe » (cf. services/renommages).
    outil: str


def _entree_ou_404(db: Session, renommage_id: int) -> models.Renommage:
    entree = db.get(models.Renommage, renommage_id)
    if entree is None:
        raise HTTPException(status_code=404, detail="Renommage introuvable")
    return entree


@router.get("", response_model=list[RenommageLecture])
def lister(db: Session = Depends(get_db)):
    """Tous les renommages, les plus récents d'abord — permanents et « à valider » ensemble : la page les
    range d'après `valide`."""
    entrees = (
        db.query(models.Renommage)
        .order_by(models.Renommage.cree_le.desc(), models.Renommage.id.desc())
        .all()
    )
    nombres = renommages.nombres_a_renommer(db, entrees)
    lectures = []
    for entree in entrees:
        lecture = RenommageLecture.model_validate(entree)
        lecture.operations_a_renommer = nombres.get(entree.id, 0)
        lectures.append(lecture)
    return lectures


@router.post("/valider", response_model=NombreTouche)
def valider(corps: LotIds, db: Session = Depends(get_db)):
    """Rend permanents les renommages désignés : l'import les applique dès le prochain relevé."""
    return NombreTouche(nombre=renommages.valider(db, corps.ids))


@router.post("/supprimer-lot", response_model=NombreTouche)
def supprimer_lot(corps: LotIds, db: Session = Depends(get_db)):
    """Oublie les renommages désignés (nettoyage de la pile ou de la liste). Aucune opération déjà
    écrite n'est touchée."""
    return NombreTouche(nombre=renommages.supprimer_lot(db, corps.ids))


@router.post("/{renommage_id}/appliquer", response_model=RenommageLecture)
def appliquer(renommage_id: int, db: Session = Depends(get_db)):
    """« Appliquer aux opérations existantes » pour un renommage déjà créé : renomme dans la base les
    opérations qui portent son libellé d'origine."""
    entree = _entree_ou_404(db, renommage_id)
    renommees = renommages.appliquer_aux_operations(db, entree)
    lecture = RenommageLecture.model_validate(entree)
    lecture.operations_renommees = renommees
    return lecture


@router.get("/operations-concernees", response_model=OperationsConcernees)
def operations_concernees(libelle: str = "", db: Session = Depends(get_db)):
    """Combien d'opérations de la base portent ce libellé : de quoi savoir, avant d'ajouter un
    renommage, s'il a quelque chose à rattraper."""
    return OperationsConcernees(nombre=len(renommages.operations_portant(db, libelle)))


@router.get("/a-trancher", response_model=list[ATrancherLecture])
def a_trancher(db: Session = Depends(get_db)):
    """Les libellés que l'import a vus et qui ressemblent à un renommage sans lui être identiques.
    L'import ne propose rien : c'est ici qu'on tranche. Les refusés n'y figurent plus."""
    points = (
        db.query(models.RenommageATrancher)
        .filter(models.RenommageATrancher.refuse.is_(False))
        .order_by(models.RenommageATrancher.score.desc(), models.RenommageATrancher.id)
        .all()
    )
    return [
        ATrancherLecture(
            id=p.id,
            libelle=p.libelle,
            nom_origine=p.entree.nom_origine,
            nom_nouveau=p.entree.nom_nouveau,
            score=p.score,
            outil=p.outil,
        )
        for p in points
        if p.entree is not None
    ]


@router.post("/a-trancher/{point_id}/accepter", response_model=RenommageLecture)
def accepter(point_id: int, db: Session = Depends(get_db)):
    """Accepte : le libellé reçoit le nom de l'entrée voisine, et devient un renommage comme les autres."""
    entree = renommages.accepter(db, point_id)
    if entree is None:
        raise HTTPException(status_code=404, detail="Ce point n'existe plus.")
    return entree


@router.post("/a-trancher/{point_id}/refuser", status_code=204)
def refuser(point_id: int, db: Session = Depends(get_db)):
    """Refuse : le libellé ne sera plus reposé."""
    if not renommages.refuser(db, point_id):
        raise HTTPException(status_code=404, detail="Ce point n'existe plus.")


@router.post("", response_model=RenommageLecture, status_code=201)
def creer(corps: RenommageEcriture, db: Session = Depends(get_db)):
    """Écrit un renommage à la main. Un libellé déjà connu voit son nom remplacé."""
    if corps.nom_origine == corps.nom_nouveau:
        raise HTTPException(
            status_code=400, detail="Le nouveau nom est identique au libellé d'origine."
        )
    entree = renommages.enregistrer(db, corps.nom_origine, corps.nom_nouveau, "manuel")
    if entree is None:
        raise HTTPException(status_code=400, detail="Renommage impossible.")
    lecture = RenommageLecture.model_validate(entree)
    if corps.appliquer_aux_operations:
        lecture.operations_renommees = renommages.appliquer_aux_operations(db, entree)
    return lecture


@router.put("/{renommage_id}", response_model=RenommageLecture)
def modifier(renommage_id: int, corps: RenommageEcriture, db: Session = Depends(get_db)):
    """Change le nom (et, si besoin, le libellé d'origine) d'une entrée."""
    entree = _entree_ou_404(db, renommage_id)
    nouvelle_cle = renommages.cle(corps.nom_origine)
    autre = (
        db.query(models.Renommage)
        .filter(models.Renommage.cle == nouvelle_cle, models.Renommage.id != entree.id)
        .one_or_none()
    )
    if autre is not None:
        raise HTTPException(status_code=409, detail="Ce libellé a déjà un renommage.")
    entree.cle = nouvelle_cle
    entree.nom_origine = corps.nom_origine
    entree.nom_nouveau = corps.nom_nouveau
    db.commit()
    db.refresh(entree)
    return entree


@router.delete("/{renommage_id}", status_code=204)
def supprimer(renommage_id: int, db: Session = Depends(get_db)):
    """Oublie un renommage : les prochains relevés ne le reconnaîtront plus. Aucune opération
    déjà écrite n'est touchée."""
    renommages._supprimer(db, _entree_ou_404(db, renommage_id))
    db.commit()
