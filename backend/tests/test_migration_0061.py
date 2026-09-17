"""La migration 0061 rend une base neuve NEUTRE — « Autres » et rien d'autre —
sans jamais retirer une catégorie dont quelque chose dépend.

LES DEUX MOITIÉS SE TIENNENT, et c'est pour ça qu'elles sont testées ensemble :
supprimer largement ferait perdre des catégories en usage chez qui l'application
tourne depuis des mois ; supprimer prudemment ne nettoierait rien du tout. Le
départage est « est-ce que quelque chose la porte ? », et il n'y a que sur une
base réelle, migrations comprises, qu'on peut le vérifier.

Comme les autres tests de migration, alembic est appelé en SOUS-PROCESSUS,
exactement comme en ligne de commande : le schéma des autres tests est construit
par `Base.metadata.create_all` et ne passe jamais par les scripts de migration.
"""
import os
import sqlite3
import subprocess
import sys
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[1]
PYTHON = sys.executable

CATEGORIES_LIVREES_AUTREFOIS = {
    "Alimentaire",
    "Loisirs & sorties",
    "Charges fixes",
    "Réparation & entretien",
    "Vêtements & équipement sport",
    "Entrées d'argent",
}


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


def _noms_categories(db_path: Path) -> set[str]:
    conn = sqlite3.connect(db_path)
    try:
        return {r[0] for r in conn.execute("SELECT nom FROM categorie")}
    finally:
        conn.close()


def _id_categorie(conn, nom: str) -> int:
    return conn.execute("SELECT id FROM categorie WHERE nom = ?", (nom,)).fetchone()[0]


def test_une_base_neuve_n_a_que_autres(tmp_path):
    db_path = tmp_path / "neuve.db"
    _alembic(db_path, "head")

    assert _noms_categories(db_path) == {"Autres"}


def test_une_categorie_qui_porte_une_operation_est_gardee(tmp_path):
    """LE CAS D'UNE BASE EN USAGE : celles dont on se sert sont intactes."""
    db_path = tmp_path / "en_usage.db"
    _alembic(db_path, "0060")

    conn = sqlite3.connect(db_path)
    type_courant = conn.execute(
        "SELECT id FROM type_compte WHERE nom = 'courant'"
    ).fetchone()[0]
    monnaie_id = conn.execute("SELECT id FROM monnaie").fetchone()[0]
    conn.execute(
        "INSERT INTO compte (nom, type_id, ordre) VALUES ('Courant', ?, 0)",
        (type_courant,),
    )
    conn.execute(
        "INSERT INTO compte_monnaie (compte_id, monnaie_id, solde_initial, ordre, active) "
        "VALUES (1, ?, 0, 0, 1)",
        (monnaie_id,),
    )
    type_classique = conn.execute(
        "SELECT id FROM type_operation WHERE code = 'classique'"
    ).fetchone()[0]
    conn.execute(
        "INSERT INTO operation (date, compte_id, categorie_id, type_id, nature, montant, "
        "sens, statut, montant_du, montant_a_rembourser, recurrente, monnaie_id) "
        "VALUES ('2026-01-05', 1, ?, ?, 'Courses', 42.0, 'dépense', 'réel', 0, 0, 0, ?)",
        (_id_categorie(conn, "Alimentaire"), type_classique, monnaie_id),
    )
    conn.commit()
    conn.close()

    _alembic(db_path, "head")

    assert _noms_categories(db_path) == {"Autres", "Alimentaire"}


def test_une_categorie_qui_ne_porte_qu_une_intention_est_gardee(tmp_path):
    """UNE ENVELOPPE ou UN OBJECTIF suffisent : les deux sont écrits à la main,
    et disent que la catégorie sert — même si aucune dépense n'y est encore
    tombée."""
    db_path = tmp_path / "intentions.db"
    _alembic(db_path, "0060")

    conn = sqlite3.connect(db_path)
    monnaie_id = conn.execute("SELECT id FROM monnaie").fetchone()[0]
    conn.execute(
        "INSERT INTO categorie_budget_mensuel (categorie_id, monnaie_id, annee, mois, montant) "
        "VALUES (?, ?, 2026, 3, 300.0)",
        (_id_categorie(conn, "Charges fixes"), monnaie_id),
    )
    conn.execute(
        "UPDATE categorie SET objectif_pourcentage = 15 WHERE nom = 'Loisirs & sorties'"
    )
    conn.commit()
    conn.close()

    _alembic(db_path, "head")

    assert _noms_categories(db_path) == {"Autres", "Charges fixes", "Loisirs & sorties"}


def test_une_categorie_creee_par_l_utilisateur_n_est_jamais_touchee(tmp_path):
    """La migration ne connaît QUE les six noms livrés par 0006 : une catégorie
    créée à la main, même vide, ne la regarde pas."""
    db_path = tmp_path / "perso.db"
    _alembic(db_path, "0060")

    conn = sqlite3.connect(db_path)
    conn.execute(
        "INSERT INTO categorie (nom, ordre, couleur_index, objectif_pourcentage, est_entree) "
        "VALUES ('Abonnements', 20, 9, 0, 0)"
    )
    conn.commit()
    conn.close()

    _alembic(db_path, "head")

    assert _noms_categories(db_path) == {"Autres", "Abonnements"}


def test_aucune_categorie_livree_ne_survit_sans_raison(tmp_path):
    """Le complément du test précédent : ce qui n'a jamais servi part, et il
    n'en reste aucune."""
    db_path = tmp_path / "vide.db"
    _alembic(db_path, "head")

    assert _noms_categories(db_path) & CATEGORIES_LIVREES_AUTREFOIS == set()
