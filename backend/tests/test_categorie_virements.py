"""La catégorie « Virements internes » (migration 0090), équivalente au type « virement ».

CE QUE CES TESTS VERROUILLENT. Une opération porte cette catégorie si et seulement si elle est
un virement interne, partout où une opération s'écrit : formulaire (routers/operations), virements
(les deux jambes), conversions dans les deux sens, règles d'import et leurs sorties, import
lui-même (correspondances, retouches, confirmation avec compte en face). La catégorie se renomme
et ne se supprime ni ne s'éteint ; elle n'a ni barre, ni enveloppe, ni objectif.
"""
import io
from datetime import date

import openpyxl
import pytest
from fastapi import HTTPException

from app import crud, models, schemas
from app.constants import CATEGORIE_VIREMENTS_INTERNES, Sens, Statut, TypeOperation
from app.routers import categories as routeur_categories
from app.routers import operations as routeur_operations
from app.routers import virements as routeur_virements
from app.services import import_bancaire, soldes

from .conftest import (
    charger_module_extension,
    creer_compte,
    get_categorie_id,
    get_monnaie_id,
    get_type_id,
)

routeur_regles = charger_module_extension("regles", "routeur_regles.py")


def _vi(db):
    return crud.get_categorie_virements(db)


def _operation(db, compte, categorie_id, montant=40.0, jour=1, type_code="classique"):
    return routeur_operations.create_operation(
        schemas.OperationCreate(
            date=date(2026, 7, jour),
            compte_id=compte.id,
            monnaie_id=get_monnaie_id(db),
            type_id=get_type_id(db, type_code),
            categorie_id=categorie_id,
            nature="Courses",
            montant=montant,
            statut=Statut.reel,
        ),
        db,
    )


def _virement_payload(db, source, destination, montant=100.0, **champs):
    return schemas.VirementCreate(
        date=date(2026, 7, 3),
        compte_source_id=source.id,
        compte_destination_id=destination.id,
        montant=montant,
        monnaie_id=get_monnaie_id(db),
        **champs,
    )


def _conditions(valeur="LIVRET"):
    return {
        "operateur": "ET",
        "groupes": [
            {
                "operateur": "ET",
                "conditions": [{"champ": "nature", "operateur": "contient", "valeur": valeur}],
            }
        ],
    }


# ---------- La catégorie elle-même ----------


def test_une_seule_categorie_des_virements_reconnue_a_son_drapeau(db_session):
    vi = _vi(db_session)
    assert vi.nom == CATEGORIE_VIREMENTS_INTERNES and vi.est_virement and vi.active
    assert crud.seed_categorie_virements(db_session).id == vi.id
    assert (
        db_session.query(models.Categorie).filter(models.Categorie.est_virement.is_(True)).count()
        == 1
    )


def test_elle_se_renomme_et_reste_la_categorie_des_virements(db_session):
    vi = _vi(db_session)
    renommee = routeur_categories.rename_categorie(
        vi.id, schemas.CategorieUpdate(nom="Transferts entre mes comptes"), db_session
    )
    assert renommee.nom == "Transferts entre mes comptes"
    assert crud.get_categorie_virements(db_session).id == vi.id


@pytest.mark.parametrize(
    "geste",
    [
        lambda db, c: routeur_categories.delete_categorie(c.id, db),
        lambda db, c: routeur_categories.set_etat_categorie(
            c.id, schemas.CategorieEtatUpdate(active=False), db
        ),
        lambda db, c: routeur_categories.set_entree_categorie(
            c.id, schemas.CategorieEntreeUpdate(est_entree=True), db
        ),
        lambda db, c: routeur_categories.set_objectif_categorie(
            c.id, schemas.CategorieObjectifUpdate(objectif_pourcentage=10), db
        ),
        lambda db, c: routeur_categories.set_budget_categorie(
            c.id, 2026, 7, get_monnaie_id(db), schemas.BudgetMensuelSet(montant=50), db
        ),
    ],
    ids=["suppression", "extinction", "entree", "objectif", "enveloppe"],
)
def test_ni_suppression_ni_extinction_ni_enveloppe_ni_objectif(db_session, geste):
    vi = _vi(db_session)
    with pytest.raises(HTTPException) as erreur:
        geste(db_session, vi)
    assert erreur.value.status_code == 409
    assert db_session.get(models.Categorie, vi.id) is not None


def test_pas_de_barre_ni_d_enveloppe_a_la_page_budget(db_session):
    courant = creer_compte(db_session, "CC")
    livret = creer_compte(db_session, "Livret", type_nom="épargne")
    routeur_virements.create_virement(_virement_payload(db_session, courant, livret), db_session)
    barres = soldes.get_depenses_par_categorie(db_session, 2026, 7, get_monnaie_id(db_session))
    assert CATEGORIE_VIREMENTS_INTERNES not in {b["categorie"] for b in barres}
    budgets = routeur_categories.list_budgets_toutes_categories(
        2026, 7, get_monnaie_id(db_session), db_session
    )
    assert _vi(db_session).id not in {b.categorie_id for b in budgets}


def test_une_base_neuve_reste_neuve_avec_la_categorie_des_virements(db_session):
    """Les catégories d'orientation se posent sur une base qui n'a que « Autres » : la catégorie
    des virements, présente partout, ne dit rien de ce que l'utilisateur a composé."""
    for categorie in crud.get_categories(db_session):
        if categorie.nom not in ("Autres",) and not categorie.est_virement:
            db_session.delete(categorie)
    db_session.commit()
    assert "Loisirs" in crud.poser_categories_par_defaut_base_neuve(db_session)


# ---------- Les virements : les deux jambes ----------


def test_les_deux_jambes_d_un_virement_portent_la_categorie(db_session):
    courant = creer_compte(db_session, "CC")
    livret = creer_compte(db_session, "Livret", type_nom="épargne")
    lu = routeur_virements.create_virement(_virement_payload(db_session, courant, livret), db_session)
    vi = _vi(db_session)
    assert lu.operation_sortante.categorie_id == vi.id
    assert lu.operation_entrante.categorie_id == vi.id

    modifie = routeur_virements.update_virement(
        lu.virement_id, _virement_payload(db_session, courant, livret, montant=80.0), db_session
    )
    assert {modifie.operation_sortante.categorie_id, modifie.operation_entrante.categorie_id} == {vi.id}


def test_filtrer_les_operations_sur_la_categorie_donne_les_virements(db_session):
    courant = creer_compte(db_session, "CC")
    livret = creer_compte(db_session, "Livret", type_nom="épargne")
    routeur_virements.create_virement(_virement_payload(db_session, courant, livret), db_session)
    _operation(db_session, courant, get_categorie_id(db_session, "Alimentaire"))
    lues = routeur_operations.list_operations(categorie_id=_vi(db_session).id, db=db_session)
    assert len(lues) == 2 and {o.type_code for o in lues} == {"virement"}


# ---------- Les opérations ordinaires : jamais la catégorie ----------


def test_creer_une_operation_dans_la_categorie_des_virements_est_refuse(db_session):
    courant = creer_compte(db_session, "CC")
    with pytest.raises(HTTPException) as erreur:
        _operation(db_session, courant, _vi(db_session).id)
    assert erreur.value.status_code == 400
    assert db_session.query(models.Operation).count() == 0


def test_poser_la_categorie_sur_une_operation_existante_est_refuse(db_session):
    courant = creer_compte(db_session, "CC")
    operation = _operation(db_session, courant, get_categorie_id(db_session, "Alimentaire"))
    with pytest.raises(HTTPException) as erreur:
        routeur_operations.update_operation(
            operation.id, schemas.OperationUpdate(categorie_id=_vi(db_session).id), db_session
        )
    assert erreur.value.status_code == 400


def test_une_part_de_decoupe_ne_peut_pas_etre_un_virement(db_session):
    courant = creer_compte(db_session, "CC")
    with pytest.raises(HTTPException) as erreur:
        routeur_operations.create_operation(
            schemas.OperationCreate(
                date=date(2026, 7, 1),
                compte_id=courant.id,
                monnaie_id=get_monnaie_id(db_session),
                type_id=get_type_id(db_session, "classique"),
                nature="Courses",
                montant=100.0,
                statut=Statut.reel,
                decoupes=[
                    schemas.DecoupeInput(
                        categorie_id=get_categorie_id(db_session, "Alimentaire"), montant=60.0
                    ),
                    schemas.DecoupeInput(categorie_id=_vi(db_session).id, montant=40.0),
                ],
            ),
            db_session,
        )
    assert erreur.value.status_code == 400


def test_une_autre_categorie_sur_une_jambe_est_refusee(db_session):
    courant = creer_compte(db_session, "CC")
    livret = creer_compte(db_session, "Livret", type_nom="épargne")
    lu = routeur_virements.create_virement(_virement_payload(db_session, courant, livret), db_session)
    with pytest.raises(HTTPException) as erreur:
        routeur_operations.update_operation(
            lu.operation_sortante.id,
            schemas.OperationUpdate(categorie_id=get_categorie_id(db_session, "Alimentaire")),
            db_session,
        )
    assert erreur.value.status_code == 409


# ---------- Changer d'avis : opération → virement, et retour ----------


def test_une_operation_devient_un_virement_sur_place(db_session):
    courant = creer_compte(db_session, "CC")
    livret = creer_compte(db_session, "Livret", type_nom="épargne")
    operation = _operation(db_session, courant, get_categorie_id(db_session, "Alimentaire"))

    lu = routeur_virements.create_virement(
        _virement_payload(db_session, courant, livret, montant=40.0, operation_id=operation.id),
        db_session,
    )

    # La même ligne, devenue la jambe de son compte ; l'autre jambe est neuve.
    assert lu.operation_sortante.id == operation.id
    assert db_session.query(models.Operation).count() == 2
    vi = _vi(db_session)
    for jambe in (lu.operation_sortante, lu.operation_entrante):
        assert jambe.type_code == "virement" and jambe.categorie_id == vi.id
    assert lu.operation_sortante.sens == Sens.transfert_sortant
    assert lu.operation_entrante.compte_id == livret.id


def test_l_operation_du_compte_destination_devient_la_jambe_entrante(db_session):
    courant = creer_compte(db_session, "CC")
    autre = creer_compte(db_session, "Autre")
    operation = _operation(db_session, autre, get_categorie_id(db_session, "Entrées d'argent"))
    lu = routeur_virements.create_virement(
        _virement_payload(db_session, courant, autre, montant=40.0, operation_id=operation.id),
        db_session,
    )
    assert lu.operation_entrante.id == operation.id
    assert lu.operation_entrante.sens == Sens.transfert_entrant


def test_un_virement_redevient_une_operation_sur_place(db_session):
    courant = creer_compte(db_session, "CC")
    livret = creer_compte(db_session, "Livret", type_nom="épargne")
    lu = routeur_virements.create_virement(_virement_payload(db_session, courant, livret), db_session)
    # Le relevé du courant avait importé ce virement : sa ligne suit la jambe gardée.
    preset = crud.create_import_preset(
        db_session, "Banque", [{"index": 1, "propriete": "date"}], [], lignes_entete=0
    )
    crud.create_ligne_import_brute(
        db_session, preset_id=preset.id, donnees={"1": "x"}, operation_id=lu.operation_entrante.id
    )

    nouvelle = routeur_virements.convertir_en_operation(
        lu.virement_id,
        schemas.OperationCreate(
            date=date(2026, 7, 3),
            compte_id=courant.id,
            monnaie_id=get_monnaie_id(db_session),
            type_id=get_type_id(db_session, "classique"),
            categorie_id=get_categorie_id(db_session, "Alimentaire"),
            nature="Finalement des courses",
            montant=100.0,
            statut=Statut.reel,
        ),
        db_session,
    )

    assert nouvelle.id == lu.operation_sortante.id
    assert nouvelle.type_code == "classique" and nouvelle.virement_id is None
    assert nouvelle.categorie_id == get_categorie_id(db_session, "Alimentaire")
    assert nouvelle.sens == Sens.depense
    assert db_session.query(models.Operation).count() == 1
    assert db_session.query(models.LigneImportBrute).one().operation_id == nouvelle.id


def test_la_conversion_inverse_refuse_la_categorie_des_virements(db_session):
    courant = creer_compte(db_session, "CC")
    livret = creer_compte(db_session, "Livret", type_nom="épargne")
    lu = routeur_virements.create_virement(_virement_payload(db_session, courant, livret), db_session)
    with pytest.raises(HTTPException) as erreur:
        routeur_virements.convertir_en_operation(
            lu.virement_id,
            schemas.OperationCreate(
                date=date(2026, 7, 3),
                compte_id=courant.id,
                monnaie_id=get_monnaie_id(db_session),
                type_id=get_type_id(db_session, "classique"),
                categorie_id=_vi(db_session).id,
                nature="x",
                montant=100.0,
                statut=Statut.reel,
            ),
            db_session,
        )
    assert erreur.value.status_code == 400
    assert db_session.query(models.Operation).count() == 2


def test_une_operation_recurrente_ne_devient_pas_un_virement(db_session):
    courant = creer_compte(db_session, "CC")
    livret = creer_compte(db_session, "Livret", type_nom="épargne")
    operation = _operation(db_session, courant, get_categorie_id(db_session, "Alimentaire"))
    operation_en_base = db_session.get(models.Operation, operation.id)
    operation_en_base.recurrente = True
    db_session.commit()
    with pytest.raises(HTTPException) as erreur:
        routeur_virements.create_virement(
            _virement_payload(db_session, courant, livret, operation_id=operation.id), db_session
        )
    assert erreur.value.status_code == 409


# ---------- Les règles d'import ----------


def test_une_regle_dans_la_categorie_des_virements_devient_une_regle_de_virement(db_session):
    lue = routeur_regles.create_regle(
        schemas.RegleCategorisationCreate(
            nom="Livret", conditions=_conditions(), categorie_id=_vi(db_session).id
        ),
        db_session,
    )
    assert lue.type_id == get_type_id(db_session, "virement")
    assert lue.categorie_id == _vi(db_session).id


def test_une_regle_de_virement_porte_la_categorie_des_virements(db_session):
    lue = routeur_regles.create_regle(
        schemas.RegleCategorisationCreate(
            nom="Livret",
            conditions=_conditions(),
            type_id=get_type_id(db_session, "virement"),
            categorie_id=get_categorie_id(db_session, "Alimentaire"),
        ),
        db_session,
    )
    assert lue.categorie_id == _vi(db_session).id


def test_une_regle_ne_decoupe_pas_vers_les_virements(db_session):
    with pytest.raises(HTTPException) as erreur:
        routeur_regles.create_regle(
            schemas.RegleCategorisationCreate(
                nom="Découpe",
                conditions=_conditions(),
                type_id=get_type_id(db_session, "classique"),
                decoupes=[
                    schemas.RegleDecoupeInput(categorie_id=_vi(db_session).id, formule="montant / 2"),
                    schemas.RegleDecoupeInput(
                        categorie_id=get_categorie_id(db_session, "Alimentaire"), formule="reste"
                    ),
                ],
            ),
            db_session,
        )
    assert erreur.value.status_code == 400


def test_une_sortie_dans_la_categorie_des_virements_pose_le_type(db_session):
    lue = routeur_regles.create_regle(
        schemas.RegleCategorisationCreate(
            nom="Épargne",
            conditions=_conditions("VIR"),
            type_id=get_type_id(db_session, "classique"),
            categorie_id=get_categorie_id(db_session, "Alimentaire"),
            sorties=[schemas.SortieRegle(conditions=_conditions("LIVRET"), categorie_id=_vi(db_session).id)],
        ),
        db_session,
    )
    sortie = lue.sorties[0]
    assert sortie["type_code"] == "virement"
    assert sortie["categorie_id"] == _vi(db_session).id


# ---------- L'import ----------


_COLONNES = [
    {"index": 1, "propriete": "date"},
    {"index": 2, "propriete": "nature"},
    {"index": 3, "propriete": "montant"},
    {"index": 4, "propriete": "categorie_banque"},
]


def _fichier(lignes):
    classeur = openpyxl.Workbook()
    feuille = classeur.active
    for ligne in lignes:
        feuille.append(ligne)
    tampon = io.BytesIO()
    classeur.save(tampon)
    return tampon.getvalue()


def _contenu():
    return _fichier(
        [
            [date(2026, 7, 1), "VIR VERS LIVRET", -200.0, "Épargne"],
            [date(2026, 7, 2), "VIR DEPUIS LIVRET", 50.0, "Épargne"],
            [date(2026, 7, 3), "CARREFOUR", -30.0, "Courses"],
        ]
    )


def _preparer_import(db):
    courant = creer_compte(db, "CC")
    livret = creer_compte(db, "Livret", type_nom="épargne")
    preset = crud.create_import_preset(db, "Banque", _COLONNES, [], lignes_entete=0)
    return courant, livret, preset


def test_la_correspondance_vers_les_virements_fait_des_virements_en_attente(db_session):
    courant, _, preset = _preparer_import(db_session)
    crud.set_mapping_categorie(db_session, preset.id, "Épargne", _vi(db_session).id)

    apercu = import_bancaire.previsualiser(
        db_session, preset.id, _contenu(), compte_id_defaut=courant.id
    )

    sortie, entree, courses = apercu.lignes
    for ligne in (sortie, entree):
        assert ligne.type_code == "virement"
        assert ligne.categorie_id == _vi(db_session).id
        assert ligne.virement_par_categorie is True
    assert (sortie.jambe_du_fichier, entree.jambe_du_fichier) == ("sortante", "entrante")
    assert courses.type_code == "classique" and courses.jambe_du_fichier is None
    assert apercu.virements_en_attente == [sortie.ligne, entree.ligne]


def test_la_confirmation_prend_le_compte_en_face_de_chaque_ligne(db_session):
    courant, livret, preset = _preparer_import(db_session)
    alimentaire = get_categorie_id(db_session, "Alimentaire")
    apercu = import_bancaire.previsualiser(
        db_session, preset.id, _contenu(), compte_id_defaut=courant.id
    )
    numeros = [l.ligne for l in apercu.lignes]

    resultat = import_bancaire.confirmer(
        db_session,
        preset.id,
        _contenu(),
        schemas.ImportMappingOverrides(
            categories={"Épargne": _vi(db_session).id, "Courses": alimentaire},
            comptes_en_face={numeros[0]: livret.id, numeros[1]: livret.id},
        ),
        compte_id_defaut=courant.id,
    )

    assert resultat.lignes_ignorees == [] and resultat.operations_creees == 5
    vi = _vi(db_session).id
    jambes = db_session.query(models.Operation).filter(models.Operation.virement_id.isnot(None)).all()
    assert len(jambes) == 4 and {j.categorie_id for j in jambes} == {vi}
    # Le sens de chaque virement suit le signe de la ligne : 200 partent du courant, 50 y arrivent.
    sortantes = {(j.compte_id, j.montant) for j in jambes if j.sens == Sens.transfert_sortant}
    assert sortantes == {(courant.id, 200.0), (livret.id, 50.0)}
    courses = db_session.query(models.Operation).filter(models.Operation.virement_id.is_(None)).one()
    assert courses.categorie_id == alimentaire


def test_sans_compte_en_face_la_ligne_de_virement_n_est_pas_importee(db_session):
    courant, _, preset = _preparer_import(db_session)
    resultat = import_bancaire.confirmer(
        db_session,
        preset.id,
        _contenu(),
        schemas.ImportMappingOverrides(
            categories={"Épargne": _vi(db_session).id, "Courses": get_categorie_id(db_session, "Alimentaire")}
        ),
        compte_id_defaut=courant.id,
    )
    assert len(resultat.lignes_ignorees) == 2
    assert all("compte en face" in l.erreur for l in resultat.lignes_ignorees)
    assert db_session.query(models.Operation).count() == 1


def test_choisir_la_categorie_en_retouchant_une_ligne_en_fait_un_virement(db_session):
    courant, livret, preset = _preparer_import(db_session)
    apercu = import_bancaire.previsualiser(
        db_session, preset.id, _contenu(), compte_id_defaut=courant.id
    )
    courses = apercu.lignes[2]

    retouchee, _, _ = import_bancaire._retoucher_ligne(
        courses,
        schemas.ImportLigneOverride(categorie_id=_vi(db_session).id, compte_id_autre=livret.id),
        _vi(db_session).id,
    )
    assert retouchee.type_code == "virement" and retouchee.categorie_id == _vi(db_session).id
    assert retouchee.jambe_du_fichier == "sortante"
    assert import_bancaire._erreur_ligne(retouchee, _vi(db_session).id) is None

    # Repasser la ligne en classique lui retire la catégorie : elle est à reclasser.
    reclassee, _, _ = import_bancaire._retoucher_ligne(
        retouchee, schemas.ImportLigneOverride(type_code="classique"), _vi(db_session).id
    )
    assert reclassee.type_code == "classique" and reclassee.categorie_id is None
    assert "catégorie non résolue" in import_bancaire._erreur_ligne(reclassee, _vi(db_session).id)


def test_une_regle_de_virement_classe_la_ligne_dans_la_categorie(db_session):
    courant, livret, preset = _preparer_import(db_session)
    routeur_regles.create_regle(
        schemas.RegleCategorisationCreate(
            nom="Livret",
            conditions=_conditions("LIVRET"),
            categorie_id=_vi(db_session).id,
            compte_autre_id=livret.id,
        ),
        db_session,
    )
    apercu = import_bancaire.previsualiser(
        db_session, preset.id, _contenu(), compte_id_defaut=courant.id
    )
    sortie, entree, _ = apercu.lignes
    for ligne in (sortie, entree):
        assert ligne.type_code == "virement" and ligne.categorie_id == _vi(db_session).id
        assert ligne.compte_id_autre == livret.id
        # C'est la règle qui en a fait un virement, pas la catégorie.
        assert ligne.virement_par_categorie is False
    assert apercu.virements_en_attente == []
