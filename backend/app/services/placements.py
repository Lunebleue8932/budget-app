"""Portefeuilles de titres des comptes de placement.

Rien n'est stocké de ce qui est détenu : quantités, prix de revient et
valorisations se recalculent depuis les mouvements (`operation_action`). C'est
le même parti pris que pour le reste de l'app — un solde recalculé ne peut pas
dériver de ses écritures, alors qu'un solde stocké finit toujours par le faire.

Le versant espèces, lui, n'a rien de spécifique : chaque mouvement porte une
`Operation` ordinaire (type `action`, sens transfert), déjà prise en compte par
services/soldes.py comme n'importe quelle autre.
"""
from typing import Optional

from sqlalchemy.orm import Session

from .. import models
from ..constants import TYPE_COMPTE_PLACEMENT, SensAction

# En dessous de ce seuil, une quantité résiduelle n'est que du bruit de calcul
# en virgule flottante (tout vendre doit afficher une ligne soldée, pas
# 1e-15 titre).
EPSILON_QUANTITE = 1e-9


def get_comptes_placement(db: Session) -> list[models.Compte]:
    return (
        db.query(models.Compte)
        .join(models.TypeCompte, models.Compte.type_id == models.TypeCompte.id)
        .filter(models.TypeCompte.nom == TYPE_COMPTE_PLACEMENT)
        .order_by(models.Compte.nom)
        .all()
    )


def get_mouvements(db: Session, compte_id: Optional[int] = None) -> list[models.OperationAction]:
    """Mouvements de titres, du plus ancien au plus récent — l'ordre dans lequel
    le prix de revient moyen doit être déroulé."""
    query = (
        db.query(models.OperationAction)
        .join(models.Operation, models.OperationAction.operation_id == models.Operation.id)
        .order_by(models.Operation.date, models.Operation.id)
    )
    if compte_id is not None:
        query = query.filter(models.Operation.compte_id == compte_id)
    return query.all()


def _replier_mouvements(mouvements: list[models.OperationAction]) -> dict:
    """Déroule les mouvements d'un compte pour obtenir, par titre, la quantité
    restante et ce qu'elle a coûté.

    Prix de revient = coût moyen pondéré : une vente sort les titres au coût
    moyen du stock du moment (elle ne choisit pas quels titres partent), donc
    elle réduit quantité et coût dans la même proportion et laisse le prix de
    revient inchangé. C'est la convention retenue par l'administration fiscale
    française pour les titres fongibles, et la seule qui ne demande pas de
    suivre chaque titre individuellement.
    """
    etat: dict = {}
    for mouvement in mouvements:
        ligne = etat.setdefault(
            mouvement.action_id, {"action": mouvement.action, "quantite": 0.0, "cout": 0.0}
        )
        if mouvement.sens == SensAction.achat:
            ligne["quantite"] += mouvement.quantite
            ligne["cout"] += mouvement.quantite * mouvement.prix_unitaire
            continue
        # Vente : on retire la même fraction de quantité et de coût.
        if ligne["quantite"] > EPSILON_QUANTITE:
            fraction = min(1.0, mouvement.quantite / ligne["quantite"])
            ligne["cout"] -= ligne["cout"] * fraction
        ligne["quantite"] -= mouvement.quantite
        if ligne["quantite"] <= EPSILON_QUANTITE:
            # Position soldée : le résidu de coût n'a plus de support.
            ligne["quantite"] = 0.0
            ligne["cout"] = 0.0
    return etat


def detentions(db: Session, compte_id: int) -> list[dict]:
    """Titres encore détenus sur ce compte, les positions soldées exclues."""
    etat = _replier_mouvements(get_mouvements(db, compte_id))
    resultat = []
    for action_id, ligne in etat.items():
        if ligne["quantite"] <= EPSILON_QUANTITE:
            continue
        action = ligne["action"]
        valorisation = ligne["quantite"] * action.valeur
        resultat.append(
            {
                "action_id": action_id,
                "action_nom": action.nom,
                # Monnaie de cotation du titre : cours, prix de revient et
                # valorisation en sont tous libellés.
                "monnaie_id": action.monnaie_id,
                "monnaie_symbole": action.monnaie.symbole,
                "quantite": ligne["quantite"],
                "prix_revient_unitaire": ligne["cout"] / ligne["quantite"],
                "montant_investi": ligne["cout"],
                "valeur_unitaire": action.valeur,
                "valorisation": valorisation,
                "plus_value_latente": valorisation - ligne["cout"],
            }
        )
    resultat.sort(key=lambda ligne: ligne["action_nom"])
    return resultat


def quantite_detenue(db: Session, compte_id: int, action_id: int) -> float:
    """Quantité d'un titre détenue sur un compte — la borne d'une vente."""
    etat = _replier_mouvements(get_mouvements(db, compte_id))
    ligne = etat.get(action_id)
    return ligne["quantite"] if ligne else 0.0


def valorisation_compte(db: Session, compte_id: int) -> dict:
    """Valeur du portefeuille d'un compte, PAR MONNAIE de cotation : deux titres
    cotés en euros et en dollars ne s'additionnent pas."""
    totaux: dict = {}
    for ligne in detentions(db, compte_id):
        totaux[ligne["monnaie_id"]] = (
            totaux.get(ligne["monnaie_id"], 0.0) + ligne["valorisation"]
        )
    return totaux


def montant_investi_compte(db: Session, compte_id: int) -> dict:
    """Coût des titres encore détenus, par monnaie — la base de la plus-value
    latente."""
    totaux: dict = {}
    for ligne in detentions(db, compte_id):
        totaux[ligne["monnaie_id"]] = (
            totaux.get(ligne["monnaie_id"], 0.0) + ligne["montant_investi"]
        )
    return totaux


def valorisation_totale(db: Session) -> dict:
    """Valeur de tous les portefeuilles, au dernier cours saisi, par monnaie —
    la part "titres" du patrimoine, qu'aucun solde de compte ne reflète."""
    totaux: dict = {}
    for compte in get_comptes_placement(db):
        for monnaie_id, valorisation in valorisation_compte(db, compte.id).items():
            totaux[monnaie_id] = totaux.get(monnaie_id, 0.0) + valorisation
    return totaux
