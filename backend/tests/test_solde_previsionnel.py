"""La courbe du solde prévisionnel (extension « Budget »).

CE QUE CES TESTS VERROUILLENT :

  - LA COURBE FINIT OÙ LE DASHBOARD DIT. Sans prévision avancée ni exclusion, sa
    dernière valeur est le solde projeté courant du dashboard borné à la même
    date — prêt reçu, épargne, prévisionnelle échue et réel daté plus tard
    compris. Une courbe qui finirait ailleurs que le chiffre posé juste au-dessus
    ne serait plus crue ;
  - LE PASSÉ NE COMPTE QUE LE RÉEL : une prévisionnelle n'a pas eu lieu, elle
    n'écrit donc aucun jour déjà vécu — une échue se pose DEMAIN, et se signale ;
  - L'ÉPARGNE N'EST PAS DANS LA COURBE : même périmètre que la carte « Solde
    total » (comptes courants seulement) ;
  - LA MOYENNE se calcule sur le temps RÉELLEMENT écoulé, exclusions comprises
    (catégorie, type, opération, part d'une découpe) ;
  - LES DOUBLONS SONT SIGNALÉS ET JAMAIS APPLIQUÉS : une prévisionnelle qui a son
    double réel, un loyer à venir déjà présent dans la moyenne — et une
    occurrence précédente de la MÊME série n'est pas un double.
"""
import importlib.util
import pathlib
import sys
from datetime import date, timedelta

import pytest

from app import models
from app.constants import Sens, Statut
from app.services import soldes

from .conftest import creer_compte, get_categorie_id, get_monnaie_id, get_type_id


def _charger(nom):
    racine = pathlib.Path(__file__).resolve().parents[2] / "extensions" / "analyse-budget"
    if str(racine) not in sys.path:
        sys.path.insert(0, str(racine))
    spec = importlib.util.spec_from_file_location(nom, racine / f"{nom}.py")
    module = importlib.util.module_from_spec(spec)
    sys.modules[nom] = module
    spec.loader.exec_module(module)
    return module


service = _charger("service_solde_previsionnel")

AUJOURDHUI = date(2026, 9, 15)


def _op(db, compte, jour, montant, sens=Sens.depense, statut=Statut.reel,
        type_code="classique", categorie="Alimentaire", nature="Test", **extra):
    porte_categorie = type_code in ("classique", "remboursable")
    operation = models.Operation(
        compte_id=compte.id,
        date=jour,
        type_id=get_type_id(db, type_code),
        categorie_id=get_categorie_id(db, categorie) if porte_categorie else None,
        nature=nature,
        montant=montant,
        monnaie_id=get_monnaie_id(db),
        sens=sens,
        statut=statut,
        montant_du=extra.pop("montant_du", 0.0),
        montant_a_rembourser=extra.pop("montant_a_rembourser", 0.0),
        **extra,
    )
    db.add(operation)
    db.commit()
    db.refresh(operation)
    return operation


@pytest.fixture()
def comptes(db_session):
    return {
        "courant": creer_compte(db_session, "Courant", "courant", solde_initial=1000.0),
        "livret": creer_compte(db_session, "Livret", "épargne", solde_initial=500.0),
    }


def _courbe(db, **kw):
    kw.setdefault("aujourdhui", AUJOURDHUI)
    kw.setdefault("jusqu_au", AUJOURDHUI + timedelta(days=60))
    return service.solde_previsionnel(db, get_monnaie_id(db), **kw)


def _a(courbe, jour):
    return next(p["solde"] for p in courbe["points"] if p["date"] == jour)


def _projete_dashboard(db, fin):
    liste = soldes.get_soldes_comptes(db, date_fin=fin)
    totaux = soldes.calculer_totaux_par_monnaie(liste, valorisation_placements={})
    return totaux[get_monnaie_id(db)]["solde_projete_courant"]


# ---------- L'invariant ----------


def test_la_courbe_finit_sur_le_projete_du_dashboard(db_session, comptes):
    c, livret = comptes["courant"], comptes["livret"]
    _op(db_session, c, date(2026, 8, 20), 200.0)  # passé
    _op(db_session, c, date(2026, 9, 1), 3000.0, sens=Sens.entree, categorie="Entrées d'argent")
    _op(db_session, c, date(2026, 9, 10), 80.0, statut=Statut.previsionnel)  # échue
    _op(db_session, c, date(2026, 9, 25), 700.0, statut=Statut.previsionnel, nature="Loyer")
    _op(db_session, c, date(2026, 10, 3), 50.0)  # réel daté plus tard
    _op(db_session, livret, date(2026, 9, 5), 40.0)  # épargne : hors courbe
    fin = AUJOURDHUI + timedelta(days=60)

    courbe = _courbe(db_session, jusqu_au=fin)

    assert courbe["solde_fin"] == pytest.approx(_projete_dashboard(db_session, fin))


def test_le_pret_recu_est_retranche_comme_dans_le_projete(db_session, comptes):
    c = comptes["courant"]
    _op(
        db_session, c, date(2026, 9, 1), 1000.0, sens=Sens.entree, type_code="pret",
        montant_du=1000.0, montant_a_rembourser=1000.0,
    )
    fin = AUJOURDHUI + timedelta(days=10)
    courbe = _courbe(db_session, jusqu_au=fin)
    assert courbe["solde_fin"] == pytest.approx(_projete_dashboard(db_session, fin))
    # L'argent est là, mais la courbe ne le compte pas comme disponible.
    assert courbe["solde_fin"] == pytest.approx(1000.0)


def test_l_epargne_n_est_pas_dans_la_courbe(db_session, comptes):
    _op(db_session, comptes["livret"], date(2026, 9, 5), 300.0, sens=Sens.entree)
    courbe = _courbe(db_session)
    assert courbe["solde_aujourdhui"] == pytest.approx(1000.0)


# ---------- Le temps ----------


def test_le_passe_ne_compte_que_le_reel(db_session, comptes):
    c = comptes["courant"]
    _op(db_session, c, date(2026, 9, 10), 100.0)
    _op(db_session, c, date(2026, 9, 12), 400.0, statut=Statut.previsionnel)  # échue
    courbe = _courbe(db_session)

    assert _a(courbe, date(2026, 9, 9)) == pytest.approx(1000.0)
    assert _a(courbe, date(2026, 9, 10)) == pytest.approx(900.0)
    # Le 12, la prévisionnelle n'a pas eu lieu : le solde vécu ne bouge pas.
    assert _a(courbe, date(2026, 9, 14)) == pytest.approx(900.0)
    assert _a(courbe, AUJOURDHUI) == pytest.approx(900.0)
    # Elle se pose demain, et se signale.
    assert _a(courbe, AUJOURDHUI + timedelta(days=1)) == pytest.approx(500.0)
    (echeance,) = courbe["echeances"]
    assert echeance["en_retard"] is True
    assert echeance["jour_pose"] == AUJOURDHUI + timedelta(days=1)
    assert echeance["montant"] == pytest.approx(-400.0)


def test_les_points_passes_et_futurs_sont_distingues(db_session, comptes):
    courbe = _courbe(db_session)
    assert all(p["passe"] for p in courbe["points"] if p["date"] <= AUJOURDHUI)
    assert not any(p["passe"] for p in courbe["points"] if p["date"] > AUJOURDHUI)


def test_l_horizon_ne_peut_pas_precede_demain(db_session, comptes):
    courbe = _courbe(db_session, jusqu_au=AUJOURDHUI - timedelta(days=5))
    assert courbe["jusqu_au"] == AUJOURDHUI + timedelta(days=1)


# ---------- La prévision avancée ----------


def _depenses_regulieres(db, compte, par_semaine=70.0, semaines=4):
    """Une dépense de `par_semaine` / 7 par jour sur `semaines` semaines."""
    for i in range(7 * semaines):
        _op(db, compte, AUJOURDHUI - timedelta(days=i), par_semaine / 7)


def test_la_moyenne_se_divise_par_le_temps_ecoule(db_session, comptes):
    c = comptes["courant"]
    # Premier jour de dépense il y a 10 jours : la fenêtre de 12 semaines ne
    # doit pas diluer la moyenne sur 84 jours.
    for i in range(10):
        _op(db_session, c, AUJOURDHUI - timedelta(days=i), 20.0)
    courbe = _courbe(db_session, avancee=True)
    assert courbe["moyenne"]["jours"] == 10
    assert courbe["moyenne"]["par_jour"] == pytest.approx(20.0)
    assert courbe["moyenne"]["par_semaine"] == pytest.approx(140.0)


def test_la_prevision_avancee_ajoute_la_moyenne_chaque_jour(db_session, comptes):
    _depenses_regulieres(db_session, comptes["courant"])
    sans = _courbe(db_session, avancee=False)
    avec = _courbe(db_session, avancee=True)
    demain = AUJOURDHUI + timedelta(days=1)
    assert _a(avec, AUJOURDHUI) == pytest.approx(_a(sans, AUJOURDHUI))
    assert _a(avec, demain) == pytest.approx(_a(sans, demain) - 10.0)
    assert _a(avec, AUJOURDHUI + timedelta(days=10)) == pytest.approx(
        _a(sans, AUJOURDHUI + timedelta(days=10)) - 100.0
    )


def test_la_cadence_semaine_tombe_le_dimanche(db_session, comptes):
    _depenses_regulieres(db_session, comptes["courant"])
    sans = _courbe(db_session)
    avec = _courbe(db_session, avancee=True, cadence="semaine")
    dimanche = next(
        AUJOURDHUI + timedelta(days=i) for i in range(1, 8)
        if (AUJOURDHUI + timedelta(days=i)).weekday() == 6
    )
    veille = dimanche - timedelta(days=1)
    assert _a(avec, veille) == pytest.approx(_a(sans, veille))
    assert _a(avec, dimanche) == pytest.approx(_a(sans, dimanche) - 70.0)


def test_exclusions_categorie_type_et_operation(db_session, comptes):
    c = comptes["courant"]
    for i in range(7):
        jour = AUJOURDHUI - timedelta(days=i)
        _op(db_session, c, jour, 10.0, categorie="Alimentaire")
        _op(db_session, c, jour, 30.0, categorie="Charges fixes")
    m = get_monnaie_id(db_session)

    def moyenne(**kw):
        return service.moyenne_depenses(db_session, m, AUJOURDHUI, **kw)

    assert moyenne()["par_jour"] == pytest.approx(40.0)
    assert moyenne(exclure_categories={get_categorie_id(db_session, "Charges fixes")})[
        "par_jour"
    ] == pytest.approx(10.0)
    assert moyenne(exclure_types={"classique"})["par_jour"] == pytest.approx(0.0)
    une = db_session.query(models.Operation).filter(models.Operation.montant == 30.0).first()
    assert moyenne(exclure_operations={une.id})["par_jour"] == pytest.approx(
        (7 * 40.0 - 30.0) / 7
    )


def test_une_decoupe_perd_la_part_d_une_categorie_exclue(db_session, comptes):
    c = comptes["courant"]
    operation = _op(db_session, c, AUJOURDHUI, 120.0, categorie="Alimentaire")
    operation.categorie_id = None
    db_session.add_all(
        [
            models.OperationDecoupe(
                operation_id=operation.id, categorie_id=get_categorie_id(db_session, "Alimentaire"),
                montant=90.0,
            ),
            models.OperationDecoupe(
                operation_id=operation.id, categorie_id=get_categorie_id(db_session, "Charges fixes"),
                montant=30.0,
            ),
        ]
    )
    db_session.commit()
    m = get_monnaie_id(db_session)
    brut = service.moyenne_depenses(db_session, m, AUJOURDHUI)
    reduit = service.moyenne_depenses(
        db_session, m, AUJOURDHUI,
        exclure_categories={get_categorie_id(db_session, "Charges fixes")},
    )
    assert brut["total"] == pytest.approx(120.0)
    assert reduit["total"] == pytest.approx(90.0)


# ---------- Les doublons ----------


def test_une_previsionnelle_qui_a_son_double_reel_est_signalee(db_session, comptes):
    c = comptes["courant"]
    prevue = _op(db_session, c, date(2026, 9, 10), 80.0, statut=Statut.previsionnel, nature="Dentiste")
    reelle = _op(db_session, c, date(2026, 9, 11), 80.0, nature="DENTISTE CB")

    courbe = _courbe(db_session)

    (doublon,) = courbe["doublons"]
    assert doublon["genre"] == "deja_reelle"
    assert doublon["prevu"]["id"] == prevue.id
    assert [p["id"] for p in doublon["passes"]] == [reelle.id]
    assert doublon["a_exclure"] == [prevue.id]
    # SIGNALÉ, JAMAIS APPLIQUÉ : la prévisionnelle compte toujours.
    assert len(courbe["echeances"]) == 1


def test_exclure_la_previsionnelle_la_retire_de_la_courbe(db_session, comptes):
    c = comptes["courant"]
    prevue = _op(db_session, c, date(2026, 9, 10), 80.0, statut=Statut.previsionnel)
    _op(db_session, c, date(2026, 9, 11), 80.0)
    avec = _courbe(db_session)
    sans = _courbe(db_session, exclure_operations={prevue.id})
    assert sans["solde_fin"] == pytest.approx(avec["solde_fin"] + 80.0)
    assert sans["doublons"] == []


def test_un_montant_different_n_est_pas_un_doublon(db_session, comptes):
    c = comptes["courant"]
    _op(db_session, c, date(2026, 9, 10), 80.0, statut=Statut.previsionnel)
    _op(db_session, c, date(2026, 9, 11), 80.5)
    assert _courbe(db_session)["doublons"] == []


def test_une_reelle_ne_sert_qu_une_fois(db_session, comptes):
    c = comptes["courant"]
    _op(db_session, c, date(2026, 9, 10), 80.0, statut=Statut.previsionnel)
    _op(db_session, c, date(2026, 9, 11), 80.0, statut=Statut.previsionnel)
    _op(db_session, c, date(2026, 9, 11), 80.0)
    assert len(_courbe(db_session)["doublons"]) == 1


def test_l_occurrence_precedente_de_la_meme_serie_n_est_pas_un_double(db_session, comptes):
    c = comptes["courant"]
    modele = _op(db_session, c, date(2026, 9, 1), 25.0, recurrente=True, nature="Salle")
    precedente = _op(
        db_session, c, date(2026, 9, 8), 25.0, recurrente=True,
        recurrence_parent_id=modele.id, nature="Salle",
    )
    _op(
        db_session, c, date(2026, 9, 16), 25.0, statut=Statut.previsionnel, recurrente=True,
        recurrence_parent_id=modele.id, nature="Salle",
    )
    assert precedente.id
    assert _courbe(db_session)["doublons"] == []


def test_un_loyer_a_venir_deja_dans_la_moyenne_est_signale(db_session, comptes):
    c = comptes["courant"]
    modele = _op(db_session, c, date(2026, 8, 3), 700.0, categorie="Charges fixes",
                 recurrente=True, nature="Loyer")
    passe = _op(db_session, c, date(2026, 9, 3), 700.0, categorie="Charges fixes",
                recurrente=True, recurrence_parent_id=modele.id, nature="Loyer")
    for mois in (10, 11):
        _op(db_session, c, date(2026, mois, 3), 700.0, categorie="Charges fixes",
            statut=Statut.previsionnel, recurrente=True,
            recurrence_parent_id=modele.id, nature="Loyer")

    # Sans prévision avancée, la moyenne n'entre pas dans la courbe : rien à signaler.
    assert _courbe(db_session, avancee=False)["doublons"] == []

    courbe = _courbe(db_session, avancee=True)
    (doublon,) = courbe["doublons"]
    assert doublon["genre"] == "deja_dans_la_moyenne"
    assert doublon["occurrences"] == 2
    assert {p["id"] for p in doublon["passes"]} == {modele.id, passe.id}
    assert set(doublon["a_exclure"]) == {modele.id, passe.id}

    # L'appliquer sort les loyers passés de la moyenne.
    corrigee = _courbe(db_session, avancee=True, exclure_operations=set(doublon["a_exclure"]))
    assert corrigee["moyenne"]["total"] == pytest.approx(0.0)
    assert corrigee["doublons"] == []


def test_sans_compte_courant_la_courbe_est_vide(db_session):
    courbe = service.solde_previsionnel(
        db_session, get_monnaie_id(db_session), aujourdhui=AUJOURDHUI
    )
    assert courbe["points"] == []
    assert courbe["doublons"] == []
