"""Les rangements d'écran qui désignent des lignes de la base.

DEUX ROUTES, ET RIEN DE PLUS : lire une clé, écrire une clé. Le serveur ne lit
jamais ce qu'il range (cf. models.PreferenceInterface) — ce n'est pas une
ressource du budget, c'est la façon dont un écran se souvient de lui-même.

POURQUOI CETTE TABLE EXISTE : ce qui désigne des IDENTIFIANTS de la base doit
vivre dans la base. Les dossiers de la galerie des règles rangent des règles par
leur id ; les laisser dans le `localStorage` du navigateur les rendait faux dès
qu'on changeait de base, et absents dès qu'on emportait la base sur un autre
poste. Ce qui décrit le POSTE — thème, langue, touche de gel, progression d'un
tutoriel — reste là-bas, et c'est très bien ainsi.

PAS DE ROUTE DE SUPPRESSION. Écrire une valeur vide EST la suppression, et
l'écran en a besoin : « plus aucun dossier » doit se distinguer de « cet écran
n'a jamais rien rangé », faute de quoi vider ses dossiers les ferait revenir au
chargement suivant (cf. la reprise du localStorage dans regles.js).
"""
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from .. import crud, schemas
from ..database import get_db

router = APIRouter(prefix="/preferences", tags=["preferences"])


@router.get("/{cle}", response_model=schemas.PreferenceInterfaceRead)
def lire_preference(cle: str, db: Session = Depends(get_db)):
    """Une clé inconnue rend `valeur: null` — jamais un 404.

    Un écran qui demande son rangement pour la première fois ne commet pas une
    erreur : il n'a simplement rien rangé encore. Répondre 404 aurait obligé
    chaque appelant à traiter un cas d'erreur pour décrire l'état le plus
    ordinaire qui soit."""
    return schemas.PreferenceInterfaceRead(
        cle=cle, valeur=crud.get_preference_interface(db, cle)
    )


@router.put("/{cle}", response_model=schemas.PreferenceInterfaceRead)
def ecrire_preference(
    cle: str, payload: schemas.PreferenceInterfaceEcriture, db: Session = Depends(get_db)
):
    return schemas.PreferenceInterfaceRead(
        cle=cle, valeur=crud.set_preference_interface(db, cle, payload.valeur)
    )
