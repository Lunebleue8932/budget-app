"""un preset d'import peut décrire un relevé de compte-titres, et un titre
porte son code ISIN.

DEUX CHANGEMENTS, UN SEUL SUJET : l'extension « import-placements », qui lit
une liste d'opérations sur un compte de placements comme l'import bancaire lit
un relevé.

1. `import_preset.domaine` ('bancaire' | 'placement'). Tout ce qui entoure les
   colonnes d'un preset — correspondances mémorisées, historique, annulation,
   stock anti-doublons — est rigoureusement identique d'un domaine à l'autre et
   déjà scopé par preset_id : dédoubler ces quatre tables pour la seule raison
   que les colonnes lues diffèrent n'aurait rien apporté. Le domaine cloisonne
   à la lecture (le routeur du noyau ne voit que 'bancaire'), et TOUS les
   presets déjà en base deviennent 'bancaire' — c'est ce qu'ils sont.

   L'unicité du nom suit : elle portait sur le nom seul, elle porte désormais
   sur le couple (domaine, nom). « Boursorama » désigne légitimement un relevé
   bancaire ET un relevé de compte-titres. C'est le seul changement qui oblige
   à recréer la table (SQLite ne sait pas retirer une contrainte d'unicité
   implicite) : `batch_alter_table` + `copy_from` s'en charge, et les cinq
   tables filles ne bougent pas — elles référencent `import_preset` par son
   nom, que la recréation restitue à l'identique.

   Les migrations tournent avec `PRAGMA foreign_keys` à OFF (alembic/env.py
   monte son propre moteur, sans le hook de app/database.py) : le DROP de la
   table d'origine ne cascade donc sur aucune ligne fille. Le test
   test_migration_0041 le vérifie plutôt que de le supposer.

2. `libelles_type_achat` / `_vente` / `_transfert` : le vocabulaire de la
   colonne « Type d'opération » d'un relevé de placements, propre au preset,
   comme le sont déjà ceux du sens (0027) et de l'état (0028). Vides par
   défaut, et vides pour toujours sur un preset bancaire.

3. `action.code_isin` : la seule dénomination d'un titre qui ne change jamais,
   et donc celle qui permet de rapprocher une ligne d'un relevé d'un titre déjà
   connu. Facultatif (aucun titre existant n'en a), unique quand il est
   renseigné.

Revision ID: 0041
Revises: 0040
Create Date: 2026-08-26
"""
from alembic import op
import sqlalchemy as sa

revision = "0041"
down_revision = "0040"
branch_labels = None
depends_on = None


def _table_import_preset(avec_domaine: bool) -> sa.Table:
    """La définition EXPLICITE de import_preset, telle qu'on la veut après
    recréation.

    Explicite et non reflétée : c'est tout l'intérêt de `copy_from`. La
    réflexion rapporterait l'unicité implicite sur `nom` (posée en 0014 par un
    `unique=True` de colonne) et la recréation la reconduirait — or c'est
    précisément elle qu'on vient retirer.

    `avec_domaine` distingue l'avant/après pour le retour arrière, qui doit
    décrire la table telle qu'elle est AU MOMENT où il s'exécute.
    """
    metadata = sa.MetaData()
    colonnes = [
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column("nom", sa.String, nullable=False),
    ]
    if avec_domaine:
        colonnes.append(
            sa.Column("domaine", sa.String, nullable=False, server_default="bancaire")
        )
    colonnes += [
        sa.Column(
            "compte_id",
            sa.Integer,
            sa.ForeignKey("compte.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("colonnes", sa.JSON, nullable=False),
        sa.Column("colonnes_comparaison", sa.JSON, nullable=False, server_default="[]"),
        sa.Column(
            "mode_comparaison", sa.String, nullable=False, server_default="exclusion"
        ),
        sa.Column(
            "ignorer_premiere_ligne",
            sa.Boolean,
            nullable=False,
            server_default=sa.text("0"),
        ),
        sa.Column("libelles_sens_sortie", sa.JSON, nullable=False, server_default="[]"),
        sa.Column("libelles_sens_entree", sa.JSON, nullable=False, server_default="[]"),
        sa.Column(
            "libelles_statut_execute", sa.JSON, nullable=False, server_default="[]"
        ),
        sa.Column(
            "libelles_statut_attente", sa.JSON, nullable=False, server_default="[]"
        ),
        sa.Column(
            "libelles_statut_refuse", sa.JSON, nullable=False, server_default="[]"
        ),
    ]
    if avec_domaine:
        colonnes += [
            sa.Column(
                "libelles_type_achat", sa.JSON, nullable=False, server_default="[]"
            ),
            sa.Column(
                "libelles_type_vente", sa.JSON, nullable=False, server_default="[]"
            ),
            sa.Column(
                "libelles_type_transfert", sa.JSON, nullable=False, server_default="[]"
            ),
        ]
    return sa.Table("import_preset", metadata, *colonnes)


def upgrade():
    # Les quatre colonnes d'abord, par un simple ALTER : rien à recréer pour
    # ajouter une colonne, et les presets existants prennent leur valeur par
    # défaut ('bancaire', et trois listes vides).
    with op.batch_alter_table("import_preset", schema=None) as batch_op:
        batch_op.add_column(
            sa.Column("domaine", sa.String, nullable=False, server_default="bancaire")
        )
        batch_op.add_column(
            sa.Column(
                "libelles_type_achat", sa.JSON, nullable=False, server_default="[]"
            )
        )
        batch_op.add_column(
            sa.Column(
                "libelles_type_vente", sa.JSON, nullable=False, server_default="[]"
            )
        )
        batch_op.add_column(
            sa.Column(
                "libelles_type_transfert", sa.JSON, nullable=False, server_default="[]"
            )
        )

    # Puis l'unicité, qui elle demande une recréation. `copy_from` décrit la
    # table SANS l'unicité sur `nom` : la nouvelle ne portera donc que la
    # contrainte composite créée ici.
    with op.batch_alter_table(
        "import_preset", copy_from=_table_import_preset(avec_domaine=True), schema=None
    ) as batch_op:
        batch_op.create_unique_constraint(
            "uq_import_preset_domaine_nom", ["domaine", "nom"]
        )

    with op.batch_alter_table("action", schema=None) as batch_op:
        batch_op.add_column(sa.Column("code_isin", sa.String, nullable=True))
    op.create_index("ix_action_code_isin", "action", ["code_isin"], unique=True)


def downgrade():
    """Retour à un import_preset purement bancaire.

    Les presets de placements sont SUPPRIMÉS, et avec eux leurs correspondances,
    leur historique et leur stock de lignes brutes : leurs colonnes désignent des
    propriétés que le code d'avant ne sait pas lire, et les garder aurait laissé
    dans le sélecteur de la page Import des formats qui mettent toutes leurs
    lignes en erreur. Les OPÉRATIONS qu'ils ont importées, elles, ne bougent
    pas — ce sont des opérations comme les autres.

    Les cascades ne partant qu'avec `PRAGMA foreign_keys` actif, ce que les
    migrations n'ont pas : les tables filles sont donc vidées explicitement.
    """
    conn = op.get_bind()
    presets = [
        int(ligne[0])
        for ligne in conn.execute(
            sa.text("SELECT id FROM import_preset WHERE domaine = 'placement'")
        )
    ]
    if presets:
        marques = ", ".join(str(preset_id) for preset_id in presets)
        for table in (
            "ligne_import_brute",
            "import_historique",
            "import_categorie_mapping",
            "import_compte_mapping",
            "import_monnaie_mapping",
        ):
            conn.execute(sa.text(f"DELETE FROM {table} WHERE preset_id IN ({marques})"))
        conn.execute(sa.text(f"DELETE FROM import_preset WHERE id IN ({marques})"))

    op.drop_index("ix_action_code_isin", table_name="action")
    with op.batch_alter_table("action", schema=None) as batch_op:
        batch_op.drop_column("code_isin")

    # La recréation retire la contrainte composite ET les quatre colonnes, et
    # restitue l'unicité sur le nom seul telle que 0014 l'avait posée.
    with op.batch_alter_table(
        "import_preset", copy_from=_table_import_preset(avec_domaine=False), schema=None
    ) as batch_op:
        batch_op.create_unique_constraint("uq_import_preset_nom", ["nom"])
