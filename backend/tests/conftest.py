from pathlib import Path

import pytest
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker

from app.database import Base
from app import crud, models
from app.constants import (
    MONNAIE_INITIALE_NOM,
    TYPES_COMPTE_INITIAUX,
    TYPES_COMPTE_SYSTEME,
    TypeOperation,
)

# LES CATÉGORIES DE LA SUITE DE TESTS, et non plus celles que l'application
# LIVRE (`constants.CATEGORIES_INITIALES`, réduit à la seule « Autres » par la
# migration 0061). Les deux listes ont longtemps été la même, et elles ne
# répondent pourtant pas à la même question : une base neuve doit s'ouvrir sur
# une liste presque vide, là où ces tests ont besoin de RÉPARTIR des dépenses
# entre plusieurs catégories — un histogramme à une barre, un camembert à une
# tranche et une somme d'objectifs à un terme ne vérifient rien.
#
# Ces noms-là sont donc du DÉCOR, et rien ne les livre à personne. Deux d'entre
# eux gardent malgré tout un rôle : « Autres », que l'application cherche par
# son nom (repli d'une catégorie supprimée, cf. constants.CATEGORIE_AUTRES), et
# « Entrées d'argent », la seule que le décor coche en catégorie d'entrée.
CATEGORIES_TEST = [
    "Alimentaire",
    "Loisirs & sorties",
    "Charges fixes",
    "Réparation & entretien",
    "Vêtements & équipement sport",
    "Autres",
    "Entrées d'argent",
]
CATEGORIES_TEST_ENTREE = {"Entrées d'argent"}


def pytest_addoption(parser):
    parser.addoption(
        "--avec-migrations",
        action="store_true",
        default=False,
        help="inclut les tests de migration (lents : chacun rejoue alembic dans un sous-processus)",
    )


def pytest_configure(config):
    config.addinivalue_line(
        "markers",
        "extensions_reelles: laisse l'état d'activation réel décider "
        "(pour les tests du mécanisme d'extensions lui-même)",
    )
    config.addinivalue_line(
        "markers",
        "etat_en_base: laisse l'état d'activation des extensions se lire et s'écrire dans la base "
        "servie (table extension_etat) ; sans lui, les tests ne voient que le fichier d'installation",
    )
    config.addinivalue_line(
        "markers",
        "migrations: test lent qui rejoue alembic dans un sous-processus (écarté par défaut, "
        "cf. pytest_collection_modifyitems)",
    )


def pytest_collection_modifyitems(config, items):
    """LES TESTS DE MIGRATION SONT ÉCARTÉS PAR DÉFAUT, et marqués `migrations` automatiquement.

    Chacun lance `python -m alembic` dans un sous-processus et rejoue les migrations d'une base
    neuve : de 20 à 40 s pièce sur une machine virtuelle, et ils pèsent à eux seuls l'essentiel de
    la durée de la suite. Reconnus à leur source (un `subprocess` qui appelle `alembic`) plutôt
    qu'à une liste tenue à la main : un test de migration écrit demain est écarté sans y penser.

    Les lancer : `pytest backend/tests -m migrations` (eux seuls) ou `pytest backend/tests
    --avec-migrations` (tout). À faire avant une version et chaque fois qu'on touche à
    `backend/alembic/`. Donner un `-m` explicite les laisse aussi tels quels."""
    marqueur = pytest.mark.migrations
    ecartes = []
    gardes = []
    lents: dict = {}
    for item in items:
        fichier = getattr(item, "path", None) or Path(str(item.fspath))
        if fichier not in lents:
            try:
                source = Path(fichier).read_text(encoding="utf-8")
            except OSError:
                source = ""
            lents[fichier] = "subprocess" in source and "alembic" in source
        if lents[fichier]:
            item.add_marker(marqueur)
        if item.get_closest_marker("migrations") is not None:
            ecartes.append(item)
        else:
            gardes.append(item)
    if config.getoption("--avec-migrations") or config.getoption("markexpr"):
        return
    if ecartes:
        config.hook.pytest_deselected(items=ecartes)
        items[:] = gardes


@pytest.fixture(scope="session", autouse=True)
def base_native_presente():
    """LA BASE NATIVE EXISTE PENDANT LA SUITE, même sur un clone neuf.

    Les tests qui basculent de base reviennent, en sortant, à celle d'où ils sont partis — la
    base native (`database.DEV_DB_PATH`), ou celle que le processus sert. Depuis que le dépôt ne
    porte plus de base, un clone neuf (celui de la CI) n'en a aucune, et `changer_base`, qui
    refuse à juste titre un fichier absent, faisait échouer ces tests sur leur seul retour. On la
    crée donc si elle manque, et on la retire à la fin : la suite ne laisse rien derrière elle."""
    from app import database

    creees = []
    for chemin in {database.get_chemin_actuel(), database.DEV_DB_PATH}:
        if not chemin.exists():
            database.creer_base_neuve(chemin)
            creees.append(chemin)
    yield
    for chemin in creees:
        for suffixe in ("", "-wal", "-shm", "-journal"):
            try:
                chemin.with_name(chemin.name + suffixe).unlink(missing_ok=True)
            except OSError:
                pass


@pytest.fixture(autouse=True)
def extensions_sans_etat_en_base(request, monkeypatch):
    """Les tests ne lisent ni n'écrivent la table `extension_etat` de la base servie.

    Sans cela, un test qui appelle `definir_active` poserait une ligne dans la base NATIVE
    (`backend/data/dev`, partagée par toute la suite et par le serveur de dev) : l'extension
    resterait éteinte, ou allumée, pour tout ce qui vient après. Le mécanisme de fichier est celui
    que les tests d'extensions exercent ; la table a ses propres tests (marqueur `etat_en_base`),
    qui travaillent sur une base à eux."""
    if "etat_en_base" in request.keywords:
        return

    from app import extensions

    monkeypatch.setattr(extensions, "_decision_en_base", lambda extension_id: None)
    monkeypatch.setattr(extensions, "_ecrire_decision_en_base", lambda extension_id, actif: False)


@pytest.fixture(autouse=True)
def extensions_allumees(request, monkeypatch):
    """Les tests s'exécutent avec les extensions ALLUMÉES.

    L'état réel se lit dans `data/extensions.json`, à côté de la base de
    développement : le laisser décider ferait dépendre le résultat d'un fichier
    qui n'appartient pas à la suite, et changerait selon la machine.

    Le défaut d'une extension est « éteinte » (cf. app/extensions.est_active) ;
    or la plupart des tests exercent justement ce que les extensions apportent —
    le classement automatique à l'import, par exemple. Les tests qui vérifient
    le comportement SANS l'extension repatchent `est_active` pour eux seuls.
    """
    if "extensions_reelles" in request.keywords:
        return

    from app import extensions

    monkeypatch.setattr(extensions, "est_active", lambda extension_id: True)


@pytest.fixture()
def db_session():
    engine = create_engine(
        "sqlite:///:memory:", connect_args={"check_same_thread": False}
    )

    @event.listens_for(engine, "connect")
    def _enable_foreign_keys(dbapi_connection, connection_record):
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()

    Base.metadata.create_all(engine)
    TestingSessionLocal = sessionmaker(bind=engine)
    session = TestingSessionLocal()
    # Reproduit le seed des migrations pour tout ce qui est LIVRÉ (types de
    # compte, types d'opération, monnaie) et pose par-dessus le décor de
    # catégories de la suite (cf. CATEGORIES_TEST, plus haut).
    for position, nom in enumerate(CATEGORIES_TEST):
        # `couleur_index` suit l'ordre au départ, comme le rattrapage de la
        # migration 0035 : ensuite il n'appartient plus qu'à la catégorie.
        session.add(
            models.Categorie(
                nom=nom,
                ordre=position,
                couleur_index=position,
                est_entree=nom in CATEGORIES_TEST_ENTREE,
            )
        )
    for nom in TYPES_COMPTE_INITIAUX:
        session.add(models.TypeCompte(nom=nom, systeme=nom in TYPES_COMPTE_SYSTEME))
    session.commit()
    # Les 7 types d'opération (migrations 0019 et 0020).
    crud.seed_types_operation(session)
    # La catégorie des virements internes (migration 0090), équivalente au type « virement » :
    # LIVRÉE dans toute base, elle n'appartient pas au décor ci-dessus.
    crud.seed_categorie_virements(session)
    # L'euro (migration 0021) : la monnaie à laquelle sont rattachées toutes
    # les données qui n'en désignent pas explicitement une autre.
    crud.seed_monnaie_initiale(session)
    try:
        yield session
    finally:
        session.close()
        engine.dispose()


def get_categorie_id(db, nom):
    return db.query(models.Categorie).filter(models.Categorie.nom == nom).one().id


def get_type_compte_id(db, nom):
    return db.query(models.TypeCompte).filter(models.TypeCompte.nom == nom).one().id


def get_monnaie_id(db, nom=MONNAIE_INITIALE_NOM):
    """Id d'une monnaie depuis son nom ; par défaut l'euro, seule monnaie
    présente au démarrage."""
    return db.query(models.Monnaie).filter(models.Monnaie.nom == nom).one().id


def creer_monnaie(db, nom, symbole):
    return crud.create_monnaie(db, nom, symbole)


def creer_compte(db, nom, type_nom="courant", solde_initial=0.0, monnaies=None):
    """Crée un compte et ses monnaies. `monnaies` est une liste de couples
    (monnaie_id, solde_initial) pour les comptes multi-devises ; sans elle, le
    compte est mono-monnaie en euros avec `solde_initial`."""
    if monnaies is None:
        monnaies = [(get_monnaie_id(db), solde_initial)]
    compte = models.Compte(nom=nom, type_id=get_type_compte_id(db, type_nom))
    compte.monnaies = [
        models.CompteMonnaie(monnaie_id=monnaie_id, solde_initial=montant, ordre=position)
        for position, (monnaie_id, montant) in enumerate(monnaies)
    ]
    db.add(compte)
    db.commit()
    db.refresh(compte)
    return compte


def get_type_id(db, code):
    """Id d'un type d'opération depuis son code technique (`classique`,
    `pret`…) — ce que les opérations référencent désormais."""
    if isinstance(code, TypeOperation):
        code = code.value
    return (
        db.query(models.TypeOperationDB).filter(models.TypeOperationDB.code == code).one().id
    )


def charger_module_extension(extension_id: str, nom_fichier: str):
    """Importe un module d'une extension, pour les tests qui l'exercent.

    Les extensions ne sont pas des paquets Python installés : leurs modules se
    chargent par chemin de fichier, comme le fait l'application elle-même
    (cf. app/extensions.py::charger_routeur). Ce raccourci évite à chaque test
    de refaire cette plomberie.

    Cherche dans `extensions/` puis `extensions-dev/` : un test qui vise
    l'extension de développement (« outils-dev ») la trouve donc aussi, sans
    avoir à dire où elle vit.
    """
    import importlib.util
    import sys
    from pathlib import Path

    racine = Path(__file__).resolve().parents[2]
    for base in ("extensions", "extensions-dev"):
        dossier = racine / base / extension_id
        chemin = dossier / nom_fichier
        if not chemin.is_file():
            continue
        # Comme dans l'application : le dossier rejoint le sys.path pour que
        # les fichiers de l'extension puissent s'importer entre eux.
        if str(dossier) not in sys.path:
            sys.path.append(str(dossier))
        spec = importlib.util.spec_from_file_location(
            f"budget_ext_test_{extension_id}_{Path(nom_fichier).stem}", chemin
        )
        module = importlib.util.module_from_spec(spec)
        sys.modules[spec.name] = module
        spec.loader.exec_module(module)
        return module
    raise ImportError(f"Module {nom_fichier} introuvable dans l'extension {extension_id}")
