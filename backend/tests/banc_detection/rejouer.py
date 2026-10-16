"""Rejoue la détection sur tout le banc et dit ce qu'elle a trouvé.

À lancer après chaque étape du chantier de détection, depuis backend/ :

    python -m tests.banc_detection.rejouer              # le bilan et les échecs
    python -m tests.banc_detection.rejouer --tout       # chaque échec en détail
    python -m tests.banc_detection.rejouer --enregistrer

`--enregistrer` fige les cas synthétiques réussis dans reference.json :
test_banc_detection.py échoue ensuite dès que l'un d'eux cesse de l'être. Les
vrais relevés n'y figurent jamais : ils ne quittent pas cette machine, leurs
noms non plus.

CE QUI EST MESURÉ. Pour chaque colonne : la propriété retenue (« ne pas
importer » compris). Pour chaque fichier : la ligne où commencent les données.
Le mode de lecture des montants, l'ordre du fichier et les séparateurs ne le
sont qu'à partir du moment où la détection les rend : avant, le bilan dit
« non mesuré » plutôt que de compter un échec qui n'en est pas un.
"""
from __future__ import annotations

import argparse
import json
import sys
from dataclasses import dataclass, field
from pathlib import Path

from app.services.detection_colonnes import detecter_colonnes
from app.services.import_bancaire import _lire_toutes_les_lignes

from .variantes import Cas, tous_les_cas

REFERENCE = Path(__file__).parent / "reference.json"
# Ce que la détection ne rend pas encore, et qu'on mesurera dès qu'elle le rendra.
_EXTRAS = ("mode_montants", "ordre", "separateur", "separateur_decimal", "encodage")


@dataclass
class Resultat:
    cas: Cas
    colonnes_justes: int = 0
    colonnes: int = 0
    entete_juste: bool = False
    ecarts: list[str] = field(default_factory=list)
    extras: dict[str, bool] = field(default_factory=dict)
    erreur: str = ""

    @property
    def parfait(self) -> bool:
        return (
            not self.erreur
            and self.entete_juste
            and self.colonnes_justes == self.colonnes
            and all(self.extras.values())
        )


def _nom_propriete(propriete: str) -> str:
    return propriete or "(ne pas importer)"


def evaluer(cas: Cas) -> Resultat:
    attendu = cas.attendu
    r = Resultat(cas, colonnes=len(attendu["proprietes"]))
    try:
        lignes = _lire_toutes_les_lignes(cas.contenu)
        detection = detecter_colonnes(lignes)
    except Exception as exc:  # un plantage est un échec à lister, pas à subir
        r.erreur = f"{type(exc).__name__}: {exc}"
        return r
    trouvees = {c["index"]: c["propriete"] for c in detection["configuration"]}
    entetes = {c["index"]: c["entete"] for c in detection["colonnes"]}
    for j, propriete in enumerate(attendu["proprietes"], start=1):
        obtenue = trouvees.get(j, "")
        if obtenue == propriete:
            r.colonnes_justes += 1
        else:
            r.ecarts.append(
                f"col {j} « {entetes.get(j, '')} » : attendu {_nom_propriete(propriete)}, "
                f"obtenu {_nom_propriete(obtenue)}"
            )
    r.entete_juste = detection["lignes_entete"] == attendu["lignes_entete"]
    if not r.entete_juste:
        r.ecarts.append(
            f"données à partir de la ligne {detection['lignes_entete'] + 1}, "
            f"attendu {attendu['lignes_entete'] + 1}"
        )
    for cle in _EXTRAS:
        if cle in detection:
            r.extras[cle] = detection[cle] == attendu[cle]
            if not r.extras[cle]:
                r.ecarts.append(f"{cle} : attendu {attendu[cle]}, obtenu {detection[cle]}")
    return r


def _pourcentage(n: int, total: int) -> str:
    return f"{n}/{total} ({100 * n / total:.1f} %)".replace(".", ",") if total else "0/0"


def bilan(resultats: list[Resultat], tout: bool = False) -> str:
    lignes = []
    reels = sum(1 for r in resultats if not r.cas.synthetique)
    lignes.append(
        f"Banc de détection : {len(resultats)} fichiers "
        f"({len(resultats) - reels} synthétiques, {reels} issus de vrais relevés)"
    )
    colonnes = sum(r.colonnes for r in resultats)
    justes = sum(r.colonnes_justes for r in resultats)
    lignes.append(f"  Colonnes correctes        : {_pourcentage(justes, colonnes)}")
    lignes.append(f"  Ligne de début correcte   : {_pourcentage(sum(r.entete_juste for r in resultats), len(resultats))}")
    lignes.append(f"  Fichiers 100 % corrects   : {_pourcentage(sum(r.parfait for r in resultats), len(resultats))}")
    for cle in _EXTRAS:
        mesures = [r.extras[cle] for r in resultats if cle in r.extras]
        lignes.append(
            f"  {cle:<25} : " + (_pourcentage(sum(mesures), len(mesures)) if mesures else "non mesuré")
        )

    # Par transformation : ce qui casse quoi.
    par_transformation: dict[str, list[Resultat]] = {}
    for r in resultats:
        cle = r.cas.nom.split("/", 1)[1] if "/" in r.cas.nom else "(base)"
        cle = "combinaisons" if cle.startswith("combinaison_") else cle
        par_transformation.setdefault(cle, []).append(r)
    lignes.append("")
    lignes.append("Par transformation (fichiers 100 % corrects) :")
    for cle, groupe in sorted(par_transformation.items()):
        lignes.append(f"  {cle:<28} {_pourcentage(sum(r.parfait for r in groupe), len(groupe))}")

    echecs = [r for r in resultats if not r.parfait]
    lignes.append("")
    lignes.append(f"Échecs ({len(echecs)}) :")
    for r in echecs:
        if r.erreur:
            lignes.append(f"  {r.cas.nom} : ERREUR {r.erreur}")
            continue
        detail = r.ecarts if tout else r.ecarts[:2]
        suite = f" (+{len(r.ecarts) - 2})" if not tout and len(r.ecarts) > 2 else ""
        lignes.append(f"  {r.cas.nom} : " + " ; ".join(detail) + suite)
    return "\n".join(lignes)


def charger_reference() -> dict:
    if not REFERENCE.exists():
        return {"parfaits": []}
    return json.loads(REFERENCE.read_text(encoding="utf-8"))


def regressions(resultats: list[Resultat], reference: dict) -> list[str]:
    """Les cas synthétiques qui étaient parfaits et ne le sont plus."""
    attendus = set(reference.get("parfaits", []))
    return sorted(r.cas.nom for r in resultats if r.cas.nom in attendus and not r.parfait)


def main() -> int:
    if hasattr(sys.stdout, "reconfigure"):
        sys.stdout.reconfigure(encoding="utf-8")
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--tout", action="store_true", help="chaque écart de chaque échec")
    parser.add_argument("--enregistrer", action="store_true", help="figer les réussites synthétiques")
    args = parser.parse_args()

    resultats = [evaluer(cas) for cas in tous_les_cas()]
    print(bilan(resultats, args.tout))

    perdus = regressions(resultats, charger_reference())
    print()
    if perdus:
        print(f"RÉGRESSIONS par rapport à reference.json ({len(perdus)}) :")
        for nom in perdus:
            print(f"  {nom}")
    else:
        print("Aucune régression par rapport à reference.json.")

    if args.enregistrer:
        synthetiques = [r for r in resultats if r.cas.synthetique]
        REFERENCE.write_text(
            json.dumps(
                {
                    "parfaits": sorted(r.cas.nom for r in synthetiques if r.parfait),
                    "colonnes_correctes": sum(r.colonnes_justes for r in synthetiques),
                    "colonnes": sum(r.colonnes for r in synthetiques),
                },
                ensure_ascii=False,
                indent=2,
            )
            + "\n",
            encoding="utf-8",
        )
        print(f"Référence enregistrée : {REFERENCE.name}")
    return 1 if perdus else 0


if __name__ == "__main__":
    sys.exit(main())
