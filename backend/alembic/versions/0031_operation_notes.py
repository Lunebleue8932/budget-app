"""Notes libres sur une opération.

Un champ texte sans aucune sémantique pour l'app : elle ne le lit jamais, ne le
filtre pas et ne le somme pas. Il n'existe que pour ce qu'aucune colonne ne peut
porter — « facture partagée avec Léa », « à revoir, montant douteux » — et
n'apparaît qu'à l'édition, pour ne pas alourdir des tableaux déjà denses.

NULL et chaîne vide y sont volontairement équivalents (« pas de note ») : le
formulaire renvoie l'un ou l'autre selon qu'il a été ouvert ou non, et rien
n'aurait à gagner à les distinguer.

Revision ID: 0031
Revises: 0030
Create Date: 2026-08-11
"""
from alembic import op
import sqlalchemy as sa

revision = "0031"
down_revision = "0030"
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table("operation", schema=None) as batch_op:
        batch_op.add_column(sa.Column("notes", sa.String(), nullable=True))


def downgrade():
    with op.batch_alter_table("operation", schema=None) as batch_op:
        batch_op.drop_column("notes")
