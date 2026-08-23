"""Rafraîchir les taux de change : mêmes règles que les cours de titres.

MÊME MOTEUR, AUTRE OBJET. Un taux de change et un cours de bourse sont le même
problème : aller lire un nombre sur une page publique de cotation. `source_cours`
ne fait aucune différence entre les deux — c'est ce qui a permis de fusionner
« cours de bourse » et « cours des monnaies » en une seule extension, donc en
un seul module capable d'ouvrir une connexion sortante.

CE QUI EST ÉCRIT EN BASE, ET CE QUI NE L'EST PAS. Un rafraîchissement ne touche
que `taux_change.taux` et `taux_change.maj_le`. **Aucun montant de
l'application n'est converti avec.** Les soldes, les KPI et les budgets restent
suivis monnaie par monnaie, comme ils l'ont toujours été : un taux est une
information affichée sur l'écran des monnaies, jamais un opérateur. Brancher
Internet ne change donc rien à la comptabilité.

PAS DE CONTRÔLE DE DEVISE ICI, contrairement aux titres. Pour un titre, la
devise lue devait correspondre à celle du titre, faute de quoi la valorisation
partait d'un tiers. Pour un couple, la devise EST le sujet : la page
`EUR-USD` publie un nombre sans unité, et c'est l'ordre des deux monnaies
choisi par l'utilisateur qui lui donne son sens. Le seul garde-fou possible
serait de comparer ce que la page annonce au couple demandé, et aucune des
sources ne l'annonce de façon fiable — mieux vaut un lien qu'on relit d'un clic
qu'un contrôle qui bloque à tort.

LES LECTURES PARTENT EN PARALLÈLE, LES ÉCRITURES RESTENT EN SÉRIE, pour la
raison exposée dans service_cours : une session SQLAlchemy ne se partage pas
entre threads, qui ne reçoivent donc qu'une URL.
"""
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass, field
from datetime import datetime
from typing import Optional

from sqlalchemy.orm import Session

from app import models

from service_cours import LECTURES_SIMULTANEES
from source_cours import CoursIllisible, lire_cours


@dataclass
class ResultatTaux:
    """Ce qu'un couple a donné. Un par couple suivi, réussite ou échec."""

    taux_id: int
    libelle: str
    ok: bool
    taux: Optional[float] = None
    ancien_taux: Optional[float] = None
    source: Optional[str] = None
    erreur: Optional[str] = None


@dataclass
class ResumeTaux:
    resultats: list[ResultatTaux] = field(default_factory=list)
    horodatage: Optional[datetime] = None

    @property
    def reussis(self) -> int:
        return sum(1 for r in self.resultats if r.ok)

    @property
    def echecs(self) -> int:
        return sum(1 for r in self.resultats if not r.ok)


def libelle_couple(taux: models.TauxChange) -> str:
    """« Euro → Dollar américain », pour un message lisible sans recroiser
    la table des monnaies."""
    return f"{taux.monnaie_source.nom} → {taux.monnaie_cible.nom}"


def couples_suivis(db: Session) -> list[models.TauxChange]:
    """Tous les couples enregistrés.

    Il n'y a pas de couple « non suivi » : une ligne n'existe que parce qu'on a
    désigné une page d'où la lire (url_cours est NOT NULL). C'est la différence
    avec les titres, dont le cours peut légitimement être saisi à la main.
    """
    return (
        db.query(models.TauxChange)
        .order_by(models.TauxChange.monnaie_source_id, models.TauxChange.monnaie_cible_id)
        .all()
    )


def rafraichir(db: Session, couples: list[models.TauxChange]) -> ResumeTaux:
    """Relit ces couples et écrit ceux qui ont pu être lus."""
    if not couples:
        return ResumeTaux(resultats=[], horodatage=None)

    # Tout ce dont les threads ont besoin est extrait ICI, dans le thread qui
    # possède la session (cf. service_cours.rafraichir).
    plan = [(couple.id, couple.url_cours) for couple in couples]

    with ThreadPoolExecutor(max_workers=LECTURES_SIMULTANEES) as executeur:
        lus = list(executeur.map(lambda tache: _lire(*tache), plan))

    # Un seul horodatage pour tout le lot : plusieurs couples relus d'un même
    # clic portent la même date, ce qui se lit comme l'unique geste que ç'a été.
    maintenant = datetime.now()
    resume = ResumeTaux(horodatage=maintenant)
    par_id = {couple.id: couple for couple in couples}

    for taux_id, cours, erreur in lus:
        couple = par_id[taux_id]
        libelle = libelle_couple(couple)
        if erreur is not None:
            resume.resultats.append(ResultatTaux(couple.id, libelle, ok=False, erreur=erreur))
            continue
        ancien = couple.taux
        couple.taux = cours.valeur
        couple.maj_le = maintenant
        resume.resultats.append(
            ResultatTaux(
                couple.id,
                libelle,
                ok=True,
                taux=cours.valeur,
                ancien_taux=ancien,
                source=cours.source,
            )
        )
    # Un seul commit pour le lot : les lectures réussies sont écrites même si
    # d'autres ont échoué (cf. service_cours, même raisonnement).
    db.commit()
    return resume


def _lire(taux_id: int, url: str):
    """Une lecture, dans un thread. Ne lève jamais : toute erreur revient comme
    un message, sinon un site en panne ferait échouer le lot entier."""
    try:
        return taux_id, lire_cours(url), None
    except CoursIllisible as exc:
        return taux_id, None, str(exc)
    except Exception as exc:  # noqa: BLE001 — un site hostile ne casse pas l'app
        return taux_id, None, f"Lecture impossible ({type(exc).__name__})"
