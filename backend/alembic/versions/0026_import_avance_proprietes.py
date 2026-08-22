"""la configuration avancée d'import redevient un simple mappage de colonnes.

La 0023 avait donné à l'utilisateur de quoi TOUT exprimer : des colonnes
nommées librement, et des formules façon tableur pour les combiner
(« =C5+C6 »). Le pouvoir d'expression était réel, la configuration illisible :
comprendre ce qu'un preset faisait demandait de relire trois formules et de
retrouver à quelles colonnes leurs numéros renvoyaient.

Les quatre notions que ces formules servaient à exprimer sont en fait toujours
les mêmes — un montant reçu, sa devise, des frais, leur devise. Elles
redeviennent donc des propriétés d'import ordinaires (cf.
constants.PROPRIETES_IMPORT_AVANCEES), c'est-à-dire des colonnes stockées dans
`import_preset.colonnes` comme toutes les autres. `colonnes_supplementaires` et
`formules` n'ont plus d'objet et disparaissent.

Aucune conversion automatique des formules existantes : une formule est un
calcul arbitraire, rien ne garantit qu'elle se ramène à « la colonne C8 ». Les
presets concernés sont donc à reconfigurer une fois — d'où le message ci-dessous
plutôt qu'une devinette silencieuse.

Revision ID: 0026
Revises: 0025
Create Date: 2026-08-07
"""
import json

from alembic import op
import sqlalchemy as sa

revision = "0026"
down_revision = "0025"
branch_labels = None
depends_on = None


def _presets_avec_configuration_perdue(connexion) -> list[str]:
    """Les presets qui utilisaient réellement une formule ou une colonne
    supplémentaire : eux seuls perdent quelque chose ici, et méritent d'être
    nommés."""
    concernes = []
    for nom, colonnes_supplementaires, formules in connexion.execute(
        sa.text("SELECT nom, colonnes_supplementaires, formules FROM import_preset")
    ):
        try:
            supplementaires = json.loads(colonnes_supplementaires or "[]")
            calculs = json.loads(formules or "{}")
        except (TypeError, ValueError):
            continue
        if supplementaires or any((valeur or "").strip() for valeur in calculs.values()):
            concernes.append(nom)
    return concernes


def upgrade():
    connexion = op.get_bind()
    concernes = _presets_avec_configuration_perdue(connexion)
    if concernes:
        print(
            "Configuration avancée simplifiée : les formules et colonnes "
            "supplémentaires de " + ", ".join(f"« {nom} »" for nom in concernes) + " "
            "sont supprimées. Reconfigure le montant reçu et les frais en "
            "colonnes, dans la configuration avancée du preset."
        )

    with op.batch_alter_table("import_preset", schema=None) as batch_op:
        batch_op.drop_column("formules")
        batch_op.drop_column("colonnes_supplementaires")


def downgrade():
    # Rétablies vides : les formules d'origine ne sont pas conservées (rien ne
    # les référence après coup, et les recréer supposerait de deviner un calcul).
    with op.batch_alter_table("import_preset", schema=None) as batch_op:
        batch_op.add_column(
            sa.Column(
                "colonnes_supplementaires", sa.JSON, nullable=False, server_default="[]"
            )
        )
        batch_op.add_column(
            sa.Column("formules", sa.JSON, nullable=False, server_default="{}")
        )
