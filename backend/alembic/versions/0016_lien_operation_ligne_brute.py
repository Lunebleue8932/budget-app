"""relie chaque ligne brute importée à l'opération qu'elle a créée
(ligne_import_brute.operation_id, ON DELETE CASCADE) pour que supprimer une
opération la retire du stock anti-doublons, et rend optionnel le saut de la
première ligne du fichier (import_preset.ignorer_premiere_ligne, défaut False
= la première ligne est une ligne de données).

Les lignes brutes déjà stockées gardent operation_id NULL : leur opération
d'origine n'est pas identifiable rétroactivement (rien ne la liait), elles
continuent donc de servir de référence anti-doublons sans être nettoyées.

Revision ID: 0016
Revises: 0015
Create Date: 2026-08-01
"""
from alembic import op
import sqlalchemy as sa

revision = "0016"
down_revision = "0015"
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table("import_preset", schema=None) as batch_op:
        batch_op.add_column(
            sa.Column(
                "ignorer_premiere_ligne",
                sa.Boolean,
                nullable=False,
                server_default=sa.false(),
            )
        )

    with op.batch_alter_table("ligne_import_brute", schema=None) as batch_op:
        batch_op.add_column(sa.Column("operation_id", sa.Integer, nullable=True))
        batch_op.create_foreign_key(
            "fk_ligne_import_brute_operation",
            "operation",
            ["operation_id"],
            ["id"],
            ondelete="CASCADE",
        )
        batch_op.create_index("ix_ligne_import_brute_operation", ["operation_id"])


def downgrade():
    with op.batch_alter_table("ligne_import_brute", schema=None) as batch_op:
        batch_op.drop_index("ix_ligne_import_brute_operation")
        batch_op.drop_constraint("fk_ligne_import_brute_operation", type_="foreignkey")
        batch_op.drop_column("operation_id")

    with op.batch_alter_table("import_preset", schema=None) as batch_op:
        batch_op.drop_column("ignorer_premiere_ligne")
