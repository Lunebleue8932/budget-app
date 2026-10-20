"""Le garde-fou des montants : à l'import, le SIGNE décide entrée ou dépense, jamais la catégorie.

TROIS FAÇONS DE DIRE LE SENS, UNE SEULE RÈGLE. Un relevé dit si l'argent entre ou sort par le
signe du montant (« -45,20 »), par un mot dans une colonne « Sens » (« Débit »), ou par la colonne
remplie d'un couple « Montant au débit » / « Montant au crédit ». Les deux dernières sont
CONVERTIES en montant signé à la lecture (`montant_signe`) ; la règle, elle, ne connaît que ce
signe (cf. import_bancaire.sens_selon_le_montant).

CE QUE LA RÈGLE INTERDIT : qu'une ligne POSITIVE rangée dans une catégorie de dépense s'écrive
en dépense, ou qu'une ligne NÉGATIVE rangée dans une catégorie d'entrée s'écrive en entrée — que
la catégorie vienne d'une correspondance, d'une règle, de la retouche de la ligne dans l'aperçu
ou d'un repli. Une entrée rangée dans une catégorie de dépense reste une ENTRÉE de cette
catégorie (un remboursement d'achat : il en diminue le net dans la cascade et les projets) ; une
sortie rangée dans une catégorie d'entrée reste une DÉPENSE.

Les types dont la nature impose le sens (remboursement reçu, prêt reçu : des entrées ; dépense
remboursable, remboursement de prêt : des sorties) ne sont pas réécrits : un signe contraire met
la ligne en erreur, plutôt que de l'importer à l'envers.
"""
import io
from datetime import date

import openpyxl
import pytest

from app import crud, models, schemas
from app.constants import Sens
from app.services import cascade, import_bancaire, soldes

from .conftest import creer_compte, get_categorie_id, get_monnaie_id, get_type_id


_DATE = date(2026, 7, 1)
_CATEGORIE_BANQUE = "Divers"

# Trois manières d'écrire la même ligne de 45 € : la ligne rendue par `_cellules` pour un sens.
_MODES = {
    # 1 date | 2 libellé | 3 catégorie bancaire | 4 montant signé
    "montant signe": (
        [
            {"index": 1, "propriete": "date"},
            {"index": 2, "propriete": "nature"},
            {"index": 3, "propriete": "categorie_banque"},
            {"index": 4, "propriete": "montant"},
        ],
        lambda signe: [-45.0 if signe < 0 else 45.0],
    ),
    # 1 date | 2 libellé | 3 catégorie bancaire | 4 montant positif | 5 sens
    "colonne sens": (
        [
            {"index": 1, "propriete": "date"},
            {"index": 2, "propriete": "nature"},
            {"index": 3, "propriete": "categorie_banque"},
            {"index": 4, "propriete": "montant"},
            {"index": 5, "propriete": "sens"},
        ],
        lambda signe: [45.0, "Débit" if signe < 0 else "Crédit"],
    ),
    # 1 date | 2 libellé | 3 catégorie bancaire | 4 débit | 5 crédit
    "debit credit": (
        [
            {"index": 1, "propriete": "date"},
            {"index": 2, "propriete": "nature"},
            {"index": 3, "propriete": "categorie_banque"},
            {"index": 4, "propriete": "montant_debit"},
            {"index": 5, "propriete": "montant_credit"},
        ],
        lambda signe: [45.0, None] if signe < 0 else [None, 45.0],
    ),
}

_SIGNES = {"sortie": -1, "entree": 1}

# Une catégorie de dépense, une catégorie d'entrée (cf. conftest.CATEGORIES_TEST_ENTREE).
_CATEGORIES = {"categorie de depense": "Alimentaire", "categorie d'entree": "Entrées d'argent"}

_SOURCES = ("correspondance", "regle", "retouche")


def _fichier(lignes: list[list]) -> bytes:
    classeur = openpyxl.Workbook()
    feuille = classeur.active
    for ligne in lignes:
        feuille.append(ligne)
    tampon = io.BytesIO()
    classeur.save(tampon)
    return tampon.getvalue()


def _regle(db, nom, *, type_code=None, categorie_id=None, mot="Achat"):
    return crud.create_regle_categorisation(
        db,
        nom=nom,
        type_id=get_type_id(db, type_code) if type_code else None,
        categorie_id=categorie_id,
        conditions={
            "operateur": "ET",
            "groupes": [
                {
                    "operateur": "ET",
                    "conditions": [{"champ": "nature", "operateur": "contient", "valeur": mot}],
                }
            ],
        },
    )


def _importer(db, mode, signe, categorie_id, source, nature="Achat boutique"):
    """Importe UNE ligne de 45 € dans `categorie_id`, classée par `source`. Rend le résultat."""
    colonnes, cellules = _MODES[mode]
    compte = creer_compte(db, "CC Perso")
    preset = crud.create_import_preset(db, "Banque", colonnes, [], lignes_entete=0)
    contenu = _fichier([[_DATE, nature, _CATEGORIE_BANQUE, *cellules(signe)]])

    overrides = schemas.ImportMappingOverrides()
    if source == "correspondance":
        # Le choix du tableau des catégories : mémorisé AVANT la relecture, comme à l'écran.
        overrides = schemas.ImportMappingOverrides(categories={_CATEGORIE_BANQUE: categorie_id})
    elif source == "regle":
        _regle(db, "Classe les achats", categorie_id=categorie_id)
    elif source == "retouche":
        # Ce que le formulaire « Modifier » de l'aperçu renvoie : un montant TOUJOURS positif
        # (le champ refuse le négatif), le type et la catégorie choisis — jamais de signe.
        overrides = schemas.ImportMappingOverrides(
            lignes={
                1: schemas.ImportLigneOverride(
                    montant=45.0, type_code="classique", categorie_id=categorie_id
                )
            }
        )
    return import_bancaire.confirmer(db, preset.id, contenu, overrides, compte_id_defaut=compte.id)


@pytest.mark.parametrize("source", _SOURCES)
@pytest.mark.parametrize("categorie", _CATEGORIES)
@pytest.mark.parametrize("sens", _SIGNES)
@pytest.mark.parametrize("mode", _MODES)
def test_le_signe_decide_quelle_que_soit_la_categorie(db_session, mode, sens, categorie, source):
    categorie_id = get_categorie_id(db_session, _CATEGORIES[categorie])

    resultat = _importer(db_session, mode, _SIGNES[sens], categorie_id, source)

    assert resultat.lignes_ignorees == []
    operation = db_session.query(models.Operation).one()
    # La catégorie choisie est gardée telle quelle : c'est le SENS qu'elle ne décide plus.
    assert operation.categorie_id == categorie_id
    assert operation.montant == 45.0
    assert operation.sens == (Sens.entree if sens == "entree" else Sens.depense)


@pytest.mark.parametrize("sens", _SIGNES)
@pytest.mark.parametrize("mode", _MODES)
def test_le_repli_suit_deja_le_signe(db_session, mode, sens):
    """Rien ne classe la ligne : l'entrée tombe dans « Entrées d'argent », la sortie dans
    « Autres » (cf. crud.categorie_de_repli). Déjà vrai avant le garde-fou."""
    colonnes, cellules = _MODES[mode]
    compte = creer_compte(db_session, "CC Perso")
    preset = crud.create_import_preset(db_session, "Banque", colonnes, [], lignes_entete=0)
    contenu = _fichier([[_DATE, "Achat", "", *cellules(_SIGNES[sens])]])

    import_bancaire.confirmer(
        db_session, preset.id, contenu, schemas.ImportMappingOverrides(), compte_id_defaut=compte.id
    )

    operation = db_session.query(models.Operation).one()
    attendue = "Entrées d'argent" if sens == "entree" else "Autres"
    assert operation.categorie_id == get_categorie_id(db_session, attendue)
    assert operation.sens == (Sens.entree if sens == "entree" else Sens.depense)


def test_une_correspondance_memorisee_a_un_import_precedent_ne_decide_pas_du_sens(db_session):
    """Le tableau des catégories mémorise « Divers » → Alimentaire au premier import ; au second,
    une ligne POSITIVE de « Divers » (un remboursement de la boutique) reste une entrée."""
    compte = creer_compte(db_session, "CC Perso")
    colonnes, _ = _MODES["montant signe"]
    preset = crud.create_import_preset(db_session, "Banque", colonnes, [], lignes_entete=0)
    alimentaire = get_categorie_id(db_session, "Alimentaire")
    crud.set_mapping_categorie(db_session, preset.id, _CATEGORIE_BANQUE, alimentaire)
    contenu = _fichier(
        [
            [_DATE, "Courses", _CATEGORIE_BANQUE, -60.0],
            [_DATE, "Remboursement article", _CATEGORIE_BANQUE, 15.0],
        ]
    )

    import_bancaire.confirmer(
        db_session, preset.id, contenu, schemas.ImportMappingOverrides(), compte_id_defaut=compte.id
    )

    sens = {o.nature: (o.sens, o.categorie_id) for o in db_session.query(models.Operation)}
    assert sens == {
        "Courses": (Sens.depense, alimentaire),
        "Remboursement article": (Sens.entree, alimentaire),
    }


def test_un_montant_negatif_envoye_par_lecran_reste_une_magnitude(db_session):
    """DERNIÈRE BARRIÈRE : le formulaire refuse un montant négatif, mais le serveur ne s'en
    remet pas à lui. Un montant négatif écrit tel quel faisait d'une « dépense de -45 € » une
    entrée de 45 € dans le solde du compte."""
    compte = creer_compte(db_session, "CC Perso")
    colonnes, _ = _MODES["montant signe"]
    preset = crud.create_import_preset(db_session, "Banque", colonnes, [], lignes_entete=0)
    contenu = _fichier([[_DATE, "Courses", _CATEGORIE_BANQUE, -45.0]])

    import_bancaire.confirmer(
        db_session,
        preset.id,
        contenu,
        schemas.ImportMappingOverrides(
            lignes={
                1: schemas.ImportLigneOverride(
                    montant=-45.0,
                    type_code="classique",
                    categorie_id=get_categorie_id(db_session, "Alimentaire"),
                )
            }
        ),
        compte_id_defaut=compte.id,
    )

    operation = db_session.query(models.Operation).one()
    assert (operation.montant, operation.sens) == (45.0, Sens.depense)


def test_sans_signe_lisible_la_categorie_reste_le_seul_repere(db_session):
    """Montant illisible dans le fichier, saisi à la main dans l'aperçu : le relevé n'a rien dit
    du sens, et c'est le seul cas où la catégorie le donne encore (comme une saisie manuelle)."""
    compte = creer_compte(db_session, "CC Perso")
    colonnes, _ = _MODES["montant signe"]
    preset = crud.create_import_preset(db_session, "Banque", colonnes, [], lignes_entete=0)
    contenu = _fichier(
        [
            [_DATE, "Salaire", _CATEGORIE_BANQUE, "illisible"],
            [_DATE, "Courses", _CATEGORIE_BANQUE, "illisible"],
        ]
    )
    entrees = get_categorie_id(db_session, "Entrées d'argent")
    alimentaire = get_categorie_id(db_session, "Alimentaire")

    import_bancaire.confirmer(
        db_session,
        preset.id,
        contenu,
        schemas.ImportMappingOverrides(
            lignes={
                1: schemas.ImportLigneOverride(montant=1500.0, categorie_id=entrees),
                2: schemas.ImportLigneOverride(montant=45.0, categorie_id=alimentaire),
            }
        ),
        compte_id_defaut=compte.id,
    )

    sens = {o.nature: o.sens for o in db_session.query(models.Operation)}
    assert sens == {"Salaire": Sens.entree, "Courses": Sens.depense}


# ---------- Les types qui ont un sens par nature ----------


@pytest.mark.parametrize("mode", _MODES)
def test_une_depense_remboursable_dans_une_categorie_dentree_reste_une_depense(db_session, mode):
    """Le type a une catégorie libre, comme une opération classique : sa catégorie ne décidait
    pas moins de son sens (`crud._sens_pour_type`), et une sortie rangée dans « Entrées
    d'argent » devenait une entrée."""
    entrees = get_categorie_id(db_session, "Entrées d'argent")
    _regle(db_session, "Avance", type_code="remboursable", categorie_id=entrees)

    resultat = _importer(db_session, mode, -1, entrees, source=None)

    assert resultat.lignes_ignorees == []
    operation = db_session.query(models.Operation).one()
    assert (operation.type_code, operation.sens) == ("remboursable", Sens.depense)


@pytest.mark.parametrize(
    "type_code, signe_contraire",
    [("remboursable", 1), ("remboursements", -1), ("pret", -1), ("remboursement_pret", 1)],
)
@pytest.mark.parametrize("mode", _MODES)
def test_un_type_au_sens_impose_refuse_un_signe_contraire(db_session, mode, type_code, signe_contraire):
    """Une règle qui range en « Remboursement reçu » une ligne qui SORT écrivait une entrée : le
    solde du compte s'écartait de celui de la banque du double du montant. La ligne est refusée,
    avec la raison, plutôt qu'importée à l'envers."""
    _regle(db_session, "Type imposé", type_code=type_code)
    colonnes, cellules = _MODES[mode]
    compte = creer_compte(db_session, "CC Perso")
    preset = crud.create_import_preset(db_session, "Banque", colonnes, [], lignes_entete=0)
    contenu = _fichier([[_DATE, "Achat", "", *cellules(signe_contraire)]])

    apercu = import_bancaire.previsualiser(db_session, preset.id, contenu, compte_id_defaut=compte.id)
    assert "le relevé" in (apercu.lignes[0].erreur or "")

    resultat = import_bancaire.confirmer(
        db_session, preset.id, contenu, schemas.ImportMappingOverrides(), compte_id_defaut=compte.id
    )
    assert db_session.query(models.Operation).count() == 0
    assert len(resultat.lignes_ignorees) == 1
    assert "le relevé" in resultat.lignes_ignorees[0].erreur


@pytest.mark.parametrize(
    "type_code, signe, sens",
    [("remboursable", -1, Sens.depense), ("pret", 1, Sens.entree), ("remboursement_pret", -1, Sens.depense)],
)
def test_un_type_au_sens_impose_passe_quand_le_signe_concorde(db_session, type_code, signe, sens):
    _regle(db_session, "Type imposé", type_code=type_code)

    resultat = _importer(db_session, "montant signe", signe, None, source=None)

    assert resultat.lignes_ignorees == []
    assert db_session.query(models.Operation).one().sens == sens


def test_une_retouche_vers_un_type_contraire_au_signe_est_refusee(db_session):
    """La retouche de l'aperçu ne porte pas de signe : changer le type ne peut pas inverser ce
    que le relevé a dit."""
    compte = creer_compte(db_session, "CC Perso")
    colonnes, _ = _MODES["montant signe"]
    preset = crud.create_import_preset(db_session, "Banque", colonnes, [], lignes_entete=0)
    contenu = _fichier([[_DATE, "Prélèvement", _CATEGORIE_BANQUE, -300.0]])

    resultat = import_bancaire.confirmer(
        db_session,
        preset.id,
        contenu,
        schemas.ImportMappingOverrides(
            lignes={1: schemas.ImportLigneOverride(montant=300.0, type_code="pret")}
        ),
        compte_id_defaut=compte.id,
    )

    assert db_session.query(models.Operation).count() == 0
    assert "le relevé" in resultat.lignes_ignorees[0].erreur


# ---------- Montant envoyé / reçu et frais ----------

# 1 date | 2 libellé | 3 catégorie bancaire | 4 montant (reçu) | 5 montant envoyé | 6 frais | 7 sens
_COLONNES_AVANCEES = [
    {"index": 1, "propriete": "date"},
    {"index": 2, "propriete": "nature"},
    {"index": 3, "propriete": "categorie_banque"},
    {"index": 4, "propriete": "montant"},
    {"index": 5, "propriete": "montant_initial"},
    {"index": 6, "propriete": "frais"},
    {"index": 7, "propriete": "sens"},
]


@pytest.mark.parametrize(
    "mot_sens, categorie, montant_attendu, sens_attendu",
    [
        # Sortie rangée dans une catégorie d'entrée : l'envoyé frais compris, une dépense.
        ("Débit", "Entrées d'argent", 102.0, Sens.depense),
        # Entrée rangée dans une catégorie de dépense : le reçu frais déduits, une entrée.
        ("Crédit", "Alimentaire", 98.0, Sens.entree),
    ],
)
def test_frais_et_montant_envoye_suivent_le_meme_signe(
    db_session, mot_sens, categorie, montant_attendu, sens_attendu
):
    compte = creer_compte(db_session, "CC Perso")
    preset = crud.create_import_preset(db_session, "Banque", _COLONNES_AVANCEES, [], lignes_entete=0)
    contenu = _fichier([[_DATE, "Paiement", _CATEGORIE_BANQUE, 100.0, 100.0, 2.0, mot_sens]])
    categorie_id = get_categorie_id(db_session, categorie)

    import_bancaire.confirmer(
        db_session,
        preset.id,
        contenu,
        schemas.ImportMappingOverrides(categories={_CATEGORIE_BANQUE: categorie_id}),
        compte_id_defaut=compte.id,
    )

    operation = db_session.query(models.Operation).one()
    assert (operation.montant, operation.sens, operation.categorie_id) == (
        montant_attendu,
        sens_attendu,
        categorie_id,
    )


def test_des_frais_retouches_sans_signe_suivent_le_sens_de_la_categorie(db_session):
    """Sans signe dans le fichier (montant illisible, saisi à la main), les frais s'imputent
    dans le même sens que celui que l'opération recevra : retranchés d'une entrée, ajoutés à une
    dépense. Ils partaient « en entrée » d'office (frais retranchés) sur une ligne qui
    s'écrivait ensuite en dépense."""
    compte = creer_compte(db_session, "CC Perso")
    colonnes = [
        {"index": 1, "propriete": "date"},
        {"index": 2, "propriete": "nature"},
        {"index": 3, "propriete": "categorie_banque"},
        {"index": 4, "propriete": "montant"},
        {"index": 5, "propriete": "frais"},
    ]
    preset = crud.create_import_preset(db_session, "Banque", colonnes, [], lignes_entete=0)
    contenu = _fichier([[_DATE, "Courses", _CATEGORIE_BANQUE, "illisible", 2.0]])

    import_bancaire.confirmer(
        db_session,
        preset.id,
        contenu,
        schemas.ImportMappingOverrides(
            lignes={
                1: schemas.ImportLigneOverride(
                    montant=100.0,
                    frais=2.0,
                    categorie_id=get_categorie_id(db_session, "Alimentaire"),
                )
            }
        ),
        compte_id_defaut=compte.id,
    )

    operation = db_session.query(models.Operation).one()
    assert (operation.montant, operation.sens) == (102.0, Sens.depense)


# ---------- Ce que deviennent ces opérations dans les totaux ----------


def test_une_entree_dans_une_categorie_de_depense_nest_jamais_une_depense(db_session):
    """Représentation : `sens = entrée`, catégorie de dépense, montant positif. Elle compte dans
    les ENTRÉES des flux, ne touche à aucune barre de dépenses, et DIMINUE le net de sa catégorie
    dans la cascade (celle des projets). Réciproquement, une sortie dans une catégorie d'entrée
    est une DÉPENSE des flux et ne grossit jamais les entrées."""
    compte = creer_compte(db_session, "CC Perso")
    colonnes, _ = _MODES["montant signe"]
    preset = crud.create_import_preset(db_session, "Banque", colonnes, [], lignes_entete=0)
    alimentaire = get_categorie_id(db_session, "Alimentaire")
    entrees = get_categorie_id(db_session, "Entrées d'argent")
    contenu = _fichier(
        [
            [_DATE, "Courses", "Courses", -60.0],
            [_DATE, "Remboursement article", "Courses", 15.0],
            [_DATE, "Salaire", "Revenus", 1000.0],
            [_DATE, "Rectification salaire", "Revenus", -100.0],
        ]
    )

    import_bancaire.confirmer(
        db_session,
        preset.id,
        contenu,
        schemas.ImportMappingOverrides(categories={"Courses": alimentaire, "Revenus": entrees}),
        compte_id_defaut=compte.id,
    )

    monnaie_id = get_monnaie_id(db_session)
    flux = soldes.get_flux_periode(db_session, 2026, 7, monnaie_id)
    assert flux["entrees"] == 1015.0
    assert flux["sorties"] == 160.0
    barres = {
        b["categorie"]: b["total_reel"]
        for b in soldes.get_depenses_par_categorie(db_session, 2026, 7, monnaie_id)
    }
    # L'entrée rangée dans Alimentaire n'est pas une dépense : la barre ne compte que la sortie.
    assert barres["Alimentaire"] == 60.0

    (colonnes_cascade,) = [c["colonnes"] for c in cascade.cascades(db_session, db_session.query(models.Operation).all())]
    nets = {c["libelle"]: c["montant"] for c in colonnes_cascade}
    assert nets["Alimentaire"] == -45.0
    assert nets["Entrées d'argent"] == 900.0
