"""Une icône pour les catégories et les comptes, une couleur pour les comptes (migration 0101).

CE QUI EST VERROUILLÉ : rien n'est choisi d'origine (NULL partout, donc l'écran ne change pas) ; choisir
est un geste explicite, retirer aussi (null) ; une icône vide vaut « aucune » ; et une modification qui
ne parle ni d'icône ni de couleur ne les touche pas.
"""
import pytest
from pydantic import ValidationError

from app import schemas
from app.routers import categories as routeur_categories
from app.routers import comptes as routeur_comptes

from .conftest import creer_compte, get_categorie_id, get_monnaie_id


def test_rien_n_est_choisi_d_origine(db_session):
    compte = creer_compte(db_session, "Courant")
    lu = routeur_comptes.read_compte(compte.id, db_session)
    assert lu.icone is None
    assert lu.couleur_index is None

    categories = routeur_categories.list_categories(db_session)
    assert all(c.icone is None for c in categories)


def test_une_categorie_prend_puis_perd_son_icone(db_session):
    categorie_id = get_categorie_id(db_session, "Alimentaire")

    posee = routeur_categories.set_icone_categorie(
        categorie_id, schemas.CategorieIconeUpdate(icone="🛒"), db_session
    )
    assert posee.icone == "🛒"
    # La couleur de l'histogramme, elle, n'a pas bougé.
    assert posee.couleur_index == routeur_categories.crud.get_categorie(db_session, categorie_id).couleur_index

    retiree = routeur_categories.set_icone_categorie(
        categorie_id, schemas.CategorieIconeUpdate(icone=None), db_session
    )
    assert retiree.icone is None


def test_une_icone_vide_vaut_aucune_icone(db_session):
    categorie_id = get_categorie_id(db_session, "Alimentaire")
    lue = routeur_categories.set_icone_categorie(
        categorie_id, schemas.CategorieIconeUpdate(icone="   "), db_session
    )
    assert lue.icone is None


def test_une_icone_trop_longue_est_refusee():
    with pytest.raises(ValidationError):
        schemas.CategorieIconeUpdate(icone="x" * 17)


def test_un_compte_prend_une_icone_et_une_couleur(db_session):
    compte = creer_compte(db_session, "Courant")
    modifie = routeur_comptes.update_compte(
        compte.id, schemas.CompteUpdate(icone="🏦", couleur_index=4), db_session
    )
    assert (modifie.icone, modifie.couleur_index) == ("🏦", 4)


def test_modifier_autre_chose_ne_touche_ni_l_icone_ni_la_couleur(db_session):
    compte = creer_compte(db_session, "Courant")
    routeur_comptes.update_compte(
        compte.id, schemas.CompteUpdate(icone="🏦", couleur_index=4), db_session
    )

    renomme = routeur_comptes.update_compte(
        compte.id, schemas.CompteUpdate(nom="Courant 2"), db_session
    )
    assert (renomme.icone, renomme.couleur_index) == ("🏦", 4)


def test_envoyer_null_retire_l_icone_et_la_couleur(db_session):
    compte = creer_compte(db_session, "Courant")
    routeur_comptes.update_compte(
        compte.id, schemas.CompteUpdate(icone="🏦", couleur_index=4), db_session
    )

    retire = routeur_comptes.update_compte(
        compte.id, schemas.CompteUpdate(icone=None, couleur_index=None), db_session
    )
    assert (retire.icone, retire.couleur_index) == (None, None)


def test_la_creation_d_un_compte_accepte_icone_et_couleur(db_session):
    from .conftest import get_type_compte_id

    cree = routeur_comptes.create_compte(
        schemas.CompteCreate(
            nom="Voyages",
            type_id=get_type_compte_id(db_session, "courant"),
            monnaies=[schemas.CompteMonnaieInput(monnaie_id=get_monnaie_id(db_session))],
            icone="✈️",
            couleur_index=7,
        ),
        db_session,
    )
    assert (cree.icone, cree.couleur_index) == ("✈️", 7)


def test_une_couleur_negative_est_refusee():
    with pytest.raises(ValidationError):
        schemas.CompteUpdate(couleur_index=-1)
