"""Import d'une PHOTOGRAPHIE de compte de placements.

Un relevé de position donne une ligne par titre détenu — quantité et prix de
revient — sans aucune date. C'est ce qu'on veut quand on arrive avec un
portefeuille déjà constitué et qu'on n'a pas envie de réimporter dix ans de
mouvements pour retrouver ce qu'on détient aujourd'hui.

Ce que ces tests protègent, dans l'ordre de ce qui coûterait le plus cher à
casser :

  - LE PRIX DE REVIENT EST UNITAIRE. Le confondre avec un montant total
    multiplierait ou diviserait chaque position par sa quantité, en silence, et
    fausserait toutes les plus-values ;
  - LA PHOTO N'EST PAS UN HISTORIQUE. Elle crée une détention, pas une suite de
    mouvements : une ligne = un achat daté du jour choisi ;
  - LA VALEUR TOTALE NE SERT QU'AU COURS. Elle ne crée aucune détention, et son
    absence ne doit rien empêcher — c'est la seule colonne facultative ;
  - LES DEUX MODES NE SE MÉLANGENT PAS. Une configuration de photo ne doit pas
    accepter les colonnes d'une liste d'opérations, ni l'inverse : ce serait une
    configuration qui a l'air complète et n'importe rien.
"""
import io
from datetime import date

import openpyxl
import pytest
from fastapi import HTTPException

from app import crud, models, schemas
from app.constants import (
    COLONNES_IMPORT_POSITION_PAR_DEFAUT,
    DomaineImport,
    ModeLecturePlacement,
    Sens,
)
from app.services import placements

from .conftest import charger_module_extension, creer_compte, get_monnaie_id

service = charger_module_extension("import-placements", "service_import_placements.py")
routeur = charger_module_extension("import-placements", "routeur_import_placements.py")
schemas_pl = charger_module_extension(
    "import-placements", "schemas_import_placements.py"
)

PHOTO = date(2026, 8, 29)


# ---------- Outillage ----------


def _fichier(lignes: list[dict]) -> bytes:
    """Les cinq colonnes d'une photographie, précédées d'un en-tête."""
    classeur = openpyxl.Workbook()
    feuille = classeur.active
    feuille.append(["Valeur", "ISIN", "Quantité", "Prix de revient", "Valorisation"])
    for ligne in lignes:
        feuille.append(
            [
                ligne.get("valeur"),
                ligne.get("isin"),
                ligne.get("quantite"),
                ligne.get("prix_revient"),
                ligne.get("valeur_totale"),
            ]
        )
    tampon = io.BytesIO()
    classeur.save(tampon)
    return tampon.getvalue()


def _compte_titres(db, nom="PEA", solde_initial=100000.0):
    return creer_compte(db, nom, type_nom="placements financiers", solde_initial=solde_initial)


def _preset(db, compte=None, colonnes=None, **kwargs):
    return crud.create_import_preset(
        db,
        kwargs.pop("nom", "Courtier"),
        colonnes if colonnes is not None else COLONNES_IMPORT_POSITION_PAR_DEFAUT,
        [],
        ignorer_premiere_ligne=True,
        compte_id=compte.id if compte else None,
        domaine=DomaineImport.placement.value,
        mode_lecture=ModeLecturePlacement.position.value,
        **kwargs,
    )


def _apercu(db, preset, lignes, **kwargs):
    return service.previsualiser(
        db, preset.id, _fichier(lignes), date_position=PHOTO, **kwargs
    )


def _confirmer(db, preset, lignes, overrides=None, **kwargs):
    return service.confirmer(
        db,
        preset.id,
        _fichier(lignes),
        overrides or schemas_pl.OverridesPlacements(),
        date_position=PHOTO,
        **kwargs,
    )


LIGNE = {
    "valeur": "Amundi MSCI World",
    "isin": "LU1681043599",
    "quantite": 12,
    "prix_revient": 87.5,
    "valeur_totale": 1200.0,
}


# ---------- Ce qu'une ligne veut dire ----------


def test_une_ligne_de_position_est_un_achat_a_la_date_choisie(db_session):
    """Une détention n'existe pas en soi dans cette app : elle se somme des
    mouvements. Constater qu'on détient 12 titres à 87,50 € revient donc à dire
    qu'on les a achetés à ce prix — et c'est ce qui rend justes d'un coup la
    valorisation, le prix de revient et les plus-values."""
    compte = _compte_titres(db_session)
    preset = _preset(db_session, compte)

    (ligne,) = _apercu(db_session, preset, [LIGNE]).lignes
    assert ligne.type_placement == "achat"
    assert ligne.date == PHOTO
    assert ligne.quantite == 12
    assert ligne.erreur is None


def test_le_prix_de_revient_est_unitaire(db_session):
    """LE POINT LE PLUS COÛTEUX À CASSER. Le confondre avec un montant total
    diviserait chaque position par sa quantité, en silence."""
    compte = _compte_titres(db_session)
    preset = _preset(db_session, compte)

    (ligne,) = _apercu(db_session, preset, [LIGNE]).lignes
    assert ligne.prix_unitaire == pytest.approx(87.5)
    # Le montant investi se DÉDUIT du prix unitaire, jamais l'inverse.
    assert ligne.montant == pytest.approx(12 * 87.5)


def test_la_valeur_totale_donne_le_cours(db_session):
    """C'est son seul usage : un relevé de position n'a pas de colonne « cours »,
    mais il porte la valorisation, et la quantité est juste à côté."""
    compte = _compte_titres(db_session)
    preset = _preset(db_session, compte)

    (ligne,) = _apercu(db_session, preset, [LIGNE]).lignes
    assert ligne.cours == pytest.approx(1200.0 / 12)


def test_la_valeur_totale_est_facultative(db_session):
    """Un courtier peut ne pas l'exporter, et un cours se saisit très bien à la
    main ensuite : son absence ne doit rien empêcher."""
    compte = _compte_titres(db_session)
    preset = _preset(db_session, compte)
    sans = {**LIGNE, "valeur_totale": None}

    (ligne,) = _apercu(db_session, preset, [sans]).lignes
    assert ligne.cours is None
    assert ligne.erreur is None
    assert ligne.prix_unitaire == pytest.approx(87.5)


def test_lecart_entre_cours_et_prix_de_revient_nest_pas_signale(db_session):
    """Sur une photographie, cet écart N'EST PAS une anomalie : c'est la
    plus-value latente. Le signaler ferait clignoter chaque ligne d'un
    portefeuille qui gagne."""
    compte = _compte_titres(db_session)
    preset = _preset(db_session, compte)
    # 100 € le titre aujourd'hui contre 87,50 € payés : +14 %.
    (ligne,) = _apercu(db_session, preset, [LIGNE]).lignes
    assert ligne.ecart_cours is None


# ---------- Ce que la confirmation écrit ----------


def test_la_confirmation_cree_la_detention_et_le_titre(db_session):
    compte = _compte_titres(db_session)
    preset = _preset(db_session, compte)

    resultat = _confirmer(db_session, preset, [LIGNE])

    assert resultat.operations_creees == 1
    assert resultat.titres_crees == ["Amundi MSCI World"]
    titre = crud.get_action_by_nom(db_session, "Amundi MSCI World")
    assert titre.code_isin == "LU1681043599"
    assert placements.quantite_detenue(db_session, compte.id, titre.id) == pytest.approx(12)


def test_la_confirmation_pose_le_cours_du_jour(db_session):
    compte = _compte_titres(db_session)
    preset = _preset(db_session, compte)

    _confirmer(db_session, preset, [LIGNE])

    titre = crud.get_action_by_nom(db_session, "Amundi MSCI World")
    assert titre.valeur == pytest.approx(100.0)


def test_sans_valeur_totale_le_cours_nest_pas_touche(db_session):
    """Une colonne absente ne doit rien écraser : le cours saisi à la main
    reste."""
    compte = _compte_titres(db_session)
    preset = _preset(db_session, compte)
    monnaie = get_monnaie_id(db_session)
    titre = crud.create_action(db_session, "Amundi MSCI World", monnaie, valeur=42.0)

    _confirmer(db_session, preset, [{**LIGNE, "valeur_totale": None}])

    db_session.refresh(titre)
    assert titre.valeur == pytest.approx(42.0)


def test_les_especes_baissent_du_montant_investi(db_session):
    """L'argent a bien quitté les espèces pour devenir des titres : c'est le
    comportement de tout achat, et la photo n'y fait pas exception."""
    compte = _compte_titres(db_session, solde_initial=100000.0)
    preset = _preset(db_session, compte)

    _confirmer(db_session, preset, [LIGNE])

    ecriture = (
        db_session.query(models.Operation)
        .filter(models.Operation.compte_id == compte.id)
        .one()
    )
    assert ecriture.sens == Sens.transfert_sortant
    assert ecriture.montant == pytest.approx(12 * 87.5)
    assert ecriture.date == PHOTO


# ---------- Le titre se reconnaît, et ce qu'on détient déjà se dit ----------


def test_un_titre_deja_connu_est_rapproche_par_lisin(db_session):
    compte = _compte_titres(db_session)
    preset = _preset(db_session, compte)
    monnaie = get_monnaie_id(db_session)
    titre = crud.create_action(
        db_session, "AMUNDI IDX WLD", monnaie, valeur=90.0, code_isin="LU1681043599"
    )

    (ligne,) = _apercu(db_session, preset, [LIGNE]).lignes
    assert ligne.action_id == titre.id
    assert ligne.titre_a_creer is False


def test_une_position_deja_detenue_est_signalee(db_session):
    """Importer une photo dans un compte qui porte déjà ces titres AJOUTE à ce
    qui s'y trouve. L'aperçu le dit plutôt que de trancher — deux photos
    successives peuvent décrire deux apports différents."""
    compte = _compte_titres(db_session)
    preset = _preset(db_session, compte)
    _confirmer(db_session, preset, [LIGNE])

    (ligne,) = _apercu(db_session, preset, [LIGNE]).lignes
    assert ligne.quantite_deja_detenue == pytest.approx(12)


def test_rien_a_signaler_quand_le_compte_ne_detient_pas_le_titre(db_session):
    compte = _compte_titres(db_session)
    preset = _preset(db_session, compte)
    assert _apercu(db_session, preset, [LIGNE]).lignes[0].quantite_deja_detenue is None


def test_une_ligne_sans_nom_ni_isin_est_en_erreur(db_session):
    compte = _compte_titres(db_session)
    preset = _preset(db_session, compte)
    anonyme = {**LIGNE, "valeur": None, "isin": None}
    assert _apercu(db_session, preset, [anonyme]).lignes[0].erreur is not None


# ---------- Les deux modes ne se mélangent pas ----------


def test_une_photo_refuse_les_colonnes_dune_liste_doperations(db_session):
    """Une colonne « date » ou « type d'opération » ne sera jamais lue ici : la
    laisser passer donnerait une configuration qui a l'air complète et
    n'importe rien."""
    with pytest.raises(HTTPException) as erreur:
        routeur._valider_configuration(
            schemas.ImportPresetCreate(
                nom="Courtier",
                colonnes=[
                    {"index": 1, "propriete": "date"},
                    {"index": 2, "propriete": "quantite"},
                    {"index": 3, "propriete": "prix_revient"},
                    {"index": 4, "propriete": "nom_valeur"},
                ],
                mode_lecture=ModeLecturePlacement.position,
            )
        )
    assert erreur.value.status_code == 400


def test_une_photo_exige_quantite_et_prix_de_revient(db_session):
    with pytest.raises(HTTPException) as erreur:
        routeur._valider_configuration(
            schemas.ImportPresetCreate(
                nom="Courtier",
                colonnes=[
                    {"index": 1, "propriete": "nom_valeur"},
                    {"index": 2, "propriete": "quantite"},
                ],
                mode_lecture=ModeLecturePlacement.position,
            )
        )
    assert erreur.value.status_code == 400


def test_une_photo_exige_le_nom_ou_lisin(db_session):
    with pytest.raises(HTTPException) as erreur:
        routeur._valider_configuration(
            schemas.ImportPresetCreate(
                nom="Courtier",
                colonnes=[
                    {"index": 1, "propriete": "quantite"},
                    {"index": 2, "propriete": "prix_revient"},
                ],
                mode_lecture=ModeLecturePlacement.position,
            )
        )
    assert erreur.value.status_code == 400


def test_une_liste_doperations_refuse_les_colonnes_dune_photo(db_session):
    with pytest.raises(HTTPException) as erreur:
        routeur._valider_configuration(
            schemas.ImportPresetCreate(
                nom="Courtier",
                colonnes=[
                    {"index": 1, "propriete": "date"},
                    {"index": 2, "propriete": "type_placement"},
                    {"index": 3, "propriete": "montant"},
                    {"index": 4, "propriete": "quantite"},
                    {"index": 5, "propriete": "nom_valeur"},
                    {"index": 6, "propriete": "prix_revient"},
                ],
            )
        )
    assert erreur.value.status_code == 400


def test_un_preset_sans_mode_lit_une_liste_doperations(db_session):
    """NULL en base vaut « operations » : c'est ce que sont tous les presets
    antérieurs, et rien ne doit changer pour eux."""
    preset = crud.create_import_preset(
        db_session,
        "Ancien",
        None,
        [],
        domaine=DomaineImport.placement.value,
    )
    assert preset.mode_lecture is None
    assert service.mode_lecture(preset) is ModeLecturePlacement.operations
    assert service.lit_une_position(preset) is False


def test_les_colonnes_par_defaut_suivent_le_mode(db_session):
    photo = crud.create_import_preset(
        db_session,
        "Photo",
        None,
        [],
        domaine=DomaineImport.placement.value,
        mode_lecture=ModeLecturePlacement.position.value,
    )
    assert {c["propriete"] for c in photo.colonnes} == {
        "nom_valeur",
        "code_isin",
        "quantite",
        "prix_revient",
        "valeur_totale",
    }


# ---------- Ce que le mode partage avec l'autre ----------


def test_le_stock_anti_doublons_marche_aussi_sur_une_photo(db_session):
    """Toute la mécanique qui entoure la lecture est commune aux deux modes :
    réimporter le même fichier signale ses lignes."""
    compte = _compte_titres(db_session)
    preset = _preset(db_session, compte)
    _confirmer(db_session, preset, [LIGNE])

    (ligne,) = _apercu(db_session, preset, [LIGNE]).lignes
    assert ligne.doublon_de is not None


def test_l_historique_enregistre_l_import(db_session):
    compte = _compte_titres(db_session)
    preset = _preset(db_session, compte)
    resultat = _confirmer(db_session, preset, [LIGNE])

    entree = crud.get_import_historique_entree(db_session, resultat.historique_id)
    assert entree.operations_creees == 1


def test_un_titre_cree_depuis_lecran_garde_son_isin(db_session):
    """L'ISIN voyageait sans être écrit : le schéma l'acceptait, la création ne
    le posait pas. Un titre saisi depuis la page Placements perdait donc son
    code, et l'import suivant — qui rapproche par l'ISIN avant le nom — en
    créait un second."""
    routeur_actions = charger_module_extension("placements", "routeur_actions.py")
    lu = routeur_actions.create_action(
        schemas.ActionCreate(
            nom="Amundi MSCI World",
            monnaie_id=get_monnaie_id(db_session),
            valeur=100.0,
            code_isin="LU1681043599",
        ),
        db=db_session,
    )
    assert lu.code_isin == "LU1681043599"

    # Et la photographie le retrouve, au lieu d'en créer un autre.
    compte = _compte_titres(db_session)
    preset = _preset(db_session, compte)
    (ligne,) = _apercu(db_session, preset, [LIGNE]).lignes
    assert ligne.action_id == lu.id
    assert ligne.titre_a_creer is False
