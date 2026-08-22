"""Veille comparative sur les virements internes de l'aperçu d'import.

Le cas qui la motive : un virement du compte A vers le compte B apparaît DEUX
FOIS, une fois dans le relevé de A (un débit) et une fois dans celui de B (un
crédit). Ce sont deux fichiers, deux presets, deux jeux de colonnes qui n'ont
rien de commun : la détection de doublons ordinaire (cf. detecter_doublon, qui
compare des lignes de fichier au sein d'un même preset) ne peut structurellement
pas les rapprocher. Seule la TRANSACTION les rapproche — deux comptes, un
montant, une date voisine.

Purement consultatif : ces tests vérifient qu'on signale, jamais qu'on bloque.
"""
from datetime import date

from app import crud, models, schemas
from app.constants import Sens, Statut
from app.services import import_bancaire

from .conftest import creer_compte, creer_monnaie, get_monnaie_id


def _virement(db, source, destination, montant, jour, monnaie_id=None, nature="Transfert"):
    monnaie_id = monnaie_id if monnaie_id is not None else get_monnaie_id(db)
    return crud.create_virement(
        db,
        schemas.VirementCreate(
            date=jour,
            compte_source_id=source.id,
            compte_destination_id=destination.id,
            montant=montant,
            monnaie_id=monnaie_id,
            nature=nature,
            statut=Statut.reel,
        ),
        source,
        destination,
    )


def _candidat(ligne, source, destination, montant, jour, monnaie_id=None):
    return schemas.VirementCandidatDoublon(
        ligne=ligne,
        date=jour,
        montant=montant,
        monnaie_id=monnaie_id,
        compte_source_id=source.id,
        compte_destination_id=destination.id,
    )


def test_un_virement_deja_importe_est_signale(db_session):
    a = creer_compte(db_session, "Compte A", solde_initial=1000.0)
    b = creer_compte(db_session, "Compte B", solde_initial=0.0)
    _virement(db_session, a, b, 250.0, date(2026, 3, 2), nature="Vers B")

    resultats = import_bancaire.detecter_doublons_virements(
        db_session, [_candidat(4, a, b, 250.0, date(2026, 3, 5))]
    )

    assert len(resultats) == 1
    assert resultats[0].ligne == 4
    (suspect,) = resultats[0].suspects
    assert suspect.source == "base"
    assert (suspect.compte_source, suspect.compte_destination) == ("Compte A", "Compte B")
    assert suspect.montant == 250.0
    assert suspect.ecart_jours == 3


def test_sept_jours_pile_est_encore_signale(db_session):
    """« Espacées d'au plus 7 jours » : la borne est incluse."""
    a = creer_compte(db_session, "Compte A", solde_initial=1000.0)
    b = creer_compte(db_session, "Compte B", solde_initial=0.0)
    _virement(db_session, a, b, 250.0, date(2026, 3, 2))

    resultats = import_bancaire.detecter_doublons_virements(
        db_session, [_candidat(1, a, b, 250.0, date(2026, 3, 9))]
    )
    assert [s.ecart_jours for r in resultats for s in r.suspects] == [7]


def test_au_dela_de_sept_jours_rien_nest_signale(db_session):
    """La fenêtre borne le décalage entre deux dates de valeur bancaires. Plus
    large, un virement mensuel récurrent — un loyer, une mise de côté — serait
    signalé tous les mois pour rien."""
    a = creer_compte(db_session, "Compte A", solde_initial=1000.0)
    b = creer_compte(db_session, "Compte B", solde_initial=0.0)
    _virement(db_session, a, b, 250.0, date(2026, 3, 2))

    assert (
        import_bancaire.detecter_doublons_virements(
            db_session, [_candidat(1, a, b, 250.0, date(2026, 3, 10))]
        )
        == []
    )


def test_le_sens_compte(db_session):
    """A→B et B→A sont deux virements distincts, pas un aller-retour suspect."""
    a = creer_compte(db_session, "Compte A", solde_initial=1000.0)
    b = creer_compte(db_session, "Compte B", solde_initial=1000.0)
    _virement(db_session, a, b, 250.0, date(2026, 3, 2))

    assert (
        import_bancaire.detecter_doublons_virements(
            db_session, [_candidat(1, b, a, 250.0, date(2026, 3, 3))]
        )
        == []
    )


def test_deux_monnaies_differentes_ne_se_confondent_pas(db_session):
    euro = get_monnaie_id(db_session)
    dollar = creer_monnaie(db_session, "Dollar", "$").id
    a = creer_compte(db_session, "Wise", monnaies=[(euro, 1000.0), (dollar, 1000.0)])
    b = creer_compte(db_session, "Compte B", monnaies=[(euro, 0.0), (dollar, 0.0)])
    _virement(db_session, a, b, 100.0, date(2026, 3, 2), monnaie_id=euro)

    # Même montant, mêmes comptes, même semaine — mais 100 $ ne sont pas 100 €.
    assert (
        import_bancaire.detecter_doublons_virements(
            db_session, [_candidat(1, a, b, 100.0, date(2026, 3, 3), monnaie_id=dollar)]
        )
        == []
    )
    # La même comparaison en euros, elle, ressort.
    assert len(
        import_bancaire.detecter_doublons_virements(
            db_session, [_candidat(1, a, b, 100.0, date(2026, 3, 3), monnaie_id=euro)]
        )
    ) == 1


def test_un_virement_sans_second_compte_nest_jamais_un_suspect(db_session):
    """Une écriture importée sans son compte en face ne dit pas d'où l'argent
    vient : la rapprocher sur le seul compte connu signalerait comme doublon
    tout virement de même montant partant du même compte vers n'importe où."""
    a = creer_compte(db_session, "Compte A", solde_initial=1000.0)
    b = creer_compte(db_session, "Compte B", solde_initial=0.0)
    type_virement = (
        db_session.query(models.TypeOperationDB)
        .filter(models.TypeOperationDB.code == "virement")
        .one()
    )
    crud.create_operation_importee(
        db_session,
        date_operation=date(2026, 3, 2),
        compte_id=a.id,
        type_id=type_virement.id,
        categorie_id=None,
        nature="Transfert",
        montant=250.0,
        monnaie_id=get_monnaie_id(db_session),
        # Comme le fait l'import réel (cf. import_bancaire.confirmer) : le sens
        # d'un virement ne se déduit pas de son type. L'omettre ici enregistrait
        # le transfert comme une DÉPENSE, ce qui le faisait entrer dans la
        # variation de la période — le sens est désormais obligatoire.
        sens=Sens.transfert_sortant,
    )

    assert (
        import_bancaire.detecter_doublons_virements(
            db_session, [_candidat(1, a, b, 250.0, date(2026, 3, 3))]
        )
        == []
    )


def test_deux_lignes_du_meme_fichier_se_rapprochent_une_seule_fois(db_session):
    a = creer_compte(db_session, "Compte A", solde_initial=1000.0)
    b = creer_compte(db_session, "Compte B", solde_initial=0.0)

    resultats = import_bancaire.detecter_doublons_virements(
        db_session,
        [
            _candidat(1, a, b, 80.0, date(2026, 3, 2)),
            _candidat(2, a, b, 80.0, date(2026, 3, 4)),
        ],
    )

    # Une seule paire, signalée sur la SECONDE ligne : la signaler des deux
    # côtés ferait lire deux alertes là où il n'y a qu'une suspicion.
    assert len(resultats) == 1
    assert resultats[0].ligne == 2
    (suspect,) = resultats[0].suspects
    assert (suspect.source, suspect.ligne, suspect.ecart_jours) == ("fichier", 1, 2)


def test_le_libelle_nentre_jamais_en_jeu(db_session):
    """LE point de la fonctionnalité : le même virement décrit par deux banques
    porte deux libellés sans rapport. Les comparer reviendrait à ne détecter que
    les doublons qu'on aurait de toute façon vus."""
    a = creer_compte(db_session, "Compte A", solde_initial=1000.0)
    b = creer_compte(db_session, "Compte B", solde_initial=0.0)
    _virement(db_session, a, b, 3500.0, date(2026, 7, 10), nature="VIREMENT VERS BOURSOBANK")

    resultats = import_bancaire.detecter_doublons_virements(
        db_session, [_candidat(1, a, b, 3500.0, date(2026, 7, 14))]
    )

    assert len(resultats) == 1
    assert resultats[0].suspects[0].nature == "VIREMENT VERS BOURSOBANK"


def test_un_seul_montant_correspondant_suffit_a_signaler(db_session):
    """UN montant qui correspond suffit, l'autre n'a pas à suivre.

    Deux relevés d'un même virement avec change ne s'accordent presque jamais
    sur les deux jambes : celui de l'émetteur donne ce qui part, celui du
    récepteur ce qui arrive, et une commission d'un centime d'écart sur la
    seconde faisait auparavant échouer tout le rapprochement. Les deux comptes,
    les devises et la fenêtre de dates restent exigés à l'identique."""
    euro = get_monnaie_id(db_session)
    dollar = creer_monnaie(db_session, "Dollar", "$").id
    a = creer_compte(db_session, "Wise", monnaies=[(euro, 1000.0), (dollar, 0.0)])
    b = creer_compte(db_session, "Compte B", monnaies=[(dollar, 0.0)])
    crud.create_virement(
        db_session,
        schemas.VirementCreate(
            date=date(2026, 3, 2),
            compte_source_id=a.id,
            compte_destination_id=b.id,
            montant=100.0,
            monnaie_id=euro,
            montant_destination=108.0,
            monnaie_destination_id=dollar,
            nature="Envoi",
            statut=Statut.reel,
        ),
        a,
        b,
    )

    def candidat(montant_recu):
        return schemas.VirementCandidatDoublon(
            ligne=1,
            date=date(2026, 3, 4),
            montant=100.0,
            monnaie_id=euro,
            montant_recu=montant_recu,
            monnaie_recue_id=dollar,
            compte_source_id=a.id,
            compte_destination_id=b.id,
        )

    # Le montant envoyé correspond (100 €), le reçu non (112 $ contre 108) :
    # signalé quand même — c'est précisément le cas qu'on veut voir.
    assert len(import_bancaire.detecter_doublons_virements(db_session, [candidat(112.0)])) == 1
    # Les deux qui correspondent : signalé, évidemment.
    assert len(import_bancaire.detecter_doublons_virements(db_session, [candidat(108.0)])) == 1
    # Le reçu seul correspond, l'envoyé non : signalé aussi, la règle est
    # symétrique — le relevé du compte récepteur ne connaît que cette jambe-là.
    autre_sens = schemas.VirementCandidatDoublon(
        ligne=1,
        date=date(2026, 3, 4),
        montant=97.0,
        monnaie_id=euro,
        montant_recu=108.0,
        monnaie_recue_id=dollar,
        compte_source_id=a.id,
        compte_destination_id=b.id,
    )
    assert len(import_bancaire.detecter_doublons_virements(db_session, [autre_sens])) == 1
    # Aucun des deux ne correspond : rien à signaler.
    ni_lun_ni_lautre = autre_sens.model_copy(update={"montant": 97.0, "montant_recu": 112.0})
    assert import_bancaire.detecter_doublons_virements(db_session, [ni_lun_ni_lautre]) == []


def test_rien_nest_bloque_ni_ecarte(db_session):
    """La veille ne touche pas aux données : elle lit et signale, point."""
    a = creer_compte(db_session, "Compte A", solde_initial=1000.0)
    b = creer_compte(db_session, "Compte B", solde_initial=0.0)
    _virement(db_session, a, b, 250.0, date(2026, 3, 2))
    avant = db_session.query(models.Operation).count()

    import_bancaire.detecter_doublons_virements(
        db_session, [_candidat(1, a, b, 250.0, date(2026, 3, 3))]
    )

    assert db_session.query(models.Operation).count() == avant
