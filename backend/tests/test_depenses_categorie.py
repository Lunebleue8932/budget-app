"""Le graphe « une catégorie, période après période » de la page Budget.

CE QUE CES TESTS VERROUILLENT :

  - LA VALEUR D'UNE BARRE EST CELLE DE L'HISTOGRAMME DU DASHBOARD pour la même période :
    une dépense amortie est étalée sur ses mois, une remboursable ne pèse que son reste à
    charge. Un graphe qui annoncerait un autre chiffre que celui du dessus ne serait plus cru ;
  - UN MOIS SANS LA MOINDRE OPÉRATION EN BASE N'EST PAS AFFICHÉ (ni avant le premier
    relevé, ni après le dernier) ; un mois avec des opérations mais rien dans la catégorie
    garde sa barre à zéro ;
  - UN MOIS SANS OPÉRATION DATÉE MAIS RECOUVERT PAR UN AMORTISSEMENT PORTE SA VALEUR ;
  - LA VUE ANNUELLE SOMME CHAQUE ANNÉE.
"""
from datetime import date

import pytest

from app import crud, models, schemas
from app.constants import Sens, Statut, TypeOperation
from app.services import soldes

from .conftest import (
    charger_module_extension,
    creer_compte,
    get_categorie_id,
    get_monnaie_id,
    get_type_id,
)

service = charger_module_extension("analyse-budget", "service_analyse_budget.py")

CATEGORIE = "Loisirs & sorties"


@pytest.fixture()
def compte(db_session):
    return creer_compte(db_session, "Courant", solde_initial=5000.0)


def _depense(db, compte, montant, jour, categorie=CATEGORIE, **extra):
    return crud.create_operation(
        db,
        schemas.OperationCreate(
            date=jour,
            nature="Dépense",
            montant=montant,
            sens=Sens.depense,
            statut=Statut.reel,
            compte_id=compte.id,
            monnaie_id=get_monnaie_id(db),
            categorie_id=get_categorie_id(db, categorie),
            type_id=get_type_id(db, TypeOperation.classique),
            amorti=extra.get("amorti", False),
            amortissement_debut=extra.get("amortissement_debut"),
            amortissement_fin=extra.get("amortissement_fin"),
        ),
    )


def _lire(db, annee=2026, vue="mois", categorie=CATEGORIE):
    return service.depenses_d_une_categorie(
        db, get_categorie_id(db, categorie), get_monnaie_id(db), annee, vue
    )


def test_les_mois_sans_aucune_entree_sont_masques(db_session, compte):
    _depense(db_session, compte, 40.0, date(2026, 3, 5))
    _depense(db_session, compte, 10.0, date(2026, 5, 9), categorie="Autres")
    resultat = _lire(db_session)
    mois = {p["mois"]: p["total"] for p in resultat["periodes"]}
    assert mois == {3: pytest.approx(40.0), 5: 0.0}
    assert resultat["masquees"] == 10


def test_un_mois_vecu_sans_la_categorie_garde_sa_barre_a_zero(db_session, compte):
    _depense(db_session, compte, 10.0, date(2026, 4, 9), categorie="Autres")
    resultat = _lire(db_session)
    assert [(p["mois"], p["total"]) for p in resultat["periodes"]] == [(4, 0.0)]


def test_la_valeur_est_celle_de_l_histogramme(db_session, compte):
    _depense(db_session, compte, 120.0, date(2026, 3, 5))
    _depense(db_session, compte, 30.0, date(2026, 3, 20))
    attendu = next(
        d["total_reel"]
        for d in soldes.get_depenses_par_categorie(db_session, 2026, 3, get_monnaie_id(db_session))
        if d["categorie"] == CATEGORIE
    )
    mars = next(p for p in _lire(db_session)["periodes"] if p["mois"] == 3)
    assert mars["total"] == pytest.approx(attendu) == pytest.approx(150.0)


def test_un_amortissement_porte_les_mois_qu_il_recouvre(db_session, compte):
    """Payé en mars, étalé sur mars-mai : avril et mai n'ont AUCUNE opération datée, mais
    portent chacun leur tiers — ils s'affichent."""
    _depense(
        db_session, compte, 300.0, date(2026, 3, 5),
        amorti=True, amortissement_debut=date(2026, 3, 1), amortissement_fin=date(2026, 5, 31),
    )
    mois = {p["mois"]: p["total"] for p in _lire(db_session)["periodes"]}
    assert mois == {3: pytest.approx(100.0), 4: pytest.approx(100.0), 5: pytest.approx(100.0)}


def test_la_vue_annuelle_somme_chaque_annee(db_session, compte):
    _depense(db_session, compte, 40.0, date(2025, 3, 5))
    _depense(db_session, compte, 60.0, date(2025, 9, 5))
    _depense(db_session, compte, 5.0, date(2026, 1, 5))
    resultat = _lire(db_session, vue="annee")
    annees = {p["annee"]: p["total"] for p in resultat["periodes"]}
    assert annees[2025] == pytest.approx(100.0)
    assert annees[2026] == pytest.approx(5.0)
    assert all(p["mois"] is None for p in resultat["periodes"])


def test_une_categorie_inconnue_rend_none(db_session):
    assert service.depenses_d_une_categorie(db_session, 99999, get_monnaie_id(db_session), 2026) is None
