"""Génère l'icône de l'application DANS LES TROIS FORMATS des trois systèmes.

Chaque système impose le sien, et aucun ne lit celui des autres : Windows veut
un .ico (conteneur multi-tailles incrusté dans l'exécutable), Linux un .png
(référencé par le fichier .desktop), macOS un .icns (conteneur Apple lu par le
Finder et le Dock). Le DESSIN, lui, est unique — il n'est décrit qu'une fois,
ci-dessous, et les trois conteneurs n'en sont que des emballages.

Écrit en bibliothèque standard uniquement (zlib + struct) : un encodeur PNG
minimal, puis les trois conteneurs. Cela évite d'ajouter Pillow comme
dépendance pour des fichiers générés une fois pour toutes — et permet de
produire les icônes des trois systèmes depuis n'importe lequel d'entre eux,
ce qui compte pour un projet dont les binaires sont construits en CI.

Le motif reprend l'identité du dashboard : fond bleu accent (#3b82f6, la
couleur --accent du frontend) et un histogramme blanc à trois barres.

Usage :
    python desktop/generer_icone.py

Pour utiliser une autre icône, il suffit de remplacer le fichier voulu dans
`desktop/platforms/<systeme>/` : rien d'autre ne dépend de ce script.
"""
import struct
import zlib
from pathlib import Path

# Couleurs (RGBA). Fond : --accent du frontend ; barres : blanc légèrement
# transparent pour les plus basses, afin de garder du relief à petite taille.
FOND = (59, 130, 246, 255)
BARRE = (255, 255, 255, 255)
TAILLES = (16, 32, 48, 64, 128, 256)

# Histogramme décrit en proportions du canevas (x_gauche, x_droite, hauteur),
# indépendant de la taille finale : mêmes proportions à 16 et à 256 px.
BARRES = ((0.22, 0.38, 0.38), (0.42, 0.58, 0.66), (0.62, 0.78, 0.50))


def _dessiner(taille: int) -> list[list[tuple[int, int, int, int]]]:
    """Canevas RGBA : fond plein, coins arrondis, puis les barres."""
    pixels = [[FOND for _ in range(taille)] for _ in range(taille)]

    # Coins arrondis : on rend transparent ce qui déborde du rayon, pour que
    # l'icône ne soit pas un carré brut parmi les icônes système.
    rayon = max(2, round(taille * 0.18))
    for y in range(taille):
        for x in range(taille):
            for cx, cy in ((rayon, rayon), (taille - 1 - rayon, rayon),
                           (rayon, taille - 1 - rayon), (taille - 1 - rayon, taille - 1 - rayon)):
                dans_zone_coin = (
                    (x < rayon and y < rayon and (cx, cy) == (rayon, rayon))
                    or (x > taille - 1 - rayon and y < rayon and (cx, cy) == (taille - 1 - rayon, rayon))
                    or (x < rayon and y > taille - 1 - rayon and (cx, cy) == (rayon, taille - 1 - rayon))
                    or (
                        x > taille - 1 - rayon
                        and y > taille - 1 - rayon
                        and (cx, cy) == (taille - 1 - rayon, taille - 1 - rayon)
                    )
                )
                if dans_zone_coin and (x - cx) ** 2 + (y - cy) ** 2 > rayon**2:
                    pixels[y][x] = (0, 0, 0, 0)

    base = round(taille * 0.80)  # ligne de base commune aux barres
    for gauche, droite, hauteur in BARRES:
        x0, x1 = round(taille * gauche), round(taille * droite)
        y0 = base - round(taille * hauteur)
        for y in range(max(0, y0), min(taille, base)):
            for x in range(max(0, x0), min(taille, x1)):
                pixels[y][x] = BARRE
    return pixels


def _encoder_png(pixels: list[list[tuple[int, int, int, int]]]) -> bytes:
    """Encodeur PNG minimal (RGBA 8 bits, filtre 0)."""
    taille = len(pixels)
    brut = b"".join(
        b"\x00" + bytes(composante for pixel in ligne for composante in pixel) for ligne in pixels
    )

    def bloc(nom: bytes, donnees: bytes) -> bytes:
        entete = struct.pack(">I", len(donnees)) + nom
        return entete + donnees + struct.pack(">I", zlib.crc32(nom + donnees) & 0xFFFFFFFF)

    entete_image = struct.pack(">IIBBBBB", taille, taille, 8, 6, 0, 0, 0)
    return (
        b"\x89PNG\r\n\x1a\n"
        + bloc(b"IHDR", entete_image)
        + bloc(b"IDAT", zlib.compress(brut, 9))
        + bloc(b"IEND", b"")
    )


def _encoder_ico(images_png: dict[int, bytes]) -> bytes:
    """Conteneur ICO à entrées PNG (supporté depuis Windows Vista)."""
    entetes, corps = b"", b""
    decalage = 6 + 16 * len(images_png)
    for taille, png in sorted(images_png.items()):
        # 0 dans le champ largeur/hauteur signifie 256 px.
        entetes += struct.pack(
            "<BBBBHHII",
            taille if taille < 256 else 0,
            taille if taille < 256 else 0,
            0,
            0,
            1,
            32,
            len(png),
            decalage,
        )
        corps += png
        decalage += len(png)
    return struct.pack("<HHH", 0, 1, len(images_png)) + entetes + corps


# Tailles retenues par le conteneur ICNS d'Apple, et le type de quatre octets
# qui désigne chacune. Seules celles-ci sont admises : une taille absente de
# cette table ferait un fichier que le Finder refuse d'afficher.
TYPES_ICNS = {
    16: b"icp4",
    32: b"icp5",
    64: b"icp6",
    128: b"ic07",
    256: b"ic08",
}


def _encoder_icns(images_png: dict[int, bytes]) -> bytes:
    """Conteneur ICNS à entrées PNG (macOS 10.7+).

    Structure : un en-tête « icns » + longueur totale, puis une suite de blocs
    [type sur 4 octets][longueur totale du bloc][données PNG]. Les longueurs
    sont en BIG-endian, contrairement à l'ICO de Windows — c'est un format
    Apple, hérité du Mac OS classique sur processeurs Motorola."""
    corps = b""
    for taille, png in sorted(images_png.items()):
        type_icns = TYPES_ICNS.get(taille)
        if type_icns is None:
            continue
        corps += type_icns + struct.pack(">I", len(png) + 8) + png
    return b"icns" + struct.pack(">I", len(corps) + 8) + corps


def main() -> None:
    """Écrit les trois formats, chacun dans le dossier de SA plateforme.

    Un seul dessin, trois conteneurs : c'est le même histogramme qui part en
    .ico (Windows), .png (Linux) et .icns (macOS). Générer les trois d'un coup
    évite qu'un changement d'identité visuelle ne s'applique qu'à un système —
    et qu'il faille une machine par système pour les produire."""
    images = {taille: _encoder_png(_dessiner(taille)) for taille in TAILLES}
    plateformes = Path(__file__).resolve().parent / "platforms"

    sorties = {
        plateformes / "windows" / "icone.ico": _encoder_ico(images),
        # Linux lit un PNG simple : on prend la plus grande taille, les
        # environnements de bureau réduisent eux-mêmes.
        plateformes / "linux" / "icone.png": images[max(images)],
        plateformes / "macos" / "icone.icns": _encoder_icns(images),
    }
    for destination, contenu in sorties.items():
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_bytes(contenu)
        print(f"Icône générée : {destination} ({len(contenu)} octets)")


if __name__ == "__main__":
    main()
