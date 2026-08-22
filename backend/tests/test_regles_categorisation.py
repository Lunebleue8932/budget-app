import io
from datetime import date

import openpyxl
import pytest
from fastapi import HTTPException
from pydantic import ValidationError

from app import crud, models, schemas
from app.constants import COLONNES_IMPORT_PAR_DEFAUT
from app.services import import_bancaire, regles_categorisation
from app.routers.regles import create_regle

from .conftest import creer_compte, get_categorie_id, get_monnaie_id, get_type_id


def _condition(champ, operateur, valeur):
    return {"champ": champ, "operateur": operateur, "valeur": valeur}


def _conditions(*conditions, operateur_groupe="ET", operateur_regle="ET"):
    return {
        "operateur": operateur_regle,
        "groupes": [{"operateur": operateur_groupe, "conditions": list(conditions)}],
    }


def _make_regle(db, nom="Règle", conditions=None, type_operation="classique", **kwargs):
    """`type_operation` est le code technique du type ; `type_id` peut aussi
    être passé directement, auquel cas il prime."""
    kwargs.setdefault("type_id", get_type_id(db, type_operation))
    return crud.create_regle_categorisation(
        db,
        nom=nom,
        conditions=conditions or _conditions(_condition("nature", "contient", "PRET")),
        **kwargs,
    )


# ---------- Normalisation et comparaison ----------


def test_normaliser_ignore_casse_et_accents():
    assert regles_categorisation._normaliser("Remboursé") == "rembourse"
    assert regles_categorisation._normaliser("VIR SEPA REMBOURSEMENT") == "vir sepa remboursement"
    assert regles_categorisation._normaliser("  Café  ") == "cafe"
    assert regles_categorisation._normaliser(None) == ""


def test_les_comparaisons_ignorent_casse_et_accents():
    """Les libellés bancaires sont irrégulièrement accentués et souvent tout
    en majuscules : une règle écrite naturellement doit malgré tout matcher."""
    brute = {"nature": "VIR SEPA REMBOURSE FRAIS", "categorie_banque": "", "compte_banque": ""}
    conditions = _conditions(_condition("nature", "contient", "remboursé"))
    assert regles_categorisation.evaluer_regle(conditions, brute) is True


@pytest.mark.parametrize(
    "operateur,valeur,attendu",
    [
        ("est", "Courses Monoprix", True),
        ("est", "Courses", False),
        ("n'est pas", "Courses", True),
        ("n'est pas", "Courses Monoprix", False),
        ("contient", "monoprix", True),
        ("contient", "carrefour", False),
        ("ne contient pas", "carrefour", True),
        ("ne contient pas", "monoprix", False),
    ],
)
def test_les_quatre_operateurs(operateur, valeur, attendu):
    brute = {"nature": "Courses Monoprix", "categorie_banque": "", "compte_banque": ""}
    conditions = _conditions(_condition("nature", operateur, valeur))
    assert regles_categorisation.evaluer_regle(conditions, brute) is attendu


# ---------- Combinaisons ----------


def test_viser_plusieurs_champs_passe_par_un_groupe_ou(db_session):
    """Une condition ne porte plus que sur un champ : viser nature OU
    catégorie bancaire s'écrit avec deux conditions dans un groupe "OU"."""
    conditions = _conditions(
        _condition("nature", "contient", "PRET"),
        _condition("categorie_banque", "contient", "PRET"),
        operateur_groupe="OU",
    )
    assert regles_categorisation.evaluer_regle(
        conditions, {"nature": "Virement PRET immo", "categorie_banque": "Divers", "compte_banque": ""}
    )
    assert regles_categorisation.evaluer_regle(
        conditions, {"nature": "Virement", "categorie_banque": "PRET banque", "compte_banque": ""}
    )
    assert not regles_categorisation.evaluer_regle(
        conditions, {"nature": "Virement", "categorie_banque": "Divers", "compte_banque": ""}
    )


def test_ancienne_forme_champs_multiples_reste_evaluable(db_session):
    """Rétrocompatibilité : une règle enregistrée avant le passage au champ
    unique garde des `champs` multiples, combinés en OU comme à l'origine."""
    conditions = _conditions({"champs": ["nature", "categorie_banque"], "operateur": "contient", "valeur": "PRET"})
    assert regles_categorisation.evaluer_regle(
        conditions, {"nature": "Virement", "categorie_banque": "PRET banque", "compte_banque": ""}
    )
    assert not regles_categorisation.evaluer_regle(
        conditions, {"nature": "Courses", "categorie_banque": "Divers", "compte_banque": ""}
    )


def test_groupe_et_exige_toutes_les_conditions(db_session):
    conditions = _conditions(
        _condition("nature", "contient", "VIR"),
        _condition("nature", "ne contient pas", "SALAIRE"),
        operateur_groupe="ET",
    )
    assert regles_categorisation.evaluer_regle(
        conditions, {"nature": "VIR SEPA AMIS", "categorie_banque": "", "compte_banque": ""}
    )
    assert not regles_categorisation.evaluer_regle(
        conditions, {"nature": "VIR SALAIRE JUILLET", "categorie_banque": "", "compte_banque": ""}
    )


def test_groupe_ou_suffit_dune_condition(db_session):
    conditions = _conditions(
        _condition("nature", "contient", "PRET"),
        _condition("nature", "contient", "EMPRUNT"),
        operateur_groupe="OU",
    )
    for nature in ("Remboursement PRET", "Mensualité EMPRUNT"):
        assert regles_categorisation.evaluer_regle(
            conditions, {"nature": nature, "categorie_banque": "", "compte_banque": ""}
        )
    assert not regles_categorisation.evaluer_regle(
        conditions, {"nature": "Courses", "categorie_banque": "", "compte_banque": ""}
    )


def test_deux_groupes_combines_en_et(db_session):
    """(A OU B) ET (C) — le cas que la structure à deux niveaux doit couvrir."""
    conditions = {
        "operateur": "ET",
        "groupes": [
            {
                "operateur": "OU",
                "conditions": [
                    _condition("nature", "contient", "PRET"),
                    _condition("nature", "contient", "EMPRUNT"),
                ],
            },
            {
                "operateur": "ET",
                "conditions": [_condition("compte_banque", "est", "CC Perso")],
            },
        ],
    }
    assert regles_categorisation.evaluer_regle(
        conditions, {"nature": "PRET immo", "categorie_banque": "", "compte_banque": "CC Perso"}
    )
    # Bon libellé, mauvais compte.
    assert not regles_categorisation.evaluer_regle(
        conditions, {"nature": "PRET immo", "categorie_banque": "", "compte_banque": "Livret A"}
    )


def test_regle_sans_groupe_ne_matche_jamais(db_session):
    """Sinon elle s'appliquerait à toutes les lignes."""
    assert not regles_categorisation.evaluer_regle({"operateur": "ET", "groupes": []}, {"nature": "x"})
    assert not regles_categorisation.evaluer_regle({}, {"nature": "x"})


def test_operateur_inconnu_ne_matche_jamais(db_session):
    conditions = _conditions(_condition("nature", "commence_par", "PRET"))
    assert not regles_categorisation.evaluer_regle(conditions, {"nature": "PRET immo"})


# ---------- Hiérarchie ----------


def test_premiere_regle_qui_matche_gagne(db_session):
    alimentaire = get_categorie_id(db_session, "Alimentaire")
    _make_regle(
        db_session,
        nom="Spécifique",
        conditions=_conditions(_condition("nature", "contient", "PRET IMMO")),
        type_id=get_type_id(db_session, "pret"),
        ordre=0,
    )
    _make_regle(
        db_session,
        nom="Général",
        conditions=_conditions(_condition("nature", "contient", "PRET")),
        categorie_id=alimentaire,
        ordre=1,
    )

    resultat = regles_categorisation.appliquer_regles(
        crud.list_regles_categorisation(db_session),
        {"nature": "PRET IMMO mars"},
    )

    assert resultat.nom_regle == "Spécifique"
    assert resultat.type_code == "pret"


def test_reordonner_change_la_regle_gagnante(db_session):
    alimentaire = get_categorie_id(db_session, "Alimentaire")
    generale = _make_regle(
        db_session,
        nom="Général",
        conditions=_conditions(_condition("nature", "contient", "PRET")),
        categorie_id=alimentaire,
        ordre=0,
    )
    specifique = _make_regle(
        db_session,
        nom="Spécifique",
        conditions=_conditions(_condition("nature", "contient", "PRET IMMO")),
        type_id=get_type_id(db_session, "pret"),
        ordre=1,
    )
    resultat = regles_categorisation.appliquer_regles(
        crud.list_regles_categorisation(db_session), {"nature": "PRET IMMO"}
    )
    assert resultat.nom_regle == "Général"

    crud.reordonner_regles_categorisation(db_session, [specifique.id, generale.id])

    resultat = regles_categorisation.appliquer_regles(
        crud.list_regles_categorisation(db_session), {"nature": "PRET IMMO"}
    )
    assert resultat.nom_regle == "Spécifique"


def test_regle_inactive_est_ignoree(db_session):
    _make_regle(db_session, nom="Désactivée", type_id=get_type_id(db_session, "pret"), actif=False)

    resultat = regles_categorisation.appliquer_regles(
        crud.list_regles_categorisation(db_session), {"nature": "PRET immo"}
    )

    assert resultat is None


def test_aucune_regle_ne_matche_renvoie_none(db_session):
    _make_regle(db_session, type_id=get_type_id(db_session, "pret"))
    assert (
        regles_categorisation.appliquer_regles(
            crud.list_regles_categorisation(db_session), {"nature": "Courses"}
        )
        is None
    )


# ---------- Validation ----------


def test_type_operation_est_obligatoire(db_session):
    with pytest.raises(ValidationError):
        schemas.RegleCategorisationCreate(
            nom="Sans type",
            conditions=_conditions(_condition("nature", "contient", "PRET")),
        )


def test_champ_inconnu_est_refuse(db_session):
    with pytest.raises(ValidationError):
        schemas.RegleCategorisationCreate(
            nom="Mauvais champ",
            conditions=_conditions(_condition("montant", "contient", "10")),
            type_id=get_type_id(db_session, "classique"),
        )


def test_valeur_vide_est_refusee(db_session):
    with pytest.raises(ValidationError):
        schemas.RegleCategorisationCreate(
            nom="Valeur vide",
            conditions=_conditions(_condition("nature", "contient", "   ")),
            type_id=get_type_id(db_session, "classique"),
        )


def test_categorie_inexistante_est_refusee(db_session):
    with pytest.raises(HTTPException) as exc:
        create_regle(
            schemas.RegleCategorisationCreate(
                nom="Catégorie fantôme",
                conditions=_conditions(_condition("nature", "contient", "PRET")),
                type_id=get_type_id(db_session, "classique"),
                categorie_id=999999,
            ),
            db_session,
        )
    assert exc.value.status_code == 404


def test_un_type_a_categorie_imposee_outrepasse_la_categorie_choisie(db_session):
    """Le cœur de la robustesse demandée : choisir une catégorie puis basculer
    vers un type qui n'en accepte pas ne doit jamais laisser la combinaison
    incohérente — la catégorie est simplement neutralisée (côté routeur, seul
    à pouvoir résoudre le code du type depuis son id)."""
    regle = create_regle(
        schemas.RegleCategorisationCreate(
            nom="Prêts",
            conditions=_conditions(_condition("nature", "contient", "PRET")),
            type_id=get_type_id(db_session, "pret"),
            categorie_id=get_categorie_id(db_session, "Alimentaire"),
        ),
        db_session,
    )
    assert regle.categorie_id is None


def test_un_type_a_categorie_libre_conserve_la_categorie(db_session):
    alimentaire = get_categorie_id(db_session, "Alimentaire")
    for type_libre in ("classique", "remboursable"):
        regle = create_regle(
            schemas.RegleCategorisationCreate(
                nom=f"Courses {type_libre}",
                conditions=_conditions(_condition("nature", "contient", "MONOPRIX")),
                type_id=get_type_id(db_session, type_libre),
                categorie_id=alimentaire,
            ),
            db_session,
        )
        assert regle.categorie_id == alimentaire


def test_seuls_les_types_a_categorie_libre_portent_une_categorie(db_session):
    """La règle renvoie le type ; la catégorie n'est conservée que pour les
    deux types qui l'admettent — les autres la neutralisent."""
    alimentaire = get_categorie_id(db_session, "Alimentaire")
    for type_operation in (
        "classique",
        "remboursable",
        "remboursements",
        "pret",
        "remboursement_pret",
        "virement",
    ):
        regle = _make_regle(
            db_session,
            nom=type_operation,
            type_operation=type_operation,
            categorie_id=alimentaire,
        )
        resultat = regles_categorisation.appliquer_regles([regle], {"nature": "PRET"})
        assert resultat.type_code == type_operation
        attendue = alimentaire if type_operation in ("classique", "remboursable") else None
        assert resultat.categorie_id == attendue, type_operation


def test_nouvelle_regle_va_en_fin_de_liste(db_session):
    """Une nouvelle règle ne doit jamais court-circuiter silencieusement
    celles déjà en place."""
    a = _make_regle(db_session, nom="A")
    b = _make_regle(db_session, nom="B")
    c = _make_regle(db_session, nom="C")

    assert [r.nom for r in crud.list_regles_categorisation(db_session)] == ["A", "B", "C"]
    assert a.ordre < b.ordre < c.ordre


# ---------- Intégration avec l'import ----------


def _construire_fichier(lignes):
    classeur = openpyxl.Workbook()
    feuille = classeur.active
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


def _make_compte(db, nom="CC Perso"):
    return creer_compte(db, nom)


def test_import_classe_automatiquement_une_ligne_en_pret(db_session):
    compte = _make_compte(db_session)
    preset = crud.create_import_preset(db_session, "Défaut", COLONNES_IMPORT_PAR_DEFAUT)
    _make_regle(
        db_session,
        nom="Prêts reçus",
        conditions=_conditions(_condition("nature", "contient", "PRET")),
        type_id=get_type_id(db_session, "pret"),
    )
    contenu = _construire_fichier(
        [{"date": date(2026, 7, 1), "nature": "PRET Marie", "montant": 500.0, "compte": "CC Perso"}]
    )
    crud.set_mapping_compte(db_session, preset.id, "CC Perso", compte.id)

    preview = import_bancaire.previsualiser(db_session, preset.id, contenu)

    ligne = preview.lignes[0]
    assert ligne.type_code == "pret"
    # Un type à catégorie imposée n'en porte aucune.
    assert ligne.categorie_id is None
    assert ligne.regle_appliquee == "Prêts reçus"
    # Classée par une règle : plus besoin de confirmer la suggestion "Autres".
    assert ligne.categorie_suggestion_auto is False
    assert preview.categories_inconnues == []


def test_import_marque_une_ligne_remboursable_par_regle(db_session):
    """Rien ne posait le type à l'import : c'est la règle qui débloque le
    classement automatique en "Dépense remboursable"."""
    compte = _make_compte(db_session)
    preset = crud.create_import_preset(db_session, "Défaut", COLONNES_IMPORT_PAR_DEFAUT)
    _make_regle(
        db_session,
        nom="Avances à récupérer",
        conditions=_conditions(_condition("nature", "contient", "REMBOURSABLE")),
        type_id=get_type_id(db_session, "remboursable"),
    )
    contenu = _construire_fichier(
        [
            {"date": date(2026, 7, 1), "nature": "Resto REMBOURSABLE", "montant": -80.0, "compte": "CC Perso"},
            {"date": date(2026, 7, 2), "nature": "Courses", "montant": -30.0, "compte": "CC Perso"},
        ]
    )
    crud.set_mapping_compte(db_session, preset.id, "CC Perso", compte.id)

    preview = import_bancaire.previsualiser(db_session, preset.id, contenu)

    assert preview.lignes[0].type_code == "remboursable"
    assert preview.lignes[0].regle_appliquee == "Avances à récupérer"
    assert preview.lignes[1].type_code == "classique"
    assert preview.lignes[1].regle_appliquee is None


def test_une_regle_prime_sur_un_mapping_pour_la_categorie(db_session):
    """Depuis 0022, la règle passe AVANT la correspondance sur les deux axes :
    c'est ce qui garantit qu'un type détecté par une règle ne peut plus être
    contredit par une correspondance de catégorie."""
    compte = _make_compte(db_session)
    preset = crud.create_import_preset(db_session, "Défaut", COLONNES_IMPORT_PAR_DEFAUT)
    alimentaire = get_categorie_id(db_session, "Alimentaire")
    loisirs = get_categorie_id(db_session, "Loisirs & sorties")
    crud.set_mapping_categorie(db_session, preset.id, "DIVERS", alimentaire)
    crud.set_mapping_compte(db_session, preset.id, "CC Perso", compte.id)
    _make_regle(
        db_session,
        nom="Sorties",
        conditions=_conditions(_condition("nature", "contient", "CINEMA")),
        categorie_id=loisirs,
    )
    contenu = _construire_fichier(
        [
            {
                "date": date(2026, 7, 1),
                "nature": "CINEMA Pathé",
                "categorie": "DIVERS",
                "montant": 12.0,
                "compte": "CC Perso",
            }
        ]
    )

    preview = import_bancaire.previsualiser(db_session, preset.id, contenu)

    assert preview.lignes[0].categorie_id == loisirs


def test_un_mapping_de_categorie_nannule_pas_le_type_pose_par_une_regle(db_session):
    """Type et catégorie sont deux axes indépendants. Une correspondance
    fourre-tout (« DIVERS » -> Autres, mémorisée une fois pour toutes) ne doit
    pas défaire une règle précise qui, elle, statue sur le type — sinon la
    règle serait silencieusement sans effet."""
    compte = _make_compte(db_session)
    preset = crud.create_import_preset(db_session, "Défaut", COLONNES_IMPORT_PAR_DEFAUT)
    crud.set_mapping_categorie(
        db_session, preset.id, "DIVERS", get_categorie_id(db_session, "Autres")
    )
    crud.set_mapping_compte(db_session, preset.id, "CC Perso", compte.id)
    _make_regle(
        db_session,
        nom="Prêts reçus",
        conditions=_conditions(_condition("nature", "contient", "PRET")),
        type_id=get_type_id(db_session, "pret"),
    )
    contenu = _construire_fichier(
        [
            {
                "date": date(2026, 7, 1),
                "nature": "PRET Marie",
                "categorie": "DIVERS",
                "montant": 500.0,
                "compte": "CC Perso",
            }
        ]
    )

    preview = import_bancaire.previsualiser(db_session, preset.id, contenu)

    assert preview.lignes[0].type_code == "pret"
    assert preview.lignes[0].regle_appliquee == "Prêts reçus"
    # Un « Prêt reçu » ne porte pas de catégorie : celle du mapping est
    # simplement sans objet ici.
    assert preview.lignes[0].categorie_id is None


def test_une_correspondance_ne_peut_plus_defaire_le_type_dune_regle(db_session):
    """Le cas qui motive l'inversion de priorité : une correspondance
    fourre-tout mémorisée (« MOUVEMENTS INTERNES » -> Autres) ne doit pas
    rétrograder en dépense classique une ligne qu'une règle a reconnue comme un
    virement. Le type vient de la règle, et la catégorie est alors sans objet."""
    compte = _make_compte(db_session)
    preset = crud.create_import_preset(db_session, "Défaut", COLONNES_IMPORT_PAR_DEFAUT)
    crud.set_mapping_categorie(
        db_session, preset.id, "MOUVEMENTS INTERNES", get_categorie_id(db_session, "Autres")
    )
    crud.set_mapping_compte(db_session, preset.id, "CC Perso", compte.id)
    _make_regle(
        db_session,
        nom="Virements internes",
        conditions=_conditions(_condition("categorie_banque", "contient", "MOUVEMENTS INTERNES")),
        type_id=get_type_id(db_session, "virement"),
    )
    contenu = _construire_fichier(
        [
            {
                "date": date(2026, 7, 1),
                "nature": "VIR SEPA LIVRET",
                "categorie": "MOUVEMENTS INTERNES",
                "montant": -500.0,
                "compte": "CC Perso",
            }
        ]
    )

    preview = import_bancaire.previsualiser(db_session, preset.id, contenu)

    assert preview.lignes[0].type_code == "virement"
    assert preview.lignes[0].regle_appliquee == "Virements internes"
    # Un virement interne ne porte aucune catégorie : celle de la
    # correspondance n'est même pas consultée.
    assert preview.lignes[0].categorie_id is None


def test_confirmer_cree_bien_une_operation_classee_par_regle(db_session):
    compte = _make_compte(db_session)
    preset = crud.create_import_preset(db_session, "Défaut", COLONNES_IMPORT_PAR_DEFAUT)
    crud.set_mapping_compte(db_session, preset.id, "CC Perso", compte.id)
    _make_regle(
        db_session,
        nom="Prêts reçus",
        conditions=_conditions(_condition("nature", "contient", "PRET")),
        type_id=get_type_id(db_session, "pret"),
    )
    contenu = _construire_fichier(
        [{"date": date(2026, 7, 1), "nature": "PRET Marie", "montant": 500.0, "compte": "CC Perso"}]
    )

    resultat = import_bancaire.confirmer(
        db_session, preset.id, contenu, schemas.ImportMappingOverrides()
    )

    assert resultat.operations_creees == 1
    operation = db_session.query(models.Operation).one()
    assert operation.type_code == "pret"
    assert operation.categorie_id is None
    # Un prêt est toujours remboursable, avec son montant intégralement dû.
    assert operation.remboursable is True
    assert operation.montant_du == 500.0


def test_une_regle_lue_par_lapi_expose_le_code_de_son_type(db_session):
    """`type_code` n'est pas une colonne mais une propriété du modèle : sans
    elle, le schéma de réponse échoue à la sérialisation (et l'endpoint rend un
    500 alors même que la règle a bien été créée)."""
    regle = create_regle(
        schemas.RegleCategorisationCreate(
            nom="Prêts reçus",
            conditions=_conditions(_condition("nature", "contient", "PRET")),
            type_id=get_type_id(db_session, "pret"),
        ),
        db_session,
    )

    lue = schemas.RegleCategorisationRead.model_validate(regle)

    assert lue.type_code == "pret"
    # Un type sans catégorie libre n'en porte aucune, même si l'appelant en
    # propose une.
    assert lue.categorie_id is None


# ---------- Compte en face d'un virement interne ----------
#
# Un relevé ne décrit qu'UN côté d'un virement. Sans second compte, chaque ligne
# reconnue par une règle arrivait incomplète dans l'aperçu : import bloqué tant
# qu'elle n'avait pas été reprise à la main (cf. _erreur_ligne), et veille
# anti-doublon muette, faute des deux comptes qu'elle exige.


def test_une_regle_de_virement_pose_le_compte_en_face(db_session):
    compte = _make_compte(db_session)
    livret = creer_compte(db_session, "Livret A", type_nom="épargne")
    preset = crud.create_import_preset(db_session, "Défaut", COLONNES_IMPORT_PAR_DEFAUT)
    crud.set_mapping_compte(db_session, preset.id, "CC Perso", compte.id)
    _make_regle(
        db_session,
        nom="Épargne mensuelle",
        conditions=_conditions(_condition("nature", "contient", "VIREMENT LIVRET")),
        type_id=get_type_id(db_session, "virement"),
        compte_autre_id=livret.id,
    )
    contenu = _construire_fichier(
        [
            {
                "date": date(2026, 7, 1),
                "nature": "VIREMENT LIVRET A",
                "montant": -250.0,
                "compte": "CC Perso",
            }
        ]
    )

    ligne = import_bancaire.previsualiser(db_session, preset.id, contenu).lignes[0]

    assert ligne.type_code == "virement"
    assert ligne.compte_id_autre == livret.id
    # Complète du premier coup : plus rien à reprendre à la main.
    assert import_bancaire._erreur_ligne(ligne) is None


def test_le_compte_en_face_est_ignore_sur_un_type_a_un_seul_compte(db_session):
    """Changer le type d'une règle ne doit pas laisser un second compte derrière
    lui : une dépense classique ne touche qu'un compte."""
    compte = _make_compte(db_session)
    livret = creer_compte(db_session, "Livret A", type_nom="épargne")
    preset = crud.create_import_preset(db_session, "Défaut", COLONNES_IMPORT_PAR_DEFAUT)
    crud.set_mapping_compte(db_session, preset.id, "CC Perso", compte.id)
    _make_regle(
        db_session,
        nom="Courses",
        conditions=_conditions(_condition("nature", "contient", "CARREFOUR")),
        type_id=get_type_id(db_session, "classique"),
        categorie_id=get_categorie_id(db_session, "Alimentaire"),
        compte_autre_id=livret.id,
    )
    contenu = _construire_fichier(
        [{"date": date(2026, 7, 1), "nature": "CARREFOUR", "montant": -30.0, "compte": "CC Perso"}]
    )

    ligne = import_bancaire.previsualiser(db_session, preset.id, contenu).lignes[0]

    assert ligne.compte_id_autre is None


def test_le_routeur_neutralise_le_compte_en_face_hors_virement(db_session):
    livret = creer_compte(db_session, "Livret A", type_nom="épargne")
    regle = create_regle(
        schemas.RegleCategorisationCreate(
            nom="Courses",
            conditions=_conditions(_condition("nature", "contient", "CARREFOUR")),
            type_id=get_type_id(db_session, "classique"),
            categorie_id=get_categorie_id(db_session, "Alimentaire"),
            compte_autre_id=livret.id,
        ),
        db_session,
    )
    assert regle.compte_autre_id is None


def test_le_routeur_refuse_un_compte_en_face_inconnu(db_session):
    with pytest.raises(HTTPException) as erreur:
        create_regle(
            schemas.RegleCategorisationCreate(
                nom="Épargne",
                conditions=_conditions(_condition("nature", "contient", "VIREMENT")),
                type_id=get_type_id(db_session, "virement"),
                compte_autre_id=9999,
            ),
            db_session,
        )
    assert erreur.value.status_code == 404
