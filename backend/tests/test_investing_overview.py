"""L'extension « Vue d'ensemble des placements ».

Ce que ces tests protègent, dans l'ordre de ce qui coûterait le plus cher à
casser :

  - ON N'ADDITIONNE JAMAIS DEUX MONNAIES. C'est le choix central de
    l'application, et un camembert est précisément l'endroit où l'enfreindre ne
    se verrait pas : les parts auraient l'air justes ;
  - LE MÊME TITRE SUR DEUX COMPTES EST UNE SEULE LIGNE. C'est la raison d'être
    de cet écran — la page Placements sait déjà répondre compte par compte ;
  - LA SOMME DES PARTS FAIT UN. Une part est ce que le camembert dessine ET ce
    que la légende écrit : deux calculs séparés ne tomberaient pas d'accord.
"""
from datetime import date

from app import crud
from app.constants import SensAction

from .conftest import charger_module_extension, creer_compte, creer_monnaie

service = charger_module_extension("investing-overview", "service_vue_ensemble.py")


# ---------- Outillage ----------


def _compte_titres(db, nom="PEA", monnaies=None):
    return creer_compte(
        db, nom, type_nom="placements financiers", solde_initial=100000.0, monnaies=monnaies
    )


def _monnaie_id(db):
    return crud.get_monnaies(db)[0].id


def _acheter(db, compte, action, quantite, prix, jour=date(2026, 3, 1)):
    return crud.create_operation_action(
        db,
        compte_id=compte.id,
        action=action,
        sens=SensAction.achat,
        quantite=quantite,
        prix_unitaire=prix,
        date_operation=jour,
    )


def _titre(db, nom, cours, type_titre=None, monnaie_id=None):
    return crud.create_action(
        db,
        nom,
        monnaie_id if monnaie_id is not None else _monnaie_id(db),
        cours,
        None,
        type_titre.id if type_titre else None,
    )


def _parts(bloc):
    return {part["type_titre_nom"]: part for part in bloc["parts"]}


# ---------- La répartition ----------


def test_un_portefeuille_vide_ne_rend_aucune_monnaie(db_session):
    """Un onglet vide n'a rien à montrer : l'écran dit la phrase plutôt que de
    dessiner un camembert à zéro part."""
    _compte_titres(db_session)
    assert service.exposition_par_type(db_session) == []


def test_les_parts_sont_groupees_par_type_et_triees_par_poids(db_session):
    compte = _compte_titres(db_session)
    etf = crud.create_type_titre(db_session, "ETF")
    obligation = crud.create_type_titre(db_session, "Obligation")
    _acheter(db_session, compte, _titre(db_session, "MSCI World", 100.0, etf), 10, 90.0)
    _acheter(db_session, compte, _titre(db_session, "S&P 500", 100.0, etf), 10, 90.0)
    _acheter(db_session, compte, _titre(db_session, "OAT 2030", 100.0, obligation), 5, 95.0)

    (bloc,) = service.exposition_par_type(db_session)
    assert [part["type_titre_nom"] for part in bloc["parts"]] == ["ETF", "Obligation"]
    assert _parts(bloc)["ETF"]["valorisation"] == 2000.0
    assert _parts(bloc)["Obligation"]["valorisation"] == 500.0
    assert bloc["total"] == 2500.0


def test_la_somme_des_parts_fait_un(db_session):
    """La part est ce que le camembert dessine ET ce que la légende écrit."""
    compte = _compte_titres(db_session)
    etf = crud.create_type_titre(db_session, "ETF")
    _acheter(db_session, compte, _titre(db_session, "MSCI World", 100.0, etf), 3, 90.0)
    _acheter(db_session, compte, _titre(db_session, "OAT 2030", 100.0), 7, 95.0)

    (bloc,) = service.exposition_par_type(db_session)
    assert round(sum(part["part"] for part in bloc["parts"]), 9) == 1.0


def test_les_titres_sans_etiquette_forment_leur_propre_part(db_session):
    """Le type est facultatif : un portefeuille non typé est un cas normal, pas
    une anomalie à masquer."""
    compte = _compte_titres(db_session)
    _acheter(db_session, compte, _titre(db_session, "Air Liquide", 150.0), 10, 140.0)

    (bloc,) = service.exposition_par_type(db_session)
    (part,) = bloc["parts"]
    assert part["type_titre_id"] is None
    assert part["type_titre_nom"] is None
    assert part["valorisation"] == 1500.0


def test_un_meme_titre_sur_deux_comptes_ne_fait_quune_ligne(db_session):
    """C'est la raison d'être de cet écran : la page Placements répond déjà
    compte par compte."""
    pea = _compte_titres(db_session, "PEA")
    cto = _compte_titres(db_session, "CTO")
    etf = crud.create_type_titre(db_session, "ETF")
    action = _titre(db_session, "MSCI World", 100.0, etf)
    _acheter(db_session, pea, action, 10, 90.0)
    _acheter(db_session, cto, action, 5, 95.0)

    (bloc,) = service.exposition_par_type(db_session)
    (part,) = bloc["parts"]
    assert part["valorisation"] == 1500.0
    assert part["nombre_titres"] == 1
    (titre,) = part["titres"]
    assert titre["action_nom"] == "MSCI World"
    assert titre["valorisation"] == 1500.0
    assert titre["nombre_comptes"] == 2


def test_deux_monnaies_donnent_deux_repartitions_jamais_un_total(db_session):
    """Le choix central de l'application, et l'endroit où l'enfreindre ne se
    verrait pas : les parts auraient l'air justes."""
    dollar = creer_monnaie(db_session, "Dollar", "$")
    euro_id = _monnaie_id(db_session)
    compte = _compte_titres(
        db_session,
        monnaies=[(euro_id, 100000.0), (dollar.id, 100000.0)],
    )
    etf = crud.create_type_titre(db_session, "ETF")
    _acheter(db_session, compte, _titre(db_session, "MSCI World", 100.0, etf), 10, 90.0)
    _acheter(
        db_session,
        compte,
        _titre(db_session, "S&P 500", 200.0, etf, monnaie_id=dollar.id),
        10,
        150.0,
    )

    blocs = service.exposition_par_type(db_session)
    assert len(blocs) == 2
    par_monnaie = {bloc["monnaie_id"]: bloc for bloc in blocs}
    assert par_monnaie[euro_id]["total"] == 1000.0
    assert par_monnaie[dollar.id]["total"] == 2000.0
    # Chaque répartition fait 100 % DANS SA MONNAIE, jamais 50/50 entre elles.
    for bloc in blocs:
        assert round(sum(part["part"] for part in bloc["parts"]), 9) == 1.0


def test_une_position_soldee_disparait_de_la_repartition(db_session):
    compte = _compte_titres(db_session)
    etf = crud.create_type_titre(db_session, "ETF")
    action = _titre(db_session, "MSCI World", 100.0, etf)
    _acheter(db_session, compte, action, 10, 90.0)
    crud.create_operation_action(
        db_session,
        compte_id=compte.id,
        action=action,
        sens=SensAction.vente,
        quantite=10,
        prix_unitaire=110.0,
        date_operation=date(2026, 4, 1),
    )
    assert service.exposition_par_type(db_session) == []


def test_le_detail_dune_part_se_limite_au_top_et_annonce_le_reste(db_session):
    """Une bulle qui énumère tout finirait par couvrir le graphe qu'elle
    commente."""
    compte = _compte_titres(db_session)
    etf = crud.create_type_titre(db_session, "ETF")
    for i, valeur in enumerate([500.0, 400.0, 300.0, 200.0, 100.0]):
        _acheter(db_session, compte, _titre(db_session, f"ETF {i}", valeur, etf), 1, valeur)

    (bloc,) = service.exposition_par_type(db_session)
    (part,) = bloc["parts"]
    assert part["nombre_titres"] == 5
    assert [t["action_nom"] for t in part["titres"]] == ["ETF 0", "ETF 1", "ETF 2"]


def test_le_montant_investi_voyage_a_cote_de_la_valorisation(db_session):
    """L'écart entre les deux est la plus-value latente, que l'écran affiche
    sans la recalculer autrement."""
    compte = _compte_titres(db_session)
    _acheter(db_session, compte, _titre(db_session, "MSCI World", 120.0), 10, 90.0)

    (bloc,) = service.exposition_par_type(db_session)
    assert bloc["total"] == 1200.0
    assert bloc["total_investi"] == 900.0
