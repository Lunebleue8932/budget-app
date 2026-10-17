"""La SANDBOX : la démo remplie de données fictives, où l'on peut tout essayer.

Quatre routes, et aucune ne touche à la base de l'utilisateur ni à son profil :

  - `GET  /sandbox`               : est-on dans la démo ? (+ son âge et sa version si oui) ;
  - `POST /sandbox/entrer`        : y bascule (la fabrique si elle n'existe pas encore) ;
  - `POST /sandbox/quitter`       : rejoint la base d'avant ;
  - `POST /sandbox/reinitialiser` : refait la démo, la vide de ce qu'on y a saisi.

AUCUNE MÉMORISATION (cf. database.py, « La SANDBOX ») : ces routes n'appellent jamais
`parametres_base._memoriser`. Le chemin retenu pour les prochains lancements reste celui de la
vraie base, quoi qu'il arrive pendant la démo — y compris une fenêtre fermée en pleine démo.
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from .. import database
from ..database import get_db
from ..services import base_sandbox

router = APIRouter(prefix="/sandbox", tags=["sandbox"])


def _etat(db: Session | None = None, **en_plus) -> dict:
    actif = database.en_sandbox()
    etat = {"actif": actif, **en_plus}
    if actif and db is not None:
        etat.update(base_sandbox.etat(db))
    return etat


def _lire_etat() -> dict:
    """L'état lu sur une session neuve : après une bascule, la session de la requête est celle de
    l'ancienne base."""
    with database._etat.SessionLocal() as db:
        return _etat(db)


@router.get("")
def get_sandbox(db: Session = Depends(get_db)):
    return _etat(db)


def _entrer(langue: str) -> dict:
    """Bascule sur la démo, en la fabriquant si besoin. `recreee` dit qu'un fichier existant
    n'a pas pu être rouvert (schéma d'une autre version, fichier abîmé) et a été refait."""
    chemin = base_sandbox.chemin_sandbox()
    recreee = False
    if chemin.is_file():
        try:
            database.entrer_sandbox(chemin)
        except FileNotFoundError:
            pass
        except ValueError as exc:
            # Un tutoriel en cours se dit à l'utilisateur ; un fichier illisible, lui, se refait :
            # ce n'est que de la démo.
            if database.en_decouverte():
                raise HTTPException(status_code=409, detail=str(exc))
            recreee = True
    if not database.en_sandbox():
        if database.en_decouverte():
            raise HTTPException(
                status_code=409, detail="Termine ou quitte le tutoriel avant d'ouvrir la démo."
            )
        try:
            base_sandbox.fabriquer(chemin, langue=langue)
            database.entrer_sandbox(chemin)
        except (ValueError, OSError) as exc:
            raise HTTPException(
                status_code=500, detail=f"Impossible de préparer la démo : {exc}"
            )
    return _lire_etat() | {"recreee": recreee}


@router.post("/entrer")
def entrer_sandbox(langue: str = "fr"):
    if database.en_sandbox():
        return _lire_etat()
    return _entrer(langue)


@router.post("/quitter")
def quitter_sandbox():
    try:
        database.quitter_sandbox()
    except (ValueError, OSError, FileNotFoundError) as exc:
        raise HTTPException(status_code=500, detail=f"Impossible de retrouver ta base : {exc}")
    return {"actif": database.en_sandbox()}


@router.post("/reinitialiser")
def reinitialiser_sandbox(langue: str = "fr"):
    """Refait la démo. On QUITTE d'abord : Windows ne supprime pas un fichier que le moteur tient
    ouvert, et si la fabrication échoue on veut se retrouver sur sa vraie base, pas dans une démo
    à moitié détruite."""
    if not database.en_sandbox():
        raise HTTPException(status_code=409, detail="La démo n'est pas ouverte.")
    try:
        database.quitter_sandbox()
    except (ValueError, OSError, FileNotFoundError) as exc:
        raise HTTPException(status_code=500, detail=f"Impossible de retrouver ta base : {exc}")
    try:
        base_sandbox.fabriquer(langue=langue)
        database.entrer_sandbox(base_sandbox.chemin_sandbox())
    except (ValueError, OSError) as exc:
        raise HTTPException(
            status_code=500,
            detail=f"Impossible de refaire la démo : {exc}. Tu es revenu sur ta base.",
        )
    return _lire_etat()
