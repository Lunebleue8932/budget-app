"""Import d'une liste d'opérations exportée depuis un compte de placements.

CALQUÉ SUR L'IMPORT BANCAIRE, ET LITTÉRALEMENT. Tout ce qui ne dépend pas des
colonnes lues est repris de `app.services.import_bancaire` plutôt que récrit :
la lecture du fichier (xlsx ou CSV, délimiteur détecté, encodage replié), le
parsing des dates et des montants, la normalisation du vocabulaire, l'aperçu
« le fichier tel qu'il est », et surtout la DÉTECTION DE DOUBLONS — dont la
version « lignes brutes » est déjà parfaitement générique (elle compare des
index de colonne, elle ne sait rien du sens des données).

Ce module n'ajoute donc qu'une chose : ce qu'une ligne de relevé de
compte-titres VEUT DIRE.

LES SEPT COLONNES (cf. constants.PROPRIETES_IMPORT_PLACEMENT)

  date, type_placement, nom_valeur, code_isin, montant, quantite, cours

`nom_valeur` et `code_isin` sont facultatifs séparément mais pas ensemble : sans
l'un des deux, aucune ligne d'achat ou de vente ne pourrait désigner de titre.
Le routeur refuse la configuration qui les éteindrait tous les deux, et l'écran
empêche le geste en amont. `cours` est le seul facultatif sans condition.

TROIS TYPES DE LIGNE, TROIS TRAITEMENTS

  - `achat` / `vente` : un mouvement de titres. Il crée le couple habituel
    (OperationAction + Operation de type `action`) par crud.create_operation_action,
    exactement comme la page Placements le fait à la main ;
  - `transfert` : un mouvement d'ESPÈCES entre ce compte-titres et un autre
    compte (l'alimentation d'un PEA, un retrait vers le compte courant). Aucun
    titre n'y bouge : c'est un virement interne ordinaire, créé par
    crud.create_virement — les deux mêmes jambes liées par `virement_id` qu'un
    virement saisi à la main.

Le fichier ne décrit qu'un côté du transfert (c'est le relevé d'UN compte) :
le second se renseigne dans l'aperçu, et le SIGNE du montant dit lequel des
deux est l'émetteur — négatif, le compte-titres émet ; positif, il reçoit.
C'est mot pour mot la règle de l'import bancaire, et pour la même raison.

POURQUOI LE TRANSFERT COMPTE AUTANT. Un virement interne se décrit deux fois :
une fois par le relevé du compte-titres, une fois par celui du compte courant.
Comme les deux finissent en `Operation` liées par un `virement_id`, la
détection de doublons de virements du noyau
(import_bancaire.detecter_doublons_virements) les rapproche NATIVEMENT, quelle
que soit leur provenance — importés d'ici, importés d'un relevé bancaire, ou
saisis à la main. Rien de particulier n'a eu à être écrit pour cela : c'est le
bénéfice d'avoir fait un vrai virement plutôt qu'une écriture à part.

LE MONTANT FAIT FOI, PAS LE COURS

Un relevé donne le montant, la quantité, et souvent le cours — et les trois ne
concordent pas : les frais de courtage et les arrondis passent par là. Le prix
unitaire retenu est donc `montant / quantité`, jamais le cours lu :

  - le solde du compte colle alors au centime à ce que le relevé annonce, ce
    qui est la seule chose qu'on ne peut pas se permettre de perdre ;
  - les frais de courtage entrent dans le prix de revient, ce qui est
    exactement ce qu'on veut d'un prix de revient.

Le cours lu sert de CONTRÔLE : au-delà de constants.ECART_COURS_TOLERE d'écart
relatif, la ligne porte un avertissement dans l'aperçu (jamais une erreur — le
relevé a toujours raison sur ce qui a réellement quitté le compte, et un écart
signale au pire une colonne mal configurée, que l'aperçu du fichier montre).

LES TITRES INCONNUS SONT CRÉÉS

Un titre est rapproché par son ISIN d'abord, par son nom ensuite. L'ISIN
d'abord parce que c'est la seule dénomination qui ne change jamais : un émetteur
renomme son ETF, une fusion rebaptise une action, et deux courtiers n'écrivent
presque jamais le même nom pour la même ligne.

Rien trouvé, mais un nom ou un ISIN renseigné ? Le titre est CRÉÉ à la
confirmation, avec les deux dénominations que le fichier porte. Sa monnaie de
cotation est la monnaie principale du compte de placements : c'est la règle du
noyau qui l'impose (un titre ne s'achète que depuis un compte qui porte sa
monnaie, cf. extensions/placements/routeur_placements), et le fichier ne dit
rien de la devise.

Rapproché par le NOM alors que le titre en base n'a pas d'ISIN ? Celui du
fichier le complète. L'inverse — un ISIN en base différent de celui du fichier
pour le même nom — met la ligne en erreur : deux valeurs distinctes portent le
même nom chez ce courtier, et deviner laquelle mélangerait deux portefeuilles.

CE QUI N'EST PAS ICI. Aucune table, aucune migration : le domaine du preset
(`ImportPreset.domaine`), le vocabulaire des trois types et `Action.code_isin`
vivent tous dans le noyau, posés par la migration 0041. Éteindre cette
extension ne fait donc perdre ni un preset, ni un historique, ni une ligne du
stock anti-doublons — tout revient intact à la réactivation.
"""
from datetime import date as date_type
from typing import Optional

from app import crud, models, schemas
from app.constants import (
    ECART_COURS_TOLERE,
    LIBELLES_TYPE_PLACEMENT_DEFAUT,
    ModeLecturePlacement,
    SensAction,
    Statut,
    TypeOperationPlacement,
)
from app.services import import_bancaire, placements, regles_categorisation

from schemas_import_placements import (
    ApercuPlacements,
    LignePlacement,
    LignePlacementOverride,
    OverridesPlacements,
    ResultatPlacements,
)

# Propriété de l'app -> clé du dict de ligne brute produit par
# import_bancaire.lire_lignes_brutes, à qui cette table est passée. Pendant
# exact de son `_PROPRIETE_VERS_CLE`, pour l'autre domaine.
PROPRIETE_VERS_CLE = {
    "date": "date_brute",
    "type_placement": "type_brut",
    "nom_valeur": "nom_valeur_brut",
    "code_isin": "code_isin_brut",
    "montant": "montant_brut",
    "quantite": "quantite_brute",
    "cours": "cours_brut",
    "type_titre": "type_titre_brut",
}

# Pendant de PROPRIETE_VERS_CLE pour une PHOTOGRAPHIE de compte. Les deux jeux
# de colonnes ne se recouvrent qu'à moitié (le titre, la quantité) : une photo
# n'a ni date ni type d'opération, et porte en revanche un prix de revient et
# une valorisation que la liste d'opérations ignore.
PROPRIETE_VERS_CLE_POSITION = {
    "nom_valeur": "nom_valeur_brut",
    "code_isin": "code_isin_brut",
    "quantite": "quantite_brute",
    "prix_revient": "prix_revient_brut",
    "valeur_totale": "valeur_totale_brute",
    "type_titre": "type_titre_brut",
}


def mode_lecture(preset) -> ModeLecturePlacement:
    """Ce que le fichier de ce preset raconte. NULL en base vaut « operations » :
    c'est ce que sont tous les presets antérieurs à la migration 0046, et le seul
    mode qui existait."""
    try:
        return ModeLecturePlacement(preset.mode_lecture or ModeLecturePlacement.operations.value)
    except ValueError:
        # Donnée corrompue : on lit comme avant plutôt que de refuser le fichier.
        return ModeLecturePlacement.operations


def lit_une_position(preset) -> bool:
    return mode_lecture(preset) is ModeLecturePlacement.position


# Champ de ImportPreset portant le vocabulaire de chaque type.
_CHAMP_LIBELLES_TYPE = {
    TypeOperationPlacement.achat: "libelles_type_achat",
    TypeOperationPlacement.vente: "libelles_type_vente",
    TypeOperationPlacement.transfert: "libelles_type_transfert",
}


def vocabulaire_type(preset) -> dict[TypeOperationPlacement, set[str]]:
    """Les mots-clés reconnus pour chacun des trois types, sous leur forme
    normalisée.

    Même mécanique que `import_bancaire.vocabulaire_sens` : le preset déclare
    le vocabulaire de SON courtier, et une liste vide retombe sur celui du code
    (LIBELLES_TYPE_PLACEMENT_DEFAUT). Chaque courtier écrit le sien, et un
    relevé anglophone n'a aucune raison de dire « Achat ».

    Le repli est décidé liste par liste et non en bloc : un preset qui ne
    précise QUE son vocabulaire de transfert (parce que son courtier écrit
    « Apport de fonds ») garde les mots par défaut pour l'achat et la vente,
    plutôt que de devoir les recopier pour ne rien perdre.
    """
    vocabulaire = {}
    for type_placement, champ in _CHAMP_LIBELLES_TYPE.items():
        libelles = getattr(preset, champ, None) or []
        vocabulaire[type_placement] = (
            {import_bancaire.normaliser_libelle(libelle) for libelle in libelles if libelle}
            or LIBELLES_TYPE_PLACEMENT_DEFAUT[type_placement]
        )
    return vocabulaire


def _type_depuis_libelle(
    libelle: str, vocabulaire: dict[TypeOperationPlacement, set[str]]
) -> Optional[TypeOperationPlacement]:
    """Le type que ce libellé désigne, ou None s'il n'en désigne aucun.

    UN MOT-CLÉ EST CONTENU DANS LE LIBELLÉ, il ne lui est plus égal. Beaucoup de
    courtiers écrivent une phrase par ligne — « ACHAT COMPTANT ETF MSCI WORLD »,
    avec le nom du titre dedans : il n'y a alors pas deux fois le même libellé
    dans tout le fichier, et une comparaison exacte ne reconnaissait rien. La
    comparaison porte sur la forme normalisée des deux côtés (sans casse, sans
    accents, sans espaces), c'est donc bien « achatcomptantetf » qui contient
    « achat ».

    LE MOT-CLÉ LE PLUS LONG GAGNE. Un libellé peut contenir deux mots-clés de
    deux listes différentes — « VENTE POUR ACHAT DE PARTS » —, et le premier
    trouvé dépendrait alors de l'ordre du dictionnaire, c'est-à-dire de rien.
    Le plus long est le plus précis, et c'est le seul départage qui ne soit pas
    arbitraire.

    UNE ÉGALITÉ ENTRE DEUX TYPES NE TRANCHE PAS : la ligne part en erreur, avec
    son libellé, plutôt que d'être rangée à pile ou face. Se tromper ici ne
    coûte pas un centime de travers, mais une position entière à l'envers.
    """
    normalise = import_bancaire.normaliser_libelle(libelle)
    if not normalise:
        return None

    meilleur_type, meilleure_longueur, ambigu = None, 0, False
    for type_placement, libelles in vocabulaire.items():
        for mot in libelles:
            # Un mot-clé vide serait contenu dans n'importe quoi. Le
            # nettoyage du preset les écarte déjà ; la garde reste, parce
            # qu'un vocabulaire par défaut mal écrit ne doit pas ranger tout
            # le fichier dans un même type.
            if not mot or mot not in normalise:
                continue
            if len(mot) > meilleure_longueur:
                meilleur_type, meilleure_longueur, ambigu = type_placement, len(mot), False
            elif len(mot) == meilleure_longueur and type_placement is not meilleur_type:
                ambigu = True
    return None if ambigu else meilleur_type


def _type_de_la_ligne(contexte, brute: dict, libelle_type: str) -> tuple:
    """Ce que la ligne décrit : les RÈGLES d'abord, le vocabulaire du preset
    ensuite.

    Les deux mécanismes répondent à la même question et ne se gênent pas :

     - une RÈGLE est une phrase écrite à la main (« le type contient ACHAT »),
       et elle mord sur un libellé quelconque — celui d'un courtier qui écrit
       « ACHAT COMPTANT ETF MSCI WORLD », où le nom du titre change à chaque
       ligne, et qu'aucune liste fermée ne peut reconnaître ;
     - le VOCABULAIRE compare des libellés entiers, preset par preset. C'est le
       plus simple quand le courtier écrit un mot, et c'est le comportement
       d'origine.

    LES RÈGLES PASSENT DEVANT, comme côté bancaire où elles précèdent les
    correspondances mémorisées : ce qu'on a écrit explicitement l'emporte sur ce
    qui est reconnu par ressemblance. Une base sans aucune règle se comporte donc
    exactement comme avant qu'elles existent.

    Rend (type, compte en face, type de titre). Les deux derniers ne sont jamais
    donnés par le vocabulaire — seule une règle peut les poser, et le compte en
    face seulement sur un transfert.
    """
    depuis_regles = regles_categorisation.appliquer_regles_placement(
        contexte.regles, brute
    )
    if depuis_regles is not None:
        # La valeur vient de la base : une donnée corrompue (type inconnu) ne
        # doit pas faire échouer tout l'import, la ligne retombe simplement sur
        # le vocabulaire.
        try:
            return (
                TypeOperationPlacement(depuis_regles.type_placement),
                depuis_regles.compte_autre_id,
                depuis_regles.type_titre_id,
            )
        except ValueError:
            pass
    return _type_depuis_libelle(libelle_type, contexte.vocabulaire), None, None


def _type_titre_de_la_ligne(contexte, brute: dict, type_titre_id_regle):
    """L'étiquette à poser sur le titre que cette ligne désigne.

    DEUX SOURCES, ET LA RÈGLE PASSE DEVANT — comme partout ailleurs dans cet
    import : ce que l'utilisateur a écrit explicitement l'emporte sur ce que le
    fichier raconte. Une règle nomme un type déjà en base ; une colonne écrit un
    libellé, qui peut être nouveau.

    Rend (libellé à afficher, identifiant du type en base ou None). Un libellé
    sans identifiant veut dire « ce type n'existe pas encore » : il sera CRÉÉ à
    la confirmation, jamais à l'aperçu — un aperçu qu'on abandonne ne doit rien
    laisser derrière lui.

    POURQUOI CRÉER PLUTÔT QUE REFUSER. Un type de titre n'est qu'une étiquette :
    aucun montant, aucun solde, aucune valorisation n'en dépend (cf.
    models.TypeTitre). Une colonne qu'on lit et qu'on jetterait au motif que le
    libellé est inconnu perdrait de l'information sans rien protéger, et
    obligerait à saisir à la main les mêmes mots que le fichier porte déjà.
    """
    if type_titre_id_regle:
        type_titre = contexte.types_titre_par_id.get(type_titre_id_regle)
        # Le type a pu être supprimé depuis que la règle a été écrite : la
        # colonne est en SET NULL, mais une session déjà chargée peut porter
        # l'ancien identifiant. On ne type alors rien plutôt que de pointer sur
        # une ligne disparue.
        if type_titre is not None:
            return type_titre.nom, type_titre.id

    libelle = _texte(brute["type_titre_brut"])
    if not libelle:
        return "", None
    connu = contexte.types_titre_par_nom.get(import_bancaire.normaliser_libelle(libelle))
    # Le libellé DE LA BASE quand il est connu, celui du fichier sinon : deux
    # relevés qui écrivent « ETF » et « Etf » doivent tomber sur la même
    # étiquette, et c'est celle qu'on a nommée qui s'affiche.
    return (connu.nom if connu else libelle), (connu.id if connu else None)


class ContextePresetPlacement:
    """Tout ce qu'un preset apporte à la résolution d'une ligne, calculé UNE
    fois pour tout le fichier.

    Pendant de `import_bancaire.ContextePreset`, et pour la même raison : sans
    lui, chaque ligne rechargeait le vocabulaire, la liste des titres et le
    compte visé — soit quelques milliers de requêtes pour un relevé annuel.
    """

    def __init__(
        self,
        db,
        preset,
        compte_id_defaut=None,
        separateur_decimal=None,
        date_position=None,
    ):
        self.db = db
        self.preset = preset
        self.separateur_decimal = separateur_decimal
        # Ce que le fichier raconte : une liste d'opérations, ou une
        # photographie du compte. Lu UNE fois — chaque ligne s'y réfère.
        self.mode = mode_lecture(preset)
        # La date de la photo, choisie à l'import : un relevé de position ne dit
        # pas quand il a été pris. Sans objet pour une liste d'opérations, qui
        # date chaque ligne elle-même.
        self.date_position = date_position
        self.vocabulaire = vocabulaire_type(preset)
        # Chargées UNE fois pour tout le fichier, comme le vocabulaire : un
        # relevé annuel fait quelques milliers de lignes, et les relire à chaque
        # ligne coûterait autant de requêtes. Elles sont GLOBALES (pas de
        # preset_id, cf. models.RegleImportPlacement).
        self.regles = crud.list_regles_import_placement(db)
        # Les étiquettes de titre, indexées deux fois : par identifiant pour ce
        # qu'une règle désigne, par libellé normalisé pour ce qu'une colonne
        # écrit. Chargées UNE fois comme le reste — un relevé annuel poserait
        # sinon une requête par ligne pour un mot.
        types_titre = crud.get_types_titre(db)
        self.types_titre_par_id = {t.id: t for t in types_titre}
        self.types_titre_par_nom = {
            import_bancaire.normaliser_libelle(t.nom): t for t in types_titre
        }
        # Le compte du preset s'impose, comme côté bancaire ; sinon celui
        # choisi pour ce fichier. Un relevé de compte-titres ne nomme jamais le
        # compte qu'il décrit : il n'y a donc pas de troisième source possible.
        self.compte = crud.get_compte(db, preset.compte_id or compte_id_defaut)
        # Les titres en base, ARCHIVÉS COMPRIS, indexés par les deux
        # dénominations. Un relevé qui rouvre une position sur un titre rangé
        # doit retomber sur celui-là, pas en créer un second.
        titres = crud.get_actions(db, inclure_archivees=True)
        self.par_isin = {t.code_isin: t for t in titres if t.code_isin}
        self.par_nom = {
            import_bancaire.normaliser_libelle(t.nom): t for t in titres if t.nom
        }

    @property
    def monnaie_compte_id(self) -> Optional[int]:
        return self.compte.monnaie_principale_id if self.compte else None


def _texte(valeur) -> str:
    return "" if valeur is None else str(valeur).strip()


def _rapprocher_titre(contexte: ContextePresetPlacement, nom: str, isin: str):
    """Le titre en base que (nom, ISIN) désignent, et ce qui cloche s'il y a
    lieu : (action, erreur).

    L'ISIN d'abord — cf. l'en-tête du module. Un désaccord entre les deux
    dénominations n'est signalé que dans le sens qui pose vraiment problème :
    un nom différent pour le même ISIN est ordinaire (chaque courtier abrège à
    sa façon) et le nom en base l'emporte sans un mot ; un ISIN différent pour
    le même nom veut dire deux valeurs distinctes, et là rien ne peut être
    deviné.
    """
    if isin:
        titre = contexte.par_isin.get(isin)
        if titre is not None:
            return titre, None

    if nom:
        titre = contexte.par_nom.get(import_bancaire.normaliser_libelle(nom))
        if titre is not None:
            if isin and titre.code_isin and titre.code_isin != isin:
                return None, (
                    f"« {titre.nom} » porte déjà le code ISIN {titre.code_isin}, "
                    f"le fichier annonce {isin} : ce sont deux valeurs "
                    "différentes. Renomme l'une des deux, ou choisis le titre "
                    "à la main sur cette ligne."
                )
            return titre, None

    return None, None


def _nom_du_titre_a_creer(nom: str, isin: str) -> str:
    """Sous quel nom créer un titre que le fichier est seul à connaître.

    Le nom du fichier s'il en donne un ; l'ISIN sinon, faute de mieux —
    `Action.nom` ne peut pas être vide, et un titre qui s'appellerait « ? »
    serait introuvable dans la liste. L'ISIN au moins se recherche et
    s'identifie.
    """
    return nom or isin


def _resoudre_ligne(
    contexte: ContextePresetPlacement, brute: dict, compte_id_defaut: Optional[int] = None
) -> LignePlacement:
    """Une ligne brute devient une LignePlacement : lue, rapprochée, vérifiée.

    Ne crée RIEN — pas même un titre. La création n'a lieu qu'à la confirmation
    (cf. `confirmer`), pour qu'un aperçu qu'on abandonne ne laisse aucune trace.
    """
    montant_signe = import_bancaire.parser_montant(
        brute["montant_brut"], contexte.separateur_decimal
    )
    quantite = import_bancaire.parser_montant(
        brute["quantite_brute"], contexte.separateur_decimal
    )
    cours = import_bancaire.parser_montant(
        brute["cours_brut"], contexte.separateur_decimal
    )
    libelle_type = _texte(brute["type_brut"])
    nom_valeur = _texte(brute["nom_valeur_brut"])
    # Un ISIN s'écrit sans espaces et en majuscules (deux lettres de pays, neuf
    # caractères, une clé) : le mettre en forme ici évite qu'un même titre
    # exporté « fr0010315770 » d'un côté et « FR0010315770 » de l'autre donne
    # deux titres. Aucune validation de la clé — un code mal formé n'empêche
    # pas d'identifier une ligne, et refuser l'import pour cela serait absurde.
    code_isin = _texte(brute["code_isin_brut"]).replace(" ", "").upper()

    compte = contexte.compte or crud.get_compte(contexte.db, compte_id_defaut)
    type_placement, compte_autre_id, type_titre_id_regle = _type_de_la_ligne(
        contexte, brute, libelle_type
    )
    type_titre_nom, type_titre_id = _type_titre_de_la_ligne(
        contexte, brute, type_titre_id_regle
    )

    ligne = LignePlacement(
        ligne=brute["ligne"],
        date=import_bancaire.parser_date(brute["date_brute"]),
        type_placement=type_placement,
        libelle_type=libelle_type,
        nom_valeur=nom_valeur,
        code_isin=code_isin,
        montant=abs(montant_signe) if montant_signe is not None else None,
        montant_signe=montant_signe,
        quantite=quantite,
        cours=cours,
        compte_id=compte.id if compte else None,
        # Posé par la règle, quand elle en nomme un. Une retouche manuelle le
        # remplace ensuite comme n'importe quelle autre valeur : la règle
        # PROPOSE le compte, elle ne le verrouille pas.
        compte_id_autre=compte_autre_id,
        type_titre_nom=type_titre_nom,
        type_titre_id=type_titre_id,
    )
    return _completer_ligne(contexte, ligne)


def _resoudre_ligne_position(
    contexte: ContextePresetPlacement, brute: dict, compte_id_defaut=None
) -> LignePlacement:
    """Une ligne de PHOTOGRAPHIE devient une LignePlacement — un ACHAT.

    POURQUOI UN ACHAT, ET PAS UN TROISIÈME TYPE. Dans cette application, une
    détention n'existe pas en soi : elle se somme des mouvements du couple
    (compte, titre). Constater qu'on détient 12 titres à 87 € revient donc à
    dire qu'on les a achetés à ce prix-là — et l'écrire ainsi rend d'un coup
    justes la valorisation, le prix de revient et les plus-values latentes, sans
    qu'aucun de ces trois calculs n'ait à connaître l'existence des photos.

    LES ESPÈCES BAISSENT DU TOTAL INVESTI, comme pour n'importe quel achat. Ce
    n'est pas un effet de bord : l'argent a bien quitté les espèces pour devenir
    des titres. À l'utilisateur de poser le solde initial du compte en
    conséquence — c'est ce que dit l'écran avant de valider.

    LE PRIX DE REVIENT EST UNITAIRE (PRU). C'est ce qu'écrivent la plupart des
    courtiers, et c'est déjà la forme que la base attend
    (OperationAction.prix_unitaire) : le montant investi s'en déduit, jamais
    l'inverse.

    LA DATE N'EST PAS DANS LE FICHIER : une photo ne dit pas quand elle a été
    prise. C'est celle choisie à l'import qui date toutes les lignes.
    """
    quantite = import_bancaire.parser_montant(
        brute["quantite_brute"], contexte.separateur_decimal
    )
    prix_revient = import_bancaire.parser_montant(
        brute["prix_revient_brut"], contexte.separateur_decimal
    )
    valeur_totale = import_bancaire.parser_montant(
        brute["valeur_totale_brute"], contexte.separateur_decimal
    )
    nom_valeur = _texte(brute["nom_valeur_brut"])
    code_isin = _texte(brute["code_isin_brut"]).replace(" ", "").upper()

    compte = contexte.compte or crud.get_compte(contexte.db, compte_id_defaut)
    # Une quantité détenue est positive par nature : un courtier qui exporte une
    # position à découvert n'existe pas dans le périmètre de cette app, et un
    # signe négatif est plus sûrement une colonne mal désignée.
    quantite_lue = abs(quantite) if quantite is not None else None
    prix = abs(prix_revient) if prix_revient is not None else None
    # Les règles ne tournent PAS sur une photographie : elles se prononcent sur
    # le libellé d'un type d'opération, colonne qu'une photo ne porte pas. Seule
    # la colonne du fichier peut donc typer un titre ici.
    type_titre_nom, type_titre_id = _type_titre_de_la_ligne(contexte, brute, None)

    ligne = LignePlacement(
        ligne=brute["ligne"],
        date=contexte.date_position,
        type_placement=TypeOperationPlacement.achat,
        libelle_type="",
        nom_valeur=nom_valeur,
        code_isin=code_isin,
        # Le montant investi se DÉDUIT du PRU : c'est le prix par titre qui fait
        # foi ici, à l'inverse d'une ligne d'opération où c'est le montant.
        montant=(
            quantite_lue * prix
            if quantite_lue is not None and prix is not None
            else None
        ),
        quantite=quantite_lue,
        # Le COURS actuel, déduit de la valorisation : c'est le seul usage de la
        # colonne « valeur totale », et la raison pour laquelle elle est
        # facultative — un cours se saisit très bien à la main ensuite.
        cours=(
            valeur_totale / quantite_lue
            if valeur_totale is not None and quantite_lue
            else None
        ),
        compte_id=compte.id if compte else None,
        type_titre_nom=type_titre_nom,
        type_titre_id=type_titre_id,
    )
    return _completer_ligne(contexte, ligne)


def _completer_ligne(
    contexte: ContextePresetPlacement, ligne: LignePlacement
) -> LignePlacement:
    """Le rapprochement du titre, le prix unitaire déduit, la monnaie et
    l'erreur — tout ce qui se recalcule à l'identique après une retouche
    manuelle de l'aperçu.

    Séparé de `_resoudre_ligne` exactement pour cela : une ligne dont
    l'utilisateur corrige la quantité doit voir son prix unitaire, son écart de
    cours et son erreur refaits, sans repasser par la lecture du fichier.
    """
    maj: dict = {}

    # ---------- Le titre ----------
    action = None
    erreur_titre = None
    if ligne.type_placement in (TypeOperationPlacement.achat, TypeOperationPlacement.vente):
        if ligne.action_id is not None:
            # Titre choisi à la main dans l'aperçu : il tranche, sans
            # rapprochement ni contrôle de cohérence à faire.
            action = crud.get_action(contexte.db, ligne.action_id)
        else:
            action, erreur_titre = _rapprocher_titre(
                contexte, ligne.nom_valeur, ligne.code_isin
            )
    maj["action_id"] = action.id if action else None
    # Le nom AFFICHÉ : c'est celui qu'on relira dans l'aperçu. Le nom du
    # courtier, lui, reste dans `nom_valeur` — celui que le fichier porte.
    maj["action_nom"] = action.nom_affiche if action else ""
    maj["titre_a_creer"] = (
        action is None
        and erreur_titre is None
        and ligne.type_placement in (TypeOperationPlacement.achat, TypeOperationPlacement.vente)
        and bool(ligne.nom_valeur or ligne.code_isin)
    )

    # ---------- Le prix unitaire, et le contrôle du cours ----------
    # Le montant fait foi (cf. l'en-tête du module) : le prix unitaire s'en
    # déduit, il ne se lit pas.
    prix_unitaire = None
    ecart_cours = None
    if ligne.montant is not None and ligne.quantite:
        prix_unitaire = ligne.montant / ligne.quantite
        # PAS DE CONTRÔLE DU COURS SUR UNE PHOTOGRAPHIE. Là-bas, l'écart entre
        # le cours du jour et le prix de revient N'EST PAS une anomalie : c'est
        # la plus-value latente, et c'est exactement ce qu'on vient chercher. Le
        # signaler ferait clignoter chaque ligne d'un portefeuille qui gagne.
        if (
            contexte.mode is not ModeLecturePlacement.position
            and ligne.cours is not None
            and prix_unitaire > 0
        ):
            ecart = abs(ligne.cours - prix_unitaire) / prix_unitaire
            if ecart > ECART_COURS_TOLERE:
                ecart_cours = ecart
    maj["prix_unitaire"] = prix_unitaire
    maj["ecart_cours"] = ecart_cours

    # ---------- La monnaie de l'écriture ----------
    # Celle de cotation du titre pour un mouvement de titres (c'est dans
    # celle-là que le prix a été payé), celle du compte pour un transfert.
    if action is not None:
        maj["monnaie_id"] = action.monnaie_id
    else:
        compte = crud.get_compte(contexte.db, ligne.compte_id)
        maj["monnaie_id"] = compte.monnaie_principale_id if compte else None

    # ---------- Ce que le compte détient déjà ----------
    # Seulement pour une photographie : importer une photo dans un compte qui
    # porte déjà ces titres AJOUTE à ce qui s'y trouve (une détention se somme
    # des mouvements). L'aperçu le signale plutôt que de trancher — deux photos
    # successives peuvent décrire deux apports différents, et l'app n'a aucun
    # moyen de savoir laquelle des deux lectures est la bonne.
    if (
        contexte.mode is ModeLecturePlacement.position
        and action is not None
        and ligne.compte_id is not None
    ):
        deja = placements.quantite_detenue(contexte.db, ligne.compte_id, action.id)
        maj["quantite_deja_detenue"] = deja if abs(deja) > placements.EPSILON_QUANTITE else None

    ligne = ligne.model_copy(update=maj)
    return ligne.model_copy(
        update={"erreur": erreur_titre or _erreur_ligne(contexte, ligne)}
    )


def _erreur_ligne(
    contexte: ContextePresetPlacement, ligne: LignePlacement
) -> Optional[str]:
    """Ce qui empêche cette ligne d'être importée, en une phrase, ou None.

    Recalculée depuis le seul ÉTAT de la ligne, jamais mémorisée : une
    correction manuelle dans l'aperçu doit pouvoir lever l'erreur d'origine
    sans que rien n'ait à s'en souvenir.
    """
    if ligne.date is None:
        return "date illisible"
    if ligne.type_placement is None:
        return (
            f"type d'opération inconnu : « {ligne.libelle_type} »"
            if ligne.libelle_type
            else "type d'opération absent"
        )
    if ligne.montant is None:
        return "montant illisible"
    if ligne.montant == 0:
        return "montant nul"
    if ligne.compte_id is None:
        return "aucun compte de placements pour cette ligne"

    if ligne.type_placement is TypeOperationPlacement.transfert:
        # Le fichier ne décrit qu'un côté : sans le second compte, importer
        # créerait une écriture d'espèces sortie de nulle part.
        if ligne.compte_id_autre is None:
            return "transfert interne : indique le compte en face"
        if ligne.montant_signe is None:
            return "impossible de savoir si le compte émet ou reçoit (montant non signé)"
        return None

    # ---------- Achat / vente ----------
    if not ligne.quantite:
        return "quantité absente ou nulle"
    if ligne.quantite < 0:
        return "quantité négative"
    if ligne.action_id is None and not (ligne.nom_valeur or ligne.code_isin):
        return "ni nom de valeur ni code ISIN : impossible de savoir quel titre"

    # La monnaie de cotation du titre décide du compte depuis lequel il peut
    # s'acheter — c'est la règle du noyau (cf. routeur_placements), reprise ici
    # pour que l'aperçu la dise AVANT l'import plutôt qu'après.
    compte = crud.get_compte(contexte.db, ligne.compte_id)
    if compte is None:
        return "compte introuvable"
    if ligne.monnaie_id is not None and ligne.monnaie_id not in compte.monnaie_ids:
        monnaie = crud.get_monnaie(contexte.db, ligne.monnaie_id)
        nom_monnaie = monnaie.nom if monnaie else "cette monnaie"
        return (
            f"« {ligne.action_nom or ligne.nom_valeur or ligne.code_isin} » est coté "
            f"en {nom_monnaie}, que le compte « {compte.nom} » ne porte pas"
        )
    return None


def avertissements_configuration(preset, lignes: list[LignePlacement]) -> list[str]:
    """Ce que l'import laisse d'ambigu sans que ce soit faux. Jamais bloquant —
    ce sont des phrases affichées au-dessus de l'aperçu, pas des refus.

    Rendus depuis les LIGNES et pas seulement depuis le preset (contrairement à
    `import_bancaire.avertissements_configuration`) : le seul avertissement qui
    vaille ici — un cours qui ne concorde pas avec le montant — ne se voit
    qu'une fois le fichier lu.
    """
    messages = []

    divergentes = [ligne.ligne for ligne in lignes if ligne.ecart_cours is not None]
    if divergentes:
        apercu = ", ".join(str(numero) for numero in divergentes[:5])
        suite = "…" if len(divergentes) > 5 else ""
        messages.append(
            f"{len(divergentes)} ligne(s) ont un cours qui ne correspond pas au "
            f"montant divisé par la quantité (ligne {apercu}{suite}). C'est le "
            "montant qui est importé — le solde du compte colle donc au relevé, "
            "et les frais de courtage entrent dans le prix de revient. Si l'écart "
            "est important, vérifie que les colonnes « Montant », « Quantité » et "
            "« Cours » tombent bien en face des bonnes données."
        )

    if preset.compte_id is None:
        messages.append(
            "Ce preset n'est lié à aucun compte : le compte choisi pour le fichier "
            "s'applique à toutes ses lignes. Lie-le au compte-titres concerné "
            "(au-dessus) pour ne plus avoir à le choisir à chaque import."
        )

    return messages


# ---------- Aperçu ----------


def _resoudre_ligne_existante(
    contexte: ContextePresetPlacement, brute_stockee
) -> LignePlacement:
    """La ligne DÉJÀ EN BASE qu'un doublon désigne, relue par la configuration
    de colonnes ACTUELLE — pour être affichée en regard de la ligne importée.

    Repasse par `import_bancaire.lire_lignes_brutes` comme une ligne fraîche du
    fichier : c'est la seule façon d'obtenir exactement la même lecture des deux
    côtés, et donc une comparaison qui a du sens à l'écran.
    """
    brute = {cle: None for cle in PROPRIETE_VERS_CLE.values()}
    brute["ligne"] = 0
    for colonne in contexte.preset.colonnes:
        cle = PROPRIETE_VERS_CLE.get(colonne["propriete"])
        if cle is not None:
            brute[cle] = brute_stockee.donnees.get(str(colonne["index"]))
    return _resoudre_ligne(contexte, brute)


def previsualiser(
    db,
    preset_id: int,
    contenu: bytes,
    compte_id_defaut: Optional[int] = None,
    delimiteur: Optional[str] = None,
    separateur_decimal: Optional[str] = None,
    overrides: Optional[OverridesPlacements] = None,
    date_position: Optional[date_type] = None,
) -> ApercuPlacements:
    """Le fichier, lu et résolu, sans qu'une seule ligne n'entre en base.

    `delimiteur` / `separateur_decimal` : réglages de LECTURE en dernier
    recours, jamais mémorisés sur le preset — cf.
    `import_bancaire.previsualiser`, dont ils viennent et à qui ils sont
    transmis tels quels.

    `overrides` : LES RETOUCHES DÉJÀ FAITES DANS L'APERÇU, rejouées ici.

    Sans elles, l'aperçu mentirait sur ce qu'il va importer dès la première
    correction : une ligne à qui l'utilisateur vient de désigner son compte en
    face porterait encore « indique le compte en face », un titre choisi à la
    main resterait annoncé comme « à créer », et une quantité corrigée
    laisserait le prix unitaire d'avant. C'est le même code qui décide des deux
    côtés (`_completer_ligne`), et c'est la seule façon que l'aperçu et la
    confirmation ne puissent pas diverger.

    Les lignes SUPPRIMÉES ne sont pas filtrées ici : elles restent affichables
    (l'écran les masque lui-même) et leur suppression ne prend effet qu'à la
    confirmation, à qui la liste est envoyée.
    """
    preset = crud.get_import_preset(db, preset_id)
    contexte = ContextePresetPlacement(
        db, preset, compte_id_defaut, separateur_decimal, date_position
    )
    lignes_existantes_brutes = crud.list_lignes_import_brutes(db, preset_id)

    lignes = []
    lignes_existantes: dict[str, LignePlacement] = {}
    retouches = overrides.lignes if overrides else {}
    for brute in _lecture_du_fichier(contexte, preset, contenu, delimiteur):
        ligne = _resoudre(contexte, brute, compte_id_defaut)
        ligne = _appliquer_override(contexte, ligne, retouches.get(brute["ligne"]))
        doublon = import_bancaire.detecter_doublon(
            brute["donnees_completes"],
            lignes_existantes_brutes,
            preset.colonnes_comparaison,
            preset.mode_comparaison,
        )
        if doublon is not None:
            ligne = ligne.model_copy(update={"doublon_de": doublon.id})
            if str(doublon.id) not in lignes_existantes:
                lignes_existantes[str(doublon.id)] = _resoudre_ligne_existante(
                    contexte, doublon
                )
        lignes.append(ligne)

    return ApercuPlacements(
        lignes=lignes,
        titres_a_creer=_titres_a_creer(lignes),
        lignes_existantes=lignes_existantes,
        apercu_fichier=import_bancaire.construire_apercu_fichier(
            contenu,
            preset.colonnes,
            preset.ignorer_premiere_ligne,
            delimiteur,
            propriete_vers_cle=(
                PROPRIETE_VERS_CLE_POSITION
                if contexte.mode is ModeLecturePlacement.position
                else PROPRIETE_VERS_CLE
            ),
        ),
        avertissements=avertissements_configuration(preset, lignes),
    )


def _lecture_du_fichier(contexte, preset, contenu, delimiteur):
    """Les lignes brutes du fichier, selon ce qu'il raconte.

    UN SEUL ENDROIT décide des colonnes à lire et de ce qu'une ligne veut dire :
    l'aperçu et la confirmation passent tous deux par ici, et ne peuvent donc pas
    diverger — ce qui est la propriété qui compte, puisque l'un montre ce que
    l'autre écrira.
    """
    position = contexte.mode is ModeLecturePlacement.position
    return import_bancaire.lire_lignes_brutes(
        contenu,
        preset.colonnes,
        preset.ignorer_premiere_ligne,
        delimiteur,
        propriete_vers_cle=(
            PROPRIETE_VERS_CLE_POSITION if position else PROPRIETE_VERS_CLE
        ),
    )


def _resoudre(contexte, brute, compte_id_defaut):
    """La ligne résolue, dans l'un ou l'autre mode."""
    if contexte.mode is ModeLecturePlacement.position:
        return _resoudre_ligne_position(contexte, brute, compte_id_defaut)
    return _resoudre_ligne(contexte, brute, compte_id_defaut)


def _titres_a_creer(lignes: list[LignePlacement]) -> list[str]:
    """Les titres que la confirmation créera, dédoublonnés et dans l'ordre
    d'apparition — un même titre acheté trois fois dans le fichier n'est
    annoncé qu'une fois."""
    noms, vus = [], set()
    for ligne in lignes:
        if not ligne.titre_a_creer:
            continue
        nom = _nom_du_titre_a_creer(ligne.nom_valeur, ligne.code_isin)
        cle = import_bancaire.normaliser_libelle(nom)
        if cle and cle not in vus:
            vus.add(cle)
            noms.append(nom)
    return noms


# ---------- Confirmation ----------


def _appliquer_override(
    contexte: ContextePresetPlacement,
    ligne: LignePlacement,
    override: Optional[LignePlacementOverride],
) -> LignePlacement:
    """La ligne telle que l'utilisateur l'a laissée dans l'aperçu.

    Seuls les champs fournis s'appliquent, puis TOUT ce qui en découle est
    refait (`_completer_ligne`) : corriger une quantité doit refaire le prix
    unitaire, changer un ISIN doit refaire le rapprochement du titre, et lever
    l'erreur si elle n'a plus lieu d'être.
    """
    if override is None:
        return ligne
    # Un titre choisi à la main efface le rapprochement automatique : c'est
    # justement pour cela qu'on le choisit, et `_completer_ligne` le voit à
    # `action_id` renseigné.
    retouches = override.model_dump(exclude_none=True)
    if "montant" in retouches:
        # Le signe du montant oriente les transferts : une correction manuelle
        # doit donc le porter aussi, sinon un transfert corrigé perdrait son
        # sens émetteur/récepteur.
        signe = -1 if (ligne.montant_signe or 0) < 0 else 1
        retouches["montant_signe"] = signe * abs(retouches["montant"])
        retouches["montant"] = abs(retouches["montant"])
    return _completer_ligne(contexte, ligne.model_copy(update=retouches))


def _titre_pour_ligne(
    db, contexte: ContextePresetPlacement, ligne: LignePlacement, crees: list[str]
) -> models.Action:
    """Le titre de cette ligne, CRÉÉ s'il n'existe pas encore.

    La création se fait ici et pas à l'aperçu : un aperçu qu'on abandonne ne
    doit laisser aucun titre orphelin dans la liste.

    LE RAPPROCHEMENT EST REFAIT ICI, et ce n'est pas une redite de l'aperçu :
    `ligne.titre_a_creer` a été calculé avant qu'aucun titre n'existe, donc
    AVANT que la première ligne du fichier ne crée le sien. Un titre acheté
    trois fois dans le même relevé serait sans cela créé trois fois — et les
    deux dernières fois refusées par l'unicité de l'ISIN, ce qui ferait échouer
    tout l'import. Le contexte est tenu à jour au fil des créations
    (`par_isin` / `par_nom`), c'est lui qui répond aux lignes suivantes.
    """
    if ligne.action_id is not None:
        return crud.get_action(db, ligne.action_id)

    existant, _ = _rapprocher_titre(contexte, ligne.nom_valeur, ligne.code_isin)
    if existant is not None:
        return existant

    nom = _nom_du_titre_a_creer(ligne.nom_valeur, ligne.code_isin)
    action = crud.create_action(
        db,
        nom=nom,
        monnaie_id=contexte.monnaie_compte_id,
        # POSÉ SEULEMENT ICI, à la création. Un titre déjà connu garde le type
        # qu'on lui a donné : un relevé mal réglé, ou un courtier qui change son
        # vocabulaire, ne doit pas retyper silencieusement tout un portefeuille
        # (cf. models.RegleImportPlacement.type_titre_id).
        type_titre_id=_type_titre_a_poser(db, contexte, ligne),
        # `valeur` est le dernier cours connu, qui ne sert QU'À VALORISER le
        # portefeuille à l'écran. Le cours du relevé est ce qu'on a de plus
        # récent sur ce titre ; à défaut, le prix payé. Ni l'un ni l'autre
        # n'entre dans un solde (cf. models.Action.valeur).
        valeur=ligne.cours if ligne.cours is not None else (ligne.prix_unitaire or 0.0),
        code_isin=ligne.code_isin or None,
    )
    crees.append(action.nom)
    if action.code_isin:
        contexte.par_isin[action.code_isin] = action
    contexte.par_nom[import_bancaire.normaliser_libelle(action.nom)] = action
    return action


def _type_titre_a_poser(db, contexte, ligne) -> Optional[int]:
    """L'identifiant du type à poser sur le titre qu'on vient de créer, en le
    CRÉANT lui-même si le fichier a écrit un libellé encore inconnu.

    La création a lieu ici et pas à l'aperçu, pour la même raison que celle des
    titres : un aperçu qu'on abandonne ne doit laisser aucune étiquette
    orpheline dans la liste.

    Le contexte est tenu à jour au fil des créations, comme pour les titres :
    un relevé qui range trente lignes sous « ETF » ne doit créer ce type
    qu'une fois — la contrainte d'unicité refuserait les vingt-neuf autres et
    ferait échouer tout l'import.
    """
    if ligne.type_titre_id:
        return ligne.type_titre_id
    if not ligne.type_titre_nom:
        return None
    cle = import_bancaire.normaliser_libelle(ligne.type_titre_nom)
    connu = contexte.types_titre_par_nom.get(cle)
    if connu is None:
        connu = crud.create_type_titre(db, ligne.type_titre_nom)
        contexte.types_titre_par_nom[cle] = connu
        contexte.types_titre_par_id[connu.id] = connu
    return connu.id


def _completer_isin(db, action: models.Action, code_isin: str) -> None:
    """Complète l'ISIN d'un titre qui n'en avait pas.

    Ne l'ÉCRASE jamais : un titre qui porte déjà un ISIN différent a été traité
    bien avant, comme une erreur de ligne (cf. `_rapprocher_titre`). Ici, il
    s'agit seulement d'un titre saisi à la main avant que cette extension
    n'existe, que le premier relevé importé vient enrichir.
    """
    if code_isin and not action.code_isin:
        crud.update_action(db, action, code_isin=code_isin)


def confirmer(
    db,
    preset_id: int,
    contenu: bytes,
    overrides: OverridesPlacements,
    nom_fichier: str = "",
    compte_id_defaut: Optional[int] = None,
    delimiteur: Optional[str] = None,
    separateur_decimal: Optional[str] = None,
    date_position: Optional[date_type] = None,
) -> ResultatPlacements:
    """Crée en base ce que l'aperçu montrait.

    `delimiteur` / `separateur_decimal` DOIVENT être ceux avec lesquels
    l'aperçu confirmé a été construit : sans quoi le fichier serait relu
    autrement ici que là, et des lignes partiraient en base avec des montants
    que personne n'a vus.

    UNE LIGNE EN ERREUR N'EST PAS IMPORTÉE mais ne bloque pas le fichier : elle
    ressort dans `lignes_ignorees`, avec son motif, et l'utilisateur la reprend
    ensuite à la main. C'est le choix de l'import bancaire, pour la même raison
    — un relevé de deux cents lignes ne doit pas être refusé en entier parce
    que trois d'entre elles manquent d'un compte en face.
    """
    # Les correspondances de compte d'abord, pour que les lignes relues juste
    # après en profitent immédiatement (même ordre que côté bancaire).
    for nom_fichier_compte, compte_id in overrides.comptes.items():
        crud.set_mapping_compte(db, preset_id, nom_fichier_compte, compte_id)

    preset = crud.get_import_preset(db, preset_id)
    contexte = ContextePresetPlacement(
        db, preset, compte_id_defaut, separateur_decimal, date_position
    )
    lignes_existantes_brutes = crud.list_lignes_import_brutes(db, preset_id)

    lignes = []
    donnees_par_ligne: dict[int, dict] = {}
    for brute in _lecture_du_fichier(contexte, preset, contenu, delimiteur):
        ligne = _resoudre(contexte, brute, compte_id_defaut)
        doublon = import_bancaire.detecter_doublon(
            brute["donnees_completes"],
            lignes_existantes_brutes,
            preset.colonnes_comparaison,
            preset.mode_comparaison,
        )
        if doublon is not None:
            ligne = ligne.model_copy(update={"doublon_de": doublon.id})
        donnees_par_ligne[brute["ligne"]] = brute["donnees_completes"]
        lignes.append(ligne)

    operations_creees = 0
    doublons_detectes = 0
    lignes_ignorees: list[LignePlacement] = []
    titres_crees: list[str] = []
    # (données brutes, id de l'opération créée) : le stock anti-doublons n'est
    # alimenté qu'APRÈS création réussie, pour que chaque ligne stockée pointe
    # vers une opération réelle. Une ligne supprimée à la main ou en erreur n'y
    # entre donc pas — la revoir au prochain import est le comportement voulu.
    a_stocker: list[tuple[dict, int]] = []
    # Ce que chaque couple (compte, titre) détient au fil du fichier, positions
    # déjà en base comprises : c'est ce qui permet de refuser une vente à
    # découvert sans relancer une requête par ligne (cf. plus bas).
    detenu: dict[tuple[int, int], float] = {}

    for ligne in lignes:
        if ligne.doublon_de is not None:
            doublons_detectes += 1
        if ligne.ligne in overrides.lignes_supprimees:
            continue

        ligne = _appliquer_override(contexte, ligne, overrides.lignes.get(ligne.ligne))
        if ligne.erreur:
            lignes_ignorees.append(ligne)
            continue

        if ligne.type_placement is TypeOperationPlacement.transfert:
            operation_sortante = _creer_transfert(db, ligne)
            if isinstance(operation_sortante, str):
                lignes_ignorees.append(ligne.model_copy(update={"erreur": operation_sortante}))
                continue
            a_stocker.append((donnees_par_ligne[ligne.ligne], operation_sortante.id))
            # Deux écritures, comme tout virement : c'est ce que l'historique
            # doit annoncer, sans quoi l'annulation semblerait en supprimer
            # deux fois trop.
            operations_creees += 2
            continue

        action = _titre_pour_ligne(db, contexte, ligne, titres_crees)
        if action is None:
            lignes_ignorees.append(ligne.model_copy(update={"erreur": "titre introuvable"}))
            continue
        _completer_isin(db, action, ligne.code_isin)
        # LE COURS ACTUEL, sur une photographie seulement. C'est le seul usage de
        # la colonne « valeur totale » : elle ne crée aucune détention, elle dit
        # ce que le titre vaut aujourd'hui. Ailleurs, `cours` est le prix annoncé
        # d'une transaction passée — l'écrire comme cours du jour vieillirait le
        # portefeuille à chaque import d'historique.
        if contexte.mode is ModeLecturePlacement.position and ligne.cours is not None:
            crud.update_action(db, action, valeur=ligne.cours)

        sens = (
            SensAction.achat
            if ligne.type_placement is TypeOperationPlacement.achat
            else SensAction.vente
        )
        cle_position = (ligne.compte_id, action.id)
        if cle_position not in detenu:
            detenu[cle_position] = placements.quantite_detenue(
                db, ligne.compte_id, action.id
            )
        if sens is SensAction.vente:
            # UNE POSITION NE DEVIENT PAS NÉGATIVE. C'est la règle du noyau
            # (cf. routeur_placements.create_operation_action) et elle vaut
            # ici : une vente à découvert est presque toujours un relevé lu à
            # l'envers, ou une position ouverte avant l'app et jamais saisie.
            #
            # La ligne est écartée, pas le fichier : le reste du relevé est
            # bon, et l'utilisateur reprend celle-là à la main (en saisissant
            # d'abord la position d'origine, le plus souvent).
            if ligne.quantite > detenu[cle_position] + placements.EPSILON_QUANTITE:
                lignes_ignorees.append(
                    ligne.model_copy(
                        update={
                            "erreur": (
                                f"vente de {ligne.quantite:g} « {action.nom} » alors que "
                                f"{detenu[cle_position]:g} sont détenus sur ce compte à "
                                "ce stade du fichier"
                            )
                        }
                    )
                )
                continue

        mouvement = crud.create_operation_action(
            db,
            compte_id=ligne.compte_id,
            action=action,
            sens=sens,
            quantite=ligne.quantite,
            prix_unitaire=ligne.prix_unitaire,
            date_operation=ligne.date,
        )
        detenu[cle_position] += ligne.quantite if sens is SensAction.achat else -ligne.quantite
        a_stocker.append((donnees_par_ligne[ligne.ligne], mouvement.operation_id))
        operations_creees += 1

    historique = crud.create_import_historique(
        db,
        preset_id=preset_id,
        nom_fichier=nom_fichier,
        operations_creees=operations_creees,
        lignes_ignorees=len(lignes_ignorees),
        doublons_detectes=doublons_detectes,
    )
    for donnees, operation_id in a_stocker:
        crud.create_ligne_import_brute(
            db,
            preset_id=preset_id,
            donnees=donnees,
            import_historique_id=historique.id,
            operation_id=operation_id,
        )

    return ResultatPlacements(
        operations_creees=operations_creees,
        lignes_ignorees=lignes_ignorees,
        titres_crees=titres_crees,
        doublons_detectes=doublons_detectes,
        historique_id=historique.id,
    )


def _creer_transfert(db, ligne: LignePlacement):
    """Le virement interne d'une ligne de transfert : l'opération SORTANTE, ou
    un message d'erreur.

    C'est le signe du montant qui oriente, comme pour un virement importé d'un
    relevé bancaire : négatif, le compte-titres émet ; positif, il reçoit. Le
    compte d'en face vient de l'aperçu.

    La jambe sortante est celle qu'on rend, et donc celle à laquelle la ligne du
    stock anti-doublons se rattache : supprimer le virement supprime ses DEUX
    opérations, le CASCADE libère donc la ligne quelle que soit la jambe
    retenue.
    """
    emetteur = (ligne.montant_signe or 0) < 0
    compte_source_id = ligne.compte_id if emetteur else ligne.compte_id_autre
    compte_destination_id = ligne.compte_id_autre if emetteur else ligne.compte_id

    compte_source = crud.get_compte(db, compte_source_id)
    compte_destination = crud.get_compte(db, compte_destination_id)
    if compte_source is None or compte_destination is None:
        return "compte introuvable"

    # La monnaie du transfert est celle du compte-titres : c'est SON relevé
    # qu'on lit, et le montant y est libellé. L'app ne convertit rien — si le
    # compte d'en face ne porte pas cette monnaie, la ligne se reprend à la
    # main plutôt que d'inventer un taux.
    monnaie_id = ligne.monnaie_id
    for compte in (compte_source, compte_destination):
        if monnaie_id not in compte.monnaie_ids:
            monnaie = crud.get_monnaie(db, monnaie_id)
            nom_monnaie = monnaie.nom if monnaie else "cette monnaie"
            return (
                f"le compte « {compte.nom} » ne porte pas {nom_monnaie} : "
                "ajoute-la au compte, ou reprends cette ligne à la main"
            )

    try:
        virement = schemas.VirementCreate(
            date=ligne.date,
            compte_source_id=compte_source.id,
            compte_destination_id=compte_destination.id,
            montant=ligne.montant,
            monnaie_id=monnaie_id,
            statut=Statut.reel,
        )
    except ValueError:
        return "le compte émetteur et le compte récepteur doivent être différents"

    operation_sortante, _ = crud.create_virement(
        db, virement, compte_source, compte_destination
    )
    return operation_sortante


def candidats_doublons_virements(
    lignes: list[LignePlacement],
) -> list[schemas.VirementCandidatDoublon]:
    """Les lignes de transfert, sous la forme qu'attend le détecteur de
    doublons de virements du NOYAU.

    C'est tout ce qu'il y avait à écrire pour que les transferts d'un relevé de
    compte-titres se rapprochent des virements déjà en base — d'où qu'ils
    viennent : importés d'un relevé bancaire, importés d'ici, ou saisis à la
    main. Le détecteur travaille sur les `Operation` liées par `virement_id`,
    et un transfert importé ici en est un vrai.

    Une seule monnaie de part et d'autre : un relevé de compte-titres ne décrit
    jamais qu'un côté du virement, il ne peut donc pas donner deux devises. Les
    champs « reçu » reprennent donc ceux du départ.
    """
    candidats = []
    for ligne in lignes:
        if ligne.type_placement is not TypeOperationPlacement.transfert:
            continue
        if ligne.date is None or ligne.montant is None:
            continue
        emetteur = (ligne.montant_signe or 0) < 0
        candidats.append(
            schemas.VirementCandidatDoublon(
                ligne=ligne.ligne,
                date=ligne.date,
                montant=ligne.montant,
                monnaie_id=ligne.monnaie_id,
                montant_recu=ligne.montant,
                monnaie_recue_id=ligne.monnaie_id,
                compte_source_id=ligne.compte_id if emetteur else ligne.compte_id_autre,
                compte_destination_id=(
                    ligne.compte_id_autre if emetteur else ligne.compte_id
                ),
            )
        )
    return candidats
