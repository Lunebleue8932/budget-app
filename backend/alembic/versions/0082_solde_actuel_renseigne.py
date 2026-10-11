"""Le solde initial d'un compte peut se déduire du solde ACTUEL qu'on renseigne.

POURQUOI. Quand on ouvre l'app avec un compte qui existe déjà depuis des années, le solde de
DÉPART est rarement connu : ce qu'on a sous les yeux, c'est le solde d'AUJOURD'HUI, celui que la
banque affiche. Une fois la première importation faite, l'application sait ce que les opérations
ont ajouté ou retiré ; il lui suffit alors du solde actuel pour en déduire le solde initial
(`solde initial = solde actuel - ce que les opérations ont changé`).

`solde_actuel_renseigne` GARDE CE QU'ON A SAISI, et c'est ce qui verrouille le solde initial : tant
qu'il est renseigné, le solde initial est celui qu'on en a déduit et ne se modifie plus. Pour le
changer, on supprime d'abord le solde actuel renseigné. NULL = rien de renseigné, le solde initial
est libre comme avant — c'est le cas de tous les comptes existants.

Revision ID: 0082
Revises: 0081
Create Date: 2026-10-11
"""
import sqlalchemy as sa
from alembic import op

revision = "0082"
down_revision = "0081"
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table("compte_monnaie", schema=None) as batch_op:
        batch_op.add_column(sa.Column("solde_actuel_renseigne", sa.Float(), nullable=True))


def downgrade():
    with op.batch_alter_table("compte_monnaie", schema=None) as batch_op:
        batch_op.drop_column("solde_actuel_renseigne")
