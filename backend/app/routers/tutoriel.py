"""La base de DÉCOUVERTE du tutoriel « Prendre l'application en main ».

Trois routes, et aucune ne touche à la base de l'utilisateur ni à son profil :

  - `GET  /tutoriel/decouverte`         : est-on sur la base de découverte ?
  - `POST /tutoriel/decouverte/entrer`  : la fabrique et y bascule ;
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
    return {"actif": database.en_decouverte()}


@router.get("/decouverte")
def get_decouverte():
    return _etat()


@router.post("/decouverte/entrer")
def entrer_decouverte():
    if database.en_decouverte():
        return _etat()
    try:
        chemin = base_decouverte.fabriquer()
        database.entrer_decouverte(chemin)
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
