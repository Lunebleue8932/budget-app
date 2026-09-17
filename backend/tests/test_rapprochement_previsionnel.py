"""Rapprocher une dépense PRÉVISIONNELLE de la vraie, à l'import (migration 0058).

CE QUE CES TESTS VERROUILLENT :

  - RIEN N'EST RAPPROCHÉ D'OFFICE, et rien n'est perdu. L'aperçu propose, la
    confirmation applique, le refus retombe EXACTEMENT sur l'ancien
    comportement — une opération de plus, la prévisionnelle intacte. C'est la
    promesse sans laquelle ce mécanisme serait pire que le doublon qu'il
    supprime ;
  - ÉCRASER, ET NON SUPPRIMER PUIS CRÉER : l'opération garde son identifiant, et
    avec lui tout ce que d'autres tables y ont accroché — au premier rang
    desquelles son lien de récurrence ;
  - UNE OCCURRENCE RAPPROCHÉE NE REVIENT PAS. C'est le piège propre à la
    récurrence : le générateur reconnaît ses occurrences à leur date, et une
    occurrence prévue au 5 mais passée au 6 aurait été recréée au 5 — la dépense
    revenant en double par l'autre bout, ce que tout ceci existe pour empêcher ;
  - ANNULER L'IMPORT REND LA PRÉVISIONNELLE au lieu de la supprimer. Effacer une
    prévision écrite à la main pour défaire un import qu'on regrette serait la
    pire perte possible, et la plus silencieuse ;
  - LES CRITÈRES SONT STRICTS (compte, monnaie, type, montant au centime,
    fenêtre, mots-clés en ET) : le mécanisme ne vaut que si ce qu'il propose est
    presque toujours juste.
"""
import io
from datetime import date

import openpyxl
import pytest
from pydantic import ValidationError

from app import crud, models, schemas
from app.constants import COLONNES_IMPORT_PAR_DEFAUT, Frequence, Statut, TypeOperation
from app.services import import_bancaire, rapprochement_previsionnel

from .conftest import creer_compte, get_categorie_id, get_monnaie_id, get_type_id


def _fichier(lignes: list[dict]) -> bytes:
    """Le même classeur à douze colonnes que test_import_bancaire."""
    classeur = openpyxl.Workbook()
    feuille = classeur.active
    feuille.append([f"Colonne {i}" for i in range(1, 13)])
    for ligne in lignes:
        row = [None] * 12
        row[0] = ligne.get("date")
        row[3] = ligne.get("nature")
        row[5] = ligne.get("categorie")
        row[6] = ligne.get("montant")
        row[9] = ligne.get("compte")
        feuille.append(row)
    tampon = io.BytesIO()
    classeur.save(tampon)
    return tampon.getvalue()


def _preset(db):
    return crud.create_import_preset(
        db, "Défaut", COLONNES_IMPORT_PAR_DEFAUT, [], lignes_entete=1
    )


def _previsionnelle(
    db,
    compte,
    *,
    montant=42.0,
    date_op=date(2026, 7, 5),
    nature="Abonnement musique",
    debut=None,
    fin=None,
    mots_cles=None,
    type_code="classique",
):
    return crud.create_operation(
        db,
        schemas.OperationCreate(
            date=date_op,
            compte_id=compte.id,
            monnaie_id=get_monnaie_id(db),
            type_id=get_type_id(db, type_code),
            categorie_id=get_categorie_id(db, "Charges fixes"),
            nature=nature,
            montant=montant,
            statut=Statut.previsionnel,
            rapprochement_debut=debut,
            rapprochement_fin=fin,
            rapprochement_mots_cles=mots_cles or [],
        ),
    )


def _importer(db, preset, compte, contenu, overrides=None):
    return import_bancaire.confirmer(
        db,
        preset.id,
        contenu,
        overrides or schemas.ImportMappingOverrides(),
        compte_id_defaut=compte.id,
    )


# ---------- La fenêtre elle-même ----------


def test_sans_fenetre_c_est_le_jour_meme(db_session):
    """NULL DES DEUX CÔTÉS VEUT DIRE « À SA DATE ». C'est ce qui rend
    rapprochable, sans aucune reprise de données, tout ce qui existait avant la
    migration — occurrences de récurrence comprises."""
    compte = creer_compte(db_session, "CC")
    prev = _previsionnelle(db_session, compte, date_op=date(2026, 7, 5))
    assert rapprochement_previsionnel.fenetre(prev) == (date(2026, 7, 5), date(2026, 7, 5))


def test_les_deux_bornes_vont_ensemble_et_tiennent_dans_un_mois(db_session):
    """UNE SEULE BORNE N'EST PAS UNE FENÊTRE, et la refermer d'office sur une
    date qu'on n'a pas demandée serait pire que de refuser. À CHEVAL SUR DEUX
    MOIS non plus : une prévisionnelle sert précisément à dire à quel mois la
    dépense appartient."""
    compte = creer_compte(db_session, "CC")
    base = dict(
        date=date(2026, 7, 5),
        compte_id=compte.id,
        monnaie_id=get_monnaie_id(db_session),
        type_id=get_type_id(db_session, "classique"),
        categorie_id=get_categorie_id(db_session, "Charges fixes"),
        nature="Loyer",
        montant=800.0,
        statut=Statut.previsionnel,
    )
    with pytest.raises(ValidationError):
        schemas.OperationCreate(**base, rapprochement_debut=date(2026, 7, 1))
    with pytest.raises(ValidationError):
        schemas.OperationCreate(
            **base, rapprochement_debut=date(2026, 7, 20), rapprochement_fin=date(2026, 8, 3)
        )
    with pytest.raises(ValidationError):
        schemas.OperationCreate(
            **base, rapprochement_debut=date(2026, 7, 20), rapprochement_fin=date(2026, 7, 3)
        )
    # Deux bornes du même mois, dans l'ordre : accepté.
    schemas.OperationCreate(
        **base, rapprochement_debut=date(2026, 7, 1), rapprochement_fin=date(2026, 7, 31)
    )


def test_les_mots_cles_font_l_aller_retour_par_la_base(db_session):
    """La colonne porte du JSON, l'application une liste, et `OperationRead`
    valide directement l'objet ORM : sans la traduction des deux côtés, LIRE une
    opération lèverait une erreur de type."""
    compte = creer_compte(db_session, "CC")
    prev = _previsionnelle(db_session, compte, mots_cles=["SPOTIFY", "  "])
    assert prev.rapprochement_mots_cles == '["SPOTIFY"]'
    assert rapprochement_previsionnel.mots_cles(prev) == ["SPOTIFY"]
    assert schemas.OperationRead.model_validate(prev).rapprochement_mots_cles == ["SPOTIFY"]


# ---------- La reconnaissance ----------


def test_l_apercu_reconnait_la_previsionnelle_et_la_montre(db_session):
    compte = creer_compte(db_session, "CC")
    preset = _preset(db_session)
    prev = _previsionnelle(
        db_session,
        compte,
        montant=42.0,
        date_op=date(2026, 7, 5),
        debut=date(2026, 7, 1),
        fin=date(2026, 7, 10),
    )
    contenu = _fichier(
        [{"date": date(2026, 7, 8), "nature": "SPOTIFY AB", "montant": -42.0}]
    )

    apercu = import_bancaire.previsualiser(
        db_session, preset.id, contenu, compte_id_defaut=compte.id
    )

    assert apercu.lignes[0].previsionnelle_id == prev.id
    # MONTRÉE, et pas seulement désignée : accepter d'écraser une opération sans
    # la voir, c'est signer en aveugle.
    vue = apercu.previsionnelles[str(prev.id)]
    assert vue.nature == "Abonnement musique"
    assert vue.montant == 42.0
    assert vue.compte_nom == "CC"
    assert (vue.rapprochement_debut, vue.rapprochement_fin) == (
        date(2026, 7, 1),
        date(2026, 7, 10),
    )


@pytest.mark.parametrize(
    "ecart",
    [
        pytest.param({"montant": -42.5}, id="montant different"),
        pytest.param({"date": date(2026, 7, 20)}, id="date hors fenetre"),
    ],
)
def test_ce_qui_ne_correspond_pas_n_est_pas_propose(db_session, ecart):
    """LE MÉCANISME NE VAUT QUE SI CE QU'IL PROPOSE EST PRESQUE TOUJOURS JUSTE.
    Une tolérance sur le montant rendrait proposable à peu près n'importe quoi
    sur un relevé de trois cents lignes."""
    compte = creer_compte(db_session, "CC")
    preset = _preset(db_session)
    _previsionnelle(
        db_session, compte, montant=42.0, debut=date(2026, 7, 1), fin=date(2026, 7, 10)
    )
    ligne = {"date": date(2026, 7, 8), "nature": "SPOTIFY", "montant": -42.0}
    ligne.update(ecart)

    apercu = import_bancaire.previsualiser(
        db_session, preset.id, _fichier([ligne]), compte_id_defaut=compte.id
    )
    assert apercu.lignes[0].previsionnelle_id is None


def test_un_autre_compte_n_est_jamais_la_meme_depense(db_session):
    compte = creer_compte(db_session, "CC")
    autre = creer_compte(db_session, "Livret")
    preset = _preset(db_session)
    _previsionnelle(db_session, autre, montant=42.0, date_op=date(2026, 7, 8))

    apercu = import_bancaire.previsualiser(
        db_session,
        preset.id,
        _fichier([{"date": date(2026, 7, 8), "nature": "X", "montant": -42.0}]),
        compte_id_defaut=compte.id,
    )
    assert apercu.lignes[0].previsionnelle_id is None


def test_les_mots_cles_sont_combines_en_et_sans_casse_ni_accents(db_session):
    compte = creer_compte(db_session, "CC")
    preset = _preset(db_session)
    prev = _previsionnelle(
        db_session,
        compte,
        montant=42.0,
        date_op=date(2026, 7, 8),
        mots_cles=["éléctricité", "EDF"],
    )

    def reconnue(nature):
        apercu = import_bancaire.previsualiser(
            db_session,
            preset.id,
            _fichier([{"date": date(2026, 7, 8), "nature": nature, "montant": -42.0}]),
            compte_id_defaut=compte.id,
        )
        return apercu.lignes[0].previsionnelle_id

    assert reconnue("PRLV EDF ELECTRICITE FACT") == prev.id
    # Un seul des deux mots ne suffit pas : ils sont en ET.
    assert reconnue("PRLV EDF GAZ") is None


def test_une_previsionnelle_ne_sert_qu_une_fois(db_session):
    """Sans cette mémoire, trois prélèvements identiques du même mois auraient
    tous les trois proposé d'écraser la même prévisionnelle — et deux d'entre
    eux se seraient annulés l'un l'autre au moment d'écrire."""
    compte = creer_compte(db_session, "CC")
    preset = _preset(db_session)
    prev = _previsionnelle(
        db_session, compte, montant=42.0, debut=date(2026, 7, 1), fin=date(2026, 7, 31)
    )
    contenu = _fichier(
        [
            {"date": date(2026, 7, 8), "nature": "A", "montant": -42.0},
            {"date": date(2026, 7, 9), "nature": "B", "montant": -42.0},
        ]
    )

    apercu = import_bancaire.previsualiser(
        db_session, preset.id, contenu, compte_id_defaut=compte.id
    )
    assert [l.previsionnelle_id for l in apercu.lignes] == [prev.id, None]


def test_la_plus_proche_dans_le_temps_l_emporte(db_session):
    """Deux loyers identiques attendus à deux dates doivent partir chacun sur le
    sien, et la date est la seule chose qui les distingue."""
    compte = creer_compte(db_session, "CC")
    preset = _preset(db_session)
    tot = _previsionnelle(
        db_session,
        compte,
        montant=800.0,
        date_op=date(2026, 7, 3),
        debut=date(2026, 7, 1),
        fin=date(2026, 7, 31),
    )
    tard = _previsionnelle(
        db_session,
        compte,
        montant=800.0,
        date_op=date(2026, 7, 25),
        debut=date(2026, 7, 1),
        fin=date(2026, 7, 31),
    )

    apercu = import_bancaire.previsualiser(
        db_session,
        preset.id,
        _fichier([{"date": date(2026, 7, 24), "nature": "LOYER", "montant": -800.0}]),
        compte_id_defaut=compte.id,
    )
    assert apercu.lignes[0].previsionnelle_id == tard.id
    assert tot.id != tard.id


# ---------- L'écrasement ----------


def test_la_vraie_prend_la_place_de_la_prevision(db_session):
    """ÉCRASER, ET NON SUPPRIMER PUIS CRÉER : l'identifiant survit, et avec lui
    tout ce que d'autres tables y ont accroché."""
    compte = creer_compte(db_session, "CC")
    preset = _preset(db_session)
    prev = _previsionnelle(
        db_session,
        compte,
        montant=42.0,
        date_op=date(2026, 7, 5),
        debut=date(2026, 7, 1),
        fin=date(2026, 7, 10),
    )
    avant = db_session.query(models.Operation).count()

    resultat = _importer(
        db_session,
        preset,
        compte,
        _fichier([{"date": date(2026, 7, 8), "nature": "SPOTIFY AB", "montant": -42.0}]),
    )

    assert resultat.operations_creees == 1
    # AUCUNE OPÉRATION DE PLUS : c'est tout l'objet du mécanisme.
    assert db_session.query(models.Operation).count() == avant
    db_session.refresh(prev)
    assert prev.statut == Statut.reel
    assert prev.date == date(2026, 7, 8)
    assert prev.nature == "SPOTIFY AB"
    # LA FENÊTRE DISPARAÎT : la dépense est arrivée, il n'y a plus rien à
    # reconnaître — et une opération réelle qui garderait sa fenêtre se
    # proposerait elle-même au prochain import.
    assert prev.rapprochement_debut is None and prev.rapprochement_fin is None


def test_une_note_ecrite_sur_la_prevision_survit(db_session):
    """Aucun relevé ne porte de note : l'effacer au nom d'un champ que le
    fichier ne remplit jamais serait une perte sèche."""
    compte = creer_compte(db_session, "CC")
    preset = _preset(db_session)
    prev = _previsionnelle(db_session, compte, montant=42.0, date_op=date(2026, 7, 8))
    crud.update_operation(
        db_session, prev, schemas.OperationUpdate(notes="Résilier avant octobre")
    )

    _importer(
        db_session,
        preset,
        compte,
        _fichier([{"date": date(2026, 7, 8), "nature": "SPOTIFY", "montant": -42.0}]),
    )

    db_session.refresh(prev)
    assert prev.notes == "Résilier avant octobre"


def test_refuser_le_rapprochement_retombe_sur_l_ancien_comportement(db_session):
    compte = creer_compte(db_session, "CC")
    preset = _preset(db_session)
    prev = _previsionnelle(db_session, compte, montant=42.0, date_op=date(2026, 7, 8))
    avant = db_session.query(models.Operation).count()

    _importer(
        db_session,
        preset,
        compte,
        _fichier([{"date": date(2026, 7, 8), "nature": "SPOTIFY", "montant": -42.0}]),
        schemas.ImportMappingOverrides(rapprochements_refuses=[2]),
    )

    assert db_session.query(models.Operation).count() == avant + 1
    db_session.refresh(prev)
    assert prev.statut == Statut.previsionnel
    assert prev.nature == "Abonnement musique"


def test_une_ligne_en_attente_ne_rapproche_rien(db_session):
    """Elle créerait elle-même une prévisionnelle : rapprocher une prévision
    d'une autre prévision n'apprend rien à personne."""
    compte = creer_compte(db_session, "CC")
    prev = _previsionnelle(db_session, compte, montant=42.0, date_op=date(2026, 7, 8))
    ligne = schemas.ImportLigne(
        ligne=2,
        date=date(2026, 7, 8),
        nature="SPOTIFY",
        montant=42.0,
        compte_id=compte.id,
        statut_import="attente",
    )
    trouvee = import_bancaire.chercher_previsionnelle(
        db_session, [prev], ligne, crud.id_type_par_code(db_session), set()
    )
    assert trouvee is None


# ---------- La récurrence ----------


def _modele_recurrent(db, compte, **kwargs):
    return crud.create_operation(
        db,
        schemas.OperationCreate(
            date=kwargs.get("date_op", date(2026, 7, 5)),
            compte_id=compte.id,
            monnaie_id=get_monnaie_id(db),
            type_id=get_type_id(db, "classique"),
            categorie_id=get_categorie_id(db, "Charges fixes"),
            nature="Loyer",
            montant=800.0,
            statut=Statut.reel,
            recurrente=True,
            frequence=Frequence.mensuelle,
            recurrence_fin=kwargs.get("fin_recurrence", date(2026, 12, 31)),
            rapprochement_debut=kwargs.get("debut"),
            rapprochement_fin=kwargs.get("fin"),
            rapprochement_mots_cles=kwargs.get("mots_cles", []),
        ),
    )


def test_les_occurrences_heritent_de_la_fenetre_du_modele(db_session):
    """Une opération récurrente EST une réelle suivie de prévisionnelles : c'est
    le cas d'usage le plus évident du rapprochement, et le seul où l'on ne veut
    surtout pas saisir la fenêtre douze fois. L'écart de jours est REPORTÉ, et
    non les dates recopiées — recopier juillet sur septembre aurait donné une
    fenêtre située deux mois avant l'opération qu'elle décrit, donc vide."""
    compte = creer_compte(db_session, "CC")
    _modele_recurrent(
        db_session, compte, date_op=date(2026, 7, 5), debut=date(2026, 7, 3), fin=date(2026, 7, 8)
    )
    crud.generer_occurrences_recurrentes(db_session)

    aout = (
        db_session.query(models.Operation)
        .filter(models.Operation.date == date(2026, 8, 5))
        .one()
    )
    assert (aout.rapprochement_debut, aout.rapprochement_fin) == (
        date(2026, 8, 3),
        date(2026, 8, 8),
    )
    assert aout.recurrence_date_prevue == date(2026, 8, 5)


def test_la_fenetre_heritee_est_rabattue_dans_son_mois(db_session):
    """L'invariant « les deux bornes dans le même mois » vaut pour une occurrence
    comme pour toute autre opération, et un report de jours peut le franchir.
    Rabattre plutôt que refuser : une fenêtre rétrécie reconnaît encore la vraie
    ligne, une fenêtre absente ne reconnaît plus rien."""
    compte = creer_compte(db_session, "CC")
    _modele_recurrent(
        db_session,
        compte,
        date_op=date(2026, 7, 30),
        debut=date(2026, 7, 28),
        fin=date(2026, 7, 31),
    )
    crud.generer_occurrences_recurrentes(db_session)

    # Le 30 septembre + 1 jour sortirait du mois : rabattu au 30.
    septembre = (
        db_session.query(models.Operation)
        .filter(models.Operation.date == date(2026, 9, 30))
        .one()
    )
    assert septembre.rapprochement_debut == date(2026, 9, 28)
    assert septembre.rapprochement_fin == date(2026, 9, 30)


def test_une_occurrence_rapprochee_ne_revient_pas(db_session):
    """LE PIÈGE PROPRE À LA RÉCURRENCE. Le générateur reconnaît ses occurrences à
    leur date : une occurrence prévue au 5 mais passée au 6 aurait été recréée au
    5, et la dépense serait revenue en double par l'autre bout — exactement ce
    que tout ceci existe pour empêcher."""
    compte = creer_compte(db_session, "CC")
    preset = _preset(db_session)
    modele = _modele_recurrent(
        db_session, compte, date_op=date(2026, 7, 5), debut=date(2026, 7, 1), fin=date(2026, 7, 10)
    )
    crud.generer_occurrences_recurrentes(db_session)
    occurrence = (
        db_session.query(models.Operation)
        .filter(models.Operation.date == date(2026, 8, 5))
        .one()
    )
    total_avant = db_session.query(models.Operation).count()

    _importer(
        db_session,
        preset,
        compte,
        _fichier([{"date": date(2026, 8, 6), "nature": "LOYER AOUT", "montant": -800.0}]),
    )
    crud.generer_occurrences_recurrentes(db_session)

    db_session.refresh(occurrence)
    assert occurrence.statut == Statut.reel
    assert occurrence.date == date(2026, 8, 6)
    # ELLE RESTE UNE OCCURRENCE DE SA RÉCURRENCE : l'identifiant a survécu, donc
    # le lien aussi.
    assert occurrence.recurrence_parent_id == modele.id
    # Et rien n'a été recréé au 5 août.
    assert db_session.query(models.Operation).count() == total_avant
    assert (
        db_session.query(models.Operation)
        .filter(models.Operation.date == date(2026, 8, 5))
        .count()
        == 0
    )


# ---------- L'annulation ----------


def test_annuler_l_import_rend_la_previsionnelle(db_session):
    """Effacer une prévision écrite à la main pour défaire un import qu'on
    regrette serait la pire perte possible, et la plus silencieuse."""
    compte = creer_compte(db_session, "CC")
    preset = _preset(db_session)
    prev = _previsionnelle(
        db_session,
        compte,
        montant=42.0,
        date_op=date(2026, 7, 5),
        nature="Abonnement musique",
        debut=date(2026, 7, 1),
        fin=date(2026, 7, 10),
    )
    resultat = _importer(
        db_session,
        preset,
        compte,
        _fichier([{"date": date(2026, 7, 8), "nature": "SPOTIFY AB", "montant": -42.0}]),
    )

    annulation = import_bancaire.annuler_import(db_session, resultat.historique_id)

    assert annulation.previsionnelles_restaurees == 1
    assert annulation.operations_supprimees == 0
    db_session.refresh(prev)
    assert prev.statut == Statut.previsionnel
    assert prev.date == date(2026, 7, 5)
    assert prev.nature == "Abonnement musique"
    assert (prev.rapprochement_debut, prev.rapprochement_fin) == (
        date(2026, 7, 1),
        date(2026, 7, 10),
    )


def test_annuler_rend_le_releve_reimportable(db_session):
    """La ligne du stock anti-doublons part quand même : sans cela, le relevé
    resterait « déjà importé » alors que la prévisionnelle a été rendue, et
    réimporter ne rapprocherait plus rien."""
    compte = creer_compte(db_session, "CC")
    preset = _preset(db_session)
    prev = _previsionnelle(db_session, compte, montant=42.0, date_op=date(2026, 7, 8))
    contenu = _fichier([{"date": date(2026, 7, 8), "nature": "SPOTIFY", "montant": -42.0}])
    resultat = _importer(db_session, preset, compte, contenu)
    import_bancaire.annuler_import(db_session, resultat.historique_id)

    apercu = import_bancaire.previsualiser(
        db_session, preset.id, contenu, compte_id_defaut=compte.id
    )
    assert apercu.lignes[0].doublon_de is None
    assert apercu.lignes[0].previsionnelle_id == prev.id


def test_les_operations_vraiment_creees_partent_toujours(db_session):
    """L'annulation ne change de comportement QUE pour ce que l'import a
    écrasé : tout ce qu'il a créé se supprime comme avant."""
    compte = creer_compte(db_session, "CC")
    preset = _preset(db_session)
    resultat = _importer(
        db_session,
        preset,
        compte,
        _fichier([{"date": date(2026, 7, 8), "nature": "COURSES", "montant": -30.0}]),
    )

    annulation = import_bancaire.annuler_import(db_session, resultat.historique_id)

    assert annulation.operations_supprimees == 1
    assert annulation.previsionnelles_restaurees == 0
    assert db_session.query(models.Operation).count() == 0
