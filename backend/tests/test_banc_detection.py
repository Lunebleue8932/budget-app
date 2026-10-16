"""Le banc de test de la détection (tests/banc_detection) : qu'il dise vrai, et
que la détection ne recule pas.

Un générateur qui se trompe sur le mapping attendu ferait passer une bonne
détection pour mauvaise, ou l'inverse : ses transformations sont donc vérifiées
ici une à une, montants en centimes à l'appui. Puis chaque cas synthétique que
reference.json dit réussi doit le rester (cf. rejouer.py --enregistrer).
"""
import random

import pytest

from app.services.import_bancaire import _lire_toutes_les_lignes
from tests.banc_detection import synthetiques, variantes
from tests.banc_detection.rejouer import charger_reference, evaluer, regressions
from tests.banc_detection.releve import centimes


@pytest.mark.parametrize(
    "texte, decimal, attendu",
    [
        ("1 234,56", ",", 123456),
        ("1 234,56 €", ",", 123456),
        ("-45,2", ",", -4520),
        ("(12,50)", ",", -1250),
        ("12,50-", ",", -1250),
        ("1,234.56", ".", 123456),
        ("+3", ",", 300),
        ("", ",", None),
        ("CB CARREFOUR", ",", None),
        ("1,2345", ",", None),
    ],
)
def test_centimes(texte, decimal, attendu):
    assert centimes(texte, decimal) == attendu


@pytest.fixture(scope="module")
def bases():
    return synthetiques.bases()


def test_chaque_base_a_un_mode_different(bases):
    assert sorted(b.mode for b in bases) == ["algebrique", "debit_credit", "envoye_recu", "montant_sens"]


@pytest.mark.parametrize(
    "transformation",
    ["en_algebrique", "en_montant_sens", "en_debit_credit", "en_envoye_recu", "permuter",
     "renommer", "titres", "avec_solde", "sans_solde"],
)
def test_les_transformations_conservent_les_montants(bases, transformation):
    for base in bases:
        v = variantes.TRANSFORMATIONS[transformation](base, random.Random(0))
        assert v.nets() == base.nets(), f"{base.nom} / {transformation}"
        assert len(v.roles) == len(v.lignes[0])


def test_inverser_l_ordre_inverse_les_montants(bases):
    for base in bases:
        v = variantes.inverser_ordre(base, random.Random(0))
        assert v.nets() == base.nets()[::-1]
        assert v.ordre != base.ordre


def test_changer_de_separateur_conserve_les_montants(bases):
    for base in bases:
        for sep in (";", ",", "\t"):
            assert variantes.separateur(base, sep).nets() == base.nets()


def _verifier_solde(releve):
    """Le solde de chaque ligne renseignée = le précédent renseigné + les
    montants nets entre les deux, en ordre chronologique."""
    j = releve.roles.index("solde")
    soldes = [centimes(l[j], releve.separateur_decimal) for l in releve.lignes]
    nets = releve.nets()
    if releve.ordre == "decroissant":
        soldes, nets = soldes[::-1], nets[::-1]
    precedent, cumul, intervalles = None, 0, 0
    for solde, net in zip(soldes, nets):
        cumul += net or 0
        if solde is not None:
            if precedent is not None:
                assert solde - precedent == cumul
                intervalles += 1
            precedent, cumul = solde, 0
    assert intervalles >= 10


def test_les_soldes_sont_coherents(bases):
    banque_a, banque_b, _, banque_d = bases
    _verifier_solde(banque_b)
    _verifier_solde(banque_d)  # solde en fin de journée seulement, ordre décroissant
    _verifier_solde(variantes.avec_solde(banque_a, random.Random(0)))
    _verifier_solde(variantes.inverser_ordre(banque_b, random.Random(0)))


def test_un_fichier_ecrit_se_relit_tel_quel():
    """Les intitulés relus sont à la ligne que dit le mapping attendu, et la
    première opération a autant de cellules que le relevé a de colonnes.

    Le séparateur est DONNÉ au lecteur : c'est l'écriture qu'on vérifie ici,
    pas la détection du séparateur, que le banc mesure par ailleurs."""
    for cas in variantes.tous_les_cas(avec_reels=False):
        sep = cas.attendu["separateur"]
        lignes = _lire_toutes_les_lignes(cas.contenu, None if sep == "xlsx" else sep)
        debut = cas.attendu["lignes_entete"]
        assert len(lignes[debut]) == len(cas.attendu["proprietes"]), cas.nom


def test_la_detection_ne_recule_pas():
    reference = charger_reference()
    resultats = [evaluer(cas) for cas in variantes.tous_les_cas(avec_reels=False)]
    assert not regressions(resultats, reference)
