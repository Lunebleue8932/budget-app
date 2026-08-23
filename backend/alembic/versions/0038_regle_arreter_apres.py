"""Une règle peut laisser la suivante continuer.

Jusqu'ici l'évaluation s'arrêtait à la PREMIÈRE règle qui correspondait, sans
recours : écrire « toutes les lignes SNCF sont des transports » et « celles qui
contiennent REMBOURSEMENT sont des remboursements » obligeait à dupliquer l'une
dans l'autre. Cette colonne rend l'arrêt facultatif, règle par règle.

DÉFAUT `True`, et rétroactivement pour les règles déjà écrites : c'est
exactement le comportement qu'elles avaient. Une migration ne doit pas changer
ce que fait la base, seulement ce qu'elle permet.

Décocher la case laisse l'évaluation continuer vers le bas ; les règles
suivantes ne peuvent alors que COMPLÉTER ce qui n'a pas encore été décidé
(cf. services/regles_categorisation.appliquer_regles). En cas de désaccord, la
règle la plus haute garde la main — sans quoi l'ordre, qui est toute la
lisibilité du système, ne voudrait plus rien dire.

Revision ID: 0038
Revises: 0037
Create Date: 2026-08-23
"""
from alembic import op
import sqlalchemy as sa

revision = "0038"
down_revision = "0037"
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table("regle_categorisation", schema=None) as batch_op:
        batch_op.add_column(
            sa.Column(
                "arreter_apres",
                sa.Boolean(),
                nullable=False,
                server_default=sa.true(),
            )
        )


def downgrade():
    with op.batch_alter_table("regle_categorisation", schema=None) as batch_op:
        batch_op.drop_column("arreter_apres")
