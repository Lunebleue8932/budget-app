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


# ---------- Un seul compte connu : le cas ordinaire d'un relevé ----------
#
# Un relevé ne nomme QUE son propre compte. Exiger les deux revenait à demander
# à l'utilisateur de retrouver le compte d'en face ligne par ligne et à chaque
# import — pour s'entendre dire ensuite que la ligne était un doublon et qu'il
# n'avait qu'à la supprimer. Le travail était réclamé exactement dans le cas où
# il ne servait à rien.


def _candidat_partiel(ligne, montant, jour, *, source=None, destination=None, monnaie_id=None):
    """Un candidat dont un seul des deux comptes est connu."""
    return schemas.VirementCandidatDoublon(
        ligne=ligne,
        date=jour,
        montant=montant,
        monnaie_id=monnaie_id,
        compte_source_id=source.id if source else None,
        compte_destination_id=destination.id if destination else None,
    )


def test_le_compte_emetteur_seul_suffit_a_signaler(db_session):
    """Le relevé de A décrit un débit : on connaît A, pas B."""
    a = creer_compte(db_session, "Compte A", solde_initial=1000.0)
    b = creer_compte(db_session, "Compte B", solde_initial=0.0)
    _virement(db_session, a, b, 250.0, date(2026, 3, 2), nature="Vers B")

    resultats = import_bancaire.detecter_doublons_virements(
        db_session, [_candidat_partiel(4, 250.0, date(2026, 3, 5), source=a)]
    )

    assert len(resultats) == 1
    suspect = resultats[0].suspects[0]
    assert suspect.compte_source == "Compte A"
    assert suspect.compte_destination == "Compte B"
    # LA MOITIÉ UTILE : le compte que la ligne ne nommait pas est rendu, nommé
    # comme tel. C'est précisément ce qu'on évitait de faire retrouver à la main.
    assert suspect.compte_en_face == "Compte B"


def test_le_compte_recepteur_seul_suffit_a_signaler(db_session):
    """L'autre moitié : le relevé de B décrit un crédit, on ne connaît que B."""
    a = creer_compte(db_session, "Compte A", solde_initial=1000.0)
    b = creer_compte(db_session, "Compte B", solde_initial=0.0)
    _virement(db_session, a, b, 250.0, date(2026, 3, 2))

    resultats = import_bancaire.detecter_doublons_virements(
        db_session, [_candidat_partiel(4, 250.0, date(2026, 3, 4), destination=b)]
    )

    assert len(resultats) == 1
    assert resultats[0].suspects[0].compte_en_face == "Compte A"


def test_avec_un_seul_compte_le_sens_ne_departage_plus(db_session):
    """LE RÔLE DU COMPTE CONNU EST UNE DÉDUCTION, PAS UN FAIT.

    Il vient du signe du montant, et ce signe manque plus souvent qu'on ne
    croit : montant corrigé à la main, colonnes débit/crédit vides ou toutes
    deux remplies, relevé sans colonne de sens. La ligne est alors rangée d'un
    côté par défaut — au hasard une fois sur deux. Écarter un rapprochement sur
    cette base revenait à rater précisément les lignes que la veille existe pour
    attraper.

    Le sens continue de départager quand la ligne nomme SES DEUX comptes : là,
    il n'est plus déduit (cf. test_le_sens_compte)."""
    a = creer_compte(db_session, "Compte A", solde_initial=1000.0)
    b = creer_compte(db_session, "Compte B", solde_initial=1000.0)
    _virement(db_session, b, a, 250.0, date(2026, 3, 2))

    resultats = import_bancaire.detecter_doublons_virements(
        db_session, [_candidat_partiel(4, 250.0, date(2026, 3, 3), source=a)]
    )

    assert len(resultats) == 1
    # Le compte rendu reste juste : c'est B qu'on apprend, pas A qu'on savait.
    assert resultats[0].suspects[0].compte_en_face == "Compte B"


def test_un_compte_qui_ne_correspond_pas_ecarte_le_rapprochement(db_session):
    a = creer_compte(db_session, "Compte A", solde_initial=1000.0)
    b = creer_compte(db_session, "Compte B", solde_initial=0.0)
    c = creer_compte(db_session, "Compte C", solde_initial=1000.0)
    _virement(db_session, a, b, 250.0, date(2026, 3, 2))

    resultats = import_bancaire.detecter_doublons_virements(
        db_session, [_candidat_partiel(4, 250.0, date(2026, 3, 3), source=c)]
    )

    assert resultats == []


def test_les_deux_comptes_connus_gardent_le_comportement_d_avant(db_session):
    """Quand une règle a déduit le second compte, rien ne change : les deux sont
    comparés, et il n'y a plus rien à apprendre du suspect."""
    a = creer_compte(db_session, "Compte A", solde_initial=1000.0)
    b = creer_compte(db_session, "Compte B", solde_initial=0.0)
    _virement(db_session, a, b, 250.0, date(2026, 3, 2))

    resultats = import_bancaire.detecter_doublons_virements(
        db_session, [_candidat(4, a, b, 250.0, date(2026, 3, 3))]
    )

    assert len(resultats) == 1
    assert resultats[0].suspects[0].compte_en_face is None


def test_deux_lignes_qui_n_ont_aucun_compte_comparable_ne_se_rapprochent_pas(db_session):
    """LA BORNE. Deux lignes d'un même fichier connaissant chacune un compte,
    mais dans deux rôles différents, ne partagent plus qu'un montant et une
    date : sans cette garde, n'importe quels deux virements de même montant dans
    la semaine se signaleraient l'un l'autre."""
    a = creer_compte(db_session, "Compte A", solde_initial=1000.0)
    b = creer_compte(db_session, "Compte B", solde_initial=1000.0)

    resultats = import_bancaire.detecter_doublons_virements(
        db_session,
        [
            _candidat_partiel(1, 250.0, date(2026, 3, 2), source=a),
            _candidat_partiel(2, 250.0, date(2026, 3, 3), destination=b),
        ],
    )

    assert resultats == []


def test_deux_lignes_du_meme_fichier_sur_le_meme_compte_se_rapprochent(db_session):
    """Le même relevé qui décrit deux fois le même départ : là, un compte EST
    comparé, et le rapprochement tient."""
    a = creer_compte(db_session, "Compte A", solde_initial=1000.0)

    resultats = import_bancaire.detecter_doublons_virements(
        db_session,
        [
            _candidat_partiel(1, 250.0, date(2026, 3, 2), source=a),
            _candidat_partiel(2, 250.0, date(2026, 3, 3), source=a),
        ],
    )

    assert [r.ligne for r in resultats] == [2]
    assert resultats[0].suspects[0].source == "fichier"


def test_la_fenetre_de_sept_jours_tient_aussi_avec_un_seul_compte(db_session):
    """Le relâchement porte sur les comptes, pas sur la date : un virement
    récurrent du même montant ne doit pas se signaler tous les mois."""
    a = creer_compte(db_session, "Compte A", solde_initial=5000.0)
    b = creer_compte(db_session, "Compte B", solde_initial=0.0)
    _virement(db_session, a, b, 250.0, date(2026, 3, 2))

    resultats = import_bancaire.detecter_doublons_virements(
        db_session, [_candidat_partiel(4, 250.0, date(2026, 4, 2), source=a)]
    )

    assert resultats == []


def test_les_devises_tiennent_aussi_avec_un_seul_compte(db_session):
    """Deux montants égaux dans deux monnaies différentes ne sont pas le même
    virement, que l'on connaisse un compte ou les deux."""
    dollar = creer_monnaie(db_session, "Dollar", "$")
    a = creer_compte(db_session, "Compte A", solde_initial=1000.0)
    b = creer_compte(db_session, "Compte B", solde_initial=0.0)
    _virement(db_session, a, b, 250.0, date(2026, 3, 2))

    resultats = import_bancaire.detecter_doublons_virements(
        db_session,
        [_candidat_partiel(4, 250.0, date(2026, 3, 3), source=a, monnaie_id=dollar.id)],
    )

    assert resultats == []


# ---------- Ce que le rapprochement partiel ne doit PLUS exiger ----------
#
# Chacun de ces tests correspond à une condition qui a été essayée, qui
# paraissait raisonnable, et qui écartait en pratique les lignes mêmes que la
# veille existe pour attraper.


def test_un_relevé_sans_sens_est_quand_meme_rapproche(db_session):
    """LE CAS QUI A FAIT ÉCHOUER DEUX CORRECTIFS.

    Une ligne dont le fichier ne tranche pas le sens n'a pas de rôle fiable pour
    son compte connu : le frontend la range côté récepteur par défaut (cf.
    candidatsDoublonsVirements, `montant_signe || 0`). Si ce défaut tombe à
    l'envers du virement en base, un rapprochement aligné sur les rôles ne
    trouve rien — alors que tout le reste concorde.
    """
    a = creer_compte(db_session, "Compte A", solde_initial=1000.0)
    b = creer_compte(db_session, "Compte B", solde_initial=0.0)
    _virement(db_session, a, b, 250.0, date(2026, 3, 2), nature="Vers B")

    # A est l'ÉMETTEUR en base ; faute de signe, la ligne le présente en
    # récepteur. Le rapprochement doit tenir quand même.
    resultats = import_bancaire.detecter_doublons_virements(
        db_session, [_candidat_partiel(4, 250.0, date(2026, 3, 2), destination=a)]
    )

    assert len(resultats) == 1
    assert resultats[0].suspects[0].compte_en_face == "Compte B"


def test_le_compte_en_face_n_est_jamais_celui_qu_on_connait_deja(db_session):
    """Désigné par ÉLIMINATION : quel que soit le rôle sous lequel la ligne
    range son compte, on lui rend l'AUTRE — jamais celui qu'elle nomme déjà."""
    a = creer_compte(db_session, "Compte A", solde_initial=1000.0)
    b = creer_compte(db_session, "Compte B", solde_initial=0.0)
    _virement(db_session, a, b, 250.0, date(2026, 3, 2))

    par_role = {
        "connu comme émetteur": _candidat_partiel(1, 250.0, date(2026, 3, 2), source=a),
        "connu comme récepteur": _candidat_partiel(2, 250.0, date(2026, 3, 2), destination=a),
    }
    for cas, candidat in par_role.items():
        resultats = import_bancaire.detecter_doublons_virements(db_session, [candidat])
        assert len(resultats) == 1, cas
        assert resultats[0].suspects[0].compte_en_face == "Compte B", cas


def test_deux_lignes_du_fichier_partageant_un_compte_se_rapprochent(db_session):
    """Le partage d'un compte suffit aussi entre deux lignes du même fichier,
    quel que soit le rôle de chaque côté."""
    a = creer_compte(db_session, "Compte A", solde_initial=1000.0)

    resultats = import_bancaire.detecter_doublons_virements(
        db_session,
        [
            _candidat_partiel(1, 250.0, date(2026, 3, 2), source=a),
            _candidat_partiel(2, 250.0, date(2026, 3, 3), destination=a),
        ],
    )

    assert [r.ligne for r in resultats] == [2]


def test_les_deux_comptes_connus_departagent_toujours_le_sens(db_session):
    """La contrepartie : dès que la ligne nomme ses deux comptes, le sens n'est
    plus une déduction et A→B cesse de ressembler à B→A. C'est le régime
    inchangé, celui d'une ligne complétée par une règle."""
    a = creer_compte(db_session, "Compte A", solde_initial=1000.0)
    b = creer_compte(db_session, "Compte B", solde_initial=1000.0)
    _virement(db_session, b, a, 250.0, date(2026, 3, 2))

    resultats = import_bancaire.detecter_doublons_virements(
        db_session, [_candidat(4, a, b, 250.0, date(2026, 3, 3))]
    )

    assert resultats == []


# ---------- De bout en bout : le relevé de l'autre banque ----------
#
# POURQUOI CES TESTS EXISTENT. Ceux d'au-dessus fabriquent leurs candidats à la
# main, et passaient tous pendant que le scénario réel — importer le relevé du
# compte B après avoir importé celui du compte A — n'était toujours pas
# détecté. Ce qui manquait n'était pas la règle de rapprochement mais ce qui
# arrive JUSQU'À elle : une ligne résolue par le vrai lecteur de fichier, puis
# le profil que le frontend en tire.
#
# `_profil_frontend` recopie donc `candidatsDoublonsVirements` (frontend/app.js)
# à l'identique. C'est une duplication assumée : le dépôt n'a pas de harnais de
# test JavaScript, et sans elle rien ne relie le lecteur de fichier à la veille.
# Les deux doivent dire la même chose ; si l'un change, l'autre doit suivre.


def _profil_frontend(ligne):
    """Le candidat tel que l'aperçu l'envoie, à partir d'une ligne résolue.

    Miroir de candidatsDoublonsVirements. Deux détails y sont essentiels, et
    chacun a fait échouer un correctif :

    - un signe ABSENT ne disqualifie pas la ligne, il la range côté récepteur
      par défaut (`montant_signe or 0`) ;
    - une ligne EN ERREUR n'est pas écartée : un virement sans compte en face
      en porte une par construction, et c'est justement le cas visé.
    """
    if ligne.date is None or ligne.compte_id is None:
        return None
    emetteur = (ligne.montant_signe or 0) < 0
    deux_jambes = ligne.montant_envoye is not None and ligne.montant is not None
    # Le montant ET sa devise viennent de la MÊME jambe (cf. _jambes).
    decrit_l_envoi = ligne.montant_envoye is not None
    montant = abs(ligne.montant_envoye if decrit_l_envoi else (ligne.montant or 0))
    if montant <= 0:
        return None
    return schemas.VirementCandidatDoublon(
        ligne=ligne.ligne,
        date=ligne.date,
        montant=montant,
        monnaie_id=ligne.monnaie_envoyee_id if decrit_l_envoi else ligne.monnaie_id,
        montant_recu=abs(ligne.montant) if deux_jambes else None,
        monnaie_recue_id=ligne.monnaie_id if deux_jambes else None,
        compte_source_id=ligne.compte_id if emetteur else ligne.compte_id_autre,
        compte_destination_id=ligne.compte_id_autre if emetteur else ligne.compte_id,
    )


def _releve(db, compte, montant, jour, nature="VIR SEPA"):
    """Le relevé d'UN compte : une ligne, un montant signé, et rien d'autre —
    c'est tout ce qu'une banque écrit. Le compte d'en face n'y figure pas."""
    from .test_import_bancaire import _construire_fichier, _make_preset

    preset = _make_preset(db, nom=f"Banque {compte.nom}")
    contenu = _construire_fichier(
        [{"date": jour, "nature": nature, "montant": montant, "compte": compte.nom}]
    )
    crud.set_mapping_compte(db, preset.id, compte.nom, compte.id)
    apercu = import_bancaire.previsualiser(db, preset.id, contenu)
    return apercu.lignes[0]


def _en_virement(db, ligne):
    """Reclasse la ligne en virement interne, comme le fait une règle ou un clic
    dans l'aperçu. Le compte d'en face reste inconnu : c'est le cas testé.

    `erreur` est RECALCULÉE : `model_copy` ne repasse pas par la validation, et
    laisser l'ancienne valeur ferait mentir la ligne sur son propre état — or
    c'est précisément cette erreur qui écartait la ligne de la veille."""
    reclassee = ligne.model_copy(
        update={"type_code": "virement", "categorie_id": None, "compte_id_autre": None}
    )
    return reclassee.model_copy(
        update={"erreur": import_bancaire._erreur_ligne(reclassee)}
    )


def test_le_releve_du_compte_recepteur_retrouve_le_virement_deja_importe(db_session):
    """LE SCÉNARIO RAPPORTÉ. Le virement A→B est déjà en base (importé depuis le
    relevé de A). On importe maintenant le relevé de B, qui décrit la même
    transaction en crédit et ne nomme que B."""
    a = creer_compte(db_session, "Compte A", solde_initial=1000.0)
    b = creer_compte(db_session, "Compte B", solde_initial=0.0)
    _virement(db_session, a, b, 250.0, date(2026, 3, 5), nature="Vers B")

    ligne = _en_virement(db_session, _releve(db_session, b, 250.0, date(2026, 3, 5)))
    # La ligne est bien EN ERREUR (compte en face manquant) : c'est ce qui la
    # faisait écarter avant, et elle doit être rapprochée quand même.
    assert ligne.erreur is not None

    resultats = import_bancaire.detecter_doublons_virements(
        db_session, [_profil_frontend(ligne)]
    )

    assert len(resultats) == 1
    assert resultats[0].suspects[0].compte_en_face == "Compte A"


def test_le_releve_du_compte_emetteur_retrouve_le_virement_deja_importe(db_session):
    """L'autre sens : le relevé de A, en débit, contre le même virement."""
    a = creer_compte(db_session, "Compte A", solde_initial=1000.0)
    b = creer_compte(db_session, "Compte B", solde_initial=0.0)
    _virement(db_session, a, b, 250.0, date(2026, 3, 5))

    ligne = _en_virement(db_session, _releve(db_session, a, -250.0, date(2026, 3, 5)))

    resultats = import_bancaire.detecter_doublons_virements(
        db_session, [_profil_frontend(ligne)]
    )

    assert len(resultats) == 1
    assert resultats[0].suspects[0].compte_en_face == "Compte B"


def test_une_ligne_sans_signe_est_rapprochee_elle_aussi(db_session):
    """Le montant a été corrigé à la main dans l'aperçu : la ligne porte un
    montant mais plus de signe (cf. _erreur_ligne, « le sens est indéterminé »).
    Elle reste rapprochable — c'est le rôle du compte qui devient incertain, pas
    le fait qu'il soit en jeu."""
    a = creer_compte(db_session, "Compte A", solde_initial=1000.0)
    b = creer_compte(db_session, "Compte B", solde_initial=0.0)
    _virement(db_session, a, b, 250.0, date(2026, 3, 5))

    ligne = _en_virement(db_session, _releve(db_session, a, -250.0, date(2026, 3, 5)))
    sans_signe = ligne.model_copy(update={"montant_signe": None, "montant": 250.0})

    resultats = import_bancaire.detecter_doublons_virements(
        db_session, [_profil_frontend(sans_signe)]
    )

    assert len(resultats) == 1
    assert resultats[0].suspects[0].compte_en_face == "Compte B"


def test_un_virement_vers_un_tiers_ne_se_rapproche_de_rien(db_session):
    """Le garde-fou : un relevé qui décrit un virement d'un montant différent, ou
    vers des comptes sans rapport, ne doit rien déclencher."""
    a = creer_compte(db_session, "Compte A", solde_initial=1000.0)
    b = creer_compte(db_session, "Compte B", solde_initial=0.0)
    c = creer_compte(db_session, "Compte C", solde_initial=1000.0)
    _virement(db_session, a, b, 250.0, date(2026, 3, 5))

    ligne = _en_virement(db_session, _releve(db_session, c, -250.0, date(2026, 3, 5)))

    assert import_bancaire.detecter_doublons_virements(
        db_session, [_profil_frontend(ligne)]
    ) == []


# ---------- Quand les deux jambes n'ont pas le même montant ----------
#
# LE DERNIER ANGLE MORT accroché aux rôles, et le plus silencieux : tant qu'un
# virement part et arrive du même montant, personne ne voit que l'aperçu range
# le montant d'une ligne RÉCEPTRICE dans le champ de ce qui PART. Des frais ou
# un change suffisent à le révéler — et à faire disparaître le rapprochement.


def _virement_avec_frais(db, source, destination, montant_envoye, montant_recu, jour):
    """Un virement dont les deux jambes diffèrent : 1 000 partent, 998,50
    arrivent. C'est ce qu'écrivent deux relevés de deux banques."""
    # `create_virement` rend le couple (sortante, entrante) : c'est la seconde
    # qu'on ampute des frais, comme le ferait la banque du destinataire.
    sortante, entrante = _virement(db, source, destination, montant_envoye, jour, nature="Vers B")
    entrante.montant = montant_recu
    db.commit()
    return sortante, entrante


def test_le_releve_du_recepteur_se_rapproche_malgre_les_frais(db_session):
    """LE CAS SILENCIEUX. Le relevé de B ne connaît que ce qui est ARRIVÉ
    (998,50). Le virement en base porte 1 000 au départ. Comparer le montant de
    la ligne au seul montant de départ ne trouvait rien."""
    a = creer_compte(db_session, "Compte A", solde_initial=5000.0)
    b = creer_compte(db_session, "Compte B", solde_initial=0.0)
    _virement_avec_frais(db_session, a, b, 1000.0, 998.50, date(2026, 3, 5))

    resultats = import_bancaire.detecter_doublons_virements(
        db_session, [_candidat_partiel(4, 998.50, date(2026, 3, 5), destination=b)]
    )

    assert len(resultats) == 1
    assert resultats[0].suspects[0].compte_en_face == "Compte A"


def test_le_releve_de_l_emetteur_se_rapproche_malgre_les_frais(db_session):
    """L'autre bord : A ne connaît que ce qui est PARTI (1 000)."""
    a = creer_compte(db_session, "Compte A", solde_initial=5000.0)
    b = creer_compte(db_session, "Compte B", solde_initial=0.0)
    _virement_avec_frais(db_session, a, b, 1000.0, 998.50, date(2026, 3, 5))

    resultats = import_bancaire.detecter_doublons_virements(
        db_session, [_candidat_partiel(4, 1000.0, date(2026, 3, 5), source=a)]
    )

    assert len(resultats) == 1
    assert resultats[0].suspects[0].compte_en_face == "Compte B"


def test_un_montant_qui_ne_correspond_a_aucune_jambe_n_est_pas_rapproche(db_session):
    """Le garde-fou : « une jambe ou l'autre » n'est pas « n'importe quel
    montant »."""
    a = creer_compte(db_session, "Compte A", solde_initial=5000.0)
    b = creer_compte(db_session, "Compte B", solde_initial=0.0)
    _virement_avec_frais(db_session, a, b, 1000.0, 998.50, date(2026, 3, 5))

    resultats = import_bancaire.detecter_doublons_virements(
        db_session, [_candidat_partiel(4, 750.0, date(2026, 3, 5), destination=b)]
    )

    assert resultats == []


def test_la_devise_reste_attachee_a_sa_jambe(db_session):
    """Montant et devise voyagent ensemble : un montant qui concorde avec une
    jambe mais dans une AUTRE monnaie ne rapproche rien. C'était le risque de
    comparer les deux séparément."""
    dollar = creer_monnaie(db_session, "Dollar", "$")
    a = creer_compte(db_session, "Compte A", solde_initial=5000.0)
    b = creer_compte(db_session, "Compte B", solde_initial=0.0)
    _virement_avec_frais(db_session, a, b, 1000.0, 998.50, date(2026, 3, 5))

    resultats = import_bancaire.detecter_doublons_virements(
        db_session,
        [
            _candidat_partiel(
                4, 998.50, date(2026, 3, 5), destination=b, monnaie_id=dollar.id
            )
        ],
    )

    assert resultats == []
