"""Convertir plusieurs monnaies en une seule, pour la bascule du dashboard.

CE QUE CE MODULE N'EST PAS. Ce n'est pas une monnaie de référence introduite
dans l'application : rien n'est réécrit, rien n'est enregistré, et tout ce qui
est calculé ici l'est à la demande d'un geste explicite de l'utilisateur (la
bascule « tout convertir en… »). Éteindre l'extension, ou simplement décocher la
case, rend l'application au fonctionnement monnaie par monnaie qui est le sien
partout ailleurs.

D'OÙ VIENNENT LES TAUX. De la table `taux_change` du noyau, remplie soit à la
main depuis l'écran des monnaies, soit par l'extension « Lecture de cours »
quand elle tourne. C'est la même table : un taux relu en ligne sert donc à
convertir sans qu'on ait à le ressaisir.

PAS DE CHAÎNE DE CONVERSION. Un taux EUR->USD et un taux USD->JPY ne sont pas
utilisés pour fabriquer un EUR->JPY. Deux raisons, et la seconde suffirait :
les erreurs se multiplient d'un maillon à l'autre, et surtout un taux qu'on n'a
jamais saisi apparaîtrait comme s'il était connu. Une monnaie sans taux direct
(ou sans l'inverse) n'est pas convertie — elle est NOMMÉE dans la réponse, et
l'écran le dit.

L'INVERSE, LUI, EST ADMIS. « 1 € vaut 1,08 $ » et « 1 $ vaut 0,926 € » sont la
même information écrite dans les deux sens ; obliger à saisir les deux lignes ne
protégerait de rien et doublerait le travail à chaque nouvelle devise.
"""
from app import crud, models


def table_de_conversion(db, vers_monnaie_id: int) -> tuple[dict, list]:
    """Combien vaut UNE unité de chaque monnaie dans `vers_monnaie_id`.

    Rend (coefficients, monnaies non converties). La monnaie cible y figure à
    1.0 — pas comme un cas particulier à traiter partout ailleurs, mais parce
    que c'est vrai.

    Un taux à NULL (couple enregistré, jamais relu) est traité comme absent : un
    couple qu'on a déclaré vouloir suivre mais dont la lecture n'a jamais abouti
    ne dit rien du monde.
    """
    coefficients = {vers_monnaie_id: 1.0}

    couples = db.query(models.TauxChange).filter(models.TauxChange.taux.isnot(None)).all()
    for couple in couples:
        if couple.taux <= 0:
            # Un taux nul ou négatif ne décrit rien et ferait exploser la
            # division de l'inverse. Ignoré plutôt que refusé : la saisie le
            # rejette déjà, et une donnée ancienne ne doit pas casser un écran.
            continue
        if couple.monnaie_cible_id == vers_monnaie_id:
            coefficients.setdefault(couple.monnaie_source_id, couple.taux)
        elif couple.monnaie_source_id == vers_monnaie_id:
            coefficients.setdefault(couple.monnaie_cible_id, 1.0 / couple.taux)

    manquantes = [
        monnaie for monnaie in crud.get_monnaies(db) if monnaie.id not in coefficients
    ]
    return coefficients, manquantes


def convertir(montant: float, monnaie_id: int, coefficients: dict) -> float:
    """Le montant dans la monnaie cible, ou 0 si elle n'est pas convertible.

    ZÉRO ET NON LE MONTANT BRUT : ajouter des dollars à des euros faute de taux
    donnerait un total faux avec l'air d'être juste, ce qui est exactement ce
    que l'application refuse de faire partout ailleurs. La monnaie écartée est
    nommée à côté du total (cf. `table_de_conversion`), pour que ce qui manque
    se voie."""
    coefficient = coefficients.get(monnaie_id)
    return montant * coefficient if coefficient is not None else 0.0
