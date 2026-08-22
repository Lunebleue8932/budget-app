"""ajoute categorie_compte (+ compte.categorie_compte_id), import_configuration
(colonnes/propriétés du fichier d'import, configurables) et import_historique
(trace de chaque import confirmé)

Revision ID: 0011
Revises: 0010
Create Date: 2026-07-12
"""
import json

from alembic import op
import sqlalchemy as sa

revision = "0011"
down_revision = "0010"
branch_labels = None
depends_on = None

# Mapping historique (12 colonnes, format d'export bancaire déjà utilisé) :
# repris tel quel comme configuration par défaut à la migration.
COLONNES_PAR_DEFAUT = [
    {"index": 1, "propriete": "date"},
    {"index": 4, "propriete": "nature"},
    {"index": 6, "propriete": "categorie_banque"},
    {"index": 7, "propriete": "montant"},
    {"index": 10, "propriete": "compte_banque"},
]


def upgrade():
    op.create_table(
        "categorie_compte",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column("nom", sa.String, nullable=False, unique=True),
    )

    with op.batch_alter_table("compte", schema=None) as batch_op:
        batch_op.add_column(sa.Column("categorie_compte_id", sa.Integer, nullable=True))
        batch_op.create_foreign_key(
            "fk_compte_categorie_compte_id",
            "categorie_compte",
            ["categorie_compte_id"],
            ["id"],
            ondelete="SET NULL",
        )

    op.create_table(
        "import_configuration",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column("colonnes", sa.JSON, nullable=False),
    )
    conn = op.get_bind()
    conn.execute(
        sa.text("INSERT INTO import_configuration (colonnes) VALUES (:colonnes)"),
        {"colonnes": json.dumps(COLONNES_PAR_DEFAUT)},
    )

    op.create_table(
        "import_historique",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column("date_import", sa.DateTime, nullable=False),
        sa.Column("nom_fichier", sa.String, nullable=True),
        sa.Column("operations_creees", sa.Integer, nullable=False, server_default="0"),
        sa.Column("lignes_ignorees", sa.Integer, nullable=False, server_default="0"),
    )


def downgrade():
    op.drop_table("import_historique")
    op.drop_table("import_configuration")

    with op.batch_alter_table("compte", schema=None) as batch_op:
        batch_op.drop_column("categorie_compte_id")

    op.drop_table("categorie_compte")
