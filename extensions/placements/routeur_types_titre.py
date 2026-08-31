"""Les étiquettes qu'on pose sur un titre : « ETF », « Obligation », « SCPI »…

RIEN QU'UN LIBELLÉ. Aucun calcul de l'application ne les lit — ni un solde, ni
une valorisation, ni une plus-value. Elles servent à REGROUPER pour regarder
(l'extension « Vue d'ensemble des placements » en tire son camembert
d'exposition), et c'est ce qui permet de les laisser entièrement libres : il n'y
a aucun libellé dont le code dépendrait, donc aucun à protéger.

CONSÉQUENCE SUR LA SUPPRESSION : elle ne se refuse jamais. Supprimer un type
détype les titres qui le portaient, et n'emporte rien d'autre (cf.
crud.delete_type_titre). C'est ce qui distingue cette table de `type_compte`,
dont deux valeurs pilotent des règles métier et sont donc indéboulonnables.
"""
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app import crud, schemas
from app.database import get_db

router = APIRouter(prefix="/types-titre", tags=["placements"])


def _read(type_titre, nb_titres: int = 0) -> schemas.TypeTitreRead:
    return schemas.TypeTitreRead(
        id=type_titre.id,
        nom=type_titre.nom,
        ordre=type_titre.ordre,
        nb_titres=nb_titres,
    )


@router.get("", response_model=list[schemas.TypeTitreRead])
def list_types_titre(db: Session = Depends(get_db)):
    """Tous les types, avec le nombre de titres que chacun porte.

    Le compte voyage avec la liste plutôt que d'être demandé à part : l'écran de
    gestion l'affiche sur chaque ligne, et supprimer un type qui en typait douze
    ne doit pas se faire à l'aveugle."""
    comptes = crud.compter_titres_par_type(db)
    return [
        _read(type_titre, comptes.get(type_titre.id, 0))
        for type_titre in crud.get_types_titre(db)
    ]


@router.post("", response_model=schemas.TypeTitreRead, status_code=status.HTTP_201_CREATED)
def create_type_titre(payload: schemas.TypeTitreCreate, db: Session = Depends(get_db)):
    nom = payload.nom.strip()
    if not nom:
        raise HTTPException(status_code=422, detail="Le nom ne peut pas être vide")
    if crud.get_type_titre_by_nom(db, nom):
        raise HTTPException(status_code=409, detail="Ce type de titre existe déjà")
    return _read(crud.create_type_titre(db, nom))


@router.put("/{type_titre_id}", response_model=schemas.TypeTitreRead)
def update_type_titre(
    type_titre_id: int, payload: schemas.TypeTitreUpdate, db: Session = Depends(get_db)
):
    """Renommer, ou déplacer dans la liste.

    UN RENOMMAGE SUFFIT À RETYPER TOUT LE PORTEFEUILLE : les titres pointent sur
    la ligne, pas sur son libellé. C'est précisément ce qu'une colonne texte sur
    chaque titre n'aurait pas permis."""
    type_titre = crud.get_type_titre(db, type_titre_id)
    if type_titre is None:
        raise HTTPException(status_code=404, detail="Type de titre introuvable")
    nom = payload.nom.strip() if payload.nom is not None else None
    if nom is not None:
        if not nom:
            raise HTTPException(status_code=422, detail="Le nom ne peut pas être vide")
        existant = crud.get_type_titre_by_nom(db, nom)
        if existant and existant.id != type_titre_id:
            raise HTTPException(status_code=409, detail="Ce type de titre existe déjà")
    crud.update_type_titre(db, type_titre, nom=nom, ordre=payload.ordre)
    comptes = crud.compter_titres_par_type(db)
    return _read(type_titre, comptes.get(type_titre.id, 0))


@router.delete("/{type_titre_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_type_titre(type_titre_id: int, db: Session = Depends(get_db)):
    """Supprime le type. Les titres qui le portaient redeviennent non typés,
    rien d'autre ne bouge.

    AUCUN REFUS, MÊME UTILISÉ. Un type n'est qu'une façon de regarder : la
    supprimer ne réécrit aucun montant et ne perd aucun mouvement. Refuser
    obligerait à détyper douze titres un à un pour se débarrasser d'une étiquette
    qu'on juge mal choisie — le compte rendu par `nb_titres` sur la liste suffit
    à ce que le geste soit informé."""
    type_titre = crud.get_type_titre(db, type_titre_id)
    if type_titre is None:
        raise HTTPException(status_code=404, detail="Type de titre introuvable")
    crud.delete_type_titre(db, type_titre)
