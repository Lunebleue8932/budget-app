"""La jambe qu'aucun fichier n'a décrite : un virement interne n'est importé
qu'une fois, mais possède ses DEUX lignes au stock anti-doublons.

LE CAS. Le virement du compte A vers le compte B est importé depuis le relevé de
A : l'app écrit les deux jambes, mais le stock ne retient que la ligne brute de A.
Quand le relevé de B arrive, la ligne qui décrit la même transaction n'a rien à
qui se comparer. Ces tests verrouillent le mécanisme qui comble ce trou :

  - TOUT VIREMENT EN BASE EST CANDIDAT, sans marque posée à l'import : celui d'un
    import d'avant, celui saisi à la main, comme les autres ;
  - l'import suivant RECONNAÎT la ligne (compte, sens, montant, date), même si elle
    n'est pas classée en virement, et demande « Oui » ou « Non » ;
  - « Oui » n'importe rien et pose un TÉMOIN (`operation_non_creee`) ;
  - annuler l'import du témoin ne supprime que le témoin, jamais l'opération ;
  - une ligne ÉCARTÉE à la main entre au stock, sans opération, pour être reconnue
    d'emblée au relevé suivant.
"""
from datetime import date

import pytest

from app import crud, extensions, models, schemas
from app.constants import Sens, Statut
from app.services import import_bancaire

from .conftest import creer_compte, get_monnaie_id
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


def _fichier_livret(jour=date(2026, 7, 3), montant=100.0, lignes=1, nature="Depuis CC"):
    return _construire_fichier(
        [{"date": jour, "nature": nature, "montant": montant} for _ in range(lignes)]
    )


def _temoins(db):
    return db.query(models.LigneImportBrute).filter_by(operation_non_creee=True).all()


def _jambe_du_livret(db):
    return db.query(models.Operation).filter_by(sens=Sens.transfert_entrant).one()


def test_un_virement_importe_n_ecrit_aucune_marque(db_session):
    cc, livret, preset_cc, _ = _comptes_et_presets(db_session)

    resultat = _importer_le_virement_depuis_cc(db_session, cc, livret, preset_cc)

    assert resultat.operations_creees == 2
    # Rien n'est marqué : le virement est repérable à ce qu'il est.
    assert db_session.query(models.LigneImportBrute).filter_by(jambe_manquante=True).count() == 0
    assert len(crud.list_lignes_import_brutes(db_session, preset_cc.id)) == 1


def test_la_ligne_de_l_autre_compte_est_reconnue_meme_classee_en_depense(db_session):
    cc, livret, preset_cc, preset_livret = _comptes_et_presets(db_session)
    _importer_le_virement_depuis_cc(db_session, cc, livret, preset_cc)
    jambe = _jambe_du_livret(db_session)

    apercu = import_bancaire.previsualiser(db_session, preset_livret.id, _fichier_livret())

    (ligne,) = apercu.lignes
    assert ligne.doublon_de is None
    assert ligne.jambe_manquante_id == jambe.id
    # Elle adopte le type et le compte d'en face de la jambe, comme un doublon
    # reconnu adopte le type de l'opération en base.
    assert ligne.type_code == "virement"
    assert ligne.compte_id_autre == cc.id
    lue = apercu.jambes_manquantes[str(jambe.id)]
    assert lue.compte_nom == "Livret A"
    assert lue.compte_en_face_nom == "CC Perso"
    assert lue.ecart_jours == 2


def test_un_virement_saisi_a_la_main_est_reconnu_aussi(db_session):
    """C'était le trou : sans marque posée à l'import, tout virement qui n'y devait
    pas sa naissance — saisi à la main, d'avant la fonction — passait inaperçu."""
    cc, livret, _, preset_livret = _comptes_et_presets(db_session)
    crud.create_virement(
        db_session,
        schemas.VirementCreate(
            date=date(2026, 7, 1),
            compte_source_id=cc.id,
            compte_destination_id=livret.id,
            montant=100.0,
            monnaie_id=get_monnaie_id(db_session),
            nature="Épargne",
            statut=Statut.reel,
        ),
        cc,
        livret,
    )

    apercu = import_bancaire.previsualiser(db_session, preset_livret.id, _fichier_livret())

    assert apercu.lignes[0].jambe_manquante_id == _jambe_du_livret(db_session).id


def test_le_releve_qui_a_decrit_le_virement_ne_le_reprend_pas(db_session):
    """Un virement importé par CE preset n'a rien à « compléter » : son relevé l'a déjà
    décrit. Il reste en revanche candidat pour le relevé de l'AUTRE compte."""
    cc, livret, preset_cc, preset_livret = _comptes_et_presets(db_session)
    # Importé depuis le relevé du LIVRET (le crédit) : la ligne brute est celle du livret.
    contenu = _fichier_livret(jour=date(2026, 7, 1))
    import_bancaire.confirmer(
        db_session,
        preset_livret.id,
        contenu,
        schemas.ImportMappingOverrides(
            lignes={2: schemas.ImportLigneOverride(type_code="virement", compte_id_autre=cc.id)}
        ),
    )

    # Une autre ligne de 100 € du livret, ce même jour : pas ce virement.
    meme_preset = import_bancaire.previsualiser(
        db_session, preset_livret.id, _fichier_livret(jour=date(2026, 7, 2), nature="Autre")
    )
    # Le relevé du compte courant, lui, décrit la jambe de départ.
    autre_compte = import_bancaire.previsualiser(
        db_session,
        preset_cc.id,
        _construire_fichier([{"date": date(2026, 7, 1), "nature": "Vers Livret", "montant": -100.0}]),
    )

    assert meme_preset.lignes[0].jambe_manquante_id is None
    assert autre_compte.lignes[0].jambe_manquante_id is not None


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

    with pytest.raises(import_bancaire.ImportBloque):
        import_bancaire.confirmer(
            db_session,
            preset_livret.id,
            _fichier_livret(),
            schemas.ImportMappingOverrides(jambes_validees={2: None}),
        )

    # Rien n'a bougé : ni opération de plus, ni témoin.
    assert db_session.query(models.Operation).count() == 2
    assert _temoins(db_session) == []


def test_oui_n_importe_rien_et_pose_un_temoin(db_session):
    cc, livret, preset_cc, preset_livret = _comptes_et_presets(db_session)
    _importer_le_virement_depuis_cc(db_session, cc, livret, preset_cc)
    jambe = _jambe_du_livret(db_session)

    resultat = import_bancaire.confirmer(
        db_session,
        preset_livret.id,
        _fichier_livret(),
        schemas.ImportMappingOverrides(jambes_validees={2: True}),
    )

    assert resultat.operations_creees == 0
    assert resultat.doublons_detectes == 1
    assert db_session.query(models.Operation).count() == 2
    (temoin,) = _temoins(db_session)
    assert temoin.operation_id == jambe.id
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

    # Un AUTRE relevé (libellé différent, donc pas un doublon de colonnes) qui décrit
    # la même somme à la même date ne reprend pas la jambe.
    apercu = import_bancaire.previsualiser(
        db_session, preset_livret.id, _fichier_livret(nature="Autre libellé")
    )

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

    # Le virement vient de l'import 1 : il reste entier.
    assert annulation.operations_supprimees == 0
    assert annulation.historique_supprime is True
    assert db_session.query(models.Operation).count() == 2
    assert _temoins(db_session) == []
    # Et la jambe est de nouveau candidate : le relevé redevient « à valider ».
    apercu = import_bancaire.previsualiser(db_session, preset_livret.id, _fichier_livret())
    assert apercu.lignes[0].jambe_manquante_id is not None


def test_annuler_l_import_du_virement_emporte_le_temoin(db_session):
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
    # Le témoin part avec l'opération (CASCADE) : rien ne désigne plus une jambe qui
    # n'existe pas.
    assert db_session.query(models.LigneImportBrute).count() == 0


def test_extension_eteinte_rien_n_est_reconnu(db_session, monkeypatch):
    monkeypatch.setattr(extensions, "est_active", lambda extension_id: False)
    cc, livret, preset_cc, preset_livret = _comptes_et_presets(db_session)
    _importer_le_virement_depuis_cc(db_session, cc, livret, preset_cc)

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


# ---------- Déclarer à la main qu'une ligne est un virement déjà connu ----------


def test_une_ligne_declaree_a_la_main_pose_un_temoin_sur_la_jambe_de_son_compte(db_session):
    """Le bouton des ressemblances désigne UNE opération du virement (la sortante, que
    la veille nomme) ; le témoin se pose sur la jambe du compte de la ligne."""
    cc, livret, preset_cc, preset_livret = _comptes_et_presets(db_session)
    _importer_le_virement_depuis_cc(db_session, cc, livret, preset_cc)
    sortante = db_session.query(models.Operation).filter_by(sens=Sens.transfert_sortant).one()

    resultat = import_bancaire.confirmer(
        db_session,
        preset_livret.id,
        _fichier_livret(),
        schemas.ImportMappingOverrides(jambes_declarees={2: sortante.id}),
    )

    assert resultat.operations_creees == 0
    assert resultat.doublons_detectes == 1
    (temoin,) = _temoins(db_session)
    assert temoin.operation_id == _jambe_du_livret(db_session).id


# ---------- Les lignes écartées à la main entrent au stock ----------


def test_une_ligne_ecartee_a_la_main_entre_au_stock_sans_operation(db_session):
    compte = creer_compte(db_session, "CC Perso")
    preset = _make_preset(db_session, "Relevé", colonnes=COLONNES)
    crud.update_import_preset(db_session, preset, compte_id=compte.id)
    contenu = _construire_fichier(
        [
            {"date": date(2026, 7, 1), "nature": "À importer", "montant": -10.0},
            {"date": date(2026, 7, 2), "nature": "À écarter", "montant": -20.0},
        ]
    )
    categorie_id = crud.get_categories(db_session)[0].id
    overrides = schemas.ImportMappingOverrides(
        categories={},
        lignes={
            2: schemas.ImportLigneOverride(categorie_id=categorie_id),
        },
        lignes_supprimees=[3],
        lignes_ecartees=[3],
    )

    resultat = import_bancaire.confirmer(db_session, preset.id, contenu, overrides)

    assert resultat.operations_creees == 1
    (ecartee,) = _temoins(db_session)
    assert ecartee.operation_id is None
    assert ecartee.donnees["4"] == "À écarter"
    assert ecartee.import_historique_id == resultat.historique_id
    # Au relevé suivant, elle est reconnue d'emblée comme doublon.
    apercu = import_bancaire.previsualiser(db_session, preset.id, contenu)
    par_nature = {l.nature: l for l in apercu.lignes}
    assert par_nature["À écarter"].doublon_de is not None
    # La ligne importée l'est aussi, évidemment.
    assert par_nature["À importer"].doublon_de is not None


def test_annuler_l_import_retire_aussi_les_lignes_ecartees(db_session):
    compte = creer_compte(db_session, "CC Perso")
    preset = _make_preset(db_session, "Relevé", colonnes=COLONNES)
    crud.update_import_preset(db_session, preset, compte_id=compte.id)
    contenu = _construire_fichier(
        [{"date": date(2026, 7, 2), "nature": "À écarter", "montant": -20.0}]
    )
    resultat = import_bancaire.confirmer(
        db_session,
        preset.id,
        contenu,
        schemas.ImportMappingOverrides(lignes_supprimees=[2], lignes_ecartees=[2]),
    )
    assert len(_temoins(db_session)) == 1

    import_bancaire.annuler_import(db_session, resultat.historique_id)

    assert _temoins(db_session) == []
    apercu = import_bancaire.previsualiser(db_session, preset.id, contenu)
    assert apercu.lignes[0].doublon_de is None
