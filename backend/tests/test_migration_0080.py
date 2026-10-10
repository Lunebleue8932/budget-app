"""Migration 0080 : le nom d'un titre n'est plus unique seul — c'est le couple (nom, ISIN).

CE QUI COMPTE. Après la montée, deux titres de même nom coexistent sous des ISIN différents ;
deux titres SANS ISIN et de même nom restent refusés. Aucune ligne ne bouge. Le retour
arrière rend l'unicité du nom en suffixant les homonymes de leur ISIN.
"""
import sqlite3

import pytest

from .test_migration_0078 import _alembic, _sql


def _inserer(base, nom, isin):
    conn = sqlite3.connect(base)
    try:
        monnaie = conn.execute("SELECT id FROM monnaie LIMIT 1").fetchone()[0]
        conn.execute(
            "INSERT INTO titre_possede (nom, valeur, monnaie_id, archivee, code_isin) "
            "VALUES (?, 0, ?, 0, ?)",
            (nom, monnaie, isin),
        )
        conn.commit()
    finally:
        conn.close()


def test_la_0080_permet_les_homonymes_sous_des_isin_differents(tmp_path):
    base = tmp_path / "budget.db"
    _alembic(base, "upgrade", "0079")
    _inserer(base, "SS SPDR MSCI EUR.", "IE00BKWQ0P07")
    with pytest.raises(sqlite3.IntegrityError):
        _inserer(base, "SS SPDR MSCI EUR.", "IE00BKWQ0G16")

    _alembic(base, "upgrade", "0080")

    _inserer(base, "SS SPDR MSCI EUR.", "IE00BKWQ0G16")
    _inserer(base, "Sans code", None)
    with pytest.raises(sqlite3.IntegrityError):
        _inserer(base, "Sans code", None)
    with pytest.raises(sqlite3.IntegrityError):
        _inserer(base, "Autre nom", "IE00BKWQ0G16")
    assert _sql(base, "SELECT COUNT(*) FROM titre_possede")[0][0] == 3

    _alembic(base, "downgrade", "0079")

    noms = sorted(nom for (nom,) in _sql(base, "SELECT nom FROM titre_possede"))
    assert noms == ["SS SPDR MSCI EUR.", "SS SPDR MSCI EUR. (IE00BKWQ0G16)", "Sans code"]
