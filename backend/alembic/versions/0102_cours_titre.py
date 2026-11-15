"""L'historique des cours : une valeur par paire (titre, date).

CE QUE C'EST. Jusqu'ici un titre ne portait qu'UN cours, le dernier (`titre_possede.valeur`) : de quoi
valoriser le portefeuille d'aujourd'hui, pas de quoi dire ce qu'il valait il y a six mois. La table
`cours_titre` garde chaque cours avec sa date, pour tracer l'évolution du portefeuille.

CE QUE FAIT LA MIGRATION. Elle crée la table, et la REMPLIT du seul cours qu'on connaisse déjà pour chaque
titre : le dernier, daté de sa dernière lecture en ligne (`cours_maj_le`) ou, à défaut, d'aujourd'hui.
Un titre dont le cours vaut zéro n'en reçoit aucun. Rien d'autre ne change.

Revision ID: 0102
Revises: 0101
Create Date: 2026-11-15
"""
from datetime import date

from alembic import op
import sqlalchemy as sa

revision = "0102"
down_revision = "0101"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "cours_titre",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column(
            "titre_id",
            sa.Integer(),
            sa.ForeignKey("titre_possede.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("date", sa.Date(), nullable=False),
        sa.Column("valeur", sa.Float(), nullable=False),
        sa.Column("source", sa.String(), nullable=True),
        sa.UniqueConstraint("titre_id", "date", name="uq_cours_titre_titre_date"),
        sa.CheckConstraint("valeur >= 0", name="ck_cours_titre_valeur_positive"),
    )
    op.create_index("ix_cours_titre_titre_id_date", "cours_titre", ["titre_id", "date"])

    connexion = op.get_bind()
    aujourdhui = date.today().isoformat()
    lignes = connexion.execute(
        sa.text("SELECT id, valeur, cours_maj_le FROM titre_possede WHERE valeur > 0")
    ).fetchall()
    for titre_id, valeur, maj in lignes:
        jour = str(maj)[:10] if maj else aujourdhui
        connexion.execute(
            sa.text(
                "INSERT INTO cours_titre (titre_id, date, valeur, source) "
                "VALUES (:t, :d, :v, :s)"
            ),
            {"t": titre_id, "d": jour, "v": valeur, "s": "en_ligne" if maj else "manuel"},
        )


def downgrade() -> None:
    op.drop_index("ix_cours_titre_titre_id_date", table_name="cours_titre")
    op.drop_table("cours_titre")
