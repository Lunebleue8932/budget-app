"""Un objectif peut se RAFFINER par des filtres.

LE CAS QUI L'A DEMANDÉ : « pas plus de quatre sorties restaurant par semaine »
se compte mal quand le café du matin est rangé dans la même catégorie. Il
fallait pouvoir écarter les petites dépenses, celles qui portent un mot précis
dans leur libellé, ou ne regarder que le week-end — sans inventer une catégorie
de plus pour chaque règle qu'on se donne.

UN FILTRE = UN CHAMP ET SA VALEUR (« montant au moins 15 », « libellé ne
contenant pas café », « jours : week-end »). Ils s'additionnent : une dépense
n'est comptée que si elle les passe TOUS. Liste vide = aucun filtre, le
comportement d'avant.

UNE COLONNE JSON, et non une table — même raisonnement que les sorties
conditionnelles d'une règle (migration 0072) : un filtre n'existe que dans son
objectif, et aucune requête ne le cherche.

Revision ID: 0073
Revises: 0072
Create Date: 2026-09-27
"""
from alembic import op
import sqlalchemy as sa

revision = "0073"
down_revision = "0072"
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table("objectif_kpi") as batch:
        batch.add_column(
            sa.Column("filtres", sa.JSON(), nullable=False, server_default=sa.text("'[]'"))
        )


def downgrade():
    with op.batch_alter_table("objectif_kpi") as batch:
        batch.drop_column("filtres")
