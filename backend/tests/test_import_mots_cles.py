"""Les relevés « Wise » : « Direction » (IN / OUT), « Status » (COMPLETED / CANCELLED), un montant
envoyé et un montant reçu dans deux devises.

Ce qu'on verrouille :

  - une colonne « Direction » ou « Status » est PROPOSÉE avec assurance sur son intitulé et sa poignée
    de valeurs, sans que le vocabulaire soit connu d'avance (l'étape « mots-clés » de l'import demande
    ensuite à quoi correspond chaque valeur) ;
  - « Source fee currency » est la monnaie des frais, pas une monnaie du montant ;
  - deux montants égaux sauf sur les lignes où deux devises diffèrent sont l'envoyé et le reçu, avec ou
    sans intitulés ;
  - « montant au débit / au crédit » n'est jamais proposé quand aucune paire de colonnes ne se partage
    les lignes ;
  - les mots-clés posés à l'écran servent à la lecture AVANT tout enregistrement du preset.
"""
import io
import random
from datetime import date

import openpyxl

from app import crud
from app.routers import import_bancaire as routeur
from app.services import import_bancaire
from app.services.detection_colonnes import detecter_colonnes

from .conftest import creer_compte


def _releve_wise(avec_entetes=True, n=60):
    """Un relevé de la forme de ceux de Wise : un tiers des lignes sont des conversions EUR -> USD."""
    hasard = random.Random(7)
    entetes = (
        "ID", "Status", "Direction", "Created on", "Finished on",
        "Source fee amount", "Source fee currency", "Target fee amount", "Target fee currency",
        "Source name", "Source amount (after fees)", "Source currency",
        "Target name", "Target amount (after fees)", "Target currency",
        "Exchange rate", "Reference",
    )
    lignes = [entetes] if avec_entetes else []
    for i in range(n):
        conversion = i % 3 == 0
        envoye = round(hasard.uniform(3, 400), 2)
        recu = round(envoye * 1.08, 2) if conversion else envoye
        frais = round(hasard.uniform(0.2, 2), 2) if conversion else 0.0
        lignes.append((
            f"TRANSFER-{1000 + i}",
            hasard.choice(["COMPLETED", "COMPLETED", "CANCELLED"]),
            hasard.choice(["OUT", "OUT", "IN", "NEUTRAL"]),
            f"2025-03-{(i % 28) + 1:02d} 10:12:00",
            f"2025-03-{(i % 28) + 1:02d} 10:13:00",
            f"{frais:.2f}", "EUR", f"{frais:.2f}", "USD" if conversion else "EUR",
            "Moi", f"{envoye:.2f}", "EUR",
            hasard.choice(["Carrefour", "SNCF", "Amazon"]),
            f"{recu:.2f}", "USD" if conversion else "EUR",
            "1.08" if conversion else "1.0", f"ref {i}",
        ))
    return lignes


def _config(resultat) -> dict:
    return {c["propriete"]: c["index"] for c in resultat["configuration"]}


def _colonne(resultat, index):
    return next(c for c in resultat["colonnes"] if c["index"] == index)


def test_direction_et_status_sont_proposes_avec_assurance():
    resultat = detecter_colonnes(_releve_wise())
    config = _config(resultat)
    assert config["sens"] == 3
    assert config["statut"] == 2
    assert _colonne(resultat, 3)["forte"] and _colonne(resultat, 2)["forte"]


def test_la_source_fee_currency_est_la_monnaie_des_frais():
    config = _config(detecter_colonnes(_releve_wise()))
    assert config["monnaie_frais"] == 7
    assert config["monnaie_initiale"] == 12
    assert config["monnaie"] == 15


def test_source_amount_et_target_amount_sont_l_envoye_et_le_recu():
    resultat = detecter_colonnes(_releve_wise())
    config = _config(resultat)
    assert config["montant_initial"] == 11
    assert config["montant"] == 14
    assert _colonne(resultat, 11)["forte"] and _colonne(resultat, 14)["forte"]


def test_l_envoye_et_le_recu_se_reconnaissent_aux_devises_sans_intitules():
    """Sans aucun intitulé, deux montants égaux sauf là où deux devises diffèrent suffisent."""
    resultat = detecter_colonnes(_releve_wise(avec_entetes=False))
    config = _config(resultat)
    assert config["montant_initial"] == 11
    assert config["montant"] == 14
    assert config["monnaie_initiale"] == 12
    assert config["monnaie"] == 15
    assert _colonne(resultat, 11)["forte"] and _colonne(resultat, 14)["forte"]


def test_debit_et_credit_ne_sont_jamais_proposes_pour_deux_montants_toujours_remplis():
    resultat = detecter_colonnes(_releve_wise())
    for index in (11, 14):
        proposees = [p["propriete"] for p in _colonne(resultat, index)["propositions"]]
        assert "montant_debit" not in proposees
        assert "montant_credit" not in proposees


def test_un_vrai_couple_debit_credit_reste_reconnu():
    lignes = [
        ("Date", "Libellé", "Débit", "Crédit"),
        ("02/09/2026", "CARREFOUR MARKET", "45,20", ""),
        ("05/09/2026", "SALAIRE SEPTEMBRE", "", "2 150,00"),
        ("07/09/2026", "ESSENCE", "62,00", ""),
    ]
    config = _config(detecter_colonnes(lignes))
    assert config["montant_debit"] == 3 and config["montant_credit"] == 4


def test_type_ne_devient_pas_un_sens_sur_sa_seule_poignee_de_valeurs():
    """Un « Type » de trois valeurs (moyen de paiement) n'est pas un sens."""
    lignes = [
        ("Date", "Libellé", "Type", "Montant"),
        ("02/09/2026", "CARREFOUR", "CARD", "-45,20"),
        ("03/09/2026", "SNCF", "CARD", "-62,00"),
        ("05/09/2026", "SALAIRE", "TRANSFER", "2150,00"),
        ("07/09/2026", "RETRAIT", "ATM", "-20,00"),
        ("08/09/2026", "AMAZON", "CARD", "-12,00"),
    ]
    assert "sens" not in _config(detecter_colonnes(lignes))


def test_les_valeurs_de_la_colonne_sont_rendues_avec_leur_proposition():
    resultat = detecter_colonnes(_releve_wise())
    sens = {v["valeur"]: v for v in _colonne(resultat, 3)["valeurs"]}
    assert set(sens) == {"OUT", "IN", "NEUTRAL"}
    assert sens["OUT"]["sens"] == "sortie"
    assert sens["IN"]["sens"] == "entree"
    # Ce que l'application ne sait pas ne reçoit aucune proposition.
    assert sens["NEUTRAL"]["sens"] is None
    statut = {v["valeur"]: v for v in _colonne(resultat, 2)["valeurs"]}
    assert statut["COMPLETED"]["statut"] == "execute"
    assert statut["CANCELLED"]["statut"] == "refuse"
    assert sum(v["nombre"] for v in sens.values()) == 60


def test_une_colonne_de_libelles_n_offre_pas_ses_valeurs():
    resultat = detecter_colonnes(_releve_wise())
    assert _colonne(resultat, 1)["valeurs"] is None  # les identifiants, tous différents


# ---------- Les mots-clés posés à l'écran servent à la lecture ----------


def _classeur(lignes):
    classeur = openpyxl.Workbook()
    feuille = classeur.active
    for ligne in lignes:
        feuille.append(ligne)
    tampon = io.BytesIO()
    classeur.save(tampon)
    return tampon.getvalue()


COLONNES = [
    {"index": 1, "propriete": "date"},
    {"index": 2, "propriete": "nature"},
    {"index": 3, "propriete": "montant"},
    {"index": 4, "propriete": "sens"},
]
CONTENU = _classeur(
    [
        [date(2026, 7, 1), "Courses", 45.2, "OUT"],
        [date(2026, 7, 2), "Salaire", 1500.0, "IN"],
    ]
)


def test_des_mots_cles_non_enregistres_lisent_le_fichier(db_session):
    compte = creer_compte(db_session, "Courant")
    preset = crud.create_import_preset(db_session, "Wise", COLONNES, [], lignes_entete=0)

    sans = import_bancaire.previsualiser(db_session, preset.id, CONTENU, compte_id_defaut=compte.id)
    assert all(l.erreur for l in sans.lignes)

    essai = import_bancaire.EssaiColonnes(
        COLONNES,
        vocabulaires={"libelles_sens_sortie": ["OUT"], "libelles_sens_entree": ["IN"]},
    )
    avec = import_bancaire.previsualiser(
        db_session, preset.id, CONTENU, compte_id_defaut=compte.id, colonnes=essai
    )
    assert [l.erreur for l in avec.lignes] == [None, None]
    assert [l.montant_signe for l in avec.lignes] == [-45.2, 1500.0]
    # Rien n'est écrit sur le preset.
    db_session.refresh(preset)
    assert not preset.libelles_sens_sortie and not preset.libelles_sens_entree


def test_la_route_nettoie_les_mots_cles_de_l_essai():
    colonnes = (
        '{"colonnes": [{"index": 1, "propriete": "date"}], '
        '"libelles_sens_sortie": [" OUT ", "out"], "libelles_sens_entree": ["IN"]}'
    )
    essai = routeur._valider_colonnes_essai(colonnes)
    assert essai.vocabulaires["libelles_sens_sortie"] == ["OUT"]
    assert essai.vocabulaires["libelles_sens_entree"] == ["IN"]
    assert essai.vocabulaires["libelles_statut_execute"] == []


def test_sans_mots_cles_dans_l_essai_le_preset_decide():
    essai = routeur._valider_colonnes_essai('{"colonnes": [{"index": 1, "propriete": "date"}]}')
    assert essai.vocabulaires is None
