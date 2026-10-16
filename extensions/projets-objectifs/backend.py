"""Point d'entrée backend de l'extension « Projets et objectifs ».

Cf. app/extensions.py : le noyau ne cherche ici qu'une variable `router`.

DEUX EXTENSIONS FONDUES EN UNE (« Projets » et « Objectifs », réunies sur une même page
de Budget). Leurs routes, leurs services et leurs tables n'ont pas bougé : seul l'interrupteur
est commun. Un objectif peut viser un projet, et l'éteindre séparément n'avait de sens pour
personne — `remplace` dans le manifeste reprend l'état d'activation des deux anciennes.

CE QUI N'EST PAS ICI : les tables. `sous_filtre` et `operation_sous_filtre` (migration 0043),
`objectif_kpi` (0065, 0070, 0073, 0084) vivent dans le noyau — une extension n'emporte jamais
son schéma. L'éteindre masque l'onglet et ferme ces routes, sans perdre un projet ni un
objectif : tout revient intact à la réactivation.

CE QUE L'EXTENSION NE TOUCHE PAS NON PLUS : le reste de l'application. Aucun solde, aucun
budget, aucun KPI ne dépend d'un projet ou d'un objectif.
"""
from fastapi import APIRouter, Depends

from app.extensions import exiger_extension

from routeur_objectifs import router as router_objectifs
from routeur_projets import router as router_projets

router = APIRouter(dependencies=[Depends(exiger_extension("projets-objectifs"))])
router.include_router(router_projets)
router.include_router(router_objectifs)
