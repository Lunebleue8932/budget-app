"""La carte de « Où c'est exposé » : quels pays recouvre chaque zone de la base.

Ce qui se vérifie : les zones livrées couvrent le monde sans qu'un pays compte deux fois ; une zone
créée pour un pays l'emporte sur le regroupement qui le contient ; une zone légèrement renommée est
reconnue ; une zone sans géographie (« Monde ») ne recouvre rien ; la route suit les zones de la base ;
la carte et la table des noms disent les mêmes pays.
"""
import re
from pathlib import Path

from app import crud
from app.constants import ZONES_INITIALES, AxeTitre

from .conftest import charger_module_extension

zones_pays = charger_module_extension("investing-overview", "zones_pays.py")
routeur = charger_module_extension("investing-overview", "routeur_investing_overview.py")
pays_iso = charger_module_extension("investing-overview", "pays_iso.py")


def _livrees():
    return list(enumerate(ZONES_INITIALES, start=1))


def test_les_zones_livrees_couvrent_la_carte_sans_double_compte():
    resultat = zones_pays.affecter(_livrees())
    tous = [code for codes in resultat.values() for code in codes]
    assert len(tous) == len(set(tous))
    manquants = set(pays_iso.PAYS) - set(tous)
    # Seuls des territoires sans population permanente restent sans zone.
    assert manquants <= {"GS", "HM", "TF", "AQ"}
    assert resultat[1] == ["US"] and set(resultat[2]) == {"CN", "HK", "MO"}


def test_une_zone_pour_un_pays_l_emporte_sur_le_regroupement():
    zones = _livrees() + [(20, "Suisse"), (21, "Japan")]
    resultat = zones_pays.affecter(zones)
    assert resultat[20] == ["CH"] and "CH" not in resultat[3]
    assert resultat[21] == ["JP"] and "JP" not in resultat[4]


def test_une_zone_renommee_reste_reconnue_et_monde_ne_recouvre_rien():
    resultat = zones_pays.affecter([(1, "Asie hors Chine"), (2, "Monde"), (3, "Europe de l'Ouest")])
    assert "JP" in resultat[1] and resultat[2] == []
    assert resultat[3] == []  # trop éloignée d'un regroupement connu : on ne devine pas


def test_la_route_suit_les_zones_de_la_base(db_session):
    for nom in ("Japon", "Europe", "Asie (hors Chine)"):
        if not any(z.nom == nom for z in crud.get_types_titre(db_session, AxeTitre.zone.value)):
            crud.create_type_titre(db_session, nom, AxeTitre.zone.value)
    lu = {z["nom"]: z["pays"] for z in routeur.get_zones_pays(db=db_session)}
    assert lu["Japon"] == ["JP"] and "JP" not in lu["Asie (hors Chine)"]
    assert "FR" in lu["Europe"]


def test_la_carte_et_la_table_des_noms_disent_les_memes_pays():
    source = (Path(__file__).resolve().parents[2] / "extensions" / "investing-overview" / "carte-monde.js").read_text(encoding="utf-8")
    codes = set(re.findall(r'"c":"([A-Z]{2})"', source))
    assert codes == set(pays_iso.PAYS)


def test_la_russie_est_en_asie_par_defaut():
    resultat = zones_pays.affecter([(1, "Europe"), (2, "Asie (hors Chine)")])
    assert "RU" in resultat[2] and "RU" not in resultat[1]
    correspondances = charger_module_extension("placements", "correspondances_etf.py")
    assert correspondances.zone_par_defaut("Russie") == "Asie (hors Chine)"
    assert correspondances.zone_par_defaut("Russian Federation") == "Asie (hors Chine)"
