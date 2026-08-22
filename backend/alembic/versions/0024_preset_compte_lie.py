"""un preset d'import peut être lié à un compte bancaire.

Beaucoup de relevés sont l'export d'UN compte précis : ils ne nomment donc
nulle part le compte concerné, et il n'y a aucune colonne à mapper. Jusqu'ici
la seule réponse était le sélecteur « compte pour ce fichier », à re-choisir à
chaque import — un oubli et toutes les lignes tombaient en erreur.

`import_preset.compte_id` mémorise ce choix une fois pour toutes. Renseigné, il
s'impose à toutes les lignes du fichier (cf.
services/import_bancaire._resoudre_ligne) ; les virements internes restent
correctement orientés, ce compte étant déduit émetteur ou récepteur du signe du
montant comme n'importe quel compte résolu par colonne.

NULL par défaut : les presets existants gardent exactement le comportement
d'avant. ON DELETE SET NULL plutôt que CASCADE — supprimer un compte ne doit pas
emporter le format d'import de sa banque, son historique et son stock
anti-doublons ; le preset redevient simplement non lié.

Revision ID: 0024
Revises: 0023
Create Date: 2026-08-06
"""
from alembic import op
import sqlalchemy as sa

revision = "0024"
down_revision = "0023"
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table("import_preset", schema=None) as batch_op:
        batch_op.add_column(sa.Column("compte_id", sa.Integer, nullable=True))
        batch_op.create_foreign_key(
            "fk_import_preset_compte",
            "compte",
            ["compte_id"],
            ["id"],
            ondelete="SET NULL",
        )


def downgrade():
    with op.batch_alter_table("import_preset", schema=None) as batch_op:
        batch_op.drop_constraint("fk_import_preset_compte", type_="foreignkey")
        batch_op.drop_column("compte_id")
