"""Les sous-projets : un projet B rangé sous un projet A (migration 0100).

CE QUE CES TESTS PROTÈGENT :

  - POUR LES CHIFFRES, ranger B sous A revient à verser dans A chaque opération de B : le total, le
    nombre d'opérations et la cascade de A les comptent, et UNE OPÉRATION PRÉSENTE DES DEUX CÔTÉS NE
    COMPTE QU'UNE FOIS. C'est la propriété qui fait confiance au chiffre ;
  - LES VOLETS DE L'ÉCRAN : le serveur dit ce que chaque projet montre lui-même (`operation_ids`), sans
    les opérations rangées dans les volets de ses sous-projets ;
  - L'ARBRE RESTE UN ARBRE : pas de projet sous lui-même, pas de cycle, un seul parent ;
  - RIEN N'EST SUPPRIMÉ : sortir un sous-projet, ou supprimer son parent, ne touche à aucune opération.
"""
from datetime import date

import pytest
from fastapi import HTTPException

from app import crud, models, schemas
from app.constants import Sens, Statut
from app.services import lignes_depenses

from .conftest import (
    charger_module_extension,
    creer_compte,
    get_categorie_id,
    get_type_id,
)

service = charger_module_extension("projets-objectifs", "service_projets.py")
routeur = charger_module_extension("projets-objectifs", "routeur_projets.py")


def _operation(db, compte, montant=100.0, **kwargs):
    defaults = dict(
        date=date(2026, 8, 12),
        type_id=get_type_id(db, "classique"),
        categorie_id=get_categorie_id(db, "Autres"),
        nature="Hôtel",
        monnaie_id=compte.monnaie_principale_id,
        sens=Sens.depense,
        statut=Statut.reel,
        montant=montant,
        montant_du=0.0,
        montant_a_rembourser=0.0,
    )
    defaults.update(kwargs)
    operation = models.Operation(compte_id=compte.id, **defaults)
    db.add(operation)
    db.commit()
    db.refresh(operation)
    return operation


def _projet(db, nom):
    return crud.create_sous_filtre(db, nom=nom)


def _ranger(db, parent, enfant):
    erreur = crud.erreur_sous_projet(parent, enfant)
    assert erreur is None, erreur
    crud.ranger_sous_projets(db, parent, [enfant])


def _depenses(lu):
    return {t["monnaie_id"]: t["depenses"] for t in lu["totaux"]}


# ---------- Les chiffres ----------


def test_les_chiffres_du_parent_comptent_les_operations_du_sous_projet(db_session):
    compte = creer_compte(db_session, "Courant")
    a, b = _projet(db_session, "Voyage"), _projet(db_session, "Hôtel")
    crud.ajouter_operations_au_sous_filtre(db_session, a, [_operation(db_session, compte, 100.0).id])
    crud.ajouter_operations_au_sous_filtre(db_session, b, [_operation(db_session, compte, 40.0).id])

    avant = service.lire_sous_filtre(a)
    _ranger(db_session, a, b)
    apres = service.lire_sous_filtre(a)

    assert avant["nombre_operations"] == 1 and _depenses(avant) == {compte.monnaie_principale_id: 100.0}
    assert apres["nombre_operations"] == 2
    assert _depenses(apres) == {compte.monnaie_principale_id: 140.0}
    # L'histogramme et la liste des opérations du projet les comptent aussi.
    barres = apres["totaux"][0]["depenses_par_categorie"]
    assert sum(barre["total_reel"] for barre in barres) == 140.0
    assert len(crud.get_sous_filtre(db_session, a.id).operations_effectives) == 2


def test_une_operation_presente_des_deux_cotes_ne_compte_qu_une_fois(db_session):
    compte = creer_compte(db_session, "Courant")
    a, b = _projet(db_session, "Voyage"), _projet(db_session, "Hôtel")
    commune = _operation(db_session, compte, 60.0)
    crud.ajouter_operations_au_sous_filtre(db_session, a, [commune.id])
    crud.ajouter_operations_au_sous_filtre(db_session, b, [commune.id])

    _ranger(db_session, a, b)
    lu = service.lire_sous_filtre(a)

    assert lu["nombre_operations"] == 1
    assert _depenses(lu) == {compte.monnaie_principale_id: 60.0}
    # À l'écran : montrée dans le volet de B seulement, plus dans le tableau de A.
    assert lu["operation_ids"] == []
    assert lu["sous_projets"][0]["operation_ids"] == [commune.id]


def test_le_parent_montre_ses_operations_et_le_volet_les_siennes(db_session):
    compte = creer_compte(db_session, "Courant")
    a, b = _projet(db_session, "Voyage"), _projet(db_session, "Hôtel")
    propre = _operation(db_session, compte, 100.0, nature="Train")
    de_b = _operation(db_session, compte, 40.0, nature="Chambre")
    crud.ajouter_operations_au_sous_filtre(db_session, a, [propre.id])
    crud.ajouter_operations_au_sous_filtre(db_session, b, [de_b.id])
    _ranger(db_session, a, b)

    lu = service.lire_sous_filtre(a)

    assert lu["operation_ids"] == [propre.id]
    volet = lu["sous_projets"][0]
    assert (volet["nom"], volet["nombre_operations"], volet["operation_ids"]) == ("Hôtel", 1, [de_b.id])
    assert volet["totaux"][0]["depenses"] == 40.0
    # Le sous-projet, lu seul, garde ses propres chiffres et dit sous qui il est rangé.
    seul = service.lire_sous_filtre(b)
    assert (seul["parent_id"], seul["parent_nom"], seul["nombre_operations"]) == (a.id, "Voyage", 1)


def test_les_sous_projets_se_comptent_a_toute_profondeur(db_session):
    compte = creer_compte(db_session, "Courant")
    a, b, c = _projet(db_session, "A"), _projet(db_session, "B"), _projet(db_session, "C")
    for projet, montant in ((a, 1.0), (b, 10.0), (c, 100.0)):
        crud.ajouter_operations_au_sous_filtre(
            db_session, projet, [_operation(db_session, compte, montant).id]
        )
    _ranger(db_session, b, c)
    _ranger(db_session, a, b)

    assert _depenses(service.lire_sous_filtre(a)) == {compte.monnaie_principale_id: 111.0}
    assert _depenses(service.lire_sous_filtre(b)) == {compte.monnaie_principale_id: 110.0}
    # Le volet de B porte le volet de C, et chacun ne montre que ses propres opérations.
    volet_b = service.lire_sous_filtre(a)["sous_projets"][0]
    assert volet_b["nombre_operations"] == 2
    assert volet_b["sous_projets"][0]["nom"] == "C"
    assert len(volet_b["operation_ids"]) == 1
    assert crud.get_sous_filtre(db_session, a.id).ids_descendants() == {b.id, c.id}


def test_un_objectif_sur_le_parent_lit_les_operations_du_sous_projet(db_session):
    compte = creer_compte(db_session, "Courant")
    a, b = _projet(db_session, "Voyage"), _projet(db_session, "Hôtel")
    propre = _operation(db_session, compte, 100.0)
    de_b = _operation(db_session, compte, 40.0, nature="Chambre")
    commune = _operation(db_session, compte, 5.0, nature="Pourboire")
    crud.ajouter_operations_au_sous_filtre(db_session, a, [propre.id, commune.id])
    crud.ajouter_operations_au_sous_filtre(db_session, b, [de_b.id, commune.id])
    _ranger(db_session, a, b)

    lignes = lignes_depenses.lignes_detaillees(
        db_session,
        date(2026, 8, 1),
        date(2026, 8, 31),
        compte.monnaie_principale_id,
        None,
        sous_filtre_id=a.id,
    )

    # Les trois opérations, chacune une fois (la commune est dans les deux projets).
    assert sorted(operation.id for operation, _ in lignes) == sorted([propre.id, de_b.id, commune.id])


# ---------- L'arbre reste un arbre ----------


def test_un_projet_ne_se_range_ni_sous_lui_meme_ni_sous_son_descendant(db_session):
    a, b = _projet(db_session, "A"), _projet(db_session, "B")
    _ranger(db_session, a, b)

    assert "propre sous-projet" in crud.erreur_sous_projet(a, a)
    assert "en rond" in crud.erreur_sous_projet(b, a)


def test_un_projet_n_a_qu_un_seul_parent(db_session):
    a, b, c = _projet(db_session, "A"), _projet(db_session, "B"), _projet(db_session, "C")
    _ranger(db_session, a, c)

    erreur = crud.erreur_sous_projet(b, c)

    assert "déjà un sous-projet de « A »" in erreur
    # Le même parent n'est pas une erreur : ranger deux fois ne change rien.
    assert crud.erreur_sous_projet(a, c) is None


def test_le_routeur_refuse_un_cycle_en_409(db_session):
    a, b = _projet(db_session, "A"), _projet(db_session, "B")
    _ranger(db_session, a, b)

    with pytest.raises(HTTPException) as erreur:
        routeur.ranger_sous_projets(b.id, schemas.SousFiltreSousProjets(ids=[a.id]), db_session)

    assert erreur.value.status_code == 409
    with pytest.raises(HTTPException) as inconnu:
        routeur.ranger_sous_projets(a.id, schemas.SousFiltreSousProjets(ids=[9999]), db_session)
    assert inconnu.value.status_code == 404


# ---------- Rien n'est supprimé ----------


def test_sortir_un_sous_projet_le_libere_sans_toucher_aux_operations(db_session):
    compte = creer_compte(db_session, "Courant")
    a, b = _projet(db_session, "Voyage"), _projet(db_session, "Hôtel")
    operation = _operation(db_session, compte, 40.0)
    crud.ajouter_operations_au_sous_filtre(db_session, b, [operation.id])
    _ranger(db_session, a, b)

    sortis = routeur.sortir_sous_projets(a.id, schemas.SousFiltreSousProjets(ids=[b.id]), db_session)

    assert sortis == {"sortis": 1}
    assert service.lire_sous_filtre(a)["nombre_operations"] == 0
    assert service.lire_sous_filtre(b)["parent_id"] is None
    assert crud.get_operation(db_session, operation.id) is not None


def test_supprimer_le_parent_libere_ses_sous_projets(db_session):
    compte = creer_compte(db_session, "Courant")
    a, b = _projet(db_session, "Voyage"), _projet(db_session, "Hôtel")
    operation = _operation(db_session, compte, 40.0)
    crud.ajouter_operations_au_sous_filtre(db_session, b, [operation.id])
    _ranger(db_session, a, b)

    crud.delete_sous_filtre(db_session, a)

    restant = crud.get_sous_filtre(db_session, b.id)
    assert restant is not None and restant.parent_id is None
    assert [o.id for o in restant.operations] == [operation.id]
