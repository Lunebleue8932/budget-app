"""« Action » devient « titre possédé » : la table du catalogue et celle de ses mouvements.

POURQUOI UN RENOMMAGE, ET PAS SEULEMENT UN LIBELLÉ. Le mot « action » désigne
une ENVELOPPE parmi d'autres (« Action en direct », à côté d'« ETF » ou de
« SCPI »), alors que la table portait TOUS les titres suivis — un ETF, une
obligation, une part de SCPI. Elle va d'ailleurs en porter davantage : les
titres qu'on ne détient pas mais qui servent aux graphiques (les composants d'un
ETF) y entrent aussi, par l'import de titres. Le nom disait une chose étroite
d'une table qui en dit une large.

CE QUI CHANGE, ET RIEN D'AUTRE : `action` -> `titre_possede`, `operation_action`
-> `operation_titre`, et sa colonne `action_id` -> `titre_id`. Aucune ligne n'est
modifiée, aucun montant ne bouge, le code `action` du TYPE d'opération (une
valeur de la table `type_operation`, qui dit « achat / vente de titres ») reste
tel quel : c'est une donnée, pas un nom de table.

RECRÉATION EXPLICITE PLUTÔT QUE `ALTER TABLE … RENAME`. SQLite renomme bien la
table, mais les contraintes et les index NOMMÉS gardent leur ancien nom
(`ck_action_valeur_positive`, `fk_action_monnaie`, `ix_action_code_isin`…) : le
modèle et la base ne se ressembleraient plus, et la prochaine recréation en mode
batch (qui relit ces noms) les traînerait. On écrit donc le schéma neuf en
toutes lettres, on copie, on retire l'ancien — même procédé que la migration 0021.

LES CLÉS ÉTRANGÈRES SONT SANS EFFET PENDANT LA COPIE : `alembic/env.py` n'active
pas `PRAGMA foreign_keys`, ce qui permet de retirer `action` alors que
`operation_action` la référence encore.

Revision ID: 0075
Revises: 0074
Create Date: 2026-10-09
"""
from alembic import op

revision = "0075"
down_revision = "0074"
branch_labels = None
depends_on = None


def _ddl_titre(table: str, prefixe: str) -> str:
    """Le catalogue de titres, tel que la 0074 le laisse — seuls les noms changent."""
    return f"""
        CREATE TABLE {table} (
            id INTEGER NOT NULL,
            nom VARCHAR NOT NULL,
            valeur FLOAT DEFAULT '0' NOT NULL,
            monnaie_id INTEGER NOT NULL,
            url_cours VARCHAR,
            cours_maj_le DATETIME,
            archivee BOOLEAN DEFAULT 0 NOT NULL,
            code_isin VARCHAR,
            nom_affichage VARCHAR,
            type_titre_id INTEGER,
            classe_actif_id INTEGER,
            PRIMARY KEY (id),
            CONSTRAINT ck_{prefixe}_valeur_positive CHECK (valeur >= 0),
            CONSTRAINT fk_{prefixe}_monnaie FOREIGN KEY(monnaie_id) REFERENCES monnaie (id),
            CONSTRAINT fk_{prefixe}_type_titre FOREIGN KEY(type_titre_id)
                REFERENCES type_titre (id) ON DELETE SET NULL,
            CONSTRAINT fk_{prefixe}_classe_actif FOREIGN KEY(classe_actif_id)
                REFERENCES type_titre (id) ON DELETE SET NULL,
            UNIQUE (nom)
        )
    """


def _ddl_mouvement(table: str, colonne: str, cible: str, prefixe: str) -> str:
    """Le versant « titres » d'une opération, tel que la 0074 le laisse."""
    return f"""
        CREATE TABLE {table} (
            id INTEGER NOT NULL,
            operation_id INTEGER NOT NULL,
            {colonne} INTEGER NOT NULL,
            sens VARCHAR NOT NULL,
            quantite FLOAT NOT NULL,
            prix_unitaire FLOAT NOT NULL,
            PRIMARY KEY (id),
            CONSTRAINT ck_{prefixe}_quantite_positive CHECK (quantite > 0),
            CONSTRAINT ck_{prefixe}_prix_positif CHECK (prix_unitaire >= 0),
            CONSTRAINT ck_{prefixe}_sens CHECK (sens IN ('achat', 'vente')),
            UNIQUE (operation_id),
            FOREIGN KEY(operation_id) REFERENCES operation (id) ON DELETE CASCADE,
            FOREIGN KEY({colonne}) REFERENCES {cible} (id)
        )
    """


COLONNES_TITRE = (
    "id, nom, valeur, monnaie_id, url_cours, cours_maj_le, archivee, code_isin, "
    "nom_affichage, type_titre_id, classe_actif_id"
)


def upgrade():
    op.execute(_ddl_titre("titre_possede", "titre_possede"))
    op.execute(
        f"INSERT INTO titre_possede ({COLONNES_TITRE}) SELECT {COLONNES_TITRE} FROM action"
    )
    op.execute(_ddl_mouvement("operation_titre", "titre_id", "titre_possede", "operation_titre"))
    op.execute(
        "INSERT INTO operation_titre (id, operation_id, titre_id, sens, quantite, prix_unitaire) "
        "SELECT id, operation_id, action_id, sens, quantite, prix_unitaire FROM operation_action"
    )
    # Les index partent avec leur table ; on pose les nouveaux, aux noms du modèle.
    op.execute("DROP TABLE operation_action")
    op.execute("DROP TABLE action")
    op.execute("CREATE UNIQUE INDEX ix_titre_possede_code_isin ON titre_possede (code_isin)")
    op.execute("CREATE INDEX ix_titre_possede_classe_actif ON titre_possede (classe_actif_id)")
    op.execute("CREATE INDEX ix_operation_titre_titre_id ON operation_titre (titre_id)")


def downgrade():
    # LE RETOUR EN ARRIÈRE REND LES NOMS D'AVANT, et rien n'est perdu : mêmes colonnes,
    # mêmes lignes. Ce que les migrations suivantes auront ajouté au titre est retiré
    # par leur propre downgrade, qui s'exécute avant celui-ci.
    op.execute(_ddl_titre("action", "action"))
    op.execute(
        f"INSERT INTO action ({COLONNES_TITRE}) SELECT {COLONNES_TITRE} FROM titre_possede"
    )
    op.execute(_ddl_mouvement("operation_action", "action_id", "action", "operation_action"))
    op.execute(
        "INSERT INTO operation_action (id, operation_id, action_id, sens, quantite, prix_unitaire) "
        "SELECT id, operation_id, titre_id, sens, quantite, prix_unitaire FROM operation_titre"
    )
    op.execute("DROP TABLE operation_titre")
    op.execute("DROP TABLE titre_possede")
    op.execute("CREATE UNIQUE INDEX ix_action_code_isin ON action (code_isin)")
    op.execute("CREATE INDEX ix_action_classe_actif ON action (classe_actif_id)")
    op.execute("CREATE INDEX ix_operation_action_action_id ON operation_action (action_id)")
