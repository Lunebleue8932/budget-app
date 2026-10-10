"""Un modèle récurrent est toujours prévisionnel : un modèle RÉEL passe la main
(crud.scinder_modele_recurrent).

  - L'AVENIR : la première occurrence encore prévisionnelle devient le nouveau modèle,
    reprend fréquence et fin, et les occurrences suivantes ;
  - LE PASSÉ reste réel et RATTACHÉ : l'ancien modèle et les occurrences réelles deviennent
    des occurrences du nouveau modèle ;
  - sans occurrence prévisionnelle, un nouveau modèle naît à la date suivante ;
  - une récurrence terminée n'est pas touchée ;
  - marquer un modèle payé lui fait passer la main aussitôt.
"""
from datetime import date

from app import crud, models, schemas
from app.constants import Frequence, Sens, Statut

from .conftest import creer_compte, get_categorie_id, get_monnaie_id, get_type_id


def _modele(db, compte, jour, statut=Statut.reel, fin=None):
    op = models.Operation(
        compte_id=compte.id, date=jour, type_id=get_type_id(db, "classique"),
        categorie_id=get_categorie_id(db, "Autres"), nature="Loyer",
        monnaie_id=get_monnaie_id(db), sens=Sens.depense, statut=statut, montant=500,
        montant_du=0.0, montant_a_rembourser=0.0, recurrente=True,
        frequence=Frequence.mensuelle, recurrence_fin=fin,
    )
    db.add(op)
    db.commit()
    return op


def _enfant(db, modele, jour, statut):
    op = models.Operation(
        compte_id=modele.compte_id, date=jour, type_id=modele.type_id,
        categorie_id=modele.categorie_id, nature="Loyer", monnaie_id=modele.monnaie_id,
        sens=Sens.depense, statut=statut, montant=500, montant_du=0.0,
        montant_a_rembourser=0.0, recurrente=True, recurrence_parent_id=modele.id,
        recurrence_date_prevue=jour,
    )
    db.add(op)
    db.commit()
    return op


def test_un_modele_reel_se_dedouble_sur_sa_premiere_occurrence_prevue(db_session):
    compte = creer_compte(db_session, "Courant")
    modele = _modele(db_session, compte, date(2026, 7, 25))
    aout = _enfant(db_session, modele, date(2026, 8, 25), Statut.reel)
    septembre = _enfant(db_session, modele, date(2026, 9, 25), Statut.previsionnel)
    octobre = _enfant(db_session, modele, date(2026, 10, 25), Statut.previsionnel)

    nouveau = crud.scinder_modele_recurrent(db_session, modele)

    assert nouveau.id == septembre.id
    assert (nouveau.recurrente, nouveau.recurrence_parent_id, nouveau.frequence) == (
        True, None, Frequence.mensuelle,
    )
    assert octobre.recurrence_parent_id == septembre.id
    # LE PASSÉ GARDE LE LIEN avec la récurrence qui le dicte.
    assert (modele.recurrence_parent_id, modele.frequence, modele.statut) == (
        septembre.id, None, Statut.reel,
    )
    assert modele.recurrence_date_prevue == date(2026, 7, 25)
    assert (aout.recurrence_parent_id, aout.statut) == (septembre.id, Statut.reel)


def test_sans_occurrence_prevue_un_modele_nait_a_la_date_suivante(db_session):
    compte = creer_compte(db_session, "Courant")
    modele = _modele(db_session, compte, date(2026, 7, 25))

    nouveau = crud.scinder_modele_recurrent(db_session, modele)

    assert nouveau.date == date(2026, 8, 25)
    assert (nouveau.statut, nouveau.recurrente) == (Statut.previsionnel, True)


def test_une_recurrence_terminee_n_est_pas_touchee(db_session):
    compte = creer_compte(db_session, "Courant")
    modele = _modele(db_session, compte, date(2026, 7, 25), fin=date(2026, 8, 1))
    assert crud.scinder_modele_recurrent(db_session, modele) is None
    assert (modele.recurrente, modele.frequence) == (True, Frequence.mensuelle)


def test_une_base_d_avant_la_regle_est_convertie_a_la_lecture(db_session):
    compte = creer_compte(db_session, "Courant")
    modele = _modele(db_session, compte, date(2026, 7, 25))
    crud.generer_occurrences_recurrentes(db_session)
    reels_recurrents = (
        db_session.query(models.Operation)
        .filter(
            models.Operation.recurrente.is_(True),
            models.Operation.recurrence_parent_id.is_(None),
            models.Operation.statut == Statut.reel,
        )
        .count()
    )
    assert reels_recurrents == 0
    assert modele.recurrence_parent_id is not None


def test_marquer_un_modele_paye_le_dedouble(db_session):
    compte = creer_compte(db_session, "Courant")
    modele = _modele(db_session, compte, date(2026, 7, 25), statut=Statut.previsionnel)
    septembre = _enfant(db_session, modele, date(2026, 8, 25), Statut.previsionnel)

    crud.update_operation(db_session, modele, schemas.OperationUpdate(statut=Statut.reel))

    db_session.refresh(septembre)
    assert (septembre.recurrente, septembre.recurrence_parent_id) == (True, None)
    assert (modele.statut, modele.recurrence_parent_id) == (Statut.reel, septembre.id)
