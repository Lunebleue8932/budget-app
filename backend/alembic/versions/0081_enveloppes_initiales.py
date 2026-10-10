"""Trois enveloppes livrées : « ETF », « ETN », « Action en direct ».

POURQUOI MAINTENANT. La 0047 ne livrait aucune enveloppe — chacun nomme les siennes. Mais
sur une base neuve la liste des enveloppes était vide, et chacun écrivait les siennes — parfois
« Actions », qui est une CLASSE D'ACTIF (axe voisin) et se mélange alors avec elle. Trois libellés suffisent à
couvrir ce que l'import décrit (un fonds indiciel, une note indexée, une action détenue en
propre) ; les autres se créent comme avant.

SANS DOUBLON : un libellé déjà présent sur l'axe, à la casse et aux espaces près, n'est pas
reposé. Une base qui a déjà son « etf » le garde tel quel.

LE RETOUR ARRIÈRE ne retire que ceux qu'aucun titre ne porte.

Revision ID: 0081
Revises: 0080
Create Date: 2026-10-10
"""
import sqlalchemy as sa
from alembic import op

revision = "0081"
down_revision = "0080"
branch_labels = None
depends_on = None

ENVELOPPES = ["ETF", "ETN", "Action en direct"]


def upgrade():
    conn = op.get_bind()
    for nom in ENVELOPPES:
        existe = conn.execute(
            sa.text(
                "SELECT 1 FROM type_titre WHERE axe = 'enveloppe' "
                "AND lower(trim(nom)) = lower(:nom)"
            ),
            {"nom": nom},
        ).first()
        if existe is None:
            conn.execute(
                sa.text("INSERT INTO type_titre (nom, axe) VALUES (:nom, 'enveloppe')"),
                {"nom": nom},
            )


def downgrade():
    conn = op.get_bind()
    for nom in ENVELOPPES:
        conn.execute(
            sa.text(
                "DELETE FROM type_titre WHERE axe = 'enveloppe' AND nom = :nom "
                "AND id NOT IN (SELECT type_titre_id FROM titre_possede "
                "WHERE type_titre_id IS NOT NULL)"
            ),
            {"nom": nom},
        )
