"""La jambe qu'aucun fichier n'a décrite : un virement interne n'est importé
qu'une fois, mais possède ses DEUX lignes au stock anti-doublons.

LE CAS. Le virement du compte A vers le compte B est importé depuis le relevé de
A : l'app écrit les deux jambes, mais le stock ne retient que la ligne brute de A.
Quand le relevé de B arrive, la ligne qui décrit la même transaction n'a rien à
qui se comparer. Ces tests verrouillent le mécanisme qui comble ce trou :

  - l'import 1 MARQUE la jambe de B au stock (`jambe_manquante`, sans colonnes) ;
  - l'import 2 la RECONNAÎT (compte, sens, montant, date), même si la ligne n'est
    pas classée en virement, et demande « Oui » ou « Non » ;
  - « Oui » n'importe rien et pose un TÉMOIN (`operation_non_creee`) ;
  - annuler l'import 2 ne supprime que le témoin, jamais l'opération.
"""
from datetime import date

import pytest

from app import crud, extensions, models, schemas
from app.constants import Sens
from app.services import import_bancaire

from .conftest import creer_compte
from .test_import_bancaire import _construire_fichier, _make_preset

COLONNES = [
    {"index": 1, "propriete": "date"},
    {"index": 4, "propriete": "nature"},
    {"index": 7, "propriete": "montant"},
]


def _comptes_et_presets(db):
    cc = creer_compte(db, "CC Perso")
    livret = creer_compte(db, "Livret A", type_nom="épargne")
    preset_cc = _make_preset(db, "Relevé CC", colonnes=COLONNES)
    crud.update_import_preset(db, preset_cc, compte_id=cc.id)
    preset_livret = _make_preset(db, "Relevé Livret", colonnes=COLONNES)
    crud.update_import_preset(db, preset_livret, compte_id=livret.id)
    return cc, livret, preset_cc, preset_livret


def _importer_le_virement_depuis_cc(db, cc, livret, preset_cc, jour=date(2026, 7, 1)):
    contenu = _construire_fichier([{"date": jour, "nature": "Vers Livret A", "montant": -100.0}])
    overrides = schemas.ImportMappingOverrides(
        lignes={
            2: schemas.ImportLigneOverride(type_code="virement", compte_id_autre=livret.id)
        }
    )
    return import_bancaire.confirmer(db, preset_cc.id, contenu, overrides)


def _fichier_livret(jour=date(2026, 7, 3), montant=100.0, lignes=1):
    return _construire_fichier(
        [{"date": jour, "nature": "Depuis CC", "montant": montant} for _ in range(lignes)]
    )


def _marques(db):
    return db.query(models.LigneImportBrute).filter_by(jambe_manquante=True).all()


def _temoins(db):
    return db.query(models.LigneImportBrute).filter_by(operation_non_creee=True).all()


def test_l_import_du_virement_marque_la_jambe_de_l_autre_compte(db_session):
    cc, livret, preset_cc, _ = _comptes_et_presets(db_session)

    resultat = _importer_le_virement_depuis_cc(db_session, cc, livret, preset_cc)

    assert resultat.operations_creees == 2
    (marque,) = _marques(db_session)
    entrante = db_session.query(models.Operation).filter_by(sens=Sens.transfert_entrant).one()
    assert marque.operation_id == entrante.id
    assert entrante.compte_id == livret.id
    # La marque part avec l'import qui l'a écrite, et n'a aucune colonne brute.
    assert marque.import_historique_id == resultat.historique_id
    assert marque.donnees == {}
    # Le stock COMPARÉ ne la contient pas : une comparaison sans colonne serait
    # toujours vraie, et chaque ligne du fichier serait son doublon.
    assert len(crud.list_lignes_import_brutes(db_session, preset_cc.id)) == 1


def test_la_ligne_de_l_autre_compte_est_reconnue_meme_classee_en_depense(db_session):
    cc, livret, preset_cc, preset_livret = _comptes_et_presets(db_session)
    _importer_le_virement_depuis_cc(db_session, cc, livret, preset_cc)
    (marque,) = _marques(db_session)

    apercu = import_bancaire.previsualiser(db_session, preset_livret.id, _fichier_livret())

    (ligne,) = apercu.lignes
    assert ligne.doublon_de is None
    assert ligne.jambe_manquante_id == marque.id
    # Elle adopte le type et le compte d'en face de la jambe, comme un doublon
    # reconnu adopte le type de l'opération en base.
    assert ligne.type_code == "virement"
    assert ligne.compte_id_autre == cc.id
    lue = apercu.jambes_manquantes[str(marque.id)]
    assert lue.compte_nom == "Livret A"
    assert lue.compte_en_face_nom == "CC Perso"
    assert lue.ecart_jours == 2


def test_hors_fenetre_de_date_rien_n_est_reconnu(db_session):
    cc, livret, preset_cc, preset_livret = _comptes_et_presets(db_session)
    _importer_le_virement_depuis_cc(db_session, cc, livret, preset_cc)

    apercu = import_bancaire.previsualiser(
        db_session, preset_livret.id, _fichier_livret(jour=date(2026, 7, 20))
    )

    assert apercu.lignes[0].jambe_manquante_id is None
    assert apercu.jambes_manquantes == {}


def test_un_autre_montant_ou_un_autre_sens_ne_ressemble_pas(db_session):
    cc, livret, preset_cc, preset_livret = _comptes_et_presets(db_session)
    _importer_le_virement_depuis_cc(db_session, cc, livret, preset_cc)

    autre_montant = import_bancaire.previsualiser(
        db_session, preset_livret.id, _fichier_livret(montant=99.0)
    )
    # Une SORTIE de 100 € du livret n'est pas l'entrée de 100 € qu'attend la jambe.
    sortie = import_bancaire.previsualiser(
        db_session, preset_livret.id, _fichier_livret(montant=-100.0)
    )

    assert autre_montant.lignes[0].jambe_manquante_id is None
    assert sortie.lignes[0].jambe_manquante_id is None


def test_une_jambe_ne_sert_qu_a_une_seule_ligne(db_session):
    cc, livret, preset_cc, preset_livret = _comptes_et_presets(db_session)
    _importer_le_virement_depuis_cc(db_session, cc, livret, preset_cc)

    apercu = import_bancaire.previsualiser(
        db_session, preset_livret.id, _fichier_livret(lignes=2)
    )

    premiere, seconde = apercu.lignes
    assert premiere.jambe_manquante_id is not None
    assert seconde.jambe_manquante_id is None


def test_confirmer_refuse_tant_que_la_validation_n_est_pas_choisie(db_session):
    cc, livret, preset_cc, preset_livret = _comptes_et_presets(db_session)
    _importer_le_virement_depuis_cc(db_session, cc, livret, preset_cc)
    contenu = _fichier_livret()

    with pytest.raises(import_bancaire.ImportBloque):
        import_bancaire.confirmer(
            db_session,
            preset_livret.id,
            contenu,
            schemas.ImportMappingOverrides(jambes_validees={2: None}),
        )

    # Rien n'a bougé : ni opération de plus, ni témoin.
    assert db_session.query(models.Operation).count() == 2
    assert _temoins(db_session) == []


def test_oui_n_importe_rien_et_pose_un_temoin(db_session):
    cc, livret, preset_cc, preset_livret = _comptes_et_presets(db_session)
    _importer_le_virement_depuis_cc(db_session, cc, livret, preset_cc)
    entrante = db_session.query(models.Operation).filter_by(sens=Sens.transfert_entrant).one()
    contenu = _fichier_livret()

    resultat = import_bancaire.confirmer(
        db_session,
        preset_livret.id,
        contenu,
        schemas.ImportMappingOverrides(jambes_validees={2: True}),
    )

    assert resultat.operations_creees == 0
    assert resultat.doublons_detectes == 1
    assert db_session.query(models.Operation).count() == 2
    (temoin,) = _temoins(db_session)
    assert temoin.operation_id == entrante.id
    assert temoin.preset_id == preset_livret.id
    assert temoin.import_historique_id == resultat.historique_id
    # De vraies colonnes brutes : c'est ce qui fait reconnaître le relevé ensuite.
    assert temoin.donnees["4"] == "Depuis CC"


def test_apres_oui_le_meme_releve_est_un_doublon_ordinaire(db_session):
    """Priorité 1 : le doublon de colonnes l'emporte, la jambe se tait — et la
    question n'est plus jamais reposée."""
    cc, livret, preset_cc, preset_livret = _comptes_et_presets(db_session)
    _importer_le_virement_depuis_cc(db_session, cc, livret, preset_cc)
    contenu = _fichier_livret()
    import_bancaire.confirmer(
        db_session,
        preset_livret.id,
        contenu,
        schemas.ImportMappingOverrides(jambes_validees={2: True}),
    )

    apercu = import_bancaire.previsualiser(db_session, preset_livret.id, contenu)

    (ligne,) = apercu.lignes
    assert ligne.doublon_de is not None
    assert ligne.jambe_manquante_id is None


def test_une_jambe_validee_n_est_plus_candidate(db_session):
    """Une jambe, un seul rapprochement — d'un relevé à l'autre aussi."""
    cc, livret, preset_cc, preset_livret = _comptes_et_presets(db_session)
    _importer_le_virement_depuis_cc(db_session, cc, livret, preset_cc)
    import_bancaire.confirmer(
        db_session,
        preset_livret.id,
        _fichier_livret(),
        schemas.ImportMappingOverrides(jambes_validees={2: True}),
    )

    # Un AUTRE relevé (colonnes différentes, donc pas un doublon de colonnes) qui
    # décrit la même somme à la même date ne reprend pas la jambe.
    autre = _construire_fichier(
        [{"date": date(2026, 7, 3), "nature": "Autre libellé", "montant": 100.0}]
    )
    apercu = import_bancaire.previsualiser(db_session, preset_livret.id, autre)

    assert apercu.lignes[0].doublon_de is None
    assert apercu.lignes[0].jambe_manquante_id is None


def test_non_importe_la_ligne_comme_une_operation_a_part(db_session):
    cc, livret, preset_cc, preset_livret = _comptes_et_presets(db_session)
    _importer_le_virement_depuis_cc(db_session, cc, livret, preset_cc)

    resultat = import_bancaire.confirmer(
        db_session,
        preset_livret.id,
        _fichier_livret(),
        schemas.ImportMappingOverrides(jambes_validees={2: False}),
    )

    # Le virement adopté est écrit comme n'importe quel virement : deux jambes de plus.
    assert resultat.operations_creees == 2
    assert _temoins(db_session) == []


def test_changer_le_compte_en_face_passe_la_validation_en_non(db_session):
    """Le champ n'est plus à trancher dès que la ligne n'est plus ce que l'app a lu."""
    cc, livret, preset_cc, preset_livret = _comptes_et_presets(db_session)
    autre = creer_compte(db_session, "PEL", type_nom="épargne")
    _importer_le_virement_depuis_cc(db_session, cc, livret, preset_cc)

    resultat = import_bancaire.confirmer(
        db_session,
        preset_livret.id,
        _fichier_livret(),
        schemas.ImportMappingOverrides(
            jambes_validees={2: None},
            lignes={2: schemas.ImportLigneOverride(compte_id_autre=autre.id)},
        ),
    )

    assert resultat.operations_creees == 2
    assert _temoins(db_session) == []


def test_changer_le_type_passe_la_validation_en_non(db_session):
    cc, livret, preset_cc, preset_livret = _comptes_et_presets(db_session)
    _importer_le_virement_depuis_cc(db_session, cc, livret, preset_cc)
    categorie_id = crud.get_categories(db_session)[0].id

    resultat = import_bancaire.confirmer(
        db_session,
        preset_livret.id,
        _fichier_livret(),
        schemas.ImportMappingOverrides(
            jambes_validees={2: None},
            lignes={
                2: schemas.ImportLigneOverride(
                    type_code="classique", categorie_id=categorie_id
                )
            },
        ),
    )

    assert resultat.operations_creees == 1
    assert _temoins(db_session) == []


def test_annuler_l_import_du_temoin_ne_supprime_pas_l_operation(db_session):
    cc, livret, preset_cc, preset_livret = _comptes_et_presets(db_session)
    _importer_le_virement_depuis_cc(db_session, cc, livret, preset_cc)
    resultat = import_bancaire.confirmer(
        db_session,
        preset_livret.id,
        _fichier_livret(),
        schemas.ImportMappingOverrides(jambes_validees={2: True}),
    )
    assert len(_temoins(db_session)) == 1

    annulation = import_bancaire.annuler_import(db_session, resultat.historique_id)

    # Le virement vient de l'import 1 : il reste entier, avec sa jambe marquée.
    assert annulation.operations_supprimees == 0
    assert annulation.historique_supprime is True
    assert db_session.query(models.Operation).count() == 2
    assert _temoins(db_session) == []
    assert len(_marques(db_session)) == 1
    # Et la jambe est de nouveau candidate : le relevé redevient « à valider ».
    apercu = import_bancaire.previsualiser(db_session, preset_livret.id, _fichier_livret())
    assert apercu.lignes[0].jambe_manquante_id is not None


def test_annuler_l_import_du_virement_emporte_la_marque_et_le_temoin(db_session):
    cc, livret, preset_cc, preset_livret = _comptes_et_presets(db_session)
    import_1 = _importer_le_virement_depuis_cc(db_session, cc, livret, preset_cc)
    import_bancaire.confirmer(
        db_session,
        preset_livret.id,
        _fichier_livret(),
        schemas.ImportMappingOverrides(jambes_validees={2: True}),
    )

    annulation = import_bancaire.annuler_import(db_session, import_1.historique_id)

    assert annulation.operations_supprimees == 2
    assert db_session.query(models.Operation).count() == 0
    # Marque ET témoin partent avec l'opération (CASCADE) : rien ne désigne plus
    # une jambe qui n'existe pas.
    assert db_session.query(models.LigneImportBrute).count() == 0


def test_supprimer_le_virement_emporte_la_marque(db_session):
    cc, livret, preset_cc, _ = _comptes_et_presets(db_session)
    _importer_le_virement_depuis_cc(db_session, cc, livret, preset_cc)
    jambes = db_session.query(models.Operation).all()

    crud.delete_virement(db_session, jambes)

    assert _marques(db_session) == []


def test_extension_eteinte_rien_n_est_marque_ni_reconnu(db_session, monkeypatch):
    monkeypatch.setattr(extensions, "est_active", lambda extension_id: False)
    cc, livret, preset_cc, preset_livret = _comptes_et_presets(db_session)

    _importer_le_virement_depuis_cc(db_session, cc, livret, preset_cc)

    assert _marques(db_session) == []
    apercu = import_bancaire.previsualiser(db_session, preset_livret.id, _fichier_livret())
    assert apercu.lignes[0].jambe_manquante_id is None
    assert apercu.jambes_manquantes == {}


def test_une_ligne_non_vue_a_l_apercu_ne_bloque_pas_l_import(db_session):
    """Sans clé dans `jambes_validees`, l'écran n'a jamais montré la question :
    la relecture à la confirmation ne doit pas l'inventer."""
    cc, livret, preset_cc, preset_livret = _comptes_et_presets(db_session)
    _importer_le_virement_depuis_cc(db_session, cc, livret, preset_cc)

    resultat = import_bancaire.confirmer(
        db_session,
        preset_livret.id,
        _fichier_livret(),
        schemas.ImportMappingOverrides(),
    )

    assert resultat.operations_creees == 1
    assert _temoins(db_session) == []
