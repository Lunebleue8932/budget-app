"""configuration avancée d'un preset d'import : colonnes supplémentaires,
formules de montant, et correspondances de monnaies.

Un relevé Wise ne dit nulle part « le montant de l'opération » : il décrit un
montant d'origine, des frais, un montant reçu, chacun avec sa propre devise.
Les cinq propriétés d'import historiques (date, nature, catégorie, montant,
compte) ne savent ni lire ces colonnes ni décider comment les combiner.

Trois ajouts, tous inertes pour les presets existants (valeurs vides par
défaut) :

 - `import_preset.colonnes_supplementaires` : des colonnes lues et nommées sans
   être rattachées à une propriété de l'app, uniquement pour être citées dans
   une formule et relues dans l'aperçu ;
 - `import_preset.formules` : le calcul du montant (d'origine, de destination,
   des frais) écrit par l'utilisateur façon tableur — « =C5+C6 » (voir
   services/formules_import.py). Sans formule, un montant vient directement de
   sa colonne, comme avant ;
 - `import_monnaie_mapping` : la même correspondance mémorisée que pour les
   catégories et les comptes, appliquée aux devises (« EUR » -> Euro). Sans
   elle, aucune colonne de devise ne pourrait être rattachée à une monnaie de
   l'app, et un virement importé retomberait sur la monnaie principale du
   compte — ce qui est faux dès qu'un compte en porte plusieurs.

Revision ID: 0023
Revises: 0022
Create Date: 2026-08-05
"""
from alembic import op
import sqlalchemy as sa

revision = "0023"
down_revision = "0022"
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table("import_preset", schema=None) as batch_op:
        batch_op.add_column(
            sa.Column(
                "colonnes_supplementaires", sa.JSON, nullable=False, server_default="[]"
            )
        )
        batch_op.add_column(
            sa.Column("formules", sa.JSON, nullable=False, server_default="{}")
        )

    op.create_table(
        "import_monnaie_mapping",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column(
            "preset_id",
            sa.Integer,
            sa.ForeignKey("import_preset.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("nom_banque", sa.String, nullable=False),
        sa.Column(
            "monnaie_id",
            sa.Integer,
            sa.ForeignKey("monnaie.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.UniqueConstraint(
            "preset_id", "nom_banque", name="uq_import_monnaie_mapping_preset_nom"
        ),
    )


def downgrade():
    # Les colonnes supplémentaires, les formules et les correspondances de
    # monnaies n'ont pas d'équivalent dans le schéma d'avant : elles
    # disparaissent. Les opérations déjà importées, elles, ne bougent pas —
    # elles ne référencent rien de tout ceci.
    op.drop_table("import_monnaie_mapping")
    with op.batch_alter_table("import_preset", schema=None) as batch_op:
        batch_op.drop_column("formules")
        batch_op.drop_column("colonnes_supplementaires")
