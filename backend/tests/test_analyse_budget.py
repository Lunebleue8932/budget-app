"""L'extension « Budget » (migration 0059).

CE QUE CES TESTS VERROUILLENT :

  - L'ÉPARGNE SE LIT DANS LES VIREMENTS, et seulement dans ceux qui déplacent
    vraiment de l'argent du courant vers l'épargne. Un virement d'épargne à
    épargne ne met rien de côté ; un virement de courant à courant non plus. Les
    compter aurait gonflé le chiffre exactement là où l'on n'a rien fait ;
  - LA SOMME PORTE SUR L'ALIAS. C'est le piège de cette requête, et il a été
    attrapé ICI et non à la relecture : sommer `models.Operation.montant` sur
    une requête qui n'emploie que des alias fait entrer la table une seconde
    fois dans le FROM, sans jointure. Le total garde ses PROPORTIONS — versé et
    repris sont gonflés du même facteur — et reste donc parfaitement plausible.
    D'où un test sur des montants EXACTS, seul moyen de le voir ;
  - ENTRE DEUX MONNAIES, C'EST LA JAMBE DE L'ÉPARGNE QUI COMPTE : verser 100 €
    qui arrivent en 108 $ met 108 $ de côté, et c'est bien 108 qu'il faudra en
    retirer. Prendre la jambe émettrice aurait rangé des euros dans le total en
    dollars ;
  - LE MATELAS NE REFUSE RIEN. Il se pose même quand on ne le tient pas — c'est
    le cas où il sert le plus, puisque c'est là qu'il a quelque chose à dire ;
  - L'EXTENSION NE CHANGE AUCUN CHIFFRE DU NOYAU. Une étiquette « imprévue » ne
    touche ni les soldes, ni les flux, ni l'histogramme. C'est la promesse qui
    permet de l'éteindre sans conséquence, et elle se vérifie.
"""
import importlib.util
import pathlib
import sys
from datetime import date

import pytest

from app import crud, models, schemas
from app.constants import Statut
from app.services import soldes

from .conftest import creer_compte, get_categorie_id, get_monnaie_id, get_type_id


def _charger(nom):
    """Les modules d'une extension ne sont pas des sous-paquets de `app` : ils
    se chargent par chemin de fichier, comme le fait le noyau (cf.
    app/extensions.py et conftest.charger_module_extension)."""
    racine = pathlib.Path(__file__).resolve().parents[2] / "extensions" / "analyse-budget"
    if str(racine) not in sys.path:
        sys.path.insert(0, str(racine))
    spec = importlib.util.spec_from_file_location(nom, racine / f"{nom}.py")
    module = importlib.util.module_from_spec(spec)
    sys.modules[nom] = module
    spec.loader.exec_module(module)
    return module


service = _charger("service_analyse_budget")


# ---------- Aides ----------


def _type_compte(db, nom):
    return db.query(models.TypeCompte).filter_by(nom=nom).first()


def _compte(db, nom, type_nom, monnaie_id=None):
    compte = models.Compte(nom=nom, type_id=_type_compte(db, type_nom).id)
    db.add(compte)
    db.flush()
    db.add(
        models.CompteMonnaie(
            compte_id=compte.id,
            monnaie_id=monnaie_id or get_monnaie_id(db),
            ordre=0,
        )
    )
    db.commit()
    return compte


def _virer(db, source, destination, montant, jour, **extra):
    return crud.create_virement(
        db,
        schemas.VirementCreate(
            date=jour,
            compte_source_id=source.id,
            compte_destination_id=destination.id,
            montant=montant,
            monnaie_id=extra.get("monnaie_id", get_monnaie_id(db)),
            montant_destination=extra.get("montant_destination"),
            monnaie_destination_id=extra.get("monnaie_destination_id"),
            nature="Virement",
            statut=extra.get("statut", Statut.reel),
        ),
        source,
        destination,
    )


@pytest.fixture()
def comptes(db_session):
    return {
        "courant": _compte(db_session, "Courant", "courant"),
        "courant2": _compte(db_session, "Courant bis", "courant"),
        "livret": _compte(db_session, "Livret", "épargne"),
        "livret2": _compte(db_session, "Livret bis", "épargne"),
        "pea": _compte(db_session, "PEA", "placements financiers"),
    }


# ---------- Ce qu'on a mis de côté ----------


def test_seuls_les_virements_du_courant_vers_l_epargne_comptent(db_session, comptes):
    """MIS DE CÔTÉ = DÉPLACÉ DU COURANT VERS L'ÉPARGNE. Un virement d'épargne à
    épargne range autrement ce qui l'est déjà ; un virement de courant à courant
    ne met rien de côté du tout. Les compter aurait gonflé le chiffre
    précisément là où l'on n'a rien fait."""
    m = get_monnaie_id(db_session)
    _virer(db_session, comptes["courant"], comptes["livret"], 500.0, date(2026, 2, 10))
    _virer(db_session, comptes["courant"], comptes["pea"], 300.0, date(2026, 2, 15))
    # Ni l'un ni l'autre ne doit compter :
    _virer(db_session, comptes["livret"], comptes["livret2"], 100.0, date(2026, 2, 20))
    _virer(db_session, comptes["courant"], comptes["courant2"], 900.0, date(2026, 2, 25))

    resultat = service.epargne_periode(db_session, 2026, 2, m)
    assert resultat["verse"] == pytest.approx(800.0)
    assert resultat["retire"] == pytest.approx(0.0)
    assert resultat["net"] == pytest.approx(800.0)


def test_ce_qui_revient_vers_le_courant_se_retranche(db_session, comptes):
    m = get_monnaie_id(db_session)
    _virer(db_session, comptes["courant"], comptes["livret"], 500.0, date(2026, 3, 1))
    _virer(db_session, comptes["livret"], comptes["courant"], 200.0, date(2026, 3, 20))

    resultat = service.epargne_periode(db_session, 2026, 3, m)
    assert resultat["verse"] == pytest.approx(500.0)
    assert resultat["retire"] == pytest.approx(200.0)
    assert resultat["net"] == pytest.approx(300.0)


def test_les_montants_sont_exacts_et_non_seulement_proportionnels(db_session, comptes):
    """LE TEST QUI A ATTRAPÉ LE PRODUIT CARTÉSIEN. Sommer sur `models.Operation`
    au lieu de l'alias faisait entrer la table une seconde fois dans le FROM,
    sans jointure : versé et repris se trouvaient multipliés par le NOMBRE
    d'opérations de la base — mais tous les deux, donc le rapport entre eux
    restait juste et le résultat parfaitement plausible.

    On ajoute donc du bruit — des opérations qui n'ont rien à voir — et on exige
    un montant EXACT : c'est la seule forme de ce test qui voie quelque chose."""
    m = get_monnaie_id(db_session)
    _virer(db_session, comptes["courant"], comptes["livret"], 500.0, date(2026, 4, 3))

    # Le bruit : vingt dépenses ordinaires. Sans le correctif, chacune multiplie
    # le total.
    for jour in range(1, 21):
        crud.create_operation(
            db_session,
            schemas.OperationCreate(
                date=date(2026, 4, jour),
                compte_id=comptes["courant"].id,
                monnaie_id=m,
                type_id=get_type_id(db_session, "classique"),
                categorie_id=get_categorie_id(db_session, "Alimentaire"),
                nature="Courses",
                montant=10.0,
                statut=Statut.reel,
            ),
        )

    resultat = service.epargne_periode(db_session, 2026, 4, m)
    assert resultat["verse"] == pytest.approx(500.0)
    assert resultat["net"] == pytest.approx(500.0)


def test_entre_deux_monnaies_c_est_la_jambe_de_l_epargne_qui_compte(db_session, comptes):
    """Verser 100 € qui arrivent en 108 $ met 108 $ de côté, et c'est bien 108
    qu'il faudra en retirer. Prendre la jambe émettrice aurait rangé un montant
    en euros dans le total en dollars."""
    euro = get_monnaie_id(db_session)
    dollar = models.Monnaie(nom="Dollar", symbole="$")
    db_session.add(dollar)
    db_session.commit()
    # Le compte d'épargne doit porter la monnaie qu'il reçoit.
    db_session.add(
        models.CompteMonnaie(compte_id=comptes["livret"].id, monnaie_id=dollar.id, ordre=1)
    )
    db_session.commit()

    _virer(
        db_session,
        comptes["courant"],
        comptes["livret"],
        100.0,
        date(2026, 5, 4),
        montant_destination=108.0,
        monnaie_destination_id=dollar.id,
    )

    assert service.epargne_periode(db_session, 2026, 5, dollar.id)["verse"] == pytest.approx(108.0)
    # Et RIEN en euros : la jambe émettrice n'est pas du côté de l'épargne.
    assert service.epargne_periode(db_session, 2026, 5, euro)["verse"] == pytest.approx(0.0)


def test_une_mise_de_cote_prevue_ne_compte_pas(db_session, comptes):
    """Elle n'a pas encore eu lieu : la compter donnerait un chiffre qu'aucun
    relevé ne confirme."""
    m = get_monnaie_id(db_session)
    _virer(
        db_session,
        comptes["courant"],
        comptes["livret"],
        500.0,
        date(2026, 6, 1),
        statut=Statut.previsionnel,
    )
    assert service.epargne_periode(db_session, 2026, 6, m)["verse"] == pytest.approx(0.0)


def test_l_annee_somme_ses_mois_et_en_rend_douze(db_session, comptes):
    """DOUZE LIGNES TOUJOURS : un mois absent se lirait comme un mois qu'on n'a
    pas atteint, alors qu'un mois à zéro est une information."""
    m = get_monnaie_id(db_session)
    _virer(db_session, comptes["courant"], comptes["livret"], 500.0, date(2026, 2, 10))
    _virer(db_session, comptes["courant"], comptes["livret"], 300.0, date(2026, 7, 10))

    mois = service.epargne_par_mois(db_session, 2026, m)
    assert len(mois) == 12
    assert service.epargne_periode(db_session, 2026, None, m)["net"] == pytest.approx(
        sum(ligne["net"] for ligne in mois)
    )


# ---------- Le matelas de sécurité ----------


def test_le_matelas_se_pose_meme_quand_on_ne_le_tient_pas(db_session, comptes):
    """C'est le cas où il sert le PLUS : c'est là qu'il a quelque chose à dire.
    Une garde qui aurait refusé de l'écrire aurait refusé précisément ce pour
    quoi on l'écrit."""
    m = get_monnaie_id(db_session)
    _virer(db_session, comptes["courant"], comptes["livret"], 500.0, date(2026, 2, 10))

    service.set_matelas(db_session, m, 3000.0)
    etat = service.etat_matelas(db_session, m)

    assert etat["matelas"] == 3000.0
    assert etat["disponible"] == pytest.approx(500.0)
    assert etat["ecart"] == pytest.approx(-2500.0)
    assert etat["sous_le_seuil"] is True


def test_sans_matelas_rien_n_est_sous_le_seuil(db_session, comptes):
    """ZÉRO VEUT DIRE « AUCUN MATELAS », et non « un matelas de zéro » :
    annoncer un seuil toujours tenu apprend à ne plus regarder l'endroit où il
    s'affiche."""
    m = get_monnaie_id(db_session)
    etat = service.etat_matelas(db_session, m)
    assert etat["matelas"] == 0.0
    assert etat["sous_le_seuil"] is False


def test_le_matelas_ne_compte_que_les_comptes_d_epargne(db_session, comptes):
    """Un compte de placements porte des TITRES, disponibles seulement après une
    vente et à un cours qu'on ne connaît pas d'avance : les compter dans un
    matelas de SÉCURITÉ reviendrait à se rassurer avec de l'argent qu'on n'a pas
    encore."""
    m = get_monnaie_id(db_session)
    _virer(db_session, comptes["courant"], comptes["livret"], 400.0, date(2026, 2, 10))
    _virer(db_session, comptes["courant"], comptes["pea"], 5000.0, date(2026, 2, 11))

    etat = service.etat_matelas(db_session, m)
    assert etat["disponible"] == pytest.approx(400.0)
    assert [c["nom"] for c in etat["comptes"]] == ["Livret", "Livret bis"]


def test_le_matelas_ne_traverse_pas_les_monnaies(db_session, comptes):
    euro = get_monnaie_id(db_session)
    dollar = models.Monnaie(nom="Dollar", symbole="$")
    db_session.add(dollar)
    db_session.commit()

    service.set_matelas(db_session, euro, 3000.0)
    assert service.get_matelas(db_session, dollar.id) == 0.0
    assert service.etat_matelas(db_session, dollar.id)["sous_le_seuil"] is False


# ---------- Ce qui n'était pas prévisible ----------


def _depense(db, compte, montant, jour, imprevue=False, categorie="Alimentaire"):
    return crud.create_operation(
        db,
        schemas.OperationCreate(
            date=jour,
            compte_id=compte.id,
            monnaie_id=get_monnaie_id(db),
            type_id=get_type_id(db, "classique"),
            categorie_id=get_categorie_id(db, categorie),
            nature="Dépense",
            montant=montant,
            statut=Statut.reel,
            imprevue=imprevue,
        ),
    )


def test_la_part_imprevue_se_rapporte_au_total_depense(db_session, comptes):
    m = get_monnaie_id(db_session)
    _depense(db_session, comptes["courant"], 300.0, date(2026, 3, 4))
    _depense(db_session, comptes["courant"], 100.0, date(2026, 3, 9), imprevue=True)

    resultat = service.imprevues_periode(db_session, 2026, 3, m)
    assert resultat["total"] == pytest.approx(400.0)
    assert resultat["imprevu"] == pytest.approx(100.0)
    assert resultat["part"] == pytest.approx(25.0)


def test_aucune_depense_ne_donne_pas_une_division_par_zero(db_session, comptes):
    resultat = service.imprevues_periode(db_session, 2026, 3, get_monnaie_id(db_session))
    assert resultat["total"] == 0.0
    assert resultat["part"] == 0.0


def test_un_virement_n_est_jamais_une_depense_imprevue(db_session, comptes):
    """Déplacer son propre argent n'est pas une dépense : une étiquette posée
    là ne voudrait rien dire, et le total cesserait d'être comparable à
    l'histogramme du dashboard."""
    m = get_monnaie_id(db_session)
    virement = _virer(db_session, comptes["courant"], comptes["livret"], 500.0, date(2026, 3, 2))
    for jambe in db_session.query(models.Operation).filter(
        models.Operation.virement_id.isnot(None)
    ):
        jambe.imprevue = True
    db_session.commit()

    assert service.imprevues_periode(db_session, 2026, 3, m)["total"] == pytest.approx(0.0)
    assert service.imprevues_periode(db_session, 2026, 3, m)["imprevu"] == pytest.approx(0.0)


def test_le_detail_liste_les_plus_grosses_d_abord(db_session, comptes):
    """« 640 € d'imprévu » appelle immédiatement « lesquels ? », et il faudrait
    sinon repartir dans Opérations reconstituer la liste à la main."""
    m = get_monnaie_id(db_session)
    _depense(db_session, comptes["courant"], 40.0, date(2026, 3, 4), imprevue=True)
    _depense(db_session, comptes["courant"], 600.0, date(2026, 3, 9), imprevue=True)
    _depense(db_session, comptes["courant"], 90.0, date(2026, 3, 11))

    lignes = service.detail_imprevues(db_session, 2026, None, m)
    assert [l["montant"] for l in lignes] == [600.0, 40.0]


# ---------- La promesse de l'extension ----------


def test_l_etiquette_ne_change_aucun_chiffre_du_noyau(db_session, comptes):
    """LA PROMESSE QUI PERMET D'ÉTEINDRE L'EXTENSION SANS CONSÉQUENCE : elle
    n'écrit qu'une étiquette, et aucun calcul du noyau ne la lit. Les soldes,
    les flux et l'histogramme donnent exactement les mêmes chiffres."""
    m = get_monnaie_id(db_session)
    operation = _depense(db_session, comptes["courant"], 250.0, date(2026, 3, 4))

    avant = (
        soldes.get_flux_periode(db_session, 2026, 3, m),
        soldes.get_depenses_par_categorie(db_session, 2026, 3, m),
    )

    crud.update_operation(db_session, operation, schemas.OperationUpdate(imprevue=True))

    apres = (
        soldes.get_flux_periode(db_session, 2026, 3, m),
        soldes.get_depenses_par_categorie(db_session, 2026, 3, m),
    )
    assert avant == apres
    db_session.refresh(operation)
    assert operation.imprevue is True
