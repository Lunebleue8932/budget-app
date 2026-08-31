from app import crud, models

from .conftest import creer_compte, get_monnaie_id


def _type_hors_systeme(db_session, nom="Joint"):
    """Un type de compte non protégé, posé DIRECTEMENT en base.

    L'application n'en crée plus (cf. routers/types_comptes.py) : le seul cas
    qui en porte est une base ouverte du temps où l'écran le permettait. C'est
    précisément ce cas que la suppression doit continuer de savoir traiter, d'où
    ce montage à la main plutôt qu'un appel à un `crud` qui n'existe plus.
    """
    type_compte = models.TypeCompte(nom=nom, systeme=False)
    db_session.add(type_compte)
    db_session.commit()
    db_session.refresh(type_compte)
    return type_compte


def test_seed_types_compte(db_session):
    types = crud.get_types_compte(db_session)
    noms = {t.nom for t in types}
    assert noms == {"courant", "épargne", "placements financiers"}
    assert all(t.systeme for t in types)


def test_types_compte_livres_sont_tous_proteges(db_session):
    """Aucun type ne peut plus être créé : la liste livrée est donc la liste
    définitive, et elle est entièrement protégée contre la suppression."""
    assert not hasattr(crud, "create_type_compte")
    assert all(t.systeme for t in crud.get_types_compte(db_session))


def test_type_compte_utilise_detecte_correctement(db_session):
    type_compte = _type_hors_systeme(db_session)
    assert crud.type_compte_est_utilise(db_session, type_compte.id) is False

    compte = models.Compte(nom="Compte joint", type_id=type_compte.id)
    compte.monnaies = [models.CompteMonnaie(monnaie_id=get_monnaie_id(db_session))]
    db_session.add(compte)
    db_session.commit()

    assert crud.type_compte_est_utilise(db_session, type_compte.id) is True


def test_delete_type_compte_non_utilise(db_session):
    type_compte = _type_hors_systeme(db_session)

    crud.delete_type_compte(db_session, type_compte)

    assert "Joint" not in {t.nom for t in crud.get_types_compte(db_session)}


def test_compte_expose_type_nom(db_session):
    compte = creer_compte(db_session, "Compte Courant")

    assert compte.type_nom == "courant"
