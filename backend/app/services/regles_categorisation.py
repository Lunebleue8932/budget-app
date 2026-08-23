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
    """Descend les règles actives dans l'ordre de `ordre`, et s'arrête où on
    lui a dit de s'arrêter.

    La première règle qui correspond pose le TYPE, et le type ne change plus :
    c'est lui qui décide de ce que la ligne est, les règles suivantes ne
    peuvent que compléter ce qu'il laisse ouvert (la catégorie, le compte en
    face). Si elle porte `arreter_apres` — le cas par défaut, et le
    comportement historique — l'évaluation s'arrête là.

    Sinon on continue vers le bas, et chaque règle rencontrée ne remplit que
    les cases encore vides. C'est ce qui fait que **la règle la plus haute
    l'emporte toujours** en cas de désaccord : deux règles ne se disputent
    jamais un champ, la première l'a déjà rempli. Sans cette priorité stricte,
    l'ordre — qui est toute la lisibilité du système — ne voudrait plus rien
    dire.

    Une règle qui correspond sans rien apporter de neuf ne s'attribue pas le
    résultat : seules celles qui ont réellement décidé quelque chose sont
    nommées dans `nom_regle`, faute de quoi le badge « via … » de l'aperçu
    citerait des règles sans effet.

    `brute` est le dict produit par import_bancaire.lire_lignes_brutes
    (clés `nature`, `categorie_banque`, `compte_banque`).
    """
    resultat: Optional[ResultatRegle] = None
    noms: list[str] = []

    for regle in sorted(regles, key=lambda r: (r.ordre, r.id)):
        if not regle.actif:
            continue
        if not evaluer_regle(regle.conditions, brute):
            continue

        if resultat is None:
            type_operation = TypeOperation(regle.type_operation.code)
            resultat = ResultatRegle(nom_regle=regle.nom, type_code=type_operation.value)
            noms.append(regle.nom)
            _completer(resultat, regle, type_operation)
        else:
            type_operation = TypeOperation(resultat.type_code)
            if _completer(resultat, regle, type_operation):
                noms.append(regle.nom)

        if regle.arreter_apres:
            break

    if resultat is None:
        return None
    resultat.nom_regle = " + ".join(noms)
    return resultat


def _completer(resultat: ResultatRegle, regle, type_operation: TypeOperation) -> bool:
    """Verse dans `resultat` ce que `regle` apporte et qui manque encore.

    `type_operation` est celui DÉJÀ RETENU, pas celui de `regle` : une règle de
    complément propose une catégorie ou un compte en face, jamais un autre type
    — et ce qu'elle propose n'est retenu que si le type retenu l'admet. Une
    catégorie posée par une règle sur un type à catégorie imposée serait une
    incohérence en base, exactement celle que le routeur refuse à l'écriture.

    Renvoie True si quelque chose a été posé, pour que l'appelant sache si
    cette règle a compté.
    """
    pose = False
    if (
        resultat.categorie_id is None
        and regle.categorie_id is not None
        and type_operation in TYPES_AVEC_CATEGORIE_LIBRE
    ):
        resultat.categorie_id = regle.categorie_id
        pose = True
    # Seul un virement a un compte en face : sur tout autre type, ce serait un
    # second compte sur une opération qui n'en touche qu'un.
    if (
        resultat.compte_autre_id is None
        and regle.compte_autre_id is not None
        and type_operation == TypeOperation.virement
    ):
        resultat.compte_autre_id = regle.compte_autre_id
        pose = True
    return pose
