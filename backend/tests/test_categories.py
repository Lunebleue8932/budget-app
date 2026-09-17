from datetime import date

from app import crud, models, schemas
from app.constants import CATEGORIES_INITIALES, Sens, Statut
from app.services import soldes

from .conftest import (
    CATEGORIES_TEST,
    creer_compte,
    get_categorie_id,
    get_monnaie_id,
    get_type_id,
)


def test_seed_categories_presentes(db_session):
    noms = {c.nom for c in db_session.query(models.Categorie).all()}
    assert noms == set(CATEGORIES_TEST)


def test_l_application_ne_livre_que_autres():
    """CE QUE LA BASE NEUVE CONTIENT, et c'est tout (cf. migration 0061).

    Les cinq catégories de dépense et la catégorie d'entrée d'autrefois étaient
    celles d'un budget particulier. « Autres » reste seule parce que
    l'application la cherche par son nom, et que rien d'autre n'est
    présupposable du budget de quelqu'un."""
    assert CATEGORIES_INITIALES == ["Autres"]


def test_la_table_ne_contient_que_de_vraies_categories(db_session):
    """Depuis la migration 0019, les quatre anciennes catégories système sont
    devenues des types d'opération : elles n'ont plus rien à faire ici."""
    noms = {c.nom for c in crud.get_categories(db_session)}
    assert noms.isdisjoint(
        {"Remboursements", "Virement interne", "Prêts", "Remboursement prêts"}
    )
    assert "Alimentaire" in noms
    assert "Entrées d'argent" in noms


def test_les_types_operation_sont_seedes(db_session):
    types = {t.code: t for t in crud.get_types_operation(db_session)}
    assert set(types) == {
        "classique",
        "remboursable",
        "remboursements",
        "pret",
        "remboursement_pret",
        "virement",
        "action",
    }
    assert types["pret"].nom == "Prêt reçu"
    # Seul le type des mouvements de titres est "interne" : les six autres se
    # choisissent librement dans les menus de type.
    assert {code for code, t in types.items() if t.interne} == {"action"}


def test_create_categorie(db_session):
    categorie = crud.create_categorie(db_session, schemas.CategorieCreate(nom="Loisirs perso"))
    assert categorie.nom == "Loisirs perso"


def test_budget_categorie_herite_du_mois_precedent(db_session):
    categorie_id = get_categorie_id(db_session, "Alimentaire")
    crud.set_budget_categorie(db_session, categorie_id, 2026, 5, get_monnaie_id(db_session), 300.0)

    # Mai a une valeur explicite ; juin et juillet n'en ont pas -> héritent de mai.
    assert crud.get_budget_categorie(db_session, categorie_id, 2026, 5, get_monnaie_id(db_session)) == 300.0
    assert crud.get_budget_categorie(db_session, categorie_id, 2026, 6, get_monnaie_id(db_session)) == 300.0
    assert crud.get_budget_categorie(db_session, categorie_id, 2026, 7, get_monnaie_id(db_session)) == 300.0
    assert crud.budget_categorie_est_explicite(db_session, categorie_id, 2026, 6, get_monnaie_id(db_session)) is False

    # Un mois ANTÉRIEUR au premier réglage hérite de celui-ci : ce n'est pas un
    # mois sans budget, c'est un mois d'avant qu'on l'ait écrit (même règle que
    # le budget total, cf. crud._budget_herite).
    assert crud.get_budget_categorie(db_session, categorie_id, 2026, 4, get_monnaie_id(db_session)) == 300.0
    assert crud.get_budget_categorie(db_session, categorie_id, 2025, 1, get_monnaie_id(db_session)) == 300.0
    # Zéro reste réservé à « aucun budget n'a jamais été posé sur cette clé ».
    autre = get_categorie_id(db_session, "Charges fixes")
    assert crud.get_budget_categorie(db_session, autre, 2026, 4, get_monnaie_id(db_session)) == 0.0


def test_budget_categorie_override_explicite(db_session):
    categorie_id = get_categorie_id(db_session, "Alimentaire")
    crud.set_budget_categorie(db_session, categorie_id, 2026, 5, get_monnaie_id(db_session), 300.0)
    crud.set_budget_categorie(db_session, categorie_id, 2026, 7, get_monnaie_id(db_session), 250.0)

    # Juin hérite toujours de mai (300), mais juillet a sa propre valeur (250)
    # et août hérite de juillet (le réglage le plus récent), pas de mai.
    assert crud.get_budget_categorie(db_session, categorie_id, 2026, 6, get_monnaie_id(db_session)) == 300.0
    assert crud.get_budget_categorie(db_session, categorie_id, 2026, 7, get_monnaie_id(db_session)) == 250.0
    assert crud.get_budget_categorie(db_session, categorie_id, 2026, 8, get_monnaie_id(db_session)) == 250.0
    assert crud.budget_categorie_est_explicite(db_session, categorie_id, 2026, 7, get_monnaie_id(db_session)) is True


def test_reordonner_categories(db_session):
    noms_avant = [c.nom for c in crud.get_categories(db_session)]
    ids_avant = [c.id for c in crud.get_categories(db_session)]
    # Glisser-déposer : on inverse les deux premières catégories non-système.
    nouvel_ordre = [ids_avant[1], ids_avant[0]] + ids_avant[2:]

    crud.reordonner_categories(db_session, nouvel_ordre)
    noms_apres = [c.nom for c in crud.get_categories(db_session)]
    assert noms_apres[0] == noms_avant[1]
    assert noms_apres[1] == noms_avant[0]
    assert noms_apres[2:] == noms_avant[2:]


def test_renommer_un_type_operation_ne_change_pas_son_code(db_session):
    """Le libellé est modifiable, le code technique — sur lequel repose toute
    la logique métier — ne l'est pas."""
    type_pret = crud.get_type_operation_par_code(db_session, "pret")

    crud.renommer_type_operation(db_session, type_pret, "Argent emprunté")

    db_session.refresh(type_pret)
    assert type_pret.nom == "Argent emprunté"
    assert type_pret.code == "pret"


def test_migration_operations_vers_autres(db_session):
    compte = creer_compte(db_session, "Courant")

    operation = crud.create_operation(
        db_session,
        schemas.OperationCreate(
            date=date(2026, 7, 1),
            compte_id=compte.id,
            monnaie_id=get_monnaie_id(db_session),
            type_id=get_type_id(db_session, "classique"),
            categorie_id=get_categorie_id(db_session, "Alimentaire"),
            nature="Courses",
            montant=50.0,
            statut=Statut.reel,
        ),
    )

    categorie_alimentaire = crud.get_categorie(db_session, get_categorie_id(db_session, "Alimentaire"))
    crud.migrer_operations_vers_autres(db_session, categorie_alimentaire)

    db_session.refresh(operation)
    assert operation.categorie_id == get_categorie_id(db_session, "Autres")


def test_couleur_index_attribue_a_la_creation_et_libere_a_la_suppression(db_session):
    """La règle : une couleur appartient à sa catégorie tant que celle-ci
    existe, et n'est reprise que lorsqu'elle disparaît."""
    initiales = {c.nom: c.couleur_index for c in crud.get_categories(db_session)}
    # Le seed en donne un distinct à chacune (rattrapage de la migration 0035).
    assert len(set(initiales.values())) == len(initiales)

    nouvelle = crud.create_categorie(db_session, schemas.CategorieCreate(nom="Voyages"))
    assert nouvelle.couleur_index not in initiales.values()
    couleur_voyages = nouvelle.couleur_index

    # Réordonner ne repeint rien : c'est tout l'objet de la colonne.
    ids = [c.id for c in crud.get_categories(db_session)]
    crud.reordonner_categories(db_session, list(reversed(ids)))
    assert crud.get_categorie(db_session, nouvelle.id).couleur_index == couleur_voyages

    # Poser un objectif non plus.
    crud.set_objectif_pourcentage_categorie(db_session, nouvelle, 10.0)
    assert crud.get_categorie(db_session, nouvelle.id).couleur_index == couleur_voyages

    # Supprimer libère l'index, et lui seul : la suivante le récupère.
    crud.migrer_operations_vers_autres(db_session, nouvelle)
    crud.delete_categorie(db_session, nouvelle)
    reprise = crud.create_categorie(db_session, schemas.CategorieCreate(nom="Cadeaux"))
    assert reprise.couleur_index == couleur_voyages


def test_couleur_index_ne_derive_pas_au_fil_des_creations(db_session):
    """Créer puis supprimer en boucle ne doit pas faire grimper l'index : deux
    catégories vivantes finiraient par partager une couleur alors que la palette
    avait de la place."""
    depart = {c.couleur_index for c in crud.get_categories(db_session)}
    for _ in range(5):
        c = crud.create_categorie(db_session, schemas.CategorieCreate(nom="Jetable"))
        assert c.couleur_index not in depart
        crud.migrer_operations_vers_autres(db_session, c)
        crud.delete_categorie(db_session, c)
    assert {c.couleur_index for c in crud.get_categories(db_session)} == depart


# ---------- Une catégorie d'ENTRÉE se coche (migration 0060) ----------
#
# CE QUE CES TESTS VERROUILLENT. La notion existait, mais par le NOM : une
# constante contenait « Entrées d'argent », et trois endroits comparaient à
# elle. Renommer la catégorie la faisait redevenir une catégorie de dépense
# sans rien dire, et un SECOND revenu — des loyers, une pension — n'avait aucun
# moyen d'être reconnu. Le drapeau remplace la chaîne :
#
#   - le SENS d'une opération qu'on y range suit la case, pas le libellé ;
#   - l'histogramme des dépenses n'en dessine pas la barre (elle resterait à
#     zéro, les sommes ne comptant que les sorties) ;
#   - RIEN N'EST RÉÉCRIT : les opérations déjà en base gardent leur sens, sans
#     quoi cocher une case ferait bouger des soldes déjà rapprochés d'un relevé.


def test_la_categorie_des_entrees_livree_porte_le_drapeau(db_session):
    categories = {c.nom: c for c in crud.get_categories(db_session)}
    assert categories["Entrées d'argent"].est_entree is True
    assert categories["Alimentaire"].est_entree is False


def test_le_sens_suit_la_case_et_non_le_nom(db_session):
    """Une catégorie cochée rend des ENTRÉES, quel que soit son nom — et la
    catégorie livrée renommée continue d'en rendre."""
    compte = creer_compte(db_session, "Courant")
    salaire = crud.create_categorie(db_session, schemas.CategorieCreate(nom="Loyers perçus"))
    crud.set_categorie_est_entree(db_session, salaire, True)

    operation = crud.create_operation(
        db_session,
        schemas.OperationCreate(
            date=date(2026, 3, 10),
            compte_id=compte.id,
            monnaie_id=get_monnaie_id(db_session),
            type_id=get_type_id(db_session, "classique"),
            categorie_id=salaire.id,
            nature="Loyer de mars",
            montant=700,
            statut=Statut.reel,
        ),
    )
    assert operation.sens == Sens.entree

    # Et le nom ne décide plus de rien : la catégorie livrée, renommée, reste
    # une catégorie d'entrée.
    livree = crud.get_categorie_by_nom(db_session, "Entrées d'argent")
    crud.rename_categorie(db_session, livree, "Revenus")
    autre = crud.create_operation(
        db_session,
        schemas.OperationCreate(
            date=date(2026, 3, 11),
            compte_id=compte.id,
            monnaie_id=get_monnaie_id(db_session),
            type_id=get_type_id(db_session, "classique"),
            categorie_id=livree.id,
            nature="Salaire",
            montant=2000,
            statut=Statut.reel,
        ),
    )
    assert autre.sens == Sens.entree


def test_une_categorie_d_entree_n_a_pas_de_barre(db_session):
    compte = creer_compte(db_session, "Courant")
    loyers = crud.create_categorie(db_session, schemas.CategorieCreate(nom="Loyers perçus"))
    crud.set_categorie_est_entree(db_session, loyers, True)
    crud.create_operation(
        db_session,
        schemas.OperationCreate(
            date=date(2026, 3, 10),
            compte_id=compte.id,
            monnaie_id=get_monnaie_id(db_session),
            type_id=get_type_id(db_session, "classique"),
            categorie_id=loyers.id,
            nature="Loyer de mars",
            montant=700,
            statut=Statut.reel,
        ),
    )
    barres = soldes.get_depenses_par_categorie(
        db_session, 2026, 3, get_monnaie_id(db_session)
    )
    assert "Loyers perçus" not in {b["categorie"] for b in barres}
    assert "Alimentaire" in {b["categorie"] for b in barres}


def test_cocher_la_case_ne_reecrit_aucune_operation(db_session):
    """Le sens est posé à la création et relu par tous les soldes : le
    recalculer ferait bouger des chiffres déjà rapprochés d'un relevé."""
    compte = creer_compte(db_session, "Courant")
    categorie = crud.create_categorie(db_session, schemas.CategorieCreate(nom="Divers"))
    operation = crud.create_operation(
        db_session,
        schemas.OperationCreate(
            date=date(2026, 3, 10),
            compte_id=compte.id,
            monnaie_id=get_monnaie_id(db_session),
            type_id=get_type_id(db_session, "classique"),
            categorie_id=categorie.id,
            nature="Une sortie",
            montant=50,
            statut=Statut.reel,
        ),
    )
    assert operation.sens == Sens.depense

    crud.set_categorie_est_entree(db_session, categorie, True)
    db_session.refresh(operation)
    assert operation.sens == Sens.depense
