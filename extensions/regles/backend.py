"""Point d'entrée backend de l'extension « Règles de catégorisation ».

Cf. app/extensions.py : le noyau ne cherche ici qu'une variable `router`.

CE QUI EST OPTIONNEL, C'EST DE S'EN SERVIR. Le moteur d'évaluation reste dans
le noyau (`app/services/regles_categorisation.py`), parce qu'il appartient à
l'import : c'est lui qui classe une ligne pendant qu'on la lit. Ce que cette
extension apporte, c'est l'écran qui écrit les règles et les routes qui les
manipulent — et, tant qu'elle est éteinte, l'import ne les consulte plus du
tout (cf. services/import_bancaire.ContexteImport).

Les règles déjà écrites RESTENT EN BASE : éteindre l'extension arrête le
classement automatique, ne perd rien, et tout repart à la réactivation.
"""
from fastapi import APIRouter, Depends

from app.extensions import exiger_extension

from routeur_regles import router as router_regles

router = APIRouter(dependencies=[Depends(exiger_extension("regles"))])
router.include_router(router_regles)
