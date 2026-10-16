"""Un preset dit aussi combien de lignes, AU BAS du relevé, ne sont pas des
opérations.

CE QUI EXISTAIT. `import_preset.lignes_entete` saute les lignes du haut —
titulaire, numéro de compte, intitulés. Rien pour celles du bas : beaucoup de
banques terminent leur export par un total, un solde final, une mention légale.
L'import les lisait comme des opérations sans date ni montant, en erreur dans
l'aperçu, à supprimer une par une à chaque import du même format.

CE QUI EST AJOUTÉ. `lignes_pied`, compté en lignes NON VIDES depuis le bas
(cf. services/import_bancaire.lire_lignes_brutes). Zéro pour tous les presets
existants : ils lisent exactement ce qu'ils lisaient.

Revision ID: 0086
Revises: 0085
Create Date: 2026-10-17
"""
from alembic import op
import sqlalchemy as sa

revision = "0086"
down_revision = "0085"
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table("import_preset", schema=None) as batch_op:
        batch_op.add_column(
            sa.Column("lignes_pied", sa.Integer(), nullable=False, server_default="0")
        )


def downgrade():
    with op.batch_alter_table("import_preset", schema=None) as batch_op:
        batch_op.drop_column("lignes_pied")
