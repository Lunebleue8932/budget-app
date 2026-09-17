"""L'application ne livre plus que « Autres » : les catégories d'un budget ne
sont pas celles d'un autre.

CE QUI ÉTAIT LIVRÉ, ET POURQUOI C'ÉTAIT UNE ERREUR. La migration 0006 posait
sept catégories sur toute base neuve — « Alimentaire », « Loisirs & sorties »,
« Charges fixes », « Réparation & entretien », « Vêtements & équipement
sport », « Autres » et « Entrées d'argent ». Les cinq premières ne sont pas des
catégories par défaut, ce sont CELLES D'UN BUDGET PARTICULIER : celui de la
personne qui a écrit l'application. Toute installation en héritait, et ouvrait
donc sur la façon de compter de quelqu'un d'autre — avec une ligne
« Vêtements & équipement sport » à laquelle rien ne répond chez la plupart des
gens, et sans celles dont ils ont réellement besoin.

« AUTRES » RESTE, et elle seule, parce que l'application la CHERCHE PAR SON NOM
(`constants.CATEGORIE_AUTRES`) : c'est le repli d'une opération dont la
catégorie est supprimée, et la suggestion d'une ligne importée qu'aucune règle
ne classe. Une base qui ne la porterait pas laisserait ces deux chemins sans
réponse.

« ENTRÉES D'ARGENT » PART AVEC LES AUTRES, bien qu'elle ait une colonne à elle
(`Categorie.est_entree`, migration 0060). C'est justement cette colonne qui le
permet : depuis elle, une catégorie d'entrée se coche, et n'importe quel nom
peut l'être — « Salaire », « Loyers perçus », « Pension ». Le nom livré n'était
plus qu'un exemple de plus.

ON NE SUPPRIME QUE CE QUI N'A JAMAIS SERVI, et c'est ce qui rend cette
migration sûre sur une base EN USAGE. Une catégorie livrée est retirée
seulement si rien ne la porte : aucune opération, aucune part de découpe,
aucune enveloppe mensuelle, aucune correspondance d'import, aucune règle de
classement ni de découpe, et aucun objectif de répartition posé dessus. Sur une
base neuve — celle qui vient de passer 0006 — aucune ne porte rien, et il ne
reste que « Autres » : exactement ce que l'application devrait livrer. Sur une
base qui tourne depuis six mois, celles dont on se sert sont intactes, et seules
disparaissent celles qu'on n'a jamais ouvertes.

POURQUOI PAS RÉÉCRIRE LE SEED DE 0006. Une base d'avant cette migration porte
ses opérations avec le NOM de la catégorie en toutes lettres, et 0006 les
rattache en appariant ce nom à la table qu'elle vient de remplir : vider son
seed y laisserait `categorie_id` à NULL, sur une colonne qu'elle rend ensuite
non nullable. La migration échouerait au milieu, sur la base de quelqu'un qui
n'a rien demandé. L'histoire ne se réécrit pas ; elle se poursuit.

Revision ID: 0061
Revises: 0060
Create Date: 2026-09-17
"""
from alembic import op
import sqlalchemy as sa

revision = "0061"
down_revision = "0060"
branch_labels = None
depends_on = None


# Les six catégories livrées par 0006 qui n'ont pas à l'être. « Autres » n'y
# est pas : elle reste, cf. l'en-tête.
CATEGORIES_LIVREES = [
    "Alimentaire",
    "Loisirs & sorties",
    "Charges fixes",
    "Réparation & entretien",
    "Vêtements & équipement sport",
    "Entrées d'argent",
]

# TOUT CE QUI PEUT PORTER UNE CATÉGORIE, et la liste doit rester exhaustive :
# en oublier une reviendrait à supprimer une catégorie dont quelque chose
# dépend encore. Les six colonnes sont des clés étrangères vers `categorie.id`
# (cf. `PRAGMA foreign_key_list`).
PORTEURS = [
    ("operation", "categorie_id"),
    ("operation_decoupe", "categorie_id"),
    ("categorie_budget_mensuel", "categorie_id"),
    ("import_categorie_mapping", "categorie_id"),
    ("regle_categorisation", "categorie_id"),
    ("regle_decoupe", "categorie_id"),
]


def upgrade():
    conditions = " AND ".join(
        f"id NOT IN (SELECT {colonne} FROM {table} WHERE {colonne} IS NOT NULL)"
        for table, colonne in PORTEURS
    )
    noms = ", ".join(f":nom{i}" for i in range(len(CATEGORIES_LIVREES)))
    requete = sa.text(
        f"DELETE FROM categorie WHERE nom IN ({noms}) "
        # Un objectif de répartition posé dessus est une INTENTION écrite à la
        # main : la catégorie sert, même si aucune dépense n'y est encore
        # tombée.
        "AND COALESCE(objectif_pourcentage, 0) = 0 "
        f"AND {conditions}"
    ).bindparams(**{f"nom{i}": nom for i, nom in enumerate(CATEGORIES_LIVREES)})
    op.execute(requete)


def downgrade():
    """RIEN — et c'est le seul comportement honnête.

    Recréer les six catégories rendrait à une base qui n'en voulait pas des
    lignes que son propriétaire avait peut-être supprimées lui-même, bien avant
    cette migration : le downgrade ne sait pas distinguer ce qu'il a retiré de
    ce qui n'était déjà plus là. Et ce qu'il aurait à rendre est vide par
    construction — c'est la condition même de la suppression.
    """
