"""l'action d'une règle de catégorisation se choisit désormais en deux temps,
comme partout ailleurs dans l'app : d'abord le type d'opération, puis (pour
les seuls types à catégorie libre : classique et remboursable) la catégorie.

Remplace donc `remboursable` par `type_operation` :
 - remboursable=True                      -> "remboursable"
 - catégorie système Prêts / Remboursements / Remboursement prêts / Virement
   interne                                -> le type correspondant, catégorie
                                             remise à NULL (imposée par le type)
 - tout le reste                          -> "classique"

Revision ID: 0018
Revises: 0017
Create Date: 2026-08-01
"""
from alembic import op
import sqlalchemy as sa

revision = "0018"
down_revision = "0017"
branch_labels = None
depends_on = None

# Le type ne peut pas être déduit en SQL pur (il dépend du nom de la catégorie
# liée) : la conversion se fait ligne à ligne ci-dessous.
_CATEGORIE_VERS_TYPE = {
    "Remboursements": "remboursements",
    "Virement interne": "virement",
    "Prêts": "pret",
    "Remboursement prêts": "remboursement_pret",
}


def upgrade():
    connexion = op.get_bind()

    with op.batch_alter_table("regle_categorisation", schema=None) as batch_op:
        batch_op.add_column(
            sa.Column(
                "type_operation", sa.String, nullable=False, server_default="classique"
            )
        )

    lignes = connexion.execute(
        sa.text(
            "SELECT r.id, r.remboursable, c.nom "
            "FROM regle_categorisation r "
            "LEFT JOIN categorie c ON c.id = r.categorie_id"
        )
    ).fetchall()

    for regle_id, remboursable, nom_categorie in lignes:
        type_systeme = _CATEGORIE_VERS_TYPE.get(nom_categorie)
        if type_systeme is not None:
            # La catégorie était système : c'est elle qui portait le type.
            # Elle devient redondante avec type_operation.
            connexion.execute(
                sa.text(
                    "UPDATE regle_categorisation "
                    "SET type_operation = :type, categorie_id = NULL WHERE id = :id"
                ),
                {"type": type_systeme, "id": regle_id},
            )
        else:
            connexion.execute(
                sa.text("UPDATE regle_categorisation SET type_operation = :type WHERE id = :id"),
                {"type": "remboursable" if remboursable else "classique", "id": regle_id},
            )

    with op.batch_alter_table("regle_categorisation", schema=None) as batch_op:
        batch_op.drop_column("remboursable")


def downgrade():
    connexion = op.get_bind()

    with op.batch_alter_table("regle_categorisation", schema=None) as batch_op:
        batch_op.add_column(sa.Column("remboursable", sa.Boolean, nullable=True))

    connexion.execute(
        sa.text(
            "UPDATE regle_categorisation "
            "SET remboursable = (type_operation IN ('remboursable', 'pret'))"
        )
    )
    # Les types système reprennent leur catégorie, seul support du type avant 0018.
    for nom_categorie, type_systeme in _CATEGORIE_VERS_TYPE.items():
        connexion.execute(
            sa.text(
                "UPDATE regle_categorisation "
                "SET categorie_id = (SELECT id FROM categorie WHERE nom = :nom) "
                "WHERE type_operation = :type"
            ),
            {"nom": nom_categorie, "type": type_systeme},
        )

    with op.batch_alter_table("regle_categorisation", schema=None) as batch_op:
        batch_op.drop_column("type_operation")
