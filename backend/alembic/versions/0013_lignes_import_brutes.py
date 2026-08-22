"""ajoute ligne_import_brute (stock centralisé de toutes les lignes déjà
importées, format brut intégral, pour détecter les doublons d'un import à
l'autre), import_configuration.colonnes_exclues_comparaison (mini-config des
champs ignorés dans la comparaison) et import_historique.doublons_detectes

Revision ID: 0013
Revises: 0012
Create Date: 2026-07-22
"""
from alembic import op
import sqlalchemy as sa

revision = "0013"
down_revision = "0012"
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table("import_configuration", schema=None) as batch_op:
        batch_op.add_column(
            sa.Column("colonnes_exclues_comparaison", sa.JSON, nullable=False, server_default="[]")
        )

    with op.batch_alter_table("import_historique", schema=None) as batch_op:
        batch_op.add_column(
            sa.Column("doublons_detectes", sa.Integer, nullable=False, server_default="0")
        )

    op.create_table(
        "ligne_import_brute",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column("donnees", sa.JSON, nullable=False),
        sa.Column(
            "import_historique_id",
            sa.Integer,
            sa.ForeignKey("import_historique.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("date_creation", sa.DateTime, nullable=False),
    )
    op.create_index(
        "ix_ligne_import_brute_historique", "ligne_import_brute", ["import_historique_id"]
    )


def downgrade():
    op.drop_index("ix_ligne_import_brute_historique", table_name="ligne_import_brute")
    op.drop_table("ligne_import_brute")

    with op.batch_alter_table("import_historique", schema=None) as batch_op:
        batch_op.drop_column("doublons_detectes")

    with op.batch_alter_table("import_configuration", schema=None) as batch_op:
        batch_op.drop_column("colonnes_exclues_comparaison")
