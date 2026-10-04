"""Règles : montant reçu, montant envoyé, devises — et formules en valeur.

CE QUI A ÉTÉ AJOUTÉ. Une règle sait comparer ce qui ARRIVE (`montant_recu`) et ce
qui PART (`montant_envoye`) d'une ligne, ainsi que leurs devises. La valeur d'une
condition numérique est un nombre OU une formule (« montant_envoye * 1,02 ») : c'est
ce qui permet de comparer les deux montants entre eux. Une devise se compare à un
libellé, ou à l'autre devise (`@devise_envoyee`).

Les montants viennent du FICHIER (la règle passe avant les frais) ; sans colonne
« Montant envoyé », les deux valent le montant de la ligne.
"""
import pytest
from pydantic import ValidationError

from app import crud, schemas
from app.services import import_bancaire, regles_categorisation
from app.services.formule_decoupe import FormuleInvalide, evaluer_formule, repartir

from .conftest import creer_monnaie
from .test_import_bancaire import _make_preset


def _condition(champ, operateur, valeur):
    return {"champ": champ, "operateur": operateur, "valeur": valeur}


def _evaluer(champ, operateur, valeur, **brute):
    return regles_categorisation.evaluer_condition(_condition(champ, operateur, valeur), brute)


def test_le_montant_recu_se_compare_a_un_nombre():
    assert _evaluer("montant_recu", "supérieur à", "50", montant_recu=60.0, montant_envoye=60.0)
    assert not _evaluer("montant_recu", "supérieur à", "50", montant_recu=40.0, montant_envoye=40.0)


def test_le_montant_envoye_se_compare_a_un_nombre():
    assert _evaluer("montant_envoye", "égal à", "100", montant_recu=108.0, montant_envoye=100.0)


def test_la_valeur_peut_etre_une_formule_sur_l_autre_montant():
    # « ce qui arrive dépasse de plus de 2 % ce qui part » : un montant reçu
    # anormalement haut pour un change.
    brute = dict(montant_recu=110.0, montant_envoye=100.0)
    assert _evaluer("montant_recu", "supérieur à", "montant_envoye * 1,02", **brute)
    assert not _evaluer("montant_recu", "supérieur à", "montant_envoye * 1,2", **brute)


def test_les_accents_sont_admis_dans_les_grandeurs():
    assert _evaluer(
        "montant_recu", "égal à", "montant_envoyé", montant_recu=100.0, montant_envoye=100.0
    )


def test_min_et_max_servent_dans_une_valeur():
    brute = dict(montant_recu=80.0, montant_envoye=100.0)
    assert _evaluer("montant_envoye", "supérieur à", "min(montant_recu; 90)", **brute)
    assert not _evaluer("montant_envoye", "supérieur à", "max(montant_recu; 120)", **brute)


def test_sans_montant_envoye_les_deux_montants_valent_la_ligne():
    # La ligne du relevé n'a qu'un montant : il vaut des deux côtés.
    brute = dict(montant=75.0, montant_recu=75.0, montant_envoye=75.0)
    assert _evaluer("montant_recu", "égal à", "montant_envoye", **brute)


def test_une_grandeur_inconnue_ne_correspond_a_rien():
    """Un montant envoyé que le relevé ne donne pas : la règle n'a rien à dire,
    « différent de » compris."""
    brute = dict(montant_recu=100.0, montant_envoye=None)
    assert not _evaluer("montant_recu", "égal à", "montant_envoye", **brute)
    assert not _evaluer("montant_recu", "différent de", "montant_envoye", **brute)


def test_une_formule_qui_ne_se_lit_pas_ne_correspond_a_rien():
    assert not _evaluer("montant_recu", "supérieur à", "n'importe quoi", montant_recu=10.0)


def test_une_devise_se_compare_a_un_libelle():
    assert _evaluer("devise_envoyee", "est", "usd", devise_recue="EUR", devise_envoyee="USD")
    assert not _evaluer("devise_recue", "est", "USD", devise_recue="EUR", devise_envoyee="USD")


def test_deux_devises_se_comparent_entre_elles():
    differentes = dict(devise_recue="EUR", devise_envoyee="USD")
    identiques = dict(devise_recue="EUR", devise_envoyee="EUR")
    assert _evaluer("devise_recue", "n'est pas", "@devise_envoyee", **differentes)
    assert not _evaluer("devise_recue", "n'est pas", "@devise_envoyee", **identiques)
    assert _evaluer("devise_recue", "est", "@devise_envoyee", **identiques)


def test_une_devise_absente_ne_correspond_a_rien_meme_en_negatif():
    brute = dict(devise_recue="EUR", devise_envoyee=None)
    assert not _evaluer("devise_recue", "n'est pas", "@devise_envoyee", **brute)
    assert not _evaluer("devise_recue", "est", "@devise_envoyee", **brute)


# ---------- Écriture : ce que le serveur accepte ----------


def test_le_schema_accepte_une_formule_comme_valeur_numerique():
    condition = schemas.ConditionRegle(
        champ="montant_recu", operateur="supérieur à", valeur="montant_envoye * 1,02"
    )
    assert condition.valeur == "montant_envoye * 1,02"


def test_le_schema_refuse_une_valeur_numerique_illisible():
    with pytest.raises(ValidationError):
        schemas.ConditionRegle(champ="montant_recu", operateur="supérieur à", valeur="beaucoup")


def test_le_schema_refuse_reste_dans_une_condition():
    # `reste` n'a de sens que dans une découpe.
    with pytest.raises(ValidationError):
        schemas.ConditionRegle(champ="montant_recu", operateur="supérieur à", valeur="reste")


def test_le_schema_refuse_un_operateur_de_texte_sur_un_montant_et_l_inverse():
    with pytest.raises(ValidationError):
        schemas.ConditionRegle(champ="montant_envoye", operateur="contient", valeur="12")
    with pytest.raises(ValidationError):
        schemas.ConditionRegle(champ="devise_recue", operateur="supérieur à", valeur="12")


def test_le_schema_accepte_les_devises_comme_texte():
    condition = schemas.ConditionRegle(
        champ="devise_recue", operateur="est", valeur="@devise_envoyee"
    )
    assert condition.valeurs == ["@devise_envoyee"]


# ---------- Les formules de découpe lisent aussi les deux grandeurs ----------


def test_evaluer_formule_lit_les_grandeurs():
    grandeurs = {"montant_recu": 108.0, "montant_envoye": 100.0}
    assert evaluer_formule("montant_envoye", 108.0, grandeurs) == pytest.approx(100.0)
    assert evaluer_formule("montant_recu - montant_envoye", 108.0, grandeurs) == pytest.approx(8.0)


def test_sans_grandeurs_elles_valent_le_montant():
    assert evaluer_formule("montant_envoye", 42.0) == pytest.approx(42.0)


def test_une_grandeur_none_refuse_la_formule():
    with pytest.raises(FormuleInvalide):
        evaluer_formule("montant_envoye", 42.0, {"montant_envoye": None})


def test_repartir_avec_grandeurs():
    parts = repartir(["montant_envoye", "reste"], 108.0, {"montant_envoye": 100.0})
    assert parts == [100.0, 8.0]


# ---------- Une monnaie éteinte n'est plus une cible d'import ----------


def test_un_mapping_vers_une_monnaie_eteinte_est_ignore(db_session):
    preset = _make_preset(db_session)
    dollar = creer_monnaie(db_session, "Dollar", "$")
    crud.set_mapping_monnaie(db_session, preset.id, "USD", dollar.id)
    assert import_bancaire._resoudre_monnaie(db_session, preset.id, "USD") == dollar.id

    crud.set_monnaie_active(db_session, dollar, False)

    # Le libellé retombe dans « devises à mapper » : éteinte, la monnaie se lit
    # et rien d'autre.
    assert import_bancaire._resoudre_monnaie(db_session, preset.id, "USD") is None
