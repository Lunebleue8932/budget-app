"""Ce que l'extension « Objectifs » a besoin d'écrire, et rien de plus.

UNE TABLE, `objectif_kpi` — un chiffre qu'on se fixe, et de quoi le mesurer.
Elle vit dans le NOYAU comme tout ce qu'une extension écrit (cf.
extensions/README.md) : éteindre l'extension doit faire disparaître l'écran,
jamais les objectifs qu'on y a posés.

CE QU'ELLE AJOUTE AUX DEUX GRANDEURS DU BUDGET. L'enveloppe d'une catégorie
(`categorie_budget_mensuel`) répond à « combien puis-je encore dépenser là », et
l'objectif de répartition (`categorie.objectif_pourcentage`) à « quelle part
doit y aller ». Aucun des deux ne sait dire « pas plus de quatre sorties par
semaine » ni « mes courses ne devraient pas dépasser 40 € en moyenne » : un
budget compte des euros dépensés, jamais des FOIS ni des MOYENNES — et c'est
pourtant sous cette forme-là qu'on se donne la plupart de ses règles.

AUCUN CALCUL NE LA LIT, et c'est ce qui la rend sans danger : un objectif ne
change aucun solde, aucun KPI, aucune barre d'histogramme. L'application donne
rigoureusement les mêmes chiffres que l'extension tourne ou non.

Revision ID: 0065
Revises: 0064
Create Date: 2026-09-19
"""
from alembic import op
import sqlalchemy as sa

revision = "0065"
down_revision = "0064"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "objectif_kpi",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("nom", sa.String(), nullable=False),
        sa.Column("mesure", sa.String(), nullable=False),
        sa.Column("cadence", sa.String(), nullable=False, server_default="mois"),
        sa.Column("sens", sa.String(), nullable=False, server_default="max"),
        sa.Column("cible", sa.Float(), nullable=False, server_default="0"),
        # SET NULL : supprimer une catégorie ÉLARGIT l'objectif à toutes les
        # dépenses, elle ne l'emporte pas. Un objectif qu'on a écrit ne doit pas
        # disparaître en silence pour un geste fait ailleurs.
        sa.Column(
            "categorie_id",
            sa.Integer(),
            sa.ForeignKey("categorie.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "monnaie_id", sa.Integer(), sa.ForeignKey("monnaie.id"), nullable=False
        ),
        sa.Column(
            "visible_dashboard",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("1"),
        ),
        sa.Column("ordre", sa.Integer(), nullable=False, server_default="0"),
        sa.CheckConstraint(
            "mesure IN ('nombre', 'montant_total', 'montant_moyen', 'part_depenses')",
            name="ck_objectif_kpi_mesure",
        ),
        sa.CheckConstraint(
            "cadence IN ('semaine', 'mois')", name="ck_objectif_kpi_cadence"
        ),
        sa.CheckConstraint("sens IN ('max', 'min')", name="ck_objectif_kpi_sens"),
        sa.CheckConstraint("cible >= 0", name="ck_objectif_kpi_cible"),
    )
    op.create_index("ix_objectif_kpi_categorie", "objectif_kpi", ["categorie_id"])
    op.create_index("ix_objectif_kpi_monnaie", "objectif_kpi", ["monnaie_id"])


def downgrade():
    # REDESCENDRE PERD LES OBJECTIFS, et rien d'autre : aucune opération ne
    # disparaît, aucun montant ne change. C'est précisément ce que garantit le
    # fait qu'aucun calcul ne les lise.
    op.drop_index("ix_objectif_kpi_monnaie", table_name="objectif_kpi")
    op.drop_index("ix_objectif_kpi_categorie", table_name="objectif_kpi")
    op.drop_table("objectif_kpi")
