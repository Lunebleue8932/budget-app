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
from app.routers import extensions as routeur_extensions
from app.schemas import ExtensionEtatUpdate

# Ces tests portent sur l'activation elle-même : ils doivent voir l'état réel,
# pas le « tout allumé » que conftest impose au reste de la suite.
pytestmark = pytest.mark.extensions_reelles


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


def test_une_extension_est_inactive_tant_qu_on_ne_l_a_pas_allumee(faux_projet):
    """LE DÉFAUT EST « ÉTEINTE ». Déposer un dossier ne doit pas suffire à
    faire tourner du code : depuis « lecture-de-cours », une extension peut
    ouvrir une connexion sortante, et décompresser une archive au mauvais
    endroit ne peut pas valoir consentement."""
    assert extensions.est_active("jamais-vue") is False


def test_fermer_l_annonce_n_allume_rien(faux_projet):
    """Le geste qui allume est la case à cocher, et lui seul. Fermer la fenêtre
    d'annonce — bouton, Échap, clic à côté — acquitte l'annonce et rien
    d'autre : on n'active pas quelque chose en s'en débarrassant."""
    _creer_extension(faux_projet, "extensions", "placements")

    extensions.marquer_annoncees(["placements"])

    assert extensions.est_annoncee("placements") is True
    assert extensions.est_active("placements") is False


def test_une_extension_deja_en_service_reste_allumee_apres_mise_a_jour(faux_projet):
    """Le rattrapage des installations d'avant l'opt-in.

    Avant, être présent suffisait à tourner ; rien n'était donc écrit dans
    `actives`. Appliquer le nouveau défaut tel quel éteindrait, à la faveur
    d'une mise à jour, un écran dont l'utilisateur se sert tous les jours."""
    (faux_projet / "extensions.json").write_text(
        json.dumps({"actives": {}, "annoncees": ["placements"]}), encoding="utf-8"
    )

    extensions.rattraper_etat_avant_opt_in()

    assert extensions.est_active("placements") is True


def test_le_rattrapage_n_allume_pas_une_extension_jamais_annoncee(faux_projet):
    """Une extension présente mais jamais annoncée est PRÉCISÉMENT la
    nouveauté qu'on ne veut pas allumer sans être passé par la case."""
    (faux_projet / "extensions.json").write_text(
        json.dumps({"actives": {}, "annoncees": ["placements"]}), encoding="utf-8"
    )

    extensions.rattraper_etat_avant_opt_in()

    assert extensions.est_active("lecture-de-cours") is False


def test_le_rattrapage_ne_repasse_pas_sur_une_decision(faux_projet):
    """Il tourne à CHAQUE démarrage : il ne doit rallumer que ce qui n'a jamais
    été tranché, sinon une extension éteinte à la main se rallumerait toute
    seule au lancement suivant."""
    (faux_projet / "extensions.json").write_text(
        json.dumps({"actives": {"placements": False}, "annoncees": ["placements"]}),
        encoding="utf-8",
    )

    extensions.rattraper_etat_avant_opt_in()
    extensions.rattraper_etat_avant_opt_in()

    assert extensions.est_active("placements") is False


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
    """Un fichier corrompu ne doit pas être lu comme une autorisation : le
    défaut est « éteinte », et l'utilisateur rallume ce qu'il veut depuis les
    Paramètres — geste explicite, exactement comme la première fois."""
    (faux_projet / "extensions.json").write_text("pas du JSON", encoding="utf-8")

    assert extensions.est_active("placements") is False


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
    extensions.definir_active("placements", True)
    dependance()  # allumée : ne lève pas

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


# ---------- Dépendances entre extensions ----------


def test_sans_dependance_declaree_rien_a_verifier(faux_projet):
    _creer_extension(faux_projet, "extensions", "seule")
    extensions.decouvrir()
    assert extensions.dependances_satisfaites("seule") is True


def test_une_dependance_eteinte_ne_satisfait_pas(faux_projet):
    """Présente sur le disque ne suffit pas : une greffe a besoin d'un hôte qui
    TOURNE, sinon elle n'a ni écran où s'accrocher ni données à mettre à
    jour."""
    _creer_extension(faux_projet, "extensions", "hote")
    _creer_extension(
        faux_projet, "extensions", "greffe", manifeste={"requiert_une_de": ["hote"]}
    )
    extensions.decouvrir()

    assert extensions.dependances_satisfaites("greffe") is False
    extensions.definir_active("hote", True)
    assert extensions.dependances_satisfaites("greffe") is True


def test_une_seule_des_dependances_suffit(faux_projet):
    """« au moins une » : « Lecture de cours » sert dès qu'il y a des titres OU
    des monnaies à mettre à jour."""
    _creer_extension(faux_projet, "extensions", "titres")
    _creer_extension(faux_projet, "extensions", "devises")
    _creer_extension(
        faux_projet,
        "extensions",
        "lecture",
        manifeste={"requiert_une_de": ["titres", "devises"]},
    )
    extensions.decouvrir()

    assert extensions.dependances_satisfaites("lecture") is False
    extensions.definir_active("devises", True)
    assert extensions.dependances_satisfaites("lecture") is True


def test_une_dependance_absente_du_disque_ne_satisfait_pas(faux_projet):
    """Un identifiant qui ne correspond à rien n'allume rien, même si le
    fichier d'état porte une décision à son nom (extension retirée depuis)."""
    _creer_extension(
        faux_projet, "extensions", "greffe", manifeste={"requiert_une_de": ["fantome"]}
    )
    extensions.decouvrir()
    extensions.definir_active("fantome", True)

    assert extensions.dependances_satisfaites("greffe") is False


def test_une_extension_s_eteint_avec_sa_dependance(faux_projet):
    """Sa case reste cochée — on n'a pas pris de décision à sa place — mais
    elle ne tourne plus : ses routes répondent 404 tant que l'hôte est éteint,
    et tout revient quand il se rallume."""
    _creer_extension(faux_projet, "extensions", "hote")
    _creer_extension(
        faux_projet, "extensions", "greffe", manifeste={"requiert_une_de": ["hote"]}
    )
    extensions.decouvrir()
    extensions.definir_active("hote", True)
    extensions.definir_active("greffe", True)
    assert extensions.est_active("greffe") is True

    extensions.definir_active("hote", False)
    assert extensions.est_active("greffe") is False
    # La décision de l'utilisateur n'a pas été réécrite.
    assert extensions._charger_etat()["actives"]["greffe"] is True

    extensions.definir_active("hote", True)
    assert extensions.est_active("greffe") is True


def test_le_routeur_refuse_d_allumer_une_extension_sans_hote(faux_projet):
    """Une case qu'on coche et qui ne fait rien est pire qu'un refus : le refus
    dit ce qui manque."""
    _creer_extension(faux_projet, "extensions", "hote")
    _creer_extension(
        faux_projet, "extensions", "greffe", manifeste={"requiert_une_de": ["hote"]}
    )
    extensions.decouvrir()

    with pytest.raises(HTTPException) as erreur:
        routeur_extensions.set_extension("greffe", ExtensionEtatUpdate(actif=True), db=None)
    assert erreur.value.status_code == 409
    assert "hote" in erreur.value.detail
    # Rien n'a été enregistré : on ne garde pas une décision qu'on a refusée.
    assert extensions._charger_etat()["actives"].get("greffe") is None


def test_eteindre_une_extension_sans_hote_reste_possible(faux_projet):
    """Le refus ne porte que sur l'allumage : on doit toujours pouvoir décocher,
    ne serait-ce que pour défaire un état hérité d'une version antérieure."""
    _creer_extension(
        faux_projet, "extensions", "greffe", manifeste={"requiert_une_de": ["hote"]}
    )
    extensions.decouvrir()
    reponse = routeur_extensions.set_extension(
        "greffe", ExtensionEtatUpdate(actif=False), db=None
    )
    assert reponse["actif"] is False


def test_la_liste_dit_ce_qui_manque(faux_projet):
    """Le frontend grise la case ET affiche pourquoi : les deux informations
    voyagent avec l'extension."""
    _creer_extension(faux_projet, "extensions", "hote")
    _creer_extension(
        faux_projet, "extensions", "greffe", manifeste={"requiert_une_de": ["hote"]}
    )

    par_id = {e["id"]: e for e in routeur_extensions.list_extensions(db=None)}
    assert par_id["greffe"]["requiert_une_de"] == ["hote"]
    assert par_id["greffe"]["dependances_ok"] is False
    assert par_id["hote"]["requiert_une_de"] == []
    assert par_id["hote"]["dependances_ok"] is True


def test_un_manifeste_mal_forme_ne_declare_aucune_dependance(faux_projet):
    """Comme le reste du manifeste : une valeur aberrante est ignorée, pas
    fatale. Une extension mal écrite ne bloque pas l'application."""
    _creer_extension(
        faux_projet, "extensions", "bancale", manifeste={"requiert_une_de": "hote"}
    )
    trouvees = extensions.decouvrir()
    assert trouvees["bancale"].requiert_une_de == []
    assert extensions.dependances_satisfaites("bancale") is True


# ---------- Refus d'ÉTEINDRE, dit par l'extension elle-même ----------
#
# Le pendant du refus d'allumer : là où celui-ci vient du noyau (une dépendance
# manquante, qu'il sait vérifier seul), celui-là ne peut venir que de
# l'extension — elle seule sait ce que son extinction rendrait faux. Le noyau
# ne fait que lui poser la question.

# Le squelette d'un module backend : le `router` que le noyau exige, plus ce
# que le test veut y ajouter.
BACKEND_MINIMAL = """from fastapi import APIRouter
router = APIRouter()
"""


def _extension_avec_garde(faux_projet, identifiant, corps=""):
    """Une extension dont le module backend expose (ou non) une garde
    d'extinction, chargée comme au démarrage de l'application."""
    _creer_extension(
        faux_projet,
        "extensions",
        identifiant,
        manifeste={"backend": "backend.py"},
        backend__py=BACKEND_MINIMAL + corps,
    )
    extension = extensions.decouvrir()[identifiant]
    _, erreur = extensions.charger_routeur(extension)
    assert erreur is None, erreur
    return extension


def test_sans_garde_declaree_rien_n_empeche_d_eteindre(faux_projet):
    """LE CAS ORDINAIRE : désactiver ne supprime rien et ne se discute pas.
    Une extension qui ne déclare pas de garde s'éteint sans question."""
    _extension_avec_garde(faux_projet, "ordinaire")
    assert extensions.obstacle_a_la_desactivation("ordinaire", None) is None


def test_une_extension_peut_refuser_son_extinction(faux_projet):
    _extension_avec_garde(
        faux_projet,
        "verrouillee",
        """
def obstacle_a_la_desactivation(db):
    return "des données en dépendent"
""",
    )
    extensions.definir_active("verrouillee", True)

    with pytest.raises(HTTPException) as erreur:
        routeur_extensions.set_extension(
            "verrouillee", ExtensionEtatUpdate(actif=False), db=None
        )
    assert erreur.value.status_code == 409
    assert "des données en dépendent" in erreur.value.detail
    # Le refus n'a rien changé : l'extension tourne toujours.
    assert extensions.est_active("verrouillee") is True


def test_la_garde_ne_gene_pas_l_allumage(faux_projet):
    """Elle ne porte que sur l'extinction : rallumer une extension éteinte n'a
    pas à être arbitré par ce que son extinction casserait."""
    _extension_avec_garde(
        faux_projet,
        "verrouillee",
        """
def obstacle_a_la_desactivation(db):
    return "toujours non"
""",
    )
    reponse = routeur_extensions.set_extension(
        "verrouillee", ExtensionEtatUpdate(actif=True), db=None
    )
    assert reponse["actif"] is True


def test_une_garde_qui_casse_laisse_eteindre(faux_projet):
    """Le panneau des Paramètres est justement l'endroit d'où l'on éteint ce qui
    ne va pas : une garde qui lève ne doit pas transformer un bug en impasse."""
    _extension_avec_garde(
        faux_projet,
        "bancale",
        """
def obstacle_a_la_desactivation(db):
    raise RuntimeError("boum")
""",
    )
    extensions.definir_active("bancale", True)

    assert extensions.obstacle_a_la_desactivation("bancale", None) is None
    reponse = routeur_extensions.set_extension(
        "bancale", ExtensionEtatUpdate(actif=False), db=None
    )
    assert reponse["actif"] is False


def test_la_liste_dit_ce_qui_empeche_d_eteindre(faux_projet):
    """Comme pour une dépendance manquante : la case est grisée ET dit pourquoi,
    plutôt que de refuser au moment du clic."""
    _extension_avec_garde(
        faux_projet,
        "verrouillee",
        """
def obstacle_a_la_desactivation(db):
    return "deux monnaies en service"
""",
    )
    extensions.definir_active("verrouillee", True)

    par_id = {e["id"]: e for e in routeur_extensions.list_extensions(db=None)}
    assert par_id["verrouillee"]["obstacle_desactivation"] == "deux monnaies en service"


def test_une_extension_eteinte_n_est_pas_interrogee(faux_projet):
    """Demander à une extension éteinte ce qui empêche de l'éteindre n'a pas de
    sens, et sa garde irait interroger la base pour rien."""
    _extension_avec_garde(
        faux_projet,
        "verrouillee",
        """
def obstacle_a_la_desactivation(db):
    raise AssertionError("ne devrait pas être appelée")
""",
    )
    par_id = {e["id"]: e for e in routeur_extensions.list_extensions(db=None)}
    assert par_id["verrouillee"]["obstacle_desactivation"] is None
