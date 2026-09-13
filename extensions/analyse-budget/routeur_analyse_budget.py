"""Les routes de l'analyse de budget, sous `/analyse-budget`.

CE QUE L'EXTENSION ÉCRIT, ET C'EST TOUT : le seuil du matelas de sécurité
(`matelas_securite`) et l'étiquette « imprévue » d'une opération — cette
dernière par la route ORDINAIRE `PUT /operations/{id}` du noyau, pas ici : c'est
une propriété de l'opération comme une autre, et lui donner sa propre route
aurait créé un second chemin d'écriture sur la même table.

LE PRÉFIXE. `/analyse-budget` n'est le paramètre d'aucune autre route et
n'appartient à aucune autre extension (cf. extensions/README.md) : `/analyse`
aurait été plus court et moins sûr.

TOUT EST PAR MONNAIE, jamais additionné entre elles — comme partout ailleurs
dans l'application. « 3 000 » ne veut rien dire sans savoir en quelle devise, et
un matelas franchi dans une monnaie ne dit rien de l'autre.
"""
from datetime import date as date_type
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

# Imports ABSOLUS vers le noyau : ce module n'est pas un sous-paquet de `app`,
# il est chargé par chemin de fichier (cf. extensions/README.md).
from app import models
from app.database import get_db

import schemas_analyse_budget as schemas_ab
import service_analyse_budget as service

router = APIRouter(prefix="/analyse-budget", tags=["analyse-budget"])


def _annee_demandee(annee: Optional[int]) -> int:
    return annee if annee is not None else date_type.today().year


def _monnaie_ou_404(db: Session, monnaie_id: int) -> models.Monnaie:
    monnaie = db.get(models.Monnaie, monnaie_id)
    if monnaie is None:
        raise HTTPException(status_code=404, detail="Monnaie introuvable")
    return monnaie


# ---------- Ce qu'on a mis de côté ----------


@router.get("/epargne", response_model=schemas_ab.EpargneAnneeRead)
def lire_epargne(
    monnaie_id: int,
    annee: Optional[int] = None,
    db: Session = Depends(get_db),
):
    """L'année entière ET ses douze mois, en une seule réponse.

    LES DEUX ENSEMBLE, et non deux routes : l'écran montre le total et la
    courbe côte à côte, et deux allers-retours auraient laissé exister un
    instant où l'un est à jour et l'autre non."""
    _monnaie_ou_404(db, monnaie_id)
    annee = _annee_demandee(annee)
    return schemas_ab.EpargneAnneeRead(
        annee=annee,
        monnaie_id=monnaie_id,
        total=schemas_ab.EpargnePeriodeRead(
            **service.epargne_periode(db, annee, None, monnaie_id)
        ),
        mois=[
            schemas_ab.EpargneMoisRead(**ligne)
            for ligne in service.epargne_par_mois(db, annee, monnaie_id)
        ],
    )


# ---------- Le matelas de sécurité ----------


@router.get("/matelas", response_model=schemas_ab.MatelasRead)
def lire_matelas(monnaie_id: int, db: Session = Depends(get_db)):
    _monnaie_ou_404(db, monnaie_id)
    return schemas_ab.MatelasRead(**service.etat_matelas(db, monnaie_id))


@router.put("/matelas", response_model=schemas_ab.MatelasRead)
def ecrire_matelas(
    payload: schemas_ab.MatelasUpdate,
    monnaie_id: int,
    db: Session = Depends(get_db),
):
    """Poser le seuil, ou le retirer avec un zéro.

    RIEN N'EST REFUSÉ ICI, quel que soit l'état des comptes : on peut poser un
    matelas qu'on ne tient pas — c'est même le cas où il sert le plus, puisque
    c'est là qu'il a quelque chose à dire."""
    _monnaie_ou_404(db, monnaie_id)
    service.set_matelas(db, monnaie_id, payload.montant)
    return schemas_ab.MatelasRead(**service.etat_matelas(db, monnaie_id))


# ---------- Ce qui n'était pas prévisible ----------


@router.get("/imprevues", response_model=schemas_ab.ImprevuesAnneeRead)
def lire_imprevues(
    monnaie_id: int,
    annee: Optional[int] = None,
    db: Session = Depends(get_db),
):
    _monnaie_ou_404(db, monnaie_id)
    annee = _annee_demandee(annee)
    return schemas_ab.ImprevuesAnneeRead(
        annee=annee,
        monnaie_id=monnaie_id,
        total=schemas_ab.ImprevuesPeriodeRead(
            **service.imprevues_periode(db, annee, None, monnaie_id)
        ),
        mois=[
            schemas_ab.ImprevuesMoisRead(**ligne)
            for ligne in service.imprevues_par_mois(db, annee, monnaie_id)
        ],
        lignes=[
            schemas_ab.LigneImprevueRead(**ligne)
            for ligne in service.detail_imprevues(db, annee, None, monnaie_id)
        ],
    )
