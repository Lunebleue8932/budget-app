"""ajoute les catégories système 'Prêts' (entrée) et 'Remboursement prêts'
(sortie), miroir de dépenses remboursables / Remboursements avec les sens
inversés

Revision ID: 0008
Revises: 0007
Create Date: 2026-07-12
"""
from alembic import op
import sqlalchemy as sa

revision = "0008"
down_revision = "0007"
branch_labels = None
depends_on = None

NOUVELLES_CATEGORIES = ["Prêts", "Remboursement prêts"]


def upgrade():
    conn = op.get_bind()
    ordre_max = conn.execute(sa.text("SELECT COALESCE(MAX(ordre), 0) FROM categorie")).scalar()

    categorie_table = sa.table(
        "categorie",
        sa.column("nom", sa.String),
        sa.column("systeme", sa.Boolean),
        sa.column("budget_alloue", sa.Float),
        sa.column("ordre", sa.Integer),
    )
    op.bulk_insert(
        categorie_table,
        [
            {"nom": nom, "systeme": True, "budget_alloue": 0.0, "ordre": ordre_max + position + 1}
            for position, nom in enumerate(NOUVELLES_CATEGORIES)
        ],
    )


def downgrade():
    conn = op.get_bind()
    conn.execute(
        sa.text("DELETE FROM categorie WHERE nom IN :noms").bindparams(
            sa.bindparam("noms", expanding=True)
        ),
        {"noms": NOUVELLES_CATEGORIES},
    )
