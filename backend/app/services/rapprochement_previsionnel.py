"""Reconnaître, dans un relevé qu'on importe, la dépense qu'on avait PRÉVUE.

LE PROBLÈME QUE ÇA RÉSOUT. Le statut « prévisionnel » existe depuis toujours :
on écrit la dépense qu'on sait devoir venir, elle pèse sur le solde projeté, et
c'est utile. Mais quand la vraie ligne arrivait au relevé, RIEN ne les reliait.
L'import créait une seconde opération, et la même dépense comptait deux fois
jusqu'à ce qu'on pense à supprimer l'ancienne à la main — personne n'y pense. La
prévisionnelle était donc une note qu'on s'écrivait à soi-même, et la seule
façon de s'en servir sans fausser ses chiffres était de ne pas s'en servir.

CE QU'ON REGARDE POUR RECONNAÎTRE, et rien d'autre :

  - LE COMPTE ET LA MONNAIE, à l'identique. Deux montants égaux sur deux comptes
    différents ne sont pas la même dépense, et la question ne se pose même pas ;
  - LE MONTANT, AU CENTIME PRÈS, en valeur absolue. Une tolérance rendrait
    proposable à peu près n'importe quoi sur un relevé de trois cents lignes, et
    le mécanisme ne vaut que si ce qu'il propose est presque toujours juste.
    C'est la limite assumée : un prélèvement dont le montant change (indexation,
    change) ne sera pas reconnu, et s'importera comme une ligne ordinaire — le
    pire qui puisse arriver est l'ancien comportement ;
  - LA DATE, dans la FENÊTRE de la prévisionnelle (`rapprochement_debut` /
    `rapprochement_fin`, à défaut sa propre date). On connaît souvent le mois
    d'un prélèvement et rarement son jour, et une banque passe volontiers au 6
    ce qu'elle annonçait au 5 ;
  - LE TYPE, à l'identique. Conservateur, et c'est voulu : écraser une dépense
    remboursable avec une ligne classée classique perdrait son montant dû sans
    que rien ne le dise ;
  - LES MOTS-CLÉS, s'il y en a. Combinés en ET, cherchés dans le libellé sans
    tenir compte de la casse ni des accents. Vides dans le cas ordinaire — le
    montant et la fenêtre suffisent presque toujours — ils servent au cas
    inverse : deux prélèvements du même montant le même mois, que seul le
    libellé distingue.

LES VIREMENTS SONT ÉCARTÉS DES DEUX CÔTÉS. Un virement interne est UN mouvement
décrit par DEUX écritures ; écraser l'une des deux laisserait l'autre orpheline,
et le compte d'en face faux. Un virement prévu se supprime à la main, ce qui est
d'ailleurs le geste qu'on fait déjà.

UNE PRÉVISIONNELLE NE SERT QU'UNE FOIS PAR IMPORT (`deja_prises`) : sans cette
mémoire, trois prélèvements identiques du même mois auraient tous les trois
proposé d'écraser la même prévisionnelle, et deux d'entre eux se seraient
annulés l'un l'autre au moment d'écrire.

RIEN N'EST RAPPROCHÉ D'OFFICE. Ce module DÉSIGNE ; c'est l'aperçu d'import qui
montre, coche par coche, et l'utilisateur qui décide. Écraser une opération sans
le demander serait la seule façon de rendre ce mécanisme pire que le doublon
qu'il supprime.
"""
import unicodedata
from datetime import date as date_type
from typing import Iterable, Optional

from .. import models
from ..constants import Statut, TypeOperation


def _normaliser(texte) -> str:
    """Minuscules sans accents — même normalisation que les règles de
    catégorisation (cf. services/regles_categorisation._normaliser) : un mot-clé
    ne doit pas obliger à deviner la casse exacte du relevé."""
    if texte is None:
        return ""
    decompose = unicodedata.normalize("NFD", str(texte))
    return "".join(c for c in decompose if unicodedata.category(c) != "Mn").casefold()


def fenetre(previsionnelle: models.Operation) -> tuple[date_type, date_type]:
    """Les deux bornes dans lesquelles la vraie dépense est attendue.

    À DÉFAUT DE FENÊTRE, LE JOUR MÊME. C'est ce qui rend rapprochable, sans
    aucune reprise de données, tout ce qui a été écrit avant la migration 0058 —
    les occurrences déjà générées des opérations récurrentes comprises."""
    debut = previsionnelle.rapprochement_debut or previsionnelle.date
    fin = previsionnelle.rapprochement_fin or previsionnelle.date
    return debut, fin


def mots_cles(previsionnelle: models.Operation) -> list[str]:
    """Les mots-clés rangés en JSON sur la colonne, en liste.

    Une colonne abîmée rend une liste vide plutôt que de lever : le
    rapprochement se fera sans mots-clés, ce qui est strictement moins précis,
    jamais faux."""
    import json

    brut = previsionnelle.rapprochement_mots_cles
    if not brut:
        return []
    try:
        lu = json.loads(brut)
    except ValueError:
        return []
    return [str(m) for m in lu if str(m).strip()] if isinstance(lu, list) else []


def previsionnelles_rapprochables(db, comptes_ids: Iterable[int]) -> list[models.Operation]:
    """Les prévisionnelles des comptes concernés par le fichier, chargées UNE
    FOIS pour tout l'import.

    Une requête par ligne aurait fait trois cents allers-retours sur un relevé
    ordinaire, pour lire à chaque fois la même poignée d'opérations — il y a
    rarement plus de quelques dizaines de prévisionnelles vivantes."""
    ids = [c for c in comptes_ids if c is not None]
    if not ids:
        return []
    return (
        db.query(models.Operation)
        .filter(
            models.Operation.statut == Statut.previsionnel,
            models.Operation.compte_id.in_(set(ids)),
        )
        .all()
    )


def _correspond(
    previsionnelle: models.Operation,
    *,
    date: date_type,
    montant: float,
    compte_id: int,
    monnaie_id: int,
    type_id: int,
    nature: str,
) -> bool:
    if previsionnelle.compte_id != compte_id:
        return False
    if previsionnelle.monnaie_id != monnaie_id:
        return False
    if previsionnelle.type_id != type_id:
        return False
    if TypeOperation(previsionnelle.type_code) == TypeOperation.virement:
        return False
    # Au centime : les deux côtés sont des montants arrondis à deux décimales,
    # et comparer des flottants bruts ferait échouer 12,30 contre 12,299999.
    if round(abs(previsionnelle.montant), 2) != round(abs(montant), 2):
        return False
    debut, fin = fenetre(previsionnelle)
    if not (debut <= date <= fin):
        return False
    libelle = _normaliser(nature)
    return all(_normaliser(mot) in libelle for mot in mots_cles(previsionnelle))


def chercher(
    previsionnelles: Iterable[models.Operation],
    *,
    date: Optional[date_type],
    montant: Optional[float],
    compte_id: Optional[int],
    monnaie_id: Optional[int],
    type_id: Optional[int],
    nature: str = "",
    deja_prises: Iterable[int] = (),
) -> Optional[models.Operation]:
    """LA prévisionnelle que cette ligne vient solder, ou None.

    LA PLUS PROCHE DANS LE TEMPS L'EMPORTE quand plusieurs conviennent : deux
    loyers identiques attendus en janvier et en février doivent partir chacun sur
    le sien, et la date est la seule chose qui les distingue. À égalité, le plus
    petit identifiant — non pas parce qu'il serait meilleur, mais parce qu'un
    départage arbitraire vaut mieux qu'un départage instable : le même fichier
    importé deux fois doit proposer deux fois la même chose.

    UNE LIGNE INCOMPLÈTE NE RAPPROCHE RIEN. Sans date, sans montant ou sans
    compte, on ne compare rien — et une ligne qui n'a pas ces trois-là ne
    s'importera de toute façon pas (cf. import_bancaire._erreur_ligne)."""
    if date is None or montant is None or compte_id is None or monnaie_id is None:
        return None
    if type_id is None:
        return None
    prises = set(deja_prises)
    candidates = [
        p
        for p in previsionnelles
        if p.id not in prises
        and _correspond(
            p,
            date=date,
            montant=montant,
            compte_id=compte_id,
            monnaie_id=monnaie_id,
            type_id=type_id,
            nature=nature,
        )
    ]
    if not candidates:
        return None
    return min(candidates, key=lambda p: (abs((p.date - date).days), p.id))
