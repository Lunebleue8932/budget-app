"""renomme 'Vie associative & sorties' en 'Loisirs & sorties' et ajoute 'Charges fixes'

Revision ID: 0003
Revises: 0002
Create Date: 2026-07-11
"""
from alembic import op

revision = "0003"
down_revision = "0002"
branch_labels = None
depends_on = None

OLD_CATEGORIES_CHECK = (
    "categorie IN ('Alimentaire', 'Vie associative & sorties', "
    "'Réparation & entretien', 'Vêtements & équipement sport', "
    "'Autres', \"Entrées d'argent\", 'Virement interne')"
)

NEW_CATEGORIES_CHECK = (
    "categorie IN ('Alimentaire', 'Loisirs & sorties', 'Charges fixes', "
    "'Réparation & entretien', 'Vêtements & équipement sport', "
    "'Autres', \"Entrées d'argent\", 'Virement interne')"
)


def upgrade():
    op.execute(
        "UPDATE operation SET categorie = 'Loisirs & sorties' "
        "WHERE categorie = 'Vie associative & sorties'"
    )
    with op.batch_alter_table("operation", schema=None) as batch_op:
        batch_op.drop_constraint("ck_operation_categorie", type_="check")
        batch_op.create_check_constraint("ck_operation_categorie", NEW_CATEGORIES_CHECK)


def downgrade():
    op.execute(
        "UPDATE operation SET categorie = 'Vie associative & sorties' "
        "WHERE categorie = 'Loisirs & sorties'"
    )
    with op.batch_alter_table("operation", schema=None) as batch_op:
        batch_op.drop_constraint("ck_operation_categorie", type_="check")
        batch_op.create_check_constraint("ck_operation_categorie", OLD_CATEGORIES_CHECK)
