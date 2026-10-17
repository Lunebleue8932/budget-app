"""Un relevé dont le solde est celui du JOUR (recopié sur chaque opération de la journée), avec des
colonnes qui ne portent que la même valeur partout (nom du compte, « Non » de pointage, une date).

Les dates, montants et soldes sont ceux d'un export réel dont les textes ont été retirés ; les
colonnes de texte sont synthétiques. Ce qu'on verrouille :

  - le solde de jour est reconnu (et avec lui le montant), malgré les lignes d'une même journée ;
  - une colonne constante n'est ni un libellé, ni une date, ni une catégorie ;
  - un montant qui mêle négatifs et positifs n'est pas un débit, un crédit ou des frais ;
  - une colonne qui est LA SEULE à avoir des montants (hors solde) n'a pas d'autre lecture ;
  - une sous-catégorie n'est pas proposée comme catégorie.
"""
from app.services.controle_solde import controler_solde
from app.services.detection_colonnes import detecter_colonnes

# (date, montant, solde du jour) dans l'ordre du fichier : le plus récent d'abord.
OPERATIONS = [
    ("2026-08-07", -72.33, 455.87), ("2026-08-07", -15.47, 455.87),
    ("2026-08-07", -3.94, 455.87), ("2026-08-07", -27.22, 455.87),
    ("2026-08-07", 26.08, 455.87),
    ("2026-08-05", -70.78, 548.75), ("2026-08-05", -124, 548.75), ("2026-08-05", -59.65, 548.75),
    ("2026-08-04", -98, 803.18),
    ("2026-08-03", -18.29, 901.18), ("2026-08-03", -1830, 901.18),
    ("2026-08-03", -68.49, 901.18), ("2026-08-03", 300, 901.18),
    ("2026-07-31", 1800, 2517.96), ("2026-07-31", -105, 2517.96),
    ("2026-07-31", 38.14, 2517.96), ("2026-07-31", -266.98, 2517.96),
    ("2026-07-31", -18.4, 2517.96), ("2026-07-31", -693.97, 2517.96),
]
# (catégorie de la banque, sous-catégorie) : chaque sous-catégorie ne figure que sous UNE catégorie.
CLASSEMENTS = [
    ("Vie quotidienne", "Courses"), ("Vie quotidienne", "Restaurants"), ("Loisirs", "Sorties"),
    ("Transports", "Carburant"), ("Revenus", "Salaire"), ("Vie quotidienne", "Courses"),
]
COMMERCES = ["CB CARREFOUR 0708", "CB RESTAURANT LE PARIS", "CINEMA PATHE", "TOTAL STATION", "VIR EMPLOYEUR"]


def _releve():
    lignes = []
    for i, (jour, montant, solde) in enumerate(OPERATIONS):
        commerce = COMMERCES[i % len(COMMERCES)] + f" {i}"
        categorie, sous = CLASSEMENTS[i % len(CLASSEMENTS)]
        lignes.append((
            jour, jour, commerce, commerce.title(), categorie, sous, montant, None,
            "2026-08-08", "Compte courant Jean", solde, "Non",
        ))
    return lignes


def _proposition(resultat, index):
    colonne = next(c for c in resultat["colonnes"] if c["index"] == index)
    return colonne["propositions"][0]["propriete"], [p["propriete"] for p in colonne["propositions"]]


def test_le_solde_du_jour_est_reconnu_et_verifie():
    lignes = [(l[0], l[6], l[10]) for l in _releve()]
    solde = controler_solde(lignes)
    assert solde is not None
    assert solde.colonne == 3
    assert solde.moment == "apres"
    assert solde.statut == "verifie"
    assert solde.lecture.en_dict()["mode"] == "algebrique"


def test_le_solde_du_debut_de_journee_est_reconnu_aussi():
    # Même montants, mais le solde de chaque jour est celui d'AVANT ses opérations : il vaut le
    # solde de fin du jour précédent.
    chrono = list(reversed(OPERATIONS))
    jours, fins = [], {}
    for jour, montant, _ in chrono:
        if jour not in jours:
            jours.append(jour)
        fins[jour] = fins.get(jour, 0) + montant
    debut, courant = {}, 1000.0
    for jour in jours:
        debut[jour] = round(courant, 2)
        courant += fins[jour]
    lignes = [(jour, montant, debut[jour]) for jour, montant, _ in OPERATIONS]
    # L'ordre des dates (décroissant) départage cette lecture de sa symétrique (cf. controle_solde).
    solde = controler_solde(lignes, ordre_probable="decroissant")
    assert solde is not None and solde.colonne == 3
    assert solde.moment == "avant"
    assert solde.lecture.en_dict()["signe_inverse"] is False


def test_les_colonnes_du_releve_d_un_export_reel():
    resultat = detecter_colonnes(_releve())
    config = {c["propriete"]: c["index"] for c in resultat["configuration"]}

    # Le solde de jour (colonne 11) n'est pas un montant : il ne s'importe pas.
    assert resultat["colonne_solde"] == 11
    assert _proposition(resultat, 11)[0] is None
    assert config["montant"] == 7
    assert config["date"] in (1, 2)
    assert config["nature"] in (3, 4)

    # Un montant algébrique (négatifs ET positifs) et seul de son espèce : rien d'autre à proposer.
    _, montant = _proposition(resultat, 7)
    for autre in ("montant_debit", "montant_credit", "frais", "montant_initial"):
        assert autre not in montant

    # La même valeur partout : ni libellé, ni date, ni catégorie.
    for index in (9, 10, 12):
        _, propositions = _proposition(resultat, index)
        assert "nature" not in propositions, index
        assert "categorie_banque" not in propositions, index
    assert _proposition(resultat, 9)[0] is None
    # Le nom du compte du relevé se lit comme tel ; un « Non » de pointage, comme rien.
    assert _proposition(resultat, 10)[0] == "compte_banque"
    assert _proposition(resultat, 12)[0] is None
    assert "compte_banque" not in _proposition(resultat, 12)[1]


def test_une_sous_categorie_n_est_pas_proposee_comme_categorie():
    resultat = detecter_colonnes(_releve())
    config = {c["propriete"]: c["index"] for c in resultat["configuration"]}
    assert config["categorie_banque"] == 5
    premiere, _ = _proposition(resultat, 6)
    assert premiere is None


def test_un_montant_seul_ne_recoit_pas_d_autre_lecture():
    lignes = [
        ("2026-08-07", "CB CARREFOUR", -72.33),
        ("2026-08-05", "CB LIDL", -70.78),
        ("2026-08-04", "VIR EMPLOYEUR", 1800.0),
        ("2026-08-03", "CB TOTAL", -45.2),
        ("2026-07-31", "PRLV EDF", -62.0),
    ]
    resultat = detecter_colonnes(lignes)
    _, propositions = _proposition(resultat, 3)
    assert propositions[0] == "montant"
    for autre in ("montant_debit", "montant_credit", "frais", "montant_initial"):
        assert autre not in propositions


def test_un_vrai_couple_debit_credit_reste_reconnu():
    lignes = [
        ("Date", "Libellé", "Débit", "Crédit"),
        ("02/09/2026", "CARREFOUR MARKET", "45,20", ""),
        ("05/09/2026", "SALAIRE SEPTEMBRE", "", "2 150,00"),
        ("07/09/2026", "ESSENCE", "62,00", ""),
        ("08/09/2026", "REMBOURSEMENT", "", "20,00"),
    ]
    config = {c["propriete"]: c["index"] for c in detecter_colonnes(lignes)["configuration"]}
    assert config["montant_debit"] == 3 and config["montant_credit"] == 4
