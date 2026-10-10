"""Point d'entrée backend de l'extension « Impôts ».

Cf. app/extensions.py : le noyau ne cherche ici qu'une variable `router`.

CE QUI N'EST PAS ICI : les colonnes et la table. `operation.a_declarer` et
`declaration_impots` vivent dans le noyau, posées par la migration 0077 — une
extension n'emporte jamais son schéma. L'éteindre ne perd donc aucune étiquette
ni aucun réglage : l'écran disparaît, tout dort en base et revient à la
réactivation.

CE QUE L'EXTENSION NE TOUCHE PAS : le calcul. Aucun solde, aucun KPI, aucun
graphe du noyau ne lit « à déclarer », et l'extension ne crée, ne modifie ni ne
supprime d'opération — au plus elle retire l'étiquette. Une application dont
cette extension est éteinte donne exactement les mêmes chiffres.
"""
from fastapi import APIRouter, Depends

from app.extensions import exiger_extension

from routeur_impots import router as router_impots

router = APIRouter(dependencies=[Depends(exiger_extension("impots"))])
router.include_router(router_impots)
