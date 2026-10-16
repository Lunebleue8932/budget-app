"""L'export des données et les copies de sécurité (services/export_donnees, services/sauvegardes).

CE QUE CES TESTS VERROUILLENT :

  - L'EXPORT PORTE TOUTES LES TABLES, dans les trois formats, avec leurs colonnes ;
  - LE CSV EST UNE ARCHIVE À UN FICHIER PAR TABLE, le classeur UNE FEUILLE PAR TABLE (noms valides
    et uniques) ;
  - UNE COPIE EST UNE BASE COMPLÈTE ET LISIBLE, et les plus anciennes sont purgées — SANS toucher
    un fichier qui n'est pas de nous ;
  - LE DOSSIER DOIT ÊTRE ABSOLU, ÉCRIVABLE, ET HORS DU DOSSIER DE L'APPLICATION ;
  - LA COPIE AUTOMATIQUE N'EST FAITE QUE SI LA DERNIÈRE EST ANCIENNE, et ne lève jamais ;
  - LE DOSSIER SE RETIENT DANS LA CONFIGURATION DU POSTE, sous une clé à part en mode développement.
"""
import io
import json
import sqlite3
import zipfile
from datetime import datetime, timedelta

import openpyxl
import pytest

from app import config_utilisateur, crud, database, models
from app.services import export_donnees, sauvegardes

from .conftest import creer_compte


# ---------- L'export ----------


def test_l_export_json_porte_toutes_les_tables(db_session):
    creer_compte(db_session, "Courant")
    contenu = json.loads(export_donnees.en_json(db_session, "0085"))
    assert contenu["format"] == "budget-app-export"
    assert contenu["revision_base"] == "0085"
    assert set(contenu["tables"]) >= {"compte", "operation", "categorie", "monnaie"}
    comptes = contenu["tables"]["compte"]
    assert "nom" in comptes["colonnes"]
    assert any(ligne[comptes["colonnes"].index("nom")] == "Courant" for ligne in comptes["lignes"])


def test_le_csv_est_une_archive_a_un_fichier_par_table(db_session):
    creer_compte(db_session, "Courant")
    archive = zipfile.ZipFile(io.BytesIO(export_donnees.en_csv_zip(db_session)))
    noms = set(archive.namelist())
    assert "compte.csv" in noms and "categorie.csv" in noms
    texte = archive.read("compte.csv").decode("utf-8-sig")
    assert texte.splitlines()[0].startswith("id;")
    assert "Courant" in texte


def test_le_classeur_a_une_feuille_par_table_aux_noms_valides_et_uniques(db_session):
    creer_compte(db_session, "Courant")
    classeur = openpyxl.load_workbook(io.BytesIO(export_donnees.en_xlsx(db_session)))
    feuilles = classeur.sheetnames
    assert len(feuilles) == len(set(f.lower() for f in feuilles))
    assert all(len(f) <= 31 for f in feuilles)
    assert "compte" in feuilles
    ligne_titres = [c.value for c in classeur["compte"][1]]
    assert "nom" in ligne_titres


def test_les_noms_de_feuille_longs_restent_uniques():
    pris: set = set()
    a = export_donnees._nom_de_feuille("a" * 40, pris)
    b = export_donnees._nom_de_feuille("a" * 40, pris)
    assert len(a) == len(b) == 31 and a != b


def test_un_format_inconnu_est_refuse(db_session):
    with pytest.raises(ValueError):
        export_donnees.exporter(db_session, "pdf")


# ---------- Les copies ----------


@pytest.fixture()
def base_source(tmp_path):
    chemin = tmp_path / "source.db"
    connexion = sqlite3.connect(chemin)
    connexion.execute("CREATE TABLE t (id INTEGER PRIMARY KEY, v TEXT)")
    connexion.executemany("INSERT INTO t (v) VALUES (?)", [("a",), ("b",)])
    connexion.commit()
    connexion.close()
    return chemin


def test_une_copie_est_une_base_complete_et_lisible(base_source, tmp_path):
    cible = sauvegardes.sauvegarder(tmp_path / "copies", base_source, datetime(2026, 10, 16, 12, 30, 5))
    assert cible.name == "budget-2026-10-16_123005.db"
    lignes = sqlite3.connect(cible).execute("SELECT v FROM t ORDER BY id").fetchall()
    assert lignes == [("a",), ("b",)]


def test_la_purge_garde_les_plus_recentes_et_epargne_les_fichiers_etrangers(base_source, tmp_path):
    dossier = tmp_path / "copies"
    dossier.mkdir()
    (dossier / "mes-notes.txt").write_text("à moi")
    (dossier / "budget-ancien.db").write_text("pas de notre forme")
    depart = datetime(2026, 1, 1, 8, 0, 0)
    for i in range(sauvegardes.GARDER + 5):
        sauvegardes.sauvegarder(dossier, base_source, depart + timedelta(days=i))
    copies = sauvegardes._copies(dossier)
    assert len(copies) == sauvegardes.GARDER
    # Les plus récentes restent.
    assert copies[0][0] == depart + timedelta(days=sauvegardes.GARDER + 4)
    assert (dossier / "mes-notes.txt").exists() and (dossier / "budget-ancien.db").exists()


def test_une_base_introuvable_est_une_erreur_lisible(tmp_path):
    with pytest.raises(sauvegardes.ErreurSauvegarde):
        sauvegardes.sauvegarder(tmp_path / "copies", tmp_path / "absente.db")


def test_le_dossier_doit_etre_absolu_et_ecrivable(tmp_path):
    with pytest.raises(sauvegardes.ErreurSauvegarde):
        sauvegardes.verifier_dossier("relatif/dossier")
    with pytest.raises(sauvegardes.ErreurSauvegarde):
        sauvegardes.verifier_dossier("   ")
    bon = sauvegardes.verifier_dossier(str(tmp_path / "neuf" / "sous"))
    assert bon.is_dir()


def test_le_dossier_de_l_application_est_refuse(monkeypatch, tmp_path):
    monkeypatch.setattr(database, "chemin_a_risque", lambda chemin: True)
    with pytest.raises(sauvegardes.ErreurSauvegarde):
        sauvegardes.verifier_dossier(str(tmp_path / "x"))


def test_une_copie_n_est_due_que_si_la_derniere_est_ancienne(base_source, tmp_path):
    dossier = tmp_path / "copies"
    assert sauvegardes.est_due(dossier) is True
    maintenant = datetime(2026, 10, 16, 12, 0, 0)
    sauvegardes.sauvegarder(dossier, base_source, maintenant)
    assert sauvegardes.est_due(dossier, maintenant + timedelta(hours=2)) is False
    assert sauvegardes.est_due(dossier, maintenant + timedelta(hours=21)) is True


# ---------- La configuration du poste ----------


def test_le_dossier_se_retient_sous_une_cle_a_part_en_developpement(monkeypatch, tmp_path):
    monkeypatch.setenv("BUDGET_CONFIG_DIR", str(tmp_path / "profil"))
    assert config_utilisateur.dossier_sauvegarde() is None
    assert config_utilisateur.memoriser_dossier_sauvegarde(tmp_path / "copies", dev=True)
    assert config_utilisateur.dossier_sauvegarde(dev=True) == tmp_path / "copies"
    # La clé de la version publiée n'a pas bougé.
    assert config_utilisateur.dossier_sauvegarde(dev=False) is None
    assert config_utilisateur.memoriser_dossier_sauvegarde(None, dev=True)
    assert config_utilisateur.dossier_sauvegarde(dev=True) is None


def test_la_passe_automatique_ne_leve_jamais(monkeypatch):
    def casse():
        raise RuntimeError("disque débranché")

    monkeypatch.setattr(sauvegardes, "dossier_configure", casse)
    assert sauvegardes.sauvegarder_si_due() is None


def test_la_passe_automatique_fait_une_copie_quand_elle_est_due(monkeypatch, base_source, tmp_path):
    dossier = tmp_path / "copies"
    monkeypatch.setattr(sauvegardes, "dossier_configure", lambda: dossier)
    monkeypatch.setattr(database, "get_chemin_actuel", lambda: base_source)
    monkeypatch.setattr(database, "en_decouverte", lambda: False)
    premiere = sauvegardes.sauvegarder_si_due()
    assert premiere is not None and premiere.exists()
    # Une seconde passe aussitôt : rien à refaire.
    assert sauvegardes.sauvegarder_si_due() is None
