from datetime import date

from app import crud, models, schemas
from app.constants import Sens, Statut
from app.services import soldes

from .conftest import creer_compte, get_categorie_id, get_monnaie_id, get_type_id


def _make_compte(db, nom, solde_initial=0.0, type_nom="courant", monnaies=None):
    return creer_compte(
        db, nom, type_nom=type_nom, solde_initial=solde_initial, monnaies=monnaies
    )


def _make_operation(db, compte, categorie="Autres", type_code=None, remboursable=False, **kwargs):
    """Construit l'opération directement (sans passer par le CRUD) pour figer
    exactement le sens et les montants que le test veut mesurer.

    `type_code` prime : quand il est donné, la catégorie est ignorée (les
    quatre types spéciaux n'en portent pas). Sinon le type découle de
    `remboursable`, comme le faisait l'ancienne colonne booléenne.
    """
    if type_code is None:
        type_code = "remboursable" if remboursable else "classique"
    porte_categorie = type_code in ("classique", "remboursable")
    defaults = dict(
        date=date(2026, 7, 1),
        type_id=get_type_id(db, type_code),
        categorie_id=get_categorie_id(db, categorie) if porte_categorie else None,
        nature="Test",
        # Par défaut la monnaie du compte : les tests qui vérifient un
        # comportement multi-devises la passent explicitement.
        monnaie_id=compte.monnaie_principale_id,
        sens=Sens.depense,
        statut=Statut.reel,
        montant_du=0.0,
        montant_a_rembourser=0.0,
    )
    defaults.update(kwargs)
    operation = models.Operation(compte_id=compte.id, **defaults)
    db.add(operation)
    db.commit()
    db.refresh(operation)
    return operation


def _solde_compte(db, compte_id, monnaie_id=None):
    """Le solde d'un compte DANS UNE MONNAIE — par défaut sa monnaie
    principale, ce qui laisse les tests mono-devise s'écrire comme avant."""
    resultats = soldes.get_soldes_comptes(db)
    item = next(r for r in resultats if r["compte"].id == compte_id)
    if monnaie_id is None:
        monnaie_id = item["compte"].monnaie_principale_id
    return item["soldes"][monnaie_id]


def _soldes_bornes(db, compte, date_fin):
    """Le solde d'un compte dans sa monnaie principale, projection bornée."""
    item = next(
        r for r in soldes.get_soldes_comptes(db, date_fin=date_fin)
        if r["compte"].id == compte.id
    )
    return item["soldes"][compte.monnaie_principale_id]


def test_solde_reel_entree_et_depense(db_session):
    compte = _make_compte(db_session, "Courant", solde_initial=100.0)
    _make_operation(db_session, compte, montant=500.0, sens=Sens.entree, statut=Statut.reel)
    _make_operation(db_session, compte, montant=80.0, sens=Sens.depense, statut=Statut.reel)

    resultat = _solde_compte(db_session, compte.id)

    assert resultat["solde_reel"] == 100.0 + 500.0 - 80.0
    assert resultat["solde_projete"] == resultat["solde_reel"]


def test_solde_projete_inclut_le_previsionnel(db_session):
    compte = _make_compte(db_session, "Courant", solde_initial=0.0)
    _make_operation(db_session, compte, montant=200.0, sens=Sens.entree, statut=Statut.reel)
    _make_operation(
        db_session, compte, montant=50.0, sens=Sens.depense, statut=Statut.previsionnel
    )

    resultat = _solde_compte(db_session, compte.id)

    assert resultat["solde_reel"] == 200.0
    assert resultat["solde_projete"] == 200.0 - 50.0


def test_virement_interne_impacte_les_deux_comptes(db_session):
    source = _make_compte(db_session, "Courant", solde_initial=1000.0)
    destination = _make_compte(db_session, "Livret A", solde_initial=200.0, type_nom="épargne")

    _make_operation(
        db_session,
        source,
        type_code="virement",
        montant=300.0,
        sens=Sens.transfert_sortant,
        statut=Statut.reel,
    )
    _make_operation(
        db_session,
        destination,
        type_code="virement",
        montant=300.0,
        sens=Sens.transfert_entrant,
        statut=Statut.reel,
    )

    solde_source = _solde_compte(db_session, source.id)
    solde_destination = _solde_compte(db_session, destination.id)

    assert solde_source["solde_reel"] == 1000.0 - 300.0
    assert solde_destination["solde_reel"] == 200.0 + 300.0


def test_remboursement_partiel(db_session):
    compte = _make_compte(db_session, "Courant")
    _make_operation(
        db_session,
        compte,
        categorie="Loisirs & sorties",
        montant=100.0,
        sens=Sens.depense,
        statut=Statut.reel,
        type_code="remboursable",
        montant_du=100.0,
        # 40 déjà remboursés sur 100 -> il reste 60 à rembourser.
        montant_a_rembourser=60.0,
    )
    # Une dépense non remboursable ne doit pas compter dans le total à rembourser.
    _make_operation(
        db_session,
        compte,
        categorie="Alimentaire",
        montant=30.0,
        sens=Sens.depense,
        statut=Statut.reel,
        remboursable=False,
    )
    # Une dépense remboursable mais prévisionnelle ne doit pas compter non plus.
    _make_operation(
        db_session,
        compte,
        categorie="Autres",
        montant=60.0,
        sens=Sens.depense,
        statut=Statut.previsionnel,
        type_code="remboursable",
        montant_du=60.0,
        montant_a_rembourser=60.0,
    )

    total = soldes.get_total_a_rembourser(db_session)[get_monnaie_id(db_session)]

    assert total == 60.0


def test_total_a_rembourser_soustrait_les_prets(db_session):
    compte = _make_compte(db_session, "Courant")
    # On me doit 60 sur une dépense remboursable.
    _make_operation(
        db_session,
        compte,
        categorie="Loisirs & sorties",
        montant=60.0,
        sens=Sens.depense,
        statut=Statut.reel,
        type_code="remboursable",
        montant_du=60.0,
        montant_a_rembourser=60.0,
    )
    # Je dois 25 sur un prêt qu'on m'a accordé -> net = 60 - 25 = 35.
    _make_operation(
        db_session,
        compte,
        type_code="pret",
        montant=25.0,
        sens=Sens.entree,
        statut=Statut.reel,
        montant_du=25.0,
        montant_a_rembourser=25.0,
    )

    total = soldes.get_total_a_rembourser(db_session)[get_monnaie_id(db_session)]

    assert total == 35.0


def test_pret_recu_est_dans_le_solde_reel_mais_pas_dans_le_projete(db_session):
    """L'argent prêté est bien sur le compte (solde réel), mais devra être
    rendu : le solde projeté le neutralise via le reste dû."""
    compte = _make_compte(db_session, "Courant", solde_initial=500.0)
    _make_operation(
        db_session,
        compte,
        type_code="pret",
        montant=1000.0,
        sens=Sens.entree,
        statut=Statut.reel,
        montant_du=1000.0,
        montant_a_rembourser=1000.0,
    )

    resultat = _solde_compte(db_session, compte.id)

    assert resultat["solde_reel"] == 1500.0
    assert resultat["solde_projete"] == 500.0


def test_rembourser_un_pret_ne_penalise_pas_deux_fois_le_solde_projete(db_session):
    """Après remboursement partiel, la sortie de trésorerie est compensée par
    la baisse du reste dû : le solde projeté reste stable."""
    compte = _make_compte(db_session, "Courant", solde_initial=500.0)
    pret = _make_operation(
        db_session,
        compte,
        type_code="pret",
        montant=1000.0,
        sens=Sens.entree,
        statut=Statut.reel,
        montant_du=1000.0,
        montant_a_rembourser=1000.0,
    )
    assert _solde_compte(db_session, compte.id)["solde_projete"] == 500.0

    # 300 remboursés : sortie réelle de 300, reste dû ramené à 700.
    _make_operation(
        db_session,
        compte,
        type_code="remboursement_pret",
        montant=300.0,
        sens=Sens.depense,
        statut=Statut.reel,
    )
    pret.montant_a_rembourser = 700.0
    db_session.commit()

    resultat = _solde_compte(db_session, compte.id)

    assert resultat["solde_reel"] == 1200.0
    assert resultat["solde_projete"] == 500.0


def test_pret_entierement_rembourse_ne_deduit_plus_rien(db_session):
    compte = _make_compte(db_session, "Courant", solde_initial=500.0)
    _make_operation(
        db_session,
        compte,
        type_code="pret",
        montant=1000.0,
        sens=Sens.entree,
        statut=Statut.reel,
        montant_du=1000.0,
        montant_a_rembourser=0.0,
    )
    _make_operation(
        db_session,
        compte,
        type_code="remboursement_pret",
        montant=1000.0,
        sens=Sens.depense,
        statut=Statut.reel,
    )

    resultat = _solde_compte(db_session, compte.id)

    assert resultat["solde_reel"] == 500.0
    assert resultat["solde_projete"] == 500.0


def test_depenses_par_categorie_previsionnel_cumule_le_reel(db_session):
    compte = _make_compte(db_session, "Courant")
    _make_operation(
        db_session, compte, categorie="Alimentaire", montant=50.0,
        sens=Sens.depense, statut=Statut.reel,
    )
    _make_operation(
        db_session, compte, categorie="Alimentaire", montant=20.0,
        sens=Sens.depense, statut=Statut.previsionnel,
    )
    # Une entrée d'argent (sens != dépense) ne doit pas compter comme une dépense.
    _make_operation(
        db_session, compte, categorie="Entrées d'argent", montant=1000.0,
        sens=Sens.entree, statut=Statut.reel,
    )
    # Une opération hors du mois demandé ne doit pas compter.
    _make_operation(
        db_session, compte, categorie="Alimentaire", montant=999.0,
        sens=Sens.depense, statut=Statut.reel, date=date(2026, 6, 15),
    )

    resultats = {
        r["categorie"]: r for r in soldes.get_depenses_par_categorie(db_session, 2026, 7, get_monnaie_id(db_session))
    }

    assert resultats["Alimentaire"]["total_reel"] == 50.0
    # Le prévisionnel est cumulatif : réel (50) + prévisionnel seul (20).
    assert resultats["Alimentaire"]["total_previsionnel"] == 70.0
    # « Entrées d'argent » n'a PAS de barre du tout : ses opérations sont des
    # entrées, et l'histogramme ne somme que des dépenses. Une barre qui ne peut
    # être qu'à zéro n'apprend rien et laisse croire qu'il ne s'y passe rien
    # (cf. soldes.get_depenses_par_categorie).
    assert "Entrées d'argent" not in resultats
    assert "Virement interne" not in resultats
    assert "Remboursements" not in resultats


def test_flux_periode_exclut_tous_les_virements(db_session):
    """Le point sensible : rien de ce qui ne fait que DÉPLACER de l'argent ne
    doit peser sur les entrées, les sorties ni leur différence."""
    courant = _make_compte(db_session, "CC")
    autre_courant = _make_compte(db_session, "CC bis")
    livret = _make_compte(db_session, "Livret", type_nom="épargne")

    _make_operation(
        db_session, courant, categorie="Alimentaire", montant=200.0,
        sens=Sens.depense, statut=Statut.reel,
    )
    _make_operation(
        db_session, courant, categorie="Entrées d'argent", montant=3000.0,
        sens=Sens.entree, statut=Statut.reel,
    )
    # Prévisionnel : compté aussi, la période « s'annonce » avec.
    _make_operation(
        db_session, courant, categorie="Alimentaire", montant=50.0,
        sens=Sens.depense, statut=Statut.previsionnel,
    )

    def flux():
        return soldes.get_flux_periode(db_session, 2026, 7, get_monnaie_id(db_session))

    attendu = {"entrees": 3000.0, "sorties": 250.0, "variation": 2750.0}
    assert flux() == attendu

    # Trois virements, trois formes différentes : vers l'épargne, entre deux
    # comptes courants, et retour de l'épargne. Aucun ne bouge quoi que ce soit.
    for source, destination in (
        (courant, livret),
        (courant, autre_courant),
        (livret, courant),
    ):
        crud.create_virement(
            db_session,
            schemas.VirementCreate(
                date=date(2026, 7, 6),
                compte_source_id=source.id,
                compte_destination_id=destination.id,
                montant=500.0,
                monnaie_id=get_monnaie_id(db_session),
                nature="mouvement interne",
            ),
            source,
            destination,
        )
    assert flux() == attendu

    # La variation reste exactement entrées − sorties : les trois chiffres
    # affichés côte à côte doivent s'accorder.
    resultat = flux()
    assert resultat["variation"] == resultat["entrees"] - resultat["sorties"]
    assert soldes.get_variation_previsionnelle(
        db_session, 2026, 7, get_monnaie_id(db_session)
    ) == resultat["variation"]


def test_flux_periode_sur_lannee_entiere(db_session):
    """mois=None : la vue annuelle agrège les douze mois, virements toujours
    exclus."""
    courant = _make_compte(db_session, "CC")
    _make_operation(
        db_session, courant, categorie="Alimentaire", montant=100.0,
        sens=Sens.depense, statut=Statut.reel, date=date(2026, 2, 3),
    )
    _make_operation(
        db_session, courant, categorie="Entrées d'argent", montant=400.0,
        sens=Sens.entree, statut=Statut.reel, date=date(2026, 9, 3),
    )
    # Hors année : ignoré.
    _make_operation(
        db_session, courant, categorie="Alimentaire", montant=999.0,
        sens=Sens.depense, statut=Statut.reel, date=date(2025, 9, 3),
    )

    annee = soldes.get_flux_periode(db_session, 2026, None, get_monnaie_id(db_session))
    assert annee == {"entrees": 400.0, "sorties": 100.0, "variation": 300.0}


def test_le_sens_dun_virement_ne_se_devine_pas(db_session):
    """Garde-fou : sans sens imposé, un virement serait enregistré en
    « dépense » et compterait dans les sorties de la période."""
    import pytest

    with pytest.raises(ValueError, match="virement interne"):
        crud._sens_pour_type("virement", None)


def test_depenses_par_categorie_ignore_les_categories_eteintes(db_session):
    """L'œil de l'onglet Catégories retire la catégorie de l'histogramme —
    et de rien d'autre : l'opération reste bien classée dessus."""
    compte = _make_compte(db_session, "Courant")
    _make_operation(
        db_session, compte, categorie="Alimentaire", montant=50.0,
        sens=Sens.depense, statut=Statut.reel,
    )

    categorie = crud.get_categorie_by_nom(db_session, "Alimentaire")
    crud.set_visibilite_dashboard_categorie(db_session, categorie, False)

    resultats = {
        r["categorie"]: r
        for r in soldes.get_depenses_par_categorie(db_session, 2026, 7, get_monnaie_id(db_session))
    }
    assert "Alimentaire" not in resultats
    # Les autres sont intactes : c'est un filtre, pas une purge.
    assert "Loisirs & sorties" in resultats
    # L'opération n'a pas bougé de catégorie.
    assert (
        db_session.query(models.Operation)
        .filter(models.Operation.categorie_id == categorie.id)
        .count()
        == 1
    )

    # Rallumer la remet exactement où elle était.
    crud.set_visibilite_dashboard_categorie(db_session, categorie, True)
    resultats = {
        r["categorie"]: r
        for r in soldes.get_depenses_par_categorie(db_session, 2026, 7, get_monnaie_id(db_session))
    }
    assert resultats["Alimentaire"]["total_reel"] == 50.0


def test_depenses_par_categorie_deduit_le_montant_du_pour_les_remboursables(db_session):
    compte = _make_compte(db_session, "Courant")
    # Facture de 80, dont seuls 30 sont ma part (le reste est dû par un ami) ;
    # peu importe si c'est déjà remboursé ou non, la valeur retenue est fixe.
    _make_operation(
        db_session,
        compte,
        categorie="Loisirs & sorties",
        montant=80.0,
        sens=Sens.depense,
        statut=Statut.reel,
        type_code="remboursable",
        montant_du=30.0,
        montant_a_rembourser=0.0,  # déjà entièrement remboursé
    )

    resultats = {
        r["categorie"]: r for r in soldes.get_depenses_par_categorie(db_session, 2026, 7, get_monnaie_id(db_session))
    }

    assert resultats["Loisirs & sorties"]["total_reel"] == 50.0  # 80 - 30, pas 80 - 0


def test_depenses_par_categorie_resout_le_budget_du_mois(db_session):
    categorie_id = get_categorie_id(db_session, "Alimentaire")
    crud.set_budget_categorie(db_session, categorie_id, 2026, 5, get_monnaie_id(db_session), 300.0)

    resultats = {
        r["categorie"]: r for r in soldes.get_depenses_par_categorie(db_session, 2026, 7, get_monnaie_id(db_session))
    }

    # Juillet hérite du budget défini en mai (aucune entrée explicite entre les deux).
    assert resultats["Alimentaire"]["budget_alloue"] == 300.0


def test_depenses_par_categorie_exclut_remboursement_prets(db_session):
    # Un remboursement de prêt est une sortie d'argent (sens dépense), mais ce
    # n'est pas une "dépense par catégorie" au sens du dashboard : la catégorie
    # système "Remboursement prêts" ne doit jamais apparaître dans ce tableau.
    compte = _make_compte(db_session, "Courant")
    _make_operation(
        db_session,
        compte,
        type_code="remboursement_pret",
        montant=80.0,
        sens=Sens.depense,
        statut=Statut.reel,
    )

    resultats = {
        r["categorie"]: r for r in soldes.get_depenses_par_categorie(db_session, 2026, 7, get_monnaie_id(db_session))
    }

    assert "Remboursement prêts" not in resultats
    assert "Prêts" not in resultats


def test_depenses_par_categorie_mode_annee_agrege_tous_les_mois(db_session):
    compte = _make_compte(db_session, "Courant")
    _make_operation(
        db_session, compte, categorie="Alimentaire", montant=50.0,
        sens=Sens.depense, statut=Statut.reel, date=date(2026, 1, 15),
    )
    _make_operation(
        db_session, compte, categorie="Alimentaire", montant=30.0,
        sens=Sens.depense, statut=Statut.reel, date=date(2026, 7, 1),
    )
    # Une autre année ne doit pas compter.
    _make_operation(
        db_session, compte, categorie="Alimentaire", montant=999.0,
        sens=Sens.depense, statut=Statut.reel, date=date(2025, 12, 31),
    )

    resultats_annee = {
        r["categorie"]: r for r in soldes.get_depenses_par_categorie(db_session, 2026, None, get_monnaie_id(db_session))
    }
    resultats_mois = {
        r["categorie"]: r for r in soldes.get_depenses_par_categorie(db_session, 2026, 7, get_monnaie_id(db_session))
    }

    assert resultats_annee["Alimentaire"]["total_reel"] == 80.0
    assert resultats_mois["Alimentaire"]["total_reel"] == 30.0


def test_depenses_par_categorie_mode_annee_somme_le_budget_des_12_mois(db_session):
    categorie_id = get_categorie_id(db_session, "Alimentaire")
    crud.set_budget_categorie(db_session, categorie_id, 2026, 1, get_monnaie_id(db_session), 100.0)
    crud.set_budget_categorie(db_session, categorie_id, 2026, 6, get_monnaie_id(db_session), 200.0)

    resultats = {
        r["categorie"]: r for r in soldes.get_depenses_par_categorie(db_session, 2026, None, get_monnaie_id(db_session))
    }

    # Janvier à mai hérite de 100 (5 mois), juin à décembre hérite de 200 (7 mois).
    assert resultats["Alimentaire"]["budget_alloue"] == 100.0 * 5 + 200.0 * 7


def test_variation_previsionnelle_mode_annee_agrege_tous_les_mois(db_session):
    compte = _make_compte(db_session, "Courant")
    _make_operation(
        db_session, compte, categorie="Entrées d'argent", montant=1000.0,
        sens=Sens.entree, statut=Statut.reel, date=date(2026, 2, 1),
    )
    _make_operation(
        db_session, compte, categorie="Alimentaire", montant=200.0,
        sens=Sens.depense, statut=Statut.reel, date=date(2026, 9, 1),
    )
    _make_operation(
        db_session, compte, categorie="Alimentaire", montant=9999.0,
        sens=Sens.depense, statut=Statut.reel, date=date(2025, 9, 1),
    )

    variation = soldes.get_variation_previsionnelle(db_session, 2026, None, get_monnaie_id(db_session))

    assert variation == 1000.0 - 200.0


def test_variation_previsionnelle_entrees_moins_sorties(db_session):
    compte = _make_compte(db_session, "Courant")
    _make_operation(
        db_session, compte, categorie="Entrées d'argent", montant=2000.0,
        sens=Sens.entree, statut=Statut.reel, date=date(2026, 7, 1),
    )
    _make_operation(
        db_session, compte, categorie="Alimentaire", montant=300.0,
        sens=Sens.depense, statut=Statut.reel, date=date(2026, 7, 5),
    )
    # Une dépense prévisionnelle compte aussi (c'est une variation "prévisionnelle").
    _make_operation(
        db_session, compte, categorie="Charges fixes", montant=700.0,
        sens=Sens.depense, statut=Statut.previsionnel, date=date(2026, 7, 28),
    )
    # Hors du mois demandé -> ignoré.
    _make_operation(
        db_session, compte, categorie="Alimentaire", montant=9999.0,
        sens=Sens.depense, statut=Statut.reel, date=date(2026, 6, 15),
    )

    variation = soldes.get_variation_previsionnelle(db_session, 2026, 7, get_monnaie_id(db_session))

    assert variation == 2000.0 - 300.0 - 700.0


def test_variation_previsionnelle_ignore_les_virements(db_session):
    courant = _make_compte(db_session, "Courant")
    epargne = _make_compte(db_session, "Livret A", type_nom="épargne")
    _make_operation(
        db_session, courant, type_code="virement", montant=500.0,
        sens=Sens.transfert_sortant, statut=Statut.reel, date=date(2026, 7, 10),
    )
    _make_operation(
        db_session, epargne, type_code="virement", montant=500.0,
        sens=Sens.transfert_entrant, statut=Statut.reel, date=date(2026, 7, 10),
    )

    variation = soldes.get_variation_previsionnelle(db_session, 2026, 7, get_monnaie_id(db_session))

    assert variation == 0.0


def test_variation_previsionnelle_exclut_les_comptes_epargne(db_session):
    # Même une opération classique (pas un virement) sur un compte épargne ne
    # doit pas compter : l'épargne est hors logique de "budget courant".
    courant = _make_compte(db_session, "Courant")
    epargne = _make_compte(db_session, "Livret A", type_nom="épargne")
    _make_operation(
        db_session, courant, categorie="Entrées d'argent", montant=1000.0,
        sens=Sens.entree, statut=Statut.reel, date=date(2026, 7, 3),
    )
    _make_operation(
        db_session, epargne, categorie="Entrées d'argent", montant=5000.0,
        sens=Sens.entree, statut=Statut.reel, date=date(2026, 7, 3),
    )

    variation = soldes.get_variation_previsionnelle(db_session, 2026, 7, get_monnaie_id(db_session))

    assert variation == 1000.0


def test_calculer_totaux_comptes_exclut_epargne_sauf_total_avoirs(db_session):
    courant = _make_compte(db_session, "Courant", solde_initial=100.0)
    epargne = _make_compte(db_session, "Livret A", solde_initial=500.0, type_nom="épargne")
    _make_operation(
        db_session, courant, categorie="Entrées d'argent", montant=50.0,
        sens=Sens.entree, statut=Statut.previsionnel,
    )

    comptes_soldes = soldes.get_soldes_comptes(db_session)
    totaux = soldes.calculer_totaux_par_monnaie(comptes_soldes)[get_monnaie_id(db_session)]

    assert totaux["solde_total_courant"] == 100.0
    assert totaux["solde_projete_courant"] == 150.0
    assert totaux["total_avoirs"] == 100.0 + 500.0


def test_solde_projete_ignore_les_operations_posterieures_a_la_periode(db_session):
    """La projection répond à « où j'en serai à la fin du mois affiché », pas
    « à la fin de l'horizon de récurrence » : sans borne, une échéance de
    novembre plombait déjà le projeté de juillet."""
    compte = _make_compte(db_session, "Courant", solde_initial=1000.0)
    _make_operation(
        db_session,
        compte,
        date=date(2026, 7, 15),
        montant=100.0,
        sens=Sens.depense,
        statut=Statut.previsionnel,
    )
    _make_operation(
        db_session,
        compte,
        date=date(2026, 11, 20),
        montant=500.0,
        sens=Sens.depense,
        statut=Statut.previsionnel,
    )

    fin_juillet = soldes.fin_de_periode(2026, 7)
    resultat = _soldes_bornes(db_session, compte, fin_juillet)
    assert resultat["solde_projete"] == 900.0

    # Sur l'année entière, l'échéance de novembre entre bien dans la projection.
    fin_annee = soldes.fin_de_periode(2026, None)
    resultat_annee = _soldes_bornes(db_session, compte, fin_annee)
    assert resultat_annee["solde_projete"] == 400.0


def test_solde_reel_nest_pas_borne_par_la_periode(db_session):
    """Le réel ne compte que du déjà-survenu : le borner ferait disparaître
    l'historique dès qu'on regarde un mois passé."""
    compte = _make_compte(db_session, "Courant", solde_initial=0.0)
    _make_operation(
        db_session, compte, date=date(2026, 3, 1), montant=200.0, sens=Sens.entree, statut=Statut.reel
    )

    resultat = _soldes_bornes(db_session, compte, soldes.fin_de_periode(2026, 1))

    assert resultat["solde_reel"] == 200.0


def test_fin_de_periode_gere_les_mois_courts_et_lannee(db_session):
    assert soldes.fin_de_periode(2026, 2) == date(2026, 2, 28)
    assert soldes.fin_de_periode(2028, 2) == date(2028, 2, 29)  # bissextile
    assert soldes.fin_de_periode(2026, 4) == date(2026, 4, 30)
    assert soldes.fin_de_periode(2026, None) == date(2026, 12, 31)


def test_une_operation_sans_categorie_compte_bien_dans_le_solde(db_session):
    """Les quatre types spéciaux n'ont plus de catégorie. Les agrégats joignent
    donc `categorie` en LEFT JOIN : un INNER JOIN les ferait disparaître du
    solde, ce qui fausserait silencieusement le dashboard."""
    compte = _make_compte(db_session, "Courant", solde_initial=1000.0)
    _make_operation(
        db_session, compte, type_code="remboursements", sens=Sens.entree, montant=250.0
    )

    assert _solde_compte(db_session, compte.id)["solde_reel"] == 1250.0


def test_une_operation_sans_categorie_nalimente_aucune_ligne_du_histogramme(db_session):
    """Symétrique du test précédent : sans catégorie, il n'y a aucune ligne à
    laquelle rattacher la dépense — elle ne doit surtout pas être imputée à une
    catégorie arbitraire."""
    compte = _make_compte(db_session, "Courant")
    _make_operation(db_session, compte, categorie="Alimentaire", montant=40.0)
    _make_operation(db_session, compte, type_code="pret", sens=Sens.entree, montant=300.0)

    lignes = soldes.get_depenses_par_categorie(db_session, 2026, 7, get_monnaie_id(db_session))
    par_nom = {ligne["categorie"]: ligne["total_reel"] for ligne in lignes}

    assert par_nom["Alimentaire"] == 40.0
    assert sum(par_nom.values()) == 40.0
