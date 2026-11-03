"""Un relevé qui écrit déjà le total débité (frais compris), et un paiement converti sur un compte qui
ne possède qu'une des deux monnaies.

DEUX DÉFAUTS D'UN MÊME CAS : un paiement en monnaie étrangère avec frais. (1) L'import ajoutait les
frais à un montant qui les contenait déjà — le solde de l'app s'écartait de celui de la banque, et ne
s'accordait plus qu'une fois les frais supprimés. (2) Le compte devait posséder la monnaie dans laquelle
le paiement avait été converti, même s'il ne payait pas avec elle.
"""
from datetime import date

from app import models, schemas
from app.services import import_bancaire

from .conftest import creer_compte, creer_monnaie, get_monnaie_id
from .test_import_avance import _COLONNES_WISE_SENS, _fichier_wise, _preset_wise


def _monnaies(db):
    euro = get_monnaie_id(db)
    dollar = creer_monnaie(db, "Dollar", "$").id
    return euro, dollar


# Format « Wise » : 1 date | 2 libellé | 3 montant (ce qui ARRIVE) | 4 devise | 5 frais | 6 devise des
# frais | 7 montant initial (ce qui PART) | 8 devise initiale | 9 compte | 10 sens


def test_par_defaut_les_frais_s_ajoutent_au_montant(db_session):
    euro, _ = _monnaies(db_session)
    creer_compte(db_session, "Wise", monnaies=[(euro, 1000.0)])
    preset = _preset_wise(db_session, colonnes=_COLONNES_WISE_SENS)
    contenu = _fichier_wise(
        [[date(2026, 7, 1), "Abonnement", 100.0, "Euro", 2.0, "Euro", None, None, "Wise", "Sortie"]]
    )

    ligne = import_bancaire.previsualiser(db_session, preset.id, contenu).lignes[0]

    assert ligne.montant == 102.0


def test_des_frais_deja_compris_ne_s_ajoutent_plus(db_session):
    euro, _ = _monnaies(db_session)
    creer_compte(db_session, "Wise", monnaies=[(euro, 1000.0)])
    preset = _preset_wise(db_session, colonnes=_COLONNES_WISE_SENS)
    preset.frais_inclus = True
    db_session.commit()
    contenu = _fichier_wise(
        [[date(2026, 7, 1), "Abonnement", 100.0, "Euro", 2.0, "Euro", None, None, "Wise", "Sortie"]]
    )

    ligne = import_bancaire.previsualiser(db_session, preset.id, contenu).lignes[0]

    # Le montant est celui du relevé ; les frais restent connus, à titre descriptif.
    assert ligne.montant == 100.0
    assert ligne.frais == 2.0
    assert ligne.frais_inclus is True


def test_des_frais_deja_compris_s_enregistrent_sans_changer_le_montant(db_session):
    euro, _ = _monnaies(db_session)
    compte = creer_compte(db_session, "Wise", monnaies=[(euro, 1000.0)])
    preset = _preset_wise(db_session, colonnes=_COLONNES_WISE_SENS)
    preset.frais_inclus = True
    db_session.commit()
    contenu = _fichier_wise(
        [[date(2026, 7, 1), "Abonnement", 100.0, "Euro", 2.0, "Euro", None, None, "Wise", "Sortie"]]
    )

    import_bancaire.confirmer(
        db_session,
        preset.id,
        contenu,
        schemas.ImportMappingOverrides(
            comptes={"Wise": compte.id},
            lignes={1: schemas.ImportLigneOverride(categorie_id=_categorie(db_session))},
        ),
    )

    operation = db_session.query(models.Operation).one()
    assert (operation.montant, operation.frais) == (100.0, 2.0)


def test_une_retouche_garde_les_frais_compris(db_session):
    """La réimputation (retoucher la catégorie, les frais) repart du drapeau de la ligne : sans lui,
    elle ajouterait de nouveau les frais."""
    euro, _ = _monnaies(db_session)
    creer_compte(db_session, "Wise", monnaies=[(euro, 1000.0)])
    preset = _preset_wise(db_session, colonnes=_COLONNES_WISE_SENS)
    preset.frais_inclus = True
    db_session.commit()
    contenu = _fichier_wise(
        [[date(2026, 7, 1), "Abonnement", 100.0, "Euro", 2.0, "Euro", None, None, "Wise", "Sortie"]]
    )
    ligne = import_bancaire.previsualiser(db_session, preset.id, contenu).lignes[0]

    retouchee, _, _ = import_bancaire._retoucher_ligne(
        ligne, schemas.ImportLigneOverride(montant=100.0, frais=3.0)
    )

    assert retouchee.montant == 100.0
    assert retouchee.frais == 3.0


def test_un_paiement_converti_n_oblige_pas_a_posseder_la_monnaie_d_arrivee(db_session):
    """100 $ payés, 92 € débités + 2 € de frais, sur un compte qui ne possède que l'euro : l'opération
    s'écrit en euros, pas en dollars."""
    euro, dollar = _monnaies(db_session)
    creer_compte(db_session, "Wise", monnaies=[(euro, 1000.0)])
    preset = _preset_wise(db_session, colonnes=_COLONNES_WISE_SENS)
    contenu = _fichier_wise(
        # montant = 100 $ (ce qui arrive chez le marchand), montant initial = 92 € (ce qui part)
        [[date(2026, 7, 1), "Carte Amazon US", 100.0, "Dollar", 2.0, "Euro", 92.0, "Euro", "Wise", "Sortie"]]
    )

    ligne = import_bancaire.previsualiser(db_session, preset.id, contenu).lignes[0]

    assert (ligne.montant, ligne.monnaie_operation_id) == (94.0, euro)


def test_une_monnaie_possedee_cote_montant_est_retenue_si_l_autre_manque(db_session):
    """Le relevé d'une banque en euros : « montant » = 92 € débités, « montant initial » = 100 $ d'origine
    (le paiement). Le compte n'a que l'euro : c'est le montant en euros qui fait l'opération."""
    euro, dollar = _monnaies(db_session)
    compte = creer_compte(db_session, "Wise", monnaies=[(euro, 1000.0)])
    preset = _preset_wise(db_session, colonnes=_COLONNES_WISE_SENS)
    # Le compte est connu (format lié à ce compte) : sans lui, l'app ne sait pas quelles monnaies il porte.
    preset.compte_id = compte.id
    db_session.commit()
    contenu = _fichier_wise(
        [[date(2026, 7, 1), "Carte Amazon US", 92.0, "Euro", 2.0, "Euro", 100.0, "Dollar", "Wise", "Sortie"]]
    )

    ligne = import_bancaire.previsualiser(db_session, preset.id, contenu).lignes[0]
    assert (ligne.montant, ligne.monnaie_operation_id) == (94.0, euro)

    resultat = import_bancaire.confirmer(
        db_session,
        preset.id,
        contenu,
        schemas.ImportMappingOverrides(
            comptes={"Wise": compte.id},
            lignes={1: schemas.ImportLigneOverride(categorie_id=_categorie(db_session))},
        ),
    )

    assert resultat.operations_creees == 1
    operation = db_session.query(models.Operation).one()
    assert (operation.montant, operation.monnaie_id) == (94.0, euro)


def _categorie(db):
    from .conftest import get_categorie_id

    return get_categorie_id(db, "Autres")
