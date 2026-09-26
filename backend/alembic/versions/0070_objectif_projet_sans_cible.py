"""Un objectif peut viser un PROJET, et peut n'avoir aucune cible.

DEUX CHANGEMENTS SUR `objectif_kpi`, et ils répondent à la même demande : suivre
un projet depuis le dashboard.

1. `sous_filtre_id` — LE TROISIÈME PÉRIMÈTRE D'UN OBJECTIF. Il y en avait deux,
   « toutes les dépenses » et « une catégorie » ; il en manquait un, et c'était
   justement celui qu'on regarde le plus souvent de près : un PROJET (un voyage,
   un déménagement, des travaux). Son total se lisait sur la page des projets,
   c'est-à-dire partout sauf là où l'on se demande où l'on en est — devant les
   dépenses du mois. Un objectif est le seul objet de l'application qui sache
   poser un chiffre sous les graphes du dashboard ; lui apprendre à désigner un
   projet coûte une colonne, et lui fait faire ce travail-là.

   MUTUELLEMENT EXCLUSIF AVEC LA CATÉGORIE, et une contrainte le dit plutôt
   qu'un commentaire : les deux découpent les mêmes dépenses selon deux axes qui
   se croisent (l'hôtel d'un voyage est dans « Loisirs » ET dans « Italie »), et
   un objectif qui porterait les deux poserait une question — « l'intersection,
   ou l'union ? » — à laquelle personne n'a de réponse évidente.

   SET NULL À LA SUPPRESSION, comme la catégorie : supprimer un projet ÉLARGIT
   l'objectif à toutes les dépenses au lieu de l'emporter. Un objectif qu'on a
   écrit ne disparaît pas pour un geste fait sur un autre écran.

2. `cible` DEVIENT NULLABLE — « suivre sans se fixer de règle ». Un projet en
   cours est le cas ordinaire : on veut voir ce qu'il coûte, mois après mois,
   bien avant de savoir ce qu'on s'autorise. Il fallait jusqu'ici inventer un
   nombre, et l'objectif annonçait alors « tenu » ou « manqué » sur une cible
   qui ne voulait rien dire — un jugement sur une règle qu'on ne s'était pas
   donnée. NULL et zéro ne se confondent pas : zéro reste une cible, et une
   cible sévère (« aucune sortie ce mois-ci »).

Revision ID: 0070
Revises: 0069
Create Date: 2026-09-20
"""
from alembic import op
import sqlalchemy as sa

revision = "0070"
down_revision = "0069"
branch_labels = None
depends_on = None


def _table_objectif_kpi(*, avec_projet: bool, cible_nullable: bool) -> sa.Table:
    """La table telle qu'elle est AVANT (ou APRÈS) la migration.

    SQLite ne sait ni ajouter une clé étrangère ni changer la nullabilité d'une
    colonne : `batch_alter_table` recrée la table, et il lui faut pour cela la
    définition complète — d'où cette description, sur le modèle de la migration
    0067."""
    colonnes = [
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column("nom", sa.String(), nullable=False),
        sa.Column("mesure", sa.String(), nullable=False),
        sa.Column("cadence", sa.String(), nullable=False, server_default="mois"),
        sa.Column("sens", sa.String(), nullable=False, server_default="max"),
        sa.Column("cible", sa.Float(), nullable=cible_nullable),
        sa.Column(
            "categorie_id",
            sa.Integer(),
            sa.ForeignKey("categorie.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column(
            "monnaie_id", sa.Integer(), sa.ForeignKey("monnaie.id"), nullable=False
        ),
        sa.Column(
            "visible_dashboard",
            sa.Boolean(),
            nullable=False,
            server_default=sa.text("1"),
        ),
        sa.Column("ordre", sa.Integer(), nullable=False, server_default="0"),
    ]
    if avec_projet:
        colonnes.insert(
            7,
            sa.Column(
                "sous_filtre_id",
                sa.Integer(),
                sa.ForeignKey("sous_filtre.id", ondelete="SET NULL"),
                nullable=True,
            ),
        )
    contraintes = [
        sa.CheckConstraint(
            "mesure IN ('nombre', 'montant_total', 'montant_moyen', 'part_depenses')",
            name="ck_objectif_kpi_mesure",
        ),
        sa.CheckConstraint(
            "cadence IN ('semaine', 'mois')", name="ck_objectif_kpi_cadence"
        ),
        sa.CheckConstraint("sens IN ('max', 'min')", name="ck_objectif_kpi_sens"),
        # NULL traverse un CHECK sans le violer : « pas de cible » reste donc
        # permis, et une cible écrite reste tenue de ne pas être négative.
        sa.CheckConstraint("cible >= 0", name="ck_objectif_kpi_cible"),
    ]
    if avec_projet:
        contraintes.append(
            sa.CheckConstraint(
                "categorie_id IS NULL OR sous_filtre_id IS NULL",
                name="ck_objectif_kpi_perimetre",
            )
        )
    return sa.Table(
        "objectif_kpi", sa.MetaData(), *colonnes, *contraintes
    )


def upgrade():
    with op.batch_alter_table(
        "objectif_kpi",
        copy_from=_table_objectif_kpi(avec_projet=False, cible_nullable=False),
        schema=None,
    ) as batch:
        # LA CLÉ ÉTRANGÈRE PORTE UN NOM, et c'est une obligation d'alembic en
        # mode « batch » : la table est recréée, et une contrainte ajoutée au
        # passage doit pouvoir être nommée dans le CREATE TABLE.
        batch.add_column(
            sa.Column(
                "sous_filtre_id",
                sa.Integer(),
                sa.ForeignKey(
                    "sous_filtre.id",
                    ondelete="SET NULL",
                    name="fk_objectif_kpi_sous_filtre",
                ),
                nullable=True,
            )
        )
        batch.alter_column("cible", existing_type=sa.Float(), nullable=True)
        batch.create_check_constraint(
            "ck_objectif_kpi_perimetre",
            "categorie_id IS NULL OR sous_filtre_id IS NULL",
        )
    op.create_index("ix_objectif_kpi_sous_filtre", "objectif_kpi", ["sous_filtre_id"])


def downgrade():
    # REDESCENDRE RAMÈNE UNE CIBLE À ZÉRO là où il n'y en avait pas : c'est la
    # seule valeur que la colonne sache porter à nouveau. L'objectif reste, sa
    # lecture change — il se remettra à dire « tenu » ou « manqué ».
    op.drop_index("ix_objectif_kpi_sous_filtre", table_name="objectif_kpi")
    op.get_bind().execute(sa.text("UPDATE objectif_kpi SET cible = 0 WHERE cible IS NULL"))
    with op.batch_alter_table(
        "objectif_kpi",
        copy_from=_table_objectif_kpi(avec_projet=True, cible_nullable=True),
        schema=None,
    ) as batch:
        batch.drop_constraint("ck_objectif_kpi_perimetre", type_="check")
        batch.alter_column(
            "cible", existing_type=sa.Float(), nullable=False, server_default="0"
        )
        batch.drop_column("sous_filtre_id")
