"""La migration 0092 pose `titre_possede.part_etf` et rattrape les composants déjà cités.

Ce qui se vérifie : la colonne existe, faux par défaut ; un titre cité par la composition d'un ETF
(par son ISIN, ou par `titre:<id>`) reçoit le drapeau ; l'ETF lui-même et un titre que personne ne
cite ne le reçoivent pas ; la descente retire la colonne.
"""
import json
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
        cwd=BACKEND_DIR,
        env=env,
        capture_output=True,
        text=True,
    )
    assert resultat.returncode == 0, resultat.stderr


def test_les_composants_deja_cites_recoivent_le_drapeau(tmp_path):
    db_path = tmp_path / "etf.db"
    _alembic(db_path, "upgrade", "0091")
    conn = sqlite3.connect(db_path)
    monnaie = conn.execute("SELECT id FROM monnaie LIMIT 1").fetchone()[0]

    def titre(nom, isin=None, composition=None):
        curseur = conn.execute(
            "INSERT INTO titre_possede (nom, valeur, monnaie_id, code_isin, composition, archivee) "
            "VALUES (?, 0, ?, ?, ?, 0)",
            (nom, monnaie, isin, json.dumps(composition) if composition else None),
        )
        return curseur.lastrowid

    sans_isin = titre("Sans ISIN")
    par_isin = titre("Par ISIN", "US0378331005")
    seul = titre("Personne ne le cite", "US5949181045")
    etf = titre("L'ETF", "IE000AAAAAA1", {"US0378331005": 60.0, f"titre:{sans_isin}": 20.0})
    conn.commit()
    conn.close()

    _alembic(db_path, "upgrade", "0092")

    conn = sqlite3.connect(db_path)
    try:
        drapeaux = dict(conn.execute("SELECT id, part_etf FROM titre_possede"))
    finally:
        conn.close()
    assert drapeaux[sans_isin] == 1 and drapeaux[par_isin] == 1
    assert drapeaux[seul] == 0 and drapeaux[etf] == 0

    _alembic(db_path, "downgrade", "0091")
    conn = sqlite3.connect(db_path)
    try:
        colonnes = [c[1] for c in conn.execute("PRAGMA table_info(titre_possede)")]
    finally:
        conn.close()
    assert "part_etf" not in colonnes
