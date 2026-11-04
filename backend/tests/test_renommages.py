"""Extension « Renommages » : retenir le nom donné à un libellé, et le reprendre à l'import.

Trois gestes : ENREGISTRER (une opération renommée, une ligne retouchée à l'import), RECONNAÎTRE
À L'IDENTIQUE (aux espaces, accents et casse près), PROPOSER sur une ressemblance — jamais renommer
d'office sur elle.
"""
import io
from datetime import date

import openpyxl

from app import crud, models, schemas
from app.services import import_bancaire, renommages

from app.constants import Statut

from .conftest import creer_compte, get_categorie_id, get_type_id

COLONNES = [
    {"index": 1, "propriete": "date"},
    {"index": 2, "propriete": "nature"},
    {"index": 3, "propriete": "montant"},
]


def _fichier(lignes):
    classeur = openpyxl.Workbook()
    feuille = classeur.active
    for ligne in lignes:
        feuille.append(ligne)
    tampon = io.BytesIO()
    classeur.save(tampon)
    return tampon.getvalue()


def _preset(db, compte):
    preset = crud.create_import_preset(db, "Banque", COLONNES, [], lignes_entete=0)
    preset.compte_id = compte.id
    db.commit()
    return preset


# ---------- Le moteur ----------


def test_la_cle_ignore_accents_espaces_et_casse():
    assert renommages.cle("CB  Café  Léon") == renommages.cle("cb cafe leon")


def test_enregistrer_remplace_le_nom_d_un_meme_libelle(db_session):
    renommages.enregistrer(db_session, "CB CARREFOUR", "Courses")
    renommages.enregistrer(db_session, "cb carrefour", "Supermarché")

    entrees = db_session.query(models.Renommage).all()
    assert [(e.nom_origine, e.nom_nouveau) for e in entrees] == [("CB CARREFOUR", "Supermarché")]


def test_une_chaine_de_renommages_se_raccourcit(db_session):
    renommages.enregistrer(db_session, "A", "B")
    renommages.enregistrer(db_session, "B", "C")

    index = {e.nom_origine: e.nom_nouveau for e in db_session.query(models.Renommage).all()}
    assert index == {"A": "C", "B": "C"}


def test_rendre_son_nom_d_origine_defait_l_entree(db_session):
    renommages.enregistrer(db_session, "CB NETFLIX", "Netflix")
    renommages.enregistrer(db_session, "Netflix", "CB NETFLIX")

    restantes = {e.nom_origine: e.nom_nouveau for e in db_session.query(models.Renommage).all()}
    assert "CB NETFLIX" not in restantes


def test_les_ressemblances_sont_proposees_avec_leur_outil(db_session):
    renommages.enregistrer(db_session, "NETFLIX", "Netflix")
    renommages.enregistrer(db_session, "CB CARREFOUR MARKET", "Courses")
    index = renommages.charger(db_session)

    trouvees = renommages.suggerer(
        index,
        ["CB NETFLIX.COM 0412", "PAIEMENT CARREFOUR MARKET PARIS", "SNCF", "NETFLIX"],
    )

    assert trouvees["CB NETFLIX.COM 0412"].entree.nom_nouveau == "Netflix"
    # Deux outils le reconnaissent (le libellé contient l'autre, et ils ont le même mot utile) ;
    # c'est le mieux noté qui parle.
    assert trouvees["CB NETFLIX.COM 0412"].outil in ("inclusion", "mots")
    assert trouvees["PAIEMENT CARREFOUR MARKET PARIS"].entree.nom_nouveau == "Courses"
    # Rien d'approchant, et l'identique est déjà reconnu : aucune proposition.
    assert "SNCF" not in trouvees
    assert "NETFLIX" not in trouvees


def test_renommer_une_operation_laisse_une_entree(db_session):
    compte = creer_compte(db_session, "CC")
    operation = crud.create_operation(
        db_session,
        schemas.OperationCreate(
            date=date(2026, 7, 1),
            compte_id=compte.id,
            type_id=get_type_id(db_session, "classique"),
            statut=Statut.reel,
            categorie_id=get_categorie_id(db_session, "Charges fixes"),
            nature="CB EDF 0701",
            montant=50.0,
            monnaie_id=compte.monnaie_principale_id,
        ),
    )

    crud.update_operation(db_session, operation, schemas.OperationUpdate(nature="EDF"))

    entree = db_session.query(models.Renommage).one()
    assert (entree.nom_origine, entree.nom_nouveau, entree.origine) == ("CB EDF 0701", "EDF", "operation")


def _operation_nommee(db, compte, nature):
    return crud.create_operation(
        db,
        schemas.OperationCreate(
            date=date(2026, 7, 1),
            compte_id=compte.id,
            type_id=get_type_id(db, "classique"),
            statut=Statut.reel,
            categorie_id=get_categorie_id(db, "Charges fixes"),
            nature=nature,
            montant=50.0,
            monnaie_id=compte.monnaie_principale_id,
        ),
    )


def test_operations_portant_un_libelle_ignore_accents_espaces_et_casse(db_session):
    compte = creer_compte(db_session, "CC")
    _operation_nommee(db_session, compte, "CB  Café 0701")
    _operation_nommee(db_session, compte, "Loyer")

    assert [o.nature for o in renommages.operations_portant(db_session, "cb cafe 0701")] == [
        "CB  Café 0701"
    ]
    assert renommages.operations_portant(db_session, "Inconnu") == []
    assert renommages.operations_portant(db_session, "  ") == []


def test_appliquer_un_renommage_aux_operations_existantes(db_session):
    compte = creer_compte(db_session, "CC")
    a_renommer = _operation_nommee(db_session, compte, "CB EDF 0701")
    deja_bonne = _operation_nommee(db_session, compte, "EDF")
    autre = _operation_nommee(db_session, compte, "Loyer")
    entree = renommages.enregistrer(db_session, "cb edf 0701", "EDF", "manuel")

    assert renommages.appliquer_aux_operations(db_session, entree) == 1

    db_session.refresh(a_renommer)
    db_session.refresh(deja_bonne)
    db_session.refresh(autre)
    assert (a_renommer.nature, deja_bonne.nature, autre.nature) == ("EDF", "EDF", "Loyer")
    # Pas d'entrée de plus : l'opération renommée ici n'est pas un renommage de l'utilisateur.
    assert db_session.query(models.Renommage).count() == 1
    # Rejouée, elle n'a plus rien à faire.
    assert renommages.appliquer_aux_operations(db_session, entree) == 0


# ---------- L'import ----------


def test_l_import_renomme_un_libelle_deja_connu(db_session):
    compte = creer_compte(db_session, "CC")
    preset = _preset(db_session, compte)
    renommages.enregistrer(db_session, "CB CARREFOUR", "Courses")
    contenu = _fichier([[date(2026, 7, 1), "cb  carrefour", -12.0]])

    ligne = import_bancaire.previsualiser(db_session, preset.id, contenu).lignes[0]

    assert ligne.nature == "Courses"
    assert ligne.nature_releve == "cb  carrefour"
    assert ligne.renommee is True


def test_un_libelle_qui_ressemble_n_est_ni_renomme_ni_propose_a_l_import(db_session):
    compte = creer_compte(db_session, "CC")
    preset = _preset(db_session, compte)
    renommages.enregistrer(db_session, "NETFLIX", "Netflix")
    contenu = _fichier([[date(2026, 7, 1), "CB NETFLIX.COM 0412", -12.0]])

    ligne = import_bancaire.previsualiser(db_session, preset.id, contenu).lignes[0]

    assert ligne.nature == "CB NETFLIX.COM 0412"
    assert ligne.renommee is False
    assert not hasattr(ligne, "renommage_propose")


def _importer_netflix(db_session, preset):
    contenu = _fichier([[date(2026, 7, 1), "CB NETFLIX.COM 0412", -12.0]])
    import_bancaire.confirmer(
        db_session,
        preset.id,
        contenu,
        schemas.ImportMappingOverrides(
            lignes={1: schemas.ImportLigneOverride(categorie_id=get_categorie_id(db_session, "Charges fixes"))},
        ),
    )


def test_la_ressemblance_attend_a_trancher_apres_l_import(db_session):
    compte = creer_compte(db_session, "CC")
    preset = _preset(db_session, compte)
    renommages.enregistrer(db_session, "NETFLIX", "Netflix")

    _importer_netflix(db_session, preset)

    # L'opération garde le libellé du relevé : rien n'a été renommé.
    assert db_session.query(models.Operation).one().nature == "CB NETFLIX.COM 0412"
    point = db_session.query(models.RenommageATrancher).one()
    assert (point.libelle, point.entree.nom_nouveau, point.refuse) == (
        "CB NETFLIX.COM 0412",
        "Netflix",
        False,
    )


def test_accepter_un_point_cree_l_entree_du_libelle(db_session):
    compte = creer_compte(db_session, "CC")
    preset = _preset(db_session, compte)
    renommages.enregistrer(db_session, "NETFLIX", "Netflix")
    _importer_netflix(db_session, preset)
    point = db_session.query(models.RenommageATrancher).one()

    entree = renommages.accepter(db_session, point.id)

    assert (entree.nom_origine, entree.nom_nouveau, entree.origine) == (
        "CB NETFLIX.COM 0412",
        "Netflix",
        "suggestion",
    )
    assert db_session.query(models.RenommageATrancher).count() == 0
    # Au prochain relevé, le libellé est reconnu à l'identique.
    index = renommages.charger(db_session)
    assert renommages.nouveau_nom(index, "cb netflix.com 0412").nom_nouveau == "Netflix"


def test_refuser_un_point_ne_le_repose_plus(db_session):
    compte = creer_compte(db_session, "CC")
    preset = _preset(db_session, compte)
    renommages.enregistrer(db_session, "NETFLIX", "Netflix")
    _importer_netflix(db_session, preset)
    point = db_session.query(models.RenommageATrancher).one()

    assert renommages.refuser(db_session, point.id) is True
    # Le même libellé revient au relevé suivant : il n'est pas reposé.
    renommages.noter_a_trancher(db_session, renommages.charger(db_session), "CB NETFLIX.COM 0412")

    lignes = db_session.query(models.RenommageATrancher).all()
    assert [(l.libelle, l.refuse) for l in lignes] == [("CB NETFLIX.COM 0412", True)]


def test_supprimer_l_entree_voisine_retire_ses_points_a_trancher(db_session):
    renommages.enregistrer(db_session, "NETFLIX", "Netflix")
    index = renommages.charger(db_session)
    renommages.noter_a_trancher(db_session, index, "CB NETFLIX.COM 0412")
    assert db_session.query(models.RenommageATrancher).count() == 1

    renommages.oublier(db_session, "NETFLIX")

    assert db_session.query(models.RenommageATrancher).count() == 0


def test_un_libelle_sans_ressemblance_n_est_pas_note(db_session):
    renommages.enregistrer(db_session, "NETFLIX", "Netflix")
    index = renommages.charger(db_session)

    assert renommages.noter_a_trancher(db_session, index, "SNCF VOYAGES") is None
    assert db_session.query(models.RenommageATrancher).count() == 0


def test_retoucher_le_nom_dans_le_recapitulatif_cree_l_entree(db_session):
    compte = creer_compte(db_session, "CC")
    preset = _preset(db_session, compte)
    contenu = _fichier([[date(2026, 7, 1), "PRLV EDF 0701", -50.0]])
    categorie = get_categorie_id(db_session, "Charges fixes")

    import_bancaire.confirmer(
        db_session,
        preset.id,
        contenu,
        schemas.ImportMappingOverrides(
            lignes={1: schemas.ImportLigneOverride(nature="EDF", categorie_id=categorie)},
        ),
    )

    entree = db_session.query(models.Renommage).one()
    assert (entree.nom_origine, entree.nom_nouveau, entree.origine) == ("PRLV EDF 0701", "EDF", "import")


# ---------- La pile « à valider » ----------


def test_un_renommage_note_par_l_app_attend_d_etre_valide(db_session):
    """Une opération renommée, une ligne retouchée à l'import : l'entrée existe mais ne renomme rien
    à l'import tant qu'on ne l'a pas validée. Écrite à la main ou acceptée, elle est permanente d'office."""
    a_valider = renommages.enregistrer(db_session, "CB EDF 0701", "EDF", "operation")
    retouche = renommages.enregistrer(db_session, "PRLV NETFLIX", "Netflix", "import")
    manuelle = renommages.enregistrer(db_session, "CB SNCF", "SNCF", "manuel")
    acceptee = renommages.enregistrer(db_session, "CB TOTAL", "Total", "suggestion")

    assert [e.valide for e in (a_valider, retouche, manuelle, acceptee)] == [False, False, True, True]
    index = renommages.charger(db_session)
    assert sorted(e.nom_nouveau for e in index.values()) == ["SNCF", "Total"]
    assert renommages.nouveau_nom(index, "cb edf 0701") is None


def test_preciser_une_entree_permanente_la_laisse_permanente(db_session):
    renommages.enregistrer(db_session, "CB EDF 0701", "EDF", "manuel")

    entree = renommages.enregistrer(db_session, "CB EDF 0701", "EDF Energie", "operation")

    assert entree.valide is True
    assert renommages.nouveau_nom(renommages.charger(db_session), "CB EDF 0701").nom_nouveau == "EDF Energie"


def test_valider_rend_permanent_et_raccourcit_les_chaines(db_session):
    renommages.enregistrer(db_session, "A", "B", "manuel")
    attente = renommages.enregistrer(db_session, "B", "C", "operation")
    # À valider : « A -> B » n'est pas encore raccourcie en « A -> C ».
    assert renommages.nouveau_nom(renommages.charger(db_session), "A").nom_nouveau == "B"

    assert renommages.valider(db_session, [attente.id, attente.id]) == 1
    assert renommages.valider(db_session, [attente.id]) == 0

    index = renommages.charger(db_session)
    assert renommages.nouveau_nom(index, "A").nom_nouveau == "C"
    assert renommages.nouveau_nom(index, "B").nom_nouveau == "C"


def test_supprimer_en_lot_oublie_validees_et_en_attente(db_session):
    a = renommages.enregistrer(db_session, "A", "B", "manuel")
    b = renommages.enregistrer(db_session, "C", "D", "operation")
    c = renommages.enregistrer(db_session, "E", "F", "manuel")

    assert renommages.supprimer_lot(db_session, [a.id, b.id, 9999]) == 2

    assert [e.nom_origine for e in db_session.query(models.Renommage).all()] == ["E"]
    assert c.id is not None


def test_nombres_a_renommer_compte_les_operations_par_entree(db_session):
    compte = creer_compte(db_session, "CC")
    for nature in ("CB EDF 0701", "cb edf 0701", "EDF", "Loyer"):
        _operation_nommee(db_session, compte, nature)
    entree = renommages.enregistrer(db_session, "CB EDF 0701", "EDF", "manuel")
    vide = renommages.enregistrer(db_session, "Inconnu", "X", "manuel")

    nombres = renommages.nombres_a_renommer(db_session, [entree, vide])

    assert nombres == {entree.id: 2, vide.id: 0}
