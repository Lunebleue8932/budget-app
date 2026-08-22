"""Diagnostic d'un écart entre le solde de l'app et celui de la banque.

Convention rappelée ici parce que tous les tests s'y adossent :
`ecart = solde_banque − solde_app`, et une opération EN TROP dans l'app a un
effet valant −ecart (cf. services/ecarts, en-tête).
"""
from datetime import date

from app import models
from app.constants import Sens, Statut
from app.services import ecarts

from .conftest import creer_compte, creer_monnaie, get_categorie_id, get_monnaie_id, get_type_id


def _make_compte(db, nom="CC Perso", solde_initial=0.0, monnaies=None):
    return creer_compte(db, nom, solde_initial=solde_initial, monnaies=monnaies)


def _make_operation(db, compte, montant, sens=Sens.depense, **kwargs):
    defaults = dict(
        date=date(2026, 7, 1),
        type_id=get_type_id(db, "classique"),
        categorie_id=get_categorie_id(db, "Autres"),
        nature="Test",
        monnaie_id=compte.monnaie_principale_id,
        montant=montant,
        sens=sens,
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


def _diagnostiquer(db, compte, solde_banque, **kwargs):
    return ecarts.diagnostiquer(
        db, compte, compte.monnaie_principale_id, solde_banque, **kwargs
    )


def _types(resultat) -> list[str]:
    return [piste["type"] for piste in resultat["pistes"]]


# ---------- Le calcul de l'écart lui-même ----------


def test_aucun_ecart_ne_propose_aucune_piste(db_session):
    compte = _make_compte(db_session, solde_initial=1000.0)
    _make_operation(db_session, compte, 45.20)

    resultat = _diagnostiquer(db_session, compte, 954.80)

    assert resultat["ecart"] == 0
    assert resultat["pistes"] == []


def test_le_solde_de_lapp_part_du_solde_initial(db_session):
    compte = _make_compte(db_session, solde_initial=500.0)

    resultat = _diagnostiquer(db_session, compte, 500.0)

    assert resultat["solde_app"] == 500.0
    assert resultat["ecart"] == 0


def test_les_operations_previsionnelles_ne_comptent_pas_dans_le_solde(db_session):
    """Une prévisionnelle décrit ce qui n'a pas encore touché le compte : la
    compter ferait diverger le solde de l'app de tout relevé."""
    compte = _make_compte(db_session, solde_initial=100.0)
    _make_operation(db_session, compte, 30.0, statut=Statut.previsionnel)

    resultat = _diagnostiquer(db_session, compte, 100.0)

    assert resultat["solde_app"] == 100.0
    assert resultat["ecart"] == 0


def test_une_date_darrete_borne_la_comparaison(db_session):
    """Un relevé est toujours arrêté à une date : comparer un solde « à ce
    jour » à un relevé du 31 juillet fabriquerait un écart qui n'existe pas."""
    compte = _make_compte(db_session, solde_initial=1000.0)
    _make_operation(db_session, compte, 100.0, date=date(2026, 7, 15))
    _make_operation(db_session, compte, 50.0, date=date(2026, 8, 10))

    au_31_juillet = _diagnostiquer(
        db_session, compte, 900.0, date_fin=date(2026, 7, 31)
    )
    sans_borne = _diagnostiquer(db_session, compte, 900.0)

    assert au_31_juillet["ecart"] == 0
    # Sans borne, l'app a déjà retiré la dépense d'août (850) : le relevé de
    # juillet paraît alors en avance de 50.
    assert sans_borne["solde_app"] == 850.0
    assert sans_borne["ecart"] == 50.0


def test_les_centimes_ne_derivent_pas(db_session):
    """Trois dixièmes en flottant ne font pas 0.30 : sans le passage en
    centimes entiers, l'écart serait non nul et les pistes introuvables."""
    compte = _make_compte(db_session, solde_initial=0.0)
    _make_operation(db_session, compte, 0.10)
    _make_operation(db_session, compte, 0.20)

    resultat = _diagnostiquer(db_session, compte, -0.30)

    assert resultat["ecart"] == 0


# ---------- Piste : une opération isolée ----------


def test_une_depense_en_trop_est_detectee(db_session):
    """La banque a PLUS que l'app : l'app porte une dépense qui n'existe pas."""
    compte = _make_compte(db_session, solde_initial=1000.0)
    fantome = _make_operation(db_session, compte, 45.20, nature="Dépense fantôme")

    resultat = _diagnostiquer(db_session, compte, 1000.0)

    assert resultat["ecart"] == 45.20
    assert _types(resultat)[0] == "operation_en_trop"
    assert resultat["pistes"][0]["operations"][0].id == fantome.id


def test_une_entree_en_trop_est_detectee(db_session):
    """La banque a MOINS que l'app : une entrée saisie pour rien."""
    compte = _make_compte(db_session, solde_initial=1000.0)
    fantome = _make_operation(db_session, compte, 200.0, sens=Sens.entree)

    resultat = _diagnostiquer(db_session, compte, 1000.0)

    assert resultat["ecart"] == -200.0
    assert _types(resultat)[0] == "operation_en_trop"
    assert resultat["pistes"][0]["operations"][0].id == fantome.id


def test_un_doublon_exact_ressort_comme_operation_en_trop(db_session):
    """Le doublon n'a pas de piste à lui : deux opérations identiques dont une
    est de trop, c'est exactement une opération dont l'effet vaut l'écart. Les
    deux sont proposées — l'app ne peut pas savoir laquelle est la bonne."""
    compte = _make_compte(db_session, solde_initial=1000.0)
    _make_operation(db_session, compte, 30.0, nature="Courses")
    _make_operation(db_session, compte, 30.0, nature="Courses")

    resultat = _diagnostiquer(db_session, compte, 970.0)

    assert resultat["ecart"] == 30.0
    isolees = [p for p in resultat["pistes"] if p["type"] == "operation_en_trop"]
    assert len(isolees) == 2


def test_un_transfert_sortant_compte_comme_une_depense(db_session):
    compte = _make_compte(db_session, solde_initial=1000.0)
    virement = _make_operation(
        db_session,
        compte,
        250.0,
        sens=Sens.transfert_sortant,
        # Un virement interne ne porte aucune catégorie : son type EST sa
        # classification.
        type_id=get_type_id(db_session, "virement"),
        categorie_id=None,
    )

    resultat = _diagnostiquer(db_session, compte, 1000.0)

    assert resultat["ecart"] == 250.0
    assert resultat["pistes"][0]["operations"][0].id == virement.id


# ---------- Piste : signe inversé ----------


def test_une_depense_saisie_en_entree_est_detectee(db_session):
    """L'écart vaut alors DEUX fois le montant : on retire l'effet d'un côté,
    on l'ajoute de l'autre."""
    compte = _make_compte(db_session, solde_initial=1000.0)
    inversee = _make_operation(db_session, compte, 80.0, sens=Sens.entree)

    # App : 1000 + 80 = 1080. Banque : 1000 − 80 = 920. Écart = −160.
    resultat = _diagnostiquer(db_session, compte, 920.0)

    assert resultat["ecart"] == -160.0
    pistes = [p for p in resultat["pistes"] if p["type"] == "signe_inverse"]
    assert len(pistes) == 1
    assert pistes[0]["operations"][0].id == inversee.id


def test_un_ecart_impair_en_centimes_nest_jamais_un_signe_inverse(db_session):
    """Corriger un sens déplace toujours le solde d'un nombre PAIR de centimes :
    un écart impair ne peut pas venir de là, et l'arrondir proposerait des
    pistes fausses."""
    compte = _make_compte(db_session, solde_initial=1000.0)
    _make_operation(db_session, compte, 10.01, sens=Sens.entree)

    resultat = _diagnostiquer(db_session, compte, 1010.00)

    assert resultat["ecart"] == -0.01
    assert "signe_inverse" not in _types(resultat)


# ---------- Piste : une prévisionnelle déjà passée ----------


def test_une_previsionnelle_du_bon_montant_est_proposee(db_session):
    """Le prélèvement est bien saisi, il est simplement resté prévisionnel
    alors que la banque l'a déjà passé."""
    compte = _make_compte(db_session, solde_initial=1000.0)
    en_attente = _make_operation(
        db_session, compte, 75.0, statut=Statut.previsionnel, nature="Loyer"
    )

    # La banque a déjà débité : elle a 75 de moins que l'app.
    resultat = _diagnostiquer(db_session, compte, 925.0)

    assert resultat["ecart"] == -75.0
    pistes = [p for p in resultat["pistes"] if p["type"] == "previsionnelle_a_pointer"]
    assert len(pistes) == 1
    assert pistes[0]["operations"][0].id == en_attente.id


# ---------- Piste : combinaisons ----------


def test_deux_operations_totalisant_lecart_sont_proposees(db_session):
    compte = _make_compte(db_session, solde_initial=1000.0)
    _make_operation(db_session, compte, 20.0, nature="A")
    _make_operation(db_session, compte, 30.0, nature="B")

    # Les deux sont en trop : la banque a 50 de plus.
    resultat = _diagnostiquer(db_session, compte, 1000.0)

    assert resultat["ecart"] == 50.0
    paires = [
        p for p in resultat["pistes"] if p["type"] == "combinaison" and len(p["operations"]) == 2
    ]
    assert len(paires) == 1
    assert {op.nature for op in paires[0]["operations"]} == {"A", "B"}


def test_une_paire_nest_pas_proposee_deux_fois(db_session):
    """(A, B) et (B, A) sont la même piste : sans dédoublonnage, chacune
    s'afficherait deux fois."""
    compte = _make_compte(db_session, solde_initial=1000.0)
    _make_operation(db_session, compte, 20.0, nature="A")
    _make_operation(db_session, compte, 30.0, nature="B")

    resultat = _diagnostiquer(db_session, compte, 1000.0)

    paires = [p for p in resultat["pistes"] if len(p["operations"]) == 2]
    assert len(paires) == 1


def test_trois_operations_totalisant_lecart_sont_proposees(db_session):
    compte = _make_compte(db_session, solde_initial=1000.0)
    _make_operation(db_session, compte, 11.0, nature="A")
    _make_operation(db_session, compte, 22.0, nature="B")
    _make_operation(db_session, compte, 33.0, nature="C")

    resultat = _diagnostiquer(db_session, compte, 1000.0)

    assert resultat["ecart"] == 66.0
    triplets = [p for p in resultat["pistes"] if len(p["operations"]) == 3]
    assert len(triplets) == 1
    assert {op.nature for op in triplets[0]["operations"]} == {"A", "B", "C"}


def test_une_combinaison_melange_entrees_et_sorties(db_session):
    """Ce sont les EFFETS qui s'additionnent, pas les montants : une entrée en
    trop et une dépense en trop se compensent partiellement."""
    compte = _make_compte(db_session, solde_initial=1000.0)
    _make_operation(db_session, compte, 100.0, sens=Sens.entree, nature="Entrée")
    _make_operation(db_session, compte, 40.0, nature="Sortie")

    # App : 1000 + 100 − 40 = 1060. Les deux sont en trop → banque = 1000.
    resultat = _diagnostiquer(db_session, compte, 1000.0)

    assert resultat["ecart"] == -60.0
    paires = [p for p in resultat["pistes"] if len(p["operations"]) == 2]
    assert len(paires) == 1


# ---------- Ordre, plafonds et périmètre ----------


def test_la_piste_la_plus_simple_vient_en_premier(db_session):
    """Une opération isolée avant une combinaison : c'est dans cet ordre qu'on
    a une chance de reconnaître la vraie cause."""
    compte = _make_compte(db_session, solde_initial=1000.0)
    _make_operation(db_session, compte, 50.0, nature="Pile l'écart")
    _make_operation(db_session, compte, 20.0, nature="A")
    _make_operation(db_session, compte, 30.0, nature="B")

    # App : 1000 − 50 − 20 − 30 = 900. L'écart de 50 s'explique par l'isolée
    # OU par la paire A+B.
    resultat = _diagnostiquer(db_session, compte, 950.0)

    assert resultat["ecart"] == 50.0
    assert _types(resultat)[0] == "operation_en_trop"


def test_trop_de_pistes_identiques_sont_plafonnees_et_signalees(db_session):
    """Vingt opérations du même montant ne désignent rien : on coupe, et on le
    dit — une liste courte ne doit pas passer pour exhaustive."""
    compte = _make_compte(db_session, solde_initial=1000.0)
    for i in range(ecarts.MAX_PISTES_PAR_FAMILLE + 5):
        _make_operation(db_session, compte, 10.0, nature=f"Op {i}")

    resultat = _diagnostiquer(db_session, compte, 1000.0 - 10.0 * (ecarts.MAX_PISTES_PAR_FAMILLE + 5) + 10.0)

    isolees = [p for p in resultat["pistes"] if p["type"] == "operation_en_trop"]
    assert len(isolees) == ecarts.MAX_PISTES_PAR_FAMILLE
    assert resultat["tronque"] is True


def test_un_ecart_quaucune_operation_nexplique_ne_propose_rien(db_session):
    """Quand l'erreur vient d'ailleurs — le solde initial, un autre compte —
    l'app doit rendre une liste VIDE plutôt que la combinaison la plus proche :
    proposer à tout prix enverrait chercher au mauvais endroit."""
    compte = _make_compte(db_session, solde_initial=1000.0)
    _make_operation(db_session, compte, 45.0)
    _make_operation(db_session, compte, 60.0)

    # 7,77 ne tombe sur aucune somme d'au plus trois opérations.
    resultat = _diagnostiquer(db_session, compte, 895.0 + 7.77)

    assert resultat["ecart"] == 7.77
    assert resultat["pistes"] == []
    assert resultat["nb_operations_analysees"] == 2


def test_seules_les_operations_du_compte_et_de_la_monnaie_sont_analysees(db_session):
    """Un compte a un solde PAR monnaie : mélanger les deux reviendrait à
    additionner des euros et des dollars."""
    euro_id = get_monnaie_id(db_session)
    dollar_id = creer_monnaie(db_session, "Dollar", "$").id
    compte = _make_compte(
        db_session, monnaies=[(euro_id, 1000.0), (dollar_id, 500.0)]
    )
    autre_compte = _make_compte(db_session, nom="Livret A", solde_initial=0.0)

    _make_operation(db_session, compte, 40.0, monnaie_id=dollar_id, nature="En dollars")
    _make_operation(db_session, autre_compte, 40.0, nature="Autre compte")

    resultat = ecarts.diagnostiquer(db_session, compte, euro_id, 1000.0)

    assert resultat["ecart"] == 0
    assert resultat["nb_operations_analysees"] == 0
    assert resultat["monnaie_id"] == euro_id
