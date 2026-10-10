"""Les frais de virements internes comptent comme une dépense (soldes._lignes_frais_virements).

Ce que ces tests protègent :

  - LES FRAIS SONT DANS « TOTAL DÉPENSES », pour leur seul montant — le virement, lui,
    reste écarté ;
  - L'HISTOGRAMME DIT LA MÊME CHOSE : une barre « Frais de virements internes » dont le
    montant est exactement ce que la carte a gagné ;
  - LES DEUX VARIATIONS LES COMPTENT, et leur écart n'en dépend donc pas ;
  - LES FRAIS D'UN LIVRET OU D'UN COMPTE DE PLACEMENTS COMPTENT AUSSI ; seuls ceux d'une
    opération ordinaire d'un compte courant restent dans son montant.
"""
from datetime import date

from app import models
from app.constants import LIBELLE_FRAIS_VIREMENTS, Sens, Statut
from app.services import soldes

from .conftest import creer_compte, get_categorie_id, get_monnaie_id, get_type_id


def _op(db, compte, montant, sens, **kwargs):
    valeurs = dict(
        date=date(2026, 8, 12),
        type_id=get_type_id(db, "classique"),
        categorie_id=get_categorie_id(db, "Alimentaire"),
        nature="Courses",
        monnaie_id=get_monnaie_id(db),
        sens=sens,
        statut=Statut.reel,
        montant=montant,
        montant_du=0.0,
        montant_a_rembourser=0.0,
    )
    valeurs.update(kwargs)
    operation = models.Operation(compte_id=compte.id, **valeurs)
    db.add(operation)
    db.commit()
    return operation


def _virement(db, source, destination, montant, frais, frais_sur="sortante", vid="v"):
    commun = dict(type_id=get_type_id(db, "virement"), categorie_id=None, virement_id=vid,
                  nature="Épargne")
    _op(db, source, montant + (frais if frais_sur == "sortante" else 0), Sens.transfert_sortant,
        frais=frais if frais_sur == "sortante" else None, **commun)
    _op(db, destination, montant - (frais if frais_sur == "entrante" else 0),
        Sens.transfert_entrant, frais=frais if frais_sur == "entrante" else None, **commun)


def test_les_frais_d_un_virement_sont_une_depense_partout(db_session):
    courant = creer_compte(db_session, "Courant")
    livret = creer_compte(db_session, "Livret", type_nom="épargne")
    euro = get_monnaie_id(db_session)
    _op(db_session, courant, 40, Sens.depense)
    _virement(db_session, courant, livret, 100, 2)

    flux = soldes.get_flux_periode(db_session, 2026, 8, euro)
    assert flux["sorties"] == 42

    barres = soldes.get_depenses_par_categorie(db_session, 2026, 8, euro)
    frais = next(b for b in barres if b["categorie"] == LIBELLE_FRAIS_VIREMENTS)
    assert frais["total_previsionnel"] == 2
    assert frais["colonne_speciale"] == "frais_virements"
    assert sum(b["total_previsionnel"] for b in barres) == flux["sorties"]

    assert soldes.get_variation_brute(db_session, 2026, 8, euro) == -42
    tops = soldes.get_top_flux_periode(db_session, 2026, 8, euro)["sorties"]
    assert {(t["nature"], t["montant"]) for t in tops} == {("Courses", 40), ("Épargne", 2)}


def test_les_frais_payes_par_un_livret_comptent_aussi(db_session):
    """Les frais d'un virement comptent quel que soit le compte qui les paie, et ceux d'un
    compte d'épargne ou de placements aussi : seuls ceux d'une opération ordinaire d'un
    compte courant restent dans son montant (et sa catégorie)."""
    courant = creer_compte(db_session, "Courant")
    livret = creer_compte(db_session, "Livret", type_nom="épargne")
    euro = get_monnaie_id(db_session)
    _virement(db_session, livret, courant, 100, 2)
    _op(db_session, livret, 30, Sens.depense, frais=1.5, nature="Tenue de compte")
    _op(db_session, courant, 40, Sens.depense, frais=0.5, nature="Achat à l'étranger")

    flux = soldes.get_flux_periode(db_session, 2026, 8, euro)
    assert flux["sorties"] == 40 + 2 + 1.5
    barres = soldes.get_depenses_par_categorie(db_session, 2026, 8, euro)
    frais = next(b for b in barres if b["categorie"] == LIBELLE_FRAIS_VIREMENTS)
    assert frais["total_previsionnel"] == 3.5


def test_la_fenetre_des_frais_liste_virements_et_comptes_d_epargne(db_session):
    from app.routers import dashboard

    courant = creer_compte(db_session, "Courant")
    livret = creer_compte(db_session, "Livret", type_nom="épargne")
    _virement(db_session, courant, livret, 100, 2)
    _op(db_session, livret, 30, Sens.depense, frais=1.5, nature="Tenue de compte")
    _op(db_session, courant, 40, Sens.depense, frais=0.5, nature="Achat à l'étranger")

    lignes = dashboard.get_frais_virements(db_session)
    assert sorted((l.frais, l.entrante is None) for l in lignes) == [(1.5, True), (2, False)]
