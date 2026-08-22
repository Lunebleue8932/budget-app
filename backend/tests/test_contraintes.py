from datetime import date

import pytest
from sqlalchemy.exc import IntegrityError

from app import models
from app.constants import Sens, Statut

from .conftest import creer_compte, get_monnaie_id, get_type_id


def test_categorie_id_inexistante_rejetee_par_la_base(db_session):
    compte = creer_compte(db_session, "Courant")

    operation = models.Operation(
        compte_id=compte.id,
        date=date(2026, 7, 1),
        type_id=get_type_id(db_session, "classique"),
        categorie_id=999999,
        nature="Test",
        montant=10.0,
        monnaie_id=get_monnaie_id(db_session),
        sens=Sens.depense,
        statut=Statut.reel,
    )
    db_session.add(operation)
    with pytest.raises(IntegrityError):
        db_session.commit()


def test_type_id_inexistant_rejete_par_la_base(db_session):
    """Le type est une clé étrangère, pas une chaîne libre : c'est tout
    l'intérêt d'avoir sorti les types de la table des catégories."""
    compte = creer_compte(db_session, "Courant")

    operation = models.Operation(
        compte_id=compte.id,
        date=date(2026, 7, 1),
        type_id=999999,
        nature="Test",
        montant=10.0,
        monnaie_id=get_monnaie_id(db_session),
        sens=Sens.depense,
        statut=Statut.reel,
    )
    db_session.add(operation)
    with pytest.raises(IntegrityError):
        db_session.commit()
