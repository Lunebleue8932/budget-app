"""Rapprocher une dépense PRÉVISIONNELLE de la vraie, à l'import.

CE QUE LA PRÉVISIONNELLE NE SAVAIT PAS FAIRE. Le statut « prévisionnel » existe
depuis toujours : on écrit la dépense qu'on sait devoir venir, elle pèse sur le
solde projeté, et c'est utile. Mais quand la vraie ligne arrivait au relevé,
RIEN ne les reliait : l'import créait une seconde opération, et la même dépense
comptait deux fois jusqu'à ce qu'on pense à aller supprimer l'ancienne à la
main. Personne n'y pense. La prévisionnelle était donc une note qu'on s'écrivait
à soi-même, pas un mécanisme — et la seule façon de s'en servir sans fausser ses
chiffres était de ne pas s'en servir.

CE QUE CETTE MIGRATION AJOUTE : de quoi RECONNAÎTRE la vraie ligne quand elle
passe. Trois colonnes de plus sur `operation`, toutes nulles pour tout ce qui
existe déjà, et une quatrième pour la récurrence (voir plus bas).

  - `rapprochement_debut` / `rapprochement_fin` — LA FENÊTRE dans laquelle la
    vraie dépense est attendue. NULL des deux côtés veut dire « le jour même »,
    c'est-à-dire la date de l'opération : c'est ce qui rend rapprochables, sans
    aucune reprise de données, les prévisionnelles déjà écrites et les
    occurrences déjà générées des opérations récurrentes. La fenêtre existe
    parce qu'on connaît souvent le mois d'un prélèvement et rarement son jour —
    et parce qu'une banque passe volontiers au 6 ce qu'elle annonçait au 5.
    LES DEUX BORNES SONT DANS LE MÊME MOIS (garde applicative, cf.
    schemas.OperationBase) : une fenêtre à cheval sur deux mois rendrait
    ambigu le mois auquel la dépense appartient, or c'est précisément ce qu'une
    prévisionnelle sert à dire.
  - `rapprochement_mots_cles` — une liste JSON, combinée en ET, cherchée dans le
    libellé de la ligne importée. Facultative, et vide dans le cas ordinaire :
    le montant et la date suffisent presque toujours. Elle sert au cas
    inverse — deux prélèvements du même montant le même mois, que seul le
    libellé distingue.
  - `recurrence_date_prevue` — LA DATE QUE LE GÉNÉRATEUR AVAIT PRÉVUE, sur une
    occurrence de récurrence. Sans elle, rapprocher une occurrence du 5 avec une
    ligne datée du 6 déplaçait sa date, et `generer_occurrences_recurrentes` —
    qui reconnaît ses occurrences À LEUR DATE — en aurait aussitôt recréé une au
    5 : la dépense serait revenue en double par l'autre bout. Elle est posée à
    la génération et ne bouge plus jamais ; NULL sur tout l'existant, où la date
    de l'occurrence fait foi comme avant.

RIEN N'EST RAPPROCHÉ D'OFFICE. Ces colonnes ne font que rendre une
prévisionnelle RECONNAISSABLE ; l'aperçu d'import propose, coche par coche, et
l'utilisateur décide (cf. services/rapprochement_previsionnel.py). Écraser une
opération sans le demander serait la seule façon de rendre ce mécanisme pire
que le doublon qu'il supprime.

Revision ID: 0058
Revises: 0057
Create Date: 2026-09-13
"""
from alembic import op
import sqlalchemy as sa

revision = "0058"
down_revision = "0057"
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table("operation") as batch:
        batch.add_column(sa.Column("rapprochement_debut", sa.Date(), nullable=True))
        batch.add_column(sa.Column("rapprochement_fin", sa.Date(), nullable=True))
        batch.add_column(sa.Column("rapprochement_mots_cles", sa.Text(), nullable=True))
        batch.add_column(sa.Column("recurrence_date_prevue", sa.Date(), nullable=True))
    # ANNULER UN IMPORT DOIT RESTER UN VRAI RETOUR EN ARRIÈRE. Il supprime les
    # opérations que l'import a créées — mais une opération RAPPROCHÉE n'a pas
    # été créée par l'import : elle existait avant, en prévisionnel. La
    # supprimer aurait effacé une prévision que l'utilisateur avait écrite
    # lui-même, pour défaire un import qu'il regrettait : la pire perte
    # possible, et parfaitement silencieuse.
    #
    # Cette colonne porte donc l'INSTANTANÉ de ce que l'opération était juste
    # avant d'être écrasée, en JSON. Annuler la restaure telle quelle au lieu
    # de la détruire (cf. services/import_bancaire.annuler_import). Rangé sur
    # la ligne du stock anti-doublons parce que c'est déjà elle qui relie un
    # import à ce qu'il a touché — aucune autre table à interroger.
    with op.batch_alter_table("ligne_import_brute") as batch:
        batch.add_column(
            sa.Column("etat_previsionnel_avant", sa.Text(), nullable=True)
        )


def downgrade():
    with op.batch_alter_table("ligne_import_brute") as batch:
        batch.drop_column("etat_previsionnel_avant")
    # REDESCENDRE NE PERD QUE LA RECONNAISSANCE, jamais une opération : les
    # prévisionnelles restent, les occurrences de récurrence aussi, et une
    # opération déjà rapprochée est de toute façon devenue réelle — elle ne
    # portait plus rien de tout ceci.
    with op.batch_alter_table("operation") as batch:
        batch.drop_column("recurrence_date_prevue")
        batch.drop_column("rapprochement_mots_cles")
        batch.drop_column("rapprochement_fin")
        batch.drop_column("rapprochement_debut")
