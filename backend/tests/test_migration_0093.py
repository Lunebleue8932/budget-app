"""La migration 0093 pose `titre_possede.est_indice`.

Ce qui se vérifie : la colonne existe, faux pour tout titre déjà présent (aucun n'est transformé en
indice par la migration) ; la descente retire la colonne et laisse le titre intact.
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
        cwd=BACKEND_DIR,
        env=env,
        capture_output=True,
        text=True,
    )
    assert resultat.returncode == 0, resultat.stderr


def test_les_titres_existants_ne_sont_pas_des_indices(tmp_path):
    db_path = tmp_path / "indice.db"
    _alembic(db_path, "upgrade", "0092")
    conn = sqlite3.connect(db_path)
    monnaie = conn.execute("SELECT id FROM monnaie LIMIT 1").fetchone()[0]
    conn.execute(
        "INSERT INTO titre_possede (nom, valeur, monnaie_id, archivee) VALUES ('Un ETF', 10, ?, 0)",
        (monnaie,),
    )
    conn.commit()
    conn.close()

    _alembic(db_path, "upgrade", "0093")

    conn = sqlite3.connect(db_path)
    try:
        assert conn.execute("SELECT est_indice FROM titre_possede WHERE nom = 'Un ETF'").fetchone() == (0,)
    finally:
        conn.close()

    _alembic(db_path, "downgrade", "0092")
    conn = sqlite3.connect(db_path)
    try:
        colonnes = [c[1] for c in conn.execute("PRAGMA table_info(titre_possede)")]
        assert "est_indice" not in colonnes
        assert conn.execute("SELECT nom FROM titre_possede").fetchall() == [("Un ETF",)]
    finally:
        conn.close()
