"""Les formes échangées par l'extension « Impôts ».

DANS L'EXTENSION et non dans app/schemas.py : ce sont les formes de SES routes,
pas du schéma de la base (la table et la colonne qu'elles lisent vivent dans le
noyau, migration 0077).
"""
from datetime import date as date_type
from typing import Optional

from pydantic import BaseModel, Field


class DeclarationEcriture(BaseModel):
    """Les réglages d'une année. Un champ ABSENT ne change pas ; un champ envoyé
    à `null` est EFFACÉ — c'est ce qui distingue « je n'y touche pas » de « je
    n'ai plus de date limite », et le routeur le lit dans `model_fields_set`."""

    taux_pct: Optional[float] = Field(default=None, ge=0, le=100)
    date_limite: Optional[date_type] = None


class DeclarationRead(BaseModel):
    annee: int
    taux_pct: Optional[float] = None
    date_limite: Optional[date_type] = None
    # Jours entre aujourd'hui et la date limite : négatif une fois dépassée,
    # None sans date limite. Calculé côté serveur pour que « aujourd'hui » soit
    # celui de l'application (et se teste) plutôt que celui du navigateur.
    jours_restants: Optional[int] = None


class OperationImpotsRead(BaseModel):
    """Une entrée à déclarer, avec les champs de la page Opérations."""

    id: int
    date: date_type
    nature: str
    montant: float
    monnaie_id: int
    compte_id: int
    categorie_id: Optional[int] = None
    statut: str
    notes: Optional[str] = None


class MonnaieImpotsRead(BaseModel):
    """Le bilan d'une année DANS UNE monnaie. Jamais deux devises additionnées."""

    monnaie_id: int
    monnaie_nom: str
    monnaie_symbole: str
    # Seules les entrées RÉELLES comptent : une entrée prévue n'a pas encore été
    # perçue, donc pas encore à déclarer. Les prévues figurent à part.
    total_reel: float
    total_prevu: float
    nombre: int
    # total_reel × taux. None tant qu'aucun taux n'est renseigné : l'écran se tait
    # plutôt que d'annoncer un impôt de zéro.
    impot_estime: Optional[float] = None


class VueImpotsRead(BaseModel):
    annee: int
    # Les années à proposer : celles qui ont des entrées à déclarer ou des
    # réglages, plus l'année en cours — la plus récente en premier.
    annees: list[int]
    declaration: DeclarationRead
    monnaies: list[MonnaieImpotsRead]
    operations: list[OperationImpotsRead]
