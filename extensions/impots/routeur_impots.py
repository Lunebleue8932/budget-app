"""Les routes de l'extension « Impôts », sous `/impots`.

LE PRÉFIXE n'est le paramètre d'aucune autre route et n'appartient à aucune
autre extension (cf. extensions/README.md).

CE QUE CES ROUTES ÉCRIVENT : la table `declaration_impots` (un taux et une date
limite par année) et la case `a_declarer` d'une opération — posée par le sélecteur
de l'écran, retirée par « Retirer ».
Aucune opération n'est créée, supprimée ni modifiée autrement, aucun montant ne
change.
"""
from datetime import date as date_type
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

# Imports ABSOLUS vers le noyau : ce module n'est pas un sous-paquet de `app`,
# il est chargé par chemin de fichier (cf. extensions/README.md).
from app import models, schemas
from app.database import get_db

import schemas_impots as schemas_imp
import service_impots as service

router = APIRouter(prefix="/impots", tags=["impots"])

# Les bornes d'une année plausible : celles que `date` sait écrire, resserrées
# pour qu'une année tapée de travers (20266) ne crée pas de ligne absurde.
ANNEE_MIN = 1900
ANNEE_MAX = 2200


def _annee_valide(annee: int) -> int:
    if not ANNEE_MIN <= annee <= ANNEE_MAX:
        raise HTTPException(status_code=422, detail="Année invalide")
    return annee


@router.get("", response_model=schemas_imp.VueImpotsRead)
def lire(annee: Optional[int] = None, db: Session = Depends(get_db)):
    """Ce qu'une année demande de déclarer. Sans `annee`, l'année en cours."""
    aujourdhui = date_type.today()
    return service.vue(db, _annee_valide(annee or aujourdhui.year), aujourdhui)


@router.put("/declaration/{annee}", response_model=schemas_imp.DeclarationRead)
def ecrire_declaration(
    annee: int, payload: schemas_imp.DeclarationEcriture, db: Session = Depends(get_db)
):
    """Note le taux et/ou la date limite d'une année. Un champ absent ne change
    pas, un champ envoyé à `null` est effacé."""
    _annee_valide(annee)
    champs = {
        cle: getattr(payload, cle) for cle in payload.model_fields_set
    }
    service.poser_declaration(db, annee, champs)
    return service.declaration_de(db, annee, date_type.today())


@router.post("/operations")
def poser(payload: schemas.SousFiltreOperations, db: Session = Depends(get_db)):
    """Étiquette « à déclarer » un LOT d'opérations (le sélecteur de l'écran, comme celui
    des projets). Les opérations hors périmètre — tout ce qui n'est pas une entrée de type
    classique — sont écartées et comptées dans `ignorees`."""
    return service.poser_etiquettes(db, payload.operation_ids)


@router.delete("/operations/{operation_id}")
def retirer(operation_id: int, db: Session = Depends(get_db)):
    """Retire l'étiquette « à déclarer » d'une opération (elle reste en base)."""
    operation = db.get(models.Operation, operation_id)
    if operation is None:
        raise HTTPException(status_code=404, detail="Opération introuvable")
    service.retirer_etiquette(db, operation)
    return {"retire": True}
