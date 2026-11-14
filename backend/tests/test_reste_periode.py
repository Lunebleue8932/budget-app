"""Le « reste » pour finir la période (bloc du dashboard), sa courbe et les deux listes.

CE QUE CES TESTS VERROUILLENT :

  - LE RESTE FINIT OÙ LE DASHBOARD DIT. `reste_libre` est le solde projeté courant
    borné à la même date — prêt reçu, épargne, prévisionnelle échue, réel postdaté
    et virement vers l'épargne compris. C'est le même invariant que la courbe du
    solde prévisionnel (cf. test_solde_previsionnel.py) : un « reste » qui finirait
    ailleurs que le « Projeté » posé juste au-dessus ne serait plus cru ;
  - C'EST DU CASH : une dépense payée en novembre et étalée sur décembre pèse sur
    novembre, entière, le jour où l'argent sort ;
  - LES VIREMENTS COMPTENT AU NET : deux jambes entre comptes courants s'annulent,
    un virement vers l'épargne est une sortie ;
  - LE POINT BAS est sous le solde d'aujourd'hui et sous le reste, avec son palier ;
  - LE RYTHME SÛR se mesure jusqu'à la veille de la prochaine entrée (jusqu'à
    l'horizon sans elle), et vaut zéro — avec l'alerte — dès que le minimum touche
    zéro ;
  - CHAQUE MONNAIE A SON RESTE, et plusieurs monnaies converties ont LE LEUR, qui
    n'est pas la somme des points bas ;
  - LES LISTES écartent les virements, posent une échue demain et comptent les
    prévisionnelles jusqu'à l'horizon.
"""
from datetime import date, timedelta

import pytest

from app import models
from app.constants import Sens, Statut
from app.routers import dashboard as routeur_dashboard
from app.services import listes_dashboard, soldes

from .conftest import (
    creer_compte,
    creer_monnaie,
    get_categorie_id,
    get_monnaie_id,
    get_type_id,
)

AUJOURDHUI = date(2026, 11, 14)
FIN_NOVEMBRE = date(2026, 11, 30)
FIN_ANNEE = date(2026, 12, 31)


def _op(db, compte, jour, montant, sens=Sens.depense, statut=Statut.reel,
        type_code="classique", categorie="Alimentaire", nature="Test",
        monnaie_id=None, **extra):
    porte_categorie = type_code in ("classique", "remboursable")
    operation = models.Operation(
        compte_id=compte.id,
        date=jour,
        type_id=get_type_id(db, type_code),
        categorie_id=get_categorie_id(db, categorie) if porte_categorie else None,
        nature=nature,
        montant=montant,
        monnaie_id=monnaie_id or get_monnaie_id(db),
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


def _prevue(db, compte, jour, montant, **kw):
    return _op(db, compte, jour, montant, statut=Statut.previsionnel, **kw)


def _salaire(db, compte, jour, montant=1900.0, **kw):
    return _prevue(
        db, compte, jour, montant, sens=Sens.entree,
        categorie="Entrées d'argent", nature="Salaire", **kw,
    )


def _virement(db, source, cible, jour, montant, statut=Statut.previsionnel):
    """Les deux jambes d'un virement interne."""
    _op(db, source, jour, montant, sens=Sens.transfert_sortant, statut=statut,
        type_code="virement", nature="Virement", virement_id="v1")
    _op(db, cible, jour, montant, sens=Sens.transfert_entrant, statut=statut,
        type_code="virement", nature="Virement", virement_id="v1")


@pytest.fixture()
def comptes(db_session):
    return {
        "courant": creer_compte(db_session, "Courant", "courant", solde_initial=1000.0),
        "second": creer_compte(db_session, "Joint", "courant", solde_initial=0.0),
        "livret": creer_compte(db_session, "Livret", "épargne", solde_initial=500.0),
    }


def _reste(db, horizon=FIN_NOVEMBRE, monnaie_id=None, aujourdhui=AUJOURDHUI):
    monnaie_id = monnaie_id or get_monnaie_id(db)
    return soldes.reste_periode(db, {monnaie_id: 1.0}, horizon, aujourdhui)


def _projete_dashboard(db, fin, monnaie_id=None):
    liste = soldes.get_soldes_comptes(db, date_fin=fin)
    totaux = soldes.calculer_totaux_par_monnaie(liste, valorisation_placements={})
    return totaux[monnaie_id or get_monnaie_id(db)]["solde_projete_courant"]


# ---------- L'invariant ----------


def test_le_reste_libre_est_le_projete_du_dashboard(db_session, comptes):
    c, livret = comptes["courant"], comptes["livret"]
    _op(db_session, c, date(2026, 10, 20), 200.0)  # passé
    _op(db_session, c, date(2026, 11, 2), 3000.0, sens=Sens.entree, categorie="Entrées d'argent")
    _prevue(db_session, c, date(2026, 11, 10), 80.0)  # échue
    _prevue(db_session, c, date(2026, 11, 25), 700.0, nature="Loyer")
    _salaire(db_session, c, date(2026, 11, 28))
    _op(db_session, c, date(2026, 11, 20), 50.0)  # réel postdaté
    _op(db_session, livret, date(2026, 11, 5), 40.0)  # épargne : hors périmètre
    _virement(db_session, c, livret, date(2026, 11, 26), 300.0)  # vers l'épargne
    _prevue(db_session, c, date(2026, 12, 5), 999.0)  # après l'horizon de novembre

    for fin in (FIN_NOVEMBRE, FIN_ANNEE):
        reste = _reste(db_session, fin)
        assert reste["reste_libre"] == pytest.approx(_projete_dashboard(db_session, fin))
        assert reste["reste_libre"] == pytest.approx(
            reste["solde_actuel"] + reste["entrees_prevues"] - reste["sorties_prevues"]
        )


def test_le_pret_recu_est_retranche_comme_dans_le_projete(db_session, comptes):
    c = comptes["courant"]
    _op(db_session, c, date(2026, 11, 1), 1000.0, sens=Sens.entree, type_code="pret",
        montant_du=1000.0, montant_a_rembourser=1000.0)
    reste = _reste(db_session)
    assert reste["reste_libre"] == pytest.approx(_projete_dashboard(db_session, FIN_NOVEMBRE))
    # L'argent est là, mais il n'est pas « libre » : il faudra le rendre.
    assert reste["solde_actuel"] == pytest.approx(1000.0)


def test_l_epargne_n_est_pas_dans_le_reste(db_session, comptes):
    _op(db_session, comptes["livret"], date(2026, 11, 5), 300.0, sens=Sens.entree)
    _prevue(db_session, comptes["livret"], date(2026, 11, 20), 100.0)
    reste = _reste(db_session)
    assert reste["solde_actuel"] == pytest.approx(1000.0)
    assert reste["sorties_prevues"] == pytest.approx(0.0)


# ---------- En cash ----------


def test_une_depense_etalee_pese_le_mois_ou_elle_est_payee(db_session, comptes):
    c = comptes["courant"]
    # Payée le 20 novembre, étalée sur décembre : c'est novembre qui la voit sortir.
    _prevue(
        db_session, c, date(2026, 11, 20), 480.0, nature="Vols de décembre",
        amorti=True, amortissement_debut=date(2026, 12, 1), amortissement_fin=date(2026, 12, 1),
    )
    novembre = _reste(db_session, FIN_NOVEMBRE)
    assert novembre["sorties_prevues"] == pytest.approx(480.0)
    assert novembre["reste_libre"] == pytest.approx(520.0)
    assert novembre["point_bas"]["montant"] == pytest.approx(520.0)
    assert novembre["point_bas"]["date_debut"] == date(2026, 11, 20)

    # Vue de décembre, elle est déjà dans le solde : plus rien à sortir.
    _op(db_session, c, date(2026, 11, 20), 480.0, nature="Vols de décembre (réelle)")
    decembre = soldes.reste_periode(
        db_session, {get_monnaie_id(db_session): 1.0}, FIN_ANNEE, date(2026, 12, 1)
    )
    # La prévisionnelle du 20 nov., restée non rapprochée, se pose demain (le 2).
    assert decembre["solde_actuel"] == pytest.approx(520.0)
    assert decembre["sorties_prevues"] == pytest.approx(480.0)


def test_une_previsionnelle_echue_se_pose_demain(db_session, comptes):
    c = comptes["courant"]
    _prevue(db_session, c, date(2026, 11, 3), 400.0)
    reste = _reste(db_session)
    # Aujourd'hui elle n'a pas eu lieu : le solde ne bouge pas.
    assert reste["solde_actuel"] == pytest.approx(1000.0)
    assert reste["sorties_prevues"] == pytest.approx(400.0)
    assert reste["point_bas"]["date_debut"] == AUJOURDHUI + timedelta(days=1)


# ---------- Les virements internes ----------


def test_un_virement_entre_comptes_courants_ne_compte_ni_en_entree_ni_en_sortie(db_session, comptes):
    _virement(db_session, comptes["courant"], comptes["second"], date(2026, 11, 20), 250.0)
    reste = _reste(db_session)
    assert reste["entrees_prevues"] == pytest.approx(0.0)
    assert reste["sorties_prevues"] == pytest.approx(0.0)
    assert reste["reste_libre"] == pytest.approx(1000.0)


def test_un_virement_vers_l_epargne_est_une_sortie(db_session, comptes):
    _virement(db_session, comptes["courant"], comptes["livret"], date(2026, 11, 20), 250.0)
    reste = _reste(db_session)
    assert reste["entrees_prevues"] == pytest.approx(0.0)
    assert reste["sorties_prevues"] == pytest.approx(250.0)
    assert reste["reste_libre"] == pytest.approx(750.0)
    assert reste["reste_libre"] == pytest.approx(_projete_dashboard(db_session, FIN_NOVEMBRE))
    # Un virement n'est pas « la prochaine entrée ».
    assert reste["prochaine_entree"] is None


# ---------- Le point bas ----------


def test_le_point_bas_est_sous_le_solde_et_sous_le_reste(db_session, comptes):
    c = comptes["courant"]
    _prevue(db_session, c, date(2026, 11, 16), 25.0)
    _prevue(db_session, c, date(2026, 11, 22), 480.0)
    _salaire(db_session, c, date(2026, 11, 25))
    _prevue(db_session, c, date(2026, 11, 29), 100.0)
    reste = _reste(db_session)
    bas = reste["point_bas"]
    assert bas["montant"] <= reste["solde_actuel"]
    assert bas["montant"] <= reste["reste_libre"]
    assert bas["montant"] == pytest.approx(1000.0 - 25.0 - 480.0)
    # Le palier : du jour où le solde tombe à la veille du mouvement suivant.
    assert bas["date_debut"] == date(2026, 11, 22)
    assert bas["date_fin"] == date(2026, 11, 24)


def test_sans_previsionnelle_le_point_bas_est_le_solde_d_aujourd_hui(db_session, comptes):
    reste = _reste(db_session)
    assert reste["entrees_prevues"] == pytest.approx(0.0)
    assert reste["sorties_prevues"] == pytest.approx(0.0)
    assert reste["reste_libre"] == pytest.approx(reste["solde_actuel"])
    assert reste["point_bas"] == {
        "montant": pytest.approx(1000.0),
        "date_debut": AUJOURDHUI,
        "date_fin": FIN_NOVEMBRE,
    }
    assert reste["prochaine_entree"] is None


# ---------- La prochaine entrée et le rythme sûr ----------


def test_le_rythme_va_jusqu_a_la_veille_de_la_prochaine_entree(db_session, comptes):
    c = comptes["courant"]
    _prevue(db_session, c, date(2026, 11, 20), 340.0)
    _salaire(db_session, c, date(2026, 11, 25), 1900.0)
    # Après le salaire : ne pèse pas sur le rythme d'ici là.
    _prevue(db_session, c, date(2026, 11, 27), 2500.0)
    reste = _reste(db_session)
    assert reste["prochaine_entree"] == {
        "date": date(2026, 11, 25),
        "montant": pytest.approx(1900.0),
        "libelle": "Salaire",
    }
    # Minimum avant le 25 : 660, sur les 11 jours qui séparent du salaire.
    assert reste["rythme_jours"] == 11
    assert reste["rythme_sur"] == pytest.approx(660.0 / 11)
    assert reste["alerte"] is False


def test_sans_entree_prevue_le_rythme_va_jusqu_a_l_horizon(db_session, comptes):
    _prevue(db_session, comptes["courant"], date(2026, 11, 20), 200.0)
    reste = _reste(db_session)
    assert reste["prochaine_entree"] is None
    assert reste["rythme_jours"] == (FIN_NOVEMBRE - AUJOURDHUI).days
    assert reste["rythme_sur"] == pytest.approx(800.0 / 16)


def test_la_prochaine_entree_se_cherche_au_dela_de_l_horizon(db_session, comptes):
    # Salaire le 1er décembre, vu depuis la vue « mois » de novembre.
    _salaire(db_session, comptes["courant"], date(2026, 12, 1))
    reste = _reste(db_session)
    assert reste["prochaine_entree"]["date"] == date(2026, 12, 1)
    # Il n'entre pas dans le reste de novembre pour autant.
    assert reste["entrees_prevues"] == pytest.approx(0.0)
    assert reste["rythme_jours"] == 17


def test_un_solde_negatif_met_le_rythme_a_zero_et_leve_l_alerte(db_session, comptes):
    c = comptes["courant"]
    _op(db_session, c, date(2026, 11, 10), 1200.0)  # solde à −200
    _salaire(db_session, c, date(2026, 11, 25))
    reste = _reste(db_session)
    assert reste["solde_actuel"] == pytest.approx(-200.0)
    assert reste["rythme_sur"] == 0.0
    assert reste["alerte"] is True
    assert reste["point_bas"]["montant"] == pytest.approx(-200.0)
    assert reste["reste_libre"] == pytest.approx(1700.0)


def test_un_passage_sous_zero_avant_l_entree_leve_l_alerte(db_session, comptes):
    c = comptes["courant"]
    _prevue(db_session, c, date(2026, 11, 20), 1000.0)  # le solde touche zéro
    _salaire(db_session, c, date(2026, 11, 25))
    reste = _reste(db_session)
    assert reste["rythme_sur"] == 0.0
    assert reste["alerte"] is True


# ---------- Les monnaies ----------


def test_chaque_monnaie_a_son_reste(db_session, comptes):
    dollar = creer_monnaie(db_session, "Dollar", "$")
    usd = creer_compte(db_session, "Compte USD", "courant", monnaies=[(dollar.id, 300.0)])
    _prevue(db_session, comptes["courant"], date(2026, 11, 20), 100.0)
    _prevue(db_session, usd, date(2026, 11, 21), 50.0, monnaie_id=dollar.id)

    euros = _reste(db_session)
    dollars = _reste(db_session, monnaie_id=dollar.id)
    assert euros["solde_actuel"] == pytest.approx(1000.0)
    assert euros["sorties_prevues"] == pytest.approx(100.0)
    assert dollars["solde_actuel"] == pytest.approx(300.0)
    assert dollars["sorties_prevues"] == pytest.approx(50.0)
    assert dollars["reste_libre"] == pytest.approx(_projete_dashboard(db_session, FIN_NOVEMBRE, dollar.id))


def test_plusieurs_monnaies_converties_ont_leur_propre_point_bas(db_session, comptes):
    dollar = creer_monnaie(db_session, "Dollar", "$")
    usd = creer_compte(db_session, "Compte USD", "courant", monnaies=[(dollar.id, 300.0)])
    c = comptes["courant"]
    # Les euros touchent leur plus bas le 18 (puis remontent), les dollars le 28.
    _prevue(db_session, c, date(2026, 11, 18), 600.0)
    _salaire(db_session, c, date(2026, 11, 22), 600.0)
    _prevue(db_session, usd, date(2026, 11, 28), 200.0, monnaie_id=dollar.id)

    euro_id = get_monnaie_id(db_session)
    ensemble = soldes.reste_periode(
        db_session, {euro_id: 1.0, dollar.id: 0.5}, FIN_NOVEMBRE, AUJOURDHUI
    )
    assert ensemble["solde_actuel"] == pytest.approx(1000.0 + 150.0)
    assert ensemble["sorties_prevues"] == pytest.approx(600.0 + 100.0)
    assert ensemble["reste_libre"] == pytest.approx(1000.0 + 50.0)
    # Le plus bas de l'ENSEMBLE est le 18 : 400 € + 150 € — pas la somme des deux minimums.
    assert ensemble["point_bas"]["montant"] == pytest.approx(550.0)
    assert ensemble["point_bas"]["date_debut"] == date(2026, 11, 18)
    somme_des_minimums = (
        _reste(db_session)["point_bas"]["montant"]
        + 0.5 * _reste(db_session, monnaie_id=dollar.id)["point_bas"]["montant"]
    )
    assert ensemble["point_bas"]["montant"] > somme_des_minimums


# ---------- L'horizon ----------


def test_l_horizon_suit_la_vue():
    assert soldes.horizon_reste("mois", AUJOURDHUI) == FIN_NOVEMBRE
    assert soldes.horizon_reste("annee", AUJOURDHUI) == FIN_ANNEE
    # « Tout » projette comme « année » : seule la courbe y remonte plus loin.
    assert soldes.horizon_reste("tout", AUJOURDHUI) == FIN_ANNEE
    assert soldes.horizon_reste("mois", date(2028, 2, 3)) == date(2028, 2, 29)


def test_l_horizon_borne_ce_qui_est_compte(db_session, comptes):
    c = comptes["courant"]
    _prevue(db_session, c, date(2026, 11, 20), 100.0)
    _prevue(db_session, c, date(2026, 12, 20), 300.0)
    _prevue(db_session, c, date(2027, 1, 5), 900.0)
    assert _reste(db_session, FIN_NOVEMBRE)["sorties_prevues"] == pytest.approx(100.0)
    assert _reste(db_session, FIN_ANNEE)["sorties_prevues"] == pytest.approx(400.0)
    assert _reste(db_session, FIN_ANNEE)["point_bas"]["montant"] == pytest.approx(600.0)


def test_le_dashboard_rend_le_reste_avec_les_kpi(db_session, comptes):
    _prevue(db_session, comptes["courant"], date.today() + timedelta(days=1), 100.0)
    reponse = routeur_dashboard.get_dashboard(annee=None, mois=None, vue="annee", db=db_session)
    kpi = next(k for k in reponse.kpis if k.monnaie_id == get_monnaie_id(db_session))
    assert kpi.reste is not None
    assert kpi.reste.horizon == date(date.today().year, 12, 31)
    assert kpi.reste.sorties_prevues == pytest.approx(100.0)
    # LE MÊME CHIFFRE que le projeté de la carte « Solde total », posé juste au-dessus.
    assert kpi.reste.reste_libre == pytest.approx(kpi.solde_projete_courant)


# ---------- La courbe ----------


def _courbe(db, vue="mois"):
    return soldes.courbe_reste(db, {get_monnaie_id(db): 1.0}, vue, AUJOURDHUI)


def test_la_courbe_finit_sur_le_reste_libre(db_session, comptes):
    c = comptes["courant"]
    _op(db_session, c, date(2026, 11, 5), 120.0)
    _prevue(db_session, c, date(2026, 11, 3), 80.0)  # échue
    _prevue(db_session, c, date(2026, 11, 22), 480.0, nature="Vols")
    _salaire(db_session, c, date(2026, 11, 25))
    courbe = _courbe(db_session)
    reste = _reste(db_session)

    assert courbe["horizon"] == FIN_NOVEMBRE
    assert courbe["projetes"][-1]["solde"] == pytest.approx(reste["reste_libre"])
    assert courbe["reels"][-1] == {"date": AUJOURDHUI, "solde": pytest.approx(reste["solde_actuel"])}
    # Le plus bas de la courbe est le point bas annoncé.
    assert min(p["solde"] for p in courbe["projetes"]) == pytest.approx(reste["point_bas"]["montant"])


def test_le_passe_de_la_courbe_ne_compte_que_le_reel(db_session, comptes):
    c = comptes["courant"]
    _op(db_session, c, date(2026, 10, 28), 100.0)  # avant le 1er : dans l'ouverture
    _op(db_session, c, date(2026, 11, 5), 120.0)
    _prevue(db_session, c, date(2026, 11, 8), 400.0)  # échue : pas dans le passé
    courbe = _courbe(db_session)

    assert courbe["reels"] == [
        {"date": date(2026, 11, 1), "solde": pytest.approx(900.0)},
        {"date": date(2026, 11, 5), "solde": pytest.approx(780.0)},
        {"date": AUJOURDHUI, "solde": pytest.approx(780.0)},
    ]
    # L'échue se pose demain : une marche, avec son libellé.
    (marche,) = courbe["projetes"]
    assert marche["date"] == AUJOURDHUI + timedelta(days=1)
    assert marche["solde"] == pytest.approx(380.0)
    assert marche["montant"] == pytest.approx(-400.0)
    assert marche["libelle"] == "Test"


def test_la_courbe_remonte_selon_la_vue(db_session, comptes):
    c = comptes["courant"]
    _op(db_session, c, date(2025, 6, 10), 10.0)
    _op(db_session, c, date(2026, 3, 2), 20.0)
    assert _courbe(db_session, "mois")["reels"][0]["date"] == date(2026, 11, 1)
    assert _courbe(db_session, "annee")["reels"][0]["date"] == date(2026, 1, 1)
    assert _courbe(db_session, "tout")["reels"][0]["date"] == date(2025, 6, 10)
    # Même horizon pour « année » et « tout ».
    assert _courbe(db_session, "tout")["horizon"] == FIN_ANNEE


def test_une_marche_par_jour_d_echeance(db_session, comptes):
    c = comptes["courant"]
    _prevue(db_session, c, date(2026, 11, 20), 30.0, nature="Sport")
    _prevue(db_session, c, date(2026, 11, 20), 70.0, nature="Assurance")
    _prevue(db_session, c, date(2026, 11, 24), 10.0, nature="Café")
    projetes = _courbe(db_session)["projetes"]
    assert [p["date"] for p in projetes] == [date(2026, 11, 20), date(2026, 11, 24)]
    assert projetes[0]["montant"] == pytest.approx(-100.0)
    assert projetes[0]["libelle"] == "Sport, Assurance"


def test_sans_compte_courant_la_courbe_est_plate(db_session):
    courbe = soldes.courbe_reste(db_session, {get_monnaie_id(db_session): 1.0}, "mois", AUJOURDHUI)
    assert courbe["projetes"] == []
    assert all(p["solde"] == 0.0 for p in courbe["reels"])


# ---------- Les listes ----------


def _listes(db, vue="mois", monnaie_id="euro"):
    if monnaie_id == "euro":
        monnaie_id = get_monnaie_id(db)
    return listes_dashboard.listes(db, monnaie_id, vue, AUJOURDHUI)


def test_les_dernieres_operations_sont_reelles_recentes_et_sans_virement(db_session, comptes):
    c = comptes["courant"]
    anciennes = [_op(db_session, c, date(2026, 11, jour), 10.0 + jour, nature=f"J{jour}") for jour in range(1, 8)]
    meme_jour = _op(db_session, c, date(2026, 11, 7), 99.0, nature="Second du 7")
    _virement(db_session, c, comptes["livret"], date(2026, 11, 13), 300.0, statut=Statut.reel)
    _prevue(db_session, c, date(2026, 11, 12), 55.0)  # prévisionnelle : pas « dernière »
    _op(db_session, c, date(2026, 11, 20), 77.0, nature="Postdatée")  # pas encore eu lieu

    dernieres = _listes(db_session)["dernieres"]
    assert len(dernieres) == 5
    # Date décroissante, puis identifiant décroissant.
    assert [ligne["id"] for ligne in dernieres] == [
        meme_jour.id, anciennes[6].id, anciennes[5].id, anciennes[4].id, anciennes[3].id,
    ]
    assert dernieres[0]["categorie_nom"] == "Alimentaire"
    assert all(ligne["sens"] in (Sens.entree, Sens.depense) for ligne in dernieres)


def test_les_prochaines_previsionnelles_sont_triees_et_comptees_jusqu_a_l_horizon(db_session, comptes):
    c = comptes["courant"]
    echue = _prevue(db_session, c, date(2026, 11, 9), 12.0, nature="Échue")
    for jour in (16, 18, 20, 22):
        _prevue(db_session, c, date(2026, 11, jour), 20.0, nature=f"N{jour}")
    salaire = _salaire(db_session, c, date(2026, 11, 25), recurrente=True)
    _prevue(db_session, c, date(2026, 12, 3), 40.0, nature="Décembre")
    _prevue(
        db_session, c, date(2026, 12, 9), 480.0, nature="Étalée", amorti=True,
        amortissement_debut=date(2027, 1, 1), amortissement_fin=date(2027, 3, 1),
    )
    _virement(db_session, c, comptes["livret"], date(2026, 11, 17), 300.0)
    _prevue(db_session, comptes["livret"], date(2026, 11, 15), 5.0, nature="Épargne")

    mois = _listes(db_session, "mois")
    assert [ligne["nature"] for ligne in mois["prochaines"]] == ["Échue", "N16", "N18", "N20", "N22"]
    premiere = mois["prochaines"][0]
    assert premiere["id"] == echue.id
    assert premiere["en_retard"] is True
    assert premiere["jour_pose"] == AUJOURDHUI + timedelta(days=1)
    # Six jusqu'à fin novembre (l'échue, quatre dépenses, le salaire) — ni le virement,
    # ni l'épargne, ni décembre.
    assert mois["prochaines_total"] == 6
    assert mois["horizon"] == FIN_NOVEMBRE

    annee = _listes(db_session, "annee")
    assert annee["prochaines_total"] == 8
    assert salaire.id not in [ligne["id"] for ligne in annee["prochaines"]]  # sixième : hors des cinq


def test_une_ligne_dit_si_elle_est_recurrente_ou_etalee(db_session, comptes):
    c = comptes["courant"]
    _salaire(db_session, c, date(2026, 11, 25), recurrente=True)
    _prevue(
        db_session, c, date(2026, 11, 20), 62.0, nature="Assurance voyage", amorti=True,
        amortissement_debut=date(2026, 12, 1), amortissement_fin=date(2026, 12, 1),
    )
    etalee, salaire = _listes(db_session)["prochaines"]
    assert etalee["etalee_jusqu_au"] == date(2026, 12, 1)
    assert etalee["recurrente"] is False
    assert salaire["recurrente"] is True
    assert salaire["sens"] == Sens.entree
    assert salaire["etalee_jusqu_au"] is None


def test_les_listes_sans_monnaie_montrent_toutes_les_monnaies(db_session, comptes):
    dollar = creer_monnaie(db_session, "Dollar", "$")
    usd = creer_compte(db_session, "Compte USD", "courant", monnaies=[(dollar.id, 300.0)])
    _op(db_session, comptes["courant"], date(2026, 11, 10), 10.0, nature="En euros")
    _op(db_session, usd, date(2026, 11, 11), 20.0, nature="En dollars", monnaie_id=dollar.id)

    assert [l["nature"] for l in _listes(db_session)["dernieres"]] == ["En euros"]
    assert [l["nature"] for l in _listes(db_session, monnaie_id=dollar.id)["dernieres"]] == ["En dollars"]
    toutes = _listes(db_session, monnaie_id=None)["dernieres"]
    assert [l["nature"] for l in toutes] == ["En dollars", "En euros"]
    assert toutes[0]["monnaie_id"] == dollar.id


def test_les_listes_vides(db_session, comptes):
    listes = _listes(db_session)
    assert listes["dernieres"] == []
    assert listes["prochaines"] == []
    assert listes["prochaines_total"] == 0
