"""Un projet peut avoir une PÉRIODE et un MONTANT à tenir.

LE CAS QUI L'A DEMANDÉ. Un projet regroupait des opérations sans rien dire du temps ni de ce qu'on
s'autorise : « Voyage en Italie » n'avait ni début ni fin, et aucun plafond à comparer à ce qu'il
coûtait. Cinq colonnes, toutes facultatives, et aucun projet existant ne bouge :

  - `date_debut` / `date_fin` : la période (une date de fin seule est une deadline). Elles ne
    FILTRENT rien — un projet reste les opérations qu'on y a versées — mais disent où on en est
    (jours restants) et servent de bornes au sélecteur d'opérations ;
  - `montant_max` : ce que les DÉPENSES du projet ne doivent pas dépasser ;
  - `montant_min` : ce que ses ENTRÉES doivent atteindre (une cagnotte, des recettes) ;
  - `monnaie_cible_id` : la monnaie dans laquelle ces deux montants sont écrits (un projet peut
    toucher plusieurs monnaies, et l'app ne les additionne jamais).

Revision ID: 0084
Revises: 0083
Create Date: 2026-10-16
"""
from alembic import op
import sqlalchemy as sa

revision = "0084"
down_revision = "0083"
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table("sous_filtre") as batch:
        batch.add_column(sa.Column("date_debut", sa.Date(), nullable=True))
        batch.add_column(sa.Column("date_fin", sa.Date(), nullable=True))
        batch.add_column(sa.Column("montant_max", sa.Float(), nullable=True))
        batch.add_column(sa.Column("montant_min", sa.Float(), nullable=True))
        batch.add_column(sa.Column("monnaie_cible_id", sa.Integer(), nullable=True))
        batch.create_foreign_key(
            "fk_sous_filtre_monnaie_cible",
            "monnaie",
            ["monnaie_cible_id"],
            ["id"],
            ondelete="SET NULL",
        )


def downgrade():
    with op.batch_alter_table("sous_filtre") as batch:
        batch.drop_constraint("fk_sous_filtre_monnaie_cible", type_="foreignkey")
        batch.drop_column("monnaie_cible_id")
        batch.drop_column("montant_min")
        batch.drop_column("montant_max")
        batch.drop_column("date_fin")
        batch.drop_column("date_debut")
