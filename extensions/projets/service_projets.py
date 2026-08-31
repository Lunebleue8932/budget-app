"""Ce qu'un projet a coûté.

UNE SOMME AFFICHÉE, JAMAIS UNE DONNÉE. Rien de ce qui se calcule ici n'entre
dans un solde, un budget ou un KPI du dashboard : c'est ce qui permet à une même
opération d'appartenir à trois projets sans être comptée trois fois nulle part.
Un projet est une VUE sur des opérations qui existent sans lui.

PAR MONNAIE, ET JAMAIS AUTREMENT, comme partout ailleurs dans l'application :
l'app ne stocke aucun taux de change, additionner des euros et des dollars
n'aurait aucun sens (cf. services/soldes.py). Un voyage payé moitié en euros,
moitié en francs suisses a donc deux lignes de totaux, pas un total faux.

LE SENS DÉCIDE, PAS LE TYPE, et exactement comme dans le calcul des soldes
(`soldes._solde_delta`) : une sortie est une sortie, qu'elle soit une dépense
ordinaire ou un virement vers un autre compte. C'est la seule convention qui
rende le total d'un projet lisible comme « ce que ce projet a fait bouger ». Un
virement interne dont les DEUX écritures sont versées dans le projet s'y annule
donc de lui-même, ce qui est bien ce qu'il vaut : l'argent n'a pas quitté le
patrimoine.
"""
from app.constants import Sens

# Les deux sens qui font sortir de l'argent, et les deux qui en font entrer.
# Repris de services/soldes._solde_delta : un projet doit compter comme le reste
# de l'application, ou son total ne voudra rien dire à côté d'un solde.
SENS_SORTANTS = {Sens.depense, Sens.transfert_sortant}
SENS_ENTRANTS = {Sens.entree, Sens.transfert_entrant}


def totaux_par_monnaie(sous_filtre) -> list[dict]:
    """[{monnaie_id, monnaie_nom, monnaie_symbole, depenses, entrees, solde}]

    `depenses` et `entrees` sont des valeurs ABSOLUES — c'est ainsi qu'on les
    lit (« 1 240 € dépensés »). `solde` est leur différence, donc négatif pour un
    projet qui n'a fait que coûter : le cas ordinaire d'un voyage.

    Les monnaies sortent dans l'ordre de leur nom : une liste de totaux qui
    change de place d'une visite à l'autre se relit mal.
    """
    par_monnaie: dict[int, dict] = {}
    for operation in sous_filtre.operations:
        entree = par_monnaie.setdefault(
            operation.monnaie_id,
            {
                "monnaie_id": operation.monnaie_id,
                "monnaie_nom": operation.monnaie.nom,
                "monnaie_symbole": operation.monnaie.symbole,
                "depenses": 0.0,
                "entrees": 0.0,
                "solde": 0.0,
            },
        )
        if operation.sens in SENS_SORTANTS:
            entree["depenses"] += operation.montant
        elif operation.sens in SENS_ENTRANTS:
            entree["entrees"] += operation.montant

    for entree in par_monnaie.values():
        entree["solde"] = entree["entrees"] - entree["depenses"]

    return sorted(par_monnaie.values(), key=lambda e: e["monnaie_nom"])


def lire_sous_filtre(sous_filtre) -> dict:
    """Le projet tel que l'écran le lit : ses champs, son compte d'opérations et
    ses totaux.

    Le nombre d'opérations et les totaux sont CALCULÉS à chaque lecture, jamais
    stockés. Une colonne « total » aurait dû être maintenue à chaque création,
    modification et suppression d'opération — y compris depuis les écrans qui
    ignorent tout des projets (l'import, les virements, la récurrence) — pour ne
    rien apprendre qu'une somme ne dise déjà.
    """
    return {
        "id": sous_filtre.id,
        "nom": sous_filtre.nom,
        "description": sous_filtre.description,
        "ordre": sous_filtre.ordre,
        "nombre_operations": len(sous_filtre.operations),
        "totaux": totaux_par_monnaie(sous_filtre),
    }
