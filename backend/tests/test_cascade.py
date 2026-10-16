"""La cascade (waterfall) d'un ensemble d'opérations (services/cascade.py).

Ce que ces tests protègent :

  - LES VIREMENTS SE LISENT PAR PAIRE, et une seule jambe suffit : l'autre est
    relue en base, sans quoi un change vers une autre monnaie n'arriverait nulle
    part ;
  - UN VIREMENT ENTRE DEUX COMPTES DU MÊME TYPE, DANS LA MÊME MONNAIE, NE COMPTE
    PAS — seuls ses frais restent ;
  - COURANT ↔ ÉPARGNE se lit vu du compte courant, signé, HORS FRAIS ;
  - UN CHANGE se lit aux montants ENREGISTRÉS, des deux côtés, frais à part ;
  - LE SOLDE VAUT LA SOMME DES MARCHES, toujours.
"""
from datetime import date

from app import models
from app.constants import Sens, Statut
from app.services import cascade

from .conftest import creer_compte, creer_monnaie, get_categorie_id, get_monnaie_id, get_type_id


def _op(db, compte, montant, sens, monnaie_id=None, **kwargs):
    valeurs = dict(
        date=date(2026, 8, 12),
        type_id=get_type_id(db, "classique"),
        categorie_id=get_categorie_id(db, "Autres"),
        nature="Hôtel",
        monnaie_id=monnaie_id or compte.monnaie_principale_id,
        sens=sens,
        statut=Statut.reel,
        montant=montant,
        montant_du=0.0,
        montant_a_rembourser=0.0,
    )
    valeurs.update(kwargs)
    operation = models.Operation(compte_id=compte.id, **valeurs)
    db.add(operation)
    db.commit()
    db.refresh(operation)
    return operation


def _virement(db, source, destination, envoye, recu, *, monnaie_source=None,
              monnaie_destination=None, frais=None, frais_sur="sortante", vid="v1"):
    commun = dict(type_id=get_type_id(db, "virement"), categorie_id=None, virement_id=vid,
                  nature="Virement")
    sortante = _op(db, source, envoye, Sens.transfert_sortant, monnaie_id=monnaie_source,
                   frais=frais if frais_sur == "sortante" else None, **commun)
    entrante = _op(db, destination, recu, Sens.transfert_entrant, monnaie_id=monnaie_destination,
                   frais=frais if frais_sur == "entrante" else None, **commun)
    return sortante, entrante


def _colonnes(resultat, monnaie_id):
    trouvee = next(c for c in resultat if c["monnaie_id"] == monnaie_id)
    return trouvee, {(c["genre"], c["libelle"]): c["montant"] for c in trouvee["colonnes"]}


def test_les_categories_comptent_au_net_et_les_entrees_d_abord(db_session):
    compte = creer_compte(db_session, "Courant")
    salaire = _op(db_session, compte, 2000, Sens.entree,
                  categorie_id=get_categorie_id(db_session, "Entrées d'argent"), nature="Salaire")
    courses = _op(db_session, compte, 300, Sens.depense,
                  categorie_id=get_categorie_id(db_session, "Alimentaire"))
    resultat = cascade.cascades(db_session, [courses, salaire])
    euros, colonnes = _colonnes(resultat, get_monnaie_id(db_session))
    assert euros["colonnes"][0]["genre"] == "entree"
    assert colonnes[("entree", "Entrées d'argent")] == 2000
    assert colonnes[("depense", "Alimentaire")] == -300
    assert euros["solde"] == 1700


def test_une_operation_decoupee_compte_par_ses_parts(db_session):
    compte = creer_compte(db_session, "Courant")
    plein = _op(db_session, compte, 120, Sens.depense, categorie_id=None)
    for nom, montant in (("Alimentaire", 90), ("Autres", 30)):
        db_session.add(models.OperationDecoupe(
            operation_id=plein.id, categorie_id=get_categorie_id(db_session, nom), montant=montant
        ))
    db_session.commit()
    db_session.refresh(plein)
    _, colonnes = _colonnes(cascade.cascades(db_session, [plein]), get_monnaie_id(db_session))
    assert colonnes == {("depense", "Alimentaire"): -90, ("depense", "Autres"): -30}


def test_courant_vers_epargne_se_lit_hors_frais_vu_du_courant(db_session):
    courant = creer_compte(db_session, "Courant")
    livret = creer_compte(db_session, "Livret", type_nom="épargne")
    sortante, _ = _virement(db_session, courant, livret, 102, 100, frais=2)
    euros, colonnes = _colonnes(cascade.cascades(db_session, [sortante]), get_monnaie_id(db_session))
    assert colonnes == {("epargne", ""): -100, ("frais", ""): -2}
    assert euros["solde"] == -102


def test_entre_deux_comptes_courants_seuls_les_frais_restent(db_session):
    a = creer_compte(db_session, "Courant A")
    b = creer_compte(db_session, "Courant B")
    sortante, entrante = _virement(db_session, a, b, 51, 50, frais=1)
    _, colonnes = _colonnes(
        cascade.cascades(db_session, [sortante, entrante]), get_monnaie_id(db_session)
    )
    assert colonnes == {("frais", ""): -1}


def test_un_change_se_lit_aux_montants_enregistres_des_deux_cotes(db_session):
    euro = get_monnaie_id(db_session)
    franc = creer_monnaie(db_session, "Franc suisse", "CHF").id
    a = creer_compte(db_session, "Courant", monnaies=[(euro, 0)])
    b = creer_compte(db_session, "Compte CHF", monnaies=[(franc, 0)])
    # 103 € débités dont 3 € de frais ; 95 CHF arrivés.
    sortante, _ = _virement(db_session, a, b, 103, 95, monnaie_source=euro,
                            monnaie_destination=franc, frais=3)
    # UNE SEULE JAMBE DANS L'ENSEMBLE : la jambe en francs est relue en base.
    resultat = cascade.cascades(db_session, [sortante])
    euros, en_euros = _colonnes(resultat, euro)
    francs, en_francs = _colonnes(resultat, franc)
    assert en_euros == {("frais", ""): -3, ("conversion", "Franc suisse"): -100}
    assert en_francs == {("conversion", "Euro"): 95}
    assert euros["solde"] == -103 and francs["solde"] == 95
    conversion = next(c for c in euros["colonnes"] if c["genre"] == "conversion")
    assert conversion["monnaie_autre_id"] == franc


def test_les_changes_dans_les_deux_sens_se_compensent(db_session):
    euro = get_monnaie_id(db_session)
    franc = creer_monnaie(db_session, "Franc suisse", "CHF").id
    a = creer_compte(db_session, "Courant", monnaies=[(euro, 0)])
    b = creer_compte(db_session, "Compte CHF", monnaies=[(franc, 0)])
    aller = _virement(db_session, a, b, 100, 95, monnaie_source=euro,
                      monnaie_destination=franc, vid="aller")
    retour = _virement(db_session, b, a, 20, 21, monnaie_source=franc,
                       monnaie_destination=euro, vid="retour")
    _, en_euros = _colonnes(cascade.cascades(db_session, [*aller, *retour]), euro)
    assert en_euros == {("conversion", "Franc suisse"): -79}


def test_le_dashboard_rend_la_cascade_d_une_monnaie_sur_une_periode(db_session):
    from app.routers import dashboard

    euro = get_monnaie_id(db_session)
    franc = creer_monnaie(db_session, "Franc suisse", "CHF").id
    a = creer_compte(db_session, "Courant", monnaies=[(euro, 0)])
    b = creer_compte(db_session, "Compte CHF", monnaies=[(franc, 0)])
    _virement(db_session, a, b, 100, 95, monnaie_source=euro, monnaie_destination=franc)
    _op(db_session, b, 95, Sens.depense, monnaie_id=franc,
        categorie_id=get_categorie_id(db_session, "Alimentaire"))

    cascade_aout = dashboard.get_cascade(franc, "mois", 2026, 8, db_session)
    assert cascade_aout["solde"] == 0
    assert {c["genre"] for c in cascade_aout["colonnes"]} == {"depense", "conversion"}
    vide = dashboard.get_cascade(franc, "mois", 2026, 9, db_session)
    assert vide.colonnes == []
    periodes = dashboard.get_periodes_monnaie(franc, db_session)
    assert [(p.annee, p.mois) for p in periodes] == [(2026, 8)]


def test_l_histogramme_d_un_projet_laisse_changes_et_frais_a_leurs_colonnes(db_session):
    """L'histogramme d'un projet rangeait les virements sortants dans « Sans catégorie ».
    Un change a désormais sa colonne « Conversion vers… », les frais la leur (tirées de la
    cascade), et un virement dans la même monnaie n'y figure plus : rien n'a été dépensé."""
    from app import crud

    from .conftest import charger_module_extension

    service_projets = charger_module_extension("projets-objectifs", "service_projets.py")
    euro = get_monnaie_id(db_session)
    franc = creer_monnaie(db_session, "Franc suisse", "CHF").id
    a = creer_compte(db_session, "Courant", monnaies=[(euro, 0)])
    b = creer_compte(db_session, "Compte CHF", monnaies=[(franc, 0)])
    livret = creer_compte(db_session, "Livret", type_nom="épargne")
    change, _ = _virement(db_session, a, b, 103, 95, monnaie_source=euro,
                          monnaie_destination=franc, frais=3, vid="change")
    epargne, _ = _virement(db_session, a, livret, 102, 100, frais=2, vid="epargne")

    projet = crud.create_sous_filtre(db_session, nom="Suisse", description="")
    crud.ajouter_operations_au_sous_filtre(db_session, projet, [change.id, epargne.id])

    lu = service_projets.lire_sous_filtre(projet, db_session)
    total = next(t for t in lu["totaux"] if t["monnaie_id"] == euro)
    # AUCUN VIREMENT : ni le change (sa colonne de conversion), ni celui vers le livret
    # (l'argent a changé de compte, rien n'a été dépensé), ni leurs frais (leur colonne).
    assert total["depenses_par_categorie"] == []
    cascade_euros = next(c for c in lu["cascades"] if c["monnaie_id"] == euro)
    colonnes = {(c["genre"], c["libelle"]): c["montant"] for c in cascade_euros["colonnes"]}
    assert colonnes[("frais", "")] == -5
    assert colonnes[("conversion", "Franc suisse")] == -100


def test_les_frais_de_virements_se_listent_par_paire(db_session):
    from app.routers import dashboard

    euro = get_monnaie_id(db_session)
    franc = creer_monnaie(db_session, "Franc suisse", "CHF").id
    a = creer_compte(db_session, "Courant", monnaies=[(euro, 0)])
    b = creer_compte(db_session, "Compte CHF", monnaies=[(franc, 0)])
    _virement(db_session, a, b, 103, 95, monnaie_source=euro, monnaie_destination=franc,
              frais=3, vid="avec")
    _virement(db_session, a, b, 50, 47, monnaie_source=euro, monnaie_destination=franc,
              vid="sans")
    _virement(db_session, b, a, 20, 19, monnaie_source=franc, monnaie_destination=euro,
              frais=1, frais_sur="entrante", vid="retour")

    lus = {v.virement_id: v for v in dashboard.get_frais_virements(db_session)}
    assert set(lus) == {"avec", "retour"}
    assert (lus["avec"].frais, lus["avec"].monnaie_frais_id) == (3, euro)
    assert (lus["retour"].frais, lus["retour"].monnaie_frais_id) == (1, euro)
    assert lus["retour"].sortante.monnaie_id == franc
