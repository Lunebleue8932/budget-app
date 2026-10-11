from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from .. import crud, models, schemas
from ..database import get_db
from ..services import soldes as service_soldes

router = APIRouter(prefix="/comptes", tags=["comptes"])


def _soldes_du_compte(db: Session, compte_id: int) -> dict:
    """{monnaie_id: {"solde_reel": …, "solde_projete": …}} pour un compte, les
    monnaies ÉTEINTES comprises.

    C'est ce qui permet à l'écran de griser la case d'extinction d'une monnaie
    qui porte encore quelque chose, plutôt que de laisser cliquer et refuser
    ensuite. `soldes_de_tous_les_liens` et non `get_soldes_comptes` : cette
    seconde efface justement les monnaies éteintes et soldées, or c'est
    exactement celles que l'écran doit montrer pour pouvoir les rallumer."""
    for item in service_soldes.soldes_de_tous_les_liens(db):
        if item["compte"].id == compte_id:
            return item["soldes"]
    return {}


def _compte_read(compte: models.Compte, soldes: dict | None = None) -> schemas.CompteRead:
    soldes = soldes or {}
    return schemas.CompteRead(
        id=compte.id,
        nom=compte.nom,
        type_id=compte.type_id,
        type_nom=compte.type_nom,
        monnaies=[
            schemas.CompteMonnaieRead(
                monnaie_id=lien.monnaie_id,
                solde_initial=lien.solde_initial,
                solde_actuel_renseigne=lien.solde_actuel_renseigne,
                active=lien.active,
                monnaie_nom=lien.monnaie.nom,
                monnaie_symbole=lien.monnaie.symbole,
                solde_reel=soldes.get(lien.monnaie_id, {}).get("solde_reel", 0.0),
                solde_projete=soldes.get(lien.monnaie_id, {}).get("solde_projete", 0.0),
            )
            for lien in compte.monnaies
        ],
        actif=compte.actif,
    )


@router.get("", response_model=list[schemas.CompteRead])
def list_comptes(db: Session = Depends(get_db)):
    # Un seul passage de calcul pour toute la liste : le faire compte par compte
    # relancerait les trois requêtes d'agrégation autant de fois qu'il y a de
    # comptes, pour un résultat identique.
    par_compte = {
        item["compte"].id: item["soldes"]
        for item in service_soldes.soldes_de_tous_les_liens(db)
    }
    return [
        _compte_read(compte, par_compte.get(compte.id))
        for compte in crud.get_comptes(db)
    ]


def _valider_type_compte(db: Session, type_id) -> None:
    if type_id is not None and crud.get_type_compte(db, type_id) is None:
        raise HTTPException(status_code=404, detail="Type de compte introuvable")


def _valider_monnaies(db: Session, monnaies: list[schemas.CompteMonnaieInput]) -> None:
    ids = [entree.monnaie_id for entree in monnaies]
    if len(set(ids)) != len(ids):
        raise HTTPException(
            status_code=400, detail="Une même monnaie ne peut pas être ajoutée deux fois"
        )
    for monnaie_id in ids:
        if crud.get_monnaie(db, monnaie_id) is None:
            raise HTTPException(
                status_code=404, detail=f"Monnaie {monnaie_id} introuvable"
            )
    # UN COMPTE GARDE AU MOINS UNE MONNAIE ALLUMÉE. C'est la même règle que
    # « au moins une monnaie » (Field min_length=1 sur le schéma), lue du côté
    # de ce que le compte PROPOSE : toutes éteintes, il ne pourrait plus
    # recevoir la moindre opération, et `monnaie_principale_id` — la monnaie
    # retenue pour une ligne importée — n'aurait rien à rendre.
    if not any(entree.active for entree in monnaies):
        raise HTTPException(
            status_code=400,
            detail=(
                "Un compte doit garder au moins une monnaie active : éteins-en une "
                "autre après en avoir rallumé une."
            ),
        )


def _valider_extinctions(
    db: Session, compte: models.Compte, monnaies: list[schemas.CompteMonnaieInput]
) -> None:
    """Une monnaie ne s'éteint QUE SOLDÉE — c'est la condition qui rend tout le
    reste sûr.

    Une monnaie éteinte disparaît des cartes de compte et des onglets du
    dashboard (cf. services/soldes.get_soldes_comptes) : l'éteindre alors qu'elle
    porte encore de l'argent ferait disparaître ce montant de tous les totaux
    affichés sans qu'aucune opération n'ait bougé. La règle est donc posée ici,
    au seul endroit d'où l'extinction peut venir, et pas seulement suggérée par
    une case grisée à l'écran.

    LE PROJETÉ COMPTE AUTANT QUE LE RÉEL : une monnaie dont le solde réel est
    nul mais qui porte une opération prévisionnelle attend un mouvement, elle
    n'est pas soldée.

    RALLUMER NE DEMANDE RIEN : c'est le geste qui rend visible, jamais celui qui
    cache."""
    deja_eteintes = {lien.monnaie_id for lien in compte.monnaies if not lien.active}
    a_eteindre = {
        entree.monnaie_id
        for entree in monnaies
        if not entree.active and entree.monnaie_id not in deja_eteintes
    }
    if not a_eteindre:
        return

    soldes = _soldes_du_compte(db, compte.id)
    non_soldees = sorted(
        crud.get_monnaie(db, monnaie_id).nom
        for monnaie_id in a_eteindre
        if monnaie_id in soldes
        and not service_soldes.solde_entierement_nul(soldes[monnaie_id])
    )
    if non_soldees:
        raise HTTPException(
            status_code=409,
            detail=(
                f"Le solde de ce compte en {', '.join(non_soldees)} n'est pas nul : "
                "vire ce qui reste sur une autre monnaie (ou un autre compte) avant "
                "d'éteindre."
            ),
        )


def _deduire_soldes_initiaux(
    db: Session, compte: models.Compte, monnaies: list[schemas.CompteMonnaieInput]
) -> list[schemas.CompteMonnaieInput]:
    """Applique le « solde actuel renseigné » : rend la liste des monnaies avec le
    solde initial qui en DÉCOULE.

    TROIS CAS PAR MONNAIE, selon ce qui était enregistré et ce qui arrive :
      - rien d'enregistré, rien d'envoyé : le solde initial envoyé est celui qui compte ;
      - rien d'enregistré, un solde actuel envoyé : on DÉDUIT le solde initial —
        `solde actuel - ce que les opérations ont changé` (intérêts perçus compris, c'est
        le même calcul que le solde réel affiché) ;
      - un solde actuel déjà enregistré : le solde initial est VERROUILLÉ. Renvoyé à
        l'identique, il garde la valeur déduite ; envoyé à None, c'est la suppression du
        solde actuel renseigné et le solde initial envoyé redevient libre ; envoyé
        DIFFÉRENT, c'est refusé (409) — « pour le modifier, on supprime d'abord le solde
        actuel renseigné », jamais deux gestes en un.
    """
    soldes = _soldes_du_compte(db, compte.id)
    existants = {lien.monnaie_id: lien for lien in compte.monnaies}
    resultat = []
    for entree in monnaies:
        lien = existants.get(entree.monnaie_id)
        enregistre = lien.solde_actuel_renseigne if lien is not None else None
        saisi = entree.solde_actuel_renseigne
        if enregistre is not None and saisi is not None:
            if abs(saisi - enregistre) >= 0.005:
                raise HTTPException(
                    status_code=409,
                    detail=(
                        "Le solde initial de ce compte est verrouillé par le solde actuel "
                        "renseigné : supprime d'abord ce dernier pour le modifier."
                    ),
                )
            resultat.append(entree.model_copy(update={"solde_initial": lien.solde_initial}))
        elif saisi is not None and lien is not None:
            solde_reel = soldes.get(entree.monnaie_id, {}).get("solde_reel", lien.solde_initial)
            variation = solde_reel - lien.solde_initial
            resultat.append(
                entree.model_copy(update={"solde_initial": round(saisi - variation, 2)})
            )
        elif saisi is not None:
            # Une monnaie qui rejoint le compte n'a aucune opération : rien à déduire.
            resultat.append(entree.model_copy(update={"solde_initial": round(saisi, 2)}))
        else:
            resultat.append(entree)
    return resultat


@router.post("", response_model=schemas.CompteRead, status_code=status.HTTP_201_CREATED)
def create_compte(compte: schemas.CompteCreate, db: Session = Depends(get_db)):
    if crud.get_compte_by_nom(db, compte.nom):
        raise HTTPException(status_code=409, detail="Un compte avec ce nom existe déjà")
    _valider_type_compte(db, compte.type_id)
    _valider_monnaies(db, compte.monnaies)
    cree = crud.create_compte(db, compte)
    return _compte_read(cree, _soldes_du_compte(db, cree.id))


@router.put("/reordonner", response_model=list[schemas.CompteRead])
def reordonner_comptes(payload: schemas.ReordonnerComptesInput, db: Session = Depends(get_db)):
    """Applique le nouvel ordre d'affichage issu d'un glisser-déposer côté
    frontend : `ordre` liste les ids des comptes d'un type, dans l'ordre voulu.

    Déclarée AVANT `/{compte_id}` : sans quoi FastAPI, qui essaie les routes
    dans l'ordre de déclaration, tenterait de lire "reordonner" comme un id."""
    crud.reordonner_comptes(db, payload.ordre)
    return list_comptes(db)


@router.put("/{compte_id}/etat", response_model=schemas.CompteRead)
def set_etat_compte(
    compte_id: int, updates: schemas.CompteEtatUpdate, db: Session = Depends(get_db)
):
    """Allume ou éteint un compte (migration 0063).

    CE QUE L'EXTINCTION CHANGE : le compte quitte les menus de saisie
    (opération, virement, import, placements) et le serveur refuse toute
    nouvelle écriture qui le désignerait (cf. crud.erreur_compte_eteint). Il
    disparaît en plus des écrans de solde TANT QU'IL NE PORTE RIEN — sur une
    période où il portait encore de l'argent, il reparaît tel qu'il était.

    ELLE NE DEMANDE RIEN, contrairement à l'extinction d'une MONNAIE, qui exige
    un solde nul. La différence n'est pas un oubli : une monnaie éteinte
    disparaît d'une carte de compte qui, elle, reste affichée — le montant
    s'évanouirait au milieu des autres. Un compte, lui, reste visible tant qu'il
    porte quelque chose : rien ne peut disparaître en silence, et il n'y a donc
    rien à interdire."""
    db_compte = crud.get_compte(db, compte_id)
    if db_compte is None:
        raise HTTPException(status_code=404, detail="Compte introuvable")
    crud.set_compte_actif(db, db_compte, updates.actif)
    return _compte_read(db_compte, _soldes_du_compte(db, compte_id))


@router.get("/{compte_id}", response_model=schemas.CompteRead)
def read_compte(compte_id: int, db: Session = Depends(get_db)):
    db_compte = crud.get_compte(db, compte_id)
    if db_compte is None:
        raise HTTPException(status_code=404, detail="Compte introuvable")
    return _compte_read(db_compte, _soldes_du_compte(db, compte_id))


@router.put("/{compte_id}", response_model=schemas.CompteRead)
def update_compte(
    compte_id: int, updates: schemas.CompteUpdate, db: Session = Depends(get_db)
):
    db_compte = crud.get_compte(db, compte_id)
    if db_compte is None:
        raise HTTPException(status_code=404, detail="Compte introuvable")
    if (
        updates.nom is not None
        and updates.nom != db_compte.nom
        and crud.get_compte_by_nom(db, updates.nom)
    ):
        raise HTTPException(status_code=409, detail="Un compte avec ce nom existe déjà")
    _valider_type_compte(db, updates.type_id)
    if updates.monnaies is not None:
        _valider_monnaies(db, updates.monnaies)
        _valider_extinctions(db, db_compte, updates.monnaies)
        # Retirer une monnaie dans laquelle le compte porte déjà des opérations
        # laisserait des montants sans support : le solde de cette monnaie ne
        # serait plus calculé nulle part alors que les écritures existent.
        #
        # C'EST CE REFUS QUI A RENDU L'EXTINCTION NÉCESSAIRE : un compte ouvert
        # un temps en dollars, soldé depuis, ne pouvait plus s'en défaire sans
        # supprimer son historique. Le message nomme donc l'autre porte.
        retirees = crud.compte_monnaies_utilisees(db, compte_id) - {
            entree.monnaie_id for entree in updates.monnaies
        }
        if retirees:
            noms = ", ".join(
                sorted(crud.get_monnaie(db, monnaie_id).nom for monnaie_id in retirees)
            )
            raise HTTPException(
                status_code=409,
                detail=(
                    f"Ce compte porte déjà des opérations en {noms} : éteins cette "
                    "monnaie plutôt que de la retirer (elle cesse d'être proposée, "
                    "l'historique reste), ou supprime d'abord ces opérations."
                ),
            )
        updates = updates.model_copy(
            update={"monnaies": _deduire_soldes_initiaux(db, db_compte, updates.monnaies)}
        )
    modifie = crud.update_compte(db, db_compte, updates)
    return _compte_read(modifie, _soldes_du_compte(db, compte_id))


@router.delete("/{compte_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_compte(compte_id: int, db: Session = Depends(get_db)):
    db_compte = crud.get_compte(db, compte_id)
    if db_compte is None:
        raise HTTPException(status_code=404, detail="Compte introuvable")
    if db_compte.operations:
        raise HTTPException(
            status_code=409,
            detail="Impossible de supprimer un compte qui a des opérations liées",
        )
    crud.delete_compte(db, db_compte)
