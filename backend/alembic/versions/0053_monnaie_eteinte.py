"""Une monnaie d'un compte peut s'ÉTEINDRE.

LE PROBLÈME. Retirer une monnaie de la liste d'un compte est déjà possible, et
déjà refusé dès que le compte porte une opération dans cette monnaie (cf.
routers/comptes.update_compte) — à juste titre : les montants perdraient le
solde qui les porte. Mais c'est exactement le cas de la monnaie dont on veut se
débarrasser. Un compte ouvert un temps en dollars, soldé depuis, garde pour
toujours son dollar dans chaque menu de saisie, dans chaque devinette d'import,
et sur chaque carte de compte à 0,00 — et la seule façon de s'en défaire serait
de supprimer l'historique.

CE QUE LA COLONNE APPORTE. Une monnaie éteinte n'est PAS retirée : ses lignes
restent en base, intactes, et le redevenir se fait d'un clic. Elle cesse
seulement d'être PROPOSÉE — au formulaire d'opération, au virement, et à la
résolution de monnaie de l'import. Rien n'est supprimé, rien n'est réécrit :
c'est une extinction, pas une suppression.

LE SOLDE DOIT ÊTRE NUL POUR ÉTEINDRE, et c'est la condition qui rend tout le
reste sûr. Une monnaie qu'on éteint ne porte plus rien : sa ligne disparaît donc
des soldes affichés sans qu'aucun total ne change. Elle reparaît d'elle-même sur
une période ANTÉRIEURE où le compte portait encore des montants — l'historique
reste vrai, c'est le présent qui se nettoie (cf. services/soldes.get_soldes_comptes).

POURQUOI UNE COLONNE PLUTÔT QU'UN SOLDE NUL DEVINÉ. Un compte en dollars
fraîchement ouvert a lui aussi un solde nul, et il doit apparaître partout :
c'est précisément ce que `get_soldes_comptes` garantit depuis toujours. « Solde
nul » ne distingue pas « pas encore servi » de « ne sert plus » ; seule une
décision de l'utilisateur le fait.

TRUE PAR DÉFAUT : toutes les monnaies déjà déclarées restent allumées, et rien
ne change pour une base existante.

Revision ID: 0053
Revises: 0052
Create Date: 2026-09-11
"""
from alembic import op
import sqlalchemy as sa

revision = "0053"
down_revision = "0052"
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table("compte_monnaie", schema=None) as batch_op:
        batch_op.add_column(
            sa.Column(
                "active",
                sa.Boolean(),
                nullable=False,
                server_default=sa.true(),
            )
        )


def downgrade():
    with op.batch_alter_table("compte_monnaie", schema=None) as batch_op:
        batch_op.drop_column("active")
