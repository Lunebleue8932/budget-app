"""Les deux listes du dashboard : ce qui vient de se passer, ce qui arrive.

CE QU'ELLES MONTRENT, ET CE QU'ELLES ÉCARTENT :

  - DERNIÈRES OPÉRATIONS : les opérations RÉELLES les plus récentes (date puis
    identifiant décroissants), jusqu'à aujourd'hui — une réelle postdatée n'est
    pas « dernière », elle n'a pas encore eu lieu ;
  - PROCHAINES PRÉVISIONNELLES : les prévisionnelles des comptes courants, dans
    l'ordre où elles se posent. Une ÉCHUE et non rapprochée se pose DEMAIN et se
    signale « en retard » — même règle que le solde projeté et que la courbe du
    « reste » (cf. soldes.jour_pose) : elle compte dans le chiffre, elle doit
    donc figurer dans la liste qui l'explique.

LES VIREMENTS INTERNES SONT ÉCARTÉS DES DEUX, par le filtre de sens (entrée ou
dépense), comme dans les flux de la période : un virement est DEUX écritures qui
déplacent le même argent, et la liste les montrerait toutes les deux.

`monnaie_id` À NULL : toutes les monnaies. C'est la vue « Tout convertir » —
chaque ligne garde sa monnaie et son montant d'origine, rien n'y est additionné.

CE MODULE N'ÉCRIT RIEN.
"""
from datetime import date as date_type
from datetime import timedelta
from typing import Optional

from sqlalchemy.orm import Session, joinedload

from .. import models
from ..constants import TYPES_COMPTE_HORS_COURANT, Sens, Statut
from . import soldes

# Combien de lignes par liste.
NOMBRE_DE_LIGNES = 5

_SENS_LISTES = (Sens.entree, Sens.depense)


def _ligne(operation: models.Operation, aujourdhui: date_type) -> dict:
    return {
        "id": operation.id,
        "date": operation.date,
        "jour_pose": soldes.jour_pose(operation, aujourdhui),
        "nature": operation.nature,
        "categorie_nom": operation.categorie.nom if operation.categorie else None,
        "montant": operation.montant,
        "sens": operation.sens,
        "monnaie_id": operation.monnaie_id,
        "recurrente": bool(operation.recurrente),
        "etalee_jusqu_au": operation.amortissement_fin if operation.amorti else None,
        "en_retard": (
            operation.statut == Statut.previsionnel and operation.date <= aujourdhui
        ),
    }


def _requete(db: Session, monnaie_id: Optional[int]):
    requete = (
        db.query(models.Operation)
        .options(joinedload(models.Operation.categorie))
        .filter(models.Operation.sens.in_(_SENS_LISTES))
    )
    if monnaie_id is not None:
        requete = requete.filter(models.Operation.monnaie_id == monnaie_id)
    return requete


def dernieres_operations(
    db: Session, monnaie_id: Optional[int], aujourdhui: date_type
) -> list[dict]:
    operations = (
        _requete(db, monnaie_id)
        .filter(
            models.Operation.statut == Statut.reel,
            models.Operation.date <= aujourdhui,
        )
        .order_by(models.Operation.date.desc(), models.Operation.id.desc())
        .limit(NOMBRE_DE_LIGNES)
        .all()
    )
    return [_ligne(o, aujourdhui) for o in operations]


def prochaines_previsionnelles(
    db: Session, monnaie_id: Optional[int], aujourdhui: date_type, horizon: date_type
) -> tuple[list[dict], int]:
    """Les `NOMBRE_DE_LIGNES` prochaines, et combien se posent d'ici `horizon`.

    Triées par JOUR DE POSE : les échues passent donc en tête, toutes à demain,
    dans l'ordre de leur date d'origine."""
    operations = (
        _requete(db, monnaie_id)
        .join(models.Compte, models.Operation.compte_id == models.Compte.id)
        .join(models.TypeCompte, models.Compte.type_id == models.TypeCompte.id)
        .filter(
            models.Operation.statut == Statut.previsionnel,
            models.TypeCompte.nom.notin_(TYPES_COMPTE_HORS_COURANT),
        )
        .order_by(models.Operation.date, models.Operation.id)
        .all()
    )
    demain = aujourdhui + timedelta(days=1)
    # Le tri par date d'origine est déjà celui du jour de pose : toutes les échues
    # précèdent demain, et se posent demain.
    total = sum(1 for o in operations if max(o.date, demain) <= horizon)
    return [_ligne(o, aujourdhui) for o in operations[:NOMBRE_DE_LIGNES]], total


def listes(
    db: Session,
    monnaie_id: Optional[int],
    vue: str,
    aujourdhui: Optional[date_type] = None,
) -> dict:
    aujourdhui = aujourdhui or date_type.today()
    horizon = soldes.horizon_reste(vue, aujourdhui)
    prochaines, total = prochaines_previsionnelles(db, monnaie_id, aujourdhui, horizon)
    return {
        "horizon": horizon,
        "dernieres": dernieres_operations(db, monnaie_id, aujourdhui),
        "prochaines": prochaines,
        "prochaines_total": total,
    }
