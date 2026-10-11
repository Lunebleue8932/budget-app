"""Ce que l'écran de la vue d'ensemble reçoit.

Les schémas vivent dans l'extension et non dans `app.schemas` : rien du noyau ne
les lit, et une réponse d'écran n'a pas à peupler le schéma commun.
"""
from typing import Optional

from pydantic import BaseModel


class TitreDeLaPart(BaseModel):
    """Un titre dans le détail d'une part — ce que l'infobulle énumère."""

    titre_id: int
    titre_nom: str
    valorisation: float
    # Sur combien de comptes ce titre est détenu. Affiché entre parenthèses
    # quand il y en a plusieurs, comme l'histogramme des dépenses le fait pour
    # une catégorie fondue de plusieurs opérations : sans cela, une ligne à
    # 8 000 € qui est en fait deux lignes de 4 000 € se lit de travers.
    nombre_comptes: int = 1


class PartExposition(BaseModel):
    """Une part du camembert : un type de titre, dans une monnaie."""

    # None = les titres SANS étiquette. Ce n'est pas une anomalie : le type est
    # facultatif, et un portefeuille non typé est un cas normal.
    type_titre_id: Optional[int] = None
    type_titre_nom: Optional[str] = None
    valorisation: float
    montant_investi: float
    #: Fraction du total de la monnaie, entre 0 et 1. Calculée côté serveur pour
    #: que l'angle dessiné et le pourcentage écrit viennent du même chiffre.
    part: float
    nombre_titres: int
    #: Les plus lourds seulement (cf. service_vue_ensemble.TAILLE_DU_TOP).
    titres: list[TitreDeLaPart] = []


class ExpositionMonnaie(BaseModel):
    """La répartition dans UNE monnaie — l'unité de cet écran.

    Une monnaie par onglet, et jamais de total entre elles : rien ne permet
    d'additionner des euros et des dollars (cf. models.Monnaie)."""

    monnaie_id: int
    monnaie_symbole: str
    total: float
    total_investi: float
    parts: list[PartExposition] = []


class SourcePart(BaseModel):
    """Ce qui apporte de la valeur à une part « titre par titre » : la détention en direct
    (`direct`, sans nom — l'écran l'écrit dans sa langue), un ETF par sa composition, ou, pour
    la part « Autres titres », l'un des titres qu'elle regroupe."""

    nom: Optional[str] = None
    direct: bool = False
    valorisation: float


class PartTitre(BaseModel):
    """Une part du camembert « action par action ».

    `genre` : `titre` (un titre nommé), `autres` (les titres au-delà des premiers, fondus),
    `non_determine` (ce que la composition des ETF ne décrit pas)."""

    cle: str
    nom: Optional[str] = None
    genre: str
    valorisation: float
    part: float
    #: La part rapportée au seul total déterminé — celle qu'on lit quand on masque la part
    #: non déterminée. None pour celle-ci.
    part_determinee: Optional[float] = None
    nombre_sources: int
    sources: list[SourcePart] = []


class ExpositionTitresMonnaie(BaseModel):
    monnaie_id: int
    monnaie_symbole: str
    total: float
    total_determine: float
    parts: list[PartTitre] = []
