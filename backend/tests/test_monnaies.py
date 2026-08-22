"""Multi-monnaies : un compte peut en porter plusieurs, et rien ne s'additionne
jamais d'une monnaie à l'autre.

L'app ne stocke aucun taux de change. La règle qui en découle et que ces tests
verrouillent : chaque montant est libellé dans une monnaie portée par son
compte, et tout agrégat (solde, KPI, budget, histogramme) est calculé
séparément par monnaie.
"""
from datetime import date

import pytest
from fastapi import HTTPException

from app import crud, models, schemas
from app.constants import SensAction, Statut
from app.routers import comptes as routeur_comptes
from app.routers import dashboard as routeur_dashboard
from app.routers import monnaies as routeur_monnaies
from app.routers import operations as routeur_operations
from app.routers import virements as routeur_virements
from app.services import placements, soldes

# Routeurs de l'extension « Placements financiers » (sortis du noyau).
from .conftest import charger_module_extension  # noqa: E402

routeur_actions = charger_module_extension("placements", "routeur_actions.py")
routeur_placements = charger_module_extension("placements", "routeur_placements.py")

from .conftest import (
    creer_compte,
    creer_monnaie,
    get_categorie_id,
    get_monnaie_id,
    get_type_compte_id,
    get_type_id,
)


def _euro_et_dollar(db):
    return get_monnaie_id(db), creer_monnaie(db, "Dollar", "$").id


def _operation(db, compte, monnaie_id, montant, categorie="Alimentaire", statut=Statut.reel):
    return routeur_operations.create_operation(
        schemas.OperationCreate(
            date=date(2026, 7, 1),
            compte_id=compte.id,
            monnaie_id=monnaie_id,
            type_id=get_type_id(db, "classique"),
            categorie_id=get_categorie_id(db, categorie),
            nature="Courses",
            montant=montant,
            statut=statut,
        ),
        db,
    )


# ---------- Soldes ----------


def test_un_compte_a_un_solde_par_monnaie(db_session):
    euro, dollar = _euro_et_dollar(db_session)
    compte = creer_compte(
        db_session, "Compte voyage", monnaies=[(euro, 100.0), (dollar, 500.0)]
    )
    _operation(db_session, compte, euro, 40.0)
    _operation(db_session, compte, dollar, 200.0)

    item = next(
        r for r in soldes.get_soldes_comptes(db_session) if r["compte"].id == compte.id
    )

    assert item["soldes"][euro]["solde_reel"] == 60.0
    assert item["soldes"][dollar]["solde_reel"] == 300.0


def test_une_monnaie_sans_operation_expose_quand_meme_son_solde_initial(db_session):
    """Un compte en dollars fraîchement ouvert doit être visible, pas absent
    faute d'écriture."""
    euro, dollar = _euro_et_dollar(db_session)
    compte = creer_compte(db_session, "Compte voyage", monnaies=[(euro, 0.0), (dollar, 250.0)])

    item = next(
        r for r in soldes.get_soldes_comptes(db_session) if r["compte"].id == compte.id
    )

    assert item["soldes"][dollar]["solde_reel"] == 250.0
    assert item["soldes"][euro]["solde_reel"] == 0.0


# ---------- Validation monnaie / compte ----------


def test_operation_dans_une_monnaie_absente_du_compte_refusee(db_session):
    euro, dollar = _euro_et_dollar(db_session)
    compte = creer_compte(db_session, "Courant", monnaies=[(euro, 0.0)])

    with pytest.raises(HTTPException) as erreur:
        _operation(db_session, compte, dollar, 40.0)

    assert erreur.value.status_code == 400
    assert "ne porte pas cette monnaie" in erreur.value.detail


def test_deplacer_une_operation_vers_un_compte_sans_sa_monnaie_refuse(db_session):
    """Le couple (compte, monnaie) doit rester valide après coup : changer l'un
    sans l'autre suffit à le rompre."""
    euro, dollar = _euro_et_dollar(db_session)
    voyage = creer_compte(db_session, "Voyage", monnaies=[(euro, 0.0), (dollar, 0.0)])
    courant = creer_compte(db_session, "Courant", monnaies=[(euro, 0.0)])
    operation = _operation(db_session, voyage, dollar, 40.0)

    with pytest.raises(HTTPException) as erreur:
        routeur_operations.update_operation(
            operation.id, schemas.OperationUpdate(compte_id=courant.id), db_session
        )

    assert erreur.value.status_code == 400


def test_retirer_une_monnaie_utilisee_par_une_operation_refuse(db_session):
    euro, dollar = _euro_et_dollar(db_session)
    compte = creer_compte(db_session, "Voyage", monnaies=[(euro, 0.0), (dollar, 0.0)])
    _operation(db_session, compte, dollar, 40.0)

    with pytest.raises(HTTPException) as erreur:
        routeur_comptes.update_compte(
            compte.id,
            schemas.CompteUpdate(
                monnaies=[schemas.CompteMonnaieInput(monnaie_id=euro, solde_initial=0.0)]
            ),
            db_session,
        )

    assert erreur.value.status_code == 409
    assert "Dollar" in erreur.value.detail


def test_ajouter_une_monnaie_preserve_le_solde_initial_des_autres(db_session):
    euro, dollar = _euro_et_dollar(db_session)
    compte = creer_compte(db_session, "Courant", monnaies=[(euro, 750.0)])

    lu = routeur_comptes.update_compte(
        compte.id,
        schemas.CompteUpdate(
            monnaies=[
                schemas.CompteMonnaieInput(monnaie_id=euro, solde_initial=750.0),
                schemas.CompteMonnaieInput(monnaie_id=dollar, solde_initial=100.0),
            ]
        ),
        db_session,
    )

    assert [(m.monnaie_id, m.solde_initial) for m in lu.monnaies] == [
        (euro, 750.0),
        (dollar, 100.0),
    ]


def test_supprimer_une_monnaie_utilisee_refuse(db_session):
    euro, dollar = _euro_et_dollar(db_session)
    creer_compte(db_session, "Voyage", monnaies=[(euro, 0.0), (dollar, 0.0)])

    with pytest.raises(HTTPException) as erreur:
        routeur_monnaies.delete_monnaie(dollar, db_session)

    assert erreur.value.status_code == 409


def test_supprimer_une_monnaie_inutilisee_fonctionne(db_session):
    dollar = creer_monnaie(db_session, "Dollar", "$").id

    routeur_monnaies.delete_monnaie(dollar, db_session)

    assert crud.get_monnaie(db_session, dollar) is None


# ---------- Virements ----------


def test_virement_entre_deux_monnaies_porte_deux_montants(db_session):
    """100 € partent, 108 $ arrivent : aucun taux n'est calculé, les deux
    montants sont ceux réellement constatés."""
    euro, dollar = _euro_et_dollar(db_session)
    source = creer_compte(db_session, "Courant", monnaies=[(euro, 1000.0)])
    destination = creer_compte(db_session, "Compte US", monnaies=[(dollar, 0.0)])

    lu = routeur_virements.create_virement(
        schemas.VirementCreate(
            date=date(2026, 7, 1),
            compte_source_id=source.id,
            compte_destination_id=destination.id,
            montant=100.0,
            monnaie_id=euro,
            montant_destination=108.0,
            monnaie_destination_id=dollar,
        ),
        db_session,
    )

    assert (lu.operation_sortante.montant, lu.operation_sortante.monnaie_id) == (100.0, euro)
    assert (lu.operation_entrante.montant, lu.operation_entrante.monnaie_id) == (108.0, dollar)

    soldes_par_compte = {
        r["compte"].id: r["soldes"] for r in soldes.get_soldes_comptes(db_session)
    }
    assert soldes_par_compte[source.id][euro]["solde_reel"] == 900.0
    assert soldes_par_compte[destination.id][dollar]["solde_reel"] == 108.0


def test_virement_monnaie_unique_reprend_le_montant_de_depart(db_session):
    """Le cas courant : une seule monnaie, le second montant n'est même pas
    demandé côté frontend."""
    euro = get_monnaie_id(db_session)
    source = creer_compte(db_session, "Courant", monnaies=[(euro, 500.0)])
    destination = creer_compte(db_session, "Livret A", type_nom="épargne", monnaies=[(euro, 0.0)])

    lu = routeur_virements.create_virement(
        schemas.VirementCreate(
            date=date(2026, 7, 1),
            compte_source_id=source.id,
            compte_destination_id=destination.id,
            montant=200.0,
            monnaie_id=euro,
        ),
        db_session,
    )

    assert lu.operation_entrante.montant == 200.0
    assert lu.operation_entrante.monnaie_id == euro


def test_modifier_un_virement_reecrit_ses_deux_ecritures(db_session):
    """Les deux jambes se modifient ensemble : n'en corriger qu'une laisserait
    un virement dont les deux côtés ne se répondent plus."""
    euro, dollar = _euro_et_dollar(db_session)
    source = creer_compte(db_session, "Courant", monnaies=[(euro, 1000.0), (dollar, 0.0)])
    destination = creer_compte(db_session, "Compte US", monnaies=[(dollar, 0.0)])
    cree = routeur_virements.create_virement(
        schemas.VirementCreate(
            date=date(2026, 7, 1),
            compte_source_id=source.id,
            compte_destination_id=destination.id,
            montant=100.0,
            monnaie_id=euro,
            montant_destination=108.0,
            monnaie_destination_id=dollar,
        ),
        db_session,
    )
    ids_avant = (cree.operation_sortante.id, cree.operation_entrante.id)

    modifie = routeur_virements.update_virement(
        cree.virement_id,
        schemas.VirementCreate(
            date=date(2026, 7, 9),
            compte_source_id=source.id,
            compte_destination_id=destination.id,
            montant=200.0,
            monnaie_id=euro,
            montant_destination=214.0,
            monnaie_destination_id=dollar,
            nature="Virement corrigé",
        ),
        db_session,
    )

    # Mêmes lignes réécrites en place : rien n'est supprimé ni recréé, ce qui
    # préserve tout ce qui les référence (dont le stock anti-doublons d'import).
    assert (modifie.operation_sortante.id, modifie.operation_entrante.id) == ids_avant
    assert modifie.operation_sortante.montant == 200.0
    assert modifie.operation_entrante.montant == 214.0
    assert modifie.operation_sortante.date == date(2026, 7, 9)
    assert modifie.operation_entrante.date == date(2026, 7, 9)
    assert modifie.operation_sortante.sens.value == "transfert_sortant"
    assert modifie.operation_entrante.sens.value == "transfert_entrant"

    soldes_par_compte = {
        r["compte"].id: r["soldes"] for r in soldes.get_soldes_comptes(db_session)
    }
    assert soldes_par_compte[source.id][euro]["solde_reel"] == 800.0
    assert soldes_par_compte[destination.id][dollar]["solde_reel"] == 214.0


def test_modifier_un_virement_vers_une_monnaie_absente_du_compte_refuse(db_session):
    euro, dollar = _euro_et_dollar(db_session)
    source = creer_compte(db_session, "Courant", monnaies=[(euro, 1000.0)])
    destination = creer_compte(db_session, "Livret A", type_nom="épargne", monnaies=[(euro, 0.0)])
    cree = routeur_virements.create_virement(
        schemas.VirementCreate(
            date=date(2026, 7, 1),
            compte_source_id=source.id,
            compte_destination_id=destination.id,
            montant=100.0,
            monnaie_id=euro,
        ),
        db_session,
    )

    with pytest.raises(HTTPException) as erreur:
        routeur_virements.update_virement(
            cree.virement_id,
            schemas.VirementCreate(
                date=date(2026, 7, 1),
                compte_source_id=source.id,
                compte_destination_id=destination.id,
                montant=100.0,
                monnaie_id=euro,
                monnaie_destination_id=dollar,
                montant_destination=108.0,
            ),
            db_session,
        )

    assert erreur.value.status_code == 400


def test_modifier_un_virement_introuvable_renvoie_404(db_session):
    euro = get_monnaie_id(db_session)
    compte = creer_compte(db_session, "Courant", monnaies=[(euro, 0.0)])
    autre = creer_compte(db_session, "Livret A", type_nom="épargne", monnaies=[(euro, 0.0)])

    with pytest.raises(HTTPException) as erreur:
        routeur_virements.update_virement(
            "virement-qui-nexiste-pas",
            schemas.VirementCreate(
                date=date(2026, 7, 1),
                compte_source_id=compte.id,
                compte_destination_id=autre.id,
                montant=10.0,
                monnaie_id=euro,
            ),
            db_session,
        )

    assert erreur.value.status_code == 404


def test_conversion_entre_deux_monnaies_dun_meme_compte_est_autorisee(db_session):
    """Un compte multi-devises (typiquement Wise) permet de convertir sans
    quitter le compte : les deux écritures restent bien distinctes puisqu'elles
    portent chacune sa monnaie, et les deux soldes du compte — jamais
    additionnés — bougent réellement."""
    euro, dollar = _euro_et_dollar(db_session)
    compte = creer_compte(db_session, "Wise", monnaies=[(euro, 1000.0), (dollar, 0.0)])

    lu = routeur_virements.create_virement(
        schemas.VirementCreate(
            date=date(2026, 7, 1),
            compte_source_id=compte.id,
            compte_destination_id=compte.id,
            montant=100.0,
            monnaie_id=euro,
            montant_destination=108.0,
            monnaie_destination_id=dollar,
        ),
        db_session,
    )

    assert lu.operation_sortante.compte_id == lu.operation_entrante.compte_id == compte.id
    # Libellé par défaut adapté : « Virement vers Wise » depuis Wise ne
    # voudrait rien dire.
    assert lu.operation_sortante.nature == "Conversion sur Wise"

    soldes_compte = next(
        r for r in soldes.get_soldes_comptes(db_session) if r["compte"].id == compte.id
    )["soldes"]
    assert soldes_compte[euro]["solde_reel"] == 900.0
    assert soldes_compte[dollar]["solde_reel"] == 108.0


def test_virement_dun_compte_vers_lui_meme_dans_la_meme_monnaie_reste_refuse(db_session):
    """Deux écritures qui s'annulent exactement : rien ne bouge, c'est une
    erreur de saisie."""
    euro = get_monnaie_id(db_session)
    compte = creer_compte(db_session, "Courant", monnaies=[(euro, 500.0)])

    with pytest.raises(ValueError, match="doivent être différents"):
        schemas.VirementCreate(
            date=date(2026, 7, 1),
            compte_source_id=compte.id,
            compte_destination_id=compte.id,
            montant=100.0,
            monnaie_id=euro,
        )


def test_virement_dans_une_monnaie_absente_du_compte_destination_refuse(db_session):
    euro, dollar = _euro_et_dollar(db_session)
    source = creer_compte(db_session, "Courant", monnaies=[(euro, 1000.0)])
    destination = creer_compte(db_session, "Livret A", type_nom="épargne", monnaies=[(euro, 0.0)])

    with pytest.raises(HTTPException) as erreur:
        routeur_virements.create_virement(
            schemas.VirementCreate(
                date=date(2026, 7, 1),
                compte_source_id=source.id,
                compte_destination_id=destination.id,
                montant=100.0,
                monnaie_id=euro,
                monnaie_destination_id=dollar,
                montant_destination=108.0,
            ),
            db_session,
        )

    assert erreur.value.status_code == 400


def test_un_reglement_ne_peut_pas_regler_une_dette_dune_autre_monnaie(db_session):
    """Le montant du lien est comparé au montant dû de la dette : sans même
    monnaie, « 40 » réglerait « 40 » sans qu'il s'agisse du même argent."""
    euro, dollar = _euro_et_dollar(db_session)
    compte = creer_compte(db_session, "Voyage", monnaies=[(euro, 0.0), (dollar, 0.0)])
    dette = routeur_operations.create_operation(
        schemas.OperationCreate(
            date=date(2026, 7, 1),
            compte_id=compte.id,
            monnaie_id=dollar,
            type_id=get_type_id(db_session, "remboursable"),
            categorie_id=get_categorie_id(db_session, "Autres"),
            nature="Avance en dollars",
            montant=40.0,
            statut=Statut.reel,
        ),
        db_session,
    )

    with pytest.raises(HTTPException) as erreur:
        routeur_operations.create_operation(
            schemas.OperationCreate(
                date=date(2026, 7, 5),
                compte_id=compte.id,
                monnaie_id=euro,
                type_id=get_type_id(db_session, "remboursements"),
                nature="Remboursement en euros",
                montant=40.0,
                statut=Statut.reel,
                operations_remboursees=[
                    schemas.OperationRembourseeInput(operation_id=dette.id, montant=40.0)
                ],
            ),
            db_session,
        )

    assert erreur.value.status_code == 400
    assert "même monnaie" in erreur.value.detail


# ---------- Budgets ----------


def test_budget_par_monnaie_et_heritage_qui_ne_traverse_pas_les_monnaies(db_session):
    euro, dollar = _euro_et_dollar(db_session)
    categorie_id = get_categorie_id(db_session, "Alimentaire")

    crud.set_budget_categorie(db_session, categorie_id, 2026, 5, euro, 300.0)
    crud.set_budget_categorie(db_session, categorie_id, 2026, 5, dollar, 400.0)

    assert crud.get_budget_categorie(db_session, categorie_id, 2026, 7, euro) == 300.0
    assert crud.get_budget_categorie(db_session, categorie_id, 2026, 7, dollar) == 400.0

    # Une monnaie sans budget n'hérite pas de celui d'une autre.
    autre = creer_monnaie(db_session, "Franc suisse", "CHF").id
    assert crud.get_budget_categorie(db_session, categorie_id, 2026, 7, autre) == 0.0


def test_histogramme_ne_melange_pas_les_monnaies(db_session):
    euro, dollar = _euro_et_dollar(db_session)
    compte = creer_compte(db_session, "Voyage", monnaies=[(euro, 0.0), (dollar, 0.0)])
    _operation(db_session, compte, euro, 40.0)
    _operation(db_session, compte, dollar, 200.0)

    en_euros = {
        ligne["categorie"]: ligne["total_reel"]
        for ligne in soldes.get_depenses_par_categorie(db_session, 2026, 7, euro)
    }
    en_dollars = {
        ligne["categorie"]: ligne["total_reel"]
        for ligne in soldes.get_depenses_par_categorie(db_session, 2026, 7, dollar)
    }

    assert en_euros["Alimentaire"] == 40.0
    assert en_dollars["Alimentaire"] == 200.0


# ---------- Dashboard ----------


def test_dashboard_expose_un_jeu_de_kpi_par_monnaie(db_session):
    euro, dollar = _euro_et_dollar(db_session)
    compte = creer_compte(db_session, "Voyage", monnaies=[(euro, 100.0), (dollar, 500.0)])
    _operation(db_session, compte, dollar, 200.0)

    data = routeur_dashboard.get_dashboard(annee=2026, mois=7, db=db_session)

    kpis = {k.monnaie_id: k for k in data.kpis}
    assert set(kpis) == {euro, dollar}
    assert kpis[euro].solde_total_courant == 100.0
    assert kpis[dollar].solde_total_courant == 300.0
    assert kpis[dollar].variation_previsionnelle == -200.0
    # Les cartes de compte, elles, portent toutes leurs monnaies à la fois.
    carte = next(c for c in data.comptes if c.id == compte.id)
    assert {s.monnaie_id for s in carte.soldes} == {euro, dollar}


def test_dashboard_ignore_une_monnaie_quaucun_compte_ne_porte(db_session):
    euro = get_monnaie_id(db_session)
    creer_monnaie(db_session, "Dollar", "$")
    creer_compte(db_session, "Courant", monnaies=[(euro, 100.0)])

    data = routeur_dashboard.get_dashboard(annee=2026, mois=7, db=db_session)

    assert [m.id for m in data.monnaies] == [euro]


# ---------- Placements ----------


def test_titre_cote_dans_une_monnaie_absente_du_compte_refuse(db_session):
    euro, dollar = _euro_et_dollar(db_session)
    compte = creer_compte(
        db_session, "PEA", type_nom="placements financiers", monnaies=[(euro, 1000.0)]
    )
    action = crud.create_action(db_session, "Apple", dollar, 200.0)

    with pytest.raises(HTTPException) as erreur:
        routeur_placements.create_operation_action(
            compte.id,
            schemas.OperationActionCreate(
                action_id=action.id,
                sens=SensAction.achat,
                quantite=2,
                prix_unitaire=180.0,
                date=date(2026, 7, 1),
            ),
            db_session,
        )

    assert erreur.value.status_code == 400
    assert "Dollar" in erreur.value.detail


def test_portefeuille_multi_monnaies_reste_separe(db_session):
    euro, dollar = _euro_et_dollar(db_session)
    compte = creer_compte(
        db_session,
        "CTO",
        type_nom="placements financiers",
        monnaies=[(euro, 1000.0), (dollar, 1000.0)],
    )
    air_liquide = crud.create_action(db_session, "Air Liquide", euro, 30.0)
    apple = crud.create_action(db_session, "Apple", dollar, 200.0)
    for action, prix in ((air_liquide, 25.0), (apple, 180.0)):
        crud.create_operation_action(
            db_session,
            compte_id=compte.id,
            action=action,
            sens=SensAction.achat,
            quantite=10,
            prix_unitaire=prix,
            date_operation=date(2026, 7, 1),
        )

    detail = routeur_placements.read_placement(compte.id, db_session)
    par_monnaie = {m.monnaie_id: m for m in detail.par_monnaie}

    # Euros : 1000 − 250 d'espèces, 10 titres à 30 en portefeuille.
    assert par_monnaie[euro].solde_espece == 750.0
    assert par_monnaie[euro].valorisation == 300.0
    assert par_monnaie[euro].montant_investi == 250.0
    # Dollars : 1000 − 1800 d'espèces (à découvert), 10 titres à 200.
    assert par_monnaie[dollar].solde_espece == -800.0
    assert par_monnaie[dollar].valorisation == 2000.0

    assert placements.valorisation_totale(db_session) == {euro: 300.0, dollar: 2000.0}


def test_changer_la_monnaie_dun_titre_deja_mouvemente_refuse(db_session):
    euro = get_monnaie_id(db_session)
    dollar = creer_monnaie(db_session, "Dollar", "$").id
    compte = creer_compte(
        db_session, "PEA", type_nom="placements financiers", monnaies=[(euro, 1000.0)]
    )
    action = crud.create_action(db_session, "Air Liquide", euro, 30.0)
    crud.create_operation_action(
        db_session,
        compte_id=compte.id,
        action=action,
        sens=SensAction.achat,
        quantite=10,
        prix_unitaire=25.0,
        date_operation=date(2026, 7, 1),
    )

    with pytest.raises(HTTPException) as erreur:
        routeur_actions.update_action(
            action.id, schemas.ActionUpdate(monnaie_id=dollar), db_session
        )

    assert erreur.value.status_code == 409


# ---------- Comptes ----------


def test_creer_un_compte_sans_monnaie_est_invalide(db_session):
    from pydantic import ValidationError

    with pytest.raises(ValidationError):
        schemas.CompteCreate(
            nom="Sans monnaie", type_id=get_type_compte_id(db_session, "courant"), monnaies=[]
        )


def test_creer_un_compte_avec_deux_fois_la_meme_monnaie_refuse(db_session):
    euro = get_monnaie_id(db_session)

    with pytest.raises(HTTPException) as erreur:
        routeur_comptes.create_compte(
            schemas.CompteCreate(
                nom="Doublon",
                type_id=get_type_compte_id(db_session, "courant"),
                monnaies=[
                    schemas.CompteMonnaieInput(monnaie_id=euro, solde_initial=0.0),
                    schemas.CompteMonnaieInput(monnaie_id=euro, solde_initial=10.0),
                ],
            ),
            db_session,
        )

    assert erreur.value.status_code == 400


def test_monnaie_principale_est_la_premiere_de_la_liste(db_session):
    """Elle sert de valeur par défaut à la saisie et aux lignes importées."""
    euro, dollar = _euro_et_dollar(db_session)
    compte = creer_compte(db_session, "Voyage", monnaies=[(dollar, 0.0), (euro, 0.0)])

    assert compte.monnaie_principale_id == dollar
    assert compte.monnaie_ids == {euro, dollar}
    assert isinstance(compte.monnaies[0], models.CompteMonnaie)
