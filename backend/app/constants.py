import enum


class Sens(str, enum.Enum):
    depense = "dépense"
    entree = "entrée"
    transfert_sortant = "transfert_sortant"
    transfert_entrant = "transfert_entrant"


class Statut(str, enum.Enum):
    reel = "réel"
    previsionnel = "prévisionnel"


class Frequence(str, enum.Enum):
    hebdomadaire = "hebdomadaire"
    mensuelle = "mensuelle"
    trimestrielle = "trimestrielle"
    annuelle = "annuelle"


# Catégories créées par défaut (seed de la migration). L'utilisateur peut en
# ajouter/supprimer d'autres depuis l'onglet Catégories ; celles listées ici avec
# systeme=True sont protégées (gérées automatiquement par l'application).
# Catégories de dépense créées au premier lancement. Depuis la migration 0019
# elles ne contiennent plus que de vraies catégories : les quatre anciennes
# "catégories système" (Remboursements, Virement interne, Prêts, Remboursement
# prêts) sont devenues des TYPES d'opération (voir TypeOperation ci-dessous).
CATEGORIES_INITIALES = [
    "Alimentaire",
    "Loisirs & sorties",
    "Charges fixes",
    "Réparation & entretien",
    "Vêtements & équipement sport",
    "Autres",
    "Entrées d'argent",
]

CATEGORIE_ENTREES_ARGENT = "Entrées d'argent"
# "Autres" est protégée : non supprimable, et sert de repli pour les opérations
# dont la catégorie a été supprimée.
CATEGORIE_AUTRES = "Autres"
# Seule catégorie dont le sens est "entrée" ; les autres entrées d'argent
# (remboursement reçu, prêt reçu) sont désormais portées par le TYPE.
CATEGORIES_SENS_ENTREE = {CATEGORIE_ENTREES_ARGENT}


# ---------- Monnaies ----------
# L'app ne connaît aucun taux de change et n'additionne JAMAIS deux monnaies :
# tout ce qui agrège (solde d'un compte, KPI du dashboard, budget d'une
# catégorie, valorisation d'un portefeuille) est calculé séparément par
# monnaie. C'est le parti pris qui évite d'inventer une conversion que
# l'utilisateur devrait ensuite corriger à la main.
#
# Une seule monnaie est créée par la migration 0021, pour rattacher les données
# existantes (qui étaient toutes implicitement en euros) ; toutes les autres
# sont créées par l'utilisateur depuis Paramètres > Monnaies.
MONNAIE_INITIALE_NOM = "Euro"
MONNAIE_INITIALE_SYMBOLE = "€"


class TypeOperation(str, enum.Enum):
    """Les familles d'opérations, telles que stockées dans `type_operation`.

    Ces valeurs sont les `code` de la table : des clés techniques stables sur
    lesquelles repose toute la logique métier. Le libellé affiché (`nom`) est
    renommable par l'utilisateur et ne doit jamais servir de test.
    """

    classique = "classique"
    remboursable = "remboursable"
    remboursements = "remboursements"
    virement = "virement"
    pret = "pret"
    remboursement_pret = "remboursement_pret"
    # Mouvement d'espèces d'un achat ou d'une vente de titres. Type "interne"
    # (cf. TYPES_INTERNES) : il n'est jamais choisi à la main, il naît toujours
    # avec sa ligne OperationAction depuis la page Placements financiers.
    action = "action"


# Libellés initiaux, posés par la migration puis modifiables par l'utilisateur.
NOMS_TYPES_INITIAUX = {
    TypeOperation.classique: "Opération classique",
    TypeOperation.remboursable: "Dépense remboursable",
    TypeOperation.remboursements: "Remboursement reçu",
    TypeOperation.pret: "Prêt reçu",
    TypeOperation.remboursement_pret: "Remboursement prêt",
    TypeOperation.virement: "Virement interne",
    TypeOperation.action: "Achat / vente de titres",
}

# Ordre d'affichage (onglets de la page Opérations).
ORDRE_TYPES = [
    TypeOperation.classique,
    TypeOperation.remboursable,
    TypeOperation.remboursements,
    TypeOperation.virement,
    TypeOperation.pret,
    TypeOperation.remboursement_pret,
    TypeOperation.action,
]

# Types gérés exclusivement par une page dédiée : jamais proposés dans le
# formulaire d'opération, l'éditeur de règles, les correspondances d'import ni
# les onglets de la page Opérations, et refusés par les endpoints génériques
# /operations. Ils existent quand même dans `type_operation` pour que le sens,
# le solde et les agrégats du dashboard se calculent comme pour n'importe
# quelle opération.
TYPES_INTERNES = {TypeOperation.action}

# Les deux seuls types qui acceptent une catégorie de dépense. Les quatre
# autres n'en portent aucune : leur type EST leur classification.
TYPES_AVEC_CATEGORIE_LIBRE = {TypeOperation.classique, TypeOperation.remboursable}

# Types dont l'opération est remboursable — exactement les deux cas où la
# colonne booléenne `remboursable` valait 1 avant la migration 0019.
TYPES_REMBOURSABLES = {TypeOperation.remboursable, TypeOperation.pret}

# Types qui règlent une dette (jamais eux-mêmes remboursables), et la cible
# qu'ils ont le droit de régler : un remboursement reçu solde une dépense
# remboursable, un remboursement de prêt solde un prêt reçu.
CIBLE_PAR_TYPE_REGLEMENT = {
    TypeOperation.remboursements: TypeOperation.remboursable,
    TypeOperation.remboursement_pret: TypeOperation.pret,
}
TYPES_REGLEMENT = set(CIBLE_PAR_TYPE_REGLEMENT)

# Types dont le sens est "entrée" (argent qui rentre), indépendamment de toute
# catégorie.
TYPES_SENS_ENTREE = {TypeOperation.remboursements, TypeOperation.pret}

# Types de comptes créés par défaut (seed de la migration), protégés (systeme=True) :
# ils pilotent des règles métier (dashboard, virements réservés à l'épargne) et ne
# sont donc jamais supprimables. L'utilisateur peut en ajouter d'autres librement
# depuis la page Comptes (purement organisationnels, ceux-là supprimables).
TYPE_COMPTE_COURANT = "courant"
TYPE_COMPTE_EPARGNE = "épargne"
# Compte-titres : deux soldes à la fois, des espèces (alimentées par virement
# interne, dépensées à l'achat de titres) et un portefeuille de titres détenus
# (cf. models.Action / models.OperationAction, page Placements financiers).
TYPE_COMPTE_PLACEMENT = "placements financiers"
TYPES_COMPTE_INITIAUX = [TYPE_COMPTE_COURANT, TYPE_COMPTE_EPARGNE, TYPE_COMPTE_PLACEMENT]
TYPES_COMPTE_SYSTEME = {TYPE_COMPTE_COURANT, TYPE_COMPTE_EPARGNE, TYPE_COMPTE_PLACEMENT}
# Comptes hors "budget courant" : ils ne reçoivent pas d'opérations classiques
# (uniquement des virements internes, plus des opérations sur titres pour les
# comptes de placement) et sont donc exclus des KPI courants du dashboard.
TYPES_COMPTE_HORS_COURANT = {TYPE_COMPTE_EPARGNE, TYPE_COMPTE_PLACEMENT}


class SensAction(str, enum.Enum):
    """Direction d'une opération sur titres. Source de vérité du couple
    (OperationAction, Operation) : le sens de l'écriture d'espèces en découle
    (achat -> transfert_sortant, vente -> transfert_entrant)."""

    achat = "achat"
    vente = "vente"

# Propriétés de l'app qu'une colonne du fichier d'import peut représenter, et
# configuration par défaut (format d'export bancaire historique à 12 colonnes).
#
# Les propriétés « de base » sont celles que tout relevé porte : une date, un
# libellé, un montant, éventuellement une catégorie bancaire. Elles se
# configurent dans « Configuration du fichier ».
PROPRIETES_IMPORT_BASE = {
    "date",
    "nature",
    "categorie_banque",
    "montant",
}

# Propriétés de la « configuration avancée ». Elles répondent toutes à la même
# question : qu'est-ce que cette ligne ne dit pas d'elle-même ?
#
#  - `compte_banque` : le compte visé, quand le fichier le nomme ligne par
#    ligne (un preset lié à un compte n'en a pas besoin) ;
#  - `sens` : le signe du montant, pour les relevés qui n'écrivent QUE des
#    montants positifs et portent « Débit »/« Crédit » dans une colonne à part
#    (cf. services/import_bancaire._signe_depuis_sens). Sans elle, le signe du
#    montant fait foi ;
#  - `monnaie` : devise du montant. Sans elle, une ligne est libellée dans la
#    monnaie principale de son compte, ce qui est faux dès qu'un compte en
#    porte plusieurs ;
#  - `montant_initial` / `monnaie_initiale` (affichés « Montant envoyé » /
#    « Monnaie envoyée ») : ce qui PART, avant frais et avant
#    conversion. `montant` (obligatoire) décrit alors ce qui arrive. L'app ne
#    connaît aucun taux de change : seul le relevé peut donner les deux ;
#  - `frais` / `monnaie_frais` : les frais prélevés par la banque. Ils
#    s'ajoutent au montant envoyé, ou se retranchent du montant, selon la
#    devise dans laquelle ils sont libellés (cf. services/import_bancaire.
#    _appliquer_frais) — c'est la seule combinaison de montants que l'app fait
#    d'elle-même, et elle n'est possible que parce que les monnaies sont lues.
#  - `montant_debit` / `montant_credit` : le montant, quand le relevé le SCINDE
#    en deux colonnes au lieu de le signer. Une ligne n'en remplit qu'une, et
#    laquelle vaut exactement ce que dirait une colonne « Sens » — d'où le même
#    traitement : le signe rejoint `montant_signe`, et tout l'aval continue de
#    raisonner dessus (cf. services/import_bancaire._montant_scinde). Ce couple
#    REMPLACE `montant`, il ne s'y ajoute pas.
#
# Ces quatre dernières remplacent le couple « colonnes supplémentaires nommées +
# formules façon tableur » qui les portait avant : le calcul libre pouvait tout
# exprimer, au prix d'une configuration que plus personne ne relisait. Une
# propriété par montant, plus une par devise, couvre les cas réels (Wise en
# tête) sans demander d'écrire quoi que ce soit.
#  - `statut` : où en est l'opération chez la banque — exécutée, en attente, ou
#    refusée/annulée (cf. StatutImport ci-dessous). Une ligne en attente devient
#    une opération prévisionnelle ; une ligne refusée n'est pas importée du tout.
PROPRIETES_IMPORT_AVANCEES = {
    "compte_banque",
    "sens",
    "monnaie",
    # Ces deux clés-là ne suivent PAS le renommage `montant_initial` ->
    # `montant_envoye` fait ailleurs : elles sont écrites telles quelles dans
    # ImportPreset.colonnes (JSON), donc dans la base. Les changer demanderait
    # une migration des presets existants pour un gain purement cosmétique —
    # personne ne les lit, seuls leurs libellés d'écran sont visibles (« Montant
    # envoyé », « Monnaie envoyée », cf. LIBELLES_PROPRIETES_IMPORT côté
    # frontend).
    "montant_initial",
    "monnaie_initiale",
    "frais",
    "monnaie_frais",
    "statut",
    "montant_debit",
    "montant_credit",
}
PROPRIETES_IMPORT_VALIDES = PROPRIETES_IMPORT_BASE | PROPRIETES_IMPORT_AVANCEES

# Le montant scindé en deux colonnes, l'une pour ce qui sort, l'autre pour ce
# qui entre. Les deux vont ensemble : n'en lire qu'une reviendrait à perdre
# toutes les lignes de l'autre côté (cf. routers/import_bancaire.
# _valider_configuration).
PROPRIETES_MONTANT_SCINDE = ("montant_debit", "montant_credit")

# `montant` n'y figure pas : il est obligatoire SAUF quand le couple
# débit/crédit le remplace, ce qu'un simple ensemble ne sait pas dire. La règle
# complète est dans routers/import_bancaire._valider_configuration.
PROPRIETES_IMPORT_OBLIGATOIRES = {"date", "nature"}

# Propriétés de montant de la configuration avancée, et la propriété de devise
# qui les qualifie : lire l'une sans l'autre n'est pas une erreur (la devise
# retombe sur celle du montant d'émission), mais mérite un avertissement à
# l'import — cf. services/import_bancaire.avertissements_configuration.
DEVISE_PAR_MONTANT_AVANCE = {
    "montant_initial": "monnaie_initiale",
    "frais": "monnaie_frais",
}

COLONNES_IMPORT_PAR_DEFAUT = [
    {"index": 1, "propriete": "date"},
    {"index": 4, "propriete": "nature"},
    {"index": 6, "propriete": "categorie_banque"},
    {"index": 7, "propriete": "montant"},
    {"index": 10, "propriete": "compte_banque"},
]


class ModeComparaison(str, enum.Enum):
    """Comment ImportPreset.colonnes_comparaison est lu par la détection de
    doublons (cf. services/import_bancaire.detecter_doublon).

    Les deux modes disent la même chose par les deux bouts, et selon le relevé
    l'un est bien plus court à décrire que l'autre :

     - `exclusion` : tout est comparé SAUF les colonnes listées. Le défaut, et
       le seul comportement qui existait jusqu'à la migration 0030. Convient
       quand une ou deux colonnes seulement bougent d'un export à l'autre
       (solde courant, référence interne, date de valeur) ;
     - `selection` : RIEN n'est comparé sauf les colonnes listées. Convient au
       cas inverse — un relevé large dont on sait que la date, le libellé et le
       montant suffisent à identifier une ligne, sans avoir à recenser les
       douze autres colonnes.

    Une liste vide n'a donc pas le même sens des deux côtés : en `exclusion`
    elle compare tout, en `selection` elle ne comparerait rien — ce qui ferait
    de chaque ligne le doublon de la première. Ce cas est refusé à
    l'enregistrement (routers/import_bancaire) et neutralisé par sécurité dans
    le détecteur.
    """

    exclusion = "exclusion"
    selection = "selection"


# ---------- Colonne « Sens » ----------
# Ce qu'un relevé écrit pour dire qu'une ligne est une sortie ou une entrée,
# quand il n'écrit que des montants positifs. Comparé après passage en
# minuscules, sans accents ni espaces (cf. services/import_bancaire.
# _signe_depuis_sens) : « Débit », « DEBIT » et « débit » sont donc le même
# libellé.
#
# Ce ne sont que les valeurs PAR DÉFAUT : depuis la migration 0027, chaque
# preset peut déclarer son propre vocabulaire (ImportPreset.libelles_sens_*),
# pour les relevés qui n'écrivent pas en français. Ces listes-ci s'appliquent
# tant qu'un preset n'en définit aucune.
#
# Liste fermée, volontairement : un libellé inconnu met la ligne en erreur avec
# la liste des valeurs acceptées, plutôt que de deviner un sens au hasard — se
# tromper ici inverse une opération dans tous les soldes.
LIBELLES_SENS_SORTIE = {
    "d",
    "db",
    "dr",
    "debit",
    "sortie",
    "sortant",
    "retrait",
    "paiement",
    "-",
}
LIBELLES_SENS_ENTREE = {
    "c",
    "cr",
    "credit",
    "entree",
    "entrant",
    "depot",
    "versement",
    "recette",
    "+",
}


# ---------- Colonne « État » ----------
class StatutImport(str, enum.Enum):
    """Où en est une ligne du relevé chez la banque.

    Trois issues seulement, et chacune donne un traitement différent :

     - `execute` : l'argent a bougé. C'est le cas ordinaire, et le seul que
       l'app supposait jusqu'ici pour toute ligne importée (opération réelle) ;
     - `attente` : autorisation prise, opération pas encore passée. Elle devient
       une opération PRÉVISIONNELLE — le montant est connu, la date de
       comptabilisation non. C'est exactement ce que `Statut.previsionnel`
       décrit déjà pour une opération saisie à la main ;
     - `refuse` : paiement refusé, virement annulé. Rien n'a bougé et rien ne
       bougera : la ligne n'est pas importée DU TOUT, et n'entre pas non plus au
       stock anti-doublons (cf. services/import_bancaire.confirmer). L'y mettre
       ferait disparaître la ligne d'un prochain import alors qu'aucune
       opération ne la représente.
    """

    execute = "execute"
    attente = "attente"
    refuse = "refuse"


# Vocabulaire par défaut de la colonne « État », même mécanique que pour le sens
# (comparaison normalisée, et chaque preset peut déclarer le sien via
# ImportPreset.libelles_statut_*). Les espaces disparaissent à la
# normalisation : « en attente » s'écrit donc « enattente » ici.
LIBELLES_STATUT_DEFAUT = {
    StatutImport.execute: {
        "execute",
        "executee",
        "effectue",
        "effectuee",
        "realise",
        "realisee",
        "comptabilise",
        "comptabilisee",
        "valide",
        "validee",
        "termine",
        "terminee",
        "ok",
    },
    StatutImport.attente: {
        "enattente",
        "attente",
        "encours",
        "pending",
        "autorisation",
        "provisoire",
        "noncomptabilise",
    },
    StatutImport.refuse: {
        "refuse",
        "refusee",
        "rejete",
        "rejetee",
        "annule",
        "annulee",
        "echec",
        "cancelled",
        "declined",
    },
}


# ---------- Règles de catégorisation ----------
# Classement automatique des lignes importées (voir
# services/regles_categorisation.py). Les règles sont globales : les mots-clés
# visés ("PRET", "REMBOURSEMENT"...) ne dépendent pas de la banque, une seule
# règle sert donc tous les presets.


class OperateurRegle(str, enum.Enum):
    est = "est"
    nest_pas = "n'est pas"
    contient = "contient"
    ne_contient_pas = "ne contient pas"


class ConnecteurRegle(str, enum.Enum):
    """Comment combiner plusieurs conditions (dans un groupe) ou plusieurs
    groupes (dans une règle) — équivalent des filtres Notion."""

    et = "ET"
    ou = "OU"


# Champs comparables : uniquement du texte issu du relevé. Les opérateurs
# disponibles sont tous textuels ; comparer un montant demanderait des
# opérateurs numériques (<, >) qui n'existent pas ici.
CHAMPS_REGLE_VALIDES = {"nature", "categorie_banque", "compte_banque"}
