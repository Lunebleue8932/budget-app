"""Les formes que l'import de titres rend à l'écran.

L'APERÇU DIT CE QUI CHANGERAIT, ligne par ligne, AVANT/APRÈS : un fichier qui complète
des titres existants ne se relit pas comme un relevé qui crée des mouvements — ce qu'on
veut y vérifier, c'est « qu'est-ce que ce fichier va changer chez moi ? ».
"""
from typing import Optional

from pydantic import BaseModel, Field

from app import schemas


class ChangementTitre(BaseModel):
    """Un champ d'un titre que la ligne ferait changer : ce qu'il vaut, ce qu'il vaudrait."""

    champ: str
    avant: Optional[str] = None
    apres: Optional[str] = None


class EtiquetteACreer(BaseModel):
    """Une étiquette que le fichier nomme et que la base ne connaît pas : elle serait
    créée, dans le BON axe, à la confirmation."""

    axe: str
    nom: str


class LigneTitre(BaseModel):
    # Le numéro de ligne PHYSIQUE dans le fichier, comme l'affiche Excel.
    ligne: int
    code_isin: Optional[str] = None
    nom: Optional[str] = None
    # « cree », « maj », « inchange » ou « erreur » : ce que la confirmation ferait de la ligne.
    statut: str
    titre_id: Optional[int] = None
    changements: list[ChangementTitre] = Field(default_factory=list)
    etiquettes_a_creer: list[EtiquetteACreer] = Field(default_factory=list)
    # Ce qui rend la ligne impossible (elle sera ignorée), et ce qui la laisse passer
    # en l'avertissant (une répartition incomplète, des poids qui ressemblent à des fractions).
    erreurs: list[str] = Field(default_factory=list)
    avertissements: list[str] = Field(default_factory=list)


class ApercuTitres(BaseModel):
    lignes: list[LigneTitre] = Field(default_factory=list)
    nb_a_creer: int = 0
    nb_a_modifier: int = 0
    nb_inchanges: int = 0
    nb_erreurs: int = 0
    # Toutes les étiquettes à créer, dédoublonnées : « 3 zones, 1 secteur seront créés »
    # se lit mieux que la même zone répétée sur douze lignes.
    etiquettes_a_creer: list[EtiquetteACreer] = Field(default_factory=list)
    # Ce qui concerne le FICHIER entier (des ISIN de composition que ni le fichier ni la
    # base ne décrivent, par exemple).
    avertissements: list[str] = Field(default_factory=list)
    apercu_fichier: Optional[schemas.ApercuFichier] = None


class ResultatTitres(BaseModel):
    crees: int = 0
    mis_a_jour: int = 0
    inchanges: int = 0
    ignores: int = 0
    etiquettes_creees: list[EtiquetteACreer] = Field(default_factory=list)
