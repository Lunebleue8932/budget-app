"""L'extension « Suivi des remboursements » commande, en plus de son écran,
si les dépenses remboursables et les remboursements reçus pèsent sur les
totaux — même patron que « Prêts » pour pret/remboursement_pret (cf.
test_prets.test_sans_lextension_un_pret_ne_pese_nulle_part). Le schéma reste
au noyau : éteindre l'extension ne supprime aucune opération, elle disparaît
seulement des totaux tant que rien n'explique à qui elle est due.
"""
from datetime import date

import pytest

from app import crud, extensions, schemas
from app.constants import Statut
from app.services import soldes

from .conftest import creer_compte, get_categorie_id, get_monnaie_id, get_type_id


def _depense_remboursable(db, compte, montant=100.0, montant_du=40.0):
    return crud.create_operation(
        db,
        schemas.OperationCreate(
            date=date(2026, 7, 1),
            compte_id=compte.id,
            monnaie_id=get_monnaie_id(db),
            type_id=get_type_id(db, "remboursable"),
            categorie_id=get_categorie_id(db, "Alimentaire"),
            nature="Restaurant partagé",
            montant=montant,
            statut=Statut.reel,
            montant_du=montant_du,
        ),
    )


def _eteindre_suivi_remboursements(monkeypatch):
    monkeypatch.setattr(
        extensions,
        "est_active",
        lambda extension_id: extension_id != "suivi-remboursements",
    )


def test_depense_remboursable_pese_pour_la_part_a_ma_charge(db_session):
    """Comportement de référence, extension allumée (cf. fixture
    `extensions_allumees`) : seule la part qui restera à ma charge compte."""
    compte = creer_compte(db_session, "Courant")
    _depense_remboursable(db_session, compte)

    flux = soldes.get_flux_periode(db_session, 2026, 7, get_monnaie_id(db_session))

    # 100 payés, 40 à me rendre : 60 restent vraiment à ma charge.
    assert flux["sorties"] == pytest.approx(60.0)


def test_sans_lextension_une_depense_remboursable_ne_pese_nulle_part(
    db_session, monkeypatch
):
    compte = creer_compte(db_session, "Courant")
    _depense_remboursable(db_session, compte)
    _eteindre_suivi_remboursements(monkeypatch)

    flux = soldes.get_flux_periode(db_session, 2026, 7, get_monnaie_id(db_session))
    barres = soldes.get_depenses_par_categorie(
        db_session, 2026, 7, get_monnaie_id(db_session)
    )
    reste = soldes.get_reste_a_rembourser(db_session)

    assert flux["sorties"] == pytest.approx(0.0)
    alimentaire = next(b for b in barres if b["categorie"] == "Alimentaire")
    assert alimentaire["total_reel"] == pytest.approx(0.0)
    assert alimentaire["top_depenses"] == []
    # Absent du tout plutôt qu'à 0 : sans aucune créance ni dette dans aucune
    # monnaie, get_reste_a_rembourser ne construit d'entrée pour aucune (cf.
    # son `set(a_recevoir) | set(a_rendre)`).
    assert reste.get(get_monnaie_id(db_session), {}).get("a_recevoir", 0.0) == pytest.approx(
        0.0
    )


def test_sans_lextension_les_deux_chiffres_restent_daccord(db_session, monkeypatch):
    """Même invariant que pour les prêts (cf. test_accord_flux_histogramme) :
    la somme des barres de l'histogramme doit toujours valoir le total des
    sorties, éteindre l'extension ne doit pas ouvrir d'écart entre les deux."""
    compte = creer_compte(db_session, "Courant")
    _depense_remboursable(db_session, compte)
    _eteindre_suivi_remboursements(monkeypatch)

    barres = soldes.get_depenses_par_categorie(
        db_session, 2026, 7, get_monnaie_id(db_session)
    )
    sorties = soldes.get_flux_periode(db_session, 2026, 7, get_monnaie_id(db_session))[
        "sorties"
    ]

    assert sum(b["total_previsionnel"] for b in barres) == pytest.approx(sorties)


def test_extinction_ne_supprime_aucune_operation(db_session, monkeypatch):
    compte = creer_compte(db_session, "Courant")
    depense = _depense_remboursable(db_session, compte)
    _eteindre_suivi_remboursements(monkeypatch)

    db_session.refresh(depense)
    assert depense.montant == 100.0
    assert depense.montant_du == 40.0
