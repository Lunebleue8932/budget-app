"""Notes libres sur une opération.

Un champ texte sans aucune sémantique : l'app ne le lit jamais, ne le filtre pas
et ne l'additionne pas. Ce qui compte donc, c'est qu'il traverse la création, la
lecture et la modification sans être ni perdu ni inventé — y compris sur un
virement, dont les DEUX écritures se saisissent d'un bloc et portent donc la
même note.
"""
from datetime import date

from app import crud, models, schemas
from app.constants import Sens, Statut
from app.routers.operations import update_operation

from .conftest import creer_compte, get_categorie_id, get_monnaie_id, get_type_id


def _operation(db, compte, **kwargs):
    defaults = dict(
        date=date(2026, 7, 1),
        compte_id=compte.id,
        monnaie_id=get_monnaie_id(db),
        type_id=get_type_id(db, "classique"),
        categorie_id=get_categorie_id(db, "Autres"),
        nature="Restaurant",
        montant=42.0,
        statut=Statut.reel,
    )
    defaults.update(kwargs)
    return crud.create_operation(db, schemas.OperationCreate(**defaults))


def test_une_operation_sans_note_reste_a_null(db_session):
    """NULL et pas "" : une opération jamais annotée doit pouvoir se distinguer
    d'une note effacée à la main."""
    compte = creer_compte(db_session, "Courant")
    assert _operation(db_session, compte).notes is None


def test_la_note_survit_a_la_creation_et_a_la_relecture(db_session):
    compte = creer_compte(db_session, "Courant")
    operation = _operation(db_session, compte, notes="Facture partagée avec Léa")

    relue = schemas.OperationRead.model_validate(crud.get_operation(db_session, operation.id))
    assert relue.notes == "Facture partagée avec Léa"


def test_modifier_une_note_ne_touche_a_rien_dautre(db_session):
    compte = creer_compte(db_session, "Courant")
    operation = _operation(db_session, compte, notes="première version")

    modifiee = update_operation(
        operation.id, schemas.OperationUpdate(notes="à revérifier"), db_session
    )

    assert modifiee.notes == "à revérifier"
    assert (modifiee.montant, modifiee.nature) == (42.0, "Restaurant")


def test_une_modification_qui_ne_parle_pas_de_notes_les_laisse_intactes(db_session):
    """OperationUpdate lit `exclude_unset` : ne pas envoyer la clé n'est pas la
    même chose que l'envoyer vide."""
    compte = creer_compte(db_session, "Courant")
    operation = _operation(db_session, compte, notes="à garder")

    modifiee = update_operation(operation.id, schemas.OperationUpdate(montant=50.0), db_session)

    assert modifiee.notes == "à garder"


def test_un_virement_porte_la_meme_note_sur_ses_deux_jambes(db_session):
    source = creer_compte(db_session, "Courant", solde_initial=500.0)
    destination = creer_compte(db_session, "Livret", type_nom="épargne")
    sortante, entrante = crud.create_virement(
        db_session,
        schemas.VirementCreate(
            date=date(2026, 7, 1),
            compte_source_id=source.id,
            compte_destination_id=destination.id,
            montant=200.0,
            monnaie_id=get_monnaie_id(db_session),
            statut=Statut.reel,
            notes="mise de côté du mois",
        ),
        source,
        destination,
    )

    assert sortante.notes == entrante.notes == "mise de côté du mois"
    assert (sortante.sens, entrante.sens) == (Sens.transfert_sortant, Sens.transfert_entrant)


def test_modifier_un_virement_met_a_jour_la_note_des_deux_cotes(db_session):
    source = creer_compte(db_session, "Courant", solde_initial=500.0)
    destination = creer_compte(db_session, "Livret", type_nom="épargne")
    payload = dict(
        date=date(2026, 7, 1),
        compte_source_id=source.id,
        compte_destination_id=destination.id,
        montant=200.0,
        monnaie_id=get_monnaie_id(db_session),
        statut=Statut.reel,
    )
    sortante, _ = crud.create_virement(
        db_session, schemas.VirementCreate(**payload, notes="brouillon"), source, destination
    )
    operations = crud.get_virement(db_session, sortante.virement_id)

    crud.update_virement(
        db_session,
        operations,
        schemas.VirementCreate(**payload, notes="épargne de juillet"),
        source,
        destination,
    )

    notes = {op.notes for op in crud.get_virement(db_session, sortante.virement_id)}
    assert notes == {"épargne de juillet"}


def test_une_operation_importee_nait_sans_note(db_session):
    """Rien dans un relevé bancaire ne ressemble à une note : elle ne peut venir
    que de l'utilisateur, après coup."""
    compte = creer_compte(db_session, "Courant")
    operation = crud.create_operation_importee(
        db_session,
        date_operation=date(2026, 7, 1),
        compte_id=compte.id,
        type_id=get_type_id(db_session, "classique"),
        categorie_id=get_categorie_id(db_session, "Autres"),
        nature="Carrefour",
        montant=12.0,
        monnaie_id=get_monnaie_id(db_session),
    )
    assert operation.notes is None
    assert db_session.query(models.Operation).count() == 1


# ---------- Bloc-notes libre du dashboard ----------


def test_une_base_sans_note_repond_une_note_vide(db_session):
    """Pas d'erreur, pas de 404 : le dashboard doit pouvoir afficher son champ
    dès le premier lancement."""
    from app.routers.dashboard import get_note

    note = get_note(db_session)
    assert note.contenu == ""
    assert note.modifie_le is None


def test_la_note_du_dashboard_secrit_et_se_relit(db_session):
    from app.routers.dashboard import get_note, set_note

    set_note(schemas.NoteDashboardUpdate(contenu="Relancer Marie\nVérifier EDF"), db_session)

    relue = get_note(db_session)
    assert relue.contenu == "Relancer Marie\nVérifier EDF"
    assert relue.modifie_le is not None


def test_reecrire_la_note_ne_cree_pas_une_seconde_ligne(db_session):
    """Une seule note pour toute la base : laisser des lignes s'accumuler
    ferait dépendre l'affichage d'un ordre de lecture."""
    from app.routers.dashboard import set_note

    for texte in ("premier jet", "deuxième", "troisième"):
        set_note(schemas.NoteDashboardUpdate(contenu=texte), db_session)

    assert db_session.query(models.NoteDashboard).count() == 1
    assert crud.get_note_dashboard(db_session).contenu == "troisième"


def test_vider_la_note_est_une_suppression_legitime(db_session):
    from app.routers.dashboard import get_note, set_note

    set_note(schemas.NoteDashboardUpdate(contenu="à effacer"), db_session)
    set_note(schemas.NoteDashboardUpdate(contenu=""), db_session)

    assert get_note(db_session).contenu == ""
