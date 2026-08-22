"""le vocabulaire de la colonne « Sens » devient propre à chaque preset.

Jusqu'ici la liste des libellés reconnus (« Débit », « D », « Crédit »…) était
figée dans le code, en français. Un relevé anglophone écrivant « DEBIT » /
« CREDIT » passait de justesse (la comparaison ignore la casse et les accents),
mais « OUT » / « IN », « Saída » / « Entrada » ou « Payment » / « Receipt »
mettaient toutes les lignes en erreur, sans autre recours que de renoncer à la
colonne — et donc au sens.

Deux listes par preset, vides par défaut : un preset qui n'y touche pas retombe
sur constants.LIBELLES_SENS_SORTIE / _ENTREE, exactement comme avant. C'est un
trait du FORMAT du relevé, au même titre que les colonnes, d'où le stockage sur
le preset plutôt qu'un réglage global.

Revision ID: 0027
Revises: 0026
Create Date: 2026-08-07
"""
from alembic import op
import sqlalchemy as sa

revision = "0027"
down_revision = "0026"
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table("import_preset", schema=None) as batch_op:
        batch_op.add_column(
            sa.Column("libelles_sens_sortie", sa.JSON, nullable=False, server_default="[]")
        )
        batch_op.add_column(
            sa.Column("libelles_sens_entree", sa.JSON, nullable=False, server_default="[]")
        )


def downgrade():
    # Les presets retombent sur le vocabulaire figé du code : c'est exactement
    # le comportement d'avant, aucune ligne déjà importée n'est concernée.
    with op.batch_alter_table("import_preset", schema=None) as batch_op:
        batch_op.drop_column("libelles_sens_entree")
        batch_op.drop_column("libelles_sens_sortie")
