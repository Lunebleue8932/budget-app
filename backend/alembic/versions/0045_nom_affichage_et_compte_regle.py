"""Un titre peut porter un nom d'affichage, et une règle de placement un compte.

DEUX CHANGEMENTS, UN SEUL SUJET : l'import de placements, et ce qu'on peut
corriger sans mentir sur ce que le fichier disait.

1. `action.nom_affichage`. Le nom d'un titre chez un courtier est souvent
   illisible — « AMUNDI IDX SOL MSC WLD-IE-C », tronqué à vingt-six caractères
   par un export. On veut pouvoir le renommer.

   MAIS PAS ÉCRASER `nom`. C'est par le nom lu dans le fichier, à défaut d'ISIN,
   que l'import RECONNAÎT un titre d'un import à l'autre (cf.
   service_import_placements._rapprocher_titre). Le renommer sur place ferait
   que l'import suivant ne le retrouverait plus, créerait un second titre du
   même ISIN, et scinderait la position en deux.

   D'où une colonne DE PLUS : `nom` reste ce que le courtier écrit — non
   modifiable, comme l'ISIN — et `nom_affichage` est ce qu'on lit à l'écran.
   NULL veut dire « pas renommé », et l'écran affiche alors `nom`. Aucune
   contrainte d'unicité : deux titres peuvent légitimement s'afficher pareil
   (deux parts d'un même fonds), et c'est `nom` qui identifie.

2. `regle_import_placement.compte_autre_id`. Une règle qui classe une ligne en
   transfert d'espèces peut désormais dire d'où vient (ou où va) l'argent.

   Un relevé de compte-titres ne décrit qu'un côté du mouvement : sans le second
   compte, chaque transfert reconnu par la règle arrive incomplet dans l'aperçu
   et doit être repris à la main avant de pouvoir être importé. C'est exactement
   le rôle que `compte_autre_id` joue déjà pour les règles bancaires (migration
   0032), et la colonne est ici la même.

   UN SEUL COMPTE, et le SENS n'est pas demandé : il se déduit du signe du
   montant, comme partout ailleurs dans cet import. NULL pour toute règle qui ne
   classe pas en transfert — le routeur le neutralise, comme il le fait déjà
   côté bancaire.

   `ondelete="SET NULL"` : supprimer un compte ne doit pas emporter la règle,
   seulement le compte qu'elle proposait.

Revision ID: 0045
Revises: 0044
Create Date: 2026-08-29
"""
from alembic import op
import sqlalchemy as sa

revision = "0045"
down_revision = "0044"
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table("action", schema=None) as batch_op:
        batch_op.add_column(sa.Column("nom_affichage", sa.String(), nullable=True))

    # `batch_alter_table` recrée la table : c'est le seul moyen d'ajouter une
    # clé étrangère sous SQLite, qui ne sait pas la poser sur une table
    # existante.
    with op.batch_alter_table("regle_import_placement", schema=None) as batch_op:
        batch_op.add_column(sa.Column("compte_autre_id", sa.Integer(), nullable=True))
        batch_op.create_foreign_key(
            "fk_regle_import_placement_compte_autre",
            "compte",
            ["compte_autre_id"],
            ["id"],
            ondelete="SET NULL",
        )


def downgrade():
    with op.batch_alter_table("regle_import_placement", schema=None) as batch_op:
        batch_op.drop_constraint(
            "fk_regle_import_placement_compte_autre", type_="foreignkey"
        )
        batch_op.drop_column("compte_autre_id")

    with op.batch_alter_table("action", schema=None) as batch_op:
        batch_op.drop_column("nom_affichage")
