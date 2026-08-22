"""Configuration avancée d'un preset d'import : devises multiples, montant
initial et frais.

Ce que ces tests verrouillent, c'est le cas qui a motivé la fonctionnalité : un
relevé de type Wise n'écrit nulle part « le montant de l'opération ». Il donne
un montant de départ, des frais, un montant d'arrivée, chacun dans sa propre
devise. L'app, qui ne connaît aucun taux de change, ne doit jamais en inventer
un — et la seule combinaison qu'elle s'autorise (les frais rapportés à l'un des
deux montants) n'est possible que parce que les devises sont lues.

DEUX MONTANTS. `montant` (obligatoire) est ce qui ARRIVE ; `montant_envoye`,
quand le preset le lit, est ce qui PART, avant frais et avant conversion. Sur un
virement interne, l'initial est la jambe émettrice.
"""
import io
from datetime import date

import openpyxl
import pytest
from fastapi import HTTPException

from app import crud, models, schemas
from app.routers import import_bancaire as routeur_import
from app.services import import_bancaire

from .conftest import creer_compte, creer_monnaie, get_categorie_id, get_monnaie_id


# ---------- Validation à l'enregistrement du preset ----------


def _payload_preset(**overrides):
    base = {
        "nom": "Wise",
        "colonnes": [
            {"index": 1, "propriete": "date"},
            {"index": 2, "propriete": "nature"},
            {"index": 3, "propriete": "montant"},
        ],
    }
    base.update(overrides)
    return schemas.ImportPresetCreate(**base)


def test_les_proprietes_avancees_sont_des_colonnes_comme_les_autres(db_session):
    """Elles ne sont séparées que dans l'interface : en base, elles vivent dans
    le même `colonnes` et passent la même validation."""
    preset = routeur_import.create_preset(
        _payload_preset(
            colonnes=[
                {"index": 1, "propriete": "date"},
                {"index": 2, "propriete": "nature"},
                {"index": 3, "propriete": "montant"},
                {"index": 4, "propriete": "monnaie"},
                {"index": 5, "propriete": "frais"},
                {"index": 6, "propriete": "monnaie_frais"},
                {"index": 7, "propriete": "montant_initial"},
                {"index": 8, "propriete": "monnaie_initiale"},
            ],
        ),
        db_session,
    )

    assert {c["propriete"] for c in preset.colonnes} >= {
        "frais",
        "monnaie_frais",
        "montant_initial",
        "monnaie_initiale",
    }


def test_montant_reste_obligatoire(db_session):
    """Plus aucune formule ne peut le remplacer, et le montant initial ne s'y
    substitue pas : sans colonne de montant, il n'y a rien à importer."""
    with pytest.raises(HTTPException) as erreur:
        routeur_import.create_preset(
            _payload_preset(
                colonnes=[
                    {"index": 1, "propriete": "date"},
                    {"index": 2, "propriete": "nature"},
                    {"index": 7, "propriete": "montant_initial"},
                ]
            ),
            db_session,
        )

    assert erreur.value.status_code == 400
    assert "montant" in erreur.value.detail


def test_une_propriete_ne_peut_pas_etre_lue_deux_fois(db_session):
    with pytest.raises(HTTPException) as erreur:
        routeur_import.create_preset(
            _payload_preset(
                colonnes=[
                    {"index": 1, "propriete": "date"},
                    {"index": 2, "propriete": "nature"},
                    {"index": 3, "propriete": "montant"},
                    {"index": 5, "propriete": "frais"},
                    {"index": 6, "propriete": "frais"},
                ]
            ),
            db_session,
        )

    assert erreur.value.status_code == 400


# ---------- Import multi-devises ----------

# Format inspiré d'un export Wise :
# 1 date | 2 libellé | 3 montant (ce qui ARRIVE) | 4 devise du montant
# 5 frais | 6 devise des frais | 7 montant initial (ce qui PART)
# 8 devise initiale | 9 compte | 10 sens
_COLONNES_WISE = [
    {"index": 1, "propriete": "date"},
    {"index": 2, "propriete": "nature"},
    {"index": 3, "propriete": "montant"},
    {"index": 4, "propriete": "monnaie"},
    {"index": 5, "propriete": "frais"},
    {"index": 6, "propriete": "monnaie_frais"},
    {"index": 7, "propriete": "montant_initial"},
    {"index": 8, "propriete": "monnaie_initiale"},
    {"index": 9, "propriete": "compte_banque"},
]

# Le même, plus la colonne « Sens ». Les deux montants ne disent rien du sens :
# un compte multi-devises émet ET reçoit des virements entre monnaies, et
# `montant` (ce qui arrive) est positif dans les deux cas. C'est cette colonne
# qui tranche — d'où sa présence dès qu'un virement est en jeu.
_COLONNES_WISE_SENS = _COLONNES_WISE + [{"index": 10, "propriete": "sens"}]

# Un preset ordinaire, qui ne décrit qu'un montant : sert aux cas où la notion
# de montant initial n'a rien à faire.
_COLONNES_SIMPLES = [
    {"index": 1, "propriete": "date"},
    {"index": 2, "propriete": "nature"},
    {"index": 3, "propriete": "montant"},
    {"index": 4, "propriete": "monnaie"},
    {"index": 5, "propriete": "frais"},
    {"index": 6, "propriete": "monnaie_frais"},
    {"index": 9, "propriete": "compte_banque"},
]


def _fichier_wise(lignes: list[list]) -> bytes:
    classeur = openpyxl.Workbook()
    feuille = classeur.active
    for ligne in lignes:
        feuille.append(ligne)
    tampon = io.BytesIO()
    classeur.save(tampon)
    return tampon.getvalue()


def _preset_wise(db, nom="Wise", colonnes=None, devises=True):
    """Un preset Wise, et — sauf `devises=False` — les correspondances de devise
    que l'utilisateur aurait rattachées à la main au premier import.

    Rien n'est jamais rattaché tout seul (cf. import_bancaire._resoudre_monnaie),
    pas même un libellé identique au nom d'une monnaie de l'app : les tests qui
    portent sur les frais ou les virements ont donc besoin de ces
    correspondances pour arriver jusqu'à leur sujet. Seuls les libellés
    étrangers aux monnaies existantes (« USD », « XYZ ») restent inconnus, ce
    qui est précisément ce que testent les tests de rattachement."""
    preset = crud.create_import_preset(
        db,
        nom,
        colonnes if colonnes is not None else _COLONNES_WISE,
        [],
        ignorer_premiere_ligne=False,
    )
    if devises:
        for monnaie in crud.get_monnaies(db):
            crud.set_mapping_monnaie(db, preset.id, monnaie.nom, monnaie.id)
            crud.set_mapping_monnaie(db, preset.id, monnaie.symbole, monnaie.id)
    return preset


def _regle_virement(db, nom="Transferts"):
    """Seule une règle peut poser le type d'une ligne importée (cf.
    services/import_bancaire) : les tests de virement en ont besoin."""
    return crud.create_regle_categorisation(
        db,
        nom=nom,
        type_id=db.query(models.TypeOperationDB)
        .filter(models.TypeOperationDB.code == "virement")
        .one()
        .id,
        categorie_id=None,
        conditions={
            "operateur": "ET",
            "groupes": [
                {
                    "operateur": "ET",
                    "conditions": [
                        {"champ": "nature", "operateur": "contient", "valeur": "Transfert"}
                    ],
                }
            ],
        },
    )


def test_devise_identique_au_nom_dune_monnaie_nest_pas_rattachee_toute_seule(db_session):
    """Un libellé qui ressemble à une monnaie de l'app n'est pas un
    rattachement voulu.

    Le déduire du nom ou du symbole libellait des lignes dans une monnaie que
    personne n'avait choisie, et laissait « € » et « euro » se comporter
    autrement que « EUR » sans que rien ne l'explique. C'est l'utilisateur qui
    rattache, une fois — ensuite la correspondance est mémorisée."""
    euro = get_monnaie_id(db_session)
    creer_compte(db_session, "Wise", monnaies=[(euro, 0.0)])
    preset = _preset_wise(db_session, devises=False)
    contenu = _fichier_wise(
        [
            [date(2026, 7, 1), "Courses", -45.2, "€", None, None, None, None, "Wise"],
            [date(2026, 7, 2), "Essence", -60.0, "Euro", None, None, None, None, "Wise"],
        ]
    )

    preview = import_bancaire.previsualiser(db_session, preset.id, contenu)

    assert [l.monnaie_id for l in preview.lignes] == [None, None]
    assert preview.monnaies_inconnues == ["Euro", "€"]

    # Rattachées une fois, elles ne se redemandent plus.
    crud.set_mapping_monnaie(db_session, preset.id, "€", euro)
    crud.set_mapping_monnaie(db_session, preset.id, "Euro", euro)
    preview = import_bancaire.previsualiser(db_session, preset.id, contenu)

    assert [l.monnaie_id for l in preview.lignes] == [euro, euro]
    assert preview.monnaies_inconnues == []


def test_devise_inconnue_est_signalee_puis_memorisee(db_session):
    """Même mécanique que pour les catégories et les comptes : l'utilisateur
    tranche une fois, l'app se souvient."""
    euro = get_monnaie_id(db_session)
    dollar = creer_monnaie(db_session, "Dollar", "$").id
    compte = creer_compte(db_session, "Wise", monnaies=[(dollar, 0.0), (euro, 0.0)])
    preset = _preset_wise(db_session)
    contenu = _fichier_wise(
        [[date(2026, 7, 1), "Courses", -45.2, "USD", None, None, None, None, "Wise"]]
    )

    preview = import_bancaire.previsualiser(db_session, preset.id, contenu)
    assert preview.monnaies_inconnues == ["USD"]
    assert preview.lignes[0].monnaie_id is None

    import_bancaire.confirmer(
        db_session,
        preset.id,
        contenu,
        schemas.ImportMappingOverrides(
            comptes={"Wise": compte.id}, monnaies={"USD": dollar}
        ),
    )

    operation = db_session.query(models.Operation).one()
    assert operation.monnaie_id == dollar
    # Mémorisée : le prochain import ne la redemande plus.
    assert crud.get_mapping_monnaie(db_session, preset.id, "USD") == dollar


def test_les_trois_colonnes_de_devise_partagent_les_correspondances(db_session):
    """Un relevé écrit « USD » de la même façon qu'il qualifie le montant, le
    montant initial ou les frais : une correspondance mémorisée les rattache
    toutes les trois."""
    euro = get_monnaie_id(db_session)
    dollar = creer_monnaie(db_session, "Dollar", "$").id
    creer_compte(db_session, "Wise", monnaies=[(euro, 0.0), (dollar, 0.0)])
    preset = _preset_wise(db_session)
    crud.set_mapping_monnaie(db_session, preset.id, "USD", dollar)
    contenu = _fichier_wise(
        [
            [
                date(2026, 7, 1),
                "Transfert",
                108.0,
                "USD",
                2.0,
                "Euro",
                100.0,
                "Euro",
                "Wise",
            ]
        ]
    )

    ligne = import_bancaire.previsualiser(db_session, preset.id, contenu).lignes[0]

    assert (ligne.monnaie_id, ligne.monnaie_frais_id, ligne.monnaie_envoyee_id) == (
        dollar,
        euro,
        euro,
    )


def test_ligne_dont_la_devise_reste_non_resolue_est_ignoree(db_session):
    """Elle serait sinon libellée silencieusement dans la monnaie principale du
    compte, c'est-à-dire dans la mauvaise."""
    euro = get_monnaie_id(db_session)
    compte = creer_compte(db_session, "Wise", monnaies=[(euro, 0.0)])
    preset = _preset_wise(db_session)
    contenu = _fichier_wise(
        [[date(2026, 7, 1), "Courses", -45.2, "USD", None, None, None, None, "Wise"]]
    )

    resultat = import_bancaire.confirmer(
        db_session,
        preset.id,
        contenu,
        schemas.ImportMappingOverrides(comptes={"Wise": compte.id}),
    )

    assert resultat.operations_creees == 0
    assert "USD" in resultat.lignes_ignorees[0].erreur


# ---------- Frais ----------


def test_les_frais_sajoutent_au_montant_envoye_dans_leur_monnaie(db_session):
    """Ce qui est parti coûte plus que ce qui était annoncé : 100 € envoyés
    plus 2 € de frais font 102 € réellement débités. Le montant, lui, ne bouge
    pas — les frais n'ont pas été prélevés de ce côté-là.

    Sur un VIREMENT : c'est le seul type où les deux montants comptent tous les
    deux, chacun sur sa jambe."""
    euro = get_monnaie_id(db_session)
    dollar = creer_monnaie(db_session, "Dollar", "$").id
    creer_compte(db_session, "Wise", monnaies=[(euro, 1000.0), (dollar, 0.0)])
    _regle_virement(db_session)
    preset = _preset_wise(db_session)
    contenu = _fichier_wise(
        [
            [
                date(2026, 7, 1),
                "Transfert",
                108.0,
                "Dollar",
                2.0,
                "Euro",
                100.0,
                "Euro",
                "Wise",
            ]
        ]
    )

    ligne = import_bancaire.previsualiser(db_session, preset.id, contenu).lignes[0]

    assert ligne.montant_envoye == 102.0
    assert ligne.montant == 108.0
    assert ligne.frais == 2.0


def test_les_frais_se_retranchent_du_montant_dans_leur_monnaie(db_session):
    """L'autre côté : une commission prélevée à l'arrivée ampute ce qui reste.
    108 $ annoncés, 3 $ de frais, 105 $ réellement là."""
    euro = get_monnaie_id(db_session)
    dollar = creer_monnaie(db_session, "Dollar", "$").id
    compte = creer_compte(db_session, "Wise", monnaies=[(euro, 1000.0), (dollar, 0.0)])
    _regle_virement(db_session)
    preset = _preset_wise(db_session)
    contenu = _fichier_wise(
        [
            [
                date(2026, 7, 1),
                "Transfert EUR vers USD",
                108.0,
                "Dollar",
                3.0,
                "Dollar",
                100.0,
                "Euro",
                "Wise",
            ]
        ]
    )

    ligne = import_bancaire.previsualiser(db_session, preset.id, contenu).lignes[0]
    assert ligne.montant == 105.0
    assert ligne.montant_envoye == 100.0

    resultat = import_bancaire.confirmer(
        db_session,
        preset.id,
        contenu,
        schemas.ImportMappingOverrides(
            comptes={"Wise": compte.id},
            lignes={1: schemas.ImportLigneOverride(compte_id_autre=compte.id)},
        ),
    )

    assert resultat.operations_creees == 2
    entrante = db_session.query(models.Operation).filter_by(sens="transfert_entrant").one()
    assert (entrante.montant, entrante.monnaie_id) == (105.0, dollar)


def test_frais_sans_colonne_de_devise_rejoignent_le_montant_envoye(db_session):
    """Sans devise lue, il n'y a rien à comparer : les frais retombent sur le
    comportement par défaut — l'émission, prioritaire sur un virement — et
    l'ambiguïté est signalée par un avertissement plutôt que de bloquer un cas
    parfaitement courant."""
    euro = get_monnaie_id(db_session)
    creer_compte(db_session, "Wise", monnaies=[(euro, 1000.0)])
    _regle_virement(db_session)
    preset = _preset_wise(
        db_session,
        colonnes=[
            {"index": 1, "propriete": "date"},
            {"index": 2, "propriete": "nature"},
            {"index": 3, "propriete": "montant"},
            {"index": 5, "propriete": "frais"},
            {"index": 7, "propriete": "montant_initial"},
            {"index": 9, "propriete": "compte_banque"},
        ],
    )
    contenu = _fichier_wise(
        [[date(2026, 7, 1), "Transfert", 108.0, None, 2.0, None, 100.0, None, "Wise"]]
    )

    preview = import_bancaire.previsualiser(db_session, preset.id, contenu)

    assert preview.lignes[0].montant_envoye == 102.0
    assert preview.lignes[0].montant == 108.0
    assert any("frais" in a.lower() for a in preview.avertissements)


def test_sans_montant_envoye_les_frais_suivent_le_sens(db_session):
    """La règle générale, sur le cas le plus simple : un preset ordinaire n'a
    qu'un montant, et les frais font toujours perdre de la valeur. Sur une
    sortie ils s'ajoutent (le compte est débité de plus), sur une entrée ils se
    retranchent (il arrive moins)."""
    euro = get_monnaie_id(db_session)
    creer_compte(db_session, "Wise", monnaies=[(euro, 1000.0)])
    preset = _preset_wise(db_session, colonnes=_COLONNES_SIMPLES)
    contenu = _fichier_wise(
        [
            [date(2026, 7, 1), "Abonnement", -100.0, "Euro", 1.5, "Euro", None, None, "Wise"],
            [date(2026, 7, 2), "Remboursement", 200.0, "Euro", 5.0, "Euro", None, None, "Wise"],
        ]
    )

    lignes = import_bancaire.previsualiser(db_session, preset.id, contenu).lignes

    assert [l.montant for l in lignes] == [101.5, 195.0]
    # Le montant SIGNÉ reste celui du fichier : il n'oriente que le sens, et ne
    # suit jamais l'imputation des frais.
    assert [l.montant_signe for l in lignes] == [-100.0, 200.0]


def test_une_devise_de_frais_non_resolue_nest_pas_prise_pour_un_accord(db_session):
    """C'était le défaut de la version précédente : une devise inconnue faisait
    passer la comparaison pour concluante et les frais étaient ajoutés sans
    qu'aucune vérification n'ait eu lieu."""
    euro = get_monnaie_id(db_session)
    creer_compte(db_session, "Wise", monnaies=[(euro, 1000.0)])
    preset = _preset_wise(db_session)
    contenu = _fichier_wise(
        [
            [
                date(2026, 7, 1),
                "Transfert",
                108.0,
                "Euro",
                2.0,
                "XYZ",
                100.0,
                "Euro",
                "Wise",
            ]
        ]
    )

    ligne = import_bancaire.previsualiser(db_session, preset.id, contenu).lignes[0]

    # Aucun des deux montants n'a bougé, et la devise inconnue est signalée.
    assert (ligne.montant, ligne.montant_envoye) == (108.0, 100.0)
    assert "XYZ" in import_bancaire.previsualiser(
        db_session, preset.id, contenu
    ).monnaies_inconnues


def test_une_cellule_de_devise_de_frais_vide_est_une_erreur(db_session):
    """Le format annonce la colonne, la ligne porte des frais, et la cellule ne
    dit pas dans quoi ils sont : rien ne permet de le supposer. C'était le
    dernier chemin par lequel des frais pouvaient être rapportés à un montant
    sans la moindre vérification."""
    euro = get_monnaie_id(db_session)
    creer_compte(db_session, "Wise", monnaies=[(euro, 1000.0)])
    preset = _preset_wise(db_session)
    contenu = _fichier_wise(
        [[date(2026, 7, 1), "Transfert", 108.0, "Euro", 2.0, None, 100.0, "Euro", "Wise"]]
    )

    ligne = import_bancaire.previsualiser(db_session, preset.id, contenu).lignes[0]

    assert "monnaie des frais manquante" in ligne.erreur


def test_une_cellule_de_devise_de_frais_vide_sans_frais_ne_gene_pas(db_session):
    """La plupart des lignes d'un relevé n'ont aucun frais : leur colonne de
    devise est vide, et c'est parfaitement normal."""
    euro = get_monnaie_id(db_session)
    creer_compte(db_session, "Wise", monnaies=[(euro, 1000.0)])
    preset = _preset_wise(db_session)
    contenu = _fichier_wise(
        [[date(2026, 7, 1), "Achat", -45.2, "Euro", None, None, None, None, "Wise"]]
    )

    assert import_bancaire.previsualiser(db_session, preset.id, contenu).lignes[0].erreur is None


def test_frais_dans_une_troisieme_monnaie_bloquent_tout_limport(db_session):
    """Aucun des deux montants ne peut les porter : les additionner fausserait
    un solde sans que rien ne le signale. On refuse le fichier entier plutôt
    que de laisser un import à moitié fait."""
    euro = get_monnaie_id(db_session)
    dollar = creer_monnaie(db_session, "Dollar", "$").id
    livre = creer_monnaie(db_session, "Livre", "£").id
    compte = creer_compte(
        db_session, "Wise", monnaies=[(euro, 1000.0), (dollar, 0.0), (livre, 0.0)]
    )
    preset = _preset_wise(db_session)
    contenu = _fichier_wise(
        [
            [
                date(2026, 7, 1),
                "Transfert",
                108.0,
                "Dollar",
                2.0,
                "Livre",
                100.0,
                "Euro",
                "Wise",
            ],
            [date(2026, 7, 2), "Courses", -20.0, "Euro", None, None, None, None, "Wise"],
        ]
    )

    ligne = import_bancaire.previsualiser(db_session, preset.id, contenu).lignes[0]
    assert ligne.frais_incoherents is True

    with pytest.raises(import_bancaire.ImportBloque) as erreur:
        import_bancaire.confirmer(
            db_session,
            preset.id,
            contenu,
            schemas.ImportMappingOverrides(
                comptes={"Wise": compte.id},
                categories={"": get_categorie_id(db_session, "Autres")},
            ),
        )

    assert "Frais" in str(erreur.value)
    # Rien n'a été créé, pas même la seconde ligne qui, elle, était valide.
    assert db_session.query(models.Operation).count() == 0


def test_frais_superieurs_a_un_montant_entrant_mettent_la_ligne_en_erreur(db_session):
    """Seule une ENTRÉE peut être entamée jusqu'à disparaître : sur une sortie,
    les frais s'ajoutent et il n'y a rien à épuiser."""
    euro = get_monnaie_id(db_session)
    creer_compte(db_session, "Wise", monnaies=[(euro, 1000.0)])
    preset = _preset_wise(db_session, colonnes=_COLONNES_SIMPLES)
    contenu = _fichier_wise(
        [[date(2026, 7, 1), "Remboursement", 10.0, "Euro", 200.0, "Euro", None, None, "Wise"]]
    )

    ligne = import_bancaire.previsualiser(db_session, preset.id, contenu).lignes[0]

    assert "frais supérieurs au montant" in ligne.erreur
    # Ce n'est PAS un problème de configuration : l'import n'est pas bloqué en
    # bloc, seule cette ligne est refusée.
    assert ligne.frais_incoherents is False


# ---------- Opérations à un seul compte, avec montant initial ----------


def test_une_sortie_a_un_seul_compte_porte_le_montant_envoye(db_session):
    """Un paiement par carte à l'étranger : 85 € quittent le compte, 12 000 JPY
    arrivent chez le commerçant. Seul le premier concerne le compte — plus les
    frais, qui font que la sortie coûte davantage. Le montant d'arrivée ne
    décrit que la contrepartie et n'est pas importé."""
    euro = get_monnaie_id(db_session)
    yen = creer_monnaie(db_session, "Yen", "¥").id
    creer_compte(db_session, "Wise", monnaies=[(euro, 1000.0)])
    preset = _preset_wise(db_session, colonnes=_COLONNES_WISE_SENS)
    contenu = _fichier_wise(
        [
            [date(2026, 7, 1), "Restaurant", 12000.0, "Yen", 1.5, "Euro", 85.0, "Euro",
             "Wise", "Débit"]
        ]
    )

    ligne = import_bancaire.previsualiser(db_session, preset.id, contenu).lignes[0]

    assert ligne.montant == 86.5
    assert ligne.monnaie_operation_id == euro
    # Le montant d'arrivée ne fait pas l'opération : il n'a rien à porter ici.
    assert ligne.montant_envoye is None
    assert yen != euro


def test_une_entree_a_un_seul_compte_porte_le_montant(db_session):
    """Le symétrique : de l'argent arrive, les frais l'entament."""
    euro = get_monnaie_id(db_session)
    creer_compte(db_session, "Wise", monnaies=[(euro, 0.0)])
    preset = _preset_wise(db_session, colonnes=_COLONNES_WISE_SENS)
    contenu = _fichier_wise(
        [
            [date(2026, 7, 1), "Paiement client", 200.0, "Euro", 5.0, "Euro", 210.0, "Euro",
             "Wise", "Crédit"]
        ]
    )

    ligne = import_bancaire.previsualiser(db_session, preset.id, contenu).lignes[0]

    assert ligne.montant == 195.0
    assert ligne.monnaie_operation_id == euro
    assert ligne.montant_envoye is None


def test_le_montant_de_loperation_est_celui_importe(db_session):
    """La vérification qui compte vraiment : ce que l'aperçu annonce est ce qui
    se retrouve en base, monnaie comprise."""
    euro = get_monnaie_id(db_session)
    yen = creer_monnaie(db_session, "Yen", "¥").id
    compte = creer_compte(db_session, "Wise", monnaies=[(euro, 1000.0)])
    preset = _preset_wise(db_session, colonnes=_COLONNES_WISE_SENS)
    contenu = _fichier_wise(
        [
            [date(2026, 7, 1), "Restaurant", 12000.0, "Yen", 1.5, "Euro", 85.0, "Euro",
             "Wise", "Débit"]
        ]
    )

    import_bancaire.confirmer(
        db_session,
        preset.id,
        contenu,
        schemas.ImportMappingOverrides(
            comptes={"Wise": compte.id},
            categories={"": get_categorie_id(db_session, "Autres")},
        ),
    )

    operation = db_session.query(models.Operation).one()
    assert (operation.montant, operation.monnaie_id) == (86.5, euro)
    assert yen != euro


# ---------- Recalcul dynamique ----------


def test_repasser_un_virement_en_operation_classique_recalcule_les_montants(db_session):
    """La règle demandée : changer le type dans l'aperçu change la jambe qui
    compte, donc le montant importé. Sans ce recalcul, la ligne garderait le
    montant du virement — 108 $ reçus — pour une opération qui décrit en réalité
    une sortie de 102 €."""
    euro = get_monnaie_id(db_session)
    dollar = creer_monnaie(db_session, "Dollar", "$").id
    compte = creer_compte(db_session, "Wise", monnaies=[(euro, 1000.0), (dollar, 0.0)])
    _regle_virement(db_session)
    preset = _preset_wise(db_session, colonnes=_COLONNES_WISE_SENS)
    contenu = _fichier_wise(
        [
            [date(2026, 7, 1), "Transfert", 108.0, "Dollar", 2.0, "Euro", 100.0, "Euro",
             "Wise", "Débit"]
        ]
    )

    # Tel que lu : un virement, les frais sur la jambe émettrice.
    ligne = import_bancaire.previsualiser(db_session, preset.id, contenu).lignes[0]
    assert (ligne.type_code, ligne.montant, ligne.montant_envoye) == ("virement", 108.0, 102.0)

    # Reclassée en opération classique : elle sort, donc c'est le montant
    # initial (frais compris) qui devient le montant de l'opération.
    import_bancaire.confirmer(
        db_session,
        preset.id,
        contenu,
        schemas.ImportMappingOverrides(
            comptes={"Wise": compte.id},
            categories={"": get_categorie_id(db_session, "Autres")},
            lignes={
                1: schemas.ImportLigneOverride(
                    type_code="classique",
                    categorie_id=get_categorie_id(db_session, "Autres"),
                )
            },
        ),
    )

    operation = db_session.query(models.Operation).one()
    assert (operation.montant, operation.monnaie_id) == (102.0, euro)


def test_passer_une_operation_classique_en_virement_recalcule_les_montants(db_session):
    """Le chemin inverse : une ligne lue comme classique et reclassée en
    virement retrouve ses deux jambes."""
    euro = get_monnaie_id(db_session)
    dollar = creer_monnaie(db_session, "Dollar", "$").id
    compte = creer_compte(db_session, "Wise", monnaies=[(euro, 1000.0), (dollar, 0.0)])
    autre = creer_compte(db_session, "Autre", monnaies=[(dollar, 0.0)])
    preset = _preset_wise(db_session, colonnes=_COLONNES_WISE_SENS)
    contenu = _fichier_wise(
        [
            [date(2026, 7, 1), "Envoi", 108.0, "Dollar", 2.0, "Euro", 100.0, "Euro",
             "Wise", "Débit"]
        ]
    )

    # Aucune règle : la ligne est classique, donc une sortie de 102 €.
    ligne = import_bancaire.previsualiser(db_session, preset.id, contenu).lignes[0]
    assert (ligne.type_code, ligne.montant, ligne.montant_envoye) == ("classique", 102.0, None)

    resultat = import_bancaire.confirmer(
        db_session,
        preset.id,
        contenu,
        schemas.ImportMappingOverrides(
            comptes={"Wise": compte.id},
            lignes={
                1: schemas.ImportLigneOverride(
                    type_code="virement", compte_id_autre=autre.id
                )
            },
        ),
    )

    assert resultat.operations_creees == 2
    sortante = db_session.query(models.Operation).filter_by(sens="transfert_sortant").one()
    entrante = db_session.query(models.Operation).filter_by(sens="transfert_entrant").one()
    assert (sortante.montant, sortante.monnaie_id) == (102.0, euro)
    assert (entrante.montant, entrante.monnaie_id) == (108.0, dollar)


def test_le_montant_envoye_saisi_survit_a_un_changement_de_type(db_session):
    """Le relevé ne porte AUCUNE colonne « Montant initial » : c'est
    l'utilisateur qui dit ce qui est parti, dans l'aperçu, en même temps qu'il
    reclasse la ligne en virement. Sa saisie doit devenir la nouvelle base de
    calcul.

    Sans cela, la réimputation déclenchée par le changement de type repartait des
    montants du FICHIER — qui n'en donne qu'un — et effaçait la jambe émettrice
    qu'on venait de lui demander : le virement perdait sa seconde devise, et
    l'import le refusait faute de montant envoyé."""
    euro = get_monnaie_id(db_session)
    dollar = creer_monnaie(db_session, "Dollar", "$").id
    compte = creer_compte(db_session, "Wise", monnaies=[(euro, 1000.0)])
    autre = creer_compte(db_session, "Autre", monnaies=[(dollar, 0.0)])
    preset = _preset_wise(db_session, colonnes=_COLONNES_SIMPLES)
    contenu = _fichier_wise(
        [[date(2026, 7, 1), "Envoi", -100.0, "Euro", None, None, None, None, "Wise"]]
    )

    resultat = import_bancaire.confirmer(
        db_session,
        preset.id,
        contenu,
        schemas.ImportMappingOverrides(
            comptes={"Wise": compte.id},
            lignes={
                1: schemas.ImportLigneOverride(
                    type_code="virement",
                    compte_id_autre=autre.id,
                    montant=108.0,
                    monnaie_id=dollar,
                    montant_envoye=100.0,
                    monnaie_envoyee_id=euro,
                )
            },
        ),
    )

    assert resultat.operations_creees == 2
    sortante = db_session.query(models.Operation).filter_by(sens="transfert_sortant").one()
    entrante = db_session.query(models.Operation).filter_by(sens="transfert_entrant").one()
    assert (sortante.montant, sortante.monnaie_id) == (100.0, euro)
    assert (entrante.montant, entrante.monnaie_id) == (108.0, dollar)


# ---------- Avertissements de configuration ----------


def test_montant_envoye_sans_sa_devise_declenche_un_avertissement(db_session):
    euro = get_monnaie_id(db_session)
    creer_compte(db_session, "Wise", monnaies=[(euro, 0.0)])
    preset = _preset_wise(
        db_session,
        colonnes=[
            {"index": 1, "propriete": "date"},
            {"index": 2, "propriete": "nature"},
            {"index": 3, "propriete": "montant"},
            {"index": 7, "propriete": "montant_initial"},
            {"index": 9, "propriete": "compte_banque"},
        ],
    )
    contenu = _fichier_wise(
        [[date(2026, 7, 1), "Transfert", 108.0, None, None, None, 100.0, None, "Wise"]]
    )

    preview = import_bancaire.previsualiser(db_session, preset.id, contenu)

    assert len(preview.avertissements) == 1
    # Le message nomme la colonne comme l'écran la nomme (« Montant envoyé » /
    # « Monnaie envoyée »), pas comme la clé persistée l'appelle encore.
    assert "montant envoyé" in preview.avertissements[0]
    assert "Monnaie envoyée" in preview.avertissements[0]


def test_aucun_avertissement_quand_chaque_montant_porte_sa_devise(db_session):
    euro = get_monnaie_id(db_session)
    creer_compte(db_session, "Wise", monnaies=[(euro, 0.0)])
    preset = _preset_wise(db_session)
    contenu = _fichier_wise(
        [[date(2026, 7, 1), "Courses", -45.2, "Euro", None, None, None, None, "Wise"]]
    )

    assert import_bancaire.previsualiser(db_session, preset.id, contenu).avertissements == []


# ---------- Virements entre deux devises ----------


def test_le_montant_envoye_est_la_jambe_emettrice(db_session):
    """100 € partent, 108 $ arrivent : les deux montants viennent du relevé,
    aucun taux n'est calculé nulle part. L'initial va sur l'émetteur, le
    montant sur le récepteur."""
    euro = get_monnaie_id(db_session)
    dollar = creer_monnaie(db_session, "Dollar", "$").id
    source = creer_compte(db_session, "Wise EUR", monnaies=[(euro, 1000.0)])
    destination = creer_compte(db_session, "Wise USD", monnaies=[(dollar, 0.0)])
    _regle_virement(db_session)
    preset = _preset_wise(db_session, colonnes=_COLONNES_WISE_SENS)
    contenu = _fichier_wise(
        [
            [
                date(2026, 7, 1),
                "Transfert vers USD",
                108.0,
                "Dollar",
                None,
                None,
                100.0,
                "Euro",
                "Wise EUR",
                "Débit",
            ]
        ]
    )

    resultat = import_bancaire.confirmer(
        db_session,
        preset.id,
        contenu,
        schemas.ImportMappingOverrides(
            comptes={"Wise EUR": source.id},
            lignes={1: schemas.ImportLigneOverride(compte_id_autre=destination.id)},
        ),
    )

    assert resultat.operations_creees == 2
    sortante = db_session.query(models.Operation).filter_by(sens="transfert_sortant").one()
    entrante = db_session.query(models.Operation).filter_by(sens="transfert_entrant").one()
    assert (sortante.montant, sortante.monnaie_id, sortante.compte_id) == (100.0, euro, source.id)
    assert (entrante.montant, entrante.monnaie_id, entrante.compte_id) == (
        108.0,
        dollar,
        destination.id,
    )


def test_un_compte_multidevises_peut_aussi_RECEVOIR_un_virement_entre_monnaies(db_session):
    """Le cas que l'ancienne règle rendait impossible : lire les deux montants
    ne veut pas dire que le compte du fichier émet. Ici il REÇOIT — même
    colonnes, sens inverse, et c'est la colonne « Sens » qui le dit."""
    euro = get_monnaie_id(db_session)
    dollar = creer_monnaie(db_session, "Dollar", "$").id
    recepteur = creer_compte(db_session, "Wise", monnaies=[(euro, 0.0), (dollar, 0.0)])
    emetteur = creer_compte(db_session, "Autre banque", monnaies=[(euro, 1000.0)])
    _regle_virement(db_session)
    preset = _preset_wise(db_session, colonnes=_COLONNES_WISE_SENS)
    contenu = _fichier_wise(
        [
            [
                date(2026, 7, 1),
                "Transfert reçu",
                108.0,
                "Dollar",
                None,
                None,
                100.0,
                "Euro",
                "Wise",
                "Crédit",
            ]
        ]
    )

    resultat = import_bancaire.confirmer(
        db_session,
        preset.id,
        contenu,
        schemas.ImportMappingOverrides(
            comptes={"Wise": recepteur.id},
            lignes={1: schemas.ImportLigneOverride(compte_id_autre=emetteur.id)},
        ),
    )

    assert resultat.operations_creees == 2
    sortante = db_session.query(models.Operation).filter_by(sens="transfert_sortant").one()
    entrante = db_session.query(models.Operation).filter_by(sens="transfert_entrant").one()
    # Le compte du fichier est bien le RÉCEPTEUR, et il reçoit les dollars.
    assert (entrante.compte_id, entrante.montant, entrante.monnaie_id) == (
        recepteur.id,
        108.0,
        dollar,
    )
    assert (sortante.compte_id, sortante.montant, sortante.monnaie_id) == (
        emetteur.id,
        100.0,
        euro,
    )


def test_conversion_entre_deux_monnaies_dun_meme_compte_est_importable(db_session):
    """Le cas Wise par excellence : convertir 100 € en 108 $ sans quitter le
    compte. Les deux écritures portent chacune sa monnaie, et les deux soldes
    du compte (jamais additionnés) bougent bien tous les deux."""
    euro = get_monnaie_id(db_session)
    dollar = creer_monnaie(db_session, "Dollar", "$").id
    compte = creer_compte(db_session, "Wise", monnaies=[(euro, 1000.0), (dollar, 0.0)])
    _regle_virement(db_session)
    preset = _preset_wise(db_session)
    contenu = _fichier_wise(
        [
            [
                date(2026, 7, 1),
                "Transfert interne EUR vers USD",
                108.0,
                "Dollar",
                None,
                None,
                100.0,
                "Euro",
                "Wise",
            ]
        ]
    )

    resultat = import_bancaire.confirmer(
        db_session,
        preset.id,
        contenu,
        schemas.ImportMappingOverrides(
            comptes={"Wise": compte.id},
            lignes={1: schemas.ImportLigneOverride(compte_id_autre=compte.id)},
        ),
    )

    assert resultat.operations_creees == 2
    sortante = db_session.query(models.Operation).filter_by(sens="transfert_sortant").one()
    entrante = db_session.query(models.Operation).filter_by(sens="transfert_entrant").one()
    assert sortante.compte_id == entrante.compte_id == compte.id
    assert (sortante.montant, sortante.monnaie_id) == (100.0, euro)
    assert (entrante.montant, entrante.monnaie_id) == (108.0, dollar)
    assert sortante.virement_id == entrante.virement_id


def test_virement_entre_deux_monnaies_sans_montant_envoye_est_refuse(db_session):
    """Sans montant initial, le fichier ne décrit qu'un côté : reprendre le
    montant envoyé comme montant reçu reviendrait à inventer un taux de change
    à 1. L'app préfère refuser la ligne et le demander."""
    euro = get_monnaie_id(db_session)
    dollar = creer_monnaie(db_session, "Dollar", "$").id
    source = creer_compte(db_session, "Wise EUR", monnaies=[(euro, 1000.0)])
    destination = creer_compte(db_session, "Wise USD", monnaies=[(dollar, 0.0)])
    _regle_virement(db_session)
    preset = _preset_wise(db_session, colonnes=_COLONNES_SIMPLES)
    contenu = _fichier_wise(
        [
            [
                date(2026, 7, 1),
                "Transfert interne",
                -100.0,
                "Euro",
                None,
                None,
                None,
                None,
                "Wise EUR",
            ]
        ]
    )

    resultat = import_bancaire.confirmer(
        db_session,
        preset.id,
        contenu,
        schemas.ImportMappingOverrides(
            comptes={"Wise EUR": source.id},
            lignes={1: schemas.ImportLigneOverride(compte_id_autre=destination.id)},
        ),
    )

    assert resultat.operations_creees == 0
    assert "montant reçu" in resultat.lignes_ignorees[0].erreur


def test_un_montant_envoye_saisi_a_la_main_alimente_la_jambe_emettrice(db_session):
    """Le relevé ne porte pas la colonne, l'utilisateur complète la ligne dans
    l'aperçu : le résultat doit être le même que si le fichier l'avait dit.
    L'orientation, elle, reste celle du signe — la saisie n'y change rien."""
    euro = get_monnaie_id(db_session)
    dollar = creer_monnaie(db_session, "Dollar", "$").id
    source = creer_compte(db_session, "Wise EUR", monnaies=[(euro, 1000.0)])
    destination = creer_compte(db_session, "Wise USD", monnaies=[(dollar, 0.0)])
    _regle_virement(db_session)
    preset = _preset_wise(db_session, colonnes=_COLONNES_SIMPLES)
    contenu = _fichier_wise(
        [
            [
                date(2026, 7, 1),
                "Transfert interne",
                -108.0,
                "Dollar",
                None,
                None,
                None,
                None,
                "Wise EUR",
            ]
        ]
    )

    resultat = import_bancaire.confirmer(
        db_session,
        preset.id,
        contenu,
        schemas.ImportMappingOverrides(
            comptes={"Wise EUR": source.id},
            lignes={
                1: schemas.ImportLigneOverride(
                    compte_id_autre=destination.id,
                    montant_envoye=100.0,
                    monnaie_envoyee_id=euro,
                )
            },
        ),
    )

    assert resultat.operations_creees == 2
    sortante = db_session.query(models.Operation).filter_by(sens="transfert_sortant").one()
    assert (sortante.montant, sortante.monnaie_id, sortante.compte_id) == (100.0, euro, source.id)


def test_ligne_dans_une_monnaie_absente_du_compte_est_refusee(db_session):
    euro = get_monnaie_id(db_session)
    dollar = creer_monnaie(db_session, "Dollar", "$").id
    compte = creer_compte(db_session, "Wise", monnaies=[(euro, 0.0)])
    crud.set_mapping_monnaie(db_session, _preset_wise(db_session, "tmp").id, "USD", dollar)
    preset = _preset_wise(db_session, "Wise réel")
    crud.set_mapping_monnaie(db_session, preset.id, "USD", dollar)
    contenu = _fichier_wise(
        [[date(2026, 7, 1), "Achat", -45.2, "USD", None, None, None, None, "Wise"]]
    )

    resultat = import_bancaire.confirmer(
        db_session,
        preset.id,
        contenu,
        schemas.ImportMappingOverrides(comptes={"Wise": compte.id}),
    )

    assert resultat.operations_creees == 0
    assert "ne porte pas la monnaie" in resultat.lignes_ignorees[0].erreur


# ---------- Frais d'émission repris à la main ----------


def _virement_a_completer(db, ligne_fichier):
    """Un relevé qui donne ce qui ARRIVE et la commission, mais pas ce qui PART :
    la jambe émettrice se saisit dans l'aperçu."""
    euro = get_monnaie_id(db)
    sgd = creer_monnaie(db, "SGD", "S$").id
    source = creer_compte(db, "Courant", monnaies=[(euro, 1000.0)])
    dest = creer_compte(db, "Wise", monnaies=[(euro, 0.0), (sgd, 0.0)])
    _regle_virement(db)
    preset = _preset_wise(db, colonnes=_COLONNES_WISE_SENS)
    return euro, sgd, source, dest, preset, _fichier_wise([ligne_fichier])


def _jambes(db):
    return {o.sens.value: (o.montant, o.monnaie_id) for o in db.query(models.Operation).all()}


def test_les_frais_demission_sajoutent_a_la_jambe_emettrice_saisie_a_la_main(db_session):
    """Le cas que le fichier seul ne pouvait pas traiter.

    Sans montant initial dans le relevé, `_appliquer_frais` n'avait rien à
    grever et abandonnait les frais en silence : la commission d'émission
    disparaissait purement et simplement. Le montant envoyé étant maintenant
    saisi dans l'aperçu, elle s'y ajoute — 100 € envoyés + 2 € de frais font
    102 € réellement débités, pendant que les 108 S$ arrivent intacts."""
    euro, sgd, source, dest, preset, contenu = _virement_a_completer(
        db_session,
        [date(2026, 7, 1), "Transfert", 108.0, "SGD", 2.0, "Euro", None, "Euro", "Wise", "Entree"],
    )

    # Le fichier ne dit pas ce qui part : rien à grever à la lecture.
    ligne = import_bancaire.previsualiser(db_session, preset.id, contenu).lignes[0]
    assert (ligne.montant, ligne.montant_envoye, ligne.frais) == (108.0, None, 2.0)

    import_bancaire.confirmer(
        db_session,
        preset.id,
        contenu,
        schemas.ImportMappingOverrides(
            comptes={"Wise": dest.id},
            # Ce que renvoie le formulaire dès qu'il montre les frais : les deux
            # montants HORS FRAIS, la commission et sa devise.
            lignes={
                1: schemas.ImportLigneOverride(
                    compte_id_autre=source.id,
                    montant=108.0,
                    montant_envoye=100.0,
                    monnaie_id=sgd,
                    monnaie_envoyee_id=euro,
                    frais=2.0,
                    monnaie_frais_id=euro,
                )
            },
        ),
    )

    assert _jambes(db_session) == {
        "transfert_sortant": (102.0, euro),
        "transfert_entrant": (108.0, sgd),
    }


def test_les_frais_de_reception_se_retranchent_de_la_jambe_receptrice(db_session):
    """L'autre côté, même parcours : une commission prélevée à l'arrivée ampute
    ce qui arrive, et ce qui part n'en sait rien."""
    euro, sgd, source, dest, preset, contenu = _virement_a_completer(
        db_session,
        [date(2026, 7, 1), "Transfert", 108.0, "SGD", 3.0, "SGD", None, "Euro", "Wise", "Entree"],
    )

    import_bancaire.confirmer(
        db_session,
        preset.id,
        contenu,
        schemas.ImportMappingOverrides(
            comptes={"Wise": dest.id},
            lignes={
                1: schemas.ImportLigneOverride(
                    compte_id_autre=source.id,
                    montant=108.0,
                    montant_envoye=100.0,
                    monnaie_id=sgd,
                    monnaie_envoyee_id=euro,
                    frais=3.0,
                    monnaie_frais_id=sgd,
                )
            },
        ),
    )

    assert _jambes(db_session) == {
        "transfert_sortant": (100.0, euro),
        "transfert_entrant": (105.0, sgd),
    }


def test_une_retouche_sans_frais_laisse_les_montants_intacts(db_session):
    """Non-régression du contrat : hors des lignes qui montrent leurs frais, une
    retouche porte des montants DÉJÀ imputés et rien n'est recalculé. Sans cette
    distinction, la commission serait comptée deux fois."""
    euro, sgd, source, dest, preset, contenu = _virement_a_completer(
        db_session,
        [date(2026, 7, 1), "Transfert", 108.0, "SGD", 2.0, "Euro", 100.0, "Euro", "Wise", "Entree"],
    )

    # Le fichier donne les deux côtés : les frais sont imputés dès la lecture.
    ligne = import_bancaire.previsualiser(db_session, preset.id, contenu).lignes[0]
    assert (ligne.montant_envoye, ligne.montant_envoye_hors_frais) == (102.0, 100.0)

    import_bancaire.confirmer(
        db_session,
        preset.id,
        contenu,
        schemas.ImportMappingOverrides(
            comptes={"Wise": dest.id},
            lignes={1: schemas.ImportLigneOverride(compte_id_autre=source.id)},
        ),
    )

    assert _jambes(db_session) == {
        "transfert_sortant": (102.0, euro),
        "transfert_entrant": (108.0, sgd),
    }


def test_frais_corriges_a_la_main_changent_de_jambe(db_session):
    """La devise des frais est modifiable : la corriger déplace la commission
    d'une jambe à l'autre, sans qu'il faille défalquer l'ancienne imputation."""
    euro, sgd, source, dest, preset, contenu = _virement_a_completer(
        db_session,
        [date(2026, 7, 1), "Transfert", 108.0, "SGD", 2.0, "Euro", 100.0, "Euro", "Wise", "Entree"],
    )

    import_bancaire.confirmer(
        db_session,
        preset.id,
        contenu,
        schemas.ImportMappingOverrides(
            comptes={"Wise": dest.id},
            lignes={
                1: schemas.ImportLigneOverride(
                    compte_id_autre=source.id,
                    montant=108.0,
                    montant_envoye=100.0,
                    monnaie_id=sgd,
                    monnaie_envoyee_id=euro,
                    # Les frais étaient lus en euros : ils sont en fait en SGD.
                    frais=2.0,
                    monnaie_frais_id=sgd,
                )
            },
        ),
    )

    assert _jambes(db_session) == {
        "transfert_sortant": (100.0, euro),
        "transfert_entrant": (106.0, sgd),
    }


def test_preset_ordinaire_reste_insensible_a_la_configuration_avancee(db_session):
    """Aucune régression pour les presets existants : sans aucune colonne
    avancée, une ligne se comporte exactement comme avant."""
    euro = get_monnaie_id(db_session)
    compte = creer_compte(db_session, "CC Perso", monnaies=[(euro, 500.0)])
    preset = crud.create_import_preset(
        db_session,
        "CC Perso",
        [
            {"index": 1, "propriete": "date"},
            {"index": 2, "propriete": "nature"},
            {"index": 3, "propriete": "montant"},
        ],
        [],
        ignorer_premiere_ligne=False,
    )
    contenu = _fichier_wise([[date(2026, 7, 1), "Courses", -45.2]])

    preview = import_bancaire.previsualiser(
        db_session, preset.id, contenu, compte_id_defaut=compte.id
    )
    ligne = preview.lignes[0]

    assert (ligne.monnaie_id, ligne.montant_envoye, ligne.frais) == (None, None, None)
    assert preview.monnaies_inconnues == []
    assert preview.avertissements == []

    import_bancaire.confirmer(
        db_session,
        preset.id,
        contenu,
        schemas.ImportMappingOverrides(
            categories={"": get_categorie_id(db_session, "Autres")}
        ),
        compte_id_defaut=compte.id,
    )

    assert db_session.query(models.Operation).one().monnaie_id == euro
