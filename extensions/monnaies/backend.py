"""Point d'entrée backend de l'extension « Monnaies ».

Cf. app/extensions.py : le noyau ne cherche ici qu'une variable `router`.

L'EXTENSION EMPORTE LES ROUTES D'ÉCRITURE, PAS CELLE DE LECTURE.
`GET /monnaies` est resté dans le noyau : afficher un montant demande de
connaître son symbole, et c'est vrai de tous les écrans, extension ou pas.
Ce qui part ici, c'est la création, le renommage et la suppression — le droit
d'avoir PLUSIEURS monnaies, qui est la fonctionnalité optionnelle.

Sans ce dossier, la base garde la monnaie posée à l'installation et l'interface
se replie d'elle-même sur le cas mono-devise, qu'elle sait déjà traiter.
"""
from fastapi import APIRouter, Depends

from app.extensions import exiger_extension

from routeur_monnaies import router as router_monnaies

router = APIRouter(dependencies=[Depends(exiger_extension("monnaies"))])
router.include_router(router_monnaies)
