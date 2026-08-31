"""Point d'entrée backend de l'extension « Projets ».

Cf. app/extensions.py : le noyau ne cherche ici qu'une variable `router`.

CE QUI N'EST PAS ICI : la table. `sous_filtre` et `operation_sous_filtre` vivent
dans le noyau, posées par la migration 0043 — une extension n'emporte jamais son
schéma. L'éteindre masque l'onglet et ferme ces routes, sans perdre un seul
regroupement : tout revient intact à la réactivation.

CE QUE L'EXTENSION NE TOUCHE PAS NON PLUS : le reste de l'application. Aucun
solde, aucun budget, aucun KPI ne dépend d'un projet — c'est ce qui permet à une
opération d'appartenir à trois projets sans être comptée trois fois nulle part.
Le formulaire d'opération, lui, n'en parle même pas : un projet se remplit par
lots depuis son écran, après coup, pas à chaque saisie.
"""
from fastapi import APIRouter, Depends

from app.extensions import exiger_extension

from routeur_projets import router as router_projets

router = APIRouter(dependencies=[Depends(exiger_extension("projets"))])
router.include_router(router_projets)
