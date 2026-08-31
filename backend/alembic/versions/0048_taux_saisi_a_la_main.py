"""Un taux de change peut être SAISI À LA MAIN.

Jusqu'ici, `taux_change.url_cours` était obligatoire : un couple de monnaies ne
pouvait exister qu'accompagné d'une page de cotation, et il n'existait donc
aucun moyen d'enregistrer un taux sans l'extension « Lecture de cours », la
seule de l'application qui ouvre une connexion sortante.

CE QUE CETTE CONTRAINTE COÛTAIT. L'agrégation du dashboard en une seule monnaie
a besoin d'un taux, et rien d'autre. Exiger pour cela une connexion à internet
reviendrait à faire dépendre une fonction ordinaire du multi-devises de la seule
extension que quelqu'un peut légitimement refuser d'installer — dans une
application dont la promesse centrale est de tourner hors ligne.

`url_cours` DEVIENT DONC FACULTATIF, et son absence a un sens : « ce taux est
saisi à la main, personne ne va le relire ». C'est le pendant exact de
`cours_maj_le` à NULL sur un titre, qui distingue déjà un cours frais d'un cours
tapé au clavier. « Lecture de cours » n'a rien à changer : elle ne rafraîchit que
les couples qui portent un lien, et les autres ne l'intéressent pas.

RIEN N'EST CONVERTI POUR AUTANT PAR DÉFAUT. Les soldes, les budgets et les KPI
restent suivis monnaie par monnaie ; l'agrégation est une bascule qu'on allume,
et elle n'existe que si l'extension « Monnaies » tourne.

Revision ID: 0048
Revises: 0047
Create Date: 2026-08-31
"""
from alembic import op
import sqlalchemy as sa

revision = "0048"
down_revision = "0047"
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table("taux_change", schema=None) as batch_op:
        batch_op.alter_column("url_cours", existing_type=sa.String(), nullable=True)


def downgrade():
    """Les couples SANS lien sont supprimés : la colonne redevient obligatoire,
    et il n'y a aucune adresse à inventer pour eux."""
    op.execute("DELETE FROM taux_change WHERE url_cours IS NULL")
    with op.batch_alter_table("taux_change", schema=None) as batch_op:
        batch_op.alter_column("url_cours", existing_type=sa.String(), nullable=False)
