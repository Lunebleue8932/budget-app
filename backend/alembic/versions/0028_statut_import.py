"""colonne « État » : le vocabulaire des trois issues d'une ligne de relevé.

Une ligne importée était jusqu'ici forcément une transaction passée. Les relevés
de néobanques n'en restent pas là : ils listent aussi les autorisations en
attente et les paiements refusés, au milieu des autres. Les premières
devenaient des opérations réelles (un solde faux tant que l'opération n'était
pas réellement passée), les secondes des opérations qui n'avaient jamais eu lieu
— et qu'il fallait retrouver et supprimer à la main.

Trois listes de mots-clés par preset, vides par défaut : un preset qui ne lit
pas la colonne « État » se comporte exactement comme avant (tout est exécuté).

Revision ID: 0028
Revises: 0027
Create Date: 2026-08-07
"""
from alembic import op
import sqlalchemy as sa

revision = "0028"
down_revision = "0027"
branch_labels = None
depends_on = None

_COLONNES = (
    "libelles_statut_execute",
    "libelles_statut_attente",
    "libelles_statut_refuse",
)


def upgrade():
    with op.batch_alter_table("import_preset", schema=None) as batch_op:
        for nom in _COLONNES:
            batch_op.add_column(sa.Column(nom, sa.JSON, nullable=False, server_default="[]"))


def downgrade():
    # Les presets cessent de lire l'état : leurs lignes redeviennent toutes des
    # opérations réelles. Les opérations déjà importées, elles, gardent le
    # statut qu'elles ont reçu — rien à défaire de ce côté.
    with op.batch_alter_table("import_preset", schema=None) as batch_op:
        for nom in reversed(_COLONNES):
            batch_op.drop_column(nom)
