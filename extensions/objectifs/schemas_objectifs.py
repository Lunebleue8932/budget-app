"""Les formes d'un objectif : ce qu'on écrit, et ce qu'on lit.

CE QU'ON ÉCRIT est court — un nom, une mesure, une cadence, un sens, une cible,
un périmètre. CE QU'ON LIT l'est moins, et c'est voulu : un objectif mesuré rend
la valeur constatée, la valeur ramenée à sa cadence et la cible proratisée, parce
qu'aucun de ces trois chiffres seul ne se lit sans les autres (cf.
service_objectifs.mesurer).
"""
from typing import Optional, Union

from pydantic import BaseModel, ConfigDict, Field, model_validator

from app.constants import (
    CadenceObjectif,
    ChampFiltreObjectif,
    JoursFiltreObjectif,
    MesureObjectif,
    SensObjectif,
)


class FiltreObjectif(BaseModel):
    """Un filtre : un champ, et la valeur qu'il attend (cf.
    constants.ChampFiltreObjectif). La valeur se VÉRIFIE selon le champ — un
    montant est un nombre positif, un mot n'est pas vide, les jours sont
    « semaine » ou « weekend » — pour qu'un filtre mal formé soit refusé à la
    saisie plutôt qu'ignoré en silence au calcul."""

    champ: ChampFiltreObjectif
    valeur: Union[float, str]

    @model_validator(mode="after")
    def _valeur_selon_le_champ(self):
        if self.champ in (ChampFiltreObjectif.montant_min, ChampFiltreObjectif.montant_max):
            try:
                self.valeur = float(self.valeur)
            except (TypeError, ValueError):
                raise ValueError("Un filtre de montant attend un nombre.")
            if self.valeur < 0:
                raise ValueError("Un filtre de montant attend un nombre positif.")
        elif self.champ == ChampFiltreObjectif.jours:
            if self.valeur not in {j.value for j in JoursFiltreObjectif}:
                raise ValueError("Le filtre des jours attend « semaine » ou « weekend ».")
        else:
            self.valeur = str(self.valeur).strip()
            if not self.valeur:
                raise ValueError("Un filtre de libellé attend un mot.")
        return self


class ObjectifBase(BaseModel):
    # Le nom est écrit à la main et il est OBLIGATOIRE : ni la mesure ni la
    # catégorie ne sauraient le remplacer — « Montant total · Loisirs » décrit
    # la formule, jamais l'intention qu'on y met.
    nom: str = Field(min_length=1)
    mesure: MesureObjectif
    cadence: CadenceObjectif = CadenceObjectif.mois
    sens: SensObjectif = SensObjectif.max
    # PAS DE CIBLE EST UN ÉTAT, et il ne se confond pas avec zéro : `None` dit
    # « je regarde ce que ça donne », zéro dit « rien du tout ce mois-ci », qui
    # est une règle et une règle sévère. C'est l'état ordinaire d'un projet
    # qu'on commence à suivre — on veut voir ce qu'il coûte bien avant de savoir
    # ce qu'on s'autorise (cf. migration 0070).
    cible: Optional[float] = Field(default=None, ge=0)
    # NULL = toutes les dépenses, et non « aucune » : un objectif tous postes
    # confondus est aussi légitime qu'un objectif par catégorie.
    categorie_id: Optional[int] = None
    # LE TROISIÈME PÉRIMÈTRE : un projet (`sous_filtre`), exclusif de la
    # catégorie (cf. models.ObjectifKpi). Une catégorie classe par NATURE, un
    # projet regroupe par ÉVÉNEMENT.
    sous_filtre_id: Optional[int] = None
    monnaie_id: int
    visible_dashboard: bool = True
    ordre: int = 0
    # Tous à passer ; vide = aucun filtre (cf. models.ObjectifKpi.filtres).
    filtres: list[FiltreObjectif] = Field(default_factory=list)


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
    # ZÉRO NE RETIRE PAS LA CIBLE, il en pose une à zéro : c'est `cible_effacee`
    # qui la retire, sur le modèle de `categorie_id = 0` juste en dessous.
    # `None` y veut déjà dire « ne change pas », et il fallait donc une seconde
    # façon de dire « je ne me fixe plus rien ».
    cible: Optional[float] = Field(default=None, ge=0)
    cible_effacee: bool = False
    categorie_id: Optional[int] = None
    # Même convention : zéro élargit à toutes les dépenses, `None` ne change
    # rien. Écrire l'un des deux périmètres EFFACE l'autre (cf. le routeur) —
    # ils s'excluent, et demander à l'écran de penser à retirer le précédent
    # aurait fait de cette exclusion un piège plutôt qu'une règle.
    sous_filtre_id: Optional[int] = None
    monnaie_id: Optional[int] = None
    visible_dashboard: Optional[bool] = None
    ordre: Optional[int] = None
    # UNE LISTE REMPLACE LES FILTRES, `None` n'y touche pas — et une liste vide
    # les retire tous.
    filtres: Optional[list[FiltreObjectif]] = None


class ObjectifRead(ObjectifBase):
    model_config = ConfigDict(from_attributes=True)

    id: int


class VueObjectifRead(BaseModel):
    """L'objectif lu sur UNE fenêtre : l'une de ses deux vues (cf.
    service_objectifs.fenetres_de_lecture).

    `kind` dit ce que la fenêtre est (« semaine », « mois », « annee », « tout »),
    `debut` et `fin` ses bornes — l'écran les écrit, sans quoi « 17 sorties » ne
    dit pas sur quoi. `semantique` dit ce qui a été compté : « lignes » (des
    lignes de relevé) ou « budget » (ce que l'histogramme du dashboard affiche)."""

    kind: str
    debut: str
    fin: str
    semantique: str = "lignes"
    valeur: float = 0.0
    valeur_cadence: float = 0.0
    mode: str = "cumul"
    unites: float = 0.0
    unites_periode: float = 0.0
    echantillon: int = 0
    atteint: bool = True
    avancement: float = 0.0


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
    cible: Optional[float] = None
    categorie_id: Optional[int] = None
    categorie: Optional[str] = None
    # Le projet visé et son nom, quand l'objectif en désigne un (cf.
    # models.ObjectifKpi.sous_filtre_id).
    sous_filtre_id: Optional[int] = None
    projet: Optional[str] = None
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
    # SANS CIBLE, IL N'Y A RIEN À TENIR : `atteint` reste vrai (l'écran ne peint
    # alors ni en rouge ni en vert) et `avancement` à zéro — c'est `cible is
    # None` qui décide de ce que la carte montre, et non l'un de ces deux
    # champs. Les laisser mentir aurait fait dessiner une barre pleine pour un
    # objectif dont personne n'a fixé le bout.
    atteint: bool = True
    avancement: float = 0.0
    filtres: list[FiltreObjectif] = Field(default_factory=list)
    # LES DEUX VUES, toujours rendues (cf. service_objectifs.fenetres_de_lecture) :
    # l'ACTUELLE (la période propre de l'objectif — la semaine ou le mois) et la
    # MOYENNÉE (une fenêtre plus large, ramenée à la cadence). Les champs de tête
    # restent la période du sélecteur, telle que le dashboard la montre.
    actuelle: VueObjectifRead
    moyennee: VueObjectifRead


class ObjectifsPeriodeRead(BaseModel):
    annee: int
    mois: Optional[int] = None
    # LA MONNAIE PEUT ÊTRE ABSENTE, et c'est alors « toutes les monnaies » :
    # l'écran des objectifs les montre tous, chacun mesuré dans la sienne (cf.
    # le routeur). Le DASHBOARD, lui, la nomme toujours — il a un onglet de
    # monnaie, et on n'y additionne jamais deux devises.
    monnaie_id: Optional[int] = None
    objectifs: list[ObjectifMesureRead] = Field(default_factory=list)


class OperationObjectifRead(BaseModel):
    """Une opération qui entre dans la mesure d'un objectif, et ce qu'elle y
    apporte. `montant` est celui de la ligne, `retenu` ce qu'elle pèse DANS CETTE
    MESURE : son reste à charge, sa part de découpe, sa part du mois si elle est
    amortie. L'écran écrit le premier en petit quand il diffère du second."""

    operation_id: int
    date: str
    nature: str
    compte_id: int
    categorie_id: Optional[int] = None
    monnaie_id: int
    montant: float
    retenu: float
    decoupee: bool = False
    amorti: bool = False
    amortissement_nb_mois: Optional[int] = None


class ObjectifOperationsRead(BaseModel):
    """La page d'un objectif : l'objectif mesuré (ses deux vues), la vue choisie
    et les opérations qui la composent."""

    mesure: ObjectifMesureRead
    vue: str
    fenetre: VueObjectifRead
    total_retenu: float = 0.0
    operations: list[OperationObjectifRead] = Field(default_factory=list)
