"""Une entrée peut être « à déclarer », et une règle peut ne viser que certains formats d'import.

DEUX CHANTIERS, UNE MIGRATION : ils touchent les mêmes tables (`regle_categorisation`,
`operation`) et se livrent ensemble.

CE QUI SERT L'EXTENSION « IMPÔTS »

  - `operation.a_declarer` : une ÉTIQUETTE posée sur une entrée d'argent (un revenu, un
    salaire, un loyer perçu) pour dire « je dois la déclarer à l'administration ». Même
    nature que `operation.imprevue` (0059) : aucun solde, aucun KPI du noyau ne la lit, et
    l'application donne exactement les mêmes chiffres que l'extension tourne ou non.
    `server_default 0` : toute opération existante n'est pas à déclarer.
  - `regle_categorisation.a_declarer` : une règle peut la poser à l'import (nullable : NULL
    veut dire « la règle n'en dit rien », comme les autres propriétés de la 0071).
  - `declaration_impots` : un taux d'imposition et une date limite PAR ANNÉE. Une
    déclaration se fait une fois l'an : une date limite « 2026 » ne dit rien de 2027, et
    un taux ne se confond pas avec un budget (il n'a ni mois ni monnaie).

CE QUI SERT « IMPORTS AVANCÉS »

  - `regle_categorisation.presets` : les formats d'import (presets bancaires) auxquels la
    règle s'applique. NULL = TOUS, ce qu'étaient toutes les règles d'avant : aucune
    reprise de données. Du JSON (une liste d'identifiants) sur le patron de `sorties`
    (0072) ; `crud.delete_import_preset` en retire l'identifiant d'un format supprimé.

Revision ID: 0077
Revises: 0076
Create Date: 2026-10-09
"""
import sqlalchemy as sa
from alembic import op

revision = "0077"
down_revision = "0076"
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table("operation") as batch:
        batch.add_column(
            sa.Column("a_declarer", sa.Boolean(), nullable=False, server_default=sa.text("0"))
        )
    op.create_index("ix_operation_a_declarer", "operation", ["a_declarer"])

    with op.batch_alter_table("regle_categorisation") as batch:
        batch.add_column(sa.Column("a_declarer", sa.Boolean(), nullable=True))
        batch.add_column(sa.Column("presets", sa.JSON(), nullable=True))

    op.create_table(
        "declaration_impots",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("annee", sa.Integer(), nullable=False),
        sa.Column("date_limite", sa.Date(), nullable=True),
        sa.Column("taux_pct", sa.Float(), nullable=True),
        sa.UniqueConstraint("annee", name="uq_declaration_impots_annee"),
        sa.CheckConstraint(
            "taux_pct IS NULL OR (taux_pct >= 0 AND taux_pct <= 100)",
            name="ck_declaration_impots_taux",
        ),
    )


def downgrade():
    op.drop_table("declaration_impots")
    with op.batch_alter_table("regle_categorisation") as batch:
        batch.drop_column("presets")
        batch.drop_column("a_declarer")
    op.drop_index("ix_operation_a_declarer", table_name="operation")
    with op.batch_alter_table("operation") as batch:
        batch.drop_column("a_declarer")
