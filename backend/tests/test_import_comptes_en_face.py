"""L'étape 3bis de l'import : le compte en face que l'application PROPOSE pour un virement.

Un relevé ne décrit qu'une jambe d'un virement interne ; l'écran demande l'autre compte, carte par
carte. L'application devine sans choisir : le compte du dernier virement déjà en base parti du même
compte, dans le même sens, sous le même libellé. Rien d'autre — un libellé différent, un compte fermé
ou le compte du fichier ne proposent rien.
"""
from datetime import date

from app import crud, schemas
from app.constants import Statut
from app.services import import_bancaire

from .conftest import creer_compte, get_monnaie_id


def _virement(db, source, destination, jour, nature, montant=100.0):
    return crud.create_virement(
        db,
        schemas.VirementCreate(
            date=jour,
            compte_source_id=source.id,
            compte_destination_id=destination.id,
            montant=montant,
            monnaie_id=get_monnaie_id(db),
            nature=nature,
            statut=Statut.reel,
        ),
        source,
        destination,
    )


def _demande(ligne, compte, nature, jambe):
    return schemas.CompteEnFaceDemande(ligne=ligne, compte_id=compte.id, nature=nature, jambe=jambe)


def test_le_meme_libelle_propose_le_compte_du_dernier_virement(db_session):
    courant = creer_compte(db_session, "Courant", solde_initial=1000.0)
    livret = creer_compte(db_session, "Livret", type_nom="épargne")
    pel = creer_compte(db_session, "PEL", type_nom="épargne")
    _virement(db_session, courant, pel, date(2026, 1, 5), "VIR EPARGNE MENSUELLE")
    _virement(db_session, courant, livret, date(2026, 2, 5), "VIR EPARGNE MENSUELLE")

    propositions = import_bancaire.proposer_comptes_en_face(
        db_session,
        # Casse, accents et espaces ne comptent pas.
        [_demande(3, courant, "Vir épargne  mensuelle", "sortante")],
    )

    assert propositions == {3: livret.id}


def test_le_sens_compte(db_session):
    """Une jambe entrante ne reprend pas le compte d'un virement sortant de même libellé."""
    courant = creer_compte(db_session, "Courant", solde_initial=1000.0)
    livret = creer_compte(db_session, "Livret", type_nom="épargne")
    _virement(db_session, courant, livret, date(2026, 2, 5), "VIREMENT")

    assert import_bancaire.proposer_comptes_en_face(db_session, [_demande(1, courant, "VIREMENT", "entrante")]) == {}
    assert import_bancaire.proposer_comptes_en_face(db_session, [_demande(1, courant, "VIREMENT", "sortante")]) == {
        1: livret.id
    }
    # Côté livret, la même opération est une jambe entrante, venue du courant.
    assert import_bancaire.proposer_comptes_en_face(db_session, [_demande(2, livret, "VIREMENT", "entrante")]) == {
        2: courant.id
    }


def test_sans_sens_connu_le_libelle_suffit(db_session):
    courant = creer_compte(db_session, "Courant", solde_initial=1000.0)
    livret = creer_compte(db_session, "Livret", type_nom="épargne")
    _virement(db_session, livret, courant, date(2026, 2, 5), "RETOUR LIVRET")

    assert import_bancaire.proposer_comptes_en_face(db_session, [_demande(1, courant, "RETOUR LIVRET", None)]) == {
        1: livret.id
    }


def test_un_autre_libelle_ne_propose_rien(db_session):
    courant = creer_compte(db_session, "Courant", solde_initial=1000.0)
    livret = creer_compte(db_session, "Livret", type_nom="épargne")
    _virement(db_session, courant, livret, date(2026, 2, 5), "VIR EPARGNE 02/2026")

    assert (
        import_bancaire.proposer_comptes_en_face(db_session, [_demande(1, courant, "VIR EPARGNE 03/2026", "sortante")])
        == {}
    )
    assert import_bancaire.proposer_comptes_en_face(db_session, [_demande(1, courant, "", "sortante")]) == {}


def test_un_virement_d_un_autre_compte_ne_propose_rien(db_session):
    courant = creer_compte(db_session, "Courant", solde_initial=1000.0)
    joint = creer_compte(db_session, "Joint", solde_initial=1000.0)
    livret = creer_compte(db_session, "Livret", type_nom="épargne")
    _virement(db_session, joint, livret, date(2026, 2, 5), "VIREMENT")

    assert import_bancaire.proposer_comptes_en_face(db_session, [_demande(1, courant, "VIREMENT", "sortante")]) == {}


def test_un_compte_ferme_n_est_pas_propose(db_session):
    courant = creer_compte(db_session, "Courant", solde_initial=1000.0)
    ancien = creer_compte(db_session, "Ancien livret", type_nom="épargne")
    livret = creer_compte(db_session, "Livret", type_nom="épargne")
    _virement(db_session, courant, livret, date(2026, 1, 5), "VIREMENT")
    _virement(db_session, courant, ancien, date(2026, 2, 5), "VIREMENT")
    ancien.actif = False
    db_session.commit()

    # Le dernier virement allait vers un compte fermé : on remonte au précédent.
    assert import_bancaire.proposer_comptes_en_face(db_session, [_demande(1, courant, "VIREMENT", "sortante")]) == {
        1: livret.id
    }
