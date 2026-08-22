"""schema initial : compte, operation

Revision ID: 0001
Revises:
Create Date: 2026-07-11
"""
from alembic import op
import sqlalchemy as sa

revision = "0001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "compte",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column("nom", sa.String, nullable=False, unique=True),
        sa.Column("type", sa.String, nullable=False),
        sa.Column("solde_initial", sa.Float, nullable=False, server_default="0"),
        sa.CheckConstraint("type IN ('courant', 'épargne')", name="ck_compte_type"),
    )

    op.create_table(
        "operation",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column("date", sa.Date, nullable=False),
        sa.Column("compte_id", sa.Integer, sa.ForeignKey("compte.id"), nullable=False),
        sa.Column("categorie", sa.String, nullable=False),
        sa.Column("nature", sa.String, nullable=False),
        sa.Column("montant", sa.Float, nullable=False),
        sa.Column("sens", sa.String, nullable=False),
        sa.Column("statut", sa.String, nullable=False),
        sa.Column("remboursable", sa.Boolean, nullable=False, server_default=sa.false()),
        sa.Column("montant_rembourse", sa.Float, nullable=False, server_default="0"),
        sa.Column("virement_id", sa.String, nullable=True),
        sa.CheckConstraint("montant >= 0", name="ck_operation_montant_positif"),
        sa.CheckConstraint(
            "sens IN ('dépense', 'entrée', 'transfert_sortant', 'transfert_entrant')",
            name="ck_operation_sens",
        ),
        sa.CheckConstraint(
            "statut IN ('réel', 'prévisionnel')", name="ck_operation_statut"
        ),
        sa.CheckConstraint(
            "categorie IN ('Alimentaire', 'Vie associative & sorties', "
            "'Réparation & entretien', 'Vêtements & équipement sport', "
            "'Autres', \"Entrées d'argent\")",
            name="ck_operation_categorie",
        ),
    )

    op.create_index("ix_operation_categorie", "operation", ["categorie"])
    op.create_index("ix_operation_compte_id", "operation", ["compte_id"])
    op.create_index("ix_operation_date", "operation", ["date"])
    op.create_index("ix_operation_virement_id", "operation", ["virement_id"])


def downgrade():
    op.drop_index("ix_operation_virement_id", table_name="operation")
    op.drop_index("ix_operation_date", table_name="operation")
    op.drop_index("ix_operation_compte_id", table_name="operation")
    op.drop_index("ix_operation_categorie", table_name="operation")
    op.drop_table("operation")
    op.drop_table("compte")
