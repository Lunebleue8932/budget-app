"""Les copies de sécurité de la base, dans un dossier que l'utilisateur choisit.

POURQUOI UN DOSSIER À PART. La base vit sur le disque de la machine, et tout ce qui détruit la
machine ou ce disque (panne, vol, formatage) la détruit aussi. Une copie rangée ailleurs — un autre
disque, un dossier synchronisé, une clé — est la seule protection qui tienne. L'application la fait
d'elle-même : au démarrage, puis au plus une fois par jour tant qu'elle reste ouverte.

CE QUI EST COPIÉ : la BASE ENTIÈRE, par l'API de sauvegarde de SQLite — un instantané cohérent même si
l'application écrit au même moment, là où copier le fichier à la main pourrait en prendre une moitié.
C'est un fichier de base à part entière : « Paramètres → Base de données → rejoindre une base
existante » le rouvre tel quel, c'est ainsi qu'on RESTAURE.

LES COPIES S'ACCUMULENT, JUSQU'À UN PLAFOND (`GARDER`) : les plus anciennes sont supprimées — et
seulement celles qui portent NOTRE nom (`budget-AAAA-MM-JJ_HHMMSS.db`) : un fichier qu'on aurait
rangé là à la main n'est jamais touché.

RIEN ICI NE LÈVE POUR UN PROBLÈME DE DISQUE dans la boucle automatique : un dossier débranché ne doit
pas faire tomber l'application. L'écran, lui, appelle `sauvegarder` directement et montre l'erreur.
"""
import re
import sqlite3
import threading
import time
from datetime import datetime, timedelta
from pathlib import Path
from typing import Optional

from .. import config_utilisateur, database

GARDER = 30
# Une copie « récente » : en deçà, la boucle automatique n'en refait pas.
DELAI_AUTOMATIQUE = timedelta(hours=20)
INTERVALLE_VERIFICATION = 30 * 60  # secondes
_MOTIF = re.compile(r"^budget-(\d{4})-(\d{2})-(\d{2})_(\d{2})(\d{2})(\d{2})\.db$")


class ErreurSauvegarde(Exception):
    """Un dossier inutilisable ou une copie impossible, avec une phrase pour l'écran."""


def dossier_configure() -> Optional[Path]:
    """Le dossier retenu pour ce poste, ou None. Le mode développement lit sa PROPRE clé : le profil
    est partagé par toutes les copies de l'application, et une installation de mise au point ne doit
    jamais lire ni écrire celle de la vraie."""
    return config_utilisateur.dossier_sauvegarde(dev=database.mode_developpement())


def verifier_dossier(chemin: str) -> Path:
    """Le dossier demandé, absolu, créé au besoin, vérifié en écriture — ou ErreurSauvegarde."""
    brut = (chemin or "").strip()
    if not brut:
        raise ErreurSauvegarde("Indique un dossier.")
    dossier = Path(brut).expanduser()
    if not dossier.is_absolute():
        raise ErreurSauvegarde("Le dossier doit être un chemin complet (par exemple D:\\Sauvegardes).")
    # Le dossier de l'application est celui qu'une mise à jour remplace : y ranger les copies, c'est
    # les perdre avec ce qu'elles protègent.
    if database.chemin_a_risque(dossier / "x.db"):
        raise ErreurSauvegarde(
            "Ce dossier est celui de l'application : une mise à jour le remplacerait, copies comprises. "
            "Choisis-en un autre."
        )
    try:
        dossier.mkdir(parents=True, exist_ok=True)
        essai = dossier / ".budget-ecriture"
        essai.write_text("ok", encoding="utf-8")
        essai.unlink()
    except OSError as exc:
        raise ErreurSauvegarde(f"Impossible d'écrire dans ce dossier ({exc.strerror or exc}).")
    return dossier


def _copies(dossier: Path) -> list[tuple[datetime, Path]]:
    """Les copies faites par l'application dans `dossier`, de la plus récente à la plus ancienne."""
    trouvees = []
    try:
        for fichier in dossier.iterdir():
            m = _MOTIF.match(fichier.name)
            if m and fichier.is_file():
                trouvees.append((datetime(*(int(g) for g in m.groups())), fichier))
    except OSError:
        return []
    return sorted(trouvees, reverse=True)


def derniere_copie(dossier: Path) -> Optional[dict]:
    copies = _copies(dossier)
    if not copies:
        return None
    date_copie, fichier = copies[0]
    try:
        taille = fichier.stat().st_size
    except OSError:
        taille = 0
    return {"nom": fichier.name, "date": date_copie.isoformat(timespec="seconds"), "taille": taille}


def purger(dossier: Path, garder: int = GARDER) -> int:
    """Supprime les copies au-delà des `garder` plus récentes ; rend combien l'ont été."""
    supprimees = 0
    for _date, fichier in _copies(dossier)[garder:]:
        try:
            fichier.unlink()
            supprimees += 1
        except OSError:
            pass
    return supprimees


def sauvegarder(dossier: Path, source: Optional[Path] = None, maintenant: Optional[datetime] = None) -> Path:
    """Copie la base dans `dossier` et rend le fichier créé."""
    source = Path(source) if source else database.get_chemin_actuel()
    maintenant = maintenant or datetime.now()
    if not source.exists():
        raise ErreurSauvegarde("La base à copier est introuvable.")
    try:
        dossier.mkdir(parents=True, exist_ok=True)
        cible = dossier / f"budget-{maintenant:%Y-%m-%d_%H%M%S}.db"
        origine = sqlite3.connect(str(source))
        try:
            destination = sqlite3.connect(str(cible))
            try:
                origine.backup(destination)
            finally:
                destination.close()
        finally:
            origine.close()
    except (OSError, sqlite3.Error) as exc:
        raise ErreurSauvegarde(f"La copie a échoué : {exc}")
    purger(dossier)
    return cible


def est_due(dossier: Path, maintenant: Optional[datetime] = None) -> bool:
    derniere = derniere_copie(dossier)
    if derniere is None:
        return True
    maintenant = maintenant or datetime.now()
    return maintenant - datetime.fromisoformat(derniere["date"]) >= DELAI_AUTOMATIQUE


def sauvegarder_si_due() -> Optional[Path]:
    """La passe automatique : une copie si un dossier est retenu et que la dernière est ancienne.
    Jamais d'exception — cf. l'en-tête du module."""
    try:
        dossier = dossier_configure()
        # Ni un tutoriel ni la démo ne se copient : leurs copies chasseraient les vraies du dossier
        # (on n'en garde que `GARDER`).
        if (
            dossier is None
            or database.en_decouverte()
            or database.en_sandbox()
            or not est_due(dossier)
        ):
            return None
        return sauvegarder(dossier)
    except Exception:
        return None


_demarree = False


def demarrer_automatique() -> None:
    """Lance, une seule fois, la veille qui fait les copies : tout de suite, puis toutes les 30 min
    (une copie n'est faite que si la dernière a plus de 20 h). Un fil DÉMON : il ne retient pas la
    fermeture de l'application."""
    global _demarree
    if _demarree:
        return
    _demarree = True

    def boucle():
        while True:
            sauvegarder_si_due()
            time.sleep(INTERVALLE_VERIFICATION)

    threading.Thread(target=boucle, name="sauvegarde-automatique", daemon=True).start()
