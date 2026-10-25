"""Génère la carte du monde de l'écran « Où c'est exposé » (`carte-monde.js`) et la table des noms de
pays (`pays_iso.py`). À relancer SEULEMENT pour changer la carte : les deux fichiers produits sont versionnés.

SOURCES (domaine public / licences libres, rien n'est lu à l'exécution de l'application) :
  - fonds de carte : Natural Earth via le paquet npm `world-atlas` (countries-50m.json, domaine public) ;
  - noms de pays (FR / EN / PT) et codes ISO : paquet npm `i18n-iso-countries` (MIT).

USAGE :
  python generer_carte.py <countries-50m.json> <codes.json> <fr.json> <en.json> <pt.json>

PROJECTION : équirectangulaire (« plate carrée »), une carte aplatie et classique : la longitude et la
latitude deviennent x et y telles quelles. Moins réaliste qu'une projection qui conserve les aires, mais
lisible d'un coup d'œil et peu haute (environ 2,6 de large pour 1), ce qui laisse la place d'une carte à côté
d'un camembert. Calculée ICI : l'écran ne reçoit que des tracés SVG déjà projetés dans une boîte de 1000 de
large. L'Antarctique est omis.
"""
import json
import math
import sys
from pathlib import Path

A1, A2, A3, A4 = 1.340264, -0.081106, 0.000893, 0.003796
LARGEUR = 1000.0


def projeter(lon, lat):
    return lon, lat


def projeter_equal_earth(lon, lat):
    """L'ancienne projection (aires conservées), gardée pour mémoire."""
    phi = math.radians(lat)
    lam = math.radians(lon)
    theta = math.asin(math.sqrt(3) / 2 * math.sin(phi))
    t2, t6 = theta**2, theta**6
    x = 2 * math.sqrt(3) * lam * math.cos(theta) / (3 * (9 * A4 * t2**4 + 7 * A3 * t6 + 3 * A2 * t2 + A1))
    y = theta * (A1 + A2 * t2 + t6 * (A3 + A4 * t2))
    return x, y


def decoder_arcs(topo):
    sx, sy = topo["transform"]["scale"]
    tx, ty = topo["transform"]["translate"]
    arcs = []
    for arc in topo["arcs"]:
        x = y = 0
        points = []
        for dx, dy in arc:
            x += dx
            y += dy
            points.append((x * sx + tx, y * sy + ty))
        arcs.append(points)
    return arcs


def anneau(indices, arcs):
    points = []
    for i in indices:
        arc = arcs[i] if i >= 0 else arcs[~i][::-1]
        points.extend(arc if not points else arc[1:])
    return points


TOLERANCE = 0.45   # simplification (Douglas-Peucker), en unités de la carte (1000 de large)
AIRE_MIN = 2.0     # un îlot plus petit disparaît, sauf le plus grand morceau de chaque pays


def douglas_peucker(points, tol):
    if len(points) < 3:
        return points
    (x1, y1), (x2, y2) = points[0], points[-1]
    dx, dy = x2 - x1, y2 - y1
    norme = math.hypot(dx, dy) or 1e-12
    dmax, idx = 0.0, 0
    for i in range(1, len(points) - 1):
        d = abs(dy * points[i][0] - dx * points[i][1] + x2 * y1 - y2 * x1) / norme
        if d > dmax:
            dmax, idx = d, i
    if dmax <= tol:
        return [points[0], points[-1]]
    return douglas_peucker(points[: idx + 1], tol)[:-1] + douglas_peucker(points[idx:], tol)


def aire(points):
    return abs(sum(points[i][0] * points[(i + 1) % len(points)][1] - points[(i + 1) % len(points)][0] * points[i][1]
                   for i in range(len(points)))) / 2


def couper_a_l_antimeridien(pts, seuil=180.0):
    """Un anneau qui passe de +180° à -180° (la Russie) devient un trait à travers toute la carte : on le
    coupe à chaque saut, et chaque morceau se referme de son côté."""
    n = len(pts)
    sauts = [i for i in range(n) if abs(pts[i][0] - pts[(i + 1) % n][0]) > seuil]
    if not sauts:
        return [pts]
    depart = (sauts[0] + 1) % n
    tourne = pts[depart:] + pts[:depart]
    morceaux, courant = [], [tourne[0]]
    for a, b in zip(tourne, tourne[1:]):
        if abs(a[0] - b[0]) > seuil:
            morceaux.append(courant)
            courant = []
        courant.append(b)
    morceaux.append(courant)
    return [m for m in morceaux if len(m) >= 3]


def main(chemin_topo, chemin_codes, *chemins_noms):
    topo = json.loads(Path(chemin_topo).read_text(encoding="utf-8"))
    codes = json.loads(Path(chemin_codes).read_text(encoding="utf-8"))
    par_numerique = {int(c[2]): c[0] for c in codes}
    noms = [json.loads(Path(p).read_text(encoding="utf-8"))["countries"] for p in chemins_noms]
    arcs = decoder_arcs(topo)

    brut = {}
    xs, ys = [], []
    # LA CONTIGUÏTÉ : deux anneaux de pays différents qui partagent un arc de la topologie sont limitrophes.
    # Elle sert à l'écran à regrouper en UN territoire les pays voisins d'une même zone (cf. ioTerritoires).
    anneau_arcs: dict[int, set] = {}
    anneau_pays: dict[int, str] = {}
    prochain = 0
    for geom in topo["objects"]["countries"]["geometries"]:
        numerique = int(geom["id"]) if geom.get("id") not in (None, "") else None
        alpha2 = par_numerique.get(numerique)
        if alpha2 is None or alpha2 == "AQ":
            continue
        polys = geom["arcs"] if geom["type"] == "MultiPolygon" else [geom["arcs"]]
        anneaux = []
        for poly in polys:
            for ring in poly:
                identifiant = prochain
                prochain += 1
                anneau_arcs[identifiant] = {i if i >= 0 else ~i for i in ring}
                anneau_pays[identifiant] = alpha2
                pts = [projeter(lon, lat) for lon, lat in anneau(ring, arcs)]
                for morceau in couper_a_l_antimeridien(pts):
                    anneaux.append((identifiant, morceau))
                    xs += [p[0] for p in morceau]
                    ys += [p[1] for p in morceau]
        brut.setdefault(alpha2, []).extend(anneaux)

    x0, y0 = min(xs), min(ys)
    echelle = LARGEUR / (max(xs) - x0)
    ymax = max(ys)
    hauteur = (ymax - y0) * echelle
    pays = []
    finals: dict[str, list] = {}
    for alpha2, anneaux in sorted(brut.items()):
        morceaux = []
        bx0 = by0 = bx1 = by1 = 0.0
        origines = [identifiant for identifiant, _ in anneaux]
        mis = [[((x - x0) * echelle, (ymax - y) * echelle) for x, y in pts] for _, pts in anneaux]
        plus_grand = max(mis, key=aire)
        for origine, pts in zip(origines, mis):
            est_grand = pts is plus_grand
            if not est_grand and aire(pts) < AIRE_MIN:
                continue
            # Un anneau est fermé (début = fin) : on le coupe au point le plus éloigné du départ.
            loin = max(range(len(pts)), key=lambda i: math.hypot(pts[i][0] - pts[0][0], pts[i][1] - pts[0][1]))
            pts = douglas_peucker(pts[: loin + 1], TOLERANCE)[:-1] + douglas_peucker(pts[loin:], TOLERANCE)
            pts = [(round(x, 1), round(y, 1)) for x, y in pts]
            dedup = [pts[0]]
            for p in pts[1:]:
                if p != dedup[-1]:
                    dedup.append(p)
            if len(dedup) < 3:
                continue
            # Un anneau qui enjambe l'antimeridien (Russie, Fidji) ressort en trait traversant toute la
            # carte une fois simplifié : il est écarté (les îles voisines, elles, restent).
            largeur_anneau = max(x for x, _ in dedup) - min(x for x, _ in dedup)
            if largeur_anneau > 300 and len(dedup) <= 10:
                continue
            # LA BOÎTE D'UN PAYS est celle de son plus grand morceau : la Guyane ne compte pas dans
            # celle de la France, ni Hawaï dans celle des États-Unis (elle sert à remplir une région
            # « comme une jauge », cf. ioRenderCarte).
            if est_grand or bx1 == 0.0:
                bx0 = min(x for x, _ in dedup)
                by0 = min(y for _, y in dedup)
                bx1 = max(x for x, _ in dedup)
                by1 = max(y for _, y in dedup)
            morceaux.append("M" + "L".join(f"{x:g},{y:g}" for x, y in dedup) + "Z")
            finals.setdefault(alpha2, []).append(
                (origine, (min(x for x, _ in dedup), min(y for _, y in dedup), max(x for x, _ in dedup), max(y for _, y in dedup)))
            )
        if morceaux:
            pays.append({"c": alpha2, "d": "".join(morceaux), "b": [bx0, by0, bx1, by1]})

    # Les voisins de chaque anneau final : `["FR:0", ...]` (pays : rang de l'anneau dans son tracé).
    par_arc: dict[int, list] = {}
    for identifiant, arcs_de in anneau_arcs.items():
        for arc in arcs_de:
            par_arc.setdefault(arc, []).append(identifiant)
    limitrophes: dict[int, set] = {}
    for liste in par_arc.values():
        for a in liste:
            for b in liste:
                if a != b and anneau_pays[a] != anneau_pays[b]:
                    limitrophes.setdefault(a, set()).add(b)
    par_origine: dict[int, list] = {}
    for alpha2, liste in finals.items():
        for rang, (origine, boite) in enumerate(liste):
            par_origine.setdefault(origine, []).append((alpha2, rang, boite))

    def se_touchent(b1, b2, marge=3.0):
        return not (b1[2] + marge < b2[0] or b2[2] + marge < b1[0] or b1[3] + marge < b2[1] or b2[3] + marge < b1[1])

    for p in pays:
        voisins = []
        for rang, (origine, boite) in enumerate(finals[p["c"]]):
            liens = []
            for autre in limitrophes.get(origine, ()):
                for code, r, b2 in par_origine.get(autre, []):
                    if se_touchent(boite, b2):
                        liens.append(f"{code}:{r}")
            voisins.append(sorted(liens))
        p["v"] = voisins

    dossier = Path(__file__).resolve().parent.parent
    carte = {"largeur": LARGEUR, "hauteur": round(hauteur, 1), "pays": pays}
    (dossier / "carte-monde.js").write_text(
        "/* GÉNÉRÉ par outils/generer_carte.py (Natural Earth, domaine public) — ne pas modifier à la main. */\n"
        "const IO_CARTE = " + json.dumps(carte, ensure_ascii=False, separators=(",", ":")) + ";\n",
        encoding="utf-8",
    )
    lignes = ['"""GÉNÉRÉ par outils/generer_carte.py (i18n-iso-countries, MIT) — ne pas modifier à la main.',
              "",
              'Les pays de la carte : code ISO alpha-2 -> (nom français, anglais, portugais)."""',
              "PAYS = {"]
    for p in pays:
        lignes.append(f'    "{p["c"]}": ({", ".join(json.dumps(n.get(p["c"], p["c"]), ensure_ascii=False) for n in noms)}),')
    lignes.append("}")
    (dossier / "pays_iso.py").write_text("\n".join(lignes) + "\n", encoding="utf-8")
    print(len(pays), "pays,", round((dossier / "carte-monde.js").stat().st_size / 1024), "Ko")


if __name__ == "__main__":
    main(*sys.argv[1:])
