"""ajoute 'Virement interne' à la liste fermée des catégories

Revision ID: 0002
Revises: 0001
Create Date: 2026-07-11
"""
from alembic import op
import sqlalchemy as sa

revision = "0002"
down_revision = "0001"
branch_labels = None
depends_on = None

OLD_CATEGORIES_CHECK = (
    "categorie IN ('Alimentaire', 'Vie associative & sorties', "
    "'Réparation & entretien', 'Vêtements & équipement sport', "
    "'Autres', \"Entrées d'argent\")"
)

NEW_CATEGORIES_CHECK = (
    "categorie IN ('Alimentaire', 'Vie associative & sorties', "
    "'Réparation & entretien', 'Vêtements & équipement sport', "
    "'Autres', \"Entrées d'argent\", 'Virement interne')"
)


def upgrade():
    with op.batch_alter_table("operation", schema=None) as batch_op:
        batch_op.drop_constraint("ck_operation_categorie", type_="check")
        batch_op.create_check_constraint("ck_operation_categorie", NEW_CATEGORIES_CHECK)


def downgrade():
    with op.batch_alter_table("operation", schema=None) as batch_op:
        batch_op.drop_constraint("ck_operation_categorie", type_="check")
        batch_op.create_check_constraint("ck_operation_categorie", OLD_CATEGORIES_CHECK)
