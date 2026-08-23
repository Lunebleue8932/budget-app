"""Point d'entrée backend de « Placements financiers — cours en ligne ».

Le noyau ne cherche qu'une chose ici : une variable `router` (cf.
app/extensions.py::charger_routeur). Ce module l'assemble et pose dessus le
garde-fou d'activation.

CETTE EXTENSION SE GREFFE SUR UNE AUTRE. Elle n'a ni écran ni entrée de
navigation : elle ajoute un lien de cotation aux titres que gère l'extension
« placements », et un bouton de mise à jour sur SA page. Les deux restent
séparées, et c'est le point du découpage :

    placements       le portefeuille, hors ligne, cours saisis à la main
    placements-web   + le cours va se lire tout seul sur une page publique

Retirer ce dossier-ci rend l'application intégralement hors ligne : plus une
seule ligne de code capable d'ouvrir une connexion sortante n'existe alors sur
la machine (cf. source_cours, le seul module qui en ouvre une). Ce n'est pas
un réglage qu'on désactive, c'est du code qu'on n'a pas installé — et c'est la
raison pour laquelle cette fonctionnalité est une extension à part plutôt
qu'une case à cocher dans la première.

DÉSACTIVER SUFFIT AUSSI, sans rien supprimer : les routes répondent alors 404
(`exiger_extension`) et l'écran cesse d'afficher les liens. Ils dorment en
base, intacts, et reviennent à la réactivation.
"""
from fastapi import APIRouter, Depends

from app.extensions import exiger_extension

from routeur_cours import router as router_cours

# `dependencies` sur le routeur entier : la vérification s'applique à toutes
# les routes, y compris à celles qu'on ajouterait plus tard sans y penser.
router = APIRouter(dependencies=[Depends(exiger_extension("placements-web"))])
router.include_router(router_cours)
