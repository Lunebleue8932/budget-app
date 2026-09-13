"""Un objectif de RÉPARTITION par catégorie, en pourcentage.

CE QUI MANQUAIT, ET POURQUOI LE BUDGET EN VALEUR NE LE DIT PAS. L'application
sait déjà porter un budget en euros par catégorie et par mois
(`CategorieBudgetMensuel`) : « l'alimentaire, 400 € en mars ». C'est une
ENVELOPPE — elle répond à « combien puis-je encore dépenser ». Elle ne répond
pas à l'autre question, celle qu'on se pose devant le camembert : « quelle PART
de ce que je dépense doit aller là ». Un mois à 1 800 € et un mois à 3 200 €
n'appellent pas la même enveloppe, mais bien la même part.

LES DEUX SONT DÉCORRÉLÉS, DÉLIBÉRÉMENT. Rien ici ne dérive du budget en valeur
et rien n'y retourne : on peut poser un objectif de 15 % sans budget, un budget
sans objectif, ou les deux sans qu'ils se contredisent — ils ne mesurent pas la
même chose. C'est la raison pour laquelle ce n'est pas une colonne de plus sur
`categorie_budget_mensuel`, où le mois et la monnaie de la clé auraient forcé le
pourcentage à devenir mensuel lui aussi.

UNE COLONNE SUR `categorie`, DONC : NI MOIS, NI MONNAIE. Un pourcentage est une
INTENTION, pas un montant. Elle ne change pas d'un mois à l'autre (sinon ce
serait un budget), et elle ne dépend d'aucune devise — 15 % vaut 15 % en euros
comme en dollars, là où « 400 » ne veut rien dire sans sa monnaie (cf.
`CategorieBudgetMensuel`, dont la monnaie est justement dans la clé pour cette
raison).

ZÉRO VEUT DIRE « PAS D'OBJECTIF », et c'est pour ça que la colonne n'est pas
nullable. Un NULL aurait ajouté un troisième état (absent / zéro / une valeur) à
tester dans chaque écran qui l'affiche, pour une distinction qui n'existe pas :
viser 0 % d'une catégorie et ne rien viser du tout se lisent pareil à l'écran —
aucune pastille. Même raisonnement que `description` sur les règles.

LA SOMME N'EST PAS CONTRAINTE À 100 %, et ce n'est pas un oubli. On pose un
objectif sur les trois ou quatre catégories qui comptent, pas sur les vingt ;
exiger un total exact aurait obligé à en inventer sur toutes les autres, et
rendu impossible l'état ordinaire — celui où l'on commence, avec un seul
objectif posé. La borne haute (100) est là pour refuser une faute de frappe,
pas pour faire un budget fermé.

Revision ID: 0055
Revises: 0054
Create Date: 2026-09-12
"""
from alembic import op
import sqlalchemy as sa

revision = "0055"
down_revision = "0054"
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table("categorie", schema=None) as batch_op:
        batch_op.add_column(
            sa.Column(
                "objectif_pourcentage",
                sa.Float(),
                nullable=False,
                server_default="0",
            )
        )
        # La borne basse refuse un pourcentage négatif (une part ne se soustrait
        # pas), la haute une virgule oubliée — « 150 » saisi pour « 15,0 » est la
        # faute qu'on commet, et elle se verrait sur le camembert sous la forme
        # d'un objectif plus gros que le total.
        batch_op.create_check_constraint(
            "ck_categorie_objectif_pourcentage",
            "objectif_pourcentage >= 0 AND objectif_pourcentage <= 100",
        )


def downgrade():
    with op.batch_alter_table("categorie", schema=None) as batch_op:
        batch_op.drop_constraint("ck_categorie_objectif_pourcentage", type_="check")
        batch_op.drop_column("objectif_pourcentage")
