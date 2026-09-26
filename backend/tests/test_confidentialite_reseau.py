"""LA FRONTIÈRE RÉSEAU EST L'AUTHENTIFICATION, et c'est tout le modèle de
sécurité de cette application.

Aucune route ne demande de mot de passe, aucun jeton ne protège `/operations` —
parce que le serveur n'écoute que sur 127.0.0.1, où seule la fenêtre de
l'application peut l'atteindre. Ce choix est défendable pour un budget personnel
hors ligne, et il a une conséquence qu'il faut voir en face : le jour où le
serveur écouterait sur autre chose, TOUTES les données seraient lisibles, sans
le moindre obstacle, par n'importe qui sur le même réseau.

Or chacun des gestes qui franchissent cette ligne tient en UNE LIGNE — un
`host="0.0.0.0"` ajouté pour déboguer, un `--host` dans une configuration de
lancement, une politique CORS permissive — et aucun ne se voit à la relecture
d'une revue ordinaire.

CE FICHIER LES ATTRAPE. Il lit l'ARBRE SYNTAXIQUE et non le texte : un grep se
ferait piéger par un commentaire (ce fichier-ci en est plein) et manquerait une
valeur passée par variable.

CE QUI SORT est l'autre moitié, et la liste est NOMINATIVE plus bas : un
troisième émetteur devra venir écrire son nom ici, ce qui est précisément le
moment où quelqu'un se demandera s'il doit exister.

CE QUE ÇA NE PROMET PAS : tout ce qui tourne sous la même session peut atteindre
la boucle locale tant que l'application est ouverte. Le port n'y change rien —
il n'a jamais été un secret, il s'obtient par un balayage en quelques
millisecondes — et c'est pourquoi le fixer (cf. app_desktop.PORT_PREFERE) ne
déplace pas cette frontière. Le jour où l'accès depuis un téléphone deviendrait
souhaitable, c'est une file d'autorisation manuelle qu'il faudrait, et pas
seulement un `0.0.0.0`.
"""
import ast
import inspect
from pathlib import Path

import pytest
import uvicorn

RACINE = Path(__file__).resolve().parents[2]

# Les trois dossiers qui portent du code exécuté. `desktop/dist` et
# `desktop/build` sont des SORTIES de PyInstaller : elles recopient ce code, et
# les analyser ferait échouer le test sur des doublons qu'on ne modifie jamais.
DOSSIERS = ("backend/app", "extensions", "desktop")
EXCLUS = ("desktop/dist", "desktop/build", "__pycache__", ".venv")

# LES DEUX SEULS ÉMETTEURS, nommés. « Lecture de cours » va lire des cotations
# sur une URL collée par l'utilisateur ; `app_desktop` s'interroge lui-même sur
# `/health` avant d'ouvrir la fenêtre.
EMETTEURS_AUTORISES = {
    "extensions/lecture-de-cours/source_cours.py",
    "desktop/app_desktop.py",
}

# La seule liaison de socket du dépôt.
LIEUR_AUTORISE = "desktop/app_desktop.py"


def _fichiers_python():
    for dossier in DOSSIERS:
        for chemin in (RACINE / dossier).rglob("*.py"):
            relatif = chemin.relative_to(RACINE).as_posix()
            if any(exclu in relatif for exclu in EXCLUS):
                continue
            yield relatif, chemin


def _arbres():
    # `utf-8-sig` : plusieurs fichiers du dépôt portent une marque d'ordre des
    # octets, qu'`ast.parse` refuse comme caractère non imprimable.
    for relatif, chemin in _fichiers_python():
        yield relatif, ast.parse(chemin.read_text(encoding="utf-8-sig"))


def _appels(arbre):
    return [n for n in ast.walk(arbre) if isinstance(n, ast.Call)]


def _nom_appele(appel):
    """« socket.bind », « urllib.request.urlopen », « app.add_middleware »…"""
    morceaux = []
    noeud = appel.func
    while isinstance(noeud, ast.Attribute):
        morceaux.append(noeud.attr)
        noeud = noeud.value
    if isinstance(noeud, ast.Name):
        morceaux.append(noeud.id)
    return ".".join(reversed(morceaux))


def test_une_seule_liaison_de_socket_dans_tout_le_depot():
    """Une seconde liaison, où que ce soit, voudrait dire un second serveur —
    et celui-là n'aurait pas été relu."""
    lieurs = {
        relatif
        for relatif, arbre in _arbres()
        for appel in _appels(arbre)
        if _nom_appele(appel).endswith(".bind")
    }

    assert lieurs == {LIEUR_AUTORISE}


def test_le_serveur_de_la_fenetre_n_ecoute_que_sur_la_boucle_locale():
    """L'hôte est écrit EN CLAIR dans l'appel, et c'est voulu : une variable
    aurait déplacé la décision ailleurs, là où ce test ne la voit plus."""
    arbre = ast.parse((RACINE / LIEUR_AUTORISE).read_text(encoding="utf-8-sig"))
    liaisons = [
        appel for appel in _appels(arbre) if _nom_appele(appel).endswith(".bind")
    ]

    assert liaisons, "la liaison a disparu : ce test ne garde plus rien"
    for appel in liaisons:
        adresse = appel.args[0]
        assert isinstance(adresse, ast.Tuple), "l'hôte doit rester littéral"
        hote = adresse.elts[0]
        assert isinstance(hote, ast.Constant) and hote.value == "127.0.0.1"


def test_le_defaut_d_uvicorn_est_la_boucle_locale():
    """LE SERVEUR DE DÉVELOPPEMENT EN DÉPEND AUTREMENT : il ne précise pas
    d'hôte et repose sur ce défaut. Vérifié sur la version RÉELLEMENT installée
    — c'est elle qui tournera, pas celle de la documentation."""
    assert inspect.signature(uvicorn.Config).parameters["host"].default == "127.0.0.1"


@pytest.mark.parametrize("interdit", ["0.0.0.0", "::", "", "*"])
def test_aucune_adresse_d_ecoute_ouverte_n_est_ecrite_nulle_part(interdit):
    """Les quatre façons d'ouvrir l'écoute à tout le réseau, cherchées comme
    ARGUMENTS d'appel — un `host=` ou un `--host` passé à uvicorn, à un socket,
    à une configuration de lancement."""
    for relatif, arbre in _arbres():
        for appel in _appels(arbre):
            valeurs = [
                a.value
                for a in list(appel.args) + [k.value for k in appel.keywords]
                if isinstance(a, ast.Constant)
            ]
            mots_cles = {k.arg for k in appel.keywords}
            if "host" in mots_cles or "--host" in valeurs:
                assert interdit not in valeurs, f"{relatif} ouvre l'écoute"


def test_aucune_politique_cors():
    """Une politique CORS permissive rendrait les données lisibles par
    n'importe quelle page web ouverte à côté, sans rien changer à l'adresse
    d'écoute — c'est la troisième façon de franchir la ligne, et la plus
    discrète."""
    middlewares = {
        relatif
        for relatif, arbre in _arbres()
        for appel in _appels(arbre)
        if _nom_appele(appel).endswith("add_middleware")
    }

    assert middlewares == set()


def test_ce_qui_sort_est_nommement_connu():
    """La liste est nominative : un troisième émetteur devra venir écrire son
    nom ici, ce qui est précisément le moment où quelqu'un se demandera s'il
    doit exister."""
    emetteurs = {
        relatif
        for relatif, arbre in _arbres()
        for appel in _appels(arbre)
        if _nom_appele(appel).endswith(("urlopen", "requests.get", "requests.post"))
    }

    assert emetteurs == EMETTEURS_AUTORISES


def test_le_port_fixe_reste_hors_de_la_plage_ephemere():
    """LE PORT EST FIXE POUR QUE LE `localStorage` DE LA FENÊTRE SURVIVE (il est
    rangé par origine, port compris) — pas pour la confidentialité, à laquelle
    il n'a jamais rien apporté.

    HORS DE 49152-65535, la plage que Windows distribue aux connexions
    sortantes : un port pris là-dedans peut être déjà attribué à autre chose au
    démarrage, et l'application tomberait alors sur son repli une fois sur
    deux."""
    arbre = ast.parse((RACINE / LIEUR_AUTORISE).read_text(encoding="utf-8-sig"))
    ports = [
        noeud.value.value
        for noeud in ast.walk(arbre)
        if isinstance(noeud, ast.Assign)
        and any(
            isinstance(cible, ast.Name) and cible.id == "PORT_PREFERE"
            for cible in noeud.targets
        )
        and isinstance(noeud.value, ast.Constant)
    ]

    # Lu dans l'arbre plutôt qu'importé : `app_desktop` tire pywebview et
    # pythonnet à l'import, que la suite de tests n'a aucune raison d'installer.
    assert len(ports) == 1
    assert 1024 <= ports[0] < 49152
