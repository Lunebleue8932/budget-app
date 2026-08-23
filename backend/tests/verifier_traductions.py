"""Repère les phrases d'interface qui n'ont pas de traduction anglaise.

À LANCER À LA MAIN, pas pendant la suite de tests : c'est un outil de relecture,
pas une assertion. Beaucoup de segments légitimes n'ont rien à traduire (un
symbole, un chiffre, un nom propre), et faire échouer la CI dessus reviendrait à
demander une entrée de dictionnaire pour « → ».

    python backend/tests/verifier_traductions.py

Il lit les mêmes textes que `traduireDomStatique` : le contenu textuel des
balises, plus les attributs traduisibles. Un écran d'extension est traduit
depuis le même dictionnaire que le noyau (cf. frontend/extensions.js), ses
fragments sont donc examinés eux aussi.
"""
import json
import re
import sys
from html.parser import HTMLParser
from pathlib import Path

RACINE = Path(__file__).resolve().parents[2]

# Les mêmes que ATTRIBUTS_TRADUISIBLES dans frontend/i18n.js.
ATTRIBUTS = ("placeholder", "title", "data-info")

FICHIERS = [
    RACINE / "frontend" / "index.html",
    *sorted(RACINE.glob("extensions/*/page.html")),
    *sorted(RACINE.glob("extensions-dev/*/page.html")),
]


class Textes(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.segments = []

    def handle_data(self, data):
        phrase = " ".join(data.split())
        if phrase:
            self.segments.append(phrase)

    def handle_starttag(self, tag, attrs):
        for nom, valeur in attrs:
            if nom in ATTRIBUTS and valeur:
                self.segments.append(" ".join(valeur.split()))


def cles_traduites():
    """Les clés du dictionnaire, lues telles qu'écrites dans i18n.js.

    Une lecture textuelle plutôt qu'une exécution du JavaScript : on n'a pas
    d'interpréteur sous la main, et les clés sont toutes des littéraux."""
    source = (RACINE / "frontend" / "i18n.js").read_text(encoding="utf-8")
    cles = set()
    for brut in re.findall(r'^\s*"((?:[^"\\]|\\.)*)"\s*:', source, re.M):
        cles.add(json.loads('"' + brut + '"'))
    # Clés JS sans guillemets (« Rechercher: "Search" ») : légales tant que le
    # nom est un identifiant, et le fichier en contient.
    for brut in re.findall(r"^\s*(\w+)\s*:\s*\"", source, re.M):
        cles.add(brut)
    return cles


def main():
    cles = cles_traduites()
    total = 0
    for fichier in FICHIERS:
        if not fichier.is_file():
            continue
        analyseur = Textes()
        analyseur.feed(fichier.read_text(encoding="utf-8"))
        manquants = [s for s in dict.fromkeys(analyseur.segments) if s not in cles]
        if not manquants:
            continue
        total += len(manquants)
        print(f"\n--- {fichier.relative_to(RACINE)} : {len(manquants)} segment(s)")
        for segment in manquants:
            print(json.dumps(segment, ensure_ascii=False))
    print(f"\n{total} segment(s) sans traduction.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
