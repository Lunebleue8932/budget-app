"""Le dernier niveau de preuve de la détection : la ressemblance des intitulés
(services/entetes, fautes de frappe) et les statistiques de contenu
(services/detection_colonnes : libellé, type d'opération, catégorie,
référence).

Ce qu'on verrouille : une faute de frappe est reconnue, mais toujours sous un
mot-clé, a fortiori sous un synonyme ou un exact, et sans franchir une règle de
distinction ; un mot sans rapport ne ressemble à rien ; le contenu d'une
colonne ne départage que ce que les intitulés laissent ouvert.
"""
import random

import pytest

from app.services.detection_colonnes import detecter_colonnes
from app.services.entetes import (
    SCORE_FLOU_MAX,
    SCORE_FLOU_MIN,
    _jaro_winkler,
    groupe_principal,
    scores_groupes,
)


def test_jaro_winkler():
    assert _jaro_winkler("martha", "marhta") == pytest.approx(0.961, abs=1e-3)
    assert _jaro_winkler("libelle", "libelle") == 1.0
    assert _jaro_winkler("", "date") == 0.0


@pytest.mark.parametrize(
    "entete, groupe",
    [
        ("Libelé", "nature"),
        ("Montnat", "montant"),
        ("Catgorie", "categorie"),
        ("Devsie", "devise"),
        ("Crédti", "credit"),
        ("Date valuer", "date_valeur"),  # la distinction tient malgré la faute
        ("Libellé complémentair", "detail"),
    ],
)
def test_une_faute_de_frappe_est_reconnue_sans_depasser_un_mot_cle(entete, groupe):
    scores = scores_groupes(entete)
    assert groupe_principal(entete) == groupe
    assert SCORE_FLOU_MIN <= scores[groupe] <= SCORE_FLOU_MAX


@pytest.mark.parametrize("entete", ["Nom", "Pays", "Code agence", "Mtant", "Lib."])
def test_un_mot_sans_rapport_ne_ressemble_a_rien(entete):
    assert scores_groupes(entete) == {}


def test_la_ressemblance_ne_remplace_jamais_un_intitule_reconnu():
    assert scores_groupes("Date valeur") == {"date_valeur": 1.0}
    assert scores_groupes("Montant TTC") == {"montant": 0.6}


def _releve(colonnes: dict, n=40, graine=4):
    """Un relevé sans intitulés : {nom: fonction(rng, i) -> cellule}."""
    rng = random.Random(graine)
    return [tuple(f(rng, i) for f in colonnes.values()) for i in range(n)]


_DATE = lambda rng, i: f"{1 + i % 28:02d}/03/2026"  # noqa: E731
_MONTANT = lambda rng, i: f"-{rng.randint(1, 900)},{rng.randint(0, 99):02d}"  # noqa: E731
_MARCHANDS = ["CARREFOUR", "SNCF", "EDF", "FREE", "AMAZON", "BOULANGERIE", "PHARMACIE", "TOTAL"]
_LIBELLE = lambda rng, i: (  # noqa: E731
    f"{rng.choice(['CB', 'VIR', 'PRLV'])} {rng.choice(_MARCHANDS)} {rng.randint(10, 99)}"
)
_TYPE = lambda rng, i: rng.choice(  # noqa: E731
    ["Paiement par carte", "Virement reçu", "Prélèvement", "Retrait d'espèces"]
)


def _config(resultat) -> dict:
    return {c["propriete"]: c["index"] for c in resultat["configuration"]}


def test_le_type_d_operation_n_est_pas_une_categorie():
    lignes = _releve({"date": _DATE, "type": _TYPE, "libelle": _LIBELLE, "montant": _MONTANT})
    resultat = detecter_colonnes(lignes)
    config = _config(resultat)
    assert config["nature"] == 3
    assert "categorie_banque" not in config
    type_operation = next(c for c in resultat["colonnes"] if c["index"] == 2)
    assert type_operation["propositions"][0]["propriete"] is None


def test_une_colonne_des_categories_de_l_app_est_la_categorie():
    categories = ["Alimentation", "Transports", "Logement", "Santé"]
    lignes = _releve({
        "date": _DATE,
        "libelle": _LIBELLE,
        "categorie": lambda rng, i: rng.choice(categories),
        "montant": _MONTANT,
    })
    assert _config(detecter_colonnes(lignes, categories=categories))["categorie_banque"] == 3


def test_le_libelle_bancaire_l_emporte_sur_un_autre_texte():
    """Deux colonnes de texte variées : celle qui s'ouvre sur CB, VIR, PRLV est
    le libellé."""
    villes = ["Lyon", "Paris", "Lille", "Nantes", "Rennes", "Brest", "Nice", "Metz"]
    lignes = _releve({
        "date": _DATE,
        "ville": lambda rng, i: f"{rng.choice(villes)} {rng.choice(villes)} agence {i}",
        "libelle": _LIBELLE,
        "montant": _MONTANT,
    })
    assert _config(detecter_colonnes(lignes))["nature"] == 3


def test_une_reference_ne_s_importe_pas():
    lignes = _releve({
        "date": _DATE,
        "libelle": _LIBELLE,
        "reference": lambda rng, i: str(20260301000000 + i * 37),
        "montant": _MONTANT,
    })
    resultat = detecter_colonnes(lignes)
    assert _config(resultat)["montant"] == 4
    reference = next(c for c in resultat["colonnes"] if c["index"] == 3)
    assert reference["propositions"][0]["propriete"] is None


def test_une_ligne_d_intitules_pleine_de_fautes_reste_une_ligne_d_intitules():
    lignes = [("Dtae", "Libelé", "Montnat"), ("02/03/2026", "CB CARREFOUR", "-23,78"),
              ("03/03/2026", "VIR SALAIRE", "2450,00"), ("05/03/2026", "PRLV EDF", "-64,32")]
    resultat = detecter_colonnes(lignes)
    assert resultat["lignes_entete"] == 1
    assert _config(resultat) == {"date": 1, "nature": 2, "montant": 3}


# ---------- Ce que les relevés d'exemple des banques ont appris ----------


def test_une_colonne_credit_vide_garde_son_intitule():
    """Un relevé du mois sans rentrée : le preset enregistré dessus doit encore
    lire les crédits du mois suivant."""
    lignes = [("Date", "Débit", "Crédit", "Libellé"),
              ("02/03/2026", "-23,78", "", "CB CARREFOUR"),
              ("05/03/2026", "-64,32", "", "PRLV EDF"),
              ("08/03/2026", "-12,00", "", "CB BOULANGERIE")]
    config = _config(detecter_colonnes(lignes))
    assert (config["montant_debit"], config["montant_credit"]) == (2, 3)


def test_une_colonne_de_zeros_n_est_pas_un_credit():
    lignes = _releve({"date": _DATE, "libelle": _LIBELLE, "montant": _MONTANT,
                      "compte": lambda rng, i: "0"})
    config = _config(detecter_colonnes(lignes))
    assert config["montant"] == 3 and "montant_credit" not in config


def test_un_type_qui_n_ecrit_aucun_sens_n_est_pas_un_sens():
    lignes = [("Type", "Date", "Description", "Amount")] + [
        (t, f"0{j}/03/2026", "MONOPRIX", "-12.50")
        for j, t in enumerate(["CARD_PAYMENT", "TOPUP", "TRANSFER", "CARD_PAYMENT"], start=1)
    ]
    resultat = detecter_colonnes(lignes)
    assert "sens" not in _config(resultat)
    assert resultat["mode_montants"] == "algebrique"


def test_l_iban_de_l_autre_partie_n_est_pas_le_compte():
    lignes = _releve({"date": _DATE, "libelle": _LIBELLE, "montant": _MONTANT,
                      "iban": lambda rng, i: f"FR76{rng.randint(10**20, 10**21 - 1)}"})
    lignes.insert(0, ("Date", "Libellé", "Montant", "IBAN"))
    assert "compte_banque" not in _config(detecter_colonnes(lignes))


def test_une_colonne_constante_n_est_pas_une_categorie():
    lignes = _releve({"date": _DATE, "libelle": _LIBELLE, "produit": lambda rng, i: "Current",
                      "montant": _MONTANT})
    assert "categorie_banque" not in _config(detecter_colonnes(lignes))


def test_une_ligne_de_synthese_en_tete_n_est_pas_une_operation():
    """L'historique d'un crédit BNP : une ligne de synthèse, plus large, puis
    les opérations, sans intitulés."""
    lignes = [("Crédit immobilier", "Crédit immobilier", "****1234", "18/03/2022", "", "-123 456,78")] + [
        (f"05/0{m}/2022", "", "", " AMORTISSEMENT PRET 1234", f"7{m},03") for m in range(1, 6)
    ]
    resultat = detecter_colonnes(lignes)
    assert resultat["lignes_entete"] == 1
    assert _config(resultat)["date"] == 1
