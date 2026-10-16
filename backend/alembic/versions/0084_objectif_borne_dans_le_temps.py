"""Un objectif peut se BORNER dans le temps : une date de début et une date de fin.

LE CAS QUI L'A DEMANDÉ. Jusqu'ici un objectif se lisait sur une cadence (par semaine, par
mois) et le dashboard décidait de la période. « Pas plus de 2 000 € pour ce voyage d'ici le
31 décembre » ou « mettre au moins 600 € de côté entre mars et août » n'est pourtant pas un
rythme : c'est un total sur une fenêtre précise, qui a un début, une fin, et qu'on compare à
un maximum (à ne pas dépasser) ou à un minimum (à atteindre).

TROIS COLONNES, TOUTES FACULTATIVES, et aucun objectif existant ne bouge :
  - `date_debut` / `date_fin` : la fenêtre. Sans `date_fin`, l'objectif reste un objectif de
    cadence, exactement comme avant ;
  - `cree_le` : le jour de la création. Une DEADLINE sans date de début compte à partir de là
    — compter depuis le premier relevé de l'historique aurait attribué à l'objectif des
    dépenses faites des années avant qu'on se le fixe. Les objectifs d'avant gardent NULL :
    ils n'ont pas de fenêtre, donc pas besoin.

Revision ID: 0084
Revises: 0083
Create Date: 2026-10-16
"""
from alembic import op
import sqlalchemy as sa

revision = "0084"
down_revision = "0083"
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table("objectif_kpi") as batch:
        batch.add_column(sa.Column("date_debut", sa.Date(), nullable=True))
        batch.add_column(sa.Column("date_fin", sa.Date(), nullable=True))
        batch.add_column(sa.Column("cree_le", sa.Date(), nullable=True))


def downgrade():
    with op.batch_alter_table("objectif_kpi") as batch:
        batch.drop_column("cree_le")
        batch.drop_column("date_fin")
        batch.drop_column("date_debut")
