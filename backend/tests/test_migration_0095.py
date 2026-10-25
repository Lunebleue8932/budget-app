"""La migration 0095 ajoute la zone « Amérique du Nord (hors États-Unis) », sans doublon ni répartition touchée."""
import os
import sqlite3
import subprocess
import sys
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[1]
ZONE = "Amérique du Nord (hors États-Unis)"


def _alembic(db_path: Path, commande: str, revision: str):
    env = {**os.environ, "BUDGET_DB_PATH": str(db_path)}
    r = subprocess.run([sys.executable, "-m", "alembic", commande, revision], cwd=BACKEND_DIR, env=env, capture_output=True, text=True)
    assert r.returncode == 0, r.stderr


def test_la_zone_est_ajoutee_une_seule_fois_et_retiree_a_la_descente(tmp_path):
    db_path = tmp_path / "zone.db"
    _alembic(db_path, "upgrade", "0094")
    conn = sqlite3.connect(db_path)
    assert conn.execute("SELECT COUNT(*) FROM type_titre WHERE axe='zone' AND nom=?", (ZONE,)).fetchone() == (0,)
    conn.close()
    _alembic(db_path, "upgrade", "0095")
    conn = sqlite3.connect(db_path)
    assert conn.execute("SELECT COUNT(*) FROM type_titre WHERE axe='zone' AND nom=?", (ZONE,)).fetchone() == (1,)
    conn.close()
    _alembic(db_path, "downgrade", "0094")
    conn = sqlite3.connect(db_path)
    assert conn.execute("SELECT COUNT(*) FROM type_titre WHERE axe='zone' AND nom=?", (ZONE,)).fetchone() == (0,)
    conn.close()
