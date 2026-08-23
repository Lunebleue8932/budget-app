"""Le cours d'une monnaie contre une autre, et la page d'où il est relu.

CETTE TABLE EST DANS LE NOYAU alors que seule l'extension « Lecture de cours »
la remplit. C'est la règle du dépôt, et elle a une raison précise : une
extension qui emporterait son schéma imposerait de choisir, à la
désinstallation, entre supprimer ses données et refuser de s'éteindre. Ici,
retirer l'extension laisse les taux en base — l'application cesse simplement
d'aller les relire (cf. extensions/README.md).

UN COUPLE, PAS UNE MONNAIE DE RÉFÉRENCE. L'application n'en a aucune, et lui en
inventer une aurait été le premier pas vers l'addition de deux devises —
exactement ce qu'elle refuse de faire depuis toujours. Une ligne dit « 1 unité
de `source` vaut `taux` unités de `cible` », rien de plus, et n'est lue que là
où l'utilisateur la regarde.

RIEN N'EST CONVERTI AVEC. Aucun solde, aucun KPI, aucun budget n'utilise cette
table : les montants restent suivis monnaie par monnaie. Un taux est une
information affichée, pas un opérateur.

`url_cours` est obligatoire : une ligne n'existe que parce qu'on a désigné une
page d'où la lire. `taux` et `maj_le` sont NULL tant que la première lecture
n'a pas abouti — ce qui dit « jamais relu » là où un 1.0 aurait menti.

Revision ID: 0039
Revises: 0038
Create Date: 2026-08-23
"""
from alembic import op
import sqlalchemy as sa

revision = "0039"
down_revision = "0038"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "taux_change",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column(
            "monnaie_source_id",
            sa.Integer(),
            sa.ForeignKey("monnaie.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "monnaie_cible_id",
            sa.Integer(),
            sa.ForeignKey("monnaie.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("url_cours", sa.String(), nullable=False),
        sa.Column("taux", sa.Float(), nullable=True),
        sa.Column("maj_le", sa.DateTime(), nullable=True),
        # Un couple ne se suit qu'une fois : deux lignes pour EUR -> USD
        # donneraient deux taux, et rien pour dire lequel fait foi.
        sa.UniqueConstraint("monnaie_source_id", "monnaie_cible_id", name="uq_taux_change_couple"),
        sa.CheckConstraint(
            "monnaie_source_id <> monnaie_cible_id", name="ck_taux_change_monnaies_distinctes"
        ),
    )
    op.create_index("ix_taux_change_source", "taux_change", ["monnaie_source_id"])
    op.create_index("ix_taux_change_cible", "taux_change", ["monnaie_cible_id"])


def downgrade():
    op.drop_index("ix_taux_change_cible", table_name="taux_change")
    op.drop_index("ix_taux_change_source", table_name="taux_change")
    op.drop_table("taux_change")
