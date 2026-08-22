"""Colonne « Sens » : le signe que le relevé n'écrit pas sur le montant.

Beaucoup d'exports bancaires n'écrivent que des montants positifs, le sens
étant porté par une colonne à part (« Débit »/« Crédit »). Sans elle, toutes
les lignes d'un tel fichier passaient pour des entrées — et un virement pour
une réception.

Ce que ces tests verrouillent : le sens lu fournit le signe (donc oriente les
virements exactement comme un relevé signé), il impose entrée/dépense sur une
opération classique là où la catégorie seule en décidait, et un libellé inconnu
met la ligne en erreur plutôt que d'être deviné.
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


# 1 date | 2 libellé | 3 montant (toujours positif) | 4 sens
_COLONNES_AVEC_SENS = [
    {"index": 1, "propriete": "date"},
    {"index": 2, "propriete": "nature"},
    {"index": 3, "propriete": "montant"},
    {"index": 4, "propriete": "sens"},
]

_COLONNES_SANS_SENS = _COLONNES_AVEC_SENS[:3]


def _fichier(lignes: list[list]) -> bytes:
    classeur = openpyxl.Workbook()
    feuille = classeur.active
    for ligne in lignes:
        feuille.append(ligne)
    tampon = io.BytesIO()
    classeur.save(tampon)
    return tampon.getvalue()


def _preset(db, nom="Banque", colonnes=None, sortie=None, entree=None):
    return crud.create_import_preset(
        db,
        nom,
        colonnes if colonnes is not None else _COLONNES_AVEC_SENS,
        [],
        ignorer_premiere_ligne=False,
        libelles_sens_sortie=sortie,
        libelles_sens_entree=entree,
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


def test_le_sens_donne_son_signe_a_un_montant_positif(db_session):
    """Le point de départ : un fichier tout en positif décrit quand même des
    sorties, et c'est la colonne de sens qui le dit."""
    compte = creer_compte(db_session, "CC Perso")
    preset = _preset(db_session)
    contenu = _fichier(
        [
            [date(2026, 7, 1), "Courses", 45.2, "Débit"],
            [date(2026, 7, 2), "Salaire", 1500.0, "Crédit"],
        ]
    )

    lignes = import_bancaire.previsualiser(
        db_session, preset.id, contenu, compte_id_defaut=compte.id
    ).lignes

    # Le montant affiché reste positif ; c'est montant_signe qui porte le sens.
    assert [l.montant for l in lignes] == [45.2, 1500.0]
    assert [l.montant_signe for l in lignes] == [-45.2, 1500.0]
    assert [l.erreur for l in lignes] == [None, None]


def test_les_libelles_sont_reconnus_sans_egard_a_la_casse_ni_aux_accents(db_session):
    compte = creer_compte(db_session, "CC Perso")
    preset = _preset(db_session)
    contenu = _fichier(
        [
            [date(2026, 7, 1), "A", 10.0, "DEBIT"],
            [date(2026, 7, 2), "B", 10.0, "débit"],
            [date(2026, 7, 3), "C", 10.0, " D "],
            [date(2026, 7, 4), "D", 10.0, "-"],
            [date(2026, 7, 5), "E", 10.0, "Crédit"],
            [date(2026, 7, 6), "F", 10.0, "CREDIT"],
            [date(2026, 7, 7), "G", 10.0, "c"],
            [date(2026, 7, 8), "H", 10.0, "+"],
        ]
    )

    lignes = import_bancaire.previsualiser(
        db_session, preset.id, contenu, compte_id_defaut=compte.id
    ).lignes

    assert [l.montant_signe for l in lignes] == [-10.0] * 4 + [10.0] * 4


def test_un_libelle_de_sens_inconnu_met_la_ligne_en_erreur(db_session):
    """Deviner inverserait l'opération dans tous les soldes : mieux vaut
    refuser la ligne et le dire."""
    compte = creer_compte(db_session, "CC Perso")
    preset = _preset(db_session)
    contenu = _fichier([[date(2026, 7, 1), "Courses", 45.2, "XYZ"]])

    ligne = import_bancaire.previsualiser(
        db_session, preset.id, contenu, compte_id_defaut=compte.id
    ).lignes[0]

    assert "XYZ" in ligne.erreur
    assert "non reconnu" in ligne.erreur


def test_une_cellule_de_sens_vide_est_une_erreur_quand_le_preset_lit_le_sens(db_session):
    """Le format annonce une colonne de sens : une ligne qui ne la remplit pas
    ne dit pas dans quel sens elle va, et il n'y a pas de signe pour suppléer."""
    compte = creer_compte(db_session, "CC Perso")
    preset = _preset(db_session)
    contenu = _fichier([[date(2026, 7, 1), "Courses", 45.2, None]])

    ligne = import_bancaire.previsualiser(
        db_session, preset.id, contenu, compte_id_defaut=compte.id
    ).lignes[0]

    assert "sens manquant" in ligne.erreur


def test_le_sens_prime_sur_un_signe_deja_present(db_session):
    """Un relevé qui signe ET annonce le sens : c'est la colonne explicitement
    configurée qui tranche, pas le signe."""
    compte = creer_compte(db_session, "CC Perso")
    preset = _preset(db_session)
    contenu = _fichier([[date(2026, 7, 1), "Remboursement", -45.2, "Crédit"]])

    ligne = import_bancaire.previsualiser(
        db_session, preset.id, contenu, compte_id_defaut=compte.id
    ).lignes[0]

    assert ligne.montant_signe == 45.2


def test_le_sens_impose_entree_sur_une_operation_classique(db_session):
    """Sans colonne de sens, une ligne classique est une dépense dès que sa
    catégorie n'est pas « Entrées d'argent ». Le fichier peut désormais dire le
    contraire."""
    compte = creer_compte(db_session, "CC Perso")
    preset = _preset(db_session)
    contenu = _fichier([[date(2026, 7, 1), "Prime", 800.0, "Crédit"]])

    import_bancaire.confirmer(
        db_session,
        preset.id,
        contenu,
        schemas.ImportMappingOverrides(
            categories={"": get_categorie_id(db_session, "Autres")}
        ),
        compte_id_defaut=compte.id,
    )

    operation = db_session.query(models.Operation).one()
    assert operation.sens == Sens.entree
    # La catégorie, elle, reste celle qui a été choisie : le sens ne la change pas.
    assert operation.categorie_id == get_categorie_id(db_session, "Autres")


def test_le_sens_impose_depense_sur_une_operation_classique(db_session):
    compte = creer_compte(db_session, "CC Perso")
    preset = _preset(db_session)
    contenu = _fichier([[date(2026, 7, 1), "Courses", 45.2, "Débit"]])

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


def test_le_sens_oriente_un_virement_dont_le_montant_est_positif(db_session):
    """Le cas qui motive la fonctionnalité : sans signe, tout virement passait
    pour une réception."""
    source = creer_compte(db_session, "CC Perso")
    destination = creer_compte(db_session, "Livret A", type_nom="épargne")
    _regle_virement(db_session)
    preset = _preset(db_session)
    contenu = _fichier([[date(2026, 7, 1), "Transfert vers Livret A", 100.0, "Débit"]])

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


def test_un_preset_declare_son_propre_vocabulaire(db_session):
    """Le vocabulaire par défaut est français : un relevé anglophone ou
    portugais mettait toutes ses lignes en erreur, sans autre recours que de
    renoncer à la colonne. Le preset déclare désormais le sien, une fois."""
    compte = creer_compte(db_session, "CC Perso")
    preset = _preset(db_session, sortie=["OUT", "Payment"], entree=["IN", "Receipt"])
    contenu = _fichier(
        [
            [date(2026, 7, 1), "Courses", 45.2, "OUT"],
            [date(2026, 7, 2), "Salaire", 1500.0, "receipt"],
        ]
    )

    lignes = import_bancaire.previsualiser(
        db_session, preset.id, contenu, compte_id_defaut=compte.id
    ).lignes

    assert [l.montant_signe for l in lignes] == [-45.2, 1500.0]
    assert [l.erreur for l in lignes] == [None, None]


def test_un_vocabulaire_declare_remplace_entierement_celui_par_defaut(db_session):
    """Sinon « Débit » resterait compris à côté de « OUT », et un relevé qui
    emploie un mot du vocabulaire français dans un autre sens serait interprété
    à l'envers sans que rien ne le signale."""
    compte = creer_compte(db_session, "CC Perso")
    preset = _preset(db_session, sortie=["OUT"], entree=["IN"])
    contenu = _fichier([[date(2026, 7, 1), "Courses", 45.2, "Débit"]])

    ligne = import_bancaire.previsualiser(
        db_session, preset.id, contenu, compte_id_defaut=compte.id
    ).lignes[0]

    assert "non reconnu" in ligne.erreur
    # Le message cite le vocabulaire du preset : sans ça, rien ne dit contre
    # quoi le libellé a été comparé.
    assert "out" in ligne.erreur and "in" in ligne.erreur


def test_ne_declarer_quun_seul_sens_laisse_lautre_par_defaut(db_session):
    """Un relevé peut n'avoir qu'un mot inhabituel : vider l'autre liste
    mettrait en erreur la moitié du fichier pour rien."""
    compte = creer_compte(db_session, "CC Perso")
    preset = _preset(db_session, sortie=["OUT"])
    contenu = _fichier(
        [
            [date(2026, 7, 1), "Courses", 45.2, "OUT"],
            [date(2026, 7, 2), "Salaire", 1500.0, "Crédit"],
        ]
    )

    lignes = import_bancaire.previsualiser(
        db_session, preset.id, contenu, compte_id_defaut=compte.id
    ).lignes

    assert [l.montant_signe for l in lignes] == [-45.2, 1500.0]


def test_le_vocabulaire_declare_ignore_casse_accents_et_espaces(db_session):
    compte = creer_compte(db_session, "CC Perso")
    preset = _preset(db_session, sortie=["Saída"], entree=["Entrada"])
    contenu = _fichier(
        [
            [date(2026, 7, 1), "A", 10.0, "SAIDA"],
            [date(2026, 7, 2), "B", 10.0, " entrada "],
        ]
    )

    lignes = import_bancaire.previsualiser(
        db_session, preset.id, contenu, compte_id_defaut=compte.id
    ).lignes

    assert [l.montant_signe for l in lignes] == [-10.0, 10.0]


def test_un_meme_mot_cle_ne_peut_pas_designer_les_deux_sens(db_session):
    """Il faudrait bien trancher à l'import, et n'importe quel arbitrage
    inverserait la moitié des lignes concernées."""
    with pytest.raises(HTTPException) as erreur:
        routeur_import.create_preset(
            schemas.ImportPresetCreate(
                nom="Ambigu",
                colonnes=_COLONNES_AVEC_SENS,
                libelles_sens_sortie=["OUT", "Débit"],
                libelles_sens_entree=["IN", "DEBIT"],
            ),
            db_session,
        )

    assert erreur.value.status_code == 400
    assert "deux sens différents" in erreur.value.detail


def test_les_mots_cles_sont_nettoyes_a_lenregistrement(db_session):
    """Saisis en une ligne séparée par des virgules : les entrées vides et les
    doublons (à la casse près) n'ont pas à être stockés."""
    preset = routeur_import.create_preset(
        schemas.ImportPresetCreate(
            nom="Propre",
            colonnes=_COLONNES_AVEC_SENS,
            libelles_sens_sortie=["  OUT ", "", "out", "Payment"],
            libelles_sens_entree=["IN"],
        ),
        db_session,
    )

    assert preset.libelles_sens_sortie == ["OUT", "Payment"]


def test_un_preset_sans_colonne_de_sens_se_comporte_exactement_comme_avant(db_session):
    """La propriété est facultative : ne pas la configurer ne change rien."""
    compte = creer_compte(db_session, "CC Perso")
    preset = _preset(db_session, colonnes=_COLONNES_SANS_SENS)
    contenu = _fichier(
        [
            [date(2026, 7, 1), "Courses", -45.2],
            [date(2026, 7, 2), "Salaire", 1500.0],
        ]
    )

    lignes = import_bancaire.previsualiser(
        db_session, preset.id, contenu, compte_id_defaut=compte.id
    ).lignes

    assert [l.montant_signe for l in lignes] == [-45.2, 1500.0]
    assert [l.nom_banque_sens for l in lignes] == ["", ""]
    assert [l.erreur for l in lignes] == [None, None]

    import_bancaire.confirmer(
        db_session,
        preset.id,
        contenu,
        schemas.ImportMappingOverrides(
            categories={"": get_categorie_id(db_session, "Autres")}
        ),
        compte_id_defaut=compte.id,
    )

    # Sens dérivé de la catégorie, comme toujours : « Autres » est une dépense,
    # y compris pour la ligne au montant positif.
    assert {o.sens for o in db_session.query(models.Operation).all()} == {Sens.depense}
