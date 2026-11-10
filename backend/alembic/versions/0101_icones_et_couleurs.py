"""Une icône pour les catégories et les comptes, une couleur pour les comptes.

CE QUE C'EST. Les catégories ont déjà leur couleur (`categorie.couleur_index`, celle de l'histogramme) ;
elles gagnent une ICÔNE, un emoji choisi à la main. Les comptes gagnent les deux : une icône et une
couleur (un index dans la même palette que les catégories, cf. frontend `PALETTE_CATEGORIES`).

CE QUE FAIT LA MIGRATION. Elle ajoute trois colonnes NULLABLES : `categorie.icone`, `compte.icone`,
`compte.couleur_index`. NULL partout d'origine : rien ne change à l'écran tant qu'on n'a rien choisi.

Revision ID: 0101
Revises: 0100
Create Date: 2026-11-10
"""
from alembic import op
import sqlalchemy as sa

revision = "0101"
down_revision = "0100"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("categorie") as lot:
        lot.add_column(sa.Column("icone", sa.String(), nullable=True))
    with op.batch_alter_table("compte") as lot:
        lot.add_column(sa.Column("icone", sa.String(), nullable=True))
        lot.add_column(sa.Column("couleur_index", sa.Integer(), nullable=True))


def downgrade() -> None:
    with op.batch_alter_table("compte") as lot:
        lot.drop_column("couleur_index")
        lot.drop_column("icone")
    with op.batch_alter_table("categorie") as lot:
        lot.drop_column("icone")
