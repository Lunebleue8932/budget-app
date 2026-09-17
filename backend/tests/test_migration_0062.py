"""La migration 0062 remplace la case « en-tête » par un NOMBRE de lignes de
tête, sans changer ce que fait un preset déjà enregistré.

CE QUI SE VÉRIFIE ICI et nulle part ailleurs : la REPRISE. Un preset qui sautait
son en-tête doit continuer de le sauter — sans cette ligne de migration, tous
les formats à en-tête réimporteraient leurs intitulés de colonnes comme une
opération, au premier import suivant, et personne n'aurait rien demandé.

Alembic est appelé en sous-processus, comme dans les autres tests de migration :
le schéma des tests ordinaires est construit par `Base.metadata.create_all` et
ne passe jamais par les scripts eux-mêmes.
"""
import os
import sqlite3
import subprocess
import sys
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[1]
PYTHON = sys.executable


def _alembic(db_path: Path, revision: str):
    env = {**os.environ, "BUDGET_DB_PATH": str(db_path)}
    resultat = subprocess.run(
        [str(PYTHON), "-m", "alembic", "upgrade", revision],
        cwd=BACKEND_DIR,
        env=env,
        capture_output=True,
        text=True,
    )
    assert resultat.returncode == 0, resultat.stderr
    return resultat


def _seed_presets(db_path: Path):
    conn = sqlite3.connect(db_path)
    conn.execute(
        "INSERT INTO import_preset (nom, colonnes, colonnes_comparaison, "
        "ignorer_premiere_ligne) VALUES ('Avec en-tête', '[]', '[]', 1)"
    )
    conn.execute(
        "INSERT INTO import_preset (nom, colonnes, colonnes_comparaison, "
        "ignorer_premiere_ligne) VALUES ('Sans en-tête', '[]', '[]', 0)"
    )
    conn.commit()
    conn.close()


def test_la_case_devient_un_nombre_sans_changer_le_comportement(tmp_path):
    db_path = tmp_path / "presets.db"
    _alembic(db_path, "0061")
    _seed_presets(db_path)

    _alembic(db_path, "head")

    conn = sqlite3.connect(db_path)
    try:
        tous = dict(conn.execute("SELECT nom, lignes_entete FROM import_preset"))
        # Une migration antérieure seede un preset « Défaut » : on ne regarde
        # que les deux qu'on a posés, les seuls dont on connaisse l'état d'avant.
        lignes = {nom: tous[nom] for nom in ("Avec en-tête", "Sans en-tête")}
        colonnes = {r[1] for r in conn.execute("PRAGMA table_info(import_preset)")}
    finally:
        conn.close()

    assert lignes == {"Avec en-tête": 1, "Sans en-tête": 0}
    # La case d'avant est RETIRÉE, et pas gardée à côté : deux réglages qui
    # disent la même chose finissent par se contredire.
    assert "ignorer_premiere_ligne" not in colonnes
