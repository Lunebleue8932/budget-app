"""Le réglage « Totaux des projets : monnaies éteintes » (service_projets.totaux_par_monnaie).

Réglage éteint, les totaux sont ceux d'avant : une conversion n'est ni une dépense ni une entrée, et la monnaie
éteinte a sa ligne. Réglage allumé, les CONVERSIONS VERS UNE MONNAIE ÉTEINTE entrent dans le total de la
monnaie d'où l'on a converti (nettes des retours) : une monnaie éteinte a un solde nul, donc ce qui y a été
converti y a été dépensé, et la valeur dépensée là-bas est exactement celle qui a quitté la monnaie d'origine.
Les frais sont déjà dans la cascade, ils ne se comptent pas deux fois.
"""
from datetime import date

from app import crud, models, schemas
from app.constants import Sens, Statut

from .conftest import (
    charger_module_extension,
    creer_compte,
    creer_monnaie,
    get_categorie_id,
    get_monnaie_id,
    get_type_id,
)

service = charger_module_extension("projets-objectifs", "service_projets.py")


def _depense(db, compte, monnaie_id, montant):
    operation = models.Operation(
        compte_id=compte.id,
        date=date(2026, 8, 12),
        type_id=get_type_id(db, "classique"),
        categorie_id=get_categorie_id(db, "Autres"),
        nature="Courses",
        monnaie_id=monnaie_id,
        sens=Sens.depense,
        statut=Statut.reel,
        montant=montant,
        montant_du=0.0,
        montant_a_rembourser=0.0,
    )
    db.add(operation)
    db.commit()
    db.refresh(operation)
    return operation


def _change(db, compte, euro, franc, envoye, recu, frais=None):
    """Un change euros → francs sur le même compte, de `envoye` euros pour `recu` francs."""
    return crud.create_virement(
        db,
        schemas.VirementCreate(
            date=date(2026, 8, 10),
            compte_source_id=compte.id,
            compte_destination_id=compte.id,
            monnaie_id=euro,
            monnaie_destination_id=franc,
            montant=envoye + (frais or 0.0),
            montant_destination=recu,
            frais=frais,
            monnaie_frais_id=euro if frais else None,
        ),
        compte,
        compte,
    )


def _projet_avec(db, operations):
    projet = crud.create_sous_filtre(db, nom="Voyage")
    crud.ajouter_operations_au_sous_filtre(db, projet, [o.id for o in operations])
    return projet


def _scenario(db_session):
    euro = get_monnaie_id(db_session)
    franc = creer_monnaie(db_session, "Franc suisse", "CHF").id
    compte = creer_compte(db_session, "Wise", monnaies=[(euro, 0.0), (franc, 0.0)])
    achat_euros = _depense(db_session, compte, euro, 50.0)
    sortante, entrante = _change(db_session, compte, euro, franc, 100.0, 95.0, frais=1.0)
    achat_francs = _depense(db_session, compte, franc, 95.0)
    projet = _projet_avec(db_session, [achat_euros, sortante, entrante, achat_francs])
    return euro, franc, compte, projet


def _ligne(totaux, monnaie_id):
    return next(t for t in totaux if t["monnaie_id"] == monnaie_id)


def test_reglage_eteint_les_totaux_sont_ceux_d_avant(db_session):
    euro, franc, _, projet = _scenario(db_session)
    db_session.get(models.Monnaie, franc).active = False
    db_session.commit()

    totaux = service.totaux_par_monnaie(projet)

    # Euros : 50 de courses + 1 de frais ; le change lui-même n'est ni une dépense ni une entrée.
    assert (_ligne(totaux, euro)["depenses"], _ligne(totaux, euro)["conversions_eteintes"]) == (51.0, 0.0)
    assert _ligne(totaux, franc)["depenses"] == 95.0


def test_reglage_allume_la_conversion_vers_la_monnaie_eteinte_compte_dans_l_origine(db_session):
    euro, franc, _, projet = _scenario(db_session)
    db_session.get(models.Monnaie, franc).active = False
    db_session.commit()

    totaux = service.totaux_par_monnaie(projet, reporter_eteintes=True)

    ligne = _ligne(totaux, euro)
    # 50 de courses + 1 de frais + les 100 € envoyés pour être dépensés en francs : le voyage a coûté 151 €.
    assert ligne["depenses"] == 151.0
    assert ligne["conversions_eteintes"] == -100.0
    assert ligne["solde"] == -151.0
    # La ligne de la monnaie éteinte reste (c'est l'écran qui n'en montre pas le total), inchangée.
    assert _ligne(totaux, franc)["depenses"] == 95.0
    assert _ligne(totaux, franc)["conversions_eteintes"] == 0.0


def test_ce_qui_revient_de_la_monnaie_eteinte_se_retranche(db_session):
    euro, franc, compte, projet = _scenario(db_session)
    retour_sortante, retour_entrante = _change(db_session, compte, franc, euro, 20.0, 18.0)
    crud.ajouter_operations_au_sous_filtre(db_session, projet, [retour_sortante.id, retour_entrante.id])
    db_session.get(models.Monnaie, franc).active = False
    db_session.commit()

    ligne = _ligne(service.totaux_par_monnaie(projet, reporter_eteintes=True), euro)

    # UNE COLONNE PAR MONNAIE D'EN FACE, au net des deux sens : 100 € partis vers les francs, 18 € revenus
    # (le montant reçu, tel qu'enregistré) font 82 € de dépensés là-bas.
    assert ligne["conversions_eteintes"] == -82.0
    assert ligne["depenses"] == 51.0 + 82.0
    assert ligne["entrees"] == 0.0


def test_une_conversion_entre_deux_monnaies_allumees_n_est_pas_reportee(db_session):
    euro, franc, _, projet = _scenario(db_session)

    ligne = _ligne(service.totaux_par_monnaie(projet, reporter_eteintes=True), euro)

    # Le franc est allumé : l'argent est toujours là, rien n'a été dépensé par le change.
    assert (ligne["depenses"], ligne["conversions_eteintes"]) == (51.0, 0.0)


def test_le_suivi_du_montant_a_tenir_lit_les_totaux_reportes(db_session):
    euro, franc, _, projet = _scenario(db_session)
    projet.montant_max = 120.0
    projet.monnaie_cible_id = euro
    db_session.get(models.Monnaie, franc).active = False
    db_session.commit()

    sans = service.lire_sous_filtre(projet)["suivi"]
    avec = service.lire_sous_filtre(projet, reporter_eteintes=True)["suivi"]

    assert (sans["depenses"], sans["max_tenu"]) == (51.0, True)
    assert (avec["depenses"], avec["max_tenu"]) == (151.0, False)


def test_un_projet_qui_ne_porte_que_la_jambe_en_monnaie_eteinte_reporte_quand_meme(db_session):
    """La jambe en euros du change est relue en base : le projet n'a aucune opération en euros, et pourtant
    c'est en euros que tout le coût se lit, une fois le réglage allumé."""
    euro, franc, compte, _ = _scenario(db_session)
    seul = crud.create_sous_filtre(db_session, nom="Francs seulement")
    entrante = (
        db_session.query(models.Operation)
        .filter(models.Operation.monnaie_id == franc, models.Operation.sens == Sens.transfert_entrant)
        .one()
    )
    achat = (
        db_session.query(models.Operation)
        .filter(models.Operation.monnaie_id == franc, models.Operation.sens == Sens.depense)
        .one()
    )
    crud.ajouter_operations_au_sous_filtre(db_session, seul, [entrante.id, achat.id])
    db_session.get(models.Monnaie, franc).active = False
    db_session.commit()

    sans = service.totaux_par_monnaie(seul)
    avec = service.totaux_par_monnaie(seul, reporter_eteintes=True)

    assert [t["monnaie_id"] for t in sans] == [franc]
    ligne = _ligne(avec, euro)
    # Les 100 € changés, plus le 1 € de frais du virement (relu avec sa paire) : 101 €.
    assert (ligne["depenses"], ligne["conversions_eteintes"]) == (101.0, -100.0)
