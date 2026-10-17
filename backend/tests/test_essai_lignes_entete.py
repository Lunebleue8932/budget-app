"""L'essai de lecture d'un écran (colonnes, lignes de tête et de pied) ne s'écrit jamais dans le preset.

La détection des colonnes propose aussi le nombre de lignes de tête et de pied : l'aperçu doit pouvoir
les prendre sur l'écran, sans les enregistrer (cf. services/import_bancaire.EssaiColonnes).
"""
from app import crud
from app.constants import COLONNES_IMPORT_PAR_DEFAUT
from app.services import import_bancaire

from .conftest import creer_compte

CSV = (
    "Relevé de compte;;;;;;;;;;;\r\n"
    "Colonne 1;Colonne 2;Colonne 3;Colonne 4;Colonne 5;Colonne 6;Colonne 7;;;;;\r\n"
    "01/07/2026;;;Courses Monoprix;;Alimentation;-45,2;;;CC Perso;;\r\n"
    "02/07/2026;;;Essence;;Transports;-60;;;CC Perso;;\r\n"
).encode("utf-8")


def _preset(db, lignes_entete):
    return crud.create_import_preset(
        db, "Essai", COLONNES_IMPORT_PAR_DEFAUT, [], lignes_entete=lignes_entete
    )


def test_les_lignes_de_tete_de_l_essai_remplacent_celles_du_preset_sans_les_ecrire(db_session):
    creer_compte(db_session, "CC Perso")
    preset = _preset(db_session, lignes_entete=1)

    # Le preset ne saute qu'une ligne : la seconde ligne de tête passe pour une opération illisible.
    sans_essai = import_bancaire.previsualiser(db_session, preset.id, CSV)
    avec_essai = import_bancaire.previsualiser(
        db_session,
        preset.id,
        CSV,
        colonnes=import_bancaire.EssaiColonnes(COLONNES_IMPORT_PAR_DEFAUT, lignes_entete=2),
    )

    assert len(sans_essai.lignes) == len(avec_essai.lignes) + 1
    assert not any(l.erreur for l in avec_essai.lignes)
    # RIEN N'EST ÉCRIT : le preset garde ses lignes de tête.
    assert crud.get_import_preset(db_session, preset.id).lignes_entete == 1


def test_une_liste_de_colonnes_nue_reste_acceptee(db_session):
    creer_compte(db_session, "CC Perso")
    preset = _preset(db_session, lignes_entete=2)
    apercu = import_bancaire.previsualiser(
        db_session, preset.id, CSV, colonnes=COLONNES_IMPORT_PAR_DEFAUT
    )
    assert len(apercu.lignes) == 2
