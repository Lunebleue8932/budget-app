"""Montant scindé : « Débit » et « Crédit » dans deux colonnes séparées.

Format très répandu — le relevé n'écrit que des montants positifs et laisse
vide la colonne qui ne s'applique pas. C'est la même information qu'une colonne
« Sens », écrite autrement : la position de la cellule remplie tient lieu de
signe.

Ce que ces tests verrouillent : le couple remplace « Montant » (et le serveur
refuse toute configuration bâtarde), le débit sort et le crédit entre, un zéro
vaut une case vide, et une ligne qui remplit les DEUX colonnes part en erreur
au lieu d'être compensée — avec la garantie qu'une telle ligne, même corrigée
à la main, ne peut pas s'importer en virement orienté à l'envers.
"""
import io
from datetime import date

import openpyxl
import pytest
from fastapi import HTTPException

from app import crud, models, schemas
from app.constants import Sens
from app.routers import import_bancaire as routeur_import
from app.services import import_bancaire

from .conftest import creer_compte, get_categorie_id


# 1 date | 2 libellé | 3 débit | 4 crédit
_COLONNES_SCINDEES = [
    {"index": 1, "propriete": "date"},
    {"index": 2, "propriete": "nature"},
    {"index": 3, "propriete": "montant_debit"},
    {"index": 4, "propriete": "montant_credit"},
]


def _fichier(lignes: list[list]) -> bytes:
    classeur = openpyxl.Workbook()
    feuille = classeur.active
    for ligne in lignes:
        feuille.append(ligne)
    tampon = io.BytesIO()
    classeur.save(tampon)
    return tampon.getvalue()


def _preset(db, nom="Banque", colonnes=None):
    return crud.create_import_preset(
        db,
        nom,
        colonnes if colonnes is not None else _COLONNES_SCINDEES,
        [],
        ignorer_premiere_ligne=False,
    )


def _regle_virement(db):
    """Seule une règle peut poser le type d'une ligne importée."""
    return crud.create_regle_categorisation(
        db,
        nom="Transferts",
        type_id=db.query(models.TypeOperationDB)
        .filter(models.TypeOperationDB.code == "virement")
        .one()
        .id,
        categorie_id=None,
        conditions={
            "operateur": "ET",
            "groupes": [
                {
                    "operateur": "ET",
                    "conditions": [
                        {"champ": "nature", "operateur": "contient", "valeur": "Transfert"}
                    ],
                }
            ],
        },
    )


def _lignes(db, preset, contenu, compte):
    return import_bancaire.previsualiser(
        db, preset.id, contenu, compte_id_defaut=compte.id
    ).lignes


# ---------- Lecture des deux colonnes ----------


def test_le_debit_sort_et_le_credit_entre(db_session):
    """Le point de départ : deux colonnes tout en positif décrivent bien un sens
    chacune, et c'est la colonne remplie qui le dit."""
    compte = creer_compte(db_session, "CC Perso")
    preset = _preset(db_session)
    contenu = _fichier(
        [
            [date(2026, 7, 1), "Courses", 45.2, None],
            [date(2026, 7, 2), "Salaire", None, 1500.0],
        ]
    )

    lignes = _lignes(db_session, preset, contenu, compte)

    # Le montant affiché reste positif ; c'est montant_signe qui porte le sens,
    # exactement comme pour un relevé signé ou une colonne « Sens ».
    assert [l.montant for l in lignes] == [45.2, 1500.0]
    assert [l.montant_signe for l in lignes] == [-45.2, 1500.0]
    assert [l.sens_explicite for l in lignes] == [True, True]
    assert [l.erreur for l in lignes] == [None, None]


def test_un_zero_compte_comme_une_case_vide(db_session):
    """Bien des relevés écrivent « 0,00 » du côté inutilisé : les prendre au mot
    ferait de chaque ligne un débit ET un crédit, donc une erreur partout."""
    compte = creer_compte(db_session, "CC Perso")
    preset = _preset(db_session)
    contenu = _fichier(
        [
            [date(2026, 7, 1), "Courses", 45.2, 0],
            [date(2026, 7, 2), "Salaire", 0.0, 1500.0],
        ]
    )

    lignes = _lignes(db_session, preset, contenu, compte)

    assert [l.montant_signe for l in lignes] == [-45.2, 1500.0]
    assert [l.erreur for l in lignes] == [None, None]


def test_un_montant_deja_signe_dans_la_colonne_debit_reste_une_sortie(db_session):
    """Certains relevés scindent ET signent le débit. La colonne prime : sans
    cela, un « -45,20 » au débit deviendrait une entrée."""
    compte = creer_compte(db_session, "CC Perso")
    preset = _preset(db_session)
    contenu = _fichier([[date(2026, 7, 1), "Courses", -45.2, None]])

    assert _lignes(db_session, preset, contenu, compte)[0].montant_signe == -45.2


def test_les_deux_colonnes_vides_restent_un_montant_illisible(db_session):
    compte = creer_compte(db_session, "CC Perso")
    preset = _preset(db_session)
    contenu = _fichier([[date(2026, 7, 1), "Courses", None, None]])

    assert "montant illisible" in _lignes(db_session, preset, contenu, compte)[0].erreur


# ---------- Les deux colonnes remplies ----------


def test_les_deux_colonnes_remplies_mettent_la_ligne_en_erreur(db_session):
    """Ni compensation ni arbitrage : les deux se retrancher fabriquerait une
    opération que le relevé ne décrit nulle part, et en choisir une se
    tromperait une fois sur deux."""
    compte = creer_compte(db_session, "CC Perso")
    preset = _preset(db_session)
    contenu = _fichier([[date(2026, 7, 1), "Régularisation", 120.0, 45.0]])

    ligne = _lignes(db_session, preset, contenu, compte)[0]

    assert ligne.erreur == "montant présent au débit et au crédit"
    assert ligne.montant is None
    assert ligne.montant_signe is None
    # Le fichier n'a rien tranché : la ligne ne prétend pas connaître son sens.
    assert ligne.sens_explicite is False


def test_une_ligne_ambigue_nest_pas_importee(db_session):
    compte = creer_compte(db_session, "CC Perso")
    preset = _preset(db_session)
    contenu = _fichier(
        [
            [date(2026, 7, 1), "Régularisation", 120.0, 45.0],
            [date(2026, 7, 2), "Courses", 45.2, None],
        ]
    )

    resultat = import_bancaire.confirmer(
        db_session, preset.id, contenu, schemas.ImportMappingOverrides(), compte_id_defaut=compte.id
    )

    assert resultat.operations_creees == 1
    assert [l.ligne for l in resultat.lignes_ignorees] == [1]
    assert "débit et au crédit" in resultat.lignes_ignorees[0].erreur


def test_une_ligne_ambigue_corrigee_a_la_main_simporte(db_session):
    """L'erreur n'est pas une impasse : le montant se corrige dans l'aperçu,
    comme une date illisible."""
    compte = creer_compte(db_session, "CC Perso")
    preset = _preset(db_session)
    contenu = _fichier([[date(2026, 7, 1), "Régularisation", 120.0, 45.0]])

    resultat = import_bancaire.confirmer(
        db_session,
        preset.id,
        contenu,
        schemas.ImportMappingOverrides(
            lignes={1: schemas.ImportLigneOverride(montant=75.0)}
        ),
        compte_id_defaut=compte.id,
    )

    assert resultat.operations_creees == 1
    assert db_session.query(models.Operation).one().montant == 75.0


def test_une_ligne_ambigue_ne_peut_pas_devenir_un_virement_oriente_au_hasard(db_session):
    """Le garde-fou : un virement s'oriente par le SIGNE du montant, et une
    ligne ambiguë n'en a pas. Sans ce refus, l'émetteur et le récepteur
    seraient intervertis en silence."""
    source = creer_compte(db_session, "CC Perso")
    destination = creer_compte(db_session, "Livret A", type_nom="épargne")
    _regle_virement(db_session)
    preset = _preset(db_session)
    contenu = _fichier([[date(2026, 7, 1), "Transfert vers Livret A", 120.0, 45.0]])

    resultat = import_bancaire.confirmer(
        db_session,
        preset.id,
        contenu,
        schemas.ImportMappingOverrides(
            lignes={
                1: schemas.ImportLigneOverride(
                    montant=75.0, compte_id_autre=destination.id
                )
            }
        ),
        compte_id_defaut=source.id,
    )

    assert resultat.operations_creees == 0
    assert "sens de la ligne est indéterminé" in resultat.lignes_ignorees[0].erreur


# ---------- Le sens que les colonnes portent ----------


def test_le_debit_impose_depense_sur_une_operation_classique(db_session):
    """Comme la colonne « Sens » : le fichier a tranché, la catégorie n'a plus
    à en décider."""
    compte = creer_compte(db_session, "CC Perso")
    preset = _preset(db_session)
    contenu = _fichier([[date(2026, 7, 1), "Courses", 45.2, None]])

    import_bancaire.confirmer(
        db_session,
        preset.id,
        contenu,
        schemas.ImportMappingOverrides(
            categories={"": get_categorie_id(db_session, "Entrées d'argent")}
        ),
        compte_id_defaut=compte.id,
    )

    assert db_session.query(models.Operation).one().sens == Sens.depense


def test_le_credit_impose_entree_sur_une_operation_classique(db_session):
    compte = creer_compte(db_session, "CC Perso")
    preset = _preset(db_session)
    contenu = _fichier([[date(2026, 7, 1), "Prime", None, 800.0]])

    import_bancaire.confirmer(
        db_session,
        preset.id,
        contenu,
        schemas.ImportMappingOverrides(
            categories={"": get_categorie_id(db_session, "Autres")}
        ),
        compte_id_defaut=compte.id,
    )

    assert db_session.query(models.Operation).one().sens == Sens.entree


def test_le_debit_oriente_un_virement_interne(db_session):
    """Le bug que le couple doit éviter : sans signe, tout virement passe pour
    une réception."""
    source = creer_compte(db_session, "CC Perso")
    destination = creer_compte(db_session, "Livret A", type_nom="épargne")
    _regle_virement(db_session)
    preset = _preset(db_session)
    contenu = _fichier([[date(2026, 7, 1), "Transfert vers Livret A", 100.0, None]])

    resultat = import_bancaire.confirmer(
        db_session,
        preset.id,
        contenu,
        schemas.ImportMappingOverrides(
            lignes={1: schemas.ImportLigneOverride(compte_id_autre=destination.id)}
        ),
        compte_id_defaut=source.id,
    )

    assert resultat.operations_creees == 2
    sortante = db_session.query(models.Operation).filter_by(sens=Sens.transfert_sortant).one()
    entrante = db_session.query(models.Operation).filter_by(sens=Sens.transfert_entrant).one()
    assert sortante.compte_id == source.id
    assert entrante.compte_id == destination.id


# ---------- Configurations refusées ----------


def _creer(db, colonnes):
    return routeur_import.create_preset(
        schemas.ImportPresetCreate(nom="Test", colonnes=colonnes), db
    )


def test_une_seule_des_deux_colonnes_est_refusee(db_session):
    """Les lignes de l'autre côté n'auraient plus de montant du tout."""
    with pytest.raises(HTTPException) as erreur:
        _creer(db_session, _COLONNES_SCINDEES[:3])

    assert erreur.value.status_code == 400
    assert "DEUX colonnes" in erreur.value.detail


def test_le_couple_avec_montant_est_refuse(db_session):
    """Ils décrivent la même chose : rien ne dirait lequel fait foi quand ils se
    contredisent."""
    with pytest.raises(HTTPException) as erreur:
        _creer(db_session, _COLONNES_SCINDEES + [{"index": 5, "propriete": "montant"}])

    assert erreur.value.status_code == 400
    assert "choisis l'un ou l'autre" in erreur.value.detail


def test_le_couple_avec_la_colonne_sens_est_refuse(db_session):
    with pytest.raises(HTTPException) as erreur:
        _creer(db_session, _COLONNES_SCINDEES + [{"index": 5, "propriete": "sens"}])

    assert erreur.value.status_code == 400
    assert "Sens" in erreur.value.detail


def test_aucune_lecture_du_montant_reste_refusee(db_session):
    """Le message cite les deux façons valables de lire un montant."""
    with pytest.raises(HTTPException) as erreur:
        _creer(db_session, _COLONNES_SCINDEES[:2])

    assert erreur.value.status_code == 400
    assert "montant" in erreur.value.detail
    assert "Montant au débit" in erreur.value.detail


def test_le_couple_seul_est_une_configuration_valide(db_session):
    preset = _creer(db_session, _COLONNES_SCINDEES)

    assert {c["propriete"] for c in preset.colonnes} == {
        "date",
        "nature",
        "montant_debit",
        "montant_credit",
    }


def test_un_preset_a_montant_unique_se_comporte_exactement_comme_avant(db_session):
    """La propriété est facultative : ne pas la configurer ne change rien."""
    compte = creer_compte(db_session, "CC Perso")
    preset = _preset(
        db_session,
        colonnes=[
            {"index": 1, "propriete": "date"},
            {"index": 2, "propriete": "nature"},
            {"index": 3, "propriete": "montant"},
        ],
    )
    contenu = _fichier(
        [
            [date(2026, 7, 1), "Courses", -45.2],
            [date(2026, 7, 2), "Salaire", 1500.0],
        ]
    )

    lignes = _lignes(db_session, preset, contenu, compte)

    assert [l.montant_signe for l in lignes] == [-45.2, 1500.0]
    # Un montant simplement signé n'a jamais imposé entrée/dépense à une
    # opération classique : ce n'est pas ce que `sens_explicite` désigne.
    assert [l.sens_explicite for l in lignes] == [False, False]
    assert [l.erreur for l in lignes] == [None, None]
