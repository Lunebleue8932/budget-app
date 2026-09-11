"""Ce que chaque profil doit, et ce qu'il nous doit.

DEUX RÔLES, ET IL NE FAUT PAS LES CONFONDRE — c'est toute la logique de ce
fichier :

  - une DÉPENSE REMBOURSABLE est une créance : j'ai avancé, on me rendra. Son
    `montant_a_rembourser` est ce qu'on me doit ENCORE ;
  - un PRÊT REÇU est une dette : on m'a avancé, je rendrai. Son
    `montant_a_rembourser` est ce que je dois ENCORE.

Les deux colonnes sont la même, le sens est inverse, et c'est le TYPE qui
tranche — jamais le signe du montant, qui est positif dans les deux cas (cf.
`CheckConstraint("montant >= 0")` sur `Operation`).

LES RÈGLEMENTS NE COMPTENT PAS. Un remboursement reçu et un remboursement de
prêt ont déjà fait décroître la dette qu'ils soldent (cf.
crud._recalculer_montant_a_rembourser) : les soustraire une seconde fois les
compterait deux fois. Ils apparaissent dans le DÉTAIL d'un profil — c'est
l'historique de ce qui a été rendu — et dans aucun total. C'est exactement la
règle de `constants.TYPES_HORS_FLUX`, pour la même raison.

LE STATUT RÉEL SEULEMENT, comme la carte du dashboard (cf.
services/soldes.get_reste_a_rembourser) : une dépense remboursable encore
prévisionnelle n'a rien avancé, un prêt prévisionnel n'est pas encore reçu.
Additionner de l'argent constaté et de l'argent attendu donnerait un net dont
personne ne saurait quoi faire.

JAMAIS DE TOTAL ENTRE MONNAIES, comme partout dans l'application : une dette en
dollars ne compense pas une créance en euros. Tout est groupé par monnaie, et le
net est calculé DANS chacune.
"""
from sqlalchemy.orm import Session

from app import models
from app.constants import Statut, TypeOperation

import schemas_suivi_remboursements as schemas_sr

# Les deux types qui PORTENT une dette, et le sens dans lequel ils pèsent sur le
# solde d'un profil. Ce sont exactement `constants.TYPES_REMBOURSABLES`, lus du
# point de vue de qui doit à qui.
ROLE_CREANCE = "on_me_doit"
ROLE_DETTE = "je_dois"
ROLE_REGLEMENT = "reglement"

ROLE_PAR_TYPE = {
    TypeOperation.remboursable.value: ROLE_CREANCE,
    TypeOperation.pret.value: ROLE_DETTE,
    TypeOperation.remboursements.value: ROLE_REGLEMENT,
    TypeOperation.remboursement_pret.value: ROLE_REGLEMENT,
}

# Les seuls types qu'un profil peut porter. Rattacher une opération classique à
# « Marie » n'aurait aucun sens : il n'y a rien à lui réclamer ni à lui rendre,
# et cela ferait apparaître dans son détail des lignes qui ne pèsent sur aucun
# de ses deux totaux.
TYPES_RATTACHABLES = set(ROLE_PAR_TYPE)

# Ceux qui font le solde. Les règlements sont rattachables (pour l'historique)
# mais ne comptent nulle part.
TYPES_QUI_COMPTENT = {TypeOperation.remboursable.value, TypeOperation.pret.value}

LIBELLE_SANS_PROFIL = "Sans profil"


def _operations_de_dette(db: Session):
    """Les dépenses remboursables et les prêts reçus dont il reste quelque chose
    à régler. Une dette entièrement soldée (`montant_a_rembourser` à zéro) n'a
    plus rien à faire dans un tableau qui répond à « qui doit combien » — elle
    reste lisible dans le détail du profil, par `operations_du_profil`."""
    return (
        db.query(models.Operation)
        .join(models.TypeOperationDB, models.Operation.type_id == models.TypeOperationDB.id)
        .filter(
            models.TypeOperationDB.code.in_(TYPES_QUI_COMPTENT),
            models.Operation.statut == Statut.reel,
            models.Operation.montant_a_rembourser > 0,
        )
        .all()
    )


def _ligne_lue(operation: models.Operation) -> schemas_sr.OperationSuiviRead:
    code = operation.type_code
    return schemas_sr.OperationSuiviRead(
        id=operation.id,
        date=operation.date.isoformat(),
        nature=operation.nature,
        compte_nom=operation.compte.nom,
        monnaie_id=operation.monnaie_id,
        monnaie_symbole=operation.monnaie.symbole,
        montant=operation.montant,
        montant_du=operation.montant_du,
        reste=operation.montant_a_rembourser,
        type_code=code,
        role=ROLE_PAR_TYPE.get(code, ROLE_REGLEMENT),
        profil_id=operation.profil_remboursement_id,
    )


def vue(db: Session) -> schemas_sr.VueSuiviRead:
    """Le tableau complet : un bloc par monnaie, une ligne par profil, plus les
    dettes qu'aucun profil ne porte encore.

    UN PROFIL N'APPARAÎT QUE LÀ OÙ IL PORTE QUELQUE CHOSE. Un profil créé et
    jamais utilisé n'ajoute pas une ligne à zéro dans chaque monnaie : il est
    dans `profils` (donc dans les menus, donc rattachable) et nulle part
    ailleurs. Sans cette règle, ouvrir l'écran après avoir créé cinq profils
    donnerait cinq lignes vides par devise."""
    profils = (
        db.query(models.ProfilRemboursement)
        .order_by(models.ProfilRemboursement.ordre, models.ProfilRemboursement.id)
        .all()
    )
    noms = {profil.id: profil.nom for profil in profils}
    rang = {profil.id: position for position, profil in enumerate(profils)}

    # {monnaie_id: {profil_id ou None: {"a_recevoir", "a_rendre", "nb_lignes"}}}
    cumuls: dict = {}
    monnaies: dict = {}
    a_rattacher = []

    for operation in _operations_de_dette(db):
        monnaies.setdefault(operation.monnaie_id, operation.monnaie)
        par_profil = cumuls.setdefault(operation.monnaie_id, {})
        entree = par_profil.setdefault(
            operation.profil_remboursement_id,
            {"a_recevoir": 0.0, "a_rendre": 0.0, "nb_lignes": 0},
        )
        cle = (
            "a_recevoir"
            if ROLE_PAR_TYPE[operation.type_code] == ROLE_CREANCE
            else "a_rendre"
        )
        entree[cle] += operation.montant_a_rembourser
        entree["nb_lignes"] += 1

        if operation.profil_remboursement_id is None:
            a_rattacher.append(_ligne_lue(operation))

    blocs = []
    for monnaie_id, monnaie in monnaies.items():
        par_profil = cumuls[monnaie_id]
        lignes = [
            schemas_sr.ProfilSoldeRead(
                profil_id=profil_id,
                profil_nom=noms.get(profil_id, LIBELLE_SANS_PROFIL),
                a_recevoir=totaux["a_recevoir"],
                a_rendre=totaux["a_rendre"],
                net=totaux["a_recevoir"] - totaux["a_rendre"],
                nb_lignes=totaux["nb_lignes"],
            )
            for profil_id, totaux in par_profil.items()
        ]
        # L'ordre choisi par l'utilisateur, et « Sans profil » EN DERNIER : c'est
        # un reste à ranger, pas un profil — le mettre en tête sous prétexte que
        # son id est nul en ferait le sujet de l'écran.
        lignes.sort(key=lambda l: (l.profil_id is None, rang.get(l.profil_id, 0)))
        blocs.append(
            schemas_sr.MonnaieSuiviRead(
                monnaie_id=monnaie_id,
                monnaie_nom=monnaie.nom,
                monnaie_symbole=monnaie.symbole,
                total_a_recevoir=sum(l.a_recevoir for l in lignes),
                total_a_rendre=sum(l.a_rendre for l in lignes),
                net=sum(l.net for l in lignes),
                profils=lignes,
            )
        )
    blocs.sort(key=lambda bloc: bloc.monnaie_id)

    a_rattacher.sort(key=lambda ligne: (ligne.date, ligne.id), reverse=True)

    return schemas_sr.VueSuiviRead(
        monnaies=blocs,
        profils=[schemas_sr.ProfilRead.model_validate(p) for p in profils],
        a_rattacher=a_rattacher,
    )


def operations_du_profil(db: Session, profil_id: int) -> list:
    """TOUTES les opérations rattachées à un profil, soldées comprises, et les
    règlements avec.

    C'est le seul endroit où les règlements paraissent : le tableau répond à « ce
    qu'il reste », le détail à « ce qui s'est passé ». Une dette remboursée
    disparaît du premier et doit rester dans le second, sans quoi rattacher une
    opération à quelqu'un reviendrait à la perdre de vue dès qu'elle est réglée.
    """
    operations = (
        db.query(models.Operation)
        .filter(models.Operation.profil_remboursement_id == profil_id)
        .order_by(models.Operation.date.desc(), models.Operation.id.desc())
        .all()
    )
    return [_ligne_lue(operation) for operation in operations]
