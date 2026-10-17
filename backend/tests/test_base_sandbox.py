"""La sandbox : une démo remplie de données fictives, persistante, jamais mélangée à la vraie base.

Ce que ces tests verrouillent : (1) la démo est riche et cohérente, et suit le jour où on la
fabrique ; (2) CHAQUE TABLE du schéma y a des données, ou une exemption écrite ici — c'est ce qui
oblige à faire apprendre la démo à chaque fonctionnalité nouvelle ; (3) entrer puis sortir rend
EXACTEMENT la vraie base, sans qu'elle soit écrite ni mémorisée ; (4) ce qu'on saisit dans la démo
survit à la sortie, jusqu'à la réinitialisation."""
import hashlib
from datetime import date, timedelta
from pathlib import Path

import pytest
from fastapi import HTTPException
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker

from app import config_utilisateur, crud, database, models, schemas
from app.database import Base
from app.routers import parametres_base, sandbox, tutoriel
from app.services import base_decouverte, base_sandbox

AUJOURDHUI = date(2026, 10, 15)
RELEVE_EXEMPLE = Path(__file__).resolve().parents[2] / "frontend" / "exemples" / "releve-exemple.csv"

# Les tables qui n'ont PAS de données dans la démo, et pourquoi. Une table absente d'ici et vide
# fait échouer le test : il faut l'ajouter à la démo (puis incrémenter base_sandbox.VERSION), ou la
# justifier ici.
TABLES_SANS_DONNEES = {
    # Ce qu'un import écrit lui-même : historique, lignes brutes, correspondances apprises.
    "import_historique": "écrit par un import",
    "ligne_import_brute": "écrit par un import",
    "import_categorie_mapping": "apprise par un import",
    "import_compte_mapping": "apprise par un import",
    "import_monnaie_mapping": "apprise par un import",
    "colonne_dummy": "table technique des presets",
    "import_preset_colonne_dummy": "table technique des presets",
    # Extensions qui demandent une saisie propre à chacun.
    "regle_import_placement": "règles d'import de titres : dépendent des relevés de l'utilisateur",
    "declaration_impots": "montants déclarés : propres à chaque foyer",
    "regle_decoupe": "parts d'une règle : posées avec une règle de découpe, pas dans la démo",
}


@pytest.fixture()
def profil(tmp_path, monkeypatch):
    """Un profil neuf, détourné : la démo s'y range, la vraie configuration n'est jamais lue."""
    dossier = tmp_path / "profil"
    monkeypatch.setenv("BUDGET_CONFIG_DIR", str(dossier))
    return dossier


@pytest.fixture()
def vraie_base(tmp_path, profil):
    """Une base « de l'utilisateur », vide, sur laquelle l'application est basculée le temps du
    test. Le fichier est suivi pour montrer qu'aucun passage par la démo ne l'écrit."""
    base = tmp_path / "ma-base.db"
    database.creer_base_neuve(base)
    depart = database.get_chemin_actuel()
    database.changer_base(str(base))
    try:
        yield base
    finally:
        if database.en_sandbox():
            database.quitter_sandbox()
        database.changer_base(str(depart))


def _empreinte(chemin):
    return hashlib.sha256(chemin.read_bytes()).hexdigest()


def _lire(chemin, requete):
    moteur = create_engine(f"sqlite:///{chemin.as_posix()}")
    try:
        with sessionmaker(bind=moteur)() as db:
            return requete(db)
    finally:
        moteur.dispose()


@pytest.fixture(scope="module")
def demo_fr(tmp_path_factory):
    """La démo en français, fabriquée une seule fois pour les tests de contenu (80 migrations)."""
    chemin = tmp_path_factory.mktemp("demo") / "demo.db"
    return base_sandbox.fabriquer(chemin, AUJOURDHUI, "fr")


# ---------- Le contenu ----------


def test_la_demo_contient_de_quoi_montrer_l_application(demo_fr):
    def contenu(db):
        return {
            "comptes": {c.nom: c.type_nom for c in db.query(models.Compte).all()},
            "monnaies": {m.nom for m in db.query(models.Monnaie).all()},
            "operations": db.query(models.Operation).count(),
            "mois": {
                (o.date.year, o.date.month)
                for o in db.query(models.Operation).filter(models.Operation.statut == "réel")
            },
            "virements": db.query(models.Operation)
            .filter(models.Operation.virement_id.isnot(None))
            .count(),
            "decoupees": db.query(models.OperationDecoupe).count(),
            "amorties": db.query(models.Operation).filter(models.Operation.amorti.is_(True)).count(),
            "imprevues": db.query(models.Operation).filter(models.Operation.imprevue.is_(True)).count(),
            "mois_imprevues": len(
                {
                    (o.date.year, o.date.month)
                    for o in db.query(models.Operation).filter(models.Operation.imprevue.is_(True))
                }
            ),
            "projet_epingle": db.query(models.SousFiltre).one().visible_dashboard,
            "objectifs_sur_projet": db.query(models.ObjectifKpi)
            .filter(models.ObjectifKpi.sous_filtre_id.isnot(None))
            .count(),
            "remboursables": db.query(models.Operation)
            .join(models.TypeOperationDB)
            .filter(models.TypeOperationDB.code == "remboursable")
            .count(),
            "liens": db.query(models.RemboursementLien).count(),
            "previsionnelles": db.query(models.Operation)
            .filter(models.Operation.statut == "prévisionnel")
            .count(),
            "recurrentes": db.query(models.Operation)
            .filter(models.Operation.recurrente.is_(True))
            .count(),
            "projets": db.query(models.SousFiltre).count(),
            "dans_projet": db.execute(text("SELECT COUNT(*) FROM operation_sous_filtre")).scalar(),
            "objectifs": db.query(models.ObjectifKpi).count(),
            "titres": db.query(models.TitrePossede).count(),
            "mouvements": db.query(models.OperationTitre).count(),
            "plus_recente_reelle": max(
                o.date for o in db.query(models.Operation).filter(models.Operation.statut == "réel")
            ),
        }

    lu = _lire(demo_fr, contenu)
    assert set(lu["comptes"].values()) == {"courant", "épargne", "placements financiers"}
    assert len(lu["monnaies"]) == 2
    assert lu["operations"] > 150
    # Treize mois de réel, du plus ancien au mois en cours : de quoi comparer deux mois.
    assert len(lu["mois"]) == 13
    assert lu["virements"] >= 30
    assert lu["decoupees"] == 2 and lu["amorties"] == 1
    # Des imprévues sur presque tous les mois : de quoi tirer une moyenne.
    assert lu["imprevues"] >= 10 and lu["mois_imprevues"] >= 10
    assert lu["remboursables"] == 2 and lu["liens"] == 1
    assert lu["previsionnelles"] >= 5 and lu["recurrentes"] >= 4
    assert lu["projets"] == 1 and lu["dans_projet"] >= 8
    # Les objectifs disent ce qui se RÉPÈTE ; le voyage, qui n'a lieu qu'une fois, est un projet
    # (épinglé au dashboard), pas un objectif.
    assert lu["objectifs"] == 2 and lu["objectifs_sur_projet"] == 0
    assert lu["projet_epingle"] is True
    # Trois titres détenus (deux ETF, une action) et dix-huit composants suivis, jamais détenus : leurs
    # poids laissent environ 20 % de « non déterminé » sur la carte titre par titre.
    assert lu["titres"] == 21 and lu["mouvements"] == 5
    # Rien de « réel » n'a lieu après le jour de fabrication.
    assert lu["plus_recente_reelle"] <= AUJOURDHUI


def test_chaque_table_du_schema_a_des_donnees_ou_une_exemption(demo_fr):
    """LE GARDE-FOU DE LA MISE À JOUR : une table de plus dans models.py, sans données dans la démo
    ni exemption ici, fait échouer ce test."""
    vides = _lire(
        demo_fr,
        lambda db: sorted(
            table.name
            for table in Base.metadata.sorted_tables
            if db.execute(text(f'SELECT COUNT(*) FROM "{table.name}"')).scalar() == 0
        ),
    )
    non_justifiees = [nom for nom in vides if nom not in TABLES_SANS_DONNEES]
    assert non_justifiees == [], (
        "Ces tables sont vides dans la démo : leur donner des données dans "
        "services/base_sandbox.py (puis incrémenter VERSION), ou les justifier dans "
        f"TABLES_SANS_DONNEES : {non_justifiees}"
    )
    # Et une exemption devenue inutile se retire : la liste ne doit pas devenir un fourre-tout.
    inutiles = [nom for nom in TABLES_SANS_DONNEES if nom not in vides]
    assert inutiles == []


def test_les_trois_grandeurs_du_budget_s_accordent(demo_fr):
    """Sans quoi la fenêtre « les budgets ne s'accordent pas » s'ouvrirait dès la première visite."""

    def incoherences(db):
        euro = crud.get_monnaies(db)[0]
        resultats = [
            crud.incoherences_budgets(db, AUJOURDHUI.year, AUJOURDHUI.month, euro.id),
            crud.incoherences_budgets(db, AUJOURDHUI.year - 1, 11, euro.id),
        ]
        return [r["lignes"] for r in resultats], [r["budget_total"] for r in resultats]

    lignes, totaux = _lire(demo_fr, incoherences)
    assert lignes == [[], []]
    assert totaux == [base_sandbox.BUDGET_TOTAL] * 2


def test_les_recurrences_engendrent_les_mois_suivants(demo_fr):
    def previsions(db):
        crud.generer_occurrences_recurrentes(db)
        return db.query(models.Operation).filter(models.Operation.statut == "prévisionnel").count()

    assert _lire(demo_fr, previsions) > 40


def test_les_libelles_suivent_la_langue_demandee(tmp_path):
    chemin = base_sandbox.fabriquer(tmp_path / "en.db", AUJOURDHUI, "en")
    noms = _lire(chemin, lambda db: {c.nom for c in db.query(models.Compte).all()})
    assert noms == {"Checking account", "Savings account", "Brokerage account", "Travel card"}


def test_la_demo_est_marquee_de_sa_version(demo_fr):
    marque = _lire(demo_fr, lambda db: crud.get_preference_interface(db, base_sandbox.CLE_PREFERENCE))
    assert marque == {"version": base_sandbox.VERSION, "cree_le": "2026-10-15", "langue": "fr"}


def test_une_demo_ancienne_ou_d_une_autre_version_est_proposee_au_rafraichissement(demo_fr):
    def lire(aujourdhui):
        return _lire(demo_fr, lambda db: base_sandbox.etat(db, aujourdhui))

    assert lire(AUJOURDHUI)["a_rafraichir"] is False
    vieille = lire(AUJOURDHUI + timedelta(days=base_sandbox.JOURS_AVANT_RAFRAICHIR + 1))
    assert vieille["a_rafraichir"] and vieille["raison"] == "donnees_anciennes"

    def ancienne_version(db):
        crud.set_preference_interface(
            db, base_sandbox.CLE_PREFERENCE, {"version": 0, "cree_le": "2026-10-15"}
        )
        return base_sandbox.etat(db, AUJOURDHUI)

    perimee = _lire(demo_fr, ancienne_version)
    assert perimee["a_rafraichir"] and perimee["raison"] == "nouvelle_version"


def test_le_preset_de_la_demo_lit_le_releve_d_exemple(demo_fr):
    from app.services import import_bancaire

    def apercu(db):
        preset = db.query(models.ImportPreset).filter(models.ImportPreset.domaine == "bancaire").one()
        return import_bancaire.previsualiser(db, preset.id, RELEVE_EXEMPLE.read_bytes())

    lignes = _lire(demo_fr, apercu).lignes
    assert len(lignes) == 14 and [l.erreur for l in lignes if l.erreur] == []


# ---------- Entrer, sortir, retrouver ----------


def test_entrer_puis_quitter_rend_la_vraie_base_sans_l_ecrire(vraie_base, monkeypatch):
    avant = _empreinte(vraie_base)
    ecrit = []
    monkeypatch.setattr(config_utilisateur, "ecrire", lambda **kw: ecrit.append(kw) or True)

    assert not database.en_sandbox()
    etat = sandbox.entrer_sandbox("fr")
    assert etat["actif"] and etat["a_rafraichir"] is False and etat["recreee"] is False
    assert database.en_sandbox()
    assert database.get_chemin_actuel() == base_sandbox.chemin_sandbox().resolve()
    with database._etat.SessionLocal() as db:
        assert db.query(models.Compte).count() == 4
    # Rejouer l'entrée ne refabrique rien.
    assert sandbox.entrer_sandbox("fr")["actif"]

    assert sandbox.quitter_sandbox() == {"actif": False}
    assert database.get_chemin_actuel() == vraie_base.resolve()
    with database._etat.SessionLocal() as db:
        assert db.query(models.Compte).count() == 0
    # JAMAIS DE MÉMORISATION, et la vraie base n'a pas bougé d'un octet.
    assert ecrit == []
    assert _empreinte(vraie_base) == avant


def test_la_demo_est_rangee_dans_le_profil_jamais_a_cote_de_la_base(vraie_base, profil):
    sandbox.entrer_sandbox("fr")
    chemin = database.get_chemin_actuel()
    assert chemin.parent.parent == profil.resolve()
    assert chemin.parent != vraie_base.parent


def test_ce_qu_on_saisit_dans_la_demo_survit_a_la_sortie(vraie_base):
    sandbox.entrer_sandbox("fr")
    with database._etat.SessionLocal() as db:
        euro = crud.get_monnaies(db)[0]
        compte = db.query(models.Compte).first()
        type_classique = crud.get_type_operation_par_code(db, "classique")
        avant = db.query(models.Operation).count()
        crud.create_operation(
            db,
            schemas.OperationCreate(
                date=AUJOURDHUI,
                compte_id=compte.id,
                monnaie_id=euro.id,
                type_id=type_classique.id,
                categorie_id=None,
                nature="Ma saisie dans la démo",
                montant=12.0,
                statut="réel",
            ),
        )
    sandbox.quitter_sandbox()
    sandbox.entrer_sandbox("fr")
    with database._etat.SessionLocal() as db:
        assert db.query(models.Operation).count() == avant + 1
        assert (
            db.query(models.Operation).filter(models.Operation.nature == "Ma saisie dans la démo").count()
            == 1
        )


def test_reinitialiser_refait_la_demo_et_efface_les_saisies(vraie_base):
    sandbox.entrer_sandbox("fr")
    with database._etat.SessionLocal() as db:
        avant = db.query(models.Operation).count()
        db.query(models.Operation).delete()
        db.commit()
        assert db.query(models.Operation).count() == 0
    etat = sandbox.reinitialiser_sandbox("en")
    assert etat["actif"] and database.en_sandbox()
    with database._etat.SessionLocal() as db:
        assert db.query(models.Operation).count() >= avant - 5
        assert "Checking account" in {c.nom for c in db.query(models.Compte).all()}


def test_reinitialiser_hors_demo_est_refuse(vraie_base):
    with pytest.raises(HTTPException) as erreur:
        sandbox.reinitialiser_sandbox("fr")
    assert erreur.value.status_code == 409


def test_un_fichier_de_demo_illisible_est_refait(vraie_base):
    chemin = base_sandbox.chemin_sandbox()
    chemin.parent.mkdir(parents=True, exist_ok=True)
    chemin.write_bytes(b"ceci n'est pas une base SQLite")
    etat = sandbox.entrer_sandbox("fr")
    assert etat["actif"] and etat["recreee"] is True
    with database._etat.SessionLocal() as db:
        assert db.query(models.Compte).count() == 4


def test_fermer_l_application_en_pleine_demo_n_a_rien_memorise(vraie_base):
    """Le chemin que `_resoudre_chemin_demarrage` lirait au prochain lancement est celui du profil :
    la démo n'y a rien écrit."""
    sandbox.entrer_sandbox("fr")
    assert config_utilisateur.chemin_base_memorise() is None
    assert config_utilisateur.chemin_base_memorise(dev=True) is None


# ---------- Les gardes ----------


def test_pendant_la_demo_on_ne_change_pas_de_base(vraie_base, tmp_path):
    sandbox.entrer_sandbox("fr")
    for appel in (
        lambda: parametres_base.set_base(schemas.BaseDonneesUpdate(chemin=str(vraie_base))),
        lambda: parametres_base.installer_base(
            schemas.BaseDonneesInstaller(chemin=str(tmp_path / "x.db"), deplacer_actuelle=True)
        ),
        lambda: parametres_base.reinitialiser_base(),
    ):
        with pytest.raises(HTTPException) as erreur:
            appel()
        assert erreur.value.status_code in (403, 409)
    assert database.en_sandbox()


def test_la_demo_n_est_jamais_copiee_dans_le_dossier_des_sauvegardes(vraie_base, tmp_path, monkeypatch):
    from app.routers import sauvegardes as routeur_sauvegardes
    from app.services import sauvegardes

    dossier = tmp_path / "copies"
    dossier.mkdir()
    monkeypatch.setattr(sauvegardes, "dossier_configure", lambda: dossier)
    sandbox.entrer_sandbox("fr")
    assert sauvegardes.sauvegarder_si_due() is None
    with pytest.raises(HTTPException) as erreur:
        routeur_sauvegardes.sauvegarder_maintenant()
    assert erreur.value.status_code == 409
    assert list(dossier.iterdir()) == []


def test_la_demo_et_les_tutoriels_ne_s_empilent_pas(vraie_base, tmp_path, monkeypatch):
    monkeypatch.setattr(base_decouverte, "chemin_decouverte", lambda: tmp_path / "decouverte.db")
    # Du tutoriel vers la démo.
    tutoriel.entrer_decouverte()
    with pytest.raises(HTTPException) as erreur:
        sandbox.entrer_sandbox("fr")
    assert erreur.value.status_code == 409
    assert database.en_decouverte() and not database.en_sandbox()
    tutoriel.quitter_decouverte()
    # De la démo vers le tutoriel.
    sandbox.entrer_sandbox("fr")
    with pytest.raises(HTTPException) as erreur:
        tutoriel.entrer_decouverte()
    assert erreur.value.status_code == 409
    assert database.en_sandbox() and not database.en_decouverte()
    with pytest.raises(ValueError):
        database.entrer_decouverte(tmp_path / "decouverte.db")


def test_changer_de_base_pendant_la_demo_la_termine(vraie_base, tmp_path):
    autre = tmp_path / "autre.db"
    database.creer_base_neuve(autre)
    sandbox.entrer_sandbox("fr")
    database.changer_base(str(autre))
    assert not database.en_sandbox()
    # Quitter ne ramène alors nulle part : on reste où l'on est.
    sandbox.quitter_sandbox()
    assert database.get_chemin_actuel() == autre.resolve()


def test_la_demo_ne_demande_pas_de_choisir_ou_ranger_la_base(vraie_base):
    sandbox.entrer_sandbox("fr")
    assert database.configuration_requise() is False


def test_une_installation_de_mise_au_point_a_son_propre_dossier_de_demo(profil, monkeypatch):
    monkeypatch.setattr(database, "mode_developpement", lambda: True)
    assert base_sandbox.dossier_sandbox() == profil / "sandbox-dev"
    monkeypatch.setattr(database, "mode_developpement", lambda: False)
    assert base_sandbox.dossier_sandbox() == profil / "sandbox"


# ---------- Les extensions : allumées dans la démo, sans toucher à celles de l'utilisateur ----------


def test_la_demo_allume_les_extensions_sauf_lecture_de_cours(demo_fr):
    from app import extensions

    lignes = _lire(
        demo_fr, lambda db: {e.extension_id: e.active for e in db.query(models.ExtensionEtat).all()}
    )
    presentes = {
        i for i, e in extensions.decouvrir().items() if e.type != extensions.TYPE_DEVELOPPEUR
    }
    assert presentes <= set(lignes)
    assert lignes["lecture-de-cours"] is False
    assert all(actif for identifiant, actif in lignes.items() if identifiant != "lecture-de-cours")
    # Les extensions de développement ne sont pas une démo.
    assert not {i for i, e in extensions.decouvrir().items() if e.type == extensions.TYPE_DEVELOPPEUR} & set(
        lignes
    )


@pytest.mark.extensions_reelles
@pytest.mark.etat_en_base
def test_dans_la_demo_les_extensions_tournent_et_celles_de_l_utilisateur_ne_bougent_pas(
    vraie_base, tmp_path, monkeypatch
):
    import json

    from app import extensions

    fichier = tmp_path / "extensions.json"
    fichier.write_text(
        json.dumps({"actives": {"placements": False}, "annoncees": []}), encoding="utf-8"
    )
    monkeypatch.setattr(extensions, "_fichier_etat", lambda: fichier)
    extensions.decouvrir()

    # Chez l'utilisateur : ce que dit le fichier d'installation (pas de ligne en base).
    assert extensions.est_active("placements") is False

    sandbox.entrer_sandbox("fr")
    assert extensions.est_active("placements") is True
    assert extensions.est_active("analyse-budget") is True
    assert extensions.est_active("lecture-de-cours") is False
    # Éteindre une extension dans la démo l'éteint dans la démo seulement.
    extensions.definir_active("analyse-budget", False)
    assert extensions.est_active("analyse-budget") is False
    # Rien n'est annoncé dans la démo, et rien n'est écrit dans le fichier d'installation.
    assert extensions.est_annoncee("placements") is True
    extensions.marquer_annoncees(["placements"])

    sandbox.quitter_sandbox()
    assert json.loads(fichier.read_text(encoding="utf-8")) == {"actives": {"placements": False}, "annoncees": []}
    assert extensions.est_active("placements") is False
    assert extensions.est_active("analyse-budget") is False  # le fichier ne la connaît pas


@pytest.mark.extensions_reelles
@pytest.mark.etat_en_base
def test_une_decision_en_base_prime_sur_le_fichier_et_ne_l_ecrit_pas(vraie_base, tmp_path, monkeypatch):
    import json

    from app import extensions

    fichier = tmp_path / "extensions.json"
    fichier.write_text(json.dumps({"actives": {"placements": True}}), encoding="utf-8")
    monkeypatch.setattr(extensions, "_fichier_etat", lambda: fichier)
    extensions.decouvrir()
    assert extensions.est_active("placements") is True  # pas de ligne : le fichier

    extensions.definir_active("placements", False)
    assert extensions.est_active("placements") is False  # la ligne décide
    with database._etat.SessionLocal() as db:
        assert db.get(models.ExtensionEtat, "placements").active is False
    assert json.loads(fichier.read_text(encoding="utf-8")) == {"actives": {"placements": True}}


@pytest.mark.extensions_reelles
@pytest.mark.etat_en_base
def test_une_base_sans_la_table_retombe_sur_le_fichier(vraie_base, tmp_path, monkeypatch):
    """Une base d'avant la migration 0089 continue de servir, exactement comme avant."""
    import json

    from app import extensions

    fichier = tmp_path / "extensions.json"
    fichier.write_text(json.dumps({"actives": {"placements": True}}), encoding="utf-8")
    monkeypatch.setattr(extensions, "_fichier_etat", lambda: fichier)
    extensions.decouvrir()
    with database._etat.engine.begin() as connexion:
        connexion.execute(text("DROP TABLE extension_etat"))

    assert extensions.est_active("placements") is True
    extensions.definir_active("placements", False)  # la base ne peut pas : le fichier
    assert extensions.est_active("placements") is False
    assert json.loads(fichier.read_text(encoding="utf-8"))["actives"]["placements"] is False
