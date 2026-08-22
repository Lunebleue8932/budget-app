"""plusieurs monnaies par compte.

Jusqu'ici tous les montants de l'app étaient implicitement en euros : aucune
colonne ne disait dans quelle monnaie était libellé un solde, un budget ou une
opération. Cette migration rend la monnaie explicite partout.

Le choix structurant est de NE PAS dupliquer le compte : un compte en euros et
en dollars reste une seule ligne `compte`, à laquelle s'accrochent autant de
lignes `compte_monnaie` que de monnaies. Dupliquer le compte aurait imposé de
reprendre tout ce qui pointe vers lui (opérations, correspondances d'import,
virements) et n'aurait pas été réversible.

Conséquences directes :
 - `compte.solde_initial` déménage dans `compte_monnaie` : un compte à deux
   monnaies a deux soldes de départ, une seule colonne ne pouvait pas dire
   lequel ;
 - `operation.monnaie_id` devient obligatoire — c'est lui qui permet à un
   virement entre deux comptes de monnaies différentes d'être simplement deux
   écritures portant chacune sa monnaie et son montant, sans que l'app ait à
   connaître le moindre taux de change ;
 - `categorie_budget_mensuel` gagne la monnaie dans sa clé : un budget « 300 »
   ne veut rien dire si la catégorie est dépensée en euros et en dollars ;
 - `action.monnaie_id` est la monnaie de cotation d'un titre : cours, prix payés
   et valorisation en découlent tous.

Toutes les données existantes sont rattachées à une unique monnaie « Euro »,
créée ici, qui reflète ce qu'elles étaient déjà implicitement.

Revision ID: 0021
Revises: 0020
Create Date: 2026-08-03
"""
from alembic import op
import sqlalchemy as sa

revision = "0021"
down_revision = "0020"
branch_labels = None
depends_on = None

MONNAIE_INITIALE_NOM = "Euro"
MONNAIE_INITIALE_SYMBOLE = "€"


def upgrade():
    connexion = op.get_bind()

    # ---------- Monnaies ----------
    op.create_table(
        "monnaie",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column("nom", sa.String, nullable=False, unique=True),
        sa.Column("symbole", sa.String, nullable=False),
        sa.Column("ordre", sa.Integer, nullable=False, server_default="0"),
    )
    connexion.execute(
        sa.text("INSERT INTO monnaie (nom, symbole, ordre) VALUES (:nom, :symbole, 0)"),
        {"nom": MONNAIE_INITIALE_NOM, "symbole": MONNAIE_INITIALE_SYMBOLE},
    )
    monnaie_id = connexion.execute(
        sa.text("SELECT id FROM monnaie WHERE nom = :nom"), {"nom": MONNAIE_INITIALE_NOM}
    ).scalar()

    # ---------- Monnaies d'un compte ----------
    op.create_table(
        "compte_monnaie",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column(
            "compte_id",
            sa.Integer,
            sa.ForeignKey("compte.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("monnaie_id", sa.Integer, sa.ForeignKey("monnaie.id"), nullable=False),
        sa.Column("solde_initial", sa.Float, nullable=False, server_default="0"),
        sa.Column("ordre", sa.Integer, nullable=False, server_default="0"),
        sa.UniqueConstraint("compte_id", "monnaie_id", name="uq_compte_monnaie"),
    )
    op.create_index("ix_compte_monnaie_compte", "compte_monnaie", ["compte_id"])
    op.create_index("ix_compte_monnaie_monnaie", "compte_monnaie", ["monnaie_id"])

    # Chaque compte existant devient un compte mono-monnaie, avec le solde
    # initial qu'il portait déjà.
    connexion.execute(
        sa.text(
            "INSERT INTO compte_monnaie (compte_id, monnaie_id, solde_initial, ordre) "
            "SELECT id, :monnaie_id, solde_initial, 0 FROM compte"
        ),
        {"monnaie_id": monnaie_id},
    )
    with op.batch_alter_table("compte", schema=None) as batch_op:
        batch_op.drop_column("solde_initial")

    # ---------- Opérations ----------
    with op.batch_alter_table("operation", schema=None) as batch_op:
        batch_op.add_column(sa.Column("monnaie_id", sa.Integer, nullable=True))
    connexion.execute(
        sa.text("UPDATE operation SET monnaie_id = :monnaie_id"), {"monnaie_id": monnaie_id}
    )
    with op.batch_alter_table("operation", schema=None) as batch_op:
        batch_op.alter_column("monnaie_id", existing_type=sa.Integer, nullable=False)
        batch_op.create_foreign_key("fk_operation_monnaie", "monnaie", ["monnaie_id"], ["id"])
        batch_op.create_index("ix_operation_monnaie_id", ["monnaie_id"])

    # ---------- Titres ----------
    with op.batch_alter_table("action", schema=None) as batch_op:
        batch_op.add_column(sa.Column("monnaie_id", sa.Integer, nullable=True))
    connexion.execute(
        sa.text("UPDATE action SET monnaie_id = :monnaie_id"), {"monnaie_id": monnaie_id}
    )
    with op.batch_alter_table("action", schema=None) as batch_op:
        batch_op.alter_column("monnaie_id", existing_type=sa.Integer, nullable=False)
        batch_op.create_foreign_key("fk_action_monnaie", "monnaie", ["monnaie_id"], ["id"])

    # ---------- Budgets ----------
    # Recréation à la main plutôt que batch_alter_table : il faut à la fois
    # ajouter une colonne NOT NULL et remplacer la contrainte d'unicité, et la
    # réflexion SQLite des CHECK est trop incertaine pour laisser alembic
    # reconstruire la table à notre place.
    connexion.execute(
        sa.text(
            """
            CREATE TABLE categorie_budget_mensuel_nouveau (
                id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
                categorie_id INTEGER NOT NULL REFERENCES categorie(id) ON DELETE CASCADE,
                monnaie_id INTEGER NOT NULL REFERENCES monnaie(id),
                annee INTEGER NOT NULL,
                mois INTEGER NOT NULL,
                montant FLOAT NOT NULL DEFAULT 0,
                CONSTRAINT uq_categorie_budget_mensuel
                    UNIQUE (categorie_id, annee, mois, monnaie_id),
                CONSTRAINT ck_categorie_budget_mensuel_mois CHECK (mois >= 1 AND mois <= 12)
            )
            """
        )
    )
    connexion.execute(
        sa.text(
            "INSERT INTO categorie_budget_mensuel_nouveau "
            "(id, categorie_id, monnaie_id, annee, mois, montant) "
            "SELECT id, categorie_id, :monnaie_id, annee, mois, montant "
            "FROM categorie_budget_mensuel"
        ),
        {"monnaie_id": monnaie_id},
    )
    connexion.execute(sa.text("DROP TABLE categorie_budget_mensuel"))
    connexion.execute(
        sa.text(
            "ALTER TABLE categorie_budget_mensuel_nouveau RENAME TO categorie_budget_mensuel"
        )
    )
    op.create_index(
        "ix_categorie_budget_mensuel_categorie", "categorie_budget_mensuel", ["categorie_id"]
    )
    op.create_index(
        "ix_categorie_budget_mensuel_monnaie", "categorie_budget_mensuel", ["monnaie_id"]
    )


def downgrade():
    connexion = op.get_bind()

    # ---------- Budgets ----------
    # Retour à une clé sans monnaie : deux budgets d'un même mois dans deux
    # monnaies différentes ne peuvent plus coexister, seul le premier survit.
    connexion.execute(
        sa.text(
            """
            CREATE TABLE categorie_budget_mensuel_ancien (
                id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT,
                categorie_id INTEGER NOT NULL REFERENCES categorie(id) ON DELETE CASCADE,
                annee INTEGER NOT NULL,
                mois INTEGER NOT NULL,
                montant FLOAT NOT NULL DEFAULT 0,
                CONSTRAINT uq_categorie_budget_mensuel UNIQUE (categorie_id, annee, mois),
                CONSTRAINT ck_categorie_budget_mensuel_mois CHECK (mois >= 1 AND mois <= 12)
            )
            """
        )
    )
    connexion.execute(
        sa.text(
            "INSERT INTO categorie_budget_mensuel_ancien (categorie_id, annee, mois, montant) "
            "SELECT categorie_id, annee, mois, MIN(montant) FROM categorie_budget_mensuel "
            "GROUP BY categorie_id, annee, mois"
        )
    )
    connexion.execute(sa.text("DROP TABLE categorie_budget_mensuel"))
    connexion.execute(
        sa.text("ALTER TABLE categorie_budget_mensuel_ancien RENAME TO categorie_budget_mensuel")
    )
    op.create_index(
        "ix_categorie_budget_mensuel_categorie", "categorie_budget_mensuel", ["categorie_id"]
    )

    # ---------- Titres ----------
    with op.batch_alter_table("action", schema=None) as batch_op:
        batch_op.drop_constraint("fk_action_monnaie", type_="foreignkey")
        batch_op.drop_column("monnaie_id")

    # ---------- Opérations ----------
    with op.batch_alter_table("operation", schema=None) as batch_op:
        batch_op.drop_index("ix_operation_monnaie_id")
        batch_op.drop_constraint("fk_operation_monnaie", type_="foreignkey")
        batch_op.drop_column("monnaie_id")

    # ---------- Comptes ----------
    # Le solde initial revient sur le compte : celui de sa première monnaie,
    # les autres étant perdus (le schéma d'avant ne sait pas les représenter).
    with op.batch_alter_table("compte", schema=None) as batch_op:
        batch_op.add_column(
            sa.Column("solde_initial", sa.Float, nullable=False, server_default="0")
        )
    connexion.execute(
        sa.text(
            "UPDATE compte SET solde_initial = COALESCE(("
            "  SELECT solde_initial FROM compte_monnaie "
            "  WHERE compte_monnaie.compte_id = compte.id "
            "  ORDER BY ordre, id LIMIT 1"
            "), 0)"
        )
    )

    op.drop_index("ix_compte_monnaie_monnaie", table_name="compte_monnaie")
    op.drop_index("ix_compte_monnaie_compte", table_name="compte_monnaie")
    op.drop_table("compte_monnaie")
    op.drop_table("monnaie")
