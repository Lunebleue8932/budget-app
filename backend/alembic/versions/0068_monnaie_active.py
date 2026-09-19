"""Une monnaie s'éteint, comme un compte, une catégorie, ou la monnaie d'un compte.

LA MÊME IDÉE, D'UN CRAN PLUS HAUT. `CompteMonnaie.active` (0053) retire une
monnaie d'UN compte ; celle-ci la retire de l'application entière. Un dollar
ouvert le temps d'un voyage, soldé depuis, restait dans le menu de chaque
opération, dans chaque formulaire de compte et dans chaque devinette d'import —
pour toujours, puisque le supprimer est refusé dès qu'une opération y est
libellée (à juste titre : les montants perdraient le solde qui les porte).

ÉTEINDRE NE SUPPRIME RIEN, comme partout ailleurs : les opérations restent en
base, leurs montants gardent leur devise, les soldes historiques ne bougent pas.
Ce qui change est que plus aucune NOUVELLE écriture ne la désigne.

LA CONDITION EST PLUS DURE QUE POUR UN COMPTE, et elle doit l'être : une monnaie
éteinte quitte les menus de TOUS les comptes à la fois. Il faut donc qu'AUCUN
compte ne porte de solde dans cette monnaie — réel et projeté, comme pour
`CompteMonnaie` — et qu'aucun TITRE n'y soit détenu, sans quoi une valorisation
entière disparaîtrait des écrans sans qu'une seule opération ait bougé (cf.
routeur_monnaies._obstacles_extinction).

LA DERNIÈRE MONNAIE ALLUMÉE NE S'ÉTEINT PAS. Une application sans monnaie
active n'a plus de quoi libeller une opération : chaque formulaire de saisie
proposerait une liste vide, et le premier compte créé n'aurait aucune devise à
porter. C'est la même protection que « Autres » côté catégories.

Revision ID: 0068
Revises: 0067
Create Date: 2026-09-19
"""
from alembic import op
import sqlalchemy as sa

revision = "0068"
down_revision = "0067"
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table("monnaie") as batch:
        batch.add_column(
            sa.Column("active", sa.Boolean(), nullable=False, server_default=sa.text("1"))
        )


def downgrade():
    # REDESCENDRE RALLUME TOUT, et ne perd rien d'autre : une monnaie éteinte
    # n'était qu'une monnaie qu'on ne proposait plus.
    with op.batch_alter_table("monnaie") as batch:
        batch.drop_column("active")
