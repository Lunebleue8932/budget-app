"""remplace l'enum figé compte.type par une table type_compte gérable par
l'utilisateur (courant/épargne protégés en systeme=True, pilotent toujours le
dashboard et les règles de virement) ; supprime categorie_compte (fusionnée
dans ce même concept de type) et operation.verifie (la vérification se fait
désormais dans l'aperçu d'import, avant création des opérations)

Revision ID: 0012
Revises: 0011
Create Date: 2026-07-13
"""
from alembic import op
import sqlalchemy as sa

revision = "0012"
down_revision = "0011"
branch_labels = None
depends_on = None


def upgrade():
    conn = op.get_bind()

    op.create_table(
        "type_compte",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column("nom", sa.String, nullable=False, unique=True),
        sa.Column("systeme", sa.Boolean, nullable=False, server_default=sa.true()),
    )
    conn.execute(
        sa.text(
            "INSERT INTO type_compte (nom, systeme) VALUES ('courant', 1), ('épargne', 1)"
        )
    )

    with op.batch_alter_table("compte", schema=None) as batch_op:
        batch_op.add_column(sa.Column("type_id", sa.Integer, nullable=True))

    conn.execute(
        sa.text(
            "UPDATE compte SET type_id = "
            "(SELECT id FROM type_compte WHERE type_compte.nom = compte.type)"
        )
    )

    with op.batch_alter_table("compte", schema=None) as batch_op:
        batch_op.alter_column("type_id", existing_type=sa.Integer, nullable=False)
        batch_op.create_foreign_key("fk_compte_type_id", "type_compte", ["type_id"], ["id"])
        batch_op.drop_constraint("ck_compte_type", type_="check")
        batch_op.drop_column("type")
        batch_op.drop_column("categorie_compte_id")

    op.drop_table("categorie_compte")

    with op.batch_alter_table("operation", schema=None) as batch_op:
        batch_op.drop_column("verifie")


def downgrade():
    with op.batch_alter_table("operation", schema=None) as batch_op:
        batch_op.add_column(
            sa.Column("verifie", sa.Boolean, nullable=False, server_default=sa.true())
        )

    op.create_table(
        "categorie_compte",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column("nom", sa.String, nullable=False, unique=True),
    )

    conn = op.get_bind()

    with op.batch_alter_table("compte", schema=None) as batch_op:
        batch_op.add_column(sa.Column("type", sa.String, nullable=True))
        batch_op.add_column(sa.Column("categorie_compte_id", sa.Integer, nullable=True))

    conn.execute(
        sa.text(
            "UPDATE compte SET type = "
            "(SELECT nom FROM type_compte WHERE type_compte.id = compte.type_id)"
        )
    )

    with op.batch_alter_table("compte", schema=None) as batch_op:
        batch_op.alter_column("type", existing_type=sa.String, nullable=False)
        batch_op.create_check_constraint("ck_compte_type", "type IN ('courant', 'épargne')")
        batch_op.create_foreign_key(
            "fk_compte_categorie_compte_id",
            "categorie_compte",
            ["categorie_compte_id"],
            ["id"],
            ondelete="SET NULL",
        )
        batch_op.drop_constraint("fk_compte_type_id", type_="foreignkey")
        batch_op.drop_column("type_id")

    op.drop_table("type_compte")
