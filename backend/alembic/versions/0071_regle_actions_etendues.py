"""Une règle d'import peut changer toute propriété d'une ligne, sauf ses montants.

CE QU'UNE RÈGLE SAVAIT FAIRE : poser un TYPE, puis une catégorie (ou une
découpe) et, pour un virement, le compte en face. Tout le reste d'une ligne
importée — son libellé surtout — ne pouvait se corriger qu'à la main, ligne par
ligne, à chaque import. Or c'est précisément le libellé qu'on a envie de
réécrire une fois pour toutes : « PRLV SEPA EDF SA 1234567 REF 88 » n'apprend
rien de plus que « EDF », et il revient tous les mois.

CINQ ACTIONS DE PLUS, toutes FACULTATIVES (NULL = « la règle n'en dit rien ») :

  - `nature_remplacement` : le libellé que prendra la ligne. Les conditions,
    elles, restent évaluées sur le libellé LU — sans quoi une règle qui renomme
    cesserait de reconnaître ce qu'elle vient de renommer, et deux règles
    s'arracheraient la même ligne selon leur ordre ;
  - `compte_id` : le compte de la ligne, quand le relevé le nomme mal ou pas ;
  - `notes` : une note posée sur l'opération (à ne pas confondre avec
    `description`, qui est la note de la RÈGLE, jamais recopiée) ;
  - `imprevue` : l'étiquette « dépense imprévue » (extension « Budget ») ;
  - `amortissement_mois` : amortir sur N mois, à partir du mois de la ligne.

ET LE TYPE DEVIENT FACULTATIF. Une règle qui ne fait que renommer ne doit pas
décider au passage que la ligne est une opération classique : la première règle
qui correspond fixait le type, et une règle de renommage placée en tête aurait
empêché toutes les autres de reconnaître un virement.

CE QU'UNE RÈGLE NE TOUCHE TOUJOURS PAS : les MONTANTS (montant, frais, montant
dû, devise), qui sont ce que le relevé AFFIRME, et la DATE, qui dit quand la
banque l'a passé.

Revision ID: 0071
Revises: 0070
Create Date: 2026-09-26
"""
from alembic import op
import sqlalchemy as sa

revision = "0071"
down_revision = "0070"
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table("regle_categorisation") as batch:
        batch.alter_column("type_id", existing_type=sa.Integer(), nullable=True)
        batch.add_column(sa.Column("nature_remplacement", sa.String(), nullable=True))
        batch.add_column(
            sa.Column(
                "compte_id",
                sa.Integer(),
                sa.ForeignKey(
                    "compte.id",
                    name="fk_regle_categorisation_compte_id",
                    ondelete="SET NULL",
                ),
                nullable=True,
            )
        )
        batch.add_column(sa.Column("notes", sa.String(), nullable=True))
        batch.add_column(sa.Column("imprevue", sa.Boolean(), nullable=True))
        batch.add_column(sa.Column("amortissement_mois", sa.Integer(), nullable=True))


def downgrade():
    # UNE RÈGLE SANS TYPE N'EXISTAIT PAS AVANT : elle redescend en opération
    # classique, le défaut que l'import lui aurait de toute façon donné.
    op.execute(
        "UPDATE regle_categorisation SET type_id = "
        "(SELECT id FROM type_operation WHERE code = 'classique') "
        "WHERE type_id IS NULL"
    )
    with op.batch_alter_table("regle_categorisation") as batch:
        batch.drop_column("amortissement_mois")
        batch.drop_column("imprevue")
        batch.drop_column("notes")
        batch.drop_column("compte_id")
        batch.drop_column("nature_remplacement")
        batch.alter_column("type_id", existing_type=sa.Integer(), nullable=False)
