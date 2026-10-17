"""Un projet peut s'afficher au dashboard, comme un objectif.

CE QUI EXISTAIT. `objectif_kpi.visible_dashboard` : un objectif coché se pose sous les
graphes du dashboard. Un projet n'avait pas d'équivalent - pour voir où en était un voyage
(dépenses contre plafond, jours restants), il fallait ouvrir la page Budget.

CE QUI EST AJOUTÉ. `sous_filtre.visible_dashboard`, faux pour tous les projets existants :
rien n'apparaît au dashboard tant qu'on ne l'a pas demandé. C'est un réglage de lecture, que
rien ne calcule (cf. models.SousFiltre).

Revision ID: 0088
Revises: 0087
Create Date: 2026-10-17
"""
from alembic import op
import sqlalchemy as sa

revision = "0088"
down_revision = "0087"
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table("sous_filtre", schema=None) as batch_op:
        batch_op.add_column(
            sa.Column("visible_dashboard", sa.Boolean(), nullable=False, server_default=sa.false())
        )


def downgrade():
    with op.batch_alter_table("sous_filtre", schema=None) as batch_op:
        batch_op.drop_column("visible_dashboard")
