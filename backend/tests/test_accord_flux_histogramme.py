"""Le total des sorties et l'histogramme des dépenses doivent dire la même chose.

Les deux chiffres sont affichés L'UN À CÔTÉ DE L'AUTRE sur le dashboard : un
total qui ne serait pas la somme des barres posées juste en dessous n'est pas
« une autre façon de compter », c'est une contradiction que l'utilisateur passe
sa soirée à essayer de résoudre.

CE QUI LES FAISAIT DIVERGER, et qui est corrigé ici : une dépense remboursable
comptait pour son montant ENTIER dans le total, alors que l'histogramme n'en
retient que la part restant à charge. Avancer 100 € qu'on vous rendra
intégralement gonflait donc le total de 100 € sans faire bouger une seule barre.

CE QUI LES FAIT LÉGITIMEMENT DIVERGER, et qu'on ne cherche pas à corriger :
éteindre une catégorie (l'œil du dashboard) la retire des barres sans la retirer
du total. C'est un réglage d'affichage assumé, et le vérifier ici l'empêche de
disparaître par accident.
"""
from datetime import date

import pytest

from app import crud, schemas
from app.constants import Statut
from app.services import soldes

from .conftest import creer_compte, get_categorie_id, get_monnaie_id, get_type_id


def _depense(db, compte, montant, **kwargs):
    defaults = dict(
        date=date(2026, 3, 10),
        compte_id=compte.id,
        monnaie_id=get_monnaie_id(db),
        type_id=get_type_id(db, "classique"),
        categorie_id=get_categorie_id(db, "Alimentaire"),
        nature="Courses",
        montant=montant,
        statut=Statut.reel,
    )
    defaults.update(kwargs)
    return crud.create_operation(db, schemas.OperationCreate(**defaults))


def _somme_histogramme(db, annee=2026, mois=3):
    return sum(
        ligne["total_previsionnel"]
        for ligne in soldes.get_depenses_par_categorie(db, annee, mois, get_monnaie_id(db))
    )


def _sorties(db, annee=2026, mois=3):
    return soldes.get_flux_periode(db, annee, mois, get_monnaie_id(db))["sorties"]


def _accord(db):
    """Les deux chiffres, pour les comparer d'un coup d'œil dans les assertions."""
    return pytest.approx(_somme_histogramme(db)), _sorties(db)


# ---------- L'accord ----------


def test_une_depense_ordinaire_compte_pareil_des_deux_cotes(db_session):
    compte = creer_compte(db_session, "Courant", solde_initial=1000.0)
    _depense(db_session, compte, 80.0)
    attendu, obtenu = _accord(db_session)
    assert obtenu == attendu == pytest.approx(80.0)


def test_une_depense_remboursable_ne_compte_que_pour_sa_part_a_charge(db_session):
    """LE CAS QUI DIVERGEAIT. 100 € avancés dont 60 seront rendus : la dépense
    vaut 40 €, des deux côtés."""
    compte = creer_compte(db_session, "Courant", solde_initial=1000.0)
    _depense(
        db_session,
        compte,
        100.0,
        type_id=get_type_id(db_session, "remboursable"),
        montant_du=60.0,
    )
    attendu, obtenu = _accord(db_session)
    assert obtenu == attendu == pytest.approx(40.0)


def test_une_depense_integralement_remboursable_ne_coute_rien(db_session):
    """Elle gonflait le total de son montant entier sans faire bouger une barre."""
    compte = creer_compte(db_session, "Courant", solde_initial=1000.0)
    _depense(
        db_session,
        compte,
        100.0,
        type_id=get_type_id(db_session, "remboursable"),
        montant_du=100.0,
    )
    attendu, obtenu = _accord(db_session)
    assert obtenu == attendu == pytest.approx(0.0)


def test_le_remboursement_deja_recu_ne_change_pas_le_cout(db_session):
    """`montant_du` (ce qu'on te doit au départ, figé) et non
    `montant_a_rembourser` (ce qui reste dû) : ce qu'une dépense coûte ne dépend
    pas de la date à laquelle on te rembourse."""
    compte = creer_compte(db_session, "Courant", solde_initial=1000.0)
    operation = _depense(
        db_session,
        compte,
        100.0,
        type_id=get_type_id(db_session, "remboursable"),
        montant_du=60.0,
    )
    # Comme si 25 € avaient déjà été rendus : il en reste 35 à recevoir.
    operation.montant_a_rembourser = 35.0
    db_session.commit()

    attendu, obtenu = _accord(db_session)
    assert obtenu == attendu == pytest.approx(40.0)


def test_un_melange_de_depenses_tombe_juste(db_session):
    compte = creer_compte(db_session, "Courant", solde_initial=5000.0)
    _depense(db_session, compte, 80.0)
    _depense(db_session, compte, 45.5, categorie_id=get_categorie_id(db_session, "Loisirs & sorties"))
    _depense(
        db_session,
        compte,
        100.0,
        type_id=get_type_id(db_session, "remboursable"),
        montant_du=60.0,
    )
    _depense(db_session, compte, 30.0, statut=Statut.previsionnel)

    attendu, obtenu = _accord(db_session)
    assert obtenu == attendu == pytest.approx(80.0 + 45.5 + 40.0 + 30.0)


def test_une_depense_amortie_et_remboursable_tombe_juste_aussi(db_session):
    """Le seul cas qui cumulait les deux règles, et donc le dernier à pouvoir
    diverger."""
    compte = creer_compte(db_session, "Courant", solde_initial=5000.0)
    _depense(
        db_session,
        compte,
        1200.0,
        date=date(2026, 1, 15),
        type_id=get_type_id(db_session, "remboursable"),
        montant_du=600.0,
        amorti=True,
        amortissement_debut=date(2026, 1, 1),
        amortissement_fin=date(2026, 12, 1),
    )
    attendu, obtenu = _accord(db_session)
    # 600 € à charge, étalés sur douze mois : 50 € pour mars.
    assert obtenu == attendu == pytest.approx(50.0)


def _pret(db, compte, montant, montant_du, **kwargs):
    defaults = dict(
        date=date(2026, 3, 10),
        compte_id=compte.id,
        monnaie_id=get_monnaie_id(db),
        type_id=get_type_id(db, "pret"),
        nature="Prêt d'un ami",
        montant=montant,
        montant_du=montant_du,
        statut=Statut.reel,
    )
    defaults.update(kwargs)
    return crud.create_operation(db, schemas.OperationCreate(**defaults))


def test_le_capital_dun_pret_nest_pas_un_revenu(db_session):
    """L'argent emprunté n'est pas une entrée : il faudra le rendre. Il comptait
    auparavant pour son montant entier en entrées, ce qui faisait passer un mois
    où l'on emprunte pour un mois où l'on gagne."""
    compte = creer_compte(db_session, "Courant", solde_initial=1000.0)
    _pret(db_session, compte, montant=1000.0, montant_du=1000.0)

    flux = soldes.get_flux_periode(db_session, 2026, 3, get_monnaie_id(db_session))
    assert flux["entrees"] == pytest.approx(0.0)


def test_les_interets_dun_pret_ne_peuvent_pas_etre_negatifs(db_session):
    """LE SCHÉMA REFUSE ENCORE `montant_du > montant` (cf.
    schemas._check_montants_remboursement) : un prêt ne peut donc porter aucun
    intérêt, et `montant_du - montant` est au mieux nul, au pire négatif.

    Sans la borne à zéro, un prêt RETIRERAIT des sorties — un emprunt ferait
    baisser le total des dépenses du mois. Ce test tient cette borne le temps que
    la validation soit assouplie pour les prêts."""
    compte = creer_compte(db_session, "Courant", solde_initial=1000.0)
    _pret(db_session, compte, montant=1000.0, montant_du=400.0)

    flux = soldes.get_flux_periode(db_session, 2026, 3, get_monnaie_id(db_session))
    assert flux["sorties"] == pytest.approx(0.0), "jamais de sortie négative"
    assert _somme_histogramme(db_session) == pytest.approx(0.0)


def test_un_pret_sans_interets_ne_pese_rien_et_najoute_aucune_barre(db_session):
    """Rendre exactement ce qu'on a reçu ne coûte rien : une barre à zéro
    encombrerait l'histogramme de quiconque a déjà emprunté."""
    compte = creer_compte(db_session, "Courant", solde_initial=1000.0)
    _pret(db_session, compte, montant=1000.0, montant_du=1000.0)

    flux = soldes.get_flux_periode(db_session, 2026, 3, get_monnaie_id(db_session))
    assert (flux["entrees"], flux["sorties"]) == (0.0, 0.0)
    barres = [
        ligne["categorie"]
        for ligne in soldes.get_depenses_par_categorie(
            db_session, 2026, 3, get_monnaie_id(db_session)
        )
    ]
    assert "Intérêts de prêts" not in barres


def test_un_remboursement_de_pret_ne_compte_nulle_part(db_session):
    """Il solde une dette dont le coût a déjà été compté à sa naissance. C'est
    lui qui creusait l'écart : sans catégorie, il ne pouvait apparaître dans
    aucune barre tout en pesant sur le total."""
    compte = creer_compte(db_session, "Courant", solde_initial=5000.0)
    crud.create_operation(
        db_session,
        schemas.OperationCreate(
            date=date(2026, 3, 15),
            compte_id=compte.id,
            monnaie_id=get_monnaie_id(db_session),
            type_id=get_type_id(db_session, "remboursement_pret"),
            nature="Mensualité",
            montant=200.0,
            statut=Statut.reel,
        ),
    )
    attendu, obtenu = _accord(db_session)
    assert obtenu == attendu == pytest.approx(0.0)


def test_un_remboursement_recu_ne_compte_nulle_part(db_session):
    """Symétrique : la dépense remboursable a déjà été ramenée à ce qui reste à
    charge. Compter en plus le remboursement reçu en entrées ferait ressortir
    l'opération en bénéfice."""
    compte = creer_compte(db_session, "Courant", solde_initial=5000.0)
    _depense(
        db_session,
        compte,
        100.0,
        type_id=get_type_id(db_session, "remboursable"),
        montant_du=60.0,
    )
    crud.create_operation(
        db_session,
        schemas.OperationCreate(
            date=date(2026, 3, 20),
            compte_id=compte.id,
            monnaie_id=get_monnaie_id(db_session),
            type_id=get_type_id(db_session, "remboursements"),
            nature="Virement de Marie",
            montant=60.0,
            statut=Statut.reel,
        ),
    )
    flux = soldes.get_flux_periode(db_session, 2026, 3, get_monnaie_id(db_session))
    assert flux["entrees"] == pytest.approx(0.0)
    assert flux["sorties"] == pytest.approx(40.0)
    assert _somme_histogramme(db_session) == pytest.approx(40.0)


# ---------- Ce qui diverge exprès ----------


def test_eteindre_une_categorie_la_retire_des_barres_pas_du_total(db_session):
    """Assumé : c'est un réglage d'affichage. Le vérifier l'empêche de
    disparaître par accident."""
    compte = creer_compte(db_session, "Courant", solde_initial=1000.0)
    _depense(db_session, compte, 80.0)
    categorie = crud.get_categorie_by_nom(db_session, "Alimentaire")
    crud.set_visibilite_dashboard_categorie(db_session, categorie, False)

    assert _somme_histogramme(db_session) == pytest.approx(0.0)
    assert _sorties(db_session) == pytest.approx(80.0)
