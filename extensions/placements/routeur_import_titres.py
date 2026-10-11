"""Les routes de l'import de titres, sous `/import-titres`.

MÊME FORME QUE `/import-placements`, À CE QU'IL DÉCRIT PRÈS : presets, aperçu, confirmation.
Ni historique ni annulation — l'import ne crée aucune opération et se réimporte sans
risque (cf. service_import_titres). Le routeur du noyau et celui de l'import de placements
refusent les presets de ce domaine, et celui-ci refuse les leurs : la frontière est posée
des trois côtés, parce qu'un preset lu par le mauvais routeur donnerait un résultat faux
en silence.

Il n'y a pas de modèle Excel à télécharger : les colonnes se désignent à la lecture du fichier,
dans le format (preset) qu'on enregistre.
"""
import json
from typing import Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from sqlalchemy.orm import Session

from app import crud, models, schemas
from app.constants import (
    PROPRIETES_IMPORT_TITRE,
    PROPRIETES_IMPORT_TITRE_OBLIGATOIRES,
    DomaineImport,
)
from app.database import get_db
from app.routers import import_bancaire as routeur_bancaire

import schemas_import_titres as schemas_t
import service_import_titres as service

router = APIRouter(prefix="/import-titres", tags=["import-titres"])

DOMAINE = DomaineImport.titre.value


def _get_preset_ou_404(db: Session, preset_id: int) -> models.ImportPreset:
    preset = crud.get_import_preset(db, preset_id)
    if preset is None or preset.domaine != DOMAINE:
        raise HTTPException(status_code=404, detail="Preset d'import introuvable")
    return preset


def _valider_configuration(payload) -> None:
    """Les colonnes lues : l'ISIN y est obligatoire, c'est la clé du fichier. Le reste est
    libre — un fichier qui ne porte que des zones est parfaitement importable."""
    routeur_bancaire.valider_colonnes(
        payload.colonnes, set(PROPRIETES_IMPORT_TITRE), PROPRIETES_IMPORT_TITRE_OBLIGATOIRES
    )


# ---------- Presets ----------


@router.get("/presets", response_model=list[schemas.ImportPresetRead])
def list_presets(db: Session = Depends(get_db)):
    return crud.list_import_presets(db, DOMAINE)


@router.post("/presets", response_model=schemas.ImportPresetRead, status_code=201)
def create_preset(payload: schemas.ImportPresetCreate, db: Session = Depends(get_db)):
    _valider_configuration(payload)
    return crud.create_import_preset(
        db,
        payload.nom,
        [c.model_dump() for c in payload.colonnes],
        [],
        lignes_entete=payload.lignes_entete,
        domaine=DOMAINE,
    )


@router.get("/presets/{preset_id}", response_model=schemas.ImportPresetRead)
def get_preset(preset_id: int, db: Session = Depends(get_db)):
    return _get_preset_ou_404(db, preset_id)


@router.put("/presets/{preset_id}", response_model=schemas.ImportPresetRead)
def update_preset(
    preset_id: int, payload: schemas.ImportPresetUpdate, db: Session = Depends(get_db)
):
    preset = _get_preset_ou_404(db, preset_id)
    _valider_configuration(payload)
    return crud.update_import_preset(
        db,
        preset,
        nom=payload.nom,
        colonnes=[c.model_dump() for c in payload.colonnes],
        colonnes_comparaison=[],
        mode_comparaison=payload.mode_comparaison.value,
        lignes_entete=payload.lignes_entete,
    )


@router.delete("/presets/{preset_id}")
def delete_preset(preset_id: int, db: Session = Depends(get_db)):
    crud.delete_import_preset(db, _get_preset_ou_404(db, preset_id))
    return {"supprime": True}


# ---------- Aperçu et confirmation ----------


async def _lire_fichier(fichier: UploadFile, delimiteur, separateur_decimal):
    delimiteur = routeur_bancaire._valider_delimiteur(delimiteur)
    # Le séparateur décimal n'a pas d'effet ici (les poids passent par `parser_poids`, qui
    # accepte la virgule comme le point) ; il est validé pour que le formulaire reste le
    # même que celui des autres imports.
    routeur_bancaire._valider_separateur_decimal(separateur_decimal)
    return await fichier.read(), delimiteur


@router.post("/presets/{preset_id}/previsualiser", response_model=schemas_t.ApercuTitres)
async def previsualiser(
    preset_id: int,
    fichier: UploadFile = File(...),
    delimiteur: Optional[str] = Form(None),
    separateur_decimal: Optional[str] = Form(None),
    db: Session = Depends(get_db),
):
    """Ce que le fichier ferait, SANS RIEN ÉCRIRE : ni titre, ni étiquette, ni répartition."""
    _get_preset_ou_404(db, preset_id)
    contenu, delimiteur = await _lire_fichier(fichier, delimiteur, separateur_decimal)
    try:
        return service.previsualiser(db, preset_id, contenu, delimiteur)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Fichier illisible : {exc}")


@router.post("/presets/{preset_id}/confirmer", response_model=schemas_t.ResultatTitres)
async def confirmer(
    preset_id: int,
    fichier: UploadFile = File(...),
    delimiteur: Optional[str] = Form(None),
    separateur_decimal: Optional[str] = Form(None),
    lignes_exclues: str = Form("[]"),
    db: Session = Depends(get_db),
):
    """`lignes_exclues` : les numéros de ligne décochés dans l'aperçu, en JSON. Le fichier
    est relu ENTIER (comme à l'aperçu) : la confirmation applique ce qu'il dit AUJOURD'HUI,
    pas une copie périmée de ce qu'on a vu."""
    _get_preset_ou_404(db, preset_id)
    contenu, delimiteur = await _lire_fichier(fichier, delimiteur, separateur_decimal)
    try:
        exclues = {int(n) for n in json.loads(lignes_exclues)}
    except Exception:
        raise HTTPException(status_code=400, detail="lignes_exclues invalide (liste JSON attendue)")
    try:
        return service.confirmer(db, preset_id, contenu, delimiteur, exclues)
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"Fichier illisible : {exc}")
