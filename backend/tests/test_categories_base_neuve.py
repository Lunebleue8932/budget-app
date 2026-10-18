"""Les catégories d'orientation d'une base NEUVE (crud.poser_categories_par_defaut_base_neuve).

Ce qu'on verrouille : une base qui s'ouvre sur « Autres » et « Alimentaire » seulement reçoit les
autres postes livrés ; une base qui a déjà servi, ou dont l'utilisateur a composé la liste, n'est
jamais touchée."""
from datetime import date

from app import crud, models, schemas
from app.constants import CATEGORIE_ENTREES_ARGENT, Sens, Statut
from app.routers.categories import poser_defauts_base_neuve

from .conftest import creer_compte, get_categorie_id, get_monnaie_id, get_type_id


def _noms(db):
    return [c.nom for c in crud.get_categories(db)]


def _vider_sauf(db, gardees):
    for c in crud.get_categories(db):
        if c.nom not in gardees:
            db.delete(c)
    db.commit()
    for nom in gardees:
        if crud.get_categorie_by_nom(db, nom) is None:
            crud.create_categorie(db, schemas.CategorieCreate(nom=nom))


def test_une_base_neuve_incomplete_recoit_les_postes_livres(db_session):
    _vider_sauf(db_session, ["Autres", "Alimentaire"])
    ajoutees = crud.poser_categories_par_defaut_base_neuve(db_session)
    assert ajoutees == ["Loisirs", "Transports", "Charges fixes", CATEGORIE_ENTREES_ARGENT]
    assert set(_noms(db_session)) == {
        "Autres", "Alimentaire", "Loisirs", "Transports", "Charges fixes", CATEGORIE_ENTREES_ARGENT
    }
    assert crud.get_categorie_by_nom(db_session, CATEGORIE_ENTREES_ARGENT).est_entree is True


def test_l_appel_se_repete_sans_rien_ajouter(db_session):
    _vider_sauf(db_session, ["Autres"])
    crud.poser_categories_par_defaut_base_neuve(db_session)
    assert crud.poser_categories_par_defaut_base_neuve(db_session) == []


def test_une_categorie_composee_a_la_main_arrete_tout(db_session):
    _vider_sauf(db_session, ["Autres", "Alimentaire", "Mon poste à moi"])
    assert crud.poser_categories_par_defaut_base_neuve(db_session) == []
    assert "Loisirs" not in _noms(db_session)


def test_une_base_qui_a_des_operations_n_est_pas_touchee(db_session):
    _vider_sauf(db_session, ["Autres", "Alimentaire"])
    compte = creer_compte(db_session, "Courant")
    db_session.add(
        models.Operation(
            date=date(2026, 9, 1),
            compte_id=compte.id,
            type_id=get_type_id(db_session, "classique"),
            categorie_id=get_categorie_id(db_session, "Alimentaire"),
            nature="Courses",
            montant=10.0,
            monnaie_id=get_monnaie_id(db_session),
            sens=Sens.depense,
            statut=Statut.reel,
        )
    )
    db_session.commit()
    assert crud.poser_categories_par_defaut_base_neuve(db_session) == []
    assert set(_noms(db_session)) == {"Autres", "Alimentaire"}


def test_la_route_rend_les_noms_ajoutes(db_session):
    _vider_sauf(db_session, ["Autres", "Alimentaire"])
    assert "Loisirs" in poser_defauts_base_neuve(db=db_session)["ajoutees"]
    assert poser_defauts_base_neuve(db=db_session) == {"ajoutees": []}
