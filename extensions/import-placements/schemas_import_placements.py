"""Les modèles Pydantic propres à l'import de placements.

POURQUOI ICI ET PAS DANS app/schemas.py. Ce ne sont pas des tables : rien de ce
qui suit n'est stocké, ce sont les formes qui circulent entre l'écran et le
serveur PENDANT un import. Le noyau n'a donc aucune raison de les connaître, et
retirer l'extension ne doit rien laisser derrière — contrairement au SCHÉMA de
base de données, qui lui reste au noyau (cf. extensions/placements/backend.py).

Ce qui est réutilisé du noyau l'est tel quel : `ApercuFichier` (le fichier tel
qu'il est, identique dans les deux domaines) et `ImportAnnulationResultat`.
"""
from datetime import date as date_type
from typing import Optional

from pydantic import BaseModel, Field

from app.constants import TypeOperationPlacement
from app.schemas import ApercuFichier


class LignePlacement(BaseModel):
    """Une ligne du fichier, telle que l'aperçu la montre et que la
    confirmation la relit.

    Le pendant de `app.schemas.ImportLigne` pour un relevé de compte-titres.
    Volontairement séparée plutôt que dérivée : les deux n'ont en commun que la
    date, le montant et le numéro de ligne. Tout le reste — catégorie, sens,
    frais, statut d'un côté ; titre, quantité, cours de l'autre — ne se recouvre
    pas, et une classe commune aurait porté deux fois plus de champs vides que
    de champs utiles.
    """

    ligne: int  # numéro de ligne physique dans le fichier, comme dans Excel

    date: Optional[date_type] = None

    # ---------- Ce que la ligne décrit ----------
    # Code technique (cf. constants.TypeOperationPlacement), ou None si le
    # libellé lu n'appartient à aucun des trois vocabulaires du preset : la
    # ligne est alors en erreur. Rien n'est deviné ici — confondre un achat et
    # une vente inverserait une position entière.
    type_placement: Optional[TypeOperationPlacement] = None
    # Le libellé tel que le fichier l'écrit (« Achat », « SOUSCRIPTION »…),
    # conservé pour l'afficher dans l'aperçu et nommer l'erreur.
    libelle_type: str = ""

    # ---------- De quel titre il s'agit ----------
    # Les deux tels que lus. Un transfert d'espèces n'en porte aucun, c'est
    # normal et ce n'est pas une erreur.
    nom_valeur: str = ""
    code_isin: str = ""
    # Le titre déjà en base que ces deux-là désignent, s'il existe. None avec un
    # nom ou un ISIN renseigné = ce titre sera CRÉÉ à la confirmation (cf.
    # `titre_a_creer`), ce que l'aperçu signale.
    action_id: Optional[int] = None
    # Le nom du titre en base, qui peut différer de celui du fichier quand le
    # rapprochement s'est fait par l'ISIN. C'est celui-là qui fait foi : un
    # courtier abrège, un autre pas, et renommer un titre à chaque import
    # réécrirait l'historique de la page Placements.
    action_nom: str = ""
    titre_a_creer: bool = False
    # L'ÉTIQUETTE À POSER SUR LE TITRE, si la ligne en désigne une — par une
    # règle, ou par une colonne du fichier. Le nom est ce que le fichier écrit
    # (l'aperçu l'affiche tel quel) ; l'identifiant est le type déjà en base
    # auquel il correspond, ou None si le libellé est nouveau.
    #
    # ELLE NE VAUT QUE POUR UN TITRE QU'ON CRÉE. Un titre déjà connu garde le
    # type qu'on lui a posé : un import mal réglé ne doit pas retyper un
    # portefeuille entier sans le dire (cf. le module de service).
    type_titre_nom: str = ""
    type_titre_id: Optional[int] = None

    # ---------- Les montants ----------
    # Ce que l'opération a coûté ou rapporté, toujours positif. C'est LUI qui
    # fait foi : le solde du compte doit coller au relevé (cf. le module de
    # service, section « le montant fait foi »).
    montant: Optional[float] = None
    # Le montant tel que le fichier le signe. Sert uniquement à orienter un
    # transfert interne : négatif = le compte de placements émet, positif = il
    # reçoit. Exactement le rôle de `ImportLigne.montant_signe` côté bancaire.
    montant_signe: Optional[float] = None
    quantite: Optional[float] = None
    # Le cours lu dans le fichier, quand le preset lit cette colonne. Il ne
    # décide de rien : il sert de CONTRÔLE contre le prix unitaire déduit.
    cours: Optional[float] = None
    # montant / quantité — le prix réellement payé ou encaissé par titre, frais
    # de courtage compris. C'est lui qui part en base (OperationAction.
    # prix_unitaire), et c'est de lui que le prix de revient se déduit.
    prix_unitaire: Optional[float] = None
    # Écart RELATIF entre le cours lu et le prix unitaire déduit, quand il
    # dépasse constants.ECART_COURS_TOLERE. None = pas de cours lu, ou pas
    # d'écart notable. Jamais bloquant : c'est un avertissement d'aperçu.
    ecart_cours: Optional[float] = None

    # ---------- Où ça se passe ----------
    # Le compte de placements visé : celui du preset, ou celui choisi pour ce
    # fichier. Une ligne sans compte est en erreur.
    compte_id: Optional[int] = None
    # L'AUTRE compte d'un transfert interne, que le fichier ne nomme pas (un
    # relevé de compte-titres ne décrit qu'un côté). Renseigné à la main dans
    # l'aperçu, exactement comme pour un virement importé d'un relevé bancaire.
    # Tant qu'il vaut None, la ligne ne peut pas être importée : un transfert
    # sans contrepartie créerait de l'argent à partir de rien.
    compte_id_autre: Optional[int] = None
    # Monnaie de l'écriture : celle de cotation du titre pour un achat ou une
    # vente, celle du compte pour un transfert.
    monnaie_id: Optional[int] = None

    # ---------- Photographie de compte ----------
    # Ce que le couple (compte, titre) détient DÉJÀ au moment de l'import.
    # Renseigné uniquement en mode « position » et seulement quand c'est non nul :
    # importer une photo dans un compte qui porte déjà ces titres ajouterait à ce
    # qui s'y trouve. L'aperçu le signale et pré-sélectionne la ligne ; rien
    # n'est deviné — deux photos successives peuvent légitimement décrire deux
    # apports différents.
    quantite_deja_detenue: Optional[float] = None

    # ---------- Verdict ----------
    erreur: Optional[str] = None
    # Id de la LigneImportBrute déjà en base suspectée d'être la même
    # opération. Comme côté bancaire : la ligne reste ordinaire, elle est
    # simplement pré-sélectionnée dans l'aperçu, et l'utilisateur tranche.
    doublon_de: Optional[int] = None


class ApercuPlacements(BaseModel):
    lignes: list[LignePlacement]
    # Les titres que la confirmation CRÉERA, par nom affiché : de quoi les
    # relire d'un coup d'œil avant de valider, plutôt que de les découvrir dans
    # la liste des titres après coup.
    titres_a_creer: list[str] = Field(default_factory=list)
    # Version résolue de chaque ligne déjà en base référencée par un
    # `doublon_de`, clé = str(id) — affichée en regard de la ligne importée.
    lignes_existantes: dict[str, LignePlacement] = Field(default_factory=dict)
    apercu_fichier: ApercuFichier = Field(default_factory=ApercuFichier)
    # Ce que la configuration laisse d'ambigu sans être faux (un cours lu qui ne
    # concorde pas, un compte non lié). Jamais bloquant.
    avertissements: list[str] = Field(default_factory=list)


class LignePlacementOverride(BaseModel):
    """Retouche manuelle d'une ligne dans l'aperçu, avant confirmation.

    Seuls les champs fournis s'appliquent ; les autres gardent ce que la
    résolution automatique a trouvé. Même contrat que
    `app.schemas.ImportLigneOverride`.
    """

    date: Optional[date_type] = None
    type_placement: Optional[TypeOperationPlacement] = None
    nom_valeur: Optional[str] = None
    code_isin: Optional[str] = None
    montant: Optional[float] = None
    quantite: Optional[float] = None
    # Le titre à utiliser, choisi dans la liste des titres existants : court-
    # circuite le rapprochement par nom/ISIN, et donc la création d'un doublon
    # quand le courtier écrit un nom que l'app ne connaît pas encore.
    action_id: Optional[int] = None
    compte_id: Optional[int] = None
    # Le second compte d'un transfert. Le seul champ que l'aperçu DOIT
    # régulièrement remplir : le fichier ne le porte jamais.
    compte_id_autre: Optional[int] = None


class OverridesPlacements(BaseModel):
    """Tout ce que l'utilisateur a décidé dans l'aperçu, envoyé avec le fichier
    au moment de confirmer."""

    # Numéro de ligne -> retouches.
    lignes: dict[int, LignePlacementOverride] = Field(default_factory=dict)
    # Lignes supprimées de l'aperçu : ni importées, ni mises au stock
    # anti-doublons — elles n'ont rien créé.
    lignes_supprimees: list[int] = Field(default_factory=list)
    # Correspondances « nom du fichier -> compte de l'app » à mémoriser pour les
    # imports suivants (le second compte d'un transfert, typiquement).
    comptes: dict[str, int] = Field(default_factory=dict)


class ResultatPlacements(BaseModel):
    operations_creees: int
    # Les lignes que l'import a laissées de côté, avec leur motif : rendues
    # telles quelles pour être affichées, jamais silencieuses.
    lignes_ignorees: list[LignePlacement] = Field(default_factory=list)
    titres_crees: list[str] = Field(default_factory=list)
    doublons_detectes: int = 0
    # Id de l'entrée d'historique créée : c'est par lui que l'import s'annule.
    historique_id: Optional[int] = None
