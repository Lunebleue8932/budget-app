"""Point d'entrée backend de l'extension « Lecture de cours ».

Le noyau ne cherche qu'une chose ici : une variable `router` (cf.
app/extensions.py::charger_routeur). Ce module l'assemble et pose dessus les
garde-fous d'activation.

UNE SEULE EXTENSION VA SUR INTERNET, ET C'EST CELLE-CI. Lire le cours d'un
titre et lire le taux d'une monnaie sont le même problème — aller chercher un
nombre sur une page publique de cotation — et `source_cours` ne fait aucune
différence entre les deux. Les séparer en deux extensions aurait doublé la
surface à auditer pour la même fonction, et affaibli la promesse la plus utile
du dépôt : **un seul dossier à retirer, et plus une ligne de code capable
d'ouvrir une connexion sortante n'existe sur la machine.**

CETTE EXTENSION SE GREFFE SUR D'AUTRES. Elle n'a ni écran ni entrée de
navigation propre : elle ajoute un lien de cotation aux titres que gère
« placements », et un couple de monnaies suivi à l'écran de « monnaies ».

    placements        le portefeuille, hors ligne, cours saisis à la main
    monnaies          les devises de l'application, sans aucun taux
    lecture-de-cours  + les nombres vont se lire tout seuls

TROIS NIVEAUX DE GARDE-FOU, du plus large au plus précis :

1. le manifeste déclare `requiert_une_de: [placements, monnaies]` — le noyau
   refuse d'allumer l'extension si aucune des deux ne tourne, et l'éteint
   d'elle-même si la dernière s'arrête (cf. app/extensions.dependances_satisfaites) ;
2. `exiger_extension("lecture-de-cours")` sur le routeur entier — décocher sa
   case ferme toutes ses routes ;
3. `exiger_extension` de l'hôte sur CHAQUE sous-routeur — avoir « monnaies »
   sans « placements » ouvre les routes de taux et laisse celles des titres
   fermées, ce qui est exactement la fonctionnalité qu'on a alors.

DÉSACTIVER NE SUPPRIME RIEN : les liens et les derniers taux lus dorment en
base, intacts, et reviennent à la réactivation.
"""
from fastapi import APIRouter, Depends

from app.extensions import exiger_extension

from routeur_cours import router as router_cours
from routeur_taux import router as router_taux

# `dependencies` sur le routeur entier : la vérification s'applique à toutes
# les routes, y compris à celles qu'on ajouterait plus tard sans y penser.
router = APIRouter(dependencies=[Depends(exiger_extension("lecture-de-cours"))])

# Chaque volet exige EN PLUS son hôte. Sans « placements », il n'y a pas de
# titre à mettre à jour : ces routes n'ont alors pas plus de sens que si
# l'extension entière était éteinte, et répondent 404 comme telles.
router.include_router(router_cours, dependencies=[Depends(exiger_extension("placements"))])
router.include_router(router_taux, dependencies=[Depends(exiger_extension("monnaies"))])
