"""Amortissement d'une opération sur plusieurs mois.

Ce qui est vérifié ici tient en une phrase : une dépense amortie pèse sur les
mois qu'on lui a désignés, et sur rien d'autre — ni sur son propre mois, ni sur
les soldes des comptes.
"""
from datetime import date

import pytest
from pydantic import ValidationError

from app import crud, models, schemas
from app.constants import Frequence, Statut
from app.services import soldes

from .conftest import creer_compte, get_categorie_id, get_monnaie_id, get_type_id


def _creer_depense(db, compte, **kwargs):
    defaults = dict(
        date=date(2026, 7, 15),
        compte_id=compte.id,
        monnaie_id=get_monnaie_id(db),
        type_id=get_type_id(db, "classique"),
        categorie_id=get_categorie_id(db, "Charges fixes"),
        nature="Assurance annuelle",
        montant=1200.0,
        statut=Statut.reel,
    )
    defaults.update(kwargs)
    return crud.create_operation(db, schemas.OperationCreate(**defaults))


def _depenses(db, annee, mois):
    return {
        ligne["categorie"]: ligne
        for ligne in soldes.get_depenses_par_categorie(db, annee, mois, get_monnaie_id(db))
    }


# ---------- Bornes, nombre de mois, montant mensuel ----------


def test_nb_mois_et_montant_par_mois_se_deduisent_des_bornes(db_session):
    compte = creer_compte(db_session, "Courant")
    operation = _creer_depense(
        db_session,
        compte,
        amorti=True,
        amortissement_debut=date(2026, 7, 1),
        amortissement_fin=date(2027, 6, 1),
    )

    assert operation.amortissement_nb_mois == 12
    assert operation.amortissement_montant_par_mois == 100.0


def test_un_seul_mois_amortit_sur_un_mois(db_session):
    """Début = fin : la dépense est simplement comptée dans CE mois-là, même
    si elle a eu lieu avant. C'est le cas d'usage « décaler », pas « étaler »."""
    compte = creer_compte(db_session, "Courant")
    operation = _creer_depense(
        db_session,
        compte,
        date=date(2026, 7, 15),
        amorti=True,
        amortissement_debut=date(2026, 9, 1),
        amortissement_fin=date(2026, 9, 1),
    )

    assert operation.amortissement_nb_mois == 1
    assert operation.amortissement_montant_par_mois == 1200.0
    assert _depenses(db_session, 2026, 7)["Charges fixes"]["total_reel"] == 0.0
    assert _depenses(db_session, 2026, 9)["Charges fixes"]["total_reel"] == 1200.0


def test_les_bornes_sont_calees_sur_le_premier_du_mois(db_session):
    compte = creer_compte(db_session, "Courant")
    operation = _creer_depense(
        db_session,
        compte,
        amorti=True,
        amortissement_debut=date(2026, 7, 23),
        amortissement_fin=date(2026, 9, 30),
    )

    assert operation.amortissement_debut == date(2026, 7, 1)
    assert operation.amortissement_fin == date(2026, 9, 1)
    assert operation.amortissement_nb_mois == 3


def test_operation_non_amortie_na_ni_bornes_ni_nb_mois(db_session):
    compte = creer_compte(db_session, "Courant")
    operation = _creer_depense(
        db_session, compte, amorti=False, amortissement_debut=date(2026, 7, 1)
    )

    assert operation.amortissement_debut is None
    assert operation.amortissement_nb_mois is None
    assert operation.amortissement_montant_par_mois is None


# ---------- Payloads refusés ----------


def test_amortie_sans_bornes_est_invalide(db_session):
    with pytest.raises(ValidationError):
        schemas.OperationCreate(
            date=date(2026, 7, 15),
            compte_id=1,
            monnaie_id=get_monnaie_id(db_session),
            type_id=get_type_id(db_session, "classique"),
            categorie_id=1,
            nature="Assurance",
            montant=1200.0,
            statut=Statut.reel,
            amorti=True,
        )


def test_fin_avant_debut_est_invalide(db_session):
    with pytest.raises(ValidationError):
        schemas.OperationCreate(
            date=date(2026, 7, 15),
            compte_id=1,
            monnaie_id=get_monnaie_id(db_session),
            type_id=get_type_id(db_session, "classique"),
            categorie_id=1,
            nature="Assurance",
            montant=1200.0,
            statut=Statut.reel,
            amorti=True,
            amortissement_debut=date(2026, 9, 1),
            amortissement_fin=date(2026, 7, 1),
        )


def test_recurrente_et_amortie_sexcluent(db_session):
    """Chaque occurrence porterait le même amortissement, sur les mêmes mois :
    N amortissements empilés sur la même poignée de mois."""
    with pytest.raises(ValidationError):
        schemas.OperationCreate(
            date=date(2026, 7, 15),
            compte_id=1,
            monnaie_id=get_monnaie_id(db_session),
            type_id=get_type_id(db_session, "classique"),
            categorie_id=1,
            nature="Assurance",
            montant=1200.0,
            statut=Statut.reel,
            recurrente=True,
            frequence=Frequence.mensuelle,
            amorti=True,
            amortissement_debut=date(2026, 7, 1),
            amortissement_fin=date(2026, 9, 1),
        )


# ---------- Effet sur l'histogramme des dépenses ----------


def test_la_depense_est_repartie_sur_les_mois_couverts(db_session):
    compte = creer_compte(db_session, "Courant")
    _creer_depense(
        db_session,
        compte,
        date=date(2026, 7, 15),
        montant=300.0,
        amorti=True,
        amortissement_debut=date(2026, 7, 1),
        amortissement_fin=date(2026, 9, 1),
    )

    for mois in (7, 8, 9):
        assert _depenses(db_session, 2026, mois)["Charges fixes"]["total_reel"] == 100.0
    # Ni avant ni après : la plage dit tout.
    assert _depenses(db_session, 2026, 6)["Charges fixes"]["total_reel"] == 0.0
    assert _depenses(db_session, 2026, 10)["Charges fixes"]["total_reel"] == 0.0


def test_le_mois_de_la_depense_ne_compte_plus_le_montant_entier(db_session):
    """Le défaut que l'amortissement vient corriger : sans lui, tout le montant
    tombait sur le mois du paiement. Il ne doit pas y rester EN PLUS."""
    compte = creer_compte(db_session, "Courant")
    _creer_depense(
        db_session,
        compte,
        date=date(2026, 7, 15),
        montant=1200.0,
        amorti=True,
        amortissement_debut=date(2026, 8, 1),
        amortissement_fin=date(2027, 7, 1),
    )

    assert _depenses(db_session, 2026, 7)["Charges fixes"]["total_reel"] == 0.0
    assert _depenses(db_session, 2026, 8)["Charges fixes"]["total_reel"] == 100.0


def test_amortissement_a_cheval_sur_deux_annees(db_session):
    """Chaque année ne reçoit que les mois qui lui reviennent : 5 en 2026
    (août→décembre), 7 en 2027 (janvier→juillet)."""
    compte = creer_compte(db_session, "Courant")
    _creer_depense(
        db_session,
        compte,
        date=date(2026, 7, 15),
        montant=1200.0,
        amorti=True,
        amortissement_debut=date(2026, 8, 1),
        amortissement_fin=date(2027, 7, 1),
    )

    assert _depenses(db_session, 2026, None)["Charges fixes"]["total_reel"] == 500.0
    assert _depenses(db_session, 2027, None)["Charges fixes"]["total_reel"] == 700.0


def test_vue_annuelle_dune_plage_entierement_dans_lannee(db_session):
    compte = creer_compte(db_session, "Courant")
    _creer_depense(
        db_session,
        compte,
        date=date(2026, 7, 15),
        montant=300.0,
        amorti=True,
        amortissement_debut=date(2026, 7, 1),
        amortissement_fin=date(2026, 9, 1),
    )

    # Le montant entier, ni plus ni moins : amortir ne crée ni ne détruit rien.
    assert _depenses(db_session, 2026, None)["Charges fixes"]["total_reel"] == 300.0


def test_le_previsionnel_samortit_aussi(db_session):
    compte = creer_compte(db_session, "Courant")
    _creer_depense(
        db_session,
        compte,
        date=date(2026, 7, 15),
        montant=300.0,
        statut=Statut.previsionnel,
        amorti=True,
        amortissement_debut=date(2026, 7, 1),
        amortissement_fin=date(2026, 9, 1),
    )

    ligne = _depenses(db_session, 2026, 8)["Charges fixes"]
    assert ligne["total_reel"] == 0.0
    assert ligne["total_previsionnel"] == 100.0


def test_une_depense_remboursable_amortit_son_reste_a_charge(db_session):
    """L'histogramme ne compte d'une dépense remboursable que ce qui reste à ma
    charge (montant − montant dû) : c'est CE montant-là qui s'étale."""
    compte = creer_compte(db_session, "Courant")
    _creer_depense(
        db_session,
        compte,
        type_id=get_type_id(db_session, "remboursable"),
        categorie_id=get_categorie_id(db_session, "Charges fixes"),
        date=date(2026, 7, 15),
        montant=300.0,
        montant_du=150.0,
        amorti=True,
        amortissement_debut=date(2026, 7, 1),
        amortissement_fin=date(2026, 9, 1),
    )

    for mois in (7, 8, 9):
        assert _depenses(db_session, 2026, mois)["Charges fixes"]["total_reel"] == 50.0


def test_amortie_et_non_amortie_sadditionnent_dans_la_meme_categorie(db_session):
    compte = creer_compte(db_session, "Courant")
    _creer_depense(
        db_session,
        compte,
        date=date(2026, 8, 3),
        montant=40.0,
        nature="Dépense ordinaire",
    )
    _creer_depense(
        db_session,
        compte,
        date=date(2026, 7, 15),
        montant=300.0,
        amorti=True,
        amortissement_debut=date(2026, 7, 1),
        amortissement_fin=date(2026, 9, 1),
    )

    assert _depenses(db_session, 2026, 8)["Charges fixes"]["total_reel"] == 140.0


# ---------- Effet sur les KPI de période ----------


def test_les_flux_de_la_periode_suivent_lamortissement(db_session):
    compte = creer_compte(db_session, "Courant")
    _creer_depense(
        db_session,
        compte,
        date=date(2026, 7, 15),
        montant=300.0,
        amorti=True,
        amortissement_debut=date(2026, 8, 1),
        amortissement_fin=date(2026, 10, 1),
    )

    monnaie = get_monnaie_id(db_session)
    assert soldes.get_flux_periode(db_session, 2026, 7, monnaie)["sorties"] == 0.0
    aout = soldes.get_flux_periode(db_session, 2026, 8, monnaie)
    assert aout["sorties"] == 100.0
    assert aout["variation"] == -100.0
    # L'année entière retrouve le montant complet.
    assert soldes.get_flux_periode(db_session, 2026, None, monnaie)["sorties"] == 300.0


def test_une_entree_samortit_comme_une_sortie(db_session):
    compte = creer_compte(db_session, "Courant")
    _creer_depense(
        db_session,
        compte,
        categorie_id=get_categorie_id(db_session, "Entrées d'argent"),
        date=date(2026, 7, 15),
        montant=600.0,
        nature="Prime annuelle",
        amorti=True,
        amortissement_debut=date(2026, 7, 1),
        amortissement_fin=date(2026, 12, 1),
    )

    monnaie = get_monnaie_id(db_session)
    assert soldes.get_flux_periode(db_session, 2026, 9, monnaie)["entrees"] == 100.0


# ---------- Ce que l'amortissement ne touche PAS ----------


def test_les_soldes_des_comptes_ignorent_lamortissement(db_session):
    """Les KPI du haut de page disent où en sont réellement les comptes :
    l'argent est bien parti en une fois, le jour de l'opération."""
    compte = creer_compte(db_session, "Courant", solde_initial=2000.0)
    _creer_depense(
        db_session,
        compte,
        date=date(2026, 7, 15),
        montant=1200.0,
        amorti=True,
        amortissement_debut=date(2026, 7, 1),
        amortissement_fin=date(2027, 6, 1),
    )

    resultat = soldes.get_soldes_comptes(db_session, date_fin=date(2026, 7, 31))
    solde = resultat[0]["soldes"][get_monnaie_id(db_session)]
    assert solde["solde_reel"] == 800.0
    assert solde["solde_projete"] == 800.0


# ---------- Modification ----------


def test_decocher_amorti_efface_les_bornes_et_rend_le_montant_a_sa_date(db_session):
    compte = creer_compte(db_session, "Courant")
    operation = _creer_depense(
        db_session,
        compte,
        date=date(2026, 7, 15),
        montant=300.0,
        amorti=True,
        amortissement_debut=date(2026, 8, 1),
        amortissement_fin=date(2026, 10, 1),
    )

    crud.update_operation(db_session, operation, schemas.OperationUpdate(amorti=False))

    assert operation.amortissement_debut is None
    assert operation.amortissement_fin is None
    assert operation.amortissement_nb_mois is None
    assert _depenses(db_session, 2026, 7)["Charges fixes"]["total_reel"] == 300.0
    assert _depenses(db_session, 2026, 8)["Charges fixes"]["total_reel"] == 0.0


def test_deplacer_une_borne_redistribue(db_session):
    compte = creer_compte(db_session, "Courant")
    operation = _creer_depense(
        db_session,
        compte,
        date=date(2026, 7, 15),
        montant=300.0,
        amorti=True,
        amortissement_debut=date(2026, 7, 1),
        amortissement_fin=date(2026, 9, 1),
    )

    crud.update_operation(
        db_session,
        operation,
        schemas.OperationUpdate(amortissement_fin=date(2026, 12, 1)),
    )

    assert operation.amortissement_nb_mois == 6
    assert _depenses(db_session, 2026, 7)["Charges fixes"]["total_reel"] == 50.0
    assert _depenses(db_session, 2026, 12)["Charges fixes"]["total_reel"] == 50.0


def test_la_modification_cale_aussi_les_bornes_sur_le_premier_du_mois(db_session):
    compte = creer_compte(db_session, "Courant")
    operation = _creer_depense(
        db_session,
        compte,
        amorti=True,
        amortissement_debut=date(2026, 7, 1),
        amortissement_fin=date(2026, 9, 1),
    )

    crud.update_operation(
        db_session,
        operation,
        schemas.OperationUpdate(amortissement_fin=date(2026, 12, 24)),
    )

    assert operation.amortissement_fin == date(2026, 12, 1)


# ---------- La fraction elle-même ----------


@pytest.mark.parametrize(
    "annee, mois, attendu",
    [
        (2026, 6, 0.0),  # avant la plage
        (2026, 7, 1 / 3),
        (2026, 10, 0.0),  # après la plage
        (2026, None, 1.0),  # l'année entière contient toute la plage
        (2025, None, 0.0),
    ],
)
def test_part_amortie(db_session, annee, mois, attendu):
    compte = creer_compte(db_session, "Courant")
    operation = _creer_depense(
        db_session,
        compte,
        amorti=True,
        amortissement_debut=date(2026, 7, 1),
        amortissement_fin=date(2026, 9, 1),
    )

    assert soldes.part_amortie(operation, annee, mois) == pytest.approx(attendu)


def test_part_amortie_dune_operation_non_amortie_est_nulle(db_session):
    compte = creer_compte(db_session, "Courant")
    operation = _creer_depense(db_session, compte)

    assert soldes.part_amortie(operation, 2026, 7) == 0.0


def test_les_parts_dune_plage_couvrent_exactement_le_montant(db_session):
    """Invariant : amortir ne crée ni ne détruit d'argent. La somme des parts
    mensuelles vaut toujours 1, quelle que soit la plage."""
    compte = creer_compte(db_session, "Courant")
    operation = _creer_depense(
        db_session,
        compte,
        amorti=True,
        amortissement_debut=date(2026, 11, 1),
        amortissement_fin=date(2027, 3, 1),
    )

    total = sum(
        soldes.part_amortie(operation, annee, mois)
        for annee in (2026, 2027)
        for mois in range(1, 13)
    )
    assert total == pytest.approx(1.0)


# ---------- Onglets de période ----------


def _periodes(db, inclure_amortissements=True):
    """L'endpoint /meta/periodes appelé directement : c'est une fonction de
    `db`, aucun client HTTP n'est nécessaire pour la vérifier."""
    from app.main import get_periodes

    return {
        (p["annee"], p["mois"])
        for p in get_periodes(inclure_amortissements=inclure_amortissements, db=db)
    }


def test_les_mois_damortissement_ont_leur_onglet(db_session):
    """LE CAS RAPPORTÉ : une dépense payée en juillet mais étalée jusqu'en mars
    de l'année suivante alimente les histogrammes de tous ces mois-là. Sans
    onglet, ils étaient calculés mais inatteignables — y compris l'onglet
    d'ANNÉE, qui n'apparaît que si l'un de ses mois existe."""
    compte = creer_compte(db_session, "Courant")
    _creer_depense(
        db_session,
        compte,
        date=date(2026, 7, 15),
        amorti=True,
        amortissement_debut=date(2026, 11, 1),
        amortissement_fin=date(2027, 3, 1),
    )

    periodes = _periodes(db_session)

    # Le mois où l'argent est sorti reste proposé : les soldes, eux, l'y comptent.
    assert (2026, 7) in periodes
    for mois in (11, 12):
        assert (2026, mois) in periodes
    for mois in (1, 2, 3):
        assert (2027, mois) in periodes
    # Et rien au-delà de la plage.
    assert (2027, 4) not in periodes


def test_une_operation_non_amortie_ne_propose_que_son_mois(db_session):
    """Le comportement d'avant ne change pas pour tout le reste. L'année 2029
    plutôt qu'un mois voisin de 2026 : le mois COURANT est toujours proposé
    (cf. get_periodes), et le test se serait cassé au fil des mois."""
    compte = creer_compte(db_session, "Courant")
    _creer_depense(db_session, compte, date=date(2029, 7, 15))

    periodes = _periodes(db_session)

    assert (2029, 7) in periodes
    assert (2029, 8) not in periodes
    assert (2029, 6) not in periodes


def test_le_mois_courant_reste_propose_sans_aucune_operation(db_session):
    from datetime import date as date_type

    aujourdhui = date_type.today()

    assert (aujourdhui.year, aujourdhui.month) in _periodes(db_session)


# ---------- Double check : amortir ne déplace que dans le temps ----------


@pytest.mark.parametrize(
    "type_code, montant, montant_du, attendu_annuel",
    [
        # Une dépense classique compte pour son montant entier.
        ("classique", 1200.0, None, 1200.0),
        # Une dépense remboursable ne compte que son reste à charge.
        ("remboursable", 1200.0, 900.0, 300.0),
        # Un prêt reçu est lui aussi "remboursable" au sens de l'histogramme
        # (cf. TYPES_REMBOURSABLES) : montant − montant dû.
        ("pret", 1200.0, 1200.0, 0.0),
    ],
)
def test_amortir_ne_change_pas_le_total_annuel_dune_categorie(
    db_session, type_code, montant, montant_du, attendu_annuel
):
    """INVARIANT CENTRAL, vérifié type par type : sur une plage entièrement
    contenue dans l'année, l'histogramme annuel donne EXACTEMENT le même total
    que la même dépense non amortie. Amortir répartit dans le temps, il
    n'ajoute ni ne retranche rien — et la base imputée (montant entier, ou
    reste à charge) doit être la même des deux côtés, alors qu'elle est
    calculée par deux chemins distincts (_sommes_par_categorie en SQL,
    _sommes_amorties_par_categorie en Python)."""
    compte = creer_compte(db_session, "Courant")
    kwargs = dict(
        type_id=get_type_id(db_session, type_code),
        categorie_id=get_categorie_id(db_session, "Charges fixes"),
        date=date(2026, 3, 10),
        montant=montant,
    )
    if montant_du is not None:
        kwargs["montant_du"] = montant_du

    _creer_depense(db_session, compte, **kwargs)
    sans_amortissement = _depenses(db_session, 2026, None)["Charges fixes"]["total_reel"]

    # La même, amortie sur dix mois de la même année.
    for operation in db_session.query(models.Operation).all():
        db_session.delete(operation)
    db_session.commit()
    _creer_depense(
        db_session,
        compte,
        **kwargs,
        amorti=True,
        amortissement_debut=date(2026, 3, 1),
        amortissement_fin=date(2026, 12, 1),
    )
    avec_amortissement = _depenses(db_session, 2026, None)["Charges fixes"]["total_reel"]

    assert sans_amortissement == pytest.approx(attendu_annuel)
    assert avec_amortissement == pytest.approx(attendu_annuel)


def test_la_somme_des_douze_mois_vaut_lannee(db_session):
    """Les deux vues du même histogramme s'accordent : douze onglets de mois
    additionnés donnent l'onglet d'année. Vrai en mélangeant amorti et non
    amorti, et une plage à cheval sur deux années (seuls les mois de 2026
    comptent dans 2026)."""
    compte = creer_compte(db_session, "Courant")
    _creer_depense(db_session, compte, date=date(2026, 2, 4), montant=90.0)
    _creer_depense(
        db_session,
        compte,
        date=date(2026, 5, 20),
        montant=1200.0,
        amorti=True,
        amortissement_debut=date(2026, 11, 1),
        amortissement_fin=date(2027, 2, 1),
    )

    par_mois = sum(
        _depenses(db_session, 2026, mois)["Charges fixes"]["total_reel"]
        for mois in range(1, 13)
    )
    annuel = _depenses(db_session, 2026, None)["Charges fixes"]["total_reel"]

    # 90 (février) + 2 mois sur 4 de l'amortissement (novembre, décembre).
    assert par_mois == pytest.approx(90.0 + 600.0)
    assert annuel == pytest.approx(par_mois)


def test_lhistogramme_et_les_flux_saccordent_sur_une_depense_classique(db_session):
    """Les deux agrégats de période lisent la même opération amortie par deux
    chemins différents (par catégorie d'un côté, par sens de l'autre) : sur une
    dépense classique, où l'histogramme ne retranche aucun montant dû, ils
    doivent donner le même chiffre, mois par mois."""
    compte = creer_compte(db_session, "Courant")
    _creer_depense(
        db_session,
        compte,
        date=date(2026, 7, 15),
        montant=900.0,
        amorti=True,
        amortissement_debut=date(2026, 8, 1),
        amortissement_fin=date(2026, 10, 1),
    )
    monnaie = get_monnaie_id(db_session)

    for mois in (7, 8, 9, 10, 11):
        histogramme = _depenses(db_session, 2026, mois)["Charges fixes"]["total_reel"]
        flux = soldes.get_flux_periode(db_session, 2026, mois, monnaie)["sorties"]
        assert histogramme == pytest.approx(flux)


def test_la_page_operations_ignore_les_mois_damortissement(db_session):
    """LE CAS RAPPORTÉ : la page Opérations liste des opérations À LEUR DATE.
    Un mois qui ne reçoit qu'une part d'amortissement n'a aucune ligne à y
    montrer — son onglet n'ouvrait qu'un tableau vide, et il y en avait autant
    que de mois d'étalement."""
    compte = creer_compte(db_session, "Courant")
    _creer_depense(
        db_session,
        compte,
        date=date(2026, 7, 15),
        amorti=True,
        amortissement_debut=date(2026, 11, 1),
        amortissement_fin=date(2027, 3, 1),
    )

    sans = _periodes(db_session, inclure_amortissements=False)

    # Le mois de la dépense reste là : c'est là qu'elle se modifie.
    assert (2026, 7) in sans
    # Aucun mois d'étalement, et donc aucun onglet d'année 2027.
    for mois in (11, 12):
        assert (2026, mois) not in sans
    assert not any(annee == 2027 for annee, _ in sans)
    # Le dashboard, lui, les garde : c'est bien là que la dépense pèse.
    assert (2027, 3) in _periodes(db_session)


def test_le_mois_courant_reste_propose_meme_sans_amortissements(db_session):
    """Sans lui, une base dont toutes les opérations sont passées n'aurait
    aucun onglet pour saisir celle du jour — et periodeParDefaut, côté
    frontend, n'aurait rien à sélectionner."""
    from datetime import date as date_type

    compte = creer_compte(db_session, "Courant")
    _creer_depense(db_session, compte, date=date(2020, 3, 4))
    aujourdhui = date_type.today()

    sans = _periodes(db_session, inclure_amortissements=False)

    assert (aujourdhui.year, aujourdhui.month) in sans
    assert (2020, 3) in sans


def test_sans_amortissement_les_deux_variantes_coincident(db_session):
    """Le paramètre ne change rien tant qu'aucune opération n'est amortie :
    c'est ce qui garantit que la page Opérations n'a rien perdu au passage."""
    compte = creer_compte(db_session, "Courant")
    for mois in (3, 6, 9):
        _creer_depense(db_session, compte, date=date(2026, mois, 12))

    assert _periodes(db_session) == _periodes(db_session, inclure_amortissements=False)
