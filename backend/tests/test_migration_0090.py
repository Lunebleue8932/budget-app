"""Migration 0090 : la catégorie « Virements internes », posée sur toutes les jambes.

CE QUI COMPTE. Une seule catégorie flaguée, sur chaque jambe de virement (elles portaient NULL)
et sur les règles de virement, sorties comprises ; une catégorie homonyme déjà utilisée est
laissée à son propriétaire. La descente rend tout tel quel.
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


def _sql(db_path: Path, requete: str, params=()):
    conn = sqlite3.connect(db_path)
    try:
        return conn.execute(requete, params).fetchall()
    finally:
        conn.close()


def _base_0089(db_path: Path, homonyme_utilise=False):
    _alembic(db_path, "upgrade", "0089")
    conn = sqlite3.connect(db_path)
    try:
        monnaie = conn.execute("SELECT id FROM monnaie LIMIT 1").fetchone()[0]
        type_compte = conn.execute("SELECT id FROM type_compte LIMIT 1").fetchone()[0]
        a = conn.execute("INSERT INTO compte (nom, type_id) VALUES ('A', ?)", (type_compte,)).lastrowid
        b = conn.execute("INSERT INTO compte (nom, type_id) VALUES ('B', ?)", (type_compte,)).lastrowid
        virement = conn.execute("SELECT id FROM type_operation WHERE code = 'virement'").fetchone()[0]
        classique = conn.execute("SELECT id FROM type_operation WHERE code = 'classique'").fetchone()[0]
        for compte, sens in ((a, "transfert_sortant"), (b, "transfert_entrant")):
            conn.execute(
                "INSERT INTO operation (date, compte_id, monnaie_id, type_id, nature, montant, sens, "
                "statut, virement_id) VALUES ('2026-07-01', ?, ?, ?, 'Vir', 100, ?, 'réel', 'v1')",
                (compte, monnaie, virement, sens),
            )
        autres = conn.execute("SELECT id FROM categorie WHERE nom = 'Autres'").fetchone()[0]
        conn.execute(
            "INSERT INTO operation (date, compte_id, monnaie_id, type_id, categorie_id, nature, "
            "montant, sens, statut) VALUES ('2026-07-02', ?, ?, ?, ?, 'Courses', 10, 'dépense', 'réel')",
            (a, monnaie, classique, autres),
        )
        sorties = json.dumps(
            [{"conditions": {}, "type_code": "virement", "type_id": virement, "categorie_id": None}]
        )
        conn.execute(
            "INSERT INTO regle_categorisation (nom, description, ordre, actif, arreter_apres, type_id, "
            "categorie_id, conditions, sorties) VALUES ('Livret', '', 0, 1, 1, ?, NULL, '{}', ?)",
            (virement, sorties),
        )
        if homonyme_utilise:
            homonyme = conn.execute(
                "INSERT INTO categorie (nom, ordre, couleur_index, objectif_pourcentage, est_entree, "
                "active) VALUES ('Virements internes', 99, 9, 0, 0, 1)"
            ).lastrowid
            conn.execute(
                "INSERT INTO operation (date, compte_id, monnaie_id, type_id, categorie_id, nature, "
                "montant, sens, statut) VALUES ('2026-07-03', ?, ?, ?, ?, 'X', 5, 'dépense', 'réel')",
                (a, monnaie, classique, homonyme),
            )
        conn.commit()
    finally:
        conn.close()


def test_la_0090_pose_la_categorie_sur_les_jambes_et_les_regles_puis_redescend(tmp_path):
    base = tmp_path / "budget.db"
    _base_0089(base)

    _alembic(base, "upgrade", "0090")

    vi = _sql(base, "SELECT id, nom, couleur_index FROM categorie WHERE est_virement = 1")
    assert len(vi) == 1 and vi[0][1] == "Virements internes" and vi[0][2] == -2
    vi_id = vi[0][0]
    jambes = _sql(base, "SELECT categorie_id FROM operation WHERE virement_id = 'v1'")
    assert jambes == [(vi_id,), (vi_id,)]
    assert _sql(base, "SELECT categorie_id FROM operation WHERE nature = 'Courses'") != [(vi_id,)]
    regle = _sql(base, "SELECT categorie_id, sorties FROM regle_categorisation")[0]
    assert regle[0] == vi_id and json.loads(regle[1])[0]["categorie_id"] == vi_id

    _alembic(base, "downgrade", "0089")

    assert _sql(base, "SELECT COUNT(*) FROM categorie WHERE nom = 'Virements internes'") == [(0,)]
    assert _sql(base, "SELECT categorie_id FROM operation WHERE virement_id = 'v1'") == [(None,), (None,)]
    regle = _sql(base, "SELECT categorie_id, sorties FROM regle_categorisation")[0]
    assert regle[0] is None and json.loads(regle[1])[0]["categorie_id"] is None
    colonnes = [c[1] for c in _sql(base, "PRAGMA table_info(categorie)")]
    assert "est_virement" not in colonnes


def test_une_categorie_homonyme_deja_utilisee_reste_a_son_proprietaire(tmp_path):
    base = tmp_path / "budget.db"
    _base_0089(base, homonyme_utilise=True)

    _alembic(base, "upgrade", "0090")

    lignes = dict(_sql(base, "SELECT nom, est_virement FROM categorie WHERE nom LIKE 'Virements internes%'"))
    assert lignes == {"Virements internes": 0, "Virements internes (2)": 1}
