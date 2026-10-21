from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

# Imports ABSOLUS vers le noyau : ce module n'est pas un sous-paquet de `app`,
# il est chargé par chemin de fichier (cf. extensions/README.md).
from app import crud, schemas
from app.constants import (
    TYPES_AVEC_CATEGORIE_LIBRE,
    TYPES_INTERNES,
    DomaineImport,
    TypeOperation,
    id_colonne_dummy_regle,
)
from app.database import get_db

router = APIRouter(prefix="/regles-categorisation", tags=["regles"])


def _get_regle_ou_404(db: Session, regle_id: int):
    regle = crud.get_regle_categorisation(db, regle_id)
    if regle is None:
        raise HTTPException(status_code=404, detail="Règle introuvable")
    return regle


def _valider_action(db: Session, type_id, categorie_id, compte_autre_id, decoupes=None):
    """(catégorie, découpe, compte en face) retenus pour ce type d'action.

    La structure des conditions est déjà validée par les schémas Pydantic
    (champs connus, valeur non vide, au moins un groupe) ; restent l'existence
    du type, de la catégorie et du compte visés, qui demandent la base.

    Les trois sont NEUTRALISÉS pour les types qui ne les admettent pas, plutôt
    que rejetés : changer de type dans l'interface ne doit jamais laisser une
    combinaison incohérente en base. La catégorie et la découpe n'ont de sens
    que pour les types à catégorie libre, le compte en face que pour le
    virement interne — seul type qui touche deux comptes.

    LA DÉCOUPE L'EMPORTE SUR LA CATÉGORIE UNIQUE quand les deux arrivent
    ensemble. Elles répondent à la même question — dans quelle catégorie cette
    ligne tombe-t-elle — et une règle qui prétendrait y répondre deux fois
    laisserait le moteur d'import choisir à sa place. C'est une neutralisation,
    pas un refus, pour la même raison que ci-dessus : un formulaire qui bascule
    d'un mode à l'autre laisse traîner le champ qu'il vient de quitter.

    SANS TYPE (migration 0071), la règle ne dit pas ce qu'est la ligne : sa
    catégorie ou sa découpe sont gardées telles quelles — elles ne vaudront, à
    l'import, que si le type finalement retenu en admet une (cf.
    regles_categorisation._completer) — et le compte en face aussi, qui ne
    vaudra que pour un virement.

    LA CATÉGORIE DES VIREMENTS INTERNES FAIT LE TYPE (migration 0090), comme au
    formulaire d'opération : une règle qui la choisit, sans type ou avec un type à
    catégorie libre, devient une règle de virement ; une règle de virement porte
    cette catégorie, et elle seule. Une part de découpe ne peut pas la viser.

    Rend (type, catégorie, découpe, compte en face) retenus."""
    categorie_virements = crud.get_categorie_virements(db)
    for part in decoupes or []:
        if part.categorie_id == categorie_virements.id:
            raise HTTPException(
                status_code=400,
                detail=crud.ERREUR_PART_VIREMENTS.format(nom=categorie_virements.nom),
            )
    if categorie_id == categorie_virements.id and not decoupes:
        type_choisi = crud.get_type_operation(db, type_id) if type_id is not None else None
        if type_id is None or (
            type_choisi is not None
            and TypeOperation(type_choisi.code) in TYPES_AVEC_CATEGORIE_LIBRE
        ):
            type_id = crud.get_type_operation_par_code(db, TypeOperation.virement.value).id
    if type_id is None:
        for part in decoupes or []:
            if crud.get_categorie(db, part.categorie_id) is None:
                raise HTTPException(status_code=404, detail="Catégorie de découpe introuvable")
        if decoupes:
            return None, None, list(decoupes), None
        if categorie_id is not None and crud.get_categorie(db, categorie_id) is None:
            raise HTTPException(status_code=404, detail="Catégorie introuvable")
        return None, categorie_id, [], None
    type_operation = crud.get_type_operation(db, type_id)
    if type_operation is None:
        raise HTTPException(status_code=404, detail="Type d'opération introuvable")
    code = TypeOperation(type_operation.code)
    if code in TYPES_INTERNES:
        # Un mouvement de titres ne se déduit pas d'un libellé bancaire : il lui
        # manquerait le titre, la quantité et le prix.
        raise HTTPException(
            status_code=400,
            detail=(
                f"Le type « {type_operation.nom} » ne peut pas être posé par une règle : "
                "les achats/ventes de titres se saisissent depuis l'onglet Placements financiers."
            ),
        )

    compte_retenu = None
    if code == TypeOperation.virement and compte_autre_id is not None:
        if crud.get_compte(db, compte_autre_id) is None:
            raise HTTPException(status_code=404, detail="Compte en face introuvable")
        compte_retenu = compte_autre_id

    if code == TypeOperation.virement:
        return type_id, categorie_virements.id, [], compte_retenu
    if code not in TYPES_AVEC_CATEGORIE_LIBRE:
        return type_id, None, [], compte_retenu

    # SEULE UNE OPÉRATION CLASSIQUE SE DÉCOUPE (cf. crud.erreur_decoupes) : une
    # règle qui poserait une découpe sur une dépense remboursable produirait à
    # l'import des lignes que la route des opérations refuserait ensuite.
    if decoupes and code != TypeOperation.classique:
        raise HTTPException(
            status_code=400,
            detail=(
                f"Le type « {type_operation.nom} » ne se découpe pas : seule une "
                "opération classique peut répartir son montant entre plusieurs catégories."
            ),
        )
    for part in decoupes or []:
        if crud.get_categorie(db, part.categorie_id) is None:
            raise HTTPException(status_code=404, detail="Catégorie de découpe introuvable")
    if decoupes:
        return type_id, None, list(decoupes), compte_retenu

    if categorie_id is not None and crud.get_categorie(db, categorie_id) is None:
        raise HTTPException(status_code=404, detail="Catégorie introuvable")
    return type_id, categorie_id, [], compte_retenu


def _autres_actions(db: Session, payload) -> dict:
    """Les actions ajoutées par la migration 0071, nettoyées.

    UN TEXTE VIDE NE DIT RIEN : un champ « Renommer en » laissé blanc veut dire
    « ne renomme pas », jamais « efface le libellé » — une opération sans nature
    serait refusée à l'import. Même règle pour la note."""
    if payload.compte_id is not None and crud.get_compte(db, payload.compte_id) is None:
        raise HTTPException(status_code=404, detail="Compte introuvable")
    nature = (payload.nature_remplacement or "").strip() or None
    notes = (payload.notes or "").strip() or None
    return dict(
        presets=_presets_valides(db, payload.presets),
        nature_remplacement=nature,
        compte_id=payload.compte_id,
        notes=notes,
        imprevue=payload.imprevue,
        a_declarer=payload.a_declarer,
        amortissement_mois=payload.amortissement_mois,
        sorties=[_sortie_validee(db, sortie) for sortie in payload.sorties],
    )


def _presets_valides(db: Session, presets):
    """Les formats d'import visés par la règle (migration 0077), vérifiés.

    None = TOUS les formats. UNE LISTE VIDE EST REFUSÉE : une règle qui ne s'appliquerait
    nulle part n'est pas « sans format », c'est une règle qui ne ferait jamais rien, sans que
    rien ne le dise. Seuls des formats BANCAIRES existants sont admis (les formats de
    compte-titres n'ont pas de règles de catégorisation). Doublons écartés, ordre gardé."""
    if presets is None:
        return None
    if not presets:
        raise HTTPException(
            status_code=400,
            detail="Choisis au moins un format d'import, ou laisse la règle sur tous les formats.",
        )
    retenus = []
    for preset_id in presets:
        preset = crud.get_import_preset(db, preset_id)
        if preset is None or preset.domaine != DomaineImport.bancaire.value:
            raise HTTPException(status_code=404, detail="Format d'import introuvable")
        if preset_id not in retenus:
            retenus.append(preset_id)
    return retenus


def _verifier_colonnes_dummy(db: Session, payload) -> None:
    """Toute colonne dummy citée — détection et sorties — doit exister (migration 0079).

    Qu'un format la LISE n'est pas exigé : l'éditeur le dit sous la condition, et une colonne
    se déclare dans un format avant ou après la règle, dans l'ordre qu'on veut."""
    blocs = [payload.conditions] + [sortie.conditions for sortie in payload.sorties]
    for bloc in blocs:
        for groupe in bloc.groupes:
            for condition in groupe.conditions:
                identifiant = id_colonne_dummy_regle(condition.champ)
                if identifiant is not None and crud.get_colonne_dummy(db, identifiant) is None:
                    raise HTTPException(status_code=404, detail="Colonne dummy introuvable")


def _sortie_validee(db: Session, sortie) -> dict:
    """Une sortie conditionnelle, vérifiée et prête à ranger (migration 0072).

    MÊMES CONTRÔLES QUE LA RÈGLE, pour ce qu'elle renseigne : un type qui
    existe et qui peut se poser par règle, une catégorie et des comptes qui
    existent. Le code du type est recopié : l'évaluation ne consulte pas la
    base. Rien n'est neutralisé ici selon le type — la sortie peut ne changer
    que le compte en face et laisser le type à la règle ; c'est à l'import que
    chaque champ ne vaut que si le type finalement retenu l'admet.

    SAUF L'ÉQUIVALENCE DES VIREMENTS (migration 0090) : une sortie qui choisit la
    catégorie des virements internes pose le type virement (s'il est libre), et
    une sortie qui pose le type virement porte cette catégorie."""
    categorie_virements = crud.get_categorie_virements(db)
    type_virement = crud.get_type_operation_par_code(db, TypeOperation.virement.value)
    if sortie.categorie_id == categorie_virements.id:
        type_choisi = (
            crud.get_type_operation(db, sortie.type_id) if sortie.type_id is not None else None
        )
        if sortie.type_id is None or (
            type_choisi is not None
            and TypeOperation(type_choisi.code) in TYPES_AVEC_CATEGORIE_LIBRE
        ):
            sortie = sortie.model_copy(update={"type_id": type_virement.id})
    if sortie.type_id == type_virement.id:
        sortie = sortie.model_copy(update={"categorie_id": categorie_virements.id})
    type_code = None
    if sortie.type_id is not None:
        type_operation = crud.get_type_operation(db, sortie.type_id)
        if type_operation is None:
            raise HTTPException(status_code=404, detail="Type d'opération introuvable")
        if TypeOperation(type_operation.code) in TYPES_INTERNES:
            raise HTTPException(
                status_code=400,
                detail=f"Le type « {type_operation.nom} » ne peut pas être posé par une règle.",
            )
        type_code = type_operation.code
    if sortie.categorie_id is not None and crud.get_categorie(db, sortie.categorie_id) is None:
        raise HTTPException(status_code=404, detail="Catégorie introuvable")
    for compte_id in (sortie.compte_autre_id, sortie.compte_id):
        if compte_id is not None and crud.get_compte(db, compte_id) is None:
            raise HTTPException(status_code=404, detail="Compte introuvable")
    donnees = sortie.model_dump(mode="json")
    donnees["type_code"] = type_code
    donnees["nature_remplacement"] = (sortie.nature_remplacement or "").strip() or None
    donnees["notes"] = (sortie.notes or "").strip() or None
    return donnees



@router.get("", response_model=list[schemas.RegleCategorisationRead])
def list_regles(db: Session = Depends(get_db)):
    return crud.list_regles_categorisation(db)


@router.post("", response_model=schemas.RegleCategorisationRead, status_code=201)
def create_regle(payload: schemas.RegleCategorisationCreate, db: Session = Depends(get_db)):
    _verifier_colonnes_dummy(db, payload)
    type_id, categorie_id, decoupes, compte_autre_id = _valider_action(
        db,
        payload.type_id,
        payload.categorie_id,
        payload.compte_autre_id,
        payload.decoupes,
    )
    return crud.create_regle_categorisation(
        db,
        nom=payload.nom,
        description=payload.description,
        conditions=payload.conditions.model_dump(mode="json"),
        type_id=type_id,
        categorie_id=categorie_id,
        decoupes=decoupes,
        compte_autre_id=compte_autre_id,
        actif=payload.actif,
        arreter_apres=payload.arreter_apres,
        **_autres_actions(db, payload),
    )


# Déclaré avant /{regle_id} : sinon "reordonner" serait capturé comme un id.
@router.put("/reordonner")
def reordonner_regles(payload: schemas.ReordonnerRegles, db: Session = Depends(get_db)):
    crud.reordonner_regles_categorisation(db, payload.ids)
    return {"reordonnees": len(payload.ids)}


@router.get("/{regle_id}", response_model=schemas.RegleCategorisationRead)
def get_regle(regle_id: int, db: Session = Depends(get_db)):
    return _get_regle_ou_404(db, regle_id)


@router.put("/{regle_id}", response_model=schemas.RegleCategorisationRead)
def update_regle(
    regle_id: int, payload: schemas.RegleCategorisationUpdate, db: Session = Depends(get_db)
):
    regle = _get_regle_ou_404(db, regle_id)
    _verifier_colonnes_dummy(db, payload)
    type_id, categorie_id, decoupes, compte_autre_id = _valider_action(
        db,
        payload.type_id,
        payload.categorie_id,
        payload.compte_autre_id,
        payload.decoupes,
    )
    return crud.update_regle_categorisation(
        db,
        regle,
        nom=payload.nom,
        description=payload.description,
        conditions=payload.conditions.model_dump(mode="json"),
        type_id=type_id,
        categorie_id=categorie_id,
        decoupes=decoupes,
        compte_autre_id=compte_autre_id,
        actif=payload.actif,
        arreter_apres=payload.arreter_apres,
        **_autres_actions(db, payload),
    )


@router.delete("/{regle_id}")
def delete_regle(regle_id: int, db: Session = Depends(get_db)):
    regle = _get_regle_ou_404(db, regle_id)
    crud.delete_regle_categorisation(db, regle)
    return {"supprime": True}
