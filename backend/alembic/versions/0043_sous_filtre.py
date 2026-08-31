"""Regrouper des opérations par projet, voyage ou événement.

CE QUE CETTE TABLE N'EST PAS : une catégorie de plus. Une catégorie classe une
dépense par NATURE — une seule, et elle porte un budget mensuel. Un projet
regroupe par ÉVÉNEMENT, à travers les catégories et les comptes : le billet de
train, l'hôtel et les courses d'un même voyage restent chacun dans leur
catégorie, et se retrouvent ensemble dans « Vacances Italie ».

C'est pour cette raison que le lien est MULTIPLE (table d'association, pas
colonne sur `operation`) : les courses du 12 août sont légitimement à la fois
dans « Vacances Italie » et dans « Anniversaire de Marie », là où leur catégorie
est unique par construction. Une colonne aurait forcé à choisir, ou à créer une
catégorie par événement — ce qui aurait pollué le budget mensuel de catégories
qui n'ont de sens que trois semaines par an.

RIEN NE SE CALCULE À PARTIR D'UN PROJET : ni solde, ni budget, ni KPI du
dashboard. Le total d'un projet est une somme affichée, jamais une donnée qui
influe sur le reste — c'est ce qui permet à une opération d'appartenir à trois
projets sans être comptée trois fois nulle part.

LES DEUX CASCADES sont dans le sens de ce qu'un projet est. Supprimer une
opération ou un projet retire les liens qui les nommaient, et rien d'autre :
supprimer « Vacances Italie » ne touche à aucune dépense, un projet n'étant
qu'une vue sur des opérations qui existent sans lui.

LA TABLE EST DANS LE NOYAU, l'écran dans l'extension « Projets » : une extension
n'emporte jamais son schéma (cf. extensions/README.md). L'éteindre masque
l'écran, sans perdre un seul regroupement.

Revision ID: 0043
Revises: 0042
Create Date: 2026-08-29
"""
from alembic import op
import sqlalchemy as sa

revision = "0043"
down_revision = "0042"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "sous_filtre",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("nom", sa.String(), nullable=False),
        # Ce que le projet recouvre, en une phrase. Sans sémantique : jamais
        # lue, ni filtrée, ni sommée. NOT NULL avec un défaut vide plutôt que
        # NULL, pour n'avoir qu'une seule façon de dire « rien ».
        sa.Column("description", sa.Text(), nullable=False, server_default=""),
        sa.Column("ordre", sa.Integer(), nullable=False, server_default="0"),
        sa.PrimaryKeyConstraint("id"),
        # Deux projets du même nom seraient indiscernables dans la liste où on
        # les choisit — et le nom est tout ce qu'un projet a d'identifiant pour
        # l'utilisateur.
        sa.UniqueConstraint("nom", name="uq_sous_filtre_nom"),
    )

    op.create_table(
        "operation_sous_filtre",
        sa.Column("operation_id", sa.Integer(), nullable=False),
        sa.Column("sous_filtre_id", sa.Integer(), nullable=False),
        sa.ForeignKeyConstraint(["operation_id"], ["operation.id"], ondelete="CASCADE"),
        sa.ForeignKeyConstraint(["sous_filtre_id"], ["sous_filtre.id"], ondelete="CASCADE"),
        # La clé primaire composite EST la règle « une opération ne figure
        # qu'une fois dans un projet » : ajouter deux fois la même n'a pas de
        # sens et ne doit pas pouvoir s'écrire.
        sa.PrimaryKeyConstraint("operation_id", "sous_filtre_id"),
    )
    # L'écran d'un projet part TOUJOURS du projet vers ses opérations : c'est ce
    # parcours-là qu'il faut indexer. Le sens inverse (les projets d'une
    # opération) est déjà servi par la clé primaire, dont `operation_id` est la
    # première colonne.
    op.create_index(
        "ix_operation_sous_filtre_sous_filtre",
        "operation_sous_filtre",
        ["sous_filtre_id"],
    )


def downgrade():
    op.drop_index(
        "ix_operation_sous_filtre_sous_filtre", table_name="operation_sous_filtre"
    )
    op.drop_table("operation_sous_filtre")
    op.drop_table("sous_filtre")
