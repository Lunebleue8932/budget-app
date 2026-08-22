"""Classement automatique des lignes d'un relevé bancaire.

Le "type" d'une opération (classique / remboursable / remboursement /
virement / prêt / remboursement de prêt) est une colonne depuis la migration
0019 (table `type_operation`). Rien ne le posait automatiquement à l'import —
il fallait reclasser chaque ligne à la main. Une règle fait ce travail à
partir des libellés du relevé.

Structure d'une règle (RegleCategorisation.conditions), calquée sur les
filtres Notion, sur deux niveaux :

    {"operateur": "ET",                     <- combine les groupes
     "groupes": [
        {"operateur": "OU",                 <- combine les conditions du groupe
         "conditions": [
            {"champ": "nature",
             "operateur": "contient",
             "valeur": "PRET"}]}]}

Deux niveaux suffisent à exprimer "(A OU B) ET (C OU D)". Une condition porte
sur un seul champ : viser plusieurs champs se fait en ajoutant autant de
conditions dans un groupe "OU", ce qui rend la combinaison explicite.

Les comparaisons sont insensibles à la casse ET aux accents : les libellés
bancaires sont irrégulièrement accentués et souvent tout en majuscules
("VIR SEPA REMBOURSEMENT" vs "Virement remboursé"), une règle écrite
naturellement doit malgré tout correspondre.
"""
import unicodedata
from dataclasses import dataclass
from typing import Optional

from ..constants import TYPES_AVEC_CATEGORIE_LIBRE, ConnecteurRegle, OperateurRegle, TypeOperation


@dataclass
class ResultatRegle:
    """Ce qu'une règle impose à la ligne : son type, et — seulement si ce type
    l'admet — sa catégorie. Le caractère remboursable en découle, il n'est plus
    porté séparément.

    `compte_autre_id` ne concerne que le virement interne : c'est le compte EN
    FACE, que le relevé ne nomme jamais (il ne décrit qu'un côté de la
    transaction). Sans lui, chaque virement reconnu par une règle devait être
    repris à la main dans l'aperçu avant de pouvoir être importé."""

    nom_regle: str
    type_code: str
    categorie_id: Optional[int] = None
    compte_autre_id: Optional[int] = None


def _normaliser(texte) -> str:
    """Minuscules sans accents, pour comparer "Remboursé" et "REMBOURSE".

    NFD sépare chaque lettre accentuée en (lettre + diacritique) ; on retire
    ensuite les diacritiques (catégorie Unicode "Mn", mark nonspacing).
    """
    if texte is None:
        return ""
    decompose = unicodedata.normalize("NFD", str(texte))
    sans_accents = "".join(c for c in decompose if unicodedata.category(c) != "Mn")
    return sans_accents.casefold().strip()


def _comparer(valeur_champ: str, operateur: str, valeur_regle: str) -> bool:
    champ = _normaliser(valeur_champ)
    attendu = _normaliser(valeur_regle)
    if operateur == OperateurRegle.est.value:
        return champ == attendu
    if operateur == OperateurRegle.nest_pas.value:
        return champ != attendu
    if operateur == OperateurRegle.contient.value:
        return attendu in champ
    if operateur == OperateurRegle.ne_contient_pas.value:
        return attendu not in champ
    # Opérateur inconnu (donnée corrompue en base) : ne jamais correspondre,
    # plutôt que de faire échouer tout l'import.
    return False


def evaluer_condition(condition: dict, brute: dict) -> bool:
    """Une condition porte sur un seul champ.

    Tolère l'ancienne forme `champs: [...]` (avant le passage au champ unique) :
    une règle enregistrée avant ce changement reste évaluable, ses champs
    multiples étant combinés en OU comme à l'origine.
    """
    operateur = condition.get("operateur")
    valeur = condition.get("valeur", "")
    if "champ" in condition:
        return _comparer(brute.get(condition["champ"]), operateur, valeur)
    return any(
        _comparer(brute.get(champ), operateur, valeur) for champ in condition.get("champs") or []
    )


def evaluer_groupe(groupe: dict, brute: dict) -> bool:
    conditions = groupe.get("conditions") or []
    if not conditions:
        return False
    resultats = (evaluer_condition(c, brute) for c in conditions)
    if groupe.get("operateur") == ConnecteurRegle.ou.value:
        return any(resultats)
    return all(resultats)


def evaluer_regle(conditions: dict, brute: dict) -> bool:
    """`conditions` est le JSON complet de RegleCategorisation.conditions."""
    groupes = (conditions or {}).get("groupes") or []
    if not groupes:
        # Une règle sans condition s'appliquerait à tout : refusée côté
        # routeur, ignorée ici par sécurité.
        return False
    resultats = (evaluer_groupe(g, brute) for g in groupes)
    if (conditions or {}).get("operateur") == ConnecteurRegle.ou.value:
        return any(resultats)
    return all(resultats)


def appliquer_regles(regles, brute: dict) -> Optional[ResultatRegle]:
    """Première règle active qui correspond, dans l'ordre de `ordre`.

    Premier match gagnant (et non cumul des règles) : c'est ce qui rend la
    hiérarchie lisible — placer un cas particulier avant un cas général suffit
    à le faire primer, sans avoir à raisonner sur des effets combinés.

    `brute` est le dict produit par import_bancaire.lire_lignes_brutes
    (clés `nature`, `categorie_banque`, `compte_banque`).
    """
    for regle in sorted(regles, key=lambda r: (r.ordre, r.id)):
        if not regle.actif:
            continue
        if not evaluer_regle(regle.conditions, brute):
            continue

        type_operation = TypeOperation(regle.type_operation.code)
        return ResultatRegle(
            nom_regle=regle.nom,
            type_code=type_operation.value,
            # Les types à catégorie imposée n'en portent plus aucune.
            categorie_id=(
                regle.categorie_id if type_operation in TYPES_AVEC_CATEGORIE_LIBRE else None
            ),
            # Seul un virement a un compte en face : sur tout autre type, ce
            # serait un second compte sur une opération qui n'en touche qu'un.
            compte_autre_id=(
                regle.compte_autre_id
                if type_operation == TypeOperation.virement
                else None
            ),
        )
    return None
