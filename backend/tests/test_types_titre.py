"""Les étiquettes qu'on pose sur un titre : « ETF », « Obligation », « SCPI »…

Ce que ces tests protègent, dans l'ordre de ce qui coûterait le plus cher à
casser :

  - LE TYPE NE PÈSE SUR AUCUN MONTANT. C'est toute sa raison d'être : une
    étiquette pour regrouper, jamais une donnée de calcul. Le jour où un solde
    ou une valorisation se mettrait à en dépendre, supprimer un type deviendrait
    un geste dangereux au lieu d'être anodin ;
  - LA SUPPRESSION DÉTYPE, ELLE N'EFFACE PAS. Un titre porte des mouvements et
    des soldes réels ; perdre l'un d'eux pour se débarrasser d'une étiquette mal
    choisie serait hors de proportion ;
  - L'IMPORT NE RETYPE JAMAIS UN TITRE CONNU. Une règle ou une colonne mal
    réglée doit pouvoir typer ce qu'elle crée, pas réécrire silencieusement le
    portefeuille qu'on a rangé à la main.
"""
import io

import openpyxl
import pytest

from app import crud, schemas
from app.constants import DomaineImport

from .conftest import charger_module_extension, creer_compte

routeur_types = charger_module_extension("placements", "routeur_types_titre.py")
routeur_actions = charger_module_extension("placements", "routeur_actions.py")
routeur_regles = charger_module_extension(
    "import-placements", "routeur_regles_placements.py"
)
service_import = charger_module_extension(
    "import-placements", "service_import_placements.py"
)
schemas_pl = charger_module_extension(
    "import-placements", "schemas_import_placements.py"
)


# ---------- Outillage ----------


def _compte_titres(db, nom="PEA"):
    return creer_compte(db, nom, type_nom="placements financiers", solde_initial=10000.0)


def _monnaie_id(db):
    return crud.get_monnaies(db)[0].id


def _condition_type_contient(valeur):
    return {
        "operateur": "ET",
        "groupes": [
            {
                "operateur": "ET",
                "conditions": [
                    {"champ": "type_brut", "operateur": "contient", "valeur": valeur}
                ],
            }
        ],
    }


def _fichier_operations(lignes, avec_type_titre=False):
    """Les colonnes par défaut, éventuellement suivies d'une colonne de type."""
    classeur = openpyxl.Workbook()
    feuille = classeur.active
    entete = ["Date", "Type", "Valeur", "ISIN", "Montant", "Quantité", "Cours"]
    if avec_type_titre:
        entete.append("Catégorie")
    feuille.append(entete)
    for ligne in lignes:
        rangee = [
            ligne.get("date"),
            ligne.get("type"),
            ligne.get("valeur"),
            ligne.get("isin"),
            ligne.get("montant"),
            ligne.get("quantite"),
            ligne.get("cours"),
        ]
        if avec_type_titre:
            rangee.append(ligne.get("type_titre"))
        feuille.append(rangee)
    tampon = io.BytesIO()
    classeur.save(tampon)
    return tampon.getvalue()


_COLONNES = [
    {"index": 1, "propriete": "date"},
    {"index": 2, "propriete": "type_placement"},
    {"index": 3, "propriete": "nom_valeur"},
    {"index": 4, "propriete": "code_isin"},
    {"index": 5, "propriete": "montant"},
    {"index": 6, "propriete": "quantite"},
    {"index": 7, "propriete": "cours"},
]

_COLONNE_TYPE_TITRE = {"index": 8, "propriete": "type_titre"}


def _preset(db, compte, colonnes=None, **kwargs):
    return crud.create_import_preset(
        db,
        kwargs.pop("nom", "Courtier"),
        colonnes or _COLONNES,
        [],
        ignorer_premiere_ligne=True,
        compte_id=compte.id,
        domaine=DomaineImport.placement.value,
        **kwargs,
    )


def _confirmer(db, preset, contenu):
    return service_import.confirmer(
        db, preset.id, contenu, schemas_pl.OverridesPlacements()
    )


def _ligne_achat(**remplacements):
    ligne = {
        "date": "01/03/2026",
        "type": "Achat",
        "valeur": "MSCI World",
        "isin": "IE00B4L5Y983",
        "montant": 1000.0,
        "quantite": 10.0,
        "cours": 100.0,
    }
    ligne.update(remplacements)
    return ligne


# ---------- La ressource ----------


def test_un_type_se_cree_et_se_lit(db_session):
    cree = routeur_types.create_type_titre(schemas.TypeTitreCreate(nom="ETF"), db_session)
    assert cree.nom == "ETF"
    assert cree.nb_titres == 0
    assert [t.nom for t in routeur_types.list_types_titre(db_session)] == ["ETF"]


def test_deux_types_ne_peuvent_pas_porter_le_meme_nom(db_session):
    routeur_types.create_type_titre(schemas.TypeTitreCreate(nom="ETF"), db_session)
    with pytest.raises(Exception) as erreur:
        routeur_types.create_type_titre(schemas.TypeTitreCreate(nom="ETF"), db_session)
    assert erreur.value.status_code == 409


def test_la_liste_compte_les_titres_de_chaque_type(db_session):
    """Le compte accompagne la liste parce que la suppression, elle, ne demande
    rien : c'est lui qui rend le geste informé."""
    etf = crud.create_type_titre(db_session, "ETF")
    crud.create_type_titre(db_session, "Obligation")
    crud.create_action(db_session, "MSCI World", _monnaie_id(db_session), 100.0, None, etf.id)
    crud.create_action(db_session, "S&P 500", _monnaie_id(db_session), 50.0, None, etf.id)
    crud.create_action(db_session, "Air Liquide", _monnaie_id(db_session))

    par_nom = {t.nom: t.nb_titres for t in routeur_types.list_types_titre(db_session)}
    assert par_nom == {"ETF": 2, "Obligation": 0}


def test_renommer_un_type_retype_tout_le_portefeuille_dun_coup(db_session):
    """Les titres pointent sur la ligne, pas sur son libellé : c'est ce qu'une
    colonne texte sur chaque titre n'aurait pas permis."""
    etf = crud.create_type_titre(db_session, "ETF")
    action = crud.create_action(
        db_session, "MSCI World", _monnaie_id(db_session), 100.0, None, etf.id
    )
    routeur_types.update_type_titre(
        etf.id, schemas.TypeTitreUpdate(nom="Fonds indiciel"), db_session
    )
    db_session.refresh(action)
    assert action.type_titre.nom == "Fonds indiciel"


# ---------- La suppression ----------


def test_supprimer_un_type_detype_les_titres_sans_les_effacer(db_session):
    etf = crud.create_type_titre(db_session, "ETF")
    action = crud.create_action(
        db_session, "MSCI World", _monnaie_id(db_session), 100.0, None, etf.id
    )
    routeur_types.delete_type_titre(etf.id, db_session)
    db_session.refresh(action)
    assert action.type_titre_id is None
    assert crud.get_action(db_session, action.id) is not None


def test_supprimer_un_type_ne_touche_ni_au_cours_ni_a_la_monnaie(db_session):
    """Le type ne pèse sur aucun montant : c'est toute sa raison d'être."""
    etf = crud.create_type_titre(db_session, "ETF")
    action = crud.create_action(
        db_session, "MSCI World", _monnaie_id(db_session), 87.5, None, etf.id
    )
    routeur_types.delete_type_titre(etf.id, db_session)
    db_session.refresh(action)
    assert action.valeur == 87.5
    assert action.monnaie_id == _monnaie_id(db_session)


def test_supprimer_un_type_detache_aussi_les_regles_qui_le_posaient(db_session):
    etf = crud.create_type_titre(db_session, "ETF")
    regle = crud.create_regle_import_placement(
        db_session,
        nom="Achats",
        conditions=_condition_type_contient("ACHAT"),
        type_placement="achat",
        type_titre_id=etf.id,
    )
    routeur_types.delete_type_titre(etf.id, db_session)
    db_session.refresh(regle)
    assert regle.type_titre_id is None


# ---------- Le titre ----------


def test_le_zero_detype_un_titre_la_ou_none_ne_change_rien(db_session):
    """`None` veut dire « ne change pas » sur tous les champs d'une mise à jour
    partielle : il faut bien un autre geste pour DÉFAIRE un choix."""
    etf = crud.create_type_titre(db_session, "ETF")
    action = crud.create_action(
        db_session, "MSCI World", _monnaie_id(db_session), 100.0, None, etf.id
    )

    routeur_actions.update_action(action.id, schemas.ActionUpdate(valeur=110.0), db_session)
    db_session.refresh(action)
    assert action.type_titre_id == etf.id, "None ne doit rien changer"

    routeur_actions.update_action(action.id, schemas.ActionUpdate(type_titre_id=0), db_session)
    db_session.refresh(action)
    assert action.type_titre_id is None


def test_un_type_inconnu_est_refuse_sur_un_titre(db_session):
    with pytest.raises(Exception) as erreur:
        routeur_actions.create_action(
            schemas.ActionCreate(
                nom="MSCI World", monnaie_id=_monnaie_id(db_session), type_titre_id=999
            ),
            db_session,
        )
    assert erreur.value.status_code == 404


def test_le_libelle_du_type_voyage_avec_le_titre(db_session):
    """Les tableaux l'affichent tel quel, sans recharger la liste des types."""
    etf = crud.create_type_titre(db_session, "ETF")
    crud.create_action(db_session, "MSCI World", _monnaie_id(db_session), 100.0, None, etf.id)
    lu = routeur_actions.list_actions(False, db_session)[0]
    assert (lu.type_titre_id, lu.type_titre_nom) == (etf.id, "ETF")


# ---------- L'import ----------


def test_une_regle_type_le_titre_quelle_fait_creer(db_session):
    compte = _compte_titres(db_session)
    preset = _preset(db_session, compte)
    etf = crud.create_type_titre(db_session, "ETF")
    crud.create_regle_import_placement(
        db_session,
        nom="Achats",
        conditions=_condition_type_contient("ACHAT"),
        type_placement="achat",
        type_titre_id=etf.id,
    )
    contenu = _fichier_operations([_ligne_achat(type="ACHAT COMPTANT MSCI WORLD")])
    _confirmer(db_session, preset, contenu)

    action = crud.get_action_by_nom(db_session, "MSCI World")
    assert action is not None
    assert action.type_titre_id == etf.id


def test_limport_ne_retype_jamais_un_titre_deja_connu(db_session):
    """Un relevé mal réglé ne doit pas réécrire le portefeuille qu'on a rangé à
    la main."""
    compte = _compte_titres(db_session)
    preset = _preset(db_session, compte)
    etf = crud.create_type_titre(db_session, "ETF")
    obligation = crud.create_type_titre(db_session, "Obligation")
    action = crud.create_action(
        db_session, "MSCI World", _monnaie_id(db_session), 100.0, "IE00B4L5Y983", etf.id
    )
    crud.create_regle_import_placement(
        db_session,
        nom="Tout est une obligation",
        conditions=_condition_type_contient("ACHAT"),
        type_placement="achat",
        type_titre_id=obligation.id,
    )
    contenu = _fichier_operations([_ligne_achat(type="ACHAT COMPTANT")])
    _confirmer(db_session, preset, contenu)
    db_session.refresh(action)
    assert action.type_titre_id == etf.id


def test_une_colonne_de_type_cree_letiquette_quelle_nomme(db_session):
    """Un libellé qu'on jetterait au motif qu'il est inconnu perdrait de
    l'information sans rien protéger : une étiquette ne pèse sur aucun montant."""
    compte = _compte_titres(db_session)
    preset = _preset(db_session, compte, colonnes=_COLONNES + [_COLONNE_TYPE_TITRE])
    contenu = _fichier_operations(
        [_ligne_achat(type_titre="ETF")], avec_type_titre=True
    )
    _confirmer(db_session, preset, contenu)

    action = crud.get_action_by_nom(db_session, "MSCI World")
    assert action.type_titre is not None
    assert action.type_titre.nom == "ETF"


def test_deux_lignes_du_meme_libelle_ne_creent_quun_seul_type(db_session):
    """La contrainte d'unicité refuserait la seconde création et ferait échouer
    tout l'import."""
    compte = _compte_titres(db_session)
    preset = _preset(db_session, compte, colonnes=_COLONNES + [_COLONNE_TYPE_TITRE])
    contenu = _fichier_operations(
        [
            _ligne_achat(type_titre="ETF"),
            _ligne_achat(
                date="02/03/2026",
                valeur="S&P 500",
                isin="IE00B5BMR087",
                montant=500.0,
                quantite=5.0,
                type_titre="etf",
            ),
        ],
        avec_type_titre=True,
    )
    _confirmer(db_session, preset, contenu)

    types = crud.get_types_titre(db_session)
    assert [t.nom for t in types] == ["ETF"]
    assert crud.get_action_by_nom(db_session, "S&P 500").type_titre_id == types[0].id


def test_la_regle_lemporte_sur_la_colonne(db_session):
    """Ce que l'utilisateur a écrit explicitement passe avant ce que le fichier
    raconte — comme partout ailleurs dans cet import."""
    compte = _compte_titres(db_session)
    preset = _preset(db_session, compte, colonnes=_COLONNES + [_COLONNE_TYPE_TITRE])
    obligation = crud.create_type_titre(db_session, "Obligation")
    crud.create_regle_import_placement(
        db_session,
        nom="Achats",
        conditions=_condition_type_contient("ACHAT"),
        type_placement="achat",
        type_titre_id=obligation.id,
    )
    contenu = _fichier_operations(
        [_ligne_achat(type="ACHAT COMPTANT", type_titre="ETF")], avec_type_titre=True
    )
    _confirmer(db_session, preset, contenu)
    assert crud.get_action_by_nom(db_session, "MSCI World").type_titre_id == obligation.id


def test_une_regle_de_transfert_ne_pose_aucun_type(db_session):
    """Un transfert d'espèces ne désigne aucun titre : il n'y a rien à typer, et
    le routeur neutralise le champ plutôt que de le refuser."""
    etf = crud.create_type_titre(db_session, "ETF")
    courant = creer_compte(db_session, "Courant")
    creee = routeur_regles.create_regle(
        schemas.RegleImportPlacementCreate(
            nom="Versements",
            conditions=_condition_type_contient("VERSEMENT"),
            type_placement="transfert",
            compte_autre_id=courant.id,
            type_titre_id=etf.id,
        ),
        db_session,
    )
    assert creee.type_titre_id is None
