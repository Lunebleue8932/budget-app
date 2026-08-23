import calendar
import uuid
from datetime import date as date_type, datetime, timedelta
from typing import Optional

from sqlalchemy import and_, func, or_
from sqlalchemy.orm import Session

from . import models, schemas
from .constants import (
    CATEGORIES_SENS_ENTREE,
    CATEGORIE_AUTRES,
    COLONNES_IMPORT_PAR_DEFAUT,
    MONNAIE_INITIALE_NOM,
    MONNAIE_INITIALE_SYMBOLE,
    NOMS_TYPES_INITIAUX,
    ORDRE_TYPES,
    TYPES_INTERNES,
    TYPES_REGLEMENT,
    TYPES_REMBOURSABLES,
    TYPES_SENS_ENTREE,
    Frequence,
    ModeComparaison,
    Sens,
    SensAction,
    Statut,
    TypeOperation,
)


# ---------- Monnaies ----------
#
# Aucun taux de change n'est stocké nulle part : l'app ne convertit jamais, elle
# calcule tout séparément par monnaie (cf. services/soldes.py).


def get_monnaies(db: Session) -> list[models.Monnaie]:
    return db.query(models.Monnaie).order_by(models.Monnaie.ordre, models.Monnaie.id).all()


def get_monnaie(db: Session, monnaie_id: int) -> Optional[models.Monnaie]:
    return db.query(models.Monnaie).filter(models.Monnaie.id == monnaie_id).first()


def get_monnaie_by_nom(db: Session, nom: str) -> Optional[models.Monnaie]:
    return db.query(models.Monnaie).filter(models.Monnaie.nom == nom).first()


def create_monnaie(db: Session, nom: str, symbole: str) -> models.Monnaie:
    ordre_max = db.query(func.max(models.Monnaie.ordre)).scalar()
    monnaie = models.Monnaie(
        nom=nom, symbole=symbole, ordre=(ordre_max + 1) if ordre_max is not None else 0
    )
    db.add(monnaie)
    db.commit()
    db.refresh(monnaie)
    return monnaie


def update_monnaie(
    db: Session,
    monnaie: models.Monnaie,
    *,
    nom: Optional[str] = None,
    symbole: Optional[str] = None,
) -> models.Monnaie:
    if nom is not None:
        monnaie.nom = nom
    if symbole is not None:
        monnaie.symbole = symbole
    db.commit()
    db.refresh(monnaie)
    return monnaie


def monnaie_est_utilisee(db: Session, monnaie_id: int) -> bool:
    """Une monnaie encore portée par un compte, une opération, un budget ou un
    titre ne peut pas être supprimée : les montants concernés deviendraient
    illisibles."""
    for modele in (
        models.CompteMonnaie,
        models.Operation,
        models.CategorieBudgetMensuel,
        models.Action,
    ):
        if db.query(modele).filter(modele.monnaie_id == monnaie_id).first() is not None:
            return True
    return False


def delete_monnaie(db: Session, monnaie: models.Monnaie) -> None:
    db.delete(monnaie)
    db.commit()


def seed_monnaie_initiale(db: Session) -> models.Monnaie:
    """Crée l'euro si la base n'a aucune monnaie (bases créées hors migration :
    tests, nouvelle base de dev). Idempotent."""
    existante = get_monnaies(db)
    if existante:
        return existante[0]
    return create_monnaie(db, MONNAIE_INITIALE_NOM, MONNAIE_INITIALE_SYMBOLE)


def get_categories(db: Session):
    return db.query(models.Categorie).order_by(models.Categorie.ordre).all()


def get_categorie(db: Session, categorie_id: int):
    return db.query(models.Categorie).filter(models.Categorie.id == categorie_id).first()


def get_categorie_by_nom(db: Session, nom: str):
    return db.query(models.Categorie).filter(models.Categorie.nom == nom).first()


def _prochain_couleur_index(db: Session) -> int:
    """Le plus petit index de palette que personne n'occupe.

    Pas `max + 1` : sans cela, créer et supprimer des catégories à répétition
    ferait grimper l'index indéfiniment, et deux catégories finiraient par se
    retrouver de la même couleur alors que la palette avait de la place. Le plus
    petit index libre garantit qu'une couleur n'est reprise QUE si celle qui la
    portait a disparu — la règle que cette colonne existe pour tenir."""
    pris = {index for (index,) in db.query(models.Categorie.couleur_index).all()}
    index = 0
    while index in pris:
        index += 1
    return index


def create_categorie(db: Session, categorie: schemas.CategorieCreate) -> models.Categorie:
    ordre_max = db.query(func.max(models.Categorie.ordre)).scalar() or 0
    db_categorie = models.Categorie(
        nom=categorie.nom,
        ordre=ordre_max + 1,
        couleur_index=_prochain_couleur_index(db),
    )
    db.add(db_categorie)
    db.commit()
    db.refresh(db_categorie)
    return db_categorie


def set_visibilite_dashboard_categorie(
    db: Session, db_categorie: models.Categorie, visible: bool
) -> models.Categorie:
    db_categorie.visible_dashboard = visible
    db.commit()
    db.refresh(db_categorie)
    return db_categorie


def get_budgets_explicites_categorie(db: Session, categorie_id: int, monnaie_id: int):
    return (
        db.query(models.CategorieBudgetMensuel)
        .filter(
            models.CategorieBudgetMensuel.categorie_id == categorie_id,
            models.CategorieBudgetMensuel.monnaie_id == monnaie_id,
        )
        .order_by(models.CategorieBudgetMensuel.annee, models.CategorieBudgetMensuel.mois)
        .all()
    )


def get_budget_categorie(
    db: Session, categorie_id: int, annee: int, mois: int, monnaie_id: int
) -> float:
    """Budget résolu pour (annee, mois) DANS une monnaie : la dernière entrée
    explicite à cette date ou avant (héritage en cascade), sinon 0.0.

    L'héritage ne traverse jamais les monnaies : un budget en dollars n'hérite
    que d'un mois précédent lui aussi en dollars."""
    entree = (
        db.query(models.CategorieBudgetMensuel)
        .filter(
            models.CategorieBudgetMensuel.categorie_id == categorie_id,
            models.CategorieBudgetMensuel.monnaie_id == monnaie_id,
            or_(
                models.CategorieBudgetMensuel.annee < annee,
                and_(
                    models.CategorieBudgetMensuel.annee == annee,
                    models.CategorieBudgetMensuel.mois <= mois,
                ),
            ),
        )
        .order_by(
            models.CategorieBudgetMensuel.annee.desc(),
            models.CategorieBudgetMensuel.mois.desc(),
        )
        .first()
    )
    return entree.montant if entree else 0.0


def budget_categorie_est_explicite(
    db: Session, categorie_id: int, annee: int, mois: int, monnaie_id: int
) -> bool:
    return (
        db.query(models.CategorieBudgetMensuel)
        .filter(
            models.CategorieBudgetMensuel.categorie_id == categorie_id,
            models.CategorieBudgetMensuel.monnaie_id == monnaie_id,
            models.CategorieBudgetMensuel.annee == annee,
            models.CategorieBudgetMensuel.mois == mois,
        )
        .first()
        is not None
    )


def set_budget_categorie(
    db: Session, categorie_id: int, annee: int, mois: int, monnaie_id: int, montant: float
) -> None:
    entree = (
        db.query(models.CategorieBudgetMensuel)
        .filter(
            models.CategorieBudgetMensuel.categorie_id == categorie_id,
            models.CategorieBudgetMensuel.monnaie_id == monnaie_id,
            models.CategorieBudgetMensuel.annee == annee,
            models.CategorieBudgetMensuel.mois == mois,
        )
        .first()
    )
    if entree:
        entree.montant = montant
    else:
        db.add(
            models.CategorieBudgetMensuel(
                categorie_id=categorie_id,
                monnaie_id=monnaie_id,
                annee=annee,
                mois=mois,
                montant=montant,
            )
        )
    db.commit()


def reordonner_categories(db: Session, ids_ordonnes: list[int]) -> None:
    """Applique un nouvel ordre d'affichage (glisser-déposer) aux catégories
    listées, dans l'ordre donné. Les ids omis gardent leur ordre actuel."""
    for position, categorie_id in enumerate(ids_ordonnes):
        db.query(models.Categorie).filter(models.Categorie.id == categorie_id).update(
            {"ordre": position}
        )
    db.commit()


def migrer_operations_vers_autres(db: Session, categorie_a_supprimer: models.Categorie) -> None:
    categorie_autres = get_categorie_by_nom(db, CATEGORIE_AUTRES)
    db.query(models.Operation).filter(
        models.Operation.categorie_id == categorie_a_supprimer.id
    ).update({"categorie_id": categorie_autres.id})
    db.commit()


def delete_categorie(db: Session, db_categorie: models.Categorie) -> None:
    db.delete(db_categorie)
    db.commit()


def _sens_pour_type(code: str, categorie_nom: Optional[str]) -> Sens:
    """Le type prime : un remboursement reçu et un prêt reçu sont des entrées
    quelle que soit la catégorie (ils n'en ont d'ailleurs plus). Pour les deux
    types à catégorie libre, le sens reste dérivé de la catégorie.

    Les virements ne passent pas par ici : leur sens (transfert_sortant ou
    transfert_entrant) est imposé à la création, le type seul ne permettant pas
    de trancher entre les deux.

    D'où le refus explicite plus bas plutôt qu'un `return Sens.depense` par
    défaut : sans lui, un virement dont personne n'aurait imposé le sens serait
    compté comme une dépense, faussant à la fois le solde du compte et la
    variation de la période — une erreur muette, que rien à l'écran ne
    distinguerait d'une vraie dépense.
    """
    if TypeOperation(code) == TypeOperation.virement:
        raise ValueError(
            "Le sens d'un virement interne ne se déduit pas de son type : il doit "
            "être imposé (transfert_sortant ou transfert_entrant) par l'appelant."
        )
    if TypeOperation(code) in TYPES_SENS_ENTREE:
        return Sens.entree
    if categorie_nom is not None and categorie_nom in CATEGORIES_SENS_ENTREE:
        return Sens.entree
    return Sens.depense


def get_types_operation(db: Session) -> list[models.TypeOperationDB]:
    return db.query(models.TypeOperationDB).order_by(models.TypeOperationDB.ordre).all()


def get_type_operation(db: Session, type_id: int) -> Optional[models.TypeOperationDB]:
    return (
        db.query(models.TypeOperationDB).filter(models.TypeOperationDB.id == type_id).first()
    )


def get_type_operation_par_code(db: Session, code: str) -> Optional[models.TypeOperationDB]:
    return (
        db.query(models.TypeOperationDB).filter(models.TypeOperationDB.code == code).first()
    )


def id_type_par_code(db: Session) -> dict:
    """Résolution code -> id, chargée une fois par requête plutôt qu'à chaque ligne."""
    return {t.code: t.id for t in db.query(models.TypeOperationDB).all()}


def seed_types_operation(db: Session) -> None:
    """Crée les types manquants (bases créées hors migration : tests, nouvelle
    base de dev). Idempotent."""
    for ordre, type_operation in enumerate(ORDRE_TYPES):
        if get_type_operation_par_code(db, type_operation.value) is None:
            db.add(
                models.TypeOperationDB(
                    code=type_operation.value,
                    nom=NOMS_TYPES_INITIAUX[type_operation],
                    ordre=ordre,
                    interne=type_operation in TYPES_INTERNES,
                )
            )
    db.commit()


def renommer_type_operation(
    db: Session, type_operation: models.TypeOperationDB, nom: str
) -> models.TypeOperationDB:
    type_operation.nom = nom
    db.commit()
    db.refresh(type_operation)
    return type_operation


def get_types_compte(db: Session):
    return db.query(models.TypeCompte).order_by(models.TypeCompte.systeme.desc(), models.TypeCompte.nom).all()


def get_type_compte(db: Session, type_compte_id: int):
    return db.query(models.TypeCompte).filter(models.TypeCompte.id == type_compte_id).first()


def get_type_compte_by_nom(db: Session, nom: str):
    return db.query(models.TypeCompte).filter(models.TypeCompte.nom == nom).first()


def create_type_compte(db: Session, type_compte: schemas.TypeCompteCreate) -> models.TypeCompte:
    db_type_compte = models.TypeCompte(nom=type_compte.nom, systeme=False)
    db.add(db_type_compte)
    db.commit()
    db.refresh(db_type_compte)
    return db_type_compte


def type_compte_est_utilise(db: Session, type_compte_id: int) -> bool:
    return (
        db.query(models.Compte).filter(models.Compte.type_id == type_compte_id).first()
        is not None
    )


def delete_type_compte(db: Session, db_type_compte: models.TypeCompte) -> None:
    db.delete(db_type_compte)
    db.commit()


def get_comptes(db: Session):
    """Dans l'ordre choisi par l'utilisateur (cf. models.Compte.ordre), le nom
    départageant deux comptes de même position. Cet ordre vaut au sein d'un
    type : partout où les comptes s'affichent, ils sont groupés par type."""
    return db.query(models.Compte).order_by(models.Compte.ordre, models.Compte.nom).all()


def reordonner_comptes(db: Session, ids_ordonnes: list[int]) -> None:
    """Applique le nouvel ordre d'affichage issu d'un glisser-déposer. La liste
    reçue est celle d'UN type (le geste ne réordonne que la carte survolée) :
    les comptes des autres types gardent leur position, sans conséquence
    puisque l'ordre ne se lit qu'à l'intérieur d'un type."""
    for position, compte_id in enumerate(ids_ordonnes):
        db.query(models.Compte).filter(models.Compte.id == compte_id).update(
            {"ordre": position}
        )
    db.commit()


def ordre_suivant_dans_type(db: Session, type_id: int) -> int:
    """Position d'un compte qui arrive dans un type : à la fin, pour qu'une
    création ou un changement de type ne bouscule pas l'ordre en place."""
    ordre_max = (
        db.query(func.max(models.Compte.ordre))
        .filter(models.Compte.type_id == type_id)
        .scalar()
    )
    return (ordre_max + 1) if ordre_max is not None else 0


def get_compte(db: Session, compte_id: int):
    return db.query(models.Compte).filter(models.Compte.id == compte_id).first()


def get_compte_by_nom(db: Session, nom: str):
    return db.query(models.Compte).filter(models.Compte.nom == nom).first()


def _appliquer_monnaies_compte(
    db_compte: models.Compte, monnaies: list[schemas.CompteMonnaieInput]
) -> None:
    """Remplace la liste des monnaies du compte. L'ordre reçu fait foi : la
    première est celle proposée par défaut à la saisie. Les lignes existantes
    sont réutilisées quand la monnaie est conservée, pour ne pas perdre leur id
    (et donc leur solde initial) sur un simple réordonnancement."""
    existantes = {lien.monnaie_id: lien for lien in db_compte.monnaies}
    nouvelles = []
    for position, entree in enumerate(monnaies):
        lien = existantes.get(entree.monnaie_id)
        if lien is None:
            lien = models.CompteMonnaie(monnaie_id=entree.monnaie_id)
        lien.solde_initial = entree.solde_initial
        lien.ordre = position
        nouvelles.append(lien)
    # delete-orphan sur la relation : les lignes absentes de la nouvelle liste
    # sont supprimées au flush.
    db_compte.monnaies = nouvelles


def create_compte(db: Session, compte: schemas.CompteCreate) -> models.Compte:
    db_compte = models.Compte(
        nom=compte.nom,
        type_id=compte.type_id,
        ordre=ordre_suivant_dans_type(db, compte.type_id),
    )
    _appliquer_monnaies_compte(db_compte, compte.monnaies)
    db.add(db_compte)
    db.commit()
    db.refresh(db_compte)
    return db_compte


def update_compte(
    db: Session, db_compte: models.Compte, updates: schemas.CompteUpdate
) -> models.Compte:
    data = updates.model_dump(exclude_unset=True)
    monnaies = data.pop("monnaies", None)
    # Changer de type, c'est arriver dans une autre liste : le compte s'y range
    # en dernier plutôt que de garder une position qui appartenait à l'ancien
    # type (deux comptes se retrouveraient sinon à la même place). Le
    # glisser-déposer précise ensuite la position exacte voulue, via
    # /comptes/reordonner.
    nouveau_type = data.get("type_id")
    if nouveau_type is not None and nouveau_type != db_compte.type_id:
        db_compte.ordre = ordre_suivant_dans_type(db, nouveau_type)
    for field, value in data.items():
        setattr(db_compte, field, value)
    if monnaies is not None:
        _appliquer_monnaies_compte(
            db_compte, [schemas.CompteMonnaieInput(**item) for item in monnaies]
        )
    db.commit()
    db.refresh(db_compte)
    return db_compte


def compte_monnaies_utilisees(db: Session, compte_id: int) -> set:
    """Monnaies dans lesquelles ce compte porte déjà au moins une opération :
    les retirer de sa liste rendrait ces montants orphelins."""
    rows = (
        db.query(models.Operation.monnaie_id)
        .filter(models.Operation.compte_id == compte_id)
        .distinct()
        .all()
    )
    return {row[0] for row in rows}


def delete_compte(db: Session, db_compte: models.Compte) -> None:
    db.delete(db_compte)
    db.commit()


def get_operations(
    db: Session,
    compte_id: Optional[int] = None,
    categorie_id: Optional[int] = None,
    statut: Optional[str] = None,
    date_debut: Optional[date_type] = None,
    date_fin: Optional[date_type] = None,
):
    query = db.query(models.Operation)
    if compte_id is not None:
        query = query.filter(models.Operation.compte_id == compte_id)
    if categorie_id is not None:
        query = query.filter(models.Operation.categorie_id == categorie_id)
    if statut is not None:
        query = query.filter(models.Operation.statut == statut)
    if date_debut is not None:
        query = query.filter(models.Operation.date >= date_debut)
    if date_fin is not None:
        query = query.filter(models.Operation.date <= date_fin)
    return query.order_by(models.Operation.date.desc(), models.Operation.id.desc()).all()


def get_operation(db: Session, operation_id: int):
    return db.query(models.Operation).filter(models.Operation.id == operation_id).first()


def _resoudre_montants_remboursement(
    remboursable: bool,
    montant: float,
    montant_du: Optional[float],
    montant_a_rembourser: Optional[float],
) -> tuple[float, float]:
    if not remboursable:
        return 0.0, 0.0
    montant_du_resolu = montant if montant_du is None else montant_du
    montant_a_rembourser_resolu = (
        montant_du_resolu if montant_a_rembourser is None else montant_a_rembourser
    )
    return montant_du_resolu, montant_a_rembourser_resolu


def _normaliser_amortissement(db_operation: models.Operation) -> None:
    """Remet les bornes d'amortissement dans leur seule forme valide : effacées
    si la case est décochée, calées sur le 1er du mois sinon.

    Sur la création, schemas.OperationBase s'en charge ; une modification, elle,
    n'est qu'un fragment (OperationUpdate) et ne peut rien valider de l'état
    final. Décocher « amortie » sans effacer les bornes laisserait des dates
    qu'aucun calcul ne lit plus mais que le formulaire réafficherait à la
    prochaine ouverture."""
    if not db_operation.amorti:
        db_operation.amortissement_debut = None
        db_operation.amortissement_fin = None
        return
    if db_operation.amortissement_debut is not None:
        db_operation.amortissement_debut = db_operation.amortissement_debut.replace(day=1)
    if db_operation.amortissement_fin is not None:
        db_operation.amortissement_fin = db_operation.amortissement_fin.replace(day=1)


def _normaliser_categorie_selon_type(db: Session, type_code: str, categorie_id):
    """Une catégorie n'a de sens que pour les deux types qui l'admettent ; pour
    les autres, le type EST la classification. Renvoie (categorie_id, nom)."""
    from .constants import TYPES_AVEC_CATEGORIE_LIBRE

    if TypeOperation(type_code) not in TYPES_AVEC_CATEGORIE_LIBRE:
        return None, None
    categorie = get_categorie(db, categorie_id) if categorie_id is not None else None
    return (categorie.id if categorie else None), (categorie.nom if categorie else None)


def create_operation(db: Session, operation: schemas.OperationCreate) -> models.Operation:
    type_operation = get_type_operation(db, operation.type_id)
    code = type_operation.code
    data = operation.model_dump(exclude={"operations_remboursees"})

    data["categorie_id"], nom_categorie = _normaliser_categorie_selon_type(
        db, code, data.get("categorie_id")
    )
    data["sens"] = _sens_pour_type(code, nom_categorie)

    # `remboursable` n'est plus une colonne : il découle du type (dépense
    # remboursable et prêt reçu, exactement les deux cas historiques).
    remboursable = TypeOperation(code) in TYPES_REMBOURSABLES
    data["montant_du"], data["montant_a_rembourser"] = _resoudre_montants_remboursement(
        remboursable, data["montant"], data["montant_du"], data["montant_a_rembourser"]
    )
    if TypeOperation(code) == TypeOperation.pret:
        # Le montant à rembourser d'un prêt est toujours égal au montant prêté,
        # jamais un montant partiel choisi manuellement (contrairement aux
        # dépenses remboursables, qui peuvent couvrir une facture partagée).
        data["montant_du"] = data["montant"]
        data["montant_a_rembourser"] = data["montant"]

    db_operation = models.Operation(**data)
    db.add(db_operation)
    db.commit()
    db.refresh(db_operation)

    if TypeOperation(code) in TYPES_REGLEMENT and operation.operations_remboursees:
        montants = {item.operation_id: item.montant for item in operation.operations_remboursees}
        set_operations_remboursees(db, db_operation, montants)
        db.refresh(db_operation)

    return db_operation


def update_operation(
    db: Session, db_operation: models.Operation, updates: schemas.OperationUpdate
) -> models.Operation:
    etait_remboursable = db_operation.remboursable
    # Changer de type peut rendre caducs les liens de remboursement déjà posés
    # — état capturé ici, avant mutation, pour les nettoyer plus bas.
    etait_reglement = TypeOperation(db_operation.type_code) in TYPES_REGLEMENT
    etait_virement = TypeOperation(db_operation.type_code) == TypeOperation.virement
    # Un modèle de récurrence (pas une occurrence générée) qui redevient
    # ponctuel doit nettoyer ses occurrences futures (cf. _arreter_recurrence,
    # appelé plus bas une fois le nouvel état de `recurrente` connu).
    etait_modele_recurrent = db_operation.recurrente and db_operation.recurrence_parent_id is None
    data = updates.model_dump(exclude_unset=True, exclude={"operations_remboursees"})
    montant_du_fourni = "montant_du" in data
    montant_a_rembourser_fourni = "montant_a_rembourser" in data
    for field, value in data.items():
        setattr(db_operation, field, value)

    _normaliser_amortissement(db_operation)

    # Le type est relu par son id plutôt que via la relation : celle-ci reste
    # en cache après un simple setattr sur `type_id`, et renverrait l'ancien
    # code.
    code = get_type_operation(db, db_operation.type_id).code
    db_operation.categorie_id, nom_categorie = _normaliser_categorie_selon_type(
        db, code, db_operation.categorie_id
    )

    # Un virement conserve son sens (transfert_sortant / transfert_entrant) :
    # le recalculer le ramènerait à "dépense" et fausserait le solde du compte.
    if not (etait_virement and TypeOperation(code) == TypeOperation.virement):
        db_operation.sens = _sens_pour_type(code, nom_categorie)

    est_remboursable = TypeOperation(code) in TYPES_REMBOURSABLES
    if not est_remboursable:
        db_operation.montant_du = 0.0
        db_operation.montant_a_rembourser = 0.0
    elif not etait_remboursable:
        # Vient de devenir remboursable : montants par défaut si non précisés.
        if not montant_du_fourni:
            db_operation.montant_du = db_operation.montant
        if not montant_a_rembourser_fourni:
            db_operation.montant_a_rembourser = db_operation.montant_du

    if TypeOperation(code) == TypeOperation.pret:
        # Toujours aligné sur le montant du prêt, jamais un montant partiel.
        db_operation.montant_du = db_operation.montant
        if db_operation.montant_a_rembourser > db_operation.montant_du:
            db_operation.montant_a_rembourser = db_operation.montant_du

    depenses_a_recalculer = _nettoyer_liens_devenus_caducs(
        db,
        db_operation,
        code_actuel=code,
        etait_reglement=etait_reglement,
        etait_remboursable=etait_remboursable,
        est_remboursable=est_remboursable,
    )

    db.commit()
    db.refresh(db_operation)

    for depense_id in depenses_a_recalculer:
        _recalculer_montant_a_rembourser(db, depense_id)

    if updates.operations_remboursees is not None:
        montants = {item.operation_id: item.montant for item in updates.operations_remboursees}
        set_operations_remboursees(db, db_operation, montants)
        db.refresh(db_operation)

    if etait_modele_recurrent and not db_operation.recurrente:
        _arreter_recurrence(db, db_operation)

    return db_operation


def _nettoyer_liens_devenus_caducs(
    db: Session,
    db_operation: models.Operation,
    *,
    code_actuel: str,
    etait_reglement: bool,
    etait_remboursable: bool,
    est_remboursable: bool,
) -> list[int]:
    """Supprime les RemboursementLien qu'un changement de type rend absurdes,
    et renvoie les dépenses dont le reste dû doit être recalculé.

    Sans ce nettoyage, changer le type d'une opération laissait des liens
    pendants : un règlement repassé en dépense classique continuait de "régler"
    des dettes, et une dette repassée en non-remboursable (montants remis à 0)
    restait la cible de remboursements qui ne correspondaient plus à rien.

    Les liens ne sont supprimés que dans le sens devenu invalide : une
    opération peut légitimement être à la fois dette et règlement d'une autre.
    """
    depenses_a_recalculer: list[int] = []

    # N'est plus un règlement : ses liens sortants (ce qu'elle remboursait)
    # n'ont plus lieu d'être, et les dettes visées redeviennent dues.
    if etait_reglement and TypeOperation(code_actuel) not in TYPES_REGLEMENT:
        depenses_a_recalculer = [
            row[0]
            for row in db.query(models.RemboursementLien.operation_depense_id)
            .filter(models.RemboursementLien.operation_remboursement_id == db_operation.id)
            .all()
        ]
        db.query(models.RemboursementLien).filter(
            models.RemboursementLien.operation_remboursement_id == db_operation.id
        ).delete(synchronize_session=False)

    # N'est plus une dette : ses montants viennent d'être remis à 0 plus haut,
    # les remboursements qui la visaient n'ont plus de cible.
    if etait_remboursable and not est_remboursable:
        db.query(models.RemboursementLien).filter(
            models.RemboursementLien.operation_depense_id == db_operation.id
        ).delete(synchronize_session=False)

    return depenses_a_recalculer


# ---------- Récurrence ----------
#
# Une opération récurrente est un modèle normal (recurrente=True,
# recurrence_parent_id=None) dont on génère paresseusement les occurrences
# futures (elles-mêmes recurrente=True, recurrence_parent_id=<id du modèle>)
# à chaque lecture des opérations (liste, dashboard) -- voir
# generer_occurrences_recurrentes, appelée depuis les routers concernés.


def _ajouter_mois(d: date_type, n: int) -> date_type:
    """Ajoute n mois à une date, en calant le jour sur le dernier jour du mois
    cible si besoin (ex. 31 janvier + 1 mois -> 28/29 février)."""
    mois_total = d.month - 1 + n
    annee = d.year + mois_total // 12
    mois = mois_total % 12 + 1
    dernier_jour = calendar.monthrange(annee, mois)[1]
    return date_type(annee, mois, min(d.day, dernier_jour))


def _prochaine_date_recurrence(d: date_type, frequence: Frequence) -> date_type:
    if frequence == Frequence.hebdomadaire:
        return d + timedelta(weeks=1)
    if frequence == Frequence.mensuelle:
        return _ajouter_mois(d, 1)
    if frequence == Frequence.trimestrielle:
        return _ajouter_mois(d, 3)
    return _ajouter_mois(d, 12)  # annuelle


# Horizon glissant au-delà duquel une récurrence infinie (recurrence_fin=None)
# n'est plus générée à l'avance -- reculé automatiquement à chaque appel
# puisque basé sur la date du jour, jamais persisté comme une vraie fin.
HORIZON_MOIS_RECURRENCE = 24


def generer_occurrences_recurrentes(db: Session) -> None:
    """Topping-up paresseux, appelé en tête de toute lecture d'opérations : crée
    les occurrences futures manquantes de chaque modèle récurrent, jusqu'à sa
    date de fin ou l'horizon glissant si infinie. Ne modifie jamais les
    occurrences déjà générées (montant/catégorie/compte y restent figés même
    si le modèle est modifié depuis)."""
    horizon = _ajouter_mois(date_type.today(), HORIZON_MOIS_RECURRENCE)
    modeles = (
        db.query(models.Operation)
        .filter(models.Operation.recurrente.is_(True), models.Operation.recurrence_parent_id.is_(None))
        .all()
    )
    a_commiter = False
    for modele in modeles:
        borne = min(modele.recurrence_fin, horizon) if modele.recurrence_fin else horizon
        dates_existantes = {
            enfant.date
            for enfant in db.query(models.Operation)
            .filter(models.Operation.recurrence_parent_id == modele.id)
            .all()
        }
        courante = _prochaine_date_recurrence(modele.date, modele.frequence)
        while courante <= borne:
            if courante not in dates_existantes:
                db.add(
                    models.Operation(
                        date=courante,
                        compte_id=modele.compte_id,
                        type_id=modele.type_id,
                        categorie_id=modele.categorie_id,
                        nature=modele.nature,
                        montant=modele.montant,
                        monnaie_id=modele.monnaie_id,
                        sens=modele.sens,
                        statut=Statut.previsionnel,
                        montant_du=modele.montant_du,
                        montant_a_rembourser=modele.montant_a_rembourser,
                        recurrente=True,
                        recurrence_parent_id=modele.id,
                    )
                )
                dates_existantes.add(courante)
                a_commiter = True
            courante = _prochaine_date_recurrence(courante, modele.frequence)
    if a_commiter:
        db.commit()


def _arreter_recurrence(db: Session, modele: models.Operation) -> None:
    """Un modèle qui redevient ponctuel (ou est supprimé) : ses occurrences
    futures pas encore survenues (prévisionnel) n'ont plus lieu d'être ;
    celles déjà survenues (réel) restent, détachées, des opérations
    indépendantes valides. Passe par delete_operation (pas un db.delete brut)
    pour bénéficier du même nettoyage des liens de remboursement qu'une
    suppression normale, au cas où une occurrence future remboursable aurait
    déjà été partiellement réglée."""
    enfants = (
        db.query(models.Operation).filter(models.Operation.recurrence_parent_id == modele.id).all()
    )
    for enfant in enfants:
        if enfant.statut == Statut.previsionnel:
            delete_operation(db, enfant)
        else:
            enfant.recurrence_parent_id = None
    db.commit()


def delete_operation(db: Session, db_operation: models.Operation) -> None:
    if db_operation.recurrente and db_operation.recurrence_parent_id is None:
        _arreter_recurrence(db, db_operation)

    depense_ids_a_recalculer = [
        row[0]
        for row in db.query(models.RemboursementLien.operation_depense_id)
        .filter(models.RemboursementLien.operation_remboursement_id == db_operation.id)
        .all()
    ]
    # Nettoyage explicite des liens : ne pas compter uniquement sur le ON DELETE
    # CASCADE de SQLite, qui exige PRAGMA foreign_keys=ON actif sur la connexion.
    db.query(models.RemboursementLien).filter(
        (models.RemboursementLien.operation_remboursement_id == db_operation.id)
        | (models.RemboursementLien.operation_depense_id == db_operation.id)
    ).delete(synchronize_session=False)
    # Idem pour la ligne brute d'import : la retirer du stock anti-doublons est
    # ce qui rend le relevé d'origine réimportable après suppression.
    db.query(models.LigneImportBrute).filter(
        models.LigneImportBrute.operation_id == db_operation.id
    ).delete(synchronize_session=False)
    # Idem pour le versant titres d'un achat/vente : les deux lignes ne
    # survivent jamais l'une sans l'autre.
    db.query(models.OperationAction).filter(
        models.OperationAction.operation_id == db_operation.id
    ).delete(synchronize_session=False)
    db.delete(db_operation)
    db.commit()
    for depense_id in depense_ids_a_recalculer:
        _recalculer_montant_a_rembourser(db, depense_id)


def delete_all_operations(db: Session) -> int:
    """Supprime toutes les opérations (et leurs liens de remboursement, et les
    lignes brutes d'import qui les référencent) — pensé pour vider rapidement
    des données de test, pas pour un usage courant."""
    nb = db.query(models.Operation).count()
    db.query(models.RemboursementLien).delete(synchronize_session=False)
    db.query(models.LigneImportBrute).filter(
        models.LigneImportBrute.operation_id.isnot(None)
    ).delete(synchronize_session=False)
    # Les mouvements de titres partent avec leur écriture d'espèces ; les
    # titres eux-mêmes (table `action`) restent, ils ne sont pas des opérations.
    db.query(models.OperationAction).delete(synchronize_session=False)
    db.query(models.Operation).delete(synchronize_session=False)
    db.commit()
    return nb


def get_operations_remboursees(db: Session, operation_remboursement_id: int) -> list[models.Operation]:
    ids = [
        row[0]
        for row in db.query(models.RemboursementLien.operation_depense_id)
        .filter(models.RemboursementLien.operation_remboursement_id == operation_remboursement_id)
        .all()
    ]
    if not ids:
        return []
    return db.query(models.Operation).filter(models.Operation.id.in_(ids)).all()


def get_remboursements_lies(db: Session, operation_depense_id: int) -> list[models.Operation]:
    ids = [
        row[0]
        for row in db.query(models.RemboursementLien.operation_remboursement_id)
        .filter(models.RemboursementLien.operation_depense_id == operation_depense_id)
        .all()
    ]
    if not ids:
        return []
    return db.query(models.Operation).filter(models.Operation.id.in_(ids)).all()


def get_operations_remboursees_detail(
    db: Session, operation_remboursement_id: int
) -> list[tuple[models.Operation, float]]:
    """Dépenses réglées par cette opération de remboursement, avec le montant
    réglé pour chacune (peut être inférieur au montant_du de la dépense si le
    remboursement est partiel)."""
    liens = (
        db.query(models.RemboursementLien)
        .filter(models.RemboursementLien.operation_remboursement_id == operation_remboursement_id)
        .all()
    )
    resultat = []
    for lien in liens:
        depense = get_operation(db, lien.operation_depense_id)
        if depense is not None:
            resultat.append((depense, lien.montant))
    return resultat


def get_remboursements_lies_detail(
    db: Session, operation_depense_id: int
) -> list[tuple[models.Operation, float]]:
    """Opérations de remboursement liées à cette dépense, avec le montant
    réglé par chacune pour CETTE dépense spécifiquement."""
    liens = (
        db.query(models.RemboursementLien)
        .filter(models.RemboursementLien.operation_depense_id == operation_depense_id)
        .all()
    )
    resultat = []
    for lien in liens:
        remboursement = get_operation(db, lien.operation_remboursement_id)
        if remboursement is not None:
            resultat.append((remboursement, lien.montant))
    return resultat


def set_operations_remboursees(
    db: Session, operation_remboursement: models.Operation, montants_par_depense: dict[int, float]
) -> None:
    anciens_liens = {
        lien.operation_depense_id: lien
        for lien in db.query(models.RemboursementLien)
        .filter(
            models.RemboursementLien.operation_remboursement_id == operation_remboursement.id
        )
        .all()
    }
    anciennes_ids = set(anciens_liens.keys())
    nouvelles_ids = set(montants_par_depense.keys())

    for depense_id in anciennes_ids - nouvelles_ids:
        db.delete(anciens_liens[depense_id])

    for depense_id, montant in montants_par_depense.items():
        if depense_id in anciens_liens:
            anciens_liens[depense_id].montant = montant
        else:
            db.add(
                models.RemboursementLien(
                    operation_remboursement_id=operation_remboursement.id,
                    operation_depense_id=depense_id,
                    montant=montant,
                )
            )

    db.commit()

    for depense_id in anciennes_ids | nouvelles_ids:
        _recalculer_montant_a_rembourser(db, depense_id)


def _recalculer_montant_a_rembourser(db: Session, operation_depense_id: int) -> None:
    depense = get_operation(db, operation_depense_id)
    if depense is None:
        return
    total_rembourse = (
        db.query(func.sum(models.RemboursementLien.montant))
        .filter(models.RemboursementLien.operation_depense_id == operation_depense_id)
        .scalar()
    ) or 0.0
    depense.montant_a_rembourser = max(0.0, depense.montant_du - total_rembourse)
    db.commit()


def _natures_virement(
    virement: schemas.VirementCreate,
    compte_source: models.Compte,
    compte_destination: models.Compte,
) -> tuple[str, str]:
    """Libellés par défaut des deux écritures (le libellé saisi, s'il existe,
    vaut pour les deux).

    Sur un même compte, « Virement vers CC Perso » depuis « CC Perso » ne
    voudrait rien dire : ce cas n'est possible qu'entre deux monnaies du compte
    (cf. VirementCreate), c'est donc une conversion de change qu'on nomme comme
    telle."""
    if virement.nature:
        return virement.nature, virement.nature
    if compte_source.id == compte_destination.id:
        libelle = f"Conversion sur {compte_source.nom}"
        return libelle, libelle
    return (
        f"Virement vers {compte_destination.nom}",
        f"Virement depuis {compte_source.nom}",
    )


def create_virement(
    db: Session,
    virement: schemas.VirementCreate,
    compte_source: models.Compte,
    compte_destination: models.Compte,
) -> tuple[models.Operation, models.Operation]:
    virement_id = str(uuid.uuid4())
    nature_sortante, nature_entrante = _natures_virement(
        virement, compte_source, compte_destination
    )
    type_virement = get_type_operation_par_code(db, TypeOperation.virement.value)

    # Les deux écritures portent chacune SA monnaie et SON montant : c'est ce
    # qui permet d'envoyer 100 € et d'en recevoir 108 $ sans qu'aucun taux de
    # change n'existe dans l'app. Quand les deux monnaies sont identiques, les
    # deux montants le sont aussi (cf. VirementCreate).
    op_sortante = models.Operation(
        date=virement.date,
        compte_id=compte_source.id,
        type_id=type_virement.id,
        categorie_id=None,
        nature=nature_sortante,
        montant=virement.montant,
        monnaie_id=virement.monnaie_id,
        sens=Sens.transfert_sortant,
        statut=virement.statut,
        montant_du=0.0,
        montant_a_rembourser=0.0,
        virement_id=virement_id,
        notes=virement.notes,
    )
    op_entrante = models.Operation(
        date=virement.date,
        compte_id=compte_destination.id,
        type_id=type_virement.id,
        categorie_id=None,
        nature=nature_entrante,
        montant=virement.montant_destination_resolu,
        monnaie_id=virement.monnaie_destination_resolue,
        sens=Sens.transfert_entrant,
        statut=virement.statut,
        montant_du=0.0,
        montant_a_rembourser=0.0,
        virement_id=virement_id,
        notes=virement.notes,
    )
    db.add(op_sortante)
    db.add(op_entrante)
    db.commit()
    db.refresh(op_sortante)
    db.refresh(op_entrante)
    return op_sortante, op_entrante


def update_virement(
    db: Session,
    operations: list[models.Operation],
    virement: schemas.VirementCreate,
    compte_source: models.Compte,
    compte_destination: models.Compte,
) -> tuple[models.Operation, models.Operation]:
    """Réécrit les deux écritures d'un virement existant, en place.

    Les deux lignes sont conservées (mêmes id, même virement_id) plutôt que
    supprimées et recréées : tout ce qui les référence — au premier chef la
    ligne brute d'import qui rend un relevé réimportable après suppression
    (cf. LigneImportBrute.operation_id, ON DELETE CASCADE) — survit ainsi à une
    simple correction de montant ou de date.

    Le sens de chaque écriture ne change jamais : c'est lui qui distingue la
    jambe sortante de l'entrante, et l'échanger reviendrait à inverser le
    virement plutôt qu'à le modifier.
    """
    sortante = next(o for o in operations if o.sens == Sens.transfert_sortant)
    entrante = next(o for o in operations if o.sens == Sens.transfert_entrant)
    nature_sortante, nature_entrante = _natures_virement(
        virement, compte_source, compte_destination
    )

    sortante.date = virement.date
    sortante.compte_id = compte_source.id
    sortante.montant = virement.montant
    sortante.monnaie_id = virement.monnaie_id
    sortante.statut = virement.statut
    sortante.nature = nature_sortante
    sortante.notes = virement.notes

    entrante.date = virement.date
    entrante.compte_id = compte_destination.id
    entrante.montant = virement.montant_destination_resolu
    entrante.monnaie_id = virement.monnaie_destination_resolue
    entrante.statut = virement.statut
    entrante.nature = nature_entrante
    entrante.notes = virement.notes

    db.commit()
    db.refresh(sortante)
    db.refresh(entrante)
    return sortante, entrante


def get_virement(db: Session, virement_id: str) -> list[models.Operation]:
    return (
        db.query(models.Operation)
        .filter(models.Operation.virement_id == virement_id)
        .all()
    )


def delete_virement(db: Session, operations: list[models.Operation]) -> None:
    for db_operation in operations:
        db.delete(db_operation)
    db.commit()


# ---------- Placements financiers ----------
#
# Un titre (models.Action) est global ; ce qui est détenu se lit par couple
# (compte, titre) en sommant les mouvements — voir services/placements.py.


def get_actions(db: Session) -> list[models.Action]:
    return db.query(models.Action).order_by(models.Action.nom).all()


def get_action(db: Session, action_id: int) -> Optional[models.Action]:
    return db.query(models.Action).filter(models.Action.id == action_id).first()


def get_action_by_nom(db: Session, nom: str) -> Optional[models.Action]:
    return db.query(models.Action).filter(models.Action.nom == nom).first()


def create_action(
    db: Session, nom: str, monnaie_id: int, valeur: float = 0.0
) -> models.Action:
    action = models.Action(nom=nom, valeur=valeur, monnaie_id=monnaie_id)
    db.add(action)
    db.commit()
    db.refresh(action)
    return action


def update_action(
    db: Session,
    action: models.Action,
    *,
    nom: Optional[str] = None,
    valeur: Optional[float] = None,
    monnaie_id: Optional[int] = None,
) -> models.Action:
    if nom is not None:
        action.nom = nom
    if valeur is not None:
        action.valeur = valeur
    if monnaie_id is not None:
        action.monnaie_id = monnaie_id
    db.commit()
    db.refresh(action)
    return action


def definir_url_cours(
    db: Session, action: models.Action, url: Optional[str]
) -> models.Action:
    """Enregistre (ou retire, avec `None`) la page d'où relire le cours du titre.

    Une fonction à part plutôt qu'un paramètre de plus sur `update_action` :
    celle-ci traite `None` comme « ne change pas », convention qui rendrait
    impossible d'EFFACER un lien. Ici `None` veut dire ce qu'il dit.

    `cours_maj_le` n'est pas touché : retirer un lien n'invalide pas le dernier
    cours lu, il cesse seulement d'être rafraîchi. Le remettre à NULL aurait
    fait passer une valeur connue pour une valeur jamais lue.
    """
    action.url_cours = url
    db.commit()
    db.refresh(action)
    return action


def enregistrer_cours_en_ligne(
    db: Session, action: models.Action, valeur: float, horodatage: datetime
) -> models.Action:
    """Écrit un cours relu en ligne, et date la lecture.

    Les deux ensemble, jamais l'un sans l'autre : un cours sans date ne dit pas
    s'il vaut encore quelque chose, et une date sans cours daterait une lecture
    qui n'a rien changé. L'horodatage est passé par l'appelant (et non pris
    ici) pour qu'un rafraîchissement de dix titres porte la MÊME date sur les
    dix — ce qui se lit comme la seule action qu'il a été.
    """
    action.valeur = valeur
    action.cours_maj_le = horodatage
    db.commit()
    db.refresh(action)
    return action


def action_est_utilisee(db: Session, action_id: int) -> bool:
    return (
        db.query(models.OperationAction)
        .filter(models.OperationAction.action_id == action_id)
        .first()
        is not None
    )


def delete_action(db: Session, action: models.Action) -> None:
    db.delete(action)
    db.commit()


def get_operation_action(db: Session, operation_action_id: int) -> Optional[models.OperationAction]:
    return (
        db.query(models.OperationAction)
        .filter(models.OperationAction.id == operation_action_id)
        .first()
    )


def create_operation_action(
    db: Session,
    *,
    compte_id: int,
    action: models.Action,
    sens: SensAction,
    quantite: float,
    prix_unitaire: float,
    date_operation: date_type,
    nature: Optional[str] = None,
) -> models.OperationAction:
    """Crée les deux lignes solidaires d'un mouvement de titres : l'écriture
    d'espèces (une Operation ordinaire de type `action`) et son versant titres.

    Le sens de l'écriture d'espèces est un transfert, pas une dépense/entrée :
    acheter des titres ne fait pas sortir l'argent du patrimoine, il le
    convertit — il ne doit donc pas peser sur la variation du mois ni sur les
    dépenses par catégorie, exactement comme un virement interne.

    Statut toujours "réel" : un ordre de bourse est passé ou ne l'est pas, il
    n'y a pas de mouvement de titres prévisionnel à saisir ici.

    La monnaie de l'écriture est celle de cotation du titre : le prix payé est
    libellé dans cette monnaie, donc les espèces bougent dans celle-là (le
    routeur vérifie que le compte la porte).
    """
    type_action = get_type_operation_par_code(db, TypeOperation.action.value)
    montant = quantite * prix_unitaire
    prefixe = "Achat" if sens == SensAction.achat else "Vente"
    db_operation = models.Operation(
        date=date_operation,
        compte_id=compte_id,
        type_id=type_action.id,
        categorie_id=None,
        nature=nature or f"{prefixe} {action.nom}",
        montant=montant,
        monnaie_id=action.monnaie_id,
        sens=Sens.transfert_sortant if sens == SensAction.achat else Sens.transfert_entrant,
        statut=Statut.reel,
        montant_du=0.0,
        montant_a_rembourser=0.0,
    )
    db.add(db_operation)
    db.flush()  # l'id de l'écriture d'espèces est nécessaire ci-dessous
    db_operation_action = models.OperationAction(
        operation_id=db_operation.id,
        action_id=action.id,
        sens=sens,
        quantite=quantite,
        prix_unitaire=prix_unitaire,
    )
    db.add(db_operation_action)
    db.commit()
    db.refresh(db_operation_action)
    return db_operation_action


def delete_operation_action(db: Session, operation_action: models.OperationAction) -> None:
    """Supprime le mouvement de titres ET son écriture d'espèces : laisser
    l'une sans l'autre fausserait soit le portefeuille, soit le solde."""
    operation = get_operation(db, operation_action.operation_id)
    db.delete(operation_action)
    if operation is not None:
        db.delete(operation)
    db.commit()


# ---------- Import bancaire ----------
#
# Tout ce qui suit est scopé par preset_id (voir models.ImportPreset) : un
# même nom bancaire, ou une même ligne brute, peut légitimement exister sous
# deux presets différents sans jamais se comparer ou s'écraser entre eux.


def list_import_presets(db: Session) -> list[models.ImportPreset]:
    return db.query(models.ImportPreset).order_by(models.ImportPreset.nom).all()


def get_import_preset(db: Session, preset_id: int) -> Optional[models.ImportPreset]:
    return db.query(models.ImportPreset).filter(models.ImportPreset.id == preset_id).first()


def create_import_preset(
    db: Session,
    nom: str,
    colonnes: Optional[list[dict]] = None,
    colonnes_comparaison: Optional[list[int]] = None,
    ignorer_premiere_ligne: bool = False,
    compte_id: Optional[int] = None,
    mode_comparaison: Optional[str] = None,
    libelles_sens_sortie: Optional[list[str]] = None,
    libelles_sens_entree: Optional[list[str]] = None,
    libelles_statut_execute: Optional[list[str]] = None,
    libelles_statut_attente: Optional[list[str]] = None,
    libelles_statut_refuse: Optional[list[str]] = None,
) -> models.ImportPreset:
    preset = models.ImportPreset(
        nom=nom,
        compte_id=compte_id,
        colonnes=colonnes if colonnes is not None else COLONNES_IMPORT_PAR_DEFAUT,
        colonnes_comparaison=colonnes_comparaison or [],
        mode_comparaison=mode_comparaison or ModeComparaison.exclusion.value,
        ignorer_premiere_ligne=ignorer_premiere_ligne,
        libelles_sens_sortie=libelles_sens_sortie or [],
        libelles_sens_entree=libelles_sens_entree or [],
        libelles_statut_execute=libelles_statut_execute or [],
        libelles_statut_attente=libelles_statut_attente or [],
        libelles_statut_refuse=libelles_statut_refuse or [],
    )
    db.add(preset)
    db.commit()
    db.refresh(preset)
    return preset


# None est une valeur légitime pour `compte_id` (délier le preset de son
# compte) : il ne peut donc pas signifier "ne pas y toucher" comme pour les
# autres champs, d'où ce marqueur d'absence.
_INCHANGE = object()


def update_import_preset(
    db: Session,
    preset: models.ImportPreset,
    *,
    nom: Optional[str] = None,
    colonnes: Optional[list[dict]] = None,
    colonnes_comparaison: Optional[list[int]] = None,
    mode_comparaison: Optional[str] = None,
    ignorer_premiere_ligne: Optional[bool] = None,
    compte_id=_INCHANGE,
    libelles_sens_sortie: Optional[list[str]] = None,
    libelles_sens_entree: Optional[list[str]] = None,
    libelles_statut_execute: Optional[list[str]] = None,
    libelles_statut_attente: Optional[list[str]] = None,
    libelles_statut_refuse: Optional[list[str]] = None,
) -> models.ImportPreset:
    if nom is not None:
        preset.nom = nom
    if compte_id is not _INCHANGE:
        preset.compte_id = compte_id
    if colonnes is not None:
        preset.colonnes = colonnes
    if colonnes_comparaison is not None:
        preset.colonnes_comparaison = colonnes_comparaison
    if mode_comparaison is not None:
        preset.mode_comparaison = mode_comparaison
    if ignorer_premiere_ligne is not None:
        preset.ignorer_premiere_ligne = ignorer_premiere_ligne
    if libelles_sens_sortie is not None:
        preset.libelles_sens_sortie = libelles_sens_sortie
    if libelles_sens_entree is not None:
        preset.libelles_sens_entree = libelles_sens_entree
    if libelles_statut_execute is not None:
        preset.libelles_statut_execute = libelles_statut_execute
    if libelles_statut_attente is not None:
        preset.libelles_statut_attente = libelles_statut_attente
    if libelles_statut_refuse is not None:
        preset.libelles_statut_refuse = libelles_statut_refuse
    db.commit()
    db.refresh(preset)
    return preset


def delete_import_preset(db: Session, preset: models.ImportPreset) -> None:
    db.delete(preset)
    db.commit()


def get_mapping_categorie(db: Session, preset_id: int, nom_banque: str) -> Optional[int]:
    """La catégorie mémorisée pour ce libellé bancaire, ou None s'il n'en a pas.

    Depuis 0022 une correspondance ne vise plus qu'une catégorie : le type est
    posé par les règles, évaluées avant (cf. services/import_bancaire)."""
    mapping = (
        db.query(models.ImportCategorieMapping)
        .filter(
            models.ImportCategorieMapping.preset_id == preset_id,
            models.ImportCategorieMapping.nom_banque == nom_banque,
        )
        .first()
    )
    return mapping.categorie_id if mapping else None


def set_mapping_categorie(
    db: Session, preset_id: int, nom_banque: str, categorie_id: int
) -> None:
    mapping = (
        db.query(models.ImportCategorieMapping)
        .filter(
            models.ImportCategorieMapping.preset_id == preset_id,
            models.ImportCategorieMapping.nom_banque == nom_banque,
        )
        .first()
    )
    if mapping:
        mapping.categorie_id = categorie_id
    else:
        db.add(
            models.ImportCategorieMapping(
                preset_id=preset_id, nom_banque=nom_banque, categorie_id=categorie_id
            )
        )
    db.commit()


def get_mapping_compte(db: Session, preset_id: int, nom_banque: str) -> Optional[int]:
    mapping = (
        db.query(models.ImportCompteMapping)
        .filter(
            models.ImportCompteMapping.preset_id == preset_id,
            models.ImportCompteMapping.nom_banque == nom_banque,
        )
        .first()
    )
    return mapping.compte_id if mapping else None


def set_mapping_compte(db: Session, preset_id: int, nom_banque: str, compte_id: int) -> None:
    mapping = (
        db.query(models.ImportCompteMapping)
        .filter(
            models.ImportCompteMapping.preset_id == preset_id,
            models.ImportCompteMapping.nom_banque == nom_banque,
        )
        .first()
    )
    if mapping:
        mapping.compte_id = compte_id
    else:
        db.add(models.ImportCompteMapping(preset_id=preset_id, nom_banque=nom_banque, compte_id=compte_id))
    db.commit()


def get_mapping_monnaie(db: Session, preset_id: int, nom_banque: str) -> Optional[int]:
    """La monnaie mémorisée pour ce libellé de devise du fichier (« EUR »), ou
    None. Seule source de rattachement d'une devise (cf. import_bancaire.
    _resoudre_monnaie) : rien n'est déduit d'un nom ou d'un symbole qui se
    ressemblent, c'est toujours un choix explicite de l'utilisateur."""
    mapping = (
        db.query(models.ImportMonnaieMapping)
        .filter(
            models.ImportMonnaieMapping.preset_id == preset_id,
            models.ImportMonnaieMapping.nom_banque == nom_banque,
        )
        .first()
    )
    return mapping.monnaie_id if mapping else None


def set_mapping_monnaie(db: Session, preset_id: int, nom_banque: str, monnaie_id: int) -> None:
    mapping = (
        db.query(models.ImportMonnaieMapping)
        .filter(
            models.ImportMonnaieMapping.preset_id == preset_id,
            models.ImportMonnaieMapping.nom_banque == nom_banque,
        )
        .first()
    )
    if mapping:
        mapping.monnaie_id = monnaie_id
    else:
        db.add(
            models.ImportMonnaieMapping(
                preset_id=preset_id, nom_banque=nom_banque, monnaie_id=monnaie_id
            )
        )
    db.commit()


def list_mappings_categorie(db: Session, preset_id: int) -> list[models.ImportCategorieMapping]:
    return (
        db.query(models.ImportCategorieMapping)
        .filter(models.ImportCategorieMapping.preset_id == preset_id)
        .order_by(models.ImportCategorieMapping.nom_banque)
        .all()
    )


def list_mappings_categorie_tous_presets(db: Session) -> list[tuple]:
    """(mapping, nom du compte lié au preset) pour TOUS les presets.

    La galerie des correspondances (page Règles) les montre côte à côte : c'est
    le classement lui-même qu'on y relit, et le couper par preset obligeait à
    changer de preset — depuis la page Import, qui porte le sélecteur — pour
    voir la moitié du travail. Le compte lié voyage avec chaque ligne : sans
    lui, deux banques qui exportent « Alimentation » donnent deux cartes
    indiscernables.

    Compte NULL pour un preset qui résout le compte depuis le fichier ; d'où le
    outerjoin, sans quoi ces correspondances disparaîtraient purement et
    simplement."""
    return (
        db.query(models.ImportCategorieMapping, models.Compte.nom)
        .join(
            models.ImportPreset,
            models.ImportPreset.id == models.ImportCategorieMapping.preset_id,
        )
        .outerjoin(models.Compte, models.Compte.id == models.ImportPreset.compte_id)
        .order_by(models.ImportCategorieMapping.nom_banque, models.ImportPreset.nom)
        .all()
    )


def list_mappings_compte(db: Session, preset_id: int) -> list[models.ImportCompteMapping]:
    return (
        db.query(models.ImportCompteMapping)
        .join(models.Compte)
        .filter(models.ImportCompteMapping.preset_id == preset_id)
        .order_by(models.ImportCompteMapping.nom_banque)
        .all()
    )


def list_mappings_compte_tous_presets(db: Session) -> list[models.ImportCompteMapping]:
    """Toutes les correspondances de compte, tous presets confondus.

    Contrairement aux catégories, aucune provenance n'accompagne le résultat :
    la page Règles les affiche en une seule liste commune, et le routeur y
    regroupe les entrées identiques (cf. get_mappings)."""
    return (
        db.query(models.ImportCompteMapping)
        .join(models.Compte)
        .order_by(models.ImportCompteMapping.nom_banque)
        .all()
    )


def list_mappings_monnaie(db: Session, preset_id: int) -> list[models.ImportMonnaieMapping]:
    return (
        db.query(models.ImportMonnaieMapping)
        .join(models.Monnaie)
        .filter(models.ImportMonnaieMapping.preset_id == preset_id)
        .order_by(models.ImportMonnaieMapping.nom_banque)
        .all()
    )


def list_mappings_monnaie_tous_presets(db: Session) -> list[models.ImportMonnaieMapping]:
    """Idem pour les devises : « EUR » se répète d'un preset à l'autre, c'est le
    routeur qui les fond en une entrée unique."""
    return (
        db.query(models.ImportMonnaieMapping)
        .join(models.Monnaie)
        .order_by(models.ImportMonnaieMapping.nom_banque)
        .all()
    )


def delete_mapping_monnaie(db: Session, preset_id: int, nom_banque: str) -> bool:
    mapping = (
        db.query(models.ImportMonnaieMapping)
        .filter(
            models.ImportMonnaieMapping.preset_id == preset_id,
            models.ImportMonnaieMapping.nom_banque == nom_banque,
        )
        .first()
    )
    if mapping is None:
        return False
    db.delete(mapping)
    db.commit()
    return True


def delete_mapping_categorie(db: Session, preset_id: int, nom_banque: str) -> bool:
    mapping = (
        db.query(models.ImportCategorieMapping)
        .filter(
            models.ImportCategorieMapping.preset_id == preset_id,
            models.ImportCategorieMapping.nom_banque == nom_banque,
        )
        .first()
    )
    if mapping is None:
        return False
    db.delete(mapping)
    db.commit()
    return True


def delete_mapping_compte(db: Session, preset_id: int, nom_banque: str) -> bool:
    mapping = (
        db.query(models.ImportCompteMapping)
        .filter(
            models.ImportCompteMapping.preset_id == preset_id,
            models.ImportCompteMapping.nom_banque == nom_banque,
        )
        .first()
    )
    if mapping is None:
        return False
    db.delete(mapping)
    db.commit()
    return True


def create_import_historique(
    db: Session,
    *,
    preset_id: int,
    nom_fichier: str,
    operations_creees: int,
    lignes_ignorees: int,
    doublons_detectes: int = 0,
) -> models.ImportHistorique:
    entree = models.ImportHistorique(
        preset_id=preset_id,
        date_import=datetime.now(),
        nom_fichier=nom_fichier or None,
        operations_creees=operations_creees,
        lignes_ignorees=lignes_ignorees,
        doublons_detectes=doublons_detectes,
    )
    db.add(entree)
    db.commit()
    db.refresh(entree)
    return entree


def get_import_historique(db: Session, preset_id: int) -> list[models.ImportHistorique]:
    return (
        db.query(models.ImportHistorique)
        .filter(models.ImportHistorique.preset_id == preset_id)
        .order_by(models.ImportHistorique.date_import.desc())
        .all()
    )


def list_lignes_import_brutes(db: Session, preset_id: int) -> list[models.LigneImportBrute]:
    """Stock de lignes déjà importées SOUS CE PRESET (format brut), pour
    comparaison lors d'un nouvel import (voir services.import_bancaire.
    detecter_doublon)."""
    return (
        db.query(models.LigneImportBrute)
        .filter(models.LigneImportBrute.preset_id == preset_id)
        .all()
    )


def create_ligne_import_brute(
    db: Session,
    *,
    preset_id: int,
    donnees: dict,
    import_historique_id: Optional[int] = None,
    operation_id: Optional[int] = None,
) -> models.LigneImportBrute:
    ligne = models.LigneImportBrute(
        preset_id=preset_id,
        donnees=donnees,
        import_historique_id=import_historique_id,
        operation_id=operation_id,
        date_creation=datetime.now(),
    )
    db.add(ligne)
    db.commit()
    db.refresh(ligne)
    return ligne


def create_operation_importee(
    db: Session,
    *,
    date_operation: date_type,
    compte_id: int,
    type_id: int,
    categorie_id: Optional[int],
    nature: str,
    montant: float,
    monnaie_id: int,
    montant_du: Optional[float] = None,
    sens: Optional[Sens] = None,
    statut: Statut = Statut.reel,
    notes: Optional[str] = None,
    amorti: bool = False,
    amortissement_debut: Optional[date_type] = None,
    amortissement_fin: Optional[date_type] = None,
) -> models.Operation:
    """Crée une opération issue d'un import bancaire : la vérification a déjà
    eu lieu ligne par ligne dans l'aperçu, avant confirmation (voir
    services/import_bancaire.confirmer). Le caractère remboursable découle du
    type (dépense remboursable et prêt reçu) ; les deux types de règlement ne
    passent en réalité jamais par cette fonction : la liaison à une
    dépense/prêt existant se fait via l'écran d'import une fois le reste
    confirmé, en créant directement l'opération via l'endpoint /operations
    habituel (seul capable de gérer operations_remboursees).

    `sens` permet à l'appelant d'imposer transfert_sortant/transfert_entrant
    pour un virement importé dont un seul compte est connu (le second compte
    absent empêche le vrai virement double-écriture, cf. confirmer()) : le type
    "Virement interne" ne dit pas à lui seul dans quel sens va l'argent, ce qui
    fausserait le solde du compte quand cette écriture est en réalité une
    entrée.

    `statut` vaut réel par défaut — une ligne de relevé décrit par nature une
    transaction déjà survenue. Il ne devient prévisionnel que pour les relevés
    qui listent aussi les autorisations en attente et le disent dans une colonne
    (cf. services/import_bancaire._statut_operation).

    `notes` et l'amortissement viennent du formulaire d'édition de l'aperçu :
    ils ne se lisent dans aucun relevé, mais c'est en classant la ligne qu'on
    sait qu'une dépense s'étale ou qu'elle mérite un mot — y revenir après
    l'import obligerait à retrouver l'opération une à une. Les bornes sont
    ramenées au 1er du mois comme partout ailleurs (cf.
    _normaliser_amortissement)."""
    type_operation = get_type_operation(db, type_id)
    categorie_id, nom_categorie = _normaliser_categorie_selon_type(
        db, type_operation.code, categorie_id
    )

    remboursable_finale = TypeOperation(type_operation.code) in TYPES_REMBOURSABLES
    if remboursable_finale:
        montant_du_final = montant_du if montant_du is not None else montant
        montant_du_final = max(0.0, min(montant_du_final, montant))
    else:
        montant_du_final = 0.0
    montant_a_rembourser = montant_du_final
    db_operation = models.Operation(
        date=date_operation,
        compte_id=compte_id,
        type_id=type_id,
        categorie_id=categorie_id,
        nature=nature,
        montant=montant,
        monnaie_id=monnaie_id,
        sens=sens if sens is not None else _sens_pour_type(type_operation.code, nom_categorie),
        statut=statut,
        montant_du=montant_du_final,
        montant_a_rembourser=montant_a_rembourser,
        notes=notes,
        amorti=amorti,
        amortissement_debut=amortissement_debut,
        amortissement_fin=amortissement_fin,
    )
    _normaliser_amortissement(db_operation)
    db.add(db_operation)
    db.commit()
    db.refresh(db_operation)
    return db_operation


# ---------- Règles de catégorisation ----------


def list_regles_categorisation(db: Session) -> list[models.RegleCategorisation]:
    """Triées comme elles sont évaluées : par ordre croissant, l'id
    départageant deux règles de même ordre (voir
    services.regles_categorisation.appliquer_regles)."""
    return (
        db.query(models.RegleCategorisation)
        .order_by(models.RegleCategorisation.ordre, models.RegleCategorisation.id)
        .all()
    )


def get_regle_categorisation(db: Session, regle_id: int) -> Optional[models.RegleCategorisation]:
    return (
        db.query(models.RegleCategorisation)
        .filter(models.RegleCategorisation.id == regle_id)
        .first()
    )


def create_regle_categorisation(
    db: Session,
    *,
    nom: str,
    conditions: dict,
    type_id: int,
    categorie_id: Optional[int] = None,
    compte_autre_id: Optional[int] = None,
    actif: bool = True,
    arreter_apres: bool = True,
    ordre: Optional[int] = None,
) -> models.RegleCategorisation:
    if ordre is None:
        # En bout de liste : une nouvelle règle ne doit jamais court-circuiter
        # silencieusement celles déjà en place.
        ordre_max = db.query(func.max(models.RegleCategorisation.ordre)).scalar()
        ordre = (ordre_max + 1) if ordre_max is not None else 0
    regle = models.RegleCategorisation(
        nom=nom,
        conditions=conditions,
        type_id=type_id,
        categorie_id=categorie_id,
        compte_autre_id=compte_autre_id,
        actif=actif,
        arreter_apres=arreter_apres,
        ordre=ordre,
    )
    db.add(regle)
    db.commit()
    db.refresh(regle)
    return regle


def update_regle_categorisation(
    db: Session, regle: models.RegleCategorisation, **champs
) -> models.RegleCategorisation:
    # `categorie_id` est légitimement remis à None (passage à un type dont la
    # catégorie est imposée) : on distingue "absent" de "None" via la présence
    # de la clé, d'où **champs plutôt que des paramètres optionnels.
    for nom_champ in (
        "nom",
        "conditions",
        "type_id",
        "categorie_id",
        "compte_autre_id",
        "actif",
        "arreter_apres",
        "ordre",
    ):
        if nom_champ in champs:
            setattr(regle, nom_champ, champs[nom_champ])
    db.commit()
    db.refresh(regle)
    return regle


def delete_regle_categorisation(db: Session, regle: models.RegleCategorisation) -> None:
    db.delete(regle)
    db.commit()


def reordonner_regles_categorisation(db: Session, ids_ordonnes: list[int]) -> None:
    """Réécrit `ordre` d'après la position dans la liste fournie."""
    for position, regle_id in enumerate(ids_ordonnes):
        regle = get_regle_categorisation(db, regle_id)
        if regle is not None:
            regle.ordre = position
    db.commit()


def get_date_dernier_import(db: Session, preset_id: int) -> Optional[datetime]:
    """Date du dernier import confirmé sous ce preset, ou None s'il n'a jamais
    servi (voir routers.import_bancaire.list_presets)."""
    return (
        db.query(func.max(models.ImportHistorique.date_import))
        .filter(models.ImportHistorique.preset_id == preset_id)
        .scalar()
    )


def get_import_historique_entree(
    db: Session, historique_id: int
) -> Optional[models.ImportHistorique]:
    return (
        db.query(models.ImportHistorique)
        .filter(models.ImportHistorique.id == historique_id)
        .first()
    )


def get_operations_d_un_import(
    db: Session, historique_id: int
) -> list[models.Operation]:
    """Les opérations encore en base que cet import a créées.

    LE STOCK ANTI-DOUBLONS EST LE SEUL REGISTRE de ce lien : chaque ligne
    importée y est entrée en portant à la fois l'import dont elle vient
    (`import_historique_id`) et l'opération qu'elle a créée (`operation_id`,
    ON DELETE CASCADE). Aucune colonne n'a donc été ajoutée à `operation` pour
    retrouver son import — l'information y était déjà.

    « Encore en base » n'est pas une précaution de style : le CASCADE fait
    qu'une opération supprimée à la main depuis l'import a emporté sa ligne du
    stock avec elle. Ce qui reste ici est donc exactement ce qui est encore
    annulable, et une opération déjà supprimée ne se compte pas deux fois.

    LES DEUX JAMBES D'UN VIREMENT. Le stock ne retient que la jambe sortante
    (cf. services/import_bancaire.confirmer) : la seconde est ramenée ici par
    `virement_id`, sans quoi annuler un import laisserait derrière lui une
    demi-écriture sur le compte d'en face."""
    operation_ids = [
        row[0]
        for row in db.query(models.LigneImportBrute.operation_id)
        .filter(
            models.LigneImportBrute.import_historique_id == historique_id,
            models.LigneImportBrute.operation_id.isnot(None),
        )
        .all()
    ]
    if not operation_ids:
        return []

    operations = (
        db.query(models.Operation).filter(models.Operation.id.in_(operation_ids)).all()
    )
    virement_ids = {op.virement_id for op in operations if op.virement_id is not None}
    if virement_ids:
        jambes = (
            db.query(models.Operation)
            .filter(models.Operation.virement_id.in_(virement_ids))
            .all()
        )
        connues = {op.id for op in operations}
        operations.extend(op for op in jambes if op.id not in connues)
    return operations


def compter_operations_annulables(db: Session, preset_id: int) -> dict[int, dict]:
    """historique_id -> {"annulables": n, "sans_lien": n}, pour tous les imports
    d'un preset d'un coup.

    En UNE requête plutôt qu'une par ligne d'historique : la page Import les
    affiche toutes ensemble, et vingt allers-retours pour vingt compteurs
    auraient coûté plus cher que l'affichage lui-même.

    « annulables » compte les LIGNES DE STOCK dont l'opération existe encore,
    pas les opérations elles-mêmes : les deux jambes d'un virement n'en
    occupent qu'une (cf. get_operations_d_un_import), le nombre annoncé est
    donc celui des lignes du relevé qui seront défaites — ce que l'utilisateur
    reconnaît, là où « 24 opérations » pour 12 virements ne lui dirait rien.

    « sans_lien » compte celles qui ne désignent AUCUNE opération, et sert
    uniquement à expliquer pourquoi un import n'est pas annulable. Deux
    situations n'ont rien à voir et se ressembleraient sans ce chiffre :
    l'import dont tout a déjà été supprimé à la main (plus aucune ligne du
    tout, le CASCADE les a emportées), et l'import ANTÉRIEUR à la migration
    0016, dont les lignes sont bien là mais n'ont jamais porté ce lien — celui
    -là ne sera jamais annulable, et le dire évite de chercher une opération
    disparue qui n'a jamais été suivie."""
    rows = (
        db.query(
            models.LigneImportBrute.import_historique_id,
            func.count(models.Operation.id),
            func.count(models.LigneImportBrute.id),
        )
        # OUTER : une ligne sans opération doit compter dans le total, c'est
        # tout l'objet de « sans_lien ». Un JOIN simple les ferait disparaître.
        .outerjoin(
            models.Operation, models.LigneImportBrute.operation_id == models.Operation.id
        )
        .filter(models.LigneImportBrute.preset_id == preset_id)
        .filter(models.LigneImportBrute.import_historique_id.isnot(None))
        .group_by(models.LigneImportBrute.import_historique_id)
        .all()
    )
    return {
        historique_id: {"annulables": nb_operations, "sans_lien": nb_lignes - nb_operations}
        for historique_id, nb_operations, nb_lignes in rows
    }


def delete_import_historique(db: Session, entree: models.ImportHistorique) -> None:
    """Retire la trace de l'import, une fois ses opérations supprimées.

    Les lignes de stock qui la référencent encore sont passées à NULL par le
    ON DELETE SET NULL du modèle — il n'en reste normalement aucune (le CASCADE
    des opérations les a emportées), sauf celles dont l'opération avait déjà
    disparu avant l'annulation."""
    db.delete(entree)
    db.commit()


def get_note_dashboard(db: Session) -> Optional[models.NoteDashboard]:
    """La note libre du dashboard, ou None si rien n'a jamais été écrit."""
    return db.query(models.NoteDashboard).order_by(models.NoteDashboard.id).first()


def set_note_dashboard(db: Session, contenu: str) -> models.NoteDashboard:
    """Écrit la note, en créant la ligne au premier passage.

    Une seule ligne pour toute la base : la note du dashboard est unique, et
    laisser plusieurs lignes s'accumuler ferait dépendre l'affichage d'un ordre
    de lecture."""
    note = get_note_dashboard(db)
    if note is None:
        note = models.NoteDashboard()
        db.add(note)
    note.contenu = contenu
    note.modifie_le = datetime.now()
    db.commit()
    db.refresh(note)
    return note
