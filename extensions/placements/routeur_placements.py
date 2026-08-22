from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app import crud, models, schemas
from app.constants import SensAction
from app.database import get_db
from app.services import placements, soldes

router = APIRouter(prefix="/placements", tags=["placements"])


def _get_compte_placement_ou_404(db: Session, compte_id: int) -> models.Compte:
    compte = crud.get_compte(db, compte_id)
    if compte is None:
        raise HTTPException(status_code=404, detail="Compte introuvable")
    if not compte.est_placement:
        raise HTTPException(
            status_code=400,
            detail="Ce compte n'est pas un compte de placements financiers",
        )
    return compte


def _soldes_espece(db: Session) -> dict:
    """Le solde en espèces d'un compte-titres se calcule exactement comme
    n'importe quel solde : les achats/ventes y sont déjà, sous forme d'écritures
    de transfert (cf. crud.create_operation_action). Indexé par (compte,
    monnaie), un compte-titres pouvant porter des espèces dans plusieurs."""
    return {
        (item["compte"].id, monnaie_id): solde["solde_reel"]
        for item in soldes.get_soldes_comptes(db)
        for monnaie_id, solde in item["soldes"].items()
    }


def _lire_compte(db: Session, compte: models.Compte, soldes_espece: dict) -> dict:
    detentions = placements.detentions(db, compte.id)
    valorisations = placements.valorisation_compte(db, compte.id)
    investis = placements.montant_investi_compte(db, compte.id)

    # Une monnaie apparaît si le compte la déclare (elle a alors des espèces,
    # même à zéro) OU si un titre y est valorisé — les deux ne se recoupent pas
    # forcément sur un compte dont on a retiré... rien, mais l'union évite de
    # perdre silencieusement une valorisation.
    par_monnaie = []
    for lien in compte.monnaies:
        monnaie_id = lien.monnaie_id
        espece = soldes_espece.get((compte.id, monnaie_id), 0.0)
        valorisation = valorisations.get(monnaie_id, 0.0)
        par_monnaie.append(
            schemas.PlacementMonnaieRead(
                monnaie_id=monnaie_id,
                monnaie_nom=lien.monnaie.nom,
                monnaie_symbole=lien.monnaie.symbole,
                solde_espece=espece,
                valorisation=valorisation,
                total=espece + valorisation,
                montant_investi=investis.get(monnaie_id, 0.0),
            )
        )

    return {
        "compte_id": compte.id,
        "compte_nom": compte.nom,
        "par_monnaie": par_monnaie,
        "detentions": [schemas.DetentionRead(**ligne) for ligne in detentions],
    }


def _lire_mouvement(mouvement: models.OperationAction) -> schemas.OperationActionRead:
    return schemas.OperationActionRead(
        id=mouvement.id,
        operation_id=mouvement.operation_id,
        action_id=mouvement.action_id,
        action_nom=mouvement.action.nom,
        sens=mouvement.sens,
        quantite=mouvement.quantite,
        prix_unitaire=mouvement.prix_unitaire,
        montant=mouvement.operation.montant,
        monnaie_id=mouvement.action.monnaie_id,
        monnaie_symbole=mouvement.action.monnaie.symbole,
        date=mouvement.operation.date,
        nature=mouvement.operation.nature,
    )


@router.get("", response_model=list[schemas.PlacementCompteRead])
def list_placements(db: Session = Depends(get_db)):
    """Un élément par compte de placements — l'onglet correspondant côté page."""
    soldes_espece = _soldes_espece(db)
    return [
        schemas.PlacementCompteRead(**_lire_compte(db, compte, soldes_espece))
        for compte in placements.get_comptes_placement(db)
    ]


@router.get("/{compte_id}", response_model=schemas.PlacementDetailRead)
def read_placement(compte_id: int, db: Session = Depends(get_db)):
    compte = _get_compte_placement_ou_404(db, compte_id)
    mouvements = placements.get_mouvements(db, compte_id)
    return schemas.PlacementDetailRead(
        **_lire_compte(db, compte, _soldes_espece(db)),
        # Du plus récent au plus ancien à l'écran, l'inverse de l'ordre de
        # calcul du prix de revient.
        operations=[_lire_mouvement(m) for m in reversed(mouvements)],
    )


@router.post(
    "/{compte_id}/operations",
    response_model=schemas.OperationActionRead,
    status_code=status.HTTP_201_CREATED,
)
def create_operation_action(
    compte_id: int, payload: schemas.OperationActionCreate, db: Session = Depends(get_db)
):
    compte = _get_compte_placement_ou_404(db, compte_id)
    action = crud.get_action(db, payload.action_id)
    if action is None:
        raise HTTPException(status_code=404, detail="Titre introuvable")

    # Le prix payé est libellé dans la monnaie de cotation du titre : les
    # espèces bougent donc dans celle-là, et le compte doit la porter.
    if action.monnaie_id not in compte.monnaie_ids:
        raise HTTPException(
            status_code=400,
            detail=(
                f"« {action.nom} » est coté en {action.monnaie.nom}, monnaie que le "
                f"compte « {compte.nom} » ne porte pas : ajoute-la au compte "
                "(Paramètres > Comptes) ou choisis un autre titre."
            ),
        )

    if payload.sens == SensAction.vente:
        # On ne peut vendre que ce qui est détenu SUR CE COMPTE : le même titre
        # peut être détenu ailleurs sans être disponible ici.
        detenue = placements.quantite_detenue(db, compte_id, action.id)
        if payload.quantite > detenue + placements.EPSILON_QUANTITE:
            raise HTTPException(
                status_code=400,
                detail=(
                    f"Quantité insuffisante : {detenue:g} « {action.nom} » "
                    f"détenu(s) sur ce compte, {payload.quantite:g} demandé(s)"
                ),
            )

    mouvement = crud.create_operation_action(
        db,
        compte_id=compte.id,
        action=action,
        sens=payload.sens,
        quantite=payload.quantite,
        prix_unitaire=payload.prix_unitaire,
        date_operation=payload.date,
        nature=payload.nature,
    )
    return _lire_mouvement(mouvement)


@router.delete("/operations/{operation_action_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_operation_action(operation_action_id: int, db: Session = Depends(get_db)):
    """Supprime le mouvement et son écriture d'espèces.

    Aucun garde-fou sur la quantité résultante : une position ne peut devenir
    négative que si l'achat supprimé était couvert par une vente postérieure,
    et refuser la suppression enfermerait alors l'utilisateur (il devrait
    deviner quelle vente défaire d'abord). La page affiche la quantité
    recalculée, qui rend l'incohérence visible immédiatement.
    """
    mouvement = crud.get_operation_action(db, operation_action_id)
    if mouvement is None:
        raise HTTPException(status_code=404, detail="Mouvement de titres introuvable")
    crud.delete_operation_action(db, mouvement)
