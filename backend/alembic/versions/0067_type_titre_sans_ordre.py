"""`type_titre.ordre` disparaît : il n'a jamais rien ordonné.

UNE COLONNE QUI DOUBLE LA CLÉ PRIMAIRE. Elle valait `max(ordre) + 1` à la
création et rien ne l'a jamais changée depuis : aucun écran ne propose de
réordonner les étiquettes de titre, aucune requête n'écrit ce champ, et le
`PUT /types-titre/{id}` l'acceptait sans que personne le lui envoie jamais.
Son ordre était donc, à chaque instant, celui des identifiants — avec en prime
le coût de le maintenir et le doute, à la relecture, de savoir lequel des deux
fait foi.

CE QUI LA DISTINGUE DE `categorie.ordre` ET DE `profil_remboursement.ordre`,
qui restent : ces deux-là se réordonnent VRAIMENT, à la poignée pour les
catégories, et l'ordre y est une décision de l'utilisateur. Une colonne d'ordre
ne se justifie que par le geste qui la change.

LE TRI PASSE SUR `id`, ce qui rend exactement la liste d'avant : l'ordre de
création, qu'aucun renommage ne bouscule. Une étiquette supprimée laisse un
trou dans la numérotation, comme elle en laissait un dans l'ordre.

Revision ID: 0067
Revises: 0066
Create Date: 2026-09-19
"""
from alembic import op
import sqlalchemy as sa

revision = "0067"
down_revision = "0066"
branch_labels = None
depends_on = None


def _table_type_titre(avec_ordre: bool) -> sa.Table:
    """La table telle qu'elle est AU MOMENT du batch — même procédé que la 0066.

    Explicite et non reflétée : la réflexion rapporterait les deux contraintes
    posées en 0066, et la recréation les reconduirait en double."""
    metadata = sa.MetaData()
    colonnes = [
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column("nom", sa.String, nullable=False),
        sa.Column("axe", sa.String, nullable=False, server_default="enveloppe"),
    ]
    if avec_ordre:
        colonnes.append(sa.Column("ordre", sa.Integer, nullable=False, server_default="0"))
    return sa.Table(
        "type_titre",
        metadata,
        *colonnes,
        sa.UniqueConstraint("axe", "nom", name="uq_type_titre_axe_nom"),
        sa.CheckConstraint("axe IN ('enveloppe', 'classe')", name="ck_type_titre_axe"),
    )


def upgrade():
    with op.batch_alter_table(
        "type_titre", copy_from=_table_type_titre(avec_ordre=True), schema=None
    ) as batch:
        batch.drop_column("ordre")


def downgrade():
    # LA COLONNE REVIENT AVEC L'ORDRE DES IDENTIFIANTS, c'est-à-dire exactement
    # ce qu'elle contenait : rien n'est perdu puisque rien n'y était propre.
    with op.batch_alter_table(
        "type_titre", copy_from=_table_type_titre(avec_ordre=False), schema=None
    ) as batch:
        batch.add_column(sa.Column("ordre", sa.Integer, nullable=False, server_default="0"))
    op.get_bind().execute(sa.text("UPDATE type_titre SET ordre = id"))
