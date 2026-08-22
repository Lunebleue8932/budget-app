"""transforme la colonne operation.categorie (texte) en categorie_id (FK vers
une nouvelle table categorie), pour permettre la gestion des catégories
(création/suppression) depuis l'application plutôt qu'une liste fermée figée

Revision ID: 0006
Revises: 0005
Create Date: 2026-07-11
"""
from alembic import op
import sqlalchemy as sa

revision = "0006"
down_revision = "0005"
branch_labels = None
depends_on = None

CATEGORIES_INITIALES = [
    ("Alimentaire", False),
    ("Loisirs & sorties", False),
    ("Charges fixes", False),
    ("Réparation & entretien", False),
    ("Vêtements & équipement sport", False),
    ("Autres", False),
    ("Entrées d'argent", False),
    ("Remboursements", True),
    ("Virement interne", True),
]


def upgrade():
    op.create_table(
        "categorie",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column("nom", sa.String, nullable=False, unique=True),
        sa.Column("systeme", sa.Boolean, nullable=False, server_default=sa.false()),
    )

    categorie_table = sa.table(
        "categorie",
        sa.column("nom", sa.String),
        sa.column("systeme", sa.Boolean),
    )
    op.bulk_insert(
        categorie_table,
        [{"nom": nom, "systeme": systeme} for nom, systeme in CATEGORIES_INITIALES],
    )

    with op.batch_alter_table("operation", schema=None) as batch_op:
        batch_op.add_column(sa.Column("categorie_id", sa.Integer, nullable=True))

    op.execute(
        "UPDATE operation SET categorie_id = "
        "(SELECT id FROM categorie WHERE categorie.nom = operation.categorie)"
    )

    with op.batch_alter_table("operation", schema=None) as batch_op:
        batch_op.alter_column("categorie_id", existing_type=sa.Integer, nullable=False)
        batch_op.drop_constraint("ck_operation_categorie", type_="check")
        batch_op.drop_index("ix_operation_categorie")
        batch_op.drop_column("categorie")
        batch_op.create_foreign_key(
            "fk_operation_categorie_id", "categorie", ["categorie_id"], ["id"]
        )
        batch_op.create_index("ix_operation_categorie_id", ["categorie_id"])


def downgrade():
    with op.batch_alter_table("operation", schema=None) as batch_op:
        batch_op.add_column(sa.Column("categorie", sa.String, nullable=True))

    op.execute(
        "UPDATE operation SET categorie = "
        "(SELECT nom FROM categorie WHERE categorie.id = operation.categorie_id)"
    )

    with op.batch_alter_table("operation", schema=None) as batch_op:
        batch_op.alter_column("categorie", existing_type=sa.String, nullable=False)
        batch_op.drop_index("ix_operation_categorie_id")
        batch_op.drop_constraint("fk_operation_categorie_id", type_="foreignkey")
        batch_op.drop_column("categorie_id")
        batch_op.create_index("ix_operation_categorie", ["categorie"])

    op.drop_table("categorie")
