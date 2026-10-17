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
    """Deux dates que le dictionnaire ne départage pas : la seconde reste à
    trancher à l'écran."""
    lignes = [
        ("Date opération", "Date d'envoi", "Libellé", "Montant"),
        ("02/09/2026", "03/09/2026", "CARREFOUR", "-45,20"),
        ("05/09/2026", "05/09/2026", "SALAIRE", "2150,00"),
    ]
    resultat = detecter_colonnes(lignes)
    assert _config(resultat)["date"] == 1
    assert not _colonne(resultat, 2)["certaine"]


def test_la_date_de_valeur_ne_s_importe_pas():
    """« Date valeur » n'est pas une date d'opération qui contiendrait le mot
    « date » : le dictionnaire la reconnaît, et elle ne s'importe pas."""
    lignes = [
        ("Date opération", "Date valeur", "Libellé", "Montant"),
        ("02/09/2026", "03/09/2026", "CARREFOUR", "-45,20"),
        ("05/09/2026", "05/09/2026", "SALAIRE", "2150,00"),
    ]
    resultat = detecter_colonnes(lignes)
    assert _config(resultat)["date"] == 1
    assert _colonne(resultat, 2)["propositions"][0]["propriete"] is None


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


def _quatre_colonnes_de_texte():
    """Un relevé sans intitulés, quatre colonnes de texte : un libellé, un détail et deux colonnes
    de classement dont les valeurs sont presque toutes différentes (la catégorie y tombe sous le
    seuil de l'attribution, sans cesser d'être une piste)."""
    lignes = []
    for k in range(22):
        lignes.append((
            f"{1 + k % 28:02d}/09/2026",
            f"CARREFOUR MARKET PARIS {k}" if k % 2 else f"SNCF VOYAGES {k}",
            f"Détail du paiement numéro {k} chez le commerçant {k * 3}",
            f"-{10 + k}.40",
            f"Rubrique {k % 11}",
            f"Famille {k % 12}",
        ))
    return lignes


def test_un_champ_propose_seulement_a_deux_colonnes_remonte_dans_l_une_d_elles():
    """Le raffinage global : la catégorie bancaire n'était retenue nulle part alors que seules deux
    colonnes ignorées la proposaient. L'une d'elles la porte désormais, l'autre la garde en
    suggestion."""
    resultat = detecter_colonnes(_quatre_colonnes_de_texte())
    config = _config(resultat)
    assert config["categorie_banque"] == 5
    cinq = [p["propriete"] for p in _colonne(resultat, 5)["propositions"]]
    six = [p["propriete"] for p in _colonne(resultat, 6)["propositions"]]
    assert cinq[0] == "categorie_banque"
    assert "categorie_banque" in six and six[0] is None


def test_la_premiere_proposition_est_forte_avec_une_paire_ne_pas_importer():
    """Deux propositions dont « ne pas importer », ou trois qui commencent par elle : la première
    est peinte en bleu (`forte`), les autres restent des suggestions. Ailleurs, rien ne change."""
    resultat = detecter_colonnes(_quatre_colonnes_de_texte())
    # Colonne 3 : « ne pas importer » puis la nature (la colonne 2 l'a prise).
    trois = _colonne(resultat, 3)
    assert [p["propriete"] for p in trois["propositions"]] == [None, "nature"]
    assert trois["forte"] and not trois["certaine"]
    # Colonne 5 : trois lectures, « ne pas importer » en dernier - la catégorie remontée reste une
    # suggestion.
    cinq = _colonne(resultat, 5)
    assert len(cinq["propositions"]) == 3 and cinq["propositions"][0]["propriete"] == "categorie_banque"
    assert not cinq["forte"]
    # Colonne 6 : trois lectures qui commencent par « ne pas importer ».
    six = _colonne(resultat, 6)
    assert six["propositions"][0]["propriete"] is None and len(six["propositions"]) == 3
    assert six["forte"]


def test_le_raffinage_ne_touche_pas_a_une_colonne_deja_attribuee():
    """Les colonnes que l'attribution a données à un champ ne bougent pas, et une colonne que son
    intitulé range parmi ce qui ne s'importe pas non plus."""
    lignes = [
        ("Date", "Libellé", "Catégorie", "Montant", "Référence", "Solde"),
        ("02/09/2026", "CARREFOUR MARKET", "Alimentation", "-45,20", "A1", "1 204,80"),
        ("03/09/2026", "SNCF", "Transports", "-62,00", "B2", "1 142,80"),
        ("05/09/2026", "SALAIRE SEPTEMBRE", "Revenus", "2 150,00", "C3", "3 292,80"),
    ]
    resultat = detecter_colonnes(lignes)
    assert _config(resultat) == {"date": 1, "nature": 2, "categorie_banque": 3, "montant": 4}
    assert _colonne(resultat, 5)["propositions"][0]["propriete"] is None


def _releve_anglais(intitule_categorie, intitule_type):
    """Un relevé où chaque catégorie ne s'écrit que sous UN type (dépense ou entrée) : la dépendance des
    données fait du type la « catégorie » et de la catégorie son détail, ce que l'intitulé contredit."""
    lignes = [("Date", "Description", intitule_type, intitule_categorie, "Amount")]
    modeles = [
        ("Expense", "Groceries", "CARREFOUR MARKET", "-45.20"),
        ("Expense", "Transport", "SNCF TICKET", "-62.00"),
        ("Expense", "Leisure", "CINEMA PATHE", "-14.50"),
        ("Income", "Salary", "ACME PAYROLL", "2150.00"),
        ("Expense", "Groceries", "MONOPRIX", "-12.40"),
        ("Expense", "Transport", "UBER TRIP", "-18.30"),
        ("Income", "Refund", "AMAZON REFUND", "35.00"),
        ("Expense", "Leisure", "STEAM GAMES", "-29.99"),
    ]
    for i, (genre, categorie, nature, montant) in enumerate(modeles):
        lignes.append((f"{i + 2:02d}/09/2026", nature, genre, categorie, montant))
    return lignes


def test_une_colonne_nommee_category_reste_la_categorie_meme_sous_un_autre_classement():
    # « Group », « Class », « Kind » : un classement plus grossier que la catégorie, sans être une
    # catégorie. Avant que l'intitulé prime, la colonne « Category » passait pour son détail et se
    # voyait proposer « Ne pas importer » en tête.
    for parent in ("Type", "Group", "Class", "Kind"):
        resultat = detecter_colonnes(_releve_anglais("Category", parent))
        categorie = _colonne(resultat, 4)
        assert categorie["propositions"][0]["propriete"] == "categorie_banque", parent
        assert _config(resultat).get("categorie_banque") == 4, parent


def test_une_colonne_sous_category_reste_le_detail_de_la_category():
    lignes = [("Date", "Description", "Category", "Subcategory", "Amount")]
    modeles = [
        ("Food", "Groceries", "CARREFOUR MARKET", "-45.20"),
        ("Food", "Restaurants", "LE BISTROT", "-28.00"),
        ("Transport", "Train", "SNCF TICKET", "-62.00"),
        ("Transport", "Taxi", "UBER TRIP", "-18.30"),
        ("Home", "Rent", "LANDLORD", "-780.00"),
        ("Home", "Energy", "EDF", "-71.20"),
        ("Food", "Groceries", "MONOPRIX", "-12.40"),
        ("Transport", "Train", "SNCF TICKET", "-31.00"),
    ]
    for i, (categorie, detail, nature, montant) in enumerate(modeles):
        lignes.append((f"{i + 2:02d}/09/2026", nature, categorie, detail, montant))
    resultat = detecter_colonnes(lignes)
    assert _config(resultat).get("categorie_banque") == 3
    assert _colonne(resultat, 4)["propositions"][0]["propriete"] is None
