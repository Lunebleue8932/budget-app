"""Deux choses que la détection des colonnes repérait et que l'import ne savait
pas traiter : les dates écrites MOIS DEVANT (« 01/25/2026 »), et les lignes de
PIED (total, solde final) sous les opérations.

- L'ordre des dates est un réglage de LECTURE, comme le séparateur décimal :
  jamais mémorisé sur le preset, lu sur la colonne de dates du fichier quand
  rien ne l'impose (cf. import_bancaire.format_date_du_fichier).
- Les lignes de pied sont un réglage du PRESET, comme les lignes de tête
  (ImportPreset.lignes_pied, migration 0086).
"""
from datetime import date

import pytest
from fastapi import HTTPException

from app import crud, schemas
from app.routers import import_bancaire as routeur
from app.services import import_bancaire
from app.services.import_bancaire import (
    format_date_du_fichier,
    lire_lignes_brutes,
    parser_date,
)

from .conftest import creer_compte

COLONNES = [
    {"index": 1, "propriete": "date"},
    {"index": 2, "propriete": "nature"},
    {"index": 3, "propriete": "montant"},
]


def _csv(*lignes):
    return ("\n".join(lignes) + "\n").encode("utf-8")


# Une date au moins met plus de 12 en deuxième place : le mois est devant.
MOIS_DEVANT = _csv(
    "Date;Libellé;Montant",
    "01/05/2026;COURSES;-42,10",
    "01/25/2026;SALAIRE;2400,00",
    "02/03/2026;LOYER;-800,00",
)

# Rien ne dépasse 12 : on ne peut pas savoir, la lecture reste jour devant.
AMBIGU = _csv(
    "Date;Libellé;Montant",
    "03/04/2026;COURSES;-42,10",
    "05/06/2026;SALAIRE;2400,00",
)

AVEC_PIED = _csv(
    "Date;Libellé;Montant",
    "05/09/2026;COURSES;-42,10",
    "07/09/2026;SALAIRE;2400,00",
    "",
    "Total;;2357,90",
    "Solde final;;3357,90",
)


def _preset(db, lignes_pied=0):
    compte = creer_compte(db, "Courant")
    return crud.create_import_preset(
        db, "Ma banque", COLONNES, [], lignes_entete=1, compte_id=compte.id, lignes_pied=lignes_pied
    )


# ---------- parser_date ----------


def test_parser_date_mois_devant():
    assert parser_date("01/25/2026", "mja") == date(2026, 1, 25)
    assert parser_date("03/04/2026", "mja") == date(2026, 3, 4)
    assert parser_date("2/13/26", "mja") == date(2026, 2, 13)
    assert parser_date("01/25/2026 09:32", "mja") == date(2026, 1, 25)


def test_parser_date_jour_devant_par_defaut():
    assert parser_date("03/04/2026") == date(2026, 4, 3)
    assert parser_date("03/04/2026", "jma") == date(2026, 4, 3)
    assert parser_date("01/25/2026") is None


def test_l_annee_devant_se_lit_dans_les_deux_ordres():
    assert parser_date("2026-01-25", "mja") == date(2026, 1, 25)
    assert parser_date("2026-01-25", "jma") == date(2026, 1, 25)


# ---------- L'ordre lu sur le fichier ----------


def test_format_date_du_fichier():
    lignes = import_bancaire._lire_toutes_les_lignes(MOIS_DEVANT)
    assert format_date_du_fichier(lignes, COLONNES, 1) == "mja"
    lignes = import_bancaire._lire_toutes_les_lignes(AMBIGU)
    assert format_date_du_fichier(lignes, COLONNES, 1) is None
    # Sans colonne de dates, rien à dire.
    assert format_date_du_fichier(lignes, [{"index": 2, "propriete": "nature"}], 1) is None


def test_l_apercu_lit_le_mois_devant_de_lui_meme(db_session):
    preset = _preset(db_session)
    apercu = import_bancaire.previsualiser(db_session, preset.id, MOIS_DEVANT)
    assert apercu.format_date == "mja"
    assert [l.date for l in apercu.lignes] == [
        date(2026, 1, 5),
        date(2026, 1, 25),
        date(2026, 2, 3),
    ]
    assert not any(l.erreur and "date illisible" in l.erreur for l in apercu.lignes)


def test_un_fichier_ambigu_reste_jour_devant(db_session):
    preset = _preset(db_session)
    apercu = import_bancaire.previsualiser(db_session, preset.id, AMBIGU)
    assert apercu.format_date is None
    assert apercu.lignes[0].date == date(2026, 4, 3)


def test_l_ordre_impose_a_la_main_l_emporte(db_session):
    preset = _preset(db_session)
    apercu = import_bancaire.previsualiser(db_session, preset.id, AMBIGU, format_date="mja")
    assert apercu.format_date == "mja"
    assert apercu.lignes[0].date == date(2026, 3, 4)

    apercu = import_bancaire.previsualiser(db_session, preset.id, MOIS_DEVANT, format_date="jma")
    assert apercu.format_date == "jma"
    assert "date illisible" in (apercu.lignes[1].erreur or "")


def test_l_ordre_n_est_pas_memorise_sur_le_preset(db_session):
    preset = _preset(db_session)
    import_bancaire.previsualiser(db_session, preset.id, AMBIGU, format_date="mja")
    db_session.expire_all()
    assert not hasattr(crud.get_import_preset(db_session, preset.id), "format_date")


def test_confirmer_importe_les_dates_mois_devant(db_session):
    preset = _preset(db_session)
    resultat = import_bancaire.confirmer(
        db_session, preset.id, AMBIGU, schemas.ImportMappingOverrides(), format_date="mja"
    )
    assert resultat.operations_creees == 2
    dates = sorted(o.date for o in crud.get_operations(db_session))
    assert dates == [date(2026, 3, 4), date(2026, 5, 6)]


def test_le_routeur_valide_l_ordre_des_dates():
    assert routeur._valider_format_date(None) is None
    assert routeur._valider_format_date("") is None
    assert routeur._valider_format_date("mja") == "mja"
    with pytest.raises(HTTPException):
        routeur._valider_format_date("amj")


# ---------- Les lignes de pied ----------


def test_lire_lignes_brutes_ecarte_les_lignes_de_pied():
    brutes = lire_lignes_brutes(AVEC_PIED, COLONNES, 1, lignes_pied=2)
    assert [b["nature"] for b in brutes] == ["COURSES", "SALAIRE"]
    # Les numéros de ligne restent ceux du fichier.
    assert [b["ligne"] for b in brutes] == [2, 3]


def test_les_lignes_de_pied_se_comptent_sans_les_lignes_vides():
    """La ligne blanche avant le total ne compte pas : un pied d'UNE ligne
    écarte le solde final, pas la ligne vide."""
    brutes = lire_lignes_brutes(AVEC_PIED, COLONNES, 1, lignes_pied=1)
    assert [b["ligne"] for b in brutes] == [2, 3, 5]


def test_sans_pied_rien_ne_change():
    assert len(lire_lignes_brutes(AVEC_PIED, COLONNES, 1)) == 4
    assert lire_lignes_brutes(AVEC_PIED, COLONNES, 1, lignes_pied=99) == []


def test_l_apercu_n_a_plus_d_operations_en_erreur(db_session):
    preset = _preset(db_session, lignes_pied=2)
    apercu = import_bancaire.previsualiser(db_session, preset.id, AVEC_PIED)
    assert [l.nature for l in apercu.lignes] == ["COURSES", "SALAIRE"]
    assert not any(l.erreur for l in apercu.lignes)
    # Le fichier tel qu'il est les montre encore, désignées comme écartées.
    assert apercu.apercu_fichier.total_lignes == 5
    assert apercu.apercu_fichier.lignes_entete == 1
    assert apercu.apercu_fichier.lignes_pied == 2
    assert apercu.controle["lignes_rejetees"] == 0


def test_confirmer_ecarte_les_lignes_de_pied(db_session):
    preset = _preset(db_session, lignes_pied=2)
    resultat = import_bancaire.confirmer(
        db_session, preset.id, AVEC_PIED, schemas.ImportMappingOverrides()
    )
    assert resultat.operations_creees == 2


def test_la_mise_a_jour_sans_lignes_de_pied_n_y_touche_pas(db_session):
    """Les appelants qui ne connaissent pas le réglage (l'import de placements,
    le renommage d'un preset) ne le remettent pas à zéro."""
    preset = _preset(db_session, lignes_pied=2)
    crud.update_import_preset(db_session, preset, nom="Autre nom")
    assert preset.lignes_pied == 2
    crud.update_import_preset(db_session, preset, lignes_pied=0)
    assert preset.lignes_pied == 0


def test_le_schema_borne_les_lignes_de_pied():
    base = {"nom": "x", "colonnes": [{"index": 1, "propriete": "date"}]}
    assert schemas.ImportPresetUpdate(**base).lignes_pied is None
    assert schemas.ImportPresetCreate(**base).lignes_pied == 0
    with pytest.raises(Exception):
        schemas.ImportPresetCreate(**base, lignes_pied=100)
