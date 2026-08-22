from app import crud, models, schemas

from .conftest import creer_compte, get_monnaie_id


def test_seed_types_compte(db_session):
    types = crud.get_types_compte(db_session)
    noms = {t.nom for t in types}
    assert noms == {"courant", "épargne", "placements financiers"}
    assert all(t.systeme for t in types)


def test_create_type_compte(db_session):
    type_compte = crud.create_type_compte(db_session, schemas.TypeCompteCreate(nom="Joint"))
    assert type_compte.systeme is False
    assert "Joint" in {t.nom for t in crud.get_types_compte(db_session)}


def test_type_compte_utilise_detecte_correctement(db_session):
    type_compte = crud.create_type_compte(db_session, schemas.TypeCompteCreate(nom="Joint"))
    assert crud.type_compte_est_utilise(db_session, type_compte.id) is False

    compte = models.Compte(nom="Compte joint", type_id=type_compte.id)
    compte.monnaies = [models.CompteMonnaie(monnaie_id=get_monnaie_id(db_session))]
    db_session.add(compte)
    db_session.commit()

    assert crud.type_compte_est_utilise(db_session, type_compte.id) is True


def test_delete_type_compte_non_utilise(db_session):
    type_compte = crud.create_type_compte(db_session, schemas.TypeCompteCreate(nom="Joint"))

    crud.delete_type_compte(db_session, type_compte)

    assert "Joint" not in {t.nom for t in crud.get_types_compte(db_session)}


def test_compte_expose_type_nom(db_session):
    compte = creer_compte(db_session, "Compte Courant")

    assert compte.type_nom == "courant"
