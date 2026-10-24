"""« Part d'un ETF ? » : le drapeau des titres qui ne sont là que pour éclater un ETF.

CE QUI EXISTAIT. L'import d'une composition d'ETF crée un titre par composant (souvent des
dizaines, parfois mille) : ils s'empilaient dans « Titres suivis » parmi les titres que
l'utilisateur détient ou surveille vraiment.

CE QUI EST AJOUTÉ. `titre_possede.part_etf` (booléen, faux par défaut) : vrai pour un titre que
l'import d'une composition a créé OU retrouvé parmi les composants d'un ETF. L'écran range ces
titres dans la fenêtre « Titres d'ETFs » ; un titre DÉTENU reste toujours dans « Titres suivis »,
quel que soit le drapeau (cf. extensions/placements).

LES TITRES SANS ISIN. Un fichier d'émetteur ne donne pas toujours l'ISIN de ses composants : la
composition d'un ETF les cite alors par `titre:<id>` plutôt que par un ISIN (cf.
services/exposition.cle_composant). Rien à migrer pour cela.

RATTRAPAGE. Les titres déjà cités par la composition d'un ETF reçoivent le drapeau : ils sont
dans le même cas que ceux d'un import à venir. Un titre cité qui est lui-même un ETF (une
composition peut en citer un) ne le reçoit pas.

DESCENTE. La colonne disparaît.

Revision ID: 0092
Revises: 0091
Create Date: 2026-10-24
"""
import json

from alembic import op
import sqlalchemy as sa

revision = "0092"
down_revision = "0091"
branch_labels = None
depends_on = None


def _normaliser(texte) -> str:
    return str(texte or "").replace(" ", "").replace(" ", "").upper()


def upgrade() -> None:
    with op.batch_alter_table("titre_possede", schema=None) as batch_op:
        batch_op.add_column(
            sa.Column("part_etf", sa.Boolean(), nullable=False, server_default=sa.false())
        )

    connexion = op.get_bind()
    titres = connexion.execute(
        sa.text("SELECT id, code_isin, composition FROM titre_possede")
    ).fetchall()
    par_isin = {_normaliser(isin): id_ for id_, isin, _ in titres if isin}
    avec_composition = set()
    cites = set()
    for id_, _, composition in titres:
        if isinstance(composition, str):
            try:
                composition = json.loads(composition)
            except ValueError:
                composition = None
        if not composition:
            continue
        avec_composition.add(id_)
        for cle in composition:
            cle = _normaliser(cle)
            if cle in par_isin:
                cites.add(par_isin[cle])
            elif cle.startswith("TITRE:") and cle[6:].isdigit():
                cites.add(int(cle[6:]))
    for id_ in cites - avec_composition:
        connexion.execute(
            sa.text("UPDATE titre_possede SET part_etf = 1 WHERE id = :id"), {"id": id_}
        )


def downgrade() -> None:
    with op.batch_alter_table("titre_possede", schema=None) as batch_op:
        batch_op.drop_column("part_etf")
