"""Éteindre un COMPTE ou une CATÉGORIE, comme on éteint déjà une monnaie.

CE QUI MANQUAIT, ET CE QUE LES GENS FAISAIENT À LA PLACE. Un compte qu'on
ferme, une catégorie dont on ne se sert plus : les deux restent dans tous les
menus, pour toujours. Supprimer emporterait l'historique — un compte refuse de
partir dès qu'il porte une opération, une catégorie supprimée renvoie les
siennes dans « Autres » — si bien que la seule issue était de vivre avec un menu
qui s'allonge, et de se tromper de ligne de temps en temps.

L'EXTINCTION NE SUPPRIME RIEN. Les opérations déjà écrites restent en base,
comptent dans les soldes, dans les KPI et dans les barres de l'histogramme
exactement comme avant : ce qui change est qu'aucune NOUVELLE écriture n'y sera
plus proposée ni acceptée. C'est le même geste, et le même mot, que
`CompteMonnaie.active` (migration 0053) — rallumer est d'un clic.

DEUX COLONNES, ET DEUX NOMS QUI SUIVENT LE GENRE : `compte.actif`,
`categorie.active`. Non nullables, vraies par défaut : tout ce qui existe est
allumé, et il n'y a pas de troisième état à tester quelque part.

Revision ID: 0063
Revises: 0062
Create Date: 2026-09-17
"""
from alembic import op
import sqlalchemy as sa

revision = "0063"
down_revision = "0062"
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table("compte", schema=None) as batch_op:
        batch_op.add_column(
            sa.Column("actif", sa.Boolean(), nullable=False, server_default=sa.true())
        )
    with op.batch_alter_table("categorie", schema=None) as batch_op:
        batch_op.add_column(
            sa.Column("active", sa.Boolean(), nullable=False, server_default=sa.true())
        )


def downgrade():
    with op.batch_alter_table("categorie", schema=None) as batch_op:
        batch_op.drop_column("active")
    with op.batch_alter_table("compte", schema=None) as batch_op:
        batch_op.drop_column("actif")
