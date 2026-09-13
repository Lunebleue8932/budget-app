"""Ce que l'extension « Analyse de budget » a besoin d'écrire, et rien de plus.

DEUX CHOSES SEULEMENT, et elles vivent dans le NOYAU comme tout ce qu'une
extension écrit (cf. extensions/README.md) : éteindre l'extension ne doit jamais
effacer ce qu'on a saisi, et une colonne qui disparaîtrait avec elle rendrait sa
désactivation destructrice.

  - `operation.imprevue` — UNE DÉPENSE QU'ON N'AVAIT PAS VUE VENIR. Le
    plombier, la dent cassée, le pneu. Une ÉTIQUETTE, de la même nature que
    `TypeTitre` ou `ProfilRemboursement` : aucun solde, aucun KPI, aucune barre
    d'histogramme ne la lit, et l'application donne exactement les mêmes chiffres
    que l'extension tourne ou non. Elle répond à une question qu'aucune catégorie
    ne pose — « combien de ce mois n'était pas prévisible ? » — et qui ne se
    déduit d'aucune autre colonne : une dépense d'alimentation peut être
    imprévue, une réparation peut être parfaitement attendue.

    UNE COLONNE ET NON UNE TABLE ANNEXE d'identifiants. C'est un BOOLÉEN de
    cardinalité 1, sans champ compagnon : une table de côté aurait coûté une
    jointure par lecture pour économiser UN OCTET par ligne (mesuré : un NULL
    coûte son seul octet d'en-tête en SQLite). La table annexe est le bon
    patron quand la cardinalité n'est PAS 1 — c'est déjà ce que font
    `operation_decoupe` (une opération, plusieurs parts) et
    `operation_sous_filtre` (plusieurs projets, plusieurs opérations).

  - `matelas_securite` — LE MINIMUM QU'ON VEUT GARDER DISPONIBLE sur ses comptes
    d'épargne, par monnaie. Un montant par devise et rien d'autre : « 3 000 »
    ne veut rien dire sans savoir en quelle monnaie, exactement comme un budget
    (cf. `budget_total_mensuel`). PAS DE MOIS dans la clé, en revanche, et c'est
    la différence : un budget se révise tous les mois, un matelas est une
    intention stable qu'on repose rarement.

    AUCUN CONTRÔLE N'EN DÉCOULE. Franchir son matelas n'empêche rien, ne bloque
    aucune saisie et ne refuse aucun virement — l'application CONSTATE et le
    DIT, là où on regarde ses comptes d'épargne. Une garde qui refuserait un
    virement au motif qu'on descend sous son propre seuil se ferait contourner
    au premier besoin réel, et aurait appris à ne plus être lue.

Revision ID: 0059
Revises: 0058
Create Date: 2026-09-13
"""
from alembic import op
import sqlalchemy as sa

revision = "0059"
down_revision = "0058"
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table("operation") as batch:
        batch.add_column(
            sa.Column(
                "imprevue", sa.Boolean(), nullable=False, server_default=sa.text("0")
            )
        )
    op.create_index("ix_operation_imprevue", "operation", ["imprevue"])

    op.create_table(
        "matelas_securite",
        sa.Column("id", sa.Integer(), primary_key=True, autoincrement=True),
        sa.Column(
            "monnaie_id", sa.Integer(), sa.ForeignKey("monnaie.id"), nullable=False
        ),
        sa.Column("montant", sa.Float(), nullable=False, server_default="0"),
        sa.UniqueConstraint("monnaie_id", name="uq_matelas_securite_monnaie"),
        sa.CheckConstraint("montant >= 0", name="ck_matelas_securite_montant"),
    )


def downgrade():
    # REDESCENDRE PERD LES ÉTIQUETTES « imprévue » ET LES SEUILS, et rien
    # d'autre : aucune opération ne disparaît, aucun montant ne change. C'est
    # précisément ce que garantit le fait que rien ne les lise dans les calculs.
    op.drop_table("matelas_securite")
    op.drop_index("ix_operation_imprevue", table_name="operation")
    with op.batch_alter_table("operation") as batch:
        batch.drop_column("imprevue")
