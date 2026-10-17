"""Chaque preset bancaire retient la SIGNATURE du fichier qu'il lit.

POURQUOI. Pour reconnaître, à l'ouverture d'un fichier, le preset qui lui
correspond (services/reconnaissance_presets), il faut savoir à quoi ressemblent
les fichiers de chaque preset. Jusqu'ici un preset ne connaissait que le NOMBRE
de ses lignes de tête, rien de leur contenu.

CE QUI EST AJOUTÉ, tout NULL au départ :
  - `signature_entetes` : les intitulés de la ligne d'en-tête, normalisés
    (services/entetes.normaliser_entete), colonne par colonne ;
  - `nombre_colonnes` : la largeur du fichier ;
  - `motif_nom_fichier` : la forme du nom de fichier, dates et heures
    remplacées par des jetons (« releve_<DATE>.csv »).

LES PRESETS EXISTANTS NE SONT PAS COMPLÉTÉS ICI : la migration n'a aucun
fichier sous la main. Ils le sont à leur prochaine réutilisation (import
confirmé, configuration enregistrée), et un preset sans signature n'est jamais
écarté pour autant — il est jugé sur la lecture du fichier seule.

Revision ID: 0086
Revises: 0085
Create Date: 2026-10-16
"""
import sqlalchemy as sa
from alembic import op

revision = "0086"
down_revision = "0085"
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table("import_preset") as batch:
        batch.add_column(sa.Column("signature_entetes", sa.JSON(), nullable=True))
        batch.add_column(sa.Column("nombre_colonnes", sa.Integer(), nullable=True))
        batch.add_column(sa.Column("motif_nom_fichier", sa.String(), nullable=True))


def downgrade():
    with op.batch_alter_table("import_preset") as batch:
        batch.drop_column("motif_nom_fichier")
        batch.drop_column("nombre_colonnes")
        batch.drop_column("signature_entetes")
