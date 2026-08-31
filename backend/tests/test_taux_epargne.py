"""Rémunération des comptes d'épargne (extension « Taux d'épargne »).

Ce que ces tests protègent, dans l'ordre de ce qui coûterait le plus cher à
casser :

  - LE DÉCOUPAGE EN PÉRIODES. C'est toute la raison d'être du calcul : un
    virement de septembre ne doit pas rapporter comme s'il avait été là depuis
    janvier. Un calcul qui appliquerait le taux au solde final donnerait un
    chiffre faux, affiché comme vrai ;
  - LA CAPITALISATION. (1 + x/100) ^ (n/N), et non x/100 × n/N : sur un livret
    tenu plusieurs années, l'écart entre les deux n'est pas négligeable ;
  - RIEN N'EST ÉCRIT. Le calcul ne crée aucune opération et ne touche à aucun
    solde : c'est ce qui garantit que l'application reste alignée sur le relevé
    de la banque.
"""
from datetime import date

import pytest
from fastapi import HTTPException
from pydantic import ValidationError

from app import crud, models
from app.constants import FrequenceRemuneration, Sens, Statut

from .conftest import (
    charger_module_extension,
    creer_compte,
    creer_monnaie,
    get_monnaie_id,
    get_type_id,
)

service = charger_module_extension("taux-epargne", "service_remuneration.py")
routeur = charger_module_extension("taux-epargne", "routeur_taux_epargne.py")
schemas_te = charger_module_extension("taux-epargne", "schemas_taux_epargne.py")


# ---------- Outillage ----------


def _livret(db, nom="Livret A", solde_initial=0.0, taux=None, frequence=None, debut=None):
    compte = creer_compte(db, nom, type_nom="épargne", solde_initial=solde_initial)
    if taux is not None:
        crud.set_remuneration_compte(
            db, compte, taux=taux, frequence=frequence, debut=debut
        )
    return compte


def _mouvement(db, compte, jour, montant, sens=Sens.transfert_entrant):
    operation = models.Operation(
        compte_id=compte.id,
        date=jour,
        type_id=get_type_id(db, "virement"),
        categorie_id=None,
        nature="Virement",
        monnaie_id=compte.monnaie_principale_id,
        sens=sens,
        statut=Statut.reel,
        montant=montant,
        montant_du=0.0,
        montant_a_rembourser=0.0,
    )
    db.add(operation)
    db.commit()
    return operation


def _evolution(db, compte, fin):
    return service.evolution(db, compte, compte.monnaie_principale_id, fin)


# ---------- Le compte des versements ----------


@pytest.mark.parametrize(
    "frequence, fin, attendu",
    [
        # Une par jour.
        (FrequenceRemuneration.journaliere, date(2026, 1, 11), 10),
        # Une par semaine pleine : dix jours en font une.
        (FrequenceRemuneration.hebdomadaire, date(2026, 1, 11), 1),
        (FrequenceRemuneration.hebdomadaire, date(2026, 1, 15), 2),
        # Le quantième du départ, chaque mois : le 1er mars est la 2e échéance
        # d'un compte parti le 1er janvier.
        (FrequenceRemuneration.mensuelle, date(2026, 3, 1), 2),
        # La veille de l'échéance ne compte pas.
        (FrequenceRemuneration.mensuelle, date(2026, 2, 28), 1),
        (FrequenceRemuneration.annuelle, date(2026, 12, 31), 0),
        (FrequenceRemuneration.annuelle, date(2027, 1, 1), 1),
    ],
)
def test_les_versements_sont_ancres_sur_la_date_de_depart(frequence, fin, attendu):
    """Un compte ouvert un 17 est rémunéré le 17 de chaque mois : c'est ce que
    fait une banque, et la seule règle qui ne dépende ni du calendrier ni de ce
    qu'on appelle « un mois »."""
    assert service._versements_ecoules(date(2026, 1, 1), fin, frequence) == attendu


def test_une_echeance_mensuelle_au_31_tombe_au_dernier_jour_du_mois():
    """Février n'a pas de 31 : l'échéance ne doit pas être sautée."""
    assert (
        service._versements_ecoules(
            date(2026, 1, 31), date(2026, 2, 28), FrequenceRemuneration.mensuelle
        )
        == 1
    )


def test_aucun_versement_avant_la_date_de_depart():
    assert (
        service._versements_ecoules(
            date(2026, 6, 1), date(2026, 1, 1), FrequenceRemuneration.journaliere
        )
        == 0
    )


# ---------- La capitalisation ----------


def test_le_coefficient_capitalise(db_session):
    """(1,02) ^ (10/365), et non 2 % × 10/365 : c'est la formule qui compte, pas
    une approximation linéaire."""
    compte = _livret(
        db_session,
        solde_initial=1000.0,
        taux=2.0,
        frequence="journalière",
        debut=date(2026, 1, 1),
    )
    resultat = _evolution(db_session, compte, date(2026, 1, 11))

    attendu = 1000.0 * (1.02 ** (10 / 365))
    assert resultat["solde_final"] == pytest.approx(attendu)
    assert resultat["interets"] == pytest.approx(attendu - 1000.0)


def test_une_annee_pleine_donne_exactement_le_taux(db_session):
    """Le contrôle le plus simple, et celui qu'on refait de tête : 1 000 € à 2 %
    pendant un an font 1 020 €."""
    compte = _livret(
        db_session,
        solde_initial=1000.0,
        taux=2.0,
        frequence="annuelle",
        debut=date(2026, 1, 1),
    )
    resultat = _evolution(db_session, compte, date(2027, 1, 1))
    assert resultat["solde_final"] == pytest.approx(1020.0)


# ---------- Le découpage en périodes ----------


def test_un_virement_tardif_ne_rapporte_que_sur_la_fin(db_session):
    """LE CŒUR DU CALCUL. 1 000 € présents toute l'année et 1 000 € arrivés le
    dernier jour ne rapportent pas la même chose — et un calcul qui appliquerait
    le taux au solde final ne saurait pas les distinguer."""
    compte = _livret(
        db_session,
        solde_initial=1000.0,
        taux=2.0,
        frequence="journalière",
        debut=date(2026, 1, 1),
    )
    _mouvement(db_session, compte, date(2026, 12, 31), 1000.0)
    db_session.refresh(compte)

    resultat = _evolution(db_session, compte, date(2027, 1, 1))

    # Deux périodes : avant le virement, puis le dernier jour.
    assert len(resultat["periodes"]) == 2
    # Les intérêts restent proches de 2 % de 1 000 € — le second millier n'a
    # travaillé qu'un jour — et non de 2 % de 2 000 €.
    assert 19.0 < resultat["interets"] < 21.0
    assert resultat["solde_final"] == pytest.approx(2000.0 + resultat["interets"])


def test_les_interets_precedent_le_mouvement_du_jour(db_session):
    """La convention prudente : l'argent qui arrive un jour donné commence à
    rapporter le lendemain. Le virement du dernier jour ne doit donc rien
    rapporter du tout."""
    compte = _livret(
        db_session,
        solde_initial=1000.0,
        taux=10.0,
        frequence="journalière",
        debut=date(2026, 1, 1),
    )
    _mouvement(db_session, compte, date(2026, 1, 11), 5000.0)
    db_session.refresh(compte)

    resultat = _evolution(db_session, compte, date(2026, 1, 11))
    attendu = 1000.0 * (1.10 ** (10 / 365)) + 5000.0
    assert resultat["solde_final"] == pytest.approx(attendu)


def test_le_solde_de_fin_dune_periode_ouvre_la_suivante(db_session):
    """L'enchaînement, qui est ce qui fait la capitalisation entre périodes."""
    compte = _livret(
        db_session,
        solde_initial=1000.0,
        taux=5.0,
        frequence="mensuelle",
        debut=date(2026, 1, 1),
    )
    _mouvement(db_session, compte, date(2026, 4, 1), 500.0)
    db_session.refresh(compte)

    resultat = _evolution(db_session, compte, date(2026, 7, 1))
    premiere, seconde = resultat["periodes"]
    assert premiere["solde_fin"] == pytest.approx(seconde["solde_debut"])
    assert premiere["mouvement"] == pytest.approx(500.0)


def test_une_sortie_reduit_ce_que_la_suite_rapporte(db_session):
    compte = _livret(
        db_session,
        solde_initial=2000.0,
        taux=5.0,
        frequence="journalière",
        debut=date(2026, 1, 1),
    )
    _mouvement(
        db_session, compte, date(2026, 1, 2), 1500.0, sens=Sens.transfert_sortant
    )
    db_session.refresh(compte)

    resultat = _evolution(db_session, compte, date(2026, 12, 31))
    # Le solde a passé presque toute l'année à 500 € : les intérêts restent
    # bien en deçà de 5 % de 2 000 €.
    assert resultat["interets"] < 50.0
    assert resultat["solde_final"] < 560.0


def test_les_operations_anterieures_au_depart_sont_dans_le_solde_de_depart(db_session):
    """Elles ne peuvent pas former une période : il n'y a rien avant le début."""
    compte = _livret(
        db_session,
        solde_initial=100.0,
        taux=2.0,
        frequence="annuelle",
        debut=date(2026, 1, 1),
    )
    _mouvement(db_session, compte, date(2025, 6, 1), 900.0)
    db_session.refresh(compte)

    resultat = _evolution(db_session, compte, date(2027, 1, 1))
    assert resultat["solde_initial"] == pytest.approx(1000.0)
    assert resultat["solde_final"] == pytest.approx(1020.0)


# ---------- Ce qui n'a rien à calculer ----------


def test_un_compte_sans_taux_ne_calcule_rien(db_session):
    compte = _livret(db_session, solde_initial=1000.0)
    assert _evolution(db_session, compte, date(2026, 12, 31)) is None


def test_un_taux_sans_point_de_depart_ne_calcule_rien(db_session):
    """Ni date renseignée, ni opération : le compte n'a aucun repère, et
    rapporter depuis une date inventée serait pire que se taire."""
    compte = _livret(db_session, solde_initial=1000.0, taux=2.0, frequence="annuelle")
    assert _evolution(db_session, compte, date(2026, 12, 31)) is None


def test_le_depart_retombe_sur_la_premiere_operation(db_session):
    compte = _livret(db_session, taux=2.0, frequence="annuelle")
    _mouvement(db_session, compte, date(2026, 3, 15), 1000.0)
    db_session.refresh(compte)

    resultat = _evolution(db_session, compte, date(2027, 3, 15))
    assert resultat["debut"] == date(2026, 3, 15)
    assert resultat["solde_final"] == pytest.approx(1020.0)


def test_une_operation_previsionnelle_ne_rapporte_pas(db_session):
    """Le solde d'un livret est ce qu'il porte, pas ce qu'il portera : une
    échéance prévisionnelle rapporterait sur de l'argent qui n'est pas là."""
    compte = _livret(
        db_session,
        solde_initial=1000.0,
        taux=2.0,
        frequence="annuelle",
        debut=date(2026, 1, 1),
    )
    operation = _mouvement(db_session, compte, date(2026, 1, 2), 9000.0)
    operation.statut = Statut.previsionnel
    db_session.commit()
    db_session.refresh(compte)

    resultat = _evolution(db_session, compte, date(2027, 1, 1))
    assert resultat["solde_final"] == pytest.approx(1020.0)


def test_le_calcul_ne_cree_aucune_operation(db_session):
    """La propriété qui garde l'application alignée sur le relevé de la
    banque."""
    compte = _livret(
        db_session,
        solde_initial=1000.0,
        taux=2.0,
        frequence="journalière",
        debut=date(2026, 1, 1),
    )
    avant = db_session.query(models.Operation).count()
    _evolution(db_session, compte, date(2027, 1, 1))
    assert db_session.query(models.Operation).count() == avant


# ---------- Le multi-devises ----------


def test_chaque_monnaie_a_son_calcul(db_session):
    """L'app ne stocke aucun taux de change : deux devises, deux calculs, jamais
    un total."""
    euro = get_monnaie_id(db_session)
    franc = creer_monnaie(db_session, "Franc suisse", "CHF").id
    compte = creer_compte(
        db_session,
        "Livret",
        type_nom="épargne",
        monnaies=[(euro, 1000.0), (franc, 500.0)],
    )
    crud.set_remuneration_compte(
        db_session, compte, taux=2.0, frequence="annuelle", debut=date(2026, 1, 1)
    )

    evolutions = service.evolutions_du_compte(db_session, compte, date(2027, 1, 1))
    par_monnaie = {e["monnaie_id"]: e["solde_final"] for e in evolutions}
    assert par_monnaie[euro] == pytest.approx(1020.0)
    assert par_monnaie[franc] == pytest.approx(510.0)


# ---------- Le routeur et les schémas ----------


def test_le_routeur_ne_voit_que_les_comptes_depargne(db_session):
    creer_compte(db_session, "Courant", type_nom="courant")
    _livret(db_session, "Livret A")
    vus = routeur.list_comptes_epargne(db=db_session)
    assert [c["nom"] for c in vus] == ["Livret A"]


def test_le_routeur_refuse_un_compte_qui_nest_pas_depargne(db_session):
    courant = creer_compte(db_session, "Courant", type_nom="courant")
    with pytest.raises(HTTPException) as erreur:
        routeur.evolution_compte(courant.id, db=db_session)
    assert erreur.value.status_code == 404


def test_le_routeur_pose_et_retire_le_taux(db_session):
    compte = _livret(db_session)
    lu = routeur.set_remuneration(
        compte.id,
        schemas_te.RemunerationUpdate(
            taux_remuneration=3.0,
            frequence_remuneration="mensuelle",
            remuneration_debut=date(2026, 1, 1),
        ),
        db=db_session,
    )
    assert lu["taux_remuneration"] == 3.0

    retire = routeur.set_remuneration(
        compte.id, schemas_te.RemunerationUpdate(), db=db_session
    )
    assert retire["taux_remuneration"] is None
    assert retire["frequence_remuneration"] is None
    assert retire["remuneration_debut"] is None


def test_un_taux_sans_frequence_est_refuse(db_session):
    """L'un sans l'autre ne décrit rien de calculable : à quelles dates
    appliquer un taux dont on ne connaît pas le rythme ?"""
    with pytest.raises(ValidationError):
        schemas_te.RemunerationUpdate(taux_remuneration=2.0)
    with pytest.raises(ValidationError):
        schemas_te.RemunerationUpdate(frequence_remuneration="mensuelle")


def test_un_taux_hors_bornes_est_refuse(db_session):
    """Au-delà de 100 % par an, c'est presque sûrement une saisie en fraction
    (0,02 au lieu de 2) — la laisser passer donnerait un résultat absurde sans
    rien dire."""
    with pytest.raises(ValidationError):
        schemas_te.RemunerationUpdate(
            taux_remuneration=-1.0, frequence_remuneration="annuelle"
        )
    with pytest.raises(ValidationError):
        schemas_te.RemunerationUpdate(
            taux_remuneration=250.0, frequence_remuneration="annuelle"
        )


def test_retirer_le_taux_efface_aussi_la_date_de_depart(db_session):
    """Elle ne servirait plus à rien et resterait en base à attendre."""
    payload = schemas_te.RemunerationUpdate(remuneration_debut=date(2026, 1, 1))
    assert payload.remuneration_debut is None
