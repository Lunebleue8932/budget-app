"""Point d'entrée backend de l'extension « Vue d'ensemble des placements ».

Le noyau ne cherche qu'une chose ici : une variable `router`
(cf. app/extensions.py::charger_routeur).

CETTE EXTENSION NE CRÉE RIEN ET NE MODIFIE RIEN. Elle n'expose que des lectures,
calculées à la demande depuis les mouvements déjà en base. Il n'y a donc ni
table, ni migration, ni la moindre écriture : l'éteindre fait disparaître un
écran, rien d'autre.

ELLE DÉPEND DE « placements » (`requiert_une_de` dans le manifeste), et pas
seulement par politesse : c'est cette extension-là qui tient les titres, les
mouvements et les étiquettes dont celle-ci ne fait que la somme. Sans elle il
n'y aurait rien à regarder — le noyau grise donc la case et refuse de l'allumer.
"""
from fastapi import APIRouter, Depends

from app.extensions import exiger_extension

from routeur_investing_overview import router as router_vue_ensemble

router = APIRouter(dependencies=[Depends(exiger_extension("investing-overview"))])
router.include_router(router_vue_ensemble)
