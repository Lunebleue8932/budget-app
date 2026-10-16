"""La forme comparable d'un intitulé de colonne : UNE normalisation, partout.

POURQUOI UNE SEULE. La reconnaissance des presets compare les intitulés d'un
fichier à ceux qu'un preset a déjà vus ; la détection des colonnes les compare
à un dictionnaire. Si les deux normalisaient chacune à sa façon, « Montant
(EUR) » serait reconnu ici et pas là. Tout intitulé passe donc par
`normaliser_entete` avant d'être comparé à quoi que ce soit.

CE QU'ELLE FAIT : minuscules, sans accents, symboles monétaires écrits en
toutes lettres, toute ponctuation (parenthèses comprises) remplacée par une
espace, espaces multiples réduites. Les mots restent séparés — c'est ce qui
permet de tokeniser (« montant eur » → montant, eur), là où
import_bancaire.normaliser_libelle, faite pour le vocabulaire du sens et de
l'état, colle tout.
"""
import re
import unicodedata

_SYMBOLES = {"€": " eur ", "$": " usd ", "£": " gbp "}
_NON_ALPHANUMERIQUE = re.compile(r"[^0-9a-z]+")


def normaliser_entete(texte) -> str:
    """« Montant (EUR) », « MONTANT – EUR », « montant €» → « montant eur »."""
    if texte is None:
        return ""
    brut = str(texte)
    for symbole, mot in _SYMBOLES.items():
        brut = brut.replace(symbole, mot)
    sans_accents = "".join(
        c for c in unicodedata.normalize("NFKD", brut) if unicodedata.category(c) != "Mn"
    )
    return _NON_ALPHANUMERIQUE.sub(" ", sans_accents.casefold()).strip()


def mots_entete(texte) -> list[str]:
    return normaliser_entete(texte).split()
