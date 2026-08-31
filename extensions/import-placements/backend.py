"""Point d'entrée backend de l'extension « Import de placements ».

Le noyau ne cherche qu'une chose ici : une variable `router` (cf.
app/extensions.py::charger_routeur). Ce module ne fait donc que poser le
garde-fou d'activation sur le routeur de l'extension.

DEUX VERROUS, PAS UN. `exiger_extension("import-placements")` répond 404 tant
que l'utilisateur n'a pas coché la case de CETTE extension ; et comme son
manifeste déclare `requiert_une_de: ["placements"]`, `est_active` la considère
éteinte dès que « Placements financiers » l'est (cf.
app/extensions.dependances_satisfaites). Éteindre les placements éteint donc
l'import qui les alimente, sans qu'aucun code ait à le vérifier ici — ce qui
est la bonne façon : un import de titres sans écran de titres importerait dans
le vide.

CE QUI N'EST PAS PARTI ICI. Rien du schéma : le domaine du preset
(`ImportPreset.domaine`), le vocabulaire des trois types d'opération et
`Action.code_isin` vivent dans le noyau, posés par la migration 0041. C'est ce
qui permet de désactiver l'extension SANS PERDRE UN SEUL IMPORT : les presets,
leur historique et leur stock anti-doublons dorment en base, la page disparaît,
et tout revient intact à la réactivation. Une extension qui emporterait son
schéma imposerait de choisir entre supprimer les données et refuser la
désactivation — les deux mauvaises réponses.
"""
from fastapi import APIRouter, Depends

from app.extensions import exiger_extension

from routeur_import_placements import router as router_import_placements
from routeur_regles_placements import router as router_regles_placements

router = APIRouter(dependencies=[Depends(exiger_extension("import-placements"))])
router.include_router(router_import_placements)
# Les règles de type d'opération, écrites depuis l'onglet « Règles » de l'écran
# d'import. Sous le MÊME garde-fou : sans l'extension, ni l'écran qui les écrit
# ni l'import qui les consulte n'existent.
router.include_router(router_regles_placements)
