"""Ordre d'affichage des comptes (models.Compte.ordre).

Cet ordre se décide dans Paramètres > Comptes, par glisser-déposer, et se lit
partout ailleurs — cartes du dashboard en tête. Il vaut AU SEIN D'UN TYPE : les
comptes s'affichent toujours groupés par type, un ordre global n'ordonnerait
rien de visible.
"""
from app import crud, schemas

from .conftest import creer_compte, get_type_compte_id


def _noms(comptes):
    return [c.nom for c in comptes]


def _noms_du_type(db, type_nom):
    type_id = get_type_compte_id(db, type_nom)
    return [c.nom for c in crud.get_comptes(db) if c.type_id == type_id]


def test_reordonner_applique_l_ordre_recu(db_session):
    for nom in ("Alpha", "Beta", "Gamma"):
        creer_compte(db_session, nom)
    comptes = {c.nom: c.id for c in crud.get_comptes(db_session)}

    crud.reordonner_comptes(
        db_session, [comptes["Gamma"], comptes["Alpha"], comptes["Beta"]]
    )

    assert _noms(crud.get_comptes(db_session)) == ["Gamma", "Alpha", "Beta"]


def test_un_compte_cree_se_range_a_la_fin_de_son_type(db_session):
    """Une création ne doit pas bousculer l'ordre en place : le nouveau venu
    arrive en dernier, pas au milieu selon son nom."""
    creer_compte(db_session, "Zébu")
    creer_compte(db_session, "Muguet")
    ids = {c.nom: c.id for c in crud.get_comptes(db_session)}
    crud.reordonner_comptes(db_session, [ids["Zébu"], ids["Muguet"]])

    crud.create_compte(
        db_session,
        schemas.CompteCreate(
            nom="Abeille",
            type_id=get_type_compte_id(db_session, "courant"),
            monnaies=[schemas.CompteMonnaieInput(monnaie_id=1)],
        ),
    )

    assert _noms_du_type(db_session, "courant") == ["Zébu", "Muguet", "Abeille"]


def test_chaque_type_est_ordonne_independamment(db_session):
    """Deux comptes de types différents peuvent porter la même position sans se
    gêner : l'ordre ne se compare qu'entre comptes d'un même type."""
    creer_compte(db_session, "Courant A")
    creer_compte(db_session, "Courant B")
    creer_compte(db_session, "Épargne A", type_nom="épargne")
    creer_compte(db_session, "Épargne B", type_nom="épargne")
    ids = {c.nom: c.id for c in crud.get_comptes(db_session)}

    # Un seul type réordonné : l'autre ne bouge pas.
    crud.reordonner_comptes(db_session, [ids["Courant B"], ids["Courant A"]])

    assert _noms_du_type(db_session, "courant") == ["Courant B", "Courant A"]
    assert _noms_du_type(db_session, "épargne") == ["Épargne A", "Épargne B"]


def test_changer_de_type_range_le_compte_a_la_fin_du_nouveau_type(db_session):
    """Garder sa position d'avant placerait le compte à égalité avec un autre,
    dans une liste où cette position ne veut plus rien dire."""
    creer_compte(db_session, "Épargne A", type_nom="épargne")
    creer_compte(db_session, "Épargne B", type_nom="épargne")
    ids = {c.nom: c.id for c in crud.get_comptes(db_session)}
    crud.reordonner_comptes(db_session, [ids["Épargne A"], ids["Épargne B"]])
    voyageur = creer_compte(db_session, "Courant", type_nom="courant")

    crud.update_compte(
        db_session,
        voyageur,
        schemas.CompteUpdate(type_id=get_type_compte_id(db_session, "épargne")),
    )

    assert _noms_du_type(db_session, "épargne") == ["Épargne A", "Épargne B", "Courant"]


def test_le_dashboard_reprend_l_ordre_des_comptes(db_session):
    """C'est le point de la fonctionnalité : les cartes de solde se rangent
    comme les lignes de la page Comptes."""
    from app.services import soldes

    for nom in ("Alpha", "Beta", "Gamma"):
        creer_compte(db_session, nom)
    ids = {c.nom: c.id for c in crud.get_comptes(db_session)}
    crud.reordonner_comptes(db_session, [ids["Gamma"], ids["Beta"], ids["Alpha"]])

    resultat = soldes.get_soldes_comptes(db_session)

    assert [item["compte"].nom for item in resultat] == ["Gamma", "Beta", "Alpha"]
