"""Suivi des remboursements (extension « Suivi des remboursements »).

Ce que ces tests protègent, dans l'ordre de ce qui coûterait le plus cher à
casser :

  - LES DEUX RÔLES NE SE CONFONDENT PAS. Une dépense remboursable est une
    CRÉANCE (on me rendra), un prêt reçu est une DETTE (je rendrai). Les deux
    portent leur reste dans la MÊME colonne, avec un montant positif dans les
    deux cas : c'est le TYPE qui tranche, et un signe inversé ferait dire à
    l'écran l'exact contraire de la vérité ;
  - LES RÈGLEMENTS NE COMPTENT PAS DEUX FOIS. Un remboursement reçu a déjà fait
    décroître la dette qu'il solde ; le soustraire à nouveau la retirerait deux
    fois. Même règle que `constants.TYPES_HORS_FLUX`, pour la même raison ;
  - SUPPRIMER UN PROFIL NE SUPPRIME AUCUNE OPÉRATION. Ce sont de vraies
    écritures, qui bougent de vrais soldes ;
  - L'EXTENSION NE CHANGE AUCUN CHIFFRE. Elle écrit une seule colonne ; les
    soldes, les KPI et la carte du dashboard donnent exactement la même chose
    qu'elle soit allumée ou éteinte.
"""
from datetime import date

import pytest
from fastapi import HTTPException

from app import models, schemas
from app.constants import Sens, Statut
from app.routers import operations as routeur_operations
from app.services import soldes

from .conftest import (
    charger_module_extension,
    creer_compte,
    creer_monnaie,
    get_categorie_id,
    get_monnaie_id,
    get_type_id,
)

routeur = charger_module_extension("suivi-remboursements", "routeur_suivi_remboursements.py")
service = charger_module_extension("suivi-remboursements", "service_suivi_remboursements.py")
schemas_sr = charger_module_extension("suivi-remboursements", "schemas_suivi_remboursements.py")


# ---------- Outillage ----------


def _profil(db, nom, description=""):
    return routeur.create_profil(
        schemas_sr.ProfilCreate(nom=nom, description=description), db
    )


def _operation(
    db,
    compte,
    type_code,
    montant,
    montant_du=None,
    statut=Statut.reel,
    monnaie_id=None,
    nature="Ligne",
):
    """Une opération par la route du noyau : c'est elle qui pose le sens, borne
    le montant dû et initialise le reste à rembourser."""
    est_entree = type_code in ("pret", "remboursements")
    return routeur_operations.create_operation(
        schemas.OperationCreate(
            date=date(2026, 7, 1),
            compte_id=compte.id,
            monnaie_id=monnaie_id or compte.monnaie_principale_id,
            type_id=get_type_id(db, type_code),
            categorie_id=(
                get_categorie_id(db, "Loisirs & sorties")
                if type_code in ("classique", "remboursable")
                else None
            ),
            nature=nature,
            montant=montant,
            montant_du=montant_du if montant_du is not None else montant,
            sens=Sens.entree if est_entree else Sens.depense,
            statut=statut,
        ),
        db,
    )


def _bloc(vue, monnaie_id):
    return next(bloc for bloc in vue.monnaies if bloc.monnaie_id == monnaie_id)


def _ligne(bloc, profil_id):
    return next(ligne for ligne in bloc.profils if ligne.profil_id == profil_id)


# ---------- Les deux rôles ----------


def test_une_depense_remboursable_est_une_creance(db_session):
    compte = creer_compte(db_session, "CC")
    marie = _profil(db_session, "Marie")
    operation = _operation(db_session, compte, "remboursable", 100.0)

    vue = routeur.rattacher(
        schemas_sr.RattachementInput(operation_ids=[operation.id], profil_id=marie.id),
        db_session,
    )

    ligne = _ligne(_bloc(vue, get_monnaie_id(db_session)), marie.id)
    assert ligne.a_recevoir == 100.0
    assert ligne.a_rendre == 0.0
    assert ligne.net == 100.0


def test_un_pret_recu_est_une_dette(db_session):
    """LE PIÈGE. Le montant est positif comme celui d'une dépense remboursable,
    et le reste dû vit dans la même colonne : seul le TYPE dit que celui-ci pèse
    dans l'autre sens."""
    compte = creer_compte(db_session, "CC")
    paul = _profil(db_session, "Paul")
    operation = _operation(db_session, compte, "pret", 300.0)

    vue = routeur.rattacher(
        schemas_sr.RattachementInput(operation_ids=[operation.id], profil_id=paul.id),
        db_session,
    )

    ligne = _ligne(_bloc(vue, get_monnaie_id(db_session)), paul.id)
    assert ligne.a_rendre == 300.0
    assert ligne.a_recevoir == 0.0
    assert ligne.net == -300.0


def test_un_profil_peut_porter_les_deux_a_la_fois(db_session):
    """Il me doit 100, je lui dois 30 : le net vaut 70, et les deux composantes
    restent lisibles — un net seul aurait effacé la moitié de l'histoire."""
    compte = creer_compte(db_session, "CC")
    marie = _profil(db_session, "Marie")
    creance = _operation(db_session, compte, "remboursable", 100.0)
    dette = _operation(db_session, compte, "pret", 30.0)

    vue = routeur.rattacher(
        schemas_sr.RattachementInput(
            operation_ids=[creance.id, dette.id], profil_id=marie.id
        ),
        db_session,
    )

    ligne = _ligne(_bloc(vue, get_monnaie_id(db_session)), marie.id)
    assert (ligne.a_recevoir, ligne.a_rendre, ligne.net) == (100.0, 30.0, 70.0)
    assert ligne.nb_lignes == 2


# ---------- Ce qui ne compte pas ----------


def test_un_reglement_ne_compte_dans_aucun_total(db_session):
    """Un remboursement reçu a déjà fait décroître la dette qu'il solde : le
    soustraire une seconde fois la retirerait deux fois."""
    compte = creer_compte(db_session, "CC")
    marie = _profil(db_session, "Marie")
    creance = _operation(db_session, compte, "remboursable", 100.0)
    reglement = _operation(db_session, compte, "remboursements", 40.0)

    vue = routeur.rattacher(
        schemas_sr.RattachementInput(
            operation_ids=[creance.id, reglement.id], profil_id=marie.id
        ),
        db_session,
    )

    ligne = _ligne(_bloc(vue, get_monnaie_id(db_session)), marie.id)
    # Le règlement n'est lié à aucune dépense ici : la créance vaut donc encore
    # 100, et le règlement n'en retire rien de son côté.
    assert ligne.a_recevoir == 100.0
    assert ligne.nb_lignes == 1


def test_un_reglement_reste_lisible_dans_le_detail_du_profil(db_session):
    """Le tableau dit ce qu'il RESTE, le détail ce qui s'est PASSÉ. Une ligne
    réglée doit rester visible, sinon rattacher une opération à quelqu'un
    reviendrait à la perdre de vue le jour où elle est soldée."""
    compte = creer_compte(db_session, "CC")
    marie = _profil(db_session, "Marie")
    reglement = _operation(db_session, compte, "remboursements", 40.0)
    routeur.rattacher(
        schemas_sr.RattachementInput(operation_ids=[reglement.id], profil_id=marie.id),
        db_session,
    )

    lignes = routeur.get_operations_profil(marie.id, db_session)
    assert [l.id for l in lignes] == [reglement.id]
    assert lignes[0].role == "reglement"


def test_une_dette_entierement_soldee_quitte_le_tableau(db_session):
    compte = creer_compte(db_session, "CC")
    marie = _profil(db_session, "Marie")
    operation = _operation(db_session, compte, "remboursable", 100.0)
    routeur.rattacher(
        schemas_sr.RattachementInput(operation_ids=[operation.id], profil_id=marie.id),
        db_session,
    )

    # La route rend un schéma, pas le modèle : c'est la ligne en base qu'il faut
    # solder pour que la vue la voie partir.
    db_session.get(models.Operation, operation.id).montant_a_rembourser = 0.0
    db_session.commit()

    vue = routeur.get_vue(db_session)
    assert vue.monnaies == []
    # Mais elle reste dans le détail du profil.
    assert [l.id for l in routeur.get_operations_profil(marie.id, db_session)] == [
        operation.id
    ]


def test_une_dette_previsionnelle_ne_compte_pas(db_session):
    """Rien n'a été avancé : personne ne me doit quoi que ce soit tant que
    l'argent n'est pas sorti. Même règle que la carte du dashboard."""
    compte = creer_compte(db_session, "CC")
    _operation(db_session, compte, "remboursable", 80.0, statut=Statut.previsionnel)

    assert routeur.get_vue(db_session).monnaies == []


# ---------- Ce qui n'est pas encore rangé ----------


def test_les_dettes_sans_profil_forment_leur_propre_ligne_et_la_liste_a_rattacher(
    db_session,
):
    """Sans cette ligne, un total de profils inférieur au chiffre du dashboard
    n'aurait aucune explication à l'écran."""
    compte = creer_compte(db_session, "CC")
    _operation(db_session, compte, "remboursable", 55.0, nature="Restaurant")

    vue = routeur.get_vue(db_session)
    bloc = _bloc(vue, get_monnaie_id(db_session))

    sans_profil = _ligne(bloc, None)
    assert sans_profil.a_recevoir == 55.0
    assert sans_profil.profil_nom == service.LIBELLE_SANS_PROFIL
    assert [l.nature for l in vue.a_rattacher] == ["Restaurant"]


def test_sans_profil_se_range_en_dernier(db_session):
    """C'est un reste à ranger, pas un profil : le mettre en tête sous prétexte
    que son identifiant est nul en ferait le sujet de l'écran."""
    compte = creer_compte(db_session, "CC")
    marie = _profil(db_session, "Marie")
    rattachee = _operation(db_session, compte, "remboursable", 10.0)
    _operation(db_session, compte, "remboursable", 20.0)
    routeur.rattacher(
        schemas_sr.RattachementInput(operation_ids=[rattachee.id], profil_id=marie.id),
        db_session,
    )

    bloc = _bloc(routeur.get_vue(db_session), get_monnaie_id(db_session))
    assert [l.profil_id for l in bloc.profils] == [marie.id, None]


def test_un_profil_sans_dette_n_apparait_pas_dans_le_tableau(db_session):
    """Un profil créé et jamais utilisé n'ajoute pas une ligne à zéro dans
    chaque monnaie : il reste dans les menus, et nulle part ailleurs."""
    compte = creer_compte(db_session, "CC")
    _profil(db_session, "Jamais servi")
    operation = _operation(db_session, compte, "remboursable", 10.0)
    marie = _profil(db_session, "Marie")
    routeur.rattacher(
        schemas_sr.RattachementInput(operation_ids=[operation.id], profil_id=marie.id),
        db_session,
    )

    vue = routeur.get_vue(db_session)
    bloc = _bloc(vue, get_monnaie_id(db_session))
    assert [l.profil_id for l in bloc.profils] == [marie.id]
    assert {p.nom for p in vue.profils} == {"Jamais servi", "Marie"}


# ---------- Les monnaies ----------


def test_les_monnaies_ne_s_additionnent_jamais(db_session):
    """Une dette en dollars ne compense pas une créance en euros : deux blocs,
    deux nets, aucun total entre eux."""
    euro = get_monnaie_id(db_session)
    dollar = creer_monnaie(db_session, "Dollar", "$").id
    compte = creer_compte(db_session, "CC", monnaies=[(euro, 0.0), (dollar, 0.0)])
    marie = _profil(db_session, "Marie")
    en_euros = _operation(db_session, compte, "remboursable", 100.0, monnaie_id=euro)
    en_dollars = _operation(db_session, compte, "pret", 100.0, monnaie_id=dollar)
    routeur.rattacher(
        schemas_sr.RattachementInput(
            operation_ids=[en_euros.id, en_dollars.id], profil_id=marie.id
        ),
        db_session,
    )

    vue = routeur.get_vue(db_session)
    assert _bloc(vue, euro).net == 100.0
    assert _bloc(vue, dollar).net == -100.0


# ---------- Les gardes ----------


def test_une_operation_classique_ne_se_rattache_pas(db_session):
    """Rien à réclamer ni à rendre : la ligne apparaîtrait dans le détail d'un
    profil sans peser sur aucun de ses deux totaux, et le tableau cesserait de
    s'expliquer."""
    compte = creer_compte(db_session, "CC")
    marie = _profil(db_session, "Marie")
    courses = _operation(db_session, compte, "classique", 40.0, nature="Courses")

    with pytest.raises(HTTPException) as erreur:
        routeur.rattacher(
            schemas_sr.RattachementInput(operation_ids=[courses.id], profil_id=marie.id),
            db_session,
        )
    assert erreur.value.status_code == 400
    assert "Courses" in erreur.value.detail


def test_deux_profils_ne_peuvent_pas_porter_le_meme_nom(db_session):
    """On les choisit dans un menu déroulant : deux homonymes y seraient
    impossibles à départager."""
    _profil(db_session, "Marie")
    with pytest.raises(HTTPException) as erreur:
        _profil(db_session, "Marie")
    assert erreur.value.status_code == 409


def test_rattacher_a_un_profil_inconnu_est_refuse(db_session):
    compte = creer_compte(db_session, "CC")
    operation = _operation(db_session, compte, "remboursable", 10.0)
    with pytest.raises(HTTPException) as erreur:
        routeur.rattacher(
            schemas_sr.RattachementInput(operation_ids=[operation.id], profil_id=9999),
            db_session,
        )
    assert erreur.value.status_code == 404


def test_detacher_ramene_l_operation_dans_sans_profil(db_session):
    compte = creer_compte(db_session, "CC")
    marie = _profil(db_session, "Marie")
    operation = _operation(db_session, compte, "remboursable", 10.0)
    routeur.rattacher(
        schemas_sr.RattachementInput(operation_ids=[operation.id], profil_id=marie.id),
        db_session,
    )

    vue = routeur.rattacher(
        schemas_sr.RattachementInput(operation_ids=[operation.id], profil_id=None),
        db_session,
    )
    bloc = _bloc(vue, get_monnaie_id(db_session))
    assert [l.profil_id for l in bloc.profils] == [None]


# ---------- Rien n'est perdu ----------


def test_supprimer_un_profil_detache_ses_operations_sans_les_effacer(db_session):
    """LA garantie. Ce sont de vraies écritures, qui bougent de vrais soldes :
    les perdre parce qu'on efface le nom d'une connaissance serait un désastre
    silencieux."""
    compte = creer_compte(db_session, "CC")
    marie = _profil(db_session, "Marie")
    operation = _operation(db_session, compte, "remboursable", 100.0)
    routeur.rattacher(
        schemas_sr.RattachementInput(operation_ids=[operation.id], profil_id=marie.id),
        db_session,
    )

    routeur.delete_profil(marie.id, db_session)

    encore_la = db_session.get(models.Operation, operation.id)
    assert encore_la is not None
    assert encore_la.montant == 100.0
    assert encore_la.profil_remboursement_id is None


def test_l_extension_ne_change_aucun_chiffre_du_noyau(db_session):
    """Elle écrit UNE colonne et lit tout le reste : la carte « Reste à
    rembourser » du dashboard doit donner exactement la même chose avant et
    après un rattachement."""
    compte = creer_compte(db_session, "CC")
    marie = _profil(db_session, "Marie")
    operation = _operation(db_session, compte, "remboursable", 100.0)

    avant = soldes.get_reste_a_rembourser(db_session)[get_monnaie_id(db_session)]
    routeur.rattacher(
        schemas_sr.RattachementInput(operation_ids=[operation.id], profil_id=marie.id),
        db_session,
    )
    apres = soldes.get_reste_a_rembourser(db_session)[get_monnaie_id(db_session)]

    assert avant == apres


def test_le_total_des_profils_vaut_le_chiffre_du_dashboard(db_session):
    """L'INVARIANT DE L'ÉCRAN : ce qu'il ventile doit valoir ce qu'il ventile.
    Sans lui, la carte du dashboard et le tableau afficheraient deux nombres
    différents pour la même chose, et l'un des deux semblerait faux."""
    compte = creer_compte(db_session, "CC")
    marie = _profil(db_session, "Marie")
    creance = _operation(db_session, compte, "remboursable", 100.0)
    _operation(db_session, compte, "remboursable", 45.0)  # laissée sans profil
    dette = _operation(db_session, compte, "pret", 60.0)
    routeur.rattacher(
        schemas_sr.RattachementInput(
            operation_ids=[creance.id, dette.id], profil_id=marie.id
        ),
        db_session,
    )

    monnaie_id = get_monnaie_id(db_session)
    bloc = _bloc(routeur.get_vue(db_session), monnaie_id)
    carte = soldes.get_reste_a_rembourser(db_session)[monnaie_id]

    assert bloc.total_a_recevoir == carte["a_recevoir"]
    assert bloc.total_a_rendre == carte["a_rendre"]
    assert bloc.net == carte["net"]


# ---------- Les profils eux-mêmes ----------


def test_renommer_un_profil(db_session):
    marie = _profil(db_session, "Marie", "voisine")
    lu = routeur.update_profil(
        marie.id, schemas_sr.ProfilUpdate(nom="Marie D."), db_session
    )
    assert lu.nom == "Marie D."
    # `None` veut dire « ne change pas », comme partout dans l'application.
    assert lu.description == "voisine"


def test_reordonner_les_profils(db_session):
    """Trier par nom aurait rangé en tête celui dont le prénom commence par A,
    jamais celui qu'on regarde."""
    marie = _profil(db_session, "Marie")
    paul = _profil(db_session, "Paul")

    lus = routeur.reordonner_profils(
        schemas_sr.ReordonnerProfilsInput(ordre=[paul.id, marie.id]), db_session
    )
    assert [p.id for p in lus] == [paul.id, marie.id]
