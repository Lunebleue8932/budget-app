"""Les prêts reçus : ce qu'ils coûtent, et où ce coût apparaît.

UN PRÊT N'EST PAS UN REVENU. L'argent arrive bien sur le compte — c'est une
entrée, et le solde réel monte — mais il faudra le rendre. Ce qu'un prêt coûte
vraiment, c'est ce qu'on rendra EN PLUS de ce qu'on a reçu : `montant_du -
montant`, ses intérêts.

D'OÙ UNE BORNE À L'ENVERS DE CELLE DES DÉPENSES REMBOURSABLES. Sur une dépense
remboursable, `montant_du` est ce qu'on nous rendra : au plus ce qu'on a avancé.
Sur un prêt, c'est ce qu'on rendra : au moins ce qu'on a reçu. Les deux règles
sont exactement inverses, et c'est pour cela qu'elles ne tiennent pas dans
schemas.OperationBase, qui ne connaît du type que son `type_id`
(cf. crud.erreur_montant_du).
"""
from datetime import date

import pytest
from fastapi import HTTPException

from app import crud, extensions, models, schemas
from app.constants import Sens, Statut
from app.routers.operations import create_operation as route_create_operation
from app.routers.operations import update_operation as route_update_operation
from app.services import soldes

from .conftest import creer_compte, get_categorie_id, get_monnaie_id, get_type_id


def _make_compte(db, nom="Courant"):
    return creer_compte(db, nom)


def test_pret_est_une_entree_remboursable(db_session):
    compte = _make_compte(db_session)
    pret = crud.create_operation(
        db_session,
        schemas.OperationCreate(
            date=date(2026, 7, 1),
            compte_id=compte.id,
            monnaie_id=get_monnaie_id(db_session),
            type_id=get_type_id(db_session, "pret"),
            nature="Prêt de Paul",
            montant=200.0,
            statut=Statut.reel,
        ),
    )

    assert pret.sens == Sens.entree
    assert pret.remboursable is True
    assert pret.montant_du == 200.0
    assert pret.montant_a_rembourser == 200.0


def test_pret_porte_ses_interets(db_session):
    """On emprunte 1 000, on en rendra 1 100 : les 100 d'écart sont les intérêts.

    C'est ce que le schéma refusait jusqu'ici — il appliquait aux prêts la règle
    des dépenses remboursables (`montant_du <= montant`), et un prêt ne pouvait
    donc porter aucun intérêt."""
    compte = _make_compte(db_session)
    pret = crud.create_operation(
        db_session,
        schemas.OperationCreate(
            date=date(2026, 7, 1),
            compte_id=compte.id,
            monnaie_id=get_monnaie_id(db_session),
            type_id=get_type_id(db_session, "pret"),
            nature="Prêt de Paul",
            montant=1000.0,
            statut=Statut.reel,
            montant_du=1100.0,
        ),
    )

    assert pret.montant_du == 1100.0
    # Ce qu'il reste à rembourser part de ce qu'on doit, intérêts compris : la
    # dette n'est éteinte qu'une fois les 1 100 rendus, pas les 1 000 reçus.
    assert pret.montant_a_rembourser == 1100.0


def test_pret_sans_montant_du_ne_porte_aucun_interet(db_session):
    """Le cas courant reste celui d'un prêt sans intérêts : ne rien préciser
    revient à rendre exactement ce qu'on a reçu."""
    compte = _make_compte(db_session)
    pret = crud.create_operation(
        db_session,
        schemas.OperationCreate(
            date=date(2026, 7, 1),
            compte_id=compte.id,
            monnaie_id=get_monnaie_id(db_session),
            type_id=get_type_id(db_session, "pret"),
            nature="Prêt de Paul",
            montant=200.0,
            statut=Statut.reel,
        ),
    )

    assert pret.montant_du == 200.0
    assert pret.montant_a_rembourser == 200.0


def test_pret_refuse_de_rendre_moins_que_recu(db_session):
    compte = _make_compte(db_session)
    with pytest.raises(HTTPException) as erreur:
        route_create_operation(
            schemas.OperationCreate(
                date=date(2026, 7, 1),
                compte_id=compte.id,
                monnaie_id=get_monnaie_id(db_session),
                type_id=get_type_id(db_session, "pret"),
                nature="Prêt de Paul",
                montant=200.0,
                statut=Statut.reel,
                montant_du=50.0,
            ),
            db_session,
        )
    assert erreur.value.status_code == 400
    assert "au moins" in erreur.value.detail


def test_depense_remboursable_refuse_de_rendre_plus_que_paye(db_session):
    """La borne de l'autre type n'a pas bougé en devenant type-dépendante."""
    compte = _make_compte(db_session)
    with pytest.raises(HTTPException) as erreur:
        route_create_operation(
            schemas.OperationCreate(
                date=date(2026, 7, 1),
                compte_id=compte.id,
                monnaie_id=get_monnaie_id(db_session),
                type_id=get_type_id(db_session, "remboursable"),
                categorie_id=get_categorie_id(db_session, "Alimentaire"),
                nature="Restaurant partagé",
                montant=100.0,
                statut=Statut.reel,
                montant_du=150.0,
            ),
            db_session,
        )
    assert erreur.value.status_code == 400


def test_reclasser_une_depense_remboursable_en_pret_retourne_la_borne(db_session):
    """Une dépense de 100 dont on attend 40 devient un prêt : rendre 40 de ce
    qu'on a reçu 100 n'a pas de sens. C'est REFUSÉ, pas corrigé en silence — le
    montant dû est un chiffre que l'utilisateur a sous les yeux, et le déplacer
    à sa place lui ferait enregistrer une somme qu'il n'a pas saisie. Le
    formulaire pose d'ailleurs la même borne avant l'envoi (majBornesMontantDu).
    """
    compte = _make_compte(db_session)
    depense = crud.create_operation(
        db_session,
        schemas.OperationCreate(
            date=date(2026, 7, 1),
            compte_id=compte.id,
            monnaie_id=get_monnaie_id(db_session),
            type_id=get_type_id(db_session, "remboursable"),
            categorie_id=get_categorie_id(db_session, "Alimentaire"),
            nature="Facture partagée",
            montant=100.0,
            statut=Statut.reel,
            montant_du=40.0,
        ),
    )
    assert depense.montant_du == 40.0

    with pytest.raises(HTTPException) as erreur:
        route_update_operation(
            depense.id,
            schemas.OperationUpdate(type_id=get_type_id(db_session, "pret")),
            db_session,
        )
    assert erreur.value.status_code == 400

    # Avec le montant dû corrigé, le reclassement passe.
    resultat = route_update_operation(
        depense.id,
        schemas.OperationUpdate(
            type_id=get_type_id(db_session, "pret"), montant_du=110.0
        ),
        db_session,
    )
    assert resultat.montant_du == 110.0
    assert resultat.montant_a_rembourser == 110.0


def test_reclasser_une_operation_classique_en_pret_ne_demande_rien(db_session):
    """Un type non remboursable ne porte AUCUN montant dû (0.0, un remplissage).
    Le reclasser en prêt sans rien préciser doit poser le montant entier, pas
    buter sur un zéro que personne n'a saisi."""
    compte = _make_compte(db_session)
    operation = crud.create_operation(
        db_session,
        schemas.OperationCreate(
            date=date(2026, 7, 1),
            compte_id=compte.id,
            monnaie_id=get_monnaie_id(db_session),
            type_id=get_type_id(db_session, "classique"),
            categorie_id=get_categorie_id(db_session, "Alimentaire"),
            nature="Virement de Paul",
            montant=800.0,
            statut=Statut.reel,
        ),
    )

    resultat = route_update_operation(
        operation.id,
        schemas.OperationUpdate(type_id=get_type_id(db_session, "pret")),
        db_session,
    )

    assert resultat.montant_du == 800.0
    assert resultat.montant_a_rembourser == 800.0


def _pret_avec_interets(db, compte, montant=1000.0, montant_du=1100.0):
    return crud.create_operation(
        db,
        schemas.OperationCreate(
            date=date(2026, 7, 1),
            compte_id=compte.id,
            monnaie_id=get_monnaie_id(db),
            type_id=get_type_id(db, "pret"),
            nature="Prêt de Paul",
            montant=montant,
            statut=Statut.reel,
            montant_du=montant_du,
        ),
    )


def test_les_interets_pesent_sur_les_sorties_et_rien_dautre(db_session):
    """Emprunter n'est ni un revenu ni une dépense : seuls les intérêts coûtent.

    1 000 reçus, 1 100 à rendre — l'app doit annoncer 100 de sorties et ZÉRO
    entrée, alors même que l'opération porte `sens = entrée`."""
    compte = _make_compte(db_session)
    _pret_avec_interets(db_session, compte)

    flux = soldes.get_flux_periode(db_session, 2026, 7, get_monnaie_id(db_session))

    assert flux["entrees"] == pytest.approx(0.0)
    assert flux["sorties"] == pytest.approx(100.0)


def test_les_interets_forment_leur_propre_barre_dhistogramme(db_session):
    """L'histogramme doit dire la même chose que le total des sorties. Un prêt
    ne portant aucune catégorie, ses intérêts ne peuvent tomber dans aucune
    barre existante : ils en forment une à eux."""
    compte = _make_compte(db_session)
    _pret_avec_interets(db_session, compte)

    barres = soldes.get_depenses_par_categorie(
        db_session, 2026, 7, get_monnaie_id(db_session)
    )
    interets = [b for b in barres if b["categorie"] == "Intérêts de prêts"]

    assert len(interets) == 1
    assert interets[0]["total_previsionnel"] == pytest.approx(100.0)
    # Pas de budget : on ne se fixe pas une enveloppe d'intérêts, on les subit.
    assert interets[0]["budget_alloue"] == 0.0
    # Et les deux chiffres du dashboard tombent d'accord.
    total_barres = sum(b["total_previsionnel"] for b in barres)
    sorties = soldes.get_flux_periode(db_session, 2026, 7, get_monnaie_id(db_session))[
        "sorties"
    ]
    assert total_barres == pytest.approx(sorties)


def test_sans_lextension_un_pret_ne_pese_nulle_part(db_session, monkeypatch):
    """L'extension « Prêts » commande le CALCUL autant que l'écran : sans elle,
    aucun écran n'expliquerait d'où sortent ces intérêts, et une barre sans rien
    en face creuserait un écart au lieu d'en combler un."""
    compte = _make_compte(db_session)
    _pret_avec_interets(db_session, compte)

    monkeypatch.setattr(extensions, "est_active", lambda extension_id: extension_id != "prets")

    flux = soldes.get_flux_periode(db_session, 2026, 7, get_monnaie_id(db_session))
    barres = soldes.get_depenses_par_categorie(
        db_session, 2026, 7, get_monnaie_id(db_session)
    )

    assert flux["sorties"] == pytest.approx(0.0)
    assert [b for b in barres if b["categorie"] == "Intérêts de prêts"] == []


def test_le_solde_projete_retient_les_interets(db_session):
    """Le solde réel monte de ce qu'on a reçu ; le projeté, lui, retire tout ce
    qu'on devra rendre — intérêts compris, puisque c'est ce qu'on rendra."""
    compte = _make_compte(db_session)
    _pret_avec_interets(db_session, compte)

    ligne = next(
        item for item in soldes.get_soldes_comptes(db_session) if item["compte"].id == compte.id
    )
    solde = ligne["soldes"][get_monnaie_id(db_session)]

    assert solde["solde_reel"] == pytest.approx(1000.0)
    assert solde["solde_projete"] == pytest.approx(-100.0)


def test_remboursement_pret_reduit_le_montant_a_rembourser(db_session):
    compte = _make_compte(db_session)
    pret = crud.create_operation(
        db_session,
        schemas.OperationCreate(
            date=date(2026, 7, 1),
            compte_id=compte.id,
            monnaie_id=get_monnaie_id(db_session),
            type_id=get_type_id(db_session, "pret"),
            nature="Prêt de Paul",
            montant=200.0,
            statut=Statut.reel,
        ),
    )

    remboursement = crud.create_operation(
        db_session,
        schemas.OperationCreate(
            date=date(2026, 7, 10),
            compte_id=compte.id,
            monnaie_id=get_monnaie_id(db_session),
            type_id=get_type_id(db_session, "remboursement_pret"),
            nature="Remboursement à Paul",
            montant=80.0,
            statut=Statut.reel,
            operations_remboursees=[
                schemas.OperationRembourseeInput(operation_id=pret.id, montant=80.0)
            ],
        ),
    )

    db_session.refresh(pret)
    assert pret.montant_a_rembourser == 120.0
    # Un remboursement de prêt est une sortie d'argent, jamais une entrée.
    assert remboursement.sens == Sens.depense
    assert remboursement.remboursable is False


def test_remboursement_pret_partiel_multiple(db_session):
    compte = _make_compte(db_session)
    pret = crud.create_operation(
        db_session,
        schemas.OperationCreate(
            date=date(2026, 7, 1),
            compte_id=compte.id,
            monnaie_id=get_monnaie_id(db_session),
            type_id=get_type_id(db_session, "pret"),
            nature="Prêt de Paul",
            montant=200.0,
            statut=Statut.reel,
        ),
    )

    crud.create_operation(
        db_session,
        schemas.OperationCreate(
            date=date(2026, 7, 10),
            compte_id=compte.id,
            monnaie_id=get_monnaie_id(db_session),
            type_id=get_type_id(db_session, "remboursement_pret"),
            nature="Premier versement",
            montant=80.0,
            statut=Statut.reel,
            operations_remboursees=[
                schemas.OperationRembourseeInput(operation_id=pret.id, montant=80.0)
            ],
        ),
    )
    crud.create_operation(
        db_session,
        schemas.OperationCreate(
            date=date(2026, 7, 20),
            compte_id=compte.id,
            monnaie_id=get_monnaie_id(db_session),
            type_id=get_type_id(db_session, "remboursement_pret"),
            nature="Solde",
            montant=120.0,
            statut=Statut.reel,
            operations_remboursees=[
                schemas.OperationRembourseeInput(operation_id=pret.id, montant=120.0)
            ],
        ),
    )

    db_session.refresh(pret)
    assert pret.montant_a_rembourser == 0.0
