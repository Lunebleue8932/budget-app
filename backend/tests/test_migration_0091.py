"""Migration 0091 : une catégorie ordinaire qui porte le nom des virements internes est fondue
dans la catégorie à drapeau (correspondances et règles comprises), sauf si elle porte des
opérations ; et le serveur refuse désormais d'en créer une.
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


def _base_0090_avec_homonyme(db_path: Path, nom: str, avec_operation=False) -> int:
    _alembic(db_path, "upgrade", "0090")
    conn = sqlite3.connect(db_path)
    try:
        homonyme = conn.execute(
            "INSERT INTO categorie (nom, ordre, couleur_index, objectif_pourcentage, est_entree, "
            "active, est_virement) VALUES (?, 50, 3, 0, 0, 1, 0)",
            (nom,),
        ).lastrowid
        preset = conn.execute("SELECT id FROM import_preset LIMIT 1").fetchone()[0]
        conn.execute(
            "INSERT INTO import_categorie_mapping (preset_id, nom_banque, categorie_id) VALUES (?, 'VIR', ?)",
            (preset, homonyme),
        )
        sorties = json.dumps([{"conditions": {}, "type_code": None, "categorie_id": homonyme}])
        conn.execute(
            "INSERT INTO regle_categorisation (nom, ordre, actif, categorie_id, conditions, sorties) "
            "VALUES ('Livret', 1, 1, ?, '{}', ?)",
            (homonyme, sorties),
        )
        if avec_operation:
            monnaie = conn.execute("SELECT id FROM monnaie LIMIT 1").fetchone()[0]
            type_compte = conn.execute("SELECT id FROM type_compte LIMIT 1").fetchone()[0]
            compte = conn.execute("INSERT INTO compte (nom, type_id) VALUES ('A', ?)", (type_compte,)).lastrowid
            classique = conn.execute("SELECT id FROM type_operation WHERE code = 'classique'").fetchone()[0]
            conn.execute(
                "INSERT INTO operation (date, compte_id, monnaie_id, type_id, categorie_id, nature, "
                "montant, sens, statut) VALUES ('2026-07-02', ?, ?, ?, ?, 'Vers livret', 10, 'dépense', 'réel')",
                (compte, monnaie, classique, homonyme),
            )
        conn.commit()
        return homonyme
    finally:
        conn.close()


def test_une_homonyme_inutilisee_est_fondue_dans_la_categorie_des_virements(tmp_path):
    db = tmp_path / "fusion.db"
    homonyme = _base_0090_avec_homonyme(db, "Virement interne")
    _alembic(db, "upgrade", "0091")

    virements = _sql(db, "SELECT id FROM categorie WHERE est_virement = 1")[0][0]
    assert _sql(db, "SELECT COUNT(*) FROM categorie WHERE id = ?", (homonyme,))[0][0] == 0
    assert _sql(db, "SELECT categorie_id FROM import_categorie_mapping WHERE nom_banque = 'VIR'") == [(virements,)]
    regle_categorie, regle_type, brut = _sql(
        db, "SELECT categorie_id, type_id, sorties FROM regle_categorisation WHERE nom = 'Livret'"
    )[0]
    type_virement = _sql(db, "SELECT id FROM type_operation WHERE code = 'virement'")[0][0]
    assert (regle_categorie, regle_type) == (virements, type_virement)
    sortie = json.loads(brut)[0]
    assert sortie["categorie_id"] == virements and sortie["type_code"] == "virement"


def test_les_noms_sont_reconnus_sans_casse_ni_accents_et_dans_les_trois_langues(tmp_path):
    for i, nom in enumerate(["internal TRANSFERS", "Transferências internas"]):
        db = tmp_path / f"langue{i}.db"
        homonyme = _base_0090_avec_homonyme(db, nom)
        _alembic(db, "upgrade", "0091")
        assert _sql(db, "SELECT COUNT(*) FROM categorie WHERE id = ?", (homonyme,))[0][0] == 0


def test_une_homonyme_qui_porte_des_operations_est_laissee(tmp_path):
    db = tmp_path / "gardee.db"
    homonyme = _base_0090_avec_homonyme(db, "Virement interne", avec_operation=True)
    _alembic(db, "upgrade", "0091")
    assert _sql(db, "SELECT nom FROM categorie WHERE id = ?", (homonyme,)) == [("Virement interne",)]
