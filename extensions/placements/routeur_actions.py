from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app import crud, schemas
from app.database import get_db
from app.services import placements

router = APIRouter(prefix="/actions", tags=["placements"])


def _action_read(action) -> schemas.ActionRead:
    return schemas.ActionRead(
        id=action.id,
        # Les trois dénominations, et elles ne servent pas à la même chose :
        # `nom` identifie (c'est lui que l'import rapproche), `nom_affiche` se
        # lit, `code_isin` identifie mieux encore quand le fichier le porte.
        nom=action.nom,
        nom_affichage=action.nom_affichage,
        nom_affiche=action.nom_affiche,
        valeur=action.valeur,
        monnaie_id=action.monnaie_id,
        monnaie_symbole=action.monnaie.symbole,
        archivee=action.archivee,
        code_isin=action.code_isin,
        # Le libellé voyage à côté de l'identifiant : les tableaux l'affichent
        # tel quel, sans avoir à recharger la liste des types pour le résoudre.
        type_titre_id=action.type_titre_id,
        type_titre_nom=action.type_titre.nom if action.type_titre else None,
    )


def _quantite_lisible(quantite: float) -> str:
    """Une quantité de titres telle qu'on l'écrirait : « 12 » et non « 12.0 »,
    mais « 0,5 » quand la fraction compte (les ETF s'achètent en fractions)."""
    arrondie = round(quantite, 6)
    return str(int(arrondie)) if arrondie == int(arrondie) else f"{arrondie:g}"


def _valider_monnaie(db: Session, monnaie_id) -> None:
    if monnaie_id is not None and crud.get_monnaie(db, monnaie_id) is None:
        raise HTTPException(status_code=404, detail="Monnaie introuvable")


def _valider_type_titre(db: Session, type_titre_id) -> None:
    """0 est LE DÉTYPAGE, pas un identifiant : le menu envoie « aucun » sous
    cette forme, et il n'y a rien à aller chercher en base."""
    if type_titre_id and crud.get_type_titre(db, type_titre_id) is None:
        raise HTTPException(status_code=404, detail="Type de titre introuvable")


@router.get("", response_model=list[schemas.ActionRead])
def list_actions(inclure_archivees: bool = False, db: Session = Depends(get_db)):
    """Les titres en service. `inclure_archivees=true` rend aussi ceux qu'on a
    rangés — l'écran s'en sert pour la case « Afficher les titres archivés »,
    qui est le seul endroit d'où l'on peut en remettre un en service."""
    return [
        _action_read(action)
        for action in crud.get_actions(db, inclure_archivees=inclure_archivees)
    ]


@router.post("", response_model=schemas.ActionRead, status_code=status.HTTP_201_CREATED)
def create_action(payload: schemas.ActionCreate, db: Session = Depends(get_db)):
    if crud.get_action_by_nom(db, payload.nom):
        raise HTTPException(status_code=409, detail="Un titre avec ce nom existe déjà")
    _valider_monnaie(db, payload.monnaie_id)
    _valider_type_titre(db, payload.type_titre_id)
    # L'ISIN VOYAGEAIT SANS ÊTRE ÉCRIT : le schéma l'acceptait, la création ne le
    # posait pas. Un titre saisi ici perdait donc son code, et l'import suivant,
    # qui rapproche par l'ISIN avant le nom, en créait un second.
    return _action_read(
        crud.create_action(
            db,
            payload.nom,
            payload.monnaie_id,
            payload.valeur,
            payload.code_isin,
            payload.type_titre_id,
        )
    )


@router.put("/{action_id}", response_model=schemas.ActionRead)
def update_action(action_id: int, payload: schemas.ActionUpdate, db: Session = Depends(get_db)):
    """Renommer, et surtout mettre à jour le cours : l'app n'a aucune source de
    marché, cette valeur est saisie à la main et ne sert qu'à valoriser les
    portefeuilles à l'écran — jamais à recalculer un solde en espèces, qui ne
    dépend que des prix réellement payés.

    DEUX NOMS, ET UN SEUL SE RENOMME DEPUIS L'ÉCRAN. `nom_affichage` est ce
    qu'on lit ; `nom` est ce que le courtier écrit, et c'est par lui — à défaut
    d'ISIN — que l'import RECONNAÎT le titre d'un fichier à l'autre. Le second
    reste modifiable par cette route (rien ne l'interdit), mais l'écran ne le
    propose pas : le changer ferait que l'import suivant ne retrouverait plus le
    titre et scinderait la position en deux."""
    action = crud.get_action(db, action_id)
    if action is None:
        raise HTTPException(status_code=404, detail="Titre introuvable")
    if (
        payload.nom is not None
        and payload.nom != action.nom
        and crud.get_action_by_nom(db, payload.nom)
    ):
        raise HTTPException(status_code=409, detail="Un titre avec ce nom existe déjà")
    _valider_monnaie(db, payload.monnaie_id)
    _valider_type_titre(db, payload.type_titre_id)
    # Changer la monnaie de cotation d'un titre déjà mouvementé réécrirait le
    # sens de mouvements passés (le prix payé était libellé dans l'ancienne) :
    # les écritures d'espèces existantes, elles, ne bougeraient pas.
    if (
        payload.monnaie_id is not None
        and payload.monnaie_id != action.monnaie_id
        and crud.action_est_utilisee(db, action_id)
    ):
        raise HTTPException(
            status_code=409,
            detail=(
                "Ce titre a des mouvements enregistrés : sa monnaie de cotation "
                "ne peut plus changer (les montants déjà payés sont libellés dans "
                "l'ancienne)."
            ),
        )
    # ARCHIVER UN TITRE QU'ON DÉTIENT ENCORE n'a pas de sens : il sortirait des
    # menus tout en continuant de peser dans la valorisation du portefeuille,
    # sans plus aucun moyen de le vendre depuis l'écran. Le désarchivage, lui,
    # ne se refuse jamais.
    if payload.archivee and not action.archivee:
        quantite = placements.quantite_detenue_totale(db, action_id)
        if quantite > placements.EPSILON_QUANTITE:
            raise HTTPException(
                status_code=409,
                detail=(
                    f"« {action.nom} » est encore détenu ({_quantite_lisible(quantite)} "
                    "titre(s)) : vends la position avant de l'archiver."
                ),
            )
    return _action_read(
        crud.update_action(
            db,
            action,
            nom=payload.nom,
            nom_affichage=payload.nom_affichage,
            valeur=payload.valeur,
            monnaie_id=payload.monnaie_id,
            archivee=payload.archivee,
            type_titre_id=payload.type_titre_id,
        )
    )


@router.delete("/{action_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_action(action_id: int, db: Session = Depends(get_db)):
    action = crud.get_action(db, action_id)
    if action is None:
        raise HTTPException(status_code=404, detail="Titre introuvable")
    # UN TITRE MOUVEMENTÉ NE SE SUPPRIME PAS, et ce n'est pas une limitation
    # qu'on lèvera : chacun de ses mouvements porte une opération d'espèces
    # réelle (cf. models.OperationAction), et les effacer réécrirait le solde du
    # compte-titres et tout ce qui en découle.
    #
    # Le message DIT LA SORTIE. Il envoyait auparavant supprimer les mouvements
    # un à un — c'est-à-dire détruire l'historique de ce qu'on a réellement
    # acheté et vendu, pour le seul confort de ne plus voir une ligne. Ranger le
    # titre donne le même résultat à l'écran sans rien perdre.
    if crud.action_est_utilisee(db, action_id):
        raise HTTPException(
            status_code=409,
            detail=(
                f"« {action.nom} » a des mouvements enregistrés : il ne peut pas être "
                "supprimé sans réécrire les soldes du compte. Archive-le plutôt — il "
                "quitte les listes, son historique et ses plus-values restent."
            ),
        )
    crud.delete_action(db, action)
