"""L'écart entre « Variation sur le mois brute » et « Variation attribuée au mois ».

CE QUE CES TESTS VERROUILLENT. Le détail est un MIROIR de deux calculs qui vivent
ailleurs (`get_variation_brute`, `get_flux_periode`) : il ne recalcule pas la
même chose « à peu près », il doit rendre EXACTEMENT ce que ces deux-là comptent.
Un détail dont la somme ne vaut pas le chiffre qu'il détaille est pire que pas de
détail du tout — on cesse de croire les deux.

L'invariant central est donc : **la somme des écarts des lignes vaut l'écart des
deux totaux**. Il est testé sur chaque famille séparément, puis sur toutes
mélangées — parce que c'est justement le mélange qui casse ce genre de calcul.
"""
from datetime import date

import pytest

from app import crud, models
from app.constants import Sens, Statut, TypeOperation
from app.services import soldes

from .conftest import creer_compte, get_categorie_id, get_monnaie_id, get_type_id


ANNEE, MOIS = 2026, 3


@pytest.fixture
def contexte(db_session):
    """Un compte courant, une monnaie, une catégorie : le décor minimal."""
    compte = creer_compte(db_session, "Courant")
    return {
        "compte": compte,
        "monnaie_id": get_monnaie_id(db_session),
        "categorie_id": get_categorie_id(db_session, "Alimentaire"),
    }


def _operation(db_session, contexte, code, **kwargs):
    operation = models.Operation(
        date=kwargs.pop("date_operation", date(ANNEE, MOIS, 10)),
        compte_id=contexte["compte"].id,
        monnaie_id=contexte["monnaie_id"],
        type_id=get_type_id(db_session, code),
        categorie_id=contexte["categorie_id"],
        sens=kwargs.pop("sens", Sens.depense),
        statut=kwargs.pop("statut", Statut.reel),
        nature=kwargs.pop("nature", "Ligne de test"),
        **kwargs,
    )
    db_session.add(operation)
    db_session.commit()
    return operation


def _verifier_invariant(db_session, contexte):
    """LA VÉRIFICATION QUI COMPTE, réutilisée par tous les tests : la somme des
    lignes vaut l'écart, et les deux totaux valent bien ceux que le dashboard
    affiche par ailleurs."""
    detail = soldes.get_ecart_variations(db_session, ANNEE, MOIS, contexte["monnaie_id"])

    brute = soldes.get_variation_brute(db_session, ANNEE, MOIS, contexte["monnaie_id"])
    flux = soldes.get_flux_periode(db_session, ANNEE, MOIS, contexte["monnaie_id"])

    assert detail["variation_brute"] == pytest.approx(brute)
    assert detail["variation_attribuee"] == pytest.approx(flux["variation"])
    assert detail["ecart"] == pytest.approx(brute - flux["variation"])

    somme = sum(ligne["ecart"] for ligne in detail["lignes"])
    assert somme == pytest.approx(detail["ecart"], abs=0.01)
    return detail


def test_une_operation_ordinaire_ne_creuse_aucun_ecart(db_session, contexte):
    """LE CAS LE PLUS FRÉQUENT, et celui qu'on oublie de tester : une dépense
    classique compte pareil des deux côtés. Elle ne doit donc PAS apparaître —
    une liste qui contiendrait tout n'expliquerait rien."""
    _operation(db_session, contexte, TypeOperation.classique.value, montant=120.0)
    detail = _verifier_invariant(db_session, contexte)
    assert detail["lignes"] == []
    assert detail["ecart"] == pytest.approx(0.0)


def test_dépense_amortie_le_mois_du_paiement(db_session, contexte):
    """La brute compte 1 200 €, l'attribuée 100 € : l'écart est de 1 100 € et il
    porte le signe de la dépense."""
    _operation(
        db_session,
        contexte,
        TypeOperation.classique.value,
        montant=1200.0,
        amorti=True,
        amortissement_debut=date(ANNEE, MOIS, 1),
        amortissement_fin=date(ANNEE + 1, 2, 1),
    )
    detail = _verifier_invariant(db_session, contexte)
    assert len(detail["lignes"]) == 1
    ligne = detail["lignes"][0]
    assert ligne["raison"] == soldes.RAISON_AMORTISSEMENT
    assert ligne["contribution_brute"] == pytest.approx(-1200.0)
    assert ligne["contribution_attribuee"] == pytest.approx(-100.0)
    assert ligne["ecart"] == pytest.approx(-1100.0)


def test_dépense_amortie_un_mois_suivant(db_session, contexte):
    """L'ÉCART CHANGE DE SIGNE, et c'est la subtilité de cette famille : le mois
    suivant, rien n'est sorti du compte (brute = 0) mais la période porte quand
    même sa part (attribuée = −100). L'écart est donc POSITIF."""
    _operation(
        db_session,
        contexte,
        TypeOperation.classique.value,
        montant=1200.0,
        date_operation=date(ANNEE, 1, 15),
        amorti=True,
        amortissement_debut=date(ANNEE, 1, 1),
        amortissement_fin=date(ANNEE, 12, 1),
    )
    detail = _verifier_invariant(db_session, contexte)
    assert len(detail["lignes"]) == 1
    ligne = detail["lignes"][0]
    assert ligne["contribution_brute"] == pytest.approx(0.0)
    assert ligne["contribution_attribuee"] == pytest.approx(-100.0)
    assert ligne["ecart"] == pytest.approx(100.0)


def test_depense_remboursable(db_session, contexte, monkeypatch):
    """La brute compte les 80 € partis, l'attribuée les 30 € qui restent à
    charge : l'écart vaut les 50 € qu'on nous rendra."""
    monkeypatch.setattr(soldes, "_remboursable_compte", lambda: True)
    _operation(
        db_session,
        contexte,
        TypeOperation.remboursable.value,
        montant=80.0,
        montant_du=50.0,
        montant_a_rembourser=50.0,
    )
    detail = _verifier_invariant(db_session, contexte)
    assert len(detail["lignes"]) == 1
    ligne = detail["lignes"][0]
    assert ligne["raison"] == soldes.RAISON_REMBOURSABLE
    assert ligne["contribution_brute"] == pytest.approx(-80.0)
    assert ligne["contribution_attribuee"] == pytest.approx(-30.0)
    assert ligne["ecart"] == pytest.approx(-50.0)


def test_reglement(db_session, contexte):
    """Un remboursement REÇU fait bouger le compte (+50) et ne pèse sur aucun
    flux : l'écart vaut son montant entier."""
    _operation(
        db_session,
        contexte,
        TypeOperation.remboursements.value,
        montant=50.0,
        sens=Sens.entree,
    )
    detail = _verifier_invariant(db_session, contexte)
    assert len(detail["lignes"]) == 1
    ligne = detail["lignes"][0]
    assert ligne["raison"] == soldes.RAISON_REGLEMENT
    assert ligne["contribution_brute"] == pytest.approx(50.0)
    assert ligne["contribution_attribuee"] == pytest.approx(0.0)


def test_somme_des_ecarts_vaut_la_difference(db_session, contexte, monkeypatch):
    """LE TEST QUI TIENT TOUT LE RESTE : les quatre familles ensemble, plus des
    opérations ordinaires pour le bruit. C'est le mélange qui casse ce genre de
    miroir — chaque famille prise seule peut être juste et leur somme fausse."""
    monkeypatch.setattr(soldes, "_remboursable_compte", lambda: True)

    _operation(db_session, contexte, TypeOperation.classique.value, montant=120.0)
    _operation(
        db_session,
        contexte,
        TypeOperation.classique.value,
        montant=2400.0,
        sens=Sens.entree,
        nature="Salaire",
    )
    _operation(
        db_session,
        contexte,
        TypeOperation.classique.value,
        montant=900.0,
        amorti=True,
        amortissement_debut=date(ANNEE, MOIS, 1),
        amortissement_fin=date(ANNEE, MOIS + 2, 1),
    )
    _operation(
        db_session,
        contexte,
        TypeOperation.remboursable.value,
        montant=200.0,
        montant_du=120.0,
        montant_a_rembourser=120.0,
    )
    _operation(
        db_session,
        contexte,
        TypeOperation.remboursements.value,
        montant=60.0,
        sens=Sens.entree,
    )

    detail = _verifier_invariant(db_session, contexte)
    # Les trois qui creusent un écart, et elles seules : les deux classiques non
    # amorties comptent pareil des deux côtés.
    assert len(detail["lignes"]) == 3
    assert {ligne["raison"] for ligne in detail["lignes"]} == {
        soldes.RAISON_AMORTISSEMENT,
        soldes.RAISON_REMBOURSABLE,
        soldes.RAISON_REGLEMENT,
    }


def test_lignes_triees_du_plus_gros_ecart_au_plus_petit(db_session, contexte):
    """On vient voir ce qui EXPLIQUE le chiffre : ce qui pèse le plus se lit en
    premier, quel que soit le signe."""
    _operation(
        db_session,
        contexte,
        TypeOperation.remboursements.value,
        montant=15.0,
        sens=Sens.entree,
        nature="Petit",
    )
    _operation(
        db_session,
        contexte,
        TypeOperation.remboursements.value,
        montant=500.0,
        sens=Sens.entree,
        nature="Gros",
    )
    detail = _verifier_invariant(db_session, contexte)
    ecarts = [abs(ligne["ecart"]) for ligne in detail["lignes"]]
    assert ecarts == sorted(ecarts, reverse=True)
    assert detail["lignes"][0]["nature"] == "Gros"


def test_vue_annuelle(db_session, contexte):
    """`mois=None` agrège les douze mois, et l'invariant doit y tenir aussi : un
    amortissement entièrement contenu dans l'année n'y creuse plus aucun écart,
    puisque sa part vaut alors son montant entier."""
    _operation(
        db_session,
        contexte,
        TypeOperation.classique.value,
        montant=1200.0,
        date_operation=date(ANNEE, 1, 15),
        amorti=True,
        amortissement_debut=date(ANNEE, 1, 1),
        amortissement_fin=date(ANNEE, 12, 1),
    )
    detail = soldes.get_ecart_variations(db_session, ANNEE, None, contexte["monnaie_id"])
    brute = soldes.get_variation_brute(db_session, ANNEE, None, contexte["monnaie_id"])
    flux = soldes.get_flux_periode(db_session, ANNEE, None, contexte["monnaie_id"])
    assert detail["ecart"] == pytest.approx(brute - flux["variation"])
    assert sum(l["ecart"] for l in detail["lignes"]) == pytest.approx(
        detail["ecart"], abs=0.01
    )
    assert detail["lignes"] == []
