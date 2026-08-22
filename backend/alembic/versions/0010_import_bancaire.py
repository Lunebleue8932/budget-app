"""ajoute operation.verifie (opérations importées à relire) et les tables de
correspondance import_categorie_mapping / import_compte_mapping (mémorisent
la reclassification catégorie/compte bancaire -> app d'un import à l'autre)

Revision ID: 0010
Revises: 0009
Create Date: 2026-07-20
"""
from alembic import op
import sqlalchemy as sa

revision = "0010"
down_revision = "0009"
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table("operation", schema=None) as batch_op:
        batch_op.add_column(
            sa.Column("verifie", sa.Boolean, nullable=False, server_default=sa.true())
        )

    op.create_table(
        "import_categorie_mapping",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column("nom_banque", sa.String, nullable=False, unique=True),
        sa.Column(
            "categorie_id",
            sa.Integer,
            sa.ForeignKey("categorie.id", ondelete="CASCADE"),
            nullable=False,
        ),
    )

    op.create_table(
        "import_compte_mapping",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column("nom_banque", sa.String, nullable=False, unique=True),
        sa.Column(
            "compte_id",
            sa.Integer,
            sa.ForeignKey("compte.id", ondelete="CASCADE"),
            nullable=False,
        ),
    )


def downgrade():
    op.drop_table("import_compte_mapping")
    op.drop_table("import_categorie_mapping")

    with op.batch_alter_table("operation", schema=None) as batch_op:
        batch_op.drop_column("verifie")
