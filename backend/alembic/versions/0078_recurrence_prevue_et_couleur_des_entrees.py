"""Un modèle récurrent est toujours prévisionnel, et une catégorie d'entrée a sa couleur à elle.

DEUX REPRISES DE DONNÉES, AUCUNE COLONNE NOUVELLE.

UN MODÈLE RÉCURRENT RÉEL PASSE LA MAIN (cf. crud.scinder_modele_recurrent, dont ceci est la
copie figée au jour de la migration — une migration ne lit jamais le code de l'application,
qui aura changé d'ici qu'on la rejoue). « Récurrente » ne s'allume désormais qu'avec
« Prévisionnelle » : une récurrence est une suite de dépenses attendues, reconnues à
l'import. Les modèles écrits avant, souvent RÉELS (« le loyer de juillet, payé, et les
suivants »), sont repris ainsi :

  - la première occurrence encore PRÉVISIONNELLE devient le modèle — elle reprend la
    fréquence, la fin, et les occurrences suivantes ;
  - sans elle, un nouveau modèle prévisionnel naît à la date suivante, sur le patron de
    l'ancien (sa fenêtre de rapprochement reportée comme le fait la génération) ;
  - L'ANCIEN MODÈLE ET LES OCCURRENCES DÉJÀ RÉELLES restent réels et deviennent des
    occurrences du nouveau modèle : des opérations ordinaires, qui gardent le lien avec la
    récurrence qui les a dictées ;
  - une récurrence TERMINÉE (plus aucune date avant sa fin) n'est pas touchée.

L'application refait le même geste à chaque lecture pour les modèles qui deviennent réels
ENSUITE (rapprochés à l'import, marqués payés) : cette migration ne fait que remettre les
bases existantes d'aplomb dès la mise à jour.

UNE CATÉGORIE D'ENTRÉE PREND LA COULEUR DES ENTRÉES (`couleur_index = -1`) : blanc en thème
sombre, noir en thème clair (cf. frontend, couleurCategorie). Écrit en base plutôt que
déduit à l'écran de `est_entree`, pour que la couleur d'une barre se lise au même endroit
que celle de toutes les autres. Décocher « entrée » lui rend un index de palette (cf.
crud.set_categorie_est_entree).

LE RETOUR ARRIÈRE rend un index de palette aux catégories d'entrée et ne défait PAS la
reprise des récurrences : elle n'a rien supprimé, et les deux formes se relisent.

Revision ID: 0078
Revises: 0077
Create Date: 2026-10-10
"""
import calendar
from datetime import date, timedelta

import sqlalchemy as sa
from alembic import op

revision = "0078"
down_revision = "0077"
branch_labels = None
depends_on = None

REEL = "réel"
PREVISIONNEL = "prévisionnel"


def _date(valeur):
    if valeur is None or isinstance(valeur, date):
        return valeur
    return date.fromisoformat(str(valeur)[:10])


def _ajouter_mois(d: date, n: int) -> date:
    mois_total = d.month - 1 + n
    annee = d.year + mois_total // 12
    mois = mois_total % 12 + 1
    return date(annee, mois, min(d.day, calendar.monthrange(annee, mois)[1]))


def _suivante(d: date, frequence: str) -> date:
    if frequence == "hebdomadaire":
        return d + timedelta(weeks=1)
    if frequence == "mensuelle":
        return _ajouter_mois(d, 1)
    if frequence == "trimestrielle":
        return _ajouter_mois(d, 3)
    return _ajouter_mois(d, 12)


def _fenetre_heritee(modele, date_occurrence: date):
    debut, fin, jour = (
        _date(modele["rapprochement_debut"]),
        _date(modele["rapprochement_fin"]),
        _date(modele["date"]),
    )
    if debut is None or fin is None:
        return None, None
    premier = date_occurrence.replace(day=1)
    dernier = date_occurrence.replace(
        day=calendar.monthrange(date_occurrence.year, date_occurrence.month)[1]
    )
    d = date_occurrence + (debut - jour)
    f = date_occurrence + (fin - jour)
    return max(premier, min(d, dernier)), max(premier, min(f, dernier))


def _reprendre_les_recurrences(conn):
    colonnes = [ligne[1] for ligne in conn.execute(sa.text("PRAGMA table_info(operation)"))]
    modeles = conn.execute(
        sa.text(
            "SELECT * FROM operation WHERE recurrente = 1 AND recurrence_parent_id IS NULL "
            "AND statut = :reel AND frequence IS NOT NULL"
        ),
        {"reel": REEL},
    ).mappings().all()
    for modele in modeles:
        enfants = sorted(
            conn.execute(
                sa.text(
                    "SELECT id, date, statut, recurrence_date_prevue FROM operation "
                    "WHERE recurrence_parent_id = :id"
                ),
                {"id": modele["id"]},
            ).mappings().all(),
            key=lambda e: _date(e["recurrence_date_prevue"] or e["date"]),
        )
        frontiere = next((e for e in enfants if e["statut"] == PREVISIONNEL), None)
        if frontiere is not None:
            nouveau_id = frontiere["id"]
        else:
            derniere = max(
                [_date(modele["date"])]
                + [_date(e["recurrence_date_prevue"] or e["date"]) for e in enfants]
            )
            prochaine = _suivante(derniere, modele["frequence"])
            fin = _date(modele["recurrence_fin"])
            if fin is not None and prochaine > fin:
                continue  # récurrence terminée : rien à reprendre
            # UNE COPIE DE LA LIGNE, puis ce qui change : toutes les colonnes obligatoires
            # sont ainsi remplies, quelles qu'elles soient au jour où l'on rejoue ceci.
            copiees = [c for c in colonnes if c != "id"]
            liste = ", ".join(copiees)
            nouveau_id = conn.execute(
                sa.text(f"INSERT INTO operation ({liste}) SELECT {liste} FROM operation WHERE id = :id"),
                {"id": modele["id"]},
            ).lastrowid
            debut_fenetre, fin_fenetre = _fenetre_heritee(modele, prochaine)
            effacer = [c for c in ("notes", "frais", "monnaie_frais_id") if c in colonnes]
            conn.execute(
                sa.text(
                    "UPDATE operation SET date = :date, statut = :prev, "
                    "recurrence_date_prevue = :date, rapprochement_debut = :debut, "
                    "rapprochement_fin = :fin"
                    + "".join(f", {c} = NULL" for c in effacer)
                    + " WHERE id = :id"
                ),
                {
                    "date": prochaine.isoformat(),
                    "prev": PREVISIONNEL,
                    "debut": debut_fenetre.isoformat() if debut_fenetre else None,
                    "fin": fin_fenetre.isoformat() if fin_fenetre else None,
                    "id": nouveau_id,
                },
            )
        conn.execute(
            sa.text(
                "UPDATE operation SET recurrence_parent_id = NULL, recurrente = 1, "
                "frequence = :frequence, recurrence_fin = :fin WHERE id = :id"
            ),
            {"frequence": modele["frequence"], "fin": modele["recurrence_fin"], "id": nouveau_id},
        )
        conn.execute(
            sa.text(
                "UPDATE operation SET recurrence_parent_id = :nouveau "
                "WHERE recurrence_parent_id = :ancien AND id != :nouveau"
            ),
            {"nouveau": nouveau_id, "ancien": modele["id"]},
        )
        conn.execute(
            sa.text(
                "UPDATE operation SET recurrence_parent_id = :nouveau, frequence = NULL, "
                "recurrence_fin = NULL, "
                "recurrence_date_prevue = COALESCE(recurrence_date_prevue, date) WHERE id = :id"
            ),
            {"nouveau": nouveau_id, "id": modele["id"]},
        )


def upgrade():
    conn = op.get_bind()
    conn.execute(sa.text("UPDATE categorie SET couleur_index = -1 WHERE est_entree = 1"))
    _reprendre_les_recurrences(conn)


def downgrade():
    conn = op.get_bind()
    pris = {
        index
        for (index,) in conn.execute(
            sa.text("SELECT couleur_index FROM categorie WHERE couleur_index >= 0")
        )
    }
    for (categorie_id,) in conn.execute(
        sa.text("SELECT id FROM categorie WHERE couleur_index = -1 ORDER BY id")
    ).all():
        index = 0
        while index in pris:
            index += 1
        pris.add(index)
        conn.execute(
            sa.text("UPDATE categorie SET couleur_index = :i WHERE id = :id"),
            {"i": index, "id": categorie_id},
        )
