"""Les règles qui disent ce qu'une ligne de relevé de compte-titres décrit.

Ce que ces tests protègent, dans l'ordre de ce qui coûterait le plus cher à
casser :

  - L'ORDRE DE CONSULTATION. Les règles passent AVANT les mots-clés du preset.
    Inverser les deux rendrait toute règle inopérante sur un libellé que le
    vocabulaire reconnaît déjà — c'est-à-dire précisément dans le cas où l'on
    écrit une règle pour corriger ce que le vocabulaire fait ;
  - LE REPLI SUR LE VOCABULAIRE. Une base sans aucune règle doit se comporter
    exactement comme avant qu'elles existent : rien de ce qui marchait ne doit
    cesser de marcher parce qu'une table vide est apparue ;
  - LE SENS DU TYPE POSÉ. Confondre un achat et une vente ne coûte pas un
    centime de travers, mais une position entière à l'envers.
"""
import io

import openpyxl
import pytest
from fastapi import HTTPException
from pydantic import ValidationError

from app import crud, schemas
from app.constants import COLONNES_IMPORT_PLACEMENT_PAR_DEFAUT, DomaineImport
from app.services import regles_categorisation

from .conftest import charger_module_extension, creer_compte

service = charger_module_extension("import-placements", "service_import_placements.py")
routeur_regles = charger_module_extension(
    "import-placements", "routeur_regles_placements.py"
)


# ---------- Outillage ----------


def _fichier(lignes: list[dict]) -> bytes:
    """Les sept colonnes par défaut, précédées d'un en-tête."""
    classeur = openpyxl.Workbook()
    feuille = classeur.active
    feuille.append(["Date", "Type", "Valeur", "ISIN", "Montant", "Quantité", "Cours"])
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


def _preset(db, compte=None, **kwargs):
    return crud.create_import_preset(
        db,
        kwargs.pop("nom", "Courtier"),
        COLONNES_IMPORT_PLACEMENT_PAR_DEFAUT,
        [],
        ignorer_premiere_ligne=True,
        compte_id=compte.id if compte else None,
        domaine=DomaineImport.placement.value,
        **kwargs,
    )


def _compte_titres(db, nom="PEA"):
    return creer_compte(db, nom, type_nom="placements financiers", solde_initial=10000.0)


def _conditions(champ="type_brut", operateur="contient", valeur="ACHAT"):
    return {
        "operateur": "ET",
        "groupes": [
            {
                "operateur": "ET",
                "conditions": [
                    {"champ": champ, "operateur": operateur, "valeur": valeur}
                ],
            }
        ],
    }


def _regle(db, nom, type_placement, **kwargs):
    return crud.create_regle_import_placement(
        db,
        nom=nom,
        conditions=kwargs.pop("conditions", None) or _conditions(),
        type_placement=type_placement,
        **kwargs,
    )


def _type_applique(regles, brute):
    """Le seul type : `appliquer_regles_placement` rend aussi le compte en face
    et l'étiquette de titre, dont la plupart de ces tests ne parlent pas."""
    resultat = regles_categorisation.appliquer_regles_placement(regles, brute)
    return None if resultat is None else resultat.type_placement


def _lignes_du_type(apercu, type_placement):
    return [ligne for ligne in apercu.lignes if ligne.type_placement == type_placement]


# ---------- Le moteur ----------


def test_la_premiere_regle_qui_correspond_pose_le_type(db_session):
    _regle(db_session, "Achats", "achat", conditions=_conditions(valeur="ACH"))
    _regle(db_session, "Ventes", "vente", conditions=_conditions(valeur="VTE"))
    regles = crud.list_regles_import_placement(db_session)

    assert _type_applique(regles, {"type_brut": "VTE COMPTANT TOTAL"}) == "vente"


def test_la_regle_la_plus_haute_gagne(db_session):
    """L'ordre EST la sémantique. Deux règles ne peuvent que se contredire ici —
    une règle de placement ne décide que du type, il n'y a rien à compléter."""
    _regle(db_session, "Générale", "achat", conditions=_conditions(valeur="OPERATION"))
    _regle(
        db_session,
        "Particulière",
        "vente",
        conditions=_conditions(valeur="OPERATION DE VENTE"),
    )
    regles = crud.list_regles_import_placement(db_session)

    assert _type_applique(regles, {"type_brut": "OPERATION DE VENTE"}) == "achat"

    # Remontée au premier rang, la particulière l'emporte.
    ids = [r.id for r in regles]
    crud.reordonner_regles_import_placement(db_session, [ids[1], ids[0]])
    assert (
        _type_applique(
            crud.list_regles_import_placement(db_session),
            {"type_brut": "OPERATION DE VENTE"},
        )
        == "vente"
    )


def test_une_regle_inactive_ne_correspond_jamais(db_session):
    _regle(db_session, "Achats", "achat", actif=False)
    regles = crud.list_regles_import_placement(db_session)
    assert _type_applique(regles, {"type_brut": "ACHAT"}) is None


def test_aucune_regle_correspondante_rend_none(db_session):
    _regle(db_session, "Achats", "achat", conditions=_conditions(valeur="ACHAT"))
    regles = crud.list_regles_import_placement(db_session)
    assert _type_applique(regles, {"type_brut": "DIVIDENDE"}) is None


def test_la_comparaison_ignore_casse_et_accents(db_session):
    """Comme côté bancaire : les libellés de courtiers sont irrégulièrement
    accentués et souvent tout en majuscules."""
    _regle(db_session, "Ventes", "vente", conditions=_conditions(valeur="cession"))
    regles = crud.list_regles_import_placement(db_session)
    assert _type_applique(regles, {"type_brut": "CESSION DE TITRES"}) == "vente"


def test_une_condition_peut_viser_le_nom_de_la_valeur(db_session):
    _regle(
        db_session,
        "Transferts",
        "transfert",
        conditions=_conditions(champ="nom_valeur_brut", operateur="est", valeur="ESPECES"),
    )
    regles = crud.list_regles_import_placement(db_session)
    assert (
        _type_applique(regles, {"type_brut": "MOUVEMENT", "nom_valeur_brut": "Espèces"})
        == "transfert"
    )


# ---------- L'import ----------


def test_une_regle_reconnait_un_libelle_que_le_vocabulaire_ne_peut_pas_lire(db_session):
    """LA RAISON D'ÊTRE DE CES RÈGLES. Le courtier écrit une phrase par ligne,
    avec le nom du titre dedans : il n'y a pas deux fois le même libellé dans
    tout le fichier, aucune liste de mots-clés ne peut donc en reconnaître un
    seul."""
    compte = _compte_titres(db_session)
    preset = _preset(db_session, compte)
    _regle(db_session, "Achats", "achat", conditions=_conditions(valeur="ACHAT"))

    apercu = service.previsualiser(
        db_session,
        preset.id,
        _fichier(
            [
                {
                    "date": "12/03/2026",
                    "type": "ACHAT COMPTANT AMUNDI MSCI WORLD",
                    "valeur": "Amundi MSCI World",
                    "isin": "LU1681043599",
                    "montant": 500.0,
                    "quantite": 10,
                }
            ]
        ),
    )

    assert len(_lignes_du_type(apercu, "achat")) == 1
    assert apercu.lignes[0].erreur is None


def test_sans_regle_le_vocabulaire_reconnait_toujours(db_session):
    """Une base sans aucune règle se comporte exactement comme avant qu'elles
    existent : la table vide ne doit rien changer."""
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
                    "valeur": "Total",
                    "isin": "FR0000120271",
                    "montant": 500.0,
                    "quantite": 10,
                }
            ]
        ),
    )

    assert len(_lignes_du_type(apercu, "achat")) == 1


def test_les_regles_passent_avant_le_vocabulaire(db_session):
    """Le libellé « Achat » appartient au vocabulaire par défaut des achats ; la
    règle le classe pourtant en vente.

    Ce n'est pas un cas de bon sens — c'est le cas LIMITE qui dit qui décide.
    Si le vocabulaire passait devant, une règle serait sans effet exactement là
    où on l'écrit : sur un libellé que la reconnaissance automatique classe
    déjà, et mal."""
    compte = _compte_titres(db_session)
    preset = _preset(db_session, compte)
    _regle(db_session, "Tout en vente", "vente", conditions=_conditions(valeur="Achat"))

    apercu = service.previsualiser(
        db_session,
        preset.id,
        _fichier(
            [
                {
                    "date": "12/03/2026",
                    "type": "Achat",
                    "valeur": "Total",
                    "isin": "FR0000120271",
                    "montant": 500.0,
                    "quantite": 10,
                }
            ]
        ),
    )

    assert len(_lignes_du_type(apercu, "vente")) == 1
    assert _lignes_du_type(apercu, "achat") == []


def test_une_ligne_qu_aucune_regle_ne_reconnait_retombe_sur_le_vocabulaire(db_session):
    """Les deux mécanismes cohabitent dans le MÊME fichier : la règle attrape la
    phrase, le vocabulaire attrape le mot."""
    compte = _compte_titres(db_session)
    preset = _preset(db_session, compte)
    _regle(db_session, "Achats", "achat", conditions=_conditions(valeur="ACHAT COMPTANT"))

    apercu = service.previsualiser(
        db_session,
        preset.id,
        _fichier(
            [
                {
                    "date": "12/03/2026",
                    "type": "ACHAT COMPTANT TOTAL",
                    "valeur": "Total",
                    "isin": "FR0000120271",
                    "montant": 500.0,
                    "quantite": 10,
                },
                {
                    "date": "13/03/2026",
                    "type": "Vente",
                    "valeur": "Total",
                    "isin": "FR0000120271",
                    "montant": 200.0,
                    "quantite": 4,
                },
            ]
        ),
    )

    assert len(_lignes_du_type(apercu, "achat")) == 1
    assert len(_lignes_du_type(apercu, "vente")) == 1


def test_les_regles_sont_communes_a_tous_les_presets(db_session):
    """Sans preset_id, comme les règles bancaires : une règle est une phrase sur
    des libellés. C'est le VOCABULAIRE qui reste propre au courtier."""
    compte = _compte_titres(db_session)
    autre = _compte_titres(db_session, nom="CTO")
    premier = _preset(db_session, compte, nom="Courtier A")
    second = _preset(db_session, autre, nom="Courtier B")
    _regle(db_session, "Achats", "achat", conditions=_conditions(valeur="ACQUISITION"))

    fichier = _fichier(
        [
            {
                "date": "12/03/2026",
                "type": "ACQUISITION DE PARTS",
                "valeur": "Total",
                "isin": "FR0000120271",
                "montant": 500.0,
                "quantite": 10,
            }
        ]
    )
    for preset in (premier, second):
        apercu = service.previsualiser(db_session, preset.id, fichier)
        assert len(_lignes_du_type(apercu, "achat")) == 1


def test_un_type_corrompu_en_base_retombe_sur_le_vocabulaire(db_session):
    """Une donnée illisible ne doit pas faire échouer tout un import : la ligne
    est simplement lue comme si la règle n'existait pas."""
    compte = _compte_titres(db_session)
    preset = _preset(db_session, compte)
    regle = _regle(db_session, "Achats", "achat", conditions=_conditions(valeur="Achat"))
    regle.type_placement = "n'importe quoi"
    db_session.commit()

    apercu = service.previsualiser(
        db_session,
        preset.id,
        _fichier(
            [
                {
                    "date": "12/03/2026",
                    "type": "Achat",
                    "valeur": "Total",
                    "isin": "FR0000120271",
                    "montant": 500.0,
                    "quantite": 10,
                }
            ]
        ),
    )

    assert len(_lignes_du_type(apercu, "achat")) == 1


# ---------- Le routeur et les schémas ----------


def test_le_routeur_cree_lit_modifie_et_supprime(db_session):
    creee = routeur_regles.create_regle(
        schemas.RegleImportPlacementCreate(
            nom="Achats",
            conditions=_conditions(),
            type_placement="achat",
        ),
        db=db_session,
    )
    assert creee.ordre == 0

    modifiee = routeur_regles.update_regle(
        creee.id,
        schemas.RegleImportPlacementUpdate(
            nom="Achats comptant",
            conditions=_conditions(valeur="ACHAT COMPTANT"),
            type_placement="achat",
            actif=False,
        ),
        db=db_session,
    )
    assert modifiee.nom == "Achats comptant"
    assert modifiee.actif is False

    routeur_regles.delete_regle(creee.id, db=db_session)
    assert routeur_regles.list_regles(db=db_session) == []


def test_le_routeur_repond_404_sur_une_regle_inconnue(db_session):
    with pytest.raises(HTTPException) as erreur:
        routeur_regles.get_regle(999, db=db_session)
    assert erreur.value.status_code == 404


def test_une_regle_nouvelle_se_range_en_bout_de_liste(db_session):
    """Elle ne doit jamais court-circuiter silencieusement celles déjà écrites."""
    premiere = _regle(db_session, "A", "achat")
    seconde = _regle(db_session, "B", "vente")
    assert [r.id for r in crud.list_regles_import_placement(db_session)] == [
        premiere.id,
        seconde.id,
    ]


def test_un_champ_inconnu_est_refuse(db_session):
    """Les champs bancaires n'ont rien à faire ici : un relevé de compte-titres
    ne porte ni « nature » ni « categorie_banque »."""
    with pytest.raises(ValidationError):
        schemas.RegleImportPlacementCreate(
            nom="Achats",
            conditions=_conditions(champ="nature"),
            type_placement="achat",
        )


def test_une_valeur_vide_est_refusee(db_session):
    """« contient "" » serait toujours vrai : la règle ne voudrait rien dire."""
    with pytest.raises(ValidationError):
        schemas.RegleImportPlacementCreate(
            nom="Achats",
            conditions=_conditions(valeur="   "),
            type_placement="achat",
        )


def test_une_regle_sans_groupe_est_refusee(db_session):
    with pytest.raises(ValidationError):
        schemas.RegleImportPlacementCreate(
            nom="Achats",
            conditions={"operateur": "ET", "groupes": []},
            type_placement="achat",
        )


def test_un_type_de_placement_inconnu_est_refuse(db_session):
    with pytest.raises(ValidationError):
        schemas.RegleImportPlacementCreate(
            nom="Achats",
            conditions=_conditions(),
            type_placement="dividende",
        )


# ---------- Le compte en face posé par la règle ----------


def test_une_regle_de_transfert_peut_poser_le_compte_en_face(db_session):
    """Un relevé de compte-titres ne nomme jamais que son propre compte : sans
    ce second compte, chaque transfert arrive incomplet dans l'aperçu."""
    courant = creer_compte(db_session, "Courant")
    regle = crud.create_regle_import_placement(
        db_session,
        nom="Versements",
        conditions=_conditions(valeur="VERSEMENT"),
        type_placement="transfert",
        compte_autre_id=courant.id,
    )
    decision = regles_categorisation.appliquer_regles_placement(
        [regle], {"type_brut": "VERSEMENT ESPECES"}
    )
    assert (decision.type_placement, decision.compte_autre_id) == ("transfert", courant.id)


def test_le_compte_en_face_est_neutralise_hors_transfert(db_session):
    """Changer de type dans l'éditeur ne doit pas laisser un second compte sur
    un achat, qui n'en touche qu'un."""
    courant = creer_compte(db_session, "Courant")
    creee = routeur_regles.create_regle(
        schemas.RegleImportPlacementCreate(
            nom="Achats",
            conditions=_conditions(),
            type_placement="achat",
            compte_autre_id=courant.id,
        ),
        db=db_session,
    )
    assert creee.compte_autre_id is None


def test_un_compte_en_face_inconnu_est_refuse(db_session):
    with pytest.raises(HTTPException) as erreur:
        routeur_regles.create_regle(
            schemas.RegleImportPlacementCreate(
                nom="Versements",
                conditions=_conditions(),
                type_placement="transfert",
                compte_autre_id=999,
            ),
            db=db_session,
        )
    assert erreur.value.status_code == 404


def test_la_ligne_importee_recoit_le_compte_de_la_regle(db_session):
    """Bout en bout : la règle reconnaît le transfert ET le complète, la ligne
    n'a donc plus rien à reprendre à la main."""
    compte = _compte_titres(db_session)
    courant = creer_compte(db_session, "Courant")
    preset = _preset(db_session, compte)
    crud.create_regle_import_placement(
        db_session,
        nom="Versements",
        conditions=_conditions(valeur="VERSEMENT"),
        type_placement="transfert",
        compte_autre_id=courant.id,
    )

    apercu = service.previsualiser(
        db_session,
        preset.id,
        _fichier(
            [
                {
                    "date": "12/03/2026",
                    "type": "VERSEMENT DE FONDS",
                    "montant": 500.0,
                }
            ]
        ),
    )

    (ligne,) = apercu.lignes
    assert ligne.type_placement == "transfert"
    assert ligne.compte_id_autre == courant.id
    assert ligne.erreur is None
