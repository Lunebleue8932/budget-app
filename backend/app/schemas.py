from datetime import date as date_type, datetime
from typing import Optional

from pydantic import BaseModel, ConfigDict, Field, model_validator

from .constants import (
    CHAMPS_REGLE_VALIDES,
    TypeOperation,
    ConnecteurRegle,
    Frequence,
    ModeComparaison,
    OperateurRegle,
    Sens,
    SensAction,
    Statut,
)


class MonnaieCreate(BaseModel):
    nom: str = Field(min_length=1)
    # Ce qui s'affiche à côté des montants : "€", "$", "CHF"… Pas un code ISO,
    # l'app ne s'en sert que pour l'affichage.
    symbole: str = Field(min_length=1, max_length=8)


class MonnaieUpdate(BaseModel):
    nom: Optional[str] = Field(default=None, min_length=1)
    symbole: Optional[str] = Field(default=None, min_length=1, max_length=8)


class MonnaieRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    nom: str
    symbole: str
    ordre: int


class TypeCompteCreate(BaseModel):
    nom: str = Field(min_length=1)


class TypeCompteRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    nom: str
    systeme: bool


class CompteMonnaieInput(BaseModel):
    """Une monnaie portée par un compte, et le solde de départ du compte dans
    cette monnaie. L'ordre de la liste fait foi : la première est la monnaie
    proposée par défaut à la saisie."""

    monnaie_id: int
    solde_initial: float = 0.0


class CompteMonnaieRead(CompteMonnaieInput):
    model_config = ConfigDict(from_attributes=True)

    monnaie_nom: str
    monnaie_symbole: str


class CompteBase(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    nom: str
    type_id: int


class CompteCreate(CompteBase):
    # Au moins une : un compte sans monnaie ne pourrait porter aucune opération.
    monnaies: list[CompteMonnaieInput] = Field(min_length=1)


class CompteUpdate(BaseModel):
    nom: Optional[str] = None
    type_id: Optional[int] = None
    # None = ne pas toucher aux monnaies ; une liste les remplace toutes (le
    # routeur refuse de retirer une monnaie encore utilisée par une opération).
    monnaies: Optional[list[CompteMonnaieInput]] = Field(default=None, min_length=1)


class CompteRead(CompteBase):
    id: int
    type_nom: str
    monnaies: list[CompteMonnaieRead]


# ---------- Diagnostic d'écart de solde (cf. services/ecarts.py) ----------


class DiagnosticEcartInput(BaseModel):
    """Ce que l'utilisateur fournit : le solde lu sur son relevé.

    Rien n'est mémorisé (cf. services/ecarts, en-tête) : ce montant sert le
    temps d'une réponse et n'est jamais écrit en base."""

    monnaie_id: int
    solde_banque: float
    # Date d'arrêté du relevé. Sans elle, la comparaison porte sur toutes les
    # opérations réelles connues — ce qui ne correspond à aucun relevé dès que
    # des opérations réelles sont datées dans le futur.
    date_fin: Optional[date_type] = None


class OperationPisteRead(BaseModel):
    """Une opération citée par une piste, réduite à de quoi la reconnaître dans
    la page Opérations."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    date: date_type
    nature: str
    montant: float
    sens: Sens
    statut: Statut


class PisteEcartRead(BaseModel):
    # "operation_en_trop" | "signe_inverse" | "previsionnelle_a_pointer" |
    # "combinaison" — le frontend s'en sert pour le libellé de la puce, jamais
    # pour recalculer quoi que ce soit.
    type: str
    explication: str
    operations: list[OperationPisteRead]


class DiagnosticEcartRead(BaseModel):
    compte_id: int
    compte_nom: str
    monnaie_id: int
    monnaie_nom: str
    monnaie_symbole: str
    date_fin: Optional[date_type] = None
    solde_app: float
    solde_banque: float
    # solde_banque − solde_app. Positif : la banque a plus que l'app.
    ecart: float
    nb_operations_analysees: int
    pistes: list[PisteEcartRead]
    # Trop de pistes d'une même famille pour toutes les rendre : la liste est
    # coupée, et le dire évite qu'une liste courte passe pour exhaustive.
    tronque: bool = False
    # Recherche à trois opérations abandonnée (trop d'opérations sur ce compte).
    triplets_abandonnes: bool = False


class CategorieCreate(BaseModel):
    nom: str = Field(min_length=1)


class CategorieRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    nom: str
    ordre: int
    # Affichée dans l'histogramme du dashboard. N'a aucun effet ailleurs : la
    # catégorie reste proposée partout et garde ses opérations.
    visible_dashboard: bool = True
    # Couleur de la catégorie dans l'histogramme, sous forme d'index de palette
    # (cf. models.Categorie.couleur_index).
    couleur_index: int = 0


class CategorieVisibiliteUpdate(BaseModel):
    """Le seul réglage d'affichage d'une catégorie, isolé de tout le reste : le
    nom n'est pas modifiable et le budget a son propre endpoint (il dépend d'un
    mois et d'une monnaie, pas de la catégorie seule)."""

    visible_dashboard: bool


class TypeOperationRead(BaseModel):
    """Les familles d'opérations. `code` est la clé technique stable sur
    laquelle le frontend écrit sa logique ; `nom` n'est qu'un libellé."""

    model_config = ConfigDict(from_attributes=True)

    id: int
    code: str
    nom: str
    ordre: int
    # True = géré par une page dédiée (titres) : à exclure des menus de type
    # (formulaire d'opération, règles, correspondances d'import).
    interne: bool = False


class TypeOperationUpdate(BaseModel):
    """Seul le libellé est modifiable : le code porte la logique métier."""

    nom: str = Field(min_length=1)


class ReordonnerCategoriesInput(BaseModel):
    ordre: list[int]


class ReordonnerComptesInput(BaseModel):
    """Les ids des comptes d'UN type, dans l'ordre voulu : l'ordre d'un compte
    ne se lit qu'au sein de son type."""

    ordre: list[int]


class BudgetMensuelSet(BaseModel):
    montant: float = Field(ge=0)


class BudgetMensuelRead(BaseModel):
    annee: int
    mois: int
    # Le budget est propre à une monnaie : « 300 » ne veut rien dire si la
    # catégorie est dépensée en euros et en dollars.
    monnaie_id: int
    montant: float
    # False si ce montant est hérité d'un mois précédent (aucune entrée
    # explicite pour ce mois précis) ; True si ce mois a sa propre valeur.
    explicite: bool


class BudgetCategorieRead(BudgetMensuelRead):
    categorie_id: int
    categorie_nom: str


class OperationLieeRead(BaseModel):
    id: int
    nature: str
    # Montant réellement échangé pour CE lien spécifique (distinct du montant
    # total de l'opération liée si le remboursement est partiel).
    montant_lien: float


class OperationRembourseeInput(BaseModel):
    operation_id: int
    montant: float = Field(gt=0)


class OperationBase(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    date: date_type
    compte_id: int
    type_id: int
    # Renseignée uniquement pour les types à catégorie libre (opération
    # classique, dépense remboursable) ; NULL pour les quatre autres, dont le
    # type porte à lui seul la classification.
    categorie_id: Optional[int] = None
    nature: str
    montant: float = Field(ge=0)
    # Notes libres de l'utilisateur, sans aucune sémantique pour l'app :
    # affichées uniquement à l'édition. None et "" y valent la même chose.
    notes: Optional[str] = None
    # Monnaie du montant, obligatoirement l'une de celles du compte (vérifié
    # côté routeur). Un compte mono-monnaie n'oblige pas le frontend à la
    # demander : il envoie simplement la seule possible.
    monnaie_id: int
    statut: Statut
    # None = non précisé : calculé côté serveur (montant si remboursable, sinon 0).
    # Montant fixe initialement dû ; ne change pas quand le remboursement a lieu.
    montant_du: Optional[float] = Field(default=None, ge=0)
    # Reste à rembourser ; diminue (jusqu'à 0) au fil des remboursements liés.
    montant_a_rembourser: Optional[float] = Field(default=None, ge=0)
    # Récurrence (voir crud.generer_occurrences_recurrentes) : recurrente=True
    # sans frequence n'a pas de sens (rejeté ci-dessous). recurrence_fin=None =
    # récurrence infinie (bornée à un horizon glissant à la génération).
    recurrente: bool = False
    frequence: Optional[Frequence] = None
    recurrence_fin: Optional[date_type] = None
    # Amortissement (voir models.Operation.amorti et services/soldes.py) :
    # l'opération a lieu une fois, à `date`, mais pèse sur les mois
    # [amortissement_debut, amortissement_fin], bornes incluses. Les deux dates
    # sont ramenées au 1er du mois ci-dessous : seul le mois porte du sens, et
    # laisser passer deux jours différents ferait dépendre le nombre de mois de
    # quelque chose qui ne compte pas.
    amorti: bool = False
    amortissement_debut: Optional[date_type] = None
    amortissement_fin: Optional[date_type] = None

    @model_validator(mode="after")
    def _check_amortissement(self):
        if not self.amorti:
            # Des bornes sans la case cochée ne seraient jamais lues : les
            # effacer garde une seule représentation de « non amortie ».
            self.amortissement_debut = None
            self.amortissement_fin = None
            return self
        if self.amortissement_debut is None or self.amortissement_fin is None:
            raise ValueError(
                "amortissement_debut et amortissement_fin sont requis pour une "
                "opération amortie"
            )
        self.amortissement_debut = self.amortissement_debut.replace(day=1)
        self.amortissement_fin = self.amortissement_fin.replace(day=1)
        if self.amortissement_fin < self.amortissement_debut:
            raise ValueError(
                "amortissement_fin ne peut pas précéder amortissement_debut"
            )
        # Un modèle récurrent réengendre la même dépense mois après mois ;
        # l'amortir reviendrait à recopier les mêmes mois de destination sur
        # chaque occurrence, donc à empiler N amortissements identiques sur la
        # même poignée de mois. Les deux cases s'excluent aussi côté formulaire.
        if self.recurrente:
            raise ValueError(
                "une opération ne peut pas être à la fois récurrente et amortie"
            )
        return self

    @model_validator(mode="after")
    def _check_montants_remboursement(self):
        if self.montant_du is not None and self.montant_du > self.montant:
            raise ValueError("montant_du ne peut pas dépasser montant")
        if (
            self.montant_du is not None
            and self.montant_a_rembourser is not None
            and self.montant_a_rembourser > self.montant_du
        ):
            raise ValueError("montant_a_rembourser ne peut pas dépasser montant_du")
        return self


class OperationCreate(OperationBase):
    # Uniquement valide quand la catégorie choisie est "Remboursements" (vérifié
    # côté routeur, qui a besoin d'une résolution en base) : dépenses remboursables
    # que cette opération règle, avec le montant réglé pour chacune (remboursement
    # partiel autorisé, jusqu'au montant_du de la dépense concernée).
    operations_remboursees: list[OperationRembourseeInput] = Field(default_factory=list)

    # Sur OperationCreate seulement (pas OperationBase) : une occurrence
    # générée par une récurrence a recurrente=True mais frequence=None (seul
    # le modèle porte la fréquence, cf. crud.generer_occurrences_recurrentes)
    # -- OperationRead, qui hérite aussi de OperationBase pour lire ces lignes
    # existantes, ne doit donc pas appliquer cette contrainte.
    @model_validator(mode="after")
    def _check_recurrence(self):
        if self.recurrente and self.frequence is None:
            raise ValueError("frequence est requise pour une opération récurrente")
        return self


class OperationUpdate(BaseModel):
    date: Optional[date_type] = None
    compte_id: Optional[int] = None
    type_id: Optional[int] = None
    categorie_id: Optional[int] = None
    nature: Optional[str] = None
    montant: Optional[float] = Field(default=None, ge=0)
    # Envoyer "" efface la note ; ne pas envoyer la clé la laisse intacte
    # (update_operation lit exclude_unset).
    notes: Optional[str] = None
    monnaie_id: Optional[int] = None
    statut: Optional[Statut] = None
    montant_du: Optional[float] = Field(default=None, ge=0)
    montant_a_rembourser: Optional[float] = Field(default=None, ge=0)
    recurrente: Optional[bool] = None
    frequence: Optional[Frequence] = None
    recurrence_fin: Optional[date_type] = None
    # La cohérence des trois champs d'amortissement se vérifie sur l'ÉTAT FINAL
    # de l'opération, pas sur le payload : une modification partielle est
    # légitime (déplacer la seule borne de fin, par exemple). D'où la validation
    # côté routeur (_valider_amortissement) plutôt qu'ici.
    amorti: Optional[bool] = None
    amortissement_debut: Optional[date_type] = None
    amortissement_fin: Optional[date_type] = None
    operations_remboursees: Optional[list[OperationRembourseeInput]] = None


class OperationRead(OperationBase):
    id: int
    # Dupliqué depuis la relation : évite au frontend de recharger la table des
    # types pour savoir dans quel onglet ranger la ligne.
    type_code: str
    remboursable: bool
    sens: Sens
    montant_du: float
    montant_a_rembourser: float
    virement_id: Optional[str] = None
    # Id du modèle récurrent dont cette opération a été générée (None pour un
    # modèle lui-même ou une opération jamais récurrente) : lecture seule,
    # sert au frontend à distinguer modèle / occurrence générée.
    recurrence_parent_id: Optional[int] = None
    # Déduits des deux bornes par models.Operation (jamais stockés) : le
    # formulaire affiche le nombre de mois et le montant mensuel sans avoir à
    # refaire le calcul, et sans risque de le faire autrement que le serveur.
    # None sur une opération non amortie.
    amortissement_nb_mois: Optional[int] = None
    amortissement_montant_par_mois: Optional[float] = None
    operations_remboursees: list[OperationLieeRead] = Field(default_factory=list)
    rembourse_par: list[OperationLieeRead] = Field(default_factory=list)


class VirementCreate(BaseModel):
    """Un virement porte systématiquement deux monnaies et deux montants : ce
    qui part du compte source et ce qui arrive sur le compte destination.

    C'est ce qui permet de virer 100 € et d'en recevoir 108 $ sans que l'app
    connaisse le moindre taux de change — le montant reçu est celui qu'a
    réellement constaté la banque. Quand les deux monnaies sont identiques (le
    cas courant), `monnaie_destination_id` et `montant_destination` peuvent être
    omis : ils reprennent alors ceux du départ, et le frontend n'affiche même
    pas le second champ.
    """

    date: date_type
    compte_source_id: int
    compte_destination_id: int
    montant: float = Field(gt=0)
    monnaie_id: int
    montant_destination: Optional[float] = Field(default=None, gt=0)
    monnaie_destination_id: Optional[int] = None
    nature: Optional[str] = None
    statut: Statut = Statut.reel
    # Notes libres : la même sur les deux écritures, comme la date et le statut.
    # Un virement se saisit et se modifie d'un bloc, une note propre à une seule
    # de ses jambes n'aurait aucun endroit où se saisir.
    notes: Optional[str] = None

    @model_validator(mode="after")
    def _check_deux_ecritures_distinctes(self):
        """Un virement doit déplacer l'argent quelque part : soit vers un autre
        compte, soit — sur un même compte multi-devises — vers une autre
        monnaie.

        Ce second cas est une conversion de change interne (typiquement un
        compte Wise où l'on convertit 100 € en 108 $ sans quitter le compte) :
        les deux écritures sont bien distinctes puisqu'elles portent chacune sa
        monnaie et son montant, et les soldes par monnaie du compte (jamais
        additionnés, cf. models.CompteMonnaie) bougent réellement tous les
        deux. Seul reste interdit le virement strictement immobile : même
        compte ET même monnaie, qui ne serait qu'une paire d'écritures
        s'annulant l'une l'autre.
        """
        if (
            self.compte_source_id == self.compte_destination_id
            and self.monnaie_destination_resolue == self.monnaie_id
        ):
            raise ValueError(
                "Le compte source et le compte destination doivent être différents, "
                "sauf pour une conversion entre deux monnaies d'un même compte "
                "(la monnaie reçue doit alors différer de la monnaie envoyée)"
            )
        return self

    @property
    def monnaie_destination_resolue(self) -> int:
        return (
            self.monnaie_destination_id
            if self.monnaie_destination_id is not None
            else self.monnaie_id
        )

    @property
    def montant_destination_resolu(self) -> float:
        return (
            self.montant_destination if self.montant_destination is not None else self.montant
        )


class VirementRead(BaseModel):
    virement_id: str
    operation_sortante: OperationRead
    operation_entrante: OperationRead


class SoldeMonnaieRead(BaseModel):
    """Le solde d'un compte DANS une monnaie. Un compte à deux monnaies en a
    deux, jamais additionnés."""

    monnaie_id: int
    monnaie_nom: str
    monnaie_symbole: str
    solde_initial: float
    solde_reel: float
    solde_projete: float


class CompteSoldeRead(BaseModel):
    id: int
    nom: str
    type_nom: str
    soldes: list[SoldeMonnaieRead]


class DepenseTopRead(BaseModel):
    """Une des plus grosses dépenses d'une catégorie sur la période, telle
    qu'elle s'affiche au survol de sa barre dans l'histogramme.

    FONDUE PAR LIBELLÉ : trois passages « Courses Monoprix » à 25 € ne sont pas
    trois lignes de 25 € mais une de 75 €, et `nombre` vaut alors 3. C'est ce
    qui fait remonter une dépense récurrente au-dessus d'un achat isolé plus
    gros — sans quoi le classement dirait ce qu'on a payé le plus cher en une
    fois, pas ce qui pèse le plus dans le mois.
    """

    nature: str
    montant: float
    # 1 quand rien n'a été fondu. Le frontend ne montre le compte que
    # au-delà : « (1) » n'apprendrait rien et alourdirait chaque ligne.
    nombre: int = 1


class DepenseParCategorie(BaseModel):
    categorie: str
    total_reel: float
    total_previsionnel: float
    budget_alloue: float
    # Les plus grosses dépenses de la catégorie sur la période (cf.
    # services.soldes.NB_TOP_DEPENSES), de la plus lourde à la plus légère.
    # Peut être vide : toutes les catégories visibles sont listées, y compris
    # celles où rien n'a été dépensé.
    top_depenses: list[DepenseTopRead] = Field(default_factory=list)
    # Index dans la palette de l'histogramme, porté par la catégorie elle-même
    # (cf. models.Categorie.couleur_index). Envoyé ici plutôt que déduit de la
    # position dans cette liste : la liste est filtrée (catégories éteintes) et
    # réordonnable, la couleur ne doit dépendre ni de l'une ni de l'autre.
    couleur_index: int = 0


class KpisMonnaieRead(BaseModel):
    """Tout ce que le dashboard agrège, pour UNE monnaie : additionner des
    euros et des dollars demanderait un taux de change que l'app n'a pas et ne
    veut pas inventer. Le frontend en fait un onglet par monnaie."""

    monnaie_id: int
    monnaie_nom: str
    monnaie_symbole: str
    # Les 2 premiers champs excluent l'épargne et les comptes de placement
    # (soumis uniquement à des virements internes et, pour les placements, à des
    # achats/ventes de titres — hors logique de "budget courant"). total_avoirs
    # est la seule valeur qui les inclut, portefeuilles valorisés compris, pour
    # voir le patrimoine complet.
    solde_total_courant: float
    solde_projete_courant: float
    total_avoirs: float
    # Part de total_avoirs apportée par les titres détenus (au dernier cours
    # saisi) : affichée à part pour que le total reste lisible.
    valorisation_placements: float = 0.0
    # Les trois flux de la PÉRIODE demandée (mois ou année), virements internes
    # exclus — cf. services/soldes.get_flux_periode. Ils viennent du même calcul
    # et vérifient donc toujours variation = entrées − sorties : les afficher
    # côte à côte sans cette garantie exposerait trois chiffres qui ne
    # s'accordent pas.
    total_entrees: float = 0.0
    total_sorties: float = 0.0
    variation_previsionnelle: float = 0.0
    depenses_par_categorie: list[DepenseParCategorie] = Field(default_factory=list)


class DashboardRead(BaseModel):
    comptes: list[CompteSoldeRead]
    # Les monnaies effectivement portées par au moins un compte, dans l'ordre
    # d'affichage — la liste des onglets.
    monnaies: list[MonnaieRead]
    kpis: list[KpisMonnaieRead]


# ---------- Placements financiers ----------


class ActionCreate(BaseModel):
    nom: str = Field(min_length=1)
    # Dernier cours unitaire connu, saisi à la main : sert à valoriser le
    # portefeuille, jamais à calculer un solde en espèces.
    valeur: float = Field(default=0.0, ge=0)
    # Monnaie de cotation : cours, prix payés et valorisation en découlent, et
    # le titre ne peut s'acheter que depuis un compte qui la porte.
    monnaie_id: int


class ActionUpdate(BaseModel):
    nom: Optional[str] = Field(default=None, min_length=1)
    valeur: Optional[float] = Field(default=None, ge=0)
    monnaie_id: Optional[int] = None


class ActionRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    nom: str
    valeur: float
    monnaie_id: int
    monnaie_symbole: str


class OperationActionCreate(BaseModel):
    action_id: int
    sens: SensAction
    quantite: float = Field(gt=0)
    # Prix réellement payé (achat) ou encaissé (vente) par titre : le montant
    # débité/crédité sur le compte en découle, indépendamment du cours affiché.
    prix_unitaire: float = Field(ge=0)
    date: date_type
    # Libellé de l'écriture d'espèces ; par défaut « Achat <titre> ».
    nature: Optional[str] = None


class OperationActionRead(BaseModel):
    id: int
    operation_id: int
    action_id: int
    action_nom: str
    sens: SensAction
    quantite: float
    prix_unitaire: float
    # quantite * prix_unitaire : le montant de l'écriture d'espèces.
    montant: float
    # Monnaie de cotation du titre, donc aussi celle de l'écriture d'espèces.
    monnaie_id: int
    monnaie_symbole: str
    date: date_type
    nature: str


class DetentionRead(BaseModel):
    """Ce qui est détenu d'un titre sur un compte donné, entièrement recalculé
    depuis les opérations (aucune quantité n'est stockée)."""

    action_id: int
    action_nom: str
    monnaie_id: int
    monnaie_symbole: str
    quantite: float
    # Prix de revient unitaire (coût moyen pondéré) et coût total du stock
    # restant : ce qui a réellement été déboursé pour les titres encore détenus.
    prix_revient_unitaire: float
    montant_investi: float
    # Dernier cours connu (Action.valeur) et valorisation qui en découle.
    valeur_unitaire: float
    valorisation: float
    plus_value_latente: float


class PlacementMonnaieRead(BaseModel):
    """Les deux soldes d'un compte-titres — espèces et portefeuille — pour UNE
    monnaie. Un compte qui porte des euros et des dollars en a deux jeux, jamais
    additionnés."""

    monnaie_id: int
    monnaie_nom: str
    monnaie_symbole: str
    solde_espece: float
    valorisation: float
    # Espèces + valorisation du portefeuille.
    total: float
    # Coût des titres encore détenus : la plus-value latente s'en déduit.
    montant_investi: float


class PlacementCompteRead(BaseModel):
    compte_id: int
    compte_nom: str
    par_monnaie: list[PlacementMonnaieRead] = Field(default_factory=list)
    detentions: list[DetentionRead] = Field(default_factory=list)


class PlacementDetailRead(PlacementCompteRead):
    operations: list[OperationActionRead] = Field(default_factory=list)


# ---------- Placements financiers : cours lus en ligne ----------
#
# Servent l'extension « lecture-de-cours », et elle seule — le noyau n'émet
# aucune requête réseau. Ils vivent ici comme le reste du schéma des
# placements : une extension ne devrait pas emporter ses données (cf.
# extensions/README.md), sans quoi la désactiver imposerait de choisir entre
# les perdre et refuser de s'éteindre.


class UrlCoursUpdate(BaseModel):
    """La page d'où relire le cours d'un titre, telle que collée par
    l'utilisateur. Sa validité n'est pas vérifiée ici mais en l'ESSAYANT (cf.
    l'extension) : une URL bien formée qui ne donne aucun cours est le vrai cas
    à attraper, et aucune expression régulière ne le voit."""

    url: str = Field(min_length=1)


class SourceCoursRead(BaseModel):
    """Une source de cotation reconnue, décrite pour l'écran."""

    id: str
    nom: str
    exemple: str
    couvre: str


class CoursTitreRead(BaseModel):
    """L'état de cotation d'un titre : son lien, son cours, sa fraîcheur.

    `cours_maj_le` à None se lit « jamais relu en ligne » — cours saisi à la
    main, ou lien ajouté mais encore jamais suivi d'une lecture réussie."""

    action_id: int
    action_nom: str
    url_cours: Optional[str] = None
    cours: float
    monnaie_symbole: str
    cours_maj_le: Optional[datetime] = None


class ResultatCoursRead(BaseModel):
    """Ce qu'un titre a donné lors d'un rafraîchissement.

    `ancien_cours` accompagne le nouveau pour que l'écran puisse montrer le
    mouvement : un cours qui n'a pas bougé et un cours qui vient de tomber de
    3 % s'affichent autrement, et c'est l'information qu'on regarde."""

    action_id: int
    action_nom: str
    ok: bool
    cours: Optional[float] = None
    ancien_cours: Optional[float] = None
    source: Optional[str] = None
    # Nom de l'instrument tel que la source le publie : la seule confirmation
    # que le lien collé pointe bien sur le bon titre.
    libelle_source: Optional[str] = None
    erreur: Optional[str] = None


class RafraichissementRead(BaseModel):
    """Le compte rendu d'un rafraîchissement, et l'état de TOUS les titres
    après coup — pour que l'écran se remette à jour sans second appel."""

    horodatage: Optional[datetime] = None
    reussis: int = 0
    echecs: int = 0
    resultats: list[ResultatCoursRead] = Field(default_factory=list)
    titres: list[CoursTitreRead] = Field(default_factory=list)


# ---------- Monnaies : taux lus en ligne ----------
#
# Même extension, même règle : les données restent dans le noyau, l'extension
# n'apporte que la lecture. Aucun de ces taux n'est utilisé pour convertir quoi
# que ce soit — cf. models.TauxChange.


class TauxChangeCreate(BaseModel):
    """Un couple à suivre, et la page d'où le lire.

    Les deux monnaies sont désignées par leur id : elles existent déjà dans
    l'application, on ne les crée pas ici. Leur ordre porte le sens du taux —
    « 1 source vaut n cible » — et l'inverse est un autre couple, avec sa
    propre page."""

    monnaie_source_id: int
    monnaie_cible_id: int
    url: str = Field(min_length=1)


class TauxChangeRead(BaseModel):
    """Un couple suivi, tel que l'écran l'affiche.

    Les noms et symboles accompagnent les ids pour que le frontend n'ait pas à
    recroiser la table des monnaies ligne par ligne.

    `maj_le` à None se lit « jamais relu » : le lien est enregistré, aucune
    lecture n'a encore abouti."""

    id: int
    monnaie_source_id: int
    monnaie_source_nom: str
    monnaie_source_symbole: str
    monnaie_cible_id: int
    monnaie_cible_nom: str
    monnaie_cible_symbole: str
    url_cours: str
    taux: Optional[float] = None
    maj_le: Optional[datetime] = None


class ResultatTauxRead(BaseModel):
    """Ce qu'un couple a donné lors d'un rafraîchissement."""

    taux_id: int
    libelle: str  # « Euro -> Dollar américain », pour un message lisible
    ok: bool
    taux: Optional[float] = None
    ancien_taux: Optional[float] = None
    source: Optional[str] = None
    erreur: Optional[str] = None


class RafraichissementTauxRead(BaseModel):
    """Compte rendu d'un rafraîchissement, et état de TOUS les couples après
    coup — pour que l'écran se remette à jour sans second appel."""

    horodatage: Optional[datetime] = None
    reussis: int = 0
    echecs: int = 0
    resultats: list[ResultatTauxRead] = Field(default_factory=list)
    taux: list[TauxChangeRead] = Field(default_factory=list)


class ImportLigne(BaseModel):
    ligne: int  # numéro de ligne dans le fichier source, pour repérer une erreur
    date: Optional[date_type] = None
    nature: str = ""
    montant: Optional[float] = None  # toujours positif ; cf. montant_signe pour le sens d'origine
    # Valeur brute du fichier bancaire (négative = sortie, positive = entrée),
    # ou résultat de la formule de montant quand le preset en définit une :
    # sert uniquement à déterminer, côté frontend, quel compte de la ligne est
    # émetteur ou récepteur pour un virement interne détecté.
    montant_signe: Optional[float] = None
    nom_banque_categorie: str = ""
    nom_banque_compte: str = ""
    categorie_id: Optional[int] = None
    compte_id: Optional[int] = None
    # Libellé de la colonne « Sens » du relevé (« Débit », « C »...), vide pour
    # un preset qui ne la lit pas. Son effet est déjà appliqué à
    # `montant_signe` : il n'est conservé que pour être affiché dans l'aperçu,
    # et pour savoir que le fichier a tranché lui-même le sens de la ligne (cf.
    # services/import_bancaire.confirmer).
    nom_banque_sens: str = ""
    # True quand le FICHIER a tranché lui-même le sens de la ligne : un libellé
    # dans la colonne « Sens », ou la colonne remplie d'un montant scindé en
    # débit/crédit. Les deux disent la même chose de deux façons, d'où ce
    # booléen plutôt qu'un test sur `nom_banque_sens`.
    #
    # Ce qu'il change : sur une opération classique, le sens du fichier impose
    # entrée/dépense là où la catégorie seule en décidait (cf.
    # services/import_bancaire.confirmer) ; dans l'aperçu, le montant s'affiche
    # précédé de son signe. Un montant simplement SIGNÉ ne suffit pas — il
    # oriente les virements, mais n'a jamais rien imposé aux opérations
    # classiques, et ce n'est pas le sujet de cette propriété.
    sens_explicite: bool = False
    # True quand la ligne a rempli SES DEUX colonnes de montant (débit et
    # crédit) : deux montants ont été lus, et rien ne dit lequel fait
    # l'opération. `montant` vaut alors None, comme pour un montant illisible,
    # mais ce n'est pas la même chose à dire — d'où ce drapeau, que
    # `_erreur_ligne` relit pour reconstruire le bon message avant l'import.
    montant_ambigu: bool = False

    # ---------- Configuration avancée (cf. constants.PROPRIETES_IMPORT_AVANCEES) ----------
    # Tous None/vides pour un preset ordinaire, qui ne lit aucune de ces colonnes.
    #
    # Monnaie du montant. None = le preset ne dit pas dans quelle monnaie la
    # ligne est libellée : elle retombe alors sur la monnaie principale du
    # compte, comme avant la configuration avancée.
    nom_banque_monnaie: str = ""
    monnaie_id: Optional[int] = None
    # Devise dans laquelle `montant` est exprimé. Vaut `monnaie_id` sauf quand
    # c'est le montant INITIAL qui fait l'opération — une sortie à un seul
    # compte, où l'argent quitte le compte dans SA monnaie de départ (cf.
    # services/import_bancaire._appliquer_frais). C'est elle qui décide de la
    # monnaie de l'écriture, et de celle affichée dans l'aperçu.
    monnaie_operation_id: Optional[int] = None
    # Ce qui PART, avant frais et avant conversion, lu dans la colonne « Montant
    # initial ». `montant` décrit alors ce qui arrive. Lui seul peut donner les
    # deux, l'app n'ayant aucun taux de change. Sur un virement interne, c'est
    # la jambe ÉMETTRICE (cf. services/import_bancaire._resoudre_comptes_virement).
    montant_envoye: Optional[float] = None
    # Vrai quand `montant_envoye` ne sort PAS d'une colonne du fichier : c'est
    # le montant unique du relevé, placé du côté « ce qui part » parce que la
    # ligne est un virement SORTANT (cf. services/import_bancaire.
    # _orienter_jambe_virement). `montant` vaut alors None — ce qui arrive sur
    # l'autre compte est inconnu, l'app ne convertit rien.
    #
    # La distinction compte en aval : un relevé qui décrit vraiment les deux
    # jambes donne aussi les deux devises, un montant déduit non
    # (cf. _monnaies_virement).
    montant_envoye_deduit: bool = False
    # Monnaie de départ : colonne « Monnaie envoyée » du relevé, ou retouche
    # manuelle de la ligne dans l'aperçu (ImportLigneOverride). None = déduction
    # habituelle depuis le compte émetteur (cf.
    # services/import_bancaire._monnaies_virement).
    nom_banque_monnaie_envoyee: str = ""
    monnaie_envoyee_id: Optional[int] = None
    # Frais prélevés par la banque, et leur devise. Ils ne créent aucune
    # écriture à eux seuls : ils s'ajoutent au montant envoyé quand ils sont
    # libellés dans SA monnaie, et se retranchent du montant quand ils sont
    # dans la sienne (cf. services/import_bancaire._appliquer_frais).
    frais: Optional[float] = None
    nom_banque_monnaie_frais: str = ""
    monnaie_frais_id: Optional[int] = None
    # Les deux montants AVANT imputation des frais, tels que le fichier les
    # écrit. `montant` et `montant_envoye` ci-dessus sont ceux qui ont
    # réellement bougé (frais compris) : ce sont eux qu'on affiche et qui font
    # les écritures. Ceux-ci sont la base de calcul, et servent à réimputer les
    # frais quand l'utilisateur les corrige dans l'aperçu — sans eux, changer
    # des frais déjà incorporés obligerait à les défalquer à l'aveugle (cf.
    # services/import_bancaire._reimputer_frais).
    montant_hors_frais: Optional[float] = None
    montant_envoye_hors_frais: Optional[float] = None
    # True quand les frais lus ne sont dans aucune des deux monnaies de la
    # ligne : ils ne peuvent alors être rattachés à aucun montant, et l'import
    # entier est bloqué tant que la lecture des frais n'est pas retirée ou la
    # monnaie corrigée (cf. services/import_bancaire.confirmer).
    frais_incoherents: bool = False
    # Où en est la ligne chez la banque (colonne « État ») : "execute",
    # "attente", "refuse", ou None pour un preset qui ne lit pas cette colonne
    # — tout est alors considéré comme exécuté, comme avant. Une ligne en
    # attente devient une opération prévisionnelle ; une ligne refusée n'est pas
    # importée du tout (cf. constants.StatutImport).
    nom_banque_statut: str = ""
    statut_import: Optional[str] = None
    # Second compte d'un virement interne, renseigné manuellement (le fichier
    # bancaire ne décrit qu'un seul côté de la transaction) : ignoré pour toute
    # autre catégorie. Tant qu'il vaut None, la ligne garde l'ancien
    # comportement (une seule écriture, cf. create_operation_importee) ; une
    # fois les deux comptes connus, confirmer() crée un vrai virement
    # double-écriture (crud.create_virement).
    compte_id_autre: Optional[int] = None
    # True si categorie_id vient d'une proposition automatique ("Autres", faute
    # de mapping mémorisé) plutôt que d'un mapping explicitement mémorisé :
    # n'empêche jamais la création de l'opération, sert uniquement à demander
    # une confirmation côté frontend.
    categorie_suggestion_auto: bool = False
    # Nom de la règle de catégorisation qui a classé cette ligne (None si
    # aucune n'a correspondu) : affiché dans l'aperçu pour rendre le
    # classement automatique traçable.
    regle_appliquee: Optional[str] = None
    # Type d'opération de la ligne (code technique). Par défaut "classique" ;
    # posé par une règle de catégorisation ou par un reclassement manuel dans
    # l'aperçu. C'est lui qui décide si la ligne est remboursable.
    type_code: str = TypeOperation.classique.value
    # Montant fixe dû, pertinent uniquement pour un type remboursable ; None = pas
    # encore précisé par l'utilisateur (create_operation_importee retombe sur
    # le montant total, comme pour une opération remboursable créée à la main).
    # Pas de champ statut : une ligne de relevé bancaire est par nature une
    # transaction déjà survenue, l'opération créée est toujours "réel".
    montant_du: Optional[float] = None
    # Note libre et amortissement saisis dans le formulaire d'édition de
    # l'aperçu : aucun relevé ne les porte, ils naissent du classement de la
    # ligne. Absents par défaut — une ligne non retouchée n'a ni note ni
    # étalement, exactement comme avant.
    notes: Optional[str] = None
    amorti: bool = False
    amortissement_debut: Optional[date_type] = None
    amortissement_fin: Optional[date_type] = None
    erreur: Optional[str] = None
    # Id de la LigneImportBrute déjà en base suspectée d'être la même
    # transaction (voir services.import_bancaire.detecter_doublon), None si
    # cette ligne n'est pas un doublon. Une ligne doublon reste une
    # ImportLigne normale à tous points de vue (même format, Modifier,
    # Supprimer) : par défaut exclue de la création d'opération, sauf si son
    # numéro figure dans ImportMappingOverrides.lignes_verifiees (l'utilisateur
    # a coché "Vérifiée", override explicite du faux positif).
    doublon_de: Optional[int] = None


class ApercuFichier(BaseModel):
    """Le fichier tel qu'il est, avant toute interprétation : sert à vérifier
    d'un coup d'œil que la configuration des colonnes tombe bien en face des
    bonnes données (une colonne décalée est sinon très difficile à repérer)."""

    # Toutes les lignes non vides du fichier ; chaque ligne est complétée à la
    # largeur maximale pour que le tableau reste rectangulaire. Rien n'est
    # tronqué ici : c'est le frontend qui borne la hauteur affichée, le reste
    # restant accessible en défilant.
    lignes: list[list[str]] = Field(default_factory=list)
    # Index de colonne (1-based, en string pour JSON) -> propriété de l'app.
    # Les colonnes absentes de ce dict ne sont pas importées.
    proprietes_par_colonne: dict[str, str] = Field(default_factory=dict)
    total_lignes: int = 0
    # True si la première ligne affichée est l'en-tête ignoré (ImportPreset).
    premiere_ligne_ignoree: bool = False


class ImportPreview(BaseModel):
    lignes: list[ImportLigne]
    categories_inconnues: list[str]
    comptes_inconnus: list[str]
    # Libellés de devise lus dans le fichier qu'aucune correspondance mémorisée
    # ni aucun nom/symbole de monnaie ne permet de rattacher (cf.
    # services/import_bancaire._resoudre_monnaie). Vide pour un preset sans
    # colonne de devise.
    monnaies_inconnues: list[str] = Field(default_factory=list)
    # L'inverse : libellé de devise du fichier -> nom de la monnaie de l'app à
    # laquelle il a été rattaché, sans rien demander. Affiché en lecture seule
    # sous les devises à confirmer — un rattachement automatique (le fichier
    # écrit « SGD », une monnaie s'appelle « SGD ») ne se voyait sinon nulle
    # part, et son absence de la liste « à confirmer » passait pour un oubli.
    monnaies_resolues: dict[str, str] = Field(default_factory=dict)
    # Version résolue (même format que ImportLigne) de chaque ligne déjà en
    # base référencée par un doublon_de ci-dessus, clé = str(id) — affichée en
    # lecture seule à côté de la ligne importée pour comparaison (voir
    # services.import_bancaire._resoudre_ligne_existante).
    lignes_existantes: dict[str, ImportLigne] = Field(default_factory=dict)
    apercu_fichier: ApercuFichier = Field(default_factory=ApercuFichier)
    # Ce que la configuration du preset laisse d'ambigu sans être faux : un
    # montant reçu ou des frais lus sans leur devise (cf. services/
    # import_bancaire.avertissements_configuration). Affichés au-dessus de
    # l'aperçu ; ils ne bloquent jamais l'import, contrairement aux erreurs de
    # ligne.
    avertissements: list[str] = Field(default_factory=list)


class ImportLigneOverride(BaseModel):
    """Modification manuelle d'une ligne de l'aperçu avant confirmation
    (édition directe sur la ligne, cf. bouton "Modifier"). Seuls les champs
    fournis sont appliqués ; les autres gardent la valeur résolue automatiquement."""

    date: Optional[date_type] = None
    nature: Optional[str] = None
    montant: Optional[float] = None
    categorie_id: Optional[int] = None
    compte_id: Optional[int] = None
    compte_id_autre: Optional[int] = None
    type_code: Optional[str] = None
    montant_du: Optional[float] = None
    # Monnaies et montant envoyé corrigés à la main : indispensables pour un
    # virement entre deux devises, que l'app ne peut jamais recalculer seule.
    monnaie_id: Optional[int] = None
    montant_envoye: Optional[float] = None
    monnaie_envoyee_id: Optional[int] = None
    # Frais corrigés à la main. Leur présence change la lecture des deux
    # montants ci-dessus : ils valent alors HORS FRAIS, et le serveur réimpute
    # (cf. services/import_bancaire._reimputer_frais). Le formulaire ne les
    # envoie que là où il les affiche — un virement entre deux devises qui
    # porte des frais — donc partout ailleurs les montants restent ceux qui ont
    # réellement bougé, exactement comme avant.
    frais: Optional[float] = None
    monnaie_frais_id: Optional[int] = None
    # Note libre et étalement, saisis au moment où l'on classe la ligne (cf.
    # ImportLigne). `amorti` est un booléen plein et non un Optional : le
    # formulaire dit toujours dans quel état est sa case, et un None
    # signifierait « ne touche pas » là où l'utilisateur vient justement de
    # décocher. Les deux bornes, elles, ne valent que si la case est cochée.
    notes: Optional[str] = None
    amorti: bool = False
    amortissement_debut: Optional[date_type] = None
    amortissement_fin: Optional[date_type] = None


class ImportMappingOverrides(BaseModel):
    # Catégorie choisie pour chaque libellé bancaire dans l'aperçu. Un simple
    # id depuis 0022 : le type ne se choisit plus ici, il est posé par les
    # règles (évaluées avant les correspondances).
    categories: dict[str, int] = Field(default_factory=dict)
    comptes: dict[str, int] = Field(default_factory=dict)
    # Monnaie choisie pour chaque libellé de devise du fichier (« EUR » -> Euro).
    monnaies: dict[str, int] = Field(default_factory=dict)
    # Modifications ponctuelles par numéro de ligne (ImportLigne.ligne).
    lignes: dict[int, ImportLigneOverride] = Field(default_factory=dict)
    # Numéros de ligne exclues de l'import (bouton "Supprimer" de l'aperçu, ou
    # suppression groupée sur une sélection).
    lignes_supprimees: list[int] = Field(default_factory=list)


class VirementCandidatDoublon(BaseModel):
    """Un virement interne tel que l'aperçu d'import le connaît À CET INSTANT :
    ses deux comptes sont connus (celui du fichier et celui complété à la main),
    sinon il n'y aurait rien à comparer.

    Distinct de la détection de doublons ordinaire (cf. detecter_doublon), qui
    compare des LIGNES DE FICHIER à l'intérieur d'un même preset : deux relevés
    de deux banques décrivent le même virement avec des colonnes qui n'ont rien
    de commun, et seule la transaction elle-même — deux comptes, un montant, une
    date voisine — les rapproche."""

    ligne: int
    date: date_type
    # Ce qui PART du compte émetteur, et sa devise.
    montant: float
    monnaie_id: Optional[int] = None
    # Ce qui ARRIVE sur le récepteur : renseigné uniquement quand il diffère de
    # ce qui part (transfert entre deux devises). Les deux montants doivent
    # alors correspondre pour conclure au doublon.
    montant_recu: Optional[float] = None
    monnaie_recue_id: Optional[int] = None
    compte_source_id: int
    compte_destination_id: int


class VirementDoublonSuspect(BaseModel):
    """Ce à quoi un candidat ressemble : une opération déjà en base
    (source="base") ou une autre ligne du fichier en cours (source="fichier")."""

    source: str
    operation_id: Optional[int] = None
    ligne: Optional[int] = None
    date: date_type
    nature: str
    montant: float
    monnaie_symbole: str = ""
    compte_source: str
    compte_destination: str
    ecart_jours: int


class VirementDoublonRead(BaseModel):
    ligne: int
    suspects: list[VirementDoublonSuspect] = Field(default_factory=list)


class VirementsDoublonsInput(BaseModel):
    candidats: list[VirementCandidatDoublon] = Field(default_factory=list)


class VirementsDoublonsRead(BaseModel):
    resultats: list[VirementDoublonRead] = Field(default_factory=list)


class ImportResultat(BaseModel):
    operations_creees: int
    lignes_ignorees: list[ImportLigne]
    doublons_detectes: int = 0
    # Trace créée pour cet import (ImportHistorique.id). Le frontend s'en sert
    # pour rattacher au même import les règlements liés, qu'il crée un par un
    # après coup (cf. services/import_bancaire.enregistrer_ligne_brute) : sans
    # ce rattachement, eux seuls survivraient à l'annulation de leur import.
    historique_id: Optional[int] = None


class ImportAnnulationResultat(BaseModel):
    """Ce qu'a défait l'annulation d'un import.

    `operations_supprimees` peut être inférieur au `operations_creees` de
    l'historique : les opérations déjà supprimées à la main entre-temps ne s'y
    retrouvent plus (cf. services/import_bancaire.annuler_import)."""

    operations_supprimees: int
    historique_supprime: bool


class MappingCategorieRead(BaseModel):
    """La cible est toujours une catégorie de dépense. Un libellé qui désigne en
    réalité un TYPE (« Mouvements internes » -> Virement interne) relève d'une
    règle de catégorisation, pas d'une correspondance : ces types ne portent
    aucune catégorie (cf. migration 0022)."""

    nom_banque: str
    categorie_id: int
    categorie_nom: str


class MappingCategorieGlobalRead(MappingCategorieRead):
    """La même correspondance, vue hors de son preset : la galerie de la page
    Règles les affiche tous ensemble, il lui faut donc de quoi dire d'où chaque
    libellé sort — et de quoi viser le bon preset en le reclassant ou en le
    supprimant.

    Une carte par correspondance, sans regroupement : deux presets peuvent
    ranger le même libellé dans deux catégories différentes, et c'est justement
    ce que la galerie doit montrer."""

    preset_id: int
    # Compte auquel le preset est lié. None quand le fichier nomme lui-même le
    # compte de chaque ligne : rien n'est alors affiché, il n'y a pas UN compte
    # à nommer.
    compte_nom: Optional[str] = None


class MappingCompteRead(BaseModel):
    nom_banque: str
    compte_id: int
    compte_nom: str


class MappingCompteGlobalRead(MappingCompteRead):
    """Une correspondance de compte telle que la page Règles l'affiche : sans
    dire de quel preset elle vient.

    Les entrées identiques (même libellé, même compte) de plusieurs presets sont
    fondues en UNE, d'où la liste de presets plutôt qu'un id — la modifier ou la
    supprimer les vise tous. Sans ça, la liste commune répéterait la même ligne
    autant de fois qu'il y a de presets."""

    preset_ids: list[int]


class MappingMonnaieRead(BaseModel):
    nom_banque: str
    monnaie_id: int
    monnaie_nom: str


class MappingMonnaieGlobalRead(MappingMonnaieRead):
    """Idem pour les devises, où la répétition est la règle : « EUR » -> Euro
    existe dans chaque preset qui lit une colonne de devise."""

    preset_ids: list[int]


class MappingCategorieUpsert(BaseModel):
    nom_banque: str = Field(min_length=1)
    categorie_id: int


class MappingCompteUpsert(BaseModel):
    nom_banque: str = Field(min_length=1)
    compte_id: int


class MappingMonnaieUpsert(BaseModel):
    nom_banque: str = Field(min_length=1)
    monnaie_id: int


class ImportMappingsRead(BaseModel):
    """Tout ce qu'affiche « Correspondances mémorisées » (page Règles), tous
    presets confondus : cette page n'a pas de sélecteur de preset, et n'en
    montrer qu'un revenait à cacher le reste sans dire lequel."""

    categories: list[MappingCategorieGlobalRead]
    comptes: list[MappingCompteGlobalRead]
    monnaies: list[MappingMonnaieGlobalRead] = Field(default_factory=list)


class ColonneImportConfig(BaseModel):
    index: int = Field(ge=1)
    propriete: str


class ImportPresetRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    nom: str
    # Compte auquel ce format de relevé appartient. Renseigné, toutes les lignes
    # du fichier lui sont affectées, sans consulter ni la colonne « compte
    # bancaire » ni les correspondances mémorisées.
    compte_id: Optional[int] = None
    colonnes: list[ColonneImportConfig]
    # Index de colonnes (1-based, format brut) désignées pour la comparaison de
    # doublons ; `mode_comparaison` dit si ce sont celles à ignorer ou les
    # seules à comparer (cf. constants.ModeComparaison).
    colonnes_comparaison: list[int] = Field(default_factory=list)
    mode_comparaison: ModeComparaison = ModeComparaison.exclusion
    # True = la première ligne du fichier est un en-tête à sauter. False
    # (défaut) = c'est déjà une ligne de données.
    ignorer_premiere_ligne: bool = False
    # Vocabulaire de la colonne « Sens » propre à ce relevé. Listes vides =
    # celui du code (constants.LIBELLES_SENS_*), en français.
    libelles_sens_sortie: list[str] = Field(default_factory=list)
    libelles_sens_entree: list[str] = Field(default_factory=list)
    # Vocabulaire de la colonne « État ». Listes vides = celui du code
    # (constants.LIBELLES_STATUT_DEFAUT).
    libelles_statut_execute: list[str] = Field(default_factory=list)
    libelles_statut_attente: list[str] = Field(default_factory=list)
    libelles_statut_refuse: list[str] = Field(default_factory=list)
    # Date du dernier import confirmé sous ce preset (None si jamais utilisé) :
    # permet au frontend de présélectionner le preset réellement utilisé plutôt
    # que le premier par ordre alphabétique, qui peut être vide.
    dernier_import: Optional[datetime] = None


class ImportPresetCreate(BaseModel):
    nom: str = Field(min_length=1)
    compte_id: Optional[int] = None
    colonnes: list[ColonneImportConfig]
    colonnes_comparaison: list[int] = Field(default_factory=list)
    mode_comparaison: ModeComparaison = ModeComparaison.exclusion
    ignorer_premiere_ligne: bool = False
    libelles_sens_sortie: list[str] = Field(default_factory=list)
    libelles_sens_entree: list[str] = Field(default_factory=list)
    # Vocabulaire de la colonne « État ». Listes vides = celui du code
    # (constants.LIBELLES_STATUT_DEFAUT).
    libelles_statut_execute: list[str] = Field(default_factory=list)
    libelles_statut_attente: list[str] = Field(default_factory=list)
    libelles_statut_refuse: list[str] = Field(default_factory=list)


class ImportPresetUpdate(BaseModel):
    nom: str = Field(min_length=1)
    # None = preset non lié (le compte vient du fichier), comme à la création.
    compte_id: Optional[int] = None
    colonnes: list[ColonneImportConfig]
    colonnes_comparaison: list[int] = Field(default_factory=list)
    mode_comparaison: ModeComparaison = ModeComparaison.exclusion
    ignorer_premiere_ligne: bool = False
    libelles_sens_sortie: list[str] = Field(default_factory=list)
    libelles_sens_entree: list[str] = Field(default_factory=list)
    # Vocabulaire de la colonne « État ». Listes vides = celui du code
    # (constants.LIBELLES_STATUT_DEFAUT).
    libelles_statut_execute: list[str] = Field(default_factory=list)
    libelles_statut_attente: list[str] = Field(default_factory=list)
    libelles_statut_refuse: list[str] = Field(default_factory=list)


class ImportHistoriqueRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    date_import: datetime
    nom_fichier: Optional[str] = None
    operations_creees: int
    lignes_ignorees: int
    doublons_detectes: int = 0
    # Combien de ces opérations existent ENCORE, donc ce qu'annuler cet import
    # supprimerait aujourd'hui. Calculé à la lecture, jamais stocké : les
    # opérations vivent leur vie après l'import (suppression à la main,
    # notamment) et une colonne aurait figé un compte faux. Zéro = il ne reste
    # rien à annuler, le frontend n'affiche alors pas le bouton.
    operations_annulables: int = 0
    # Pourquoi il n'y a rien à annuler, quand c'est le cas : "anterieur" (import
    # d'avant la migration 0016, dont les lignes n'ont jamais désigné leurs
    # opérations — il ne sera jamais annulable) ou "deja_supprime" (ses
    # opérations ont été retirées à la main depuis). Deux situations qui se
    # ressembleraient à l'écran, alors qu'une seule demande d'aller voir.
    # None quand l'import est annulable.
    raison_non_annulable: Optional[str] = None


class NoteDashboardRead(BaseModel):
    """Bloc-notes libre du dashboard. `modifie_le` est None tant que rien n'a
    jamais été écrit."""

    contenu: str = ""
    modifie_le: Optional[datetime] = None


class NoteDashboardUpdate(BaseModel):
    # Pas de longueur minimale : vider la note est une façon légitime de la
    # supprimer, et il n'y a rien d'autre à supprimer.
    contenu: str = ""


class BaseDonneesRead(BaseModel):
    chemin_actuel: str
    chemin_dev: str
    # True si l'app pointe actuellement vers la base de test/dev (plutôt
    # qu'une base personnelle sélectionnée à la main).
    est_dev: bool
    # Version de schéma du fichier actuellement ouvert, et celle qu'attend
    # l'application : les deux sont affichées, parce qu'un écart est
    # exactement ce qui rend une base illisible après une mise à jour.
    revision_base: Optional[str] = None
    revision_app: Optional[str] = None
    # Renseignés uniquement quand la bascule vient de migrer la base : la copie
    # prise juste avant, et la version quittée. C'est le seul moment où
    # l'utilisateur doit savoir où retrouver son fichier d'origine.
    migration_appliquee: bool = False
    sauvegarde: Optional[str] = None
    revision_quittee: Optional[str] = None


class BaseDonneesUpdate(BaseModel):
    chemin: str = Field(min_length=1)


# ---------- Règles de catégorisation ----------


class ConditionRegle(BaseModel):
    """Un test sur un champ du relevé.

    Un seul champ par condition : pour en viser plusieurs, on ajoute autant de
    conditions dans un groupe "OU", ce qui rend la combinaison explicite au
    lieu de la cacher dans un OU implicite entre cases cochées.
    """

    champ: str
    operateur: OperateurRegle
    valeur: str

    @model_validator(mode="after")
    def _check_champ(self):
        if self.champ not in CHAMPS_REGLE_VALIDES:
            raise ValueError(
                f"champ inconnu : {self.champ} "
                f"(attendus : {', '.join(sorted(CHAMPS_REGLE_VALIDES))})"
            )
        # Une valeur vide rendrait "contient" toujours vrai et "est" quasi
        # toujours faux : dans les deux cas la règle ne veut rien dire.
        if not self.valeur.strip():
            raise ValueError("la valeur à comparer ne peut pas être vide")
        return self


class GroupeRegle(BaseModel):
    operateur: ConnecteurRegle = ConnecteurRegle.et
    conditions: list[ConditionRegle] = Field(min_length=1)


class ConditionsRegle(BaseModel):
    """Deux niveaux : des groupes de conditions, eux-mêmes combinés — de quoi
    exprimer "(A OU B) ET (C OU D)"."""

    operateur: ConnecteurRegle = ConnecteurRegle.et
    groupes: list[GroupeRegle] = Field(min_length=1)


class RegleCategorisationBase(BaseModel):
    nom: str = Field(min_length=1)
    conditions: ConditionsRegle
    # Action, en deux temps : le type d'opération d'abord, puis la catégorie
    # -- cette dernière n'ayant de sens que pour les types à catégorie libre.
    # La cohérence des deux est vérifiée côté routeur, qui seul peut résoudre
    # le code du type depuis son id.
    type_id: int
    categorie_id: Optional[int] = None
    # Compte EN FACE, pour le seul type « virement interne » : le relevé ne
    # nomme qu'un des deux comptes d'un virement, et sans le second la ligne
    # arrive incomplète dans l'aperçu. Neutralisé côté routeur pour tout autre
    # type, comme categorie_id l'est déjà.
    compte_autre_id: Optional[int] = None
    actif: bool = True
    # Faut-il cesser d'évaluer les règles quand celle-ci correspond ? True par
    # défaut : c'est le comportement historique, et celui qu'on veut sur une
    # règle qu'on vient d'écrire sans y réfléchir.
    arreter_apres: bool = True


class RegleCategorisationCreate(RegleCategorisationBase):
    pass


class RegleCategorisationUpdate(RegleCategorisationBase):
    pass


class RegleCategorisationRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    nom: str
    ordre: int
    actif: bool
    arreter_apres: bool
    type_id: int
    # Code technique du type, pour que le frontend n'ait pas à recroiser la
    # table des types.
    type_code: str
    categorie_id: Optional[int] = None
    compte_autre_id: Optional[int] = None
    conditions: ConditionsRegle


class ReordonnerRegles(BaseModel):
    ids: list[int]


class ExtensionEtatUpdate(BaseModel):
    """Activation ou désactivation d'une extension (cf. app/extensions.py).

    Un seul champ, et volontairement : tout le reste d'une extension (nom,
    version, écrans) vient de son manifeste sur le disque, jamais du client —
    l'application ne se laisse pas dire par une requête ce qu'une extension
    contient."""

    actif: bool


class ExtensionsAnnonceesUpdate(BaseModel):
    """Extensions dont l'utilisateur vient de fermer la fenêtre d'annonce.

    Une LISTE et non un identifiant unique : la fenêtre les annonce toutes
    ensemble et se ferme d'un seul geste — les acquitter une par une
    multiplierait les allers-retours pour un même clic, et laisserait la
    moitié de la liste non acquittée si l'un d'eux échouait."""

    ids: list[str]
