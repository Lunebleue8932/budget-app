"""Un titre se DÉCRIT sur quatre axes, et trois d'entre eux sont des RÉPARTITIONS.

CE QUE LA 0066 NE POUVAIT PAS DIRE. Un titre avait UNE classe d'actif : une
colonne, une étiquette. C'est exact pour une action en direct, et faux pour tout
ce qui est un panier — un ETF World n'est pas « Monde », il est 65 % États-Unis,
15 % Europe, 6 % Japon… ; un fonds diversifié n'est ni « Actions » ni
« Obligations », il est 60 % de l'un et 40 % de l'autre. Les graphes qui viendront
(zone, secteur, exposition par action) additionnent des valorisations PONDÉRÉES :
une étiquette unique n'a rien à pondérer.

TROIS AXES D'EXPOSITION, UNE TABLE : `exposition_titre` (titre, axe, étiquette,
poids en %). Un titre en direct porte une ligne à 100 % ; un panier en porte
plusieurs. L'ENVELOPPE reste une colonne : un titre n'a qu'une enveloppe, elle dit
comment il est DÉTENU, pas à quoi il expose. Les étiquettes restent toutes dans
`type_titre`, dont l'axe prend deux valeurs de plus (`zone`, `secteur`) — même
patron que la 0066, pour la même raison : tout ce qui les entoure est identique.

RIEN N'EST RENORMALISÉ, ni ici ni ailleurs : une répartition qui ne somme pas 100
est une répartition INCOMPLÈTE, et le résidu se montrera comme tel dans les
graphes plutôt que d'être étiré en silence sur ce qu'on connaît.

LA CLASSE D'ACTIF MIGRE : chaque `classe_actif_id` devient une ligne à 100 %, et la
colonne disparaît — une seule source de vérité, sans quoi une classe unique et une
répartition auraient fini par se contredire. Le retour arrière reconstruit la
colonne depuis la classe qui pèse le plus.

LE DICTIONNAIRE D'UN ETF (`composition`, `composition_couverture_pct`) : les ISIN
du haut de l'indice et leur poids, et la part de l'indice qu'ils couvrent (le « x % »
que l'utilisateur renseigne). Nullable : seuls les ETF en ont un. Du JSON, parce
qu'on l'écrit et le relit d'un bloc et que personne ne le filtre en base.

LES SEMIS SONT SANS CONDITION, comme les cinq classes de la 0066 : l'axe est neuf,
il n'y a rien à écraser, et ce vocabulaire ne décrit le budget de personne. Les
ZONES SONT EXCLUSIVES — « Asie (hors Chine) », « Amérique (hors États-Unis) » —
parce que la répartition d'un fonds doit sommer ~100 % sans compter deux fois un
même pays. Renommables, supprimables, extensibles.

Revision ID: 0076
Revises: 0075
Create Date: 2026-10-09
"""
from alembic import op

revision = "0076"
down_revision = "0075"
branch_labels = None
depends_on = None

ZONES = [
    "États-Unis",
    "Chine",
    "Europe",
    "Asie (hors Chine)",
    "Amérique (hors États-Unis)",
    "Afrique",
    "Océanie",
]
SECTEURS = [
    "Technologies de l'information",
    "Santé",
    "Finance",
    "Consommation discrétionnaire",
    "Consommation de base",
    "Industrie",
    "Énergie",
    "Services de communication",
    "Services aux collectivités",
    "Matériaux",
    "Immobilier",
]

COLONNES_COMMUNES = (
    "id, nom, valeur, monnaie_id, url_cours, cours_maj_le, archivee, code_isin, "
    "nom_affichage, type_titre_id"
)


def _ddl_type_titre(axes: str) -> str:
    return f"""
        CREATE TABLE type_titre_nouveau (
            id INTEGER NOT NULL,
            nom VARCHAR NOT NULL,
            axe VARCHAR DEFAULT 'enveloppe' NOT NULL,
            PRIMARY KEY (id),
            CONSTRAINT uq_type_titre_axe_nom UNIQUE (axe, nom),
            CONSTRAINT ck_type_titre_axe CHECK (axe IN ({axes}))
        )
    """


def _recreer_type_titre(axes: str) -> None:
    """Remplace `type_titre` par une copie dont le CHECK d'axe est celui demandé.
    SQLite ne sait pas modifier un CHECK en place ; même procédé que la 0075."""
    op.execute(_ddl_type_titre(axes))
    op.execute("INSERT INTO type_titre_nouveau (id, nom, axe) SELECT id, nom, axe FROM type_titre")
    op.execute("DROP TABLE type_titre")
    op.execute("ALTER TABLE type_titre_nouveau RENAME TO type_titre")


def _ddl_titre(avec_classe: bool) -> str:
    """Le catalogue de titres : avec `classe_actif_id` (avant), ou avec le
    dictionnaire d'ETF à la place (après)."""
    if avec_classe:
        colonnes = "classe_actif_id INTEGER,"
        fk = """
            CONSTRAINT fk_titre_possede_classe_actif FOREIGN KEY(classe_actif_id)
                REFERENCES type_titre (id) ON DELETE SET NULL,"""
    else:
        colonnes = "composition JSON,\n            composition_couverture_pct FLOAT,"
        fk = ""
    return f"""
        CREATE TABLE titre_possede_nouveau (
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
            {colonnes}
            PRIMARY KEY (id),
            CONSTRAINT ck_titre_possede_valeur_positive CHECK (valeur >= 0),
            CONSTRAINT fk_titre_possede_monnaie FOREIGN KEY(monnaie_id) REFERENCES monnaie (id),
            CONSTRAINT fk_titre_possede_type_titre FOREIGN KEY(type_titre_id)
                REFERENCES type_titre (id) ON DELETE SET NULL,{fk}
            UNIQUE (nom)
        )
    """


def upgrade():
    # 1. Deux axes de plus pour les étiquettes.
    _recreer_type_titre("'enveloppe', 'classe', 'zone', 'secteur'")
    for nom in ZONES:
        op.execute(f"INSERT INTO type_titre (nom, axe) VALUES ('{nom.replace(chr(39), chr(39) * 2)}', 'zone')")
    for nom in SECTEURS:
        op.execute(f"INSERT INTO type_titre (nom, axe) VALUES ('{nom.replace(chr(39), chr(39) * 2)}', 'secteur')")

    # 2. Les répartitions.
    op.execute(
        """
        CREATE TABLE exposition_titre (
            id INTEGER NOT NULL,
            titre_id INTEGER NOT NULL,
            axe VARCHAR NOT NULL,
            type_titre_id INTEGER NOT NULL,
            poids_pct FLOAT NOT NULL,
            source VARCHAR,
            date_maj DATE,
            PRIMARY KEY (id),
            CONSTRAINT ck_exposition_titre_axe CHECK (axe IN ('classe', 'zone', 'secteur')),
            CONSTRAINT ck_exposition_titre_poids CHECK (poids_pct > 0 AND poids_pct <= 100),
            CONSTRAINT uq_exposition_titre UNIQUE (titre_id, axe, type_titre_id),
            CONSTRAINT fk_exposition_titre_titre FOREIGN KEY(titre_id)
                REFERENCES titre_possede (id) ON DELETE CASCADE,
            CONSTRAINT fk_exposition_titre_type FOREIGN KEY(type_titre_id)
                REFERENCES type_titre (id) ON DELETE CASCADE
        )
        """
    )
    op.execute("CREATE INDEX ix_exposition_titre_titre_id ON exposition_titre (titre_id)")

    # 3. Chaque classe d'actif devient une ligne à 100 %.
    op.execute(
        "INSERT INTO exposition_titre (titre_id, axe, type_titre_id, poids_pct) "
        "SELECT id, 'classe', classe_actif_id, 100 FROM titre_possede WHERE classe_actif_id IS NOT NULL"
    )

    # 4. Le catalogue, sans la colonne, avec le dictionnaire d'ETF.
    op.execute(_ddl_titre(avec_classe=False))
    op.execute(
        f"INSERT INTO titre_possede_nouveau ({COLONNES_COMMUNES}) "
        f"SELECT {COLONNES_COMMUNES} FROM titre_possede"
    )
    op.execute("DROP TABLE titre_possede")
    op.execute("ALTER TABLE titre_possede_nouveau RENAME TO titre_possede")
    op.execute("DROP INDEX IF EXISTS ix_titre_possede_classe_actif")
    op.execute("CREATE UNIQUE INDEX ix_titre_possede_code_isin ON titre_possede (code_isin)")


def downgrade():
    # RETOUR ARRIÈRE : la classe d'actif UNIQUE reprend la classe qui pèse le plus ;
    # zones, secteurs et dictionnaires d'ETF sont perdus — ce qu'ils décrivent n'existait pas avant.
    op.execute(_ddl_titre(avec_classe=True))
    op.execute(
        f"INSERT INTO titre_possede_nouveau ({COLONNES_COMMUNES}) "
        f"SELECT {COLONNES_COMMUNES} FROM titre_possede"
    )
    op.execute(
        """
        UPDATE titre_possede_nouveau SET classe_actif_id = (
            SELECT e.type_titre_id FROM exposition_titre e
            WHERE e.titre_id = titre_possede_nouveau.id AND e.axe = 'classe'
            ORDER BY e.poids_pct DESC, e.id LIMIT 1
        )
        """
    )
    op.execute("DROP TABLE titre_possede")
    op.execute("ALTER TABLE titre_possede_nouveau RENAME TO titre_possede")
    op.execute("CREATE UNIQUE INDEX ix_titre_possede_code_isin ON titre_possede (code_isin)")
    op.execute("CREATE INDEX ix_titre_possede_classe_actif ON titre_possede (classe_actif_id)")

    op.execute("DROP TABLE exposition_titre")
    op.execute("DELETE FROM type_titre WHERE axe IN ('zone', 'secteur')")
    _recreer_type_titre("'enveloppe', 'classe'")
