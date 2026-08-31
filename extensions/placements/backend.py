"""Point d'entrée backend de l'extension « Placements financiers ».

Le noyau ne cherche qu'une chose dans ce fichier : une variable `router`
(cf. app/extensions.py::charger_routeur). Ce module ne fait donc qu'assembler
les deux routeurs de l'extension et poser sur eux le garde-fou d'activation.

POURQUOI TROIS ROUTEURS. Les titres (`/actions`), les portefeuilles
(`/placements`) et les types de titre (`/types-titre`) sont trois ressources
distinctes — un titre existe indépendamment des comptes qui le détiennent, et
une étiquette indépendamment des titres qui la portent. Les fondre en un seul
routeur aurait été un remaniement gratuit, sans rapport avec le passage en
extension.

CE QUI N'EST PAS PARTI ICI. Les tables (`action`, `operation_action`), leurs
modèles SQLAlchemy et leurs migrations restent dans le noyau. C'est ce qui
permet de désactiver l'extension SANS PERDRE UN SEUL MOUVEMENT : les données
dorment en base, la page disparaît, et tout revient intact à la réactivation.
Une extension qui emporterait son schéma imposerait de choisir entre supprimer
les données et refuser la désactivation — les deux mauvaises réponses.
"""
from fastapi import APIRouter, Depends

from app.extensions import exiger_extension

from routeur_actions import router as router_actions
from routeur_placements import router as router_placements
from routeur_types_titre import router as router_types_titre

# `dependencies` sur le routeur agrégateur : la vérification s'applique à
# TOUTES les routes des deux sous-routeurs, sans avoir à la répéter sur
# chacune — et sans qu'une route ajoutée plus tard puisse l'oublier.
router = APIRouter(dependencies=[Depends(exiger_extension("placements"))])
router.include_router(router_actions)
router.include_router(router_placements)
router.include_router(router_types_titre)
