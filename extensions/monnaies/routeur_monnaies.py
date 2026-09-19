"""Création, renommage et suppression d'une monnaie.

Ces trois routes sont ici et non dans le noyau : c'est le droit d'avoir
PLUSIEURS monnaies qui est optionnel, pas le fait qu'un montant en ait une.
`GET /monnaies` est resté de l'autre côté — cf. app/routers/monnaies.py.

Même préfixe que le routeur du noyau : FastAPI les distingue par la méthode, et
`/monnaies` reste une seule ressource vue du client, qu'on ait ou non le droit
d'y écrire.
"""
from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

# Imports ABSOLUS : ce module n'est pas un sous-paquet de `app`, il est chargé
# par chemin de fichier (cf. extensions/README.md).
from app import crud, extensions as extensions_noyau, schemas
from app.database import get_db
from app.services import soldes as service_soldes

router = APIRouter(prefix="/monnaies", tags=["monnaies"])


@router.post("", response_model=schemas.MonnaieRead, status_code=status.HTTP_201_CREATED)
def create_monnaie(monnaie: schemas.MonnaieCreate, db: Session = Depends(get_db)):
    if crud.get_monnaie_by_nom(db, monnaie.nom) is not None:
        raise HTTPException(status_code=409, detail="Une monnaie avec ce nom existe déjà")
    return crud.create_monnaie(db, monnaie.nom, monnaie.symbole)


@router.put("/{monnaie_id}", response_model=schemas.MonnaieRead)
def update_monnaie(
    monnaie_id: int, updates: schemas.MonnaieUpdate, db: Session = Depends(get_db)
):
    monnaie = crud.get_monnaie(db, monnaie_id)
    if monnaie is None:
        raise HTTPException(status_code=404, detail="Monnaie introuvable")
    if (
        updates.nom is not None
        and updates.nom != monnaie.nom
        and crud.get_monnaie_by_nom(db, updates.nom) is not None
    ):
        raise HTTPException(status_code=409, detail="Une monnaie avec ce nom existe déjà")
    return crud.update_monnaie(db, monnaie, nom=updates.nom, symbole=updates.symbole)


@router.delete("/{monnaie_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_monnaie(monnaie_id: int, db: Session = Depends(get_db)):
    monnaie = crud.get_monnaie(db, monnaie_id)
    if monnaie is None:
        raise HTTPException(status_code=404, detail="Monnaie introuvable")
    # Renommer une monnaie est sans risque, la supprimer ne l'est pas : les
    # montants qui la portaient deviendraient illisibles (aucun taux de change
    # ne permettrait de les rattacher à une autre).
    if crud.monnaie_est_utilisee(db, monnaie_id):
        raise HTTPException(
            status_code=409,
            detail=(
                "Cette monnaie est encore utilisée par un compte, une opération, "
                "un budget ou un titre : elle ne peut pas être supprimée."
            ),
        )
    crud.delete_monnaie(db, monnaie)


def _obstacles_extinction(db: Session, monnaie_id: int) -> list[str]:
    """Ce qui empêche d'éteindre cette monnaie, en clair, ou une liste vide.

    LA CONDITION EST PLUS DURE QUE POUR LA MONNAIE D'UN COMPTE (cf.
    routers/comptes._valider_extinctions), et elle doit l'être : celle-là retire
    une devise d'UN compte, celle-ci la retire de l'application entière. Il faut
    donc qu'AUCUN compte ne porte de solde dans cette monnaie, et qu'aucun titre
    n'y soit détenu.

    LE PROJETÉ COMPTE AUTANT QUE LE RÉEL, même raison qu'ailleurs : un solde nul
    qui porte une opération prévisionnelle attend un mouvement, il n'est pas
    soldé.

    LES TITRES COMPTENT AUSSI, et c'est le piège propre à cette extinction : un
    compte-titres peut n'avoir aucune espèce en dollars tout en détenant pour
    40 000 $ de titres cotés en dollars. Éteindre la devise ferait disparaître
    cette valorisation des écrans sans qu'une seule opération ait bougé.

    ON NOMME CE QUI BLOQUE, jamais « c'est refusé » : devant huit comptes, savoir
    lequel n'est pas soldé est la seule chose qui permette d'agir."""
    obstacles = []

    comptes_non_soldes = sorted(
        item["compte"].nom
        for item in service_soldes.soldes_de_tous_les_liens(db)
        if monnaie_id in item["soldes"]
        and not service_soldes.solde_entierement_nul(item["soldes"][monnaie_id])
    )
    if comptes_non_soldes:
        obstacles.append(
            "un solde non nul sur : " + ", ".join(comptes_non_soldes)
        )

    # Les titres ne sont lus QUE si l'extension « Placements financiers » tourne :
    # sans elle, aucun écran ne montre de titre, et ce service n'a pas à être
    # importé pour rien.
    if extensions_noyau.est_active("placements"):
        from app.services import placements as service_placements

        titres = sorted(
            {
                ligne["action_nom"]
                for compte in service_placements.get_comptes_placement(db)
                for ligne in service_placements.detentions(db, compte.id)
                if ligne["monnaie_id"] == monnaie_id
            }
        )
        if titres:
            obstacles.append("des titres encore détenus : " + ", ".join(titres))

    return obstacles


@router.put("/{monnaie_id}/etat", response_model=schemas.MonnaieRead)
def set_etat_monnaie(
    monnaie_id: int, payload: schemas.MonnaieEtatUpdate, db: Session = Depends(get_db)
):
    """Éteindre une monnaie, ou la rallumer.

    RALLUMER NE DEMANDE RIEN : c'est le geste qui rend visible, jamais celui qui
    cache — même règle que pour un compte ou une catégorie.

    LA DERNIÈRE ALLUMÉE NE S'ÉTEINT PAS : une application sans monnaie active
    n'a plus de quoi libeller une opération, et chaque formulaire de saisie
    proposerait une liste vide. Même protection que « Autres » côté catégories,
    et pour la même raison — ce n'est pas une préférence, c'est ce qui permet à
    l'écran suivant d'exister."""
    monnaie = crud.get_monnaie(db, monnaie_id)
    if monnaie is None:
        raise HTTPException(status_code=404, detail="Monnaie introuvable")
    if payload.active:
        return crud.set_monnaie_active(db, monnaie, True)

    autres_allumees = [
        m for m in crud.get_monnaies(db) if m.active and m.id != monnaie_id
    ]
    if not autres_allumees:
        raise HTTPException(
            status_code=409,
            detail=(
                "C'est la dernière monnaie allumée : l'application n'aurait plus "
                "de quoi libeller une opération. Allume-en une autre d'abord."
            ),
        )

    obstacles = _obstacles_extinction(db, monnaie_id)
    if obstacles:
        raise HTTPException(
            status_code=409,
            detail=(
                f"« {monnaie.nom} » porte encore {' et '.join(obstacles)}. "
                "Solde ces positions avant de l'éteindre — éteindre ne supprime "
                "rien, mais ferait disparaître ces montants des écrans."
            ),
        )
    return crud.set_monnaie_active(db, monnaie, False)
