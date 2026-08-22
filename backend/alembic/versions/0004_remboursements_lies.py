"""inverse montant_rembourse en montant_a_rembourser, ajoute la catégorie
'Remboursements' et la table de liaison remboursement <-> dépense

Revision ID: 0004
Revises: 0003
Create Date: 2026-07-11
"""
from alembic import op
import sqlalchemy as sa

revision = "0004"
down_revision = "0003"
branch_labels = None
depends_on = None

OLD_CATEGORIES_CHECK = (
    "categorie IN ('Alimentaire', 'Loisirs & sorties', 'Charges fixes', "
    "'Réparation & entretien', 'Vêtements & équipement sport', "
    "'Autres', \"Entrées d'argent\", 'Virement interne')"
)

NEW_CATEGORIES_CHECK = (
    "categorie IN ('Alimentaire', 'Loisirs & sorties', 'Charges fixes', "
    "'Réparation & entretien', 'Vêtements & équipement sport', "
    "'Autres', \"Entrées d'argent\", 'Remboursements', 'Virement interne')"
)


def upgrade():
    # Inverse le sens de la donnée AVANT de renommer la colonne :
    # montant_rembourse (déjà payé) -> montant_a_rembourser (reste dû)
    op.execute("UPDATE operation SET montant_rembourse = montant - montant_rembourse")

    with op.batch_alter_table("operation", schema=None) as batch_op:
        batch_op.alter_column("montant_rembourse", new_column_name="montant_a_rembourser")
        batch_op.drop_constraint("ck_operation_categorie", type_="check")
        batch_op.create_check_constraint("ck_operation_categorie", NEW_CATEGORIES_CHECK)

    op.create_table(
        "remboursement_lien",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column(
            "operation_remboursement_id",
            sa.Integer,
            sa.ForeignKey("operation.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "operation_depense_id",
            sa.Integer,
            sa.ForeignKey("operation.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.UniqueConstraint(
            "operation_remboursement_id", "operation_depense_id",
            name="uq_remboursement_lien",
        ),
    )
    op.create_index(
        "ix_remboursement_lien_remboursement",
        "remboursement_lien",
        ["operation_remboursement_id"],
    )
    op.create_index(
        "ix_remboursement_lien_depense", "remboursement_lien", ["operation_depense_id"]
    )


def downgrade():
    op.drop_index("ix_remboursement_lien_depense", table_name="remboursement_lien")
    op.drop_index("ix_remboursement_lien_remboursement", table_name="remboursement_lien")
    op.drop_table("remboursement_lien")

    with op.batch_alter_table("operation", schema=None) as batch_op:
        batch_op.drop_constraint("ck_operation_categorie", type_="check")
        batch_op.create_check_constraint("ck_operation_categorie", OLD_CATEGORIES_CHECK)
        batch_op.alter_column("montant_a_rembourser", new_column_name="montant_rembourse")

    op.execute("UPDATE operation SET montant_rembourse = montant - montant_rembourse")
