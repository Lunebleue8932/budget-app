"""Exporter TOUTES les données de la base, dans un format qu'on peut relire sans l'application.

POURQUOI. Une base SQLite ne se lit qu'avec l'application (ou un outil qu'on n'a pas) ; un export, lui,
s'ouvre partout : Excel, un tableur, un script, une autre application. C'est aussi la seule façon de
RANGER ses données hors du format de l'application, au cas où elle ne serait plus là.

TROIS FORMATS, UN MÊME CONTENU — chaque table de la base, colonnes comprises, rien filtré :

  - `json` : un seul fichier, toutes les tables (`{tables: {nom: {colonnes, lignes}}}`) ;
  - `csv` : une archive .zip, UN FICHIER .csv PAR TABLE (un CSV n'a pas de feuilles : c'est l'archive qui
    joue ce rôle). Séparateur « ; » et BOM UTF-8, pour qu'Excel en français lise accents et colonnes ;
  - `xlsx` : un classeur, UNE FEUILLE PAR TABLE.

CE MODULE NE FAIT QUE LIRE. Aucun format n'est un format d'IMPORT : rien ne relit ces fichiers pour
reconstruire une base — la copie de sécurité (cf. services/sauvegardes) est faite pour ça.
"""
import base64
import csv
import io
import json
import re
import zipfile
from datetime import date, datetime, time
from decimal import Decimal
from typing import Any

from sqlalchemy.orm import Session

from ..database import Base

VERSION_FORMAT = 1
FORMATS = {
    "json": ("application/json", "json"),
    "csv": ("application/zip", "zip"),
    "xlsx": ("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "xlsx"),
}


def _valeur(v: Any) -> Any:
    """Une cellule SÉRIALISABLE : les dates en ISO, les décimaux en nombres, les octets en base64."""
    if v is None or isinstance(v, (str, int, float, bool)):
        return v
    if isinstance(v, (datetime, date, time)):
        return v.isoformat()
    if isinstance(v, Decimal):
        return float(v)
    if isinstance(v, (bytes, bytearray)):
        return base64.b64encode(bytes(v)).decode("ascii")
    if isinstance(v, (list, dict)):
        return v
    return str(v)


def lire_tables(db: Session) -> dict[str, dict]:
    """{nom: {colonnes: [...], lignes: [[...], ...]}} pour chaque table, dans l'ordre des
    dépendances (les tables référencées d'abord)."""
    resultat = {}
    for table in Base.metadata.sorted_tables:
        colonnes = [c.name for c in table.columns]
        lignes = [
            [_valeur(v) for v in ligne]
            for ligne in db.execute(table.select()).all()
        ]
        resultat[table.name] = {"colonnes": colonnes, "lignes": lignes}
    return resultat


def _texte_csv(v: Any) -> Any:
    """Les listes et dictionnaires (colonnes JSON) deviennent du JSON dans la cellule."""
    if isinstance(v, (list, dict)):
        return json.dumps(v, ensure_ascii=False)
    return "" if v is None else v


def en_json(db: Session, revision: str | None = None) -> bytes:
    contenu = {
        "format": "budget-app-export",
        "version": VERSION_FORMAT,
        "exporte_le": datetime.now().isoformat(timespec="seconds"),
        "revision_base": revision,
        "tables": lire_tables(db),
    }
    return json.dumps(contenu, ensure_ascii=False, indent=1).encode("utf-8")


def en_csv_zip(db: Session) -> bytes:
    tampon = io.BytesIO()
    with zipfile.ZipFile(tampon, "w", zipfile.ZIP_DEFLATED) as archive:
        for nom, table in lire_tables(db).items():
            fichier = io.StringIO()
            # « ; » : le séparateur d'Excel en français. Le BOM fait lire l'UTF-8 sans qu'on ait à choisir.
            ecrivain = csv.writer(fichier, delimiter=";", lineterminator="\r\n")
            ecrivain.writerow(table["colonnes"])
            for ligne in table["lignes"]:
                ecrivain.writerow([_texte_csv(v) for v in ligne])
            archive.writestr(f"{nom}.csv", "﻿" + fichier.getvalue())
    return tampon.getvalue()


def _nom_de_feuille(nom: str, pris: set) -> str:
    """Une feuille s'appelle au plus 31 caractères, sans [ ] * ? / \\ :, et le nom est unique."""
    base = re.sub(r"[\[\]\*\?/\\:]", "_", nom)[:31]
    candidat, i = base, 2
    while candidat.lower() in pris:
        suffixe = f"_{i}"
        candidat = base[: 31 - len(suffixe)] + suffixe
        i += 1
    pris.add(candidat.lower())
    return candidat


def en_xlsx(db: Session) -> bytes:
    import openpyxl

    classeur = openpyxl.Workbook()
    classeur.remove(classeur.active)
    pris: set = set()
    for nom, table in lire_tables(db).items():
        feuille = classeur.create_sheet(_nom_de_feuille(nom, pris))
        feuille.append(table["colonnes"])
        for ligne in table["lignes"]:
            feuille.append([_texte_csv(v) for v in ligne])
    tampon = io.BytesIO()
    classeur.save(tampon)
    return tampon.getvalue()


def exporter(db: Session, format: str, revision: str | None = None) -> tuple[bytes, str, str]:
    """(contenu, type MIME, extension) — ValueError pour un format inconnu."""
    if format not in FORMATS:
        raise ValueError(f"Format d'export inconnu : {format}")
    media, extension = FORMATS[format]
    if format == "json":
        contenu = en_json(db, revision)
    elif format == "csv":
        contenu = en_csv_zip(db)
    else:
        contenu = en_xlsx(db)
    return contenu, media, extension
