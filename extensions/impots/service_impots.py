"""Ce qu'il faut déclarer : lecture des entrées étiquetées, et réglages par année.

LE SEUL « CALCUL » est une addition par monnaie, puis un produit par le taux. Le
taux n'est qu'un pourcentage que l'utilisateur lit sur son avis d'imposition :
l'app ne connaît ni barème, ni abattement, ni quotient — l'impôt estimé est un
ordre de grandeur, jamais un calcul fiscal (et le dit).

L'ÉLIGIBILITÉ n'est pas jugée ici : le noyau garantit qu'une opération portant
`a_declarer` est une entrée de type classique (crud.operation_declarable). Cette
extension se contente de lire l'étiquette.
"""
from datetime import date as date_type
from typing import Optional

from sqlalchemy.orm import Session

# Imports ABSOLUS vers le noyau : ce module n'est pas un sous-paquet de `app`,
# il est chargé par chemin de fichier (cf. extensions/README.md).
from app import crud, models
from app.constants import Statut


def operations_a_declarer(db: Session, annee: int) -> list[models.Operation]:
    """Les entrées étiquetées d'une année, de la plus ancienne à la plus récente
    (l'ordre de lecture d'une déclaration : janvier d'abord). L'id départage deux
    entrées du même jour."""
    return (
        db.query(models.Operation)
        .filter(
            models.Operation.a_declarer.is_(True),
            models.Operation.date >= date_type(annee, 1, 1),
            models.Operation.date <= date_type(annee, 12, 31),
        )
        .order_by(models.Operation.date, models.Operation.id)
        .all()
    )


def annees_proposees(db: Session, aujourdhui: date_type) -> list[int]:
    """Les années où il y a quelque chose à voir, la plus récente d'abord.

    L'année en cours y figure toujours : c'est celle où l'on vient poser son taux
    et sa date limite, même sans aucune entrée étiquetée encore."""
    annees = {aujourdhui.year}
    for (date_op,) in (
        db.query(models.Operation.date).filter(models.Operation.a_declarer.is_(True)).distinct()
    ):
        annees.add(date_op.year)
    for (annee,) in db.query(models.DeclarationImpots.annee):
        annees.add(annee)
    return sorted(annees, reverse=True)


def declaration_de(
    db: Session, annee: int, aujourdhui: date_type
) -> dict:
    """Les réglages d'une année (vides si rien n'a été noté), avec le temps qu'il reste."""
    ligne = (
        db.query(models.DeclarationImpots)
        .filter(models.DeclarationImpots.annee == annee)
        .first()
    )
    taux = ligne.taux_pct if ligne else None
    limite = ligne.date_limite if ligne else None
    return {
        "annee": annee,
        "taux_pct": taux,
        "date_limite": limite,
        "jours_restants": (limite - aujourdhui).days if limite else None,
    }


def poser_declaration(
    db: Session, annee: int, champs: dict
) -> models.DeclarationImpots:
    """Écrit les réglages d'une année. `champs` ne contient QUE ce que l'appelant a
    envoyé : un champ absent ne change pas, un champ à None est effacé. Une ligne
    entièrement vide est supprimée plutôt que gardée comme un fantôme."""
    ligne = (
        db.query(models.DeclarationImpots)
        .filter(models.DeclarationImpots.annee == annee)
        .first()
    )
    if ligne is None:
        ligne = models.DeclarationImpots(annee=annee)
        db.add(ligne)
    for cle in ("taux_pct", "date_limite"):
        if cle in champs:
            setattr(ligne, cle, champs[cle])
    if ligne.taux_pct is None and ligne.date_limite is None:
        if ligne.id is not None:
            db.delete(ligne)
        else:
            db.expunge(ligne)
        db.commit()
        return ligne
    db.commit()
    db.refresh(ligne)
    return ligne


def retirer_etiquette(db: Session, operation: models.Operation) -> None:
    """Retire l'étiquette « à déclarer » — rien d'autre ne change sur l'opération."""
    operation.a_declarer = False
    db.commit()


def poser_etiquettes(db: Session, operation_ids: list[int]) -> dict:
    """Pose l'étiquette sur un LOT d'opérations, cochées dans le sélecteur de l'écran.

    LA MÊME RÈGLE QUE PARTOUT AILLEURS (crud.operation_declarable) : seule une entrée de
    type classique se déclare. Une opération hors périmètre est ÉCARTÉE et comptée, pas
    refusée en bloc — un lot coché à la main ne doit pas échouer entier pour une ligne.
    Une opération déjà étiquetée ne compte pas comme ajoutée."""
    ajoutees, ignorees = 0, 0
    if operation_ids:
        for operation in db.query(models.Operation).filter(models.Operation.id.in_(operation_ids)):
            if not crud.operation_declarable(operation):
                ignorees += 1
            elif not operation.a_declarer:
                operation.a_declarer = True
                ajoutees += 1
        db.commit()
    return {"ajoutees": ajoutees, "ignorees": ignorees}


def bilan_par_monnaie(
    db: Session, operations: list[models.Operation], taux_pct: Optional[float]
) -> list[dict]:
    """Le bilan de l'année, une ligne par monnaie, dans l'ordre des monnaies de l'app.

    Réelles et prévues sont séparées : seules les premières ont été perçues, donc
    seules elles entrent dans le total et dans l'impôt estimé."""
    bilans: dict[int, dict] = {}
    for operation in operations:
        bilan = bilans.setdefault(
            operation.monnaie_id, {"total_reel": 0.0, "total_prevu": 0.0, "nombre": 0}
        )
        bilan["nombre"] += 1
        if operation.statut == Statut.reel:
            bilan["total_reel"] += operation.montant
        else:
            bilan["total_prevu"] += operation.montant
    lignes = []
    for monnaie in crud.get_monnaies(db):
        bilan = bilans.get(monnaie.id)
        if bilan is None:
            continue
        lignes.append(
            {
                "monnaie_id": monnaie.id,
                "monnaie_nom": monnaie.nom,
                "monnaie_symbole": monnaie.symbole,
                "total_reel": round(bilan["total_reel"], 2),
                "total_prevu": round(bilan["total_prevu"], 2),
                "nombre": bilan["nombre"],
                "impot_estime": (
                    round(bilan["total_reel"] * taux_pct / 100, 2) if taux_pct is not None else None
                ),
            }
        )
    return lignes


def vue(db: Session, annee: int, aujourdhui: date_type) -> dict:
    operations = operations_a_declarer(db, annee)
    declaration = declaration_de(db, annee, aujourdhui)
    return {
        "annee": annee,
        "annees": annees_proposees(db, aujourdhui),
        "declaration": declaration,
        "monnaies": bilan_par_monnaie(db, operations, declaration["taux_pct"]),
        "operations": operations,
    }
