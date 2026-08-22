"""Bloc-notes libre du dashboard.

Une seule note, pour toute l'application : un pense-bête sans structure — « voir
si le prélèvement EDF est bien passé », « relancer Marie pour les 40 € ». Rien
ici n'est lu, calculé ni rapproché de quoi que ce soit par l'app.

Table dédiée plutôt qu'une table de paramètres fourre-tout : une note est du
texte long, à ligne unique de vérité, et un magasin clé/valeur générique aurait
invité à y ranger tout ce qui n'a pas encore de place.

La ligne est créée à la demande (cf. crud.set_note_dashboard) : une base fraîche
n'a pas de note, et une note vide n'est pas une note.

Revision ID: 0033
Revises: 0032
Create Date: 2026-08-11
"""
from alembic import op
import sqlalchemy as sa

revision = "0033"
down_revision = "0032"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "note_dashboard",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("contenu", sa.Text(), nullable=False, server_default=""),
        sa.Column("modifie_le", sa.DateTime(), nullable=True),
    )


def downgrade():
    op.drop_table("note_dashboard")
