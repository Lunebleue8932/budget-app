"""Les renommages « à valider » : ceux qu'on n'a pas écrits soi-même ne sont pas encore permanents.

CE QUE C'EST. Une opération renommée, une ligne retouchée dans le récapitulatif d'un import : l'app
note un renommage, mais le nom donné sur le moment n'est pas forcément celui qu'on veut pour tous les
imports à venir. Ces renommages attendent dans une pile, sur la page des renommages, qu'on les valide
(ils deviennent permanents : l'import les applique) ou qu'on les supprime.

CE QUE FAIT LA MIGRATION. Elle ajoute `renommage.valide`. Les entrées déjà là sont VALIDÉES : elles
servent déjà aux imports, et la migration ne change rien à ce que l'import fait.

Revision ID: 0099
Revises: 0098
Create Date: 2026-11-04
"""
from alembic import op
import sqlalchemy as sa

revision = "0099"
down_revision = "0098"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "renommage",
        sa.Column("valide", sa.Boolean(), nullable=False, server_default=sa.true()),
    )


def downgrade() -> None:
    with op.batch_alter_table("renommage") as lot:
        lot.drop_column("valide")
