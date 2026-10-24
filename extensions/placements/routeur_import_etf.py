"""Les routes de l'import de composition d'un ETF, sous `/import-etf`.

DEUX ROUTES, SANS ÉTAT : `lire` (ce que le fichier dit, ce qu'on propose — n'écrit rien) et
`confirmer` (applique les choix de l'utilisateur). Le fichier est renvoyé aux deux : la
confirmation relit ce qu'il dit aujourd'hui (cf. service_import_etf). Ni preset, ni historique, ni
annulation : l'import ne crée aucune opération, et réimporter le même fichier est le geste normal
(on met la composition d'un ETF à jour tous les mois).
"""
import json
from typing import Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from sqlalchemy.orm import Session

from app.database import get_db
from app.routers import import_bancaire as routeur_bancaire

import service_import_etf as service

router = APIRouter(prefix="/import-etf", tags=["import-etf"])


@router.post("/lire")
async def lire(
    fichier: UploadFile = File(...),
    delimiteur: Optional[str] = Form(None),
    db: Session = Depends(get_db),
):
    delimiteur = routeur_bancaire._valider_delimiteur(delimiteur)
    contenu = await fichier.read()
    try:
        return service.lire(db, contenu, delimiteur)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Fichier illisible : {exc}")


@router.post("/confirmer")
async def confirmer(
    fichier: UploadFile = File(...),
    delimiteur: Optional[str] = Form(None),
    choix: str = Form("{}"),
    db: Session = Depends(get_db),
):
    """`choix` : JSON `{etf: {titre_id | nom, isin}, nb_lignes, secteurs: {...}, zones: {...}}`."""
    delimiteur = routeur_bancaire._valider_delimiteur(delimiteur)
    try:
        choix_lus = json.loads(choix)
        if not isinstance(choix_lus, dict):
            raise ValueError
    except ValueError:
        raise HTTPException(status_code=400, detail="choix invalide (objet JSON attendu)")
    contenu = await fichier.read()
    try:
        return service.confirmer(db, contenu, delimiteur, choix_lus)
    except HTTPException:
        raise
    except ValueError as exc:
        db.rollback()
        raise HTTPException(status_code=400, detail=str(exc))
    except Exception as exc:
        db.rollback()
        raise HTTPException(status_code=400, detail=f"Fichier illisible : {exc}")
