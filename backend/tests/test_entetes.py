"""La normalisation des intitulés et le dictionnaire de synonymes
(services/entetes, app/synonymes_entetes.json).

Ce qu'on verrouille, propriété par propriété : les intitulés courants des
relevés français (et quelques anglais et portugais) sont reconnus avec le
score qui convient — 1 exact, 0,9 synonyme, 0,6 mot-clé — et les intitulés
voisins ne se confondent pas : une date de valeur n'est pas une date, un
libellé complémentaire n'est pas un libellé, « Débit/Crédit » est un sens.
"""
import pytest

from app.services.entetes import (
    SCORE_EXACT,
    SCORE_MOT_CLE,
    SCORE_SYNONYME,
    dictionnaire,
    groupe_principal,
    normaliser_entete,
    scores_groupes,
    scores_proprietes,
)


@pytest.mark.parametrize(
    "brut, normalise",
    [
        ("Montant (EUR)", "montant eur"),
        ("MONTANT  €", "montant eur"),
        ("Libellé de l'opération", "libelle de l operation"),
        ("Débit/Crédit", "debit credit"),
        ("  Date opé. ", "date ope"),
        (None, ""),
    ],
)
def test_normaliser_entete(brut, normalise):
    assert normaliser_entete(brut) == normalise


def test_le_dictionnaire_se_charge():
    groupes = dictionnaire()
    assert {"date", "date_valeur", "nature", "detail", "montant", "debit", "credit",
            "envoye", "recu", "sens", "categorie", "solde", "reference", "devise"} <= set(groupes)
    # Les groupes qui ne s'importent pas le disent par une propriété vide.
    assert all(groupes[g]["propriete"] == "" for g in ("solde", "reference", "date_valeur", "detail"))


@pytest.mark.parametrize(
    "entete, groupe, score",
    [
        # date
        ("Date", "date", SCORE_EXACT),
        ("DATE", "date", SCORE_EXACT),
        ("Date opération", "date", SCORE_SYNONYME),
        ("Date de l'opération", "date", SCORE_SYNONYME),
        ("Date comptable", "date", SCORE_SYNONYME),
        ("Booking date", "date", SCORE_SYNONYME),
        ("Data", "date", SCORE_SYNONYME),
        ("Date d'achat", "date", SCORE_MOT_CLE),
        # date de valeur
        ("Date de valeur", "date_valeur", SCORE_EXACT),
        ("Date valeur", "date_valeur", SCORE_EXACT),
        ("Value date", "date_valeur", SCORE_SYNONYME),
        # libellé
        ("Libellé", "nature", SCORE_EXACT),
        ("Libellé de l'opération", "nature", SCORE_SYNONYME),
        ("Description", "nature", SCORE_SYNONYME),
        ("Détail de l'écriture", "nature", SCORE_SYNONYME),
        ("Descrição", "nature", SCORE_SYNONYME),
        ("Libellé interne", "nature", SCORE_MOT_CLE),
        # détail / complément
        ("Détail", "detail", SCORE_EXACT),
        ("Libellé complémentaire", "detail", SCORE_SYNONYME),
        ("Informations complémentaires", "detail", SCORE_SYNONYME),
        # catégorie
        ("Catégorie", "categorie", SCORE_EXACT),
        ("Sous-catégorie", "categorie", SCORE_SYNONYME),
        ("Type d'opération", "categorie", SCORE_SYNONYME),
        # montant
        ("Montant", "montant", SCORE_EXACT),
        ("Montant (EUR)", "montant", SCORE_EXACT),
        ("Montant en euros", "montant", SCORE_EXACT),
        ("Amount", "montant", SCORE_SYNONYME),
        ("Montant TTC", "montant", SCORE_MOT_CLE),
        # débit / crédit
        ("Débit", "debit", SCORE_EXACT),
        ("Débit (€)", "debit", SCORE_EXACT),
        ("Montant débit", "debit", SCORE_SYNONYME),
        ("Money out", "debit", SCORE_SYNONYME),
        ("Crédit", "credit", SCORE_EXACT),
        ("CREDIT EUROS", "credit", SCORE_EXACT),
        ("Montant crédit", "credit", SCORE_SYNONYME),
        # envoyé / reçu
        ("Envoyé", "envoye", SCORE_EXACT),
        ("Montant envoyé", "envoye", SCORE_SYNONYME),
        ("Reçu", "recu", SCORE_EXACT),
        ("Montant reçu", "recu", SCORE_SYNONYME),
        # sens
        ("Sens", "sens", SCORE_EXACT),
        ("Débit/Crédit", "sens", SCORE_SYNONYME),
        ("D/C", "sens", SCORE_SYNONYME),
        # devise
        ("Devise", "devise", SCORE_EXACT),
        ("Currency", "devise", SCORE_SYNONYME),
        # solde, référence
        ("Solde", "solde", SCORE_EXACT),
        ("Solde après opération", "solde", SCORE_SYNONYME),
        ("Running balance", "solde", SCORE_SYNONYME),
        ("Solde intermédiaire", "solde", SCORE_MOT_CLE),
        ("Référence", "reference", SCORE_EXACT),
        ("N° d'opération", "reference", SCORE_SYNONYME),
    ],
)
def test_chaque_propriete_reconnait_ses_intitules(entete, groupe, score):
    assert scores_groupes(entete).get(groupe) == score
    assert groupe_principal(entete) == groupe


@pytest.mark.parametrize(
    "entete, pas_ce_groupe",
    [
        # RÈGLES DE DISTINCTION : un intitulé reconnu en entier par un groupe ne
        # compte pas, par un simple mot-clé, pour un autre.
        ("Date de valeur", "date"),
        ("Date valeur", "date"),
        ("Libellé complémentaire", "nature"),
        ("Débit/Crédit", "debit"),
        ("Débit/Crédit", "credit"),
        ("Montant débit", "montant"),
        ("Solde après opération", "montant"),
        ("Devise envoyée", "envoye"),
    ],
)
def test_les_intitules_voisins_ne_se_confondent_pas(entete, pas_ce_groupe):
    assert pas_ce_groupe not in scores_groupes(entete)


def test_les_mots_cles_se_lisent_en_mots_entiers():
    # « dateur » contient « date » en lettres, pas en mots : pas de mot-clé.
    # Il lui RESSEMBLE, ce qui ne vaut qu'un indice faible (cf. _scores_flous).
    assert scores_groupes("Dateur").get("date", 0.0) < SCORE_MOT_CLE


def test_un_intitule_inconnu_ne_vaut_rien():
    assert scores_groupes("Code agence") == {}
    assert scores_groupes("") == {}
    assert scores_groupes(None) == {}


def test_scores_par_propriete():
    assert scores_proprietes("Montant envoyé") == {"montant_debit": SCORE_SYNONYME}
    assert scores_proprietes("Solde") == {"": SCORE_EXACT}
