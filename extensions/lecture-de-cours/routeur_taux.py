"""Les routes du volet monnaies : suivre un couple, et relire son taux.

TOUT VIT SOUS `/taux-change`, et rien ne touche à `/monnaies` — les routes de
l'extension « Monnaies », qui continue de fonctionner seule et sans réseau. Les
deux cohabitent au lieu de se remplacer : celle-ci n'ajoute qu'une information
de plus à côté de monnaies que l'autre savait déjà gérer.

CE QUE CES ROUTES NE FONT PAS : convertir. Aucun solde, aucun KPI, aucun budget
ne consulte les taux enregistrés ici (cf. service_taux). Un taux s'affiche sur
l'écran des monnaies, et c'est tout ce qu'il fait.
"""
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app import crud, models, schemas
from app.database import get_db

import service_taux
import source_cours

router = APIRouter(prefix="/taux-change", tags=["monnaies"])


def _taux_read(couple: models.TauxChange) -> schemas.TauxChangeRead:
    return schemas.TauxChangeRead(
        id=couple.id,
        monnaie_source_id=couple.monnaie_source_id,
        monnaie_source_nom=couple.monnaie_source.nom,
        monnaie_source_symbole=couple.monnaie_source.symbole,
        monnaie_cible_id=couple.monnaie_cible_id,
        monnaie_cible_nom=couple.monnaie_cible.nom,
        monnaie_cible_symbole=couple.monnaie_cible.symbole,
        url_cours=couple.url_cours,
        taux=couple.taux,
        maj_le=couple.maj_le,
    )


def _reponse(db: Session, resume: service_taux.ResumeTaux) -> schemas.RafraichissementTauxRead:
    """Le compte rendu, ET l'état de tous les couples après coup — pour que
    l'écran se remette à jour sans second aller-retour."""
    return schemas.RafraichissementTauxRead(
        horodatage=resume.horodatage,
        reussis=resume.reussis,
        echecs=resume.echecs,
        resultats=[schemas.ResultatTauxRead(**vars(resultat)) for resultat in resume.resultats],
        taux=[_taux_read(couple) for couple in service_taux.couples_suivis(db)],
    )


def _get_couple_ou_404(db: Session, taux_id: int) -> models.TauxChange:
    couple = db.query(models.TauxChange).filter(models.TauxChange.id == taux_id).first()
    if couple is None:
        raise HTTPException(status_code=404, detail="Couple de monnaies introuvable")
    return couple


@router.get("/sources", response_model=list[schemas.SourceCoursRead])
def list_sources():
    """Les sources reconnues, pour que l'écran dise quels liens sont lisibles
    avant qu'on en colle un. Même liste que pour les titres : c'est le même
    lecteur (cf. source_cours)."""
    return source_cours.sources_publiques()


@router.get("", response_model=list[schemas.TauxChangeRead])
def list_taux(db: Session = Depends(get_db)):
    return [_taux_read(couple) for couple in service_taux.couples_suivis(db)]


@router.post("", response_model=schemas.RafraichissementTauxRead, status_code=status.HTTP_201_CREATED)
def creer_couple(payload: schemas.TauxChangeCreate, db: Session = Depends(get_db)):
    """Enregistre un couple à suivre — et lit son taux tout de suite.

    LE LIEN N'EST ENREGISTRÉ QUE S'IL A DONNÉ UN NOMBRE, comme pour un titre :
    un lien accepté sans être essayé ne se découvre cassé que des semaines plus
    tard, devant un taux qui n'a jamais bougé et qu'on croit juste.
    """
    if payload.monnaie_source_id == payload.monnaie_cible_id:
        raise HTTPException(
            status_code=400, detail="Les deux monnaies d'un couple doivent être différentes."
        )
    for monnaie_id in (payload.monnaie_source_id, payload.monnaie_cible_id):
        if crud.get_monnaie(db, monnaie_id) is None:
            raise HTTPException(status_code=404, detail="Monnaie introuvable")

    existant = (
        db.query(models.TauxChange)
        .filter(
            models.TauxChange.monnaie_source_id == payload.monnaie_source_id,
            models.TauxChange.monnaie_cible_id == payload.monnaie_cible_id,
        )
        .first()
    )

    try:
        cours = source_cours.lire_cours(payload.url)
    except source_cours.CoursIllisible as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    maintenant = datetime.now()
    if existant is not None:
        # Réenregistrer un couple déjà suivi CHANGE SON LIEN plutôt que d'être
        # refusé : c'est le geste qu'on fait quand une page a cessé de répondre,
        # et il n'y a rien à conserver de l'ancienne adresse.
        ancien = existant.taux
        existant.url_cours = payload.url.strip()
        couple = existant
    else:
        ancien = None
        couple = models.TauxChange(
            monnaie_source_id=payload.monnaie_source_id,
            monnaie_cible_id=payload.monnaie_cible_id,
            url_cours=payload.url.strip(),
        )
        db.add(couple)

    couple.taux = cours.valeur
    couple.maj_le = maintenant
    db.commit()
    db.refresh(couple)

    resume = service_taux.ResumeTaux(
        horodatage=maintenant,
        resultats=[
            service_taux.ResultatTaux(
                couple.id,
                service_taux.libelle_couple(couple),
                ok=True,
                taux=cours.valeur,
                ancien_taux=ancien,
                source=cours.source,
            )
        ],
    )
    return _reponse(db, resume)


@router.delete("/{taux_id}", status_code=status.HTTP_204_NO_CONTENT)
def supprimer_couple(taux_id: int, db: Session = Depends(get_db)):
    """Cesse de suivre ce couple. Rien d'autre ne disparaît : aucun montant de
    l'application ne dépendait de ce taux."""
    db.delete(_get_couple_ou_404(db, taux_id))
    db.commit()


@router.post("/rafraichir", response_model=schemas.RafraichissementTauxRead)
def rafraichir_tout(db: Session = Depends(get_db)):
    """Le bouton « Mettre à jour les taux », et la mise à jour au lancement."""
    return _reponse(db, service_taux.rafraichir(db, service_taux.couples_suivis(db)))


@router.post("/{taux_id}/rafraichir", response_model=schemas.RafraichissementTauxRead)
def rafraichir_couple(taux_id: int, db: Session = Depends(get_db)):
    return _reponse(db, service_taux.rafraichir(db, [_get_couple_ou_404(db, taux_id)]))
