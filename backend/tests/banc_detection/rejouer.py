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
from typing import Optional
from types import SimpleNamespace

from app.services.detection_colonnes import detecter_fichier
from app.services.import_bancaire import _lire_toutes_les_lignes, separateur_decimal_du_fichier
from app.services.reconnaissance_presets import ajuster, memoriser_signature, reconnaitre

from .variantes import Cas, tous_les_cas

REFERENCE = Path(__file__).parent / "reference.json"
# Ce que la détection ne rend pas encore, et qu'on mesurera dès qu'elle le rendra.
_EXTRAS = (
    "mode_montants", "ordre", "separateur", "separateur_decimal", "encodage", "format_date",
    "lignes_pied", "colonne_solde",
)


def _meme_extra(cle: str, attendu, obtenu, contenu: bytes) -> bool:
    if attendu == obtenu:
        return True
    if cle == "encodage" and attendu and obtenu:
        # Deux encodages qui lisent ce fichier à l'identique (un fichier tout
        # en ASCII se lit pareil en UTF-8, Windows-1252 et ISO-8859-1).
        try:
            return contenu.decode(attendu) == contenu.decode(obtenu)
        except UnicodeDecodeError:
            return False
    return False


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


def _mode_des_proprietes(proprietes: list[str]) -> Optional[str]:
    pris = set(proprietes)
    if {"montant_debit", "montant_credit"} <= pris:
        return "debit_credit"
    if "montant" in pris:
        return "montant_sens" if "sens" in pris else "algebrique"
    return None


def _proprietes_resolues(attendu: dict, trouvees: dict, resultat: "Resultat") -> list[str]:
    """Les propriétés attendues, colonne par colonne, les choix équivalents
    résolus : dans chaque groupe, la solution que la détection a retenue si elle
    en a retenu une exactement, sinon la première (et l'écart est noté)."""
    proprietes = list(attendu["proprietes"])
    for groupe in attendu.get("groupes", []):
        colonnes = {c for solution in groupe for c in solution}
        retenue = next(
            (
                solution for solution in groupe
                if all(trouvees.get(c, "") == solution.get(c, "") for c in colonnes)
            ),
            None,
        )
        if retenue is None:
            retenue = groupe[0]
            resultat.ecarts.append(
                "aucune des solutions équivalentes : "
                + " ou ".join(
                    "+".join(f"col {c} {p}" for c, p in sorted(s.items())) or "rien" for s in groupe
                )
            )
        for c in colonnes:
            if c - 1 < len(proprietes):
                proprietes[c - 1] = retenue.get(c, "")
    return proprietes


def evaluer(cas: Cas) -> Resultat:
    attendu = cas.attendu
    r = Resultat(cas, colonnes=len(attendu["proprietes"]))
    try:
        detection = detecter_fichier(cas.contenu)
    except Exception as exc:  # un plantage est un échec à lister, pas à subir
        r.erreur = f"{type(exc).__name__}: {exc}"
        return r
    trouvees = {c["index"]: c["propriete"] for c in detection["configuration"]}
    entetes = {c["index"]: c["entete"] for c in detection["colonnes"]}
    proprietes = _proprietes_resolues(attendu, trouvees, r)
    for j, propriete in enumerate(proprietes, start=1):
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
    if attendu.get("groupes"):
        # Le mode attendu suit la solution retenue (un montant, ou le couple).
        attendu = {**attendu, "mode_montants": _mode_des_proprietes(proprietes)}
    for cle in _EXTRAS:
        # Ce que la détection ne rend pas encore, ou que le cas ne fixe pas
        # (un classeur n'a pas de séparateur décimal), ne se mesure pas.
        if cle in detection and attendu.get(cle) is not None:
            r.extras[cle] = _meme_extra(cle, attendu[cle], detection[cle], cas.contenu)
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


# ---------- La reconnaissance des presets ----------


def _preset_de(nom: str, identifiant: int, cas: Cas):
    """Le preset qu'un utilisateur aurait réglé sur ce relevé, avec sa
    signature mémorisée — un objet qui en a les attributs, sans base."""
    attendu = cas.attendu
    preset = SimpleNamespace(
        id=identifiant,
        nom=nom,
        colonnes=[
            {"index": i, "propriete": p}
            for i, p in enumerate(attendu["proprietes"], start=1)
            if p
        ],
        lignes_entete=attendu["lignes_entete"],
        lignes_pied=attendu["lignes_pied"],
        signature_entetes=None,
        nombre_colonnes=None,
        motif_nom_fichier=None,
        libelles_sens_sortie=[],
        libelles_sens_entree=[],
    )
    memoriser_signature(preset, _lire_toutes_les_lignes(cas.contenu), None, ecraser=True)
    return preset


def _meme_format(a, b) -> bool:
    """Deux presets qui lisent le même format : mêmes colonnes, mêmes lignes
    de tête. Deux exemples d'une même banque en donnent des jumeaux."""
    return (
        sorted((c["index"], c["propriete"]) for c in a.colonnes)
        == sorted((c["index"], c["propriete"]) for c in b.colonnes)
        and a.lignes_entete == b.lignes_entete
    )


def _base_du_cas(cas: Cas) -> str:
    return cas.nom.split("/", 1)[0]


def _meme_lecture(cas: Cas, base: Cas) -> bool:
    """Le preset de la base sait-il lire ce cas ? Oui tant que les colonnes,
    les lignes de tête et le séparateur décimal n'ont pas bougé. L'écriture des
    dates peut changer : l'ordre jour/mois se lit sur le fichier (cf.
    import_bancaire.format_date_du_fichier)."""
    return all(
        cas.attendu[cle] == base.attendu[cle]
        for cle in ("proprietes", "lignes_entete", "separateur_decimal")
    )


_PROPRIETES_DE_LECTURE = ("date", "nature", "montant", "montant_debit", "montant_credit", "sens")


def _colonnes_permises(attendu: dict) -> dict[str, set[int]]:
    """Où chaque propriété de lecture peut se trouver dans ce cas : sa colonne
    attendue, et celles que les choix équivalents admettent."""
    permises: dict[str, set[int]] = {}
    for j, propriete in enumerate(attendu["proprietes"], start=1):
        if propriete in _PROPRIETES_DE_LECTURE:
            permises.setdefault(propriete, set()).add(j)
    for groupe in attendu.get("groupes", []):
        for solution in groupe:
            for j, propriete in solution.items():
                if propriete in _PROPRIETES_DE_LECTURE:
                    permises.setdefault(propriete, set()).add(j)
    return permises


def _lit_correctement(preset, attendu: dict) -> bool:
    """CE QUE L'UTILISATEUR VOIT : le preset finalement utilisé lit la date,
    le libellé et le montant dans les bonnes colonnes, et commence au bon
    endroit. Deux presets d'une même banque qui y parviennent se valent."""
    if preset is None or preset.lignes_entete != attendu["lignes_entete"]:
        return False
    permises = _colonnes_permises(attendu)
    lues = {c["propriete"]: c["index"] for c in preset.colonnes if c.get("propriete")}
    if not any(p in lues for p in ("montant", "montant_debit")):
        return False
    return all(
        p not in lues or lues[p] in permises.get(p, set())
        for p in _PROPRIETES_DE_LECTURE
    ) and all(p in lues for p in ("date",) if p in permises)


def evaluer_reconnaissance(cas: list[Cas]) -> tuple[int, int, list[str]]:
    """Sur chaque cas que le preset de sa base sait lire, deux essais : ce
    preset sélectionné, puis un preset qui NE le lit PAS. Réussi quand le preset
    finalement utilisé — le sélectionné s'il est gardé, le proposé s'il y a
    bascule — lit correctement le fichier (cf. _lit_correctement). Le fichier
    est lu comme l'aperçu le lit (séparateur décimal du fichier compris).
    (réussites, essais, échecs)."""
    bases = {c.nom: c for c in cas if "/" not in c.nom}
    presets = {nom: _preset_de(nom, i, c) for i, (nom, c) in enumerate(bases.items(), start=1)}
    par_id = {p.id: p for p in presets.values()}
    noms = list(presets)
    reussites, essais, echecs = 0, 0, []
    for c in cas:
        base = bases.get(_base_du_cas(c))
        if base is None or not _meme_lecture(c, base):
            continue
        lignes = _lire_toutes_les_lignes(c.contenu)
        decimal = separateur_decimal_du_fichier(lignes)
        ajustements = [ajuster(p, lignes, separateur_decimal=decimal) for p in presets.values()]
        bon = presets[base.nom]
        suivants = noms[noms.index(base.nom) + 1:] + noms[:noms.index(base.nom)]
        autre = next(
            (presets[n] for n in suivants if not _lit_correctement(presets[n], c.attendu)), None
        )
        for selectionne, libelle in ((bon, "bon"), (autre, "mauvais")):
            if selectionne is None:
                continue
            decision = reconnaitre(ajustements, selectionne.id)
            if decision.decision in ("appliquer", "ecarts"):
                final = selectionne
            elif decision.decision == "basculer":
                final = par_id[decision.propose.preset_id]
            else:
                final = None
            essais += 1
            if _lit_correctement(final, c.attendu):
                reussites += 1
            else:
                cible = f" → {final.nom}" if final is not None and final is not selectionne else ""
                echecs.append(f"{c.nom} ({libelle} preset sélectionné) : {decision.decision}{cible}")
    return reussites, essais, echecs


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

    cas = tous_les_cas()
    resultats = [evaluer(c) for c in cas]
    print(bilan(resultats, args.tout))

    reussites, essais, echecs = evaluer_reconnaissance(cas)
    print()
    print(f"Reconnaissance des presets : {_pourcentage(reussites, essais)}")
    for echec in echecs if args.tout else echecs[:10]:
        print(f"  {echec}")
    if not args.tout and len(echecs) > 10:
        print(f"  … et {len(echecs) - 10} autres (--tout)")

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
