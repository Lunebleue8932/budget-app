"""Une note libre sur une catégorie.

CE QUE C'EST. Comme une opération, une catégorie peut porter une note : pourquoi elle existe, ce qu'on y range et ce
qu'on n'y range pas. L'application ne la lit jamais.

CE QUE FAIT LA MIGRATION. Elle ajoute `categorie.notes`, NULLABLE : aucune catégorie n'est touchée.

Revision ID: 0104
Revises: 0103
Create Date: 2026-11-15
"""
from alembic import op
import sqlalchemy as sa

revision = "0104"
down_revision = "0103"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("categorie") as lot:
        lot.add_column(sa.Column("notes", sa.String(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("categorie") as lot:
        lot.drop_column("notes")
