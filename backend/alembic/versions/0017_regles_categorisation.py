"""ajoute les règles de catégorisation automatique des lignes importées
(regle_categorisation) : nom, ordre (hiérarchie -- la première règle qui
correspond gagne), actif, action (categorie_id et/ou remboursable) et
conditions (JSON à deux niveaux, groupes combinés en ET/OU).

Table globale, sans preset_id : les mots-clés visés ne dépendent pas de la
banque, une même règle sert tous les formats d'import.

Revision ID: 0017
Revises: 0016
Create Date: 2026-08-01
"""
from alembic import op
import sqlalchemy as sa

revision = "0017"
down_revision = "0016"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "regle_categorisation",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column("nom", sa.String, nullable=False),
        sa.Column("ordre", sa.Integer, nullable=False, server_default="0"),
        sa.Column("actif", sa.Boolean, nullable=False, server_default=sa.true()),
        sa.Column(
            "categorie_id",
            sa.Integer,
            sa.ForeignKey("categorie.id", ondelete="CASCADE"),
            nullable=True,
        ),
        sa.Column("remboursable", sa.Boolean, nullable=True),
        sa.Column("conditions", sa.JSON, nullable=False),
    )
    op.create_index("ix_regle_categorisation_ordre", "regle_categorisation", ["ordre"])


def downgrade():
    op.drop_index("ix_regle_categorisation_ordre", table_name="regle_categorisation")
    op.drop_table("regle_categorisation")
