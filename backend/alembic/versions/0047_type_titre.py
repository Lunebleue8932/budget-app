"""Un titre peut porter un TYPE (action, ETF, obligation…).

CE QUE C'EST : une étiquette, et rien de plus. L'utilisateur crée ses propres
libellés — « ETF », « Action en direct », « Obligation », « SCPI » — et les pose
sur ses titres. Aucun calcul de l'application ne les lit : ni un solde, ni une
valorisation, ni une plus-value. Ils servent à REGROUPER pour regarder, pas à
décider de quoi que ce soit.

UNE TABLE PLUTÔT QU'UNE COLONNE TEXTE. Un libellé libre saisi titre par titre
donnerait « ETF », « etf » et « E.T.F. » dans le même portefeuille, et le
camembert d'exposition en ferait trois parts. Une table impose l'unicité et rend
le renommage possible en un seul geste, comme pour `type_compte`.

PAS DE VALEURS INITIALES. Contrairement à `type_compte`, aucun type n'est créé
ici et aucun n'est protégé (`systeme`) : rien dans le code ne dépend d'un
libellé en particulier, il n'y a donc rien à protéger. Un portefeuille dont
aucun titre n'est typé est un cas normal, pas un cas à corriger.

FACULTATIF, ET LE RESTE. `action.type_titre_id` est NULL pour tous les titres
existants et pour tout titre créé sans qu'on choisisse : c'est une propriété
qu'on renseigne si elle sert. Le rendre obligatoire ferait payer à l'import et à
la saisie rapide une information dont la moitié des gens n'a pas l'usage.

SET NULL À LA SUPPRESSION : supprimer un type ne doit jamais emporter un titre,
qui porte des mouvements et des soldes réels. Les titres concernés redeviennent
simplement non typés.

Revision ID: 0047
Revises: 0046
Create Date: 2026-08-31
"""
from alembic import op
import sqlalchemy as sa

revision = "0047"
down_revision = "0046"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "type_titre",
        sa.Column("id", sa.Integer(), nullable=False),
        sa.Column("nom", sa.String(), nullable=False),
        sa.Column("ordre", sa.Integer(), nullable=False, server_default="0"),
        sa.PrimaryKeyConstraint("id"),
        sa.UniqueConstraint("nom", name="uq_type_titre_nom"),
    )
    with op.batch_alter_table("action", schema=None) as batch_op:
        batch_op.add_column(sa.Column("type_titre_id", sa.Integer(), nullable=True))
        batch_op.create_foreign_key(
            "fk_action_type_titre", "type_titre", ["type_titre_id"], ["id"], ondelete="SET NULL"
        )

    # Le type qu'une règle d'import pose sur le titre qu'elle reconnaît. NULL =
    # la règle ne dit rien du type, ce qui reste le cas de toutes les règles
    # existantes.
    with op.batch_alter_table("regle_import_placement", schema=None) as batch_op:
        batch_op.add_column(sa.Column("type_titre_id", sa.Integer(), nullable=True))
        batch_op.create_foreign_key(
            "fk_regle_import_placement_type_titre",
            "type_titre",
            ["type_titre_id"],
            ["id"],
            ondelete="SET NULL",
        )


def downgrade():
    with op.batch_alter_table("regle_import_placement", schema=None) as batch_op:
        batch_op.drop_constraint("fk_regle_import_placement_type_titre", type_="foreignkey")
        batch_op.drop_column("type_titre_id")
    with op.batch_alter_table("action", schema=None) as batch_op:
        batch_op.drop_constraint("fk_action_type_titre", type_="foreignkey")
        batch_op.drop_column("type_titre_id")
    op.drop_table("type_titre")
