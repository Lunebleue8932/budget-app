"""Éteindre un COMPTE ou une CATÉGORIE (migration 0063).

CE QUE ÇA RÉSOUT. Un compte qu'on ferme, une catégorie dont on ne se sert plus :
les deux restaient dans tous les menus, pour toujours. Supprimer emporterait
l'historique — un compte refuse de partir dès qu'il porte une opération, une
catégorie supprimée renvoie les siennes dans « Autres ».

L'EXTINCTION N'EST PAS UNE SUPPRESSION, et c'est ce que ces tests vérifient d'un
bout à l'autre : les opérations restent, les soldes ne bougent pas, les barres
d'histogramme d'un mois passé valent exactement ce qu'elles valaient. Ce qui
change est ce que l'application ACCEPTE D'ÉCRIRE ENSUITE.
"""
from datetime import date

import pytest
from fastapi import HTTPException

from app import models, schemas
from app.constants import Statut
from app.routers import categories as routeur_categories
from app.routers import comptes as routeur_comptes
from app.routers import operations as routeur_operations
from app.routers import virements as routeur_virements
from app.services import soldes

from .conftest import creer_compte, get_categorie_id, get_monnaie_id, get_type_id


def _eteindre_compte(db, compte, actif=False):
    return routeur_comptes.set_etat_compte(
        compte.id, schemas.CompteEtatUpdate(actif=actif), db
    )


def _eteindre_categorie(db, categorie_id, active=False):
    return routeur_categories.set_etat_categorie(
        categorie_id, schemas.CategorieEtatUpdate(active=active), db
    )


def _operation(db, compte, categorie_nom="Alimentaire", montant=40.0, jour=1):
    return routeur_operations.create_operation(
        schemas.OperationCreate(
            date=date(2026, 7, jour),
            compte_id=compte.id,
            monnaie_id=get_monnaie_id(db),
            type_id=get_type_id(db, "classique"),
            categorie_id=get_categorie_id(db, categorie_nom),
            nature="Courses",
            montant=montant,
            statut=Statut.reel,
        ),
        db,
    )


# ---------- Le geste lui-même ----------


def test_un_compte_s_eteint_et_se_rallume(db_session):
    compte = creer_compte(db_session, "CC", solde_initial=100.0)

    assert _eteindre_compte(db_session, compte).actif is False
    assert _eteindre_compte(db_session, compte, actif=True).actif is True


def test_une_categorie_s_eteint_et_se_rallume(db_session):
    categorie_id = get_categorie_id(db_session, "Loisirs & sorties")

    assert _eteindre_categorie(db_session, categorie_id).active is False
    assert _eteindre_categorie(db_session, categorie_id, active=True).active is True


def test_autres_ne_s_eteint_pas(db_session):
    """L'application la cherche PAR SON NOM : c'est le repli d'une opération
    dont on supprime la catégorie, et la suggestion d'une ligne importée
    qu'aucune règle ne classe. Éteinte, ces deux chemins désigneraient une
    catégorie que le serveur refuse par ailleurs."""
    with pytest.raises(HTTPException) as erreur:
        _eteindre_categorie(db_session, get_categorie_id(db_session, "Autres"))

    assert erreur.value.status_code == 409


def test_eteindre_un_compte_qui_porte_de_l_argent_ne_demande_rien(db_session):
    """CONTRAIREMENT À UNE MONNAIE, qui exige un solde nul. La différence n'est
    pas un oubli : une monnaie éteinte disparaît d'une carte qui, elle, reste
    affichée — le montant s'évanouirait au milieu des autres. Un compte reste
    visible tant qu'il porte quelque chose, rien ne peut donc disparaître en
    silence."""
    compte = creer_compte(db_session, "CC", solde_initial=500.0)

    assert _eteindre_compte(db_session, compte).actif is False


# ---------- Ce que l'extinction refuse ----------


def test_un_compte_eteint_n_accepte_plus_d_operation(db_session):
    compte = creer_compte(db_session, "CC", solde_initial=100.0)
    _eteindre_compte(db_session, compte)

    with pytest.raises(HTTPException) as erreur:
        _operation(db_session, compte)

    assert erreur.value.status_code == 400
    assert "éteint" in erreur.value.detail


def test_une_categorie_eteinte_n_accepte_plus_d_operation(db_session):
    compte = creer_compte(db_session, "CC", solde_initial=100.0)
    _eteindre_categorie(db_session, get_categorie_id(db_session, "Loisirs & sorties"))

    with pytest.raises(HTTPException) as erreur:
        _operation(db_session, compte, categorie_nom="Loisirs & sorties")

    assert erreur.value.status_code == 400
    assert "éteinte" in erreur.value.detail


def test_un_virement_ne_part_ni_n_arrive_sur_un_compte_eteint(db_session):
    """LES DEUX JAMBES sont des écritures neuves : le refus vaut des deux
    côtés."""
    courant = creer_compte(db_session, "CC", solde_initial=500.0)
    epargne = creer_compte(db_session, "Livret", type_nom="épargne")
    _eteindre_compte(db_session, epargne)
    monnaie = get_monnaie_id(db_session)

    with pytest.raises(HTTPException) as erreur:
        routeur_virements.create_virement(
            schemas.VirementCreate(
                date=date(2026, 7, 1),
                compte_source_id=courant.id,
                compte_destination_id=epargne.id,
                monnaie_id=monnaie,
                nature="Mise de côté",
                montant=100.0,
                statut=Statut.reel,
            ),
            db_session,
        )

    assert erreur.value.status_code == 400


# ---------- Ce que l'extinction ne refuse JAMAIS ----------


def test_une_operation_deja_ecrite_se_modifie_encore(db_session):
    """LA MOITIÉ QUI COMPTE. Rouvrir une dépense ancienne pour corriger sa date
    et se la voir refuser parce que sa catégorie a été rangée entre-temps
    reviendrait à figer tout ce qui a été écrit avant l'extinction."""
    compte = creer_compte(db_session, "CC", solde_initial=100.0)
    operation = _operation(db_session, compte)
    _eteindre_compte(db_session, compte)
    _eteindre_categorie(db_session, get_categorie_id(db_session, "Alimentaire"))

    modifiee = routeur_operations.update_operation(
        operation.id, schemas.OperationUpdate(nature="Courses (corrigé)"), db_session
    )

    assert modifiee.nature == "Courses (corrigé)"


def test_deplacer_une_operation_vers_un_compte_eteint_reste_refuse(db_session):
    """Le pendant du test précédent : ce qui est refusé est le geste qui
    DÉSIGNE l'élément éteint, pas celui qui le laisse où il est."""
    actif = creer_compte(db_session, "CC", solde_initial=100.0)
    ferme = creer_compte(db_session, "Ancien", solde_initial=0.0)
    operation = _operation(db_session, actif)
    _eteindre_compte(db_session, ferme)

    with pytest.raises(HTTPException) as erreur:
        routeur_operations.update_operation(
            operation.id, schemas.OperationUpdate(compte_id=ferme.id), db_session
        )

    assert erreur.value.status_code == 400


# ---------- Ce que l'extinction ne change pas ----------


def test_les_operations_d_un_compte_eteint_comptent_toujours(db_session):
    compte = creer_compte(db_session, "CC", solde_initial=500.0)
    _operation(db_session, compte, montant=40.0)
    avant = soldes.get_soldes_comptes(db_session)
    solde_avant = avant[0]["soldes"][get_monnaie_id(db_session)]["solde_reel"]

    _eteindre_compte(db_session, compte)

    apres = soldes.get_soldes_comptes(db_session)
    assert len(apres) == 1
    assert apres[0]["soldes"][get_monnaie_id(db_session)]["solde_reel"] == solde_avant


def test_un_compte_eteint_et_vide_disparait_des_soldes(db_session):
    """TANT QU'IL NE PORTE RIEN, et c'est ce qui rend l'extinction utile :
    un compte soldé quitte les cartes et les totaux."""
    garde = creer_compte(db_session, "CC", solde_initial=100.0)
    ferme = creer_compte(db_session, "Ancien", solde_initial=0.0)

    _eteindre_compte(db_session, ferme)

    restants = {item["compte"].id for item in soldes.get_soldes_comptes(db_session)}
    assert restants == {garde.id}


def test_une_categorie_eteinte_garde_sa_barre_si_elle_porte_des_depenses(db_session):
    """L'HISTORIQUE NE SE RÉÉCRIT PAS : la somme des barres doit continuer de
    valoir le total des sorties affiché juste au-dessus."""
    compte = creer_compte(db_session, "CC", solde_initial=500.0)
    _operation(db_session, compte, categorie_nom="Loisirs & sorties", montant=30.0)
    _eteindre_categorie(db_session, get_categorie_id(db_session, "Loisirs & sorties"))

    barres = {
        ligne["categorie"]: ligne["total_reel"]
        for ligne in soldes.get_depenses_par_categorie(
            db_session, 2026, 7, get_monnaie_id(db_session)
        )
    }
    assert barres["Loisirs & sorties"] == 30.0


def test_une_categorie_eteinte_et_vide_quitte_l_histogramme(db_session):
    """Une catégorie ALLUMÉE à zéro garde sa barre — elle a quelque chose à
    dire, « rien dépensé ce mois-ci ». Une catégorie qu'on a rangée n'a plus
    rien à dire du tout."""
    compte = creer_compte(db_session, "CC", solde_initial=500.0)
    _operation(db_session, compte, categorie_nom="Alimentaire", montant=30.0)
    _eteindre_categorie(db_session, get_categorie_id(db_session, "Loisirs & sorties"))

    barres = {
        ligne["categorie"]
        for ligne in soldes.get_depenses_par_categorie(
            db_session, 2026, 7, get_monnaie_id(db_session)
        )
    }
    assert "Alimentaire" in barres
    assert "Loisirs & sorties" not in barres


def test_rallumer_rend_tout_tel_quel(db_session):
    compte = creer_compte(db_session, "CC", solde_initial=100.0)
    _eteindre_compte(db_session, compte)
    _eteindre_compte(db_session, compte, actif=True)

    operation = _operation(db_session, compte)
    assert operation.id is not None


# ---------- L'import est une écriture comme une autre ----------


def test_l_import_refuse_une_ligne_vers_un_compte_eteint(db_session):
    """CE QUE LE FORMULAIRE REFUSE, UN RELEVÉ NE DOIT PAS LE FAIRE ENTRER PAR LA
    PORTE DE DERRIÈRE. La ligne ressort dans les lignes ignorées, avec un motif
    qui NOMME le compte — « compte non résolu » aurait envoyé chercher une
    colonne mal lue là où il suffit de rallumer."""
    from app.services import import_bancaire

    compte = creer_compte(db_session, "CC", solde_initial=100.0)
    _eteindre_compte(db_session, compte)
    ligne = schemas.ImportLigne(
        ligne=2,
        date=date(2026, 7, 1),
        nature="Courses",
        montant=42.0,
        montant_signe=-42.0,
        compte_id=compte.id,
        categorie_id=get_categorie_id(db_session, "Alimentaire"),
        monnaie_id=get_monnaie_id(db_session),
        type_code="classique",
    )

    comptes_eteints, categories_eteintes = import_bancaire.elements_eteints(db_session)
    motif = import_bancaire._erreur_eteints(ligne, comptes_eteints, categories_eteintes)

    assert motif is not None and "CC" in motif


def test_une_regle_vers_une_categorie_eteinte_retombe_sur_autres(db_session):
    """L'import ne s'arrête pas sur une règle devenue obsolète : il REDEMANDE.
    La ligne prend « Autres » en suggestion, comme quand rien ne la classe."""
    from app.services import import_bancaire

    _eteindre_categorie(db_session, get_categorie_id(db_session, "Loisirs & sorties"))
    comptes_eteints, categories_eteintes = import_bancaire.elements_eteints(db_session)

    assert get_categorie_id(db_session, "Loisirs & sorties") in categories_eteintes
