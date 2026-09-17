"""Un relevé peut avoir PLUSIEURS lignes de tête : on dit combien, plus si.

CE QUI EXISTAIT. `import_preset.ignorer_premiere_ligne`, un booléen : le fichier
commence par un en-tête, ou il commence par une opération. Il répondait bien à
la question qu'on lui posait — mais à une seule ligne près.

CE QU'UN VRAI RELEVÉ CONTIENT. Beaucoup de banques n'exportent pas une table :
elles exportent une PAGE. Le nom du titulaire, le numéro de compte, la période,
une ligne vide, puis seulement les intitulés de colonnes. Quatre lignes avant la
première opération, dont une seule était sautée : les trois autres arrivaient
dans l'aperçu comme des opérations sans date ni montant, à supprimer une par
une, à chaque import du même format. Le preset existe justement pour qu'un
format ne se redécrive pas à chaque fois.

UN NOMBRE, DONC, ET PLUS UNE CASE. Zéro veut dire « le fichier commence par une
opération » (l'ancien faux), un veut dire « il y a un en-tête » (l'ancien vrai),
et la reprise ci-dessous conserve exactement le comportement de chaque preset
déjà enregistré.

LA COLONNE D'AVANT EST RETIRÉE plutôt que gardée à côté : deux réglages qui
disent la même chose finissent par se contredire, et c'est alors le lecteur du
fichier qui doit arbitrer — au moment précis où personne ne le regarde.

Revision ID: 0062
Revises: 0061
Create Date: 2026-09-17
"""
from alembic import op
import sqlalchemy as sa

revision = "0062"
down_revision = "0061"
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table("import_preset", schema=None) as batch_op:
        batch_op.add_column(
            sa.Column("lignes_entete", sa.Integer(), nullable=False, server_default="0")
        )

    # REPRISE DES DONNÉES : un preset qui sautait son en-tête continue de le
    # sauter. Sans cette ligne, tous les formats à en-tête réimporteraient leur
    # ligne d'intitulés comme une opération, au premier import suivant.
    op.execute("UPDATE import_preset SET lignes_entete = 1 WHERE ignorer_premiere_ligne")

    with op.batch_alter_table("import_preset", schema=None) as batch_op:
        batch_op.drop_column("ignorer_premiere_ligne")


def downgrade():
    with op.batch_alter_table("import_preset", schema=None) as batch_op:
        batch_op.add_column(
            sa.Column(
                "ignorer_premiere_ligne",
                sa.Boolean(),
                nullable=False,
                server_default=sa.false(),
            )
        )

    # Le chemin inverse PERD ce que le nombre disait au-delà de un : deux lignes
    # de tête et une seule redeviennent le même « oui ». C'est la conséquence
    # assumée d'un booléen — la seule autre issue serait de refuser de
    # redescendre, ce qui n'aiderait personne.
    op.execute("UPDATE import_preset SET ignorer_premiere_ligne = 1 WHERE lignes_entete > 0")

    with op.batch_alter_table("import_preset", schema=None) as batch_op:
        batch_op.drop_column("lignes_entete")
