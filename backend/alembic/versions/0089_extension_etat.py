"""L'état d'activation des extensions vit aussi DANS la base.

CE QUI EXISTAIT. L'activation d'une extension était retenue dans `extensions.json`, à côté de
l'exécutable : un réglage de l'INSTALLATION, que la base ne connaissait pas. Une seule base
pouvait donc être servie avec un seul état, et la démo (cf. services/base_sandbox.py) n'avait
aucun moyen d'allumer les extensions pour la montrer sans éteindre celles de l'utilisateur.

CE QUI EST AJOUTÉ. `extension_etat` : une ligne par extension dont l'état a été DÉCIDÉ pour cette
base, `active` vrai ou faux. L'ABSENCE DE LIGNE N'EST PAS « ÉTEINTE » : elle veut dire « pas décidé
ici », et l'application retombe alors sur ce qu'elle faisait avant (le fichier d'installation, ou,
dans la démo, son défaut). C'est ce qui rend la migration sans reprise de données : une base
existante n'a aucune ligne, et rien ne change pour son utilisateur tant qu'il n'a pas touché à une
case de Paramètres → Extensions.

ELLE VIT DANS LE NOYAU, comme toutes les tables (cf. extensions/README.md) : une extension
n'emporte jamais son schéma.

Revision ID: 0089
Revises: 0088
Create Date: 2026-10-17
"""
from alembic import op
import sqlalchemy as sa

revision = "0089"
down_revision = "0088"
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        "extension_etat",
        # L'identifiant du DOSSIER de l'extension (« placements », « analyse-budget »). Clé
        # primaire : une seule décision par extension, la réécrire est un remplacement.
        sa.Column("extension_id", sa.String(), primary_key=True),
        sa.Column("active", sa.Boolean(), nullable=False),
    )


def downgrade():
    # REDESCENDRE PERD LES DÉCISIONS, et rien d'autre : les extensions retombent sur l'état du
    # fichier d'installation. Aucune donnée du budget ne dépend de cette table.
    op.drop_table("extension_etat")
