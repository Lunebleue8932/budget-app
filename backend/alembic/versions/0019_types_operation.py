"""sépare les types d'opération des catégories.

Jusqu'ici le "type" d'une opération n'existait pas en base : il se déduisait du
couple (nom de la catégorie, booléen `remboursable`). Quatre des six types
étaient des « catégories système » rangées avec les vraies catégories de
dépense, les deux autres n'étaient qu'un booléen.

Cette migration crée `type_operation` (6 lignes, clé technique `code` stable +
libellé `nom` renommable), y rattache chaque opération, et retire de `categorie`
les quatre catégories système ainsi que le drapeau `systeme` devenu inutile.

Sont également reciblés vers un type :
 - les correspondances d'import qui visaient une catégorie système
   (« Mouvements internes créditeurs » → Virement interne) ;
 - les règles de catégorisation, dont le type était stocké en chaîne.

Revision ID: 0019
Revises: 0018
Create Date: 2026-08-01
"""
from alembic import op
import sqlalchemy as sa

revision = "0019"
down_revision = "0018"
branch_labels = None
depends_on = None

# code technique, libellé initial, ordre d'affichage
TYPES = [
    ("classique", "Opération classique", 0),
    ("remboursable", "Dépense remboursable", 1),
    ("remboursements", "Remboursement reçu", 2),
    ("virement", "Virement interne", 3),
    ("pret", "Prêt reçu", 4),
    ("remboursement_pret", "Remboursement prêt", 5),
]

# Ancienne catégorie système -> code du type qui la remplace.
CATEGORIE_SYSTEME_VERS_TYPE = {
    "Remboursements": "remboursements",
    "Virement interne": "virement",
    "Prêts": "pret",
    "Remboursement prêts": "remboursement_pret",
}


def upgrade():
    connexion = op.get_bind()

    op.create_table(
        "type_operation",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column("code", sa.String, nullable=False, unique=True),
        sa.Column("nom", sa.String, nullable=False),
        sa.Column("ordre", sa.Integer, nullable=False, server_default="0"),
    )
    for code, nom, ordre in TYPES:
        connexion.execute(
            sa.text(
                "INSERT INTO type_operation (code, nom, ordre) VALUES (:code, :nom, :ordre)"
            ),
            {"code": code, "nom": nom, "ordre": ordre},
        )

    ids_types = {
        code: id_
        for id_, code in connexion.execute(sa.text("SELECT id, code FROM type_operation")).fetchall()
    }

    # ---------- Opérations ----------
    with op.batch_alter_table("operation", schema=None) as batch_op:
        batch_op.add_column(sa.Column("type_id", sa.Integer, nullable=True))

    # Le nom de la catégorie porte le type pour 4 cas ; `virement_id` rattrape
    # les virements importés dont un seul compte est connu (ils peuvent avoir
    # une autre catégorie tout en étant bel et bien des virements).
    connexion.execute(
        sa.text(
            "UPDATE operation SET type_id = :type_id "
            "WHERE virement_id IS NOT NULL "
            "   OR categorie_id = (SELECT id FROM categorie WHERE nom = 'Virement interne')"
        ),
        {"type_id": ids_types["virement"]},
    )
    for nom_categorie, code in CATEGORIE_SYSTEME_VERS_TYPE.items():
        if code == "virement":
            continue  # déjà traité ci-dessus, avec le cas virement_id
        connexion.execute(
            sa.text(
                "UPDATE operation SET type_id = :type_id "
                "WHERE type_id IS NULL "
                "  AND categorie_id = (SELECT id FROM categorie WHERE nom = :nom)"
            ),
            {"type_id": ids_types[code], "nom": nom_categorie},
        )
    connexion.execute(
        sa.text(
            "UPDATE operation SET type_id = :type_id WHERE type_id IS NULL AND remboursable = 1"
        ),
        {"type_id": ids_types["remboursable"]},
    )
    connexion.execute(
        sa.text("UPDATE operation SET type_id = :type_id WHERE type_id IS NULL"),
        {"type_id": ids_types["classique"]},
    )

    with op.batch_alter_table("operation", schema=None) as batch_op:
        batch_op.alter_column("type_id", existing_type=sa.Integer, nullable=False)
        batch_op.alter_column("categorie_id", existing_type=sa.Integer, nullable=True)
        batch_op.create_foreign_key("fk_operation_type", "type_operation", ["type_id"], ["id"])
        batch_op.create_index("ix_operation_type_id", ["type_id"])
        batch_op.drop_column("remboursable")

    # La catégorie des quatre types imposés n'a plus lieu d'être : c'est le type
    # qui porte l'information. Doit venir APRÈS le passage de la colonne en
    # nullable ci-dessus -- sur une base contenant déjà des opérations de ces
    # types (catégorie système ou remboursable=1), la mettre à NULL pendant
    # que la colonne est encore NOT NULL lève IntegrityError.
    connexion.execute(
        sa.text(
            "UPDATE operation SET categorie_id = NULL WHERE type_id IN "
            "(SELECT id FROM type_operation WHERE code NOT IN ('classique', 'remboursable'))"
        )
    )

    # ---------- Correspondances d'import ----------
    with op.batch_alter_table("import_categorie_mapping", schema=None) as batch_op:
        batch_op.add_column(sa.Column("type_id", sa.Integer, nullable=True))
        batch_op.alter_column("categorie_id", existing_type=sa.Integer, nullable=True)
        batch_op.create_foreign_key(
            "fk_import_categorie_mapping_type",
            "type_operation",
            ["type_id"],
            ["id"],
            ondelete="CASCADE",
        )

    for nom_categorie, code in CATEGORIE_SYSTEME_VERS_TYPE.items():
        connexion.execute(
            sa.text(
                "UPDATE import_categorie_mapping SET type_id = :type_id, categorie_id = NULL "
                "WHERE categorie_id = (SELECT id FROM categorie WHERE nom = :nom)"
            ),
            {"type_id": ids_types[code], "nom": nom_categorie},
        )

    # ---------- Règles de catégorisation ----------
    with op.batch_alter_table("regle_categorisation", schema=None) as batch_op:
        batch_op.add_column(sa.Column("type_id", sa.Integer, nullable=True))

    connexion.execute(
        sa.text(
            "UPDATE regle_categorisation SET type_id = "
            "(SELECT id FROM type_operation WHERE code = regle_categorisation.type_operation)"
        )
    )
    # Filet : une règle dont le type serait illisible retombe sur "classique"
    # plutôt que de bloquer la migration sur une contrainte NOT NULL.
    connexion.execute(
        sa.text("UPDATE regle_categorisation SET type_id = :type_id WHERE type_id IS NULL"),
        {"type_id": ids_types["classique"]},
    )

    with op.batch_alter_table("regle_categorisation", schema=None) as batch_op:
        batch_op.alter_column("type_id", existing_type=sa.Integer, nullable=False)
        batch_op.create_foreign_key(
            "fk_regle_categorisation_type",
            "type_operation",
            ["type_id"],
            ["id"],
            ondelete="CASCADE",
        )
        batch_op.drop_column("type_operation")

    # ---------- Catégories ----------
    # Après le passage à NULL ci-dessus, plus aucune opération ne les référence.
    for nom_categorie in CATEGORIE_SYSTEME_VERS_TYPE:
        connexion.execute(
            sa.text("DELETE FROM categorie WHERE nom = :nom"), {"nom": nom_categorie}
        )

    with op.batch_alter_table("categorie", schema=None) as batch_op:
        batch_op.drop_column("systeme")


def downgrade():
    connexion = op.get_bind()

    with op.batch_alter_table("categorie", schema=None) as batch_op:
        batch_op.add_column(
            sa.Column("systeme", sa.Boolean, nullable=False, server_default=sa.false())
        )

    ordre_max = connexion.execute(sa.text("SELECT COALESCE(MAX(ordre), 0) FROM categorie")).scalar()
    for decalage, nom_categorie in enumerate(CATEGORIE_SYSTEME_VERS_TYPE, start=1):
        connexion.execute(
            sa.text(
                "INSERT INTO categorie (nom, systeme, ordre) VALUES (:nom, 1, :ordre)"
            ),
            {"nom": nom_categorie, "ordre": ordre_max + decalage},
        )

    # ---------- Règles ----------
    with op.batch_alter_table("regle_categorisation", schema=None) as batch_op:
        batch_op.add_column(
            sa.Column("type_operation", sa.String, nullable=False, server_default="classique")
        )
    connexion.execute(
        sa.text(
            "UPDATE regle_categorisation SET type_operation = "
            "(SELECT code FROM type_operation WHERE id = regle_categorisation.type_id)"
        )
    )
    with op.batch_alter_table("regle_categorisation", schema=None) as batch_op:
        batch_op.drop_constraint("fk_regle_categorisation_type", type_="foreignkey")
        batch_op.drop_column("type_id")

    # ---------- Correspondances d'import ----------
    for nom_categorie, code in CATEGORIE_SYSTEME_VERS_TYPE.items():
        connexion.execute(
            sa.text(
                "UPDATE import_categorie_mapping "
                "SET categorie_id = (SELECT id FROM categorie WHERE nom = :nom) "
                "WHERE type_id = (SELECT id FROM type_operation WHERE code = :code)"
            ),
            {"nom": nom_categorie, "code": code},
        )
    with op.batch_alter_table("import_categorie_mapping", schema=None) as batch_op:
        batch_op.drop_constraint("fk_import_categorie_mapping_type", type_="foreignkey")
        batch_op.drop_column("type_id")
        batch_op.alter_column("categorie_id", existing_type=sa.Integer, nullable=False)

    # ---------- Opérations ----------
    with op.batch_alter_table("operation", schema=None) as batch_op:
        batch_op.add_column(
            sa.Column("remboursable", sa.Boolean, nullable=False, server_default=sa.false())
        )
    connexion.execute(
        sa.text(
            "UPDATE operation SET remboursable = 1 WHERE type_id IN "
            "(SELECT id FROM type_operation WHERE code IN ('remboursable', 'pret'))"
        )
    )
    # Les opérations sans catégorie retrouvent la catégorie système de leur type.
    for nom_categorie, code in CATEGORIE_SYSTEME_VERS_TYPE.items():
        connexion.execute(
            sa.text(
                "UPDATE operation "
                "SET categorie_id = (SELECT id FROM categorie WHERE nom = :nom) "
                "WHERE categorie_id IS NULL "
                "  AND type_id = (SELECT id FROM type_operation WHERE code = :code)"
            ),
            {"nom": nom_categorie, "code": code},
        )

    with op.batch_alter_table("operation", schema=None) as batch_op:
        batch_op.drop_index("ix_operation_type_id")
        batch_op.drop_constraint("fk_operation_type", type_="foreignkey")
        batch_op.drop_column("type_id")
        batch_op.alter_column("categorie_id", existing_type=sa.Integer, nullable=False)

    op.drop_table("type_operation")
