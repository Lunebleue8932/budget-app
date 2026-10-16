"""Un relevé du banc de test, sous une forme qu'on peut transformer puis réécrire.

POURQUOI UNE FORME À PART. Le générateur de variantes change l'ordre des
colonnes, renomme les intitulés, convertit un montant en débit/crédit, ajoute un
solde : il doit savoir ce que dit CHAQUE colonne et lire les montants. Le
fichier brut ne le dit pas, le mapping attendu si. Les deux voyagent donc
ensemble, et la vérité attendue suit chaque transformation.

DES RÔLES, PAS DES PROPRIÉTÉS. « Envoyé » et « Débit » se lisent tous deux en
`montant_debit`, mais ne s'intitulent pas pareil ; « Date de valeur » et
« Solde » ne s'importent ni l'un ni l'autre, mais ne se renomment pas avec les
mêmes synonymes. Le rôle dit ce qu'est la colonne, `PROPRIETE_DU_ROLE` ce que
l'import doit en faire.

LES MONTANTS EN CENTIMES ENTIERS, jamais en flottants.

LE MAPPING ATTENDU D'UN VRAI RELEVÉ (`releves/<fichier>.attendu.json`, à côté du
fichier ; cf. exemple.attendu.json) :

    {
      "fichier": "releve_banque_a.csv",
      "lignes_entete": 4,          // lignes AVANT la première opération
      "intitules": true,           // la dernière de ces lignes porte les intitulés
      "lignes_pied": 0,            // totaux, solde final… sous les opérations
      "colonnes": ["date", "date_valeur", "nature", "debit", "credit", "solde"],
      "separateur": ";",           // ou "xlsx"
      "separateur_decimal": ",",
      "encodage": "cp1252",
      "ordre": "decroissant",
      "feuille": null
    }
"""
from __future__ import annotations

import copy
import csv
import io
import json
from dataclasses import dataclass, field
from datetime import date, datetime
from decimal import Decimal
from pathlib import Path
from typing import Optional

import openpyxl

from app.constants import LIBELLES_SENS_ENTREE, LIBELLES_SENS_SORTIE
from app.services.import_bancaire import (
    _lire_toutes_les_lignes,
    normaliser_libelle,
    parser_date,
)
from app.services.lecture_montants import centimes as lire_centimes, texte_montant

# L'écriture des dates, de strftime au code que rend la détection.
FORMATS_DATE = {"%d/%m/%Y": "jma", "%Y-%m-%d": "amj", "%m/%d/%Y": "mja"}

# Ce que l'import doit faire de chaque rôle. "" = ne pas importer.
PROPRIETE_DU_ROLE = {
    "date": "date",
    "date_valeur": "",
    "nature": "nature",
    "detail": "",
    "categorie": "categorie_banque",
    "montant": "montant",
    "debit": "montant_debit",
    "credit": "montant_credit",
    # Une ligne ne remplit que l'une des deux : c'est un débit/crédit sous
    # d'autres intitulés, pas une conversion de devises (montant_initial).
    "envoye": "montant_debit",
    "recu": "montant_credit",
    "sens": "sens",
    "devise": "monnaie",
    "solde": "",
    "reference": "",
}
ROLES_MONTANT = {"montant", "debit", "credit", "envoye", "recu", "solde"}
# Les colonnes qui portent, à elles toutes, le montant net d'une ligne.
ROLES_DU_NET = {"montant", "debit", "credit", "envoye", "recu", "sens"}
ROLES_DATE = {"date", "date_valeur"}


def mode_montants(roles: list[str]) -> str:
    if "debit" in roles:
        return "debit_credit"
    if "envoye" in roles:
        return "envoye_recu"
    if "sens" in roles:
        return "montant_sens"
    return "algebrique"


def centimes(
    texte: str, separateur_decimal: str, separateur_milliers: Optional[str] = None
) -> Optional[int]:
    """« 1 234,56 € », « (12,50) », « 12,50- » → centimes signés ; None si la
    cellule n'est pas un montant. Les séparateurs sont CONNUS ici (ils sont
    dans le mapping attendu) : le banc n'a rien à deviner. La lecture est celle
    de l'application (services/lecture_montants) : la vérité attendue et la
    détection lisent les nombres de la même façon."""
    return lire_centimes(texte, separateur_decimal, separateur_milliers or None)


@dataclass
class Releve:
    nom: str
    roles: list[str]
    lignes: list[list[str]]
    entetes: Optional[list[str]] = None  # None : le fichier n'a pas d'intitulés
    titres: list[list[str]] = field(default_factory=list)
    pied: list[list[str]] = field(default_factory=list)
    separateur: str = ";"  # ou "xlsx"
    separateur_decimal: str = ","
    separateur_milliers: str = ""
    encodage: str = "utf-8"
    ordre: str = "croissant"
    format_date: str = "%d/%m/%Y"

    @property
    def lignes_entete(self) -> int:
        return len(self.titres) + (1 if self.entetes is not None else 0)

    @property
    def mode(self) -> str:
        return mode_montants(self.roles)

    def copie(self, suffixe: str) -> "Releve":
        nouveau = copy.deepcopy(self)
        nouveau.nom = f"{self.nom}/{suffixe}"
        return nouveau

    def colonnes(self, *roles: str) -> list[int]:
        return [j for j, r in enumerate(self.roles) if r in roles]

    def attendu(self) -> dict:
        return {
            "lignes_entete": self.lignes_entete,
            "proprietes": [PROPRIETE_DU_ROLE[r] for r in self.roles],
            "mode_montants": self.mode,
            "separateur": self.separateur,
            # Un classeur porte des nombres et des dates TYPÉS : ni séparateur
            # décimal, ni encodage, ni écriture des dates à deviner.
            "separateur_decimal": None if self.separateur == "xlsx" else self.separateur_decimal,
            "encodage": "" if self.separateur == "xlsx" else self.encodage,
            "format_date": None if self.separateur == "xlsx" else FORMATS_DATE.get(self.format_date),
            "ordre": self.ordre,
            "lignes_pied": len(self.pied),
        }

    # ---------- Les montants ----------

    def nets(self) -> list[Optional[int]]:
        """Le montant signé de chaque ligne, selon le mode. None : la ligne
        n'en dit rien (aucune colonne remplie)."""
        sep = self.separateur_decimal
        nets: list[Optional[int]] = []
        for ligne in self.lignes:
            lus = {
                r: centimes(ligne[j], sep, self.separateur_milliers)
                for j, r in enumerate(self.roles)
                if r in ROLES_MONTANT
            }
            if self.mode == "algebrique":
                nets.append(lus.get("montant"))
            elif self.mode == "montant_sens":
                montant = lus.get("montant")
                sens = normaliser_libelle(ligne[self.roles.index("sens")])
                if montant is None or sens not in LIBELLES_SENS_SORTIE | LIBELLES_SENS_ENTREE:
                    nets.append(None)
                else:
                    nets.append(-abs(montant) if sens in LIBELLES_SENS_SORTIE else abs(montant))
            else:
                sortie, entree = ("debit", "credit") if self.mode == "debit_credit" else ("envoye", "recu")
                d, c = lus.get(sortie), lus.get(entree)
                nets.append(None if d is None and c is None else (c or 0) - (d or 0))
        return nets

    def dates(self) -> list[Optional[date]]:
        j = self.roles.index("date")
        return [parser_date(ligne[j]) for ligne in self.lignes]

    # ---------- L'écriture ----------

    def toutes_les_lignes(self) -> list[list[str]]:
        tete = self.titres + ([self.entetes] if self.entetes is not None else [])
        return tete + self.lignes + self.pied

    def en_octets(self) -> bytes:
        if self.separateur == "xlsx":
            return self._en_xlsx()
        tampon = io.StringIO()
        ecrivain = csv.writer(tampon, delimiter=self.separateur, lineterminator="\r\n")
        ecrivain.writerows(self.toutes_les_lignes())
        # « replace » : un « € » n'existe pas en ISO-8859-1, et une banque qui
        # exporte dans cet encodage écrit alors autre chose. Le banc ne doit pas
        # échouer pour ça.
        return tampon.getvalue().encode(self.encodage, errors="replace")

    def _en_xlsx(self) -> bytes:
        """Un classeur TYPÉ, comme ceux des banques : vraies dates, vrais
        nombres. Un xlsx tout en texte ne testerait pas le même chemin."""
        classeur = openpyxl.Workbook()
        feuille = classeur.active
        for ligne in self.titres + ([self.entetes] if self.entetes is not None else []):
            feuille.append(ligne)
        for ligne in self.lignes:
            valeurs = []
            for j, texte in enumerate(ligne):
                role = self.roles[j] if j < len(self.roles) else ""
                if role in ROLES_DATE and texte:
                    valeurs.append(datetime.strptime(texte, self.format_date))
                elif role in ROLES_MONTANT and texte:
                    valeur = centimes(texte, self.separateur_decimal, self.separateur_milliers)
                    valeurs.append(float(Decimal(valeur) / 100) if valeur is not None else texte)
                else:
                    valeurs.append(texte)
            feuille.append(valeurs)
        for ligne in self.pied:
            feuille.append(ligne)
        tampon = io.BytesIO()
        classeur.save(tampon)
        return tampon.getvalue()


# ---------- La lecture d'un vrai relevé ----------


def _texte_cellule(valeur, role: str, separateur_decimal: str) -> str:
    if valeur is None:
        return ""
    if isinstance(valeur, (datetime, date)):
        return valeur.strftime("%d/%m/%Y")
    if isinstance(valeur, (int, float)) and not isinstance(valeur, bool):
        if role in ROLES_MONTANT:
            return texte_montant(int((Decimal(str(valeur)) * 100).to_integral_value()), separateur_decimal)
        return str(int(valeur)) if float(valeur).is_integer() else str(valeur)
    return str(valeur).strip()


def charger(chemin_attendu: Path) -> tuple[bytes, Releve]:
    """(octets d'origine, relevé transformable) d'un vrai relevé et de son
    mapping attendu. Les octets d'origine servent tels quels au premier cas :
    on teste d'abord le fichier que la banque a vraiment produit."""
    attendu = json.loads(chemin_attendu.read_text(encoding="utf-8"))
    contenu = (chemin_attendu.parent / attendu["fichier"]).read_bytes()
    roles = attendu["colonnes"]
    sep_dec = attendu["separateur_decimal"]
    brutes = _lire_toutes_les_lignes(
        contenu,
        None if attendu["separateur"] == "xlsx" else attendu["separateur"],
        attendu.get("feuille"),
    )
    largeur = len(roles)
    texte = [
        [_texte_cellule(v, roles[j] if j < largeur else "", sep_dec) for j, v in enumerate(ligne)]
        for ligne in brutes
    ]
    n, pied = attendu["lignes_entete"], attendu.get("lignes_pied", 0)
    intitules = attendu.get("intitules", True)
    corps = texte[n:len(texte) - pied] if pied else texte[n:]
    releve = Releve(
        nom=Path(attendu["fichier"]).stem,
        roles=roles,
        lignes=[(l + [""] * largeur)[:largeur] for l in corps if any(c for c in l)],
        entetes=(texte[n - 1] + [""] * largeur)[:largeur] if intitules and n else None,
        titres=texte[: n - 1] if intitules and n else texte[:n],
        pied=texte[len(texte) - pied:] if pied else [],
        separateur=attendu["separateur"],
        separateur_decimal=sep_dec,
        encodage=attendu["encodage"],
        format_date={v: k for k, v in FORMATS_DATE.items()}.get(attendu.get("format_date"), "%d/%m/%Y"),
        ordre=attendu["ordre"],
    )
    return contenu, releve
