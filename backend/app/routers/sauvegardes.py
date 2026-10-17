"""Le dossier des copies de sécurité, et la copie à la demande — cf. services/sauvegardes.

LE DOSSIER EST UN RÉGLAGE DE POSTE : il vit dans le fichier de configuration de l'utilisateur (cf.
config_utilisateur), pas dans la base. Une installation de mise au point n'en lit ni n'en écrit que
sa propre clé.
"""
from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from .. import config_utilisateur, database
from ..services import sauvegardes

router = APIRouter(prefix="/sauvegardes", tags=["sauvegardes"])


class DossierSauvegardeWrite(BaseModel):
    # None (ou vide) : ne plus faire de copies automatiques.
    dossier: Optional[str] = None


def _etat() -> dict:
    dossier = sauvegardes.dossier_configure()
    return {
        "dossier": str(dossier) if dossier else None,
        "derniere": sauvegardes.derniere_copie(dossier) if dossier else None,
        "garder": sauvegardes.GARDER,
        "base": str(database.get_chemin_actuel()),
    }


@router.get("")
def lire_etat():
    return _etat()


@router.put("/dossier")
def poser_dossier(payload: DossierSauvegardeWrite):
    dev = database.mode_developpement()
    if not (payload.dossier or "").strip():
        config_utilisateur.memoriser_dossier_sauvegarde(None, dev=dev)
        return {**_etat(), "memorise": True}
    try:
        dossier = sauvegardes.verifier_dossier(payload.dossier)
    except sauvegardes.ErreurSauvegarde as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    memorise = config_utilisateur.memoriser_dossier_sauvegarde(dossier, dev=dev)
    return {**_etat(), "memorise": memorise}


@router.post("/maintenant")
def sauvegarder_maintenant():
    dossier = sauvegardes.dossier_configure()
    if dossier is None:
        raise HTTPException(status_code=400, detail="Choisis d'abord un dossier de sauvegarde.")
    if database.en_decouverte():
        raise HTTPException(
            status_code=409, detail="Termine ou quitte le tutoriel avant de faire une copie."
        )
    if database.en_sandbox():
        raise HTTPException(
            status_code=409, detail="Quitte la démo avant de faire une copie de ta base."
        )
    try:
        fichier = sauvegardes.sauvegarder(dossier)
    except sauvegardes.ErreurSauvegarde as exc:
        raise HTTPException(status_code=500, detail=str(exc))
    return {**_etat(), "fichier": fichier.name}
