"""Le calque d'un ETF sur un indice SE SOUVIENT de l'indice.

CE QUI MANQUAIT. Calquer un ETF sur un indice recopiait des données sans rien retenir : mettre
l'indice à jour (un nouvel import de sa composition) laissait chaque ETF calqué sur l'ancienne,
et il fallait refaire la liaison ETF par ETF.

CE QUI EST AJOUTÉ. `titre_possede.indice_id` (l'indice sur lequel l'ETF est calqué ; NULL si
l'indice disparaît) et `calque_proprietes` (JSON : les propriétés que l'ETF PREND à l'indice,
composition / classe / zone / secteur). Mettre l'indice à jour les repropage aux ETF liés.

UN INDICE N'A PAS D'ENVELOPPE : si l'un d'eux en portait une (posée avant cette règle), elle est retirée.

DESCENTE. Les deux colonnes disparaissent ; les données recopiées restent.

Revision ID: 0094
Revises: 0093
Create Date: 2026-10-25
"""
from alembic import op
import sqlalchemy as sa

revision = "0094"
down_revision = "0093"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("titre_possede", schema=None) as batch_op:
        batch_op.add_column(sa.Column("indice_id", sa.Integer(), nullable=True))
        batch_op.add_column(sa.Column("calque_proprietes", sa.JSON(), nullable=True))
        batch_op.create_foreign_key(
            "fk_titre_possede_indice_id", "titre_possede", ["indice_id"], ["id"], ondelete="SET NULL"
        )
    op.execute("UPDATE titre_possede SET type_titre_id = NULL WHERE est_indice = 1")


def downgrade() -> None:
    with op.batch_alter_table("titre_possede", schema=None) as batch_op:
        batch_op.drop_constraint("fk_titre_possede_indice_id", type_="foreignkey")
        batch_op.drop_column("calque_proprietes")
        batch_op.drop_column("indice_id")
