"""Les sous-projets : un projet B rangé sous un projet A.

CE QUE C'EST. Un projet regroupe des opérations par événement ; un sous-projet est un projet qui en
fait partie d'un autre — « Vol » et « Hôtel » sous « Voyage Italie ». Côté données, c'est comme si
toutes les opérations de B avaient été versées dans A : totaux, histogramme, cascade, nombre
d'opérations et objectifs de A les comptent (une opération présente des deux côtés une seule fois).
Côté écran, elles sont rangées dans un volet « B » de A.

CE QUE FAIT LA MIGRATION. Elle ajoute `sous_filtre.parent_id` (un projet n'a qu'un seul parent ; NULL
d'origine, aucun projet n'est touché). Supprimer le parent libère ses sous-projets (SET NULL), il
n'emporte jamais leurs opérations.

Revision ID: 0100
Revises: 0099
Create Date: 2026-11-05
"""
from alembic import op
import sqlalchemy as sa

revision = "0100"
down_revision = "0099"
branch_labels = None
depends_on = None


def upgrade() -> None:
    with op.batch_alter_table("sous_filtre") as lot:
        lot.add_column(sa.Column("parent_id", sa.Integer(), nullable=True))
        lot.create_foreign_key(
            "fk_sous_filtre_parent",
            "sous_filtre",
            ["parent_id"],
            ["id"],
            ondelete="SET NULL",
        )
        lot.create_index("ix_sous_filtre_parent", ["parent_id"])


def downgrade() -> None:
    with op.batch_alter_table("sous_filtre") as lot:
        lot.drop_index("ix_sous_filtre_parent")
        lot.drop_constraint("fk_sous_filtre_parent", type_="foreignkey")
        lot.drop_column("parent_id")
