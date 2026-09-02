"""Le détail d'une barre de l'histogramme : les plus grosses dépenses de la
catégorie sur la période, fondues par libellé.

Ce qui est vérifié ici : le classement dit ce qui PÈSE le plus dans la période,
pas ce qui a été payé le plus cher en une fois — deux passages de 25 € sous le
même libellé passent devant un achat isolé de 45 €.
"""
from datetime import date

import pytest

from app import crud, models, schemas
from app.constants import Statut
from app.services import soldes

from .conftest import creer_compte, get_categorie_id, get_monnaie_id, get_type_id


def _depense(db, compte, nature, montant, **kwargs):
    defaults = dict(
        date=date(2026, 7, 15),
        compte_id=compte.id,
        monnaie_id=get_monnaie_id(db),
        type_id=get_type_id(db, "classique"),
        categorie_id=get_categorie_id(db, "Alimentaire"),
        nature=nature,
        montant=montant,
        statut=Statut.reel,
    )
    defaults.update(kwargs)
    return crud.create_operation(db, schemas.OperationCreate(**defaults))


def _top(db, annee=2026, mois=7, categorie="Alimentaire"):
    lignes = soldes.get_depenses_par_categorie(db, annee, mois, get_monnaie_id(db))
    ligne = next(l for l in lignes if l["categorie"] == categorie)
    return ligne["top_depenses"]


# ---------- Classement et agrégation ----------


def test_le_top_est_classe_du_plus_lourd_au_plus_leger(db_session):
    compte = creer_compte(db_session, "Courant")
    _depense(db_session, compte, "Boulangerie", 12.0)
    _depense(db_session, compte, "Restaurant", 45.0)
    _depense(db_session, compte, "Supérette", 30.0)

    top = _top(db_session)

    assert [d["nature"] for d in top] == ["Restaurant", "Supérette", "Boulangerie"]
    assert [d["montant"] for d in top] == [45.0, 30.0, 12.0]


def test_seules_trois_dependes_sont_renvoyees(db_session):
    compte = creer_compte(db_session, "Courant")
    for i, montant in enumerate([10.0, 20.0, 30.0, 40.0, 50.0]):
        _depense(db_session, compte, f"Dépense {i}", montant)

    top = _top(db_session)

    assert len(top) == soldes.NB_TOP_DEPENSES == 3
    assert [d["montant"] for d in top] == [50.0, 40.0, 30.0]


def test_deux_depenses_du_meme_libelle_sont_fondues(db_session):
    """L'EXEMPLE DONNÉ : 45, 40 et 30 €, plus deux fois 25 € sous le même
    libellé — le classement doit montrer 50, 45 et 40, la paire fondue passant
    devant les deux plus grosses dépenses isolées."""
    compte = creer_compte(db_session, "Courant")
    _depense(db_session, compte, "Restaurant", 45.0)
    _depense(db_session, compte, "Essence", 40.0)
    _depense(db_session, compte, "Pharmacie", 30.0)
    _depense(db_session, compte, "Courses Monoprix", 25.0)
    _depense(db_session, compte, "Courses Monoprix", 25.0, date=date(2026, 7, 22))

    top = _top(db_session)

    assert [(d["nature"], d["montant"], d["nombre"]) for d in top] == [
        ("Courses Monoprix", 50.0, 2),
        ("Restaurant", 45.0, 1),
        ("Essence", 40.0, 1),
    ]


def test_une_depense_seule_porte_un_nombre_de_1(db_session):
    """C'est le frontend qui décide de ne pas afficher « (1) » : le serveur
    renvoie toujours le compte réel, sans quoi la règle d'affichage
    dépendrait d'un None à interpréter."""
    compte = creer_compte(db_session, "Courant")
    _depense(db_session, compte, "Restaurant", 45.0)

    assert _top(db_session)[0]["nombre"] == 1


def test_les_libelles_ne_sont_fondus_qu_a_l_identique(db_session):
    """« Café » et « CAFE » restent deux dépenses distinctes, comme pour la
    détection de doublons d'import : les confondre déciderait à la place de
    l'utilisateur que deux libellés visiblement différents n'en font qu'un.
    Les espaces de bord, eux, ne se voient pas et ne comptent pas."""
    compte = creer_compte(db_session, "Courant")
    _depense(db_session, compte, "Café", 10.0)
    _depense(db_session, compte, "CAFE", 8.0)
    _depense(db_session, compte, "  Café  ", 5.0)

    top = _top(db_session)

    assert [(d["nature"], d["montant"], d["nombre"]) for d in top] == [
        ("Café", 15.0, 2),
        ("CAFE", 8.0, 1),
    ]


def test_categorie_sans_depense_a_un_top_vide(db_session):
    creer_compte(db_session, "Courant")

    assert _top(db_session) == []


# ---------- Même périmètre que la barre ----------


def test_le_previsionnel_compte_comme_le_reel(db_session):
    """La barre monte jusqu'au prévisionnel : l'infobulle qui la détaille doit
    couvrir la même hauteur, sinon on survole une barre et on lit des lignes
    qui n'en expliquent qu'une partie."""
    compte = creer_compte(db_session, "Courant")
    _depense(db_session, compte, "Réel", 30.0)
    _depense(db_session, compte, "Prévu", 80.0, statut=Statut.previsionnel)

    top = _top(db_session)

    assert [(d["nature"], d["montant"]) for d in top] == [("Prévu", 80.0), ("Réel", 30.0)]


def test_une_depense_remboursable_ne_compte_que_son_reste_a_charge(db_session):
    """Même base imposable que la barre (cf. _base_imposable) : sans ça, la
    somme des lignes de l'infobulle dépasserait la barre qu'elles détaillent."""
    compte = creer_compte(db_session, "Courant")
    _depense(
        db_session,
        compte,
        "Billets de train",
        300.0,
        type_id=get_type_id(db_session, "remboursable"),
        montant_du=250.0,
    )
    _depense(db_session, compte, "Restaurant", 60.0)

    top = _top(db_session)

    assert [(d["nature"], d["montant"]) for d in top] == [
        ("Restaurant", 60.0),
        ("Billets de train", 50.0),
    ]


def test_une_depense_remboursable_integralement_due_n_apparait_pas(db_session):
    """Reste à charge nul : elle ne pèse rien sur la période et occuperait une
    des trois places pour afficher 0 €."""
    compte = creer_compte(db_session, "Courant")
    _depense(
        db_session,
        compte,
        "Avance pour Léa",
        200.0,
        type_id=get_type_id(db_session, "remboursable"),
        montant_du=200.0,
    )
    _depense(db_session, compte, "Restaurant", 12.0)

    assert [d["nature"] for d in _top(db_session)] == ["Restaurant"]


def test_une_depense_amortie_ne_compte_que_sa_part_du_mois(db_session):
    compte = creer_compte(db_session, "Courant")
    _depense(
        db_session,
        compte,
        "Assurance annuelle",
        1200.0,
        date=date(2026, 7, 15),
        amorti=True,
        amortissement_debut=date(2026, 7, 1),
        amortissement_fin=date(2027, 6, 1),
    )
    _depense(db_session, compte, "Restaurant", 45.0)

    top = _top(db_session)

    # 100 € pour juillet, pas 1200 : sinon l'infobulle contredirait sa barre.
    assert [(d["nature"], d["montant"]) for d in top] == [
        ("Assurance annuelle", 100.0),
        ("Restaurant", 45.0),
    ]


def test_amortie_et_non_amortie_du_meme_libelle_se_fondent(db_session):
    """Les deux chemins de calcul (SQL pour les non amorties, Python pour les
    parts amorties) doivent retomber dans le MÊME seau de libellé."""
    compte = creer_compte(db_session, "Courant")
    _depense(db_session, compte, "Abonnement", 20.0)
    _depense(
        db_session,
        compte,
        "Abonnement",
        600.0,
        amorti=True,
        amortissement_debut=date(2026, 7, 1),
        amortissement_fin=date(2026, 12, 1),
    )

    top = _top(db_session)

    assert len(top) == 1
    assert top[0]["nature"] == "Abonnement"
    assert top[0]["montant"] == pytest.approx(120.0)  # 20 + 600/6
    assert top[0]["nombre"] == 2


def test_la_vue_annuelle_fond_les_douze_mois(db_session):
    compte = creer_compte(db_session, "Courant")
    for mois in (2, 5, 9):
        _depense(db_session, compte, "Courses", 30.0, date=date(2026, mois, 4))
    _depense(db_session, compte, "Vacances", 80.0, date=date(2026, 8, 1))

    top = _top(db_session, mois=None)

    assert [(d["nature"], d["montant"], d["nombre"]) for d in top] == [
        ("Courses", 90.0, 3),
        ("Vacances", 80.0, 1),
    ]


def test_une_depense_hors_periode_n_apparait_pas(db_session):
    compte = creer_compte(db_session, "Courant")
    _depense(db_session, compte, "Juillet", 40.0, date=date(2026, 7, 5))
    _depense(db_session, compte, "Août", 90.0, date=date(2026, 8, 5))

    assert [d["nature"] for d in _top(db_session, mois=7)] == ["Juillet"]
    assert [d["nature"] for d in _top(db_session, mois=8)] == ["Août"]


def test_chaque_categorie_a_son_propre_classement(db_session):
    compte = creer_compte(db_session, "Courant")
    _depense(db_session, compte, "Restaurant", 45.0)
    _depense(
        db_session,
        compte,
        "Loyer",
        900.0,
        categorie_id=get_categorie_id(db_session, "Charges fixes"),
    )

    assert [d["nature"] for d in _top(db_session)] == ["Restaurant"]
    assert [d["nature"] for d in _top(db_session, categorie="Charges fixes")] == ["Loyer"]


def test_une_entree_dargent_ne_pollue_pas_le_classement(db_session):
    """L'histogramme ne montre que des dépenses : une entrée classée dans une
    catégorie visible n'a rien à faire dans le détail d'une barre de sortie.

    Et sa catégorie n'a pas de barre non plus : ne pouvant rien porter ici, elle
    est écartée à la source plutôt que dessinée vide (cf.
    soldes.get_depenses_par_categorie). Son salaire se lit dans « Total
    entrées »."""
    compte = creer_compte(db_session, "Courant")
    _depense(db_session, compte, "Restaurant", 45.0)
    _depense(
        db_session,
        compte,
        "Salaire",
        2000.0,
        categorie_id=get_categorie_id(db_session, "Entrées d'argent"),
    )

    assert [d["nature"] for d in _top(db_session)] == ["Restaurant"]
    barres = soldes.get_depenses_par_categorie(
        db_session, 2026, 7, get_monnaie_id(db_session)
    )
    assert "Entrées d'argent" not in [b["categorie"] for b in barres]


def test_un_virement_interne_nentre_dans_aucun_classement(db_session):
    """Un virement déplace de l'argent entre mes comptes : il ne dépense
    rien, et son sens (transfert_*) l'exclut déjà des barres."""
    source = creer_compte(db_session, "Courant", solde_initial=1000.0)
    destination = creer_compte(db_session, "Livret", type_nom="épargne")
    _depense(db_session, source, "Restaurant", 45.0)
    crud.create_virement(
        db_session,
        schemas.VirementCreate(
            date=date(2026, 7, 10),
            compte_source_id=source.id,
            compte_destination_id=destination.id,
            montant=500.0,
            monnaie_id=get_monnaie_id(db_session),
            nature="Mise de côté",
        ),
        source,
        destination,
    )

    tous = soldes.get_depenses_par_categorie(db_session, 2026, 7, get_monnaie_id(db_session))
    libelles = [d["nature"] for ligne in tous for d in ligne["top_depenses"]]
    assert "Mise de côté" not in libelles
    assert libelles == ["Restaurant"]


def test_le_classement_est_stable_a_montants_egaux(db_session):
    """Deux montants identiques sont départagés par le libellé : sans ça, deux
    affichages successifs des mêmes données pourraient ne pas donner le même
    ordre."""
    compte = creer_compte(db_session, "Courant")
    for nature in ("Zeta", "Alpha", "Mu"):
        _depense(db_session, compte, nature, 20.0)

    assert [d["nature"] for d in _top(db_session)] == ["Alpha", "Mu", "Zeta"]


def test_le_top_ne_depasse_jamais_le_total_de_la_barre(db_session):
    """Invariant : l'infobulle détaille la barre, elle ne peut pas annoncer
    plus qu'elle. Vrai en mélangeant amorti, remboursable et prévisionnel."""
    compte = creer_compte(db_session, "Courant")
    _depense(db_session, compte, "Restaurant", 45.0)
    _depense(db_session, compte, "Restaurant", 15.0, statut=Statut.previsionnel)
    _depense(
        db_session,
        compte,
        "Billets",
        300.0,
        type_id=get_type_id(db_session, "remboursable"),
        montant_du=250.0,
    )
    _depense(
        db_session,
        compte,
        "Assurance",
        1200.0,
        amorti=True,
        amortissement_debut=date(2026, 7, 1),
        amortissement_fin=date(2027, 6, 1),
    )

    lignes = soldes.get_depenses_par_categorie(db_session, 2026, 7, get_monnaie_id(db_session))
    ligne = next(l for l in lignes if l["categorie"] == "Alimentaire")
    somme_top = sum(d["montant"] for d in ligne["top_depenses"])

    assert somme_top <= ligne["total_previsionnel"] + 1e-9
    # Ici les trois libellés tiennent dans le top : la somme vaut le total.
    assert somme_top == pytest.approx(ligne["total_previsionnel"])
