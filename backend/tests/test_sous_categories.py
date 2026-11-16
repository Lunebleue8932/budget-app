"""Les sous-catégories (migration 0103) : une relation parent → enfant, un seul niveau."""
from datetime import date

import pytest
from fastapi import HTTPException

from app import crud, models, schemas
from app.constants import NB_NUANCES_CATEGORIE
from app.routers import categories as routeur_categories
from app.routers import dashboard as routeur_dashboard
from app.services import soldes

from .conftest import creer_compte, get_monnaie_id
from .test_reste_periode import _op


def _categorie(db, nom, parent_id=None):
    return crud.create_categorie(db, schemas.CategorieCreate(nom=nom, parent_id=parent_id))


def test_une_sous_categorie_herite_de_la_teinte_de_son_parent(db_session):
    db = db_session
    parent = _categorie(db, "Transports")
    a = _categorie(db, "Essence", parent.id)
    b = _categorie(db, "Train", parent.id)
    assert a.couleur_index == b.couleur_index == parent.couleur_index
    assert a.parent_id == parent.id
    # Deux nuances distinctes pour deux frères, dans les bornes de la famille.
    assert {a.couleur_nuance, b.couleur_nuance} == {0, 1}
    assert all(0 <= n < NB_NUANCES_CATEGORIE for n in (a.couleur_nuance, b.couleur_nuance))


def test_une_sous_categorie_n_occupe_pas_un_index_de_palette_de_plus(db_session):
    db = db_session
    parent = _categorie(db, "Transports")
    _categorie(db, "Essence", parent.id)
    _categorie(db, "Train", parent.id)
    suivante = _categorie(db, "Loisirs 2")
    # Le plus petit index libre : celui du parent n'a servi qu'une fois.
    indices = [c.couleur_index for c in crud.get_categories(db) if c.parent_id is None]
    assert len(indices) == len(set(indices))
    assert suivante.couleur_index not in {parent.couleur_index}


def test_un_seul_niveau(db_session):
    db = db_session
    parent = _categorie(db, "Transports")
    enfant = _categorie(db, "Essence", parent.id)
    # Un enfant ne peut pas être parent.
    assert "déjà une sous-catégorie" in crud.erreur_parent_categorie(db, None, enfant.id)
    # Un parent qui porte des enfants ne peut pas devenir enfant.
    autre = _categorie(db, "Voyages")
    assert "porte déjà des sous-catégories" in crud.erreur_parent_categorie(db, parent, autre.id)
    # Personne n'est sa propre sous-catégorie.
    assert "propre" in crud.erreur_parent_categorie(db, autre, autre.id)
    # Un parent qui n'existe pas.
    assert crud.erreur_parent_categorie(db, autre, 9999) is not None
    # Le cas permis.
    assert crud.erreur_parent_categorie(db, autre, parent.id) is None


def test_la_categorie_des_virements_n_a_pas_de_sous_categories(db_session):
    db = db_session
    virements = crud.get_categorie_virements(db)
    nouvelle = _categorie(db, "Divers")
    assert crud.erreur_parent_categorie(db, nouvelle, virements.id) is not None
    assert crud.erreur_parent_categorie(db, virements, nouvelle.id) is not None


def test_ranger_puis_remonter_une_categorie(db_session):
    db = db_session
    parent = _categorie(db, "Transports")
    autre = _categorie(db, "Essence")
    crud.set_categorie_parent(db, autre, parent.id)
    assert autre.couleur_index == parent.couleur_index and autre.couleur_nuance == 0
    crud.set_categorie_parent(db, autre, None)
    assert autre.parent_id is None and autre.couleur_nuance is None
    # Elle a repris une couleur à elle : plus celle du parent.
    assert autre.couleur_index != parent.couleur_index


def test_supprimer_le_parent_libere_ses_enfants(db_session):
    db = db_session
    parent = _categorie(db, "Transports")
    enfant = _categorie(db, "Essence", parent.id)
    crud.delete_categorie(db, parent)
    db.refresh(enfant)
    assert enfant.parent_id is None and enfant.couleur_nuance is None
    assert crud.get_categorie_by_nom(db, "Essence") is not None


def test_la_nuance_d_un_frere_est_refusee(db_session):
    db = db_session
    parent = _categorie(db, "Transports")
    a = _categorie(db, "Essence", parent.id)
    b = _categorie(db, "Train", parent.id)
    assert "déjà celle" in crud.erreur_nuance_categorie(db, b, a.couleur_nuance)
    assert crud.erreur_nuance_categorie(db, b, 5) is None
    assert crud.erreur_nuance_categorie(db, b, NB_NUANCES_CATEGORIE) is not None
    # Un parent n'a pas de nuance.
    assert crud.erreur_nuance_categorie(db, parent, 1) is not None


def test_la_somme_des_budgets_des_enfants_reste_sous_celui_du_parent(db_session):
    db = db_session
    monnaie = get_monnaie_id(db)
    parent = _categorie(db, "Transports")
    a = _categorie(db, "Essence", parent.id)
    b = _categorie(db, "Train", parent.id)
    # Sans budget au parent, celui d'un enfant est refusé.
    assert "pose-le d'abord" in crud.erreur_budget_sous_categories(db, a, 2026, 11, monnaie, 50.0)
    crud.set_budget_categorie(db, parent.id, 2026, 11, monnaie, 300.0)
    assert crud.erreur_budget_sous_categories(db, a, 2026, 11, monnaie, 200.0) is None
    crud.set_budget_categorie(db, a.id, 2026, 11, monnaie, 200.0)
    # 200 + 150 > 300 : refusé ; 200 + 100 = 300 : permis (l'égalité n'est pas forcée, mais elle passe).
    assert "dépasserait" in crud.erreur_budget_sous_categories(db, b, 2026, 11, monnaie, 150.0)
    assert crud.erreur_budget_sous_categories(db, b, 2026, 11, monnaie, 100.0) is None
    # Baisser le parent sous la somme de ses enfants est refusé aussi.
    assert "ne peut pas descendre" in crud.erreur_budget_sous_categories(db, parent, 2026, 11, monnaie, 150.0)
    assert crud.erreur_budget_sous_categories(db, parent, 2026, 11, monnaie, 250.0) is None


def test_la_route_du_budget_applique_la_regle(db_session):
    db = db_session
    monnaie = get_monnaie_id(db)
    parent = _categorie(db, "Transports")
    enfant = _categorie(db, "Essence", parent.id)
    crud.set_budget_categorie(db, parent.id, 2026, 11, monnaie, 100.0)
    with pytest.raises(HTTPException) as exc:
        routeur_categories.set_budget_categorie(
            enfant.id, 2026, 11, monnaie, schemas.BudgetMensuelSet(montant=150.0), db
        )
    assert exc.value.status_code == 400


def test_le_dashboard_affiche_par_parent_et_la_page_budget_empile(db_session):
    db = db_session
    monnaie = get_monnaie_id(db)
    compte = creer_compte(db, "Courant", "courant", solde_initial=1000.0)
    parent = _categorie(db, "Transports")
    essence = _categorie(db, "Essence", parent.id)
    train = _categorie(db, "Train", parent.id)
    seule = _categorie(db, "Cinéma")
    aujourdhui = date.today()
    jour = date(aujourdhui.year, aujourdhui.month, 1)
    _op(db, compte, jour, 40.0, categorie="Essence")
    _op(db, compte, jour, 25.0, categorie="Train")
    _op(db, compte, jour, 10.0, categorie="Transports")  # rangée directement dans le parent
    _op(db, compte, jour, 15.0, categorie="Cinéma")
    crud.set_budget_categorie(db, parent.id, aujourdhui.year, aujourdhui.month, monnaie, 200.0)
    crud.set_budget_categorie(db, essence.id, aujourdhui.year, aujourdhui.month, monnaie, 80.0)

    kpi = routeur_dashboard.get_dashboard(annee=None, mois=None, vue="mois", db=db).kpis[0]
    noms = [d.categorie for d in kpi.depenses_par_categorie]
    # Les enfants n'ont pas de barre à eux : ils sont fondus dans leur parent.
    assert "Essence" not in noms and "Train" not in noms
    ligne = next(d for d in kpi.depenses_par_categorie if d.categorie == "Transports")
    assert ligne.total_reel == pytest.approx(75.0)
    assert ligne.budget_alloue == pytest.approx(200.0)
    assert ligne.categorie_id == parent.id
    # Les composantes : la part directe (budget restant 200 - 80), puis chaque enfant.
    parts = {c.categorie: c for c in ligne.composantes}
    assert parts["Transports"].direct and parts["Transports"].total_reel == pytest.approx(10.0)
    assert parts["Transports"].budget_alloue == pytest.approx(120.0)
    assert parts["Essence"].total_reel == pytest.approx(40.0) and parts["Essence"].budget_alloue == pytest.approx(80.0)
    assert parts["Train"].total_reel == pytest.approx(25.0)
    assert parts["Essence"].couleur_nuance != parts["Train"].couleur_nuance
    # Une catégorie sans enfant n'a pas de composantes.
    cine = next(d for d in kpi.depenses_par_categorie if d.categorie == "Cinéma")
    assert cine.composantes == [] and cine.total_reel == pytest.approx(15.0)
    # La somme des barres reste le total des sorties.
    assert sum(d.total_reel for d in kpi.depenses_par_categorie) == pytest.approx(kpi.total_sorties)


def test_un_parent_sans_depense_propre_a_quand_meme_sa_barre(db_session):
    db = db_session
    compte = creer_compte(db, "Courant", "courant", solde_initial=1000.0)
    parent = _categorie(db, "Transports")
    _categorie(db, "Essence", parent.id)
    aujourdhui = date.today()
    _op(db, compte, date(aujourdhui.year, aujourdhui.month, 1), 40.0, categorie="Essence")
    kpi = routeur_dashboard.get_dashboard(annee=None, mois=None, vue="mois", db=db).kpis[0]
    ligne = next(d for d in kpi.depenses_par_categorie if d.categorie == "Transports")
    assert ligne.total_reel == pytest.approx(40.0)
    assert [c.categorie for c in ligne.composantes] == ["Essence"]


def test_le_detail_d_une_categorie_parent(db_session):
    from .conftest import charger_module_extension

    service = charger_module_extension("analyse-budget", "service_analyse_budget.py")
    db = db_session
    monnaie = get_monnaie_id(db)
    compte = creer_compte(db, "Courant", "courant", solde_initial=1000.0)
    parent = _categorie(db, "Transports")
    essence = _categorie(db, "Essence", parent.id)
    aujourdhui = date.today()
    jour = date(aujourdhui.year, aujourdhui.month, 1)
    _op(db, compte, jour, 40.0, categorie="Essence")
    _op(db, compte, jour, 10.0, categorie="Transports")
    crud.set_budget_categorie(db, parent.id, aujourdhui.year, aujourdhui.month, monnaie, 100.0)

    detail = service.detail_categorie(db, parent.id, aujourdhui.year, aujourdhui.month, monnaie)
    assert detail["budget_alloue"] == pytest.approx(100.0)
    assert detail["total_reel"] == pytest.approx(50.0)
    assert {o["categorie"] for o in detail["operations"]} == {"Essence", "Transports"}
    assert sum(o["montant"] for o in detail["operations"]) == pytest.approx(50.0)
    assert {c["categorie"] for c in detail["composantes"]} == {"Transports", "Essence"}
    # Une sous-catégorie n'a pas de fenêtre de détail.
    assert service.detail_categorie(db, essence.id, aujourdhui.year, aujourdhui.month, monnaie) is None


def test_changer_la_couleur_echange_avec_la_categorie_qui_la_porte(db_session):
    db = db_session
    crud.delete_categorie(db, crud.get_categorie_by_nom(db, "Réparation & entretien"))  # libère la couleur 3
    a = _categorie(db, "Transports")
    b = _categorie(db, "Loisirs 2")
    b.couleur_index = 3  # la seule à porter cette couleur
    db.commit()
    enfant = _categorie(db, "Essence", a.id)
    ancienne_a = a.couleur_index
    cible = b.couleur_index % 8  # les index se lisent modulo la palette
    assert crud.erreur_couleur_categorie(db, a, cible) is None
    crud.set_categorie_couleur(db, a, cible)
    db.refresh(b)
    db.refresh(enfant)
    # Les deux ont échangé leurs couleurs, et la sous-catégorie suit la teinte de son parent.
    assert a.couleur_index == cible and b.couleur_index == ancienne_a
    assert enfant.couleur_index == cible


def test_une_couleur_libre_se_pose_sans_echange(db_session):
    db = db_session
    # Deux catégories du décor inutilisées libèrent des couleurs.
    for nom in ("Réparation & entretien", "Vêtements & équipement sport"):
        crud.delete_categorie(db, crud.get_categorie_by_nom(db, nom))
    a = _categorie(db, "Transports")
    autres = {c.couleur_index for c in crud.get_categories(db) if c.id != a.id and c.parent_id is None}
    libre = next(i for i in range(8) if i not in {x % 8 for x in autres} | {a.couleur_index % 8})
    crud.set_categorie_couleur(db, a, libre)
    assert a.couleur_index == libre
    # Aucune autre catégorie n'a bougé.
    assert {c.couleur_index for c in crud.get_categories(db) if c.id != a.id and c.parent_id is None} == autres


def test_la_couleur_est_refusee_pour_une_sous_categorie_une_entree_ou_hors_palette(db_session):
    db = db_session
    parent = _categorie(db, "Transports")
    enfant = _categorie(db, "Essence", parent.id)
    assert crud.erreur_couleur_categorie(db, enfant, 2) is not None
    assert crud.erreur_couleur_categorie(db, crud.get_categorie_virements(db), 2) is not None
    entree = crud.get_categorie_by_nom(db, "Entrées d'argent")
    assert crud.erreur_couleur_categorie(db, entree, 2) is not None
    assert crud.erreur_couleur_categorie(db, parent, 8) is not None
    assert crud.erreur_couleur_categorie(db, parent, -1) is not None


def test_la_note_d_une_categorie(db_session):
    db = db_session
    categorie = _categorie(db, "Transports")
    assert categorie.notes is None
    lue = routeur_categories.set_notes_categorie(
        categorie.id, schemas.CategorieNotesUpdate(notes="  tout ce qui touche à la voiture  "), db
    )
    assert lue.notes == "tout ce qui touche à la voiture"
    # Un texte vide la retire ; renommer ne l'efface pas.
    crud.rename_categorie(db, categorie, "Voiture")
    assert crud.get_categorie(db, categorie.id).notes == "tout ce qui touche à la voiture"
    routeur_categories.set_notes_categorie(categorie.id, schemas.CategorieNotesUpdate(notes="   "), db)
    assert crud.get_categorie(db, categorie.id).notes is None
