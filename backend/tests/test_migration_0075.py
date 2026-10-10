"""Migration 0075 : « action » devient « titre possédé ».

CE QUI COMPTE, ET POURQUOI C'EST TESTÉ PLUTÔT QUE SUPPOSÉ. La 0075 RECRÉE deux
tables (le catalogue de titres et le versant « titres » d'une opération) et en
retire les anciennes. Si une ligne se perdait en route, ce serait un achat
d'ETF, c'est-à-dire un mouvement de compte : le prix de revient d'un portefeuille
entier s'en trouverait faux, sans qu'aucune erreur ne le dise.

Trois choses sont donc vérifiées sur une base aux données RÉALISTES (un titre, un
achat, une vente) : les lignes passent intactes sous leur nouveau nom, les
contraintes et les index portent les noms du modèle (et non les anciens), et le
retour arrière rend exactement les noms d'avant.
"""
import os
import sqlite3
import subprocess
import sys
from pathlib import Path

BACKEND_DIR = Path(__file__).resolve().parents[1]
PYTHON = sys.executable


def _alembic(db_path: Path, commande: str, revision: str):
    env = {**os.environ, "BUDGET_DB_PATH": str(db_path)}
    resultat = subprocess.run(
        [str(PYTHON), "-m", "alembic", commande, revision],
        cwd=BACKEND_DIR,
        env=env,
        capture_output=True,
        text=True,
    )
    assert resultat.returncode == 0, resultat.stderr
    return resultat


def _tables(db_path: Path) -> set[str]:
    conn = sqlite3.connect(db_path)
    noms = {l[0] for l in conn.execute("SELECT name FROM sqlite_master WHERE type = 'table'")}
    conn.close()
    return noms


def _sql(db_path: Path, requete: str, params=()):
    conn = sqlite3.connect(db_path)
    try:
        return conn.execute(requete, params).fetchall()
    finally:
        conn.close()


def _base_avec_un_portefeuille(db_path: Path) -> None:
    """Une base à la révision 0074, avec un titre, un achat et une vente."""
    _alembic(db_path, "upgrade", "0074")
    conn = sqlite3.connect(db_path)
    monnaie_id = conn.execute("SELECT id FROM monnaie LIMIT 1").fetchone()[0]
    conn.execute(
        "INSERT INTO action (nom, valeur, monnaie_id, code_isin, archivee) "
        "VALUES ('AMUNDI MSCI WORLD', 101.5, ?, 'IE000BI8OT95', 0)",
        (monnaie_id,),
    )
    action_id = conn.execute("SELECT id FROM action").fetchone()[0]
    compte_type = conn.execute("SELECT id FROM type_compte LIMIT 1").fetchone()[0]
    conn.execute("INSERT INTO compte (nom, type_id) VALUES ('PEA', ?)", (compte_type,))
    compte_id = conn.execute("SELECT id FROM compte").fetchone()[0]
    type_id = conn.execute("SELECT id FROM type_operation WHERE code = 'action'").fetchone()[0]
    for jour, sens, quantite, prix in (("2026-01-10", "achat", 10, 90.0), ("2026-02-10", "vente", 4, 95.0)):
        conn.execute(
            "INSERT INTO operation (date, compte_id, type_id, nature, montant, monnaie_id, sens, "
            "statut, montant_du, montant_a_rembourser, recurrente, imprevue) "
            "VALUES (?, ?, ?, 'Titres', ?, ?, 'dépense', 'réel', 0, 0, 0, 0)",
            (jour, compte_id, type_id, quantite * prix, monnaie_id),
        )
        operation_id = conn.execute("SELECT max(id) FROM operation").fetchone()[0]
        conn.execute(
            "INSERT INTO operation_action (operation_id, action_id, sens, quantite, prix_unitaire) "
            "VALUES (?, ?, ?, ?, ?)",
            (operation_id, action_id, sens, quantite, prix),
        )
    conn.commit()
    conn.close()


def test_les_lignes_passent_intactes_sous_leur_nouveau_nom(tmp_path):
    base = tmp_path / "m.db"
    _base_avec_un_portefeuille(base)
    avant = _sql(base, "SELECT nom, valeur, code_isin, archivee FROM action")

    _alembic(base, "upgrade", "0075")

    assert "action" not in _tables(base)
    assert "operation_action" not in _tables(base)
    assert {"titre_possede", "operation_titre"} <= _tables(base)
    assert _sql(base, "SELECT nom, valeur, code_isin, archivee FROM titre_possede") == avant
    # Les deux mouvements, avec leur titre : la colonne a changé de nom, pas de sens.
    mouvements = _sql(
        base,
        "SELECT t.nom, o.sens, o.quantite, o.prix_unitaire FROM operation_titre o "
        "JOIN titre_possede t ON t.id = o.titre_id ORDER BY o.id",
    )
    assert mouvements == [
        ("AMUNDI MSCI WORLD", "achat", 10.0, 90.0),
        ("AMUNDI MSCI WORLD", "vente", 4.0, 95.0),
    ]
    # Le CODE du type d'opération reste « action » : c'est une donnée, pas un nom de table.
    assert _sql(base, "SELECT count(*) FROM type_operation WHERE code = 'action'") == [(1,)]


def test_les_contraintes_et_les_index_portent_les_noms_du_modele(tmp_path):
    base = tmp_path / "m.db"
    _alembic(base, "upgrade", "0075")
    ddl = "\n".join(l[0] or "" for l in _sql(base, "SELECT sql FROM sqlite_master"))
    for nom in (
        "ck_titre_possede_valeur_positive", "fk_titre_possede_monnaie",
        "ck_operation_titre_quantite_positive", "ck_operation_titre_sens",
        "ix_titre_possede_code_isin", "ix_operation_titre_titre_id",
    ):
        assert nom in ddl, nom
    # Aucune trace des anciens noms : c'est tout l'intérêt d'avoir recréé les tables.
    for ancien in ("ck_action_", "fk_action_", "ix_action_", "operation_action", "action_id"):
        assert ancien not in ddl, ancien


def test_le_retour_arriere_rend_les_noms_d_avant_sans_rien_perdre(tmp_path):
    base = tmp_path / "m.db"
    _base_avec_un_portefeuille(base)
    _alembic(base, "upgrade", "0075")
    _alembic(base, "downgrade", "0074")

    assert {"action", "operation_action"} <= _tables(base)
    assert not ({"titre_possede", "operation_titre"} & _tables(base))
    assert _sql(base, "SELECT nom, valeur, code_isin FROM action") == [
        ("AMUNDI MSCI WORLD", 101.5, "IE000BI8OT95")
    ]
    assert _sql(base, "SELECT count(*) FROM operation_action WHERE action_id IS NOT NULL") == [(2,)]
    ddl = "\n".join(l[0] or "" for l in _sql(base, "SELECT sql FROM sqlite_master"))
    assert "ck_action_valeur_positive" in ddl and "ix_operation_action_action_id" in ddl
