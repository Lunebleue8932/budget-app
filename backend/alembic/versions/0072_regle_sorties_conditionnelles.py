"""Une règle peut avoir des SORTIES CONDITIONNELLES.

LE CAS QUI L'A DEMANDÉ : une règle reconnaît un virement interne, et le classe
comme tel — mais le compte EN FACE change d'une ligne à l'autre (le livret, le
PEA, le compte joint). Une règle ne portait qu'une action : il fallait donc la
recopier autant de fois qu'il y a de comptes en face, dix règles qui détectent
toutes la même chose et ne diffèrent que par un détail de leur sortie.

UNE SORTIE = DES CONDITIONS + DES ACTIONS, sur le même modèle que la règle
elle-même. Quand la règle correspond, ses sorties sont lues dans l'ordre ; la
PREMIÈRE dont les conditions correspondent remplace, champ par champ, les
actions de la règle qu'elle renseigne. Aucune ne correspond : la règle agit
comme avant. La détection reste celle de la règle — une sortie n'est jamais
lue si la règle n'a pas mordu.

UNE COLONNE JSON, et non une table : une sortie n'existe que dans sa règle,
aucune requête ne la cherche, et ses conditions ont déjà la forme JSON de
celles de la règle. Liste vide = aucune sortie, le comportement d'avant.

Revision ID: 0072
Revises: 0071
Create Date: 2026-09-27
"""
from alembic import op
import sqlalchemy as sa

revision = "0072"
down_revision = "0071"
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table("regle_categorisation") as batch:
        batch.add_column(
            sa.Column("sorties", sa.JSON(), nullable=False, server_default=sa.text("'[]'"))
        )


def downgrade():
    with op.batch_alter_table("regle_categorisation") as batch:
        batch.drop_column("sorties")
