"""Le contrôle avant import (services/controle_import) : ce que l'import
ferait, chiffré, sans rien écrire.

Ce qu'on verrouille : les totaux sont exacts au centime ; une configuration
fausse (débit et crédit échangés) est trahie par le solde du relevé, qu'on
retrouve sans elle ; les rejets sont comptés par motif ; les anomalies
(dates hors plage, montant aberrant, ligne vide) sont signalées ; et rien
n'est écrit en base.
"""
import asyncio
import io
import random
from datetime import date

from starlette.datastructures import UploadFile

from app import crud, models
from app.routers import import_bancaire as routeur
from app.services import import_bancaire
from app.services.controle_import import controler_import
from app.services.lecture_montants import centimes
from tests.banc_detection import synthetiques


def _preset(db, releve, inverser_debit_credit=False, nom=None):
    proprietes = releve.attendu()["proprietes"]
    if inverser_debit_credit:
        echange = {"montant_debit": "montant_credit", "montant_credit": "montant_debit"}
        proprietes = [echange.get(p, p) for p in proprietes]
    colonnes = [{"index": i, "propriete": p} for i, p in enumerate(proprietes, start=1) if p]
    return crud.create_import_preset(
        db, nom or releve.nom, colonnes, [], lignes_entete=releve.lignes_entete
    )


def _banque_b(n=40):
    releve = synthetiques.banque_b()
    releve.lignes = releve.lignes[:n]
    return releve


def test_les_totaux_sont_exacts_au_centime(db_session):
    releve = _banque_b()
    preset = _preset(db_session, releve)
    controle = import_bancaire.previsualiser(db_session, preset.id, releve.en_octets()).controle
    nets = releve.nets()
    assert controle["lignes_lues"] == len(releve.lignes)
    assert controle["lignes_rejetees"] == 0
    assert controle["total_debits"] == -sum(n for n in nets if n < 0)
    assert controle["total_credits"] == sum(n for n in nets if n > 0)
    assert controle["solde_net"] == sum(nets)
    assert controle["date_debut"] == date(2026, 1, 2)


def test_le_solde_du_releve_confirme_une_bonne_configuration(db_session):
    releve = _banque_b()
    preset = _preset(db_session, releve)
    solde = import_bancaire.previsualiser(db_session, preset.id, releve.en_octets()).controle["controle_solde"]
    assert (solde["colonne"], solde["statut"], solde["nombre_ecarts"]) == (6, "ok", 0)


def test_le_solde_du_releve_trahit_un_debit_et_un_credit_echanges(db_session):
    releve = _banque_b()
    preset = _preset(db_session, releve, inverser_debit_credit=True)
    solde = import_bancaire.previsualiser(db_session, preset.id, releve.en_octets()).controle["controle_solde"]
    assert solde["colonne"] == 6
    assert solde["statut"] == "ecart"
    ecart = solde["ecarts"][0]
    assert ecart["variation_du_solde"] == -ecart["montants_lus"]


def test_les_rejets_sont_comptes_par_motif(db_session):
    releve = _banque_b(20)
    releve.lignes[3][0] = "pas une date"
    releve.lignes[7][3] = "douze euros"
    preset = _preset(db_session, releve)
    controle = import_bancaire.previsualiser(db_session, preset.id, releve.en_octets()).controle
    assert controle["lignes_rejetees"] == 2
    motifs = {m["motif"]: m["lignes"] for m in controle["motifs_rejet"]}
    assert motifs["date illisible"] == [5]  # ligne 1 : les intitulés
    assert motifs["montant illisible"] == [9]
    # Le solde le voit aussi : la ligne sans montant casse ses intervalles.
    assert controle["controle_solde"]["nombre_ecarts"] >= 1


class _Ligne:
    def __init__(self, ligne, jour, montant, erreur=None):
        self.ligne, self.date, self.montant_signe = ligne, jour, montant
        self.erreur, self.doublon_de = erreur, None


def test_les_anomalies_sont_signalees():
    rng = random.Random(2)
    lignes = [_Ligne(i + 2, date(2026, 1, 2 + i % 25), -rng.randint(500, 9000) / 100) for i in range(30)]
    lignes[4] = _Ligne(6, date(2062, 1, 6), -12.0)  # l'année tapée de travers
    lignes[9] = _Ligne(11, date(2026, 1, 11), -250000.0)  # 250 000 € au lieu de 2 500
    brutes = [("Date", "Libellé", "Montant")] + [("x", "y", "z")] * 40
    brutes[14] = ("", "", "")  # une ligne vide au milieu des opérations
    anomalies = controler_import(lignes, brutes, [], 1, aujourdhui=date(2026, 10, 17))["anomalies"]
    assert anomalies["dates_hors_plage"] == [6]
    assert anomalies["montants_aberrants"] == [11]
    assert anomalies["lignes_vides"] == 1


def test_la_route_n_ecrit_rien(db_session):
    releve = _banque_b()
    preset = _preset(db_session, releve)
    avant = (
        db_session.query(models.Operation).count(),
        db_session.query(models.ImportHistorique).count(),
        db_session.query(models.LigneImportBrute).count(),
    )
    controle = asyncio.run(
        routeur.controle_avant_import(
            preset.id,
            fichier=UploadFile(io.BytesIO(releve.en_octets()), filename="releve.csv"),
            compte_id_defaut=None,
            delimiteur=None,
            separateur_decimal=None,
            colonnes=None,
            feuille=None,
            format_date=None,
            db=db_session,
        )
    )
    apres = (
        db_session.query(models.Operation).count(),
        db_session.query(models.ImportHistorique).count(),
        db_session.query(models.LigneImportBrute).count(),
    )
    assert avant == apres
    assert controle["lignes_lues"] == len(releve.lignes)


def test_sans_colonne_de_solde_pas_de_controle(db_session):
    releve = synthetiques.banque_a()
    releve.lignes = releve.lignes[:30]
    preset = _preset(db_session, releve)
    controle = import_bancaire.previsualiser(db_session, preset.id, releve.en_octets()).controle
    assert controle["controle_solde"] is None
    assert controle["total_debits"] == -sum(
        c for c in (centimes(l[2], ",") for l in releve.lignes) if c < 0
    )
