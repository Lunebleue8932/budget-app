"""Une catégorie peut être une catégorie d'ENTRÉE, et ça se coche.

CE QUI EXISTAIT, ET POURQUOI IL NE SUFFISAIT PLUS. L'application connaissait
déjà la notion — mais par le NOM, et un seul : `constants.CATEGORIES_SENS_ENTREE`
contenait la chaîne « Entrées d'argent », et trois endroits comparaient à elle
(le sens par défaut d'une opération, l'histogramme des dépenses, le contrôle
d'accord des budgets). Trois conséquences, toutes gênantes :

  - RENOMMER cette catégorie la faisait basculer en catégorie de dépense, sans
    rien dire. Sa barre réapparaissait dans l'histogramme, à zéro, et les
    opérations qu'on y rangeait ensuite étaient comptées comme des sorties ;
  - une SECONDE source de revenus — un salaire et des loyers perçus, une
    allocation, une pension — n'avait aucun moyen d'être reconnue comme telle.
    Il fallait tout ranger dans l'unique catégorie bénie, ou accepter de voir
    ses revenus comptés en dépenses ;
  - et la page Budget, qui demande une enveloppe et une part pour CHAQUE
    catégorie, en réclamait une pour les entrées d'argent — question à laquelle
    il n'y a rien à répondre : on ne se donne pas un budget de salaire.

UNE COLONNE, DONC, ET PLUS UN NOM. `est_entree` remplace la comparaison de
chaîne partout où elle vivait ; la catégorie « Entrées d'argent » livrée avec
l'application la reçoit à vrai, ce qui préserve exactement le comportement
existant sur les bases en place. Elle est désormais renommable sans rien casser,
et n'importe quelle autre peut la rejoindre d'une case à cocher.

CE QUE LA COLONNE NE FAIT PAS. Elle ne convertit aucune opération déjà écrite :
`Operation.sens` est une colonne à part, posée à la création et relue par tous
les soldes. Cocher la case change le sens des opérations qu'on écrira ENSUITE
dans cette catégorie, jamais celui des anciennes — les recalculer d'office
aurait réécrit en silence l'historique, et fait bouger des soldes que
l'utilisateur venait de rapprocher de son relevé.

NON NULLABLE, PAR DÉFAUT FAUX : une catégorie est une catégorie de dépense
jusqu'à preuve du contraire, et c'est le cas de toutes sauf une.

Revision ID: 0060
Revises: 0059
Create Date: 2026-09-14
"""
from alembic import op
import sqlalchemy as sa

revision = "0060"
down_revision = "0059"
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table("categorie", schema=None) as batch_op:
        batch_op.add_column(
            sa.Column("est_entree", sa.Boolean(), nullable=False, server_default=sa.false())
        )

    # REPRISE DES DONNÉES : la catégorie que le code reconnaissait par son nom
    # reçoit la colonne. Sans cette ligne, une base existante verrait ses
    # entrées d'argent rebasculer en dépenses au premier redémarrage — le
    # comportement change alors que personne n'a rien demandé.
    op.execute(
        sa.text("UPDATE categorie SET est_entree = 1 WHERE nom = :nom").bindparams(
            nom="Entrées d'argent"
        )
    )


def downgrade():
    with op.batch_alter_table("categorie", schema=None) as batch_op:
        batch_op.drop_column("est_entree")
