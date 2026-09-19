"""Point d'entrée backend de l'extension « Objectifs ».

Cf. app/extensions.py : le noyau ne cherche ici qu'une variable `router`.

CE QUI N'EST PAS ICI : le schéma. La table `objectif_kpi` vit dans le noyau,
posée par la migration 0065 — une extension n'emporte jamais ses tables.
L'éteindre ne perd donc aucun objectif : l'écran disparaît, les lignes dorment
en base, et tout revient à la réactivation.

CE QUE L'EXTENSION NE TOUCHE PAS : le calcul. Elle ne crée, ne modifie et ne
supprime aucune opération. Les soldes, les KPI, l'histogramme et le camembert
donnent rigoureusement les mêmes chiffres qu'elle tourne ou non — un objectif
n'est qu'une façon de relire ce qui existe déjà, comparée à un nombre qu'on
s'est donné.
"""
from fastapi import APIRouter, Depends

from app.extensions import exiger_extension

from routeur_objectifs import router as router_objectifs

router = APIRouter(dependencies=[Depends(exiger_extension("objectifs"))])
router.include_router(router_objectifs)
