"""La migration 0083 retire la propriété `cours` des formats de l'import de TITRES : la colonne
portait un chiffre, elle porte désormais un lien, et un numéro de colonne qui désignait des cours
ne désigne pas des liens.

Ce qui se vérifie : seuls les formats du domaine `titre` perdent la propriété, et ils gardent
toutes leurs autres colonnes — l'import de placements a sa propre colonne « cours ».
"""
import json
import os
import sqlite3
import subprocess
import sys
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[1]


def _alembic(db_path: Path, revision: str):
    env = {**os.environ, "BUDGET_DB_PATH": str(db_path)}
    resultat = subprocess.run(
        [sys.executable, "-m", "alembic", "upgrade", revision],
        cwd=BACKEND_DIR,
        env=env,
        capture_output=True,
        text=True,
    )
    assert resultat.returncode == 0, resultat.stderr


def test_seuls_les_formats_de_titres_perdent_la_colonne_cours(tmp_path):
    db_path = tmp_path / "presets.db"
    _alembic(db_path, "0082")
    colonnes = [{"index": 1, "propriete": "code_isin"}, {"index": 10, "propriete": "cours"}]
    conn = sqlite3.connect(db_path)
    for nom, domaine in (("Titres", "titre"), ("Placements", "placement")):
        conn.execute(
            "INSERT INTO import_preset (nom, domaine, colonnes, colonnes_comparaison) VALUES (?, ?, ?, '[]')",
            (nom, domaine, json.dumps(colonnes)),
        )
    conn.commit()
    conn.close()

    _alembic(db_path, "head")

    conn = sqlite3.connect(db_path)
    try:
        lus = {nom: json.loads(c) for nom, c in conn.execute(
            "SELECT nom, colonnes FROM import_preset WHERE nom IN ('Titres', 'Placements')"
        )}
    finally:
        conn.close()
    assert lus["Titres"] == [{"index": 1, "propriete": "code_isin"}]
    assert lus["Placements"] == colonnes
