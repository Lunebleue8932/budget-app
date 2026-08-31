"""Filtres de la page Opérations.

Ce que ces tests protègent :

  - UNE BORNE VIDE NE BORNE RIEN. C'est ce que promet l'écran (« laisse vide
    pour ne pas limiter de ce côté-là »), et c'est aussi la seule façon de
    filtrer « au moins 500 € » sans inventer un plafond ;
  - LES BORNES SONT INCLUSIVES. Un filtre « entre 50 et 100 » qui laisserait
    tomber l'opération à exactement 100 € serait faux d'une ligne, sans le
    dire ;
  - LE MONTANT COMPARÉ EST CELUI QU'ON LIT. `Operation.montant` est toujours
    positif — c'est le sens qui dit d'où va l'argent — donc une dépense et une
    entrée du même ordre de grandeur se filtrent ensemble.
"""
from datetime import date

from app import crud, schemas
from app.constants import Sens, Statut

from .conftest import creer_compte, get_categorie_id, get_monnaie_id, get_type_id


def _operation(db, compte, montant, nature="Dépense", type_code="classique", **kwargs):
    porte_categorie = type_code in ("classique", "remboursable")
    defaults = dict(
        date=date(2026, 7, 1),
        compte_id=compte.id,
        monnaie_id=get_monnaie_id(db),
        type_id=get_type_id(db, type_code),
        categorie_id=get_categorie_id(db, "Autres") if porte_categorie else None,
        nature=nature,
        montant=montant,
        statut=Statut.reel,
    )
    defaults.update(kwargs)
    return crud.create_operation(db, schemas.OperationCreate(**defaults))


def _montants(db, **filtres):
    return sorted(op.montant for op in crud.get_operations(db, **filtres))


def test_sans_borne_toutes_les_operations_sortent(db_session):
    compte = creer_compte(db_session, "Courant")
    for montant in (10.0, 100.0, 1000.0):
        _operation(db_session, compte, montant)
    assert _montants(db_session) == [10.0, 100.0, 1000.0]


def test_le_minimum_seul_ne_borne_que_par_le_bas(db_session):
    compte = creer_compte(db_session, "Courant")
    for montant in (10.0, 100.0, 1000.0):
        _operation(db_session, compte, montant)
    assert _montants(db_session, montant_min=100.0) == [100.0, 1000.0]


def test_le_maximum_seul_ne_borne_que_par_le_haut(db_session):
    compte = creer_compte(db_session, "Courant")
    for montant in (10.0, 100.0, 1000.0):
        _operation(db_session, compte, montant)
    assert _montants(db_session, montant_max=100.0) == [10.0, 100.0]


def test_les_deux_bornes_sont_inclusives(db_session):
    """Un filtre faux d'une ligne aux extrémités ne se voit pas : il faut donc
    le fixer par un test."""
    compte = creer_compte(db_session, "Courant")
    for montant in (49.99, 50.0, 75.0, 100.0, 100.01):
        _operation(db_session, compte, montant)
    assert _montants(db_session, montant_min=50.0, montant_max=100.0) == [
        50.0,
        75.0,
        100.0,
    ]


def test_un_intervalle_vide_ne_rend_rien(db_session):
    compte = creer_compte(db_session, "Courant")
    _operation(db_session, compte, 100.0)
    assert _montants(db_session, montant_min=200.0, montant_max=300.0) == []


def test_le_signe_ne_compte_pas(db_session):
    """`montant` est toujours positif, le sens dit d'où va l'argent : « autour
    de 80 € » attrape aussi bien la dépense que l'entrée."""
    compte = creer_compte(db_session, "Courant")
    _operation(db_session, compte, 80.0, nature="Courses")
    _operation(
        db_session,
        compte,
        80.0,
        nature="Salaire",
        type_code="remboursements",
    )
    trouvees = crud.get_operations(db_session, montant_min=70.0, montant_max=90.0)
    assert {op.sens for op in trouvees} == {Sens.depense, Sens.entree}


def test_le_montant_se_combine_aux_autres_filtres(db_session):
    """Les filtres s'ajoutent, ils ne se remplacent pas."""
    courant = creer_compte(db_session, "Courant")
    livret = creer_compte(db_session, "Livret", type_nom="épargne")
    _operation(db_session, courant, 100.0)
    _operation(db_session, courant, 900.0)
    # Sur un autre compte, pour vérifier que le filtre de compte tient toujours.
    _operation(db_session, livret, 900.0, nature="Épargne")

    trouvees = crud.get_operations(
        db_session, compte_id=courant.id, montant_min=500.0
    )
    assert [(op.compte_id, op.montant) for op in trouvees] == [(courant.id, 900.0)]


def test_zero_est_une_borne_comme_une_autre(db_session):
    """`montant_max=0` doit vouloir dire « au plus zéro », pas « pas de
    borne » : c'est le piège d'un test de véracité côté client."""
    compte = creer_compte(db_session, "Courant")
    _operation(db_session, compte, 100.0)
    assert _montants(db_session, montant_max=0.0) == []


def test_la_route_transmet_les_deux_bornes(db_session):
    from app.routers.operations import list_operations

    compte = creer_compte(db_session, "Courant")
    for montant in (10.0, 100.0, 1000.0):
        _operation(db_session, compte, montant)

    lues = list_operations(montant_min=50.0, montant_max=500.0, db=db_session)
    assert [op.montant for op in lues] == [100.0]
