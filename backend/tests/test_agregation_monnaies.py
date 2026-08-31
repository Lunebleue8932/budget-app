"""La bascule « tout convertir en une seule monnaie » du dashboard.

Ce que ces tests protègent, dans l'ordre de ce qui coûterait le plus cher à
casser :

  - RIEN N'EST CONVERTI SANS QU'ON LE DEMANDE. Le dashboard ordinaire continue
    de rendre un jeu de KPI par monnaie ; la conversion est une route à part,
    et une case à cocher. Le jour où elle déborderait, l'application se mettrait
    à additionner des devises en silence — exactement ce qu'elle refuse ;
  - UNE MONNAIE SANS TAUX EST ÉCARTÉE, ET NOMMÉE. L'inclure au cours de 1
    donnerait un total faux avec l'air d'être juste ; l'écarter sans le dire
    donnerait un total amputé avec le même air ;
  - PAS DE CHAÎNE DE CONVERSION. Un EUR->USD et un USD->JPY ne fabriquent pas un
    EUR->JPY : un taux qu'on n'a jamais saisi apparaîtrait comme connu.
"""
from datetime import date

import pytest

from app import crud, models

from .conftest import (
    charger_module_extension,
    creer_compte,
    creer_monnaie,
    get_categorie_id,
    get_type_id,
)

conversion = charger_module_extension("monnaies", "service_conversion.py")
agrege = charger_module_extension("monnaies", "service_dashboard_agrege.py")
routeur_taux = charger_module_extension("monnaies", "routeur_taux_manuels.py")


# ---------- Outillage ----------


def _taux(db, source, cible, valeur, url=None):
    couple = models.TauxChange(
        monnaie_source_id=source.id if hasattr(source, "id") else source,
        monnaie_cible_id=cible.id if hasattr(cible, "id") else cible,
        url_cours=url,
        taux=valeur,
    )
    db.add(couple)
    db.commit()
    db.refresh(couple)
    return couple


def _euro(db):
    return crud.get_monnaies(db)[0]


def _depense(db, compte, monnaie_id, montant, jour=date(2026, 3, 10)):
    """Une dépense ordinaire, réelle, dans la monnaie donnée."""
    from app import schemas
    from app.constants import Statut

    return crud.create_operation(
        db,
        schemas.OperationCreate(
            date=jour,
            compte_id=compte.id,
            monnaie_id=monnaie_id,
            type_id=get_type_id(db, "classique"),
            categorie_id=get_categorie_id(db, "Charges fixes"),
            nature="Courses",
            montant=montant,
            statut=Statut.reel,
        ),
    )


# ---------- La table de conversion ----------


def test_la_monnaie_cible_vaut_un(db_session):
    euro = _euro(db_session)
    coefficients, _ = conversion.table_de_conversion(db_session, euro.id)
    assert coefficients[euro.id] == 1.0


def test_un_taux_direct_est_utilise_tel_quel(db_session):
    euro = _euro(db_session)
    dollar = creer_monnaie(db_session, "Dollar", "$")
    # 1 $ vaut 0,9 €
    _taux(db_session, dollar, euro, 0.9)
    coefficients, manquantes = conversion.table_de_conversion(db_session, euro.id)
    assert coefficients[dollar.id] == 0.9
    assert manquantes == []


def test_le_taux_inverse_est_admis(db_session):
    """« 1 € = 1,08 $ » et « 1 $ = 0,926 € » sont la même information : exiger
    les deux lignes doublerait la saisie à chaque devise ajoutée."""
    euro = _euro(db_session)
    dollar = creer_monnaie(db_session, "Dollar", "$")
    # 1 € vaut 1,25 $ -> 1 $ vaut 0,8 €
    _taux(db_session, euro, dollar, 1.25)
    coefficients, manquantes = conversion.table_de_conversion(db_session, euro.id)
    assert coefficients[dollar.id] == pytest.approx(0.8)
    assert manquantes == []


def test_une_monnaie_sans_taux_est_nommee(db_session):
    euro = _euro(db_session)
    yen = creer_monnaie(db_session, "Yen", "¥")
    coefficients, manquantes = conversion.table_de_conversion(db_session, euro.id)
    assert yen.id not in coefficients
    assert [m.id for m in manquantes] == [yen.id]


def test_aucune_chaine_de_conversion(db_session):
    """Un taux qu'on n'a jamais saisi ne doit pas apparaître comme connu."""
    euro = _euro(db_session)
    dollar = creer_monnaie(db_session, "Dollar", "$")
    yen = creer_monnaie(db_session, "Yen", "¥")
    _taux(db_session, dollar, euro, 0.9)
    _taux(db_session, yen, dollar, 0.007)

    coefficients, manquantes = conversion.table_de_conversion(db_session, euro.id)
    assert yen.id not in coefficients
    assert [m.id for m in manquantes] == [yen.id]


def test_un_taux_jamais_relu_compte_comme_absent(db_session):
    """Un couple déclaré dont la lecture n'a jamais abouti ne dit rien du
    monde."""
    euro = _euro(db_session)
    dollar = creer_monnaie(db_session, "Dollar", "$")
    _taux(db_session, dollar, euro, None, url="https://exemple.test")
    coefficients, manquantes = conversion.table_de_conversion(db_session, euro.id)
    assert dollar.id not in coefficients
    assert [m.id for m in manquantes] == [dollar.id]


def test_un_taux_relu_en_ligne_sert_aussi_a_convertir(db_session):
    """Les deux extensions écrivent dans la même table : un taux relu en ligne
    n'a pas à être ressaisi."""
    euro = _euro(db_session)
    dollar = creer_monnaie(db_session, "Dollar", "$")
    _taux(db_session, dollar, euro, 0.9, url="https://exemple.test/eurusd")
    coefficients, _ = conversion.table_de_conversion(db_session, euro.id)
    assert coefficients[dollar.id] == 0.9


# ---------- Le dashboard converti ----------


def test_les_soldes_de_deux_monnaies_sont_additionnes(db_session):
    euro = _euro(db_session)
    dollar = creer_monnaie(db_session, "Dollar", "$")
    creer_compte(db_session, "Courant EUR", solde_initial=1000.0)
    creer_compte(db_session, "Courant USD", monnaies=[(dollar.id, 500.0)])
    _taux(db_session, dollar, euro, 0.9)

    payload, manquantes = agrege.dashboard_agrege(db_session, 2026, 3, "mois", euro.id)
    assert manquantes == []
    (kpi,) = payload.kpis
    assert kpi.monnaie_id == euro.id
    assert kpi.solde_total_courant == pytest.approx(1000.0 + 500.0 * 0.9)


def test_une_monnaie_sans_taux_est_ecartee_du_total_et_signalee(db_session):
    """L'inclure au cours de 1 donnerait un total faux avec l'air d'être juste."""
    euro = _euro(db_session)
    yen = creer_monnaie(db_session, "Yen", "¥")
    creer_compte(db_session, "Courant EUR", solde_initial=1000.0)
    creer_compte(db_session, "Courant JPY", monnaies=[(yen.id, 100000.0)])

    payload, manquantes = agrege.dashboard_agrege(db_session, 2026, 3, "mois", euro.id)
    (kpi,) = payload.kpis
    assert kpi.solde_total_courant == 1000.0
    assert [m.id for m in manquantes] == [yen.id]


def test_la_variation_vaut_toujours_entrees_moins_sorties(db_session):
    """Les trois chiffres sont affichés côte à côte : ils doivent s'accorder."""
    euro = _euro(db_session)
    dollar = creer_monnaie(db_session, "Dollar", "$")
    compte_eur = creer_compte(db_session, "Courant EUR", solde_initial=1000.0)
    compte_usd = creer_compte(db_session, "Courant USD", monnaies=[(dollar.id, 500.0)])
    _taux(db_session, dollar, euro, 0.9)
    _depense(db_session, compte_eur, euro.id, 100.0)
    _depense(db_session, compte_usd, dollar.id, 50.0)

    payload, _ = agrege.dashboard_agrege(db_session, 2026, 3, "mois", euro.id)
    (kpi,) = payload.kpis
    assert kpi.variation_previsionnelle == pytest.approx(
        kpi.total_entrees - kpi.total_sorties
    )
    assert kpi.total_sorties == pytest.approx(100.0 + 50.0 * 0.9)


def test_une_categorie_de_deux_monnaies_devient_une_seule_barre(db_session):
    """C'est justement ce que la conversion permet enfin de dire : « Courses »
    en euros et « Courses » en dollars sont la même catégorie."""
    euro = _euro(db_session)
    dollar = creer_monnaie(db_session, "Dollar", "$")
    compte_eur = creer_compte(db_session, "Courant EUR", solde_initial=1000.0)
    compte_usd = creer_compte(db_session, "Courant USD", monnaies=[(dollar.id, 500.0)])
    _taux(db_session, dollar, euro, 0.9)
    _depense(db_session, compte_eur, euro.id, 100.0)
    _depense(db_session, compte_usd, dollar.id, 50.0)

    payload, _ = agrege.dashboard_agrege(db_session, 2026, 3, "mois", euro.id)
    (kpi,) = payload.kpis
    courses = [d for d in kpi.depenses_par_categorie if d.total_reel > 0]
    assert len(courses) == 1
    assert courses[0].total_reel == pytest.approx(100.0 + 50.0 * 0.9)


def test_chaque_compte_ne_rend_plus_quun_seul_solde(db_session):
    euro = _euro(db_session)
    dollar = creer_monnaie(db_session, "Dollar", "$")
    creer_compte(
        db_session, "Mixte", monnaies=[(euro.id, 1000.0), (dollar.id, 500.0)]
    )
    _taux(db_session, dollar, euro, 0.9)

    payload, _ = agrege.dashboard_agrege(db_session, 2026, 3, "mois", euro.id)
    (compte,) = payload.comptes
    (solde,) = compte.soldes
    assert solde.monnaie_id == euro.id
    assert solde.solde_reel == pytest.approx(1000.0 + 500.0 * 0.9)


def test_une_monnaie_portee_par_aucun_compte_ne_rend_rien(db_session):
    """Il n'y a rien à convertir VERS elle, et l'écran doit le savoir plutôt que
    de recevoir un dashboard vide qui aurait l'air normal."""
    creer_compte(db_session, "Courant", solde_initial=1000.0)
    yen = creer_monnaie(db_session, "Yen", "¥")
    payload, _ = agrege.dashboard_agrege(db_session, 2026, 3, "mois", yen.id)
    assert payload is None


# ---------- La saisie ----------


def test_ressaisir_un_couple_met_son_taux_a_jour(db_session):
    """Un taux bouge : refuser le second enregistrement obligerait à supprimer
    pour ressaisir."""
    euro = _euro(db_session)
    dollar = creer_monnaie(db_session, "Dollar", "$")
    payload = routeur_taux.TauxManuelInput(
        monnaie_source_id=dollar.id, monnaie_cible_id=euro.id, taux=0.9
    )
    premier = routeur_taux.poser_taux(payload, db_session)
    payload.taux = 0.95
    second = routeur_taux.poser_taux(payload, db_session)
    assert premier.id == second.id
    assert second.taux == 0.95


def test_une_saisie_a_la_main_ne_porte_aucun_lien(db_session):
    """C'est ce qui la distingue d'un couple suivi : personne n'ira la relire."""
    euro = _euro(db_session)
    dollar = creer_monnaie(db_session, "Dollar", "$")
    lu = routeur_taux.poser_taux(
        routeur_taux.TauxManuelInput(
            monnaie_source_id=dollar.id, monnaie_cible_id=euro.id, taux=0.9
        ),
        db_session,
    )
    assert lu.url_cours is None
    assert lu.maj_le is not None


def test_corriger_un_couple_suivi_ne_perd_pas_son_lien(db_session):
    """Corriger un taux à la main est légitime (la page peut dater) et ne veut
    pas dire qu'on renonce à le relire."""
    euro = _euro(db_session)
    dollar = creer_monnaie(db_session, "Dollar", "$")
    _taux(db_session, dollar, euro, 0.9, url="https://exemple.test/eurusd")
    lu = routeur_taux.poser_taux(
        routeur_taux.TauxManuelInput(
            monnaie_source_id=dollar.id, monnaie_cible_id=euro.id, taux=0.95
        ),
        db_session,
    )
    assert lu.url_cours == "https://exemple.test/eurusd"
    assert lu.taux == 0.95


def test_un_couple_de_deux_fois_la_meme_monnaie_est_refuse(db_session):
    euro = _euro(db_session)
    with pytest.raises(Exception) as erreur:
        routeur_taux.poser_taux(
            routeur_taux.TauxManuelInput(
                monnaie_source_id=euro.id, monnaie_cible_id=euro.id, taux=1.0
            ),
            db_session,
        )
    assert erreur.value.status_code == 400


def test_un_taux_negatif_est_refuse_a_la_saisie(db_session):
    from pydantic import ValidationError

    with pytest.raises(ValidationError):
        routeur_taux.TauxManuelInput(monnaie_source_id=1, monnaie_cible_id=2, taux=-1.0)


# ---------- Les chemins ----------


def test_les_routes_de_conversion_ne_sont_captees_par_aucune_autre(db_session):
    """Le piège dans lequel ces routes sont tombées une fois : montées sous
    `/monnaies/taux`, elles étaient captées par le `PUT /monnaies/{monnaie_id}`
    de l'extension, qui les lisait comme une monnaie d'identifiant « taux » et
    rendait 422 sans que rien ne le signale.

    Un préfixe qui ne peut pas être lu comme le paramètre d'une autre route est
    la seule protection. Ce test la verrouille."""
    chemins = {route.path for route in routeur_taux.router.routes}
    assert all(chemin.startswith("/conversion") for chemin in chemins), chemins

    routeur_monnaies = charger_module_extension("monnaies", "routeur_monnaies.py")
    prefixes_voisins = {route.path for route in routeur_monnaies.router.routes}
    # Aucun chemin littéral de la conversion ne doit ressembler à un chemin
    # paramétré du voisin.
    assert not (chemins & prefixes_voisins)


# ---------- Le dashboard du noyau n'a pas changé ----------


def test_le_dashboard_ordinaire_rend_toujours_un_jeu_de_kpi_par_monnaie(db_session):
    """Le jour où la conversion déborderait, l'application se mettrait à
    additionner des devises en silence."""
    from app.routers import dashboard

    euro = _euro(db_session)
    dollar = creer_monnaie(db_session, "Dollar", "$")
    creer_compte(db_session, "Courant EUR", solde_initial=1000.0)
    creer_compte(db_session, "Courant USD", monnaies=[(dollar.id, 500.0)])
    _taux(db_session, dollar, euro, 0.9)

    lu = dashboard.get_dashboard(annee=2026, mois=3, vue="mois", db=db_session)
    assert {kpi.monnaie_id for kpi in lu.kpis} == {euro.id, dollar.id}
    par_monnaie = {kpi.monnaie_id: kpi for kpi in lu.kpis}
    assert par_monnaie[euro.id].solde_total_courant == 1000.0
    assert par_monnaie[dollar.id].solde_total_courant == 500.0
