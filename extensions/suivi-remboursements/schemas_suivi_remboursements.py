"""Les formes échangées par l'extension « Suivi des remboursements ».

Préfixées `schemas_suivi_remboursements` comme le veut la convention : le dossier
de chaque extension est ajouté en fin de `sys.path`, deux extensions ne peuvent
donc pas avoir deux fichiers de même nom (cf. extensions/README.md).
"""
from typing import Optional

from pydantic import BaseModel, ConfigDict, Field


class ProfilCreate(BaseModel):
    nom: str = Field(min_length=1)
    description: str = ""


class ProfilUpdate(BaseModel):
    # None = ne pas toucher, partout dans l'application.
    nom: Optional[str] = Field(default=None, min_length=1)
    description: Optional[str] = None


class ProfilRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: int
    nom: str
    description: str
    ordre: int


class ReordonnerProfilsInput(BaseModel):
    ordre: list[int]


class RattachementInput(BaseModel):
    """Le geste unique d'écriture de l'extension : dire à qui une opération se
    rapporte. `profil_id` à None DÉTACHE — c'est la même convention que partout
    (un champ absent ne change rien, un champ à None efface), et il faut bien un
    moyen de défaire un rattachement posé par erreur."""

    operation_ids: list[int] = Field(min_length=1)
    profil_id: Optional[int] = None


class OperationSuiviRead(BaseModel):
    """Une ligne du détail d'un profil.

    `reste` est ce qui reste dû (`Operation.montant_a_rembourser`), `montant` ce
    que l'opération pesait au départ : les deux sont affichés parce qu'une
    dépense de 100 € dont il reste 20 ne se lit pas comme une dépense de 20."""

    id: int
    date: str
    nature: str
    compte_nom: str
    monnaie_id: int
    monnaie_symbole: str
    montant: float
    montant_du: float
    reste: float
    type_code: str
    # « on me doit » / « je dois » / « règlement » : ce que la ligne représente
    # dans le solde du profil, déduit du type. Le frontend n'a pas à reconstruire
    # cette règle une seconde fois.
    role: str
    profil_id: Optional[int] = None


class ProfilSoldeRead(BaseModel):
    """Le solde d'un profil DANS UNE MONNAIE. Jamais de total entre monnaies :
    une dette en dollars ne compense pas une créance en euros."""

    profil_id: Optional[int] = None
    profil_nom: str
    a_recevoir: float = 0.0
    a_rendre: float = 0.0
    net: float = 0.0
    nb_lignes: int = 0


class MonnaieSuiviRead(BaseModel):
    monnaie_id: int
    monnaie_nom: str
    monnaie_symbole: str
    total_a_recevoir: float = 0.0
    total_a_rendre: float = 0.0
    net: float = 0.0
    # Les profils qui portent quelque chose dans CETTE monnaie, plus la ligne
    # « Sans profil » quand il reste des dettes non rattachées (profil_id à
    # None). C'est elle qui donne envie de ranger : sans elle, un total de
    # profils inférieur au chiffre du dashboard n'aurait aucune explication à
    # l'écran.
    profils: list[ProfilSoldeRead] = Field(default_factory=list)


class VueSuiviRead(BaseModel):
    monnaies: list[MonnaieSuiviRead] = Field(default_factory=list)
    profils: list[ProfilRead] = Field(default_factory=list)
    # Les opérations qui FONT une dette (remboursable ou prêt) et qu'aucun profil
    # ne porte encore. C'est la liste de travail de l'écran : tant qu'elle n'est
    # pas vide, le tableau ne dit pas toute la vérité.
    a_rattacher: list[OperationSuiviRead] = Field(default_factory=list)
