"""Notes et amortissement saisis DÈS L'IMPORT, et stock anti-doublons des
règlements liés.

Trois choses ne se lisent dans aucun relevé mais se décident en le classant :
la note qu'on met sur une ligne, l'étalement d'une dépense sur plusieurs mois,
et — pour un règlement lié à la dépense qu'il solde — la trace qui permettra de
le reconnaître au prochain import du même fichier.
"""
import io
from datetime import date

import openpyxl
import pytest

from app import crud, models, schemas
from app.constants import COLONNES_IMPORT_PAR_DEFAUT, Statut
from app.services import import_bancaire, soldes

from .conftest import creer_compte, get_categorie_id, get_monnaie_id, get_type_id


def _construire_fichier(lignes: list[dict]) -> bytes:
    """Même classeur à 12 colonnes que test_import_bancaire, en-tête compris."""
    classeur = openpyxl.Workbook()
    feuille = classeur.active
    feuille.append([f"Colonne {i}" for i in range(1, 13)])
    for ligne in lignes:
        row = [None] * 12
        row[0] = ligne.get("date")
        row[3] = ligne.get("nature")
        row[5] = ligne.get("categorie")
        row[6] = ligne.get("montant")
        row[9] = ligne.get("compte")
        feuille.append(row)
    tampon = io.BytesIO()
    classeur.save(tampon)
    return tampon.getvalue()


def _make_preset(db, nom="Défaut"):
    return crud.create_import_preset(
        db, nom, COLONNES_IMPORT_PAR_DEFAUT, [], lignes_entete=1
    )


def _fichier_une_depense(montant=-1200.0, nature="Assurance annuelle"):
    return _construire_fichier(
        [
            {
                "date": date(2026, 7, 1),
                "nature": nature,
                "categorie": "Alimentation",
                "montant": montant,
                "compte": "CC Perso",
            }
        ]
    )


def _overrides(compte, **retouches):
    return schemas.ImportMappingOverrides(
        comptes={"CC Perso": compte.id},
        lignes={2: schemas.ImportLigneOverride(**retouches)} if retouches else {},
    )


# ---------- Notes ----------


def test_note_saisie_a_l_import_est_portee_par_l_operation(db_session):
    compte = creer_compte(db_session, "CC Perso")
    preset = _make_preset(db_session)

    resultat = import_bancaire.confirmer(
        db_session,
        preset.id,
        _fichier_une_depense(),
        _overrides(compte, notes="facture partagée avec Léa"),
    )

    assert resultat.operations_creees == 1
    assert db_session.query(models.Operation).one().notes == "facture partagée avec Léa"


def test_sans_note_l_operation_importee_n_en_porte_aucune(db_session):
    """Le défaut ne change pas : une ligne non retouchée reste exactement ce
    qu'elle était avant que le champ existe."""
    compte = creer_compte(db_session, "CC Perso")
    preset = _make_preset(db_session)

    import_bancaire.confirmer(
        db_session, preset.id, _fichier_une_depense(), _overrides(compte)
    )

    assert db_session.query(models.Operation).one().notes is None


# ---------- Amortissement ----------


def test_amortissement_saisi_a_l_import_est_applique(db_session):
    compte = creer_compte(db_session, "CC Perso")
    preset = _make_preset(db_session)

    import_bancaire.confirmer(
        db_session,
        preset.id,
        _fichier_une_depense(),
        _overrides(
            compte,
            amorti=True,
            amortissement_debut=date(2026, 7, 1),
            amortissement_fin=date(2027, 6, 1),
        ),
    )

    operation = db_session.query(models.Operation).one()
    assert operation.amorti is True
    assert operation.amortissement_nb_mois == 12
    assert operation.amortissement_montant_par_mois == 100.0
    # La date de l'opération ne bouge pas : l'argent est bien sorti le 1er juillet.
    assert operation.date == date(2026, 7, 1)


def test_amortissement_importe_pese_sur_les_mois_designes(db_session):
    """Le seul contrôle qui compte vraiment : une dépense amortie à l'import
    doit se retrouver dans l'histogramme des mois d'étalement, au prorata, et
    pour rien de plus dans son mois d'origine."""
    compte = creer_compte(db_session, "CC Perso")
    preset = _make_preset(db_session)
    categorie_id = get_categorie_id(db_session, "Alimentaire")

    import_bancaire.confirmer(
        db_session,
        preset.id,
        _fichier_une_depense(),
        schemas.ImportMappingOverrides(
            comptes={"CC Perso": compte.id},
            categories={"Alimentation": categorie_id},
            lignes={
                2: schemas.ImportLigneOverride(
                    amorti=True,
                    amortissement_debut=date(2026, 7, 1),
                    amortissement_fin=date(2027, 6, 1),
                )
            },
        ),
    )

    def total(annee, mois):
        lignes = soldes.get_depenses_par_categorie(
            db_session, annee, mois, get_monnaie_id(db_session)
        )
        return next(l["total_reel"] for l in lignes if l["categorie"] == "Alimentaire")

    assert total(2026, 7) == pytest.approx(100.0)
    assert total(2027, 6) == pytest.approx(100.0)
    assert total(2027, 7) == pytest.approx(0.0)
    # Six mois en 2026 (juillet → décembre), six en 2027.
    assert total(2026, None) == pytest.approx(600.0)
    assert total(2027, None) == pytest.approx(600.0)


def test_bornes_ramenees_au_premier_du_mois(db_session):
    compte = creer_compte(db_session, "CC Perso")
    preset = _make_preset(db_session)

    import_bancaire.confirmer(
        db_session,
        preset.id,
        _fichier_une_depense(),
        _overrides(
            compte,
            amorti=True,
            amortissement_debut=date(2026, 7, 18),
            amortissement_fin=date(2026, 9, 30),
        ),
    )

    operation = db_session.query(models.Operation).one()
    assert operation.amortissement_debut == date(2026, 7, 1)
    assert operation.amortissement_fin == date(2026, 9, 1)
    assert operation.amortissement_nb_mois == 3


def test_amorti_sans_bornes_est_refuse_sans_bloquer_le_fichier(db_session):
    """Une ligne qui dit s'étaler sans dire sur quoi n'est pas importée
    silencieusement sans étalement : l'oubli ne se verrait que des mois plus
    tard, dans l'histogramme."""
    compte = creer_compte(db_session, "CC Perso")
    preset = _make_preset(db_session)

    resultat = import_bancaire.confirmer(
        db_session, preset.id, _fichier_une_depense(), _overrides(compte, amorti=True)
    )

    assert resultat.operations_creees == 0
    assert len(resultat.lignes_ignorees) == 1
    assert "amortissement" in resultat.lignes_ignorees[0].erreur
    assert db_session.query(models.Operation).count() == 0


def test_amortissement_a_l_envers_est_refuse(db_session):
    compte = creer_compte(db_session, "CC Perso")
    preset = _make_preset(db_session)

    resultat = import_bancaire.confirmer(
        db_session,
        preset.id,
        _fichier_une_depense(),
        _overrides(
            compte,
            amorti=True,
            amortissement_debut=date(2026, 9, 1),
            amortissement_fin=date(2026, 7, 1),
        ),
    )

    assert resultat.operations_creees == 0
    assert "dernier mois précède le premier" in resultat.lignes_ignorees[0].erreur


# ---------- Stock anti-doublons d'un règlement lié ----------


def test_enregistrer_ligne_brute_rend_le_reglement_detectable_au_reimport(db_session):
    """LE CAS RAPPORTÉ : un remboursement classé à l'import est créé hors du
    confirm groupé (POST /operations, seul à savoir lier operations_remboursees)
    et n'entrait donc jamais au stock anti-doublons — le même fichier réimporté
    le laissait repasser comme neuf, alors que remboursables, prêts et virements
    étaient bien signalés."""
    compte = creer_compte(db_session, "CC Perso")
    preset = _make_preset(db_session)
    contenu = _fichier_une_depense(montant=250.0, nature="Remboursement Léa")

    # Ce que fait le frontend : l'opération de règlement est créée seule…
    operation = crud.create_operation(
        db_session,
        schemas.OperationCreate(
            date=date(2026, 7, 1),
            compte_id=compte.id,
            monnaie_id=get_monnaie_id(db_session),
            type_id=get_type_id(db_session, "remboursements"),
            nature="Remboursement Léa",
            montant=250.0,
            statut=Statut.reel,
        ),
    )
    # … puis sa ligne de fichier est déclarée au stock.
    assert import_bancaire.enregistrer_ligne_brute(
        db_session, preset.id, contenu, 2, operation.id
    )

    # Réimport du MÊME fichier : la ligne est désormais reconnue.
    apercu = import_bancaire.previsualiser(db_session, preset.id, contenu)
    assert apercu.lignes[0].doublon_de is not None


def test_sans_enregistrement_le_reglement_repasserait_comme_neuf(db_session):
    """Le pendant du test ci-dessus : c'est bien l'enregistrement qui fait la
    différence, pas un autre mécanisme."""
    compte = creer_compte(db_session, "CC Perso")
    preset = _make_preset(db_session)
    contenu = _fichier_une_depense(montant=250.0, nature="Remboursement Léa")

    crud.create_operation(
        db_session,
        schemas.OperationCreate(
            date=date(2026, 7, 1),
            compte_id=compte.id,
            monnaie_id=get_monnaie_id(db_session),
            type_id=get_type_id(db_session, "remboursements"),
            nature="Remboursement Léa",
            montant=250.0,
            statut=Statut.reel,
        ),
    )

    apercu = import_bancaire.previsualiser(db_session, preset.id, contenu)
    assert apercu.lignes[0].doublon_de is None


def test_supprimer_l_operation_libere_la_ligne_du_stock(db_session):
    """Le CASCADE de LigneImportBrute.operation_id vaut aussi pour une ligne
    entrée par cette porte : supprimer l'opération doit rendre le relevé
    réimportable, comme pour n'importe quelle autre."""
    compte = creer_compte(db_session, "CC Perso")
    preset = _make_preset(db_session)
    contenu = _fichier_une_depense(montant=250.0, nature="Remboursement Léa")

    operation = crud.create_operation(
        db_session,
        schemas.OperationCreate(
            date=date(2026, 7, 1),
            compte_id=compte.id,
            monnaie_id=get_monnaie_id(db_session),
            type_id=get_type_id(db_session, "remboursements"),
            nature="Remboursement Léa",
            montant=250.0,
            statut=Statut.reel,
        ),
    )
    import_bancaire.enregistrer_ligne_brute(db_session, preset.id, contenu, 2, operation.id)
    assert db_session.query(models.LigneImportBrute).count() == 1

    crud.delete_operation(db_session, operation)

    assert db_session.query(models.LigneImportBrute).count() == 0
    apercu = import_bancaire.previsualiser(db_session, preset.id, contenu)
    assert apercu.lignes[0].doublon_de is None


def test_enregistrer_une_ligne_absente_du_fichier_ne_stocke_rien(db_session):
    creer_compte(db_session, "CC Perso")
    preset = _make_preset(db_session)
    contenu = _fichier_une_depense()

    assert not import_bancaire.enregistrer_ligne_brute(db_session, preset.id, contenu, 99, 1)
    assert db_session.query(models.LigneImportBrute).count() == 0

# ---------- Un règlement LIÉ passe par la confirmation, comme le reste ----------


def _depense_remboursable(db, compte, montant=250.0, nature="Avance Léa"):
    """Une dépense remboursable déjà en base : la cible que l'aperçu propose."""
    return crud.create_operation(
        db,
        schemas.OperationCreate(
            date=date(2026, 6, 1),
            compte_id=compte.id,
            monnaie_id=get_monnaie_id(db),
            type_id=get_type_id(db, "remboursable"),
            categorie_id=get_categorie_id(db, "Alimentaire"),
            nature=nature,
            montant=montant,
            montant_du=montant,
            statut=Statut.reel,
        ),
    )


def test_un_reglement_lie_est_cree_et_lie_par_la_confirmation(db_session):
    """CE QUI A CHANGÉ, ET POURQUOI. Lier un remboursement à la dépense qu'il
    solde demande `operations_remboursees` : seul POST /operations savait le
    faire, et le frontend créait donc ces lignes-là UNE PAR UNE, aussitôt, hors
    de la confirmation groupée. L'opération existait avant que l'import soit
    confirmé — impossible de se raviser, et un aperçu abandonné laissait
    derrière lui des opérations que personne n'avait validées.

    Les liens voyagent maintenant avec l'override, et `confirmer` les pose
    après avoir créé l'opération : « Confirmer l'import » redevient le seul
    geste qui écrit."""
    compte = creer_compte(db_session, "CC Perso")
    preset = _make_preset(db_session)
    avance = _depense_remboursable(db_session, compte)

    resultat = import_bancaire.confirmer(
        db_session,
        preset.id,
        _fichier_une_depense(montant=250.0, nature="Virement Léa"),
        _overrides(
            compte,
            type_code="remboursements",
            montant=250.0,
            operations_remboursees=[
                schemas.OperationRembourseeInput(operation_id=avance.id, montant=250.0)
            ],
        ),
    )

    assert resultat.operations_creees == 1
    reglement = (
        db_session.query(models.Operation)
        .filter(models.Operation.nature == "Virement Léa")
        .one()
    )
    # Le lien existe, et la dépense qu'il solde ne doit plus rien.
    lies = crud.get_operations_remboursees(db_session, reglement.id)
    assert [o.id for o in lies] == [avance.id]
    db_session.refresh(avance)
    assert avance.montant_a_rembourser == pytest.approx(0.0)


def test_un_reglement_lie_entre_au_stock_anti_doublons_avec_le_reste(db_session):
    """LE BÉNÉFICE COLLATÉRAL, et il compte : en passant par `confirmer`, ces
    lignes-là sont stockées comme toutes les autres. Il fallait jusqu'ici une
    route à part (`enregistrer_ligne_brute`) pour qu'un relevé réimporté les
    reconnaisse, et l'oublier laissait le doublon repasser comme neuf."""
    compte = creer_compte(db_session, "CC Perso")
    preset = _make_preset(db_session)
    avance = _depense_remboursable(db_session, compte)
    contenu = _fichier_une_depense(montant=250.0, nature="Virement Léa")

    import_bancaire.confirmer(
        db_session,
        preset.id,
        contenu,
        _overrides(
            compte,
            type_code="remboursements",
            montant=250.0,
            operations_remboursees=[
                schemas.OperationRembourseeInput(operation_id=avance.id, montant=250.0)
            ],
        ),
    )

    apercu = import_bancaire.previsualiser(db_session, preset.id, contenu)
    assert apercu.lignes[0].doublon_de is not None


def test_un_lien_devenu_impossible_range_la_ligne_parmi_les_ignorees(db_session):
    """ENTRE L'APERÇU ET LA CONFIRMATION, LA CIBLE A PU ÊTRE SOLDÉE AILLEURS.
    La ligne rejoint alors les ignorées avec sa raison, et l'opération qu'on
    venait de créer repart : un règlement qui ne règle rien n'est pas ce qu'on
    a demandé, et le laisser en base aurait fait croire que la liaison a eu
    lieu."""
    compte = creer_compte(db_session, "CC Perso")
    preset = _make_preset(db_session)
    avance = _depense_remboursable(db_session, compte, montant=250.0)

    resultat = import_bancaire.confirmer(
        db_session,
        preset.id,
        _fichier_une_depense(montant=250.0, nature="Virement Léa"),
        _overrides(
            compte,
            type_code="remboursements",
            montant=250.0,
            # Plus que ce que la dépense doit encore : refusé.
            operations_remboursees=[
                schemas.OperationRembourseeInput(operation_id=avance.id, montant=400.0)
            ],
        ),
    )

    assert resultat.operations_creees == 0
    assert len(resultat.lignes_ignorees) == 1
    assert "dépasse" in resultat.lignes_ignorees[0].erreur
    # Rien n'est resté en base : ni le règlement, ni un lien partiel.
    assert (
        db_session.query(models.Operation)
        .filter(models.Operation.nature == "Virement Léa")
        .count()
        == 0
    )
    db_session.refresh(avance)
    assert avance.montant_a_rembourser == pytest.approx(250.0)


def test_un_reglement_sans_lien_reste_une_operation_ordinaire(db_session):
    """Le cas où la dépense réglée fait partie du MÊME fichier : on ne peut pas
    la désigner avant qu'elle existe. La ligne n'est alors pas liée, et l'écran
    la garde hors de la confirmation groupée (cf. app.js, confirmerImport) —
    mais rien n'empêche le service de la créer si elle lui arrive, et elle est
    alors une opération de règlement sans lien, exactement ce qu'elle est."""
    compte = creer_compte(db_session, "CC Perso")
    preset = _make_preset(db_session)

    resultat = import_bancaire.confirmer(
        db_session,
        preset.id,
        _fichier_une_depense(montant=250.0, nature="Virement Léa"),
        _overrides(compte, type_code="remboursements", montant=250.0),
    )

    assert resultat.operations_creees == 1
    reglement = db_session.query(models.Operation).one()
    assert crud.get_operations_remboursees(db_session, reglement.id) == []
