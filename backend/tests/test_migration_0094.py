"""La migration 0094 : le calque se souvient de l'indice, et un indice n'a plus d'enveloppe.

Ce qui se vérifie : les colonnes existent, vides ; l'enveloppe d'un indice déjà présent est retirée,
celle d'un ETF reste ; la descente retire les colonnes.
"""
import os
import sqlite3
import subprocess
import sys
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[1]


def _alembic(db_path: Path, commande: str, revision: str):
    env = {**os.environ, "BUDGET_DB_PATH": str(db_path)}
    resultat = subprocess.run(
        [sys.executable, "-m", "alembic", commande, revision],
        cwd=BACKEND_DIR, env=env, capture_output=True, text=True,
    )
    assert resultat.returncode == 0, resultat.stderr


def test_un_indice_perd_son_enveloppe_et_un_etf_la_garde(tmp_path):
    db_path = tmp_path / "calque.db"
    _alembic(db_path, "upgrade", "0093")
    conn = sqlite3.connect(db_path)
    monnaie = conn.execute("SELECT id FROM monnaie LIMIT 1").fetchone()[0]
    env = conn.execute("SELECT id FROM type_titre WHERE nom = 'ETF' AND axe = 'enveloppe'").fetchone()[0]
    for nom, indice in (("Un indice", 1), ("Un ETF", 0)):
        conn.execute(
            "INSERT INTO titre_possede (nom, valeur, monnaie_id, archivee, type_titre_id, est_indice) "
            "VALUES (?, 1, ?, 0, ?, ?)",
            (nom, monnaie, env, indice),
        )
    conn.commit()
    conn.close()

    _alembic(db_path, "upgrade", "0094")

    conn = sqlite3.connect(db_path)
    try:
        lignes = dict(conn.execute("SELECT nom, type_titre_id FROM titre_possede"))
        assert lignes["Un indice"] is None and lignes["Un ETF"] == env
        assert conn.execute("SELECT indice_id, calque_proprietes FROM titre_possede").fetchall() == [(None, None)] * 2
    finally:
        conn.close()

    _alembic(db_path, "downgrade", "0093")
    conn = sqlite3.connect(db_path)
    try:
        colonnes = [c[1] for c in conn.execute("PRAGMA table_info(titre_possede)")]
        assert "indice_id" not in colonnes and "calque_proprietes" not in colonnes
    finally:
        conn.close()
