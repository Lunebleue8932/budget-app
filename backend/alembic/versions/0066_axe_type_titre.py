"""Une étiquette de titre porte désormais un AXE, et un titre en porte deux.

CE QUE ÇA SÉPARE, et c'est toute la raison de cette migration : l'ENVELOPPE dit
COMMENT un titre est détenu — « ETF », « Action en direct », « SCPI » — et la
CLASSE D'ACTIF dit À QUOI il expose — « Actions », « Obligations »,
« Immobilier ». Un ETF obligataire est les DEUX à la fois. Tant qu'une seule
colonne portait la question, il fallait choisir : le camembert d'exposition
répondait alors à l'une ou à l'autre, jamais aux deux, et « ETF 60 % /
Actions 40 % » est un graphe de CONTENANTS qui ne dit rien de l'exposition
réelle du portefeuille.

UNE SEULE TABLE POUR LES DEUX AXES, et pas une table de plus — même patron que
`import_preset.domaine` (bancaire / placement), pour la même raison : tout ce
qui entoure ces étiquettes est identique et se scope par une colonne. Un nom, un
ordre, une unicité, une suppression qui détype sans rien emporter, et aucun
calcul qui les lise. Dupliquer la table aurait dupliqué son CRUD, son routeur et
son écran — et avec eux chaque correction future.

L'UNICITÉ PASSE SUR LE COUPLE (axe, nom). « Actions » est une classe d'actif
parfaitement légitime alors qu'« Action en direct » est une enveloppe : rien ne
justifie qu'un axe interdise un libellé à l'autre. Sans ce changement, la
première classe d'actif se serait heurtée au type de titre du même nom.

TOUT TYPE EXISTANT DEVIENT UNE ENVELOPPE, ce qui est exactement ce qu'il était :
la colonne `axe` a « enveloppe » pour défaut, aucune reprise de données n'est
nécessaire, et `action.type_titre_id` continue de désigner la même chose.

LE SEED DES CLASSES EST SANS CONDITION, contrairement à celui des catégories de
dépense (cf. 0064, qui ne s'applique qu'à une base neuve). Deux différences le
permettent : l'axe est NEUF — aucune classe n'existe nulle part, il n'y a donc
rien à écraser ni aucune liste composée à la main à bousculer — et ce vocabulaire
ne décrit le budget de personne, c'est le même pour tout le monde. Elles se
renomment et se suppriment comme n'importe quelle étiquette.

Revision ID: 0066
Revises: 0065
Create Date: 2026-09-19
"""
from alembic import op
import sqlalchemy as sa

revision = "0066"
down_revision = "0065"
branch_labels = None
depends_on = None

CLASSES = ["Actions", "Obligations", "Immobilier", "Matières premières", "Monétaire"]


def _table_type_titre(avec_contraintes_axe: bool) -> sa.Table:
    """La définition EXPLICITE de type_titre, telle qu'elle est AU MOMENT du
    batch — même procédé que la migration 0041 sur `import_preset`.

    EXPLICITE ET NON REFLÉTÉE, c'est tout l'intérêt de `copy_from` : à l'aller,
    la réflexion rapporterait l'unicité sur le seul `nom` (posée en 0047) et la
    recréation la reconduirait, alors que c'est elle qu'on vient remplacer. Au
    retour, elle rapporterait la contrainte CHECK sur `axe` et la recréerait sur
    une table d'où la colonne vient de partir — « no such column: axe ».

    `avec_contraintes_axe` distingue donc les deux sens : à l'aller la colonne
    `axe` existe déjà mais aucune contrainte ne la nomme, au retour les deux la
    nomment et doivent partir avec elle."""
    metadata = sa.MetaData()
    contraintes = []
    if avec_contraintes_axe:
        contraintes = [
            sa.UniqueConstraint("axe", "nom", name="uq_type_titre_axe_nom"),
            sa.CheckConstraint("axe IN ('enveloppe', 'classe')", name="ck_type_titre_axe"),
        ]
    return sa.Table(
        "type_titre",
        metadata,
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column("nom", sa.String, nullable=False),
        sa.Column("axe", sa.String, nullable=False, server_default="enveloppe"),
        sa.Column("ordre", sa.Integer, nullable=False, server_default="0"),
        *contraintes,
    )


def upgrade():
    with op.batch_alter_table("type_titre") as batch:
        batch.add_column(
            sa.Column(
                "axe", sa.String(), nullable=False, server_default="enveloppe"
            )
        )

    # Puis l'unicité, qui demande une recréation de la table : SQLite ne sait
    # pas remplacer une contrainte en place. `copy_from` décrit la table SANS
    # l'unicité sur `nom` — la nouvelle ne portera donc que celle posée ici.
    with op.batch_alter_table(
        "type_titre", copy_from=_table_type_titre(avec_contraintes_axe=False), schema=None
    ) as batch:
        batch.create_unique_constraint("uq_type_titre_axe_nom", ["axe", "nom"])
        batch.create_check_constraint(
            "ck_type_titre_axe", "axe IN ('enveloppe', 'classe')"
        )

    with op.batch_alter_table("action") as batch:
        # La clé étrangère est posée à part et NOMMÉE : en mode batch, SQLite
        # recrée la table, et une contrainte anonyme n'a alors aucun nom à
        # inscrire dans le nouveau schéma (même procédé que la migration 0054).
        batch.add_column(sa.Column("classe_actif_id", sa.Integer(), nullable=True))
        batch.create_foreign_key(
            "fk_action_classe_actif",
            "type_titre",
            ["classe_actif_id"],
            ["id"],
            ondelete="SET NULL",
        )
    op.create_index("ix_action_classe_actif", "action", ["classe_actif_id"])

    # Le seed, à la suite de ce qui existe déjà : l'ordre des enveloppes n'est
    # pas bousculé, et les deux axes se rangent chacun de leur côté à l'écran.
    connexion = op.get_bind()
    depart = connexion.execute(sa.text("SELECT COALESCE(MAX(ordre), 0) FROM type_titre")).scalar()
    for rang, nom in enumerate(CLASSES, start=1):
        connexion.execute(
            sa.text("INSERT INTO type_titre (nom, axe, ordre) VALUES (:nom, 'classe', :ordre)"),
            {"nom": nom, "ordre": (depart or 0) + rang},
        )


def downgrade():
    # REDESCENDRE PERD LES CLASSES D'ACTIF et le classement qu'on en avait tiré ;
    # aucune enveloppe ne bouge, aucun titre ne disparaît, aucun montant ne
    # change — c'est ce que garantit le fait qu'aucun calcul ne les lise.
    connexion = op.get_bind()
    connexion.execute(sa.text("UPDATE action SET classe_actif_id = NULL"))
    connexion.execute(sa.text("DELETE FROM type_titre WHERE axe = 'classe'"))

    op.drop_index("ix_action_classe_actif", table_name="action")
    with op.batch_alter_table("action") as batch:
        batch.drop_constraint("fk_action_classe_actif", type_="foreignkey")
        batch.drop_column("classe_actif_id")

    # TOUT EN UN SEUL BATCH : la colonne `axe` et les deux contraintes qui la
    # nomment partent ensemble. Les séparer recréerait la table avec un CHECK
    # portant sur une colonne qui vient d'en sortir.
    with op.batch_alter_table(
        "type_titre", copy_from=_table_type_titre(avec_contraintes_axe=True), schema=None
    ) as batch:
        batch.drop_constraint("ck_type_titre_axe", type_="check")
        batch.drop_constraint("uq_type_titre_axe_nom", type_="unique")
        batch.drop_column("axe")
        batch.create_unique_constraint("uq_type_titre_nom", ["nom"])
