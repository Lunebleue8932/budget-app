"""« Indice » : un titre qu'on ne peut pas détenir.

CE QUI MANQUAIT. Un ETF à réplication synthétique ne publie pas les valeurs de l'indice qu'il
suit : on importe alors la composition d'un autre fonds (ou de l'indice lui-même) pour la poser
sur l'ETF qu'on détient. Le fonds dont on a lu le fichier existait ensuite dans l'application
comme un ETF de plus, sans que personne ne le détienne.

CE QUI EST AJOUTÉ. `titre_possede.est_indice` (booléen, faux par défaut) : un titre qui ne peut
pas être détenu - aucun achat ne peut le viser - et qui sert à suivre un cours ou de modèle à des
ETF qu'on calque dessus. Aucune donnée existante n'est touchée : tout titre reste ce qu'il était.

DESCENTE. La colonne disparaît ; un indice redevient un titre ordinaire (il garde sa composition,
ses répartitions et son cours).

Revision ID: 0093
Revises: 0092
Create Date: 2026-10-24
"""
from alembic import op
import sqlalchemy as sa

revision = "0093"
down_revision = "0092"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("titre_possede", schema=None) as batch_op:
        batch_op.add_column(
            sa.Column("est_indice", sa.Boolean(), nullable=False, server_default=sa.false())
        )


def downgrade() -> None:
    with op.batch_alter_table("titre_possede", schema=None) as batch_op:
        batch_op.drop_column("est_indice")
