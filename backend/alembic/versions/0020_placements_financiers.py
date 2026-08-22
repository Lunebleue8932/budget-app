"""comptes de placement et opérations sur titres.

Ajoute un troisième type de compte protégé — « placements financiers » — dont
le solde se lit à deux niveaux : des espèces, alimentées par virement interne
et calculées exactement comme celles de n'importe quel compte, et un
portefeuille de titres détenus.

Un achat ou une vente crée deux lignes solidaires :
 - une `operation` de type `action` (nouveau, marqué `interne`), qui porte le
   mouvement d'espèces — d'où le fait que les soldes, projections et agrégats
   du dashboard n'aient besoin d'aucun cas particulier ;
 - une `operation_action`, qui porte le versant titres (quel titre, combien, à
   quel prix, dans quel sens).

Les quantités détenues ne sont stockées nulle part : elles se somment depuis
`operation_action` pour un couple (compte, titre) donné.

La colonne `type_operation.interne` distingue les types choisis par
l'utilisateur de ceux gérés par une page dédiée (ici les titres) : ces derniers
sont exclus des menus de type et refusés par les endpoints /operations.

Revision ID: 0020
Revises: 0019
Create Date: 2026-08-03
"""
from alembic import op
import sqlalchemy as sa

revision = "0020"
down_revision = "0019"
branch_labels = None
depends_on = None

TYPE_COMPTE_PLACEMENT = "placements financiers"
CODE_TYPE_ACTION = "action"
NOM_TYPE_ACTION = "Achat / vente de titres"


def upgrade():
    connexion = op.get_bind()

    # ---------- Type de compte ----------
    # systeme=1 : comme "courant" et "épargne", il pilote des règles métier
    # (page Placements, exclusion des KPI courants) et n'est pas supprimable.
    existe = connexion.execute(
        sa.text("SELECT id FROM type_compte WHERE nom = :nom"),
        {"nom": TYPE_COMPTE_PLACEMENT},
    ).fetchone()
    if existe is None:
        connexion.execute(
            sa.text("INSERT INTO type_compte (nom, systeme) VALUES (:nom, 1)"),
            {"nom": TYPE_COMPTE_PLACEMENT},
        )

    # ---------- Type d'opération ----------
    with op.batch_alter_table("type_operation", schema=None) as batch_op:
        batch_op.add_column(
            sa.Column("interne", sa.Boolean, nullable=False, server_default=sa.false())
        )

    ordre_max = connexion.execute(
        sa.text("SELECT COALESCE(MAX(ordre), 0) FROM type_operation")
    ).scalar()
    connexion.execute(
        sa.text(
            "INSERT INTO type_operation (code, nom, ordre, interne) "
            "VALUES (:code, :nom, :ordre, 1)"
        ),
        {"code": CODE_TYPE_ACTION, "nom": NOM_TYPE_ACTION, "ordre": ordre_max + 1},
    )

    # ---------- Titres ----------
    op.create_table(
        "action",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        sa.Column("nom", sa.String, nullable=False, unique=True),
        # Dernier cours unitaire connu, saisi à la main (l'app n'a aucune source
        # de marché) : sert à valoriser le portefeuille, jamais à calculer un
        # solde en espèces.
        sa.Column("valeur", sa.Float, nullable=False, server_default="0"),
        sa.CheckConstraint("valeur >= 0", name="ck_action_valeur_positive"),
    )

    op.create_table(
        "operation_action",
        sa.Column("id", sa.Integer, primary_key=True, autoincrement=True),
        # unique : une écriture d'espèces porte au plus un mouvement de titres.
        # CASCADE : les deux lignes meurent ensemble.
        sa.Column(
            "operation_id",
            sa.Integer,
            sa.ForeignKey("operation.id", ondelete="CASCADE"),
            nullable=False,
            unique=True,
        ),
        sa.Column("action_id", sa.Integer, sa.ForeignKey("action.id"), nullable=False),
        sa.Column("sens", sa.String, nullable=False),
        sa.Column("quantite", sa.Float, nullable=False),
        sa.Column("prix_unitaire", sa.Float, nullable=False),
        sa.CheckConstraint("quantite > 0", name="ck_operation_action_quantite_positive"),
        sa.CheckConstraint("prix_unitaire >= 0", name="ck_operation_action_prix_positif"),
        sa.CheckConstraint("sens IN ('achat', 'vente')", name="ck_operation_action_sens"),
    )
    op.create_index("ix_operation_action_action_id", "operation_action", ["action_id"])


def downgrade():
    connexion = op.get_bind()

    op.drop_index("ix_operation_action_action_id", table_name="operation_action")
    op.drop_table("operation_action")
    op.drop_table("action")

    # Les écritures d'espèces des titres n'ont plus de contrepartie : les
    # laisser en ferait des opérations orphelines dont le type n'existe plus.
    connexion.execute(
        sa.text(
            "DELETE FROM operation WHERE type_id = "
            "(SELECT id FROM type_operation WHERE code = :code)"
        ),
        {"code": CODE_TYPE_ACTION},
    )
    connexion.execute(
        sa.text("DELETE FROM type_operation WHERE code = :code"), {"code": CODE_TYPE_ACTION}
    )

    with op.batch_alter_table("type_operation", schema=None) as batch_op:
        batch_op.drop_column("interne")

    # Le type de compte n'est retiré que s'il n'a jamais servi : supprimer un
    # type encore référencé casserait les comptes concernés.
    connexion.execute(
        sa.text(
            "DELETE FROM type_compte WHERE nom = :nom "
            "AND NOT EXISTS (SELECT 1 FROM compte WHERE compte.type_id = type_compte.id)"
        ),
        {"nom": TYPE_COMPTE_PLACEMENT},
    )
