"""Les colonnes dummy : une colonne du fichier qu'une règle lit, déclarée par chaque format.

DEUX TABLES.

  - `colonne_dummy` : une colonne que l'app ne sait pas nommer (une référence, un code
    d'opération), GLOBALE — partagée entre les formats. Nom unique.
  - `import_preset_colonne_dummy` : tel format lit telle colonne dummy, à tel numéro de SA
    colonne. C'est ce qui permet à une seule règle de viser la même information dans deux
    fichiers qui ne la rangent pas au même endroit.

UNE REPRISE DE DONNÉES : LES CONDITIONS « colonne_N » DE LA MIGRATION 0077 deviennent des
colonnes dummy. Le champ disparaît de l'application (un numéro de colonne ne veut dire la même
chose que dans un seul format) ; une règle qui le portait encore ne correspondrait plus à rien
sans rien dire. Pour chaque numéro N cité, une colonne dummy « Colonne N » est créée, et chaque
format que la règle vise (TOUS les formats bancaires si elle n'en restreint aucun) la lit au
numéro N — exactement ce que la condition lisait. Détection ET sorties conditionnelles.

LE RETOUR ARRIÈRE supprime les deux tables et rend aux conditions reprises leur « colonne_N »
(retrouvé dans le nom « Colonne N ») ; une condition sur une colonne dummy créée ensuite, qui
n'a pas d'équivalent, est laissée telle quelle — 0077 ne la lira simplement pas.

Revision ID: 0079
Revises: 0078
Create Date: 2026-10-10
"""
import json
import re

import sqlalchemy as sa
from alembic import op

revision = "0079"
down_revision = "0078"
branch_labels = None
depends_on = None

_COLONNE = re.compile(r"^colonne_([1-9][0-9]{0,2})$")
_DUMMY = re.compile(r"^dummy_([1-9][0-9]*)$")
_NOM_REPRIS = re.compile(r"^Colonne ([1-9][0-9]{0,2})$")


def _charger(valeur):
    if valeur is None:
        return None
    return json.loads(valeur) if isinstance(valeur, str) else valeur


def _conditions_de(regle_conditions, sorties):
    """Toutes les conditions d'une règle, détection et sorties, en références modifiables."""
    blocs = [regle_conditions or {}] + [(s or {}).get("conditions") or {} for s in sorties or []]
    for bloc in blocs:
        for groupe in bloc.get("groupes") or []:
            for condition in groupe.get("conditions") or []:
                yield condition


def upgrade():
    op.create_table(
        "colonne_dummy",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("nom", sa.String(), nullable=False, unique=True),
    )
    op.create_table(
        "import_preset_colonne_dummy",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column(
            "preset_id",
            sa.Integer(),
            sa.ForeignKey("import_preset.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column(
            "colonne_dummy_id",
            sa.Integer(),
            sa.ForeignKey("colonne_dummy.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("index", sa.Integer(), nullable=False),
        sa.UniqueConstraint(
            "preset_id", "colonne_dummy_id", name="uq_import_preset_colonne_dummy"
        ),
        sa.CheckConstraint('"index" >= 1', name="ck_import_preset_colonne_dummy_index"),
    )

    conn = op.get_bind()
    formats_bancaires = [
        identifiant
        for (identifiant,) in conn.execute(
            sa.text("SELECT id FROM import_preset WHERE domaine = 'bancaire'")
        )
    ]
    regles = conn.execute(
        sa.text("SELECT id, conditions, sorties, presets FROM regle_categorisation")
    ).fetchall()

    dummy_par_numero: dict[int, int] = {}
    lectures: set[tuple[int, int]] = set()
    for regle_id, conditions_brutes, sorties_brutes, presets_bruts in regles:
        conditions = _charger(conditions_brutes) or {}
        sorties = _charger(sorties_brutes) or []
        presets = _charger(presets_bruts)
        modifiee = False
        for condition in _conditions_de(conditions, sorties):
            trouve = _COLONNE.match(condition.get("champ") or "")
            if not trouve:
                continue
            numero = int(trouve.group(1))
            if numero not in dummy_par_numero:
                nom = f"Colonne {numero}"
                existante = conn.execute(
                    sa.text("SELECT id FROM colonne_dummy WHERE nom = :nom"), {"nom": nom}
                ).scalar()
                if existante is None:
                    conn.execute(
                        sa.text("INSERT INTO colonne_dummy (nom) VALUES (:nom)"), {"nom": nom}
                    )
                    existante = conn.execute(
                        sa.text("SELECT id FROM colonne_dummy WHERE nom = :nom"), {"nom": nom}
                    ).scalar()
                dummy_par_numero[numero] = existante
            identifiant = dummy_par_numero[numero]
            condition["champ"] = f"dummy_{identifiant}"
            modifiee = True
            for preset_id in presets if presets else formats_bancaires:
                if (preset_id, identifiant) in lectures:
                    continue
                lectures.add((preset_id, identifiant))
                conn.execute(
                    sa.text(
                        'INSERT INTO import_preset_colonne_dummy (preset_id, colonne_dummy_id, "index") '
                        "VALUES (:preset, :dummy, :index)"
                    ),
                    {"preset": preset_id, "dummy": identifiant, "index": numero},
                )
        if modifiee:
            conn.execute(
                sa.text(
                    "UPDATE regle_categorisation SET conditions = :conditions, sorties = :sorties "
                    "WHERE id = :id"
                ),
                {
                    "conditions": json.dumps(conditions),
                    "sorties": json.dumps(sorties),
                    "id": regle_id,
                },
            )


def downgrade():
    conn = op.get_bind()
    numeros = {}
    for identifiant, nom in conn.execute(sa.text("SELECT id, nom FROM colonne_dummy")):
        trouve = _NOM_REPRIS.match(nom or "")
        if trouve:
            numeros[identifiant] = int(trouve.group(1))
    regles = conn.execute(
        sa.text("SELECT id, conditions, sorties FROM regle_categorisation")
    ).fetchall()
    for regle_id, conditions_brutes, sorties_brutes in regles:
        conditions = _charger(conditions_brutes) or {}
        sorties = _charger(sorties_brutes) or []
        modifiee = False
        for condition in _conditions_de(conditions, sorties):
            trouve = _DUMMY.match(condition.get("champ") or "")
            if trouve and int(trouve.group(1)) in numeros:
                condition["champ"] = f"colonne_{numeros[int(trouve.group(1))]}"
                modifiee = True
        if modifiee:
            conn.execute(
                sa.text(
                    "UPDATE regle_categorisation SET conditions = :conditions, sorties = :sorties "
                    "WHERE id = :id"
                ),
                {
                    "conditions": json.dumps(conditions),
                    "sorties": json.dumps(sorties),
                    "id": regle_id,
                },
            )
    op.drop_table("import_preset_colonne_dummy")
    op.drop_table("colonne_dummy")
