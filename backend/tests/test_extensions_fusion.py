"""« Projets » et « Objectifs » sont devenues « Projets et objectifs » (manifeste `remplace`).

CE QUE CES TESTS VERROUILLENT : la fusion n'éteint rien chez qui s'en servait. Au démarrage,
`rattraper_etat_avant_opt_in` reprend l'état des anciennes extensions pour la nouvelle — mais
ne touche jamais à une décision déjà enregistrée pour elle.
"""
import json

import pytest

from app import extensions

ID = "projets-objectifs"


@pytest.fixture()
def etat(tmp_path, monkeypatch):
    fichier = tmp_path / "extensions.json"
    monkeypatch.setattr(extensions, "_fichier_etat", lambda: fichier)

    def poser(actives, annoncees=()):
        fichier.write_text(
            json.dumps({"actives": actives, "annoncees": list(annoncees)}), encoding="utf-8"
        )

    def lire():
        return json.loads(fichier.read_text(encoding="utf-8"))

    return poser, lire


def test_le_manifeste_declare_les_deux_anciennes():
    assert sorted(extensions.decouvrir()[ID].remplace) == ["objectifs", "projets"]


def test_l_une_des_anciennes_allumee_allume_la_nouvelle(etat):
    poser, lire = etat
    poser({"projets": False, "objectifs": True}, ["projets", "objectifs"])
    extensions.rattraper_etat_avant_opt_in()
    contenu = lire()
    assert contenu["actives"][ID] is True
    assert ID in contenu["annoncees"]


def test_aucune_des_anciennes_allumee_laisse_la_nouvelle_eteinte(etat):
    poser, lire = etat
    poser({"projets": False, "objectifs": False})
    extensions.rattraper_etat_avant_opt_in()
    assert ID not in lire()["actives"]


def test_une_decision_explicite_n_est_jamais_ecrasee(etat):
    poser, lire = etat
    poser({"projets": True, "objectifs": True, ID: False})
    extensions.rattraper_etat_avant_opt_in()
    assert lire()["actives"][ID] is False
