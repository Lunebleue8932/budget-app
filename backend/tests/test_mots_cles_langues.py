"""Les mots-clés livrés des catégories, un fichier par langue (app/mots_cles/{fr,en,pt}.json).

Ils vivaient dans services/categorisation_intelligente.py, trois langues mêlées. Ils sont rangés par
langue pour que les améliorations à venir se fassent langue par langue ; le fonctionnement, lui, ne
change pas.

CE QUE CES TESTS VERROUILLENT :

  - LE DÉPLACEMENT N'A RIEN CHANGÉ : l'UNION des trois fichiers redonne exactement les listes d'avant
    (cliché `mots_cles_livres_avant_langues.json`, pris sur le module AVANT de le toucher) — mots par
    catégorie (dans leur ordre, qui est celui de l'écran des mots-clés), noms et synonymes reconnus,
    noms de « Autres » — et `mots_cles_par_defaut` répond comme avant pour chaque ancien nom ;
  - LA FORME DES FICHIERS : les trois ont les mêmes catégories dans le même ordre, aucun mot en
    double dans un fichier, aucun nom qui désigne deux catégories ;
  - « VIREMENTS INTERNES » : une entrée par nom dans chaque langue, liste de mots-clés VIDE ;
  - LE BUNDLE : en application packagée les fichiers sont lus sous sys._MEIPASS/app/mots_cles, et la
    spec PyInstaller les embarque exactement là.

Quand les listes sont enrichies EXPRÈS (c'est tout l'intérêt des fichiers), l'égalité avec le cliché
casse : on met alors le cliché à jour avec elles.
"""
import ast
import json
import shutil
import sys
from pathlib import Path

import pytest

from app.services import categorisation_intelligente as ci

CLICHE = Path(__file__).with_name("mots_cles_livres_avant_langues.json")
RACINE_DEPOT = Path(__file__).resolve().parents[2]
SPEC_PYINSTALLER = RACINE_DEPOT / "desktop" / "budget_app.spec"

# Ce que Felipe a demandé pour la catégorie « Virements internes ».
NOMS_VIREMENTS_INTERNES = {
    "fr": "Virements internes",
    "en": "Internal transfers",
    "pt": "Transferências internas",
}


@pytest.fixture(autouse=True)
def relire_les_fichiers():
    """`livres` garde sa lecture en mémoire : on la vide avant et après, pour qu'un test qui
    détourne le dossier ne laisse rien aux suivants."""
    ci.livres.cache_clear()
    yield
    ci.livres.cache_clear()


def _cliche() -> dict:
    return json.loads(CLICHE.read_text(encoding="utf-8"))


def _fichier(langue: str) -> dict:
    return json.loads((ci.dossier_mots_cles() / f"{langue}.json").read_text(encoding="utf-8"))


# ---------- Le déplacement n'a rien changé ----------


def test_l_union_des_fichiers_redonne_les_memes_mots_cles_qu_avant():
    cliche, lus = _cliche(), ci.livres()
    for identifiant, avant in cliche["categories"].items():
        apres = lus.mots[identifiant]
        assert set(apres) == set(avant["mots_cles"]), (
            f"{identifiant} : en moins {sorted(set(avant['mots_cles']) - set(apres))}, "
            f"en plus {sorted(set(apres) - set(avant['mots_cles']))}"
        )
        # L'ordre compte : c'est celui de l'écran des mots-clés, et il départage deux mots de même score.
        assert apres == avant["mots_cles"], f"{identifiant} : mêmes mots, autre ordre"


def test_l_union_des_fichiers_redonne_les_memes_noms_reconnus_qu_avant():
    cliche, lus = _cliche(), ci.livres()
    for identifiant, avant in cliche["categories"].items():
        apres = {nom for nom, cible in lus.noms.items() if cible == identifiant}
        assert apres == set(avant["noms"]), (
            f"{identifiant} : en moins {sorted(set(avant['noms']) - apres)}, "
            f"en plus {sorted(apres - set(avant['noms']))}"
        )


def test_les_noms_de_la_categorie_de_repli_sont_les_memes_qu_avant():
    assert ci.livres().autres == frozenset(_cliche()["autres"])


def test_seule_virements_internes_s_ajoute_aux_categories_d_avant():
    assert set(ci.livres().mots) == set(_cliche()["categories"]) | {"virements_internes"}


def test_mots_cles_par_defaut_repond_comme_avant_pour_chaque_ancien_nom():
    for identifiant, avant in _cliche()["categories"].items():
        for nom in avant["noms"]:
            assert ci.mots_cles_par_defaut(nom) == avant["mots_cles"], (identifiant, nom)
    # La normalisation fait le reste : accents, casse et ponctuation ne comptent pas.
    assert ci.mots_cles_par_defaut("Loisirs & sorties") == ci.mots_cles_par_defaut("loisirs")
    assert ci.mots_cles_par_defaut("Entrées d'argent") == _cliche()["categories"]["entrees_argent"]["mots_cles"]
    assert ci.mots_cles_par_defaut("Une catégorie inconnue") == []


def test_mots_cles_par_defaut_rend_une_copie():
    premiers = ci.mots_cles_par_defaut("Alimentaire")
    premiers.clear()
    assert ci.mots_cles_par_defaut("Alimentaire")


# ---------- La forme des fichiers ----------


def test_il_y_a_un_fichier_par_langue_et_rien_d_autre():
    presents = {f.stem for f in ci.dossier_mots_cles().glob("*.json")}
    assert presents == set(ci.LANGUES_MOTS_CLES) == {"fr", "en", "pt"}


def test_les_trois_fichiers_ont_les_memes_categories_dans_le_meme_ordre():
    ordres = {langue: list(_fichier(langue)["categories"]) for langue in ci.LANGUES_MOTS_CLES}
    assert ordres["fr"] == ordres["en"] == ordres["pt"]
    for langue in ci.LANGUES_MOTS_CLES:
        assert _fichier(langue)["langue"] == langue


def test_chaque_fichier_est_bien_forme_et_sans_doublon():
    for langue in ci.LANGUES_MOTS_CLES:
        contenu = _fichier(langue)
        listes = [(f"{i}.{cle}", c.get(cle, [])) for i, c in contenu["categories"].items() for cle in ("noms", "mots_cles")]
        listes.append(("autres.noms", contenu["autres"]["noms"]))
        for chemin, liste in listes:
            assert isinstance(liste, list), (langue, chemin)
            assert all(isinstance(m, str) and m.strip() for m in liste), (langue, chemin)
            assert len(liste) == len(set(liste)), (langue, chemin, "mot en double")
        for identifiant, categorie in contenu["categories"].items():
            assert set(categorie) == {"noms", "mots_cles"}, (langue, identifiant)


def test_aucun_nom_ne_designe_deux_categories():
    designe: dict = {}
    for langue in ci.LANGUES_MOTS_CLES:
        for identifiant, categorie in _fichier(langue)["categories"].items():
            for nom in categorie["noms"]:
                cle = ci.normaliser(nom)
                assert designe.setdefault(cle, identifiant) == identifiant, (langue, nom)
    # Et « Autres » n'est le nom d'aucune catégorie livrée.
    assert not (ci.livres().autres & set(designe))


def test_les_mots_cles_se_disent_dans_la_langue_de_leur_fichier():
    """Les exemples de la demande : un mot commun à deux langues est dans chacune, une marque dans
    chaque langue où on la rencontre, un mot d'une seule langue dans celle-là seulement."""
    mots = {
        langue: {m for c in _fichier(langue)["categories"].values() for m in c["mots_cles"]}
        for langue in ci.LANGUES_MOTS_CLES
    }
    assert {"restaurant", "bus"} <= mots["fr"] & mots["en"]
    assert {"netflix", "uber"} <= mots["fr"] & mots["en"] & mots["pt"]
    assert "boulangerie" in mots["fr"] and "boulangerie" not in mots["en"] | mots["pt"]
    assert "groceries" in mots["en"] and "groceries" not in mots["fr"] | mots["pt"]
    assert "padaria" in mots["pt"] and "padaria" not in mots["fr"] | mots["en"]


# ---------- « Virements internes » ----------


def test_virements_internes_a_son_entree_par_nom_et_une_liste_vide_dans_chaque_langue():
    for langue, nom in NOMS_VIREMENTS_INTERNES.items():
        entree = _fichier(langue)["categories"]["virements_internes"]
        assert entree["noms"] == [nom], langue
        assert entree["mots_cles"] == [], langue


def test_virements_internes_se_reconnait_par_nom_sans_aucun_mot_cle():
    assert ci.livres().mots["virements_internes"] == []
    for nom in NOMS_VIREMENTS_INTERNES.values():
        assert ci.livres().noms[ci.normaliser(nom)] == "virements_internes"
        assert ci.mots_cles_par_defaut(nom) == []


# ---------- Un fichier absent ou abîmé ne plante rien ----------


def test_un_fichier_abime_ou_absent_est_ignore(tmp_path, monkeypatch):
    dossier = tmp_path / "mots_cles"
    dossier.mkdir()
    (dossier / "fr.json").write_text("{ pas du json", encoding="utf-8")
    shutil.copy(ci.dossier_mots_cles() / "en.json", dossier / "en.json")
    # pt.json manque tout à fait.
    monkeypatch.setattr(ci, "dossier_mots_cles", lambda: dossier)
    lus = ci.livres()
    assert "groceries" in lus.mots["alimentaire"]
    assert "boulangerie" not in lus.mots["alimentaire"]
    assert ci.mots_cles_par_defaut("Santé") == []  # le nom « Santé » ne vient que du français


# ---------- Le bundle ----------


def test_en_application_packagee_les_fichiers_sont_sous_meipass(tmp_path, monkeypatch):
    avant = ci.livres()
    dossier_reel = ci.dossier_mots_cles()
    assert dossier_reel == Path(ci.__file__).resolve().parent.parent / "mots_cles"
    assert dossier_reel.is_dir()

    # Le bundle : tout est sous sys._MEIPASS, aux destinations de la spec.
    shutil.copytree(dossier_reel, tmp_path / "app" / "mots_cles")
    monkeypatch.setattr(sys, "frozen", True, raising=False)
    monkeypatch.setattr(sys, "_MEIPASS", str(tmp_path), raising=False)
    assert ci.dossier_mots_cles() == tmp_path / "app" / "mots_cles"
    ci.livres.cache_clear()
    assert ci.livres() == avant


def _donnees_de_la_spec() -> dict:
    """{source (écrite comme dans la spec) : destination} de la liste `donnees` de la spec."""
    arbre = ast.parse(SPEC_PYINSTALLER.read_text(encoding="utf-8"))
    for noeud in arbre.body:
        if isinstance(noeud, ast.Assign) and any(getattr(c, "id", None) == "donnees" for c in noeud.targets):
            return {ast.unparse(source): ast.literal_eval(dest) for source, dest in (t.elts for t in noeud.value.elts)}
    raise AssertionError("la spec n'a plus de liste `donnees`")


def test_la_spec_pyinstaller_embarque_les_fichiers_la_ou_le_code_les_lit(monkeypatch):
    donnees = _donnees_de_la_spec()
    source = "str(BACKEND / 'app' / 'mots_cles')"
    assert source in donnees, "desktop/budget_app.spec n'embarque pas backend/app/mots_cles"

    # La destination de la spec, c'est ce que lit le code une fois figé.
    monkeypatch.setattr(sys, "frozen", True, raising=False)
    monkeypatch.setattr(sys, "_MEIPASS", "/bundle", raising=False)
    lu_en_bundle = ci.dossier_mots_cles()
    assert lu_en_bundle == Path("/bundle") / donnees[source]
    # Et la source de la spec est bien le dossier que le code lit en développement.
    monkeypatch.undo()
    assert RACINE_DEPOT / "backend" / "app" / "mots_cles" == ci.dossier_mots_cles()
