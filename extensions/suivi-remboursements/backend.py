"""Point d'entrée backend de l'extension « Suivi des remboursements ».

Cf. app/extensions.py : le noyau ne cherche ici qu'une variable `router`.

CE QUI N'EST PAS ICI : le schéma. La table `profil_remboursement` et la colonne
`operation.profil_remboursement_id` vivent dans le noyau, posées par la migration
0054 — une extension n'emporte jamais ses tables. L'éteindre ne détache donc
aucune opération : l'écran disparaît, les rattachements dorment en base, et tout
revient à la réactivation.

CE QUE L'EXTENSION NE TOUCHE PAS : le calcul. Elle ne crée, ne modifie et ne
supprime AUCUNE opération, et ne change aucun montant. Elle écrit exactement une
colonne — celle qui dit à qui une dette se rapporte — et lit tout le reste. Les
soldes, les KPI, l'histogramme et la carte « Reste à rembourser » du dashboard
donnent rigoureusement les mêmes chiffres qu'elle soit allumée ou éteinte ; elle
ne fait que les ventiler par profil.
"""
from fastapi import APIRouter, Depends

from app.extensions import exiger_extension

from routeur_suivi_remboursements import router as router_suivi

router = APIRouter(dependencies=[Depends(exiger_extension("suivi-remboursements"))])
router.include_router(router_suivi)
