"""Couleur d'une catégorie dans l'histogramme, attribuée une fois pour toutes.

La couleur se déduisait de la POSITION de la catégorie dans la liste affichée.
Trois gestes la changeaient donc sans que personne ne l'ait demandé : éteindre
une catégorie sur le dashboard (migration 0034), en réordonner la liste par
glisser-déposer, ou en supprimer une. Une barre qui change de couleur d'un mois
à l'autre ne se suit plus — c'est pourtant tout ce qu'on demande à une couleur
catégorielle.

`couleur_index` fixe donc l'attribution à la CRÉATION : la catégorie garde sa
couleur quoi qu'il arrive ensuite. Un index n'est réutilisé que lorsque la
catégorie qui le portait est supprimée (cf. crud._prochain_couleur_index, qui
prend le plus petit index libre).

Ce n'est pas une couleur mais un INDEX dans la palette : celle-ci vit côté
frontend (PALETTE_CATEGORIES), et la ranger en base y figerait un choix
d'affichage que le thème doit rester libre de changer. L'index tourne au-delà
de la taille de la palette, comme avant.

Rattrapage : l'ordre actuel fait foi, pour que l'histogramme d'aujourd'hui soit
exactement celui de demain.

Revision ID: 0035
Revises: 0034
Create Date: 2026-08-11
"""
from alembic import op
import sqlalchemy as sa

revision = "0035"
down_revision = "0034"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        "categorie",
        sa.Column("couleur_index", sa.Integer(), nullable=False, server_default="0"),
    )
    # Les couleurs déjà à l'écran sont celles de l'ordre d'affichage : on les
    # fige telles quelles plutôt que d'en tirer au sort de nouvelles.
    connexion = op.get_bind()
    lignes = connexion.execute(
        sa.text("SELECT id FROM categorie ORDER BY ordre, id")
    ).fetchall()
    for position, (categorie_id,) in enumerate(lignes):
        connexion.execute(
            sa.text("UPDATE categorie SET couleur_index = :i WHERE id = :id"),
            {"i": position, "id": categorie_id},
        )


def downgrade():
    op.drop_column("categorie", "couleur_index")
