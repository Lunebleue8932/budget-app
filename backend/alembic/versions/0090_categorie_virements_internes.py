"""La catégorie « Virements internes », équivalente au type « virement ».

CE QUI EXISTAIT. Depuis la migration 0019, un virement interne n'a plus de catégorie : son TYPE
est sa classification, et ses deux jambes portent `categorie_id` NULL. Juste en base, mais
incommode partout où l'on choisit une catégorie — un formulaire, un filtre, une règle, le
tableau des catégories de l'import : « Virements internes » n'y figurait pas, et rattacher la
catégorie bancaire « Virement » de son relevé à quoi que ce soit en faisait une dépense.

CE QUI EST AJOUTÉ. Une catégorie, UNE SEULE, reconnue par un drapeau (`categorie.est_virement`,
index unique partiel `uq_categorie_virement`) et jamais par son nom : elle se renomme librement,
ne se supprime pas, ne s'éteint pas. Une opération est un virement interne SI ET SEULEMENT SI
elle porte cette catégorie : la migration la pose donc sur toutes les jambes de virement
existantes (elles portaient toutes NULL, cf. crud._normaliser_categorie_selon_type), et sur les
règles d'import de type virement, sorties comprises — pour que l'éditeur de règles montre la
même équivalence que le formulaire.

LE NOM LIVRÉ EST « Virements internes ». Une base où l'utilisateur a déjà créé une catégorie de
ce nom : si elle n'a JAMAIS SERVI (aucune opération, part, enveloppe, objectif, règle,
correspondance), elle est adoptée telle quelle ; sinon elle est laissée à son propriétaire, et la
catégorie des virements prend le nom « Virements internes (2) » — renommable ensuite.

DESCENTE. Les jambes et les règles retrouvent `categorie_id` NULL, les correspondances d'import
vers la catégorie sont retirées (elles faisaient de ces lignes des virements ; sans la catégorie,
rien ne les relirait), puis la catégorie, son index et sa colonne disparaissent.

Revision ID: 0090
Revises: 0089
Create Date: 2026-10-20
"""
import json

from alembic import op
import sqlalchemy as sa

revision = "0090"
down_revision = "0089"
branch_labels = None
depends_on = None


NOM = "Virements internes"
# Hors palette, comme les entrées (-1) : cf. constants.COULEUR_INDEX_VIREMENT.
COULEUR_INDEX_VIREMENT = -2


def _id_type_virement(connexion):
    ligne = connexion.execute(
        sa.text("SELECT id FROM type_operation WHERE code = 'virement'")
    ).fetchone()
    return ligne[0] if ligne else None


def _categorie_inutilisee(connexion, categorie_id: int) -> bool:
    """Rien ne la désigne : ni opération, ni part, ni enveloppe, ni objectif, ni règle, ni
    correspondance, et elle n'est ni une catégorie d'entrée ni porteuse d'un objectif de
    répartition. Les tables d'extension sont au noyau (cf. extensions/README.md) : elles
    existent toutes à ce point des migrations."""
    requetes = [
        "SELECT COUNT(*) FROM operation WHERE categorie_id = :id",
        "SELECT COUNT(*) FROM operation_decoupe WHERE categorie_id = :id",
        "SELECT COUNT(*) FROM categorie_budget_mensuel WHERE categorie_id = :id",
        "SELECT COUNT(*) FROM regle_categorisation WHERE categorie_id = :id",
        "SELECT COUNT(*) FROM regle_decoupe WHERE categorie_id = :id",
        "SELECT COUNT(*) FROM import_categorie_mapping WHERE categorie_id = :id",
        "SELECT COUNT(*) FROM objectif_kpi WHERE categorie_id = :id",
        "SELECT COUNT(*) FROM categorie WHERE id = :id "
        "AND (est_entree = 1 OR objectif_pourcentage > 0)",
    ]
    return all(
        not connexion.execute(sa.text(requete), {"id": categorie_id}).scalar()
        for requete in requetes
    )


def _sorties(brut):
    if brut is None:
        return []
    if isinstance(brut, str):
        try:
            brut = json.loads(brut)
        except ValueError:
            return None
    return brut if isinstance(brut, list) else None


def _reecrire_sorties(connexion, transformer) -> None:
    """Applique `transformer(sortie) -> bool` (vrai s'il l'a changée) aux sorties de chaque
    règle, et réécrit celles qui ont changé."""
    for regle_id, brut in connexion.execute(
        sa.text("SELECT id, sorties FROM regle_categorisation")
    ).fetchall():
        sorties = _sorties(brut)
        if not sorties:
            continue
        change = False
        for sortie in sorties:
            if isinstance(sortie, dict) and transformer(sortie):
                change = True
        if change:
            connexion.execute(
                sa.text("UPDATE regle_categorisation SET sorties = :s WHERE id = :id"),
                {"s": json.dumps(sorties, ensure_ascii=False), "id": regle_id},
            )


def upgrade():
    with op.batch_alter_table("categorie", schema=None) as batch_op:
        batch_op.add_column(
            sa.Column("est_virement", sa.Boolean(), nullable=False, server_default=sa.false())
        )
    op.create_index(
        "uq_categorie_virement",
        "categorie",
        ["est_virement"],
        unique=True,
        sqlite_where=sa.text("est_virement = 1"),
    )

    connexion = op.get_bind()
    existante = connexion.execute(
        sa.text("SELECT id FROM categorie WHERE nom = :nom"), {"nom": NOM}
    ).fetchone()
    if existante is not None and _categorie_inutilisee(connexion, existante[0]):
        categorie_id = existante[0]
        connexion.execute(
            sa.text(
                "UPDATE categorie SET est_virement = 1, active = 1, couleur_index = :c "
                "WHERE id = :id"
            ),
            {"c": COULEUR_INDEX_VIREMENT, "id": categorie_id},
        )
    else:
        nom = NOM
        if existante is not None:
            rang = 2
            while connexion.execute(
                sa.text("SELECT COUNT(*) FROM categorie WHERE nom = :nom"),
                {"nom": f"{NOM} ({rang})"},
            ).scalar():
                rang += 1
            nom = f"{NOM} ({rang})"
        ordre = connexion.execute(sa.text("SELECT COALESCE(MAX(ordre), -1) FROM categorie")).scalar()
        categorie_id = connexion.execute(
            sa.text(
                "INSERT INTO categorie (nom, ordre, couleur_index, objectif_pourcentage, "
                "est_entree, active, est_virement) VALUES (:nom, :ordre, :couleur, 0, 0, 1, 1)"
            ),
            {"nom": nom, "ordre": (ordre if ordre is not None else -1) + 1, "couleur": COULEUR_INDEX_VIREMENT},
        ).lastrowid

    type_virement = _id_type_virement(connexion)
    if type_virement is None:
        return
    # LES JAMBES EXISTANTES, toutes : avec ou sans `virement_id` (une jambe seule d'une base
    # ancienne est un virement elle aussi). Elles portaient NULL ; une découpe n'existe que
    # sur une opération classique, il n'y a donc aucune part à défaire.
    connexion.execute(
        sa.text("UPDATE operation SET categorie_id = :c WHERE type_id = :t"),
        {"c": categorie_id, "t": type_virement},
    )
    # LES RÈGLES DE TYPE VIREMENT, et leurs sorties qui posent ce type : même équivalence.
    connexion.execute(
        sa.text("UPDATE regle_categorisation SET categorie_id = :c WHERE type_id = :t"),
        {"c": categorie_id, "t": type_virement},
    )

    def poser(sortie):
        if sortie.get("type_code") == "virement" and sortie.get("categorie_id") != categorie_id:
            sortie["categorie_id"] = categorie_id
            return True
        return False

    _reecrire_sorties(connexion, poser)


def downgrade():
    connexion = op.get_bind()
    ligne = connexion.execute(
        sa.text("SELECT id FROM categorie WHERE est_virement = 1")
    ).fetchone()
    if ligne is not None:
        categorie_id = ligne[0]
        connexion.execute(
            sa.text("UPDATE operation SET categorie_id = NULL WHERE categorie_id = :c"),
            {"c": categorie_id},
        )
        connexion.execute(
            sa.text("UPDATE regle_categorisation SET categorie_id = NULL WHERE categorie_id = :c"),
            {"c": categorie_id},
        )

        def retirer(sortie):
            if sortie.get("categorie_id") == categorie_id:
                sortie["categorie_id"] = None
                return True
            return False

        _reecrire_sorties(connexion, retirer)
        # Le serveur refuse les parts, enveloppes et objectifs sur cette catégorie : il n'y en a
        # pas, mais une base retouchée à la main ne doit pas faire échouer la descente.
        for table in (
            "import_categorie_mapping",
            "operation_decoupe",
            "regle_decoupe",
            "categorie_budget_mensuel",
            "objectif_kpi",
        ):
            connexion.execute(
                sa.text(f"DELETE FROM {table} WHERE categorie_id = :c"), {"c": categorie_id}
            )
        connexion.execute(sa.text("DELETE FROM categorie WHERE id = :c"), {"c": categorie_id})

    op.drop_index("uq_categorie_virement", table_name="categorie")
    with op.batch_alter_table("categorie", schema=None) as batch_op:
        batch_op.drop_column("est_virement")
