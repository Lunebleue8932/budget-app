"""ajoute import_preset (un format de relevé bancaire nommé, typiquement un
par banque) : fusionne l'actuelle import_configuration (qui disparaît) et
scope dessus les mappings catégorie/compte, l'historique et le stock de
doublons (ligne_import_brute) -- deux formats différents ne doivent jamais se
comparer entre eux. La configuration/l'historique/le stock existants
deviennent le premier preset "Défaut", rien n'est perdu.

Revision ID: 0014
Revises: 0013
Create Date: 2026-07-24
"""
import json

from alembic import op
import sqlalchemy as sa

revision = "0014"
down_revision = "0013"
branch_labels = None
depends_on = None

# Reprise telle quelle de la configuration par défaut historique (cf. 0011),
# utilisée seulement si import_configuration n'a jamais été initialisée.
COLONNES_PAR_DEFAUT = [
    {"index": 1, "propriete": "date"},
    {"index": 4, "propriete": "nature"},
    {"index": 6, "propriete": "categorie_banque"},
    {"index": 7, "propriete": "montant"},
    {"index": 10, "propriete": "compte_banque"},
]


def upgrade():
    conn = op.get_bind()

    op.create_table(
        "import_preset",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column("nom", sa.String, nullable=False, unique=True),
        sa.Column("colonnes", sa.JSON, nullable=False),
        sa.Column("colonnes_exclues_comparaison", sa.JSON, nullable=False, server_default="[]"),
    )

    ligne_config = conn.execute(
        sa.text("SELECT colonnes, colonnes_exclues_comparaison FROM import_configuration LIMIT 1")
    ).first()
    if ligne_config is not None:
        colonnes, colonnes_exclues = ligne_config
    else:
        colonnes, colonnes_exclues = json.dumps(COLONNES_PAR_DEFAUT), "[]"
    conn.execute(
        sa.text(
            "INSERT INTO import_preset (nom, colonnes, colonnes_exclues_comparaison) "
            "VALUES ('Défaut', :colonnes, :colonnes_exclues)"
        ),
        {"colonnes": colonnes, "colonnes_exclues": colonnes_exclues},
    )
    preset_id = conn.execute(sa.text("SELECT id FROM import_preset WHERE nom = 'Défaut'")).scalar()

    # import_categorie_mapping / import_compte_mapping : l'unicité portait
    # jusqu'ici sur nom_banque seul (colonne unique=True) ; elle doit devenir
    # composite (preset_id, nom_banque). Recréées entièrement plutôt
    # qu'altérées, plus simple et fiable sous SQLite qu'un ALTER de contrainte
    # unique implicite.
    op.rename_table("import_categorie_mapping", "import_categorie_mapping_old")
    op.create_table(
        "import_categorie_mapping",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column(
            "preset_id", sa.Integer, sa.ForeignKey("import_preset.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column("nom_banque", sa.String, nullable=False),
        sa.Column(
            "categorie_id", sa.Integer, sa.ForeignKey("categorie.id", ondelete="CASCADE"), nullable=False
        ),
        sa.UniqueConstraint("preset_id", "nom_banque", name="uq_import_categorie_mapping_preset_nom"),
    )
    conn.execute(
        sa.text(
            "INSERT INTO import_categorie_mapping (preset_id, nom_banque, categorie_id) "
            "SELECT :preset_id, nom_banque, categorie_id FROM import_categorie_mapping_old"
        ),
        {"preset_id": preset_id},
    )
    op.drop_table("import_categorie_mapping_old")

    op.rename_table("import_compte_mapping", "import_compte_mapping_old")
    op.create_table(
        "import_compte_mapping",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column(
            "preset_id", sa.Integer, sa.ForeignKey("import_preset.id", ondelete="CASCADE"), nullable=False
        ),
        sa.Column("nom_banque", sa.String, nullable=False),
        sa.Column(
            "compte_id", sa.Integer, sa.ForeignKey("compte.id", ondelete="CASCADE"), nullable=False
        ),
        sa.UniqueConstraint("preset_id", "nom_banque", name="uq_import_compte_mapping_preset_nom"),
    )
    conn.execute(
        sa.text(
            "INSERT INTO import_compte_mapping (preset_id, nom_banque, compte_id) "
            "SELECT :preset_id, nom_banque, compte_id FROM import_compte_mapping_old"
        ),
        {"preset_id": preset_id},
    )
    op.drop_table("import_compte_mapping_old")

    with op.batch_alter_table("import_historique", schema=None) as batch_op:
        batch_op.add_column(sa.Column("preset_id", sa.Integer, nullable=True))
    conn.execute(sa.text("UPDATE import_historique SET preset_id = :preset_id"), {"preset_id": preset_id})
    with op.batch_alter_table("import_historique", schema=None) as batch_op:
        batch_op.alter_column("preset_id", existing_type=sa.Integer, nullable=False)
        batch_op.create_foreign_key(
            "fk_import_historique_preset", "import_preset", ["preset_id"], ["id"], ondelete="CASCADE"
        )
        batch_op.create_index("ix_import_historique_preset", ["preset_id"])

    with op.batch_alter_table("ligne_import_brute", schema=None) as batch_op:
        batch_op.add_column(sa.Column("preset_id", sa.Integer, nullable=True))
    conn.execute(sa.text("UPDATE ligne_import_brute SET preset_id = :preset_id"), {"preset_id": preset_id})
    with op.batch_alter_table("ligne_import_brute", schema=None) as batch_op:
        batch_op.alter_column("preset_id", existing_type=sa.Integer, nullable=False)
        batch_op.create_foreign_key(
            "fk_ligne_import_brute_preset", "import_preset", ["preset_id"], ["id"], ondelete="CASCADE"
        )
        batch_op.create_index("ix_ligne_import_brute_preset", ["preset_id"])

    op.drop_table("import_configuration")


def downgrade():
    conn = op.get_bind()

    op.create_table(
        "import_configuration",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column("colonnes", sa.JSON, nullable=False),
        sa.Column("colonnes_exclues_comparaison", sa.JSON, nullable=False, server_default="[]"),
    )
    premier_preset = conn.execute(
        sa.text("SELECT colonnes, colonnes_exclues_comparaison FROM import_preset ORDER BY id LIMIT 1")
    ).first()
    if premier_preset is not None:
        colonnes, colonnes_exclues = premier_preset
        conn.execute(
            sa.text(
                "INSERT INTO import_configuration (colonnes, colonnes_exclues_comparaison) "
                "VALUES (:colonnes, :colonnes_exclues)"
            ),
            {"colonnes": colonnes, "colonnes_exclues": colonnes_exclues},
        )

    with op.batch_alter_table("ligne_import_brute", schema=None) as batch_op:
        batch_op.drop_index("ix_ligne_import_brute_preset")
        batch_op.drop_constraint("fk_ligne_import_brute_preset", type_="foreignkey")
        batch_op.drop_column("preset_id")

    with op.batch_alter_table("import_historique", schema=None) as batch_op:
        batch_op.drop_index("ix_import_historique_preset")
        batch_op.drop_constraint("fk_import_historique_preset", type_="foreignkey")
        batch_op.drop_column("preset_id")

    # Mappings : plusieurs presets peuvent avoir mappé le même nom_banque --
    # un downgrade ne peut que collapser arbitrairement (dernier gagne), la
    # notion de preset elle-même disparaissant.
    op.rename_table("import_compte_mapping", "import_compte_mapping_new")
    op.create_table(
        "import_compte_mapping",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column("nom_banque", sa.String, nullable=False, unique=True),
        sa.Column(
            "compte_id", sa.Integer, sa.ForeignKey("compte.id", ondelete="CASCADE"), nullable=False
        ),
    )
    conn.execute(
        sa.text(
            "INSERT INTO import_compte_mapping (nom_banque, compte_id) "
            "SELECT nom_banque, MAX(compte_id) FROM import_compte_mapping_new GROUP BY nom_banque"
        )
    )
    op.drop_table("import_compte_mapping_new")

    op.rename_table("import_categorie_mapping", "import_categorie_mapping_new")
    op.create_table(
        "import_categorie_mapping",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column("nom_banque", sa.String, nullable=False, unique=True),
        sa.Column(
            "categorie_id", sa.Integer, sa.ForeignKey("categorie.id", ondelete="CASCADE"), nullable=False
        ),
    )
    conn.execute(
        sa.text(
            "INSERT INTO import_categorie_mapping (nom_banque, categorie_id) "
            "SELECT nom_banque, MAX(categorie_id) FROM import_categorie_mapping_new GROUP BY nom_banque"
        )
    )
    op.drop_table("import_categorie_mapping_new")

    op.drop_table("import_preset")
