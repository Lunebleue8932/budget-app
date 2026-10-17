"""La base de DÉCOUVERTE des tutoriels « Prendre l'application en main » et « Importer un relevé ».

Trois routes, et aucune ne touche à la base de l'utilisateur ni à son profil :

  - `GET  /tutoriel/decouverte`         : est-on sur la base de découverte, et pour quel parcours ?
  - `POST /tutoriel/decouverte/entrer`  : fabrique celle du parcours demandé (`?parcours=`) et y
                                          bascule ;
  - `POST /tutoriel/decouverte/quitter` : rejoint la base d'avant.

AUCUNE MÉMORISATION (cf. database.py, « La base de DÉCOUVERTE ») : ces routes
n'appellent jamais `parametres_base._memoriser`. Le chemin retenu pour les
prochains lancements reste celui de la vraie base, quoi qu'il arrive pendant le
tutoriel — y compris une fenêtre fermée en plein milieu.
"""
from fastapi import APIRouter, HTTPException

from .. import database
from ..services import base_decouverte

router = APIRouter(prefix="/tutoriel", tags=["tutoriel"])


def _etat() -> dict:
    return {"actif": database.en_decouverte(), "parcours": database.parcours_decouverte()}


@router.get("/decouverte")
def get_decouverte():
    return _etat()


@router.post("/decouverte/entrer")
def entrer_decouverte(parcours: str = base_decouverte.PARCOURS_PRISE_EN_MAIN):
    if parcours not in base_decouverte.PARCOURS:
        raise HTTPException(status_code=400, detail=f"Parcours inconnu : {parcours}")
    # Les deux bases temporaires ne s'empilent pas : la « base d'avant » du tutoriel serait la démo.
    if database.en_sandbox():
        raise HTTPException(
            status_code=409, detail="Quitte d'abord la démo pour lancer le tutoriel."
        )
    if database.en_decouverte():
        if database.parcours_decouverte() == parcours:
            return _etat()
        # UN AUTRE PARCOURS : sa base ne contient pas ce que celui-ci montre. On rejoint d'abord la
        # vraie base, pour que la « base d'avant » reste celle de l'utilisateur et jamais une
        # base de découverte.
        quitter_decouverte()
    try:
        chemin = base_decouverte.fabriquer(parcours=parcours)
        database.entrer_decouverte(chemin, parcours)
    except (ValueError, OSError) as exc:
        raise HTTPException(
            status_code=500, detail=f"Impossible de préparer la base de découverte : {exc}"
        )
    return _etat()


@router.post("/decouverte/quitter")
def quitter_decouverte():
    try:
        database.quitter_decouverte()
    except (ValueError, OSError, FileNotFoundError) as exc:
        raise HTTPException(
            status_code=500, detail=f"Impossible de retrouver ta base : {exc}"
        )
    return _etat()
