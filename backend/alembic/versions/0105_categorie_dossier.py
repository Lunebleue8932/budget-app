"""Une catégorie parent traitée comme un DOSSIER de catégories.

CE QUE C'EST. Une catégorie parent qui n'a aucune opération affectée peut être marquée « dossier » : elle ne sert
plus qu'à REGROUPER ses sous-catégories (et peut encore porter un budget). Elle n'est alors plus proposée dans les
menus de saisie ni, à l'import, dans les correspondances, les règles et les suggestions.

CE QUE FAIT LA MIGRATION. Elle ajoute `categorie.est_dossier`, faux partout : aucune catégorie n'est touchée.

Revision ID: 0105
Revises: 0104
Create Date: 2026-11-16
"""
from alembic import op
import sqlalchemy as sa

revision = "0105"
down_revision = "0104"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("categorie") as lot:
        lot.add_column(
            sa.Column("est_dossier", sa.Boolean(), nullable=False, server_default=sa.false())
        )


def downgrade() -> None:
    with op.batch_alter_table("categorie") as lot:
        lot.drop_column("est_dossier")
