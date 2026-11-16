"""Un dossier de catégories (migration 0105) et la migration d'opérations en lot d'une catégorie à une autre."""
from datetime import date

import pytest
from fastapi import HTTPException

from app import crud, models, schemas
from app.routers import categories as routeur_categories
from app.routers import operations as routeur_operations
from app.services import categorisation_intelligente

from .conftest import creer_compte, get_monnaie_id, get_type_id
from .test_reste_periode import _op


def _categorie(db, nom, parent_id=None, entree=False):
    categorie = crud.create_categorie(db, schemas.CategorieCreate(nom=nom, parent_id=parent_id))
    if entree:
        crud.set_categorie_est_entree(db, categorie, True)
    return categorie


def _operation_decoupee(db, compte, parts, nature="Courses"):
    return crud.create_operation(
        db,
        schemas.OperationCreate(
            date=date(2026, 3, 10),
            compte_id=compte.id,
            type_id=get_type_id(db, "classique"),
            nature=nature,
            montant=sum(montant for _, montant in parts),
            monnaie_id=get_monnaie_id(db),
            statut="réel",
            decoupes=[schemas.DecoupeInput(categorie_id=c.id, montant=m) for c, m in parts],
        ),
    )


# ---------- LE DOSSIER ----------


def test_un_dossier_demande_des_sous_categories(db_session):
    db = db_session
    seule = _categorie(db, "Transports")
    assert "aucune sous-catégorie" in crud.erreur_dossier_categorie(db, seule, True)
    _categorie(db, "Essence", seule.id)
    assert crud.erreur_dossier_categorie(db, seule, True) is None


def test_une_sous_categorie_ne_devient_pas_un_dossier(db_session):
    db = db_session
    parent = _categorie(db, "Transports")
    enfant = _categorie(db, "Essence", parent.id)
    assert "sous-catégorie" in crud.erreur_dossier_categorie(db, enfant, True)


def test_la_categorie_des_virements_n_est_pas_un_dossier(db_session):
    db = db_session
    assert crud.erreur_dossier_categorie(db, crud.get_categorie_virements(db), True) is not None


def test_un_dossier_refuse_tant_qu_une_operation_l_occupe(db_session):
    db = db_session
    compte = creer_compte(db, "Courant")
    parent = _categorie(db, "Transports")
    _categorie(db, "Essence", parent.id)
    _op(db, compte, date(2026, 3, 1), 10.0, categorie="Transports")
    message = crud.erreur_dossier_categorie(db, parent, True)
    assert message is not None and "1 opération" in message


def test_une_part_de_decoupe_occupe_aussi_le_dossier(db_session):
    db = db_session
    compte = creer_compte(db, "Courant")
    parent = _categorie(db, "Transports")
    _categorie(db, "Essence", parent.id)
    autre = _categorie(db, "Loisirs")
    _operation_decoupee(db, compte, [(parent, 30.0), (autre, 20.0)])
    assert "opération" in crud.erreur_dossier_categorie(db, parent, True)


def test_retirer_le_dossier_est_toujours_permis(db_session):
    db = db_session
    parent = _categorie(db, "Transports")
    assert crud.erreur_dossier_categorie(db, parent, False) is None


def test_un_dossier_ne_recoit_aucune_operation(db_session):
    db = db_session
    parent = _categorie(db, "Transports")
    _categorie(db, "Essence", parent.id)
    crud.set_categorie_dossier(db, parent, True)
    assert "dossier" in crud.erreur_categorie_eteinte(parent)
    # Même avec `precedent_id` : un dossier n'a jamais porté d'opération.
    assert crud.erreur_categorie_eteinte(parent, precedent_id=parent.id) is not None
    # Ses sous-catégories, elles, classent.
    enfant = crud.enfants_de(db, parent.id)[0]
    assert crud.erreur_categorie_eteinte(enfant) is None


def test_une_part_de_decoupe_ne_designe_pas_un_dossier(db_session):
    db = db_session
    parent = _categorie(db, "Transports")
    _categorie(db, "Essence", parent.id)
    crud.set_categorie_dossier(db, parent, True)
    autre = _categorie(db, "Loisirs")
    parts = [
        schemas.DecoupeInput(categorie_id=parent.id, montant=10.0),
        schemas.DecoupeInput(categorie_id=autre.id, montant=20.0),
    ]
    with pytest.raises(HTTPException) as erreur:
        routeur_operations._valider_decoupes(db, "classique", 30.0, parts)
    assert erreur.value.status_code == 400 and "dossier" in erreur.value.detail


def test_la_route_du_dossier(db_session):
    db = db_session
    parent = _categorie(db, "Transports")
    with pytest.raises(HTTPException) as erreur:
        routeur_categories.set_dossier_categorie(
            parent.id, schemas.CategorieDossierUpdate(est_dossier=True), db
        )
    assert erreur.value.status_code == 400
    _categorie(db, "Essence", parent.id)
    lu = routeur_categories.set_dossier_categorie(
        parent.id, schemas.CategorieDossierUpdate(est_dossier=True), db
    )
    assert lu.est_dossier is True
    with pytest.raises(HTTPException) as erreur:
        routeur_categories.set_dossier_categorie(
            9999, schemas.CategorieDossierUpdate(est_dossier=True), db
        )
    assert erreur.value.status_code == 404


def test_le_dossier_tombe_quand_sa_derniere_sous_categorie_part(db_session):
    db = db_session
    parent = _categorie(db, "Transports")
    a = _categorie(db, "Essence", parent.id)
    b = _categorie(db, "Train", parent.id)
    crud.set_categorie_dossier(db, parent, True)
    crud.set_categorie_parent(db, a, None)
    db.refresh(parent)
    assert parent.est_dossier is True  # il reste Train
    crud.delete_categorie(db, b)
    db.refresh(parent)
    assert parent.est_dossier is False


def test_un_dossier_garde_son_budget_et_ses_enfants(db_session):
    db = db_session
    parent = _categorie(db, "Transports")
    enfant = _categorie(db, "Essence", parent.id)
    monnaie_id = get_monnaie_id(db)
    crud.set_budget_categorie(db, parent.id, 2026, 3, monnaie_id, 300.0)
    crud.set_categorie_dossier(db, parent, True)
    assert crud.get_budget_categorie(db, parent.id, 2026, 3, monnaie_id) == 300.0
    db.refresh(enfant)
    assert enfant.parent_id == parent.id


def test_un_dossier_n_est_pas_suggere_a_l_import(db_session):
    db = db_session
    parent = _categorie(db, "Transports")
    _categorie(db, "Essence", parent.id)
    crud.set_categorie_dossier(db, parent, True)
    propositions = categorisation_intelligente.classer(db, "Transports")
    assert parent.id not in {p["categorie_id"] for p in propositions}


def test_le_repli_d_une_entree_ignore_un_dossier(db_session):
    db = db_session
    dossier = _categorie(db, "Revenus", entree=True)
    _categorie(db, "Salaire", dossier.id, entree=True)
    entrees = crud.get_categorie_by_nom(db, "Entrées d'argent")
    if entrees is not None:
        crud.set_categorie_active(db, entrees, False)
    crud.set_categorie_dossier(db, dossier, True)
    repli = crud.categorie_de_repli(db, entree=True)
    assert repli is not None and repli.id != dossier.id


# ---------- LA MIGRATION EN LOT ----------


def test_migrer_des_operations_simples(db_session):
    db = db_session
    compte = creer_compte(db, "Courant")
    source = _categorie(db, "Resto")
    cible = _categorie(db, "Sorties")
    a = _op(db, compte, date(2026, 3, 1), 12.0, categorie="Resto")
    b = _op(db, compte, date(2026, 3, 2), 30.0, categorie="Resto")
    resultat = routeur_operations.changer_categorie_en_lot(
        schemas.ChangerCategorieLot(operation_ids=[a.id, b.id], categorie_id=cible.id), db
    )
    assert resultat.migrees == 2 and resultat.ignorees == []
    db.refresh(a)
    db.refresh(b)
    assert a.categorie_id == b.categorie_id == cible.id
    assert source.id not in {a.categorie_id, b.categorie_id}


def test_une_operation_deja_dans_la_cible_est_ignoree_et_dite(db_session):
    db = db_session
    compte = creer_compte(db, "Courant")
    cible = _categorie(db, "Sorties")
    deja = _op(db, compte, date(2026, 3, 1), 12.0, categorie="Sorties")
    resultat = crud.changer_categorie_en_lot(db, [deja.id], cible, [])
    assert resultat.migrees == 0
    assert resultat.ignorees[0].id == deja.id and "Déjà" in resultat.ignorees[0].raison


def test_la_migration_ne_change_pas_le_sens_en_silence(db_session):
    db = db_session
    compte = creer_compte(db, "Courant")
    _categorie(db, "Resto")
    salaire = _categorie(db, "Salaire", entree=True)
    depense = _op(db, compte, date(2026, 3, 1), 12.0, categorie="Resto")
    resultat = crud.changer_categorie_en_lot(db, [depense.id], salaire, [])
    assert resultat.migrees == 0
    assert "Sens différent" in resultat.ignorees[0].raison
    db.refresh(depense)
    assert depense.categorie_id != salaire.id


def test_la_cible_d_une_migration_n_est_ni_eteinte_ni_dossier_ni_virements(db_session):
    db = db_session
    compte = creer_compte(db, "Courant")
    _categorie(db, "Resto")
    op = _op(db, compte, date(2026, 3, 1), 12.0, categorie="Resto")
    eteinte = _categorie(db, "Ancienne")
    crud.set_categorie_active(db, eteinte, False)
    parent = _categorie(db, "Transports")
    _categorie(db, "Essence", parent.id)
    crud.set_categorie_dossier(db, parent, True)
    for cible in (eteinte, parent, crud.get_categorie_virements(db)):
        with pytest.raises(HTTPException) as erreur:
            routeur_operations.changer_categorie_en_lot(
                schemas.ChangerCategorieLot(operation_ids=[op.id], categorie_id=cible.id), db
            )
        assert erreur.value.status_code == 400
    with pytest.raises(HTTPException) as erreur:
        routeur_operations.changer_categorie_en_lot(
            schemas.ChangerCategorieLot(operation_ids=[op.id], categorie_id=9999), db
        )
    assert erreur.value.status_code == 404


def test_un_virement_n_est_pas_migre(db_session):
    db = db_session
    compte = creer_compte(db, "Courant")
    cible = _categorie(db, "Sorties")
    virement = _op(db, compte, date(2026, 3, 1), 50.0, type_code="virement", sens="transfert_sortant")
    resultat = crud.changer_categorie_en_lot(db, [virement.id, 99999], cible, [])
    assert resultat.migrees == 0
    assert len(resultat.ignorees) == 2


def test_la_part_d_une_decoupe_change_de_categorie_et_fusionne(db_session):
    db = db_session
    compte = creer_compte(db, "Courant")
    source = _categorie(db, "Resto")
    cible = _categorie(db, "Sorties")
    loisirs = _categorie(db, "Loisirs")
    operation = _operation_decoupee(db, compte, [(source, 30.0), (cible, 20.0), (loisirs, 10.0)])
    resultat = crud.changer_categorie_en_lot(db, [operation.id], cible, [source.id])
    assert resultat.migrees == 1
    db.refresh(operation)
    parts = {p.categorie_id: p.montant for p in operation.decoupes}
    # La part « Resto » a rejoint la part « Sorties » : 30 + 20, et la somme vaut toujours le montant.
    assert parts == {cible.id: 50.0, loisirs.id: 10.0}
    assert sum(parts.values()) == pytest.approx(operation.montant)
    assert operation.categorie_id is None


def test_une_decoupe_qui_n_a_plus_qu_une_categorie_redevient_simple(db_session):
    db = db_session
    compte = creer_compte(db, "Courant")
    source = _categorie(db, "Resto")
    cible = _categorie(db, "Sorties")
    operation = _operation_decoupee(db, compte, [(source, 30.0), (cible, 20.0)])
    resultat = crud.changer_categorie_en_lot(db, [operation.id], cible, [source.id])
    assert resultat.migrees == 1
    db.refresh(operation)
    assert operation.decoupes == []
    assert operation.categorie_id == cible.id


def test_une_decoupe_sans_part_dans_les_sources_est_ignoree(db_session):
    db = db_session
    compte = creer_compte(db, "Courant")
    a = _categorie(db, "Resto")
    b = _categorie(db, "Loisirs")
    cible = _categorie(db, "Sorties")
    operation = _operation_decoupee(db, compte, [(a, 30.0), (b, 20.0)])
    resultat = crud.changer_categorie_en_lot(db, [operation.id], cible, [])
    assert resultat.migrees == 0 and "Découpée" in resultat.ignorees[0].raison
    db.refresh(operation)
    assert {p.categorie_id for p in operation.decoupes} == {a.id, b.id}
