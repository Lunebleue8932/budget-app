"""QU'EST-CE QUI FAIT QU'UN TITRE EST LE MÊME D'UN FICHIER À L'AUTRE ?

LE COUPLE (NOM, ISIN), ET L'ISIN TRANCHE (migration 0080). Un courtier abrège le libellé
de deux titres différents de la même façon (« SS SPDR MSCI EUR. » pour deux ETF SPDR
distincts) : le nom seul ne suffit pas à dire que c'est le même. L'ISIN, lui, désigne une
valeur et une seule. D'où la règle, la seule de l'application — import d'opérations, import
de titres et saisie à la main passent tous par ici :

  - MÊME ISIN : même titre, quel que soit le nom ;
  - ISIN DIFFÉRENTS : titres différents, même s'ils portent le même nom ;
  - UN ISIN D'UN CÔTÉ, AUCUN DE L'AUTRE : le nom décide — un titre saisi sans ISIN est
    retrouvé par son nom, et le fichier lui apporte son ISIN ;
  - AUCUN ISIN : le nom seul. S'il désigne plusieurs titres (des homonymes que leurs ISIN
    séparent), rien ne permet de choisir : la ligne le dit, et se rattache à la main.

Les noms se comparent normalisés (sans casse, accents ni espaces), comme partout à l'import.
"""
from typing import Optional

from .. import models
from .import_bancaire import normaliser_libelle


def normaliser_isin(texte) -> str:
    return str(texte or "").replace(" ", "").replace(" ", "").upper()


def cle_nom(nom) -> str:
    return normaliser_libelle(str(nom or ""))


class IndexTitres:
    """Les titres en base, indexés par ISIN et par nom — un nom peut en désigner plusieurs."""

    def __init__(self, titres):
        self.par_isin: dict[str, models.TitrePossede] = {}
        self.par_nom: dict[str, list[models.TitrePossede]] = {}
        for titre in titres:
            self.ajouter(titre)

    def ajouter(self, titre: models.TitrePossede) -> None:
        """Tient l'index à jour au fil d'un fichier : un titre créé à la ligne 3 doit être
        retrouvé à la ligne 40 plutôt que recréé."""
        if titre.code_isin:
            self.par_isin[normaliser_isin(titre.code_isin)] = titre
        homonymes = self.par_nom.setdefault(cle_nom(titre.nom), [])
        if titre not in homonymes:
            homonymes.append(titre)

    def identifier(self, nom, isin) -> tuple[Optional[models.TitrePossede], Optional[str]]:
        """(le titre que ce couple désigne, ou None s'il est à créer ; une erreur si rien ne
        permet de trancher)."""
        isin = normaliser_isin(isin)
        homonymes = self.par_nom.get(cle_nom(nom), []) if nom else []
        if isin:
            titre = self.par_isin.get(isin)
            if titre is not None:
                return titre, None
            # Un homonyme SANS ISIN est ce titre-là, saisi avant qu'on connaisse son code.
            sans_isin = [t for t in homonymes if not t.code_isin]
            if sans_isin:
                return sans_isin[0], None
            # Des homonymes, tous sous un AUTRE ISIN : c'est un autre titre, à créer.
            return None, None
        if len(homonymes) == 1:
            return homonymes[0], None
        if len(homonymes) > 1:
            codes = ", ".join(t.code_isin or "sans ISIN" for t in homonymes)
            return None, (
                f"plusieurs titres s'appellent « {nom} » ({codes}) et la ligne ne donne pas "
                "d'ISIN pour les départager : choisis le titre à la main sur cette ligne."
            )
        return None, None


def conflit_identite(db, nom: str, code_isin: Optional[str], sauf_id: Optional[int] = None):
    """Pourquoi un titre (nom, ISIN) ne peut pas être créé ou renommé ainsi, ou None.

    Deux règles, celles que la base tient aussi (index uniques) : un ISIN ne désigne qu'un
    titre, et deux titres SANS ISIN ne peuvent pas porter le même nom — rien ne les
    distinguerait."""
    autres = db.query(models.TitrePossede).filter(models.TitrePossede.id != (sauf_id or -1))
    isin = normaliser_isin(code_isin)
    if isin:
        if any(normaliser_isin(t.code_isin) == isin for t in autres):
            return f"Un titre porte déjà l'ISIN {isin}."
        return None
    if any(t.nom == nom and not t.code_isin for t in autres):
        return (
            f"Un titre sans ISIN s'appelle déjà « {nom} » : donne un ISIN à l'un des deux pour "
            "les distinguer."
        )
    return None
