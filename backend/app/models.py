from sqlalchemy import (
    Column,
    Integer,
    String,
    Float,
    Boolean,
    Date,
    DateTime,
    ForeignKey,
    Enum,
    JSON,
    Text,
    CheckConstraint,
    Index,
    UniqueConstraint,
)
from sqlalchemy.orm import relationship

from .database import Base
from .constants import (
    TYPES_REMBOURSABLES,
    TYPE_COMPTE_PLACEMENT,
    Frequence,
    ModeComparaison,
    Sens,
    SensAction,
    Statut,
    TypeOperation,
)


def _enum_values(enum_cls):
    return [member.value for member in enum_cls]


def _sql_in_list(values):
    parts = [f'"{v}"' if "'" in v else f"'{v}'" for v in values]
    return ", ".join(parts)


class TypeOperationDB(Base):
    """Les familles d'opérations (Opération classique, Dépense remboursable,
    Remboursement reçu, Prêt reçu, Remboursement prêt, Virement interne, et
    Achat / vente de titres).

    Auparavant ce concept n'existait pas en base : quatre de ces types étaient
    des « catégories système » rangées avec les vraies catégories de dépense,
    et les deux autres n'étaient qu'un booléen `remboursable`. D'où des tests
    métier écrits sur des noms de catégorie, fragiles au renommage.

    `code` est la clé technique stable (valeurs de constants.TypeOperation) :
    toute la logique s'y réfère. `nom` est le libellé affiché, que l'utilisateur
    peut renommer sans rien casser. Les lignes sont créées par les migrations
    (0019, puis 0020 pour les titres) et ne sont pas supprimables —
    l'application dépend de leur existence.
    """

    __tablename__ = "type_operation"

    id = Column(Integer, primary_key=True, autoincrement=True)
    code = Column(String, nullable=False, unique=True)
    nom = Column(String, nullable=False)
    ordre = Column(Integer, nullable=False, default=0)
    # True = type géré exclusivement par une page dédiée (cf.
    # constants.TYPES_INTERNES) : jamais proposé dans un menu de type, et refusé
    # par les endpoints génériques /operations. Exposé au frontend pour qu'il
    # filtre ses menus sans réécrire la liste des codes concernés.
    interne = Column(Boolean, nullable=False, default=False)


class Categorie(Base):
    """Catégorie de dépense choisie par l'utilisateur (Alimentaire, Loisirs…).

    Ne contient plus que de vraies catégories depuis 0019 : les quatre
    anciennes catégories système sont devenues des TypeOperationDB. Seules les
    opérations de type `classique` ou `remboursable` en portent une.
    """

    __tablename__ = "categorie"

    id = Column(Integer, primary_key=True, autoincrement=True)
    nom = Column(String, nullable=False, unique=True)
    # Position d'affichage (dropdowns, dashboard, onglet Catégories) ; modifiable
    # par l'utilisateur via les boutons monter/descendre.
    ordre = Column(Integer, nullable=False, default=0)
    # Affichée ou non dans l'histogramme du dashboard (œil de l'onglet
    # Catégories). Réglage d'AFFICHAGE seulement : une catégorie éteinte garde
    # ses opérations, son budget et sa place dans tous les menus — elle ne
    # disparaît que du graphe, où une barre écrasante ou sans intérêt nuit à la
    # lecture des autres.
    visible_dashboard = Column(Boolean, nullable=False, default=True)
    # Index dans la palette de l'histogramme (la palette elle-même vit côté
    # frontend). Attribué à la CRÉATION et jamais recalculé : ni un
    # réordonnancement, ni l'extinction d'une autre catégorie ne doivent changer
    # la couleur d'une barre. Un index n'est repris que si la catégorie qui le
    # portait est supprimée (cf. crud._prochain_couleur_index).
    couleur_index = Column(Integer, nullable=False, default=0)


class Monnaie(Base):
    """Une monnaie dans laquelle des montants sont libellés (Euro, Dollar…).

    L'app ne stocke aucun taux de change et n'additionne jamais deux monnaies :
    chaque solde, chaque KPI et chaque budget est calculé séparément par
    monnaie. `symbole` est ce qui s'affiche à côté des montants ; il n'a pas
    besoin d'être un code ISO, seulement d'être lisible.

    La migration 0021 en crée une seule (l'euro) pour rattacher les données
    existantes ; les suivantes sont créées par l'utilisateur.
    """

    __tablename__ = "monnaie"

    id = Column(Integer, primary_key=True, autoincrement=True)
    nom = Column(String, nullable=False, unique=True)
    symbole = Column(String, nullable=False)
    # Ordre d'affichage (onglets du dashboard, menus) : l'ordre de création par
    # défaut, l'euro restant donc en tête sur une base migrée.
    ordre = Column(Integer, nullable=False, default=0)


class TauxChange(Base):
    """« 1 unité de `monnaie_source` vaut `taux` unités de `monnaie_cible` ».

    REMPLIE PAR L'EXTENSION « Lecture de cours », jamais par le noyau : c'est
    elle qui va lire la page désignée par `url_cours`. La table vit ici quand
    même, comme le reste du schéma, pour que retirer l'extension ne fasse
    perdre ni les liens ni les derniers taux connus (cf. extensions/README.md).

    RIEN NE CONVERTIT AVEC. Aucun solde, aucun KPI, aucun budget ne consulte
    cette table : les montants restent suivis monnaie par monnaie, et un taux
    n'est qu'une information affichée là où l'utilisateur la demande. Lui faire
    additionner deux devises reviendrait à défaire le choix central de l'app.

    UN COUPLE, PAS UNE MONNAIE DE RÉFÉRENCE : l'application n'en a aucune. Le
    sens compte — EUR -> USD et USD -> EUR sont deux lignes, avec deux pages
    d'où les lire, parce que c'est ainsi que les sites les publient.

    `taux` et `maj_le` sont NULL tant qu'aucune lecture n'a abouti : « jamais
    relu », là où un 1.0 par défaut aurait menti.
    """

    __tablename__ = "taux_change"

    id = Column(Integer, primary_key=True, autoincrement=True)
    monnaie_source_id = Column(
        Integer, ForeignKey("monnaie.id", ondelete="CASCADE"), nullable=False
    )
    monnaie_cible_id = Column(
        Integer, ForeignKey("monnaie.id", ondelete="CASCADE"), nullable=False
    )
    url_cours = Column(String, nullable=False)
    taux = Column(Float, nullable=True)
    maj_le = Column(DateTime, nullable=True)

    monnaie_source = relationship("Monnaie", foreign_keys=[monnaie_source_id])
    monnaie_cible = relationship("Monnaie", foreign_keys=[monnaie_cible_id])

    __table_args__ = (
        UniqueConstraint("monnaie_source_id", "monnaie_cible_id", name="uq_taux_change_couple"),
        CheckConstraint(
            "monnaie_source_id <> monnaie_cible_id", name="ck_taux_change_monnaies_distinctes"
        ),
        Index("ix_taux_change_source", "monnaie_source_id"),
        Index("ix_taux_change_cible", "monnaie_cible_id"),
    )


class CompteMonnaie(Base):
    """Une monnaie portée par un compte, et le solde initial du compte DANS
    cette monnaie.

    Un compte multi-devises n'est pas dupliqué en base (ce qui aurait cassé
    tout ce qui pointe vers un compte : opérations, correspondances d'import,
    virements) : il reste une seule ligne `compte`, à laquelle s'accrochent
    autant de lignes ici que de monnaies. Les soldes se calculent alors par
    couple (compte, monnaie) — cf. services/soldes.py.

    `solde_initial` a quitté `compte` pour venir ici : un compte à deux
    monnaies a deux soldes de départ, et un seul champ ne pouvait pas dire
    lequel.
    """

    __tablename__ = "compte_monnaie"

    id = Column(Integer, primary_key=True, autoincrement=True)
    compte_id = Column(Integer, ForeignKey("compte.id", ondelete="CASCADE"), nullable=False)
    monnaie_id = Column(Integer, ForeignKey("monnaie.id"), nullable=False)
    solde_initial = Column(Float, nullable=False, default=0.0)
    # Position dans la liste du compte ; la première est la monnaie proposée
    # par défaut à la saisie et celle retenue pour les lignes importées.
    ordre = Column(Integer, nullable=False, default=0)

    compte = relationship("Compte", back_populates="monnaies")
    monnaie = relationship("Monnaie")

    __table_args__ = (
        UniqueConstraint("compte_id", "monnaie_id", name="uq_compte_monnaie"),
        Index("ix_compte_monnaie_compte", "compte_id"),
        Index("ix_compte_monnaie_monnaie", "monnaie_id"),
    )


class CategorieBudgetMensuel(Base):
    """Budget alloué à une catégorie pour un mois ET une monnaie donnés. Table
    volontairement creuse : un mois sans entrée hérite du budget du mois
    explicite le plus récent qui le précède, dans la même monnaie (voir
    crud.get_budget_categorie).

    La monnaie fait partie de la clé depuis 0021 : un budget « 300 » ne veut
    rien dire si l'on dépense en euros et en dollars sur la même catégorie."""

    __tablename__ = "categorie_budget_mensuel"

    id = Column(Integer, primary_key=True, autoincrement=True)
    categorie_id = Column(
        Integer, ForeignKey("categorie.id", ondelete="CASCADE"), nullable=False
    )
    monnaie_id = Column(Integer, ForeignKey("monnaie.id"), nullable=False)
    annee = Column(Integer, nullable=False)
    mois = Column(Integer, nullable=False)
    montant = Column(Float, nullable=False, default=0.0)

    categorie = relationship("Categorie")
    monnaie = relationship("Monnaie")

    __table_args__ = (
        UniqueConstraint(
            "categorie_id", "annee", "mois", "monnaie_id", name="uq_categorie_budget_mensuel"
        ),
        CheckConstraint("mois >= 1 AND mois <= 12", name="ck_categorie_budget_mensuel_mois"),
        Index("ix_categorie_budget_mensuel_categorie", "categorie_id"),
        Index("ix_categorie_budget_mensuel_monnaie", "monnaie_id"),
    )


class TypeCompte(Base):
    """Type de compte (Courant, Épargne, ou tout autre regroupement créé par
    l'utilisateur). Courant/Épargne sont protégés (systeme=True) : ils pilotent
    des règles métier (dashboard, virements réservés à l'épargne) et ne sont
    donc jamais supprimables."""

    __tablename__ = "type_compte"

    id = Column(Integer, primary_key=True, autoincrement=True)
    nom = Column(String, nullable=False, unique=True)
    systeme = Column(Boolean, nullable=False, default=False)


class Compte(Base):
    __tablename__ = "compte"

    id = Column(Integer, primary_key=True, autoincrement=True)
    nom = Column(String, nullable=False, unique=True)
    type_id = Column(Integer, ForeignKey("type_compte.id"), nullable=False)
    # Position d'affichage AU SEIN DE SON TYPE : les comptes se lisent toujours
    # groupés par type (cartes de la page Comptes, sections du dashboard), un
    # ordre global n'aurait donc rien à ordonner. Fixé par glisser-déposer dans
    # Paramètres > Comptes, et repris tel quel partout ailleurs — le tri par nom
    # d'avant ne laissait aucun moyen de mettre en tête le compte qu'on regarde
    # le plus.
    ordre = Column(Integer, nullable=False, default=0)

    operations = relationship("Operation", back_populates="compte")
    type_compte = relationship("TypeCompte")
    # Au moins une ligne, toujours (garanti par les routeurs) : un compte sans
    # monnaie ne pourrait porter aucune opération.
    monnaies = relationship(
        "CompteMonnaie",
        back_populates="compte",
        order_by="CompteMonnaie.ordre",
        cascade="all, delete-orphan",
    )

    @property
    def type_nom(self) -> str:
        return self.type_compte.nom

    @property
    def monnaie_ids(self) -> set:
        return {lien.monnaie_id for lien in self.monnaies}

    @property
    def monnaie_principale_id(self):
        """La première monnaie du compte : celle proposée par défaut à la
        saisie et retenue pour une ligne importée (un relevé bancaire ne dit
        pas dans quelle monnaie il est libellé)."""
        return self.monnaies[0].monnaie_id if self.monnaies else None

    @property
    def est_placement(self) -> bool:
        """Un compte-titres : son solde en espèces se calcule comme celui de
        n'importe quel compte, mais il porte en plus un portefeuille de titres
        (cf. OperationAction) et n'accepte pas d'opération classique."""
        return self.type_compte.nom == TYPE_COMPTE_PLACEMENT


class Operation(Base):
    __tablename__ = "operation"

    id = Column(Integer, primary_key=True, autoincrement=True)
    date = Column(Date, nullable=False)
    compte_id = Column(Integer, ForeignKey("compte.id"), nullable=False)
    type_id = Column(Integer, ForeignKey("type_operation.id"), nullable=False)
    # NULL pour les quatre types à catégorie imposée (remboursement reçu, prêt
    # reçu, remboursement prêt, virement interne) : leur type EST leur
    # classification. Seuls `classique` et `remboursable` portent une catégorie.
    categorie_id = Column(Integer, ForeignKey("categorie.id"), nullable=True)
    nature = Column(String, nullable=False)
    montant = Column(Float, nullable=False)
    # Monnaie du montant. Toujours l'une de celles portées par le compte (cf.
    # CompteMonnaie, vérifié par les routeurs). Les deux écritures d'un virement
    # entre comptes de monnaies différentes en portent donc chacune une
    # distincte, avec leur propre montant — c'est ce qui permet de virer 100 €
    # et d'en recevoir 108 $ sans que l'app ait à connaître un taux.
    monnaie_id = Column(Integer, ForeignKey("monnaie.id"), nullable=False)
    # Conservé en colonne : le type ne suffit pas à le déduire, `virement`
    # recouvrant à lui seul transfert_sortant ET transfert_entrant.
    sens = Column(Enum(Sens, native_enum=False, values_callable=_enum_values), nullable=False)
    statut = Column(
        Enum(Statut, native_enum=False, values_callable=_enum_values), nullable=False
    )
    # Montant fixe initialement dû, conservé tel quel même une fois le remboursement effectué.
    montant_du = Column(Float, nullable=False, default=0.0)
    # Reste à rembourser : diminue (jusqu'à 0) au fil des remboursements liés.
    montant_a_rembourser = Column(Float, nullable=False, default=0.0)
    virement_id = Column(String, nullable=True)
    # Notes libres, sans aucune sémantique : jamais lues, filtrées ni sommées
    # par l'app. Elles n'existent que pour ce qu'aucune colonne ne porte, et ne
    # s'affichent qu'à l'édition. NULL et chaîne vide y valent la même chose.
    notes = Column(String, nullable=True)
    # Récurrence : True pour le modèle ET pour chacune de ses occurrences
    # générées (voir crud.generer_occurrences_recurrentes) -- sert à séparer
    # récurrentes/ponctuelles dans la page Opérations. frequence/recurrence_fin
    # ne sont renseignés que sur le modèle (recurrence_parent_id NULL) ;
    # recurrence_fin NULL = récurrence infinie (bornée à un horizon glissant
    # lors de la génération, jamais persistée comme telle).
    recurrente = Column(Boolean, nullable=False, default=False)
    frequence = Column(
        Enum(Frequence, native_enum=False, values_callable=_enum_values), nullable=True
    )
    recurrence_fin = Column(Date, nullable=True)
    recurrence_parent_id = Column(
        Integer, ForeignKey("operation.id", ondelete="SET NULL"), nullable=True
    )
    # Amortissement : la dépense a bien lieu une seule fois, à `date` (c'est
    # elle qui bouge le solde du compte, ce jour-là et pas un autre), mais elle
    # PÈSE sur plusieurs mois. Les deux bornes délimitent ces mois, incluses,
    # et valent toujours le 1er du mois (normalisé par schemas.OperationBase) :
    # seul le mois compte, le jour n'a rien à dire ici. Elles sont renseignées
    # exactement quand `amorti` est vrai.
    #
    # Deux dates plutôt que la liste des mois concernés : la liste est
    # contiguë par construction, donc entièrement décrite par ses bornes — et
    # surtout, deux colonnes se comparent en SQL. C'est ce qui permet à
    # services/soldes.py de ne charger que les opérations amorties dont la
    # plage recoupe la période affichée, là où une liste JSON aurait imposé de
    # relire toutes les opérations amorties de la base à chaque affichage du
    # dashboard.
    #
    # Aucune opération n'est créée pour les mois couverts : c'est le calcul des
    # agrégats de période qui lit ces colonnes (cf. soldes.part_amortie). Étaler
    # une dépense en N opérations aurait dupliqué en base ce que `montant` dit
    # déjà, et fait diverger le solde du compte du relevé bancaire.
    amorti = Column(Boolean, nullable=False, default=False)
    amortissement_debut = Column(Date, nullable=True)
    amortissement_fin = Column(Date, nullable=True)

    compte = relationship("Compte", back_populates="operations")
    categorie = relationship("Categorie")
    type_operation = relationship("TypeOperationDB")
    monnaie = relationship("Monnaie")

    @property
    def type_code(self) -> str:
        """Le code technique du type, sur lequel s'écrit toute la logique
        métier (jamais le libellé, qui est renommable)."""
        return self.type_operation.code

    @property
    def remboursable(self) -> bool:
        """Remplace l'ancienne colonne booléenne : exactement les deux types
        pour lesquels elle valait 1 (dépense remboursable et prêt reçu)."""
        return TypeOperation(self.type_operation.code) in TYPES_REMBOURSABLES

    @property
    def amortissement_nb_mois(self):
        """Nombre de mois d'amortissement, bornes incluses (None si non
        amortie ; jamais 0, un même mois de début et de fin donnant 1).

        Calculé et non stocké : il se déduit exactement des deux bornes, et une
        troisième colonne à maintenir en accord avec elles n'aurait fait
        qu'ouvrir la possibilité qu'elle ne le soit plus. Le formulaire, lui,
        laisse bien l'utilisateur saisir ce nombre — il en déduit alors la
        borne manquante, c'est-à-dire qu'il fait la conversion à l'endroit où
        elle relève de l'ergonomie, pas du stockage."""
        if not self.amorti or self.amortissement_debut is None or self.amortissement_fin is None:
            return None
        debut = self.amortissement_debut
        fin = self.amortissement_fin
        return (fin.year - debut.year) * 12 + (fin.month - debut.month) + 1

    @property
    def amortissement_montant_par_mois(self):
        """Le montant imputé à chacun des mois couverts (None si non amortie).

        Dérivé pour la même raison que ci-dessus : le stocker aurait obligé à le
        recalculer à chaque changement de `montant` ou de bornes, avec le risque
        qu'un chemin l'oublie. Attention, ce n'est PAS la part que le dashboard
        impute réellement à un mois pour une dépense remboursable : celle-ci se
        calcule sur le reste à charge (montant − montant dû), cf.
        services/soldes._sommes_amorties_par_categorie. C'est une valeur
        d'affichage."""
        nb_mois = self.amortissement_nb_mois
        if nb_mois is None:
            return None
        return self.montant / nb_mois

    __table_args__ = (
        CheckConstraint("montant >= 0", name="ck_operation_montant_positif"),
        CheckConstraint(
            f"sens IN ({_sql_in_list(_enum_values(Sens))})", name="ck_operation_sens"
        ),
        CheckConstraint(
            f"statut IN ({_sql_in_list(_enum_values(Statut))})", name="ck_operation_statut"
        ),
        CheckConstraint(
            f"frequence IS NULL OR frequence IN ({_sql_in_list(_enum_values(Frequence))})",
            name="ck_operation_frequence",
        ),
        Index("ix_operation_categorie_id", "categorie_id"),
        Index("ix_operation_type_id", "type_id"),
        Index("ix_operation_compte_id", "compte_id"),
        Index("ix_operation_date", "date"),
        Index("ix_operation_virement_id", "virement_id"),
        Index("ix_operation_recurrence_parent_id", "recurrence_parent_id"),
        Index("ix_operation_monnaie_id", "monnaie_id"),
    )


class Action(Base):
    """Un titre détenu ou négociable (action, ETF, obligation…).

    `valeur` est le dernier cours unitaire connu, saisi à la main : l'app n'a
    aucune source de marché, cette valeur ne sert qu'à valoriser le
    portefeuille à l'écran. Elle n'entre jamais dans le calcul d'un solde en
    espèces, lequel ne dépend que des prix réellement payés ou encaissés
    (OperationAction.prix_unitaire).

    Le titre est global, pas rattaché à un compte : le même ETF peut être
    détenu sur deux comptes-titres, et les quantités détenues se lisent par
    couple (compte, titre) -- cf. services/placements.detentions.

    `monnaie_id` est la monnaie de cotation : cours, prix payés et valorisation
    en découlent tous, et un titre ne peut donc s'acheter que depuis un compte
    qui porte cette monnaie.
    """

    __tablename__ = "action"

    id = Column(Integer, primary_key=True, autoincrement=True)
    nom = Column(String, nullable=False, unique=True)
    valeur = Column(Float, nullable=False, default=0.0)
    monnaie_id = Column(Integer, ForeignKey("monnaie.id"), nullable=False)
    # Page publique d'où relire le cours, et date de la dernière lecture RÉUSSIE
    # (migration 0037). Le noyau ne s'en sert jamais : il n'émet aucune requête
    # réseau, c'est l'extension « lecture-de-cours » qui lit ces deux colonnes.
    # Elles vivent ici quand même, comme le reste du schéma des placements, pour
    # que retirer l'extension ne fasse perdre aucun lien.
    #
    # `cours_maj_le` à NULL veut dire « jamais relu en ligne » : c'est le cas de
    # tout titre dont le cours est saisi à la main, et le seul moyen de
    # distinguer un cours frais d'un cours oublié.
    url_cours = Column(String, nullable=True)
    cours_maj_le = Column(DateTime, nullable=True)

    monnaie = relationship("Monnaie")

    __table_args__ = (CheckConstraint("valeur >= 0", name="ck_action_valeur_positive"),)


class OperationAction(Base):
    """Le versant "titres" d'un achat ou d'une vente ; le versant "espèces" est
    une Operation ordinaire de type `action` (cf. constants.TypeOperation),
    référencée ici.

    Deux lignes plutôt qu'une seule table autonome : le mouvement d'espèces
    reste ainsi une opération comme les autres, et le solde du compte, le
    dashboard et les projections continuent de se calculer sans exception. Les
    deux lignes naissent et meurent ensemble (voir
    services/placements.enregistrer_operation_action) ; l'unicité de
    `operation_id` interdit qu'une écriture d'espèces porte deux mouvements de
    titres.

    La quantité détenue n'est stockée nulle part : elle se somme depuis ces
    lignes (+ à l'achat, − à la vente) pour un couple (compte, titre) donné.
    Stocker un solde de titres imposerait de le maintenir à chaque
    création/suppression, avec le risque de dérive que le reste de l'app évite
    déjà en recalculant (cf. crud._recalculer_montant_a_rembourser).
    """

    __tablename__ = "operation_action"

    id = Column(Integer, primary_key=True, autoincrement=True)
    operation_id = Column(
        Integer, ForeignKey("operation.id", ondelete="CASCADE"), nullable=False, unique=True
    )
    action_id = Column(Integer, ForeignKey("action.id"), nullable=False)
    sens = Column(
        Enum(SensAction, native_enum=False, values_callable=_enum_values), nullable=False
    )
    quantite = Column(Float, nullable=False)
    # Prix unitaire réellement payé (achat) ou encaissé (vente) : le montant de
    # l'opération d'espèces en découle (quantite * prix_unitaire), et le prix de
    # revient du portefeuille s'en déduit.
    prix_unitaire = Column(Float, nullable=False)

    operation = relationship("Operation")
    action = relationship("Action")

    __table_args__ = (
        CheckConstraint("quantite > 0", name="ck_operation_action_quantite_positive"),
        CheckConstraint("prix_unitaire >= 0", name="ck_operation_action_prix_positif"),
        CheckConstraint(
            f"sens IN ({_sql_in_list(_enum_values(SensAction))})",
            name="ck_operation_action_sens",
        ),
        Index("ix_operation_action_action_id", "action_id"),
    )


class ImportPreset(Base):
    """Un format de relevé bancaire nommé (typiquement un par banque) : porte
    sa propre configuration de colonnes (quelles colonnes lire, lesquelles
    exclure de la comparaison de doublons). Les mappings catégorie/compte,
    l'historique et le stock de doublons (ci-dessous) sont tous rattachés à un
    preset — deux formats différents ne doivent jamais se comparer entre eux."""

    __tablename__ = "import_preset"

    id = Column(Integer, primary_key=True, autoincrement=True)
    nom = Column(String, nullable=False, unique=True)
    # Compte de l'app auquel ce format de relevé appartient (typiquement : le
    # relevé d'un compte précis, qui ne nomme donc nulle part le compte
    # concerné). Renseigné, il s'impose à TOUTES les lignes du fichier — ni la
    # colonne « compte bancaire » ni les correspondances mémorisées ne sont
    # consultées (cf. services/import_bancaire._resoudre_ligne). Un virement
    # interne n'en reste pas moins correctement orienté : ce compte est déduit
    # émetteur ou récepteur du signe du montant, comme pour un compte résolu par
    # colonne. NULL (défaut) = comportement historique, le compte vient du
    # fichier.
    compte_id = Column(Integer, ForeignKey("compte.id", ondelete="SET NULL"), nullable=True)
    colonnes = Column(JSON, nullable=False)
    # Index de colonnes (1-based, format brut du fichier) désignées pour la
    # comparaison de doublons (voir LigneImportBrute / services.import_bancaire.
    # detecter_doublon). Ce que la liste DÉSIGNE dépend du mode ci-dessous :
    # les colonnes à ignorer, ou les seules à comparer.
    colonnes_comparaison = Column(JSON, nullable=False, default=list)
    # 'exclusion' (défaut, comportement d'avant la migration 0030) = tout est
    # comparé sauf la liste. 'selection' = rien n'est comparé sauf la liste.
    # Cf. constants.ModeComparaison, qui dit pourquoi les deux existent.
    mode_comparaison = Column(
        String, nullable=False, default=ModeComparaison.exclusion.value
    )
    # False (défaut) = la première ligne du fichier est une ligne de données.
    # True = c'est un en-tête, à sauter. Tous les formats ne mettent pas
    # d'en-tête ; le supposer systématiquement faisait perdre une opération à
    # chaque import (voir services.import_bancaire.lire_lignes_brutes).
    ignorer_premiere_ligne = Column(Boolean, nullable=False, default=False)

    # Vocabulaire de la colonne « Sens » DE CETTE BANQUE : ["Débit", "D"…] et
    # ["Crédit", "C"…]. Listes vides (défaut) = on retombe sur
    # constants.LIBELLES_SENS_SORTIE / _ENTREE, qui couvrent le vocabulaire
    # français courant. Un relevé anglophone ou portugais écrit tout autre
    # chose ; l'app ne peut pas le deviner, mais elle n'a pas non plus à le
    # redemander à chaque import — d'où le stockage ici, par preset (c'est un
    # trait du FORMAT, comme les colonnes).
    #
    # Stockées telles que saisies ; la comparaison se fait sur une forme
    # normalisée (minuscules, sans accents ni espaces, cf.
    # services/import_bancaire._normaliser_libelle).
    libelles_sens_sortie = Column(JSON, nullable=False, default=list)
    libelles_sens_entree = Column(JSON, nullable=False, default=list)

    # Même mécanique pour la colonne « État » : le vocabulaire des trois issues
    # possibles d'une ligne (exécutée, en attente, refusée — cf.
    # constants.StatutImport). Listes vides = LIBELLES_STATUT_DEFAUT.
    libelles_statut_execute = Column(JSON, nullable=False, default=list)
    libelles_statut_attente = Column(JSON, nullable=False, default=list)
    libelles_statut_refuse = Column(JSON, nullable=False, default=list)

    # La « configuration avancée » ne se stocke nulle part à part : ses
    # propriétés (compte bancaire, sens, monnaie, montant/monnaie reçus, frais
    # et leur monnaie — cf. constants.PROPRIETES_IMPORT_AVANCEES) sont des
    # colonnes comme les autres, dans `colonnes` ci-dessus. Seul le frontend les
    # présente à part, pour qu'un preset ordinaire n'ait pas à les croiser.
    #
    # Les colonnes supplémentaires nommées et les formules façon tableur, qui
    # portaient auparavant le montant reçu et les frais, ont disparu avec la
    # migration 0026 : ces deux montants ont désormais leur propre propriété.

    compte = relationship("Compte")


class ImportCategorieMapping(Base):
    """Mémorise, une fois pour toutes, à quelle catégorie de dépense renvoie une
    catégorie du relevé bancaire — pour ne pas la redemander à chaque import.
    Scopé par preset : un même nom bancaire peut légitimement correspondre à
    autre chose selon la banque.

    La cible est toujours une catégorie. Entre 0019 et 0022 elle pouvait aussi
    être un TYPE d'opération, mais les quatre types concernés ne portent par
    nature aucune catégorie : les proposer ici mélangeait deux axes. Le type est
    désormais posé exclusivement par les règles de catégorisation, évaluées
    AVANT les correspondances (cf. services/import_bancaire._resoudre_ligne).
    """

    __tablename__ = "import_categorie_mapping"

    id = Column(Integer, primary_key=True, autoincrement=True)
    preset_id = Column(Integer, ForeignKey("import_preset.id", ondelete="CASCADE"), nullable=False)
    nom_banque = Column(String, nullable=False)
    categorie_id = Column(Integer, ForeignKey("categorie.id", ondelete="CASCADE"), nullable=False)

    categorie = relationship("Categorie")

    __table_args__ = (
        UniqueConstraint("preset_id", "nom_banque", name="uq_import_categorie_mapping_preset_nom"),
    )


class ImportCompteMapping(Base):
    """Idem pour les noms de compte du relevé bancaire, scopé par preset."""

    __tablename__ = "import_compte_mapping"

    id = Column(Integer, primary_key=True, autoincrement=True)
    preset_id = Column(Integer, ForeignKey("import_preset.id", ondelete="CASCADE"), nullable=False)
    nom_banque = Column(String, nullable=False)
    compte_id = Column(Integer, ForeignKey("compte.id", ondelete="CASCADE"), nullable=False)

    compte = relationship("Compte")

    __table_args__ = (
        UniqueConstraint("preset_id", "nom_banque", name="uq_import_compte_mapping_preset_nom"),
    )


class ImportMonnaieMapping(Base):
    """Idem pour les devises du relevé, scopé par preset.

    Un fichier écrit « EUR », « USD », « BRL » ; l'app connaît des monnaies
    nommées « Euro », « Dollar »… avec leur symbole. Aucun des deux ne peut se
    déduire de l'autre en général, d'où la même mécanique de correspondance
    mémorisée que pour les catégories et les comptes : l'utilisateur tranche
    une fois, l'app se souvient. C'est la SEULE source de rattachement — même
    un libellé identique au nom d'une monnaie de l'app passe par ici (cf.
    services/import_bancaire._resoudre_monnaie)."""

    __tablename__ = "import_monnaie_mapping"

    id = Column(Integer, primary_key=True, autoincrement=True)
    preset_id = Column(Integer, ForeignKey("import_preset.id", ondelete="CASCADE"), nullable=False)
    nom_banque = Column(String, nullable=False)
    monnaie_id = Column(Integer, ForeignKey("monnaie.id", ondelete="CASCADE"), nullable=False)

    monnaie = relationship("Monnaie")

    __table_args__ = (
        UniqueConstraint("preset_id", "nom_banque", name="uq_import_monnaie_mapping_preset_nom"),
    )


class ImportHistorique(Base):
    """Trace de chaque import confirmé, affichée dans la page Import (pour le preset concerné)."""

    __tablename__ = "import_historique"

    id = Column(Integer, primary_key=True, autoincrement=True)
    preset_id = Column(Integer, ForeignKey("import_preset.id", ondelete="CASCADE"), nullable=False)
    date_import = Column(DateTime, nullable=False)
    nom_fichier = Column(String, nullable=True)
    operations_creees = Column(Integer, nullable=False, default=0)
    lignes_ignorees = Column(Integer, nullable=False, default=0)
    doublons_detectes = Column(Integer, nullable=False, default=0)

    __table_args__ = (Index("ix_import_historique_preset", "preset_id"),)


class LigneImportBrute(Base):
    """Stock centralisé de toutes les lignes déjà importées SOUS UN PRESET
    DONNÉ, dans leur format brut intégral (toutes les colonnes du fichier
    Excel, pas seulement celles mappées par ImportPreset.colonnes) — sert à
    détecter les doublons d'un import à l'autre, mais seulement au sein du
    même preset (voir services.import_bancaire.detecter_doublon). Jamais
    vidée ; une table par preset au sens logique (filtrée par preset_id),
    pas une table SQL par preset."""

    __tablename__ = "ligne_import_brute"

    id = Column(Integer, primary_key=True, autoincrement=True)
    preset_id = Column(Integer, ForeignKey("import_preset.id", ondelete="CASCADE"), nullable=False)
    # {"1": valeur_colonne_1, "2": valeur_colonne_2, ...} — clé = index de
    # colonne (1-based) en string (contrainte JSON), valeurs déjà converties
    # en types JSON-safe (dates en isoformat).
    donnees = Column(JSON, nullable=False)
    import_historique_id = Column(
        Integer, ForeignKey("import_historique.id", ondelete="SET NULL"), nullable=True
    )
    # Opération que cette ligne a créée. Le CASCADE est le cœur du mécanisme :
    # supprimer une opération retire aussi sa ligne du stock anti-doublons,
    # sans quoi le même relevé ne pourrait plus jamais être réimporté après
    # une suppression. Nullable pour les lignes historiques (antérieures à la
    # migration 0016), qui n'ont jamais porté ce lien.
    operation_id = Column(
        Integer, ForeignKey("operation.id", ondelete="CASCADE"), nullable=True
    )
    date_creation = Column(DateTime, nullable=False)

    __table_args__ = (
        Index("ix_ligne_import_brute_preset", "preset_id"),
        Index("ix_ligne_import_brute_historique", "import_historique_id"),
        Index("ix_ligne_import_brute_operation", "operation_id"),
    )


class RegleCategorisation(Base):
    """Classement automatique d'une ligne importée selon ses libellés.

    Globale (pas de preset_id) : les mots-clés visés ("PRET", "REMBOURSEMENT",
    "REMBOURSABLE"...) ne dépendent pas de la banque, une même règle sert donc
    tous les formats. Évaluées dans l'ordre de `ordre`, la première qui
    correspond pose le type (voir services/regles_categorisation) — c'est la
    hiérarchie qui permet de placer les cas particuliers avant les cas
    généraux. Une règle qui ne coche pas `arreter_apres` laisse l'évaluation
    continuer : les suivantes complètent alors ce qu'elle a laissé ouvert,
    sans jamais défaire ce qu'elle a décidé.

    L'action se lit en deux temps, comme dans le reste de l'app : d'abord le
    type d'opération, puis -- seulement pour les types qui l'admettent
    (classique et remboursable) -- la catégorie de dépense. Les quatre autres
    types ne portent aucune catégorie (leur type EST leur classification), donc
    rien à choisir : `categorie_id` reste NULL. `remboursable` n'est plus
    stocké, il se déduit du type.
    """

    __tablename__ = "regle_categorisation"

    id = Column(Integer, primary_key=True, autoincrement=True)
    nom = Column(String, nullable=False)
    ordre = Column(Integer, nullable=False, default=0)
    actif = Column(Boolean, nullable=False, default=True)
    # Faut-il s'arrêter là quand cette règle correspond ? Coché par défaut :
    # c'est le comportement historique (première règle gagnante). Décoché,
    # l'évaluation continue vers le bas, les règles suivantes ne pouvant que
    # compléter ce qui n'a pas encore été décidé.
    arreter_apres = Column(Boolean, nullable=False, default=True)

    # Action appliquée quand la règle correspond : le type d'abord, puis --
    # seulement pour les types à catégorie libre -- la catégorie. FK vers
    # type_operation depuis 0019, pour ne pas garder deux vocabulaires (une
    # chaîne ici, une table là) pour la même notion.
    type_id = Column(Integer, ForeignKey("type_operation.id", ondelete="CASCADE"), nullable=False)
    categorie_id = Column(
        Integer, ForeignKey("categorie.id", ondelete="CASCADE"), nullable=True
    )
    # Le compte EN FACE, uniquement pour le type « virement interne » : un
    # virement décrit deux comptes, et le relevé n'en nomme qu'un. Sans lui, la
    # ligne arrive incomplète dans l'aperçu et bloque l'import jusqu'à une
    # reprise manuelle (cf. services/import_bancaire._erreur_ligne). NULL pour
    # tous les autres types, qui ne touchent qu'un seul compte.
    compte_autre_id = Column(
        Integer, ForeignKey("compte.id", ondelete="SET NULL"), nullable=True
    )

    # {"operateur": "ET"|"OU", "groupes": [
    #     {"operateur": "ET"|"OU", "conditions": [
    #         {"champ": "nature", "operateur": "contient", "valeur": "PRET"}]}]}
    # Deux niveaux : suffisant pour "(A OU B) ET (C OU D)".
    conditions = Column(JSON, nullable=False, default=dict)

    categorie = relationship("Categorie")
    type_operation = relationship("TypeOperationDB")
    compte_autre = relationship("Compte")

    @property
    def type_code(self) -> str:
        """Exposé tel quel par RegleCategorisationRead : évite au frontend de
        recroiser la table des types pour un simple affichage."""
        return self.type_operation.code

    __table_args__ = (
        Index("ix_regle_categorisation_ordre", "ordre"),
        Index("ix_regle_categorisation_compte_autre_id", "compte_autre_id"),
    )


class RemboursementLien(Base):
    """Lie une opération de catégorie 'Remboursements' à la dépense remboursable qu'elle règle."""

    __tablename__ = "remboursement_lien"

    id = Column(Integer, primary_key=True, autoincrement=True)
    operation_remboursement_id = Column(
        Integer, ForeignKey("operation.id", ondelete="CASCADE"), nullable=False
    )
    operation_depense_id = Column(
        Integer, ForeignKey("operation.id", ondelete="CASCADE"), nullable=False
    )
    # Montant réellement transféré pour CE lien (permet un remboursement partiel :
    # plusieurs remboursements peuvent couvrir des portions d'une même dépense).
    montant = Column(Float, nullable=False, default=0.0)

    __table_args__ = (
        UniqueConstraint(
            "operation_remboursement_id",
            "operation_depense_id",
            name="uq_remboursement_lien",
        ),
        Index("ix_remboursement_lien_remboursement", "operation_remboursement_id"),
        Index("ix_remboursement_lien_depense", "operation_depense_id"),
    )


class NoteDashboard(Base):
    """Bloc-notes libre du dashboard : une seule ligne pour toute la base.

    Aucune sémantique — l'app ne le lit jamais, ne le filtre pas, ne l'additionne
    pas. C'est l'endroit pour ce qu'aucun champ ne porte : « vérifier le
    prélèvement EDF », « relancer Marie pour les 40 € ».

    La ligne est créée à la demande (cf. crud.set_note_dashboard) plutôt que
    semée par la migration : une base fraîche n'a rien à dire, et une note vide
    n'est pas une note.
    """

    __tablename__ = "note_dashboard"

    id = Column(Integer, primary_key=True, autoincrement=True)
    contenu = Column(Text, nullable=False, default="")
    modifie_le = Column(DateTime, nullable=True)
