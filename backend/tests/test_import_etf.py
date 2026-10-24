"""L'import de la composition d'un ETF, depuis le fichier tel que l'émetteur le publie.

CE QUE CES TESTS PROTÈGENT, dans l'ordre de ce qui coûterait le plus cher à casser :

  - LE FICHIER SE LIT QUEL QUE SOIT SON HABIT. Un classeur .xlsx dont la feuille de styles est
    invalide (Amundi) se lit comme un autre ; un « .xls » qui est du XML Excel 2003 (iShares)
    aussi ; un CSV en Windows-1252 (SPDR) aussi. L'en-tête est TROUVÉ sous le bandeau, jamais
    supposé en première ligne ;
  - LES POIDS SONT DES POURCENTAGES. Un fichier en fractions (0,1257) est converti, un fichier en
    pourcentages ne l'est pas, et RIEN N'EST RENORMALISÉ ;
  - LES LIGNES QUI NE SONT PAS DES TITRES (liquidités, change, contrats à terme) n'entrent pas dans
    la composition ;
  - LA LECTURE N'ÉCRIT RIEN, la confirmation écrit ce que la lecture a annoncé ;
  - L'IMPORT COMPLÈTE, IL N'ÉCRASE PAS : le secteur qu'on a saisi sur un titre reste ;
  - UN COMPOSANT SANS ISIN EST CITÉ PAR `titre:<id>`, et le même fichier réimporté retrouve ses
    titres au lieu d'en créer d'autres.
"""
import asyncio
import io
import json
import zipfile

import pytest
from fastapi import HTTPException, UploadFile
from openpyxl import Workbook

from app import crud, models
from app.constants import AxeTitre
from app.services import exposition

from .conftest import charger_module_extension

classeur = charger_module_extension("placements", "lecture_classeur.py")
lecture = charger_module_extension("placements", "composition_etf.py")
corr = charger_module_extension("placements", "correspondances_etf.py")
service = charger_module_extension("placements", "service_import_etf.py")
routeur = charger_module_extension("placements", "routeur_import_etf.py")
titres_routes = charger_module_extension("placements", "routeur_titres.py")


def _xlsx(feuilles: dict[str, list[list]]) -> bytes:
    wb = Workbook()
    wb.remove(wb.active)
    for nom, lignes in feuilles.items():
        ws = wb.create_sheet(nom)
        for ligne in lignes:
            ws.append(ligne)
    tampon = io.BytesIO()
    wb.save(tampon)
    return tampon.getvalue()


def _abimer_styles(contenu: bytes) -> bytes:
    """Le défaut du fichier d'Amundi : une couleur qui n'est pas de l'aRGB dans les styles."""
    sortie = io.BytesIO()
    with zipfile.ZipFile(io.BytesIO(contenu)) as source, zipfile.ZipFile(sortie, "w") as cible:
        for nom in source.namelist():
            donnees = source.read(nom)
            if nom == "xl/styles.xml":
                donnees = donnees.replace(b'<color rgb="FF000000"', b'<color rgb="zz"')
                if b'rgb="zz"' not in donnees:
                    donnees = donnees.replace(b"<font>", b'<font><color rgb="zz"/>', 1)
            cible.writestr(nom, donnees)
    return sortie.getvalue()


BANDEAU = [
    [None, "Émetteur"],
    [],
    [None, "Nom du fonds", "Amundi Test World UCITS ETF"],
    [None, "Code ISIN", "IE000AAAAAA1"],
    [None, "Devise de référence", "EUR"],
    [],
]
ENTETE = [None, "Code ISIN", "Nom", "Classe d'actifs", "Devise", "Poids", "Secteur", "Pays"]


def _holdings(*lignes):
    return BANDEAU + [ENTETE] + [[None, *l] for l in lignes]


LIGNES_AMUNDI = [
    ("US1912161007", "COCA-COLA", "EQUITY", "USD", 0.5, "Biens de consommation non cyclique", "États-Unis"),
    ("CH0038863350", "NESTLE", "EQUITY", "CHF", 0.3, "Biens de consommation non cyclique", "Suisse"),
    ("US22160K1051", "COSTCO", "EQUITY", "USD", 0.18, "Biens de consommation non cyclique", "États-Unis"),
    (None, "XAP FUTURE 12/26", "FUTURE", "USD", 0.01, None, "États-Unis"),
    ("NZATME0002S8", "A2 MILK", "EQUITY", "AUD", 0.01, "Biens de consommation non cyclique", "NEW_ZEALAND"),
]


# ---------- Le lecteur de classeurs ----------


def test_un_classeur_aux_styles_invalides_se_lit_quand_meme():
    brut = _xlsx({"Actifs": _holdings(*LIGNES_AMUNDI)})
    abime = _abimer_styles(brut)
    feuilles = classeur.lire_classeur(abime)
    assert [f.nom for f in feuilles] == ["Actifs"]
    # Les numéros de ligne sont ceux d'Excel : l'en-tête est à la ligne 7.
    assert feuilles[0].lignes[6][1] == "Code ISIN"


def test_un_xls_qui_est_du_xml_excel_2003_se_lit():
    xml = (
        '<?xml version="1.0"?><Workbook xmlns="urn:schemas-microsoft-com:office:spreadsheet" '
        'xmlns:ss="urn:schemas-microsoft-com:office:spreadsheet"><Worksheet ss:Name="Holdings"><Table>'
        '<Row><Cell><Data ss:Type="String">Name</Data></Cell><Cell><Data ss:Type="String">Weight (%)</Data></Cell></Row>'
        '<Row><Cell><Data ss:Type="String">TSMC</Data></Cell><Cell><Data ss:Type="Number">15.9</Data></Cell></Row>'
        "</Table></Worksheet></Workbook>"
    ).encode()
    feuilles = classeur.lire_classeur(xml)
    assert feuilles[0].nom == "Holdings"
    assert feuilles[0].lignes[1] == ("TSMC", 15.9)


def test_un_csv_windows_1252_se_lit():
    csv = "Fund Name:,SPDR® Test\r\nISIN:,IE00BKWQ0H23\r\n\r\nISIN,Security Name,Percent of Fund\r\nCH0012005267,Novartis AG,15.4\r\n".encode("cp1252")
    feuilles = classeur.lire_classeur(csv)
    assert feuilles[0].lignes[4][1] == "Novartis AG"


def test_un_ancien_xls_binaire_est_refuse_clairement():
    with pytest.raises(ValueError, match="xlsx"):
        classeur.lire_classeur(b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1" + b"\0" * 20)


# ---------- La lecture de la composition ----------


def test_l_entete_est_trouve_sous_le_bandeau_et_les_metadonnees_lues():
    fichier = lecture.lire(_xlsx({"Actifs": _holdings(*LIGNES_AMUNDI)}))
    assert fichier.fonds_nom == "Amundi Test World UCITS ETF"
    assert fichier.fonds_isin == "IE000AAAAAA1"
    assert fichier.fonds_devise == "EUR"
    feuille = fichier.feuilles[0]
    assert feuille.type == "possessions" and feuille.ligne_entete == 7


def test_les_fractions_sont_converties_et_rien_n_est_renormalise():
    fichier = lecture.lire(_xlsx({"Actifs": _holdings(*LIGNES_AMUNDI)}))
    assert fichier.feuilles[0].unite == "fraction"
    poids = [p.poids for p in fichier.possessions]
    assert poids[0] == pytest.approx(50.0)
    # 0,5 + 0,3 + 0,18 + 0,01 (les 0,01 du future sont écartés) = 99 %, pas 100.
    assert sum(poids) == pytest.approx(99.0)


def test_des_pourcentages_ne_sont_pas_convertis():
    lignes = [list(l) for l in LIGNES_AMUNDI]
    for l in lignes:
        l[4] = l[4] * 100
    fichier = lecture.lire(_xlsx({"Actifs": _holdings(*lignes)}))
    assert fichier.feuilles[0].unite == "%"
    assert fichier.possessions[0].poids == pytest.approx(50.0)


def test_les_lignes_qui_ne_sont_pas_des_titres_sont_ecartees():
    fichier = lecture.lire(_xlsx({"Actifs": _holdings(*LIGNES_AMUNDI)}))
    assert [p.nom for p in fichier.possessions] == ["COCA-COLA", "NESTLE", "COSTCO", "A2 MILK"]
    assert [e[1] for e in fichier.ecartees] == ["XAP FUTURE 12/26"]


def test_les_possessions_sont_triees_par_poids_decroissant():
    fichier = lecture.lire(_xlsx({"Actifs": _holdings(*reversed(LIGNES_AMUNDI))}))
    poids = [p.poids for p in fichier.possessions]
    assert poids == sorted(poids, reverse=True)


def test_un_fichier_sans_isin_se_lit_par_le_nom():
    feuille = [["Ticker", "Name", "Sector", "Asset Class", "Weight (%)", "Location"],
               ["2330", "TSMC", "Information Technology", "Equity", 60.0, "Taiwan"],
               ["005930", "SAMSUNG", "Information Technology", "Equity", 40.0, "Korea (South)"],
               ["USD", "USD CASH", "Cash and/or Derivatives", "Cash", -0.2, "United States"]]
    fichier = lecture.lire(_xlsx({"Holdings": feuille, "Historical": [["As Of", "NAV"], ["Oct 16", 62.7]]}))
    assert [p.isin for p in fichier.possessions] == [None, None]
    assert [f.type for f in fichier.feuilles] == ["possessions", "non reconnue"]
    assert fichier.ecartees and fichier.ecartees[0][1] == "USD CASH"


def test_une_feuille_de_repartition_par_secteur_est_reconnue():
    secteurs = [["Secteur", "Poids"], ["Santé", 0.6], ["Finance", 0.4]]
    fichier = lecture.lire(_xlsx({"Actifs": _holdings(*LIGNES_AMUNDI), "Secteurs": secteurs}))
    types = {f.nom: f.type for f in fichier.feuilles}
    assert types == {"Actifs": "possessions", "Secteurs": "secteurs"}
    assert fichier.secteurs == [("Santé", pytest.approx(60.0)), ("Finance", pytest.approx(40.0))]


def test_un_fichier_sans_possessions_est_refuse():
    with pytest.raises(ValueError, match="possessions"):
        lecture.lire(_xlsx({"Autre": [["a", "b"], [1, 2]]}))


def test_couverture_et_nombre_de_lignes_se_correspondent():
    poids = [40.0, 30.0, 20.0, 10.0]
    assert lecture.cumul(poids) == [40.0, 70.0, 90.0, 100.0]
    assert lecture.lignes_pour_couverture(poids, 60) == 2
    assert lecture.lignes_pour_couverture(poids, 70) == 2
    assert lecture.lignes_pour_couverture(poids, 71) == 3
    assert lecture.lignes_pour_couverture(poids, 100) == 4
    assert lecture.couverture_pour_lignes(poids, 3) == 90.0


# ---------- Les correspondances ----------


@pytest.mark.parametrize(
    "pays, zone",
    [
        ("United States", "États-Unis"), ("États-Unis", "États-Unis"), ("China", "Chine"),
        ("Hong Kong", "Chine"), ("Suisse", "Europe"), ("Korea (South)", "Asie (hors Chine)"),
        ("Canada", "Amérique (hors États-Unis)"), ("South Africa", "Afrique"),
        ("NEW_ZEALAND", "Océanie"), ("Taiwan", "Asie (hors Chine)"),
    ],
)
def test_pays_vers_zone_par_defaut(pays, zone):
    assert corr.zone_par_defaut(pays) == zone


def test_un_pays_inconnu_n_a_pas_de_zone():
    assert corr.zone_par_defaut("Atlantide") is None


@pytest.mark.parametrize(
    "libelle, secteur",
    [
        ("Biens de consommation non cyclique", "Consommation de base"),
        ("Consumer Staples", "Consommation de base"),
        ("Consumer Discretionary", "Consommation discrétionnaire"),
        ("Information Technology", "Technologies de l'information"),
        ("Health Care", "Santé"), ("Financials", "Finance"), ("Communication", "Services de communication"),
        ("Utilities", "Services aux collectivités"), ("Real Estate", "Immobilier"),
    ],
)
def test_mots_cles_de_secteur(libelle, secteur):
    assert corr.secteur_par_mots_cles(libelle) == secteur


def test_le_secteur_propose_prefere_l_orthographe_de_l_utilisateur_puis_le_flou():
    # Le mot-clé vise le secteur livré ; l'orthographe de l'utilisateur gagne quand il l'a gardé.
    assert corr.secteur_propose("Health Care", ["Santé", "Finance"]) == ("Santé", "mot-clé")
    assert corr.secteur_propose("Health Care", ["Santé et bien-être"]) == ("Santé", "mot-clé")
    assert corr.secteur_propose("sante", ["Santé", "Finance"]) == ("Santé", "exact")
    # Rien de proche : « sans correspondance », pas un mauvais secteur.
    assert corr.secteur_propose("Zzyzx", ["Santé", "Finance"]) == (None, "aucun")
    # Une faute de frappe est rattrapée par le flou.
    assert corr.secteur_propose("Zorblux Kvandry", ["Zorblux Kvandri", "Santé"]) == ("Zorblux Kvandri", "approchant")


# ---------- Le service : lire, puis confirmer ----------


def _fichier_amundi():
    return _xlsx({"Actifs": _holdings(*LIGNES_AMUNDI)})


def _compte(db, modele):
    return db.query(modele).count()


def test_lire_n_ecrit_rien(db_session):
    avant = (_compte(db_session, models.TitrePossede), _compte(db_session, models.TypeTitre))
    apercu = service.lire(db_session, _fichier_amundi())
    assert (_compte(db_session, models.TitrePossede), _compte(db_session, models.TypeTitre)) == avant
    assert apercu["nb_possessions"] == 4
    assert apercu["fonds"]["isin"] == "IE000AAAAAA1"
    assert apercu["couverture"]["cumul"][0] == pytest.approx(50.0)
    assert apercu["etf"]["titre_id"] is None
    secteur = apercu["secteurs"][0]
    assert secteur["brut"] == "Biens de consommation non cyclique" and secteur["propose"] == "Consommation de base"
    zones = {z["brut"]: z["propose"] for z in apercu["zones"]}
    assert zones["États-Unis"] == "États-Unis" and zones["Suisse"] == "Europe" and zones["NEW_ZEALAND"] == "Océanie"


def test_confirmer_cree_l_etf_ses_composants_et_leur_drapeau(db_session):
    resultat = service.confirmer(db_session, _fichier_amundi(), None, {"nb_lignes": 3})
    etf = crud.get_titre(db_session, resultat["etf_id"])
    assert etf.nom == "Amundi Test World UCITS ETF" and etf.code_isin == "IE000AAAAAA1"
    assert etf.type_titre.nom.lower().startswith("etf")
    # Trois lignes retenues : 50 + 30 + 18 = 98 %.
    assert set(etf.composition) == {"US1912161007", "CH0038863350", "US22160K1051"}
    assert etf.composition_couverture_pct == pytest.approx(98.0)
    assert etf.part_etf is False
    coca = next(t for t in crud.get_titres(db_session) if t.code_isin == "US1912161007")
    assert coca.part_etf is True
    assert [e.etiquette.nom for e in coca.repartition(AxeTitre.secteur.value)] == ["Consommation de base"]
    assert [e.etiquette.nom for e in coca.repartition(AxeTitre.zone.value)] == ["États-Unis"]
    assert [e.etiquette.nom for e in coca.repartition(AxeTitre.classe.value)] == ["Actions"]
    assert resultat["titres_crees"] == 3 and resultat["nb_composants"] == 3
    # La 4e ligne n'était pas retenue : pas de titre pour elle.
    assert not any(t.code_isin == "NZATME0002S8" for t in crud.get_titres(db_session))


def test_les_choix_de_correspondance_l_emportent_sur_la_proposition(db_session):
    choix = {
        "nb_lignes": 4,
        "secteurs": {"Biens de consommation non cyclique": "Alimentation"},
        "zones": {"Suisse": "Suisse"},
    }
    resultat = service.confirmer(db_session, _fichier_amundi(), None, choix)
    assert {"axe": "secteur", "nom": "Alimentation"} in resultat["etiquettes_creees"]
    assert {"axe": "zone", "nom": "Suisse"} in resultat["etiquettes_creees"]
    nestle = next(t for t in crud.get_titres(db_session) if t.code_isin == "CH0038863350")
    assert [e.etiquette.nom for e in nestle.repartition(AxeTitre.zone.value)] == ["Suisse"]


def test_une_correspondance_vide_ne_pose_rien(db_session):
    service.confirmer(
        db_session, _fichier_amundi(), None, {"nb_lignes": 2, "secteurs": {"Biens de consommation non cyclique": ""}}
    )
    coca = next(t for t in crud.get_titres(db_session) if t.code_isin == "US1912161007")
    assert coca.repartition(AxeTitre.secteur.value) == []


def test_un_titre_existant_est_retrouve_marque_mais_son_secteur_n_est_pas_ecrase(db_session):
    monnaie = crud.get_monnaies(db_session)[0]
    secteur_perso = crud.create_type_titre(db_session, "Mon secteur", AxeTitre.secteur.value)
    coca = crud.create_titre(db_session, "Coca perso", monnaie.id, 50.0, "US1912161007")
    crud.poser_repartition(db_session, coca, AxeTitre.secteur.value, [(secteur_perso.id, 100.0)])
    db_session.commit()
    resultat = service.confirmer(db_session, _fichier_amundi(), None, {"nb_lignes": 2})
    db_session.refresh(coca)
    assert resultat["titres_retrouves"] == 1 and resultat["titres_crees"] == 1
    assert coca.part_etf is True
    assert [e.etiquette.nom for e in coca.repartition(AxeTitre.secteur.value)] == ["Mon secteur"]
    assert coca.valeur == 50.0


def test_reimporter_le_meme_fichier_ne_cree_rien_de_plus(db_session):
    service.confirmer(db_session, _fichier_amundi(), None, {"nb_lignes": 4})
    avant = _compte(db_session, models.TitrePossede)
    resultat = service.confirmer(db_session, _fichier_amundi(), None, {"nb_lignes": 4})
    assert _compte(db_session, models.TitrePossede) == avant
    assert resultat["titres_crees"] == 0 and resultat["etf_cree"] is False


def test_le_second_import_remplace_la_composition_d_un_bloc(db_session):
    premier = service.confirmer(db_session, _fichier_amundi(), None, {"nb_lignes": 4})
    service.confirmer(db_session, _fichier_amundi(), None, {"nb_lignes": 2, "etf": {"titre_id": premier["etf_id"]}})
    etf = crud.get_titre(db_session, premier["etf_id"])
    assert len(etf.composition) == 2


def _fichier_sans_isin():
    feuille = [["Ticker", "Name", "Sector", "Asset Class", "Weight (%)", "Location", "Currency"],
               ["2330", "TAIWAN SEMI", "Information Technology", "Equity", 60.0, "Taiwan", "USD"],
               ["005930", "SAMSUNG", "Information Technology", "Equity", 40.0, "Korea (South)", "USD"]]
    return _xlsx({"Holdings": [["iShares Test EM ETF"], ["Fund Holdings as of", "Oct 15, 2026"], [], *feuille]})


def test_des_composants_sans_isin_sont_cites_par_leur_identifiant(db_session):
    resultat = service.confirmer(
        db_session, _fichier_sans_isin(), None, {"nb_lignes": 2, "etf": {"nom": "iShares EM", "isin": ""}}
    )
    etf = crud.get_titre(db_session, resultat["etf_id"])
    titres = {t.nom: t for t in crud.get_titres(db_session) if t.part_etf}
    assert set(etf.composition) == {f"titre:{titres['TAIWAN SEMI'].id}", f"titre:{titres['SAMSUNG'].id}"}
    assert all(t.code_isin is None for t in titres.values())
    # Le même fichier réimporté retrouve les titres par leur nom.
    avant = _compte(db_session, models.TitrePossede)
    service.confirmer(db_session, _fichier_sans_isin(), None, {"nb_lignes": 2, "etf": {"titre_id": etf.id}})
    assert _compte(db_session, models.TitrePossede) == avant
    # Et la composition reste valide pour l'application (saisie à la main comprise).
    assert exposition.valider_composition(crud.get_titre(db_session, etf.id).composition) == []


def test_un_titre_cite_par_son_identifiant_ne_se_supprime_pas(db_session):
    resultat = service.confirmer(
        db_session, _fichier_sans_isin(), None, {"nb_lignes": 2, "etf": {"nom": "iShares EM", "isin": ""}}
    )
    taiwan = next(t for t in crud.get_titres(db_session) if t.nom == "TAIWAN SEMI")
    assert [e.id for e in crud.etf_qui_citent(db_session, taiwan)] == [resultat["etf_id"]]
    assert resultat["etf_id"] in [e.id for e in crud.etf_qui_citent_tous(db_session)[taiwan.id]]


def test_deux_homonymes_sans_isin_ne_se_devinent_pas(db_session):
    monnaie = crud.get_monnaies(db_session)[0]
    crud.create_titre(db_session, "SAMSUNG", monnaie.id, 0.0, "KR7005930003")
    crud.create_titre(db_session, "SAMSUNG", monnaie.id, 0.0, "KR7005931001")
    resultat = service.confirmer(
        db_session, _fichier_sans_isin(), None, {"nb_lignes": 2, "etf": {"nom": "iShares EM", "isin": ""}}
    )
    assert resultat["ecartes"] == 1
    assert any("SAMSUNG" in a for a in resultat["avertissements"])
    assert resultat["nb_composants"] == 1


def test_la_feuille_de_repartition_de_l_etf_est_posee_sur_l_etf(db_session):
    secteurs = [["Secteur", "Poids"], ["Biens de consommation non cyclique", 0.9], ["Santé", 0.1]]
    contenu = _xlsx({"Actifs": _holdings(*LIGNES_AMUNDI), "Secteurs": secteurs})
    resultat = service.confirmer(db_session, contenu, None, {"nb_lignes": 3})
    etf = crud.get_titre(db_session, resultat["etf_id"])
    assert {e.etiquette.nom: e.poids_pct for e in etf.repartition(AxeTitre.secteur.value)} == {
        "Consommation de base": pytest.approx(90.0), "Santé": pytest.approx(10.0)
    }
    # La zone, elle, n'a pas de feuille : elle se déduit des pays des possessions (toutes les lignes lues,
    # ici 98 % États-Unis/Suisse/Nouvelle-Zélande… les 4 actions pèsent 99 %).
    zones = {e.etiquette.nom: e.poids_pct for e in etf.repartition(AxeTitre.zone.value)}
    assert zones == {"États-Unis": pytest.approx(68.0), "Europe": pytest.approx(30.0), "Océanie": pytest.approx(1.0)}


def test_sans_feuille_de_repartition_l_etf_prend_celle_de_ses_actions(db_session):
    resultat = service.confirmer(db_session, _fichier_amundi(), None, {"nb_lignes": 1})
    etf = crud.get_titre(db_session, resultat["etf_id"])
    # Une seule ligne importée, mais la répartition vient de TOUTES les actions du fichier.
    secteurs = {e.etiquette.nom: e.poids_pct for e in etf.repartition(AxeTitre.secteur.value)}
    assert secteurs == {"Consommation de base": pytest.approx(99.0)}
    assert etf.composition_couverture_pct == pytest.approx(50.0)


def test_un_fichier_sans_secteur_ni_pays_ne_pose_aucune_repartition(db_session):
    feuille = [["Classe d'actifs", "Nom", "Code ISIN", "Poids"],
               ["Action", "SAFRAN", "FR0000073272", 0.6], ["Action", "AIRBUS", "NL0000235190", 0.4]]
    resultat = service.confirmer(
        db_session, _xlsx({"Inventaire": feuille}), None, {"nb_lignes": 2, "etf": {"nom": "BNP Defense", "isin": ""}}
    )
    etf = crud.get_titre(db_session, resultat["etf_id"])
    assert etf.repartition(AxeTitre.secteur.value) == [] and etf.repartition(AxeTitre.zone.value) == []


def test_un_etf_existant_n_est_pas_recree(db_session):
    monnaie = crud.get_monnaies(db_session)[0]
    existant = crud.create_titre(db_session, "Mon Amundi", monnaie.id, 100.0, "IE000AAAAAA1")
    resultat = service.confirmer(db_session, _fichier_amundi(), None, {"nb_lignes": 2})
    assert resultat["etf_id"] == existant.id and resultat["etf_cree"] is False
    apercu = service.lire(db_session, _fichier_amundi())
    assert apercu["etf"]["titre_id"] == existant.id


def test_le_drapeau_part_etf_voyage_avec_la_detention(db_session):
    """Le drapeau ne dit rien de la détention : c'est l'écran qui garde les titres détenus dans
    « Titres suivis ». Le serveur rend les deux informations côte à côte."""
    service.confirmer(db_session, _fichier_amundi(), None, {"nb_lignes": 2})
    coca = next(t for t in titres_routes.list_titres(db=db_session) if t.code_isin == "US1912161007")
    assert coca.part_etf is True and coca.detenu is False


def _envoi(contenu: bytes) -> UploadFile:
    return UploadFile(file=io.BytesIO(contenu), filename="composition.xlsx")


def test_les_routes_lire_et_confirmer(db_session):
    lu = asyncio.run(routeur.lire(fichier=_envoi(_fichier_amundi()), delimiteur=None, db=db_session))
    assert lu["nb_possessions"] == 4
    ok = asyncio.run(
        routeur.confirmer(
            fichier=_envoi(_fichier_amundi()), delimiteur=None, choix=json.dumps({"nb_lignes": 2}), db=db_session
        )
    )
    assert ok["nb_composants"] == 2
    with pytest.raises(HTTPException) as erreur:
        asyncio.run(routeur.confirmer(fichier=_envoi(_fichier_amundi()), delimiteur=None, choix="pas du json", db=db_session))
    assert erreur.value.status_code == 400
    with pytest.raises(HTTPException) as erreur:
        asyncio.run(routeur.lire(fichier=_envoi(_xlsx({"A": [[1, 2]]})), delimiteur=None, db=db_session))
    assert erreur.value.status_code == 400
