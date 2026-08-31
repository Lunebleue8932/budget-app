"""Des règles pour dire ce qu'une ligne de relevé de compte-titres décrit.

L'extension « import-placements » reconnaissait le type d'une ligne (achat,
vente, transfert d'espèces) par TROIS LISTES DE MOTS-CLÉS portées par le preset
(`import_preset.libelles_type_*`, migration 0041). Une liste fermée compare des
libellés ENTIERS : « Achat » est un achat, et rien d'autre ne l'est.

Cela suffit tant que le courtier écrit un mot par ligne. Beaucoup écrivent une
phrase — « ACHAT COMPTANT ETF MSCI WORLD », avec le nom du titre dedans — et
aucune liste de mots-clés ne peut alors reconnaître quoi que ce soit : il n'y a
pas deux fois le même libellé dans tout le fichier. Il faut pouvoir dire
« contient ACHAT », ce que cette table permet.

MÊME FORME QUE `regle_categorisation`, ET C'EST VOULU : mêmes conditions sur
deux niveaux, même JSON, même évaluateur (services/regles_categorisation), même
ordre d'évaluation. Ce qui change tient en une colonne : l'action. Une règle
bancaire pose un type d'opération et parfois une catégorie ; une règle de
placement ne pose que le type de placement, parce qu'une ligne de compte-titres
n'a rien d'autre à décider — d'où l'absence de `arreter_apres`, qui n'existe
côté bancaire que pour laisser deux règles se compléter.

GLOBALES, sans preset_id, comme les règles bancaires. Le vocabulaire, lui,
reste attaché au preset : c'est là qu'est la différence d'un courtier à
l'autre, et les deux mécanismes cohabitent — les règles sont consultées
d'abord, le vocabulaire ensuite pour les lignes qu'aucune règle ne reconnaît.
Une base qui n'a aucune règle se comporte donc exactement comme avant.

TABLE VIDE À LA CRÉATION : aucune règle n'est inventée à partir des
vocabulaires existants. Traduire « Achat » en « le type est Achat » aurait
produit une règle par mot-clé et par preset, que personne n'a demandée, dans un
écran où il aurait fallu ensuite faire le ménage.

Revision ID: 0042
Revises: 0041
Create Date: 2026-08-29
"""
from alembic import op
import sqlalchemy as sa

revision = "0042"
down_revision = "0041"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "regle_import_placement",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("nom", sa.String(), nullable=False),
        sa.Column("ordre", sa.Integer(), nullable=False, server_default="0"),
        sa.Column("actif", sa.Boolean(), nullable=False, server_default=sa.true()),
        # "achat" | "vente" | "transfert" (constants.TypeOperationPlacement).
        # Une chaîne, pas une FK : ces trois valeurs sont câblées dans le code
        # de l'import — chacune décide d'un traitement entièrement différent —
        # et une table ne les rendrait pas extensibles pour autant.
        sa.Column("type_placement", sa.String(), nullable=False),
        sa.Column("conditions", sa.JSON(), nullable=False),
        sa.PrimaryKeyConstraint("id"),
    )


def downgrade():
    op.drop_table("regle_import_placement")
