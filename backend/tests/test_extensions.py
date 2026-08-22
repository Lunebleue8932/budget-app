"""Le mécanisme d'extensions : découverte, activation, service des fichiers.

Ces tests portent sur le NOYAU du mécanisme, pas sur les extensions livrées :
ils fabriquent leurs propres dossiers d'extension dans un répertoire temporaire
plutôt que de s'appuyer sur « placements » ou « base-de-donnees ». Une
extension retirée ou renommée ne doit pas casser les tests du mécanisme qui la
porte.
"""
import json

import pytest
from fastapi import HTTPException

from app import extensions


@pytest.fixture()
def faux_projet(tmp_path, monkeypatch):
    """Une racine de projet jetable, avec ses deux dossiers d'extensions.

    `_racine_projet` est détourné plutôt que le disque réel : les tests ne
    doivent ni lire les extensions installées, ni pouvoir en écrire une."""
    (tmp_path / "extensions").mkdir()
    (tmp_path / "extensions-dev").mkdir()
    monkeypatch.setattr(extensions, "_racine_projet", lambda: tmp_path)
    # L'état activé/désactivé vit à côté de la base : redirigé lui aussi, sinon
    # un test écrirait dans le fichier de l'installation réelle.
    monkeypatch.setattr(extensions, "_fichier_etat", lambda: tmp_path / "extensions.json")
    return tmp_path


def _creer_extension(racine, dossier, identifiant, manifeste=None, **fichiers):
    cible = racine / dossier / identifiant
    cible.mkdir(parents=True)
    contenu = {"nom": identifiant.title(), "version": "1.0.0"}
    contenu.update(manifeste or {})
    (cible / "extension.json").write_text(json.dumps(contenu), encoding="utf-8")
    for nom, texte in fichiers.items():
        (cible / nom.replace("__", ".")).write_text(texte, encoding="utf-8")
    return cible


# ---------- Découverte ----------


def test_aucune_extension_ne_casse_rien(faux_projet):
    """LE CAS PAR DÉFAUT, pas un cas limite : l'application est livrée sans
    aucune extension, le dossier arrive vide et le reste tant que l'utilisateur
    n'y dépose rien."""
    assert extensions.decouvrir() == {}


def test_le_dossier_extensions_est_cree_s_il_manque(faux_projet):
    """L'application est livrée SANS extension mais AVEC le dossier : un
    dossier absent se lirait comme « cette version n'en accepte pas », alors
    qu'il ne manque qu'un endroit où les déposer."""
    import shutil

    shutil.rmtree(faux_projet / "extensions")
    assert not (faux_projet / "extensions").exists()

    dossier = extensions.preparer_dossiers()

    assert dossier.is_dir()
    # `extensions-dev/` n'est jamais créé : il n'a de sens que sur une machine
    # de développement.
    assert dossier.name == "extensions"


def test_preparer_les_dossiers_est_idempotent(faux_projet):
    """Appelé à chaque démarrage : un dossier déjà là ne doit ni lever ni être
    vidé."""
    (faux_projet / "extensions" / "temoin.txt").write_text("x", encoding="utf-8")

    extensions.preparer_dossiers()
    extensions.preparer_dossiers()

    assert (faux_projet / "extensions" / "temoin.txt").is_file()


def test_decouvre_les_deux_dossiers_et_distingue_leur_type(faux_projet):
    _creer_extension(faux_projet, "extensions", "placements")
    _creer_extension(faux_projet, "extensions-dev", "outil-interne")

    trouvees = extensions.decouvrir()

    assert set(trouvees) == {"placements", "outil-interne"}
    assert trouvees["placements"].type == "standard"
    assert trouvees["outil-interne"].type == "developpeur"


def test_un_dossier_sans_manifeste_est_ignore(faux_projet):
    """Un README, un dossier de travail ou un __pycache__ traînant dans
    `extensions/` ne doit pas être pris pour une extension."""
    (faux_projet / "extensions" / "notes").mkdir()
    (faux_projet / "extensions" / "notes" / "memo.txt").write_text("x", encoding="utf-8")

    assert extensions.decouvrir() == {}


def test_un_manifeste_illisible_est_ignore_sans_tout_casser(faux_projet):
    """Une extension mal formée ne doit pas empêcher les autres d'exister :
    sinon un fichier mal enregistré rendrait le budget entier inaccessible."""
    _creer_extension(faux_projet, "extensions", "correcte")
    cassee = faux_projet / "extensions" / "cassee"
    cassee.mkdir()
    (cassee / "extension.json").write_text("{ ceci n'est pas du JSON", encoding="utf-8")

    trouvees = extensions.decouvrir()

    assert set(trouvees) == {"correcte"}


def test_une_extension_dev_ne_masque_pas_une_extension_livree(faux_projet):
    """`extensions/` est scanné en premier : un dossier de développement
    homonyme ne peut pas remplacer en douce une extension publiée."""
    _creer_extension(faux_projet, "extensions", "placements", {"nom": "La vraie"})
    _creer_extension(faux_projet, "extensions-dev", "placements", {"nom": "La fausse"})

    trouvees = extensions.decouvrir()

    assert trouvees["placements"].nom == "La vraie"
    assert trouvees["placements"].type == "standard"


# ---------- Activation ----------


def test_une_extension_est_active_par_defaut(faux_projet):
    """Découvrir une extension dans les Paramètres pour l'allumer supposerait
    de savoir qu'elle existe : c'est la désactivation qui est un choix."""
    assert extensions.est_active("jamais-vue") is True


def test_desactiver_puis_reactiver(faux_projet):
    extensions.definir_active("placements", False)
    assert extensions.est_active("placements") is False

    extensions.definir_active("placements", True)
    assert extensions.est_active("placements") is True


def test_l_etat_survit_a_un_redemarrage(faux_projet):
    """L'état est un fichier, pas une variable en mémoire : il doit se relire
    tel quel au lancement suivant."""
    extensions.definir_active("placements", False)

    # Relecture depuis le disque, sans passer par le cache d'un appel précédent.
    contenu = json.loads((faux_projet / "extensions.json").read_text(encoding="utf-8"))
    assert contenu["actives"] == {"placements": False}
    assert extensions.est_active("placements") is False


def test_un_fichier_d_etat_abime_laisse_les_defauts(faux_projet):
    """Mieux vaut tout allumer que tout éteindre : un fichier corrompu ne doit
    pas faire disparaître les fonctionnalités sans explication."""
    (faux_projet / "extensions.json").write_text("pas du JSON", encoding="utf-8")

    assert extensions.est_active("placements") is True


def test_l_ancien_format_du_fichier_d_etat_reste_lu(faux_projet):
    """Le fichier était un simple {id: bool} avant l'ajout des annonces. Une
    installation existante doit garder ses désactivations plutôt que de tout
    rallumer sans prévenir."""
    (faux_projet / "extensions.json").write_text(
        json.dumps({"placements": False, "autre": True}), encoding="utf-8"
    )

    assert extensions.est_active("placements") is False
    assert extensions.est_active("autre") is True
    # Aucune annonce dans l'ancien format : tout est donc à annoncer.
    assert extensions.est_annoncee("placements") is False


def test_le_fichier_est_reecrit_au_nouveau_format(faux_projet):
    (faux_projet / "extensions.json").write_text(
        json.dumps({"placements": False}), encoding="utf-8"
    )

    extensions.definir_active("placements", True)

    contenu = json.loads((faux_projet / "extensions.json").read_text(encoding="utf-8"))
    assert contenu == {"actives": {"placements": True}, "annoncees": []}


# ---------- Annonce au lancement ----------


def test_une_extension_jamais_vue_est_a_annoncer(faux_projet):
    """C'est ce drapeau qui déclenche la fenêtre de lancement : une extension
    qu'on vient de déposer doit se signaler."""
    assert extensions.est_annoncee("placements") is False


def test_marquer_annoncee_empeche_de_la_reannoncer(faux_projet):
    _creer_extension(faux_projet, "extensions", "placements")

    extensions.marquer_annoncees(["placements"])

    assert extensions.est_annoncee("placements") is True


def test_l_annonce_survit_a_un_redemarrage(faux_projet):
    """Retenu dans un fichier, pas en mémoire : c'est tout l'objet du
    changement — ne plus revoir la fenêtre à chaque lancement."""
    _creer_extension(faux_projet, "extensions", "placements")
    extensions.marquer_annoncees(["placements"])

    contenu = json.loads((faux_projet / "extensions.json").read_text(encoding="utf-8"))
    assert contenu["annoncees"] == ["placements"]


def test_annoncer_ne_touche_pas_a_l_activation(faux_projet):
    """Les deux réglages vivent dans le même fichier : écrire l'un ne doit pas
    effacer l'autre."""
    _creer_extension(faux_projet, "extensions", "placements")
    extensions.definir_active("placements", False)

    extensions.marquer_annoncees(["placements"])

    assert extensions.est_active("placements") is False
    assert extensions.est_annoncee("placements") is True


def test_une_extension_retiree_puis_remise_est_de_nouveau_annoncee(faux_projet):
    """La remettre est un geste délibéré : on veut la confirmation qu'il a été
    pris en compte. C'est aussi ce qui empêche le fichier de gonfler
    indéfiniment au fil des essais."""
    _creer_extension(faux_projet, "extensions", "placements")
    extensions.marquer_annoncees(["placements"])
    assert extensions.est_annoncee("placements") is True

    # L'utilisateur retire le dossier, puis en installe un autre.
    import shutil

    shutil.rmtree(faux_projet / "extensions" / "placements")
    _creer_extension(faux_projet, "extensions", "autre")
    extensions.marquer_annoncees(["autre"])

    # « placements » a été oubliée : la redéposer la fera réannoncer.
    _creer_extension(faux_projet, "extensions", "placements")
    assert extensions.est_annoncee("placements") is False
    assert extensions.est_annoncee("autre") is True


def test_le_drapeau_nouvelle_est_expose_au_frontend(faux_projet):
    _creer_extension(faux_projet, "extensions", "placements")
    extension = extensions.decouvrir()["placements"]

    assert extension.en_dict(actif=True, annoncee=False)["nouvelle"] is True
    assert extension.en_dict(actif=True, annoncee=True)["nouvelle"] is False


def test_la_dependance_refuse_une_extension_desactivee(faux_projet):
    dependance = extensions.exiger_extension("placements")
    dependance()  # active par défaut : ne lève pas

    extensions.definir_active("placements", False)

    with pytest.raises(HTTPException) as erreur:
        dependance()
    # 404 et non 403 : une fonctionnalité éteinte n'existe pas, elle n'est pas
    # « interdite » — il n'y a aucune notion de droit ici.
    assert erreur.value.status_code == 404


# ---------- Chargement du module backend ----------


def test_charge_le_routeur_d_une_extension(faux_projet):
    _creer_extension(
        faux_projet,
        "extensions",
        "demo",
        {"backend": "backend.py"},
        backend__py=(
            "from fastapi import APIRouter\n"
            "router = APIRouter(prefix='/demo')\n"
            "@router.get('')\n"
            "def lire():\n"
            "    return {'ok': True}\n"
        ),
    )
    extension = extensions.decouvrir()["demo"]

    routeur, erreur = extensions.charger_routeur(extension)

    assert erreur is None
    assert routeur is not None


def test_une_extension_sans_backend_est_legitime(faux_projet):
    """Une extension purement frontend (un thème, un écran de lecture) n'a
    aucune route à ajouter : ce n'est pas une erreur."""
    _creer_extension(faux_projet, "extensions", "theme")
    extension = extensions.decouvrir()["theme"]

    routeur, erreur = extensions.charger_routeur(extension)

    assert routeur is None
    assert erreur is None


def test_un_backend_qui_casse_est_rapporte_sans_lever(faux_projet):
    """L'erreur remonte à l'appelant, qui l'affichera dans les Paramètres —
    elle ne se propage pas jusqu'à empêcher l'application de démarrer."""
    _creer_extension(
        faux_projet,
        "extensions",
        "cassee",
        {"backend": "backend.py"},
        backend__py="raise RuntimeError('boum')\n",
    )
    extension = extensions.decouvrir()["cassee"]

    routeur, erreur = extensions.charger_routeur(extension)

    assert routeur is None
    assert "RuntimeError" in erreur and "boum" in erreur


def test_un_backend_sans_router_est_rapporte(faux_projet):
    _creer_extension(
        faux_projet,
        "extensions",
        "sans-routeur",
        {"backend": "backend.py"},
        backend__py="valeur = 42\n",
    )
    extension = extensions.decouvrir()["sans-routeur"]

    routeur, erreur = extensions.charger_routeur(extension)

    assert routeur is None
    assert "router" in erreur


# ---------- Service des fichiers frontend ----------


def test_sert_un_fichier_de_l_extension(faux_projet):
    _creer_extension(faux_projet, "extensions", "demo", None, page__html="<section></section>")
    extension = extensions.decouvrir()["demo"]

    assert extension.chemin_frontend("page.html") is not None


def test_refuse_de_sortir_du_dossier_de_l_extension(faux_projet):
    """LE CONTRÔLE QUI COMPTE : ce chemin vient d'une URL. Sans lui, un `..`
    laisserait lire n'importe quel fichier de la machine — la base de données
    comprise."""
    _creer_extension(faux_projet, "extensions", "demo")
    (faux_projet / "secret.txt").write_text("données privées", encoding="utf-8")
    extension = extensions.decouvrir()["demo"]

    for tentative in ("../secret.txt", "../../secret.txt", "./../secret.txt"):
        assert extension.chemin_frontend(tentative) is None


def test_un_fichier_inexistant_ne_donne_aucun_chemin(faux_projet):
    _creer_extension(faux_projet, "extensions", "demo")
    extension = extensions.decouvrir()["demo"]

    assert extension.chemin_frontend("absent.js") is None
