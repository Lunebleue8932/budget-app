"""Les sous-catégories : une catégorie rangée sous une autre.

CE QUE C'EST. Une relation parent → enfant, et rien de plus : un parent a plusieurs enfants et pas de parent ;
un enfant n'a qu'un parent et pas d'enfants (un seul niveau, garanti par le serveur). Un enfant hérite de la
couleur (une NUANCE de celle du parent) et de l'emoji de son parent.

CE QUE FAIT LA MIGRATION. Elle ajoute `categorie.parent_id` (NULL d'origine : aucune catégorie n'est touchée ;
supprimer le parent libère ses enfants, SET NULL) et `categorie.couleur_nuance` (NULL : la première nuance libre).

Revision ID: 0103
Revises: 0102
Create Date: 2026-11-15
"""
from alembic import op
import sqlalchemy as sa

revision = "0103"
down_revision = "0102"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("categorie") as lot:
        lot.add_column(sa.Column("parent_id", sa.Integer(), nullable=True))
        lot.add_column(sa.Column("couleur_nuance", sa.Integer(), nullable=True))
        lot.create_foreign_key(
            "fk_categorie_parent", "categorie", ["parent_id"], ["id"], ondelete="SET NULL"
        )
        lot.create_index("ix_categorie_parent", ["parent_id"])


def downgrade() -> None:
    with op.batch_alter_table("categorie") as lot:
        lot.drop_index("ix_categorie_parent")
        lot.drop_constraint("fk_categorie_parent", type_="foreignkey")
        lot.drop_column("couleur_nuance")
        lot.drop_column("parent_id")
