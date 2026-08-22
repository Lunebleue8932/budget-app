import os
import shutil
import sys
from datetime import datetime
from pathlib import Path

from sqlalchemy import create_engine, event, text
from sqlalchemy.orm import sessionmaker, declarative_base

# Sépare l'environnement de développement (données factices, dans le repo) de
# la production (données réelles, hors du repo). BUDGET_DB_PATH pointe
# explicitement vers un fichier .db ; sans cette variable, on utilise toujours
# la base de dev locale — jamais de bascule implicite vers un chemin de prod.
_BACKEND_DIR = Path(__file__).resolve().parent.parent


def _dossier_donnees_par_defaut() -> Path:
    """Emplacement de la base de test/dev.

    En application packagée (PyInstaller), le code tourne depuis le bundle,
    qui est remplacé à chaque reconstruction : la base doit donc vivre À CÔTÉ
    de l'exécutable, pas dedans, pour survivre à une mise à jour de l'app.
    En développement, l'emplacement historique dans le repo est conservé.
    """
    if getattr(sys, "frozen", False):
        return Path(sys.executable).resolve().parent / "data"
    return _BACKEND_DIR / "data" / "dev"


_DEFAULT_DEV_DIR = _dossier_donnees_par_defaut()
_DEFAULT_DEV_DIR.mkdir(parents=True, exist_ok=True)
_DEFAULT_DEV_DB_PATH = _DEFAULT_DEV_DIR / "budget_dev.db"

# Utilisés par alembic (migrations, cf. alembic/env.py) : résolution statique
# à l'import, indépendante de la bascule de base à chaud ci-dessous — une
# migration lancée sans BUDGET_DB_PATH cible donc toujours la base de dev,
# jamais la base actuellement sélectionnée par l'utilisateur dans l'app.
DATABASE_PATH = Path(os.environ.get("BUDGET_DB_PATH", str(_DEFAULT_DEV_DB_PATH)))
SQLALCHEMY_DATABASE_URL = f"sqlite:///{DATABASE_PATH.as_posix()}"

# Chemin de la base de test/dev, exposé pour que l'app puisse toujours y
# revenir facilement (bouton "Revenir à la base de test") — jamais mémorisé
# pour la base personnelle de l'utilisateur, qui ne doit se retrouver associée
# à rien de persistant au-delà de la session en cours.
DEV_DB_PATH = _DEFAULT_DEV_DB_PATH.resolve()

Base = declarative_base()


class _EtatBase:
    """Le moteur/la session courants ne sont jamais fixes : toutes les
    opérations CRUD passent par get_db(), qui lit toujours cet état — changer_base()
    peut donc rediriger l'app entière vers un autre fichier .db à chaud, sans
    redémarrage ni changement dans les routeurs."""

    def __init__(self):
        self.engine = None
        self.SessionLocal = None
        self.chemin: Path = None
        # Trace de la dernière bascule ayant migré la base : le panneau « Base
        # de données » les affiche, pour que la copie de sécurité soit connue
        # de l'utilisateur AU MOMENT où le schéma change, et pas seulement
        # quand il la cherche.
        self.derniere_sauvegarde: Path = None
        self.revision_quittee: str = None


_etat = _EtatBase()


def _construire(chemin: Path):
    url = f"sqlite:///{chemin.as_posix()}"
    engine = create_engine(url, connect_args={"check_same_thread": False})

    @event.listens_for(engine, "connect")
    def _enable_sqlite_foreign_keys(dbapi_connection, connection_record):
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()

    SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    return engine, SessionLocal


def _appliquer(chemin: Path):
    engine, SessionLocal = _construire(chemin)
    ancien_engine = _etat.engine
    _etat.engine, _etat.SessionLocal, _etat.chemin = engine, SessionLocal, chemin
    if ancien_engine is not None:
        ancien_engine.dispose()


def get_chemin_actuel() -> Path:
    return _etat.chemin


def _dossier_alembic() -> Path:
    """Où vivent env.py et versions/*.py : dans le bundle extrait en mode
    packagé, dans le repo sinon (même résolution que desktop/app_desktop.py)."""
    if getattr(sys, "frozen", False):
        return Path(sys._MEIPASS) / "alembic"
    return _BACKEND_DIR / "alembic"


def revision_actuelle(chemin: Path) -> str | None:
    """La révision inscrite dans le fichier, ou None s'il n'en porte aucune
    (base vierge, ou fichier qui n'est pas une base de l'app)."""
    moteur = create_engine(f"sqlite:///{chemin.as_posix()}")
    try:
        with moteur.connect() as connexion:
            ligne = connexion.execute(text("SELECT version_num FROM alembic_version")).first()
            return ligne[0] if ligne else None
    except Exception:
        return None
    finally:
        moteur.dispose()


def revision_cible() -> str | None:
    """La révision qu'attend CETTE version de l'application."""
    from alembic.config import Config
    from alembic.script import ScriptDirectory

    config = Config()
    config.set_main_option("script_location", str(_dossier_alembic()))
    return ScriptDirectory.from_config(config).get_current_head()


def derniere_migration() -> tuple[Path | None, str | None]:
    """(copie de sécurité, révision quittée) de la dernière bascule ayant migré
    la base — (None, None) si la dernière n'a rien eu à faire."""
    return _etat.derniere_sauvegarde, _etat.revision_quittee


def sauvegarder_avant_migration(chemin: Path, revision: str | None) -> Path:
    """Copie horodatée à côté du fichier, prise AVANT toute migration.

    Une migration réussie ne perd rien, mais c'est précisément le moment où
    l'on regrette de ne pas avoir de copie : le schéma change sous des données
    qu'on ne peut pas reconstituer. Nommée d'après la révision quittée, pour
    savoir d'un coup d'œil à quel état on reviendrait."""
    horodatage = datetime.now().strftime("%Y%m%d_%H%M%S")
    cible = chemin.with_name(f"{chemin.stem}.avant-{revision or 'vierge'}_{horodatage}{chemin.suffix}")
    shutil.copy2(chemin, cible)
    return cible


def migrer_si_necessaire(chemin: Path) -> tuple[Path | None, str | None]:
    """Amène `chemin` au schéma de l'application. Renvoie (sauvegarde, révision
    quittée), les deux None si la base était déjà à jour.

    POURQUOI ICI. L'application de bureau applique les migrations au démarrage
    (cf. desktop/app_desktop.py), mais sur la base résolue à ce moment-là — la
    base de test, à côté de l'exécutable. La base PERSONNELLE, elle, ne se
    rejoint qu'après coup, en saisissant son chemin dans le panneau « Base de
    données » : elle n'était donc jamais migrée, et restait à l'ancien schéma
    sous une application neuve. Le symptôme n'a rien d'explicite — un 500 sur
    « no such column: operation.notes » dès la page Opérations, juste après une
    mise à jour, ce qui ressemble à une base abîmée par la migration alors
    qu'elle n'a simplement jamais été migrée."""
    revision = revision_actuelle(chemin)
    # Sans `alembic_version`, le fichier n'est pas une base de l'application :
    # ce peut être n'importe quel SQLite que l'utilisateur a désigné par erreur,
    # et y déverser tout le schéma serait le pire des services à lui rendre.
    # `changer_base` ne crée jamais rien implicitement — migrer ici non plus.
    if revision is None or revision == revision_cible():
        return None, None

    from alembic import command
    from alembic.config import Config

    sauvegarde = sauvegarder_avant_migration(chemin, revision)
    config = Config()
    config.set_main_option("script_location", str(_dossier_alembic()))
    # La cible est passée par `attributes` : env.py la préfère à l'URL figée à
    # l'import du processus, qui désigne la base de DÉPART.
    config.attributes["sqlalchemy_url"] = f"sqlite:///{chemin.as_posix()}"
    command.upgrade(config, "head")
    return sauvegarde, revision


def changer_base(chemin: str) -> Path:
    """Bascule toutes les opérations CRUD vers un autre fichier SQLite déjà
    existant — jamais de création implicite (un chemin fautif doit échouer
    clairement, pas créer silencieusement une base vide). Si le fichier n'est
    pas une base SQLite exploitable, l'app reste sur la base précédente."""
    nouveau_chemin = Path(chemin).expanduser()
    if not nouveau_chemin.is_file():
        raise FileNotFoundError(f"Fichier introuvable : {nouveau_chemin}")
    nouveau_chemin = nouveau_chemin.resolve()

    engine, SessionLocal = _construire(nouveau_chemin)
    try:
        with SessionLocal() as session:
            # Force réellement la lecture du fichier (contrairement à un
            # "SELECT 1" littéral, jamais évalué contre le disque) : un
            # fichier qui n'est pas une base SQLite valide échoue ici.
            session.execute(text("SELECT * FROM sqlite_master LIMIT 1"))
    except Exception as exc:
        engine.dispose()
        raise ValueError(f"Fichier illisible en tant que base SQLite : {nouveau_chemin}") from exc

    # Le schéma AVANT de basculer : brancher l'app sur une base restée à une
    # version antérieure ne donne pas une app dégradée, mais une app qui répond
    # 500 sur ses pages principales. La migration se fait donc ici, sur une
    # copie de sécurité prise juste avant — et si elle échoue, on ne bascule
    # pas du tout : mieux vaut rester sur la base précédente que se retrouver
    # sur une base à moitié migrée.
    engine.dispose()
    try:
        derniere_sauvegarde, revision_quittee = migrer_si_necessaire(nouveau_chemin)
    except Exception as exc:
        raise ValueError(
            f"Impossible de mettre à jour le schéma de {nouveau_chemin} : {exc}"
        ) from exc
    _etat.derniere_sauvegarde = derniere_sauvegarde
    _etat.revision_quittee = revision_quittee
    engine, SessionLocal = _construire(nouveau_chemin)

    ancien_engine = _etat.engine
    _etat.engine, _etat.SessionLocal, _etat.chemin = engine, SessionLocal, nouveau_chemin
    if ancien_engine is not None:
        ancien_engine.dispose()
    return nouveau_chemin


def get_db():
    db = _etat.SessionLocal()
    try:
        yield db
    finally:
        db.close()


_appliquer(Path(os.environ.get("BUDGET_DB_PATH", str(_DEFAULT_DEV_DB_PATH))).resolve())

# Session indépendante de la bascule à chaud ci-dessus, résolue une seule fois
# via BUDGET_DB_PATH : réservée aux scripts autonomes (seed_dev.py), qui
# tournent dans un processus séparé et doivent toujours cibler la même base
# que la variable d'environnement, jamais celle sélectionnée dans une
# app en cours d'exécution.
_moteur_scripts = create_engine(SQLALCHEMY_DATABASE_URL, connect_args={"check_same_thread": False})


@event.listens_for(_moteur_scripts, "connect")
def _enable_sqlite_foreign_keys_scripts(dbapi_connection, connection_record):
    cursor = dbapi_connection.cursor()
    cursor.execute("PRAGMA foreign_keys=ON")
    cursor.close()


SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=_moteur_scripts)
