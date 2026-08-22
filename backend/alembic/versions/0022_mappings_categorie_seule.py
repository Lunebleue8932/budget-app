"""une correspondance d'import ne vise plus qu'une catégorie.

Depuis 0019, une correspondance mémorisée pouvait viser soit une catégorie de
dépense, soit un TYPE d'opération (« Mouvements internes » -> Virement interne).
Les quatre types concernés — virement interne, prêt reçu, remboursement reçu,
remboursement de prêt — ne portent par nature aucune catégorie : les proposer
dans une liste de correspondances *de catégorie* mélangeait deux axes.

Le type est désormais posé exclusivement par les règles de catégorisation, qui
sont évaluées AVANT les correspondances (cf. services/import_bancaire.
_resoudre_ligne). Une correspondance ne renseigne plus que la catégorie, et
seulement pour les types qui en admettent une.

Pour que rien ne se perde, chaque correspondance visant un type est convertie
ici en une règle strictement équivalente : « catégorie bancaire EST <libellé> »
-> ce type. C'est la traduction fidèle de ce que faisait la correspondance, avec
un seul élargissement assumé : une correspondance est propre à un preset, une
règle est globale — en pratique les libellés visés sont propres à une banque,
donc à un preset.

Ces règles sont insérées EN TÊTE : ce sont des égalités exactes, elles doivent
primer sur des règles génériques écrites plus tard (« nature contient PRET »).

Revision ID: 0022
Revises: 0021
Create Date: 2026-08-03
"""
import json

from alembic import op
import sqlalchemy as sa

revision = "0022"
down_revision = "0021"
branch_labels = None
depends_on = None


def _conditions_egalite(nom_banque: str) -> str:
    """La condition d'une règle reproduisant une correspondance exacte."""
    return json.dumps(
        {
            "operateur": "ET",
            "groupes": [
                {
                    "operateur": "ET",
                    "conditions": [
                        {
                            "champ": "categorie_banque",
                            "operateur": "est",
                            "valeur": nom_banque,
                        }
                    ],
                }
            ],
        },
        ensure_ascii=False,
    )


def upgrade():
    connexion = op.get_bind()

    # ---------- Conversion en règles ----------
    # Dédoublonné sur (libellé, type) : le même libellé mappé dans deux presets
    # vers le même type ne donne qu'une règle, celle-ci étant globale.
    a_convertir = connexion.execute(
        sa.text(
            "SELECT DISTINCT nom_banque, type_id FROM import_categorie_mapping "
            "WHERE type_id IS NOT NULL ORDER BY nom_banque"
        )
    ).fetchall()

    if a_convertir:
        # Les règles converties passent devant les règles existantes, qui sont
        # décalées d'autant : une égalité exacte doit primer sur un « contient ».
        connexion.execute(
            sa.text("UPDATE regle_categorisation SET ordre = ordre + :decalage"),
            {"decalage": len(a_convertir)},
        )
        for position, (nom_banque, type_id) in enumerate(a_convertir):
            connexion.execute(
                sa.text(
                    "INSERT INTO regle_categorisation (nom, ordre, actif, type_id, "
                    "categorie_id, conditions) "
                    "VALUES (:nom, :ordre, 1, :type_id, NULL, :conditions)"
                ),
                {
                    "nom": f"{nom_banque} (correspondance convertie)",
                    "ordre": position,
                    "type_id": type_id,
                    "conditions": _conditions_egalite(nom_banque),
                },
            )
        connexion.execute(
            sa.text("DELETE FROM import_categorie_mapping WHERE type_id IS NOT NULL")
        )

    # ---------- Schéma ----------
    # Une correspondance sans cible ne veut plus rien dire une fois type_id
    # retiré : celles qui en seraient restées là (impossible en pratique) sont
    # supprimées avant de reposer la contrainte NOT NULL.
    connexion.execute(
        sa.text("DELETE FROM import_categorie_mapping WHERE categorie_id IS NULL")
    )
    with op.batch_alter_table("import_categorie_mapping", schema=None) as batch_op:
        batch_op.drop_column("type_id")
        batch_op.alter_column("categorie_id", existing_type=sa.Integer, nullable=False)


def downgrade():
    connexion = op.get_bind()

    with op.batch_alter_table("import_categorie_mapping", schema=None) as batch_op:
        batch_op.alter_column("categorie_id", existing_type=sa.Integer, nullable=True)
        batch_op.add_column(sa.Column("type_id", sa.Integer, nullable=True))
        batch_op.create_foreign_key(
            "fk_import_categorie_mapping_type",
            "type_operation",
            ["type_id"],
            ["id"],
            ondelete="CASCADE",
        )

    # Les règles converties redeviennent des correspondances. Faute de savoir à
    # quel preset chacune appartenait, elles sont restaurées sur tous les
    # presets — ce qui reproduit le comportement d'une règle globale.
    regles = connexion.execute(
        sa.text(
            "SELECT id, nom, type_id, conditions FROM regle_categorisation "
            "WHERE nom LIKE '%(correspondance convertie)'"
        )
    ).fetchall()
    presets = [
        row[0] for row in connexion.execute(sa.text("SELECT id FROM import_preset")).fetchall()
    ]
    for regle_id, nom, type_id, conditions in regles:
        try:
            valeur = json.loads(conditions)["groupes"][0]["conditions"][0]["valeur"]
        except (KeyError, IndexError, ValueError):
            continue
        for preset_id in presets:
            connexion.execute(
                sa.text(
                    "INSERT OR IGNORE INTO import_categorie_mapping "
                    "(preset_id, nom_banque, categorie_id, type_id) "
                    "VALUES (:preset_id, :nom_banque, NULL, :type_id)"
                ),
                {"preset_id": preset_id, "nom_banque": valeur, "type_id": type_id},
            )
        connexion.execute(
            sa.text("DELETE FROM regle_categorisation WHERE id = :id"), {"id": regle_id}
        )
