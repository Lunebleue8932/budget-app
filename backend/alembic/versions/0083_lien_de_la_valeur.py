"""La colonne « Cours » de l'import de titres devient « Lien de la valeur ».

CE QUI CHANGE. La colonne portait le chiffre du dernier cours ; elle porte désormais l'adresse
de la page de cotation du titre (Google Finance…), celle que l'extension « Lecture de cours »
relit. Ce n'est plus la même donnée : un cours (104,52) lu comme une adresse mettrait chaque
ligne en erreur.

CE QUE FAIT LA MIGRATION. Elle retire la propriété `cours` des formats (presets) de l'import de
titres — et d'eux seuls : l'import de placements a sa propre colonne « cours ». Le format garde
toutes ses autres colonnes ; l'écran lui propose la nouvelle (`lien_valeur`) à la prochaine
ouverture s'il lit les colonnes du modèle dans l'ordre, sinon on la désigne à la main. Rien n'est
renommé exprès : un numéro de colonne qui désignait des cours ne désigne pas des liens.

Revision ID: 0083
Revises: 0082
Create Date: 2026-10-14
"""
import json

import sqlalchemy as sa
from alembic import op

revision = "0083"
down_revision = "0082"
branch_labels = None
depends_on = None


def upgrade():
    conn = op.get_bind()
    lignes = conn.execute(
        sa.text("SELECT id, colonnes FROM import_preset WHERE domaine = 'titre'")
    ).fetchall()
    for preset_id, colonnes in lignes:
        liste = json.loads(colonnes) if isinstance(colonnes, str) else colonnes
        restantes = [c for c in (liste or []) if c.get("propriete") != "cours"]
        if len(restantes) != len(liste or []):
            conn.execute(
                sa.text("UPDATE import_preset SET colonnes = :colonnes WHERE id = :id"),
                {"colonnes": json.dumps(restantes), "id": preset_id},
            )


def downgrade():
    # La colonne retirée ne se reconstitue pas : son numéro n'a pas été gardé.
    pass
