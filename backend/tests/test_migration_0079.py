"""Migration 0079 : les conditions « colonne_N » deviennent des colonnes dummy.

CE QUI COMPTE. Une règle écrite avec « Colonne n° 12 » lit, après la mise à jour, exactement la
même cellule : une colonne dummy « Colonne 12 », lue au numéro 12 par chaque format que la règle
vise (tous les formats bancaires si elle n'en restreint aucun). Le retour arrière rend la forme
d'avant.
"""
import json
import sqlite3

from .test_migration_0078 import _alembic, _sql


def _base_0078(db_path):
    _alembic(db_path, "upgrade", "0078")
    conn = sqlite3.connect(db_path)
    try:
        colonnes = json.dumps([{"index": 1, "propriete": "date"}])
        a = conn.execute(
            "INSERT INTO import_preset (nom, domaine, colonnes, colonnes_comparaison, "
            "mode_comparaison, lignes_entete, libelles_sens_sortie, libelles_sens_entree, "
            "libelles_statut_execute, libelles_statut_attente, libelles_statut_refuse, "
            "libelles_type_achat, libelles_type_vente, libelles_type_transfert) "
            "VALUES ('A', 'bancaire', ?, '[]', 'exclusion', 0, '[]', '[]', '[]', '[]', '[]', "
            "'[]', '[]', '[]')",
            (colonnes,),
        ).lastrowid
        b = conn.execute(
            "INSERT INTO import_preset (nom, domaine, colonnes, colonnes_comparaison, "
            "mode_comparaison, lignes_entete, libelles_sens_sortie, libelles_sens_entree, "
            "libelles_statut_execute, libelles_statut_attente, libelles_statut_refuse, "
            "libelles_type_achat, libelles_type_vente, libelles_type_transfert) "
            "VALUES ('B', 'bancaire', ?, '[]', 'exclusion', 0, '[]', '[]', '[]', '[]', '[]', "
            "'[]', '[]', '[]')",
            (colonnes,),
        ).lastrowid
        conditions = {
            "operateur": "ET",
            "groupes": [
                {
                    "operateur": "OU",
                    "conditions": [
                        {"champ": "colonne_12", "operateur": "contient", "valeur": "LOYER"},
                        {"champ": "nature", "operateur": "contient", "valeur": "LOYER"},
                    ],
                }
            ],
        }
        sorties = [
            {
                "conditions": {
                    "operateur": "ET",
                    "groupes": [
                        {
                            "operateur": "ET",
                            "conditions": [
                                {"champ": "colonne_12", "operateur": "est", "valeur": "X"}
                            ],
                        }
                    ],
                }
            }
        ]
        conn.execute(
            "INSERT INTO regle_categorisation (nom, conditions, sorties, presets, actif, "
            "arreter_apres, ordre) VALUES ('Tous', ?, ?, NULL, 1, 1, 1)",
            (json.dumps(conditions), json.dumps(sorties)),
        )
        conn.execute(
            "INSERT INTO regle_categorisation (nom, conditions, sorties, presets, actif, "
            "arreter_apres, ordre) VALUES ('Seulement B', ?, '[]', ?, 1, 1, 2)",
            (json.dumps(conditions), json.dumps([b])),
        )
        conn.commit()
        return a, b
    finally:
        conn.close()


def test_la_0079_reprend_les_conditions_colonne_n_en_colonnes_dummy(tmp_path):
    base = tmp_path / "budget.db"
    a, b = _base_0078(base)

    _alembic(base, "upgrade", "0079")

    dummies = _sql(base, "SELECT id, nom FROM colonne_dummy")
    assert [nom for _, nom in dummies] == ["Colonne 12"]
    dummy_id = dummies[0][0]
    lectures = _sql(
        base,
        'SELECT preset_id, colonne_dummy_id, "index" FROM import_preset_colonne_dummy '
        "ORDER BY preset_id",
    )
    # La règle sans restriction vise TOUS les formats bancaires (celui que la base crée d'office
    # compris) : chacun lit la colonne, une seule fois malgré les deux règles.
    bancaires = [i for (i,) in _sql(base, "SELECT id FROM import_preset WHERE domaine = 'bancaire'")]
    assert {a, b} <= set(bancaires)
    assert lectures == [(i, dummy_id, 12) for i in sorted(bancaires)]
    for conditions, sorties in _sql(base, "SELECT conditions, sorties FROM regle_categorisation"):
        texte = conditions + sorties
        assert "colonne_12" not in texte
        assert f"dummy_{dummy_id}" in json.loads(conditions)["groupes"][0]["conditions"][0]["champ"]

    _alembic(base, "downgrade", "0078")

    for conditions, sorties in _sql(base, "SELECT conditions, sorties FROM regle_categorisation"):
        assert json.loads(conditions)["groupes"][0]["conditions"][0]["champ"] == "colonne_12"
    tables = {nom for (nom,) in _sql(base, "SELECT name FROM sqlite_master WHERE type='table'")}
    assert "colonne_dummy" not in tables
