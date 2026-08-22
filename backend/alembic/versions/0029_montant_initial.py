"""« montant reçu » devient « montant initial » : le couple change de côté.

La 0026 avait rendu ces deux colonnes à des propriétés, en les décrivant comme
ce qui ARRIVE : `montant` était ce qui part, `montant_destination` ce qui est
reçu. À l'usage, c'est l'inverse qui correspond aux relevés — la colonne
générale porte le montant final, et c'est le montant de DÉPART (avant frais et
avant conversion) qui mérite une propriété à part.

D'où le renommage, dans `import_preset.colonnes` :

    montant_destination -> montant_initial
    monnaie_destination -> monnaie_initiale

Ce n'est pas qu'un libellé. Le sens d'application des frais s'inverse avec lui
(ils s'ajoutent désormais au montant initial et se retranchent du montant), et
sur un virement interne la jambe émettrice devient le montant initial. Les
opérations déjà importées ne bougent pas : elles ne référencent aucune de ces
colonnes, seul le prochain import lira le fichier autrement.

Revision ID: 0029
Revises: 0028
Create Date: 2026-08-07
"""
import json

from alembic import op
import sqlalchemy as sa

revision = "0029"
down_revision = "0028"
branch_labels = None
depends_on = None

_RENOMMAGES = {
    "montant_destination": "montant_initial",
    "monnaie_destination": "monnaie_initiale",
}


def _renommer(connexion, correspondances: dict[str, str]) -> list[str]:
    """Applique les renommages aux propriétés de chaque preset, et rend le nom
    des presets réellement touchés."""
    touches = []
    for preset_id, nom, colonnes_json in connexion.execute(
        sa.text("SELECT id, nom, colonnes FROM import_preset")
    ):
        try:
            colonnes = json.loads(colonnes_json or "[]")
        except (TypeError, ValueError):
            continue
        modifie = False
        for colonne in colonnes:
            ancienne = colonne.get("propriete")
            if ancienne in correspondances:
                colonne["propriete"] = correspondances[ancienne]
                modifie = True
        if not modifie:
            continue
        connexion.execute(
            sa.text("UPDATE import_preset SET colonnes = :colonnes WHERE id = :id"),
            {"colonnes": json.dumps(colonnes), "id": preset_id},
        )
        touches.append(nom)
    return touches


def upgrade():
    touches = _renommer(op.get_bind(), _RENOMMAGES)
    if touches:
        print(
            "« Montant reçu » renommé en « Montant initial » pour "
            + ", ".join(f"« {nom} »" for nom in touches)
            + " : cette colonne décrit désormais ce qui PART (avant frais et "
            "avant conversion). Vérifie qu'elle pointe bien sur la bonne colonne "
            "du fichier avant le prochain import."
        )


def downgrade():
    _renommer(op.get_bind(), {v: k for k, v in _RENOMMAGES.items()})
