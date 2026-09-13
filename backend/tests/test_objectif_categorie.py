"""L'objectif de RÉPARTITION d'une catégorie, en pourcentage (migration 0055).

CE QUE CES TESTS VERROUILLENT, et pourquoi chacun existe :

  - l'objectif et le budget en valeur sont DÉCORRÉLÉS. C'est la promesse
    principale de la fonctionnalité, et la seule qu'une refonte ultérieure
    pourrait casser sans s'en apercevoir : il suffirait qu'on dérive l'un de
    l'autre « pour simplifier » ;
  - il ne dépend NI du mois NI de la monnaie, contrairement au budget ;
  - il ne pèse sur AUCUN calcul : les mêmes soldes, les mêmes barres, avec ou
    sans objectif. C'est ce qui autorise à le laisser entièrement libre.
"""
import pytest
from pydantic import ValidationError

from app import crud, models, schemas

from .conftest import get_categorie_id


def test_objectif_vaut_zero_par_defaut(db_session):
    """Zéro veut dire « pas d'objectif » : c'est l'état de toute base qui vient
    d'être migrée, et il ne doit rien afficher à l'écran."""
    for categorie in crud.get_categories(db_session):
        assert categorie.objectif_pourcentage == 0.0


def test_poser_et_retirer_un_objectif(db_session):
    categorie = crud.get_categorie(db_session, get_categorie_id(db_session, "Alimentaire"))

    crud.set_objectif_pourcentage_categorie(db_session, categorie, 15.0)
    assert crud.get_categorie(db_session, categorie.id).objectif_pourcentage == 15.0

    # Zéro RETIRE l'objectif — il n'y a pas de troisième état (cf. migration
    # 0055 : la colonne n'est volontairement pas nullable).
    crud.set_objectif_pourcentage_categorie(db_session, categorie, 0.0)
    assert crud.get_categorie(db_session, categorie.id).objectif_pourcentage == 0.0


def test_objectif_et_budget_en_valeur_sont_decorreles(db_session):
    """LA PROMESSE CENTRALE. Poser l'un ne touche jamais l'autre, dans les deux
    sens — ce sont deux mesures différentes (une part, une enveloppe), et rien
    ne doit permettre de déduire la seconde de la première."""
    categorie = crud.get_categorie(db_session, get_categorie_id(db_session, "Loisirs & sorties"))
    monnaie_id = db_session.query(models.Monnaie).first().id

    crud.set_objectif_pourcentage_categorie(db_session, categorie, 20.0)
    crud.set_budget_categorie(db_session, categorie.id, 2026, 3, monnaie_id, 400.0)

    assert crud.get_categorie(db_session, categorie.id).objectif_pourcentage == 20.0
    assert crud.get_budget_categorie(db_session, categorie.id, 2026, 3, monnaie_id) == 400.0

    # Changer le budget ne bouge pas l'objectif...
    crud.set_budget_categorie(db_session, categorie.id, 2026, 4, monnaie_id, 900.0)
    assert crud.get_categorie(db_session, categorie.id).objectif_pourcentage == 20.0

    # ...et changer l'objectif ne bouge aucun budget.
    crud.set_objectif_pourcentage_categorie(db_session, categorie, 5.0)
    assert crud.get_budget_categorie(db_session, categorie.id, 2026, 3, monnaie_id) == 400.0
    assert crud.get_budget_categorie(db_session, categorie.id, 2026, 4, monnaie_id) == 900.0


def test_objectif_ne_depend_ni_du_mois_ni_de_la_monnaie(db_session):
    """Un pourcentage est une intention stable : il n'a pas de clé de période ni
    de devise, contrairement à `CategorieBudgetMensuel`."""
    categorie = crud.get_categorie(db_session, get_categorie_id(db_session, "Charges fixes"))
    crud.set_objectif_pourcentage_categorie(db_session, categorie, 12.5)

    # Une SEULE valeur, relue à l'identique quelle que soit la question posée :
    # il n'existe pas de « l'objectif de mars » ni de « l'objectif en dollars ».
    relue = crud.get_categorie(db_session, categorie.id)
    assert relue.objectif_pourcentage == 12.5
    colonnes = {c.name for c in models.Categorie.__table__.columns}
    assert "objectif_pourcentage" in colonnes
    assert {"annee", "mois", "monnaie_id"}.isdisjoint(colonnes)


def test_le_schema_refuse_un_pourcentage_aberrant():
    """La borne haute attrape la faute qu'on commet vraiment — « 150 » saisi
    pour « 15,0 ». Elle est vérifiée par le schéma AVANT la base, pour rendre un
    422 qui dit quoi corriger plutôt qu'une erreur de contrainte SQL."""
    schemas.CategorieObjectifUpdate(objectif_pourcentage=0)
    schemas.CategorieObjectifUpdate(objectif_pourcentage=100)
    with pytest.raises(ValidationError):
        schemas.CategorieObjectifUpdate(objectif_pourcentage=150)
    with pytest.raises(ValidationError):
        schemas.CategorieObjectifUpdate(objectif_pourcentage=-1)


def test_la_base_refuse_aussi_un_pourcentage_aberrant(db_session):
    """Le dernier filet : une écriture qui contournerait le schéma (un appel
    interne, un script) doit encore échouer."""
    categorie = crud.get_categorie(db_session, get_categorie_id(db_session, "Autres"))
    with pytest.raises(Exception):
        crud.set_objectif_pourcentage_categorie(db_session, categorie, 101.0)
    db_session.rollback()


def test_objectif_remonte_dans_les_depenses_par_categorie(db_session):
    """Le camembert le lit là, et pas dans `/categories` : deux allers-retours
    pour un même graphe auraient laissé exister un instant où l'un des deux
    chiffres manque."""
    from app.services import soldes

    categorie = crud.get_categorie(db_session, get_categorie_id(db_session, "Alimentaire"))
    crud.set_objectif_pourcentage_categorie(db_session, categorie, 30.0)
    monnaie_id = db_session.query(models.Monnaie).first().id

    lignes = soldes.get_depenses_par_categorie(db_session, 2026, 3, monnaie_id)
    ligne = next(l for l in lignes if l["categorie"] == "Alimentaire")
    assert ligne["objectif_pourcentage"] == 30.0

    # Les autres restent à zéro : un objectif est posé catégorie par catégorie,
    # jamais réparti d'office sur les voisines.
    assert all(
        l["objectif_pourcentage"] == 0.0
        for l in lignes
        if l["categorie"] != "Alimentaire"
    )


def test_objectif_ne_change_aucun_total(db_session):
    """AUCUN CALCUL NE LE LIT. Même raisonnement que `TypeTitre` et
    `ProfilRemboursement` : c'est ce qui permet de le poser, de le changer et de
    le retirer sans conséquence."""
    from app.services import soldes

    monnaie_id = db_session.query(models.Monnaie).first().id
    avant = soldes.get_depenses_par_categorie(db_session, 2026, 3, monnaie_id)
    totaux_avant = [(l["categorie"], l["total_reel"], l["total_previsionnel"],
                     l["budget_alloue"]) for l in avant]

    for categorie in crud.get_categories(db_session):
        crud.set_objectif_pourcentage_categorie(db_session, categorie, 7.0)

    apres = soldes.get_depenses_par_categorie(db_session, 2026, 3, monnaie_id)
    totaux_apres = [(l["categorie"], l["total_reel"], l["total_previsionnel"],
                     l["budget_alloue"]) for l in apres]
    assert totaux_avant == totaux_apres


def test_la_somme_des_objectifs_ne_peut_pas_depasser_cent(db_session):
    """ON N'EST PAS OBLIGÉ D'ATTEINDRE 100 %, MAIS ON NE PEUT PAS LE DÉPASSER.

    Ce qui reste à 100 est implicitement réparti entre les catégories SANS
    objectif (cf. renderPieChartDepenses) : au-delà, ce reste devient négatif et
    l'écran calculerait sur une base impossible."""
    categories = [c for c in crud.get_categories(db_session)]
    a, b, c = categories[0], categories[1], categories[2]

    crud.set_objectif_pourcentage_categorie(db_session, a, 60.0)
    crud.set_objectif_pourcentage_categorie(db_session, b, 30.0)

    # 10 % restent disponibles : 10 passe, 11 non.
    assert crud.erreur_objectif_pourcentage(db_session, c, 10.0) is None
    message = crud.erreur_objectif_pourcentage(db_session, c, 11.0)
    assert message is not None
    # LE PLAFOND UTILISABLE EST ANNONCÉ : sans lui, il faudrait rouvrir chaque
    # autre catégorie pour faire l'addition soi-même.
    assert "10.0 %" in message

    with pytest.raises(ValueError):
        crud.set_objectif_pourcentage_categorie(db_session, c, 11.0)


def test_modifier_une_categorie_ne_se_compte_pas_deux_fois(db_session):
    """LA CATÉGORIE QU'ON MODIFIE EST EXCLUE de la somme des autres : on remplace
    sa valeur, on ne l'ajoute pas. Sans ça, RAMENER un objectif de 60 à 50 aurait
    été refusé dès que le total frôlait 100."""
    categories = crud.get_categories(db_session)
    a, b = categories[0], categories[1]
    crud.set_objectif_pourcentage_categorie(db_session, a, 60.0)
    crud.set_objectif_pourcentage_categorie(db_session, b, 40.0)

    # Le total vaut exactement 100 : réécrire la même valeur reste permis...
    assert crud.erreur_objectif_pourcentage(db_session, a, 60.0) is None
    # ...la baisser aussi, évidemment...
    assert crud.erreur_objectif_pourcentage(db_session, a, 50.0) is None
    # ...et seule une hausse est refusée.
    assert crud.erreur_objectif_pourcentage(db_session, a, 61.0) is not None


def test_cent_pour_cent_pile_est_admis(db_session):
    """La borne est un plafond, pas une limite stricte : une répartition qui
    tombe juste à 100 est exactement ce qu'on cherche à écrire."""
    categories = crud.get_categories(db_session)
    crud.set_objectif_pourcentage_categorie(db_session, categories[0], 100.0)
    assert crud.get_categorie(db_session, categories[0].id).objectif_pourcentage == 100.0
