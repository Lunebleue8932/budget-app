"""Doublons : désigner les colonnes à comparer, et pas seulement celles à exclure.

Jusqu'ici la comparaison partait de TOUTES les colonnes du fichier, dont on
retirait une liste d'exceptions. C'est le bon bout par lequel prendre le
problème quand une seule colonne bouge d'un export à l'autre (le solde
courant), et le mauvais quand le relevé est large et que trois colonnes
suffisent à identifier une ligne : il fallait alors recenser toutes les autres,
et une colonne oubliée — ou ajoutée plus tard par la banque — faisait
silencieusement échouer la détection.

D'où un mode, et le renommage qui va avec :

    colonnes_exclues_comparaison -> colonnes_comparaison
    (nouveau) mode_comparaison   -> 'exclusion' (défaut) | 'selection'

Les presets existants passent en `exclusion` avec leur liste inchangée : ils se
comportent donc exactement comme avant.

Revision ID: 0030
Revises: 0029
Create Date: 2026-08-10
"""
from alembic import op
import sqlalchemy as sa

revision = "0030"
down_revision = "0029"
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table("import_preset", schema=None) as batch_op:
        batch_op.alter_column(
            "colonnes_exclues_comparaison", new_column_name="colonnes_comparaison"
        )
        batch_op.add_column(
            sa.Column(
                "mode_comparaison",
                sa.String,
                nullable=False,
                server_default="exclusion",
            )
        )


def downgrade():
    # Un preset passé en `selection` perd ici le sens de sa liste : relue comme
    # une liste d'exclusions, elle comparerait exactement les colonnes qu'elle
    # désignait. On la vide donc plutôt que de la retourner — comparer tout est
    # le comportement d'origine, et le seul qui ne détecte pas de faux doublons.
    op.execute(
        sa.text(
            "UPDATE import_preset SET colonnes_comparaison = '[]' "
            "WHERE mode_comparaison = 'selection'"
        )
    )
    with op.batch_alter_table("import_preset", schema=None) as batch_op:
        batch_op.drop_column("mode_comparaison")
        batch_op.alter_column(
            "colonnes_comparaison", new_column_name="colonnes_exclues_comparaison"
        )
