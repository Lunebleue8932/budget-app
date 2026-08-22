"""ordre d'affichage des comptes, au sein de leur type.

Les comptes étaient triés par nom côté serveur, sans recours : impossible de
mettre en tête le compte qu'on regarde tous les jours, ni de ranger ses cartes
du dashboard comme on les a en tête. Le glisser-déposer de la page Comptes ne
servait donc qu'à changer de type.

`compte.ordre` positionne un compte À L'INTÉRIEUR DE SON TYPE : les comptes se
lisent toujours groupés par type (cartes de la page Comptes, sections du
dashboard), un ordre global n'ordonnerait rien de visible.

Initialisation : l'ordre alphabétique d'avant, type par type — la migration ne
change donc aucun affichage, elle rend seulement l'ordre modifiable.

Revision ID: 0025
Revises: 0024
Create Date: 2026-08-06
"""
from alembic import op
import sqlalchemy as sa

revision = "0025"
down_revision = "0024"
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table("compte", schema=None) as batch_op:
        batch_op.add_column(
            sa.Column("ordre", sa.Integer, nullable=False, server_default="0")
        )

    connexion = op.get_bind()
    lignes = connexion.execute(
        sa.text("SELECT id, type_id FROM compte ORDER BY type_id, nom")
    ).fetchall()
    position_par_type: dict = {}
    for compte_id, type_id in lignes:
        position = position_par_type.get(type_id, 0)
        connexion.execute(
            sa.text("UPDATE compte SET ordre = :ordre WHERE id = :id"),
            {"ordre": position, "id": compte_id},
        )
        position_par_type[type_id] = position + 1


def downgrade():
    with op.batch_alter_table("compte", schema=None) as batch_op:
        batch_op.drop_column("ordre")
