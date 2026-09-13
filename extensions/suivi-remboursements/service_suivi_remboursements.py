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


def _montant_lu(monnaie, totaux: dict) -> schemas_sr.MontantMonnaieRead:
    return schemas_sr.MontantMonnaieRead(
        monnaie_id=monnaie.id,
        monnaie_nom=monnaie.nom,
        monnaie_symbole=monnaie.symbole,
        a_recevoir=totaux["a_recevoir"],
        a_rendre=totaux["a_rendre"],
        net=totaux["a_recevoir"] - totaux["a_rendre"],
        nb_lignes=totaux["nb_lignes"],
    )


def _cumul_vide() -> dict:
    return {"a_recevoir": 0.0, "a_rendre": 0.0, "nb_lignes": 0}


def vue(db: Session) -> schemas_sr.VueSuiviRead:
    """Le tableau complet : une ligne par profil, portant autant de montants que
    de monnaies où il doit ou nous doit quelque chose — plus les dettes qu'aucun
    profil ne porte encore.

    LE PROFIL EST LE PREMIER NIVEAU, LA MONNAIE LE SECOND. C'était l'inverse au
    début, avec un onglet par devise au-dessus du tableau : il fallait cliquer
    pour savoir si Marie doit aussi des dollars, et un profil qui ne porte rien
    dans la devise active disparaissait de l'écran. Pour un écran dont le sujet
    EST la liste des gens, c'était le mauvais axe. Rien ne s'additionne pour
    autant d'une monnaie à l'autre — il y a simplement plusieurs montants par
    ligne, chacun dans sa devise.

    UN PROFIL N'APPARAÎT QUE S'IL PORTE QUELQUE CHOSE. Un profil créé et jamais
    utilisé n'ajoute pas une ligne à zéro : il est dans `profils` (donc dans les
    menus, donc rattachable) et nulle part ailleurs. Sans cette règle, ouvrir
    l'écran après avoir créé cinq profils donnerait cinq lignes vides. Même règle
    au second niveau : une monnaie où un profil ne doit rien ne lui fait pas une
    barre de plus."""
    profils = (
        db.query(models.ProfilRemboursement)
        .order_by(models.ProfilRemboursement.ordre, models.ProfilRemboursement.id)
        .all()
    )
    noms = {profil.id: profil.nom for profil in profils}
    rang = {profil.id: position for position, profil in enumerate(profils)}

    # {profil_id ou None: {monnaie_id: {"a_recevoir", "a_rendre", "nb_lignes"}}}
    cumuls: dict = {}
    # {monnaie_id: <Monnaie>} — l'objet, pour n'avoir pas à le relire ensuite.
    monnaies: dict = {}
    totaux_globaux: dict = {}
    a_rattacher = []

    for operation in _operations_de_dette(db):
        monnaies.setdefault(operation.monnaie_id, operation.monnaie)
        par_monnaie = cumuls.setdefault(operation.profil_remboursement_id, {})
        entree = par_monnaie.setdefault(operation.monnaie_id, _cumul_vide())
        global_ = totaux_globaux.setdefault(operation.monnaie_id, _cumul_vide())

        cle = (
            "a_recevoir"
            if ROLE_PAR_TYPE[operation.type_code] == ROLE_CREANCE
            else "a_rendre"
        )
        for cumul in (entree, global_):
            cumul[cle] += operation.montant_a_rembourser
            cumul["nb_lignes"] += 1

        if operation.profil_remboursement_id is None:
            a_rattacher.append(_ligne_lue(operation))

    soldes = [
        schemas_sr.ProfilSoldeRead(
            profil_id=profil_id,
            profil_nom=noms.get(profil_id, LIBELLE_SANS_PROFIL),
            monnaies=[
                _montant_lu(monnaies[monnaie_id], totaux)
                for monnaie_id, totaux in sorted(par_monnaie.items())
            ],
        )
        for profil_id, par_monnaie in cumuls.items()
    ]
    # L'ordre choisi par l'utilisateur, et « Sans profil » EN DERNIER : c'est un
    # reste à ranger, pas un profil — le mettre en tête sous prétexte que son id
    # est nul en ferait le sujet de l'écran.
    soldes.sort(key=lambda ligne: (ligne.profil_id is None, rang.get(ligne.profil_id, 0)))

    a_rattacher.sort(key=lambda ligne: (ligne.date, ligne.id), reverse=True)

    return schemas_sr.VueSuiviRead(
        totaux=[
            _montant_lu(monnaies[monnaie_id], totaux)
            for monnaie_id, totaux in sorted(totaux_globaux.items())
        ],
        soldes=soldes,
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
