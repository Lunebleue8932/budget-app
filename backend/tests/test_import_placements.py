"""Import d'une liste d'opérations d'un compte de placements.

Ce que ces tests protègent, dans l'ordre de ce qui coûterait le plus cher à
casser :

  - LE CLOISONNEMENT DES DOMAINES. Les presets de placements partagent la table
    `import_preset` avec ceux des relevés bancaires ; chaque routeur ne doit
    voir que les siens, sinon un preset se retrouve dans le mauvais écran et y
    importe des lignes vides sans que rien ne le signale ;
  - LE MONTANT FAIT FOI. Le prix unitaire se déduit de montant / quantité, et
    jamais du cours lu : c'est ce qui garantit que le solde du compte colle au
    relevé ;
  - LES TRANSFERTS SE RAPPROCHENT DES VIREMENTS DÉJÀ EN BASE, d'où qu'ils
    viennent — c'est la raison d'être du choix d'en faire de vrais virements
    à double écriture plutôt que des écritures à part.
"""
import io
from datetime import date

import openpyxl
import pytest
from fastapi import HTTPException

from app import crud, models, schemas
from app.constants import (
    COLONNES_IMPORT_PLACEMENT_PAR_DEFAUT,
    DomaineImport,
    ModeComparaison,
    Sens,
    TypeOperation,
)
from app.routers import import_bancaire as routeur_bancaire

from .conftest import charger_module_extension, creer_compte, get_monnaie_id

# L'import de placements est une EXTENSION : ses modules se chargent par chemin
# de fichier, comme l'application le fait (cf. conftest.charger_module_extension).
service = charger_module_extension("import-placements", "service_import_placements.py")
routeur = charger_module_extension("import-placements", "routeur_import_placements.py")
schemas_pl = charger_module_extension(
    "import-placements", "schemas_import_placements.py"
)


# ---------- Outillage ----------


def _fichier(lignes: list[dict]) -> bytes:
    """Un classeur aux sept colonnes de COLONNES_IMPORT_PLACEMENT_PAR_DEFAUT,
    précédé d'une ligne d'en-tête (d'où `ignorer_premiere_ligne=True` dans
    `_preset`)."""
    classeur = openpyxl.Workbook()
    feuille = classeur.active
    feuille.append(
        ["Date", "Type", "Valeur", "ISIN", "Montant", "Quantité", "Cours"]
    )
    for ligne in lignes:
        feuille.append(
            [
                ligne.get("date"),
                ligne.get("type"),
                ligne.get("valeur"),
                ligne.get("isin"),
                ligne.get("montant"),
                ligne.get("quantite"),
                ligne.get("cours"),
            ]
        )
    tampon = io.BytesIO()
    classeur.save(tampon)
    return tampon.getvalue()


def _compte_titres(db, nom="PEA", solde_initial=10000.0, monnaies=None):
    return creer_compte(
        db,
        nom,
        type_nom="placements financiers",
        solde_initial=solde_initial,
        monnaies=monnaies,
    )


def _preset(db, compte=None, nom="Courtier", colonnes=None, **kwargs):
    return crud.create_import_preset(
        db,
        nom,
        colonnes if colonnes is not None else COLONNES_IMPORT_PLACEMENT_PAR_DEFAUT,
        [],
        ignorer_premiere_ligne=True,
        compte_id=compte.id if compte else None,
        domaine=DomaineImport.placement.value,
        **kwargs,
    )


def _confirmer(db, preset, contenu, overrides=None, **kwargs):
    return service.confirmer(
        db,
        preset.id,
        contenu,
        overrides or schemas_pl.OverridesPlacements(),
        **kwargs,
    )


def _mouvements(db):
    return db.query(models.OperationAction).all()


# ---------- Cloisonnement des deux domaines ----------


def test_un_preset_de_placements_est_invisible_depuis_limport_bancaire(db_session):
    """Le point le plus important du partage de table : chaque écran ne voit
    que ses presets. Un preset de placements affiché dans le sélecteur de
    l'import bancaire y importerait des lignes vides — ses colonnes désignent
    des propriétés que ce service ne lit pas."""
    bancaire = crud.create_import_preset(db_session, "Ma banque")
    placement = _preset(db_session, nom="Mon courtier")

    vus_bancaire = routeur_bancaire.list_presets(db=db_session)
    assert [p.id for p in vus_bancaire] == [bancaire.id]

    vus_placement = routeur.list_presets(db=db_session)
    assert [p.id for p in vus_placement] == [placement.id]


def test_chaque_routeur_refuse_le_preset_de_lautre(db_session):
    bancaire = crud.create_import_preset(db_session, "Ma banque")
    placement = _preset(db_session)

    with pytest.raises(HTTPException) as erreur:
        routeur_bancaire._get_preset_ou_404(db_session, placement.id)
    assert erreur.value.status_code == 404

    with pytest.raises(HTTPException) as erreur:
        routeur._get_preset_ou_404(db_session, bancaire.id)
    assert erreur.value.status_code == 404


def test_le_meme_nom_peut_servir_dans_les_deux_domaines(db_session):
    """« Boursorama » désigne légitimement un relevé bancaire ET un relevé de
    compte-titres : ce sont deux formats sans rapport (migration 0041)."""
    crud.create_import_preset(db_session, "Boursorama")
    place = _preset(db_session, nom="Boursorama")
    assert place.domaine == DomaineImport.placement.value


def test_supprimer_le_dernier_preset_bancaire_reste_refuse(db_session):
    """Le garde du noyau compte les presets BANCAIRES : créer un preset de
    placements ne doit pas le laisser tomber à zéro."""
    bancaire = crud.create_import_preset(db_session, "Ma banque")
    _preset(db_session)
    with pytest.raises(HTTPException) as erreur:
        routeur_bancaire.delete_preset(bancaire.id, db=db_session)
    assert erreur.value.status_code == 400


def test_la_galerie_des_correspondances_ignore_les_presets_de_placements(db_session):
    """La page Règles est un écran d'import bancaire, et son bouton de
    suppression réécrit sur /import/presets/{id}/… — chemin que le noyau refuse
    pour un preset de placements. Y laisser entrer ses correspondances ferait
    échouer la suppression groupée."""
    compte = _compte_titres(db_session)
    autre = creer_compte(db_session, "CC Perso")
    bancaire = crud.create_import_preset(db_session, "Ma banque")
    place = _preset(db_session, compte)
    crud.set_mapping_compte(db_session, bancaire.id, "CPTE COURANT", autre.id)
    crud.set_mapping_compte(db_session, place.id, "COMPTE ESPECES", autre.id)

    tous = crud.list_mappings_compte_tous_presets(db_session)
    assert [m.nom_banque for m in tous] == ["CPTE COURANT"]


# ---------- Configuration des colonnes ----------


def test_eteindre_nom_et_isin_est_refuse(db_session):
    """Les deux sont facultatifs séparément, jamais ensemble : sans l'un des
    deux, aucune ligne d'achat ne peut dire de quelle valeur elle parle."""
    sans_identite = [
        c
        for c in COLONNES_IMPORT_PLACEMENT_PAR_DEFAUT
        if c["propriete"] not in ("nom_valeur", "code_isin")
    ]
    payload = schemas.ImportPresetCreate(
        nom="Courtier",
        colonnes=[schemas.ColonneImportConfig(**c) for c in sans_identite],
    )
    with pytest.raises(HTTPException) as erreur:
        routeur.create_preset(payload, db=db_session)
    assert erreur.value.status_code == 400
    assert "nom ou à son code ISIN" in erreur.value.detail


@pytest.mark.parametrize("garde", ["nom_valeur", "code_isin"])
def test_une_seule_des_deux_colonnes_didentite_suffit(db_session, garde):
    colonnes = [
        c
        for c in COLONNES_IMPORT_PLACEMENT_PAR_DEFAUT
        if c["propriete"] not in ("nom_valeur", "code_isin") or c["propriete"] == garde
    ]
    payload = schemas.ImportPresetCreate(
        nom=f"Courtier {garde}",
        colonnes=[schemas.ColonneImportConfig(**c) for c in colonnes],
    )
    preset = routeur.create_preset(payload, db=db_session)
    assert {c["propriete"] for c in preset.colonnes} >= {garde}


def test_un_preset_lie_a_un_compte_non_titres_est_refuse(db_session):
    """Refusé à l'enregistrement plutôt que découvert au premier import : lié à
    un compte courant, toutes les lignes d'achat échoueraient une à une."""
    courant = creer_compte(db_session, "CC Perso")
    payload = schemas.ImportPresetCreate(
        nom="Courtier",
        compte_id=courant.id,
        colonnes=[
            schemas.ColonneImportConfig(**c) for c in COLONNES_IMPORT_PLACEMENT_PAR_DEFAUT
        ],
    )
    with pytest.raises(HTTPException) as erreur:
        routeur.create_preset(payload, db=db_session)
    assert erreur.value.status_code == 400
    assert "compte de placements" in erreur.value.detail


def test_un_mot_cle_ne_peut_pas_designer_deux_types(db_session):
    payload = schemas.ImportPresetCreate(
        nom="Courtier",
        colonnes=[
            schemas.ColonneImportConfig(**c) for c in COLONNES_IMPORT_PLACEMENT_PAR_DEFAUT
        ],
        libelles_type_achat=["Mouvement"],
        libelles_type_vente=["MOUVEMENT"],
    )
    with pytest.raises(HTTPException) as erreur:
        routeur.create_preset(payload, db=db_session)
    assert erreur.value.status_code == 400


# ---------- Achats et ventes ----------


def test_un_achat_cree_le_titre_puis_son_mouvement(db_session):
    compte = _compte_titres(db_session)
    preset = _preset(db_session, compte)
    contenu = _fichier(
        [
            {
                "date": "12/03/2026",
                "type": "Achat",
                "valeur": "Amundi MSCI World",
                "isin": "LU1681043599",
                "montant": 1005.50,
                "quantite": 20,
                "cours": 50.0,
            }
        ]
    )

    resultat = _confirmer(db_session, preset, contenu)

    assert resultat.operations_creees == 1
    assert resultat.titres_crees == ["Amundi MSCI World"]
    titre = crud.get_action_by_isin(db_session, "LU1681043599")
    assert titre.nom == "Amundi MSCI World"
    assert titre.monnaie_id == compte.monnaie_principale_id

    mouvement = _mouvements(db_session)[0]
    assert mouvement.quantite == 20
    # LE MONTANT FAIT FOI : 1005,50 / 20, et non le cours annoncé de 50,00.
    # Les 5,50 € de frais de courtage entrent dans le prix de revient, et le
    # solde du compte colle au centime à ce que le relevé annonce.
    assert mouvement.prix_unitaire == pytest.approx(50.275)
    assert mouvement.operation.montant == pytest.approx(1005.50)
    assert mouvement.operation.sens == Sens.transfert_sortant


def test_une_vente_encaisse_le_montant_du_releve(db_session):
    compte = _compte_titres(db_session)
    preset = _preset(db_session, compte)
    _confirmer(
        db_session,
        preset,
        _fichier(
            [
                {
                    "date": "12/03/2026",
                    "type": "Achat",
                    "valeur": "Air Liquide",
                    "isin": "FR0000120073",
                    "montant": 1670.0,
                    "quantite": 10,
                }
            ]
        ),
    )
    resultat = _confirmer(
        db_session,
        preset,
        _fichier(
            [
                {
                    "date": "20/06/2026",
                    "type": "Vente",
                    "valeur": "Air Liquide",
                    "isin": "FR0000120073",
                    "montant": 900.0,
                    "quantite": 5,
                }
            ]
        ),
    )

    assert resultat.operations_creees == 1
    # Aucun second titre : la vente a retrouvé celui de l'achat.
    assert crud.get_actions(db_session, inclure_archivees=True).__len__() == 1
    vente = [m for m in _mouvements(db_session) if m.sens.value == "vente"][0]
    assert vente.operation.sens == Sens.transfert_entrant
    assert vente.operation.montant == pytest.approx(900.0)


def test_le_titre_est_rapproche_par_isin_malgre_un_nom_different(db_session):
    """L'ISIN d'abord : c'est la seule dénomination qui ne change jamais. Le nom
    en base l'emporte — renommer le titre à chaque import réécrirait
    l'historique de la page Placements."""
    compte = _compte_titres(db_session)
    preset = _preset(db_session, compte)
    existant = crud.create_action(
        db_session,
        nom="Amundi MSCI World",
        monnaie_id=get_monnaie_id(db_session),
        code_isin="LU1681043599",
    )

    apercu = service.previsualiser(
        db_session,
        preset.id,
        _fichier(
            [
                {
                    "date": "12/03/2026",
                    "type": "Achat",
                    "valeur": "AMUNDI ETF MSCI WORLD UCITS",
                    "isin": "LU1681043599",
                    "montant": 500.0,
                    "quantite": 10,
                }
            ]
        ),
    )

    ligne = apercu.lignes[0]
    assert ligne.action_id == existant.id
    assert ligne.action_nom == "Amundi MSCI World"
    assert ligne.titre_a_creer is False
    assert apercu.titres_a_creer == []


def test_lisin_du_fichier_complete_un_titre_qui_nen_avait_pas(db_session):
    """Un titre saisi à la main avant que cette extension n'existe n'a pas
    d'ISIN : le premier relevé importé le lui donne."""
    compte = _compte_titres(db_session)
    preset = _preset(db_session, compte)
    existant = crud.create_action(
        db_session, nom="Air Liquide", monnaie_id=get_monnaie_id(db_session)
    )
    assert existant.code_isin is None

    _confirmer(
        db_session,
        preset,
        _fichier(
            [
                {
                    "date": "12/03/2026",
                    "type": "Achat",
                    "valeur": "Air Liquide",
                    "isin": "FR0000120073",
                    "montant": 1670.0,
                    "quantite": 10,
                }
            ]
        ),
    )

    db_session.refresh(existant)
    assert existant.code_isin == "FR0000120073"


def test_un_isin_different_pour_le_meme_nom_met_la_ligne_en_erreur(db_session):
    """Deux valeurs distinctes portent le même nom chez ce courtier : deviner
    laquelle mélangerait deux portefeuilles."""
    compte = _compte_titres(db_session)
    preset = _preset(db_session, compte)
    crud.create_action(
        db_session,
        nom="Total",
        monnaie_id=get_monnaie_id(db_session),
        code_isin="FR0000120271",
    )

    apercu = service.previsualiser(
        db_session,
        preset.id,
        _fichier(
            [
                {
                    "date": "12/03/2026",
                    "type": "Achat",
                    "valeur": "Total",
                    "isin": "US89832Q1094",
                    "montant": 500.0,
                    "quantite": 10,
                }
            ]
        ),
    )

    assert "FR0000120271" in apercu.lignes[0].erreur
    assert _mouvements(db_session) == []


def test_lisin_est_normalise_avant_rapprochement(db_session):
    """Le même titre exporté « fr0000120073 » d'un côté et « FR0000120073 » de
    l'autre ne doit pas donner deux titres."""
    compte = _compte_titres(db_session)
    preset = _preset(db_session, compte)
    crud.create_action(
        db_session,
        nom="Air Liquide",
        monnaie_id=get_monnaie_id(db_session),
        code_isin="FR0000120073",
    )

    apercu = service.previsualiser(
        db_session,
        preset.id,
        _fichier(
            [
                {
                    "date": "12/03/2026",
                    "type": "Achat",
                    "valeur": "AL",
                    "isin": " fr0000120073 ",
                    "montant": 500.0,
                    "quantite": 10,
                }
            ]
        ),
    )
    assert apercu.lignes[0].titre_a_creer is False


def test_un_titre_sans_nom_est_cree_sous_son_isin(db_session):
    """`Action.nom` ne peut pas être vide, et un titre qui s'appellerait « ? »
    serait introuvable dans la liste. L'ISIN, au moins, s'identifie."""
    compte = _compte_titres(db_session)
    preset = _preset(db_session, compte)
    _confirmer(
        db_session,
        preset,
        _fichier(
            [
                {
                    "date": "12/03/2026",
                    "type": "Achat",
                    "isin": "FR0000120073",
                    "montant": 500.0,
                    "quantite": 10,
                }
            ]
        ),
    )
    titre = crud.get_action_by_isin(db_session, "FR0000120073")
    assert titre.nom == "FR0000120073"


def test_le_meme_titre_nest_cree_quune_fois_dans_un_fichier(db_session):
    compte = _compte_titres(db_session)
    preset = _preset(db_session, compte)
    resultat = _confirmer(
        db_session,
        preset,
        _fichier(
            [
                {
                    "date": "12/03/2026",
                    "type": "Achat",
                    "valeur": "Air Liquide",
                    "isin": "FR0000120073",
                    "montant": 500.0,
                    "quantite": 3,
                },
                {
                    "date": "13/03/2026",
                    "type": "Achat",
                    "valeur": "Air Liquide",
                    "isin": "FR0000120073",
                    "montant": 340.0,
                    "quantite": 2,
                },
            ]
        ),
    )
    assert resultat.titres_crees == ["Air Liquide"]
    assert len(crud.get_actions(db_session)) == 1
    assert len(_mouvements(db_session)) == 2


def test_un_cours_divergent_avertit_sans_bloquer(db_session):
    compte = _compte_titres(db_session)
    preset = _preset(db_session, compte)
    apercu = service.previsualiser(
        db_session,
        preset.id,
        _fichier(
            [
                {
                    "date": "12/03/2026",
                    "type": "Achat",
                    "valeur": "Air Liquide",
                    "isin": "FR0000120073",
                    "montant": 1000.0,
                    "quantite": 10,
                    # 200 au lieu de 100 : très au-delà de ECART_COURS_TOLERE.
                    "cours": 200.0,
                }
            ]
        ),
    )
    ligne = apercu.lignes[0]
    assert ligne.ecart_cours == pytest.approx(1.0)
    assert ligne.erreur is None  # jamais bloquant
    assert ligne.prix_unitaire == pytest.approx(100.0)
    assert any("cours qui ne correspond pas" in a for a in apercu.avertissements)


def test_un_cours_qui_concorde_ne_dit_rien(db_session):
    compte = _compte_titres(db_session)
    preset = _preset(db_session, compte)
    apercu = service.previsualiser(
        db_session,
        preset.id,
        _fichier(
            [
                {
                    "date": "12/03/2026",
                    "type": "Achat",
                    "valeur": "Air Liquide",
                    "isin": "FR0000120073",
                    "montant": 1000.0,
                    "quantite": 10,
                    "cours": 100.0,
                }
            ]
        ),
    )
    assert apercu.lignes[0].ecart_cours is None
    assert not any("cours" in a for a in apercu.avertissements)


def test_une_vente_superieure_a_la_position_est_ecartee(db_session):
    """Une position ne devient pas négative — c'est la règle du noyau. La LIGNE
    est écartée, pas le fichier : le reste du relevé est bon."""
    compte = _compte_titres(db_session)
    preset = _preset(db_session, compte)
    resultat = _confirmer(
        db_session,
        preset,
        _fichier(
            [
                {
                    "date": "12/03/2026",
                    "type": "Achat",
                    "valeur": "Air Liquide",
                    "isin": "FR0000120073",
                    "montant": 500.0,
                    "quantite": 5,
                },
                {
                    "date": "13/03/2026",
                    "type": "Vente",
                    "valeur": "Air Liquide",
                    "isin": "FR0000120073",
                    "montant": 900.0,
                    "quantite": 9,
                },
            ]
        ),
    )
    assert resultat.operations_creees == 1
    assert len(resultat.lignes_ignorees) == 1
    assert "détenus" in resultat.lignes_ignorees[0].erreur


def test_un_type_inconnu_met_la_ligne_en_erreur(db_session):
    """Liste fermée, volontairement : confondre un achat et une vente
    inverserait une position entière."""
    compte = _compte_titres(db_session)
    preset = _preset(db_session, compte)
    apercu = service.previsualiser(
        db_session,
        preset.id,
        _fichier(
            [
                {
                    "date": "12/03/2026",
                    "type": "Dividende",
                    "valeur": "Air Liquide",
                    "montant": 42.0,
                    "quantite": 1,
                }
            ]
        ),
    )
    assert "Dividende" in apercu.lignes[0].erreur


def test_le_vocabulaire_du_preset_remplace_celui_du_code(db_session):
    compte = _compte_titres(db_session)
    preset = _preset(db_session, compte, libelles_type_achat=["BUY ORDER"])
    apercu = service.previsualiser(
        db_session,
        preset.id,
        _fichier(
            [
                {
                    "date": "12/03/2026",
                    "type": "buy order",
                    "valeur": "Air Liquide",
                    "montant": 500.0,
                    "quantite": 5,
                },
                # Le vocabulaire de VENTE n'a pas été redéfini : il retombe sur
                # celui du code, liste par liste et non en bloc.
                {
                    "date": "13/03/2026",
                    "type": "Vente",
                    "valeur": "Air Liquide",
                    "montant": 100.0,
                    "quantite": 1,
                },
            ]
        ),
    )
    assert apercu.lignes[0].type_placement.value == "achat"
    assert apercu.lignes[1].type_placement.value == "vente"


# ---------- Transferts internes ----------


def test_un_transfert_cree_un_virement_a_double_ecriture(db_session):
    compte = _compte_titres(db_session, solde_initial=0.0)
    courant = creer_compte(db_session, "CC Perso", solde_initial=5000.0)
    preset = _preset(db_session, compte)
    contenu = _fichier(
        [{"date": "01/03/2026", "type": "Versement", "montant": 2000.0}]
    )

    overrides = schemas_pl.OverridesPlacements(
        lignes={2: schemas_pl.LignePlacementOverride(compte_id_autre=courant.id)}
    )
    resultat = _confirmer(db_session, preset, contenu, overrides)

    # Deux écritures pour un virement, comme partout ailleurs dans l'app.
    assert resultat.operations_creees == 2
    operations = db_session.query(models.Operation).all()
    assert len({o.virement_id for o in operations}) == 1
    entrante = [o for o in operations if o.sens == Sens.transfert_entrant][0]
    sortante = [o for o in operations if o.sens == Sens.transfert_sortant][0]
    # Montant positif => le compte-titres REÇOIT.
    assert entrante.compte_id == compte.id
    assert sortante.compte_id == courant.id
    assert entrante.montant == pytest.approx(2000.0)


def test_un_montant_negatif_fait_du_compte_titres_lemetteur(db_session):
    compte = _compte_titres(db_session, solde_initial=3000.0)
    courant = creer_compte(db_session, "CC Perso")
    preset = _preset(db_session, compte)
    contenu = _fichier([{"date": "01/03/2026", "type": "Retrait", "montant": -500.0}])

    _confirmer(
        db_session,
        preset,
        contenu,
        schemas_pl.OverridesPlacements(
            lignes={2: schemas_pl.LignePlacementOverride(compte_id_autre=courant.id)}
        ),
    )

    sortante = (
        db_session.query(models.Operation)
        .filter(models.Operation.sens == Sens.transfert_sortant)
        .one()
    )
    assert sortante.compte_id == compte.id


def test_un_transfert_sans_compte_en_face_nest_pas_importe(db_session):
    """Un transfert sans contrepartie créerait de l'argent à partir de rien."""
    compte = _compte_titres(db_session)
    preset = _preset(db_session, compte)
    resultat = _confirmer(
        db_session,
        preset,
        _fichier([{"date": "01/03/2026", "type": "Versement", "montant": 2000.0}]),
    )
    assert resultat.operations_creees == 0
    assert "compte en face" in resultat.lignes_ignorees[0].erreur


def test_un_transfert_se_rapproche_dun_virement_deja_en_base(db_session):
    """LE POINT CENTRAL DE LA DEMANDE. Le même mouvement figure sur le relevé du
    compte-titres et sur celui du compte courant : importé d'un côté, il doit
    être signalé quand on importe l'autre — quelle que soit la provenance du
    premier (saisi à la main, importé d'un relevé bancaire, importé d'ici)."""
    compte = _compte_titres(db_session, solde_initial=0.0)
    courant = creer_compte(db_session, "CC Perso", solde_initial=5000.0)
    # Le virement existe déjà, saisi à la main (donc PAS par cette extension).
    crud.create_virement(
        db_session,
        schemas.VirementCreate(
            date=date(2026, 3, 1),
            compte_source_id=courant.id,
            compte_destination_id=compte.id,
            montant=2000.0,
            monnaie_id=get_monnaie_id(db_session),
        ),
        courant,
        compte,
    )

    preset = _preset(db_session, compte)
    apercu = service.previsualiser(
        db_session,
        preset.id,
        _fichier([{"date": "03/03/2026", "type": "Versement", "montant": 2000.0}]),
    )
    reponse = routeur.doublons_transferts(preset.id, apercu, db=db_session)

    assert len(reponse.resultats) == 1
    suspect = reponse.resultats[0].suspects[0]
    assert suspect.source == "base"
    assert suspect.ecart_jours == 2
    # Le compte d'en face est DÉDUIT du virement retrouvé : c'est ce qui évite
    # de le ressaisir à la main.
    assert suspect.compte_en_face == "CC Perso"


def test_un_achat_nest_jamais_candidat_au_rapprochement_de_virements(db_session):
    compte = _compte_titres(db_session)
    preset = _preset(db_session, compte)
    apercu = service.previsualiser(
        db_session,
        preset.id,
        _fichier(
            [
                {
                    "date": "12/03/2026",
                    "type": "Achat",
                    "valeur": "Air Liquide",
                    "montant": 500.0,
                    "quantite": 5,
                }
            ]
        ),
    )
    assert service.candidats_doublons_virements(apercu.lignes) == []


# ---------- Doublons de lignes ----------


def test_reimporter_le_meme_fichier_signale_chaque_ligne(db_session):
    compte = _compte_titres(db_session)
    preset = _preset(db_session, compte)
    contenu = _fichier(
        [
            {
                "date": "12/03/2026",
                "type": "Achat",
                "valeur": "Air Liquide",
                "isin": "FR0000120073",
                "montant": 500.0,
                "quantite": 5,
            }
        ]
    )
    _confirmer(db_session, preset, contenu)

    apercu = service.previsualiser(db_session, preset.id, contenu)
    ligne = apercu.lignes[0]
    assert ligne.doublon_de is not None
    # La ligne déjà en base est rendue relue, pour être affichée en regard.
    existante = apercu.lignes_existantes[str(ligne.doublon_de)]
    assert existante.montant == pytest.approx(500.0)


def test_un_doublon_reste_importable_si_on_le_laisse_passer(db_session):
    """Deux achats identiques le même jour existent : un doublon détecté peut
    être un faux positif légitime. Il est signalé, jamais écarté d'office."""
    compte = _compte_titres(db_session)
    preset = _preset(db_session, compte)
    contenu = _fichier(
        [
            {
                "date": "12/03/2026",
                "type": "Achat",
                "valeur": "Air Liquide",
                "isin": "FR0000120073",
                "montant": 500.0,
                "quantite": 5,
            }
        ]
    )
    _confirmer(db_session, preset, contenu)
    resultat = _confirmer(db_session, preset, contenu)

    assert resultat.doublons_detectes == 1
    assert resultat.operations_creees == 1
    assert len(_mouvements(db_session)) == 2


def test_supprimer_lopration_rend_le_fichier_reimportable(db_session):
    """Le CASCADE sur `operation_id` retire la ligne du stock anti-doublons :
    sans lui, un relevé resterait « déjà importé » alors qu'il n'en reste rien
    en base."""
    compte = _compte_titres(db_session)
    preset = _preset(db_session, compte)
    contenu = _fichier(
        [
            {
                "date": "12/03/2026",
                "type": "Achat",
                "valeur": "Air Liquide",
                "isin": "FR0000120073",
                "montant": 500.0,
                "quantite": 5,
            }
        ]
    )
    _confirmer(db_session, preset, contenu)
    crud.delete_operation(db_session, _mouvements(db_session)[0].operation)

    apercu = service.previsualiser(db_session, preset.id, contenu)
    assert apercu.lignes[0].doublon_de is None


def test_une_ligne_supprimee_de_lapercu_nentre_pas_au_stock(db_session):
    compte = _compte_titres(db_session)
    preset = _preset(db_session, compte)
    contenu = _fichier(
        [
            {
                "date": "12/03/2026",
                "type": "Achat",
                "valeur": "Air Liquide",
                "montant": 500.0,
                "quantite": 5,
            }
        ]
    )
    _confirmer(
        db_session,
        preset,
        contenu,
        schemas_pl.OverridesPlacements(lignes_supprimees=[2]),
    )
    assert _mouvements(db_session) == []
    assert crud.list_lignes_import_brutes(db_session, preset.id) == []


# ---------- Retouches de l'aperçu ----------


def test_corriger_la_quantite_refait_le_prix_unitaire(db_session):
    compte = _compte_titres(db_session)
    preset = _preset(db_session, compte)
    _confirmer(
        db_session,
        preset,
        _fichier(
            [
                {
                    "date": "12/03/2026",
                    "type": "Achat",
                    "valeur": "Air Liquide",
                    "montant": 1000.0,
                    "quantite": 5,
                }
            ]
        ),
        schemas_pl.OverridesPlacements(
            lignes={2: schemas_pl.LignePlacementOverride(quantite=10)}
        ),
    )
    mouvement = _mouvements(db_session)[0]
    assert mouvement.quantite == 10
    assert mouvement.prix_unitaire == pytest.approx(100.0)


def test_choisir_un_titre_a_la_main_court_circuite_le_rapprochement(db_session):
    """Le courtier écrit un nom que l'app ne connaît pas : plutôt que de créer
    un doublon, l'utilisateur désigne le titre existant."""
    compte = _compte_titres(db_session)
    preset = _preset(db_session, compte)
    existant = crud.create_action(
        db_session, nom="Air Liquide", monnaie_id=get_monnaie_id(db_session)
    )
    _confirmer(
        db_session,
        preset,
        _fichier(
            [
                {
                    "date": "12/03/2026",
                    "type": "Achat",
                    "valeur": "AIR LIQ. NOM.",
                    "montant": 500.0,
                    "quantite": 5,
                }
            ]
        ),
        schemas_pl.OverridesPlacements(
            lignes={2: schemas_pl.LignePlacementOverride(action_id=existant.id)}
        ),
    )
    assert len(crud.get_actions(db_session)) == 1
    assert _mouvements(db_session)[0].action_id == existant.id


# ---------- Annulation ----------


def test_annuler_un_import_defait_mouvements_et_virements(db_session):
    """`crud.delete_operation` sait déjà défaire le versant titres d'un achat et
    les deux jambes d'un virement : l'annulation du noyau marche ici sans une
    ligne de plus."""
    compte = _compte_titres(db_session, solde_initial=5000.0)
    courant = creer_compte(db_session, "CC Perso", solde_initial=5000.0)
    preset = _preset(db_session, compte)
    resultat = _confirmer(
        db_session,
        preset,
        _fichier(
            [
                {
                    "date": "12/03/2026",
                    "type": "Achat",
                    "valeur": "Air Liquide",
                    "montant": 500.0,
                    "quantite": 5,
                },
                {"date": "13/03/2026", "type": "Versement", "montant": 1000.0},
            ]
        ),
        schemas_pl.OverridesPlacements(
            lignes={3: schemas_pl.LignePlacementOverride(compte_id_autre=courant.id)}
        ),
    )
    assert resultat.operations_creees == 3  # 1 achat + 2 jambes de virement

    routeur.annuler_import(preset.id, resultat.historique_id, db=db_session)

    assert db_session.query(models.Operation).all() == []
    assert _mouvements(db_session) == []
    assert crud.list_lignes_import_brutes(db_session, preset.id) == []
    # Le TITRE créé reste : il ne porte plus aucun mouvement, mais l'effacer
    # dépasserait ce qu'annuler un import veut dire (et la page Placements sait
    # l'archiver).
    assert len(crud.get_actions(db_session)) == 1


def test_lhistorique_dun_preset_ne_montre_que_ses_imports(db_session):
    compte = _compte_titres(db_session)
    preset = _preset(db_session, compte)
    autre = _preset(db_session, compte, nom="Autre courtier")
    _confirmer(
        db_session,
        preset,
        _fichier(
            [
                {
                    "date": "12/03/2026",
                    "type": "Achat",
                    "valeur": "Air Liquide",
                    "montant": 500.0,
                    "quantite": 5,
                }
            ]
        ),
    )
    assert len(routeur.get_historique(preset.id, db=db_session)) == 1
    assert routeur.get_historique(autre.id, db=db_session) == []


# ---------- Comptes multi-devises ----------


def test_un_titre_cote_dans_une_monnaie_que_le_compte_ne_porte_pas(db_session):
    """La règle du noyau (un titre ne s'achète que depuis un compte qui porte sa
    monnaie), dite AVANT l'import plutôt qu'après."""
    dollar = crud.create_monnaie(db_session, "Dollar", "$")
    compte = _compte_titres(db_session)
    preset = _preset(db_session, compte)
    crud.create_action(
        db_session,
        nom="Apple",
        monnaie_id=dollar.id,
        code_isin="US0378331005",
    )

    apercu = service.previsualiser(
        db_session,
        preset.id,
        _fichier(
            [
                {
                    "date": "12/03/2026",
                    "type": "Achat",
                    "valeur": "Apple",
                    "isin": "US0378331005",
                    "montant": 500.0,
                    "quantite": 2,
                }
            ]
        ),
    )
    assert "ne porte pas" in apercu.lignes[0].erreur


# ---------- L'aperçu rejoue les retouches ----------


def test_lapercu_rejoue_les_retouches_deja_faites(db_session):
    """Sans cela, l'aperçu mentirait dès la première correction : la ligne à qui
    l'utilisateur vient de désigner son compte en face porterait encore
    « indique le compte en face », et resterait rangée avec les erreurs."""
    compte = _compte_titres(db_session)
    courant = creer_compte(db_session, "CC Perso")
    preset = _preset(db_session, compte)
    contenu = _fichier([{"date": "01/03/2026", "type": "Versement", "montant": 2000.0}])

    avant = service.previsualiser(db_session, preset.id, contenu)
    assert "compte en face" in avant.lignes[0].erreur

    apres = service.previsualiser(
        db_session,
        preset.id,
        contenu,
        overrides=schemas_pl.OverridesPlacements(
            lignes={2: schemas_pl.LignePlacementOverride(compte_id_autre=courant.id)}
        ),
    )
    assert apres.lignes[0].erreur is None
    assert apres.lignes[0].compte_id_autre == courant.id


def test_un_titre_choisi_a_la_main_disparait_des_titres_a_creer(db_session):
    compte = _compte_titres(db_session)
    preset = _preset(db_session, compte)
    existant = crud.create_action(
        db_session, nom="Air Liquide", monnaie_id=get_monnaie_id(db_session)
    )
    contenu = _fichier(
        [
            {
                "date": "12/03/2026",
                "type": "Achat",
                "valeur": "AIR LIQ. NOM.",
                "montant": 500.0,
                "quantite": 5,
            }
        ]
    )
    assert service.previsualiser(db_session, preset.id, contenu).titres_a_creer == [
        "AIR LIQ. NOM."
    ]

    apres = service.previsualiser(
        db_session,
        preset.id,
        contenu,
        overrides=schemas_pl.OverridesPlacements(
            lignes={2: schemas_pl.LignePlacementOverride(action_id=existant.id)}
        ),
    )
    assert apres.titres_a_creer == []
    assert apres.lignes[0].action_nom == "Air Liquide"


def test_corriger_la_quantite_se_voit_dans_lapercu(db_session):
    compte = _compte_titres(db_session)
    preset = _preset(db_session, compte)
    contenu = _fichier(
        [
            {
                "date": "12/03/2026",
                "type": "Achat",
                "valeur": "Air Liquide",
                "montant": 1000.0,
                "quantite": 5,
            }
        ]
    )
    apres = service.previsualiser(
        db_session,
        preset.id,
        contenu,
        overrides=schemas_pl.OverridesPlacements(
            lignes={2: schemas_pl.LignePlacementOverride(quantite=10)}
        ),
    )
    assert apres.lignes[0].prix_unitaire == pytest.approx(100.0)


# ---------- Les mots-clés reconnaissent un MORCEAU de libellé ----------


def test_un_mot_cle_est_contenu_dans_le_libelle(db_session):
    """Beaucoup de courtiers écrivent une phrase par ligne, avec le nom du titre
    dedans : une comparaison exacte ne reconnaissait alors rien, puisqu'il n'y a
    pas deux fois le même libellé dans tout le fichier."""
    compte = _compte_titres(db_session)
    preset = _preset(db_session, compte)

    apercu = service.previsualiser(
        db_session,
        preset.id,
        _fichier(
            [
                {
                    "date": "12/03/2026",
                    "type": "ACHAT COMPTANT ETF MSCI WORLD",
                    "valeur": "Amundi MSCI World",
                    "isin": "LU1681043599",
                    "montant": 500.0,
                    "quantite": 10,
                }
            ]
        ),
    )
    assert apercu.lignes[0].type_placement == "achat"
    assert apercu.lignes[0].erreur is None


def test_le_mot_cle_le_plus_long_gagne(db_session):
    """« VENTE POUR ACHAT DE PARTS » contient un mot-clé de chaque liste : le
    premier trouvé dépendrait de l'ordre du dictionnaire, c'est-à-dire de rien.
    Le plus long est le plus précis."""
    compte = _compte_titres(db_session)
    preset = _preset(
        db_session,
        compte,
        libelles_type_achat=["ACHAT"],
        libelles_type_vente=["VENTE POUR ACHAT"],
    )

    apercu = service.previsualiser(
        db_session,
        preset.id,
        _fichier(
            [
                {
                    "date": "12/03/2026",
                    "type": "VENTE POUR ACHAT DE PARTS",
                    "valeur": "Total",
                    "isin": "FR0000120271",
                    "montant": 500.0,
                    "quantite": 10,
                }
            ]
        ),
    )
    assert apercu.lignes[0].type_placement == "vente"


def test_deux_mots_cles_de_meme_longueur_mettent_la_ligne_en_erreur(db_session):
    """Se tromper ici ne coûte pas un centime de travers, mais une position
    entière à l'envers : à égalité, on refuse de trancher."""
    compte = _compte_titres(db_session)
    preset = _preset(
        db_session,
        compte,
        libelles_type_achat=["ACHA"],
        libelles_type_vente=["VENT"],
    )

    apercu = service.previsualiser(
        db_session,
        preset.id,
        _fichier(
            [
                {
                    "date": "12/03/2026",
                    "type": "ACHAT PUIS VENTE",
                    "valeur": "Total",
                    "isin": "FR0000120271",
                    "montant": 500.0,
                    "quantite": 10,
                }
            ]
        ),
    )
    assert apercu.lignes[0].type_placement is None
    assert "type d'opération inconnu" in apercu.lignes[0].erreur


def test_un_libelle_sans_aucun_mot_cle_reste_en_erreur(db_session):
    compte = _compte_titres(db_session)
    preset = _preset(db_session, compte)

    apercu = service.previsualiser(
        db_session,
        preset.id,
        _fichier(
            [
                {
                    "date": "12/03/2026",
                    "type": "DIVIDENDE",
                    "valeur": "Total",
                    "isin": "FR0000120271",
                    "montant": 500.0,
                    "quantite": 10,
                }
            ]
        ),
    )
    assert apercu.lignes[0].type_placement is None


def test_le_rapprochement_se_limite_au_compte_du_preset(db_session):
    """Un relevé de courtier ne décrit qu'un compte, celui du preset. Sans cette
    borne, deux virements de même montant faits la même semaine entre des
    comptes sans rapport se signaleraient l'un l'autre."""
    compte = _compte_titres(db_session, solde_initial=0.0)
    courant = creer_compte(db_session, "CC Perso", solde_initial=9000.0)
    livret = creer_compte(db_session, "Livret", type_nom="épargne")
    monnaie = get_monnaie_id(db_session)

    # Un virement SANS RAPPORT avec le compte-titres, même montant, même semaine.
    crud.create_virement(
        db_session,
        schemas.VirementCreate(
            date=date(2026, 3, 2),
            compte_source_id=courant.id,
            compte_destination_id=livret.id,
            montant=2000.0,
            monnaie_id=monnaie,
        ),
        courant,
        livret,
    )

    preset = _preset(db_session, compte)
    apercu = service.previsualiser(
        db_session,
        preset.id,
        _fichier([{"date": "03/03/2026", "type": "Versement", "montant": 2000.0}]),
    )
    assert routeur.doublons_transferts(preset.id, apercu, db=db_session).resultats == []


def test_sans_compte_lie_au_preset_on_regarde_tout(db_session):
    """Un preset qui ne nomme aucun compte n'a rien à restreindre : le compte
    se choisit fichier par fichier, et la borne n'existe pas."""
    compte = _compte_titres(db_session, solde_initial=0.0)
    courant = creer_compte(db_session, "CC Perso", solde_initial=9000.0)
    crud.create_virement(
        db_session,
        schemas.VirementCreate(
            date=date(2026, 3, 1),
            compte_source_id=courant.id,
            compte_destination_id=compte.id,
            montant=2000.0,
            monnaie_id=get_monnaie_id(db_session),
        ),
        courant,
        compte,
    )

    preset = _preset(db_session)  # aucun compte lié
    apercu = service.previsualiser(
        db_session,
        preset.id,
        _fichier([{"date": "03/03/2026", "type": "Versement", "montant": 2000.0}]),
        compte_id_defaut=compte.id,
    )
    assert len(routeur.doublons_transferts(preset.id, apercu, db=db_session).resultats) == 1


# ---------- Le nom d'affichage ----------


def test_renommer_un_titre_ne_change_pas_le_nom_du_courtier(db_session):
    """LA PROPRIÉTÉ À NE PAS PERDRE. C'est par `nom` — à défaut d'ISIN — que
    l'import RECONNAÎT un titre d'un fichier à l'autre : l'écraser ferait que
    l'import suivant ne le retrouverait plus, créerait un second titre du même
    ISIN, et scinderait la position en deux."""
    monnaie = get_monnaie_id(db_session)
    titre = crud.create_action(
        db_session,
        "AMUNDI IDX SOL MSC WLD-IE-C",
        monnaie,
        valeur=100.0,
        code_isin="LU1681043599",
    )
    crud.update_action(db_session, titre, nom_affichage="Amundi MSCI World")

    assert titre.nom == "AMUNDI IDX SOL MSC WLD-IE-C"
    assert titre.nom_affiche == "Amundi MSCI World"


def test_un_titre_renomme_reste_reconnu_a_l_import_suivant(db_session):
    """Bout en bout : c'est tout l'intérêt de la seconde colonne."""
    compte = _compte_titres(db_session)
    preset = _preset(db_session, compte)
    monnaie = get_monnaie_id(db_session)
    titre = crud.create_action(
        db_session,
        "AMUNDI IDX SOL MSC WLD-IE-C",
        monnaie,
        valeur=100.0,
        code_isin="LU1681043599",
    )
    crud.update_action(db_session, titre, nom_affichage="Amundi MSCI World")

    apercu = service.previsualiser(
        db_session,
        preset.id,
        _fichier(
            [
                {
                    "date": "12/03/2026",
                    "type": "Achat",
                    "valeur": "AMUNDI IDX SOL MSC WLD-IE-C",
                    "isin": "LU1681043599",
                    "montant": 500.0,
                    "quantite": 5,
                }
            ]
        ),
    )
    (ligne,) = apercu.lignes
    # Rapproché du titre existant : aucun nouveau titre à créer.
    assert ligne.action_id == titre.id
    assert ligne.titre_a_creer is False
    # Et c'est le nom RENOMMÉ qui s'affiche dans l'aperçu.
    assert ligne.action_nom == "Amundi MSCI World"


def test_un_nom_daffichage_vide_rend_son_nom_au_titre(db_session):
    """Le seul moyen de défaire un renommage."""
    monnaie = get_monnaie_id(db_session)
    titre = crud.create_action(db_session, "TOTALENERGIES SE", monnaie, valeur=50.0)
    crud.update_action(db_session, titre, nom_affichage="Total")
    crud.update_action(db_session, titre, nom_affichage="   ")
    assert titre.nom_affichage is None
    assert titre.nom_affiche == "TOTALENERGIES SE"
