"""Éteindre une monnaie d'un compte (migration 0053).

CE QUE ÇA RÉSOUT. Retirer une monnaie de la liste d'un compte est refusé dès
qu'une opération y est libellée — à juste titre, les montants perdraient le
solde qui les porte. Mais c'est exactement le cas de la monnaie dont on veut se
défaire : un compte ouvert un temps en dollars, soldé depuis, gardait son dollar
dans chaque menu de saisie et sur chaque carte, pour toujours.

L'EXTINCTION N'EST PAS UNE SUPPRESSION, et c'est ce que vérifient ces tests
d'un bout à l'autre : les opérations restent en base, lisibles et modifiables,
et rallumer rend tout tel quel. Ce qui change est ce que le compte PROPOSE.
"""
from datetime import date

import pytest
from fastapi import HTTPException

from app import models, schemas
from app.constants import Statut
from app.routers import comptes as routeur_comptes
from app.routers import operations as routeur_operations
from app.routers import virements as routeur_virements
from app.services import soldes

from .conftest import (
    creer_compte,
    creer_monnaie,
    get_categorie_id,
    get_monnaie_id,
    get_type_id,
)


def _euro_et_dollar(db):
    return get_monnaie_id(db), creer_monnaie(db, "Dollar", "$").id


def _compte_deux_monnaies(db, nom="CC", soldes_initiaux=(0.0, 0.0)):
    euro, dollar = _euro_et_dollar(db)
    compte = creer_compte(
        db, nom, monnaies=[(euro, soldes_initiaux[0]), (dollar, soldes_initiaux[1])]
    )
    return compte, euro, dollar


def _entrees(monnaies):
    """La liste des monnaies telle que l'écran la renvoie : l'état VOULU du
    compte, entier (cf. crud._appliquer_monnaies_compte)."""
    return [
        schemas.CompteMonnaieInput(
            monnaie_id=monnaie_id, solde_initial=solde, active=active
        )
        for monnaie_id, solde, active in monnaies
    ]


def _eteindre(db, compte, monnaie_a_eteindre, autres):
    """Éteint une monnaie en renvoyant la liste ENTIÈRE du compte, soldes
    initiaux compris — c'est ce que fait l'écran, et les remettre à zéro
    réécrirait l'historique du compte au passage."""
    initiaux = {lien.monnaie_id: lien.solde_initial for lien in compte.monnaies}
    return routeur_comptes.update_compte(
        compte.id,
        schemas.CompteUpdate(
            monnaies=_entrees(
                [(monnaie_id, initiaux.get(monnaie_id, 0.0), True) for monnaie_id in autres]
                + [(monnaie_a_eteindre, initiaux.get(monnaie_a_eteindre, 0.0), False)]
            )
        ),
        db,
    )


def _operation(db, compte, monnaie_id, montant, statut=Statut.reel):
    return routeur_operations.create_operation(
        schemas.OperationCreate(
            date=date(2026, 7, 1),
            compte_id=compte.id,
            monnaie_id=monnaie_id,
            type_id=get_type_id(db, "classique"),
            categorie_id=get_categorie_id(db, "Alimentaire"),
            nature="Courses",
            montant=montant,
            statut=statut,
        ),
        db,
    )


# ---------- Le geste lui-même ----------


def test_une_monnaie_soldee_s_eteint(db_session):
    compte, euro, dollar = _compte_deux_monnaies(db_session)

    lu = _eteindre(db_session, compte, dollar, [euro])

    etats = {m.monnaie_id: m.active for m in lu.monnaies}
    assert etats == {euro: True, dollar: False}


def test_une_monnaie_qui_porte_encore_de_l_argent_ne_s_eteint_pas(db_session):
    """LA GARDE CENTRALE. Une monnaie éteinte disparaît des soldes affichés :
    l'éteindre alors qu'elle porte encore quelque chose ferait disparaître ce
    montant de tous les totaux sans qu'aucune opération n'ait bougé."""
    compte, euro, dollar = _compte_deux_monnaies(db_session, soldes_initiaux=(0.0, 250.0))

    with pytest.raises(HTTPException) as erreur:
        _eteindre(db_session, compte, dollar, [euro])
    assert erreur.value.status_code == 409
    assert "Dollar" in erreur.value.detail


def test_une_operation_previsionnelle_empeche_aussi_d_eteindre(db_session):
    """Le projeté compte autant que le réel : une monnaie dont le solde réel est
    nul mais qui attend un mouvement n'est pas soldée."""
    compte, euro, dollar = _compte_deux_monnaies(db_session)
    _operation(db_session, compte, dollar, 40.0, statut=Statut.previsionnel)

    with pytest.raises(HTTPException) as erreur:
        _eteindre(db_session, compte, dollar, [euro])
    assert erreur.value.status_code == 409


def test_une_monnaie_soldee_par_ses_operations_s_eteint(db_session):
    """Le cas normal : le compte a vécu en dollars, il est revenu à zéro."""
    compte, euro, dollar = _compte_deux_monnaies(db_session, soldes_initiaux=(0.0, 100.0))
    _operation(db_session, compte, dollar, 100.0)

    lu = _eteindre(db_session, compte, dollar, [euro])
    assert {m.monnaie_id: m.active for m in lu.monnaies}[dollar] is False


def test_un_compte_ne_peut_pas_eteindre_toutes_ses_monnaies(db_session):
    """Toutes éteintes, il ne pourrait plus recevoir la moindre opération et
    `monnaie_principale_id` n'aurait rien à rendre."""
    compte, euro, dollar = _compte_deux_monnaies(db_session)

    with pytest.raises(HTTPException) as erreur:
        routeur_comptes.update_compte(
            compte.id,
            schemas.CompteUpdate(
                monnaies=_entrees([(euro, 0.0, False), (dollar, 0.0, False)])
            ),
            db_session,
        )
    assert erreur.value.status_code == 400


def test_rallumer_ne_demande_rien(db_session):
    """Rallumer est le geste qui rend visible, jamais celui qui cache : aucune
    condition à remplir."""
    compte, euro, dollar = _compte_deux_monnaies(db_session)
    _eteindre(db_session, compte, dollar, [euro])

    lu = routeur_comptes.update_compte(
        compte.id,
        schemas.CompteUpdate(monnaies=_entrees([(euro, 0.0, True), (dollar, 0.0, True)])),
        db_session,
    )
    assert all(m.active for m in lu.monnaies)


# ---------- « Tout se passe comme s'il n'y avait plus la monnaie » ----------


def test_une_operation_dans_une_monnaie_eteinte_est_refusee(db_session):
    compte, euro, dollar = _compte_deux_monnaies(db_session)
    _eteindre(db_session, compte, dollar, [euro])
    db_session.refresh(compte)

    with pytest.raises(HTTPException) as erreur:
        _operation(db_session, compte, dollar, 10.0)
    assert erreur.value.status_code == 400
    # Le message ne propose que ce qui est encore possible.
    assert "Dollar" not in erreur.value.detail


def test_un_virement_vers_une_monnaie_eteinte_est_refuse(db_session):
    compte, euro, dollar = _compte_deux_monnaies(db_session)
    autre = creer_compte(db_session, "Autre", monnaies=[(euro, 500.0)])
    _eteindre(db_session, compte, dollar, [euro])
    db_session.refresh(compte)

    with pytest.raises(HTTPException) as erreur:
        routeur_virements.create_virement(
            schemas.VirementCreate(
                date=date(2026, 7, 2),
                compte_source_id=autre.id,
                compte_destination_id=compte.id,
                monnaie_id=euro,
                monnaie_destination_id=dollar,
                montant=50.0,
                montant_destination=55.0,
            ),
            db_session,
        )
    assert erreur.value.status_code == 400


def test_la_monnaie_principale_saute_une_monnaie_eteinte(db_session):
    """C'est elle que l'import retient pour une ligne dont le fichier ne dit pas
    la devise : éteindre la première monnaie d'un compte fait passer la suivante
    en tête, sans avoir à réordonner la liste."""
    compte, euro, dollar = _compte_deux_monnaies(db_session)
    assert compte.monnaie_principale_id == euro

    routeur_comptes.update_compte(
        compte.id,
        schemas.CompteUpdate(monnaies=_entrees([(euro, 0.0, False), (dollar, 0.0, True)])),
        db_session,
    )
    db_session.refresh(compte)
    assert compte.monnaie_principale_id == dollar


def test_monnaie_ids_ecarte_les_eteintes_mais_pas_monnaie_ids_toutes(db_session):
    """Les deux questions ne sont pas la même : ce que le compte ACCEPTE, et ce
    qu'il a PORTÉ."""
    compte, euro, dollar = _compte_deux_monnaies(db_session)
    _eteindre(db_session, compte, dollar, [euro])
    db_session.refresh(compte)

    assert compte.monnaie_ids == {euro}
    assert compte.monnaie_ids_toutes == {euro, dollar}


# ---------- Les soldes : le présent se nettoie, l'historique reste ----------


def test_une_monnaie_eteinte_et_soldee_disparait_des_soldes(db_session):
    compte, euro, dollar = _compte_deux_monnaies(db_session)
    _eteindre(db_session, compte, dollar, [euro])

    resultat = next(
        item for item in soldes.get_soldes_comptes(db_session) if item["compte"].id == compte.id
    )
    assert set(resultat["soldes"]) == {euro}


def test_elle_reparait_sur_une_periode_ou_le_compte_portait_encore_des_montants(db_session):
    """L'HISTORIQUE NE SE RÉÉCRIT PAS. Le compte a porté 100 $ jusqu'en juillet :
    un « Total des avoirs » arrêté en juin doit continuer de les compter, même si
    la monnaie a été éteinte depuis."""
    compte, euro, dollar = _compte_deux_monnaies(db_session, soldes_initiaux=(0.0, 100.0))
    _operation(db_session, compte, dollar, 100.0)  # daté du 1er juillet : solde à zéro
    _eteindre(db_session, compte, dollar, [euro])

    juin = next(
        item
        for item in soldes.get_soldes_comptes(db_session, date_fin=date(2026, 6, 30))
        if item["compte"].id == compte.id
    )
    assert juin["soldes"][dollar]["solde_projete"] == 100.0


def test_l_ecran_des_comptes_voit_encore_la_monnaie_eteinte(db_session):
    """C'est de cette liste-là qu'on la rallume : l'effacer partout la rendrait
    impossible à retrouver."""
    compte, euro, dollar = _compte_deux_monnaies(db_session)
    _eteindre(db_session, compte, dollar, [euro])

    lu = routeur_comptes.read_compte(compte.id, db_session)
    assert {m.monnaie_id for m in lu.monnaies} == {euro, dollar}


# ---------- Rien n'est perdu ----------


def test_les_operations_d_une_monnaie_eteinte_restent_en_base(db_session):
    compte, euro, dollar = _compte_deux_monnaies(db_session, soldes_initiaux=(0.0, 60.0))
    operation = _operation(db_session, compte, dollar, 60.0)
    _eteindre(db_session, compte, dollar, [euro])

    encore_la = db_session.get(models.Operation, operation.id)
    assert encore_la is not None
    assert encore_la.monnaie_id == dollar
    assert encore_la.montant == 60.0


def test_retirer_une_monnaie_utilisee_reste_refuse_et_nomme_l_extinction(db_session):
    """Le refus qui a rendu l'extinction nécessaire : son message doit dire par
    où sortir, sans quoi il ne laisse que la suppression de l'historique."""
    compte, euro, dollar = _compte_deux_monnaies(db_session, soldes_initiaux=(0.0, 60.0))
    _operation(db_session, compte, dollar, 60.0)

    with pytest.raises(HTTPException) as erreur:
        routeur_comptes.update_compte(
            compte.id,
            schemas.CompteUpdate(monnaies=_entrees([(euro, 0.0, True)])),
            db_session,
        )
    assert erreur.value.status_code == 409
    assert "éteins" in erreur.value.detail


def test_les_monnaies_sont_allumees_par_defaut(db_session):
    """Rien ne change pour une base existante ni pour un compte neuf : le champ
    est True par défaut, de la colonne jusqu'au schéma d'entrée."""
    compte, euro, dollar = _compte_deux_monnaies(db_session)
    assert all(lien.active for lien in compte.monnaies)
    assert schemas.CompteMonnaieInput(monnaie_id=euro).active is True
