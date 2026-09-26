"""Les rangements d'écran qui désignent des lignes de la base (migration 0069).

CE QUE CETTE TABLE EXISTE POUR CORRIGER : les dossiers de la galerie des règles
rangeaient des règles PAR LEUR ID, dans le `localStorage` du navigateur. Un
identifiant de règle n'existe que dans une base précise — le même rangement
appliqué à une autre base désigne d'autres règles, ou aucune — et une base
emportée sur un second poste arrivait sans son rangement.

D'OÙ LA RÈGLE : ce qui désigne des identifiants de la base vit dans la base ; ce
qui décrit le poste (thème, langue, touche de gel, progression d'un tutoriel)
reste sur le poste.
"""
import pytest

from app import crud, models, schemas
from app.routers import preferences as routeur_preferences


def test_une_cle_jamais_ecrite_rend_null_et_non_404(db_session):
    """Un écran qui demande son rangement pour la première fois ne commet pas
    une erreur : il n'a simplement rien rangé encore. Répondre 404 aurait
    obligé chaque appelant à traiter un cas d'erreur pour décrire l'état le plus
    ordinaire qui soit."""
    lu = routeur_preferences.lire_preference("regles.dossiers", db_session)

    assert lu.cle == "regles.dossiers"
    assert lu.valeur is None


def test_ecrire_puis_relire_rend_exactement_ce_qui_a_ete_range(db_session):
    """Le serveur ne lit jamais ce qu'il range : il le rend tel quel, quelle
    que soit sa forme."""
    rangement = {"dossiers": ["Courses", "Abonnements"], "parRegle": {"3": "Courses"}}

    routeur_preferences.ecrire_preference(
        "regles.dossiers",
        schemas.PreferenceInterfaceEcriture(valeur=rangement),
        db_session,
    )

    assert routeur_preferences.lire_preference("regles.dossiers", db_session).valeur == rangement


def test_reecrire_remplace_et_ne_fusionne_pas(db_session):
    """UN REMPLACEMENT, JAMAIS UNE FUSION : l'écran lit tout d'un coup et
    réécrit tout d'un coup. Fusionner aurait rendu impossible de RETIRER quelque
    chose — un dossier supprimé serait revenu à chaque enregistrement."""
    ecrire = lambda v: routeur_preferences.ecrire_preference(
        "regles.dossiers", schemas.PreferenceInterfaceEcriture(valeur=v), db_session
    )
    ecrire({"dossiers": ["Courses", "Abonnements"], "parRegle": {"3": "Courses"}})
    ecrire({"dossiers": ["Courses"], "parRegle": {}})

    lu = routeur_preferences.lire_preference("regles.dossiers", db_session).valeur
    assert lu == {"dossiers": ["Courses"], "parRegle": {}}
    # Une seule ligne par clé : la clé EST la clé primaire.
    assert db_session.query(models.PreferenceInterface).count() == 1


def test_vider_nest_pas_la_meme_chose_que_navoir_jamais_rien_range(db_session):
    """La distinction dont dépend la reprise de l'ancien `localStorage` :
    « cette base n'a jamais rien rangé » (None) l'autorise, « on a rangé puis
    tout retiré » (un objet vide) l'interdit. Les confondre aurait fait revenir,
    au chargement suivant, les dossiers qu'on venait de supprimer."""
    assert crud.get_preference_interface(db_session, "regles.dossiers") is None

    crud.set_preference_interface(db_session, "regles.dossiers", {"dossiers": [], "parRegle": {}})

    valeur = crud.get_preference_interface(db_session, "regles.dossiers")
    assert valeur is not None
    assert valeur == {"dossiers": [], "parRegle": {}}


@pytest.mark.parametrize(
    "valeur",
    [
        [4, 2, 7],  # l'ordre des colonnes de correspondances : des id de catégorie
        12,  # le preset d'import mémorisé : un id, tout court
        None,  # « plus aucun preset » : une valeur, pas une absence de clé
    ],
)
def test_aucune_forme_nest_imposee(db_session, valeur):
    """Trois appelants, trois formes, et le serveur n'en connaît aucune. Lui en
    imposer une reviendrait à décider ici de ce qu'un écran a le droit de se
    rappeler, et à demander une migration à chaque idée d'affichage."""
    crud.set_preference_interface(db_session, "noyau.essai", valeur)

    assert crud.get_preference_interface(db_session, "noyau.essai") == valeur


def test_deux_cles_ne_se_marchent_pas_dessus(db_session):
    """L'espace de nommage de la clé est ce qui permet à une extension de se
    servir de la table du noyau sans rien lui demander (cf.
    extensions/README.md)."""
    crud.set_preference_interface(db_session, "regles.dossiers", {"a": 1})
    crud.set_preference_interface(db_session, "import-placements.preset", 3)

    assert crud.get_preference_interface(db_session, "regles.dossiers") == {"a": 1}
    assert crud.get_preference_interface(db_session, "import-placements.preset") == 3
