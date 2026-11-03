"""Les renommages (extension « Renommages ») : un libellé de relevé, et le nom qu'on lui donne.

CE QUE C'EST. Renommer une opération (« CB CARREFOUR 0412 » -> « Courses ») ne servait qu'à elle :
le prochain relevé apportait de nouveau le libellé d'origine. Avec l'extension, chaque renommage
laisse une entrée ici, et l'import remplace d'office le libellé des lignes qui correspondent
exactement (aux accents, à la casse et aux espaces près) à un libellé déjà renommé.

CE QUE FAIT LA MIGRATION. Elle crée la table `renommage`, vide : rien n'est déduit des opérations
existantes (on ne sait pas quel libellé elles portaient avant d'être renommées).

Revision ID: 0096
Revises: 0095
Create Date: 2026-10-28
"""
from alembic import op
import sqlalchemy as sa

revision = "0096"
down_revision = "0095"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "renommage",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("cle", sa.String(), nullable=False, unique=True),
        sa.Column("nom_origine", sa.String(), nullable=False),
        sa.Column("nom_nouveau", sa.String(), nullable=False),
        sa.Column("origine", sa.String(), nullable=False, server_default="manuel"),
        sa.Column("cree_le", sa.DateTime(), nullable=True),
    )


def downgrade() -> None:
    op.drop_table("renommage")
