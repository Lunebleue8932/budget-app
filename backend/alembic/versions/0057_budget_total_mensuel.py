"""Le BUDGET TOTAL d'un mois : la troisième grandeur du budget.

CE QU'ELLE EST. Un montant unique pour tout un mois et une monnaie — ce qu'on
se donne le droit de dépenser, toutes catégories confondues. Jusqu'ici le
budget n'existait qu'au niveau d'une catégorie (`categorie_budget_mensuel`), et
l'enveloppe globale ne pouvait se lire qu'en additionnant les vingt autres :
un chiffre qui n'était nulle part, alors que c'est le premier qu'on se fixe.

CE QU'ELLE PERMET, ET POURQUOI ELLE ARRIVE MAINTENANT. Le camembert des
dépenses gagne une seconde vue, dite « budget », où la part d'une catégorie est
rapportée non plus au total dépensé mais à CE MONTANT-CI. La différence est
tout l'intérêt : rapportées au total dépensé, les parts somment toujours 100 %,
et un objectif de répartition n'y est atteignable que si toutes les autres
catégories le sont aussi — la comparaison ne dit donc presque rien. Rapportées
au budget total, elles sont indépendantes les unes des autres : « l'alimentaire
devait peser 30 % de mon budget, il en pèse 22 % » est une phrase vraie que
rien d'autre à l'écran ne fait dire.

TROIS GRANDEURS, UNE ÉQUATION. Le budget d'une catégorie, son objectif en
pourcentage et ce budget total ne sont pas indépendants : le premier devrait
valoir le troisième multiplié par le deuxième. Les trois se saisissent
séparément, et rien n'oblige à les poser toutes ; mais dès que deux d'entre
elles cadrent la troisième, l'application le signale (cf.
crud.incoherences_budgets) et demande laquelle corriger, plutôt que d'en
recalculer une d'office dans le dos de celui qui vient d'écrire l'autre.

MÊME FORME QUE `categorie_budget_mensuel`, ET C'EST DÉLIBÉRÉ : table creuse,
héritage du dernier mois explicite, monnaie dans la clé. Poser le budget de
janvier une fois vaut pour toute l'année, et « 2 500 » ne veut rien dire sans
savoir en quelle devise. Une forme différente pour la même notion aurait obligé
à apprendre deux fois la même règle.

Revision ID: 0057
Revises: 0056
Create Date: 2026-09-13
"""
from alembic import op
import sqlalchemy as sa

revision = "0057"
down_revision = "0056"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "budget_total_mensuel",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("annee", sa.Integer(), nullable=False),
        sa.Column("mois", sa.Integer(), nullable=False),
        sa.Column(
            "monnaie_id", sa.Integer(), sa.ForeignKey("monnaie.id"), nullable=False
        ),
        sa.Column("montant", sa.Float(), nullable=False, server_default="0"),
        sa.UniqueConstraint("annee", "mois", "monnaie_id", name="uq_budget_total_mensuel"),
        sa.CheckConstraint("mois >= 1 AND mois <= 12", name="ck_budget_total_mensuel_mois"),
        sa.CheckConstraint("montant >= 0", name="ck_budget_total_mensuel_montant"),
    )
    op.create_index(
        "ix_budget_total_mensuel_monnaie", "budget_total_mensuel", ["monnaie_id"]
    )


def downgrade():
    # LA TABLE DISPARAÎT AVEC SON CONTENU, et c'est sans conséquence sur le
    # reste : aucun solde, aucun KPI, aucune opération ne la lit. Redescendre
    # rend simplement au camembert sa vue unique.
    op.drop_index("ix_budget_total_mensuel_monnaie", table_name="budget_total_mensuel")
    op.drop_table("budget_total_mensuel")
