"""Règles : le champ « Sens » (l'argent entre ou il sort).

Deux valeurs seulement, `entree` et `depense`, avec « est » / « n'est pas ». Un relevé qui ne
dit pas le sens (montant nul) ne correspond à rien, « n'est pas » compris.
"""
import pytest
from pydantic import ValidationError

from app import schemas
from app.services import regles_categorisation


def _evaluer(operateur, valeur, **brute):
    condition = {"champ": "sens", "operateur": operateur, "valeur": valeur, "valeurs": [valeur]}
    return regles_categorisation.evaluer_condition(condition, brute)


def test_le_sens_est_une_entree_ou_une_depense():
    assert _evaluer("est", "entree", sens="entree")
    assert not _evaluer("est", "entree", sens="depense")
    assert _evaluer("n'est pas", "entree", sens="depense")


def test_un_sens_inconnu_ne_correspond_a_rien():
    assert not _evaluer("est", "entree", sens=None)
    assert not _evaluer("n'est pas", "entree", sens=None)


def _condition(**champs):
    return schemas.ConditionRegle(**{"champ": "sens", "operateur": "est", **champs})


def test_le_schema_n_accepte_que_les_deux_valeurs():
    assert _condition(valeur="depense").valeur == "depense"
    with pytest.raises(ValidationError):
        _condition(valeur="dépense")
    with pytest.raises(ValidationError):
        _condition(valeur="entree", operateur="contient")


def test_le_sens_vient_du_signe_du_montant_a_l_import():
    from app.services.import_bancaire import signe_du_montant

    assert {1: "entree", -1: "depense"}.get(signe_du_montant(12.5)) == "entree"
    assert {1: "entree", -1: "depense"}.get(signe_du_montant(-3.0)) == "depense"
    assert {1: "entree", -1: "depense"}.get(signe_du_montant(0)) is None
