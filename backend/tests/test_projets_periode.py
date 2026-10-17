"""La période et le montant à tenir d'un projet (migration 0084).

CE QUE CES TESTS VERROUILLENT :

  - LA PÉRIODE NE FILTRE RIEN : un projet reste les opérations qu'on y a versées, ses totaux ne bougent pas ;
  - LA PHASE ET LES JOURS RESTANTS suivent la date du jour (à venir / en cours / terminé), une date de fin
    seule est une deadline ;
  - LE MAXIMUM SE COMPARE AUX DÉPENSES, LE MINIMUM AUX ENTRÉES, dans la seule monnaie visée ;
  - UN CENTIME DE TOLÉRANCE : « 500 € dépensés sur 500 € » est tenu ;
  - LE FORMULAIRE REMPLACE TOUT : renvoyer None efface une date ou un montant ;
  - UNE FIN AVANT LE DÉBUT EST REFUSÉE ; SANS MONTANT, LA MONNAIE EST EFFACÉE ; AVEC UN MONTANT ET SANS MONNAIE,
    C'EST LA PREMIÈRE.
"""
from datetime import date

import pytest
from fastapi import HTTPException
from pydantic import ValidationError

from app import crud, models, schemas
from app.constants import Sens

from .conftest import charger_module_extension, creer_compte, creer_monnaie, get_categorie_id, get_monnaie_id
from .test_projets import _operation

service = charger_module_extension("projets-objectifs", "service_projets.py")
routeur = charger_module_extension("projets-objectifs", "routeur_projets.py")


def _projet(db, **champs):
    return crud.create_sous_filtre(db, nom=champs.pop("nom", "Voyage"), **champs)


def test_la_periode_ne_filtre_aucune_operation(db_session):
    compte = creer_compte(db_session, "Courant")
    hors_periode = _operation(db_session, compte, 80.0, date=date(2025, 1, 1))
    projet = _projet(db_session, date_debut=date(2026, 8, 1), date_fin=date(2026, 8, 31))
    crud.ajouter_operations_au_sous_filtre(db_session, projet, [hors_periode.id])
    lu = service.lire_sous_filtre(projet)
    assert lu["nombre_operations"] == 1
    assert lu["totaux"][0]["depenses"] == pytest.approx(80.0)


@pytest.mark.parametrize(
    "debut,fin,aujourdhui,phase,restants",
    [
        (date(2026, 8, 1), date(2026, 8, 31), date(2026, 7, 1), "a_venir", 61),
        (date(2026, 8, 1), date(2026, 8, 31), date(2026, 8, 10), "en_cours", 21),
        (date(2026, 8, 1), date(2026, 8, 31), date(2026, 9, 2), "termine", 0),
        (None, date(2026, 8, 31), date(2026, 8, 10), "en_cours", 21),
        (date(2026, 8, 1), None, date(2026, 8, 10), "en_cours", None),
        (None, None, date(2026, 8, 10), None, None),
    ],
)
def test_phase_et_jours_restants(db_session, debut, fin, aujourdhui, phase, restants):
    projet = _projet(db_session, date_debut=debut, date_fin=fin)
    assert service.periode_du_projet(projet, aujourdhui) == (phase, restants)


def test_le_maximum_se_compare_aux_depenses_et_le_minimum_aux_entrees(db_session):
    compte = creer_compte(db_session, "Courant")
    sortie = _operation(db_session, compte, 300.0, sens=Sens.depense)
    # Une entrée rangée dans la catégorie d'une dépense la DIMINUE (cf. totaux_par_monnaie) : pour compter
    # comme entrée, elle va dans une catégorie d'entrée.
    entree = _operation(
        db_session, compte, 120.0, sens=Sens.entree, nature="Salaire",
        categorie_id=get_categorie_id(db_session, "Entrées d'argent"),
    )
    projet = _projet(
        db_session, montant_max=250.0, montant_min=100.0, monnaie_cible_id=get_monnaie_id(db_session)
    )
    crud.ajouter_operations_au_sous_filtre(db_session, projet, [sortie.id, entree.id])
    suivi = service.lire_sous_filtre(projet)["suivi"]
    assert suivi["depenses"] == pytest.approx(300.0)
    assert suivi["entrees"] == pytest.approx(120.0)
    assert suivi["max_tenu"] is False
    assert suivi["min_atteint"] is True


def test_un_centime_de_tolerance(db_session):
    compte = creer_compte(db_session, "Courant")
    sortie = _operation(db_session, compte, 500.0)
    projet = _projet(db_session, montant_max=500.0, monnaie_cible_id=get_monnaie_id(db_session))
    crud.ajouter_operations_au_sous_filtre(db_session, projet, [sortie.id])
    assert service.lire_sous_filtre(projet)["suivi"]["max_tenu"] is True


def test_sans_montant_pas_de_suivi(db_session):
    assert service.lire_sous_filtre(_projet(db_session))["suivi"] is None


def test_un_projet_sans_operation_dans_la_monnaie_visee_est_a_zero(db_session):
    compte = creer_compte(db_session, "Courant")
    autre = creer_monnaie(db_session, "Franc suisse", "CHF")
    sortie = _operation(db_session, compte, 900.0)
    projet = _projet(db_session, montant_max=100.0, monnaie_cible_id=autre.id)
    crud.ajouter_operations_au_sous_filtre(db_session, projet, [sortie.id])
    suivi = service.lire_sous_filtre(projet)["suivi"]
    assert suivi["depenses"] == 0.0 and suivi["max_tenu"] is True


def test_le_formulaire_remplace_tout_et_none_efface(db_session):
    projet = _projet(
        db_session,
        date_debut=date(2026, 8, 1),
        date_fin=date(2026, 8, 31),
        montant_max=500.0,
        monnaie_cible_id=get_monnaie_id(db_session),
    )
    crud.update_sous_filtre(
        db_session, projet, nom="Voyage", description="", date_debut=None, date_fin=date(2026, 9, 30),
        montant_max=None, montant_min=None, monnaie_cible_id=None,
    )
    assert projet.date_debut is None and projet.date_fin == date(2026, 9, 30)
    assert projet.montant_max is None and projet.monnaie_cible_id is None


def test_une_fin_avant_le_debut_est_refusee():
    with pytest.raises(ValidationError):
        schemas.SousFiltreCreate(nom="x", date_debut=date(2026, 9, 1), date_fin=date(2026, 8, 1))
    schemas.SousFiltreCreate(nom="x", date_fin=date(2026, 8, 1))
    schemas.SousFiltreCreate(nom="x", date_debut=date(2026, 8, 1))


def test_la_monnaie_suit_les_montants(db_session):
    premiere = db_session.query(models.Monnaie).order_by(models.Monnaie.id).first()
    avec_montant = routeur._periode_et_montants(db_session, schemas.SousFiltreCreate(nom="a", montant_max=10.0))
    assert avec_montant["monnaie_cible_id"] == premiere.id
    sans_montant = routeur._periode_et_montants(
        db_session, schemas.SousFiltreCreate(nom="b", monnaie_cible_id=premiere.id)
    )
    assert sans_montant["monnaie_cible_id"] is None
    with pytest.raises(HTTPException):
        routeur._periode_et_montants(
            db_session, schemas.SousFiltreCreate(nom="c", montant_min=5.0, monnaie_cible_id=99999)
        )
