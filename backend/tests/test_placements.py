"""Comptes de placement : espèces d'un côté, titres de l'autre.

Le point sensible de cette fonctionnalité est que les deux soldes d'un
compte-titres viennent de sources différentes — les espèces des `Operation`
ordinaires (comme n'importe quel compte), les titres des `OperationAction` — et
qu'un mouvement doit toujours bouger les deux à la fois, ou aucun.
"""
from datetime import date

import pytest
from fastapi import HTTPException

from app import crud, models, schemas
from app.constants import Sens, SensAction, Statut, TypeOperation
from app.services import placements, soldes

from .conftest import (
    charger_module_extension,
    creer_compte,
    get_categorie_id,
    get_monnaie_id,
    get_type_id,
)

# Les placements sont une EXTENSION depuis leur sortie du noyau : leur
# routeur se charge par chemin, comme le fait l'application.
routeur_placements = charger_module_extension("placements", "routeur_placements.py")


def _make_compte(db, nom="PEA", type_nom="placements financiers", solde_initial=0.0, monnaies=None):
    return creer_compte(
        db, nom, type_nom=type_nom, solde_initial=solde_initial, monnaies=monnaies
    )


def _make_action(db, nom="Air Liquide", valeur=0.0, monnaie_id=None):
    return crud.create_action(db, nom, monnaie_id or get_monnaie_id(db), valeur)


def _mouvement(db, compte, action, sens, quantite, prix, jour=1):
    return crud.create_operation_action(
        db,
        compte_id=compte.id,
        action=action,
        sens=sens,
        quantite=quantite,
        prix_unitaire=prix,
        date_operation=date(2026, 7, jour),
    )


def _solde_reel(db, compte, monnaie_id=None):
    """Les espèces d'un compte-titres dans une monnaie — sa principale par
    défaut."""
    item = next(
        item for item in soldes.get_soldes_comptes(db) if item["compte"].id == compte.id
    )
    return item["soldes"][monnaie_id or compte.monnaie_principale_id]["solde_reel"]


def test_achat_debite_les_especes_et_credite_le_portefeuille(db_session):
    compte = _make_compte(db_session, solde_initial=1000.0)
    action = _make_action(db_session)

    _mouvement(db_session, compte, action, SensAction.achat, 10, 25.0)

    assert _solde_reel(db_session, compte) == 750.0
    detention = placements.detentions(db_session, compte.id)[0]
    assert detention["quantite"] == 10
    assert detention["prix_revient_unitaire"] == 25.0
    assert detention["montant_investi"] == 250.0


def test_achat_nest_ni_une_depense_ni_une_entree(db_session):
    """Acheter des titres convertit de l'argent, ne le dépense pas : l'écriture
    est un transfert, donc absente de la variation du mois et des dépenses par
    catégorie."""
    compte = _make_compte(db_session, solde_initial=1000.0)
    courant = _make_compte(db_session, nom="Courant", type_nom="courant")
    action = _make_action(db_session)
    crud.create_operation(
        db_session,
        schemas.OperationCreate(
            date=date(2026, 7, 1),
            compte_id=courant.id,
            monnaie_id=get_monnaie_id(db_session),
            type_id=get_type_id(db_session, "classique"),
            categorie_id=get_categorie_id(db_session, "Alimentaire"),
            nature="Courses",
            montant=40.0,
            statut=Statut.reel,
        ),
    )

    mouvement = _mouvement(db_session, compte, action, SensAction.achat, 10, 25.0)

    operation = crud.get_operation(db_session, mouvement.operation_id)
    assert operation.sens == Sens.transfert_sortant
    assert operation.categorie_id is None
    assert operation.statut == Statut.reel
    assert soldes.get_variation_previsionnelle(db_session, 2026, 7, get_monnaie_id(db_session)) == -40.0
    depenses = {
        ligne["categorie"]: ligne["total_reel"]
        for ligne in soldes.get_depenses_par_categorie(db_session, 2026, 7, get_monnaie_id(db_session))
    }
    assert depenses["Alimentaire"] == 40.0


def test_vente_credite_les_especes_et_reduit_la_quantite(db_session):
    compte = _make_compte(db_session, solde_initial=1000.0)
    action = _make_action(db_session)
    _mouvement(db_session, compte, action, SensAction.achat, 10, 25.0, jour=1)

    mouvement = _mouvement(db_session, compte, action, SensAction.vente, 4, 30.0, jour=5)

    assert crud.get_operation(db_session, mouvement.operation_id).sens == Sens.transfert_entrant
    assert _solde_reel(db_session, compte) == 1000.0 - 250.0 + 120.0
    detention = placements.detentions(db_session, compte.id)[0]
    assert detention["quantite"] == 6
    # Une vente sort les titres au coût moyen : le prix de revient ne bouge pas,
    # seul le capital encore engagé diminue.
    assert detention["prix_revient_unitaire"] == 25.0
    assert detention["montant_investi"] == 150.0


def test_vente_superieure_a_la_detention_refusee(db_session):
    compte = _make_compte(db_session, solde_initial=1000.0)
    action = _make_action(db_session)
    _mouvement(db_session, compte, action, SensAction.achat, 10, 25.0)

    with pytest.raises(HTTPException) as erreur:
        routeur_placements.create_operation_action(
            compte.id,
            schemas.OperationActionCreate(
                action_id=action.id,
                sens=SensAction.vente,
                quantite=11,
                prix_unitaire=30.0,
                date=date(2026, 7, 5),
            ),
            db_session,
        )

    assert erreur.value.status_code == 400
    assert "Quantité insuffisante" in erreur.value.detail
    # Rien n'a été enregistré : ni titres, ni espèces.
    assert placements.detentions(db_session, compte.id)[0]["quantite"] == 10
    assert _solde_reel(db_session, compte) == 750.0


def test_vente_limitee_au_compte_qui_detient(db_session):
    """Le même titre peut être détenu sur deux comptes : seul ce qui est sur CE
    compte est vendable depuis lui."""
    pea = _make_compte(db_session, nom="PEA", solde_initial=1000.0)
    cto = _make_compte(db_session, nom="CTO", solde_initial=1000.0)
    action = _make_action(db_session)
    _mouvement(db_session, pea, action, SensAction.achat, 10, 25.0)

    assert placements.quantite_detenue(db_session, cto.id, action.id) == 0
    with pytest.raises(HTTPException) as erreur:
        routeur_placements.create_operation_action(
            cto.id,
            schemas.OperationActionCreate(
                action_id=action.id,
                sens=SensAction.vente,
                quantite=1,
                prix_unitaire=30.0,
                date=date(2026, 7, 5),
            ),
            db_session,
        )
    assert erreur.value.status_code == 400


def test_position_soldee_disparait_des_detentions(db_session):
    compte = _make_compte(db_session, solde_initial=1000.0)
    action = _make_action(db_session)
    _mouvement(db_session, compte, action, SensAction.achat, 10, 25.0, jour=1)

    _mouvement(db_session, compte, action, SensAction.vente, 10, 30.0, jour=5)

    assert placements.detentions(db_session, compte.id) == []
    assert placements.quantite_detenue(db_session, compte.id, action.id) == 0


def test_prix_de_revient_moyen_sur_deux_achats(db_session):
    compte = _make_compte(db_session, solde_initial=1000.0)
    action = _make_action(db_session)
    _mouvement(db_session, compte, action, SensAction.achat, 10, 20.0, jour=1)
    _mouvement(db_session, compte, action, SensAction.achat, 10, 30.0, jour=2)

    detention = placements.detentions(db_session, compte.id)[0]
    assert detention["quantite"] == 20
    assert detention["prix_revient_unitaire"] == 25.0


def test_valorisation_suit_le_cours_saisi(db_session):
    compte = _make_compte(db_session, solde_initial=1000.0)
    action = _make_action(db_session, valeur=25.0)
    _mouvement(db_session, compte, action, SensAction.achat, 10, 25.0)

    crud.update_action(db_session, action, valeur=32.0)

    detention = placements.detentions(db_session, compte.id)[0]
    assert detention["valorisation"] == 320.0
    assert detention["plus_value_latente"] == 70.0
    # Le cours ne touche jamais aux espèces, qui ne dépendent que du prix payé.
    assert _solde_reel(db_session, compte) == 750.0


def test_supprimer_un_mouvement_annule_les_deux_versants(db_session):
    compte = _make_compte(db_session, solde_initial=1000.0)
    action = _make_action(db_session)
    mouvement = _mouvement(db_session, compte, action, SensAction.achat, 10, 25.0)
    operation_id = mouvement.operation_id

    crud.delete_operation_action(db_session, mouvement)

    assert crud.get_operation(db_session, operation_id) is None
    assert placements.detentions(db_session, compte.id) == []
    assert _solde_reel(db_session, compte) == 1000.0


def test_supprimer_lecriture_despeces_emporte_le_mouvement(db_session):
    """Chemin de suppression générique (delete_all_operations, cascade d'un
    compte…) : aucune OperationAction ne doit survivre à son écriture."""
    compte = _make_compte(db_session, solde_initial=1000.0)
    action = _make_action(db_session)
    mouvement = _mouvement(db_session, compte, action, SensAction.achat, 10, 25.0)

    crud.delete_operation(db_session, crud.get_operation(db_session, mouvement.operation_id))

    assert db_session.query(models.OperationAction).count() == 0
    # Le titre lui-même reste : ce n'est pas une opération.
    assert crud.get_action(db_session, action.id) is not None


def test_placement_hors_kpi_courants_mais_dans_les_avoirs(db_session):
    courant = _make_compte(db_session, nom="Courant", type_nom="courant", solde_initial=500.0)
    compte = _make_compte(db_session, solde_initial=1000.0)
    action = _make_action(db_session, valeur=30.0)
    _mouvement(db_session, compte, action, SensAction.achat, 10, 25.0)

    comptes_soldes = soldes.get_soldes_comptes(db_session)
    totaux = soldes.calculer_totaux_par_monnaie(
        comptes_soldes, valorisation_placements=placements.valorisation_totale(db_session)
    )[get_monnaie_id(db_session)]

    assert totaux["solde_total_courant"] == 500.0  # le compte-titres est exclu
    # 500 (courant) + 750 (espèces restantes) + 300 (10 titres à 30)
    assert totaux["total_avoirs"] == 1550.0
    assert totaux["valorisation_placements"] == 300.0
    assert courant.id  # le compte courant existe bien (garde le test explicite)


def test_operation_classique_refusee_sur_un_compte_de_placement(db_session):
    from app.routers import operations as routeur_operations

    compte = _make_compte(db_session)

    with pytest.raises(HTTPException) as erreur:
        routeur_operations.create_operation(
            schemas.OperationCreate(
                date=date(2026, 7, 1),
                compte_id=compte.id,
                monnaie_id=get_monnaie_id(db_session),
                type_id=get_type_id(db_session, "classique"),
                categorie_id=get_categorie_id(db_session, "Alimentaire"),
                nature="Courses",
                montant=40.0,
                statut=Statut.reel,
            ),
            db_session,
        )

    assert erreur.value.status_code == 400
    assert "placements financiers" in erreur.value.detail


def test_type_titres_refuse_par_lendpoint_generique(db_session):
    """Le type existe en base (les soldes en dépendent) mais ne se pose jamais à
    la main : sans sa contrepartie, l'écriture n'aurait aucun sens."""
    from app.routers import operations as routeur_operations

    compte = _make_compte(db_session, nom="Courant", type_nom="courant")

    with pytest.raises(HTTPException) as erreur:
        routeur_operations.create_operation(
            schemas.OperationCreate(
                date=date(2026, 7, 1),
                compte_id=compte.id,
                monnaie_id=get_monnaie_id(db_session),
                type_id=get_type_id(db_session, TypeOperation.action),
                nature="Achat sauvage",
                montant=40.0,
                statut=Statut.reel,
            ),
            db_session,
        )

    assert erreur.value.status_code == 400


def test_type_titres_refuse_dans_une_regle(db_session):
    routeur_regles = charger_module_extension("regles", "routeur_regles.py")

    with pytest.raises(HTTPException) as erreur:
        routeur_regles._valider_action(db_session, get_type_id(db_session, "action"), None, None)

    assert erreur.value.status_code == 400


def test_supprimer_un_titre_encore_detenu_refuse(db_session):
    routeur_actions = charger_module_extension("placements", "routeur_actions.py")

    compte = _make_compte(db_session, solde_initial=1000.0)
    action = _make_action(db_session)
    _mouvement(db_session, compte, action, SensAction.achat, 10, 25.0)

    with pytest.raises(HTTPException) as erreur:
        routeur_actions.delete_action(action.id, db_session)

    assert erreur.value.status_code == 409


def test_lecture_dun_compte_de_placement(db_session):
    compte = _make_compte(db_session, solde_initial=1000.0)
    action = _make_action(db_session, valeur=30.0)
    _mouvement(db_session, compte, action, SensAction.achat, 10, 25.0)

    detail = routeur_placements.read_placement(compte.id, db_session)

    euro = detail.par_monnaie[0]
    assert euro.solde_espece == 750.0
    assert euro.valorisation == 300.0
    assert euro.total == 1050.0
    assert [d.action_nom for d in detail.detentions] == ["Air Liquide"]
    assert [o.sens for o in detail.operations] == [SensAction.achat]
    assert detail.operations[0].montant == 250.0
    assert detail.operations[0].nature == "Achat Air Liquide"


def test_lecture_refusee_sur_un_compte_ordinaire(db_session):
    compte = _make_compte(db_session, nom="Courant", type_nom="courant")

    with pytest.raises(HTTPException) as erreur:
        routeur_placements.read_placement(compte.id, db_session)

    assert erreur.value.status_code == 400
