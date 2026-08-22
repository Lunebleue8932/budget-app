"""Une règle qui classe en virement interne peut désigner le compte en face.

Une règle savait poser le TYPE « virement interne », mais pas le second compte :
la ligne arrivait donc dans l'aperçu avec une seule jambe, et il fallait ouvrir
« Modifier » sur chacune pour désigner l'autre côté. Deux conséquences, l'une
pénible et l'autre invisible :

 - l'import restait bloqué tant que chaque virement n'avait pas été repris à la
   main (cf. _erreur_ligne, « le compte en face n'est pas renseigné ») ;
 - la veille anti-doublon de virements ne comparait rien, faute des deux comptes
   qu'elle exige — elle ne s'est donc jamais déclenchée sur un import piloté par
   des règles.

Le compte n'a de sens que pour le type « virement interne » ; il est laissé NULL
pour tous les autres, et le routeur le neutralise au changement de type.

Revision ID: 0032
Revises: 0031
Create Date: 2026-08-11
"""
from alembic import op
import sqlalchemy as sa

revision = "0032"
down_revision = "0031"
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table("regle_categorisation", schema=None) as batch_op:
        batch_op.add_column(sa.Column("compte_autre_id", sa.Integer(), nullable=True))
        # Pas de contrainte nommée en SQLite sans recréation de table : la FK
        # est portée par le modèle, et le routeur vérifie l'existence du compte.
        batch_op.create_index(
            "ix_regle_categorisation_compte_autre_id", ["compte_autre_id"], unique=False
        )


def downgrade():
    with op.batch_alter_table("regle_categorisation", schema=None) as batch_op:
        batch_op.drop_index("ix_regle_categorisation_compte_autre_id")
        batch_op.drop_column("compte_autre_id")
