"""Les taux de change saisis à la main, et la vue du dashboard convertie.

TOUT VIT SOUS `/conversion`, et le choix de ce préfixe n'est pas cosmétique.

PAS `/taux-change` : il appartient à l'extension « Lecture de cours », et deux
extensions qui déclareraient le même chemin verraient FastAPI n'en retenir qu'un,
au hasard de l'ordre de chargement.

PAS `/monnaies/...` NON PLUS, alors même que c'est cette extension-ci qui sert
`/monnaies` : le routeur des monnaies déclare `PUT /monnaies/{monnaie_id}`, et il
est monté avant. `/monnaies/taux` y serait capté comme une monnaie dont
l'identifiant vaudrait « taux », et rendrait 422 sans que rien ne le signale.
Un préfixe qui ne peut pas être lu comme le paramètre d'une autre route est la
seule protection ; ce n'est pas au chemin le plus joli d'arbitrer.

Les deux extensions écrivent en revanche dans la MÊME table du noyau
(`taux_change`), ce qui est exactement la façon dont deux extensions sont censées
partager une donnée : le schéma reste au noyau, chacune apporte son geste.

CE QUE CES ROUTES CHANGENT AU RESTE DE L'APPLICATION : rien, tant qu'on ne
demande pas. Les soldes, les budgets, les opérations et les onglets par monnaie
continuent de fonctionner monnaie par monnaie. La conversion est une LECTURE de
plus, calculée à la demande, qui n'écrit nulle part.
"""
from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, status
from pydantic import BaseModel, Field
from sqlalchemy.orm import Session

from app import crud, models, schemas
from app.database import get_db

import service_conversion
import service_dashboard_agrege

router = APIRouter(prefix="/conversion", tags=["monnaies"])


class TauxManuelInput(BaseModel):
    """« 1 unité de `monnaie_source` vaut `taux` unités de `monnaie_cible` ».

    Le sens compte : l'ordre des deux monnaies porte celui du taux. L'inverse
    n'a pas à être saisi — la conversion sait diviser (cf. service_conversion).
    """

    monnaie_source_id: int
    monnaie_cible_id: int
    # Strictement positif : un taux nul ou négatif ne décrit rien, et ferait
    # exploser la division par laquelle on lit le couple à l'envers.
    taux: float = Field(gt=0)


class MonnaieNonConvertie(BaseModel):
    """Une monnaie qu'aucun taux ne relie à celle qu'on regarde."""

    monnaie_id: int
    monnaie_nom: str
    monnaie_symbole: str


class DashboardAgregeRead(BaseModel):
    """Le dashboard converti, et ce qui a dû en être écarté.

    LES DEUX ENSEMBLE, toujours. Un total amputé sans le dire vaudrait moins
    qu'un refus : l'écran nomme les monnaies manquantes à côté du chiffre."""

    dashboard: Optional[schemas.DashboardRead] = None
    non_converties: list[MonnaieNonConvertie] = []


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


def _non_convertie(monnaie: models.Monnaie) -> MonnaieNonConvertie:
    return MonnaieNonConvertie(
        monnaie_id=monnaie.id, monnaie_nom=monnaie.nom, monnaie_symbole=monnaie.symbole
    )


@router.get("/taux", response_model=list[schemas.TauxChangeRead])
def list_taux(db: Session = Depends(get_db)):
    """TOUS les couples, ceux saisis à la main comme ceux relus en ligne.

    Contrairement à `/taux-change` qui ne rend que ce que « Lecture de cours »
    sait relire : cet écran-ci est celui d'où l'on décide de convertir, il doit
    montrer tous les taux dont la conversion dispose, quelle qu'en soit
    l'origine."""
    couples = (
        db.query(models.TauxChange)
        .order_by(models.TauxChange.monnaie_source_id, models.TauxChange.monnaie_cible_id)
        .all()
    )
    return [_taux_read(couple) for couple in couples]


@router.put("/taux", response_model=schemas.TauxChangeRead)
def poser_taux(payload: TauxManuelInput, db: Session = Depends(get_db)):
    """Enregistre (ou corrige) le taux d'un couple.

    UN PUT ET NON UN POST : saisir deux fois le même couple n'est pas une
    erreur, c'est le geste ordinaire — on met à jour un taux qu'on sait avoir
    bougé. Refuser le second obligerait à supprimer pour ressaisir.

    LE LIEN DE COTATION N'EST PAS EFFACÉ quand le couple en portait un : corriger
    un taux à la main sur un couple suivi en ligne est légitime (la page peut
    dater), et cela ne veut pas dire qu'on renonce à le relire. Le prochain
    rafraîchissement écrasera la saisie, ce qui est bien ce qu'on attend d'un
    couple qu'on a demandé à suivre.
    """
    if payload.monnaie_source_id == payload.monnaie_cible_id:
        raise HTTPException(
            status_code=400, detail="Les deux monnaies d'un couple doivent être différentes."
        )
    for monnaie_id in (payload.monnaie_source_id, payload.monnaie_cible_id):
        if crud.get_monnaie(db, monnaie_id) is None:
            raise HTTPException(status_code=404, detail="Monnaie introuvable")

    couple = (
        db.query(models.TauxChange)
        .filter(
            models.TauxChange.monnaie_source_id == payload.monnaie_source_id,
            models.TauxChange.monnaie_cible_id == payload.monnaie_cible_id,
        )
        .first()
    )
    if couple is None:
        couple = models.TauxChange(
            monnaie_source_id=payload.monnaie_source_id,
            monnaie_cible_id=payload.monnaie_cible_id,
            url_cours=None,
        )
        db.add(couple)
    couple.taux = payload.taux
    couple.maj_le = datetime.now()
    db.commit()
    db.refresh(couple)
    return _taux_read(couple)


@router.delete("/taux/{taux_id}", status_code=status.HTTP_204_NO_CONTENT)
def supprimer_taux(taux_id: int, db: Session = Depends(get_db)):
    """Oublie ce taux. Rien d'autre ne disparaît : aucun montant enregistré n'en
    dépendait — la conversion cesse simplement de savoir faire ce couple."""
    couple = db.query(models.TauxChange).filter(models.TauxChange.id == taux_id).first()
    if couple is None:
        raise HTTPException(status_code=404, detail="Taux introuvable")
    db.delete(couple)
    db.commit()


@router.get("/dashboard", response_model=DashboardAgregeRead)
def get_dashboard_agrege(
    vers: int,
    annee: Optional[int] = None,
    mois: Optional[int] = None,
    vue: str = "mois",
    db: Session = Depends(get_db),
):
    """Le dashboard, tout entier ramené à la monnaie `vers`.

    MÊME FORME QUE `/dashboard`, à une monnaie près : le frontend rend cette vue
    avec les fonctions d'affichage du noyau, sans une ligne en double.

    `dashboard` à null veut dire que `vers` n'est portée par aucun compte : il
    n'y a rien à convertir VERS elle, et l'écran retombe alors sur ses onglets.
    """
    if crud.get_monnaie(db, vers) is None:
        raise HTTPException(status_code=404, detail="Monnaie introuvable")
    payload, manquantes = service_dashboard_agrege.dashboard_agrege(db, annee, mois, vue, vers)
    return DashboardAgregeRead(
        dashboard=payload,
        # La monnaie visée n'est jamais « manquante » pour elle-même.
        non_converties=[_non_convertie(m) for m in manquantes if m.id != vers],
    )


@router.get("/table", response_model=dict)
def get_conversion(vers: int, db: Session = Depends(get_db)):
    """La table des coefficients vers une monnaie, telle quelle.

    Sert aux écrans qui n'ont qu'un chiffre à convertir et n'ont pas besoin d'un
    dashboard entier ; elle rend aussi visible ce que la conversion sait faire,
    ce qui est la première chose qu'on veut vérifier quand un total surprend."""
    if crud.get_monnaie(db, vers) is None:
        raise HTTPException(status_code=404, detail="Monnaie introuvable")
    coefficients, manquantes = service_conversion.table_de_conversion(db, vers)
    return {
        "vers": vers,
        # Clés en chaîne : c'est ce qu'un objet JSON impose de toute façon, et
        # l'écrire ici évite que le frontend ait à deviner.
        "coefficients": {str(cle): valeur for cle, valeur in coefficients.items()},
        "non_converties": [_non_convertie(m).model_dump() for m in manquantes if m.id != vers],
    }
