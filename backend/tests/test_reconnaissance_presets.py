"""La reconnaissance du preset d'un fichier (services/reconnaissance_presets).

Ce qu'on verrouille : le bon preset est reconnu sans rien dire ; un mauvais
preset sélectionné fait PROPOSER le bon, jamais basculer en silence ; un
intitulé renommé se signale sans empêcher la lecture ; un preset ancien, sans
signature, n'est jamais écarté pour autant ; et quand rien ne lit le fichier,
on le dit.
"""
import asyncio
import io
import random

import pytest
from starlette.datastructures import UploadFile

from app import crud
from app.routers import import_bancaire as routeur
from app.services.entetes import normaliser_entete
from app.services.import_bancaire import _lire_toutes_les_lignes
from app.services.reconnaissance_presets import (
    ajuster,
    comparer_motifs,
    memoriser_signature,
    motif_nom_fichier,
    reconnaitre,
)
from tests.banc_detection import synthetiques, variantes


@pytest.mark.parametrize(
    "nom, motif",
    [
        ("Releve_20261015_143205.CSV", "releve_<DATE>_<HEURE>.csv"),
        ("export-2026-10-15.xlsx", "export-<DATE>.xlsx"),
        ("15.10.2026 releve compte.csv", "<DATE> releve compte.csv"),
        ("operations_20261015143205.csv", "operations_<DATE><HEURE>.csv"),
        ("CA00012345678.csv", "ca99999999999.csv"),
        # 2026-13-45 n'est pas une date : les chiffres restent des chiffres.
        ("lot_20261345.csv", "lot_99999999.csv"),
        ("C:\\Users\\moi\\Downloads\\releve_20261015.csv", "releve_<DATE>.csv"),
        ("", None),
    ],
)
def test_motif_nom_fichier(nom, motif):
    assert motif_nom_fichier(nom) == motif


def test_comparer_motifs():
    assert comparer_motifs("releve_<DATE>.csv", "releve_<DATE>.csv") == 1.0
    # Même forme, autre texte : un indice, pas une preuve.
    assert comparer_motifs("releve_<DATE>.csv", "export_<DATE>.csv") == 0.6
    assert comparer_motifs("releve_<DATE>.csv", "operations.xlsx") == 0.0
    assert comparer_motifs(None, "releve.csv") is None


@pytest.mark.parametrize(
    "brut, normalise",
    [
        ("Montant (EUR)", "montant eur"),
        ("MONTANT  €", "montant eur"),
        ("Libellé de l'opération", "libelle de l operation"),
        ("Débit/Crédit", "debit credit"),
        (None, ""),
    ],
)
def test_normaliser_entete(brut, normalise):
    assert normaliser_entete(brut) == normalise


# ---------- Les quatre relevés du banc, chacun avec son preset ----------


def _lignes(releve):
    return _lire_toutes_les_lignes(releve.en_octets())


def _creer_preset(db, releve, avec_signature=True, nom=None):
    attendu = releve.attendu()
    colonnes = [
        {"index": i, "propriete": p} for i, p in enumerate(attendu["proprietes"], start=1) if p
    ]
    preset = crud.create_import_preset(
        db, nom or releve.nom, colonnes, [], lignes_entete=attendu["lignes_entete"]
    )
    if avec_signature:
        memoriser_signature(preset, _lignes(releve), f"{releve.nom}_20261015.csv", ecraser=True)
        db.commit()
    return preset


@pytest.fixture()
def presets(db_session):
    # La base de test porte déjà un preset par défaut : il fait partie du décor.
    bases = synthetiques.bases()
    return bases, {b.nom: _creer_preset(db_session, b) for b in bases}


def _reconnaitre(db, lignes, selectionne, nom_fichier="releve.csv"):
    ajustements = [
        ajuster(p, lignes, nom_fichier) for p in crud.list_import_presets(db, "bancaire")
    ]
    return reconnaitre(ajustements, selectionne)


def test_le_bon_preset_est_reconnu_sans_rien_dire(db_session, presets):
    bases, par_nom = presets
    for base in bases:
        resultat = _reconnaitre(db_session, _lignes(base), par_nom[base.nom].id)
        assert resultat.decision == "appliquer", base.nom


def test_un_mauvais_preset_fait_proposer_le_bon(db_session, presets):
    bases, par_nom = presets
    for i, base in enumerate(bases):
        mauvais = par_nom[bases[(i + 1) % len(bases)].nom]
        resultat = _reconnaitre(db_session, _lignes(base), mauvais.id)
        assert resultat.decision == "basculer", base.nom
        assert resultat.propose.preset_id == par_nom[base.nom].id
        assert resultat.propose.entetes_identiques


def test_un_intitule_renomme_se_signale_sans_empecher_la_lecture(db_session, presets):
    bases, par_nom = presets
    banque_b = bases[1]
    renomme = variantes.renommer(banque_b, random.Random("renomme"))
    resultat = _reconnaitre(db_session, _lignes(renomme), par_nom["banque_b"].id)
    assert resultat.decision == "ecarts"
    assert resultat.ecarts
    assert all(e.keys() == {"index", "avant", "maintenant"} for e in resultat.ecarts)


def test_une_colonne_en_plus_se_signale(db_session, presets):
    bases, par_nom = presets
    avec_solde = variantes.avec_solde(bases[0], random.Random(0))
    resultat = _reconnaitre(db_session, _lignes(avec_solde), par_nom["banque_a"].id)
    assert resultat.decision == "ecarts"
    assert resultat.ecarts == [{"index": 4, "avant": "", "maintenant": "Solde"}]


def test_un_preset_sans_signature_n_est_jamais_ecarte(db_session):
    banque_b = synthetiques.banque_b()
    ancien = _creer_preset(db_session, banque_b, avec_signature=False, nom="ancien")
    resultat = _reconnaitre(db_session, _lignes(banque_b), ancien.id)
    assert resultat.decision == "appliquer"


def test_rien_ne_lit_le_fichier(db_session, presets):
    _, par_nom = presets
    lignes = [("Nom", "Prénom"), ("Dupont", "Jean"), ("Martin", "Léa")]
    assert _reconnaitre(db_session, lignes, par_nom["banque_a"].id).decision == "aucun"


def test_le_nom_du_fichier_departage_seulement(db_session, presets):
    """Deux presets identiques en tout point : le nom du fichier choisit."""
    bases, par_nom = presets
    banque_a = bases[0]
    jumeau = _creer_preset(db_session, banque_a, avec_signature=False, nom="jumeau")
    memoriser_signature(jumeau, _lignes(banque_a), "autre_banque.csv", ecraser=True)
    db_session.commit()
    resultat = _reconnaitre(db_session, _lignes(banque_a), par_nom["banque_b"].id, "banque_a_20261101.csv")
    assert resultat.propose.preset_id == par_nom["banque_a"].id


def test_la_premiere_reutilisation_complete_sans_ecraser(db_session):
    banque_a = synthetiques.banque_a()
    preset = _creer_preset(db_session, banque_a, avec_signature=False)
    assert memoriser_signature(preset, _lignes(banque_a), "releve_20261015.csv", ecraser=False)
    assert preset.signature_entetes == ["Date", "Libellé", "Montant (EUR)"]
    assert preset.nombre_colonnes == 3
    assert preset.motif_nom_fichier == "releve_<DATE>.csv"
    autre = variantes.avec_solde(banque_a, random.Random(0))
    assert not memoriser_signature(preset, _lignes(autre), "export.csv", ecraser=False)
    assert preset.nombre_colonnes == 3


def _televerser(contenu: bytes, nom: str) -> UploadFile:
    return UploadFile(io.BytesIO(contenu), filename=nom)


def test_la_route_compare_tous_les_presets(db_session, presets):
    bases, par_nom = presets
    banque_c = bases[2]
    resultat = asyncio.run(
        routeur.reconnaitre_preset(
            fichier=_televerser(banque_c.en_octets(), "banque_c.csv"),
            preset_id=par_nom["banque_a"].id,
            delimiteur=None,
            separateur_decimal=None,
            format_date=None,
            db=db_session,
        )
    )
    assert resultat["decision"] == "basculer"
    assert resultat["propose"]["preset_id"] == par_nom["banque_c"].id
    assert len(resultat["ajustements"]) == len(crud.list_import_presets(db_session, "bancaire"))


def test_le_motif_d_un_preset_ancien_se_lit_dans_son_historique(db_session):
    banque_a = synthetiques.banque_a()
    ancien = _creer_preset(db_session, banque_a, avec_signature=False, nom="ancien")
    crud.create_import_historique(
        db_session, preset_id=ancien.id, nom_fichier="releve_20260901.csv",
        operations_creees=3, lignes_ignorees=0,
    )
    resultat = asyncio.run(
        routeur.reconnaitre_preset(
            fichier=_televerser(banque_a.en_octets(), "releve_20261015.csv"),
            preset_id=ancien.id,
            delimiteur=None,
            separateur_decimal=None,
            format_date=None,
            db=db_session,
        )
    )
    ajustement = next(a for a in resultat["ajustements"] if a["preset_id"] == ancien.id)
    assert ajustement["nom_fichier"] == 1.0


def test_la_route_signature_remplace_la_precedente(db_session, presets):
    bases, par_nom = presets
    preset = par_nom["banque_a"]
    autre = variantes.avec_solde(bases[0], random.Random(0))
    asyncio.run(
        routeur.memoriser_signature(
            preset.id,
            fichier=_televerser(autre.en_octets(), "export_20261101.csv"),
            delimiteur=None,
            db=db_session,
        )
    )
    db_session.refresh(preset)
    assert preset.signature_entetes[-1] == "Solde"
    assert preset.nombre_colonnes == 4
    assert preset.motif_nom_fichier == "export_<DATE>.csv"
