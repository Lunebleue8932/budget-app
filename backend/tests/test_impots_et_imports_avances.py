"""« À déclarer » (extension Impôts) et « Imports Avancés » (règles limitées à des formats,
conditions sur n'importe quelle colonne, fusion avec la détection des ressemblances).

CE QUE CES TESTS VERROUILLENT, par ordre d'importance :

  - L'ÉTIQUETTE NE VAUT QUE SUR UNE ENTRÉE DE TYPE CLASSIQUE, et c'est le SERVEUR qui le
    garantit — à la création, à la modification (une catégorie qui quitte « entrée » fait
    retomber la case), à l'import et au rapprochement. Un formulaire qui enverrait n'importe
    quoi ne doit jamais écrire une étiquette hors périmètre.
  - UNE RÈGLE LIMITÉE À DES FORMATS ne s'applique qu'à eux ; supprimer un format l'oublie, et
    une règle dont c'était le seul format redevient une règle de TOUS (jamais une règle
    dormante).
  - « LIGNE ENTIÈRE » ET « COLONNE N » lisent la ligne brute du fichier, pas les propriétés
    que le format a rattachées.
  - LA FUSION : l'ancien identifiant « ressemblances » ne se charge plus, et la détection
    dépend désormais de « regles ».
"""
import io
from datetime import date

import openpyxl
import pytest
from fastapi import HTTPException
from pydantic import ValidationError

from app import crud, models, schemas
from app.constants import COLONNES_IMPORT_PAR_DEFAUT, Frequence, Sens, Statut
from app.services import import_bancaire, regles_categorisation

from .conftest import (
    charger_module_extension,
    creer_compte,
    creer_monnaie,
    get_categorie_id,
    get_monnaie_id,
    get_type_id,
)

routeur_regles = charger_module_extension("regles", "routeur_regles.py")
service_impots = charger_module_extension("impots", "service_impots.py")
routeur_impots = charger_module_extension("impots", "routeur_impots.py")
schemas_impots = charger_module_extension("impots", "schemas_impots.py")

AUJOURDHUI = date(2026, 10, 9)


# ---------- Outils ----------


def _entree(db, compte, montant=1000.0, jour=date(2026, 3, 5), *, a_declarer=False,
            statut=Statut.reel, monnaie_id=None, nature="Salaire", type_code="classique",
            categorie="Entrées d'argent"):
    return crud.create_operation(
        db,
        schemas.OperationCreate(
            date=jour,
            compte_id=compte.id,
            monnaie_id=monnaie_id or get_monnaie_id(db),
            type_id=get_type_id(db, type_code),
            categorie_id=get_categorie_id(db, categorie) if type_code == "classique" else None,
            nature=nature,
            montant=montant,
            statut=statut,
            a_declarer=a_declarer,
        ),
    )


@pytest.fixture()
def compte(db_session):
    return creer_compte(db_session, "Courant", solde_initial=0.0)


# ---------- L'éligibilité, jugée par le serveur ----------


def test_une_entree_classique_peut_etre_a_declarer(db_session, compte):
    op = _entree(db_session, compte, a_declarer=True)
    assert op.sens == Sens.entree
    assert op.a_declarer is True


def test_une_depense_ne_porte_jamais_l_etiquette(db_session, compte):
    op = _entree(db_session, compte, a_declarer=True, categorie="Alimentaire", nature="Courses")
    assert op.sens == Sens.depense
    assert op.a_declarer is False


def test_un_pret_recu_n_est_pas_un_revenu(db_session, compte):
    """Un prêt reçu fait entrer de l'argent, sans que ce soit un revenu."""
    op = crud.create_operation(
        db_session,
        schemas.OperationCreate(
            date=date(2026, 3, 5),
            compte_id=compte.id,
            monnaie_id=get_monnaie_id(db_session),
            type_id=get_type_id(db_session, "pret"),
            nature="Prêt de Marie",
            montant=500.0,
            montant_du=500.0,
            statut=Statut.reel,
            a_declarer=True,
        ),
    )
    assert op.sens == Sens.entree
    assert op.a_declarer is False


def test_l_etiquette_retombe_quand_la_categorie_quitte_les_entrees(db_session, compte):
    op = _entree(db_session, compte, a_declarer=True)
    assert op.a_declarer is True

    crud.update_operation(
        db_session,
        op,
        schemas.OperationUpdate(
            categorie_id=get_categorie_id(db_session, "Alimentaire"), a_declarer=True
        ),
    )

    assert op.sens == Sens.depense
    assert op.a_declarer is False


def test_le_selecteur_n_etiquette_que_les_entrees_classiques(db_session, compte):
    """Le sélecteur de l'écran pose l'étiquette PAR LOT : une ligne hors périmètre est
    écartée et comptée, le reste du lot passe."""
    salaire = _entree(db_session, compte)
    courses = _entree(db_session, compte, categorie="Alimentaire", nature="Courses")
    deja = _entree(db_session, compte, a_declarer=True, nature="Loyer perçu")

    resultat = routeur_impots.poser(
        schemas.SousFiltreOperations(operation_ids=[salaire.id, courses.id, deja.id]),
        db_session,
    )

    assert resultat == {"ajoutees": 1, "ignorees": 1}
    assert salaire.a_declarer is True
    assert courses.a_declarer is False
    assert deja.a_declarer is True


def test_l_etiquette_se_retire_en_la_decochant(db_session, compte):
    op = _entree(db_session, compte, a_declarer=True)
    crud.update_operation(db_session, op, schemas.OperationUpdate(a_declarer=False))
    assert op.a_declarer is False


def test_les_occurrences_d_un_revenu_recurrent_heritent_de_l_etiquette(db_session, compte):
    crud.create_operation(
        db_session,
        schemas.OperationCreate(
            date=date(2026, 7, 5),
            compte_id=compte.id,
            monnaie_id=get_monnaie_id(db_session),
            type_id=get_type_id(db_session, "classique"),
            categorie_id=get_categorie_id(db_session, "Entrées d'argent"),
            nature="Loyer perçu",
            montant=700.0,
            statut=Statut.previsionnel,
            a_declarer=True,
            recurrente=True,
            frequence=Frequence.mensuelle,
            recurrence_fin=date(2026, 10, 31),
        ),
    )
    crud.generer_occurrences_recurrentes(db_session)

    occurrences = db_session.query(models.Operation).all()
    assert len(occurrences) >= 3
    assert all(o.a_declarer for o in occurrences)


# ---------- L'import ----------


def _fichier(lignes):
    """Colonnes : 1 date, 4 nature, 6 catégorie, 7 montant, 10 compte — et deux colonnes que le
    format par défaut ne lit PAS : la 11 (« libre ») et la 12 (« reference »)."""
    classeur = openpyxl.Workbook()
    feuille = classeur.active
    for ligne in lignes:
        row = [None] * 12
        row[0] = ligne.get("date")
        row[3] = ligne.get("nature")
        row[5] = ligne.get("categorie")
        row[6] = ligne.get("montant")
        row[9] = ligne.get("compte")
        row[10] = ligne.get("libre")
        row[11] = ligne.get("reference")
        feuille.append(row)
    tampon = io.BytesIO()
    classeur.save(tampon)
    return tampon.getvalue()


def _conditions(*conditions):
    return {"operateur": "ET", "groupes": [{"operateur": "ET", "conditions": list(conditions)}]}


def _condition(champ, operateur, valeur):
    return {"champ": champ, "operateur": operateur, "valeur": valeur}


def _regle(db, nom, conditions, **kwargs):
    kwargs.setdefault("type_id", get_type_id(db, "classique"))
    return crud.create_regle_categorisation(db, nom=nom, conditions=conditions, **kwargs)


def _overrides(db, compte):
    return schemas.ImportMappingOverrides(
        categories={"Revenus": get_categorie_id(db, "Entrées d'argent")},
        comptes={"CC Perso": compte.id},
    )


def _import_entree(db, preset, compte, **lignes):
    contenu = _fichier(
        [
            {
                "date": date(2026, 7, 1),
                "nature": "Salaire juillet",
                "categorie": "Revenus",
                "montant": 2000.0,
                "compte": "CC Perso",
                **lignes,
            }
        ]
    )
    overrides = _overrides(db, compte)
    return contenu, overrides


def test_une_regle_pose_l_etiquette_a_l_import(db_session):
    compte = creer_compte(db_session, "CC Perso")
    preset = crud.create_import_preset(db_session, "Défaut", COLONNES_IMPORT_PAR_DEFAUT)
    _regle(
        db_session,
        "Salaire",
        _conditions(_condition("nature", "contient", "salaire")),
        a_declarer=True,
    )
    contenu, overrides = _import_entree(db_session, preset, compte)

    apercu = import_bancaire.previsualiser(db_session, preset.id, contenu)
    assert apercu.lignes[0].a_declarer is True

    import_bancaire.confirmer(db_session, preset.id, contenu, overrides)
    assert db_session.query(models.Operation).one().a_declarer is True


def test_l_apercu_peut_retirer_ce_qu_une_regle_a_pose(db_session):
    compte = creer_compte(db_session, "CC Perso")
    preset = crud.create_import_preset(db_session, "Défaut", COLONNES_IMPORT_PAR_DEFAUT)
    _regle(
        db_session,
        "Salaire",
        _conditions(_condition("nature", "contient", "salaire")),
        a_declarer=True,
    )
    contenu, overrides = _import_entree(db_session, preset, compte)
    overrides.lignes = {1: schemas.ImportLigneOverride(a_declarer=False)}

    import_bancaire.confirmer(db_session, preset.id, contenu, overrides)

    assert db_session.query(models.Operation).one().a_declarer is False


def test_l_apercu_peut_poser_l_etiquette_sans_regle(db_session):
    compte = creer_compte(db_session, "CC Perso")
    preset = crud.create_import_preset(db_session, "Défaut", COLONNES_IMPORT_PAR_DEFAUT)
    contenu, overrides = _import_entree(db_session, preset, compte)
    overrides.lignes = {1: schemas.ImportLigneOverride(a_declarer=True)}

    import_bancaire.confirmer(db_session, preset.id, contenu, overrides)

    assert db_session.query(models.Operation).one().a_declarer is True


def test_une_regle_ne_pose_pas_l_etiquette_sur_une_depense_importee(db_session):
    """La règle vise un libellé, pas un sens : sur une sortie, le serveur écarte l'étiquette."""
    compte = creer_compte(db_session, "CC Perso")
    preset = crud.create_import_preset(db_session, "Défaut", COLONNES_IMPORT_PAR_DEFAUT)
    _regle(
        db_session,
        "Tout",
        _conditions(_condition("nature", "contient", "courses")),
        a_declarer=True,
    )
    contenu = _fichier(
        [{"date": date(2026, 7, 1), "nature": "Courses", "categorie": "Alimentation",
          "montant": -40.0, "compte": "CC Perso"}]
    )
    overrides = schemas.ImportMappingOverrides(
        categories={"Alimentation": get_categorie_id(db_session, "Alimentaire")},
        comptes={"CC Perso": compte.id},
    )

    import_bancaire.confirmer(db_session, preset.id, contenu, overrides)

    operation = db_session.query(models.Operation).one()
    assert operation.sens == Sens.depense
    assert operation.a_declarer is False


# ---------- Une règle limitée à certains formats ----------


def test_une_regle_limitee_a_un_format_ne_mord_que_sur_lui(db_session):
    creer_compte(db_session, "CC Perso")
    banque_a = crud.create_import_preset(db_session, "Banque A", COLONNES_IMPORT_PAR_DEFAUT)
    banque_b = crud.create_import_preset(db_session, "Banque B", COLONNES_IMPORT_PAR_DEFAUT)
    _regle(
        db_session,
        "Prêts A",
        _conditions(_condition("nature", "contient", "PRET")),
        type_id=get_type_id(db_session, "pret"),
        presets=[banque_a.id],
    )
    _regle(
        db_session,
        "Prêts partout",
        _conditions(_condition("nature", "contient", "AVANCE")),
        type_id=get_type_id(db_session, "pret"),
    )
    contenu = _fichier(
        [
            {"date": date(2026, 7, 1), "nature": "PRET Marie", "montant": 100.0, "compte": "CC Perso"},
            {"date": date(2026, 7, 2), "nature": "AVANCE Paul", "montant": 50.0, "compte": "CC Perso"},
        ]
    )

    chez_a = import_bancaire.previsualiser(db_session, banque_a.id, contenu).lignes
    chez_b = import_bancaire.previsualiser(db_session, banque_b.id, contenu).lignes

    assert [l.regle_appliquee for l in chez_a] == ["Prêts A", "Prêts partout"]
    # La règle limitée à la banque A ne s'applique pas chez B ; celle sans limite, si.
    assert [l.regle_appliquee for l in chez_b] == [None, "Prêts partout"]


def test_supprimer_un_format_l_oublie_dans_les_regles(db_session):
    a = crud.create_import_preset(db_session, "A", COLONNES_IMPORT_PAR_DEFAUT)
    b = crud.create_import_preset(db_session, "B", COLONNES_IMPORT_PAR_DEFAUT)
    deux = _regle(db_session, "Deux", _conditions(_condition("nature", "contient", "x")),
                  presets=[a.id, b.id])
    seul = _regle(db_session, "Seul", _conditions(_condition("nature", "contient", "y")),
                  presets=[a.id])
    tous = _regle(db_session, "Tous", _conditions(_condition("nature", "contient", "z")))

    crud.delete_import_preset(db_session, a)
    for regle in (deux, seul, tous):
        db_session.refresh(regle)

    assert deux.presets == [b.id]
    # Son seul format a disparu : la règle redevient une règle de TOUS, pas une règle dormante.
    assert seul.presets is None
    assert tous.presets is None


def test_le_routeur_refuse_une_liste_de_formats_vide(db_session):
    payload = schemas.RegleCategorisationCreate(
        nom="R",
        conditions=schemas.ConditionsRegle(
            **_conditions(_condition("nature", "contient", "x"))
        ),
        type_id=get_type_id(db_session, "classique"),
        presets=[],
    )
    with pytest.raises(HTTPException) as erreur:
        routeur_regles.create_regle(payload, db=db_session)
    assert erreur.value.status_code == 400


def test_le_routeur_refuse_un_format_inconnu(db_session):
    payload = schemas.RegleCategorisationCreate(
        nom="R",
        conditions=schemas.ConditionsRegle(
            **_conditions(_condition("nature", "contient", "x"))
        ),
        type_id=get_type_id(db_session, "classique"),
        presets=[9999],
    )
    with pytest.raises(HTTPException) as erreur:
        routeur_regles.create_regle(payload, db=db_session)
    assert erreur.value.status_code == 404


def test_le_routeur_enregistre_les_formats_sans_doublon(db_session):
    a = crud.create_import_preset(db_session, "A", COLONNES_IMPORT_PAR_DEFAUT)
    payload = schemas.RegleCategorisationCreate(
        nom="R",
        conditions=schemas.ConditionsRegle(
            **_conditions(_condition("nature", "contient", "x"))
        ),
        type_id=get_type_id(db_session, "classique"),
        presets=[a.id, a.id],
        a_declarer=True,
    )
    regle = routeur_regles.create_regle(payload, db=db_session)
    assert regle.presets == [a.id]
    assert regle.a_declarer is True


# ---------- Les conditions sur n'importe quelle colonne ----------


def test_ligne_entiere_cherche_dans_toutes_les_colonnes():
    brute = {"nature": "VIR", "donnees_completes": {"1": "2026-07-01", "4": "VIR", "11": "ZZUNIQUE"}}
    assert regles_categorisation.evaluer_regle(
        _conditions(_condition("ligne_entiere", "contient", "zzunique")), brute
    )
    assert not regles_categorisation.evaluer_regle(
        _conditions(_condition("ligne_entiere", "contient", "absent")), brute
    )


def test_les_colonnes_se_trient_comme_des_nombres():
    """« 10 » vient après « 9 » : la ligne entière se lit dans l'ordre du tableur."""
    brute = {"donnees_completes": {"10": "dix", "9": "neuf", "2": "deux"}}
    assert regles_categorisation.valeur_du_champ(brute, "ligne_entiere") == "deux neuf dix"


# ---------- Les colonnes dummy (migration 0079) ----------


def test_une_colonne_dummy_lit_la_cellule_que_son_format_lui_rattache():
    brute = {"nature": "VIR", "colonnes_dummy": {5: "REF-ABC"}}
    assert regles_categorisation.evaluer_regle(
        _conditions(_condition("dummy_5", "contient", "abc")), brute
    )
    assert not regles_categorisation.evaluer_regle(
        _conditions(_condition("dummy_5", "contient", "xyz")), brute
    )


def test_une_colonne_dummy_que_le_format_ne_lit_pas_ne_correspond_a_rien_meme_en_negatif():
    brute = {"nature": "VIR", "colonnes_dummy": {}}
    assert not regles_categorisation.evaluer_regle(
        _conditions(_condition("dummy_5", "ne contient pas", "abc")), brute
    )
    # Une cellule VIDE d'une colonne lue, elle, reste une valeur : « ne contient pas » y est vrai.
    assert regles_categorisation.evaluer_regle(
        _conditions(_condition("dummy_5", "ne contient pas", "abc")),
        {"nature": "VIR", "colonnes_dummy": {5: None}},
    )


def test_sans_la_colonne_un_ou_s_execute_sur_le_reste_et_un_et_ne_s_execute_pas():
    brute = {"nature": "VIR LOYER", "colonnes_dummy": {}}
    en_ou = {
        "operateur": "ET",
        "groupes": [
            {
                "operateur": "OU",
                "conditions": [
                    _condition("dummy_5", "contient", "LOYER"),
                    _condition("nature", "contient", "LOYER"),
                ],
            }
        ],
    }
    en_et = {**en_ou, "groupes": [{**en_ou["groupes"][0], "operateur": "ET"}]}
    assert regles_categorisation.evaluer_regle(en_ou, brute)
    assert not regles_categorisation.evaluer_regle(en_et, brute)


@pytest.mark.parametrize("champ", ["dummy_0", "dummy_a", "dummy_", "colonne_3", "autre"])
def test_un_champ_de_colonne_mal_forme_est_refuse(champ):
    with pytest.raises(ValidationError):
        schemas.RegleCategorisationCreate(
            nom="R",
            conditions=schemas.ConditionsRegle(**_conditions(_condition(champ, "contient", "x"))),
        )


def test_une_colonne_dummy_se_compare_comme_du_texte_jamais_comme_un_nombre():
    with pytest.raises(ValidationError):
        schemas.RegleCategorisationCreate(
            nom="R",
            conditions=schemas.ConditionsRegle(
                **_conditions(_condition("dummy_3", "supérieur à", "5"))
            ),
        )


def _preset_avec_dummy(db, nom, index, dummy_id=None, dummy_nom="Référence"):
    preset = crud.create_import_preset(db, nom, COLONNES_IMPORT_PAR_DEFAUT)
    entree = {"colonne_dummy_id": dummy_id, "nom": None if dummy_id else dummy_nom, "index": index}
    return crud.remplacer_colonnes_dummy(db, preset, [entree])


def test_une_regle_sur_une_colonne_dummy_sert_deux_formats_qui_la_rangent_ailleurs(db_session):
    creer_compte(db_session, "CC Perso")
    a = _preset_avec_dummy(db_session, "A", 12)
    dummy_id = a.lectures_dummy[0].colonne_dummy_id
    b = _preset_avec_dummy(db_session, "B", 11, dummy_id=dummy_id)
    sans = crud.create_import_preset(db_session, "Sans", COLONNES_IMPORT_PAR_DEFAUT)
    _regle(
        db_session,
        "Par la référence",
        _conditions(_condition(f"dummy_{dummy_id}", "contient", "LOYER")),
        type_id=get_type_id(db_session, "pret"),
    )
    _regle(
        db_session,
        "Par la ligne",
        _conditions(_condition("ligne_entiere", "contient", "caution")),
        type_id=get_type_id(db_session, "remboursable"),
    )
    contenu = _fichier(
        [
            {"date": date(2026, 7, 1), "nature": "Virement", "montant": 100.0,
             "compte": "CC Perso", "reference": "LOYER-07"},
            {"date": date(2026, 7, 2), "nature": "Virement", "montant": 100.0,
             "compte": "CC Perso", "libre": "LOYER-08"},
            {"date": date(2026, 7, 3), "nature": "Virement", "montant": -100.0,
             "compte": "CC Perso", "libre": "Dépôt de caution"},
        ]
    )

    def appliquees(preset):
        return [
            ligne.regle_appliquee
            for ligne in import_bancaire.previsualiser(db_session, preset.id, contenu).lignes
        ]

    # A lit la référence en 12, B en 11 : la même règle reconnaît la ligne de chacun.
    assert appliquees(a) == ["Par la référence", None, "Par la ligne"]
    assert appliquees(b) == [None, "Par la référence", "Par la ligne"]
    # Un format qui ne lit pas la colonne : la règle ne s'y exécute pas.
    assert appliquees(sans) == [None, None, "Par la ligne"]


def test_un_meme_nom_designe_la_meme_colonne_dummy(db_session):
    a = _preset_avec_dummy(db_session, "A", 12, dummy_nom="Référence")
    b = _preset_avec_dummy(db_session, "B", 3, dummy_nom="  référence ")
    assert a.lectures_dummy[0].colonne_dummy_id == b.lectures_dummy[0].colonne_dummy_id
    assert len(crud.list_colonnes_dummy(db_session)) == 1


def test_une_colonne_dummy_vit_tant_qu_un_format_la_lit_ou_qu_une_regle_la_cite(db_session):
    a = _preset_avec_dummy(db_session, "A", 12)
    dummy_id = a.lectures_dummy[0].colonne_dummy_id
    regle = _regle(
        db_session, "R", _conditions(_condition(f"dummy_{dummy_id}", "contient", "x"))
    )
    crud.remplacer_colonnes_dummy(db_session, a, [])
    # Plus aucun format ne la lit, mais la règle la cite : elle reste.
    assert crud.get_colonne_dummy(db_session, dummy_id) is not None
    crud.delete_regle_categorisation(db_session, regle)
    assert crud.get_colonne_dummy(db_session, dummy_id) is None


def test_supprimer_un_format_retire_ses_colonnes_dummy(db_session):
    crud.create_import_preset(db_session, "Autre", COLONNES_IMPORT_PAR_DEFAUT)
    a = _preset_avec_dummy(db_session, "A", 12)
    dummy_id = a.lectures_dummy[0].colonne_dummy_id
    crud.delete_import_preset(db_session, a)
    assert crud.get_colonne_dummy(db_session, dummy_id) is None


def test_la_route_des_presets_valide_et_liste_les_colonnes_dummy(db_session):
    from app.routers import import_bancaire as routeur_import

    preset = crud.create_import_preset(db_session, "A", COLONNES_IMPORT_PAR_DEFAUT)

    def payload(colonnes_dummy):
        return schemas.ImportPresetUpdate(
            nom="A",
            colonnes=[schemas.ColonneImportConfig(**c) for c in COLONNES_IMPORT_PAR_DEFAUT],
            colonnes_dummy=colonnes_dummy,
        )

    def refus(colonnes_dummy):
        with pytest.raises(HTTPException) as erreur:
            routeur_import.update_preset(preset.id, payload(colonnes_dummy), db=db_session)
        return erreur.value.status_code

    # Sans nom, une colonne neuve est refusée ; la même colonne deux fois aussi.
    assert refus([schemas.ColonneDummyConfig(nom=" ", index=3)]) == 400
    assert refus(
        [
            schemas.ColonneDummyConfig(nom="Réf", index=3),
            schemas.ColonneDummyConfig(nom="réf", index=4),
        ]
    ) == 400
    assert refus([schemas.ColonneDummyConfig(colonne_dummy_id=999, index=3)]) == 404

    # Une colonne dummy peut partager le numéro d'une propriété (ici la nature, en 4).
    lu = routeur_import.update_preset(
        preset.id, payload([schemas.ColonneDummyConfig(nom="Réf", index=4)]), db=db_session
    )
    assert [(c["nom"], c["index"]) for c in lu.colonnes_dummy] == [("Réf", 4)]
    # None = ne pas y toucher.
    lu = routeur_import.update_preset(preset.id, payload(None), db=db_session)
    assert len(lu.colonnes_dummy) == 1

    listees = routeur_import.list_colonnes_dummy(db=db_session)
    assert [(c.nom, [(f.nom, f.index) for f in c.formats]) for c in listees] == [
        ("Réf", [("A", 4)])
    ]


def test_une_regle_ne_peut_citer_qu_une_colonne_dummy_existante(db_session):
    payload = schemas.RegleCategorisationCreate(
        nom="R",
        conditions=schemas.ConditionsRegle(
            **_conditions(_condition("dummy_999", "contient", "x"))
        ),
        type_id=get_type_id(db_session, "classique"),
    )
    with pytest.raises(HTTPException) as erreur:
        routeur_regles.create_regle(payload, db=db_session)
    assert erreur.value.status_code == 404


# ---------- La fusion « Imports Avancés » ----------


def test_l_ancienne_extension_ressemblances_est_ignoree(tmp_path, monkeypatch):
    from app import extensions

    dossiers = tmp_path / "extensions"
    for nom in ("ressemblances", "autre"):
        (dossiers / nom).mkdir(parents=True)
        (dossiers / nom / "extension.json").write_text('{"nom": "X"}', encoding="utf-8")
    monkeypatch.setattr(extensions, "_racine_projet", lambda: tmp_path)
    monkeypatch.setattr(extensions, "DOSSIERS", [("extensions", "standard")])

    trouvees = extensions.decouvrir()

    assert "autre" in trouvees
    assert "ressemblances" not in trouvees


def test_la_detection_des_ressemblances_depend_de_regles(monkeypatch):
    from app import extensions

    assert import_bancaire.EXTENSION_RESSEMBLANCES == "regles"
    monkeypatch.setattr(extensions, "est_active", lambda extension_id: extension_id == "regles")
    assert import_bancaire._ressemblances_actives() is True
    monkeypatch.setattr(extensions, "est_active", lambda extension_id: extension_id != "regles")
    assert import_bancaire._ressemblances_actives() is False


@pytest.mark.extensions_reelles
def test_les_extensions_livrees_sont_regles_et_impots_mais_plus_ressemblances():
    from app import extensions

    trouvees = extensions.decouvrir()
    assert "regles" in trouvees and "impots" in trouvees
    assert "ressemblances" not in trouvees
    assert trouvees["regles"].manifeste["nom"] == "Imports Avancés"


# ---------- L'extension Impôts ----------


def test_les_entrees_a_declarer_se_totalisent_par_annee_et_par_monnaie(db_session, compte):
    dollar = creer_monnaie(db_session, "Dollar", "$")
    compte_usd = creer_compte(db_session, "USD", monnaies=[(get_monnaie_id(db_session), 0.0), (dollar.id, 0.0)])
    _entree(db_session, compte, 1000.0, date(2026, 3, 5), a_declarer=True)
    _entree(db_session, compte, 500.0, date(2026, 6, 1), a_declarer=True)
    _entree(db_session, compte, 300.0, date(2026, 12, 1), a_declarer=True, statut=Statut.previsionnel)
    _entree(db_session, compte_usd, 200.0, date(2026, 4, 1), a_declarer=True, monnaie_id=dollar.id)
    _entree(db_session, compte, 999.0, date(2026, 5, 5))  # non étiquetée
    _entree(db_session, compte, 800.0, date(2025, 5, 5), a_declarer=True)  # autre année

    vue = service_impots.vue(db_session, 2026, AUJOURDHUI)

    par_nom = {m["monnaie_nom"]: m for m in vue["monnaies"]}
    euro = par_nom[crud.get_monnaie(db_session, get_monnaie_id(db_session)).nom]
    assert euro["total_reel"] == 1500.0
    assert euro["total_prevu"] == 300.0
    assert euro["nombre"] == 3
    assert par_nom["Dollar"]["total_reel"] == 200.0
    assert len(vue["operations"]) == 4
    # Du plus ancien au plus récent : l'ordre de lecture d'une déclaration.
    assert [o.date for o in vue["operations"]] == sorted(o.date for o in vue["operations"])
    assert vue["annees"] == [2026, 2025]


def test_l_annee_en_cours_est_toujours_proposee(db_session):
    assert service_impots.vue(db_session, 2026, AUJOURDHUI)["annees"] == [2026]


def test_l_impot_estime_attend_un_taux(db_session, compte):
    _entree(db_session, compte, 2000.0, date(2026, 3, 5), a_declarer=True)

    sans_taux = service_impots.vue(db_session, 2026, AUJOURDHUI)
    assert sans_taux["monnaies"][0]["impot_estime"] is None

    service_impots.poser_declaration(db_session, 2026, {"taux_pct": 11.0})
    avec_taux = service_impots.vue(db_session, 2026, AUJOURDHUI)
    assert avec_taux["monnaies"][0]["impot_estime"] == 220.0


def test_seules_les_entrees_reelles_entrent_dans_l_impot(db_session, compte):
    _entree(db_session, compte, 1000.0, date(2026, 3, 5), a_declarer=True)
    _entree(db_session, compte, 1000.0, date(2026, 12, 5), a_declarer=True, statut=Statut.previsionnel)
    service_impots.poser_declaration(db_session, 2026, {"taux_pct": 10.0})

    bilan = service_impots.vue(db_session, 2026, AUJOURDHUI)["monnaies"][0]

    assert bilan["total_reel"] == 1000.0
    assert bilan["impot_estime"] == 100.0


def test_la_date_limite_compte_les_jours_restants(db_session):
    service_impots.poser_declaration(db_session, 2026, {"date_limite": date(2026, 10, 19)})
    assert service_impots.declaration_de(db_session, 2026, AUJOURDHUI)["jours_restants"] == 10
    # Dépassée : négatif.
    assert service_impots.declaration_de(db_session, 2026, date(2026, 10, 21))["jours_restants"] == -2


def test_vider_les_deux_reglages_supprime_la_ligne(db_session):
    service_impots.poser_declaration(db_session, 2026, {"taux_pct": 11.0, "date_limite": date(2026, 5, 1)})
    service_impots.poser_declaration(db_session, 2026, {"taux_pct": None})
    ligne = db_session.query(models.DeclarationImpots).one()
    assert ligne.taux_pct is None and ligne.date_limite == date(2026, 5, 1)

    service_impots.poser_declaration(db_session, 2026, {"date_limite": None})
    assert db_session.query(models.DeclarationImpots).count() == 0


def test_un_champ_absent_ne_change_pas_un_champ_null_efface(db_session):
    service_impots.poser_declaration(db_session, 2026, {"taux_pct": 11.0, "date_limite": date(2026, 5, 1)})
    ecriture = schemas_impots.DeclarationEcriture(taux_pct=12.0)
    routeur_impots.ecrire_declaration(2026, ecriture, db=db_session)
    ligne = db_session.query(models.DeclarationImpots).one()
    assert ligne.taux_pct == 12.0 and ligne.date_limite == date(2026, 5, 1)

    routeur_impots.ecrire_declaration(
        2026, schemas_impots.DeclarationEcriture(date_limite=None), db=db_session
    )
    db_session.refresh(ligne)
    assert ligne.taux_pct == 12.0 and ligne.date_limite is None


def test_le_taux_est_un_pourcentage():
    with pytest.raises(ValidationError):
        schemas_impots.DeclarationEcriture(taux_pct=101)
    with pytest.raises(ValidationError):
        schemas_impots.DeclarationEcriture(taux_pct=-1)


def test_retirer_ne_touche_qu_a_l_etiquette(db_session, compte):
    op = _entree(db_session, compte, 1000.0, date(2026, 3, 5), a_declarer=True)

    routeur_impots.retirer(op.id, db=db_session)

    db_session.refresh(op)
    assert op.a_declarer is False
    assert op.montant == 1000.0 and op.nature == "Salaire"


def test_retirer_une_operation_inconnue_est_un_404(db_session):
    with pytest.raises(HTTPException) as erreur:
        routeur_impots.retirer(9999, db=db_session)
    assert erreur.value.status_code == 404


def test_une_annee_absurde_est_refusee(db_session):
    with pytest.raises(HTTPException) as erreur:
        routeur_impots.lire(annee=20266, db=db_session)
    assert erreur.value.status_code == 422
