"""Une seule catégorie pour les virements internes : les homonymes y sont fondues.

CE QUI ARRIVAIT. La migration 0090 a posé « Virements internes », reconnue par son drapeau. Mais
une base pouvait déjà porter une catégorie ORDINAIRE du même sens, créée à la main - « Virement
interne », « Internal transfers »… -, par exemple depuis le tableau des catégories de l'import.
Les deux se côtoyaient alors dans chaque liste, et choisir la mauvaise faisait d'un virement une
dépense.

CE QUI EST FAIT. Chaque catégorie sans drapeau dont le nom désigne les virements internes (le nom
livré dans les trois langues, au singulier ou au pluriel, sans accents ni casse ; cf.
crud.nom_de_la_categorie_virements, qui refuse désormais d'en créer une) est FONDUE dans la
catégorie des virements : ses correspondances d'import et ses règles passent sur elle (une règle
qui la posait devient une règle de virement, comme le ferait l'éditeur), puis elle disparaît. Si
la catégorie des virements avait pris un nom de repli (« Virements internes (2) ») parce que
l'homonyme portait le nom livré, elle le récupère.

CE QUI N'EST PAS TOUCHÉ. Une homonyme qui porte des opérations, des parts de découpe, une
enveloppe, un objectif ou une catégorie d'entrée reste là : ses opérations ne sont pas des
virements (un virement porte toujours la catégorie à drapeau, cf. 0090), et les y verser
inventerait des comptes en face qu'aucune ne désigne. Elle se renomme ou se fusionne à la main.

DESCENTE. Rien à rejouer : une catégorie supprimée ne se recrée pas, et ses correspondances sont
justes sur la catégorie des virements.

Revision ID: 0091
Revises: 0090
Create Date: 2026-10-22
"""
import json
import unicodedata

from alembic import op
import sqlalchemy as sa

revision = "0091"
down_revision = "0090"
branch_labels = None
depends_on = None


NOM_LIVRE = "Virements internes"
NOMS = {"virement interne", "internal transfer", "transferencia interna"}


def _cle(nom: str) -> str:
    """Même normalisation que crud._nom_normalise_virement (une migration ne s'importe pas l'app)."""
    sans_accents = "".join(
        c for c in unicodedata.normalize("NFD", nom or "") if unicodedata.category(c) != "Mn"
    )
    mots = sans_accents.lower().replace("-", " ").split()
    return " ".join(m[:-1] if len(m) > 3 and m.endswith("s") else m for m in mots)


def _porte_des_donnees(connexion, categorie_id: int) -> bool:
    requetes = [
        "SELECT COUNT(*) FROM operation WHERE categorie_id = :id",
        "SELECT COUNT(*) FROM operation_decoupe WHERE categorie_id = :id",
        "SELECT COUNT(*) FROM categorie_budget_mensuel WHERE categorie_id = :id",
        "SELECT COUNT(*) FROM regle_decoupe WHERE categorie_id = :id",
        "SELECT COUNT(*) FROM objectif_kpi WHERE categorie_id = :id",
        "SELECT COUNT(*) FROM categorie WHERE id = :id AND (est_entree = 1 OR objectif_pourcentage > 0)",
    ]
    return any(connexion.execute(sa.text(r), {"id": categorie_id}).scalar() for r in requetes)


def upgrade():
    connexion = op.get_bind()
    virements = connexion.execute(
        sa.text("SELECT id, nom FROM categorie WHERE est_virement = 1")
    ).fetchone()
    if virements is None:
        return
    virements_id, virements_nom = virements
    type_virement = connexion.execute(
        sa.text("SELECT id FROM type_operation WHERE code = 'virement'")
    ).scalar()
    types_libres = [
        r[0]
        for r in connexion.execute(
            sa.text("SELECT id FROM type_operation WHERE code IN ('classique', 'remboursable')")
        ).fetchall()
    ]

    homonymes = [
        (cid, nom)
        for cid, nom in connexion.execute(
            sa.text("SELECT id, nom FROM categorie WHERE est_virement = 0")
        ).fetchall()
        if _cle(nom) in NOMS or _cle(nom) == _cle(virements_nom)
    ]
    for homonyme_id, homonyme_nom in homonymes:
        if _porte_des_donnees(connexion, homonyme_id):
            continue
        # Les correspondances : une catégorie bancaire déjà rattachée à la catégorie des virements
        # garde la sienne, les autres passent sur elle.
        connexion.execute(
            sa.text(
                "DELETE FROM import_categorie_mapping WHERE categorie_id = :h AND EXISTS ("
                " SELECT 1 FROM import_categorie_mapping m WHERE m.categorie_id = :v"
                " AND m.preset_id IS import_categorie_mapping.preset_id"
                " AND m.nom_banque = import_categorie_mapping.nom_banque)"
            ),
            {"h": homonyme_id, "v": virements_id},
        )
        connexion.execute(
            sa.text("UPDATE import_categorie_mapping SET categorie_id = :v WHERE categorie_id = :h"),
            {"h": homonyme_id, "v": virements_id},
        )
        # Les règles : la catégorie des virements fait le type, si le type admettait une catégorie.
        if type_virement is not None:
            connexion.execute(
                sa.text(
                    "UPDATE regle_categorisation SET type_id = :t WHERE categorie_id = :h"
                    " AND (type_id IS NULL OR type_id IN ("
                    + ",".join(str(i) for i in types_libres or [-1])
                    + "))"
                ),
                {"h": homonyme_id, "t": type_virement},
            )
        connexion.execute(
            sa.text("UPDATE regle_categorisation SET categorie_id = :v WHERE categorie_id = :h"),
            {"h": homonyme_id, "v": virements_id},
        )
        for regle_id, brut in connexion.execute(
            sa.text("SELECT id, sorties FROM regle_categorisation WHERE sorties IS NOT NULL")
        ).fetchall():
            try:
                sorties = json.loads(brut) if isinstance(brut, str) else brut
            except ValueError:
                continue
            if not isinstance(sorties, list):
                continue
            change = False
            for sortie in sorties:
                if isinstance(sortie, dict) and sortie.get("categorie_id") == homonyme_id:
                    sortie["categorie_id"] = virements_id
                    if sortie.get("type_code") in (None, "classique", "remboursable"):
                        sortie["type_code"] = "virement"
                    change = True
            if change:
                connexion.execute(
                    sa.text("UPDATE regle_categorisation SET sorties = :s WHERE id = :id"),
                    {"s": json.dumps(sorties, ensure_ascii=False), "id": regle_id},
                )
        connexion.execute(sa.text("DELETE FROM categorie WHERE id = :h"), {"h": homonyme_id})
        # Le nom livré était pris par l'homonyme (0090 a nommé la nôtre « Virements internes (2) ») :
        # il lui revient.
        if homonyme_nom == NOM_LIVRE and virements_nom.startswith(NOM_LIVRE + " ("):
            connexion.execute(
                sa.text("UPDATE categorie SET nom = :n WHERE id = :v"),
                {"n": NOM_LIVRE, "v": virements_id},
            )
            virements_nom = NOM_LIVRE


def downgrade():
    pass
