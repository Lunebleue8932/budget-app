"""« Les frais sont déjà compris dans les montants du relevé » (réglage d'un format d'import).

CE QUI ARRIVAIT. L'import ajoute les frais à ce qui sort et les retranche de ce qui entre : c'est juste
quand le relevé donne le montant AVANT frais. Certaines banques écrivent déjà le total réellement débité,
frais compris — l'import les comptait alors une seconde fois, et le solde de l'app s'écartait de celui de
la banque (et ne s'accordait de nouveau qu'une fois les frais supprimés à la main).

CE QUE FAIT LA MIGRATION. Elle ajoute `import_preset.frais_inclus`, faux partout : aucun format existant ne
change de comportement. Coché, un format garde les frais à titre descriptif (`operation.frais`) mais ne
les ajoute plus.

Revision ID: 0097
Revises: 0096
Create Date: 2026-10-28
"""
from alembic import op
import sqlalchemy as sa

revision = "0097"
down_revision = "0096"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("import_preset") as batch:
        batch.add_column(
            sa.Column("frais_inclus", sa.Boolean(), nullable=False, server_default=sa.false())
        )


def downgrade() -> None:
    with op.batch_alter_table("import_preset") as batch:
        batch.drop_column("frais_inclus")
