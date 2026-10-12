"""La base de découverte du tutoriel : fabriquée à la demande, jamais mélangée à la vraie.

Ce que ces tests verrouillent : (1) elle contient de quoi illustrer le tutoriel,
(2) y entrer puis en sortir rend EXACTEMENT la base d'avant, (3) elle n'est jamais
mémorisée dans le profil."""
from datetime import date
from pathlib import Path

from app import config_utilisateur, database, models
from app.routers import tutoriel
from app.services import base_decouverte
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker


def _lire(chemin, requete):
    moteur = create_engine(f"sqlite:///{chemin.as_posix()}")
    try:
        with sessionmaker(bind=moteur)() as db:
            return requete(db)
    finally:
        moteur.dispose()


def test_la_base_de_decouverte_contient_de_quoi_illustrer_le_tutoriel(tmp_path):
    chemin = base_decouverte.fabriquer(tmp_path / "decouverte.db", date(2026, 10, 15))

    def contenu(db):
        return {
            "comptes": sorted(c.nom for c in db.query(models.Compte).all()),
            "categories": {c.nom for c in db.query(models.Categorie).all()},
            "operations": db.query(models.Operation).count(),
            "virements": db.query(models.Operation)
            .filter(models.Operation.virement_id.isnot(None))
            .count(),
            "entrees": db.query(models.Operation)
            .join(models.Categorie)
            .filter(models.Categorie.est_entree.is_(True))
            .count(),
            "decoupees": db.query(models.OperationDecoupe).count(),
            "amorties": db.query(models.Operation).filter(models.Operation.amorti.is_(True)).count(),
            "previsionnelles": db.query(models.Operation)
            .filter(models.Operation.statut == "prévisionnel")
            .count(),
            "plus_recente_reelle": max(
                o.date for o in db.query(models.Operation).filter(models.Operation.statut == "réel")
            ),
        }

    lu = _lire(chemin, contenu)
    assert lu["comptes"] == ["Compte A", "Compte B"]
    assert {"Alimentaire", "Loisirs", "Transports", "Charges fixes", "Autres", "Entrées d'argent"} <= lu[
        "categories"
    ]
    assert lu["operations"] > 30
    assert lu["virements"] == 6  # trois mois, deux jambes
    assert lu["entrees"] == 3
    assert lu["decoupees"] == 2
    assert lu["amorties"] == 1
    assert lu["previsionnelles"] == 1
    # Rien de « réel » n'a lieu après le jour de fabrication.
    assert lu["plus_recente_reelle"] <= date(2026, 10, 15)


def test_entrer_puis_quitter_rend_la_base_d_avant(tmp_path, monkeypatch):
    base_avant = tmp_path / "ma-base.db"
    database.creer_base_neuve(base_avant)
    decouverte = tmp_path / "decouverte.db"
    # La base de découverte s'écrit dans le dossier temporaire du test, pas dans le vrai.
    monkeypatch.setattr(base_decouverte, "chemin_decouverte", lambda: decouverte)

    chemin_depart = database.get_chemin_actuel()
    ecrit = []
    monkeypatch.setattr(config_utilisateur, "ecrire", lambda **kw: ecrit.append(kw) or True)
    try:
        database.changer_base(str(base_avant))
        assert not database.en_decouverte()

        assert tutoriel.entrer_decouverte() == {"actif": True, "parcours": "decouverte"}
        assert database.en_decouverte()
        with database._etat.SessionLocal() as db:
            assert {c.nom for c in db.query(models.Compte).all()} == {"Compte A", "Compte B"}
        # Rejouer l'entrée ne refabrique rien et ne perd pas la base d'avant.
        assert tutoriel.entrer_decouverte() == {"actif": True, "parcours": "decouverte"}

        assert tutoriel.quitter_decouverte() == {"actif": False, "parcours": None}
        assert database.get_chemin_actuel() == base_avant.resolve()
        assert not decouverte.exists()
        with database._etat.SessionLocal() as db:
            assert db.query(models.Compte).count() == 0
    finally:
        database.changer_base(str(chemin_depart))
    # JAMAIS DE MÉMORISATION : le profil n'a reçu aucune écriture.
    assert ecrit == []


def test_changer_de_base_pendant_la_decouverte_la_termine(tmp_path, monkeypatch):
    base_avant = tmp_path / "ma-base.db"
    autre = tmp_path / "autre.db"
    database.creer_base_neuve(base_avant)
    database.creer_base_neuve(autre)
    monkeypatch.setattr(base_decouverte, "chemin_decouverte", lambda: tmp_path / "decouverte.db")
    chemin_depart = database.get_chemin_actuel()
    try:
        database.changer_base(str(base_avant))
        tutoriel.entrer_decouverte()
        database.changer_base(str(autre))
        assert not database.en_decouverte()
        # Quitter ne ramène alors nulle part : on reste où l'on est.
        tutoriel.quitter_decouverte()
        assert database.get_chemin_actuel() == autre.resolve()
    finally:
        database.changer_base(str(chemin_depart))


def test_pendant_la_decouverte_on_ne_change_pas_de_base(tmp_path, monkeypatch):
    """Déplacer ou rejoindre une base depuis la découverte ferait mémoriser le fichier temporaire."""
    import pytest
    from fastapi import HTTPException

    from app import schemas
    from app.routers import parametres_base

    base_avant = tmp_path / "ma-base.db"
    database.creer_base_neuve(base_avant)
    monkeypatch.setattr(base_decouverte, "chemin_decouverte", lambda: tmp_path / "decouverte.db")
    chemin_depart = database.get_chemin_actuel()
    try:
        database.changer_base(str(base_avant))
        tutoriel.entrer_decouverte()
        for appel in (
            lambda: parametres_base.set_base(schemas.BaseDonneesUpdate(chemin=str(base_avant))),
            lambda: parametres_base.installer_base(
                schemas.BaseDonneesInstaller(chemin=str(tmp_path / "x.db"), deplacer_actuelle=True)
            ),
            lambda: parametres_base.reinitialiser_base(),
        ):
            with pytest.raises(HTTPException) as erreur:
                appel()
            assert erreur.value.status_code in (403, 409)
        assert database.en_decouverte()
    finally:
        database.changer_base(str(chemin_depart))


# ---------- La variante du tutoriel d'import ----------

RELEVE_EXEMPLE = Path(__file__).resolve().parents[2] / "frontend" / "exemples" / "releve-exemple.csv"


def test_la_base_d_import_porte_un_seul_preset_lie_au_compte_a(tmp_path):
    chemin = base_decouverte.fabriquer(
        tmp_path / "import.db", parcours=base_decouverte.PARCOURS_IMPORT
    )

    def contenu(db):
        presets = db.query(models.ImportPreset).filter(models.ImportPreset.domaine == "bancaire").all()
        comptes = {c.id: c for c in db.query(models.Compte).all()}
        return {
            "comptes": sorted((c.nom, c.type_compte.nom) for c in comptes.values()),
            "operations": db.query(models.Operation).count(),
            "categories": {c.nom for c in db.query(models.Categorie).all()},
            "presets": [
                (p.nom, comptes[p.compte_id].nom if p.compte_id else None, p.lignes_entete, p.colonnes)
                for p in presets
            ],
        }

    lu = _lire(chemin, contenu)
    assert lu["comptes"] == [("Compte A", "courant"), ("Compte B", "courant")]
    assert lu["operations"] == 0
    assert {"Alimentaire", "Loisirs", "Transports", "Charges fixes", "Autres", "Entrées d'argent"} <= lu[
        "categories"
    ]
    assert lu["presets"] == [
        ("Ma banque", "Compte A", 2, base_decouverte.COLONNES_PRESET_IMPORT)
    ]


def test_le_preset_d_import_lit_le_releve_de_la_notice_sans_erreur(tmp_path):
    """Le relevé de la notice est le fichier de presque toutes les étapes : pas une ligne en
    erreur, et le bon compte sur chacune."""
    from app.services import import_bancaire

    chemin = base_decouverte.fabriquer(
        tmp_path / "import.db", parcours=base_decouverte.PARCOURS_IMPORT
    )
    moteur = create_engine(f"sqlite:///{chemin.as_posix()}")
    try:
        with sessionmaker(bind=moteur)() as db:
            preset = db.query(models.ImportPreset).one()
            apercu = import_bancaire.previsualiser(db, preset.id, RELEVE_EXEMPLE.read_bytes())
            compte_a = db.query(models.Compte).filter(models.Compte.nom == "Compte A").one()
    finally:
        moteur.dispose()
    assert len(apercu.lignes) == 14
    assert [l.erreur for l in apercu.lignes if l.erreur] == []
    assert {l.compte_id for l in apercu.lignes} == {compte_a.id}


def test_entrer_dans_un_autre_parcours_garde_la_vraie_base_pour_la_sortie(tmp_path, monkeypatch):
    base_avant = tmp_path / "ma-base.db"
    database.creer_base_neuve(base_avant)
    monkeypatch.setattr(base_decouverte, "chemin_decouverte", lambda: tmp_path / "decouverte.db")
    chemin_depart = database.get_chemin_actuel()
    try:
        database.changer_base(str(base_avant))
        assert tutoriel.entrer_decouverte() == {"actif": True, "parcours": "decouverte"}
        assert tutoriel.entrer_decouverte("import") == {"actif": True, "parcours": "import"}
        with database._etat.SessionLocal() as db:
            assert db.query(models.Operation).count() == 0
            assert [p.nom for p in db.query(models.ImportPreset).all()] == ["Ma banque"]
        tutoriel.quitter_decouverte()
        assert database.get_chemin_actuel() == base_avant.resolve()
    finally:
        database.changer_base(str(chemin_depart))
