"""remplace categorie.budget_alloue (une valeur unique) par une table
categorie_budget_mensuel (une valeur par catégorie et par mois, avec héritage
en cascade vers le mois précédent quand aucune entrée explicite n'existe)

Revision ID: 0009
Revises: 0008
Create Date: 2026-07-19
"""
from datetime import date

from alembic import op
import sqlalchemy as sa

revision = "0009"
down_revision = "0008"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "categorie_budget_mensuel",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column(
            "categorie_id",
            sa.Integer,
            sa.ForeignKey("categorie.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("annee", sa.Integer, nullable=False),
        sa.Column("mois", sa.Integer, nullable=False),
        sa.Column("montant", sa.Float, nullable=False, server_default="0"),
        sa.UniqueConstraint("categorie_id", "annee", "mois", name="uq_categorie_budget_mensuel"),
        sa.CheckConstraint("mois >= 1 AND mois <= 12", name="ck_categorie_budget_mensuel_mois"),
    )
    op.create_index(
        "ix_categorie_budget_mensuel_categorie", "categorie_budget_mensuel", ["categorie_id"]
    )

    # Reprise des budgets déjà définis : une entrée pour le mois courant (seul
    # mois concret que l'on connaisse au moment de la migration), qui servira
    # ensuite de valeur héritée pour tous les mois suivants tant qu'aucun autre
    # mois n'est explicitement modifié.
    conn = op.get_bind()
    aujourdhui = date.today()
    rows = conn.execute(
        sa.text("SELECT id, budget_alloue FROM categorie WHERE budget_alloue > 0")
    ).fetchall()
    for categorie_id, budget_alloue in rows:
        conn.execute(
            sa.text(
                "INSERT INTO categorie_budget_mensuel (categorie_id, annee, mois, montant) "
                "VALUES (:categorie_id, :annee, :mois, :montant)"
            ),
            {
                "categorie_id": categorie_id,
                "annee": aujourdhui.year,
                "mois": aujourdhui.month,
                "montant": budget_alloue,
            },
        )

    with op.batch_alter_table("categorie", schema=None) as batch_op:
        batch_op.drop_column("budget_alloue")


def downgrade():
    with op.batch_alter_table("categorie", schema=None) as batch_op:
        batch_op.add_column(
            sa.Column("budget_alloue", sa.Float, nullable=False, server_default="0")
        )

    conn = op.get_bind()
    aujourdhui = date.today()
    rows = conn.execute(
        sa.text(
            "SELECT categorie_id, montant FROM categorie_budget_mensuel "
            "WHERE annee = :annee AND mois = :mois"
        ),
        {"annee": aujourdhui.year, "mois": aujourdhui.month},
    ).fetchall()
    for categorie_id, montant in rows:
        conn.execute(
            sa.text("UPDATE categorie SET budget_alloue = :montant WHERE id = :id"),
            {"montant": montant, "id": categorie_id},
        )

    op.drop_index("ix_categorie_budget_mensuel_categorie", table_name="categorie_budget_mensuel")
    op.drop_table("categorie_budget_mensuel")
