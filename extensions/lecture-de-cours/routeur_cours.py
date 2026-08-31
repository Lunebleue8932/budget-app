"""Les routes de l'extension : associer un lien à un titre, et relire les cours.

TOUT VIT SOUS `/cours`, et rien ne touche à `/actions` ni à `/placements` —
les routes de l'extension « placements », qui continue de fonctionner seule et
sans réseau. Les deux extensions cohabitent au lieu de se remplacer : celle-ci
n'ajoute qu'une provenance possible pour un nombre que l'autre savait déjà
afficher.

CE QUE CES ROUTES NE FONT PAS : créer une opération, bouger un solde, toucher
un prix payé. Écrire un cours ne change qu'un chiffre d'affichage (cf.
service_cours) — c'est ce qui rend acceptable qu'il vienne d'Internet.
"""
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app import crud, models, schemas
from app.database import get_db

import service_cours
import source_cours

router = APIRouter(prefix="/cours", tags=["placements"])


def _titre_read(action: models.Action) -> schemas.CoursTitreRead:
    return schemas.CoursTitreRead(
        action_id=action.id,
        action_nom=action.nom_affiche,
        url_cours=action.url_cours,
        cours=action.valeur,
        monnaie_symbole=action.monnaie.symbole,
        cours_maj_le=action.cours_maj_le,
    )


def _reponse(db: Session, resume: service_cours.Resume) -> schemas.RafraichissementRead:
    """Le compte rendu, ET l'état de tous les titres après coup.

    Les deux dans la même réponse pour que l'écran se remette à jour sans
    second aller-retour : sans cela, la page afficherait un instant des cours
    périmés à côté d'un message annonçant qu'ils viennent de changer."""
    return schemas.RafraichissementRead(
        horodatage=resume.horodatage,
        reussis=resume.reussis,
        echecs=resume.echecs,
        resultats=[
            schemas.ResultatCoursRead(**vars(resultat)) for resultat in resume.resultats
        ],
        titres=[_titre_read(action) for action in crud.get_actions(db)],
    )


def _get_action_ou_404(db: Session, action_id: int) -> models.Action:
    action = crud.get_action(db, action_id)
    if action is None:
        raise HTTPException(status_code=404, detail="Titre introuvable")
    return action


@router.get("/sources", response_model=list[schemas.SourceCoursRead])
def list_sources():
    """Les pages que l'application sait lire, telles qu'affichées à l'écran.

    Servies par l'API plutôt qu'écrites en dur dans la page : la liste des
    sources reconnues vit dans le code qui les lit, et ne peut donc pas
    promettre à l'écran une source qui n'existe plus."""
    return [schemas.SourceCoursRead(**source) for source in source_cours.sources_publiques()]


@router.get("/titres", response_model=list[schemas.CoursTitreRead])
def list_titres(db: Session = Depends(get_db)):
    """TOUS les titres, pas seulement ceux qui ont un lien : l'écran doit
    proposer d'en ajouter un là où il manque."""
    return [_titre_read(action) for action in crud.get_actions(db)]


@router.put("/titres/{action_id}", response_model=schemas.RafraichissementRead)
def definir_url(
    action_id: int, payload: schemas.UrlCoursUpdate, db: Session = Depends(get_db)
):
    """Associe une page à un titre — et la lit tout de suite.

    LE LIEN N'EST ENREGISTRÉ QUE S'IL A DONNÉ UN COURS. Un lien qu'on accepte
    sans l'essayer ne se découvre cassé que des semaines plus tard, devant un
    cours qui n'a jamais bougé et qu'on croit juste. L'essayer sur-le-champ
    déplace l'erreur là où elle se corrige : sous les yeux de celui qui vient
    de coller l'adresse.

    Le revers assumé : sans connexion, on ne peut pas enregistrer un lien. Le
    message le dit (« Site injoignable »), et il suffit de recommencer plus
    tard — rien n'est perdu entre-temps, le cours saisi à la main reste.
    """
    action = _get_action_ou_404(db, action_id)
    try:
        cours = source_cours.lire_cours(payload.url)
    except source_cours.CoursIllisible as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    conflit = service_cours.ecart_de_devise(cours, action.monnaie)
    if conflit is not None:
        raise HTTPException(status_code=400, detail=conflit)

    ancien = action.valeur
    maintenant = datetime.now()
    crud.definir_url_cours(db, action, payload.url.strip())
    crud.enregistrer_cours_en_ligne(db, action, cours.valeur, maintenant)
    resume = service_cours.Resume(
        horodatage=maintenant,
        resultats=[
            service_cours.Resultat(
                action.id,
                action.nom,
                ok=True,
                cours=cours.valeur,
                ancien_cours=ancien,
                source=cours.source,
                libelle_source=cours.libelle,
            )
        ],
    )
    return _reponse(db, resume)


@router.delete("/titres/{action_id}", status_code=status.HTTP_204_NO_CONTENT)
def retirer_url(action_id: int, db: Session = Depends(get_db)):
    """Détache la page du titre. Le dernier cours lu RESTE : il ne devient pas
    faux parce qu'on cesse de le rafraîchir, et le titre retombe simplement
    dans le régime de l'extension « placements » — un cours saisi à la main."""
    crud.definir_url_cours(db, _get_action_ou_404(db, action_id), None)


@router.post("/rafraichir", response_model=schemas.RafraichissementRead)
def rafraichir_tout(db: Session = Depends(get_db)):
    """Le bouton « Mettre à jour les cours », et la mise à jour au lancement.

    Les titres sans lien sont ignorés en silence — ils ne sont pas en échec,
    ils ne sont pas concernés."""
    return _reponse(db, service_cours.rafraichir(db, service_cours.titres_suivis(db)))


@router.post("/titres/{action_id}/rafraichir", response_model=schemas.RafraichissementRead)
def rafraichir_titre(action_id: int, db: Session = Depends(get_db)):
    action = _get_action_ou_404(db, action_id)
    if not action.url_cours:
        raise HTTPException(
            status_code=400,
            detail=f"« {action.nom} » n'a pas de lien : ajoute-en un d'abord.",
        )
    return _reponse(db, service_cours.rafraichir(db, [action]))
