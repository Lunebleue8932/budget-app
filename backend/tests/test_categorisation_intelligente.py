"""Le classement intelligent des catégories bancaires (migration 0085).

CE QUE CES TESTS VERROUILLENT :

  - LA NORMALISATION : minuscules, sans accents ni ponctuation ;
  - LES TROIS DÉCISIONS : une proposition « forte » (présélectionnée), des « suggestions » (jusqu'à
    trois) ou « à classer » ; deux catégories qui se disputent au-dessus du seuil haut ne
    présélectionnent rien ;
  - LES MOTS-CLÉS : ceux de l'utilisateur REMPLACENT les livrés en entier (une liste vide aussi),
    None revient aux livrés ;
  - JAMAIS D'APPLICATION SILENCIEUSE : l'aperçu présélectionne la catégorie d'une proposition forte
    mais laisse la ligne « à confirmer », et n'écrit rien dans la table des correspondances ;
  - UNE CORRESPONDANCE DÉJÀ MÉMORISÉE PASSE AVANT toute proposition (palier 1) ;
  - UN SALAIRE NE RANGE PAS UNE DÉPENSE dans une catégorie d'entrée.
"""
import io
from datetime import date

import openpyxl
import pytest

from app import crud, models
from app.constants import COLONNES_IMPORT_PAR_DEFAUT
from app.services import categorisation_intelligente as ci
from app.services import import_bancaire

from .conftest import get_categorie_id


def test_normaliser_retire_accents_ponctuation_et_casse():
    assert ci.normaliser("  Alimentation & Restauration !! ") == "alimentation restauration"
    assert ci.normaliser("Santé / Bien-être") == "sante bien etre"
    assert ci.normaliser(None) == ""


def test_un_libelle_proche_d_un_alias_est_une_proposition_forte(db_session):
    resultat = ci.proposer(db_session, "Supermarchés / Bouche")
    assert resultat["statut"] == "forte"
    assert resultat["propositions"][0]["nom"] == "Alimentaire"
    assert resultat["propositions"][0]["via"].startswith("supermarch")


def test_les_trois_langues_se_reconnaissent(db_session):
    for libelle in ("Groceries", "Mercado", "Boulangerie"):
        assert ci.proposer(db_session, libelle)["propositions"][0]["nom"] == "Alimentaire"


def test_un_libelle_sans_rapport_est_a_classer(db_session):
    assert ci.proposer(db_session, "Xyzzy qwerty")["statut"] == "a_classer"
    assert ci.proposer(db_session, "")["statut"] == "a_classer"


def test_un_libelle_approximatif_donne_des_suggestions_sans_presélection(db_session):
    resultat = ci.proposer(db_session, "Supermrche")
    assert resultat["statut"] in ("suggestions", "forte")
    assert resultat["propositions"][0]["nom"] == "Alimentaire"
    assert len(resultat["propositions"]) <= ci.NB_SUGGESTIONS


def test_les_mots_cles_de_l_utilisateur_remplacent_les_livres(db_session):
    alimentaire = db_session.get(models.Categorie, get_categorie_id(db_session, "Alimentaire"))
    crud.set_categorie_mots_cles(db_session, alimentaire, ["Epicerie fine", "  ", "epicerie FINE"])
    assert alimentaire.mots_cles == ["Epicerie fine"]
    assert alimentaire.mots_cles_personnalises is True
    # Les livrés ne comptent plus : « boulangerie » ne mène plus à Alimentaire.
    assert ci.proposer(db_session, "Boulangerie")["statut"] == "a_classer"
    assert ci.proposer(db_session, "Epicerie fine")["propositions"][0]["nom"] == "Alimentaire"
    crud.set_categorie_mots_cles(db_session, alimentaire, None)
    assert alimentaire.mots_cles_personnalises is False
    assert "boulangerie" in alimentaire.mots_cles


def test_une_liste_vide_est_un_choix(db_session):
    alimentaire = db_session.get(models.Categorie, get_categorie_id(db_session, "Alimentaire"))
    crud.set_categorie_mots_cles(db_session, alimentaire, [])
    assert alimentaire.mots_cles == []
    assert alimentaire.mots_cles_personnalises is True


def test_une_categorie_eteinte_n_est_jamais_proposee(db_session):
    alimentaire = db_session.get(models.Categorie, get_categorie_id(db_session, "Alimentaire"))
    alimentaire.active = False
    db_session.commit()
    resultat = ci.proposer(db_session, "Supermarché")
    assert all(p["nom"] != "Alimentaire" for p in resultat["propositions"])


# ---------- Dans l'aperçu d'import ----------


def _fichier(lignes):
    classeur = openpyxl.Workbook()
    feuille = classeur.active
    feuille.append([f"Colonne {i}" for i in range(1, 13)])
    for ligne in lignes:
        row = [None] * 12
        row[0], row[3], row[5], row[6], row[9] = (
            ligne["date"], ligne["nature"], ligne["categorie"], ligne["montant"], "CC",
        )
        feuille.append(row)
    tampon = io.BytesIO()
    classeur.save(tampon)
    return tampon.getvalue()


def _preset(db):
    from .conftest import creer_compte

    compte = creer_compte(db, "CC")
    preset = crud.create_import_preset(db, "Banque", COLONNES_IMPORT_PAR_DEFAUT, [], lignes_entete=1)
    crud.set_mapping_compte(db, preset.id, "CC", compte.id)
    return preset


def test_l_apercu_preselectionne_une_proposition_forte_sans_rien_ecrire(db_session):
    preset = _preset(db_session)
    apercu = import_bancaire.previsualiser(
        db_session,
        preset.id,
        _fichier([{"date": date(2026, 7, 1), "nature": "Carrefour", "categorie": "Supermarchés", "montant": -45.0}]),
    )
    alimentaire = get_categorie_id(db_session, "Alimentaire")
    ligne = apercu.lignes[0]
    assert ligne.categorie_id == alimentaire
    # Présélectionnée, PAS appliquée : la ligne reste à confirmer.
    assert ligne.categorie_suggestion_auto is True
    assert apercu.categories_inconnues == ["Supermarchés"]
    assert apercu.propositions_categories["Supermarchés"].statut == "forte"
    # Et rien n'a été écrit dans la table des correspondances.
    assert crud.get_mapping_categorie(db_session, preset.id, "Supermarchés") is None


def test_une_correspondance_memorisee_passe_avant_la_proposition(db_session):
    preset = _preset(db_session)
    autres = get_categorie_id(db_session, "Autres")
    crud.set_mapping_categorie(db_session, preset.id, "Supermarchés", autres)
    apercu = import_bancaire.previsualiser(
        db_session,
        preset.id,
        _fichier([{"date": date(2026, 7, 1), "nature": "Carrefour", "categorie": "Supermarchés", "montant": -45.0}]),
    )
    assert apercu.lignes[0].categorie_id == autres
    assert apercu.categories_inconnues == []
    assert apercu.propositions_categories == {}


def test_un_libelle_sans_rapport_reste_au_repli_autres(db_session):
    preset = _preset(db_session)
    apercu = import_bancaire.previsualiser(
        db_session,
        preset.id,
        _fichier([{"date": date(2026, 7, 1), "nature": "Truc", "categorie": "Xyzzy", "montant": -5.0}]),
    )
    assert apercu.lignes[0].categorie_id == get_categorie_id(db_session, "Autres")
    assert apercu.propositions_categories["Xyzzy"].statut == "a_classer"


def test_un_salaire_ne_range_pas_une_depense_dans_une_categorie_d_entree(db_session):
    preset = _preset(db_session)
    apercu = import_bancaire.previsualiser(
        db_session,
        preset.id,
        _fichier([{"date": date(2026, 7, 1), "nature": "Remboursement erreur", "categorie": "Salaire", "montant": -20.0}]),
    )
    assert apercu.lignes[0].categorie_id != get_categorie_id(db_session, "Entrées d'argent")
