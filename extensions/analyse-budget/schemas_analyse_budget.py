"""Les formes que l'extension « Budget » rend à l'écran.

RIEN ICI N'EST UNE DONNÉE NOUVELLE : ce sont des lectures de ce que le noyau
porte déjà, rangées autrement. Les seules choses que l'extension écrit — une
étiquette sur une opération, un seuil par monnaie — passent par les schémas du
noyau ou par `MatelasUpdate` ci-dessous.
"""
from datetime import date as date_type
from typing import Optional

from pydantic import BaseModel, Field


class EpargnePeriodeRead(BaseModel):
    """Ce qu'on a mis de côté sur une période, dans une monnaie.

    LES TROIS CHIFFRES, et non le seul net. Un net à zéro peut vouloir dire
    « je n'ai rien bougé » aussi bien que « j'ai versé 2 000 € et j'en ai repris
    2 000 » — deux mois très différents. L'écran montre le net en grand et les
    deux composantes au survol : le net est la réponse, les composantes sont ce
    qui permet de ne pas se tromper sur ce qu'elle veut dire."""

    monnaie_id: int
    # Ce qui est ARRIVÉ sur les comptes d'épargne et de placements depuis un
    # compte courant, dans LEUR monnaie (cf. service_analyse_budget).
    verse: float = 0.0
    # Ce qui en est REPARTI vers un compte courant.
    retire: float = 0.0
    net: float = 0.0


class EpargneMoisRead(EpargnePeriodeRead):
    mois: int


class EpargneAnneeRead(BaseModel):
    annee: int
    monnaie_id: int
    total: EpargnePeriodeRead
    # DOUZE MOIS TOUJOURS, y compris ceux où rien n'a bougé : un mois absent se
    # lirait comme un mois qu'on n'a pas atteint, alors qu'un mois à zéro est
    # une information — on n'a rien mis de côté.
    mois: list[EpargneMoisRead] = Field(default_factory=list)


class CompteMatelasRead(BaseModel):
    compte_id: int
    nom: str
    solde: float


class MatelasRead(BaseModel):
    """Le seuil, ce qu'on a en face, et l'écart.

    `ecart` EST LE CHIFFRE QU'ON VEUT LIRE : négatif, il dit de combien on est
    passé dessous. « Il manque 340 € » se comprend d'un coup d'œil, « 2 660 sur
    3 000 » demande une soustraction."""

    monnaie_id: int
    # 0 = aucun matelas posé, et non « un matelas de zéro » : l'écran se tait
    # plutôt que d'annoncer un seuil toujours tenu.
    matelas: float = 0.0
    disponible: float = 0.0
    ecart: float = 0.0
    sous_le_seuil: bool = False
    # Le détail par compte : un total sous son seuil appelle « lequel est
    # vide ? », et la réponse est ici plutôt que dans un autre écran.
    comptes: list[CompteMatelasRead] = Field(default_factory=list)


class MatelasUpdate(BaseModel):
    # Un matelas négatif ne veut rien dire ; zéro le retire.
    montant: float = Field(ge=0)


class ImprevuesPeriodeRead(BaseModel):
    """Ce que la période a coûté, et la part qu'on n'avait pas vue venir.

    `total` EST LE MÊME PÉRIMÈTRE QUE L'HISTOGRAMME DES DÉPENSES du dashboard
    (types à catégorie libre, statut réel, virements exclus) : sans quoi la part
    se rapporterait à un total qu'aucun autre écran n'affiche, et ne serait
    comparable à rien."""

    monnaie_id: int
    total: float = 0.0
    imprevu: float = 0.0
    # Calculée côté serveur : deux endroits qui divisent les mêmes nombres
    # finissent par ne plus tomber d'accord à l'arrondi.
    part: float = 0.0


class ImprevuesMoisRead(ImprevuesPeriodeRead):
    mois: int


class LigneImprevueRead(BaseModel):
    id: int
    date: date_type
    nature: str
    montant: float
    categorie: Optional[str] = None


class ImprevuesAnneeRead(BaseModel):
    annee: int
    monnaie_id: int
    total: ImprevuesPeriodeRead
    mois: list[ImprevuesMoisRead] = Field(default_factory=list)
    # Les lignes de l'année, les plus grosses d'abord. « 640 € d'imprévu »
    # appelle immédiatement « lesquels ? ».
    lignes: list[LigneImprevueRead] = Field(default_factory=list)


# ---------- Le solde prévisionnel (courbe) ----------


class PointSoldeRead(BaseModel):
    date: date_type
    solde: float
    # Vrai jusqu'à aujourd'hui inclus : le solde RÉEL, déjà vécu. Faux après : le
    # prévisionnel. L'écran trace les deux différemment.
    passe: bool


class EcheanceRead(BaseModel):
    """Une prévisionnelle qui fait bouger la courbe : son montant est SIGNÉ
    (négatif = ça sort), pour que la courbe et la liste se lisent pareil."""

    id: int
    date: date_type
    # Le jour où la courbe la compte : sa date, ou demain si elle est échue.
    jour_pose: date_type
    nature: str
    montant: float
    compte_nom: str
    en_retard: bool = False


class MoyenneDepensesRead(BaseModel):
    """Ce que la prévision avancée ajoute chaque jour, et d'où ça vient."""

    # Vrai quand la prévision avancée est demandée : sans elle la moyenne est
    # calculée (elle sert à l'infobulle d'aide) mais n'entre pas dans la courbe.
    active: bool = False
    cadence: str = "jour"
    par_jour: float = 0.0
    par_semaine: float = 0.0
    total: float = 0.0
    jours: int = 0
    nombre_operations: int = 0
    debut: Optional[date_type] = None
    fin: Optional[date_type] = None


class LigneDoublonRead(BaseModel):
    id: int
    date: date_type
    nature: str
    montant: float
    compte_nom: str


class DoublonRead(BaseModel):
    """Une prévisionnelle qui risque de compter deux fois. L'application la
    SIGNALE ; `a_exclure` est une proposition, jamais appliquée d'office."""

    # « deja_reelle » (la prévisionnelle a son double réel) ou
    # « deja_dans_la_moyenne » (une récurrence à venir dont les occurrences
    # passées sont dans la moyenne).
    genre: str
    prevu: LigneDoublonRead
    passes: list[LigneDoublonRead] = Field(default_factory=list)
    # Combien d'occurrences à venir portent cette récurrence.
    occurrences: int = 1
    a_exclure: list[int] = Field(default_factory=list)


class SoldePrevisionnelRead(BaseModel):
    monnaie_id: int
    aujourdhui: date_type
    jusqu_au: date_type
    points: list[PointSoldeRead] = Field(default_factory=list)
    echeances: list[EcheanceRead] = Field(default_factory=list)
    moyenne: MoyenneDepensesRead
    doublons: list[DoublonRead] = Field(default_factory=list)
    solde_aujourdhui: float = 0.0
    solde_fin: float = 0.0
    # Le seuil du matelas, pour le tracer en pointillé (0 = aucun).
    matelas: float = 0.0


class DepensePeriodeRead(BaseModel):
    """Une barre du graphe « une catégorie, période après période » : `mois` absent veut
    dire l'année entière."""

    annee: int
    mois: Optional[int] = None
    total: float = 0.0
    budget_alloue: float = 0.0


class DepensesCategorieRead(BaseModel):
    categorie_id: int
    categorie: str
    couleur_index: Optional[int] = None
    monnaie_id: int
    vue: str
    annee: int
    periodes: list[DepensePeriodeRead] = Field(default_factory=list)
    # Combien de périodes ont été écartées faute de la moindre opération en base.
    masquees: int = 0
