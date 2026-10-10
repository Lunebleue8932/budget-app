"""Les routes de l'extension : associer un lien à un titre, et relire les cours.

TOUT VIT SOUS `/cours`, et rien ne touche à `/titres` ni à `/placements` —
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


def _titre_read(titre: models.TitrePossede) -> schemas.CoursTitreRead:
    return schemas.CoursTitreRead(
        titre_id=titre.id,
        titre_nom=titre.nom_affiche,
        url_cours=titre.url_cours,
        cours=titre.valeur,
        monnaie_symbole=titre.monnaie.symbole,
        cours_maj_le=titre.cours_maj_le,
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
        titres=[_titre_read(titre) for titre in crud.get_titres(db)],
    )


def _get_titre_ou_404(db: Session, titre_id: int) -> models.TitrePossede:
    titre = crud.get_titre(db, titre_id)
    if titre is None:
        raise HTTPException(status_code=404, detail="Titre introuvable")
    return titre


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
    return [_titre_read(titre) for titre in crud.get_titres(db)]


@router.put("/titres/{titre_id}", response_model=schemas.RafraichissementRead)
def definir_url(
    titre_id: int, payload: schemas.UrlCoursUpdate, db: Session = Depends(get_db)
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
    titre = _get_titre_ou_404(db, titre_id)
    try:
        cours = source_cours.lire_cours(payload.url)
    except source_cours.CoursIllisible as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    conflit = service_cours.ecart_de_devise(cours, titre.monnaie)
    if conflit is not None:
        raise HTTPException(status_code=400, detail=conflit)

    ancien = titre.valeur
    maintenant = datetime.now()
    crud.definir_url_cours(db, titre, payload.url.strip())
    crud.enregistrer_cours_en_ligne(db, titre, cours.valeur, maintenant)
    resume = service_cours.Resume(
        horodatage=maintenant,
        resultats=[
            service_cours.Resultat(
                titre.id,
                titre.nom_affiche,
                ok=True,
                cours=cours.valeur,
                ancien_cours=ancien,
                source=cours.source,
                libelle_source=cours.libelle,
            )
        ],
    )
    return _reponse(db, resume)


@router.delete("/titres/{titre_id}", status_code=status.HTTP_204_NO_CONTENT)
def retirer_url(titre_id: int, db: Session = Depends(get_db)):
    """Détache la page du titre. Le dernier cours lu RESTE : il ne devient pas
    faux parce qu'on cesse de le rafraîchir, et le titre retombe simplement
    dans le régime de l'extension « placements » — un cours saisi à la main."""
    crud.definir_url_cours(db, _get_titre_ou_404(db, titre_id), None)


@router.post("/rafraichir", response_model=schemas.RafraichissementRead)
def rafraichir_tout(db: Session = Depends(get_db)):
    """Le bouton « Mettre à jour les cours », et la mise à jour au lancement.

    Les titres sans lien sont ignorés en silence — ils ne sont pas en échec,
    ils ne sont pas concernés."""
    return _reponse(db, service_cours.rafraichir(db, service_cours.titres_suivis(db)))


@router.post("/titres/{titre_id}/rafraichir", response_model=schemas.RafraichissementRead)
def rafraichir_titre(titre_id: int, db: Session = Depends(get_db)):
    titre = _get_titre_ou_404(db, titre_id)
    if not titre.url_cours:
        raise HTTPException(
            status_code=400,
            detail=f"« {titre.nom_affiche} » n'a pas de lien : ajoute-en un d'abord.",
        )
    return _reponse(db, service_cours.rafraichir(db, [titre]))
