"""Amortissement d'une opération sur plusieurs mois.

Une grosse dépense payée en une fois (une assurance annuelle, un billet d'avion,
un ordinateur) écrasait le mois où elle tombait et laissait les autres
artificiellement légers : l'histogramme et les KPI de période racontaient alors
un accident de calendrier plutôt qu'un train de vie. `amorti` permet de dire que
la dépense PÈSE sur plusieurs mois, sans toucher à la date à laquelle l'argent
est réellement sorti — donc sans rien changer aux soldes des comptes ni aux KPI
du haut du dashboard, qui doivent continuer de refléter l'état réel des comptes.

Deux bornes de mois plutôt que la liste des mois couverts : la liste est
contiguë, donc entièrement décrite par ses bornes, et deux colonnes se comparent
en SQL — c'est ce qui permet au dashboard de ne charger que les opérations dont
la plage recoupe la période affichée. Le nombre de mois et le montant mensuel
n'ont pas de colonne non plus : ils se déduisent exactement des bornes et du
montant (cf. models.Operation.amortissement_nb_mois), et les stocker aurait créé
trois valeurs à garder d'accord au lieu d'une.

Aucune opération n'est engendrée pour les mois couverts (contrairement à la
récurrence) : découper la dépense en N écritures aurait fait diverger le solde
du compte du relevé bancaire, pour ne rien dire de plus que ces deux dates.

Rattrapage : rien. Les opérations existantes ne sont pas amorties, ce que dit
déjà le défaut de la colonne.

Revision ID: 0036
Revises: 0035
Create Date: 2026-08-14
"""
from alembic import op
import sqlalchemy as sa

revision = "0036"
down_revision = "0035"
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table("operation", schema=None) as batch_op:
        batch_op.add_column(
            sa.Column("amorti", sa.Boolean(), nullable=False, server_default=sa.false())
        )
        # Toujours le 1er du mois (normalisé par schemas.OperationBase) : seul
        # le mois porte du sens ici, et deux jours différents feraient dépendre
        # le nombre de mois de quelque chose qui ne compte pas.
        batch_op.add_column(sa.Column("amortissement_debut", sa.Date(), nullable=True))
        batch_op.add_column(sa.Column("amortissement_fin", sa.Date(), nullable=True))


def downgrade():
    with op.batch_alter_table("operation", schema=None) as batch_op:
        batch_op.drop_column("amortissement_fin")
        batch_op.drop_column("amortissement_debut")
        batch_op.drop_column("amorti")
