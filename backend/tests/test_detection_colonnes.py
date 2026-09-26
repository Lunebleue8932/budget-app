"""La détection automatique des colonnes d'un relevé (services/detection_colonnes).

Ce qu'on verrouille : les formats ordinaires sont reconnus SANS hésitation
(une seule proposition, marquée sûre), et les cas vraiment ambigus en gardent
plusieurs — l'écran ne doit jamais présenter comme sûr ce qui ne l'est pas.
"""
from app.services import import_bancaire
from app.services.detection_colonnes import detecter_colonnes


def _config(resultat) -> dict:
    return {c["propriete"]: c["index"] for c in resultat["configuration"]}


def _colonne(resultat, index):
    return next(c for c in resultat["colonnes"] if c["index"] == index)


def test_releve_ordinaire_avec_intitules():
    lignes = [
        ("Date", "Libellé", "Catégorie", "Montant", "Solde"),
        ("02/09/2026", "CARREFOUR MARKET", "Alimentation", "-45,20", "1 204,80"),
        ("03/09/2026", "SNCF", "Transports", "-62,00", "1 142,80"),
        ("05/09/2026", "SALAIRE SEPTEMBRE", "Revenus", "2 150,00", "3 292,80"),
        ("07/09/2026", "CARREFOUR MARKET", "Alimentation", "-12,40", "3 280,40"),
    ]
    resultat = detecter_colonnes(lignes)
    assert resultat["lignes_entete"] == 1
    assert _config(resultat) == {"date": 1, "nature": 2, "categorie_banque": 3, "montant": 4}
    for index in (1, 2, 4):
        assert _colonne(resultat, index)["certaine"], index
    # Le solde courant est reconnu pour ce qu'il est : rien à importer.
    solde = _colonne(resultat, 5)
    assert solde["propositions"][0]["propriete"] is None


def test_page_de_garde_avant_les_intitules():
    lignes = [
        ("RELEVÉ DE COMPTE", "", "", ""),
        ("Titulaire : Dupont", "", "", ""),
        ("", "", "", ""),
        ("Date", "Libellé", "Montant", "Compte"),
        ("02/09/2026", "CARREFOUR MARKET", "-45,20", "Compte courant"),
        ("03/09/2026", "VIREMENT RECU", "200,00", "Livret A"),
    ]
    resultat = detecter_colonnes(lignes)
    assert resultat["lignes_entete"] == 4
    assert _config(resultat)["compte_banque"] == 4


def test_debit_et_credit_scindes():
    lignes = [
        ("Date", "Libellé", "Débit", "Crédit"),
        ("02/09/2026", "CARREFOUR MARKET", "45,20", ""),
        ("05/09/2026", "SALAIRE SEPTEMBRE", "", "2 150,00"),
        ("07/09/2026", "ESSENCE", "62,00", "0,00"),
    ]
    config = _config(detecter_colonnes(lignes))
    assert config["montant_debit"] == 3
    assert config["montant_credit"] == 4
    assert "montant" not in config


def test_sens_et_devise():
    lignes = [
        ("Date", "Libellé", "Sens", "Montant", "Devise"),
        ("02/09/2026", "CARREFOUR MARKET", "Débit", "45,20", "EUR"),
        ("05/09/2026", "SALAIRE", "Crédit", "2 150,00", "EUR"),
        ("06/09/2026", "AMAZON.COM", "Débit", "32,10", "USD"),
    ]
    config = _config(detecter_colonnes(lignes))
    assert config["sens"] == 3
    assert config["montant"] == 4
    assert config["monnaie"] == 5


def test_sans_intitules_la_forme_suffit_mais_reste_incertaine():
    lignes = [
        ("02/09/2026", "CARREFOUR MARKET", "-45,20", "Alimentation"),
        ("03/09/2026", "SNCF", "-62,00", "Transports"),
        ("05/09/2026", "SALAIRE SEPTEMBRE", "2150,00", "Revenus"),
        ("07/09/2026", "BOULANGERIE", "-3,40", "Alimentation"),
    ]
    resultat = detecter_colonnes(lignes)
    assert resultat["lignes_entete"] == 0
    config = _config(resultat)
    assert config["date"] == 1
    assert config["montant"] == 3
    # Deux colonnes de texte : sans intitulé, laquelle est le libellé n'est
    # qu'une hypothèse, et l'écran doit proposer plusieurs choix.
    assert not _colonne(resultat, 4)["certaine"]
    assert len(_colonne(resultat, 4)["propositions"]) > 1


def test_deux_colonnes_de_dates_restent_une_hypothese():
    lignes = [
        ("Date opération", "Date valeur", "Libellé", "Montant"),
        ("02/09/2026", "03/09/2026", "CARREFOUR", "-45,20"),
        ("05/09/2026", "05/09/2026", "SALAIRE", "2150,00"),
    ]
    resultat = detecter_colonnes(lignes)
    assert _config(resultat)["date"] == 1
    assert not _colonne(resultat, 2)["certaine"]


def test_le_fichier_d_exemple_de_la_notice(db_session):
    """Le relevé d'exemple livré avec l'application : la notice donne la
    réponse (2 lignes de tête, Date 1, Nature 3, Montant 5, Catégorie 7)."""
    from pathlib import Path

    chemin = Path(__file__).resolve().parents[2] / "frontend" / "exemples" / "releve-exemple.csv"
    lignes = import_bancaire._lire_toutes_les_lignes(chemin.read_bytes())
    resultat = detecter_colonnes(lignes)
    assert resultat["lignes_entete"] == 2
    config = _config(resultat)
    assert config["date"] == 1
    assert config["nature"] == 3
    assert config["montant"] == 5
    assert config["categorie_banque"] == 7
    # « Type de carte » contient le mot « type » sans être un sens, et
    # « Solde après opération » ne s'importe pas.
    assert "sens" not in config
    assert _colonne(resultat, 6)["propositions"][0]["propriete"] is None
