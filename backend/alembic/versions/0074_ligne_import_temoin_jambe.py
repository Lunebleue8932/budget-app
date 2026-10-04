"""Un virement interne n'est importé qu'une fois, mais possède ses deux lignes.

LE TROU. Un relevé ne décrit qu'UN compte. Importer un virement depuis le
compte A écrit les deux jambes (A et B), mais le stock anti-doublons ne retient
que la ligne brute de A : quand le relevé de B arrive, la ligne qui décrit la
même transaction n'a RIEN à qui se comparer, et l'utilisateur doit se
souvenir qu'il l'a déjà importée.

DEUX COLONNES, ET RIEN D'AUTRE, sur `ligne_import_brute` :

  - `jambe_manquante` : la jambe de B, marquée au stock par l'import qui l'a
    écrite. Sans colonnes brutes (aucun fichier ne la décrit) : elle ne sert
    qu'à reconnaître, par compte, sens, montant et date, la ligne qui la décrira.
  - `operation_non_creee` : le TÉMOIN. Quand l'utilisateur confirme que la ligne
    de B est bien ce virement, elle n'est pas importée, mais ses colonnes
    entrent au stock en désignant la jambe existante — le même relevé est
    reconnu comme doublon la fois suivante, sans nouvelle question. Annuler
    l'import qui l'a posé ne supprime pas l'opération (elle vient d'un autre
    import), seulement le témoin.

Revision ID: 0074
Revises: 0073
Create Date: 2026-10-04
"""
from alembic import op
import sqlalchemy as sa

revision = "0074"
down_revision = "0073"
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table("ligne_import_brute") as batch:
        batch.add_column(
            sa.Column(
                "operation_non_creee",
                sa.Boolean(),
                nullable=False,
                server_default=sa.text("0"),
            )
        )
        batch.add_column(
            sa.Column(
                "jambe_manquante",
                sa.Boolean(),
                nullable=False,
                server_default=sa.text("0"),
            )
        )


def downgrade():
    # REDESCENDRE RETIRE LES DEUX MARQUES ET LES LIGNES QUI N'ONT DE SENS QU'AVEC
    # ELLES. Une jambe manquante n'a pas de colonnes brutes : la laisser au
    # stock la ferait comparer à tout (une comparaison sans colonne est toujours
    # vraie). Un témoin pointe vers une opération que SON import n'a pas créée :
    # l'ancienne annulation la supprimerait avec lui. Les perdre ne coûte qu'une
    # question de plus au prochain import — jamais une opération.
    op.execute(
        "DELETE FROM ligne_import_brute "
        "WHERE jambe_manquante = 1 OR operation_non_creee = 1"
    )
    with op.batch_alter_table("ligne_import_brute") as batch:
        batch.drop_column("jambe_manquante")
        batch.drop_column("operation_non_creee")
