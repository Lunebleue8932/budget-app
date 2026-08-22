"""Colonne « État » : où en est une ligne du relevé chez la banque.

Une ligne importée était jusqu'ici forcément une transaction passée. Les relevés
de néobanques n'en restent pas là : ils listent aussi les autorisations en
attente et les paiements refusés, au milieu des autres.

Ce que ces tests verrouillent : une ligne en attente devient une opération
PRÉVISIONNELLE (le montant est connu, le passage en banque non), une ligne
refusée n'est pas importée DU TOUT et n'entre pas au stock anti-doublons — l'y
mettre la ferait disparaître d'un prochain import alors qu'aucune opération ne
la représente, et si la banque repasse le paiement, la vraie ligne serait prise
pour un doublon.
"""
import io
from datetime import date

import openpyxl
import pytest
from fastapi import HTTPException

from app import crud, models, schemas
from app.constants import Statut
from app.routers import import_bancaire as routeur_import
from app.services import import_bancaire

from .conftest import creer_compte, get_categorie_id


# 1 date | 2 libellé | 3 montant | 4 état
_COLONNES = [
    {"index": 1, "propriete": "date"},
    {"index": 2, "propriete": "nature"},
    {"index": 3, "propriete": "montant"},
    {"index": 4, "propriete": "statut"},
]


def _fichier(lignes: list[list]) -> bytes:
    classeur = openpyxl.Workbook()
    feuille = classeur.active
    for ligne in lignes:
        feuille.append(ligne)
    tampon = io.BytesIO()
    classeur.save(tampon)
    return tampon.getvalue()


def _preset(db, nom="Banque", colonnes=None, **vocabulaire):
    return crud.create_import_preset(
        db,
        nom,
        colonnes if colonnes is not None else _COLONNES,
        [],
        ignorer_premiere_ligne=False,
        **vocabulaire,
    )


def _overrides(db):
    return schemas.ImportMappingOverrides(
        categories={"": get_categorie_id(db, "Autres")}
    )


def test_une_ligne_executee_devient_une_operation_reelle(db_session):
    compte = creer_compte(db_session, "CC Perso")
    preset = _preset(db_session)
    contenu = _fichier([[date(2026, 7, 1), "Courses", -45.2, "Exécuté"]])

    import_bancaire.confirmer(
        db_session, preset.id, contenu, _overrides(db_session), compte_id_defaut=compte.id
    )

    assert db_session.query(models.Operation).one().statut == Statut.reel


def test_une_ligne_en_attente_devient_une_operation_previsionnelle(db_session):
    """Une autorisation non comptabilisée décrit exactement ce que
    « prévisionnel » recouvre déjà : la compter comme réelle fausserait le solde
    réel jusqu'à ce qu'elle passe vraiment."""
    compte = creer_compte(db_session, "CC Perso")
    preset = _preset(db_session)
    contenu = _fichier([[date(2026, 7, 1), "Réservation hôtel", -120.0, "En attente"]])

    import_bancaire.confirmer(
        db_session, preset.id, contenu, _overrides(db_session), compte_id_defaut=compte.id
    )

    operation = db_session.query(models.Operation).one()
    assert operation.statut == Statut.previsionnel
    assert operation.montant == 120.0


def test_une_ligne_refusee_nest_pas_importee_du_tout(db_session):
    compte = creer_compte(db_session, "CC Perso")
    preset = _preset(db_session)
    contenu = _fichier(
        [
            [date(2026, 7, 1), "Paiement refusé", -80.0, "Refusé"],
            [date(2026, 7, 2), "Courses", -45.2, "Exécuté"],
        ]
    )

    resultat = import_bancaire.confirmer(
        db_session, preset.id, contenu, _overrides(db_session), compte_id_defaut=compte.id
    )

    assert resultat.operations_creees == 1
    assert db_session.query(models.Operation).one().nature == "Courses"
    # Ce n'est pas une erreur : la ligne est écartée, pas refusée faute de
    # données. Elle n'a donc rien à faire dans les lignes ignorées.
    assert resultat.lignes_ignorees == []


def test_une_ligne_refusee_nentre_pas_au_stock_anti_doublons(db_session):
    """Le point qui compte : si elle y entrait, la ligne disparaîtrait d'un
    prochain import alors qu'aucune opération ne la représente — et si la banque
    repasse le paiement, la vraie ligne serait prise pour un doublon."""
    compte = creer_compte(db_session, "CC Perso")
    preset = _preset(db_session)
    contenu = _fichier([[date(2026, 7, 1), "Paiement refusé", -80.0, "Refusé"]])

    import_bancaire.confirmer(
        db_session, preset.id, contenu, _overrides(db_session), compte_id_defaut=compte.id
    )

    assert crud.list_lignes_import_brutes(db_session, preset.id) == []


def test_une_ligne_refusee_reste_visible_dans_lapercu(db_session):
    """Elle est écartée, pas cachée : voir ce que l'import a laissé de côté fait
    partie de la relecture."""
    compte = creer_compte(db_session, "CC Perso")
    preset = _preset(db_session)
    contenu = _fichier([[date(2026, 7, 1), "Paiement refusé", -80.0, "Annulé"]])

    ligne = import_bancaire.previsualiser(
        db_session, preset.id, contenu, compte_id_defaut=compte.id
    ).lignes[0]

    assert ligne.statut_import == "refuse"
    assert ligne.nom_banque_statut == "Annulé"
    assert ligne.erreur is None


def test_une_ligne_refusee_incomplete_est_ecartee_sans_bloquer(db_session):
    """Elle n'a pas à être complète pour être écartée : compte non résolu,
    catégorie à confirmer… rien de tout cela ne la concerne."""
    preset = _preset(db_session)
    contenu = _fichier([[date(2026, 7, 1), "Refusé sans compte", -80.0, "Refusé"]])

    resultat = import_bancaire.confirmer(
        db_session, preset.id, contenu, schemas.ImportMappingOverrides()
    )

    assert resultat.operations_creees == 0
    assert resultat.lignes_ignorees == []


def test_un_etat_inconnu_met_la_ligne_en_erreur(db_session):
    """Deviner importerait une opération refusée, ou daterait comme réelle une
    autorisation qui peut encore tomber."""
    compte = creer_compte(db_session, "CC Perso")
    preset = _preset(db_session)
    contenu = _fichier([[date(2026, 7, 1), "Courses", -45.2, "PEUT-ÊTRE"]])

    ligne = import_bancaire.previsualiser(
        db_session, preset.id, contenu, compte_id_defaut=compte.id
    ).lignes[0]

    assert "non reconnu" in ligne.erreur
    assert "PEUT-ÊTRE" in ligne.erreur


def test_une_cellule_detat_vide_est_une_erreur_quand_le_preset_lit_letat(db_session):
    compte = creer_compte(db_session, "CC Perso")
    preset = _preset(db_session)
    contenu = _fichier([[date(2026, 7, 1), "Courses", -45.2, None]])

    ligne = import_bancaire.previsualiser(
        db_session, preset.id, contenu, compte_id_defaut=compte.id
    ).lignes[0]

    assert "état manquant" in ligne.erreur


def test_un_preset_declare_son_propre_vocabulaire_detat(db_session):
    compte = creer_compte(db_session, "CC Perso")
    preset = _preset(
        db_session,
        libelles_statut_execute=["SETTLED"],
        libelles_statut_attente=["PENDING"],
        libelles_statut_refuse=["DECLINED"],
    )
    contenu = _fichier(
        [
            [date(2026, 7, 1), "A", -10.0, "settled"],
            [date(2026, 7, 2), "B", -20.0, "PENDING"],
            [date(2026, 7, 3), "C", -30.0, "Declined"],
        ]
    )

    import_bancaire.confirmer(
        db_session, preset.id, contenu, _overrides(db_session), compte_id_defaut=compte.id
    )

    operations = {o.nature: o.statut for o in db_session.query(models.Operation).all()}
    assert operations == {"A": Statut.reel, "B": Statut.previsionnel}


def test_ne_declarer_quun_seul_etat_laisse_les_autres_par_defaut(db_session):
    compte = creer_compte(db_session, "CC Perso")
    preset = _preset(db_session, libelles_statut_refuse=["KO"])
    contenu = _fichier(
        [
            [date(2026, 7, 1), "A", -10.0, "Exécuté"],
            [date(2026, 7, 2), "B", -20.0, "KO"],
        ]
    )

    resultat = import_bancaire.confirmer(
        db_session, preset.id, contenu, _overrides(db_session), compte_id_defaut=compte.id
    )

    assert resultat.operations_creees == 1
    assert db_session.query(models.Operation).one().nature == "A"


def test_un_preset_sans_colonne_detat_importe_tout_comme_avant(db_session):
    compte = creer_compte(db_session, "CC Perso")
    preset = _preset(db_session, colonnes=_COLONNES[:3])
    contenu = _fichier([[date(2026, 7, 1), "Courses", -45.2]])

    ligne = import_bancaire.previsualiser(
        db_session, preset.id, contenu, compte_id_defaut=compte.id
    ).lignes[0]
    assert (ligne.statut_import, ligne.nom_banque_statut, ligne.erreur) == (None, "", None)

    import_bancaire.confirmer(
        db_session, preset.id, contenu, _overrides(db_session), compte_id_defaut=compte.id
    )
    assert db_session.query(models.Operation).one().statut == Statut.reel


def test_un_meme_mot_cle_ne_peut_pas_designer_deux_etats(db_session):
    with pytest.raises(HTTPException) as erreur:
        routeur_import.create_preset(
            schemas.ImportPresetCreate(
                nom="Ambigu",
                colonnes=_COLONNES,
                libelles_statut_execute=["OK"],
                libelles_statut_refuse=["ok"],
            ),
            db_session,
        )

    assert erreur.value.status_code == 400
    assert "deux états différents" in erreur.value.detail


def test_sens_et_etat_sont_verifies_separement(db_session):
    """Rien n'interdit qu'un même mot désigne une sortie ET un état exécuté :
    ce sont deux colonnes différentes du fichier."""
    preset = routeur_import.create_preset(
        schemas.ImportPresetCreate(
            nom="Homonymes",
            colonnes=_COLONNES,
            libelles_sens_sortie=["OK"],
            libelles_statut_execute=["OK"],
        ),
        db_session,
    )

    assert preset.libelles_sens_sortie == ["OK"]
    assert preset.libelles_statut_execute == ["OK"]
