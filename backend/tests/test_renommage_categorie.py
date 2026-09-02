"""Renommer une catégorie.

Ce que ces tests protègent :

  - RENOMMER NE DÉPLACE RIEN. Les opérations pointent sur la ligne, pas sur son
    libellé : leur classement, leurs budgets et leur historique doivent suivre
    le nouveau nom sans qu'on touche à une seule d'entre elles ;
  - « AUTRES » RESTE « AUTRES ». Elle est retrouvée PAR SON NOM pour recueillir
    les opérations dont on supprime la catégorie, et par l'import comme
    proposition par défaut. La renommer casserait les deux ;
  - L'ORDRE DES ROUTES. `PUT /categories/{id}` déclarée avant
    `PUT /categories/reordonner` capterait « reordonner » comme un identifiant.
"""
from datetime import date

import pytest

from app import crud, schemas
from app.constants import CATEGORIE_AUTRES, Statut
from app.routers import categories as routeur

from .conftest import creer_compte, get_type_id


def _categorie(db, nom):
    return crud.get_categorie_by_nom(db, nom)


# ---------- Le renommage ----------


def test_une_categorie_se_renomme(db_session):
    cible = _categorie(db_session, "Loisirs & sorties")
    lu = routeur.rename_categorie(
        cible.id, schemas.CategorieUpdate(nom="Sorties"), db_session
    )
    assert lu.nom == "Sorties"
    assert _categorie(db_session, "Loisirs & sorties") is None
    assert _categorie(db_session, "Sorties") is not None


def test_les_operations_suivent_le_nouveau_nom_sans_etre_touchees(db_session):
    """C'est tout l'intérêt d'une table : rien n'est réécrit derrière."""
    compte = creer_compte(db_session, "Courant", solde_initial=1000.0)
    cible = _categorie(db_session, "Loisirs & sorties")
    operation = crud.create_operation(
        db_session,
        schemas.OperationCreate(
            date=date(2026, 3, 10),
            compte_id=compte.id,
            monnaie_id=crud.get_monnaies(db_session)[0].id,
            type_id=get_type_id(db_session, "classique"),
            categorie_id=cible.id,
            nature="Cinéma",
            montant=12.0,
            statut=Statut.reel,
        ),
    )
    routeur.rename_categorie(cible.id, schemas.CategorieUpdate(nom="Sorties"), db_session)

    db_session.refresh(operation)
    assert operation.categorie_id == cible.id
    assert operation.categorie.nom == "Sorties"
    assert operation.montant == 12.0


def test_le_budget_suit_la_categorie_renommee(db_session):
    cible = _categorie(db_session, "Loisirs & sorties")
    monnaie_id = crud.get_monnaies(db_session)[0].id
    crud.set_budget_categorie(db_session, cible.id, 2026, 3, monnaie_id, 150.0)
    routeur.rename_categorie(cible.id, schemas.CategorieUpdate(nom="Sorties"), db_session)

    assert crud.get_budget_categorie(db_session, cible.id, 2026, 3, monnaie_id) == 150.0


# ---------- Ce qui reste refusé ----------


def test_autres_ne_peut_pas_etre_renommee(db_session):
    """Elle est retrouvée par son NOM pour recueillir les opérations dont on
    supprime la catégorie : la renommer ferait échouer ce repli."""
    autres = _categorie(db_session, CATEGORIE_AUTRES)
    with pytest.raises(Exception) as erreur:
        routeur.rename_categorie(
            autres.id, schemas.CategorieUpdate(nom="Divers"), db_session
        )
    assert erreur.value.status_code == 409
    assert _categorie(db_session, CATEGORIE_AUTRES) is not None


def test_le_repli_vers_autres_marche_toujours_apres_un_renommage(db_session):
    """La garde ci-dessus n'a de valeur que si c'est bien ce qu'elle protège."""
    compte = creer_compte(db_session, "Courant", solde_initial=1000.0)
    cible = _categorie(db_session, "Loisirs & sorties")
    operation = crud.create_operation(
        db_session,
        schemas.OperationCreate(
            date=date(2026, 3, 10),
            compte_id=compte.id,
            monnaie_id=crud.get_monnaies(db_session)[0].id,
            type_id=get_type_id(db_session, "classique"),
            categorie_id=cible.id,
            nature="Cinéma",
            montant=12.0,
            statut=Statut.reel,
        ),
    )
    routeur.rename_categorie(cible.id, schemas.CategorieUpdate(nom="Sorties"), db_session)
    crud.migrer_operations_vers_autres(db_session, _categorie(db_session, "Sorties"))

    db_session.refresh(operation)
    assert operation.categorie.nom == CATEGORIE_AUTRES


def test_deux_categories_ne_peuvent_pas_porter_le_meme_nom(db_session):
    cible = _categorie(db_session, "Loisirs & sorties")
    with pytest.raises(Exception) as erreur:
        routeur.rename_categorie(
            cible.id, schemas.CategorieUpdate(nom=CATEGORIE_AUTRES), db_session
        )
    assert erreur.value.status_code == 409


def test_renommer_avec_le_meme_nom_ne_fait_rien(db_session):
    cible = _categorie(db_session, "Loisirs & sorties")
    lu = routeur.rename_categorie(
        cible.id, schemas.CategorieUpdate(nom="Loisirs & sorties"), db_session
    )
    assert lu.nom == "Loisirs & sorties"


def test_un_nom_vide_est_refuse(db_session):
    from pydantic import ValidationError

    with pytest.raises(ValidationError):
        schemas.CategorieUpdate(nom="")


def test_une_categorie_inconnue_rend_404(db_session):
    with pytest.raises(Exception) as erreur:
        routeur.rename_categorie(9999, schemas.CategorieUpdate(nom="Test"), db_session)
    assert erreur.value.status_code == 404


# ---------- L'ordre des routes ----------


def test_reordonner_nest_pas_capte_comme_un_identifiant(db_session):
    """`PUT /categories/{id}` déclarée avant `/reordonner` lirait « reordonner »
    comme un identifiant de catégorie, et le réordonnancement rendrait 422."""
    chemins = [
        route.path
        for route in routeur.router.routes
        if "PUT" in getattr(route, "methods", set())
    ]
    assert "/categories/{categorie_id}" in chemins
    assert "/categories/reordonner" in chemins
    assert chemins.index("/categories/reordonner") < chemins.index(
        "/categories/{categorie_id}"
    )
