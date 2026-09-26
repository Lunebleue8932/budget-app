"""Le détail des cartes « Total Entrées » et « Total Dépenses ».

CE QUE CES TESTS VERROUILLENT, et c'est la seule chose qui rende ce détail
utile : les trois lignes de l'infobulle additionnent une PART du chiffre affiché
juste au-dessus. Un détail dont la somme dépasse — ou ignore — le total qu'il
détaille est pire que pas de détail du tout : l'utilisateur fait l'addition, ne
retrouve pas la carte, et cesse de faire confiance aux deux.

Le périmètre est donc celui de `get_flux_periode`, à la règle près : montant
entier pour l'ordinaire, part restant à charge pour une dépense remboursable,
intérêts seuls et du côté des SORTIES pour un prêt reçu.
"""
from datetime import date

import pytest

from app import crud, schemas
from app.constants import Statut
from app.services import soldes

from .conftest import creer_compte, get_categorie_id, get_monnaie_id, get_type_id


def _operation(db, compte, montant, **kwargs):
    defaults = dict(
        date=date(2026, 3, 10),
        compte_id=compte.id,
        monnaie_id=get_monnaie_id(db),
        type_id=get_type_id(db, "classique"),
        categorie_id=get_categorie_id(db, "Alimentaire"),
        nature="Courses",
        montant=montant,
        statut=Statut.reel,
    )
    defaults.update(kwargs)
    return crud.create_operation(db, schemas.OperationCreate(**defaults))


def _top(db, annee=2026, mois=3):
    return soldes.get_top_flux_periode(db, annee, mois, get_monnaie_id(db))


def _flux(db, annee=2026, mois=3):
    return soldes.get_flux_periode(db, annee, mois, get_monnaie_id(db))


def test_les_trois_plus_grosses_sorties_dans_l_ordre(db_session):
    compte = creer_compte(db_session, "Courant", solde_initial=5000.0)
    for nature, montant in (("Loyer", 800.0), ("Courses", 250.0), ("Essence", 90.0), ("Café", 12.0)):
        _operation(db_session, compte, montant, nature=nature)

    sorties = _top(db_session)["sorties"]

    assert [d["nature"] for d in sorties] == ["Loyer", "Courses", "Essence"]
    assert [d["montant"] for d in sorties] == [800.0, 250.0, 90.0]


def test_fondu_par_libelle_comme_l_histogramme(db_session):
    """Trois passages « Courses » à 25 € ne sont pas trois lignes de 25 € mais
    une de 75 €, et `nombre` vaut 3. C'est ce qui fait remonter une dépense
    récurrente au-dessus d'un achat isolé plus gros — sans quoi le classement
    dirait ce qu'on a payé le plus cher en une fois, pas ce qui pèse le plus."""
    compte = creer_compte(db_session, "Courant", solde_initial=5000.0)
    for _ in range(3):
        _operation(db_session, compte, 25.0, nature="Courses")
    _operation(db_session, compte, 60.0, nature="Restaurant")

    sorties = _top(db_session)["sorties"]

    assert sorties[0] == {"nature": "Courses", "montant": pytest.approx(75.0), "nombre": 3}
    assert sorties[1]["nombre"] == 1


def test_les_entrees_ont_leur_propre_classement(db_session):
    """Les deux cartes ne se partagent pas un top : chacune détaille le sien."""
    compte = creer_compte(db_session, "Courant", solde_initial=0.0)
    entree = dict(
        categorie_id=get_categorie_id(db_session, "Entrées d'argent"),
    )
    _operation(db_session, compte, 2150.0, nature="Salaire", **entree)
    _operation(db_session, compte, 40.0, nature="Remboursement ami", **entree)
    _operation(db_session, compte, 300.0, nature="Loyer")

    top = _top(db_session)

    assert [d["nature"] for d in top["entrees"]] == ["Salaire", "Remboursement ami"]
    assert [d["nature"] for d in top["sorties"]] == ["Loyer"]


def test_la_somme_des_lignes_ne_depasse_jamais_la_carte(db_session):
    """L'INVARIANT. Avec trois dépenses ou moins, le détail EST le total ; avec
    davantage, il en reste une part. Jamais plus."""
    compte = creer_compte(db_session, "Courant", solde_initial=5000.0)
    for nature, montant in (("Loyer", 800.0), ("Courses", 250.0), ("Essence", 90.0)):
        _operation(db_session, compte, montant, nature=nature)

    assert sum(d["montant"] for d in _top(db_session)["sorties"]) == pytest.approx(
        _flux(db_session)["sorties"]
    )

    _operation(db_session, compte, 12.0, nature="Café")
    assert sum(d["montant"] for d in _top(db_session)["sorties"]) < _flux(db_session)["sorties"]


def test_une_depense_amortie_compte_pour_sa_part_du_mois(db_session):
    """Comme partout ailleurs : une facture de 1 200 € étalée sur douze mois
    apparaît à 100 € dans le mois qu'on regarde, pas à 1 200 €."""
    compte = creer_compte(db_session, "Courant", solde_initial=5000.0)
    _operation(
        db_session,
        compte,
        1200.0,
        nature="Assurance",
        amorti=True,
        amortissement_debut=date(2026, 1, 1),
        amortissement_fin=date(2026, 12, 1),
    )

    sorties = _top(db_session)["sorties"]

    assert sorties[0]["nature"] == "Assurance"
    assert sorties[0]["montant"] == pytest.approx(100.0)
    assert sorties[0]["montant"] == pytest.approx(_flux(db_session)["sorties"])


def test_une_ligne_a_zero_noccupe_pas_une_des_trois_places(db_session):
    """Une dépense remboursable intégralement due n'apporte rien à la carte :
    elle ne doit rien apporter au détail non plus, et surtout pas prendre la
    place d'une ligne qui, elle, explique quelque chose."""
    compte = creer_compte(db_session, "Courant", solde_initial=5000.0)
    _operation(db_session, compte, 40.0, nature="Petit achat")
    _operation(
        db_session,
        compte,
        500.0,
        nature="Avance pour Léa",
        type_id=get_type_id(db_session, "remboursable"),
        montant_du=500.0,
    )

    sorties = _top(db_session)["sorties"]

    assert [d["nature"] for d in sorties] == ["Petit achat"]


def test_une_operation_sans_libelle_reste_une_ligne(db_session):
    """Le libellé vide est un libellé comme un autre : c'est le frontend qui
    écrit « Sans libellé », pas le serveur qui invente un nom."""
    compte = creer_compte(db_session, "Courant", solde_initial=5000.0)
    _operation(db_session, compte, 30.0, nature="")

    assert _top(db_session)["sorties"] == [
        {"nature": "", "montant": pytest.approx(30.0), "nombre": 1}
    ]
