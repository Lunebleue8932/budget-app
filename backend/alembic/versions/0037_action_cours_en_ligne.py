"""Lien de cotation d'un titre, et date de sa dernière lecture en ligne.

CES DEUX COLONNES SONT DANS LE NOYAU alors que seule l'extension
« Placements financiers — cours en ligne » (extensions/placements-web) s'en
sert. C'est la règle du dépôt et elle a une raison précise : une extension qui
emporterait son schéma imposerait de choisir, à la désactivation, entre
supprimer ses données et refuser de s'éteindre. Ici, désinstaller l'extension
laisse les liens en base — l'application cesse simplement d'aller les lire, et
tout revient intact à la réinstallation (cf. extensions/README.md).

`url_cours` est la page publique d'où le cours est relu (Yahoo Finance,
Boursorama…), telle que l'utilisateur l'a collée. On stocke l'URL ENTIÈRE et
non un couple (source, symbole) : c'est ce que l'utilisateur a sous les yeux et
peut vérifier d'un clic, là où un symbole recomposé ne se relit pas — et
l'extension qui les reconnaît peut évoluer sans réécrire les liens déjà
enregistrés.

`cours_maj_le` date la dernière lecture RÉUSSIE. Sans elle, un cours affiché ne
dit pas s'il vient de ce matin ou du mois dernier — et un titre dont le lien a
cessé de répondre se lirait comme un titre à cours stable.

Rien n'est daté rétroactivement : les cours déjà en base ont été saisis à la
main, à une date que personne n'a enregistrée. `NULL` dit exactement cela
(« jamais relu en ligne »), là où une date inventée aurait menti.

Revision ID: 0037
Revises: 0036
Create Date: 2026-08-22
"""
from alembic import op
import sqlalchemy as sa

revision = "0037"
down_revision = "0036"
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table("action", schema=None) as batch_op:
        batch_op.add_column(sa.Column("url_cours", sa.String(), nullable=True))
        batch_op.add_column(sa.Column("cours_maj_le", sa.DateTime(), nullable=True))


def downgrade():
    with op.batch_alter_table("action", schema=None) as batch_op:
        batch_op.drop_column("cours_maj_le")
        batch_op.drop_column("url_cours")
