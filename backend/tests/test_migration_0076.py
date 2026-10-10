"""Migration 0076 : les répartitions d'un titre, les axes zone et secteur, le dictionnaire d'ETF.

CE QUI COMPTE, ET POURQUOI C'EST TESTÉ PLUTÔT QUE SUPPOSÉ. La 0076 RECRÉE deux tables
que tout le reste référence — `type_titre` (pour relâcher son CHECK d'axe) et
`titre_possede` (pour retirer `classe_actif_id`) — et MIGRE une colonne en lignes de
répartition. Trois choses ne doivent pas bouger :

  - une classe d'actif déjà posée devient une ligne à 100 %, pas une ligne perdue ;
  - les identifiants des étiquettes existantes restent ceux d'avant (les règles
    d'import, les titres et les répartitions les désignent par identifiant) ;
  - aucune clé étrangère ne reste orpheline après les deux recréations.

Le retour arrière reconstruit la classe unique depuis la ligne qui pèse le plus.
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


def _colonnes(db_path: Path, table: str) -> set[str]:
    return {l[1] for l in _sql(db_path, f"PRAGMA table_info({table})")}


def _base_0075(db_path: Path) -> dict:
    """Une base à la 0075 : deux titres, l'un avec une classe d'actif, un achat."""
    _alembic(db_path, "upgrade", "0075")
    conn = sqlite3.connect(db_path)
    monnaie = conn.execute("SELECT id FROM monnaie LIMIT 1").fetchone()[0]
    classe = conn.execute("SELECT id FROM type_titre WHERE axe = 'classe' AND nom = 'Actions'").fetchone()[0]
    enveloppe = conn.execute("INSERT INTO type_titre (nom, axe) VALUES ('ETF', 'enveloppe')").lastrowid
    conn.execute(
        "INSERT INTO titre_possede (nom, valeur, monnaie_id, code_isin, type_titre_id, classe_actif_id) "
        "VALUES ('WORLD', 100, ?, 'IE000BI8OT95', ?, ?)",
        (monnaie, enveloppe, classe),
    )
    conn.execute("INSERT INTO titre_possede (nom, valeur, monnaie_id) VALUES ('SANS CLASSE', 10, ?)", (monnaie,))
    conn.commit()
    ids = {
        "classe": classe,
        "enveloppe": enveloppe,
        "regle_type": None,
    }
    conn.close()
    return ids


def test_une_classe_devient_une_ligne_a_cent_pour_cent(tmp_path):
    base = tmp_path / "m.db"
    ids = _base_0075(base)

    _alembic(base, "upgrade", "0076")

    assert "classe_actif_id" not in _colonnes(base, "titre_possede")
    assert {"composition", "composition_couverture_pct"} <= _colonnes(base, "titre_possede")
    lignes = _sql(
        base,
        "SELECT t.nom, e.axe, e.type_titre_id, e.poids_pct FROM exposition_titre e "
        "JOIN titre_possede t ON t.id = e.titre_id",
    )
    assert lignes == [("WORLD", "classe", ids["classe"], 100.0)]
    # Le titre et ses autres colonnes n'ont pas bougé.
    assert _sql(base, "SELECT nom, valeur, code_isin, type_titre_id FROM titre_possede ORDER BY id") == [
        ("WORLD", 100.0, "IE000BI8OT95", ids["enveloppe"]),
        ("SANS CLASSE", 10.0, None, None),
    ]


def test_les_zones_et_les_secteurs_sont_semes_et_les_etiquettes_gardent_leur_identifiant(tmp_path):
    base = tmp_path / "m.db"
    ids = _base_0075(base)

    _alembic(base, "upgrade", "0076")

    assert _sql(base, "SELECT count(*) FROM type_titre WHERE axe = 'zone'") == [(7,)]
    assert _sql(base, "SELECT count(*) FROM type_titre WHERE axe = 'secteur'") == [(11,)]
    assert ("États-Unis",) in _sql(base, "SELECT nom FROM type_titre WHERE axe = 'zone'")
    assert ("Asie (hors Chine)",) in _sql(base, "SELECT nom FROM type_titre WHERE axe = 'zone'")
    assert ("Technologies de l'information",) in _sql(base, "SELECT nom FROM type_titre WHERE axe = 'secteur'")
    # Les cinq classes et l'enveloppe d'avant : mêmes identifiants.
    assert _sql(base, "SELECT axe FROM type_titre WHERE id = ?", (ids["classe"],)) == [("classe",)]
    assert _sql(base, "SELECT nom, axe FROM type_titre WHERE id = ?", (ids["enveloppe"],)) == [
        ("ETF", "enveloppe")
    ]


def test_aucune_cle_etrangere_orpheline_apres_les_recreations(tmp_path):
    base = tmp_path / "m.db"
    _base_0075(base)
    _alembic(base, "upgrade", "0076")
    assert _sql(base, "PRAGMA foreign_key_check") == []


def test_le_check_d_axe_accepte_zone_et_secteur_et_refuse_le_reste(tmp_path):
    base = tmp_path / "m.db"
    _alembic(base, "upgrade", "0076")
    conn = sqlite3.connect(base)
    conn.execute("INSERT INTO type_titre (nom, axe) VALUES ('Japon', 'zone')")
    conn.execute("INSERT INTO type_titre (nom, axe) VALUES ('Luxe', 'secteur')")
    try:
        conn.execute("INSERT INTO type_titre (nom, axe) VALUES ('Intrus', 'devise')")
        refuse = False
    except sqlite3.IntegrityError:
        refuse = True
    conn.close()
    assert refuse


def test_les_contraintes_de_la_table_des_repartitions_tiennent(tmp_path):
    base = tmp_path / "m.db"
    ids = _base_0075(base)
    _alembic(base, "upgrade", "0076")
    conn = sqlite3.connect(base)
    titre = conn.execute("SELECT id FROM titre_possede LIMIT 1").fetchone()[0]
    zone = conn.execute("SELECT id FROM type_titre WHERE axe = 'zone' LIMIT 1").fetchone()[0]
    for axe, poids in (("zone", 0), ("zone", 101), ("devise", 50)):
        try:
            conn.execute(
                "INSERT INTO exposition_titre (titre_id, axe, type_titre_id, poids_pct) VALUES (?,?,?,?)",
                (titre, axe, zone, poids),
            )
            raise AssertionError(f"{axe}/{poids} aurait dû être refusé")
        except sqlite3.IntegrityError:
            pass
    conn.execute(
        "INSERT INTO exposition_titre (titre_id, axe, type_titre_id, poids_pct) VALUES (?,?,?,?)",
        (titre, "zone", zone, 50),
    )
    try:
        conn.execute(
            "INSERT INTO exposition_titre (titre_id, axe, type_titre_id, poids_pct) VALUES (?,?,?,?)",
            (titre, "zone", zone, 20),
        )
        raise AssertionError("la même étiquette deux fois aurait dû être refusée")
    except sqlite3.IntegrityError:
        pass
    conn.close()
    assert ids  # la base d'avant existait bien


def test_le_retour_arriere_rend_la_classe_qui_pese_le_plus(tmp_path):
    base = tmp_path / "m.db"
    ids = _base_0075(base)
    _alembic(base, "upgrade", "0076")
    conn = sqlite3.connect(base)
    titre = conn.execute("SELECT id FROM titre_possede WHERE nom = 'SANS CLASSE'").fetchone()[0]
    oblig = conn.execute("SELECT id FROM type_titre WHERE axe = 'classe' AND nom = 'Obligations'").fetchone()[0]
    actions = ids["classe"]
    conn.execute(
        "INSERT INTO exposition_titre (titre_id, axe, type_titre_id, poids_pct) VALUES (?, 'classe', ?, 30)",
        (titre, actions),
    )
    conn.execute(
        "INSERT INTO exposition_titre (titre_id, axe, type_titre_id, poids_pct) VALUES (?, 'classe', ?, 70)",
        (titre, oblig),
    )
    zone = conn.execute("SELECT id FROM type_titre WHERE axe = 'zone' LIMIT 1").fetchone()[0]
    conn.execute(
        "INSERT INTO exposition_titre (titre_id, axe, type_titre_id, poids_pct) VALUES (?, 'zone', ?, 100)",
        (titre, zone),
    )
    conn.commit()
    conn.close()

    _alembic(base, "downgrade", "0075")

    assert "classe_actif_id" in _colonnes(base, "titre_possede")
    assert "exposition_titre" not in {l[0] for l in _sql(base, "SELECT name FROM sqlite_master WHERE type='table'")}
    classes = dict(_sql(base, "SELECT nom, classe_actif_id FROM titre_possede"))
    assert classes == {"WORLD": actions, "SANS CLASSE": oblig}
    # Zones et secteurs partent avec leur axe ; enveloppes et classes demeurent.
    assert _sql(base, "SELECT count(*) FROM type_titre WHERE axe IN ('zone', 'secteur')") == [(0,)]
    assert _sql(base, "SELECT count(*) FROM type_titre WHERE axe = 'classe'") == [(5,)]
    assert _sql(base, "PRAGMA foreign_key_check") == []
