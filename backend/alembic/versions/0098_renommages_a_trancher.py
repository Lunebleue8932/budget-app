"""Les renommages « à trancher » : un libellé qui ressemble à un libellé déjà renommé.

CE QUE C'EST. L'import ne propose jamais un renommage sur une ressemblance. Il note le libellé vu et
l'entrée dont il se rapproche ; la page des renommages les liste, et c'est là qu'on accepte (l'entrée
du nouveau libellé est créée) ou refuse (le libellé ne sera plus reposé).

CE QUE FAIT LA MIGRATION. Elle crée la table `renommage_a_trancher`, vide.

Revision ID: 0098
Revises: 0097
Create Date: 2026-10-28
"""
from alembic import op
import sqlalchemy as sa

revision = "0098"
down_revision = "0097"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "renommage_a_trancher",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("cle", sa.String(), nullable=False, unique=True),
        sa.Column("libelle", sa.String(), nullable=False),
        sa.Column(
            "entree_id",
            sa.Integer(),
            sa.ForeignKey("renommage.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("score", sa.Float(), nullable=False, server_default="0"),
        sa.Column("outil", sa.String(), nullable=False, server_default=""),
        sa.Column("refuse", sa.Boolean(), nullable=False, server_default=sa.false()),
        sa.Column("vu_le", sa.DateTime(), nullable=True),
    )


def downgrade() -> None:
    op.drop_table("renommage_a_trancher")
