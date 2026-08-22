"""ajoute la récurrence aux opérations : recurrente (True pour le modèle ET
chacune de ses occurrences générées), frequence (hebdomadaire/mensuelle/
trimestrielle/annuelle, modèle seulement), recurrence_fin (date, modèle
seulement -- None = infinie), recurrence_parent_id (id du modèle dont une
occurrence a été générée -- voir crud.generer_occurrences_recurrentes)

Revision ID: 0015
Revises: 0014
Create Date: 2026-07-24
"""
from alembic import op
import sqlalchemy as sa

revision = "0015"
down_revision = "0014"
branch_labels = None
depends_on = None

FREQUENCES = ["hebdomadaire", "mensuelle", "trimestrielle", "annuelle"]


def _sql_in_list(values):
    return ", ".join(f"'{v}'" for v in values)


def upgrade():
    with op.batch_alter_table("operation", schema=None) as batch_op:
        batch_op.add_column(
            sa.Column("recurrente", sa.Boolean, nullable=False, server_default=sa.false())
        )
        batch_op.add_column(sa.Column("frequence", sa.String, nullable=True))
        batch_op.add_column(sa.Column("recurrence_fin", sa.Date, nullable=True))
        batch_op.add_column(sa.Column("recurrence_parent_id", sa.Integer, nullable=True))
        batch_op.create_foreign_key(
            "fk_operation_recurrence_parent", "operation", ["recurrence_parent_id"], ["id"], ondelete="SET NULL"
        )
        batch_op.create_index("ix_operation_recurrence_parent_id", ["recurrence_parent_id"])
        batch_op.create_check_constraint(
            "ck_operation_frequence", f"frequence IS NULL OR frequence IN ({_sql_in_list(FREQUENCES)})"
        )


def downgrade():
    with op.batch_alter_table("operation", schema=None) as batch_op:
        batch_op.drop_constraint("ck_operation_frequence", type_="check")
        batch_op.drop_index("ix_operation_recurrence_parent_id")
        batch_op.drop_constraint("fk_operation_recurrence_parent", type_="foreignkey")
        batch_op.drop_column("recurrence_parent_id")
        batch_op.drop_column("recurrence_fin")
        batch_op.drop_column("frequence")
        batch_op.drop_column("recurrente")
