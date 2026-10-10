"""Migration 0078 : un modèle récurrent réel passe la main, une catégorie d'entrée prend la
couleur des entrées.

CE QUI COMPTE. Rien n'est supprimé : l'ancien modèle reste réel et devient une occurrence du
nouveau, la première occurrence prévisionnelle devient le modèle, et une catégorie d'entrée
porte `couleur_index = -1` — que le retour arrière lui reprend.
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


def _sql(db_path: Path, requete: str, params=()):
    conn = sqlite3.connect(db_path)
    try:
        return conn.execute(requete, params).fetchall()
    finally:
        conn.close()


def _base_0077(db_path: Path, avec_occurrence_prevue=True):
    _alembic(db_path, "upgrade", "0077")
    conn = sqlite3.connect(db_path)
    try:
        monnaie = conn.execute("SELECT id FROM monnaie LIMIT 1").fetchone()[0]
        type_compte = conn.execute("SELECT id FROM type_compte LIMIT 1").fetchone()[0]
        compte = conn.execute(
            "INSERT INTO compte (nom, type_id) VALUES ('CC', ?)", (type_compte,)
        ).lastrowid
        type_op = conn.execute("SELECT id FROM type_operation WHERE code = 'classique'").fetchone()[0]
        modele = conn.execute(
            "INSERT INTO operation (date, compte_id, monnaie_id, type_id, nature, montant, sens, "
            "statut, recurrente, frequence) VALUES ('2026-07-25', ?, ?, ?, 'Loyer', 500, "
            "'dépense', 'réel', 1, 'mensuelle')",
            (compte, monnaie, type_op),
        ).lastrowid
        enfants = [("2026-08-25", "réel")]
        if avec_occurrence_prevue:
            enfants += [("2026-09-25", "prévisionnel"), ("2026-10-25", "prévisionnel")]
        for jour, statut in enfants:
            conn.execute(
                "INSERT INTO operation (date, compte_id, monnaie_id, type_id, nature, montant, "
                "sens, statut, recurrente, recurrence_parent_id, recurrence_date_prevue) "
                "VALUES (?, ?, ?, ?, 'Loyer', 500, 'dépense', ?, 1, ?, ?)",
                (jour, compte, monnaie, type_op, statut, modele, jour),
            )
        conn.execute("UPDATE categorie SET est_entree = 1 WHERE nom = 'Autres'")
        conn.commit()
        return modele
    finally:
        conn.close()


def test_la_0078_fait_passer_la_main_a_la_premiere_occurrence_prevue(tmp_path):
    base = tmp_path / "budget.db"
    _base_0077(base)

    _alembic(base, "upgrade", "0078")

    lignes = {
        jour: (statut, parent, frequence)
        for jour, statut, parent, frequence in _sql(
            base,
            "SELECT date, statut, recurrence_parent_id, frequence FROM operation ORDER BY date",
        )
    }
    nouveau = _sql(base, "SELECT id FROM operation WHERE date = '2026-09-25'")[0][0]
    assert lignes["2026-09-25"] == ("prévisionnel", None, "mensuelle")
    # LE PASSÉ RESTE RÉEL ET RATTACHÉ au nouveau modèle.
    assert lignes["2026-07-25"] == ("réel", nouveau, None)
    assert lignes["2026-08-25"] == ("réel", nouveau, None)
    assert lignes["2026-10-25"] == ("prévisionnel", nouveau, None)
    assert _sql(base, "SELECT couleur_index FROM categorie WHERE nom = 'Autres'") == [(-1,)]

    _alembic(base, "downgrade", "0077")
    assert _sql(base, "SELECT couleur_index FROM categorie WHERE nom = 'Autres'")[0][0] >= 0


def test_sans_occurrence_prevue_un_modele_nait_a_la_date_suivante(tmp_path):
    base = tmp_path / "budget.db"
    _base_0077(base, avec_occurrence_prevue=False)

    _alembic(base, "upgrade", "0078")

    assert _sql(
        base,
        "SELECT statut, recurrente, frequence, recurrence_parent_id FROM operation "
        "WHERE date = '2026-09-25'",
    ) == [("prévisionnel", 1, "mensuelle", None)]
