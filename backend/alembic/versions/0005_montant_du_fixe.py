"""ajoute montant_du : montant fixe initialement dû, distinct du reste à
rembourser (montant_a_rembourser) qui diminue au fil des remboursements liés

Revision ID: 0005
Revises: 0004
Create Date: 2026-07-11
"""
from alembic import op
import sqlalchemy as sa

revision = "0005"
down_revision = "0004"
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table("operation", schema=None) as batch_op:
        batch_op.add_column(
            sa.Column("montant_du", sa.Float, nullable=False, server_default="0")
        )
    # Backfill : pour les dépenses remboursables existantes, le montant initialement
    # dû est supposé être le montant total de la dépense (on n'a pas d'historique
    # d'un montant cible différent).
    op.execute(
        "UPDATE operation SET montant_du = montant WHERE remboursable = 1"
    )


def downgrade():
    with op.batch_alter_table("operation", schema=None) as batch_op:
        batch_op.drop_column("montant_du")
