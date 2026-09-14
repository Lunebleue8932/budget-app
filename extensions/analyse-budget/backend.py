"""Point d'entrée backend de l'extension « Budget ».

Cf. app/extensions.py : le noyau ne cherche ici qu'une variable `router`.

CE QUI N'EST PAS ICI : le schéma. La colonne `operation.imprevue` et la table
`matelas_securite` vivent dans le noyau, posées par la migration 0059 — une
extension n'emporte jamais ses tables. L'éteindre ne perd donc aucune étiquette
ni aucun seuil : l'écran disparaît, les données dorment en base, et tout revient
à la réactivation.

CE QUE L'EXTENSION NE TOUCHE PAS : le calcul. Elle ne crée, ne modifie et ne
supprime AUCUNE opération, et ne change aucun montant. Les soldes, les KPI,
l'histogramme et le camembert donnent rigoureusement les mêmes chiffres qu'elle
tourne ou non — elle ne fait que lire autrement ce qui existe déjà, et poser
deux valeurs que rien d'autre ne lit.
"""
from fastapi import APIRouter, Depends

from app.extensions import exiger_extension

from routeur_analyse_budget import router as router_analyse

router = APIRouter(dependencies=[Depends(exiger_extension("analyse-budget"))])
router.include_router(router_analyse)
