"""Lire un fichier de composition d'ETF, QUEL QU'EN SOIT LE FORMAT : classeur .xlsx, classeur
« Excel 2003 en XML » (les .xls d'iShares n'en sont pas d'autres) ou CSV.

POURQUOI PAS openpyxl SEUL. Un classeur publié par un émetteur porte parfois une feuille de
styles que openpyxl refuse (« Colors must be aRGB hex values » sur le fichier d'Amundi),
alors que les CELLULES sont parfaitement lisibles. L'import n'a besoin ni des styles ni des
formules : on lit donc le zip à la main, sans dépendance, et on ne demande jamais à la
bibliothèque de valider ce qui ne nous sert pas.

Le résultat est le même pour les trois formats : une liste de FEUILLES, chacune une liste de
lignes (tuples de cellules, `None` pour une cellule vide). Un CSV est une feuille unique.
"""
import csv
import io
import re
import zipfile
from dataclasses import dataclass, field
from typing import Optional
from xml.etree import ElementTree as ET

from app.services import import_bancaire

_NS_MAIN = "{http://schemas.openxmlformats.org/spreadsheetml/2006/main}"
_NS_REL = "{http://schemas.openxmlformats.org/officeDocument/2006/relationships}"
_NS_PKG_REL = "{http://schemas.openxmlformats.org/package/2006/relationships}"
_NS_SS = "{urn:schemas-microsoft-com:office:spreadsheet}"


@dataclass
class Feuille:
    nom: str
    lignes: list[tuple] = field(default_factory=list)


def _indice_colonne(reference: str) -> int:
    """« C7 » -> 2 (colonne C, en base zéro)."""
    lettres = re.match(r"[A-Z]+", reference).group(0)
    n = 0
    for c in lettres:
        n = n * 26 + (ord(c) - 64)
    return n - 1


def _nombre(texte: str):
    try:
        return float(texte)
    except ValueError:
        return texte


# ---------- .xlsx ----------


def _texte_xlsx(noeud) -> str:
    """Le texte d'une chaîne partagée : <t> direct, ou plusieurs <r><t> (texte riche)."""
    return "".join(t.text or "" for t in noeud.iter(f"{_NS_MAIN}t"))


def _lire_xlsx(contenu: bytes) -> list[Feuille]:
    with zipfile.ZipFile(io.BytesIO(contenu)) as z:
        noms = set(z.namelist())
        partages: list[str] = []
        if "xl/sharedStrings.xml" in noms:
            racine = ET.fromstring(z.read("xl/sharedStrings.xml"))
            partages = [_texte_xlsx(si) for si in racine.iter(f"{_NS_MAIN}si")]
        relations = {}
        for rel in ET.fromstring(z.read("xl/_rels/workbook.xml.rels")).iter(f"{_NS_PKG_REL}Relationship"):
            cible = rel.get("Target")
            relations[rel.get("Id")] = cible.lstrip("/") if cible.startswith("/") else f"xl/{cible}"
        feuilles = []
        for s in ET.fromstring(z.read("xl/workbook.xml")).iter(f"{_NS_MAIN}sheet"):
            if s.get("state") in ("hidden", "veryHidden"):
                continue
            chemin = relations.get(s.get(f"{_NS_REL}id"))
            if chemin in noms:
                feuilles.append(Feuille(s.get("name"), _lire_feuille_xlsx(z.read(chemin), partages)))
    return feuilles


def _lire_feuille_xlsx(xml: bytes, partages: list[str]) -> list[tuple]:
    lignes: dict[int, dict[int, object]] = {}
    numero = 0
    for rang in ET.fromstring(xml).iter(f"{_NS_MAIN}row"):
        numero = int(rang.get("r")) if rang.get("r") else numero + 1
        cellules: dict[int, object] = {}
        col = -1
        for c in rang.findall(f"{_NS_MAIN}c"):
            col = _indice_colonne(c.get("r")) if c.get("r") else col + 1
            type_ = c.get("t")
            v = c.find(f"{_NS_MAIN}v")
            if type_ == "inlineStr":
                est = c.find(f"{_NS_MAIN}is")
                valeur = _texte_xlsx(est) if est is not None else None
            elif v is None or v.text is None:
                continue
            elif type_ == "s":
                valeur = partages[int(v.text)]
            elif type_ in ("str", "e"):
                valeur = v.text
            elif type_ == "b":
                valeur = v.text == "1"
            else:
                valeur = _nombre(v.text)
            if isinstance(valeur, str):
                valeur = valeur.strip()
            if valeur is not None and valeur != "":
                cellules[col] = valeur
        if cellules:
            lignes[numero] = cellules
    return _en_tuples(lignes)


def _en_tuples(lignes: dict[int, dict[int, object]]) -> list[tuple]:
    """Les lignes numérotées -> une liste dense : une ligne vide du classeur reste une ligne
    vide ici, pour que le numéro de ligne affiché soit celui qu'Excel montre."""
    if not lignes:
        return []
    largeur = max(max(c) for c in lignes.values()) + 1
    return [
        tuple(lignes.get(n, {}).get(i) for i in range(largeur))
        for n in range(1, max(lignes) + 1)
    ]


# ---------- Excel 2003 en XML (SpreadsheetML) ----------


def _lire_spreadsheetml(contenu: bytes) -> list[Feuille]:
    feuilles = []
    for ws in ET.fromstring(contenu).iter(f"{_NS_SS}Worksheet"):
        lignes: dict[int, dict[int, object]] = {}
        numero = 0
        for rang in ws.iter(f"{_NS_SS}Row"):
            index = rang.get(f"{_NS_SS}Index")
            numero = int(index) if index else numero + 1
            cellules: dict[int, object] = {}
            col = -1
            for c in rang.findall(f"{_NS_SS}Cell"):
                index_c = c.get(f"{_NS_SS}Index")
                col = int(index_c) - 1 if index_c else col + 1
                d = c.find(f"{_NS_SS}Data")
                if d is None:
                    continue
                texte = "".join(d.itertext()).strip()
                if texte:
                    cellules[col] = _nombre(texte) if d.get(f"{_NS_SS}Type") == "Number" else texte
            if cellules:
                lignes[numero] = cellules
        feuilles.append(Feuille(ws.get(f"{_NS_SS}Name") or f"Feuille {len(feuilles) + 1}", _en_tuples(lignes)))
    return feuilles


# ---------- CSV ----------


def _lire_csv(contenu: bytes, delimiteur: Optional[str]) -> list[Feuille]:
    texte = import_bancaire._decoder_texte(contenu)
    if delimiteur is None:
        delimiteur = import_bancaire._detecter_delimiteur(
            "\n".join(texte.splitlines()[: import_bancaire._ECHANTILLON_DELIMITEUR])
        )
    lignes = [
        tuple(c.strip() if c.strip() else None for c in ligne)
        for ligne in csv.reader(io.StringIO(texte), delimiter=delimiteur)
    ]
    return [Feuille("CSV", lignes)]


# ---------- L'entrée ----------


def lire_classeur(contenu: bytes, delimiteur: Optional[str] = None) -> list[Feuille]:
    """Les feuilles du fichier, quel que soit son format. Lève ValueError si rien n'est lisible."""
    if contenu[:2] == b"PK":
        return _lire_xlsx(contenu)
    if contenu[:8] == b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1":
        raise ValueError(
            "ce fichier est un ancien classeur Excel binaire (.xls) : l'enregistrer au format .xlsx ou .csv"
        )
    debut = contenu[:2000].lstrip(b"\xef\xbb\xbf \r\n\t")
    if debut.startswith(b"<?xml") or debut.startswith(b"<Workbook"):
        return _lire_spreadsheetml(contenu)
    return _lire_csv(contenu, delimiteur)
