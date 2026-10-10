"""Les routes de l'import de titres, sous `/import-titres`.

MÊME FORME QUE `/import-placements`, À CE QU'IL DÉCRIT PRÈS : presets, aperçu, confirmation.
Ni historique ni annulation — l'import ne crée aucune opération et se réimporte sans
risque (cf. service_import_titres). Le routeur du noyau et celui de l'import de placements
refusent les presets de ce domaine, et celui-ci refuse les leurs : la frontière est posée
des trois côtés, parce qu'un preset lu par le mauvais routeur donnerait un résultat faux
en silence.

CE QUI SERT À PRÉPARER LE FICHIER vit ici aussi, à côté de la lecture : le MODÈLE Excel à
télécharger (les colonnes dans l'ordre que lit un preset sans configuration) et les listes
d'ISIN.
"""
import io
import json
from typing import Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import Response
from sqlalchemy.orm import Session

from app import crud, models, schemas
from app.constants import (
    PROPRIETES_IMPORT_TITRE,
    PROPRIETES_IMPORT_TITRE_OBLIGATOIRES,
    AxeTitre,
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


# ---------- Préparer le fichier : modèle et listes d'ISIN ----------

# L'en-tête du modèle, dans l'ordre de PROPRIETES_IMPORT_TITRE (celui d'un preset sans
# configuration). Le texte des titres est celui qu'on lit dans Excel. « Cours », la dernière,
# n'est posée que pour qui a « Lecture de cours » ET l'a demandée (cf. `entetes_modele`).
ENTETES_MODELE = [
    "ISIN",
    "Nom",
    "Monnaie",
    "Enveloppe",
    "Classe d'actif",
    "Zone géographique",
    "Secteur",
    "Couverture de la composition (%)",
    "Composition (ISIN ; poids en %)",
    "Cours",
]

NOTICE_MODELE = [
    ("Un titre par ligne, repéré par son ISIN. Une cellule laissée vide ne change rien à ce que l'application sait déjà du titre : le fichier complète, il n'efface jamais.", None),
    ("ISIN", "Obligatoire. Douze caractères, par exemple IE00B4L5Y983."),
    ("Nom", "Le nom donné à un titre qui n'existe pas encore dans l'application. Sans effet sur un titre déjà connu."),
    ("Monnaie", "La monnaie de cotation d'un nouveau titre, par son nom ou son symbole (Euro, €…). À défaut, la monnaie principale de l'application."),
    ("Enveloppe", "Comment le titre est détenu : ETF, Action en direct, SCPI… Une seule valeur."),
    ("Classe d'actif", "À quoi le titre expose : Actions, Obligations, Immobilier… Une seule valeur (= 100 %) ou une répartition : « Actions 60 ; Obligations 40 »."),
    ("Zone géographique", "Même principe. Les zones sont exclusives : « Asie (hors Chine) » et non « Asie ». Exemple : « États-Unis 65 ; Europe 15 ; Asie (hors Chine) 10 »."),
    ("Secteur", "Même principe. Exemple : « Technologies de l'information 25 ; Finance 15 »."),
    ("Couverture de la composition (%)", "Pour un ETF : la part de l'indice que les ISIN de la colonne suivante représentent ensemble (60 par défaut)."),
    ("Composition (ISIN ; poids en %)", "Pour un ETF : les ISIN du haut de l'indice et leur poids en %, séparés par des points-virgules. Exemple : « US5949181045 4,7 ; US0378331005 4,5 »."),
    ("Poids", "Toujours en pourcentage : 65 pour 65 %. Les poids ne sont jamais ramenés à 100 : une répartition qui s'arrête à 80 % laisse 20 % « non renseigné »."),
]

NOTICE_COURS = (
    "Cours",
    "Le dernier cours unitaire du titre, dans sa monnaie de cotation, en nombre seul : 104,52. Il remplace le cours enregistré dans l'application.",
)

# LES VALEURS DE L'APPLICATION, sous la notice des colonnes : celles que l'utilisateur a
# aujourd'hui, et non une liste figée. Un libellé inconnu est créé à l'import ; les avoir
# sous les yeux évite d'en inventer un quand l'un d'eux convient (un
# secteur non couvert, une région particulière).
NOTICE_VALEURS_PRINCIPE = (
    "Les valeurs que l'application connaît aujourd'hui. Emploie-les telles quelles : un libellé "
    "qui n'y figure pas sera créé à l'import, à ne proposer que si aucun ne convient vraiment."
)
NOTICE_AXES = (
    ("Enveloppes", AxeTitre.enveloppe.value),
    ("Classes d'actif", AxeTitre.classe.value),
    ("Zones géographiques", AxeTitre.zone.value),
    ("Secteurs", AxeTitre.secteur.value),
)


def entetes_modele(avec_cours: bool) -> list[str]:
    return ENTETES_MODELE if avec_cours else ENTETES_MODELE[:-1]


def avec_cours_demande(cours: bool) -> bool:
    """La colonne « Cours » : demandée par l'écran, et seulement si l'extension tourne."""
    return bool(cours) and service.cours_disponible()


def valeurs_application(db: Session) -> list[tuple[str, str]]:
    """(intitulé, valeurs séparées par « ; ») : les monnaies allumées, puis les étiquettes
    de chaque axe. Une monnaie s'écrit par son nom ou son symbole, les deux sont reconnus."""
    monnaies = " ; ".join(
        f"{m.nom} ({m.symbole})" for m in crud.get_monnaies(db) if m.active
    )
    lignes = [("Monnaies", monnaies or "—")]
    for intitule, axe in NOTICE_AXES:
        noms = " ; ".join(e.nom for e in crud.get_types_titre(db, axe))
        lignes.append((intitule, noms or "—"))
    return lignes


def modele_xlsx(db: Session, avec_cours: bool = False) -> bytes:
    """Le classeur modèle : une feuille « Titres » (seulement l'en-tête, c'est la feuille
    active, la seule que l'import lit) et une feuille « Notice » qui explique chaque colonne
    puis donne les valeurs que l'application connaît (monnaies, enveloppes, classes, zones,
    secteurs).

    AUCUNE LIGNE D'EXEMPLE dans la feuille de données : elle se retrouverait importée par
    celui qui oublie de l'effacer. Les exemples vivent dans la notice. AUCUNE FORMULE non
    plus : l'import lit les valeurs en cache, et openpyxl n'en écrit pas."""
    from openpyxl import Workbook
    from openpyxl.styles import Alignment, Font

    classeur = Workbook()
    feuille = classeur.active
    feuille.title = "Titres"
    feuille.append(entetes_modele(avec_cours))
    for cellule in feuille[1]:
        cellule.font = Font(bold=True)
        cellule.alignment = Alignment(wrap_text=True, vertical="top")
    for lettre, largeur in zip("ABCDEFGHIJ", (16, 34, 12, 16, 22, 34, 30, 18, 44, 12)):
        feuille.column_dimensions[lettre].width = largeur
    feuille.freeze_panes = "A2"

    notice = classeur.create_sheet("Notice")
    for colonne, titre in (("A", "Colonne"), ("B", "Ce qu'elle contient")):
        notice[f"{colonne}1"] = titre
        notice[f"{colonne}1"].font = Font(bold=True)
    lignes_notice = NOTICE_MODELE[:-1] + ([NOTICE_COURS] if avec_cours else []) + NOTICE_MODELE[-1:]
    for i, (colonne, texte) in enumerate(lignes_notice, start=2):
        notice[f"A{i}"] = colonne if texte is not None else "Principe"
        notice[f"B{i}"] = texte if texte is not None else colonne
        notice[f"B{i}"].alignment = Alignment(wrap_text=True, vertical="top")

    # Les valeurs de l'application, après une ligne vide.
    depart = len(lignes_notice) + 3
    notice[f"A{depart}"] = "Valeurs de l'application"
    notice[f"A{depart}"].font = Font(bold=True)
    notice[f"B{depart}"] = NOTICE_VALEURS_PRINCIPE
    notice[f"B{depart}"].alignment = Alignment(wrap_text=True, vertical="top")
    for i, (intitule, valeurs) in enumerate(valeurs_application(db), start=depart + 1):
        notice[f"A{i}"] = intitule
        notice[f"B{i}"] = valeurs
        notice[f"B{i}"].alignment = Alignment(wrap_text=True, vertical="top")
    notice.column_dimensions["A"].width = 34
    notice.column_dimensions["B"].width = 110

    tampon = io.BytesIO()
    classeur.save(tampon)
    return tampon.getvalue()


# Les lignes que l'aperçu montre : l'en-tête et deux lignes vides, comme Excel les afficherait.
LIGNES_APERCU_MODELE = 3


@router.get("/modele/apercu")
def apercu_modele(cours: bool = False):
    """Les premières lignes de la feuille « Titres » du modèle, pour les montrer dans l'app avant
    de le télécharger. Lues dans la MÊME source que le classeur (`entetes_modele`) : l'aperçu ne
    peut pas diverger du fichier."""
    entetes = entetes_modele(avec_cours_demande(cours))
    vide = [""] * len(entetes)
    return {
        "feuille": "Titres",
        "lignes": [list(entetes)] + [list(vide) for _ in range(LIGNES_APERCU_MODELE - 1)],
    }


@router.get("/modele")
def telecharger_modele(cours: bool = False, db: Session = Depends(get_db)):
    """Le modèle Excel qui structure le fichier. `cours=true` y ajoute la
    colonne « Cours » (extension « Lecture de cours » seulement)."""
    return Response(
        content=modele_xlsx(db, avec_cours_demande(cours)),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        headers={"Content-Disposition": 'attachment; filename="modele-titres.xlsx"'},
    )
