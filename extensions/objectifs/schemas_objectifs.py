"""Les formes d'un objectif : ce qu'on écrit, et ce qu'on lit.

CE QU'ON ÉCRIT est court — un nom, une mesure, une cadence, un sens, une cible,
un périmètre. CE QU'ON LIT l'est moins, et c'est voulu : un objectif mesuré rend
la valeur constatée, la valeur ramenée à sa cadence et la cible proratisée, parce
qu'aucun de ces trois chiffres seul ne se lit sans les autres (cf.
service_objectifs.mesurer).
"""
from typing import Optional

from pydantic import BaseModel, ConfigDict, Field

from app.constants import CadenceObjectif, MesureObjectif, SensObjectif


class ObjectifBase(BaseModel):
    # Le nom est écrit à la main et il est OBLIGATOIRE : ni la mesure ni la
    # catégorie ne sauraient le remplacer — « Montant total · Loisirs » décrit
    # la formule, jamais l'intention qu'on y met.
    nom: str = Field(min_length=1)
    mesure: MesureObjectif
    cadence: CadenceObjectif = CadenceObjectif.mois
    sens: SensObjectif = SensObjectif.max
    # Zéro est une cible parfaitement sensée (« aucune sortie ce mois-ci ») ;
    # négatif ne veut rien dire.
    cible: float = Field(ge=0)
    # NULL = toutes les dépenses, et non « aucune » : un objectif tous postes
    # confondus est aussi légitime qu'un objectif par catégorie.
    categorie_id: Optional[int] = None
    monnaie_id: int
    visible_dashboard: bool = True
    ordre: int = 0


class ObjectifCreate(ObjectifBase):
    pass


class ObjectifUpdate(BaseModel):
    """Tout est facultatif : `None` veut dire « ne change pas », comme partout
    ailleurs dans l'application.

    LA CATÉGORIE FAIT EXCEPTION et se retire par `categorie_id = 0`, sur le
    modèle du type d'un titre (cf. schemas.ActionUpdate) : `None` y étant déjà
    pris pour « ne change pas », il fallait une autre façon de dire « élargis cet
    objectif à toutes les dépenses »."""

    nom: Optional[str] = Field(default=None, min_length=1)
    mesure: Optional[MesureObjectif] = None
    cadence: Optional[CadenceObjectif] = None
    sens: Optional[SensObjectif] = None
    cible: Optional[float] = Field(default=None, ge=0)
    categorie_id: Optional[int] = None
    monnaie_id: Optional[int] = None
    visible_dashboard: Optional[bool] = None
    ordre: Optional[int] = None


class ObjectifRead(ObjectifBase):
    model_config = ConfigDict(from_attributes=True)

    id: int


class ObjectifMesureRead(BaseModel):
    """Un objectif et son constat sur une période.

    `valeur` EST CE QUI A ÉTÉ COMPTÉ sur la période affichée (17 sorties),
    `valeur_cadence` LE MÊME CHIFFRE RAMENÉ À LA CADENCE (3,8 par semaine), et
    c'est ce dernier qui se compare à `cible`. Les deux voyagent parce que les
    deux se lisent : « 17 » répond à « qu'est-ce qui s'est passé », « 3,8 » à
    « est-ce que je tiens ma règle »."""

    objectif_id: int
    nom: str
    mesure: MesureObjectif
    cadence: CadenceObjectif
    sens: SensObjectif
    cible: float
    categorie_id: Optional[int] = None
    categorie: Optional[str] = None
    monnaie_id: int
    visible_dashboard: bool = True
    valeur: float = 0.0
    valeur_cadence: float = 0.0
    # « cumul » ou « moyenne » : ce que `valeur_cadence` veut dire, et donc ce
    # que l'écran écrit à côté du chiffre — « ce mois-ci » ne se dit pas comme
    # « par semaine » (cf. service_objectifs.mesurer).
    mode: str = "cumul"
    # Combien de semaines (ou de mois) ÉCOULÉES la période contient, et combien
    # elle en contient EN ENTIER. La première est le dénominateur d'une moyenne,
    # et voyage pour que l'écran puisse dire « sur 4,3 semaines » : sans elle, un
    # chiffre hebdomadaire lu sur un mois sort d'un calcul invisible.
    unites: float = 0.0
    unites_periode: float = 0.0
    # Le nombre de dépenses qui ont servi, pour les deux mesures qui comptent
    # des lignes. « 32 € en moyenne » sur deux dépenses et sur soixante ne se
    # lisent pas pareil.
    echantillon: int = 0
    atteint: bool = True
    avancement: float = 0.0


class ObjectifsPeriodeRead(BaseModel):
    annee: int
    mois: Optional[int] = None
    monnaie_id: int
    objectifs: list[ObjectifMesureRead] = Field(default_factory=list)
