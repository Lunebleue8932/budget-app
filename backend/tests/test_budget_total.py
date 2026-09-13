"""Le budget TOTAL d'un mois, et l'accord des trois grandeurs du budget
(migration 0057).

CE QUE CES TESTS VERROUILLENT :

  - le budget total se comporte EXACTEMENT comme celui d'une catégorie —
    héritage du dernier mois explicite, monnaie dans la clé, prorata des jours
    en semaine, somme des douze mois en vue annuelle. Deux notions voisines qui
    se découperaient différemment donneraient des parts qui ne s'additionnent
    pas à ce que l'écran montre à côté ;
  - le signalement d'incohérence ne parle QUE quand les trois grandeurs
    existent. Poser un budget total et trois objectifs seulement est l'état
    ordinaire, et le transformer en reproche permanent rendrait la fenêtre
    inutilisable ;
  - chacune des trois corrections proposées fait vraiment taire le
    signalement. C'est la seule promesse que la fenêtre fait à celui qui clique,
    et elle se vérifie en rejouant le calcul après la correction.
"""
import pytest
from pydantic import ValidationError

from app import crud, models, schemas
from app.services import soldes

from .conftest import creer_compte, get_categorie_id


def monnaie_id(db):
    return db.query(models.Monnaie).first().id


def seconde_monnaie(db):
    """Une deuxième devise, pour vérifier que rien ne traverse les monnaies."""
    monnaie = models.Monnaie(nom="Dollar", symbole="$")
    db.add(monnaie)
    db.commit()
    return monnaie.id


# ---------- La grandeur elle-même ----------


def test_pas_de_budget_total_vaut_zero(db_session):
    """Zéro veut dire « aucun budget posé », et c'est ce qui permet au camembert
    de savoir qu'il n'a pas de vue budget à proposer."""
    assert crud.get_budget_total(db_session, 2026, 9, monnaie_id(db_session)) == 0.0
    assert not crud.budget_total_est_explicite(db_session, 2026, 9, monnaie_id(db_session))


def test_poser_relire_et_retirer(db_session):
    m = monnaie_id(db_session)
    crud.set_budget_total(db_session, 2026, 9, m, 2500.0)
    assert crud.get_budget_total(db_session, 2026, 9, m) == 2500.0
    assert crud.budget_total_est_explicite(db_session, 2026, 9, m)

    # Réécrire ne crée pas une seconde ligne (clé unique annee/mois/monnaie).
    crud.set_budget_total(db_session, 2026, 9, m, 2600.0)
    assert crud.get_budget_total(db_session, 2026, 9, m) == 2600.0
    assert db_session.query(models.BudgetTotalMensuel).count() == 1

    crud.set_budget_total(db_session, 2026, 9, m, 0.0)
    assert crud.get_budget_total(db_session, 2026, 9, m) == 0.0


def test_heritage_du_dernier_mois_explicite(db_session):
    """POSER SON BUDGET UNE FOIS VAUT POUR LA SUITE — sans quoi il faudrait le
    réécrire tous les trente jours. Même règle que le budget d'une catégorie."""
    m = monnaie_id(db_session)
    crud.set_budget_total(db_session, 2026, 1, m, 2000.0)

    assert crud.get_budget_total(db_session, 2026, 6, m) == 2000.0
    assert crud.get_budget_total(db_session, 2027, 2, m) == 2000.0
    # Hérité, mais pas explicite : l'écran doit pouvoir le dire.
    assert not crud.budget_total_est_explicite(db_session, 2026, 6, m)

    # Un mois ANTÉRIEUR n'hérite de rien : l'héritage ne remonte pas le temps.
    assert crud.get_budget_total(db_session, 2025, 12, m) == 0.0

    crud.set_budget_total(db_session, 2026, 7, m, 2400.0)
    assert crud.get_budget_total(db_session, 2026, 6, m) == 2000.0
    assert crud.get_budget_total(db_session, 2026, 8, m) == 2400.0


def test_l_heritage_ne_traverse_jamais_les_monnaies(db_session):
    """« 2 500 » ne veut rien dire sans savoir en quelle devise : un budget en
    dollars n'hérite que d'un mois précédent lui aussi en dollars."""
    euro = monnaie_id(db_session)
    dollar = seconde_monnaie(db_session)
    crud.set_budget_total(db_session, 2026, 1, euro, 2000.0)

    assert crud.get_budget_total(db_session, 2026, 5, euro) == 2000.0
    assert crud.get_budget_total(db_session, 2026, 5, dollar) == 0.0


# ---------- Le découpage par période ----------


def test_la_vue_annuelle_somme_les_douze_mois(db_session):
    m = monnaie_id(db_session)
    crud.set_budget_total(db_session, 2026, 1, m, 2000.0)
    crud.set_budget_total(db_session, 2026, 7, m, 3000.0)

    # Six mois à 2 000 (janvier hérité jusqu'en juin) puis six à 3 000.
    assert soldes.get_budget_total_periode(db_session, 2026, None, m) == pytest.approx(
        6 * 2000.0 + 6 * 3000.0
    )


def test_une_semaine_prend_sa_part_des_jours(db_session):
    """UN BUDGET EST POSÉ POUR UN MOIS : il n'y a pas d'enveloppe hebdomadaire à
    lire quelque part. Le découper au prorata des jours est la seule lecture qui
    garde la somme des semaines égale au budget du mois — le même invariant que
    les barres qu'elles portent."""
    m = monnaie_id(db_session)
    crud.set_budget_total(db_session, 2026, 3, m, 3100.0)

    nombre_semaines = len(soldes.semaines_du_mois(2026, 3))
    parts = [
        soldes.get_budget_total_periode(db_session, 2026, 3, m, semaine=rang)
        for rang in range(1, nombre_semaines + 1)
    ]
    assert sum(parts) == pytest.approx(3100.0)
    # Aucune semaine ne porte le budget entier : c'est ce que le prorata évite.
    assert all(part < 3100.0 for part in parts)


def test_les_semaines_du_dashboard_portent_le_budget_et_sa_moyenne(db_session):
    m = monnaie_id(db_session)
    crud.set_budget_total(db_session, 2026, 3, m, 3100.0)

    reponse = soldes.get_depenses_par_semaine(db_session, 2026, 3, m)
    total_semaines = sum(s["budget_total"] for s in reponse["semaines"])
    assert total_semaines == pytest.approx(3100.0)
    # La moyenne est celle des semaines RENDUES, pas le mois divisé par quatre.
    assert reponse["budget_total_moyen"] == pytest.approx(
        total_semaines / len(reponse["semaines"])
    )


def test_l_objectif_survit_a_la_moyenne_des_semaines(db_session):
    """CE QU'IL PROTÈGE : l'accumulateur de la moyenne recopie champ par champ,
    et l'objectif y avait été oublié. La vue « Moyenne » perdait alors toutes
    ses cibles — sans erreur, la valeur par défaut du schéma (0) se lisant
    exactement comme « aucun objectif posé »."""
    m = monnaie_id(db_session)
    categorie = crud.get_categorie(db_session, get_categorie_id(db_session, "Alimentaire"))
    crud.set_objectif_pourcentage_categorie(db_session, categorie, 30.0)

    reponse = soldes.get_depenses_par_semaine(db_session, 2026, 3, m)
    ligne = next(l for l in reponse["moyenne"] if l["categorie"] == "Alimentaire")
    assert ligne["objectif_pourcentage"] == 30.0


# ---------- L'accord des trois grandeurs ----------


def poser_les_trois(db, *, total, pourcentage, budget, categorie="Alimentaire"):
    m = monnaie_id(db)
    objet = crud.get_categorie(db, get_categorie_id(db, categorie))
    crud.set_budget_total(db, 2026, 9, m, total)
    crud.set_objectif_pourcentage_categorie(db, objet, pourcentage)
    crud.set_budget_categorie(db, objet.id, 2026, 9, m, budget)
    return objet, m


def test_rien_a_signaler_quand_les_trois_s_accordent(db_session):
    poser_les_trois(db_session, total=2000.0, pourcentage=30.0, budget=600.0)
    rapport = crud.incoherences_budgets(db_session, 2026, 9, monnaie_id(db_session))
    assert rapport["lignes"] == []
    assert rapport["budget_total"] == 2000.0


@pytest.mark.parametrize(
    "total, pourcentage, budget",
    [
        (0.0, 30.0, 600.0),  # pas de budget total : rien ne cadre rien
        (2000.0, 0.0, 600.0),  # pas d'objectif : une enveloppe libre, c'est tout
        (2000.0, 30.0, 0.0),  # pas d'enveloppe : l'objectif suffit à lui-même
    ],
)
def test_rien_a_signaler_tant_qu_il_manque_une_des_trois(
    db_session, total, pourcentage, budget
):
    """L'ÉTAT ORDINAIRE N'EST PAS UNE FAUTE. On pose un budget total et trois
    objectifs, ou des enveloppes sans part visée : il faut que les trois termes
    existent ET se contredisent pour qu'il y ait quelque chose à dire."""
    poser_les_trois(db_session, total=total, pourcentage=pourcentage, budget=budget)
    assert crud.incoherences_budgets(db_session, 2026, 9, monnaie_id(db_session))["lignes"] == []


def test_un_desaccord_est_signale_avec_ses_trois_corrections(db_session):
    poser_les_trois(db_session, total=2000.0, pourcentage=30.0, budget=500.0)
    lignes = crud.incoherences_budgets(db_session, 2026, 9, monnaie_id(db_session))["lignes"]

    assert len(lignes) == 1
    ligne = lignes[0]
    assert ligne["categorie"] == "Alimentaire"
    assert ligne["budget_categorie"] == 500.0
    assert ligne["budget_attendu"] == pytest.approx(600.0)  # 2000 × 30 %
    assert ligne["pourcentage_attendu"] == pytest.approx(25.0)  # 500 / 2000
    assert ligne["total_attendu"] == pytest.approx(1666.666, rel=1e-4)  # 500 / 30 %


@pytest.mark.parametrize("correction", ["budget", "pourcentage", "total"])
def test_chaque_correction_proposee_fait_taire_le_signalement(db_session, correction):
    """LA SEULE PROMESSE QUE LA FENÊTRE FAIT à celui qui clique : le chiffre
    qu'elle propose rétablit vraiment l'accord. Vérifiée en le réappliquant et
    en rejouant le calcul."""
    categorie, m = poser_les_trois(db_session, total=2000.0, pourcentage=30.0, budget=500.0)
    ligne = crud.incoherences_budgets(db_session, 2026, 9, m)["lignes"][0]

    if correction == "budget":
        crud.set_budget_categorie(
            db_session, categorie.id, 2026, 9, m, ligne["budget_attendu"]
        )
    elif correction == "pourcentage":
        crud.set_objectif_pourcentage_categorie(
            db_session, categorie, ligne["pourcentage_attendu"]
        )
    else:
        crud.set_budget_total(db_session, 2026, 9, m, ligne["total_attendu"])

    assert crud.incoherences_budgets(db_session, 2026, 9, m)["lignes"] == []


def test_l_arrondi_d_un_pourcentage_ne_declenche_rien(db_session):
    """Les pourcentages se saisissent à la décimale : 30,1 % de 2 500 ne tombe
    pas sur un compte rond, et signaler cet écart-là reviendrait à signaler
    l'arrondi lui-même."""
    poser_les_trois(db_session, total=2500.0, pourcentage=30.1, budget=752.5)
    assert crud.incoherences_budgets(db_session, 2026, 9, monnaie_id(db_session))["lignes"] == []

    # Un euro d'écart, lui, se voit : la tolérance vaut un millième du montant.
    poser_les_trois(db_session, total=2500.0, pourcentage=30.1, budget=753.5)
    assert crud.incoherences_budgets(db_session, 2026, 9, monnaie_id(db_session))["lignes"] != []


def test_le_signalement_ne_regarde_que_sa_periode_et_sa_monnaie(db_session):
    """Un désaccord en mars ne doit pas se signaler en septembre : les trois
    grandeurs sont posées par mois (sauf le pourcentage), et mélanger les mois
    reviendrait à reprocher une saisie qu'on ne regarde pas."""
    categorie, euro = poser_les_trois(db_session, total=2000.0, pourcentage=30.0, budget=500.0)
    dollar = seconde_monnaie(db_session)

    assert crud.incoherences_budgets(db_session, 2026, 9, euro)["lignes"] != []
    # Le mois précédent n'a ni budget total ni enveloppe : rien à dire.
    assert crud.incoherences_budgets(db_session, 2026, 8, euro)["lignes"] == []
    # L'autre monnaie non plus.
    assert crud.incoherences_budgets(db_session, 2026, 9, dollar)["lignes"] == []


def test_plusieurs_categories_sont_signalees_ensemble(db_session):
    m = monnaie_id(db_session)
    crud.set_budget_total(db_session, 2026, 9, m, 2000.0)
    for nom, pourcentage, budget in [("Alimentaire", 30.0, 500.0), ("Loisirs & sorties", 10.0, 350.0)]:
        categorie = crud.get_categorie(db_session, get_categorie_id(db_session, nom))
        crud.set_objectif_pourcentage_categorie(db_session, categorie, pourcentage)
        crud.set_budget_categorie(db_session, categorie.id, 2026, 9, m, budget)

    lignes = crud.incoherences_budgets(db_session, 2026, 9, m)["lignes"]
    assert {l["categorie"] for l in lignes} == {"Alimentaire", "Loisirs & sorties"}


# ---------- Les routes ----------


def test_les_routes_lisent_et_ecrivent_le_budget_total(db_session):
    from app.routers import dashboard as routeur

    m = monnaie_id(db_session)
    avant = routeur.lire_budget_total(monnaie_id=m, annee=2026, mois=9, db=db_session)
    assert avant.montant == 0.0 and avant.explicite is False

    routeur.ecrire_budget_total(
        payload=schemas.BudgetTotalUpdate(montant=2500.0),
        monnaie_id=m,
        annee=2026,
        mois=9,
        db=db_session,
    )
    apres = routeur.lire_budget_total(monnaie_id=m, annee=2026, mois=9, db=db_session)
    assert apres.montant == 2500.0 and apres.explicite is True

    # Le mois suivant hérite, et le dit.
    suivant = routeur.lire_budget_total(monnaie_id=m, annee=2026, mois=10, db=db_session)
    assert suivant.montant == 2500.0 and suivant.explicite is False


def test_un_budget_negatif_est_refuse_par_le_schema(db_session):
    with pytest.raises(ValidationError):
        schemas.BudgetTotalUpdate(montant=-1.0)


def test_la_route_de_coherence_rend_les_lignes_en_desaccord(db_session):
    from app.routers import dashboard as routeur

    _, m = poser_les_trois(db_session, total=2000.0, pourcentage=30.0, budget=500.0)
    rapport = routeur.lire_coherence_budgets(monnaie_id=m, annee=2026, mois=9, db=db_session)
    assert len(rapport.lignes) == 1
    assert rapport.lignes[0].categorie == "Alimentaire"


def test_le_dashboard_porte_le_budget_total_de_la_periode(db_session):
    """Envoyé AVEC les dépenses, et non relu à part : c'est le dénominateur de
    la vue « budget », et deux allers-retours auraient laissé exister un instant
    où le graphe a ses parts sans avoir ce sur quoi les rapporter."""
    from app.routers import dashboard as routeur

    m = monnaie_id(db_session)
    # Le dashboard n'ouvre un onglet que pour les monnaies RÉELLEMENT portées
    # par un compte : sans compte, il n'y a pas de KPI où lire le budget.
    creer_compte(db_session, "Courant")
    crud.set_budget_total(db_session, 2026, 9, m, 2500.0)

    reponse = routeur.get_dashboard(annee=2026, mois=9, vue="mois", db=db_session)
    kpi = next(k for k in reponse.kpis if k.monnaie_id == m)
    assert kpi.budget_total == 2500.0
