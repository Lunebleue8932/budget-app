"""Point d'entrée backend de l'extension « Renommages ».

Cf. app/extensions.py : le noyau ne cherche ici qu'une variable `router`.

CE QUI EST OPTIONNEL, C'EST DE S'EN SERVIR. Le moteur (reconnaître un libellé, proposer un nom à ceux
qui lui ressemblent, noter un renommage) vit dans le noyau (`app/services/renommages.py`), parce qu'il
appartient à l'import et à la mise à jour d'une opération. Ce que cette extension apporte, c'est la
page qui liste les renommages et les routes qui les écrivent — et, tant qu'elle est éteinte, ni
l'import ni la mise à jour d'une opération ne les consultent ni n'en créent.

Les renommages déjà écrits RESTENT EN BASE : éteindre l'extension arrête de renommer, ne perd rien.
"""
from fastapi import APIRouter, Depends

from app.extensions import exiger_extension

from routeur_renommages import router as router_renommages

router = APIRouter(dependencies=[Depends(exiger_extension("renommages"))])
router.include_router(router_renommages)
