"""Une zone « Amérique du Nord (hors États-Unis) », pour le Canada.

CE QUI CHANGE. La carte de la vue d'ensemble sépare désormais le Canada du reste de l'Amérique hors États-Unis
(Mexique, Amérique centrale, Caraïbes, Amérique du Sud), et le Groenland passe en Europe. Les zones livrées
étaient exclusives (cf. constants.ZONES_INITIALES) : il manquait celle du Canada.

CE QUE FAIT LA MIGRATION. Elle ajoute la zone « Amérique du Nord (hors États-Unis) » à la liste des zones, SI elle
n'y est pas déjà. Elle ne touche à aucune répartition : un fonds qui avait du Canada dans « Amérique (hors
États-Unis) » l'y garde, et n'a rien à refaire tant qu'il ne veut pas séparer.

DESCENTE. La zone est retirée si aucun titre ne l'utilise.

Revision ID: 0095
Revises: 0094
Create Date: 2026-10-25
"""
from alembic import op
import sqlalchemy as sa

revision = "0095"
down_revision = "0094"
branch_labels = None
depends_on = None

ZONE = "Amérique du Nord (hors États-Unis)"


def upgrade() -> None:
    connexion = op.get_bind()
    existe = connexion.execute(
        sa.text("SELECT 1 FROM type_titre WHERE axe = 'zone' AND nom = :nom"), {"nom": ZONE}
    ).fetchone()
    if not existe:
        connexion.execute(sa.text("INSERT INTO type_titre (nom, axe) VALUES (:nom, 'zone')"), {"nom": ZONE})


def downgrade() -> None:
    connexion = op.get_bind()
    connexion.execute(
        sa.text(
            "DELETE FROM type_titre WHERE axe = 'zone' AND nom = :nom "
            "AND id NOT IN (SELECT type_titre_id FROM exposition_titre)"
        ),
        {"nom": ZONE},
    )
