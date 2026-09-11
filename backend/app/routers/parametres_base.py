"""Panneau « Base de données » — DU NOYAU, et non plus une extension de dev.

CE QUI A CHANGÉ ET POURQUOI. Ces routes vivaient dans `extensions-dev/`, au
motif qu'ouvrir une base par son chemin est un outil de mise au point : livré à
tout le monde, ça offrait surtout un bon moyen de travailler sans s'en rendre
compte sur la mauvaise base.

Le raisonnement tenait tant que la base par défaut était sûre. Elle ne l'est
pas : elle vit dans le dossier de l'application, que la prochaine mise à jour
remplace — systématiquement sur macOS, où elle est DANS le bundle `.app`.
Choisir où ranger ses données cesse alors d'être un confort de développeur pour
devenir la seule chose qui les protège, et une fonctionnalité que l'utilisateur
n'a pas ne le protège de rien.

CONSÉQUENCE SUR LA MÉMORISATION. L'extension ne retenait délibérément aucun
chemin au-delà de la session : redémarrer revenait toujours à la base de test.
C'était la bonne règle pour un outil de dev, et c'est exactement l'inverse de
ce qu'il faut ici — une base qu'on doit redésigner à chaque lancement n'est pas
une base, c'est une manipulation. Le choix est donc écrit dans le fichier de
configuration de l'utilisateur (cf. app/config_utilisateur.py), hors du dossier
de l'application pour survivre à ce qui l'efface.

UN CHEMIN À RISQUE N'EST JAMAIS MÉMORISÉ : le retenir reviendrait à graver le
problème qu'on cherche à résoudre. Revenir à la base de test OUBLIE au
contraire le choix, et le prochain démarrage redemandera où ranger la base.
"""
from fastapi import APIRouter, HTTPException

from .. import config_utilisateur, database, schemas

router = APIRouter(prefix="/parametres", tags=["parametres"])


def _memoriser(chemin) -> bool:
    """Retient `chemin` pour les prochains lancements — sauf s'il est à risque,
    auquel cas on efface au contraire ce qui était retenu. Rend False quand
    l'écriture a échoué (profil en lecture seule) : la bascule ne vaut alors
    que pour la session, et l'écran le dit.

    UNE INSTALLATION DE MISE AU POINT N'ÉCRIT JAMAIS DANS LE PROFIL — ni le
    bundle construit localement, ni le serveur de dev lancé depuis le dépôt. Le
    fichier de configuration est partagé par toutes les copies de l'application
    présentes sur la machine : laisser l'une d'elles y écrire reviendrait à faire
    pointer la VRAIE application sur la base qu'on venait d'ouvrir pour un essai.
    Elles se comportent donc comme l'ancienne extension développeur — la bascule
    vaut pour la session, et rien au-delà (cf. database.mode_developpement).

    LE SERVEUR DE DEV ÉTAIT LE TROU. Il n'est pas « gelé », donc
    `est_build_de_test` répondait faux pour lui et il écrivait le profil comme
    une version publiée — alors même que `_resoudre_chemin_demarrage` ignore
    délibérément ce qu'il y écrit. Le chemin retenu ne servait donc jamais à
    celui qui l'avait posé, et servait à la seule installation qui n'avait rien
    demandé."""
    if database.mode_developpement():
        return False
    if database.chemin_a_risque(chemin):
        config_utilisateur.oublier_chemin_base()
        return True
    return config_utilisateur.ecrire(**{config_utilisateur.CLE_CHEMIN_BASE: str(chemin)})


def _lire_etat(migration=None, choix_memorise: bool = True) -> schemas.BaseDonneesRead:
    """`migration` = (sauvegarde, révision quittée) quand la bascule qui vient
    d'avoir lieu a mis le schéma à jour ; None pour une simple lecture."""
    chemin_actuel = database.get_chemin_actuel()
    sauvegarde, revision_quittee = migration or (None, None)
    introuvable = database.BASE_MEMORISEE_INTROUVABLE
    return schemas.BaseDonneesRead(
        chemin_actuel=str(chemin_actuel),
        chemin_dev=str(database.DEV_DB_PATH),
        est_dev=chemin_actuel == database.DEV_DB_PATH,
        revision_base=database.revision_actuelle(chemin_actuel),
        revision_app=database.revision_cible(),
        migration_appliquee=sauvegarde is not None,
        sauvegarde=str(sauvegarde) if sauvegarde else None,
        revision_quittee=revision_quittee,
        a_risque=database.chemin_a_risque(chemin_actuel),
        configuration_requise=database.configuration_requise(),
        chemin_propose=str(database.emplacement_propose()),
        dossier_application=str(database.dossier_application()),
        base_memorisee_introuvable=str(introuvable) if introuvable else None,
        choix_memorise=choix_memorise,
        build_de_test=database.est_build_de_test(),
        mode_developpement=database.mode_developpement(),
    )


@router.get("/base", response_model=schemas.BaseDonneesRead)
def get_base():
    return _lire_etat()


@router.put("/base", response_model=schemas.BaseDonneesRead)
def set_base(payload: schemas.BaseDonneesUpdate):
    """Bascule vers un fichier .db DÉJÀ EXISTANT — jamais de création
    implicite : un chemin fautif doit échouer clairement plutôt que fabriquer
    une base vide (cf. database.changer_base ; la création passe par
    /parametres/base/installer, qui la demande explicitement).

    La bascule met AUSSI le schéma de la base visée à jour : sans cela, une
    base rejointe après le démarrage restait à son ancienne version sous une
    application neuve et répondait 500 sur ses pages principales. Une copie est
    prise avant toute migration, et son chemin renvoyé ici."""
    try:
        chemin = database.changer_base(payload.chemin)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    return _lire_etat(database.derniere_migration(), _memoriser(chemin))


@router.post("/base/reinitialiser", response_model=schemas.BaseDonneesRead)
def reinitialiser_base():
    """Revient à la base NATIVE de l'application — celle qui vit à côté de
    l'exécutable en bundle, dans le dépôt en développement — et oublie le chemin
    retenu.

    RÉSERVÉE AUX INSTALLATIONS DE MISE AU POINT (cf.
    database.mode_developpement). Sur une version publiée, la base native est
    celle du dossier que la mise à jour remplace : un bouton qui y ramène en un
    clic ne serait pas un raccourci, ce serait la façon la plus courte de perdre
    ses données.

    CE QU'ELLE ÉVITE D'ATTENDRE. Le redémarrage suffisait déjà à revenir à la
    base native, `_resoudre_chemin_demarrage` coupant court dans les deux cas.
    Mais tant qu'on n'a pas redémarré, le processus SERT toujours la base
    personnelle : elle reste ouverte, et tout ce qui interroge l'API la lit. Le
    reset ferme cette fenêtre-là tout de suite, sans quitter l'application."""
    if not database.mode_developpement():
        raise HTTPException(
            status_code=403,
            detail=(
                "Le retour à la base de l'application n'existe qu'en mode "
                "développement : sur une version publiée, cette base vit dans le "
                "dossier que la prochaine mise à jour remplace."
            ),
        )
    # OUBLIER AVANT DE BASCULER, et le faire même si la bascule échoue ensuite :
    # ce qui est retenu dans le profil est précisément ce qu'on veut cesser
    # d'ouvrir. (En mode développement `_memoriser` n'écrit plus rien, mais une
    # session antérieure a pu laisser un chemin derrière elle.)
    config_utilisateur.oublier_chemin_base()
    try:
        database.changer_base(str(database.DEV_DB_PATH))
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    return _lire_etat(database.derniere_migration(), choix_memorise=False)


@router.post("/base/installer", response_model=schemas.BaseDonneesRead)
def installer_base(payload: schemas.BaseDonneesInstaller):
    """Met la base en place à l'emplacement choisi : ouvre le fichier s'il est
    déjà là, déplace la base actuelle si on le demande, en crée une neuve
    sinon. C'est la route de l'écran de premier démarrage.

    LE DÉPLACEMENT EST LE CAS NORMAL. Au premier lancement, l'application a
    déjà créé et rempli sa base par défaut (schéma et valeurs initiales, cf.
    desktop/app_desktop.py) : en créer une seconde, vide, et abandonner la
    première dans le dossier que la mise à jour effacera serait le plus mauvais
    des deux mondes."""
    source = str(database.get_chemin_actuel()) if payload.deplacer_actuelle else None
    try:
        chemin, action = database.installer_base(payload.chemin, source)
    except FileNotFoundError as exc:
        raise HTTPException(status_code=404, detail=str(exc))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc))
    except OSError as exc:
        raise HTTPException(status_code=400, detail=f"Impossible d'écrire à cet emplacement : {exc}")

    etat = _lire_etat(database.derniere_migration(), _memoriser(chemin))
    # Lequel des trois gestes a eu lieu : le frontend ne peut pas le déduire,
    # il ne sait pas si le fichier existait avant sa requête. « Base déplacée »
    # et « base créée » n'appellent pas le même message — le premier dit que
    # les données ont suivi, le second qu'on repart de zéro.
    etat.action = action
    return etat
