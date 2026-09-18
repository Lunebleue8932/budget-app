"""Quatre catégories pour orienter, sur une base NEUVE et sur elle seule.

CE QUE LA 0061 A FAIT, ET CE QU'ELLE A FAIT DE TROP. Elle a retiré les six
catégories livrées par 0006, qui décrivaient un budget particulier — « Vêtements
& équipement sport » ne veut rien dire chez la plupart des gens. C'était juste,
et ça laisse pourtant l'application s'ouvrir sur une liste d'un seul élément :
devant ce « Autres » solitaire, rien ne dit que les catégories se créent à la
main, ni à quoi elles servent, ni qu'on peut les renommer.

QUATRE POSTES QUE TOUT LE MONDE A — alimentaire, loisirs, transports, charges
fixes — plus la catégorie d'entrée d'argent. Ils orientent sans décrire
personne, se renomment, se suppriment d'un clic, et se traduisent (ce sont les
seuls noms de catégorie que l'application connaisse).

SEULEMENT SUR UNE BASE NEUVE, et c'est toute la difficulté de cette migration :
une migration s'applique à TOUTES les bases, or personne n'a demandé à voir
quatre catégories apparaître dans une liste qu'il a passé six mois à composer.
La base est tenue pour neuve si elle ne porte AUCUNE OPÉRATION et RIEN D'AUTRE
QUE « Autres » — c'est-à-dire l'état exact où la 0061 laisse une installation
qui vient de naître. Les deux conditions comptent : une base vide de catégories
mais pleine d'opérations appartient à quelqu'un qui les a toutes supprimées
exprès.

ON N'AJOUTE JAMAIS UN NOM DÉJÀ PRIS, garde qui ne coûte rien et qui évite le
seul échec possible (`categorie.nom` est unique).

Revision ID: 0064
Revises: 0063
Create Date: 2026-09-18
"""
from alembic import op
import sqlalchemy as sa

revision = "0064"
down_revision = "0063"
branch_labels = None
depends_on = None


# (nom, est_entree). L'ordre est celui de l'affichage ; « Autres » est déjà là,
# elle garde sa place et son index de couleur.
CATEGORIES = [
    ("Alimentaire", False),
    ("Loisirs", False),
    ("Transports", False),
    ("Charges fixes", False),
    ("Entrées d'argent", True),
]


def upgrade():
    connexion = op.get_bind()
    noms = {
        nom for (nom,) in connexion.execute(sa.text("SELECT nom FROM categorie")).fetchall()
    }
    operations = connexion.execute(sa.text("SELECT COUNT(*) FROM operation")).scalar() or 0
    if operations > 0 or noms - {"Autres"}:
        return

    # `ordre` et `couleur_index` partent après ce qui existe : « Autres » garde
    # les siens, et une couleur déjà prise ferait deux barres de la même teinte
    # dans l'histogramme (cf. crud._prochain_couleur_index).
    depart = (
        connexion.execute(
            sa.text("SELECT COALESCE(MAX(ordre), -1), COALESCE(MAX(couleur_index), -1) FROM categorie")
        ).fetchone()
        or (-1, -1)
    )
    ordre, couleur = depart[0] + 1, depart[1] + 1
    for position, (nom, est_entree) in enumerate(CATEGORIES):
        if nom in noms:
            continue
        connexion.execute(
            sa.text(
                "INSERT INTO categorie (nom, ordre, couleur_index, objectif_pourcentage, "
                "est_entree, active) VALUES (:nom, :ordre, :couleur, 0, :est_entree, 1)"
            ),
            {
                "nom": nom,
                "ordre": ordre + position,
                "couleur": couleur + position,
                "est_entree": 1 if est_entree else 0,
            },
        )


def downgrade():
    """RIEN, et pour la même raison que la 0061 : le downgrade ne sait pas
    distinguer les catégories qu'il a posées de celles que l'utilisateur a
    créées du même nom depuis. Les supprimer emporterait leurs opérations dans
    « Autres » — une perte pour défaire un ajout qui n'a rien cassé."""
