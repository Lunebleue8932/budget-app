"""Le filtre du dashboard remplace l'œil : `categorie.visible_dashboard` s'en va.

CE QUE FAISAIT CETTE COLONNE (migration 0034). Un œil, dans l'onglet Catégories,
retirait une catégorie de l'histogramme du dashboard. C'était un réglage
PERSISTANT, posé loin de l'écran qu'il modifiait, et appliqué À LA SOURCE : le
serveur ne renvoyait même pas les catégories éteintes.

POURQUOI ELLE PART. Le dashboard porte désormais son propre filtre de
catégories, dans le titre du graphe — un menu à cocher qui pilote l'histogramme,
le camembert et la légende ensemble. Les deux mécanismes font la même chose, et
c'est le second qui la fait mieux : il est là où l'on regarde, il se défait d'un
clic, et il ne survit pas à la session. Deux façons de masquer la même catégorie
posaient en plus la question à laquelle personne ne pense — « pourquoi ma
catégorie n'apparaît-elle pas, alors qu'elle est cochée ici ? ».

ET SURTOUT, ELLE FAUSSAIT LES OBJECTIFS DE RÉPARTITION. L'objectif d'une
catégorie est une part de 100 % (migration 0055), et la règle du reste implicite
répartit ce qui manque entre les catégories SANS objectif. Une catégorie éteinte
à la source disparaissait de ce calcul sans disparaître de la somme que le
serveur contrôle à l'écriture : le dénominateur de l'écran et le plafond du
serveur cessaient de parler des mêmes catégories. Retirer la colonne fait
coïncider les deux, sans garde supplémentaire à écrire.

AUCUNE DONNÉE N'EST PERDUE : la colonne ne portait qu'une préférence
d'affichage. Les catégories éteintes redeviennent simplement visibles — et le
filtre du dashboard permet de les remasquer, le temps qu'on regarde.

LE RETOUR ARRIÈRE LA REMET À 1, comme la 0034 le faisait pour les catégories
existantes : redescendre ne doit pas éteindre des catégories que personne n'a
demandé d'éteindre.

Revision ID: 0056
Revises: 0055
Create Date: 2026-09-12
"""
from alembic import op
import sqlalchemy as sa

revision = "0056"
down_revision = "0055"
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table("categorie", schema=None) as batch_op:
        batch_op.drop_column("visible_dashboard")


def downgrade():
    with op.batch_alter_table("categorie", schema=None) as batch_op:
        batch_op.add_column(
            sa.Column(
                "visible_dashboard",
                sa.Boolean(),
                nullable=False,
                server_default=sa.true(),
            )
        )
