"""Un titre s'identifie par le couple (nom, ISIN) : le nom seul n'est plus unique.

POURQUOI. Un courtier abrège le libellé de deux titres DIFFÉRENTS de la même façon
(« SS SPDR MSCI EUR. » pour deux ETF SPDR distincts). L'unicité du nom faisait échouer
l'import du second en plein milieu, ce qui était déjà écrit restant écrit. C'est l'ISIN qui
dit si deux lignes désignent le même titre (cf. services/identite_titre.py).

CE QUI RESTE UNIQUE :
  - l'ISIN (index `ix_titre_possede_code_isin`, inchangé) ;
  - le nom des titres SANS ISIN (index partiel `ux_titre_possede_nom_sans_isin`) : deux
    titres sans code et de même nom ne se distingueraient de rien.

RECRÉATION EXPLICITE, comme la 0075 : l'unicité du nom est une contrainte de TABLE, que
SQLite ne sait pas retirer autrement. Aucune ligne ne change.

LE RETOUR ARRIÈRE remet l'unicité du nom. Des homonymes créés depuis l'en empêcheraient :
le second (et les suivants) prennent leur ISIN entre parenthèses à la suite du nom.

Revision ID: 0080
Revises: 0079
Create Date: 2026-10-10
"""
from alembic import op

revision = "0080"
down_revision = "0079"
branch_labels = None
depends_on = None

COLONNES = (
    "id, nom, valeur, monnaie_id, url_cours, cours_maj_le, archivee, code_isin, "
    "nom_affichage, type_titre_id, composition, composition_couverture_pct"
)


def _ddl(table: str, nom_unique: bool) -> str:
    unicite = ",\n            UNIQUE (nom)" if nom_unique else ""
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
            composition JSON,
            composition_couverture_pct FLOAT,
            PRIMARY KEY (id),
            CONSTRAINT ck_titre_possede_valeur_positive CHECK (valeur >= 0),
            CONSTRAINT fk_titre_possede_monnaie FOREIGN KEY(monnaie_id) REFERENCES monnaie (id),
            CONSTRAINT fk_titre_possede_type_titre FOREIGN KEY(type_titre_id)
                REFERENCES type_titre (id) ON DELETE SET NULL{unicite}
        )
    """


def _recreer(nom_unique: bool) -> None:
    """La table refaite à neuf, sous son nom, avec ou sans l'unicité du nom. Les clés
    étrangères d'`operation_titre` et d'`exposition_titre` désignent `titre_possede` par son
    nom : elles retrouvent la nouvelle table une fois renommée (alembic/env.py n'active pas
    `PRAGMA foreign_keys`, la copie ne les déclenche pas)."""
    op.execute(_ddl("_titre_possede_nouvelle", nom_unique))
    op.execute(
        f"INSERT INTO _titre_possede_nouvelle ({COLONNES}) SELECT {COLONNES} FROM titre_possede"
    )
    op.execute("DROP TABLE titre_possede")
    op.execute("ALTER TABLE _titre_possede_nouvelle RENAME TO titre_possede")
    op.execute("CREATE UNIQUE INDEX ix_titre_possede_code_isin ON titre_possede (code_isin)")


def upgrade():
    _recreer(nom_unique=False)
    op.execute(
        "CREATE UNIQUE INDEX ux_titre_possede_nom_sans_isin ON titre_possede (nom) "
        "WHERE code_isin IS NULL"
    )


def downgrade():
    # Les homonymes : le premier garde son nom, les suivants prennent leur ISIN en suffixe.
    op.execute(
        """
        UPDATE titre_possede
        SET nom = nom || ' (' || COALESCE(code_isin, CAST(id AS TEXT)) || ')'
        WHERE id IN (
            SELECT t.id FROM titre_possede t
            WHERE EXISTS (
                SELECT 1 FROM titre_possede autre WHERE autre.nom = t.nom AND autre.id < t.id
            )
        )
        """
    )
    op.execute("DROP INDEX IF EXISTS ux_titre_possede_nom_sans_isin")
    _recreer(nom_unique=True)
