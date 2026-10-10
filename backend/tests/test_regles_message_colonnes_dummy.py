"""Le message gris de l'éditeur de règles sous une condition sur une colonne dummy.

CE QUI COMPTE : l'éditeur annonce « cette partie de la reconnaissance » quand la règle peut
encore s'exécuter sans la colonne, « toute la règle » sinon — et ce qu'il annonce doit être
EXACTEMENT ce que le moteur d'import fait sur un preset qui ne lit pas la colonne. Ce n'est
pas le connecteur d'un seul niveau qui décide : un ET global au-dessus d'un groupe en OU, ou
un OU global au-dessus d'un groupe en ET, laissent tous deux la règle s'exécuter sans elle.

Le test exécute LA fonction de l'éditeur (`executableSansColonneDummy`, extensions/regles/
regles.js) avec Node, et confronte son verdict au moteur Python
(`regles_categorisation.evaluer_regle`) sur une ligne dont tout est vrai sauf la colonne
dummy, que le preset ne lit pas. Sans Node sur le poste, le test est sauté.
"""
import json
import shutil
import subprocess
from pathlib import Path

import pytest

from app.services import regles_categorisation

REGLES_JS = Path(__file__).resolve().parents[2] / "extensions" / "regles" / "regles.js"
DUMMY = {"champ": "dummy_1", "operateur": "contient", "valeur": "x"}
NATURE = {"champ": "nature", "operateur": "contient", "valeur": "x"}


def _groupe(operateur, *conditions):
    return {"operateur": operateur, "conditions": list(conditions)}


# (nom, connecteur global, groupes, message attendu : True = « partie », False = « toute »)
CAS = [
    ("ET global, groupe OU avec la colonne", "ET",
     [_groupe("OU", DUMMY, NATURE), _groupe("ET", NATURE)], True),
    ("ET global, groupe ET avec la colonne", "ET",
     [_groupe("ET", DUMMY, NATURE), _groupe("ET", NATURE)], False),
    ("OU global, groupe ET avec la colonne", "OU",
     [_groupe("ET", DUMMY, NATURE), _groupe("ET", NATURE)], True),
    ("OU global, groupe OU avec la colonne", "OU",
     [_groupe("OU", DUMMY, NATURE), _groupe("ET", NATURE)], True),
    ("OU global, groupe OU réduit à la colonne", "OU",
     [_groupe("OU", DUMMY), _groupe("ET", NATURE)], True),
    ("ET global, groupe OU réduit à la colonne", "ET",
     [_groupe("OU", DUMMY), _groupe("ET", NATURE)], False),
    ("OU global, un seul groupe ET", "OU", [_groupe("ET", DUMMY, NATURE)], False),
    ("OU global, chaque groupe dépend de la colonne", "OU",
     [_groupe("ET", DUMMY, NATURE), _groupe("OU", DUMMY)], False),
    ("ET global, un seul groupe OU", "ET", [_groupe("OU", DUMMY, NATURE)], True),
]

# Extrait la fonction du fichier de l'éditeur, tel quel, et l'exécute sur chaque cas.
_SCRIPT = r"""
const fs = require("fs");
const source = fs.readFileSync(process.argv[1], "utf8").replace(/\r\n/g, "\n");
const MOTIF_DUMMY_REGLE = /^dummy_([1-9][0-9]*)$/;
const idDummyRegle = (champ) => {
  const trouve = MOTIF_DUMMY_REGLE.exec(champ || "");
  return trouve ? Number(trouve[1]) : null;
};
const debut = source.indexOf("function executableSansColonneDummy");
if (debut < 0) throw new Error("executableSansColonneDummy introuvable dans regles.js");
const fonction = eval("(" + source.slice(debut, source.indexOf("\n}\n", debut) + 2) + ")");
const cas = JSON.parse(fs.readFileSync(0, "utf8"));
process.stdout.write(JSON.stringify(cas.map(([connecteur, groupes]) => fonction(groupes, connecteur, 1))));
"""


@pytest.fixture(scope="module")
def verdicts_editeur():
    node = shutil.which("node")
    if node is None:
        pytest.skip("Node n'est pas installé : l'éditeur de règles ne peut pas être exécuté")
    resultat = subprocess.run(
        [node, "-e", _SCRIPT, str(REGLES_JS)],
        input=json.dumps([[connecteur, groupes] for _, connecteur, groupes, _ in CAS]),
        capture_output=True,
        text=True,
        encoding="utf-8",
    )
    assert resultat.returncode == 0, resultat.stderr
    return json.loads(resultat.stdout)


@pytest.mark.parametrize("indice", range(len(CAS)), ids=[c[0] for c in CAS])
def test_le_message_de_l_editeur_dit_ce_que_fait_le_moteur(verdicts_editeur, indice):
    _, connecteur, groupes, attendu = CAS[indice]
    # Tout est vrai sur cette ligne, sauf la colonne dummy : le preset ne la lit pas.
    ligne = {"nature": "x", "colonnes_dummy": {}}
    moteur = regles_categorisation.evaluer_regle(
        {"operateur": connecteur, "groupes": groupes}, ligne
    )
    assert verdicts_editeur[indice] is attendu
    assert moteur is attendu
