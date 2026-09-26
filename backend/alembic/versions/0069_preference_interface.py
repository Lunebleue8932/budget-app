"""Un rangement d'écran qui désigne des lignes de la base vit DANS la base.

LE DÉFAUT QUE CETTE TABLE CORRIGE. Les dossiers de la galerie des règles
vivaient dans le `localStorage` du navigateur, au motif qu'un dossier est un
confort de lecture et non une donnée du budget. C'était vrai de l'intention, et
faux de la CHOSE : ce qui y est rangé est une table
`{ "<identifiant de règle>": "<nom de dossier>" }`. Or un identifiant de règle
n'existe que dans une base précise. Le même rangement appliqué à une autre base
désigne d'autres règles, ou aucune ; et une base emportée sur un second poste
arrive sans son rangement, alors même qu'elle porte les règles rangées.

D'OÙ LA RÈGLE, qui vaut pour tout ce qui viendra après : CE QUI DÉSIGNE DES
IDENTIFIANTS DE LA BASE VIT DANS LA BASE ; ce qui décrit le POSTE — le thème, la
langue, la touche qui fige l'infobulle, la progression d'un tutoriel — reste
dans le `localStorage`, où changer de machine ne ramène pas les habitudes de
l'autre.

UNE TABLE GÉNÉRIQUE, ET NON UNE COLONNE PAR CAS. Ce qu'on y range n'a ni forme
commune ni requête à servir : personne ne filtrera jamais les règles par dossier
côté serveur, l'écran lit tout d'un coup et réécrit tout d'un coup. Une table
par rangement aurait fait une migration à chaque idée d'affichage, pour des
données que le serveur ne lit jamais.

ELLE VIT DANS LE NOYAU, comme toutes les tables (cf. extensions/README.md) :
« Règles » est une extension, et une extension qui emporterait son schéma
imposerait de choisir, à sa désactivation, entre perdre ses données et refuser
de l'éteindre. La clé porte l'espace de nommage de qui s'en sert
(« regles.dossiers »), exactement comme frontend/textes.js.

Revision ID: 0069
Revises: 0068
Create Date: 2026-09-20
"""
from alembic import op
import sqlalchemy as sa

revision = "0069"
down_revision = "0068"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "preference_interface",
        # LA CLÉ EST LA CLÉ PRIMAIRE : il n'y a qu'un rangement par nom, et
        # l'écrire est un remplacement, jamais un ajout. Un identifiant
        # auto-incrémenté aurait laissé exister deux valeurs pour « les dossiers
        # de règles », sans que rien ne dise laquelle sert.
        sa.Column("cle", sa.String(), primary_key=True),
        # DU JSON LIBRE. Le serveur ne lit jamais ce qu'il y a dedans — il
        # range et il rend. Lui donner une forme reviendrait à décider ici de ce
        # qu'un écran a le droit de se rappeler.
        sa.Column("valeur", sa.JSON(), nullable=False),
    )


def downgrade():
    # REDESCENDRE PERD LES RANGEMENTS, et rien d'autre : aucune règle, aucune
    # opération, aucun compte ne dépend de cette table. Les dossiers
    # disparaissent, leurs règles reviennent dans « Autres ».
    op.drop_table("preference_interface")
