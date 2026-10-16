"""Le test du solde (services/controle_solde) et ce que la détection en fait.

Ce qu'on verrouille : une colonne de solde est reconnue à ses VALEURS — dans
les deux ordres de fichier, le solde après ou avant l'opération, renseigné à
chaque ligne ou seulement en fin de journée — et elle dit en même temps comment
lire les montants : quelle colonne est le débit, quelle valeur du sens est une
sortie. Et ce qui n'est pas un solde ne passe pas pour tel.
"""
import random
from datetime import date, timedelta

import pytest

from app.services.controle_solde import controler_solde
from app.services.detection_colonnes import detecter_colonnes
from app.services.lecture_montants import texte_montant


def _operations(n=60, graine=1):
    """(jour, montant en centimes) en ordre chronologique, plusieurs par jour."""
    rng = random.Random(graine)
    jour, ops = date(2026, 1, 2), []
    while len(ops) < n:
        for _ in range(rng.choice((1, 1, 2, 3))):
            ops.append((jour, rng.choice((-1, -1, -1, 1)) * rng.randint(150, 90_000)))
        jour += timedelta(days=1)
    return ops[:n]


def _soldes(ops, initial=150_000):
    solde, soldes = initial, []
    for _, montant in ops:
        solde += montant
        soldes.append(solde)
    return soldes


def _debit_credit(ops, soldes, fin_de_journee=False):
    lignes = []
    for i, ((jour, m), s) in enumerate(zip(ops, soldes)):
        dernier = i == len(ops) - 1 or ops[i + 1][0] != jour
        lignes.append((
            jour.strftime("%d/%m/%Y"),
            f"OPERATION {i}",
            texte_montant(-m) if m < 0 else "",
            texte_montant(m) if m > 0 else "",
            texte_montant(s) if dernier or not fin_de_journee else "",
        ))
    return lignes


def test_solde_a_chaque_ligne_debit_credit():
    ops = _operations()
    resultat = controler_solde(_debit_credit(ops, _soldes(ops)), ",", None, "croissant")
    assert resultat.statut == "verifie"
    assert (resultat.colonne, resultat.ordre, resultat.moment) == (5, "croissant", "apres")
    lecture = resultat.lecture.en_dict()
    assert (lecture["mode"], lecture["colonne_debit"], lecture["colonne_credit"]) == ("debit_credit", 3, 4)


def test_ordre_decroissant():
    ops = _operations()
    lignes = _debit_credit(ops, _soldes(ops))[::-1]
    resultat = controler_solde(lignes, ",", None, "decroissant")
    assert (resultat.ordre, resultat.moment, resultat.statut) == ("decroissant", "apres", "verifie")
    assert resultat.lecture.en_dict()["colonne_debit"] == 3


def test_le_debit_ne_depend_pas_de_la_place_des_colonnes():
    """Crédit avant débit : le test le dit, sans intitulé ni signe des cellules."""
    ops = _operations()
    lignes = [(d, l, c, db, s) for d, l, db, c, s in _debit_credit(ops, _soldes(ops))]
    lecture = controler_solde(lignes, ",", None, "croissant").lecture.en_dict()
    assert (lecture["colonne_debit"], lecture["colonne_credit"]) == (4, 3)


def test_solde_en_fin_de_journee():
    ops = _operations(n=120)
    lignes = _debit_credit(ops, _soldes(ops), fin_de_journee=True)
    assert sum(1 for l in lignes if l[4]) < len(lignes)
    resultat = controler_solde(lignes, ",", None, "croissant")
    assert (resultat.colonne, resultat.statut) == (5, "verifie")


def test_solde_avant_l_operation():
    ops = _operations()
    soldes = _soldes(ops)
    avant = [s - m for (_, m), s in zip(ops, soldes)]
    resultat = controler_solde(_debit_credit(ops, avant), ",", None, "croissant")
    assert (resultat.moment, resultat.statut) == ("avant", "verifie")


def test_montant_et_sens_disent_quelle_valeur_est_le_debit():
    ops = _operations()
    lignes = [
        (j.strftime("%d/%m/%Y"), f"OP {i}", texte_montant(abs(m)), "OUT" if m < 0 else "IN", texte_montant(s))
        for i, ((j, m), s) in enumerate(zip(ops, _soldes(ops)))
    ]
    lecture = controler_solde(lignes, ",", None, "croissant").lecture.en_dict()
    assert lecture["mode"] == "montant_sens"
    assert (lecture["sens_sortie"], lecture["sens_entree"]) == (["out"], ["in"])


def test_montant_algebrique_et_signe_inverse():
    ops = _operations()
    droit = [(j.strftime("%d/%m/%Y"), texte_montant(m), texte_montant(s)) for (j, m), s in zip(ops, _soldes(ops))]
    lecture = controler_solde(droit, ",", None, "croissant").lecture.en_dict()
    assert (lecture["mode"], lecture["signe_inverse"]) == ("algebrique", False)
    inverse = [(d, texte_montant(-int(m.replace(",", ""))), s) for d, m, s in droit]
    assert controler_solde(inverse, ",", None, "croissant").lecture.en_dict()["signe_inverse"]


def test_un_taux_moyen_reste_probable():
    """Un solde faux sur huit (deux intervalles cassés chacun) : le test le dit
    probable, sans verrou."""
    ops = _operations(n=60)
    soldes = _soldes(ops)
    abimes = [s + (7_00 if i % 8 == 0 else 0) for i, s in enumerate(soldes)]
    resultat = controler_solde(_debit_credit(ops, abimes), ",", None, "croissant")
    assert resultat is not None and resultat.statut == "probable"


@pytest.mark.parametrize(
    "colonne",
    [
        # Des nombres au hasard : aucun intervalle ne tient.
        lambda rng, i: texte_montant(rng.randint(0, 900_000)),
        # Une colonne constante : jamais un solde.
        lambda rng, i: "1500,00",
        # Un numéro qui croît : il bouge, mais pas du montant des opérations.
        lambda rng, i: str(100_000 + i),
    ],
)
def test_ce_qui_n_est_pas_un_solde_ne_passe_pas(colonne):
    rng = random.Random(3)
    ops = _operations()
    lignes = [
        (j.strftime("%d/%m/%Y"), f"OP {i}", texte_montant(m), colonne(rng, i))
        for i, (j, m) in enumerate(ops)
    ]
    assert controler_solde(lignes, ",", None, "croissant") is None


def test_des_deltas_nuls_ne_prouvent_rien():
    """Montants et variations tous nuls : 100 % d'égalités, aucune preuve."""
    lignes = [(f"0{j}/01/2026", "OP", "0,00", "1000,00") for j in range(1, 9)]
    assert controler_solde(lignes, ",", None, "croissant") is None


def test_la_detection_verrouille_ce_que_le_solde_prouve():
    """Sans intitulés, deux colonnes de nombres positifs et un solde : le
    test dit lequel est le débit, et la détection le tient pour sûr."""
    ops = _operations(n=80)
    lignes = [(d, l, c, db, s) for d, l, db, c, s in _debit_credit(ops, _soldes(ops))]
    resultat = detecter_colonnes(lignes)
    config = {c["propriete"]: c["index"] for c in resultat["configuration"]}
    assert (config["montant_debit"], config["montant_credit"]) == (4, 3)
    assert resultat["colonne_solde"] == 5
    assert resultat["mode_montants"] == "debit_credit"
    assert resultat["solde"]["statut"] == "verifie"
    solde = next(c for c in resultat["colonnes"] if c["index"] == 5)
    assert solde["certaine"] and solde["propositions"][0]["propriete"] is None
