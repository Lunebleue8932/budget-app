"""La lecture d'un relevé avant ses colonnes (services/lecture_fichier,
lecture_montants, lecture_dates) : encodage, séparateurs, montants en
centimes, écriture des dates, ordre du fichier, lignes de pied, feuilles.

Ce qu'on verrouille : chaque écriture qu'une banque produit se lit en
centimes exacts, l'ambiguïté « 1.234 » se tranche par la colonne, « 03/04 »
par les dates qui dépassent 12, et un classeur propose la feuille qui porte le
relevé sans la choisir à la place de l'utilisateur.
"""
import io
from datetime import date

import openpyxl
import pytest

from app.services.detection_colonnes import detecter_colonnes, detecter_fichier
from app.services.lecture_dates import format_dates, lire_date, ordre_dates
from app.services.lecture_fichier import detecter_encodage, lire_fichier
from app.services.lecture_montants import centimes, format_nombres, texte_montant

# ---------- Les montants ----------


@pytest.mark.parametrize(
    "texte, decimal, milliers, attendu",
    [
        ("1 234,56 €", None, None, 123456),
        ("1 234,56", None, None, 123456),
        ("1 234,56", None, None, 123456),
        ("1.234,56", ",", ".", 123456),
        ("1,234.56", ".", ",", 123456),
        ("1'234.56", ".", "'", 123456),
        ("(12,50)", None, None, -1250),
        ("12,50-", None, None, -1250),
        ("-12,50", None, None, -1250),
        ("+3,00", None, None, 300),
        ("EUR 12,00", None, None, 1200),
        ("$ 12.00", ".", None, 1200),
        ("-45,2", None, None, -4520),
        ("12,500", None, None, 1250),
        (12.5, None, None, 1250),
        (0.1, None, None, 10),
        # « 1.234 » : lu en milliers quand la colonne écrit la virgule décimale,
        # refusé quand elle écrit le point (trois décimales n'existent pas).
        ("1.234", ",", None, 123400),
        ("1.234", ".", None, None),
        ("", None, None, None),
        ("CB CARREFOUR", None, None, None),
        ("01/02/2026", None, None, None),
        (True, None, None, None),
    ],
)
def test_centimes(texte, decimal, milliers, attendu):
    assert centimes(texte, decimal, milliers) == attendu


@pytest.mark.parametrize(
    "valeurs, attendu",
    [
        (["1 234,56", "45,20", "-3,00"], (",", " ")),
        (["1,234.56", "45.20"], (".", ",")),
        (["1.234,56", "2,00"], (",", ".")),
        (["45.20", "3.10"], (".", None)),
        # L'ambiguïté se tranche par les autres valeurs de la colonne.
        (["12,50", "1.234"], (",", None)),
        (["1.234", "5.678"], (None, None)),
        (["CB CARREFOUR", "02/01/2026"], (None, None)),
    ],
)
def test_format_nombres(valeurs, attendu):
    assert format_nombres(valeurs) == attendu


def test_texte_montant_est_l_inverse_de_centimes():
    for valeur in (0, 5, -4520, 123456, -123456789):
        for decimal, milliers in ((",", ""), (",", " "), (",", "."), (".", ","), (".", "'")):
            texte = texte_montant(valeur, decimal, milliers)
            assert centimes(texte, decimal, milliers or None) == valeur


# ---------- Les dates ----------


@pytest.mark.parametrize(
    "valeurs, attendu",
    [
        (["02/01/2026", "25/01/2026"], ("jma", True)),
        (["01/25/2026", "02/03/2026"], ("mja", True)),
        (["2026-01-02", "2026-01-25"], ("amj", True)),
        # Aucune date au-delà du 12 : lu à la française, sans certitude.
        (["02/01/2026", "03/01/2026"], ("jma", False)),
        (["CB CARREFOUR"], (None, False)),
    ],
)
def test_format_dates(valeurs, attendu):
    assert format_dates(valeurs) == attendu


def test_lire_date_mois_devant():
    assert lire_date("01/25/2026", "mja") == date(2026, 1, 25)
    assert lire_date("25/01/2026", "jma") == date(2026, 1, 25)
    assert lire_date("02/13/26", "mja") == date(2026, 2, 13)


def test_ordre_dates():
    jours = [date(2026, 1, j) for j in (2, 2, 3, 5, 5, 8, 9)]
    assert ordre_dates(jours) == "croissant"
    assert ordre_dates(list(reversed(jours))) == "decroissant"
    assert ordre_dates([date(2026, 1, 2), date(2026, 1, 3)]) is None  # trop peu
    assert ordre_dates([date(2026, 1, j) for j in (2, 5, 3, 8, 4, 9)]) is None  # mêlé


# ---------- L'encodage ----------


def test_detecter_encodage():
    texte = "Date;Libellé;Montant\n02/01/2026;Café;-3,00\n"
    assert detecter_encodage(texte.encode("utf-8-sig")) == "utf-8-sig"
    assert detecter_encodage(texte.encode("utf-8")) == "utf-8"
    assert detecter_encodage(texte.encode("cp1252")) == "cp1252"
    assert detecter_encodage("Montant en €\n".encode("cp1252")) == "cp1252"
    # Un octet que Windows-1252 n'attribue à rien : ISO-8859-1.
    assert detecter_encodage(b"Libell\xe9\x81\n") == "latin-1"


# ---------- Le fichier ----------


def test_lignes_de_titre_et_de_pied():
    lignes = [
        ("Relevé de compte",),
        ("Date", "Libellé", "Montant"),
        ("02/01/2026", "CB CARREFOUR", "-23,78"),
        ("03/01/2026", "VIR SALAIRE", "2 450,00"),
        ("05/01/2026", "PRLV EDF", "-64,32"),
        ("08/01/2026", "CB SNCF", "-81,54"),
        ("12/01/2026", "RETRAIT DAB", "-40,00"),
        ("", "Total des opérations", "2 240,36"),
        ("", "Solde final", "3 861,90"),
    ]
    resultat = detecter_colonnes(lignes)
    assert resultat["lignes_entete"] == 2
    assert resultat["lignes_pied"] == 2
    assert resultat["separateur_decimal"] == ","
    assert resultat["separateur_milliers"] == " "
    assert resultat["format_date"] == "jma"
    assert resultat["ordre"] == "croissant"


def test_une_colonne_aux_milliers_a_point_reste_un_montant():
    lignes = [
        ("Date", "Libellé", "Montant"),
        ("02/01/2026", "LOYER", "-1.250,00"),
        ("03/01/2026", "SALAIRE", "2.450,00"),
        ("05/01/2026", "CAFE", "-3,20"),
    ]
    resultat = detecter_colonnes(lignes)
    config = {c["propriete"]: c["index"] for c in resultat["configuration"]}
    assert config["montant"] == 3
    assert (resultat["separateur_decimal"], resultat["separateur_milliers"]) == (",", ".")


def test_les_dates_mois_devant_restent_des_dates():
    lignes = [
        ("Date", "Description", "Amount"),
        ("01/25/2026", "GROCERIES", "-23.78"),
        ("01/27/2026", "SALARY", "2450.00"),
        ("02/13/2026", "RENT", "-780.00"),
    ]
    resultat = detecter_colonnes(lignes)
    assert resultat["format_date"] == "mja"
    assert resultat["format_date_certain"]
    assert {c["propriete"]: c["index"] for c in resultat["configuration"]}["date"] == 1


def _classeur(feuilles: dict) -> bytes:
    classeur = openpyxl.Workbook()
    classeur.remove(classeur.active)
    for nom, lignes in feuilles.items():
        onglet = classeur.create_sheet(nom)
        for ligne in lignes:
            onglet.append(ligne)
    tampon = io.BytesIO()
    classeur.save(tampon)
    return tampon.getvalue()


def test_un_classeur_propose_la_feuille_du_releve_sans_la_choisir():
    releve = [("Date", "Libellé", "Montant")] + [
        (date(2026, 1, j), f"OPERATION {j}", -10.5 * j) for j in range(1, 11)
    ]
    contenu = _classeur({"Synthèse": [("Total", 1234.5), ("Compte", "Courant")], "Opérations": releve})
    lecture = lire_fichier(contenu)
    assert lecture.format == "xlsx"
    assert [f["nom"] for f in lecture.feuilles] == ["Synthèse", "Opérations"]
    assert lecture.feuille_proposee == "Opérations"
    # Sans choix explicite, la feuille active — la première ici — comme avant.
    assert lecture.feuille == "Synthèse"
    assert lire_fichier(contenu, feuille="Opérations").lignes[1][1] == "OPERATION 1"


def test_detecter_fichier_rend_la_lecture_avec_les_colonnes():
    contenu = (
        "Relevé de compte\r\nM. DUPONT\r\n\r\n"
        "Date\tLibellé\tMontant\r\n02/01/2026\tCB CARREFOUR\t-23,78\r\n"
        "03/01/2026\tVIR SALAIRE\t2450,00\r\n05/01/2026\tPRLV EDF\t-64,32\r\n"
    ).encode("cp1252")
    resultat = detecter_fichier(contenu)
    assert resultat["format"] == "csv"
    assert resultat["separateur"] == "\t"
    assert resultat["encodage"] == "cp1252"
    assert resultat["lignes_entete"] == 4
    assert {c["propriete"] for c in resultat["configuration"]} == {"date", "nature", "montant"}
