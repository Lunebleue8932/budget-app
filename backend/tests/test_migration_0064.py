"""La migration 0064 pose quatre catégories d'orientation, et SEULEMENT sur une
base neuve.

LES DEUX MOITIÉS SE TIENNENT, comme pour la 0061 qui l'a précédée : ne rien
poser laisse l'application s'ouvrir sur un « Autres » solitaire, où rien ne dit
à quoi servent les catégories ; poser largement fait apparaître quatre lignes
dans une liste que quelqu'un a passé six mois à composer. Le départage est
« cette base vient-elle de naître ? », et il ne se vérifie que sur une vraie
base, migrations comprises.
"""
import os
import sqlite3
import subprocess
import sys
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[1]
PYTHON = sys.executable

ORIENTATION = {"Alimentaire", "Loisirs", "Transports", "Charges fixes", "Entrées d'argent"}


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


def _categories(db_path: Path) -> dict:
    conn = sqlite3.connect(db_path)
    try:
        return {
            nom: {"ordre": ordre, "couleur": couleur, "est_entree": est_entree}
            for nom, ordre, couleur, est_entree in conn.execute(
                "SELECT nom, ordre, couleur_index, est_entree FROM categorie"
            )
        }
    finally:
        conn.close()


def test_une_base_neuve_recoit_les_categories_d_orientation(tmp_path):
    db_path = tmp_path / "neuve.db"
    _alembic(db_path, "head")

    categories = _categories(db_path)
    assert set(categories) == ORIENTATION | {"Autres"}
    # La catégorie d'entrée porte sa case, les quatre autres non : c'est la
    # COLONNE qui décide du sens d'une opération qu'on y range (migration 0060).
    assert categories["Entrées d'argent"]["est_entree"] == 1
    assert all(categories[nom]["est_entree"] == 0 for nom in ORIENTATION - {"Entrées d'argent"})


def test_deux_categories_ne_partagent_jamais_une_couleur(tmp_path):
    """Un index déjà pris ferait deux barres de la même teinte dans
    l'histogramme — et « Autres » existe avant que la migration passe."""
    db_path = tmp_path / "couleurs.db"
    _alembic(db_path, "head")

    couleurs = [c["couleur"] for c in _categories(db_path).values()]
    assert len(set(couleurs)) == len(couleurs)


def test_une_base_qui_porte_des_operations_n_est_pas_touchee(tmp_path):
    """LA GARDE CENTRALE : personne n'a demandé à voir quatre catégories
    apparaître dans une liste composée à la main."""
    db_path = tmp_path / "en_usage.db"
    _alembic(db_path, "0063")

    conn = sqlite3.connect(db_path)
    type_courant = conn.execute("SELECT id FROM type_compte WHERE nom = 'courant'").fetchone()[0]
    monnaie_id = conn.execute("SELECT id FROM monnaie").fetchone()[0]
    categorie_id = conn.execute("SELECT id FROM categorie WHERE nom = 'Autres'").fetchone()[0]
    type_classique = conn.execute(
        "SELECT id FROM type_operation WHERE code = 'classique'"
    ).fetchone()[0]
    conn.execute("INSERT INTO compte (nom, type_id, ordre, actif) VALUES ('CC', ?, 0, 1)", (type_courant,))
    conn.execute(
        "INSERT INTO compte_monnaie (compte_id, monnaie_id, solde_initial, ordre, active) "
        "VALUES (1, ?, 0, 0, 1)",
        (monnaie_id,),
    )
    conn.execute(
        "INSERT INTO operation (date, compte_id, categorie_id, type_id, nature, montant, "
        "sens, statut, montant_du, montant_a_rembourser, recurrente, monnaie_id) "
        "VALUES ('2026-01-05', 1, ?, ?, 'Courses', 42.0, 'dépense', 'réel', 0, 0, 0, ?)",
        (categorie_id, type_classique, monnaie_id),
    )
    conn.commit()
    conn.close()

    _alembic(db_path, "head")

    assert set(_categories(db_path)) == {"Autres"}


def test_une_base_qui_a_deja_ses_categories_n_est_pas_touchee(tmp_path):
    """Une base sans opération mais avec des catégories créées à la main
    appartient à quelqu'un qui a commencé à s'organiser : les deux conditions
    comptent."""
    db_path = tmp_path / "organisee.db"
    _alembic(db_path, "0063")

    conn = sqlite3.connect(db_path)
    conn.execute(
        "INSERT INTO categorie (nom, ordre, couleur_index, objectif_pourcentage, "
        "est_entree, active) VALUES ('Abonnements', 20, 9, 0, 0, 1)"
    )
    conn.commit()
    conn.close()

    _alembic(db_path, "head")

    assert set(_categories(db_path)) == {"Autres", "Abonnements"}
