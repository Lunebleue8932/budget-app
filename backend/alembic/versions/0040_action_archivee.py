"""Un titre peut être archivé : rangé, jamais effacé.

LE PROBLÈME. Un titre entièrement vendu n'a plus rien à faire dans « Titres
suivis » ni dans le menu d'achat, mais il ne peut pas non plus être SUPPRIMÉ :
chacun de ses mouvements porte une opération d'espèces réelle (cf.
models.OperationAction), et les effacer réécrirait le solde du compte-titres et
tout ce qui en découle. On se retrouvait donc devant un choix qui n'en est pas
un — garder à l'écran un titre qu'on ne détient plus, ou détruire l'historique
de ce qu'on a réellement acheté et vendu.

CETTE COLONNE EST LA TROISIÈME VOIE. Archiver ne touche à aucune donnée : les
mouvements restent, les plus-values passées restent, les opérations d'espèces
restent. Seule change la place du titre dans l'interface — il sort des listes où
l'on choisit un titre, et de la relecture des cours en ligne.

DÉFAUT `False` : aucune base existante ne change de comportement. Une migration
ne doit pas changer ce que fait la base, seulement ce qu'elle permet.

Revision ID: 0040
Revises: 0039
Create Date: 2026-08-23
"""
from alembic import op
import sqlalchemy as sa

revision = "0040"
down_revision = "0039"
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table("action", schema=None) as batch_op:
        batch_op.add_column(
            sa.Column(
                "archivee",
                sa.Boolean(),
                nullable=False,
                server_default=sa.false(),
            )
        )


def downgrade():
    with op.batch_alter_table("action", schema=None) as batch_op:
        batch_op.drop_column("archivee")
