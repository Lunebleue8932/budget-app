"""Chaque catégorie peut porter ses propres mots-clés (classement intelligent de l'import).

L'import propose la catégorie de l'app qui correspond à celle du relevé (cf.
services/categorisation_intelligente) en comparant le libellé de la banque au nom de chaque
catégorie et à une liste de mots-clés. NULL = pas de liste à soi : les mots-clés livrés servent
(français, anglais, portugais du Brésil). Une liste, même vide, remplace les livrés en entier.

Rien n'est semé : une base existante garde NULL partout, donc les listes livrées.

Revision ID: 0085
Revises: 0084
Create Date: 2026-10-16
"""
from alembic import op
import sqlalchemy as sa

revision = "0085"
down_revision = "0084"
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table("categorie") as batch:
        batch.add_column(sa.Column("mots_cles_perso", sa.JSON(), nullable=True))


def downgrade():
    with op.batch_alter_table("categorie") as batch:
        batch.drop_column("mots_cles_perso")
