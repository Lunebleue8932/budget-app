"""Un preset de placements peut lire une PHOTOGRAPHIE du compte.

Jusqu'ici un fichier de placements ne pouvait raconter qu'une chose : une liste
de mouvements, achats, ventes et transferts d'espèces, chacun daté. C'est ce
qu'exporte un relevé d'opérations — et ce n'est pas ce qu'exporte un relevé de
POSITION, qui donne une ligne par titre détenu avec sa quantité et son prix de
revient, sans aucune date.

Les deux sont utiles, et pour des moments différents : la liste d'opérations
rejoue l'histoire, la photographie constate l'état. C'est la photographie qu'on
veut quand on arrive avec un portefeuille déjà constitué et qu'on n'a pas envie
de réimporter dix ans de mouvements pour retrouver ce qu'on détient aujourd'hui.

UNE COLONNE, PAS UNE TABLE. Tout ce qui entoure la lecture est rigoureusement
identique d'un mode à l'autre : le preset et ses colonnes, les correspondances,
l'historique, l'annulation, le stock anti-doublons. Seuls changent les colonnes
qu'on lit et ce qu'une ligne veut dire. Dédoubler quoi que ce soit pour cela
aurait dupliqué toute la mécanique pour un aiguillage.

ET PAS UN TROISIÈME DOMAINE non plus (`import_preset.domaine`, migration 0041) :
le domaine cloisonne des ÉCRANS — le routeur bancaire ne voit pas les presets de
placements. Ici les deux modes vivent dans le MÊME écran et se choisissent dans
la configuration du fichier, comme un numéro de colonne.

NULLABLE, ET NULL VAUT « operations » : c'est ce que sont tous les presets déjà
en base, et le seul mode qui existait. Aucune valeur n'est inventée, rien ne
change pour un preset existant.

Revision ID: 0046
Revises: 0045
Create Date: 2026-08-29
"""
from alembic import op
import sqlalchemy as sa

revision = "0046"
down_revision = "0045"
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table("import_preset", schema=None) as batch_op:
        # Une chaîne contrainte par l'enum Python (constants.ModeLecturePlacement),
        # comme partout ailleurs dans ce schéma : SQLite n'a pas de type énuméré.
        batch_op.add_column(sa.Column("mode_lecture", sa.String(), nullable=True))


def downgrade():
    with op.batch_alter_table("import_preset", schema=None) as batch_op:
        batch_op.drop_column("mode_lecture")
