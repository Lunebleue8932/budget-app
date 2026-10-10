"""Migration 0077 : « à déclarer », les réglages de déclaration, et les formats d'une règle.

CE QUI COMPTE. La 0077 AJOUTE seulement (deux colonnes sur `regle_categorisation`, une sur
`operation`, une table) : toute opération existante doit rester « pas à déclarer », toute règle
existante doit rester une règle de TOUS les formats (`presets` NULL), et le retour arrière doit
tout défaire sans toucher au reste.
"""
import os
import sqlite3
import subprocess
import sys
from pathlib import Path

import pytest

BACKEND_DIR = Path(__file__).resolve().parents[1]


def _alembic(db_path: Path, commande: str, revision: str):
    env = {**os.environ, "BUDGET_DB_PATH": str(db_path)}
    resultat = subprocess.run(
        [sys.executable, "-m", "alembic", commande, revision],
        cwd=BACKEND_DIR,
        env=env,
        capture_output=True,
        text=True,
    )
    assert resultat.returncode == 0, resultat.stderr


def _sql(db_path: Path, requete: str, params=()):
    conn = sqlite3.connect(db_path)
    try:
        return conn.execute(requete, params).fetchall()
    finally:
        conn.close()


def _colonnes(db_path: Path, table: str) -> set[str]:
    return {l[1] for l in _sql(db_path, f"PRAGMA table_info({table})")}


def _tables(db_path: Path) -> set[str]:
    return {l[0] for l in _sql(db_path, "SELECT name FROM sqlite_master WHERE type = 'table'")}


def _base_0076_avec_donnees(db_path: Path):
    """Une base à la 0076 : une règle, et une opération."""
    _alembic(db_path, "upgrade", "0076")
    conn = sqlite3.connect(db_path)
    try:
        monnaie = conn.execute("SELECT id FROM monnaie LIMIT 1").fetchone()[0]
        type_compte = conn.execute("SELECT id FROM type_compte LIMIT 1").fetchone()[0]
        compte = conn.execute(
            "INSERT INTO compte (nom, type_id) VALUES ('CC', ?)", (type_compte,)
        ).lastrowid
        type_op = conn.execute(
            "SELECT id FROM type_operation WHERE code = 'classique'"
        ).fetchone()[0]
        conn.execute(
            "INSERT INTO operation (date, compte_id, monnaie_id, type_id, nature, montant, sens, statut) "
            "VALUES ('2026-03-05', ?, ?, ?, 'Salaire', 1000, 'entrée', 'réel')",
            (compte, monnaie, type_op),
        )
        conn.execute(
            "INSERT INTO regle_categorisation (nom, conditions, ordre, actif, arreter_apres) "
            "VALUES ('R', '{}', 1, 1, 1)"
        )
        conn.commit()
    finally:
        conn.close()


def test_la_0077_ajoute_sans_rien_changer_a_l_existant(tmp_path):
    base = tmp_path / "budget.db"
    _base_0076_avec_donnees(base)

    _alembic(base, "upgrade", "0077")

    assert "a_declarer" in _colonnes(base, "operation")
    assert {"a_declarer", "presets"} <= _colonnes(base, "regle_categorisation")
    assert "declaration_impots" in _tables(base)
    # Aucune opération existante n'est à déclarer ; aucune règle existante ne vise un format.
    assert _sql(base, "SELECT a_declarer FROM operation") == [(0,)]
    assert _sql(base, "SELECT a_declarer, presets FROM regle_categorisation") == [(None, None)]


def test_la_table_des_declarations_refuse_les_doublons_et_les_taux_absurdes(tmp_path):
    base = tmp_path / "budget.db"
    _alembic(base, "upgrade", "0077")
    conn = sqlite3.connect(base)
    try:
        conn.execute("INSERT INTO declaration_impots (annee, taux_pct) VALUES (2026, 11.5)")
        with pytest.raises(sqlite3.IntegrityError):
            conn.execute("INSERT INTO declaration_impots (annee) VALUES (2026)")
        with pytest.raises(sqlite3.IntegrityError):
            conn.execute("INSERT INTO declaration_impots (annee, taux_pct) VALUES (2027, 101)")
        # Les deux champs facultatifs peuvent rester vides.
        conn.execute("INSERT INTO declaration_impots (annee) VALUES (2028)")
    finally:
        conn.close()


def test_le_retour_arriere_defait_la_0077_et_garde_le_reste(tmp_path):
    base = tmp_path / "budget.db"
    _base_0076_avec_donnees(base)
    _alembic(base, "upgrade", "0077")

    _alembic(base, "downgrade", "0076")

    assert "a_declarer" not in _colonnes(base, "operation")
    assert not ({"a_declarer", "presets"} & _colonnes(base, "regle_categorisation"))
    assert "declaration_impots" not in _tables(base)
    assert _sql(base, "SELECT nature, montant FROM operation") == [("Salaire", 1000.0)]
    assert _sql(base, "SELECT nom FROM regle_categorisation") == [("R",)]
