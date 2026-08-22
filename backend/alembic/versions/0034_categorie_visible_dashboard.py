"""Visibilité d'une catégorie sur le dashboard.

Une catégorie peut exister — porter des opérations, un budget, un ordre — sans
avoir sa place dans l'histogramme du dashboard. Typiquement une catégorie
fourre-tout, ou une dépense dont on suit le total ailleurs : la garder dans le
graphe écrase l'échelle des autres barres et n'apprend rien.

Le drapeau ne cache QUE le dashboard. Les opérations restent classées, les
budgets restent définis, la catégorie reste proposée à la saisie et à l'import :
c'est un réglage d'affichage, jamais une désactivation.

`server_default="1"` : tout l'existant reste visible, l'écran ne change pas
tant que l'utilisateur n'a rien éteint.

Revision ID: 0034
Revises: 0033
Create Date: 2026-08-11
"""
from alembic import op
import sqlalchemy as sa

revision = "0034"
down_revision = "0033"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "categorie",
        sa.Column(
            "visible_dashboard",
            sa.Boolean(),
            nullable=False,
            server_default="1",
        ),
    )


def downgrade():
    op.drop_column("categorie", "visible_dashboard")
