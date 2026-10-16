"""Exporter toutes les données (JSON, CSV, Excel) — cf. services/export_donnees.

LECTURE SEULE : rien n'est écrit, et l'export est celui de la base ACTUELLEMENT servie. Le fichier est
rendu en pièce jointe ; côté bureau, c'est l'écran qui l'enregistre par le sélecteur du système (un
lien « download » ne fait rien dans la fenêtre embarquée, cf. desktop/app_desktop.ApiBureau).
"""
from datetime import date

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from sqlalchemy.orm import Session

from .. import database
from ..database import get_db
from ..services import export_donnees

router = APIRouter(prefix="/export", tags=["export"])


@router.get("")
def exporter(
    format: str = Query("json", pattern="^(json|csv|xlsx)$"),
    db: Session = Depends(get_db),
):
    try:
        contenu, media, extension = export_donnees.exporter(
            db, format, database.revision_actuelle(database.get_chemin_actuel())
        )
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    nom = f"budget-export-{date.today().isoformat()}.{extension}"
    return Response(
        content=contenu,
        media_type=media,
        headers={"Content-Disposition": f'attachment; filename="{nom}"'},
    )
