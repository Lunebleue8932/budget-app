"""ajoute categorie.budget_alloue, categorie.ordre, et remboursement_lien.montant
(passage du remboursement tout-ou-rien au remboursement partiel par ligne)

Revision ID: 0007
Revises: 0006
Create Date: 2026-07-18
"""
from alembic import op
import sqlalchemy as sa

revision = "0007"
down_revision = "0006"
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table("categorie", schema=None) as batch_op:
        batch_op.add_column(
            sa.Column("budget_alloue", sa.Float, nullable=False, server_default="0")
        )
        batch_op.add_column(
            sa.Column("ordre", sa.Integer, nullable=False, server_default="0")
        )

    # Ordre initial = ordre alphabétique actuel, pour ne pas perturber
    # visuellement l'utilisateur au moment de la migration.
    conn = op.get_bind()
    rows = conn.execute(sa.text("SELECT id FROM categorie ORDER BY nom")).fetchall()
    for position, (categorie_id,) in enumerate(rows):
        conn.execute(
            sa.text("UPDATE categorie SET ordre = :ordre WHERE id = :id"),
            {"ordre": position, "id": categorie_id},
        )

    with op.batch_alter_table("remboursement_lien", schema=None) as batch_op:
        batch_op.add_column(
            sa.Column("montant", sa.Float, nullable=False, server_default="0")
        )

    # Rétro-compatibilité : les liens existants (créés sous l'ancien modèle
    # tout-ou-rien) sont supposés avoir couvert tout le montant dû.
    op.execute(
        "UPDATE remboursement_lien SET montant = "
        "(SELECT montant_du FROM operation WHERE operation.id = remboursement_lien.operation_depense_id)"
    )


def downgrade():
    with op.batch_alter_table("remboursement_lien", schema=None) as batch_op:
        batch_op.drop_column("montant")

    with op.batch_alter_table("categorie", schema=None) as batch_op:
        batch_op.drop_column("ordre")
        batch_op.drop_column("budget_alloue")
