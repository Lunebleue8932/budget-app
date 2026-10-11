"""Le LEVIER d'un titre : 1 pour presque tous, 2 ou 3 pour un ETF à effet de levier.

POURQUOI. Un ETF « x2 » acheté 1 000 € expose à 2 000 € de marché. La vue d'ensemble des
placements peut ainsi lire le portefeuille de deux façons : le CAPITAL investi (ce qu'on a
mis, ce qu'on peut perdre au plus) ou l'EXPOSITION AU MARCHÉ (capital × levier, ce qui bouge
avec l'indice). Aucun solde, aucune valorisation ne le lit : c'est une façon de regarder.

NON NULL, DÉFAUT 1 : tout titre existant garde exactement son exposition d'avant. Strictement
positif (cf. schemas) — un ETF « short » (levier négatif) n'est pas pris en charge.

Revision ID: 0082
Revises: 0081
Create Date: 2026-10-11
"""
import sqlalchemy as sa
from alembic import op

revision = "0082"
down_revision = "0081"
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table("titre_possede") as batch_op:
        batch_op.add_column(
            sa.Column("levier", sa.Float(), nullable=False, server_default="1")
        )


def downgrade():
    with op.batch_alter_table("titre_possede") as batch_op:
        batch_op.drop_column("levier")
