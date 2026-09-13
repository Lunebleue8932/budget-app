"""Trois lectures que rien ne donnait, et pas une écriture de calcul.

CE SERVICE NE CRÉE, NE MODIFIE ET NE SUPPRIME AUCUNE OPÉRATION. Il lit ce qui
existe et le range autrement — les soldes, les KPI et l'histogramme donnent
rigoureusement les mêmes chiffres que l'extension tourne ou non. Les deux seules
choses qu'elle écrit sont une étiquette (`operation.imprevue`) et un seuil
(`matelas_securite`), tous deux dans le noyau (migration 0059).

LES TROIS QUESTIONS :

  - CE QUI N'ÉTAIT PAS PRÉVISIBLE. « Combien de ce mois n'était pas
    prévisible ? » ne se déduit d'aucune catégorie : une dépense d'alimentation
    peut être imprévue, une réparation parfaitement attendue. D'où une étiquette
    posée à la main, et la seule chose qu'on en attende — un total, rapporté au
    total dépensé, mois par mois et année par année.
  - CE QU'ON A MIS DE CÔTÉ. Le solde d'un compte d'épargne dit ce qu'il Y A ;
    il ne dit pas ce qu'on y a MIS ce mois-ci, qui est la seule question à
    laquelle on puisse répondre par une décision. Elle se lit dans les virements
    internes entre un compte courant et un compte d'épargne ou de placement.
  - CE QU'ON VEUT GARDER DISPONIBLE. Un matelas de sécurité, et de quoi voir
    d'un coup d'œil qu'on est passé dessous.
"""
from datetime import date as date_type
from typing import Optional

from sqlalchemy import func
from sqlalchemy.orm import Session, aliased

from app import models
from app.constants import (
    TYPE_COMPTE_EPARGNE,
    TYPES_COMPTE_HORS_COURANT,
    Sens,
    Statut,
    TypeOperation,
)
from app.services import soldes


# ---------- Le matelas de sécurité ----------


def get_matelas(db: Session, monnaie_id: int) -> float:
    """Le seuil posé pour cette monnaie, ou 0.0.

    ZÉRO VEUT DIRE « AUCUN MATELAS », et non « un matelas de zéro » : c'est ce
    qui permet à l'écran de se taire plutôt que d'annoncer un seuil toujours
    tenu. Même convention que le budget total (cf. crud.get_budget_total)."""
    entree = (
        db.query(models.MatelasSecurite)
        .filter(models.MatelasSecurite.monnaie_id == monnaie_id)
        .first()
    )
    return entree.montant if entree else 0.0


def set_matelas(db: Session, monnaie_id: int, montant: float) -> None:
    entree = (
        db.query(models.MatelasSecurite)
        .filter(models.MatelasSecurite.monnaie_id == monnaie_id)
        .first()
    )
    if entree:
        entree.montant = montant
    else:
        db.add(models.MatelasSecurite(monnaie_id=monnaie_id, montant=montant))
    db.commit()


def disponible_epargne(db: Session, monnaie_id: int) -> dict:
    """Ce que portent AUJOURD'HUI les comptes d'épargne, dans une monnaie.

    LES COMPTES D'ÉPARGNE SEULS, et non « hors courant ». Un compte de
    placements porte des espèces ET des titres : ses titres ne sont disponibles
    qu'après une vente, à un cours qu'on ne connaît pas d'avance, et les compter
    dans un matelas de SÉCURITÉ reviendrait à se rassurer avec de l'argent qu'on
    n'a pas encore. Les espèces d'un compte-titres y échapperaient à bon droit ;
    les y faire entrer demanderait de distinguer deux soldes dans un même compte,
    pour un gain douteux — on les vire sur son épargne si on veut les compter.

    LE SOLDE RÉEL, jamais le projeté : un matelas répond à « de quoi est-ce que
    je dispose là, tout de suite », et une dépense prévisionnelle n'a pas encore
    quitté le compte."""
    total = 0.0
    comptes = []
    for item in soldes.get_soldes_comptes(db):
        compte = item["compte"]
        if compte.type_nom != TYPE_COMPTE_EPARGNE:
            continue
        detail = item["soldes"].get(monnaie_id)
        if detail is None:
            continue
        total += detail["solde_reel"]
        comptes.append({"compte_id": compte.id, "nom": compte.nom, "solde": detail["solde_reel"]})
    return {"total": total, "comptes": comptes}


def etat_matelas(db: Session, monnaie_id: int) -> dict:
    """Le seuil, ce qu'on a en face, et l'écart entre les deux."""
    seuil = get_matelas(db, monnaie_id)
    dispo = disponible_epargne(db, monnaie_id)
    return {
        "monnaie_id": monnaie_id,
        "matelas": seuil,
        "disponible": dispo["total"],
        # Négatif = on est passé dessous, et de combien. C'est ce chiffre-là
        # qu'on veut lire : « il manque 340 € » se comprend, « 2 660 sur 3 000 »
        # demande une soustraction.
        "ecart": dispo["total"] - seuil,
        "sous_le_seuil": seuil > 0 and dispo["total"] < seuil,
        "comptes": dispo["comptes"],
    }


# ---------- Ce qu'on a mis de côté ----------
#
# LE CALCUL SE LIT DANS LES VIREMENTS INTERNES, et nulle part ailleurs : mettre
# de côté, c'est déplacer de l'argent d'un compte courant vers un compte
# d'épargne ou de placements. Un virement d'épargne à épargne ne met rien de
# côté — il range autrement ce qui l'est déjà — et un virement de courant à
# courant encore moins. Les deux sont donc écartés.
#
# ON COMPTE TOUJOURS LA JAMBE DU CÔTÉ DE L'ÉPARGNE, et c'est ce qui rend le
# chiffre juste entre deux monnaies : verser 100 € qui arrivent en 108 $ sur un
# compte en dollars a mis 108 $ de côté, pas 100 — et c'est bien 108 qu'il
# faudra en retirer. Prendre la jambe émettrice aurait rangé un montant en euros
# dans le total en dollars.


def _somme_jambes_epargne(
    db: Session,
    monnaie_id: int,
    sens_cote_epargne: Sens,
    annee: int,
    mois: Optional[int],
) -> float:
    """La somme des jambes de virement situées sur un compte HORS COURANT, dans
    un sens donné, dont la jambe d'en face est sur un compte COURANT.

    LES DEUX JAMBES SONT JOINTES PAR `virement_id` : c'est la seule chose qui
    les relie, et sans elle on ne saurait pas d'où vient l'argent — donc pas
    s'il s'agit d'une mise de côté ou d'un simple rangement interne.

    TOUT EST EXPRIMÉ SUR LES ALIAS, jusqu'à la somme et au filtre de date, et
    c'est le piège de cette requête : `func.sum(models.Operation.montant)` sur
    une requête qui n'emploie que des alias fait entrer la table `operation`
    UNE SECONDE FOIS dans le FROM, sans condition de jointure — un produit
    cartésien qui gonfle le total d'un facteur égal au nombre d'opérations. Le
    résultat reste plausible (il garde ses proportions), ce qui le rend
    particulièrement difficile à voir : c'est un test qui l'a attrapé, pas une
    relecture.

    D'où aussi le filtre de date écrit ici plutôt que repris de
    `soldes.filtre_date_periode`, qui porte sur `models.Operation.date` et
    ramènerait exactement la même table de trop."""
    jambe = aliased(models.Operation)
    face = aliased(models.Operation)
    compte_jambe = aliased(models.Compte)
    type_jambe = aliased(models.TypeCompte)
    compte_face = aliased(models.Compte)
    type_face = aliased(models.TypeCompte)

    if mois is None:
        filtre_date = func.strftime("%Y", jambe.date) == f"{annee:04d}"
    else:
        filtre_date = func.strftime("%Y-%m", jambe.date) == f"{annee:04d}-{mois:02d}"

    total = (
        db.query(func.sum(jambe.montant))
        .select_from(jambe)
        .join(compte_jambe, jambe.compte_id == compte_jambe.id)
        .join(type_jambe, compte_jambe.type_id == type_jambe.id)
        .join(
            face,
            (face.virement_id == jambe.virement_id) & (face.id != jambe.id),
        )
        .join(compte_face, face.compte_id == compte_face.id)
        .join(type_face, compte_face.type_id == type_face.id)
        .filter(
            jambe.virement_id.isnot(None),
            jambe.monnaie_id == monnaie_id,
            jambe.sens == sens_cote_epargne,
            # RÉEL SEULEMENT : une mise de côté prévue n'a pas encore eu lieu,
            # et la compter donnerait un chiffre qu'aucun relevé ne confirme.
            jambe.statut == Statut.reel,
            type_jambe.nom.in_(TYPES_COMPTE_HORS_COURANT),
            type_face.nom.notin_(TYPES_COMPTE_HORS_COURANT),
            filtre_date,
        )
        .scalar()
    )
    return total or 0.0


def epargne_periode(
    db: Session, annee: int, mois: Optional[int], monnaie_id: int
) -> dict:
    """Versé, retiré, net — sur un mois ou sur une année entière.

    LES TROIS, et non le seul net. Un net à zéro peut aussi bien vouloir dire
    « je n'ai rien bougé » que « j'ai versé 2 000 € et j'en ai repris 2 000 » :
    ce sont deux mois très différents, et le second mérite au moins qu'on le
    remarque. Même raison que le détail sous « Reste à rembourser », qui écrit
    « on te doit X · tu dois Y » plutôt qu'un seul solde net."""
    verse = _somme_jambes_epargne(db, monnaie_id, Sens.transfert_entrant, annee, mois)
    retire = _somme_jambes_epargne(db, monnaie_id, Sens.transfert_sortant, annee, mois)
    return {
        "monnaie_id": monnaie_id,
        "verse": verse,
        "retire": retire,
        "net": verse - retire,
    }


def epargne_par_mois(db: Session, annee: int, monnaie_id: int) -> list[dict]:
    """Les douze mois de l'année, chacun avec ses trois chiffres.

    DOUZE LIGNES TOUJOURS, y compris les mois où rien n'a bougé : un mois absent
    de la liste se lirait comme un mois qu'on n'a pas encore atteint, alors qu'un
    mois à zéro est une information — on n'a rien mis de côté."""
    return [
        {"mois": mois, **epargne_periode(db, annee, mois, monnaie_id)}
        for mois in range(1, 13)
    ]


# ---------- Ce qui n'était pas prévisible ----------
#
# LE PÉRIMÈTRE EST CELUI DE L'HISTOGRAMME DES DÉPENSES : les types à catégorie
# libre (classique, remboursable), en statut réel, hors virements internes. Une
# étiquette « imprévue » posée sur un virement ne voudrait rien dire — déplacer
# son propre argent n'est pas une dépense — et le total ne serait comparable à
# rien de ce que l'écran affiche à côté.


def _depenses_de_la_periode(db: Session, annee: int, mois: Optional[int], monnaie_id: int):
    return (
        db.query(models.Operation)
        .join(models.TypeOperationDB, models.Operation.type_id == models.TypeOperationDB.id)
        .filter(
            soldes.filtre_date_periode(annee, mois),
            models.Operation.monnaie_id == monnaie_id,
            models.Operation.statut == Statut.reel,
            models.Operation.sens == Sens.depense,
            models.TypeOperationDB.code.in_(
                [TypeOperation.classique.value, TypeOperation.remboursable.value]
            ),
        )
    )


def imprevues_periode(
    db: Session, annee: int, mois: Optional[int], monnaie_id: int
) -> dict:
    """Ce que la période a coûté, et la part qu'on n'avait pas vue venir."""
    base = _depenses_de_la_periode(db, annee, mois, monnaie_id)
    total = base.with_entities(func.sum(models.Operation.montant)).scalar() or 0.0
    imprevu = (
        base.filter(models.Operation.imprevue.is_(True))
        .with_entities(func.sum(models.Operation.montant))
        .scalar()
        or 0.0
    )
    return {
        "monnaie_id": monnaie_id,
        "total": total,
        "imprevu": imprevu,
        # La part, calculée ici et non à l'écran : deux endroits qui divisent
        # les mêmes nombres finissent par ne plus tomber d'accord à l'arrondi.
        # Zéro dépense donne zéro pour cent, et non une division par zéro.
        "part": (imprevu / total * 100.0) if total else 0.0,
    }


def imprevues_par_mois(db: Session, annee: int, monnaie_id: int) -> list[dict]:
    return [
        {"mois": mois, **imprevues_periode(db, annee, mois, monnaie_id)}
        for mois in range(1, 13)
    ]


def detail_imprevues(
    db: Session, annee: int, mois: Optional[int], monnaie_id: int
) -> list[dict]:
    """Les lignes elles-mêmes, les plus grosses d'abord.

    UN TOTAL SANS SON DÉTAIL N'APPREND RIEN : « 640 € d'imprévu en mars » appelle
    immédiatement « lesquels ? », et il faudrait sinon repartir dans Opérations
    reconstituer la liste à la main."""
    lignes = (
        _depenses_de_la_periode(db, annee, mois, monnaie_id)
        .filter(models.Operation.imprevue.is_(True))
        .order_by(models.Operation.montant.desc())
        .all()
    )
    return [
        {
            "id": op.id,
            "date": op.date,
            "nature": op.nature,
            "montant": op.montant,
            "categorie": op.categorie.nom if op.categorie else None,
        }
        for op in lignes
    ]
