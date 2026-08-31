"""Un compte peut porter un taux de rémunération.

TROIS COLONNES QUI NE DÉCRIVENT QU'UN CALCUL D'AFFICHAGE. Aucun solde, aucun
KPI, aucune projection du noyau ne les lit : c'est l'extension « Taux
d'épargne » qui s'en sert, et elle seule. Les intérêts ne sont JAMAIS écrits en
opérations — une opération est un mouvement constaté, et ce qui se calcule ici
est une prévision qui change à chaque nouveau virement sur le compte. Une base
dont l'extension est éteinte se comporte donc exactement comme avant.

LE TAUX EST ANNUEL, ET UNIQUEMENT ANNUEL. C'est ainsi qu'une banque l'annonce,
et la seule façon de comparer deux comptes. La fréquence ne change pas le taux :
elle dit à quelles DATES il est appliqué, donc sur quel solde — puisque le solde
bouge entre deux versements. 2 % versés chaque jour et 2 % versés une fois l'an
ne donnent pas le même résultat dès qu'un virement tombe au milieu de l'année.
C'est toute la raison d'être de la seconde colonne.

`remuneration_debut` dit à partir de quand le compte rapporte, et sur quel
calendrier tombent les versements (le 3 de chaque mois, tel jour de la semaine).
Facultative : à défaut, le calcul part de la première opération du compte — le
repère le plus proche de la vérité dont l'app dispose. Un compte ouvert bien
avant sa première ligne importée le fausse, d'où cette date qu'on renseigne
quand on la connaît.

TOUTES NULLABLES, et donc rétroactivement neutres : les comptes déjà en base
n'ont pas de taux, ce qui est exactement ce qu'ils étaient. Aucune valeur par
défaut n'est inventée — un livret à 0 % et un livret dont on ignore le taux ne
sont pas la même chose, et seul le second doit se taire.

LES COLONNES SONT SUR `compte` ET NON SUR UN TYPE : c'est bien un compte
particulier qui porte un taux (deux livrets n'ont pas le même), et l'écran de
l'extension ne propose de les renseigner que pour les comptes d'épargne.

Revision ID: 0044
Revises: 0043
Create Date: 2026-08-29
"""
from alembic import op
import sqlalchemy as sa

revision = "0044"
down_revision = "0043"
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table("compte", schema=None) as batch_op:
        batch_op.add_column(sa.Column("taux_remuneration", sa.Float(), nullable=True))
        # Une chaîne contrainte par l'enum Python (native_enum=False), comme
        # partout ailleurs dans ce schéma : SQLite n'a pas de type énuméré, et
        # une table de référence pour quatre valeurs câblées dans le calcul
        # n'aurait rien rendu extensible.
        batch_op.add_column(
            sa.Column("frequence_remuneration", sa.String(), nullable=True)
        )
        batch_op.add_column(sa.Column("remuneration_debut", sa.Date(), nullable=True))


def downgrade():
    with op.batch_alter_table("compte", schema=None) as batch_op:
        batch_op.drop_column("remuneration_debut")
        batch_op.drop_column("frequence_remuneration")
        batch_op.drop_column("taux_remuneration")
