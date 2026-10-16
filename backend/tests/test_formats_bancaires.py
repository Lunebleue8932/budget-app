"""La reconnaissance des exports de banques (services/formats_bancaires).

CE QUE CES TESTS VERROUILLENT :

  - UN EXPORT CONNU EST RECONNU À SES INTITULÉS, quel que soit leur ordre ou ce qui les entoure
    (lignes de titre avant, colonnes en plus) ;
  - LE FORMAT LE PLUS SPÉCIFIQUE GAGNE ;
  - CE QU'ON NE CONNAÎT PAS RETOMBE SUR LA DÉTECTION GÉNÉRIQUE, sans erreur ;
  - LA RECONNAISSANCE PRIME SUR LA DEVINETTE dans la proposition de colonnes : deux colonnes de
    dates, c'est la date d'OPÉRATION qui est lue, jamais celle de valeur.
"""
import pytest

from app.services import detection_colonnes, formats_bancaires

BOURSORAMA = (
    "dateOp", "dateVal", "label", "category", "categoryParent", "supplierFound",
    "amount", "comment", "accountNum", "accountLabel", "accountbalance",
)

EXPORTS = {
    "boursorama": BOURSORAMA,
    "n26": ("Booking Date", "Value Date", "Partner Name", "Partner Iban", "Type",
            "Payment Reference", "Account Name", "Amount (EUR)", "Original Amount"),
    "n26-ancien": ("Date", "Payee", "Account number", "Transaction type", "Payment reference",
                   "Category", "Amount (EUR)"),
    "revolut": ("Type", "Product", "Started Date", "Completed Date", "Description", "Amount",
                "Fee", "Currency", "State", "Balance"),
    "credit-agricole": ("Date", "Libellé", "Débit euros", "Crédit euros"),
    "societe-generale": ("Date de l'opération", "Libellé", "Détail de l'écriture",
                         "Montant de l'opération", "Devise"),
    "caisse-epargne": ("Date", "Numéro d'opération", "Libellé", "Débit", "Crédit", "Détail", "Solde"),
    "fortuneo": ("Date opération", "Date valeur", "Libellé", "Débit", "Crédit"),
    "credit-mutuel-cic": ("Date", "Date de valeur", "Débit", "Crédit", "Libellé", "Solde"),
    "banque-postale": ("Date", "Libellé", "Montant(EUROS)", ""),
}


@pytest.mark.parametrize("identifiant,entetes", EXPORTS.items())
def test_chaque_export_connu_est_reconnu(identifiant, entetes):
    connu = formats_bancaires.reconnaitre([entetes, tuple("x" for _ in entetes)])
    assert connu is not None and connu["id"] == identifiant
    assert connu["lignes_entete"] == 1
    proprietes = {c["propriete"] for c in connu["configuration"]}
    assert "date" in proprietes and "nature" in proprietes
    assert proprietes & {"montant", "montant_debit"}


def test_des_lignes_de_titre_avant_les_intitules_decalent_les_lignes_de_tete():
    lignes = [("Relevé de compte", "", ""), ("Titulaire", "M. X", ""), EXPORTS["credit-agricole"]]
    assert formats_bancaires.reconnaitre(lignes)["lignes_entete"] == 3


def test_l_ordre_des_colonnes_et_les_colonnes_en_plus_ne_comptent_pas():
    melangee = tuple(reversed(BOURSORAMA)) + ("Colonne ajoutée",)
    connu = formats_bancaires.reconnaitre([melangee])
    assert connu["id"] == "boursorama"
    index = {c["propriete"]: c["index"] for c in connu["configuration"]}
    assert melangee[index["date"] - 1] == "dateOp"


def test_un_fichier_inconnu_n_est_pas_reconnu():
    assert formats_bancaires.reconnaitre([("Date", "Libellé", "Montant")]) is None
    assert formats_bancaires.reconnaitre([]) is None


def test_la_reconnaissance_prime_sur_la_devinette():
    lignes = [BOURSORAMA] + [
        ("2026-09-01", "2026-09-02", "CARTE CARREFOUR", "Alimentation", "Vie quotidienne", "Carrefour",
         "-45,20", "", "00040", "Compte", "1200,00"),
        ("2026-09-03", "2026-09-03", "VIR SALAIRE", "Salaire", "Revenus", "", "2100,00", "", "00040", "Compte", "3300,00"),
    ]
    resultat = detection_colonnes.detecter_colonnes(lignes, ",")
    assert resultat["format_reconnu"] == {"id": "boursorama", "banque": "Boursorama Banque"}
    assert resultat["lignes_entete"] == 1
    par_propriete = {c["propriete"]: c["index"] for c in resultat["configuration"]}
    assert par_propriete == {"date": 1, "nature": 3, "categorie_banque": 4, "montant": 7}
    # La date de VALEUR (colonne 2) n'est pas lue, mais reste modifiable.
    colonne_valeur = next(c for c in resultat["colonnes"] if c["index"] == 2)
    assert colonne_valeur["propositions"][0]["propriete"] is None
    assert colonne_valeur["certaine"] is False


def test_un_fichier_sans_format_connu_garde_la_detection_generique():
    lignes = [("Date", "Libellé", "Montant"), ("01/09/2026", "Courses", "-12,50")]
    resultat = detection_colonnes.detecter_colonnes(lignes, ",")
    assert resultat["format_reconnu"] is None
    assert resultat["configuration"]
