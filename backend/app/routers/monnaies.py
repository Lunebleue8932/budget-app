"""Lecture des monnaies, et le nom de celle de l'application.

LA LECTURE, plus un seul droit d'écriture. Créer, renommer à volonté et
supprimer une monnaie relèvent de l'extension « Monnaies »
(extensions/monnaies/routeur_monnaies.py) : c'est le droit d'en avoir PLUSIEURS
qui est optionnel. La lecture ne l'est pas — afficher un montant demande de
connaître son symbole, et c'est vrai de tous les écrans, extension installée
ou non.

Le droit d'écriture du noyau est `PUT /monnaies/application` : changer le nom et
le symbole de LA monnaie de l'application, parce que tout le monde ne compte pas
en euros. Sans l'extension, il n'y en a qu'une, et c'est le seul moyen de la
renommer.
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from .. import crud, schemas
from ..database import get_db

router = APIRouter(prefix="/monnaies", tags=["monnaies"])


@router.get("", response_model=list[schemas.MonnaieRead])
def list_monnaies(db: Session = Depends(get_db)):
    return crud.get_monnaies(db)


@router.put("/application", response_model=schemas.MonnaieRead)
def renommer_monnaie_application(
    updates: schemas.MonnaieUpdate, db: Session = Depends(get_db)
):
    """Change le nom et le symbole de la monnaie de l'application.

    LA MONNAIE DE L'APPLICATION est la première (celle d'`ordre` le plus bas) :
    celle que la migration 0021 a posée et que tous les comptes portent, sans
    l'extension « Monnaies ». Ses montants ne changent pas, seul son libellé.
    Déclarée AVANT la route `/{monnaie_id}` de l'extension (le noyau est monté
    le premier) : « application » n'est pas un identifiant.
    """
    monnaies = crud.get_monnaies(db)
    if not monnaies:
        raise HTTPException(status_code=404, detail="Monnaie introuvable")
    monnaie = monnaies[0]
    nom = updates.nom.strip() if updates.nom is not None else None
    symbole = updates.symbole.strip() if updates.symbole is not None else None
    if nom == "" or symbole == "":
        raise HTTPException(status_code=422, detail="Le nom et le symbole ne peuvent pas être vides")
    if nom is not None and nom != monnaie.nom:
        autre = crud.get_monnaie_by_nom(db, nom)
        if autre is not None and autre.id != monnaie.id:
            raise HTTPException(status_code=409, detail="Une monnaie avec ce nom existe déjà")
    return crud.update_monnaie(db, monnaie, nom=nom, symbole=symbole)
